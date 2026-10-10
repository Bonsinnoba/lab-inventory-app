use super::*;
use crate::local_system::live_tests::http;
fn fixture(action:&str,id:&str)->Value{
    let out=std::process::Command::new("docker").args(["exec","-e","LABOS_PHASE2_COMMENTS_PROBE=1","labos-labos-api-1","node","src/phase2-comments-client-fixture.mjs",action,id]).output().unwrap();
    assert!(out.status.success(),"{}",String::from_utf8_lossy(&out.stderr));serde_json::from_slice(&out.stdout).unwrap()
}
fn initialize(c:&Connection,account:&str,project:&str){
    local_db::ensure_schema(c).unwrap();
    c.execute_batch("CREATE TABLE local_users(id TEXT PRIMARY KEY,central_user_id TEXT,role TEXT,username TEXT,is_active INTEGER,offline_expires_at TEXT,permissions_json TEXT);CREATE TABLE local_session(id INTEGER PRIMARY KEY,user_id TEXT);").unwrap();
    c.execute("INSERT INTO local_users VALUES('a',?1,'researcher','fixture',1,datetime('now','+24 hours'),'[\"projects.view\",\"projects.edit\"]')",[account]).unwrap();c.execute("INSERT INTO local_session VALUES(1,'a')",[]).unwrap();
    c.execute("INSERT INTO sync_state(key,value) VALUES(?1,?2)",params![local_db::scoped_state_key(c,"projects_state").unwrap(),json!([{"id":project,"visibility":"lab","permissions":{"user_id":account,"access":"edit","can_edit":true}}]).to_string()]).unwrap();
}
fn merge(c:&mut Connection,account:&str,token:&str){
    let r=http("GET","/sync/comments/pull",Value::Null,token,"");assert_eq!(r["status"],200,"{r}");
    pull(c,account,serde_json::from_value(r["body"]["records"].clone()).unwrap(),serde_json::from_value(r["body"]["visible_project_ids"].clone()).unwrap(),r["body"]["snapshot_complete"]==true).unwrap();
}
fn send(c:&Connection,token:&str,ack:bool)->Value{
    let device:String=c.query_row("SELECT device_id FROM device_identity",[],|r|r.get(0)).unwrap();
    let changes:Vec<Value>=c.prepare("SELECT change_id,entity_id,operation,payload_json FROM active_sync_outbox WHERE synced_at IS NULL ORDER BY created_at,change_id").unwrap().query_map([],|r|{
        let raw:String=r.get(3)?;Ok(json!({"change_id":r.get::<_,String>(0)?,"entity_type":"project_comment","entity_id":r.get::<_,String>(1)?,"operation":r.get::<_,String>(2)?,"payload":serde_json::from_str::<Value>(&raw).unwrap()}))
    }).unwrap().map(Result::unwrap).collect();
    let r=http("POST","/sync/push",json!({"device_id":device,"changes":changes}),token,"");assert_eq!(r["status"],200,"{r}");
    for row in r["body"]["results"].as_array().unwrap(){assert_eq!(row["status"],"synced","{row}");if ack{c.execute("UPDATE sync_outbox SET synced_at=CURRENT_TIMESTAMP WHERE change_id=?1",[row["change_id"].as_str().unwrap()]).unwrap();}}r
}
struct Cleanup{directory:std::path::PathBuf,account:String}
impl Drop for Cleanup{fn drop(&mut self){let _=std::panic::catch_unwind(||fixture("cleanup",&self.account));let _=std::fs::remove_dir_all(&self.directory);}}
#[test]
#[ignore="requires local PostgreSQL API/Docker and LABOS_PHASE2_COMMENTS_PROBE=1"]
fn postgres_two_client_comments_restart_replay_delete(){
    assert_eq!(std::env::var("LABOS_PHASE2_COMMENTS_PROBE").as_deref(),Ok("1"));
    let account=local_db::new_uuid();let f=fixture("create",&account);let token=f["token"].as_str().unwrap();let project=f["project"].as_str().unwrap();
    let directory=std::env::temp_dir().join(format!("labos-comments-live-{}",local_db::new_uuid()));std::fs::create_dir(&directory).unwrap();let _cleanup=Cleanup{directory:directory.clone(),account:account.clone()};
    let path=directory.join("a.db");let mut a=Connection::open(&path).unwrap();initialize(&a,&account,project);let mut b=Connection::open(directory.join("b.db")).unwrap();initialize(&b,&account,project);
    let row=mutate(&mut a,&account,project,None,"create",Some("offline authored comment".into()),&local_db::new_uuid()).unwrap();let id=row["id"].as_str().unwrap();
    drop(a);let mut a=Connection::open(&path).unwrap();let lost=send(&a,token,false);assert_eq!(send(&a,token,true),lost);
    for c in [&mut a,&mut b]{merge(c,&account,token);merge(c,&account,token);assert_eq!(read(c).unwrap().iter().filter(|r|r["id"]==id).count(),1);assert_eq!(read(c).unwrap().iter().find(|r|r["id"]==id).unwrap()["author_id"],account);}
    mutate(&mut b,&account,project,Some(id),"delete",None,&local_db::new_uuid()).unwrap();merge(&mut b,&account,token);assert!(!read(&b).unwrap().iter().any(|r|r["id"]==id));
    let lost=send(&b,token,false);assert_eq!(send(&b,token,true),lost);
    for c in [&mut a,&mut b]{merge(c,&account,token);merge(c,&account,token);assert!(!read(c).unwrap().iter().any(|r|r["id"]==id));}
    drop(a);drop(b);println!("PASS comments: two disk SQLite clients + real PostgreSQL, offline create/restart, authored lost-ACK replay, repeated pull, pending delete and cross-client deletion reconciliation.");
}
