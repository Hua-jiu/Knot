//! A single file-system interface over the local disk and SFTP sessions,
//! so the UI and transfers treat both sides identically.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use serde::Serialize;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use crate::error::{Error, Result};

const COPY_BUF: usize = 256 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    /// True for directories and symlinks that resolve to directories.
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    /// Unix seconds.
    pub modified: Option<i64>,
    /// `ls -l` style, e.g. `drwxr-xr-x`. Absent on platforms without POSIX modes.
    pub permissions: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Segment {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub path: String,
    pub parent: Option<String>,
    pub segments: Vec<Segment>,
    pub entries: Vec<FileEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub files_done: u64,
    pub files_total: u64,
    pub current: String,
}

#[derive(Clone)]
pub enum Fs {
    Local,
    Remote(Arc<SftpSession>),
}

type Reader = Box<dyn AsyncRead + Unpin + Send>;
type Writer = Box<dyn AsyncWrite + Unpin + Send>;

impl Fs {
    pub async fn home(&self) -> Result<String> {
        match self {
            Fs::Local => dirs::home_dir()
                .map(|p| p.to_string_lossy().into_owned())
                .ok_or_else(|| Error::NotFound("home directory".into())),
            Fs::Remote(s) => Ok(s.canonicalize(".").await?),
        }
    }

    pub fn join(&self, dir: &str, name: &str) -> String {
        match self {
            Fs::Local => Path::new(dir).join(name).to_string_lossy().into_owned(),
            Fs::Remote(_) => {
                if dir.ends_with('/') {
                    format!("{dir}{name}")
                } else {
                    format!("{dir}/{name}")
                }
            }
        }
    }

