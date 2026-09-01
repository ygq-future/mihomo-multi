use crate::error::{AppError, AppResult};
use crate::models::{ProfileItem, ProfileType, ProxyNode};
use parking_lot::RwLock;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tracing::{error, info, warn};
use uuid::Uuid;

pub const DEFAULT_USER_AGENT: &str = "clash-verge/v2.0.0 (mihomo-multi)";
const REQUEST_TIMEOUT_SECS: u64 = 25;

/// Helper to get the current Unix timestamp in seconds
fn current_unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_secs(0))
        .as_secs()
}

/// Helper function to parse ProxyNode list from Clash YAML string
pub fn parse_nodes_from_yaml(yaml_content: &str) -> AppResult<Vec<ProxyNode>> {
    let root: serde_yaml_ng::Value = serde_yaml_ng::from_str(yaml_content)
        .map_err(|err| AppError::InvalidConfig(format!("Failed to parse YAML: {}", err)))?;

    let proxies_val = match root.get("proxies") {
        Some(v) => v,
        None => return Ok(Vec::new()),
    };

    let proxies_seq = match proxies_val.as_sequence() {
        Some(seq) => seq,
        None => return Ok(Vec::new()),
    };

    let mut nodes = Vec::with_capacity(proxies_seq.len());

    for item in proxies_seq {
        if let Some(map) = item.as_mapping() {
            let name = map
                .get(serde_yaml_ng::Value::String("name".to_string()))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();

            if name.is_empty() {
                continue;
            }

            let node_type = map
                .get(serde_yaml_ng::Value::String("type".to_string()))
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_lowercase();

            let server = map
                .get(serde_yaml_ng::Value::String("server".to_string()))
                .and_then(|v| v.as_str().map(|s| s.to_string()).or_else(|| v.as_i64().map(|i| i.to_string())))
                .unwrap_or_default();

            let port = map
                .get(serde_yaml_ng::Value::String("port".to_string()))
                .and_then(|v| {
                    if let Some(u) = v.as_u64() {
                        Some(u as u16)
                    } else if let Some(s) = v.as_str() {
                        s.parse::<u16>().ok()
                    } else {
                        None
                    }
                })
                .unwrap_or(0);

            nodes.push(ProxyNode {
                name,
                node_type,
                server,
                port,
                latency: None,
            });
        }
    }

    Ok(nodes)
}

/// Helper function to extract raw proxies YAML array
pub fn extract_raw_proxies_from_yaml(yaml_content: &str) -> AppResult<Vec<serde_yaml_ng::Value>> {
    let root: serde_yaml_ng::Value = serde_yaml_ng::from_str(yaml_content)
        .map_err(|err| AppError::InvalidConfig(format!("Failed to parse YAML: {}", err)))?;

    if let Some(proxies_val) = root.get("proxies")
        && let Some(seq) = proxies_val.as_sequence()
    {
        return Ok(seq.clone());
    }

    Ok(Vec::new())
}

#[derive(Clone)]
pub struct ProfileManager {
    profiles: Arc<RwLock<Vec<ProfileItem>>>,
    profiles_dir: PathBuf,
    metadata_path: PathBuf,
    http_client: reqwest::Client,
}

impl ProfileManager {
    pub fn new(app_dir: PathBuf) -> Self {
        let profiles_dir = app_dir.join("profiles");
        let metadata_path = app_dir.join("profiles.json");

        if let Err(err) = std::fs::create_dir_all(&profiles_dir) {
            warn!("Failed to create profiles directory '{}': {}", profiles_dir.display(), err);
        }

        let http_client = reqwest::Client::builder()
            .user_agent(DEFAULT_USER_AGENT)
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_default();

        let initial_profiles = Self::load_metadata(&metadata_path);

        Self {
            profiles: Arc::new(RwLock::new(initial_profiles)),
            profiles_dir,
            metadata_path,
            http_client,
        }
    }

    fn load_metadata(path: &Path) -> Vec<ProfileItem> {
        if !path.exists() {
            return Vec::new();
        }

        match std::fs::read_to_string(path) {
            Ok(content) => match serde_json::from_str::<Vec<ProfileItem>>(&content) {
                Ok(profiles) => profiles,
                Err(err) => {
                    error!("Failed to parse profiles metadata from '{}': {}", path.display(), err);
                    Vec::new()
                }
            },
            Err(err) => {
                error!("Failed to read profiles metadata from '{}': {}", path.display(), err);
                Vec::new()
            }
        }
    }

