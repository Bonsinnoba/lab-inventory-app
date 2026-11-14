//! Resumable single-file conversion. A protected journal is sealed only after
//! both encrypted originals and replacement bytes are durable and verified.
//! Never invoked on the live profile until its SQLCipher startup gate is ready.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};
use zeroize::Zeroizing;
const JOURNAL: &str = ".workspace-migration.pending.dpapi";
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Plan {
    version: u32,
    root: String,
    origin: String,
    relative: String,
    original_sha: String,
    original_size: u64,
    replacement_sha: String,
    replacement_size: u64,
    archive: String,
    shadow: String,
    #[serde(default)]
    sidecars: Vec<Sidecar>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Sidecar {
    relative: String,
    archive: String,
    sha: String,
    size: u64,
}
fn no_link(path: &Path) -> Result<(), String> {
    let m = fs::symlink_metadata(path).map_err(err)?;
    if m.file_type().is_symlink() {
        return Err("Migration cannot follow links".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if m.file_attributes() & 0x400 != 0 {
            return Err("Migration cannot follow reparse points".into());
        }
    }
    Ok(())
}
fn scoped(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    if path.is_absolute()
        || path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("Invalid migration path".into());
    }
    let mut current = root.to_path_buf();
    for part in path.components() {
        current.push(part);
        if current.exists() {
            no_link(&current)?;
        }
    }
    let parent = current
        .parent()
        .ok_or("Migration parent missing")?
        .canonicalize()
        .map_err(err)?;
    if !crate::local_resource_export::within(&parent, root) {
        return Err("Migration path leaves its profile".into());
    }
    Ok(current)
}
fn pinned(path: &Path) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(1 | 4);
    }
    options.open(path).map_err(err)
}
fn hash(mut input: impl Read) -> Result<(String, u64), String> {
    let mut h = Sha256::new();
    let mut total = 0;
    let mut b = Zeroizing::new(vec![0; 1024 * 1024]);
    loop {
        let n = input.read(&mut b).map_err(err)?;
        if n == 0 {
            break;
        }
        total += n as u64;
        if total > 50 * 1024 * 1024 * 1024 {
            return Err("Migration file exceeds its bound".into());
        }
        h.update(&b[..n]);
    }
    Ok((format!("{:x}", h.finalize()), total))
}
fn identity(root: &Path) -> String {
    format!(
        "{:x}",
        Sha256::digest(root.to_string_lossy().to_lowercase().as_bytes())
    )
}
fn origin() -> Result<String, String> {
    crate::native_authorization::trusted_base().map_err(|e| e.message)
}
fn seal(root: &Path, plan: &Plan) -> Result<(), String> {
    let clear = Zeroizing::new(serde_json::to_vec(plan).map_err(err)?);
    let protected = crate::recovery_protection::protect(&clear)?;
    let partial = root.join(format!(".migration-{}.partial", uuid::Uuid::new_v4()));
    let mut out = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&partial)
        .map_err(err)?;
    out.write_all(&protected).map_err(err)?;
    out.sync_all().map_err(err)?;
    drop(out);
    let result = crate::profile_recovery::publish_new(&partial, &root.join(JOURNAL));
    if result.is_err() {
        let _ = fs::remove_file(partial);
    }
    result
}
fn load(root: &Path) -> Result<Plan, String> {
    let path = root.join(JOURNAL);
    no_link(&path)?;
    if fs::metadata(&path).map_err(err)?.len() > 65536 {
        return Err("Invalid migration journal size".into());
    }
    let clear = crate::recovery_protection::unprotect(&fs::read(path).map_err(err)?)?;
    let plan: Plan =
        serde_json::from_slice(&clear).map_err(|_| "Invalid protected migration journal")?;
    if plan.version != 1 || plan.root != identity(root) || plan.origin != origin()? {
        return Err("Migration journal belongs to another profile or server".into());
    }
    for (name, prefix, suffix) in [
        (&plan.archive, ".encrypted-originals/", ".original"),
        (&plan.shadow, ".working-migration-", ".shadow"),
    ] {
        let id = name
            .strip_prefix(prefix)
            .and_then(|n| n.strip_suffix(suffix))
            .ok_or("Invalid migration artifact")?;
        if uuid::Uuid::parse_str(id).map_err(err)?.to_string() != id {
            return Err("Invalid migration artifact identity".into());
        }
    }
    Ok(plan)
}
/// Complete only this sealed transition. Original archives remain encrypted and
/// retained after success; no recursive cleanup and no missing-file guessing.
pub(crate) fn resume(root: &Path, key: &[u8]) -> Result<(), String> {
    resume_with_guard(root, key, || Ok(()))
}
fn resume_with_guard(
    root: &Path,
    key: &[u8],
    mut before_install: impl FnMut() -> Result<(), String>,
) -> Result<(), String> {
    let root = root.canonicalize().map_err(err)?;
    no_link(&root)?;
    if !root.join(JOURNAL).exists() {
        return Ok(());
    }
    let plan = load(&root)?;
    let source = scoped(&root, &plan.relative)?;
    let archive = scoped(&root, &plan.archive)?;
    let shadow = scoped(&root, &plan.shadow)?;
    let preserved = hash(crate::managed_encryption::Reader::open(&archive, key).map_err(err)?)?;
    if preserved != (plan.original_sha.clone(), plan.original_size) {
        return Err("Encrypted original does not match its journal; active work preserved".into());
    }
    let mut sidecar_pins = Vec::new();
    if plan.relative == "labos-local.db" {
        for suffix in ["-wal", "-shm", "-journal"] {
            let name = format!("labos-local.db{suffix}");
            let path = scoped(&root, &name)?;
            if path.exists() && !plan.sidecars.iter().any(|s| s.relative == name) {
                return Err("Unrecorded database sidecar appeared; migration paused".into());
            }
        }
    } else if !plan.sidecars.is_empty() {
        return Err("Only a database transition may include journal sidecars".into());
    }
    for sidecar in &plan.sidecars {
        if ![
            "labos-local.db-wal",
            "labos-local.db-shm",
            "labos-local.db-journal",
        ]
        .contains(&sidecar.relative.as_str())
        {
            return Err("Invalid database sidecar".into());
        }
        let id = sidecar
            .archive
            .strip_prefix(".encrypted-originals/")
            .and_then(|v| v.strip_suffix(".original"))
            .ok_or("Invalid sidecar archive")?;
        uuid::Uuid::parse_str(id).map_err(err)?;
        if hash(
            crate::managed_encryption::Reader::open(&scoped(&root, &sidecar.archive)?, key)
                .map_err(err)?,
        )? != (sidecar.sha.clone(), sidecar.size)
        {
            return Err("Preserved database sidecar failed verification".into());
        }
        let path = scoped(&root, &sidecar.relative)?;
        if path.exists() {
            let pin = pinned(&path)?;
            if hash(&pin)? != (sidecar.sha.clone(), sidecar.size) {
                return Err("Database sidecar changed; original work preserved".into());
            }
            sidecar_pins.push((path, pin));
        }
    }
    let id = plan
        .shadow
        .strip_prefix(".working-migration-")
        .and_then(|value| value.strip_suffix(".shadow"))
        .ok_or("Invalid migration identity")?;
    let retired = scoped(&root, &format!(".working-original-{id}.retired"))?;
    let replacement = (plan.replacement_sha.clone(), plan.replacement_size);
    let original = (plan.original_sha.clone(), plan.original_size);
    let mut held_original = None;
    if source.exists() {
        let pin = pinned(&source)?;
        let current = hash(&pin)?;
        if current == original {
            if retired.exists() {
                return Err("Both original locations exist; preserve them for recovery".into());
            }
            if hash(pinned(&shadow)?)? != replacement {
                return Err("Migration shadow changed; original remains active".into());
            }
            crate::profile_recovery::publish_new(&source, &retired)?;
            held_original = Some(pin);
        } else if current != replacement {
            return Err("Workspace changed after migration preparation; all work preserved".into());
        }
    }
    if !source.exists() {
        if held_original.is_none() {
            let pin = pinned(&retired)?;
            if hash(&pin)? != original {
                return Err("Retired original failed migration verification".into());
            }
            held_original = Some(pin);
        }
        if hash(pinned(&shadow)?)? != replacement {
            return Err("Migration shadow changed; retired original retained".into());
        }
        before_install()?;
        crate::profile_recovery::publish_new(&shadow, &source)?;
    }
    if hash(pinned(&source)?)? != replacement {
        return Err("Published migration needs recovery; encrypted original retained".into());
    }
    for (path, pin) in sidecar_pins {
        fs::remove_file(path).map_err(err)?;
        drop(pin);
    }
    if retired.exists() {
        let pin = if let Some(pin) = held_original.take() {
            pin
        } else {
            let pin = pinned(&retired)?;
            if hash(&pin)? != original {
                return Err("Retired original changed; it was preserved".into());
            }
            pin
        };
        fs::remove_file(&retired).map_err(err)?;
        drop(pin);
    }
    fs::remove_file(root.join(JOURNAL)).map_err(err)
}
/// Convert complete files or aligned, incomplete upload staging without losing
/// their declared size. The caller determines declared size from native SQLite.
pub(crate) fn stage_file(
    root: &Path,
    relative: &str,
    key: &[u8],
    declared: u64,
) -> Result<(), String> {
    stage_file_with_guard(root, relative, key, declared, || Ok(()))
}
fn stage_file_with_guard(
    root: &Path,
    relative: &str,
    key: &[u8],
    declared: u64,
    mut before_publish: impl FnMut() -> Result<(), String>,
) -> Result<(), String> {
    let root = root.canonicalize().map_err(err)?;
    if root.join(JOURNAL).exists() {
        return Err("Resume the previous migration before preparing another".into());
    }
    let source = scoped(&root, relative)?;
    let replacement_key = crate::working_store::file_key(&root, &source, key)?;
    let mut input = pinned(&source)?;
    let size = input.metadata().map_err(err)?.len();
    if size > declared || size != declared && size % crate::managed_encryption::CHUNK as u64 != 0 {
        return Err(
            "Unaligned or inconsistent staging bytes require recovery; no original was changed"
                .into(),
        );
    }
    let originals = root.join(".encrypted-originals");
    fs::create_dir_all(&originals).map_err(err)?;
    no_link(&originals)?;
    let id = uuid::Uuid::new_v4();
    let archive = format!(".encrypted-originals/{id}.original");
    let shadow = format!(".working-migration-{id}.shadow");
    let archive_path = scoped(&root, &archive)?;
    let shadow_path = scoped(&root, &shadow)?;
    let mut retained =
        crate::managed_encryption::Writer::create(&archive_path, key, size).map_err(err)?;
    crate::managed_encryption::create_staging(&shadow_path, &*replacement_key, declared)
        .map_err(err)?;
    let mut b = Zeroizing::new(vec![0; crate::managed_encryption::CHUNK]);
    let mut offset = 0;
    let mut sha = Sha256::new();
    while offset < size {
        let count = (size - offset).min(b.len() as u64) as usize;
        input.read_exact(&mut b[..count]).map_err(err)?;
        retained.write_all(&b[..count]).map_err(err)?;
        crate::managed_encryption::append(&shadow_path, &*replacement_key, offset, &b[..count])
            .map_err(err)?;
        sha.update(&b[..count]);
        offset += count as u64;
    }
    retained.finish().map_err(err)?;
    let original_sha = format!("{:x}", sha.finalize());
    if hash(crate::managed_encryption::Reader::open(&archive_path, key).map_err(err)?)?
        != (original_sha.clone(), size)
        || hash(
            crate::managed_encryption::Reader::open_prefix(
                &shadow_path,
                &*replacement_key,
                declared,
                size,
            )
            .map_err(err)?,
        )? != (original_sha.clone(), size)
    {
        return Err("Migration verification failed; original untouched".into());
    }
    let (replacement_sha, replacement_size) = hash(pinned(&shadow_path)?)?;
    let plan = Plan {
        version: 1,
        root: identity(&root),
        origin: origin()?,
        relative: relative.into(),
        original_sha,
        original_size: size,
        replacement_sha,
        replacement_size,
        archive,
        shadow,
        sidecars: Vec::new(),
    };
    seal(&root, &plan)?;
    before_publish()?;
    drop(input);
    resume(&root, key)
}

