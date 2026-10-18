use std::{fs, io, path::Path};

/// Return true only when the asset was created or changed. Other read failures
/// must remain errors, not become permission-bypassing overwrite attempts.
pub fn write_if_changed(path: &Path, bytes: &[u8]) -> io::Result<bool> {
    match fs::read(path) {
        Ok(existing) if existing == bytes => return Ok(false),
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, bytes)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{path::PathBuf, time::{SystemTime, UNIX_EPOCH}};

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
            let path = std::env::temp_dir().join(format!("labos-icon-test-{}-{}", std::process::id(), nonce));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn asset(&self) -> PathBuf { self.0.join("icon.ico") }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            // Only our one fixture file and empty directory; no recursive delete.
            let _ = fs::remove_file(self.asset());
            let _ = fs::remove_dir(&self.0);
        }
    }

    #[test]
    fn creates_missing_asset_and_replaces_changed_bytes() {
        let fixture = Fixture::new();
        assert!(write_if_changed(&fixture.asset(), b"icon-a").unwrap());
        assert_eq!(fs::read(fixture.asset()).unwrap(), b"icon-a");
        assert!(write_if_changed(&fixture.asset(), b"icon-b").unwrap());
        assert_eq!(fs::read(fixture.asset()).unwrap(), b"icon-b");
    }

    #[test]
    fn unchanged_asset_keeps_its_timestamp() {
        let fixture = Fixture::new();
        write_if_changed(&fixture.asset(), b"icon").unwrap();
        let before = fs::metadata(fixture.asset()).unwrap().modified().unwrap();
        assert!(!write_if_changed(&fixture.asset(), b"icon").unwrap());
        assert_eq!(fs::metadata(fixture.asset()).unwrap().modified().unwrap(), before);
    }

    #[test]
    fn invalid_target_is_not_overwritten() {
        let fixture = Fixture::new();
        assert!(write_if_changed(&fixture.0, b"icon").is_err());
        assert!(fixture.0.is_dir());
    }
}
