use super::*;
const A:&str="10000000-0000-4000-8000-000000000001";
const P:&str="20000000-0000-4000-8000-000000000001";
fn fixture()->Connection{
    let c=Connection::open_in_memory().unwrap();local_db::ensure_schema(&c).unwrap();
    c.execute_batch("CREATE TABLE local_users(id TEXT PRIMARY KEY,central_user_id TEXT,role TEXT,username TEXT,is_active INTEGER,offline_expires_at TEXT,permissions_json TEXT);CREATE TABLE local_session(id INTEGER PRIMARY KEY,user_id TEXT);").unwrap();
    c.execute("INSERT INTO local_users VALUES('a',?1,'researcher','fixture',1,datetime('now','+24 hours'),'[\"projects.view\",\"projects.edit\"]')",[A]).unwrap();c.execute("INSERT INTO local_session VALUES(1,'a')",[]).unwrap();
    c.execute("INSERT INTO sync_state(key,value) VALUES(?1,?2)",params![local_db::scoped_state_key(&c,"projects_state").unwrap(),json!([{"id":P,"visibility":"lab","permissions":{"user_id":A,"access":"edit","can_edit":true}}]).to_string()]).unwrap();c
}
#[test]
fn comments_atomic_authored_create_delete_and_revocation(){
    let mut c=fixture();let row=mutate(&mut c,A,P,None,"create",Some("offline comment".into()),"one").unwrap();let id=row["id"].as_str().unwrap();assert_eq!(row["author_id"],A);
    assert!(mutate(&mut c,A,P,None,"create",Some("rollback".into()),"one").is_err());assert_eq!(read(&c).unwrap().len(),1);
    assert!(mutate(&mut c,"other",P,None,"create",Some("no".into()),"foreign").is_err());
    mutate(&mut c,A,P,Some(id),"delete",None,"two").unwrap();pull(&mut c,A,vec![row.clone()],vec![P.into()],true).unwrap();assert!(read(&c).unwrap().is_empty());
    let payload:String=c.query_row("SELECT payload_json FROM sync_outbox WHERE change_id='two'",[],|r|r.get(0)).unwrap();assert_eq!(serde_json::from_str::<Value>(&payload).unwrap()["depends_on"],"one");
    c.execute("UPDATE sync_outbox SET synced_at=CURRENT_TIMESTAMP",[]).unwrap();
    mutate(&mut c,A,P,None,"create",Some("pending private work".into()),"three").unwrap();
    pull(&mut c,A,vec![],vec![],true).unwrap();assert!(read(&c).unwrap().is_empty());
    assert!(require_comment_project_access(&c,P,false).is_err(),"Stale project cache cannot expose revoked comment work");
    assert_eq!(c.query_row("SELECT COUNT(*) FROM sync_outbox WHERE synced_at IS NULL",[],|r|r.get::<_,i64>(0)).unwrap(),1);
    assert!(pull(&mut c,A,vec![],vec![],false).is_err());
}
#[test]
fn comments_author_delete_and_current_project_edit_permission(){
    let mut c=fixture();let id=local_db::new_uuid();write(&c,&[json!({"id":id,"project_id":P,"author_id":"another","body":"not yours"})]).unwrap();
    assert!(mutate(&mut c,A,P,Some(&id),"delete",None,"no").is_err());
    c.execute("UPDATE local_users SET permissions_json='[\"projects.view\"]'",[]).unwrap();
    assert!(mutate(&mut c,A,P,None,"create",Some("denied".into()),"edit").is_err());
    assert_eq!(c.query_row("SELECT COUNT(*) FROM sync_outbox",[],|r|r.get::<_,i64>(0)).unwrap(),0);
}
