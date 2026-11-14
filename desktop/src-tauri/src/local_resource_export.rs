//! User-requested external file copies. No domain write, HTTP fallback or outbox.
use std::{fs::{self,File,OpenOptions},io::{Read,Write},path::{Path,PathBuf}};
use tauri::AppHandle;
use crate::{local_db,local_auth,local_resources,local_resource_uploads};
use sha2::{Digest,Sha256};
fn err(e:impl std::fmt::Display)->String{e.to_string()}
pub(crate) fn filename(value:&str)->String{
 let value:String=value.chars().map(|c|if c.is_control()||"<>:\"/\\|?*".contains(c){'_'}else{c}).take(180).collect();
 let value=value.trim().trim_end_matches(['.',' ']);
 if value.is_empty(){return "resource".into()}
 let base=value.split('.').next().unwrap_or("").to_ascii_uppercase();
 if ["CON","PRN","AUX","NUL","COM1","COM2","COM3","COM4","COM5","COM6","COM7","COM8","COM9","LPT1","LPT2","LPT3","LPT4","LPT5","LPT6","LPT7","LPT8","LPT9"].contains(&base.as_str()){format!("_{value}")}else{value.into()}
}
struct PartialFile{path:Option<PathBuf>,file:Option<File>}
impl Drop for PartialFile{fn drop(&mut self){drop(self.file.take());if let Some(path)=&self.path{let _=fs::remove_file(path);}}}
#[cfg(windows)]pub(crate) fn replace(source:&Path,target:&Path)->Result<(),String>{
 use std::os::windows::ffi::OsStrExt;
 use windows_sys::Win32::Storage::FileSystem::{MoveFileExW,MOVEFILE_REPLACE_EXISTING,MOVEFILE_WRITE_THROUGH};
 let source:Vec<u16>=source.as_os_str().encode_wide().chain(Some(0)).collect();let target:Vec<u16>=target.as_os_str().encode_wide().chain(Some(0)).collect();
 if unsafe{MoveFileExW(source.as_ptr(),target.as_ptr(),MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH)}==0{return Err(err(std::io::Error::last_os_error()))}Ok(())
}
#[cfg(not(windows))]pub(crate) fn replace(source:&Path,target:&Path)->Result<(),String>{fs::rename(source,target).map_err(err)}
fn same_path(a:&Path,b:&Path)->bool{
 #[cfg(windows)]{a.as_os_str().to_string_lossy().to_lowercase()==b.as_os_str().to_string_lossy().to_lowercase()}
 #[cfg(not(windows))]{a==b}
}
pub(crate) fn within(path:&Path,root:&Path)->bool{let mut parent=Some(path);while let Some(p)=parent{if same_path(p,root){return true}parent=p.parent();}false}
pub(crate) fn copy_atomic(source:&Path,target:&Path,size:u64,expected_digest:&str,mut verify:impl FnMut()->Result<(),String>)->Result<(),String>{
 verify()?;
 if expected_digest.len()!=64||!expected_digest.bytes().all(|b|b.is_ascii_hexdigit()){return Err("File integrity proof unavailable; destination unchanged".into())}
 let parent=target.parent().ok_or("Choose a destination folder")?.canonicalize().map_err(err)?;
 let target=parent.join(target.file_name().ok_or("Choose a file name")?);
 if target.canonicalize().ok().is_some_and(|target|same_path(&target,&source.canonicalize().unwrap_or_default())){return Err("Choose a destination outside the source file".into())}
 let path=parent.join(format!(".labos-export-{}.partial",uuid::Uuid::new_v4()));
 let output=OpenOptions::new().write(true).create_new(true).open(&path).map_err(err)?;
 let mut partial=PartialFile{path:Some(path.clone()),file:Some(output)};
 let mut input=crate::working_store::open(source).map_err(err)?;let before=input.metadata().map_err(err)?;
 if before.len()!=size{return Err("Local source changed before export".into())}
 let mut remaining=size;let mut buffer=vec![0;1024*1024];let mut hash=Sha256::new();
 while remaining>0{verify()?;let wanted=remaining.min(buffer.len() as u64)as usize;let count=input.read(&mut buffer[..wanted]).map_err(err)?;if count==0{return Err("Local source became incomplete; destination unchanged".into())}hash.update(&buffer[..count]);partial.file.as_mut().unwrap().write_all(&buffer[..count]).map_err(err)?;remaining-=count as u64;}
 if input.read(&mut buffer[..1]).map_err(err)?!=0||input.metadata().map_err(err)?.modified().ok()!=before.modified().ok(){return Err("Local source changed during export; destination unchanged".into())}
 if !format!("{:x}",hash.finalize()).eq_ignore_ascii_case(expected_digest){return Err("Local file failed integrity verification; destination unchanged".into())}
 partial.file.as_mut().unwrap().sync_all().map_err(err)?;drop(partial.file.take());verify()?;
 replace(&path,&target)?;partial.path=None;Ok(())
}
fn source(app:&AppHandle,c:&rusqlite::Connection,account:&str,session:&str,id:&str)->Result<(PathBuf,u64,String),String>{
 local_db::require_sync_account(c,account)?;local_auth::require_local_permission(c,"resources.view")?;
 let actual:String=c.query_row("SELECT session_token FROM local_session WHERE id=1",[],|r|r.get(0)).map_err(err)?;
 if actual!=session{return Err("Session changed; export stopped".into())}
 let(path,_,size)=local_resource_uploads::resolved_file(app,c,id)?;
 // Staged uploads/edits use a native change-ID path and immutable outbox digest.
 // Replicated copies use the last verified account/revision manifest digest.
 let native_change=path.parent().and_then(|p|p.file_name()).and_then(|s|s.to_str()).and_then(|s|uuid::Uuid::parse_str(s).ok()).map(|u|u.to_string());
 let digest=if let Some(change)=native_change.filter(|change|local_resource_uploads::file_path(app,account,change).ok().as_ref()==Some(&path)){
  c.query_row("SELECT json_extract(payload_json,'$.upload.sha256') FROM sync_outbox WHERE account_id=?1 AND entity_type='resource' AND entity_id=?2 AND change_id=?3 AND operation IN ('create','create_copy','edit_content')",rusqlite::params![account,id,change],|r|r.get::<_,String>(0)).map_err(err)?
 }else{
  if crate::local_resource_replication::readable(app,c,id)?.0!=path{return Err("Local file integrity identity changed".into())}
  c.query_row("SELECT sha256 FROM local_resource_copies WHERE account_id=?1 AND resource_id=?2 AND state='ready'",rusqlite::params![account,id],|r|r.get::<_,String>(0)).map_err(err)?
 };Ok((path,size,digest))
}
#[tauri::command]
pub async fn export_local_resource_file(app:AppHandle,expected_account_id:String,expected_session_token:String,resource_id:String)->Result<bool,String>{
 tauri::async_runtime::spawn_blocking(move||{
  let id=uuid::Uuid::parse_str(&resource_id).map_err(err)?.to_string();let c=local_db::open_local_connection(&app)?;
  let pinned=source(&app,&c,&expected_account_id,&expected_session_token,&id)?;
  let record=local_resources::read_resources(&c)?.into_iter().find(|r|r.id==id).ok_or("Resource unavailable")?;
  let name=filename(record.original_filename.as_deref().unwrap_or(&record.name));
  // The destination comes exclusively from this native dialog, never an IPC path.
  let Some(target)=tauri::api::dialog::blocking::FileDialogBuilder::new().set_file_name(&name).save_file()else{return Ok(false)};
  let managed=tauri::api::path::app_data_dir(&app.config()).ok_or("Missing app data directory")?;
  if crate::working_store::is_managed_directory(&managed,target.parent().ok_or("Choose a destination folder")?)?{return Err("Export outside LabOS managed storage".into())}
  copy_atomic(&pinned.0,&target,pinned.1,&pinned.2,||{if source(&app,&c,&expected_account_id,&expected_session_token,&id)?!=pinned{return Err("Resource revision changed; export stopped".into())}Ok(())})?;Ok(true)
 }).await.map_err(err)?
}
#[cfg(test)]mod tests{
 use super::*;
 struct Fixture(PathBuf);
 impl Fixture{fn new()->Self{let path=std::env::temp_dir().join(format!("labos-export-test-{}",uuid::Uuid::new_v4()));fs::create_dir(&path).unwrap();Self(path)}}
 impl Drop for Fixture{fn drop(&mut self){for name in ["source","target"]{let _=fs::remove_file(self.0.join(name));}let _=fs::remove_dir(&self.0);}}
 #[test]fn large_export_is_bounded_verified_and_atomically_replaces_chosen_destination(){
  let fixture=Fixture::new();let source=fixture.0.join("source");let target=fixture.0.join("target");let mut file=File::create(&source).unwrap();let chunk=vec![93;1024*1024];for _ in 0..33{file.write_all(&chunk).unwrap();}file.write_all(b"ending").unwrap();file.sync_all().unwrap();drop(file);fs::write(&target,b"old destination").unwrap();
  let size=fs::metadata(&source).unwrap().len();let digest=local_resource_uploads::hash_file(&source).unwrap();let mut checks=0;copy_atomic(&source,&target,size,&digest,||{checks+=1;Ok(())}).unwrap();assert!(checks>=36);assert_eq!(fs::metadata(&target).unwrap().len(),size);assert_eq!(digest,local_resource_uploads::hash_file(&target).unwrap());assert_eq!(fs::read_dir(&fixture.0).unwrap().count(),2);
 }
 #[test]fn revoked_session_changed_source_and_failed_commit_preserve_destination_and_remove_partials(){
  let fixture=Fixture::new();let source=fixture.0.join("source");let target=fixture.0.join("target");fs::write(&source,vec![1;2*1024*1024]).unwrap();fs::write(&target,b"existing work").unwrap();let size=fs::metadata(&source).unwrap().len();
  let digest=local_resource_uploads::hash_file(&source).unwrap();
  for fail_after in [1,2,3,4]{let mut checks=0;assert!(copy_atomic(&source,&target,size,&digest,||{checks+=1;if checks==fail_after{Err("session revoked".into())}else{Ok(())}}).is_err());assert_eq!(fs::read(&target).unwrap(),b"existing work");assert_eq!(fs::read_dir(&fixture.0).unwrap().count(),2);}
  assert!(copy_atomic(&source,&source,size,&digest,||Ok(())).is_err());assert!(copy_atomic(&source,&target,size-1,&digest,||Ok(())).is_err());assert!(copy_atomic(&source,&target,size,&"0".repeat(64),||Ok(())).is_err());
  let mut checks=0;assert!(copy_atomic(&source,&target,size,&digest,||{checks+=1;if checks==3{OpenOptions::new().append(true).open(&source).unwrap().write_all(b"changed").unwrap();}Ok(())}).is_err());assert_eq!(fs::read(&target).unwrap(),b"existing work");assert_eq!(fs::read_dir(&fixture.0).unwrap().count(),2);
  fs::remove_file(&target).unwrap();fs::create_dir(&target).unwrap();let digest=local_resource_uploads::hash_file(&source).unwrap();assert!(copy_atomic(&source,&target,fs::metadata(&source).unwrap().len(),&digest,||Ok(())).is_err());assert!(target.is_dir());assert_eq!(fs::read_dir(&fixture.0).unwrap().count(),2);fs::remove_dir(target).unwrap();
 }
 #[test]fn export_names_are_safe_native_dialog_defaults(){assert_eq!(filename("../CON.pdf"),".._CON.pdf");assert_eq!(filename("CON.pdf"),"_CON.pdf");assert_eq!(filename(".. "),"resource");assert_eq!(filename("file?.pdf"),"file_.pdf");}
}
