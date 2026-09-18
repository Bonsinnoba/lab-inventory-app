use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use tauri::AppHandle;
use crate::local_db;

const STATE_KEY: &str = "projects_state";
const SCHEMA_VERSION: &str = "004_local_projects";

fn conn(app: &AppHandle) -> Result<Connection, String> { local_db::open_local_connection(app) }

fn ensure(conn: &Connection) -> Result<(), String> {
    conn.execute("INSERT OR IGNORE INTO local_schema_migrations(version) VALUES (?1)", [SCHEMA_VERSION])
        .map_err(|e| format!("Unable to record local projects schema: {e}"))?;
    conn.execute(
        "INSERT OR IGNORE INTO sync_state(key,value) VALUES (?1,?2)",
        params![STATE_KEY, "[]"],
    ).map_err(|e| format!("Unable to initialize local projects state: {e}"))?;
    Ok(())
}

fn load(conn: &Connection) -> Result<Vec<Value>, String> {
    ensure(conn)?;
    let raw: Option<String> = conn.query_row(
        "SELECT value FROM sync_state WHERE key=?1", [STATE_KEY], |r| r.get(0)
    ).optional().map_err(|e| format!("Unable to read local projects: {e}"))?;
    match raw {
        Some(v) => serde_json::from_str(&v).map_err(|e| format!("Invalid local projects state: {e}")),
        None => Ok(Vec::new()),
    }
}

fn save(conn: &mut Connection, projects: &[Value], changes: Vec<(String, String, String, String, Value)>) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| format!("Unable to begin local project transaction: {e}"))?;
    let raw = serde_json::to_string(projects).map_err(|e| format!("Unable to encode local projects: {e}"))?;
    tx.execute(
        "INSERT INTO sync_state(key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![STATE_KEY, raw],
    ).map_err(|e| format!("Unable to save local projects: {e}"))?;
    let device: String = tx.query_row("SELECT device_id FROM device_identity WHERE id=1", [], |r| r.get(0))
        .map_err(|e| format!("Unable to read device identity: {e}"))?;
    for (change_id, entity_type, entity_id, operation, payload) in changes {
        tx.execute(
            "INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES (?1,?2,?3,?4,?5,?6)",
            params![change_id, device, entity_type, entity_id, operation, payload.to_string()],
        ).map_err(|e| format!("Unable to queue local project change: {e}"))?;
    }
    tx.commit().map_err(|e| format!("Unable to commit local project change: {e}"))
}

fn id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let n = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    format!("{:032x}", n)
}

fn now(conn: &Connection) -> Result<String, String> {
    conn.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |r| r.get(0))
        .map_err(|e| format!("Unable to create timestamp: {e}"))
}

#[tauri::command]
pub fn list_local_projects(app: AppHandle) -> Result<Vec<Value>, String> {
    let c = conn(&app)?; load(&c)
}

#[tauri::command]
pub fn get_local_project(app: AppHandle, project_id: String) -> Result<Option<Value>, String> {
    let c = conn(&app)?; Ok(load(&c)?.into_iter().find(|p| p.get("id").and_then(Value::as_str) == Some(project_id.as_str())))
}

#[tauri::command]
pub fn create_local_project(app: AppHandle, mut project: Value) -> Result<Value, String> {
    let mut c = conn(&app)?; let mut projects = load(&c)?;
    let project_id = id(); let timestamp = now(&c)?;
    if project.get("name").and_then(Value::as_str).map(|s| s.trim().is_empty()).unwrap_or(true) {
        return Err("name is required".into());
    }
    project["id"] = json!(project_id);
    project["status"] = project.get("status").cloned().unwrap_or(json!("active"));
    project["priority"] = project.get("priority").cloned().unwrap_or(json!("normal"));
    project["description"] = project.get("description").cloned().unwrap_or(json!(""));
    project["owner_id"] = Value::Null;
    project["created_at"] = json!(&timestamp);
    project["updated_at"] = json!(&timestamp);
    project["tasks"] = json!([]);
    project["experiments"] = json!([]);
    project["items"] = json!([]);
    project["bom"] = json!([]);
    projects.push(project.clone());
    save(&mut c, &projects, vec![(id(), "project".into(), project_id, "create".into(), project.clone())])?;
    Ok(project)
}

