use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use knot_core::fs::Fs;
use knot_core::ssh::{ConnectParams, Connection, HostKeyPrompt, ShellInput};
use knot_core::vault::Vault;
use knot_core::{Error, Result};
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, oneshot};

pub struct SftpConn {
    pub conn: Arc<Connection>,
    pub fs: Fs,
}

pub struct AppState {
    pub vault: Vault,
    pub terms: Mutex<HashMap<String, mpsc::Sender<ShellInput>>>,
    pub sftp: Mutex<HashMap<String, SftpConn>>,
    pub transfers: Mutex<HashMap<String, Arc<AtomicBool>>>,
    pub hostkey_waiters: Mutex<HashMap<String, oneshot::Sender<bool>>>,
}

impl AppState {
    pub fn new(vault: Vault) -> Self {
        Self {
            vault,
            terms: Default::default(),
            sftp: Default::default(),
            transfers: Default::default(),
            hostkey_waiters: Default::default(),
        }
    }
}

/// What to connect to: a saved host, an ad-hoc `user@host:port` from the quick-connect bar,
/// or (terminals only) a shell on this machine.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Target {
    Local,
    Saved { host_id: String, password: Option<String> },
    Adhoc { hostname: String, port: u16, username: String, password: Option<String> },
}

impl Target {
    pub fn host_id(&self) -> Option<&str> {
        match self {
            Target::Saved { host_id, .. } => Some(host_id),
            Target::Local | Target::Adhoc { .. } => None,
        }
    }

    pub fn params(&self, vault: &Vault) -> Result<ConnectParams> {
        match self {
            Target::Local => Err(Error::Invalid("Not a remote host".into())),
            Target::Saved { host_id, password } => vault.connect_params(host_id, password.clone()),
            Target::Adhoc { hostname, port, username, password } => {
                if username.is_empty() {
                    return Err(Error::Invalid("A username is required (user@host)".into()));
                }
                Ok(vault.base_params(hostname.clone(), *port, username.clone(), password.clone(), None))
            }
        }
    }
}

/// Ask the UI whether to trust an unknown host key; resolved by the `hostkey_respond` command.
pub fn hostkey_prompt(app: AppHandle) -> HostKeyPrompt {
    Arc::new(move |info| {
        let app = app.clone();
        Box::pin(async move {
            let id = uuid::Uuid::new_v4().to_string();
            let (tx, rx) = oneshot::channel();
            app.state::<AppState>().hostkey_waiters.lock().unwrap().insert(id.clone(), tx);
            let payload = serde_json::json!({ "requestId": id, "info": info });
            if app.emit("hostkey-prompt", payload).is_err() {
                return false;
            }
            let answer = tokio::time::timeout(Duration::from_secs(300), rx).await;
            app.state::<AppState>().hostkey_waiters.lock().unwrap().remove(&id);
            matches!(answer, Ok(Ok(true)))
        })
    })
}

/// Connect, then (for saved hosts) record the connection and detect the remote OS in the background.
pub async fn open_connection(app: &AppHandle, target: &Target) -> Result<Arc<Connection>> {
    let state = app.state::<AppState>();
    let params = target.params(&state.vault)?;
    let conn = Arc::new(knot_core::ssh::connect(&params, hostkey_prompt(app.clone())).await?);
    if let Some(host_id) = target.host_id() {
        let (app, conn, host_id) = (app.clone(), conn.clone(), host_id.to_string());
        tauri::async_runtime::spawn(async move {
            let os = conn
                .exec_capture("cat /etc/os-release 2>/dev/null || uname -s")
                .await
                .ok()
                .and_then(|out| parse_os(&String::from_utf8_lossy(&out)));
            if app.state::<AppState>().vault.touch_host(&host_id, os).is_ok() {
                let _ = app.emit("hosts-changed", ());
            }
        });
    }
    Ok(conn)
}

fn parse_os(text: &str) -> Option<String> {
    let id = text.lines().find_map(|l| l.strip_prefix("ID=")).map(|v| v.trim_matches('"').to_lowercase());
    id.or_else(|| {
        let first = text.lines().next()?.trim().to_lowercase();
        (!first.is_empty() && !first.contains(' ')).then_some(first)
    })
}

#[cfg(test)]
mod tests {
    use super::parse_os;

    #[test]
    fn os_detection() {
        assert_eq!(parse_os("NAME=\"Ubuntu\"\nID=ubuntu\nID_LIKE=debian\n").as_deref(), Some("ubuntu"));
        assert_eq!(parse_os("ID=\"centos\"\n").as_deref(), Some("centos"));
        assert_eq!(parse_os("Darwin\n").as_deref(), Some("darwin"));
        assert_eq!(parse_os("").as_deref(), None);
    }
}
