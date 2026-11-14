//! One bounded, zeroizing SQLite serialization boundary. SQLCipher's bundled
//! bindings use unsigned flags; this avoids rusqlite 0.31's signed-flag wrapper.
use rusqlite::{ffi, Connection};
use zeroize::{Zeroize, Zeroizing};
pub(crate) fn serialize(
    c: &Connection,
    schema: &str,
    max: u64,
) -> Result<Zeroizing<Vec<u8>>, String> {
    let name = std::ffi::CString::new(schema).map_err(|_| "Invalid snapshot schema")?;
    let pages: i64 = c
        .pragma_query_value(
            Some(rusqlite::DatabaseName::Attached(schema)),
            "page_count",
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let page: i64 = c
        .pragma_query_value(
            Some(rusqlite::DatabaseName::Attached(schema)),
            "page_size",
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if pages < 0
        || page < 0
        || (pages as u64)
            .checked_mul(page as u64)
            .filter(|n| *n <= max)
            .is_none()
    {
        return Err("SQLite recovery snapshot exceeds its memory bound".into());
    }
    let mut size = 0_i64;
    // SAFETY: the live connection is borrowed for this entire operation; SQLite
    // returns its own allocation with flags=0. No raw handle escapes this scope.
    let pointer = unsafe { ffi::sqlite3_serialize(c.handle(), name.as_ptr(), &mut size, 0) };
    if pointer.is_null() {
        return Err("SQLite could not allocate the recovery snapshot".into());
    }
    struct Buffer {
        pointer: *mut u8,
        size: usize,
    }
    impl Drop for Buffer {
        fn drop(&mut self) {
            unsafe {
                std::slice::from_raw_parts_mut(self.pointer, self.size).zeroize();
                ffi::sqlite3_free(self.pointer.cast());
            }
        }
    }
    // A valid SQLite allocation has the reported nonnegative length. On an
    // invalid bound do not dereference it; always release it through SQLite.
    if size < 0 || size as u64 > max || size as u64 > isize::MAX as u64 {
        unsafe { ffi::sqlite3_free(pointer.cast()) };
        return Err("SQLite snapshot exceeds its memory bound".into());
    }
    let buffer = Buffer {
        pointer,
        size: size as usize,
    };
    let bytes = unsafe { std::slice::from_raw_parts(buffer.pointer, buffer.size) };
    Ok(Zeroizing::new(bytes.to_vec()))
}
