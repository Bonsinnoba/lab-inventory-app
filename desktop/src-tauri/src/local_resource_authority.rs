//! Derived edit authority fetched by native code, never provisioned by IPC data.
use crate::{local_auth,local_db,local_resources,native_authorization};
use rusqlite::{params,Connection,OptionalExtension,TransactionBehavior};
use serde::{Deserialize,Serialize};
use std::collections::HashSet;
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
struct Grant {resource_id:String,can_edit:bool,revision:Option<String>,scope:Option<Scope>,bindings:Option<Vec<Binding>>}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Snapshot {protocol:u32,account_id:String,grants:Vec<Grant>}
fn err(e:impl std::fmt::Display)->String{e.to_string()}
fn schema(c:&Connection)->Result<(),String>{
    c.execute_batch("CREATE TABLE IF NOT EXISTS local_resource_authority(account_id TEXT NOT NULL,resource_id TEXT NOT NULL,origin TEXT NOT NULL,revision TEXT,scope_json TEXT,can_edit INTEGER NOT NULL,expires_at TEXT NOT NULL,PRIMARY KEY(account_id,resource_id));
    CREATE TABLE IF NOT EXISTS local_resource_authority_bindings(account_id TEXT NOT NULL,resource_id TEXT NOT NULL,bindings_json TEXT NOT NULL,PRIMARY KEY(account_id,resource_id));").map_err(err)
}
pub(crate) fn guard(c:&Connection,account:&str,session:&str)->Result<String,String>{
    local_db::require_sync_account(c,account)?;
    let (token,lease):(String,String)=c.query_row("SELECT s.session_token,u.offline_expires_at FROM local_session s JOIN local_users u ON u.id=s.user_id WHERE s.id=1",[],|r|Ok((r.get(0)?,r.get(1)?))).map_err(err)?;
    if token!=session{return Err("Native session changed during resource authorization".into())}
    Ok(lease)
}
fn validate(snapshot:&Snapshot,account:&str,ids:&[String])->Result<(),String>{
    if snapshot.protocol!=2||snapshot.account_id!=account||snapshot.grants.len()!=ids.len(){return Err("Resource authority identity or completeness mismatch".into())}
    let expected:HashSet<&str>=ids.iter().map(String::as_str).collect();let mut seen=HashSet::new();
    for grant in &snapshot.grants {
        if !expected.contains(grant.resource_id.as_str())||!seen.insert(&grant.resource_id){return Err("Unexpected or duplicate resource authority".into())}
        if grant.can_edit {
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
    let client=native_authorization::client().map_err(|e|e.message)?;
    let mut count=0;
    // Small complete-chain batches retain the native 64 KiB response limit.
    for batch in ids.chunks(4){
        {let c=local_db::open_local_connection(&app)?;guard(&c,&expected_account_id,&expected_session_token)?;}
        let response=client.post(format!("{origin}/sync/resources/authority")).bearer_auth(&server_token)
            .json(&serde_json::json!({"protocol":2,"resource_ids":batch})).send().await.map_err(|_|"Resource authority server is unavailable; existing lease-bounded grants are unchanged")?;
        let snapshot:Snapshot=match native_authorization::response_json(response).await {
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
        for grant in snapshot.grants {
            tx.execute("DELETE FROM local_resource_authority_bindings WHERE account_id=?1 AND resource_id=?2",params![expected_account_id,grant.resource_id]).map_err(err)?;
            if let Some(bindings)=grant.bindings{
                let cached=CachedBindings{revision:grant.revision.clone().ok_or("Missing grant revision")?,expires_at:lease.clone(),bindings};
                tx.execute("INSERT INTO local_resource_authority_bindings(account_id,resource_id,bindings_json) VALUES(?1,?2,?3)",params![expected_account_id,grant.resource_id,serde_json::to_string(&cached).map_err(err)?]).map_err(err)?;
            }
            let scope=grant.scope.map(|s|serde_json::to_string(&s)).transpose().map_err(err)?;
            tx.execute("INSERT INTO local_resource_authority(account_id,resource_id,origin,revision,scope_json,can_edit,expires_at) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(account_id,resource_id) DO UPDATE SET origin=excluded.origin,revision=excluded.revision,scope_json=excluded.scope_json,can_edit=excluded.can_edit,expires_at=excluded.expires_at",params![expected_account_id,grant.resource_id,origin,grant.revision,scope,grant.can_edit,lease]).map_err(err)?;
            count+=1;
        }
        tx.commit().map_err(err)?;
    }
    count+=crate::local_resource_destinations::refresh(&app,&expected_account_id,&expected_session_token,&server_token,&lease).await?;
    Ok(count)
}

pub(crate) fn require_edit(c:&Connection,resource:&local_resources::LocalResource)->Result<(),String>{
    schema(c)?;let account=local_db::active_account(c)?;
    let origin=native_authorization::trusted_base().map_err(|e|e.message)?;
    let grant:Option<(Option<String>,Option<String>,bool)>=c.query_row("SELECT revision,scope_json,can_edit FROM local_resource_authority WHERE account_id=?1 AND resource_id=?2 AND origin=?3 AND datetime('now')<datetime(expires_at) AND expires_at=(SELECT u.offline_expires_at FROM local_users u JOIN local_session s ON s.user_id=u.id WHERE s.id=1)",params![account,resource.id,origin],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(err)?;
    let (revision,scope,allowed)=grant.ok_or("Record edit authority is not cached or has expired. Connect once to refresh it; your local work is preserved.")?;
    let scope:Option<Scope>=scope.map(|raw|serde_json::from_str(&raw)).transpose().map_err(err)?;
    // Owner-approved content-only lease continuity: never a blanket revision
    // bypass. A mismatched revision needs a native-published content chain.
    if !allowed||scope.as_ref()!=Some(&Scope::from_resource(resource)){return Err("Cached edit authority does not cover this resource attachment and visibility".into())}
    let raw:Option<String>=c.query_row("SELECT bindings_json FROM local_resource_authority_bindings WHERE account_id=?1 AND resource_id=?2",params![account,resource.id],|r|r.get(0)).optional().map_err(err)?;
    let cached:CachedBindings=serde_json::from_str(&raw.ok_or("Connect once to verify this resource's complete ancestor authority; saved work is preserved")?).map_err(err)?;
    let lease:String=c.query_row("SELECT u.offline_expires_at FROM local_users u JOIN local_session s ON s.user_id=u.id WHERE s.id=1",[],|r|r.get(0)).map_err(err)?;
    if Some(cached.revision.as_str())!=revision.as_deref()||cached.expires_at!=lease{return Err("Ancestor snapshot does not belong to the current verified grant".into())}
    let bindings=cached.bindings;
    validate_bindings(&resource.id,&Scope::from_resource(resource),&bindings)?;
    let resources=local_resources::read_resources(c)?;
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
    Ok(carries_authority(&resource.updated_at,resource.size_bytes,granted,&proofs))
}

// A new native file has no server grant yet. Its own unpublished creation is
// evidence of authorship, not permission to edit a downloaded/confirmed file.
pub(crate) fn require_own_pending_creation(c:&Connection,current:&local_resources::LocalResource)->Result<bool,String>{
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
}
