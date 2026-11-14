use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use tauri::AppHandle;
use crate::local_db::{open_local_connection, scoped_state_key, require_sync_account};
use crate::local_auth;

const STATE_KEY: &str = "resources_state";
const SCHEMA_VERSION: &str = "008_local_resources";
#[cfg(test)]
std::thread_local! { static SNAPSHOT_READS:std::cell::Cell<usize>=const{std::cell::Cell::new(0)}; }
#[cfg(test)]
pub(crate) fn reset_snapshot_reads(){SNAPSHOT_READS.with(|count|count.set(0));}
#[cfg(test)]
pub(crate) fn snapshot_reads()->usize{SNAPSHOT_READS.with(|count|count.get())}

fn deserialize_optional_i64<'de, D>(deserializer: D) -> Result<Option<i64>, D::Error>
where D: serde::Deserializer<'de> {
    let value: Option<serde_json::Value> = Option::deserialize(deserializer)?;
    match value {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::Number(n)) => n.as_i64().ok_or_else(|| serde::de::Error::custom("expected an integer")) .map(Some),
        Some(serde_json::Value::String(s)) => s.parse::<i64>().map(Some).map_err(serde::de::Error::custom),
        Some(_) => Err(serde::de::Error::custom("expected an integer or numeric string")),
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LocalResource {
    pub id: String,
    pub name: String,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub name_source:Option<String>,
    pub kind: String,
    pub file_type: String,
    pub original_filename: Option<String>,
    pub mime_type: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_i64")]
    pub size_bytes: Option<i64>,
    pub url: Option<String>,
    pub thumbnail_url: Option<String>,
    pub local_media_path: Option<String>,
    pub local_media_filename: Option<String>,
    pub local_media_mime_type: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_i64")]
    pub local_media_size_bytes: Option<i64>,
    pub local_media_downloaded_at: Option<String>,
    pub parent_resource_id: Option<String>,
    pub relative_path: Option<String>,
    pub item_id: Option<String>,
    pub project_id: Option<String>,
    pub note_id: Option<String>,
    #[serde(default)]
    pub visibility: Option<String>,
    pub item_name: Option<String>,
    pub project_name: Option<String>,
    pub note_title: Option<String>,
    pub category: Option<String>,
    pub description: Option<String>,
    pub tags: Vec<String>,
    pub updated_at: String,
    pub created_at: String,
    pub derived_from_resource_id: Option<String>,
}

fn ensure_schema(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute(
        "INSERT OR IGNORE INTO local_schema_migrations(version) VALUES(?1)",
        [SCHEMA_VERSION],
    ).map_err(|e| format!("Unable to record local resources schema: {e}"))?;
    conn.execute(
        "INSERT OR IGNORE INTO sync_state(key,value) VALUES(?1,?2)",
        params![scoped_state_key(conn, STATE_KEY)?, "[]"],
    ).map_err(|e| format!("Unable to initialize local resources state: {e}"))?;
    Ok(())
}

pub(crate) fn read_resources(conn: &rusqlite::Connection) -> Result<Vec<LocalResource>, String> {
    #[cfg(test)]
    SNAPSHOT_READS.with(|count|count.set(count.get()+1));
    let raw: String = conn.query_row(
        "SELECT value FROM sync_state WHERE key=?1",
        [scoped_state_key(conn, STATE_KEY)?],
        |r| r.get(0),
    ).optional().map_err(|e| format!("Unable to read local resources: {e}"))?
      .unwrap_or_else(|| "[]".to_string());
    serde_json::from_str(&raw).map_err(|e| format!("Invalid local resources state: {e}"))
}

pub(crate) fn write_resources(conn: &rusqlite::Connection, resources: &[LocalResource]) -> Result<(), String> {
    let raw = serde_json::to_string(resources).map_err(|e| format!("Unable to encode local resources: {e}"))?;
    conn.execute(
        "INSERT INTO sync_state(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![scoped_state_key(conn, STATE_KEY)?, raw],
    ).map_err(|e| format!("Unable to save local resources: {e}"))?;
    crate::local_resource_posters::purge_absent(conn,resources)?;
    Ok(())
}

