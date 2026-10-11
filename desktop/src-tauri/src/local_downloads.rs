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
fn older_job(c:&Connection,incoming:&Value,previous:&Value)->Result<bool,String>{
    let next=incoming["control_version"].as_i64().unwrap_or(-1);
    let prior=previous["control_version"].as_i64().unwrap_or(-1);
    if next!=prior{return Ok(next<prior)}
    match (incoming["updated_at"].as_str(),previous["updated_at"].as_str()){
        (Some(a),Some(b))=>c.query_row("SELECT COALESCE(julianday(?1)<julianday(?2),0)",params![a,b],|r|r.get(0)).map_err(|e|e.to_string()),
        _=>Ok(false),
    }
}
fn pending(c:&Connection)->Result<Vec<Value>,String>{
    let mut stmt=c.prepare("SELECT o.change_id,o.entity_type,o.entity_id,o.payload_json,o.created_at,o.last_error,c.error_code,o.operation FROM active_sync_outbox o LEFT JOIN sync_conflicts c ON c.change_id=o.change_id AND c.resolved_at IS NULL WHERE o.synced_at IS NULL AND o.entity_type IN ('resource_download_job','media_download_settings') ORDER BY o.rowid").map_err(|e|e.to_string())?;
    let rows=stmt.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,Option<String>>(5)?,r.get::<_,Option<String>>(6)?,r.get::<_,String>(7)?))).map_err(|e|e.to_string())?;
    rows.map(|row|{let(id,entity,record,raw,at,error,conflict,operation)=row.map_err(|e|e.to_string())?;let payload:Value=serde_json::from_str(&raw).map_err(|e|e.to_string())?;Ok(json!({"change_id":id,"entity_type":entity,"entity_id":record,"payload":payload,"created_at":at,"error":error,"conflict":conflict,"operation":operation}))}).collect()
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
    for job in jobs.iter_mut(){
        if let Some(resource)=resources.iter().find(|r|job["resource_id"]==r.id){
            job["resource_name"]=json!(resource.name);job["resource_url"]=json!(resource.url);
        }
    }
    let mut edits=pending(c)?;
    for edit in edits.iter_mut().filter(|e|e["entity_type"]=="resource_download_job"){
        let resource_id=uuid::Uuid::parse_str(edit["payload"]["resource_id"].as_str().ok_or("Queued resource ID missing")?).map_err(|e|e.to_string())?.to_string();
        let Some(resource)=resources.iter().find(|r|r.id==resource_id)else{continue};
        // A lost acknowledgement may already have produced the canonical job.
        // Keep one visible row, but keep the original pending intent immutable.
        if edit["operation"]!="create"{
            let matched=jobs.iter().position(|j|j["id"]==edit["entity_id"]);
            if edit["operation"]=="delete"&&edit["conflict"].is_null(){jobs.retain(|j|j["id"]!=edit["entity_id"]);continue;}
            let index=match matched{Some(i)=>i,None=>{jobs.push(edit["payload"]["base_job"].clone());jobs.len()-1}};
            jobs[index]["sync_state"]=json!(if edit["conflict"].is_null(){"pending_sync"}else{"conflict"});
            jobs[index]["pending_action"]=edit["payload"]["action"].clone();
            jobs[index]["requested_patch"]=edit["payload"]["patch"].clone();
            jobs[index]["sync_error"]=edit["error"].clone();
            continue;
        }
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
        snapshot["settings"]["sync_conflict"]=json!(snapshot["settings"]["sync_conflict"]==true||!edit["conflict"].is_null());
    }
    snapshot["pending_removal_count"]=json!(edits.iter().filter(|e|e["entity_type"]=="resource_download_job"&&e["operation"]=="delete"&&e["conflict"].is_null()).count());
    Ok(snapshot)
}
fn enqueue(c:&Connection,account:&str,entity:&str,id:&str,payload:&Value)->Result<(),String>{
    enqueue_operation(c,account,entity,id,if entity=="resource_download_job"{"create"}else{"update"},payload)
}
fn enqueue_operation(c:&Connection,account:&str,entity:&str,id:&str,operation:&str,payload:&Value)->Result<(),String>{
    local_db::require_sync_account(c,account)?;
    let device:String=c.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    c.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,?3,?4,?5,?6)",params![local_db::new_uuid(),device,entity,id,operation,payload.to_string()]).map_err(|e|e.to_string())?;Ok(())
}
fn validate_control(action:&str,patch:&Value)->Result<(),String>{
    if !["edit","start","pause","cancel","remove"].contains(&action){return Err("Invalid download action".into())}
    let object=patch.as_object().ok_or("Download edit must be an object")?;
    if action!="edit"&&!object.is_empty(){return Err("Only edit actions accept a patch".into())}
    for (key,value) in object{
        let valid=match key.as_str(){
            "quality"=>matches!(value.as_str(),Some("best"|"1080p"|"720p"|"480p")),
            "priority"=>value.as_i64().map(|n|(-100..=100).contains(&n)).unwrap_or(false),
            "status"=>matches!(value.as_str(),Some("queued"|"scheduled")),
            "scheduled_for"=>value.is_null()||value.is_string(),
            _=>false,
        };if !valid{return Err(format!("Invalid download edit: {key}"))}
    }Ok(())
}
#[tauri::command]
pub fn control_local_download(app:AppHandle,expected_account_id:String,job_id:String,expected_version:i64,action:String,patch:Value)->Result<Value,String>{
    let mut c=local_db::open_local_connection(&app)?;
    control(&mut c,&expected_account_id,&job_id,expected_version,&action,patch)
}
fn control(c:&mut Connection,account:&str,job_id:&str,expected_version:i64,action:&str,patch:Value)->Result<Value,String>{
    validate_control(action,&patch)?;
    let id=uuid::Uuid::parse_str(job_id).map_err(|_|"Invalid download UUID")?.to_string();
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;authorize(&tx,account)?;
    if let Some(at)=patch["scheduled_for"].as_str(){
        let valid:bool=tx.query_row("SELECT julianday(?1) IS NOT NULL",[at],|r|r.get(0)).map_err(|e|e.to_string())?;
        if !valid{return Err("Invalid download schedule".into())}
    }
    if pending(&tx)?.iter().any(|e|e["entity_type"]=="resource_download_job"&&e["entity_id"]==id){return Err("Synchronize or resolve the pending action for this download first".into())}
    let current=view(&tx,account)?;
    let job=current["jobs"].as_array().unwrap().iter().find(|j|j["id"]==id).ok_or("Download is not available locally")?.clone();
    if job["sync_state"]=="pending_sync"||job["sync_state"]=="conflict"{return Err("Synchronize or resolve this download's pending action first".into())}
    if expected_version<0||job["control_version"].as_i64()!=Some(expected_version){return Err("Download changed. Synchronize and refresh before editing.".into())}
    let resource=local_resources::read_resources(&tx)?.into_iter().find(|r|job["resource_id"]==r.id).ok_or("Resource unavailable locally")?;
    let role:String=tx.query_row("SELECT u.role FROM local_users u JOIN local_session s ON s.user_id=u.id WHERE s.id=1",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    if role!="admin"&&resource.visibility.as_deref().unwrap_or("lab")!="lab"{return Err("Scoped resource edit authority is not cached for offline controls".into())}
    if action=="remove"&&job["status"]=="downloading"{return Err("Pause or cancel and synchronize before removing a running download".into())}
    enqueue_operation(&tx,account,"resource_download_job",&id,if action=="remove"{"delete"}else{"update"},&json!({"resource_id":resource.id,"expected_version":expected_version,"action":action,"patch":patch,"base_job":job}))?;
    let result=if action=="remove"{json!({"id":id,"pending_removal":true})}else{view(&tx,account)?["jobs"].as_array().unwrap().iter().find(|j|j["id"]==id).cloned().ok_or("Pending action not visible")?};
    tx.commit().map_err(|e|e.to_string())?;Ok(result)
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
        let current=read(&tx)?;
        if current["settings"]["sync_version"].as_i64().unwrap_or(-1)>settings["sync_version"].as_i64().unwrap_or(-1){return Err("Stale download settings snapshot".into())}
        let incoming_at=snapshot["last_synced_at"].as_str().unwrap();
        let valid:bool=tx.query_row("SELECT julianday(?1) IS NOT NULL",[incoming_at],|r|r.get(0)).map_err(|e|e.to_string())?;
        if !valid{return Err("Invalid download snapshot time".into())}
        if let Some(previous)=current["last_synced_at"].as_str(){
            let stale:bool=tx.query_row("SELECT julianday(?1)<julianday(?2)",params![incoming_at,previous],|r|r.get(0)).map_err(|e|e.to_string())?;
            if stale{return Err("Stale download snapshot".into())}
        }
        let mut ids=std::collections::HashSet::new();
        for job in snapshot["jobs"].as_array_mut().unwrap(){
            for key in ["id","resource_id"]{job[key]=json!(uuid::Uuid::parse_str(job[key].as_str().ok_or("Download UUID missing")?).map_err(|e|e.to_string())?.to_string());}
            if !ids.insert(job["id"].as_str().unwrap().to_string()){return Err("Duplicate download job in snapshot".into())}
            if job["control_version"].as_i64().unwrap_or(-1)<0{return Err("Invalid download control version".into())}
            if let Some(prior)=current["jobs"].as_array().and_then(|jobs|jobs.iter().find(|j|j["id"]==job["id"])){
                if older_job(&tx,job,prior)?{*job=prior.clone();}
            }
            job["sync_state"]=json!("server");
        }
        // Confirmed removals survive a late, pre-removal full snapshot.
        snapshot["removed_job_ids"]=current["removed_job_ids"].clone();
        let removed=snapshot["removed_job_ids"].as_array().cloned().unwrap_or_default();
        snapshot["jobs"].as_array_mut().unwrap().retain(|j|!removed.contains(&j["id"]));
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
        let (entity,payload,operation,entity_id):(String,String,String,String)=tx.query_row("SELECT entity_type,payload_json,operation,entity_id FROM sync_outbox WHERE change_id=?1 AND account_id=?2",params![change,expected_account_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(|e|e.to_string())?;
        let payload:Value=serde_json::from_str(&payload).map_err(|e|e.to_string())?;
        if result["status"]!="synced"{return Err("Cannot acknowledge failed download intent".into())}
        if entity=="resource_download_job"{
            let mut job=result["result"].clone();
            let expected=uuid::Uuid::parse_str(payload["resource_id"].as_str().unwrap_or("")).map_err(|_|"Invalid queued resource UUID")?;
            let received=uuid::Uuid::parse_str(job["resource_id"].as_str().unwrap_or("")).map_err(|_|"Invalid received resource UUID")?;
            if received!=expected||uuid::Uuid::parse_str(job["id"].as_str().unwrap_or("")).is_err(){return Err("Download receipt does not match its resource".into())}
            if operation!="create"&&job["id"]!=entity_id{return Err("Download receipt does not match its job".into())}
            if job["control_version"].as_i64().unwrap_or(-1)<0{return Err("Invalid download receipt version".into())}
            job["sync_state"]=json!("server");
            if operation=="delete"{
                if job["deleted"]!=true{return Err("Removal receipt missing confirmation".into())}
                if !snapshot["removed_job_ids"].is_array(){snapshot["removed_job_ids"]=json!([]);}
                let removed=snapshot["removed_job_ids"].as_array_mut().unwrap();
                if !removed.contains(&job["id"]){removed.push(job["id"].clone());}
                snapshot["jobs"].as_array_mut().ok_or("Invalid local jobs")?.retain(|j|j["id"]!=job["id"]);
            }else{
                let removed=snapshot["removed_job_ids"].as_array().map(|ids|ids.contains(&job["id"])).unwrap_or(false);
                let jobs=snapshot["jobs"].as_array_mut().ok_or("Invalid local jobs")?;
                let newer=match jobs.iter().find(|j|j["id"]==job["id"]){Some(prior)=>older_job(&tx,&job,prior)?,None=>false};
                if !removed&&!newer{jobs.retain(|j|j["id"]!=job["id"]);jobs.push(job);}
            }
        }else if entity=="media_download_settings"{
            let saved=&result["result"];
            let patch:serde_json::Map<String,Value>=FIELDS.iter().map(|key|(key.to_string(),saved[*key].clone())).collect();validate_settings(&Value::Object(patch))?;
            if saved["sync_version"].as_i64().unwrap_or(-1)<0{return Err("Invalid settings receipt version".into())}
            if saved["sync_version"].as_i64().unwrap_or(-1)>=snapshot["settings"]["sync_version"].as_i64().unwrap_or(-1){snapshot["settings"]=saved.clone();}
        }
        else{return Err("Not a download intent".into())}
        tx.execute("UPDATE sync_outbox SET synced_at=CURRENT_TIMESTAMP,last_error=NULL WHERE change_id=?1 AND account_id=?2",params![change,expected_account_id]).map_err(|e|e.to_string())?;
    }
    write(&tx,&snapshot)?;tx.commit().map_err(|e|e.to_string())
}
