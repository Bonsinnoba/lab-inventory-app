use rusqlite::{params,Connection,OptionalExtension,TransactionBehavior};
use serde_json::{json,Value};
use tauri::AppHandle;
use crate::local_db;
const KEY:&str="notifications_state";

#[cfg(test)]
#[path="local_notifications_live_test.rs"]
mod live_tests;
fn read(c:&Connection)->Result<Vec<Value>,String>{
    let raw:Option<String>=c.query_row("SELECT value FROM sync_state WHERE key=?1",[local_db::scoped_state_key(c,KEY)?],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
    match raw{Some(s)=>serde_json::from_str(&s).map_err(|e|e.to_string()),None=>Ok(vec![])}
}
fn write(c:&Connection,rows:&[Value])->Result<(),String>{
    c.execute("INSERT INTO sync_state(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![local_db::scoped_state_key(c,KEY)?,serde_json::to_string(rows).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;Ok(())
}
fn mark(c:&mut Connection,account:&str,ids:Vec<String>,change:&str)->Result<Value,String>{
    if ids.is_empty()||ids.len()>1000{return Err("Provide 1–1000 notification IDs".into())}
    let ids:std::collections::HashSet<String>=ids.iter().map(|id|uuid::Uuid::parse_str(id).map(|u|u.to_string()).map_err(|_|"Invalid notification UUID")).collect::<Result<_,_>>()?;
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
    local_db::require_sync_account(&tx,account)?;
    let mut rows=read(&tx)?;
    if !ids.iter().all(|id|rows.iter().any(|r|r["id"]==*id)){return Err("Notification is unavailable for this account".into())}
    let now:String=tx.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    let mut changed=vec![];
    for row in &mut rows{if ids.contains(row["id"].as_str().unwrap_or(""))&&row["read_at"].is_null(){changed.push(row["id"].as_str().unwrap().to_string());row["read_at"]=json!(now);}}
    changed.sort();
    if !changed.is_empty(){
        write(&tx,&rows)?;
        let device:String=tx.query_row("SELECT device_id FROM device_identity",[],|r|r.get(0)).map_err(|e|e.to_string())?;
        tx.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,'notification_read',?3,'update',?4)",params![change,device,account,json!({"ids":changed}).to_string()]).map_err(|e|e.to_string())?;
    }
    tx.commit().map_err(|e|e.to_string())?;Ok(json!({"ok":true,"updated":changed.len()}))
}
fn pull(c:&mut Connection,account:&str,mut incoming:Vec<Value>,complete:bool)->Result<(),String>{
    if !complete{return Err("Notification snapshot is incomplete".into())}
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;local_db::require_sync_account(&tx,account)?;
    let mut pending=std::collections::HashSet::new();
    let mut stmt=tx.prepare("SELECT payload_json FROM active_sync_outbox WHERE entity_type='notification_read' AND synced_at IS NULL").map_err(|e|e.to_string())?;
    for row in stmt.query_map([],|r|r.get::<_,String>(0)).map_err(|e|e.to_string())?{
        let payload:Value=serde_json::from_str(&row.map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
        for id in payload["ids"].as_array().ok_or("Invalid queued notification IDs")?{pending.insert(id.as_str().ok_or("Invalid queued ID")?.to_string());}
    }drop(stmt);
    let old=read(&tx)?;let mut unique=std::collections::HashSet::new();
    for row in &mut incoming{
        let id=uuid::Uuid::parse_str(row["id"].as_str().ok_or("Notification ID missing")?).map_err(|e|e.to_string())?.to_string();
        row["id"]=json!(id);
        if pending.contains(&id)&&row["read_at"].is_null(){if let Some(prior)=old.iter().find(|r|r["id"]==id){row["read_at"]=prior["read_at"].clone();}}
    }
    incoming.retain(|r|unique.insert(r["id"].as_str().unwrap().to_string()));
    // Removed/revoked notification content is evicted even with pending read IDs.
    // The outbox retains only the author's acknowledgement IDs, not hidden text.
    write(&tx,&incoming)?;tx.commit().map_err(|e|e.to_string())
}
#[tauri::command]
pub fn list_local_notifications(app:AppHandle,expected_account_id:String)->Result<Vec<Value>,String>{let c=local_db::open_local_connection(&app)?;local_db::require_sync_account(&c,&expected_account_id)?;read(&c)}
#[tauri::command]
pub fn mark_local_notifications_read(app:AppHandle,ids:Vec<String>,expected_account_id:String)->Result<Value,String>{mark(&mut local_db::open_local_connection(&app)?,&expected_account_id,ids,&local_db::new_uuid())}
#[tauri::command]
pub fn apply_server_notifications_pull(app:AppHandle,records:Vec<Value>,snapshot_complete:bool,expected_account_id:String)->Result<(),String>{pull(&mut local_db::open_local_connection(&app)?,&expected_account_id,records,snapshot_complete)}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn notification_read_atomic_frozen_ids_pending_pull_revocation_and_account(){
        let mut c=Connection::open_in_memory().unwrap();local_db::ensure_schema(&c).unwrap();
        c.execute_batch("CREATE TABLE local_users(id TEXT PRIMARY KEY,central_user_id TEXT,is_active INTEGER,offline_expires_at TEXT);CREATE TABLE local_session(id INTEGER PRIMARY KEY,user_id TEXT);INSERT INTO local_users VALUES('a','account-a',1,datetime('now','+24 hours'));INSERT INTO local_session VALUES(1,'a');").unwrap();
        let a=local_db::new_uuid();let b=local_db::new_uuid();
        let first=json!({"id":a,"body":"visible","read_at":null});let second=json!({"id":b,"body":"later","read_at":null});
        pull(&mut c,"account-a",vec![first.clone(),second.clone()],true).unwrap();
        mark(&mut c,"account-a",vec![a.clone()],"one").unwrap();
        assert!(mark(&mut c,"account-a",vec![b.clone()],"one").is_err());assert!(read(&c).unwrap()[1]["read_at"].is_null());
        pull(&mut c,"account-a",vec![first,second.clone()],true).unwrap();assert!(!read(&c).unwrap()[0]["read_at"].is_null());
        assert!(mark(&mut c,"account-b",vec![b],"foreign").is_err());
        assert!(pull(&mut c,"account-a",vec![],false).is_err());
        pull(&mut c,"account-a",vec![second],true).unwrap();assert_eq!(read(&c).unwrap().len(),1);
        assert_eq!(c.query_row("SELECT COUNT(*) FROM sync_outbox WHERE synced_at IS NULL",[],|r|r.get::<_,i64>(0)).unwrap(),1);
    }
}
