use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::collections::HashSet;
use tauri::AppHandle;
use crate::local_db;
use crate::local_auth;

const STATE_KEY: &str = "projects_state";
const SCHEMA_VERSION: &str = "004_local_projects";

fn conn(app: &AppHandle) -> Result<Connection, String> { local_db::open_local_connection(app) }

fn ensure(conn: &Connection) -> Result<(), String> {
    conn.execute("INSERT OR IGNORE INTO local_schema_migrations(version) VALUES (?1)", [SCHEMA_VERSION])
        .map_err(|e| format!("Unable to record local projects schema: {e}"))?;
    conn.execute(
        "INSERT OR IGNORE INTO sync_state(key,value) VALUES (?1,?2)",
        params![local_db::scoped_state_key(conn, STATE_KEY)?, "[]"],
    ).map_err(|e| format!("Unable to initialize local projects state: {e}"))?;
    Ok(())
}

fn current_principal(conn: &Connection) -> Result<(String, String), String> {
    conn.query_row(
        "SELECT u.central_user_id,u.role FROM local_users u JOIN local_session s ON s.user_id=u.id WHERE s.id=1 AND u.central_user_id IS NOT NULL AND u.is_active=1 AND u.offline_expires_at IS NOT NULL AND datetime('now') < datetime(u.offline_expires_at)",
        [], |r| Ok((r.get(0)?, r.get(1)?)),
    ).optional().map_err(|e| format!("Unable to read local project account: {e}"))?
        .ok_or_else(|| "Sign in to view local projects".into())
}

fn readable_for_user(project: &Value, user_id: &str) -> bool {
    project.pointer("/permissions/user_id").and_then(Value::as_str) == Some(user_id)
        || matches!(project.get("visibility").and_then(Value::as_str), None | Some("lab"))
}

fn access_for_user(project: &Value, user_id: &str) -> Value {
    if project.pointer("/permissions/user_id").and_then(Value::as_str) == Some(user_id) {
        if let Some(access) = project.get("permissions") { return access.clone(); }
    }
    json!({"access":"view","member_role":null,"can_edit":false,"user_id":user_id})
}

fn current_project_access(conn: &Connection, project: &Value) -> Result<Value, String> {
    let (user_id, _) = current_principal(conn)?;
    let mut access = access_for_user(project, &user_id);
    if local_auth::require_local_permission(conn, "projects.edit").is_err() {
        access["access"] = json!("view");
        access["can_edit"] = json!(false);
    }
    Ok(access)
}

fn require_local_project_editor(project: &Value, user_id: &str) -> Result<(), String> {
    let access = access_for_user(project, user_id);
    if access.get("can_edit").and_then(Value::as_bool) == Some(true)
        && matches!(access.get("access").and_then(Value::as_str), Some("edit" | "admin")) {
        Ok(())
    } else {
        Err("This project is read-only for your current account. Sync to refresh project access.".into())
    }
}

pub(crate) fn load_all(conn: &Connection) -> Result<Vec<Value>, String> {
    ensure(conn)?;
    let raw: Option<String> = conn.query_row(
        "SELECT value FROM sync_state WHERE key=?1", [local_db::scoped_state_key(conn, STATE_KEY)?], |r| r.get(0)
    ).optional().map_err(|e| format!("Unable to read local projects: {e}"))?;
    match raw {
        Some(v) => {let mut projects:Vec<Value>=serde_json::from_str(&v).map_err(|e| format!("Invalid local projects state: {e}"))?;for project in &mut projects{normalize_experiment_observations(project);normalize_work_attachments(project);project_task_experiment_views(project);}Ok(projects)},
        None => Ok(Vec::new()),
    }
}

fn normalize_experiment_observations(project:&mut Value){
    if let Some(experiments)=project.get_mut("experiments").and_then(Value::as_array_mut){
        for experiment in experiments{
            if experiment.get("observation_records").is_none()&&experiment["observations"].is_array(){
                experiment["observation_records"]=experiment["observations"].clone();
            }
            // A cached prose edit wins over the pull's compatibility alias.
            if experiment["observations"].is_string(){continue;}
            if let Some(text)=experiment.get("observations_text").and_then(Value::as_str).map(str::to_owned){
                experiment["observations"]=json!(text);experiment["observations_text_available"]=json!(true);
            }else{
                experiment["observations"]=json!("");experiment["observations_text_available"]=json!(false);
            }
        }
    }
}

fn require_experiment_observation_text(record:&Value)->Result<(),String>{
    if record["observations_text_available"]==false||record.get("observations").is_some_and(|v|!v.is_string()){
        return Err("Synchronize this experiment's observation text before editing it; existing records and pending work are preserved.".into());
    }Ok(())
}

fn load(conn: &Connection) -> Result<Vec<Value>, String> {
    local_auth::require_local_permission(conn,"projects.view")?;
    let (user_id, _) = current_principal(conn)?;
    Ok(load_all(conn)?.into_iter().filter(|p| readable_for_user(p, &user_id)).collect())
}

pub(crate) fn require_cached_project_access(conn:&Connection,project_id:&str,edit:bool)->Result<(),String>{
    local_auth::require_local_permission(conn,"projects.view")?;
    let project=load(conn)?.into_iter().find(|p|p["id"]==project_id).ok_or("Project is not available to this account")?;
    if edit{
        local_auth::require_local_permission(conn,"projects.edit")?;
        require_local_project_editor(&project,&local_db::active_account(conn)?)?;
    }Ok(())
}

fn save(conn: &mut Connection, projects: &[Value], changes: Vec<(String, String, String, String, Value)>) -> Result<(), String> {
    save_checked(conn, projects, changes, None, &[])
}

fn save_checked(conn: &mut Connection, projects: &[Value], changes: Vec<(String, String, String, String, Value)>, expected_account_id: Option<&str>, refreshed_reservations:&[String]) -> Result<(), String> {
    let (user_id, _) = current_principal(conn)?;
    for (_, entity_type, _, operation, _) in &changes {
        let permission = if entity_type == "project" {
            match operation.as_str() {
                "create" => "projects.create",
                "delete" => "projects.delete",
                _ => "projects.edit",
            }
        } else {
            "projects.edit"
        };
        local_auth::require_local_permission(conn, permission)?;
    }
    for (_, entity_type, entity_id, operation, payload) in &changes {
        if entity_type == "project" && operation == "create" { continue; }
        let project_id = if entity_type == "project" { Some(entity_id.as_str()) } else {
            payload.get("project_id").or_else(|| payload.pointer("/record/project_id"))
                .or_else(|| payload.pointer("/before/project_id"))
                .and_then(Value::as_str)
        }.ok_or("Project reference is required for local changes")?;
        let project = projects.iter().find(|p| p.get("id").and_then(Value::as_str) == Some(project_id))
            .or_else(|| payload.get("project").filter(|p| p.get("id").and_then(Value::as_str) == Some(project_id)))
            .ok_or("Project not found")?;
        require_local_project_editor(project, &user_id)?;
    }
    let incoming_ids: HashSet<&str> = projects.iter().filter_map(|p| p.get("id").and_then(Value::as_str)).collect();
    let mut combined: Vec<Value> = load_all(conn)?.into_iter().filter(|p| {
        !readable_for_user(p, &user_id) &&
            !p.get("id").and_then(Value::as_str).map(|id| incoming_ids.contains(id)).unwrap_or(false)
    }).collect();
    combined.extend_from_slice(projects);
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e| format!("Unable to begin local project transaction: {e}"))?;
    local_db::require_sync_account(&tx, expected_account_id.unwrap_or(&user_id))?;
    // A second native writer must not replace a newly queued lifecycle with an
    // older full-project payload after waiting for this SQLite transaction.
    for (_,entity,entity_id,operation,payload) in &changes {
        if entity=="project"&&operation=="update" {
            let current=load_all(&tx)?.into_iter().find(|p|p["id"]==*entity_id).ok_or("Project is no longer cached")?;
            if current["lifecycle_revision"]!=payload["before"]["lifecycle_revision"]||current["status"]!=payload["before"]["status"] {
                return Err("Project lifecycle changed during save. Reload the project before retrying.".into());
            }
        }
    }
    let raw = serde_json::to_string(&combined).map_err(|e| format!("Unable to encode local projects: {e}"))?;
    tx.execute(
        "INSERT INTO sync_state(key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![local_db::scoped_state_key(&tx, STATE_KEY)?, raw],
    ).map_err(|e| format!("Unable to save local projects: {e}"))?;
    let device: String = tx.query_row("SELECT device_id FROM device_identity WHERE id=1", [], |r| r.get(0))
        .map_err(|e| format!("Unable to read device identity: {e}"))?;
    for (change_id, entity_type, entity_id, operation, payload) in changes {
        tx.execute(
            "INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES (?1,?2,?3,?4,?5,?6)",
            params![change_id, device, entity_type, entity_id, operation, payload.to_string()],
        ).map_err(|e| format!("Unable to queue local project change: {e}"))?;
    }
    for id in refreshed_reservations {
        tx.execute("DELETE FROM sync_state WHERE key=?1",[local_db::scoped_state_key(&tx,&format!("reservation_reconcile_{id}"))?]).map_err(|e|e.to_string())?;
    }
    tx.commit().map_err(|e| format!("Unable to commit local project change: {e}"))
}

