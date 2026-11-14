//! Native-owned reviewed tree intentions. No renderer manifest or positive grant
//! is accepted; no bytes or descendant identities are changed by a tree move.
use crate::{local_auth,local_db,local_resources,native_authorization};
use rusqlite::{params,Connection,OptionalExtension,TransactionBehavior};
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::collections::{HashMap,HashSet};
use tauri::AppHandle;

fn err(e:impl std::fmt::Display)->String{e.to_string()}
fn digest(v:&Value)->String{crate::local_resource_authority::confirmation_digest(v)}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Destination {item_id:Option<String>,project_id:Option<String>,note_id:Option<String>,parent_resource_id:Option<String>}
impl Destination {
 fn normalize(&mut self)->Result<(),String>{let mut n=0;for value in [&mut self.item_id,&mut self.project_id,&mut self.note_id,&mut self.parent_resource_id]{if let Some(id)=value{*id=uuid::Uuid::parse_str(id).map_err(err)?.to_string();n+=1;}}if n>1{return Err("Choose one tree destination".into())}Ok(())}
}
#[derive(Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
struct Review {protocol:u32,resource_id:String,account_id:String,destination:Destination,members:Vec<Value>,source_context_sha256:String,destination_context_sha256:String}
#[derive(Serialize)]
pub struct Ticket {review_id:String,resource_id:String,member_count:usize}
pub(crate) fn schema(c:&Connection)->Result<(),String>{
 c.execute_batch("CREATE TABLE IF NOT EXISTS local_resource_tree_reviews(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,resource_id TEXT NOT NULL,origin TEXT NOT NULL,session_hash TEXT NOT NULL,lease TEXT NOT NULL,destination_json TEXT NOT NULL,context_sha256 TEXT NOT NULL,review_json TEXT NOT NULL,consumed_change_id TEXT);").map_err(err)
}
fn session_hash(session:&str)->String{digest(&json!(["tree-review-session",session]))}
fn member(r:&local_resources::LocalResource)->Value{json!({"id":r.id,"kind":r.kind,"name":r.name,"relative_path":r.relative_path,"parent_resource_id":r.parent_resource_id,"item_id":r.item_id,"project_id":r.project_id,"note_id":r.note_id,"visibility":r.visibility.as_deref().unwrap_or("lab"),"updated_at":r.updated_at})}
fn tree(resources:&[local_resources::LocalResource],root:&str)->Result<Vec<Value>,String>{
 let all:HashMap<_,_>=resources.iter().map(|r|(r.id.as_str(),r)).collect();
 if all.len()!=resources.len(){return Err("Duplicate cached resource identities require recovery".into())}
 if all.get(root).is_none_or(|r|!["folder","file","link"].contains(&r.kind.as_str())){return Err("Choose an available resource to move".into())}
 let mut seen=HashSet::new();let mut todo=vec![(root,0)];let mut rows=Vec::new();
 while let Some((id,depth))=todo.pop(){if depth>=32||seen.len()>=500||!seen.insert(id){return Err("Folder tree is cyclic, too deep or exceeds 500 members".into())}
  let r=all.get(id).ok_or("Incomplete cached tree")?;rows.push(member(r));
  for child in resources.iter().filter(|r|r.parent_resource_id.as_deref()==Some(id)){if r.kind!="folder"{return Err("A non-folder contains cached children".into())}todo.push((&child.id,depth+1));}
 }
 rows.sort_by(|a,b|a["id"].as_str().cmp(&b["id"].as_str()));Ok(rows)
}
fn context(c:&Connection,resources:&[local_resources::LocalResource],root:&str,destination:&Destination)->Result<(String,Vec<String>),String>{
 let mut ids=HashSet::new();let mut notes=HashSet::new();let mut projects=HashSet::new();
 for start in [Some(root),destination.parent_resource_id.as_deref()].into_iter().flatten(){let mut next=Some(start);let mut path=HashSet::new();
  while let Some(id)=next{if path.len()>=32||!path.insert(id){return Err("Invalid cached ancestor tree".into())}let row=resources.iter().find(|r|r.id==id).ok_or("Containing folder unavailable locally")?;
   ids.insert(row.id.clone());if let Some(id)=&row.note_id{notes.insert(id.clone());}if let Some(id)=&row.project_id{projects.insert(id.clone());}next=row.parent_resource_id.as_deref();
  }
 }
 if let Some(id)=&destination.note_id{notes.insert(id.clone());}if let Some(id)=&destination.project_id{projects.insert(id.clone());}
 let note_rows=if notes.is_empty(){Vec::new()}else{crate::local_notes::load(c)?.into_iter().filter(|r|r["id"].as_str().is_some_and(|id|notes.contains(id))).map(|r|{if let Some(id)=r["project_id"].as_str(){projects.insert(id.into());}json!({"id":r["id"],"project_id":r["project_id"],"visibility":r["visibility"],"updated_at":r["updated_at"]})}).collect::<Vec<_>>()};
 if note_rows.len()!=notes.len(){return Err("Containing note is not cached".into())}
 let project_rows=if projects.is_empty(){Vec::new()}else{crate::local_projects::load_all(c)?.into_iter().filter(|r|r["id"].as_str().is_some_and(|id|projects.contains(id))).map(|r|json!({"id":r["id"],"owner_id":r["owner_id"],"visibility":r["visibility"],"updated_at":r["updated_at"]})).collect::<Vec<_>>()};
 if project_rows.len()!=projects.len(){return Err("Containing project is not cached".into())}
 let mut rows:Vec<Value>=resources.iter().filter(|r|ids.contains(&r.id)).map(member).collect();rows.extend(note_rows);rows.extend(project_rows);rows.sort_by(|a,b|a["id"].as_str().cmp(&b["id"].as_str()));
 ids.extend(notes);ids.extend(projects);let mut affected:Vec<_>=ids.into_iter().collect();affected.sort();
 Ok((digest(&json!(rows)),affected))
}
fn validate_review(reply:&Review,account:&str,root:&str,destination:&Destination,resources:&[local_resources::LocalResource])->Result<(),String>{
 if reply.protocol!=1||reply.account_id!=account||reply.resource_id!=root||&reply.destination!=destination||reply.members!=tree(resources,root)?{return Err("Server review does not match this account, destination or complete cached tree; refresh first".into())}
 for hash in [&reply.source_context_sha256,&reply.destination_context_sha256]{if hash.len()!=64||!hash.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)){return Err("Invalid reviewed context fingerprint".into())}}
 if destination.parent_resource_id.as_deref().is_some_and(|id|reply.members.iter().any(|m|m["id"]==id)){return Err("A folder cannot move into itself or a descendant".into())}Ok(())
}
fn check_local(c:&Connection,account:&str,session:&str,root:&str,destination:&Destination)->Result<(Vec<local_resources::LocalResource>,String,String),String>{
 let lease=crate::local_resource_authority::guard(c,account,session)?;local_auth::require_local_permission(c,"resources.view")?;local_auth::require_local_permission(c,"resources.edit")?;
 let resources=local_resources::read_resources(c)?;let members=tree(&resources,root)?;let (fingerprint,mut ids)=context(c,&resources,root,destination)?;
 ids.extend(members.iter().filter_map(|r|r["id"].as_str().map(str::to_owned)));ids.sort();ids.dedup();
 let pending:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM sync_outbox WHERE account_id=?1 AND synced_at IS NULL AND entity_type IN ('resource','note','project') AND entity_id IN (SELECT value FROM json_each(?2)))",params![account,serde_json::to_string(&ids).map_err(err)?],|r|r.get(0)).map_err(err)?;
 if pending{return Err("Synchronize or resolve pending tree and destination changes before moving this folder; saved work is preserved".into())}
 for row in &resources{if members.iter().any(|m|m["id"]==row.id){crate::resource_dependencies::require_editor_access(c,row)?;}}
 crate::local_resource_uploads::parent_guard(c,&serde_json::to_value(destination).map_err(err)?)?;
 Ok((resources,lease,fingerprint))
}

