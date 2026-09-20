use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use tauri::AppHandle;
use crate::local_db::open_local_connection;
use crate::local_auth;

const STATE_KEY: &str = "resources_state";
const SCHEMA_VERSION: &str = "008_local_resources";

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

#[derive(Debug, Deserialize)]
pub struct ResourceMetadata {
    pub category: Option<String>,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
}

fn ensure_schema(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute(
        "INSERT OR IGNORE INTO local_schema_migrations(version) VALUES(?1)",
        [SCHEMA_VERSION],
    ).map_err(|e| format!("Unable to record local resources schema: {e}"))?;
    conn.execute(
        "INSERT OR IGNORE INTO sync_state(key,value) VALUES(?1,?2)",
        params![STATE_KEY, "[]"],
    ).map_err(|e| format!("Unable to initialize local resources state: {e}"))?;
    Ok(())
}

fn read_resources(conn: &rusqlite::Connection) -> Result<Vec<LocalResource>, String> {
    let raw: String = conn.query_row(
        "SELECT value FROM sync_state WHERE key=?1",
        [STATE_KEY],
        |r| r.get(0),
    ).optional().map_err(|e| format!("Unable to read local resources: {e}"))?
      .unwrap_or_else(|| "[]".to_string());
    serde_json::from_str(&raw).map_err(|e| format!("Invalid local resources state: {e}"))
}

fn write_resources(conn: &rusqlite::Connection, resources: &[LocalResource]) -> Result<(), String> {
    let raw = serde_json::to_string(resources).map_err(|e| format!("Unable to encode local resources: {e}"))?;
    conn.execute(
        "INSERT INTO sync_state(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![STATE_KEY, raw],
    ).map_err(|e| format!("Unable to save local resources: {e}"))?;
    Ok(())
}

fn save_with_change(conn: &mut rusqlite::Connection, resources: &[LocalResource], entity_id: &str, operation: &str, payload: &Value) -> Result<(), String> {
    let permission=match operation{"create"=>"resources.create","delete"=>"resources.delete",_=>"resources.edit"};
    local_auth::require_local_permission(conn,permission)?;
    let tx = conn.transaction().map_err(|e| format!("Unable to begin local resource transaction: {e}"))?;
    write_resources(&tx, resources)?;
    let device_id: String = tx.query_row("SELECT device_id FROM device_identity WHERE id=1", [], |r| r.get(0))
        .map_err(|e| format!("Unable to read device identity: {e}"))?;
    let change_id = new_id(&tx)?;
    tx.execute(
        "INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,'resource',?3,?4,?5)",
        params![change_id, device_id, entity_id, operation, payload.to_string()],
    ).map_err(|e| format!("Unable to queue local resource change: {e}"))?;
    tx.commit().map_err(|e| format!("Unable to commit local resource change: {e}"))
}

fn now(conn: &rusqlite::Connection) -> Result<String, String> {
    conn.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |r| r.get(0))
        .map_err(|e| format!("Unable to create resource timestamp: {e}"))
}

fn new_id(conn: &rusqlite::Connection) -> Result<String, String> {
    conn.query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))
        .map_err(|e| format!("Unable to create local resource id: {e}"))
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

fn validate_parent(resources: &[LocalResource], item_id: &Option<String>, project_id: &Option<String>, note_id: &Option<String>, parent_resource_id: &Option<String>) -> Result<(), String> {
    if [item_id, project_id, note_id].iter().filter(|v| v.is_some()).count() > 1 {
        return Err("A resource can be attached to at most one of item_id, project_id, note_id".into());
    }
    if let Some(parent) = parent_resource_id {
        let exists = resources.iter().any(|r| r.id == *parent && r.kind == "folder");
        if !exists { return Err("Parent resource folder was not found".into()); }
    }
    Ok(())
}

#[tauri::command]
pub fn list_local_resources(app: AppHandle, item_id: Option<String>, project_id: Option<String>, note_id: Option<String>, parent_resource_id: Option<String>) -> Result<Vec<LocalResource>, String> {
    let mut conn = open_local_connection(&app)?;
    ensure_schema(&conn)?;
    let mut resources = read_resources(&conn)?;
    resources.retain(|r| {
        match (&item_id,&project_id,&note_id,&parent_resource_id) {
            (Some(id),_,_,_) => r.item_id.as_deref() == Some(id.as_str()),
            (_,Some(id),_,_) => r.project_id.as_deref() == Some(id.as_str()),
            (_,_,Some(id),_) => r.note_id.as_deref() == Some(id.as_str()),
            (_,_,_,Some(id)) => r.parent_resource_id.as_deref() == Some(id.as_str()),
            _ => r.parent_resource_id.is_none(),
        }
    });
    resources.sort_by(|a,b| b.created_at.cmp(&a.created_at));
    Ok(resources)
}

#[tauri::command]
pub fn get_local_resource(app: AppHandle, id: String) -> Result<LocalResource, String> {
    let conn = open_local_connection(&app)?;
    ensure_schema(&conn)?;
    read_resources(&conn)?.into_iter().find(|r| r.id == id).ok_or_else(|| "Resource not found".into())
}

