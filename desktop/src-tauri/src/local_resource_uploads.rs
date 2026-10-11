use std::{fs::{self, OpenOptions}, io::{Read, Write, Seek, SeekFrom}, path::PathBuf};
use rusqlite::{params, Connection, TransactionBehavior};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use crate::{local_auth, local_db, local_resources};

const CHUNK: usize = 1024 * 1024;
const MAX_FILE: u64 = 500 * 1024 * 1024;
fn err(e:impl std::fmt::Display)->String { e.to_string() }
fn schema(c:&Connection)->Result<(),String>{
    c.execute_batch("CREATE TABLE IF NOT EXISTS local_resource_uploads(account_id TEXT NOT NULL,change_id TEXT NOT NULL,resource_id TEXT NOT NULL,resource_json TEXT NOT NULL,size_bytes INTEGER NOT NULL,sha256 TEXT,server_revision TEXT,state TEXT NOT NULL DEFAULT 'staging',PRIMARY KEY(account_id,change_id),UNIQUE(account_id,resource_id));").map_err(err)
}
fn guard(c:&Connection,account:&str,session:&str)->Result<(),String>{
    local_db::require_sync_account(c,account)?;
    local_auth::require_local_permission(c,"resources.create")?;
    let current:String=c.query_row("SELECT session_token FROM local_session WHERE id=1",[],|r|r.get(0)).map_err(err)?;
    if current!=session{return Err("Session changed while saving file".into())} Ok(())
}
fn file_path(app:&AppHandle,account:&str,change:&str)->Result<PathBuf,String>{
    let account=uuid::Uuid::parse_str(account).map_err(err)?.to_string();
    let change=uuid::Uuid::parse_str(change).map_err(err)?.to_string();
    let root=tauri::api::path::app_data_dir(&app.config()).ok_or("Missing LabOS data directory")?;
    Ok(root.join("resource-files").join(account).join(change).join("content"))
}
fn hash_file(path:&std::path::Path)->Result<String,String>{
    let mut f=fs::File::open(path).map_err(err)?;let mut hash=Sha256::new();let mut buffer=vec![0;CHUNK];
    loop{let n=f.read(&mut buffer).map_err(err)?;if n==0{break}hash.update(&buffer[..n]);}
    Ok(format!("{:x}",hash.finalize()))
}
pub(crate) fn parent_guard(c:&Connection,record:&Value)->Result<(),String>{
    if let Some(path)=record["relative_path"].as_str(){
        validate_relative_path(path)?;
        if record["parent_resource_id"].as_str().is_none(){return Err("Folder path requires a parent folder".into())}
    }
    let parents=["item_id","project_id","note_id","parent_resource_id"];
    if parents.iter().filter(|k|record[**k].as_str().is_some()).count()>1{return Err("Choose one resource attachment destination".into())}
    for key in parents{if let Some(id)=record[key].as_str(){uuid::Uuid::parse_str(id).map_err(err)?;}}
    if let Some(id)=record["project_id"].as_str(){crate::local_projects::require_cached_project_access(c,id,true)?;}
    // Scoped note/folder edit grants are not yet available to this native writer.
    // Fail closed for non-admins rather than infer authority from a visible row.
    if record["note_id"].as_str().is_some()||record["parent_resource_id"].as_str().is_some(){
        let role:String=c.query_row("SELECT u.role FROM local_users u JOIN local_session s ON s.user_id=u.id WHERE s.id=1",[],|r|r.get(0)).map_err(err)?;
        if role!="admin"{return Err("Offline file attachments to notes/folders require cached edit authority; use the unattached library for now".into())}
    }
    if let Some(id)=record["parent_resource_id"].as_str(){
        if !local_resources::read_resources(c)?.iter().any(|r|r.id==id&&r.kind=="folder"){return Err("Folder unavailable on this PC".into())}
    }
    Ok(())
}

fn validate_relative_path(path:&str)->Result<(),String>{
    if path.is_empty()||path.len()>1024||path.chars().any(|c|c.is_control()||c==':'||c=='\\')||path.split('/').any(|p|p.is_empty()||p=="."||p==".."){
        return Err("Invalid folder file path".into());
    }Ok(())
}