    fn persist_metadata(&self) -> AppResult<()> {
        let profiles = self.profiles.read().clone();
        if let Some(parent) = self.metadata_path.parent() {
            std::fs::create_dir_all(parent).map_err(AppError::Io)?;
        }
        let json = serde_json::to_string_pretty(&profiles).map_err(AppError::Serialization)?;
        std::fs::write(&self.metadata_path, json).map_err(AppError::Io)?;
        Ok(())
    }

    pub async fn fetch_remote_yaml(&self, url: &str) -> AppResult<String> {
        info!("Fetching remote subscription from: {}", url);
        let resp = self
            .http_client
            .get(url)
            .send()
            .await
            .map_err(AppError::Network)?;

        if !resp.status().is_success() {
            return Err(AppError::InvalidConfig(format!(
                "HTTP request failed with status: {}",
                resp.status()
            )));
        }

        let content = resp.text().await.map_err(AppError::Network)?;
        Ok(content)
    }

    pub fn get_profiles(&self) -> Vec<ProfileItem> {
        self.profiles.read().clone()
    }

    pub fn get_profile_by_id(&self, id: &str) -> Option<ProfileItem> {
        self.profiles.read().iter().find(|p| p.id == id).cloned()
    }

    pub async fn add_remote_profile(
        &self,
        name: String,
        url: String,
        auto_update_interval_mins: u32,
    ) -> AppResult<ProfileItem> {
        let trimmed_name = name.trim().to_string();
        let trimmed_url = url.trim().to_string();

        if trimmed_name.is_empty() {
            return Err(AppError::InvalidConfig("Profile name cannot be empty".to_string()));
        }
        if trimmed_url.is_empty() {
            return Err(AppError::InvalidConfig("Subscription URL cannot be empty".to_string()));
        }

        let yaml_content = self.fetch_remote_yaml(&trimmed_url).await?;
        let nodes = parse_nodes_from_yaml(&yaml_content)?;
        let node_count = nodes.len();

        let id = Uuid::new_v4().to_string();
        let file_path = self.profiles_dir.join(format!("{}.yaml", id));
        std::fs::write(&file_path, &yaml_content).map_err(AppError::Io)?;

        let item = ProfileItem {
            id,
            name: trimmed_name,
            profile_type: ProfileType::Remote,
            url: Some(trimmed_url),
            file_path: file_path.to_string_lossy().to_string(),
            auto_update_interval_mins,
            last_updated_at: current_unix_timestamp(),
            node_count,
        };

        {
            let mut guard = self.profiles.write();
            guard.push(item.clone());
        }

        self.persist_metadata()?;
        info!("Remote profile '{}' added successfully with {} nodes", item.name, node_count);
        Ok(item)
    }

    pub fn add_local_profile(&self, name: String, source_file_path: String) -> AppResult<ProfileItem> {
        let trimmed_name = name.trim().to_string();
        let source_path = PathBuf::from(source_file_path.trim());

        if trimmed_name.is_empty() {
            return Err(AppError::InvalidConfig("Profile name cannot be empty".to_string()));
        }
        if !source_path.exists() {
            return Err(AppError::InvalidConfig(format!(
                "Source file not found at: {}",
                source_path.display()
            )));
        }

        let yaml_content = std::fs::read_to_string(&source_path).map_err(AppError::Io)?;
        let nodes = parse_nodes_from_yaml(&yaml_content)?;
        let node_count = nodes.len();

        let id = Uuid::new_v4().to_string();
        let dest_file_path = self.profiles_dir.join(format!("{}.yaml", id));
        std::fs::write(&dest_file_path, &yaml_content).map_err(AppError::Io)?;

        let item = ProfileItem {
            id,
            name: trimmed_name,
            profile_type: ProfileType::Local,
            url: None,
            file_path: dest_file_path.to_string_lossy().to_string(),
            auto_update_interval_mins: 0,
            last_updated_at: current_unix_timestamp(),
            node_count,
        };

        {
            let mut guard = self.profiles.write();
            guard.push(item.clone());
        }

        self.persist_metadata()?;
        info!("Local profile '{}' imported successfully with {} nodes", item.name, node_count);
        Ok(item)
    }

