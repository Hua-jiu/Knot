//! Local shell in a pseudo-terminal, driven by the same `ShellInput` stream as SSH shells.

use std::io::{Read, Write};
use std::time::Duration;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tokio::sync::{mpsc, oneshot};

use crate::ssh::ShellInput;
use crate::{Error, Result};

fn pty_err(e: impl std::fmt::Display) -> Error {
    Error::Io(std::io::Error::other(e.to_string()))
}

fn size(cols: u32, rows: u32) -> PtySize {
    PtySize { rows: rows.clamp(1, u16::MAX as u32) as u16, cols: cols.clamp(1, u16::MAX as u32) as u16, pixel_width: 0, pixel_height: 0 }
}

/// The user's login shell, started in their home directory.
fn shell_command() -> CommandBuilder {
    #[cfg(windows)]
    let mut cmd = CommandBuilder::new("powershell.exe");
    #[cfg(not(windows))]
    let mut cmd = {
        let shell = std::env::var("SHELL")
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| if cfg!(target_os = "macos") { "/bin/zsh".into() } else { "/bin/sh".into() });
        let mut cmd = CommandBuilder::new(shell);
        // A login shell reads the profile, so PATH is complete even when the app was launched from Finder.
        cmd.arg("-l");
        cmd
    };
    if let Some(home) = dirs::home_dir() {
        cmd.cwd(home);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "Knot");
    // Apps started from Finder get no locale, which breaks UTF-8 input in zsh/bash.
    if std::env::var_os("LANG").is_none() && std::env::var_os("LC_ALL").is_none() {
        cmd.env("LANG", "en_US.UTF-8");
    }
    cmd
}

/// A shell running on this machine in a pseudo-terminal.
pub struct LocalShell {
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
}

impl LocalShell {
    /// Start the user's login shell. Fails if no pty is available or the shell can't be executed.
    pub fn spawn(cols: u32, rows: u32) -> Result<Self> {
        let pair = native_pty_system().openpty(size(cols, rows)).map_err(pty_err)?;
        let child = pair.slave.spawn_command(shell_command()).map_err(pty_err)?;
        Ok(Self { master: pair.master, child })
    }

    /// Pump the shell until it exits or `input` closes. Returns the exit code.
    ///
    /// `on_output` runs on a dedicated reader thread.
    pub async fn run(self, input: mpsc::Receiver<ShellInput>, on_output: impl Fn(Vec<u8>) + Send + 'static) -> Result<Option<u32>> {
        let Self { master, child } = self;
        pump(master, child, input, on_output).await
    }
}

async fn pump(
    master: Box<dyn MasterPty + Send>,
    mut child: Box<dyn Child + Send + Sync>,
    mut input: mpsc::Receiver<ShellInput>,
    on_output: impl Fn(Vec<u8>) + Send + 'static,
) -> Result<Option<u32>> {
    let mut reader = master.try_clone_reader().map_err(pty_err)?;
    let mut writer = master.take_writer().map_err(pty_err)?;
    let mut killer = child.clone_killer();

    // Writes can block while the shell isn't reading (e.g. a big paste), so they get their own thread.
    let (write_tx, write_rx) = std::sync::mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        for bytes in write_rx {
            if writer.write_all(&bytes).and_then(|_| writer.flush()).is_err() {
                break;
            }
        }
    });

    let (drained_tx, drained_rx) = oneshot::channel::<()>();
    std::thread::spawn(move || {
        let mut buf = [0u8; 16 * 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => on_output(buf[..n].to_vec()),
            }
        }
        let _ = drained_tx.send(());
    });

    let (exit_tx, mut exit_rx) = oneshot::channel::<Option<u32>>();
    std::thread::spawn(move || {
        let code = child.wait().ok().map(|s| s.exit_code());
        let _ = exit_tx.send(code);
    });

    let code = loop {
        tokio::select! {
            code = &mut exit_rx => break code.ok().flatten(),
            cmd = input.recv() => match cmd {
                Some(ShellInput::Data(bytes)) => {
                    let _ = write_tx.send(bytes);
                }
                Some(ShellInput::Resize { cols, rows }) => {
                    let _ = master.resize(size(cols, rows));
                }
                Some(ShellInput::Close) | None => {
                    let _ = killer.kill();
                    break exit_rx.await.ok().flatten();
                }
            },
        }
    };
    // Let the last output reach the screen; ConPTY never signals EOF while the master is open.
    let _ = tokio::time::timeout(Duration::from_millis(300), drained_rx).await;
    drop(write_tx);
    drop(master);
    Ok(code)
}

#[cfg(all(test, unix))]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;

    #[tokio::test]
    async fn runs_a_shell() {
        let out = Arc::new(Mutex::new(Vec::new()));
        let sink = out.clone();
        let (tx, rx) = mpsc::channel(8);
        tx.send(ShellInput::Data(b"echo knot-$((40+2)); exit 3\n".to_vec())).await.unwrap();
        let code = LocalShell::spawn(80, 24).unwrap().run(rx, move |b| sink.lock().unwrap().extend(b)).await.unwrap();
        assert_eq!(code, Some(3));
        assert!(String::from_utf8_lossy(&out.lock().unwrap()).contains("knot-42"));
    }

    #[tokio::test]
    async fn close_kills_the_shell() {
        let (tx, rx) = mpsc::channel(8);
        tx.send(ShellInput::Resize { cols: 120, rows: 40 }).await.unwrap();
        tx.send(ShellInput::Close).await.unwrap();
        let done = tokio::time::timeout(Duration::from_secs(5), LocalShell::spawn(80, 24).unwrap().run(rx, |_| {})).await;
        assert!(done.is_ok(), "shell did not exit after Close");
    }
}
