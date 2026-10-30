use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use knot_core::fs::{copy_into, FileEntry, Fs, Listing, Progress};
use knot_core::pty::LocalShell;
use knot_core::ssh::{run_shell, ShellInput};
use knot_core::vault::{Host, HostInput, KeyEntry, KeyImport};
use knot_core::{sshconfig, Error, Result};
use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody, Response};
use tauri::{AppHandle, Manager, State};
use tokio::sync::mpsc;

use crate::state::{open_connection, AppState, SftpConn, Target};

const PREVIEW_MAX: u64 = 4 * 1024 * 1024;

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

// ===== Vault =====

#[tauri::command]
pub fn hosts_list(state: State<'_, AppState>) -> Vec<Host> {
    state.vault.hosts()
}

#[tauri::command]
pub fn host_save(state: State<'_, AppState>, input: HostInput) -> Result<Host> {
    state.vault.save_host(input)
}

#[tauri::command]
pub fn host_delete(state: State<'_, AppState>, id: String) -> Result<()> {
    state.vault.delete_host(&id)
}

#[tauri::command]
pub fn keys_list(state: State<'_, AppState>) -> Vec<KeyEntry> {
    state.vault.keys()
}

#[tauri::command]
pub fn key_import(state: State<'_, AppState>, input: KeyImport) -> Result<KeyEntry> {
    state.vault.import_key(input)
}

#[tauri::command]
pub fn key_generate(state: State<'_, AppState>, label: String, passphrase: Option<String>) -> Result<KeyEntry> {
    state.vault.generate_key(&label, passphrase)
}

#[tauri::command]
pub fn key_rename(state: State<'_, AppState>, id: String, label: String) -> Result<()> {
    state.vault.rename_key(&id, &label)
}

#[tauri::command]
pub fn key_delete(state: State<'_, AppState>, id: String) -> Result<()> {
    state.vault.delete_key(&id)
}

#[tauri::command]
pub fn sshconfig_import(state: State<'_, AppState>) -> Result<usize> {
    let path = sshconfig::default_path()
        .filter(|p| p.exists())
        .ok_or_else(|| Error::NotFound("~/.ssh/config".into()))?;
    sshconfig::import_into(&state.vault, &path)
}

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> serde_json::Value {
    state.vault.settings()
}

#[tauri::command]
pub fn settings_set(state: State<'_, AppState>, value: serde_json::Value) -> Result<()> {
    state.vault.save_settings(&value)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    data_dir: String,
    platform: &'static str,
    arch: &'static str,
}

#[tauri::command]
pub fn app_info(app: AppHandle, state: State<'_, AppState>) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        data_dir: state.vault.dir().to_string_lossy().into_owned(),
        platform: std::env::consts::OS,
        arch: std::env::consts::ARCH,
    }
}

#[tauri::command]
pub fn hostkey_respond(state: State<'_, AppState>, request_id: String, accept: bool) {
    if let Some(tx) = state.hostkey_waiters.lock().unwrap().remove(&request_id) {
        let _ = tx.send(accept);
    }
}

// ===== Terminal =====

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TermEvent {
    Exit { code: Option<u32> },
}

