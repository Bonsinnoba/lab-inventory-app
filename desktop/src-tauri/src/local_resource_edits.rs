use crate::{local_db, local_resources, local_resource_uploads};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};
use std::{fs::{self, OpenOptions}, io::{Read, Seek, SeekFrom, Write}, path::PathBuf};
use tauri::AppHandle;

const MAX_TEXT: usize = 4 * 1024 * 1024;
const MAX_PDF: u64 = 500 * 1024 * 1024;
fn err(e: impl std::fmt::Display) -> String { e.to_string() }
pub(crate) fn schema(c: &Connection) -> Result<(), String> {
    local_resource_uploads::schema(c)?;
    crate::local_resource_posters::schema(c)?;
    c.execute_batch("CREATE TABLE IF NOT EXISTS local_resource_edits(account_id TEXT NOT NULL,change_id TEXT NOT NULL,resource_id TEXT NOT NULL,size_bytes INTEGER NOT NULL,server_revision TEXT,PRIMARY KEY(account_id,change_id));
CREATE TABLE IF NOT EXISTS local_resource_edit_staging(account_id TEXT NOT NULL,change_id TEXT NOT NULL,resource_id TEXT NOT NULL,expected_revision TEXT NOT NULL,size_bytes INTEGER NOT NULL,published INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(account_id,change_id));").map_err(err)?;
    let has_revision:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('local_resource_edits') WHERE name='local_revision')",[],|r|r.get(0)).map_err(err)?;
    if !has_revision{c.execute("ALTER TABLE local_resource_edits ADD COLUMN local_revision TEXT",[]).map_err(err)?;}
    Ok(())
}
fn guard(c:&Connection,account:&str,session:Option<&str>,id:&str)->Result<local_resources::LocalResource,String>{
    local_db::require_sync_account(c,account)?;
    if let Some(session)=session {
        let token:String=c.query_row("SELECT session_token FROM local_session WHERE id=1",[],|r|r.get(0)).map_err(err)?;
        if token!=session{return Err("Editor session changed".into())}
    }
    let record=local_resources::read_resources(c)?.into_iter().find(|r|r.id==id).ok_or("Resource unavailable on this PC")?;
    crate::resource_dependencies::require_editor_access(c,&record)?;
    Ok(record)
}
fn markdown(record:&local_resources::LocalResource)->bool{
    let name=record.original_filename.as_deref().unwrap_or(&record.name).to_lowercase();
    record.kind=="file"&&record.file_type=="text"&&(name.ends_with(".md")||name.ends_with(".markdown"))
}

fn pdf(record:&local_resources::LocalResource)->bool{
    record.kind=="file"&&record.file_type=="pdf"&&record.original_filename.as_deref().unwrap_or(&record.name).to_lowercase().ends_with(".pdf")
}
fn editable_base(c:&Connection,record:&local_resources::LocalResource,revision:&str)->Result<(),String>{
    if record.updated_at!=revision{return Err("Resource changed after the editor opened; your work is preserved. Review before saving".into())}
    let other:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM active_sync_outbox o WHERE entity_type='resource' AND entity_id=?1 AND synced_at IS NULL AND operation<>'edit_content' AND NOT(operation IN ('create','create_copy') AND COALESCE(json_extract(payload_json,'$.upload.protocol'),0)=1 AND EXISTS(SELECT 1 FROM local_resource_uploads u WHERE u.account_id=o.account_id AND u.change_id=o.change_id AND u.resource_id=o.entity_id AND u.state='ready')))",[&record.id],|r|r.get(0)).map_err(err)?;
    if other{return Err("Sync the resource's pending metadata or attachment changes before editing its contents".into())}Ok(())
}
// Caller holds an IMMEDIATE transaction and has fsynced the immutable version.
fn publish(c:&Connection,account:&str,change:&str,mut record:local_resources::LocalResource,size:u64,digest:&str,format:&str)->Result<local_resources::LocalResource,String>{
    let previous:Option<String>=c.query_row("SELECT change_id FROM sync_outbox WHERE account_id=?1 AND entity_type='resource' AND entity_id=?2 AND operation IN ('edit_content','create','create_copy') AND synced_at IS NULL ORDER BY rowid DESC LIMIT 1",params![account,record.id],|r|r.get(0)).optional().map_err(err)?;
    let base=record.updated_at.clone();
    record.updated_at=c.query_row("SELECT max(strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ',?1,'+0.001 seconds'))",[&base],|r|r.get(0)).map_err(err)?;
    record.size_bytes=Some(size as i64);
    let mut resources=local_resources::read_resources(c)?;
    *resources.iter_mut().find(|r|r.id==record.id).ok_or("Resource disappeared")?=record.clone();
    let payload=json!({"resource":{"id":record.id,"kind":"file","size_bytes":size},"edit":{"protocol":1,"format":format,"expected_updated_at":base,"previous_change_id":previous},"upload":{"protocol":1,"sha256":digest,"size_bytes":size}});
    let device:String=c.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).map_err(err)?;
    c.execute("INSERT INTO local_resource_edits(account_id,change_id,resource_id,size_bytes,local_revision) VALUES(?1,?2,?3,?4,?5)",params![account,change,record.id,size as i64,record.updated_at]).map_err(err)?;
    local_resources::write_resources(c,&resources)?;
    c.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,'resource',?3,'edit_content',?4)",params![change,device,record.id,payload.to_string()]).map_err(err)?;
    Ok(record)
}

