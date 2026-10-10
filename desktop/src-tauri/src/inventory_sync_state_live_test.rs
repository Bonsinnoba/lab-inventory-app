use super::*;
use serde_json::json;
use crate::local_system::live_tests::http;
fn fixture(action:&str,id:&str)->Value{
    let out=std::process::Command::new("docker").args(["exec","-e","LABOS_PHASE2_INVENTORY_PROBE=1","labos-labos-api-1","node","src/phase2-inventory-client-fixture.mjs",action,id]).output().unwrap();
    assert!(out.status.success(),"{}",String::from_utf8_lossy(&out.stderr));serde_json::from_slice(&out.stdout).unwrap()
}
fn initialize(c:&Connection,account:&str){
    local_db::ensure_schema(c).unwrap();
    c.execute_batch("CREATE TABLE local_users(id TEXT PRIMARY KEY,central_user_id TEXT,is_active INTEGER,offline_expires_at TEXT,permissions_json TEXT);CREATE TABLE local_session(id INTEGER PRIMARY KEY,user_id TEXT);").unwrap();
    c.execute("INSERT INTO local_users VALUES('a',?1,1,datetime('now','+24 hours'),'[\"inventory.view\",\"inventory.import\",\"inventory.create\",\"inventory.edit\",\"inventory.delete\",\"inventory.adjust_stock\"]')",[account]).unwrap();c.execute("INSERT INTO local_session VALUES(1,'a')",[]).unwrap();
}
fn refresh(c:&mut Connection,account:&str,token:&str){
    for _ in 0..100{
        let cursor:Option<String>=c.query_row("SELECT value FROM sync_state WHERE key=?1",[local_db::scoped_state_key(c,"inventory_sync_cursor").unwrap()],|r|r.get(0)).optional().unwrap();
        let path=cursor.map(|s|format!("/sync/pull?limit=500&since={s}")).unwrap_or("/sync/pull?limit=500".into());
        let r=http("GET",&path,Value::Null,token,"");assert_eq!(r["status"],200,"{r}");let body=&r["body"];
        let rows:Vec<Value>=serde_json::from_value(body["items"].clone()).unwrap();let deleted:Vec<String>=serde_json::from_value(body["deleted_item_ids"].clone()).unwrap();
        if !rows.is_empty()||!deleted.is_empty(){merge(c,account,rows,deleted,Some(body["next_cursor"].as_str().unwrap())).unwrap();}
        if body["has_more"]!=true{return}
    }panic!("Inventory feed exceeded test page limit");
}
fn quantity(c:&Connection,id:&str)->f64{let rows=read(c).unwrap().unwrap();let row=rows.iter().find(|r|r["id"]==id).unwrap();row["current_quantity"].as_f64().unwrap_or_else(||row["current_quantity"].as_str().unwrap().parse().unwrap())}
fn movement(c:&mut Connection,account:&str,id:&str,kind:&str,amount:f64){
    let base=read(c).unwrap().unwrap();let mut next=base.clone();let row=next.iter_mut().find(|r|r["id"]==id).unwrap();row["current_quantity"]=json!(quantity(c,id)+if kind=="receive"{amount}else{-amount});
    crate::local_inventory::save_movement(c,crate::local_inventory::LocalMovementWriteInput{snapshot_json:json!(next).to_string(),expected_snapshot_json:json!(base).to_string(),expected_account_id:account.into(),movement_json:json!({"id":local_db::new_uuid(),"item_id":id,"movement_type":kind,"quantity":amount}).to_string(),item_id:id.into(),change_id:local_db::new_uuid()}).unwrap();
}
fn edit(c:&mut Connection,account:&str,id:&str,name:&str){
    let base=read(c).unwrap().unwrap();let mut next=base.clone();next.iter_mut().find(|r|r["id"]==id).unwrap()["name"]=json!(name);
    save(c,local_db::LocalSyncWriteInput{snapshot_json:json!(next).to_string(),expected_snapshot_json:json!(base).to_string(),expected_account_id:account.into(),change_id:local_db::new_uuid(),entity_type:"item".into(),entity_id:Some(id.into()),operation:"update".into(),payload_json:json!({"id":id,"patch":{"name":name},"base_updated_at":"old-local-timestamp"}).to_string(),state_key:None,state_json:None}).unwrap();
}
fn send(c:&mut Connection,token:&str,ack:bool)->Value{
    let device:String=c.query_row("SELECT device_id FROM device_identity",[],|r|r.get(0)).unwrap();
    let changes:Vec<Value>=c.prepare("SELECT change_id,entity_type,entity_id,operation,payload_json FROM sync_outbox WHERE synced_at IS NULL AND change_id IN (SELECT change_id FROM active_sync_outbox) ORDER BY rowid").unwrap().query_map([],|r|{let raw:String=r.get(4)?;Ok(json!({"change_id":r.get::<_,String>(0)?,"entity_type":r.get::<_,String>(1)?,"entity_id":r.get::<_,Option<String>>(2)?,"operation":r.get::<_,String>(3)?,"payload":serde_json::from_str::<Value>(&raw).unwrap()}))}).unwrap().map(Result::unwrap).collect();
    let r=http("POST","/sync/push",json!({"device_id":device,"changes":changes}),token,"");assert_eq!(r["status"],200,"{r}");
    let mut ids=vec![];for row in r["body"]["results"].as_array().unwrap(){assert_eq!(row["status"],"synced","{row}");ids.push(row["change_id"].as_str().unwrap().into());}if ack{local_db::mark_changes_synced(c,ids).unwrap();}r
}
struct Cleanup{directory:std::path::PathBuf,account:String}
impl Drop for Cleanup{fn drop(&mut self){let _=std::panic::catch_unwind(||fixture("cleanup",&self.account));let _=std::fs::remove_dir_all(&self.directory);}}
#[test]
#[ignore="requires actual PostgreSQL API/Docker and LABOS_PHASE2_INVENTORY_PROBE=1"]
fn postgres_two_client_inventory_pending_restart_lost_ack_bulk(){
    assert_eq!(std::env::var("LABOS_PHASE2_INVENTORY_PROBE").as_deref(),Ok("1"));let account=local_db::new_uuid();let f=fixture("create",&account);let token=f["token"].as_str().unwrap();let mut ids:Vec<String>=serde_json::from_value(f["items"].clone()).unwrap();
    let directory=std::env::temp_dir().join(format!("labos-inventory-live-{}",local_db::new_uuid()));std::fs::create_dir(&directory).unwrap();let _cleanup=Cleanup{directory:directory.clone(),account:account.clone()};
    let path=directory.join("a.db");let mut a=Connection::open(&path).unwrap();initialize(&a,&account);let mut b=Connection::open(directory.join("b.db")).unwrap();initialize(&b,&account);refresh(&mut a,&account,token);refresh(&mut b,&account,token);
    movement(&mut a,&account,&ids[0],"consume",2.0);drop(a);let mut a=Connection::open(&path).unwrap();movement(&mut b,&account,&ids[0],"receive",5.0);send(&mut b,token,true);
    refresh(&mut a,&account,token);assert_eq!(quantity(&a,&ids[0]),8.0,"Pending intent survives another client's stock change");
    let lost=send(&mut a,token,false);refresh(&mut a,&account,token);assert_eq!(quantity(&a,&ids[0]),8.0);assert_eq!(send(&mut a,token,true),lost);
    for c in [&mut a,&mut b]{refresh(c,&account,token);assert_eq!(quantity(c,&ids[0]),13.0);}
    let final_name=format!("LABOS-P2-INVENTORY-CLIENT-{account}");
    edit(&mut a,&account,&ids[0],&format!("{final_name}-first"));edit(&mut a,&account,&ids[0],&final_name);
    drop(a);let mut a=Connection::open(&path).unwrap();let lost=send(&mut a,token,false);assert_eq!(send(&mut a,token,true),lost);
    for c in [&mut a,&mut b]{refresh(c,&account,token);assert_eq!(read(c).unwrap().unwrap().iter().find(|r|r["id"]==ids[0]).unwrap()["name"],final_name);}
    // One mixed import survives restart and lost ACK, including a later edit
    // whose predecessor is the whole import receipt.
    let new_id=local_db::new_uuid();let base=read(&a).unwrap().unwrap();
    let batch=json!([{"operation":"create","record":{"id":new_id,"name":final_name,"type":"component","initial_quantity":5,"current_quantity":5}},{"operation":"update","record":{"id":ids[0],"name":final_name,"type":"component","initial_quantity":10,"current_quantity":12}}]);
    crate::local_excel::import_rows(&mut a,&batch.to_string(),&json!(base).to_string(),&account,&local_db::new_uuid()).unwrap();
    edit(&mut a,&account,&new_id,&final_name);drop(a);let mut a=Connection::open(&path).unwrap();
    let lost=send(&mut a,token,false);refresh(&mut a,&account,token);assert_eq!(send(&mut a,token,true),lost);
    for c in [&mut a,&mut b]{refresh(c,&account,token);assert_eq!(quantity(c,&ids[0]),12.0);assert_eq!(quantity(c,&new_id),5.0);}
    ids.push(new_id);
    for op in ["bulk_status","bulk_delete"]{
        let base=read(&a).unwrap().unwrap();let mut next=base.clone();
        if op=="bulk_delete"{next.retain(|r|!ids.iter().any(|id|r["id"]==*id));}else{for row in &mut next{if ids.iter().any(|id|row["id"]==*id){row["status"]=json!("in_use");}}}
        save(&mut a,local_db::LocalSyncWriteInput{snapshot_json:json!(next).to_string(),expected_snapshot_json:json!(base).to_string(),expected_account_id:account.clone(),change_id:local_db::new_uuid(),entity_type:"item".into(),entity_id:None,operation:op.into(),payload_json:json!({"ids":ids,"status":"in_use"}).to_string(),state_key:None,state_json:None}).unwrap();
        refresh(&mut a,&account,token);let rows=read(&a).unwrap().unwrap();for id in &ids{if op=="bulk_delete"{assert!(!rows.iter().any(|r|r["id"]==*id));}else{assert_eq!(rows.iter().find(|r|r["id"]==*id).unwrap()["status"],"in_use");}}
        let lost=send(&mut a,token,false);assert_eq!(send(&mut a,token,true),lost);refresh(&mut a,&account,token);refresh(&mut b,&account,token);
    }
    for c in [&a,&b]{assert!(!read(c).unwrap().unwrap().iter().any(|r|ids.iter().any(|id|r["id"]==*id)));}
    drop(a);drop(b);println!("PASS inventory: two disk clients + real PostgreSQL, offline restart, concurrent stock deltas, sequential versioned edits/predecessors across restart, pending-safe refresh, lost ACK reconciliation, bulk status/delete retries and no resurrection.");
}
