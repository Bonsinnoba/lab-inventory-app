//! Versioned authenticated streaming format for owner-held recovery packages.
//! Keys and secrets never appear in the response, SQLite, outbox or logs.
use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use hkdf::Hkdf;
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{self, Read, Write};
use zeroize::Zeroizing;

const MAGIC: &[u8; 8] = b"LABOSRC1";
const CHUNK: usize = 1024 * 1024;
const HEADER_LIMIT: usize = 8192;
pub(crate) type SecretKey = Zeroizing<[u8; 32]>;
fn invalid() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        "Recovery package authentication or format validation failed",
    )
}
fn fail(e: impl std::fmt::Display) -> io::Error {
    io::Error::new(io::ErrorKind::Other, e.to_string())
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Identity {
    pub version: u32,
    pub backup_id: String,
    pub owner_account_id: String,
    pub server_origin: String,
    pub salt: [u8; 16],
    pub wrap_nonce: [u8; 12],
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Header {
    identity: Identity,
    wrapped_key: Vec<u8>,
}
fn wrapping_key(secret: &str, salt: &[u8; 16]) -> io::Result<SecretKey> {
    if secret.chars().count() < 20 || secret.len() > 1024 {
        return Err(fail(
            "Use a separate recovery secret of at least 20 characters (at most 1,024 UTF-8 bytes)",
        ));
    }
    let mut key = Zeroizing::new([0; 32]);
    let params = Params::new(65536, 3, 1, Some(32)).map_err(fail)?;
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(secret.as_bytes(), salt, &mut *key)
        .map_err(fail)?;
    Ok(key)
}
fn cipher(key: &[u8]) -> io::Result<Aes256Gcm> {
    Aes256Gcm::new_from_slice(key).map_err(|_| invalid())
}
fn body_key(master: &[u8], identity: &Identity) -> io::Result<SecretKey> {
    let mut key = Zeroizing::new([0; 32]);
    Hkdf::<Sha256>::new(Some(identity.backup_id.as_bytes()), master)
        .expand(b"LabOS recovery body v1", &mut *key)
        .map_err(|_| invalid())?;
    Ok(key)
}
fn nonce(index: u64) -> [u8; 12] {
    let mut out = [0; 12];
    out[4..].copy_from_slice(&index.to_be_bytes());
    out
}
fn aad(header: &[u8], index: u64) -> [u8; 40] {
    let mut out = [0; 40];
    out[..32].copy_from_slice(&Sha256::digest(header));
    out[32..].copy_from_slice(&index.to_be_bytes());
    out
}
pub(crate) fn random_key() -> SecretKey {
    let mut key = Zeroizing::new([0; 32]);
    OsRng.fill_bytes(&mut *key);
    key
}

pub(crate) struct Encrypt<W: Write> {
    output: W,
    cipher: Aes256Gcm,
    header: Vec<u8>,
    buffer: Zeroizing<Vec<u8>>,
    index: u64,
}
impl<W: Write> Encrypt<W> {
    pub fn new(
        output: W,
        master: &[u8],
        secret: &str,
        owner: &str,
        origin: &str,
    ) -> io::Result<Self> {
        Self::new_version(output,master,secret,owner,origin,1)
    }
    pub fn new_version(mut output:W,master:&[u8],secret:&str,owner:&str,origin:&str,version:u32)->io::Result<Self>{
        if ![1,2].contains(&version){return Err(invalid())}
        if master.len() != 32 || uuid::Uuid::parse_str(owner).is_err() || origin.len() > 2048 {
            return Err(invalid());
        }
        let mut salt = [0; 16];
        let mut wrap_nonce = [0; 12];
        OsRng.fill_bytes(&mut salt);
        OsRng.fill_bytes(&mut wrap_nonce);
        let identity = Identity {
            version,
            backup_id: uuid::Uuid::new_v4().to_string(),
            owner_account_id: owner.into(),
            server_origin: origin.into(),
            salt,
            wrap_nonce,
        };
        let associated = serde_json::to_vec(&identity).map_err(fail)?;
        let wrap = wrapping_key(secret, &identity.salt)?;
        let wrapped_key = cipher(&*wrap)?
            .encrypt(
                Nonce::from_slice(&identity.wrap_nonce),
                Payload {
                    msg: master,
                    aad: &associated,
                },
            )
            .map_err(|_| invalid())?;
        let key = body_key(master, &identity)?;
        let header = serde_json::to_vec(&Header {
            identity,
            wrapped_key,
        })
        .map_err(fail)?;
        if header.len() > HEADER_LIMIT {
            return Err(invalid());
        }
        output.write_all(MAGIC)?;
        output.write_all(&(header.len() as u32).to_be_bytes())?;
        output.write_all(&header)?;
        Ok(Self {
            output,
            cipher: cipher(&*key)?,
            header,
            buffer: Zeroizing::new(Vec::with_capacity(CHUNK)),
            index: 0,
        })
    }
    fn record(&mut self, bytes: &[u8]) -> io::Result<()> {
        if self.index == u64::MAX {
            return Err(invalid());
        }
        let encrypted = self
            .cipher
            .encrypt(
                Nonce::from_slice(&nonce(self.index)),
                Payload {
                    msg: bytes,
                    aad: &aad(&self.header, self.index),
                },
            )
            .map_err(|_| invalid())?;
        self.output
            .write_all(&(encrypted.len() as u32).to_be_bytes())?;
        self.output.write_all(&encrypted)?;
        self.index += 1;
        Ok(())
    }
    pub fn finish(mut self) -> io::Result<W> {
        if !self.buffer.is_empty() {
            let bytes = Zeroizing::new(std::mem::take(&mut *self.buffer));
            self.record(&bytes)?;
        }
        self.record(&[])?;
        self.output.flush()?;
        Ok(self.output)
    }
}
impl<W: Write> Write for Encrypt<W> {
    fn write(&mut self, input: &[u8]) -> io::Result<usize> {
        let mut offset = 0;
        while offset < input.len() {
            let count = (CHUNK - self.buffer.len()).min(input.len() - offset);
            self.buffer
                .extend_from_slice(&input[offset..offset + count]);
            offset += count;
            if self.buffer.len() == CHUNK {
                let bytes = Zeroizing::new(std::mem::take(&mut *self.buffer));
                self.record(&bytes)?;
            }
        }
        Ok(input.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        self.output.flush()
    }
}
pub(crate) struct Decrypt<R: Read> {
    input: R,
    cipher: Aes256Gcm,
    header: Vec<u8>,
    buffer: Zeroizing<Vec<u8>>,
    offset: usize,
    index: u64,
    ended: bool,
    pub identity: Identity,
    pub master: SecretKey,
}
impl<R: Read> Decrypt<R> {
    pub fn into_verified_input(self)->io::Result<R>{if !self.ended||self.offset!=self.buffer.len(){return Err(invalid())}Ok(self.input)}
    pub fn new(mut input: R, secret: &str) -> io::Result<Self> {
        let mut magic = [0; 8];
        input.read_exact(&mut magic)?;
        if &magic != MAGIC {
            return Err(invalid());
        }
        let mut length = [0; 4];
        input.read_exact(&mut length)?;
        let length = u32::from_be_bytes(length) as usize;
        if length > HEADER_LIMIT || length == 0 {
            return Err(invalid());
        }
        let mut header = vec![0; length];
        input.read_exact(&mut header)?;
        let parsed: Header = serde_json::from_slice(&header).map_err(|_| invalid())?;
        if ![1,2].contains(&parsed.identity.version)
            || uuid::Uuid::parse_str(&parsed.identity.backup_id).is_err()
            || uuid::Uuid::parse_str(&parsed.identity.owner_account_id).is_err()
            || parsed.identity.server_origin.len() > 2048
            || parsed.wrapped_key.len() != 48
        {
            return Err(invalid());
        }
        let associated = serde_json::to_vec(&parsed.identity).map_err(fail)?;
        let wrap = wrapping_key(secret, &parsed.identity.salt)?;
        let plaintext = Zeroizing::new(
            cipher(&*wrap)?
                .decrypt(
                    Nonce::from_slice(&parsed.identity.wrap_nonce),
                    Payload {
                        msg: &parsed.wrapped_key,
                        aad: &associated,
                    },
                )
                .map_err(|_| invalid())?,
        );
        if plaintext.len() != 32 {
            return Err(invalid());
        }
        let mut master = Zeroizing::new([0; 32]);
        master.copy_from_slice(&plaintext);
        let key = body_key(&*master, &parsed.identity)?;
        Ok(Self {
            input,
            cipher: cipher(&*key)?,
            header,
            buffer: Zeroizing::new(Vec::new()),
            offset: 0,
            index: 0,
            ended: false,
            identity: parsed.identity,
            master,
        })
    }
}
impl<R: Read> Read for Decrypt<R> {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        if output.is_empty() {
            return Ok(0);
        }
        if self.offset == self.buffer.len() {
            if self.ended {
                return Ok(0);
            }
            let mut length = [0; 4];
            self.input.read_exact(&mut length)?;
            let size = u32::from_be_bytes(length) as usize;
            if !(16..=CHUNK + 16).contains(&size) || self.index == u64::MAX {
                return Err(invalid());
            }
            let mut encrypted = vec![0; size];
            self.input.read_exact(&mut encrypted)?;
            self.buffer = Zeroizing::new(
                self.cipher
                    .decrypt(
                        Nonce::from_slice(&nonce(self.index)),
                        Payload {
                            msg: &encrypted,
                            aad: &aad(&self.header, self.index),
                        },
                    )
                    .map_err(|_| invalid())?,
            );
            self.index += 1;
            self.offset = 0;
            if self.buffer.is_empty() {
                let mut extra = [0];
                if self.input.read(&mut extra)? != 0 {
                    return Err(invalid());
                }
                self.ended = true;
                return Ok(0);
            }
        }
        let count = (self.buffer.len() - self.offset).min(output.len());
        output[..count].copy_from_slice(&self.buffer[self.offset..self.offset + count]);
        self.offset += count;
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const OWNER: &str = "11111111-1111-4111-8111-111111111111";
    const SECRET: &str = "a separate long recovery secret for tests";
    #[test]
    fn authenticated_stream_round_trip_rejects_wrong_secret_tampering_truncation_and_trailing_bytes(
    ) {
        let master = random_key();
        let bytes = vec![71; CHUNK + 37];
        let mut writer = Encrypt::new(
            Vec::new(),
            &*master,
            SECRET,
            OWNER,
            "https://lab.example/api",
        )
        .unwrap();
        writer.write_all(&bytes).unwrap();
        let encrypted = writer.finish().unwrap();
        let mut reader = Decrypt::new(&encrypted[..], SECRET).unwrap();
        let mut out = Vec::new();
        reader.read_to_end(&mut out).unwrap();
        assert_eq!(out, bytes);
        assert_eq!(&*reader.master, &*master);
        assert_eq!(reader.identity.owner_account_id, OWNER);
        assert!(Decrypt::new(&encrypted[..], "a completely different and long secret").is_err());
        for index in [20, encrypted.len() / 2, encrypted.len() - 1] {
            let mut bad = encrypted.clone();
            bad[index] ^= 1;
            assert!(Decrypt::new(&bad[..], SECRET)
                .and_then(|mut r| r.read_to_end(&mut Vec::new()))
                .is_err());
        }
        let mut bad = encrypted.clone();
        bad.push(0);
        assert!(Decrypt::new(&bad[..], SECRET)
            .unwrap()
            .read_to_end(&mut Vec::new())
            .is_err());
        assert!(Decrypt::new(&encrypted[..encrypted.len() - 8], SECRET)
            .unwrap()
            .read_to_end(&mut Vec::new())
            .is_err());
    }
    #[test]
    fn empty_stream_is_authenticated_and_each_package_uses_a_distinct_identity() {
        let key = random_key();
        let a = Encrypt::new(Vec::new(), &*key, SECRET, OWNER, "origin")
            .unwrap()
            .finish()
            .unwrap();
        let b = Encrypt::new(Vec::new(), &*key, SECRET, OWNER, "origin")
            .unwrap()
            .finish()
            .unwrap();
        assert_ne!(a, b);
        assert_eq!(
            Decrypt::new(&a[..], SECRET)
                .unwrap()
                .read(&mut [0])
                .unwrap(),
            0
        );
    }
}
