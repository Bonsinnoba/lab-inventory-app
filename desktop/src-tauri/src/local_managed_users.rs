use crate::{local_auth,local_db,native_authorization};
use rusqlite::{params,Connection,OptionalExtension,TransactionBehavior};
use serde::{Deserialize,Serialize};
use tauri::AppHandle;

#[derive(Clone,Deserialize,Serialize)]
pub(crate) struct ManagedUser {
 id:String, username:String, role:String, is_active:bool,
 last_login_at:Option<String>, created_at:String,
 management_etag:Option<String>,
}
fn validate(rows:&[ManagedUser])->Result<(),String>{
 if rows.len()>10000{return Err("Managed-user directory exceeds the supported size".into())}
 let mut seen=std::collections::HashSet::new();
 for row in rows{
  let id=uuid::Uuid::parse_str(&row.id).map_err(|_|"Invalid directory account identity")?;
  if !seen.insert(id)||row.username.trim().is_empty()||row.username.len()>256||row.created_at.is_empty()||!matches!(row.role.as_str(),"admin"|"member"|"researcher"|"technician"|"viewer"){return Err("Invalid managed-user directory".into())}
 }Ok(())
}
fn guard(c:&Connection,account:&str,token:Option<&str>)->Result<(),String>{
 guard_for(c,account,token,"users.view")
}
fn guard_for(c:&Connection,account:&str,token:Option<&str>,permission:&str)->Result<(),String>{
 local_db::require_sync_account(c,account)?;local_auth::require_local_permission(c,permission)?;
 if let Some(token)=token{
  let current:String=c.query_row("SELECT session_token FROM local_session WHERE id=1",[],|r|r.get(0)).map_err(|e|e.to_string())?;
  if current!=token||token.starts_with("local:"){return Err("Directory refresh requires the current online session".into())}
 }Ok(())
}
fn read(c:&Connection,account:&str)->Result<Vec<ManagedUser>,String>{
 guard(c,account,None)?;
 let raw:Option<String>=c.query_row("SELECT value FROM sync_state WHERE key=?1",[local_db::scoped_state_key(c,"managed_users")?],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
 let rows:Vec<ManagedUser>=serde_json::from_str(&raw.ok_or("No managed-user directory has been synchronized on this PC")?).map_err(|_|"Invalid cached user directory")?;
 validate(&rows)?;Ok(rows)
}
fn save(c:&mut Connection,account:&str,token:&str,rows:&[ManagedUser])->Result<(),String>{
 validate(rows)?;let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;guard(&tx,account,Some(token))?;
 tx.execute("INSERT INTO sync_state(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![local_db::scoped_state_key(&tx,"managed_users")?,serde_json::to_string(rows).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
 tx.commit().map_err(|e|e.to_string())
}
async fn server_authority(app:&AppHandle,account:&str,token:&str,authorization_guard:&str,permission:&str,cache_key:&str)->Result<(),String>{
 let authority=native_authorization::permissions(token,account).await;
 if authority.as_ref().err().is_some_and(|e|e.code=="AUTH_REVOKED"){
  local_auth::invalidate_authorization(&mut local_db::open_local_connection(app)?,account,authorization_guard)?;
  return Err("AUTH_REVOKED: Cached access was revoked; sign in again online".into())
 }
 let denied=authority.as_ref().map(|a|!a.permissions.iter().any(|p|p==permission)).unwrap_or_else(|e|e.code=="AUTH_REVOKED");
 if denied{
  let mut c=local_db::open_local_connection(app)?;let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
  guard_for(&tx,account,Some(authorization_guard),permission)?;
  // Observed privilege loss must also stop reads of OTHER cached target
  // profiles and late in-flight cache publications. Reuse the native verified
  // permission-refresh boundary; it never extends the password-login lease.
  if let Ok(verified)=authority.as_ref(){local_auth::refresh_permissions(&tx,&verified.user.id,&verified.user.role,&verified.permissions,authorization_guard)?;}
  tx.execute("DELETE FROM sync_state WHERE key=?1",[local_db::scoped_state_key(&tx,cache_key)?]).map_err(|e|e.to_string())?;tx.commit().map_err(|e|e.to_string())?;
  return Err("Managed-user directory access was revoked".into())
 }
 authority.map(|_|()).map_err(|e|e.message.to_string())
}
#[tauri::command]
pub fn get_local_managed_users(app:AppHandle,expected_account_id:String)->Result<Vec<ManagedUser>,String>{read(&local_db::open_local_connection(&app)?,&expected_account_id)}
#[tauri::command]
pub async fn refresh_native_managed_users(app:AppHandle,expected_account_id:String,expected_session_token:String,server_token:String)->Result<(),String>{
 if server_token.is_empty()||server_token.starts_with("local:"){return Err("Online credentials required for directory refresh".into())}
 {let c=local_db::open_local_connection(&app)?;guard(&c,&expected_account_id,Some(&expected_session_token))?;}
 let authorization_guard=local_auth::local_authorization_guard(app.clone(),expected_account_id.clone())?.ok_or("Directory authorization is unavailable")?;
 if authorization_guard!=expected_session_token{return Err("Native directory session changed".into())}
 server_authority(&app,&expected_account_id,&server_token,&authorization_guard,"users.view","managed_users").await?;
 let response=native_authorization::client().map_err(|e|e.message)?.get(format!("{}/auth/users",native_authorization::trusted_base().map_err(|e|e.message)?)).bearer_auth(&server_token).send().await.map_err(|_|"Managed-user refresh is unavailable; cached data is preserved")?;
 let rows=native_authorization::response_json::<Vec<ManagedUser>>(response).await;
 server_authority(&app,&expected_account_id,&server_token,&authorization_guard,"users.view","managed_users").await?;
 let rows=rows.map_err(|e|e.message)?;
 save(&mut local_db::open_local_connection(&app)?,&expected_account_id,&expected_session_token,&rows)
}

#[derive(Deserialize,Serialize)] pub(crate) struct TargetUser {id:String,username:String,role:String,management_etag:Option<String>}
#[derive(Deserialize,Serialize)] pub(crate) struct PermissionEntry {permission:String,baseline:bool,effect:String,effective:bool}
#[derive(Deserialize,Serialize)] pub(crate) struct PermissionProfile {user:TargetUser,permissions:Vec<PermissionEntry>}
fn profile_key(target:&str)->Result<String,String>{Ok(format!("managed_user_permissions_{}",uuid::Uuid::parse_str(target).map_err(|_|"Invalid target user UUID")?))}
fn validate_profile(profile:&PermissionProfile,target:&str)->Result<(),String>{
 if uuid::Uuid::parse_str(&profile.user.id).ok()!=uuid::Uuid::parse_str(target).ok()||uuid::Uuid::parse_str(target).is_err()||profile.user.username.trim().is_empty()||profile.user.username.len()>256||!matches!(profile.user.role.as_str(),"admin"|"member"|"researcher"|"technician"|"viewer")||profile.permissions.len()>1000{return Err("Invalid target permission profile".into())}
 let mut names=std::collections::HashSet::new();for entry in &profile.permissions{if entry.permission.is_empty()||entry.permission.len()>128||!names.insert(&entry.permission)||!matches!(entry.effect.as_str(),"inherited"|"grant"|"deny"){return Err("Invalid target permission entry".into())}}Ok(())
}
fn read_profile(c:&Connection,account:&str,target:&str)->Result<PermissionProfile,String>{
 guard_for(c,account,None,"users.manage_permissions")?;
 let raw:Option<String>=c.query_row("SELECT value FROM sync_state WHERE key=?1",[local_db::scoped_state_key(c,&profile_key(target)?)?],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
 let profile:PermissionProfile=serde_json::from_str(&raw.ok_or("This permission profile has not been synchronized on this PC")?).map_err(|_|"Invalid cached permission profile")?;validate_profile(&profile,target)?;Ok(profile)
}
fn save_profile(c:&mut Connection,account:&str,token:&str,target:&str,profile:&PermissionProfile)->Result<(),String>{
 validate_profile(profile,target)?;let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;guard_for(&tx,account,Some(token),"users.manage_permissions")?;
 tx.execute("INSERT INTO sync_state(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![local_db::scoped_state_key(&tx,&profile_key(target)?)?,serde_json::to_string(profile).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;tx.commit().map_err(|e|e.to_string())
}
#[tauri::command]
pub fn get_local_user_permission_profile(app:AppHandle,expected_account_id:String,target_user_id:String)->Result<PermissionProfile,String>{read_profile(&local_db::open_local_connection(&app)?,&expected_account_id,&target_user_id)}
#[tauri::command]
pub async fn refresh_native_user_permission_profile(app:AppHandle,expected_account_id:String,target_user_id:String,expected_session_token:String,server_token:String)->Result<(),String>{
 if server_token.is_empty()||server_token.starts_with("local:"){return Err("Online credentials required for permission refresh".into())}
 let key=profile_key(&target_user_id)?;let target=uuid::Uuid::parse_str(&target_user_id).map_err(|_|"Invalid target UUID")?.to_string();
 {let c=local_db::open_local_connection(&app)?;guard_for(&c,&expected_account_id,Some(&expected_session_token),"users.manage_permissions")?;}
 let authority_guard=local_auth::local_authorization_guard(app.clone(),expected_account_id.clone())?.ok_or("Permission profile authorization unavailable")?;
 if authority_guard!=expected_session_token{return Err("Native permission session changed".into())}
 server_authority(&app,&expected_account_id,&server_token,&authority_guard,"users.manage_permissions",&key).await?;
 let response=native_authorization::client().map_err(|e|e.message)?.get(format!("{}/auth/users/{target}/permissions",native_authorization::trusted_base().map_err(|e|e.message)?)).bearer_auth(&server_token).send().await.map_err(|_|"Permission profile refresh unavailable; cached data preserved")?;
 let status=response.status();let profile=native_authorization::response_json::<PermissionProfile>(response).await;
 server_authority(&app,&expected_account_id,&server_token,&authority_guard,"users.manage_permissions",&key).await?;
 if matches!(status.as_u16(),403|404){let mut c=local_db::open_local_connection(&app)?;let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;guard_for(&tx,&expected_account_id,Some(&expected_session_token),"users.manage_permissions")?;tx.execute("DELETE FROM sync_state WHERE key=?1",[local_db::scoped_state_key(&tx,&key)?]).map_err(|e|e.to_string())?;tx.commit().map_err(|e|e.to_string())?;}
 let profile=profile.map_err(|e|e.message)?;
 save_profile(&mut local_db::open_local_connection(&app)?,&expected_account_id,&expected_session_token,&target,&profile)
}

#[cfg(test)] mod tests {
 use super::*;
 fn fixture()->Connection{let c=Connection::open_in_memory().unwrap();local_db::ensure_schema(&c).unwrap();c.execute_batch("CREATE TABLE local_users(id TEXT PRIMARY KEY,central_user_id TEXT,role TEXT,is_active INTEGER,offline_expires_at TEXT,permissions_json TEXT);CREATE TABLE local_session(id INTEGER PRIMARY KEY,user_id TEXT,session_token TEXT);INSERT INTO local_users VALUES('local','account','admin',1,datetime('now','+1 hour'),'[\"users.view\"]');INSERT INTO local_session VALUES(1,'local','online-token');").unwrap();c}
 #[test] fn cache_is_scoped_sanitized_and_denied_after_permission_loss(){let mut c=fixture();let rows:Vec<ManagedUser>=serde_json::from_value(serde_json::json!([{"id":uuid::Uuid::new_v4().to_string(),"username":"Reader","role":"member","is_active":true,"created_at":"2026-11-06","password_hash":"must-not-persist"}])).unwrap();save(&mut c,"account","online-token",&rows).unwrap();let raw:String=c.query_row("SELECT value FROM sync_state WHERE key=?1",[local_db::scoped_state_key(&c,"managed_users").unwrap()],|r|r.get(0)).unwrap();assert!(!raw.contains("password_hash"));assert_eq!(read(&c,"account").unwrap().len(),1);assert!(read(&c,"other").is_err());assert!(save(&mut c,"account","stale-token",&rows).is_err());c.execute("UPDATE local_users SET permissions_json='[]'",[]).unwrap();assert!(read(&c,"account").is_err());}
 #[test] fn missing_is_not_empty_and_invalid_refresh_preserves_cache(){let mut c=fixture();assert!(read(&c,"account").is_err());save(&mut c,"account","online-token",&[]).unwrap();assert!(read(&c,"account").unwrap().is_empty());let bad:Vec<ManagedUser>=serde_json::from_value(serde_json::json!([{"id":"invalid","username":"x","role":"admin","is_active":true,"created_at":"now"}])).unwrap();assert!(save(&mut c,"account","online-token",&bad).is_err());assert!(read(&c,"account").unwrap().is_empty());}
 #[test] fn verified_privilege_loss_blocks_other_cached_profiles_and_late_writes_without_lease_renewal(){
  let mut c=fixture();c.execute("UPDATE local_users SET permissions_json='[\"users.view\",\"users.manage_permissions\"]'",[]).unwrap();
  let target=uuid::Uuid::new_v4().to_string();let profile:PermissionProfile=serde_json::from_value(serde_json::json!({"user":{"id":target,"username":"Target","role":"member"},"permissions":[]})).unwrap();save_profile(&mut c,"account","online-token",&target,&profile).unwrap();
  let expiry:String=c.query_row("SELECT offline_expires_at FROM local_users",[],|r|r.get(0)).unwrap();
  local_auth::refresh_permissions(&c,"account","member",&["users.view".into()],"online-token").unwrap();
  assert!(read_profile(&c,"account",&target).is_err());assert!(save_profile(&mut c,"account","online-token",&target,&profile).is_err());
  assert_eq!(c.query_row("SELECT offline_expires_at FROM local_users",[],|r|r.get::<_,String>(0)).unwrap(),expiry);
 }
 #[test] fn target_profiles_do_not_grant_authority_and_require_current_permission(){let mut c=fixture();c.execute("UPDATE local_users SET permissions_json='[\"users.manage_permissions\"]'",[]).unwrap();let target=uuid::Uuid::new_v4().to_string();let profile:PermissionProfile=serde_json::from_value(serde_json::json!({"user":{"id":target,"username":"Target","role":"admin","password_hash":"secret"},"permissions":[{"permission":"finance.view","baseline":true,"effect":"inherited","effective":true}]})).unwrap();assert!(read_profile(&c,"account",&target).is_err());save_profile(&mut c,"account","online-token",&target,&profile).unwrap();assert_eq!(read_profile(&c,"account",&target.to_uppercase()).unwrap().user.id,target);assert!(local_auth::require_local_permission(&c,"finance.view").is_err());assert!(save_profile(&mut c,"account","stale-token",&target,&profile).is_err());assert!(save_profile(&mut c,"account","online-token",&uuid::Uuid::new_v4().to_string(),&profile).is_err());assert!(read_profile(&c,"other",&target).is_err());let raw:String=c.query_row("SELECT value FROM sync_state WHERE key=?1",[local_db::scoped_state_key(&c,&profile_key(&target).unwrap()).unwrap()],|r|r.get(0)).unwrap();assert!(!raw.contains("password_hash"));c.execute("UPDATE local_users SET permissions_json='[]'",[]).unwrap();assert!(read_profile(&c,"account",&target).is_err());}
}
