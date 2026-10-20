//! Real on-disk SQLite tests for the desktop transaction, not server DB substitutes.
use super::*;
use crate::inventory_sync_state as state;
use serde_json::{json, Value};

const ACCOUNT: &str = "10000000-0000-4000-8000-000000000001";
const ITEM: &str = "20000000-0000-4000-8000-000000000001";
const RECIPIENT: &str = "30000000-0000-4000-8000-000000000001";

struct Database(std::path::PathBuf);
impl Database {
    fn new() -> (Self, Connection) {
        let path = std::env::temp_dir().join(format!("labos-custody-{}.sqlite", uuid::Uuid::new_v4()));
        let conn = Connection::open(&path).unwrap();
        local_db::ensure_schema(&conn).unwrap();
        ensure_movement_schema(&conn).unwrap();
        conn.execute_batch("CREATE TABLE local_users(id TEXT PRIMARY KEY,central_user_id TEXT,is_active INTEGER,offline_expires_at TEXT,permissions_json TEXT); CREATE TABLE local_session(id INTEGER PRIMARY KEY,user_id TEXT);").unwrap();
        conn.execute("INSERT INTO local_users VALUES('a',?1,1,datetime('now','+24 hours'),'[\"inventory.view\",\"inventory.adjust_stock\"]')", [ACCOUNT]).unwrap();
        conn.execute("INSERT INTO local_session VALUES(1,'a')", []).unwrap();
        conn.execute("INSERT INTO local_assignee_directory(user_id,account_id,directory_json) VALUES(?1,?2,?3)", params![format!("account:{ACCOUNT}:{RECIPIENT}"), ACCOUNT, json!({"id":RECIPIENT}).to_string()]).unwrap();
        state::write(&conn, &[json!({"id":ITEM,"current_quantity":10,"sync_version":1,"location":"Shelf A"})]).unwrap();
        (Self(path), conn)
    }
    fn reopen(&self) -> Connection { Connection::open(&self.0).unwrap() }
}
impl Drop for Database {
    fn drop(&mut self) {
        // Only this unique test file, never a recursive directory cleanup.
        let _ = std::fs::remove_file(&self.0);
    }
}
fn issue() -> Value {
    json!({"id":uuid::Uuid::new_v4().to_string(),"item_id":ITEM,"movement_type":"checkout","quantity":4,"recipient_id":RECIPIENT,"created_at":"2026-10-19T12:00:00Z"})
}
fn input(conn: &Connection, movement: &Value) -> LocalCustodyWriteInput {
    LocalCustodyWriteInput {
        expected_snapshot_json: json!(state::read(conn).unwrap().unwrap()).to_string(),
        expected_account_id: ACCOUNT.into(), movement_json: movement.to_string(),
        change_id: uuid::Uuid::new_v4().to_string(), item_id: ITEM.into(),
    }
}
fn records(conn: &Connection, table: &str, column: &str) -> Vec<Value> {
    conn.prepare(&format!("SELECT {column} FROM {table} ORDER BY rowid")).unwrap()
        .query_map([], |r| r.get::<_,String>(0)).unwrap()
        .map(|raw| serde_json::from_str(&raw.unwrap()).unwrap()).collect()
}
fn snapshot(conn: &Connection) -> Value {
    // Test inspection deliberately reads the known fixture key even after expiry;
    // production reads must (and do) refuse an expired account.
    let raw: String = conn.query_row("SELECT value FROM sync_state WHERE key=?1",[format!("account:{ACCOUNT}:inventory_snapshot")],|r|r.get(0)).unwrap();
    json!({"items":serde_json::from_str::<Value>(&raw).unwrap(),
        "custody":records(conn,"local_inventory_custody_records","custody_json"),
        "movements":records(conn,"local_inventory_movement_records","movement_json"),
        "outbox":records(conn,"sync_outbox","payload_json")})
}

