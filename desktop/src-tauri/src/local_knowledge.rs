use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use tauri::AppHandle;
use crate::local_db;
use crate::local_auth;

const STATE_KEY: &str = "knowledge_state";
const SCHEMA_VERSION: &str = "006_local_knowledge";

fn conn(app:&AppHandle)->Result<Connection,String>{local_db::open_local_connection(app)}
fn ensure(c:&Connection)->Result<(),String>{
 c.execute("INSERT OR IGNORE INTO local_schema_migrations(version) VALUES (?1)",[SCHEMA_VERSION]).map_err(|e|format!("Unable to record knowledge schema: {e}"))?;
 c.execute("INSERT OR IGNORE INTO sync_state(key,value) VALUES (?1,?2)",params![STATE_KEY,r#"{"findings":[],"results":[],"relationships":[]}"#]).map_err(|e|format!("Unable to initialize local knowledge: {e}"))?; Ok(())
}
fn load(c:&Connection)->Result<Value,String>{ensure(c)?;let raw:Option<String>=c.query_row("SELECT value FROM sync_state WHERE key=?1",[STATE_KEY],|r|r.get(0)).optional().map_err(|e|format!("Unable to read local knowledge: {e}"))?;match raw{Some(v)=>serde_json::from_str(&v).map_err(|e|format!("Invalid local knowledge state: {e}")),None=>Ok(json!({"findings":[],"results":[],"relationships":[]}))}}
fn save(c:&mut Connection,state:&Value,change:Option<(String,String,String,Value)>)->Result<(),String>{
    if change.is_some(){
        local_auth::require_local_permission(c,"projects.edit")?;
    }
 let tx=c.transaction().map_err(|e|format!("Unable to begin knowledge transaction: {e}"))?;tx.execute("INSERT INTO sync_state(key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![STATE_KEY,state.to_string()]).map_err(|e|format!("Unable to save local knowledge: {e}"))?;
 if let Some((typ,id,op,payload))=change{let device:String=tx.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).map_err(|e|format!("Unable to read device identity: {e}"))?;tx.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES (?1,?2,?3,?4,?5,?6)",params![idgen(),device,typ,id,op,payload.to_string()]).map_err(|e|format!("Unable to queue knowledge change: {e}"))?;}
 tx.commit().map_err(|e|format!("Unable to commit knowledge change: {e}"))
}
fn idgen()->String{local_db::new_uuid()}
fn now(c:&Connection)->Result<String,String>{c.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')",[],|r|r.get(0)).map_err(|e|e.to_string())}
fn arr(state:&Value,key:&str)->Vec<Value>{state.get(key).and_then(Value::as_array).cloned().unwrap_or_default()}
fn query(list:Vec<Value>,q:&str)->Vec<Value>{let q=q.to_lowercase();if q.is_empty(){return list}list.into_iter().filter(|v|serde_json::to_string(v).unwrap_or_default().to_lowercase().contains(&q)).collect()}
fn validate_finding(data:&Value)->Result<(),String>{
 let status=data.get("status").and_then(Value::as_str).unwrap_or("open");
 if !["open","confirmed","rejected","superseded"].contains(&status){return Err("Invalid finding status".into())}
 if let Some(c)=data.get("confidence").and_then(Value::as_f64){if !(0.0..=100.0).contains(&c){return Err("confidence must be between 0 and 100".into())}}
 Ok(())
}
fn validate_result(data:&Value)->Result<(),String>{
 let summary=data.get("summary").and_then(Value::as_str).unwrap_or("");
 if data.get("value_numeric").is_none()&&data.get("value_text").is_none()&&summary.is_empty(){return Err("A result requires a numeric value, text value, or summary".into())}
 Ok(())
}
fn validate_relationship(data:&Value)->Result<(),String>{
 let source_type=data.get("source_type").and_then(Value::as_str).ok_or("source_type is required")?;
 let target_type=data.get("target_type").and_then(Value::as_str).ok_or("target_type is required")?;
 let source_id=data.get("source_id").and_then(Value::as_str).ok_or("source_id is required")?;
 let target_id=data.get("target_id").and_then(Value::as_str).ok_or("target_id is required")?;
 let allowed=["finding","result","experiment","task","note","resource","calculation"];
 if !allowed.contains(&source_type)||!allowed.contains(&target_type){return Err("Invalid relationship endpoint type".into())}
 if source_type==target_type&&source_id==target_id{return Err("A knowledge relationship cannot target itself".into())}
 if data.get("relationship").and_then(Value::as_str).unwrap_or("").trim().is_empty(){return Err("relationship is required".into())}
 Ok(())
}

#[tauri::command]
pub fn get_local_knowledge_findings(app:AppHandle,q:Option<String>)->Result<Vec<Value>,String>{let c=conn(&app)?;let s=load(&c)?;Ok(query(arr(&s,"findings"),&q.unwrap_or_default()))}
#[tauri::command]
pub fn create_local_knowledge_finding(app:AppHandle,mut data:Value)->Result<Value,String>{let mut c=conn(&app)?;let mut s=load(&c)?;let id=idgen();let ts=now(&c)?;data["id"]=json!(&id);data["title"]=json!(data.get("title").and_then(Value::as_str).unwrap_or("").trim());if data["title"].as_str().unwrap_or("").is_empty(){return Err("title is required".into())}data["body"]=data.get("body").cloned().unwrap_or(json!(""));data["status"]=data.get("status").cloned().unwrap_or(json!("open"));data["tags"]=data.get("tags").cloned().unwrap_or(json!([]));validate_finding(&data)?;data["created_at"]=json!(&ts);data["updated_at"]=json!(&ts);let mut a=arr(&s,"findings");a.push(data.clone());s["findings"]=Value::Array(a);save(&mut c,&s,Some(("finding".into(),id,"create".into(),data.clone())))?;Ok(data)}
#[tauri::command]
pub fn update_local_knowledge_finding(app:AppHandle,id:String,patch:Value)->Result<Value,String>{update_entity(app,"findings","finding".to_string(),id,patch)}
#[tauri::command]
pub fn delete_local_knowledge_finding(app:AppHandle,id:String)->Result<(),String>{delete_entity(app,"findings","finding".to_string(),id)}
#[tauri::command]
pub fn get_local_knowledge_results(app:AppHandle,q:Option<String>)->Result<Vec<Value>,String>{let c=conn(&app)?;let s=load(&c)?;Ok(query(arr(&s,"results"),&q.unwrap_or_default()))}
#[tauri::command]
pub fn create_local_knowledge_result(app:AppHandle,mut data:Value)->Result<Value,String>{let mut c=conn(&app)?;let mut s=load(&c)?;let id=idgen();let ts=now(&c)?;data["id"]=json!(&id);data["title"]=json!(data.get("title").and_then(Value::as_str).unwrap_or("").trim());if data["title"].as_str().unwrap_or("").is_empty(){return Err("title is required".into())}data["summary"]=data.get("summary").cloned().unwrap_or(json!(""));data["unit"]=data.get("unit").cloned().unwrap_or(json!(""));validate_result(&data)?;data["created_at"]=json!(&ts);data["updated_at"]=json!(&ts);let mut a=arr(&s,"results");a.push(data.clone());s["results"]=Value::Array(a);save(&mut c,&s,Some(("knowledge_result".into(),id,"create".into(),data.clone())))?;Ok(data)}
#[tauri::command]
pub fn update_local_knowledge_result(app:AppHandle,id:String,patch:Value)->Result<Value,String>{update_entity(app,"results","knowledge_result".to_string(),id,patch)}
#[tauri::command]
pub fn delete_local_knowledge_result(app:AppHandle,id:String)->Result<(),String>{delete_entity(app,"results","knowledge_result".to_string(),id)}
fn update_entity(app:AppHandle,key:&str,typ:String,id:String,patch:Value)->Result<Value,String>{let mut c=conn(&app)?;let mut s=load(&c)?;let mut a=arr(&s,key);let v=a.iter_mut().find(|x|x.get("id").and_then(Value::as_str)==Some(id.as_str())).ok_or("Record not found")?;if let Some(o)=patch.as_object(){for(k,val)in o{if k!="id"&&k!="created_at"{v[k]=val.clone();}}}if key=="findings"{validate_finding(v)?}else if key=="results"{validate_result(v)?}v["updated_at"]=json!(now(&c)?);let out=v.clone();s[key]=Value::Array(a);save(&mut c,&s,Some((typ,id,"update".into(),out.clone())))?;Ok(out)}
fn delete_entity(app:AppHandle,key:&str,typ:String,id:String)->Result<(),String>{let mut c=conn(&app)?;let mut s=load(&c)?;let mut a=arr(&s,key);let old=a.iter().find(|x|x.get("id").and_then(Value::as_str)==Some(id.as_str())).cloned().ok_or("Record not found")?;a.retain(|x|x.get("id").and_then(Value::as_str)!=Some(id.as_str()));s[key]=Value::Array(a);save(&mut c,&s,Some((typ,id,"delete".into(),json!({"record":old}))))}
#[tauri::command]
pub fn get_local_knowledge_relationships(app:AppHandle)->Result<Vec<Value>,String>{let c=conn(&app)?;Ok(arr(&load(&c)?,"relationships"))}
#[tauri::command]
pub fn create_local_knowledge_relationship(app:AppHandle,mut data:Value)->Result<Value,String>{validate_relationship(&data)?;let mut c=conn(&app)?;let mut s=load(&c)?;let id=idgen();data["id"]=json!(&id);data["created_at"]=json!(now(&c)?);let mut a=arr(&s,"relationships");a.push(data.clone());s["relationships"]=Value::Array(a);save(&mut c,&s,Some(("knowledge_relationship".into(),id,"create".into(),data.clone())))?;Ok(data)}
#[tauri::command]
pub fn delete_local_knowledge_relationship(app:AppHandle,id:String)->Result<(),String>{delete_entity(app,"relationships","knowledge_relationship".to_string(),id)}
#[tauri::command]
pub fn search_local_knowledge(app:AppHandle,q:String)->Result<Value,String>{let c=conn(&app)?;let s=load(&c)?;let findings=query(arr(&s,"findings"),&q);let results=query(arr(&s,"results"),&q);let notes:Vec<Value>=serde_json::from_str(&c.query_row("SELECT value FROM sync_state WHERE key='notes_state'",[],|r|r.get::<_,String>(0)).optional().map_err(|e|e.to_string())?.unwrap_or_else(||"[]".to_string())).unwrap_or_else(|_|Vec::new());Ok(json!({"findings":findings,"results":results,"notes":query(notes,&q)}))}
#[tauri::command]
pub fn get_local_knowledge_overview(app:AppHandle)->Result<Value,String>{let c=conn(&app)?;let s=load(&c)?;let findings=arr(&s,"findings");let results=arr(&s,"results");let notes_raw: String=c.query_row("SELECT value FROM sync_state WHERE key='notes_state'",[],|r|r.get::<_,String>(0)).optional().map_err(|e|e.to_string())?.unwrap_or_else(||"[]".to_string());let notes_state:Value=serde_json::from_str(&notes_raw).unwrap_or(json!([]));let notes=notes_state.as_array().cloned().unwrap_or_default();let resources_raw: String=c.query_row("SELECT value FROM sync_state WHERE key='resources_state'",[],|r|r.get::<_,String>(0)).optional().map_err(|e|e.to_string())?.unwrap_or_else(||"[]".to_string());let resources_state:Value=serde_json::from_str(&resources_raw).unwrap_or(json!([]));let resources=resources_state.as_array().cloned().unwrap_or_default();Ok(json!({"counts":{"notes":notes.len(),"resources":resources.len()},"categories":[],"recent_notes":notes.iter().rev().take(5).cloned().collect::<Vec<_>>(),"recent_resources":resources.iter().rev().take(5).cloned().collect::<Vec<_>>(),"findings":findings.len(),"results":results.len()}))}
#[tauri::command]
pub fn get_local_knowledge_tags(app:AppHandle)->Result<Vec<Value>,String>{let c=conn(&app)?;let s=load(&c)?;let mut tags=std::collections::BTreeMap::<String,(i64,i64)>::new();for v in arr(&s,"findings"){if let Some(a)=v.get("tags").and_then(Value::as_array){for t in a.iter().filter_map(Value::as_str){tags.entry(t.into()).or_insert((0,0)).0+=1;}}}for v in arr(&s,"results"){if let Some(a)=v.get("tags").and_then(Value::as_array){for t in a.iter().filter_map(Value::as_str){tags.entry(t.into()).or_insert((0,0)).1+=1;}}}Ok(tags.into_iter().map(|(tag,(note_count,result_count))|json!({"tag":tag,"note_count":note_count,"resource_count":result_count})).collect())}


#[tauri::command]
pub fn apply_server_knowledge_pull(app:AppHandle,findings:Vec<Value>,results:Vec<Value>,relationships:Vec<Value>,deletedFindingIds:Vec<String>,deletedResultIds:Vec<String>,deletedRelationshipIds:Vec<String>)->Result<(),String>{
 let mut c=conn(&app)?;let mut s=load(&c)?;
 fn pending(c:&Connection,typ:&str,id:&str)->Result<bool,String>{Ok(c.query_row("SELECT 1 FROM sync_outbox WHERE synced_at IS NULL AND entity_type=?1 AND entity_id=?2 LIMIT 1",params![typ,id],|r|r.get::<_,i64>(0)).optional().map_err(|e|format!("Unable to inspect pending knowledge change: {e}"))?.is_some())}
 fn merge(c:&Connection,s:&mut Value,key:&str,typ:&str,incoming:Vec<Value>)->Result<(),String>{
   let mut current=arr(s,key);
   for value in incoming{
     let Some(id)=value.get("id").and_then(Value::as_str) else {continue};
     if pending(c,typ,id)?{continue;}
     if let Some(existing)=current.iter_mut().find(|v|v.get("id").and_then(Value::as_str)==Some(id)){*existing=value;}else{current.push(value);}
   }
   s[key]=Value::Array(current);Ok(())
 }
 fn remove(c:&Connection,s:&mut Value,key:&str,typ:&str,ids:Vec<String>)->Result<(),String>{
   let mut current=arr(s,key);
   current.retain(|v|{let id=v.get("id").and_then(Value::as_str).unwrap_or("");!ids.iter().any(|x|x==id)&&!pending(c,typ,id).unwrap_or(false)});
   s[key]=Value::Array(current);Ok(())
 }
 merge(&c,&mut s,"findings","finding",findings)?;merge(&c,&mut s,"results","knowledge_result",results)?;merge(&c,&mut s,"relationships","knowledge_relationship",relationships)?;
 remove(&c,&mut s,"findings","finding",deletedFindingIds)?;remove(&c,&mut s,"results","knowledge_result",deletedResultIds)?;remove(&c,&mut s,"relationships","knowledge_relationship",deletedRelationshipIds)?;
 save(&mut c,&s,None)
}
