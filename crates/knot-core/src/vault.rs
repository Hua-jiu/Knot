//! Persistent hosts and keys. Metadata lives in `vault.json`; passwords and
//! passphrases live in the OS credential store; private keys are files.

use std::path::{Path, PathBuf};
use std::sync::RwLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::keys;
use crate::secrets;
use crate::ssh::{ConnectParams, KeyMaterial};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Host {
    pub id: String,
    /// Alias shown in the UI.
    pub label: String,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub key_id: Option<String>,
    pub has_password: bool,
    /// Detected distro id from /etc/os-release (`ubuntu`, `debian`, …), used for the icon.
    #[serde(default)]
    pub os: Option<String>,
    pub created_at: i64,
    #[serde(default)]
    pub last_used: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInput {
    pub id: Option<String>,
    pub label: String,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub key_id: Option<String>,
    /// `None` keeps the stored password, `Some("")` removes it.
    pub password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyEntry {
    pub id: String,
    pub label: String,
    pub algorithm: String,
    pub fingerprint: String,
    pub public_key: String,
    pub encrypted: bool,
    pub has_passphrase: bool,
    /// Private key file on disk.
    pub path: String,
    /// True when the file lives in the vault directory (and is deleted with the entry).
    pub managed: bool,
    pub created_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyImport {
    pub label: String,
    /// Pasted key text; stored inside the vault.
    pub private_key: Option<String>,
    /// Existing key file; referenced in place.
    pub path: Option<String>,
    pub passphrase: Option<String>,
}

/// Connection behaviour, read from the `connection` section of settings.json.
#[derive(Debug, Clone, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ConnectionSettings {
    pub timeout_secs: u64,
    /// 0 disables keepalives.
    pub keepalive_secs: u64,
    pub use_agent: bool,
}

impl Default for ConnectionSettings {
    fn default() -> Self {
        Self { timeout_secs: 15, keepalive_secs: 30, use_agent: true }
    }
}

#[derive(Default, Serialize, Deserialize)]
struct VaultData {
    hosts: Vec<Host>,
    keys: Vec<KeyEntry>,
}

pub struct Vault {
    dir: PathBuf,
    data: RwLock<VaultData>,
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

impl Vault {
    pub fn open(dir: impl Into<PathBuf>) -> Result<Self> {
        let dir = dir.into();
        std::fs::create_dir_all(dir.join("keys"))?;
        let file = dir.join("vault.json");
        let data = if file.exists() {
            serde_json::from_slice(&std::fs::read(&file)?)?
        } else {
            VaultData::default()
        };
        Ok(Self { dir, data: RwLock::new(data) })
    }

    pub fn known_hosts_path(&self) -> PathBuf {
        self.dir.join("known_hosts")
    }

    fn save(&self, data: &VaultData) -> Result<()> {
        self.write_json("vault.json", data)
    }

    /// Write-then-rename so a crash never leaves a truncated file.
    fn write_json(&self, name: &str, value: &impl Serialize) -> Result<()> {
        let tmp = self.dir.join(format!("{name}.tmp"));
        std::fs::write(&tmp, serde_json::to_vec_pretty(value)?)?;
        std::fs::rename(tmp, self.dir.join(name))?;
        Ok(())
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    // ----- settings -----

    /// UI settings as stored; the UI owns the schema and fills in defaults.
    pub fn settings(&self) -> serde_json::Value {
        std::fs::read(self.dir.join("settings.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_else(|| serde_json::json!({}))
    }

    pub fn save_settings(&self, value: &serde_json::Value) -> Result<()> {
        if !value.is_object() {
            return Err(Error::Invalid("Settings must be an object".into()));
        }
        self.write_json("settings.json", value)
    }

    pub fn connection_settings(&self) -> ConnectionSettings {
        self.settings()
            .get("connection")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default()
    }

    /// Connection parameters with the user's connection settings applied.
    pub fn base_params(&self, host: String, port: u16, username: String, password: Option<String>, key: Option<KeyMaterial>) -> ConnectParams {
        let c = self.connection_settings();
        ConnectParams {
            host,
            port: if port == 0 { 22 } else { port },
            username,
            password,
            key,
            try_agent_and_defaults: c.use_agent,
            known_hosts: self.known_hosts_path(),
            timeout: Duration::from_secs(c.timeout_secs.clamp(3, 120)),
            keepalive: (c.keepalive_secs > 0).then(|| Duration::from_secs(c.keepalive_secs)),
        }
    }

    // ----- hosts -----

    pub fn hosts(&self) -> Vec<Host> {
        self.data.read().unwrap().hosts.clone()
    }

    pub fn host(&self, id: &str) -> Result<Host> {
        self.data
            .read()
            .unwrap()
            .hosts
            .iter()
            .find(|h| h.id == id)
            .cloned()
            .ok_or_else(|| Error::NotFound(format!("host {id}")))
    }

    pub fn save_host(&self, input: HostInput) -> Result<Host> {
        if input.hostname.trim().is_empty() {
            return Err(Error::Invalid("Address is required".into()));
        }
        let mut data = self.data.write().unwrap();
        let existing = input.id.as_ref().and_then(|id| data.hosts.iter().position(|h| &h.id == id));
        let id = existing.map(|i| data.hosts[i].id.clone()).unwrap_or_else(new_id);

        let mut has_password = existing.map(|i| data.hosts[i].has_password).unwrap_or(false);
        match input.password.as_deref() {
            None => {}
            Some("") => {
                secrets::delete(&secrets::host_password_account(&id))?;
                has_password = false;
            }
            Some(pw) => {
                secrets::set(&secrets::host_password_account(&id), pw)?;
                has_password = true;
            }
        }

        let host = Host {
            id: id.clone(),
            label: if input.label.trim().is_empty() { input.hostname.trim().to_string() } else { input.label.trim().to_string() },
            hostname: input.hostname.trim().to_string(),
            port: if input.port == 0 { 22 } else { input.port },
            username: input.username.trim().to_string(),
            key_id: input.key_id.filter(|k| !k.is_empty()),
            has_password,
            os: existing.and_then(|i| data.hosts[i].os.clone()),
            created_at: existing.map(|i| data.hosts[i].created_at).unwrap_or_else(now_ms),
            last_used: existing.and_then(|i| data.hosts[i].last_used),
        };
        match existing {
            Some(i) => data.hosts[i] = host.clone(),
            None => data.hosts.push(host.clone()),
        }
        self.save(&data)?;
        Ok(host)
    }

    pub fn delete_host(&self, id: &str) -> Result<()> {
        let mut data = self.data.write().unwrap();
        data.hosts.retain(|h| h.id != id);
        self.save(&data)?;
        secrets::delete(&secrets::host_password_account(id))
    }

    /// Record a successful connection and (optionally) the detected OS.
    pub fn touch_host(&self, id: &str, os: Option<String>) -> Result<()> {
        let mut data = self.data.write().unwrap();
        if let Some(h) = data.hosts.iter_mut().find(|h| h.id == id) {
            h.last_used = Some(now_ms());
            if os.is_some() {
                h.os = os;
            }
        }
        self.save(&data)
    }

    pub fn host_password(&self, id: &str) -> Result<Option<String>> {
        secrets::get(&secrets::host_password_account(id))
    }

    /// Everything needed to connect to a saved host. `password` overrides the stored one.
    pub fn connect_params(&self, host_id: &str, password: Option<String>) -> Result<ConnectParams> {
        let host = self.host(host_id)?;
        let password = match password {
            Some(p) => Some(p),
            None if host.has_password => self.host_password(&host.id)?,
            None => None,
        };
        let key = host.key_id.as_deref().map(|k| self.key_material(k)).transpose()?;
        Ok(self.base_params(host.hostname, host.port, host.username, password, key))
    }

    // ----- keys -----

    pub fn keys(&self) -> Vec<KeyEntry> {
        self.data.read().unwrap().keys.clone()
    }

    fn key(&self, id: &str) -> Result<KeyEntry> {
        self.data
            .read()
            .unwrap()
            .keys
            .iter()
            .find(|k| k.id == id)
            .cloned()
            .ok_or_else(|| Error::NotFound(format!("key {id}")))
    }

    pub fn key_material(&self, id: &str) -> Result<KeyMaterial> {
        let key = self.key(id)?;
        let pem = std::fs::read_to_string(&key.path)
            .map_err(|e| Error::Key(format!("Cannot read {}: {e}", key.path)))?;
        let passphrase = if key.has_passphrase {
            secrets::get(&secrets::key_passphrase_account(id))?
        } else {
            None
        };
        Ok(KeyMaterial { pem, passphrase })
    }

    pub fn import_key(&self, input: KeyImport) -> Result<KeyEntry> {
        let id = new_id();
        let (pem, path, managed) = match (input.private_key.as_deref(), input.path.as_deref()) {
            (Some(text), _) if !text.trim().is_empty() => {
                let text = format!("{}\n", text.trim());
                let path = self.dir.join("keys").join(&id);
                (text, path, true)
            }
            (_, Some(p)) if !p.trim().is_empty() => {
                let path = expand_home(p.trim());
                let text = std::fs::read_to_string(&path)
                    .map_err(|e| Error::Key(format!("Cannot read {}: {e}", path.display())))?;
                (text, path, false)
            }
            _ => return Err(Error::Invalid("Paste a private key or choose a key file".into())),
        };

        let passphrase = input.passphrase.filter(|p| !p.is_empty());
        let info = keys::inspect(&pem, passphrase.as_deref())?;
        if managed {
            write_private(&path, &pem)?;
        }
        if let Some(p) = &passphrase {
            secrets::set(&secrets::key_passphrase_account(&id), p)?;
        }
        let label = match input.label.trim() {
            "" => path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "Key".into()),
            l => l.to_string(),
        };
        self.insert_key(KeyEntry {
            id,
            label,
            algorithm: info.algorithm,
            fingerprint: info.fingerprint,
            public_key: info.public_key,
            encrypted: info.encrypted,
            has_passphrase: passphrase.is_some(),
            path: path.to_string_lossy().into_owned(),
            managed,
            created_at: now_ms(),
        })
    }

    pub fn generate_key(&self, label: &str, passphrase: Option<String>) -> Result<KeyEntry> {
        let label = if label.trim().is_empty() { "ed25519" } else { label.trim() };
        let passphrase = passphrase.filter(|p| !p.is_empty());
        let pem = keys::generate_ed25519(&format!("{label}@knot"), passphrase.as_deref())?;
        self.import_key(KeyImport { label: label.into(), private_key: Some(pem), path: None, passphrase })
    }

    fn insert_key(&self, entry: KeyEntry) -> Result<KeyEntry> {
        let mut data = self.data.write().unwrap();
        data.keys.push(entry.clone());
        self.save(&data)?;
        Ok(entry)
    }

    pub fn rename_key(&self, id: &str, label: &str) -> Result<()> {
        let mut data = self.data.write().unwrap();
        let k = data.keys.iter_mut().find(|k| k.id == id).ok_or_else(|| Error::NotFound(id.into()))?;
        k.label = label.trim().to_string();
        self.save(&data)
    }

    pub fn delete_key(&self, id: &str) -> Result<()> {
        let mut data = self.data.write().unwrap();
        let Some(pos) = data.keys.iter().position(|k| k.id == id) else {
            return Ok(());
        };
        let key = data.keys.remove(pos);
        for h in data.hosts.iter_mut().filter(|h| h.key_id.as_deref() == Some(id)) {
            h.key_id = None;
        }
        self.save(&data)?;
        if key.managed {
            let _ = std::fs::remove_file(&key.path);
        }
        secrets::delete(&secrets::key_passphrase_account(id))
    }

    /// Find a key entry already pointing at `path`, or reference it.
    pub fn key_for_path(&self, path: &Path) -> Result<KeyEntry> {
        let p = path.to_string_lossy();
        if let Some(k) = self.keys().into_iter().find(|k| k.path == p) {
            return Ok(k);
        }
        self.import_key(KeyImport { label: String::new(), private_key: None, path: Some(p.into_owned()), passphrase: None })
    }
}

fn expand_home(p: &str) -> PathBuf {
    match (p.strip_prefix("~/"), dirs::home_dir()) {
        (Some(rest), Some(home)) => home.join(rest),
        _ => PathBuf::from(p),
    }
}

fn write_private(path: &Path, pem: &str) -> Result<()> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(path)?;
        f.write_all(pem.as_bytes())?;
    }
    #[cfg(not(unix))]
    std::fs::write(path, pem)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_roundtrip_and_connection_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::open(dir.path()).unwrap();
        assert_eq!(vault.settings(), serde_json::json!({}));
        assert_eq!(vault.connection_settings().timeout_secs, 15);

        let v = serde_json::json!({ "general": { "appearance": "light" }, "connection": { "keepaliveSecs": 0, "useAgent": false } });
        vault.save_settings(&v).unwrap();
        assert_eq!(Vault::open(dir.path()).unwrap().settings(), v);

        let p = vault.base_params("h".into(), 0, "u".into(), None, None);
        assert_eq!(p.port, 22);
        assert!(p.keepalive.is_none());
        assert!(!p.try_agent_and_defaults);
        assert_eq!(p.timeout, Duration::from_secs(15));
        assert!(vault.save_settings(&serde_json::json!([1])).is_err());
    }
}