#[tauri::command]
pub fn update_local_project(app: AppHandle, project_id: String, patch: Value) -> Result<Value, String> {
    let mut c = conn(&app)?; let mut projects = load(&c)?;
    let p = projects.iter_mut().find(|p| p.get("id").and_then(Value::as_str) == Some(project_id.as_str())).ok_or("Project not found")?;
    let old = p.clone();
    if let Some(obj) = patch.as_object() {
        for (k,v) in obj { if !matches!(k.as_str(), "id"|"created_at"|"tasks"|"experiments"|"items"|"bom") { p[k] = v.clone(); } }
    }
    if p.get("name").and_then(Value::as_str).map(|s| s.trim().is_empty()).unwrap_or(true) { return Err("name cannot be empty".into()); }
    p["updated_at"] = json!(now(&c)?);
    let updated = p.clone();
    save(&mut c, &projects, vec![(id(), "project".into(), project_id.clone(), "update".into(), json!({"id":project_id,"before":old,"project":updated}))])?;
    Ok(updated)
}

#[tauri::command]
pub fn delete_local_project(app: AppHandle, project_id: String) -> Result<(), String> {
    let mut c = conn(&app)?; let mut projects = load(&c)?;
    let before = projects.iter().find(|p| p.get("id").and_then(Value::as_str)==Some(project_id.as_str())).cloned().ok_or("Project not found")?;
    projects.retain(|p| p.get("id").and_then(Value::as_str)!=Some(project_id.as_str()));
    save(&mut c, &projects, vec![(id(), "project".into(), project_id, "delete".into(), json!({"project":before}))])
}

fn nested_get(project: &Value, key: &str) -> Vec<Value> {
    project.get(key).and_then(Value::as_array).cloned().unwrap_or_default()
}

fn nested_create(app: AppHandle, project_id: String, key: &str, mut record: Value, entity_type: &str) -> Result<Value, String> {
    let mut c=conn(&app)?; let mut projects=load(&c)?;
    let p=projects.iter_mut().find(|p| p.get("id").and_then(Value::as_str)==Some(project_id.as_str())).ok_or("Project not found")?;
    let record_id=id(); let timestamp=now(&c)?;
    record["id"]=json!(&record_id); record["project_id"]=json!(&project_id);
    record["created_at"]=json!(&timestamp); record["updated_at"]=json!(&timestamp);
    let mut list=nested_get(p,key); list.push(record.clone()); p[key]=Value::Array(list); p["updated_at"]=json!(&timestamp);
    save(&mut c,&projects,vec![(id(),entity_type.into(),record_id,"create".into(),record.clone())])?;
    Ok(record)
}

fn nested_update(app: AppHandle, project_id:String, key:&str, record_id:String, patch:Value, entity_type:&str)->Result<Value,String>{
    let mut c=conn(&app)?; let mut projects=load(&c)?;
    let p=projects.iter_mut().find(|p|p.get("id").and_then(Value::as_str)==Some(project_id.as_str())).ok_or("Project not found")?;
    let mut list=nested_get(p,key);
    let r=list.iter_mut().find(|r|r.get("id").and_then(Value::as_str)==Some(record_id.as_str())).ok_or("Record not found")?;
    if let Some(obj)=patch.as_object(){for(k,v)in obj{if k!="id"&&k!="project_id"&&k!="created_at"{r[k]=v.clone();}}}
    r["updated_at"]=json!(now(&c)?); let updated=r.clone(); p[key]=Value::Array(list); p["updated_at"]=json!(now(&c)?);
    save(&mut c,&projects,vec![(id(),entity_type.into(),record_id,"update".into(),updated.clone())])?;Ok(updated)
}

