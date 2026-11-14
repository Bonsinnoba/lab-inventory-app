//! One protected workspace key and shared byte adapters. A known managed root
//! never falls back to plaintext after a key, authentication or disk failure.
use crate::managed_encryption;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use zeroize::{Zeroize, Zeroizing};
const KEY_FILE: &str = ".workspace-key.dpapi";
type Key = Arc<Zeroizing<[u8; 32]>>;
static KEYS: Mutex<Vec<(PathBuf, Key)>> = Mutex::new(Vec::new());
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    version: u32,
    origin: String,
    key: [u8; 32],
}
impl Drop for Envelope {
    fn drop(&mut self) {
        self.key.zeroize();
    }
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn ioerr(e: impl std::fmt::Display) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, e.to_string())
}
fn trusted() -> Result<String, String> {
    crate::native_authorization::trusted_base().map_err(|e| e.message)
}
fn no_link(path: &Path) -> Result<(), String> {
    let m = fs::symlink_metadata(path).map_err(err)?;
    if m.file_type().is_symlink() {
        return Err("Managed key or byte paths cannot be links".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if m.file_attributes() & 0x400 != 0 {
            return Err("Managed key or byte paths cannot be reparse points".into());
        }
    }
    Ok(())
}
// Windows packaged launchers can merge the logical Roaming directory while
// redirecting its files into a per-package backing directory. The protected key
// is the anchor; never accept an unrelated byte parent merely because the
// logical directory spelling shares a prefix.
pub(crate) fn canonical_key_root(root:&Path)->Result<PathBuf,String>{
    no_link(root)?;
    let path=root.join(KEY_FILE);
    match fs::symlink_metadata(&path){
        Ok(metadata)=>{if !metadata.is_file(){return Err("Protected workspace key is not a file".into())}no_link(&path)?;path.canonicalize().map_err(err)?.parent().map(Path::to_path_buf).ok_or_else(||"Protected key has no workspace parent".into())},
        Err(error) if error.kind()==io::ErrorKind::NotFound=>root.canonicalize().map_err(err),
        Err(error)=>Err(err(error)),
    }
}
fn managed_path(path:&Path)->io::Result<PathBuf>{
    Ok(path.parent().ok_or_else(||ioerr("Managed file has no parent"))?.canonicalize()?.join(path.file_name().ok_or_else(||ioerr("Managed file has no name"))?))
}
fn register(root: &Path, key: Key) -> Result<Key, String> {
    let root = canonical_key_root(root)?;
    let mut keys = KEYS.lock().map_err(|_| "Workspace key cache unavailable")?;
    if let Some((_, old)) = keys.iter().find(|(path, _)| path == &root) {
        if old.as_ref().as_slice() != key.as_ref().as_slice() {
            return Err("Working key changed while the workspace was open".into());
        }
        return Ok(old.clone());
    }
    keys.push((root, key.clone()));
    Ok(key)
}
fn remembered(root: &Path) -> Result<Option<Key>, String> {
    let root = canonical_key_root(root)?;
    Ok(KEYS
        .lock()
        .map_err(|_| "Workspace key cache unavailable")?
        .iter()
        .find(|(path, _)| path == &root)
        .map(|(_, key)| key.clone()))
}
fn missing_key_is_unsafe(root: &Path) -> Result<bool, String> {
    if root.join(".workspace-encryption.json").exists()
        || root.join(".encrypted-originals").exists()
    {
        return Ok(true);
    }
    let db = root.join("labos-local.db");
    if db.exists() {
        let mut file = File::open(db).map_err(err)?;
        let mut header = [0; 16];
        let n = file.read(&mut header).map_err(err)?;
        if n > 0 && (n < 16 || &header != b"SQLite format 3\0") {
            return Ok(true);
        }
    }
    Ok(false)
}
fn load(root: &Path) -> Result<Key, String> {
    let path = root.join(KEY_FILE);
    no_link(&path)?;
    let m = fs::metadata(&path).map_err(err)?;
    if !m.is_file() || m.len() > 16384 {
        return Err("Invalid protected workspace key".into());
    }
    let plain = crate::recovery_protection::unprotect(&fs::read(&path).map_err(err)?)?;
    let key: Envelope =
        serde_json::from_slice(&plain).map_err(|_| "Protected workspace key is invalid")?;
    if key.version != 1 || key.origin != trusted()? {
        return Err(
            "Working key belongs to another server or format; original work is preserved".into(),
        );
    }
    register(root, Arc::new(Zeroizing::new(key.key)))
}
fn write_key(root: &Path, key: &Envelope) -> Result<(), String> {
    let plain = Zeroizing::new(serde_json::to_vec(key).map_err(err)?);
    let protected = crate::recovery_protection::protect(&plain)?;
    let partial = root.join(format!(".workspace-key-{}.partial", uuid::Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&partial)
        .map_err(err)?;
    let result = (|| {
        file.write_all(&protected).map_err(err)?;
        file.sync_all().map_err(err)
    })();
    drop(file);
    let result =
        result.and_then(|_| crate::profile_recovery::publish_new(&partial, &root.join(KEY_FILE)));
    if result.is_err() {
        let _ = fs::remove_file(&partial);
    }
    result
}
pub(crate) fn ensure_key(root: &Path) -> Result<Key, String> {
    fs::create_dir_all(root).map_err(err)?;
    no_link(root)?;
    if let Some(key) = remembered(root)? {
        return Ok(key);
    }
    if root.join(KEY_FILE).exists() {
        return load(root);
    }
    if missing_key_is_unsafe(root)? {
        return Err("The protected working key is missing. Recover it from the owner-held package; existing encrypted work has not been changed".into());
    }
    let key = crate::recovery_crypto::random_key();
    let envelope = Envelope {
        version: 1,
        origin: trusted()?,
        key: *key,
    };
    write_key(root, &envelope)?;
    register(root, Arc::new(key))
}
pub(crate) fn export_key(root: &Path) -> Result<Option<Zeroizing<Vec<u8>>>, String> {
    let key = if let Some(key) = remembered(root)? {
        key
    } else if root.join(KEY_FILE).exists() {
        load(root)?
    } else {
        if missing_key_is_unsafe(root)? {
            return Err(
                "Cannot back up encrypted working files without their protected key".into(),
            );
        }
        return Ok(None);
    };
    let envelope = Envelope {
        version: 1,
        origin: trusted()?,
        key: **key,
    };
    Ok(Some(Zeroizing::new(
        serde_json::to_vec(&envelope).map_err(err)?,
    )))
}
pub(crate) fn import_key(root: &Path, bytes: &[u8], origin: &str) -> Result<(), String> {
    if bytes.len() > 4096 {
        return Err("Recovery working key exceeds its bound".into());
    }
    let key: Envelope =
        serde_json::from_slice(bytes).map_err(|_| "Invalid recovered working key")?;
    if key.version != 1 || key.origin != origin || origin != trusted()? {
        return Err("Recovered working key belongs to another server".into());
    }
    write_key(root, &key)?;
    Ok(())
}
pub(crate) fn validate_export(bytes: &[u8], origin: &str) -> Result<(), String> {
    if bytes.len() > 4096 {
        return Err("Recovery working key exceeds its bound".into());
    }
    let key: Envelope =
        serde_json::from_slice(bytes).map_err(|_| "Invalid recovered working key")?;
    if key.version != 1 || key.origin != origin || origin != trusted()? {
        return Err("Recovered working key belongs to another server".into());
    }
    Ok(())
}
pub(crate) fn file_key(
    root: &Path,
    path: &Path,
    master: &[u8],
) -> Result<Zeroizing<[u8; 32]>, String> {
    let root = canonical_key_root(root)?;
    let absolute = path
        .parent()
        .ok_or("Managed file has no parent")?
        .canonicalize()
        .map_err(err)?
        .join(path.file_name().ok_or("Managed file has no name")?);
    let relative = absolute
        .strip_prefix(&root)
        .map_err(|_| "Managed file leaves its key scope")?;
    let mut scope = relative.to_string_lossy().replace('\\', "/").to_lowercase();
    // A verified replica moves from .partial to .content without changing identity.
    if scope.starts_with("resource-copies/") {
        for suffix in [".partial", ".content"] {
            if let Some(stem) = scope.strip_suffix(suffix) {
                scope = stem.to_owned();
                break;
            }
        }
    }
    let mut key = Zeroizing::new([0; 32]);
    hkdf::Hkdf::<sha2::Sha256>::new(Some(b"LabOS managed path key v1"), master)
        .expand(scope.as_bytes(), &mut *key)
        .map_err(|_| "Managed path key derivation failed")?;
    Ok(key)
}
fn for_path(root: &Path, path: &Path, master: Key) -> Result<Key, String> {
    Ok(Arc::new(file_key(root, path, &**master)?))
}
fn lexical(path: &Path) -> String {
    let value = path.to_string_lossy().replace('\\', "/");
    let value = if let Some(unc) = value.strip_prefix("//?/UNC/") {
        format!("//{unc}")
    } else {
        value.strip_prefix("//?/").unwrap_or(&value).to_owned()
    };
    #[cfg(windows)]
    {
        value.to_lowercase()
    }
    #[cfg(not(windows))]
    {
        value
    }
}
fn within(path: &Path, root: &Path) -> bool {
    let p = lexical(path);
    let r = lexical(root);
    p == r || p.starts_with(&(r + "/"))
}
// Export guards reject both the logical profile and its protected physical
// backing directory. This does not authorize reads through an unrelated alias.
pub(crate) fn is_managed_directory(root:&Path,path:&Path)->Result<bool,String>{
    let actual=path.canonicalize().map_err(err)?;
    Ok(within(&actual,&canonical_key_root(root)?)||within(&actual,&root.canonicalize().map_err(err)?))
}
fn key_for(path: &Path) -> Result<Option<Key>, String> {
    let known = KEYS
        .lock()
        .map_err(|_| "Workspace key cache unavailable")?
        .iter()
        .filter(|(root, _)| within(path, root))
        .max_by_key(|(root, _)| root.as_os_str().len())
        .cloned();
    if let Some((root, key)) = known {
        if path.exists() {
            no_link(path)?;
        }
        let parent = path
            .parent()
            .ok_or("Managed byte path has no parent")?
            .canonicalize()
            .map_err(err)?;
        if !within(&parent, &root) {
            return Err("Managed byte parent changed outside its workspace".into());
        }
        return for_path(&root, path, key).map(Some);
    }
    let mut parent = path.parent();
    while let Some(root) = parent {
        if root.join(KEY_FILE).exists() {
            let key = match remembered(root)?{Some(key)=>key,None=>load(root)?};
            if path.exists() {
                no_link(path)?;
            }
            let actual_parent = path
                .parent()
                .ok_or("Managed byte parent missing")?
                .canonicalize()
                .map_err(err)?;
            let root=canonical_key_root(root)?;
            if !within(&actual_parent, &root) {
                return Err("Managed parent resolves outside its key scope".into());
            }
            return for_path(&root, path, key).map(Some);
        }
        parent = root.parent();
    }
    Ok(None)
}
pub(crate) enum Reader {
    Plain(File),
    Encrypted(managed_encryption::Reader),
}
pub(crate) struct Metadata {
    raw: fs::Metadata,
    len: u64,
}
impl Metadata {
    pub fn len(&self) -> u64 {
        self.len
    }
    pub fn modified(&self) -> io::Result<std::time::SystemTime> {
        self.raw.modified()
    }
}
impl Reader {
    pub fn metadata(&self) -> io::Result<Metadata> {
        match self {
            Self::Plain(file) => {
                let raw = file.metadata()?;
                let len = raw.len();
                Ok(Metadata { raw, len })
            }
            Self::Encrypted(file) => Ok(Metadata {
                raw: file.metadata()?,
                len: file.len(),
            }),
        }
    }
}
impl Read for Reader {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        match self {
            Self::Plain(f) => f.read(bytes),
            Self::Encrypted(f) => f.read(bytes),
        }
    }
}
impl Seek for Reader {
    fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
        match self {
            Self::Plain(f) => f.seek(position),
            Self::Encrypted(f) => f.seek(position),
        }
    }
}
pub(crate) fn open(path: &Path) -> io::Result<Reader> {
    match key_for(path).map_err(ioerr)? {
        Some(key) => managed_encryption::Reader::open(&managed_path(path)?, &**key).map(Reader::Encrypted),
        None => File::open(path).map(Reader::Plain),
    }
}
pub(crate) fn len(path: &Path) -> io::Result<u64> {
    open(path)?.metadata().map(|m| m.len())
}
pub(crate) fn write_new(path: &Path, bytes: &[u8]) -> io::Result<()> {
    match key_for(path).map_err(ioerr)? {
        Some(key) => {
            let mut out = managed_encryption::Writer::create(&managed_path(path)?, &**key, bytes.len() as u64)?;
            out.write_all(bytes)?;
            out.finish()
        }
        None => {
            let mut out = OpenOptions::new().create_new(true).write(true).open(path)?;
            out.write_all(bytes)?;
            out.sync_all()
        }
    }
}
pub(crate) fn create_staging(path: &Path, size: u64) -> io::Result<()> {
    match key_for(path).map_err(ioerr)? {
        Some(key) => managed_encryption::create_staging(&managed_path(path)?, &**key, size),
        None => OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(path)?
            .sync_all(),
    }
}
pub(crate) fn staged_len(path: &Path) -> io::Result<u64> {
    match key_for(path).map_err(ioerr)? {
        Some(key) => managed_encryption::staged_len(&managed_path(path)?, &**key),
        None => fs::metadata(path).map(|m| m.len()),
    }
}
pub(crate) fn reset_copy_staging(path: &Path, size: u64, offset: u64) -> io::Result<()> {
    match key_for(path).map_err(ioerr)? {
        Some(key) => {
            let actual_path=managed_path(path)?;let path=actual_path.as_path();
            if offset == 0 {
                let temporary = path.with_extension(format!("{}.encrypted", uuid::Uuid::new_v4()));
                managed_encryption::create_staging(&temporary, &**key, size)?;
                let result = crate::local_resource_export::replace(&temporary, path).map_err(ioerr);
                if result.is_err() {
                    let _ = fs::remove_file(&temporary);
                }
                result
            } else {
                managed_encryption::truncate_staging(path, &**key, size, offset)
            }
        }
        None => {
            let file = OpenOptions::new().create(true).write(true).open(path)?;
            file.set_len(offset)?;
            file.sync_all()
        }
    }
}
pub(crate) fn append(path: &Path, size: u64, offset: u64, bytes: &[u8]) -> io::Result<()> {
    match key_for(path).map_err(ioerr)? {
        Some(key) => {
            let actual_path=managed_path(path)?;let path=actual_path.as_path();
            if managed_encryption::declared_len(path, &**key)? != size {
                return Err(ioerr("Staging length changed"));
            }
            managed_encryption::append(path, &**key, offset, bytes)
        }
        None => {
            if offset
                .checked_add(bytes.len() as u64)
                .filter(|n| *n <= size)
                .is_none()
            {
                return Err(ioerr("Staging chunk exceeds file size"));
            }
            let mut f = OpenOptions::new().read(true).write(true).open(path)?;
            let len = f.metadata()?.len();
            if offset > len {
                return Err(ioerr("Missing earlier file bytes"));
            }
            f.seek(SeekFrom::Start(offset))?;
            if offset < len {
                let n = (len - offset).min(bytes.len() as u64) as usize;
                let mut old = vec![0; n];
                f.read_exact(&mut old)?;
                if old != bytes[..n] {
                    return Err(ioerr("Retried chunk differs from saved bytes"));
                }
                f.seek(SeekFrom::Start(offset))?;
            }
            f.write_all(bytes)?;
            f.sync_all()
        }
    }
}
pub(crate) fn copy_new(source: &Path, target: &Path, size: u64) -> io::Result<()> {
    let mut input = open(source)?;
    if input.metadata()?.len() != size {
        return Err(ioerr("Source byte length changed"));
    }
    match key_for(target).map_err(ioerr)? {
        Some(key) => {
            let mut out = managed_encryption::Writer::create(&managed_path(target)?, &**key, size)?;
            let count = io::copy(&mut input, &mut out)?;
            if count != size {
                return Err(ioerr("Source length changed during copy"));
            }
            out.finish()
        }
        None => {
            let mut out = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(target)?;
            let count = io::copy(&mut input, &mut out)?;
            if count != size {
                return Err(ioerr("Source length changed during copy"));
            }
            out.sync_all()
        }
    }
}

