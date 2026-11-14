//! Derived edit authority fetched by native code, never provisioned by IPC data.
use crate::{local_auth,local_db,local_resources,native_authorization};
use rusqlite::{params,Connection,OptionalExtension,TransactionBehavior};
use serde::{Deserialize,Serialize};
use std::collections::HashSet;
use sha2::{Digest,Sha256};
use std::sync::atomic::{AtomicBool,Ordering};
use tauri::AppHandle;

// Prevent an older in-flight positive snapshot from overwriting a newer denial.
static REFRESHING:AtomicBool=AtomicBool::new(false);
struct RefreshGuard;
impl Drop for RefreshGuard{fn drop(&mut self){REFRESHING.store(false,Ordering::Release);}}

#[derive(Debug,Deserialize,Serialize,PartialEq)]
#[serde(deny_unknown_fields)]
struct Scope {visibility:String,item_id:Option<String>,project_id:Option<String>,note_id:Option<String>,parent_resource_id:Option<String>}
impl Scope {
    fn from_resource(r:&local_resources::LocalResource)->Self{Self{visibility:r.visibility.clone().unwrap_or_else(||"lab".into()),item_id:r.item_id.clone(),project_id:r.project_id.clone(),note_id:r.note_id.clone(),parent_resource_id:r.parent_resource_id.clone()}}
}
#[derive(Debug,Deserialize,Serialize,PartialEq)]
#[serde(deny_unknown_fields)]
struct NoteBinding {id:String,project_id:Option<String>,visibility:String}
#[derive(Debug,Deserialize,Serialize,PartialEq)]
#[serde(deny_unknown_fields)]
struct Binding {resource_id:String,kind:String,scope:Scope,note:Option<NoteBinding>}
#[derive(Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
struct CachedBindings {revision:String,expires_at:String,bindings:Vec<Binding>}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Grant {resource_id:String,can_edit:bool,#[serde(default)]can_delete:bool,#[serde(default)]can_create_child:bool,revision:Option<String>,scope:Option<Scope>,bindings:Option<Vec<Binding>>}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Snapshot {protocol:u32,account_id:String,grants:Vec<Grant>}
fn err(e:impl std::fmt::Display)->String{e.to_string()}
fn schema(c:&Connection)->Result<(),String>{
    c.execute_batch("CREATE TABLE IF NOT EXISTS local_resource_authority(account_id TEXT NOT NULL,resource_id TEXT NOT NULL,origin TEXT NOT NULL,revision TEXT,scope_json TEXT,can_edit INTEGER NOT NULL,expires_at TEXT NOT NULL,PRIMARY KEY(account_id,resource_id));
    CREATE TABLE IF NOT EXISTS local_resource_authority_bindings(account_id TEXT NOT NULL,resource_id TEXT NOT NULL,bindings_json TEXT NOT NULL,PRIMARY KEY(account_id,resource_id));
    CREATE TABLE IF NOT EXISTS local_resource_confirmations(account_id TEXT NOT NULL,change_id TEXT NOT NULL,resource_id TEXT NOT NULL,device_id TEXT NOT NULL,revision TEXT NOT NULL,PRIMARY KEY(account_id,change_id));
    CREATE TABLE IF NOT EXISTS local_resource_mutation_receipts(account_id TEXT NOT NULL,change_id TEXT NOT NULL,resource_id TEXT NOT NULL,device_id TEXT NOT NULL,origin TEXT NOT NULL,revision TEXT NOT NULL,payload_json TEXT NOT NULL,PRIMARY KEY(account_id,change_id));").map_err(err)?;
    let present={let mut stmt=c.prepare("PRAGMA table_info(local_resource_authority)").map_err(err)?;let names=stmt.query_map([],|r|r.get::<_,String>(1)).map_err(err)?.collect::<Result<Vec<_>,_>>().map_err(err)?;names.iter().any(|name|name=="can_delete")};
    if !present{c.execute_batch("ALTER TABLE local_resource_authority ADD COLUMN can_delete INTEGER NOT NULL DEFAULT 0").map_err(err)?;}
    let present={let mut stmt=c.prepare("PRAGMA table_info(local_resource_authority)").map_err(err)?;let names=stmt.query_map([],|r|r.get::<_,String>(1)).map_err(err)?.collect::<Result<Vec<_>,_>>().map_err(err)?;names.iter().any(|name|name=="can_create_child")};
    if !present{c.execute_batch("ALTER TABLE local_resource_authority ADD COLUMN can_create_child INTEGER NOT NULL DEFAULT 0").map_err(err)?;}
    Ok(())
}
pub(crate) fn guard(c:&Connection,account:&str,session:&str)->Result<String,String>{
    local_db::require_sync_account(c,account)?;
    let (token,lease):(String,String)=c.query_row("SELECT s.session_token,u.offline_expires_at FROM local_session s JOIN local_users u ON u.id=s.user_id WHERE s.id=1",[],|r|Ok((r.get(0)?,r.get(1)?))).map_err(err)?;
    if token!=session{return Err("Native session changed during resource authorization".into())}
    Ok(lease)
}
fn validate(snapshot:&Snapshot,account:&str,ids:&[String])->Result<(),String>{
    if ![2,3,4].contains(&snapshot.protocol)||snapshot.account_id!=account||snapshot.grants.len()!=ids.len(){return Err("Resource authority identity or completeness mismatch".into())}
    let expected:HashSet<&str>=ids.iter().map(String::as_str).collect();let mut seen=HashSet::new();
    for grant in &snapshot.grants {
        if !expected.contains(grant.resource_id.as_str())||!seen.insert(&grant.resource_id){return Err("Unexpected or duplicate resource authority".into())}
        if snapshot.protocol==2&&(grant.can_delete||grant.can_create_child){return Err("Legacy authority cannot grant deletion".into())}
        if grant.can_edit||grant.can_delete||grant.can_create_child {
            if grant.can_create_child&&grant.bindings.as_ref().and_then(|rows|rows.first()).is_none_or(|leaf|leaf.kind!="folder"){return Err("Child authority requires a verified folder".into())}
            let scope=grant.scope.as_ref().ok_or("Resource authority scope missing")?;
            if grant.revision.as_deref().unwrap_or("").is_empty()||!["lab","project","restricted"].contains(&scope.visibility.as_str()){return Err("Invalid resource authority revision or scope".into())}
            for id in [&scope.item_id,&scope.project_id,&scope.note_id,&scope.parent_resource_id].into_iter().flatten(){uuid::Uuid::parse_str(id).map_err(err)?;}
            validate_bindings(&grant.resource_id,scope,grant.bindings.as_deref().ok_or("Resource ancestor bindings missing")?)?;
        }else if grant.scope.is_some()||grant.revision.is_some()||grant.bindings.is_some(){return Err("Denied resource authority must not disclose scope".into())}
    }Ok(())
}

#[tauri::command]
pub async fn refresh_local_resource_authority(app:AppHandle,expected_account_id:String,expected_session_token:String,server_token:String)->Result<usize,String>{
    if REFRESHING.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire).is_err(){return Err("Resource authority refresh is already in progress".into())}
    let _refresh=RefreshGuard;
    if server_token.is_empty()||server_token.starts_with("local:"){return Err("Server connection required to refresh resource authority".into())}
    let (ids,lease)={
        let c=local_db::open_local_connection(&app)?;schema(&c)?;
        let lease=guard(&c,&expected_account_id,&expected_session_token)?;
        let mut ids:Vec<String>=local_resources::read_resources(&c)?.into_iter().map(|r|r.id).collect();
        // Revisit previously cached IDs even if a pull removed their visible row.
        // Otherwise a removed grant could linger until its original lease ends.
        {let mut stmt=c.prepare("SELECT resource_id FROM local_resource_authority WHERE account_id=?1").map_err(err)?;
        for id in stmt.query_map([&expected_account_id],|r|r.get::<_,String>(0)).map_err(err)?{let id=id.map_err(err)?;if !ids.contains(&id){ids.push(id)}}}
        let mut seen=HashSet::new();
        for id in &ids{if uuid::Uuid::parse_str(id).map_err(err)?.to_string()!=*id||!seen.insert(id){return Err("Resource identities need reconciliation before authority refresh".into())}}
        (ids,lease)
    };
    let origin=native_authorization::trusted_base().map_err(|e|e.message)?;
    let client=native_authorization::bulk_client().map_err(|e|e.message)?;
    let mut count=0;
    // Protocol 4 preserves complete chains with 100 IDs and a bounded 2 MiB response.
    // Avoid hundreds of requests exhausting the shared API quota on larger labs.
    for batch in ids.chunks(100){
        {let c=local_db::open_local_connection(&app)?;guard(&c,&expected_account_id,&expected_session_token)?;}
        let response=client.post(format!("{origin}/sync/resources/authority")).bearer_auth(&server_token)
            .json(&serde_json::json!({"protocol":4,"resource_ids":batch})).send().await.map_err(|_|"Resource authority server is unavailable; existing lease-bounded grants are unchanged")?;
        let snapshot:Snapshot=match native_authorization::response_json_limit(response,2*1024*1024).await {
            Ok(value)=>value,
            Err(error)=>{
                if error.code=="AUTH_REVOKED"{let mut c=local_db::open_local_connection(&app)?;local_auth::invalidate_authorization(&mut c,&expected_account_id,&expected_session_token)?;}
                return Err(format!("{}: {}",error.code,error.message));
            }
        };
        validate(&snapshot,&expected_account_id,batch)?;
        let mut c=local_db::open_local_connection(&app)?;schema(&c)?;
        let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(err)?;
        if guard(&tx,&expected_account_id,&expected_session_token)?!=lease{return Err("Login lease changed during resource authorization".into())}
        count+=cache_snapshot(&tx,&expected_account_id,&origin,&lease,snapshot)?;
        tx.commit().map_err(err)?;
    }
    count+=crate::local_resource_destinations::refresh(&app,&expected_account_id,&expected_session_token,&server_token,&lease).await?;
    Ok(count)
}

fn cache_snapshot(tx:&Connection,expected_account_id:&str,origin:&str,lease:&str,snapshot:Snapshot)->Result<usize,String>{
    let count=snapshot.grants.len();
    for grant in snapshot.grants {
            tx.execute("DELETE FROM local_resource_authority_bindings WHERE account_id=?1 AND resource_id=?2",params![expected_account_id,grant.resource_id]).map_err(err)?;
            if let Some(bindings)=grant.bindings{
                let cached=CachedBindings{revision:grant.revision.clone().ok_or("Missing grant revision")?,expires_at:lease.into(),bindings};
                tx.execute("INSERT INTO local_resource_authority_bindings(account_id,resource_id,bindings_json) VALUES(?1,?2,?3)",params![expected_account_id,grant.resource_id,serde_json::to_string(&cached).map_err(err)?]).map_err(err)?;
            }
            let scope=grant.scope.map(|s|serde_json::to_string(&s)).transpose().map_err(err)?;
            tx.execute("INSERT INTO local_resource_authority(account_id,resource_id,origin,revision,scope_json,can_edit,expires_at,can_delete,can_create_child) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9) ON CONFLICT(account_id,resource_id) DO UPDATE SET origin=excluded.origin,revision=excluded.revision,scope_json=excluded.scope_json,can_edit=excluded.can_edit,expires_at=excluded.expires_at,can_delete=excluded.can_delete,can_create_child=excluded.can_create_child",params![expected_account_id,grant.resource_id,origin,grant.revision,scope,grant.can_edit,lease,grant.can_delete,grant.can_create_child]).map_err(err)?;
    }
    Ok(count)
}

#[derive(Debug,PartialEq)]
struct PendingFile {change_id:String,operation:String,payload:String,local_revision:Option<String>,size:i64}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FileReceipt {change_id:String,confirmed:bool,resource_id:Option<String>,operation:Option<String>,revision:Option<String>,size_bytes:Option<i64>,payload_sha256:Option<String>}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Confirmation {protocol:u32,account_id:String,receipts:Vec<FileReceipt>,authority:Snapshot}
fn pending_files(c:&Connection,account:&str,resource:&str,device:&str)->Result<Vec<PendingFile>,String>{
    let mut stmt=c.prepare("SELECT o.change_id,o.operation,o.payload_json,CASE WHEN o.operation='edit_content' THEN e.local_revision ELSE json_extract(u.resource_json,'$.updated_at') END,CASE WHEN o.operation='edit_content' THEN e.size_bytes ELSE u.size_bytes END FROM sync_outbox o LEFT JOIN local_resource_uploads u ON u.account_id=o.account_id AND u.change_id=o.change_id AND u.resource_id=o.entity_id LEFT JOIN local_resource_edits e ON e.account_id=o.account_id AND e.change_id=o.change_id AND e.resource_id=o.entity_id WHERE o.account_id=?1 AND o.entity_type='resource' AND o.entity_id=?2 AND o.device_id=?3 AND o.synced_at IS NULL AND ((o.operation IN ('create','create_copy') AND u.state='ready') OR (o.operation='edit_content' AND e.change_id IS NOT NULL)) ORDER BY o.rowid LIMIT 100").map_err(err)?;
    let rows=stmt.query_map(params![account,resource,device],|r|Ok(PendingFile{change_id:r.get(0)?,operation:r.get(1)?,payload:r.get(2)?,local_revision:r.get(3)?,size:r.get(4)?})).map_err(err)?;
    let rows=rows.collect::<Result<Vec<_>,_>>().map_err(err)?;
    Ok(rows)
}
fn validate_confirmation(reply:&Confirmation,account:&str,resource:&str,pending:&[PendingFile])->Result<(),String>{
    if reply.protocol!=2||reply.account_id!=account||reply.receipts.len()!=pending.len(){return Err("File confirmation identity, protocol or completeness mismatch; update the server and retry the original event".into())}
    validate(&reply.authority,account,&[resource.into()])?;
    let mut seen=HashSet::new();
    for receipt in &reply.receipts{
        let row=pending.iter().find(|r|r.change_id==receipt.change_id).ok_or("Unrequested file confirmation")?;
        if !seen.insert(&receipt.change_id){return Err("Duplicate file confirmation".into())}
        if receipt.confirmed{
            if receipt.resource_id.as_deref()!=Some(resource)||receipt.operation.as_deref()!=Some(row.operation.as_str())||receipt.size_bytes!=Some(row.size)||receipt.revision.as_deref().unwrap_or("").is_empty(){return Err("File confirmation does not match native authored work".into())}
            let payload:serde_json::Value=serde_json::from_str(&row.payload).map_err(err)?;
            let upload=&payload["upload"];
            if payload["resource"]["id"].as_str()!=Some(resource)||upload["protocol"]!=1||upload["size_bytes"].as_i64()!=Some(row.size)||
                !upload["sha256"].as_str().is_some_and(|digest|digest.len()==64&&digest.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)))||
                receipt.payload_sha256.as_deref()!=Some(confirmation_digest(&payload).as_str()){
                return Err("File confirmation differs from the exact saved upload intent; original work remains pending".into())
            }
        }else if receipt.resource_id.is_some()||receipt.operation.is_some()||receipt.size_bytes.is_some()||receipt.revision.is_some()||receipt.payload_sha256.is_some(){return Err("Unconfirmed event must not carry a receipt".into())}
    }Ok(())
}

