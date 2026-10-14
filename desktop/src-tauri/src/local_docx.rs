use crate::{local_auth,local_db,local_resources,local_resource_uploads};
use rusqlite::{params,Connection,OptionalExtension,TransactionBehavior};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::{fs::{self,OpenOptions},io::{Read,Write},path::{Path,PathBuf},process::{Command,Stdio},sync::atomic::{AtomicUsize,Ordering},time::{Duration,Instant}};
use tauri::AppHandle;
#[cfg(not(debug_assertions))]
use tauri::Manager;

#[cfg(windows)]
mod process_job{
    use std::{mem,os::windows::io::AsRawHandle,process::Child};
    use windows_sys::Win32::{Foundation::{CloseHandle,HANDLE},System::JobObjects::*};
    pub struct Job(HANDLE);
    impl Drop for Job{fn drop(&mut self){unsafe{CloseHandle(self.0);}}}
    impl Job{
        pub fn attach(child:&Child)->Result<Self,String>{unsafe{
            let handle=CreateJobObjectW(std::ptr::null(),std::ptr::null());
            if handle==0{return Err("Could not isolate DOCX process".into())}
            let job=Self(handle);
            let mut limits:JOBOBJECT_EXTENDED_LIMIT_INFORMATION=mem::zeroed();
            limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE|JOB_OBJECT_LIMIT_ACTIVE_PROCESS|JOB_OBJECT_LIMIT_PROCESS_MEMORY;
            limits.BasicLimitInformation.ActiveProcessLimit=1;
            limits.ProcessMemoryLimit=384*1024*1024;
            if SetInformationJobObject(handle,JobObjectExtendedLimitInformation,&limits as *const _ as *const _,mem::size_of_val(&limits) as u32)==0||AssignProcessToJobObject(handle,child.as_raw_handle() as HANDLE)==0{return Err("Could not apply DOCX process limits".into())}
            Ok(job)
        }}
    }
}

const FILE_LIMIT:usize=16*1024*1024;
const HTML_LIMIT:usize=4*1024*1024;
const MIME:&str="application/vnd.openxmlformats-officedocument.wordprocessingml.document";
static ACTIVE:AtomicUsize=AtomicUsize::new(0);
struct Slot;
impl Drop for Slot{fn drop(&mut self){ACTIVE.fetch_sub(1,Ordering::SeqCst);}}
fn slot()->Result<Slot,String>{ACTIVE.fetch_update(Ordering::SeqCst,Ordering::SeqCst,|n|if n<2{Some(n+1)}else{None}).map(|_|Slot).map_err(|_|"DOCX conversion is busy. Retry shortly.".into())}
fn err(e:impl std::fmt::Display)->String{e.to_string()}
fn bounded(path:&Path,max:usize)->Result<Vec<u8>,String>{let mut bytes=Vec::new();fs::File::open(path).map_err(err)?.take(max as u64+1).read_to_end(&mut bytes).map_err(err)?;if bytes.len()>max{return Err("DOCX data exceeds its size limit".into())}Ok(bytes)}

fn runtime(app:&AppHandle)->Result<PathBuf,String>{
    let pin:Value=serde_json::from_str(include_str!("../docx-runtime-pin.json")).map_err(err)?;
    let directory=pin["directory"].as_str().ok_or("Missing DOCX runtime pin")?;
    if !directory.starts_with("docx-")||directory.contains(['/', '\\']){return Err("DOCX runtime is not configured".into())}
    #[cfg(debug_assertions)]
    let base=PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    #[cfg(not(debug_assertions))]
    let base=tauri::api::path::resource_dir(app.package_info(),&app.env()).ok_or("Missing packaged resource directory")?;
    let _=app;
    let root=base.join("runtime").join(directory).canonicalize().map_err(|_|"Packaged DOCX converter is missing; reinstall the complete LabOS package")?;
    let manifest=bounded(&root.join("bundle-manifest.json"),2*1024*1024)?;
    if format!("{:x}",Sha256::digest(&manifest))!=pin["sha256"].as_str().unwrap_or(""){return Err("DOCX runtime manifest failed verification".into())}
    let manifest:Value=serde_json::from_slice(&manifest).map_err(err)?;
    let files=manifest["files"].as_array().ok_or("Invalid DOCX runtime manifest")?;
    if files.len()>10000{return Err("Invalid DOCX runtime file count".into())}
    // Verify before execution. No renderer path/PATH or server fallback is used.
    for entry in files{
        let relative=entry["path"].as_str().ok_or("Invalid runtime path")?;
        if Path::new(relative).is_absolute()||relative.split(['/', '\\']).any(|p|p==".."||p.is_empty()){return Err("Invalid runtime path".into())}
        let file=root.join(relative).canonicalize().map_err(err)?;
        if !file.starts_with(&root)||!file.is_file(){return Err("Runtime file escaped its package".into())}
        if fs::metadata(&file).map_err(err)?.len()!=entry["size"].as_u64().ok_or("Invalid runtime size")?||local_resource_uploads::hash_file(&file)?!=entry["sha256"].as_str().unwrap_or(""){return Err("DOCX runtime failed integrity verification".into())}
    }
    Ok(root)
}

