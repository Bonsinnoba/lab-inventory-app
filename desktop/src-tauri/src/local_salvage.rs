//! Authorized server recovery snapshots. Physical stock authority stays server-side.
use rusqlite::{params,Connection,OptionalExtension};
use serde_json::{json,Value};
use crate::{local_db,local_auth,local_projects};

fn authorize(c:&Connection,account:&str)->Result<(),String>{
 local_db::require_sync_account(c,account)?;
 local_auth::require_local_permission(c,"inventory.view")
}
fn read(c:&Connection,account:&str)->Result<Value,String>{
 authorize(c,account)?;
 let raw:Option<String>=c.query_row("SELECT value FROM sync_state WHERE key=?1",[local_db::scoped_state_key(c,"salvage_snapshot")?],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
 let mut snapshot:Value=match raw{Some(raw)=>serde_json::from_str(&raw).map_err(|e|format!("Invalid salvage snapshot: {e}"))?,None=>json!({"records":[],"downloaded":false,"last_synced_at":null})};
 let mut records=snapshot["records"].as_array().ok_or("Invalid salvage snapshot records")?.iter().filter(|row|{
  row["project_id"].is_null()||row["project_id"].as_str().is_some_and(|id|local_projects::require_cached_project_access(c,id,false).is_ok())
 }).cloned().collect::<Vec<_>>();
 let mut q=c.prepare("SELECT o.entity_id,o.operation,o.payload_json,o.last_error,o.synced_at FROM active_sync_outbox o WHERE o.entity_type='salvage_recovery' AND (o.synced_at IS NULL OR julianday(o.synced_at)>=COALESCE(julianday(?1),0)) AND NOT EXISTS(SELECT 1 FROM sync_conflicts d WHERE d.change_id=o.change_id AND d.resolved_at IS NOT NULL AND d.resolution IN ('accept_server','dismiss')) ORDER BY o.created_at,o.change_id").map_err(|e|e.to_string())?;
 let rows=q.query_map([snapshot["last_synced_at"].as_str()],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,Option<String>>(3)?,r.get::<_,Option<String>>(4)?))).map_err(|e|e.to_string())?;
 let mut pending=0;
 for row in rows{
  let(id,operation,raw,error,synced)=row.map_err(|e|e.to_string())?;
  let payload:Value=serde_json::from_str(&raw).map_err(|e|e.to_string())?;
  if operation=="create_batch"{
   let common=&payload["record"];
   if common["project_id"].as_str().is_some_and(|p|local_projects::require_cached_project_access(c,p,false).is_err()){continue;}
   for output in common["outputs"].as_array().ok_or("Invalid saved recovery batch")?{
    let output_id=output["id"].as_str().ok_or("Invalid saved recovery output")?;
    if !records.iter().any(|r|r["id"]==output_id){
     let mut record=common.clone();record.as_object_mut().ok_or("Invalid recovery batch")?.remove("outputs");
     for (key,value) in output.as_object().ok_or("Invalid recovery output")?{record[key.as_str()]=value.clone();}
     record["batch_id"]=json!(id);record["quarantine_status"]=json!("quarantined");record["condition"]=json!("uninspected");records.push(record);
    }
    if let Some(record)=records.iter_mut().find(|r|r["id"]==output_id){record["local_pending_action"]=json!(if synced.is_some(){"awaiting_snapshot"}else{"create_batch"});record["local_pending_record"]=common.clone();record["local_error"]=json!(error);}
   }
   if synced.is_none(){pending+=1;}continue;
  }
  let index=records.iter().position(|r|r["id"]==id);
  if operation=="create"&&index.is_none(){
   let mut record=payload["record"].clone();
   if record["project_id"].as_str().is_some_and(|p|local_projects::require_cached_project_access(c,p,false).is_err()){continue;}
   record["id"]=json!(id);record["quarantine_status"]=json!("quarantined");records.push(record);
  }
  if let Some(record)=records.iter_mut().find(|r|r["id"]==id){record["local_pending_action"]=json!(if synced.is_some(){"awaiting_snapshot"}else{&operation});record["local_pending_record"]=payload["record"].clone();record["local_error"]=json!(error);if synced.is_none(){pending+=1;}}
 }
 snapshot["pending_count"]=json!(pending);
 snapshot["records"]=json!(records);
 authorize(c,account)?;Ok(snapshot)
}
fn pull(c:&mut Connection,account:&str,records:Vec<Value>,complete:bool)->Result<(),String>{
 if !complete{return Err("Salvage snapshot is incomplete".into());}
 let mut ids=std::collections::HashSet::new();
 for record in &records{
  let id=uuid::Uuid::parse_str(record["id"].as_str().ok_or("Recovery ID required")?).map_err(|_|"Invalid recovery ID")?.to_string();
  if record["id"]!=id||!ids.insert(id){return Err("Duplicate or noncanonical recovery identity".into());}
  if !record["project_id"].is_null(){uuid::Uuid::parse_str(record["project_id"].as_str().ok_or("Invalid recovery project")?).map_err(|_|"Invalid recovery project")?;}
 }
 let tx=c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
 authorize(&tx,account)?;
 let now:String=tx.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')",[],|r|r.get(0)).map_err(|e|e.to_string())?;
 let snapshot=json!({"records":records,"downloaded":true,"last_synced_at":now});
 tx.execute("INSERT INTO sync_state(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![local_db::scoped_state_key(&tx,"salvage_snapshot")?,snapshot.to_string()]).map_err(|e|e.to_string())?;
 tx.commit().map_err(|e|e.to_string())
}
#[tauri::command]
pub fn get_local_salvage_snapshot(app:tauri::AppHandle,expected_account_id:String)->Result<Value,String>{read(&local_db::open_local_connection(&app)?,&expected_account_id)}
#[tauri::command]
pub fn apply_server_salvage_pull(app:tauri::AppHandle,records:Vec<Value>,snapshot_complete:bool,expected_account_id:String)->Result<(),String>{pull(&mut local_db::open_local_connection(&app)?,&expected_account_id,records,snapshot_complete)}

fn sources(c:&Connection,account:&str,item:&str)->Result<Value,String>{
 authorize(c,account)?;let item=crate::inventory_sync_state::canonical_id(item)?;
 let cached=crate::local_inventory::list_movements(c,&item)?;
 let downloaded=cached.is_some();let mut records=Vec::new();
 for raw in cached.unwrap_or_default(){
  let row:Value=serde_json::from_str(&raw).map_err(|e|format!("Invalid cached source movement: {e}"))?;
  if row["item_id"]!=item||row["movement_type"]!="consume"{continue;}
  if !row["project_id"].is_null()&&row["project_id"].as_str().is_none_or(|id|local_projects::require_cached_project_access(c,id,false).is_err()){continue;}
  records.push(row);
 }
 authorize(c,account)?;Ok(json!({"downloaded":downloaded,"records":records}))
}
#[tauri::command]
pub fn get_local_salvage_sources(app:tauri::AppHandle,expected_account_id:String,item_id:String)->Result<Value,String>{sources(&local_db::open_local_connection(&app)?,&expected_account_id,&item_id)}

fn custody_sources(c:&Connection,account:&str,item:&str)->Result<Value,String>{
 authorize(c,account)?;let item=crate::inventory_sync_state::canonical_id(item)?;
 let cached=crate::local_inventory::list_custody(c,&item)?;let downloaded=cached.is_some();let mut records=Vec::new();
 for raw in cached.unwrap_or_default(){let row:Value=serde_json::from_str(&raw).map_err(|e|e.to_string())?;
  if row["item_id"]!=item||!matches!(row["status"].as_str(),Some("issued"|"partially_settled"))||row["outstanding_quantity"].as_f64().or_else(||row["outstanding_quantity"].as_str().and_then(|s|s.parse::<f64>().ok())).is_none_or(|n|n<=0.0){continue;}
  if !row["project_id"].is_null()&&row["project_id"].as_str().is_none_or(|p|local_projects::require_cached_project_access(c,p,false).is_err()){continue;}records.push(row);
 }
 authorize(c,account)?;Ok(json!({"downloaded":downloaded,"records":records}))
}
#[tauri::command]
pub fn get_local_salvage_custody_sources(app:tauri::AppHandle,expected_account_id:String,item_id:String)->Result<Value,String>{custody_sources(&local_db::open_local_connection(&app)?,&expected_account_id,&item_id)}

#[derive(serde::Deserialize,Clone)]
pub struct SalvageIntent{pub expected_account_id:String,pub change_id:String,pub recovery_id:String,pub operation:String,pub record:Value,pub expected_version:Option<i64>}
fn save(c:&mut Connection,mut input:SalvageIntent)->Result<Value,String>{
 let id=crate::inventory_sync_state::canonical_id(&input.recovery_id)?;
 let change=crate::inventory_sync_state::canonical_id(&input.change_id)?;
 let tx=c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
 authorize(&tx,&input.expected_account_id)?;
 let creating=matches!(input.operation.as_str(),"create"|"create_batch");
 let permission=match input.operation.as_str(){"create"|"create_batch"=>"inventory.create","inspect"=>"inventory.edit","release"=>"inventory.adjust_stock",_=>return Err("Invalid salvage operation".into())};
 local_auth::require_local_permission(&tx,permission)?;
 let snapshot=read(&tx,&input.expected_account_id)?;
 let existing=snapshot["records"].as_array().and_then(|r|r.iter().find(|r|r["id"]==id));
 if !input.record.is_object(){return Err("Recovery intention must be an object".into());}
 for (field,max) in [("unit",100),("attestation_notes",4000),("valuation_notes",4000),("repair_verification_notes",4000)]{
  if !input.record[field].is_null()&&input.record[field].as_str().is_none_or(|s|s.chars().count()>max){return Err(format!("Invalid recovery {field}"));}
 }
 if input.operation=="inspect"{
  if existing.is_some_and(|r|!r["repair_received_at"].is_null())&&input.record["approval"]=="approved"&&matches!(input.record["condition"].as_str(),Some("like_new"|"good"|"fair"))&&input.record["repair_verification_notes"].as_str().is_none_or(|s|s.trim().is_empty()){return Err("Describe the completed repair and verification before approving usable condition".into());}
  if !matches!(input.record["approval"].as_str(),Some("approved"|"rejected")){return Err("Inspection approval required".into());}
  if !input.record["condition"].is_null()&&!matches!(input.record["condition"].as_str(),Some("uninspected"|"like_new"|"good"|"fair"|"damaged_repairable"|"scrap")){return Err("Invalid inspected condition".into());}
  if !input.record["reviewed_valuation"].is_null(){let n=input.record["reviewed_valuation"].as_f64().ok_or("Invalid reviewed recovery value")?;if !n.is_finite()||!(0.0..=9999999999.99).contains(&n){return Err("Invalid reviewed recovery value".into());}}
 }
 for field in ["source_item_id","source_movement_id","source_custody_id","project_id"]{if !input.record[field].is_null(){input.record[field]=json!(crate::inventory_sync_state::canonical_id(input.record[field].as_str().ok_or("Recovery reference must be a UUID")?)?);}}
 if creating&&!input.record["source_custody_id"].is_null(){
  if input.operation!="create"||!input.record["source_movement_id"].is_null()||!matches!(input.record["recovery_type"].as_str(),Some("equipment_return"|"unused_stock_return")){return Err("Custody requires a return without disassembly or consumption".into());}
  let item=input.record["source_item_id"].as_str().ok_or("Select the issued inventory item")?;
  let snapshot=custody_sources(&tx,&input.expected_account_id,item)?;
  let custody=snapshot["records"].as_array().and_then(|rows|rows.iter().find(|r|r["id"]==input.record["source_custody_id"])).ok_or("Select an available cached custody record")?;
  let amount=|v:&Value|v.as_f64().or_else(||v.as_str().and_then(|s|s.parse::<f64>().ok()));
  let quantity=amount(&input.record["recovered_quantity"]).ok_or("Return quantity required")?;
  if amount(&input.record["source_quantity"])!=Some(quantity)||amount(&custody["outstanding_quantity"]).is_none_or(|n|quantity>n)||custody["serial_number"].as_str().is_some_and(|s|!s.is_empty())&&quantity!=1.0{return Err("Return exceeds issued quantity or changes its source quantity".into());}
  if (!input.record["project_id"].is_null()&&input.record["project_id"]!=custody["project_id"])||(!input.record["unit"].is_null()&&input.record["unit"]!=custody["unit"]){return Err("Preserve issued project and unit".into());}
  input.record["project_id"]=custody["project_id"].clone();input.record["unit"]=custody["unit"].clone();
 }
 if !creating{input.record["project_id"]=existing.map(|r|r["project_id"].clone()).unwrap_or(Value::Null);}
 if input.operation=="create_batch"{
  let outputs=input.record["outputs"].as_array_mut().ok_or("Recovery outputs required")?;
  if !(2..=25).contains(&outputs.len()){return Err("A batch requires 2 to 25 outputs".into());}
  let mut ids=std::collections::HashSet::new();
  for (index,output) in outputs.iter_mut().enumerate(){
   let output_id=crate::inventory_sync_state::canonical_id(output["id"].as_str().ok_or("Output identity required")?)?;
   if (index==0&&output_id!=id)||!ids.insert(output_id.clone()){return Err("Unique stable batch output identities required".into());}
   output["id"]=json!(output_id);
   if !matches!(output["recovery_type"].as_str(),Some("disassembly_output"|"scrap")){return Err("Batch outputs must be disassembly material or scrap".into());}
   if output.as_object().is_none_or(|o|o.keys().any(|key|!matches!(key.as_str(),"id"|"recovered_item_name"|"recovered_quantity"|"unit"|"recovery_type"))){return Err("Output cannot override common source provenance".into());}
  }
 }
 let payload=json!({"record":input.record,"expected_version":input.expected_version});
 let previous:Option<(String,String,String)>=tx.query_row("SELECT entity_id,operation,payload_json FROM active_sync_outbox WHERE change_id=?1",[&change],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(|e|e.to_string())?;
 if let Some((old_id,old_op,old_payload))=previous{
  if old_id!=id||old_op!=input.operation||serde_json::from_str::<Value>(&old_payload).map_err(|e|e.to_string())?!=payload{return Err("Salvage retry identity does not match saved intention".into());}
  return existing.cloned().ok_or_else(||"Saved intention requires authorized reconciliation".into());
 }
 let project=if creating{
  if existing.is_some(){return Err("Recovery identity already exists".into());}
  for field in ["source_item_id","source_movement_id","project_id"]{if let Some(value)=input.record[field].as_str(){crate::inventory_sync_state::canonical_id(value)?;}}
  let outputs=if input.operation=="create_batch"{input.record["outputs"].as_array().ok_or("Outputs required")?.clone()}else{vec![input.record.clone()]};
  for output in outputs{
   let name=output["recovered_item_name"].as_str().ok_or("Recovery name required")?;
   if name.trim().is_empty()||name.len()>1000{return Err("Recovery name required, at most 1000 bytes".into());}
   if !matches!(output["recovery_type"].as_str(),Some("unused_stock_return"|"equipment_return"|"component_recovery"|"disassembly_output"|"scrap")){return Err("Invalid recovery type".into());}
   if !output["unit"].is_null()&&output["unit"].as_str().is_none_or(|s|s.chars().count()>100){return Err("Invalid recovery unit".into());}
   if input.operation=="create_batch"&&snapshot["records"].as_array().is_some_and(|rows|rows.iter().any(|r|r["id"]==output["id"])) {return Err("Recovery output identity already exists".into());}
   for value in [&input.record["source_quantity"],&output["recovered_quantity"]]{let n=value.as_f64().or_else(||value.as_str().and_then(|s|s.parse::<f64>().ok())).ok_or("Recovery quantity required")?;if !n.is_finite()||n<=0.0||n>999999999.999||(n*1000.0-(n*1000.0).round()).abs()>0.0001{return Err("Positive recovery quantity with at most three decimals required".into());}}
  }
  if input.record["source_movement_id"].is_null()&&input.record["source_custody_id"].is_null()&&input.record["attestation_notes"].as_str().is_none_or(|s|s.trim().is_empty()){return Err("Historical source requires explicit attestation".into());}
  input.record["project_id"].as_str()
 }else{
  let record=existing.ok_or("Synchronize recovery before reviewing it")?;
  if record["quarantine_status"]=="released"{return Err("Recovery has already been released".into());}
  if input.operation=="release"&&record["quarantine_status"]!="inspected_approved"{return Err("Synchronize an approved inspection before requesting stock release".into());}
  if !record["local_pending_action"].is_null(){return Err("Synchronize or resolve the previous recovery intention first".into());}
  let version=record["sync_version"].as_i64().or_else(||record["sync_version"].as_str().and_then(|v|v.parse().ok()));
  if version.is_none()||version!=input.expected_version{return Err("Recovery changed; refresh before reviewing".into());}
  record["project_id"].as_str()
 };
 if let Some(project)=project{local_projects::require_cached_project_access(&tx,project,true)?;}
 let device:String=tx.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).map_err(|e|e.to_string())?;
 tx.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,'salvage_recovery',?3,?4,?5)",params![change,device,id,input.operation,payload.to_string()]).map_err(|e|e.to_string())?;
 let result=read(&tx,&input.expected_account_id)?["records"].as_array().and_then(|r|r.iter().find(|r|r["id"]==id)).cloned().ok_or("Saved recovery could not be projected")?;
 tx.commit().map_err(|e|e.to_string())?;Ok(result)
}
#[tauri::command]
pub fn save_local_salvage_intent(app:tauri::AppHandle,input:SalvageIntent)->Result<Value,String>{save(&mut local_db::open_local_connection(&app)?,input)}

