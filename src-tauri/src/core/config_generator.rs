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
pub struct RuntimeGeoXUrl {
    pub geoip: String,
    pub geosite: String,
}

impl Default for RuntimeGeoXUrl {
    fn default() -> Self {
        Self {
            geoip: "https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geoip.dat".to_string(),
            geosite: "https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geosite.dat".to_string(),
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
    pub ipv6: bool,
    #[serde(rename = "geodata-mode")]
    pub geodata_mode: bool,
    #[serde(rename = "geo-auto-update")]
    pub geo_auto_update: bool,
    #[serde(rename = "geo-update-interval")]
    pub geo_update_interval: u32,
    #[serde(rename = "geox-url")]
    pub geox_url: RuntimeGeoXUrl,
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
            geodata_mode: true,
            geo_auto_update: true,
            geo_update_interval: 24,
            geox_url: RuntimeGeoXUrl::default(),
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
            let fallback_node = m
                .fallback_node_name
                .as_ref()
                .and_then(|fb_name| resolve_node_target(fb_name, &m.profile_id));

            let target_action = match (target_node, fallback_node) {
                (Some(primary), Some(fallback)) => {
                    let group_name = format!("fb-{}", m.port);
                    proxy_groups.push(RuntimeProxyGroup {
                        name: group_name.clone(),
                        group_type: "fallback".to_string(),
                        proxies: vec![primary, fallback],
                        url: params.test_url.to_string(),
                        interval: params.fallback_interval,
                        timeout: params.timeout_ms,
                        lazy: params.fallback_lazy,
                    });
                    group_name
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
                        "GEOIP,private,DIRECT,no-resolve".to_string(),
                        "GEOSITE,private,DIRECT".to_string(),
                        "GEOSITE,cn,DIRECT".to_string(),
                        "GEOIP,cn,DIRECT".to_string(),
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
            geodata_mode: true,
            geo_auto_update: true,
            geo_update_interval: 24,
            geox_url: RuntimeGeoXUrl::default(),
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

    pub fn write_to_file(&self, path: &Path) -> AppResult<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(AppError::Io)?;
        }
        let yaml = self.to_yaml()?;
        std::fs::write(path, yaml).map_err(AppError::Io)?;
        Ok(())
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
            fallback_node_name: None,
            bypass_cn: false,
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
            fallback_node_name: None,
            bypass_cn: false,
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
            fallback_node_name: None,
            bypass_cn: false,
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
            fallback_node_name: Some("HK-Node-02".to_string()),
            bypass_cn: false,
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

        let config = MinimalRuntimeConfig::with_mappings(
            &params,
            &[mapping],
            proxies,
            &profile_map,
        );
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
            fallback_node_name: None,
            bypass_cn: true,
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
            fallback_node_name: None,
            bypass_cn: false,
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

        let config = MinimalRuntimeConfig::with_mappings(
            &params,
            &[mapping_bypass, mapping_global],
            vec![p1],
            &profile_map,
        );

        let yaml = config.to_yaml().expect("YAML serialize failed");
        assert!(yaml.contains("geodata-mode: true"));
        assert!(yaml.contains("geo-auto-update: true"));
        assert!(yaml.contains("sub-rules:"));
        assert!(yaml.contains("sub-rule-8888:"));
        assert!(yaml.contains("- GEOIP,private,DIRECT,no-resolve"));
        assert!(yaml.contains("- GEOSITE,private,DIRECT"));
        assert!(yaml.contains("- GEOSITE,cn,DIRECT"));
        assert!(yaml.contains("- GEOIP,cn,DIRECT"));
        assert!(yaml.contains("- MATCH,[AirportA] HK-Node-01"));

        assert!(yaml.contains("SUB-RULE,(IN-PORT,8888),sub-rule-8888"));
        assert!(yaml.contains("IN-PORT,8889,[AirportA] HK-Node-01"));
        assert!(yaml.contains("MATCH,DIRECT"));
    }
}
