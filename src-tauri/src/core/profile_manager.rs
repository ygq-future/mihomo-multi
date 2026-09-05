use crate::error::{AppError, AppResult};
use crate::models::{ProfileItem, ProfileType, ProxyNode};
use parking_lot::RwLock;
use std::collections::{HashMap, HashSet};
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
                .and_then(|v| {
                    v.as_str()
                        .map(|s| s.to_string())
                        .or_else(|| v.as_i64().map(|i| i.to_string()))
                })
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
                profile_id: None,
                profile_name: None,
                runtime_name: None,
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

#[derive(Debug, Clone, Default)]
pub struct ProfileNodeIndexEntry {
    pub nodes: Vec<ProxyNode>,
    pub raw_proxies: Vec<serde_yaml_ng::Value>,
    pub node_names: HashSet<String>,
}

/// Atomically write bytes to a file by writing to a sibling temporary file and renaming it.
pub fn atomic_write_file(path: &Path, content: &[u8]) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(AppError::Io)?;
    }
    let temp_path = match path.parent() {
        Some(parent) => parent.join(format!(
            ".tmp_{}_{}",
            Uuid::new_v4(),
            path.file_name().and_then(|n| n.to_str()).unwrap_or("file")
        )),
        None => PathBuf::from(format!(".tmp_{}", Uuid::new_v4())),
    };

    if let Err(err) = std::fs::write(&temp_path, content) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(AppError::Io(err));
    }

    if let Err(_err) = std::fs::rename(&temp_path, path) {
        let _ = std::fs::remove_file(path);
        if let Err(err2) = std::fs::rename(&temp_path, path) {
            let _ = std::fs::remove_file(&temp_path);
            return Err(AppError::Io(err2));
        }
    }

    Ok(())
}

#[derive(Clone)]
pub struct ProfileManager {
    profiles: Arc<RwLock<Vec<ProfileItem>>>,
    node_index: Arc<RwLock<HashMap<String, ProfileNodeIndexEntry>>>,
    profiles_dir: Option<PathBuf>,
    metadata_path: Option<PathBuf>,
    http_client: reqwest::Client,
}

impl ProfileManager {
    pub fn new(app_dir: PathBuf) -> Self {
        let profiles_dir = app_dir.join("profiles");
        let metadata_path = app_dir.join("profiles.json");

        if let Err(err) = std::fs::create_dir_all(&profiles_dir) {
            warn!(
                "Failed to create profiles directory '{}': {}",
                profiles_dir.display(),
                err
            );
        }

        let http_client = reqwest::Client::builder()
            .user_agent(DEFAULT_USER_AGENT)
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_default();

        let initial_profiles = Self::load_metadata(&metadata_path);
        let mut index_map = HashMap::new();

        // Parse and index existing profile YAML files once on startup
        for profile in &initial_profiles {
            let file_path = PathBuf::from(&profile.file_path);
            if file_path.exists() {
                match std::fs::read_to_string(&file_path) {
                    Ok(yaml_content) => match Self::index_yaml_content(&profile.id, &profile.name, &yaml_content) {
                        Ok(entry) => {
                            index_map.insert(profile.id.clone(), entry);
                        }
                        Err(err) => {
                            warn!(
                                "Failed to parse profile '{}' ({}) YAML on startup: {}",
                                profile.name, profile.id, err
                            );
                        }
                    },
                    Err(err) => {
                        warn!(
                            "Failed to read profile '{}' ({}) from '{}': {}",
                            profile.name,
                            profile.id,
                            file_path.display(),
                            err
                        );
                    }
                }
            }
        }

        Self {
            profiles: Arc::new(RwLock::new(initial_profiles)),
            node_index: Arc::new(RwLock::new(index_map)),
            profiles_dir: Some(profiles_dir),
            metadata_path: Some(metadata_path),
            http_client,
        }
    }

    /// Creates an entirely in-memory ProfileManager without disk persistence, ideal for testing.
    pub fn new_in_memory() -> Self {
        let http_client = reqwest::Client::builder()
            .user_agent(DEFAULT_USER_AGENT)
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_default();

        Self {
            profiles: Arc::new(RwLock::new(Vec::new())),
            node_index: Arc::new(RwLock::new(HashMap::new())),
            profiles_dir: None,
            metadata_path: None,
            http_client,
        }
    }

