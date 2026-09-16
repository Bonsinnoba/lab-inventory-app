use rusqlite::{params, Connection};
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
        [CACHE_KEY],
        |row| row.get(0),
    )
    .optional()
    .map_err(|err| format!("Unable to read local inventory snapshot: {err}"))
}

#[tauri::command]
pub fn cache_local_inventory_snapshot(app: AppHandle, snapshot_json: String) -> Result<(), String> {
    if snapshot_json.trim().is_empty() {
        return Err("Inventory snapshot cannot be empty".to_string());
    }
    serde_json::from_str::<serde_json::Value>(&snapshot_json)
        .map_err(|err| format!("Invalid inventory snapshot JSON: {err}"))?;

    let conn = connection(&app)?;
    conn.execute(
        "INSERT INTO sync_state(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![CACHE_KEY, snapshot_json],
    )
    .map_err(|err| format!("Unable to cache local inventory snapshot: {err}"))?;
    Ok(())
}

trait OptionalRow<T> {
    fn optional(self) -> Result<Option<T>, rusqlite::Error>;
}

impl<T, F> OptionalRow<T> for Result<T, rusqlite::Error>
where
    F: FnOnce(&rusqlite::Row<'_>) -> Result<T, rusqlite::Error>,
{
    fn optional(self) -> Result<Option<T>, rusqlite::Error> {
        match self {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(err) => Err(err),
        }
    }
}
