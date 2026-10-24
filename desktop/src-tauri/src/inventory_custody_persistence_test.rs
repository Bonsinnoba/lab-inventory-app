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

fn intent(operation:&str,reservation:&str,payload:Value)->crate::local_reservations::ReservationIntentInput {
    crate::local_reservations::ReservationIntentInput{expected_account_id:ACCOUNT.into(),change_id:uuid::Uuid::new_v4().to_string(),reservation_id:reservation.into(),operation:operation.into(),payload}
}

#[test]
fn inventory_reservation_intent_request_survives_ack_and_reopen_without_stock_authority(){
    let (disk,mut c)=Database::new();reservation_fixture(&c);
    let id=uuid::Uuid::new_v4().to_string();
    let request=intent("request",&id,json!({"project_id":PROJECT,"item_id":ITEM,"quantity":2,"needed_from":"2026-10-21T12:00:00Z"}));
    let change=request.change_id.clone();
    crate::local_reservations::save(&mut c,request).unwrap();
    local_db::mark_changes_synced(&mut c,vec![change.clone()]).unwrap();
    drop(c);let c=disk.reopen();
    let mut p=crate::local_projects::load_all(&c).unwrap().remove(0);
    crate::local_reservations::project(&c,&mut p).unwrap();
    let row=p["reservations"].as_array().unwrap().iter().find(|r|r["id"]==id).unwrap();
    assert_eq!(row["status"],"proposed");assert_eq!(row["local_pending_action"],"request");
    assert_eq!(state::read(&c).unwrap().unwrap()[0]["current_quantity"],10);
    let row=p["reservations"].as_array_mut().unwrap().iter_mut().find(|r|r["id"]==id).unwrap();
    row["status"]=json!("pending_review");row["applied_intent_ids"]=json!([change]);
    row.as_object_mut().unwrap().remove("local_pending_action");row.as_object_mut().unwrap().remove("local_issue_error");
    crate::local_reservations::project(&c,&mut p).unwrap();
    assert_eq!(p["reservations"].as_array().unwrap().last().unwrap()["status"],"pending_review");
}

#[test]
fn inventory_reservation_pending_release_blocks_issue_and_duplicate_review(){
    let (_disk,mut c)=Database::new();let mut p=reservation_fixture(&c);
    p["reservations"][0]["applied_intent_ids"]=json!([]);store_project(&c,&p);
    let payload=json!({"project_id":PROJECT,"decision":"release","review_note":""});
    crate::local_reservations::save(&mut c,intent("decision",RESERVATION,payload.clone())).unwrap();
    let request=input(&c,&reserved_issue());assert!(save_custody_movement(&mut c,request).is_err());
    assert!(crate::local_reservations::save(&mut c,intent("decision",RESERVATION,payload)).is_err());
    assert_eq!(state::read(&c).unwrap().unwrap()[0]["current_quantity"],10);
}

#[test]
fn inventory_reservation_intent_outbox_failure_rolls_back_overlay(){
    let (_disk,mut c)=Database::new();reservation_fixture(&c);
    c.execute_batch("CREATE TEMP TRIGGER fail_intent BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT,'injected outbox failure'); END;").unwrap();
    let before=snapshot(&c);
    let request=intent("request",&uuid::Uuid::new_v4().to_string(),json!({"project_id":PROJECT,"item_id":ITEM,"quantity":2,"needed_from":"2026-10-21T12:00:00Z"}));
    assert!(crate::local_reservations::save(&mut c,request).unwrap_err().contains("injected outbox failure"));
    let mut p=crate::local_projects::load_all(&c).unwrap().remove(0);let original=p.clone();
    crate::local_reservations::project(&c,&mut p).unwrap();assert_eq!(p,original);assert_eq!(snapshot(&c),before);
}