fn save_with_change(conn: &rusqlite::Connection, resources: &[LocalResource], entity_id: &str, operation: &str, payload: &Value) -> Result<(), String> {
    let permission=match operation{"create"=>"resources.create","delete"=>"resources.delete",_=>"resources.edit"};
    local_auth::require_local_permission(conn,permission)?;
    if conn.is_autocommit(){return Err("Resource writes require the guarded native transaction".into())}
    let tx=conn;
    if operation=="create"{crate::local_resource_uploads::parent_guard(tx,payload.get("resource").unwrap_or(payload))?;}
    if operation=="delete"{let original:LocalResource=serde_json::from_value(payload["resource"].clone()).map_err(|e|e.to_string())?;crate::local_resource_authority::require_delete(tx,&original)?;}
    write_resources(tx, resources)?;
    let device_id: String = tx.query_row("SELECT device_id FROM device_identity WHERE id=1", [], |r| r.get(0))
        .map_err(|e| format!("Unable to read device identity: {e}"))?;
    let change_id = new_id(&tx)?;
    let mut payload=payload.clone();if operation=="create"{payload["native_create_protocol"]=serde_json::json!(1);}
    let mut payload=payload.clone();if operation=="create"{let record=payload.get("resource").unwrap_or(&payload);let dependencies=crate::local_resource_destinations::dependencies(&tx,record)?;if !dependencies.is_empty(){payload["destination_dependencies"]=serde_json::json!(dependencies);}}
    tx.execute(
        "INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,'resource',?3,?4,?5)",
        params![change_id, device_id, entity_id, operation, payload.to_string()],
    ).map_err(|e| format!("Unable to queue local resource change: {e}"))?;
    if operation=="create"{let record:LocalResource=serde_json::from_value(payload["resource"].clone()).map_err(|e|e.to_string())?;crate::local_resource_attachments::record_native_proof(tx,&change_id,"create",&record,&record,&payload)?;}
    Ok(())
}

fn now(conn: &rusqlite::Connection) -> Result<String, String> {
    conn.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |r| r.get(0))
        .map_err(|e| format!("Unable to create resource timestamp: {e}"))
}

fn new_id(_: &rusqlite::Connection) -> Result<String, String> {
    Ok(uuid::Uuid::new_v4().to_string())
}

// PostgreSQL accepts compact UUID input but returns the canonical hyphenated
// representation. Treat both representations as the same resource while
// reconciling older local state created before resource IDs used UUID strings.
fn canonical_resource_id(id: &str) -> String {
    id.chars().filter(|c| *c != '-').collect::<String>().to_ascii_lowercase()
}

fn merge_server_resource(current: &mut Vec<LocalResource>, mut incoming: LocalResource) {
    let incoming_id = canonical_resource_id(&incoming.id);
    current.retain(|existing| {
        if canonical_resource_id(&existing.id) != incoming_id {
            return true;
        }
        if incoming.local_media_path.is_none() { incoming.local_media_path = existing.local_media_path.clone(); }
        if incoming.local_media_filename.is_none() { incoming.local_media_filename = existing.local_media_filename.clone(); }
        if incoming.local_media_mime_type.is_none() { incoming.local_media_mime_type = existing.local_media_mime_type.clone(); }
        if incoming.local_media_size_bytes.is_none() { incoming.local_media_size_bytes = existing.local_media_size_bytes; }
        if incoming.local_media_downloaded_at.is_none() { incoming.local_media_downloaded_at = existing.local_media_downloaded_at.clone(); }
        false
    });
    current.push(incoming);
}

fn normalize_resource_url(url: &str) -> String {
    let trimmed = url.trim();
    trimmed.trim_end_matches('/').to_string()
}

fn youtube_id(url: &str) -> Option<String> {
    let clean = url.trim();
    if let Some(rest) = clean.strip_prefix("https://youtu.be/").or_else(|| clean.strip_prefix("http://youtu.be/")) {
        return Some(rest.split(['?','/']).next().unwrap_or("").to_string()).filter(|v| !v.is_empty());
    }
    if let Some(pos) = clean.find("v=") {
        let rest = &clean[pos + 2..];
        return Some(rest.split(['&','/']).next().unwrap_or("").to_string()).filter(|v| !v.is_empty());
    }
    for marker in ["/shorts/","/embed/","/live/"] {
        if let Some(pos) = clean.find(marker) {
            let rest=&clean[pos+marker.len()..];
            return Some(rest.split(['?','/']).next().unwrap_or("").to_string()).filter(|v| !v.is_empty());
        }
    }
    None
}

fn normalize_tags(tags: Option<Vec<String>>) -> Vec<String> {
    tags.unwrap_or_default().into_iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .take(30)
        .collect()
}

fn metadata(category: Option<String>, description: Option<String>, tags: Option<Vec<String>>) -> (String, String, Vec<String>) {
    let allowed = ["general","datasheet","manual","schematic","research","tutorial","reference","specification","image","cad","report","video","other"];
    let category = category.filter(|v| allowed.contains(&v.as_str())).unwrap_or_else(|| "general".to_string());
    let description = description.unwrap_or_default().trim().chars().take(5000).collect::<String>();
    (category, description, normalize_tags(tags))
}

pub(crate) fn validate_parent(resources: &[LocalResource], item_id: &Option<String>, project_id: &Option<String>, note_id: &Option<String>, parent_resource_id: &Option<String>) -> Result<(), String> {
    if [item_id, project_id, note_id,parent_resource_id].iter().filter(|v| v.is_some()).count() > 1 {
        return Err("A resource can have at most one direct attachment destination".into());
    }
    if let Some(parent) = parent_resource_id {
        let exists = resources.iter().any(|r| r.id == *parent && r.kind == "folder");
        if !exists { return Err("Parent resource folder was not found".into()); }
        let mut current=Some(parent.as_str());let mut seen=HashSet::new();
        while let Some(id)=current{if seen.len()>=31||!seen.insert(id){return Err("Resource folder ancestry is cyclic or exceeds 31 levels".into())}let record=resources.iter().find(|r|r.id==id&&r.kind=="folder").ok_or("Folder ancestor is unavailable")?;current=record.parent_resource_id.as_deref();}
    }
    Ok(())
}

