//! Portable encrypted backup, with a consistent SQLite snapshot and verified
//! relative-file catalogue. Restore is always into a new isolated directory.
use crate::recovery_crypto::{Decrypt, Encrypt};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};
use zeroize::Zeroizing;
const MANIFEST: &str = ".labos-package-manifest.json";
const DB: &str = "labos-local.db";
const WORKING_KEY:&str=".labos-working-key.json";
const MAX_FILES: usize = 100000;
const MAX_BYTES: u64 = 50 * 1024 * 1024 * 1024;
const MAX_DATABASE: u64 = 256 * 1024 * 1024;
const MAX_MANIFEST: u64 = 32 * 1024 * 1024;
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    size: u64,
    sha256: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    version: u32,
    files: BTreeMap<String, Entry>,
}
#[derive(Serialize)]
pub(crate) struct Verified {
    pub files: usize,
    pub bytes: u64,
    pub backup_id: String,
    pub owner_account_id: String,
    pub server_origin: String,
    #[serde(skip)]
    pub master: crate::recovery_crypto::SecretKey,
    #[serde(skip)]
    pub package_sha256:String,
    #[serde(skip)]
    pub package_size:u64,
    #[serde(skip)]
    pub pending:Option<Vec<crate::recovery_retention::Intent>>,
}
pub(crate) fn safe_path(raw: &str) -> Result<PathBuf, String> {
    if raw.is_empty()
        || raw.len() > 4096
        || raw.contains('\\')
        || raw.split('/').any(|part| {
            let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
            part.is_empty()
                || part == "."
                || part == ".."
                || part.ends_with(['.', ' '])
                || part
                    .chars()
                    .any(|c| c.is_control() || "<>:\"|?*".contains(c))
                || matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
                || ((stem.starts_with("COM") || stem.starts_with("LPT"))
                    && stem.len() == 4
                    && stem.as_bytes()[3].is_ascii_digit())
        })
    {
        return Err("Recovery package contains an unsafe path".into());
    }
    Ok(raw.split('/').collect())
}
fn link(path: &Path) -> Result<bool, String> {
    let meta = fs::symlink_metadata(path).map_err(err)?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return Ok(true);
        }
    }
    Ok(meta.file_type().is_symlink())
}
fn excluded(path: &str) -> bool {
    matches!(
        path,
        DB | "labos-local.db-wal"
            | "labos-local.db-shm"
            | "labos-local.db-journal"
            | "recovery-key.dpapi" | ".workspace-key.dpapi" | ".workspace-encryption.json" | ".workspace-migration.pending.dpapi"
    ) || path.split('/').next().is_some_and(|name|name.starts_with(".workspace-repair-")) || ((path.starts_with("recovery-key-retired-")||path.starts_with(".workspace-key-retired-"))&&path.ends_with(".dpapi")) || ((path.starts_with(".workspace-key-")||path.starts_with(".workspace-encryption-")||path.starts_with(".migration-"))&&path.ends_with(".partial")) || path
        .split('/')
        .next()
        .is_some_and(|p| matches!(p, "EBWebView" | "WebView2"))
}
fn walk(
    root: &Path,
    relative: &str,
    files: &mut Vec<(String, PathBuf)>,
    total: &mut u64,
) -> Result<(), String> {
    for item in fs::read_dir(root.join(relative)).map_err(err)? {
        let item = item.map_err(err)?;
        let name = item
            .file_name()
            .into_string()
            .map_err(|_| "Recovery paths must be valid Unicode")?;
        let relative = if relative.is_empty() {
            name
        } else {
            format!("{relative}/{name}")
        };
        if excluded(&relative) {
            continue;
        }
        safe_path(&relative)?;
        if link(&item.path())? {
            return Err(
                "Recovery backup does not follow symbolic links or Windows reparse points".into(),
            );
        }
        let meta = item.metadata().map_err(err)?;
        if meta.is_dir() {
            walk(root, &relative, files, total)?;
        } else if meta.is_file() {
            if relative == MANIFEST || relative == WORKING_KEY {
                return Err("A managed file conflicts with the reserved recovery catalogue".into());
            }
            *total = total
                .checked_add(meta.len())
                .ok_or("Recovery size overflow")?;
            if *total > MAX_BYTES || files.len() >= MAX_FILES {
                return Err(
                    "Recovery backup exceeds 50 GiB or 100,000 files; originals remain unchanged"
                        .into(),
                );
            }
            files.push((relative, item.path()));
        } else {
            return Err("Unsupported managed file in recovery backup".into());
        }
    }
    Ok(())
}
fn snapshot(c: &Connection) -> Result<(Zeroizing<Vec<u8>>,Option<Vec<crate::recovery_retention::Intent>>), String> {
    let pages: i64 = c
        .pragma_query_value(None, "page_count", |r| r.get(0))
        .map_err(err)?;
    let size: i64 = c
        .pragma_query_value(None, "page_size", |r| r.get(0))
        .map_err(err)?;
    if pages < 0 || size < 0 || (pages as u64).saturating_mul(size as u64) > MAX_DATABASE {
        return Err(
            "SQLite recovery snapshot exceeds its 256 MiB memory bound; database unchanged".into(),
        );
    }
    #[cfg(feature="working-encryption")]
    {return crate::encrypted_database::snapshot(c,MAX_DATABASE);}
    #[cfg(not(feature="working-encryption"))]
    {
    let mut copy = Connection::open_in_memory().map_err(err)?;
    {
        let backup = rusqlite::backup::Backup::new(c, &mut copy).map_err(err)?;
        let deadline = std::time::Instant::now() + Duration::from_secs(30);
        loop {
            if std::time::Instant::now() > deadline {
                return Err("SQLite backup is busy; retry after writes finish".into());
            }
            match backup.step(128).map_err(err)? {
                rusqlite::backup::StepResult::Done => break,
                rusqlite::backup::StepResult::More => {}
                _ => std::thread::sleep(Duration::from_millis(10)),
            }
        }
    }
    copy.pragma_update(None, "journal_mode", "MEMORY")
        .map_err(err)?;
    let bytes = crate::sqlite_snapshot::serialize(&copy,"main",MAX_DATABASE)?;
    if bytes.len() as u64 > MAX_DATABASE {
        return Err("SQLite snapshot exceeds its memory bound".into());
    }
    let pending=crate::recovery_retention::pending_intents(&copy)?;
    Ok((Zeroizing::new(bytes.to_vec()),pending))
    }
}
struct HashReader<R: Read> {
    reader: R,
    hash: Sha256,
    bytes: u64,
}
impl<R: Read> Read for HashReader<R> {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        let n = self.reader.read(out)?;
        self.hash.update(&out[..n]);
        self.bytes += n as u64;
        Ok(n)
    }
}
struct GuardedReader<R, F> {
    reader: R,
    guard: F,
    until_check: usize,
}
impl<R: Read, F: FnMut() -> Result<(), String>> Read for GuardedReader<R, F> {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        if self.until_check == 0 {
            (self.guard)().map_err(|e| io::Error::new(io::ErrorKind::PermissionDenied, e))?;
            self.until_check = CHUNK;
        }
        let n = self.reader.read(out)?;
        self.until_check = self.until_check.saturating_sub(n);
        Ok(n)
    }
}
fn append<W: Write, R: Read>(
    archive: &mut tar::Builder<W>,
    path: &str,
    size: u64,
    reader: R,
) -> Result<Entry, String> {
    let mut header = tar::Header::new_gnu();
    header.set_size(size);
    header.set_mode(0o600);
    header.set_mtime(0);
    header.set_cksum();
    let mut input = HashReader {
        reader,
        hash: Sha256::new(),
        bytes: 0,
    };
    archive
        .append_data(&mut header, path, &mut input)
        .map_err(err)?;
    if input.bytes != size {
        return Err("Recovery source changed or became incomplete".into());
    }
    Ok(Entry {
        size,
        sha256: format!("{:x}", input.hash.finalize()),
    })
}
#[cfg(test)]
pub(crate) fn create(
    c: &Connection,
    root: &Path,
    target: &Path,
    master: &[u8],
    secret: &str,
    owner: &str,
    origin: &str,
    guard: impl FnMut() -> Result<(), String>,
) -> Result<Verified, String> {
    create_with_publication_guard(
        c,
        root,
        target,
        master,
        secret,
        owner,
        origin,
        guard,
        || Ok(()),
    )
}
pub(crate) fn create_with_publication_guard(
    c: &Connection,
    root: &Path,
    target: &Path,
    master: &[u8],
    secret: &str,
    owner: &str,
    origin: &str,
    mut guard: impl FnMut() -> Result<(), String>,
    mut publication_guard: impl FnMut() -> Result<(), String>,
) -> Result<Verified, String> {
    guard()?;
    let root = root.canonicalize().map_err(err)?;
    let parent = target
        .parent()
        .ok_or("Choose an external backup folder")?
        .canonicalize()
        .map_err(err)?;
    if crate::local_resource_export::within(&parent, &root) {
        return Err("Save the recovery package outside LabOS managed storage".into());
    }
    let temp = parent.join(format!(".labos-recovery-{}.partial", uuid::Uuid::new_v4()));
    let result = (|| {
        let (database,pending) = snapshot(c)?;
        guard()?;
        let mut paths = Vec::new();
        let mut total = database.len() as u64;
        walk(&root, "", &mut paths, &mut total)?;
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(err)?;
        let working_key=crate::working_store::export_key(&root)?;
        let writer = Encrypt::new_version(file, master, secret, owner, origin,if working_key.is_some(){2}else{1}).map_err(err)?;
        let mut archive = tar::Builder::new(writer);
        let mut files = BTreeMap::new();
        files.insert(
            DB.into(),
            append(&mut archive, DB, database.len() as u64, &database[..])?,
        );
        if let Some(key)=working_key{files.insert(WORKING_KEY.into(),append(&mut archive,WORKING_KEY,key.len()as u64,&key[..])?);}
        let mut source_versions = Vec::new();
        for (name, path) in paths {
            guard()?;
            let mut input = File::open(&path).map_err(err)?;
            let before = input.metadata().map_err(err)?;
            let record = append(
                &mut archive,
                &name,
                before.len(),
                GuardedReader {
                    reader: &mut input,
                    guard: &mut guard,
                    until_check: 0,
                },
            )?;
            let after = input.metadata().map_err(err)?;
            if after.len() != before.len() || after.modified().ok() != before.modified().ok() {
                return Err(
                    "A managed file changed during backup; retry after file activity finishes"
                        .into(),
                );
            }
            source_versions.push((path, before.len(), before.modified().ok()));
            files.insert(name, record);
        }
        let catalogue = serde_json::to_vec(&Manifest { version: 1, files }).map_err(err)?;
        if catalogue.len() as u64 > MAX_MANIFEST {
            return Err("Recovery catalogue exceeds its bound".into());
        }
        append(
            &mut archive,
            MANIFEST,
            catalogue.len() as u64,
            &catalogue[..],
        )?;
        let output = archive.into_inner().map_err(err)?.finish().map_err(err)?;
        output.sync_all().map_err(err)?;
        drop(output);
        let mut verified = verify_guarded(&temp, secret, None, Some((owner, origin)), &mut guard)?;
        verified.pending=pending;
        if verified.master.as_slice() != master {
            return Err("Recovery key verification failed".into());
        }
        for (path, size, modified) in source_versions {
            let now = fs::metadata(path).map_err(err)?;
            if now.len() != size || now.modified().ok() != modified {
                return Err("A managed file changed before backup publication; retry after file activity finishes".into());
            }
        }
        guard()?;
        publication_guard()?;
        crate::local_resource_export::replace(&temp, target)?;
        Ok(verified)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}
#[cfg(test)]
pub(crate) fn verify(
    package: &Path,
    secret: &str,
    destination: Option<&Path>,
    expected: Option<(&str, &str)>,
) -> Result<Verified, String> {
    verify_guarded(package, secret, destination, expected, &mut || Ok(()))
}
pub(crate) fn verify_guarded(
    package: &Path,
    secret: &str,
    destination: Option<&Path>,
    expected: Option<(&str, &str)>,
    guard: &mut impl FnMut() -> Result<(), String>,
) -> Result<Verified, String> {
    guard()?;
    let reader = Decrypt::new(HashReader{reader:File::open(package).map_err(err)?,hash:Sha256::new(),bytes:0}, secret).map_err(err)?;
    let identity = reader.identity.clone();
    if let Some((owner, origin)) = expected {
        if identity.owner_account_id != owner || identity.server_origin != origin {
            return Err("Recovery package belongs to a different custodian or LabOS server".into());
        }
    }
    let mut archive = tar::Archive::new(reader);
    let mut actual = BTreeMap::new();
    let mut canonical = HashSet::new();
    let mut catalogue = None;
    let mut total = 0u64;
    for entry in archive.entries().map_err(err)? {
        guard()?;
        let mut entry = entry.map_err(err)?;
        if !entry.header().entry_type().is_file() {
            return Err("Recovery archive contains a link, directory or unsupported entry".into());
        }
        let raw = entry
            .path()
            .map_err(err)?
            .to_str()
            .ok_or("Invalid recovery path")?
            .to_owned();
        let path = safe_path(&raw)?;
        if raw!=DB&&excluded(&raw){return Err("Recovery package contains device access material or a nonportable workspace file".into())}
        if !canonical.insert(raw.to_lowercase()) || actual.len() >= MAX_FILES || catalogue.is_some()
        {
            return Err(
                "Recovery archive contains duplicate paths or data after its catalogue".into(),
            );
        }
        let size = entry.size();
        total = total.checked_add(size).ok_or("Recovery size overflow")?;
        if total > MAX_BYTES {
            return Err("Recovery archive exceeds its size bound".into());
        }
        if raw == MANIFEST {
            if size > MAX_MANIFEST {
                return Err("Recovery catalogue exceeds its bound".into());
            }
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).map_err(err)?;
            catalogue = Some(serde_json::from_slice::<Manifest>(&bytes).map_err(err)?);
            continue;
        }
        if raw==WORKING_KEY{
            if identity.version!=2||size>4096{return Err("Unsupported recovery working-key entry".into())}
            let mut bytes=Zeroizing::new(Vec::new());entry.read_to_end(&mut bytes).map_err(err)?;if bytes.len()as u64!=size{return Err("Incomplete recovered working key".into())}
            crate::working_store::validate_export(&bytes,&identity.server_origin)?;
            if let Some(root)=destination{crate::working_store::import_key(root,&bytes,&identity.server_origin)?;}
            actual.insert(raw,Entry{size,sha256:format!("{:x}",Sha256::digest(&bytes))});continue;
        }
        if raw == DB && size > MAX_DATABASE {
            return Err("Recovery database exceeds its bound".into());
        }
        let mut file = if let Some(root) = destination {
            let target = root.join(&path);
            let parent = target.parent().ok_or("Invalid recovery destination")?;
            fs::create_dir_all(parent).map_err(err)?;
            Some(
                OpenOptions::new()
                    .create_new(true)
                    .write(true)
                    .open(target)
                    .map_err(err)?,
            )
        } else {
            None
        };
        let mut hash = Sha256::new();
        let mut bytes = 0u64;
        let mut buffer = Zeroizing::new(vec![0; CHUNK]);
        loop {
            guard()?;
            let n = entry.read(&mut buffer).map_err(err)?;
            if n == 0 {
                break;
            }
            hash.update(&buffer[..n]);
            bytes += n as u64;
            if let Some(file) = file.as_mut() {
                file.write_all(&buffer[..n]).map_err(err)?;
            }
        }
        if bytes != size {
            return Err("Incomplete recovery entry".into());
        }
        if let Some(file) = file {
            file.sync_all().map_err(err)?;
        }
        actual.insert(
            raw,
            Entry {
                size,
                sha256: format!("{:x}", hash.finalize()),
            },
        );
    }
    let catalogue = catalogue.ok_or("Missing recovery catalogue")?;
    if catalogue.version != 1 || catalogue.files != actual || !actual.contains_key(DB) {
        return Err("Recovery file catalogue does not match its contents".into());
    }
    // tar stops at its end markers. Drain through the authenticated final record
    // so a truncated package cannot masquerade as a complete archive.
    let mut reader = archive.into_inner();
    let mut tail = [0; 4096];
    let mut padding = 0;
    loop {
        let n = reader.read(&mut tail).map_err(err)?;
        if n == 0 {
            break;
        }
        padding += n;
        if padding > 1024 * 1024 || tail[..n].iter().any(|b| *b != 0) {
            return Err("Unexpected recovery archive trailer".into());
        }
    }
    if (identity.version==2)!=actual.contains_key(WORKING_KEY){return Err("Recovery package working-key format is incomplete".into())}
    if let Some(root) = destination {
        let c = Connection::open(root.join(DB)).map_err(err)?;
        let integrity: String = c
            .pragma_query_value(None, "integrity_check", |r| r.get(0))
            .map_err(err)?;
        if integrity != "ok" {
            return Err("Recovered SQLite integrity check failed".into());
        }
    }
    guard()?;
    let master=reader.master.clone();let input=reader.into_verified_input().map_err(err)?;let package_sha256=format!("{:x}",input.hash.finalize());let package_size=input.bytes;
    Ok(Verified {
        files: actual.len(),
        bytes: actual.values().map(|v| v.size).sum(),
        backup_id: identity.backup_id,
        owner_account_id: identity.owner_account_id,
        server_origin: identity.server_origin,
        master,package_sha256,package_size,pending:None,
    })
}
const CHUNK: usize = 1024 * 1024;

#[cfg(test)]
mod tests {
    use super::*;
    const OWNER: &str = "11111111-1111-4111-8111-111111111111";
    const SECRET: &str = "a separate long recovery secret for tests";
    #[test]
    fn rejected_publication_preserves_the_existing_backup_after_full_crypto_verification(){
        let root=std::env::temp_dir().join(format!("labos-recovery-publication-{}",uuid::Uuid::new_v4()));fs::create_dir(&root).unwrap();let source=root.join("source");fs::create_dir(&source).unwrap();let c=Connection::open(source.join(DB)).unwrap();c.execute_batch("CREATE TABLE authored(value TEXT);INSERT INTO authored VALUES('original');").unwrap();let target=root.join("existing.package");fs::write(&target,b"existing backup").unwrap();let key=crate::recovery_crypto::random_key();
        let result=create_with_publication_guard(&c,&source,&target,&*key,SECRET,OWNER,"origin",||Ok(()),||Err("cancelled at commit boundary".into()));assert!(result.err().unwrap().contains("commit boundary"));assert_eq!(fs::read(&target).unwrap(),b"existing backup");assert_eq!(fs::read_dir(&root).unwrap().count(),2);assert_eq!(c.query_row("SELECT value FROM authored",[],|r|r.get::<_,String>(0)).unwrap(),"original");drop(c);fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn disk_sqlite_wal_outbox_and_files_round_trip_without_modifying_originals() {
        let root =
            std::env::temp_dir().join(format!("labos-recovery-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let source = root.join("source");
        let restored = root.join("restored");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&restored).unwrap();
        let c = Connection::open(source.join(DB)).unwrap();
        c.execute_batch("PRAGMA journal_mode=WAL;CREATE TABLE authored(id TEXT PRIMARY KEY,payload TEXT);INSERT INTO authored VALUES('change-1','preserved author and immutable payload');").unwrap();
        fs::create_dir(source.join("resource-files")).unwrap();
        fs::write(
            source.join("resource-files/content"),
            vec![23; 1024 * 1024 + 3],
        )
        .unwrap();
        let package = root.join("backup.labos-recovery");
        let key = crate::recovery_crypto::random_key();
        let verified = create(
            &c,
            &source,
            &package,
            &*key,
            SECRET,
            OWNER,
            "origin",
            || Ok(()),
        )
        .unwrap();
        assert_eq!(verified.files, 2);
        verify(&package, SECRET, Some(&restored), Some((OWNER, "origin"))).unwrap();
        let copy = Connection::open(restored.join(DB)).unwrap();
        assert_eq!(
            copy.query_row(
                "SELECT payload FROM authored WHERE id='change-1'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "preserved author and immutable payload"
        );
        assert_eq!(
            fs::read(source.join("resource-files/content")).unwrap(),
            fs::read(restored.join("resource-files/content")).unwrap()
        );
        assert!(verify(
            &package,
            "another separate long recovery secret",
            None,
            None
        )
        .is_err());
        assert!(verify(&package, SECRET, None, Some((OWNER, "different origin"))).is_err());
        drop(copy);
        drop(c);
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn version_two_package_rewraps_working_key_without_exposing_portable_key_on_disk(){
        let root=std::env::temp_dir().join(format!("labos-recovery-working-key-{}",uuid::Uuid::new_v4()));fs::create_dir(&root).unwrap();let source=root.join("source");let restored=root.join("restored");fs::create_dir(&source).unwrap();fs::create_dir(&restored).unwrap();let origin=crate::native_authorization::trusted_base().unwrap();crate::working_store::ensure_key(&source).unwrap();let c=Connection::open(source.join(DB)).unwrap();c.execute_batch("CREATE TABLE authored(author TEXT,payload TEXT);INSERT INTO authored VALUES('owner','preserved');").unwrap();fs::create_dir(source.join("resource-files")).unwrap();crate::working_store::write_new(&source.join("resource-files/content"),b"working encrypted bytes").unwrap();let package=root.join("package");let master=crate::recovery_crypto::random_key();create(&c,&source,&package,&*master,SECRET,OWNER,&origin,||Ok(())).unwrap();let verified=verify(&package,SECRET,Some(&restored),Some((OWNER,&origin))).unwrap();assert_eq!(verified.files,3);assert!(!restored.join(WORKING_KEY).exists());assert!(restored.join(".workspace-key.dpapi").exists());let mut bytes=Vec::new();crate::working_store::open(&restored.join("resource-files/content")).unwrap().read_to_end(&mut bytes).unwrap();assert_eq!(bytes,b"working encrypted bytes");assert_ne!(fs::read(restored.join("resource-files/content")).unwrap(),bytes);drop(c);fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn unsafe_paths_and_case_collisions_are_not_accepted() {
        for name in [
            "../escape",
            "/absolute",
            "a//b",
            "C:/file",
            "a\\b",
            "CON.txt",
            "a/b.",
            "a/b ",
        ] {
            assert!(safe_path(name).is_err(), "{name}");
        }
        assert_eq!(
            safe_path("resource-files/account/content").unwrap(),
            PathBuf::from("resource-files/account/content")
        );
    }
    #[test]
    fn cancelled_backup_preserves_existing_destination_and_authored_database() {
        let root =
            std::env::temp_dir().join(format!("labos-recovery-cancel-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let source = root.join("source");
        fs::create_dir(&source).unwrap();
        let c = Connection::open(source.join(DB)).unwrap();
        c.execute_batch(
            "CREATE TABLE authored(value TEXT);INSERT INTO authored VALUES('untouched');",
        )
        .unwrap();
        let target = root.join("existing.package");
        fs::write(&target, b"previous verified backup").unwrap();
        let key = crate::recovery_crypto::random_key();
        let mut calls = 0;
        let error = create(&c, &source, &target, &*key, SECRET, OWNER, "origin", || {
            calls += 1;
            if calls > 2 {
                Err("session changed".into())
            } else {
                Ok(())
            }
        })
        .err()
        .unwrap();
        assert!(error.contains("session changed"));
        assert_eq!(fs::read(&target).unwrap(), b"previous verified backup");
        assert_eq!(
            c.query_row("SELECT value FROM authored", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "untouched"
        );
        assert_eq!(fs::read_dir(&root).unwrap().count(), 2);
        drop(c);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn authenticated_package_still_rejects_wrong_catalogue_and_special_entries() {
        let root =
            std::env::temp_dir().join(format!("labos-recovery-invalid-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let key = crate::recovery_crypto::random_key();
        for special in [false, true] {
            let package = root.join(if special {
                "link.package"
            } else {
                "catalogue.package"
            });
            let writer = Encrypt::new(
                File::create(&package).unwrap(),
                &*key,
                SECRET,
                OWNER,
                "origin",
            )
            .unwrap();
            let mut archive = tar::Builder::new(writer);
            if special {
                let mut header = tar::Header::new_gnu();
                header.set_size(0);
                header.set_entry_type(tar::EntryType::Symlink);
                header.set_mode(0o600);
                header.set_link_name("../outside").unwrap();
                header.set_cksum();
                archive
                    .append_data(&mut header, "unsafe", &b""[..])
                    .unwrap();
            } else {
                append(&mut archive, DB, 3, &b"bad"[..]).unwrap();
                let bad = serde_json::to_vec(&Manifest {
                    version: 1,
                    files: BTreeMap::new(),
                })
                .unwrap();
                append(&mut archive, MANIFEST, bad.len() as u64, &bad[..]).unwrap();
            }
            archive
                .into_inner()
                .unwrap()
                .finish()
                .unwrap()
                .sync_all()
                .unwrap();
            assert!(verify(&package, SECRET, None, Some((OWNER, "origin"))).is_err());
        }
        fs::remove_dir_all(root).unwrap();
    }
}
