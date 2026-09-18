use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};
use tauri::AppHandle;
use crate::local_db;

const LOCAL_TYPES: [&str; 8] = ["items","projects","notes","resources","tasks","experiments","findings","transactions"];

fn load_state(conn: &Connection, key: &str) -> Result<Value, String> {
    let raw: Option<String> = conn.query_row("SELECT value FROM sync_state WHERE key=?1", [key], |r| r.get(0))
        .optional().map_err(|e| format!("Unable to read local search state: {e}"))?;
    Ok(raw.map(|v| serde_json::from_str(&v).unwrap_or(Value::Null)).unwrap_or(Value::Null))
}

fn text_matches(value: &Value, query: &str) -> bool {
    serde_json::to_string(value).unwrap_or_default().to_lowercase().contains(query)
}

fn decorate(kind: &str, value: &Value) -> Value {
    match kind {
        "items" => json!({"id":value.get("id"),"type":"item","title":value.get("name").cloned().unwrap_or(json!("Item")),"subtitle":format!("{} - {}",value.get("type").and_then(Value::as_str).unwrap_or("Item"),value.get("status").and_then(Value::as_str).unwrap_or("unknown")),"rank":1.0,"data":value}),
        "projects" => json!({"id":value.get("id"),"type":"project","title":value.get("name").cloned().unwrap_or(json!("Project")),"subtitle":value.get("status").cloned().unwrap_or(json!("No status")),"rank":1.0,"data":value}),
        "notes" => json!({"id":value.get("id"),"type":"note","title":value.get("title").cloned().unwrap_or(json!("Note")),"subtitle":value.get("tags").and_then(Value::as_array).map(|a|a.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(", ")).unwrap_or_else(||"No tags".into()),"rank":1.0,"data":value}),
        "resources" => json!({"id":value.get("id"),"type":"resource","title":value.get("name").cloned().unwrap_or(json!("Resource")),"subtitle":[value.get("category").and_then(Value::as_str),value.get("kind").and_then(Value::as_str),value.get("file_type").and_then(Value::as_str)].into_iter().flatten().collect::<Vec<_>>().join(" - "),"rank":1.0,"data":value}),
        "tasks" => json!({"id":value.get("id"),"type":"task","title":value.get("title").cloned().unwrap_or(json!("Task")),"subtitle":format!("{} · {}",value.get("project_name").and_then(Value::as_str).unwrap_or("Project"),value.get("status").and_then(Value::as_str).unwrap_or("todo")),"rank":1.0,"data":value}),
        "experiments" => json!({"id":value.get("id"),"type":"experiment","title":value.get("title").cloned().unwrap_or(json!("Experiment")),"subtitle":format!("{} · {}",value.get("project_name").and_then(Value::as_str).unwrap_or("Project"),value.get("status").and_then(Value::as_str).unwrap_or("planned")),"rank":1.0,"data":value}),
        "findings" => json!({"id":value.get("id"),"type":"finding","title":value.get("title").cloned().unwrap_or(json!("Finding")),"subtitle":value.get("status").cloned().unwrap_or(json!("draft")),"rank":1.0,"data":value}),
        "transactions" => json!({"id":value.get("id"),"type":"transaction","title":value.get("description").or_else(||value.get("reference")).cloned().unwrap_or(json!("Transaction")),"subtitle":format!("{} · {}",value.get("type").and_then(Value::as_str).unwrap_or("transaction"),value.get("amount").map(|v|v.to_string()).unwrap_or_default()),"rank":1.0,"data":value}),
        _ => json!({"id":value.get("id"),"type":kind,"title":value.get("name").or_else(||value.get("title")).cloned().unwrap_or(json!("Result")),"subtitle":"","rank":1.0,"data":value}),
    }
}

fn push_matches(out: &mut Vec<Value>, kind: &str, values: Vec<Value>, q: &str) {
    for value in values { if text_matches(&value, q) { out.push(decorate(kind, &value)); } }
}

#[tauri::command]
pub fn global_local_search(app: AppHandle, query: String, types: Option<Vec<String>>) -> Result<Value, String> {
    let q = query.trim().to_lowercase();
    if q.is_empty() { return Err("Search query is required".into()); }
    if q.len() > 200 { return Err("Search query is too long".into()); }
    let conn = local_db::open_local_connection(&app)?;
    let requested = types.unwrap_or_else(|| LOCAL_TYPES.iter().map(|v| (*v).to_string()).collect());
    let mut results = Vec::new();

    if requested.iter().any(|t| t == "items") {
        if let Some(values) = load_state(&conn, "inventory_snapshot")?.as_array().cloned() { push_matches(&mut results, "items", values, &q); }
    }
    if requested.iter().any(|t| t == "projects" || t == "tasks" || t == "experiments") {
        if let Some(projects) = load_state(&conn, "projects_state")?.as_array().cloned() {
            if requested.iter().any(|t| t == "projects") { push_matches(&mut results, "projects", projects.clone(), &q); }
            for project in projects {
                let project_name = project.get("name").and_then(Value::as_str).unwrap_or("Project");
                for (key, kind) in [("tasks","tasks"),("experiments","experiments")] {
                    if !requested.iter().any(|t| t == kind) { continue; }
                    let values = project.get(key).and_then(Value::as_array).cloned().unwrap_or_default().into_iter().map(|mut v| {
                        if let Value::Object(ref mut o)=v { o.insert("project_name".into(), json!(project_name)); }
                        v
                    }).collect();
                    push_matches(&mut results, kind, values, &q);
                }
            }
        }
    }
    if requested.iter().any(|t| t == "notes") {
        if let Some(values) = load_state(&conn, "notes_state")?.as_array().cloned() { push_matches(&mut results, "notes", values, &q); }
    }
    if requested.iter().any(|t| t == "resources") {
        if let Some(values) = load_state(&conn, "resources_state")?.as_array().cloned() { push_matches(&mut results, "resources", values, &q); }
    }
    if requested.iter().any(|t| t == "transactions") {
        if let Some(values) = load_state(&conn, "transactions_state")?.as_array().cloned() { push_matches(&mut results, "transactions", values, &q); }
    }
    if requested.iter().any(|t| t == "findings") {
        if let Some(state) = load_state(&conn, "knowledge_state")?.as_object().cloned() {
            if let Some(values) = state.get("findings").and_then(Value::as_array).cloned() { push_matches(&mut results, "findings", values, &q); }
        }
    }
    results.sort_by(|a,b| a.get("title").and_then(Value::as_str).unwrap_or("").to_lowercase().cmp(&b.get("title").and_then(Value::as_str).unwrap_or("").to_lowercase()));
    let mut counts=serde_json::Map::new();
    for result in &results {
        if let Some(kind)=result.get("type").and_then(Value::as_str) {
            let key=match kind {"item"=>"items","project"=>"projects","note"=>"notes","resource"=>"resources","task"=>"tasks","experiment"=>"experiments","finding"=>"findings","transaction"=>"transactions",_=>kind};
            let n=counts.entry(key.to_string()).or_insert(json!(0)); *n=json!(n.as_i64().unwrap_or(0)+1);
        }
    }
    Ok(json!({"query":query.trim(),"counts":counts,"total":results.len(),"all":results}))
}
