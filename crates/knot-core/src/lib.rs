//! Knot core: SSH sessions, SFTP / local file systems, and the host & key vault.
//! Has no UI dependencies so it can be unit-tested and reused (e.g. by a CLI).

pub mod error;
pub mod fs;
pub mod keys;
pub mod pty;
pub mod secrets;
pub mod ssh;
pub mod sshconfig;
pub mod vault;

pub use error::{Error, Result};
pub use russh_sftp::client::SftpSession;
