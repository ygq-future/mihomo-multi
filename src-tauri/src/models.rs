use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProfileType {
    Remote,
    Local,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileItem {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub profile_type: ProfileType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    pub file_path: String,
    pub auto_update_interval_mins: u32,
    pub last_updated_at: u64,
    pub node_count: usize,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum InboundProtocol {
    #[default]
    Mixed,
    Http,
    Socks5,
}

impl std::fmt::Display for InboundProtocol {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Mixed => write!(f, "mixed"),
            Self::Http => write!(f, "http"),
            Self::Socks5 => write!(f, "socks5"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortMapping {
    pub id: String,
    pub port: u16,
    pub protocol: InboundProtocol,
    pub profile_id: String,
    pub node_name: String,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyNode {
    pub name: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub server: String,
    pub port: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoreStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub controller_port: u16,
    pub secret: String,
    pub version: Option<String>,
    pub uptime_seconds: u64,
    pub sidecar_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub controller_port: u16,
    pub controller_secret: String,
    pub auto_start_core: bool,
    pub theme: String,
    pub log_level: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            controller_port: 9999,
            controller_secret: uuid::Uuid::new_v4().to_string(),
            auto_start_core: true,
            theme: "system".to_string(),
            log_level: "info".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppStatus {
    pub core: CoreStatus,
    pub total_ports: usize,
    pub active_ports: usize,
    pub total_profiles: usize,
    pub total_nodes: usize,
    pub version: String,
}
