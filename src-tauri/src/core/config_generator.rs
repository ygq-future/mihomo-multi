use crate::error::{AppError, AppResult};
use crate::models::PortMapping;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
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

        for m in mappings.iter().filter(|m| m.enabled) {
            listeners.push(RuntimeListener {
                name: format!("in-{}", m.port),
                listener_type: m.protocol.to_string(),
                port: m.port,
                listen: listen_addr.to_string(),
            });

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

            if m.bypass_cn {
                let sub_rule_name = format!("sub-rule-{}", m.port);
                sub_rules.insert(
                    sub_rule_name.clone(),
                    vec![
                        "RULE-SET,private_ip,DIRECT,no-resolve".to_string(),
                        "RULE-SET,private_domain,DIRECT".to_string(),
                        "RULE-SET,cn_domain,DIRECT".to_string(),
                        "RULE-SET,cn_ip,DIRECT,no-resolve".to_string(),
                        format!("MATCH,{}", target_action),
                    ],
                );
                rules.push(format!("SUB-RULE,(IN-PORT,{}),{}", m.port, sub_rule_name));
            } else {
                rules.push(format!("IN-PORT,{},{}", m.port, target_action));
            }
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
        };

        let config = MinimalRuntimeConfig::with_mappings(&params, &[mapping], proxies, &profile_map);
        let yaml = config.to_yaml().expect("YAML serialize failed");
        // The group fb-7897 is created for health check
        assert!(yaml.contains("name: fb-7897"));
        // But the inbound routing goes directly to the fallback node, never switching back
        assert!(yaml.contains("IN-PORT,7897,[AirportA] HK-Node-02"));
    }
}