#[tauri::command]
pub async fn list_local_resources(app: AppHandle, item_id: Option<String>, project_id: Option<String>, note_id: Option<String>, parent_resource_id: Option<String>, include_descendants: Option<bool>) -> Result<Vec<LocalResource>, String> {
    crate::responsive_reads::run("list_local_resources", move || {
    let conn = open_local_connection(&app)?;
    crate::local_auth::require_local_permission(&conn,"resources.view")?;
    ensure_schema(&conn)?;
    let account=crate::local_db::active_account(&conn)?;
    let resources=resource_listing(read_resources(&conn)?,&item_id,&project_id,&note_id,&parent_resource_id,include_descendants.unwrap_or(false));
    require_sync_account(&conn,&account)?;
    crate::local_auth::require_local_permission(&conn,"resources.view")?;
    Ok(resources)

    }).await
}

// Collection consumers (folder manifests, filters, reports and download state)
// need the whole authorized account snapshot. Ordinary listings remain shallow;
// asking for descendants never overrides an explicit attachment/folder filter.
fn resource_listing(mut resources:Vec<LocalResource>,item_id:&Option<String>,project_id:&Option<String>,note_id:&Option<String>,parent_resource_id:&Option<String>,include_descendants:bool)->Vec<LocalResource>{
    resources.retain(|r| {
        match (item_id,project_id,note_id,parent_resource_id) {
            (Some(id),_,_,_) => r.item_id.as_deref() == Some(id.as_str()),
            (_,Some(id),_,_) => r.project_id.as_deref() == Some(id.as_str()),
            (_,_,Some(id),_) => r.note_id.as_deref() == Some(id.as_str()),
            (_,_,_,Some(id)) => r.parent_resource_id.as_deref() == Some(id.as_str()),
            _ => include_descendants || r.parent_resource_id.is_none(),
        }
    });
    resources.sort_by(|a,b| b.created_at.cmp(&a.created_at));
    resources
}

#[tauri::command]
pub async fn get_local_resource(app: AppHandle, id: String) -> Result<LocalResource, String> {
    crate::responsive_reads::run("get_local_resource", move || {
    let conn = open_local_connection(&app)?;
    crate::local_auth::require_local_permission(&conn,"resources.view")?;
    ensure_schema(&conn)?;
    read_resources(&conn)?.into_iter().find(|r| r.id == id).ok_or_else(|| "Resource not found".into())

    }).await
}

#[tauri::command]
pub fn cache_local_resources(app: AppHandle, resources_json: String, expected_account_id: String) -> Result<usize, String> {
    let incoming: Vec<LocalResource> = serde_json::from_str(&resources_json).map_err(|e| format!("Invalid resources cache: {e}"))?;
    let mut conn = open_local_connection(&app)?;
    ensure_schema(&conn)?;
    let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|format!("Unable to begin resource cache update: {e}"))?;
    require_sync_account(&tx,&expected_account_id)?;
    let mut current = read_resources(&tx)?;
    let pending: HashSet<String> = {
        let mut stmt = tx.prepare("SELECT entity_id FROM active_sync_outbox WHERE synced_at IS NULL AND entity_type='resource' AND entity_id IS NOT NULL")
            .map_err(|e| format!("Unable to inspect pending resource changes: {e}"))?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| format!("Unable to inspect pending resource changes: {e}"))?;
        rows.filter_map(|r| r.ok()).map(|id| canonical_resource_id(&id)).collect()
    };
    for incoming_resource in incoming {
        if pending.contains(&canonical_resource_id(&incoming_resource.id)) { continue; }
        merge_server_resource(&mut current, incoming_resource);
    }
    write_resources(&tx, &current)?;
    tx.commit().map_err(|e|format!("Unable to commit resource cache update: {e}"))?;
    Ok(current.len())
}

