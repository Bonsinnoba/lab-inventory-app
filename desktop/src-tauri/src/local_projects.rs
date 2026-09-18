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
    project["blocks"] = json!([]);
    project["connectors"] = json!([]);
    project["task_experiments"] = json!([]);
    project["attachments"] = json!([]);
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
pub fn create_local_project_task_experiment(app:AppHandle,project_id:String,task_id:String,record:Value)->Result<Value,String>{
    let mut record=record;
    record["task_id"]=json!(task_id);
    nested_create(app,project_id,"task_experiments",record,"project_task_experiment")
}

#[tauri::command]
pub fn get_local_project_task_experiments(app:AppHandle,project_id:String,task_id:String)->Result<Vec<Value>,String>{
    let c=conn(&app)?;
    let p=load(&c)?.into_iter().find(|p|p.get("id").and_then(Value::as_str)==Some(project_id.as_str())).ok_or("Project not found")?;
    Ok(nested_get(&p,"task_experiments").into_iter().filter(|r|r.get("task_id").and_then(Value::as_str)==Some(task_id.as_str())).collect())
}

#[tauri::command]
pub fn delete_local_project_task_experiment(app:AppHandle,project_id:String,link_id:String)->Result<(),String>{
    nested_delete(app,project_id,"task_experiments",link_id,"project_task_experiment")
}

#[tauri::command]
pub fn get_local_project_attachments(app:AppHandle,project_id:String,work_id:String,work_type:String)->Result<Vec<Value>,String>{
    if work_type!="task" && work_type!="experiment" { return Err("work_type must be task or experiment".into()); }
    let c=conn(&app)?;
    let p=load(&c)?.into_iter().find(|p|p.get("id").and_then(Value::as_str)==Some(project_id.as_str())).ok_or("Project not found")?;
    Ok(nested_get(&p,"attachments").into_iter().filter(|a|{
        a.get(if work_type=="task" {"task_id"} else {"experiment_id"}).and_then(Value::as_str)==Some(work_id.as_str())
    }).collect())
}

#[tauri::command]
pub fn create_local_project_attachment(app:AppHandle,project_id:String,work_id:String,work_type:String,resource_id:String)->Result<Value,String>{
    if work_type!="task" && work_type!="experiment" { return Err("work_type must be task or experiment".into()); }
    if resource_id.trim().is_empty() { return Err("resourceId is required".into()); }
    let mut record=json!({"resource_id":resource_id});
    if work_type=="task" { record["task_id"]=json!(work_id); } else { record["experiment_id"]=json!(work_id); }
    nested_create(app,project_id,"attachments",record,"project_work_attachment")
}

#[tauri::command]
pub fn delete_local_project_attachment(app:AppHandle,project_id:String,attachment_id:String)->Result<(),String>{
    nested_delete(app,project_id,"attachments",attachment_id,"project_work_attachment")
}

#[tauri::command]
pub fn list_local_project_workspace(app:AppHandle,project_id:String)->Result<Value,String>{
    let c=conn(&app)?;let p=load(&c)?.into_iter().find(|p|p.get("id").and_then(Value::as_str)==Some(project_id.as_str())).ok_or("Project not found")?;
    Ok(json!({"members":[],"tasks":nested_get(&p,"tasks"),"experiments":nested_get(&p,"experiments"),"items":nested_get(&p,"items"),"notes":[],"resources":[],"activity":[],"blocks":nested_get(&p,"blocks"),"connectors":nested_get(&p,"connectors"),"task_experiments":nested_get(&p,"task_experiments"),"attachments":nested_get(&p,"attachments"),"permissions":{"access":"admin","member_role":"lead","can_edit":true}}))
}

#[tauri::command]
pub fn create_local_project_task(app:AppHandle,project_id:String,record:Value)->Result<Value,String>{nested_create(app,project_id,"tasks",record,"project_task")}
#[tauri::command]
pub fn update_local_project_task(app:AppHandle,project_id:String,record_id:String,patch:Value)->Result<Value,String>{nested_update(app,project_id,"tasks",record_id,patch,"project_task")}
#[tauri::command]
pub fn delete_local_project_task(app:AppHandle,project_id:String,record_id:String)->Result<(),String>{nested_delete(app,project_id,"tasks",record_id,"project_task")}