#[tauri::command]
pub fn save_local_resource_markdown(app:AppHandle,expected_account_id:String,expected_session_token:String,resource_id:String,expected_revision:String,content:String)->Result<local_resources::LocalResource,String>{
    if content.len()>MAX_TEXT{return Err("Markdown editor supports up to 4 MiB of UTF-8 text".into())}
    let mut c=local_db::open_local_connection(&app)?;schema(&c)?;
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(err)?;
    let record=guard(&tx,&expected_account_id,Some(&expected_session_token),&resource_id)?;
    if !markdown(&record){return Err("Only Markdown files can be saved here".into())}
    editable_base(&tx,&record,&expected_revision)?;
    // For the first edit require actual verified local bytes, not merely metadata.
    // Later saves replace only the local view; each earlier version is retained.
    local_resource_uploads::resolved_file(&app,&tx,&resource_id)?;
    let change=uuid::Uuid::new_v4().to_string();
    let path=local_resource_uploads::file_path(&app,&expected_account_id,&change)?;
    fs::create_dir_all(path.parent().unwrap()).map_err(err)?;
    let mut file=OpenOptions::new().write(true).create_new(true).open(&path).map_err(err)?;
    file.write_all(content.as_bytes()).map_err(err)?;file.sync_all().map_err(err)?;drop(file);
    let digest=local_resource_uploads::hash_file(&path)?;
    let record=publish(&tx,&expected_account_id,&change,record,content.len() as u64,&digest,"markdown")?;
    guard(&tx,&expected_account_id,Some(&expected_session_token),&resource_id)?;
    tx.commit().map_err(err)?;Ok(record)
}