    pub fn file_name(&self, path: &str) -> String {
        match self {
            Fs::Local => Path::new(path)
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.to_string()),
            Fs::Remote(_) => path
                .trim_end_matches('/')
                .rsplit('/')
                .next()
                .filter(|s| !s.is_empty())
                .unwrap_or("/")
                .to_string(),
        }
    }

    /// Whether `path` is `ancestor` or lies inside it.
    pub fn is_within(&self, path: &str, ancestor: &str) -> bool {
        match self {
            Fs::Local => Path::new(path).starts_with(ancestor),
            Fs::Remote(_) => {
                let a = ancestor.trim_end_matches('/');
                path == a || path.starts_with(&format!("{a}/")) || a.is_empty()
            }
        }
    }

    fn segments(&self, path: &str) -> (Option<String>, Vec<Segment>) {
        match self {
            Fs::Local => {
                let p = Path::new(path);
                let mut segs: Vec<Segment> = p
                    .ancestors()
                    .map(|a| Segment {
                        name: a
                            .file_name()
                            .map(|n| n.to_string_lossy().into_owned())
                            .unwrap_or_else(|| a.to_string_lossy().into_owned()),
                        path: a.to_string_lossy().into_owned(),
                    })
                    .collect();
                segs.reverse();
                let parent = p.parent().map(|x| x.to_string_lossy().into_owned());
                (parent, segs)
            }
            Fs::Remote(_) => remote_segments(path),
        }
    }

    pub async fn list(&self, path: &str, show_hidden: bool) -> Result<Listing> {
        let mut entries = match self {
            Fs::Local => list_local(Path::new(path)).await?,
            Fs::Remote(s) => list_remote(s, path).await?,
        };
        if !show_hidden {
            entries.retain(|e| !e.name.starts_with('.'));
        }
        let (parent, segments) = self.segments(path);
        Ok(Listing { path: path.to_string(), parent, segments, entries })
    }

    pub async fn stat(&self, path: &str) -> Result<FileEntry> {
        let name = self.file_name(path);
        match self {
            Fs::Local => local_entry(Path::new(path), name).await,
            Fs::Remote(s) => {
                let lmeta = s.symlink_metadata(path).await?;
                remote_entry(s, path.to_string(), name, lmeta).await
            }
        }
    }

    pub async fn exists(&self, path: &str) -> Result<bool> {
        match self {
            Fs::Local => Ok(tokio::fs::symlink_metadata(path).await.is_ok()),
            Fs::Remote(s) => match s.symlink_metadata(path).await {
                Ok(_) => Ok(true),
                Err(e) => match Error::from(e) {
                    Error::NotFound(_) => Ok(false),
                    other => Err(other),
                },
            },
        }
    }

    /// Up to `max` bytes from the start of a file, for previews.
    pub async fn read_head(&self, path: &str, max: u64) -> Result<Vec<u8>> {
        let mut buf = Vec::new();
        self.open_read(path).await?.take(max).read_to_end(&mut buf).await?;
        Ok(buf)
    }

    pub async fn mkdir(&self, path: &str) -> Result<()> {
        if self.exists(path).await? {
            return Err(Error::Exists(self.file_name(path)));
        }
        match self {
            Fs::Local => tokio::fs::create_dir(path).await?,
            Fs::Remote(s) => s.create_dir(path).await?,
        }
        Ok(())
    }

    pub async fn rename(&self, from: &str, to: &str) -> Result<()> {
        if from == to {
            return Ok(());
        }
        if self.exists(to).await? {
            return Err(Error::Exists(self.file_name(to)));
        }
        match self {
            Fs::Local => tokio::fs::rename(from, to).await?,
            Fs::Remote(s) => s.rename(from, to).await?,
        }
        Ok(())
    }

    /// Move `paths` into directory `dir` on the same file system.
    pub async fn move_into(&self, paths: &[String], dir: &str) -> Result<()> {
        for p in paths {
            if self.is_within(dir, p) {
                return Err(Error::Invalid(format!(
                    "Cannot move \"{}\" into itself",
                    self.file_name(p)
                )));
            }
        }
        for p in paths {
            let dest = self.join(dir, &self.file_name(p));
            self.rename(p, &dest).await?;
        }
        Ok(())
    }

    pub async fn remove_all(&self, path: &str) -> Result<()> {
        match self {
            Fs::Local => {
                let meta = tokio::fs::symlink_metadata(path).await?;
                if meta.is_dir() {
                    tokio::fs::remove_dir_all(path).await?
                } else {
                    tokio::fs::remove_file(path).await?
                }
            }
            Fs::Remote(s) => remove_remote(s, path.to_string()).await?,
        }
        Ok(())
    }

    async fn open_read(&self, path: &str) -> Result<Reader> {
        Ok(match self {
            Fs::Local => Box::new(tokio::fs::File::open(path).await?),
            Fs::Remote(s) => Box::new(s.open(path).await?),
        })
    }

    async fn open_write(&self, path: &str) -> Result<Writer> {
        Ok(match self {
            Fs::Local => Box::new(tokio::fs::File::create(path).await?),
            Fs::Remote(s) => Box::new(
                s.open_with_flags(path, OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE)
                    .await?,
            ),
        })
    }

    async fn ensure_dir(&self, path: &str) -> Result<()> {
        match self {
            Fs::Local => tokio::fs::create_dir_all(path).await?,
            Fs::Remote(s) => {
                if !self.exists(path).await? {
                    s.create_dir(path).await?;
                }
            }
        }
        Ok(())
    }

    async fn read_dir_names(&self, path: &str) -> Result<Vec<FileEntry>> {
        match self {
            Fs::Local => list_local(Path::new(path)).await,
            Fs::Remote(s) => list_remote(s, path).await,
        }
    }
}

/// One file or directory to create at the destination, relative to the copy root.
struct PlanItem {
    rel: Vec<String>,
    is_dir: bool,
    size: u64,
}

async fn plan(fs: &Fs, path: &str, rel: Vec<String>, out: &mut Vec<PlanItem>) -> Result<()> {
    let entry = fs.stat(path).await?;
    // Symlinked directories are skipped (avoids cycles); symlinked files copy their target.
    if entry.is_dir && entry.is_symlink {
        return Ok(());
    }
    let is_dir = entry.is_dir;
    out.push(PlanItem { rel: rel.clone(), is_dir, size: if is_dir { 0 } else { entry.size } });
    if is_dir {
        for child in fs.read_dir_names(path).await? {
            let mut r = rel.clone();
            r.push(child.name.clone());
            Box::pin(plan(fs, &child.path, r, out)).await?;
        }
    }
    Ok(())
}