#[tauri::command]
pub fn cache_local_resources(app: AppHandle, resources_json: String) -> Result<usize, String> {
    let incoming: Vec<LocalResource> = serde_json::from_str(&resources_json).map_err(|e| format!("Invalid resources cache: {e}"))?;
    let conn = open_local_connection(&app)?;
    ensure_schema(&conn)?;
    let mut current = read_resources(&conn)?;
    let pending: HashSet<String> = {
        let mut stmt = conn.prepare("SELECT entity_id FROM sync_outbox WHERE synced_at IS NULL AND entity_type='resource' AND entity_id IS NOT NULL")
            .map_err(|e| format!("Unable to inspect pending resource changes: {e}"))?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| format!("Unable to inspect pending resource changes: {e}"))?;
        rows.filter_map(|r| r.ok()).collect()
    };
    for incoming_resource in incoming {
        if pending.contains(&incoming_resource.id) { continue; }
        if let Some(existing) = current.iter_mut().find(|r| r.id == incoming_resource.id) {
            let local_media_path = existing.local_media_path.clone();
            let local_media_filename = existing.local_media_filename.clone();
            let local_media_mime_type = existing.local_media_mime_type.clone();
            let local_media_size_bytes = existing.local_media_size_bytes;
            let local_media_downloaded_at = existing.local_media_downloaded_at.clone();
            *existing = incoming_resource;
            existing.local_media_path = local_media_path;
            existing.local_media_filename = local_media_filename;
            existing.local_media_mime_type = local_media_mime_type;
            existing.local_media_size_bytes = local_media_size_bytes;
            existing.local_media_downloaded_at = local_media_downloaded_at;
        } else {
            current.push(incoming_resource);
        }
    }
    write_resources(&conn, &current)?;
    Ok(current.len())
}

#[tauri::command]
pub fn create_local_resource_link(app: AppHandle, url: String, name: Option<String>, item_id: Option<String>, project_id: Option<String>, note_id: Option<String>, parent_resource_id: Option<String>, category: Option<String>, description: Option<String>, tags: Option<Vec<String>>) -> Result<LocalResource, String> {
    if url.trim().is_empty() { return Err("url is required".into()); }
    let mut conn = open_local_connection(&app)?;
    ensure_schema(&conn)?;
    let mut resources = read_resources(&conn)?;
    validate_parent(&resources,&item_id,&project_id,&note_id,&parent_resource_id)?;
    let (category,description,tags)=metadata(category,description,tags);
    let id=new_id(&conn)?; let timestamp=now(&conn)?;
    let youtube=if url.contains("youtube.com")||url.contains("youtu.be"){youtube_id(&url)}else{None};
    let file_type=if youtube.is_some(){"youtube"}else{"other"};
    let thumbnail_url=youtube.as_ref().map(|id|format!("https://img.youtube.com/vi/{id}/hqdefault.jpg"));
    let resource=LocalResource{id:id.clone(),name:name.filter(|n|!n.trim().is_empty()).unwrap_or_else(||url.clone()),kind:"link".into(),file_type:file_type.into(),original_filename:None,mime_type:None,size_bytes:None,url:Some(url),thumbnail_url,local_media_path:None,local_media_filename:None,local_media_mime_type:None,local_media_size_bytes:None,local_media_downloaded_at:None,parent_resource_id,relative_path:None,item_id,project_id,note_id,item_name:None,project_name:None,note_title:None,category:Some(category),description:Some(description),tags,updated_at:timestamp.clone(),created_at:timestamp,derived_from_resource_id:None};
    resources.push(resource.clone());
    save_with_change(&mut conn, &resources, &id, "create", &serde_json::json!({"resource": resource}))?;
    Ok(resource)
}

#[tauri::command]
pub fn create_local_resource_folder(app: AppHandle, name: String, item_id: Option<String>, project_id: Option<String>, note_id: Option<String>, parent_resource_id: Option<String>, category: Option<String>, description: Option<String>, tags: Option<Vec<String>>) -> Result<LocalResource, String> {
    if name.trim().is_empty() { return Err("name is required".into()); }
    let mut conn=open_local_connection(&app)?; ensure_schema(&conn)?;
    let mut resources=read_resources(&conn)?; validate_parent(&resources,&item_id,&project_id,&note_id,&parent_resource_id)?;
    let (category,description,tags)=metadata(category,description,tags); let id=new_id(&conn)?; let timestamp=now(&conn)?;
    let resource=LocalResource{id:id.clone(),name:name.trim().to_string(),kind:"folder".into(),file_type:"schematic_folder".into(),original_filename:None,mime_type:None,size_bytes:None,url:None,thumbnail_url:None,local_media_path:None,local_media_filename:None,local_media_mime_type:None,local_media_size_bytes:None,local_media_downloaded_at:None,parent_resource_id,relative_path:None,item_id,project_id,note_id,item_name:None,project_name:None,note_title:None,category:Some(category),description:Some(description),tags,updated_at:timestamp.clone(),created_at:timestamp,derived_from_resource_id:None};
    resources.push(resource.clone()); save_with_change(&mut conn, &resources, &id, "create", &serde_json::json!({"resource": resource}))?; Ok(resource)
}

