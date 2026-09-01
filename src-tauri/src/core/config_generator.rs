use crate::error::{AppError, AppResult};
use crate::models::PortMapping;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    ) -> Self {
        let mut listeners = Vec::new();
        let mut rules = Vec::new();

        for m in mappings.iter().filter(|m| m.enabled) {
            listeners.push(RuntimeListener {
                name: format!("in-{}", m.port),
                listener_type: m.protocol.to_string(),
                port: m.port,
                listen: "127.0.0.1".to_string(),
            });

            rules.push(format!("IN-PORT,{},{}", m.port, m.node_name));
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
    fn test_runtime_config_generation() {
        let mapping = PortMapping {
            id: "test-1".to_string(),
            port: 7891,
            protocol: InboundProtocol::Mixed,
            profile_id: "prof-1".to_string(),
            node_name: "HK-Node-01".to_string(),
            enabled: true,
            latency: None,
            description: Some("Test Mapping".to_string()),
        };

        let config = MinimalRuntimeConfig::with_mappings(9999, "secret123", "info", &[mapping], Vec::new());

        let yaml = config.to_yaml().expect("YAML serialize failed");
        assert!(yaml.contains("external-controller: 127.0.0.1:9999"));
        assert!(yaml.contains("secret: secret123"));
        assert!(yaml.contains("IN-PORT,7891,HK-Node-01"));
        assert!(yaml.contains("MATCH,DIRECT"));
    }
}
