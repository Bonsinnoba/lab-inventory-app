use rusqlite::{params,Connection,OptionalExtension,TransactionBehavior};
use serde_json::{json,Value};
use std::collections::HashSet;
use tauri::AppHandle;
use crate::{local_db,local_auth,inventory_sync_state as inventory};

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
