use crate::error::{AppError, AppResult};
use crate::models::{ProfileItem, ProfileType, ProxyNode, SubscriptionInfo};
use chrono::{Local, NaiveDate, NaiveDateTime, TimeZone};
use parking_lot::RwLock;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tracing::{error, info, warn};
use uuid::Uuid;

pub const DEFAULT_USER_AGENT: &str = crate::constants::APP_USER_AGENT;
const REQUEST_TIMEOUT_SECS: u64 = 25;

/// Helper to get the current Unix timestamp in seconds
fn current_unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_secs(0))
        .as_secs()
}

/// Parses Clash `Subscription-Userinfo` HTTP header value (`upload=...; download=...; total=...; expire=...`).
pub fn parse_subscription_userinfo_header(raw: &str) -> Option<SubscriptionInfo> {
    let mut info = SubscriptionInfo::default();

    for part in raw.split(';') {
        let trimmed = part.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Some((key, val)) = trimmed.split_once('=') else {
            continue;
        };
        let key_lower = key.trim().to_ascii_lowercase();
        let val_trimmed = val.trim();
        let parsed_num = val_trimmed.parse::<u64>().ok().or_else(|| {
            val_trimmed
                .parse::<f64>()
                .ok()
                .filter(|v| v.is_finite() && *v >= 0.0)
                .map(|v| v.round() as u64)
        });

        let Some(num) = parsed_num else {
            continue;
        };

        match key_lower.as_str() {
            "upload" => info.upload = Some(num),
            "download" => info.download = Some(num),
            "total" if num > 0 => info.total = Some(num),
            "expire" if num > 0 => info.expire_at = Some(num),
            _ => {}
        }
    }

    (!info.is_empty()).then_some(info)
}

fn parse_byte_size(text: &str) -> Option<u64> {
    let trimmed = text.trim();
    let mut num_end = 0usize;
    let mut seen_digit = false;
    let mut seen_dot = false;

    for (idx, ch) in trimmed.char_indices() {
        if ch.is_ascii_digit() {
            seen_digit = true;
            num_end = idx + ch.len_utf8();
        } else if ch == '.' && seen_digit && !seen_dot {
            seen_dot = true;
            num_end = idx + ch.len_utf8();
        } else {
            break;
        }
    }

    if !seen_digit {
        return None;
    }

    let value = trimmed[..num_end].parse::<f64>().ok()?;
    if !value.is_finite() || value < 0.0 {
        return None;
    }

    let unit_raw = trimmed[num_end..].trim();
    let unit: String = unit_raw
        .chars()
        .take_while(char::is_ascii_alphabetic)
        .collect::<String>()
        .to_ascii_lowercase();

    let multiplier: f64 = match unit.as_str() {
        "" | "b" | "bytes" => 1.0,
        "k" | "kb" | "kib" => 1024.0,
        "m" | "mb" | "mib" => 1024.0 * 1024.0,
        "g" | "gb" | "gib" => 1024.0 * 1024.0 * 1024.0,
        "t" | "tb" | "tib" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => return None,
    };

    Some((value * multiplier).round() as u64)
}

fn parse_first_u32(text: &str) -> Option<u32> {
    let start = text.find(|c: char| c.is_ascii_digit())?;
    let digits: String = text[start..].chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse::<u32>().ok()
}

fn naive_datetime_to_local_timestamp(dt: NaiveDateTime) -> u64 {
    let resolved = Local
        .from_local_datetime(&dt)
        .single()
        .or_else(|| Local.from_local_datetime(&dt).earliest())
        .map(|d| d.timestamp())
        .unwrap_or_else(|| dt.and_utc().timestamp());
    resolved.max(0) as u64
}

fn parse_expire_timestamp(text: &str) -> Option<u64> {
    let cleaned = text.trim().replace(['/', '.'], "-");
    let candidate = cleaned
        .split(|c: char| !(c.is_ascii_digit() || c == '-' || c == ':' || c == ' '))
        .next()
        .unwrap_or("")
        .trim();

    for fmt in ["%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"] {
        if let Ok(dt) = NaiveDateTime::parse_from_str(candidate, fmt) {
            return Some(naive_datetime_to_local_timestamp(dt));
        }
    }

    let date_token = candidate.split_whitespace().next().unwrap_or(candidate);
    if let Ok(date) = NaiveDate::parse_from_str(date_token, "%Y-%m-%d")
        && let Some(dt) = date.and_hms_opt(23, 59, 59)
    {
        return Some(naive_datetime_to_local_timestamp(dt));
    }

    None
}