pub(crate) fn readable(app:&AppHandle,c:&Connection,id:&str)->Result<(PathBuf,String,u64),String>{
    schema(c)?;let account=local_db::active_account(c)?;
    let record=guard(c,&account,None,id)?;
    let (change,size,revision,pending):(String,i64,Option<String>,bool)=c.query_row(
        "SELECT e.change_id,e.size_bytes,e.server_revision,o.synced_at IS NULL FROM local_resource_edits e JOIN sync_outbox o ON o.account_id=e.account_id AND o.change_id=e.change_id WHERE e.account_id=?1 AND e.resource_id=?2 AND (o.synced_at IS NULL OR e.server_revision IS NOT NULL) ORDER BY e.rowid DESC LIMIT 1",params![account,id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(err)?;
    if !pending&&revision.as_deref()!=Some(record.updated_at.as_str()){return Err("Edited file needs revision verification".into())}
    let path=local_resource_uploads::file_path(app,&account,&change)?;
    if size<0||fs::metadata(&path).map_err(err)?.len()!=size as u64{return Err("Saved editor bytes are incomplete".into())}
    Ok((path,if pdf(&record){"application/pdf"}else{"text/plain; charset=utf-8"}.into(),size as u64))
}

#[tauri::command]
pub fn begin_local_pdf_replacement(app:AppHandle,expected_account_id:String,expected_session_token:String,resource_id:String,expected_revision:String,size_bytes:u64)->Result<Value,String>{
    if !(5..=MAX_PDF).contains(&size_bytes){return Err("Replacement PDF must be between 5 bytes and 500 MiB".into())}
    let mut c=local_db::open_local_connection(&app)?;schema(&c)?;
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(err)?;
    let record=guard(&tx,&expected_account_id,Some(&expected_session_token),&resource_id)?;
    if !pdf(&record){return Err("Only PDF resources can be replaced here".into())}
    editable_base(&tx,&record,&expected_revision)?;
    local_resource_uploads::resolved_file(&app,&tx,&resource_id)?;
    let change=uuid::Uuid::new_v4().to_string();let path=local_resource_uploads::file_path(&app,&expected_account_id,&change)?;
    fs::create_dir_all(path.parent().unwrap()).map_err(err)?;
    OpenOptions::new().write(true).create_new(true).open(path).map_err(err)?.sync_all().map_err(err)?;
    tx.execute("INSERT INTO local_resource_edit_staging(account_id,change_id,resource_id,expected_revision,size_bytes) VALUES(?1,?2,?3,?4,?5)",params![expected_account_id,change,resource_id,expected_revision,size_bytes as i64]).map_err(err)?;
    tx.commit().map_err(err)?;Ok(json!({"change_id":change}))
}
fn staged(c:&Connection,account:&str,change:&str)->Result<(String,String,u64,bool),String>{
    c.query_row("SELECT resource_id,expected_revision,size_bytes,published FROM local_resource_edit_staging WHERE account_id=?1 AND change_id=?2",params![account,change],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(err)
}
#[tauri::command]
pub fn write_local_pdf_replacement_chunk(app:AppHandle,expected_account_id:String,expected_session_token:String,change_id:String,offset:u64,bytes:Vec<u8>)->Result<(),String>{
    if bytes.is_empty()||bytes.len()>1024*1024{return Err("Invalid replacement chunk".into())}
    let mut c=local_db::open_local_connection(&app)?;schema(&c)?;
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(err)?;
    let (id,revision,size,published)=staged(&tx,&expected_account_id,&change_id)?;
    let record=guard(&tx,&expected_account_id,Some(&expected_session_token),&id)?;editable_base(&tx,&record,&revision)?;
    if published||offset.checked_add(bytes.len() as u64).filter(|end|*end<=size).is_none(){return Err("Replacement is finalized or chunk exceeds saved size".into())}
    let mut file=OpenOptions::new().read(true).write(true).open(local_resource_uploads::file_path(&app,&expected_account_id,&change_id)?).map_err(err)?;
    let len=file.metadata().map_err(err)?.len();if offset>len{return Err("Missing earlier replacement bytes".into())}
    file.seek(SeekFrom::Start(offset)).map_err(err)?;
    if offset<len{
        let n=(len-offset).min(bytes.len() as u64) as usize;let mut existing=vec![0;n];file.read_exact(&mut existing).map_err(err)?;
        if existing!=bytes[..n]{return Err("Replacement retry differs from saved bytes".into())}file.seek(SeekFrom::Start(offset)).map_err(err)?;
    }
    file.write_all(&bytes).map_err(err)?;file.sync_all().map_err(err)?;
    guard(&tx,&expected_account_id,Some(&expected_session_token),&id)?;tx.commit().map_err(err)
}
#[tauri::command]
pub fn finish_local_pdf_replacement(app:AppHandle,expected_account_id:String,expected_session_token:String,change_id:String)->Result<local_resources::LocalResource,String>{
    let mut c=local_db::open_local_connection(&app)?;schema(&c)?;
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(err)?;
    let (id,revision,size,published)=staged(&tx,&expected_account_id,&change_id)?;
    let record=guard(&tx,&expected_account_id,Some(&expected_session_token),&id)?;
    if published{return Ok(record)}
    editable_base(&tx,&record,&revision)?;if !pdf(&record){return Err("Resource is no longer a PDF".into())}
    let path=local_resource_uploads::file_path(&app,&expected_account_id,&change_id)?;
    if fs::metadata(&path).map_err(err)?.len()!=size{return Err("Replacement file is incomplete; original unchanged".into())}
    let mut header=[0;5];fs::File::open(&path).map_err(err)?.read_exact(&mut header).map_err(err)?;
    if &header!=b"%PDF-"{return Err("Replacement does not have a PDF header; original unchanged".into())}
    let digest=local_resource_uploads::hash_file(&path)?;
    let record=publish(&tx,&expected_account_id,&change_id,record,size,&digest,"pdf")?;
    tx.execute("UPDATE local_resource_edit_staging SET published=1 WHERE account_id=?1 AND change_id=?2",params![expected_account_id,change_id]).map_err(err)?;
    guard(&tx,&expected_account_id,Some(&expected_session_token),&id)?;tx.commit().map_err(err)?;Ok(record)
}

#[tauri::command]
pub fn read_local_resource_edit_chunk(app:AppHandle,expected_account_id:String,expected_session_token:String,change_id:String,offset:u64)->Result<Vec<u8>,String>{
    let c=local_db::open_local_connection(&app)?;schema(&c)?;
    let (id,size):(String,i64)=c.query_row("SELECT e.resource_id,e.size_bytes FROM local_resource_edits e JOIN active_sync_outbox o ON o.change_id=e.change_id AND o.account_id=e.account_id WHERE e.account_id=?1 AND e.change_id=?2 AND o.synced_at IS NULL",params![expected_account_id,change_id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(err)?;
    guard(&c,&expected_account_id,Some(&expected_session_token),&id)?;
    if size<0||offset>size as u64{return Err("Invalid editor chunk offset".into())}
    let mut f=fs::File::open(local_resource_uploads::file_path(&app,&expected_account_id,&change_id)?).map_err(err)?;
    f.seek(SeekFrom::Start(offset)).map_err(err)?;let mut bytes=vec![0;((size as u64-offset).min(1024*1024)) as usize];f.read_exact(&mut bytes).map_err(err)?;
    guard(&c,&expected_account_id,Some(&expected_session_token),&id)?;Ok(bytes)
}

#[tauri::command]
pub fn bind_local_resource_edit_receipts(app:AppHandle,expected_account_id:String,expected_session_token:String,results:Vec<Value>)->Result<(),String>{
    let _=(app,expected_account_id,expected_session_token,results);
    Err("Use native server-verified file confirmation; renderer receipts cannot bind file revisions".into())
}

#[tauri::command]
pub fn list_local_markdown_versions(app:AppHandle,expected_account_id:String,expected_session_token:String,resource_id:String)->Result<Vec<Value>,String>{
    let c=local_db::open_local_connection(&app)?;schema(&c)?;
    let record=guard(&c,&expected_account_id,Some(&expected_session_token),&resource_id)?;
    if !markdown(&record){return Err("Saved text versions are available for Markdown only".into())}
    let mut query=c.prepare("SELECT e.change_id,e.size_bytes,o.created_at,CASE WHEN o.synced_at IS NULL THEN 'pending' WHEN e.server_revision IS NOT NULL THEN 'confirmed' ELSE 'discarded' END FROM local_resource_edits e JOIN sync_outbox o ON o.account_id=e.account_id AND o.change_id=e.change_id WHERE e.account_id=?1 AND e.resource_id=?2 AND COALESCE(json_extract(o.payload_json,'$.edit.format'),'markdown')='markdown' ORDER BY e.rowid DESC LIMIT 100").map_err(err)?;
    let rows=query.query_map(params![expected_account_id,resource_id],|r|Ok(json!({"change_id":r.get::<_,String>(0)?,"size_bytes":r.get::<_,i64>(1)?,"created_at":r.get::<_,String>(2)?,"status":r.get::<_,String>(3)?}))).map_err(err)?;
    let result=rows.collect::<Result<Vec<_>,_>>().map_err(err)?;
    guard(&c,&expected_account_id,Some(&expected_session_token),&resource_id)?;Ok(result)
}

#[tauri::command]
pub fn read_local_markdown_version(app:AppHandle,expected_account_id:String,expected_session_token:String,resource_id:String,change_id:String)->Result<String,String>{
    let c=local_db::open_local_connection(&app)?;schema(&c)?;
    let record=guard(&c,&expected_account_id,Some(&expected_session_token),&resource_id)?;
    if !markdown(&record){return Err("Saved text versions are available for Markdown only".into())}
    let (size,digest):(i64,String)=c.query_row("SELECT e.size_bytes,json_extract(o.payload_json,'$.upload.sha256') FROM local_resource_edits e JOIN sync_outbox o ON o.account_id=e.account_id AND o.change_id=e.change_id WHERE e.account_id=?1 AND e.resource_id=?2 AND e.change_id=?3 AND COALESCE(json_extract(o.payload_json,'$.edit.format'),'markdown')='markdown'",params![expected_account_id,resource_id,change_id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(err)?;
    if size<0||size as usize>MAX_TEXT{return Err("Saved version exceeds the Markdown reader limit".into())}
    let path=local_resource_uploads::file_path(&app,&expected_account_id,&change_id)?;
    let mut bytes=Vec::new();fs::File::open(&path).map_err(err)?.take(size as u64+1).read_to_end(&mut bytes).map_err(err)?;
    use sha2::{Digest,Sha256};
    if bytes.len()!=size as usize||format!("{:x}",Sha256::digest(&bytes))!=digest{return Err("Saved version failed integrity verification; file preserved".into())}
    guard(&c,&expected_account_id,Some(&expected_session_token),&resource_id)?;
    String::from_utf8(bytes).map_err(|_|"Saved version is not valid UTF-8".into())
}
