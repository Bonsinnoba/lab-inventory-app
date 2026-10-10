use super::*;
const A:&str="10000000-0000-4000-8000-000000000001";
const I:&str="20000000-0000-4000-8000-000000000001";
fn fixture()->Connection{
    let c=Connection::open_in_memory().unwrap();local_db::ensure_schema(&c).unwrap();
    c.execute_batch("CREATE TABLE local_users(id TEXT PRIMARY KEY,central_user_id TEXT,is_active INTEGER,offline_expires_at TEXT,permissions_json TEXT);CREATE TABLE local_session(id INTEGER PRIMARY KEY,user_id TEXT);").unwrap();
    c.execute("INSERT INTO local_users VALUES('a',?1,1,datetime('now','+24 hours'),'[\"inventory.view\",\"inventory.import\",\"inventory.create\",\"inventory.edit\",\"inventory.adjust_stock\"]')",[A]).unwrap();c.execute("INSERT INTO local_session VALUES(1,'a')",[]).unwrap();
    inventory::write(&c,&[json!({"id":I,"name":"old","type":"tool","current_quantity":10,"initial_quantity":10,"sync_version":1,"storage_container_id":"keep-linked-container"})]).unwrap();c
}
fn rows(new:&str)->Value{json!([{"operation":"create","record":{"id":new,"name":"new","type":"tool","initial_quantity":2,"current_quantity":2}},{"operation":"update","record":{"id":I,"name":"edited","type":"tool","initial_quantity":10,"current_quantity":8}}])}
fn base(c:&Connection)->String{json!(inventory::read(c).unwrap().unwrap()).to_string()}
#[test]
fn mixed_import_is_one_immutable_batch_and_native_retry_is_noop(){
    let mut c=fixture();let before=base(&c);let new=local_db::new_uuid();let change=local_db::new_uuid();let rows=rows(&new).to_string();
    assert_eq!(import_rows(&mut c,&rows,&before,A,&change).unwrap(),json!({"imported":2,"created":1,"updated":1}));
    let after=base(&c);assert_eq!(import_rows(&mut c,&rows,&before,A,&change).unwrap()["imported"],2);assert_eq!(base(&c),after);
    assert_eq!(c.query_row("SELECT COUNT(*) FROM sync_outbox",[],|r|r.get::<_,i64>(0)).unwrap(),1);
    let payload:String=c.query_row("SELECT payload_json FROM sync_outbox",[],|r|r.get(0)).unwrap();let payload:Value=serde_json::from_str(&payload).unwrap();
    assert_eq!(payload["inventory_protocol"],2);assert_eq!(payload["item_bases"][0]["version"],0);assert_eq!(payload["item_bases"][1]["version"],1);
    assert_eq!(inventory::read(&c).unwrap().unwrap().iter().find(|r|r["id"]==I).unwrap()["storage_container_id"],"keep-linked-container");
    let mut changed:Value=serde_json::from_str(&rows).unwrap();changed[0]["record"]["name"]=json!("different");assert!(import_rows(&mut c,&changed.to_string(),&after,A,&change).is_err());
    assert!(inventory::pending_items(&c).unwrap().contains(&new));
    inventory::merge(&mut c,A,vec![],vec![new.clone(),I.into()],None).unwrap();assert_eq!(base(&c),after);
    let mut next=inventory::read(&c).unwrap().unwrap();let mut edit=json!({"id":new,"patch":{"name":"next"}});inventory::stamp_versions(&c,"item",Some(&new),"update",&mut edit,&mut next).unwrap();assert_eq!(edit["item_bases"][0]["depends_on"],change);
    inventory::discard_connected(&c,&change,"accept_server").unwrap();assert!(inventory::pending_items(&c).unwrap().is_empty());
}
#[test]
fn import_stale_account_stock_permission_and_outbox_failures_roll_back(){
    for fault in ["stale","account","permission","outbox","quantity"]{
        let mut c=fixture();let before=base(&c);let mut input=rows(&local_db::new_uuid());
        if fault=="quantity"{input[0]["record"]["initial_quantity"]=json!(-1);}
        let input=input.to_string();
        if fault=="permission"{c.execute("UPDATE local_users SET permissions_json='[\"inventory.view\",\"inventory.import\",\"inventory.create\",\"inventory.edit\"]'",[]).unwrap();}
        if fault=="outbox"{c.execute_batch("CREATE TRIGGER fail_import BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT,'injected'); END;").unwrap();}
        assert!(import_rows(&mut c,&input,if fault=="stale"{"[]"}else{&before},if fault=="account"{"other"}else{A},&local_db::new_uuid()).is_err(),"{fault}");
        assert_eq!(base(&c),before);assert_eq!(c.query_row("SELECT COUNT(*) FROM sync_outbox",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    }
}
#[test]
fn create_only_import_and_duplicate_uuid_normalization(){
    let mut c=fixture();c.execute("UPDATE local_users SET permissions_json='[\"inventory.view\",\"inventory.import\",\"inventory.create\"]'",[]).unwrap();
    let mut input=rows(&local_db::new_uuid()).as_array().unwrap().clone();input.pop();let before=base(&c);import_rows(&mut c,&json!(input).to_string(),&before,A,&local_db::new_uuid()).unwrap();
    let mut duplicate=input[0].clone();duplicate["record"]["id"]=json!(input[0]["record"]["id"].as_str().unwrap().replace('-',""));input.push(duplicate);let before=base(&c);assert!(import_rows(&mut c,&json!(input).to_string(),&before,A,&local_db::new_uuid()).is_err());assert_eq!(base(&c),before);
}
