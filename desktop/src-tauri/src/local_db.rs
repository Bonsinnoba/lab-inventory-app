use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use tauri::{api::path::app_data_dir, AppHandle};

const DB_FILE: &str = "labos-local.db";
const LOCAL_SCHEMA_VERSION: &str = "004_account_scoped_state";

const ACTIVE_ACCOUNT_SQL: &str = "SELECT u.central_user_id FROM local_users u JOIN local_session s ON s.user_id=u.id WHERE s.id=1 AND u.is_active=1 AND u.central_user_id IS NOT NULL AND u.offline_expires_at IS NOT NULL AND datetime('now') < datetime(u.offline_expires_at)";

pub(crate) fn active_account(connection: &Connection) -> Result<String, String> {
    connection.query_row(ACTIVE_ACCOUNT_SQL, [], |row| row.get(0))
        .optional().map_err(|e| format!("Unable to read active local account: {e}"))?
        .ok_or_else(|| "No authorized local account is active. Sign in again before syncing.".to_string())
}

pub fn scoped_state_key(connection: &Connection, key: &str) -> Result<String, String> {
    if key.is_empty() || key.contains(':') { return Err("Invalid local state key".into()); }
    Ok(format!("account:{}:{key}", active_account(connection)?))
}

pub fn require_sync_account(connection: &Connection, expected_account_id: &str) -> Result<(), String> {
    if active_account(connection)? != expected_account_id {
        return Err("Account changed during sync; retry under the active account".into());
    }
    Ok(())
}

fn require_owned_change(connection: &Connection, change_id: &str) -> Result<String, String> {
    let account = active_account(connection)?;
    let owned: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sync_outbox WHERE change_id=?1 AND account_id=?2)",
        params![change_id, account], |row| row.get(0),
    ).map_err(|e| format!("Unable to inspect sync change ownership: {e}"))?;
    if !owned { return Err("Sync change does not belong to the active account".into()); }
    Ok(account)
}

pub fn new_uuid() -> String { uuid::Uuid::new_v4().to_string() }

pub(crate) fn retain_authorized_snapshot(rows:&mut Vec<Value>,incoming:&[Value],pending:&HashSet<String>){
    let visible:HashSet<&str>=incoming.iter().filter_map(|row|row["id"].as_str()).collect();
    rows.retain(|row|row["id"].as_str().map(|id|visible.contains(id)||pending.contains(id)).unwrap_or(false));
}

pub fn canonical_uuid(value: &str) -> String {
    uuid::Uuid::parse_str(value).map(|id| id.to_string()).unwrap_or_else(|_| value.to_string())
}

fn canonicalize_json_ids(value: &mut Value) {
    match value {
        Value::Object(object) => {
            for (key, entry) in object.iter_mut() {
                if (key == "id" || key.ends_with("_id")) && entry.as_str().is_some() {
                    let current = entry.as_str().unwrap_or_default();
                    *entry = Value::String(canonical_uuid(current));
                } else {
                    canonicalize_json_ids(entry);
                }
            }
        }
        Value::Array(values) => values.iter_mut().for_each(canonicalize_json_ids),
        _ => {}
    }
}

fn canonicalize_legacy_ids(connection: &Connection) -> Result<(), String> {
    let tx = connection.unchecked_transaction().map_err(|e| format!("Unable to begin local UUID canonicalization: {e}"))?;
    let states: Vec<(String, String)> = {
        let mut statement = tx.prepare("SELECT key,value FROM sync_state").map_err(|e| format!("Unable to inspect local state for UUID canonicalization: {e}"))?;
        let rows = statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| format!("Unable to read local state for UUID canonicalization: {e}"))?
            .collect::<Result<Vec<_>, _>>().map_err(|e| format!("Unable to decode local state for UUID canonicalization: {e}"))?;
        rows
    };
    for (key, raw) in states {
        let Ok(mut value) = serde_json::from_str::<Value>(&raw) else { continue; };
        canonicalize_json_ids(&mut value);
        let normalized = serde_json::to_string(&value).map_err(|e| format!("Unable to encode canonical local state: {e}"))?;
        if normalized != raw { tx.execute("UPDATE sync_state SET value=?2 WHERE key=?1", params![key, normalized]).map_err(|e| format!("Unable to update canonical local state: {e}"))?; }
    }
    let outbox: Vec<(String, Option<String>, String)> = {
        let mut statement = tx.prepare("SELECT change_id,entity_id,payload_json FROM sync_outbox WHERE synced_at IS NULL").map_err(|e| format!("Unable to inspect pending sync changes for UUID canonicalization: {e}"))?;
        let rows = statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .map_err(|e| format!("Unable to read pending sync changes for UUID canonicalization: {e}"))?
            .collect::<Result<Vec<_>, _>>().map_err(|e| format!("Unable to decode pending sync changes for UUID canonicalization: {e}"))?;
        rows
    };
    for (change_id, entity_id, raw) in outbox {
        let normalized_entity_id = entity_id.as_deref().map(canonical_uuid);
        let normalized_payload = serde_json::from_str::<Value>(&raw).ok().map(|mut value| { canonicalize_json_ids(&mut value); serde_json::to_string(&value) }).transpose().map_err(|e| format!("Unable to encode canonical sync payload: {e}"))?.unwrap_or(raw.clone());
        if normalized_entity_id != entity_id || normalized_payload != raw {
            tx.execute("UPDATE sync_outbox SET entity_id=?2,payload_json=?3 WHERE change_id=?1", params![change_id, normalized_entity_id, normalized_payload]).map_err(|e| format!("Unable to update canonical sync change: {e}"))?;
        }
    }
    tx.commit().map_err(|e| format!("Unable to commit local UUID canonicalization: {e}"))
}