#[test]
fn inventory_reservation_review_conflict_retains_authorship_and_blocks_stale_authority(){
    let (_disk,mut c)=Database::new();let mut p=reservation_fixture(&c);
    p["reservations"][0]["applied_intent_ids"]=json!([]);store_project(&c,&p);
    let request=intent("decision",RESERVATION,json!({"project_id":PROJECT,"decision":"release","review_note":"review"}));
    let change=request.change_id.clone();crate::local_reservations::save(&mut c,request).unwrap();
    let original=records(&c,"sync_outbox","payload_json");reject(&c,&change,"RESERVATION_STATE_CONFLICT");
    local_db::resolve_conflict(&mut c,&change,"accept_server").unwrap();
    assert_eq!(records(&c,"sync_outbox","payload_json"),original);
    let count:i64=c.query_row("SELECT COUNT(*) FROM sync_state WHERE key GLOB '*:reservation_recovery_*'",[],|r|r.get(0)).unwrap();assert_eq!(count,1);
    crate::local_reservations::project(&c,&mut p).unwrap();assert_eq!(p["reservations"][0]["local_pending_action"],"reconcile");
    let issue=input(&c,&reserved_issue());assert!(save_custody_movement(&mut c,issue).is_err());
}

#[test]
fn inventory_reserved_consumption_is_atomic_survives_reopen_and_cannot_duplicate(){
    let (disk,mut c)=Database::new();reservation_fixture(&c);
    let mut items=state::read(&c).unwrap().unwrap();items[0]["type"]=json!("component");state::write(&c,&items).unwrap();
    let mut movement=reserved_issue();movement["movement_type"]=json!("consume");movement.as_object_mut().unwrap().remove("recipient_id");
    let request=input(&c,&movement);save_custody_movement(&mut c,request).unwrap();
    let once=snapshot(&c);assert_eq!(once["items"][0]["current_quantity"],8.0);assert_eq!(projected(&c)["quantity"],4.0);
    assert!(once["custody"].as_array().unwrap().is_empty());assert_eq!(once["outbox"][0]["movement_type"],"consume");
    drop(c);let mut c=disk.reopen();assert_eq!(snapshot(&c),once);
    let request=input(&c,&movement);assert!(save_custody_movement(&mut c,request).is_err());assert_eq!(snapshot(&c),once);assert_eq!(projected(&c)["quantity"],4.0);
}

#[test]
fn inventory_reservation_retry_rechecks_role_and_preserves_intent(){
    let (_disk,mut c)=Database::new();let mut p=reservation_fixture(&c);
    p["reservations"][0]["applied_intent_ids"]=json!([]);store_project(&c,&p);
    let request=intent("decision",RESERVATION,json!({"project_id":PROJECT,"decision":"release","review_note":"Preserve this review"}));
    let change=request.change_id.clone();crate::local_reservations::save(&mut c,request).unwrap();
    reject(&c,&change,"RESERVATION_STATE_CONFLICT");let original=records(&c,"sync_outbox","payload_json");
    c.execute("UPDATE local_users SET role='member'",[]).unwrap();
    assert!(local_db::resolve_conflict(&mut c,&change,"keep_local").is_err());
    assert_eq!(records(&c,"sync_outbox","payload_json"),original);
    c.execute("UPDATE local_users SET role='admin'",[]).unwrap();
    local_db::resolve_conflict(&mut c,&change,"keep_local").unwrap();
    assert_eq!(records(&c,"sync_outbox","payload_json"),original);
}

#[test]
fn inventory_reserved_consumption_rejects_returnables_and_rolls_back_failed_outbox(){
    for kind in ["equipment","instrument","tool","component"]{
        let (_disk,mut c)=Database::new();reservation_fixture(&c);
        let mut items=state::read(&c).unwrap().unwrap();items[0]["type"]=json!(kind);state::write(&c,&items).unwrap();
        if kind=="component"{c.execute_batch("CREATE TEMP TRIGGER fail_consume BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT,'injected consumption failure'); END;").unwrap();}
        let before=snapshot(&c);let mut movement=reserved_issue();movement["movement_type"]=json!("consume");movement.as_object_mut().unwrap().remove("recipient_id");
        let request=input(&c,&movement);assert!(save_custody_movement(&mut c,request).is_err());assert_eq!(snapshot(&c),before);assert_eq!(projected(&c)["quantity"],6.0);
    }
}

