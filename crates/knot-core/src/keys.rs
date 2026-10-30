//! Private key parsing, inspection and generation.

use getrandom::rand_core::UnwrapErr;
use getrandom::SysRng;
use russh::keys::{decode_secret_key, HashAlg, PrivateKey};
use ssh_key::{Algorithm, LineEnding};

use crate::error::{Error, Result};

/// Public information about a private key, computed at import time.
#[derive(Debug, Clone)]
pub struct KeyInfo {
    pub algorithm: String,
    pub fingerprint: String,
    pub public_key: String,
    pub encrypted: bool,
}

/// Inspect a key. Encrypted OpenSSH keys expose their public half without the
/// passphrase; if a passphrase is given it is verified.
pub fn inspect(pem: &str, passphrase: Option<&str>) -> Result<KeyInfo> {
    if let Ok(key) = PrivateKey::from_openssh(pem) {
        let encrypted = key.is_encrypted();
        if encrypted {
            if let Some(p) = passphrase.filter(|p| !p.is_empty()) {
                key.decrypt(p)
                    .map_err(|_| Error::Key("Incorrect passphrase".into()))?;
            }
        }
        return Ok(info_of(&key, encrypted));
    }
    // Legacy PEM / PKCS#8 formats: must be decodable to learn the public key.
    let key = decode(pem, passphrase)?;
    Ok(info_of(&key, passphrase.is_some_and(|p| !p.is_empty())))
}

/// Decode a private key ready for signing.
pub fn decode(pem: &str, passphrase: Option<&str>) -> Result<PrivateKey> {
    decode_secret_key(pem, passphrase.filter(|p| !p.is_empty())).map_err(|e| match e {
        russh::keys::Error::KeyIsEncrypted => Error::Key("Key is encrypted; a passphrase is required".into()),
        other => Error::Key(other.to_string()),
    })
}

/// Generate a new Ed25519 key, optionally encrypted, in OpenSSH format.
pub fn generate_ed25519(comment: &str, passphrase: Option<&str>) -> Result<String> {
    let mut key = PrivateKey::random(&mut UnwrapErr(SysRng), Algorithm::Ed25519)?;
    key.set_comment(comment);
    if let Some(p) = passphrase.filter(|p| !p.is_empty()) {
        key = key.encrypt(&mut SysRng, p)?;
    }
    Ok(key.to_openssh(LineEnding::LF)?.to_string())
}

fn info_of(key: &PrivateKey, encrypted: bool) -> KeyInfo {
    let public = key.public_key();
    KeyInfo {
        algorithm: public.algorithm().as_str().to_string(),
        fingerprint: public.fingerprint(HashAlg::Sha256).to_string(),
        public_key: public.to_openssh().unwrap_or_default(),
        encrypted,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_and_inspect_roundtrip() {
        let pem = generate_ed25519("test@knot", None).unwrap();
        let info = inspect(&pem, None).unwrap();
        assert_eq!(info.algorithm, "ssh-ed25519");
        assert!(!info.encrypted);
        assert!(info.fingerprint.starts_with("SHA256:"));
        decode(&pem, None).unwrap();
    }

    #[test]
    fn encrypted_key_requires_correct_passphrase() {
        let pem = generate_ed25519("enc@knot", Some("hunter2")).unwrap();
        assert!(inspect(&pem, None).unwrap().encrypted);
        assert!(inspect(&pem, Some("wrong")).is_err());
        assert!(decode(&pem, None).is_err());
        decode(&pem, Some("hunter2")).unwrap();
    }
}
