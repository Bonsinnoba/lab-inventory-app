//! Windows current-user DPAPI. Never fall back to a plaintext key file.
use zeroize::{Zeroize, Zeroizing};
#[cfg(windows)]
fn transform(input: &[u8], protect: bool) -> Result<Zeroizing<Vec<u8>>, String> {
    use windows_sys::Win32::{Security::Cryptography::*, System::Memory::LocalFree};
    if input.is_empty() || input.len() > 65536 {
        return Err("Invalid protected native material".into());
    }
    let source = CRYPT_INTEGER_BLOB {
        cbData: input.len() as u32,
        pbData: input.as_ptr() as *mut u8,
    };
    let entropy = b"LabOS owner-held recovery key v1";
    let entropy = CRYPT_INTEGER_BLOB {
        cbData: entropy.len() as u32,
        pbData: entropy.as_ptr() as *mut u8,
    };
    let mut out: CRYPT_INTEGER_BLOB = unsafe { std::mem::zeroed() };
    let ok = unsafe {
        if protect {
            CryptProtectData(
                &source,
                std::ptr::null(),
                &entropy,
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out,
            )
        } else {
            CryptUnprotectData(
                &source,
                std::ptr::null_mut(),
                &entropy,
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out,
            )
        }
    };
    if ok == 0 {
        return Err("Windows could not unlock this recovery key. Use the owner recovery package and its separate secret on a replacement PC.".into());
    }
    let result = unsafe {
        let bytes = std::slice::from_raw_parts_mut(out.pbData, out.cbData as usize);
        let result = Zeroizing::new(bytes.to_vec());
        bytes.zeroize();
        LocalFree(out.pbData as isize);
        result
    };
    Ok(result)
}
#[cfg(not(windows))]
fn transform(_: &[u8], _: bool) -> Result<Zeroizing<Vec<u8>>, String> {
    Err("Protected recovery-key storage is currently supported on Windows only".into())
}
pub(crate) fn protect(input: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
    transform(input, true)
}
pub(crate) fn unprotect(input: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
    transform(input, false)
}
#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn dpapi_round_trip_and_tamper_rejection() {
        let data = b"private recovery key fixture";
        let encrypted = protect(data).unwrap();
        assert_ne!(&*encrypted, data);
        assert_eq!(&*unprotect(&encrypted).unwrap(), data);
        let mut bad = encrypted.to_vec();
        let n = bad.len() / 2;
        bad[n] ^= 1;
        assert!(unprotect(&bad).is_err());
    }
}