#[tauri::command]
pub async fn prepare_local_resource_tree_move(app:AppHandle,expected_account_id:String,expected_session_token:String,resource_id:String,mut destination:Destination,server_token:Option<String>)->Result<Ticket,String>{
 destination.normalize()?;let root=uuid::Uuid::parse_str(&resource_id).map_err(err)?.to_string();let origin=native_authorization::trusted_base().map_err(|e|e.message)?;
 let (resources,lease,fingerprint)={let c=local_db::open_local_connection(&app)?;schema(&c)?;let result=check_local(&c,&expected_account_id,&expected_session_token,&root,&destination)?;
  let cached:Option<(String,String)>=c.query_row("SELECT id,review_json FROM local_resource_tree_reviews WHERE account_id=?1 AND resource_id=?2 AND origin=?3 AND session_hash=?4 AND lease=?5 AND destination_json=?6 AND context_sha256=?7 AND consumed_change_id IS NULL ORDER BY rowid DESC LIMIT 1",params![expected_account_id,root,origin,session_hash(&expected_session_token),result.1,serde_json::to_string(&destination).map_err(err)?,result.2],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(err)?;
  if let Some((id,raw))=cached{let review:Review=serde_json::from_str(&raw).map_err(err)?;if validate_review(&review,&expected_account_id,&root,&destination,&result.0).is_ok(){return Ok(Ticket{review_id:id,resource_id:root,member_count:review.members.len()})}}result};
 let token=server_token.filter(|t|!t.is_empty()&&!t.starts_with("local:")).ok_or("Connect once to verify this exact tree and destination before moving it offline")?;
 let response=native_authorization::client().map_err(|e|e.message)?.post(format!("{origin}/sync/resources/tree/review")).bearer_auth(token).json(&json!({"resource_id":root,"destination":destination})).send().await.map_err(|_|"Tree review unavailable; no move was saved")?;
 let review:Review=match native_authorization::response_json_limit(response,512*1024).await{Ok(reply)=>reply,Err(error)=>{if error.code=="AUTH_REVOKED"{let mut c=local_db::open_local_connection(&app)?;local_auth::invalidate_authorization(&mut c,&expected_account_id,&expected_session_token)?;}return Err(format!("{}: {}",error.code,error.message));}};
 validate_review(&review,&expected_account_id,&root,&destination,&resources)?;
 let mut c=local_db::open_local_connection(&app)?;let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(err)?;schema(&tx)?;
 let (current,current_lease,current_context)=check_local(&tx,&expected_account_id,&expected_session_token,&root,&destination)?;
 if current_lease!=lease||current_context!=fingerprint||native_authorization::trusted_base().map_err(|e|e.message)?!=origin{return Err("Login, server or containing context changed during review".into())}
 validate_review(&review,&expected_account_id,&root,&destination,&current)?;let id=uuid::Uuid::new_v4().to_string();
 tx.execute("INSERT INTO local_resource_tree_reviews(id,account_id,resource_id,origin,session_hash,lease,destination_json,context_sha256,review_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![id,expected_account_id,root,origin,session_hash(&expected_session_token),lease,serde_json::to_string(&destination).map_err(err)?,fingerprint,serde_json::to_string(&review).map_err(err)?]).map_err(err)?;
 tx.commit().map_err(err)?;Ok(Ticket{review_id:id,resource_id:root,member_count:review.members.len()})
}

fn move_path(before:&local_resources::LocalResource,nested:bool)->Result<Option<String>,String>{
 if !nested||before.kind=="link"{return Ok(None)}
 let source=if before.kind=="folder"{before.name.as_str()}else{before.relative_path.as_deref().or(before.original_filename.as_deref()).unwrap_or(&before.name)};
 let leaf=source.rsplit('/').next().ok_or("Resource filename unavailable")?;
 if before.kind=="folder"{crate::local_resources::folder_creation_path(leaf,true,None)}else{crate::local_resource_uploads::validate_relative_path(leaf)?;Ok(Some(leaf.into()))}
}

pub(crate) fn author(c:&mut Connection,account:&str,session:&str,ticket:&str)->Result<local_resources::LocalResource,String>{
 let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(err)?;schema(&tx)?;crate::local_resource_authority::guard(&tx,account,session)?;
 let (root,origin,hash,lease,fingerprint,raw,used):(String,String,String,String,String,String,Option<String>)=tx.query_row("SELECT resource_id,origin,session_hash,lease,context_sha256,review_json,consumed_change_id FROM local_resource_tree_reviews WHERE id=?1 AND account_id=?2",params![ticket,account],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?))).map_err(|_|"Native tree review is unavailable for this account")?;
 if used.is_some(){return Err("This folder review was already used; original intention is preserved".into())}
 let review:Review=serde_json::from_str(&raw).map_err(err)?;
 let (mut resources,current_lease,current_context)=check_local(&tx,account,session,&root,&review.destination)?;
 if hash!=session_hash(session)||lease!=current_lease||fingerprint!=current_context||origin!=native_authorization::trusted_base().map_err(|e|e.message)?{return Err("Tree review expired or its account/context changed; no move was saved".into())}
 validate_review(&review,account,&root,&review.destination,&resources)?;
 let before=resources.iter().find(|r|r.id==root).ok_or("Reviewed folder missing")?.clone();let mut after=before.clone();let destination=&review.destination;
 after.item_id=destination.item_id.clone();after.project_id=destination.project_id.clone();after.note_id=destination.note_id.clone();after.parent_resource_id=destination.parent_resource_id.clone();after.relative_path=move_path(&before,after.parent_resource_id.is_some())?;
 after.item_name=None;after.project_name=None;after.note_title=None;
 if after.kind!="link"{local_resources::require_resource_path_available(&resources.iter().filter(|r|r.id!=root).cloned().collect::<Vec<_>>(),&after)?;}
 let change=uuid::Uuid::new_v4().to_string();let device:String=tx.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).map_err(err)?;
 let payload=json!({"id":root,"tree_move":{"protocol":1,"destination":review.destination,"members":review.members,"source_context_sha256":review.source_context_sha256,"destination_context_sha256":review.destination_context_sha256}});
 *resources.iter_mut().find(|r|r.id==root).unwrap()=after.clone();local_resources::write_resources(&tx,&resources)?;
 tx.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,'resource',?3,'move_tree',?4)",params![change,device,root,payload.to_string()]).map_err(err)?;
 crate::local_resource_attachments::record_native_proof(&tx,&change,"move_tree",&before,&after,&payload)?;
 tx.execute("UPDATE local_resource_tree_reviews SET consumed_change_id=?1 WHERE id=?2 AND account_id=?3 AND consumed_change_id IS NULL",params![change,ticket,account]).map_err(err)?;
 tx.commit().map_err(err)?;Ok(after)
}