fn id() -> String { local_db::new_uuid() }

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
    let c = conn(&app)?;
    let mut project = load(&c)?.into_iter().find(|p| p.get("id").and_then(Value::as_str) == Some(project_id.as_str()));
    if let Some(ref mut project) = project {
        crate::local_inventory::reservations::project(&c, project)?;
        crate::local_reservations::project(&c, project)?;
        crate::local_project_review::project(&c, project)?;
    }
    Ok(project)
}

#[tauri::command]
pub fn create_local_project(app: AppHandle, mut project: Value) -> Result<Value, String> {
    let mut c = conn(&app)?; let mut projects = load(&c)?;
    let (user_id, role) = current_principal(&c)?;
    let project_id = id(); let timestamp = now(&c)?;
    if project.get("name").and_then(Value::as_str).map(|s| s.trim().is_empty()).unwrap_or(true) {
        return Err("name is required".into());
    }
    if project.get("status").and_then(Value::as_str).unwrap_or("planning") != "planning" { return Err("New offline projects must begin in Planning; activation requires online admin approval".into()); }
    project["id"] = json!(project_id);
    project["status"] = project.get("status").cloned().unwrap_or(json!("planning"));
    project["priority"] = project.get("priority").cloned().unwrap_or(json!("normal"));
    let visibility = project.get("visibility").and_then(Value::as_str).unwrap_or("lab");
    if !matches!(visibility, "lab" | "project" | "restricted") { return Err("visibility must be lab, project, or restricted".into()); }
    project["visibility"] = json!(visibility);
    project["description"] = project.get("description").cloned().unwrap_or(json!(""));
    project["owner_id"] = json!(&user_id);
    project["members"] = json!([]);
    let can_edit = local_auth::require_local_permission(&c, "projects.edit").is_ok();
    let access = if role == "admin" { "admin" } else if can_edit { "edit" } else { "view" };
    project["permissions"] = json!({"access":access,"member_role":"lead","can_edit":can_edit,"user_id":user_id});
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
    project["requirements"] = json!([]);
    project["lifecycle_revision"] = json!(1);
    projects.push(project.clone());
    save(&mut c, &projects, vec![(id(), "project".into(), project_id, "create".into(), project.clone())])?;
    Ok(project)
}

#[tauri::command]
pub fn update_local_project(app: AppHandle, project_id: String, patch: Value) -> Result<Value, String> {
    let mut c = conn(&app)?; let mut projects = load(&c)?;
    let p = projects.iter_mut().find(|p| p.get("id").and_then(Value::as_str) == Some(project_id.as_str())).ok_or("Project not found")?;
    let old = p.clone();
    prepare_lifecycle_patch(p,&patch)?;
    if patch.get("status").and_then(Value::as_str) == Some("active") && old.get("status").and_then(Value::as_str) != Some("active") { return Err("Activation requires online admin approval. Sync your planning changes and ask an admin to activate this project.".into()); }
    if let Some(obj) = patch.as_object() {
        for (k,v) in obj { if matches!(k.as_str(), "name"|"status"|"budget"|"description"|"priority"|"start_date"|"due_date"|"visibility") { p[k] = v.clone(); } }
    }
    if let Some(visibility) = p.get("visibility").and_then(Value::as_str) {
        if !matches!(visibility, "lab" | "project" | "restricted") { return Err("visibility must be lab, project, or restricted".into()); }
    }
    if p.get("name").and_then(Value::as_str).map(|s| s.trim().is_empty()).unwrap_or(true) { return Err("name cannot be empty".into()); }
    p["updated_at"] = json!(now(&c)?);
    let updated = p.clone();
    save(&mut c, &projects, vec![(id(), "project".into(), project_id.clone(), "update".into(), json!({"id":project_id,"before":old,"project":updated}))])?;
    Ok(updated)
}

