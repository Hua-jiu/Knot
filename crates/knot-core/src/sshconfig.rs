//! Import concrete `Host` blocks from ~/.ssh/config.

use std::io::BufReader;
use std::path::{Path, PathBuf};

use ssh2_config::{ParseRule, SshConfig};

use crate::error::{Error, Result};
use crate::vault::{HostInput, Vault};

#[derive(Debug, Clone, PartialEq)]
pub struct ConfigHost {
    pub alias: String,
    pub hostname: String,
    pub port: u16,
    pub username: Option<String>,
    pub identity_file: Option<PathBuf>,
}

pub fn default_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".ssh").join("config"))
}

/// Parse a config file, skipping wildcard patterns (they are defaults, not hosts).
pub fn parse(path: &Path) -> Result<Vec<ConfigHost>> {
    let file = std::fs::File::open(path)?;
    let config = SshConfig::default()
        .parse(&mut BufReader::new(file), ParseRule::ALLOW_UNKNOWN_FIELDS | ParseRule::ALLOW_UNSUPPORTED_FIELDS)
        .map_err(|e| Error::Invalid(format!("ssh config: {e}")))?;

    let mut out = Vec::new();
    for host in config.get_hosts() {
        for clause in &host.pattern {
            let alias = clause.pattern.as_str();
            if clause.negated || alias.contains(['*', '?', '!']) {
                continue;
            }
            // `query` merges matching blocks (incl. wildcard defaults) like OpenSSH does.
            let p = config.query(alias);
            out.push(ConfigHost {
                alias: alias.to_string(),
                hostname: p.host_name.clone().unwrap_or_else(|| alias.to_string()),
                port: p.port.unwrap_or(22),
                username: p.user.clone(),
                identity_file: p.identity_file.as_ref().and_then(|v| v.first().cloned()),
            });
        }
    }
    Ok(out)
}

/// Add config hosts that are not yet in the vault (matched by alias + address). Returns how many were added.
pub fn import_into(vault: &Vault, path: &Path) -> Result<usize> {
    let existing = vault.hosts();
    let mut added = 0;
    for ch in parse(path)? {
        if existing.iter().any(|h| h.label == ch.alias && h.hostname == ch.hostname) {
            continue;
        }
        let key_id = match &ch.identity_file {
            Some(p) if p.exists() => vault.key_for_path(p).ok().map(|k| k.id),
            _ => None,
        };
        vault.save_host(HostInput {
            id: None,
            label: ch.alias,
            hostname: ch.hostname,
            port: ch.port,
            username: ch.username.unwrap_or_default(),
            key_id,
            password: None,
        })?;
        added += 1;
    }
    Ok(added)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_concrete_hosts_only() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config");
        std::fs::write(
            &path,
            "Host web\n  HostName 10.0.0.2\n  Port 2222\n\nHost db db2\n  User admin\n\nHost *\n  User fallback\n",
        )
        .unwrap();
        let hosts = parse(&path).unwrap();
        let names: Vec<_> = hosts.iter().map(|h| h.alias.as_str()).collect();
        assert_eq!(names, ["web", "db", "db2"]);
        assert_eq!(hosts[0].hostname, "10.0.0.2");
        assert_eq!(hosts[0].port, 2222);
        assert_eq!(hosts[1].username.as_deref(), Some("admin"));
        assert_eq!(hosts[1].hostname, "db");
        // Wildcard defaults fill in what a block leaves unset (first value wins, as in OpenSSH).
        assert_eq!(hosts[0].username.as_deref(), Some("fallback"));
    }
}
