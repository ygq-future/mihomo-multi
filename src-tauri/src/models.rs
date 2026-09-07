use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProfileType {
    Remote,
    Local,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PortMapping {
    pub id: String,
    pub port: u16,
    pub protocol: InboundProtocol,
    pub profile_id: String,
    pub node_name: String,
    pub enabled: bool,
    pub latency: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback_profile_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback_node_name: Option<String>,
    #[serde(default = "default_true")]
    pub bypass_cn: bool,
    #[serde(default)]
    pub manual_fallback: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PortFallbackStatus {
    pub mapping_id: String,
    pub port: u16,
    pub primary_node: String,
    pub fallback_node: String,
    pub active_node: String,
    pub is_fallback_active: bool,
    #[serde(default)]
    pub manual_fallback: bool,
    pub primary_latency: Option<u32>,
    pub fallback_latency: Option<u32>,
    pub last_updated: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProxyNode {
    pub name: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub server: String,
    pub port: u16,
    pub latency: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NodeLatencyResult {
    pub name: String,
    pub latency: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LatencyUpdatePayload {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_name: Option<String>,
    pub latency: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mapping_id: Option<String>,
    pub completed: usize,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LatencyProgressPayload {
    pub is_testing: bool,
    pub total: usize,
    pub completed: usize,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DriftStatus {
    Healthy,
    NodeMissing,
    ProfileMissing,
    EmptyProfile,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PortDriftReport {
    pub mapping_id: String,
    pub port: u16,
    pub profile_id: String,
    pub profile_name: String,
    pub node_name: String,
    pub enabled: bool,
    pub status: DriftStatus,
    pub message: String,
    pub fallback_action: String,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub suggestions: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UwpLoopbackStats {
    pub supported: bool,
    pub exempted_count: usize,
    pub total_count: usize,
}


#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AutoUpdateEventPayload {
    pub profile_id: String,
    pub profile_name: String,
    pub success: bool,
    pub previous_node_count: usize,
    pub new_node_count: usize,
    pub drifted_ports_count: usize,
    pub timestamp: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AutoUpdaterStatus {
    pub running: bool,
    pub auto_update_enabled: bool,
    pub check_interval_secs: u64,
    pub last_check_timestamp: u64,
    pub total_managed_profiles: usize,
    pub eligible_profiles_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CoreStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub controller_port: u16,
    pub secret: String,
    pub version: Option<String>,
    pub uptime_seconds: u64,
    pub sidecar_path: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LanIpInfo {
    pub ip: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub controller_port: u16,
    pub controller_secret: String,
    pub theme: String,
    pub log_level: String,
    #[serde(default)]
    pub allow_lan: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_lan_ip: Option<String>,
    #[serde(default = "default_true")]
    pub close_to_tray: bool,
    #[serde(default)]
    pub auto_launch: bool,
    #[serde(default)]
    pub silent_start: bool,
    #[serde(default)]
    pub acrylic_effect: bool,
    #[serde(default = "default_acrylic_blur")]
    pub acrylic_blur: u8,
    #[serde(default = "default_acrylic_opacity")]
    pub acrylic_opacity: u8,
    #[serde(default)]
    pub background_image: String,
    #[serde(default = "default_opacity")]
    pub background_opacity: u8,
    #[serde(default = "default_test_url")]
    pub test_url: String,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u32,
    #[serde(default = "default_fallback_interval")]
    pub fallback_interval: u32,
    #[serde(default)]
    pub fallback_lazy: bool,
    #[serde(default)]
    pub system_proxy_enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_proxy_port: Option<u16>,
    #[serde(default)]
    pub system_proxy_bypass_user: Vec<String>,
}

fn default_true() -> bool {
    true
}

fn default_acrylic_blur() -> u8 {
    12
}

fn default_acrylic_opacity() -> u8 {
    65
}

fn default_opacity() -> u8 {
    80
}

fn default_test_url() -> String {
    "http://cp.cloudflare.com/generate_204".to_string()
}

fn default_timeout_ms() -> u32 {
    3000
}

fn default_fallback_interval() -> u32 {
    5
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            controller_port: 9999,
            controller_secret: uuid::Uuid::new_v4().to_string(),
            theme: "system".to_string(),
            log_level: "info".to_string(),
            allow_lan: false,
            selected_lan_ip: None,
            close_to_tray: true,
            auto_launch: false,
            silent_start: false,
            acrylic_effect: false,
            acrylic_blur: 12,
            acrylic_opacity: 65,
            background_image: String::new(),
            background_opacity: 80,
            test_url: default_test_url(),
            timeout_ms: 3000,
            fallback_interval: 5,
            fallback_lazy: false,
            system_proxy_enabled: false,
            system_proxy_port: None,
            system_proxy_bypass_user: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SystemProxyStatus {
    pub enabled: bool,
    pub port: Option<u16>,
    pub bypass_domains: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub core: CoreStatus,
    pub total_ports: usize,
    pub active_ports: usize,
    pub total_profiles: usize,
    pub total_nodes: usize,
    pub version: String,
}
