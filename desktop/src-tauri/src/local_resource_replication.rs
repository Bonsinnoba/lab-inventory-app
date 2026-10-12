//! Derived PC copies: no authored rows, outbox events, or server mutations.
use crate::{local_auth, local_db, local_resources, native_authorization};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
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
fn schema(c: &Connection) -> Result<(), String> {
    c.execute_batch("CREATE TABLE IF NOT EXISTS local_resource_copies(account_id TEXT NOT NULL,resource_id TEXT NOT NULL,origin TEXT NOT NULL,revision TEXT NOT NULL,sha256 TEXT NOT NULL,size_bytes INTEGER NOT NULL,mime_type TEXT NOT NULL,verified_bytes INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL DEFAULT 'copying',last_error TEXT,PRIMARY KEY(account_id,resource_id)); CREATE TABLE IF NOT EXISTS local_resource_copy_errors(account_id TEXT NOT NULL,resource_id TEXT NOT NULL,message TEXT NOT NULL,PRIMARY KEY(account_id,resource_id));").map_err(err)
}
fn authorize(
    c: &Connection,
    account: &str,
    id: &str,
    session: Option<&str>,
) -> Result<String, String> {
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
    let record = local_resources::read_resources(c)?
        .into_iter()
        .find(|r| r.id == id)
        .ok_or("Resource unavailable on this PC")?;
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
    if pending && !attachment_read {
        return Err("Resource has pending authored changes; copy deferred".into());
    }
    Ok(record.updated_at)
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
fn paths(
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
    let root = tauri::api::path::app_data_dir(&app.config())
        .ok_or("Missing data directory")?
        .join("resource-copies")
        .join(account)
        .join(id);
    Ok((
        root.join(format!("{hash}.partial")),
        root.join(format!("{hash}.content")),
    ))
}
fn hash_file(path: &Path) -> Result<String, String> {
    let mut f = fs::File::open(path).map_err(err)?;
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
#[tauri::command]
pub async fn replicate_local_resource(
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
        tx.execute("INSERT INTO local_resource_copies(account_id,resource_id,origin,revision,sha256,size_bytes,mime_type) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(account_id,resource_id) DO UPDATE SET origin=excluded.origin,revision=excluded.revision,sha256=excluded.sha256,size_bytes=excluded.size_bytes,mime_type=excluded.mime_type,verified_bytes=CASE WHEN origin=excluded.origin AND sha256=excluded.sha256 AND size_bytes=excluded.size_bytes THEN verified_bytes ELSE 0 END,state=CASE WHEN origin=excluded.origin AND sha256=excluded.sha256 AND size_bytes=excluded.size_bytes THEN state ELSE 'copying' END,last_error=NULL",params![account,id,origin,revision,m.sha256,m.size_bytes as i64,m.mime_type]).map_err(err)?;
        let (offset,state):(i64,String)=tx.query_row("SELECT verified_bytes,state FROM local_resource_copies WHERE account_id=?1 AND resource_id=?2",params![account,id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(err)?;
        if state == "ready"
            && fs::metadata(&complete)
                .map(|s| s.len() == m.size_bytes)
                .unwrap_or(false)
        {
            tx.commit().map_err(err)?;
            return status(app, account, id);
        }
        fs::create_dir_all(partial.parent().unwrap()).map_err(err)?;
        // Recover an interrupted rename/DB commit by verifying the published file.
        if complete.exists()
            && fs::metadata(&complete).map_err(err)?.len() == m.size_bytes
            && hash_file(&complete)? == m.sha256
        {
            tx.execute("UPDATE local_resource_copies SET state='ready',verified_bytes=size_bytes WHERE account_id=?1 AND resource_id=?2",params![account,id]).map_err(err)?;
            tx.commit().map_err(err)?;
            return status(app, account, id);
        }
        let mut offset = offset.max(0) as u64;
        if !partial.exists()
            || fs::metadata(&partial).map_err(err)?.len() < offset
            || offset > m.size_bytes
        {
            offset = 0;
        }
        let f = OpenOptions::new()
            .create(true)
            .write(true)
            .open(&partial)
            .map_err(err)?;
        f.set_len(offset).map_err(err)?;
        f.sync_all().map_err(err)?;
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
    let mut file = OpenOptions::new().write(true).open(&partial).map_err(err)?;
    file.seek(SeekFrom::Start(offset)).map_err(err)?;
    file.write_all(&bytes).map_err(err)?;
    file.sync_all().map_err(err)?;
    drop(file);
    let next = offset + bytes.len() as u64;
    if next == m.size_bytes {
        if hash_file(&partial)? != m.sha256 {
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

pub(crate) fn readable(
    app: &AppHandle,
    c: &Connection,
    id: &str,
) -> Result<(PathBuf, String, u64), String> {
    schema(c)?;
    let account = local_db::active_account(c)?;
    let revision = authorize(c, &account, id, None)?;
    let origin = native_authorization::trusted_base().map_err(|e| e.message)?;
    let (hash,mime,size):(String,String,i64)=c.query_row("SELECT sha256,mime_type,size_bytes FROM local_resource_copies WHERE account_id=?1 AND resource_id=?2 AND revision=?3 AND origin=?4 AND state='ready'",params![account,id,revision,origin],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(err)?;
    let (_, path) = paths(app, &account, id, &hash)?;
    if fs::metadata(&path).map_err(err)?.len() != size as u64 {
        return Err("Device file is incomplete".into());
    }
    Ok((path, mime, size as u64))
}
#[tauri::command]
pub fn local_resource_copy_status(
    app: AppHandle,
    expected_account_id: String,
) -> Result<Value, String> {
    let c = local_db::open_local_connection(&app)?;
    schema(&c)?;
    local_db::require_sync_account(&c, &expected_account_id)?;
    local_auth::require_local_permission(&c, "resources.view")?;
    let mut result = serde_json::Map::new();
    for r in local_resources::read_resources(&c)? {
        if authorize(&c, &expected_account_id, &r.id, None).is_err() {
            continue;
        }
        let row:Option<(String,i64,i64,Option<String>)>=c.query_row("SELECT state,verified_bytes,size_bytes,last_error FROM local_resource_copies WHERE account_id=?1 AND resource_id=?2",params![expected_account_id,r.id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(err)?;
        let last_error:Option<String>=c.query_row("SELECT message FROM local_resource_copy_errors WHERE account_id=?1 AND resource_id=?2",params![expected_account_id,r.id],|r|r.get(0)).optional().map_err(err)?;
        if let Some((state, bytes, size, error)) = row {
            let available = readable(&app, &c, &r.id).is_ok();
            result.insert(r.id,json!({"state":if state=="ready"&&!available{"needs_verification"}else{state.as_str()},"verified_bytes":bytes,"size_bytes":size,"error":last_error.or(error)}));
        } else if let Some(message) = last_error {
            result.insert(
                r.id,
                json!({"state":"incomplete","verified_bytes":0,"size_bytes":null,"error":message}),
            );
        }
    }
    Ok(Value::Object(result))
}

#[cfg(test)]
mod tests {
    use super::*;
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
