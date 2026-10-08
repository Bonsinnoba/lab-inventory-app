use super::*;
use std::{path::PathBuf, process::Command};

fn fixture(action: &str, id: &str) -> Value {
    let out = Command::new("docker").args([
        "exec", "-e", "LABOS_PHASE2_PREFERENCES_PROBE=1", "labos-labos-api-1",
        "node", "src/phase2-preferences-client-fixture.mjs", action, id,
    ]).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    serde_json::from_slice(&out.stdout).unwrap()
}

fn http(method: &str, path: &str, body: Value, token: &str, key: &str) -> Value {
    let out = Command::new("node").args(["-e", r#"
      (async()=>{const r=await fetch('http://127.0.0.1:4000/api'+process.env.PATH_SUFFIX,
        {method:process.env.METHOD,headers:{'Content-Type':'application/json',
          Authorization:'Bearer '+process.env.TOKEN,'Idempotency-Key':process.env.KEY},
          ...(process.env.METHOD==='GET'?{}:{body:process.env.BODY})});
        console.log(JSON.stringify({status:r.status,body:await r.json()}))
      })().catch(e=>{console.error(e.message);process.exit(1)})"#])
        .env("PATH_SUFFIX", path).env("METHOD", method).env("TOKEN", token)
        .env("KEY", key).env("BODY", body.to_string()).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    serde_json::from_slice(&out.stdout).unwrap()
}

fn initialize(c: &Connection, account: &str) {
    local_db::ensure_schema(c).unwrap();
    c.execute_batch("CREATE TABLE local_users(id TEXT PRIMARY KEY,central_user_id TEXT,is_active INTEGER,offline_expires_at TEXT);
      CREATE TABLE local_session(id INTEGER PRIMARY KEY,user_id TEXT);").unwrap();
    c.execute("INSERT INTO local_users VALUES('a',?1,1,datetime('now','+24 hours'))", [account]).unwrap();
    c.execute("INSERT INTO local_session VALUES(1,'a')", []).unwrap();
}

fn push(c: &Connection, token: &str, acknowledge: bool) -> Value {
    let device: String = c.query_row("SELECT device_id FROM device_identity", [], |r| r.get(0)).unwrap();
    let changes: Vec<Value> = c.prepare("SELECT change_id,entity_id,payload_json FROM sync_outbox WHERE synced_at IS NULL AND change_id IN (SELECT change_id FROM active_sync_outbox) ORDER BY rowid")
        .unwrap().query_map([], |r| {
            let raw: String = r.get(2)?;
            Ok(json!({"change_id":r.get::<_,String>(0)?,"entity_id":r.get::<_,String>(1)?,
                "entity_type":"daily_preferences","operation":"update","payload":serde_json::from_str::<Value>(&raw).unwrap()}))
        }).unwrap().map(Result::unwrap).collect();
    let response = http("POST", "/sync/push", json!({"device_id":device,"changes":changes}), token, "");
    assert_eq!(response["status"], 200, "{response}");
    if acknowledge {
        for result in response["body"]["results"].as_array().unwrap() {
            assert_eq!(result["status"], "synced", "{result}");
            // ACK bookkeeping only; mutations and merges below use production code.
            c.execute("UPDATE sync_outbox SET synced_at=CURRENT_TIMESTAMP WHERE change_id=?1",
                [result["change_id"].as_str().unwrap()]).unwrap();
        }
    }
    response
}

fn merge(c: &mut Connection, account: &str, token: &str) {
    let response = http("GET", "/system/daily-preferences", Value::Null, token, "");
    assert_eq!(response["status"], 200, "{response}");
    pull(c, account, response["body"].clone()).unwrap();
}

fn restart_api_if_opted_in() {
    if std::env::var("LABOS_LIVE_RESTART_API").as_deref() != Ok("1") { return; }
    let out = Command::new("docker").args(["restart", "labos-labos-api-1"]).output().unwrap();
    assert!(out.status.success(), "API restart failed");
    let ready = Command::new("node").args(["-e", r#"
      (async()=>{for(let i=0;i<30;i++){
        try{if((await fetch('http://127.0.0.1:4000/api/health',{signal:AbortSignal.timeout(1000)})).ok)return}catch{}
        await new Promise(r=>setTimeout(r,500));
      }throw Error('API did not recover after restart')})().catch(e=>{console.error(e.message);process.exit(1)})
    "#]).output().unwrap();
    assert!(ready.status.success(), "{}", String::from_utf8_lossy(&ready.stderr));
    println!("API restart completed between committed write and lost-ACK replay.");
}

struct Cleanup { directory: PathBuf, accounts: Vec<String> }
impl Drop for Cleanup {
    fn drop(&mut self) {
        for account in &self.accounts {
            if std::panic::catch_unwind(|| fixture("cleanup", account)).is_err() {
                eprintln!("Fixture cleanup failed for {account}");
            }
        }
        // Only our freshly created, UUID-named temporary test directory.
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}

#[test]
#[ignore = "requires running local PostgreSQL API, Docker and explicit LABOS_PHASE2_PREFERENCES_PROBE=1"]
fn postgres_two_client_preferences_restart_browser_conflict_isolation() {
    assert_eq!(std::env::var("LABOS_PHASE2_PREFERENCES_PROBE").as_deref(), Ok("1"));
    let directory = std::env::temp_dir().join(format!("labos-live-preferences-{}", local_db::new_uuid()));
    std::fs::create_dir(&directory).unwrap();
    let mut cleanup = Cleanup { directory: directory.clone(), accounts: vec![] };
    let account = local_db::new_uuid();
    let token = fixture("create", &account)["token"].as_str().unwrap().to_owned();
    cleanup.accounts.push(account.clone());
    let other = local_db::new_uuid();
    let other_token = fixture("create", &other)["token"].as_str().unwrap().to_owned();
    cleanup.accounts.push(other.clone());
    let a_path = directory.join("a.db");
    let mut a = Connection::open(&a_path).unwrap(); initialize(&a, &account);
    let mut b = Connection::open(directory.join("b.db")).unwrap(); initialize(&b, &account);

    // Upgrade populated pre-hybrid data on A; B is a clean installation.
    write(&a, &json!({"music_volume":0.21,"auto_pause_music":true,"notifications_enabled":true})).unwrap();
    update(&mut b, &account, json!({"music_volume":0.83,"auto_pause_music":false}), &local_db::new_uuid()).unwrap();
    update(&mut a, &account, json!({"notifications_enabled":false,"expected_version":0}), &local_db::new_uuid()).unwrap();
    drop(a); let mut a = Connection::open(&a_path).unwrap();
    assert_eq!(read(&a).unwrap()["pending_sync"], true);
    let lost_ack = push(&a, &token, false);
    restart_api_if_opted_in();
    assert_eq!(push(&a, &token, true), lost_ack, "Lost ACK replays the same intent");
    for c in [&mut a, &mut b] { merge(c, &account, &token); merge(c, &account, &token); }
    assert_eq!(read(&a).unwrap()["music_volume"], 0.21);
    assert_eq!(read(&b).unwrap()["music_volume"], 0.83);
    assert_eq!(read(&b).unwrap()["notifications_enabled"], false);

    // B queues a change while A advances twice. B must not overwrite A.
    update(&mut b, &account, json!({"notifications_enabled":true,"expected_version":1}), &local_db::new_uuid()).unwrap();
    update(&mut a, &account, json!({"notifications_enabled":true,"expected_version":1}), &local_db::new_uuid()).unwrap();
    update(&mut a, &account, json!({"notifications_enabled":false,"expected_version":2}), &local_db::new_uuid()).unwrap();
    push(&a, &token, true); merge(&mut a, &account, &token);
    assert_eq!(push(&b, &token, false)["body"]["results"][0]["error"]["code"], "SYNC_CONFLICT");
    merge(&mut b, &account, &token);
    assert_eq!(read(&b).unwrap()["notifications_enabled"], true, "Pull preserves rejected authored work");

    // Browser HTTP contract: decoded lost response/retry shares one stable key.
    let key = local_db::new_uuid();
    let body = json!({"notifications_enabled":true,"expected_version":3});
    let browser = http("PATCH", "/system/daily-preferences", body.clone(), &token, &key);
    assert_eq!(browser["status"], 200, "{browser}");
    assert_eq!(http("PATCH", "/system/daily-preferences", body, &token, &key), browser);
    merge(&mut a, &account, &token);
    assert_eq!(read(&a).unwrap()["sync_version"], 4);
    assert_eq!(read(&a).unwrap()["auto_pause_music"], true);

    // Switching accounts cannot view or upload the previous account's pending work.
    b.execute("INSERT INTO local_users VALUES('b',?1,1,datetime('now','+24 hours'))", [&other]).unwrap();
    b.execute("UPDATE local_session SET user_id='b'", []).unwrap();
    assert_eq!(read(&b).unwrap()["music_volume"], 0.7);
    assert_eq!(read(&b).unwrap()["pending_sync"], false);
    assert!(pull(&mut b, &account, browser["body"].clone()).is_err());
    merge(&mut b, &other, &other_token);
    b.execute("UPDATE local_session SET user_id='a'", []).unwrap();
    assert_eq!(read(&b).unwrap()["pending_sync"], true);
    assert_eq!(read(&b).unwrap()["music_volume"], 0.83);

    fixture("disable", &account);
    assert_eq!(http("GET", "/system/daily-preferences", Value::Null, &token, "")["status"], 401);
    assert_eq!(read(&b).unwrap()["pending_sync"], true, "Rejected account work stays saved");
    drop(a); drop(b);
    println!("PASS actual PostgreSQL + two disk SQLite clients: upgrade/defaults, offline restart, lost ACK replay, chained edits, stale conflict, browser HTTP parity, device media and account isolation, disabled account.");
}
