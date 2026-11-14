use crate::{
    local_db, local_resource_authority, native_authorization, recovery_archive, recovery_crypto,
    recovery_protection,
};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle,Manager};
use zeroize::{Zeroize, Zeroizing};
#[derive(Clone, PartialEq, Eq)]
struct OperationIdentity {
    account: String,
    session_sha256: String,
}
impl OperationIdentity {
    fn new(account: &str, session: &str) -> Self {
        Self {
            account: account.into(),
            session_sha256: format!("{:x}", Sha256::digest(session.as_bytes())),
        }
    }
}
struct Operation {
    identity: OperationIdentity,
    cancelled: bool,
    sealed: bool,
}
static OPERATION: Mutex<Option<Operation>> = Mutex::new(None);
struct Slot {
    identity: OperationIdentity,
}
impl Drop for Slot {
    fn drop(&mut self) {
        let mut state = OPERATION
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if state
            .as_ref()
            .is_some_and(|op| op.identity == self.identity)
        {
            *state = None;
        }
    }
}
fn slot(account: &str, session: &str) -> Result<Slot, String> {
    let mut state = OPERATION
        .lock()
        .map_err(|_| "Recovery operation state unavailable")?;
    if state.is_some() {
        return Err("A recovery operation is already running".into());
    }
    let identity = OperationIdentity::new(account, session);
    *state = Some(Operation {
        identity: identity.clone(),
        cancelled: false,
        sealed: false,
    });
    Ok(Slot { identity })
}
fn cancel_for(account: &str, session: &str) -> Result<bool, String> {
    let mut state = OPERATION
        .lock()
        .map_err(|_| "Recovery operation state unavailable")?;
    let identity = OperationIdentity::new(account, session);
    if let Some(op) = state
        .as_mut()
        .filter(|op| op.identity == identity && !op.sealed)
    {
        op.cancelled = true;
        return Ok(true);
    }
    Ok(false)
}
fn check_cancellation(account: &str, session: &str) -> Result<(), String> {
    let state = OPERATION
        .lock()
        .map_err(|_| "Recovery operation state unavailable")?;
    let identity = OperationIdentity::new(account, session);
    let op = state
        .as_ref()
        .filter(|op| op.identity == identity)
        .ok_or("Recovery operation ownership changed")?;
    if op.cancelled {
        return Err("Recovery operation cancelled; original saved work is preserved".into());
    }
    Ok(())
}
fn seal_publication(account: &str, session: &str) -> Result<(), String> {
    let mut state = OPERATION
        .lock()
        .map_err(|_| "Recovery operation state unavailable")?;
    let identity = OperationIdentity::new(account, session);
    let op = state
        .as_mut()
        .filter(|op| op.identity == identity)
        .ok_or("Recovery operation ownership changed")?;
    if op.cancelled {
        return Err("Recovery cancelled before publication; existing destination unchanged".into());
    }
    op.sealed = true;
    Ok(())
}
fn operation_guard(c: &Connection, account: &str, session: &str) -> Result<(), String> {
    guard(c, account, session)?;
    check_cancellation(account, session)
}
fn operation_status(account: &str, session: &str) -> Result<(bool, bool), String> {
    let state = OPERATION
        .lock()
        .map_err(|_| "Recovery operation state unavailable")?;
    let identity = OperationIdentity::new(account, session);
    Ok((
        state.is_some(),
        state
            .as_ref()
            .is_some_and(|op| op.identity == identity && !op.sealed),
    ))
}
#[tauri::command]
pub fn cancel_local_recovery_operation(
    app: AppHandle,
    expected_account_id: String,
    expected_session_token: String,
) -> Result<bool, String> {
    let c = local_db::open_local_connection(&app)?;
    guard(&c, &expected_account_id, &expected_session_token)?;
    cancel_for(&expected_account_id, &expected_session_token)
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct OwnerKey {
    version: u32,
    owner_account_id: String,
    server_origin: String,
    key: [u8; 32],
}
impl Drop for OwnerKey {
    fn drop(&mut self) {
        self.key.zeroize();
    }
}
fn root(app: &AppHandle) -> Result<PathBuf, String> {
    tauri::api::path::app_data_dir(&app.config())
        .ok_or("Missing application data directory")?
        .canonicalize()
        .map_err(err)
}
fn guard(c: &Connection, account: &str, session: &str) -> Result<(), String> {
    local_resource_authority::guard(c, account, session)?;
    let role: String = c
        .query_row(
            "SELECT u.role FROM local_users u JOIN local_session s ON u.id=s.user_id WHERE s.id=1",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;
    if role != "admin" {
        return Err(
            "Enrolling a recovery custodian requires a current administrator session".into(),
        );
    }
    Ok(())
}
fn load_key(root: &Path) -> Result<Option<OwnerKey>, String> {
    let path = root.join("recovery-key.dpapi");
    if !path.exists() {
        return Ok(None);
    }
    let meta = fs::symlink_metadata(&path).map_err(err)?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return Err("Recovery-key reparse points are not permitted".into());
        }
    }
    if meta.file_type().is_symlink() || !meta.is_file() || meta.len() > 16384 {
        return Err("Invalid protected recovery-key file".into());
    }
    let bytes = recovery_protection::unprotect(&fs::read(path).map_err(err)?)?;
    let key: OwnerKey =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid protected recovery-key contents")?;
    if key.version != 1 || uuid::Uuid::parse_str(&key.owner_account_id).is_err() {
        return Err("Unsupported protected recovery key".into());
    }
    Ok(Some(key))
}
fn save_key(root: &Path, key: &OwnerKey) -> Result<(), String> {
    let bytes = Zeroizing::new(serde_json::to_vec(key).map_err(err)?);
    let protected = recovery_protection::protect(&bytes)?;
    // create_new never replaces a concurrently enrolled custodian or lost key.
    let path = root.join("recovery-key.dpapi");
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(err)?;
    file.write_all(&protected).map_err(err)?;
    file.sync_all().map_err(err)
}
fn owner_key(root: &Path, account: &str, origin: &str) -> Result<(OwnerKey, bool), String> {
    if let Some(key) = load_key(root)? {
        if key.owner_account_id != account || key.server_origin != origin {
            return Err(
                "Only this PC's enrolled recovery custodian can export its full recovery package"
                    .into(),
            );
        }
        Ok((key, false))
    } else {
        let key = recovery_crypto::random_key();
        Ok((
            OwnerKey {
                version: 1,
                owner_account_id: account.into(),
                server_origin: origin.into(),
                key: *key,
            },
            true,
        ))
    }
}
fn binding(c: &Connection) -> Result<Option<(String, String, String)>, String> {
    c.execute_batch("CREATE TABLE IF NOT EXISTS local_recovery_custodian(id INTEGER PRIMARY KEY CHECK(id=1),owner_account_id TEXT NOT NULL,server_origin TEXT NOT NULL,key_sha256 TEXT NOT NULL);").map_err(err)?;
    c.query_row(
        "SELECT owner_account_id,server_origin,key_sha256 FROM local_recovery_custodian WHERE id=1",
        [],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )
    .optional()
    .map_err(err)
}
fn bind(c: &Connection, key: &OwnerKey) -> Result<(), String> {
    let expected = (
        key.owner_account_id.clone(),
        key.server_origin.clone(),
        format!("{:x}", Sha256::digest(key.key)),
    );
    if let Some(found) = binding(c)? {
        if found != expected {
            return Err("Recovery key or custodian differs from this database's enrollment; current data unchanged".into());
        }
    } else {
        c.execute("INSERT INTO local_recovery_custodian(id,owner_account_id,server_origin,key_sha256) VALUES(1,?1,?2,?3)",rusqlite::params![expected.0,expected.1,expected.2]).map_err(err)?;
    }
    Ok(())
}
#[tauri::command]
pub fn get_local_recovery_status(
    app: AppHandle,
    expected_account_id: String,
    expected_session_token: String,
) -> Result<Value, String> {
    let c = local_db::open_local_connection(&app)?;
    guard(&c, &expected_account_id, &expected_session_token)?;
    let root = root(&app)?;
    let key = load_key(&root);
    let configured = binding(&c)?.is_some() || root.join("recovery-key.dpapi").exists();
    let locked = key.is_err();
    let (busy, can_cancel) = operation_status(&expected_account_id, &expected_session_token)?;
    Ok(
        json!({"supported":cfg!(windows),"configured":configured,"key_locked":locked,"is_custodian":key.as_ref().ok().and_then(|key|key.as_ref()).is_some_and(|key|key.owner_account_id==expected_account_id),"format_version":if root.join(".workspace-key.dpapi").exists(){2}else{1},"working_data_encrypted":cfg!(feature="working-encryption")&&root.join(".workspace-encryption.json").exists(),"retention":"manual_verified_coverage","retention_supported":true,"busy":busy,"can_cancel":can_cancel,"cancel_supported":true}),
    )
}
#[tauri::command]
pub async fn create_local_recovery_backup(
    app: AppHandle,
    expected_account_id: String,
    expected_session_token: String,
    recovery_secret: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move||{
  let secret=Zeroizing::new(recovery_secret);let c=local_db::open_local_connection(&app)?;guard(&c,&expected_account_id,&expected_session_token)?;let _slot=slot(&expected_account_id,&expected_session_token)?;
  if !cfg!(windows){return Err("Protected recovery-key storage requires Windows".into())}
  let origin=native_authorization::trusted_base().map_err(|e|e.message)?;let root=root(&app)?;let (key,enroll)=owner_key(&root,&expected_account_id,&origin)?;
  if let Some((owner,server,digest))=binding(&c)?{if owner!=key.owner_account_id||server!=key.server_origin||digest!=format!("{:x}",Sha256::digest(key.key)){return Err("Recover the enrolled Windows key before creating another backup".into())}}
  let target=tauri::api::dialog::blocking::FileDialogBuilder::new().set_title("Save encrypted LabOS recovery package outside managed storage").set_file_name("LabOS-owner-backup.labos-recovery").add_filter("LabOS encrypted recovery",&["labos-recovery"]).save_file();
  let Some(target)=target else{return Ok(json!({"cancelled":true}))};operation_guard(&c,&expected_account_id,&expected_session_token)?;
  let verified=recovery_archive::create_with_publication_guard(&c,&root,&target,&key.key,&secret,&expected_account_id,&origin,||operation_guard(&c,&expected_account_id,&expected_session_token),||{c.execute_batch("BEGIN IMMEDIATE").map_err(err)?;operation_guard(&c,&expected_account_id,&expected_session_token)?;seal_publication(&expected_account_id,&expected_session_token)})?;
  operation_guard(&c,&expected_account_id,&expected_session_token)?;
  bind(&c,&key)?;
  if enroll{save_key(&root,&key).map_err(|_|"Encrypted backup was created and verified, but Windows key enrollment failed. Keep the package and separate secret; use Recover Windows key to complete enrollment.")?;}
  crate::recovery_retention::record(&c,&target,&format!("{:x}",Sha256::digest(key.key)),&verified)?;
  c.execute_batch("COMMIT").map_err(err)?;
  Ok(json!({"cancelled":false,"verified":verified,"path":target.to_string_lossy(),"working_data_encrypted":cfg!(feature="working-encryption")&&root.join(".workspace-encryption.json").exists()}))
 }).await.map_err(err)?
}
fn retention_key(c:&Connection,root:&Path,account:&str,origin:&str)->Result<OwnerKey,String>{
 let key=load_key(root)?.ok_or("Create and verify the first owner-held backup before managing retention")?;
 let expected=(account.to_owned(),origin.to_owned(),format!("{:x}",Sha256::digest(key.key)));
 if key.owner_account_id!=account||key.server_origin!=origin||binding(c)?.as_ref()!=Some(&expected){return Err("Only the enrolled recovery custodian can manage these backup files".into())}Ok(key)
}
#[tauri::command]
pub async fn list_local_recovery_backups(app:AppHandle,expected_account_id:String,expected_session_token:String)->Result<Value,String>{
 tauri::async_runtime::spawn_blocking(move||{let c=local_db::open_local_connection(&app)?;guard(&c,&expected_account_id,&expected_session_token)?;let root=root(&app)?;let origin=native_authorization::trusted_base().map_err(|e|e.message)?;let key=retention_key(&c,&root,&expected_account_id,&origin)?;let result=crate::recovery_retention::list(&c,&expected_account_id,&origin,&format!("{:x}",Sha256::digest(key.key)))?;guard(&c,&expected_account_id,&expected_session_token)?;Ok(result)}).await.map_err(err)?
}
#[tauri::command]
pub async fn prune_local_recovery_backup(app:AppHandle,expected_account_id:String,expected_session_token:String,backup_id:String)->Result<Value,String>{
 tauri::async_runtime::spawn_blocking(move||{let mut c=local_db::open_local_connection(&app)?;guard(&c,&expected_account_id,&expected_session_token)?;let _slot=slot(&expected_account_id,&expected_session_token)?;let root=root(&app)?;let origin=native_authorization::trusted_base().map_err(|e|e.message)?;let key=retention_key(&c,&root,&expected_account_id,&origin)?;crate::recovery_retention::prune(&mut c,&backup_id,&expected_account_id,&origin,&format!("{:x}",Sha256::digest(key.key)),|conn|operation_guard(conn,&expected_account_id,&expected_session_token),|conn|{operation_guard(conn,&expected_account_id,&expected_session_token)?;seal_publication(&expected_account_id,&expected_session_token)})}).await.map_err(err)?
}
fn clear_restored_sessions(path: &Path) -> Result<(), String> {
    let mut c = Connection::open(path).map_err(err)?;
    clear_recovered_access(&mut c)
}
pub(crate) fn clear_recovered_access(c:&mut Connection)->Result<(),String>{
    let tx = c.transaction().map_err(err)?;
    let session:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='local_session')",[],|r|r.get(0)).map_err(err)?;
    if session {
        tx.execute("DELETE FROM local_session", []).map_err(err)?;
    }
    let users: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='local_users')",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;
    if users {
        let columns = tx
            .prepare("PRAGMA table_info(local_users)")
            .map_err(err)?
            .query_map([], |r| r.get::<_, String>(1))
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?;
        if columns.iter().any(|name| name == "offline_expires_at") {
            tx.execute("UPDATE local_users SET offline_expires_at=NULL", [])
                .map_err(err)?;
        }
    }
    crate::protected_credentials::clear(&tx)?;
    tx.commit().map_err(err)?;
    c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(err)?;
    Ok(())
}
// The package and separate secret authorize an isolated recovery copy, never a
// server identity or a revived offline lease. This path also works before login.
pub(crate) fn restore_separate_copy(package:&Path,parent:&Path,secret:&str,origin:&str,mut guard:impl FnMut()->Result<(),String>,publish:impl FnOnce()->Result<(),String>)->Result<Value,String>{
 let parent=parent.canonicalize().map_err(err)?;
 let staged=parent.join(format!(".labos-restore-{}",uuid::Uuid::new_v4()));fs::create_dir(&staged).map_err(err)?;
 let result=(||{
  guard()?;
  let verified=recovery_archive::verify_guarded(package,secret,Some(&staged),None,&mut guard)?;
  if verified.server_origin!=origin{return Err("Recovery package belongs to a different server origin; current work is unchanged".into())}
  clear_restored_sessions(&staged.join("labos-local.db"))?;
  let key=OwnerKey{version:1,owner_account_id:verified.owner_account_id.clone(),server_origin:verified.server_origin.clone(),key:*verified.master};
  let restored=Connection::open(staged.join("labos-local.db")).map_err(err)?;bind(&restored,&key)?;drop(restored);save_key(&staged,&key)?;
  fs::write(staged.join("recovery-info.json"),serde_json::to_vec_pretty(&json!({"format_version":1,"backup_id":verified.backup_id,"owner_account_id":verified.owner_account_id,"server_origin":verified.server_origin,"files_verified":verified.files,"sessions_cleared":true,"activation_requires_review":true})).map_err(err)?).map_err(err)?;
  guard()?;publish()?;
  let target=parent.join(format!("LabOS-recovered-{}",uuid::Uuid::new_v4()));fs::rename(&staged,&target).map_err(err)?;
  Ok(json!({"cancelled":false,"verified":verified,"path":target.to_string_lossy(),"activated":false,"sessions_cleared":true}))
 })();
 if result.is_err(){
  // Only our unique, canonical, non-reparse staging directory can be removed.
  let metadata=fs::symlink_metadata(&staged).ok();
  let safe=metadata.as_ref().is_some_and(|m|m.is_dir()&&!m.file_type().is_symlink());
  #[cfg(windows)]let safe=safe&&metadata.as_ref().is_some_and(|m|{use std::os::windows::fs::MetadataExt;m.file_attributes()&0x400==0});
  if safe&&staged.parent()==Some(parent.as_path())&&staged.canonicalize().ok().as_ref()==Some(&staged){let _=fs::remove_dir_all(&staged);}
 }
 result
}
const STANDALONE:&str="standalone-recovery";
pub(crate) fn validate_recovered_directory(root:&Path,owner:&str,origin:&str)->Result<(),String>{
 let key=load_key(root)?.ok_or("Recovered Windows key is missing")?;
 if key.owner_account_id!=owner||key.server_origin!=origin{return Err("Recovered key belongs to another account or server".into())}
 let c=Connection::open_with_flags(root.join("labos-local.db"),rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(err)?;
 let integrity:String=c.query_row("PRAGMA integrity_check",[],|r|r.get(0)).map_err(err)?;if integrity!="ok"{return Err("Recovered database failed integrity verification".into())}
 let binding:(String,String,String)=c.query_row("SELECT owner_account_id,server_origin,key_sha256 FROM local_recovery_custodian WHERE id=1",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(err)?;
 if binding!=(owner.into(),origin.into(),format!("{:x}",Sha256::digest(key.key))){return Err("Recovered database and Windows key do not match".into())}
 for(table,predicate)in[("local_session","1=1"),("local_users","offline_expires_at IS NOT NULL"),("local_protected_server_credentials","1=1")]{
  let exists:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",[table],|r|r.get(0)).map_err(err)?;
  if exists{if table=="local_users"{let columns:Vec<String>=c.prepare("PRAGMA table_info(local_users)").map_err(err)?.query_map([],|r|r.get(1)).map_err(err)?.collect::<Result<_,_>>().map_err(err)?;if !columns.iter().any(|v|v=="offline_expires_at"){continue;}}let count:i64=c.query_row(&format!("SELECT count(*) FROM {table} WHERE {predicate}"),[],|r|r.get(0)).map_err(err)?;if count>0{return Err("Recovered access was not cleared; activate only a newly verified recovery copy".into())}}
 }
 Ok(())
}
#[tauri::command]
pub fn standalone_recovery_status()->Result<Value,String>{let(busy,can_cancel)=operation_status(STANDALONE,STANDALONE)?;Ok(json!({"protocol":1,"supported":cfg!(windows),"working_key_repair_supported":cfg!(all(windows,feature="working-encryption")),"busy":busy,"can_cancel":can_cancel}))}
#[tauri::command]
pub fn cancel_standalone_recovery()->Result<bool,String>{cancel_for(STANDALONE,STANDALONE)}
#[tauri::command]
pub async fn restore_standalone_recovery_package(app:AppHandle,recovery_secret:String)->Result<Value,String>{
 tauri::async_runtime::spawn_blocking(move||{
  if !cfg!(windows){return Err("Protected recovery is currently supported on Windows only".into())}
  let secret=Zeroizing::new(recovery_secret);let _slot=slot(STANDALONE,STANDALONE)?;
  let package=tauri::api::dialog::blocking::FileDialogBuilder::new().set_title("Choose the owner-held encrypted recovery package").add_filter("LabOS encrypted recovery",&["labos-recovery"]).pick_file();let Some(package)=package else{return Ok(json!({"cancelled":true}))};
  let parent=tauri::api::dialog::blocking::FileDialogBuilder::new().set_title("Choose a separate folder for the verified recovery copy").pick_folder();let Some(parent)=parent else{return Ok(json!({"cancelled":true}))};let parent=parent.canonicalize().map_err(err)?;
  let managed=tauri::api::path::app_data_dir(&app.config()).ok_or("Missing managed directory")?;fs::create_dir_all(&managed).map_err(err)?;let managed=managed.canonicalize().map_err(err)?;
  if crate::local_resource_export::within(&parent,&managed){return Err("Choose a recovery folder outside current LabOS managed storage".into())}
  let origin=native_authorization::trusted_base().map_err(|e|e.message)?;
  let mut result=restore_separate_copy(&package,&parent,&secret,&origin,||check_cancellation(STANDALONE,STANDALONE),||seal_publication(STANDALONE,STANDALONE))?;
  let restored=PathBuf::from(result["path"].as_str().ok_or("Recovery path missing")?);let owner=result["verified"]["owner_account_id"].as_str().ok_or("Recovery custodian missing")?;
  let ticket=crate::profile_recovery::remember(&app,&restored,owner,&origin)?;result["activation_ticket"]=json!(ticket);result["working_key_available"]=json!(restored.join(".workspace-key.dpapi").exists());Ok(result)
 }).await.map_err(err)?
}
#[tauri::command]
pub async fn repair_current_workspace_key(app:AppHandle,activation_ticket:String)->Result<Value,String>{
 #[cfg(not(feature="working-encryption"))]{let _=(app,activation_ticket);return Err("Working-key repair requires an encryption-enabled desktop build".into())}
 #[cfg(feature="working-encryption")]{tauri::async_runtime::spawn_blocking(move||{
  let _slot=slot(STANDALONE,STANDALONE)?;if app.try_state::<crate::profile_recovery::ProfileLease>().is_none(){return Err("Close the other LabOS instance before repairing this workspace".into())}
  let state=app.state::<crate::profile_recovery::Tickets>();let ticket=state.0.lock().map_err(|_|"Recovery ticket unavailable")?.as_ref().filter(|ticket|ticket.id==activation_ticket).cloned().ok_or("Verify and review the owner-held recovery copy again")?;
  crate::profile_recovery::verify_ticket(&ticket,||check_cancellation(STANDALONE,STANDALONE))?;
  let owner_key=load_key(&ticket.source)?.ok_or("Verified recovery custodian is missing")?;let root=crate::profile_recovery::profile_root(&app)?;
  crate::working_store::repair_from_verified_copy(&root,&ticket.source,&ticket.owner,&ticket.origin,&format!("{:x}",Sha256::digest(owner_key.key)),||check_cancellation(STANDALONE,STANDALONE),||seal_publication(STANDALONE,STANDALONE))?;
  app.restart();Ok(json!({"restart_requested":true,"current_work_preserved":true,"sessions_cleared":true}))
 }).await.map_err(err)?}
}
#[tauri::command]
pub async fn activate_recovered_workspace(app:AppHandle,activation_ticket:String)->Result<Value,String>{
 tauri::async_runtime::spawn_blocking(move||{
  let _slot=slot(STANDALONE,STANDALONE)?;
  let state=app.state::<crate::profile_recovery::Tickets>();let ticket=state.0.lock().map_err(|_|"Recovery ticket unavailable")?.as_ref().filter(|ticket|ticket.id==activation_ticket).cloned().ok_or("Recovery review expired; verify the package again")?;
  if app.try_state::<crate::profile_recovery::ProfileLease>().is_none(){return Err("Close the other LabOS instance before activating a recovered workspace".into())}
  let root=crate::profile_recovery::profile_root(&app)?;
  crate::profile_recovery::prepare(&root,&ticket,||check_cancellation(STANDALONE,STANDALONE))?;seal_publication(STANDALONE,STANDALONE)?;
  app.restart();Ok(json!({"restart_requested":true}))
 }).await.map_err(err)?
}
#[tauri::command]
pub async fn restore_local_recovery_package(
    app: AppHandle,
    expected_account_id: String,
    expected_session_token: String,
    recovery_secret: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move||{
  let secret=Zeroizing::new(recovery_secret);let c=local_db::open_local_connection(&app)?;guard(&c,&expected_account_id,&expected_session_token)?;let _slot=slot(&expected_account_id,&expected_session_token)?;
  let package=tauri::api::dialog::blocking::FileDialogBuilder::new().set_title("Choose the owner-held encrypted recovery package").add_filter("LabOS encrypted recovery",&["labos-recovery"]).pick_file();let Some(package)=package else{return Ok(json!({"cancelled":true}))};
  let parent=tauri::api::dialog::blocking::FileDialogBuilder::new().set_title("Choose a folder for a separate verified recovery copy").pick_folder();let Some(parent)=parent else{return Ok(json!({"cancelled":true}))};let parent=parent.canonicalize().map_err(err)?;
  let managed=root(&app)?;if crate::local_resource_export::within(&parent,&managed){return Err("Restore to a separate folder outside current LabOS managed storage".into())}
  let origin=native_authorization::trusted_base().map_err(|e|e.message)?;operation_guard(&c,&expected_account_id,&expected_session_token)?;
  let staged=parent.join(format!(".labos-restore-{}",uuid::Uuid::new_v4()));fs::create_dir(&staged).map_err(err)?;
  let result=(||{
   let verified=recovery_archive::verify_guarded(&package,&secret,Some(&staged),Some((&expected_account_id,&origin)),&mut||operation_guard(&c,&expected_account_id,&expected_session_token))?;
   // A backup restores authorship and work, never an old login or offline lease.
   clear_restored_sessions(&staged.join("labos-local.db"))?;
   let key=OwnerKey{version:1,owner_account_id:verified.owner_account_id.clone(),server_origin:verified.server_origin.clone(),key:*verified.master};let restored=Connection::open(staged.join("labos-local.db")).map_err(err)?;bind(&restored,&key)?;drop(restored);save_key(&staged,&key)?;
   fs::write(staged.join("recovery-info.json"),serde_json::to_vec_pretty(&json!({"format_version":1,"backup_id":verified.backup_id,"owner_account_id":verified.owner_account_id,"server_origin":verified.server_origin,"files_verified":verified.files,"sessions_cleared":true,"activation_requires_review":true})).map_err(err)?).map_err(err)?;
   c.execute_batch("BEGIN IMMEDIATE").map_err(err)?;operation_guard(&c,&expected_account_id,&expected_session_token)?;seal_publication(&expected_account_id,&expected_session_token)?;let target=parent.join(format!("LabOS-recovered-{}",uuid::Uuid::new_v4()));fs::rename(&staged,&target).map_err(err)?;c.execute_batch("COMMIT").map_err(err)?;
   Ok(json!({"cancelled":false,"verified":verified,"path":target.to_string_lossy(),"activated":false,"sessions_cleared":true}))
  })();if result.is_err(){
   // Only the unique directory created above is eligible; never a chosen
   // parent, existing restore, source package or active database.
   if staged.parent()==Some(parent.as_path())&&staged.file_name().is_some_and(|n|n.to_string_lossy().starts_with(".labos-restore-"))&&fs::symlink_metadata(&staged).map(|m|m.is_dir()&&!m.file_type().is_symlink()).unwrap_or(false){let _=fs::remove_dir_all(&staged);}
  }result
 }).await.map_err(err)?
}
#[tauri::command]
pub async fn recover_local_recovery_key(
    app: AppHandle,
    expected_account_id: String,
    expected_session_token: String,
    recovery_secret: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let secret = Zeroizing::new(recovery_secret);
        let c = local_db::open_local_connection(&app)?;
        guard(&c, &expected_account_id, &expected_session_token)?;
        let _slot = slot(&expected_account_id, &expected_session_token)?;
        let root = root(&app)?;
        let origin = native_authorization::trusted_base().map_err(|e| e.message)?;
        let package = tauri::api::dialog::blocking::FileDialogBuilder::new()
            .set_title("Choose the owner's verified backup to recover its Windows key")
            .add_filter("LabOS encrypted recovery", &["labos-recovery"])
            .pick_file();
        let Some(package) = package else {
            return Ok(json!({"cancelled":true}));
        };
        let verified = recovery_archive::verify_guarded(
            &package,
            &secret,
            None,
            Some((&expected_account_id, &origin)),
            &mut || operation_guard(&c, &expected_account_id, &expected_session_token),
        )?;
        let key = OwnerKey {
            version: 1,
            owner_account_id: verified.owner_account_id.clone(),
            server_origin: verified.server_origin.clone(),
            key: *verified.master,
        };
        if binding(&c)?.is_none() && root.join("recovery-key.dpapi").exists() {
            let existing =
                load_key(&root)?.ok_or("Existing recovery-key ownership could not be verified")?;
            bind(&c, &existing)?;
        }
        // Binding must match before any existing key file is replaced. A backup from
        // another PC with a different key cannot take over the enrolled data set.
        operation_guard(&c, &expected_account_id, &expected_session_token)?;
        let staged = root.join(format!(".recovery-key-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&staged).map_err(err)?;
        let result = (|| {
            save_key(&staged, &key)?;
            let old = root.join("recovery-key.dpapi");
            if old.exists() {
                let old_meta = fs::symlink_metadata(&old).map_err(err)?;
                if !old_meta.is_file()
                    || old_meta.file_type().is_symlink()
                    || old_meta.len() > 16384
                {
                    return Err("Invalid old recovery-key file; it was preserved".into());
                }
                let retired = root.join(format!(
                    "recovery-key-retired-{}.dpapi",
                    uuid::Uuid::new_v4()
                ));
                let mut output = OpenOptions::new()
                    .create_new(true)
                    .write(true)
                    .open(retired)
                    .map_err(err)?;
                output
                    .write_all(&fs::read(&old).map_err(err)?)
                    .map_err(err)?;
                output.sync_all().map_err(err)?;
            }
            c.execute_batch("BEGIN IMMEDIATE").map_err(err)?;
            operation_guard(&c, &expected_account_id, &expected_session_token)?;
            bind(&c, &key)?;
            seal_publication(&expected_account_id, &expected_session_token)?;
            crate::local_resource_export::replace(&staged.join("recovery-key.dpapi"), &old)?;
            c.execute_batch("COMMIT").map_err(err)?;
            Ok(json!({"cancelled":false,"key_recovered":true,"working_data_encrypted":cfg!(feature="working-encryption")&&root.join(".workspace-encryption.json").exists()}))
        })();
        let _ = fs::remove_file(staged.join("recovery-key.dpapi"));
        let _ = fs::remove_dir(staged);
        result
    })
    .await
    .map_err(err)?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancellation_is_owned_by_one_login_and_cannot_cross_the_publication_boundary() {
        {
            let _slot = slot("owner", "session-a").unwrap();
            assert!(slot("owner", "session-b").is_err());
            assert_eq!(
                operation_status("owner", "session-a").unwrap(),
                (true, true)
            );
            assert!(!cancel_for("other", "session-a").unwrap());
            assert!(!cancel_for("owner", "session-b").unwrap());
            check_cancellation("owner", "session-a").unwrap();
            assert!(cancel_for("owner", "session-a").unwrap());
            assert!(check_cancellation("owner", "session-a").is_err());
            assert!(seal_publication("owner", "session-a").is_err());
        }
        {
            let _slot = slot("owner", "session-b").unwrap();
            seal_publication("owner", "session-b").unwrap();
            assert!(!cancel_for("owner", "session-b").unwrap());
            assert!(!cancel_for("owner", "session-a").unwrap());
            check_cancellation("owner", "session-b").unwrap();
            assert_eq!(
                operation_status("owner", "session-b").unwrap(),
                (true, false)
            );
        }
        assert_eq!(
            operation_status("owner", "session-b").unwrap(),
            (false, false)
        );
    }
    #[test]
    #[ignore = "requires an explicitly selected, quiescent isolated Preview data directory"]
    fn isolated_preview_database_files_and_original_outbox_survive_encrypted_recovery() {
        assert_eq!(
            std::env::var("LABOS_PREVIEW_RECOVERY_PROBE").as_deref(),
            Ok("1")
        );
        let source = PathBuf::from(
            std::env::var("LABOS_PREVIEW_RECOVERY_ROOT").expect("Preview directory required"),
        )
        .canonicalize()
        .unwrap();
        assert_eq!(
            source.file_name().and_then(|v| v.to_str()),
            Some("com.lab-inventory.app.preview"),
            "Only isolated Preview data may be selected"
        );
        let c = Connection::open_with_flags(
            source.join("labos-local.db"),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .unwrap();
        let owner = local_db::active_account(&c).unwrap();
        let origin = native_authorization::trusted_base().unwrap();
        let intentions = |connection: &Connection| {
            connection
                .prepare(
                    "SELECT change_id,account_id,payload_json FROM sync_outbox ORDER BY change_id",
                )
                .unwrap()
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, Option<String>>(1)?,
                        r.get::<_, String>(2)?,
                    ))
                })
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        let original = intentions(&c);
        let parent = std::env::temp_dir().canonicalize().unwrap();
        let output = parent.join(format!(
            "labos-preview-recovery-probe-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir(&output).unwrap();
        let restored = output.join("restored");
        fs::create_dir(&restored).unwrap();
        let key = recovery_crypto::random_key();
        let secret = "disposable isolated Preview recovery test secret";
        let package = output.join("probe.labos-recovery");
        let verified = recovery_archive::create(
            &c,
            &source,
            &package,
            &*key,
            secret,
            &owner,
            &origin,
            || Ok(()),
        )
        .unwrap();
        recovery_archive::verify(&package, secret, Some(&restored), Some((&owner, &origin)))
            .unwrap();
        clear_restored_sessions(&restored.join("labos-local.db")).unwrap();
        let recovered = Connection::open(restored.join("labos-local.db")).unwrap();
        assert!(
            original == intentions(&recovered),
            "Restored immutable work/authors differ"
        );
        assert!(
            original == intentions(&c),
            "Source immutable work/authors changed"
        );
        assert_eq!(
            recovered
                .query_row("SELECT count(*) FROM local_session", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            recovered
                .query_row(
                    "SELECT count(*) FROM local_users WHERE offline_expires_at IS NOT NULL",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
        eprintln!("Isolated Preview recovery verified: {} files, {} bytes, {} unchanged authored intentions; restored sessions cleared",verified.files,verified.bytes,original.len());
        drop(recovered);
        drop(c);
        assert_eq!(output.parent(), Some(parent.as_path()));
        assert!(output
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("labos-preview-recovery-probe-"));
        fs::remove_dir_all(&output).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn standalone_copy_needs_no_login_preserves_all_authors_and_rolls_back_failed_verification(){
        let parent=std::env::temp_dir().canonicalize().unwrap();let root=parent.join(format!("labos-standalone-proof-{}",uuid::Uuid::new_v4()));fs::create_dir(&root).unwrap();
        let source=root.join("source");let destination=root.join("destination");fs::create_dir(&source).unwrap();fs::create_dir(&destination).unwrap();fs::write(destination.join("existing-work"),b"keep this").unwrap();fs::write(source.join("original.bin"),b"original managed bytes").unwrap();
        let c=Connection::open(source.join("labos-local.db")).unwrap();c.execute_batch("CREATE TABLE local_session(id INTEGER);INSERT INTO local_session VALUES(1);CREATE TABLE local_users(offline_expires_at TEXT);INSERT INTO local_users VALUES('2099-01-01');CREATE TABLE sync_outbox(change_id TEXT,account_id TEXT,payload_json TEXT);INSERT INTO sync_outbox VALUES('first','author-a','first immutable intent'),('second','author-b','second immutable intent');").unwrap();
        let owner=uuid::Uuid::new_v4().to_string();let origin="http://127.0.0.1:4000/api";let key=recovery_crypto::random_key();let secret="separately held disposable recovery secret";let package=root.join("owner.labos-recovery");
        recovery_archive::create(&c,&source,&package,&*key,secret,&owner,origin,||Ok(())).unwrap();
        assert!(restore_separate_copy(&package,&destination,"wrong recovery secret",origin,||Ok(()),||Ok(())).is_err());assert_eq!(fs::read_dir(&destination).unwrap().count(),1);
        assert!(restore_separate_copy(&package,&destination,secret,"https://other.invalid/api",||Ok(()),||Ok(())).is_err());assert_eq!(fs::read_dir(&destination).unwrap().count(),1);
        let mut checks=0;assert!(restore_separate_copy(&package,&destination,secret,origin,||{checks+=1;if checks>2{Err("cancelled fixture".into())}else{Ok(())}},||Ok(())).is_err());assert_eq!(fs::read_dir(&destination).unwrap().count(),1);
        let result=restore_separate_copy(&package,&destination,secret,origin,||Ok(()),||Ok(())).unwrap();let restored=PathBuf::from(result["path"].as_str().unwrap());assert_eq!(result["activated"],false);assert_eq!(restored.parent(),Some(destination.as_path()));assert_eq!(fs::read(restored.join("original.bin")).unwrap(),b"original managed bytes");
        let recovered=Connection::open(restored.join("labos-local.db")).unwrap();let rows:Vec<(String,String)>=recovered.prepare("SELECT account_id,payload_json FROM sync_outbox ORDER BY change_id").unwrap().query_map([],|r|Ok((r.get(0)?,r.get(1)?))).unwrap().collect::<Result<_,_>>().unwrap();assert_eq!(rows,vec![("author-a".into(),"first immutable intent".into()),("author-b".into(),"second immutable intent".into())]);
        assert_eq!(recovered.query_row("SELECT count(*) FROM local_session",[],|r|r.get::<_,i64>(0)).unwrap(),0);assert_eq!(recovered.query_row("SELECT count(*) FROM local_users WHERE offline_expires_at IS NOT NULL",[],|r|r.get::<_,i64>(0)).unwrap(),0);assert_eq!(load_key(&restored).unwrap().unwrap().owner_account_id,owner);assert_eq!(fs::read(destination.join("existing-work")).unwrap(),b"keep this");assert_eq!(c.query_row("SELECT count(*) FROM sync_outbox",[],|r|r.get::<_,i64>(0)).unwrap(),2);drop(recovered);drop(c);
        assert_eq!(root.parent(),Some(parent.as_path()));assert!(root.file_name().unwrap().to_string_lossy().starts_with("labos-standalone-proof-"));fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn recovered_sessions_and_leases_are_cleared_without_changing_authored_work() {
        let path = std::env::temp_dir().join(format!(
            "labos-recovery-auth-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let c = Connection::open(&path).unwrap();
        c.execute_batch("CREATE TABLE local_session(id INTEGER);INSERT INTO local_session VALUES(1);CREATE TABLE local_users(offline_expires_at TEXT);INSERT INTO local_users VALUES('2099-01-01');CREATE TABLE sync_outbox(change_id TEXT,account_id TEXT,payload_json TEXT);INSERT INTO sync_outbox VALUES('original-change','original-author','immutable payload');CREATE TABLE local_protected_server_credentials(account_id TEXT,protected BLOB);INSERT INTO local_protected_server_credentials VALUES('original-author',x'1234');").unwrap();
        drop(c);
        clear_restored_sessions(&path).unwrap();
        let c = Connection::open(&path).unwrap();
        assert_eq!(
            c.query_row(
                "SELECT count(*) FROM local_protected_server_credentials",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        assert_eq!(
            c.query_row("SELECT count(*) FROM local_session", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert!(c
            .query_row("SELECT offline_expires_at FROM local_users", [], |r| r
                .get::<_, Option<
                String,
            >>(
                0
            ))
            .unwrap()
            .is_none());
        assert_eq!(
            c.query_row(
                "SELECT account_id||':'||payload_json FROM sync_outbox",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "original-author:immutable payload"
        );
        drop(c);
        fs::remove_file(path).unwrap();
    }
    #[test]
    fn custodian_binding_never_accepts_another_owner_origin_or_key() {
        let c = Connection::open_in_memory().unwrap();
        let key = OwnerKey {
            version: 1,
            owner_account_id: "owner".into(),
            server_origin: "origin".into(),
            key: [7; 32],
        };
        bind(&c, &key).unwrap();
        bind(&c, &key).unwrap();
        for changed in [
            OwnerKey {
                owner_account_id: "other".into(),
                server_origin: "origin".into(),
                version: 1,
                key: [7; 32],
            },
            OwnerKey {
                owner_account_id: "owner".into(),
                server_origin: "elsewhere".into(),
                version: 1,
                key: [7; 32],
            },
            OwnerKey {
                owner_account_id: "owner".into(),
                server_origin: "origin".into(),
                version: 1,
                key: [8; 32],
            },
        ] {
            assert!(bind(&c, &changed).is_err());
        }
        assert_eq!(binding(&c).unwrap().unwrap().0, "owner");
    }
}