    /// Helper to parse YAML content into structured ProxyNodes and raw proxies with runtime names
    pub fn index_yaml_content(
        profile_id: &str,
        profile_name: &str,
        yaml_content: &str,
    ) -> AppResult<ProfileNodeIndexEntry> {
        let mut nodes = parse_nodes_from_yaml(yaml_content)?;
        let mut node_names = HashSet::with_capacity(nodes.len());

        for node in &mut nodes {
            node.profile_id = Some(profile_id.to_string());
            node.profile_name = Some(profile_name.to_string());
            node.runtime_name = Some(format!("[{}] {}", profile_name, node.name));
            node_names.insert(node.name.clone());
        }

        let mut raw_proxies = Vec::new();
        if let Ok(extracted) = extract_raw_proxies_from_yaml(yaml_content) {
            for mut proxy in extracted {
                if let Some(map) = proxy.as_mapping_mut() {
                    let original_name = map
                        .get(serde_yaml_ng::Value::String("name".to_string()))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .trim()
                        .to_string();

                    if !original_name.is_empty() {
                        let runtime_name = format!("[{}] {}", profile_name, original_name);
                        map.insert(
                            serde_yaml_ng::Value::String("name".to_string()),
                            serde_yaml_ng::Value::String(runtime_name),
                        );
                        raw_proxies.push(proxy);
                    }
                }
            }
        }

        Ok(ProfileNodeIndexEntry {
            nodes,
            raw_proxies,
            node_names,
        })
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
        let metadata_path = match self.metadata_path {
            Some(ref path) => path,
            None => return Ok(()),
        };
        let profiles = self.profiles.read().clone();
        let json = serde_json::to_string_pretty(&profiles).map_err(AppError::Serialization)?;
        atomic_write_file(metadata_path, json.as_bytes())?;
        Ok(())
    }

