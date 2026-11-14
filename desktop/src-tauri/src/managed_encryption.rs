//! Bounded authenticated random-access storage for managed bytes. Every chunk
//! has a fresh random nonce; retries never reuse a nonce for changed plaintext.
use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit,
};
use hkdf::Hkdf;
use rand_core::{OsRng, RngCore};
use sha2::Sha256;
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};
use zeroize::{Zeroize, Zeroizing};
const MAGIC: &[u8; 16] = b"LABOS-FILE-AEAD1";
pub(crate) const CHUNK: usize = 1024 * 1024;
const PREFIX: usize = 76;
const HEADER: usize = 104;
const EXTRA: u64 = 28;
const LIMIT: u64 = 50 * 1024 * 1024 * 1024;
fn invalid() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        "Managed file authentication or length failed; original bytes retained",
    )
}
fn cipher(master: &[u8], prefix: &[u8]) -> io::Result<Aes256Gcm> {
    let mut key = Zeroizing::new([0; 32]);
    let mut info = b"LabOS managed bytes v1".to_vec();
    info.extend_from_slice(&prefix[48..64]);
    Hkdf::<Sha256>::new(Some(&prefix[16..48]), master)
        .expand(&info, &mut *key)
        .map_err(|_| invalid())?;
    Aes256Gcm::new_from_slice(&*key).map_err(|_| invalid())
}
fn physical(len: u64) -> io::Result<u64> {
    (HEADER as u64)
        .checked_add(len)
        .and_then(|n| n.checked_add(len.div_ceil(CHUNK as u64) * EXTRA))
        .ok_or_else(invalid)
}
fn prefix(master: &[u8], len: u64) -> io::Result<([u8; HEADER], Aes256Gcm)> {
    if master.len() != 32 || len > LIMIT {
        return Err(invalid());
    }
    let mut bytes = [0; HEADER];
    bytes[..16].copy_from_slice(MAGIC);
    OsRng.fill_bytes(&mut bytes[16..64]);
    bytes[64..72].copy_from_slice(&len.to_le_bytes());
    bytes[72..76].copy_from_slice(&(CHUNK as u32).to_le_bytes());
    OsRng.fill_bytes(&mut bytes[76..88]);
    let cipher = cipher(master, &bytes[..PREFIX])?;
    let tag = cipher
        .encrypt(
            aes_gcm::Nonce::from_slice(&bytes[76..88]),
            Payload {
                msg: &[],
                aad: &bytes[..PREFIX],
            },
        )
        .map_err(|_| invalid())?;
    bytes[88..104].copy_from_slice(&tag);
    Ok((bytes, cipher))
}
fn load(file: &mut File, master: &[u8]) -> io::Result<([u8; HEADER], Aes256Gcm, u64)> {
    if master.len() != 32 {
        return Err(invalid());
    }
    let mut h = [0; HEADER];
    file.seek(SeekFrom::Start(0))?;
    file.read_exact(&mut h)?;
    if &h[..16] != MAGIC || u32::from_le_bytes(h[72..76].try_into().unwrap()) as usize != CHUNK {
        return Err(invalid());
    }
    let len = u64::from_le_bytes(h[64..72].try_into().unwrap());
    if len > LIMIT {
        return Err(invalid());
    }
    let cipher = cipher(master, &h[..PREFIX])?;
    let clear = cipher
        .decrypt(
            aes_gcm::Nonce::from_slice(&h[76..88]),
            Payload {
                msg: &h[88..104],
                aad: &h[..PREFIX],
            },
        )
        .map_err(|_| invalid())?;
    if !clear.is_empty() {
        return Err(invalid());
    }
    Ok((h, cipher, len))
}
fn aad(header: &[u8; HEADER], index: u64) -> Vec<u8> {
    let mut bytes = header[..PREFIX].to_vec();
    bytes.extend_from_slice(&index.to_le_bytes());
    bytes
}
fn chunk_len(total: u64, index: u64) -> io::Result<usize> {
    let offset = index.checked_mul(CHUNK as u64).ok_or_else(invalid)?;
    if offset >= total {
        return Err(invalid());
    }
    Ok((total - offset).min(CHUNK as u64) as usize)
}
fn chunk_offset(index: u64) -> io::Result<u64> {
    index
        .checked_mul(CHUNK as u64 + EXTRA)
        .and_then(|n| n.checked_add(HEADER as u64))
        .ok_or_else(invalid)
}
fn read_chunk(
    file: &mut File,
    cipher: &Aes256Gcm,
    header: &[u8; HEADER],
    total: u64,
    index: u64,
) -> io::Result<Zeroizing<Vec<u8>>> {
    let len = chunk_len(total, index)?;
    file.seek(SeekFrom::Start(chunk_offset(index)?))?;
    let mut nonce = [0; 12];
    file.read_exact(&mut nonce)?;
    let mut encrypted = vec![0; len + 16];
    file.read_exact(&mut encrypted)?;
    let clear = Zeroizing::new(
        cipher
            .decrypt(
                aes_gcm::Nonce::from_slice(&nonce),
                Payload {
                    msg: &encrypted,
                    aad: &aad(header, index),
                },
            )
            .map_err(|_| invalid())?,
    );
    if clear.len() != len {
        return Err(invalid());
    }
    Ok(clear)
}
fn write_chunk(
    file: &mut File,
    cipher: &Aes256Gcm,
    header: &[u8; HEADER],
    index: u64,
    clear: &[u8],
) -> io::Result<()> {
    let mut nonce = [0; 12];
    OsRng.fill_bytes(&mut nonce);
    let encrypted = cipher
        .encrypt(
            aes_gcm::Nonce::from_slice(&nonce),
            Payload {
                msg: clear,
                aad: &aad(header, index),
            },
        )
        .map_err(|_| invalid())?;
    file.seek(SeekFrom::Start(chunk_offset(index)?))?;
    file.write_all(&nonce)?;
    file.write_all(&encrypted)
}
pub(crate) struct Reader {
    file: File,
    header: [u8; HEADER],
    cipher: Aes256Gcm,
    total: u64,
    len: u64,
    position: u64,
    cached: Option<u64>,
    buffer: Zeroizing<Vec<u8>>,
}
impl Reader {
    pub fn open(path: &Path, master: &[u8]) -> io::Result<Self> {
        let mut file = File::open(path)?;
        let (header, cipher, len) = load(&mut file, master)?;
        if file.metadata()?.len() != physical(len)? {
            return Err(invalid());
        }
        Ok(Self {
            file,
            header,
            cipher,
            total: len,
            len,
            position: 0,
            cached: None,
            buffer: Zeroizing::new(Vec::new()),
        })
    }
    pub fn open_prefix(path: &Path, master: &[u8], total: u64, saved: u64) -> io::Result<Self> {
        let mut file = File::open(path)?;
        let (header, cipher, declared) = load(&mut file, master)?;
        if declared != total
            || saved > total
            || (saved != total && saved % CHUNK as u64 != 0)
            || file.metadata()?.len() != physical(saved)?
        {
            return Err(invalid());
        }
        Ok(Self {
            file,
            header,
            cipher,
            total,
            len: saved,
            position: 0,
            cached: None,
            buffer: Zeroizing::new(Vec::new()),
        })
    }
    pub fn len(&self) -> u64 {
        self.len
    }
    pub fn metadata(&self) -> io::Result<fs::Metadata> {
        self.file.metadata()
    }
}
impl Read for Reader {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        if out.is_empty() || self.position >= self.len {
            return Ok(0);
        }
        let index = self.position / CHUNK as u64;
        if self.cached != Some(index) {
            self.buffer = read_chunk(
                &mut self.file,
                &self.cipher,
                &self.header,
                self.total,
                index,
            )?;
            self.cached = Some(index);
        }
        let offset = (self.position % CHUNK as u64) as usize;
        let count = out.len().min(self.buffer.len() - offset);
        out[..count].copy_from_slice(&self.buffer[offset..offset + count]);
        self.position += count as u64;
        Ok(count)
    }
}
impl Seek for Reader {
    fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
        let next = match position {
            SeekFrom::Start(n) => n as i128,
            SeekFrom::Current(n) => self.position as i128 + n as i128,
            SeekFrom::End(n) => self.len as i128 + n as i128,
        };
        if !(0..=u64::MAX as i128).contains(&next) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Invalid managed seek",
            ));
        }
        self.position = next as u64;
        Ok(self.position)
    }
}
pub(crate) fn create_staging(path: &Path, master: &[u8], len: u64) -> io::Result<()> {
    let (header, _) = prefix(master, len)?;
    let mut file = OpenOptions::new().create_new(true).write(true).open(path)?;
    file.write_all(&header)?;
    file.sync_all()
}
pub(crate) fn declared_len(path: &Path, master: &[u8]) -> io::Result<u64> {
    let mut file = File::open(path)?;
    load(&mut file, master).map(|(_, _, total)| total)
}
pub(crate) fn staged_len(path: &Path, master: &[u8]) -> io::Result<u64> {
    let mut file = File::open(path)?;
    let (_, _, total) = load(&mut file, master)?;
    let actual = file.metadata()?.len();
    if actual > physical(total)? || actual < HEADER as u64 {
        return Err(invalid());
    }
    if actual == physical(total)? {
        return Ok(total);
    }
    Ok(((actual - HEADER as u64) / (CHUNK as u64 + EXTRA) * CHUNK as u64).min(total))
}
pub(crate) fn truncate_staging(
    path: &Path,
    master: &[u8],
    size: u64,
    offset: u64,
) -> io::Result<()> {
    let mut file = OpenOptions::new().read(true).write(true).open(path)?;
    let (_, _, total) = load(&mut file, master)?;
    if total != size
        || offset > total
        || (offset != total && offset % CHUNK as u64 != 0)
        || staged_len(path, master)? < offset
    {
        return Err(invalid());
    }
    file.set_len(physical(offset)?)?;
    file.sync_all()
}
pub(crate) fn append(path: &Path, master: &[u8], offset: u64, bytes: &[u8]) -> io::Result<()> {
    if bytes.is_empty() || offset % CHUNK as u64 != 0 {
        return Err(invalid());
    }
    let mut file = OpenOptions::new().read(true).write(true).open(path)?;
    let (header, cipher, total) = load(&mut file, master)?;
    if offset
        .checked_add(bytes.len() as u64)
        .filter(|n| *n <= total)
        .is_none()
    {
        return Err(invalid());
    }
    let mut consumed = 0;
    while consumed < bytes.len() {
        let index = (offset + consumed as u64) / CHUNK as u64;
        let wanted = chunk_len(total, index)?;
        if bytes.len() - consumed < wanted {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Managed writes require a complete chunk or final tail",
            ));
        }
        let start = chunk_offset(index)?;
        let end = start + EXTRA + wanted as u64;
        let actual = file.metadata()?.len();
        if actual < start {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "Missing earlier managed chunk",
            ));
        }
        let clear = &bytes[consumed..consumed + wanted];
        if actual >= end {
            if read_chunk(&mut file, &cipher, &header, total, index)?.as_slice() != clear {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "Retried chunk differs from saved bytes",
                ));
            }
        } else {
            file.set_len(start)?;
            write_chunk(&mut file, &cipher, &header, index, clear)?;
        }
        consumed += wanted;
    }
    file.sync_all()
}
pub(crate) struct Writer {
    path: PathBuf,
    file: File,
    header: [u8; HEADER],
    cipher: Aes256Gcm,
    total: u64,
    written: u64,
    index: u64,
    buffer: Zeroizing<Vec<u8>>,
    finished: bool,
}
impl Writer {
    pub fn create(path: &Path, master: &[u8], len: u64) -> io::Result<Self> {
        let (header, cipher) = prefix(master, len)?;
        let mut file = OpenOptions::new().create_new(true).write(true).open(path)?;
        file.write_all(&header)?;
        Ok(Self {
            path: path.into(),
            file,
            header,
            cipher,
            total: len,
            written: 0,
            index: 0,
            buffer: Zeroizing::new(Vec::with_capacity(CHUNK)),
            finished: false,
        })
    }
    fn emit(&mut self) -> io::Result<()> {
        if !self.buffer.is_empty() {
            write_chunk(
                &mut self.file,
                &self.cipher,
                &self.header,
                self.index,
                &self.buffer,
            )?;
            self.index += 1;
            self.buffer.as_mut_slice().zeroize();
            self.buffer.clear();
        }
        Ok(())
    }
    pub fn finish(mut self) -> io::Result<()> {
        if self.written != self.total {
            return Err(invalid());
        }
        self.emit()?;
        self.file.sync_all()?;
        self.finished = true;
        Ok(())
    }
}
impl Write for Writer {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self
            .written
            .checked_add(bytes.len() as u64)
            .filter(|n| *n <= self.total)
            .is_none()
        {
            return Err(invalid());
        }
        let mut offset = 0;
        while offset < bytes.len() {
            let count = (CHUNK - self.buffer.len()).min(bytes.len() - offset);
            self.buffer
                .extend_from_slice(&bytes[offset..offset + count]);
            offset += count;
            self.written += count as u64;
            if self.buffer.len() == CHUNK {
                self.emit()?;
            }
        }
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        self.file.flush()
    }
}
impl Drop for Writer {
    fn drop(&mut self) {
        if !self.finished {
            let _ = fs::remove_file(&self.path);
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let p =
                std::env::temp_dir().join(format!("labos-managed-crypto-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&p).unwrap();
            Self(p)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            for e in fs::read_dir(&self.0).unwrap() {
                let _ = fs::remove_file(e.unwrap().path());
            }
            let _ = fs::remove_dir(&self.0);
        }
    }
    #[test]
    fn encrypted_large_files_seek_across_records_without_plaintext_or_full_file_allocation() {
        let f = Fixture::new();
        let p = f.0.join("bytes");
        let key = crate::recovery_crypto::random_key();
        let size = 33 * CHUNK + 17;
        let mut writer = Writer::create(&p, &*key, size as u64).unwrap();
        for i in 0..33 {
            writer.write_all(&vec![i as u8; CHUNK]).unwrap();
        }
        writer.write_all(b"authenticated end").unwrap();
        writer.finish().unwrap();
        assert_eq!(
            fs::metadata(&p).unwrap().len(),
            physical(size as u64).unwrap()
        );
        let mut reader = Reader::open(&p, &*key).unwrap();
        assert_eq!(reader.len(), size as u64);
        reader.seek(SeekFrom::Start(CHUNK as u64 - 3)).unwrap();
        let mut bytes = [0; 6];
        reader.read_exact(&mut bytes).unwrap();
        assert_eq!(bytes, [0, 0, 0, 1, 1, 1]);
        reader.seek(SeekFrom::End(-17)).unwrap();
        let mut tail = Vec::new();
        reader.read_to_end(&mut tail).unwrap();
        assert_eq!(tail, b"authenticated end");
        assert!(!fs::read(&p)
            .unwrap()
            .windows(17)
            .any(|w| w == b"authenticated end"));
    }
    #[test]
    fn wrong_key_header_tamper_reordered_records_and_truncation_fail_closed() {
        let f = Fixture::new();
        let p = f.0.join("bytes");
        let key = crate::recovery_crypto::random_key();
        create_staging(&p, &*key, (2 * CHUNK) as u64).unwrap();
        append(&p, &*key, 0, &vec![7; 2 * CHUNK]).unwrap();
        let original = fs::read(&p).unwrap();
        assert!(Reader::open(&p, &[1; 32]).is_err());
        let mut bad = original.clone();
        bad[64] ^= 1;
        fs::write(&p, &bad).unwrap();
        assert!(Reader::open(&p, &*key).is_err());
        let mut bad = original.clone();
        let a = HEADER;
        let b = HEADER + CHUNK + EXTRA as usize;
        let first = bad[a..b].to_vec();
        let second = bad[b..].to_vec();
        bad[a..b].copy_from_slice(&second);
        bad[b..].copy_from_slice(&first);
        fs::write(&p, &bad).unwrap();
        let mut reader = Reader::open(&p, &*key).unwrap();
        assert!(reader.read(&mut [0; 1]).is_err());
        fs::write(&p, &original[..original.len() - 1]).unwrap();
        assert!(Reader::open(&p, &*key).is_err());
    }
    #[test]
    fn chunk_retry_is_idempotent_changed_bytes_fail_and_partial_uncommitted_tail_can_resume() {
        let f = Fixture::new();
        let p = f.0.join("bytes");
        let key = crate::recovery_crypto::random_key();
        create_staging(&p, &*key, (CHUNK + 3) as u64).unwrap();
        append(&p, &*key, 0, &vec![9; CHUNK]).unwrap();
        let first = fs::read(&p).unwrap();
        append(&p, &*key, 0, &vec![9; CHUNK]).unwrap();
        assert_eq!(fs::read(&p).unwrap(), first);
        assert!(append(&p, &*key, 0, &vec![8; CHUNK]).is_err());
        OpenOptions::new()
            .append(true)
            .open(&p)
            .unwrap()
            .write_all(b"torn tail")
            .unwrap();
        append(&p, &*key, CHUNK as u64, b"end").unwrap();
        let mut reader = Reader::open(&p, &*key).unwrap();
        reader.seek(SeekFrom::End(-3)).unwrap();
        let mut end = [0; 3];
        reader.read_exact(&mut end).unwrap();
        assert_eq!(&end, b"end");
    }
}