    pub async fn update_profile(&self, id: &str) -> AppResult<ProfileItem> {
        let existing = self
            .get_profile_by_id(id)
            .ok_or_else(|| AppError::ProfileNotFound(format!("Profile with ID '{}' not found", id)))?;

        let (yaml_content, node_count) = match existing.profile_type {
            ProfileType::Remote => {
                let url = existing
                    .url
                    .as_deref()
                    .ok_or_else(|| AppError::InvalidConfig("Remote profile is missing URL".to_string()))?;
                let content = self.fetch_remote_yaml(url).await?;
                let nodes = parse_nodes_from_yaml(&content)?;
                (content, nodes.len())
            }
            ProfileType::Local => {
                let path = PathBuf::from(&existing.file_path);
                if !path.exists() {
                    return Err(AppError::InvalidConfig(format!(
                        "Local profile file missing: {}",
                        path.display()
                    )));
                }
                let content = std::fs::read_to_string(&path).map_err(AppError::Io)?;
                let nodes = parse_nodes_from_yaml(&content)?;
                (content, nodes.len())
            }
        };

        let target_file_path = self.profiles_dir.join(format!("{}.yaml", id));
        std::fs::write(&target_file_path, &yaml_content).map_err(AppError::Io)?;

        let updated_item = {
            let mut guard = self.profiles.write();
            let item = guard
                .iter_mut()
                .find(|p| p.id == id)
                .ok_or_else(|| AppError::ProfileNotFound(format!("Profile with ID '{}' not found", id)))?;

            item.last_updated_at = current_unix_timestamp();
            item.node_count = node_count;
            item.file_path = target_file_path.to_string_lossy().to_string();
            item.clone()
        };

        self.persist_metadata()?;
        info!("Profile '{}' updated successfully, new node count: {}", updated_item.name, node_count);
        Ok(updated_item)
    }

    pub fn edit_profile(
        &self,
        id: &str,
        name: String,
        url: Option<String>,
        auto_update_interval_mins: u32,
    ) -> AppResult<ProfileItem> {
        let trimmed_name = name.trim().to_string();
        if trimmed_name.is_empty() {
            return Err(AppError::InvalidConfig("Profile name cannot be empty".to_string()));
        }

        let updated_item = {
            let mut guard = self.profiles.write();
            let item = guard
                .iter_mut()
                .find(|p| p.id == id)
                .ok_or_else(|| AppError::ProfileNotFound(format!("Profile with ID '{}' not found", id)))?;

            item.name = trimmed_name;
            if let Some(u) = url {
                let trimmed_url = u.trim().to_string();
                if !trimmed_url.is_empty() {
                    item.url = Some(trimmed_url);
                }
            }
            item.auto_update_interval_mins = auto_update_interval_mins;
            item.clone()
        };

        self.persist_metadata()?;
        info!("Profile '{}' (ID: {}) edited successfully", updated_item.name, id);
        Ok(updated_item)
    }

    pub fn delete_profile(&self, id: &str) -> AppResult<()> {
        let removed = {
            let mut guard = self.profiles.write();
            let pos = guard.iter().position(|p| p.id == id);
            pos.map(|index| guard.remove(index))
        };

        if let Some(profile) = removed {
            let target_path = self.profiles_dir.join(format!("{}.yaml", id));
            if target_path.exists() {
                let _ = std::fs::remove_file(&target_path);
            }
            let _ = self.persist_metadata();
            info!("Profile '{}' (ID: {}) deleted", profile.name, id);
            Ok(())
        } else {
            Err(AppError::ProfileNotFound(format!("Profile with ID '{}' not found", id)))
        }
    }

    pub fn get_profile_nodes(&self, id: &str) -> AppResult<Vec<ProxyNode>> {
        let profile = self
            .get_profile_by_id(id)
            .ok_or_else(|| AppError::ProfileNotFound(format!("Profile with ID '{}' not found", id)))?;

        let file_path = PathBuf::from(&profile.file_path);
        if !file_path.exists() {
            return Err(AppError::InvalidConfig(format!(
                "Profile file does not exist at: {}",
                file_path.display()
            )));
        }

        let yaml_content = std::fs::read_to_string(&file_path).map_err(AppError::Io)?;
        parse_nodes_from_yaml(&yaml_content)
    }

    pub fn get_all_nodes(&self) -> Vec<ProxyNode> {
        let profiles = self.get_profiles();
        let mut all_nodes = Vec::new();

        for profile in profiles {
            if let Ok(nodes) = self.get_profile_nodes(&profile.id) {
                all_nodes.extend(nodes);
            }
        }

        all_nodes
    }