#[tauri::command]
pub async fn confirm_local_resource_changes(app:AppHandle,expected_account_id:String,expected_session_token:String,server_token:String,change_id:String)->Result<(),String>{
    let proven={
        let c=local_db::open_local_connection(&app)?;crate::local_resource_attachments::schema(&c)?;
        guard(&c,&expected_account_id,&expected_session_token)?;
        let proven:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM local_resource_mutations WHERE account_id=?1 AND change_id=?2)",params![expected_account_id,change_id],|r|r.get(0)).map_err(err)?;
        proven
    };
    if proven{return confirm_local_resource_mutation(app,expected_account_id,expected_session_token,server_token,change_id).await}
    if REFRESHING.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire).is_err(){return Err("Resource authority verification is already in progress".into())}
    let _refresh=RefreshGuard;
    let change_id=uuid::Uuid::parse_str(&change_id).map_err(err)?.to_string();
    if server_token.is_empty()||server_token.starts_with("local:"){return Err("Server connection required to verify file confirmation".into())}
    let (resource,device,pending,lease)={
        let c=local_db::open_local_connection(&app)?;schema(&c)?;crate::local_resource_edits::schema(&c)?;
        let lease=guard(&c,&expected_account_id,&expected_session_token)?;
        let device:String=c.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).map_err(err)?;
        let done:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM local_resource_confirmations f JOIN sync_outbox o ON o.account_id=f.account_id AND o.change_id=f.change_id WHERE f.account_id=?1 AND f.change_id=?2 AND f.device_id=?3 AND o.synced_at IS NOT NULL)",params![expected_account_id,change_id,device],|r|r.get(0)).map_err(err)?;
        if done{return Ok(())}
        let resource:String=c.query_row("SELECT entity_id FROM sync_outbox WHERE account_id=?1 AND change_id=?2 AND entity_type='resource' AND device_id=?3 AND synced_at IS NULL",params![expected_account_id,change_id,device],|r|r.get(0)).map_err(err)?;
        let pending=pending_files(&c,&expected_account_id,&resource,&device)?;
        if !pending.iter().any(|r|r.change_id==change_id){return Err("No native file event matches this confirmation".into())}
        (resource,device,pending,lease)
    };
    let origin=native_authorization::trusted_base().map_err(|e|e.message)?;
    let response=native_authorization::client().map_err(|e|e.message)?.post(format!("{origin}/sync/resources/confirm")).bearer_auth(server_token)
        .json(&serde_json::json!({"protocol":2,"resource_id":resource,"device_id":device,"change_ids":pending.iter().map(|r|&r.change_id).collect::<Vec<_>>()})).send().await.map_err(|_|"File confirmation unavailable; original events and authored bytes remain pending")?;
    let reply:Confirmation=match native_authorization::response_json(response).await{
        Ok(value)=>value,
        Err(error)=>{
            if error.code=="AUTH_REVOKED"{let mut c=local_db::open_local_connection(&app)?;local_auth::invalidate_authorization(&mut c,&expected_account_id,&expected_session_token)?;}
            return Err(format!("{}: {}",error.code,error.message));
        }
    };
    validate_confirmation(&reply,&expected_account_id,&resource,&pending)?;
    let mut c=local_db::open_local_connection(&app)?;
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(err)?;
    if guard(&tx,&expected_account_id,&expected_session_token)?!=lease||pending_files(&tx,&expected_account_id,&resource,&device)?!=pending||native_authorization::trusted_base().map_err(|e|e.message)?!=origin{return Err("File work, server or login lease changed during confirmation; retry the original events".into())}
    let requested_confirmed=reply.receipts.iter().any(|r|r.change_id==change_id&&r.confirmed);
    for receipt in reply.receipts.iter().filter(|r|r.confirmed){
        let revision=receipt.revision.as_deref().ok_or("Missing confirmed revision")?;
        let table=if receipt.operation.as_deref()==Some("edit_content"){"local_resource_edits"}else{"local_resource_uploads"};
        tx.execute(&format!("UPDATE {table} SET server_revision=?1 WHERE account_id=?2 AND change_id=?3 AND resource_id=?4"),params![revision,expected_account_id,receipt.change_id,resource]).map_err(err)?;
        tx.execute("INSERT INTO local_resource_confirmations(account_id,change_id,resource_id,device_id,revision) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(account_id,change_id) DO UPDATE SET revision=excluded.revision",params![expected_account_id,receipt.change_id,resource,device,revision]).map_err(err)?;
        tx.execute("UPDATE sync_outbox SET synced_at=CURRENT_TIMESTAMP,last_error=NULL WHERE account_id=?1 AND change_id=?2",params![expected_account_id,receipt.change_id]).map_err(err)?;
        tx.execute("UPDATE sync_conflicts SET resolved_at=CURRENT_TIMESTAMP,resolution='server_confirmed' WHERE change_id=?1 AND resolved_at IS NULL",params![receipt.change_id]).map_err(err)?;
    }
    let still_pending:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM sync_outbox WHERE account_id=?1 AND entity_type='resource' AND entity_id=?2 AND synced_at IS NULL)",params![expected_account_id,resource],|r|r.get(0)).map_err(err)?;
    if !still_pending{
        let mut resources=local_resources::read_resources(&tx)?;
        if let Some(current)=resources.iter_mut().find(|r|r.id==resource){
            let grant=&reply.authority.grants[0];
            if let Some(revision)=confirmed_projection_revision(current,&pending,&reply.receipts,grant){current.updated_at=revision;local_resources::write_resources(&tx,&resources)?;}
        }
    }
    cache_snapshot(&tx,&expected_account_id,&origin,&lease,reply.authority)?;
    tx.commit().map_err(err)?;
    if !requested_confirmed{return Err("Server has not confirmed this file event; retrying the same identity".into())}Ok(())
}
fn confirmed_projection_revision(current:&local_resources::LocalResource,pending:&[PendingFile],receipts:&[FileReceipt],grant:&Grant)->Option<String>{
    if !grant.can_edit||grant.scope.as_ref()!=Some(&Scope::from_resource(current)){return None}
    let local=pending.iter().rev().find(|r|r.local_revision.as_deref()==Some(current.updated_at.as_str())&&Some(r.size)==current.size_bytes)?;
    let receipt=receipts.iter().find(|r|r.change_id==local.change_id&&r.confirmed)?;
    if receipt.revision!=grant.revision{return None}receipt.revision.clone()
}

pub(crate) fn is_confirmed_file_change(c:&Connection,change:&str)->Result<bool,String>{
    schema(c)?;
    let account=local_db::active_account(c)?;
    c.query_row("SELECT EXISTS(SELECT 1 FROM local_resource_confirmations f JOIN sync_outbox o ON o.account_id=f.account_id AND o.change_id=f.change_id AND o.entity_id=f.resource_id AND o.device_id=f.device_id WHERE f.account_id=?1 AND f.change_id=?2 AND f.device_id=(SELECT device_id FROM device_identity WHERE id=1) AND o.entity_type='resource' AND o.operation IN ('create','create_copy','edit_content') AND o.synced_at IS NOT NULL)",params![account,change],|r|r.get(0)).map_err(err)
}

pub(crate) fn require_verified_file_confirmation(c:&Connection,change:&str)->Result<(),String>{
    let account=local_db::active_account(c)?;
    let mutation:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM sync_outbox WHERE account_id=?1 AND change_id=?2 AND entity_type='resource' AND (operation IN ('attach','edit_metadata','move_tree') OR (operation='create' AND json_extract(payload_json,'$.native_create_protocol')=1)))",params![account,change],|r|r.get(0)).map_err(err)?;
    if mutation {
        if mutation_receipt_revision(c,change)?.is_none(){return Err("Native server verification is required before acknowledging this resource mutation; saved work remains pending".into())}
        return Ok(())
    }
    let file:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM sync_outbox WHERE account_id=?1 AND change_id=?2 AND entity_type='resource' AND operation IN ('create','create_copy','edit_content') AND json_extract(payload_json,'$.upload.protocol')=1)",params![account,change],|r|r.get(0)).map_err(err)?;
    if !file{return Ok(())}schema(c)?;
    let verified:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM local_resource_confirmations WHERE account_id=?1 AND change_id=?2 AND device_id=(SELECT device_id FROM device_identity WHERE id=1))",params![account,change],|r|r.get(0)).map_err(err)?;
    if !verified{return Err("Native server verification is required before acknowledging this file; the original event remains pending".into())}Ok(())
}

// Separate from file receipts: bind the immutable native intent to the trusted
// server origin. A renderer-written ACK flag cannot manufacture this evidence.
pub(crate) fn mutation_receipt_revision(c:&Connection,change:&str)->Result<Option<String>,String>{
    schema(c)?;crate::local_resource_attachments::schema(c)?;
    let account=local_db::active_account(c)?;
    let origin=native_authorization::trusted_base().map_err(|e|e.message)?;
    c.query_row("SELECT f.revision FROM local_resource_mutation_receipts f JOIN sync_outbox o ON o.account_id=f.account_id AND o.change_id=f.change_id AND o.entity_id=f.resource_id AND o.device_id=f.device_id AND o.payload_json=f.payload_json JOIN local_resource_mutations m ON m.account_id=o.account_id AND m.change_id=o.change_id AND m.resource_id=o.entity_id AND m.device_id=o.device_id AND m.operation=o.operation AND m.payload_json=o.payload_json WHERE f.account_id=?1 AND f.change_id=?2 AND f.origin=?3 AND f.device_id=(SELECT device_id FROM device_identity WHERE id=1) AND o.entity_type='resource' AND o.operation IN ('attach','edit_metadata','create','create_copy','edit_content','move_tree')",params![account,change,origin],|r|r.get(0)).optional().map_err(err)
}