/// Terminal output goes through a binary `Channel` (not the event system) so
/// bursts like `cat big.log` stay smooth.
#[tauri::command]
pub async fn term_open(
    app: AppHandle,
    target: Target,
    cols: u32,
    rows: u32,
    on_data: Channel<InvokeResponseBody>,
    on_event: Channel<TermEvent>,
) -> Result<String> {
    let id = new_id();
    let (tx, rx) = mpsc::channel(512);

    if let Target::Local = target {
        let shell = LocalShell::spawn(cols, rows)?;
        app.state::<AppState>().terms.lock().unwrap().insert(id.clone(), tx);
        let tid = id.clone();
        tauri::async_runtime::spawn(async move {
            let code = shell.run(rx, move |bytes| {
                let _ = on_data.send(InvokeResponseBody::Raw(bytes));
            })
            .await;
            app.state::<AppState>().terms.lock().unwrap().remove(&tid);
            let code = match code {
                Ok(code) => code,
                Err(e) => {
                    log::warn!("local shell failed: {e}");
                    None
                }
            };
            let _ = on_event.send(TermEvent::Exit { code });
        });
        return Ok(id);
    }

    let conn = open_connection(&app, &target).await?;
    let channel = conn.open_shell(cols.max(1), rows.max(1)).await?;
    app.state::<AppState>().terms.lock().unwrap().insert(id.clone(), tx);

    let tid = id.clone();
    tauri::async_runtime::spawn(async move {
        let code = run_shell(channel, rx, |bytes| {
            let _ = on_data.send(InvokeResponseBody::Raw(bytes));
        })
        .await;
        conn.disconnect().await;
        app.state::<AppState>().terms.lock().unwrap().remove(&tid);
        let _ = on_event.send(TermEvent::Exit { code });
    });
    Ok(id)
}

async fn term_send(state: &AppState, id: &str, input: ShellInput) -> Result<()> {
    let tx = state.terms.lock().unwrap().get(id).cloned();
    match tx {
        Some(tx) => tx.send(input).await.map_err(|_| Error::Ssh("Session closed".into())),
        None => Err(Error::Ssh("Session closed".into())),
    }
}

#[tauri::command]
pub async fn term_write(state: State<'_, AppState>, id: String, data: String) -> Result<()> {
    term_send(&state, &id, ShellInput::Data(data.into_bytes())).await
}

#[tauri::command]
pub async fn term_resize(state: State<'_, AppState>, id: String, cols: u32, rows: u32) -> Result<()> {
    term_send(&state, &id, ShellInput::Resize { cols, rows }).await
}

#[tauri::command]
pub async fn term_close(state: State<'_, AppState>, id: String) -> Result<()> {
    // Already-closed sessions are fine to "close" again.
    let _ = term_send(&state, &id, ShellInput::Close).await;
    Ok(())
}

// ===== SFTP sessions =====

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpOpened {
    session_id: String,
    home: String,
}

#[tauri::command]
pub async fn sftp_open(app: AppHandle, target: Target) -> Result<SftpOpened> {
    let conn = open_connection(&app, &target).await?;
    let fs = Fs::Remote(Arc::new(conn.open_sftp().await?));
    let home = fs.home().await.unwrap_or_else(|_| "/".into());
    let session_id = new_id();
    app.state::<AppState>()
        .sftp
        .lock()
        .unwrap()
        .insert(session_id.clone(), SftpConn { conn, fs });
    Ok(SftpOpened { session_id, home })
}

#[tauri::command]
pub async fn sftp_close(state: State<'_, AppState>, session_id: String) -> Result<()> {
    let removed = state.sftp.lock().unwrap().remove(&session_id);
    if let Some(s) = removed {
        s.conn.disconnect().await;
    }
    Ok(())
}

// ===== File systems (local or SFTP) =====

#[derive(Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Source {
    Local,
    Remote { session_id: String },
}

fn resolve(state: &AppState, src: &Source) -> Result<Fs> {
    match src {
        Source::Local => Ok(Fs::Local),
        Source::Remote { session_id } => {
            let map = state.sftp.lock().unwrap();
            let s = map.get(session_id).ok_or_else(|| Error::Sftp("Session closed".into()))?;
            if s.conn.is_closed() {
                return Err(Error::Sftp("Connection lost".into()));
            }
            Ok(s.fs.clone())
        }
    }
}

#[tauri::command]
pub async fn fs_home(state: State<'_, AppState>, source: Source) -> Result<String> {
    resolve(&state, &source)?.home().await
}

#[tauri::command]
pub async fn fs_list(state: State<'_, AppState>, source: Source, path: String, show_hidden: bool) -> Result<Listing> {
    resolve(&state, &source)?.list(&path, show_hidden).await
}

