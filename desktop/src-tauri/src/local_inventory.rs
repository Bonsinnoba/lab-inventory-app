use rusqlite::{params, Connection};
use serde::Deserialize;
use tauri::AppHandle;

use crate::local_db;
use crate::local_auth;

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