/// Copy `sources` (files or directories) from `src` into directory `dst_dir` on `dst`.
///
/// Fails with [`Error::Exists`] before writing anything if a top-level target exists
/// and `overwrite` is false. With `overwrite`, files are replaced and directories merged.
pub async fn copy_into(
    src: &Fs,
    sources: &[String],
    dst: &Fs,
    dst_dir: &str,
    overwrite: bool,
    cancel: Arc<AtomicBool>,
    mut on_progress: impl FnMut(&Progress),
) -> Result<()> {
    let mut roots = Vec::new();
    for s in sources {
        let name = src.file_name(s);
        if !overwrite && dst.exists(&dst.join(dst_dir, &name)).await? {
            return Err(Error::Exists(name));
        }
        roots.push((s.clone(), name));
    }

    let mut items = Vec::new();
    for (path, name) in &roots {
        let mut part = Vec::new();
        plan(src, path, vec![name.clone()], &mut part).await?;
        items.push((path.clone(), part));
    }

    let mut progress = Progress {
        bytes_done: 0,
        bytes_total: items.iter().flat_map(|(_, p)| p).map(|i| i.size).sum(),
        files_done: 0,
        files_total: items.iter().flat_map(|(_, p)| p).filter(|i| !i.is_dir).count() as u64,
        current: String::new(),
    };
    on_progress(&progress);

    let mut last_emit = Instant::now();
    let mut buf = vec![0u8; COPY_BUF];
    for (root_path, part) in items {
        for item in part {
            if cancel.load(Ordering::Relaxed) {
                return Err(Error::Cancelled);
            }
            // rel[0] is the root's own name; the rest maps onto the source subtree.
            let src_path = item.rel[1..].iter().fold(root_path.clone(), |acc, n| src.join(&acc, n));
            let dst_path = item.rel.iter().fold(dst_dir.to_string(), |acc, n| dst.join(&acc, n));
            if item.is_dir {
                dst.ensure_dir(&dst_path).await?;
                continue;
            }
            progress.current = item.rel.join("/");
            let mut r = src.open_read(&src_path).await?;
            let mut w = dst.open_write(&dst_path).await?;
            loop {
                if cancel.load(Ordering::Relaxed) {
                    drop(w);
                    let _ = dst.remove_all(&dst_path).await;
                    return Err(Error::Cancelled);
                }
                let n = r.read(&mut buf).await?;
                if n == 0 {
                    break;
                }
                w.write_all(&buf[..n]).await?;
                progress.bytes_done += n as u64;
                if last_emit.elapsed().as_millis() >= 100 {
                    on_progress(&progress);
                    last_emit = Instant::now();
                }
            }
            w.shutdown().await?;
            progress.files_done += 1;
        }
    }
    on_progress(&progress);
    Ok(())
}

async fn list_local(dir: &Path) -> Result<Vec<FileEntry>> {
    let mut rd = tokio::fs::read_dir(dir).await?;
    let mut out = Vec::new();
    while let Some(ent) = rd.next_entry().await? {
        let name = ent.file_name().to_string_lossy().into_owned();
        match local_entry(&ent.path(), name).await {
            Ok(e) => out.push(e),
            Err(e) => log::debug!("skip {}: {e}", ent.path().display()),
        }
    }
    Ok(out)
}

async fn local_entry(path: &Path, name: String) -> Result<FileEntry> {
    let lmeta = tokio::fs::symlink_metadata(path).await?;
    let is_symlink = lmeta.file_type().is_symlink();
    let target_is_dir = if is_symlink {
        tokio::fs::metadata(path).await.map(|m| m.is_dir()).unwrap_or(false)
    } else {
        lmeta.is_dir()
    };
    Ok(FileEntry {
        name,
        path: path_string(path.to_path_buf()),
        is_dir: target_is_dir,
        is_symlink,
        size: lmeta.len(),
        modified: lmeta.modified().ok().and_then(unix_secs),
        permissions: local_mode(&lmeta),
    })
}

#[cfg(unix)]
fn local_mode(meta: &std::fs::Metadata) -> Option<String> {
    use std::os::unix::fs::PermissionsExt;
    Some(mode_string(meta.permissions().mode()))
}

#[cfg(not(unix))]
fn local_mode(_meta: &std::fs::Metadata) -> Option<String> {
    None
}

async fn list_remote(s: &SftpSession, dir: &str) -> Result<Vec<FileEntry>> {
    let mut out = Vec::new();
    for ent in s.read_dir(dir).await? {
        let name = ent.file_name();
        if name == "." || name == ".." {
            continue;
        }
        let path = if dir.ends_with('/') { format!("{dir}{name}") } else { format!("{dir}/{name}") };
        out.push(remote_entry(s, path, name, ent.metadata()).await?);
    }
    Ok(out)
}

async fn remote_entry(
    s: &SftpSession,
    path: String,
    name: String,
    lmeta: russh_sftp::client::fs::Metadata,
) -> Result<FileEntry> {
    let is_symlink = lmeta.file_type().is_symlink();
    let is_dir = if is_symlink {
        s.metadata(path.as_str()).await.map(|m| m.is_dir()).unwrap_or(false)
    } else {
        lmeta.is_dir()
    };
    Ok(FileEntry {
        name,
        path,
        is_dir,
        is_symlink,
        size: lmeta.size.unwrap_or(0),
        modified: lmeta.mtime.map(i64::from),
        permissions: lmeta.permissions.map(mode_string),
    })
}