fn extract_pseudo_node_kv(name: &str) -> Option<(String, String)> {
    let normalized = name.trim().replace('：', ":");
    let (key, val) = normalized.split_once(':')?;
    let k = key.trim().to_ascii_lowercase();
    let v = val.trim().to_string();
    if k.is_empty() || v.is_empty() {
        return None;
    }
    Some((k, v))
}

/// Extracts subscription quota, expiration, and reset info from YAML proxy pseudo-nodes.
pub fn parse_subscription_info_from_nodes(nodes: &[ProxyNode]) -> Option<SubscriptionInfo> {
    let mut info = SubscriptionInfo::default();

    for node in nodes {
        let Some((key, val)) = extract_pseudo_node_kv(&node.name) else {
            continue;
        };

        if key.contains("重置") || key.contains("reset") {
            if info.reset_days.is_none()
                && let Some(days) = parse_first_u32(&val)
            {
                info.reset_days = Some(days);
            }
            continue;
        }

        if key.contains("流量") || key.ends_with("剩余") || key.contains("remaining") || key == "traffic" {
            if info.remaining_bytes.is_none()
                && let Some(bytes) = parse_byte_size(&val)
            {
                info.remaining_bytes = Some(bytes);
            }
            continue;
        }

        if key.contains("到期") || key.contains("过期") || key.contains("有效期") || key.contains("expire") {
            let val_lower = val.to_ascii_lowercase();
            if val.contains("长期")
                || val.contains("永久")
                || val.contains("永不")
                || val.contains("无限")
                || val_lower.contains("never")
                || val_lower.contains("permanent")
                || val_lower.contains("lifetime")
            {
                if info.expire_at.is_none() {
                    info.never_expires = true;
                }
            } else if info.expire_at.is_none()
                && let Some(ts) = parse_expire_timestamp(&val)
            {
                info.expire_at = Some(ts);
                info.never_expires = false;
            }
        }
    }

    (!info.is_empty()).then_some(info)
}

/// Convenience wrapper to parse subscription info directly from Clash YAML text.
pub fn parse_subscription_info_from_yaml(yaml_content: &str) -> AppResult<Option<SubscriptionInfo>> {
    let nodes = parse_nodes_from_yaml(yaml_content)?;
    Ok(parse_subscription_info_from_nodes(&nodes))
}

/// Helper function to parse ProxyNode list from Clash YAML string
pub fn parse_nodes_from_yaml(yaml_content: &str) -> AppResult<Vec<ProxyNode>> {
    let root: serde_yaml_ng::Value = serde_yaml_ng::from_str(yaml_content).map_err(|err| {
        AppError::InvalidConfig(crate::tr!(
            format!("解析 YAML 失败: {err}"),
            format!("Failed to parse YAML: {err}"),
        ))
    })?;

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
    let root: serde_yaml_ng::Value = serde_yaml_ng::from_str(yaml_content).map_err(|err| {
        AppError::InvalidConfig(crate::tr!(
            format!("解析 YAML 失败: {err}"),
            format!("Failed to parse YAML: {err}"),
        ))
    })?;

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
    pub subscription_info: Option<SubscriptionInfo>,
}

struct TempFileCleanup {
    path: PathBuf,
    active: bool,
}

impl TempFileCleanup {
    fn new(path: PathBuf) -> Self {
        Self { path, active: true }
    }

    fn disarm(&mut self) {
        self.active = false;
    }
}

