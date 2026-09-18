use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use tauri::AppHandle;
use crate::local_db;

const STATE_KEY: &str = "notes_state";
const SCHEMA_VERSION: &str = "005_local_notes";

fn conn(app: &AppHandle) -> Result<Connection, String> { local_db::open_local_connection(app) }

fn ensure(conn: &Connection) -> Result<(), String> {
    conn.execute("INSERT OR IGNORE INTO local_schema_migrations(version) VALUES (?1)", [SCHEMA_VERSION])
        .map_err(|e| format!("Unable to record local notes schema: {e}"))?;
    conn.execute("INSERT OR IGNORE INTO sync_state(key,value) VALUES (?1,?2)", params![STATE_KEY, "[]"])
        .map_err(|e| format!("Unable to initialize local notes state: {e}"))?;
    Ok(())
}

fn load(conn: &Connection) -> Result<Vec<Value>, String> {
    ensure(conn)?;
    let raw: Option<String> = conn.query_row("SELECT value FROM sync_state WHERE key=?1", [STATE_KEY], |r| r.get(0))
        .optional().map_err(|e| format!("Unable to read local notes: {e}"))?;
    match raw { Some(v) => serde_json::from_str(&v).map_err(|e| format!("Invalid local notes state: {e}")), None => Ok(Vec::new()) }
}

fn save(conn: &mut Connection, notes: &[Value], changes: Vec<(String,String,String,String,Value)>) -> Result<(),String> {
    let tx=conn.transaction().map_err(|e|format!("Unable to begin local note transaction: {e}"))?;
    let raw=serde_json::to_string(notes).map_err(|e|format!("Unable to encode local notes: {e}"))?;
    tx.execute("INSERT INTO sync_state(key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![STATE_KEY,raw])
        .map_err(|e|format!("Unable to save local notes: {e}"))?;
    let device:String=tx.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0))
        .map_err(|e|format!("Unable to read device identity: {e}"))?;
    for (change_id,entity_type,entity_id,operation,payload) in changes {
        tx.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES (?1,?2,?3,?4,?5,?6)",
            params![change_id,device,entity_type,entity_id,operation,payload.to_string()])
            .map_err(|e|format!("Unable to queue local note change: {e}"))?;
    }
    tx.commit().map_err(|e|format!("Unable to commit local note change: {e}"))
}

