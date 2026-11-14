//! SQLCipher boundary. Migration is explicitly staged; opening never downgrades
//! an encrypted database to plaintext or substitutes a new key after an error.
use rusqlite::{types::ValueRef, Connection, DatabaseName, OpenFlags};
use sha2::{Digest, Sha256};
use std::{path::Path, time::Duration};
use zeroize::Zeroizing;
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn key_literal(key: &[u8]) -> Result<Zeroizing<String>, String> {
    if key.len() != 32 {
        return Err("Invalid database key length".into());
    }
    let mut text = Zeroizing::new(String::from("x'"));
    for byte in key {
        use std::fmt::Write;
        write!(&mut *text, "{byte:02x}").map_err(err)?;
    }
    text.push('\'');
    Ok(text)
}
pub(crate) fn open(path: &Path, key: &[u8], readonly: bool) -> Result<Connection, String> {
    let flags = if readonly {
        OpenFlags::SQLITE_OPEN_READ_ONLY
    } else {
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE
    };
    let c = Connection::open_with_flags(path, flags).map_err(err)?;
    let literal = key_literal(key)?;
    c.pragma_update(None, "key", literal.as_str())
        .map_err(|_| "Unable to apply protected database key")?;
    c.busy_timeout(Duration::from_secs(5)).map_err(err)?;
    c.execute_batch("PRAGMA cipher_memory_security=ON; PRAGMA temp_store=MEMORY;")
        .map_err(err)?;
    let version: String = c
        .query_row("PRAGMA cipher_version", [], |r| r.get(0))
        .map_err(|_| "This desktop was built without working database encryption")?;
    if version.is_empty() {
        return Err("SQLCipher is unavailable".into());
    }
    c.query_row("SELECT count(*) FROM sqlite_master", [], |r| {
        r.get::<_, i64>(0)
    })
    .map_err(|_| "Database key or integrity verification failed; original work preserved")?;
    Ok(c)
}
fn integrity(c: &Connection) -> Result<(), String> {
    let mut s = c.prepare("PRAGMA integrity_check").map_err(err)?;
    let rows = s
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    if rows != vec!["ok"] {
        return Err("Database integrity verification failed".into());
    }
    let mut s = c.prepare("PRAGMA cipher_integrity_check").map_err(err)?;
    if s.query([]).map_err(err)?.next().map_err(err)?.is_some() {
        return Err("Database authentication verification failed".into());
    }
    Ok(())
}
fn identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}
// Compare schema and all typed row values, including author/account/intent IDs,
// BLOBs and internal sequence state. This is independent of page layout/order.
fn fingerprint(c: &Connection) -> Result<Vec<u8>, String> {
    let mut result = Sha256::new();
    let mut stmt = c
        .prepare("SELECT type,name,tbl_name,coalesce(sql,'') FROM sqlite_master ORDER BY type,name")
        .map_err(err)?;
    let schema = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    for (kind, name, table, sql) in schema {
        for value in [&kind, &name, &table, &sql] {
            result.update((value.len() as u64).to_le_bytes());
            result.update(value.as_bytes());
        }
        if kind != "table" {
            continue;
        }
        let mut statement = c
            .prepare(&format!("SELECT * FROM {}", identifier(&name)))
            .map_err(err)?;
        let columns = statement.column_count();
        let mut cursor = statement.query([]).map_err(err)?;
        let mut hashes = Vec::new();
        while let Some(row) = cursor.next().map_err(err)? {
            let mut h = Sha256::new();
            h.update((columns as u64).to_le_bytes());
            for i in 0..columns {
                match row.get_ref(i).map_err(err)? {
                    ValueRef::Null => h.update([0]),
                    ValueRef::Integer(n) => {
                        h.update([1]);
                        h.update(n.to_le_bytes());
                    }
                    ValueRef::Real(n) => {
                        h.update([2]);
                        h.update(n.to_bits().to_le_bytes());
                    }
                    ValueRef::Text(v) => {
                        h.update([3]);
                        h.update((v.len() as u64).to_le_bytes());
                        h.update(v);
                    }
                    ValueRef::Blob(v) => {
                        h.update([4]);
                        h.update((v.len() as u64).to_le_bytes());
                        h.update(v);
                    }
                }
            }
            hashes.push(h.finalize().to_vec());
            if hashes.len() > 5_000_000 {
                return Err("Database verification exceeds its row bound".into());
            }
        }
        hashes.sort();
        result.update((hashes.len() as u64).to_le_bytes());
        for hash in hashes {
            result.update(hash)
        }
    }
    Ok(result.finalize().to_vec())
}
/// Write a separate keyed shadow. Caller holds the exclusive profile lease and
/// later publishes through its crash-safe migration journal. Source is untouched.
pub(crate) fn export_shadow(source: &Connection, target: &Path, key: &[u8]) -> Result<(), String> {
    if target.exists() {
        return Err(
            "Encryption shadow already exists; refusing to overwrite recovery evidence".into(),
        );
    }
    // Reserve without replacement; ATTACH only opens this new empty file.
    std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(target)
        .map_err(err)?
        .sync_all()
        .map_err(err)?;
    let literal = key_literal(key)?;
    source
        .execute(
            "ATTACH DATABASE ?1 AS labos_cipher_shadow KEY ?2",
            rusqlite::params![target.to_string_lossy(), literal.as_str()],
        )
        .map_err(|_| "Unable to attach encryption shadow")?;
    let result: Result<Vec<u8>, String> = (|| {
        let tx = source.unchecked_transaction().map_err(err)?;
        let original = fingerprint(&tx)?;
        let user: i64 = tx
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(err)?;
        let application: i64 = tx
            .pragma_query_value(None, "application_id", |r| r.get(0))
            .map_err(err)?;
        tx.query_row("SELECT sqlcipher_export('labos_cipher_shadow')", [], |_| {
            Ok(())
        })
        .map_err(err)?;
        tx.pragma_update(
            Some(DatabaseName::Attached("labos_cipher_shadow")),
            "user_version",
            user,
        )
        .map_err(err)?;
        tx.pragma_update(
            Some(DatabaseName::Attached("labos_cipher_shadow")),
            "application_id",
            application,
        )
        .map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(original)
    })();
    let detach = source
        .execute_batch("DETACH DATABASE labos_cipher_shadow")
        .map_err(err);
    let original = result?;
    detach?;
    let destination = open(target, key, false)?;
    integrity(&destination)?;
    if fingerprint(&destination)? != original {
        return Err("Encryption shadow differs from the source; original work preserved".into());
    }
    Ok(())
}
pub(crate) fn validate_shadow(source: &Path, shadow: &Path, key: &[u8]) -> Result<(), String> {
    let original =
        Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(err)?;
    let encrypted = open(shadow, key, true)?;
    integrity(&encrypted)?;
    if fingerprint(&original)? != fingerprint(&encrypted)? {
        return Err("Database changed after shadow verification; original work preserved".into());
    }
    Ok(())
}
/// A portable snapshot uses a plain in-memory attached DB, never a plaintext
/// temporary file. Source reads and outbox proofs share one SQLite transaction.
pub(crate) fn snapshot(
    source: &Connection,
    max: u64,
) -> Result<
    (
        Zeroizing<Vec<u8>>,
        Option<Vec<crate::recovery_retention::Intent>>,
    ),
    String,