#[test]
fn committed_issue_and_partial_return_survive_reopen_with_authored_dependency() {
    let (disk, mut conn) = Database::new();
    let movement = issue();
    let first = input(&conn, &movement);
    let first_change = first.change_id.clone();
    let receipt: Value = serde_json::from_str(&save_custody_movement(&mut conn,first).unwrap()).unwrap();
    assert_eq!(receipt["item"]["current_quantity"],6.0);
    drop(conn);
    let mut conn = disk.reopen();
    let settlement = json!({"id":uuid::Uuid::new_v4().to_string(),"item_id":ITEM,"custody_id":movement["id"],"movement_type":"return","quantity":1,"created_at":"2026-10-19T13:00:00Z"});
    let next = input(&conn,&settlement);
    save_custody_movement(&mut conn,next).unwrap();
    let expected = snapshot(&conn);
    assert_eq!(expected["items"][0]["current_quantity"],7.0);
    assert_eq!(expected["custody"][0]["outstanding_quantity"],3.0);
    assert_eq!(expected["outbox"][1]["item_bases"][0]["depends_on"],first_change);
    assert_eq!(expected["outbox"][1]["item_bases"][0]["version"],2);
    assert_eq!(expected["outbox"][1]["performed_by"],ACCOUNT);
    drop(conn);
    let conn = disk.reopen();
    assert_eq!(snapshot(&conn),expected);
}

#[test]
fn failure_at_each_write_boundary_rolls_back_every_projection() {
    for (table,operation) in [("sync_state","UPDATE"),("local_inventory_movement_records","INSERT"),("local_inventory_custody_records","INSERT"),("sync_outbox","INSERT")] {
        let (disk,mut conn) = Database::new();
        let before = snapshot(&conn);
        conn.execute_batch(&format!("CREATE TEMP TRIGGER fail_write BEFORE {operation} ON {table} BEGIN SELECT RAISE(ABORT,'injected custody write failure'); END;")).unwrap();
        let request = input(&conn,&issue());
        assert!(save_custody_movement(&mut conn,request).unwrap_err().contains("injected custody write failure"));
        assert_eq!(snapshot(&conn),before,"{table}");
        drop(conn);
        let conn = disk.reopen();
        assert_eq!(snapshot(&conn),before,"durable rollback: {table}");
    }
}

#[test]
fn pending_custody_survives_refresh_until_acknowledged() {
    let (_disk,mut conn) = Database::new();
    let request = input(&conn,&issue());
    let change = request.change_id.clone();
    save_custody_movement(&mut conn,request).unwrap();
    let before = snapshot(&conn);
    cache_custody(&mut conn,ITEM,"[]",ACCOUNT).unwrap();
    state::merge(&mut conn,ACCOUNT,vec![json!({"id":ITEM,"current_quantity":10,"sync_version":1})],vec![],None).unwrap();
    assert_eq!(snapshot(&conn),before);
    local_db::mark_changes_synced(&mut conn,vec![change]).unwrap();
    let mut authoritative = before["custody"].clone();
    authoritative[0]["server_verified"] = json!(true);
    cache_custody(&mut conn,ITEM,&authoritative.to_string(),ACCOUNT).unwrap();
    assert_eq!(records(&conn,"local_inventory_custody_records","custody_json"),authoritative.as_array().unwrap().clone());
}

#[test]
fn stale_account_permission_and_expired_lease_fail_without_writes() {
    for mode in ["account","snapshot","permission","lease","recipient"] {
        let (_disk,mut conn) = Database::new();
        let mut request = input(&conn,&issue());
        match mode {
            "account" => request.expected_account_id = RECIPIENT.into(),
            "snapshot" => request.expected_snapshot_json = "[]".into(),
            "permission" => {conn.execute("UPDATE local_users SET permissions_json='[\"inventory.view\"]'",[]).unwrap();},
            "lease" => {conn.execute("UPDATE local_users SET offline_expires_at=datetime('now','-1 hour')",[]).unwrap();},
            _ => {conn.execute("DELETE FROM local_assignee_directory",[]).unwrap();},
        }
        let before = snapshot(&conn);
        assert!(save_custody_movement(&mut conn,request).is_err(),"{mode}");
        assert_eq!(snapshot(&conn),before,"{mode}");
    }
}