fn convert(app:&AppHandle,mode:u8,input:Vec<u8>)->Result<Vec<u8>,String>{
    let _slot=slot()?;
    convert_with_runtime(&runtime(app)?,mode,input)
}

fn convert_with_runtime(root:&Path,mode:u8,input:Vec<u8>)->Result<Vec<u8>,String>{
    if ![1,2].contains(&mode)||input.len()>if mode==1{FILE_LIMIT}else{HTML_LIMIT}{return Err("Invalid DOCX conversion input".into())}
    let mut command=Command::new(root.join(if cfg!(windows){"node.exe"}else{"node"}));
    command.arg("--max-old-space-size=128").arg(root.join("src/docx-native-worker.js")).current_dir(&root).env_clear().stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    for key in ["SystemRoot","WINDIR","TEMP","TMP","TMPDIR"]{if let Some(value)=std::env::var_os(key){command.env(key,value);}}
    #[cfg(windows)]{use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}
    let mut child=command.spawn().map_err(|_|"Could not start packaged DOCX converter")?;
    #[cfg(windows)]
    let _job=match process_job::Job::attach(&child){Ok(job)=>job,Err(error)=>{let _=child.kill();let _=child.wait();return Err(error)}};
    let mut stdin=child.stdin.take().ok_or("Missing converter input")?;
    let stdout=child.stdout.take().ok_or("Missing converter output")?;
    let writer=std::thread::spawn(move||->Result<(),String>{stdin.write_all(&[mode]).map_err(err)?;stdin.write_all(&(input.len() as u32).to_be_bytes()).map_err(err)?;stdin.write_all(&input).map_err(err)});
    let reader=std::thread::spawn(move||->Result<Vec<u8>,String>{let mut out=Vec::new();stdout.take(FILE_LIMIT as u64+6).read_to_end(&mut out).map_err(err)?;Ok(out)});
    let deadline=Instant::now()+Duration::from_secs(20);
    let status=loop{match child.try_wait(){Ok(Some(status))=>break Ok(status),Ok(None)if Instant::now()<deadline=>std::thread::sleep(Duration::from_millis(20)),Ok(None)=>break Err("DOCX conversion timed out".to_string()),Err(_)=>break Err("DOCX converter failed".to_string())}};
    if status.is_err(){let _=child.kill();let _=child.wait();}
    let written=writer.join().map_err(|_|"DOCX input worker failed")?;
    let output=reader.join().map_err(|_|"DOCX output worker failed")??;
    let status=status?;written?;
    if !status.success()||output.len()<5||output.len()>FILE_LIMIT+5{return Err("DOCX converter stopped or returned invalid output".into())}
    let length=u32::from_be_bytes(output[1..5].try_into().unwrap()) as usize;
    if length!=output.len()-5{return Err("Incomplete DOCX conversion result".into())}
    if output[0]==3{let error:Value=serde_json::from_slice(&output[5..]).map_err(err)?;return Err(error["error"].as_str().unwrap_or("DOCX conversion failed").chars().take(1000).collect())}
    if output[0]!=mode{return Err("Unexpected DOCX converter response".into())}
    Ok(output[5..].to_vec())
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn bundled_native_process_round_trip(){
        let pin:Value=serde_json::from_str(include_str!("../docx-runtime-pin.json")).unwrap();
        let root=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("runtime").join(pin["directory"].as_str().unwrap());
        let bytes=convert_with_runtime(&root,2,b"<h1>Native bounded process</h1><p><b>Preserved</b></p>".to_vec()).unwrap();
        assert!(bytes.starts_with(b"PK\x03\x04"));
        let output=convert_with_runtime(&root,1,bytes).unwrap();
        let preview:Value=serde_json::from_slice(&output).unwrap();
        assert!(preview["html"].as_str().unwrap().contains("<strong>Preserved</strong>"));
        // Exercises the actual bundled binary, native framing and Windows job
        // limits. No SQLite/PostgreSQL fixtures or desktop acceptance implied.
        assert!(convert_with_runtime(&root,1,b"invalid DOCX".to_vec()).is_err());
    }
}