#[tauri::command]
pub fn create_local_resource_link(app: AppHandle, expected_account_id:String, expected_session_token:String, url: String, name: Option<String>, item_id: Option<String>, project_id: Option<String>, note_id: Option<String>, parent_resource_id: Option<String>, category: Option<String>, description: Option<String>, tags: Option<Vec<String>>) -> Result<LocalResource, String> {
    if url.trim().is_empty() { return Err("url is required".into()); }
    let url=url.trim().to_owned();
    let mut connection = open_local_connection(&app)?;
    let conn=connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
    crate::local_resource_authority::guard(&conn,&expected_account_id,&expected_session_token)?;
    local_auth::require_local_permission(&conn,"resources.view")?;
    local_auth::require_local_permission(&conn,"resources.create")?;
    ensure_schema(&conn)?;
    let mut resources = read_resources(&conn)?;
    validate_parent(&resources,&item_id,&project_id,&note_id,&parent_resource_id)?;
    crate::local_resource_uploads::parent_guard(&conn,&serde_json::json!({"item_id":item_id,"project_id":project_id,"note_id":note_id,"parent_resource_id":parent_resource_id}))?;
    let normalized_url = normalize_resource_url(&url);
    if let Some(existing) = resources.iter()
        .filter(|r| r.kind == "link" && normalize_resource_url(r.url.as_deref().unwrap_or("")) == normalized_url)
        .filter(|r| r.item_id == item_id && r.project_id == project_id && r.note_id == note_id && r.parent_resource_id == parent_resource_id)
        .max_by_key(|r| if r.local_media_path.is_some() { 1 } else { 0 })
        .cloned()
    {
        return Ok(existing);
    }
    let (category,description,tags)=metadata(category,description,tags);
    let id=new_id(&conn)?; let timestamp=now(&conn)?;
    let youtube=if url.contains("youtube.com")||url.contains("youtu.be"){youtube_id(&url)}else{None};
    let file_type=if youtube.is_some(){"youtube"}else{"other"};
    let thumbnail_url=youtube.as_ref().map(|id|format!("https://img.youtube.com/vi/{id}/hqdefault.jpg"));
    let resource=LocalResource{id:id.clone(),name_source:Some(if name.as_ref().is_some_and(|n|!n.trim().is_empty()){"user"}else{"url_fallback"}.into()),name:name.filter(|n|!n.trim().is_empty()).map(|name|name.trim().to_owned()).unwrap_or_else(||url.clone()),kind:"link".into(),file_type:file_type.into(),original_filename:None,mime_type:None,size_bytes:None,url:Some(url),thumbnail_url,local_media_path:None,local_media_filename:None,local_media_mime_type:None,local_media_size_bytes:None,local_media_downloaded_at:None,parent_resource_id,relative_path:None,item_id,project_id,note_id,visibility:Some("lab".into()),item_name:None,project_name:None,note_title:None,category:Some(category),description:Some(description),tags,updated_at:timestamp.clone(),created_at:timestamp,derived_from_resource_id:None};
    resources.push(resource.clone());
    save_with_change(&conn, &resources, &id, "create", &serde_json::json!({"resource": resource}))?;
    conn.commit().map_err(|e|e.to_string())?;Ok(resource)
}


#[tauri::command]
pub fn queue_local_resource_download(app: AppHandle, resource_id: String, quality: Option<String>) -> Result<serde_json::Value, String> {
    let mut conn=open_local_connection(&app)?;
    let account=crate::local_db::active_account(&conn)?;
    crate::local_downloads::queue(&mut conn,&account,&resource_id,quality,None)
}



pub(crate) fn require_resource_path_available(resources:&[LocalResource],folder:&LocalResource)->Result<(),String>{
    let target=folder.relative_path.as_deref().or(folder.original_filename.as_deref()).unwrap_or(&folder.name).to_lowercase();
    if resources.iter().any(|r|{
        if !["file","folder"].contains(&r.kind.as_str())||r.id==folder.id||r.item_id!=folder.item_id||r.project_id!=folder.project_id||r.note_id!=folder.note_id||r.parent_resource_id!=folder.parent_resource_id||folder.parent_resource_id.is_none()&&r.kind!="folder"{return false}
        let path=r.relative_path.as_deref().or(r.original_filename.as_deref()).unwrap_or(&r.name).to_lowercase();
        path==target||path.starts_with(&format!("{target}/"))||target.starts_with(&format!("{path}/"))
    }){return Err("A resource already occupies that folder path or one of its parents. Refresh to review it; existing work is preserved".into())}Ok(())
}

pub(crate) fn folder_creation_path(name:&str,has_parent:bool,path:Option<String>)->Result<Option<String>,String>{
    if name.trim().is_empty()||name.trim().chars().count()>200||[".",".."].contains(&name.trim())||name.chars().any(|c|c.is_control()||['/', '\\', ':'].contains(&c)){return Err("Folder name must be a single path component of 1 to 200 characters".into())}
    if !has_parent{if path.is_some(){return Err("Folder path requires a parent folder".into())}return Ok(None)}
    let path=path.unwrap_or_else(||name.trim().into());
    if path.len()>1024||path.chars().any(|c|c.is_control()||c==':'||c=='\\')||path.split('/').any(|part|part.is_empty()||part=="."||part=="..")||path.rsplit('/').next()!=Some(name.trim()){return Err("Invalid empty folder path".into())}
    Ok(Some(path))
}

