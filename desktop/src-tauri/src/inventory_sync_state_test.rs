use super::*;
use serde_json::json;
const A:&str="10000000-0000-4000-8000-000000000001";
const I:&str="20000000-0000-4000-8000-000000000001";
const J:&str="20000000-0000-4000-8000-000000000002";
fn fixture()->Connection{
    let c=Connection::open_in_memory().unwrap();local_db::ensure_schema(&c).unwrap();
    c.execute_batch("CREATE TABLE local_users(id TEXT PRIMARY KEY,central_user_id TEXT,is_active INTEGER,offline_expires_at TEXT,permissions_json TEXT);CREATE TABLE local_session(id INTEGER PRIMARY KEY,user_id TEXT);").unwrap();
    c.execute("INSERT INTO local_users VALUES('a',?1,1,datetime('now','+24 hours'),'[\"inventory.view\",\"inventory.create\",\"inventory.edit\",\"inventory.delete\",\"inventory.adjust_stock\"]')",[A]).unwrap();c.execute("INSERT INTO local_session VALUES(1,'a')",[]).unwrap();c
}
fn enqueue(c:&Connection,kind:&str,entity:Option<&str>,op:&str,payload:Value,change:&str){c.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,'fixture',?2,?3,?4,?5)",params![change,kind,entity,op,payload.to_string()]).unwrap();}
fn input(base:Vec<Value>,next:Vec<Value>,change:&str)->local_db::LocalSyncWriteInput{local_db::LocalSyncWriteInput{snapshot_json:json!(next).to_string(),expected_snapshot_json:json!(base).to_string(),expected_account_id:A.into(),change_id:change.into(),entity_type:"item".into(),entity_id:Some(I.into()),operation:"update".into(),payload_json:json!({"id":I,"patch":{"name":"edited"}}).to_string(),state_key:None,state_json:None}}
#[test]
fn stale_snapshot_account_switch_and_outbox_failure_preserve_data(){
    let mut c=fixture();let base=vec![json!({"id":I,"name":"old","sync_version":1})];write(&c,&base).unwrap();let next=vec![json!({"id":I,"name":"edited","sync_version":2})];
    save(&mut c,input(base.clone(),next.clone(),"one")).unwrap();
    assert!(save(&mut c,input(base.clone(),base.clone(),"stale")).is_err());assert_eq!(read(&c).unwrap().unwrap(),next);
    assert!(save(&mut c,input(next.clone(),base.clone(),"one")).is_err());assert_eq!(read(&c).unwrap().unwrap(),next);
    let mut foreign=input(next.clone(),base,"two");foreign.expected_account_id="another".into();assert!(save(&mut c,foreign).is_err());
    assert_eq!(c.query_row("SELECT COUNT(*) FROM sync_outbox",[],|r|r.get::<_,i64>(0)).unwrap(),1);
}
#[test]
fn pending_movement_bulk_status_and_delete_survive_cursor_and_refresh(){
    for (kind,op,entity,payload) in [("item_movement","create",Some(I),json!({"id":J,"item_id":I})),("item","bulk_status",None,json!({"ids":[I]})),("item","bulk_delete",None,json!({"ids":[I]}))]{
        let mut c=fixture();let rows=if op=="bulk_delete"{vec![]}else{vec![json!({"id":I,"name":"local"})]};write(&c,&rows).unwrap();enqueue(&c,kind,entity,op,payload,"one");
        for cursor in [Some("cursor"),None]{merge(&mut c,A,vec![json!({"id":I,"name":"remote"})],vec![I.into()],cursor).unwrap();assert_eq!(read(&c).unwrap().unwrap(),rows);}
        local_db::mark_changes_synced(&mut c,vec!["one".into()]).unwrap();
        assert!(c.query_row("SELECT value FROM sync_state WHERE key=?1",[local_db::scoped_state_key(&c,"inventory_sync_cursor").unwrap()],|r|r.get::<_,String>(0)).optional().unwrap().is_none());
        merge(&mut c,A,vec![json!({"id":I,"name":"remote"})],vec![],Some("next")).unwrap();assert_eq!(read(&c).unwrap().unwrap()[0]["name"],"remote");
    }
}
#[test]
fn uuid_and_invalid_snapshot_fail_closed_without_advancing_cursor(){
    let mut c=fixture();write(&c,&[json!({"id":I,"name":"old","sync_version":1})]).unwrap();
    merge(&mut c,A,vec![json!({"id":I.replace('-',""),"name":"canonical"})],vec![],Some("one")).unwrap();assert_eq!(read(&c).unwrap().unwrap().len(),1);
    assert!(merge(&mut c,A,vec![json!({"id":"bad"})],vec![],Some("bad")).is_err());
    assert!(merge(&mut c,"other",vec![],vec![],None).is_err());
    assert_eq!(c.query_row("SELECT value FROM sync_state WHERE key=?1",[local_db::scoped_state_key(&c,"inventory_sync_cursor").unwrap()],|r|r.get::<_,String>(0)).unwrap(),"one");
}