// A confirmed metadata/move suffix may change the resource revision without
// changing its bytes. Follow only exact native receipts back to this file event;
// matching file size alone is never evidence that a local copy is current.
pub(crate) fn content_revision_matches(c:&Connection,current:&local_resources::LocalResource,file_change:&str,file_revision:Option<&str>)->Result<bool,String>{
    if file_revision==Some(current.updated_at.as_str()){return Ok(true)}
    schema(c)?;crate::local_resource_attachments::schema(c)?;
    let account=local_db::active_account(c)?;let origin=native_authorization::trusted_base().map_err(|e|e.message)?;
    let candidate:Option<String>=c.query_row("SELECT change_id FROM local_resource_mutation_receipts WHERE account_id=?1 AND resource_id=?2 AND origin=?3 AND revision=?4 ORDER BY rowid DESC LIMIT 1",params![account,current.id,origin,current.updated_at],|r|r.get(0)).optional().map_err(err)?;
    let Some(mut change)=candidate else{return Ok(false)};let mut seen=HashSet::new();
    let identity=|record:&local_resources::LocalResource|serde_json::json!({"id":record.id,"kind":record.kind,"file_type":record.file_type,"original_filename":record.original_filename,"mime_type":record.mime_type,"size_bytes":record.size_bytes,"derived_from_resource_id":record.derived_from_resource_id});
    loop{
        if seen.len()>=128||!seen.insert(change.clone()){return Ok(false)}
        let Some(revision)=mutation_receipt_revision(c,&change)? else{return Ok(false)};
        let proof=mutation_proof(c,&account,&change)?;let after:local_resources::LocalResource=serde_json::from_str(&proof.after).map_err(err)?;
        // A display rename may preserve byte identity only through its exact
        // native confirmed suffix. A renderer/cache-only rename is not proof.
        if seen.len()==1&&(after.name!=current.name||after.name_source!=current.name_source){return Ok(false)}
        if identity(&after)!=identity(current){return Ok(false)}
        if change==file_change{return Ok(file_revision==Some(revision.as_str()))}
        if !["attach","edit_metadata","move_tree"].contains(&proof.operation.as_str()){return Ok(false)}
        let before:local_resources::LocalResource=serde_json::from_str(&proof.before).map_err(err)?;
        if identity(&before)!=identity(&after){return Ok(false)}
        let payload:serde_json::Value=serde_json::from_str(&proof.payload).map_err(err)?;
        let key=if proof.operation=="attach"{"attachment"}else{"metadata"};
        let Some(previous)=payload[key]["previous_change_id"].as_str() else{
            let confirmed:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM local_resource_confirmations f JOIN sync_outbox o ON o.account_id=f.account_id AND o.change_id=f.change_id AND o.entity_id=f.resource_id AND o.device_id=f.device_id WHERE f.account_id=?1 AND f.resource_id=?2 AND f.change_id=?3 AND f.revision=?4 AND o.synced_at IS NOT NULL AND f.device_id=(SELECT device_id FROM device_identity WHERE id=1))",params![account,current.id,file_change,file_revision],|r|r.get(0)).map_err(err)?;
            return Ok(confirmed&&file_revision==Some(before.updated_at.as_str()))
        };change=previous.into();
    }
}

// A previously verified replicated hash remains the same bytes across exact,
// confirmed metadata/topology-only native receipts, even before another fetch.
pub(crate) fn verified_copy_revision(c:&Connection,current:&local_resources::LocalResource,prior:&str)->Result<bool,String>{
 if current.updated_at==prior{return Ok(true)}schema(c)?;let account=local_db::active_account(c)?;let origin=native_authorization::trusted_base().map_err(|e|e.message)?;
 let bytes=|r:&local_resources::LocalResource|serde_json::json!([r.id,r.kind,r.file_type,r.original_filename,r.mime_type,r.size_bytes,r.derived_from_resource_id,r.local_media_path,r.local_media_filename,r.local_media_mime_type,r.local_media_size_bytes,r.local_media_downloaded_at]);
 let mut cursor=current.clone();let mut seen=HashSet::new();
 loop{
  if seen.len()>=128||!seen.insert(cursor.updated_at.clone()){return Ok(false)}
  let change:Option<String>=c.query_row("SELECT change_id FROM local_resource_mutation_receipts WHERE account_id=?1 AND resource_id=?2 AND origin=?3 AND revision=?4 ORDER BY rowid DESC LIMIT 1",params![account,current.id,origin,cursor.updated_at],|r|r.get(0)).optional().map_err(err)?;
  let Some(change)=change else{return Ok(false)};if mutation_receipt_revision(c,&change)?.as_deref()!=Some(cursor.updated_at.as_str()){return Ok(false)}
  let proof=mutation_proof(c,&account,&change)?;if !["attach","edit_metadata","move_tree"].contains(&proof.operation.as_str()){return Ok(false)}
  let mut after:local_resources::LocalResource=serde_json::from_str(&proof.after).map_err(err)?;let before:local_resources::LocalResource=serde_json::from_str(&proof.before).map_err(err)?;after.updated_at=cursor.updated_at.clone();
  if crate::local_resource_attachments::record_identity(&after)?!=crate::local_resource_attachments::record_identity(&cursor)?||bytes(&before)!=bytes(&after)||bytes(&after)!=bytes(current){return Ok(false)}
  if before.updated_at==prior{return Ok(true)}cursor=before;
 }
}

#[derive(Debug,PartialEq)]
struct MutationProof {resource:String,device:String,operation:String,payload:String,before:String,after:String}
fn mutation_proof(c:&Connection,account:&str,change:&str)->Result<MutationProof,String>{
    crate::local_resource_attachments::schema(c)?;
    c.query_row("SELECT o.entity_id,o.device_id,o.operation,o.payload_json,m.before_json,m.after_json FROM sync_outbox o JOIN local_resource_mutations m ON m.account_id=o.account_id AND m.change_id=o.change_id AND m.resource_id=o.entity_id AND m.operation=o.operation AND m.device_id=o.device_id AND m.payload_json=o.payload_json WHERE o.account_id=?1 AND o.change_id=?2 AND o.entity_type='resource' AND o.operation IN ('attach','edit_metadata','create','create_copy','edit_content','move_tree') AND o.device_id=(SELECT device_id FROM device_identity WHERE id=1)",params![account,change],|r|Ok(MutationProof{resource:r.get(0)?,device:r.get(1)?,operation:r.get(2)?,payload:r.get(3)?,before:r.get(4)?,after:r.get(5)?})).map_err(|_|"Native mutation provenance is unavailable; saved work is preserved".into())
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MutationReceipt {change_id:String,confirmed:bool,resource_id:Option<String>,operation:Option<String>,revision:Option<String>,mutation_sha256:Option<String>,payload_sha256:Option<String>,size_bytes:Option<i64>}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MutationConfirmation {protocol:u32,account_id:String,receipts:Vec<MutationReceipt>,authority:Snapshot}
pub(crate) fn confirmation_digest(value:&serde_json::Value)->String{
    fn canonical(value:&serde_json::Value)->String{
        match value{
            serde_json::Value::Array(values)=>format!("[{}]",values.iter().map(canonical).collect::<Vec<_>>().join(",")),
            serde_json::Value::Object(values)=>{
                let mut keys:Vec<_>=values.keys().collect();keys.sort();
                format!("{{{}}}",keys.into_iter().map(|key|format!("{}:{}",serde_json::to_string(key).unwrap(),canonical(&values[key]))).collect::<Vec<_>>().join(","))
            },
            _=>value.to_string(),
        }
    }
    format!("{:x}",Sha256::digest(canonical(value).as_bytes()))
}
#[cfg(test)]
fn validate_mutation_confirmation(reply:&MutationConfirmation,account:&str,change:&str,proof:&MutationProof)->Result<(),String>{
    if ![1,3,4,5].contains(&reply.protocol)||reply.account_id!=account||reply.receipts.len()!=1{return Err("Mutation confirmation identity or completeness mismatch".into())}
    validate(&reply.authority,account,&[proof.resource.clone()])?;
    let receipt=&reply.receipts[0];
    validate_mutation_receipt(reply.protocol,receipt,change,proof)
}
fn validate_mutation_receipt(protocol:u32,receipt:&MutationReceipt,change:&str,proof:&MutationProof)->Result<(),String>{
    if receipt.change_id!=change{return Err("Unexpected mutation confirmation".into())}
    if !receipt.confirmed{
        if receipt.resource_id.is_some()||receipt.operation.is_some()||receipt.revision.is_some()||receipt.mutation_sha256.is_some()||receipt.payload_sha256.is_some()||receipt.size_bytes.is_some(){return Err("Unconfirmed mutation must not disclose a receipt".into())}
        return Ok(())
    }
    let after:local_resources::LocalResource=serde_json::from_str(&proof.after).map_err(err)?;
    let payload:serde_json::Value=serde_json::from_str(&proof.payload).map_err(err)?;
    if ["create","create_copy","edit_content"].contains(&proof.operation.as_str())&&after.kind=="file"{
        if ![3,4,5].contains(&protocol)||receipt.size_bytes!=after.size_bytes||payload["upload"]["protocol"]!=1||payload["upload"]["size_bytes"].as_i64()!=after.size_bytes||!payload["upload"]["sha256"].as_str().is_some_and(|s|s.len()==64&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))){return Err("File receipt differs from native bytes".into())}
    }else if receipt.size_bytes.is_some(){return Err("Metadata receipt cannot publish file bytes".into())}
    if proof.operation=="create"&&after.kind!="file"&&(!["link","folder"].contains(&after.kind.as_str())||payload["native_create_protocol"]!=1||payload["resource"]!=serde_json::to_value(&after).map_err(err)?){return Err("Non-file creation receipt lacks its native origin".into())}
    if payload["metadata"]["fields"].get("name").is_some()&&![4,5].contains(&protocol){return Err("Named metadata requires a protocol-4 exact-name receipt".into())}
    let mut projection=if [4,5].contains(&protocol){crate::local_resource_attachments::named_mutation_projection(&after)}else{crate::local_resource_attachments::mutation_projection(&after)};
    if proof.operation=="move_tree"&&(protocol!=5||!["folder","file","link"].contains(&after.kind.as_str())||payload["tree_move"]["protocol"]!=1){return Err("Tree move requires its exact protocol-5 native receipt".into())}
    if protocol==5{projection["relative_path"]=serde_json::json!(after.relative_path);}
    if after.id!=proof.resource||receipt.resource_id.as_deref()!=Some(proof.resource.as_str())||receipt.operation.as_deref()!=Some(proof.operation.as_str())||receipt.payload_sha256.as_deref()!=Some(confirmation_digest(&payload).as_str())||receipt.mutation_sha256.as_deref()!=Some(confirmation_digest(&projection).as_str())||receipt.revision.as_deref().is_none_or(|r|r.is_empty()||r.len()>64){return Err("Server mutation receipt differs from the native authored intent".into())}
    Ok(())
}

fn pending_proven_prefix(c:&Connection,account:&str,resource:&str)->Result<Vec<(String,MutationProof)>,String>{
    let mut stmt=c.prepare("SELECT change_id FROM sync_outbox WHERE account_id=?1 AND entity_type='resource' AND entity_id=?2 AND synced_at IS NULL ORDER BY rowid LIMIT 100").map_err(err)?;
    let ids=stmt.query_map(params![account,resource],|r|r.get::<_,String>(0)).map_err(err)?.collect::<Result<Vec<_>,_>>().map_err(err)?;
    let mut proofs=Vec::new();for id in ids{match mutation_proof(c,account,&id){Ok(proof)=>proofs.push((id,proof)),Err(_)=>break}}
    Ok(proofs)
}

fn validate_mixed_confirmation(reply:&MutationConfirmation,account:&str,proofs:&[(String,MutationProof)])->Result<(),String>{
    let proof=&proofs.first().ok_or("Empty resource confirmation")?.1;
    if ![3,4,5].contains(&reply.protocol)||reply.account_id!=account||reply.receipts.len()!=proofs.len(){return Err("Mixed confirmation identity or completeness mismatch".into())}
    validate(&reply.authority,account,&[proof.resource.clone()])?;
    let mut seen=HashSet::new();let mut prefix_complete=true;
    for (id,p) in proofs{let receipt=reply.receipts.iter().find(|r|&r.change_id==id).ok_or("Missing mixed resource receipt")?;
        if !seen.insert(&receipt.change_id){return Err("Duplicate mixed resource receipt".into())}validate_mutation_receipt(reply.protocol,receipt,id,p)?;
        if !receipt.confirmed{prefix_complete=false}else if !prefix_complete{return Err("Server receipt skipped an unconfirmed resource predecessor".into())}
    }Ok(())
}

