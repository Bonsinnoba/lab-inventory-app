//! Recovery reads owned immutable intentions, never restores grants or replays them.
use crate::{local_db,local_auth,local_resource_uploads,local_resource_export};
use rusqlite::{Connection,params};
use serde_json::{Value,json};
use tauri::AppHandle;
fn err(e:impl std::fmt::Display)->String{e.to_string()}
fn guard(c:&Connection,account:&str,session:Option<&str>)->Result<(),String>{
 local_db::require_sync_account(c,account)?;local_auth::require_local_permission(c,"resources.view")?;
 if let Some(session)=session{let actual:String=c.query_row("SELECT session_token FROM local_session WHERE id=1",[],|r|r.get(0)).map_err(err)?;if actual!=session{return Err("Recovery login changed".into())}}Ok(())
}
pub(crate) fn index(c:&Connection,account:&str)->Result<Value,String>{
 guard(c,account,None)?;crate::local_resource_edits::schema(c)?;crate::local_resource_attachments::schema(c)?;
 c.execute_batch("CREATE TABLE IF NOT EXISTS local_resource_recoveries(account_id TEXT NOT NULL,root_change_id TEXT NOT NULL,resolution TEXT NOT NULL,change_ids_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(account_id,root_change_id));").map_err(err)?;
 let mut stmt=c.prepare("SELECT o.change_id,o.entity_id,o.operation,o.payload_json,o.synced_at IS NULL,EXISTS(SELECT 1 FROM local_resource_uploads u WHERE u.account_id=o.account_id AND u.change_id=o.change_id AND u.state='ready' AND u.sha256=json_extract(o.payload_json,'$.upload.sha256')) OR EXISTS(SELECT 1 FROM local_resource_edits e JOIN local_resource_mutations m ON m.account_id=e.account_id AND m.change_id=e.change_id AND m.operation=o.operation AND m.payload_json=o.payload_json WHERE e.account_id=o.account_id AND e.change_id=o.change_id) FROM sync_outbox o WHERE o.account_id=?1 AND o.entity_type='resource' AND (o.synced_at IS NULL OR EXISTS(SELECT 1 FROM local_resource_recoveries r,json_each(r.change_ids_json) j WHERE r.account_id=o.account_id AND j.value=o.change_id)) ORDER BY o.rowid DESC LIMIT 501").map_err(err)?;
 let mut records=Vec::new();for row in stmt.query_map([account],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<String>>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,bool>(4)?,r.get::<_,bool>(5)?))).map_err(err)?{
  let (change,id,op,raw,pending,bytes)=row.map_err(err)?;let payload:Value=serde_json::from_str(&raw).map_err(err)?;
  let name=payload["resource"]["original_filename"].as_str().or(payload["resource"]["name"].as_str()).unwrap_or("Saved resource intention");
  records.push(json!({"change_id":change,"resource_id":id,"operation":op,"name":name,"pending":pending,"exportable":bytes&&payload["upload"]["sha256"].as_str().is_some(),"legacy_unverified":!bytes&&["create","create_copy","edit_content"].contains(&op.as_str())}));
 }let truncated=records.len()>500;records.truncate(500);Ok(json!({"records":records,"truncated":truncated,"legacy_policy":"Unverified or unattributed legacy work remains in owner recovery packages; it is never assigned or replayed automatically."}))
}
#[tauri::command]
pub fn list_local_resource_recovery(app:AppHandle,expected_account_id:String)->Result<Value,String>{index(&local_db::open_local_connection(&app)?,&expected_account_id)}
fn details(c:&Connection,account:&str,session:&str,change:&str)->Result<Value,String>{
 guard(c,account,Some(session))?;
 let (operation,raw):(String,String)=c.query_row("SELECT operation,payload_json FROM sync_outbox WHERE account_id=?1 AND change_id=?2 AND entity_type='resource'",params![account,change],|r|Ok((r.get(0)?,r.get(1)?))).map_err(err)?;let payload:Value=serde_json::from_str(&raw).map_err(err)?;
 let fields=payload.get("resource").or_else(||payload.get("metadata").and_then(|m|m.get("fields"))).or_else(||payload.get("record")).unwrap_or(&payload);
 let text=|key:&str,limit:usize|fields[key].as_str().map(|s|s.chars().take(limit).collect::<String>());
 let tags=fields["tags"].as_array().map(|rows|rows.iter().take(30).filter_map(|s|s.as_str().map(|s|s.chars().take(256).collect::<String>())).collect::<Vec<_>>());
 Ok(json!({"operation":operation,"name":text("name",512),"description":text("description",5000),"category":text("category",256),"tags":tags,"destination":payload["attachment"]["destination"].as_object().or(payload["tree_move"]["destination"].as_object()),"reviewed_members":payload["tree_move"]["members"].as_array().map(|m|m.len()),"source_id":payload["copy"]["source_id"].as_str(),"description_truncated":fields["description"].as_str().is_some_and(|s|s.chars().count()>5000)}))
}
#[tauri::command]
pub fn read_local_resource_recovery_details(app:AppHandle,expected_account_id:String,expected_session_token:String,change_id:String)->Result<Value,String>{details(&local_db::open_local_connection(&app)?,&expected_account_id,&expected_session_token,&change_id)}
fn version(c:&Connection,account:&str,session:&str,change:&str)->Result<(String,String,u64,String),String>{
 guard(c,account,Some(session))?;crate::local_resource_edits::schema(c)?;crate::local_resource_attachments::schema(c)?;
 let (id,raw,size):(String,String,i64)=c.query_row("SELECT o.entity_id,o.payload_json,COALESCE(e.size_bytes,u.size_bytes) FROM sync_outbox o LEFT JOIN local_resource_edits e ON e.account_id=o.account_id AND e.change_id=o.change_id LEFT JOIN local_resource_uploads u ON u.account_id=o.account_id AND u.change_id=o.change_id AND u.state='ready' WHERE o.account_id=?1 AND o.change_id=?2 AND o.entity_type='resource' AND o.operation IN ('create','create_copy','edit_content') AND ((u.resource_id=o.entity_id AND u.sha256=json_extract(o.payload_json,'$.upload.sha256')) OR (e.resource_id=o.entity_id AND EXISTS(SELECT 1 FROM local_resource_mutations m WHERE m.account_id=o.account_id AND m.change_id=o.change_id AND m.operation=o.operation AND m.device_id=o.device_id AND m.payload_json=o.payload_json)))",params![account,change],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(|_|"Verified authored version unavailable; use an owner recovery package for legacy data")?;
 let payload:Value=serde_json::from_str(&raw).map_err(err)?;let hash=payload["upload"]["sha256"].as_str().ok_or("Saved byte proof missing")?;
 if payload["resource"]["id"]!=id||size<0||payload["upload"]["protocol"]!=1||payload["upload"]["size_bytes"].as_i64()!=Some(size)||hash.len()!=64||!hash.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)){return Err("Saved byte proof invalid; original preserved".into())}
 let name=payload["resource"]["original_filename"].as_str().or(payload["resource"]["name"].as_str()).unwrap_or("recovered-resource");Ok((id,local_resource_export::filename(name),size as u64,hash.into()))
}
#[tauri::command]
pub async fn export_local_resource_recovery(app:AppHandle,expected_account_id:String,expected_session_token:String,change_id:String)->Result<bool,String>{
 tauri::async_runtime::spawn_blocking(move||{
  let change=uuid::Uuid::parse_str(&change_id).map_err(err)?.to_string();let c=local_db::open_local_connection(&app)?;let proof=version(&c,&expected_account_id,&expected_session_token,&change)?;
  let source=local_resource_uploads::file_path(&app,&expected_account_id,&change)?;
  let Some(target)=tauri::api::dialog::blocking::FileDialogBuilder::new().set_file_name(&proof.1).save_file()else{return Ok(false)};
  let managed=tauri::api::path::app_data_dir(&app.config()).ok_or("Missing data directory")?;
  if crate::working_store::is_managed_directory(&managed,target.parent().ok_or("Choose destination folder")?)?{return Err("Export outside managed storage".into())}
  local_resource_export::copy_atomic(&source,&target,proof.2,&proof.3,||{if version(&c,&expected_account_id,&expected_session_token,&change)?!=proof{return Err("Recovery proof changed; destination preserved".into())}Ok(())})?;Ok(true)
 }).await.map_err(err)?
}
#[cfg(test)]
pub(crate) mod tests{
 use super::*;
 pub(crate) const ACCOUNT:&str="10000000-0000-4000-8000-000000000001";
 pub(crate) fn fixture()->(Connection,std::path::PathBuf){
  let path=std::env::temp_dir().join(format!("labos-resource-recovery-{}.sqlite",uuid::Uuid::new_v4()));let c=Connection::open(&path).unwrap();local_db::ensure_schema(&c).unwrap();crate::local_resource_edits::schema(&c).unwrap();
  c.execute_batch("CREATE TABLE local_users(id TEXT PRIMARY KEY,central_user_id TEXT,role TEXT,is_active INTEGER,offline_expires_at TEXT,permissions_json TEXT);CREATE TABLE local_session(id INTEGER PRIMARY KEY,user_id TEXT,session_token TEXT);").unwrap();c.execute("INSERT INTO local_users VALUES('a',?1,'admin',1,datetime('now','+1 hour'),'[\"resources.view\",\"resources.edit\"]')",[ACCOUNT]).unwrap();c.execute("INSERT INTO local_session VALUES(1,'a','session')",[]).unwrap();(c,path)
 }
 #[test]
 fn archived_owned_version_survives_restart_and_exports_without_restoring_a_live_resource(){
  let(c,path)=fixture();let change=uuid::Uuid::new_v4().to_string();let id=uuid::Uuid::new_v4().to_string();let hash="a".repeat(64);let payload=json!({"resource":{"id":id,"name":"original.txt","description":"Saved description"},"upload":{"protocol":1,"size_bytes":3,"sha256":hash}});
  let device:String=c.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).unwrap();c.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,'resource',?3,'create_copy',?4)",params![change,device,id,payload.to_string()]).unwrap();c.execute("INSERT INTO local_resource_uploads(account_id,change_id,resource_id,resource_json,size_bytes,state,sha256) VALUES(?1,?2,?3,'{}',3,'ready',?4)",params![ACCOUNT,change,id,hash]).unwrap();
  let tx=c.unchecked_transaction().unwrap();crate::resource_dependencies::discard_descendants(&tx,&change,"dismiss").unwrap();tx.commit().unwrap();drop(c);
  let c=Connection::open(&path).unwrap();let rows=index(&c,ACCOUNT).unwrap();assert_eq!(rows["records"][0]["pending"],false);assert_eq!(rows["records"][0]["exportable"],true);assert!(version(&c,ACCOUNT,"session",&change).is_ok());assert_eq!(details(&c,ACCOUNT,"session",&change).unwrap()["description"],"Saved description");assert!(details(&c,ACCOUNT,"foreign-session",&change).is_err());assert!(version(&c,ACCOUNT,"other-session",&change).is_err());assert!(index(&c,"foreign-account").is_err());
  c.execute("UPDATE local_resource_uploads SET size_bytes=4",[]).unwrap();assert!(version(&c,ACCOUNT,"session",&change).is_err());drop(c);std::fs::remove_file(path).unwrap();
 }
}