#[tauri::command]
pub fn create_local_project_experiment(app:AppHandle,project_id:String,mut record:Value)->Result<Value,String>{record["measurements"]=json!([]);record["observations"]=json!([]);nested_create(app,project_id,"experiments",record,"project_experiment")}
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
pub fn get_local_project_canvas(app:AppHandle,project_id:String)->Result<Value,String>{
    let c=conn(&app)?;let p=load(&c)?.into_iter().find(|p|p.get("id").and_then(Value::as_str)==Some(project_id.as_str())).ok_or("Project not found")?;
    Ok(json!({"blocks":nested_get(&p,"blocks"),"connectors":nested_get(&p,"connectors"),"permissions":{"access":"admin","member_role":"lead","can_edit":true}}))
}
#[tauri::command]
pub fn create_local_project_block(app:AppHandle,project_id:String,mut record:Value)->Result<Value,String>{
    let block_type=record.get("block_type").and_then(Value::as_str).unwrap_or("");
    if block_type.is_empty(){return Err("block_type is required".into());}
    if block_type=="text" && record.get("text_content").and_then(Value::as_str).unwrap_or("").is_empty(){return Err("text_content is required for text blocks".into());}
    if block_type!="text" && record.get("resource_id").and_then(Value::as_str).unwrap_or("").is_empty(){return Err("resource_id is required for media blocks".into());}
    let width=record.get("width").and_then(Value::as_f64).unwrap_or(320.0).round();
    let height=record.get("height").and_then(Value::as_f64).unwrap_or(200.0).round();
    if width<120.0 || height<80.0{return Err("Canvas block is below the minimum size".into());}
    record["x"]=json!(record.get("x").and_then(Value::as_f64).unwrap_or(0.0).round());record["y"]=json!(record.get("y").and_then(Value::as_f64).unwrap_or(0.0).round());record["width"]=json!(width);record["height"]=json!(height);
    nested_create(app,project_id,"blocks",record,"project_block")
}
#[tauri::command]
pub fn update_local_project_block(app:AppHandle,project_id:String,record_id:String,patch:Value)->Result<Value,String>{
    if let Some(obj)=patch.as_object(){if let Some(w)=obj.get("width").and_then(Value::as_f64){if w<120.0{return Err("Canvas block width must be at least 120".into());}}if let Some(h)=obj.get("height").and_then(Value::as_f64){if h<80.0{return Err("Canvas block height must be at least 80".into());}}}
    nested_update(app,project_id,"blocks",record_id,patch,"project_block")
}
#[tauri::command]
pub fn delete_local_project_block(app:AppHandle,project_id:String,record_id:String)->Result<(),String>{
    let mut c=conn(&app)?;let mut projects=load(&c)?;let p=projects.iter_mut().find(|p|p.get("id").and_then(Value::as_str)==Some(project_id.as_str())).ok_or("Project not found")?;
    let mut blocks=nested_get(p,"blocks");if !blocks.iter().any(|b|b.get("id").and_then(Value::as_str)==Some(record_id.as_str())){return Err("Block not found".into());}
    blocks.retain(|b|b.get("id").and_then(Value::as_str)!=Some(record_id.as_str()));p["blocks"]=Value::Array(blocks);
    let mut connectors=nested_get(p,"connectors");let removed:Vec<Value>=connectors.iter().filter(|v|v.get("source_block_id").and_then(Value::as_str)==Some(record_id.as_str())||v.get("target_block_id").and_then(Value::as_str)==Some(record_id.as_str())).cloned().collect();
    connectors.retain(|v|v.get("source_block_id").and_then(Value::as_str)!=Some(record_id.as_str())&&v.get("target_block_id").and_then(Value::as_str)!=Some(record_id.as_str()));p["connectors"]=Value::Array(connectors);p["updated_at"]=json!(now(&c)?);
    let mut changes=vec![(id(),"project_block".into(),record_id,"delete".into(),json!({"project_id":project_id}))];
    for connector in removed{if let Some(cid)=connector.get("id").and_then(Value::as_str){changes.push((id(),"project_connector".into(),cid.to_string(),"delete".into(),json!({"project_id":project_id})));}}
    save(&mut c,&projects,changes)
}
#[tauri::command]
pub fn create_local_project_connector(app:AppHandle,project_id:String,record:Value)->Result<Value,String>{
    let source=record.get("source_block_id").and_then(Value::as_str).ok_or("source_block_id is required")?.to_string();
    let target=record.get("target_block_id").and_then(Value::as_str).ok_or("target_block_id is required")?.to_string();
    if source==target{return Err("source_block_id and target_block_id cannot be the same".into());}
    let c=conn(&app)?;let p=load(&c)?.into_iter().find(|p|p.get("id").and_then(Value::as_str)==Some(project_id.as_str())).ok_or("Project not found")?;let blocks=nested_get(&p,"blocks");
    if !blocks.iter().any(|b|b.get("id").and_then(Value::as_str)==Some(source.as_str()))||!blocks.iter().any(|b|b.get("id").and_then(Value::as_str)==Some(target.as_str())){return Err("Connector blocks must belong to this project".into());}
    drop(c);let mut value=record;value["project_id"]=json!(project_id.clone());nested_create(app,project_id,"connectors",value,"project_connector")
}
#[tauri::command]
pub fn delete_local_project_connector(app:AppHandle,project_id:String,record_id:String)->Result<(),String>{nested_delete(app,project_id,"connectors",record_id,"project_connector")}

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
pub fn apply_server_project_pull(app: AppHandle, projects_json: String, deleted_project_ids: Vec<String>, deleted_project_task_ids: Vec<String>, deleted_project_experiment_ids: Vec<String>, deleted_project_bom_ids: Vec<String>, deleted_project_block_ids: Vec<String>, deleted_project_connector_ids: Vec<String>, deleted_project_measurement_ids: Vec<String>, deleted_project_observation_ids: Vec<String>, deleted_project_attachment_ids: Vec<String>, deleted_project_task_experiment_ids: Vec<String>) -> Result<(), String> {
    let incoming: Vec<Value> = serde_json::from_str(&projects_json).map_err(|e| format!("Invalid server project payload: {e}"))?;
    let deleted: std::collections::HashSet<String> = deleted_project_ids.into_iter().collect();
    let mut c = conn(&app)?;
    let mut projects = load(&c)?;
    let pending: std::collections::HashSet<String> = {
        let mut stmt = c.prepare("SELECT DISTINCT entity_type || ':' || entity_id FROM sync_outbox WHERE synced_at IS NULL AND entity_id IS NOT NULL AND entity_type IN ('project','project_task','project_experiment','project_bom','project_block','project_connector','project_work_attachment','project_task_experiment')").map_err(|e| format!("Unable to inspect pending project changes: {e}"))?;
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
            let mut task_experiments=project.get("task_experiments").and_then(Value::as_array).cloned().unwrap_or_default();
            let old_task_experiments=existing.get("task_experiments").and_then(Value::as_array).cloned().unwrap_or_default();
            task_experiments.retain(|v|{let rid=v.get("id").and_then(Value::as_str).unwrap_or_default();!deleted_project_task_experiment_ids.iter().any(|x|x==rid)||pending.contains(&format!("project_task_experiment:{rid}"))});
            for oldrow in old_task_experiments{if let Some(rid)=oldrow.get("id").and_then(Value::as_str){if pending.contains(&format!("project_task_experiment:{rid}"))&&!task_experiments.iter().any(|v|v.get("id").and_then(Value::as_str)==Some(rid)){task_experiments.push(oldrow);}}}
            project["task_experiments"]=Value::Array(task_experiments);
            for key in ["tasks","experiments","bom","blocks","connectors"] {
                let pending_key = match key { "tasks"=>"project_task", "experiments"=>"project_experiment", "bom"=>"project_bom", "blocks"=>"project_block", "connectors"=>"project_connector", _=>"" };
                let deleted_ids: std::collections::HashSet<String> = match key { "tasks"=>deleted_project_task_ids.iter().cloned().collect(), "experiments"=>deleted_project_experiment_ids.iter().cloned().collect(), "bom"=>deleted_project_bom_ids.iter().cloned().collect(), "blocks"=>deleted_project_block_ids.iter().cloned().collect(), "connectors"=>deleted_project_connector_ids.iter().cloned().collect(), _=>std::collections::HashSet::new() };
                let mut merged = project.get(key).and_then(Value::as_array).cloned().unwrap_or_default();
                if key=="tasks" || key=="experiments" {
                    for work in &mut merged {
                        let work_id=work.get("id").and_then(Value::as_str).unwrap_or_default();
                        let oldwork=existing.get(key).and_then(Value::as_array).and_then(|a|a.iter().find(|v|v.get("id").and_then(Value::as_str)==Some(work_id))).cloned().unwrap_or_else(||json!({}));
                        let mut attachments=work.get("attachments").and_then(Value::as_array).cloned().unwrap_or_default();
                        let oldattachments=oldwork.get("attachments").and_then(Value::as_array).cloned().unwrap_or_default();
                        attachments.retain(|v|{let rid=v.get("id").and_then(Value::as_str).unwrap_or_default();!deleted_project_attachment_ids.iter().any(|x|x==rid)||pending.contains(&format!("project_work_attachment:{rid}"))});
                        for oldrow in oldattachments{if let Some(rid)=oldrow.get("id").and_then(Value::as_str){if pending.contains(&format!("project_work_attachment:{rid}"))&&!attachments.iter().any(|v|v.get("id").and_then(Value::as_str)==Some(rid)){attachments.push(oldrow);}}}
                        work["attachments"]=Value::Array(attachments);
                    }
                }
                if key=="experiments" {
                    for exp in &mut merged {
                        let eid=exp.get("id").and_then(Value::as_str).unwrap_or_default();
                        let oldexp=existing.get("experiments").and_then(Value::as_array).and_then(|a|a.iter().find(|v|v.get("id").and_then(Value::as_str)==Some(eid))).cloned().unwrap_or_else(||json!({}));
                        for sub in ["measurements","observations"] {
                            let et=if sub=="measurements"{"project_experiment_measurement"}else{"project_experiment_observation"};
                            let dels:std::collections::HashSet<String>=if sub=="measurements"{deleted_project_measurement_ids.iter().cloned().collect()}else{deleted_project_observation_ids.iter().cloned().collect()};
                            let mut subrows=exp.get(sub).and_then(Value::as_array).cloned().unwrap_or_default();
                            let oldrows=oldexp.get(sub).and_then(Value::as_array).cloned().unwrap_or_default();
                            subrows.retain(|v|{let rid=v.get("id").and_then(Value::as_str).unwrap_or_default();!dels.contains(rid)||pending.contains(&format!("{et}:{rid}"))});
                            for oldrow in oldrows{if let Some(rid)=oldrow.get("id").and_then(Value::as_str){if pending.contains(&format!("{et}:{rid}"))&&!subrows.iter().any(|v|v.get("id").and_then(Value::as_str)==Some(rid)){subrows.push(oldrow);}}}
                            exp[sub]=Value::Array(subrows);
                        }
                    }
                }
                merged.retain(|v| { let rid=v.get("id").and_then(Value::as_str).unwrap_or_default(); !deleted_ids.contains(rid) || pending.contains(&format!("{pending_key}:{rid}")) });
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

fn nested_create_nested(app:AppHandle,project_id:String,parent_key:&str,key:&str,parent_id:String,mut record:Value,entity_type:&str)->Result<Value,String>{let mut c=conn(&app)?;let mut projects=load(&c)?;let p=projects.iter_mut().find(|p|p.get("id").and_then(Value::as_str)==Some(project_id.as_str())).ok_or("Project not found")?;let mut parents=nested_get(p,parent_key);let parent=parents.iter_mut().find(|x|x.get("id").and_then(Value::as_str)==Some(parent_id.as_str())).ok_or("Parent record not found")?;let rid=id();let ts=now(&c)?;record["id"]=json!(&rid);record["project_id"]=json!(&project_id);record["created_at"]=json!(&ts);record["updated_at"]=json!(&ts);let mut rows=nested_get(parent,key);rows.push(record.clone());parent[key]=Value::Array(rows);p[parent_key]=Value::Array(parents);p["updated_at"]=json!(&ts);save(&mut c,&projects,vec![(id(),entity_type.into(),rid,"create".into(),record.clone())])?;Ok(record)}
fn nested_delete_nested(app:AppHandle,project_id:String,parent_key:&str,key:&str,parent_id:String,record_id:String,entity_type:&str)->Result<(),String>{let mut c=conn(&app)?;let mut projects=load(&c)?;let p=projects.iter_mut().find(|p|p.get("id").and_then(Value::as_str)==Some(project_id.as_str())).ok_or("Project not found")?;let mut parents=nested_get(p,parent_key);let parent=parents.iter_mut().find(|x|x.get("id").and_then(Value::as_str)==Some(parent_id.as_str())).ok_or("Parent record not found")?;let mut rows=nested_get(parent,key);let before=rows.iter().find(|x|x.get("id").and_then(Value::as_str)==Some(record_id.as_str())).cloned().ok_or("Record not found")?;rows.retain(|x|x.get("id").and_then(Value::as_str)!=Some(record_id.as_str()));parent[key]=Value::Array(rows);p[parent_key]=Value::Array(parents);p["updated_at"]=json!(now(&c)?);save(&mut c,&projects,vec![(id(),entity_type.into(),record_id,"delete".into(),json!({"record":before}))])}

#[tauri::command]
pub fn create_local_project_experiment_measurement(app:AppHandle,project_id:String,experiment_id:String,record:Value)->Result<Value,String>{let mut r=record;r["experiment_id"]=json!(experiment_id);nested_create_nested(app,project_id,"experiments","measurements",experiment_id,r,"project_experiment_measurement")}
#[tauri::command]
pub fn delete_local_project_experiment_measurement(app:AppHandle,project_id:String,experiment_id:String,record_id:String)->Result<(),String>{nested_delete_nested(app,project_id,"experiments","measurements",experiment_id,record_id,"project_experiment_measurement")}
#[tauri::command]
pub fn create_local_project_experiment_observation(app:AppHandle,project_id:String,experiment_id:String,record:Value)->Result<Value,String>{let mut r=record;r["experiment_id"]=json!(experiment_id);nested_create_nested(app,project_id,"experiments","observations",experiment_id,r,"project_experiment_observation")}
#[tauri::command]
pub fn delete_local_project_experiment_observation(app:AppHandle,project_id:String,experiment_id:String,record_id:String)->Result<(),String>{nested_delete_nested(app,project_id,"experiments","observations",experiment_id,record_id,"project_experiment_observation")}
