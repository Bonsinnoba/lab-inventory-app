use super::*;
const ACCOUNT:&str="10000000-0000-4000-8000-000000000001";
const ITEM:&str="20000000-0000-4000-8000-000000000001";
fn fixture()->Connection{
    let c=Connection::open_in_memory().unwrap();
    initialize_client(&c,ACCOUNT,ITEM);c
}
fn initialize_client(c:&Connection,account:&str,item:&str){
    local_db::ensure_schema(&c).unwrap();
    c.execute_batch("CREATE TABLE local_users(id TEXT PRIMARY KEY,central_user_id TEXT,is_active INTEGER,offline_expires_at TEXT,permissions_json TEXT);CREATE TABLE local_session(id INTEGER PRIMARY KEY,user_id TEXT);").unwrap();
    c.execute("INSERT INTO local_users VALUES('a',?1,1,datetime('now','+24 hours'),'[\"inventory.view\",\"inventory.edit\"]')",[account]).unwrap();
    c.execute("INSERT INTO local_session VALUES(1,'a')",[]).unwrap();
    c.execute("INSERT INTO sync_state(key,value) VALUES(?1,?2)",params![local_db::scoped_state_key(&c,"inventory_snapshot").unwrap(),json!([{"id":item}]).to_string()]).unwrap();
}
fn create(c:&mut Connection)->Value{mutate(c,ACCOUNT,ITEM,None,"create",json!({"notes":"offline"}),None,&local_db::new_uuid()).unwrap()}
#[test]
fn atomic_write_and_authored_dependency_chain(){
    let mut c=fixture();let record=create(&mut c);let id=record["id"].as_str().unwrap();
    let key:String=c.query_row("SELECT change_id FROM sync_outbox",[],|r|r.get(0)).unwrap();
    let before=read(&c).unwrap();
    assert!(mutate(&mut c,ACCOUNT,ITEM,Some(id),"update",json!({"notes":"must roll back"}),Some(1),&key).is_err());
    assert_eq!(before,read(&c).unwrap());
    let updated=mutate(&mut c,ACCOUNT,ITEM,Some(id),"update",json!({"status":"completed"}),Some(1),&local_db::new_uuid()).unwrap();
    assert_eq!(updated["sync_version"],2);assert_eq!(updated["performed_by"],ACCOUNT);
    let (owner,payload):(String,String)=c.query_row("SELECT account_id,payload_json FROM sync_outbox ORDER BY rowid DESC LIMIT 1",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
    assert_eq!(owner,ACCOUNT);assert_eq!(serde_json::from_str::<Value>(&payload).unwrap()["depends_on"],key);
    assert!(mutate(&mut c,ACCOUNT,ITEM,Some(id),"update",json!({}),Some(1),&local_db::new_uuid()).is_err());
    mutate(&mut c,ACCOUNT,ITEM,Some(id),"delete",json!({}),Some(2),&local_db::new_uuid()).unwrap();
    assert!(read(&c).unwrap().is_empty());
    apply_pull(&mut c,ACCOUNT,vec![record],true).unwrap();assert!(read(&c).unwrap().is_empty(),"Pending deletion must not resurrect");
}
#[test]
fn snapshot_permissions_and_account_isolation_fail_closed(){
    let mut c=fixture();let record=create(&mut c);
    assert!(apply_pull(&mut c,ACCOUNT,vec![],false).is_err());
    apply_pull(&mut c,ACCOUNT,vec![],true).unwrap();assert_eq!(read(&c).unwrap().len(),1,"Keep unsent intent");
    assert!(mutate(&mut c,"other",ITEM,None,"create",json!({}),None,&local_db::new_uuid()).is_err());
    c.execute("UPDATE local_users SET permissions_json='[\"inventory.view\"]'",[]).unwrap();
    assert!(mutate(&mut c,ACCOUNT,ITEM,None,"create",json!({}),None,&local_db::new_uuid()).is_err());
    c.execute("UPDATE sync_outbox SET synced_at=CURRENT_TIMESTAMP",[]).unwrap();
    apply_pull(&mut c,ACCOUNT,vec![record.clone(),record],true).unwrap();assert_eq!(read(&c).unwrap().len(),1);
    apply_pull(&mut c,ACCOUNT,vec![],true).unwrap();assert!(read(&c).unwrap().is_empty());
    c.execute("UPDATE local_users SET is_active=0",[]).unwrap();assert!(authorize(&c,ACCOUNT,false).is_err());
}
#[test]
fn invalid_fields_and_canonical_uuids(){
    let mut c=fixture();
    for patch in [json!({"cost":-1}),json!({"status":"wrong"}),json!({"scheduled_date":"2026-02-30"})] {assert!(mutate(&mut c,ACCOUNT,ITEM,None,"create",patch,None,&local_db::new_uuid()).is_err());}
    let id=local_db::new_uuid();
    let r=mutate(&mut c,ACCOUNT,ITEM,Some(&id.to_uppercase()),"create",json!({}),None,&local_db::new_uuid()).unwrap();assert_eq!(r["id"],id);
}

mod live {
    use super::*;
    fn http(method:&str,path:&str,body:Value,token:&str)->Value{
        let base=std::env::var("LABOS_LIVE_API_URL").expect("Local API URL required");
        assert!(["http://127.0.0.1:4000/api","http://localhost:4000/api"].contains(&base.as_str()));
        let output=std::process::Command::new("node").args(["-e",r#"(async()=>{const r=await fetch(process.env.LABOS_TEST_URL,{method:process.env.LABOS_TEST_METHOD,headers:{'Content-Type':'application/json','Idempotency-Key':require('crypto').randomUUID(),Authorization:'Bearer '+process.env.LABOS_TEST_TOKEN},...(process.env.LABOS_TEST_METHOD==='GET'?{}:{body:process.env.LABOS_TEST_BODY})});const text=await r.text();if(!r.ok)throw Error(r.status+': '+text);console.log(text||'{}')})().catch(e=>{console.error(e.message);process.exit(1)})"#])
            .env("LABOS_TEST_URL",format!("{base}{path}")).env("LABOS_TEST_METHOD",method).env("LABOS_TEST_TOKEN",token).env("LABOS_TEST_BODY",body.to_string()).output().unwrap();
        assert!(output.status.success(),"{}",String::from_utf8_lossy(&output.stderr));serde_json::from_slice(&output.stdout).unwrap()
    }
    fn changes(c:&Connection)->Vec<Value>{
        c.prepare("SELECT change_id,entity_id,operation,payload_json FROM sync_outbox WHERE synced_at IS NULL ORDER BY rowid").unwrap().query_map([],|r|{
            let raw:String=r.get(3)?;Ok(json!({"change_id":r.get::<_,String>(0)?,"entity_type":"maintenance_record","entity_id":r.get::<_,String>(1)?,"operation":r.get::<_,String>(2)?,"payload":serde_json::from_str::<Value>(&raw).unwrap()}))
        }).unwrap().map(Result::unwrap).collect()
    }
    fn push(c:&Connection,token:&str)->Value{
        let device:String=c.query_row("SELECT device_id FROM device_identity",[],|r|r.get(0)).unwrap();
        http("POST","/sync/push",json!({"device_id":device,"changes":changes(c)}),token)
    }
    fn pull(c:&mut Connection,account:&str,token:&str){let r=http("GET","/sync/maintenance/pull",Value::Null,token);apply_pull(c,account,serde_json::from_value(r["records"].clone()).unwrap(),r["snapshot_complete"]==true).unwrap();}
    struct Cleanup{directory:std::path::PathBuf,token:String,id:String,item:String}
    impl Drop for Cleanup{fn drop(&mut self){
        let _=std::panic::catch_unwind(||{
            let r=http("GET",&format!("/items/{}/maintenance",self.item),Value::Null,&self.token);
            if let Some(record)=r.as_array().unwrap().iter().find(|r|r["id"]==self.id){http("DELETE",&format!("/items/{}/maintenance/{}",self.item,self.id),json!({"expected_version":record["sync_version"]}),&self.token);}
        });
        // Exact newly-created temporary test directory, never application data.
        let _=std::fs::remove_dir_all(&self.directory);
    }}
    #[test]
    #[ignore="requires the running local PostgreSQL API and explicit credentials"]
    fn postgres_two_client_maintenance_restart_replay_conflict_delete(){
        let login=http("POST","/auth/login",json!({"username":std::env::var("LABOS_LIVE_USERNAME").unwrap(),"password":std::env::var("LABOS_LIVE_PASSWORD").unwrap()}),"");
        let account=login["user"]["id"].as_str().unwrap();let token=login["token"].as_str().unwrap();
        let items=http("GET","/items",Value::Null,token);let item=items.as_array().unwrap()[0]["id"].as_str().unwrap();
        let dir=std::env::temp_dir().join(format!("labos-live-maintenance-{}",local_db::new_uuid()));std::fs::create_dir(&dir).unwrap();
        let fixture=Cleanup{directory:dir.clone(),token:token.into(),id:local_db::new_uuid(),item:item.into()};
        let a_path=dir.join("a.db");let mut a=Connection::open(&a_path).unwrap();initialize_client(&a,account,item);
        let mut b=Connection::open(dir.join("b.db")).unwrap();initialize_client(&b,account,item);
        let record=mutate(&mut a,account,item,Some(&fixture.id),"create",json!({"notes":"LABOS-P2-TWO-CLIENT"}),None,&local_db::new_uuid()).unwrap();
        mutate(&mut a,account,item,Some(&fixture.id),"update",json!({"status":"completed"}),Some(1),&local_db::new_uuid()).unwrap();
        drop(a);let mut a=Connection::open(&a_path).unwrap();
        let intents=changes(&a);assert_eq!(intents.len(),2);let response=push(&a,token);
        for r in response["results"].as_array().unwrap(){assert_eq!(r["status"],"synced","{r}");}
        assert_eq!(push(&a,token),response);assert_eq!(changes(&a),intents,"Retry must not rewrite payloads or IDs");
        a.execute("UPDATE sync_outbox SET synced_at=CURRENT_TIMESTAMP",[]).unwrap();
        pull(&mut a,account,token);pull(&mut b,account,token);pull(&mut b,account,token);
        for c in [&a,&b]{let rows=read(c).unwrap();let found:Vec<_>=rows.iter().filter(|r|r["id"]==record["id"]).collect();assert_eq!(found.len(),1);assert_eq!(found[0]["sync_version"],2);assert_eq!(found[0]["created_by"],account);}
        mutate(&mut a,account,item,Some(&fixture.id),"update",json!({"notes":"client A"}),Some(2),&local_db::new_uuid()).unwrap();
        mutate(&mut b,account,item,Some(&fixture.id),"update",json!({"notes":"client B"}),Some(2),&local_db::new_uuid()).unwrap();
        assert_eq!(push(&a,token)["results"][0]["status"],"synced");assert_eq!(push(&b,token)["results"][0]["error"]["code"],"SYNC_CONFLICT");
        pull(&mut b,account,token);assert_eq!(read(&b).unwrap().iter().find(|r|r["id"]==fixture.id).unwrap()["notes"],"client B","Keep rejected authored work until resolved");
        // Explicit accept-server decision for this isolated client.
        for c in [&a,&b]{c.execute("UPDATE sync_outbox SET synced_at=CURRENT_TIMESTAMP",[]).unwrap();}
        pull(&mut a,account,token);pull(&mut b,account,token);
        mutate(&mut a,account,item,Some(&fixture.id),"delete",json!({}),Some(3),&local_db::new_uuid()).unwrap();
        assert_eq!(push(&a,token)["results"][0]["status"],"synced");assert_eq!(push(&a,token)["results"][0]["status"],"synced");
        a.execute("UPDATE sync_outbox SET synced_at=CURRENT_TIMESTAMP",[]).unwrap();pull(&mut a,account,token);pull(&mut b,account,token);
        for c in [&a,&b]{assert!(!read(c).unwrap().iter().any(|r|r["id"]==fixture.id));}
        drop(a);drop(b);
        println!("PASS PostgreSQL + two disk SQLite clients: offline create/update, restart, authored immutable replay, repeated pull, concurrent conflict preservation, accepted server state and delete replay.");
    }
}
