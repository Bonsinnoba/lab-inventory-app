//! Device-only quota and conservative reclamation of proven derived copies.
//! Authored uploads, edits, recovery packages and unknown files are never swept.
use crate::{local_db,local_resource_replication as copies,local_resource_authority};
use rusqlite::{Connection,params,OptionalExtension,TransactionBehavior};
use serde_json::{Value,json};
use tauri::AppHandle;
fn err(e:impl std::fmt::Display)->String{e.to_string()}
pub(crate) fn schema(c:&Connection)->Result<(),String>{
 copies::schema(c)?;
 c.execute_batch("CREATE TABLE IF NOT EXISTS local_resource_copy_retirement(account_id TEXT NOT NULL,resource_id TEXT NOT NULL,sha256 TEXT NOT NULL,origin TEXT NOT NULL,PRIMARY KEY(account_id,resource_id,sha256));CREATE TABLE IF NOT EXISTS local_resource_copy_quota(account_id TEXT PRIMARY KEY,bytes INTEGER NOT NULL CHECK(bytes>=0));").map_err(err)
}
pub(crate) fn observe_visibility(c:&Connection,account:&str,visible:&std::collections::HashSet<String>,deleted:&std::collections::HashSet<String>)->Result<(),String>{
 schema(c)?;crate::local_resource_posters::schema(c)?;
 let ids={let mut stmt=c.prepare("SELECT resource_id FROM local_resource_copies WHERE account_id=?1").map_err(err)?;let rows=stmt.query_map([account],|r|r.get::<_,String>(0)).map_err(err)?.collect::<Result<Vec<_>,_>>().map_err(err)?;rows};
 for id in ids{let canonical=id.replace('-',"").to_ascii_lowercase();if !visible.contains(&canonical)||deleted.iter().any(|d|d.replace('-',"").to_ascii_lowercase()==canonical){c.execute("INSERT OR IGNORE INTO local_resource_poster_denials(account_id,resource_id) VALUES(?1,?2)",params![account,id]).map_err(err)?;}}
 Ok(())
}
pub(crate) fn reserve(c:&Connection,account:&str,id:&str,origin:&str,hash:&str,size:u64)->Result<(),String>{
 schema(c)?;let quota:i64=c.query_row("SELECT bytes FROM local_resource_copy_quota WHERE account_id=?1",[account],|r|r.get(0)).optional().map_err(err)?.unwrap_or(0);
 let allocated:i64=c.query_row("SELECT COALESCE(SUM(size_bytes),0) FROM local_resource_copies WHERE account_id=?1 AND resource_id<>?2",params![account,id],|r|r.get(0)).map_err(err)?;
 if size>i64::MAX as u64||quota>0&&(allocated as u64).checked_add(size).is_none_or(|n|n>quota as u64){return Err("Device copy quota reached; existing files and pending work are preserved. Increase the quota or review device storage.".into())}
 c.execute("INSERT OR IGNORE INTO local_resource_copy_retirement(account_id,resource_id,sha256,origin) SELECT account_id,resource_id,sha256,origin FROM local_resource_copies WHERE account_id=?1 AND resource_id=?2 AND (sha256<>?3 OR origin<>?4)",params![account,id,hash,origin]).map_err(err)?;Ok(())
}
fn authored(c:&Connection,account:&str,id:&str)->Result<bool,String>{
 crate::local_resource_edits::schema(c)?;
 c.query_row("SELECT EXISTS(SELECT 1 FROM local_resource_uploads WHERE account_id=?1 AND resource_id=?2) OR EXISTS(SELECT 1 FROM local_resource_edits WHERE account_id=?1 AND resource_id=?2) OR EXISTS(SELECT 1 FROM sync_outbox WHERE account_id=?1 AND entity_type='resource' AND entity_id=?2 AND operation IN ('create','create_copy','edit_content')) OR EXISTS(SELECT 1 FROM sync_outbox WHERE account_id=?1 AND entity_type='resource' AND json_extract(payload_json,'$.copy.source_id')=?2)",params![account,id],|r|r.get(0)).map_err(err)
}
fn safe_file(path:&std::path::Path,root:&std::path::Path)->Result<(),String>{
 let mut node=Some(path);while let Some(p)=node{
  let meta=std::fs::symlink_metadata(p).map_err(err)?;
  #[cfg(windows)]{use std::os::windows::fs::MetadataExt;if meta.file_attributes()&0x400!=0{return Err("Reparse point is not reclaimable".into())}}
  if meta.file_type().is_symlink(){return Err("Linked storage is not reclaimable".into())}
  if p==root{return Ok(())}node=p.parent();
 }Err("Storage path escaped managed root".into())
}
fn reclaim_file(path:&std::path::Path,root:&std::path::Path,hash:&str)->Result<Option<u64>,String>{
 if !path.exists(){return Ok(Some(0))}
 if safe_file(path,root).is_err()||copies::hash_file(path).ok().as_deref()!=Some(hash){return Ok(None)}
 let bytes=std::fs::metadata(path).map_err(err)?.len();if std::fs::remove_file(path).is_err(){return Ok(None)}Ok(Some(bytes))
}
pub(crate) fn reconcile(app:&AppHandle,c:&mut Connection,account:&str,session:&str,_explicit:bool)->Result<Value,String>{
 schema(c)?;crate::local_resource_posters::schema(c)?;let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(err)?;local_resource_authority::guard(&tx,account,session)?;crate::local_auth::require_local_permission(&tx,"resources.view")?;
 let pending:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM sync_outbox WHERE account_id=?1 AND entity_type='resource' AND synced_at IS NULL)",[account],|r|r.get(0)).map_err(err)?;
 // A pending move/copy may refer to a different resource's bytes. Preserve the
 // entire account's derived history until its connected intentions are settled.
 let mut reclaimed=0u64;let mut preserved=0;
 if !pending{
  {
   let rows={let mut s=tx.prepare("SELECT p.resource_id FROM local_resource_copies p JOIN local_resource_poster_denials d ON d.account_id=p.account_id AND d.resource_id=p.resource_id WHERE p.account_id=?1").map_err(err)?;let x=s.query_map([account],|r|r.get::<_,String>(0)).map_err(err)?.collect::<Result<Vec<_>,_>>().map_err(err)?;x};
   for id in rows{if authored(&tx,account,&id)?{preserved+=1;continue}tx.execute("INSERT OR IGNORE INTO local_resource_copy_retirement SELECT account_id,resource_id,sha256,origin FROM local_resource_copies WHERE account_id=?1 AND resource_id=?2",params![account,id]).map_err(err)?;tx.execute("DELETE FROM local_resource_copies WHERE account_id=?1 AND resource_id=?2",params![account,id]).map_err(err)?;}
  }
  let rows={let mut s=tx.prepare("SELECT resource_id,sha256,origin FROM local_resource_copy_retirement WHERE account_id=?1 LIMIT 32").map_err(err)?;let x=s.query_map([account],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?))).map_err(err)?.collect::<Result<Vec<_>,_>>().map_err(err)?;x};
  let origin=crate::native_authorization::trusted_base().map_err(|e|e.message)?;
  let directory=tauri::api::path::app_data_dir(&app.config()).ok_or("Missing managed root")?;
  let root=crate::working_store::canonical_key_root(&directory)?;
  for (id,hash,source) in rows{
   if source!=origin||authored(&tx,account,&id)?{preserved+=1;continue}
   let active:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM local_resource_copies WHERE account_id=?1 AND resource_id=?2 AND (sha256=?3 OR state<>'ready'))",params![account,id,hash],|r|r.get(0)).map_err(err)?;if active{preserved+=1;continue}
   let (_,path)=copies::paths(app,account,&id,&hash)?;
   let Some(bytes)=reclaim_file(&path,&root,&hash)?else{preserved+=1;continue};reclaimed+=bytes;
   // Retry is safe if removal succeeded but the transaction later fails. Never
   // remove partial/unknown files or a current manifest as a side effect.
   tx.execute("DELETE FROM local_resource_copy_retirement WHERE account_id=?1 AND resource_id=?2 AND sha256=?3",params![account,id,hash]).map_err(err)?;
  }
 }
 let quota:i64=tx.query_row("SELECT bytes FROM local_resource_copy_quota WHERE account_id=?1",[account],|r|r.get(0)).optional().map_err(err)?.unwrap_or(0);
 let allocated:i64=tx.query_row("SELECT COALESCE(SUM(size_bytes),0) FROM local_resource_copies WHERE account_id=?1",[account],|r|r.get(0)).map_err(err)?;
 tx.commit().map_err(err)?;Ok(json!({"quota_bytes":quota,"allocated_bytes":allocated,"reclaimed_bytes":reclaimed,"preserved":preserved,"pending_protected":pending,"scope":"Derived PC copies only; authored/recovery/unknown/partial files are retained."}))
}
#[tauri::command]
pub async fn manage_local_resource_storage(app:AppHandle,expected_account_id:String,expected_session_token:String,quota_bytes:Option<u64>,reclaim:bool)->Result<Value,String>{
 tauri::async_runtime::spawn_blocking(move||{let mut c=local_db::open_local_connection(&app)?;schema(&c)?;
 if let Some(bytes)=quota_bytes{if bytes>1024u64.pow(4){return Err("Device quota must be at most 1 TiB; zero means unlimited".into())}let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(err)?;local_resource_authority::guard(&tx,&expected_account_id,&expected_session_token)?;tx.execute("INSERT INTO local_resource_copy_quota VALUES(?1,?2) ON CONFLICT(account_id) DO UPDATE SET bytes=excluded.bytes",params![expected_account_id,bytes as i64]).map_err(err)?;tx.commit().map_err(err)?;}
 reconcile(&app,&mut c,&expected_account_id,&expected_session_token,reclaim)
 }).await.map_err(err)?
}
#[cfg(test)]mod tests{
 use super::*;use crate::local_resource_recovery::tests::{fixture,ACCOUNT};
 #[test]fn quota_reservation_is_account_scoped_preserves_old_manifests_and_does_not_evict_work(){
  let(c,path)=fixture();schema(&c).unwrap();let id=uuid::Uuid::new_v4().to_string();let other=uuid::Uuid::new_v4().to_string();
  c.execute("INSERT INTO local_resource_copy_quota VALUES(?1,10)",[ACCOUNT]).unwrap();
  c.execute("INSERT INTO local_resource_copies(account_id,resource_id,origin,revision,sha256,size_bytes,mime_type,state) VALUES(?1,?2,'origin','rev',?3,6,'text/plain','ready')",params![ACCOUNT,id,"a".repeat(64)]).unwrap();
  assert!(reserve(&c,ACCOUNT,&other,"origin",&"b".repeat(64),5).is_err());assert!(reserve(&c,ACCOUNT,&id,"origin",&"b".repeat(64),10).is_ok());
  assert_eq!(c.query_row("SELECT sha256 FROM local_resource_copies",[],|r|r.get::<_,String>(0)).unwrap(),"a".repeat(64));assert_eq!(c.query_row("SELECT count(*) FROM local_resource_copy_retirement",[],|r|r.get::<_,i64>(0)).unwrap(),1);
  assert!(!authored(&c,ACCOUNT,&id).unwrap());let device:String=c.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).unwrap();c.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES('copy-proof',?1,'resource',?2,'create_copy',?3)",params![device,other,json!({"copy":{"source_id":id}}).to_string()]).unwrap();assert!(authored(&c,ACCOUNT,&id).unwrap());
  drop(c);std::fs::remove_file(path).unwrap();
 }
 #[test]fn derived_file_reclamation_verifies_bytes_and_never_removes_unknown_or_escaped_files(){
  use sha2::{Digest,Sha256};let root=std::env::temp_dir().join(format!("labos-derived-retention-{}",uuid::Uuid::new_v4()));std::fs::create_dir(&root).unwrap();let child=root.join("copy");std::fs::write(&child,b"verified derived bytes").unwrap();let hash=format!("{:x}",Sha256::digest(b"verified derived bytes"));
  assert_eq!(reclaim_file(&child,&root,&"0".repeat(64)).unwrap(),None);assert!(child.exists());assert_eq!(reclaim_file(&child,&root,&hash).unwrap(),Some(22));assert!(!child.exists());assert_eq!(reclaim_file(&child,&root,&hash).unwrap(),Some(0));
  let outside=root.with_extension("outside");std::fs::write(&outside,b"verified derived bytes").unwrap();assert_eq!(reclaim_file(&outside,&root,&hash).unwrap(),None);assert!(outside.exists());std::fs::remove_file(outside).unwrap();std::fs::remove_dir(root).unwrap();
 }

 #[test]fn complete_visibility_removal_marks_copies_even_after_the_resource_row_was_removed_locally(){
  let(c,path)=fixture();schema(&c).unwrap();let id=uuid::Uuid::new_v4().to_string();let foreign=uuid::Uuid::new_v4().to_string();
  for(account,resource)in [(ACCOUNT,id.as_str()),("foreign-account",foreign.as_str())]{c.execute("INSERT INTO local_resource_copies(account_id,resource_id,origin,revision,sha256,size_bytes,mime_type,state) VALUES(?1,?2,'origin','rev',?3,3,'text/plain','ready')",params![account,resource,"a".repeat(64)]).unwrap();}
  observe_visibility(&c,ACCOUNT,&std::collections::HashSet::new(),&std::collections::HashSet::new()).unwrap();assert_eq!(c.query_row("SELECT resource_id FROM local_resource_poster_denials",[],|r|r.get::<_,String>(0)).unwrap(),id);assert_eq!(c.query_row("SELECT count(*) FROM local_resource_copies",[],|r|r.get::<_,i64>(0)).unwrap(),2);assert_eq!(c.query_row("SELECT count(*) FROM sync_outbox",[],|r|r.get::<_,i64>(0)).unwrap(),0);drop(c);std::fs::remove_file(path).unwrap();
 }

}
