use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use tauri::AppHandle;

use crate::local_db;
use crate::local_auth;

#[path = "inventory_custody.rs"]
mod custody;

#[path = "inventory_reservations.rs"]
pub(crate) mod reservations;

#[cfg(test)]
#[path = "inventory_custody_persistence_test.rs"]
mod custody_persistence_tests;

#[derive(Debug, Deserialize)]
pub struct LocalCustodyWriteInput {
    pub expected_snapshot_json: String,
    pub expected_account_id: String,
    pub movement_json: String,
    pub change_id: String,
    pub item_id: String,
}

// A distinct command prevents newer UI code from silently using an older native
// writer that drops custody intent. No HTTP fallback is permitted.
#[tauri::command]
pub fn save_local_inventory_custody_movement(app: AppHandle, input: LocalCustodyWriteInput) -> Result<String, String> {
    let mut conn = connection(&app)?;
    save_custody_movement(&mut conn, input)
}

fn save_custody_movement(conn: &mut Connection, input: LocalCustodyWriteInput) -> Result<String, String> {
    ensure_movement_schema(conn)?;
    let item_id = crate::inventory_sync_state::canonical_id(&input.item_id)?;
    let mut intent: serde_json::Value = serde_json::from_str(&input.movement_json).map_err(|e| e.to_string())?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    crate::inventory_sync_state::require_base(&tx, &input.expected_account_id, &input.expected_snapshot_json)?;
    local_auth::require_local_permission(&tx, "inventory.adjust_stock")?;
    let account = local_db::active_account(&tx)?;
    let mut snapshot = crate::inventory_sync_state::read(&tx)?.ok_or("Download inventory before editing")?;
    let index = snapshot.iter().position(|row| row["id"] == item_id).ok_or("Inventory item missing")?;
    let current = if let Some(id) = intent["custody_id"].as_str() {
        let id = crate::inventory_sync_state::canonical_id(id)?;
        let raw: String = tx.query_row("SELECT custody_json FROM local_inventory_custody_records WHERE custody_id=?1 AND account_id=?2 AND item_id=?3",
            params![format!("account:{account}:{id}"),account,item_id], |r| r.get(0)).optional().map_err(|e| e.to_string())?.ok_or("Custody has not been downloaded for this account")?;
        Some(serde_json::from_str::<serde_json::Value>(&raw).map_err(|e| e.to_string())?)
    } else { None };
    let allocation = reservations::prepare_issue(&tx, &mut intent, &item_id, &input.change_id)?;
    let mut plan = custody::plan(&snapshot[index], &intent, current.as_ref(), &account)?;
    if let Some(recipient) = &plan.recipient {
        let found: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM local_assignee_directory WHERE user_id=?1 AND account_id=?2)",
            params![format!("account:{account}:{recipient}"),account], |r| r.get(0)).map_err(|e| e.to_string())?;
        if !found { return Err("Download the active recipient directory before assigning custody".into()); }
    }
    for record in &plan.records {
        if record["id"] == plan.movement["id"] {
            let key = format!("account:{account}:{}", record["id"].as_str().ok_or("Custody ID missing")?);
            let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM local_inventory_custody_records WHERE custody_id=?1)",[key],|r|r.get(0)).map_err(|e| e.to_string())?;
            if exists { return Err("Custody identity already exists; refresh before continuing".into()); }
        }
        if let Some(project) = record["project_id"].as_str() {
            crate::local_projects::require_cached_project_access(&tx, project, false)?;
        }
    }
    snapshot[index] = plan.item;
    crate::inventory_sync_state::stamp_versions(&tx,"item_movement",Some(&item_id),"create",&mut plan.movement,&mut snapshot)?;
    crate::inventory_sync_state::write(&tx,&snapshot)?;
    let movement_id = plan.movement["id"].as_str().ok_or("Movement ID missing")?;
    tx.execute("INSERT INTO local_inventory_movement_records(movement_id,item_id,movement_json,account_id) VALUES(?1,?2,?3,?4)",
        params![format!("account:{account}:{movement_id}"),item_id,plan.movement.to_string(),account]).map_err(|e| e.to_string())?;
    for record in &plan.records {
        let id = record["id"].as_str().ok_or("Custody ID missing")?;
        tx.execute("INSERT INTO local_inventory_custody_records(custody_id,item_id,custody_json,account_id) VALUES(?1,?2,?3,?4) ON CONFLICT(custody_id) DO UPDATE SET custody_json=excluded.custody_json",
            params![format!("account:{account}:{id}"),item_id,record.to_string(),account]).map_err(|e| e.to_string())?;
    }
    let device: String = tx.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,'item_movement',?3,'create',?4)",
        params![input.change_id,device,item_id,plan.movement.to_string()]).map_err(|e| e.to_string())?;
    if let Some(allocation) = allocation { reservations::record_issue(&tx, &allocation)?; }
    let result = serde_json::json!({"item":snapshot[index],"movement":plan.movement}).to_string();
    tx.commit().map_err(|e| e.to_string())?;
    Ok(result)
}

