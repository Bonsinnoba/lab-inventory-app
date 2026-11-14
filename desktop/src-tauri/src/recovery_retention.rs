//! Explicit owner-reviewed retention. Never automatically remove a package,
//! the latest valid recovery copy, or the sole copy of an authored intention.
use rusqlite::{params, Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::Read,
    path::{Path, PathBuf},
};
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
#[serde(deny_unknown_fields)]
pub(crate) struct Intent {
    change_id: String,
    fingerprint: String,
}
fn intentions(c: &Connection, pending: bool) -> Result<Option<Vec<Intent>>, String> {
    let exists: bool = c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='sync_outbox')",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;
    if !exists {
        return Ok(Some(Vec::new()));
    }
    let columns: HashSet<String> = c
        .prepare("PRAGMA table_info(sync_outbox)")
        .map_err(err)?
        .query_map([], |r| r.get(1))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    let required = [
        "change_id",
        "account_id",
        "device_id",
        "entity_type",
        "entity_id",
        "operation",
        "payload_json",
        "synced_at",
    ];
    if required.iter().any(|key| !columns.contains(*key)) {
        let count: i64 = c
            .query_row("SELECT count(*) FROM sync_outbox", [], |r| r.get(0))
            .map_err(err)?;
        return Ok(if count == 0 { Some(Vec::new()) } else { None });
    }
    let mut statement=c.prepare(&format!("SELECT change_id,account_id,device_id,entity_type,entity_id,operation,payload_json FROM sync_outbox {} ORDER BY change_id",if pending{"WHERE synced_at IS NULL"}else{""})).map_err(err)?;
    let rows = statement
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, String>(6)?,
            ))
        })
        .map_err(err)?;
    let mut result = Vec::new();
    for row in rows {
        let row = row.map_err(err)?;
        if result.len() >= 100000 {
            return Err(
                "Recovery intention coverage exceeds its bound; no package can be pruned".into(),
            );
        }
        let fingerprint = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&row).map_err(err)?)
        );
        result.push(Intent {
            change_id: row.0,
            fingerprint,
        });
    }
    Ok(Some(result))
}
pub(crate) fn pending_intents(c: &Connection) -> Result<Option<Vec<Intent>>, String> {
    intentions(c, true)
}
pub(crate) fn schema(c: &Connection) -> Result<(), String> {
    c.execute_batch("CREATE TABLE IF NOT EXISTS local_recovery_backups(sequence INTEGER PRIMARY KEY AUTOINCREMENT,backup_id TEXT NOT NULL UNIQUE,owner_account_id TEXT NOT NULL,origin TEXT NOT NULL,key_sha256 TEXT NOT NULL,path TEXT NOT NULL,size_bytes INTEGER NOT NULL,sha256 TEXT NOT NULL,pending_json TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,retired_at TEXT,quarantine_path TEXT);").map_err(err)
}
pub(crate) fn record(
    c: &Connection,
    path: &Path,
    key_sha: &str,
    verified: &crate::recovery_archive::Verified,
) -> Result<(), String> {
    if c.is_autocommit() {
        return Err("Recovery catalogue registration requires the publication transaction".into());
    }
    schema(c)?;
    let path = path.canonicalize().map_err(err)?;
    c.execute("INSERT INTO local_recovery_backups(backup_id,owner_account_id,origin,key_sha256,path,size_bytes,sha256,pending_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![verified.backup_id,verified.owner_account_id,verified.server_origin,key_sha,path.to_string_lossy(),verified.package_size as i64,verified.package_sha256,verified.pending.as_ref().map(serde_json::to_string).transpose().map_err(err)?]).map_err(err)?;
    Ok(())
}
#[derive(Clone)]
struct Backup {
    sequence: i64,
    id: String,
    path: PathBuf,
    size: u64,
    sha: String,
    pending: Option<Vec<Intent>>,
    retired: bool,
    quarantine: Option<PathBuf>,
}
fn rows(c: &Connection, owner: &str, origin: &str, key: &str) -> Result<Vec<Backup>, String> {
    schema(c)?;
    let mut s=c.prepare("SELECT sequence,backup_id,path,size_bytes,sha256,pending_json,retired_at,quarantine_path FROM local_recovery_backups WHERE owner_account_id=?1 AND origin=?2 AND key_sha256=?3 ORDER BY sequence DESC").map_err(err)?;
    let mapped = s
        .query_map(params![owner, origin, key], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, Option<String>>(6)?,
                r.get::<_, Option<String>>(7)?,
            ))
        })
        .map_err(err)?;
    let mut result = Vec::new();
    for row in mapped {
        let (n, id, path, size, sha, proof, retired, quarantine) = row.map_err(err)?;
        if size < 0 || sha.len() != 64 {
            return Err("Recovery catalogue requires repair; no files have been removed".into());
        }
        result.push(Backup {
            sequence: n,
            id,
            path: PathBuf::from(path),
            size: size as u64,
            sha,
            pending: proof
                .map(|p| serde_json::from_str(&p))
                .transpose()
                .map_err(err)?,
            retired: retired.is_some(),
            quarantine: quarantine.map(PathBuf::from),
        });
    }
    Ok(result)
}
fn regular(path: &Path) -> Result<(), String> {
    let m = fs::symlink_metadata(path).map_err(err)?;
    if !m.is_file() || m.file_type().is_symlink() {
        return Err("Recovery package path is not a regular file".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if m.file_attributes() & 0x400 != 0 {
            return Err("Recovery package reparse points cannot be pruned".into());
        }
    }
    Ok(())
}
fn open_pinned(path: &Path) -> Result<File, String> {
    regular(path)?;
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{FILE_SHARE_DELETE, FILE_SHARE_READ};
        options.share_mode(FILE_SHARE_READ | FILE_SHARE_DELETE);
    }
    options.open(path).map_err(err)
}
fn file_identity(file: &File) -> Result<(u64, u64), String> {
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
        };
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        if unsafe { GetFileInformationByHandle(file.as_raw_handle() as isize, &mut info) } == 0 {
            return Err(err(std::io::Error::last_os_error()));
        }
        Ok((
            info.dwVolumeSerialNumber as u64,
            ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64,
        ))
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let m = file.metadata().map_err(err)?;
        Ok((m.dev(), m.ino()))
    }
}
fn same_file(path: &Path, file: &File) -> Result<(), String> {
    let current = open_pinned(path)?;
    if file_identity(&current)? != file_identity(file)? {
        return Err("Recovery package identity changed; it has not been removed".into());
    }
    Ok(())
}
fn matches_file(
    path: &Path,
    row: &Backup,
    guard: &mut dyn FnMut() -> Result<(), String>,
) -> Result<File, String> {
    let mut f = open_pinned(path)?;
    let before = f.metadata().map_err(err)?;
    if before.len() != row.size {
        return Err("Recovery package changed; it has not been pruned".into());
    }
    let mut hash = Sha256::new();
    let mut buf = vec![0; 1024 * 1024];
    loop {
        guard()?;
        let n = f.read(&mut buf).map_err(err)?;
        if n == 0 {
            break;
        }
        hash.update(&buf[..n]);
    }
    if format!("{:x}", hash.finalize()) != row.sha
        || f.metadata().map_err(err)?.modified().ok() != before.modified().ok()
    {
        return Err("Recovery package changed; it has not been pruned".into());
    }
    Ok(f)
}
pub(crate) fn list(c: &Connection, owner: &str, origin: &str, key: &str) -> Result<Value, String> {
    let entries = rows(c, owner, origin, key)?;
    let newest = entries.iter().find(|r| !r.retired).map(|r| r.sequence);
    Ok(json!(entries.into_iter().map(|r|{let path=r.quarantine.as_ref().unwrap_or(&r.path);let state=if r.retired{if path.exists(){"cleanup_pending"}else{"retired"}}else if !path.exists(){"missing"}else{"recorded"};json!({"id":r.id,"path":path.to_string_lossy(),"size_bytes":r.size,"pending_intents":r.pending.as_ref().map(Vec::len),"state":state,"latest_recorded":Some(r.sequence)==newest,"pruning_requires_verification":true})}).collect::<Vec<_>>()))
}
fn covered(c: &Connection, target: &Backup, newer: &Backup) -> Result<(), String> {
    let old = target
        .pending
        .as_ref()
        .ok_or("Legacy intention coverage is unknown; retain this package")?;
    let local = intentions(c, false)?
        .ok_or("Current intention coverage is unknown; retain this package")?;
    let mut proofs: HashSet<(&str, &str)> = local
        .iter()
        .map(|i| (i.change_id.as_str(), i.fingerprint.as_str()))
        .collect();
    if let Some(items) = &newer.pending {
        for i in items {
            proofs.insert((i.change_id.as_str(), i.fingerprint.as_str()));
        }
    }
    if old
        .iter()
        .any(|i| !proofs.contains(&(i.change_id.as_str(), i.fingerprint.as_str())))
    {
        return Err("This package may hold authored work that is not retained elsewhere; it has not been pruned".into());
    }
    Ok(())
}
pub(crate) fn prune(
    c: &mut Connection,
    id: &str,
    owner: &str,
    origin: &str,
    key: &str,
    mut guard: impl FnMut(&Connection) -> Result<(), String>,
    mut publication: impl FnMut(&Connection) -> Result<(), String>,
) -> Result<Value, String> {
    guard(c)?;
    let entries = rows(c, owner, origin, key)?;
    let target = entries
        .iter()
        .find(|r| r.id == id)
        .cloned()
        .ok_or("Only this custodian's natively registered packages can be pruned")?;
    if target.retired {
        if let Some(path) = &target.quarantine {
            if path.exists() {
                let pinned = matches_file(path, &target, &mut || guard(c))?;
                guard(c)?;
                same_file(path, &pinned)?;
                publication(c)?;
                fs::remove_file(path).map_err(err)?;
            }
        }
        return Ok(json!({"retired":true,"cleanup_pending":false}));
    }
    let pinned = matches_file(&target.path, &target, &mut || guard(c))?;
    let mut keeper = None;
    for newer in entries
        .iter()
        .filter(|r| !r.retired && r.sequence > target.sequence && r.path != target.path)
    {
        guard(c)?;
        if let Ok(file) = matches_file(&newer.path, newer, &mut || guard(c)) {
            if covered(c, &target, newer).is_ok() {
                keeper = Some((newer.clone(), file));
                break;
            }
        }
    }
    let (newer,newer_file)=keeper.ok_or("Keep at least one newer verified recovery package with retained intention coverage before pruning this one")?;
    let parent = target
        .path
        .parent()
        .ok_or("Invalid package directory")?
        .canonicalize()
        .map_err(err)?;
    let quarantine = parent.join(format!(".labos-pruned-{}.pending", uuid::Uuid::new_v4()));
    if quarantine.exists() {
        return Err("Prune destination already exists".into());
    }
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(err)?;
    guard(&tx)?;
    covered(&tx, &target, &newer)?;
    let current:i64=tx.query_row("SELECT count(*) FROM local_recovery_backups WHERE retired_at IS NULL AND ((backup_id=?1 AND path=?2 AND sha256=?3) OR (backup_id=?4 AND path=?5 AND sha256=?6))",params![target.id,target.path.to_string_lossy(),target.sha,newer.id,newer.path.to_string_lossy(),newer.sha],|r|r.get(0)).map_err(err)?;
    if current != 2 {
        return Err("Recovery catalogue changed; review retention again".into());
    }
    // Long hashing occurs before this short writer transaction. Pinned Windows
    // handles deny byte writes; identities are rechecked immediately before rename.
    same_file(&target.path, &pinned)?;
    same_file(&newer.path, &newer_file)?;
    publication(&tx)?;
    fs::rename(&target.path, &quarantine).map_err(err)?;
    let commit = (|| {
        tx.execute("UPDATE local_recovery_backups SET retired_at=CURRENT_TIMESTAMP,quarantine_path=?1 WHERE backup_id=?2 AND retired_at IS NULL",params![quarantine.to_string_lossy(),target.id]).map_err(err)?;
        tx.commit().map_err(err)
    })();
    if let Err(error) = commit {
        if !target.path.exists() {
            let _ = fs::rename(&quarantine, &target.path);
        }
        return Err(error);
    }
    let removed = fs::remove_file(&quarantine).is_ok();
    Ok(json!({"retired":true,"cleanup_pending":!removed}))
}
#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture {
        parent: PathBuf,
        source: PathBuf,
        c: Connection,
        owner: String,
        origin: String,
        key: crate::recovery_crypto::SecretKey,
        key_sha: String,
    }
    impl Fixture {
        fn new() -> Self {
            let parent = std::env::temp_dir()
                .canonicalize()
                .unwrap()
                .join(format!("labos-retention-proof-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&parent).unwrap();
            let source = parent.join("workspace");
            fs::create_dir(&source).unwrap();
            let c = Connection::open(source.join("labos-local.db")).unwrap();
            c.execute_batch("CREATE TABLE sync_outbox(change_id TEXT PRIMARY KEY,account_id TEXT,device_id TEXT,entity_type TEXT,entity_id TEXT,operation TEXT,payload_json TEXT,synced_at TEXT);INSERT INTO sync_outbox VALUES('original','author-a','device','resource','resource-a','create','immutable original payload',NULL);").unwrap();
            let key = crate::recovery_crypto::random_key();
            let key_sha = format!("{:x}", Sha256::digest(*key));
            Self {
                parent,
                source,
                c,
                owner: uuid::Uuid::new_v4().to_string(),
                origin: "http://127.0.0.1:4000/api".into(),
                key,
                key_sha,
            }
        }
        fn backup(&self, name: &str) -> (String, PathBuf) {
            let path = self.parent.join(format!("{name}.labos-recovery"));
            let verified = crate::recovery_archive::create(
                &self.c,
                &self.source,
                &path,
                &*self.key,
                "disposable native retention proof secret",
                &self.owner,
                &self.origin,
                || Ok(()),
            )
            .unwrap();
            assert_eq!(
                verified.pending.as_ref().unwrap().len(),
                self.c
                    .query_row(
                        "SELECT count(*) FROM sync_outbox WHERE synced_at IS NULL",
                        [],
                        |r| r.get::<_, i64>(0)
                    )
                    .unwrap() as usize
            );
            self.c.execute_batch("BEGIN IMMEDIATE").unwrap();
            record(&self.c, &path, &self.key_sha, &verified).unwrap();
            self.c.execute_batch("COMMIT").unwrap();
            (verified.backup_id, path)
        }
        fn prune(&mut self, id: &str) -> Result<Value, String> {
            prune(
                &mut self.c,
                id,
                &self.owner,
                &self.origin,
                &self.key_sha,
                |_| Ok(()),
                |_| Ok(()),
            )
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let tmp = std::env::temp_dir().canonicalize().unwrap();
            assert_eq!(self.parent.parent(), Some(tmp.as_path()));
            assert!(self
                .parent
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("labos-retention-proof-"));
            let old = std::mem::replace(&mut self.c, Connection::open_in_memory().unwrap());
            drop(old);
            let _ = fs::remove_dir_all(&self.parent);
        }
    }
    #[test]
    fn explicit_retention_keeps_last_backup_original_author_and_current_intentions() {
        let mut f = Fixture::new();
        let (old, path) = f.backup("old");
        assert!(f.prune(&old).is_err());
        assert!(path.exists());
        let (new, new_path) = f.backup("new");
        let result = f.prune(&old).unwrap();
        assert_eq!(result["retired"], true);
        assert!(!path.exists());
        assert!(new_path.exists());
        assert!(f.prune(&new).is_err());
        assert_eq!(
            f.c.query_row("SELECT account_id FROM sync_outbox", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "author-a"
        );
        assert_eq!(
            list(&f.c, "another-owner", &f.origin, &f.key_sha).unwrap(),
            json!([])
        );
        assert_eq!(
            list(&f.c, &f.owner, "https://other.invalid/api", &f.key_sha).unwrap(),
            json!([])
        );
    }
    #[test]
    fn sole_authored_copy_or_changed_owner_cannot_be_pruned() {
        let mut f = Fixture::new();
        let (old, path) = f.backup("old");
        f.c.execute(
            "UPDATE sync_outbox SET account_id='author-b',payload_json='different authored work'",
            [],
        )
        .unwrap();
        let (_, new_path) = f.backup("new");
        assert!(f.prune(&old).is_err());
        assert!(path.exists() && new_path.exists());
        f.c.execute("DELETE FROM sync_outbox", []).unwrap();
        assert!(f.prune(&old).is_err());
        assert!(path.exists());
    }
    #[test]
    fn package_tamper_late_session_failure_and_registry_rollback_preserve_both_copies() {
        let mut f = Fixture::new();
        let (old, path) = f.backup("old");
        let (_, new_path) = f.backup("new");
        let contents = fs::read(&new_path).unwrap();
        let mut bad = contents.clone();
        let n = bad.len() - 1;
        bad[n] ^= 1;
        fs::write(&new_path, &bad).unwrap();
        assert!(f.prune(&old).is_err());
        assert!(path.exists());
        fs::write(&new_path, contents).unwrap();
        assert!(prune(
            &mut f.c,
            &old,
            &f.owner,
            &f.origin,
            &f.key_sha,
            |_| Ok(()),
            |_| Err("session changed before publication".into())
        )
        .is_err());
        assert!(path.exists() && new_path.exists());
        f.c.execute_batch("CREATE TRIGGER reject_retention BEFORE UPDATE ON local_recovery_backups BEGIN SELECT RAISE(ABORT,'required retention rollback');END;").unwrap();
        assert!(f.prune(&old).is_err());
        assert!(path.exists() && new_path.exists());
        assert_eq!(
            f.c.query_row(
                "SELECT count(*) FROM local_recovery_backups WHERE retired_at IS NOT NULL",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
    }
    #[test]
    fn unknown_legacy_coverage_is_not_guessed_as_no_work() {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE sync_outbox(payload TEXT);INSERT INTO sync_outbox VALUES('legacy pending work');").unwrap();
        assert!(pending_intents(&c).unwrap().is_none());
    }
}