fn id()->String { use std::time::{SystemTime,UNIX_EPOCH}; format!("{:032x}",SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos()) }
fn now(conn:&Connection)->Result<String,String>{conn.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')",[],|r|r.get(0)).map_err(|e|format!("Unable to create timestamp: {e}"))}

#[tauri::command]
pub fn list_local_notes(app:AppHandle,filters:Option<Value>)->Result<Vec<Value>,String>{
    let c=conn(&app)?; let notes=load(&c)?;
    let f=filters.unwrap_or_else(||json!({}));
    let search=f.get("search").and_then(Value::as_str).map(|s|s.to_lowercase());
    let item_id=f.get("item_id").and_then(Value::as_str);
    let project_id=f.get("project_id").and_then(Value::as_str);
    let tag=f.get("tag").and_then(Value::as_str);
    Ok(notes.into_iter().filter(|n|{
        if let Some(v)=item_id { if n.get("item_id").and_then(Value::as_str)!=Some(v){return false;} }
        if let Some(v)=project_id { if n.get("project_id").and_then(Value::as_str)!=Some(v){return false;} }
        if let Some(v)=tag { if !n.get("tags").and_then(Value::as_array).map(|a|a.iter().any(|x|x.as_str()==Some(v))).unwrap_or(false){return false;} }
        if let Some(s)=&search {
            let title=n.get("title").and_then(Value::as_str).unwrap_or("").to_lowercase();
            let body=n.get("body").and_then(Value::as_str).unwrap_or("").to_lowercase();
            if !title.contains(s) && !body.contains(s){return false;}
        }
        true
    }).collect())
}

#[tauri::command]
pub fn get_local_note_tags(app:AppHandle)->Result<Vec<String>,String>{
    let c=conn(&app)?; let notes=load(&c)?; let mut tags:Vec<String>=Vec::new();
    for n in notes { if let Some(a)=n.get("tags").and_then(Value::as_array){for t in a{if let Some(s)=t.as_str(){if !tags.iter().any(|x|x==s){tags.push(s.to_string());}}}}}
    tags.sort(); Ok(tags)
}

#[tauri::command]
pub fn get_local_note(app:AppHandle,note_id:String)->Result<Option<Value>,String>{let c=conn(&app)?;Ok(load(&c)?.into_iter().find(|n|n.get("id").and_then(Value::as_str)==Some(note_id.as_str())))}

#[tauri::command]
pub fn create_local_note(app:AppHandle,mut note:Value)->Result<Value,String>{
    let mut c=conn(&app)?;let mut notes=load(&c)?;
    if note.get("title").and_then(Value::as_str).map(|s|s.trim().is_empty()).unwrap_or(true){return Err("title is required".into());}
    let nid=id();let ts=now(&c)?;note["id"]=json!(&nid);note["title"]=json!(note.get("title").and_then(Value::as_str).unwrap_or("").trim());
    note["body"]=note.get("body").cloned().unwrap_or(json!(""));note["tags"]=note.get("tags").cloned().unwrap_or(json!([]));
    note["created_at"]=json!(&ts);note["updated_at"]=json!(&ts);note["revisions"]=json!([]);
    notes.push(note.clone());
    save(&mut c,&notes,vec![(id(),"note".into(),nid,"create".into(),note.clone())])?;Ok(note)
}

#[tauri::command]
pub fn update_local_note(app:AppHandle,note_id:String,patch:Value)->Result<Value,String>{
    let mut c=conn(&app)?;let mut notes=load(&c)?;let n=notes.iter_mut().find(|n|n.get("id").and_then(Value::as_str)==Some(note_id.as_str())).ok_or("Note not found")?;
    let before=n.clone();if let Some(obj)=patch.as_object(){for(k,v)in obj{if !matches!(k.as_str(),"id"|"created_at"|"revisions"){n[k]=v.clone();}}}
    if n.get("title").and_then(Value::as_str).map(|s|s.trim().is_empty()).unwrap_or(true){return Err("title cannot be empty".into());}
    let ts=now(&c)?;n["updated_at"]=json!(&ts);
    let rev=json!({"id":id(),"note_id":note_id,"title":before.get("title").cloned().unwrap_or(json!("")),"body":before.get("body").cloned().unwrap_or(json!("")),"tags":before.get("tags").cloned().unwrap_or(json!([])),"edited_by":null,"editor":null,"created_at":ts});
    let mut revisions=n.get("revisions").and_then(Value::as_array).cloned().unwrap_or_default();revisions.push(rev);n["revisions"]=Value::Array(revisions);
    let updated=n.clone();save(&mut c,&notes,vec![(id(),"note".into(),note_id.clone(),"update".into(),json!({"id":note_id,"before":before,"note":updated}))])?;Ok(updated)
}

#[tauri::command]
pub fn delete_local_note(app:AppHandle,note_id:String)->Result<(),String>{
    let mut c=conn(&app)?;let mut notes=load(&c)?;let before=notes.iter().find(|n|n.get("id").and_then(Value::as_str)==Some(note_id.as_str())).cloned().ok_or("Note not found")?;
    notes.retain(|n|n.get("id").and_then(Value::as_str)!=Some(note_id.as_str()));save(&mut c,&notes,vec![(id(),"note".into(),note_id,"delete".into(),json!({"note":before}))])
}

#[tauri::command]
pub fn get_local_note_revisions(app:AppHandle,note_id:String)->Result<Vec<Value>,String>{let c=conn(&app)?;let n=load(&c)?.into_iter().find(|n|n.get("id").and_then(Value::as_str)==Some(note_id.as_str())).ok_or("Note not found")?;Ok(n.get("revisions").and_then(Value::as_array).cloned().unwrap_or_default())}

#[tauri::command]
pub fn restore_local_note_revision(app:AppHandle,note_id:String,revision_id:String)->Result<Value,String>{
    let mut c=conn(&app)?;let mut notes=load(&c)?;let n=notes.iter_mut().find(|n|n.get("id").and_then(Value::as_str)==Some(note_id.as_str())).ok_or("Note not found")?;
    let rev=n.get("revisions").and_then(Value::as_array).and_then(|a|a.iter().find(|r|r.get("id").and_then(Value::as_str)==Some(revision_id.as_str()))).cloned().ok_or("Note revision not found")?;
    let before=n.clone();n["title"]=rev.get("title").cloned().unwrap_or(json!(""));n["body"]=rev.get("body").cloned().unwrap_or(json!(""));n["tags"]=rev.get("tags").cloned().unwrap_or(json!([]));n["updated_at"]=json!(now(&c)?);
    let updated=n.clone();save(&mut c,&notes,vec![(id(),"note".into(),note_id.clone(),"update".into(),json!({"id":note_id,"before":before,"note":updated}))])?;Ok(updated)
}


#[tauri::command]
pub fn apply_server_notes_pull(app:AppHandle,notes:Vec<Value>,deleted_note_ids:Vec<String>)->Result<(),String>{
 let mut c=conn(&app)?;let mut current=load(&c)?;
 fn pending(c:&Connection,id:&str)->Result<bool,String>{Ok(c.query_row("SELECT 1 FROM sync_outbox WHERE entity_type='note' AND entity_id=?1 LIMIT 1",[id],|r|r.get::<_,i64>(0)).optional().map_err(|e|format!("Unable to inspect pending note change: {e}"))?.is_some())}
 for note in notes{if let Some(id)=note.get("id").and_then(Value::as_str){if pending(&c,id)?{continue;}if let Some(existing)=current.iter_mut().find(|n|n.get("id").and_then(Value::as_str)==Some(id)){*existing=note;}else{current.push(note);}}}
 current.retain(|n|{let id=n.get("id").and_then(Value::as_str).unwrap_or("");!deleted_note_ids.iter().any(|x|x==id)&&!pending(&c,id).unwrap_or(false)});
 save(&mut c,&current,Vec::new())
}