    pub fn get_raw_proxies_for_all_profiles(&self) -> Vec<serde_yaml_ng::Value> {
        let profiles = self.get_profiles();
        let mut all_proxies = Vec::new();

        for profile in profiles {
            let file_path = PathBuf::from(&profile.file_path);
            if let Ok(content) = std::fs::read_to_string(&file_path)
                && let Ok(raw_proxies) = extract_raw_proxies_from_yaml(&content)
            {
                all_proxies.extend(raw_proxies);
            }
        }

        all_proxies
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_CLASH_YAML: &str = r#"
port: 7890
socks-port: 7891
mode: rule
log-level: info
proxies:
  - name: "HK-Shadowsocks-01"
    type: ss
    server: 1.2.3.4
    port: 8388
    cipher: chacha20-ietf-poly1305
    password: "password123"
  - name: "US-VMess-02"
    type: vmess
    server: 5.6.7.8
    port: 443
    uuid: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    alterId: 0
    cipher: auto
    tls: true
  - name: "JP-Trojan-03"
    type: trojan
    server: 9.10.11.12
    port: 443
    password: "trojan-password"
  - name: "SG-Hysteria2-04"
    type: hysteria2
    server: 13.14.15.16
    port: 8443
    password: "hy2-password"
rules:
  - MATCH,DIRECT
"#;

    #[test]
    fn test_parse_nodes_from_valid_yaml() {
        let nodes = parse_nodes_from_yaml(SAMPLE_CLASH_YAML).expect("Failed to parse YAML nodes");
        assert_eq!(nodes.len(), 4);

        assert_eq!(nodes[0].name, "HK-Shadowsocks-01");
        assert_eq!(nodes[0].node_type, "ss");
        assert_eq!(nodes[0].server, "1.2.3.4");
        assert_eq!(nodes[0].port, 8388);
        assert!(nodes[0].latency.is_none());

        assert_eq!(nodes[1].name, "US-VMess-02");
        assert_eq!(nodes[1].node_type, "vmess");
        assert_eq!(nodes[1].server, "5.6.7.8");
        assert_eq!(nodes[1].port, 443);

        assert_eq!(nodes[2].name, "JP-Trojan-03");
        assert_eq!(nodes[2].node_type, "trojan");

        assert_eq!(nodes[3].name, "SG-Hysteria2-04");
        assert_eq!(nodes[3].node_type, "hysteria2");
        assert_eq!(nodes[3].port, 8443);
    }

    #[test]
    fn test_parse_nodes_from_empty_proxies_yaml() {
        let yaml = r#"
port: 7890
mode: rule
rules:
  - MATCH,DIRECT
"#;
        let nodes = parse_nodes_from_yaml(yaml).expect("Failed to parse empty YAML");
        assert_eq!(nodes.len(), 0);
    }

    #[test]
    fn test_parse_nodes_malformed_yaml() {
        let yaml = ": - invalid: yaml: {";
        let res = parse_nodes_from_yaml(yaml);
        assert!(res.is_err());
    }

    #[test]
    fn test_extract_raw_proxies() {
        let raw = extract_raw_proxies_from_yaml(SAMPLE_CLASH_YAML).expect("Failed to extract raw proxies");
        assert_eq!(raw.len(), 4);
    }

    #[test]
    fn test_profile_manager_local_lifecycle_and_persistence() {
        let temp_dir = std::env::temp_dir().join(format!("mihomo_test_profile_{}", Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).expect("Create temp dir failed");

        // 1. Create a source YAML file
        let source_file = temp_dir.join("source.yaml");
        std::fs::write(&source_file, SAMPLE_CLASH_YAML).expect("Write source yaml failed");

        // 2. Initialize manager
        let manager = ProfileManager::new(temp_dir.clone());
        assert_eq!(manager.get_profiles().len(), 0);

        // 3. Add local profile
        let profile = manager
            .add_local_profile("Test Local Profile".to_string(), source_file.to_string_lossy().to_string())
            .expect("Add local profile failed");

        assert_eq!(profile.name, "Test Local Profile");
        assert_eq!(profile.profile_type, ProfileType::Local);
        assert_eq!(profile.node_count, 4);
        assert!(profile.url.is_none());

        // 4. Retrieve nodes
        let nodes = manager.get_profile_nodes(&profile.id).expect("Get profile nodes failed");
        assert_eq!(nodes.len(), 4);
        assert_eq!(nodes[0].name, "HK-Shadowsocks-01");

        // 5. Test persistence by recreating manager from same path
        let manager2 = ProfileManager::new(temp_dir.clone());
        let loaded_profiles = manager2.get_profiles();
        assert_eq!(loaded_profiles.len(), 1);
        assert_eq!(loaded_profiles[0].id, profile.id);
        assert_eq!(loaded_profiles[0].name, "Test Local Profile");
        assert_eq!(loaded_profiles[0].node_count, 4);

        // 6. Test edit profile
        let edited = manager2
            .edit_profile(&profile.id, "Renamed Local Profile".to_string(), None, 360)
            .expect("Edit profile failed");
        assert_eq!(edited.name, "Renamed Local Profile");
        assert_eq!(edited.auto_update_interval_mins, 360);

        // 7. Delete profile
        manager2.delete_profile(&profile.id).expect("Delete profile failed");
        assert_eq!(manager2.get_profiles().len(), 0);

        // 8. Cleanup temp dir
        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
