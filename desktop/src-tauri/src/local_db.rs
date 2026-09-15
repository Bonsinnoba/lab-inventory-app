use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::{api::path::app_data_dir, AppHandle};

const DB_FILE: &str = "labos-local.db";
const LOCAL_SCHEMA_VERSION: &str = "001_offline_foundation";

#[derive(Debug, Serialize)]
pub struct LocalDatabaseStatus {
    pub path: String,
    pub device_id: String,
    pub schema_version: String,
    pub pending_sync_count: i64,
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_dir(&app.config())
        .ok_or_else(|| "Unable to resolve LabOS app-data directory".to_string())?;
    fs::create_dir_all(&dir)
        .map_err(|err| format!("Unable to create local data directory: {err}"))?;
    Ok(dir.join(DB_FILE))
}

fn open_connection(app: &AppHandle) -> Result<(Connection, PathBuf), String> {
    let path = database_path(app)?;
    let connection = Connection::open(&path)
        .map_err(|err| format!("Unable to open local SQLite database: {err}"))?;

    connection
        .pragma_update(None, "foreign_keys", true)
        .map_err(|err| format!("Unable to enable SQLite foreign keys: {err}"))?;
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|err| format!("Unable to enable SQLite WAL mode: {err}"))?;
    connection
        .pragma_update(None, "synchronous", "NORMAL")
        .map_err(|err| format!("Unable to configure SQLite synchronous mode: {err}"))?;

    Ok((connection, path))
}

fn ensure_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS local_schema_migrations (
                version TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS device_identity (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                device_id TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS sync_state (
                key TEXT PRIMARY KEY,
                value TEXT
            );

            CREATE TABLE IF NOT EXISTS sync_outbox (
                change_id TEXT PRIMARY KEY,
                device_id TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id TEXT,
                operation TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                attempt_count INTEGER NOT NULL DEFAULT 0,
                last_attempt_at TEXT,
                last_error TEXT,
                synced_at TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_sync_outbox_pending
                ON sync_outbox(synced_at, created_at);
            CREATE INDEX IF NOT EXISTS idx_sync_outbox_entity
                ON sync_outbox(entity_type, entity_id, created_at);
            "#,
        )
        .map_err(|err| format!("Unable to initialize local SQLite schema: {err}"))?;

    let applied: Option<String> = connection
        .query_row(
            "SELECT version FROM local_schema_migrations WHERE version = ?1",
            [LOCAL_SCHEMA_VERSION],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| format!("Unable to inspect local schema version: {err}"))?;

    if applied.is_none() {
        connection
            .execute(
                "INSERT INTO local_schema_migrations(version) VALUES (?1)",
                [LOCAL_SCHEMA_VERSION],
            )
            .map_err(|err| format!("Unable to record local schema version: {err}"))?;
    }

    connection
        .execute(
            "INSERT OR IGNORE INTO device_identity(id, device_id) VALUES (1, lower(hex(randomblob(16))))",
            [],
        )
        .map_err(|err| format!("Unable to initialize device identity: {err}"))?;

    Ok(())
}

pub fn initialize(app: &AppHandle) -> Result<(), String> {
    let (connection, _) = open_connection(app)?;
    ensure_schema(&connection)
}

#[tauri::command]
pub fn local_database_status(app: AppHandle) -> Result<LocalDatabaseStatus, String> {
    let (connection, path) = open_connection(&app)?;
    ensure_schema(&connection)?;

    let device_id: String = connection
        .query_row("SELECT device_id FROM device_identity WHERE id = 1", [], |row| row.get(0))
        .map_err(|err| format!("Unable to read device identity: {err}"))?;

    let pending_sync_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sync_outbox WHERE synced_at IS NULL",
            [],
            |row| row.get(0),
        )
        .map_err(|err| format!("Unable to read sync queue state: {err}"))?;

    Ok(LocalDatabaseStatus {
        path: path.to_string_lossy().into_owned(),
        device_id,
        schema_version: LOCAL_SCHEMA_VERSION.to_string(),
        pending_sync_count,
    })
}