    pub async fn fetch_remote_yaml(&self, url: &str) -> AppResult<String> {
        info!("Fetching remote subscription from: {}", url);
        let resp = self.http_client.get(url).send().await.map_err(AppError::Network)?;

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

    /// Add an in-memory profile without writing to disk, maintaining the node index.
    pub fn add_in_memory_profile(&self, name: String, yaml_content: &str) -> AppResult<ProfileItem> {
        let trimmed_name = name.trim().to_string();
        if trimmed_name.is_empty() {
            return Err(AppError::InvalidConfig("Profile name cannot be empty".to_string()));
        }

        let id = Uuid::new_v4().to_string();
        let entry = Self::index_yaml_content(&id, &trimmed_name, yaml_content)?;
        let node_count = entry.nodes.len();

        let item = ProfileItem {
            id: id.clone(),
            name: trimmed_name,
            profile_type: ProfileType::Local,
            url: None,
            file_path: format!("memory://profiles/{}.yaml", id),
            auto_update_interval_mins: 0,
            last_updated_at: current_unix_timestamp(),
            node_count,
        };

        {
            let mut guard = self.profiles.write();
            guard.push(item.clone());
        }
        {
            let mut index_guard = self.node_index.write();
            index_guard.insert(id, entry);
        }

        self.persist_metadata()?;
        info!(
            "In-memory profile '{}' added successfully with {} nodes",
            item.name, node_count
        );
        Ok(item)
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
        let id = Uuid::new_v4().to_string();
        let entry = Self::index_yaml_content(&id, &trimmed_name, &yaml_content)?;
        let node_count = entry.nodes.len();

        let file_path_str = if let Some(ref dir) = self.profiles_dir {
            let file_path = dir.join(format!("{}.yaml", id));
            atomic_write_file(&file_path, yaml_content.as_bytes())?;
            file_path.to_string_lossy().to_string()
        } else {
            format!("memory://profiles/{}.yaml", id)
        };

        let item = ProfileItem {
            id: id.clone(),
            name: trimmed_name,
            profile_type: ProfileType::Remote,
            url: Some(trimmed_url),
            file_path: file_path_str,
            auto_update_interval_mins,
            last_updated_at: current_unix_timestamp(),
            node_count,
        };

        {
            let mut guard = self.profiles.write();
            guard.push(item.clone());
        }
        {
            let mut index_guard = self.node_index.write();
            index_guard.insert(id, entry);
        }

        self.persist_metadata()?;
        info!(
            "Remote profile '{}' added successfully with {} nodes",
            item.name, node_count
        );
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
        let id = Uuid::new_v4().to_string();
        let entry = Self::index_yaml_content(&id, &trimmed_name, &yaml_content)?;
        let node_count = entry.nodes.len();

        let dest_file_str = if let Some(ref dir) = self.profiles_dir {
            let dest_file_path = dir.join(format!("{}.yaml", id));
            atomic_write_file(&dest_file_path, yaml_content.as_bytes())?;
            dest_file_path.to_string_lossy().to_string()
        } else {
            format!("memory://profiles/{}.yaml", id)
        };

        let item = ProfileItem {
            id: id.clone(),
            name: trimmed_name,
            profile_type: ProfileType::Local,
            url: None,
            file_path: dest_file_str,
            auto_update_interval_mins: 0,
            last_updated_at: current_unix_timestamp(),
            node_count,
        };

        {
            let mut guard = self.profiles.write();
            guard.push(item.clone());
        }
        {
            let mut index_guard = self.node_index.write();
            index_guard.insert(id, entry);
        }

        self.persist_metadata()?;
        info!(
            "Local profile '{}' imported successfully with {} nodes",
            item.name, node_count
        );
        Ok(item)
    }

    /// Update a profile with new YAML content, atomically persisting and updating the node index.
    pub fn update_profile_with_yaml(&self, id: &str, yaml_content: &str) -> AppResult<ProfileItem> {
        let existing = self
            .get_profile_by_id(id)
            .ok_or_else(|| AppError::ProfileNotFound(format!("Profile with ID '{}' not found", id)))?;

        let entry = Self::index_yaml_content(id, &existing.name, yaml_content)?;
        let node_count = entry.nodes.len();

        let target_file_path_str = if let Some(ref dir) = self.profiles_dir {
            let target_file_path = dir.join(format!("{}.yaml", id));
            atomic_write_file(&target_file_path, yaml_content.as_bytes())?;
            target_file_path.to_string_lossy().to_string()
        } else {
            existing.file_path.clone()
        };

        let updated_item = {
            let mut guard = self.profiles.write();
            let item = guard
                .iter_mut()
                .find(|p| p.id == id)
                .ok_or_else(|| AppError::ProfileNotFound(format!("Profile with ID '{}' not found", id)))?;

            item.last_updated_at = current_unix_timestamp();
            item.node_count = node_count;
            item.file_path = target_file_path_str;
            item.clone()
        };

        {
            let mut index_guard = self.node_index.write();
            index_guard.insert(id.to_string(), entry);
        }

        self.persist_metadata()?;
        info!(
            "Profile '{}' updated successfully, new node count: {}",
            updated_item.name, node_count
        );
        Ok(updated_item)
    }

    pub async fn update_profile(&self, id: &str) -> AppResult<ProfileItem> {
        let existing = self
            .get_profile_by_id(id)
            .ok_or_else(|| AppError::ProfileNotFound(format!("Profile with ID '{}' not found", id)))?;

        let yaml_content = match existing.profile_type {
            ProfileType::Remote => {
                let url = existing
                    .url
                    .as_deref()
                    .ok_or_else(|| AppError::InvalidConfig("Remote profile is missing URL".to_string()))?;
                self.fetch_remote_yaml(url).await?
            }
            ProfileType::Local => {
                let path = PathBuf::from(&existing.file_path);
                if !path.exists() {
                    return Err(AppError::InvalidConfig(format!(
                        "Local profile file missing: {}",
                        path.display()
                    )));
                }
                std::fs::read_to_string(&path).map_err(AppError::Io)?
            }
        };

        self.update_profile_with_yaml(id, &yaml_content)
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

        let (updated_item, name_changed) = {
            let mut guard = self.profiles.write();
            let item = guard
                .iter_mut()
                .find(|p| p.id == id)
                .ok_or_else(|| AppError::ProfileNotFound(format!("Profile with ID '{}' not found", id)))?;

            let name_changed = item.name != trimmed_name;
            item.name = trimmed_name.clone();
            if let Some(u) = url {
                let trimmed_url = u.trim().to_string();
                if !trimmed_url.is_empty() {
                    item.url = Some(trimmed_url);
                }
            }
            item.auto_update_interval_mins = auto_update_interval_mins;
            (item.clone(), name_changed)
        };

        if name_changed {
            let mut index_guard = self.node_index.write();
            if let Some(entry) = index_guard.get_mut(id) {
                for node in &mut entry.nodes {
                    node.profile_name = Some(trimmed_name.clone());
                    node.runtime_name = Some(format!("[{}] {}", trimmed_name, node.name));
                }
                for (node, proxy) in entry.nodes.iter().zip(entry.raw_proxies.iter_mut()) {
                    if let Some(map) = proxy.as_mapping_mut() {
                        let new_runtime_name = format!("[{}] {}", trimmed_name, node.name);
                        map.insert(
                            serde_yaml_ng::Value::String("name".to_string()),
                            serde_yaml_ng::Value::String(new_runtime_name),
                        );
                    }
                }
            }
        }

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
            // Purge cached nodes from in-memory index
            {
                let mut index_guard = self.node_index.write();
                index_guard.remove(id);
            }

            if let Some(ref dir) = self.profiles_dir {
                let target_path = dir.join(format!("{}.yaml", id));
                if target_path.exists() {
                    let _ = std::fs::remove_file(&target_path);
                }
            }
            let _ = self.persist_metadata();
            info!("Profile '{}' (ID: {}) deleted and purged from index", profile.name, id);
            Ok(())
        } else {
            Err(AppError::ProfileNotFound(format!("Profile with ID '{}' not found", id)))
        }
    }

