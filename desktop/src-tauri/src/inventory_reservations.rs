//! Local allocation overlays are authored intent, never a replacement server snapshot.
//! Keep them through ACK: only a snapshot's fulfillment IDs prove it includes an issue.
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use crate::{inventory_sync_state::canonical_id, local_db, local_projects};
use super::custody::units;

fn id(value: &Value) -> Result<String, String> {
    canonical_id(value.as_str().ok_or("Reservation reference is missing")?)
}

pub(crate) fn overlays(c: &Connection) -> Result<Vec<Value>, String> {
    let prefix = local_db::scoped_state_key(c, "reservation_issue_")?;
    let mut stmt = c.prepare("SELECT value FROM sync_state WHERE substr(key,1,length(?1))=?1 ORDER BY key")
        .map_err(|e| e.to_string())?;
    let raw = stmt.query_map([prefix], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
    raw.map(|row| {
        serde_json::from_str(&row.map_err(|e| e.to_string())?).map_err(|e| e.to_string())
    }).collect()
}

fn remaining(reservation: &Value, pending: &[Value]) -> Result<(i64, i64), String> {
    let reservation_id = id(&reservation["id"])?;
    let included = reservation["fulfillment_movement_ids"].as_array()
        .ok_or("Synchronize an updated reservation snapshot before issuing stock")?
        .iter().map(id).collect::<Result<std::collections::HashSet<_>, _>>()?;
    let mut deduction = 0i64;
    for entry in pending {
        if id(&entry["reservation_id"])? != reservation_id { continue; }
        if entry["project_id"] != reservation["project_id"] || entry["item_id"] != reservation["item_id"] {
            return Err("Reservation identity changed; synchronize before issuing stock".into());
        }
        if !included.contains(&id(&entry["movement_id"])?) {
            deduction = deduction.checked_add(units(&entry["quantity"])?).ok_or("Reservation quantity overflow")?;
        }
    }
    let available = units(&reservation["quantity"])? - deduction;
    if available < 0 { return Err("Local issues exceed the refreshed reservation; reconcile pending stock work".into()); }
    Ok((available, deduction))
}

// Called inside the custody writer's immediate transaction. Normalize before
// creating both the custody record and its immutable outbox payload.
pub(super) fn prepare_issue(c: &Connection, intent: &mut Value, item: &str, change: &str) -> Result<Option<Value>, String> {
    if !intent["custody_id"].is_null() || intent["reservation_id"].is_null() { return Ok(None); }
    if intent["movement_type"] != "checkout" || intent["recipient_id"].as_str().is_none() {
        return Err("Reservation-backed issues require checkout with a recipient".into());
    }
    let project_id = id(&intent["project_id"])?;
    let reservation_id = id(&intent["reservation_id"])?;
    local_projects::require_cached_project_access(c, &project_id, true)?;
    let mut project = local_projects::load_all(c)?.into_iter().find(|p| p["id"] == project_id)
        .ok_or("Reservation project is not cached")?;
    crate::local_reservations::project(c,&mut project)?;
    if !matches!(project["status"].as_str(), Some("planning" | "active")) {
        return Err("Project is not open for stock issues".into());
    }
    let reservation = project["reservations"].as_array()
        .ok_or("Synchronize reservations before issuing reserved stock")?
        .iter().find(|r| r["id"] == reservation_id).ok_or("Reservation is not cached")?;
    if reservation["project_id"] != project_id || reservation["item_id"] != item {
        return Err("Reservation does not belong to this project and item".into());
    }
    if !reservation["local_pending_action"].is_null(){return Err("Reservation review is awaiting server reconciliation".into());}
    let (available, _) = remaining(reservation, &overlays(c)?)?;
    let quantity = units(&intent["quantity"])?;
    if reservation["status"] != "confirmed" || quantity == 0 || quantity > available {
        return Err("Issue exceeds the remaining confirmed reservation".into());
    }
    let mut requirement = if intent["requirement_id"].is_null() { None } else { Some(id(&intent["requirement_id"])?) };
    for (field, collection) in [("task_id", "tasks"), ("experiment_id", "experiments")] {
        if intent[field].is_null() { continue; }
        let work_id = id(&intent[field])?;
        let work = project[collection].as_array().and_then(|rows| rows.iter().find(|w| w["id"] == work_id))
            .ok_or("Issue work reference is not in this project")?;
        if work["project_id"] != project_id { return Err("Issue work belongs to another project".into()); }
        if !work["requirement_id"].is_null() {
            let linked = id(&work["requirement_id"])?;
            if requirement.as_ref().is_some_and(|r| r != &linked) {
                return Err("Issue task and experiment demand do not agree".into());
            }
            requirement = Some(linked);
        }
        intent[field] = json!(work_id);
    }
    if let Some(ref requirement_id) = requirement {
        if !project["requirements"].as_array().is_some_and(|rows| rows.iter().any(|r| r["id"] == *requirement_id && r["project_id"] == project_id)) {
            return Err("Issue requirement is not in this project".into());
        }
    }
    intent["project_id"] = json!(project_id);
    intent["reservation_id"] = json!(reservation_id);
    intent["requirement_id"] = json!(requirement);
    canonical_id(change)?;
    Ok(Some(json!({
        "change_id":change, "movement_id":id(&intent["id"])?,
        "project_id":project_id, "reservation_id":reservation_id, "item_id":item,
        "quantity":quantity as f64 / 1000.0
    })))
}

pub(super) fn record_issue(c: &Connection, entry: &Value) -> Result<(), String> {
    c.execute("INSERT INTO sync_state(key,value) VALUES(?1,?2)", params![
        local_db::scoped_state_key(c, &format!("reservation_issue_{}", id(&entry["change_id"])?))?,
        entry.to_string()
    ]).map_err(|e| e.to_string())?;
    Ok(())
}

// Read projection only. Never persist these derived quantities into projects_state.
pub(crate) fn project(c: &Connection, project: &mut Value) -> Result<(), String> {
    let pending = overlays(c)?;
    if let Some(rows) = project["reservations"].as_array_mut() {
        for row in rows {
            match remaining(row, &pending) {
                Ok((available, deduction)) => {
                    row["quantity"] = json!(available as f64 / 1000.0);
                    row["local_pending_issue_quantity"] = json!(deduction as f64 / 1000.0);
                    if deduction > 0 {
                        row["fulfilled_quantity"] = json!((units(&row["fulfilled_quantity"])? + deduction) as f64 / 1000.0);
                        if available == 0 && row["status"] == "confirmed" { row["status"] = json!("fulfilled"); }
                    }
                }
                Err(message) => { row["local_issue_error"] = json!(message); }
            }
        }
    }
    Ok(())
}

// Explicit conflict retirement is NOT a server ACK. The caller archives these
// exact entries before removing them, in its existing resolution transaction.
pub(crate) fn retire(c: &Connection, changes: &std::collections::HashSet<String>) -> Result<Vec<Value>, String> {
    let entries: Vec<_> = overlays(c)?.into_iter()
        .filter(|entry| entry["change_id"].as_str().is_some_and(|id| changes.contains(id))).collect();
    for entry in &entries {
        c.execute("DELETE FROM sync_state WHERE key=?1", [
            local_db::scoped_state_key(c, &format!("reservation_issue_{}", id(&entry["change_id"])?))?
        ]).map_err(|e| e.to_string())?;
    }
    Ok(entries)
}