> {
    source
        .execute_batch("ATTACH DATABASE ':memory:' AS labos_recovery_snapshot KEY ''")
        .map_err(err)?;
    let result = (|| {
        let tx = source.unchecked_transaction().map_err(err)?;
        tx.query_row(
            "SELECT sqlcipher_export('labos_recovery_snapshot')",
            [],
            |_| Ok(()),
        )
        .map_err(err)?;
        for name in ["user_version", "application_id"] {
            let value: i64 = tx
                .pragma_query_value(None, name, |r| r.get(0))
                .map_err(err)?;
            tx.pragma_update(
                Some(DatabaseName::Attached("labos_recovery_snapshot")),
                name,
                value,
            )
            .map_err(err)?;
        }
        let bytes = crate::sqlite_snapshot::serialize(&tx, "labos_recovery_snapshot", max)?;
        if bytes.len() as u64 > max {
            return Err("Recovery snapshot exceeds its memory bound".into());
        }
        let bytes = Zeroizing::new(bytes.to_vec());
        let pending = crate::recovery_retention::pending_intents(&tx)?;
        tx.commit().map_err(err)?;
        Ok((bytes, pending))
    })();
    let detach = source
        .execute_batch("DETACH DATABASE labos_recovery_snapshot")
        .map_err(err);
    match result {
        Ok(value) => {
            detach?;
            Ok(value)
        }
        Err(error) => Err(error),
    }
}

