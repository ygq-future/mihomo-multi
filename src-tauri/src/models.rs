use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const FIXED_DIRECT_PORT_ID: &str = "fixed-direct";
pub const DEFAULT_DIRECT_PORT: u16 = 7878;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProfileType {
    Remote,
    Local,
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionInfo {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upload: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub download: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remaining_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expire_at: Option<u64>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub never_expires: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reset_days: Option<u32>,
}

impl SubscriptionInfo {
    pub fn is_empty(&self) -> bool {
        self.upload.is_none()
            && self.download.is_none()
            && self.total.is_none()
            && self.remaining_bytes.is_none()
            && self.expire_at.is_none()
            && !self.never_expires
            && self.reset_days.is_none()
    }

    /// Merges HTTP header metadata (higher precision) with YAML pseudo-node metadata.
    pub fn merge(header: Option<Self>, yaml: Option<Self>) -> Option<Self> {
        match (header, yaml) {
            (None, None) => None,
            (Some(h), None) => (!h.is_empty()).then_some(h),
            (None, Some(y)) => (!y.is_empty()).then_some(y),
            (Some(h), Some(y)) => {
                let expire_at = h.expire_at.or(y.expire_at);
                let merged = Self {
                    upload: h.upload.or(y.upload),
                    download: h.download.or(y.download),
                    total: h.total.or(y.total),
                    remaining_bytes: h.remaining_bytes.or(y.remaining_bytes),
                    expire_at,
                    never_expires: if expire_at.is_some() {
                        false
                    } else {
                        h.never_expires || y.never_expires
                    },
                    reset_days: h.reset_days.or(y.reset_days),
                };
                (!merged.is_empty()).then_some(merged)
            }
        }
    }
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subscription_info: Option<SubscriptionInfo>,
    #[serde(default = "default_profile_enabled")]
    pub enabled: bool,
}

fn default_profile_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum InboundProtocol {
    #[default]
    Mixed,
    Http,
    Socks5,
}

impl InboundProtocol {
    /// Returns the Mihomo listener `type` string (`"mixed"`, `"http"`, or `"socks"`).
    pub fn as_listener_type(self) -> &'static str {
        match self {
            Self::Mixed => "mixed",
            Self::Http => "http",
            Self::Socks5 => "socks",
        }
    }
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum PortRuleMatchType {
    #[default]
    DomainSuffix,
    Domain,
    DomainRegex,
    DomainKeyword,
    IpCidr,
}

impl std::fmt::Display for PortRuleMatchType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DomainSuffix => write!(f, "DOMAIN-SUFFIX"),
            Self::Domain => write!(f, "DOMAIN"),
            Self::DomainRegex => write!(f, "DOMAIN-REGEX"),
            Self::DomainKeyword => write!(f, "DOMAIN-KEYWORD"),
            Self::IpCidr => write!(f, "IP-CIDR"),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum PortRuleTargetType {
    #[default]
    Node,
    Port,
    Direct,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PortRule {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default)]
    pub match_type: PortRuleMatchType,
    pub payloads: Vec<String>,
    pub target_type: PortRuleTargetType,
    pub target_value: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_profile_id: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

/// A managed residential proxy used as the final hop of a per-port proxy chain.
///
/// Credentials are intentionally serialized with the rest of the config, but they must never
/// appear in logs or validation error messages.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResidentialProxy {
    pub id: String,
    pub name: String,
    /// `http` or `socks5` (case-insensitive on input, normalized on save).
    pub protocol: String,
    pub server: String,
    pub port: u16,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
}