#[test]
fn inventory_reserved_consumption_reconciliation_handles_lost_ack_and_repeated_snapshots(){
    for ack_first in [false,true]{
        let (disk,mut c)=Database::new();let mut project=reservation_fixture(&c);
        let mut items=state::read(&c).unwrap().unwrap();items[0]["type"]=json!("component");state::write(&c,&items).unwrap();
        let mut movement=reserved_issue();movement["movement_type"]=json!("consume");movement.as_object_mut().unwrap().remove("recipient_id");
        let request=input(&c,&movement);let change=request.change_id.clone();save_custody_movement(&mut c,request).unwrap();
        if ack_first{local_db::mark_changes_synced(&mut c,vec![change.clone()]).unwrap();}
        drop(c);let mut c=disk.reopen();
        assert_eq!(projected(&c)["quantity"],4.0,"ACK alone cannot restore allocation");
        project["reservations"][0]["quantity"]=json!(4);
        project["reservations"][0]["fulfilled_quantity"]=json!(2);
        project["reservations"][0]["fulfillment_movement_ids"]=json!([movement["id"]]);
        for _ in 0..3{store_project(&c,&project);assert_eq!(projected(&c)["quantity"],4.0);assert_eq!(projected(&c)["fulfilled_quantity"],2);assert_eq!(projected(&c)["local_pending_issue_quantity"],0.0);}
        if !ack_first{local_db::mark_changes_synced(&mut c,vec![change]).unwrap();}
        let mut authoritative=items.clone();authoritative[0]["current_quantity"]=json!(8);authoritative[0]["sync_version"]=json!(2);
        state::merge(&mut c,ACCOUNT,authoritative.clone(),vec![],None).unwrap();
        state::merge(&mut c,ACCOUNT,authoritative,vec![],None).unwrap();
        assert_eq!(state::read(&c).unwrap().unwrap()[0]["current_quantity"],8);
        assert_eq!(projected(&c)["quantity"],4.0);
        assert_eq!(records(&c,"local_inventory_movement_records","movement_json").len(),1);
        assert_eq!(records(&c,"sync_outbox","payload_json").len(),1);
    }
}