#[test]
fn duplicate_movement_or_outbox_identity_cannot_double_debit() {
    let (_disk,mut conn) = Database::new();
    let movement = issue();
    let request = input(&conn,&movement);
    let change = request.change_id.clone();
    save_custody_movement(&mut conn,request).unwrap();
    let before = snapshot(&conn);
    let duplicate_movement = input(&conn,&movement);
    assert!(save_custody_movement(&mut conn,duplicate_movement).is_err());
    let mut duplicate_outbox = input(&conn,&issue());
    duplicate_outbox.change_id = change;
    assert!(save_custody_movement(&mut conn,duplicate_outbox).is_err());
    assert_eq!(snapshot(&conn),before);
}

#[test]
fn malformed_or_foreign_cache_response_preserves_existing_records() {
    let (_disk,mut conn) = Database::new();
    let record = json!({"id":uuid::Uuid::new_v4().to_string(),"item_id":ITEM,"outstanding_quantity":2});
    cache_custody(&mut conn,ITEM,&json!([record]).to_string(),ACCOUNT).unwrap();
    let before = snapshot(&conn);
    let mut foreign = record.clone();
    foreign["item_id"] = json!(RECIPIENT);
    assert!(cache_custody(&mut conn,ITEM,&json!([foreign]).to_string(),ACCOUNT).is_err());
    assert!(cache_custody(&mut conn,ITEM,&json!([record,{"id":"invalid"}]).to_string(),ACCOUNT).is_err());
    assert!(cache_custody(&mut conn,ITEM,&json!([record,record]).to_string(),ACCOUNT).is_err());
    let mut collision = record.clone();
    collision["item_id"] = json!(RECIPIENT);
    assert!(cache_custody(&mut conn,RECIPIENT,&json!([collision]).to_string(),ACCOUNT).is_err());
    assert_eq!(snapshot(&conn),before);
}

#[test]
fn competing_local_writer_cannot_apply_a_stale_stock_base() {
    let (disk,mut first) = Database::new();
    let mut second = disk.reopen();
    let first_request = input(&first,&issue());
    let second_request = input(&second,&issue());
    save_custody_movement(&mut first,first_request).unwrap();
    let before = snapshot(&first);
    assert!(save_custody_movement(&mut second,second_request).unwrap_err().contains("changed while"));
    assert_eq!(snapshot(&first),before);
    assert_eq!(snapshot(&second),before);
}

#[test]
fn failed_recipient_transfer_restores_both_custodies_and_stock() {
    let (_disk,mut conn) = Database::new();
    let movement = issue();
    let request = input(&conn,&movement);
    save_custody_movement(&mut conn,request).unwrap();
    conn.execute("INSERT INTO local_assignee_directory(user_id,account_id,directory_json) VALUES(?1,?2,?3)",params![format!("account:{ACCOUNT}:{ACCOUNT}"),ACCOUNT,json!({"id":ACCOUNT}).to_string()]).unwrap();
    let transfer_id = uuid::Uuid::new_v4().to_string();
    let transfer = json!({"id":transfer_id,"item_id":ITEM,"custody_id":movement["id"],"movement_type":"transfer","quantity":1,"transfer_recipient_id":ACCOUNT,"created_at":"2026-10-19T13:00:00Z"});
    // Failure comes after the source custody has already been decremented.
    conn.execute_batch(&format!("CREATE TEMP TRIGGER fail_transfer BEFORE INSERT ON local_inventory_custody_records WHEN NEW.custody_id='account:{ACCOUNT}:{transfer_id}' BEGIN SELECT RAISE(ABORT,'injected transfer failure'); END;")).unwrap();
    let before = snapshot(&conn);
    let request = input(&conn,&transfer);
    assert!(save_custody_movement(&mut conn,request).unwrap_err().contains("injected transfer failure"));
    assert_eq!(snapshot(&conn),before);
    conn.execute_batch("DROP TRIGGER fail_transfer").unwrap();
    let request = input(&conn,&transfer);
    save_custody_movement(&mut conn,request).unwrap();
    let after = snapshot(&conn);
    assert_eq!(after["items"][0]["current_quantity"],6.0);
    assert_eq!(after["custody"][0]["outstanding_quantity"],3.0);
    assert_eq!(after["custody"][1]["outstanding_quantity"],1.0);
    assert_eq!(after["custody"][1]["recipient_id"],ACCOUNT);
}