#[derive(Debug, Serialize)]
pub struct LocalDatabaseStatus { pub path: String, pub device_id: String, pub schema_version: String, pub pending_sync_count: i64, pub sync_conflict_count: i64, pub unassigned_pending_sync_count: i64, pub unassigned_state_count: i64 }
#[derive(Debug, Deserialize)]
pub struct LocalSyncWriteInput { pub snapshot_json: String, pub change_id: String, pub entity_type: String, pub entity_id: Option<String>, pub operation: String, pub payload_json: String, pub state_key: Option<String>, pub state_json: Option<String> }
fn database_path(app: &AppHandle) -> Result<PathBuf, String> { let dir=app_data_dir(&app.config()).ok_or_else(|| "Unable to resolve LabOS app-data directory".to_string())?; fs::create_dir_all(&dir).map_err(|e| format!("Unable to create local data directory: {e}"))?; Ok(dir.join(DB_FILE)) }
pub fn open_local_connection(app: &AppHandle) -> Result<Connection, String> { let path=database_path(app)?; let connection=Connection::open(&path).map_err(|e| format!("Unable to open local SQLite database: {e}"))?; connection.pragma_update(None,"foreign_keys",true).map_err(|e| format!("Unable to enable SQLite foreign keys: {e}"))?; connection.pragma_update(None,"journal_mode","WAL").map_err(|e| format!("Unable to enable SQLite WAL mode: {e}"))?; connection.pragma_update(None,"synchronous","NORMAL").map_err(|e| format!("Unable to configure SQLite synchronous mode: {e}"))?; crate::local_auth::enforce_offline_lease_bounds(&connection)?; Ok(connection) }
fn open_connection(app:&AppHandle)->Result<(Connection,PathBuf),String>{let path=database_path(app)?;Ok((open_local_connection(app)?,path))}
pub(crate) fn ensure_schema(connection:&Connection)->Result<(),String>{connection.execute_batch(r#"
CREATE TABLE IF NOT EXISTS local_schema_migrations(version TEXT PRIMARY KEY,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS device_identity(id INTEGER PRIMARY KEY CHECK(id=1),device_id TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sync_state(key TEXT PRIMARY KEY,value TEXT);
CREATE TABLE IF NOT EXISTS sync_outbox(change_id TEXT PRIMARY KEY,device_id TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT,operation TEXT NOT NULL,payload_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,attempt_count INTEGER NOT NULL DEFAULT 0,last_attempt_at TEXT,last_error TEXT,synced_at TEXT);
CREATE INDEX IF NOT EXISTS idx_sync_outbox_pending ON sync_outbox(synced_at,created_at);
CREATE INDEX IF NOT EXISTS idx_sync_outbox_entity ON sync_outbox(entity_type,entity_id,created_at);
CREATE TABLE IF NOT EXISTS sync_conflicts(id INTEGER PRIMARY KEY AUTOINCREMENT,change_id TEXT NOT NULL UNIQUE,entity_type TEXT NOT NULL,entity_id TEXT,operation TEXT NOT NULL,payload_json TEXT NOT NULL,error_code TEXT NOT NULL,error_message TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,resolved_at TEXT,resolution TEXT);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_open ON sync_conflicts(resolved_at,created_at);
"#).map_err(|e|format!("Unable to initialize local SQLite schema: {e}"))?;
    let has_account_id = connection.prepare("PRAGMA table_info(sync_outbox)")
        .map_err(|e| format!("Unable to inspect sync outbox schema: {e}"))?
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("Unable to read sync outbox schema: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Unable to decode sync outbox schema: {e}"))?
        .iter().any(|column| column == "account_id");
    if !has_account_id {
        // Legacy rows remain unassigned. Guessing an owner could upload private data
        // to the wrong account after a multi-user desktop has changed hands.
        connection.execute("ALTER TABLE sync_outbox ADD COLUMN account_id TEXT", [])
            .map_err(|e| format!("Unable to migrate sync outbox account ownership: {e}"))?;
    }
    connection.execute_batch(r#"
CREATE INDEX IF NOT EXISTS idx_sync_outbox_account_pending ON sync_outbox(account_id,synced_at,created_at);
CREATE VIEW IF NOT EXISTS active_sync_outbox AS
  SELECT o.* FROM sync_outbox o JOIN local_users u ON u.central_user_id=o.account_id
  JOIN local_session s ON s.user_id=u.id WHERE s.id=1 AND u.is_active=1
  AND u.offline_expires_at IS NOT NULL AND datetime('now') < datetime(u.offline_expires_at);
CREATE TRIGGER IF NOT EXISTS sync_outbox_require_account BEFORE INSERT ON sync_outbox BEGIN
  SELECT CASE WHEN (SELECT u.central_user_id FROM local_users u JOIN local_session s ON s.user_id=u.id
    WHERE s.id=1 AND u.is_active=1 AND u.central_user_id IS NOT NULL
    AND u.offline_expires_at IS NOT NULL AND datetime('now') < datetime(u.offline_expires_at)) IS NULL
    THEN RAISE(ABORT,'No authorized local account is active for this sync change') END;
END;
CREATE TRIGGER IF NOT EXISTS sync_outbox_stamp_account AFTER INSERT ON sync_outbox BEGIN
  UPDATE sync_outbox SET account_id=(SELECT u.central_user_id FROM local_users u JOIN local_session s ON s.user_id=u.id
    WHERE s.id=1 AND u.is_active=1 AND u.central_user_id IS NOT NULL
    AND u.offline_expires_at IS NOT NULL AND datetime('now') < datetime(u.offline_expires_at))
  WHERE change_id=NEW.change_id;
END;
"#).map_err(|e|format!("Unable to initialize account-scoped sync outbox: {e}"))?;
    let applied:Option<String>=connection.query_row("SELECT version FROM local_schema_migrations WHERE version=?1",[LOCAL_SCHEMA_VERSION],|r|r.get(0)).optional().map_err(|e|format!("Unable to inspect local schema version: {e}"))?;
    if applied.is_none(){connection.execute("INSERT INTO local_schema_migrations(version) VALUES(?1)",[LOCAL_SCHEMA_VERSION]).map_err(|e|format!("Unable to record local schema version: {e}"))?;}
    connection.execute("INSERT OR IGNORE INTO device_identity(id,device_id) VALUES(1,lower(hex(randomblob(16))))",[]).map_err(|e|format!("Unable to initialize device identity: {e}"))?;
    Ok(())}
pub fn initialize(app:&AppHandle)->Result<(),String>{let(connection,_)=open_connection(app)?;ensure_schema(&connection)?;canonicalize_legacy_ids(&connection)}
#[tauri::command]
pub fn local_database_status(app:AppHandle)->Result<LocalDatabaseStatus,String>{
    let(connection,path)=open_connection(&app)?;
    ensure_schema(&connection)?;
    let device_id:String=connection.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).map_err(|e|format!("Unable to read device identity: {e}"))?;
    let account=active_account(&connection).ok();
    let pending:i64=connection.query_row("SELECT COUNT(*) FROM sync_outbox WHERE synced_at IS NULL AND account_id=?1",params![account],|r|r.get(0)).map_err(|e|format!("Unable to read sync queue state: {e}"))?;
    let conflicts:i64=connection.query_row("SELECT COUNT(*) FROM sync_conflicts c JOIN sync_outbox o ON o.change_id=c.change_id WHERE c.resolved_at IS NULL AND o.account_id=?1",params![account],|r|r.get(0)).map_err(|e|format!("Unable to read sync conflict state: {e}"))?;
    let unassigned:i64=connection.query_row("SELECT COUNT(*) FROM sync_outbox WHERE synced_at IS NULL AND account_id IS NULL",[],|r|r.get(0)).map_err(|e|format!("Unable to inspect legacy sync changes: {e}"))?;
    let unassigned_state_count:i64=connection.query_row("SELECT COUNT(*) FROM sync_state WHERE key NOT LIKE 'account:%' AND value NOT IN ('[]','{}')",[],|r|r.get(0)).map_err(|e|format!("Unable to inspect legacy local state: {e}"))?;
    Ok(LocalDatabaseStatus{path:path.to_string_lossy().into_owned(),device_id,schema_version:LOCAL_SCHEMA_VERSION.to_string(),pending_sync_count:pending,sync_conflict_count:conflicts,unassigned_pending_sync_count:unassigned,unassigned_state_count})
}
#[tauri::command]
pub fn get_inventory_sync_cursor(app:AppHandle,expected_account_id:String)->Result<Option<String>,String>{let(conn,_)=open_connection(&app)?;ensure_schema(&conn)?;require_sync_account(&conn,&expected_account_id)?;let key=scoped_state_key(&conn,"inventory_sync_cursor")?;conn.query_row("SELECT value FROM sync_state WHERE key=?1",[key],|r|r.get(0)).optional().map_err(|e|format!("Unable to read inventory sync cursor: {e}"))}
#[tauri::command]
pub fn save_local_snapshot_with_sync(app:AppHandle,input:LocalSyncWriteInput)->Result<(),String>{if input.snapshot_json.trim().is_empty(){return Err("Local inventory snapshot cannot be empty".into())} serde_json::from_str::<serde_json::Value>(&input.snapshot_json).map_err(|e|format!("Invalid local inventory snapshot JSON: {e}"))?;serde_json::from_str::<serde_json::Value>(&input.payload_json).map_err(|e|format!("Invalid sync payload JSON: {e}"))?;if let Some(s)=&input.state_json{serde_json::from_str::<serde_json::Value>(s).map_err(|e|format!("Invalid local state JSON: {e}"))?;}let mut conn=open_local_connection(&app)?;ensure_schema(&conn)?;let tx=conn.transaction().map_err(|e|format!("Unable to begin local sync transaction: {e}"))?;let permission=match (input.entity_type.as_str(),input.operation.as_str()){("item","create")=>"inventory.create",("item","delete")|(_, "bulk_delete")|(_, "item_bulk_delete")=>"inventory.delete",("item","update")|(_, "bulk_status")|(_, "item_bulk_status")=>"inventory.edit",_=>""};if !permission.is_empty(){let (permissions,expires):(String,Option<String>)=tx.query_row("SELECT u.permissions_json,u.offline_expires_at FROM local_users u JOIN local_session s ON s.user_id=u.id WHERE s.id=1 AND u.central_user_id IS NOT NULL AND u.is_active=1",[],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|e|format!("Unable to read local authorization: {e}"))?;let expires=expires.ok_or("Offline authorization has expired")?;let valid:i64=tx.query_row("SELECT CASE WHEN datetime('now') < datetime(?1) THEN 1 ELSE 0 END",params![expires],|r|r.get(0)).unwrap_or(0);if valid==0{return Err("Offline authorization has expired. Connect to LabOS to refresh access.".into())}let permissions:Vec<String>=serde_json::from_str(&permissions).map_err(|e|format!("Unable to decode local authorization: {e}"))?;if !permissions.iter().any(|p|p==permission){return Err(format!("Permission required: {permission}"))}}let device_id:String=tx.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).map_err(|e|format!("Unable to read device identity: {e}"))?;tx.execute("INSERT INTO sync_state(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![scoped_state_key(&tx,"inventory_snapshot")?,&input.snapshot_json]).map_err(|e|format!("Unable to save local inventory snapshot: {e}"))?;if let(Some(k),Some(v))=(&input.state_key,&input.state_json){tx.execute("INSERT INTO sync_state(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![scoped_state_key(&tx,k)?,v]).map_err(|e|format!("Unable to save local state: {e}"))?;}tx.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,?3,?4,?5,?6)",params![input.change_id,device_id,input.entity_type,input.entity_id,input.operation,input.payload_json]).map_err(|e|format!("Unable to queue local change for sync: {e}"))?;tx.commit().map_err(|e|format!("Unable to commit local snapshot and sync change: {e}"))?;Ok(())}
#[tauri::command]
pub fn list_pending_sync_changes(app:AppHandle,limit:Option<i64>,expected_account_id:String)->Result<Vec<serde_json::Value>,String>{
    let(conn,_)=open_connection(&app)?;
    ensure_schema(&conn)?;
    let account=active_account(&conn)?;
    if account!=expected_account_id{return Err("Account changed during sync; retry under the active account".into())}
    let limit=limit.unwrap_or(50).clamp(1,500);
    let mut stmt=conn.prepare("SELECT o.change_id,o.device_id,o.entity_type,o.entity_id,o.operation,o.payload_json,o.created_at,o.attempt_count,o.last_error FROM sync_outbox o LEFT JOIN sync_conflicts c ON c.change_id=o.change_id AND c.resolved_at IS NULL WHERE o.synced_at IS NULL AND o.account_id=?1 AND c.change_id IS NULL ORDER BY o.created_at ASC LIMIT ?2").map_err(|e|format!("Unable to prepare sync queue query: {e}"))?;
    let rows=stmt.query_map(params![account,limit],|r|{let payload:String=r.get(5)?;let payload_json=serde_json::from_str::<serde_json::Value>(&payload).unwrap_or(serde_json::Value::Null);Ok(serde_json::json!({"change_id":r.get::<_,String>(0)?,"device_id":r.get::<_,String>(1)?,"entity_type":r.get::<_,String>(2)?,"entity_id":r.get::<_,Option<String>>(3)?,"operation":r.get::<_,String>(4)?,"payload":payload_json,"created_at":r.get::<_,String>(6)?,"attempt_count":r.get::<_,i64>(7)?,"last_error":r.get::<_,Option<String>>(8)?}))}).map_err(|e|format!("Unable to read sync queue: {e}"))?;
    rows.map(|r|r.map_err(|e|format!("Unable to decode sync queue row: {e}"))).collect()
}
#[tauri::command]
pub fn list_sync_conflicts(app:AppHandle)->Result<Vec<Value>,String>{
    let conn=open_local_connection(&app)?; ensure_schema(&conn)?;
    let account=active_account(&conn)?;
    let mut stmt=conn.prepare("SELECT c.id,c.change_id,o.entity_type,o.entity_id,o.operation,o.payload_json,c.error_code,c.error_message,c.created_at FROM sync_conflicts c JOIN sync_outbox o ON o.change_id=c.change_id WHERE c.resolved_at IS NULL AND o.account_id=?1 ORDER BY c.created_at DESC").map_err(|e|e.to_string())?;
    let records=stmt.query_map([account],|r|{let raw:String=r.get(5)?;Ok(serde_json::json!({"id":r.get::<_,i64>(0)?,"change_id":r.get::<_,String>(1)?,"entity_type":r.get::<_,String>(2)?,"entity_id":r.get::<_,Option<String>>(3)?,"operation":r.get::<_,String>(4)?,"payload":serde_json::from_str::<Value>(&raw).unwrap_or(Value::Null),"error_code":r.get::<_,String>(6)?,"error_message":r.get::<_,String>(7)?,"created_at":r.get::<_,String>(8)?}))}).map_err(|e|e.to_string())?;
    records.map(|record|{
        let mut record=record.map_err(|e|e.to_string())?;
        let readable=require_conflict_permission(&conn,record["entity_type"].as_str().unwrap_or(""),record["operation"].as_str().unwrap_or(""),&record["payload"],false).is_ok();
        if !readable {record["payload"]=Value::Null;record["entity_id"]=Value::Null;record["error_message"]=Value::String("Access changed. This account's pending work is preserved; reconnect or discard explicitly.".into());}
        record["access_restricted"]=Value::Bool(!readable);Ok(record)
    }).collect()
}

fn require_conflict_permission(conn:&Connection,entity:&str,operation:&str,payload:&Value,write:bool)->Result<(),String>{
    let domain=match entity{
        "item"|"item_movement"|"location"=>"inventory",
        "note"=>"notes", "resource"=>"resources",
        "project"|"project_task"|"project_experiment"|"project_bom_item"|"project_item"|"project_block"|"project_connector"|"project_resource_requirement"=>"projects",
        "finding"|"result"|"knowledge_relationship"=>"notes",
        "engineering_calculation"|"engineering_test"=>"engineering",
        "transaction"|"budget_period"|"funding_source"=>"finance",
        _=>return Err("Unsupported conflict domain; discard or use the domain recovery workflow".into())
    };
    crate::local_auth::require_local_permission(conn,&format!("{domain}.view"))?;
    // Conflict payloads can contain an old income record even after a role downgrade.
    if domain=="finance" {crate::local_auth::require_local_permission(conn,"finance.view_sensitive")?;}
    if write {
        let action=match operation{"delete"|"bulk_delete"|"item_bulk_delete"=>"delete","create"=>"create",_=>"edit"};
        let permission=if entity=="item_movement" {"inventory.adjust_stock".to_string()}
            else if entity=="transaction"&&operation=="create" {let record=payload.get("record").unwrap_or(payload);format!("finance.create_{}",if record["direction"]=="income"{"income"}else{"expense"})}
            else if domain=="finance"&&action=="create" {"finance.edit".to_string()}
            else {format!("{domain}.{action}")};
        crate::local_auth::require_local_permission(conn,&permission)?;
    }
    Ok(())
}
#[tauri::command]
pub fn record_sync_conflict(app:AppHandle,change_id:String,entity_type:String,entity_id:Option<String>,operation:String,payload_json:String,error_code:String,error_message:String)->Result<(),String>{let mut conn=open_local_connection(&app)?;ensure_schema(&conn)?;serde_json::from_str::<Value>(&payload_json).map_err(|e|format!("Invalid conflict payload: {e}"))?;let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|format!("Unable to begin conflict record: {e}"))?;require_owned_change(&tx,&change_id)?;tx.execute("INSERT INTO sync_conflicts(change_id,entity_type,entity_id,operation,payload_json,error_code,error_message) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(change_id) DO UPDATE SET error_code=excluded.error_code,error_message=excluded.error_message,resolved_at=NULL,resolution=NULL",params![change_id,entity_type,entity_id,operation,payload_json,error_code,error_message]).map_err(|e|format!("Unable to record sync conflict: {e}"))?;tx.commit().map_err(|e|format!("Unable to commit sync conflict: {e}"))?;Ok(())}
#[tauri::command]
pub fn resolve_sync_conflict(app:AppHandle,change_id:String,resolution:String)->Result<(),String>{
    let mut conn=open_local_connection(&app)?;ensure_schema(&conn)?;
    resolve_conflict(&mut conn,&change_id,&resolution)
}
fn resolve_conflict(conn:&mut Connection,change_id:&str,resolution:&str)->Result<(),String>{
    if !["keep_local","accept_server","dismiss"].contains(&resolution){return Err("Invalid conflict resolution".into())}
    let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
    require_owned_change(&tx,change_id)?;
    let (entity,entity_id,operation,payload,code):(String,Option<String>,String,String,String)=tx.query_row(
        "SELECT o.entity_type,o.entity_id,o.operation,o.payload_json,c.error_code FROM sync_outbox o JOIN sync_conflicts c ON c.change_id=o.change_id WHERE o.change_id=?1 AND c.resolved_at IS NULL",[change_id],
        |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).map_err(|e|e.to_string())?;
    if resolution=="keep_local" {
        let mut value:Value=serde_json::from_str(&payload).map_err(|e|e.to_string())?;
        require_conflict_permission(&tx,&entity,&operation,&value,true)?;
        if entity=="item"&&code=="SYNC_CONFLICT" {
            // An explicit overwrite is a NEW intent; never mutate an idempotency key.
            value.as_object_mut().ok_or("Conflicted payload must be an object")?.insert("conflict_resolution".into(),Value::String("keep_local".into()));
            let device:String=tx.query_row("SELECT device_id FROM sync_outbox WHERE change_id=?1",[change_id],|r|r.get(0)).map_err(|e|e.to_string())?;
            tx.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,?3,?4,?5,?6)",params![new_uuid(),device,entity,entity_id,operation,value.to_string()]).map_err(|e|e.to_string())?;
            tx.execute("UPDATE sync_outbox SET synced_at=CURRENT_TIMESTAMP,last_error=NULL WHERE change_id=?1",[change_id]).map_err(|e|e.to_string())?;
        } else {
            // Uncertain delivery/permission retry must retain exact original intent.
            tx.execute("UPDATE sync_outbox SET attempt_count=0,last_error=NULL,synced_at=NULL WHERE change_id=?1",[change_id]).map_err(|e|e.to_string())?;
        }
    } else {
        tx.execute("UPDATE sync_outbox SET synced_at=CURRENT_TIMESTAMP,last_error=NULL WHERE change_id=?1",[change_id]).map_err(|e|e.to_string())?;
        // Inventory is incremental. Other domains use complete authorized snapshots.
        if entity=="item"||entity=="item_movement" {
            tx.execute("DELETE FROM sync_state WHERE key=?1",[scoped_state_key(&tx,"inventory_sync_cursor")?]).map_err(|e|e.to_string())?;
        }
    }
    tx.execute("UPDATE sync_conflicts SET resolved_at=CURRENT_TIMESTAMP,resolution=?2 WHERE change_id=?1",params![change_id,resolution]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e|e.to_string())
}
#[tauri::command]
pub fn mark_sync_changes_synced(app:AppHandle,change_ids:Vec<String>)->Result<(),String>{let mut conn=open_local_connection(&app)?;ensure_schema(&conn)?;mark_changes_synced(&mut conn,change_ids)}