#[cfg(test)]
mod tests{
 use super::*;
 const ACCOUNT:&str="10000000-0000-4000-8000-000000000001";
 const RECORD:&str="20000000-0000-4000-8000-000000000001";
 const PROJECT:&str="30000000-0000-4000-8000-000000000001";
 #[test]
 fn repair_inspection_requires_notes_and_preserves_the_review_in_the_outbox(){
  let path=std::env::temp_dir().join(format!("labos-repair-{}.sqlite",uuid::Uuid::new_v4()));
  let mut c=Connection::open(&path).unwrap();local_db::ensure_schema(&c).unwrap();
  c.execute_batch("CREATE TABLE local_users(id TEXT PRIMARY KEY,central_user_id TEXT,is_active INTEGER,offline_expires_at TEXT,permissions_json TEXT,role TEXT);CREATE TABLE local_session(id INTEGER PRIMARY KEY,user_id TEXT);").unwrap();
  c.execute("INSERT INTO local_users VALUES('a',?1,1,datetime('now','+24 hours'),'[\"inventory.view\",\"inventory.edit\"]','researcher')",[ACCOUNT]).unwrap();
  c.execute("INSERT INTO local_session VALUES(1,'a')",[]).unwrap();
  pull(&mut c,ACCOUNT,vec![json!({"id":RECORD,"project_id":null,"quarantine_status":"quarantined","condition":"damaged_repairable","repair_received_at":"2026-11-01T12:00:00Z","sync_version":3})],true).unwrap();
  let mut review=SalvageIntent{expected_account_id:ACCOUNT.into(),change_id:uuid::Uuid::new_v4().to_string(),recovery_id:RECORD.into(),operation:"inspect".into(),expected_version:Some(3),record:json!({"approval":"approved","condition":"good"})};
  assert!(save(&mut c,review.clone()).unwrap_err().contains("repair and verification"));
  assert_eq!(c.query_row("SELECT COUNT(*) FROM sync_outbox",[],|r|r.get::<_,i64>(0)).unwrap(),0);
  review.record["repair_verification_notes"]=json!("Repaired connection and verified operation under load");
  save(&mut c,review.clone()).unwrap();
  let payload:String=c.query_row("SELECT payload_json FROM sync_outbox WHERE change_id=?1",[&review.change_id],|r|r.get(0)).unwrap();
  let payload:Value=serde_json::from_str(&payload).unwrap();
  assert_eq!(payload["expected_version"],3);assert_eq!(payload["record"]["repair_verification_notes"],review.record["repair_verification_notes"]);
  assert_eq!(read(&c,ACCOUNT).unwrap()["records"][0]["quarantine_status"],"quarantined");
  drop(c);std::fs::remove_file(path).unwrap();
 }
 #[test]
 fn snapshot_survives_reopen_and_fences_account_scope_and_partial_pull(){
  let path=std::env::temp_dir().join(format!("labos-salvage-{}.sqlite",uuid::Uuid::new_v4()));
  let mut c=Connection::open(&path).unwrap();local_db::ensure_schema(&c).unwrap();
  c.execute_batch("CREATE TABLE local_users(id TEXT PRIMARY KEY,central_user_id TEXT,is_active INTEGER,offline_expires_at TEXT,permissions_json TEXT,role TEXT);CREATE TABLE local_session(id INTEGER PRIMARY KEY,user_id TEXT);").unwrap();
  c.execute("INSERT INTO local_users VALUES('a',?1,1,datetime('now','+24 hours'),'[\"inventory.view\",\"projects.view\"]','researcher')",[ACCOUNT]).unwrap();
  c.execute("INSERT INTO local_session VALUES(1,'a')",[]).unwrap();
  assert_eq!(read(&c,ACCOUNT).unwrap()["downloaded"],false);
  let row=json!({"id":RECORD,"project_id":null,"recovered_item_name":"Recovered board"});
  pull(&mut c,ACCOUNT,vec![row.clone()],true).unwrap();
  assert!(pull(&mut c,ACCOUNT,vec![],false).is_err());
  assert!(pull(&mut c,ACCOUNT,vec![row.clone(),row.clone()],true).is_err());
  assert!(pull(&mut c,"another-account",vec![],true).is_err());
  drop(c);let mut c=Connection::open(&path).unwrap();
  assert_eq!(read(&c,ACCOUNT).unwrap()["records"][0],row);
  let scoped=json!({"id":RECORD,"project_id":PROJECT});
  let key=local_db::scoped_state_key(&c,"projects_state").unwrap();
  let project=json!({"id":PROJECT,"visibility":"restricted","permissions":{"user_id":ACCOUNT,"access":"view","can_edit":false}});
  c.execute("INSERT INTO sync_state(key,value) VALUES(?1,?2)",params![key,json!([project]).to_string()]).unwrap();
  pull(&mut c,ACCOUNT,vec![scoped],true).unwrap();
  assert_eq!(read(&c,ACCOUNT).unwrap()["records"].as_array().unwrap().len(),1);
  c.execute("UPDATE sync_state SET value='[]' WHERE key=?1",[key]).unwrap();
  assert_eq!(read(&c,ACCOUNT).unwrap()["records"],json!([]));
  pull(&mut c,ACCOUNT,vec![],true).unwrap();
  let empty=read(&c,ACCOUNT).unwrap();assert_eq!(empty["downloaded"],true);assert_eq!(empty["records"],json!([]));
  assert!(empty["last_synced_at"].is_string());
  c.execute("UPDATE local_users SET permissions_json='[\"inventory.view\",\"inventory.create\",\"inventory.edit\",\"inventory.adjust_stock\",\"projects.view\"]'",[]).unwrap();
  let intent=SalvageIntent{expected_account_id:ACCOUNT.into(),change_id:uuid::Uuid::new_v4().to_string(),recovery_id:RECORD.into(),operation:"create".into(),expected_version:None,
   record:json!({"recovered_item_name":"Offline board","recovery_type":"component_recovery","source_quantity":1,"recovered_quantity":2,"attestation_notes":"Explicit historical source","quarantine_status":"inspected_approved"})};
  c.execute_batch("CREATE TRIGGER fail_salvage BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT,'outbox failure'); END;").unwrap();
  assert!(save(&mut c,intent.clone()).is_err());
  assert_eq!(read(&c,ACCOUNT).unwrap()["records"],json!([]));
  c.execute_batch("DROP TRIGGER fail_salvage;").unwrap();
  let saved=save(&mut c,intent.clone()).unwrap();assert_eq!(saved["quarantine_status"],"quarantined");
  save(&mut c,intent.clone()).unwrap();
  assert_eq!(c.query_row("SELECT COUNT(*) FROM sync_outbox",[],|r|r.get::<_,i64>(0)).unwrap(),1);
  let mut changed=intent.clone();changed.record["recovered_item_name"]=json!("Different retry");assert!(save(&mut c,changed).is_err());
  drop(c);let mut c=Connection::open(&path).unwrap();
  assert_eq!(read(&c,ACCOUNT).unwrap()["records"][0]["local_pending_action"],"create");
  c.execute("DELETE FROM sync_state WHERE key=?1",[local_db::scoped_state_key(&c,"salvage_snapshot").unwrap()]).unwrap();
  local_db::mark_changes_synced(&mut c,vec![intent.change_id]).unwrap();
  assert_eq!(read(&c,ACCOUNT).unwrap()["records"][0]["local_pending_action"],"awaiting_snapshot");
  c.execute("UPDATE sync_outbox SET synced_at=datetime('now','-1 second')",[]).unwrap();
  let confirmed=json!({"id":RECORD,"project_id":null,"quarantine_status":"quarantined","sync_version":"1"});
  pull(&mut c,ACCOUNT,vec![confirmed],true).unwrap();
  let review=SalvageIntent{expected_account_id:ACCOUNT.into(),change_id:uuid::Uuid::new_v4().to_string(),recovery_id:RECORD.into(),operation:"inspect".into(),expected_version:Some(1),record:json!({"approval":"approved","condition":"good"})};
  let mut invalid=review.clone();invalid.record["approval"]=json!("invented");assert!(save(&mut c,invalid).is_err());
  let mut invalid=review.clone();invalid.record["reviewed_valuation"]=json!(-1);assert!(save(&mut c,invalid).is_err());
  let mut stale=review.clone();stale.expected_version=Some(2);assert!(save(&mut c,stale).is_err());
  let mut release=review.clone();release.operation="release".into();release.record=json!({});assert!(save(&mut c,release).is_err());
  save(&mut c,review).unwrap();
  let record=read(&c,ACCOUNT).unwrap()["records"][0].clone();
  assert_eq!(record["quarantine_status"],"quarantined");assert_eq!(record["local_pending_action"],"inspect");
  let source_item="40000000-0000-4000-8000-000000000001";
  assert_eq!(sources(&c,ACCOUNT,source_item).unwrap()["downloaded"],false);
  for (kind,project,owner) in [("consume",Value::Null,ACCOUNT),("consume",json!(PROJECT),ACCOUNT),("receive",Value::Null,ACCOUNT),("consume",Value::Null,"another-account")]{
   let id=uuid::Uuid::new_v4().to_string();let movement=json!({"id":id,"item_id":source_item,"movement_type":kind,"project_id":project,"quantity":1});
   c.execute("INSERT INTO local_inventory_movement_records(movement_id,item_id,account_id,movement_json) VALUES(?1,?2,?3,?4)",params![id,source_item,owner,movement.to_string()]).unwrap();
  }
  let available=sources(&c,ACCOUNT,source_item).unwrap();assert_eq!(available["downloaded"],true);assert_eq!(available["records"].as_array().unwrap().len(),1);
  let source_key=local_db::scoped_state_key(&c,"projects_state").unwrap();
  let project=json!({"id":PROJECT,"visibility":"restricted","permissions":{"user_id":ACCOUNT,"access":"view","can_edit":false}});
  c.execute("UPDATE sync_state SET value=?1 WHERE key=?2",params![json!([project]).to_string(),source_key]).unwrap();
  assert_eq!(sources(&c,ACCOUNT,source_item).unwrap()["records"].as_array().unwrap().len(),2);
  c.execute("UPDATE sync_state SET value='[]' WHERE key=?1",[source_key]).unwrap();
  assert_eq!(sources(&c,ACCOUNT,source_item).unwrap()["records"].as_array().unwrap().len(),1);
  assert!(sources(&c,"another-account",source_item).is_err());
  drop(c);let c=Connection::open(&path).unwrap();
  assert_eq!(sources(&c,ACCOUNT,source_item).unwrap()["records"].as_array().unwrap().len(),1);
  drop(c);let mut c=Connection::open(&path).unwrap();
  let batch_id=uuid::Uuid::new_v4().to_string();let second=uuid::Uuid::new_v4().to_string();
  let batch=SalvageIntent{expected_account_id:ACCOUNT.into(),change_id:uuid::Uuid::new_v4().to_string(),recovery_id:batch_id.clone(),operation:"create_batch".into(),expected_version:None,
   record:json!({"source_quantity":1,"source_item_id":source_item,"attestation_notes":"Historical dismantled assembly", "outputs":[
    {"id":batch_id,"recovered_item_name":"Motor","recovered_quantity":2,"unit":"each","recovery_type":"disassembly_output"},
    {"id":second,"recovered_item_name":"Copper scrap","recovered_quantity":0.5,"unit":"kg","recovery_type":"scrap"}]})};
  let count:i64=c.query_row("SELECT COUNT(*) FROM active_sync_outbox",[],|r|r.get(0)).unwrap();
  c.execute_batch("CREATE TRIGGER fail_batch BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT,'batch outbox failure'); END;").unwrap();
  assert!(save(&mut c,batch.clone()).is_err());assert!(!read(&c,ACCOUNT).unwrap()["records"].as_array().unwrap().iter().any(|r|r["batch_id"]==batch_id));
  c.execute_batch("DROP TRIGGER fail_batch;").unwrap();
  save(&mut c,batch.clone()).unwrap();save(&mut c,batch.clone()).unwrap();
  assert_eq!(c.query_row("SELECT COUNT(*) FROM active_sync_outbox",[],|r|r.get::<_,i64>(0)).unwrap(),count+1);
  let snapshot=read(&c,ACCOUNT).unwrap();let outputs=snapshot["records"].as_array().unwrap().iter().filter(|r|r["batch_id"]==batch_id).collect::<Vec<_>>();
  assert_eq!(outputs.len(),2);assert!(outputs.iter().all(|r|r["quarantine_status"]=="quarantined"&&r["local_pending_action"]=="create_batch"));
  assert_eq!(outputs.iter().find(|r|r["id"]==second).unwrap()["unit"],"kg");
  let mut duplicate=batch.clone();duplicate.change_id=uuid::Uuid::new_v4().to_string();duplicate.record["outputs"][1]["id"]=json!(batch_id);assert!(save(&mut c,duplicate).is_err());
  let mut altered=batch.clone();altered.record["outputs"][1]["recovered_quantity"]=json!(3);assert!(save(&mut c,altered).is_err());
  let mut invalid=batch.clone();invalid.change_id=uuid::Uuid::new_v4().to_string();invalid.recovery_id=uuid::Uuid::new_v4().to_string();invalid.record["outputs"][0]["id"]=json!(invalid.recovery_id);invalid.record["outputs"][1]["id"]=json!(uuid::Uuid::new_v4().to_string());invalid.record["outputs"][1]["source_quantity"]=json!(2);assert!(save(&mut c,invalid).is_err());
  assert_eq!(c.query_row("SELECT COUNT(*) FROM active_sync_outbox",[],|r|r.get::<_,i64>(0)).unwrap(),count+1);
  drop(c);let c=Connection::open(&path).unwrap();assert_eq!(read(&c,ACCOUNT).unwrap()["records"].as_array().unwrap().iter().filter(|r|r["batch_id"]==batch_id).count(),2);
  drop(c);let mut c=Connection::open(&path).unwrap();
  assert_eq!(custody_sources(&c,ACCOUNT,source_item).unwrap()["downloaded"],false);
  let held=uuid::Uuid::new_v4().to_string();let private_held=uuid::Uuid::new_v4().to_string();
  for (key,project) in [(&held,Value::Null),(&private_held,json!(PROJECT))]{let row=json!({"id":key,"item_id":source_item,"project_id":project,"status":"issued","outstanding_quantity":2,"unit":"each","recipient_id":ACCOUNT});c.execute("INSERT INTO local_inventory_custody_records(custody_id,item_id,custody_json,account_id) VALUES(?1,?2,?3,?4)",params![key,source_item,row.to_string(),ACCOUNT]).unwrap();}
  assert_eq!(custody_sources(&c,ACCOUNT,source_item).unwrap()["records"].as_array().unwrap().len(),1);
  let returned_id=uuid::Uuid::new_v4().to_string();
  let returned=SalvageIntent{expected_account_id:ACCOUNT.into(),change_id:uuid::Uuid::new_v4().to_string(),recovery_id:returned_id.clone(),operation:"create".into(),expected_version:None,record:json!({"source_custody_id":held,"source_item_id":source_item,"recovery_type":"equipment_return","recovered_item_name":"Returned tool","source_quantity":1,"recovered_quantity":1,"unit":"each"})};
  let mut excessive=returned.clone();excessive.record["source_quantity"]=json!(3);excessive.record["recovered_quantity"]=json!(3);assert!(save(&mut c,excessive).is_err());
  let mut mixed=returned.clone();mixed.record["source_movement_id"]=json!(uuid::Uuid::new_v4().to_string());assert!(save(&mut c,mixed).is_err());
  let mut foreign=returned.clone();foreign.record["source_custody_id"]=json!(private_held);assert!(save(&mut c,foreign).is_err());
  save(&mut c,returned.clone()).unwrap();save(&mut c,returned).unwrap();
  let projected=read(&c,ACCOUNT).unwrap();let projected=projected["records"].as_array().unwrap().iter().find(|r|r["id"]==returned_id).unwrap();assert_eq!(projected["quarantine_status"],"quarantined");assert_eq!(projected["source_custody_id"],held);
  assert_eq!(custody_sources(&c,ACCOUNT,source_item).unwrap()["records"][0]["outstanding_quantity"],2);
  c.execute("UPDATE local_users SET permissions_json='[]'",[]).unwrap();assert!(sources(&c,ACCOUNT,source_item).is_err());assert!(custody_sources(&c,ACCOUNT,source_item).is_err());
  drop(c);std::fs::remove_file(path).unwrap();
 }
}
