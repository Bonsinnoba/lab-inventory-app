use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};
use tauri::AppHandle;
use crate::{local_auth, local_db};

fn fields(kind:&str)->Result<&'static [&'static str],String>{match kind{
    "supplier"=>Ok(&["name","contact_name","email","phone","website","notes"]),
    "storage_container"=>Ok(&["name","container_type","storage_location","capacity","notes"]),
    _=>Err("Unsupported catalog".into())
}}
fn uuid(id:&str)->Result<String,String>{uuid::Uuid::parse_str(id).map(|u|u.to_string()).map_err(|_|"Invalid catalog UUID".into())}
fn authorize(c:&Connection,account:&str,kind:&str,op:&str)->Result<(),String>{
    fields(kind)?;local_db::require_sync_account(c,account)?;
    local_auth::require_local_permission(c,"inventory.view")?;
    if op!="read" {
        local_auth::require_local_permission(c,match op{"create"=>"inventory.create","delete"=>"inventory.delete",_=>"inventory.edit"})?;
        if kind=="supplier"&&op=="delete"{
            let role:String=c.query_row("SELECT u.role FROM local_users u JOIN local_session s ON s.user_id=u.id WHERE s.id=1",[],|r|r.get(0)).map_err(|e|e.to_string())?;
            if role!="admin"{return Err("Only administrators may delete suppliers".into())}
        }
    }Ok(())
}
fn read(c:&Connection,kind:&str)->Result<Vec<Value>,String>{
    fields(kind)?;
    let raw:Option<String>=c.query_row("SELECT value FROM sync_state WHERE key=?1",[local_db::scoped_state_key(c,&format!("catalog_{kind}"))?],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
    match raw{Some(s)=>serde_json::from_str(&s).map_err(|e|e.to_string()),None=>Ok(vec![])}
}
fn write(c:&Connection,kind:&str,rows:&[Value])->Result<(),String>{
    c.execute("INSERT INTO sync_state(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![local_db::scoped_state_key(c,&format!("catalog_{kind}"))?,serde_json::to_string(rows).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;Ok(())
}
fn validate(kind:&str,record:&mut Value)->Result<(),String>{
    for field in fields(kind)?{
        let value=&record[*field];
        if *field=="capacity"{
            if value.is_null(){continue}
            let n=if let Some(s)=value.as_str(){s.parse::<f64>().map_err(|_|"Invalid capacity")?}else{value.as_f64().ok_or("Invalid capacity")?};
            if !n.is_finite()||n<0.0{return Err("Capacity must be nonnegative".into())}record[*field]=json!(n);
        }else{
            let required=*field=="name"||*field=="container_type"||kind=="supplier"&&*field=="notes";
            if value.is_null(){if required{return Err(format!("{field} is required"))}continue}
            let s=value.as_str().ok_or("Invalid catalog text")?;
            if s.encode_utf16().count()>if *field=="notes"{10000}else{1000}{return Err(format!("{field} is too long"))}
            let s=if *field=="notes"{s}else{s.trim()};
            if (*field=="name"||*field=="container_type")&&s.is_empty(){return Err(format!("{field} is required"))}record[*field]=json!(s);
        }
    }Ok(())
}
fn mutate(c:&mut Connection,account:&str,kind:&str,op:&str,id:Option<&str>,patch:Value,expected:Option<i64>,change:&str)->Result<Value,String>{
    if !["create","update","delete"].contains(&op){return Err("Invalid catalog operation".into())}
    let id=match id{Some(s)=>uuid(s)?,None if op=="create"=>local_db::new_uuid(),_=>return Err("Catalog ID required".into())};
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
    authorize(&tx,account,kind,op)?;
    let mut rows=read(&tx,kind)?;
    let existing=rows.iter().find(|r|r["id"]==id).cloned();
    if op=="create"&&existing.is_some(){return Err("Catalog ID already exists".into())}
    if op!="create"{
        let old=existing.as_ref().ok_or("Catalog record not found")?;
        if expected.is_none()||old["sync_version"].as_i64()!=expected{return Err("Catalog changed locally. Refresh before saving.".into())}
    }
    let version=existing.as_ref().and_then(|r|r["sync_version"].as_i64()).unwrap_or(0);
    let mut record=existing.unwrap_or_else(||if kind=="supplier"{json!({"id":id,"notes":"","created_by":account,"item_count":0})}else{json!({"id":id,"container_type":"box","created_by":account,"item_count":0})});
    if op!="delete"{
        let patch=patch.as_object().ok_or("Catalog patch must be an object")?;
        for field in fields(kind)?{if let Some(v)=patch.get(*field){record[*field]=v.clone();}}
        validate(kind,&mut record)?;
        let now:String=tx.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')",[],|r|r.get(0)).map_err(|e|e.to_string())?;
        if op=="create"{record["created_at"]=json!(now);}record["updated_at"]=json!(now);record["sync_version"]=json!(version+1);
    }
    if op=="delete"&&kind=="storage_container"{
        let raw:Option<String>=tx.query_row("SELECT value FROM sync_state WHERE key=?1",[local_db::scoped_state_key(&tx,"inventory_snapshot")?],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
        let items:Vec<Value>=serde_json::from_str(&raw.ok_or("Download inventory before deleting a container")?).map_err(|e|e.to_string())?;
        if items.iter().any(|i|i["storage_container_id"]==id){return Err("Move linked items before deleting this container".into())}
    }
    let previous:Option<String>=tx.query_row("SELECT change_id FROM sync_outbox WHERE account_id=?1 AND entity_type=?2 AND entity_id=?3 AND synced_at IS NULL ORDER BY rowid DESC LIMIT 1",params![account,kind,id],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
    rows.retain(|r|r["id"]!=id);if op!="delete"{rows.push(record.clone());}write(&tx,kind,&rows)?;
    let device:String=tx.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    let payload=json!({"record":record,"expected_version":version,"depends_on":previous});
    tx.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,?3,?4,?5,?6)",params![change,device,kind,id,op,payload.to_string()]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e|e.to_string())?;Ok(if op=="delete"{json!({"id":id,"deleted":true,"success":true})}else{record})
}
fn pull(c:&mut Connection,account:&str,kind:&str,mut incoming:Vec<Value>,complete:bool)->Result<(),String>{
    if !complete{return Err("Catalog snapshot is not complete".into())}
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;authorize(&tx,account,kind,"read")?;
    for record in &mut incoming{
        record["id"]=json!(uuid(record["id"].as_str().ok_or("Catalog ID missing")?)?);
        if record["sync_version"].as_i64().unwrap_or(0)<1{return Err("Catalog version missing".into())}validate(kind,record)?;
    }
    let pending:std::collections::HashSet<String>=tx.prepare("SELECT entity_id FROM active_sync_outbox WHERE entity_type=?1 AND synced_at IS NULL").map_err(|e|e.to_string())?.query_map([kind],|r|r.get(0)).map_err(|e|e.to_string())?.collect::<Result<_,_>>().map_err(|e|e.to_string())?;
    let mut rows=read(&tx,kind)?;local_db::retain_authorized_snapshot(&mut rows,&incoming,&pending);
    for record in incoming{if pending.contains(record["id"].as_str().unwrap()){continue}rows.retain(|r|r["id"]!=record["id"]);rows.push(record);}
    write(&tx,kind,&rows)?;tx.commit().map_err(|e|e.to_string())
}
#[tauri::command]
pub fn list_local_catalog(app:AppHandle,kind:String,expected_account_id:String)->Result<Vec<Value>,String>{let c=local_db::open_local_connection(&app)?;authorize(&c,&expected_account_id,&kind,"read")?;read(&c,&kind)}
#[tauri::command]
pub fn mutate_local_catalog(app:AppHandle,kind:String,operation:String,id:Option<String>,record:Value,expected_version:Option<i64>,expected_account_id:String)->Result<Value,String>{mutate(&mut local_db::open_local_connection(&app)?,&expected_account_id,&kind,&operation,id.as_deref(),record,expected_version,&local_db::new_uuid())}
#[tauri::command]
pub fn apply_server_catalog_pull(app:AppHandle,kind:String,records:Vec<Value>,snapshot_complete:bool,expected_account_id:String)->Result<(),String>{pull(&mut local_db::open_local_connection(&app)?,&expected_account_id,&kind,records,snapshot_complete)}

#[cfg(test)]
#[path="local_catalog_test.rs"]
mod tests;
