use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("SSH: {0}")]
    Ssh(String),
    #[error("SFTP: {0}")]
    Sftp(String),
    #[error("Authentication failed")]
    AuthFailed,
    #[error("Host key for {host} was not trusted")]
    HostKeyRejected { host: String },
    #[error(
        "The host key for {host} has changed (known_hosts line {line}). \
         Someone could be eavesdropping on you, or the server was reinstalled."
    )]
    HostKeyChanged { host: String, line: usize },
    #[error("\"{0}\" already exists")]
    Exists(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Key: {0}")]
    Key(String),
    #[error("Keychain: {0}")]
    Keyring(String),
    #[error("Cancelled")]
    Cancelled,
    #[error("{0}")]
    Invalid(String),
}

impl Error {
    /// Stable identifier the UI can branch on.
    pub fn code(&self) -> &'static str {
        match self {
            Error::Io(_) => "io",
            Error::Ssh(_) => "ssh",
            Error::Sftp(_) => "sftp",
            Error::AuthFailed => "auth_failed",
            Error::HostKeyRejected { .. } => "host_key_rejected",
            Error::HostKeyChanged { .. } => "host_key_changed",
            Error::Exists(_) => "exists",
            Error::NotFound(_) => "not_found",
            Error::Key(_) => "key",
            Error::Keyring(_) => "keyring",
            Error::Cancelled => "cancelled",
            Error::Invalid(_) => "invalid",
        }
    }
}

impl Serialize for Error {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        let mut st = s.serialize_struct("Error", 2)?;
        st.serialize_field("code", self.code())?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

impl From<russh::Error> for Error {
    fn from(e: russh::Error) -> Self {
        Error::Ssh(e.to_string())
    }
}

impl From<russh::keys::Error> for Error {
    fn from(e: russh::keys::Error) -> Self {
        Error::Key(e.to_string())
    }
}

impl From<ssh_key::Error> for Error {
    fn from(e: ssh_key::Error) -> Self {
        Error::Key(e.to_string())
    }
}

impl From<russh_sftp::client::error::Error> for Error {
    fn from(e: russh_sftp::client::error::Error) -> Self {
        use russh_sftp::client::error::Error as E;
        use russh_sftp::protocol::StatusCode;
        match &e {
            E::Status(st) if st.status_code == StatusCode::NoSuchFile => {
                Error::NotFound(st.error_message.clone())
            }
            _ => Error::Sftp(e.to_string()),
        }
    }
}

impl From<keyring::Error> for Error {
    fn from(e: keyring::Error) -> Self {
        Error::Keyring(e.to_string())
    }
}

impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Error::Invalid(e.to_string())
    }
}
