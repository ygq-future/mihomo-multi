use crate::core::auto_updater::AutoUpdater;
use crate::core::drift_guard::DriftGuard;
use crate::core::port_probe::is_port_available;
use crate::models::{
    AppConfig, AppStatus, AutoUpdateEventPayload, AutoUpdaterStatus, CoreStatus, DriftStatus, LanIpInfo,
    NodeLatencyResult, PortDriftReport, PortFallbackStatus, PortMapping, ProfileItem, ProxyNode, SystemProxyStatus,
    UwpLoopbackStats,
};
use crate::state::AppState;
use std::process::Command;
use tauri::{AppHandle, Emitter, Manager, State};

#[tauri::command]
pub async fn get_app_status(state: State<'_, AppState>) -> Result<AppStatus, String> {
    let core = state.engine.get_status();
    let profiles = state.profile_manager.get_profiles();
    let total_profiles = profiles.len();
    let total_nodes = profiles.iter().map(|p| p.node_count).sum();

    let port_mappings = state.port_router.get_port_mappings();
    let total_ports = port_mappings.len();
    let active_ports = port_mappings.iter().filter(|p| p.enabled).count();

    Ok(AppStatus {
        core,
        total_ports,
        active_ports,
        total_profiles,
        total_nodes,
        version: crate::constants::APP_VERSION.to_string(),
    })
}

#[tauri::command]
pub async fn get_core_status(state: State<'_, AppState>) -> Result<CoreStatus, String> {
    Ok(state.engine.get_status())
}

#[tauri::command]
pub async fn start_core(app: AppHandle, state: State<'_, AppState>) -> Result<CoreStatus, String> {
    let _ = state.sync_runtime_config().await;
    let config = state.config.read().clone();
    let res = state.engine.start(Some(&app), &config).map_err(|err| err.to_string())?;
    if config.system_proxy_enabled
        && let Some(port) = config.system_proxy_port
    {
        let _ = crate::core::sysproxy::apply_system_proxy(
            port,
            &config.system_proxy_bypass_user,
            config.system_proxy_sync_env,
        );
    }
    crate::tray::update_tray_menu(&app);
    Ok(res)
}

#[tauri::command]
pub async fn stop_core(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let config = state.config.read().clone();
    if config.system_proxy_enabled {
        let _ = crate::core::sysproxy::clear_system_proxy();
    }
    state.engine.stop().map_err(|err| err.to_string())?;
    crate::tray::update_tray_menu(&app);
    Ok(())
}

#[tauri::command]
pub async fn restart_core(app: AppHandle, state: State<'_, AppState>) -> Result<CoreStatus, String> {
    let _ = state.sync_runtime_config().await;
    let config = state.config.read().clone();
    let res = state
        .engine
        .restart(Some(&app), &config)
        .map_err(|err| err.to_string())?;
    if config.system_proxy_enabled
        && let Some(port) = config.system_proxy_port
    {
        let _ = crate::core::sysproxy::apply_system_proxy(
            port,
            &config.system_proxy_bypass_user,
            config.system_proxy_sync_env,
        );
    }
    crate::tray::update_tray_menu(&app);
    Ok(res)
}
#[tauri::command]
pub async fn check_port_available(
    port: u16,
    exclude_mapping_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    Ok(state
        .port_router
        .check_port_available(port, exclude_mapping_id.as_deref()))
}

#[tauri::command]
pub async fn get_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    Ok(state.config.read().clone())
}