fn reject(conn:&Connection,change:&str,code:&str) {
    conn.execute("INSERT INTO sync_conflicts(change_id,entity_type,entity_id,operation,payload_json,error_code,error_message) SELECT change_id,entity_type,entity_id,operation,payload_json,?2,'probe rejection' FROM sync_outbox WHERE change_id=?1 ON CONFLICT(change_id) DO UPDATE SET error_code=excluded.error_code,resolved_at=NULL,resolution=NULL",params![change,code]).unwrap();
}

#[test]
fn rejected_custody_retry_preserves_original_identity_payload_and_balances() {
    let (_disk,mut conn)=Database::new();
    let request=input(&conn,&issue());let change=request.change_id.clone();
    save_custody_movement(&mut conn,request).unwrap();reject(&conn,&change,"PERMISSION_DENIED");
    let before=snapshot(&conn);
    local_db::resolve_conflict(&mut conn,&change,"keep_local").unwrap();
    assert_eq!(snapshot(&conn),before);
    assert_eq!(conn.query_row("SELECT COUNT(*) FROM active_sync_outbox WHERE synced_at IS NULL",[],|r|r.get::<_,i64>(0)).unwrap(),1);
    reject(&conn,&change,"SYNC_CONFLICT");
    assert!(local_db::resolve_conflict(&mut conn,&change,"keep_local").unwrap_err().contains("Automatic overwrite"));
    assert_eq!(snapshot(&conn),before);
}