fn nested_delete(app:AppHandle,project_id:String,key:&str,record_id:String,entity_type:&str)->Result<(),String>{
    let mut c=conn(&app)?;let mut projects=load(&c)?;
    let p=projects.iter_mut().find(|p|p.get("id").and_then(Value::as_str)==Some(project_id.as_str())).ok_or("Project not found")?;
    let mut list=nested_get(p,key);let before=list.iter().find(|r|r.get("id").and_then(Value::as_str)==Some(record_id.as_str())).cloned().ok_or("Record not found")?;
    list.retain(|r|r.get("id").and_then(Value::as_str)!=Some(record_id.as_str()));p[key]=Value::Array(list);p["updated_at"]=json!(now(&c)?);
    save(&mut c,&projects,vec![(id(),entity_type.into(),record_id,"delete".into(),json!({"record":before}))])
}

#[tauri::command]
pub fn list_local_project_workspace(app:AppHandle,project_id:String)->Result<Value,String>{
    let c=conn(&app)?;let p=load(&c)?.into_iter().find(|p|p.get("id").and_then(Value::as_str)==Some(project_id.as_str())).ok_or("Project not found")?;
    Ok(json!({"members":[],"tasks":nested_get(&p,"tasks"),"experiments":nested_get(&p,"experiments"),"items":nested_get(&p,"items"),"notes":[],"resources":[],"activity":[],"permissions":{"access":"admin","member_role":"lead","can_edit":true}}))
}

#[tauri::command]
pub fn create_local_project_task(app:AppHandle,project_id:String,record:Value)->Result<Value,String>{nested_create(app,project_id,"tasks",record,"project_task")}
#[tauri::command]
pub fn update_local_project_task(app:AppHandle,project_id:String,record_id:String,patch:Value)->Result<Value,String>{nested_update(app,project_id,"tasks",record_id,patch,"project_task")}
#[tauri::command]
pub fn delete_local_project_task(app:AppHandle,project_id:String,record_id:String)->Result<(),String>{nested_delete(app,project_id,"tasks",record_id,"project_task")}

#[tauri::command]
pub fn create_local_project_experiment(app:AppHandle,project_id:String,record:Value)->Result<Value,String>{nested_create(app,project_id,"experiments",record,"project_experiment")}
#[tauri::command]
pub fn update_local_project_experiment(app:AppHandle,project_id:String,record_id:String,patch:Value)->Result<Value,String>{nested_update(app,project_id,"experiments",record_id,patch,"project_experiment")}
#[tauri::command]
pub fn delete_local_project_experiment(app:AppHandle,project_id:String,record_id:String)->Result<(),String>{nested_delete(app,project_id,"experiments",record_id,"project_experiment")}

#[tauri::command]
pub fn create_local_project_bom(app:AppHandle,project_id:String,record:Value)->Result<Value,String>{nested_create(app,project_id,"bom",record,"project_bom")}
#[tauri::command]
pub fn update_local_project_bom(app:AppHandle,project_id:String,record_id:String,patch:Value)->Result<Value,String>{nested_update(app,project_id,"bom",record_id,patch,"project_bom")}
#[tauri::command]
pub fn delete_local_project_bom(app:AppHandle,project_id:String,record_id:String)->Result<(),String>{nested_delete(app,project_id,"bom",record_id,"project_bom")}

#[tauri::command]
pub fn get_local_project_tasks(app:AppHandle,project_id:String)->Result<Vec<Value>,String>{let c=conn(&app)?;let p=load(&c)?.into_iter().find(|p|p.get("id").and_then(Value::as_str)==Some(project_id.as_str())).ok_or("Project not found")?;Ok(nested_get(&p,"tasks"))}
#[tauri::command]
pub fn get_local_project_experiments(app:AppHandle,project_id:String)->Result<Vec<Value>,String>{let c=conn(&app)?;let p=load(&c)?.into_iter().find(|p|p.get("id").and_then(Value::as_str)==Some(project_id.as_str())).ok_or("Project not found")?;Ok(nested_get(&p,"experiments"))}
#[tauri::command]
pub fn get_local_project_bom(app:AppHandle,project_id:String)->Result<Vec<Value>,String>{let c=conn(&app)?;let p=load(&c)?.into_iter().find(|p|p.get("id").and_then(Value::as_str)==Some(project_id.as_str())).ok_or("Project not found")?;Ok(nested_get(&p,"bom"))}

