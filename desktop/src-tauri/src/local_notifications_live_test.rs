use super::*;
use crate::local_system::live_tests::{fixture,http,initialize};
fn merge(c:&mut Connection,account:&str,token:&str){
    let r=http("GET","/sync/notifications/pull",Value::Null,token,"");assert_eq!(r["status"],200,"{r}");
    pull(c,account,serde_json::from_value(r["body"]["records"].clone()).unwrap(),r["body"]["snapshot_complete"]==true).unwrap();
}
fn send(c:&Connection,token:&str,ack:bool)->Value{
    let device:String=c.query_row("SELECT device_id FROM device_identity",[],|r|r.get(0)).unwrap();
    let changes:Vec<Value>=c.prepare("SELECT change_id,entity_id,payload_json FROM sync_outbox WHERE synced_at IS NULL ORDER BY rowid").unwrap().query_map([],|r|{
        let raw:String=r.get(2)?;Ok(json!({"change_id":r.get::<_,String>(0)?,"entity_type":"notification_read","entity_id":r.get::<_,String>(1)?,"operation":"update","payload":serde_json::from_str::<Value>(&raw).unwrap()}))
    }).unwrap().map(Result::unwrap).collect();
    let r=http("POST","/sync/push",json!({"device_id":device,"changes":changes}),token,"");assert_eq!(r["status"],200);
    for row in r["body"]["results"].as_array().unwrap(){assert_eq!(row["status"],"synced","{row}");if ack{c.execute("UPDATE sync_outbox SET synced_at=CURRENT_TIMESTAMP WHERE change_id=?1",[row["change_id"].as_str().unwrap()]).unwrap();}}
    r
}
struct Cleanup{directory:std::path::PathBuf,account:String}
impl Drop for Cleanup{fn drop(&mut self){let _=std::panic::catch_unwind(||fixture("cleanup",&self.account));let _=std::fs::remove_dir_all(&self.directory);}}
#[test]
#[ignore="requires running local PostgreSQL API/Docker and LABOS_PHASE2_NOTIFICATIONS_PROBE=1"]
fn postgres_two_client_notification_restart_replay_later_arrival(){
    assert_eq!(std::env::var("LABOS_PHASE2_NOTIFICATIONS_PROBE").as_deref(),Ok("1"));
    let account=local_db::new_uuid();let token=fixture("create",&account)["token"].as_str().unwrap().to_owned();
    let directory=std::env::temp_dir().join(format!("labos-notification-live-{}",local_db::new_uuid()));std::fs::create_dir(&directory).unwrap();
    let _cleanup=Cleanup{directory:directory.clone(),account:account.clone()};
    let path=directory.join("a.db");let mut a=Connection::open(&path).unwrap();initialize(&a,&account);
    let mut b=Connection::open(directory.join("b.db")).unwrap();initialize(&b,&account);
    let first=fixture("notify",&account)["id"].as_str().unwrap().to_owned();
    merge(&mut a,&account,&token);merge(&mut b,&account,&token);
    mark(&mut a,&account,vec![first.clone()],&local_db::new_uuid()).unwrap();
    mark(&mut b,&account,vec![first.clone()],&local_db::new_uuid()).unwrap();
    drop(a);let mut a=Connection::open(&path).unwrap();
    let lost=send(&a,&token,false);
    let later=fixture("notify",&account)["id"].as_str().unwrap().to_owned();
    assert_eq!(send(&a,&token,true),lost);send(&b,&token,true);
    for c in [&mut a,&mut b]{
        merge(c,&account,&token);merge(c,&account,&token);let rows=read(c).unwrap();assert_eq!(rows.len(),2);
        assert!(!rows.iter().find(|r|r["id"]==first).unwrap()["read_at"].is_null());
        assert!(rows.iter().find(|r|r["id"]==later).unwrap()["read_at"].is_null());
    }
    let r=http("POST","/experience/notifications/read-all",json!({"ids":[later]}),&token,&local_db::new_uuid());assert_eq!(r["status"],200);
    merge(&mut a,&account,&token);assert!(read(&a).unwrap().iter().all(|r|!r["read_at"].is_null()));
    drop(a);drop(b);
    println!("PASS notification read state: two disk SQLite clients + real PostgreSQL, offline restart, concurrent monotonic acknowledgements, lost ACK replay, repeated pull, later-arrival protection and browser HTTP parity.");
}