const MOVEMENT_SCHEMA_VERSION: &str = "005_local_inventory_movement_account";

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

        CREATE TABLE IF NOT EXISTS local_inventory_custody_records (
            custody_id TEXT PRIMARY KEY,
            item_id TEXT NOT NULL,
            account_id TEXT,
            custody_json TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_local_inventory_custody_item
            ON local_inventory_custody_records(account_id,item_id,created_at);

        CREATE TABLE IF NOT EXISTS local_assignee_directory (
            user_id TEXT PRIMARY KEY,
            account_id TEXT,
            directory_json TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_local_assignee_directory_account
            ON local_assignee_directory(account_id);

        CREATE TABLE IF NOT EXISTS local_inventory_field_history (
            id TEXT PRIMARY KEY,
            item_id TEXT NOT NULL,
            account_id TEXT,
            history_json TEXT NOT NULL,
            changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_local_field_history_item
            ON local_inventory_field_history(account_id,item_id,changed_at);

        CREATE TABLE IF NOT EXISTS local_inventory_assignment_history (
            id TEXT PRIMARY KEY,
            item_id TEXT NOT NULL,
            account_id TEXT,
            history_json TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_local_assignment_history_item
            ON local_inventory_assignment_history(account_id,item_id,created_at);
        "#,
    )
    .map_err(|err| format!("Unable to initialize local inventory movement cache: {err}"))?;

    let has_account_id = conn.prepare("PRAGMA table_info(local_inventory_movement_records)")
        .map_err(|e| format!("Unable to inspect movement cache schema: {e}"))?
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("Unable to read movement cache columns: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Unable to decode movement cache columns: {e}"))?
        .iter().any(|name| name == "account_id");
    if !has_account_id {
        conn.execute("ALTER TABLE local_inventory_movement_records ADD COLUMN account_id TEXT", [])
            .map_err(|e| format!("Unable to scope movement cache: {e}"))?;
    }
    conn.execute("CREATE INDEX IF NOT EXISTS idx_local_movement_account_item ON local_inventory_movement_records(account_id,item_id,created_at)", [])
        .map_err(|e| format!("Unable to index account movement cache: {e}"))?;

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
    pub expected_snapshot_json: String,
    pub expected_account_id: String,
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
    list_movements(&conn,&item_id)
}

pub(crate) fn list_movements(conn:&Connection,item_id:&str)->Result<Option<Vec<String>>,String>{
    let item_id=crate::inventory_sync_state::canonical_id(item_id)?;
    ensure_movement_schema(&conn)?;
    local_auth::require_local_permission(&conn,"inventory.view")?;
    let account_id=local_db::active_account(&conn)?;

    let mut stmt = conn
        .prepare(
            "SELECT movement_json
             FROM local_inventory_movement_records
             WHERE item_id=?1 AND account_id=?2
             ORDER BY created_at DESC",
        )
        .map_err(|e| format!("Unable to prepare local movement query: {e}"))?;

    let rows = stmt
        .query_map(params![item_id,account_id], |row| row.get(0))
        .map_err(|e| format!("Unable to read local movements: {e}"))?;

    let values = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Unable to decode local movements: {e}"))?;

    let downloaded:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM sync_state WHERE key=?1)",[local_db::scoped_state_key(conn,&format!("inventory_history_{item_id}"))?],|r|r.get(0)).map_err(|e|e.to_string())?;
    Ok(if values.is_empty()&&!downloaded { None } else { Some(values) })
}