#[cfg(feature = "working-encryption")]
pub(crate) fn publish_database_shadow(
    root: &Path,
    shadow: &Path,
    key: &[u8],
) -> Result<(), String> {
    let root = root.canonicalize().map_err(err)?;
    if root.join(JOURNAL).exists() {
        return Err("Previous migration must be resumed".into());
    }
    let shadow = shadow.canonicalize().map_err(err)?;
    let name = shadow
        .file_name()
        .ok_or("Shadow name missing")?
        .to_str()
        .ok_or("Invalid shadow name")?;
    let id = name
        .strip_prefix(".working-migration-")
        .and_then(|n| n.strip_suffix(".shadow"))
        .ok_or("Invalid database shadow identity")?;
    uuid::Uuid::parse_str(id).map_err(err)?;
    if shadow.parent() != Some(root.as_path()) {
        return Err("Database shadow is not in its native profile".into());
    }
    let mut original_pins = vec![pinned(&root.join("labos-local.db"))?];
    for name in [
        "labos-local.db-wal",
        "labos-local.db-shm",
        "labos-local.db-journal",
    ] {
        let path = root.join(name);
        if path.exists() {
            original_pins.push(pinned(&path)?);
        }
    }
    // Verify logical equality while the source still includes its WAL. No caller
    // may seal a ciphertext blob merely because it exists or has the right size.
    crate::encrypted_database::validate_shadow(&root.join("labos-local.db"), &shadow, key)?;
    let originals = root.join(".encrypted-originals");
    fs::create_dir_all(&originals).map_err(err)?;
    no_link(&originals)?;
    let preserve = |relative: &str| -> Result<(String, String, u64), String> {
        let path = scoped(&root, relative)?;
        let mut input = pinned(&path)?;
        let size = input.metadata().map_err(err)?.len();
        let archive = format!(".encrypted-originals/{}.original", uuid::Uuid::new_v4());
        let mut output =
            crate::managed_encryption::Writer::create(&scoped(&root, &archive)?, key, size)
                .map_err(err)?;
        std::io::copy(&mut input, &mut output).map_err(err)?;
        output.finish().map_err(err)?;
        let (sha, count) = hash(
            crate::managed_encryption::Reader::open(&scoped(&root, &archive)?, key).map_err(err)?,
        )?;
        if count != size || hash(pinned(&path)?)? != (sha.clone(), size) {
            return Err("Original changed while preserving encryption migration".into());
        }
        Ok((archive, sha, size))
    };
    let (archive, original_sha, original_size) = preserve("labos-local.db")?;
    let mut sidecars = Vec::new();
    for name in [
        "labos-local.db-wal",
        "labos-local.db-shm",
        "labos-local.db-journal",
    ] {
        if root.join(name).exists() {
            let (archive, sha, size) = preserve(name)?;
            sidecars.push(Sidecar {
                relative: name.into(),
                archive,
                sha,
                size,
            });
        }
    }
    let (replacement_sha, replacement_size) = hash(pinned(&shadow)?)?;
    let plan = Plan {
        version: 1,
        root: identity(&root),
        origin: origin()?,
        relative: "labos-local.db".into(),
        original_sha,
        original_size,
        replacement_sha,
        replacement_size,
        archive,
        shadow: name.into(),
        sidecars,
    };
    seal(&root, &plan)?;
    let result = resume(&root, key);
    drop(original_pins);
    result
}
#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn interrupted_conversion_preserves_exact_original_and_resumes_without_erasing_it() {
        let root =
            std::env::temp_dir().join(format!("labos-working-migration-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let source = root.join("content");
        let bytes = vec![49; 1024 * 1024 + 17];
        fs::write(&source, &bytes).unwrap();
        let key = crate::recovery_crypto::random_key();
        assert!(
            stage_file_with_guard(&root, "content", &*key, bytes.len() as u64, || Err(
                "simulated power loss".into()
            ))
            .is_err()
        );
        assert_eq!(fs::read(&source).unwrap(), bytes);
        assert!(
            resume_with_guard(&root, &*key, || Err("power loss between renames".into())).is_err()
        );
        assert!(!source.exists());
        resume(&root, &*key).unwrap();
        assert_ne!(fs::read(&source).unwrap(), bytes);
        let mut out = Vec::new();
        crate::managed_encryption::Reader::open(
            &source,
            &*crate::working_store::file_key(&root, &source, &*key).unwrap(),
        )
        .unwrap()
        .read_to_end(&mut out)
        .unwrap();
        assert_eq!(out, bytes);
        assert_eq!(
            fs::read_dir(root.join(".encrypted-originals"))
                .unwrap()
                .count(),
            1
        );
        resume(&root, &*key).unwrap();
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn late_changes_tampered_journal_and_unaligned_staging_cannot_replace_authored_work() {
        let root = std::env::temp_dir().join(format!(
            "labos-working-migration-reject-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir(&root).unwrap();
        let source = root.join("content");
        fs::write(&source, b"original").unwrap();
        let key = crate::recovery_crypto::random_key();
        assert!(stage_file(&root, "content", &*key, 100).is_err());
        assert!(
            stage_file_with_guard(&root, "content", &*key, 8, || Err("interrupted".into()))
                .is_err()
        );
        fs::write(&source, b"new work").unwrap();
        assert!(resume(&root, &*key).is_err());
        assert_eq!(fs::read(&source).unwrap(), b"new work");
        let journal = root.join(JOURNAL);
        let mut bytes = fs::read(&journal).unwrap();
        let n = bytes.len() - 1;
        bytes[n] ^= 1;
        fs::write(&journal, bytes).unwrap();
        assert!(resume(&root, &*key).is_err());
        assert_eq!(fs::read(&source).unwrap(), b"new work");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn incomplete_upload_retains_declared_total_and_saved_prefix_for_retry() {
        let root = std::env::temp_dir().join(format!(
            "labos-working-migration-staging-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir(&root).unwrap();
        let p = root.join("staging");
        let chunk = vec![7; crate::managed_encryption::CHUNK];
        fs::write(&p, &chunk).unwrap();
        let key = crate::recovery_crypto::random_key();
        let total = chunk.len() as u64 + 3;
        stage_file(&root, "staging", &*key, total).unwrap();
        assert!(crate::managed_encryption::Reader::open(
            &p,
            &*crate::working_store::file_key(&root, &p, &*key).unwrap()
        )
        .is_err());
        crate::managed_encryption::append(
            &p,
            &*crate::working_store::file_key(&root, &p, &*key).unwrap(),
            chunk.len() as u64,
            b"end",
        )
        .unwrap();
        let mut reader = crate::managed_encryption::Reader::open(
            &p,
            &*crate::working_store::file_key(&root, &p, &*key).unwrap(),
        )
        .unwrap();
        let mut bytes = Vec::new();
        reader.read_to_end(&mut bytes).unwrap();
        assert_eq!(&bytes[..chunk.len()], chunk);
        assert_eq!(&bytes[chunk.len()..], b"end");
        drop(reader);
        fs::remove_dir_all(root).unwrap();
    }
}
