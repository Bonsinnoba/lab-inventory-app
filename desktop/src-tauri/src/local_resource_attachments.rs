use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;
use crate::{local_auth, local_db, local_resources};

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Destination {
    item_id: Option<String>,
    project_id: Option<String>,
    note_id: Option<String>,
}

impl Destination {
    fn normalize(&mut self) -> Result<(), String> {
        let mut count = 0;
        for value in [&mut self.item_id, &mut self.project_id, &mut self.note_id] {
            if let Some(id) = value {
                *id = uuid::Uuid::parse_str(id).map_err(|_| "Invalid attachment ID")?.to_string();
                count += 1;
            }
        }
        if count > 1 { return Err("Choose only one attachment destination".into()); }
        Ok(())
    }
}

fn err(e:impl std::fmt::Display)->String{e.to_string()}
pub(crate) fn schema(c:&Connection)->Result<(),String>{
    c.execute_batch("CREATE TABLE IF NOT EXISTS local_resource_mutations(account_id TEXT NOT NULL,change_id TEXT NOT NULL,resource_id TEXT NOT NULL,device_id TEXT NOT NULL,operation TEXT NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,payload_json TEXT NOT NULL,PRIMARY KEY(account_id,change_id));").map_err(err)
}

// Native-only provenance. These rows are never populated by server pulls or IPC
// snapshots, and are committed with the local mutation and immutable outbox event.
struct MoveProof {id:String,device:String,operation:String,before:local_resources::LocalResource,after:local_resources::LocalResource,payload:Value}
pub(crate) fn record_identity(r:&local_resources::LocalResource)->Result<Value,String>{
    let mut value=serde_json::to_value(r).map_err(err)?;
    // Derived labels/preview locations may hydrate independently of authored intent.
    for key in ["item_name","project_name","note_title","thumbnail_url","local_media_path","local_media_filename","local_media_mime_type","local_media_size_bytes","local_media_downloaded_at"]{
        value.as_object_mut().ok_or("Invalid resource snapshot")?.remove(key);
    }
    Ok(value)
}
pub(crate) fn mutation_projection(r:&local_resources::LocalResource)->Value{
    json!({"kind":r.kind,"visibility":r.visibility.as_deref().unwrap_or("lab"),"item_id":r.item_id,"project_id":r.project_id,"note_id":r.note_id,"parent_resource_id":r.parent_resource_id,"category":r.category,"description":r.description,"tags":r.tags})
}
fn apply_metadata(resource:&mut local_resources::LocalResource,fields:&Value)->Result<(),String>{
    let fields=fields.as_object().ok_or("Invalid resource metadata")?;
    if fields.keys().any(|k|!["category","description","tags"].contains(&k.as_str())){return Err("Unsupported resource metadata field".into())}
    if let Some(value)=fields.get("category"){
        let category=value.as_str().ok_or("Invalid resource category")?;
        if !["general","datasheet","manual","schematic","research","tutorial","reference","specification","image","cad","report","video","other"].contains(&category){return Err("Invalid resource category".into())}
        resource.category=Some(category.into());
    }
    if let Some(value)=fields.get("description"){
        let description=value.as_str().ok_or("Invalid resource description")?;
        if description.chars().count()>5000{return Err("Resource description is too long".into())}resource.description=Some(description.into());
    }
    if let Some(value)=fields.get("tags"){
        let tags=value.as_array().ok_or("Invalid resource tags")?;
        if tags.len()>30{return Err("Too many resource tags".into())}
        resource.tags=tags.iter().map(|tag|tag.as_str().filter(|s|!s.is_empty()&&s.chars().count()<=256).map(str::to_owned).ok_or_else(||"Invalid resource tag".to_string())).collect::<Result<_,_>>()?;
    }
    Ok(())
}