#[tauri::command]
pub fn move_local_resource_tree(app:AppHandle,expected_account_id:String,expected_session_token:String,review_id:String)->Result<local_resources::LocalResource,String>{
 let ticket=uuid::Uuid::parse_str(&review_id).map_err(err)?.to_string();let mut c=local_db::open_local_connection(&app)?;author(&mut c,&expected_account_id,&expected_session_token,&ticket)
}

// Read continuity is not editor authority. Reconstruct only the native-proven
// before-root and validate the entire review and both containing contexts.
pub(crate) fn require_pending_read(c:&Connection,id:&str)->Result<bool,String>{
 let account=local_db::active_account(c)?;
 let pending:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM sync_outbox WHERE account_id=?1 AND entity_type='resource' AND operation='move_tree' AND synced_at IS NULL)",[&account],|r|r.get(0)).map_err(err)?;if !pending{return Ok(false)}
 crate::local_resource_attachments::schema(c)?;schema(c)?;
 let mut stmt=c.prepare("SELECT o.change_id,o.entity_id,o.payload_json,m.before_json,m.after_json FROM sync_outbox o LEFT JOIN local_resource_mutations m ON m.account_id=o.account_id AND m.change_id=o.change_id AND m.device_id=o.device_id AND m.resource_id=o.entity_id AND m.operation=o.operation AND m.payload_json=o.payload_json WHERE o.account_id=?1 AND o.entity_type='resource' AND o.operation='move_tree' AND o.synced_at IS NULL AND (o.entity_id=?2 OR EXISTS(SELECT 1 FROM json_each(o.payload_json,'$.tree_move.members') x WHERE json_extract(x.value,'$.id')=?2))").map_err(err)?;
 let rows=stmt.query_map(params![account,id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,Option<String>>(3)?,r.get::<_,Option<String>>(4)?))).map_err(err)?.collect::<Result<Vec<_>,_>>().map_err(err)?;
 if rows.is_empty(){return Ok(false)}if rows.len()!=1{return Err("Overlapping tree intentions require recovery".into())}
 local_auth::require_local_permission(c,"resources.view")?;
 let (change,root,payload,before,after)=&rows[0];
 let own_device:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM sync_outbox WHERE account_id=?1 AND change_id=?2 AND device_id=(SELECT device_id FROM device_identity WHERE id=1))",params![account,change],|r|r.get(0)).map_err(err)?;if !own_device{return Err("Tree read belongs to another device".into())}
