use rusqlite::{params, Connection, OptionalExtension};
use tauri::AppHandle;

use crate::local_db;

const CACHE_KEY: &str = "inventory_snapshot";

fn connection(app: &AppHandle) -> Result<Connection, String> {
    local_db::open_local_connection(app)
}

#[tauri::command]
pub fn get_local_inventory_snapshot(app: AppHandle) -> Result<Option<String>, String> {
    let conn = connection(&app)?;
    conn.query_row(
        "SELECT value FROM sync_state WHERE key = ?1",
        [local_db::scoped_state_key(&conn, CACHE_KEY)?],
        |row| row.get(0),
    )
    .optional()
    .map_err(|err| format!("Unable to read local inventory snapshot: {err}"))
}

#[tauri::command]
pub fn cache_local_inventory_snapshot(app: AppHandle, snapshot_json: String, expected_account_id: String) -> Result<(), String> {
    if snapshot_json.trim().is_empty() {
        return Err("Inventory snapshot cannot be empty".to_string());
    }
    serde_json::from_str::<serde_json::Value>(&snapshot_json)
        .map_err(|err| format!("Invalid inventory snapshot JSON: {err}"))?;

    let mut conn = connection(&app)?;
    let tx=conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e|format!("Unable to begin inventory cache update: {e}"))?;
    local_db::require_sync_account(&tx,&expected_account_id)?;
    tx.execute(
        "INSERT INTO sync_state(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![local_db::scoped_state_key(&tx, CACHE_KEY)?, snapshot_json],
    )
    .map_err(|err| format!("Unable to cache local inventory snapshot: {err}"))?;
    tx.commit().map_err(|e|format!("Unable to commit inventory cache update: {e}"))
}
