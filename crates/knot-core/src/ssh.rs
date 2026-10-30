//! SSH connections: host key verification, authentication, shells and SFTP.

use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use russh::client::{self, Handle, KeyboardInteractiveAuthResponse, Msg};
use russh::keys::known_hosts::{check_known_hosts_path, learn_known_hosts_path};
use russh::keys::{HashAlg, PrivateKey, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh::{Channel, ChannelMsg};
use russh_sftp::client::SftpSession;
use serde::Serialize;
use tokio::sync::mpsc;

use crate::error::{Error, Result};
use crate::keys;

const DEFAULT_KEY_FILES: &[&str] = &["id_ed25519", "id_ecdsa", "id_rsa"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostKeyInfo {
    pub host: String,
    pub port: u16,
    pub algorithm: String,
    pub fingerprint: String,
}

/// Asked when a server presents a key that is in no known_hosts file.
/// Resolve to `true` to trust (and remember) it.
pub type HostKeyPrompt =
    Arc<dyn Fn(HostKeyInfo) -> Pin<Box<dyn Future<Output = bool> + Send>> + Send + Sync>;

#[derive(Clone)]
pub struct KeyMaterial {
    pub pem: String,
    pub passphrase: Option<String>,
}

#[derive(Clone)]
pub struct ConnectParams {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub key: Option<KeyMaterial>,
    /// Try the SSH agent and ~/.ssh/id_* when no explicit key succeeds.
    pub try_agent_and_defaults: bool,
    /// Where newly trusted host keys are written. ~/.ssh/known_hosts is read but never written.
    pub known_hosts: PathBuf,
    pub timeout: Duration,
    /// Interval between keepalive probes; `None` disables them.
    pub keepalive: Option<Duration>,
}

struct Client {
    host: String,
    port: u16,
    known_hosts: PathBuf,
    prompt: HostKeyPrompt,
}

impl client::Handler for Client {
    type Error = Error;

    async fn check_server_key(&mut self, key: &PublicKeyOrCertificate) -> Result<bool> {
        let pk = key.public_key();
        let user_file = dirs::home_dir().map(|h| h.join(".ssh").join("known_hosts"));
        for path in user_file.iter().chain(std::iter::once(&self.known_hosts)) {
            if !path.exists() {
                continue;
            }
            match check_known_hosts_path(&self.host, self.port, &pk, path) {
                Ok(true) => return Ok(true),
                Ok(false) => {}
                Err(russh::keys::Error::KeyChanged { line }) => {
                    return Err(Error::HostKeyChanged { host: self.host.clone(), line })
                }
                Err(e) => log::warn!("known_hosts {}: {e}", path.display()),
            }
        }
        let info = HostKeyInfo {
            host: self.host.clone(),
            port: self.port,
            algorithm: pk.algorithm().as_str().to_string(),
            fingerprint: pk.fingerprint(HashAlg::Sha256).to_string(),
        };
        if !(self.prompt)(info).await {
            return Err(Error::HostKeyRejected { host: self.host.clone() });
        }
        if let Some(dir) = self.known_hosts.parent() {
            std::fs::create_dir_all(dir)?;
        }
        if let Err(e) = learn_known_hosts_path(&self.host, self.port, &pk, &self.known_hosts) {
            log::warn!("could not record host key: {e}");
        }
        Ok(true)
    }
}

/// An authenticated SSH connection. Cheap to share; channels are opened on demand.
pub struct Connection {
    handle: Handle<Client>,
}

pub async fn connect(params: &ConnectParams, prompt: HostKeyPrompt) -> Result<Connection> {
    let config = Arc::new(client::Config {
        keepalive_interval: params.keepalive,
        keepalive_max: 3,
        nodelay: true,
        ..Default::default()
    });
    let handler = Client {
        host: params.host.clone(),
        port: params.port,
        known_hosts: params.known_hosts.clone(),
        prompt,
    };
    let fut = client::connect(config, (params.host.as_str(), params.port), handler);
    let mut handle = tokio::time::timeout(params.timeout, fut)
        .await
        .map_err(|_| Error::Ssh(format!("Timed out connecting to {}:{}", params.host, params.port)))??;
    authenticate(&mut handle, params).await?;
    Ok(Connection { handle })
}

async fn authenticate(handle: &mut Handle<Client>, p: &ConnectParams) -> Result<()> {
    let user = p.username.as_str();
    let mut key_error = None;

    if let Some(km) = &p.key {
        match keys::decode(&km.pem, km.passphrase.as_deref()) {
            Ok(key) => {
                if try_key(handle, user, key).await? {
                    return Ok(());
                }
            }
            // Remember why the key could not be used; a password may still work.
            Err(e) => key_error = Some(e),
        }
    }

    if p.try_agent_and_defaults {
        if try_agent(handle, user).await {
            return Ok(());
        }
        if p.key.is_none() {
            for key in default_keys() {
                if try_key(handle, user, key).await? {
                    return Ok(());
                }
            }
        }
    }

    if let Some(pw) = p.password.as_deref().filter(|s| !s.is_empty()) {
        if handle.authenticate_password(user, pw).await?.success() {
            return Ok(());
        }
        if try_keyboard_interactive(handle, user, pw).await? {
            return Ok(());
        }
    }

    Err(key_error.unwrap_or(Error::AuthFailed))
}

async fn try_key(handle: &mut Handle<Client>, user: &str, key: PrivateKey) -> Result<bool> {
    let hash = handle.best_supported_rsa_hash().await?.flatten();
    let res = handle
        .authenticate_publickey(user, PrivateKeyWithHashAlg::new(Arc::new(key), hash))
        .await?;
    Ok(res.success())
}

async fn try_keyboard_interactive(handle: &mut Handle<Client>, user: &str, pw: &str) -> Result<bool> {
    let mut resp = handle.authenticate_keyboard_interactive_start(user, None).await?;
    // Bounded: a misbehaving server must not keep us looping.
    for _ in 0..5 {
        match resp {
            KeyboardInteractiveAuthResponse::Success => return Ok(true),
            KeyboardInteractiveAuthResponse::Failure { .. } => return Ok(false),
            KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. } => {
                let answers = prompts
                    .iter()
                    .map(|pr| if pr.echo { String::new() } else { pw.to_string() })
                    .collect();
                resp = handle.authenticate_keyboard_interactive_respond(answers).await?;
            }
        }
    }
    Ok(false)
}

#[cfg(unix)]
async fn agent_client() -> Option<russh::keys::agent::client::AgentClient<tokio::net::UnixStream>> {
    russh::keys::agent::client::AgentClient::connect_env().await.ok()
}

#[cfg(windows)]
async fn agent_client(
) -> Option<russh::keys::agent::client::AgentClient<tokio::net::windows::named_pipe::NamedPipeClient>> {
    russh::keys::agent::client::AgentClient::connect_named_pipe(r"\\.\pipe\openssh-ssh-agent")
        .await
        .ok()
}

async fn try_agent(handle: &mut Handle<Client>, user: &str) -> bool {
    let Some(mut agent) = agent_client().await else {
        return false;
    };
    let Ok(identities) = agent.request_identities().await else {
        return false;
    };
    let hash = handle.best_supported_rsa_hash().await.ok().flatten().flatten();
    for id in identities {
        let key = id.public_key().into_owned();
        match handle.authenticate_publickey_with(user, key, hash, &mut agent).await {
            Ok(r) if r.success() => return true,
            Ok(_) => {}
            Err(e) => log::debug!("agent identity failed: {e:?}"),
        }
    }
    false
}

/// Unencrypted keys in ~/.ssh, mirroring OpenSSH's defaults.
fn default_keys() -> Vec<PrivateKey> {
    let Some(dir) = dirs::home_dir().map(|h| h.join(".ssh")) else {
        return vec![];
    };
    DEFAULT_KEY_FILES
        .iter()
        .filter_map(|name| read_key_file(&dir.join(name)))
        .collect()
}

fn read_key_file(path: &Path) -> Option<PrivateKey> {
    let pem = std::fs::read_to_string(path).ok()?;
    keys::decode(&pem, None).ok()
}

/// Commands from the UI to a running shell.
#[derive(Debug)]
pub enum ShellInput {
    Data(Vec<u8>),
    Resize { cols: u32, rows: u32 },
    Close,
}

impl Connection {
    pub async fn open_shell(&self, cols: u32, rows: u32) -> Result<Channel<Msg>> {
        let ch = self.handle.channel_open_session().await?;
        ch.request_pty(false, "xterm-256color", cols, rows, 0, 0, &[]).await?;
        ch.set_env(false, "LANG", "en_US.UTF-8").await.ok();
        ch.request_shell(true).await?;
        Ok(ch)
    }

    /// Run a command and collect stdout (bounded), for small probes like OS detection.
    pub async fn exec_capture(&self, command: &str) -> Result<Vec<u8>> {
        let mut ch = self.handle.channel_open_session().await?;
        ch.exec(true, command).await?;
        let mut out = Vec::new();
        while let Some(msg) = ch.wait().await {
            match msg {
                ChannelMsg::Data { data } if out.len() < 64 * 1024 => out.extend_from_slice(&data),
                ChannelMsg::Eof | ChannelMsg::Close => break,
                _ => {}
            }
        }
        Ok(out)
    }

    pub async fn open_sftp(&self) -> Result<SftpSession> {
        let ch = self.handle.channel_open_session().await?;
        ch.request_subsystem(true, "sftp").await?;
        Ok(SftpSession::new(ch.into_stream()).await?)
    }

    pub fn is_closed(&self) -> bool {
        self.handle.is_closed()
    }

    pub async fn disconnect(&self) {
        let _ = self
            .handle
            .disconnect(russh::Disconnect::ByApplication, "", "en")
            .await;
    }
}

/// Pump a shell until it exits or `Close` is received. Returns the exit status if the server sent one.
pub async fn run_shell(
    channel: Channel<Msg>,
    mut input: mpsc::Receiver<ShellInput>,
    mut on_output: impl FnMut(Vec<u8>),
) -> Option<u32> {
    let (mut rd, wr) = channel.split();
    let mut exit = None;
    loop {
        tokio::select! {
            msg = rd.wait() => match msg {
                Some(ChannelMsg::Data { data }) => on_output(data.to_vec()),
                Some(ChannelMsg::ExtendedData { data, .. }) => on_output(data.to_vec()),
                Some(ChannelMsg::ExitStatus { exit_status }) => exit = Some(exit_status),
                Some(ChannelMsg::Close) | None => break,
                Some(_) => {}
            },
            cmd = input.recv() => match cmd {
                Some(ShellInput::Data(bytes)) => {
                    if wr.data_bytes(bytes).await.is_err() { break; }
                }
                Some(ShellInput::Resize { cols, rows }) => {
                    let _ = wr.window_change(cols, rows, 0, 0).await;
                }
                Some(ShellInput::Close) | None => {
                    let _ = wr.close().await;
                    break;
                }
            },
        }
    }
    exit
}