#[test]
#[ignore="requires explicit LABOS_RESERVATION_LIVE=1, real Docker API outage and PostgreSQL fixture"]
fn inventory_reserved_consumption_live_http_reconnect(){
    use std::io::Write;
    use std::process::{Command,Stdio};
    use crate::local_system::live_tests::http;
    assert_eq!(std::env::var("LABOS_RESERVATION_LIVE").as_deref(),Ok("1"));
    fn fixture(action:&str,account:&str)->Value{
        let source=include_str!("../../../backend/src/reservation-client-fixture.mjs").replace("'./db.js'","'file:///app/src/db.js'").replace("'./config.js'","'file:///app/src/config.js'");
        let mut child=Command::new("docker").args(["exec","-i","-e",&format!("LABOS_RESERVATION_FIXTURE_ID={account}"),"-e",&format!("LABOS_RESERVATION_FIXTURE_ACTION={action}"),"labos-labos-api-1","node","--input-type=module"]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
        child.stdin.take().unwrap().write_all(source.as_bytes()).unwrap();let out=child.wait_with_output().unwrap();
        assert!(out.status.success(),"Fixture {action}: {}",String::from_utf8_lossy(&out.stderr));serde_json::from_slice(&out.stdout).unwrap()
    }
    fn api(action:&str){assert!(Command::new("docker").args([action,"labos-labos-api-1"]).output().unwrap().status.success());}
    struct Cleanup(String);
    impl Drop for Cleanup{fn drop(&mut self){let result=std::panic::catch_unwind(||fixture("cleanup",&self.0));assert!(result.is_ok(),"Fixture cleanup failed for {}",self.0);}}
    let account=uuid::Uuid::new_v4().to_string();let f=fixture("create",&account);let _cleanup=Cleanup(account.clone());let token=f["token"].as_str().unwrap();
    let item_id=f["item"].as_str().unwrap();let project_id=f["project"].as_str().unwrap();
    let (disk,mut c)=Database::new();
    c.execute("UPDATE local_users SET central_user_id=?1",[&account]).unwrap();
    c.execute_batch("ALTER TABLE local_users ADD COLUMN role TEXT DEFAULT 'admin'; UPDATE local_users SET permissions_json='[\"inventory.view\",\"inventory.adjust_stock\",\"projects.view\",\"projects.edit\"]';").unwrap();
    let pull=||{let r=http("GET","/sync/projects/pull",Value::Null,token,"");assert_eq!(r["status"],200);r["body"]["projects"].as_array().unwrap().iter().find(|p|p["id"]==project_id).unwrap().clone()};
    let item=||{let r=http("GET",&format!("/items/{item_id}"),Value::Null,token,"");assert_eq!(r["status"],200);r["body"].clone()};
    store_project(&c,&pull());state::write(&c,&[item()]).unwrap();
    api("stop");
    let offline=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||{
        let movement=json!({"id":uuid::Uuid::new_v4().to_string(),"item_id":item_id,"movement_type":"consume","quantity":2,"project_id":project_id,"reservation_id":f["reservation"],"created_at":"2026-10-21T07:00:00Z"});
        let base=json!(state::read(&c).unwrap().unwrap()).to_string();
        save_custody_movement(&mut c,LocalCustodyWriteInput{expected_snapshot_json:base,expected_account_id:account.clone(),movement_json:movement.to_string(),change_id:uuid::Uuid::new_v4().to_string(),item_id:item_id.into()}).unwrap();
    }));
    api("start");
    if let Err(e)=offline{std::panic::resume_unwind(e);}
    drop(c);let mut c=disk.reopen();
    let ready=Command::new("node").args(["-e","(async()=>{for(let i=0;i<60;i++){try{if((await fetch('http://127.0.0.1:4000/api/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,500));}process.exit(1)})()"] ).status().unwrap();assert!(ready.success());
    let device:String=c.query_row("SELECT device_id FROM device_identity",[],|r|r.get(0)).unwrap();
    let (change,payload):(String,String)=c.query_row("SELECT change_id,payload_json FROM sync_outbox",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();let payload:Value=serde_json::from_str(&payload).unwrap();
    let send=||{let r=http("POST","/sync/push",json!({"device_id":device,"changes":[{"change_id":change,"entity_type":"item_movement","entity_id":item_id,"operation":"create","payload":payload}]}),token,"");assert_eq!(r["status"],200);assert_eq!(r["body"]["results"][0]["status"],"synced","{}",r["body"]);r};
    let first=send(); // Simulate a lost response: deliberately do not ACK locally.
    store_project(&c,&pull());assert_eq!(projected(&c)["quantity"],4.0);
    assert_eq!(send(),first);local_db::mark_changes_synced(&mut c,vec![change.clone()]).unwrap();
    for _ in 0..2{state::merge(&mut c,&account,vec![item()],vec![],None).unwrap();store_project(&c,&pull());}
    let stock=state::read(&c).unwrap().unwrap()[0]["current_quantity"].clone();assert_eq!(stock.as_f64().or_else(||stock.as_str().and_then(|s|s.parse().ok())),Some(8.0));
    assert_eq!(projected(&c)["quantity"],4.0);assert_eq!(projected(&c)["local_pending_issue_quantity"],0.0);
    assert_eq!(projected(&c)["fulfillment_movement_ids"],json!([payload["id"]]));
    // Request/review lifecycle uses the same deployed HTTP path and isolated DB.
    let requested_id=uuid::Uuid::new_v4().to_string();let request_change=uuid::Uuid::new_v4().to_string();
    let queue=|c:&mut Connection,id:&str,change:&str,operation:&str,payload:Value|{
        crate::local_reservations::save(c,crate::local_reservations::ReservationIntentInput{expected_account_id:account.clone(),reservation_id:id.into(),change_id:change.into(),operation:operation.into(),payload})
    };
    let send_intent=|c:&Connection,change:&str|{
        let (entity,operation,raw):(String,String,String)=c.query_row("SELECT entity_id,operation,payload_json FROM sync_outbox WHERE change_id=?1",[change],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        let r=http("POST","/sync/push",json!({"device_id":device,"changes":[{"change_id":change,"entity_type":"project_reservation","entity_id":entity,"operation":operation,"payload":serde_json::from_str::<Value>(&raw).unwrap()}]}),token,"");
        assert_eq!(r["status"],200);r["body"]["results"][0].clone()
    };
    let row=|c:&Connection,id:&str|{
        let mut p=crate::local_projects::load_all(c).unwrap().remove(0);crate::local_reservations::project(c,&mut p).unwrap();
        p["reservations"].as_array().unwrap().iter().find(|r|r["id"]==id).unwrap().clone()
    };
    fn wait_ready(){assert!(Command::new("node").args(["-e","(async()=>{for(let i=0;i<60;i++){try{if((await fetch('http://127.0.0.1:4000/api/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,500));}process.exit(1)})()"] ).status().unwrap().success());}
    api("stop");
    let offline=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||{
        queue(&mut c,&requested_id,&request_change,"request",json!({"project_id":project_id,"item_id":item_id,"quantity":5,"needed_from":"2026-10-21T00:00:00Z"})).unwrap();
        assert_eq!(row(&c,&requested_id)["status"],"proposed");
    }));api("start");wait_ready();if let Err(e)=offline{std::panic::resume_unwind(e);}
    let accepted=send_intent(&c,&request_change);assert_eq!(accepted["status"],"synced");assert_eq!(send_intent(&c,&request_change),accepted);
    store_project(&c,&pull());local_db::mark_changes_synced(&mut c,vec![request_change.clone()]).unwrap();
    assert_eq!(row(&c,&requested_id)["status"],"pending_review");assert!(row(&c,&requested_id)["local_pending_action"].is_null());
    let decision_change=uuid::Uuid::new_v4().to_string();
    api("stop");let offline=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||{
        queue(&mut c,&requested_id,&decision_change,"decision",json!({"project_id":project_id,"decision":"confirm","review_note":"Offline approval probe"})).unwrap();
        assert_eq!(row(&c,&requested_id)["status"],"pending_review");assert_eq!(row(&c,&requested_id)["local_pending_action"],"confirm");
    }));api("start");wait_ready();if let Err(e)=offline{std::panic::resume_unwind(e);}
    let original:String=c.query_row("SELECT payload_json FROM sync_outbox WHERE change_id=?1",[&decision_change],|r|r.get(0)).unwrap();
    let denied=send_intent(&c,&decision_change);assert_eq!(denied["status"],"rejected");assert_eq!(denied["error"]["code"],"RESERVATION_CONFLICT");
    reject(&c,&decision_change,"RESERVATION_CONFLICT");assert_eq!(send_intent(&c,&decision_change)["status"],"rejected");
    store_project(&c,&pull());assert_eq!(row(&c,&requested_id)["status"],"pending_review");assert_eq!(row(&c,&requested_id)["local_pending_action"],"confirm");
    let release_change=uuid::Uuid::new_v4().to_string();
    queue(&mut c,f["reservation"].as_str().unwrap(),&release_change,"decision",json!({"project_id":project_id,"decision":"release","review_note":"Free only unused allocation"})).unwrap();
    assert_eq!(send_intent(&c,&release_change)["status"],"synced");local_db::mark_changes_synced(&mut c,vec![release_change]).unwrap();store_project(&c,&pull());
    local_db::resolve_conflict(&mut c,&decision_change,"keep_local").unwrap();
    let retry_payload:String=c.query_row("SELECT payload_json FROM sync_outbox WHERE change_id=?1",[&decision_change],|r|r.get(0)).unwrap();assert_eq!(retry_payload,original);
    let approved=send_intent(&c,&decision_change);assert_eq!(approved["status"],"synced");assert_eq!(send_intent(&c,&decision_change),approved);
    local_db::mark_changes_synced(&mut c,vec![decision_change]).unwrap();assert_eq!(row(&c,&requested_id)["status"],"pending_review","ACK alone grants no authority");
    store_project(&c,&pull());assert_eq!(row(&c,&requested_id)["status"],"confirmed");assert!(row(&c,&requested_id)["local_pending_action"].is_null());
    let final_stock=item()["current_quantity"].clone();assert_eq!(final_stock.as_f64().or_else(||final_stock.as_str().and_then(|s|s.parse().ok())),Some(8.0));
    println!("PASS native/HTTP consumption and request-review lifecycle: offline saves, lost ACK, rejected approval preserved, unchanged retry after release, no premature authority or stock effects; fixture cleanup follows");
}
