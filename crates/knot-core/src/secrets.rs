//! Thin wrapper over the OS credential store
//! (macOS Keychain / Windows Credential Manager / Secret Service).

use crate::error::Result;

const SERVICE: &str = "dev.knot.app";

fn entry(account: &str) -> Result<keyring::Entry> {
    Ok(keyring::Entry::new(SERVICE, account)?)
}

pub fn set(account: &str, secret: &str) -> Result<()> {
    entry(account)?.set_password(secret)?;
    Ok(())
}

pub fn get(account: &str) -> Result<Option<String>> {
    match entry(account)?.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn delete(account: &str) -> Result<()> {
    match entry(account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

pub fn host_password_account(host_id: &str) -> String {
    format!("host-password:{host_id}")
}

pub fn key_passphrase_account(key_id: &str) -> String {
    format!("key-passphrase:{key_id}")
}