impl ResidentialProxy {
    /// Returns the Mihomo proxy `type` for the configured protocol.
    pub fn proxy_type(&self) -> Option<&'static str> {
        let protocol = self.protocol.trim();
        if protocol.eq_ignore_ascii_case("http") {
            Some("http")
        } else if protocol.eq_ignore_ascii_case("socks5") {
            Some("socks5")
        } else {
            None
        }
    }

    /// Validates identity, protocol, address and credential pairing without exposing secrets.
    pub fn validate(&self) -> Result<(), String> {
        let id = self.id.trim();
        if id.is_empty() {
            return Err(crate::tr!(
                "住宅代理出口 ID 不能为空",
                "Residential proxy exit ID cannot be empty"
            )
            .to_string());
        }
        let name = self.name.trim();
        if name.is_empty() {
            return Err(crate::tr!(
                "住宅代理出口名称不能为空",
                "Residential proxy exit name cannot be empty"
            )
            .to_string());
        }
        if self.proxy_type().is_none() {
            return Err(crate::tr!(
                format!("住宅代理出口「{name}」协议无效，仅支持 http 或 socks5"),
                format!(
                    "Residential proxy exit \"{name}\" has an invalid protocol; only http or socks5 are supported"
                ),
            ));
        }
        let server = self.server.trim();
        if server.is_empty() {
            return Err(crate::tr!(
                format!("住宅代理出口「{name}」服务器地址不能为空"),
                format!("Residential proxy exit \"{name}\" server address cannot be empty"),
            ));
        }
        if server.chars().any(char::is_whitespace) || server.contains("://") || server.contains('/') {
            return Err(crate::tr!(
                format!("住宅代理出口「{name}」服务器地址格式无效，请仅填写主机名或 IP"),
                format!(
                    "Residential proxy exit \"{name}\" server address is invalid; enter only a hostname or IP address"
                ),
            ));
        }
        let host = server.trim_start_matches('[').trim_end_matches(']');
        if host.contains(':') && host.parse::<std::net::Ipv6Addr>().is_err() {
            return Err(crate::tr!(
                format!("住宅代理出口「{name}」服务器地址不应包含端口，请将端口填写在端口字段"),
                format!(
                    "Residential proxy exit \"{name}\" server address must not include a port; use the port field instead"
                ),
            ));
        }
        if self.port == 0 {
            return Err(crate::tr!(
                format!("住宅代理出口「{name}」端口必须在 1-65535 之间"),
                format!("Residential proxy exit \"{name}\" port must be between 1 and 65535"),
            ));
        }
        let has_username = !self.username.trim().is_empty();
        let has_password = !self.password.is_empty();
        if has_username != has_password {
            return Err(crate::tr!(
                format!("住宅代理出口「{name}」用户名与密码必须同时填写或同时留空"),
                format!(
                    "Residential proxy exit \"{name}\" username and password must both be set or both be empty"
                ),
            ));
        }
        Ok(())
    }

    /// Returns a copy with user-editable string fields trimmed/normalized.
    pub fn normalized(mut self) -> Self {
        self.id = self.id.trim().to_string();
        self.name = self.name.trim().to_string();
        self.protocol = self.protocol.trim().to_ascii_lowercase();
        self.server = self.server.trim().to_string();
        self
    }
}

/// Validates a full managed residential proxy list (field validity plus unique IDs).
pub fn validate_residential_proxies(proxies: &[ResidentialProxy]) -> Result<(), String> {
    let mut ids = HashSet::new();
    for proxy in proxies {
        proxy.validate()?;
        if !ids.insert(proxy.id.trim().to_string()) {
            return Err(crate::tr!(
                format!("住宅代理出口 ID「{}」重复", proxy.id.trim()),
                format!("Residential proxy exit ID \"{}\" is duplicated", proxy.id.trim()),
            ));
        }
    }
    Ok(())
}