impl Drop for TempFileCleanup {
    fn drop(&mut self) {
        if self.active {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

/// Atomically write bytes to a file by writing to a sibling temporary file and renaming it.
pub fn atomic_write_file(path: &Path, content: &[u8]) -> AppResult<()> {
    // If file already exists and content is byte-for-byte identical, skip redundant write & rename
    if path.is_file()
        && let Ok(existing) = std::fs::read(path)
        && existing == content
    {
        return Ok(());
    }

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

    let mut cleanup = TempFileCleanup::new(temp_path.clone());

    std::fs::write(&temp_path, content).map_err(AppError::Io)?;

    let mut rename_result = std::fs::rename(&temp_path, path);
    if rename_result.is_err() {
        let _ = std::fs::remove_file(path);
        for attempt in 0..5 {
            rename_result = std::fs::rename(&temp_path, path);
            if rename_result.is_ok() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10 * (attempt + 1)));
        }
    }

    rename_result.map_err(AppError::Io)?;
    cleanup.disarm();
    Ok(())
}

/// Recursively sweep and clean any stale `.tmp_*` files left behind by interrupted writes or crashes.
pub fn clean_stale_temp_files(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file()
            && let Some(name) = path.file_name().and_then(|n| n.to_str())
            && name.starts_with(".tmp_")
        {
            let _ = std::fs::remove_file(&path);
        } else if path.is_dir()
            && let Ok(sub_entries) = std::fs::read_dir(&path)
        {
            for sub_entry in sub_entries.flatten() {
                let sub_path = sub_entry.path();
                if sub_path.is_file()
                    && let Some(name) = sub_path.file_name().and_then(|n| n.to_str())
                    && name.starts_with(".tmp_")
                {
                    let _ = std::fs::remove_file(&sub_path);
                }
            }
        }
    }
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

        let mut initial_profiles = Self::load_metadata(&metadata_path);
        let mut index_map = HashMap::new();
        let mut metadata_dirty = false;

