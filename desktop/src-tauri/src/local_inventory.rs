use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use tauri::AppHandle;

use crate::local_db;
use crate::local_auth;

const MOVEMENT_SCHEMA_VERSION: &str = "004_local_inventory_movement_cache";

fn connection(app: &AppHandle) -> Result<Connection, String> {
    local_db::open_local_connection(app)
}

fn ensure_movement_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS local_inventory_movement_records (
            movement_id TEXT PRIMARY KEY,
            item_id TEXT NOT NULL,
            movement_json TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_local_inventory_movement_records_item
            ON local_inventory_movement_records(item_id, created_at);
        "#,
    )
    .map_err(|err| format!("Unable to initialize local inventory movement cache: {err}"))?;

    conn.execute(
        "INSERT OR IGNORE INTO local_schema_migrations(version) VALUES (?1)",
        [MOVEMENT_SCHEMA_VERSION],
    )
    .map_err(|err| format!("Unable to record local inventory movement schema version: {err}"))?;

    Ok(())
}

pub fn initialize(app: &AppHandle) -> Result<(), String> {
    let conn = connection(app)?;
    ensure_movement_schema(&conn)
}

#[derive(Debug, Deserialize)]
pub struct LocalMovementWriteInput {
    pub snapshot_json: String,
    pub movement_json: String,
    pub change_id: String,
    pub item_id: String,
}

#[tauri::command]
pub fn list_local_inventory_movements(
    app: AppHandle,
    item_id: String,
) -> Result<Option<Vec<String>>, String> {
    let conn = connection(&app)?;
    ensure_movement_schema(&conn)?;

    let mut stmt = conn
        .prepare(
            "SELECT movement_json
             FROM local_inventory_movement_records
             WHERE item_id=?1
             ORDER BY created_at DESC",
        )
        .map_err(|e| format!("Unable to prepare local movement query: {e}"))?;

    let rows = stmt
        .query_map([item_id], |row| row.get(0))
        .map_err(|e| format!("Unable to read local movements: {e}"))?;

    let values = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Unable to decode local movements: {e}"))?;

    Ok(if values.is_empty() { None } else { Some(values) })
}

#[tauri::command]
pub fn cache_local_inventory_movements(
    app: AppHandle,
    item_id: String,
    movements_json: String,
) -> Result<(), String> {
    if movements_json.trim().is_empty() {
        return Err("Local movement list cannot be empty".into());
    }

    let values: Vec<serde_json::Value> = serde_json::from_str(&movements_json)
        .map_err(|e| format!("Invalid movement list JSON: {e}"))?;

    let mut conn = connection(&app)?;
    ensure_movement_schema(&conn)?;
    local_auth::require_local_permission(&conn,"inventory.adjust_stock")?;

    let tx = conn
        .transaction()
        .map_err(|e| format!("Unable to begin movement cache transaction: {e}"))?;

    tx.execute(
        "DELETE FROM local_inventory_movement_records WHERE item_id=?1",
        [&item_id],
    )
    .map_err(|e| format!("Unable to replace movement cache: {e}"))?;

    for movement in values {
        let id = movement
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Movement id is required".to_string())?;

        tx.execute(
            "INSERT INTO local_inventory_movement_records(movement_id,item_id,movement_json)
             VALUES (?1,?2,?3)",
            params![id, &item_id, movement.to_string()],
        )
        .map_err(|e| format!("Unable to cache movement: {e}"))?;
    }

    tx.commit()
        .map_err(|e| format!("Unable to commit movement cache: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn save_local_inventory_movement(
    app: AppHandle,
    input: LocalMovementWriteInput,
) -> Result<(), String> {
    if input.snapshot_json.trim().is_empty() || input.movement_json.trim().is_empty() {
        return Err("Local movement data cannot be empty".into());
    }

    let snapshot: serde_json::Value = serde_json::from_str(&input.snapshot_json)
        .map_err(|e| format!("Invalid inventory snapshot JSON: {e}"))?;

    if !snapshot.is_array() {
        return Err("Inventory snapshot must be an array".into());
    }

    let movement: serde_json::Value = serde_json::from_str(&input.movement_json)
        .map_err(|e| format!("Invalid movement JSON: {e}"))?;

    let id = movement
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Movement id is required".to_string())?
        .to_string();

    let movement_item_id = movement
        .get("item_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Movement item id is required".to_string())?;

    if movement_item_id != input.item_id {
        return Err("Movement item id does not match the target item".into());
    }

    let mut conn = connection(&app)?;
    ensure_movement_schema(&conn)?;

    let tx = conn
        .transaction()
        .map_err(|e| format!("Unable to begin local movement transaction: {e}"))?;

    tx.execute(
        "INSERT INTO sync_state(key,value)
         VALUES ('inventory_snapshot',?1)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [&input.snapshot_json],
    )
    .map_err(|e| format!("Unable to save inventory snapshot: {e}"))?;

    tx.execute(
        "INSERT OR REPLACE INTO local_inventory_movement_records
         (movement_id,item_id,movement_json)
         VALUES (?1,?2,?3)",
        params![id, &input.item_id, &input.movement_json],
    )
    .map_err(|e| format!("Unable to save local movement: {e}"))?;

    let device: String = tx
        .query_row("SELECT device_id FROM device_identity WHERE id=1", [], |r| r.get(0))
        .map_err(|e| format!("Unable to read device identity: {e}"))?;

    tx.execute(
        "INSERT INTO sync_outbox
         (change_id,device_id,entity_type,entity_id,operation,payload_json)
         VALUES (?1,?2,'item_movement',?3,'create',?4)",
        params![input.change_id, device, &input.item_id, &input.movement_json],
    )
    .map_err(|e| format!("Unable to queue movement for sync: {e}"))?;

    tx.commit()
        .map_err(|e| format!("Unable to commit local movement transaction: {e}"))?;

    Ok(())
}
