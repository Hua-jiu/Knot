//! End-to-end tests against a real SSH server. Skipped unless configured:
//!
//! KNOT_TEST_HOST, KNOT_TEST_PORT, KNOT_TEST_USER, KNOT_TEST_KEY (unencrypted private key path),
//! optionally KNOT_TEST_KEY_ENC + KNOT_TEST_KEY_PASS (encrypted key and its passphrase).
//! The remote side must share this machine's file system (e.g. sshd on localhost).

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use knot_core::fs::{copy_into, Fs};
use knot_core::ssh::{self, ConnectParams, HostKeyPrompt, KeyMaterial, ShellInput};
use knot_core::Error;

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

fn base(known_hosts: &std::path::Path) -> Option<ConnectParams> {
    Some(ConnectParams {
        host: env("KNOT_TEST_HOST")?,
        port: env("KNOT_TEST_PORT")?.parse().ok()?,
        username: env("KNOT_TEST_USER")?,
        password: None,
        key: Some(KeyMaterial { pem: std::fs::read_to_string(env("KNOT_TEST_KEY")?).ok()?, passphrase: None }),
        try_agent_and_defaults: false,
        known_hosts: known_hosts.to_path_buf(),
        timeout: std::time::Duration::from_secs(10),
        keepalive: None,
    })
}

fn prompt(answer: bool, calls: Arc<AtomicUsize>) -> HostKeyPrompt {
    Arc::new(move |_| {
        calls.fetch_add(1, Ordering::SeqCst);
        Box::pin(async move { answer })
    })
}

#[tokio::test]
async fn live_end_to_end() {
    let tmp = tempfile::tempdir().unwrap();
    let kh = tmp.path().join("known_hosts");
    let Some(params) = base(&kh) else {
        eprintln!("skipping: KNOT_TEST_* not set");
        return;
    };

    // Unknown host rejected → nothing recorded.
    let calls = Arc::new(AtomicUsize::new(0));
    let err = ssh::connect(&params, prompt(false, calls.clone())).await.err().unwrap();
    assert!(matches!(err, Error::HostKeyRejected { .. }), "{err}");
    assert_eq!(calls.load(Ordering::SeqCst), 1);

    // Accepted → learned; the next connection must not prompt.
    ssh::connect(&params, prompt(true, calls.clone())).await.unwrap().disconnect().await;
    assert!(std::fs::read_to_string(&kh).unwrap().contains("ssh-ed25519"));
    let conn = ssh::connect(&params, prompt(false, calls.clone())).await.unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 2);

    // Shell round trip.
    let ch = conn.open_shell(80, 24).await.unwrap();
    let (tx, rx) = tokio::sync::mpsc::channel(8);
    tx.send(ShellInput::Resize { cols: 100, rows: 30 }).await.unwrap();
    tx.send(ShellInput::Data(b"echo knot-$((40+2)); exit 3\n".to_vec())).await.unwrap();
    let mut out = Vec::new();
    let code = tokio::time::timeout(std::time::Duration::from_secs(10), ssh::run_shell(ch, rx, |b| out.extend(b)))
        .await
        .expect("shell timed out");
    assert!(String::from_utf8_lossy(&out).contains("knot-42"));
    assert_eq!(code, Some(3));

    // OS probe used for host icons.
    let os = conn.exec_capture("uname -s").await.unwrap();
    assert!(!os.is_empty());

    // SFTP: upload a tree, list it, download it back, rename, delete.
    let sftp = Fs::Remote(Arc::new(conn.open_sftp().await.unwrap()));
    let local = Fs::Local;
    let src = tmp.path().join("src");
    std::fs::create_dir_all(src.join("nested")).unwrap();
    let payload: Vec<u8> = (0..1_500_000u32).map(|i| (i % 251) as u8).collect();
    std::fs::write(src.join("nested/blob.bin"), &payload).unwrap();
    std::fs::write(src.join("hello.txt"), "hi").unwrap();
    let remote_dir = tmp.path().join("remote").to_string_lossy().into_owned();
    sftp.mkdir(&remote_dir).await.unwrap();
    let s = |p: std::path::PathBuf| p.to_string_lossy().into_owned();

    let mut last = None;
    copy_into(&local, &[s(src.clone())], &sftp, &remote_dir, false, Default::default(), |p| last = Some(p.clone()))
        .await
        .unwrap();
    assert_eq!(last.unwrap().bytes_done, payload.len() as u64 + 2);
    let listing = sftp.list(&sftp.join(&remote_dir, "src"), false).await.unwrap();
    let mut names: Vec<_> = listing.entries.iter().map(|e| e.name.as_str()).collect();
    names.sort();
    assert_eq!(names, ["hello.txt", "nested"]);
    assert!(listing.entries.iter().any(|e| e.is_dir && e.permissions.as_deref().unwrap_or("").starts_with('d')));

    let head = sftp.read_head(&format!("{remote_dir}/src/nested/blob.bin"), 10).await.unwrap();
    assert_eq!(head, payload[..10]);

    let back = tmp.path().join("back");
    std::fs::create_dir(&back).unwrap();
    copy_into(&sftp, &[format!("{remote_dir}/src")], &local, &s(back.clone()), false, Default::default(), |_| {})
        .await
        .unwrap();
    assert_eq!(std::fs::read(back.join("src/nested/blob.bin")).unwrap(), payload);

    let err = copy_into(&local, &[s(src.clone())], &sftp, &remote_dir, false, Default::default(), |_| {})
        .await
        .unwrap_err();
    assert!(matches!(err, Error::Exists(_)));

    sftp.move_into(&[format!("{remote_dir}/src/hello.txt")], &format!("{remote_dir}/src/nested")).await.unwrap();
    assert!(sftp.exists(&format!("{remote_dir}/src/nested/hello.txt")).await.unwrap());
    sftp.remove_all(&format!("{remote_dir}/src")).await.unwrap();
    assert!(!sftp.exists(&format!("{remote_dir}/src")).await.unwrap());
    conn.disconnect().await;

    // Encrypted key: correct passphrase works, missing one fails cleanly.
    if let (Some(path), Some(pass)) = (env("KNOT_TEST_KEY_ENC"), env("KNOT_TEST_KEY_PASS")) {
        let pem = std::fs::read_to_string(path).unwrap();
        let mut p = params.clone();
        p.key = Some(KeyMaterial { pem: pem.clone(), passphrase: Some(pass) });
        ssh::connect(&p, prompt(false, calls.clone())).await.unwrap().disconnect().await;
        p.key = Some(KeyMaterial { pem, passphrase: None });
        assert!(matches!(ssh::connect(&p, prompt(false, calls.clone())).await, Err(Error::Key(_))));
    }

    // No usable credentials.
    let mut p = params.clone();
    p.key = None;
    assert!(matches!(ssh::connect(&p, prompt(false, calls.clone())).await, Err(Error::AuthFailed)));

    // A different key recorded for this host must be refused as changed.
    let line = std::fs::read_to_string(&kh).unwrap();
    let host_field = line.split_whitespace().next().unwrap().to_string();
    let other = knot_core::keys::generate_ed25519("x", None).unwrap();
    let other_pub = knot_core::keys::inspect(&other, None).unwrap().public_key;
    std::fs::write(&kh, format!("{host_field} {other_pub}\n")).unwrap();
    let err = ssh::connect(&params, prompt(true, calls)).await.err().unwrap();
    assert!(matches!(err, Error::HostKeyChanged { .. }), "{err}");
}