    /// Instant in-memory retrieval of nodes for a profile
    pub fn get_profile_nodes(&self, id: &str) -> AppResult<Vec<ProxyNode>> {
        if !self.profiles.read().iter().any(|p| p.id == id) {
            return Err(AppError::ProfileNotFound(format!("Profile with ID '{}' not found", id)));
        }

        {
            let guard = self.node_index.read();
            if let Some(entry) = guard.get(id) {
                return Ok(entry.nodes.clone());
            }
        }

        // Fallback: if not yet cached, attempt to load once and index
        let profile = self.get_profile_by_id(id);
        if let Some(p) = profile {
            let file_path = PathBuf::from(&p.file_path);
            if file_path.exists()
                && let Ok(yaml_content) = std::fs::read_to_string(&file_path)
                && let Ok(entry) = Self::index_yaml_content(&p.id, &p.name, &yaml_content)
            {
                let nodes = entry.nodes.clone();
                let mut guard = self.node_index.write();
                guard.insert(id.to_string(), entry);
                return Ok(nodes);
            }
        }

        Ok(Vec::new())
    }

    /// Instant in-memory retrieval of all nodes across all profiles
    pub fn get_all_nodes(&self) -> Vec<ProxyNode> {
        let profiles = self.get_profiles();
        let guard = self.node_index.read();
        let mut all_nodes = Vec::new();

        for profile in profiles {
            if let Some(entry) = guard.get(&profile.id) {
                all_nodes.extend(entry.nodes.clone());
            }
        }

        all_nodes
    }

    /// Instant in-memory retrieval of raw proxies for runtime config generation
    pub fn get_raw_proxies_for_all_profiles(&self) -> Vec<serde_yaml_ng::Value> {
        let profiles = self.get_profiles();
        let guard = self.node_index.read();
        let mut all_proxies = Vec::new();
        let mut seen_runtime_names = HashSet::new();

        for profile in profiles {
            if let Some(entry) = guard.get(&profile.id) {
                for proxy in &entry.raw_proxies {
                    if let Some(map) = proxy.as_mapping() {
                        let runtime_name = map
                            .get(serde_yaml_ng::Value::String("name".to_string()))
                            .and_then(|v| v.as_str())
                            .unwrap_or("");

                        if !runtime_name.is_empty() && seen_runtime_names.insert(runtime_name.to_string()) {
                            all_proxies.push(proxy.clone());
                        }
                    }
                }
            }
        }

        all_proxies
    }

    /// O(1) in-memory check whether a node exists in a given profile
    pub fn has_node(&self, profile_id: &str, node_name: &str) -> bool {
        let guard = self.node_index.read();
        guard
            .get(profile_id)
            .map(|entry| entry.node_names.contains(node_name))
            .unwrap_or(false)
    }