fn plain_header(path: &Path) -> Result<bool, String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path).map_err(err)?;
    if file.metadata().map_err(err)?.len() == 0 {
        return Ok(true);
    }
    let mut h = [0; 16];
    file.read_exact(&mut h).map_err(err)?;
    Ok(&h == b"SQLite format 3\0")
}
fn collect_files(
    root: &Path,
    path: &Path,
    result: &mut Vec<std::path::PathBuf>,
) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let metadata = std::fs::symlink_metadata(path).map_err(err)?;
    if metadata.file_type().is_symlink() {
        return Err("Managed migration does not follow links".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err("Managed migration does not follow reparse points".into());
        }
    }
    if !crate::local_resource_export::within(&path.canonicalize().map_err(err)?, root) {
        return Err("Managed migration leaves its profile".into());
    }
    if metadata.is_dir() {
        for entry in std::fs::read_dir(path).map_err(err)? {
            collect_files(root, &entry.map_err(err)?.path(), result)?;
        }
    } else if metadata.is_file() {
        if result.len() >= 100000 {
            return Err("Managed migration exceeds its file bound".into());
        }
        result.push(path.into());
    } else {
        return Err("Unsupported managed file type".into());
    }
    Ok(())
}
fn table(c: &Connection, name: &str) -> Result<bool, String> {
    c.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
        [name],
        |r| r.get(0),
    )
    .map_err(err)
}
fn declared(c: &Connection, relative: &Path, fallback: u64) -> Result<u64, String> {
    use rusqlite::OptionalExtension;
    let parts: Vec<_> = relative
        .iter()
        .map(|s| s.to_string_lossy().into_owned())
        .collect();
    if parts.len() == 4 && parts[0] == "resource-files" && parts[3] == "content" {
        for name in ["local_resource_uploads", "local_resource_edit_staging"] {
            if table(c, name)? {
                let size: Option<i64> = c
                    .query_row(
                        &format!(
                            "SELECT size_bytes FROM {name} WHERE account_id=?1 AND change_id=?2"
                        ),
                        rusqlite::params![parts[1], parts[2]],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(err)?;
                if let Some(size) = size {
                    if size < 0 {
                        return Err("Invalid native staging size".into());
                    }
                    return Ok(size as u64);
                }
            }
        }
    }
    if parts.len() == 4 && parts[0] == "resource-copies" && table(c, "local_resource_copies")? {
        let hash = parts[3].split('.').next().unwrap_or_default();
        let size:Option<i64>=c.query_row("SELECT size_bytes FROM local_resource_copies WHERE account_id=?1 AND resource_id=?2 AND sha256=?3",rusqlite::params![parts[1],parts[2],hash],|r|r.get(0)).optional().map_err(err)?;
        if let Some(size) = size {
            if size < 0 {
                return Err("Invalid native copy size".into());
            }
            return Ok(size as u64);
        }
    }
    Ok(fallback)
}
/// Called only while holding the native exclusive profile lease, before WebView
/// and workspace commands. Any failure leaves startup in its recovery shell.
pub(crate) fn prepare_workspace(root: &Path) -> Result<(), String> {
    std::fs::create_dir_all(root).map_err(err)?;
    let root = root.canonicalize().map_err(err)?;
    let key = crate::working_store::ensure_key(&root)?;
    crate::working_migration::resume(&root, &**key)?;
    let db = root.join("labos-local.db");
    let marker = root.join(".workspace-encryption.json");
    if marker.exists() {
        let metadata = std::fs::symlink_metadata(&marker).map_err(err)?;
        if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 4096 {
            return Err("Invalid working encryption marker; profile preserved".into());
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err("Working encryption marker cannot be a reparse point".into());
            }
        }
        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&marker).map_err(err)?)
                .map_err(|_| "Invalid working encryption marker")?;
        if value["version"] != 1
            || value["database"] != "sqlcipher"
            || value["managed_bytes"] != "chunk-aead-v1"
        {
            return Err("Unsupported working encryption version".into());
        }
        if !db.exists() {
            return Err("Working database is missing; recover the original instead of creating an empty replacement".into());
        }
        let connection = open(&db, &**key, false)?;
        drop(connection);
        return Ok(());
    }
    if !db.exists()
        && (root.join(".encrypted-originals").exists()
            || ["resource-files", "resource-copies"]
                .iter()
                .any(|name| root.join(name).exists()))
    {
        return Err(
            "Working database is missing while managed work remains; recover it before opening"
                .into(),
        );
    }
    if db.exists() && std::fs::metadata(&db).map_err(err)?.len() > 0 && plain_header(&db)? {
        let source = Connection::open(&db).map_err(err)?;
        source.busy_timeout(Duration::from_secs(5)).map_err(err)?;
        source
            .execute_batch(
                "PRAGMA temp_store=MEMORY;PRAGMA locking_mode=EXCLUSIVE;BEGIN EXCLUSIVE;COMMIT;",
            )
            .map_err(|_| {
                "Close other clients of this profile before converting its working database"
            })?;
        let shadow = root.join(format!(
            ".working-migration-{}.shadow",
            uuid::Uuid::new_v4()
        ));
        export_shadow(&source, &shadow, &**key)?;
        drop(source);
        crate::working_migration::publish_database_shadow(&root, &shadow, &**key)?;
    }
    let c = open(&db, &**key, false)?;
    integrity(&c)?;
    let mut paths = Vec::new();
    for name in ["resource-files", "resource-copies"] {
        collect_files(&root, &root.join(name), &mut paths)?;
    }
    paths.sort();
    for path in paths {
        use std::io::Read;
        let relative = path.strip_prefix(&root).map_err(err)?;
        let fallback = std::fs::metadata(&path).map_err(err)?.len();
        let mut file = std::fs::File::open(&path).map_err(err)?;
        let mut magic = [0; 16];
        let bytes = file.read(&mut magic).map_err(err)?;
        drop(file);
        let already = bytes == 16 && &magic == b"LABOS-FILE-AEAD1";
        let size = if already {
            crate::managed_encryption::declared_len(
                &path,
                &*crate::working_store::file_key(&root, &path, &**key)?,
            )
            .map_err(err)?
        } else {
            fallback
        };
        let total = declared(&c, relative, size)?;
        if already {
            let file_key = crate::working_store::file_key(&root, &path, &**key)?;
            let saved = crate::managed_encryption::staged_len(&path, &*file_key).map_err(err)?;
            let mut verify =
                crate::managed_encryption::Reader::open_prefix(&path, &*file_key, total, saved)
                    .map_err(err)?;
            std::io::copy(&mut verify, &mut std::io::sink()).map_err(err)?;
        } else {
            crate::working_migration::stage_file(
                &root,
                &relative.to_string_lossy().replace('\\', "/"),
                &**key,
                total,
            )?;
        }
    }
    drop(c);
    let marker = root.join(".workspace-encryption.json");
    if !marker.exists() {
        let partial = root.join(format!(
            ".workspace-encryption-{}.partial",
            uuid::Uuid::new_v4()
        ));
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&partial)
            .map_err(err)?;
        file.write_all(
            b"{\"version\":1,\"database\":\"sqlcipher\",\"managed_bytes\":\"chunk-aead-v1\"}",
        )
        .map_err(err)?;
        file.sync_all().map_err(err)?;
        drop(file);
        crate::profile_recovery::publish_new(&partial, &marker)?;
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sqlcipher_wal_contains_no_plaintext_intent_and_sqlite_temporary_storage_is_memory_only() {
        let root = std::env::temp_dir().join(format!("labos-cipher-wal-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("protected.db");
        let key = crate::recovery_crypto::random_key();
        let c = open(&path, &*key, false).unwrap();
        c.execute_batch("PRAGMA journal_mode=WAL;PRAGMA wal_autocheckpoint=0;CREATE TABLE authored(author TEXT,payload TEXT);INSERT INTO authored VALUES('private-author-59107','unacknowledged-private-intention-71926');CREATE TEMP TABLE working_copy(payload TEXT);INSERT INTO working_copy VALUES('private-temporary-value-10038');").unwrap();
        assert_eq!(
            c.pragma_query_value(None, "temp_store", |r| r.get::<_, i64>(0))
                .unwrap(),
            2
        );
        let wal = std::fs::read(root.join("protected.db-wal")).unwrap();
        assert!(!wal.is_empty());
        for marker in [
            b"private-author-59107".as_slice(),
            b"unacknowledged-private-intention-71926".as_slice(),
            b"private-temporary-value-10038".as_slice(),
        ] {
            assert!(!wal.windows(marker.len()).any(|bytes| bytes == marker));
        }
        assert_eq!(
            c.query_row("SELECT payload FROM authored", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "unacknowledged-private-intention-71926"
        );
        drop(c);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn completed_workspace_never_recreates_a_missing_database_or_treats_marker_corruption_as_a_new_profile(
    ) {
        let root =
            std::env::temp_dir().join(format!("labos-working-missing-{}", uuid::Uuid::new_v4()));
        prepare_workspace(&root).unwrap();
        let db = root.join("labos-local.db");
        let retired = root.join("kept-database");
        std::fs::rename(&db, &retired).unwrap();
        assert!(prepare_workspace(&root).is_err());
        assert!(!db.exists());
        std::fs::rename(&retired, &db).unwrap();
        std::fs::write(root.join(".workspace-encryption.json"), b"invalid marker").unwrap();
        assert!(prepare_workspace(&root).is_err());
        assert!(db.exists());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn encrypted_workspace_owner_package_preserves_pending_authors_and_managed_bytes() {
        use std::io::Read;
        let root =
            std::env::temp_dir().join(format!("labos-cipher-portable-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let source = root.join("source");
        let restored = root.join("restored");
        std::fs::create_dir(&source).unwrap();
        std::fs::create_dir(&restored).unwrap();
        let c = Connection::open(source.join("labos-local.db")).unwrap();
        c.execute_batch("CREATE TABLE sync_outbox(change_id TEXT,account_id TEXT,device_id TEXT,entity_type TEXT,entity_id TEXT,operation TEXT,payload_json TEXT,synced_at TEXT); INSERT INTO sync_outbox VALUES('intent-a','author-a','device','resources','resource-a','create','immutable authored intention',NULL);").unwrap();
        drop(c);
        std::fs::create_dir(source.join("resource-files")).unwrap();
        std::fs::write(
            source.join("resource-files/content"),
            b"local bytes still present after PC recovery",
        )
        .unwrap();
        prepare_workspace(&source).unwrap();
        let key = crate::working_store::ensure_key(&source).unwrap();
        let c = open(&source.join("labos-local.db"), &**key, false).unwrap();
        let master = crate::recovery_crypto::random_key();
        let secret = "owner-held separate recovery test secret";
        let owner = "11111111-1111-4111-8111-111111111111";
        let origin = crate::native_authorization::trusted_base().unwrap();
        let package = root.join("owner.labos-recovery");
        let receipt = crate::recovery_archive::create(
            &c,
            &source,
            &package,
            &*master,
            secret,
            owner,
            &origin,
            || Ok(()),
        )
        .unwrap();
        assert_eq!(receipt.pending.as_ref().unwrap().len(), 1);
        crate::recovery_archive::verify(&package, secret, Some(&restored), Some((owner, &origin)))
            .unwrap();
        assert!(!restored.join(".labos-working-key.json").exists());
        prepare_workspace(&restored).unwrap();
        let recovered_key = crate::working_store::ensure_key(&restored).unwrap();
        let recovered = open(&restored.join("labos-local.db"), &**recovered_key, false).unwrap();
        assert_eq!(
            recovered
                .query_row("SELECT account_id,payload_json FROM sync_outbox", [], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                })
                .unwrap(),
            ("author-a".into(), "immutable authored intention".into())
        );
        let mut bytes = Vec::new();
        crate::working_store::open(&restored.join("resource-files/content"))
            .unwrap()
            .read_to_end(&mut bytes)
            .unwrap();
        assert_eq!(bytes, b"local bytes still present after PC recovery");
        assert_eq!(
            c.query_row("SELECT count(*) FROM sync_outbox", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        drop(recovered);
        drop(c);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn complete_workspace_migration_reopens_ciphertext_and_resumes_authored_uploads() {
        let root =
            std::env::temp_dir().join(format!("labos-working-workspace-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let c = Connection::open(root.join("labos-local.db")).unwrap();
        c.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE authored(author TEXT,payload TEXT);INSERT INTO authored VALUES('original-owner','unsubmitted intent'); CREATE TABLE local_resource_uploads(account_id TEXT,change_id TEXT,size_bytes INTEGER); INSERT INTO local_resource_uploads VALUES('owner','change',1048579);").unwrap();
        let dir = root.join("resource-files/owner/change");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("content"), vec![19; 1024 * 1024]).unwrap();
        drop(c);
        prepare_workspace(&root).unwrap();
        assert!(!std::fs::read(root.join("labos-local.db"))
            .unwrap()
            .starts_with(b"SQLite format"));
        let key = crate::working_store::ensure_key(&root).unwrap();
        let c = open(&root.join("labos-local.db"), &**key, false).unwrap();
        assert_eq!(
            c.query_row("SELECT author FROM authored", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "original-owner"
        );
        drop(c);
        crate::working_store::append(&dir.join("content"), 1048579, 1048576, b"end").unwrap();
        assert_eq!(
            crate::working_store::len(&dir.join("content")).unwrap(),
            1048579
        );
        prepare_workspace(&root).unwrap();
        assert!(root.join(".workspace-encryption.json").exists());
        assert!(!root.join(".workspace-migration.pending.dpapi").exists());
        assert!(
            std::fs::read_dir(root.join(".encrypted-originals"))
                .unwrap()
                .count()
                >= 2
        );
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn sqlcipher_export_preserves_wal_authorship_blobs_and_pending_intent_without_plaintext_temp() {
        let root =
            std::env::temp_dir().join(format!("labos-cipher-migration-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let plain = root.join("original.db");
        let shadow = root.join("shadow.db");
        let source = Connection::open(&plain).unwrap();
        source.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; PRAGMA user_version=42; CREATE TABLE authored(id INTEGER PRIMARY KEY AUTOINCREMENT,author TEXT,payload BLOB); INSERT INTO authored(author,payload) VALUES('original-owner',X'0001ff'); CREATE TABLE sync_outbox(change_id TEXT,account_id TEXT,device_id TEXT,entity_type TEXT,entity_id TEXT,operation TEXT,payload_json TEXT,synced_at TEXT); INSERT INTO sync_outbox VALUES('intent','original-owner','device','resources','resource','create','immutable pending work',NULL);").unwrap();
        let key = crate::recovery_crypto::random_key();
        let before = fingerprint(&source).unwrap();
        export_shadow(&source, &shadow, &*key).unwrap();
        assert_eq!(fingerprint(&source).unwrap(), before);
        assert!(export_shadow(&source, &shadow, &*key).is_err());
        let encrypted = open(&shadow, &*key, false).unwrap();
        assert_eq!(
            encrypted
                .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
                .unwrap(),
            42
        );
        assert_eq!(fingerprint(&encrypted).unwrap(), before);
        let bytes = std::fs::read(&shadow).unwrap();
        assert!(!bytes.starts_with(b"SQLite format"));
        assert!(!bytes.windows(14).any(|w| w == b"original-owner"));
        assert!(Connection::open(&shadow)
            .unwrap()
            .query_row("SELECT count(*) FROM authored", [], |r| r.get::<_, i64>(0))
            .is_err());
        assert!(open(&shadow, &[3; 32], true).is_err());
        let (snapshot, pending) = snapshot(&encrypted, 256 * 1024 * 1024).unwrap();
        assert!(snapshot.starts_with(b"SQLite format 3\0"));
        assert_eq!(pending.unwrap().len(), 1);
        let restored = root.join("restored.db");
        std::fs::write(&restored, &*snapshot).unwrap();
        let restored = Connection::open(&restored).unwrap();
        assert_eq!(fingerprint(&restored).unwrap(), before);
        drop(restored);
        drop(encrypted);
        drop(source);
        std::fs::remove_dir_all(root).unwrap();
    }
}