#[tauri::command]
pub async fn save_config(app: AppHandle, config: AppConfig, state: State<'_, AppState>) -> Result<(), String> {
    let old_config = state.config.read().clone();
    if config.controller_port != old_config.controller_port {
        let core_status = state.engine.get_status();
        let is_current_active_core_port = core_status.running && core_status.controller_port == config.controller_port;

        if !is_current_active_core_port {
            if !is_port_available(config.controller_port) {
                return Err(format!(
                    "端口 {} 已被本地其他应用程序占用，无法设为控制器端口，请换用其他端口（如 9090）。",
                    config.controller_port
                ));
            }

            let mappings = state.port_router.get_port_mappings();
            if mappings.iter().any(|m| m.port == config.controller_port && m.enabled) {
                return Err(format!(
                    "端口 {} 已在「端口映射」中作为代理入站端口使用，请换用其他端口。",
                    config.controller_port
                ));
            }
        }
    }

    if config.system_proxy_enabled != old_config.system_proxy_enabled
        || config.system_proxy_port != old_config.system_proxy_port
        || config.system_proxy_bypass_user != old_config.system_proxy_bypass_user
        || config.system_proxy_sync_env != old_config.system_proxy_sync_env
    {
        if config.system_proxy_enabled {
            if let Some(port) = config.system_proxy_port {
                let _ = crate::core::sysproxy::apply_system_proxy(
                    port,
                    &config.system_proxy_bypass_user,
                    config.system_proxy_sync_env,
                );
            }
        } else {
            let _ = crate::core::sysproxy::clear_system_proxy();
        }
    }

    *state.config.write() = config.clone();
    let config_path = state.app_dir.join("config.json");
    if let Ok(json) = serde_json::to_string_pretty(&config) {
        let _ = std::fs::write(config_path, json);
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if config.auto_launch {
            let _ = crate::core::autostart::enable_autostart(&exe_path, config.silent_start);
        } else {
            let _ = crate::core::autostart::disable_autostart();
        }
    }

    let _ = state.sync_runtime_config().await;
    crate::tray::update_tray_menu(&app);
    Ok(())
}

#[tauri::command]
pub async fn set_system_proxy(
    app: AppHandle,
    enabled: bool,
    port: Option<u16>,
    state: State<'_, AppState>,
) -> Result<SystemProxyStatus, String> {
    let mut config = state.config.read().clone();

    if enabled {
        let p = port.ok_or_else(|| "启用系统代理必须指定端口".to_string())?;
        let mappings = state.port_router.get_port_mappings();
        let is_valid = mappings.iter().any(|m| m.port == p && m.enabled);
        if !is_valid {
            return Err(format!("端口 {} 未在监听列表中或未启用，无法设为系统代理", p));
        }

        crate::core::sysproxy::apply_system_proxy(p, &config.system_proxy_bypass_user, config.system_proxy_sync_env)
            .map_err(|e| e.to_string())?;

        config.system_proxy_enabled = true;
        config.system_proxy_port = Some(p);
    } else {
        crate::core::sysproxy::clear_system_proxy().map_err(|e| e.to_string())?;
        config.system_proxy_enabled = false;
        config.system_proxy_port = None;
    }

    *state.config.write() = config.clone();
    let config_path = state.app_dir.join("config.json");
    if let Ok(json) = serde_json::to_string_pretty(&config) {
        let _ = std::fs::write(config_path, json);
    }

    let bypass_domains = crate::core::sysproxy::build_combined_bypass_list(&config.system_proxy_bypass_user);
    crate::tray::update_tray_menu(&app);
    Ok(SystemProxyStatus {
        enabled: config.system_proxy_enabled,
        port: config.system_proxy_port,
        bypass_domains,
    })
}

#[tauri::command]
pub async fn get_system_proxy_status(state: State<'_, AppState>) -> Result<SystemProxyStatus, String> {
    let config = state.config.read().clone();
    let bypass_domains = crate::core::sysproxy::build_combined_bypass_list(&config.system_proxy_bypass_user);
    Ok(SystemProxyStatus {
        enabled: config.system_proxy_enabled,
        port: config.system_proxy_port,
        bypass_domains,
    })
}

#[tauri::command]
pub async fn get_default_bypass_list() -> Result<Vec<String>, String> {
    Ok(crate::core::sysproxy::get_default_bypass_list())
}

