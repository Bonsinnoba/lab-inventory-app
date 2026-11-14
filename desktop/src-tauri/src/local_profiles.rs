use crate::{local_db,local_auth,native_authorization};
use rusqlite::{params,Connection,OptionalExtension,TransactionBehavior};
use serde::Deserialize;
use serde_json::{json,Value};
use tauri::AppHandle;
fn fields(value:&Value)->Result<Value,String>{
 let row=value.as_object().ok_or("Contact profile required")?;if row.keys().any(|k|!["display_name","email"].contains(&k.as_str())){return Err("Only display name and contact email may change".into())}
 let display=match &value["display_name"]{Value::Null=>None,Value::String(s) if s.chars().count()<=120=>Some(s.trim()).filter(|s|!s.is_empty()),_=>return Err("Display name must be at most 120 characters".into())};
 let email=match &value["email"]{Value::Null=>None,Value::String(s)=>Some(s.trim().to_lowercase()).filter(|s|!s.is_empty()),_=>return Err("Contact email must be text".into())};
 if email.as_ref().is_some_and(|s|s.len()>254||s.chars().any(char::is_whitespace)||!s.split_once('@').is_some_and(|(name,domain)|!name.is_empty()&&domain.contains('.')&&!domain.starts_with('.')&&!domain.ends_with('.'))){return Err("Invalid contact email".into())}
 Ok(json!({"display_name":display,"email":email}))
}
fn current(c:&Connection,account:&str)->Result<Value,String>{c.query_row("SELECT display_name,email FROM local_users WHERE central_user_id=?1",[account],|r|Ok(json!({"display_name":r.get::<_,Option<String>>(0)?,"email":r.get::<_,Option<String>>(1)?}))).map_err(|e|e.to_string())}
fn pending(c:&Connection,account:&str)->Result<bool,String>{let exists:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='sync_outbox')",[],|r|r.get(0)).map_err(|e|e.to_string())?;if !exists{return Ok(false)}c.query_row("SELECT EXISTS(SELECT 1 FROM sync_outbox WHERE account_id=?1 AND entity_type='account_profile' AND synced_at IS NULL)",[account],|r|r.get(0)).map_err(|e|e.to_string())}
// Called only by native verified login, before switching the active account.
// A new credential/lease publication must preserve already-authored contact edits.
pub(crate) fn preserve_pending(c:&Connection,account:&str,display:&mut Option<String>,email:&mut Option<String>)->Result<(),String>{
 if pending(c,account)?{let old:Option<(Option<String>,Option<String>)>=c.query_row("SELECT display_name,email FROM local_users WHERE central_user_id=?1",[account],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(|e|e.to_string())?;if let Some((d,e))=old{*display=d;*email=e;}}Ok(())
}
#[tauri::command]
pub fn update_local_account_profile(app:AppHandle,expected_account_id:String,expected_session_token:String,profile:Value,expected_before:Value)->Result<Value,String>{write(&mut local_db::open_local_connection(&app)?,&expected_account_id,&expected_session_token,&profile,&expected_before)}
fn write(c:&mut Connection,account:&str,session:&str,profile:&Value,expected:&Value)->Result<Value,String>{
 let profile=fields(profile)?;let expected=fields(expected)?;let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;guard(&tx,account,session)?;
 let old=current(&tx,account)?;if old==profile{return Ok(json!({"profile":profile,"pending_sync":pending(&tx,account)?}))}if old!=expected{return Err("Contact profile changed after this form opened. Your edits are preserved; review the current values.".into())}
 let blocked:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM sync_conflicts f JOIN active_sync_outbox o ON o.change_id=f.change_id WHERE o.entity_type='account_profile' AND f.resolved_at IS NULL)",[],|r|r.get(0)).map_err(|e|e.to_string())?;
 if blocked{return Err("Review the rejected contact-profile changes before saving another version".into())}
 let awaiting:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM sync_state WHERE key=?1)",[local_db::scoped_state_key(&tx,"account_profile_reconciliation")?],|r|r.get(0)).map_err(|e|e.to_string())?;if awaiting{return Err("Reconnect to verify your contact profile before saving another version".into())}
 let previous:Option<String>=tx.query_row("SELECT change_id FROM sync_outbox WHERE account_id=?1 AND entity_type='account_profile' AND synced_at IS NULL ORDER BY rowid DESC LIMIT 1",[account],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
 let change=local_db::new_uuid();let device:String=tx.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).map_err(|e|e.to_string())?;
 tx.execute("UPDATE local_users SET display_name=?1,email=?2 WHERE central_user_id=?3",params![profile["display_name"].as_str(),profile["email"].as_str(),account]).map_err(|e|e.to_string())?;
 tx.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,'account_profile',?3,'update',?4)",params![change,device,account,json!({"profile":profile,"expected_before":expected,"previous_change_id":previous}).to_string()]).map_err(|e|e.to_string())?;
 tx.commit().map_err(|e|e.to_string())?;Ok(json!({"profile":profile,"pending_sync":true}))
}
fn guard(c:&Connection,account:&str,session:&str)->Result<(),String>{local_db::require_sync_account(c,account)?;if local_auth::local_session_guard(c,account)?.as_deref()!=Some(session){return Err("Native profile session changed".into())}Ok(())}
#[derive(Deserialize)]struct Reply{user:native_authorization::ServerUser}
#[tauri::command]
pub async fn refresh_native_account_profile(app:AppHandle,expected_account_id:String,expected_session_token:String,server_token:String)->Result<Value,String>{
 if server_token.is_empty()||server_token.starts_with("local:"){return Err("Online contact-profile verification unavailable".into())}
 {let c=local_db::open_local_connection(&app)?;guard(&c,&expected_account_id,&expected_session_token)?;}
 let response=native_authorization::client().map_err(|e|e.message)?.get(format!("{}/auth/me",native_authorization::trusted_base().map_err(|e|e.message)?)).bearer_auth(server_token).send().await.map_err(|_|"Contact-profile server unavailable; local edits preserved")?;
 let reply:Reply=match native_authorization::response_json(response).await{Ok(r)=>r,Err(e)=>{if e.code=="AUTH_REVOKED"{local_auth::invalidate_authorization(&mut local_db::open_local_connection(&app)?,&expected_account_id,&expected_session_token)?;}return Err(format!("{}: {}",e.code,e.message))}};
 if reply.user.id!=expected_account_id{return Err("Contact-profile identity mismatch".into())}
 if reply.user.is_active==Some(false){local_auth::invalidate_authorization(&mut local_db::open_local_connection(&app)?,&expected_account_id,&expected_session_token)?;return Err("AUTH_REVOKED: Account disabled; contact edits preserved".into())}
 let profile=fields(&json!({"display_name":reply.user.display_name,"email":reply.user.email}))?;
 let mut c=local_db::open_local_connection(&app)?;let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;guard(&tx,&expected_account_id,&expected_session_token)?;
 tx.execute("INSERT INTO sync_state(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![local_db::scoped_state_key(&tx,"account_profile_verified")?,profile.to_string()]).map_err(|e|e.to_string())?;
 let has_pending=pending(&tx,&expected_account_id)?;
 if !has_pending{tx.execute("UPDATE local_users SET display_name=?1,email=?2 WHERE central_user_id=?3",params![profile["display_name"].as_str(),profile["email"].as_str(),expected_account_id]).map_err(|e|e.to_string())?;tx.execute("DELETE FROM sync_state WHERE key=?1",[local_db::scoped_state_key(&tx,"account_profile_reconciliation")?]).map_err(|e|e.to_string())?;}
 let result=json!({"profile":current(&tx,&expected_account_id)?,"pending_sync":has_pending});tx.commit().map_err(|e|e.to_string())?;Ok(result)
}
pub(crate) fn retire(c:&Connection,root:&str)->Result<(),String>{
 if c.is_autocommit(){return Err("Profile recovery requires an atomic transaction".into())}
 let account=local_db::active_account(c)?;let mut stmt=c.prepare("SELECT change_id,payload_json FROM active_sync_outbox WHERE entity_type='account_profile' AND synced_at IS NULL").map_err(|e|e.to_string())?;let rows=stmt.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
 let evidence=json!({"account_id":account,"root_change_id":root,"profile":current(c,&account)?,"intentions":rows});c.execute("INSERT INTO sync_state(key,value) VALUES(?1,?2)",params![local_db::scoped_state_key(c,&format!("account_profile_recovery_{}",local_db::new_uuid()))?,evidence.to_string()]).map_err(|e|e.to_string())?;
 c.execute("INSERT INTO sync_state(key,value) VALUES(?1,'pending') ON CONFLICT(key) DO UPDATE SET value=excluded.value",[local_db::scoped_state_key(c,"account_profile_reconciliation")?]).map_err(|e|e.to_string())?;
 for (id,_) in rows{c.execute("UPDATE sync_outbox SET synced_at=CURRENT_TIMESTAMP,last_error=NULL WHERE account_id=?1 AND change_id=?2",params![account,id]).map_err(|e|e.to_string())?;c.execute("UPDATE sync_conflicts SET resolved_at=CURRENT_TIMESTAMP,resolution='preserved_for_review' WHERE change_id=?1 AND resolved_at IS NULL",[id]).map_err(|e|e.to_string())?;}Ok(())
}
#[cfg(test)]#[path="local_profiles_test.rs"]mod tests;
