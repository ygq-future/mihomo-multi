use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("YAML error: {0}")]
    Yaml(#[from] serde_yaml_ng::Error),

    #[error("Network request error: {0}")]
    Network(#[from] reqwest::Error),

    #[error("Sidecar binary not found: {0}")]
    SidecarNotFound(String),

    #[error("Sidecar execution failed: {0}")]
    SidecarExecution(String),

    #[error("External controller error: {0}")]
    ExternalController(String),

    #[error("Port {0} is already occupied")]
    PortOccupied(u16),

    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),

    #[error("Profile not found: {0}")]
    ProfileNotFound(String),

    #[error("Port mapping not found: {0}")]
    PortMappingNotFound(String),

    #[error("Process supervisor error: {0}")]
    Supervisor(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
