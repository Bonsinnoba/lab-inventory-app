use super::*;
const ACCOUNT:&str="10000000-0000-4000-8000-000000000001";
fn fixture()->Connection{
    let c=Connection::open_in_memory().unwrap();initialize(&c,ACCOUNT);c
}
fn initialize(c:&Connection,account:&str){
    local_db::ensure_schema(&c).unwrap();
    c.execute_batch("CREATE TABLE local_users(id TEXT PRIMARY KEY,central_user_id TEXT,is_active INTEGER,offline_expires_at TEXT,permissions_json TEXT,role TEXT);CREATE TABLE local_session(id INTEGER PRIMARY KEY,user_id TEXT);").unwrap();
    c.execute("INSERT INTO local_users VALUES('a',?1,1,datetime('now','+24 hours'),'[\"inventory.view\",\"inventory.create\",\"inventory.edit\",\"inventory.delete\"]','admin')",[account]).unwrap();
    c.execute("INSERT INTO local_session VALUES(1,'a')",[]).unwrap();
    c.execute("INSERT INTO sync_state VALUES(?1,'[]')",[local_db::scoped_state_key(&c,"inventory_snapshot").unwrap()]).unwrap();
}

mod live{
    use super::*;
    fn http(method:&str,path:&str,body:Value,token:&str)->Value{
        let out=std::process::Command::new("node").args(["-e",r#"
          (async()=>{const r=await fetch('http://127.0.0.1:4000/api'+process.env.TEST_PATH,
            {method:process.env.TEST_METHOD,headers:{'Content-Type':'application/json',
              Authorization:'Bearer '+process.env.TEST_TOKEN,'Idempotency-Key':require('crypto').randomUUID()},
              ...(process.env.TEST_METHOD==='GET'?{}:{body:process.env.TEST_BODY})});
            const body=await r.json();if(!r.ok)throw Error(r.status+': '+JSON.stringify(body));console.log(JSON.stringify(body));
          })().catch(e=>{console.error(e.message);process.exit(1)})"#])
            .env("TEST_PATH",path).env("TEST_METHOD",method).env("TEST_TOKEN",token).env("TEST_BODY",body.to_string()).output().unwrap();
        assert!(out.status.success(),"{}",String::from_utf8_lossy(&out.stderr));serde_json::from_slice(&out.stdout).unwrap()
    }
    fn send(c:&Connection,token:&str,ack:bool)->Value{
        let device:String=c.query_row("SELECT device_id FROM device_identity",[],|r|r.get(0)).unwrap();
        let changes:Vec<Value>=c.prepare("SELECT change_id,entity_type,entity_id,operation,payload_json FROM sync_outbox WHERE synced_at IS NULL ORDER BY rowid").unwrap().query_map([],|r|{
            let raw:String=r.get(4)?;Ok(json!({"change_id":r.get::<_,String>(0)?,"entity_type":r.get::<_,String>(1)?,"entity_id":r.get::<_,String>(2)?,"operation":r.get::<_,String>(3)?,"payload":serde_json::from_str::<Value>(&raw).unwrap()}))
        }).unwrap().map(Result::unwrap).collect();
        let result=http("POST","/sync/push",json!({"device_id":device,"changes":changes}),token);
        if ack{for row in result["results"].as_array().unwrap(){assert_eq!(row["status"],"synced","{row}");c.execute("UPDATE sync_outbox SET synced_at=CURRENT_TIMESTAMP WHERE change_id=?1",[row["change_id"].as_str().unwrap()]).unwrap();}}
        result
    }
    fn merge(c:&mut Connection,account:&str,kind:&str,token:&str){let r=http("GET",&format!("/sync/catalog/{kind}/pull"),Value::Null,token);pull(c,account,kind,serde_json::from_value(r["records"].clone()).unwrap(),r["snapshot_complete"]==true).unwrap();}
    struct Cleanup{directory:std::path::PathBuf,token:String,ids:Vec<(String,String)>}
    impl Drop for Cleanup{fn drop(&mut self){
        for(kind,id)in &self.ids{let _=std::panic::catch_unwind(||{
            let r=http("GET",&format!("/sync/catalog/{kind}/pull"),Value::Null,&self.token);
            if let Some(row)=r["records"].as_array().unwrap().iter().find(|r|r["id"]==*id){
                let route=if kind=="supplier"{"/operations/suppliers"}else{"/phase4/containers"};
                http("DELETE",&format!("{route}/{id}"),json!({"expected_version":row["sync_version"]}),&self.token);
            }
        });}
        // Exact newly created UUID fixture directory, never an application DB.
        let _=std::fs::remove_dir_all(&self.directory);
    }}
    #[test]
    #[ignore="requires local PostgreSQL API and explicit LABOS_LIVE_USERNAME / LABOS_LIVE_PASSWORD"]
    fn postgres_two_client_catalog_restart_conflict_delete(){
        let login=http("POST","/auth/login",json!({"username":std::env::var("LABOS_LIVE_USERNAME").unwrap(),"password":std::env::var("LABOS_LIVE_PASSWORD").unwrap()}),"");
        let account=login["user"]["id"].as_str().unwrap();let token=login["token"].as_str().unwrap();
        let directory=std::env::temp_dir().join(format!("labos-catalog-live-{}",local_db::new_uuid()));std::fs::create_dir(&directory).unwrap();
        let mut cleanup=Cleanup{directory:directory.clone(),token:token.into(),ids:vec![]};
        let a_path=directory.join("a.db");let mut a=Connection::open(&a_path).unwrap();initialize(&a,account);
        let mut b=Connection::open(directory.join("b.db")).unwrap();initialize(&b,account);
        for kind in ["supplier","storage_container"]{
            let id=local_db::new_uuid();cleanup.ids.push((kind.into(),id.clone()));
            mutate(&mut a,account,kind,"create",Some(&id),json!({"name":format!("LABOS-P2-TWO-CLIENT-{id}")}),None,&local_db::new_uuid()).unwrap();
            mutate(&mut a,account,kind,"update",Some(&id),json!({"notes":"offline second"}),Some(1),&local_db::new_uuid()).unwrap();
            drop(a);a=Connection::open(&a_path).unwrap();
            let lost=send(&a,token,false);assert_eq!(send(&a,token,true),lost);
            merge(&mut a,account,kind,token);merge(&mut b,account,kind,token);merge(&mut b,account,kind,token);
            assert_eq!(read(&b,kind).unwrap().iter().filter(|r|r["id"]==id).count(),1);
            mutate(&mut a,account,kind,"update",Some(&id),json!({"notes":"client A"}),Some(2),&local_db::new_uuid()).unwrap();
            mutate(&mut b,account,kind,"update",Some(&id),json!({"notes":"client B"}),Some(2),&local_db::new_uuid()).unwrap();
            send(&a,token,true);assert_eq!(send(&b,token,false)["results"][0]["error"]["code"],"SYNC_CONFLICT");
            merge(&mut b,account,kind,token);assert_eq!(read(&b,kind).unwrap().iter().find(|r|r["id"]==id).unwrap()["notes"],"client B");
            // Explicit accept-server decision for the isolated test client.
            b.execute("UPDATE sync_outbox SET synced_at=CURRENT_TIMESTAMP",[]).unwrap();
            merge(&mut a,account,kind,token);merge(&mut b,account,kind,token);
            mutate(&mut a,account,kind,"delete",Some(&id),json!({}),Some(3),&local_db::new_uuid()).unwrap();
            let lost=send(&a,token,false);assert_eq!(send(&a,token,true),lost);
            merge(&mut a,account,kind,token);merge(&mut b,account,kind,token);
            assert!(!read(&b,kind).unwrap().iter().any(|r|r["id"]==id));
        }
        drop(a);drop(b);
        println!("PASS suppliers and containers: two disk SQLite clients + actual PostgreSQL; offline chained writes, restart, lost ACK, repeated pull, conflict preservation, explicit recovery, deletion and replay.");
    }
}
#[test]
fn catalogs_atomic_ordered_canonical_and_pending_delete(){
    for kind in ["supplier","storage_container"]{
        let mut c=fixture();let id=local_db::new_uuid();
        let row=mutate(&mut c,ACCOUNT,kind,"create",Some(&id.replace('-',"").to_uppercase()),json!({"name":"fixture"}),None,"one").unwrap();assert_eq!(row["id"],id);
        assert!(mutate(&mut c,ACCOUNT,kind,"update",Some(&id),json!({"name":"rollback"}),Some(1),"one").is_err());assert_eq!(read(&c,kind).unwrap()[0]["name"],"fixture");
        mutate(&mut c,ACCOUNT,kind,"update",Some(&id),json!({"notes":"edited"}),Some(1),"two").unwrap();
        let raw:String=c.query_row("SELECT payload_json FROM sync_outbox WHERE change_id='two'",[],|r|r.get(0)).unwrap();assert_eq!(serde_json::from_str::<Value>(&raw).unwrap()["depends_on"],"one");
        assert!(mutate(&mut c,ACCOUNT,kind,"delete",Some(&id),json!({}),Some(1),"stale").is_err());
        mutate(&mut c,ACCOUNT,kind,"delete",Some(&id),json!({}),Some(2),"three").unwrap();
        pull(&mut c,ACCOUNT,kind,vec![row.clone()],true).unwrap();assert!(read(&c,kind).unwrap().is_empty());
        c.execute("UPDATE sync_outbox SET synced_at=CURRENT_TIMESTAMP",[]).unwrap();
        pull(&mut c,ACCOUNT,kind,vec![row.clone(),row],true).unwrap();assert_eq!(read(&c,kind).unwrap().len(),1);
        assert!(pull(&mut c,ACCOUNT,kind,vec![],false).is_err());
        pull(&mut c,ACCOUNT,kind,vec![],true).unwrap();assert!(read(&c,kind).unwrap().is_empty());
    }
}
#[test]
fn catalogs_permissions_validation_and_linked_container_guard(){
    let mut c=fixture();
    assert!(mutate(&mut c,"other","supplier","create",None,json!({"name":"no"}),None,"no").is_err());
    assert!(mutate(&mut c,ACCOUNT,"supplier","create",None,json!({"name":" "}),None,"empty").is_err());
    assert!(mutate(&mut c,ACCOUNT,"storage_container","create",None,json!({"name":"bad","capacity":-1}),None,"capacity").is_err());
    let s=mutate(&mut c,ACCOUNT,"supplier","create",None,json!({"name":"vendor"}),None,"supplier").unwrap();
    c.execute("UPDATE local_users SET role='member'",[]).unwrap();
    assert!(mutate(&mut c,ACCOUNT,"supplier","delete",s["id"].as_str(),json!({}),Some(1),"denied").is_err());
    let row=mutate(&mut c,ACCOUNT,"storage_container","create",None,json!({"name":"box"}),None,"box").unwrap();
    c.execute("UPDATE sync_state SET value=?1 WHERE key=?2",params![json!([{"id":local_db::new_uuid(),"storage_container_id":row["id"]}]).to_string(),local_db::scoped_state_key(&c,"inventory_snapshot").unwrap()]).unwrap();
    assert!(mutate(&mut c,ACCOUNT,"storage_container","delete",row["id"].as_str(),json!({}),Some(1),"linked").is_err());
    c.execute("UPDATE local_users SET permissions_json='[\"inventory.view\"]'",[]).unwrap();
    assert!(mutate(&mut c,ACCOUNT,"supplier","create",None,json!({"name":"denied"}),None,"permission").is_err());
}
