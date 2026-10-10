use rusqlite::{Connection, OptionalExtension};
use tauri::AppHandle;

use crate::local_db;

const CACHE_KEY: &str = "inventory_snapshot";

fn connection(app: &AppHandle) -> Result<Connection, String> {
    local_db::open_local_connection(app)
}

#[tauri::command]
pub fn get_local_inventory_snapshot(app: AppHandle) -> Result<Option<String>, String> {
    let conn = connection(&app)?;
    crate::local_auth::require_local_permission(&conn,"inventory.view")?;
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
    let incoming=crate::inventory_sync_state::decode(&snapshot_json)?;
    let mut conn = connection(&app)?;
    crate::inventory_sync_state::merge(&mut conn,&expected_account_id,incoming,vec![],None)
}
