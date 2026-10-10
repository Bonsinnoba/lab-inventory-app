use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};
use tauri::AppHandle;
use crate::{local_auth, local_db};

const KEY: &str = "activity_snapshot";

fn may_read(c: &Connection) -> Result<bool, String> {
    let role: String = c.query_row(
        "SELECT u.role FROM local_users u JOIN local_session s ON s.user_id=u.id WHERE s.id=1",
        [], |r| r.get(0),
    ).map_err(|e| e.to_string())?;
    Ok(role == "admin" && local_auth::require_local_permission(c, "audit.view").is_ok())
}

fn require_session(c: &Connection, account: &str, guard: &str) -> Result<(), String> {
    local_db::require_sync_account(c, account)?;
    let active: String = c.query_row("SELECT session_token FROM local_session WHERE id=1", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if active != guard { return Err("Native session changed during activity pull".into()); }
    Ok(())
}

fn read(c: &Connection, account: &str, limit: usize) -> Result<Value, String> {
    local_db::require_sync_account(c, account)?;
    if !may_read(c)? { return Ok(json!({"items":[],"next_before":null,"state":"restricted","last_synced_at":null})); }
    let raw: Option<String> = c.query_row("SELECT value FROM sync_state WHERE key=?1",
        [local_db::scoped_state_key(c, KEY)?], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
    let Some(raw) = raw else { return Ok(json!({"items":[],"next_before":null,"state":"not_downloaded","last_synced_at":null})); };
    let snapshot: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let records = snapshot["records"].as_array().ok_or("Invalid local activity snapshot")?;
    let items: Vec<Value> = records.iter().take(limit.clamp(1, 100)).cloned().collect();
    Ok(json!({"next_before":items.last().map(|r|r["created_at"].clone()),"items":items,
        "state":"available","last_synced_at":snapshot["snapshot_at"]}))
}

fn apply(c: &mut Connection, account: &str, guard: &str, snapshot: Option<Value>) -> Result<(), String> {
    let tx = c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    require_session(&tx, account, guard)?;
    let key = local_db::scoped_state_key(&tx, KEY)?;
    if let Some(mut snapshot) = snapshot {
        if !may_read(&tx)? { return Err("Audit records require administrator access".into()); }
        if snapshot["snapshot_complete"] != true { return Err("Incomplete activity snapshot".into()); }
        let stamp = snapshot["snapshot_at"].as_str().ok_or("Activity snapshot time missing")?.to_string();
        let valid: bool = tx.query_row("SELECT julianday(?1) IS NOT NULL", [&stamp], |r| r.get(0)).map_err(|e|e.to_string())?;
        if !valid { return Err("Invalid activity snapshot time".into()); }
        let records = snapshot["records"].as_array_mut().ok_or("Activity records missing")?;
        let mut ids = std::collections::HashSet::new();
        for row in records.iter_mut() {
            let id = uuid::Uuid::parse_str(row["id"].as_str().ok_or("Activity ID missing")?).map_err(|e|e.to_string())?.to_string();
            if !ids.insert(id.clone()) { return Err("Duplicate activity ID in snapshot".into()); }
            for field in ["created_at", "action", "entity_type"] {
                if row[field].as_str().filter(|v|!v.is_empty()).is_none() { return Err(format!("Activity {field} missing")); }
            }
            row["id"] = json!(id);
        }
        // Full replacement and timestamp advance are one transaction. An older
        // delayed snapshot must not overwrite a newer synchronized view.
        let previous: Option<String> = tx.query_row("SELECT value FROM sync_state WHERE key=?1", [&key], |r| r.get(0))
            .optional().map_err(|e|e.to_string())?;
        if let Some(previous) = previous {
            let old: Value = serde_json::from_str(&previous).map_err(|e|e.to_string())?;
            let stale: bool = tx.query_row("SELECT julianday(?1) < julianday(?2)", params![stamp,old["snapshot_at"].as_str()], |r| r.get(0))
                .map_err(|e|e.to_string())?;
            if stale { return Err("Stale activity snapshot; retry synchronization".into()); }
        }
        tx.execute("INSERT INTO sync_state(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key,snapshot.to_string()]).map_err(|e|e.to_string())?;
    } else {
        // Revocation removes only this derived cache, never authored work or an
        // audit record on the server, and never creates an outbound delete.
        tx.execute("DELETE FROM sync_state WHERE key=?1", [key]).map_err(|e|e.to_string())?;
    }
    tx.commit().map_err(|e|e.to_string())
}

#[tauri::command]
pub fn list_local_activity(app: AppHandle, expected_account_id: String, limit: usize) -> Result<Value, String> {
    read(&local_db::open_local_connection(&app)?, &expected_account_id, limit)
}

#[tauri::command]
pub fn apply_server_activity_snapshot(app: AppHandle, expected_account_id: String, expected_session_token: String, snapshot: Option<Value>) -> Result<(), String> {
    apply(&mut local_db::open_local_connection(&app)?, &expected_account_id, &expected_session_token, snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Connection {
        let c=Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE sync_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
          CREATE TABLE local_users(id TEXT PRIMARY KEY,central_user_id TEXT,role TEXT,is_active INTEGER,offline_expires_at TEXT,permissions_json TEXT);
          CREATE TABLE local_session(id INTEGER PRIMARY KEY,user_id TEXT,session_token TEXT);
          INSERT INTO local_users VALUES('local-a','account-a','admin',1,datetime('now','+1 day'),'[\"audit.view\"]');
          INSERT INTO local_users VALUES('local-b','account-b','admin',1,datetime('now','+1 day'),'[\"audit.view\"]');
          INSERT INTO local_session VALUES(1,'local-a','guard-a');").unwrap();c
    }
    fn snapshot() -> Value {
        json!({"snapshot_complete":true,"snapshot_at":"2026-10-10T12:00:00Z","records":[
          {"id":"550e8400-e29b-41d4-a716-446655440000","action":"create","entity_type":"note","created_at":"2026-10-10T10:00:00Z"}
        ]})
    }
    #[test]
    fn activity_account_session_role_and_lease_guards() {
        let mut c=fixture();
        assert!(apply(&mut c,"account-b","guard-a",Some(snapshot())).is_err());
        assert!(apply(&mut c,"account-a","old-login",Some(snapshot())).is_err());
        assert_eq!(read(&c,"account-a",60).unwrap()["state"],"not_downloaded");
        apply(&mut c,"account-a","guard-a",Some(snapshot())).unwrap();
        c.execute("UPDATE local_session SET user_id='local-b',session_token='guard-b'",[]).unwrap();
        assert!(read(&c,"account-a",60).is_err());
        assert_eq!(read(&c,"account-b",60).unwrap()["state"],"not_downloaded");
        c.execute("UPDATE local_session SET user_id='local-a',session_token='new-login'",[]).unwrap();
        assert!(apply(&mut c,"account-a","guard-a",None).is_err());
        assert_eq!(read(&c,"account-a",60).unwrap()["items"].as_array().unwrap().len(),1);
        c.execute("UPDATE local_users SET role='member' WHERE id='local-a'",[]).unwrap();
        assert_eq!(read(&c,"account-a",60).unwrap()["state"],"restricted");
        assert!(apply(&mut c,"account-a","new-login",Some(snapshot())).is_err());
        apply(&mut c,"account-a","new-login",None).unwrap();
        assert_eq!(c.query_row("SELECT count(*) FROM sync_state",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        c.execute("UPDATE local_users SET offline_expires_at=datetime('now','-1 day') WHERE id='local-a'",[]).unwrap();
        assert!(read(&c,"account-a",60).is_err());
    }
    #[test]
    fn activity_snapshot_atomicity_replay_and_confirmed_empty() {
        let mut c=fixture();apply(&mut c,"account-a","guard-a",Some(snapshot())).unwrap();
        apply(&mut c,"account-a","guard-a",Some(snapshot())).unwrap();
        assert_eq!(read(&c,"account-a",60).unwrap()["items"].as_array().unwrap().len(),1);
        let mut invalid=snapshot();invalid["snapshot_complete"]=json!(false);
        assert!(apply(&mut c,"account-a","guard-a",Some(invalid)).is_err());
        let mut stale=snapshot();stale["snapshot_at"]=json!("2026-10-09T00:00:00Z");
        assert!(apply(&mut c,"account-a","guard-a",Some(stale)).is_err());
        let mut duplicate=snapshot();let row=duplicate["records"][0].clone();duplicate["records"].as_array_mut().unwrap().push(row);
        assert!(apply(&mut c,"account-a","guard-a",Some(duplicate)).is_err());
        assert_eq!(read(&c,"account-a",60).unwrap()["items"].as_array().unwrap().len(),1);
        let empty=json!({"snapshot_complete":true,"snapshot_at":"2026-10-11T00:00:00Z","records":[]});
        apply(&mut c,"account-a","guard-a",Some(empty)).unwrap();
        let r=read(&c,"account-a",60).unwrap();assert_eq!(r["state"],"available");assert_eq!(r["items"].as_array().unwrap().len(),0);
    }
}