#[cfg(feature = "working-encryption")]
pub(crate) fn repair_from_verified_copy(
    root: &Path,
    candidate: &Path,
    owner: &str,
    origin: &str,
    custodian_sha: &str,
    mut guard: impl FnMut() -> Result<(), String>,
    mut publish: impl FnMut() -> Result<(), String>,
) -> Result<(), String> {
    use rusqlite::OptionalExtension;
    guard()?;
    let key = load(candidate)?;
    if origin != trusted()? {
        return Err("Recovery key belongs to another server".into());
    }
    let root = root.canonicalize().map_err(err)?;
    let db = root.join("labos-local.db");
    no_link(&db)?;
    let mut c = crate::encrypted_database::open(&db, &**key, false)?;
    let table:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='local_recovery_custodian')",[],|r|r.get(0)).map_err(err)?;
    if table {
        let current:Option<(String,String,String)>=c.query_row("SELECT owner_account_id,server_origin,key_sha256 FROM local_recovery_custodian WHERE id=1",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(err)?;
        if current.is_some_and(|value| value != (owner.into(), origin.into(), custodian_sha.into()))
        {
            return Err("Owner-held package does not match the current recovery enrollment".into());
        }
    }
    let stage = root.join(format!(".workspace-repair-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&stage).map_err(err)?;
    let envelope = Envelope {
        version: 1,
        origin: origin.into(),
        key: **key,
    };
    write_key(&stage, &envelope)?;
    let old = root.join(KEY_FILE);
    if old.exists() {
        no_link(&old)?;
        let size = fs::metadata(&old).map_err(err)?.len();
        if size > 16384 {
            return Err("Old protected key is invalid; it was preserved".into());
        }
        let retired = root.join(format!(
            ".workspace-key-retired-{}.dpapi",
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
    guard()?;
    publish()?;
    // Recovery proves custody, not a live login. Clear only access material; the
    // current authored rows/outbox are never replaced by the older backup snapshot.
    crate::local_recovery::clear_recovered_access(&mut c)?;
    drop(c);
    let result = crate::local_resource_export::replace(&stage.join(KEY_FILE), &old);
    if result.is_ok() {
        let _ = fs::remove_dir(&stage);
    }
    result
}
#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn roaming_workspace_copies_use_the_protected_key_backing_directory_and_preserve_scope(){
        let root=PathBuf::from(std::env::var_os("APPDATA").expect("Windows Roaming directory"))
            .join(format!("labos-working-path-fixture-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();let key=ensure_key(&root).unwrap();
        let physical=canonical_key_root(&root).unwrap();
        assert_eq!(physical,root.join(KEY_FILE).canonicalize().unwrap().parent().unwrap());
        let account=root.join("resource-copies").join(uuid::Uuid::new_v4().to_string());
        let parent=account.join(uuid::Uuid::new_v4().to_string());fs::create_dir_all(&parent).unwrap();
        assert!(is_managed_directory(&root,&parent).unwrap());
        assert!(is_managed_directory(&root,&parent.canonicalize().unwrap()).unwrap());
        assert!(!is_managed_directory(&root,physical.parent().unwrap()).unwrap());
        let partial=parent.join(format!("{}.partial","a".repeat(64)));
        let content=partial.with_extension("content");
        reset_copy_staging(&partial,3,0).unwrap();append(&partial,3,0,b"abc").unwrap();
        assert_eq!(staged_len(&partial).unwrap(),3);
        fs::rename(managed_path(&partial).unwrap(),managed_path(&content).unwrap()).unwrap();
        let mut bytes=Vec::new();open(&content).unwrap().read_to_end(&mut bytes).unwrap();assert_eq!(bytes,b"abc");
        assert_ne!(fs::read(managed_path(&content).unwrap()).unwrap(),b"abc");
        assert_eq!(&*file_key(&root,&content,&**key).unwrap(),&*file_key(&physical,&content,&**key).unwrap());
        assert!(file_key(&root,&physical.parent().unwrap().join("outside.bin"),&**key).is_err());
        // Remove only the exact owned fixture entries, never a recursive roaming tree.
        fs::remove_file(managed_path(&content).unwrap()).unwrap();
        let actual_parent=parent.canonicalize().unwrap();fs::remove_dir(&actual_parent).unwrap();
        let actual_account=account.canonicalize().unwrap();fs::remove_dir(&actual_account).unwrap();
        fs::remove_dir(physical.join("resource-copies")).unwrap();
        fs::remove_file(physical.join(KEY_FILE)).unwrap();fs::remove_dir(physical).unwrap();
    }
    #[cfg(feature = "working-encryption")]
    #[test]
    fn owner_key_repair_preserves_newer_authored_intent_and_clears_only_access_material() {
        let parent =
            std::env::temp_dir().join(format!("labos-working-key-repair-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&parent).unwrap();
        let root = parent.join("current");
        let candidate = parent.join("verified");
        let wrong = parent.join("wrong");
        fs::create_dir(&candidate).unwrap();
        fs::create_dir(&wrong).unwrap();
        crate::encrypted_database::prepare_workspace(&root).unwrap();
        let key = ensure_key(&root).unwrap();
        let portable = export_key(&root).unwrap().unwrap();
        import_key(&candidate, &portable, &trusted().unwrap()).unwrap();
        ensure_key(&wrong).unwrap();
        let c =
            crate::encrypted_database::open(&root.join("labos-local.db"), &**key, false).unwrap();
        c.execute_batch("CREATE TABLE local_recovery_custodian(id INTEGER PRIMARY KEY,owner_account_id TEXT,server_origin TEXT,key_sha256 TEXT);CREATE TABLE authored(author TEXT,payload TEXT);INSERT INTO authored VALUES('original-author','work created after the older recovery snapshot');CREATE TABLE local_session(id INTEGER);INSERT INTO local_session VALUES(1);CREATE TABLE local_users(offline_expires_at TEXT);INSERT INTO local_users VALUES('2099-01-01');CREATE TABLE sync_outbox(change_id TEXT,account_id TEXT,payload_json TEXT);INSERT INTO sync_outbox VALUES('newer-intent','original-author','immutable newer work');").unwrap();
        c.execute(
            "INSERT INTO local_recovery_custodian VALUES(1,'owner',?1,'custodian-digest')",
            [trusted().unwrap()],
        )
        .unwrap();
        drop(c);
        fs::write(root.join(KEY_FILE), b"damaged Windows envelope").unwrap();
        assert!(repair_from_verified_copy(
            &root,
            &wrong,
            "owner",
            &trusted().unwrap(),
            "custodian-digest",
            || Ok(()),
            || Ok(())
        )
        .is_err());
        assert_eq!(
            fs::read(root.join(KEY_FILE)).unwrap(),
            b"damaged Windows envelope"
        );
        assert!(repair_from_verified_copy(
            &root,
            &candidate,
            "other-owner",
            &trusted().unwrap(),
            "custodian-digest",
            || Ok(()),
            || Ok(())
        )
        .is_err());
        assert!(repair_from_verified_copy(
            &root,
            &candidate,
            "owner",
            &trusted().unwrap(),
            "custodian-digest",
            || Err("cancelled".into()),
            || Ok(())
        )
        .is_err());
        repair_from_verified_copy(
            &root,
            &candidate,
            "owner",
            &trusted().unwrap(),
            "custodian-digest",
            || Ok(()),
            || Ok(()),
        )
        .unwrap();
        let repaired = load(&root).unwrap();
        let c = crate::encrypted_database::open(&root.join("labos-local.db"), &**repaired, false)
            .unwrap();
        assert_eq!(
            c.query_row("SELECT account_id,payload_json FROM sync_outbox", [], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .unwrap(),
            ("original-author".into(), "immutable newer work".into())
        );
        assert_eq!(
            c.query_row("SELECT count(*) FROM authored", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
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
        drop(c);
        fs::remove_dir_all(parent).unwrap();
    }
    #[test]
    fn protected_workspace_adapters_keep_exports_plain_and_never_downgrade_after_key_loss() {
        let root =
            std::env::temp_dir().join(format!("labos-working-adapters-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let managed = root.join("managed");
        let restored = root.join("recovered");
        fs::create_dir(&managed).unwrap();
        fs::create_dir(&restored).unwrap();
        let key = ensure_key(&managed).unwrap();
        let portable = export_key(&managed).unwrap().unwrap();
        let source = managed.join("file");
        let payload = vec![71; 2 * managed_encryption::CHUNK + 13];
        write_new(&source, &payload).unwrap();
        assert_ne!(fs::read(&source).unwrap(), payload);
        assert_eq!(len(&source).unwrap(), payload.len() as u64);
        let mut reader = open(&source).unwrap();
        reader.seek(SeekFrom::End(-13)).unwrap();
        let mut tail = Vec::new();
        reader.read_to_end(&mut tail).unwrap();
        assert_eq!(tail, vec![71; 13]);
        drop(reader);
        let outside = root.join("user-export");
        copy_new(&source, &outside, payload.len() as u64).unwrap();
        assert_eq!(fs::read(outside).unwrap(), payload);
        let stage = managed.join("staging");
        create_staging(&stage, payload.len() as u64).unwrap();
        assert!(append(
            &stage,
            payload.len() as u64 + 1,
            0,
            &payload[..managed_encryption::CHUNK]
        )
        .is_err());
        append(
            &stage,
            payload.len() as u64,
            0,
            &payload[..managed_encryption::CHUNK],
        )
        .unwrap();
        assert_eq!(
            staged_len(&stage).unwrap(),
            managed_encryption::CHUNK as u64
        );
        assert!(open(&stage).is_err());
        append(
            &stage,
            payload.len() as u64,
            managed_encryption::CHUNK as u64,
            &payload[managed_encryption::CHUNK..],
        )
        .unwrap();
        assert_eq!(len(&stage).unwrap(), payload.len() as u64);
        let swapped = managed.join("swapped");
        fs::copy(&source, &swapped).unwrap();
        assert!(
            open(&swapped).is_err(),
            "ciphertext from another resource cannot authenticate at this path"
        );
        import_key(&restored, &portable, &trusted().unwrap()).unwrap();
        fs::copy(&source, restored.join("file")).unwrap();
        let mut bytes = Vec::new();
        open(&restored.join("file"))
            .unwrap()
            .read_to_end(&mut bytes)
            .unwrap();
        assert_eq!(bytes, payload);
        fs::remove_file(managed.join(KEY_FILE)).unwrap();
        assert_eq!(
            ensure_key(&managed).unwrap().as_ref().as_slice(),
            key.as_ref().as_slice()
        );
        fs::write(managed.join("plain-injected"), b"not encrypted").unwrap();
        assert!(open(&managed.join("plain-injected")).is_err());
        let absent = root.join("lost-key");
        fs::create_dir(&absent).unwrap();
        fs::write(absent.join("labos-local.db"), b"opaque encrypted header").unwrap();
        assert!(ensure_key(&absent).is_err());
        assert!(!absent.join(KEY_FILE).exists());
        drop(key);
        fs::remove_dir_all(root).unwrap();
    }
}