#[tauri::command]
pub fn begin_local_resource_upload(app:AppHandle,expected_account_id:String,expected_session_token:String,mut metadata:Value)->Result<Value,String>{
    if !metadata.is_object(){return Err("Invalid file metadata".into())}
    let mut c=local_db::open_local_connection(&app)?;schema(&c)?;
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(err)?;
    guard(&tx,&expected_account_id,&expected_session_token)?;parent_guard(&tx,&metadata)?;
    let size=metadata["size_bytes"].as_u64().filter(|n|*n<=MAX_FILE).ok_or("File exceeds the 500 MiB local staging limit")?;
    let name=metadata["original_filename"].as_str().unwrap_or("").replace('\\',"/").rsplit('/').next().unwrap_or("").to_string();
    if name.is_empty()||name.len()>255||name.chars().any(|c|c.is_control()){return Err("Invalid file name".into())}
    let id=uuid::Uuid::new_v4().to_string();let change=uuid::Uuid::new_v4().to_string();
    let now:String=tx.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')",[],|r|r.get(0)).map_err(err)?;
    let mime=metadata["mime_type"].as_str().unwrap_or("application/octet-stream").to_string();
    let ext=name.rsplit('.').next().unwrap_or("").to_lowercase();
    let kind=if mime.starts_with("image/"){ "image" }else if mime.starts_with("video/")||["mp4","webm","mov","mkv","avi","m4v"].contains(&ext.as_str()){ "video" }else if mime.starts_with("audio/"){ "audio" }else if ext=="pdf"{"pdf"}else if ["txt","md"].contains(&ext.as_str()){"text"}else if ["doc","docx","odt","rtf"].contains(&ext.as_str()){"document"}else{"other"};
    metadata["id"]=json!(id);metadata["kind"]=json!("file");metadata["file_type"]=json!(kind);metadata["original_filename"]=json!(name);
    if metadata["name"].as_str().unwrap_or("").trim().is_empty(){metadata["name"]=json!(name)}
    metadata["mime_type"]=json!(mime);metadata["visibility"]=json!("lab");metadata["created_at"]=json!(now);metadata["updated_at"]=json!(now);
    if !metadata["tags"].is_array(){metadata["tags"]=json!([])}
    let record:local_resources::LocalResource=serde_json::from_value(metadata).map_err(err)?;
    let path=file_path(&app,&expected_account_id,&change)?;
    fs::create_dir_all(path.parent().unwrap()).map_err(err)?;
    OpenOptions::new().write(true).create_new(true).open(&path).map_err(err)?.sync_all().map_err(err)?;
    tx.execute("INSERT INTO local_resource_uploads(account_id,change_id,resource_id,resource_json,size_bytes) VALUES(?1,?2,?3,?4,?5)",params![expected_account_id,change,id,serde_json::to_string(&record).map_err(err)?,size as i64]).map_err(err)?;
    tx.commit().map_err(err)?;Ok(json!({"change_id":change,"resource_id":id,"chunk_bytes":CHUNK}))
}