async fn remove_remote(s: &SftpSession, path: String) -> Result<()> {
    let meta = s.symlink_metadata(path.as_str()).await?;
    if meta.is_dir() {
        for child in list_remote(s, &path).await? {
            Box::pin(remove_remote(s, child.path)).await?;
        }
        s.remove_dir(path).await?;
    } else {
        s.remove_file(path).await?;
    }
    Ok(())
}

fn remote_segments(path: &str) -> (Option<String>, Vec<Segment>) {
    let mut segs = vec![Segment { name: "/".into(), path: "/".into() }];
    let mut acc = String::new();
    for part in path.split('/').filter(|s| !s.is_empty()) {
        acc.push('/');
        acc.push_str(part);
        segs.push(Segment { name: part.into(), path: acc.clone() });
    }
    let parent = (segs.len() > 1).then(|| segs[segs.len() - 2].path.clone());
    (parent, segs)
}

fn path_string(p: PathBuf) -> String {
    p.to_string_lossy().into_owned()
}

fn unix_secs(t: SystemTime) -> Option<i64> {
    t.duration_since(UNIX_EPOCH).ok().map(|d| d.as_secs() as i64)
}

pub fn mode_string(mode: u32) -> String {
    let kind = match mode & 0o170000 {
        0o040000 => 'd',
        0o120000 => 'l',
        0o020000 => 'c',
        0o060000 => 'b',
        0o010000 => 'p',
        0o140000 => 's',
        _ => '-',
    };
    let mut s = String::with_capacity(10);
    s.push(kind);
    for shift in [6, 3, 0] {
        let bits = (mode >> shift) & 7;
        s.push(if bits & 4 != 0 { 'r' } else { '-' });
        s.push(if bits & 2 != 0 { 'w' } else { '-' });
        s.push(if bits & 1 != 0 { 'x' } else { '-' });
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mode_strings() {
        assert_eq!(mode_string(0o040755), "drwxr-xr-x");
        assert_eq!(mode_string(0o100600), "-rw-------");
        assert_eq!(mode_string(0o120777), "lrwxrwxrwx");
    }

    #[test]
    fn remote_breadcrumbs() {
        let (parent, segs) = remote_segments("/home/u/");
        assert_eq!(parent.as_deref(), Some("/home"));
        let paths: Vec<_> = segs.iter().map(|s| s.path.as_str()).collect();
        assert_eq!(paths, ["/", "/home", "/home/u"]);
        assert_eq!(remote_segments("/").0, None);
    }

    #[tokio::test]
    async fn local_copy_move_delete() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        std::fs::create_dir_all(root.join("a/sub")).unwrap();
        std::fs::write(root.join("a/sub/f.txt"), b"hello").unwrap();
        std::fs::write(root.join("a/g.bin"), vec![7u8; 300_000]).unwrap();
        std::fs::create_dir(root.join("dst")).unwrap();
        let fs = Fs::Local;
        let s = |p: &Path| p.to_string_lossy().into_owned();

        let a = s(&root.join("a"));
        let dst = s(&root.join("dst"));
        let mut last = None;
        copy_into(&fs, &[a.clone()], &fs, &dst, false, Default::default(), |p| last = Some(p.clone()))
            .await
            .unwrap();
        let p = last.unwrap();
        assert_eq!(p.bytes_done, 300_005);
        assert_eq!(p.files_total, 2);
        assert_eq!(std::fs::read(root.join("dst/a/sub/f.txt")).unwrap(), b"hello");

        // Second copy without overwrite is refused up front.
        let err = copy_into(&fs, &[a.clone()], &fs, &dst, false, Default::default(), |_| {})
            .await
            .unwrap_err();
        assert!(matches!(err, Error::Exists(_)));

        // Moving a folder into its own child is rejected.
        let sub = s(&root.join("a/sub"));
        assert!(fs.move_into(&[a.clone()], &sub).await.is_err());

        let listing = fs.list(&a, false).await.unwrap();
        assert_eq!(listing.entries.len(), 2);
        assert_eq!(listing.segments.last().unwrap().name, "a");

        fs.move_into(&[s(&root.join("a/g.bin"))], &sub).await.unwrap();
        assert!(root.join("a/sub/g.bin").exists());

        fs.remove_all(&a).await.unwrap();
        assert!(!root.join("a").exists());
    }
}