let before:local_resources::LocalResource=serde_json::from_str(before.as_deref().ok_or("Tree read provenance missing")?).map_err(err)?;let after:local_resources::LocalResource=serde_json::from_str(after.as_deref().ok_or("Tree read provenance missing")?).map_err(err)?;
 let (raw,origin,hash,lease,fingerprint):(String,String,String,String,String)=c.query_row("SELECT review_json,origin,session_hash,lease,context_sha256 FROM local_resource_tree_reviews WHERE account_id=?1 AND resource_id=?2 AND consumed_change_id=?3",params![account,root,change],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).map_err(err)?;
 let session:String=c.query_row("SELECT session_token FROM local_session WHERE id=1",[],|r|r.get(0)).map_err(err)?;
 if guard_lease(c,&account,&session)?!=lease||session_hash(&session)!=hash||native_authorization::trusted_base().map_err(|e|e.message)?!=origin{return Err("Folder read review expired; saved files remain preserved".into())}
 let review:Review=serde_json::from_str(&raw).map_err(err)?;let intent:Value=serde_json::from_str(payload).map_err(err)?;
 if intent!=json!({"id":root,"tree_move":{"protocol":1,"destination":review.destination,"members":review.members,"source_context_sha256":review.source_context_sha256,"destination_context_sha256":review.destination_context_sha256}}){return Err("Tree read intent changed".into())}
 let mut resources=local_resources::read_resources(c)?;let leaf=resources.iter_mut().find(|r|r.id==*root).ok_or("Pending root unavailable")?;
 if serde_json::to_value(&*leaf).map_err(err)?!=serde_json::to_value(&after).map_err(err)?{return Err("Pending root projection changed".into())}*leaf=before;
 validate_review(&review,&account,root,&review.destination,&resources)?;
 if context(c,&resources,root,&review.destination)?.0!=fingerprint{return Err("Tree read context changed".into())}
 let mut ids=context(c,&resources,root,&review.destination)?.1;ids.extend(review.members.iter().filter_map(|m|m["id"].as_str().map(str::to_owned)));
 let denied:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM local_resource_poster_denials WHERE account_id=?1 AND resource_id IN (SELECT value FROM json_each(?2)))",params![account,serde_json::to_string(&ids).map_err(err)?],|r|r.get(0)).map_err(err)?;
 if denied{return Err("Tree member or containing scope access was revoked; saved files are preserved".into())}Ok(true)
}
fn guard_lease(c:&Connection,account:&str,session:&str)->Result<String,String>{crate::local_resource_authority::guard(c,account,session)}