pub(crate) fn edit_metadata(app:AppHandle,expected_account_id:String,expected_session_token:String,id:String,fields:Value)->Result<local_resources::LocalResource,String>{
    let id=uuid::Uuid::parse_str(&id).map_err(err)?.to_string();
    let mut conn=local_db::open_local_connection(&app)?;
    let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(err)?;
    local_db::require_sync_account(&tx,&expected_account_id)?;
    local_auth::require_local_permission(&tx,"resources.view")?;local_auth::require_local_permission(&tx,"resources.edit")?;
    let token:String=tx.query_row("SELECT session_token FROM local_session WHERE id=1",[],|r|r.get(0)).map_err(err)?;
    if token!=expected_session_token{return Err("Session changed while editing resource metadata".into())}
    let mut resources=local_resources::read_resources(&tx)?;
    let resource=resources.iter_mut().find(|r|r.id==id).ok_or("Resource unavailable on this PC")?;
    let previous=if let Some(previous)=crate::local_resource_authority::require_pending_mutation_editor(&tx,resource)?{Some(previous)}else{
        crate::resource_dependencies::require_editor_access(&tx,resource)?;
        crate::resource_dependencies::source_predecessor(&tx,&id)?
    };
    crate::local_resource_posters::schema(&tx)?;
    let denied:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM local_resource_poster_denials WHERE account_id=?1 AND resource_id=?2)",params![expected_account_id,id],|r|r.get(0)).map_err(err)?;
    if denied{return Err("Resource access was revoked; metadata has not been changed".into())}
    let before=resource.clone();apply_metadata(resource,&fields)?;
    if record_identity(&before)?==record_identity(resource)?{return Ok(resource.clone())}
    let result=resource.clone();
    let change=uuid::Uuid::new_v4().to_string();
    let device:String=tx.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).map_err(err)?;
    let payload=json!({"id":id,"metadata":{"protocol":1,"expected_updated_at":before.updated_at,"fields":fields,"previous_change_id":previous}});
    local_resources::write_resources(&tx,&resources)?;
    tx.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,'resource',?3,'edit_metadata',?4)",params![change,device,id,payload.to_string()]).map_err(err)?;
    tx.execute("INSERT INTO local_resource_mutations(account_id,change_id,resource_id,device_id,operation,before_json,after_json,payload_json) VALUES(?1,?2,?3,?4,'edit_metadata',?5,?6,?7)",params![expected_account_id,change,id,device,serde_json::to_string(&before).map_err(err)?,serde_json::to_string(&result).map_err(err)?,payload.to_string()]).map_err(err)?;
    tx.commit().map_err(err)?;Ok(result)
}
fn validate_move_chain(current:&local_resources::LocalResource,rows:&[MoveProof],device:&str)->Result<(),String>{
    if rows.is_empty()||rows.len()>128{return Err("Attachment chain is incomplete or too long; synchronize it first".into())}
    let mut ids=std::collections::HashSet::new();
    for (index,row) in rows.iter().enumerate(){
        if uuid::Uuid::parse_str(&row.id).map_err(err)?.to_string()!=row.id||!ids.insert(&row.id)||row.device!=device||row.before.id!=current.id||row.after.id!=current.id||!["file","link","folder"].contains(&row.before.kind.as_str()){return Err("Invalid native resource mutation provenance".into())}
        let previous=if index==0{None}else{Some(rows[index-1].id.as_str())};
        let mut projected=row.before.clone();
        let expected=match row.operation.as_str(){
            "attach"=>{
                if row.before.kind=="folder"||row.before.parent_resource_id.is_some(){return Err("Nested folder moves require folder management".into())}
                let mut destination:Destination=serde_json::from_value(row.payload["attachment"]["destination"].clone()).map_err(err)?;destination.normalize()?;
                let expected=json!({"id":current.id,"attachment":{"protocol":if index==0{1}else{3},"expected_updated_at":row.before.updated_at,"destination":destination,"previous_change_id":previous}});
                projected.item_id=destination.item_id;projected.project_id=destination.project_id;projected.note_id=destination.note_id;expected
            },
            "edit_metadata"=>{
                let fields=&row.payload["metadata"]["fields"];apply_metadata(&mut projected,fields)?;
                json!({"id":current.id,"metadata":{"protocol":1,"expected_updated_at":row.before.updated_at,"fields":fields,"previous_change_id":previous}})
            },
            _=>return Err("Unsupported native resource mutation".into()),
        };
        if row.payload!=expected{return Err("Resource intent differs from its native chain".into())}
        if record_identity(&projected)?!=record_identity(&row.after)?{return Err("Resource chain contains an unproven content or metadata change".into())}
        if index>0&&record_identity(&rows[index-1].after)?!=record_identity(&row.before)?{return Err("Attachment chain has a missing or changed predecessor".into())}
    }
    if record_identity(&rows.last().unwrap().after)?!=record_identity(current)?{return Err("Local resource no longer matches its native attachment chain".into())}
    Ok(())
}

