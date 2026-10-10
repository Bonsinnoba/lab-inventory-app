use rusqlite::{params,Connection,OptionalExtension,TransactionBehavior};
use serde_json::{json,Value};
use tauri::AppHandle;
use crate::{local_db,local_projects,local_auth};
const KEY:&str="comments_state";
#[cfg(test)]
#[path="local_comments_test.rs"]
mod tests;
#[cfg(test)]
#[path="local_comments_live_test.rs"]
mod live_tests;
pub(crate) fn require_comment_project_access(c:&Connection,project:&str,edit:bool)->Result<(),String>{
    local_projects::require_cached_project_access(c,project,edit)?;
    let raw:Option<String>=c.query_row("SELECT value FROM sync_state WHERE key=?1",[local_db::scoped_state_key(c,"comments_visible_projects")?],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
    if let Some(raw)=raw{
        let visible:Vec<String>=serde_json::from_str(&raw).map_err(|e|e.to_string())?;
        let pending_create:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM active_sync_outbox WHERE entity_type='project' AND entity_id=?1 AND operation='create' AND synced_at IS NULL)",[project],|r|r.get(0)).map_err(|e|e.to_string())?;
        if !visible.iter().any(|id|id==project)&&!pending_create{return Err("Comment project access was revoked; pending work is retained for recovery".into())}
    }Ok(())
}
fn uuid(s:&str)->Result<String,String>{uuid::Uuid::parse_str(s).map(|u|u.to_string()).map_err(|_|"Invalid comment/project UUID".into())}
fn read(c:&Connection)->Result<Vec<Value>,String>{let raw:Option<String>=c.query_row("SELECT value FROM sync_state WHERE key=?1",[local_db::scoped_state_key(c,KEY)?],|r|r.get(0)).optional().map_err(|e|e.to_string())?;match raw{Some(s)=>serde_json::from_str(&s).map_err(|e|e.to_string()),None=>Ok(vec![])}}
fn write(c:&Connection,rows:&[Value])->Result<(),String>{c.execute("INSERT INTO sync_state(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![local_db::scoped_state_key(c,KEY)?,serde_json::to_string(rows).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;Ok(())}
fn mutate(c:&mut Connection,account:&str,project:&str,id:Option<&str>,op:&str,body:Option<String>,change:&str)->Result<Value,String>{
    let project=uuid(project)?;let id=match id{Some(id)=>uuid(id)?,None if op=="create"=>local_db::new_uuid(),_=>return Err("Comment ID required".into())};
    if !["create","delete"].contains(&op){return Err("Comments support create and delete only".into())}
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
    local_db::require_sync_account(&tx,account)?;require_comment_project_access(&tx,&project,true)?;
    let mut rows=read(&tx)?;let old=rows.iter().find(|r|r["id"]==id).cloned();
    let record=if op=="create"{
        if old.is_some(){return Err("Comment identity already exists".into())}
        let body=body.ok_or("Comment text required")?;let body=body.trim();if body.is_empty()||body.encode_utf16().count()>5000{return Err("Comment must contain 1–5000 characters".into())}
        let username:String=tx.query_row("SELECT u.username FROM local_users u JOIN local_session s ON s.user_id=u.id WHERE s.id=1",[],|r|r.get(0)).map_err(|e|e.to_string())?;
        let now:String=tx.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')",[],|r|r.get(0)).map_err(|e|e.to_string())?;
        json!({"id":id,"project_id":project,"body":body,"author_id":account,"author_username":username,"created_at":now,"updated_at":now})
    }else{
        let old=old.ok_or("Comment not found")?;if old["project_id"]!=project{return Err("Comment project mismatch".into())}
        let role:String=tx.query_row("SELECT u.role FROM local_users u JOIN local_session s ON s.user_id=u.id WHERE s.id=1",[],|r|r.get(0)).map_err(|e|e.to_string())?;
        if role!="admin"&&old["author_id"]!=account{return Err("Only the author or an administrator can delete this comment".into())}old
    };
    let previous:Option<String>=tx.query_row("SELECT change_id FROM sync_outbox WHERE account_id=?1 AND entity_type='project_comment' AND entity_id=?2 AND synced_at IS NULL ORDER BY rowid DESC LIMIT 1",params![account,id],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
    rows.retain(|r|r["id"]!=id);if op=="create"{rows.push(record.clone());}write(&tx,&rows)?;
    let device:String=tx.query_row("SELECT device_id FROM device_identity",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    tx.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,'project_comment',?3,?4,?5)",params![change,device,id,op,json!({"record":record,"depends_on":previous}).to_string()]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e|e.to_string())?;Ok(if op=="delete"{json!({"id":id,"deleted":true})}else{record})
}
fn pull(c:&mut Connection,account:&str,incoming:Vec<Value>,visible_projects:Vec<String>,complete:bool)->Result<(),String>{
    if !complete{return Err("Incomplete comment snapshot".into())}
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;local_db::require_sync_account(&tx,account)?;local_auth::require_local_permission(&tx,"projects.view")?;
    let mut projects:std::collections::HashSet<String>=visible_projects.into_iter().map(|id|uuid(&id)).collect::<Result<_,_>>()?;
    // A not-yet-synced project owned by this outbox can legitimately have local comments.
    let new_projects:Vec<String>=tx.prepare("SELECT entity_id FROM active_sync_outbox WHERE entity_type='project' AND operation='create' AND synced_at IS NULL").map_err(|e|e.to_string())?.query_map([],|r|r.get(0)).map_err(|e|e.to_string())?.collect::<Result<_,_>>().map_err(|e|e.to_string())?;
    projects.extend(new_projects);
    let pending:std::collections::HashSet<String>=tx.prepare("SELECT entity_id FROM active_sync_outbox WHERE entity_type='project_comment' AND synced_at IS NULL").map_err(|e|e.to_string())?.query_map([],|r|r.get(0)).map_err(|e|e.to_string())?.collect::<Result<_,_>>().map_err(|e|e.to_string())?;
    let mut rows=read(&tx)?;
    rows.retain(|r|pending.contains(r["id"].as_str().unwrap_or(""))&&projects.contains(r["project_id"].as_str().unwrap_or("")));
    for mut row in incoming{
        let id=uuid(row["id"].as_str().ok_or("Comment ID missing")?)?;let project=uuid(row["project_id"].as_str().ok_or("Comment project missing")?)?;
        if !projects.contains(&project){return Err("Comment lies outside the authorized project snapshot".into())}
        if pending.contains(&id){continue}row["id"]=json!(id);row["project_id"]=json!(project);rows.retain(|r|r["id"]!=id);rows.push(row);
    }
    // Revoked content is evicted, but authored intent remains in the recovery outbox.
    write(&tx,&rows)?;
    tx.execute("INSERT INTO sync_state(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![local_db::scoped_state_key(&tx,"comments_visible_projects")?,serde_json::to_string(&projects).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e|e.to_string())
}
#[tauri::command]
pub fn list_local_comments(app:AppHandle,project_id:String,expected_account_id:String)->Result<Vec<Value>,String>{let c=local_db::open_local_connection(&app)?;local_db::require_sync_account(&c,&expected_account_id)?;let project=uuid(&project_id)?;require_comment_project_access(&c,&project,false)?;Ok(read(&c)?.into_iter().filter(|r|r["project_id"]==project).collect())}
#[tauri::command]
pub fn mutate_local_comment(app:AppHandle,project_id:String,id:Option<String>,operation:String,body:Option<String>,expected_account_id:String)->Result<Value,String>{mutate(&mut local_db::open_local_connection(&app)?,&expected_account_id,&project_id,id.as_deref(),&operation,body,&local_db::new_uuid())}
#[tauri::command]
pub fn apply_server_comments_pull(app:AppHandle,records:Vec<Value>,visible_project_ids:Vec<String>,snapshot_complete:bool,expected_account_id:String)->Result<(),String>{pull(&mut local_db::open_local_connection(&app)?,&expected_account_id,records,visible_project_ids,snapshot_complete)}
