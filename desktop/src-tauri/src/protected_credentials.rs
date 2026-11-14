//! Server JWT persistence is native, current-user DPAPI protected, and bound to
//! one account/origin/native session. Renderer claims cannot populate this table.
use crate::{local_db, native_authorization, recovery_protection};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use zeroize::{Zeroize, Zeroizing};
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Credential {
    version: u32,
    kind: String,
    account_id: String,
    origin: String,
    session_sha256: String,
    token: String,
}
impl Drop for Credential {
    fn drop(&mut self) {
        self.token.zeroize();
    }
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn digest(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
fn schema(c: &Connection) -> Result<(), String> {
    c.execute_batch("CREATE TABLE IF NOT EXISTS local_protected_server_credentials(account_id TEXT PRIMARY KEY,protected BLOB NOT NULL);").map_err(err)
}
pub(crate) fn clear(c: &Connection) -> Result<(), String> {
    let exists:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='local_protected_server_credentials')",[],|r|r.get(0)).map_err(err)?;
    if exists {
        c.execute("DELETE FROM local_protected_server_credentials", [])
            .map_err(err)?;
    }
    Ok(())
}
pub(crate) fn publish(
    c: &Connection,
    account: &str,
    session: &str,
    token: &str,
) -> Result<(), String> {
    if c.is_autocommit() {
        return Err("Protected credentials require the verified login transaction".into());
    }
    clear(c)?;
    #[cfg(windows)]
    {
        if token.is_empty() || token.len() > 16384 || token.starts_with("local:") {
            return Err("Invalid native server credential".into());
        }
        if local_db::active_account(c)? != account {
            return Err("Verified login account changed before protecting credentials".into());
        }
        let origin = native_authorization::trusted_base().map_err(|e| e.message)?;
        let credential = Credential {
            version: 1,
            kind: "labos-server-credential-v1".into(),
            account_id: account.into(),
            origin,
            session_sha256: digest(session),
            token: token.into(),
        };
        let bytes = Zeroizing::new(serde_json::to_vec(&credential).map_err(err)?);
        let protected = recovery_protection::protect(&bytes)?;
        schema(c)?;
        c.execute(
            "INSERT INTO local_protected_server_credentials(account_id,protected) VALUES(?1,?2)",
            params![account, &*protected],
        )
        .map_err(err)?;
    }
    #[cfg(not(windows))]
    {
        let _ = (account, session, token); /* No plaintext persistence fallback. */
    }
    Ok(())
}
pub(crate) fn restore(
    c: &Connection,
    account: &str,
    session: &str,
) -> Result<Option<String>, String> {
    let origin = native_authorization::trusted_base().map_err(|e| e.message)?;
    if local_db::active_account(c)? != account {
        return Err("Credential account changed".into());
    }
    let exists:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='local_protected_server_credentials')",[],|r|r.get(0)).map_err(err)?;
    if !exists {
        return Ok(None);
    }
    let encrypted: Option<Vec<u8>> = c
        .query_row(
            "SELECT protected FROM local_protected_server_credentials WHERE account_id=?1",
            [account],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    let Some(encrypted) = encrypted else {
        return Ok(None);
    };
    // Missing Windows key never invalidates otherwise authorized offline work.
    let Ok(bytes) = recovery_protection::unprotect(&encrypted) else {
        return Ok(None);
    };
    let Ok(mut credential) = serde_json::from_slice::<Credential>(&bytes) else {
        return Ok(None);
    };
    if credential.version != 1
        || credential.kind != "labos-server-credential-v1"
        || credential.account_id != account
        || credential.origin != origin
        || credential.session_sha256 != digest(session)
        || credential.token.is_empty()
        || credential.token.len() > 16384
        || credential.token.starts_with("local:")
    {
        return Ok(None);
    }
    Ok(Some(std::mem::take(&mut credential.token)))
}
#[tauri::command]
pub fn forget_local_server_credential(
    app: AppHandle,
    expected_account_id: String,
    expected_session_token: String,
) -> Result<bool, String> {
    let mut c = local_db::open_local_connection(&app)?;
    let tx = c
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(err)?;
    if crate::local_auth::local_session_guard(&tx, &expected_account_id)?.as_deref()
        != Some(expected_session_token.as_str())
    {
        return Ok(false);
    }
    clear(&tx)?;
    tx.commit().map_err(err)?;
    Ok(true)
}
#[cfg(all(test, windows))]
mod tests {
    use super::*;
    fn fixture() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE local_users(id TEXT,central_user_id TEXT,is_active INTEGER,offline_expires_at TEXT);CREATE TABLE local_session(id INTEGER,user_id TEXT,session_token TEXT);INSERT INTO local_users VALUES('u','a',1,datetime('now','+1 hour'));INSERT INTO local_session VALUES(1,'u','native-session');").unwrap();
        c
    }
    #[test]
    fn only_verified_native_transactions_publish_and_restoration_is_account_session_origin_bound() {
        let mut c = fixture();
        assert!(publish(&c, "a", "native-session", "server-secret").is_err());
        {
            let tx = c.transaction().unwrap();
            publish(&tx, "a", "native-session", "server-secret").unwrap();
            tx.commit().unwrap();
        }
        let encrypted: Vec<u8> = c
            .query_row(
                "SELECT protected FROM local_protected_server_credentials",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(!encrypted.windows(13).any(|bytes| bytes == b"server-secret"));
        assert_eq!(
            restore(&c, "a", "native-session").unwrap().as_deref(),
            Some("server-secret")
        );
        assert!(restore(&c, "a", "different-session").unwrap().is_none());
        assert!(restore(&c, "b", "native-session").is_err());
        let bytes = recovery_protection::unprotect(&encrypted).unwrap();
        let mut foreign: Credential = serde_json::from_slice(&bytes).unwrap();
        foreign.origin = "https://different-lab.example/api".into();
        let bytes = Zeroizing::new(serde_json::to_vec(&foreign).unwrap());
        let protected = recovery_protection::protect(&bytes).unwrap();
        c.execute("UPDATE local_protected_server_credentials SET protected=?1", [&*protected]).unwrap();
        assert!(restore(&c, "a", "native-session").unwrap().is_none());
        c.execute(
            "UPDATE local_protected_server_credentials SET protected=x'00'",
            [],
        )
        .unwrap();
        assert!(restore(&c, "a", "native-session").unwrap().is_none());
        clear(&c).unwrap();
        assert!(restore(&c, "a", "native-session").unwrap().is_none());
    }
}