fn previous_mutation(row:&MoveProof)->Option<&str>{
    row.payload[if row.operation=="attach"{"attachment"}else{"metadata"}]["previous_change_id"].as_str()
}
// A confirmed prefix is evidence of a committed event, not a live permission.
// Load it only through an origin/account/device/payload-bound native receipt.
fn confirmed_predecessor(c:&Connection,account:&str,resource:&str,id:&str,device:&str)->Result<(MoveProof,String),String>{
    let revision=crate::local_resource_authority::mutation_receipt_revision(c,id)?.ok_or("Earlier resource change needs native server confirmation; saved work is preserved")?;
    let row:Option<(String,String,String,String,String,bool,bool)>=c.query_row("SELECT o.device_id,o.operation,o.payload_json,m.before_json,m.after_json,o.synced_at IS NOT NULL,EXISTS(SELECT 1 FROM sync_conflicts f WHERE f.change_id=o.change_id AND f.resolved_at IS NULL) FROM sync_outbox o JOIN local_resource_mutations m ON m.account_id=o.account_id AND m.change_id=o.change_id AND m.resource_id=o.entity_id AND m.operation=o.operation AND m.device_id=o.device_id AND m.payload_json=o.payload_json WHERE o.account_id=?1 AND o.entity_id=?2 AND o.change_id=?3 AND o.entity_type='resource'",params![account,resource,id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?))).optional().map_err(err)?;
    let (owner,operation,payload,before,after,synced,conflict)=row.ok_or("Confirmed mutation provenance is missing")?;
    if owner!=device||!synced||conflict||!["attach","edit_metadata"].contains(&operation.as_str()){return Err("Earlier mutation is not a verified acknowledged predecessor".into())}
    Ok((MoveProof{id:id.into(),device:owner,operation,payload:serde_json::from_str(&payload).map_err(err)?,before:serde_json::from_str(&before).map_err(err)?,after:serde_json::from_str(&after).map_err(err)?},revision))
}

fn chain_authority_origin(rows:&[MoveProof],confirmed_prefix:usize,revision:Option<&str>)->Result<local_resources::LocalResource,String>{
    if rows.is_empty()||confirmed_prefix>=rows.len(){return Err("Resource chain has no pending suffix".into())}
    if confirmed_prefix==0{return Ok(rows[0].before.clone())}
    let mut anchor=rows[confirmed_prefix-1].after.clone();
    anchor.updated_at=revision.filter(|s|!s.is_empty()).ok_or("Confirmed prefix revision missing")?.into();
    Ok(anchor)
}

