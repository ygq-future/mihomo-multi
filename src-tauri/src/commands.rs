use crate::core::auto_updater::AutoUpdater;
use crate::core::drift_guard::DriftGuard;
use crate::core::port_probe::is_port_available;
use crate::models::{
    AppConfig, AppStatus, AutoUpdateEventPayload, AutoUpdaterStatus, CoreStatus, DriftStatus,
    LanIpInfo, NodeLatencyResult, PortDriftReport, PortFallbackStatus, PortMapping, ProfileItem, ProxyNode,
};
use crate::state::AppState;
use std::process::Command;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub async fn get_app_status(state: State<'_, AppState>) -> Result<AppStatus, String> {
    let core = state.supervisor.get_status();
    let profiles = state.profile_manager.get_profiles();
    let total_profiles = profiles.len();
    let total_nodes = profiles.iter().map(|p| p.node_count).sum();

    let port_mappings = state.port_manager.get_port_mappings();
    let total_ports = port_mappings.len();
    let active_ports = port_mappings.iter().filter(|p| p.enabled).count();

    Ok(AppStatus {
        core,
        total_ports,
        active_ports,
        total_profiles,
        total_nodes,
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

#[tauri::command]
pub async fn get_core_status(state: State<'_, AppState>) -> Result<CoreStatus, String> {
    Ok(state.supervisor.get_status())
}

#[tauri::command]
pub async fn start_core(app: AppHandle, state: State<'_, AppState>) -> Result<CoreStatus, String> {
    let _ = state.sync_runtime_config().await;
    let config = state.config.read().clone();
    state.supervisor.start(&app, &config).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn stop_core(state: State<'_, AppState>) -> Result<(), String> {
    state.supervisor.stop().map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn restart_core(app: AppHandle, state: State<'_, AppState>) -> Result<CoreStatus, String> {
    let _ = state.sync_runtime_config().await;
    let config = state.config.read().clone();
    state.supervisor.restart(&app, &config).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn check_port_available(
    port: u16,
    exclude_mapping_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    // 1. Check if the port is already used in our own port mappings
    let mappings = state.port_manager.get_port_mappings();
    for m in mappings {
        if m.port == port {
            if let Some(ref eid) = exclude_mapping_id
                && &m.id == eid
            {
                continue; // Skip self if editing
            }
            // Already bound by ourselves, return false immediately
            return Ok(false);
        }
    }

    // 2. Check if it matches our controller port
    if port == state.config.read().controller_port {
        return Ok(false);
    }

    // 3. Perform socket bind probe accounting for allow_lan setting and excluding own core PID
    let allow_lan = state.config.read().allow_lan;
    let core_status = state.supervisor.get_status();
    let my_core_pid = if core_status.running { core_status.pid } else { None };
    Ok(crate::core::port_probe::is_port_available_with_lan(port, allow_lan, my_core_pid))
}

#[tauri::command]
pub async fn get_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    Ok(state.config.read().clone())
}

#[tauri::command]
pub async fn save_config(config: AppConfig, state: State<'_, AppState>) -> Result<(), String> {
    let old_port = state.config.read().controller_port;
    if config.controller_port != old_port {
        let core_status = state.supervisor.get_status();
        // Check if the target port is currently held by our own running core (ABA scenario / revert to active port)
        let is_current_active_core_port =
            core_status.running && core_status.controller_port == config.controller_port;

        if !is_current_active_core_port {
            // 1. Probe if the new controller port is available on localhost
            if !is_port_available(config.controller_port) {
                return Err(format!(
                    "端口 {} 已被本地其他应用程序占用，无法设为控制器端口，请换用其他端口（如 9090）。",
                    config.controller_port
                ));
            }

            // 2. Check if any active port mapping already uses this port
            let mappings = state.port_manager.get_port_mappings();
            if mappings.iter().any(|m| m.port == config.controller_port && m.enabled) {
                return Err(format!(
                    "端口 {} 已在「端口映射」中作为代理入站端口使用，请换用其他端口。",
                    config.controller_port
                ));
            }
        }
    }

    *state.config.write() = config.clone();
    let config_path = state.app_dir.join("config.json");
    if let Ok(json) = serde_json::to_string_pretty(&config) {
        let _ = std::fs::write(config_path, json);
    }

    // Sync Windows autostart configuration
    if let Ok(exe_path) = std::env::current_exe() {
        if config.auto_launch {
            let _ = crate::core::autostart::enable_autostart(&exe_path, config.silent_start);
        } else {
            let _ = crate::core::autostart::disable_autostart();
        }
    }

    let _ = state.sync_runtime_config().await;
    Ok(())
}

// ----------------------------------------------------------------------------
// Port Mapping Management Commands
// ----------------------------------------------------------------------------

#[tauri::command]
pub async fn get_port_mappings(state: State<'_, AppState>) -> Result<Vec<PortMapping>, String> {
    Ok(state.port_manager.get_port_mappings())
}

#[tauri::command]
pub async fn get_occupied_ports(state: State<'_, AppState>) -> Result<Vec<u16>, String> {
    Ok(state.occupied_ports.read().iter().copied().collect())
}

#[tauri::command]
pub async fn get_next_available_port(
    start_port: Option<u16>,
    exclude_mapping_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<u16, String> {
    let start = start_port.unwrap_or(7891);
    let allow_lan = state.config.read().allow_lan;
    let controller_port = state.config.read().controller_port;
    let mappings = state.port_manager.get_port_mappings();

    let core_status = state.supervisor.get_status();
    let my_core_pid = if core_status.running { core_status.pid } else { None };

    let used_ports: std::collections::HashSet<u16> = mappings
        .into_iter()
        .filter(|m| {
            if let Some(ref eid) = exclude_mapping_id {
                &m.id != eid
            } else {
                true
            }
        })
        .map(|m| m.port)
        .collect();

    for candidate in start..=u16::MAX {
        // 1. Check if used in our own port mappings
        if used_ports.contains(&candidate) {
            continue;
        }

        // 2. Check if equals controller port
        if candidate == controller_port {
            continue;
        }

        // 3. Check socket availability accounting for allow_lan and excluding own core PID
        if !crate::core::port_probe::is_port_available_with_lan(candidate, allow_lan, my_core_pid) {
            continue;
        }

        // Found 100% available port
        return Ok(candidate);
    }

    Err("未能在可用范围内找到空闲端口".to_string())
}

#[tauri::command]
pub async fn save_port_mapping(
    mapping: PortMapping,
    state: State<'_, AppState>,
) -> Result<PortMapping, String> {
    // 1:1 Strict Node Binding Invariant: A node can only be bound by a single port listener
    let mappings = state.port_manager.get_port_mappings();
    for m in &mappings {
        if m.profile_id == mapping.profile_id && m.node_name == mapping.node_name {
            if !mapping.id.is_empty() && m.id == mapping.id {
                continue; // Skip self if editing
            }
            return Err(format!(
                "代理节点「{}」已绑定到端口 {}，不可重复绑定至其他端口",
                mapping.node_name, m.port
            ));
        }
    }

    let saved = state
        .port_manager
        .save_port_mapping(mapping)
        .map_err(|err| err.to_string())?;
    let _ = state.sync_runtime_config().await;
    Ok(saved)
}

#[tauri::command]
pub async fn delete_port_mapping(id: String, state: State<'_, AppState>) -> Result<(), String> {
    state
        .port_manager
        .delete_port_mapping(&id)
        .map_err(|err| err.to_string())?;
    let _ = state.sync_runtime_config().await;
    Ok(())
}

#[tauri::command]
pub async fn toggle_port_mapping(
    id: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<PortMapping, String> {
    let toggled = state
        .port_manager
        .toggle_port_mapping(&id, enabled)
        .map_err(|err| err.to_string())?;
    let _ = state.sync_runtime_config().await;
    Ok(toggled)
}

#[tauri::command]
pub async fn test_port_mapping_delay(
    id: String,
    test_url: Option<String>,
    timeout_ms: Option<u32>,
    state: State<'_, AppState>,
) -> Result<u32, String> {
    let status = state.supervisor.get_status();
    if !status.running {
        return Err("Mihomo 内核未运行，请在设置中启动内核后再进行测速".to_string());
    }

    let mapping = state
        .port_manager
        .get_port_mapping_by_id(&id)
        .ok_or_else(|| format!("未找到 ID 为 '{}' 的端口映射", id))?;

    let profile = state.profile_manager.get_profile_by_id(&mapping.profile_id);
    let runtime_name = if let Some(prof) = profile {
        format!("[{}] {}", prof.name, mapping.node_name)
    } else {
        mapping.node_name.clone()
    };
    let (default_url, default_timeout) = {
        let cfg = state.config.read();
        (cfg.test_url.clone(), cfg.timeout_ms)
    };
    let actual_url = test_url.as_deref().unwrap_or(&default_url);
    let actual_timeout = timeout_ms.unwrap_or(default_timeout);

    let client = state.clash_client();
    let res = client
        .test_delay(&runtime_name, Some(actual_url), Some(actual_timeout))
        .await;
    match res {
        Ok(delay) => {
            let _ = state.port_manager.update_port_latency(&id, Some(delay));
            Ok(delay)
        }
        Err(err) => {
            let _ = state.port_manager.update_port_latency(&id, None);
            Err(err.to_string())
        }
    }
}

#[tauri::command]
pub async fn test_all_port_mappings_delay(
    test_url: Option<String>,
    timeout_ms: Option<u32>,
    concurrency: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<NodeLatencyResult>, String> {
    let status = state.supervisor.get_status();
    if !status.running {
        return Err("Mihomo 内核未运行，请在设置中启动内核后再进行测速".to_string());
    }

    let mappings = state.port_manager.get_port_mappings();
    if mappings.is_empty() {
        return Ok(Vec::new());
    }

    let profiles = state.profile_manager.get_profiles();
    let profile_map: std::collections::HashMap<String, String> = profiles
        .into_iter()
        .map(|p| (p.id, p.name))
        .collect();

    let mut names_to_test = Vec::new();
    let mut main_mapping_indices = Vec::new();

    for m in &mappings {
        let runtime_name = if let Some(pname) = profile_map.get(&m.profile_id) {
            format!("[{}] {}", pname, m.node_name)
        } else {
            m.node_name.clone()
        };
        let idx = names_to_test.len();
        names_to_test.push(runtime_name);
        main_mapping_indices.push((m.id.clone(), idx));

        if let Some(fb_name) = &m.fallback_node_name
            && !fb_name.trim().is_empty()
        {
            let fb_runtime_name = if let Some(pname) = profile_map.get(&m.profile_id) {
                format!("[{}] {}", pname, fb_name)
            } else {
                fb_name.clone()
            };
            names_to_test.push(fb_runtime_name);
        }
    }
    let (default_url, default_timeout) = {
        let cfg = state.config.read();
        (cfg.test_url.clone(), cfg.timeout_ms)
    };
    let actual_url = test_url.as_deref().unwrap_or(&default_url);
    let actual_timeout = timeout_ms.unwrap_or(default_timeout);

    let client = state.clash_client();
    let results = client
        .test_nodes_delay_batch(&names_to_test, Some(actual_url), Some(actual_timeout), concurrency)
        .await;
    // Update latencies back into port_manager for main nodes
    for (mapping_id, idx) in main_mapping_indices {
        if let Some(res) = results.get(idx) {
            let _ = state
                .port_manager
                .update_port_latency(&mapping_id, res.latency);
        }
    }

    Ok(results)
}

#[tauri::command]
pub async fn get_port_fallback_statuses(
    state: State<'_, AppState>,
) -> Result<Vec<PortFallbackStatus>, String> {
    let status = state.supervisor.get_status();
    if !status.running {
        return Ok(Vec::new());
    }

    let mappings = state.port_manager.get_port_mappings();
    let profiles = state.profile_manager.get_profiles();
    let profile_map: std::collections::HashMap<String, String> = profiles
        .into_iter()
        .map(|p| (p.id, p.name))
        .collect();

    let client = state.clash_client();
    let mut statuses = Vec::new();
    let now_ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    for m in mappings
        .into_iter()
        .filter(|m| m.enabled && m.fallback_node_name.is_some())
    {
        let fallback_node = match &m.fallback_node_name {
            Some(fb) if !fb.trim().is_empty() => fb.clone(),
            _ => continue,
        };

        let group_name = format!("fb-{}", m.port);
        if let Ok(detail) = client.get_proxy_detail(&group_name).await {
            let active_node = detail.now.clone().unwrap_or_default();
            let is_fallback_active = active_node.ends_with(&fallback_node);

            let primary_runtime_name = if let Some(pname) = profile_map.get(&m.profile_id) {
                format!("[{}] {}", pname, m.node_name)
            } else {
                m.node_name.clone()
            };

            let fb_runtime_name = if let Some(pname) = profile_map.get(&m.profile_id) {
                format!("[{}] {}", pname, fallback_node)
            } else {
                fallback_node.clone()
            };

            let primary_latency = client
                .get_proxy_detail(&primary_runtime_name)
                .await
                .ok()
                .and_then(|p| p.history.last().map(|h| h.delay))
                .filter(|&d| d > 0);

            let fallback_latency = client
                .get_proxy_detail(&fb_runtime_name)
                .await
                .ok()
                .and_then(|p| p.history.last().map(|h| h.delay))
                .filter(|&d| d > 0);

            // Keep port manager latency in sync with kernel health check
            if primary_latency.is_some() || is_fallback_active {
                let _ = state.port_manager.update_port_latency(&m.id, primary_latency);
            }

            statuses.push(PortFallbackStatus {
                mapping_id: m.id,
                port: m.port,
                primary_node: m.node_name,
                fallback_node,
                active_node,
                is_fallback_active,
                primary_latency,
                fallback_latency,
                last_updated: now_ts,
            });
        }
    }

    Ok(statuses)
}

// ----------------------------------------------------------------------------
// Profile Management Commands
// ----------------------------------------------------------------------------

#[tauri::command]
pub async fn get_profiles(state: State<'_, AppState>) -> Result<Vec<ProfileItem>, String> {
    Ok(state.profile_manager.get_profiles())
}

#[tauri::command]
pub async fn add_remote_profile(
    name: String,
    url: String,
    interval_mins: u32,
    state: State<'_, AppState>,
) -> Result<ProfileItem, String> {
    let item = state
        .profile_manager
        .add_remote_profile(name, url, interval_mins)
        .await
        .map_err(|err| err.to_string())?;
    let _ = state.sync_runtime_config().await;
    Ok(item)
}

#[tauri::command]
pub async fn add_local_profile(
    name: String,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<ProfileItem, String> {
    let item = state
        .profile_manager
        .add_local_profile(name, file_path)
        .map_err(|err| err.to_string())?;
    let _ = state.sync_runtime_config().await;
    Ok(item)
}

#[tauri::command]
pub async fn update_profile(
    id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ProfileItem, String> {
    let item = state
        .profile_manager
        .update_profile(&id)
        .await
        .map_err(|err| err.to_string())?;
    let _ = state.sync_runtime_config().await;

    let mappings = state.port_manager.get_port_mappings();
    let drift_reports = DriftGuard::check_all(&mappings, &state.profile_manager);
    let has_drift = drift_reports
        .iter()
        .any(|r| r.profile_id == id && r.status != DriftStatus::Healthy);
    if has_drift {
        let _ = app.emit("node-drift-detected", &drift_reports);
    }

    Ok(item)
}

#[tauri::command]
pub async fn edit_profile(
    id: String,
    name: String,
    url: Option<String>,
    interval_mins: u32,
    state: State<'_, AppState>,
) -> Result<ProfileItem, String> {
    let item = state
        .profile_manager
        .edit_profile(&id, name, url, interval_mins)
        .map_err(|err| err.to_string())?;
    let _ = state.sync_runtime_config().await;
    Ok(item)
}

#[tauri::command]
pub async fn delete_profile(
    id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .profile_manager
        .delete_profile(&id)
        .map_err(|err| err.to_string())?;
    let _ = state.sync_runtime_config().await;

    let mappings = state.port_manager.get_port_mappings();
    let drift_reports = DriftGuard::check_all(&mappings, &state.profile_manager);
    let has_drift = drift_reports
        .iter()
        .any(|r| r.status != DriftStatus::Healthy);
    if has_drift {
        let _ = app.emit("node-drift-detected", &drift_reports);
    }

    Ok(())
}

#[tauri::command]
pub async fn get_drift_reports(state: State<'_, AppState>) -> Result<Vec<PortDriftReport>, String> {
    let mappings = state.port_manager.get_port_mappings();
    let reports = DriftGuard::check_all(&mappings, &state.profile_manager);
    Ok(reports)
}

#[tauri::command]
pub async fn get_auto_updater_status(
    state: State<'_, AppState>,
) -> Result<AutoUpdaterStatus, String> {
    Ok(state.auto_updater.get_status(&state))
}

#[tauri::command]
pub async fn trigger_auto_update_check(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<AutoUpdateEventPayload>, String> {
    let results = AutoUpdater::check_and_update_eligible_profiles(&app, &state).await;
    Ok(results)
}

#[tauri::command]
pub async fn get_profile_nodes(profile_id: String, state: State<'_, AppState>) -> Result<Vec<ProxyNode>, String> {
    state
        .profile_manager
        .get_profile_nodes(&profile_id)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn open_app_data_dir(state: State<'_, AppState>) -> Result<(), String> {
    let dir = &state.app_dir;
    if !dir.exists() {
        std::fs::create_dir_all(dir).map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn open_file_in_folder(file_path: String) -> Result<(), String> {
    let path = std::path::PathBuf::from(&file_path);
    if !path.exists() {
        return Err(format!("File does not exist: {}", file_path));
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(format!("/select,{}", path.display()))
            .spawn()
            .map_err(|e| format!("Failed to open explorer: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open finder: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        let parent = path.parent().unwrap_or(&path);
        Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_app_dir(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.app_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn get_lan_ip_addresses() -> Result<Vec<LanIpInfo>, String> {
    let networks = sysinfo::Networks::new_with_refreshed_list();
    let mut result = Vec::new();
    let mut seen_ips = std::collections::HashSet::new();

    for (interface_name, net_data) in &networks {
        for ip_network in net_data.ip_networks() {
            if let std::net::IpAddr::V4(ipv4) = ip_network.addr {
                // Filter out standard loopback (127.0.0.0/8), link-local APIPA (169.254.0.0/16), unspecified (0.0.0.0), broadcast (255.255.255.255)
                if !ipv4.is_loopback()
                    && !ipv4.is_link_local()
                    && !ipv4.is_unspecified()
                    && !ipv4.is_broadcast()
                {
                    let ip_str = ipv4.to_string();
                    if seen_ips.insert(ip_str.clone()) {
                        result.push(LanIpInfo {
                            ip: ip_str,
                            name: interface_name.to_string(),
                        });
                    }
                }
            }
        }
    }

    // Sort to give predictable and friendly ordering: WLAN / Ethernet first, then virtual/wsl/other interfaces
    result.sort_by(|a, b| {
        let a_priority = get_interface_priority(&a.name);
        let b_priority = get_interface_priority(&b.name);
        a_priority.cmp(&b_priority).then_with(|| a.ip.cmp(&b.ip))
    });

    Ok(result)
}

fn get_interface_priority(name: &str) -> u8 {
    let lower = name.to_lowercase();
    if lower.contains("wlan") || lower.contains("wi-fi") || lower.contains("wifi") {
        1
    } else if lower.contains("eth") || lower.contains("以太网") || lower.contains("en") {
        2
    } else {
        3
    }
}

#[tauri::command]
pub async fn get_all_nodes(state: State<'_, AppState>) -> Result<Vec<ProxyNode>, String> {
    Ok(state.profile_manager.get_all_nodes())
}

#[tauri::command]
pub async fn test_node_delay(
    node_name: String,
    test_url: Option<String>,
    timeout_ms: Option<u32>,
    state: State<'_, AppState>,
) -> Result<u32, String> {
    let status = state.supervisor.get_status();
    if !status.running {
        return Err("Mihomo 内核未运行，请在设置中启动内核后再进行测速".to_string());
    }

    let (default_url, default_timeout) = {
        let cfg = state.config.read();
        (cfg.test_url.clone(), cfg.timeout_ms)
    };
    let actual_url = test_url.as_deref().unwrap_or(&default_url);
    let actual_timeout = timeout_ms.unwrap_or(default_timeout);

    let client = state.clash_client();
    client
        .test_delay(&node_name, Some(actual_url), Some(actual_timeout))
        .await
        .map_err(|err| err.to_string())
}
#[tauri::command]
pub async fn test_nodes_delay_batch(
    node_names: Vec<String>,
    test_url: Option<String>,
    timeout_ms: Option<u32>,
    concurrency: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<NodeLatencyResult>, String> {
    let status = state.supervisor.get_status();
    if !status.running {
        return Err("Mihomo 内核未运行，请在设置中启动内核后再进行测速".to_string());
    }

    let (default_url, default_timeout) = {
        let cfg = state.config.read();
        (cfg.test_url.clone(), cfg.timeout_ms)
    };
    let actual_url = test_url.as_deref().unwrap_or(&default_url);
    let actual_timeout = timeout_ms.unwrap_or(default_timeout);

    let client = state.clash_client();
    let results = client
        .test_nodes_delay_batch(&node_names, Some(actual_url), Some(actual_timeout), concurrency)
        .await;
    Ok(results)
}