    /// In-memory node name list for suggestion calculation
    pub fn get_profile_node_names(&self, profile_id: &str) -> Option<Vec<String>> {
        let guard = self.node_index.read();
        guard
            .get(profile_id)
            .map(|entry| entry.nodes.iter().map(|n| n.name.clone()).collect())
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
            .add_local_profile(
                "Test Local Profile".to_string(),
                source_file.to_string_lossy().to_string(),
            )
            .expect("Add local profile failed");

        assert_eq!(profile.name, "Test Local Profile");
        assert_eq!(profile.profile_type, ProfileType::Local);
        assert_eq!(profile.node_count, 4);
        assert!(profile.url.is_none());

        // 4. Retrieve nodes
        let nodes = manager
            .get_profile_nodes(&profile.id)
            .expect("Get profile nodes failed");
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

    #[test]
    fn test_in_memory_profile_node_index_and_zero_io_drift() {
        let manager = ProfileManager::new_in_memory();
        assert_eq!(manager.get_profiles().len(), 0);
        assert_eq!(manager.get_all_nodes().len(), 0);

        let profile = manager
            .add_in_memory_profile("PureMemory".to_string(), SAMPLE_CLASH_YAML)
            .expect("Add in-memory profile failed");

        assert_eq!(profile.name, "PureMemory");
        assert_eq!(profile.node_count, 4);

        // Instant in-memory query for profile nodes
        let nodes = manager
            .get_profile_nodes(&profile.id)
            .expect("Get profile nodes failed");
        assert_eq!(nodes.len(), 4);
        assert_eq!(nodes[0].name, "HK-Shadowsocks-01");
        assert_eq!(nodes[0].profile_id.as_deref(), Some(profile.id.as_str()));
        assert_eq!(nodes[0].profile_name.as_deref(), Some("PureMemory"));
        assert_eq!(nodes[0].runtime_name.as_deref(), Some("[PureMemory] HK-Shadowsocks-01"));

        // Instant in-memory query for all nodes
        let all_nodes = manager.get_all_nodes();
        assert_eq!(all_nodes.len(), 4);

        // Fast node lookup
        assert!(manager.has_node(&profile.id, "HK-Shadowsocks-01"));
        assert!(!manager.has_node(&profile.id, "NonExistentNode"));

        // Raw proxies extraction
        let raw_proxies = manager.get_raw_proxies_for_all_profiles();
        assert_eq!(raw_proxies.len(), 4);

        // Edit profile name updates runtime names in memory
        manager
            .edit_profile(&profile.id, "RenamedMemory".to_string(), None, 0)
            .expect("Edit profile failed");
        let updated_nodes = manager
            .get_profile_nodes(&profile.id)
            .expect("Get updated nodes failed");
        assert_eq!(updated_nodes[0].profile_name.as_deref(), Some("RenamedMemory"));
        assert_eq!(
            updated_nodes[0].runtime_name.as_deref(),
            Some("[RenamedMemory] HK-Shadowsocks-01")
        );

        // Update profile with new YAML
        let new_yaml = r#"
proxies:
  - name: "SG-Hysteria2-04"
    type: hysteria2
    server: 13.14.15.16
    port: 8443
"#;
        let updated_item = manager
            .update_profile_with_yaml(&profile.id, new_yaml)
            .expect("Update profile with yaml failed");
        assert_eq!(updated_item.node_count, 1);
        let new_nodes = manager.get_profile_nodes(&profile.id).expect("Get new nodes");
        assert_eq!(new_nodes.len(), 1);
        assert_eq!(new_nodes[0].name, "SG-Hysteria2-04");
        assert!(!manager.has_node(&profile.id, "HK-Shadowsocks-01"));
        assert!(manager.has_node(&profile.id, "SG-Hysteria2-04"));

        // Delete profile purges index
        manager.delete_profile(&profile.id).expect("Delete profile failed");
        assert_eq!(manager.get_all_nodes().len(), 0);
        assert!(manager.get_profile_nodes(&profile.id).is_err());
        assert!(!manager.has_node(&profile.id, "SG-Hysteria2-04"));
    }
}