#[test]
fn movement_write_and_history_refresh_keep_pending_work_atomic(){
    let mut c=fixture();let base=vec![json!({"id":I,"current_quantity":10,"sync_version":1})];let next=vec![json!({"id":I,"current_quantity":8,"sync_version":2})];write(&c,&base).unwrap();
    let movement=json!({"id":J,"item_id":I,"quantity":2,"movement_type":"consume","quantity_after":8});
    let make=|base:&Vec<Value>,next:&Vec<Value>,movement:Value,change:&str|crate::local_inventory::LocalMovementWriteInput{snapshot_json:json!(next).to_string(),expected_snapshot_json:json!(base).to_string(),expected_account_id:A.into(),movement_json:movement.to_string(),item_id:I.into(),change_id:change.into()};
    crate::local_inventory::save_movement(&mut c,make(&base,&next,movement.clone(),"one")).unwrap();
    assert!(crate::local_inventory::save_movement(&mut c,make(&base,&base,movement.clone(),"stale")).is_err());
    let another=json!({"id":local_db::new_uuid(),"item_id":I});assert!(crate::local_inventory::save_movement(&mut c,make(&next,&base,another,"one")).is_err());assert_eq!(read(&c).unwrap().unwrap(),next);
    crate::local_inventory::cache_movements(&mut c,I,"[]",A).unwrap();
    let cached: String=c.query_row("SELECT movement_json FROM local_inventory_movement_records",[],|r|r.get(0)).unwrap();assert_eq!(serde_json::from_str::<Value>(&cached).unwrap()["quantity_after"],8);
    let server=json!([{"id":J,"item_id":I,"quantity_after":13}]);crate::local_inventory::cache_movements(&mut c,I,&server.to_string(),A).unwrap();
    let cached: String=c.query_row("SELECT movement_json FROM local_inventory_movement_records",[],|r|r.get(0)).unwrap();assert_eq!(serde_json::from_str::<Value>(&cached).unwrap()["quantity_after"],8);
    local_db::mark_changes_synced(&mut c,vec!["one".into()]).unwrap();crate::local_inventory::cache_movements(&mut c,I,&server.to_string(),A).unwrap();
    let cached: String=c.query_row("SELECT movement_json FROM local_inventory_movement_records",[],|r|r.get(0)).unwrap();assert_eq!(serde_json::from_str::<Value>(&cached).unwrap()["quantity_after"],13);
    assert!(crate::local_inventory::cache_movements(&mut c,I,&json!([{"id":J,"item_id":J}]).to_string(),A).is_err());
    assert_eq!(c.query_row("SELECT COUNT(*) FROM local_inventory_movement_records",[],|r|r.get::<_,i64>(0)).unwrap(),1);
}

#[test]
fn empty_history_is_distinct_from_missing_and_native_reads_require_permission(){
    let mut c=fixture();
    assert!(crate::local_inventory::list_movements(&c,I).unwrap().is_none());
    crate::local_inventory::cache_movements(&mut c,I,"[]",A).unwrap();
    assert!(crate::local_inventory::list_movements(&c,I).unwrap().unwrap().is_empty());
    assert!(crate::local_inventory::list_movements(&c,J).unwrap().is_none());
    c.execute("UPDATE local_users SET permissions_json='[]'",[]).unwrap();
    assert!(crate::local_inventory::list_movements(&c,I).is_err());
}

#[test]
fn queued_versions_and_predecessors_are_native_and_immutable(){
    let mut c=fixture();let base=vec![json!({"id":I,"name":"old","sync_version":1})];write(&c,&base).unwrap();
    let first=vec![json!({"id":I,"name":"one"})];save(&mut c,input(base,first,"one")).unwrap();
    let base=read(&c).unwrap().unwrap();assert_eq!(base[0]["sync_version"],2);save(&mut c,input(base,vec![json!({"id":I,"name":"two"})],"two")).unwrap();
    let rows:Vec<String>=c.prepare("SELECT payload_json FROM sync_outbox ORDER BY rowid").unwrap().query_map([],|r|r.get(0)).unwrap().map(Result::unwrap).collect();
    let one:Value=serde_json::from_str(&rows[0]).unwrap();let two:Value=serde_json::from_str(&rows[1]).unwrap();assert_eq!(one["inventory_protocol"],2);assert_eq!(one["item_bases"][0]["version"],1);assert!(one["item_bases"][0]["depends_on"].is_null());assert_eq!(two["item_bases"][0]["version"],2);assert_eq!(two["item_bases"][0]["depends_on"],"one");assert_eq!(read(&c).unwrap().unwrap()[0]["sync_version"],3);
}

#[test]
fn versionless_cache_cannot_queue_unprotected_edits(){
    let mut c=fixture();let base=vec![json!({"id":I,"name":"old"})];write(&c,&base).unwrap();
    assert!(save(&mut c,input(base.clone(),base.clone(),"one")).is_err());assert_eq!(read(&c).unwrap().unwrap(),base);
    assert_eq!(c.query_row("SELECT COUNT(*) FROM sync_outbox",[],|r|r.get::<_,i64>(0)).unwrap(),0);
}

#[test]
fn discard_inventory_chain_includes_shared_batches_not_unrelated_work(){
    let c=fixture();let other=local_db::new_uuid();
    enqueue(&c,"item",Some(I),"update",json!({"id":I}),"first");
    enqueue(&c,"item",None,"bulk_status",json!({"ids":[I,J]}),"shared");
    enqueue(&c,"item_movement",Some(J),"create",json!({"item_id":J,"id":local_db::new_uuid()}),"dependent");
    enqueue(&c,"item",Some(&other),"update",json!({"id":other}),"unrelated");
    discard_connected(&c,"first","accept_server").unwrap();
    let pending:Vec<String>=c.prepare("SELECT change_id FROM sync_outbox WHERE synced_at IS NULL").unwrap().query_map([],|r|r.get(0)).unwrap().map(Result::unwrap).collect();assert_eq!(pending,vec!["unrelated"]);
}