#[test]
fn accepting_server_preserves_recovery_and_blocks_new_stock_writes_until_pull() {
    let (disk,mut conn)=Database::new();
    let movement=issue();let request=input(&conn,&movement);let change=request.change_id.clone();
    save_custody_movement(&mut conn,request).unwrap();
    let returned=json!({"id":uuid::Uuid::new_v4().to_string(),"item_id":ITEM,"custody_id":movement["id"],"movement_type":"return","quantity":1,"created_at":"2026-10-19T13:00:00Z"});
    let request=input(&conn,&returned);save_custody_movement(&mut conn,request).unwrap();
    reject(&conn,&change,"EXCESSIVE_SETTLEMENT");let before=snapshot(&conn);
    local_db::resolve_conflict(&mut conn,&change,"accept_server").unwrap();
    assert!(records(&conn,"local_inventory_custody_records","custody_json").is_empty());
    assert_eq!(records(&conn,"sync_outbox","payload_json"),before["outbox"].as_array().unwrap().clone());
    assert_eq!(conn.query_row("SELECT COUNT(*) FROM active_sync_outbox WHERE synced_at IS NULL",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    let raw:String=conn.query_row("SELECT value FROM sync_state WHERE key LIKE ?1",[format!("account:{ACCOUNT}:inventory_recovery_%")],|r|r.get(0)).unwrap();
    let archived:Value=serde_json::from_str(&raw).unwrap();
    assert_eq!(archived["account_id"],ACCOUNT);assert_eq!(archived["custody"],before["custody"]);
    assert_eq!(archived["items"],before["items"]);assert_eq!(archived["change_ids"].as_array().unwrap().len(),2);
    drop(conn);let mut conn=disk.reopen();
    let request=input(&conn,&issue());
    assert!(save_custody_movement(&mut conn,request).unwrap_err().contains("preserved for recovery"));
    assert!(state::merge(&mut conn,RECIPIENT,vec![json!({"id":ITEM,"current_quantity":9,"sync_version":5})],vec![],Some("wrong-account")).is_err());
    let request=input(&conn,&issue());assert!(save_custody_movement(&mut conn,request).is_err());
    state::merge(&mut conn,ACCOUNT,vec![json!({"id":ITEM,"current_quantity":9,"sync_version":5})],vec![],Some("reconciled")).unwrap();
    let request=input(&conn,&issue());save_custody_movement(&mut conn,request).unwrap();
    assert_eq!(state::read(&conn).unwrap().unwrap()[0]["current_quantity"],5.0);
    let retained:String=conn.query_row("SELECT value FROM sync_state WHERE key LIKE ?1",[format!("account:{ACCOUNT}:inventory_recovery_%")],|r|r.get(0)).unwrap();
    assert_eq!(retained,raw);
}

#[test]
fn failed_recovery_archive_does_not_retire_or_erase_rejected_work() {
    let (_disk,mut conn)=Database::new();
    let request=input(&conn,&issue());let change=request.change_id.clone();
    save_custody_movement(&mut conn,request).unwrap();reject(&conn,&change,"EXCESSIVE_SETTLEMENT");
    let before=snapshot(&conn);
    conn.execute_batch("CREATE TEMP TRIGGER fail_recovery BEFORE INSERT ON sync_state WHEN NEW.key LIKE '%:inventory_recovery_%' BEGIN SELECT RAISE(ABORT,'injected recovery failure'); END;").unwrap();
    assert!(local_db::resolve_conflict(&mut conn,&change,"accept_server").unwrap_err().contains("injected recovery failure"));
    assert_eq!(snapshot(&conn),before);
    assert_eq!(conn.query_row("SELECT COUNT(*) FROM active_sync_outbox WHERE synced_at IS NULL",[],|r|r.get::<_,i64>(0)).unwrap(),1);
    assert_eq!(conn.query_row("SELECT COUNT(*) FROM sync_conflicts WHERE resolved_at IS NULL",[],|r|r.get::<_,i64>(0)).unwrap(),1);
}

const PROJECT: &str = "40000000-0000-4000-8000-000000000001";
const RESERVATION: &str = "50000000-0000-4000-8000-000000000001";
const TASK: &str = "60000000-0000-4000-8000-000000000001";
const REQUIREMENT: &str = "70000000-0000-4000-8000-000000000001";

fn reservation_fixture(c: &Connection) -> Value {
    c.execute_batch("ALTER TABLE local_users ADD COLUMN role TEXT DEFAULT 'admin'; UPDATE local_users SET permissions_json='[\"inventory.view\",\"inventory.adjust_stock\",\"projects.view\",\"projects.edit\"]';").unwrap();
    let p = json!({"id":PROJECT,"status":"planning","visibility":"lab",
        "permissions":{"user_id":ACCOUNT,"can_edit":true,"access":"admin"},
        "tasks":[{"id":TASK,"project_id":PROJECT,"requirement_id":REQUIREMENT}],
        "requirements":[{"id":REQUIREMENT,"project_id":PROJECT}],
        "reservations":[{"id":RESERVATION,"project_id":PROJECT,"item_id":ITEM,"status":"confirmed",
            "quantity":6,"original_quantity":6,"fulfilled_quantity":0,"fulfillment_movement_ids":[]}]});
    store_project(c, &p); p
}
fn store_project(c: &Connection, p: &Value) {
    c.execute("INSERT INTO sync_state(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![local_db::scoped_state_key(c,"projects_state").unwrap(),json!([p]).to_string()]).unwrap();
}
fn reserved_issue() -> Value {
    let mut m=issue();m["project_id"]=json!(PROJECT.replace('-',""));
    m["reservation_id"]=json!(RESERVATION.replace('-',""));m["task_id"]=json!(TASK);
    m["quantity"]=json!(2);m
}
fn projected(c: &Connection) -> Value {
    let mut p=crate::local_projects::load_all(c).unwrap().remove(0);
    reservations::project(c,&mut p).unwrap();p["reservations"][0].clone()
}

#[test]
fn inventory_reservation_ack_gap_and_included_movement_survive_reopen() {
    let (disk,mut c)=Database::new();let mut p=reservation_fixture(&c);
    let m=reserved_issue();let mut request=input(&c,&m);
    // Existing producers also use compact change IDs; retain their exact receipt identity.
    request.change_id=request.change_id.replace('-',"");
    let change=request.change_id.clone();
    save_custody_movement(&mut c,request).unwrap();
    assert_eq!(projected(&c)["quantity"],4.0);
    let payload=records(&c,"sync_outbox","payload_json").remove(0);
    assert_eq!(payload["project_id"],PROJECT);assert_eq!(payload["reservation_id"],RESERVATION);
    assert_eq!(payload["requirement_id"],REQUIREMENT);
    assert_eq!(reservations::overlays(&c).unwrap()[0]["change_id"],change);
    // A lost ACK can allow a newer server snapshot to arrive first.
    p["reservations"][0]["quantity"]=json!(4);
    p["reservations"][0]["fulfilled_quantity"]=json!(2);
    p["reservations"][0]["fulfillment_movement_ids"]=json!([m["id"]]);
    store_project(&c,&p);
    assert_eq!(projected(&c)["quantity"],4.0);
    assert_eq!(projected(&c)["local_pending_issue_quantity"],0.0);
    local_db::mark_changes_synced(&mut c,vec![change]).unwrap();
    // A stale response after ACK must not resurrect the allocated stock.
    p["reservations"][0]["quantity"]=json!(6);
    p["reservations"][0]["fulfilled_quantity"]=json!(0);
    p["reservations"][0]["fulfillment_movement_ids"]=json!([]);
    store_project(&c,&p);drop(c);
    let mut c=disk.reopen();
    assert_eq!(projected(&c)["quantity"],4.0);
    let mut excess=reserved_issue();excess["quantity"]=json!(5);
    let before=snapshot(&c);let request=input(&c,&excess);
    assert!(save_custody_movement(&mut c,request).unwrap_err().contains("remaining"));
    assert_eq!(snapshot(&c),before);
}

#[test]
fn inventory_reservation_overlay_and_outbox_failure_are_atomic() {
    for boundary in ["overlay","outbox"] {
        let (disk,mut c)=Database::new();reservation_fixture(&c);
        let before=snapshot(&c);let reservation=projected(&c);
        let sql=if boundary=="overlay" {
            "CREATE TEMP TRIGGER fail_reserved BEFORE INSERT ON sync_state WHEN NEW.key GLOB '*:reservation_issue_*' BEGIN SELECT RAISE(ABORT,'injected allocation failure'); END;"
        } else {
            "CREATE TEMP TRIGGER fail_reserved BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT,'injected allocation failure'); END;"
        };
        c.execute_batch(sql).unwrap();
        let request=input(&c,&reserved_issue());
        assert!(save_custody_movement(&mut c,request).unwrap_err().contains("injected allocation failure"));
        assert_eq!(snapshot(&c),before);assert_eq!(projected(&c),reservation);
        assert!(reservations::overlays(&c).unwrap().is_empty());
        drop(c);let c=disk.reopen();assert_eq!(snapshot(&c),before);
        assert!(reservations::overlays(&c).unwrap().is_empty());
    }
}

#[test]
fn inventory_reservation_scope_permissions_and_old_snapshots_fail_closed() {
    for mode in ["project","item","closed","access","permission","task","requirement","proof","status","quantity"] {
        let (_disk,mut c)=Database::new();let mut p=reservation_fixture(&c);let mut m=reserved_issue();
        match mode {
            "project"=>m["project_id"]=json!(RECIPIENT),
            "item"=>p["reservations"][0]["item_id"]=json!(RECIPIENT),
            "closed"=>p["status"]=json!("cancelled"),
            "access"=>p["permissions"]["can_edit"]=json!(false),
            "permission"=>{c.execute("UPDATE local_users SET permissions_json='[\"inventory.view\",\"inventory.adjust_stock\",\"projects.view\"]'",[]).unwrap();},
            "task"=>m["task_id"]=json!(RECIPIENT),
            "requirement"=>m["requirement_id"]=json!(RECIPIENT),
            "proof"=>{p["reservations"][0].as_object_mut().unwrap().remove("fulfillment_movement_ids");},
            "status"=>p["reservations"][0]["status"]=json!("released"),
            _=>m["quantity"]=json!(0.0001),
        }
        store_project(&c,&p);let before=snapshot(&c);let request=input(&c,&m);
        assert!(save_custody_movement(&mut c,request).is_err(),"{mode}");
        assert_eq!(snapshot(&c),before,"{mode}");assert!(reservations::overlays(&c).unwrap().is_empty());
    }
}

#[test]
fn inventory_reservation_return_does_not_reopen_allocation() {
    let (_disk,mut c)=Database::new();reservation_fixture(&c);
    let mut m=reserved_issue();m["quantity"]=json!(6);
    let request=input(&c,&m);save_custody_movement(&mut c,request).unwrap();
    assert_eq!(projected(&c)["quantity"],0.0);assert_eq!(projected(&c)["status"],"fulfilled");
    let returned=json!({"id":uuid::Uuid::new_v4().to_string(),"item_id":ITEM,"custody_id":m["id"],
        "movement_type":"return","quantity":1,"created_at":"2026-10-20T12:00:00Z"});
    let request=input(&c,&returned);save_custody_movement(&mut c,request).unwrap();
    assert_eq!(state::read(&c).unwrap().unwrap()[0]["current_quantity"],5.0);
    assert_eq!(projected(&c)["quantity"],0.0);assert_eq!(reservations::overlays(&c).unwrap().len(),1);
}

#[test]
fn inventory_reservation_conflict_retirement_archives_overlay_atomically() {
    let (_disk,mut c)=Database::new();reservation_fixture(&c);
    let mut request=input(&c,&reserved_issue());request.change_id=request.change_id.replace('-',"");
    let change=request.change_id.clone();save_custody_movement(&mut c,request).unwrap();
    reject(&c,&change,"RESERVATION_QUANTITY_CONFLICT");
    let overlay=reservations::overlays(&c).unwrap();
    c.execute_batch("CREATE TEMP TRIGGER fail_reservation_recovery BEFORE INSERT ON sync_state WHEN NEW.key GLOB '*:inventory_recovery_*' BEGIN SELECT RAISE(ABORT,'injected archive failure'); END;").unwrap();
    assert!(local_db::resolve_conflict(&mut c,&change,"accept_server").is_err());
    assert_eq!(reservations::overlays(&c).unwrap(),overlay);assert_eq!(projected(&c)["quantity"],4.0);
    c.execute_batch("DROP TRIGGER fail_reservation_recovery").unwrap();
    local_db::resolve_conflict(&mut c,&change,"accept_server").unwrap();
    assert!(reservations::overlays(&c).unwrap().is_empty());
    let raw:String=c.query_row("SELECT value FROM sync_state WHERE key GLOB '*:inventory_recovery_*'",[],|r|r.get(0)).unwrap();
    let recovery:Value=serde_json::from_str(&raw).unwrap();assert_eq!(recovery["reservation_issues"],json!(overlay));
    let request=input(&c,&reserved_issue());assert!(save_custody_movement(&mut c,request).is_err());
}

#[test]
fn inventory_reservation_remote_overallocation_is_visible_not_negative() {
    let (_disk,mut c)=Database::new();let mut p=reservation_fixture(&c);
    let request=input(&c,&reserved_issue());save_custody_movement(&mut c,request).unwrap();
    p["reservations"][0]["quantity"]=json!(1);store_project(&c,&p);
    assert!(projected(&c)["local_issue_error"].as_str().unwrap().contains("reconcile"));
    let request=input(&c,&reserved_issue());assert!(save_custody_movement(&mut c,request).is_err());
    assert_eq!(reservations::overlays(&c).unwrap().len(),1);
}