#[tauri::command]
pub async fn get_uwp_loopback_status() -> Result<UwpLoopbackStats, String> {
    crate::core::sysproxy::get_uwp_loopback_stats().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn exempt_all_uwp_loopback() -> Result<UwpLoopbackStats, String> {
    crate::core::sysproxy::exempt_all_uwp_loopback().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_all_uwp_loopback() -> Result<UwpLoopbackStats, String> {
    crate::core::sysproxy::clear_all_uwp_loopback().map_err(|e| e.to_string())
}

// ----------------------------------------------------------------------------
// Port Mapping Management Commands
// ----------------------------------------------------------------------------

#[tauri::command]
pub async fn get_port_mappings(state: State<'_, AppState>) -> Result<Vec<PortMapping>, String> {
    Ok(state.port_router.get_port_mappings())
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
    state
        .port_router
        .get_next_available_port(start_port, exclude_mapping_id.as_deref())
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn save_port_mapping(mapping: PortMapping, state: State<'_, AppState>) -> Result<PortMapping, String> {
    state
        .port_router
        .save_port_mapping(mapping)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn delete_port_mapping(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let target_port = state.port_router.get_port_mapping_by_id(&id).map(|m| m.port);
    state
        .port_router
        .delete_port_mapping(&id)
        .await
        .map_err(|err| err.to_string())?;

    let mut config = state.config.read().clone();
    if config.system_proxy_enabled && target_port == config.system_proxy_port {
        let _ = crate::core::sysproxy::clear_system_proxy();
        config.system_proxy_enabled = false;
        config.system_proxy_port = None;
        *state.config.write() = config.clone();
        let config_path = state.app_dir.join("config.json");
        if let Ok(json) = serde_json::to_string_pretty(&config) {
            let _ = std::fs::write(config_path, json);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn toggle_port_mapping(id: String, enabled: bool, state: State<'_, AppState>) -> Result<PortMapping, String> {
    let target_port = state.port_router.get_port_mapping_by_id(&id).map(|m| m.port);
    let updated = state
        .port_router
        .toggle_port_mapping(&id, enabled)
        .await
        .map_err(|err| err.to_string())?;

    if !enabled {
        let mut config = state.config.read().clone();
        if config.system_proxy_enabled && target_port == config.system_proxy_port {
            let _ = crate::core::sysproxy::clear_system_proxy();
            config.system_proxy_enabled = false;
            config.system_proxy_port = None;
            *state.config.write() = config.clone();
            let config_path = state.app_dir.join("config.json");
            if let Ok(json) = serde_json::to_string_pretty(&config) {
                let _ = std::fs::write(config_path, json);
            }
        }
    }
    Ok(updated)
}
#[tauri::command]
pub async fn toggle_manual_fallback(
    app: AppHandle,
    id: String,
    manual_fallback: bool,
    state: State<'_, AppState>,
) -> Result<PortMapping, String> {
    let res = state
        .port_router
        .toggle_manual_fallback(&id, manual_fallback)
        .await
        .map_err(|err| err.to_string())?;

    crate::tray::update_tray_menu(&app);
    Ok(res)
}

#[tauri::command]
pub async fn test_port_mapping_delay(
    app: AppHandle,
    id: String,
    test_url: Option<String>,
    timeout_ms: Option<u32>,
    state: State<'_, AppState>,
) -> Result<u32, String> {
    let status = state.engine.get_status();
    if !status.running {
        return Err("Mihomo 内核未运行，请在设置中启动内核后再进行测速".to_string());
    }

    let mapping = state
        .port_router
        .get_port_mapping_by_id(&id)
        .ok_or_else(|| format!("未找到 ID 为 '{}' 的端口映射", id))?;

    let profile = state.profile_manager.get_profile_by_id(&mapping.profile_id);
    let runtime_name = if let Some(prof) = profile.as_ref() {
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

    let res = state
        .latency_probe
        .test_node(
            &mapping.node_name,
            Some(&runtime_name),
            Some(actual_url),
            Some(actual_timeout),
            Some(&id),
        )
        .await;

    if let Some(fb_name) = &mapping.fallback_node_name
        && !fb_name.trim().is_empty()
    {
        let fb_profile_id = mapping.fallback_profile_id.as_deref().unwrap_or(&mapping.profile_id);
        let fb_profile = state.profile_manager.get_profile_by_id(fb_profile_id);
        let fb_runtime_name = if let Some(prof) = fb_profile.as_ref() {
            format!("[{}] {}", prof.name, fb_name)
        } else {
            fb_name.clone()
        };
        let _ = state
            .latency_probe
            .test_node(
                fb_name,
                Some(&fb_runtime_name),
                Some(actual_url),
                Some(actual_timeout),
                Some(&id),
            )
            .await;
    }
    match res {
        Ok(delay) => {
            let _ = state.port_router.update_port_latency(&id, Some(delay));
            crate::tray::update_tray_menu(&app);
            Ok(delay)
        }
        Err(err) => {
            let _ = state.port_router.update_port_latency(&id, None);
            crate::tray::update_tray_menu(&app);
            Err(err.to_string())
        }
    }
}
#[tauri::command]
pub async fn test_port_fallback_delay(
    app: AppHandle,
    id: String,
    test_url: Option<String>,
    timeout_ms: Option<u32>,
    state: State<'_, AppState>,
) -> Result<u32, String> {
    let status = state.engine.get_status();
    if !status.running {
        return Err("Mihomo 内核未运行，请在设置中启动内核后再进行测速".to_string());
    }

    let mapping = state
        .port_router
        .get_port_mapping_by_id(&id)
        .ok_or_else(|| format!("未找到 ID 为 '{}' 的端口映射", id))?;

    let fb_name = mapping
        .fallback_node_name
        .as_ref()
        .filter(|fb| !fb.trim().is_empty())
        .ok_or_else(|| "该端口未配置备用节点".to_string())?;

    let fb_profile_id = mapping.fallback_profile_id.as_deref().unwrap_or(&mapping.profile_id);
    let fb_profile = state.profile_manager.get_profile_by_id(fb_profile_id);
    let fb_runtime_name = if let Some(prof) = fb_profile.as_ref() {
        format!("[{}] {}", prof.name, fb_name)
    } else {
        fb_name.clone()
    };

    let (default_url, default_timeout) = {
        let cfg = state.config.read();
        (cfg.test_url.clone(), cfg.timeout_ms)
    };
    let actual_url = test_url.as_deref().unwrap_or(&default_url);
    let actual_timeout = timeout_ms.unwrap_or(default_timeout);

    let res = state
        .latency_probe
        .test_node(
            fb_name,
            Some(&fb_runtime_name),
            Some(actual_url),
            Some(actual_timeout),
            Some(&id),
        )
        .await;

    crate::tray::update_tray_menu(&app);

    res.map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn test_all_port_mappings_delay(
    app: AppHandle,
    test_url: Option<String>,
    timeout_ms: Option<u32>,
    concurrency: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<NodeLatencyResult>, String> {
    let status = state.engine.get_status();
    if !status.running {
        return Err("Mihomo 内核未运行，请在设置中启动内核后再进行测速".to_string());
    }

    let mappings = state.port_router.get_port_mappings();
    if mappings.is_empty() {
        return Ok(Vec::new());
    }

    let profiles = state.profile_manager.get_profiles();
    let profile_map: std::collections::HashMap<String, String> = profiles.into_iter().map(|p| (p.id, p.name)).collect();

    let mut targets = Vec::new();
    let mut mapping_id_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    for m in mappings.iter().filter(|m| m.enabled) {
        let runtime_name = if let Some(pname) = profile_map.get(&m.profile_id) {
            format!("[{}] {}", pname, m.node_name)
        } else {
            m.node_name.clone()
        };
        targets.push(
            crate::core::latency_probe::BatchProbeTarget::new(m.node_name.clone())
                .with_runtime_name(runtime_name)
                .with_mapping_id(m.id.clone()),
        );
        mapping_id_map.insert(m.node_name.clone(), m.id.clone());

        if let Some(fb_name) = &m.fallback_node_name
            && !fb_name.trim().is_empty()
        {
            let fb_profile_id = m.fallback_profile_id.as_deref().unwrap_or(&m.profile_id);
            let fb_runtime_name = if let Some(pname) = profile_map.get(fb_profile_id) {
                format!("[{}] {}", pname, fb_name)
            } else {
                fb_name.clone()
            };
            targets.push(
                crate::core::latency_probe::BatchProbeTarget::new(fb_name.clone()).with_runtime_name(fb_runtime_name),
            );
        }
    }

    let (default_url, default_timeout) = {
        let cfg = state.config.read();
        (cfg.test_url.clone(), cfg.timeout_ms)
    };
    let actual_url = test_url.as_deref().unwrap_or(&default_url);
    let actual_timeout = timeout_ms.unwrap_or(default_timeout);

    let results = state
        .latency_probe
        .test_nodes_batch(&targets, Some(actual_url), Some(actual_timeout), concurrency)
        .await;

    for res in &results {
        if let Some(mapping_id) = mapping_id_map.get(&res.name) {
            let _ = state.port_router.update_port_latency(mapping_id, res.latency);
        }
    }
    crate::tray::update_tray_menu(&app);
    Ok(results)
}

#[tauri::command]
pub async fn get_port_fallback_statuses(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<PortFallbackStatus>, String> {
    let status = state.engine.get_status();
    if !status.running {
        return Ok(Vec::new());
    }

    let mappings = state.port_router.get_port_mappings();
    let profiles = state.profile_manager.get_profiles();
    let profile_map: std::collections::HashMap<String, String> = profiles.into_iter().map(|p| (p.id, p.name)).collect();

    let engine = state.engine.clone();
    let mut statuses = Vec::new();
    let mut latency_updates: Vec<(String, Option<u32>)> = Vec::new();
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
        let is_fallback_active = if m.manual_fallback {
            true
        } else if let Ok(detail) = engine.get_proxy_detail(&group_name).await {
            let active_node = detail.now.clone().unwrap_or_default();
            active_node.ends_with(&fallback_node)
        } else {
            false
        };

        let active_node = if is_fallback_active {
            fallback_node.clone()
        } else {
            m.node_name.clone()
        };

        let primary_runtime_name = if let Some(pname) = profile_map.get(&m.profile_id) {
            format!("[{}] {}", pname, m.node_name)
        } else {
            m.node_name.clone()
        };

        let fb_profile_id = m.fallback_profile_id.as_deref().unwrap_or(&m.profile_id);
        let fb_runtime_name = if let Some(pname) = profile_map.get(fb_profile_id) {
            format!("[{}] {}", pname, fallback_node)
        } else {
            fallback_node.clone()
        };

        let kernel_primary_latency = engine
            .get_proxy_detail(&primary_runtime_name)
            .await
            .ok()
            .and_then(|p| p.history.last().map(|h| h.delay))
            .filter(|&d| d > 0);

        let primary_latency = kernel_primary_latency
            .or_else(|| state.latency_probe.get_latency(&primary_runtime_name).flatten())
            .or_else(|| state.latency_probe.get_latency(&m.node_name).flatten())
            .or(m.latency);

        let kernel_fallback_latency = engine
            .get_proxy_detail(&fb_runtime_name)
            .await
            .ok()
            .and_then(|p| p.history.last().map(|h| h.delay))
            .filter(|&d| d > 0);

        let fallback_latency = kernel_fallback_latency
            .or_else(|| state.latency_probe.get_latency(&fb_runtime_name).flatten())
            .or_else(|| state.latency_probe.get_latency(&fallback_node).flatten());
        if let Some(d) = kernel_primary_latency {
            latency_updates.push((primary_runtime_name, Some(d)));
            latency_updates.push((m.node_name.clone(), Some(d)));
        }
        if let Some(d) = kernel_fallback_latency {
            latency_updates.push((fb_runtime_name, Some(d)));
            latency_updates.push((fallback_node.clone(), Some(d)));
        }

        // Port mapping latency represents the primary node latency; never overwrite with fallback latency!
        let _ = state.port_router.update_port_latency(&m.id, primary_latency);
        statuses.push(PortFallbackStatus {
            mapping_id: m.id,
            port: m.port,
            primary_node: m.node_name,
            fallback_node,
            active_node,
            is_fallback_active,
            manual_fallback: m.manual_fallback,
            primary_latency,
            fallback_latency,
            last_updated: now_ts,
        });
    }

    if !latency_updates.is_empty() {
        state.latency_probe.set_latencies_batch(&latency_updates);
    }

    crate::tray::update_tray_menu_with_fallback_statuses(&app, statuses.clone());
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
pub async fn update_profile(id: String, app: AppHandle, state: State<'_, AppState>) -> Result<ProfileItem, String> {
    let item = state
        .profile_manager
        .update_profile(&id)
        .await
        .map_err(|err| err.to_string())?;
    let _ = state.sync_runtime_config().await;

    let mappings = state.port_router.get_port_mappings();
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
pub async fn delete_profile(id: String, app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state
        .profile_manager
        .delete_profile(&id)
        .map_err(|err| err.to_string())?;
    let _ = state.sync_runtime_config().await;

    let mappings = state.port_router.get_port_mappings();
    let drift_reports = DriftGuard::check_all(&mappings, &state.profile_manager);
    let has_drift = drift_reports.iter().any(|r| r.status != DriftStatus::Healthy);
    if has_drift {
        let _ = app.emit("node-drift-detected", &drift_reports);
    }

    Ok(())
}

#[tauri::command]
pub async fn get_drift_reports(state: State<'_, AppState>) -> Result<Vec<PortDriftReport>, String> {
    let mappings = state.port_router.get_port_mappings();
    let reports = DriftGuard::check_all(&mappings, &state.profile_manager);
    Ok(reports)
}

#[tauri::command]
pub async fn get_auto_updater_status(state: State<'_, AppState>) -> Result<AutoUpdaterStatus, String> {
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
                if !ipv4.is_loopback() && !ipv4.is_link_local() && !ipv4.is_unspecified() && !ipv4.is_broadcast() {
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
    app: AppHandle,
    node_name: String,
    test_url: Option<String>,
    timeout_ms: Option<u32>,
    state: State<'_, AppState>,
) -> Result<u32, String> {
    let status = state.engine.get_status();
    if !status.running {
        return Err("Mihomo 内核未运行，请在设置中启动内核后再进行测速".to_string());
    }

    let (default_url, default_timeout) = {
        let cfg = state.config.read();
        (cfg.test_url.clone(), cfg.timeout_ms)
    };
    let actual_url = test_url.as_deref().unwrap_or(&default_url);
    let actual_timeout = timeout_ms.unwrap_or(default_timeout);

    let all_nodes = state.profile_manager.get_all_nodes();
    let target_node = all_nodes
        .into_iter()
        .find(|n| n.name == node_name || n.runtime_name.as_deref() == Some(&node_name));
    let raw_name = target_node
        .as_ref()
        .map(|n| n.name.clone())
        .unwrap_or_else(|| node_name.clone());
    let runtime_name = target_node.and_then(|n| n.runtime_name);

    let res = state
        .latency_probe
        .test_node(
            &raw_name,
            runtime_name.as_deref(),
            Some(actual_url),
            Some(actual_timeout),
            None,
        )
        .await
        .map_err(|err| err.to_string())?;

    let mappings = state.port_router.get_port_mappings();
    for m in mappings {
        let matches =
            m.node_name == raw_name || m.node_name == node_name || runtime_name.as_deref() == Some(&m.node_name);
        if matches {
            let _ = state.port_router.update_port_latency(&m.id, Some(res));
        }
    }
    crate::tray::update_tray_menu(&app);

    Ok(res)
}

#[tauri::command]
pub async fn test_nodes_delay_batch(
    app: AppHandle,
    node_names: Vec<String>,
    test_url: Option<String>,
    timeout_ms: Option<u32>,
    concurrency: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<NodeLatencyResult>, String> {
    let status = state.engine.get_status();
    if !status.running {
        return Err("Mihomo 内核未运行，请在设置中启动内核后再进行测速".to_string());
    }

    let (default_url, default_timeout) = {
        let cfg = state.config.read();
        (cfg.test_url.clone(), cfg.timeout_ms)
    };
    let actual_url = test_url.as_deref().unwrap_or(&default_url);
    let actual_timeout = timeout_ms.unwrap_or(default_timeout);

    let all_nodes = state.profile_manager.get_all_nodes();
    let mut runtime_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut raw_name_map = std::collections::HashMap::new();
    for n in all_nodes {
        raw_name_map.insert(n.name.clone(), n.name.clone());
        if let Some(rt) = n.runtime_name {
            runtime_map.insert(n.name.clone(), rt.clone());
            runtime_map.insert(rt.clone(), rt.clone());
            raw_name_map.insert(rt, n.name);
        }
    }

    let targets: Vec<crate::core::latency_probe::BatchProbeTarget> = node_names
        .into_iter()
        .map(|name| {
            let rt = runtime_map.get(&name).cloned();
            let mut target = crate::core::latency_probe::BatchProbeTarget::new(name);
            if let Some(rt_name) = rt {
                target = target.with_runtime_name(rt_name);
            }
            target
        })
        .collect();

    let results = state
        .latency_probe
        .test_nodes_batch(&targets, Some(actual_url), Some(actual_timeout), concurrency)
        .await;

    let mappings = state.port_router.get_port_mappings();
    for res in &results {
        let raw_name = raw_name_map.get(&res.name).cloned().unwrap_or_else(|| res.name.clone());
        for m in &mappings {
            if m.node_name == res.name || m.node_name == raw_name {
                let _ = state.port_router.update_port_latency(&m.id, res.latency);
            }
        }
    }
    crate::tray::update_tray_menu(&app);

    Ok(results)
}

#[tauri::command]
pub fn cancel_latency_probe(state: State<'_, AppState>) -> Result<(), String> {
    state.latency_probe.cancel_tests();
    Ok(())
}

#[tauri::command]
pub fn get_latency_cache(state: State<'_, AppState>) -> Result<std::collections::HashMap<String, Option<u32>>, String> {
    Ok(state.latency_probe.get_latencies())
}

#[tauri::command]
pub fn clear_latency_cache(state: State<'_, AppState>) -> Result<(), String> {
    state.latency_probe.clear_latencies();
    Ok(())
}

#[tauri::command]
pub async fn check_kernel_update(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<crate::core::kernel_updater::KernelUpdateCheckResult, String> {
    crate::core::kernel_updater::check_kernel_update(&app, &state)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn upgrade_kernel(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<crate::core::kernel_updater::KernelUpgradeResult, String> {
    let result = crate::core::kernel_updater::download_and_apply_kernel(&app, &state)
        .await
        .map_err(|e| e.to_string())?;

    crate::tray::update_tray_menu(&app);
    Ok(result)
}

#[tauri::command]
pub async fn check_app_update() -> Result<crate::core::app_updater::AppUpdateCheckResult, String> {
    crate::core::app_updater::check_app_update()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn install_app_update(
    app: AppHandle,
    download_url: String,
    file_name: String,
    package_type: String,
    state: State<'_, AppState>,
) -> Result<crate::core::app_updater::AppUpdateInstallResult, String> {
    crate::core::app_updater::download_and_install_update(&app, &download_url, &file_name, &package_type, &state)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reset_window_size(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_size(tauri::LogicalSize::new(1000.0, 680.0));
        let _ = window.center();
    }
    if let Ok(config_dir) = app.path().app_config_dir() {
        let state_file = config_dir.join(".window-state.json");
        let _ = std::fs::remove_file(state_file);
    }
    if let Ok(data_dir) = app.path().app_local_data_dir() {
        let state_file = data_dir.join(".window-state.json");
        let _ = std::fs::remove_file(state_file);
    }
    Ok(())
}

#[tauri::command]
pub async fn exit_app(app: AppHandle) -> Result<(), String> {
    let _ = crate::core::sysproxy::clear_system_proxy();
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub async fn hide_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    Ok(())
}

#[tauri::command]
pub async fn get_rules_info(state: State<'_, AppState>) -> Result<crate::core::geo_manager::MrsRulesInfo, String> {
    let work_dir = state.engine.work_dir();
    Ok(crate::core::geo_manager::get_mrs_rules_info(work_dir))
}

#[tauri::command]
pub async fn update_rules(state: State<'_, AppState>) -> Result<crate::core::geo_manager::MrsRulesInfo, String> {
    let work_dir = state.engine.work_dir();
    let res = crate::core::geo_manager::update_mrs_rules(work_dir).await.map_err(|e| e.to_string())?;
    // If engine is active, reload config seamlessly
    if state.engine.get_status().running {
        let runtime_path = work_dir.join("runtime.yaml");
        let _ = state.engine.reload_config(&runtime_path.to_string_lossy()).await;
    }
    Ok(res)
}
