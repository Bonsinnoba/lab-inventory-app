use rusqlite::OptionalExtension;
use serde_json::json;
use tauri::AppHandle;

use crate::local_db::open_local_connection;

const KEY: &str = "daily_use_preferences";

fn read_preferences(app: &AppHandle) -> Result<serde_json::Value, String> {
    let conn = open_local_connection(app)?;
    let raw: Option<String> = conn
        .query_row("SELECT value FROM sync_state WHERE key=?1", [KEY], |row| row.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(raw
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_else(|| {
            json!({
                "notifications_enabled": true,
                "auto_pause_music": false,
                "music_volume": 0.7,
                "updated_at": null
            })
        }))
}

fn write_preferences(app: &AppHandle, value: &serde_json::Value) -> Result<serde_json::Value, String> {
    let conn = open_local_connection(app)?;
    conn.execute(
        "INSERT INTO sync_state(key,value) VALUES(?1,?2)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [KEY, &serde_json::to_string(value).map_err(|e| e.to_string())?],
    )
    .map_err(|e| e.to_string())?;
    Ok(value.clone())
}

#[tauri::command]
pub fn get_local_daily_use_preferences(app: AppHandle) -> Result<serde_json::Value, String> {
    read_preferences(&app)
}

#[tauri::command]
pub fn update_local_daily_use_preferences(
    app: AppHandle,
    preferences: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut current = read_preferences(&app)?;
    let target = current
        .as_object_mut()
        .ok_or("stored preferences must be an object")?;
    let incoming = preferences
        .as_object()
        .ok_or("preferences must be an object")?;

    if let Some(value) = incoming.get("notifications_enabled") {
        if !value.is_boolean() { return Err("notifications_enabled must be boolean".into()); }
        target.insert("notifications_enabled".into(), value.clone());
    }
    if let Some(value) = incoming.get("auto_pause_music") {
        if !value.is_boolean() { return Err("auto_pause_music must be boolean".into()); }
        target.insert("auto_pause_music".into(), value.clone());
    }
    if let Some(value) = incoming.get("music_volume") {
        let volume = value.as_f64().ok_or("music_volume must be numeric")?;
        if !(0.0..=1.0).contains(&volume) { return Err("music_volume must be between 0 and 1".into()); }
        target.insert("music_volume".into(), json!(volume));
    }

    target.insert(
        "updated_at".into(),
        json!(std::time::SystemTime::now()\n            .duration_since(std::time::UNIX_EPOCH)\n            .map_err(|e| e.to_string())?\n            .as_secs()\n            .to_string()),
    );
    write_preferences(&app, &current)
}
