use crate::error::{AppError, AppResult};
use crate::models::PortMapping;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
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
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub listeners: Vec<RuntimeListener>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub proxies: Vec<serde_yaml_ng::Value>,
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
            listeners: Vec::new(),
            proxies: Vec::new(),
            rules: vec!["MATCH,DIRECT".to_string()],
        }
    }

    pub fn with_mappings(
        controller_port: u16,
        secret: &str,
        log_level: &str,
        mappings: &[PortMapping],
        proxies: Vec<serde_yaml_ng::Value>,
        profile_names: &HashMap<String, String>,
    ) -> Self {
        let mut listeners = Vec::new();
        let mut rules = Vec::new();

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
                listen: "127.0.0.1".to_string(),
            });

            // Resolve target proxy name
            let candidate_namespaced = profile_names
                .get(&m.profile_id)
                .map(|pname| format!("[{}] {}", pname, m.node_name));

            let target_node = if let Some(ref ns_name) = candidate_namespaced
                && available_proxy_names.contains(ns_name)
            {
                Some(ns_name.clone())
            } else if available_proxy_names.contains(&m.node_name) {
                Some(m.node_name.clone())
            } else {
                None
            };

            if let Some(target) = target_node {
                rules.push(format!("IN-PORT,{},{}", m.port, target));
            } else {
                // Safety fallback: if node is missing/invalid, fallback to DIRECT
                warn!(
                    "Port mapping {} for node '{}' (profile '{}') not found in active proxies. Falling back to DIRECT.",
                    m.port, m.node_name, m.profile_id
                );
                rules.push(format!("IN-PORT,{},DIRECT", m.port));
            }
        }

        // Invariant: Always end with MATCH,DIRECT fallback
        rules.push("MATCH,DIRECT".to_string());

        Self {
            external_controller: format!("127.0.0.1:{}", controller_port),
            secret: secret.to_string(),
            log_level: log_level.to_string(),
            mode: "rule".to_string(),
            allow_lan: false,
            bind_address: "127.0.0.1".to_string(),
            ipv6: false,
            listeners,
            proxies,
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

        let config = MinimalRuntimeConfig::with_mappings(
            9999,
            "secret123",
            "info",
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
}