#[tauri::command]
pub fn cache_local_inventory_movements(
    app: AppHandle,
    item_id: String,
    movements_json: String,
    expected_account_id: String,
) -> Result<(), String> {
    let mut conn = connection(&app)?;
    cache_movements(&mut conn,&item_id,&movements_json,&expected_account_id)
}

pub(crate) fn cache_movements(conn:&mut Connection,item_id:&str,movements_json:&str,expected_account_id:&str)->Result<(),String>{
    let item_id=crate::inventory_sync_state::canonical_id(item_id)?;
    let values: Vec<serde_json::Value> = serde_json::from_str(&movements_json)
        .map_err(|e| format!("Invalid movement list JSON: {e}"))?;
    ensure_movement_schema(conn)?;

    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| format!("Unable to begin movement cache transaction: {e}"))?;
    local_db::require_sync_account(&tx,&expected_account_id)?;
    local_auth::require_local_permission(&tx,"inventory.view")?;
    let account_id=local_db::active_account(&tx)?;
    let raw:Vec<String>=tx.prepare("SELECT payload_json FROM active_sync_outbox WHERE entity_type='item_movement' AND synced_at IS NULL").map_err(|e|e.to_string())?.query_map([],|r|r.get(0)).map_err(|e|e.to_string())?.collect::<Result<_,_>>().map_err(|e|e.to_string())?;
    let mut pending=std::collections::HashSet::new();
    for raw in raw{let p:serde_json::Value=serde_json::from_str(&raw).map_err(|e|e.to_string())?;if crate::inventory_sync_state::canonical_id(p["item_id"].as_str().ok_or("Movement item missing")?)?==item_id{pending.insert(crate::inventory_sync_state::canonical_id(p["id"].as_str().ok_or("Movement ID missing")?)?);}}
    let preserved:Vec<(String,String)>=tx.prepare("SELECT movement_id,movement_json FROM local_inventory_movement_records WHERE item_id=?1 AND account_id=?2").map_err(|e|e.to_string())?.query_map(params![item_id,account_id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|e|e.to_string())?.collect::<Result<_,_>>().map_err(|e|e.to_string())?;
    tx.execute(
        "DELETE FROM local_inventory_movement_records WHERE item_id=?1 AND account_id=?2",
        params![&item_id,&account_id],
    )
    .map_err(|e| format!("Unable to replace movement cache: {e}"))?;
    for (key,raw) in preserved{
        let value:serde_json::Value=serde_json::from_str(&raw).map_err(|e|e.to_string())?;
        if pending.contains(&crate::inventory_sync_state::canonical_id(value["id"].as_str().ok_or("Movement ID missing")?)?){tx.execute("INSERT INTO local_inventory_movement_records(movement_id,item_id,movement_json,account_id) VALUES(?1,?2,?3,?4)",params![key,item_id,raw,account_id]).map_err(|e|e.to_string())?;}
    }
    for mut movement in values {
        let id = movement
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Movement id is required".to_string())?;
        let id=crate::inventory_sync_state::canonical_id(id)?;
        if crate::inventory_sync_state::canonical_id(movement["item_id"].as_str().ok_or("Movement item missing")?)?!=item_id{return Err("Movement belongs to another item".into())}
        if pending.contains(&id){continue}
        movement["id"]=serde_json::json!(id);movement["item_id"]=serde_json::json!(item_id);
        tx.execute(
            "INSERT INTO local_inventory_movement_records(movement_id,item_id,movement_json,account_id)
             VALUES (?1,?2,?3,?4) ON CONFLICT(movement_id) DO UPDATE SET movement_json=excluded.movement_json",
            params![format!("account:{account_id}:{id}"), &item_id, movement.to_string(), &account_id],
        )
        .map_err(|e| format!("Unable to cache movement: {e}"))?;
    }

    tx.execute("INSERT INTO sync_state(key,value) VALUES(?1,'complete') ON CONFLICT(key) DO UPDATE SET value=excluded.value",[local_db::scoped_state_key(&tx,&format!("inventory_history_{item_id}"))?]).map_err(|e|e.to_string())?;
    tx.commit()
        .map_err(|e| format!("Unable to commit movement cache: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn save_local_inventory_movement(
    app: AppHandle,
    input: LocalMovementWriteInput,
) -> Result<(), String> {
    let mut conn=connection(&app)?;
    save_movement(&mut conn,input)
}

pub(crate) fn save_movement(conn:&mut Connection,input:LocalMovementWriteInput)->Result<(),String>{
    if input.snapshot_json.trim().is_empty() || input.movement_json.trim().is_empty() {
        return Err("Local movement data cannot be empty".into());
    }

    let mut snapshot = crate::inventory_sync_state::decode(&input.snapshot_json)?;
    let mut movement: serde_json::Value = serde_json::from_str(&input.movement_json)
        .map_err(|e| format!("Invalid movement JSON: {e}"))?;

    if ["custody_id","recipient_id","settlement_type","transfer_recipient_id","serial_number"]
        .iter().any(|key| movement[*key].as_str().is_some_and(|s| !s.is_empty())) {
        return Err("Use the custody movement writer for custody operations".into());
    }

    let id = movement
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Movement id is required".to_string())?
        .to_string();
    let id=crate::inventory_sync_state::canonical_id(&id)?;

    let movement_item_id = movement
        .get("item_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Movement item id is required".to_string())?;

    let item_id=crate::inventory_sync_state::canonical_id(&input.item_id)?;
    if crate::inventory_sync_state::canonical_id(movement_item_id)? != item_id {
        return Err("Movement item id does not match the target item".into());
    }
    movement["id"]=serde_json::json!(id);
    movement["item_id"]=serde_json::json!(item_id);

    ensure_movement_schema(conn)?;

    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| format!("Unable to begin local movement transaction: {e}"))?;
    crate::inventory_sync_state::require_base(&tx,&input.expected_account_id,&input.expected_snapshot_json)?;
    local_auth::require_local_permission(&tx,"inventory.adjust_stock")?;
    let account_id=local_db::active_account(&tx)?;

    crate::inventory_sync_state::stamp_versions(&tx,"item_movement",Some(&item_id),"create",&mut movement,&mut snapshot)?;
    crate::inventory_sync_state::write(&tx,&snapshot)?;

    tx.execute(
        "INSERT INTO local_inventory_movement_records
         (movement_id,item_id,movement_json,account_id)
         VALUES (?1,?2,?3,?4)",
        params![format!("account:{account_id}:{id}"), &item_id, movement.to_string(),&account_id],
    )
    .map_err(|e| format!("Unable to save local movement: {e}"))?;

    let device: String = tx
        .query_row("SELECT device_id FROM device_identity WHERE id=1", [], |r| r.get(0))
        .map_err(|e| format!("Unable to read device identity: {e}"))?;

    tx.execute(
        "INSERT INTO sync_outbox
         (change_id,device_id,entity_type,entity_id,operation,payload_json)
         VALUES (?1,?2,'item_movement',?3,'create',?4)",
        params![input.change_id, device, &item_id, movement.to_string()],
    )
    .map_err(|e| format!("Unable to queue movement for sync: {e}"))?;

    tx.commit()
        .map_err(|e| format!("Unable to commit local movement transaction: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn list_local_item_custody(
    app: AppHandle,
    item_id: String,
) -> Result<Option<Vec<String>>, String> {
    let conn = connection(&app)?;
    let item_id = crate::inventory_sync_state::canonical_id(&item_id)?;
    ensure_movement_schema(&conn)?;
    local_auth::require_local_permission(&conn, "inventory.view")?;
    let account_id = local_db::active_account(&conn)?;

    let mut stmt = conn
        .prepare(
            "SELECT custody_json
             FROM local_inventory_custody_records
             WHERE item_id=?1 AND account_id=?2
             ORDER BY created_at DESC",
        )
        .map_err(|e| format!("Unable to prepare local custody query: {e}"))?;

    let rows = stmt
        .query_map(params![item_id, account_id], |row| row.get(0))
        .map_err(|e| format!("Unable to read local custody: {e}"))?;

    let values = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Unable to decode local custody: {e}"))?;

    let downloaded: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sync_state WHERE key=?1)",
        [local_db::scoped_state_key(&conn, &format!("inventory_custody_{item_id}"))?],
        |r| r.get(0),
    ).map_err(|e| e.to_string())?;

    Ok(if values.is_empty() && !downloaded { None } else { Some(values) })
}

#[tauri::command]
pub fn cache_local_item_custody(
    app: AppHandle,
    item_id: String,
    records_json: String,
    expected_account_id: String,
) -> Result<(), String> {
    let mut conn = connection(&app)?;
    cache_custody(&mut conn, &item_id, &records_json, &expected_account_id)
}

fn cache_custody(conn: &mut Connection, item_id: &str, records_json: &str, expected_account_id: &str) -> Result<(), String> {
    let item_id = crate::inventory_sync_state::canonical_id(&item_id)?;
    let values: Vec<serde_json::Value> = serde_json::from_str(&records_json)
        .map_err(|e| format!("Invalid custody records JSON: {e}"))?;
    ensure_movement_schema(&conn)?;

    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| format!("Unable to begin custody cache transaction: {e}"))?;
    local_db::require_sync_account(&tx, &expected_account_id)?;
    local_auth::require_local_permission(&tx, "inventory.view")?;
    let account_id = local_db::active_account(&tx)?;

    // A server refresh must not replace optimistic balances that are part of
    // unacknowledged authored movements (including failed/conflicted intents).
    let pending: Vec<String> = tx.prepare("SELECT payload_json FROM active_sync_outbox WHERE entity_type='item_movement' AND synced_at IS NULL")
        .map_err(|e| e.to_string())?.query_map([], |r| r.get(0)).map_err(|e| e.to_string())?
        .collect::<Result<_,_>>().map_err(|e| e.to_string())?;
    for raw in pending {
        let value: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        if value["item_id"].as_str().map(crate::inventory_sync_state::canonical_id).transpose()?.as_deref() == Some(&item_id)
            && (value["custody_id"].is_string() || value["recipient_id"].is_string()) {
            return Ok(());
        }
    }

    tx.execute(
        "DELETE FROM local_inventory_custody_records WHERE item_id=?1 AND account_id=?2",
        params![&item_id, &account_id],
    )
    .map_err(|e| format!("Unable to replace custody cache: {e}"))?;

    let mut seen = std::collections::HashSet::new();
    for mut record in values {
        let id = record
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Custody record id is required".to_string())?;
        let id = crate::inventory_sync_state::canonical_id(id)?;
        if crate::inventory_sync_state::canonical_id(record["item_id"].as_str().ok_or("Custody item ID missing")?)? != item_id {
            return Err("Custody record belongs to another item".into());
        }
        if !seen.insert(id.clone()) {
            return Err("Duplicate custody identity in response".into());
        }
        let key = format!("account:{account_id}:{id}");
        let previous_item: Option<String> = tx.query_row(
            "SELECT item_id FROM local_inventory_custody_records WHERE custody_id=?1 AND account_id=?2",
            params![key,account_id], |r| r.get(0),
        ).optional().map_err(|e| e.to_string())?;
        if previous_item.as_deref().is_some_and(|previous| previous != item_id) {
            return Err("Custody identity already belongs to another item".into());
        }
        record["id"] = serde_json::json!(id);
        record["item_id"] = serde_json::json!(item_id);
        tx.execute(
            "INSERT INTO local_inventory_custody_records(custody_id, item_id, custody_json, account_id)
             VALUES (?1, ?2, ?3, ?4) ON CONFLICT(custody_id) DO UPDATE SET custody_json=excluded.custody_json",
            params![format!("account:{account_id}:{id}"), &item_id, record.to_string(), &account_id],
        )
        .map_err(|e| format!("Unable to cache custody record: {e}"))?;
    }

    tx.execute(
        "INSERT INTO sync_state(key,value) VALUES(?1,'complete') ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [local_db::scoped_state_key(&tx, &format!("inventory_custody_{item_id}"))?],
    )
    .map_err(|e| e.to_string())?;

    tx.commit()
        .map_err(|e| format!("Unable to commit custody cache: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn list_local_assignee_directory(app: AppHandle) -> Result<Option<Vec<String>>, String> {
    let conn = connection(&app)?;
    ensure_movement_schema(&conn)?;
    local_auth::require_local_permission(&conn, "inventory.view")?;
    let account_id = local_db::active_account(&conn)?;

    let mut stmt = conn
        .prepare(
            "SELECT directory_json
             FROM local_assignee_directory
             WHERE account_id=?1
             ORDER BY updated_at DESC",
        )
        .map_err(|e| format!("Unable to prepare local assignee directory query: {e}"))?;

    let rows = stmt
        .query_map(params![account_id], |row| row.get(0))
        .map_err(|e| format!("Unable to read local assignee directory: {e}"))?;

    let values = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Unable to decode local assignee directory: {e}"))?;

    let downloaded: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sync_state WHERE key=?1)",
        [local_db::scoped_state_key(&conn, "assignee_directory")?],
        |r| r.get(0),
    ).map_err(|e| e.to_string())?;

    Ok(if values.is_empty() && !downloaded { None } else { Some(values) })
}

