//! Restart-bound workspace activation. A verified candidate is copied first;
//! the previous workspace is archived intact and is never deleted here.
use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit,
};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;
use zeroize::Zeroizing;
const MAX_FILES: usize = 100000;
const MAX_BYTES: u64 = 50 * 1024 * 1024 * 1024;
const MAX_PLAN: usize = 32 * 1024 * 1024;
const MAGIC: &[u8; 16] = b"LABOS-ACTIVATE1\0";
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
#[serde(deny_unknown_fields)]
struct Entry {
    size: u64,
    sha256: String,
}
type Inventory = BTreeMap<String, Entry>;
#[derive(Clone)]
pub(crate) struct Ticket {
    pub id: String,
    pub source: PathBuf,
    files: Inventory,
    pub owner: String,
    pub origin: String,
}
#[derive(Default)]
pub(crate) struct Tickets(pub Mutex<Option<Ticket>>);
pub(crate) struct ProfileLease {
    _file: File,
}
pub(crate) fn profile_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    profile_root_config(&app.config())
}
pub(crate) fn profile_root_config(config: &tauri::Config) -> Result<PathBuf, String> {
    let configured =
        tauri::api::path::app_data_dir(config).ok_or("Missing application directory")?;
    let parent = configured.parent().ok_or("Missing application parent")?;
    fs::create_dir_all(parent).map_err(err)?;
    let root = parent
        .canonicalize()
        .map_err(err)?
        .join(configured.file_name().ok_or("Missing workspace name")?);
    if root.exists() {
        reject_link(&root)?;
    }
    Ok(root)
}
fn reject_link(path: &Path) -> Result<(), String> {
    let m = fs::symlink_metadata(path).map_err(err)?;
    if m.file_type().is_symlink() {
        return Err("Workspace reparse paths are not permitted".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if m.file_attributes() & 0x400 != 0 {
            return Err("Workspace reparse paths are not permitted".into());
        }
    }
    Ok(())
}
fn identity(root: &Path) -> String {
    format!(
        "{:x}",
        Sha256::digest(root.to_string_lossy().to_lowercase().as_bytes())
    )
}
fn plan_path(root: &Path) -> Result<PathBuf, String> {
    Ok(root
        .parent()
        .ok_or("Missing workspace parent")?
        .join(format!(".labos-activation-{}.sealed", identity(root))))
}
pub(crate) fn acquire(root: &Path) -> Result<ProfileLease, String> {
    let path = root
        .parent()
        .ok_or("Missing workspace parent")?
        .join(format!(".labos-workspace-{}.lock", identity(root)));
    if path.exists() {
        reject_link(&path)?;
    }
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
    loop {
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.share_mode(0);
        }
        match options.open(&path) {
            Ok(file) => return Ok(ProfileLease { _file: file }),
            Err(e) => {
                if matches!(e.raw_os_error(), Some(32 | 33)) && std::time::Instant::now() < deadline
                {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    continue;
                }
                return Err("Workspace is already open or its exclusive lock is unavailable; existing work is unchanged".into());
            }
        }
    }
}
fn hash(path: &Path, guard: &mut dyn FnMut() -> Result<(), String>) -> Result<Entry, String> {
    reject_link(path)?;
    let mut file = File::open(path).map_err(err)?;
    let before = file.metadata().map_err(err)?;
    let mut hash = Sha256::new();
    let mut bytes = 0u64;
    let mut buffer = Zeroizing::new(vec![0; 1024 * 1024]);
    loop {
        guard()?;
        let n = file.read(&mut buffer).map_err(err)?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
        bytes = bytes.checked_add(n as u64).ok_or("File length overflow")?;
        if bytes > MAX_BYTES {
            return Err("Recovery file exceeds its bound".into());
        }
    }
    if bytes != before.len()
        || file.metadata().map_err(err)?.modified().ok() != before.modified().ok()
    {
        return Err("Recovery copy changed while being verified".into());
    }
    Ok(Entry {
        size: bytes,
        sha256: format!("{:x}", hash.finalize()),
    })
}
fn inventory(
    root: &Path,
    guard: &mut dyn FnMut() -> Result<(), String>,
) -> Result<Inventory, String> {
    fn walk(
        root: &Path,
        relative: &str,
        out: &mut Inventory,
        seen: &mut HashSet<String>,
        total: &mut u64,
        guard: &mut dyn FnMut() -> Result<(), String>,
    ) -> Result<(), String> {
        for entry in fs::read_dir(root.join(relative)).map_err(err)? {
            guard()?;
            let entry = entry.map_err(err)?;
            reject_link(&entry.path())?;
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| "Recovery path is not Unicode")?;
            let path = if relative.is_empty() {
                name
            } else {
                format!("{relative}/{name}")
            };
            crate::recovery_archive::safe_path(&path)?;
            if !seen.insert(path.to_lowercase()) {
                return Err("Recovery paths are ambiguous".into());
            }
            if entry.file_type().map_err(err)?.is_dir() {
                walk(root, &path, out, seen, total, guard)?;
            } else if entry.file_type().map_err(err)?.is_file() {
                if out.len() >= MAX_FILES {
                    return Err("Recovery copy has too many files".into());
                }
                let value = hash(&entry.path(), guard)?;
                *total = total
                    .checked_add(value.size)
                    .ok_or("Recovery length overflow")?;
                if *total > MAX_BYTES {
                    return Err("Recovery copy exceeds its byte bound".into());
                }
                out.insert(path, value);
            } else {
                return Err("Unsupported recovery file".into());
            }
        }
        Ok(())
    }
    let mut result = Inventory::new();
    walk(root, "", &mut result, &mut HashSet::new(), &mut 0, guard)?;
    if !result.contains_key("labos-local.db")
        || !result.contains_key("recovery-key.dpapi")
        || result.keys().any(|p| {
            matches!(
                p.as_str(),
                "labos-local.db-wal" | "labos-local.db-shm" | "labos-local.db-journal"
            )
        })
    {
        return Err("Close all tools using this recovered database before activation".into());
    }
    Ok(result)
}
pub(crate) fn remember(
    app: &tauri::AppHandle,
    path: &Path,
    owner: &str,
    origin: &str,
) -> Result<String, String> {
    let ticket = Ticket {
        id: uuid::Uuid::new_v4().to_string(),
        source: path.canonicalize().map_err(err)?,
        files: inventory(path, &mut || Ok(()))?,
        owner: owner.into(),
        origin: origin.into(),
    };
    let id = ticket.id.clone();
    *app.state::<Tickets>()
        .0
        .lock()
        .map_err(|_| "Recovery ticket state unavailable")? = Some(ticket);
    Ok(id)
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Plan {
    version: u32,
    id: String,
    profile: String,
    owner: String,
    origin: String,
    files: Inventory,
}
fn stage(root: &Path, id: &str) -> Result<PathBuf, String> {
    uuid::Uuid::parse_str(id).map_err(err)?;
    Ok(root
        .parent()
        .ok_or("Missing workspace parent")?
        .join(format!(".labos-next-workspace-{id}")))
}
fn archive(root: &Path, id: &str) -> Result<PathBuf, String> {
    uuid::Uuid::parse_str(id).map_err(err)?;
    Ok(root
        .parent()
        .ok_or("Missing workspace parent")?
        .join(format!("LabOS-previous-workspace-{id}")))
}
pub(crate) fn publish_new(source: &Path, target: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH};
        let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
        let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe { MoveFileExW(source.as_ptr(), target.as_ptr(), MOVEFILE_WRITE_THROUGH) } == 0 {
            return Err(err(std::io::Error::last_os_error()));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        fs::hard_link(source, target).map_err(err)?;
        fs::remove_file(source).map_err(err)
    }
}
fn seal(root: &Path, plan: &Plan) -> Result<(), String> {
    let plain = Zeroizing::new(serde_json::to_vec(plan).map_err(err)?);
    if plain.len() > MAX_PLAN {
        return Err("Recovery activation catalogue exceeds its bound".into());
    }
    let key = crate::recovery_crypto::random_key();
    let protected = crate::recovery_protection::protect(&*key)?;
    let mut nonce = [0; 12];
    OsRng.fill_bytes(&mut nonce);
    let cipher = Aes256Gcm::new_from_slice(&*key)
        .map_err(|_| "Invalid activation key")?
        .encrypt(
            (&nonce).into(),
            Payload {
                msg: &plain,
                aad: identity(root).as_bytes(),
            },
        )
        .map_err(|_| "Unable to seal activation plan")?;
    let target = plan_path(root)?;
    let partial = target.with_extension(format!("{}.partial", uuid::Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&partial)
        .map_err(err)?;
    let result = (|| {
        file.write_all(MAGIC).map_err(err)?;
        file.write_all(&(protected.len() as u32).to_le_bytes())
            .map_err(err)?;
        file.write_all(&nonce).map_err(err)?;
        file.write_all(&protected).map_err(err)?;
        file.write_all(&cipher).map_err(err)?;
        file.sync_all().map_err(err)
    })();
    drop(file);
    let result = result.and_then(|_| publish_new(&partial, &target));
    if result.is_err() {
        let _ = fs::remove_file(partial);
    }
    result
}
fn unseal(root: &Path) -> Result<Plan, String> {
    let path = plan_path(root)?;
    reject_link(&path)?;
    let meta = fs::metadata(&path).map_err(err)?;
    if meta.len() > MAX_PLAN as u64 + 65536 || meta.len() < 48 {
        return Err("Invalid activation plan length".into());
    }
    let bytes = fs::read(path).map_err(err)?;
    if &bytes[..16] != MAGIC {
        return Err("Unsupported activation plan".into());
    }
    let count = u32::from_le_bytes(bytes[16..20].try_into().unwrap()) as usize;
    if count > 16384 || 32 + count + 16 > bytes.len() {
        return Err("Invalid activation envelope".into());
    }
    let key = crate::recovery_protection::unprotect(&bytes[32..32 + count])?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| "Invalid protected activation key")?;
    let plain = Zeroizing::new(
        cipher
            .decrypt(
                aes_gcm::Nonce::from_slice(&bytes[20..32]),
                Payload {
                    msg: &bytes[32 + count..],
                    aad: identity(root).as_bytes(),
                },
            )
            .map_err(|_| "Activation plan failed authentication")?,
    );
    let plan: Plan = serde_json::from_slice(&plain).map_err(err)?;
    if plan.version != 1
        || plan.profile != root.to_string_lossy().as_ref()
        || plan.origin != crate::native_authorization::trusted_base().map_err(|e| e.message)?
    {
        return Err("Recovery activation belongs to another workspace or server".into());
    }
    uuid::Uuid::parse_str(&plan.owner).map_err(err)?;
    Ok(plan)
}
pub(crate) fn verify_ticket(
    ticket: &Ticket,
    mut guard: impl FnMut() -> Result<(), String>,
) -> Result<(), String> {
    guard()?;
    if inventory(&ticket.source, &mut guard)? != ticket.files {
        return Err("Verified recovery copy changed; restore and review it again".into());
    }
    crate::local_recovery::validate_recovered_directory(
        &ticket.source,
        &ticket.owner,
        &ticket.origin,
    )
}
pub(crate) fn prepare(
    root: &Path,
    ticket: &Ticket,
    mut guard: impl FnMut() -> Result<(), String>,
) -> Result<(), String> {
    guard()?;
    if plan_path(root)?.exists() {
        let prior = unseal(root)?;
        if prior.id == ticket.id
            && prior.files == ticket.files
            && inventory(&stage(root, &ticket.id)?, &mut guard)? == ticket.files
        {
            return Ok(());
        }
        return Err(
            "An earlier activation requires recovery review before another can be prepared".into(),
        );
    }
    if inventory(&ticket.source, &mut guard)? != ticket.files {
        return Err("Verified recovery copy changed; restore and review it again".into());
    }
    crate::local_recovery::validate_recovered_directory(
        &ticket.source,
        &ticket.owner,
        &ticket.origin,
    )?;
    let target = stage(root, &ticket.id)?;
    if target.exists() {
        // This native ticket owns only this derived staging directory. The separate
        // verified source and current/previous workspaces are never cleanup targets.
        reject_link(&target)?;
        if target.canonicalize().map_err(err)? != target || target.parent() != root.parent() {
            return Err("Activation staging path changed; current work is unchanged".into());
        }
        fs::remove_dir_all(&target).map_err(err)?;
    }
    fs::create_dir(&target).map_err(err)?;
    for (name, expected) in &ticket.files {
        guard()?;
        let relative = crate::recovery_archive::safe_path(name)?;
        let source = ticket.source.join(&relative);
        let output = target.join(relative);
        fs::create_dir_all(output.parent().ok_or("Invalid recovery destination")?).map_err(err)?;
        let mut input = File::open(&source).map_err(err)?;
        let mut output = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(output)
            .map_err(err)?;
        let mut buffer = Zeroizing::new(vec![0; 1024 * 1024]);
        let mut digest = Sha256::new();
        let mut count = 0u64;
        loop {
            guard()?;
            let n = input.read(&mut buffer).map_err(err)?;
            if n == 0 {
                break;
            }
            count += n as u64;
            if count > expected.size {
                return Err("Recovered file changed during activation staging".into());
            }
            digest.update(&buffer[..n]);
            output.write_all(&buffer[..n]).map_err(err)?;
        }
        output.sync_all().map_err(err)?;
        if count != expected.size || format!("{:x}", digest.finalize()) != expected.sha256 {
            return Err("Recovered file checksum changed during activation staging".into());
        }
    }
    if inventory(&target, &mut guard)? != ticket.files {
        return Err("Activation staging failed verification; current work is unchanged".into());
    }
    guard()?;
    seal(
        root,
        &Plan {
            version: 1,
            id: ticket.id.clone(),
            profile: root.to_string_lossy().into(),
            owner: ticket.owner.clone(),
            origin: ticket.origin.clone(),
            files: ticket.files.clone(),
        },
    )
}
// Called only at startup, while the exclusive profile lease is held and before
// SQLite or any media consumer opens the workspace. All crash states preserve
// both the previous root and the independently verified replacement.
pub(crate) fn activate_pending(root: &Path) -> Result<Option<PathBuf>, String> {
    if !plan_path(root)?.exists() {
        return Ok(None);
    }
    let plan = unseal(root)?;
    let next = stage(root, &plan.id)?;
    let previous = archive(root, &plan.id)?;
    if next.exists() {
        if inventory(&next, &mut || Ok(()))? != plan.files {
            return Err("Activation candidate changed; existing work is preserved".into());
        }
        crate::local_recovery::validate_recovered_directory(&next, &plan.owner, &plan.origin)?;
        if root.exists() {
            if previous.exists() {
                return Err(
                    "Ambiguous activation state; both workspaces are preserved for recovery".into(),
                );
            }
            reject_link(root)?;
            fs::rename(root, &previous).map_err(err)?;
        }
        if !previous.exists() {
            return Err("Previous workspace is missing; activation stopped without deleting the recovery copy".into());
        }
        if let Err(error) = fs::rename(&next, root) {
            if !root.exists() {
                let _ = fs::rename(&previous, root);
            }
            return Err(format!(
                "Activation could not finish; previous workspace and candidate retained: {error}"
            ));
        }
    } else if !root.exists() || !previous.exists() {
        return Err("Incomplete activation state; recovery review required".into());
    }
    if inventory(root, &mut || Ok(()))? != plan.files {
        return Err(
            "Activated workspace failed final verification; both copies are preserved".into(),
        );
    }
    fs::remove_file(plan_path(root)?).map_err(err)?;
    Ok(Some(previous))
}
#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use rusqlite::Connection;
    struct Fixture {
        parent: PathBuf,
        root: PathBuf,
        ticket: Ticket,
    }
    impl Fixture {
        fn new() -> Self {
            let temp = std::env::temp_dir().canonicalize().unwrap();
            let parent = temp.join(format!("labos-activation-proof-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&parent).unwrap();
            let root = parent.join("workspace");
            let source = parent.join("package-source");
            fs::create_dir(&root).unwrap();
            fs::create_dir(&source).unwrap();
            let old = Connection::open(root.join("labos-local.db")).unwrap();
            old.execute_batch("CREATE TABLE sync_outbox(change_id TEXT,account_id TEXT,payload_json TEXT);INSERT INTO sync_outbox VALUES('previous-intent','previous-author','keep previous pending work');").unwrap();
            drop(old);
            fs::write(root.join("old-bytes"), b"previous original bytes").unwrap();
            let c = Connection::open(source.join("labos-local.db")).unwrap();
            c.execute_batch("CREATE TABLE local_session(id INTEGER);INSERT INTO local_session VALUES(1);CREATE TABLE local_users(offline_expires_at TEXT);INSERT INTO local_users VALUES('2099-01-01');CREATE TABLE sync_outbox(change_id TEXT,account_id TEXT,payload_json TEXT);INSERT INTO sync_outbox VALUES('recovered-intent','original-author','immutable recovered intent');").unwrap();
            fs::write(source.join("original.bin"), b"verified recovered bytes").unwrap();
            let owner = uuid::Uuid::new_v4().to_string();
            let origin = crate::native_authorization::trusted_base().unwrap();
            let package = parent.join("owner.labos-recovery");
            let key = crate::recovery_crypto::random_key();
            let secret = "disposable activation proof secret";
            crate::recovery_archive::create(
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
            drop(c);
            let result = crate::local_recovery::restore_separate_copy(
                &package,
                &parent,
                secret,
                &origin,
                || Ok(()),
                || Ok(()),
            )
            .unwrap();
            let recovered = PathBuf::from(result["path"].as_str().unwrap());
            let files = inventory(&recovered, &mut || Ok(())).unwrap();
            let ticket = Ticket {
                id: uuid::Uuid::new_v4().to_string(),
                source: recovered,
                files,
                owner,
                origin,
            };
            Self {
                parent,
                root,
                ticket,
            }
        }
        fn previous_intact(&self, path: &Path) {
            assert_eq!(
                fs::read(path.join("old-bytes")).unwrap(),
                b"previous original bytes"
            );
            let c = Connection::open_with_flags(
                path.join("labos-local.db"),
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
            )
            .unwrap();
            assert_eq!(
                c.query_row("SELECT payload_json FROM sync_outbox", [], |r| r
                    .get::<_, String>(0))
                    .unwrap(),
                "keep previous pending work"
            );
        }
        fn recovered_intact(&self) {
            let c = Connection::open_with_flags(
                self.root.join("labos-local.db"),
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
            )
            .unwrap();
            assert_eq!(
                c.query_row("SELECT account_id FROM sync_outbox", [], |r| r
                    .get::<_, String>(0))
                    .unwrap(),
                "original-author"
            );
            assert_eq!(
                c.query_row("SELECT count(*) FROM local_session", [], |r| r
                    .get::<_, i64>(0))
                    .unwrap(),
                0
            );
            assert_eq!(
                fs::read(self.root.join("original.bin")).unwrap(),
                b"verified recovered bytes"
            );
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let temp = std::env::temp_dir().canonicalize().unwrap();
            assert_eq!(self.parent.parent(), Some(temp.as_path()));
            assert!(self
                .parent
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("labos-activation-proof-"));
            let _ = fs::remove_dir_all(&self.parent);
        }
    }
    #[test]
    fn activation_archives_pending_work_and_restarts_without_replaying_the_switch() {
        let f = Fixture::new();
        let lease = acquire(&f.root).unwrap();
        prepare(&f.root, &f.ticket, || Ok(())).unwrap();
        let original = f.ticket.files.clone();
        let previous = activate_pending(&f.root).unwrap().unwrap();
        f.previous_intact(&previous);
        f.recovered_intact();
        assert_eq!(
            inventory(&f.ticket.source, &mut || Ok(())).unwrap(),
            original
        );
        assert!(activate_pending(&f.root).unwrap().is_none());
        drop(lease);
    }
    #[test]
    fn activation_resumes_after_original_was_archived_and_after_replacement_was_moved() {
        for after_replacement in [false, true] {
            let f = Fixture::new();
            prepare(&f.root, &f.ticket, || Ok(())).unwrap();
            let previous = archive(&f.root, &f.ticket.id).unwrap();
            fs::rename(&f.root, &previous).unwrap();
            if after_replacement {
                fs::rename(stage(&f.root, &f.ticket.id).unwrap(), &f.root).unwrap();
            }
            assert_eq!(activate_pending(&f.root).unwrap(), Some(previous.clone()));
            f.previous_intact(&previous);
            f.recovered_intact();
        }
    }
    #[test]
    fn tampered_sealed_plan_candidate_and_source_cannot_replace_existing_work() {
        let f = Fixture::new();
        prepare(&f.root, &f.ticket, || Ok(())).unwrap();
        let path = plan_path(&f.root).unwrap();
        let original = fs::read(&path).unwrap();
        let mut bad = original.clone();
        let n = bad.len() - 1;
        bad[n] ^= 1;
        fs::write(&path, bad).unwrap();
        assert!(activate_pending(&f.root).is_err());
        f.previous_intact(&f.root);
        fs::write(&path, &original).unwrap();
        let next = stage(&f.root, &f.ticket.id).unwrap();
        fs::write(next.join("original.bin"), b"tampered").unwrap();
        assert!(activate_pending(&f.root).is_err());
        f.previous_intact(&f.root);
        assert!(!archive(&f.root, &f.ticket.id).unwrap().exists());
        let alternate = f.parent.join("other-workspace");
        fs::create_dir(&alternate).unwrap();
        fs::write(plan_path(&alternate).unwrap(), original).unwrap();
        assert!(activate_pending(&alternate).is_err());
        f.previous_intact(&f.root);
    }
}