fn schema(c:&Connection)->Result<(),String>{local_resource_uploads::schema(c)?;c.execute_batch("CREATE TABLE IF NOT EXISTS local_docx_copy_requests(account_id TEXT NOT NULL,request_id TEXT NOT NULL,source_id TEXT NOT NULL,source_revision TEXT NOT NULL,html_sha256 TEXT NOT NULL,resource_id TEXT NOT NULL,PRIMARY KEY(account_id,request_id));").map_err(err)}
fn source(c:&Connection,account:&str,session:&str,id:&str,revision:Option<&str>)->Result<local_resources::LocalResource,String>{
    local_db::require_sync_account(c,account)?;
    let current:String=c.query_row("SELECT session_token FROM local_session WHERE id=1",[],|r|r.get(0)).map_err(err)?;
    if current!=session{return Err("Session changed during DOCX conversion".into())}
    let record=local_resources::read_resources(c)?.into_iter().find(|r|r.id==id).ok_or("DOCX is unavailable on this PC")?;
    crate::resource_dependencies::require_editor_access(c,&record)?;
    if record.kind!="file"||record.file_type!="document"||!record.original_filename.as_deref().unwrap_or(&record.name).to_lowercase().ends_with(".docx"){return Err("Only DOCX resources are supported".into())}
    if revision.is_some_and(|r|r!=record.updated_at){return Err("The DOCX source changed; reopen it before saving. Your original is unchanged.".into())}
    Ok(record)
}
fn prior(c:&Connection,account:&str,request:&str,id:&str,revision:&str,digest:&str)->Result<Option<local_resources::LocalResource>,String>{
    let saved:Option<(String,String,String,String)>=c.query_row("SELECT source_id,source_revision,html_sha256,resource_id FROM local_docx_copy_requests WHERE account_id=?1 AND request_id=?2",params![account,request],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(err)?;
    if let Some((s,r,h,copy))=saved{if s!=id||r!=revision||h!=digest{return Err("DOCX retry differs from the saved request".into())}return local_resources::read_resources(c)?.into_iter().find(|r|r.id==copy).map(Some).ok_or("The previous copy was removed; this retry cannot recreate it".into())}Ok(None)
}

#[tauri::command]
pub async fn read_local_docx(app:AppHandle,expected_account_id:String,expected_session_token:String,resource_id:String,expected_revision:Option<String>)->Result<Value,String>{
    tauri::async_runtime::spawn_blocking(move||{
        let c=local_db::open_local_connection(&app)?;
        let record=source(&c,&expected_account_id,&expected_session_token,&resource_id,expected_revision.as_deref())?;
        let (path,_,size)=local_resource_uploads::resolved_file(&app,&c,&resource_id)?;
        if size>FILE_LIMIT as u64{return Err("DOCX previews support files up to 16 MiB".into())}
        let bytes=bounded(&path,FILE_LIMIT)?;if bytes.len() as u64!=size{return Err("Local DOCX file is incomplete".into())}drop(c);
        let output=convert(&app,1,bytes)?;
        if output.len()>HTML_LIMIT+256*1024{return Err("DOCX preview result exceeds its limit".into())}
        let value:Value=serde_json::from_slice(&output).map_err(err)?;
        if value["html"].as_str().filter(|s|s.len()<=HTML_LIMIT).is_none()||value["messages"].as_array().filter(|m|m.len()<=100).is_none(){return Err("Invalid DOCX preview".into())}
        let c=local_db::open_local_connection(&app)?;source(&c,&expected_account_id,&expected_session_token,&resource_id,Some(&record.updated_at))?;
        if local_resource_uploads::resolved_file(&app,&c,&resource_id)?.0!=path{return Err("DOCX file changed while opening".into())}Ok(value)
    }).await.map_err(err)?
}

#[tauri::command]
pub async fn save_local_docx_copy(app:AppHandle,expected_account_id:String,expected_session_token:String,resource_id:String,expected_revision:String,request_id:String,html:String)->Result<local_resources::LocalResource,String>{
    tauri::async_runtime::spawn_blocking(move||{
        if html.len()>HTML_LIMIT{return Err("DOCX markup exceeds 4 MiB".into())}
        let request=uuid::Uuid::parse_str(&request_id).map_err(|_|"Invalid DOCX save request")?.to_string();
        let digest=format!("{:x}",Sha256::digest(html.as_bytes()));
        let c=local_db::open_local_connection(&app)?;schema(&c)?;
        source(&c,&expected_account_id,&expected_session_token,&resource_id,Some(&expected_revision))?;
        local_auth::require_local_permission(&c,"resources.create")?;
        let path=local_resource_uploads::resolved_file(&app,&c,&resource_id)?.0;
        if let Some(copy)=prior(&c,&expected_account_id,&request,&resource_id,&expected_revision,&digest)?{local_resource_uploads::resolved_file(&app,&c,&copy.id)?;return Ok(copy)}
        drop(c);
        let bytes=convert(&app,2,html.into_bytes())?;
        if bytes.len()>FILE_LIMIT||!bytes.starts_with(b"PK\x03\x04"){return Err("Invalid generated DOCX".into())}
        let mut c=local_db::open_local_connection(&app)?;schema(&c)?;
        let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(err)?;
        let source=source(&tx,&expected_account_id,&expected_session_token,&resource_id,Some(&expected_revision))?;
        local_auth::require_local_permission(&tx,"resources.create")?;
        if local_resource_uploads::resolved_file(&app,&tx,&resource_id)?.0!=path{return Err("DOCX source file changed; your original is unchanged".into())}
        if let Some(copy)=prior(&tx,&expected_account_id,&request,&resource_id,&expected_revision,&digest)?{local_resource_uploads::resolved_file(&app,&tx,&copy.id)?;return Ok(copy)}
        let previous=crate::resource_dependencies::source_predecessor(&tx,&resource_id)?;
        local_resource_uploads::parent_guard(&tx,&serde_json::to_value(&source).map_err(err)?)?;
        let change=uuid::Uuid::new_v4().to_string();let id=uuid::Uuid::new_v4().to_string();
        let original=source.original_filename.as_deref().unwrap_or(&source.name).replace('\\',"/");
        let original=original.rsplit('/').next().unwrap_or("Document.docx");
        let stem:String=original[..original.len()-5].chars().take(80).collect();
        let name=format!("{stem} — Edited-{}.docx",&id[..8]);
        let mut record=source.clone();record.id=id.clone();record.name=name.clone();record.original_filename=Some(name.clone());
        record.relative_path=record.parent_resource_id.as_ref().map(|_|name);record.derived_from_resource_id=Some(source.id.clone());record.mime_type=Some(MIME.into());record.size_bytes=Some(bytes.len() as i64);
        record.thumbnail_url=None;record.local_media_path=None;record.local_media_filename=None;record.local_media_mime_type=None;record.local_media_size_bytes=None;record.local_media_downloaded_at=None;
        let now:String=tx.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')",[],|r|r.get(0)).map_err(err)?;record.created_at=now.clone();record.updated_at=now;
        let target=local_resource_uploads::file_path(&app,&expected_account_id,&change)?;fs::create_dir_all(target.parent().unwrap()).map_err(err)?;
        let mut file=OpenOptions::new().write(true).create_new(true).open(target).map_err(err)?;file.write_all(&bytes).map_err(err)?;file.sync_all().map_err(err)?;
        let file_digest=format!("{:x}",Sha256::digest(&bytes));
        let payload=json!({"resource":record,"copy":{"protocol":1,"format":"docx","source_id":source.id,"source_updated_at":source.updated_at,"previous_change_id":previous},"upload":{"protocol":1,"sha256":file_digest,"size_bytes":bytes.len()}});
        let device:String=tx.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).map_err(err)?;
        tx.execute("INSERT INTO local_resource_uploads(account_id,change_id,resource_id,resource_json,size_bytes,sha256,state) VALUES(?1,?2,?3,?4,?5,?6,'ready')",params![expected_account_id,change,id,serde_json::to_string(&record).map_err(err)?,bytes.len() as i64,file_digest]).map_err(err)?;
        let mut resources=local_resources::read_resources(&tx)?;resources.push(record.clone());local_resources::write_resources(&tx,&resources)?;
        tx.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,'resource',?3,'create_copy',?4)",params![change,device,id,payload.to_string()]).map_err(err)?;
        tx.execute("INSERT INTO local_docx_copy_requests(account_id,request_id,source_id,source_revision,html_sha256,resource_id) VALUES(?1,?2,?3,?4,?5,?6)",params![expected_account_id,request,resource_id,expected_revision,digest,id]).map_err(err)?;
        local_auth::require_local_permission(&tx,"resources.create")?;tx.commit().map_err(err)?;Ok(record)
    }).await.map_err(err)?
}
