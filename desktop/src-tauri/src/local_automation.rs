use rusqlite::{params,Connection,OptionalExtension,TransactionBehavior};
use serde_json::{json,Value};
use tauri::AppHandle;
use crate::{local_auth,local_db};

fn pending(c:&Connection)->Result<Vec<Value>,String>{
 let mut stmt=c.prepare("SELECT o.change_id,o.entity_id,o.created_at,o.last_error,c.error_code FROM active_sync_outbox o LEFT JOIN sync_conflicts c ON c.change_id=o.change_id AND c.resolved_at IS NULL WHERE o.entity_type='automation_run' AND o.synced_at IS NULL ORDER BY o.created_at").map_err(|e|e.to_string())?;
 let rows=stmt.query_map([],|r|Ok(json!({"change_id":r.get::<_,String>(0)?,"run_id":r.get::<_,String>(1)?,"requested_at":r.get::<_,String>(2)?,"last_error":r.get::<_,Option<String>>(3)?,"conflict":r.get::<_,Option<String>>(4)?,"queued":true,"executed":false}))).map_err(|e|e.to_string())?;
 rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())
}
fn queue(c:&mut Connection,account:&str)->Result<Value,String>{
 let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
 local_db::require_sync_account(&tx,account)?;local_auth::require_local_permission(&tx,"automation.run")?;
 let existing=pending(&tx)?;
 if let Some(row)=existing.first(){return Ok(row.clone())}
 let run=local_db::new_uuid();
 let device:String=tx.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).map_err(|e|e.to_string())?;
 tx.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,'automation_run',?1,'run',?3)",params![run,device,json!({"run_id":run}).to_string()]).map_err(|e|e.to_string())?;
 tx.commit().map_err(|e|e.to_string())?;Ok(json!({"run_id":run,"queued":true,"executed":false}))
}
fn acknowledge(c:&mut Connection,account:&str,token:&str,change:&str,result:Value)->Result<(),String>{
 let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
 local_db::require_sync_account(&tx,account)?;local_auth::require_local_permission(&tx,"automation.run")?;
 let actual:String=tx.query_row("SELECT session_token FROM local_session WHERE id=1",[],|r|r.get(0)).map_err(|e|e.to_string())?;
 if actual!=token{return Err("Native automation session changed".into())}
 let run:Option<String>=tx.query_row("SELECT entity_id FROM active_sync_outbox WHERE change_id=?1 AND entity_type='automation_run' AND synced_at IS NULL",[change],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
 let run=run.ok_or("Pending automation run unavailable")?;
 if result["run_id"].as_str()!=Some(run.as_str())||result["executed"]!=true||result["created"].as_u64().is_none(){return Err("Invalid automation confirmation".into())}
 // Confirmation and ACK must commit together; a failure leaves the same run retryable.
 tx.execute("INSERT INTO sync_state(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![local_db::scoped_state_key(&tx,"automation_confirmation")?,result.to_string()]).map_err(|e|e.to_string())?;
 tx.execute("UPDATE sync_outbox SET synced_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),last_error=NULL WHERE change_id=?1",[change]).map_err(|e|e.to_string())?;
 tx.commit().map_err(|e|e.to_string())
}
#[tauri::command]
pub fn queue_local_automation_run(app:AppHandle,expected_account_id:String)->Result<Value,String>{queue(&mut local_db::open_local_connection(&app)?,&expected_account_id)}
#[tauri::command]
pub fn get_local_automation_state(app:AppHandle,expected_account_id:String)->Result<Value,String>{
 let c=local_db::open_local_connection(&app)?;local_db::require_sync_account(&c,&expected_account_id)?;local_auth::require_local_permission(&c,"automation.view")?;
 let confirmation:Option<String>=c.query_row("SELECT value FROM sync_state WHERE key=?1",[local_db::scoped_state_key(&c,"automation_confirmation")?],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
 Ok(json!({"pending":pending(&c)?,"last_confirmation":confirmation.map(|s|serde_json::from_str::<Value>(&s)).transpose().map_err(|e|e.to_string())?}))
}
#[tauri::command]
pub fn acknowledge_local_automation_run(app:AppHandle,expected_account_id:String,expected_session_token:String,change_id:String,result:Value)->Result<(),String>{acknowledge(&mut local_db::open_local_connection(&app)?,&expected_account_id,&expected_session_token,&change_id,result)}

#[cfg(test)]
mod tests{
 use super::*;
 #[test]
 fn intent_deduplicates_and_confirmation_ack_is_atomic_and_session_bound(){
  let path=std::env::temp_dir().join(format!("labos-automation-test-{}.sqlite",local_db::new_uuid()));
  let mut c=Connection::open(&path).unwrap();local_db::ensure_schema(&c).unwrap();
  c.execute_batch("CREATE TABLE local_users(id TEXT PRIMARY KEY,central_user_id TEXT,is_active INTEGER,offline_expires_at TEXT,permissions_json TEXT);CREATE TABLE local_session(id INTEGER PRIMARY KEY,user_id TEXT,session_token TEXT);INSERT INTO local_users VALUES('a','account-a',1,datetime('now','+24 hours'),'[\"automation.view\",\"automation.run\"]');INSERT INTO local_session VALUES(1,'a','token');").unwrap();
  let first=queue(&mut c,"account-a").unwrap();drop(c);let mut c=Connection::open(&path).unwrap();assert_eq!(queue(&mut c,"account-a").unwrap()["run_id"],first["run_id"]);
  assert!(queue(&mut c,"account-b").is_err());
  let id=first["run_id"].as_str().unwrap();let result=json!({"run_id":id,"created":2,"executed":true});
  assert!(acknowledge(&mut c,"account-a","stale",id,result.clone()).is_err());
  assert!(acknowledge(&mut c,"account-a","token",id,json!({"run_id":id,"executed":true,"created":-1})).is_err());
  c.execute_batch("CREATE TRIGGER fail_confirmation BEFORE INSERT ON sync_state BEGIN SELECT RAISE(ABORT,'injected'); END;").unwrap();
  assert!(acknowledge(&mut c,"account-a","token",id,result.clone()).is_err());assert_eq!(pending(&c).unwrap().len(),1);
  c.execute_batch("DROP TRIGGER fail_confirmation;").unwrap();acknowledge(&mut c,"account-a","token",id,result).unwrap();assert!(pending(&c).unwrap().is_empty());
  c.execute("UPDATE local_users SET permissions_json='[\"automation.view\"]'",[]).unwrap();assert!(queue(&mut c,"account-a").is_err());
  c.execute("UPDATE local_users SET permissions_json='[\"automation.run\"]',offline_expires_at=datetime('now','-1 hour')",[]).unwrap();assert!(queue(&mut c,"account-a").is_err());
  drop(c);std::fs::remove_file(path).unwrap();
 }
}