#[tauri::command]
pub fn create_local_resource_folder(app: AppHandle, expected_account_id:String, expected_session_token:String, name: String, item_id: Option<String>, project_id: Option<String>, note_id: Option<String>, parent_resource_id: Option<String>, relative_path:Option<String>, category: Option<String>, description: Option<String>, tags: Option<Vec<String>>) -> Result<LocalResource, String> {
    let mut connection=open_local_connection(&app)?;
    create_folder_transaction(&mut connection,expected_account_id,expected_session_token,name,item_id,project_id,note_id,parent_resource_id,relative_path,category,description,tags)
}

pub(crate) fn create_folder_transaction(connection:&mut rusqlite::Connection, expected_account_id:String, expected_session_token:String, name: String, item_id: Option<String>, project_id: Option<String>, note_id: Option<String>, parent_resource_id: Option<String>, relative_path:Option<String>, category: Option<String>, description: Option<String>, tags: Option<Vec<String>>) -> Result<LocalResource, String> {
    let relative_path=folder_creation_path(&name,parent_resource_id.is_some(),relative_path)?;
    let conn=connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
    crate::local_resource_authority::guard(&conn,&expected_account_id,&expected_session_token)?;ensure_schema(&conn)?;
    local_auth::require_local_permission(&conn,"resources.view")?;
    local_auth::require_local_permission(&conn,"resources.create")?;
    crate::local_resource_uploads::parent_guard(&conn,&serde_json::json!({"item_id":item_id,"project_id":project_id,"note_id":note_id,"parent_resource_id":parent_resource_id,"relative_path":relative_path}))?;
    let mut resources=read_resources(&conn)?; validate_parent(&resources,&item_id,&project_id,&note_id,&parent_resource_id)?;
    let (category,description,tags)=metadata(category,description,tags); let id=new_id(&conn)?; let timestamp=now(&conn)?;
    let resource=LocalResource{id:id.clone(),name:name.trim().to_string(),name_source:Some("user".into()),kind:"folder".into(),file_type:"schematic_folder".into(),original_filename:None,mime_type:None,size_bytes:None,url:None,thumbnail_url:None,local_media_path:None,local_media_filename:None,local_media_mime_type:None,local_media_size_bytes:None,local_media_downloaded_at:None,parent_resource_id,relative_path,item_id,project_id,note_id,visibility:Some("lab".into()),item_name:None,project_name:None,note_title:None,category:Some(category),description:Some(description),tags,updated_at:timestamp.clone(),created_at:timestamp,derived_from_resource_id:None};
    require_resource_path_available(&resources,&resource)?;
    resources.push(resource.clone()); save_with_change(&conn, &resources, &id, "create", &serde_json::json!({"resource": resource}))?; conn.commit().map_err(|e|e.to_string())?;Ok(resource)
}

#[tauri::command]
pub fn update_local_resource_metadata(app: AppHandle, id: String, expected_account_id:String, expected_session_token:String, category: Option<String>, description: Option<String>, tags: Option<Vec<String>>, reviewed_metadata:Option<Value>, name:Option<String>) -> Result<LocalResource, String> {
    let provided=(category.is_some(),description.is_some(),tags.is_some());
    let (category,description,tags)=metadata(category,description,tags);
    let mut fields=serde_json::Map::new();
    if let Some(name)=name{fields.insert("name".into(),serde_json::json!(name.trim()));}
    if provided.0{fields.insert("category".into(),serde_json::json!(category));}
    if provided.1{fields.insert("description".into(),serde_json::json!(description));}
    if provided.2{fields.insert("tags".into(),serde_json::json!(tags));}
    crate::local_resource_attachments::edit_metadata(app,expected_account_id,expected_session_token,id,Value::Object(fields),reviewed_metadata)
}

#[tauri::command]
pub fn delete_local_resource(app: AppHandle, id: String, expected_account_id:String, expected_session_token:String) -> Result<(), String> {
    let mut connection=open_local_connection(&app)?;
    let conn=connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
    crate::local_resource_authority::guard(&conn,&expected_account_id,&expected_session_token)?;ensure_schema(&conn)?;let mut resources=read_resources(&conn)?;
    if !resources.iter().any(|r|r.id==id) { return Err("Resource not found".into()); }
    if resources.iter().any(|r|r.parent_resource_id.as_deref()==Some(id.as_str())) { return Err("Cannot delete a folder that still contains resources".into()); }
    let deleted = resources.iter().find(|r| r.id==id).cloned().ok_or_else(||"Resource not found".to_string())?; resources.retain(|r| r.id!=id); save_with_change(&conn, &resources, &id, "delete", &serde_json::json!({"resource": deleted}))?;conn.commit().map_err(|e|e.to_string())?;Ok(())
}