// Direct move/metadata chains can carry a verified acknowledged prefix. Mixed
// file creation/content prefixes and unproven legacy intents still fail closed.
pub(crate) fn pending_mutation_origin(c:&Connection,current:&local_resources::LocalResource)->Result<Option<(local_resources::LocalResource,String)>,String>{
    schema(c)?;
    let account=local_db::active_account(c)?;
    let has_moves:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM sync_outbox WHERE account_id=?1 AND entity_type='resource' AND entity_id=?2 AND operation IN ('attach','edit_metadata') AND synced_at IS NULL)",params![account,current.id],|r|r.get(0)).map_err(err)?;
    if !has_moves{return Ok(None)}
    let device:String=c.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).map_err(err)?;
    let mut stmt=c.prepare("SELECT o.change_id,o.device_id,o.operation,o.payload_json,m.before_json,m.after_json,m.payload_json,m.device_id,EXISTS(SELECT 1 FROM sync_conflicts f WHERE f.change_id=o.change_id AND f.resolved_at IS NULL) FROM sync_outbox o LEFT JOIN local_resource_mutations m ON m.account_id=o.account_id AND m.change_id=o.change_id AND m.resource_id=o.entity_id AND m.operation=o.operation WHERE o.account_id=?1 AND o.entity_type='resource' AND o.entity_id=?2 AND o.synced_at IS NULL ORDER BY o.rowid LIMIT 129").map_err(err)?;
    let mapped=stmt.query_map(params![account,current.id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,Option<String>>(4)?,r.get::<_,Option<String>>(5)?,r.get::<_,Option<String>>(6)?,r.get::<_,Option<String>>(7)?,r.get::<_,bool>(8)?))).map_err(err)?;
    let blocked=crate::resource_dependencies::blocked_changes(c)?;
    let mut rows=Vec::new();
    for row in mapped{
        let (id,owner,op,payload,before,after,native_payload,native_device,conflict)=row.map_err(err)?;
        if !["attach","edit_metadata"].contains(&op.as_str())||conflict||blocked.contains(&id)||native_device.as_deref()!=Some(device.as_str())||native_payload.as_deref()!=Some(payload.as_str()){return Err("Synchronize or review earlier resource changes before changing it again; saved work is preserved".into())}
        rows.push(MoveProof{id,device:owner,operation:op,before:serde_json::from_str(&before.ok_or("Missing native mutation origin")?).map_err(err)?,after:serde_json::from_str(&after.ok_or("Missing native mutation result")?).map_err(err)?,payload:serde_json::from_str(&payload).map_err(err)?});
    }
    let mut prefix=0;let mut latest_confirmed_revision=None;
    while let Some(previous)=rows.first().and_then(previous_mutation).map(str::to_owned){
        if rows.len()>=128||rows.iter().any(|row|row.id==previous){return Err("Resource mutation chain is cyclic or too long; saved work is preserved".into())}
        let (prior,revision)=confirmed_predecessor(c,&account,&current.id,&previous,&device)?;
        if prefix==0{latest_confirmed_revision=Some(revision)}
        rows.insert(0,prior);prefix+=1;
    }
    validate_move_chain(current,&rows,&device)?;
    let origin=chain_authority_origin(&rows,prefix,latest_confirmed_revision.as_deref())?;
    // Already committed destinations are historical. Pending destinations and
    // the current authority anchor are checked anew; receipts grant no rights.
    for row in &rows[prefix..]{if row.operation=="attach"{crate::local_resource_uploads::parent_guard(c,&row.payload["attachment"]["destination"])?;}}
    Ok(Some((origin,rows.last().unwrap().id.clone())))
}

