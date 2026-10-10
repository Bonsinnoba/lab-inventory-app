use rusqlite::{params,Connection,OptionalExtension,TransactionBehavior};
use serde_json::{json,Value};
use tauri::AppHandle;
use crate::{local_auth,local_db,local_resources};
const KEY:&str="download_snapshot";
const FIELDS:[&str;7]=["enabled","mode","window_start","window_end","concurrent_downloads","default_quality","max_retries"];

fn authorize(c:&Connection,account:&str)->Result<(),String>{local_db::require_sync_account(c,account)?;local_auth::require_local_permission(c,"resources.edit")}
fn guard(c:&Connection,account:&str,token:&str)->Result<(),String>{
    local_db::require_sync_account(c,account)?;
    let actual:String=c.query_row("SELECT session_token FROM local_session WHERE id=1",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    if actual!=token{return Err("Native session changed during download synchronization".into())}Ok(())
}
fn read(c:&Connection)->Result<Value,String>{
    let raw:Option<String>=c.query_row("SELECT value FROM sync_state WHERE key=?1",[local_db::scoped_state_key(c,KEY)?],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
    match raw{Some(raw)=>serde_json::from_str(&raw).map_err(|e|e.to_string()),None=>Ok(json!({"jobs":[],"settings":null,"last_synced_at":null,"snapshot_complete":false}))}
}
fn write(c:&Connection,value:&Value)->Result<(),String>{
    c.execute("INSERT INTO sync_state(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![local_db::scoped_state_key(c,KEY)?,value.to_string()]).map_err(|e|e.to_string())?;Ok(())
}
fn pending(c:&Connection)->Result<Vec<Value>,String>{
    let mut stmt=c.prepare("SELECT o.change_id,o.entity_type,o.entity_id,o.payload_json,o.created_at,o.last_error,c.error_code FROM active_sync_outbox o LEFT JOIN sync_conflicts c ON c.change_id=o.change_id AND c.resolved_at IS NULL WHERE o.synced_at IS NULL AND o.entity_type IN ('resource_download_job','media_download_settings') ORDER BY o.rowid").map_err(|e|e.to_string())?;
    let rows=stmt.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,Option<String>>(5)?,r.get::<_,Option<String>>(6)?))).map_err(|e|e.to_string())?;
    rows.map(|row|{let(id,entity,record,raw,at,error,conflict)=row.map_err(|e|e.to_string())?;let payload:Value=serde_json::from_str(&raw).map_err(|e|e.to_string())?;Ok(json!({"change_id":id,"entity_type":entity,"entity_id":record,"payload":payload,"created_at":at,"error":error,"conflict":conflict}))}).collect()
}
fn validate_settings(patch:&Value)->Result<(),String>{
    let object=patch.as_object().ok_or("Settings must be an object")?;
    for(key,value)in object{
        if !FIELDS.contains(&key.as_str()){return Err(format!("Unknown download setting: {key}"))}
        let valid=match key.as_str(){
            "enabled"=>value.is_boolean(),"mode"=>matches!(value.as_str(),Some("manual"|"scheduled"|"always")),
            "default_quality"=>matches!(value.as_str(),Some("best"|"1080p"|"720p"|"480p")),
            "concurrent_downloads"=>value.as_i64().map(|n|(1..=3).contains(&n)).unwrap_or(false),
            "max_retries"=>value.as_i64().map(|n|(0..=4).contains(&n)).unwrap_or(false),
            _=>value.as_str().map(|s|{let parts:Vec<_>=s.split(':').collect();parts.len()==2&&parts.iter().all(|p|p.len()==2&&p.bytes().all(|b|b.is_ascii_digit()))&&parts[0].parse::<u32>().unwrap_or(99)<24&&parts[1].parse::<u32>().unwrap_or(99)<60}).unwrap_or(false),
        };if !valid{return Err(format!("Invalid {key}"))}
    }Ok(())
}
fn view(c:&Connection,account:&str)->Result<Value,String>{
    authorize(c,account)?;let mut snapshot=read(c)?;
    let resources=local_resources::read_resources(c)?;
    let allowed:std::collections::HashSet<_>=resources.iter().map(|r|r.id.as_str()).collect();
    let jobs=snapshot["jobs"].as_array_mut().ok_or("Invalid local download snapshot")?;
    jobs.retain(|j|j["resource_id"].as_str().map(|id|allowed.contains(id)).unwrap_or(false));
    let mut edits=pending(c)?;
    for edit in edits.iter_mut().filter(|e|e["entity_type"]=="resource_download_job"){
        let resource_id=edit["payload"]["resource_id"].as_str().ok_or("Queued resource ID missing")?;
        let Some(resource)=resources.iter().find(|r|r.id==resource_id)else{continue};
        // A lost acknowledgement may already have produced the canonical job.
        // Keep one visible row, but keep the original pending intent immutable.
        let matched=jobs.iter().position(|j|j["id"]==edit["entity_id"]||j["resource_id"]==resource_id&&matches!(j["status"].as_str(),Some("queued"|"scheduled"|"downloading"|"paused")));
        let state=if edit["conflict"].is_null(){"pending_sync"}else{"conflict"};
        if let Some(index)=matched{jobs[index]["sync_state"]=json!(state);continue;}
        jobs.push(json!({"id":edit["entity_id"],"resource_id":resource.id,"resource_name":resource.name,"resource_url":resource.url,
            "status":if edit["payload"]["scheduled_for"].is_string(){"scheduled"}else{"queued"},"quality":edit["payload"]["quality"],
            "scheduled_for":edit["payload"]["scheduled_for"],"priority":0,"progress":0,"attempts":0,
            "created_at":edit["created_at"],"sync_state":state,"error_message":edit["error"]}));
    }
    for edit in edits.iter().filter(|e|e["entity_type"]=="media_download_settings"){
        if snapshot["settings"].is_null(){continue;}
        for field in FIELDS{if let Some(value)=edit["payload"]["patch"].get(field){snapshot["settings"][field]=value.clone();}}
        snapshot["settings"]["sync_version"]=json!(edit["payload"]["expected_version"].as_i64().unwrap_or(0)+1);
        snapshot["settings"]["pending_sync"]=json!(true);
        snapshot["settings"]["sync_conflict"]=json!(!edit["conflict"].is_null());
    }
    Ok(snapshot)
}
fn enqueue(c:&Connection,account:&str,entity:&str,id:&str,payload:&Value)->Result<(),String>{
    local_db::require_sync_account(c,account)?;
    let device:String=c.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    c.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,?3,?4,?5,?6)",params![local_db::new_uuid(),device,entity,id,if entity=="resource_download_job"{"create"}else{"update"},payload.to_string()]).map_err(|e|e.to_string())?;Ok(())
}
pub(crate) fn queue(c:&mut Connection,account:&str,resource_id:&str,quality:Option<String>,scheduled_for:Option<String>)->Result<Value,String>{
    let resource_id=uuid::Uuid::parse_str(resource_id).map_err(|_|"Invalid resource UUID")?.to_string();
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;authorize(&tx,account)?;
    let resource=local_resources::read_resources(&tx)?.into_iter().find(|r|r.id==resource_id).ok_or("Resource unavailable locally")?;
    if resource.kind!="link"||resource.url.is_none(){return Err("Only link resources can be queued".into())}
    if resource.local_media_filename.is_some(){return Err("This resource is already downloaded on the server".into())}
    let role:String=tx.query_row("SELECT u.role FROM local_users u JOIN local_session s ON s.user_id=u.id WHERE s.id=1",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    if role!="admin"&&resource.visibility.as_deref().unwrap_or("lab")!="lab"{return Err("Scoped resource edit authority is not cached for offline enqueue".into())}
    let current=view(&tx,account)?;
    if let Some(job)=current["jobs"].as_array().unwrap().iter().find(|j|j["resource_id"]==resource_id&&matches!(j["status"].as_str(),Some("queued"|"scheduled"|"downloading"|"paused"))){return Ok(job.clone());}
    let quality=quality.unwrap_or_else(||current["settings"]["default_quality"].as_str().unwrap_or("720p").to_string());
    if !["best","1080p","720p","480p"].contains(&quality.as_str()){return Err("Invalid download quality".into())}
    if let Some(at)=&scheduled_for{let valid:bool=tx.query_row("SELECT julianday(?1) IS NOT NULL",[at],|r|r.get(0)).map_err(|e|e.to_string())?;if !valid{return Err("Invalid download schedule".into())}}
    let id=local_db::new_uuid();
    enqueue(&tx,account,"resource_download_job",&id,&json!({"resource_id":resource_id,"quality":quality,"scheduled_for":scheduled_for}))?;
    let result=view(&tx,account)?["jobs"].as_array().unwrap().iter().find(|j|j["id"]==id).cloned().ok_or("Queued job not visible")?;
    tx.commit().map_err(|e|e.to_string())?;Ok(result)
}
#[tauri::command]
pub fn get_local_download_snapshot(app:AppHandle,expected_account_id:String)->Result<Value,String>{view(&local_db::open_local_connection(&app)?,&expected_account_id)}
#[tauri::command]
pub fn queue_local_download(app:AppHandle,expected_account_id:String,resource_id:String,quality:Option<String>,scheduled_for:Option<String>)->Result<Value,String>{queue(&mut local_db::open_local_connection(&app)?,&expected_account_id,&resource_id,quality,scheduled_for)}
#[tauri::command]
pub fn save_local_download_settings(app:AppHandle,expected_account_id:String,patch:Value,expected_version:i64)->Result<Value,String>{
    validate_settings(&patch)?;let mut c=local_db::open_local_connection(&app)?;
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;authorize(&tx,&expected_account_id)?;
    let current=view(&tx,&expected_account_id)?["settings"].clone();
    if current.is_null(){return Err("Download settings must first be synchronized".into())}
    if current["sync_conflict"]==true{return Err("Resolve the pending download settings conflict before editing again".into())}
    if current["sync_version"].as_i64()!=Some(expected_version){return Err("Download settings changed locally. Refresh before saving.".into())}
    let previous=pending(&tx)?.into_iter().filter(|e|e["entity_type"]=="media_download_settings").last();
    enqueue(&tx,&expected_account_id,"media_download_settings","global",&json!({"patch":patch,"expected_version":expected_version,"depends_on":previous.map(|e|e["change_id"].clone())}))?;
    let result=view(&tx,&expected_account_id)?["settings"].clone();tx.commit().map_err(|e|e.to_string())?;Ok(result)
}
#[tauri::command]
pub fn apply_server_download_snapshot(app:AppHandle,expected_account_id:String,expected_session_token:String,snapshot:Option<Value>)->Result<(),String>{
    let mut c=local_db::open_local_connection(&app)?;let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;guard(&tx,&expected_account_id,&expected_session_token)?;
    if let Some(mut snapshot)=snapshot{
        authorize(&tx,&expected_account_id)?;
        if snapshot["snapshot_complete"]!=true||!snapshot["jobs"].is_array()||!snapshot["last_synced_at"].is_string(){return Err("Incomplete download snapshot".into())}
        let settings=&snapshot["settings"];
        let patch:serde_json::Map<String,Value>=FIELDS.iter().map(|key|(key.to_string(),settings[*key].clone())).collect();validate_settings(&Value::Object(patch))?;
        if settings["sync_version"].as_i64().unwrap_or(-1)<0{return Err("Invalid settings version".into())}
        let mut ids=std::collections::HashSet::new();
        for job in snapshot["jobs"].as_array_mut().unwrap(){
            for key in ["id","resource_id"]{job[key]=json!(uuid::Uuid::parse_str(job[key].as_str().ok_or("Download UUID missing")?).map_err(|e|e.to_string())?.to_string());}
            if !ids.insert(job["id"].as_str().unwrap().to_string()){return Err("Duplicate download job in snapshot".into())}
            job["sync_state"]=json!("server");
        }
        write(&tx,&snapshot)?;
    }else{tx.execute("DELETE FROM sync_state WHERE key=?1",[local_db::scoped_state_key(&tx,KEY)?]).map_err(|e|e.to_string())?;}
    tx.commit().map_err(|e|e.to_string())
}
#[tauri::command]
pub fn acknowledge_local_download_changes(app:AppHandle,expected_account_id:String,expected_session_token:String,results:Vec<Value>)->Result<(),String>{
    let mut c=local_db::open_local_connection(&app)?;let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;guard(&tx,&expected_account_id,&expected_session_token)?;authorize(&tx,&expected_account_id)?;
    let mut snapshot=read(&tx)?;
    for result in results{
        let change=result["change_id"].as_str().ok_or("Missing change ID")?;
        let (entity,payload):(String,String)=tx.query_row("SELECT entity_type,payload_json FROM sync_outbox WHERE change_id=?1 AND account_id=?2",params![change,expected_account_id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|e|e.to_string())?;
        let payload:Value=serde_json::from_str(&payload).map_err(|e|e.to_string())?;
        if result["status"]!="synced"{return Err("Cannot acknowledge failed download intent".into())}
        if entity=="resource_download_job"{
            let mut job=result["result"].clone();
            if job["resource_id"]!=payload["resource_id"]||uuid::Uuid::parse_str(job["id"].as_str().unwrap_or("")).is_err(){return Err("Download receipt does not match its resource".into())}
            job["sync_state"]=json!("server");
            let jobs=snapshot["jobs"].as_array_mut().ok_or("Invalid local jobs")?;jobs.retain(|j|j["id"]!=job["id"]);jobs.push(job);
        }else if entity=="media_download_settings"{snapshot["settings"]=result["result"].clone();}
        else{return Err("Not a download intent".into())}
        tx.execute("UPDATE sync_outbox SET synced_at=CURRENT_TIMESTAMP,last_error=NULL WHERE change_id=?1 AND account_id=?2",params![change,expected_account_id]).map_err(|e|e.to_string())?;
    }
    write(&tx,&snapshot)?;tx.commit().map_err(|e|e.to_string())
}