#[tauri::command]
pub fn apply_server_resource_pull(app: AppHandle, resources_json: String, visible_resource_ids: Vec<String>, deleted_resource_ids: Vec<String>, expected_account_id: String) -> Result<(), String> {
    let incoming: Vec<LocalResource> = serde_json::from_str(&resources_json)
        .map_err(|e| format!("Invalid server resources payload: {e}"))?;
    let mut conn = open_local_connection(&app)?;
    ensure_schema(&conn)?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| format!("Unable to begin server resource merge: {e}"))?;
    require_sync_account(&tx, &expected_account_id)?;
    let raw: String = tx.query_row("SELECT value FROM sync_state WHERE key=?1", [scoped_state_key(&tx, STATE_KEY)?], |r| r.get(0))
        .optional().map_err(|e| format!("Unable to read local resources: {e}"))?
        .unwrap_or_else(|| "[]".to_string());
    let mut current: Vec<LocalResource> = serde_json::from_str(&raw)
        .map_err(|e| format!("Invalid local resources state: {e}"))?;
    let mut pending = HashSet::new();
    {
        let mut stmt = tx.prepare("SELECT entity_id FROM active_sync_outbox WHERE synced_at IS NULL AND entity_type='resource' AND entity_id IS NOT NULL")
            .map_err(|e| format!("Unable to inspect pending resource changes: {e}"))?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| format!("Unable to inspect pending resource changes: {e}"))?;
        for row in rows { pending.insert(canonical_resource_id(&row.map_err(|e| format!("Unable to read pending resource id: {e}"))?)); }
    }
    let deleted: HashSet<String> = deleted_resource_ids.into_iter().collect();
    let visible: HashSet<String> = visible_resource_ids.into_iter().map(|id| canonical_resource_id(&id)).collect();
    crate::local_resource_posters::restrict_to_visible(&tx,&expected_account_id,&visible)?;
    crate::local_resource_storage::observe_visibility(&tx,&expected_account_id,&visible,&deleted)?;
    current.retain(|r| {
        let id = canonical_resource_id(&r.id);
        pending.contains(&id) || (visible.contains(&id) && !deleted.iter().any(|deleted_id| canonical_resource_id(deleted_id) == id))
    });
    for incoming_resource in incoming {
        if pending.contains(&canonical_resource_id(&incoming_resource.id)) { continue; }
        merge_server_resource(&mut current, incoming_resource);
    }
    write_resources(&tx, &current)?;
    tx.commit().map_err(|e| format!("Unable to commit server resource merge: {e}"))
}

#[tauri::command]
pub async fn get_local_resource_tags(app: AppHandle) -> Result<Vec<String>, String> {
    crate::responsive_reads::run("get_local_resource_tags", move || {
    let conn=open_local_connection(&app)?; crate::local_auth::require_local_permission(&conn,"resources.view")?; ensure_schema(&conn)?; let resources=read_resources(&conn)?;
    let mut tags=resources.into_iter().flat_map(|r|r.tags).collect::<Vec<_>>(); tags.sort(); tags.dedup(); Ok(tags)

    }).await
}

#[allow(dead_code)]
fn _validate_json_state(value: &Value) -> Result<(), String> {
    if !value.is_object() { return Err("Resource state must be an object".into()); }
    Ok(())
}


#[cfg(test)]
mod tests {
    use super::*;

    fn resource(id: &str, kind: &str, item_id: Option<&str>, parent_resource_id: Option<&str>) -> LocalResource {
        LocalResource {
            id: id.into(), name: id.into(), name_source:None, kind: kind.into(), file_type: "other".into(),
            original_filename: None, mime_type: None, size_bytes: None, url: None,
            thumbnail_url: None, local_media_path: None, local_media_filename: None,
            local_media_mime_type: None, local_media_size_bytes: None,
            local_media_downloaded_at: None, parent_resource_id: parent_resource_id.map(str::to_string),
            relative_path: None, item_id: item_id.map(str::to_string), project_id: None,
            note_id: None, visibility: None, item_name: None, project_name: None, note_title: None,
            category: Some("general".into()), description: Some(String::new()), tags: vec![],
            updated_at: "2026-09-20T00:00:00Z".into(), created_at: "2026-09-20T00:00:00Z".into(),
            derived_from_resource_id: None,
        }
    }

    #[test]
    fn collection_listing_includes_nested_rows_only_when_explicit_and_never_overrides_scope() {
        let mut rows=vec![resource("root","folder",None,None),resource("nested","folder",None,Some("root"))];
        rows.extend((0..2000).map(|i|resource(&format!("file-{i}"),"file",None,Some("nested"))));
        let shallow=resource_listing(rows.clone(),&None,&None,&None,&None,false);
        assert_eq!(shallow.len(),1);assert_eq!(shallow[0].id,"root");
        assert_eq!(resource_listing(rows.clone(),&None,&None,&None,&None,true).len(),2002);
        let children=resource_listing(rows.clone(),&None,&None,&None,&Some("root".into()),true);
        assert_eq!(children.len(),1);assert_eq!(children[0].id,"nested");
        assert_eq!(resource_listing(rows.clone(),&None,&None,&None,&Some("nested".into()),true).len(),2000);
        assert!(resource_listing(rows,&Some("unrelated-item".into()),&None,&None,&None,true).is_empty());
    }

    #[test]
    fn normalize_resource_url_trims_whitespace_and_trailing_slashes() {
        assert_eq!(normalize_resource_url("  https://example.com/video///  "), "https://example.com/video");
        assert_eq!(normalize_resource_url("https://example.com/"), "https://example.com");
    }