pub(crate) fn require_cached_resource_editor(conn: &rusqlite::Connection, resource: &local_resources::LocalResource) -> Result<(), String> {
    local_auth::require_local_permission(conn, "resources.view")?;
    local_auth::require_local_permission(conn, "resources.edit")?;
    let role: String = conn.query_row("SELECT u.role FROM local_users u JOIN local_session s ON s.user_id=u.id WHERE s.id=1", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if role != "admin" {
        crate::local_resource_authority::require_edit(conn,resource)?;
    }
    Ok(())
}

#[tauri::command]
pub fn move_local_resource_attachment(app: AppHandle, expected_account_id: String,
    expected_session_token: String, resource_id: String, mut destination: Destination,
) -> Result<local_resources::LocalResource, String> {
    destination.normalize()?;
    let id = uuid::Uuid::parse_str(&resource_id).map_err(|_| "Invalid resource ID")?.to_string();
    let mut conn = local_db::open_local_connection(&app)?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    local_db::require_sync_account(&tx, &expected_account_id)?;
    local_auth::require_local_permission(&tx, "resources.view")?;
    local_auth::require_local_permission(&tx, "resources.edit")?;
    let token: String = tx.query_row("SELECT session_token FROM local_session WHERE id=1",
        [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if token != expected_session_token { return Err("Session changed while moving resource".into()); }
    let mut resources = local_resources::read_resources(&tx)?;
    let resource = resources.iter_mut().find(|r| r.id == id).ok_or("Resource unavailable on this PC")?;
    if resource.parent_resource_id.is_some() || resource.kind == "folder" {
        return Err("Folder trees and nested resources require folder management".into());
    }
    // Source authority and destination authority are independent checks.
    let previous=if let Some(previous)=crate::local_resource_authority::require_pending_mutation_editor(&tx,resource)?{Some(previous)}else{
        crate::resource_dependencies::require_editor_access(&tx, resource)?;
        crate::resource_dependencies::source_predecessor(&tx,&id)?
    };
    crate::local_resource_uploads::parent_guard(&tx, &serde_json::to_value(&destination).map_err(|e| e.to_string())?)?;
    let note_project=if let Some(note_id)=&destination.note_id{
        crate::local_notes::load(&tx)?.iter().find(|n|n["id"].as_str()==Some(note_id.as_str())).and_then(|n|n["project_id"].as_str()).map(str::to_owned)
    }else{None};
    if resource.visibility.as_deref() == Some("project") && destination.project_id.is_none() && note_project.is_none() {
        return Err("Keep this project-visible resource attached to a project or a verified project note".into());
    }
    let denied: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='local_resource_poster_denials')", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if denied {
        let revoked: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM local_resource_poster_denials WHERE account_id=?1 AND resource_id=?2)",
            params![expected_account_id, id], |r| r.get(0)).map_err(|e| e.to_string())?;
        if revoked { return Err("Resource access was revoked; the move has not been saved".into()); }
    }
    if resource.item_id == destination.item_id && resource.project_id == destination.project_id && resource.note_id == destination.note_id {
        return Ok(resource.clone());
    }
    let repeated:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM local_resource_mutations WHERE account_id=?1 AND change_id=?2)",params![expected_account_id,previous],|r|r.get(0)).map_err(err)?;
    let before=resource.clone();
    let revision = resource.updated_at.clone();
    resource.item_id = destination.item_id.clone();
    resource.project_id = destination.project_id.clone();
    resource.note_id = destination.note_id.clone();
    resource.item_name = None; resource.project_name = None; resource.note_title = None;
    // Keep the confirmed revision: moving metadata must not pretend file bytes
    // have changed. The authoritative revision arrives in the next server pull.
    let result = resource.clone();
    local_resources::write_resources(&tx, &resources)?;
    let device: String = tx.query_row("SELECT device_id FROM device_identity WHERE id=1", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    let change=uuid::Uuid::new_v4().to_string();
    let payload = json!({"id":id,"attachment":{"protocol":if repeated{3}else if previous.is_some(){2}else{1},"expected_updated_at":revision,"destination":destination,"previous_change_id":previous}});
    tx.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,'resource',?3,'attach',?4)",
        params![change,device,id,payload.to_string()]).map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO local_resource_mutations(account_id,change_id,resource_id,device_id,operation,before_json,after_json,payload_json) VALUES(?1,?2,?3,?4,'attach',?5,?6,?7)",params![expected_account_id,change,id,device,serde_json::to_string(&before).map_err(err)?,serde_json::to_string(&result).map_err(err)?,payload.to_string()]).map_err(err)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    const RESOURCE:&str="11111111-1111-4111-8111-111111111111";
    const FIRST:&str="22222222-2222-4222-8222-222222222222";
    const SECOND:&str="33333333-3333-4333-8333-333333333333";
    const PROJECT:&str="44444444-4444-4444-8444-444444444444";
    fn sample()->local_resources::LocalResource{
        serde_json::from_value(json!({"id":RESOURCE,"name":"sample.md","kind":"file","file_type":"text","size_bytes":10,"tags":[],"updated_at":"2026-10-14T12:00:00.000Z","created_at":"2026-10-14T12:00:00.000Z","visibility":"lab"})).unwrap()
    }
    fn chain()->Vec<MoveProof>{
        let before=sample();let mut attached=before.clone();attached.project_id=Some(PROJECT.into());
        let make=|id:&str,before:local_resources::LocalResource,after:local_resources::LocalResource,previous:Option<&str>|{
            let payload=json!({"id":RESOURCE,"attachment":{"protocol":if previous.is_some(){3}else{1},"expected_updated_at":before.updated_at,"destination":{"item_id":after.item_id,"project_id":after.project_id,"note_id":after.note_id},"previous_change_id":previous}});
            MoveProof{id:id.into(),device:"device".into(),operation:"attach".into(),before,after,payload}
        };
        vec![make(FIRST,before.clone(),attached.clone(),None),make(SECOND,attached,before,Some(FIRST))]
    }
    #[test]
    fn repeated_moves_preserve_versions_and_use_explicit_predecessors(){
        let rows=chain();validate_move_chain(&sample(),&rows,"device").unwrap();
        // Returning to the initial attachment still retains both ordered intents.
        assert_ne!(rows[0].id,rows[1].id);
        let mut hydrated=sample();hydrated.thumbnail_url=Some("local-preview".into());hydrated.project_name=Some("label".into());
        validate_move_chain(&hydrated,&rows,"device").unwrap();
    }
    #[test]
    fn acknowledged_prefix_uses_its_result_and_verified_server_revision_as_authority_anchor(){
        let rows=chain();validate_move_chain(&sample(),&rows,"device").unwrap();
        let origin=chain_authority_origin(&rows,1,Some("2026-10-15T12:00:00.000Z")).unwrap();
        assert_eq!(origin.project_id.as_deref(),Some(PROJECT));
        assert_eq!(origin.updated_at,"2026-10-15T12:00:00.000Z");
        assert_eq!(rows[1].before.updated_at,sample().updated_at);
        assert_eq!(rows[1].payload["attachment"]["previous_change_id"],FIRST);
        assert_eq!(chain_authority_origin(&rows,0,None).unwrap().updated_at,sample().updated_at);
        assert!(chain_authority_origin(&rows,1,None).is_err());
        assert!(chain_authority_origin(&rows,2,Some("server")).is_err());
    }
    #[test]
    fn partial_ack_still_requires_the_whole_immutable_chain(){
        let rows=chain();assert!(validate_move_chain(&sample(),&rows[1..],"device").is_err());
        let mut rows=chain();rows[0].after.project_id=None;
        assert!(validate_move_chain(&sample(),&rows,"device").is_err());
        let mut rows=chain();rows[0].device="other".into();
        assert!(validate_move_chain(&sample(),&rows,"device").is_err());
    }
    #[test]
    fn metadata_and_moves_share_one_native_ordered_chain(){
        let mut rows=chain();let before=rows[1].after.clone();let mut after=before.clone();
        let fields=json!({"description":"Saved between moves","tags":["lab"]});apply_metadata(&mut after,&fields).unwrap();
        rows.push(MoveProof{id:PROJECT.into(),device:"device".into(),operation:"edit_metadata".into(),payload:json!({"id":RESOURCE,"metadata":{"protocol":1,"expected_updated_at":before.updated_at,"fields":fields,"previous_change_id":SECOND}}),before,after:after.clone()});
        validate_move_chain(&after,&rows,"device").unwrap();
        rows[2].payload["metadata"]["previous_change_id"]=json!(FIRST);assert!(validate_move_chain(&after,&rows,"device").is_err());
    }
    #[test]
    fn direct_move_can_follow_native_metadata_without_changing_file_revision(){
        let before=sample();let mut metadata=before.clone();let fields=json!({"description":"Before move"});apply_metadata(&mut metadata,&fields).unwrap();
        let mut moved=metadata.clone();moved.project_id=Some(PROJECT.into());
        let rows=vec![
            MoveProof{id:FIRST.into(),device:"device".into(),operation:"edit_metadata".into(),before:before.clone(),after:metadata.clone(),payload:json!({"id":RESOURCE,"metadata":{"protocol":1,"expected_updated_at":before.updated_at,"fields":fields,"previous_change_id":null}})},
            MoveProof{id:SECOND.into(),device:"device".into(),operation:"attach".into(),before:metadata.clone(),after:moved.clone(),payload:json!({"id":RESOURCE,"attachment":{"protocol":3,"expected_updated_at":metadata.updated_at,"destination":{"item_id":null,"project_id":PROJECT,"note_id":null},"previous_change_id":FIRST}})},
        ];
        validate_move_chain(&moved,&rows,"device").unwrap();assert_eq!(moved.updated_at,before.updated_at);
    }
    #[test]
    fn metadata_patches_preserve_omitted_fields_and_cannot_change_authority(){
        let mut record=sample();record.category=Some("research".into());record.tags=vec!["existing".into()];
        apply_metadata(&mut record,&json!({"description":"saved"})).unwrap();
        assert_eq!(record.category.as_deref(),Some("research"));assert_eq!(record.tags,vec!["existing"]);
        assert_eq!(record.updated_at,sample().updated_at);
        for fields in [json!({"visibility":"lab"}),json!({"project_id":PROJECT}),json!({"size_bytes":4}),json!({"tags":[""]}),json!({"description":"x".repeat(5001)}),json!({"category":"invalid"})]{assert!(apply_metadata(&mut sample(),&fields).is_err());}
        apply_metadata(&mut record,&json!({"tags":[],"description":""})).unwrap();assert!(record.tags.is_empty());assert_eq!(record.description.as_deref(),Some(""));
    }
    #[test]
    fn move_chain_rejects_changed_content_metadata_or_current_scope(){
        for key in ["name","size_bytes","visibility","project_id","updated_at"]{
            let mut current=serde_json::to_value(sample()).unwrap();current[key]=if key=="size_bytes"{json!(11)}else{json!(PROJECT)};
            assert!(validate_move_chain(&serde_json::from_value(current).unwrap(),&chain(),"device").is_err(),"{key}");
        }
        let mut rows=chain();rows[0].after.name="renamed.md".into();assert!(validate_move_chain(&sample(),&rows,"device").is_err());
    }
    #[test]
    fn move_chain_rejects_foreign_devices_gaps_and_rewritten_payloads(){
        assert!(validate_move_chain(&sample(),&chain(),"other").is_err());
        let mut rows=chain();rows[1].payload["attachment"]["previous_change_id"]=json!(SECOND);assert!(validate_move_chain(&sample(),&rows,"device").is_err());
        let mut rows=chain();rows[1].before.project_id=None;assert!(validate_move_chain(&sample(),&rows,"device").is_err());
        let mut rows=chain();rows[0].payload["attachment"]["destination"]["visibility"]=json!("lab");assert!(validate_move_chain(&sample(),&rows,"device").is_err());
        let rows=chain();assert!(validate_move_chain(&sample(),&rows[1..],"device").is_err());
    }
    #[test]
    fn move_chain_does_not_authorize_legacy_or_nested_folder_intents(){
        let mut rows=chain();rows[1].payload["attachment"]["protocol"]=json!(2);assert!(validate_move_chain(&sample(),&rows,"device").is_err());
        let mut rows=chain();rows[0].before.parent_resource_id=Some(PROJECT.into());assert!(validate_move_chain(&sample(),&rows,"device").is_err());
        let mut rows=chain();rows[0].before.kind="folder".into();assert!(validate_move_chain(&sample(),&rows,"device").is_err());
        assert!(validate_move_chain(&sample(),&[],"device").is_err());
    }
    #[test]
    fn destination_is_single_parent_canonical_and_strict() {
        let mut d: Destination = serde_json::from_value(json!({"project_id":"AAFFBBCC00112233445566778899AABB"})).unwrap();
        d.normalize().unwrap();
        assert_eq!(d.project_id.as_deref(), Some("aaffbbcc-0011-2233-4455-66778899aabb"));
        d.item_id = d.project_id.clone();
        assert!(d.normalize().is_err());
        assert!(serde_json::from_value::<Destination>(json!({"parent_resource_id":null})).is_err());
    }
}