fn publish_file_receipt(c:&Connection,account:&str,change:&str,proof:&MutationProof,revision:&str)->Result<(),String>{
    if c.is_autocommit(){return Err("File confirmation requires the native transaction".into())}
    let after:local_resources::LocalResource=serde_json::from_str(&proof.after).map_err(err)?;
    if after.kind=="file"&&["create","create_copy","edit_content"].contains(&proof.operation.as_str()){
            let table=if proof.operation=="edit_content"{"local_resource_edits"}else{"local_resource_uploads"};
            if c.execute(&format!("UPDATE {table} SET server_revision=?1 WHERE account_id=?2 AND change_id=?3 AND resource_id=?4"),params![revision,account,change,proof.resource]).map_err(err)?!=1{return Err("Native file provenance disappeared during confirmation".into())}
            c.execute("INSERT INTO local_resource_confirmations(account_id,change_id,resource_id,device_id,revision) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(account_id,change_id) DO UPDATE SET revision=excluded.revision",params![account,change,proof.resource,proof.device,revision]).map_err(err)?;
        }
    Ok(())
}

#[tauri::command]
pub async fn confirm_local_resource_mutation(app:AppHandle,expected_account_id:String,expected_session_token:String,server_token:String,change_id:String)->Result<(),String>{
    if REFRESHING.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire).is_err(){return Err("Resource authority verification is already in progress".into())}
    let _refresh=RefreshGuard;
    let change=uuid::Uuid::parse_str(&change_id).map_err(err)?.to_string();
    if server_token.is_empty()||server_token.starts_with("local:"){return Err("Reconnect to verify resource mutation receipts".into())}
    let (proofs,lease)={let c=local_db::open_local_connection(&app)?;schema(&c)?;let lease=guard(&c,&expected_account_id,&expected_session_token)?;let proof=mutation_proof(&c,&expected_account_id,&change)?;
        if mutation_receipt_revision(&c,&change)?.is_some(){return Ok(())}
        let proofs=pending_proven_prefix(&c,&expected_account_id,&proof.resource)?;
        if !proofs.iter().any(|(id,_)|id==&change){return Err("Confirm the preceding native resource events first".into())}(proofs,lease)};
    let proof=&proofs[0].1;
    let protocol=if proofs.iter().any(|(_,p)|p.operation=="move_tree"){5}else if proofs.iter().any(|(_,p)|serde_json::from_str::<serde_json::Value>(&p.payload).ok().is_some_and(|payload|payload["metadata"]["fields"].get("name").is_some())){4}else{3};
    let origin=native_authorization::trusted_base().map_err(|e|e.message)?;
    let response=native_authorization::client().map_err(|e|e.message)?.post(format!("{origin}/sync/resources/confirm")).bearer_auth(server_token)
        .json(&serde_json::json!({"protocol":protocol,"resource_id":proof.resource,"device_id":proof.device,"change_ids":proofs.iter().map(|(id,_)|id).collect::<Vec<_>>()})).send().await.map_err(|_|"Mutation confirmation unavailable; original intent remains pending")?;
    let reply:MutationConfirmation=match native_authorization::response_json(response).await{
        Ok(value)=>value,
        Err(error)=>{if error.code=="AUTH_REVOKED"{let mut c=local_db::open_local_connection(&app)?;local_auth::invalidate_authorization(&mut c,&expected_account_id,&expected_session_token)?;}return Err(format!("{}: {}",error.code,error.message));}
    };
    validate_mixed_confirmation(&reply,&expected_account_id,&proofs)?;
    let mut c=local_db::open_local_connection(&app)?;
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(err)?;
    if guard(&tx,&expected_account_id,&expected_session_token)?!=lease||pending_proven_prefix(&tx,&expected_account_id,&proof.resource)?!=proofs||native_authorization::trusted_base().map_err(|e|e.message)?!=origin{return Err("Resource work, server or login lease changed during confirmation".into())}
    let confirmed=reply.receipts.iter().any(|r|r.change_id==change&&r.confirmed);
    for (change,proof) in &proofs{let receipt=reply.receipts.iter().find(|r|&r.change_id==change).ok_or("Missing resource receipt")?;
    if receipt.confirmed{
        // Confirm only an acknowledged prefix. A later server receipt must not
        // strand an earlier local scope/content transition after a partial ACK.
        let earlier:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM sync_outbox WHERE account_id=?1 AND entity_type='resource' AND entity_id=?2 AND synced_at IS NULL AND rowid<(SELECT rowid FROM sync_outbox WHERE account_id=?1 AND change_id=?3))",params![expected_account_id,proof.resource,change],|r|r.get(0)).map_err(err)?;
        if earlier{return Err("Verify the preceding resource change before acknowledging this version".into())}
        let revision=receipt.revision.as_deref().ok_or("Confirmed mutation revision missing")?;
        publish_file_receipt(&tx,&expected_account_id,change,proof,revision)?;
        tx.execute("INSERT INTO local_resource_mutation_receipts(account_id,change_id,resource_id,device_id,origin,revision,payload_json) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(account_id,change_id) DO UPDATE SET origin=excluded.origin,revision=excluded.revision,payload_json=excluded.payload_json",params![expected_account_id,change,proof.resource,proof.device,origin,revision,proof.payload]).map_err(err)?;
        tx.execute("UPDATE sync_outbox SET synced_at=CURRENT_TIMESTAMP,last_error=NULL WHERE account_id=?1 AND change_id=?2",params![expected_account_id,change]).map_err(err)?;
        tx.execute("UPDATE sync_conflicts SET resolved_at=CURRENT_TIMESTAMP,resolution='server_confirmed' WHERE change_id=?1 AND resolved_at IS NULL",[&change]).map_err(err)?;
        let pending:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM sync_outbox WHERE account_id=?1 AND entity_type='resource' AND entity_id=?2 AND synced_at IS NULL)",params![expected_account_id,proof.resource],|r|r.get(0)).map_err(err)?;
        if !pending{
            let after:local_resources::LocalResource=serde_json::from_str(&proof.after).map_err(err)?;
            let mut resources=local_resources::read_resources(&tx)?;
            if let Some(current)=resources.iter_mut().find(|r|r.id==proof.resource){
                let grant=&reply.authority.grants[0];
                if grant.can_edit&&grant.revision.as_deref()==Some(revision)&&grant.scope.as_ref()==Some(&Scope::from_resource(&after))&&crate::local_resource_attachments::record_identity(current)?==crate::local_resource_attachments::record_identity(&after)?{
                    current.updated_at=revision.into();local_resources::write_resources(&tx,&resources)?;
                }
            }
        }
    }
    }
    cache_snapshot(&tx,&expected_account_id,&origin,&lease,reply.authority)?;
    tx.commit().map_err(err)?;
    if !confirmed{return Err("Server has not confirmed this mutation; retry the original identity".into())}Ok(())
}

pub(crate) fn require_edit(c:&Connection,resource:&local_resources::LocalResource)->Result<(),String>{
    require_edit_snapshot(c,resource,false)
}

// Reconstruct the origin from native-only full mutation provenance. Current
// rights at the origin, every pending destination and copy ancestry are checked;
// a receipt proves history and cannot grant authority by itself.
pub(crate) fn require_pending_mutation_editor(c:&Connection,current:&local_resources::LocalResource)->Result<Option<String>,String>{
    let Some((origin,previous))=crate::local_resource_attachments::pending_mutation_origin(c,current)? else{return Ok(None)};
    local_auth::require_local_permission(c,"resources.view")?;
    local_auth::require_local_permission(c,"resources.edit")?;
    let role:String=c.query_row("SELECT u.role FROM local_users u JOIN local_session s ON s.user_id=u.id WHERE s.id=1",[],|r|r.get(0)).map_err(err)?;
    if !require_pending_creation_origin(c,&origin)?&&role!="admin"{require_edit_snapshot(c,&origin,true)?;}
    Ok(Some(previous))
}

