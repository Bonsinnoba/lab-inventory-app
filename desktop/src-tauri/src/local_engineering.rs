use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use tauri::AppHandle;
use crate::local_db;
use crate::local_auth;

const CALC_KEY: &str = "engineering_calculations_state";
const TEST_KEY: &str = "engineering_tests_state";
const SCHEMA_VERSION: &str = "001_local_engineering";

fn conn(app:&AppHandle)->Result<Connection,String>{local_db::open_local_connection(app)}
fn ensure(c:&Connection)->Result<(),String>{
 c.execute("INSERT OR IGNORE INTO local_schema_migrations(version) VALUES (?1)",[SCHEMA_VERSION]).map_err(|e|format!("Unable to record local engineering schema: {e}"))?;
 for key in [CALC_KEY,TEST_KEY] { c.execute("INSERT OR IGNORE INTO sync_state(key,value) VALUES (?1,'[]')",[key]).map_err(|e|format!("Unable to initialize local engineering state: {e}"))?; }
 Ok(())
}
fn load(c:&Connection,key:&str)->Result<Vec<Value>,String>{ensure(c)?;let raw:Option<String>=c.query_row("SELECT value FROM sync_state WHERE key=?1",[key],|r|r.get(0)).optional().map_err(|e|format!("Unable to read engineering state: {e}"))?;Ok(raw.map(|v|serde_json::from_str(&v).unwrap_or_default()).unwrap_or_default())}
fn now(c:&Connection)->Result<String,String>{c.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')",[],|r|r.get(0)).map_err(|e|format!("Unable to create timestamp: {e}"))}
fn id()->String{uuid::Uuid::new_v4().to_string()}
fn save(c:&mut Connection,key:&str,rows:&[Value],change:Option<(&str,&str,&str,&Value)>)->Result<(),String>{
    if let Some((entity_type,_,operation,_))=change{
        let permission=match (entity_type,operation){("engineering_calculation","create")|("engineering_test","create")=>"engineering.create",("engineering_calculation","delete")|("engineering_test","delete")=>"engineering.delete",_=>"engineering.edit"};
        local_auth::require_local_permission(c,permission)?;
    }
 let tx=c.transaction().map_err(|e|format!("Unable to begin engineering transaction: {e}"))?;
 tx.execute("INSERT INTO sync_state(key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![key,serde_json::to_string(rows).map_err(|e|e.to_string())?]).map_err(|e|format!("Unable to save engineering state: {e}"))?;
 if let Some((entity_type,entity_id,operation,payload))=change {let device:String=tx.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).map_err(|e|e.to_string())?;tx.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES (?1,?2,?3,?4,?5,?6)",params![id(),device,entity_type,entity_id,operation,payload.to_string()]).map_err(|e|format!("Unable to queue engineering change: {e}"))?;}
 tx.commit().map_err(|e|format!("Unable to commit engineering change: {e}"))
}
#[tauri::command]
pub fn get_local_engineering_formulas()->Vec<Value>{
 vec![
  json!({"id":"ohms_law","key":"ohms_law","name":"Ohm's Law","category":"electronics","expression":"V = I × R","description":"Voltage from current and resistance.","input_schema":{"inputs":["current_A","resistance_ohm"]}}),
  json!({"id":"power_vi","key":"power_vi","name":"DC Power","category":"electronics","expression":"P = V × I","description":"Power from voltage and current.","input_schema":{"inputs":["voltage_V","current_A"]}}),
  json!({"id":"voltage_divider","key":"voltage_divider","name":"Voltage Divider","category":"electronics","expression":"Vout = Vin × R2 / (R1 + R2)","description":"Output voltage across the lower resistor.","input_schema":{"inputs":["vin_V","r1_ohm","r2_ohm"]}}),
  json!({"id":"led_resistor","key":"led_resistor","name":"LED Resistor","category":"electronics","expression":"R = (Vs − Vf) / I","description":"Series resistor for an LED.","input_schema":{"inputs":["supply_V","forward_V","current_A"]}})
 ]
}
fn num(v:&Value,k:&str)->Option<f64>{v.get(k).and_then(|x|x.as_f64()).or_else(||v.get(k).and_then(|x|x.as_str()).and_then(|s|s.parse().ok()))}
#[tauri::command]
pub fn calculate_local_engineering(formula:String,inputs:Value)->Result<Value,String>{
 let n=|k:&str|num(&inputs,k);
 let (result,unit)=match formula.as_str(){
  "ohms_law"=>(n("current_A").zip(n("resistance_ohm")).map(|(a,b)|a*b),"V"),
  "power_vi"=>(n("voltage_V").zip(n("current_A")).map(|(a,b)|a*b),"W"),
  "voltage_divider"=>{let a=n("vin_V");let b=n("r1_ohm");let d=n("r2_ohm");(a.zip(b.zip(d)).and_then(|(v,(r1,r2))|if r1+r2!=0.0{Some(v*r2/(r1+r2))}else{None}),"V")},
  "led_resistor"=>{let a=n("supply_V");let b=n("forward_V");let d=n("current_A");(a.zip(b.zip(d)).and_then(|(s,(f,i))|if i>0.0{Some((s-f)/i)}else{None}),"ohm")},
  _=>(None,"")
 };
 match result {Some(value)=>Ok(json!({"formula":formula,"inputs":inputs,"result_numeric":value,"result_unit":unit})),None=>Err("Unsupported formula or incomplete inputs".into())}
}
#[tauri::command]
pub fn get_local_engineering_calculations(app:AppHandle)->Result<Vec<Value>,String>{let c=conn(&app)?;load(&c,CALC_KEY)}
#[tauri::command]
pub fn create_local_engineering_calculation(app:AppHandle,mut record:Value)->Result<Value,String>{let mut c=conn(&app)?;let mut rows=load(&c,CALC_KEY)?;if record.get("title").and_then(Value::as_str).map(|s|s.trim().is_empty()).unwrap_or(true)||record.get("formula").and_then(Value::as_str).map(|s|s.trim().is_empty()).unwrap_or(true){return Err("title and formula are required".into())}let ts=now(&c)?;let rid=id();record["id"]=json!(&rid);record["category"]=record.get("category").cloned().unwrap_or(json!("general"));record["inputs"]=record.get("inputs").cloned().unwrap_or(json!({}));record["result_unit"]=record.get("result_unit").cloned().unwrap_or(json!(""));record["created_at"]=json!(&ts);record["updated_at"]=json!(&ts);rows.insert(0,record.clone());save(&mut c,CALC_KEY,&rows,Some(("engineering_calculation",&rid,"create",&record)))?;Ok(record)}
#[tauri::command]
pub fn delete_local_engineering_calculation(app:AppHandle,id:String)->Result<(),String>{let mut c=conn(&app)?;let mut rows=load(&c,CALC_KEY)?;let before=rows.iter().find(|r|r.get("id").and_then(Value::as_str)==Some(id.as_str())).cloned().ok_or("Calculation not found")?;rows.retain(|r|r.get("id").and_then(Value::as_str)!=Some(id.as_str()));save(&mut c,CALC_KEY,&rows,Some(("engineering_calculation",&id,"delete",&json!({"record":before}))))}
#[tauri::command]
pub fn get_local_engineering_tests(app:AppHandle)->Result<Vec<Value>,String>{let c=conn(&app)?;load(&c,TEST_KEY)}
#[tauri::command]
pub fn create_local_engineering_test(app:AppHandle,mut record:Value)->Result<Value,String>{let mut c=conn(&app)?;let mut rows=load(&c,TEST_KEY)?;if record.get("title").and_then(Value::as_str).map(|s|s.trim().is_empty()).unwrap_or(true){return Err("title is required".into())}let ts=now(&c)?;let rid=id();record["id"]=json!(&rid);for (k,v) in [("test_type",json!("engineering")),("description",json!("")),("status",json!("planned")),("inputs",json!({})),("results",json!({})),("conclusion",json!(""))]{if record.get(k).is_none(){record[k]=v;}}record["created_at"]=json!(&ts);record["updated_at"]=json!(&ts);rows.insert(0,record.clone());save(&mut c,TEST_KEY,&rows,Some(("engineering_test",&rid,"create",&record)))?;Ok(record)}
#[tauri::command]
pub fn update_local_engineering_test(app:AppHandle,id:String,patch:Value)->Result<Value,String>{let mut c=conn(&app)?;let mut rows=load(&c,TEST_KEY)?;let r=rows.iter_mut().find(|r|r.get("id").and_then(Value::as_str)==Some(id.as_str())).ok_or("Engineering test not found")?;if let Some(obj)=patch.as_object(){for (k,v) in obj {if !["id","created_at"].contains(&k.as_str()){r[k]=v.clone();}}}if r.get("title").and_then(Value::as_str).map(|s|s.trim().is_empty()).unwrap_or(true){return Err("title is required".into())}let ts=now(&c)?;r["updated_at"]=json!(&ts);let updated=r.clone();save(&mut c,TEST_KEY,&rows,Some(("engineering_test",&id,"update",&updated)))?;Ok(updated)}
#[tauri::command]
pub fn delete_local_engineering_test(app:AppHandle,id:String)->Result<(),String>{let mut c=conn(&app)?;let mut rows=load(&c,TEST_KEY)?;let before=rows.iter().find(|r|r.get("id").and_then(Value::as_str)==Some(id.as_str())).cloned().ok_or("Engineering test not found")?;rows.retain(|r|r.get("id").and_then(Value::as_str)!=Some(id.as_str()));save(&mut c,TEST_KEY,&rows,Some(("engineering_test",&id,"delete",&json!({"record":before}))))}
#[tauri::command]
pub fn apply_server_engineering_pull(app:AppHandle,calculations:Vec<Value>,tests:Vec<Value>,deleted_calculation_ids:Vec<String>,deleted_test_ids:Vec<String>)->Result<(),String>{
 let mut c=conn(&app)?;let mut calc=load(&c,CALC_KEY)?;let mut test=load(&c,TEST_KEY)?;
 let pending:std::collections::HashSet<String>={let mut s=std::collections::HashSet::new();let mut st=c.prepare("SELECT entity_type,entity_id FROM sync_outbox WHERE synced_at IS NULL AND entity_type IN ('engineering_calculation','engineering_test')").map_err(|e|e.to_string())?;let it=st.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).map_err(|e|e.to_string())?;for x in it.flatten(){s.insert(format!("{}:{}",x.0,x.1));}s};
 let merge=|rows:&mut Vec<Value>,incoming:Vec<Value>,deleted:&Vec<String>,typ:&str|{for item in incoming{let rid=item.get("id").and_then(Value::as_str).unwrap_or_default().to_string();if rid.is_empty()||pending.contains(&format!("{}:{}",typ,rid)){continue;}rows.retain(|r|r.get("id").and_then(Value::as_str)!=Some(rid.as_str()));rows.push(item);}rows.retain(|r|{let rid=r.get("id").and_then(Value::as_str).unwrap_or_default();!deleted.iter().any(|d|d==rid)||pending.contains(&format!("{}:{}",typ,rid))});};
 merge(&mut calc,calculations,&deleted_calculation_ids,"engineering_calculation");merge(&mut test,tests,&deleted_test_ids,"engineering_test");
 let tx=c.transaction().map_err(|e|e.to_string())?;tx.execute("INSERT INTO sync_state(key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![CALC_KEY,serde_json::to_string(&calc).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;tx.execute("INSERT INTO sync_state(key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![TEST_KEY,serde_json::to_string(&test).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;tx.commit().map_err(|e|e.to_string())
}