#[tauri::command]
pub fn cache_local_assignee_directory(
    app: AppHandle,
    directory_json: String,
    expected_account_id: String,
) -> Result<(), String> {
    let mut conn = connection(&app)?;
    let values: Vec<serde_json::Value> = serde_json::from_str(&directory_json)
        .map_err(|e| format!("Invalid assignee directory JSON: {e}"))?;
    ensure_movement_schema(&conn)?;

    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| format!("Unable to begin assignee directory transaction: {e}"))?;
    local_db::require_sync_account(&tx, &expected_account_id)?;
    local_auth::require_local_permission(&tx, "inventory.view")?;
    let account_id = local_db::active_account(&tx)?;

    tx.execute(
        "DELETE FROM local_assignee_directory WHERE account_id=?1",
        params![&account_id],
    )
    .map_err(|e| format!("Unable to replace assignee directory: {e}"))?;

    for user in values {
        let id = user
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "User id is required".to_string())?;
        let id = crate::inventory_sync_state::canonical_id(id)?;
        tx.execute(
            "INSERT INTO local_assignee_directory(user_id, account_id, directory_json)
             VALUES (?1, ?2, ?3) ON CONFLICT(user_id) DO UPDATE SET directory_json=excluded.directory_json",
            params![format!("account:{account_id}:{id}"), &account_id, user.to_string()],
        )
        .map_err(|e| format!("Unable to cache assignee directory user: {e}"))?;
    }

    tx.execute(
        "INSERT INTO sync_state(key,value) VALUES(?1,'complete') ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [local_db::scoped_state_key(&tx, "assignee_directory")?],
    )
    .map_err(|e| e.to_string())?;

    tx.commit()
        .map_err(|e| format!("Unable to commit assignee directory: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn list_local_item_field_history(
    app: AppHandle,
    item_id: String,
) -> Result<Option<Vec<String>>, String> {
    let conn = connection(&app)?;
    let item_id = crate::inventory_sync_state::canonical_id(&item_id)?;
    ensure_movement_schema(&conn)?;
    local_auth::require_local_permission(&conn, "inventory.view")?;
    let account_id = local_db::active_account(&conn)?;

    let mut stmt = conn
        .prepare(
            "SELECT history_json
             FROM local_inventory_field_history
             WHERE item_id=?1 AND account_id=?2
             ORDER BY changed_at DESC",
        )
        .map_err(|e| format!("Unable to prepare field history query: {e}"))?;

    let rows = stmt
        .query_map(params![item_id, account_id], |row| row.get(0))
        .map_err(|e| format!("Unable to read local field history: {e}"))?;

    let values = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Unable to decode field history: {e}"))?;

    let downloaded: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sync_state WHERE key=?1)",
        [local_db::scoped_state_key(&conn, &format!("inventory_field_history_{item_id}"))?],
        |r| r.get(0),
    ).map_err(|e| e.to_string())?;

    Ok(if values.is_empty() && !downloaded { None } else { Some(values) })
}

