// Opt-in: cargo test --no-default-features postgres_two_client -- --ignored --nocapture
// Uses production note save/merge functions, two isolated disk-backed SQLite
// clients, and the configured running PostgreSQL API. No application cache reset.
use super::*;
use std::{process::Command,path::PathBuf};

fn http(method:&str,path:&str,body:Value,token:&str)->Value {
    let base=std::env::var("LABOS_LIVE_API_URL").expect("LABOS_LIVE_API_URL required");
    assert!(base=="http://127.0.0.1:4000/api"||base=="http://localhost:4000/api","Only local LabOS is allowed");
    let output=Command::new("node").args(["-e",r#"(async()=>{const r=await fetch(process.env.LABOS_TEST_URL,{method:process.env.LABOS_TEST_METHOD,headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.LABOS_TEST_TOKEN},...(process.env.LABOS_TEST_METHOD==='GET'?{}:{body:process.env.LABOS_TEST_BODY})});const text=await r.text();if(!r.ok)throw new Error(r.status+': '+text);console.log(text||'{}')})().catch(e=>{console.error(e.message);process.exit(1)})"#])
        .env("LABOS_TEST_URL",format!("{base}{path}")).env("LABOS_TEST_METHOD",method).env("LABOS_TEST_BODY",body.to_string()).env("LABOS_TEST_TOKEN",token).output().unwrap();
    assert!(output.status.success(),"HTTP {method} {path}: {}",String::from_utf8_lossy(&output.stderr));
    serde_json::from_slice(&output.stdout).unwrap()
}
struct Fixture { directory:PathBuf, note_id:String, token:String }
impl Drop for Fixture {
    fn drop(&mut self){
        if !self.note_id.is_empty(){let _=std::panic::catch_unwind(||http("DELETE",&format!("/notes/{}",self.note_id),json!({}),&self.token));}
        // Directory was constructed from temp_dir plus a freshly generated UUID.
        let _=std::fs::remove_dir_all(&self.directory);
    }
}
fn client(path:&std::path::Path,account:&str)->Connection {
    let c=Connection::open(path).unwrap();local_db::ensure_schema(&c).unwrap();
    c.execute_batch("CREATE TABLE local_users(id TEXT PRIMARY KEY,central_user_id TEXT,is_active INTEGER,offline_expires_at TEXT,permissions_json TEXT); CREATE TABLE local_session(id INTEGER PRIMARY KEY,user_id TEXT);").unwrap();
    c.execute("INSERT INTO local_users VALUES('local',?1,1,datetime('now','+24 hours'),'[\"notes.view\",\"notes.create\",\"notes.edit\",\"notes.delete\"]')",[account]).unwrap();
    c.execute("INSERT INTO local_session VALUES(1,'local')",[]).unwrap();c
}
fn push(c:&Connection,token:&str)->Vec<String>{
    let device:String=c.query_row("SELECT device_id FROM device_identity",[],|r|r.get(0)).unwrap();
    let changes:Vec<Value>=c.prepare("SELECT change_id,entity_type,entity_id,operation,payload_json FROM active_sync_outbox WHERE synced_at IS NULL ORDER BY created_at,change_id").unwrap().query_map([],|r|{let payload:String=r.get(4)?;Ok(json!({"change_id":r.get::<_,String>(0)?,"entity_type":r.get::<_,String>(1)?,"entity_id":r.get::<_,String>(2)?,"operation":r.get::<_,String>(3)?,"payload":serde_json::from_str::<Value>(&payload).unwrap()}))}).unwrap().map(Result::unwrap).collect();
    let response=http("POST","/sync/push",json!({"device_id":device,"changes":changes}),token);
    assert_eq!(response["results"].as_array().unwrap().len(),changes.len());
    for result in response["results"].as_array().unwrap(){assert_eq!(result["status"],"synced","{result}");}
    changes.iter().map(|v|v["change_id"].as_str().unwrap().to_string()).collect()
}
fn pull(c:&mut Connection,account:&str,token:&str){
    let r=http("GET","/sync/notes/pull",Value::Null,token);
    apply_notes_pull(c,serde_json::from_value(r["notes"].clone()).unwrap(),serde_json::from_value(r["visible_note_ids"].clone()).unwrap(),serde_json::from_value(r["deleted_note_ids"].clone()).unwrap(),account).unwrap();
}

#[test]
#[ignore = "requires explicit local PostgreSQL API credentials"]
fn postgres_two_client_note_restart_replay_delete(){
    let login=http("POST","/auth/login",json!({"username":std::env::var("LABOS_LIVE_USERNAME").unwrap(),"password":std::env::var("LABOS_LIVE_PASSWORD").unwrap()}),"");
    let token=login["token"].as_str().unwrap();let account=login["user"]["id"].as_str().unwrap();
    let directory=std::env::temp_dir().join(format!("labos-live-notes-{}",id()));std::fs::create_dir(&directory).unwrap();
    let mut fixture=Fixture{directory:directory.clone(),note_id:String::new(),token:token.to_string()};
    let a_path=directory.join("client-a.db");let mut a=client(&a_path,account);let mut b=client(&directory.join("client-b.db"),account);
    let note=create_note(&mut a,json!({"title":format!("LABOS-TWO-CLIENT-{}",id()),"body":"offline authored intent","visibility":"lab"})).unwrap();
    let nid=note["id"].as_str().unwrap();fixture.note_id=nid.to_string();
    assert!(uuid::Uuid::parse_str(nid).is_ok());
    drop(a);let mut a=Connection::open(&a_path).unwrap();
    assert_eq!(load(&a).unwrap().iter().filter(|n|n["id"]==nid).count(),1,"Offline restart must preserve one local note");
    let keys=push(&a,token);assert_eq!(push(&a,token),keys,"Lost acknowledgement replay reuses original keys");
    for key in &keys{a.execute("UPDATE sync_outbox SET synced_at=CURRENT_TIMESTAMP WHERE change_id=?1",[key]).unwrap();}
    pull(&mut a,account,token);pull(&mut b,account,token);pull(&mut b,account,token);
    for c in [&a,&b]{let rows=load(c).unwrap();let matching:Vec<_>=rows.iter().filter(|n|n["id"]==nid).collect();assert_eq!(matching.len(),1);assert_eq!(matching[0]["author_id"],account);}
    // A conflicting duplicate outbox key must roll back the accompanying cache write.
    let unchanged=load(&a).unwrap();
    assert!(save(&mut a,&[],vec![(keys[0].clone(),"note".into(),nid.into(),"update".into(),note.clone())]).is_err());assert_eq!(load(&a).unwrap(),unchanged);
    let mut remaining=load(&a).unwrap();remaining.retain(|n|n["id"]!=nid);
    save(&mut a,&remaining,vec![(id(),"note".into(),nid.into(),"delete".into(),json!({"note":note}))]).unwrap();
    let deletes=push(&a,token);assert_eq!(push(&a,token),deletes);
    for key in &deletes{a.execute("UPDATE sync_outbox SET synced_at=CURRENT_TIMESTAMP WHERE change_id=?1",[key]).unwrap();}
    pull(&mut a,account,token);pull(&mut b,account,token);
    assert!(load(&a).unwrap().iter().all(|n|n["id"]!=nid));assert!(load(&b).unwrap().iter().all(|n|n["id"]!=nid));
    println!("PostgreSQL two-client PASS: offline disk restart, atomic rollback, stable UUID, lost-ack replay, author, repeated pull, replayed delete. Test note: {nid}");
    fixture.note_id.clear();drop(a);drop(b);
}