fn readable_file(c:&Connection,resource_id:&str)->Result<(String,String,String,u64),String>{
    local_auth::require_local_permission(c,"resources.view")?;let account=local_db::active_account(c)?;
    let record=local_resources::read_resources(c)?.into_iter().find(|r|r.id==resource_id).ok_or("Resource unavailable")?;
    let (change,mime,size,revision):(String,String,i64,Option<String>)=c.query_row("SELECT change_id,COALESCE(json_extract(resource_json,'$.mime_type'),'application/octet-stream'),size_bytes,server_revision FROM local_resource_uploads WHERE account_id=?1 AND resource_id=?2 AND state='ready'",params![account,resource_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(err)?;
    let pending:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM active_sync_outbox WHERE change_id=?1 AND synced_at IS NULL)",[&change],|r|r.get(0)).map_err(err)?;
    if pending{local_auth::require_local_permission(c,"resources.create")?;parent_guard(c,&serde_json::to_value(&record).map_err(err)?)?;}
    else if revision.as_deref()!=Some(record.updated_at.as_str()){return Err("Local file needs revision verification".into())}
    // A pending metadata edit must not bypass a known server visibility removal.
    if !pending {
        let denied:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM local_resource_poster_denials WHERE account_id=?1 AND resource_id=?2)",params![account,resource_id],|r|r.get(0)).unwrap_or(true);
        if denied{return Err("Resource access is no longer available".into())}
    }
    Ok((account,change,mime,size as u64))
}
fn capability(c:&Connection,id:&str)->Result<String,String>{
    let token:String=c.query_row("SELECT session_token FROM local_session WHERE id=1",[],|r|r.get(0)).map_err(err)?;
    Ok(format!("{:x}",Sha256::digest(format!("labos-file:{token}:{id}").as_bytes())))
}
#[tauri::command]
pub fn local_resource_file_access(app:AppHandle,expected_account_id:String)->Result<Value,String>{
    let c=local_db::open_local_connection(&app)?;schema(&c)?;local_db::require_sync_account(&c,&expected_account_id)?;local_auth::require_local_permission(&c,"resources.view")?;
    let mut files=serde_json::Map::new();
    for record in local_resources::read_resources(&c)?{
        if let Ok((account,change,_,size))=readable_file(&c,&record.id){
            if fs::metadata(file_path(&app,&account,&change)?).map(|m|m.len()==size).unwrap_or(false){
                let pending:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM active_sync_outbox WHERE change_id=?1 AND synced_at IS NULL)",[change],|r|r.get(0)).map_err(err)?;
                // Tauri percent-encodes the whole path on Windows. A dot keeps
                // this two-part capability intact without URL decoding paths.
                files.insert(record.id.clone(),json!({"path":format!("{}.{}",record.id,capability(&c,&record.id)?),"pending":pending}));
            }
        }
    }Ok(Value::Object(files))
}
#[tauri::command]
pub fn bind_local_resource_upload_receipts(app:AppHandle,expected_account_id:String,expected_session_token:String,results:Vec<Value>)->Result<(),String>{
    let mut c=local_db::open_local_connection(&app)?;schema(&c)?;
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(err)?;guard(&tx,&expected_account_id,&expected_session_token)?;
    for result in results{
        let change=result["change_id"].as_str().ok_or("Missing upload receipt")?;
        let resource=result["result"]["id"].as_str().ok_or("Missing resource receipt ID")?;
        let revision=result["result"]["updated_at"].as_str().ok_or("Missing resource revision")?;
        let changed=tx.execute("UPDATE local_resource_uploads SET server_revision=?1 WHERE account_id=?2 AND change_id=?3 AND resource_id=?4 AND state='ready' AND EXISTS(SELECT 1 FROM active_sync_outbox o WHERE o.change_id=?3 AND o.synced_at IS NULL)",params![revision,expected_account_id,change,resource]).map_err(err)?;
        if changed!=1{return Err("Upload acknowledgement does not match the authored file".into())}
    }tx.commit().map_err(err)
}

// No unguarded file:// or broad asset access. Every media range rechecks the
// active lease, account, record and session-bound capability. Buffers are bounded.
pub fn serve_file(app:&AppHandle,request:&tauri::http::Request)->Result<tauri::http::Response,Box<dyn std::error::Error>>{
    let response=(||->Result<tauri::http::Response,String>{
        if request.method().as_str()!="GET"&&request.method().as_str()!="HEAD"{return Err("Unsupported method".into())}
        let url=reqwest::Url::parse(request.uri()).map_err(err)?;let parts:Vec<_>=url.path().trim_matches('/').split('.').collect();
        if parts.len()!=2{return Err("Invalid local resource URL".into())}uuid::Uuid::parse_str(parts[0]).map_err(err)?;
        let c=local_db::open_local_connection(app)?;schema(&c)?;
        if capability(&c,parts[0])?!=parts[1]{return Err("Local resource session changed".into())}
        let (account,change,mime,size)=readable_file(&c,parts[0])?;
        let range=request.headers().get("range").and_then(|v|v.to_str().ok());
        let (start,end)=if let Some(range)=range{
            let pair=range.strip_prefix("bytes=").ok_or("Invalid range")?.split_once('-').ok_or("Invalid range")?;
            let start=pair.0.parse::<u64>().map_err(err)?;
            let requested=if pair.1.is_empty(){size.saturating_sub(1)}else{pair.1.parse::<u64>().map_err(err)?};
            if start>=size||requested<start{return Err("Invalid range".into())}(start,requested.min(size-1).min(start+4*1024*1024-1))
        }else{if size>32*1024*1024{return Err("Large files require ranged access".into())}(0,size.saturating_sub(1))};
        let length=if size==0{0}else{end-start+1};
        let mut file=fs::File::open(file_path(app,&account,&change)?).map_err(err)?;
        if file.metadata().map_err(err)?.len()!=size{return Err("Local file changed".into())}
        let mut bytes=if request.method().as_str()=="HEAD"{Vec::new()}else{vec![0;length as usize]};file.seek(SeekFrom::Start(start)).map_err(err)?;file.read_exact(&mut bytes).map_err(err)?;
        readable_file(&c,parts[0])?;if capability(&c,parts[0])?!=parts[1]{return Err("Session changed".into())}
        let mime=if mime.starts_with("image/")||mime.starts_with("audio/")||mime.starts_with("video/")||mime=="application/pdf"{mime}else{"text/plain".into()};
        let origin=request.headers().get("origin").and_then(|v|v.to_str().ok()).filter(|o|["http://localhost:1420","http://127.0.0.1:1420","tauri://localhost","http://tauri.localhost","https://tauri.localhost"].contains(o)).unwrap_or("http://tauri.localhost");
        let mut builder=tauri::http::ResponseBuilder::new().status(if range.is_some(){206}else{200}).header("Content-Type",mime).header("Cache-Control","no-store").header("Accept-Ranges","bytes").header("Content-Length",length.to_string()).header("Access-Control-Allow-Origin",origin).header("Access-Control-Expose-Headers","Content-Range, Content-Length, Accept-Ranges").header("Content-Security-Policy","default-src 'none'; sandbox").header("X-Content-Type-Options","nosniff");
        if range.is_some(){builder=builder.header("Content-Range",format!("bytes {start}-{end}/{size}"));}
        builder.body(bytes).map_err(err)
    })();
    match response{Ok(r)=>Ok(r),Err(_)=>tauri::http::ResponseBuilder::new().status(403).header("Cache-Control","no-store").body(Vec::new())}
}

