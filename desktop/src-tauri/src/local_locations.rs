use rusqlite::{params,Connection,OptionalExtension};
use serde_json::{json,Value};
use tauri::AppHandle;
use crate::local_db;
const KEY:&str="locations_state"; const VERSION:&str="007_local_locations";
fn open(a:&AppHandle)->Result<Connection,String>{local_db::open_local_connection(a)}
fn ensure(c:&Connection)->Result<(),String>{c.execute("INSERT OR IGNORE INTO local_schema_migrations(version) VALUES(?1)",[VERSION]).map_err(|e|e.to_string())?;c.execute("INSERT OR IGNORE INTO sync_state(key,value) VALUES(?1,?2)",params![KEY,"[]"]).map_err(|e|e.to_string())?;Ok(())}
fn inventory_counts(c:&Connection)->Result<std::collections::HashMap<String,i64>,String>{
 let counts=inventory_counts(&c)?; Ok(counts)
}
fn load(c:&Connection)->Result<Vec<Value>,String>{ensure(c)?;let x:Option<String>=c.query_row("SELECT value FROM sync_state WHERE key=?1",[KEY],|r|r.get(0)).optional().map_err(|e|e.to_string())?;Ok(x.map(|s|serde_json::from_str(&s).unwrap_or_default()).unwrap_or_default())}
fn id()->String{use std::time::{SystemTime,UNIX_EPOCH};format!("{:032x}",SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos())}
fn save(c:&mut Connection,v:&[Value],change:Option<(String,String,Value)>)->Result<(),String>{let tx=c.transaction().map_err(|e|e.to_string())?;tx.execute("INSERT INTO sync_state(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![KEY,serde_json::to_string(v).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;if let Some((entity_id,op,payload))=change{let d:String=tx.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).map_err(|e|e.to_string())?;tx.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,'location',?3,?4,?5)",params![id(),d,entity_id,op,payload.to_string()]).map_err(|e|e.to_string())?;}tx.commit().map_err(|e|e.to_string())}
#[tauri::command]
pub fn list_local_locations(app:AppHandle)->Result<Vec<Value>,String>{
 let c=open(&app)?; let mut v=load(&c)?;
 let mut counts=std::collections::HashMap::<String,i64>::new();
 if let Some(raw)=c.query_row("SELECT value FROM sync_state WHERE key='inventory_snapshot'",[],|r|r.get::<_,String>(0)).optional().map_err(|e|e.to_string())?{
  if let Ok(items)=serde_json::from_str::<Vec<Value>>(&raw){for item in items{if let Some(id)=item.get("location_id").and_then(Value::as_str){*counts.entry(id.to_string()).or_insert(0)+=1;}}}
 }
 for item in &mut v{if let Some(id)=item.get("id").and_then(Value::as_str){item["item_count"]=json!(*counts.get(id).unwrap_or(&0));}}
 v.sort_by(|a,b|a.get("name").and_then(Value::as_str).unwrap_or("").cmp(b.get("name").and_then(Value::as_str).unwrap_or("")));
 Ok(v)
}
#[tauri::command]
pub fn get_local_location(app:AppHandle,id:String)->Result<Option<Value>,String>{let c=open(&app)?;let counts=inventory_counts(&c)?;Ok(load(&c)?.into_iter().find_map(|mut x|{if x.get("id").and_then(Value::as_str)==Some(id.as_str()){x["item_count"]=json!(*counts.get(&id).unwrap_or(&0));Some(x)}else{None}}))}
#[tauri::command]
pub fn create_local_location(app:AppHandle,mut data:Value)->Result<Value,String>{let mut c=open(&app)?;let mut v=load(&c)?;let name=data.get("name").and_then(Value::as_str).unwrap_or("").trim().to_string();if name.is_empty(){return Err("name is required".into())}let id=id();let ts=c.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')",[],|r|r.get::<_,String>(0)).map_err(|e|e.to_string())?;data["id"]=json!(&id);data["name"]=json!(name);data["parent_id"]=data.get("parent_id").cloned().unwrap_or(Value::Null);data["item_count"]=json!(0);data["created_at"]=json!(&ts);v.push(data.clone());save(&mut c,&v,Some((id,"create".into(),data.clone())))?;Ok(data)}
#[tauri::command]
pub fn update_local_location(app:AppHandle,id:String,patch:Value)->Result<Value,String>{let mut c=open(&app)?;let mut v=load(&c)?;let x=v.iter_mut().find(|x|x.get("id").and_then(Value::as_str)==Some(id.as_str())).ok_or("Location not found")?;if let Some(o)=patch.as_object(){for(k,val)in o{if k!="id"&&k!="created_at"&&k!="item_count"{x[k]=val.clone();}}}if let Some(n)=x.get("name").and_then(Value::as_str){if n.trim().is_empty(){return Err("name cannot be empty".into())}}let out=x.clone();save(&mut c,&v,Some((id,"update".into(),out.clone())))?;Ok(out)}
#[tauri::command]
pub fn delete_local_location(app:AppHandle,id:String)->Result<(),String>{let mut c=open(&app)?;let mut v=load(&c)?;let old=v.iter().find(|x|x.get("id").and_then(Value::as_str)==Some(id.as_str())).cloned().ok_or("Location not found")?;if old.get("item_count").and_then(Value::as_i64).unwrap_or(0)>0{return Err("Cannot delete a location containing inventory items".into())}v.retain(|x|x.get("id").and_then(Value::as_str)!=Some(id.as_str()));save(&mut c,&v,Some((id,"delete".into(),json!({"location":old}))))}

#[tauri::command]
pub fn apply_server_location_pull(app:AppHandle,locations_json:String,deleted_location_ids:Vec<String>)->Result<(),String>{
 let incoming:Vec<Value>=serde_json::from_str(&locations_json).map_err(|e|format!("Invalid server locations payload: {e}"))?;
 let mut conn=open(&app)?; let mut v=load(&conn)?;
 let mut pending=std::collections::HashSet::new();
 let mut stmt=conn.prepare("SELECT entity_id FROM sync_outbox WHERE synced_at IS NULL AND entity_type='location' AND entity_id IS NOT NULL").map_err(|e|e.to_string())?;
 let rows=stmt.query_map([],|r|r.get::<_,String>(0)).map_err(|e|e.to_string())?;
 for row in rows{pending.insert(row.map_err(|e|e.to_string())?);}
 let deleted:std::collections::HashSet<String>=deleted_location_ids.into_iter().collect();
 v.retain(|x|x.get("id").and_then(Value::as_str).map(|id|!deleted.contains(id)||pending.contains(id)).unwrap_or(true));
 for item in incoming{let Some(id)=item.get("id").and_then(Value::as_str) else{continue};if pending.contains(id){continue;}if let Some(existing)=v.iter_mut().find(|x|x.get("id").and_then(Value::as_str)==Some(id)){*existing=item;}else{v.push(item);}}
 save(&mut conn,&v,None)?; Ok(())
}
