use rusqlite::{params,Connection,OptionalExtension,TransactionBehavior};
use serde_json::{json,Value};
use std::collections::HashSet;
use tauri::AppHandle;
use crate::{local_db,local_auth,inventory_sync_state as inventory};
pub(crate) fn valid_day(day:&str)->bool{
    let bytes=day.as_bytes();if bytes.len()!=10||bytes[4]!=b'-'||bytes[7]!=b'-'||bytes.iter().enumerate().any(|(i,b)|i!=4&&i!=7&&!b.is_ascii_digit()){return false}
    let year=day[..4].parse::<u32>().unwrap_or(0);let month=day[5..7].parse::<usize>().unwrap_or(0);let date=day[8..].parse::<u32>().unwrap_or(0);
    if year==0||month==0||month>12{return false}let leap=year%4==0&&(year%100!=0||year%400==0);let days=[31,if leap{29}else{28},31,30,31,30,31,31,30,31,30,31];date>0&&date<=days[month-1]
}

#[tauri::command]
pub fn get_local_workbook_export(app:AppHandle,domain:String,expected_account_id:String)->Result<Vec<Value>,String>{
    export_snapshot(&mut local_db::open_local_connection(&app)?,&domain,&expected_account_id)
}
fn export_snapshot(c:&mut Connection,domain:&str,account:&str)->Result<Vec<Value>,String>{
    let tx=c.transaction().map_err(|e|e.to_string())?;
    local_db::require_sync_account(&tx,account)?;
    local_auth::require_local_permission(&tx,"reports.export")?;
    let rows=match domain {
        "inventory"=>{local_auth::require_local_permission(&tx,"inventory.view")?;inventory::read(&tx)?.ok_or("Inventory has not been synchronized on this PC")?},
        "finance"=>{
            local_auth::require_local_permission(&tx,"finance.view")?;
            local_auth::require_local_permission(&tx,"finance.view_sensitive")?;
            let raw:Option<String>=tx.query_row("SELECT value FROM sync_state WHERE key=?1",[local_db::scoped_state_key(&tx,"finance_transactions_state")?],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
            let rows:Vec<Value>=serde_json::from_str(&raw.ok_or("Financial transactions have not been synchronized on this PC")?).map_err(|_|"Invalid local finance snapshot")?;
            if rows.iter().any(|row|!row.is_object()||row["id"].as_str().is_none()){return Err("Invalid local finance export record".into())}rows
        },
        _=>return Err("Unsupported local workbook domain".into())
    };
    tx.commit().map_err(|e|e.to_string())?;Ok(rows)
}
pub(crate) fn cached_rows(c:&Connection,key:&str)->Result<Vec<Value>,String>{
    let raw:Option<String>=c.query_row("SELECT value FROM sync_state WHERE key=?1",[local_db::scoped_state_key(c,key)?],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
    let rows:Vec<Value>=serde_json::from_str(&raw.ok_or_else(||format!("Required workbook snapshot {key} has not been synchronized on this PC"))?).map_err(|_|format!("Invalid cached workbook snapshot {key}"))?;
    if rows.iter().any(|r|!r.is_object()||r["id"].as_str().is_none()){return Err(format!("Invalid workbook record in {key}"))}Ok(rows)
}
#[tauri::command]
pub fn get_local_workbook_context(app:AppHandle,domain:String,expected_account_id:String)->Result<Value,String>{review_context(&mut local_db::open_local_connection(&app)?,&domain,&expected_account_id)}
fn review_context(c:&mut Connection,domain:&str,account:&str)->Result<Value,String>{
    let tx=c.transaction().map_err(|e|e.to_string())?;local_db::require_sync_account(&tx,account)?;
    let mut result=json!({});
    match domain {
        "finance"=>{
            for p in ["finance.import","finance.view","finance.view_sensitive"]{local_auth::require_local_permission(&tx,p)?;}
            for (field,key) in [("transactions","finance_transactions_state"),("funding_sources","finance_funding_sources_state"),("budget_periods","finance_budget_periods_state")]{result[field]=json!(cached_rows(&tx,key)?);}
            if local_auth::require_local_permission(&tx,"inventory.view").is_ok(){result["items"]=json!(inventory::read(&tx)?);}
        },
        "purchases"=>{
            for p in ["inventory.import","inventory.view","finance.view","finance.create_expense"]{local_auth::require_local_permission(&tx,p)?;}
            result["items"]=json!(inventory::read(&tx)?.ok_or("Inventory must be synchronized before purchase review")?);
            result["transactions"]=json!(cached_rows(&tx,"finance_transactions_state")?);
        },
        _=>return Err("Unsupported workbook review domain".into())
    }
    if local_auth::require_local_permission(&tx,"projects.view").is_ok(){result["projects"]=json!(cached_rows(&tx,"projects_state")?);}
    let permissions=["finance.edit","finance.create_income","finance.create_expense","inventory.create","inventory.edit","inventory.adjust_stock","projects.edit"];
    result["permissions"]=json!(permissions.into_iter().filter(|p|local_auth::require_local_permission(&tx,p).is_ok()).collect::<Vec<_>>());
    tx.commit().map_err(|e|e.to_string())?;Ok(result)
}

#[tauri::command]
pub fn import_local_finance_rows(app:AppHandle,rows_json:String,expected_snapshot_json:String,expected_account_id:String,change_id:String)->Result<Value,String>{finance_import(&mut local_db::open_local_connection(&app)?,&rows_json,&expected_snapshot_json,&expected_account_id,&change_id)}
fn finance_import(c:&mut Connection,raw:&str,base:&str,account:&str,change:&str)->Result<Value,String>{
    if raw.len()>10*1024*1024{return Err("Finance workbook intent exceeds 10 MiB".into())}
    let change=inventory::canonical_id(change)?;let rows:Vec<Value>=serde_json::from_str(raw).map_err(|_|"Invalid finance workbook intent")?;
    if rows.is_empty()||rows.len()>500{return Err("Provide 1–500 finance workbook rows".into())}
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
    local_db::require_sync_account(&tx,account)?;for p in ["finance.import","finance.view","finance.view_sensitive"]{local_auth::require_local_permission(&tx,p)?;}
    let mut seen=HashSet::new();let mut created=0;let mut updated=0;
    for row in &rows{
        let record=&row["record"];let id=inventory::canonical_id(record["id"].as_str().ok_or("Transaction ID required")?)?;
        if record["id"]!=id{return Err("Canonical transaction UUID required".into())}
        if !seen.insert(id){return Err("Duplicate finance workbook identity".into())}
        for field in ["vendor","notes"]{if !record[field].is_null()&&!record[field].as_str().is_some_and(|s|s.len()<=20000){return Err(format!("Invalid finance {field}"))}}
        for field in ["item_id","project_id","funding_source_id","budget_period_id"]{if !record[field].is_null(){let value=record[field].as_str().ok_or_else(||format!("Invalid finance {field}"))?;if inventory::canonical_id(value)?!=value{return Err(format!("Canonical finance {field} required"))}}}
        let direction=record["direction"].as_str().ok_or("Transaction direction required")?;
        let types=match direction{"income"=>&["donation","investment","grant","lab_allocation","other_income"][..],"expense"=>&["purchase","repair","replacement","project_expense","other"][..],_=>return Err("Invalid transaction direction".into())};
        if !record["type"].as_str().is_some_and(|t|types.contains(&t))||!record["amount"].as_f64().is_some_and(|n|n.is_finite()&&n>0.0){return Err("Invalid transaction type or amount".into())}
        let day=record["date"].as_str().ok_or("Transaction date required")?;if !valid_day(day){return Err("Invalid transaction date".into())}
        match row["operation"].as_str(){Some("create")=>{local_auth::require_local_permission(&tx,if direction=="income"{"finance.create_income"}else{"finance.create_expense"})?;created+=1;},Some("update")=>{local_auth::require_local_permission(&tx,"finance.edit")?;updated+=1;},_=>return Err("Explicit finance workbook operation required".into())}
    }
    let result=json!({"ok":true,"imported":rows.len(),"created":created,"updated":updated});
    let prior:Option<(String,String,String,String)>=tx.query_row("SELECT account_id,entity_type,operation,payload_json FROM sync_outbox WHERE change_id=?1",[&change],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(|e|e.to_string())?;
    if let Some((owner,kind,op,payload))=prior{let payload:Value=serde_json::from_str(&payload).map_err(|e|e.to_string())?;if owner!=account||kind!="transaction"||op!="import"||payload["rows"]!=json!(rows){return Err("Finance retry identity belongs to a different request".into())}return Ok(result)}
    let mut next=cached_rows(&tx,"finance_transactions_state")?;let expected:Vec<Value>=serde_json::from_str(base).map_err(|_|"Invalid reviewed finance snapshot")?;
    if next!=expected{return Err("Finance changed after workbook review; review again".into())}
    let now:String=tx.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    for row in &rows{
        let record=&row["record"];let id=record["id"].as_str().unwrap();let existing=next.iter().position(|r|r["id"]==id);
        if row["operation"]=="create"&&existing.is_some()||row["operation"]=="update"&&existing.is_none(){return Err("Workbook target existence changed".into())}
        if let Some(index)=existing{if row["expected_before"]!=next[index]{return Err("Reviewed transaction changed".into())}if next[index]["direction"]!=record["direction"]{local_auth::require_local_permission(&tx,if record["direction"]=="income"{"finance.create_income"}else{"finance.create_expense"})?;}if let Some(project)=next[index]["project_id"].as_str(){crate::local_projects::require_cached_project_access(&tx,project,true)?;}}
        for (field,key,permission) in [("item_id","inventory_snapshot","inventory.view"),("funding_source_id","finance_funding_sources_state","finance.view_sensitive"),("budget_period_id","finance_budget_periods_state","finance.view_sensitive")]{if let Some(reference)=record[field].as_str(){local_auth::require_local_permission(&tx,permission)?;let reference=inventory::canonical_id(reference)?;if !cached_rows(&tx,key)?.iter().any(|r|r["id"]==reference){return Err(format!("Workbook {field} unavailable locally"))}}else if !record[field].is_null(){return Err(format!("Invalid workbook {field}"))}}
        if let Some(project)=record["project_id"].as_str(){crate::local_projects::require_cached_project_access(&tx,project,true)?;}
        if record["direction"]=="income"&&matches!(record["type"].as_str(),Some("grant"|"donation"|"investment"))&&record["funding_source_id"].is_null()||record["type"]=="project_expense"&&record["project_id"].is_null(){return Err("Required finance relationship missing".into())}
        let mut value=existing.map(|index|next[index].clone()).unwrap_or_else(||json!({"id":id,"created_at":now,"logged_by":account}));
        for field in ["type","direction","amount","date","vendor","notes","item_id","project_id","funding_source_id","budget_period_id"]{value[field]=record[field].clone();}value["updated_at"]=json!(now);
        if let Some(index)=existing{next[index]=value;}else{next.push(value);}
    }
    tx.execute("UPDATE sync_state SET value=?1 WHERE key=?2",params![json!(next).to_string(),local_db::scoped_state_key(&tx,"finance_transactions_state")?]).map_err(|e|e.to_string())?;
    let device:String=tx.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    tx.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,'transaction',NULL,'import',?3)",params![change,device,json!({"rows":rows}).to_string()]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e|e.to_string())?;Ok(result)
}

#[tauri::command]
pub fn import_local_inventory_rows(app:AppHandle,rows_json:String,expected_snapshot_json:String,expected_account_id:String,change_id:String)->Result<Value,String>{
    import_rows(&mut local_db::open_local_connection(&app)?,&rows_json,&expected_snapshot_json,&expected_account_id,&change_id)
}
fn quantity(row:&Value)->Result<f64,String>{
    numeric_quantity(&row["current_quantity"])
}
fn numeric_quantity(value:&Value)->Result<f64,String>{
    value.as_f64().or_else(||value.as_str().and_then(|v|v.parse().ok())).filter(|v|v.is_finite()&&*v>=0.0).ok_or("Invalid inventory quantity".into())
}
pub(crate) fn import_rows(c:&mut Connection,raw:&str,base:&str,account:&str,change:&str)->Result<Value,String>{
    let change=inventory::canonical_id(change)?;
    let rows:Vec<Value>=serde_json::from_str(raw).map_err(|e|format!("Invalid inventory import: {e}"))?;
    if rows.is_empty()||rows.len()>500{return Err("Provide 1–500 inventory rows per import".into())}
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
    local_db::require_sync_account(&tx,account)?;
    local_auth::require_local_permission(&tx,"inventory.view")?;
    local_auth::require_local_permission(&tx,"inventory.import")?;
    let mut seen=HashSet::new();let mut created=0;let mut updated=0;
    for row in &rows{
        let id=inventory::canonical_id(row["record"]["id"].as_str().ok_or("Import row ID required")?)?;
        if !seen.insert(id){return Err("Duplicate inventory import identity".into())}
        match row["operation"].as_str(){
            Some("create")=>{local_auth::require_local_permission(&tx,"inventory.create")?;created+=1;},
            Some("update")=>{local_auth::require_local_permission(&tx,"inventory.edit")?;updated+=1;},
            _=>return Err("Explicit create/update import operation required".into())
        }
        for field in ["name","type"]{if row["record"][field].as_str().map(str::trim).filter(|s|!s.is_empty()).is_none(){return Err(format!("Import {field} required"))}}
        quantity(&row["record"])?;
        numeric_quantity(&row["record"]["initial_quantity"])?;
    }
    let result=json!({"imported":rows.len(),"created":created,"updated":updated});
    let prior:Option<(String,String,String,String)>=tx.query_row("SELECT account_id,entity_type,operation,payload_json FROM sync_outbox WHERE change_id=?1",[&change],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(|e|e.to_string())?;
    if let Some((owner,kind,op,payload))=prior{
        let payload:Value=serde_json::from_str(&payload).map_err(|e|e.to_string())?;
        if owner!=account||kind!="item"||op!="import"||payload["rows"]!=json!(rows){return Err("Import retry identity belongs to a different request".into())}
        // A lost native response must not create another local batch, even if
        // the original has already synchronized or the cache changed afterward.
        return Ok(result)
    }
    inventory::require_base(&tx,account,base)?;
    let mut next=inventory::read(&tx)?.ok_or("Initialize inventory before importing")?;
    let now:String=tx.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    let mut bases=vec![];
    for row in &rows{
        let op=row["operation"].as_str().unwrap();let mut record=row["record"].clone();
        let id=inventory::canonical_id(record["id"].as_str().unwrap())?;record["id"]=json!(id);
        if op=="update"{
            let old=next.iter_mut().find(|r|r["id"]==id).ok_or("Import target no longer exists")?;
            if quantity(old)?!=quantity(&record)?{local_auth::require_local_permission(&tx,"inventory.adjust_stock")?;}
            // A workbook does not contain every item field. Preserve links,
            // ownership, attachments and other non-workbook metadata.
            for (key,value) in record.as_object().ok_or("Import record required")?{if !["sync_version","created_at","updated_at"].contains(&key.as_str()){old[key]=value.clone();}}
        }else{let mut local=record.clone();local["created_at"]=json!(now);next.push(local);}
        next.iter_mut().find(|r|r["id"]==id).ok_or("Import target missing")?["updated_at"]=json!(now);
        let mut intent=if op=="create"{record}else{json!({"id":id,"patch":record})};
        inventory::stamp_versions(&tx,"item",Some(&id),op,&mut intent,&mut next)?;
        bases.push(intent["item_bases"][0].clone());
    }
    let payload=json!({"rows":rows,"inventory_protocol":2,"item_bases":bases});
    inventory::write(&tx,&next)?;
    let device:String=tx.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    tx.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,'item',NULL,'import',?3)",params![change,device,payload.to_string()]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e|e.to_string())?;Ok(result)
}

#[cfg(test)]
#[path="local_excel_test.rs"]
mod tests;