#[tauri::command]
pub fn link_local_project_item(app:AppHandle,project_id:String,item_id:String,allocated_quantity:f64,notes:String)->Result<Value,String>{
    let mut c=conn(&app)?;let mut projects=load(&c)?;let p=projects.iter_mut().find(|p|p.get("id").and_then(Value::as_str)==Some(project_id.as_str())).ok_or("Project not found")?;
    let mut items=nested_get(p,"items");let existing=items.iter_mut().find(|x|x.get("item_id").and_then(Value::as_str)==Some(item_id.as_str()));
    let record=json!({"project_id":project_id,"item_id":item_id,"allocated_quantity":allocated_quantity,"notes":notes});
    if let Some(e)=existing{*e=record.clone();}else{items.push(record.clone());}p["items"]=Value::Array(items);p["updated_at"]=json!(now(&c)?);
    save(&mut c,&projects,vec![(id(),"project_item".into(),item_id,"upsert".into(),record.clone())])?;Ok(record)
}

#[tauri::command]
pub fn unlink_local_project_item(app:AppHandle,project_id:String,item_id:String)->Result<(),String>{
    let mut c=conn(&app)?;let mut projects=load(&c)?;let p=projects.iter_mut().find(|p|p.get("id").and_then(Value::as_str)==Some(project_id.as_str())).ok_or("Project not found")?;
    let mut items=nested_get(p,"items");items.retain(|x|x.get("item_id").and_then(Value::as_str)!=Some(item_id.as_str()));p["items"]=Value::Array(items);p["updated_at"]=json!(now(&c)?);
    save(&mut c,&projects,vec![(id(),"project_item".into(),item_id,"delete".into(),json!({"project_id":project_id}))])
}


#[tauri::command]
pub fn apply_server_project_pull(app: AppHandle, projects_json: String, deleted_project_ids: Vec<String>) -> Result<(), String> {
    let incoming: Vec<Value> = serde_json::from_str(&projects_json).map_err(|e| format!("Invalid server project payload: {e}"))?;
    let deleted: std::collections::HashSet<String> = deleted_project_ids.into_iter().collect();
    let mut c = conn(&app)?;
    let mut projects = load(&c)?;
    let pending: std::collections::HashSet<String> = {
        let mut stmt = c.prepare("SELECT DISTINCT entity_type || ':' || entity_id FROM sync_outbox WHERE synced_at IS NULL AND entity_id IS NOT NULL AND entity_type IN ('project','project_task','project_experiment','project_bom')").map_err(|e| format!("Unable to inspect pending project changes: {e}"))?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(|e| format!("Unable to inspect pending project changes: {e}"))?;
        rows.filter_map(|r| r.ok()).collect()
    };
    projects.retain(|p| {
        let id = p.get("id").and_then(Value::as_str).unwrap_or_default();
        !deleted.contains(id) || pending.contains(&format!("project:{id}"))
    });
    for mut project in incoming {
        let Some(project_id) = project.get("id").and_then(Value::as_str).map(ToOwned::to_owned) else { continue; };
        if pending.contains(&format!("project:{project_id}")) { continue; }
        if let Some(existing) = projects.iter().find(|p| p.get("id").and_then(Value::as_str) == Some(project_id.as_str())).cloned() {
            for key in ["tasks","experiments","bom"] {
                let pending_key = match key { "tasks"=>"project_task", "experiments"=>"project_experiment", "bom"=>"project_bom", _=>"" };
                let mut merged = project.get(key).and_then(Value::as_array).cloned().unwrap_or_default();
                for old in existing.get(key).and_then(Value::as_array).cloned().unwrap_or_default() {
                    if let Some(id) = old.get("id").and_then(Value::as_str) {
                        if pending.contains(&format!("{pending_key}:{id}")) && !merged.iter().any(|v| v.get("id").and_then(Value::as_str) == Some(id)) { merged.push(old); }
                    }
                }
                project[key] = Value::Array(merged);
            }
            if let Some(pos)=projects.iter().position(|p| p.get("id").and_then(Value::as_str)==Some(project_id.as_str())) { projects[pos]=project; }
        } else {
            projects.push(project);
        }
    }
    save(&mut c, &projects, Vec::new())
}