pub(crate) fn require_no_pending_tree(c:&Connection,id:&str)->Result<(),String>{
 let account=local_db::active_account(c)?;
 let pending:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM sync_outbox o WHERE o.account_id=?1 AND o.entity_type='resource' AND o.operation='move_tree' AND o.synced_at IS NULL AND (o.entity_id=?2 OR EXISTS(SELECT 1 FROM json_each(o.payload_json,'$.tree_move.members') m WHERE json_extract(m.value,'$.id')=?2)))",params![account,id],|r|r.get(0)).map_err(err)?;
 if pending{return Err("Synchronize or review this folder move before changing its members; all saved work and bytes remain on this PC".into())}Ok(())
}

#[cfg(test)]
mod tests {
 use super::*;
 const ACCOUNT:&str="10000000-0000-4000-8000-000000000001";
 const ROOT:&str="20000000-0000-4000-8000-000000000001";
 const CHILD:&str="30000000-0000-4000-8000-000000000001";
 const TARGET:&str="40000000-0000-4000-8000-000000000001";
 fn sample(id:&str,kind:&str,parent:Option<&str>)->local_resources::LocalResource{
  serde_json::from_value(json!({"id":id,"name":if kind=="folder"{"Folder"}else{"Evidence.pdf"},"kind":kind,"file_type":if kind=="folder"{"other"}else{"pdf"},"parent_resource_id":parent,"relative_path":parent.map(|_|"Evidence.pdf"),"size_bytes":if kind=="folder"{None}else{Some(123)},"tags":[],"visibility":"lab","updated_at":"2026-11-08T00:00:00.000Z","created_at":"2026-11-08T00:00:00.000Z"})).unwrap()
 }
 fn fixture()->(Connection,std::path::PathBuf,Destination){
  let path=std::env::temp_dir().join(format!("labos-tree-intent-{}.sqlite",uuid::Uuid::new_v4()));let c=Connection::open(&path).unwrap();local_db::ensure_schema(&c).unwrap();schema(&c).unwrap();
  c.execute_batch("CREATE TABLE local_users(id TEXT PRIMARY KEY,central_user_id TEXT,role TEXT,is_active INTEGER,offline_expires_at TEXT,permissions_json TEXT);CREATE TABLE local_session(id INTEGER PRIMARY KEY,user_id TEXT,session_token TEXT);").unwrap();
  c.execute("INSERT INTO local_users VALUES('a',?1,'admin',1,datetime('now','+1 hour'),'[\"resources.view\",\"resources.edit\",\"resources.create\",\"resources.delete\"]')",[ACCOUNT]).unwrap();c.execute("INSERT INTO local_session VALUES(1,'a','native-session')",[]).unwrap();
  let mut target=sample(TARGET,"folder",None);target.name="Target".into();local_resources::write_resources(&c,&[sample(ROOT,"folder",None),sample(CHILD,"file",Some(ROOT)),target]).unwrap();
  (c,path,Destination{item_id:None,project_id:None,note_id:None,parent_resource_id:Some(TARGET.into())})
 }
 fn store(c:&Connection,destination:&Destination)->String{
  let (rows,lease,fingerprint)=check_local(c,ACCOUNT,"native-session",ROOT,destination).unwrap();
  let review=Review{protocol:1,resource_id:ROOT.into(),account_id:ACCOUNT.into(),destination:destination.clone(),members:tree(&rows,ROOT).unwrap(),source_context_sha256:"a".repeat(64),destination_context_sha256:"b".repeat(64)};
  validate_review(&review,ACCOUNT,ROOT,destination,&rows).unwrap();let ticket=uuid::Uuid::new_v4().to_string();
  c.execute("INSERT INTO local_resource_tree_reviews(id,account_id,resource_id,origin,session_hash,lease,destination_json,context_sha256,review_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![ticket,ACCOUNT,ROOT,native_authorization::trusted_base().unwrap(),session_hash("native-session"),lease,serde_json::to_string(destination).unwrap(),fingerprint,serde_json::to_string(&review).unwrap()]).unwrap();ticket
 }
 #[test]
 fn disk_restart_authors_one_immutable_outbox_and_native_proof_with_descendants_unchanged(){
  let (c,path,destination)=fixture();let ticket=store(&c,&destination);let original=local_resources::read_resources(&c).unwrap().into_iter().find(|r|r.id==CHILD).unwrap();drop(c);
  let mut c=Connection::open(&path).unwrap();let moved=author(&mut c,ACCOUNT,"native-session",&ticket).unwrap();assert_eq!(moved.parent_resource_id.as_deref(),Some(TARGET));assert_eq!(moved.updated_at,"2026-11-08T00:00:00.000Z");
  let child=local_resources::read_resources(&c).unwrap().into_iter().find(|r|r.id==CHILD).unwrap();assert_eq!(serde_json::to_value(child).unwrap(),serde_json::to_value(original).unwrap());
  let (id,raw):(String,String)=c.query_row("SELECT change_id,payload_json FROM sync_outbox WHERE operation='move_tree'",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();let payload:Value=serde_json::from_str(&raw).unwrap();assert_eq!(payload["tree_move"]["members"].as_array().unwrap().len(),2);
  assert!(crate::local_resource_authority::require_verified_file_confirmation(&c,&id).is_err());assert!(require_no_pending_tree(&c,ROOT).is_err());assert!(require_no_pending_tree(&c,CHILD).is_err());assert!(require_no_pending_tree(&c,TARGET).is_ok());
  assert!(author(&mut c,ACCOUNT,"native-session",&ticket).is_err());assert_eq!(c.query_row("SELECT count(*) FROM sync_outbox",[],|r|r.get::<_,i64>(0)).unwrap(),1);
  let native:String=c.query_row("SELECT payload_json FROM local_resource_mutations WHERE change_id=?1",[id],|r|r.get(0)).unwrap();assert_eq!(native,raw);drop(c);std::fs::remove_file(path).unwrap();
 }
 #[test]
 fn failed_outbox_rolls_back_projection_provenance_and_ticket_consumption(){
  let (mut c,path,destination)=fixture();let ticket=store(&c,&destination);let before=serde_json::to_value(local_resources::read_resources(&c).unwrap()).unwrap();
  c.execute_batch("CREATE TRIGGER fail_tree_outbox BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT,'outbox unavailable'); END;").unwrap();assert!(author(&mut c,ACCOUNT,"native-session",&ticket).is_err());
  assert_eq!(serde_json::to_value(local_resources::read_resources(&c).unwrap()).unwrap(),before);assert!(c.query_row("SELECT consumed_change_id FROM local_resource_tree_reviews WHERE id=?1",[ticket],|r|r.get::<_,Option<String>>(0)).unwrap().is_none());assert_eq!(c.query_row("SELECT count(*) FROM local_resource_mutations",[],|r|r.get::<_,i64>(0)).unwrap(),0);drop(c);std::fs::remove_file(path).unwrap();
 }
 #[test]
 fn changed_member_foreign_session_account_and_revocation_cannot_use_cached_review(){
  let (mut c,path,destination)=fixture();let ticket=store(&c,&destination);
  assert!(author(&mut c,ACCOUNT,"other-session",&ticket).is_err());assert!(author(&mut c,"other-account","native-session",&ticket).is_err());
  let mut rows=local_resources::read_resources(&c).unwrap();rows.iter_mut().find(|r|r.id==CHILD).unwrap().name="Changed.pdf".into();local_resources::write_resources(&c,&rows).unwrap();assert!(author(&mut c,ACCOUNT,"native-session",&ticket).is_err());
  rows.iter_mut().find(|r|r.id==CHILD).unwrap().name="Evidence.pdf".into();local_resources::write_resources(&c,&rows).unwrap();c.execute("INSERT INTO local_resource_poster_denials(account_id,resource_id) VALUES(?1,?2)",params![ACCOUNT,CHILD]).unwrap();assert!(author(&mut c,ACCOUNT,"native-session",&ticket).is_err());assert_eq!(c.query_row("SELECT count(*) FROM sync_outbox",[],|r|r.get::<_,i64>(0)).unwrap(),0);drop(c);std::fs::remove_file(path).unwrap();
 }
 #[test]
 fn malformed_incomplete_or_cyclic_reviews_are_never_authority(){
  let (c,path,destination)=fixture();let rows=local_resources::read_resources(&c).unwrap();let mut reply=Review{protocol:1,resource_id:ROOT.into(),account_id:ACCOUNT.into(),destination:destination.clone(),members:tree(&rows,ROOT).unwrap(),source_context_sha256:"a".repeat(64),destination_context_sha256:"b".repeat(64)};
  reply.members.pop();assert!(validate_review(&reply,ACCOUNT,ROOT,&destination,&rows).is_err());reply.members=tree(&rows,ROOT).unwrap();reply.account_id="other".into();assert!(validate_review(&reply,ACCOUNT,ROOT,&destination,&rows).is_err());
  let mut broken=rows.clone();broken.iter_mut().find(|r|r.id==ROOT).unwrap().parent_resource_id=Some(ROOT.into());assert!(tree(&broken,ROOT).is_err());drop(c);std::fs::remove_file(path).unwrap();
 }
 #[test]
 fn file_and_link_moves_preserve_identity_and_use_original_filename_not_display_title(){
  for kind in ["file","link"]{
   let(mut c,path,destination)=fixture();let mut rows=local_resources::read_resources(&c).unwrap();rows.retain(|r|r.id!=CHILD);let root=rows.iter_mut().find(|r|r.id==ROOT).unwrap();root.kind=kind.into();root.name="Renamed display title".into();root.original_filename=Some("original.csv".into());local_resources::write_resources(&c,&rows).unwrap();
   let ticket=store(&c,&destination);let after=author(&mut c,ACCOUNT,"native-session",&ticket).unwrap();assert_eq!(after.id,ROOT);assert_eq!(after.kind,kind);assert_eq!(after.relative_path.as_deref(),if kind=="file"{Some("original.csv")}else{None});assert!(require_pending_read(&c,ROOT).unwrap());drop(c);std::fs::remove_file(path).unwrap();
  }
 }
 #[test]
 fn pending_tree_read_preserves_verified_members_but_never_ignores_changed_context_or_revocation(){
  let(mut c,path,destination)=fixture();let ticket=store(&c,&destination);author(&mut c,ACCOUNT,"native-session",&ticket).unwrap();assert!(require_pending_read(&c,CHILD).unwrap());assert!(require_no_pending_tree(&c,CHILD).is_err());
  c.execute("INSERT INTO local_resource_poster_denials(account_id,resource_id) VALUES(?1,?2)",params![ACCOUNT,TARGET]).unwrap();assert!(require_pending_read(&c,CHILD).is_err());c.execute("DELETE FROM local_resource_poster_denials",[]).unwrap();
  let mut rows=local_resources::read_resources(&c).unwrap();rows.iter_mut().find(|r|r.id==TARGET).unwrap().visibility=Some("restricted".into());local_resources::write_resources(&c,&rows).unwrap();assert!(require_pending_read(&c,CHILD).is_err());drop(c);std::fs::remove_file(path).unwrap();
 }

 #[test]
 fn confirmed_tree_receipt_carries_verified_copy_bytes_but_not_a_changed_file(){
  let(mut c,path,destination)=fixture();let mut rows=local_resources::read_resources(&c).unwrap();rows.retain(|r|r.id!=CHILD);let root=rows.iter_mut().find(|r|r.id==ROOT).unwrap();root.kind="file".into();root.original_filename=Some("evidence.pdf".into());local_resources::write_resources(&c,&rows).unwrap();let ticket=store(&c,&destination);let mut moved=author(&mut c,ACCOUNT,"native-session",&ticket).unwrap();let prior=moved.updated_at.clone();moved.updated_at="2026-11-13T00:00:00.000Z".into();assert!(!crate::local_resource_authority::verified_copy_revision(&c,&moved,&prior).unwrap());
  let(change,device,raw):(String,String,String)=c.query_row("SELECT change_id,device_id,payload_json FROM sync_outbox WHERE operation='move_tree'",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();c.execute("INSERT INTO local_resource_mutation_receipts(account_id,change_id,resource_id,device_id,origin,revision,payload_json) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![ACCOUNT,change,ROOT,device,native_authorization::trusted_base().unwrap(),moved.updated_at,raw]).unwrap();c.execute("UPDATE sync_outbox SET synced_at=CURRENT_TIMESTAMP",[]).unwrap();assert!(crate::local_resource_authority::verified_copy_revision(&c,&moved,&prior).unwrap());moved.size_bytes=Some(456);assert!(!crate::local_resource_authority::verified_copy_revision(&c,&moved,&prior).unwrap());drop(c);std::fs::remove_file(path).unwrap();
 }

}
