use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};
use tauri::AppHandle;
use crate::{local_auth, local_db};

const KEY: &str = "maintenance_state";
fn uuid(value:&str)->Result<String,String>{uuid::Uuid::parse_str(value).map(|id|id.to_string()).map_err(|_|"Invalid maintenance/item UUID".into())}
fn read(c:&Connection)->Result<Vec<Value>,String>{
    let raw:Option<String>=c.query_row("SELECT value FROM sync_state WHERE key=?1",[local_db::scoped_state_key(c,KEY)?],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
    match raw {Some(raw)=>serde_json::from_str(&raw).map_err(|e|format!("Invalid maintenance cache: {e}")),None=>Ok(vec![])}
}
fn write(c:&Connection,rows:&[Value])->Result<(),String>{
    c.execute("INSERT INTO sync_state(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![local_db::scoped_state_key(c,KEY)?,serde_json::to_string(rows).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;Ok(())
}
fn authorize(c:&Connection,account:&str,mutating:bool)->Result<(),String>{
    local_db::require_sync_account(c,account)?;
    local_auth::require_local_permission(c,"inventory.view")?;
    if mutating {local_auth::require_local_permission(c,"inventory.edit")?;} Ok(())
}
fn validate(record:&Value)->Result<(),String>{
    let kind=record["maintenance_type"].as_str().ok_or("Maintenance type required")?;
    let status=record["status"].as_str().ok_or("Maintenance status required")?;
    if !["routine","repair","inspection","calibration","cleaning","other"].contains(&kind){return Err("Invalid maintenance type".into())}
    if !["scheduled","in_progress","completed","cancelled"].contains(&status){return Err("Invalid maintenance status".into())}
    if !record["notes"].is_null() && record["notes"].as_str().map(|s|s.chars().count()>10000).unwrap_or(true){return Err("Invalid maintenance notes".into())}
    if !record["cost"].is_null(){let cost=record["cost"].as_f64().ok_or("Invalid maintenance cost")?;if !cost.is_finite() || !(0.0..=9999999999.99).contains(&cost){return Err("Invalid maintenance cost".into())}}
    for field in ["scheduled_date","completed_date"] {
        if record[field].is_null(){continue}
        let date=record[field].as_str().ok_or("Invalid maintenance date")?;
        let parts:Vec<u32>=date.split('-').filter_map(|s|s.parse().ok()).collect();
        if date.len()!=10 || parts.len()!=3 || date.as_bytes()[4]!=b'-' || date.as_bytes()[7]!=b'-'{return Err("Invalid maintenance date".into())}
        let (y,m,d)=(parts[0],parts[1],parts[2]);
        let leap=y%4==0&&(y%100!=0||y%400==0);
        let days=match m {1|3|5|7|8|10|12=>31,4|6|9|11=>30,2=>if leap{29}else{28},_=>0};
        if y==0 || d==0 || d>days {return Err("Invalid maintenance date".into())}
    } Ok(())
}

// Read, permission check, local projection and immutable authored intent share
// one IMMEDIATE transaction. A failed outbox insertion rolls everything back.
fn mutate(c:&mut Connection,account:&str,item_id:&str,entity_id:Option<&str>,operation:&str,patch:Value,expected_version:Option<i64>,change_id:&str)->Result<Value,String>{
    let item_id=uuid(item_id)?;
    let entity_id=match entity_id {Some(id)=>uuid(id)?,None if operation=="create"=>local_db::new_uuid(),_=>return Err("Maintenance ID required".into())};
    if !["create","update","delete"].contains(&operation){return Err("Invalid maintenance operation".into())}
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
    authorize(&tx,account,true)?;
    let mut rows=read(&tx)?;
    let existing=rows.iter().find(|r|r["id"]==entity_id).cloned();
    if operation=="create" && existing.is_some(){return Err("Maintenance ID already exists".into())}
    if operation!="create" {
        let old=existing.as_ref().ok_or("Maintenance record not found")?;
        if old["item_id"]!=item_id{return Err("Maintenance item cannot be changed".into())}
        if expected_version!=old["sync_version"].as_i64(){return Err("Maintenance changed locally. Refresh and review before saving.".into())}
    }
    let version=existing.as_ref().and_then(|r|r["sync_version"].as_i64()).unwrap_or(0);
    let mut record=existing.unwrap_or_else(||json!({"id":entity_id,"item_id":item_id,"maintenance_type":"routine","status":"scheduled","scheduled_date":null,"completed_date":null,"notes":null,"cost":null,"created_by":account,"performed_by":null}));
    let patch=patch.as_object().ok_or("Maintenance patch must be an object")?;
    if operation!="delete" {
        for field in ["maintenance_type","status","scheduled_date","completed_date","notes","cost"]{if let Some(value)=patch.get(field){record[field]=value.clone();}}
        // PostgreSQL numeric columns are returned as strings, local intent uses numbers.
        if let Some(cost)=record["cost"].as_str(){record["cost"]=json!(cost.parse::<f64>().map_err(|_|"Invalid maintenance cost")?);}
        validate(&record)?;
        let inventory:Option<String>=tx.query_row("SELECT value FROM sync_state WHERE key=?1",[local_db::scoped_state_key(&tx,"inventory_snapshot")?],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
        let items:Vec<Value>=serde_json::from_str(&inventory.ok_or("Download inventory before adding maintenance")?).map_err(|e|e.to_string())?;
        if !items.iter().any(|i|i["id"]==item_id){return Err("Inventory item is not available locally".into())}
        let now:String=tx.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')",[],|r|r.get(0)).map_err(|e|e.to_string())?;
        if operation=="create"{record["created_at"]=json!(now);}
        record["updated_at"]=json!(now); record["sync_version"]=json!(version+1);
        if record["status"]=="completed" && record["performed_by"].is_null(){record["performed_by"]=json!(account);}
    }
    let previous:Option<String>=tx.query_row("SELECT change_id FROM sync_outbox WHERE account_id=?2 AND entity_type='maintenance_record' AND entity_id=?1 AND synced_at IS NULL ORDER BY rowid DESC LIMIT 1",params![entity_id,account],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
    rows.retain(|r|r["id"]!=entity_id);
    if operation!="delete"{rows.push(record.clone());}
    write(&tx,&rows)?;
    let device:String=tx.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    let payload=json!({"record":record,"expected_version":version,"depends_on":previous});
    tx.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,'maintenance_record',?3,?4,?5)",params![change_id,device,entity_id,operation,payload.to_string()]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e|e.to_string())?;
    Ok(if operation=="delete"{json!({"id":entity_id,"deleted":true})}else{record})
}

fn apply_pull(c:&mut Connection,account:&str,incoming:Vec<Value>,complete:bool)->Result<(),String>{
    if !complete{return Err("Maintenance server omitted complete snapshot marker".into())}
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
    authorize(&tx,account,false)?;
    for r in &incoming {uuid(r["id"].as_str().ok_or("Invalid maintenance snapshot ID")?)?;if r["sync_version"].as_i64().unwrap_or(0)<1{return Err("Invalid maintenance snapshot version".into())}}
    let pending:std::collections::HashSet<String>=tx.prepare("SELECT entity_id FROM active_sync_outbox WHERE entity_type='maintenance_record' AND synced_at IS NULL").map_err(|e|e.to_string())?.query_map([],|r|r.get(0)).map_err(|e|e.to_string())?.collect::<Result<_,_>>().map_err(|e|e.to_string())?;
    let mut rows=read(&tx)?;
    local_db::retain_authorized_snapshot(&mut rows,&incoming,&pending);
    for record in incoming {if pending.contains(record["id"].as_str().unwrap()){continue}rows.retain(|r|r["id"]!=record["id"]);rows.push(record);}
    write(&tx,&rows)?;tx.commit().map_err(|e|e.to_string())
}

#[tauri::command]
pub fn list_local_maintenance(app:AppHandle,item_id:Option<String>,expected_account_id:String)->Result<Vec<Value>,String>{
    let c=local_db::open_local_connection(&app)?;authorize(&c,&expected_account_id,false)?;
    let item_id=item_id.map(|id|uuid(&id)).transpose()?;
    Ok(read(&c)?.into_iter().filter(|r|item_id.as_ref().map(|id|r["item_id"]==*id).unwrap_or(true)).collect())
}
#[tauri::command]
pub fn mutate_local_maintenance(app:AppHandle,item_id:String,id:Option<String>,operation:String,record:Value,expected_version:Option<i64>,expected_account_id:String)->Result<Value,String>{
    mutate(&mut local_db::open_local_connection(&app)?,&expected_account_id,&item_id,id.as_deref(),&operation,record,expected_version,&local_db::new_uuid())
}
#[tauri::command]
pub fn apply_server_maintenance_pull(app:AppHandle,records:Vec<Value>,snapshot_complete:bool,expected_account_id:String)->Result<(),String>{
    apply_pull(&mut local_db::open_local_connection(&app)?,&expected_account_id,records,snapshot_complete)
}

#[cfg(test)]
#[path="local_maintenance_test.rs"]
mod tests;
