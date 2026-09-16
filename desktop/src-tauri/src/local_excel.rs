use rusqlite::{params, Connection};
use serde_json::Value;
use std::collections::HashSet;
use tauri::AppHandle;

use crate::local_db;

fn connection(app: &AppHandle) -> Result<Connection, String> {
    local_db::open_local_connection(app)
}

#[tauri::command]
pub fn import_local_inventory_rows(app: AppHandle, rows_json: String) -> Result<Value, String> {
    if rows_json.trim().is_empty() {
        return Err("Inventory import data cannot be empty".into());
    }
    let rows: Vec<Value> = serde_json::from_str(&rows_json)
        .map_err(|e| format!("Invalid inventory import JSON: {e}"))?;
    if rows.is_empty() {
        return Ok(serde_json::json!({"imported": 0, "created": 0, "updated": 0}));
    }

    let mut conn = connection(&app)?;
    let tx = conn.transaction().map_err(|e| format!("Unable to begin inventory import transaction: {e}"))?;
    let snapshot_text: String = tx
        .query_row("SELECT value FROM sync_state WHERE key='inventory_snapshot'", [], |r| r.get(0))
        .map_err(|_| "A local inventory snapshot is required before importing Excel data".to_string())?;
    let mut snapshot: Vec<Value> = serde_json::from_str(&snapshot_text)
        .map_err(|e| format!("Unable to decode local inventory snapshot: {e}"))?;
    let device: String = tx
        .query_row("SELECT device_id FROM device_identity WHERE id=1", [], |r| r.get(0))
        .map_err(|e| format!("Unable to read device identity: {e}"))?;

    let mut seen = HashSet::new();
    let mut created = 0usize;
    let mut updated = 0usize;

    for row in rows {
        let supplied_id = row.get("id").and_then(Value::as_str).map(str::to_owned);
        let item_id = match supplied_id.clone() {
            Some(id) => id,
            None => tx.query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get::<_, String>(0))
                .map_err(|e| format!("Unable to generate local item id: {e}"))?,
        };
        if !seen.insert(item_id.clone()) {
            return Err(format!("Duplicate LabOS ID in workbook: {item_id}"));
        }

        let mut next = row.clone();
        next["id"] = Value::String(item_id.clone());

        if supplied_id.is_some() {
            let index = snapshot
                .iter()
                .position(|item| item.get("id").and_then(Value::as_str) == Some(item_id.as_str()))
                .ok_or_else(|| format!("LabOS ID \"{item_id}\" does not exist in local inventory"))?;
            if next.get("created_at").is_none() || next.get("created_at") == Some(&Value::Null) {
                next["created_at"] = snapshot[index].get("created_at").cloned().unwrap_or(Value::Null);
            }
            if next.get("updated_at").is_none() || next.get("updated_at") == Some(&Value::Null) {
                next["updated_at"] = Value::String(js_timestamp());
            }
            snapshot[index] = next.clone();
            let payload = serde_json::json!({"id": item_id, "patch": next, "item": snapshot[index]});
            let change_id: String = tx.query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))
                .map_err(|e| format!("Unable to create sync change id: {e}"))?;
            tx.execute(
                "INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES (?1,?2,'item',?3,'update',?4)",
                params![change_id, device, item_id, payload.to_string()],
            ).map_err(|e| format!("Unable to queue inventory update: {e}"))?;
            updated += 1;
        } else {
            let now = js_timestamp();
            next["created_at"] = Value::String(now.clone());
            next["updated_at"] = Value::String(now);
            snapshot.push(next.clone());
            let change_id: String = tx.query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))
                .map_err(|e| format!("Unable to create sync change id: {e}"))?;
            tx.execute(
                "INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES (?1,?2,'item',?3,'create',?4)",
                params![change_id, device, item_id, next.to_string()],
            ).map_err(|e| format!("Unable to queue inventory creation: {e}"))?;
            created += 1;
        }
    }

    let snapshot_json = serde_json::to_string(&snapshot)
        .map_err(|e| format!("Unable to encode inventory snapshot: {e}"))?;
    tx.execute(
        "INSERT INTO sync_state(key,value) VALUES ('inventory_snapshot',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [&snapshot_json],
    ).map_err(|e| format!("Unable to save imported inventory snapshot: {e}"))?;
    tx.commit().map_err(|e| format!("Unable to commit inventory import: {e}"))?;

    Ok(serde_json::json!({
        "imported": created + updated,
        "created": created,
        "updated": updated
    }))
}

fn js_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{}Z", millis)
}