    #[test]
    fn merge_server_resource_reconciles_compact_and_hyphenated_uuid_ids() {
        let mut legacy = resource("fe42da30ac8b41af6cee47ef14f1ba72", "link", None, None);
        legacy.thumbnail_url = Some("https://img.youtube.com/vi/example/hqdefault.jpg".into());
        legacy.local_media_path = Some("C:/LabOS/example.mp4".into());
        legacy.local_media_filename = Some("example.mp4".into());

        let mut server = resource("fe42da30-ac8b-41af-6cee-47ef14f1ba72", "link", None, None);
        server.thumbnail_url = Some("/api/media-downloads/fe42da30-ac8b-41af-6cee-47ef14f1ba72/thumbnail".into());

        let mut resources = vec![legacy];
        merge_server_resource(&mut resources, server);

        assert_eq!(resources.len(), 1);
        assert_eq!(resources[0].id, "fe42da30-ac8b-41af-6cee-47ef14f1ba72");
        assert_eq!(resources[0].thumbnail_url.as_deref(), Some("/api/media-downloads/fe42da30-ac8b-41af-6cee-47ef14f1ba72/thumbnail"));
        assert_eq!(resources[0].local_media_filename.as_deref(), Some("example.mp4"));
    }

    #[test]
    fn validate_parent_rejects_multiple_direct_parent_contexts() {
        let resources = vec![];
        let err = validate_parent(
            &resources,
            &Some("item-1".into()),
            &Some("project-1".into()),
            &None,
            &None,
        ).unwrap_err();
        assert!(err.contains("at most one"));
    }