#[tauri::command]
pub fn write_local_resource_upload_chunk(app:AppHandle,expected_account_id:String,expected_session_token:String,change_id:String,offset:u64,bytes:Vec<u8>)->Result<(),String>{
    if bytes.is_empty()||bytes.len()>CHUNK{return Err("Invalid file chunk".into())}
    let mut c=local_db::open_local_connection(&app)?;schema(&c)?;
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(err)?;guard(&tx,&expected_account_id,&expected_session_token)?;
    let (size,state):(i64,String)=tx.query_row("SELECT size_bytes,state FROM local_resource_uploads WHERE account_id=?1 AND change_id=?2",params![expected_account_id,change_id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(err)?;
    if state!="staging"||offset.checked_add(bytes.len() as u64).filter(|n|*n<=size as u64).is_none(){return Err("Upload is finalized or chunk exceeds file size".into())}
    let mut f=OpenOptions::new().read(true).write(true).open(file_path(&app,&expected_account_id,&change_id)?).map_err(err)?;
    let len=f.metadata().map_err(err)?.len();
    if offset>len{return Err("Missing prior file chunk".into())}
    f.seek(SeekFrom::Start(offset)).map_err(err)?;
    if offset<len{let n=(len-offset).min(bytes.len() as u64) as usize;let mut existing=vec![0;n];f.read_exact(&mut existing).map_err(err)?;if existing!=bytes[..n]{return Err("Retried chunk differs from saved bytes".into())}f.seek(SeekFrom::Start(offset)).map_err(err)?;}
    f.write_all(&bytes).map_err(err)?;f.sync_all().map_err(err)?;tx.commit().map_err(err)
}

#[tauri::command]
pub fn finish_local_resource_upload(app:AppHandle,expected_account_id:String,expected_session_token:String,change_id:String)->Result<local_resources::LocalResource,String>{
    finish_uploads(&app,&expected_account_id,&expected_session_token,vec![change_id],false)?.pop().ok_or("Missing finalized resource".into())
}

#[tauri::command]
pub fn finish_local_resource_upload_batch(app:AppHandle,expected_account_id:String,expected_session_token:String,change_ids:Vec<String>)->Result<Vec<local_resources::LocalResource>,String>{
    finish_uploads(&app,&expected_account_id,&expected_session_token,change_ids,true)
}

// All selected files become visible together. A failed copy/hash/permission
// check rolls back every metadata/outbox write, preserving staged source bytes.
fn finish_uploads(app:&AppHandle,expected_account_id:&str,expected_session_token:&str,change_ids:Vec<String>,folder_batch:bool)->Result<Vec<local_resources::LocalResource>,String>{
    if change_ids.is_empty()||change_ids.len()>200{return Err("Invalid upload batch size".into())}
    let mut seen_changes=std::collections::HashSet::new();
    if change_ids.iter().any(|id|!seen_changes.insert(id)){return Err("Repeated upload identity".into())}
    let mut c=local_db::open_local_connection(&app)?;schema(&c)?;
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(err)?;guard(&tx,&expected_account_id,&expected_session_token)?;
    let mut resources=local_resources::read_resources(&tx)?;
    let device:String=tx.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).map_err(err)?;
    let mut results=Vec::new();let mut folder:Option<String>=None;let mut paths=std::collections::HashSet::new();
    for change_id in change_ids{
    let (raw,size,state):(String,i64,String)=tx.query_row("SELECT resource_json,size_bytes,state FROM local_resource_uploads WHERE account_id=?1 AND change_id=?2",params![expected_account_id,change_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(err)?;
    let record:local_resources::LocalResource=serde_json::from_str(&raw).map_err(err)?;
    parent_guard(&tx,&serde_json::from_str(&raw).map_err(err)?)?;
    if folder_batch{
        let parent=record.parent_resource_id.as_ref().ok_or("Folder upload requires a parent folder")?;
        if let Some(expected)=&folder{if expected!=parent{return Err("Upload batch spans different folders".into())}}else{folder=Some(parent.clone())}
        let relative=record.relative_path.as_ref().ok_or("Missing folder file path")?;
        if !paths.insert(relative.to_lowercase()){return Err("Duplicate folder file path".into())}
    }
    if state=="ready"{results.push(record);continue}
    let path=file_path(&app,&expected_account_id,&change_id)?;
    if fs::metadata(&path).map_err(err)?.len()!=size as u64{return Err("File copy is incomplete; nothing has been queued".into())}
    let digest=hash_file(&path)?;guard(&tx,&expected_account_id,&expected_session_token)?;
    if let (Some(parent),Some(relative))=(&record.parent_resource_id,&record.relative_path){
        if resources.iter().any(|r|r.parent_resource_id.as_ref()==Some(parent)&&r.relative_path.as_ref().map(|p|p.to_lowercase())==Some(relative.to_lowercase())){return Err("A file already exists at this folder path; use an explicit replacement".into())}
    }
    resources.push(record.clone());
    let payload=json!({"resource":record,"upload":{"protocol":1,"sha256":digest,"size_bytes":size}});
    tx.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,'resource',?3,'create',?4)",params![change_id,device,record.id,payload.to_string()]).map_err(err)?;
    tx.execute("UPDATE local_resource_uploads SET state='ready',sha256=?1 WHERE account_id=?2 AND change_id=?3",params![digest,expected_account_id,change_id]).map_err(err)?;
    results.push(record);
    }
    local_resources::write_resources(&tx,&resources)?;
    guard(&tx,expected_account_id,expected_session_token)?;
    tx.commit().map_err(err)?;Ok(results)
}

#[tauri::command]
pub fn read_local_resource_upload_chunk(app:AppHandle,expected_account_id:String,expected_session_token:String,change_id:String,offset:u64)->Result<Vec<u8>,String>{
    let c=local_db::open_local_connection(&app)?;schema(&c)?;guard(&c,&expected_account_id,&expected_session_token)?;
    let size:i64=c.query_row("SELECT u.size_bytes FROM local_resource_uploads u JOIN active_sync_outbox o ON o.change_id=u.change_id AND o.account_id=u.account_id WHERE u.account_id=?1 AND u.change_id=?2 AND u.state='ready' AND o.synced_at IS NULL",params![expected_account_id,change_id],|r|r.get(0)).map_err(err)?;
    if offset>size as u64{return Err("Invalid upload offset".into())}
    let mut f=fs::File::open(file_path(&app,&expected_account_id,&change_id)?).map_err(err)?;
    if f.metadata().map_err(err)?.len()!=size as u64{return Err("Saved file size changed".into())}
    f.seek(SeekFrom::Start(offset)).map_err(err)?;let mut bytes=vec![0;CHUNK.min((size as u64-offset) as usize)];f.read_exact(&mut bytes).map_err(err)?;
    guard(&c,&expected_account_id,&expected_session_token)?;Ok(bytes)
}