#[tauri::command]
pub async fn fs_stat(state: State<'_, AppState>, source: Source, path: String) -> Result<FileEntry> {
    resolve(&state, &source)?.stat(&path).await
}

/// Raw bytes (binary IPC) from the start of a file, for Quick Look.
#[tauri::command]
pub async fn fs_preview(state: State<'_, AppState>, source: Source, path: String, max: Option<u64>) -> Result<Response> {
    let fs = resolve(&state, &source)?;
    let bytes = fs.read_head(&path, max.unwrap_or(PREVIEW_MAX).min(PREVIEW_MAX * 8)).await?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub async fn fs_mkdir(state: State<'_, AppState>, source: Source, dir: String, name: String) -> Result<String> {
    let fs = resolve(&state, &source)?;
    let path = fs.join(&dir, &name);
    fs.mkdir(&path).await?;
    Ok(path)
}

#[tauri::command]
pub async fn fs_rename(state: State<'_, AppState>, source: Source, path: String, new_name: String) -> Result<String> {
    if new_name.is_empty() || new_name.contains('/') || new_name.contains('\\') {
        return Err(Error::Invalid("Invalid name".into()));
    }
    let fs = resolve(&state, &source)?;
    let parent = path_parent(&fs, &path);
    let dest = fs.join(&parent, &new_name);
    fs.rename(&path, &dest).await?;
    Ok(dest)
}

fn path_parent(fs: &Fs, path: &str) -> String {
    match fs {
        Fs::Local => std::path::Path::new(path)
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string()),
        Fs::Remote(_) => match path.trim_end_matches('/').rsplit_once('/') {
            Some(("", _)) | None => "/".into(),
            Some((p, _)) => p.into(),
        },
    }
}

#[tauri::command]
pub async fn fs_move(state: State<'_, AppState>, source: Source, paths: Vec<String>, dir: String) -> Result<()> {
    resolve(&state, &source)?.move_into(&paths, &dir).await
}

#[tauri::command]
pub async fn fs_delete(state: State<'_, AppState>, source: Source, paths: Vec<String>) -> Result<()> {
    let fs = resolve(&state, &source)?;
    for p in &paths {
        fs.remove_all(p).await?;
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TransferEvent {
    Progress(Progress),
    Done,
    Failed { error: Error },
}

/// Copy between panes. Conflicts are reported synchronously (as `exists`) so the
/// UI can ask before anything is written; the copy itself runs in the background.
#[tauri::command]
pub async fn fs_transfer(
    app: AppHandle,
    from: Source,
    paths: Vec<String>,
    to: Source,
    dir: String,
    overwrite: bool,
    on_event: Channel<TransferEvent>,
) -> Result<String> {
    let state = app.state::<AppState>();
    let src = resolve(&state, &from)?;
    let dst = resolve(&state, &to)?;
    if !overwrite {
        for p in &paths {
            let name = src.file_name(p);
            if dst.exists(&dst.join(&dir, &name)).await? {
                return Err(Error::Exists(name));
            }
        }
    }
    let id = new_id();
    let cancel = Arc::new(AtomicBool::new(false));
    state.transfers.lock().unwrap().insert(id.clone(), cancel.clone());

    let tid = id.clone();
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let res = copy_into(&src, &paths, &dst, &dir, overwrite, cancel, |p| {
            let _ = on_event.send(TransferEvent::Progress(p.clone()));
        })
        .await;
        app2.state::<AppState>().transfers.lock().unwrap().remove(&tid);
        let _ = on_event.send(match res {
            Ok(()) => TransferEvent::Done,
            Err(error) => TransferEvent::Failed { error },
        });
    });
    Ok(id)
}

#[tauri::command]
pub fn transfer_cancel(state: State<'_, AppState>, id: String) {
    if let Some(flag) = state.transfers.lock().unwrap().get(&id) {
        flag.store(true, Ordering::Relaxed);
    }
}
