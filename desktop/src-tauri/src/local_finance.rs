use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use tauri::AppHandle;
use crate::local_db::open_local_connection;
use crate::local_auth;

const KEY_TX:&str="finance_transactions_state";
const KEY_BP:&str="finance_budget_periods_state";
const KEY_FS:&str="finance_funding_sources_state";

fn id(conn:&rusqlite::Connection)->Result<String,String>{conn.query_row("SELECT lower(hex(randomblob(16)))",[],|r|r.get(0)).map_err(|e|e.to_string())}
fn read(conn:&rusqlite::Connection,key:&str)->Result<Vec<Value>,String>{let raw:Option<String>=conn.query_row("SELECT value FROM sync_state WHERE key=?1",[key],|r|r.get(0)).optional().map_err(|e|e.to_string())?;Ok(raw.and_then(|s|serde_json::from_str(&s).ok()).unwrap_or_default())}
fn write(conn:&rusqlite::Connection,key:&str,v:&Vec<Value>)->Result<(),String>{let raw=serde_json::to_string(v).map_err(|e|e.to_string())?;conn.execute("INSERT INTO sync_state(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[key,&raw]).map_err(|e|e.to_string())?;Ok(())}
fn queue(conn:&mut rusqlite::Connection,entity:&str,entity_id:&str,op:&str,payload:&Value)->Result<(),String>{let tx=conn.transaction().map_err(|e|e.to_string())?;let device:String=tx.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).map_err(|e|e.to_string())?;let cid=id(&tx)?;tx.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,?3,?4,?5,?6)",params![cid,device,entity,entity_id,op,payload.to_string()]).map_err(|e|e.to_string())?;tx.commit().map_err(|e|e.to_string())}
fn mutate(app:&AppHandle,key:&str,entity:&str,op:&str,mut value:Value)->Result<Value,String>{let mut conn=open_local_connection(app)?;let permission=if op=="delete"{"finance.delete"}else if op=="create"&&entity=="transaction"{"finance.create_expense"}else{"finance.edit"};local_auth::require_local_permission(&conn,permission)?;let mut rows=read(&conn,key)?;let entity_id=value.get("id").and_then(Value::as_str).ok_or("id is required")?.to_string();if op=="delete"{rows.retain(|v|v.get("id").and_then(Value::as_str)!=Some(&entity_id));}else if let Some(old)=rows.iter_mut().find(|v|v.get("id").and_then(Value::as_str)==Some(&entity_id)){*old=value.clone();}else{rows.push(value.clone());}write(&conn,key,&rows)?;queue(&mut conn,entity,&entity_id,op,&value)?;Ok(value)}
fn all(app:&AppHandle,key:&str)->Result<Vec<Value>,String>{let c=open_local_connection(app)?;read(&c,key)}
fn merge(app:&AppHandle,key:&str,entity:&str,incoming:Vec<Value>,deleted:Vec<String>)->Result<(),String>{let mut c=open_local_connection(app)?;let mut rows=read(&c,key)?;let pending:std::collections::HashSet<String>={let mut s=c.prepare("SELECT entity_id FROM sync_outbox WHERE synced_at IS NULL AND entity_type=?1 AND entity_id IS NOT NULL").map_err(|e|e.to_string())?;let x=s.query_map([entity],|r|r.get(0)).map_err(|e|e.to_string())?.filter_map(Result::ok).collect();x};rows.retain(|v|!deleted.contains(&v.get("id").and_then(Value::as_str).unwrap_or("").to_string())||pending.contains(v.get("id").and_then(Value::as_str).unwrap_or("")));for x in incoming{let xid=x.get("id").and_then(Value::as_str).unwrap_or("");if pending.contains(xid){continue}if let Some(old)=rows.iter_mut().find(|v|v.get("id").and_then(Value::as_str)==Some(xid)){*old=x}else{rows.push(x)}}write(&c,key,&rows)}
#[tauri::command] pub fn get_local_transactions(app:AppHandle)->Result<Vec<Value>,String>{all(&app,KEY_TX)}
#[tauri::command] pub fn create_local_transaction(app:AppHandle,transaction:Value)->Result<Value,String>{mutate(&app,KEY_TX,"transaction","create",transaction)}
#[tauri::command] pub fn update_local_transaction(app:AppHandle,id:String,transaction:Value)->Result<Value,String>{let mut v=transaction;v.as_object_mut().ok_or("transaction must be object")?.insert("id".into(),json!(id));mutate(&app,KEY_TX,"transaction","update",v)}
#[tauri::command] pub fn delete_local_transaction(app:AppHandle,id:String)->Result<Value,String>{mutate(&app,KEY_TX,"transaction","delete",json!({"id":id}))}
#[tauri::command] pub fn get_local_budget_periods(app:AppHandle)->Result<Vec<Value>,String>{all(&app,KEY_BP)}
#[tauri::command] pub fn create_local_budget_period(app:AppHandle,period:Value)->Result<Value,String>{mutate(&app,KEY_BP,"budget_period","create",period)}
#[tauri::command] pub fn update_local_budget_period(app:AppHandle,id:String,period:Value)->Result<Value,String>{let mut v=period;v.as_object_mut().ok_or("period must be object")?.insert("id".into(),json!(id));mutate(&app,KEY_BP,"budget_period","update",v)}
#[tauri::command] pub fn delete_local_budget_period(app:AppHandle,id:String)->Result<Value,String>{mutate(&app,KEY_BP,"budget_period","delete",json!({"id":id}))}
#[tauri::command] pub fn get_local_funding_sources(app:AppHandle)->Result<Vec<Value>,String>{all(&app,KEY_FS)}
#[tauri::command] pub fn create_local_funding_source(app:AppHandle,source:Value)->Result<Value,String>{mutate(&app,KEY_FS,"funding_source","create",source)}
#[tauri::command] pub fn update_local_funding_source(app:AppHandle,id:String,source:Value)->Result<Value,String>{let mut v=source;v.as_object_mut().ok_or("source must be object")?.insert("id".into(),json!(id));mutate(&app,KEY_FS,"funding_source","update",v)}
#[tauri::command] pub fn delete_local_funding_source(app:AppHandle,id:String)->Result<Value,String>{mutate(&app,KEY_FS,"funding_source","delete",json!({"id":id}))}
#[tauri::command] pub fn apply_server_finance_pull(app:AppHandle,transactions:Vec<Value>,budget_periods:Vec<Value>,funding_sources:Vec<Value>,deleted_transactions:Vec<String>,deleted_budget_periods:Vec<String>,deleted_funding_sources:Vec<String>)->Result<(),String>{merge(&app,KEY_TX,"transaction",transactions,deleted_transactions)?;merge(&app,KEY_BP,"budget_period",budget_periods,deleted_budget_periods)?;merge(&app,KEY_FS,"funding_source",funding_sources,deleted_funding_sources)}