#[tauri::command]
pub fn update_local_resource_metadata(app: AppHandle, id: String, category: Option<String>, description: Option<String>, tags: Option<Vec<String>>) -> Result<LocalResource, String> {
    let mut conn=open_local_connection(&app)?; ensure_schema(&conn)?; let mut resources=read_resources(&conn)?;
    let (category,description,tags)=metadata(category,description,tags);
    let timestamp=now(&conn)?;
    let resource=resources.iter_mut().find(|r|r.id==id).ok_or_else(||"Resource not found".to_string())?;
    resource.category=Some(category); resource.description=Some(description); resource.tags=tags; resource.updated_at=timestamp;
    let result=resource.clone();
    save_with_change(&mut conn, &resources, &id, "update", &serde_json::json!({"resource": result}))?;
    Ok(result)
}

#[tauri::command]
pub fn delete_local_resource(app: AppHandle, id: String) -> Result<(), String> {
    let mut conn=open_local_connection(&app)?; ensure_schema(&conn)?; let mut resources=read_resources(&conn)?;
    if !resources.iter().any(|r|r.id==id) { return Err("Resource not found".into()); }
    if resources.iter().any(|r|r.parent_resource_id.as_deref()==Some(id.as_str())) { return Err("Cannot delete a folder that still contains resources".into()); }
    let deleted = resources.iter().find(|r| r.id==id).cloned().ok_or_else(||"Resource not found".to_string())?; resources.retain(|r| r.id!=id); save_with_change(&mut conn, &resources, &id, "delete", &serde_json::json!({"resource": deleted}))?; Ok(())
}

#[tauri::command]
pub fn apply_server_resource_pull(app: AppHandle, resources_json: String, deleted_resource_ids: Vec<String>) -> Result<(), String> {
    let incoming: Vec<LocalResource> = serde_json::from_str(&resources_json)
        .map_err(|e| format!("Invalid server resources payload: {e}"))?;
    let mut conn = open_local_connection(&app)?;
    ensure_schema(&conn)?;
    let tx = conn.transaction().map_err(|e| format!("Unable to begin server resource merge: {e}"))?;
    let raw: String = tx.query_row("SELECT value FROM sync_state WHERE key=?1", [STATE_KEY], |r| r.get(0))
        .optional().map_err(|e| format!("Unable to read local resources: {e}"))?
        .unwrap_or_else(|| "[]".to_string());
    let mut current: Vec<LocalResource> = serde_json::from_str(&raw)
        .map_err(|e| format!("Invalid local resources state: {e}"))?;
    let mut pending = HashSet::new();
    {
        let mut stmt = tx.prepare("SELECT entity_id FROM sync_outbox WHERE synced_at IS NULL AND entity_type='resource' AND entity_id IS NOT NULL")
            .map_err(|e| format!("Unable to inspect pending resource changes: {e}"))?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| format!("Unable to inspect pending resource changes: {e}"))?;
        for row in rows { pending.insert(row.map_err(|e| format!("Unable to read pending resource id: {e}"))?); }
    }
    let deleted: HashSet<String> = deleted_resource_ids.into_iter().collect();
    current.retain(|r| !deleted.contains(&r.id) || pending.contains(&r.id));
    for incoming_resource in incoming {
        if pending.contains(&incoming_resource.id) { continue; }
        if let Some(existing) = current.iter_mut().find(|r| r.id == incoming_resource.id) {
            let local_media_path = existing.local_media_path.clone();
            let local_media_filename = existing.local_media_filename.clone();
            let local_media_mime_type = existing.local_media_mime_type.clone();
            let local_media_size_bytes = existing.local_media_size_bytes;
            let local_media_downloaded_at = existing.local_media_downloaded_at.clone();
            *existing = incoming_resource;
            existing.local_media_path = local_media_path;
            existing.local_media_filename = local_media_filename;
            existing.local_media_mime_type = local_media_mime_type;
            existing.local_media_size_bytes = local_media_size_bytes;
            existing.local_media_downloaded_at = local_media_downloaded_at;
        } else {
            current.push(incoming_resource);
        }
    }
    write_resources(&tx, &current)?;
    tx.commit().map_err(|e| format!("Unable to commit server resource merge: {e}"))
}

#[tauri::command]
pub fn get_local_resource_tags(app: AppHandle) -> Result<Vec<String>, String> {
    let conn=open_local_connection(&app)?; ensure_schema(&conn)?; let resources=read_resources(&conn)?;
    let mut tags=resources.into_iter().flat_map(|r|r.tags).collect::<Vec<_>>(); tags.sort(); tags.dedup(); Ok(tags)
}

#[allow(dead_code)]
fn _validate_json_state(value: &Value) -> Result<(), String> {
    if !value.is_object() { return Err("Resource state must be an object".into()); }
    Ok(())
}