fn require_pending_nonfile_creation(c:&Connection,current:&local_resources::LocalResource)->Result<bool,String>{
    if !["folder","link"].contains(&current.kind.as_str()){return Ok(false)}
    crate::local_resource_attachments::schema(c)?;let account=local_db::active_account(c)?;
    let proof:Option<(String,String,String,bool)>=c.query_row("SELECT m.before_json,m.after_json,m.payload_json,EXISTS(SELECT 1 FROM sync_conflicts f WHERE f.change_id=o.change_id AND f.resolved_at IS NULL) FROM sync_outbox o JOIN local_resource_mutations m ON m.account_id=o.account_id AND m.change_id=o.change_id AND m.resource_id=o.entity_id AND m.device_id=o.device_id AND m.operation=o.operation AND m.payload_json=o.payload_json WHERE o.account_id=?1 AND o.entity_id=?2 AND o.entity_type='resource' AND o.operation='create' AND o.synced_at IS NULL AND o.device_id=(SELECT device_id FROM device_identity WHERE id=1) AND json_extract(o.payload_json,'$.native_create_protocol')=1",params![account,current.id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(err)?;
    let Some((before,after,payload,conflict))=proof else{return Ok(false)};
    let original:local_resources::LocalResource=serde_json::from_str(&after).map_err(err)?;
    let before:local_resources::LocalResource=serde_json::from_str(&before).map_err(err)?;
    let payload:serde_json::Value=serde_json::from_str(&payload).map_err(err)?;
    if conflict||payload["native_create_protocol"]!=1||payload["resource"]!=serde_json::to_value(&original).map_err(err)?||crate::local_resource_attachments::record_identity(&before)?!=crate::local_resource_attachments::record_identity(&original)?||crate::local_resource_attachments::record_identity(&original)?!=crate::local_resource_attachments::record_identity(current)?{return Err("Native folder/link creation changed or is conflicted; authored work is preserved".into())}
    local_auth::require_local_permission(c,"resources.create")?;crate::local_resource_uploads::parent_guard(c,&serde_json::to_value(&original).map_err(err)?)?;Ok(true)
}

fn require_pending_creation_origin(c:&Connection,origin:&local_resources::LocalResource)->Result<bool,String>{
    if origin.kind!="file"{return require_pending_nonfile_creation(c,origin)}
    crate::local_resource_uploads::schema(c)?;
    let account=local_db::active_account(c)?;
    let row:Option<(String,String,String)>=c.query_row("SELECT u.resource_json,o.operation,o.payload_json FROM local_resource_uploads u JOIN sync_outbox o ON o.account_id=u.account_id AND o.change_id=u.change_id WHERE u.account_id=?1 AND u.resource_id=?2 AND u.state='ready' AND u.server_revision IS NULL AND o.synced_at IS NULL AND o.device_id=(SELECT device_id FROM device_identity WHERE id=1)",params![account,origin.id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(err)?;
    let Some((raw,operation,payload))=row else{return Ok(false)};
    let original:local_resources::LocalResource=serde_json::from_str(&raw).map_err(err)?;let payload=serde_json::from_str(&payload).map_err(err)?;
    if !valid_creation_proof(&original,origin,&operation,&payload)||crate::local_resource_attachments::record_identity(&original)?!=crate::local_resource_attachments::record_identity(origin)?{return Err("Native creation origin changed; saved work is preserved".into())}
    local_auth::require_local_permission(c,"resources.create")?;crate::local_resource_uploads::parent_guard(c,&serde_json::to_value(&original).map_err(err)?)?;
    if let Some(source)=&original.derived_from_resource_id{let record=local_resources::read_resources(c)?.into_iter().find(|r|&r.id==source).ok_or("Copy source unavailable; authored bytes are preserved")?;crate::resource_dependencies::require_editor_access(c,&record)?;}
    Ok(true)
}

fn require_edit_snapshot(c:&Connection,resource:&local_resources::LocalResource,pending_move_origin:bool)->Result<(),String>{
    require_action_snapshot(c,resource,pending_move_origin,ResourceAction::Edit)
}

pub(crate) fn require_delete(c:&Connection,resource:&local_resources::LocalResource)->Result<(),String>{
    crate::local_resource_tree_moves::require_no_pending_tree(c,&resource.id)?;
    local_auth::require_local_permission(c,"resources.view")?;
    local_auth::require_local_permission(c,"resources.delete")?;
    crate::local_resource_posters::schema(c)?;
    let account=local_db::active_account(c)?;
    let own=if let Some((origin,_))=crate::local_resource_attachments::pending_mutation_origin(c,resource)?{
        if require_pending_creation_origin(c,&origin)?{true}else{require_action_snapshot(c,&origin,true,ResourceAction::Delete)?;false}
    }else if require_pending_creation_origin(c,resource)?{true}else{require_action_snapshot(c,resource,false,ResourceAction::Delete)?;false};
    let denied:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM local_resource_poster_denials WHERE account_id=?1 AND resource_id=?2)",params![account,resource.id],|r|r.get(0)).map_err(err)?;
    if denied&&!own{return Err("Resource access revoked; saved work is preserved".into())}
    Ok(())
}

enum ResourceAction{Edit,Delete,CreateChild}

pub(crate) fn require_folder_destination(c:&Connection,folder:&local_resources::LocalResource)->Result<(),String>{
    crate::local_resource_tree_moves::require_no_pending_tree(c,&folder.id)?;
    if folder.kind!="folder"{return Err("Resource destination is not a folder".into())}
    local_auth::require_local_permission(c,"resources.view")?;
    if local_auth::require_local_permission(c,"resources.create").is_err(){local_auth::require_local_permission(c,"resources.edit")?;}
    let pending=crate::local_resource_attachments::pending_mutation_origin(c,folder)?;
    let (origin,projected)=pending.as_ref().map(|(origin,_)|(origin,true)).unwrap_or((folder,false));
    if require_pending_creation_origin(c,origin)?{return Ok(())}
    crate::local_resource_posters::schema(c)?;
    let account=local_db::active_account(c)?;
    let denied:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM local_resource_poster_denials WHERE account_id=?1 AND resource_id=?2)",params![account,folder.id],|r|r.get(0)).map_err(err)?;
    if denied{return Err("Folder access revoked; saved work is preserved".into())}
    require_action_snapshot(c,origin,projected,ResourceAction::CreateChild)
}

fn require_action_snapshot(c:&Connection,resource:&local_resources::LocalResource,pending_move_origin:bool,action:ResourceAction)->Result<(),String>{
    schema(c)?;let account=local_db::active_account(c)?;
    let origin=native_authorization::trusted_base().map_err(|e|e.message)?;
    let grant:Option<(Option<String>,Option<String>,bool)>=c.query_row(&format!("SELECT revision,scope_json,{} FROM local_resource_authority WHERE account_id=?1 AND resource_id=?2 AND origin=?3 AND datetime('now')<datetime(expires_at) AND expires_at=(SELECT u.offline_expires_at FROM local_users u JOIN local_session s ON s.user_id=u.id WHERE s.id=1)",match action{ResourceAction::Edit=>"can_edit",ResourceAction::Delete=>"can_delete",ResourceAction::CreateChild=>"can_create_child"}),params![account,resource.id,origin],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(err)?;
    let (revision,scope,allowed)=grant.ok_or("Record action authority is not cached or has expired. Connect once to refresh it; your local work is preserved.")?;
    let scope:Option<Scope>=scope.map(|raw|serde_json::from_str(&raw)).transpose().map_err(err)?;
    // Owner-approved content-only lease continuity: never a blanket revision
    // bypass. A mismatched revision needs a native-published content chain.
    if !allowed||scope.as_ref()!=Some(&Scope::from_resource(resource)){return Err("Cached action authority does not cover this resource attachment and visibility".into())}
    let raw:Option<String>=c.query_row("SELECT bindings_json FROM local_resource_authority_bindings WHERE account_id=?1 AND resource_id=?2",params![account,resource.id],|r|r.get(0)).optional().map_err(err)?;
    let cached:CachedBindings=serde_json::from_str(&raw.ok_or("Connect once to verify this resource's complete ancestor authority; saved work is preserved")?).map_err(err)?;
    let lease:String=c.query_row("SELECT u.offline_expires_at FROM local_users u JOIN local_session s ON s.user_id=u.id WHERE s.id=1",[],|r|r.get(0)).map_err(err)?;
    if Some(cached.revision.as_str())!=revision.as_deref()||cached.expires_at!=lease{return Err("Ancestor snapshot does not belong to the current verified grant".into())}
    let bindings=cached.bindings;
    validate_bindings(&resource.id,&Scope::from_resource(resource),&bindings)?;
    let mut resources=local_resources::read_resources(c)?;
    if pending_move_origin{
        // Only the verified leaf is projected back for comparison; its ancestors
        // and attached note must still match their actual current local records.
        let leaf=resources.iter_mut().find(|r|r.id==resource.id).ok_or("Resource unavailable on this PC")?;
        *leaf=resource.clone();
    }
    let notes=if bindings.iter().any(|b|b.note.is_some()){crate::local_notes::load(c)?}else{Vec::new()};
    if !bindings_match_local(&bindings,&resources,&notes){return Err("An authorized folder or note is missing or has changed scope. Reconnect to verify access; saved work is preserved".into())}
    if !matches_resource(allowed,revision.as_deref(),scope.as_ref(),resource)&&!native_content_chain(c,&account,resource,revision.as_deref().ok_or("Missing verified authority revision")?,None)?{return Err("Resource version is not covered by verified authority or its native content-edit chain".into())}
    Ok(())
}
fn matches_resource(allowed:bool,revision:Option<&str>,scope:Option<&Scope>,resource:&local_resources::LocalResource)->bool{
    allowed&&revision==Some(resource.updated_at.as_str())&&scope==Some(&Scope::from_resource(resource))
}

fn validate_bindings(id:&str,scope:&Scope,bindings:&[Binding])->Result<(),String>{
    if bindings.is_empty()||bindings.len()>32||bindings[0].resource_id!=id||&bindings[0].scope!=scope{return Err("Incomplete resource ancestor authority".into())}
    let mut seen=HashSet::new();let mut projects=HashSet::new();
    for (index,binding) in bindings.iter().enumerate(){
        if uuid::Uuid::parse_str(&binding.resource_id).map_err(err)?.to_string()!=binding.resource_id||!seen.insert(&binding.resource_id)||(index>0&&binding.kind!="folder")||!["lab","project","restricted"].contains(&binding.scope.visibility.as_str()){
            return Err("Invalid resource ancestor identity or kind".into())
        }
        let parents=[&binding.scope.item_id,&binding.scope.project_id,&binding.scope.note_id,&binding.scope.parent_resource_id];
        if parents.iter().filter(|id|id.is_some()).count()>1||binding.scope.parent_resource_id.as_deref()!=bindings.get(index+1).map(|b|b.resource_id.as_str()){return Err("Broken resource ancestor chain".into())}
        for parent in parents.into_iter().flatten(){if uuid::Uuid::parse_str(parent).map_err(err)?.to_string()!=*parent{return Err("Noncanonical resource ancestor ID".into())}}
        if let Some(project)=&binding.scope.project_id{projects.insert(project.as_str());}
        match (&binding.scope.note_id,&binding.note){
            (None,None)=>{},
            (Some(id),Some(note)) if id==&note.id=>{
                if !["lab","project","restricted"].contains(&note.visibility.as_str()){return Err("Invalid ancestor note visibility".into())}
                if let Some(project)=&note.project_id{if uuid::Uuid::parse_str(project).map_err(err)?.to_string()!=*project{return Err("Noncanonical note project ID".into())}projects.insert(project.as_str());}
            },
            _=>return Err("Missing or mismatched ancestor note".into()),
        }
    }
    if projects.len()>1{return Err("Conflicting ancestor projects".into())}Ok(())
}

fn bindings_match_local(bindings:&[Binding],resources:&[local_resources::LocalResource],notes:&[serde_json::Value])->bool{
    bindings.iter().all(|binding|{
        let mut matches=resources.iter().filter(|r|r.id==binding.resource_id);
        let Some(resource)=matches.next() else{return false};
        if matches.next().is_some()||resource.kind!=binding.kind||Scope::from_resource(resource)!=binding.scope{return false}
        if let Some(note)=&binding.note{
            let mut matches=notes.iter().filter(|n|n["id"].as_str()==Some(note.id.as_str()));
            let Some(local)=matches.next() else{return false};
            if matches.next().is_some()||local["project_id"].as_str()!=note.project_id.as_deref()||local["visibility"].as_str().unwrap_or("lab")!=note.visibility{return false}
        }true
    })
}

struct EditProof {id:String,previous:Option<String>,base:String,local:String,confirmed:Option<String>,size:i64}
fn carries_authority(revision:&str,size:Option<i64>,granted:&str,rows:&[EditProof])->bool{
    let Some(mut row)=rows.iter().find(|r|r.local==revision&&Some(r.size)==size) else{return false};
    let mut seen=HashSet::new();
    loop{
        if !seen.insert(&row.id){return false}
        if row.confirmed.as_deref()==Some(granted)||row.base==granted{return true}
        let Some(previous)=row.previous.as_ref() else{return false};
        let Some(prior)=rows.iter().find(|r|&r.id==previous) else{return false};
        if row.base!=prior.local&&Some(row.base.as_str())!=prior.confirmed.as_deref(){return false}
        row=prior;
    }
}
fn native_content_chain(c:&Connection,account:&str,resource:&local_resources::LocalResource,granted:&str,creation:Option<&str>)->Result<bool,String>{
    schema(c)?;
    crate::local_resource_edits::schema(c)?;
    // A chain must remain content-only. Pending scope/metadata work requires
    // explicit reconciliation instead of inheriting the old record authority.
    let other:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM sync_outbox WHERE account_id=?1 AND entity_type='resource' AND entity_id=?2 AND synced_at IS NULL AND operation<>'edit_content' AND (?3 IS NULL OR change_id<>?3))",params![account,resource.id,creation],|r|r.get(0)).map_err(err)?;
    if other{return Ok(false)}
    let mut stmt=c.prepare("SELECT e.change_id,e.local_revision,e.server_revision,e.size_bytes,o.payload_json FROM local_resource_edits e JOIN sync_outbox o ON o.change_id=e.change_id AND o.account_id=e.account_id WHERE e.account_id=?1 AND e.resource_id=?2 AND e.local_revision IS NOT NULL AND o.entity_type='resource' AND o.entity_id=e.resource_id AND o.operation='edit_content' AND o.device_id=(SELECT device_id FROM device_identity WHERE id=1) AND (o.synced_at IS NULL OR e.server_revision IS NOT NULL) ORDER BY e.rowid DESC LIMIT 1024").map_err(err)?;
    let mapped=stmt.query_map(params![account,resource.id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,Option<String>>(2)?,r.get::<_,i64>(3)?,r.get::<_,String>(4)?))).map_err(err)?;
    let mut proofs=Vec::new();
    for row in mapped{
        let (id,local,confirmed,size,raw)=row.map_err(err)?;let payload:serde_json::Value=serde_json::from_str(&raw).map_err(err)?;
        if payload["edit"]["protocol"]!=1||payload["upload"]["protocol"]!=1{return Ok(false)}
        let Some(base)=payload["edit"]["expected_updated_at"].as_str() else{return Ok(false)};
        proofs.push(EditProof{id,local,confirmed,size,base:base.into(),previous:payload["edit"]["previous_change_id"].as_str().map(str::to_owned)});
    }
    // A pending edit may have been authored before its creation was confirmed.
    // Bridge that original local revision only through a native-verified receipt.
    let creation:Option<(String,String,String,i64)>=c.query_row("SELECT u.change_id,u.resource_json,f.revision,u.size_bytes FROM local_resource_uploads u JOIN local_resource_confirmations f ON f.account_id=u.account_id AND f.change_id=u.change_id AND f.resource_id=u.resource_id JOIN sync_outbox o ON o.account_id=u.account_id AND o.change_id=u.change_id WHERE u.account_id=?1 AND u.resource_id=?2 AND u.state='ready' AND o.operation IN ('create','create_copy') AND o.synced_at IS NOT NULL AND f.device_id=(SELECT device_id FROM device_identity WHERE id=1)",params![account,resource.id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(err)?;
    if let Some((id,raw,confirmed,size))=creation{
        let original:local_resources::LocalResource=serde_json::from_str(&raw).map_err(err)?;
        if original.id==resource.id&&original.kind=="file"&&Scope::from_resource(&original)==Scope::from_resource(resource){
            proofs.push(EditProof{id,previous:None,base:original.updated_at.clone(),local:original.updated_at,confirmed:Some(confirmed),size});
        }
    }
    Ok(carries_authority(&resource.updated_at,resource.size_bytes,granted,&proofs))
}

// A new native file has no server grant yet. Its own unpublished creation is
// evidence of authorship, not permission to edit a downloaded/confirmed file.
pub(crate) fn require_own_pending_creation(c:&Connection,current:&local_resources::LocalResource)->Result<bool,String>{
    if current.kind!="file"{return require_pending_nonfile_creation(c,current)}
    crate::local_resource_edits::schema(c)?;
    local_auth::require_local_permission(c,"resources.view")?;
    local_auth::require_local_permission(c,"resources.edit")?;
    let account=local_db::active_account(c)?;
    let row:Option<(String,String,String,String)>=c.query_row("SELECT u.change_id,u.resource_json,o.operation,o.payload_json FROM local_resource_uploads u JOIN sync_outbox o ON o.account_id=u.account_id AND o.change_id=u.change_id WHERE u.account_id=?1 AND u.resource_id=?2 AND u.state='ready' AND u.server_revision IS NULL AND o.entity_type='resource' AND o.entity_id=u.resource_id AND o.operation IN ('create','create_copy') AND o.synced_at IS NULL AND o.device_id=(SELECT device_id FROM device_identity WHERE id=1)",params![account,current.id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(err)?;
    let Some((change,raw,operation,payload))=row else{return Ok(false)};
    local_auth::require_local_permission(c,"resources.create")?;
    let original:local_resources::LocalResource=serde_json::from_str(&raw).map_err(err)?;
    let payload:serde_json::Value=serde_json::from_str(&payload).map_err(err)?;
    if !valid_creation_proof(&original,current,&operation,&payload){return Err("Native creation identity or scope changed; saved work is preserved".into())}
    // Only a native content chain can follow this one supported creation.
    // Conflicts, moves and arbitrary metadata intents do not inherit its rights.
    crate::resource_dependencies::source_predecessor(c,&current.id)?;
    crate::local_resource_uploads::parent_guard(c,&serde_json::to_value(&original).map_err(err)?)?;
    if original.updated_at==current.updated_at&&original.size_bytes==current.size_bytes{return Ok(true)}
    if !native_content_chain(c,&account,current,&original.updated_at,Some(&change))?{return Err("Local version does not descend from its native creation".into())}
    Ok(true)
}
fn valid_creation_proof(original:&local_resources::LocalResource,current:&local_resources::LocalResource,operation:&str,payload:&serde_json::Value)->bool{
    if original.kind!="file"||current.kind!="file"||original.id!=current.id||Scope::from_resource(original)!=Scope::from_resource(current)||
        original.file_type!=current.file_type||original.original_filename!=current.original_filename||original.mime_type!=current.mime_type||original.derived_from_resource_id!=current.derived_from_resource_id||
        payload["upload"]["protocol"]!=1||payload["upload"]["size_bytes"].as_i64()!=original.size_bytes||
        serde_json::to_value(original).ok().as_ref()!=Some(&payload["resource"]){return false}
    match operation{
        "create"=>original.derived_from_resource_id.is_none()&&payload.get("copy").is_none(),
        "create_copy"=>original.derived_from_resource_id.as_deref().is_some_and(|source|source!=original.id&&payload["copy"]["protocol"]==1&&payload["copy"]["source_id"].as_str()==Some(source)),
        _=>false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const ID:&str="11111111-1111-4111-8111-111111111111";
    #[test]
    fn mutation_digests_match_server_unicode_and_ordering_contract(){
        assert_eq!(confirmation_digest(&serde_json::json!({"z":["é","😀","\n"],"a":{"protocol":1,"empty":null}})),"9cb97ba7feb7f5caab3d881124865586e18261b9dd323263dd531ed5a7beb544");
        assert_ne!(confirmation_digest(&serde_json::json!(["first","second"])),confirmation_digest(&serde_json::json!(["second","first"])));
    }
    #[test]
    fn named_receipts_require_exact_display_name_provenance_and_protocol(){
        let (mut reply,mut proof)=mutation_confirmation();let mut after:local_resources::LocalResource=serde_json::from_str(&proof.after).unwrap();after.name="Reviewed name".into();after.name_source=Some("user".into());proof.after=serde_json::to_string(&after).unwrap();
        let mut payload:serde_json::Value=serde_json::from_str(&proof.payload).unwrap();payload["metadata"]["fields"]["name"]=serde_json::json!(after.name);proof.payload=payload.to_string();reply.receipts[0].payload_sha256=Some(confirmation_digest(&payload));
        reply.receipts[0].mutation_sha256=Some(confirmation_digest(&crate::local_resource_attachments::named_mutation_projection(&after)));reply.protocol=4;
        validate_mutation_confirmation(&reply,"account","change",&proof).unwrap();reply.protocol=3;assert!(validate_mutation_confirmation(&reply,"account","change",&proof).is_err());reply.protocol=4;
        after.name="Different".into();proof.after=serde_json::to_string(&after).unwrap();assert!(validate_mutation_confirmation(&reply,"account","change",&proof).is_err());
    }
    #[test]
    fn tree_receipt_requires_protocol_five_exact_path_payload_and_native_root(){
        let (mut reply,mut proof)=mutation_confirmation();
        let mut after:local_resources::LocalResource=serde_json::from_str(&proof.after).unwrap();after.kind="folder".into();after.file_type="other".into();after.size_bytes=None;after.relative_path=Some("Folder".into());
        let payload=serde_json::json!({"id":proof.resource,"tree_move":{"protocol":1,"members":[{"id":proof.resource}],"destination":{"parent_resource_id":after.parent_resource_id}}});
        proof.operation="move_tree".into();proof.after=serde_json::to_string(&after).unwrap();proof.payload=payload.to_string();reply.protocol=5;
        let receipt=&mut reply.receipts[0];receipt.operation=Some("move_tree".into());receipt.size_bytes=None;receipt.payload_sha256=Some(confirmation_digest(&payload));let mut projection=crate::local_resource_attachments::named_mutation_projection(&after);projection["relative_path"]=serde_json::json!(after.relative_path);receipt.mutation_sha256=Some(confirmation_digest(&projection));
        validate_mutation_receipt(5,&reply.receipts[0],&reply.receipts[0].change_id,&proof).unwrap();
        assert!(validate_mutation_receipt(4,&reply.receipts[0],&reply.receipts[0].change_id,&proof).is_err());
        reply.receipts[0].mutation_sha256=Some("0".repeat(64));assert!(validate_mutation_receipt(5,&reply.receipts[0],&reply.receipts[0].change_id,&proof).is_err());
    }

    #[test]
    fn nonfile_creation_confirmation_never_requires_or_manufactures_upload_provenance(){
        for kind in ["link","folder"]{
            let (_,mut proof)=mutation_confirmation();let mut after:local_resources::LocalResource=serde_json::from_str(&proof.after).unwrap();after.kind=kind.into();proof.operation="create".into();proof.after=serde_json::to_string(&after).unwrap();
            let mut c=Connection::open_in_memory().unwrap();let tx=c.transaction().unwrap();publish_file_receipt(&tx,"account","change",&proof,"revision").unwrap();
            assert_eq!(tx.query_row("SELECT count(*) FROM sqlite_master WHERE name IN ('local_resource_uploads','local_resource_confirmations')",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        }
    }
    fn mutation_confirmation()->(MutationConfirmation,MutationProof){
        let after:local_resources::LocalResource=serde_json::from_value(serde_json::json!({"id":ID,"name":"sample","kind":"file","file_type":"text","tags":["lab"],"description":"saved","visibility":"restricted","updated_at":"2026-10-13T12:00:00.000Z","created_at":"2026-10-13T12:00:00.000Z"})).unwrap();
        let payload=serde_json::json!({"id":ID,"metadata":{"protocol":1,"fields":{"description":"saved"},"previous_change_id":null,"expected_updated_at":after.updated_at}});
        let proof=MutationProof{resource:ID.into(),device:"device".into(),operation:"edit_metadata".into(),payload:payload.to_string(),before:serde_json::to_string(&after).unwrap(),after:serde_json::to_string(&after).unwrap()};
        let receipt=MutationReceipt{change_id:"change".into(),confirmed:true,resource_id:Some(ID.into()),operation:Some("edit_metadata".into()),revision:Some("2026-10-13T12:00:00.000Z".into()),mutation_sha256:Some(confirmation_digest(&crate::local_resource_attachments::mutation_projection(&after))),payload_sha256:Some(confirmation_digest(&payload)),size_bytes:None};
        (MutationConfirmation{protocol:1,account_id:"account".into(),receipts:vec![receipt],authority:snapshot()},proof)
    }
    #[test]
    fn mutation_confirmation_requires_owned_exact_intent_and_projection(){
        let (reply,proof)=mutation_confirmation();validate_mutation_confirmation(&reply,"account","change",&proof).unwrap();
        assert!(validate_mutation_confirmation(&reply,"other","change",&proof).is_err());
        assert!(validate_mutation_confirmation(&reply,"account","other",&proof).is_err());
        for field in ["payload","scope","operation","resource","revision"]{
            let (mut reply,proof)=mutation_confirmation();let receipt=&mut reply.receipts[0];
            match field{
                "payload"=>receipt.payload_sha256=Some("0".repeat(64)),
                "scope"=>receipt.mutation_sha256=Some("0".repeat(64)),
                "operation"=>receipt.operation=Some("attach".into()),
                "resource"=>receipt.resource_id=Some("other".into()),
                _=>receipt.revision=None,
            }
            assert!(validate_mutation_confirmation(&reply,"account","change",&proof).is_err(),"{field}");
        }
    }
    #[test]
    fn historical_mutation_confirmation_does_not_grant_current_authority(){
        let (mut reply,proof)=mutation_confirmation();
        reply.authority.grants[0]=Grant{resource_id:ID.into(),can_edit:false,can_delete:false,can_create_child:false,revision:None,scope:None,bindings:None};
        validate_mutation_confirmation(&reply,"account","change",&proof).unwrap();
        reply.receipts[0].confirmed=false;
        assert!(validate_mutation_confirmation(&reply,"account","change",&proof).is_err());
        reply.receipts[0]=MutationReceipt{change_id:"change".into(),confirmed:false,resource_id:None,operation:None,revision:None,mutation_sha256:None,payload_sha256:None,size_bytes:None};
        validate_mutation_confirmation(&reply,"account","change",&proof).unwrap();
    }
    #[test]
    fn mixed_confirmation_requires_exact_complete_prefix_but_accepts_a_missing_suffix(){
        let (mut reply,proof)=mutation_confirmation();reply.protocol=3;
        let (_,other)=mutation_confirmation();let proofs=vec![("change".into(),proof),("later".into(),other)];
        reply.receipts.push(MutationReceipt{change_id:"later".into(),confirmed:false,resource_id:None,operation:None,revision:None,mutation_sha256:None,payload_sha256:None,size_bytes:None});
        validate_mixed_confirmation(&reply,"account",&proofs).unwrap();
        assert!(validate_mixed_confirmation(&reply,"other",&proofs).is_err());
        let (confirmed,_)=mutation_confirmation();reply.receipts[1]=confirmed.receipts.into_iter().next().unwrap();reply.receipts[1].change_id="later".into();
        reply.receipts[0]=MutationReceipt{change_id:"change".into(),confirmed:false,resource_id:None,operation:None,revision:None,mutation_sha256:None,payload_sha256:None,size_bytes:None};
        assert!(validate_mixed_confirmation(&reply,"account",&proofs).is_err());
        reply.receipts[1].change_id="change".into();assert!(validate_mixed_confirmation(&reply,"account",&proofs).is_err());
        reply.receipts.pop();assert!(validate_mixed_confirmation(&reply,"account",&proofs).is_err());
    }
    #[test]
    fn mixed_file_receipts_bind_bytes_and_metadata_and_do_not_accept_old_protocols(){
        let (mut reply,mut proof)=mutation_confirmation();reply.protocol=3;proof.operation="edit_content".into();
        let mut after:local_resources::LocalResource=serde_json::from_str(&proof.after).unwrap();after.size_bytes=Some(12);proof.after=serde_json::to_string(&after).unwrap();
        let payload=serde_json::json!({"resource":{"id":ID,"kind":"file","size_bytes":12},"upload":{"protocol":1,"sha256":"a".repeat(64),"size_bytes":12}});proof.payload=payload.to_string();
        let receipt=&mut reply.receipts[0];receipt.operation=Some("edit_content".into());receipt.size_bytes=Some(12);receipt.payload_sha256=Some(confirmation_digest(&payload));receipt.mutation_sha256=Some(confirmation_digest(&crate::local_resource_attachments::mutation_projection(&after)));
        validate_mutation_confirmation(&reply,"account","change",&proof).unwrap();
        reply.protocol=1;assert!(validate_mutation_confirmation(&reply,"account","change",&proof).is_err());reply.protocol=3;
        reply.receipts[0].size_bytes=Some(13);assert!(validate_mutation_confirmation(&reply,"account","change",&proof).is_err());reply.receipts[0].size_bytes=Some(12);
        reply.receipts[0].mutation_sha256=Some("0".repeat(64));assert!(validate_mutation_confirmation(&reply,"account","change",&proof).is_err());
    }
    #[test]
    fn confirmed_metadata_retains_exact_file_readiness_after_sqlite_restart_without_size_guessing(){
        let path=std::env::temp_dir().join(format!("labos-mixed-readiness-{}.sqlite",uuid::Uuid::new_v4()));
        let mut c=Connection::open(&path).unwrap();local_db::ensure_schema(&c).unwrap();schema(&c).unwrap();
        c.execute_batch("CREATE TABLE local_users(id TEXT PRIMARY KEY,central_user_id TEXT,role TEXT,is_active INTEGER,offline_expires_at TEXT,permissions_json TEXT);CREATE TABLE local_session(id INTEGER PRIMARY KEY,user_id TEXT);INSERT INTO local_users VALUES('a','account','admin',1,datetime('now','+1 hour'),'[]');INSERT INTO local_session VALUES(1,'a');").unwrap();
        let device:String=c.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).unwrap();let origin=native_authorization::trusted_base().unwrap();
        let (original,_)=creation();let mut after=original.clone();after.description=Some("reviewed".into());after.name="Reviewed title".into();after.name_source=Some("user".into());let mut current=after.clone();current.updated_at="2026-10-16T12:00:00.000Z".into();
        let create="22222222-2222-4222-8222-222222222222";let metadata="33333333-3333-4333-8333-333333333333";let file_revision="2026-10-15T12:00:00.000Z";
        let create_payload=serde_json::json!({"resource":original,"upload":{"protocol":1,"size_bytes":original.size_bytes,"sha256":"a".repeat(64)}});
        let metadata_payload=serde_json::json!({"id":original.id,"metadata":{"protocol":1,"previous_change_id":create,"expected_updated_at":original.updated_at,"fields":{"description":"reviewed","name":"Reviewed title"}}});
        {let tx=c.transaction().unwrap();for (id,operation,before,after,payload,revision) in [(create,"create",&original,&original,&create_payload,file_revision),(metadata,"edit_metadata",&original,&after,&metadata_payload,current.updated_at.as_str())]{
            tx.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json,synced_at) VALUES(?1,?2,'resource',?3,?4,?5,CURRENT_TIMESTAMP)",params![id,device,original.id,operation,payload.to_string()]).unwrap();
            crate::local_resource_attachments::record_native_proof(&tx,id,operation,before,after,payload).unwrap();
            tx.execute("INSERT INTO local_resource_mutation_receipts(account_id,change_id,resource_id,device_id,origin,revision,payload_json) VALUES('account',?1,?2,?3,?4,?5,?6)",params![id,original.id,device,origin,revision,payload.to_string()]).unwrap();
        }tx.commit().unwrap();}drop(c);
        let c=Connection::open(&path).unwrap();assert!(content_revision_matches(&c,&current,create,Some(file_revision)).unwrap());
        assert!(!content_revision_matches(&c,&current,create,Some("different-revision")).unwrap());
        let mut changed=current.clone();changed.name="different.md".into();assert!(!content_revision_matches(&c,&changed,create,Some(file_revision)).unwrap());
        changed=current.clone();changed.updated_at="2026-10-17T12:00:00.000Z".into();assert!(!content_revision_matches(&c,&changed,create,Some(file_revision)).unwrap());
        c.execute("UPDATE sync_outbox SET payload_json='{}' WHERE change_id=?1",[metadata]).unwrap();assert!(!content_revision_matches(&c,&current,create,Some(file_revision)).unwrap());
        drop(c);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn action_snapshot_separates_delete_permission_and_rejects_legacy_escalation(){
        let mut grant=snapshot();grant.protocol=3;grant.grants[0].can_edit=false;grant.grants[0].can_delete=true;
        validate(&grant,"account",&[ID.into()]).unwrap();
        grant.protocol=2;assert!(validate(&grant,"account",&[ID.into()]).is_err());
        grant.protocol=3;grant.grants[0].bindings=None;assert!(validate(&grant,"account",&[ID.into()]).is_err());
    }
    #[test]
    fn delete_only_authority_survives_restart_and_never_grants_edit_or_crosses_identity(){
        let path=std::env::temp_dir().join(format!("labos-delete-authority-{}.sqlite",uuid::Uuid::new_v4()));
        let c=Connection::open(&path).unwrap();local_db::ensure_schema(&c).unwrap();schema(&c).unwrap();
        c.execute_batch("CREATE TABLE local_users(id TEXT PRIMARY KEY,central_user_id TEXT,role TEXT,is_active INTEGER,offline_expires_at TEXT,permissions_json TEXT);CREATE TABLE local_session(id INTEGER PRIMARY KEY,user_id TEXT);INSERT INTO local_users VALUES('a','account','viewer',1,datetime('now','+1 hour'),'[\"resources.view\",\"resources.delete\"]');INSERT INTO local_session VALUES(1,'a');").unwrap();
        let lease:String=c.query_row("SELECT offline_expires_at FROM local_users",[],|r|r.get(0)).unwrap();
        let origin=native_authorization::trusted_base().unwrap();
        let mut grant=snapshot();grant.protocol=3;grant.grants[0].can_edit=false;grant.grants[0].can_delete=true;
        let mut record=local_rows(grant.grants[0].bindings.as_ref().unwrap()).remove(0);record.updated_at=grant.grants[0].revision.clone().unwrap();
        local_resources::write_resources(&c,&[record.clone()]).unwrap();cache_snapshot(&c,"account",&origin,&lease,grant).unwrap();drop(c);
        let c=Connection::open(&path).unwrap();require_delete(&c,&record).unwrap();assert!(require_edit(&c,&record).is_err());
        c.execute("UPDATE local_resource_authority SET origin='https://other.example/api'",[]).unwrap();assert!(require_delete(&c,&record).is_err());
        c.execute("UPDATE local_resource_authority SET origin=?1",[&origin]).unwrap();
        let mut changed=record.clone();changed.visibility=Some("lab".into());assert!(require_delete(&c,&changed).is_err());
        c.execute("INSERT INTO local_resource_poster_denials(account_id,resource_id) VALUES('account',?1)",[ID]).unwrap();assert!(require_delete(&c,&record).is_err());
        c.execute("DELETE FROM local_resource_poster_denials",[]).unwrap();require_delete(&c,&record).unwrap();
        c.execute("UPDATE local_resource_authority SET can_delete=0",[]).unwrap();assert!(require_delete(&c,&record).is_err());
        c.execute("UPDATE local_resource_authority SET can_delete=1",[]).unwrap();
        c.execute("UPDATE local_users SET offline_expires_at=datetime('now','-1 second')",[]).unwrap();assert!(require_delete(&c,&record).is_err());
        drop(c);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn folder_destination_does_not_require_or_grant_metadata_edit(){
        let c=Connection::open_in_memory().unwrap();local_db::ensure_schema(&c).unwrap();schema(&c).unwrap();
        c.execute_batch("CREATE TABLE local_users(id TEXT PRIMARY KEY,central_user_id TEXT,role TEXT,is_active INTEGER,offline_expires_at TEXT,permissions_json TEXT);CREATE TABLE local_session(id INTEGER PRIMARY KEY,user_id TEXT);INSERT INTO local_users VALUES('a','account','viewer',1,datetime('now','+1 hour'),'[\"resources.view\",\"resources.create\"]');INSERT INTO local_session VALUES(1,'a');").unwrap();
        let lease:String=c.query_row("SELECT offline_expires_at FROM local_users",[],|r|r.get(0)).unwrap();let origin=native_authorization::trusted_base().unwrap();
        let mut grant=snapshot();grant.protocol=3;grant.grants[0].can_edit=false;grant.grants[0].can_create_child=true;
        assert!(validate(&grant,"account",&[ID.into()]).is_err());
        grant.grants[0].bindings.as_mut().unwrap()[0].kind="folder".into();validate(&grant,"account",&[ID.into()]).unwrap();
        let mut folder=local_rows(grant.grants[0].bindings.as_ref().unwrap()).remove(0);folder.updated_at=grant.grants[0].revision.clone().unwrap();
        local_resources::write_resources(&c,&[folder.clone()]).unwrap();cache_snapshot(&c,"account",&origin,&lease,grant).unwrap();
        require_folder_destination(&c,&folder).unwrap();assert!(require_edit(&c,&folder).is_err());assert!(require_delete(&c,&folder).is_err());
        c.execute("INSERT INTO local_resource_poster_denials(account_id,resource_id) VALUES('account',?1)",[ID]).unwrap();assert!(require_folder_destination(&c,&folder).is_err());
    }
    fn snapshot()->Snapshot{
        let scope=serde_json::json!({"visibility":"restricted","item_id":null,"project_id":null,"note_id":null,"parent_resource_id":null});
        serde_json::from_value(serde_json::json!({"protocol":2,"account_id":"account","grants":[{"resource_id":ID,"can_edit":true,"revision":"2026-10-13T12:00:00.000Z","scope":scope,"bindings":[{"resource_id":ID,"kind":"file","scope":scope,"note":null}]}]})).unwrap()
    }
    #[test]
    fn authority_requires_exact_account_ids_and_complete_batch(){
        let ids=vec![ID.into()];validate(&snapshot(),"account",&ids).unwrap();
        assert!(validate(&snapshot(),"other",&ids).is_err());assert!(validate(&snapshot(),"account",&[]).is_err());
        let mut s=snapshot();s.grants[0].resource_id="other".into();assert!(validate(&s,"account",&ids).is_err());
        let mut s=snapshot();s.grants.push(snapshot().grants.remove(0));assert!(validate(&s,"account",&[ID.into(),"other".into()]).is_err());
    }
    #[test]
    fn authority_rejects_missing_scope_and_denial_with_metadata(){
        let ids=vec![ID.into()];let mut s=snapshot();s.grants[0].scope=None;assert!(validate(&s,"account",&ids).is_err());
        let mut s=snapshot();s.grants[0].can_edit=false;assert!(validate(&s,"account",&ids).is_err());
        s.grants[0].scope=None;s.grants[0].revision=None;s.grants[0].bindings=None;validate(&s,"account",&ids).unwrap();
    }
    #[test]
    fn cached_grant_is_exact_revision_scope_and_deny_safe(){
        let mut record:local_resources::LocalResource=serde_json::from_value(serde_json::json!({"id":ID,"name":"Report","kind":"file","file_type":"pdf","tags":[],"visibility":"restricted","updated_at":"2026-10-13T12:00:00.000Z","created_at":"2026-10-13T12:00:00.000Z"})).unwrap();
        let s=snapshot();let grant=&s.grants[0];
        assert!(matches_resource(true,grant.revision.as_deref(),grant.scope.as_ref(),&record));
        assert!(!matches_resource(false,grant.revision.as_deref(),grant.scope.as_ref(),&record));
        record.project_id=Some(ID.into());assert!(!matches_resource(true,grant.revision.as_deref(),grant.scope.as_ref(),&record));
        record.project_id=None;record.updated_at="new local version".into();assert!(!matches_resource(true,grant.revision.as_deref(),grant.scope.as_ref(),&record));
    }
    #[test]
    fn only_proven_content_chains_carry_the_verified_revision(){
        let mut rows=vec![EditProof{id:"one".into(),previous:None,base:"server-0".into(),local:"local-1".into(),confirmed:Some("server-1".into()),size:10},EditProof{id:"two".into(),previous:Some("one".into()),base:"local-1".into(),local:"local-2".into(),confirmed:None,size:20}];
        assert!(carries_authority("local-2",Some(20),"server-0",&rows));
        assert!(carries_authority("local-2",Some(20),"server-1",&rows));
        assert!(!carries_authority("local-2",Some(21),"server-0",&rows));
        assert!(!carries_authority("local-2",Some(20),"foreign-revision",&rows));
        rows[1].base="unrelated".into();assert!(!carries_authority("local-2",Some(20),"server-0",&rows));
        rows[1].base="local-2".into();rows[1].previous=Some("two".into());assert!(!carries_authority("local-2",Some(20),"server-0",&rows));
    }

    const FOLDER:&str="22222222-2222-4222-8222-222222222222";
    const NOTE:&str="33333333-3333-4333-8333-333333333333";
    fn inherited()->Vec<Binding>{
        let mut bindings=snapshot().grants.remove(0).bindings.unwrap();
        bindings[0].scope.parent_resource_id=Some(FOLDER.into());
        bindings.push(Binding{resource_id:FOLDER.into(),kind:"folder".into(),scope:Scope{visibility:"restricted".into(),item_id:None,project_id:None,note_id:Some(NOTE.into()),parent_resource_id:None},note:Some(NoteBinding{id:NOTE.into(),project_id:None,visibility:"restricted".into()})});
        bindings
    }
    fn local_rows(bindings:&[Binding])->Vec<local_resources::LocalResource>{
        bindings.iter().map(|b|{
            let mut value=serde_json::to_value(&b.scope).unwrap();
            value["id"]=serde_json::json!(b.resource_id);value["kind"]=serde_json::json!(b.kind);
            value["name"]=serde_json::json!("Document");value["file_type"]=serde_json::json!("pdf");value["tags"]=serde_json::json!([]);
            value["updated_at"]=serde_json::json!("content may change");value["created_at"]=serde_json::json!("2026-10-14T00:00:00.000Z");
            serde_json::from_value(value).unwrap()
        }).collect()
    }
    #[test]
    fn inherited_authority_requires_a_complete_unique_folder_note_chain(){
        let bindings=inherited();validate_bindings(ID,&bindings[0].scope,&bindings).unwrap();
        assert!(validate_bindings(ID,&bindings[0].scope,&bindings[..1]).is_err());
        let mut broken=inherited();broken[1].kind="file".into();assert!(validate_bindings(ID,&broken[0].scope,&broken).is_err());
        let mut broken=inherited();broken[1].note=None;assert!(validate_bindings(ID,&broken[0].scope,&broken).is_err());
        let mut broken=inherited();broken[1].note.as_mut().unwrap().id=ID.into();assert!(validate_bindings(ID,&broken[0].scope,&broken).is_err());
        let mut broken=inherited();broken[1].scope.note_id=None;broken[1].note=None;broken[1].scope.parent_resource_id=Some(ID.into());assert!(validate_bindings(ID,&broken[0].scope,&broken).is_err());
        let mut s=snapshot();s.protocol=1;assert!(validate(&s,"account",&[ID.into()]).is_err());
        let mut s=snapshot();s.grants[0].bindings=None;assert!(validate(&s,"account",&[ID.into()]).is_err());
    }
    #[test]
    fn inherited_authority_matches_scoped_local_ancestors_not_just_the_leaf(){
        let bindings=inherited();let resources=local_rows(&bindings);
        let notes=vec![serde_json::json!({"id":NOTE,"visibility":"restricted","project_id":null,"body":"offline content"})];
        assert!(bindings_match_local(&bindings,&resources,&notes));
        assert!(!bindings_match_local(&bindings,&resources[..1],&notes));
        assert!(!bindings_match_local(&bindings,&resources,&[]));
        let mut changed=resources.clone();changed[1].visibility=Some("lab".into());assert!(!bindings_match_local(&bindings,&changed,&notes));
        let mut changed=notes.clone();changed[0]["project_id"]=serde_json::json!(ID);assert!(!bindings_match_local(&bindings,&resources,&changed));
        let mut changed=notes.clone();changed[0]["visibility"]=serde_json::json!("lab");assert!(!bindings_match_local(&bindings,&resources,&changed));
        let mut changed=resources.clone();changed.push(resources[1].clone());assert!(!bindings_match_local(&bindings,&changed,&notes));
        let mut changed=notes.clone();changed.push(notes[0].clone());assert!(!bindings_match_local(&bindings,&resources,&changed));
    }
    #[test]
    fn ancestor_depth_is_bounded_and_never_silently_truncated(){
        let mut bindings:Vec<Binding>=(0..32).map(|i|Binding{resource_id:format!("{i:08x}-1111-4111-8111-111111111111"),kind:"folder".into(),scope:Scope{visibility:"lab".into(),item_id:None,project_id:None,note_id:None,parent_resource_id:if i<31{Some(format!("{:08x}-1111-4111-8111-111111111111",i+1))}else{None}},note:None}).collect();
        validate_bindings(&bindings[0].resource_id,&bindings[0].scope,&bindings).unwrap();
        bindings[31].scope.parent_resource_id=Some(ID.into());assert!(validate_bindings(&bindings[0].resource_id,&bindings[0].scope,&bindings).is_err());
    }
    fn creation()->(local_resources::LocalResource,serde_json::Value){
        let mut record=local_rows(&snapshot().grants.remove(0).bindings.unwrap()).remove(0);
        record.visibility=Some("lab".into());record.size_bytes=Some(12);record.updated_at="2026-10-14T12:00:00.000Z".into();
        let payload=serde_json::json!({"resource":record,"upload":{"protocol":1,"size_bytes":12}});
        (record,payload)
    }
    #[test]
    fn own_creation_proof_requires_native_record_identity_and_unchanged_scope(){
        let (record,payload)=creation();assert!(valid_creation_proof(&record,&record,"create",&payload));
        let mut changed=record.clone();changed.project_id=Some(FOLDER.into());assert!(!valid_creation_proof(&record,&changed,"create",&payload));
        changed=record.clone();changed.visibility=Some("restricted".into());assert!(!valid_creation_proof(&record,&changed,"create",&payload));
        changed=record.clone();changed.id=FOLDER.into();assert!(!valid_creation_proof(&record,&changed,"create",&payload));
        changed=record.clone();changed.file_type="video".into();assert!(!valid_creation_proof(&record,&changed,"create",&payload));
        let mut bad=payload.clone();bad["resource"]["name"]=serde_json::json!("different native record");assert!(!valid_creation_proof(&record,&record,"create",&bad));
        let mut bad=payload.clone();bad["upload"]["size_bytes"]=serde_json::json!(13);assert!(!valid_creation_proof(&record,&record,"create",&bad));
        assert!(!valid_creation_proof(&record,&record,"update",&payload));
    }
    #[test]
    fn authored_copy_cannot_hide_or_change_its_source(){
        let (mut record,mut payload)=creation();record.derived_from_resource_id=Some(FOLDER.into());
        payload["resource"]=serde_json::to_value(&record).unwrap();payload["copy"]=serde_json::json!({"protocol":1,"source_id":FOLDER});
        assert!(valid_creation_proof(&record,&record,"create_copy",&payload));
        assert!(!valid_creation_proof(&record,&record,"create",&payload));
        let mut changed=record.clone();changed.derived_from_resource_id=Some(NOTE.into());assert!(!valid_creation_proof(&record,&changed,"create_copy",&payload));
        payload["copy"]["source_id"]=serde_json::json!(NOTE);assert!(!valid_creation_proof(&record,&record,"create_copy",&payload));
        record.derived_from_resource_id=Some(ID.into());payload["resource"]=serde_json::to_value(&record).unwrap();payload["copy"]["source_id"]=serde_json::json!(ID);assert!(!valid_creation_proof(&record,&record,"create_copy",&payload));
    }
    #[test]
    fn changed_content_still_needs_a_proven_native_chain_after_creation(){
        let (record,payload)=creation();let mut current=record.clone();current.updated_at="local-version".into();current.size_bytes=Some(20);
        assert!(valid_creation_proof(&record,&current,"create",&payload));
        assert!(!carries_authority(&current.updated_at,current.size_bytes,&record.updated_at,&[]));
        let proof=EditProof{id:"edit".into(),previous:Some("creation".into()),base:record.updated_at.clone(),local:current.updated_at.clone(),confirmed:None,size:20};
        assert!(carries_authority(&current.updated_at,current.size_bytes,&record.updated_at,&[proof]));
    }
    fn confirmation()->(Confirmation,Vec<PendingFile>){
        let snapshot=snapshot();let revision=snapshot.grants[0].revision.clone();
        let payload=serde_json::json!({"resource":{"id":ID},"upload":{"protocol":1,"size_bytes":12,"sha256":"a".repeat(64)}});
        (Confirmation{protocol:2,account_id:"account".into(),authority:snapshot,receipts:vec![FileReceipt{change_id:"change".into(),confirmed:true,resource_id:Some(ID.into()),operation:Some("create".into()),revision,size_bytes:Some(12),payload_sha256:Some(confirmation_digest(&payload))}]},vec![PendingFile{change_id:"change".into(),operation:"create".into(),payload:payload.to_string(),local_revision:Some("local-created".into()),size:12}])
    }
    #[test]
    fn confirmation_requires_exact_account_event_operation_resource_and_size(){
        let (reply,pending)=confirmation();validate_confirmation(&reply,"account",ID,&pending).unwrap();
        assert!(validate_confirmation(&reply,"other",ID,&pending).is_err());
        assert!(validate_confirmation(&reply,"account",ID,&[]).is_err());
        let (mut reply,pending)=confirmation();reply.receipts[0].operation=Some("edit_content".into());assert!(validate_confirmation(&reply,"account",ID,&pending).is_err());
        let (mut reply,pending)=confirmation();reply.receipts[0].resource_id=Some(FOLDER.into());assert!(validate_confirmation(&reply,"account",ID,&pending).is_err());
        let (mut reply,pending)=confirmation();reply.receipts[0].size_bytes=Some(13);assert!(validate_confirmation(&reply,"account",ID,&pending).is_err());
        let (mut reply,pending)=confirmation();reply.receipts[0].confirmed=false;assert!(validate_confirmation(&reply,"account",ID,&pending).is_err());
        reply.receipts[0]=FileReceipt{change_id:"change".into(),confirmed:false,resource_id:None,operation:None,revision:None,size_bytes:None,payload_sha256:None};validate_confirmation(&reply,"account",ID,&pending).unwrap();
    }
    #[test]
    fn file_receipt_rejects_same_size_different_intent_and_protocol_downgrade(){
        let (mut reply,pending)=confirmation();reply.protocol=1;
        assert!(validate_confirmation(&reply,"account",ID,&pending).is_err());
        let (mut reply,pending)=confirmation();reply.receipts[0].payload_sha256=None;
        assert!(validate_confirmation(&reply,"account",ID,&pending).is_err());
        for field in ["sha256","previous_change_id","description"]{
            let (reply,mut pending)=confirmation();
            let mut payload:serde_json::Value=serde_json::from_str(&pending[0].payload).unwrap();
            if field=="sha256"{payload["upload"][field]=serde_json::json!("b".repeat(64));}
            else{payload[field]=serde_json::json!("changed intent");}
            pending[0].payload=payload.to_string();
            assert!(validate_confirmation(&reply,"account",ID,&pending).is_err(),"{field}");
        }
    }
    #[test]
    fn file_receipt_requires_valid_upload_even_if_payload_digest_matches(){
        for field in ["protocol","size_bytes","sha256"]{
            let (mut reply,mut pending)=confirmation();
            let mut payload:serde_json::Value=serde_json::from_str(&pending[0].payload).unwrap();
            payload["upload"][field]=serde_json::json!(null);
            reply.receipts[0].payload_sha256=Some(confirmation_digest(&payload));
            pending[0].payload=payload.to_string();
            assert!(validate_confirmation(&reply,"account",ID,&pending).is_err(),"{field}");
        }
        let (mut reply,pending)=confirmation();
        reply.receipts[0]=FileReceipt{change_id:"change".into(),confirmed:false,resource_id:None,operation:None,revision:None,size_bytes:None,payload_sha256:Some("a".repeat(64))};
        assert!(validate_confirmation(&reply,"account",ID,&pending).is_err());
    }
    #[test]
    fn confirmation_can_ack_history_with_current_authority_denied(){
        let (mut reply,pending)=confirmation();
        let grant=&mut reply.authority.grants[0];grant.can_edit=false;grant.revision=None;grant.scope=None;grant.bindings=None;
        validate_confirmation(&reply,"account",ID,&pending).unwrap();
        let (mut current,_)=creation();current.updated_at="local-created".into();
        assert!(confirmed_projection_revision(&current,&pending,&reply.receipts,&reply.authority.grants[0]).is_none());
    }
    #[test]
    fn confirmed_projection_never_overwrites_newer_local_work_or_foreign_scope(){
        let (reply,pending)=confirmation();let (mut current,_)=creation();
        current.visibility=Some("restricted".into());current.updated_at="local-created".into();
        assert_eq!(confirmed_projection_revision(&current,&pending,&reply.receipts,&reply.authority.grants[0]),reply.receipts[0].revision);
        current.updated_at="new-local-work".into();assert!(confirmed_projection_revision(&current,&pending,&reply.receipts,&reply.authority.grants[0]).is_none());
        current.updated_at="local-created".into();current.project_id=Some(FOLDER.into());assert!(confirmed_projection_revision(&current,&pending,&reply.receipts,&reply.authority.grants[0]).is_none());
    }
    #[test]
    fn pending_content_chain_survives_its_creation_confirmation(){
        let rows=vec![EditProof{id:"create".into(),previous:None,base:"local-created".into(),local:"local-created".into(),confirmed:Some("server-created".into()),size:12},EditProof{id:"edit".into(),previous:Some("create".into()),base:"local-created".into(),local:"local-edited".into(),confirmed:None,size:20}];
        assert!(carries_authority("local-edited",Some(20),"server-created",&rows));
        assert!(!carries_authority("local-edited",Some(20),"server-created",&rows[1..]));
    }
}