    #[test]
    fn empty_folder_transaction_is_offline_atomic_owned_and_reopens_with_native_provenance(){
        let path=std::env::temp_dir().join(format!("labos-empty-folders-{}.sqlite",uuid::Uuid::new_v4()));
        let mut c=rusqlite::Connection::open(&path).unwrap();crate::local_db::ensure_schema(&c).unwrap();
        c.execute_batch("CREATE TABLE local_users(id TEXT PRIMARY KEY,central_user_id TEXT,role TEXT,is_active INTEGER,offline_expires_at TEXT,permissions_json TEXT);CREATE TABLE local_session(id INTEGER PRIMARY KEY,user_id TEXT,session_token TEXT);INSERT INTO local_users VALUES('local','account','viewer',1,datetime('now','+1 hour'),'[\"resources.view\",\"resources.create\"]');INSERT INTO local_session VALUES(1,'local','native-session');").unwrap();
        let root=create_folder_transaction(&mut c,"account".into(),"native-session".into(),"Designs".into(),None,None,None,None,None,None,None,None).unwrap();
        let empty=create_folder_transaction(&mut c,"account".into(),"native-session".into(),"Empty".into(),None,None,None,Some(root.id.clone()),Some("virtual/Empty".into()),None,None,None).unwrap();
        assert_eq!(empty.parent_resource_id,Some(root.id.clone()));assert_eq!(empty.relative_path.as_deref(),Some("virtual/Empty"));
        let snapshot=serde_json::to_string(&read_resources(&c).unwrap()).unwrap();
        assert!(create_folder_transaction(&mut c,"account".into(),"native-session".into(),"empty".into(),None,None,None,Some(root.id.clone()),Some("virtual/empty".into()),None,None,None).is_err());
        assert!(create_folder_transaction(&mut c,"other".into(),"native-session".into(),"Foreign".into(),None,None,None,None,None,None,None,None).is_err());
        assert!(create_folder_transaction(&mut c,"account".into(),"stale-session".into(),"Stale".into(),None,None,None,None,None,None,None,None).is_err());
        assert_eq!(serde_json::to_string(&read_resources(&c).unwrap()).unwrap(),snapshot);
        assert_eq!(c.query_row("SELECT count(*) FROM sync_outbox WHERE account_id='account' AND synced_at IS NULL",[],|r|r.get::<_,i64>(0)).unwrap(),2);
        assert_eq!(c.query_row("SELECT count(*) FROM local_resource_mutations WHERE account_id='account'",[],|r|r.get::<_,i64>(0)).unwrap(),2);
        drop(c);let mut c=rusqlite::Connection::open(&path).unwrap();
        let nested=create_folder_transaction(&mut c,"account".into(),"native-session".into(),"Nested".into(),None,None,None,Some(empty.id.clone()),None,None,None,None).unwrap();
        assert_eq!(nested.parent_resource_id,Some(empty.id));assert_eq!(nested.relative_path.as_deref(),Some("Nested"));
        assert_eq!(c.query_row("SELECT count(*) FROM sync_outbox WHERE account_id='account'",[],|r|r.get::<_,i64>(0)).unwrap(),3);
        drop(c);std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn empty_folder_paths_are_scoped_and_cannot_escape_or_alias_existing_files(){
        assert_eq!(folder_creation_path("Empty",false,None).unwrap(),None);
        assert_eq!(folder_creation_path("Empty",true,Some("virtual/Empty".into())).unwrap(),Some("virtual/Empty".into()));
        for name in ["", ".", "..", "a/b", "a:b", "a\\b"]{assert!(folder_creation_path(name,true,None).is_err());}
        for path in ["../Empty","/Empty","virtual//Empty","virtual/../Empty","virtual/Other"]{assert!(folder_creation_path("Empty",true,Some(path.into())).is_err());}
        assert!(folder_creation_path("Empty",false,Some("Empty".into())).is_err());
        let mut folder=resource("folder","folder",None,None);folder.name="Empty".into();folder.parent_resource_id=Some("parent".into());
        let mut file=resource("file","file",None,None);file.original_filename=Some("empty".into());file.parent_resource_id=Some("parent".into());
        assert!(require_resource_path_available(&[file.clone()],&folder).is_err());
        file.parent_resource_id=Some("another-folder".into());assert!(require_resource_path_available(&[file],&folder).is_ok());
    }

    #[test]
    fn validate_parent_requires_existing_folder_for_nested_resource() {
        let resources = vec![resource("not-a-folder", "link", None, None)];
        let err = validate_parent(
            &resources,
            &None,
            &None,
            &None,
            &Some("not-a-folder".into()),
        ).unwrap_err();
        assert!(err.contains("Parent resource folder was not found"));
    }

    #[test]
    fn validate_parent_accepts_existing_folder() {
        let resources = vec![resource("folder-1", "folder", None, None)];
        assert!(validate_parent(
            &resources,
            &None,
            &None,
            &None,
            &Some("folder-1".into()),
        ).is_ok());
    }

    #[test]
    fn normalize_tags_drops_empty_values_and_limits_count() {
        let tags = normalize_tags(Some(vec![" alpha ".into(), "".into(), " beta".into()]));
        assert_eq!(tags, vec!["alpha", "beta"]);

        let many = normalize_tags(Some((0..40).map(|i| format!("tag-{i}")).collect()));
        assert_eq!(many.len(), 30);
    }
    #[test]
    fn native_folder_creation_is_atomic_and_carries_private_offline_parent_authority(){
        let path=std::env::temp_dir().join(format!("labos-native-folder-{}.sqlite",uuid::Uuid::new_v4()));let mut c=rusqlite::Connection::open(&path).unwrap();crate::local_db::ensure_schema(&c).unwrap();
        c.execute_batch("CREATE TABLE local_users(id TEXT PRIMARY KEY,central_user_id TEXT,role TEXT,is_active INTEGER,offline_expires_at TEXT,permissions_json TEXT);CREATE TABLE local_session(id INTEGER PRIMARY KEY,user_id TEXT,session_token TEXT);INSERT INTO local_users VALUES('u','owner','researcher',1,datetime('now','+1 hour'),'[\"resources.view\",\"resources.create\",\"resources.edit\"]');INSERT INTO local_session VALUES(1,'u','session');").unwrap();ensure_schema(&c).unwrap();crate::local_resource_attachments::schema(&c).unwrap();
        let folder=resource("11111111-1111-4111-8111-111111111111","folder",None,None);let payload=serde_json::json!({"resource":folder});
        assert!(save_with_change(&c,&[folder.clone()],&folder.id,"create",&payload).is_err());
        c.execute_batch("CREATE TRIGGER fail_native_folder_proof BEFORE INSERT ON local_resource_mutations BEGIN SELECT RAISE(ABORT,'proof failed'); END;").unwrap();
        {let tx=c.transaction().unwrap();assert!(save_with_change(&tx,&[folder.clone()],&folder.id,"create",&payload).is_err());}
        assert!(read_resources(&c).unwrap().is_empty());assert_eq!(c.query_row("SELECT count(*) FROM sync_outbox",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        c.execute_batch("DROP TRIGGER fail_native_folder_proof;").unwrap();{let tx=c.transaction().unwrap();crate::local_resource_authority::guard(&tx,"owner","session").unwrap();save_with_change(&tx,&[folder.clone()],&folder.id,"create",&payload).unwrap();tx.commit().unwrap();}drop(c);
        let c=rusqlite::Connection::open(&path).unwrap();assert_eq!(read_resources(&c).unwrap().len(),1);assert_eq!(c.query_row("SELECT json_extract(payload_json,'$.native_create_protocol') FROM sync_outbox",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        assert!(crate::local_resource_authority::require_own_pending_creation(&c,&folder).unwrap());crate::local_resource_uploads::parent_guard(&c,&serde_json::json!({"parent_resource_id":folder.id})).unwrap();
        let mut altered=folder.clone();altered.name="Unproven cache edit".into();assert!(crate::local_resource_authority::require_own_pending_creation(&c,&altered).is_err());assert!(crate::local_resource_authority::guard(&c,"owner","old-session").is_err());
        drop(c);std::fs::remove_file(path).unwrap();
    }
}
