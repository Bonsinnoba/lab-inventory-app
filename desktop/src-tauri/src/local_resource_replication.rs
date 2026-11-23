//! Derived PC copies: no authored rows, outbox events, or server mutations.
use crate::{local_auth, local_db, local_resources, native_authorization};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self},
    io::{Read},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};
use tauri::AppHandle;

const CHUNK: u64 = 4 * 1024 * 1024;
static COPYING: AtomicBool = AtomicBool::new(false);
struct CopyGuard;
impl Drop for CopyGuard {
    fn drop(&mut self) {
        COPYING.store(false, Ordering::Release);
    }
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
pub(crate) fn schema(c: &Connection) -> Result<(), String> {
    c.execute_batch("CREATE TABLE IF NOT EXISTS local_resource_copies(account_id TEXT NOT NULL,resource_id TEXT NOT NULL,origin TEXT NOT NULL,revision TEXT NOT NULL,sha256 TEXT NOT NULL,size_bytes INTEGER NOT NULL,mime_type TEXT NOT NULL,verified_bytes INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL DEFAULT 'copying',last_error TEXT,PRIMARY KEY(account_id,resource_id)); CREATE TABLE IF NOT EXISTS local_resource_copy_errors(account_id TEXT NOT NULL,resource_id TEXT NOT NULL,message TEXT NOT NULL,PRIMARY KEY(account_id,resource_id));").map_err(err)
}
fn authorize(c:&Connection,account:&str,id:&str,session:Option<&str>)->Result<String,String>{
    local_db::require_sync_account(c,account)?;local_auth::require_local_permission(c,"resources.view")?;
    let record=local_resources::read_resources(c)?.into_iter().find(|r|r.id==id).ok_or("Resource unavailable on this PC")?;
    authorize_record(c,account,&record,session)
}
// Bulk status reads provide a record from the SAME SQLite read transaction.
// Keep every permission/denial/pending-work check without reparsing the entire
// JSON collection for each resource.
fn authorize_record(c:&Connection,account:&str,record:&local_resources::LocalResource,session:Option<&str>)->Result<String,String>{
    let id=record.id.as_str();
    local_db::require_sync_account(c, account)?;
    local_auth::require_local_permission(c, "resources.view")?;
    if let Some(expected) = session {
        let token: String = c
            .query_row(
                "SELECT session_token FROM local_session WHERE id=1",
                [],
                |r| r.get(0),
            )
            .map_err(err)?;
        if token != expected {
            return Err("File copy session changed".into());
        }
    }
    let denied:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM local_resource_poster_denials WHERE account_id=?1 AND resource_id=?2)",params![account,id],|r|r.get(0)).map_err(err)?;
    if denied {
        return Err("Resource access revoked".into());
    }
    let moving=crate::local_resource_tree_moves::require_pending_read(c,id)?;
    if moving&&session.is_some(){return Err("File replication waits for the reviewed move confirmation; verified bytes remain readable".into())}
    let pending:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM sync_outbox WHERE account_id=?1 AND entity_type='resource' AND entity_id=?2 AND synced_at IS NULL)",params![account,id],|r|r.get(0)).map_err(err)?;
    // A locally authorized attachment-only intent does not change file bytes.
    // Keep already verified content readable, but defer network replication
    // until the move has been accepted. Other pending mutations still block.
    let attachment_read = if pending && session.is_none() {
        let mut stmt=c.prepare("SELECT operation,payload_json FROM sync_outbox WHERE account_id=?1 AND entity_type='resource' AND entity_id=?2 AND synced_at IS NULL").map_err(err)?;
        let rows=stmt.query_map(params![account,id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).map_err(err)?;
        let mut only_attachments=true;
        for row in rows {
            let (operation,payload)=row.map_err(err)?;
            let payload:Value=serde_json::from_str(&payload).map_err(err)?;
            only_attachments &= operation=="attach" && payload["id"]==id && payload["attachment"]["protocol"]==1
                && payload["attachment"]["expected_updated_at"]==record.updated_at;
        }
        only_attachments
    } else { false };
    if pending && !attachment_read && !moving {
        return Err("Resource has pending authored changes; copy deferred".into());
    }
    Ok(record.updated_at.clone())
}
#[derive(Deserialize)]
struct Manifest {
    protocol: u32,
    resource_id: String,
    size_bytes: u64,
    sha256: String,
    etag: String,
    mime_type: String,
    chunk_bytes: u64,
}
fn validate(m: &Manifest, id: &str) -> Result<(), String> {
    if m.protocol != 1
        || m.resource_id != id
        || m.size_bytes > i64::MAX as u64
        || m.chunk_bytes != CHUNK
        || !digest_valid(&m.sha256)
        || m.etag != format!("\"sha256-{}\"", m.sha256)
        || m.mime_type.len() > 255
        || m.mime_type.chars().any(|c| c.is_control())
    {
        return Err("Invalid resource binary manifest".into());
    }
    Ok(())
}
fn digest_valid(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
pub(crate) fn paths(
    app: &AppHandle,
    account: &str,
    id: &str,
    hash: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let account = uuid::Uuid::parse_str(account).map_err(err)?.to_string();
    let id = uuid::Uuid::parse_str(id).map_err(err)?.to_string();
    if !digest_valid(hash) {
        return Err("Invalid file digest".into());
    }
    let directory=tauri::api::path::app_data_dir(&app.config()).ok_or("Missing data directory")?;
    let root = crate::working_store::canonical_key_root(&directory)?
        .join("resource-copies")
        .join(account)
        .join(id);
    Ok((
        root.join(format!("{hash}.partial")),
        root.join(format!("{hash}.content")),
    ))
}
pub(crate) fn hash_file(path: &Path) -> Result<String, String> {
    let mut f = crate::working_store::open(path).map_err(err)?;
    let mut h = Sha256::new();
    let mut b = vec![0; 1024 * 1024];
    loop {
        let n = f.read(&mut b).map_err(err)?;
        if n == 0 {
            break;
        }
        h.update(&b[..n]);
    }
    Ok(format!("{:x}", h.finalize()))
}
async fn bounded(mut response: reqwest::Response, max: usize) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(err)? {
        if bytes.len() + chunk.len() > max {
            return Err("Binary response exceeded size limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
async fn checked_response(
    response: reqwest::Response,
    expected: u16,
) -> Result<reqwest::Response, String> {
    let status = response.status().as_u16();
    if status == 401 {
        let body: Value =
            serde_json::from_slice(&bounded(response, 65536).await?).unwrap_or_default();
        if matches!(
            body["error"]["code"].as_str(),
            Some("SESSION_REVOKED" | "ACCOUNT_DISABLED")
        ) {
            return Err("AUTH_REVOKED: Cached access was revoked. Sign in again online.".into());
        }
        return Err("Online session expired; reconnect to copy files".into());
    }
    if status != expected {
        return Err(format!("Resource copy unavailable (HTTP {status})"));
    }
    Ok(response)
}
fn status(app: &AppHandle, account: &str, id: &str) -> Result<Value, String> {
    let c = local_db::open_local_connection(app)?;
    schema(&c)?;
    c.query_row("SELECT state,verified_bytes,size_bytes,last_error FROM local_resource_copies WHERE account_id=?1 AND resource_id=?2",params![account,id],|r|Ok(json!({"state":r.get::<_,String>(0)?,"verified_bytes":r.get::<_,i64>(1)?,"size_bytes":r.get::<_,i64>(2)?,"error":r.get::<_,Option<String>>(3)?}))).map_err(err)
}
fn deny(app: &AppHandle, account: &str, id: &str, session: &str) -> Result<(), String> {
    let c = local_db::open_local_connection(app)?;
    authorize(&c, account, id, Some(session))?;
    c.execute(
        "INSERT OR IGNORE INTO local_resource_poster_denials(account_id,resource_id) VALUES(?1,?2)",
        params![account, id],
    )
    .map_err(err)?;
    Ok(())
}

// One bounded chunk per invocation; the coordinator rotates through resources.
// All URLs and the server identity check are native-controlled, not manifest URLs.
// Network waits and synchronous reconciliation/hash work share one bounded copy
// owner on a blocking worker, leaving the async executor available to UI reads.
#[tauri::command]
pub async fn replicate_local_resource(app:AppHandle,expected_account_id:String,expected_session_token:String,resource_id:String,server_token:String)->Result<Value,String>{
    tauri::async_runtime::spawn_blocking(move || tauri::async_runtime::block_on(replicate_owned(app,expected_account_id,expected_session_token,resource_id,server_token))).await.map_err(err)?
}
async fn replicate_owned(
    app: AppHandle,
    expected_account_id: String,
    expected_session_token: String,
    resource_id: String,
    server_token: String,
) -> Result<Value, String> {
    if COPYING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("File copy worker busy".into());
    }
    let _busy = CopyGuard;
    {let mut c=local_db::open_local_connection(&app)?;crate::local_resource_storage::reconcile(&app,&mut c,&expected_account_id,&expected_session_token,false)?;}
    uuid::Uuid::parse_str(&resource_id).map_err(err)?;
    let outcome = copy_chunk(
        &app,
        &expected_account_id,
        &expected_session_token,
        &resource_id,
        &server_token,
    )
    .await;
    if let Ok(c) = local_db::open_local_connection(&app) {
        if authorize(
            &c,
            &expected_account_id,
            &resource_id,
            Some(&expected_session_token),
        )
        .is_ok()
        {
            match &outcome {
                Err(message) => {
                    let _=c.execute("INSERT INTO local_resource_copy_errors(account_id,resource_id,message) VALUES(?1,?2,?3) ON CONFLICT(account_id,resource_id) DO UPDATE SET message=excluded.message",params![expected_account_id,resource_id,message]);
                }
                Ok(_) => {
                    let _=c.execute("DELETE FROM local_resource_copy_errors WHERE account_id=?1 AND resource_id=?2",params![expected_account_id,resource_id]);
                }
            }
        }
    }
    outcome
}
async fn copy_chunk(
    app: &AppHandle,
    account: &str,
    session: &str,
    id: &str,
    token: &str,
) -> Result<Value, String> {
    let revision = {
        let c = local_db::open_local_connection(app)?;
        schema(&c)?;
        authorize(&c, account, id, Some(session))?
    };
    let permissions = native_authorization::permissions(token, account)
        .await
        .map_err(|e| format!("{}: {}", e.code, e.message))?;
    if !permissions
        .permissions
        .iter()
        .any(|p| p == "resources.view")
    {
        deny(app, account, id, session)?;
        return Err("Resource permission revoked".into());
    }
    let origin = native_authorization::trusted_base().map_err(|e| e.message)?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(err)?;
    let response = client
        .get(format!("{origin}/resources/{id}/binary-manifest"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(err)?;
    if response.status().as_u16() == 403 {
        deny(app, account, id, session)?;
        return Err("Resource copy access denied".into());
    }
    let response = checked_response(response, 200).await?;
    let m: Manifest = serde_json::from_slice(&bounded(response, 65536).await?).map_err(err)?;
    validate(&m, id)?;
    let (partial, complete) = paths(app, account, id, &m.sha256)?;
    let offset = {
        let mut c = local_db::open_local_connection(app)?;
        let tx = c
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(err)?;
        if authorize(&tx, account, id, Some(session))? != revision {
            return Err("Resource changed while copying".into());
        }
        crate::local_resource_storage::reserve(&tx,account,id,&origin,&m.sha256,m.size_bytes)?;
        tx.execute("INSERT INTO local_resource_copies(account_id,resource_id,origin,revision,sha256,size_bytes,mime_type) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(account_id,resource_id) DO UPDATE SET origin=excluded.origin,revision=excluded.revision,sha256=excluded.sha256,size_bytes=excluded.size_bytes,mime_type=excluded.mime_type,verified_bytes=CASE WHEN origin=excluded.origin AND sha256=excluded.sha256 AND size_bytes=excluded.size_bytes THEN verified_bytes ELSE 0 END,state=CASE WHEN origin=excluded.origin AND sha256=excluded.sha256 AND size_bytes=excluded.size_bytes THEN state ELSE 'copying' END,last_error=NULL",params![account,id,origin,revision,m.sha256,m.size_bytes as i64,m.mime_type]).map_err(err)?;
        let (offset,state):(i64,String)=tx.query_row("SELECT verified_bytes,state FROM local_resource_copies WHERE account_id=?1 AND resource_id=?2",params![account,id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(err)?;
        if state == "ready"
            && crate::working_store::len(&complete)
                .map(|size| size == m.size_bytes)
                .unwrap_or(false)
        {
            tx.commit().map_err(err)?;
            return status(app, account, id);
        }
        fs::create_dir_all(partial.parent().unwrap()).map_err(err)?;
        // Recover an interrupted rename/DB commit by verifying the published file.
        if complete.exists()
            && crate::working_store::len(&complete).map_err(err)? == m.size_bytes
            && hash_file(&complete)? == m.sha256
        {
            tx.execute("UPDATE local_resource_copies SET state='ready',verified_bytes=size_bytes WHERE account_id=?1 AND resource_id=?2",params![account,id]).map_err(err)?;
            tx.commit().map_err(err)?;
            return status(app, account, id);
        }
        let mut offset = offset.max(0) as u64;
        if !partial.exists()
            || crate::working_store::staged_len(&partial).map_err(err)? < offset
            || offset > m.size_bytes
        {
            offset = 0;
        }
        crate::working_store::reset_copy_staging(&partial,m.size_bytes,offset).map_err(err)?;
        tx.execute("UPDATE local_resource_copies SET state='copying',verified_bytes=?3 WHERE account_id=?1 AND resource_id=?2",params![account,id,offset as i64]).map_err(err)?;
        tx.commit().map_err(err)?;
        offset
    };
    let bytes = if offset < m.size_bytes {
        let end = (offset + CHUNK).min(m.size_bytes) - 1;
        let response = client
            .get(format!("{origin}/resources/{id}/binary"))
            .bearer_auth(token)
            .header("If-Match", &m.etag)
            .header("Range", format!("bytes={offset}-{end}"))
            .send()
            .await
            .map_err(err)?;
        if response.status().as_u16() == 403 {
            deny(app, account, id, session)?;
            return Err("Resource copy access denied".into());
        }
        let response = checked_response(response, 206).await?;
        let headers = response.headers();
        let digest = headers
            .get("X-Chunk-SHA256")
            .and_then(|h| h.to_str().ok())
            .unwrap_or("")
            .to_string();
        if headers.get("ETag").and_then(|h| h.to_str().ok()) != Some(m.etag.as_str())
            || headers.get("Content-Range").and_then(|h| h.to_str().ok())
                != Some(format!("bytes {offset}-{end}/{}", m.size_bytes).as_str())
            || headers
                .get("Content-Length")
                .and_then(|h| h.to_str().ok())
                .and_then(|s| s.parse::<u64>().ok())
                != Some(end - offset + 1)
        {
            return Err("Binary chunk revision or range mismatch".into());
        }
        let bytes = bounded(response, (end - offset + 1) as usize).await?;
        if bytes.len() as u64 != end - offset + 1
            || format!("{:x}", Sha256::digest(&bytes)) != digest
        {
            return Err("Binary chunk checksum mismatch".into());
        }
        bytes
    } else {
        Vec::new()
    };
    let mut c = local_db::open_local_connection(app)?;
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(err)?;
    if authorize(&tx, account, id, Some(session))? != revision {
        return Err("Resource changed while copying".into());
    }
    crate::working_store::append(&partial,m.size_bytes,offset,&bytes).map_err(err)?;
    let next = offset + bytes.len() as u64;
    if next == m.size_bytes {
        if hash_file(&partial).map(|hash|hash != m.sha256).unwrap_or(true) {
            tx.execute("UPDATE local_resource_copies SET verified_bytes=0,last_error='Whole-file checksum mismatch' WHERE account_id=?1 AND resource_id=?2",params![account,id]).map_err(err)?;
            tx.commit().map_err(err)?;
            return Err("Whole-file checksum mismatch; restarting copy".into());
        }
        // Do not overwrite an existing published copy, including corrupt files.
        if complete.exists() {
            return Err("Existing device copy failed verification; recovery required".into());
        }
        fs::rename(&partial, &complete).map_err(err)?;
    }
    tx.execute("UPDATE local_resource_copies SET verified_bytes=?3,state=?4,last_error=NULL WHERE account_id=?1 AND resource_id=?2",params![account,id,next as i64,if next==m.size_bytes{"ready"}else{"copying"}]).map_err(err)?;
    tx.commit().map_err(err)?;
    status(app, account, id)
}

pub(crate) fn readable(app:&AppHandle,c:&Connection,id:&str)->Result<(PathBuf,String,u64),String>{
    schema(c)?;let account=local_db::active_account(c)?;readable_impl(app,c,&account,id,None)
}
pub(crate) fn readable_record(app:&AppHandle,c:&Connection,account:&str,record:&local_resources::LocalResource)->Result<(PathBuf,String,u64),String>{
    readable_impl(app,c,account,&record.id,Some(record))
}
fn readable_impl(app:&AppHandle,c:&Connection,account:&str,id:&str,snapshot:Option<&local_resources::LocalResource>)->Result<(PathBuf,String,u64),String>{
    let revision=match snapshot{Some(record)=>authorize_record(c,account,record,None)?,None=>authorize(c,account,id,None)?};
    let origin=native_authorization::trusted_base().map_err(|e|e.message)?;
    let (hash,mime,size,copy_revision):(String,String,i64,String)=c.query_row("SELECT sha256,mime_type,size_bytes,revision FROM local_resource_copies WHERE account_id=?1 AND resource_id=?2 AND origin=?3 AND state='ready'",params![account,id,origin],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(err)?;
    let record=match snapshot{Some(record)=>record.clone(),None=>local_resources::read_resources(c)?.into_iter().find(|r|r.id==id).ok_or("Resource unavailable")?};
    if record.updated_at!=revision||!crate::local_resource_authority::verified_copy_revision(c,&record,&copy_revision)?{return Err("Device copy revision is not verified".into())}
    let (_,path)=paths(app,account,id,&hash)?;
    if crate::working_store::len(&path).map_err(err)?!=size as u64{return Err("Device file is incomplete".into())}
    Ok((path,mime,size as u64))
}

struct CopyStatusScan {
    connection: Connection,
    records: std::iter::Peekable<std::vec::IntoIter<local_resources::LocalResource>>,
    origin: String,
    result: serde_json::Map<String,Value>,
}
#[tauri::command]
pub async fn local_resource_copy_status(app:AppHandle,expected_account_id:String)->Result<Value,String>{
    crate::resource_scan::run("local_resource_copy_status",||async move{
        let handle=app.clone();let account=expected_account_id.clone();
        let mut scan=crate::responsive_reads::run("local_resource_copy_status",move||{
            let connection=local_db::open_local_connection(&handle)?;schema(&connection)?;
            local_db::require_sync_account(&connection,&account)?;local_auth::require_local_permission(&connection,"resources.view")?;
            let origin=native_authorization::trusted_base().map_err(|e|e.message)?;
            connection.execute_batch("BEGIN DEFERRED").map_err(err)?;
            let candidates=status_candidate_ids(&connection,&account)?;
            let records=if candidates.is_empty(){Vec::new()}else{local_resources::read_resources(&connection)?.into_iter().filter(|r|candidates.contains(&r.id)).collect()};
            Ok(CopyStatusScan{connection,records:records.into_iter().peekable(),origin,result:serde_json::Map::new()})
        }).await?;
        loop{
            let handle=app.clone();let account=expected_account_id.clone();
            let (next,done)=crate::responsive_reads::run("local_resource_copy_status",move||{
                let mut scan=scan;let c=&scan.connection;let result=&mut scan.result;let origin=&scan.origin;
                let done=crate::resource_scan::batch(&mut scan.records,|record|{
                    if let Some((id,value))=copy_status_record(c,&account,origin,&record,&mut |r|readable_record(&handle,c,&account,r).is_ok())?{result.insert(id,value);}Ok(())
                })?;
                if done{c.execute_batch("COMMIT").map_err(err)?;local_db::require_sync_account(c,&account)?;local_auth::require_local_permission(c,"resources.view")?;}
                Ok((scan,done))
            }).await?;
            scan=next;if done{return Ok(Value::Object(scan.result))}
        }
    }).await
}
fn status_candidate_ids(c:&Connection,account:&str)->Result<std::collections::HashSet<String>,String>{
    let mut statement=c.prepare("SELECT resource_id FROM local_resource_copies WHERE account_id=?1 UNION SELECT resource_id FROM local_resource_copy_errors WHERE account_id=?1").map_err(err)?;
    let rows=statement.query_map([account],|row|row.get::<_,String>(0)).map_err(err)?;
    rows.collect::<Result<_,_>>().map_err(err)
}
fn copy_status_record(c:&Connection,account:&str,origin:&str,r:&local_resources::LocalResource,available:&mut impl FnMut(&local_resources::LocalResource)->bool)->Result<Option<(String,Value)>,String>{
    if authorize_record(c,account,r,None).is_err(){return Ok(None)}
    let row:Option<(String,i64,i64,Option<String>,String,String)>=c.query_row("SELECT state,verified_bytes,size_bytes,last_error,revision,origin FROM local_resource_copies WHERE account_id=?1 AND resource_id=?2",params![account,r.id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?))).optional().map_err(err)?;
    let last_error:Option<String>=c.query_row("SELECT message FROM local_resource_copy_errors WHERE account_id=?1 AND resource_id=?2",params![account,r.id],|r|r.get(0)).optional().map_err(err)?;
    if let Some((state,bytes,size,error,revision,copy_origin))=row{
        let identity_current=copy_origin==origin&&crate::local_resource_authority::verified_copy_revision(c,r,&revision)?;
        let available=identity_current&&state=="ready"&&available(r);
        Ok(Some((r.id.clone(),json!({"state":copy_display_state(&state,identity_current,available),"verified_bytes":if identity_current{bytes}else{0},"size_bytes":if identity_current{Some(size)}else{None},"error":last_error.or(error)}))))
    }else{Ok(last_error.map(|message|(r.id.clone(),json!({"state":"incomplete","verified_bytes":0,"size_bytes":null,"error":message}))))}
}
#[cfg(test)]
fn copy_status_snapshot(c:&Connection,expected_account_id:&str,origin:&str,mut available:impl FnMut(&local_resources::LocalResource)->bool)->Result<Value,String>{
    local_db::require_sync_account(c,expected_account_id)?;local_auth::require_local_permission(c,"resources.view")?;
    let candidates=status_candidate_ids(c,expected_account_id)?;let mut result=serde_json::Map::new();
    if !candidates.is_empty(){for r in local_resources::read_resources(c)?{if candidates.contains(&r.id){if let Some((id,value))=copy_status_record(c,expected_account_id,origin,&r,&mut available)?{result.insert(id,value);}}}}
    local_db::require_sync_account(c,expected_account_id)?;Ok(Value::Object(result))
}

fn copy_display_state(state: &str, identity_current: bool, available: bool) -> &str {
    if !identity_current { "stale" }
    else if state == "ready" && !available { "needs_verification" }
    else { state }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn large_error_status_snapshot_reads_metadata_once_and_keeps_authority_checks(){
        let mut c=Connection::open_in_memory().unwrap();local_db::ensure_schema(&c).unwrap();schema(&c).unwrap();crate::local_resource_posters::schema(&c).unwrap();
        c.execute_batch("CREATE TABLE local_users(id TEXT PRIMARY KEY,central_user_id TEXT,role TEXT,is_active INTEGER,offline_expires_at TEXT,permissions_json TEXT);CREATE TABLE local_session(id INTEGER PRIMARY KEY,user_id TEXT,session_token TEXT);INSERT INTO local_users VALUES('local','owner','admin',1,datetime('now','+1 hour'),'[\"resources.view\"]');INSERT INTO local_session VALUES(1,'local','session');").unwrap();
        let resources:Vec<local_resources::LocalResource>=(0..2000).map(|i|serde_json::from_value(json!({"id":uuid::Uuid::new_v4().to_string(),"name":format!("Synthetic {i}"),"kind":"file","file_type":"text","tags":[],"created_at":"2026-11-13T00:00:00Z","updated_at":"2026-11-13T00:00:00Z"})).unwrap()).collect();
        local_resources::write_resources(&c,&resources).unwrap();
        {let tx=c.transaction().unwrap();for resource in &resources{tx.execute("INSERT INTO local_resource_copy_errors VALUES('owner',?1,'Owned copy failure')",[&resource.id]).unwrap();tx.execute("INSERT INTO local_resource_copy_errors VALUES('foreign',?1,'Foreign private failure')",[&resource.id]).unwrap();}tx.commit().unwrap();}
        c.execute("INSERT INTO local_resource_poster_denials VALUES('owner',?1)",[&resources[0].id]).unwrap();
        let device:String=c.query_row("SELECT device_id FROM device_identity",[],|r|r.get(0)).unwrap();
        c.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,'resource',?3,'edit_metadata','{}')",params![uuid::Uuid::new_v4().to_string(),device,resources[1].id]).unwrap();
        local_resources::reset_snapshot_reads();let started=std::time::Instant::now();
        let tx=c.transaction().unwrap();let result=copy_status_snapshot(&tx,"owner","http://fixture/api",|_|panic!("Error-only rows must not inspect or expose file bytes")).unwrap();tx.commit().unwrap();
        let scan_ms=started.elapsed().as_millis();
        assert_eq!(local_resources::snapshot_reads(),1,"One collection read must serve the entire batch");
        assert_eq!(result.as_object().unwrap().len(),1998);assert!(result.get(&resources[0].id).is_none());assert!(result.get(&resources[1].id).is_none());
        assert!(result.as_object().unwrap().values().all(|row|row["state"]=="incomplete"&&row["verified_bytes"]==0&&row["size_bytes"].is_null()&&row["error"]=="Owned copy failure"));
        assert!(!result.to_string().contains("Foreign private"));assert!(copy_status_snapshot(&c,"foreign","http://fixture/api",|_|false).is_err());
        println!("2000 error-row status scan: {scan_ms} ms; one metadata parse; denied/pending/foreign rows protected");
    }
    #[test]
    fn copy_presentation_requires_current_identity_and_readable_file() {
        assert_eq!(copy_display_state("ready", true, true), "ready");
        assert_eq!(copy_display_state("ready", true, false), "needs_verification");
        assert_eq!(copy_display_state("copying", true, false), "copying");
        for state in ["ready", "copying", "incomplete"] {
            assert_eq!(copy_display_state(state, false, true), "stale");
            assert_eq!(copy_display_state(state, false, false), "stale");
        }
    }
    #[test]
    fn manifest_rejects_identity_digest_size_and_header_injection() {
        let mut m = Manifest {
            protocol: 1,
            resource_id: "id".into(),
            size_bytes: 0,
            sha256: "a".repeat(64),
            etag: format!("\"sha256-{}\"", "a".repeat(64)),
            mime_type: "video/mp4".into(),
            chunk_bytes: CHUNK,
        };
        assert!(validate(&m, "id").is_ok());
        assert!(validate(&m, "other").is_err());
        m.mime_type = "video/mp4\r\nX-Evil: yes".into();
        assert!(validate(&m, "id").is_err());
        m.mime_type = "video/mp4".into();
        m.size_bytes = u64::MAX;
        assert!(validate(&m, "id").is_err());
        assert!(!digest_valid(&"../".repeat(22)));
    }
}