#[tauri::command]
pub fn cache_local_item_field_history(
    app: AppHandle,
    item_id: String,
    history_json: String,
    expected_account_id: String,
) -> Result<(), String> {
    let mut conn = connection(&app)?;
    let item_id = crate::inventory_sync_state::canonical_id(&item_id)?;
    let values: Vec<serde_json::Value> = serde_json::from_str(&history_json)
        .map_err(|e| format!("Invalid field history JSON: {e}"))?;
    ensure_movement_schema(&conn)?;

    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| format!("Unable to begin field history transaction: {e}"))?;
    local_db::require_sync_account(&tx, &expected_account_id)?;
    local_auth::require_local_permission(&tx, "inventory.view")?;
    let account_id = local_db::active_account(&tx)?;

    tx.execute(
        "DELETE FROM local_inventory_field_history WHERE item_id=?1 AND account_id=?2",
        params![&item_id, &account_id],
    )
    .map_err(|e| format!("Unable to replace field history: {e}"))?;

    for entry in values {
        let id = entry
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "History entry id is required".to_string())?;
        tx.execute(
            "INSERT INTO local_inventory_field_history(id, item_id, history_json, account_id)
             VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id) DO UPDATE SET history_json=excluded.history_json",
            params![format!("account:{account_id}:{id}"), &item_id, entry.to_string(), &account_id],
        )
        .map_err(|e| format!("Unable to cache field history: {e}"))?;
    }

    tx.execute(
        "INSERT INTO sync_state(key,value) VALUES(?1,'complete') ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [local_db::scoped_state_key(&tx, &format!("inventory_field_history_{item_id}"))?],
    )
    .map_err(|e| e.to_string())?;

    tx.commit()
        .map_err(|e| format!("Unable to commit field history: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn list_local_item_assignment_history(
    app: AppHandle,
    item_id: String,
) -> Result<Option<Vec<String>>, String> {
    let conn = connection(&app)?;
    let item_id = crate::inventory_sync_state::canonical_id(&item_id)?;
    ensure_movement_schema(&conn)?;
    local_auth::require_local_permission(&conn, "inventory.view")?;
    let account_id = local_db::active_account(&conn)?;

    let mut stmt = conn
        .prepare(
            "SELECT history_json
             FROM local_inventory_assignment_history
             WHERE item_id=?1 AND account_id=?2
             ORDER BY created_at DESC",
        )
        .map_err(|e| format!("Unable to prepare assignment history query: {e}"))?;

    let rows = stmt
        .query_map(params![item_id, account_id], |row| row.get(0))
        .map_err(|e| format!("Unable to read assignment history: {e}"))?;

    let values = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Unable to decode assignment history: {e}"))?;

    let downloaded: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sync_state WHERE key=?1)",
        [local_db::scoped_state_key(&conn, &format!("inventory_assignment_history_{item_id}"))?],
        |r| r.get(0),
    ).map_err(|e| e.to_string())?;

    Ok(if values.is_empty() && !downloaded { None } else { Some(values) })
}