fn mark_changes_synced(conn:&mut Connection,change_ids:Vec<String>)->Result<(),String>{if change_ids.is_empty(){return Ok(())}let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|format!("Unable to begin sync acknowledgement: {e}"))?;let account=active_account(&tx)?;for id in change_ids{let updated=tx.execute("UPDATE sync_outbox SET synced_at=CURRENT_TIMESTAMP,last_error=NULL WHERE change_id=?1 AND account_id=?2",params![id,account]).map_err(|e|format!("Unable to mark sync change complete: {e}"))?;if updated!=1{return Err("Sync change does not belong to the active account".into())}}tx.commit().map_err(|e|format!("Unable to commit sync acknowledgement: {e}"))?;Ok(())}
#[tauri::command]
pub fn record_sync_failure(app:AppHandle,change_id:String,error:String)->Result<(),String>{let mut conn=open_local_connection(&app)?;ensure_schema(&conn)?;let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|format!("Unable to begin sync failure record: {e}"))?;let account=active_account(&tx)?;let updated=tx.execute("UPDATE sync_outbox SET attempt_count=attempt_count+1,last_attempt_at=CURRENT_TIMESTAMP,last_error=?2 WHERE change_id=?1 AND account_id=?3",params![change_id,error,account]).map_err(|e|format!("Unable to record sync failure: {e}"))?;if updated!=1{return Err("Sync change does not belong to the active account".into())}tx.commit().map_err(|e|format!("Unable to commit sync failure: {e}"))?;Ok(())}
#[tauri::command]
pub fn apply_server_inventory_pull(app:AppHandle,items_json:String,deleted_item_ids:Vec<String>,next_cursor:String,expected_account_id:String)->Result<(),String>{let incoming:Vec<serde_json::Value>=serde_json::from_str(&items_json).map_err(|e|format!("Invalid server inventory payload: {e}"))?;let mut conn=open_local_connection(&app)?;ensure_schema(&conn)?;let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|format!("Unable to begin server inventory merge: {e}"))?;require_sync_account(&tx,&expected_account_id)?;let snapshot_raw:Option<String>=tx.query_row("SELECT value FROM sync_state WHERE key=?1",[scoped_state_key(&tx,"inventory_snapshot")?],|r|r.get(0)).optional().map_err(|e|format!("Unable to read local inventory snapshot: {e}"))?;let mut current:Vec<serde_json::Value>=match snapshot_raw{Some(raw)=>serde_json::from_str(&raw).map_err(|e|format!("Invalid local inventory snapshot: {e}"))?,None=>Vec::new()};let mut pending=HashSet::new();{let mut stmt=tx.prepare("SELECT entity_id FROM active_sync_outbox WHERE synced_at IS NULL AND entity_type='item' AND entity_id IS NOT NULL").map_err(|e|format!("Unable to inspect pending item changes: {e}"))?;let rows=stmt.query_map([],|r|r.get::<_,String>(0)).map_err(|e|format!("Unable to inspect pending item changes: {e}"))?;for row in rows{pending.insert(row.map_err(|e|format!("Unable to read pending item id: {e}"))?);}}let deleted:HashSet<String>=deleted_item_ids.into_iter().collect();current.retain(|item|item.get("id").and_then(|v|v.as_str()).map(|id|!deleted.contains(id)||pending.contains(id)).unwrap_or(true));for item in incoming{let Some(item_id)=item.get("id").and_then(|v|v.as_str()).map(ToOwned::to_owned) else{continue};if pending.contains(&item_id){continue;}if let Some(existing)=current.iter_mut().find(|value|value.get("id").and_then(|v|v.as_str())==Some(item_id.as_str())){*existing=item;}else{current.push(item);}}let snapshot=serde_json::to_string(&current).map_err(|e|format!("Unable to encode merged inventory snapshot: {e}"))?;tx.execute("INSERT INTO sync_state(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![scoped_state_key(&tx,"inventory_snapshot")?,snapshot]).map_err(|e|format!("Unable to save merged inventory snapshot: {e}"))?;tx.execute("INSERT INTO sync_state(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![scoped_state_key(&tx,"inventory_sync_cursor")?,next_cursor]).map_err(|e|format!("Unable to save inventory sync cursor: {e}"))?;tx.commit().map_err(|e|format!("Unable to commit server inventory merge: {e}"))?;Ok(())}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn complete_snapshot_evicts_old_deletions_but_preserves_pending_intent() {
        let mut rows:Vec<Value>=(0..1505).map(|i|serde_json::json!({"id":i.to_string()})).collect();
        let incoming=vec![serde_json::json!({"id":"1504"})];
        let pending=HashSet::from(["7".to_string()]);
        retain_authorized_snapshot(&mut rows,&incoming,&pending);
        assert_eq!(rows,vec![serde_json::json!({"id":"7"}),serde_json::json!({"id":"1504"})]);
    }

    fn conflict_fixture()->Connection {
        let c=Connection::open_in_memory().unwrap();ensure_schema(&c).unwrap();
        c.execute_batch("CREATE TABLE local_users(id TEXT PRIMARY KEY,central_user_id TEXT,is_active INTEGER,offline_expires_at TEXT,permissions_json TEXT); CREATE TABLE local_session(id INTEGER PRIMARY KEY,user_id TEXT); INSERT INTO local_users VALUES('local','account',1,'2099-01-01','[\"notes.view\",\"notes.edit\",\"inventory.view\",\"inventory.edit\"]'); INSERT INTO local_session VALUES(1,'local');").unwrap();
        c
    }

    fn add_conflict(c:&Connection,change:&str,entity:&str,code:&str){
        c.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,'device',?2,'entity','update','{\"patch\":{\"name\":\"offline\"}}')",params![change,entity]).unwrap();
        c.execute("INSERT INTO sync_conflicts(change_id,entity_type,entity_id,operation,payload_json,error_code,error_message) VALUES(?1,?2,'entity','update','{}',?3,'test')",params![change,entity,code]).unwrap();
    }

    #[test]
    fn conflict_retry_is_immutable_and_overwrite_is_new_intent(){
        let mut c=conflict_fixture();
        add_conflict(&c,"retry","note","PERMISSION_DENIED");
        let original:String=c.query_row("SELECT payload_json FROM sync_outbox WHERE change_id='retry'",[],|r|r.get(0)).unwrap();
        // Notes recovery does not depend on inventory.view.
        c.execute("UPDATE local_users SET permissions_json='[\"notes.view\",\"notes.edit\"]'",[]).unwrap();
        resolve_conflict(&mut c,"retry","keep_local").unwrap();
        assert_eq!(original,c.query_row::<String,_,_>("SELECT payload_json FROM sync_outbox WHERE change_id='retry'",[],|r|r.get(0)).unwrap());
        add_conflict(&c,"overwrite","item","SYNC_CONFLICT");
        assert!(resolve_conflict(&mut c,"overwrite","keep_local").is_err());
        c.execute("UPDATE local_users SET permissions_json='[\"inventory.view\",\"inventory.edit\"]'",[]).unwrap();
        resolve_conflict(&mut c,"overwrite","keep_local").unwrap();
        assert_eq!(original,c.query_row::<String,_,_>("SELECT payload_json FROM sync_outbox WHERE change_id='overwrite'",[],|r|r.get(0)).unwrap());
        let (new_id,payload,owner):(String,String,String)=c.query_row("SELECT change_id,payload_json,account_id FROM sync_outbox WHERE change_id NOT IN ('overwrite','retry')",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert!(uuid::Uuid::parse_str(&new_id).is_ok());assert_eq!(owner,"account");assert_eq!(serde_json::from_str::<Value>(&payload).unwrap()["conflict_resolution"],"keep_local");
        add_conflict(&c,"revoked","transaction","PERMISSION_DENIED");
        assert!(resolve_conflict(&mut c,"revoked","keep_local").is_err());
        resolve_conflict(&mut c,"revoked","dismiss").unwrap();
    }

    #[test]
    fn outbox_stamps_active_account_and_preserves_legacy_rows() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE sync_outbox(change_id TEXT PRIMARY KEY,device_id TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT,operation TEXT NOT NULL,payload_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,attempt_count INTEGER NOT NULL DEFAULT 0,last_attempt_at TEXT,last_error TEXT,synced_at TEXT); INSERT INTO sync_outbox(change_id,device_id,entity_type,operation,payload_json) VALUES('legacy','device','note','create','{}');").unwrap();
        ensure_schema(&conn).unwrap();
        let legacy_owner: Option<String> = conn.query_row("SELECT account_id FROM sync_outbox WHERE change_id='legacy'", [], |row| row.get(0)).unwrap();
        assert_eq!(legacy_owner, None);
        conn.execute_batch("CREATE TABLE local_users(id TEXT PRIMARY KEY,central_user_id TEXT,is_active INTEGER,offline_expires_at TEXT); CREATE TABLE local_session(id INTEGER PRIMARY KEY,user_id TEXT); INSERT INTO local_users VALUES('local-a','account-a',1,'2099-01-01'),('local-b','account-b',1,'2099-01-01');").unwrap();
        assert!(conn.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,operation,payload_json) VALUES('missing','device','note','create','{}')", []).is_err());
        conn.execute("INSERT INTO local_session VALUES(1,'local-a')", []).unwrap();
        conn.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,operation,payload_json) VALUES('change-a','device','note','create','{}')", []).unwrap();
        assert_eq!(require_owned_change(&conn, "change-a").unwrap(), "account-a");
        conn.execute("UPDATE local_session SET user_id='local-b' WHERE id=1", []).unwrap();
        assert!(require_owned_change(&conn, "change-a").is_err());
        assert!(require_owned_change(&conn, "legacy").is_err());
        conn.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,operation,payload_json) VALUES('change-b','device','note','create','{}')", []).unwrap();
        assert_eq!(require_owned_change(&conn, "change-b").unwrap(), "account-b");
        let visible: Vec<String> = conn.prepare("SELECT change_id FROM active_sync_outbox WHERE synced_at IS NULL ORDER BY change_id").unwrap()
            .query_map([], |row| row.get(0)).unwrap().map(Result::unwrap).collect();
        assert_eq!(visible, vec!["change-b"]);
        ensure_schema(&conn).unwrap();
        conn.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,operation,payload_json,account_id) VALUES('forged','device','note','create','{}','account-a')", []).unwrap();
        assert_eq!(require_owned_change(&conn, "forged").unwrap(), "account-b");
        assert!(mark_changes_synced(&mut conn, vec!["change-a".into()]).is_err());
        assert!(mark_changes_synced(&mut conn, vec!["change-b".into(), "change-a".into()]).is_err());
        let still_pending: i64 = conn.query_row("SELECT COUNT(*) FROM sync_outbox WHERE change_id IN ('change-a','change-b') AND synced_at IS NULL", [], |row| row.get(0)).unwrap();
        assert_eq!(still_pending, 2);
        mark_changes_synced(&mut conn, vec!["change-b".into()]).unwrap();
    }

    #[test]
    fn scoped_state_and_cursor_do_not_cross_accounts() {
        let conn = Connection::open_in_memory().unwrap();
        ensure_schema(&conn).unwrap();
        conn.execute("INSERT INTO sync_state(key,value) VALUES('notes_state','[\"legacy\"]')", []).unwrap();
        conn.execute_batch("CREATE TABLE local_users(id TEXT PRIMARY KEY,central_user_id TEXT,is_active INTEGER,offline_expires_at TEXT); CREATE TABLE local_session(id INTEGER PRIMARY KEY,user_id TEXT); INSERT INTO local_users VALUES('local-a','account-a',1,'2099-01-01'),('local-b','account-b',1,'2099-01-01'); INSERT INTO local_session VALUES(1,'local-a');").unwrap();
        let a_notes = scoped_state_key(&conn, "notes_state").unwrap();
        let a_cursor = scoped_state_key(&conn, "inventory_sync_cursor").unwrap();
        conn.execute("INSERT INTO sync_state(key,value) VALUES(?1,'[\"a\"]')", [a_notes.clone()]).unwrap();
        conn.execute("INSERT INTO sync_state(key,value) VALUES(?1,'a-cursor')", [a_cursor.clone()]).unwrap();
        assert!(require_sync_account(&conn, "account-a").is_ok());
        conn.execute("UPDATE local_session SET user_id='local-b' WHERE id=1", []).unwrap();
        assert!(require_sync_account(&conn, "account-a").is_err());
        let b_notes = scoped_state_key(&conn, "notes_state").unwrap();
        let b_cursor = scoped_state_key(&conn, "inventory_sync_cursor").unwrap();
        assert_ne!(a_notes, b_notes);
        assert_ne!(a_cursor, b_cursor);
        let b_count: i64 = conn.query_row("SELECT COUNT(*) FROM sync_state WHERE key IN (?1,?2)", params![b_notes,b_cursor], |row| row.get(0)).unwrap();
        assert_eq!(b_count, 0);
        let legacy: String = conn.query_row("SELECT value FROM sync_state WHERE key='notes_state'", [], |row| row.get(0)).unwrap();
        assert_eq!(legacy, "[\"legacy\"]");
    }
}