fn prepare_lifecycle_patch(project:&mut Value,patch:&Value)->Result<(),String>{
    if let Some(status)=patch.get("status").filter(|s|**s!=project["status"]) {
        if !matches!(status.as_str(),Some("planning"|"active"|"completed"|"on_hold"|"cancelled"|"archived")){return Err("Invalid project status".into());}
        let revision=project["lifecycle_revision"].as_i64().filter(|n|*n>0&&*n<i32::MAX as i64).ok_or("Synchronize this project's lifecycle before changing its status")?;
        if patch.get("expected_lifecycle_revision").is_some_and(|v|v.as_i64()!=Some(revision)){return Err("Project status changed while editing. Review it before saving.".into());}
        project["lifecycle_revision"]=json!(revision+1);
        project["local_lifecycle_pending"]=json!(true);
        project["inventory_settlement"]=json!({"state":"unknown","scope":"inventory","reason":"Project lifecycle awaits server reconciliation"});
    }
    Ok(())
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

// References reuse canonical demand; they never create another requirement.
fn validate_nested_references(project: &Value, key: &str, record: &mut Value) -> Result<(), String> {
    let refs: &[(&str, &str, bool)] = match key {
        "tasks" | "experiments" | "bom" => &[("requirement_id", "requirements", false)],
        "task_experiments" => &[("task_id", "tasks", true), ("experiment_id", "experiments", true)],
        "attachments" => &[("task_id", "tasks", false), ("experiment_id", "experiments", false)],
        "connectors" => &[("source_block_id", "blocks", true), ("target_block_id", "blocks", true)],
        _ => &[],
    };
    if key=="attachments" && (record.get("task_id").is_some_and(|v|!v.is_null())==record.get("experiment_id").is_some_and(|v|!v.is_null())){
        return Err("Attachment must reference exactly one task or experiment".into());
    }
    for &(field, collection, required) in refs {
        let value = record.get(field).unwrap_or(&Value::Null);
        if value.is_null() && !required { continue; }
        let canonical = uuid::Uuid::parse_str(value.as_str().ok_or_else(|| format!("{field} must be a UUID"))?)
            .map_err(|_| format!("{field} must be a UUID"))?.to_string();
        if !nested_get(project, collection).iter().any(|entry| entry.get("id").and_then(Value::as_str)
            .and_then(|id| uuid::Uuid::parse_str(id).ok()).map(|id| id.to_string()) == Some(canonical.clone())) {
            return Err(format!("{field} must reference a record in this project; synchronize if it is missing"));
        }
        record[field] = json!(canonical);
    }
    if key == "connectors" && record["source_block_id"] == record["target_block_id"] {
        return Err("Connector endpoints must be different blocks".into());
    }
    Ok(())
}

fn normalize_work_attachments(project:&mut Value){
    // An existing canonical list is authoritative, including an explicit empty
    // list after local deletion. Only legacy/server nested-only shapes are lifted.
    if project.get("attachments").is_some(){project_work_attachment_views(project);return;}
    let mut rows=Vec::new();let mut seen=HashSet::new();
    for key in ["tasks","experiments"]{
        for work in nested_get(project,key){
            for row in nested_get(&work,"attachments"){
                if let Some(id)=row["id"].as_str(){if seen.insert(id.to_string()){rows.push(row);}}
            }
        }
    }
    project["attachments"]=Value::Array(rows);
    project_work_attachment_views(project);
}

fn project_work_attachment_views(project:&mut Value){
    let rows=nested_get(project,"attachments");
    for (key,reference) in [("tasks","task_id"),("experiments","experiment_id")]{
        if let Some(work)=project.get_mut(key).and_then(Value::as_array_mut){
            for record in work{
                let id=record["id"].as_str();
                let attachments=rows.iter().filter(|row|id.is_some()&&row[reference].as_str()==id).cloned().collect();
                record["attachments"]=Value::Array(attachments);
            }
        }
    }
}

fn project_task_experiment_views(project:&mut Value){
    // Do not invent completeness for older snapshots without a canonical list.
    let Some(links)=project.get("task_experiments").and_then(Value::as_array).cloned() else{return;};
    if let Some(tasks)=project.get_mut("tasks").and_then(Value::as_array_mut){
        for task in tasks{
            let id=task["id"].as_str();
            task["experiments"]=Value::Array(links.iter().filter(|link|id.is_some()&&link["task_id"].as_str()==id).cloned().collect());
        }
    }
}

fn merge_work_attachments(server:&Value,local:&Value,pending:&HashSet<String>,deleted:&[String])->Vec<Value>{
    merge_pending_relation_rows(server,local,"attachments","project_work_attachment",pending,deleted)
}

fn merge_pending_relation_rows(server:&Value,local:&Value,key:&str,entity_type:&str,pending:&HashSet<String>,deleted:&[String])->Vec<Value>{
    let local_rows=nested_get(local,key);let mut seen=HashSet::new();let mut rows=Vec::new();
    for row in nested_get(server,key){
        let Some(id)=row["id"].as_str() else{continue;};
        if !seen.insert(id.to_string()){continue;}
        if pending.contains(&format!("{entity_type}:{id}")){
            // Absence locally plus a pending event is a pending removal.
            if let Some(saved)=local_rows.iter().find(|r|r["id"]==row["id"]){rows.push(saved.clone());}
        }else if !deleted.iter().any(|removed|removed==id){rows.push(row);}
    }
    for row in local_rows{
        if let Some(id)=row["id"].as_str(){
            if pending.contains(&format!("{entity_type}:{id}"))&&seen.insert(id.to_string()){rows.push(row);}
        }
    }
    rows
}

// Pending authored fields win, but a newer confirmed audit snapshot is not an
// authored edit. Never copy server title/content over a pending experiment.
fn pending_experiment_with_history(mut local:Value,server:&Value)->Value{
    if local["id"].as_str().is_some() && local["id"]==server["id"] {
        if let Some(history)=server.get("history").filter(|value|value.is_array()){
            local["history"]=history.clone();
        }
    }
    local
}

fn nested_create(app: AppHandle, project_id: String, key: &str, mut record: Value, entity_type: &str) -> Result<Value, String> {
    let mut c=conn(&app)?; let mut projects=load(&c)?;
    let p=projects.iter_mut().find(|p| p.get("id").and_then(Value::as_str)==Some(project_id.as_str())).ok_or("Project not found")?;
    let record_id=id(); let timestamp=now(&c)?;
    record["id"]=json!(&record_id); record["project_id"]=json!(&project_id);
    record["created_at"]=json!(&timestamp); record["updated_at"]=json!(&timestamp);
    validate_nested_references(p,key,&mut record)?;
    if key=="attachments"{validate_attachment_resource(&c,&mut record)?;}
    let mut list=nested_get(p,key); list.push(record.clone()); p[key]=Value::Array(list); p["updated_at"]=json!(&timestamp);
    save(&mut c,&projects,vec![(id(),entity_type.into(),record_id,"create".into(),record.clone())])?;
    Ok(record)
}

fn nested_update(app: AppHandle, project_id:String, key:&str, record_id:String, patch:Value, entity_type:&str)->Result<Value,String>{
    let mut c=conn(&app)?; let mut projects=load(&c)?;
    let p=projects.iter_mut().find(|p|p.get("id").and_then(Value::as_str)==Some(project_id.as_str())).ok_or("Project not found")?;
    let mut list=nested_get(p,key);
    let r=list.iter_mut().find(|r|r.get("id").and_then(Value::as_str)==Some(record_id.as_str())).ok_or("Record not found")?;
    if key=="experiments"{require_experiment_observation_text(r)?;require_experiment_observation_text(&patch)?;}
    if let Some(obj)=patch.as_object(){for(k,v)in obj{if k!="id"&&k!="project_id"&&k!="created_at"{r[k]=v.clone();}}}
    validate_nested_references(p,key,r)?;
    if key=="attachments"{validate_attachment_resource(&c,r)?;}
    r["updated_at"]=json!(now(&c)?); let updated=r.clone(); p[key]=Value::Array(list); p["updated_at"]=json!(now(&c)?);
    save(&mut c,&projects,vec![(id(),entity_type.into(),record_id,"update".into(),json!({"project_id":project_id,"record":updated}))])?;Ok(updated)
}

fn nested_delete(app:AppHandle,project_id:String,key:&str,record_id:String,entity_type:&str)->Result<(),String>{
    let mut c=conn(&app)?;let mut projects=load(&c)?;
    let p=projects.iter_mut().find(|p|p.get("id").and_then(Value::as_str)==Some(project_id.as_str())).ok_or("Project not found")?;
    let mut list=nested_get(p,key);let before=list.iter().find(|r|r.get("id").and_then(Value::as_str)==Some(record_id.as_str())).cloned().ok_or("Record not found")?;
    list.retain(|r|r.get("id").and_then(Value::as_str)!=Some(record_id.as_str()));p[key]=Value::Array(list);p["updated_at"]=json!(now(&c)?);
    save(&mut c,&projects,vec![(id(),entity_type.into(),record_id,"delete".into(),json!({"project_id":project_id,"record":before}))])
}

#[tauri::command]
pub fn create_local_project_task_experiment(app:AppHandle,project_id:String,task_id:String,record:Value)->Result<Value,String>{
    let mut record=record;
    if record.get("experiment_id").and_then(Value::as_str).is_none() {
        return Err("experiment_id is required".into());
    }
    record["task_id"]=json!(task_id);
    // The server migration gives this composite link a real UUID identity; keep the
    // locally generated UUID stable so pending merges and deletes can match the server row.
    nested_create(app,project_id,"task_experiments",record,"project_task_experiment")
}

#[tauri::command]
pub fn get_local_project_task_experiments(app:AppHandle,project_id:String,task_id:String)->Result<Vec<Value>,String>{
    let c=conn(&app)?;
    let p=load(&c)?.into_iter().find(|p|p.get("id").and_then(Value::as_str)==Some(project_id.as_str())).ok_or("Project not found")?;
    task_experiment_rows(&p,&task_id)
}

fn task_experiment_rows(project:&Value,task_id:&str)->Result<Vec<Value>,String>{
    if !nested_get(project,"tasks").iter().any(|t|t["id"].as_str()==Some(task_id)){
        return Err("Task is not available in this project".into());
    }
    let experiments=nested_get(project,"experiments");
    Ok(nested_get(project,"task_experiments").into_iter()
        .filter(|r|r["task_id"].as_str()==Some(task_id))
        .map(|mut link|{
            let experiment=experiments.iter().find(|e|e["id"].as_str().is_some()&&e["id"]==link["experiment_id"]);
            // Labels are a read projection, never copied back into the outbox.
            link["title"]=experiment.map(|e|e["title"].clone()).unwrap_or(json!("Unavailable experiment"));
            link["status"]=experiment.map(|e|e["status"].clone()).unwrap_or(Value::Null);
            link
        }).collect())
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
    local_auth::require_local_permission(&c,"resources.view")?;
    project_attachment_rows(&p,&work_id,&work_type,&crate::local_resources::read_resources(&c)?)
}

fn project_attachment_rows(project:&Value,work_id:&str,work_type:&str,resources:&[crate::local_resources::LocalResource])->Result<Vec<Value>,String>{
    let (collection,key)=match work_type{
        "task"=>("tasks","task_id"),"experiment"=>("experiments","experiment_id"),
        _=>return Err("work_type must be task or experiment".into())
    };
    if !nested_get(project,collection).iter().any(|work|work["id"].as_str()==Some(work_id)){
        return Err("Work item is not available in this project".into());
    }
    Ok(nested_get(project,"attachments").into_iter().filter(|a|a[key].as_str()==Some(work_id)).map(|mut attachment|{
        let resource=resources.iter().find(|r|Some(r.id.as_str())==attachment["resource_id"].as_str());
        // Current account-scoped labels only; do not expose paths or rewrite link identity.
        attachment["name"]=json!(resource.and_then(|r|{
            if !r.name.trim().is_empty(){Some(r.name.as_str())}
            else{r.original_filename.as_deref().filter(|name|!name.trim().is_empty())}
        }).unwrap_or("Unavailable resource"));
        attachment["original_filename"]=json!(resource.and_then(|r|r.original_filename.as_deref()));
        attachment
    }).collect())
}

#[tauri::command]
pub fn create_local_project_attachment(app:AppHandle,project_id:String,work_id:String,work_type:String,resource_id:String)->Result<Value,String>{
    if work_type!="task" && work_type!="experiment" { return Err("work_type must be task or experiment".into()); }
    let mut record=json!({"resource_id":resource_id});
    if work_type=="task" { record["task_id"]=json!(work_id); } else { record["experiment_id"]=json!(work_id); }
    nested_create(app,project_id,"attachments",record,"project_work_attachment")
}

fn validate_attachment_resource(c:&Connection,record:&mut Value)->Result<(),String>{
    let resource_id=record["resource_id"].as_str().and_then(|id|uuid::Uuid::parse_str(id).ok()).ok_or("resourceId must be a UUID")?.to_string();
    local_auth::require_local_permission(c,"resources.view")?;
    if !crate::local_resources::read_resources(c)?.iter().any(|resource|uuid::Uuid::parse_str(&resource.id).ok().map(|id|id.to_string())==Some(resource_id.clone())){
        return Err("Resource is not available in the current local account; synchronize before attaching it".into());
    }
    record["resource_id"]=json!(resource_id);
    Ok(())
}

#[tauri::command]
pub fn delete_local_project_attachment(app:AppHandle,project_id:String,attachment_id:String)->Result<(),String>{
    nested_delete(app,project_id,"attachments",attachment_id,"project_work_attachment")
}

#[tauri::command]
pub fn list_local_project_workspace(app:AppHandle,project_id:String)->Result<Value,String>{
    let c=conn(&app)?;let p=load(&c)?.into_iter().find(|p|p.get("id").and_then(Value::as_str)==Some(project_id.as_str())).ok_or("Project not found")?;
    let permissions=current_project_access(&c,&p)?;
    let activity=crate::local_activity::read_project(&c,&project_id).unwrap_or_else(|_|json!({"items":[],"state":"unavailable","last_synced_at":null}));
    let grants=local_auth::local_current_permissions(app)?;
    let resources=if grants.iter().any(|p|p=="resources.view") {
        local_auth::require_local_permission(&c,"resources.view")?;
        project_resource_rows(&project_id,crate::local_resources::read_resources(&c)?)
    } else { Vec::new() };
    let notes=if grants.iter().any(|p|p=="notes.view") {
        local_auth::require_local_permission(&c,"notes.view")?;
        project_note_rows(&project_id,crate::local_notes::load(&c)?)
    } else { Vec::new() };
    Ok(json!({"members":nested_get(&p,"members"),"tasks":nested_get(&p,"tasks"),"experiments":nested_get(&p,"experiments"),"items":nested_get(&p,"items"),"notes":notes,"resources":resources,"activity":activity["items"],"activity_state":activity["state"],"activity_last_synced_at":activity["last_synced_at"],"blocks":nested_get(&p,"blocks"),"connectors":nested_get(&p,"connectors"),"task_experiments":nested_get(&p,"task_experiments"),"attachments":nested_get(&p,"attachments"),"requirements":nested_get(&p,"requirements"),"permissions":permissions}))
}

fn project_note_rows(project_id:&str, notes:Vec<Value>)->Vec<Value>{
    notes.into_iter().filter(|n|n.get("project_id").and_then(Value::as_str)==Some(project_id)).collect()
}

fn project_resource_rows(project_id:&str, resources:Vec<crate::local_resources::LocalResource>)->Vec<crate::local_resources::LocalResource>{
    resources.into_iter().filter(|r|r.project_id.as_deref()==Some(project_id)).collect()
}

#[cfg(test)]
mod resource_workspace_tests {
    use super::*;
    #[test]
    fn attachment_snapshot_shapes_and_pending_deletes_converge(){
        let a=json!({"id":"a","task_id":"t","resource_id":"r"});
        let b=json!({"id":"b","experiment_id":"e","resource_id":"s"});
        let mut server=json!({"tasks":[{"attachments":[a.clone()]}],"experiments":[{"attachments":[b.clone(),a.clone()]}]});
        normalize_work_attachments(&mut server);assert_eq!(server["attachments"],json!([a,b]));
        let mut removed=server.clone();removed["attachments"]=json!([]);
        normalize_work_attachments(&mut removed);assert_eq!(removed["attachments"],json!([]));
        let local=json!({"attachments":[{"id":"c","resource_id":"local"}]});
        let pending=HashSet::from(["project_work_attachment:a".to_string(),"project_work_attachment:c".to_string()]);
        let rows=merge_work_attachments(&server,&local,&pending,&[]);
        assert_eq!(rows.len(),2);assert_eq!(rows[0]["id"],"b");assert_eq!(rows[1]["id"],"c");
        assert_eq!(merge_work_attachments(&server,&json!({"attachments":rows}),&pending,&[]),rows);
        assert!(merge_work_attachments(&server,&local,&HashSet::new(),&["a".into(),"b".into()]).is_empty());
        assert!(merge_work_attachments(&json!({"attachments":[]}),&local,&HashSet::new(),&[]).is_empty());
    }
    #[test]
    fn confirmed_history_refresh_preserves_pending_authored_fields(){
        let local=json!({"id":"e","title":"Unsynced title","observations":"Unsynced prose","history":[{"id":"old"}]});
        let server=json!({"id":"e","title":"Server title","observations":"Server prose","history":[{"id":"new"}]});
        let merged=pending_experiment_with_history(local.clone(),&server);
        assert_eq!(merged["title"],local["title"]);assert_eq!(merged["observations"],local["observations"]);
        assert_eq!(merged["history"],server["history"]);
        assert_eq!(pending_experiment_with_history(merged.clone(),&server),merged);
        for invalid in [json!({"id":"other","history":[]}),json!({"id":"e"}),json!({"id":"e","history":null}),json!({"id":"e","history":"bad"})]{
            assert_eq!(pending_experiment_with_history(local.clone(),&invalid),local);
        }
        assert_eq!(pending_experiment_with_history(local,&json!({"id":"e","history":[]}))["history"],json!([]));
    }

    #[test]
    fn task_nested_links_follow_canonical_presence_without_inventing_legacy_state(){
        let legacy=json!({"tasks":[{"id":"t","experiments":[{"id":"old"}]}]});
        let mut project=legacy.clone();project_task_experiment_views(&mut project);assert_eq!(project,legacy);
        project["task_experiments"]=json!([]);project_task_experiment_views(&mut project);
        assert_eq!(project["tasks"][0]["experiments"],json!([]));
        project["task_experiments"]=json!([{"id":"one","task_id":"t"},{"id":"other","task_id":"elsewhere"}]);
        project_task_experiment_views(&mut project);
        assert_eq!(project["tasks"][0]["experiments"],json!([{"id":"one","task_id":"t"}]));
        let once=project.clone();project_task_experiment_views(&mut project);assert_eq!(project,once);
    }

    #[test]
    fn experiment_history_and_pending_event_survive_disk_reopen(){
        let path=std::env::temp_dir().join(format!("labos-history-{}.sqlite",uuid::Uuid::new_v4()));
        let account="10000000-0000-4000-8000-000000000001";
        let mut c=Connection::open(&path).unwrap();local_db::ensure_schema(&c).unwrap();
        c.execute_batch("CREATE TABLE local_users(id TEXT PRIMARY KEY,central_user_id TEXT,role TEXT,username TEXT,is_active INTEGER,offline_expires_at TEXT,permissions_json TEXT);CREATE TABLE local_session(id INTEGER PRIMARY KEY,user_id TEXT);").unwrap();
        c.execute("INSERT INTO local_users VALUES('a',?1,'researcher','fixture',1,datetime('now','+24 hours'),'[\"projects.view\",\"projects.edit\"]')",[account]).unwrap();
        c.execute("INSERT INTO local_session VALUES(1,'a')",[]).unwrap();
        let experiment=json!({"id":"e","title":"Pending local title","observations":"Pending local prose"});
        let payload=json!({"project_id":"p","record":experiment});
        let mut project=json!({"id":"p","visibility":"lab","permissions":{"user_id":account,"access":"edit","can_edit":true},"experiments":[experiment]});
        save(&mut c,&[project.clone()],vec![("change-history".into(),"project_experiment".into(),"e".into(),"update".into(),payload.clone())]).unwrap();
        project["attachments"]=json!([{"id":"local-attachment","experiment_id":"e","resource_id":"local-resource"}]);
        project["tasks"]=json!([{"id":"t"}]);
        project["experiments"][0]["measurements"]=json!([{"id":"local-m","value":7}]);
        project["experiments"][0]["observation_records"]=json!([{"id":"local-o","content":"local"}]);
        project["task_experiments"]=json!([{"id":"pending-link","task_id":"t","experiment_id":"e","label":"local"}]);
        save(&mut c,&[project.clone()],vec![
            ("measurement-create".into(),"project_experiment_measurement".into(),"local-m".into(),"create".into(),json!({"project_id":"p","experiment_id":"e","value":7})),
            ("measurement-delete".into(),"project_experiment_measurement".into(),"removed-m".into(),"delete".into(),json!({"project_id":"p","experiment_id":"e","record":{"id":"removed-m"}})),
            ("observation-create".into(),"project_experiment_observation".into(),"local-o".into(),"create".into(),json!({"project_id":"p","experiment_id":"e","content":"local"})),
            ("observation-delete".into(),"project_experiment_observation".into(),"removed-o".into(),"delete".into(),json!({"project_id":"p","experiment_id":"e","record":{"id":"removed-o"}})),
            ("task-delete".into(),"project_task".into(),"removed-task".into(),"delete".into(),json!({"project_id":"p","record":{"id":"removed-task"}})),
            ("experiment-delete".into(),"project_experiment".into(),"removed-experiment".into(),"delete".into(),json!({"project_id":"p","record":{"id":"removed-experiment"}})),
            ("link-change".into(),"project_task_experiment".into(),"pending-link".into(),"create".into(),json!({"project_id":"p","record":project["task_experiments"][0]})),
            ("unlink-change".into(),"project_task_experiment".into(),"removed-link".into(),"delete".into(),json!({"project_id":"p","record":{"id":"removed-link"}})),
            ("attach-change".into(),"project_work_attachment".into(),"local-attachment".into(),"create".into(),json!({"project_id":"p","id":"local-attachment"})),
            ("detach-change".into(),"project_work_attachment".into(),"removed-attachment".into(),"delete".into(),json!({"project_id":"p","record":{"id":"removed-attachment"}}))
        ]).unwrap();
        let collections=[("bom","project_bom"),("blocks","project_block"),("connectors","project_connector"),("requirements","project_resource_requirement"),("items","project_item")];
        let mut collection_events=Vec::new();
        for (key,entity) in collections{
            let identity=if key=="items"{"item_id"}else{"id"};
            project[key]=json!([{identity:"edited","value":"local"},{identity:"created","value":"local"},{identity:"obsolete","value":"old"}]);
            for (record_id,operation) in [("edited","update"),("created","create"),("removed","delete")]{
                let event_id=if key=="items"{format!("p:{record_id}")}else{record_id.into()};
                collection_events.push((format!("{key}-{record_id}"),entity.into(),event_id,operation.into(),json!({"project_id":"p","record":{identity:record_id}})));
            }
        }
        save(&mut c,&[project.clone()],collection_events).unwrap();
        let mut server=project.clone();
        for (key,_) in collections{
            let identity=if key=="items"{"item_id"}else{"id"};
            server[key]=json!([{identity:"edited","value":"server"},{identity:"removed"},{identity:"confirmed","value":"server"}]);
        }
        server["task_experiments"]=json!([{"id":"pending-link","task_id":"t","experiment_id":"e","label":"server"},{"id":"removed-link","task_id":"t","experiment_id":"e"}]);
        server.as_object_mut().unwrap().remove("attachments");
        server["experiments"][0]=json!({"id":"e","title":"Server title","observations":"Server prose","history":[{"id":"audit","action":"UPDATE"}],"attachments":[{"id":"server-attachment","experiment_id":"e","resource_id":"server-resource"},{"id":"removed-attachment","experiment_id":"e","resource_id":"removed-resource"}]});
        server["tasks"].as_array_mut().unwrap().push(json!({"id":"removed-task"}));
        server["experiments"][0]["measurements"]=json!([{"id":"local-m","value":99},{"id":"removed-m"},{"id":"server-m","value":8}]);
        server["experiments"][0]["observation_records"]=json!([{"id":"local-o","content":"server"},{"id":"removed-o"},{"id":"server-o","content":"confirmed"}]);
        server["experiments"].as_array_mut().unwrap().push(json!({"id":"removed-experiment"}));
        for _ in 0..2{apply_project_pull(&mut c,json!([server.clone()]).to_string(),vec!["p".into()],vec![],vec![],vec![],vec![],vec![],vec![],vec![],vec![],vec![],vec![],vec![],account.into()).unwrap();}
        project=load(&c).unwrap().remove(0);
        assert_eq!(project["experiments"][0]["title"],"Pending local title");
        assert_eq!(project["experiments"][0]["observations"],"Pending local prose");
        assert_eq!(project["experiments"][0]["measurements"],json!([{"id":"local-m","value":7},{"id":"server-m","value":8}]));
        assert_eq!(project["experiments"][0]["observation_records"],json!([{"id":"local-o","content":"local"},{"id":"server-o","content":"confirmed"}]));
        assert_eq!(project["experiments"][0]["history"],server["experiments"][0]["history"]);
        assert_eq!(project["experiments"].as_array().unwrap().len(),1);
        assert_eq!(project["tasks"].as_array().unwrap().len(),1);
        assert_eq!(project["tasks"][0]["id"],"t");
        assert_eq!(project["tasks"][0]["experiments"],project["task_experiments"]);
        for (key,_) in collections{
            let identity=if key=="items"{"item_id"}else{"id"};
            assert_eq!(project[key],json!([{identity:"edited","value":"local"},{identity:"confirmed","value":"server"},{identity:"created","value":"local"}]),"{key} pending merge");
        }
        assert_eq!(project["attachments"].as_array().unwrap().len(),2);
        assert_eq!(project["attachments"][0]["id"],"server-attachment");
        assert_eq!(project["attachments"][1]["id"],"local-attachment");
        assert_eq!(project["experiments"][0]["attachments"],project["attachments"]);
        assert_eq!(project["task_experiments"],json!([{"id":"pending-link","task_id":"t","experiment_id":"e","label":"local"}]));
        assert!(apply_project_pull(&mut c,json!([server.clone()]).to_string(),vec!["p".into()],vec![],vec![],vec![],vec![],vec![],vec![],vec![],vec![],vec![],vec![],vec![],"foreign-account".into()).is_err());
        assert_eq!(load(&c).unwrap()[0],project);
        drop(c);
        let mut c=Connection::open(&path).unwrap();
        assert_eq!(load(&c).unwrap()[0]["experiments"],project["experiments"]);
        assert_eq!(load(&c).unwrap()[0]["attachments"],project["attachments"]);
        assert_eq!(load(&c).unwrap()[0]["task_experiments"],project["task_experiments"]);
        let (raw,ack):(String,Option<String>)=c.query_row("SELECT payload_json,synced_at FROM sync_outbox WHERE change_id='change-history'",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&raw).unwrap(),payload);assert!(ack.is_none());
        assert_eq!(c.query_row("SELECT COUNT(*) FROM sync_outbox WHERE synced_at IS NULL",[],|r|r.get::<_,i64>(0)).unwrap(),26);
        for (key,_) in collections{assert_eq!(load(&c).unwrap()[0][key],project[key],"{key} reopen");}
        // Simulate confirmed ACKs only in this isolated fixture, then deliver the
        // authoritative post-operation snapshot. Production pull never ACKs rows.
        for (key,_) in collections{
            for record_id in ["edited","created","removed"]{
                c.execute("UPDATE sync_outbox SET synced_at=datetime('now') WHERE change_id=?1",[format!("{key}-{record_id}")]).unwrap();
            }
            let identity=if key=="items"{"item_id"}else{"id"};
            server[key]=json!([{identity:"edited","value":"confirmed edit"},{identity:"created","value":"confirmed create"}]);
        }
        apply_project_pull(&mut c,json!([server.clone()]).to_string(),vec!["p".into()],vec![],vec![],vec![],vec![],vec![],vec![],vec![],vec![],vec![],vec![],vec![],account.into()).unwrap();
        let confirmed=load(&c).unwrap().remove(0);
        for (key,_) in collections{assert_eq!(confirmed[key],server[key],"{key} acknowledged convergence");}
        assert_eq!(c.query_row("SELECT COUNT(*) FROM sync_outbox WHERE synced_at IS NULL",[],|r|r.get::<_,i64>(0)).unwrap(),11);
        drop(c);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn attachments_require_one_current_project_work_reference(){
        let task="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        let experiment="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        let project=json!({"tasks":[{"id":task}],"experiments":[{"id":experiment}]});
        for field in ["task_id","experiment_id"]{
            let id=if field=="task_id"{task}else{experiment};
            let mut record=json!({field:id.to_uppercase()});
            validate_nested_references(&project,"attachments",&mut record).unwrap();
            assert_eq!(record[field],id);
        }
        for mut record in [json!({}),json!({"task_id":null}),json!({"task_id":task,"experiment_id":experiment}),json!({"task_id":experiment}),json!({"experiment_id":task}),json!({"task_id":"bad"})]{
            assert!(validate_nested_references(&project,"attachments",&mut record).is_err());
        }
        assert!(validate_nested_references(&json!({"tasks":[]}),"attachments",&mut json!({"task_id":task})).is_err());
    }
    #[test]
    fn attachment_labels_preserve_links_and_use_current_account_resource_rows(){
        let p=json!({"tasks":[{"id":"t"}],"experiments":[{"id":"e"}],"attachments":[
            {"id":"a","task_id":"t","resource_id":"r","name":"Stale"},
            {"id":"b","experiment_id":"e","resource_id":"r"},
            {"id":"c","task_id":"t","resource_id":"missing","name":"Old private name","original_filename":"old.pdf"},
            {"id":"d","task_id":"other","resource_id":"r"}]});
        let before=p.clone();
        let mut resource:crate::local_resources::LocalResource=serde_json::from_value(json!({"id":"r","name":"Current name","kind":"file","file_type":"pdf","created_at":"now","updated_at":"now","tags":[],"original_filename":"file.pdf"})).unwrap();
        let rows=project_attachment_rows(&p,"t","task",&[resource.clone()]).unwrap();
        assert_eq!(rows.len(),2);assert_eq!(rows[0]["id"],"a");assert_eq!(rows[0]["resource_id"],"r");
        assert_eq!(rows[0]["name"],"Current name");assert_eq!(rows[1]["name"],"Unavailable resource");assert!(rows[1]["original_filename"].is_null());
        resource.name=" ".into();
        assert_eq!(project_attachment_rows(&p,"e","experiment",&[resource]).unwrap()[0]["name"],"file.pdf");
        assert_eq!(project_attachment_rows(&p,"t","task",&[]).unwrap()[0]["name"],"Unavailable resource");
        assert!(project_attachment_rows(&p,"other","task",&[]).is_err());
        assert!(project_attachment_rows(&p,"t","invalid",&[]).is_err());assert_eq!(p,before);
    }
    #[test]
    fn task_experiment_links_join_current_project_labels_without_changing_identity(){
        let p=json!({"tasks":[{"id":"t"}],"experiments":[{"id":"e","title":"Current title","status":"planned"}],"task_experiments":[
            {"id":"link","task_id":"t","experiment_id":"e","relationship":"validates","title":"Old label"},
            {"id":"missing","task_id":"t","experiment_id":"absent","title":"Stale title"},
            {"id":"other","task_id":"other","experiment_id":"e"}]});
        let before=p.clone();let rows=task_experiment_rows(&p,"t").unwrap();
        assert_eq!(rows.len(),2);assert_eq!(rows[0]["id"],"link");assert_eq!(rows[0]["title"],"Current title");
        assert_eq!(rows[0]["relationship"],"validates");assert_eq!(rows[1]["title"],"Unavailable experiment");
        assert_eq!(p,before);assert!(task_experiment_rows(&p,"missing-task").is_err());
        assert!(task_experiment_rows(&json!({"tasks":[{"id":"t"}]}),"t").unwrap().is_empty());
    }
    #[test]
    fn project_notes_follow_current_local_project_and_preserve_unsynced_content(){
        let linked=json!({"id":"note","project_id":"p","title":"Local edit","body":"Not synced yet","tags":["lab"]});
        let rows=project_note_rows("p",vec![linked.clone(),json!({"id":"other","project_id":"q"}),json!({"id":"none","project_id":null}),json!({"id":"missing"})]);
        assert_eq!(rows,vec![linked.clone()]);
        let mut moved=linked;moved["project_id"]=json!("q");
        assert!(project_note_rows("p",vec![moved.clone()]).is_empty());
        assert_eq!(project_note_rows("q",vec![moved.clone()]),vec![moved]);
        assert!(project_note_rows("p",vec![]).is_empty());
    }
    #[test]
    fn project_resources_follow_current_local_attachment_not_joined_names(){
        let row=|id:&str,project:Option<&str>|serde_json::from_value(json!({"id":id,"name":id,"kind":"file","file_type":"pdf","created_at":"now","updated_at":"now","tags":[],"project_id":project})).unwrap();
        let rows=project_resource_rows("p",vec![row("linked",Some("p")),row("other",Some("q")),row("unattached",None)]);
        assert_eq!(rows.len(),1);assert_eq!(rows[0].id,"linked");assert!(rows[0].project_name.is_none());
        let mut moved=rows[0].clone();moved.project_id=Some("q".into());
        assert!(project_resource_rows("p",vec![moved.clone()]).is_empty());
        assert_eq!(project_resource_rows("q",vec![moved]).len(),1);
    }
}

#[tauri::command]
pub fn create_local_project_task(app:AppHandle,project_id:String,record:Value)->Result<Value,String>{nested_create(app,project_id,"tasks",record,"project_task")}
#[tauri::command]
pub fn update_local_project_task(app:AppHandle,project_id:String,record_id:String,patch:Value)->Result<Value,String>{nested_update(app,project_id,"tasks",record_id,patch,"project_task")}
#[tauri::command]
pub fn delete_local_project_task(app:AppHandle,project_id:String,record_id:String)->Result<(),String>{nested_delete(app,project_id,"tasks",record_id,"project_task")}

#[tauri::command]
pub fn create_local_project_experiment(app:AppHandle,project_id:String,mut record:Value)->Result<Value,String>{require_experiment_observation_text(&record)?;if record.get("observations").is_none(){record["observations"]=json!("");}record["measurements"]=json!([]);record["observation_records"]=json!([]);record["observations_text_available"]=json!(true);nested_create(app,project_id,"experiments",record,"project_experiment")}
#[tauri::command]
pub fn update_local_project_experiment(app:AppHandle,project_id:String,record_id:String,patch:Value)->Result<Value,String>{nested_update(app,project_id,"experiments",record_id,patch,"project_experiment")}
#[tauri::command]
pub fn delete_local_project_experiment(app:AppHandle,project_id:String,record_id:String)->Result<(),String>{nested_delete(app,project_id,"experiments",record_id,"project_experiment")}

#[tauri::command]
pub fn repeat_local_project_experiment(app:AppHandle,project_id:String,experiment_id:String)->Result<Value,String>{
    let c=conn(&app)?;
    let p=load(&c)?.into_iter().find(|p|p.get("id").and_then(Value::as_str)==Some(project_id.as_str())).ok_or("Project not found")?;
    let experiments=nested_get(&p,"experiments");
    let original=experiments.iter().find(|e|e.get("id").and_then(Value::as_str)==Some(experiment_id.as_str())).ok_or("Experiment not found")?;
    let new_exp=json!({
        "project_id": project_id,
        "title": format!("{} (repeat)", original.get("title").and_then(Value::as_str).unwrap_or("Experiment")),
        "status": "planned",
        "hypothesis": original.get("hypothesis").cloned().unwrap_or(json!("")),
        "procedure": original.get("procedure").cloned().unwrap_or(json!("")),
        "requirement_id": original.get("requirement_id").cloned().unwrap_or(Value::Null),
        "observations": json!(""),
        "measurements": json!([]),
    });
    create_local_project_experiment(app,project_id,new_exp)
}

#[tauri::command]
pub fn create_local_project_bom(app:AppHandle,project_id:String,record:Value)->Result<Value,String>{nested_create(app,project_id,"bom",record,"project_bom")}
#[tauri::command]
pub fn update_local_project_bom(app:AppHandle,project_id:String,record_id:String,patch:Value)->Result<Value,String>{nested_update(app,project_id,"bom",record_id,patch,"project_bom")}
#[tauri::command]
pub fn delete_local_project_bom(app:AppHandle,project_id:String,record_id:String)->Result<(),String>{nested_delete(app,project_id,"bom",record_id,"project_bom")}

#[tauri::command]
pub fn get_local_project_canvas(app:AppHandle,project_id:String)->Result<Value,String>{
    let c=conn(&app)?;let p=load(&c)?.into_iter().find(|p|p.get("id").and_then(Value::as_str)==Some(project_id.as_str())).ok_or("Project not found")?;
    let permissions=current_project_access(&c,&p)?;
    Ok(json!({"blocks":nested_get(&p,"blocks"),"connectors":nested_get(&p,"connectors"),"permissions":permissions}))
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
pub fn get_local_resource_requirements(app: AppHandle, project_id: Option<String>) -> Result<Vec<Value>, String> {
    let c=conn(&app)?; let projects=load(&c)?; let mut rows=Vec::new();
    for p in projects {
        if let Some(ref pid)=project_id { if p.get("id").and_then(Value::as_str)!=Some(pid.as_str()) { continue; } }
        for mut row in nested_get(&p,"requirements") {
            row["project_name"]=p.get("name").cloned().unwrap_or(Value::Null); rows.push(row);
        }
    }
    Ok(rows)
}
#[tauri::command]
pub fn create_local_resource_requirement(app: AppHandle, project_id: String, mut record: Value) -> Result<Value, String> {
    let name=record.get("name").and_then(Value::as_str).unwrap_or("").trim().to_string();
    if name.is_empty(){return Err("name is required".into());}
    if record.get("quantity").and_then(Value::as_f64).unwrap_or(0.0)<=0.0{return Err("quantity must be greater than zero".into());}
    record["name"]=json!(name); record["status"]=record.get("status").cloned().unwrap_or(json!("required"));
    record["requirement_type"]=record.get("requirement_type").cloned().unwrap_or(json!("component"));
    nested_create(app,project_id,"requirements",record,"project_resource_requirement")
}
#[tauri::command]
pub fn update_local_resource_requirement(app: AppHandle, project_id: String, record_id: String, patch: Value) -> Result<Value, String> {
    if let Some(q)=patch.get("quantity").and_then(Value::as_f64) { if q<=0.0{return Err("quantity must be greater than zero".into());} }
    if let Some(n)=patch.get("name").and_then(Value::as_str) { if n.trim().is_empty(){return Err("name cannot be empty".into());} }
    nested_update(app,project_id,"requirements",record_id,patch,"project_resource_requirement")
}
#[tauri::command]
pub fn delete_local_resource_requirement(app: AppHandle, project_id: String, record_id: String) -> Result<(), String> {
    nested_delete(app,project_id,"requirements",record_id,"project_resource_requirement")
}

#[tauri::command]
pub fn get_local_project_bom(app:AppHandle,project_id:String)->Result<Vec<Value>,String>{let c=conn(&app)?;let p=load(&c)?.into_iter().find(|p|p.get("id").and_then(Value::as_str)==Some(project_id.as_str())).ok_or("Project not found")?;Ok(nested_get(&p,"bom"))}

#[tauri::command]
pub fn link_local_project_item(app:AppHandle,project_id:String,item_id:String,allocated_quantity:f64,notes:String)->Result<Value,String>{
    let mut c=conn(&app)?;let mut projects=load(&c)?;let p=projects.iter_mut().find(|p|p.get("id").and_then(Value::as_str)==Some(project_id.as_str())).ok_or("Project not found")?;
    let mut items=nested_get(p,"items");let existing=items.iter_mut().find(|x|x.get("item_id").and_then(Value::as_str)==Some(item_id.as_str()));
    let record=json!({"project_id":project_id,"item_id":item_id,"allocated_quantity":allocated_quantity,"notes":notes});
    if let Some(e)=existing{*e=record.clone();}else{items.push(record.clone());}p["items"]=Value::Array(items);p["updated_at"]=json!(now(&c)?);
    save(&mut c,&projects,vec![(id(),"project_item".into(),format!("{}:{}",project_id,item_id),"upsert".into(),record.clone())])?;Ok(record)
}

#[tauri::command]
pub fn unlink_local_project_item(app:AppHandle,project_id:String,item_id:String)->Result<(),String>{
    let mut c=conn(&app)?;let mut projects=load(&c)?;let p=projects.iter_mut().find(|p|p.get("id").and_then(Value::as_str)==Some(project_id.as_str())).ok_or("Project not found")?;
    let mut items=nested_get(p,"items");items.retain(|x|x.get("item_id").and_then(Value::as_str)!=Some(item_id.as_str()));p["items"]=Value::Array(items);p["updated_at"]=json!(now(&c)?);
    save(&mut c,&projects,vec![(id(),"project_item".into(),format!("{}:{}",project_id,item_id),"delete".into(),json!({"project_id":project_id,"item_id":item_id}))])
}


#[tauri::command]
pub fn apply_server_project_pull(app: AppHandle, projects_json: String, visible_project_ids: Vec<String>, deleted_project_ids: Vec<String>, deleted_project_task_ids: Vec<String>, deleted_project_experiment_ids: Vec<String>, deleted_project_bom_ids: Vec<String>, deleted_project_block_ids: Vec<String>, deleted_project_connector_ids: Vec<String>, deleted_project_measurement_ids: Vec<String>, deleted_project_observation_ids: Vec<String>, deleted_project_attachment_ids: Vec<String>, _deleted_project_task_experiment_ids: Vec<String>, deleted_project_requirement_ids: Vec<String>, expected_account_id: String) -> Result<(), String> {
    let mut c=conn(&app)?;
    apply_project_pull(&mut c,projects_json,visible_project_ids,deleted_project_ids,deleted_project_task_ids,deleted_project_experiment_ids,deleted_project_bom_ids,deleted_project_block_ids,deleted_project_connector_ids,deleted_project_measurement_ids,deleted_project_observation_ids,deleted_project_attachment_ids,_deleted_project_task_experiment_ids,deleted_project_requirement_ids,expected_account_id)
}

fn apply_project_pull(c:&mut Connection, projects_json: String, visible_project_ids: Vec<String>, deleted_project_ids: Vec<String>, deleted_project_task_ids: Vec<String>, deleted_project_experiment_ids: Vec<String>, deleted_project_bom_ids: Vec<String>, deleted_project_block_ids: Vec<String>, deleted_project_connector_ids: Vec<String>, deleted_project_measurement_ids: Vec<String>, deleted_project_observation_ids: Vec<String>, deleted_project_attachment_ids: Vec<String>, _deleted_project_task_experiment_ids: Vec<String>, deleted_project_requirement_ids: Vec<String>, expected_account_id: String) -> Result<(), String> {
    let mut incoming: Vec<Value> = serde_json::from_str(&projects_json).map_err(|e| format!("Invalid server project payload: {e}"))?;
    for project in &mut incoming{normalize_experiment_observations(project);normalize_work_attachments(project);}
    let visible: std::collections::HashSet<String> = visible_project_ids.into_iter().collect();
    let deleted: std::collections::HashSet<String> = deleted_project_ids.into_iter().collect();
    local_db::require_sync_account(&c, &expected_account_id)?;
    let mut projects = load(&c)?;
    let pending: std::collections::HashSet<String> = {
        let mut stmt = c.prepare("SELECT DISTINCT entity_type || ':' || entity_id FROM active_sync_outbox WHERE synced_at IS NULL AND entity_id IS NOT NULL AND entity_type IN ('project','project_task','project_experiment','project_experiment_measurement','project_experiment_observation','project_bom','project_block','project_connector','project_work_attachment','project_task_experiment','project_resource_requirement','project_item')").map_err(|e| format!("Unable to inspect pending project changes: {e}"))?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(|e| format!("Unable to inspect pending project changes: {e}"))?;
        rows.filter_map(|r| r.ok()).collect()
    };
    projects.retain(|p| {
        let id = p.get("id").and_then(Value::as_str).unwrap_or_default();
        (!deleted.contains(id) && visible.contains(id)) || pending.contains(&format!("project:{id}"))
    });
    let mut refreshed_reservations=Vec::new();
    for mut project in incoming {
        let Some(project_id) = project.get("id").and_then(Value::as_str).map(ToOwned::to_owned) else { continue; };
        if pending.contains(&format!("project:{project_id}")) { continue; }
        if let Some(rows)=project["reservations"].as_array(){
            refreshed_reservations.extend(rows.iter().filter(|r|r["applied_intent_ids"].is_array()).filter_map(|r|r["id"].as_str().map(ToOwned::to_owned)));
        }
        if let Some(existing) = projects.iter().find(|p| p.get("id").and_then(Value::as_str) == Some(project_id.as_str())).cloned() {
            project["attachments"]=json!(merge_work_attachments(&project,&existing,&pending,&deleted_project_attachment_ids));
            project["task_experiments"]=Value::Array(merge_pending_relation_rows(&project,&existing,"task_experiments","project_task_experiment",&pending,&_deleted_project_task_experiment_ids));
            for key in ["tasks","experiments","bom","blocks","connectors","requirements","items"] {
                let pending_key = match key { "tasks"=>"project_task", "experiments"=>"project_experiment", "bom"=>"project_bom", "blocks"=>"project_block", "connectors"=>"project_connector", "requirements"=>"project_resource_requirement", "items"=>"project_item", _=>"" };
                let deleted_ids: std::collections::HashSet<String> = match key { "items"=>std::collections::HashSet::new(), "tasks"=>deleted_project_task_ids.iter().cloned().collect(), "experiments"=>deleted_project_experiment_ids.iter().cloned().collect(), "bom"=>deleted_project_bom_ids.iter().cloned().collect(), "blocks"=>deleted_project_block_ids.iter().cloned().collect(), "connectors"=>deleted_project_connector_ids.iter().cloned().collect(), "requirements"=>deleted_project_requirement_ids.iter().cloned().collect(), _=>std::collections::HashSet::new() };
                let mut merged = project.get(key).and_then(Value::as_array).cloned().unwrap_or_default();
                merged.retain(|v| {
                    let rid=v.get("id").and_then(Value::as_str).or_else(|| if key=="items" { v.get("item_id").and_then(Value::as_str) } else { None }).unwrap_or_default();
                    let pending_id=if key=="items"{format!("{}:{}",project_id,rid)}else{rid.to_string()};
                    if pending.contains(&format!("{pending_key}:{pending_id}")) {
                        // A pending deletion has no local row to overlay. Do not
                        // resurrect the stale server row while waiting for ACK.
                        nested_get(&existing,key).iter().any(|old|old.get("id").and_then(Value::as_str).or_else(||if key=="items"{old.get("item_id").and_then(Value::as_str)}else{None})==Some(rid))
                    }else{!deleted_ids.contains(rid)}
                });
                for old in existing.get(key).and_then(Value::as_array).cloned().unwrap_or_default() {
                    if let Some(id) = old.get("id").and_then(Value::as_str).or_else(|| if key=="items" { old.get("item_id").and_then(Value::as_str) } else { None }) {
                        let pending_id=if key=="items"{format!("{}:{}",project_id,id)}else{id.to_string()};
                        if pending.contains(&format!("{pending_key}:{pending_id}")) {
                            if let Some(pos)=merged.iter().position(|v| v.get("id").and_then(Value::as_str).or_else(|| if key=="items" { v.get("item_id").and_then(Value::as_str) } else { None })==Some(id)) { merged[pos]=if key=="experiments"{pending_experiment_with_history(old,&merged[pos])}else{old}; } else { merged.push(old); }
                        }
                    }
                }
                if key=="experiments" {
                    // Reconcile child records after the pending parent overlay:
                    // editing experiment prose must not freeze independent rows.
                    for exp in &mut merged {
                        let eid=exp["id"].as_str().unwrap_or_default();
                        let Some(server)=project[key].as_array().and_then(|rows|rows.iter().find(|row|row["id"].as_str()==Some(eid))) else{continue;};
                        let old=existing[key].as_array().and_then(|rows|rows.iter().find(|row|row["id"].as_str()==Some(eid))).cloned().unwrap_or_else(||json!({}));
                        for (sub,entity,deleted) in [("measurements","project_experiment_measurement",&deleted_project_measurement_ids),("observation_records","project_experiment_observation",&deleted_project_observation_ids)]{
                            exp[sub]=Value::Array(merge_pending_relation_rows(server,&old,sub,entity,&pending,deleted));
                        }
                    }
                }
                project[key] = Value::Array(merged);
            }
            if let Some(pos)=projects.iter().position(|p| p.get("id").and_then(Value::as_str)==Some(project_id.as_str())) { projects[pos]=project; }
        } else {
            projects.push(project);
        }
    }
    for project in &mut projects{project_work_attachment_views(project);project_task_experiment_views(project);}
    save_checked(c, &projects, Vec::new(), Some(&expected_account_id), &refreshed_reservations)
}

fn nested_create_nested(app:AppHandle,project_id:String,parent_key:&str,key:&str,parent_id:String,mut record:Value,entity_type:&str)->Result<Value,String>{let mut c=conn(&app)?;let mut projects=load(&c)?;let p=projects.iter_mut().find(|p|p.get("id").and_then(Value::as_str)==Some(project_id.as_str())).ok_or("Project not found")?;let mut parents=nested_get(p,parent_key);let parent=parents.iter_mut().find(|x|x.get("id").and_then(Value::as_str)==Some(parent_id.as_str())).ok_or("Parent record not found")?;let rid=id();let ts=now(&c)?;record["id"]=json!(&rid);record["project_id"]=json!(&project_id);record["created_at"]=json!(&ts);record["updated_at"]=json!(&ts);let mut rows=nested_get(parent,key);rows.push(record.clone());parent[key]=Value::Array(rows);p[parent_key]=Value::Array(parents);p["updated_at"]=json!(&ts);save(&mut c,&projects,vec![(id(),entity_type.into(),rid,"create".into(),record.clone())])?;Ok(record)}
fn nested_delete_nested(app:AppHandle,project_id:String,parent_key:&str,key:&str,parent_id:String,record_id:String,entity_type:&str)->Result<(),String>{let mut c=conn(&app)?;let mut projects=load(&c)?;let p=projects.iter_mut().find(|p|p.get("id").and_then(Value::as_str)==Some(project_id.as_str())).ok_or("Project not found")?;let mut parents=nested_get(p,parent_key);let parent=parents.iter_mut().find(|x|x.get("id").and_then(Value::as_str)==Some(parent_id.as_str())).ok_or("Parent record not found")?;let mut rows=nested_get(parent,key);let before=rows.iter().find(|x|x.get("id").and_then(Value::as_str)==Some(record_id.as_str())).cloned().ok_or("Record not found")?;rows.retain(|x|x.get("id").and_then(Value::as_str)!=Some(record_id.as_str()));parent[key]=Value::Array(rows);p[parent_key]=Value::Array(parents);p["updated_at"]=json!(now(&c)?);save(&mut c,&projects,vec![(id(),entity_type.into(),record_id,"delete".into(),json!({"project_id":project_id,"record":before}))])}

#[tauri::command]
pub fn create_local_project_experiment_measurement(app:AppHandle,project_id:String,experiment_id:String,record:Value)->Result<Value,String>{let mut r=record;r["experiment_id"]=json!(experiment_id);nested_create_nested(app,project_id,"experiments","measurements",experiment_id,r,"project_experiment_measurement")}
#[tauri::command]
pub fn delete_local_project_experiment_measurement(app:AppHandle,project_id:String,experiment_id:String,record_id:String)->Result<(),String>{nested_delete_nested(app,project_id,"experiments","measurements",experiment_id,record_id,"project_experiment_measurement")}
#[tauri::command]
pub fn create_local_project_experiment_observation(app:AppHandle,project_id:String,experiment_id:String,record:Value)->Result<Value,String>{let mut r=record;r["experiment_id"]=json!(experiment_id);nested_create_nested(app,project_id,"experiments","observation_records",experiment_id,r,"project_experiment_observation")}
#[tauri::command]
pub fn delete_local_project_experiment_observation(app:AppHandle,project_id:String,experiment_id:String,record_id:String)->Result<(),String>{nested_delete_nested(app,project_id,"experiments","observation_records",experiment_id,record_id,"project_experiment_observation")}

#[cfg(test)]
mod access_tests {
    #[test]
    fn observation_projection_preserves_text_and_records_separately(){
        let mut p=serde_json::json!({"experiments":[{"id":"e","observations":[{"id":"o","content":"red"}],"observations_text":"Sample changed colour","observation_records":[{"id":"o","content":"red"}]}]});
        super::normalize_experiment_observations(&mut p);
        assert_eq!(p["experiments"][0]["observations"],"Sample changed colour");
        assert_eq!(p["experiments"][0]["observation_records"][0]["content"],"red");
        assert_eq!(p["experiments"][0]["observations_text_available"],true);
        p["experiments"][0]["observations"]=serde_json::json!("New offline narrative");
        super::normalize_experiment_observations(&mut p);
        assert_eq!(p["experiments"][0]["observations"],"New offline narrative");
    }

    #[test]
    fn legacy_observation_arrays_are_preserved_but_missing_prose_cannot_be_overwritten(){
        let original=serde_json::json!({"experiments":[{"id":"e","observations":[{"id":"o","content":"retained"}]}]});
        let mut p=original.clone();super::normalize_experiment_observations(&mut p);
        assert_eq!(p["experiments"][0]["observation_records"],original["experiments"][0]["observations"]);
        assert_eq!(p["experiments"][0]["observations_text_available"],false);
        assert!(super::require_experiment_observation_text(&p["experiments"][0]).is_err());
        assert!(super::require_experiment_observation_text(&serde_json::json!({"observations":[]})).is_err());
        assert!(super::require_experiment_observation_text(&serde_json::json!({"observations":""})).is_ok());
        super::normalize_experiment_observations(&mut p);
        assert_eq!(p["experiments"][0]["observations_text_available"],false);
    }
    use super::{access_for_user, readable_for_user, require_local_project_editor, validate_nested_references};
    use serde_json::json;

    #[test]
    fn lifecycle_intentions_do_not_release_stock_or_claim_settlement(){
        let original=json!({"status":"active","lifecycle_revision":2,"reservations":[{"status":"confirmed","quantity":3}],"inventory_settlement":{"state":"settled"}});
        for status in ["cancelled","completed","archived"] {
            let mut project=original.clone();
            super::prepare_lifecycle_patch(&mut project,&json!({"status":status,"expected_lifecycle_revision":2})).unwrap();
            assert_eq!(project["reservations"],original["reservations"]);
            assert_eq!(project["inventory_settlement"]["state"],"unknown");
            assert_eq!(project["local_lifecycle_pending"],true);assert_eq!(project["lifecycle_revision"],3);
        }
        for patch in [json!({"status":"archived","expected_lifecycle_revision":1}),json!({"status":"bogus"})] {
            let mut project=original.clone();assert!(super::prepare_lifecycle_patch(&mut project,&patch).is_err());assert_eq!(project,original);
        }
        let mut legacy=json!({"status":"active"});let before=legacy.clone();
        assert!(super::prepare_lifecycle_patch(&mut legacy,&json!({"status":"cancelled"})).is_err());assert_eq!(legacy,before);
    }

    #[test]
    fn canonical_requirement_references_are_shared_and_normalized() {
        let id="abcdef01-2345-6789-abcd-ef0123456789";
        let project=json!({"requirements":[{"id":id,"quantity":3}]});
        let before=project.clone();
        for key in ["tasks","experiments","bom"] {
            let mut record=json!({"requirement_id":"ABCDEF0123456789ABCDEF0123456789"});
            validate_nested_references(&project,key,&mut record).unwrap();
            assert_eq!(record["requirement_id"],id);
            assert!(validate_nested_references(&project,key,&mut json!({"requirement_id":null})).is_ok());
            assert!(validate_nested_references(&project,key,&mut json!({"requirement_id":"bad"})).is_err());
            assert!(validate_nested_references(&json!({"requirements":[]}),key,&mut record).is_err());
        }
        assert_eq!(project,before,"References do not multiply canonical demand");
    }

    #[test]
    fn work_links_and_canvas_endpoints_stay_in_the_project() {
        let a="10000000-0000-0000-0000-000000000001";
        let b="20000000-0000-0000-0000-000000000001";
        let project=json!({"tasks":[{"id":a}],"experiments":[{"id":b}],"blocks":[{"id":a},{"id":b}]});
        assert!(validate_nested_references(&project,"task_experiments",&mut json!({"task_id":a,"experiment_id":b})).is_ok());
        assert!(validate_nested_references(&project,"task_experiments",&mut json!({"task_id":b,"experiment_id":a})).is_err());
        assert!(validate_nested_references(&project,"connectors",&mut json!({"source_block_id":a,"target_block_id":b})).is_ok());
        assert!(validate_nested_references(&project,"connectors",&mut json!({"source_block_id":a,"target_block_id":a})).is_err());
        assert!(validate_nested_references(&project,"connectors",&mut json!({"source_block_id":a})).is_err());
    }

    #[test]
    fn cached_editor_access_is_bound_to_the_account() {
        let project = json!({"visibility":"restricted","permissions":{"user_id":"alice","access":"edit","can_edit":true}});
        assert!(readable_for_user(&project, "alice"));
        assert!(!readable_for_user(&project, "bob"));
        assert!(require_local_project_editor(&project, "alice").is_ok());
        assert!(require_local_project_editor(&project, "bob").is_err());
    }

    #[test]
    fn older_and_foreign_public_cache_entries_are_read_only() {
        let project = json!({"visibility":"lab","permissions":{"user_id":"alice","access":"edit","can_edit":true}});
        assert!(readable_for_user(&project, "bob"));
        assert_eq!(access_for_user(&project, "bob")["can_edit"], false);
        assert!(require_local_project_editor(&project, "bob").is_err());
        assert!(require_local_project_editor(&json!({"visibility":"lab"}), "alice").is_err());
    }
}