/// Rejects removal of a residential exit that is still referenced by any port mapping,
/// including disabled mappings.
pub fn validate_residential_proxy_removal(
    old_proxies: &[ResidentialProxy],
    new_proxies: &[ResidentialProxy],
    mappings: &[PortMapping],
) -> Result<(), String> {
    let retained: HashSet<&str> = new_proxies.iter().map(|proxy| proxy.id.trim()).collect();
    for proxy in old_proxies {
        if retained.contains(proxy.id.trim()) {
            continue;
        }
        if let Some(mapping) = mappings
            .iter()
            .find(|mapping| mapping.residential_proxy_id.as_deref().map(str::trim) == Some(proxy.id.trim()))
        {
            return Err(crate::tr!(
                format!(
                    "住宅代理出口「{}」仍被端口 {} 使用（包括已停用的端口），请先解除引用再删除",
                    proxy.name, mapping.port
                ),
                format!(
                    "Residential proxy exit \"{}\" is still used by port {} (including disabled ports); remove the reference before deleting it",
                    proxy.name, mapping.port
                ),
            ));
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PortMapping {
    pub id: String,
    pub port: u16,
    pub protocol: InboundProtocol,
    pub profile_id: String,
    pub node_name: String,
    /// When set, this port's traffic is chained through the subscription node and then this
    /// managed residential exit instead of dialing the node directly.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub residential_proxy_id: Option<String>,
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rules: Vec<PortRule>,
}
impl Default for PortMapping {
    fn default() -> Self {
        Self {
            id: String::new(),
            port: 0,
            protocol: InboundProtocol::Mixed,
            profile_id: String::new(),
            node_name: String::new(),
            residential_proxy_id: None,
            enabled: false,
            latency: None,
            description: None,
            fallback_profile_id: None,
            fallback_node_name: None,
            bypass_cn: true,
            manual_fallback: false,
            rules: Vec::new(),
        }
    }
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
pub struct DirectEgressInfo {
    pub ip: String,
    pub region: String,
    pub country_code: Option<String>,
    pub isp: Option<String>,
    pub latency_ms: Option<u32>,
    pub source: String,
}

/// Outcome of an isolated residential-chain connectivity test.
///
/// The probe runs a disposable Mihomo instance whose only listener routes every
/// connection through the selected upstream node and then the saved residential
/// exit, so a successful result proves the authenticated egress actually works.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResidentialProxyTestResult {
    pub latency_ms: u64,
    pub egress: DirectEgressInfo,
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
    #[serde(default)]
    pub cleaned_count: usize,
    #[serde(default)]
    pub newly_exempted_count: usize,
    #[serde(default)]
    pub auto_exempt: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UwpAppInfo {
    pub name: String,
    pub moniker: String,
    pub sid: String,
    pub exempted: bool,
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
    #[serde(default = "default_controller_port")]
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
    pub lightweight_mode: bool,
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
    #[serde(default = "default_true")]
    pub fallback_lazy: bool,
    #[serde(default)]
    pub system_proxy_enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_proxy_port: Option<u16>,
    #[serde(default)]
    pub system_proxy_bypass_user: Vec<String>,
    #[serde(default = "default_true")]
    pub system_proxy_sync_env: bool,
    #[serde(default)]
    pub env_proxy_enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env_proxy_port: Option<u16>,
    #[serde(default)]
    pub tun_enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tun_port: Option<u16>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub global_rules: Vec<PortRule>,
    /// Managed authenticated HTTP/SOCKS5 residential exits available for per-port chaining.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub residential_proxies: Vec<ResidentialProxy>,
    #[serde(default = "default_true")]
    pub check_update_on_start: bool,
    /// Persisted intent of the UWP "exempt all" action: newly installed AppContainers
    /// are exempted automatically while this is true. Owned by the UWP commands.
    #[serde(default)]
    pub uwp_auto_exempt: bool,
    /// Interval in seconds for background host-level internet connectivity checks.
    #[serde(default = "default_network_check_interval_secs")]
    pub network_check_interval_secs: u32,
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
    60
}

fn default_network_check_interval_secs() -> u32 {
    5
}

fn default_controller_port() -> u16 {
    if cfg!(debug_assertions) { 9998 } else { 9999 }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            controller_port: default_controller_port(),
            controller_secret: uuid::Uuid::new_v4().to_string(),
            theme: "system".to_string(),
            log_level: "info".to_string(),
            allow_lan: false,
            selected_lan_ip: None,
            close_to_tray: true,
            auto_launch: false,
            silent_start: false,
            lightweight_mode: false,
            acrylic_effect: false,
            acrylic_blur: 12,
            acrylic_opacity: 65,
            background_image: String::new(),
            background_opacity: 80,
            test_url: default_test_url(),
            timeout_ms: 3000,
            fallback_interval: default_fallback_interval(),
            fallback_lazy: true,
            system_proxy_enabled: false,
            system_proxy_port: None,
            system_proxy_bypass_user: Vec::new(),
            system_proxy_sync_env: true,
            env_proxy_enabled: false,
            env_proxy_port: None,
            tun_enabled: false,
            tun_port: None,
            global_rules: Vec::new(),
            residential_proxies: Vec::new(),
            check_update_on_start: true,
            uwp_auto_exempt: false,
            network_check_interval_secs: default_network_check_interval_secs(),
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
pub struct EnvProxyStatus {
    pub enabled: bool,
    pub port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TunStatus {
    pub enabled: bool,
    pub active: bool,
    pub port: Option<u16>,
    pub elevated: bool,
    pub pending_elevation: bool,
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
    pub is_installed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionMetadata {
    pub network: String,
    #[serde(rename = "type")]
    pub connection_type: String,
    #[serde(rename = "sourceIP")]
    pub source_ip: String,
    #[serde(rename = "destinationIP")]
    pub destination_ip: String,
    #[serde(rename = "sourcePort")]
    pub source_port: String,
    #[serde(rename = "destinationPort")]
    pub destination_port: String,
    #[serde(rename = "inboundIP", default)]
    pub inbound_ip: Option<String>,
    #[serde(rename = "inboundPort", default)]
    pub inbound_port: Option<String>,
    #[serde(rename = "inboundName", default)]
    pub inbound_name: Option<String>,
    #[serde(rename = "inboundUser", default)]
    pub inbound_user: Option<String>,
    pub host: String,
    #[serde(rename = "dnsMode", default)]
    pub dns_mode: Option<String>,
    #[serde(default)]
    pub process: Option<String>,
    #[serde(rename = "processPath", default)]
    pub process_path: Option<String>,
    #[serde(rename = "specialProxy", default)]
    pub special_proxy: Option<String>,
    #[serde(rename = "specialRules", default)]
    pub special_rules: Option<String>,
    #[serde(rename = "remoteDestination", default)]
    pub remote_destination: Option<String>,
    #[serde(rename = "sniffHost", default)]
    pub sniff_host: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionItem {
    pub id: String,
    pub metadata: ConnectionMetadata,
    pub upload: u64,
    pub download: u64,
    pub start: String,
    #[serde(default)]
    pub chains: Vec<String>,
    #[serde(default)]
    pub rule: String,
    #[serde(rename = "rulePayload", default)]
    pub rule_payload: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSnapshot {
    #[serde(rename = "downloadTotal", default)]
    pub download_total: u64,
    #[serde(rename = "uploadTotal", default)]
    pub upload_total: u64,
    #[serde(default)]
    pub memory: Option<u64>,
    #[serde(default)]
    pub connections: Vec<ConnectionItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SniffedAccessLogEntry {
    pub host: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub inbound_port: Option<String>,
    pub chain: String,
    pub rule: String,
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PortProcessRecord {
    pub process_name: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub process_path: Option<String>,
    pub first_seen_at: u64,
    pub last_seen_at: u64,
    pub hit_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PortProcessUsageItem {
    pub process_name: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub process_path: Option<String>,
    pub first_seen_at: u64,
    pub last_seen_at: u64,
    pub hit_count: u64,
    pub is_active: bool,
    pub active_connection_count: u32,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub icon_data_url: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_config_check_update_on_start_default() {
        let cfg = AppConfig::default();
        assert!(cfg.check_update_on_start);
        assert!(!cfg.uwp_auto_exempt);
        // Verify deserialization when checkUpdateOnStart is omitted uses default_true
        let json = r#"{"controllerSecret":"sec","theme":"system","logLevel":"info"}"#;
        let deserialized: AppConfig = serde_json::from_str(json).expect("should deserialize config");
        assert!(deserialized.check_update_on_start);
        assert!(!deserialized.uwp_auto_exempt);

        // Verify explicitly disabled
        let json_disabled =
            r#"{"controllerSecret":"sec","theme":"system","logLevel":"info","checkUpdateOnStart":false}"#;
        let deserialized_disabled: AppConfig = serde_json::from_str(json_disabled).expect("should deserialize");
        assert!(!deserialized_disabled.check_update_on_start);
    }

    #[test]
    fn test_app_config_uwp_auto_exempt_round_trip() {
        let cfg = AppConfig {
            uwp_auto_exempt: true,
            ..AppConfig::default()
        };
        let json = serde_json::to_string(&cfg).expect("should serialize config");
        assert!(json.contains("\"uwpAutoExempt\":true"));

        let deserialized: AppConfig = serde_json::from_str(&json).expect("should deserialize config");
        assert!(deserialized.uwp_auto_exempt);
    }

    fn sample_residential(id: &str) -> ResidentialProxy {
        ResidentialProxy {
            id: id.to_string(),
            name: format!("Exit {id}"),
            protocol: "HTTP".to_string(),
            server: "exit.example.com".to_string(),
            port: 8080,
            username: "user".to_string(),
            password: "secret-pass".to_string(),
        }
    }

    #[test]
    fn test_residential_config_serde_compatibility() {
        // Legacy config.json and ports.json without the new fields must keep loading with safe defaults.
        let legacy_config = r#"{"controllerSecret":"sec","theme":"system","logLevel":"info"}"#;
        let cfg: AppConfig = serde_json::from_str(legacy_config).expect("legacy config should deserialize");
        assert!(cfg.residential_proxies.is_empty());

        let legacy_mapping = r#"{"id":"m1","port":7891,"protocol":"mixed","profileId":"p1","nodeName":"n1","enabled":true,"latency":null,"bypassCn":true,"manualFallback":false}"#;
        let mapping: PortMapping = serde_json::from_str(legacy_mapping).expect("legacy mapping should deserialize");
        assert!(mapping.residential_proxy_id.is_none());

        let cfg = AppConfig {
            residential_proxies: vec![sample_residential("exit-1")],
            ..AppConfig::default()
        };
        let json = serde_json::to_string(&cfg).expect("serialize config");
        assert!(json.contains("\"residentialProxies\":["));
        assert!(json.contains("\"protocol\":\"HTTP\""));
        let round_trip: AppConfig = serde_json::from_str(&json).expect("deserialize config");
        assert_eq!(round_trip.residential_proxies.len(), 1);
        assert_eq!(round_trip.residential_proxies[0].id, "exit-1");

        let mapping = PortMapping {
            residential_proxy_id: Some("exit-1".to_string()),
            ..PortMapping::default()
        };
        let json = serde_json::to_string(&mapping).expect("serialize mapping");
        assert!(json.contains("\"residentialProxyId\":\"exit-1\""));

        let no_chain = serde_json::to_string(&PortMapping::default()).expect("serialize mapping");
        assert!(!no_chain.contains("residentialProxyId"));
    }

    #[test]
    fn test_residential_validation_rejects_bad_fields_without_echoing_credentials() {
        assert!(sample_residential("ok").validate().is_ok());
        let secret = sample_residential("p").password;

        let mut bad_protocol = sample_residential("p");
        bad_protocol.protocol = "socks4".to_string();
        let err = bad_protocol.validate().expect_err("unsupported protocol");
        assert!(err.contains("协议无效"));
        assert!(!err.contains(&secret));

        let mut missing_server = sample_residential("p");
        missing_server.server = "  ".to_string();
        assert!(
            missing_server
                .validate()
                .expect_err("empty server")
                .contains("服务器地址不能为空")
        );

        let mut zero_port = sample_residential("p");
        zero_port.port = 0;
        assert!(zero_port.validate().expect_err("zero port").contains("端口"));

        let mut half_auth = sample_residential("p");
        half_auth.username = "".to_string();
        let err = half_auth.validate().expect_err("half auth");
        assert!(err.contains("用户名与密码必须同时填写"));
        assert!(!err.contains(&secret));

        let mut bad_address = sample_residential("p");
        bad_address.server = "http://exit.example.com".to_string();
        assert!(
            bad_address
                .validate()
                .expect_err("scheme in server")
                .contains("格式无效")
        );

        let mut duplicate = sample_residential("dup");
        let other = sample_residential("dup");
        assert!(
            validate_residential_proxies(&[duplicate.clone(), other])
                .expect_err("duplicate ids")
                .contains("重复")
        );
        duplicate.id = "unique".to_string();
        assert!(validate_residential_proxies(&[duplicate]).is_ok());
    }

    #[test]
    fn test_residential_removal_respects_disabled_port_references() {
        let exit = sample_residential("exit-1");
        let mapping = PortMapping {
            id: "m1".to_string(),
            port: 7891,
            residential_proxy_id: Some("exit-1".to_string()),
            enabled: false,
            ..PortMapping::default()
        };

        let err = validate_residential_proxy_removal(std::slice::from_ref(&exit), &[], std::slice::from_ref(&mapping))
            .expect_err("referenced exit must not be deleted");
        assert!(err.contains("端口 7891"));
        assert!(!err.contains(&exit.password));

        assert!(
            validate_residential_proxy_removal(
                std::slice::from_ref(&exit),
                std::slice::from_ref(&exit),
                std::slice::from_ref(&mapping)
            )
            .is_ok()
        );
        assert!(validate_residential_proxy_removal(&[exit], &[], &[]).is_ok());
    }
}