#[tauri::command]
pub fn cache_local_item_assignment_history(
    app: AppHandle,
    item_id: String,
    history_json: String,
    expected_account_id: String,
) -> Result<(), String> {
    let mut conn = connection(&app)?;
    let item_id = crate::inventory_sync_state::canonical_id(&item_id)?;
    let values: Vec<serde_json::Value> = serde_json::from_str(&history_json)
        .map_err(|e| format!("Invalid assignment history JSON: {e}"))?;
    ensure_movement_schema(&conn)?;

    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| format!("Unable to begin assignment history transaction: {e}"))?;
    local_db::require_sync_account(&tx, &expected_account_id)?;
    local_auth::require_local_permission(&tx, "inventory.view")?;
    let account_id = local_db::active_account(&tx)?;

    tx.execute(
        "DELETE FROM local_inventory_assignment_history WHERE item_id=?1 AND account_id=?2",
        params![&item_id, &account_id],
    )
    .map_err(|e| format!("Unable to replace assignment history: {e}"))?;

    for entry in values {
        let id = entry
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Assignment history entry id is required".to_string())?;
        tx.execute(
            "INSERT INTO local_inventory_assignment_history(id, item_id, history_json, account_id)
             VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id) DO UPDATE SET history_json=excluded.history_json",
            params![format!("account:{account_id}:{id}"), &item_id, entry.to_string(), &account_id],
        )
        .map_err(|e| format!("Unable to cache assignment history: {e}"))?;
    }

    tx.execute(
        "INSERT INTO sync_state(key,value) VALUES(?1,'complete') ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [local_db::scoped_state_key(&tx, &format!("inventory_assignment_history_{item_id}"))?],
    )
    .map_err(|e| e.to_string())?;

    tx.commit()
        .map_err(|e| format!("Unable to commit assignment history: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn movement_cache_migration_preserves_unowned_rows() {
        let conn=Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE local_schema_migrations(version TEXT PRIMARY KEY); CREATE TABLE local_inventory_movement_records(movement_id TEXT PRIMARY KEY,item_id TEXT NOT NULL,movement_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); INSERT INTO local_inventory_movement_records(movement_id,item_id,movement_json) VALUES('old','item-1','{}');").unwrap();
        ensure_movement_schema(&conn).unwrap();
        let legacy_owner:Option<String>=conn.query_row("SELECT account_id FROM local_inventory_movement_records WHERE movement_id='old'",[],|row|row.get(0)).unwrap();
        assert_eq!(legacy_owner,None);
        conn.execute("INSERT INTO local_inventory_movement_records(movement_id,item_id,movement_json,account_id) VALUES('account:a:old','item-1','{}','a')",[]).unwrap();
        conn.execute("INSERT INTO local_inventory_movement_records(movement_id,item_id,movement_json,account_id) VALUES('account:b:old','item-1','{}','b')",[]).unwrap();
        let owned:i64=conn.query_row("SELECT COUNT(*) FROM local_inventory_movement_records WHERE item_id='item-1' AND account_id='b'",[],|row|row.get(0)).unwrap();
        assert_eq!(owned,1);
    }
}