        // Parse and index existing profile YAML files once on startup
        for profile in &mut initial_profiles {
            let file_path = PathBuf::from(&profile.file_path);
            if file_path.exists() {
                match std::fs::read_to_string(&file_path) {
                    Ok(yaml_content) => match Self::index_yaml_content(&profile.id, &profile.name, &yaml_content) {
                        Ok(entry) => {
                            if profile.subscription_info.is_none() && entry.subscription_info.is_some() {
                                profile.subscription_info = entry.subscription_info.clone();
                                metadata_dirty = true;
                            }
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

        let manager = Self {
            profiles: Arc::new(RwLock::new(initial_profiles)),
            node_index: Arc::new(RwLock::new(index_map)),
            profiles_dir: Some(profiles_dir),
            metadata_path: Some(metadata_path),
            http_client,
        };
        if metadata_dirty {
            let _ = manager.persist_metadata();
        }
        manager
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
        let subscription_info = parse_subscription_info_from_nodes(&nodes);
        let mut node_names = HashSet::with_capacity(nodes.len());

        for node in &mut nodes {
            node.profile_id = Some(profile_id.to_string());
            node.profile_name = Some(profile_name.to_string());
            node.runtime_name = Some(format!("[{}] {}", profile_name, node.name));
            if !node_names.insert(node.name.clone()) {
                return Err(AppError::InvalidConfig(crate::tr!(
                    format!("订阅中存在重复节点名称「{}」", node.name),
                    format!("Subscription contains a duplicate node name \"{}\"", node.name),
                )));
            }
        }

        let mut raw_proxies = extract_raw_proxies_from_yaml(yaml_content)?;
        let name_key = serde_yaml_ng::Value::String("name".to_string());
        let dialer_key = serde_yaml_ng::Value::String("dialer-proxy".to_string());
        let mut dialers = HashMap::new();
        for proxy in &raw_proxies {
            let Some(map) = proxy.as_mapping() else { continue };
            let Some(name) = map.get(&name_key).and_then(|value| value.as_str()) else {
                continue;
            };
            let Some(dialer) = map.get(&dialer_key) else { continue };
            let target = dialer
                .as_str()
                .map(str::trim)
                .filter(|target| !target.is_empty())
                .ok_or_else(|| {
                    AppError::InvalidConfig(crate::tr!(
                        format!("节点「{}」的 dialer-proxy 必须是非空节点名称", name),
                        format!("Node \"{}\" dialer-proxy must be a non-empty node name", name),
                    ))
                })?;
            if !node_names.contains(target) && target != "DIRECT" {
                return Err(AppError::InvalidConfig(crate::tr!(
                    format!(
                        "节点「{}」的 dialer-proxy「{}」不在本订阅节点中；仅支持节点间引用或 DIRECT，不支持代理组引用",
                        name, target
                    ),
                    format!(
                        "Node \"{}\" dialer-proxy \"{}\" is not a node in this subscription; only node-to-node references or DIRECT are supported, not proxy groups",
                        name, target
                    ),
                )));
            }
            dialers.insert(name.trim(), target);
        }
        let mut complete = HashSet::new();
        let mut active = HashSet::new();
        for &name in dialers.keys() {
            let mut current = name;
            while let Some(&next) = dialers.get(current) {
                if complete.contains(current) {
                    break;
                }
                if !active.insert(current) {
                    return Err(AppError::InvalidConfig(crate::tr!(
                        format!("节点「{}」存在循环 dialer-proxy 引用", name),
                        format!("Node \"{}\" has a circular dialer-proxy reference", name),
                    )));
                }
                if next == "DIRECT" {
                    break;
                }
                current = next;
            }
            complete.extend(active.drain());
        }
        raw_proxies.retain_mut(|proxy| {
            let Some(map) = proxy.as_mapping_mut() else {
                return false;
            };
            let Some(name) = map
                .get(&name_key)
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|name| !name.is_empty())
            else {
                return false;
            };
            let runtime_name = format!("[{}] {}", profile_name, name);
            if let Some(target) = map.get(&dialer_key).and_then(|value| value.as_str()).map(str::trim) {
                let runtime_target = if target == "DIRECT" {
                    target.to_string()
                } else {
                    format!("[{}] {}", profile_name, target)
                };
                map.insert(dialer_key.clone(), serde_yaml_ng::Value::String(runtime_target));
            }
            map.insert(name_key.clone(), serde_yaml_ng::Value::String(runtime_name));
            true
        });

        Ok(ProfileNodeIndexEntry {
            nodes,
            raw_proxies,
            node_names,
            subscription_info,
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

    pub async fn fetch_remote_yaml_with_info(&self, url: &str) -> AppResult<(String, Option<SubscriptionInfo>)> {
        info!("Fetching remote subscription from: {}", url);
        let resp = self.http_client.get(url).send().await.map_err(AppError::Network)?;

        if !resp.status().is_success() {
            return Err(AppError::InvalidConfig(format!(
                "HTTP request failed with status: {}",
                resp.status()
            )));
        }

        let header_info = resp
            .headers()
            .get("subscription-userinfo")
            .and_then(|value| value.to_str().ok())
            .and_then(parse_subscription_userinfo_header);
        let content = resp.text().await.map_err(AppError::Network)?;
        Ok((content, header_info))
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
            return Err(AppError::InvalidConfig(
                crate::tr!("订阅名称不能为空", "Profile name cannot be empty").to_string(),
            ));
        }

        let id = Uuid::new_v4().to_string();
        let entry = Self::index_yaml_content(&id, &trimmed_name, yaml_content)?;
        let node_count = entry.nodes.len();
        let subscription_info = entry.subscription_info.clone();

        let item = ProfileItem {
            id: id.clone(),
            name: trimmed_name,
            profile_type: ProfileType::Local,
            url: None,
            file_path: format!("memory://profiles/{}.yaml", id),
            auto_update_interval_mins: 0,
            last_updated_at: current_unix_timestamp(),
            node_count,
            subscription_info,
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
            return Err(AppError::InvalidConfig(
                crate::tr!("订阅名称不能为空", "Profile name cannot be empty").to_string(),
            ));
        }
        if trimmed_url.is_empty() {
            return Err(AppError::InvalidConfig(
                crate::tr!("订阅 URL 不能为空", "Subscription URL cannot be empty").to_string(),
            ));
        }

        let (yaml_content, header_info) = self.fetch_remote_yaml_with_info(&trimmed_url).await?;
        let id = Uuid::new_v4().to_string();
        let entry = Self::index_yaml_content(&id, &trimmed_name, &yaml_content)?;
        let node_count = entry.nodes.len();
        let subscription_info = SubscriptionInfo::merge(header_info, entry.subscription_info.clone());

        let file_path_str = if let Some(dir) = &self.profiles_dir {
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
            subscription_info,
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
            return Err(AppError::InvalidConfig(
                crate::tr!("订阅名称不能为空", "Profile name cannot be empty").to_string(),
            ));
        }
        if !source_path.exists() {
            return Err(AppError::InvalidConfig(crate::tr!(
                format!("源文件不存在: {}", source_path.display()),
                format!("Source file not found at: {}", source_path.display()),
            )));
        }

        let yaml_content = std::fs::read_to_string(&source_path).map_err(AppError::Io)?;
        let id = Uuid::new_v4().to_string();
        let entry = Self::index_yaml_content(&id, &trimmed_name, &yaml_content)?;
        let node_count = entry.nodes.len();
        let subscription_info = entry.subscription_info.clone();

        let dest_file_str = if let Some(dir) = &self.profiles_dir {
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
            subscription_info,
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
        self.update_profile_with_yaml_and_header(id, yaml_content, None)
    }

    fn update_profile_with_yaml_and_header(
        &self,
        id: &str,
        yaml_content: &str,
        header_info: Option<SubscriptionInfo>,
    ) -> AppResult<ProfileItem> {
        let existing = self.get_profile_by_id(id).ok_or_else(|| {
            AppError::ProfileNotFound(crate::tr!(
                format!("未找到 ID 为 '{}' 的订阅", id),
                format!("Profile with ID '{}' not found", id),
            ))
        })?;

        let entry = Self::index_yaml_content(id, &existing.name, yaml_content)?;
        let node_count = entry.nodes.len();
        let subscription_info = SubscriptionInfo::merge(header_info, entry.subscription_info.clone());

        let target_file_path_str = if let Some(dir) = &self.profiles_dir {
            let target_file_path = dir.join(format!("{}.yaml", id));
            atomic_write_file(&target_file_path, yaml_content.as_bytes())?;
            target_file_path.to_string_lossy().to_string()
        } else {
            existing.file_path.clone()
        };

        let updated_item = {
            let mut guard = self.profiles.write();
            let item = guard.iter_mut().find(|p| p.id == id).ok_or_else(|| {
                AppError::ProfileNotFound(crate::tr!(
                    format!("未找到 ID 为 '{}' 的订阅", id),
                    format!("Profile with ID '{}' not found", id),
                ))
            })?;

            item.last_updated_at = current_unix_timestamp();
            item.node_count = node_count;
            item.file_path = target_file_path_str;
            item.subscription_info = subscription_info;
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
        let existing = self.get_profile_by_id(id).ok_or_else(|| {
            AppError::ProfileNotFound(crate::tr!(
                format!("未找到 ID 为 '{}' 的订阅", id),
                format!("Profile with ID '{}' not found", id),
            ))
        })?;

        let (yaml_content, header_info) = match existing.profile_type {
            ProfileType::Remote => {
                let url = existing.url.as_deref().ok_or_else(|| {
                    AppError::InvalidConfig(crate::tr!("远程订阅缺少 URL", "Remote profile is missing URL").to_string())
                })?;
                self.fetch_remote_yaml_with_info(url).await?
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
                (content, None)
            }
        };

        self.update_profile_with_yaml_and_header(id, &yaml_content, header_info)
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
            return Err(AppError::InvalidConfig(
                crate::tr!("订阅名称不能为空", "Profile name cannot be empty").to_string(),
            ));
        }

        let (updated_item, name_changed) = {
            let mut guard = self.profiles.write();
            let item = guard.iter_mut().find(|p| p.id == id).ok_or_else(|| {
                AppError::ProfileNotFound(crate::tr!(
                    format!("未找到 ID 为 '{}' 的订阅", id),
                    format!("Profile with ID '{}' not found", id),
                ))
            })?;

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
                let previous_prefix = entry
                    .nodes
                    .first()
                    .and_then(|node| node.profile_name.as_deref())
                    .map(|name| format!("[{}] ", name));
                for node in &mut entry.nodes {
                    node.profile_name = Some(trimmed_name.clone());
                    node.runtime_name = Some(format!("[{}] {}", trimmed_name, node.name));
                }
                for (node, proxy) in entry.nodes.iter().zip(entry.raw_proxies.iter_mut()) {
                    if let Some(map) = proxy.as_mapping_mut() {
                        let dialer_key = serde_yaml_ng::Value::String("dialer-proxy".to_string());
                        if let Some(target) = map.get(&dialer_key).and_then(|value| value.as_str())
                            && let Some(name) = previous_prefix
                                .as_deref()
                                .and_then(|prefix| target.strip_prefix(prefix))
                            && entry.node_names.contains(name)
                        {
                            map.insert(
                                dialer_key,
                                serde_yaml_ng::Value::String(format!("[{}] {}", trimmed_name, name)),
                            );
                        }
                        if let Some(runtime_name) = &node.runtime_name {
                            map.insert(
                                serde_yaml_ng::Value::String("name".to_string()),
                                serde_yaml_ng::Value::String(runtime_name.clone()),
                            );
                        }
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
            Err(AppError::ProfileNotFound(crate::tr!(
                format!("未找到 ID 为 '{}' 的订阅", id),
                format!("Profile with ID '{}' not found", id),
            )))
        }
    }

    /// Instant in-memory retrieval of nodes for a profile
    pub fn get_profile_nodes(&self, id: &str) -> AppResult<Vec<ProxyNode>> {
        if !self.profiles.read().iter().any(|p| p.id == id) {
            return Err(AppError::ProfileNotFound(crate::tr!(
                format!("未找到 ID 为 '{}' 的订阅", id),
                format!("Profile with ID '{}' not found", id),
            )));
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
    #[test]
    fn imported_dialers_follow_subscription_namespace_and_renames() {
        let yaml = r#"
proxies:
  - {name: Exit, type: socks5, server: exit.example, port: 1080, username: test-user, password: fixture-credential, dialer-proxy: Relay}
  - {name: Relay, type: http, server: relay.example, port: 8080, dialer-proxy: DIRECT}
"#;
        let manager = ProfileManager::new_in_memory();
        let profile = manager
            .add_in_memory_profile("Airport A".to_string(), yaml)
            .expect("import chain");
        manager
            .add_in_memory_profile("Airport B".to_string(), yaml)
            .expect("import same names in another profile");
        let raw = manager.get_raw_proxies_for_all_profiles();
        assert_eq!(raw[0]["name"].as_str(), Some("[Airport A] Exit"));
        assert_eq!(raw[0]["dialer-proxy"].as_str(), Some("[Airport A] Relay"));
        assert_eq!(raw[0]["username"].as_str(), Some("test-user"));
        assert_eq!(raw[0]["password"].as_str(), Some("fixture-credential"));
        assert_eq!(raw[1]["dialer-proxy"].as_str(), Some("DIRECT"));
        assert_eq!(raw[2]["dialer-proxy"].as_str(), Some("[Airport B] Relay"));
        manager
            .edit_profile(&profile.id, "Renamed".to_string(), None, 0)
            .expect("rename profile");
        let renamed = manager.get_raw_proxies_for_all_profiles();
        assert_eq!(renamed[0]["dialer-proxy"].as_str(), Some("[Renamed] Relay"));
        manager
            .update_profile_with_yaml(&profile.id, yaml)
            .expect("refresh chain");
        assert_eq!(
            manager.get_raw_proxies_for_all_profiles()[0]["dialer-proxy"].as_str(),
            Some("[Renamed] Relay")
        );
    }

    #[test]
    fn imported_dialers_reject_missing_groups_cycles_and_invalid_targets() {
        for (yaml, message) in [
            ("proxies: [{name: Exit, dialer-proxy: Missing}]", "不在本订阅节点中"),
            (
                "proxies: [{name: Exit, dialer-proxy: Group}]\nproxy-groups: [{name: Group, type: select, proxies: [DIRECT]}]",
                "不支持代理组引用",
            ),
            (
                "proxies: [{name: A, dialer-proxy: B}, {name: B, dialer-proxy: A}]",
                "循环",
            ),
            ("proxies: [{name: A, dialer-proxy: A}]", "循环"),
            ("proxies: [{name: A, dialer-proxy: 123}]", "非空节点名称"),
            ("proxies: [{name: A, dialer-proxy: ''}]", "非空节点名称"),
            ("proxies: [{name: A}, {name: A}]", "重复节点名称"),
        ] {
            let error =
                ProfileManager::index_yaml_content("p", "Airport", yaml).expect_err("invalid chain is rejected");
            assert!(error.to_string().contains(message), "unexpected error: {error}");
        }
    }
    #[test]
    fn imported_direct_dialer_retains_builtin_semantics() {
        let yaml = "proxies: [{name: DIRECT, dialer-proxy: DIRECT}, {name: Exit, dialer-proxy: ' DIRECT '}]";
        let indexed = ProfileManager::index_yaml_content("p", "Airport", yaml).expect("built in direct references");
        assert_eq!(indexed.raw_proxies[0]["name"].as_str(), Some("[Airport] DIRECT"));
        assert_eq!(indexed.raw_proxies[0]["dialer-proxy"].as_str(), Some("DIRECT"));
        assert_eq!(indexed.raw_proxies[1]["dialer-proxy"].as_str(), Some("DIRECT"));
    }
    #[test]
    fn parses_subscription_userinfo_header() {
        let raw = "upload=9823718108; download=37604665872; total=322122547200; expire=1802234215";
        let info = parse_subscription_userinfo_header(raw).expect("header should parse");
        assert_eq!(info.upload, Some(9_823_718_108));
        assert_eq!(info.download, Some(37_604_665_872));
        assert_eq!(info.total, Some(322_122_547_200));
        assert_eq!(info.expire_at, Some(1_802_234_215));
        assert!(!info.never_expires);

        let zero_meta = parse_subscription_userinfo_header("upload=0; download=0; total=0; expire=0")
            .expect("upload/download still retained");
        assert_eq!(zero_meta.total, None);
        assert_eq!(zero_meta.expire_at, None);
        assert!(parse_subscription_userinfo_header("invalid-header").is_none());
    }

    #[test]
    fn parses_yaml_pseudo_nodes_for_traffic_reset_and_expiry() {
        let yaml_saibo = r#"
proxies:
  - { name: '剩余流量：520 GB', type: tuic, server: example.com, port: 443 }
  - { name: '距离下次重置剩余：30 天', type: tuic, server: example.com, port: 443 }
  - { name: 套餐到期：2026-12-20, type: tuic, server: example.com, port: 443 }
  - { name: '台湾-节点1', type: tuic, server: example.com, port: 443 }
"#;
        let info = parse_subscription_info_from_yaml(yaml_saibo)
            .expect("yaml should parse")
            .expect("subscription info expected");
        assert_eq!(info.remaining_bytes, Some(520 * 1024 * 1024 * 1024));
        assert_eq!(info.reset_days, Some(30));
        assert!(info.expire_at.is_some());
        assert!(!info.never_expires);

        let yaml_mojie = r#"
proxies:
  - { name: '香港-节点1', type: vmess, server: example.com, port: 443 }
  - { name: '剩余流量：121.72 GB', type: vmess, server: example.com, port: 443 }
  - { name: 套餐到期：长期有效, type: vmess, server: example.com, port: 443 }
  - { name: 过滤掉14条线路, type: vmess, server: example.com, port: 443 }
"#;
        let mojie_info = parse_subscription_info_from_yaml(yaml_mojie)
            .expect("yaml should parse")
            .expect("mojie subscription info expected");
        assert_eq!(
            mojie_info.remaining_bytes,
            Some((121.72_f64 * 1024.0 * 1024.0 * 1024.0).round() as u64)
        );
        assert!(mojie_info.never_expires);
        assert_eq!(mojie_info.expire_at, None);
    }

    #[test]
    fn startup_backfills_subscription_info_from_existing_yaml_preserving_all_nodes() {
        let temp_dir = std::env::temp_dir().join(format!("mihomo_test_sub_backfill_{}", Uuid::new_v4()));
        let profiles_dir = temp_dir.join("profiles");
        std::fs::create_dir_all(&profiles_dir).expect("create profiles dir");

        let yaml_path = profiles_dir.join("sub-1.yaml");
        std::fs::write(
            &yaml_path,
            "proxies:\n  - { name: '剩余流量：100 GB', type: ss, server: 1.1.1.1, port: 443 }\n  - { name: '套餐到期：长期有效', type: ss, server: 1.1.1.1, port: 443 }\n  - { name: 'HK-01', type: ss, server: 1.1.1.1, port: 443 }\n",
        )
        .expect("write yaml");

        let legacy_json = serde_json::json!([{
            "id": "sub-1",
            "name": "Legacy",
            "type": "remote",
            "url": "https://example.com/sub",
            "filePath": yaml_path.to_string_lossy(),
            "autoUpdateIntervalMins": 60,
            "lastUpdatedAt": 1_700_000_000_u64,
            "nodeCount": 3
        }]);
        std::fs::write(
            temp_dir.join("profiles.json"),
            serde_json::to_string_pretty(&legacy_json).expect("serialize legacy"),
        )
        .expect("write legacy metadata");

        let manager = ProfileManager::new(temp_dir.clone());
        let profiles = manager.get_profiles();
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].node_count, 3);
        let info = profiles[0]
            .subscription_info
            .as_ref()
            .expect("backfilled subscription info");
        assert_eq!(info.remaining_bytes, Some(100 * 1024 * 1024 * 1024));
        assert!(info.never_expires);
        assert_eq!(manager.get_profile_nodes("sub-1").expect("nodes retained").len(), 3);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
