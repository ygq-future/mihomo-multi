use crate::error::{AppError, AppResult};
use crate::models::PortMapping;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::net::IpAddr;
use std::path::Path;
use tracing::warn;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RuntimeListener {
    pub name: String,
    #[serde(rename = "type")]
    pub listener_type: String,
    pub port: u16,
    pub listen: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RuntimeProxyGroup {
    pub name: String,
    #[serde(rename = "type")]
    pub group_type: String,
    pub proxies: Vec<String>,
    pub url: String,
    pub interval: u32,
    pub timeout: u32,
    pub lazy: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RuntimeRuleProvider {
    #[serde(rename = "type")]
    pub provider_type: String,
    pub behavior: String,
    pub format: String,
    pub path: String,
}

pub fn default_rule_providers() -> BTreeMap<String, RuntimeRuleProvider> {
    let mut providers = BTreeMap::new();
    providers.insert(
        "private_domain".to_string(),
        RuntimeRuleProvider {
            provider_type: "file".to_string(),
            behavior: "domain".to_string(),
            format: "mrs".to_string(),
            path: "./rules/geosite-private.mrs".to_string(),
        },
    );
    providers.insert(
        "cn_domain".to_string(),
        RuntimeRuleProvider {
            provider_type: "file".to_string(),
            behavior: "domain".to_string(),
            format: "mrs".to_string(),
            path: "./rules/geosite-cn.mrs".to_string(),
        },
    );
    providers.insert(
        "private_ip".to_string(),
        RuntimeRuleProvider {
            provider_type: "file".to_string(),
            behavior: "ipcidr".to_string(),
            format: "mrs".to_string(),
            path: "./rules/geoip-private.mrs".to_string(),
        },
    );
    providers.insert(
        "cn_ip".to_string(),
        RuntimeRuleProvider {
            provider_type: "file".to_string(),
            behavior: "ipcidr".to_string(),
            format: "mrs".to_string(),
            path: "./rules/geoip-cn.mrs".to_string(),
        },
    );
    providers
}

/// Parses user-defined system proxy bypass items into Mihomo DIRECT routing rules.
/// Enforces exact-matching semantics without implicit wildcard expansion:
/// - IPv4: `IP-CIDR,<ip>/32,DIRECT,no-resolve`
/// - IPv6: `IP-CIDR6,<ip>/128,DIRECT,no-resolve`
/// - CIDR: `IP-CIDR,<net>,DIRECT,no-resolve` or `IP-CIDR6,...`
/// - Wildcard domain (`*.example.com`): `DOMAIN-WILDCARD,*.example.com,DIRECT`
/// - Exact domain (`example.com` or `localhost`): `DOMAIN,example.com,DIRECT`
/// - Disallows bare `*`, `<local>`, or single words without dots (e.g. `com`)
pub fn parse_user_bypass_to_rules(user_bypass: &[String]) -> Vec<String> {
    let mut rules = Vec::new();
    let mut seen = HashSet::new();

    for raw in user_bypass {
        let item = raw.trim();
        if item.is_empty() || item.eq_ignore_ascii_case("<local>") {
            continue;
        }

        // 1. IP check
        if let Ok(ip) = item.parse::<IpAddr>() {
            let rule = match ip {
                IpAddr::V4(v4) => format!("IP-CIDR,{}/32,DIRECT,no-resolve", v4),
                IpAddr::V6(v6) => format!("IP-CIDR6,{}/128,DIRECT,no-resolve", v6),
            };
            if seen.insert(rule.clone()) {
                rules.push(rule);
            }
            continue;
        }

        // 2. CIDR check
        if let Some((ip_str, prefix_str)) = item.split_once('/')
            && let (Ok(ip), Ok(prefix)) = (ip_str.parse::<IpAddr>(), prefix_str.parse::<u8>())
        {
            let rule = match ip {
                IpAddr::V4(v4) if prefix <= 32 => Some(format!("IP-CIDR,{}/{},DIRECT,no-resolve", v4, prefix)),
                IpAddr::V6(v6) if prefix <= 128 => Some(format!("IP-CIDR6,{}/{},DIRECT,no-resolve", v6, prefix)),
                _ => None,
            };
            if let Some(r) = rule {
                if seen.insert(r.clone()) {
                    rules.push(r);
                }
                continue;
            }
        }

        // 3. Wildcard domain (*.example.com or *example.com)
        if let Some(rest) = item.strip_prefix("*.")
            && rest.contains('.')
            && !rest.starts_with('.')
            && !rest.ends_with('.')
            && !rest.contains(' ')
        {
            let rule = format!("DOMAIN-WILDCARD,{},DIRECT", item);
            if seen.insert(rule.clone()) {
                rules.push(rule);
            }
            continue;
        } else if let Some(rest) = item.strip_prefix('*')
            && !rest.is_empty()
            && rest.contains('.')
            && !rest.starts_with('.')
            && !rest.ends_with('.')
            && !rest.contains(' ')
        {
            let rule = format!("DOMAIN-WILDCARD,{},DIRECT", item);
            if seen.insert(rule.clone()) {
                rules.push(rule);
            }
            continue;
        }

        // 4. Exact domain (localhost or standard domain with dot)
        if item.eq_ignore_ascii_case("localhost") {
            let rule = "DOMAIN,localhost,DIRECT".to_string();
            if seen.insert(rule.clone()) {
                rules.push(rule);
            }
            continue;
        }

        if item.contains('.')
            && !item.starts_with('.')
            && !item.ends_with('.')
            && !item.contains(' ')
            && !item.contains('*')
        {
            let rule = format!("DOMAIN,{},DIRECT", item);
            if seen.insert(rule.clone()) {
                rules.push(rule);
            }
        }
    }

    rules
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RuntimeDnsConfig {
    pub enable: bool,
    pub ipv6: bool,
    #[serde(rename = "enhanced-mode")]
    pub enhanced_mode: String,
    #[serde(rename = "fake-ip-range", skip_serializing_if = "Option::is_none")]
    pub fake_ip_range: Option<String>,
    #[serde(rename = "fake-ip-filter", skip_serializing_if = "Vec::is_empty", default)]
    pub fake_ip_filter: Vec<String>,
    #[serde(rename = "default-nameserver")]
    pub default_nameserver: Vec<String>,
    pub nameserver: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub fallback: Vec<String>,
    #[serde(rename = "proxy-server-nameserver", skip_serializing_if = "Vec::is_empty", default)]
    pub proxy_server_nameserver: Vec<String>,
}

impl Default for RuntimeDnsConfig {
    fn default() -> Self {
        Self {
            enable: true,
            ipv6: false,
            enhanced_mode: "fake-ip".to_string(),
            fake_ip_range: Some("198.18.0.1/16".to_string()),
            fake_ip_filter: vec![
                "*.lan".to_string(),
                "*.local".to_string(),
                "*.arpa".to_string(),
                "time.*.com".to_string(),
                "ntp.*.com".to_string(),
                "*.msftncsi.com".to_string(),
                "www.msftconnecttest.com".to_string(),
            ],
            default_nameserver: vec!["223.5.5.5".to_string(), "119.29.29.29".to_string()],
            nameserver: vec![
                "https://dns.alidns.com/dns-query".to_string(),
                "https://doh.pub/dns-query".to_string(),
                "223.5.5.5".to_string(),
            ],
            fallback: Vec::new(),
            proxy_server_nameserver: vec![
                "https://dns.alidns.com/dns-query".to_string(),
                "https://doh.pub/dns-query".to_string(),
                "223.5.5.5".to_string(),
            ],
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RuntimeTunConfig {
    pub enable: bool,
    pub stack: String,
    pub device: String,
    #[serde(rename = "auto-route")]
    pub auto_route: bool,
    #[serde(rename = "auto-detect-interface")]
    pub auto_detect_interface: bool,
    #[serde(rename = "dns-hijack")]
    pub dns_hijack: Vec<String>,
}


#[derive(Debug, Clone)]
pub struct RuntimeGeneratorParams<'a> {
    pub controller_port: u16,
    pub secret: &'a str,
    pub log_level: &'a str,
    pub allow_lan: bool,
    pub test_url: &'a str,
    pub timeout_ms: u32,
    pub fallback_interval: u32,
    pub fallback_lazy: bool,
    pub user_bypass: &'a [String],
    pub tun_enabled: bool,
    pub tun_port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MinimalRuntimeConfig {
    #[serde(rename = "external-controller")]
    pub external_controller: String,
    pub secret: String,
    #[serde(rename = "log-level")]
    pub log_level: String,
    pub mode: String,
    #[serde(rename = "allow-lan")]
    pub allow_lan: bool,
    #[serde(rename = "bind-address")]
    pub bind_address: String,
    #[serde(rename = "tcp-concurrent", default)]
    pub tcp_concurrent: bool,
    #[serde(rename = "unified-delay", default)]
    pub unified_delay: bool,
    #[serde(default)]
    pub dns: RuntimeDnsConfig,
    pub ipv6: bool,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub tun: Option<RuntimeTunConfig>,
    #[serde(rename = "rule-providers", skip_serializing_if = "BTreeMap::is_empty", default)]
    pub rule_providers: BTreeMap<String, RuntimeRuleProvider>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub listeners: Vec<RuntimeListener>,
    #[serde(rename = "proxy-groups", skip_serializing_if = "Vec::is_empty", default)]
    pub proxy_groups: Vec<RuntimeProxyGroup>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub proxies: Vec<serde_yaml_ng::Value>,
    #[serde(rename = "sub-rules", skip_serializing_if = "BTreeMap::is_empty", default)]
    pub sub_rules: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    pub rules: Vec<String>,
}

impl MinimalRuntimeConfig {
    pub fn new(controller_port: u16, secret: &str, log_level: &str) -> Self {
        Self {
            external_controller: format!("127.0.0.1:{}", controller_port),
            secret: secret.to_string(),
            log_level: log_level.to_string(),
            mode: "rule".to_string(),
            allow_lan: false,
            bind_address: "127.0.0.1".to_string(),
            ipv6: false,
            tcp_concurrent: true,
            tun: None,
            unified_delay: true,
            dns: RuntimeDnsConfig::default(),
            rule_providers: default_rule_providers(),
            listeners: Vec::new(),
            proxies: Vec::new(),
            proxy_groups: Vec::new(),
            sub_rules: BTreeMap::new(),
            rules: vec!["MATCH,DIRECT".to_string()],
        }
    }

    pub fn with_mappings(
        params: &RuntimeGeneratorParams<'_>,
        mappings: &[PortMapping],
        proxies: Vec<serde_yaml_ng::Value>,
        profile_names: &HashMap<String, String>,
    ) -> Self {
        let mut listeners = Vec::new();
        let mut proxy_groups = Vec::new();
        let mut sub_rules = BTreeMap::new();
        let mut rules = Vec::new();
        let mut tun_target: Option<String> = None;
        let mut tun_sub_rule: Option<String> = None;
        let listen_addr = if params.allow_lan { "0.0.0.0" } else { "127.0.0.1" };
        let bind_addr = if params.allow_lan { "*" } else { "127.0.0.1" };

        let available_proxy_names: HashSet<String> = proxies
            .iter()
            .filter_map(|p| {
                p.as_mapping().and_then(|m| {
                    m.get(serde_yaml_ng::Value::String("name".to_string()))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                })
            })
            .collect();

        let custom_bypass_rules = parse_user_bypass_to_rules(params.user_bypass);

        let resolve_node_target = |node_name: &str, profile_id: &str| -> Option<String> {
            let candidate_namespaced = profile_names
                .get(profile_id)
                .map(|pname| format!("[{}] {}", pname, node_name));

            if let Some(ns_name) = &candidate_namespaced
                && available_proxy_names.contains(ns_name)
            {
                Some(ns_name.clone())
            } else if available_proxy_names.contains(node_name) {
                Some(node_name.to_string())
            } else {
                None
            }
        };

        // Pass 1: Compute target_action and build fallback groups for each enabled port
        let mut port_target_actions: HashMap<u16, String> = HashMap::new();
        for m in mappings.iter().filter(|m| m.enabled) {
            if m.id == crate::models::FIXED_DIRECT_PORT_ID || m.node_name == "DIRECT" {
                port_target_actions.insert(m.port, "DIRECT".to_string());
                continue;
            }

            let target_node = resolve_node_target(&m.node_name, &m.profile_id);
            let fb_profile_id = m.fallback_profile_id.as_deref().unwrap_or(&m.profile_id);
            let fallback_node = m
                .fallback_node_name
                .as_ref()
                .and_then(|fb_name| resolve_node_target(fb_name, fb_profile_id));
            let target_action = match (target_node, fallback_node) {
                (Some(primary), Some(fallback)) => {
                    let group_name = format!("fb-{}", m.port);
                    proxy_groups.push(RuntimeProxyGroup {
                        name: group_name.clone(),
                        group_type: "fallback".to_string(),
                        proxies: vec![primary, fallback.clone()],
                        url: params.test_url.to_string(),
                        interval: params.fallback_interval,
                        timeout: params.timeout_ms,
                        lazy: params.fallback_lazy,
                    });
                    if m.manual_fallback { fallback } else { group_name }
                }
                (Some(primary), None) => primary,
                (None, Some(fallback)) => {
                    warn!(
                        "Port mapping {} primary node '{}' not found, using fallback '{}'",
                        m.port, m.node_name, fallback
                    );
                    fallback
                }
                (None, None) => {
                    warn!(
                        "Port mapping {} for node '{}' (profile '{}') not found in active proxies. Falling back to DIRECT.",
                        m.port, m.node_name, m.profile_id
                    );
                    "DIRECT".to_string()
                }
            };
            port_target_actions.insert(m.port, target_action);
        }

        // Pass 2: Build listeners, sub-rules, and rules
        for m in mappings.iter().filter(|m| m.enabled) {
            listeners.push(RuntimeListener {
                name: format!("in-{}", m.port),
                listener_type: m.protocol.to_string(),
                port: m.port,
                listen: listen_addr.to_string(),
            });

            let target_action = port_target_actions
                .get(&m.port)
                .cloned()
                .unwrap_or_else(|| "DIRECT".to_string());

            if m.id == crate::models::FIXED_DIRECT_PORT_ID || m.node_name == "DIRECT" {
                if Some(m.port) == params.tun_port {
                    tun_target = Some("DIRECT".to_string());
                }
                rules.push(format!("IN-PORT,{},DIRECT", m.port));
                continue;
            }

            let mut sub_rule_list = Vec::new();
            for rule in &custom_bypass_rules {
                sub_rule_list.push(rule.clone());
            }

            // Custom port routing rules (specific sites -> designated egress)
            for port_rule in m.rules.iter().filter(|r| r.enabled) {
                let rule_target = match port_rule.target_type {
                    crate::models::PortRuleTargetType::Direct => "DIRECT".to_string(),
                    crate::models::PortRuleTargetType::Port => {
                        if let Ok(target_port) = port_rule.target_value.parse::<u16>() {
                            if let Some(action) = port_target_actions.get(&target_port) {
                                action.clone()
                            } else {
                                warn!(
                                    "Port mapping {} rule target port {} not found or disabled, falling back to port default '{}'",
                                    m.port, target_port, target_action
                                );
                                target_action.clone()
                            }
                        } else {
                            target_action.clone()
                        }
                    }
                    crate::models::PortRuleTargetType::Node => {
                        let profile_id = port_rule.target_profile_id.as_deref().unwrap_or("");
                        if let Some(resolved) = resolve_node_target(&port_rule.target_value, profile_id) {
                            resolved
                        } else {
                            warn!(
                                "Port mapping {} rule target node '{}' (profile '{}') not found, falling back to port default '{}'",
                                m.port, port_rule.target_value, profile_id, target_action
                            );
                            target_action.clone()
                        }
                    }
                };

                for payload in &port_rule.payloads {
                    let trimmed = payload.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    let rule_str = match port_rule.match_type {
                        crate::models::PortRuleMatchType::IpCidr => {
                            format!("IP-CIDR,{},{},no-resolve", trimmed, rule_target)
                        }
                        _ => {
                            format!("{},{},{}", port_rule.match_type, trimmed, rule_target)
                        }
                    };
                    sub_rule_list.push(rule_str);
                }
            }

            if m.bypass_cn {
                sub_rule_list.extend(vec![
                    "RULE-SET,private_ip,DIRECT,no-resolve".to_string(),
                    "RULE-SET,private_domain,DIRECT".to_string(),
                    "RULE-SET,cn_domain,DIRECT".to_string(),
                    "RULE-SET,cn_ip,DIRECT,no-resolve".to_string(),
                ]);
            }
            if Some(m.port) == params.tun_port {
                tun_target = Some(target_action.clone());
                if !sub_rule_list.is_empty() {
                    tun_sub_rule = Some(format!("sub-rule-{}", m.port));
                }
            }

            if !sub_rule_list.is_empty() {
                sub_rule_list.push(format!("MATCH,{}", target_action));
                let sub_rule_name = format!("sub-rule-{}", m.port);
                sub_rules.insert(sub_rule_name.clone(), sub_rule_list);
                rules.push(format!("SUB-RULE,(IN-PORT,{}),{}", m.port, sub_rule_name));
            } else {
                rules.push(format!("IN-PORT,{},{}", m.port, target_action));
            }
        }
        let mut tun = None;
        if params.tun_enabled
            && let Some(target) = tun_target.clone()
        {
            if let Some(name) = tun_sub_rule.clone() {
                rules.push(format!("SUB-RULE,(IN-TYPE,TUN),{}", name));
            } else {
                rules.push(format!("IN-TYPE,TUN,{}", target));
            }
            tun = Some(RuntimeTunConfig {
                enable: true,
                stack: "gvisor".to_string(),
                device: "Mihomo-Multi".to_string(),
                auto_route: true,
                auto_detect_interface: true,
                dns_hijack: vec!["any:53".to_string()],
            });
        }

        // Invariant: Always end with MATCH,DIRECT fallback
        rules.push("MATCH,DIRECT".to_string());

        Self {
            external_controller: format!("127.0.0.1:{}", params.controller_port),
            secret: params.secret.to_string(),
            log_level: params.log_level.to_string(),
            mode: "rule".to_string(),
            allow_lan: params.allow_lan,
            bind_address: bind_addr.to_string(),
            ipv6: false,
            tun,
            tcp_concurrent: true,
            unified_delay: true,
            dns: RuntimeDnsConfig::default(),
            rule_providers: default_rule_providers(),
            listeners,
            proxy_groups,
            proxies,
            sub_rules,
            rules,
        }
    }

    pub fn to_yaml(&self) -> AppResult<String> {
        serde_yaml_ng::to_string(self).map_err(AppError::Yaml)
    }

    /// Writes runtime configuration to disk only if content has changed.
    /// Returns `Ok(true)` if the file was updated, or `Ok(false)` if the existing file is identical.
    pub fn write_to_file(&self, path: &Path) -> AppResult<bool> {
        let yaml = self.to_yaml()?;
        if path.is_file()
            && let Ok(existing) = std::fs::read_to_string(path)
            && existing == yaml
        {
            return Ok(false);
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(AppError::Io)?;
        }
        std::fs::write(path, yaml).map_err(AppError::Io)?;
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::InboundProtocol;

    #[test]
    fn test_runtime_config_generation_with_namespaces() {
        let mapping1 = PortMapping {
            id: "test-1".to_string(),
            port: 7891,
            protocol: InboundProtocol::Mixed,
            profile_id: "prof-1".to_string(),
            node_name: "HK-Node-01".to_string(),
            enabled: true,
            latency: None,
            description: Some("Test Mapping 1".to_string()),
            fallback_profile_id: None,
            fallback_node_name: None,
            bypass_cn: false,
            manual_fallback: false,
            rules: vec![],
        };
        let mapping2 = PortMapping {
            id: "test-2".to_string(),
            port: 7892,
            protocol: InboundProtocol::Socks5,
            profile_id: "prof-1".to_string(),
            node_name: "Missing-Node".to_string(),
            enabled: true,
            latency: None,
            description: Some("Missing Node Mapping".to_string()),
            fallback_profile_id: None,
            fallback_node_name: None,
            bypass_cn: false,
            manual_fallback: false,
            rules: vec![],
        };
        let mapping_disabled = PortMapping {
            id: "test-3".to_string(),
            port: 7893,
            protocol: InboundProtocol::Http,
            profile_id: "prof-1".to_string(),
            node_name: "HK-Node-01".to_string(),
            enabled: false,
            latency: None,
            description: Some("Disabled".to_string()),
            fallback_profile_id: None,
            fallback_node_name: None,
            bypass_cn: false,
            manual_fallback: false,
            rules: vec![],
        };
        let mut profile_map = HashMap::new();
        profile_map.insert("prof-1".to_string(), "AirportA".to_string());

        let raw_proxy_yaml = r#"
name: "[AirportA] HK-Node-01"
type: ss
server: 1.1.1.1
port: 8388
cipher: aes-128-gcm
password: pass
"#;
        let proxy_val: serde_yaml_ng::Value = serde_yaml_ng::from_str(raw_proxy_yaml).unwrap();
        let proxies = vec![proxy_val];

        let params = RuntimeGeneratorParams {
            controller_port: 9999,
            secret: "secret123",
            log_level: "info",
            allow_lan: false,
            test_url: "http://cp.cloudflare.com/generate_204",
            timeout_ms: 3000,
            fallback_interval: 5,
            fallback_lazy: false,
            user_bypass: &[],
            tun_enabled: false,
            tun_port: None,
        };

        let config = MinimalRuntimeConfig::with_mappings(
            &params,
            &[mapping1, mapping2, mapping_disabled],
            proxies,
            &profile_map,
        );
        let yaml = config.to_yaml().expect("YAML serialize failed");
        assert!(yaml.contains("external-controller: 127.0.0.1:9999"));
        assert!(yaml.contains("secret: secret123"));
        // Port 7891 with existing namespaced node
        assert!(yaml.contains("IN-PORT,7891,[AirportA] HK-Node-01"));
        // Port 7892 with missing node falls back to DIRECT
        assert!(yaml.contains("IN-PORT,7892,DIRECT"));
        // Disabled port 7893 should NOT be in listeners or rules
        assert!(!yaml.contains("7893"));
        // MATCH,DIRECT is always present
        assert!(yaml.contains("MATCH,DIRECT"));
        assert!(yaml.contains("tcp-concurrent: true"));
        assert!(yaml.contains("unified-delay: true"));
        assert!(yaml.contains("dns:"));
        assert!(yaml.contains("enhanced-mode: fake-ip"));
        assert!(yaml.contains("fake-ip-range: 198.18.0.1/16"));
        assert!(yaml.contains("223.5.5.5"));
        assert!(yaml.contains("https://dns.alidns.com/dns-query"));
        assert!(yaml.contains("proxy-server-nameserver:"));

        assert_eq!(config.listeners.len(), 2);
        assert_eq!(config.listeners[0].port, 7891);
        assert_eq!(config.listeners[0].listener_type, "mixed");
        assert_eq!(config.listeners[1].port, 7892);
        assert_eq!(config.listeners[1].listener_type, "socks5");
    }
    #[test]
    fn test_runtime_config_generation_with_fixed_direct() {
        let direct_mapping = PortMapping {
            id: crate::models::FIXED_DIRECT_PORT_ID.to_string(),
            port: 7878,
            protocol: InboundProtocol::Mixed,
            profile_id: "direct".to_string(),
            node_name: "DIRECT".to_string(),
            enabled: true,
            latency: None,
            description: Some("Direct Port".to_string()),
            fallback_profile_id: None,
            fallback_node_name: None,
            bypass_cn: false,
            manual_fallback: false,
            rules: vec![],
        };
        let params = RuntimeGeneratorParams {
            controller_port: 9999,
            secret: "secret123",
            log_level: "info",
            allow_lan: false,
            test_url: "http://cp.cloudflare.com/generate_204",
            timeout_ms: 3000,
            fallback_interval: 5,
            fallback_lazy: false,
            user_bypass: &[],
            tun_enabled: false,
            tun_port: None,
        };
        let config = MinimalRuntimeConfig::with_mappings(&params, &[direct_mapping], Vec::new(), &HashMap::new());
        let yaml = config.to_yaml().expect("YAML serialize failed");
        assert!(yaml.contains("IN-PORT,7878,DIRECT"));
        assert!(yaml.contains("MATCH,DIRECT"));
        assert_eq!(config.listeners.len(), 1);
        assert_eq!(config.listeners[0].port, 7878);
    }
    #[test]
    fn test_runtime_config_generation_with_fallback_group() {
        let mapping = PortMapping {
            id: "test-fb".to_string(),
            port: 7895,
            protocol: InboundProtocol::Mixed,
            profile_id: "prof-1".to_string(),
            node_name: "HK-Node-01".to_string(),
            enabled: true,
            latency: None,
            description: Some("Fallback Test".to_string()),
            fallback_profile_id: None,
            fallback_node_name: Some("HK-Node-02".to_string()),
            bypass_cn: false,
            manual_fallback: false,
            rules: vec![],
        };
        let mut profile_map = HashMap::new();
        profile_map.insert("prof-1".to_string(), "AirportA".to_string());

        let raw_proxy_yaml1 = r#"
name: "[AirportA] HK-Node-01"
type: ss
server: 1.1.1.1
port: 8388
cipher: aes-128-gcm
password: pass
"#;
        let raw_proxy_yaml2 = r#"
name: "[AirportA] HK-Node-02"
type: ss
server: 1.1.1.2
port: 8388
cipher: aes-128-gcm
password: pass
"#;
        let p1: serde_yaml_ng::Value = serde_yaml_ng::from_str(raw_proxy_yaml1).unwrap();
        let p2: serde_yaml_ng::Value = serde_yaml_ng::from_str(raw_proxy_yaml2).unwrap();
        let proxies = vec![p1, p2];

        let params = RuntimeGeneratorParams {
            controller_port: 9999,
            secret: "secret123",
            log_level: "info",
            allow_lan: false,
            test_url: "http://cp.cloudflare.com/generate_204",
            timeout_ms: 3000,
            fallback_interval: 5,
            fallback_lazy: false,
            user_bypass: &[],
            tun_enabled: false,
            tun_port: None,
        };

        let config = MinimalRuntimeConfig::with_mappings(&params, &[mapping], proxies, &profile_map);
        let yaml = config.to_yaml().expect("YAML serialize failed");
        assert!(yaml.contains("name: fb-7895"));
        assert!(yaml.contains("type: fallback"));
        assert!(yaml.contains("- '[AirportA] HK-Node-01'"));
        assert!(yaml.contains("- '[AirportA] HK-Node-02'"));
        assert!(yaml.contains("IN-PORT,7895,fb-7895"));
        assert_eq!(config.proxy_groups.len(), 1);
        assert_eq!(config.proxy_groups[0].name, "fb-7895");
        assert_eq!(config.proxy_groups[0].proxies.len(), 2);
    }
    #[test]
    fn test_runtime_config_generation_with_bypass_cn() {
        let mapping_bypass = PortMapping {
            id: "test-bypass".to_string(),
            port: 8888,
            protocol: InboundProtocol::Mixed,
            profile_id: "prof-1".to_string(),
            node_name: "HK-Node-01".to_string(),
            enabled: true,
            latency: None,
            description: Some("Bypass CN Test".to_string()),
            fallback_profile_id: None,
            fallback_node_name: None,
            bypass_cn: true,
            manual_fallback: false,
            rules: vec![],
        };
        let mapping_global = PortMapping {
            id: "test-global".to_string(),
            port: 8889,
            protocol: InboundProtocol::Socks5,
            profile_id: "prof-1".to_string(),
            node_name: "HK-Node-01".to_string(),
            enabled: true,
            latency: None,
            description: Some("Global Test".to_string()),
            fallback_profile_id: None,
            fallback_node_name: None,
            bypass_cn: false,
            manual_fallback: false,
            rules: vec![],
        };

        let mut profile_map = HashMap::new();
        profile_map.insert("prof-1".to_string(), "AirportA".to_string());

        let raw_proxy_yaml = r#"
name: "[AirportA] HK-Node-01"
type: ss
server: 1.1.1.1
port: 8388
cipher: aes-128-gcm
password: pass
"#;
        let p1: serde_yaml_ng::Value = serde_yaml_ng::from_str(raw_proxy_yaml).unwrap();

        let params = RuntimeGeneratorParams {
            controller_port: 9999,
            secret: "secret123",
            log_level: "info",
            allow_lan: false,
            test_url: "http://cp.cloudflare.com/generate_204",
            timeout_ms: 3000,
            fallback_interval: 5,
            fallback_lazy: false,
            user_bypass: &[],
            tun_enabled: false,
            tun_port: None,
        };

        let config =
            MinimalRuntimeConfig::with_mappings(&params, &[mapping_bypass, mapping_global], vec![p1], &profile_map);

        let yaml = config.to_yaml().expect("YAML serialize failed");
        assert!(yaml.contains("rule-providers:"));
        assert!(yaml.contains("cn_domain:"));
        assert!(yaml.contains("sub-rules:"));
        assert!(yaml.contains("sub-rule-8888:"));
        assert!(yaml.contains("- RULE-SET,private_ip,DIRECT,no-resolve"));
        assert!(yaml.contains("- RULE-SET,private_domain,DIRECT"));
        assert!(yaml.contains("- RULE-SET,cn_domain,DIRECT"));
        assert!(yaml.contains("- RULE-SET,cn_ip,DIRECT,no-resolve"));
        assert!(yaml.contains("- MATCH,[AirportA] HK-Node-01"));

        assert!(yaml.contains("SUB-RULE,(IN-PORT,8888),sub-rule-8888"));
        assert!(yaml.contains("IN-PORT,8889,[AirportA] HK-Node-01"));
        assert!(yaml.contains("MATCH,DIRECT"));
    }
    #[test]
    fn test_runtime_config_generation_with_cross_profile_fallback() {
        let mapping = PortMapping {
            id: "test-cross-fb".to_string(),
            port: 7896,
            protocol: InboundProtocol::Mixed,
            profile_id: "prof-1".to_string(),
            node_name: "HK-01".to_string(),
            enabled: true,
            latency: None,
            description: Some("Cross Profile Fallback Test".to_string()),
            fallback_profile_id: Some("prof-2".to_string()),
            fallback_node_name: Some("HK-Backup".to_string()),
            bypass_cn: false,
            manual_fallback: false,
            rules: vec![],
        };
        let mut profile_map = HashMap::new();
        profile_map.insert("prof-1".to_string(), "MainAirport".to_string());
        profile_map.insert("prof-2".to_string(), "BackupAirport".to_string());

        let raw_p1 = r#"
name: "[MainAirport] HK-01"
type: ss
server: 1.1.1.1
port: 8388
cipher: aes-128-gcm
password: pass
"#;
        let raw_p2 = r#"
name: "[BackupAirport] HK-Backup"
type: ss
server: 2.2.2.2
port: 8388
cipher: aes-128-gcm
password: pass
"#;
        let p1: serde_yaml_ng::Value = serde_yaml_ng::from_str(raw_p1).unwrap();
        let p2: serde_yaml_ng::Value = serde_yaml_ng::from_str(raw_p2).unwrap();

        let params = RuntimeGeneratorParams {
            controller_port: 9999,
            secret: "secret123",
            log_level: "info",
            allow_lan: false,
            test_url: "http://cp.cloudflare.com/generate_204",
            timeout_ms: 3000,
            fallback_interval: 5,
            fallback_lazy: false,
            user_bypass: &[],
            tun_enabled: false,
            tun_port: None,
        };

        let config = MinimalRuntimeConfig::with_mappings(&params, &[mapping], vec![p1, p2], &profile_map);
        let yaml = config.to_yaml().expect("YAML serialize failed");
        assert!(yaml.contains("name: fb-7896"));
        assert!(yaml.contains("type: fallback"));
        assert!(yaml.contains("- '[MainAirport] HK-01'"));
        assert!(yaml.contains("- '[BackupAirport] HK-Backup'"));
        assert!(yaml.contains("IN-PORT,7896,fb-7896"));
        assert_eq!(config.proxy_groups.len(), 1);
        assert_eq!(config.proxy_groups[0].name, "fb-7896");
        assert_eq!(
            config.proxy_groups[0].proxies,
            vec!["[MainAirport] HK-01", "[BackupAirport] HK-Backup"]
        );
    }

    #[test]
    fn test_runtime_config_generation_with_manual_fallback() {
        let mapping = PortMapping {
            id: "test-manual-fb".to_string(),
            port: 7897,
            protocol: InboundProtocol::Mixed,
            profile_id: "prof-1".to_string(),
            node_name: "HK-Node-01".to_string(),
            enabled: true,
            latency: None,
            description: Some("Manual Fallback Test".to_string()),
            fallback_profile_id: None,
            fallback_node_name: Some("HK-Node-02".to_string()),
            bypass_cn: false,
            manual_fallback: true,
            rules: vec![],
        };
        let mut profile_map = HashMap::new();
        profile_map.insert("prof-1".to_string(), "AirportA".to_string());

        let raw_proxy_yaml1 = r#"
name: "[AirportA] HK-Node-01"
type: ss
server: 1.1.1.1
port: 8388
cipher: aes-128-gcm
password: pass
"#;
        let raw_proxy_yaml2 = r#"
name: "[AirportA] HK-Node-02"
type: ss
server: 1.1.1.2
port: 8388
cipher: aes-128-gcm
password: pass
"#;
        let p1: serde_yaml_ng::Value = serde_yaml_ng::from_str(raw_proxy_yaml1).unwrap();
        let p2: serde_yaml_ng::Value = serde_yaml_ng::from_str(raw_proxy_yaml2).unwrap();
        let proxies = vec![p1, p2];

        let params = RuntimeGeneratorParams {
            controller_port: 9999,
            secret: "secret123",
            log_level: "info",
            allow_lan: false,
            test_url: "http://cp.cloudflare.com/generate_204",
            timeout_ms: 3000,
            fallback_interval: 5,
            fallback_lazy: false,
            user_bypass: &[],
            tun_enabled: false,
            tun_port: None,
        };

        let config = MinimalRuntimeConfig::with_mappings(&params, &[mapping], proxies, &profile_map);
        let yaml = config.to_yaml().expect("YAML serialize failed");
        // The group fb-7897 is created for health check
        assert!(yaml.contains("name: fb-7897"));
        // But the inbound routing goes directly to the fallback node, never switching back
        assert!(yaml.contains("IN-PORT,7897,[AirportA] HK-Node-02"));
    }

    #[test]
    fn test_parse_user_bypass_to_rules() {
        let input = vec![
            "*.sheepyu.top".to_string(),
            "sheepyu.top".to_string(),
            "119.29.106.76".to_string(),
            "10.0.0.0/8".to_string(),
            "2001:db8::1".to_string(),
            "localhost".to_string(),
            "<local>".to_string(), // should be ignored
            "*".to_string(),       // illegal bare wildcard ignored
            "top".to_string(),     // single word without dot ignored
            "*.top".to_string(),   // single tld wildcard ignored
            "   ".to_string(),     // empty ignored
        ];

        let rules = parse_user_bypass_to_rules(&input);
        assert_eq!(
            rules,
            vec![
                "DOMAIN-WILDCARD,*.sheepyu.top,DIRECT".to_string(),
                "DOMAIN,sheepyu.top,DIRECT".to_string(),
                "IP-CIDR,119.29.106.76/32,DIRECT,no-resolve".to_string(),
                "IP-CIDR,10.0.0.0/8,DIRECT,no-resolve".to_string(),
                "IP-CIDR6,2001:db8::1/128,DIRECT,no-resolve".to_string(),
                "DOMAIN,localhost,DIRECT".to_string(),
            ]
        );
    }

    #[test]
    fn test_runtime_config_generation_with_user_bypass() {
        let mapping_global = PortMapping {
            id: "test-global".to_string(),
            port: 7891,
            protocol: InboundProtocol::Mixed,
            profile_id: "prof-1".to_string(),
            node_name: "HK-Node-01".to_string(),
            enabled: true,
            latency: None,
            description: Some("Global Mapping".to_string()),
            fallback_profile_id: None,
            fallback_node_name: None,
            bypass_cn: false,
            manual_fallback: false,
            rules: vec![],
        };
        let mut profile_map = HashMap::new();
        profile_map.insert("prof-1".to_string(), "AirportA".to_string());

        let raw_proxy_yaml = r#"
name: "[AirportA] HK-Node-01"
type: ss
server: 1.1.1.1
port: 8388
cipher: aes-128-gcm
password: pass
"#;
        let p1: serde_yaml_ng::Value = serde_yaml_ng::from_str(raw_proxy_yaml).unwrap();
        let user_bypass = vec!["*.sheepyu.top".to_string(), "119.29.106.76".to_string()];

        let params = RuntimeGeneratorParams {
            controller_port: 9999,
            secret: "secret123",
            log_level: "info",
            allow_lan: false,
            test_url: "http://cp.cloudflare.com/generate_204",
            timeout_ms: 3000,
            fallback_interval: 5,
            fallback_lazy: false,
            user_bypass: &user_bypass,
            tun_enabled: false,
            tun_port: None,
        };
        let config = MinimalRuntimeConfig::with_mappings(&params, &[mapping_global], vec![p1], &profile_map);
        let yaml = config.to_yaml().expect("YAML serialize failed");

        // Even though bypass_cn is false, user bypass creates sub-rule-7891
        assert!(yaml.contains("sub-rule-7891:"));
        assert!(yaml.contains("- DOMAIN-WILDCARD,*.sheepyu.top,DIRECT"));
        assert!(yaml.contains("- IP-CIDR,119.29.106.76/32,DIRECT,no-resolve"));
        assert!(yaml.contains("- MATCH,[AirportA] HK-Node-01"));
        assert!(yaml.contains("SUB-RULE,(IN-PORT,7891),sub-rule-7891"));
    }

    #[test]
    fn test_tun_block_and_rule_without_bypass() {
        let mapping = PortMapping {
            id: "test-tun".to_string(),
            port: 7899,
            protocol: InboundProtocol::Mixed,
            profile_id: "prof-1".to_string(),
            node_name: "N1".to_string(),
            enabled: true,
            latency: None,
            description: Some("TUN Test".to_string()),
            fallback_profile_id: None,
            fallback_node_name: None,
            bypass_cn: false,
            manual_fallback: false,
            rules: vec![],
        };
        let mut profile_map = HashMap::new();
        profile_map.insert("prof-1".to_string(), "AirportA".to_string());

        let raw_proxy_yaml = r#"
name: "[AirportA] N1"
type: ss
server: 1.1.1.1
port: 8388
cipher: aes-128-gcm
password: pass
"#;
        let p1: serde_yaml_ng::Value = serde_yaml_ng::from_str(raw_proxy_yaml).unwrap();

        let params = RuntimeGeneratorParams {
            controller_port: 9999,
            secret: "secret123",
            log_level: "info",
            allow_lan: false,
            test_url: "http://cp.cloudflare.com/generate_204",
            timeout_ms: 3000,
            fallback_interval: 5,
            fallback_lazy: false,
            user_bypass: &[],
            tun_enabled: true,
            tun_port: Some(7899),
        };

        let config = MinimalRuntimeConfig::with_mappings(&params, &[mapping], vec![p1], &profile_map);
        let yaml = config.to_yaml().expect("YAML serialize failed");

        assert!(yaml.contains("tun:"));
        assert!(yaml.contains("stack: gvisor"));
        assert!(yaml.contains("auto-route: true"));
        assert!(yaml.contains("auto-detect-interface: true"));
        assert!(yaml.contains("device: Mihomo-Multi"));
        assert!(yaml.contains("dns-hijack:"));
        assert!(yaml.contains("- any:53"));
        assert!(yaml.contains("IN-TYPE,TUN,[AirportA] N1"));
        assert!(yaml.ends_with("- MATCH,DIRECT\n") || yaml.contains("- MATCH,DIRECT"));
        assert_eq!(config.rules.last(), Some(&"MATCH,DIRECT".to_string()));
    }

    #[test]
    fn test_tun_block_and_sub_rule_with_bypass() {
        let mapping = PortMapping {
            id: "test-tun-bypass".to_string(),
            port: 7899,
            protocol: InboundProtocol::Mixed,
            profile_id: "prof-1".to_string(),
            node_name: "N1".to_string(),
            enabled: true,
            latency: None,
            description: Some("TUN Bypass Test".to_string()),
            fallback_profile_id: None,
            fallback_node_name: None,
            bypass_cn: true,
            manual_fallback: false,
            rules: vec![],
        };
        let mut profile_map = HashMap::new();
        profile_map.insert("prof-1".to_string(), "AirportA".to_string());

        let raw_proxy_yaml = r#"
name: "[AirportA] N1"
type: ss
server: 1.1.1.1
port: 8388
cipher: aes-128-gcm
password: pass
"#;
        let p1: serde_yaml_ng::Value = serde_yaml_ng::from_str(raw_proxy_yaml).unwrap();

        let params = RuntimeGeneratorParams {
            controller_port: 9999,
            secret: "secret123",
            log_level: "info",
            allow_lan: false,
            test_url: "http://cp.cloudflare.com/generate_204",
            timeout_ms: 3000,
            fallback_interval: 5,
            fallback_lazy: false,
            user_bypass: &[],
            tun_enabled: true,
            tun_port: Some(7899),
        };

        let config = MinimalRuntimeConfig::with_mappings(&params, &[mapping], vec![p1], &profile_map);
        let yaml = config.to_yaml().expect("YAML serialize failed");

        assert!(yaml.contains("tun:"));
        assert!(yaml.contains("SUB-RULE,(IN-TYPE,TUN),sub-rule-7899"));
        assert!(yaml.contains("device: Mihomo-Multi"));
        assert_eq!(config.rules.last(), Some(&"MATCH,DIRECT".to_string()));
    }

    #[test]
    fn test_tun_skipped_when_port_not_in_mappings() {
        let mapping = PortMapping {
            id: "test-tun-skip".to_string(),
            port: 7899,
            protocol: InboundProtocol::Mixed,
            profile_id: "prof-1".to_string(),
            node_name: "N1".to_string(),
            enabled: true,
            latency: None,
            description: Some("TUN Skip Test".to_string()),
            fallback_profile_id: None,
            fallback_node_name: None,
            bypass_cn: false,
            manual_fallback: false,
            rules: vec![],
        };
        let mut profile_map = HashMap::new();
        profile_map.insert("prof-1".to_string(), "AirportA".to_string());

        let raw_proxy_yaml = r#"
name: "[AirportA] N1"
type: ss
server: 1.1.1.1
port: 8388
cipher: aes-128-gcm
password: pass
"#;
        let p1: serde_yaml_ng::Value = serde_yaml_ng::from_str(raw_proxy_yaml).unwrap();

        let params = RuntimeGeneratorParams {
            controller_port: 9999,
            secret: "secret123",
            log_level: "info",
            allow_lan: false,
            test_url: "http://cp.cloudflare.com/generate_204",
            timeout_ms: 3000,
            fallback_interval: 5,
            fallback_lazy: false,
            user_bypass: &[],
            tun_enabled: true,
            tun_port: Some(1234), // Not in mappings!
        };

        let config = MinimalRuntimeConfig::with_mappings(&params, &[mapping], vec![p1], &profile_map);
        let yaml = config.to_yaml().expect("YAML serialize failed");

        assert!(!yaml.contains("tun:"));
        assert!(!yaml.contains("IN-TYPE,TUN"));
    }

    #[test]
    fn test_port_specific_routing_rules_and_tun_inheritance() {
        use crate::models::{PortRule, PortRuleMatchType, PortRuleTargetType};

        let mapping_7890 = PortMapping {
            id: "m-7890".to_string(),
            port: 7890,
            protocol: InboundProtocol::Mixed,
            profile_id: "prof-1".to_string(),
            node_name: "N1".to_string(),
            enabled: true,
            latency: None,
            description: None,
            fallback_profile_id: None,
            fallback_node_name: None,
            bypass_cn: true,
            manual_fallback: false,
            rules: vec![
                PortRule {
                    id: "r1".to_string(),
                    name: Some("OpenAI".to_string()),
                    icon: Some("bot".to_string()),
                    match_type: PortRuleMatchType::DomainSuffix,
                    payloads: vec!["openai.com".to_string(), "chatgpt.com".to_string()],
                    target_type: PortRuleTargetType::Port,
                    target_value: "7891".to_string(),
                    target_profile_id: None,
                    enabled: true,
                },
                PortRule {
                    id: "r2".to_string(),
                    name: Some("Claude".to_string()),
                    icon: None,
                    match_type: PortRuleMatchType::DomainSuffix,
                    payloads: vec!["claude.ai".to_string()],
                    target_type: PortRuleTargetType::Node,
                    target_value: "N2".to_string(),
                    target_profile_id: Some("prof-1".to_string()),
                    enabled: true,
                },
                PortRule {
                    id: "r3".to_string(),
                    name: Some("Direct LAN".to_string()),
                    icon: None,
                    match_type: PortRuleMatchType::Domain,
                    payloads: vec!["internal.example".to_string()],
                    target_type: PortRuleTargetType::Direct,
                    target_value: "DIRECT".to_string(),
                    target_profile_id: None,
                    enabled: true,
                },
                PortRule {
                    id: "r4-disabled".to_string(),
                    name: Some("Disabled Rule".to_string()),
                    icon: None,
                    match_type: PortRuleMatchType::DomainSuffix,
                    payloads: vec!["disabled.com".to_string()],
                    target_type: PortRuleTargetType::Direct,
                    target_value: "DIRECT".to_string(),
                    target_profile_id: None,
                    enabled: false,
                },
            ],
        };

        let mapping_7891 = PortMapping {
            id: "m-7891".to_string(),
            port: 7891,
            protocol: InboundProtocol::Mixed,
            profile_id: "prof-1".to_string(),
            node_name: "N2".to_string(),
            enabled: true,
            latency: None,
            description: None,
            fallback_profile_id: Some("prof-1".to_string()),
            fallback_node_name: Some("N1".to_string()),
            bypass_cn: false,
            manual_fallback: false,
            rules: vec![],
        };

        let mut profile_map = HashMap::new();
        profile_map.insert("prof-1".to_string(), "AirportA".to_string());

        let raw_proxy_1 = r#"
name: "[AirportA] N1"
type: ss
server: 1.1.1.1
port: 8388
cipher: aes-128-gcm
password: pass
"#;
        let raw_proxy_2 = r#"
name: "[AirportA] N2"
type: ss
server: 2.2.2.2
port: 8388
cipher: aes-128-gcm
password: pass
"#;
        let p1: serde_yaml_ng::Value = serde_yaml_ng::from_str(raw_proxy_1).unwrap();
        let p2: serde_yaml_ng::Value = serde_yaml_ng::from_str(raw_proxy_2).unwrap();

        let params = RuntimeGeneratorParams {
            controller_port: 9999,
            secret: "secret123",
            log_level: "info",
            allow_lan: false,
            test_url: "http://cp.cloudflare.com/generate_204",
            timeout_ms: 3000,
            fallback_interval: 5,
            fallback_lazy: false,
            user_bypass: &[],
            tun_enabled: true,
            tun_port: Some(7890),
        };

        let config = MinimalRuntimeConfig::with_mappings(
            &params,
            &[mapping_7890, mapping_7891],
            vec![p1, p2],
            &profile_map,
        );
        let yaml = config.to_yaml().expect("YAML serialize failed");

        // Sub-rule for 7890 must have the custom rules
        assert!(yaml.contains("DOMAIN-SUFFIX,openai.com,fb-7891"));
        assert!(yaml.contains("DOMAIN-SUFFIX,chatgpt.com,fb-7891"));
        assert!(yaml.contains("DOMAIN-SUFFIX,claude.ai,[AirportA] N2"));
        assert!(yaml.contains("DOMAIN,internal.example,DIRECT"));
        // Disabled rule must not exist
        assert!(!yaml.contains("disabled.com"));
        // TUN must reuse sub-rule-7890
        assert!(yaml.contains("SUB-RULE,(IN-TYPE,TUN),sub-rule-7890"));
    }
}
