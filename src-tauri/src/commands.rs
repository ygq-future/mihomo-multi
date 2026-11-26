use crate::core::auto_updater::AutoUpdater;
use crate::core::config_generator::chain_proxy_name;
use crate::core::drift_guard::DriftGuard;
use crate::core::port_probe::{PortTransport, is_port_available};
use crate::error::CommandError;
use crate::models::{
    AppConfig, AppStatus, AutoUpdateEventPayload, AutoUpdaterStatus, ConnectionSnapshot, CoreStatus, DirectEgressInfo,
    DriftStatus, EnvProxyStatus, FIXED_DIRECT_PORT_ID, InboundProtocol, LanIpInfo, NodeIpQualityReport,
    NodeLatencyResult, NodeMediaUnlockReport, PortDriftReport, PortFallbackStatus, PortMapping, PortProcessUsageItem,
    ProfileItem, ProxyNode, ResidentialProxyTestResult, SniffedAccessLogEntry, SystemProxyStatus, TunStatus,
    UwpAppInfo, UwpLoopbackStats, validate_residential_proxies, validate_residential_proxy_removal,
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
        is_installed: crate::core::app_updater::detect_is_installed(),
    })
}

#[tauri::command]
pub async fn get_core_status(state: State<'_, AppState>) -> Result<CoreStatus, String> {
    Ok(state.engine.get_status())
}

#[tauri::command]
pub async fn start_core(app: AppHandle, state: State<'_, AppState>) -> Result<CoreStatus, String> {
    state.sync_runtime_config().await.map_err(|err| {
        crate::tr!(
            format!("生成运行时配置失败: {err}"),
            format!("Failed to generate runtime configuration: {err}"),
        )
    })?;
    let config = state.config.read().clone();
    let engine = state.engine.clone();
    let app_clone = app.clone();
    let res = tokio::task::spawn_blocking(move || engine.start(Some(&app_clone), &config))
        .await
        .map_err(|e| format!("Task join error: {e}"))?
        .map_err(|err| err.to_string())?;
    let proxy_state = state.inner().clone();
    let _ = tokio::task::spawn_blocking(move || proxy_state.ensure_system_proxy_active()).await;
    crate::tray::update_tray_menu(&app);
    Ok(res)
}

#[tauri::command]
pub async fn stop_core(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let stop_state = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        stop_state.deactivate_egress_on_core_stop();
        stop_state.engine.stop()
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
    .map_err(|err| err.to_string())?;
    crate::tray::update_tray_menu(&app);
    Ok(())
}

#[tauri::command]
pub async fn restart_core(app: AppHandle, state: State<'_, AppState>) -> Result<CoreStatus, String> {
    state.sync_runtime_config().await.map_err(|err| {
        crate::tr!(
            format!("生成运行时配置失败: {err}"),
            format!("Failed to generate runtime configuration: {err}"),
        )
    })?;
    let config = state.config.read().clone();
    let engine = state.engine.clone();
    let app_clone = app.clone();
    let res = tokio::task::spawn_blocking(move || engine.restart(Some(&app_clone), &config))
        .await
        .map_err(|e| format!("Task join error: {e}"))?
        .map_err(|err| err.to_string())?;
    let proxy_state = state.inner().clone();
    let _ = tokio::task::spawn_blocking(move || proxy_state.ensure_system_proxy_active()).await;
    crate::tray::update_tray_menu(&app);
    Ok(res)
}
#[tauri::command]
pub async fn check_port_available(
    port: u16,
    exclude_mapping_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    Ok(state.check_port_available(port, exclude_mapping_id.as_deref()))
}

#[tauri::command]
pub async fn get_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    Ok(state.config.read().clone())
}

#[tauri::command]
pub async fn save_config(app: AppHandle, mut config: AppConfig, state: State<'_, AppState>) -> Result<(), String> {
    // Read the previously persisted config before touching runtime state so validation and
    // diffing operate on the same snapshot.
    let old_config = state.config.read().clone();

    config.residential_proxies = config
        .residential_proxies
        .into_iter()
        .map(|proxy| proxy.normalized())
        .collect();
    validate_residential_proxies(&config.residential_proxies)?;

    let mappings = state.port_router.get_port_mappings();
    validate_residential_proxy_removal(&old_config.residential_proxies, &config.residential_proxies, &mappings)?;

    let mut cleaned_bypass = Vec::new();
    let mut seen_bypass = std::collections::HashSet::new();
    for raw in &config.system_proxy_bypass_user {
        let item = raw.trim();
        if item.is_empty() || item == "*" || item.eq_ignore_ascii_case("<local>") {
            continue;
        }
        let lower = item.to_lowercase();
        if seen_bypass.insert(lower) {
            cleaned_bypass.push(item.to_string());
        }
    }
    crate::core::sysproxy::sort_bypass_items(&mut cleaned_bypass);
    config.system_proxy_bypass_user = cleaned_bypass;

    // The UWP auto-exempt intent is owned by the UWP commands; a generic settings save must
    // never overwrite it with a stale frontend snapshot.
    config.uwp_auto_exempt = state.config.read().uwp_auto_exempt;

    if config.tun_enabled && config.system_proxy_enabled {
        config.system_proxy_enabled = false;
    }

    if config.controller_port != old_config.controller_port {
        let core_status = state.engine.get_status();
        let is_current_active_core_port = core_status.running && core_status.controller_port == config.controller_port;

        if !is_current_active_core_port {
            if !is_port_available(config.controller_port, PortTransport::Tcp, false, None) {
                return Err(crate::tr!(
                    format!(
                        "端口 {} 已被本地其他应用程序占用，无法设为控制器端口，请换用其他端口（如 9090）。",
                        config.controller_port
                    ),
                    format!(
                        "Port {} is already used by another local application and cannot be set as the controller port. Choose another port (for example 9090).",
                        config.controller_port
                    ),
                ));
            }

            let mappings = state.port_router.get_port_mappings();
            if mappings.iter().any(|m| m.port == config.controller_port && m.enabled) {
                return Err(crate::tr!(
                    format!(
                        "端口 {} 已在「端口映射」中作为代理入站端口使用，请换用其他端口。",
                        config.controller_port
                    ),
                    format!(
                        "Port {} is already used as a proxy inbound port in Port Mappings. Choose another port.",
                        config.controller_port
                    ),
                ));
            }
        }
    }

    let sys_proxy_changed = config.system_proxy_enabled != old_config.system_proxy_enabled
        || config.system_proxy_port != old_config.system_proxy_port
        || config.system_proxy_bypass_user != old_config.system_proxy_bypass_user;
    let env_proxy_changed = config.env_proxy_enabled != old_config.env_proxy_enabled
        || config.env_proxy_port != old_config.env_proxy_port
        || (config.env_proxy_enabled && config.system_proxy_bypass_user != old_config.system_proxy_bypass_user);
    if sys_proxy_changed || env_proxy_changed {
        let cfg_for_proxy = config.clone();
        let _ = tokio::task::spawn_blocking(move || {
            if sys_proxy_changed {
                if cfg_for_proxy.system_proxy_enabled {
                    if let Some(port) = cfg_for_proxy.system_proxy_port {
                        let _ =
                            crate::core::sysproxy::apply_system_proxy(port, &cfg_for_proxy.system_proxy_bypass_user);
                    }
                } else {
                    let _ = crate::core::sysproxy::clear_system_proxy();
                }
            }
            if env_proxy_changed {
                if cfg_for_proxy.env_proxy_enabled {
                    if let Some(port) = cfg_for_proxy.env_proxy_port {
                        let _ = crate::core::sysproxy::apply_env_proxy(port, &cfg_for_proxy.system_proxy_bypass_user);
                    }
                } else {
                    let _ = crate::core::sysproxy::clear_env_proxy();
                }
            }
        })
        .await;
    }
    let config_changed = *state.config.read() != config;
    if config_changed {
        state.persist_config(&config).map_err(|error| error.to_string())?;
    }
    if !config.system_proxy_enabled {
        state.clear_suspended_system_proxy();
    }

    if (config.auto_launch != old_config.auto_launch
        || config.silent_start != old_config.silent_start
        || config.tun_enabled != old_config.tun_enabled)
        && let Ok(exe_path) = std::env::current_exe()
    {
        let cfg_for_autostart = config.clone();
        tokio::task::spawn_blocking(move || {
            crate::core::autostart::sync_autostart_state(&cfg_for_autostart, &exe_path)
        })
        .await
        .map_err(|e| format!("Task join error: {e}"))?
        .map_err(|e| {
            crate::tr!(
                format!("同步开机自启状态失败: {e}"),
                format!("Failed to sync autostart state: {e}"),
            )
        })?;
    }
    if config.theme != old_config.theme
        && let Some(window) = app.get_webview_window("main")
    {
        crate::tray::apply_window_bg_color(&window, &config.theme);
    }
    // Only re-sync runtime configuration if settings affecting Mihomo (listeners, controller, timeout, lan, etc.) changed
    let runtime_settings_changed = config.controller_port != old_config.controller_port
        || config.controller_secret != old_config.controller_secret
        || config.log_level != old_config.log_level
        || config.allow_lan != old_config.allow_lan
        || config.test_url != old_config.test_url
        || config.timeout_ms != old_config.timeout_ms
        || config.fallback_interval != old_config.fallback_interval
        || config.fallback_lazy != old_config.fallback_lazy
        || config.system_proxy_bypass_user != old_config.system_proxy_bypass_user
        || config.tun_enabled != old_config.tun_enabled
        || config.tun_port != old_config.tun_port
        || config.global_rules != old_config.global_rules
        || config.residential_proxies != old_config.residential_proxies;
    if runtime_settings_changed && let Err(error) = state.sync_runtime_config().await {
        state.persist_config(&old_config).map_err(|rollback| {
            crate::tr!(
                format!(
                    "应用运行时配置失败: {error}；恢复已保存配置失败: {rollback}"
                ),
                format!(
                    "Failed to apply runtime configuration: {error}; failed to restore the saved configuration: {rollback}"
                ),
            )
        })?;
        state.sync_runtime_config().await.map_err(|rollback| {
            crate::tr!(
                format!(
                    "应用运行时配置失败: {error}；恢复运行时配置失败: {rollback}"
                ),
                format!(
                    "Failed to apply runtime configuration: {error}; failed to restore the runtime configuration: {rollback}"
                ),
            )
        })?;
        return Err(crate::tr!(
            format!("应用运行时配置失败，已恢复原配置: {error}"),
            format!("Failed to apply runtime configuration; the previous configuration was restored: {error}"),
        ));
    }

    if config.system_proxy_bypass_user != old_config.system_proxy_bypass_user && state.engine.get_status().running {
        let old_rules: std::collections::HashSet<String> = old_config
            .system_proxy_bypass_user
            .iter()
            .map(|s| s.trim().to_ascii_lowercase())
            .collect();
        let added_rules: Vec<String> = config
            .system_proxy_bypass_user
            .iter()
            .filter(|s| !old_rules.contains(&s.trim().to_ascii_lowercase()))
            .cloned()
            .collect();
        if !added_rules.is_empty()
            && let Ok(snapshot) = state.engine.adapter().get_connections().await
        {
            for conn in snapshot.connections {
                let matches_host =
                    crate::core::sysproxy::bypass_rule_matches_host_list(&added_rules, &conn.metadata.host);
                let matches_sniff = conn
                    .metadata
                    .sniff_host
                    .as_deref()
                    .is_some_and(|h| crate::core::sysproxy::bypass_rule_matches_host_list(&added_rules, h));
                if matches_host || matches_sniff {
                    let _ = state.engine.adapter().close_connection(&conn.id).await;
                }
            }
        }
    }

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
    let (status, old_tun_enabled) = state.apply_system_proxy_transition(enabled, port)?;

    if enabled && old_tun_enabled {
        let _ = state.sync_runtime_config().await;
    }

    crate::tray::update_tray_menu(&app);
    Ok(status)
}

#[tauri::command]
pub async fn set_env_proxy(
    app: AppHandle,
    enabled: bool,
    port: Option<u16>,
    state: State<'_, AppState>,
) -> Result<EnvProxyStatus, String> {
    let state_clone = state.inner().clone();
    let status = tokio::task::spawn_blocking(move || state_clone.apply_env_proxy_transition(enabled, port))
        .await
        .map_err(|e| format!("Task join error: {e}"))??;
    crate::tray::update_tray_menu(&app);
    Ok(status)
}

#[tauri::command]
pub async fn get_env_proxy_status(state: State<'_, AppState>) -> Result<EnvProxyStatus, String> {
    Ok(state.build_env_proxy_status())
}

#[tauri::command]
pub async fn get_system_proxy_status(state: State<'_, AppState>) -> Result<SystemProxyStatus, String> {
    Ok(state.build_system_proxy_status())
}

#[tauri::command]
pub async fn get_default_bypass_list() -> Result<Vec<String>, String> {
    Ok(crate::core::sysproxy::get_default_bypass_list())
}

#[tauri::command]
pub async fn get_tun_status(state: State<'_, AppState>) -> Result<TunStatus, String> {
    Ok(state.build_tun_status())
}

#[tauri::command]
pub async fn set_tun(
    app: AppHandle,
    enabled: bool,
    port: Option<u16>,
    state: State<'_, AppState>,
) -> Result<TunStatus, String> {
    let elevated = crate::core::elevation::is_elevated();
    let config = state.prepare_tun_transition(enabled, port)?;

    if let Ok(exe_path) = std::env::current_exe() {
        let cfg_for_autostart = config.clone();
        let _ = tokio::task::spawn_blocking(move || {
            crate::core::autostart::sync_autostart_state(&cfg_for_autostart, &exe_path)
        })
        .await;
    }

    if enabled && !elevated {
        let engine_stop = state.engine.clone();
        let _ = tokio::task::spawn_blocking(move || engine_stop.stop()).await;
        let relaunch_arg = format!("--restart-from-pid={}", std::process::id());
        let relaunch_res =
            tokio::task::spawn_blocking(move || crate::core::elevation::relaunch_as_admin(&[relaunch_arg]))
                .await
                .map_err(|e| format!("Task join error: {e}"))?;
        if let Err(e) = relaunch_res {
            // UAC 被拒绝或启动失败：回滚开关并恢复内核，避免留下"已开启但内核已停止"的破损状态
            let rollback = state.rollback_tun_transition();
            let engine_start = state.engine.clone();
            let app_clone = app.clone();
            let _ = tokio::task::spawn_blocking(move || engine_start.start(Some(&app_clone), &rollback)).await;
            return Err(e.to_string());
        }
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
            handle.exit(0);
        });
        return Ok(state.build_tun_status());
    }

    let _ = state.sync_runtime_config().await;
    if enabled && !state.engine.get_status().running {
        let engine_start = state.engine.clone();
        let app_clone = app.clone();
        let cfg_start = config.clone();
        tokio::task::spawn_blocking(move || engine_start.start(Some(&app_clone), &cfg_start))
            .await
            .map_err(|e| format!("Task join error: {e}"))?
            .map_err(|e| e.to_string())?;
    }
    crate::tray::update_tray_menu(&app);
    Ok(state.build_tun_status())
}

#[tauri::command]
pub async fn restart_as_admin(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    if crate::core::elevation::is_elevated() {
        return Ok(());
    }
    let engine_stop = state.engine.clone();
    let _ = tokio::task::spawn_blocking(move || engine_stop.stop()).await;
    let relaunch_arg = format!("--restart-from-pid={}", std::process::id());
    let relaunch_res = tokio::task::spawn_blocking(move || crate::core::elevation::relaunch_as_admin(&[relaunch_arg]))
        .await
        .map_err(|e| format!("Task join error: {e}"))?;
    if let Err(e) = relaunch_res {
        // UAC 被拒绝：恢复内核，避免留下无内核运行的破损状态
        let config = state.config.read().clone();
        let engine_start = state.engine.clone();
        let app_clone = app.clone();
        let _ = tokio::task::spawn_blocking(move || engine_start.start(Some(&app_clone), &config)).await;
        return Err(e.to_string());
    }
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        handle.exit(0);
    });
    Ok(())
}

#[tauri::command]
pub async fn get_uwp_loopback_status(state: State<'_, AppState>) -> Result<UwpLoopbackStats, String> {
    let auto_exempt = state.config.read().uwp_auto_exempt;
    tokio::task::spawn_blocking(move || crate::core::sysproxy::get_uwp_loopback_stats(auto_exempt))
        .await
        .map_err(|e| format!("Task join error: {e}"))?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn refresh_uwp_loopback_status(state: State<'_, AppState>) -> Result<UwpLoopbackStats, String> {
    let auto_exempt = state.config.read().uwp_auto_exempt;
    tokio::task::spawn_blocking(move || crate::core::sysproxy::refresh_and_cleanup_uwp_loopback(auto_exempt))
        .await
        .map_err(|e| format!("Task join error: {e}"))?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn exempt_all_uwp_loopback(state: State<'_, AppState>) -> Result<UwpLoopbackStats, String> {
    let stats = tokio::task::spawn_blocking(crate::core::sysproxy::exempt_all_uwp_loopback)
        .await
        .map_err(|e| format!("Task join error: {e}"))?
        .map_err(|e| e.to_string())?;
    if !state.config.read().uwp_auto_exempt {
        let mut config = state.config.read().clone();
        config.uwp_auto_exempt = true;
        state.persist_config(&config).map_err(|error| error.to_string())?;
    }
    Ok(stats)
}

#[tauri::command]
pub async fn clear_all_uwp_loopback(state: State<'_, AppState>) -> Result<UwpLoopbackStats, String> {
    let stats = tokio::task::spawn_blocking(crate::core::sysproxy::clear_all_uwp_loopback)
        .await
        .map_err(|e| format!("Task join error: {e}"))?
        .map_err(|e| e.to_string())?;
    if state.config.read().uwp_auto_exempt {
        let mut config = state.config.read().clone();
        config.uwp_auto_exempt = false;
        state.persist_config(&config).map_err(|error| error.to_string())?;
    }
    Ok(stats)
}

#[tauri::command]
pub async fn get_uwp_app_list() -> Result<Vec<UwpAppInfo>, String> {
    tokio::task::spawn_blocking(crate::core::sysproxy::get_uwp_app_list)
        .await
        .map_err(|e| format!("Task join error: {e}"))?
        .map_err(|e| e.to_string())
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
        .get_next_available_port(start_port, exclude_mapping_id.as_deref())
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn save_port_mapping(mapping: PortMapping, state: State<'_, AppState>) -> Result<PortMapping, String> {
    state.save_port_mapping(mapping).await.map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn delete_port_mapping(id: String, state: State<'_, AppState>) -> Result<(), String> {
    state.delete_port_mapping(&id).await.map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn toggle_port_mapping(id: String, enabled: bool, state: State<'_, AppState>) -> Result<PortMapping, String> {
    state
        .toggle_port_mapping(&id, enabled)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn toggle_manual_fallback(
    id: String,
    manual_fallback: bool,
    state: State<'_, AppState>,
) -> Result<PortMapping, String> {
    state
        .toggle_manual_fallback(&id, manual_fallback)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn swap_port_fallback(id: String, state: State<'_, AppState>) -> Result<PortMapping, String> {
    state.swap_port_fallback(&id).await.map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn swap_port_mapping_ports(
    first_id: String,
    second_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<PortMapping>, String> {
    state
        .swap_port_mapping_ports(&first_id, &second_id)
        .await
        .map_err(|err| err.to_string())
}

async fn ensure_system_network_online(state: &AppState) -> Result<(), CommandError> {
    let net_status = state.network_monitor.check_now().await;
    if !net_status.online {
        return Err(CommandError::system_offline(
            "当前系统网络异常，已阻止节点测速以避免写入无效超时",
            "System network is offline; latency test blocked to avoid false timeouts.",
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn test_port_mapping_delay(
    app: AppHandle,
    id: String,
    test_url: Option<String>,
    timeout_ms: Option<u32>,
    state: State<'_, AppState>,
) -> Result<u32, CommandError> {
    let status = state.engine.get_status();
    if !status.running {
        return Err(CommandError::core_not_running(
            "Mihomo 内核未运行，请在设置中启动内核后再进行测速",
            "The Mihomo core is not running. Start the core in Settings before testing latency.",
        ));
    }
    ensure_system_network_online(&state).await?;

    let mapping = state.port_router.get_port_mapping_by_id(&id).ok_or_else(|| {
        crate::tr!(
            format!("未找到 ID 为 '{}' 的端口映射", id),
            format!("Port mapping with ID '{}' not found", id),
        )
    })?;

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

    if mapping.has_chain_exit() {
        if !mapping.enabled {
            return Err(crate::tr!(
                "请先启用住宅代理链端口后再进行测速",
                "Enable the residential proxy chain port before testing latency"
            )
            .into());
        }
        let target = chain_proxy_name(mapping.port);
        let result = state
            .latency_probe
            .test_node(&target, None, Some(actual_url), Some(actual_timeout), Some(&id))
            .await;
        state
            .port_router
            .update_port_latency(&id, result.as_ref().ok().copied())?;
        crate::tray::update_tray_menu(&app);
        return result.map_err(CommandError::from);
    }

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

    match res {
        Ok(delay) => {
            let _ = state.port_router.update_port_latency(&id, Some(delay));
            crate::tray::update_tray_menu(&app);
            Ok(delay)
        }
        Err(err) => {
            let _ = state.port_router.update_port_latency(&id, None);
            crate::tray::update_tray_menu(&app);
            Err(err.into())
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
) -> Result<u32, CommandError> {
    let status = state.engine.get_status();
    if !status.running {
        return Err(CommandError::core_not_running(
            "Mihomo 内核未运行，请在设置中启动内核后再进行测速",
            "The Mihomo core is not running. Start the core in Settings before testing latency.",
        ));
    }
    ensure_system_network_online(&state).await?;

    let mapping = state.port_router.get_port_mapping_by_id(&id).ok_or_else(|| {
        crate::tr!(
            format!("未找到 ID 为 '{}' 的端口映射", id),
            format!("Port mapping with ID '{}' not found", id),
        )
    })?;

    let fb_name = mapping
        .fallback_node_name
        .as_ref()
        .filter(|fb| !fb.trim().is_empty())
        .ok_or_else(|| crate::tr!("该端口未配置备用节点", "This port has no fallback node configured"))?;

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
            None,
        )
        .await;
    if mapping.enabled && !mapping.manual_fallback {
        let group_name = format!("fb-{}", mapping.port);
        let _ = state
            .engine
            .test_group_delay(&group_name, Some(actual_url), Some(actual_timeout))
            .await;
    }

    crate::tray::update_tray_menu(&app);

    res.map_err(CommandError::from)
}

#[tauri::command]
pub async fn test_all_port_mappings_delay(
    app: AppHandle,
    test_url: Option<String>,
    timeout_ms: Option<u32>,
    concurrency: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<NodeLatencyResult>, CommandError> {
    let status = state.engine.get_status();
    if !status.running {
        return Err(CommandError::core_not_running(
            "Mihomo 内核未运行，请在设置中启动内核后再进行测速",
            "The Mihomo core is not running. Start the core in Settings before testing latency.",
        ));
    }

    ensure_system_network_online(&state).await?;

    let mappings = state.port_router.get_port_mappings();
    if mappings.is_empty() {
        return Ok(Vec::new());
    }

    let profiles = state.profile_manager.get_profiles();
    let profile_map: std::collections::HashMap<String, String> = profiles.into_iter().map(|p| (p.id, p.name)).collect();

    let (default_url, default_timeout) = {
        let cfg = state.config.read();
        (cfg.test_url.clone(), cfg.timeout_ms)
    };
    let actual_url = test_url.as_deref().unwrap_or(&default_url);
    let actual_timeout = timeout_ms.unwrap_or(default_timeout);

    struct AutoFbGroupTarget {
        mapping_id: String,
        group_name: String,
        primary_name: String,
        primary_runtime: String,
        fb_name: String,
        fb_runtime: String,
    }

    let mut targets = Vec::new();
    let mut mapping_id_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut auto_fb_groups: Vec<AutoFbGroupTarget> = Vec::new();

    for m in mappings.iter().filter(|m| m.enabled) {
        if m.residential_proxy_id.is_some() {
            let target = chain_proxy_name(m.port);
            targets
                .push(crate::core::latency_probe::BatchProbeTarget::new(target.clone()).with_mapping_id(m.id.clone()));
            mapping_id_map.insert(target, m.id.clone());
            continue;
        }
        let runtime_name = if let Some(pname) = profile_map.get(&m.profile_id) {
            format!("[{}] {}", pname, m.node_name)
        } else {
            m.node_name.clone()
        };

        if m.residential_proxy_id.is_none()
            && let Some(fb_name) = &m.fallback_node_name
            && !fb_name.trim().is_empty()
        {
            let fb_profile_id = m.fallback_profile_id.as_deref().unwrap_or(&m.profile_id);
            let fb_runtime_name = if let Some(pname) = profile_map.get(fb_profile_id) {
                format!("[{}] {}", pname, fb_name)
            } else {
                fb_name.clone()
            };

            if !m.manual_fallback {
                // Auto-fallback ports use `GET /group/fb-{port}/delay` directly so primary & backup
                // are only probed ONCE while simultaneously updating Mihomo's fallback selection.
                auto_fb_groups.push(AutoFbGroupTarget {
                    mapping_id: m.id.clone(),
                    group_name: format!("fb-{}", m.port),
                    primary_name: m.node_name.clone(),
                    primary_runtime: runtime_name,
                    fb_name: fb_name.clone(),
                    fb_runtime: fb_runtime_name,
                });
                continue;
            }

            targets.push(
                crate::core::latency_probe::BatchProbeTarget::new(fb_name.clone()).with_runtime_name(fb_runtime_name),
            );
        }

        targets.push(
            crate::core::latency_probe::BatchProbeTarget::new(m.node_name.clone())
                .with_runtime_name(runtime_name)
                .with_mapping_id(m.id.clone()),
        );
        mapping_id_map.insert(m.node_name.clone(), m.id.clone());
    }

    let mut join_set = tokio::task::JoinSet::new();
    for grp in auto_fb_groups {
        let engine = state.engine.clone();
        let url = actual_url.to_string();
        join_set.spawn(async move {
            let res = engine
                .test_group_delay(&grp.group_name, Some(&url), Some(actual_timeout))
                .await;
            (grp, res)
        });
    }

    let mut results = if !targets.is_empty() {
        state
            .latency_probe
            .test_nodes_batch(&targets, Some(actual_url), Some(actual_timeout), concurrency)
            .await
    } else {
        Vec::new()
    };

    for res in &results {
        if res.error.as_deref() == Some("Cancelled") {
            continue;
        }
        if let Some(mapping_id) = mapping_id_map.get(&res.name) {
            let _ = state.port_router.update_port_latency(mapping_id, res.latency);
        }
    }

    let timeout_err = crate::tr!(
        format!("测速超时（{actual_timeout} 毫秒）"),
        format!("Latency test timed out after {actual_timeout}ms"),
    );
    while let Some(Ok((grp, group_res))) = join_set.join_next().await {
        let delays = group_res.unwrap_or_default();
        let primary_delay = delays
            .get(&grp.primary_runtime)
            .or_else(|| delays.get(&grp.primary_name))
            .copied();
        let fb_delay = delays
            .get(&grp.fb_runtime)
            .or_else(|| delays.get(&grp.fb_name))
            .copied();

        let primary_err = if primary_delay.is_none() {
            Some(timeout_err.clone())
        } else {
            None
        };
        let fb_err = if fb_delay.is_none() {
            Some(timeout_err.clone())
        } else {
            None
        };

        state.latency_probe.record_node_result(
            &grp.primary_name,
            Some(&grp.primary_runtime),
            primary_delay,
            primary_err.clone(),
            Some(&grp.mapping_id),
        );
        state.latency_probe.record_node_result(
            &grp.fb_name,
            Some(&grp.fb_runtime),
            fb_delay,
            fb_err.clone(),
            Some(&grp.mapping_id),
        );

        let _ = state.port_router.update_port_latency(&grp.mapping_id, primary_delay);

        results.push(NodeLatencyResult {
            name: grp.primary_name,
            latency: primary_delay,
            error: primary_err,
        });
        results.push(NodeLatencyResult {
            name: grp.fb_name,
            latency: fb_delay,
            error: fb_err,
        });
    }

    crate::tray::update_tray_menu(&app);
    Ok(results)
}

/// Background fallback status polling updates the in-memory latency cache immediately,
/// while throttling `latencies.json` disk writes to avoid frequent I/O on every 5s tick.
const FALLBACK_LATENCY_PERSIST_INTERVAL: std::time::Duration = std::time::Duration::from_secs(60);

/// Resolve displayed node latency with Mihomo kernel history as the runtime source of truth.
/// Falls back to cached/persisted latency only when the kernel has no history yet.
fn resolve_fallback_node_latency(
    kernel_history_delay: Option<u32>,
    cached_entry: Option<Option<u32>>,
    mapping_latency: Option<u32>,
    force_kernel_only: bool,
) -> Option<u32> {
    match kernel_history_delay {
        Some(d) if d > 0 => Some(d),
        Some(_) => None,
        None if force_kernel_only => None,
        None => match cached_entry {
            Some(None) => None,
            Some(Some(d)) => Some(d),
            None => mapping_latency,
        },
    }
}

/// Built-in connectivity probe URLs matching the frontend preset list.
const BUILTIN_TEST_URLS: [&str; 4] = [
    "http://cp.cloudflare.com/generate_204",
    "http://www.google.com/generate_204",
    "http://captive.apple.com/hotspot-detect.html",
    "http://www.msftconnecttest.com/connecttest.txt",
];

/// Maximum number of probe URLs raced concurrently during a timeout recheck.
const MAX_RECHECK_URLS: usize = 3;

/// Detect a first-time transition from reachable -> timeout.
/// Single-shot probes (especially on cold-start or transient target-site hiccups)
/// can occasionally time out once; confirming once avoids false timeout alerts
/// while preventing repeated rechecks on already-confirmed dead nodes.
fn should_recheck_timeout(
    history: &[crate::core::clash_client::ProxyHistoryItem],
    cached_entry: Option<Option<u32>>,
) -> bool {
    if history.last().map(|h| h.delay) != Some(0) {
        return false;
    }
    let prev_history_reachable = history.len() >= 2 && history[history.len() - 2].delay > 0;
    let cache_reachable = matches!(cached_entry, Some(Some(d)) if d > 0);
    prev_history_reachable || cache_reachable
}

/// Build candidate URLs for timeout confirmation.
/// - Built-in URL: race the configured URL alongside up to 2 other built-in URLs (max 3 total).
/// - Custom URL: recheck only the user's configured URL to respect custom endpoint intent.
fn build_recheck_urls(primary_url: &str) -> Vec<String> {
    let trimmed = primary_url.trim();
    let is_builtin = BUILTIN_TEST_URLS.iter().any(|&u| u.eq_ignore_ascii_case(trimmed));
    if !is_builtin {
        return vec![trimmed.to_string()];
    }
    let mut urls = Vec::with_capacity(MAX_RECHECK_URLS);
    urls.push(trimmed.to_string());
    for &candidate in &BUILTIN_TEST_URLS {
        if urls.len() >= MAX_RECHECK_URLS {
            break;
        }
        if !candidate.eq_ignore_ascii_case(trimmed) {
            urls.push(candidate.to_string());
        }
    }
    urls
}

static NODE_RECHECK_COOLDOWN: std::sync::LazyLock<
    parking_lot::Mutex<std::collections::HashMap<String, std::time::Instant>>,
> = std::sync::LazyLock::new(|| parking_lot::Mutex::new(std::collections::HashMap::new()));

const NODE_RECHECK_COOLDOWN_SECS: u64 = 30;

/// Concurrently probe candidate URLs and return the first positive delay.
/// Bounded by a single `timeout_ms` even when the node is genuinely unreachable,
/// and rate-limited per node so confirmed-dead nodes do not trigger repeated 3-URL storms.
async fn recheck_node_delay_concurrent(
    engine: &crate::core::kernel_engine::KernelEngine,
    runtime_name: &str,
    primary_url: &str,
    timeout_ms: u32,
    cooldown_secs: u64,
) -> Option<u32> {
    let now = std::time::Instant::now();
    {
        let mut map = NODE_RECHECK_COOLDOWN.lock();
        if let Some(&last) = map.get(runtime_name)
            && now.duration_since(last) < std::time::Duration::from_secs(cooldown_secs)
        {
            return None;
        }
        map.insert(runtime_name.to_string(), now);
    }

    let urls = build_recheck_urls(primary_url);
    let mut join_set = tokio::task::JoinSet::new();
    for url in urls {
        let eng = engine.clone();
        let name = runtime_name.to_string();
        join_set.spawn(async move { eng.test_delay(&name, Some(&url), Some(timeout_ms)).await });
    }
    while let Some(res) = join_set.join_next().await {
        if let Ok(Ok(delay)) = res
            && delay > 0
        {
            join_set.abort_all();
            return Some(delay);
        }
    }
    None
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
    let profile_map: std::collections::HashMap<String, String> =
        profiles.iter().map(|p| (p.id.clone(), p.name.clone())).collect();
    let profile_enabled_map: std::collections::HashMap<String, bool> =
        profiles.into_iter().map(|p| (p.id, p.enabled)).collect();

    let (default_url, default_timeout, fallback_interval_secs) = {
        let cfg = state.config.read();
        (cfg.test_url.clone(), cfg.timeout_ms, u64::from(cfg.fallback_interval))
    };
    let engine = state.engine.clone();
    let mut statuses = Vec::new();
    let mut latency_updates: Vec<(String, Option<u32>)> = Vec::new();
    let now_ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let system_online = state.network_monitor.check_now().await.online;

    for m in mappings
        .into_iter()
        .filter(|m| m.enabled && m.fallback_node_name.is_some())
    {
        let fallback_node = match &m.fallback_node_name {
            Some(fb) if !fb.trim().is_empty() => fb.clone(),
            _ => continue,
        };

        let fb_profile_id = m.fallback_profile_id.as_deref().unwrap_or(&m.profile_id);
        let primary_profile_enabled = profile_enabled_map.get(&m.profile_id).copied().unwrap_or(false);
        let fb_profile_enabled = profile_enabled_map.get(fb_profile_id).copied().unwrap_or(false);

        let group_name = format!("fb-{}", m.port);
        let mut is_fallback_active = if m.manual_fallback {
            true
        } else if let Ok(detail) = engine.get_proxy_detail(&group_name).await {
            let active_node = detail.now.clone().unwrap_or_default();
            active_node.ends_with(&fallback_node)
        } else {
            !primary_profile_enabled && fb_profile_enabled
        };

        let primary_runtime_name = if let Some(pname) = profile_map.get(&m.profile_id) {
            format!("[{}] {}", pname, m.node_name)
        } else {
            m.node_name.clone()
        };

        let fb_runtime_name = if let Some(pname) = profile_map.get(fb_profile_id) {
            format!("[{}] {}", pname, fallback_node)
        } else {
            fallback_node.clone()
        };

        let cached_primary_entry = state
            .latency_probe
            .get_latency(&primary_runtime_name)
            .or_else(|| state.latency_probe.get_latency(&m.node_name));

        let primary_history = engine
            .get_proxy_detail(&primary_runtime_name)
            .await
            .ok()
            .map(|p| p.history)
            .unwrap_or_default();
        let mut kernel_primary_history_delay = primary_history.last().map(|h| h.delay);
        let need_first_timeout_recheck = should_recheck_timeout(&primary_history, cached_primary_entry);
        let need_fallback_recovery_probe = !m.manual_fallback && is_fallback_active && primary_profile_enabled;
        let mut primary_recheck_succeeded = false;
        if system_online && (need_first_timeout_recheck || need_fallback_recovery_probe) {
            let cooldown_secs = if need_first_timeout_recheck {
                NODE_RECHECK_COOLDOWN_SECS
            } else {
                fallback_interval_secs.max(NODE_RECHECK_COOLDOWN_SECS)
            };
            if let Some(d) = recheck_node_delay_concurrent(
                &engine,
                &primary_runtime_name,
                &default_url,
                default_timeout,
                cooldown_secs,
            )
            .await
            {
                kernel_primary_history_delay = Some(d);
                primary_recheck_succeeded = true;
            }
        }
        // When an auto-fallback port's primary node recovers during recheck, immediately refresh
        // the Mihomo fallback group so the kernel switches back to primary in the same poll cycle
        // instead of surfacing a transient amber warning or staying stuck under lazy mode.
        if !m.manual_fallback && is_fallback_active && primary_recheck_succeeded {
            let _ = engine
                .test_group_delay(&group_name, Some(&default_url), Some(default_timeout))
                .await;
            if let Ok(detail) = engine.get_proxy_detail(&group_name).await {
                let active_node = detail.now.unwrap_or_default();
                is_fallback_active = active_node.ends_with(&fallback_node);
            }
            if let Ok(p_detail) = engine.get_proxy_detail(&primary_runtime_name).await
                && let Some(last) = p_detail.history.last()
                && last.delay > 0
            {
                kernel_primary_history_delay = Some(last.delay);
            }
        }
        let kernel_primary_timed_out = kernel_primary_history_delay == Some(0);

        let mut primary_latency = resolve_fallback_node_latency(
            kernel_primary_history_delay,
            cached_primary_entry,
            m.latency,
            is_fallback_active && !m.manual_fallback,
        );

        let cached_fb_entry = state
            .latency_probe
            .get_latency(&fb_runtime_name)
            .or_else(|| state.latency_probe.get_latency(&fallback_node));

        let fb_history = engine
            .get_proxy_detail(&fb_runtime_name)
            .await
            .ok()
            .map(|p| p.history)
            .unwrap_or_default();
        let mut kernel_fb_history_delay = fb_history.last().map(|h| h.delay);
        if system_online
            && should_recheck_timeout(&fb_history, cached_fb_entry)
            && let Some(d) = recheck_node_delay_concurrent(
                &engine,
                &fb_runtime_name,
                &default_url,
                default_timeout,
                NODE_RECHECK_COOLDOWN_SECS,
            )
            .await
        {
            kernel_fb_history_delay = Some(d);
        }
        let kernel_fb_timed_out = kernel_fb_history_delay == Some(0);

        let mut fallback_latency = resolve_fallback_node_latency(kernel_fb_history_delay, cached_fb_entry, None, false);

        // If primary node is known to have timed out (`Some(None)` in probe cache or `delay == 0` in kernel history),
        // fallback node is reachable, and Mihomo has not yet switched `fb-{port}` to the backup node,
        // immediately trigger group healthcheck and re-query `fb-{port}` so fallback engages without delay.
        let primary_known_timeout = kernel_primary_timed_out || cached_primary_entry == Some(None);
        if system_online
            && !m.manual_fallback
            && !is_fallback_active
            && primary_known_timeout
            && fallback_latency.is_some()
        {
            let _ = engine
                .test_group_delay(&group_name, Some(&default_url), Some(default_timeout))
                .await;
            if let Ok(detail) = engine.get_proxy_detail(&group_name).await {
                let active_node = detail.now.unwrap_or_default();
                is_fallback_active = active_node.ends_with(&fallback_node);
            }
            if let Ok(p_detail) = engine.get_proxy_detail(&primary_runtime_name).await
                && let Some(last) = p_detail.history.last()
            {
                primary_latency = if last.delay > 0 { Some(last.delay) } else { None };
            }
            if let Ok(fb_detail) = engine.get_proxy_detail(&fb_runtime_name).await
                && let Some(last) = fb_detail.history.last()
            {
                fallback_latency = if last.delay > 0 { Some(last.delay) } else { None };
            }
        }

        let active_node = if is_fallback_active {
            fallback_node.clone()
        } else {
            m.node_name.clone()
        };

        if system_online {
            if ((is_fallback_active && !m.manual_fallback) || primary_known_timeout) && primary_latency.is_none() {
                latency_updates.push((primary_runtime_name, None));
                latency_updates.push((m.node_name.clone(), None));
            } else if let Some(d) = primary_latency {
                latency_updates.push((primary_runtime_name, Some(d)));
                latency_updates.push((m.node_name.clone(), Some(d)));
            }
            if kernel_fb_timed_out && fallback_latency.is_none() {
                latency_updates.push((fb_runtime_name, None));
                latency_updates.push((fallback_node.clone(), None));
            } else if let Some(d) = fallback_latency {
                latency_updates.push((fb_runtime_name, Some(d)));
                latency_updates.push((fallback_node.clone(), Some(d)));
            }
            // Port mapping latency represents the primary node latency; never overwrite with fallback latency!
            let _ = state.port_router.update_port_latency(&m.id, primary_latency);
        } else {
            // Host network is offline: preserve last known latencies instead of overwriting with false timeouts.
            primary_latency = cached_primary_entry.flatten().or(m.latency);
            fallback_latency = cached_fb_entry.flatten();
        }
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
        state
            .latency_probe
            .set_latencies_batch_throttled(&latency_updates, FALLBACK_LATENCY_PERSIST_INTERVAL);
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
    let residential_proxies = state.config.read().residential_proxies.clone();
    let drift_reports = DriftGuard::check_all(&mappings, &state.profile_manager, &residential_proxies);
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
pub async fn set_profile_enabled(id: String, enabled: bool, state: State<'_, AppState>) -> Result<ProfileItem, String> {
    let item = state
        .profile_manager
        .set_profile_enabled(&id, enabled)
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
    let residential_proxies = state.config.read().residential_proxies.clone();
    let drift_reports = DriftGuard::check_all(&mappings, &state.profile_manager, &residential_proxies);
    let has_drift = drift_reports.iter().any(|r| r.status != DriftStatus::Healthy);
    if has_drift {
        let _ = app.emit("node-drift-detected", &drift_reports);
    }

    Ok(())
}

#[tauri::command]
pub async fn get_drift_reports(state: State<'_, AppState>) -> Result<Vec<PortDriftReport>, String> {
    let mappings = state.port_router.get_port_mappings();
    let residential_proxies = state.config.read().residential_proxies.clone();
    let reports = DriftGuard::check_all(&mappings, &state.profile_manager, &residential_proxies);
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
        std::fs::create_dir_all(dir)
            .map_err(|e| crate::tr!(format!("创建目录失败: {e}"), format!("Failed to create directory: {e}"),))?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(dir)
            .spawn()
            .map_err(|e| crate::tr!(format!("打开目录失败: {e}"), format!("Failed to open directory: {e}"),))?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(dir)
            .spawn()
            .map_err(|e| crate::tr!(format!("打开目录失败: {e}"), format!("Failed to open directory: {e}"),))?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| crate::tr!(format!("打开目录失败: {e}"), format!("Failed to open directory: {e}"),))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn open_file_in_folder(file_path: String) -> Result<(), String> {
    let path = std::path::PathBuf::from(&file_path);
    if !path.exists() {
        return Err(crate::tr!(
            format!("文件不存在: {file_path}"),
            format!("File does not exist: {file_path}"),
        ));
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(format!("/select,{}", path.display()))
            .spawn()
            .map_err(|e| {
                crate::tr!(
                    format!("打开资源管理器失败: {e}"),
                    format!("Failed to open explorer: {e}"),
                )
            })?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| crate::tr!(format!("打开访达失败: {e}"), format!("Failed to open finder: {e}"),))?;
    }
    #[cfg(target_os = "linux")]
    {
        let parent = path.parent().unwrap_or(&path);
        Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| crate::tr!(format!("打开目录失败: {e}"), format!("Failed to open directory: {e}"),))?;
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
    skip_cache: Option<bool>,
    state: State<'_, AppState>,
) -> Result<u32, CommandError> {
    let status = state.engine.get_status();
    if !status.running {
        return Err(CommandError::core_not_running(
            "Mihomo 内核未运行，请在设置中启动内核后再进行测速",
            "The Mihomo core is not running. Start the core in Settings before testing latency.",
        ));
    }
    ensure_system_network_online(&state).await?;

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

    if skip_cache.unwrap_or(false) {
        return state
            .latency_probe
            .probe_node_ephemeral(
                &raw_name,
                runtime_name.as_deref(),
                Some(actual_url),
                Some(actual_timeout),
            )
            .await
            .map_err(CommandError::from);
    }

    let res = state
        .latency_probe
        .test_node(
            &raw_name,
            runtime_name.as_deref(),
            Some(actual_url),
            Some(actual_timeout),
            None,
        )
        .await;

    let tested_latency = res.as_ref().ok().copied();
    let mappings = state.port_router.get_port_mappings();
    for m in &mappings {
        let matches_primary =
            m.node_name == raw_name || m.node_name == node_name || runtime_name.as_deref() == Some(&m.node_name);
        if matches_primary {
            let _ = state.port_router.update_port_latency(&m.id, tested_latency);
        }
        let matches_fallback = m
            .fallback_node_name
            .as_deref()
            .is_some_and(|fb| fb == raw_name || fb == node_name || runtime_name.as_deref() == Some(fb));
        if m.enabled
            && !m.manual_fallback
            && m.fallback_node_name.as_ref().is_some_and(|fb| !fb.trim().is_empty())
            && (matches_primary || matches_fallback)
        {
            let group_name = format!("fb-{}", m.port);
            let _ = state
                .engine
                .test_group_delay(&group_name, Some(actual_url), Some(actual_timeout))
                .await;
        }
    }
    crate::tray::update_tray_menu(&app);

    res.map_err(CommandError::from)
}

#[tauri::command]
pub async fn test_nodes_delay_batch(
    app: AppHandle,
    node_names: Vec<String>,
    test_url: Option<String>,
    timeout_ms: Option<u32>,
    concurrency: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<NodeLatencyResult>, CommandError> {
    let status = state.engine.get_status();
    if !status.running {
        return Err(CommandError::core_not_running(
            "Mihomo 内核未运行，请在设置中启动内核后再进行测速",
            "The Mihomo core is not running. Start the core in Settings before testing latency.",
        ));
    }
    ensure_system_network_online(&state).await?;

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
    let mut affected_groups = std::collections::HashSet::new();
    for res in &results {
        let raw_name = raw_name_map.get(&res.name).cloned().unwrap_or_else(|| res.name.clone());
        for m in &mappings {
            let matches_primary = m.node_name == res.name || m.node_name == raw_name;
            if matches_primary {
                let _ = state.port_router.update_port_latency(&m.id, res.latency);
            }
            let matches_fallback = m
                .fallback_node_name
                .as_deref()
                .is_some_and(|fb| fb == res.name || fb == raw_name);
            if m.enabled
                && !m.manual_fallback
                && m.fallback_node_name.as_ref().is_some_and(|fb| !fb.trim().is_empty())
                && (matches_primary || matches_fallback)
            {
                affected_groups.insert(format!("fb-{}", m.port));
            }
        }
    }

    if !affected_groups.is_empty() {
        let mut join_set = tokio::task::JoinSet::new();
        for group in affected_groups {
            let engine = state.engine.clone();
            let url = actual_url.to_string();
            join_set.spawn(async move {
                let _ = engine.test_group_delay(&group, Some(&url), Some(actual_timeout)).await;
            });
        }
        while join_set.join_next().await.is_some() {}
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
pub async fn clear_latency_cache(state: State<'_, AppState>) -> Result<(), String> {
    let probe = state.latency_probe.clone();
    tokio::task::spawn_blocking(move || probe.clear_latencies())
        .await
        .map_err(|e| format!("Task join error: {e}"))?;
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
pub async fn check_app_update(
    state: State<'_, AppState>,
) -> Result<crate::core::app_updater::AppUpdateCheckResult, String> {
    crate::core::app_updater::check_app_update(&state)
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
        let sizes = crate::tray::main_window_sizes(&app);
        let _ = window.set_size(tauri::LogicalSize::new(sizes.width, sizes.height));
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
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub async fn hide_window(app: AppHandle) -> Result<(), String> {
    if let Some(state) = app.try_state::<AppState>() {
        let is_lightweight = state.config.read().lightweight_mode;
        if is_lightweight {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.destroy();
            }
            return Ok(());
        }
    }
    if let Some(window) = app.get_webview_window("main") {
        crate::tray::hide_main_webview_window(&window);
    }
    Ok(())
}

#[tauri::command]
pub async fn show_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        crate::tray::activate_window(&window);
    }
    Ok(())
}

/// Releases the hidden webview of a silent lightweight startup once the frontend has
/// synchronized the tray locale and reported readiness. The window must stay invisible so
/// silent startup never flashes on screen; a visible window means the user reopened it from
/// the tray (or it was displayed concurrently), so it is kept alive instead.
pub(crate) fn destroy_hidden_silent_window(state: &AppState, window: &tauri::WebviewWindow, source: &str) -> bool {
    if !state.config.read().lightweight_mode {
        return false;
    }
    if state.initial_window_shown.load(std::sync::atomic::Ordering::SeqCst) {
        tracing::debug!("{}: main window was already displayed; skipping teardown", source);
        return false;
    }
    match window.is_visible() {
        Ok(false) => {
            if let Err(err) = window.destroy() {
                tracing::debug!("{}: hidden main window was already gone: {}", source, err);
                return false;
            }
            tracing::info!(
                "{}: hidden lightweight webview destroyed after tray locale sync",
                source
            );
            true
        }
        Ok(true) => {
            // The frontend of a recreated window calls `app_ready` too. Mark it as shown so
            // the startup fallback timer cannot tear down the window the user just opened.
            state
                .initial_window_shown
                .store(true, std::sync::atomic::Ordering::SeqCst);
            tracing::info!("{}: main window is visible (reopened); keeping it alive", source);
            false
        }
        Err(err) => {
            tracing::debug!("{}: main window no longer exists: {}", source, err);
            false
        }
    }
}

/// Wrapper around [`crate::tray::set_ui_locale`] that keeps synchronization failures
/// observable in backend logs: in lightweight mode the hidden webview can be gone before
/// the UI error toast has a chance to be seen.
#[tauri::command]
pub fn set_ui_locale(app: AppHandle, locale: String) -> Result<(), String> {
    if let Some(state) = app.try_state::<AppState>() {
        let cfg = {
            let mut cfg = state.config.write();
            if cfg.language.as_deref() == Some(locale.as_str()) {
                None
            } else {
                cfg.language = Some(locale.clone());
                Some(cfg.clone())
            }
        };
        if let Some(cfg) = cfg
            && let Err(err) = state.persist_config(&cfg)
        {
            tracing::warn!("Failed to persist UI locale to config: {}", err);
        }
    }
    crate::tray::set_ui_locale(app, locale).map_err(|err| {
        tracing::warn!("Failed to synchronize the tray locale: {}", err);
        err
    })
}

#[tauri::command]
pub async fn app_ready(app: AppHandle) -> Result<(), String> {
    if let Some(state) = app.try_state::<AppState>() {
        if state.is_silent_start.load(std::sync::atomic::Ordering::SeqCst) {
            if state.config.read().lightweight_mode {
                // The frontend syncs the tray locale before calling `app_ready`, so the
                // hidden webview has fulfilled its only startup purpose now.
                if let Some(window) = app.get_webview_window("main") {
                    destroy_hidden_silent_window(state.inner(), &window, "app_ready");
                }
            } else {
                tracing::info!("Frontend app_ready received in silent start mode; keeping window hidden");
            }
            return Ok(());
        }
        if !state
            .initial_window_shown
            .swap(true, std::sync::atomic::Ordering::SeqCst)
            && let Some(window) = app.get_webview_window("main")
        {
            let _ = window.show();
            tracing::info!("Frontend app_ready received; main window displayed");
        }
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
    let res = crate::core::geo_manager::update_mrs_rules(work_dir)
        .await
        .map_err(|e| e.to_string())?;
    // If engine is active, reload config seamlessly
    if state.engine.get_status().running {
        let runtime_path = work_dir.join("runtime.yaml");
        let _ = state.engine.reload_config(&runtime_path.to_string_lossy()).await;
    }
    Ok(res)
}

#[tauri::command]
pub async fn query_direct_egress_info(port: Option<u16>, timeout_ms: Option<u64>) -> Result<DirectEgressInfo, String> {
    crate::core::egress_probe::query_direct_egress_info(port, timeout_ms)
        .await
        .map_err(|e| e.to_string())
}

async fn with_node_probe_channel<T, F, Fut>(
    state: &AppState,
    node_name: &str,
    profile_id: Option<&str>,
    probe: F,
) -> Result<T, String>
where
    F: FnOnce(Option<u16>) -> Fut,
    Fut: Future<Output = Result<T, String>>,
{
    if node_name.trim().is_empty() {
        return Err(crate::tr!("节点名称不能为空", "Node name cannot be empty").to_string());
    }
    if node_name == "DIRECT" {
        return probe(None).await;
    }

    let status = state.engine.get_status();
    if !status.running {
        return Err(crate::tr!(
            "Mihomo 内核未运行，请先启动内核后再探测节点出口 IP",
            "The Mihomo core is not running. Start the core before probing the node egress IP."
        )
        .to_string());
    }

    let all_nodes = state.profile_manager.get_all_nodes();
    let target_runtime_name = if let Some(pid) = profile_id
        && !pid.trim().is_empty()
    {
        if let Some(found) = all_nodes
            .iter()
            .find(|n| n.profile_id.as_deref() == Some(pid) && n.name == node_name)
        {
            found.runtime_name.clone().unwrap_or_else(|| found.name.clone())
        } else if let Some(prof) = state.profile_manager.get_profile_by_id(pid) {
            format!("[{}] {}", prof.name, node_name)
        } else {
            node_name.to_string()
        }
    } else if let Some(found) = all_nodes
        .iter()
        .find(|n| n.runtime_name.as_deref() == Some(node_name) || n.name == node_name)
    {
        found.runtime_name.clone().unwrap_or_else(|| found.name.clone())
    } else {
        node_name.to_string()
    };

    let mut probe_port_opt = *state.egress_probe_port.read();
    if probe_port_opt.is_none() {
        let _ = state.sync_runtime_config().await;
        probe_port_opt = *state.egress_probe_port.read();
    }
    let probe_port = probe_port_opt.ok_or_else(|| {
        crate::tr!(
            "未能分配内部出口探测监听端口",
            "Failed to allocate an internal egress probe listener port"
        )
        .to_string()
    })?;

    let _guard = state.egress_probe_lock.lock().await;
    state
        .engine
        .select_proxy(
            crate::core::config_generator::EGRESS_PROBE_GROUP_NAME,
            &target_runtime_name,
        )
        .await
        .map_err(|e| {
            crate::tr!(
                format!("切换节点探测通道失败: {e}"),
                format!("Failed to switch the node probe channel: {e}"),
            )
        })?;

    probe(Some(probe_port)).await
}

#[tauri::command]
pub async fn query_node_egress_info(
    node_name: String,
    profile_id: Option<String>,
    timeout_ms: Option<u64>,
    state: State<'_, AppState>,
) -> Result<DirectEgressInfo, String> {
    with_node_probe_channel(&state, &node_name, profile_id.as_deref(), |port| async move {
        match port {
            None => crate::core::egress_probe::query_direct_egress_info(None, timeout_ms)
                .await
                .map_err(|e| e.to_string()),
            Some(p) => crate::core::egress_probe::query_proxy_egress_info(p, timeout_ms)
                .await
                .map_err(|e| e.to_string()),
        }
    })
    .await
}

#[tauri::command]
pub async fn query_node_ip_quality(
    node_name: String,
    profile_id: Option<String>,
    timeout_ms: Option<u64>,
    state: State<'_, AppState>,
) -> Result<NodeIpQualityReport, String> {
    with_node_probe_channel(&state, &node_name, profile_id.as_deref(), |port| async move {
        crate::core::ip_quality::query_ip_quality(port, timeout_ms)
            .await
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn query_node_media_unlock(
    node_name: String,
    profile_id: Option<String>,
    timeout_ms: Option<u64>,
    state: State<'_, AppState>,
) -> Result<NodeMediaUnlockReport, String> {
    with_node_probe_channel(&state, &node_name, profile_id.as_deref(), |port| async move {
        Ok(crate::core::ip_quality::query_media_unlock(port, timeout_ms).await)
    })
    .await
}

/// Tests a saved residential exit through the selected upstream node using a disposable,
/// isolated Mihomo instance. The live runtime config, listeners, and connections are never
/// touched, and no probe config is persisted.
#[tauri::command]
pub async fn test_residential_proxy(
    residential_proxy_id: String,
    profile_id: String,
    node_name: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ResidentialProxyTestResult, String> {
    state
        .probe_residential_chain(Some(&app), &residential_proxy_id, &profile_id, &node_name, None)
        .await
}

#[tauri::command]
pub async fn test_chain_node_exit(
    exit_profile_id: String,
    exit_node_name: String,
    upstream_profile_id: String,
    upstream_node_name: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ResidentialProxyTestResult, String> {
    state
        .probe_node_chain(
            Some(&app),
            &exit_profile_id,
            &exit_node_name,
            &upstream_profile_id,
            &upstream_node_name,
        )
        .await
}

/// Probes egress through a specific local listener using its actual inbound protocol.
/// This is the accurate path for chain ports and SOCKS5-only listeners.
#[tauri::command]
pub async fn query_port_egress_info(
    port: u16,
    protocol: InboundProtocol,
    timeout_ms: Option<u64>,
) -> Result<DirectEgressInfo, String> {
    crate::core::egress_probe::query_port_egress_info(port, protocol, timeout_ms)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_connections(state: State<'_, AppState>) -> Result<ConnectionSnapshot, String> {
    let status = state.engine.get_status();
    if !status.running {
        return Err(crate::tr!("Mihomo 内核未运行", "The Mihomo core is not running").to_string());
    }
    state
        .engine
        .adapter()
        .get_connections()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn close_connection(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let status = state.engine.get_status();
    if !status.running {
        return Err(crate::tr!("Mihomo 内核未运行", "The Mihomo core is not running").to_string());
    }
    state
        .engine
        .adapter()
        .close_connection(&id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn close_all_connections(state: State<'_, AppState>) -> Result<(), String> {
    let status = state.engine.get_status();
    if !status.running {
        return Err(crate::tr!("Mihomo 内核未运行", "The Mihomo core is not running").to_string());
    }
    state
        .engine
        .adapter()
        .close_all_connections()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_port_process_history(
    port: u16,
    state: State<'_, AppState>,
) -> Result<Vec<PortProcessUsageItem>, String> {
    Ok(state.get_port_process_history(port).await)
}

#[tauri::command]
pub async fn clear_port_process_history(port: u16, state: State<'_, AppState>) -> Result<(), String> {
    state.clear_port_process_history(port).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn get_sniffed_access_logs(
    since_epoch_ms: u64,
    state: State<'_, AppState>,
) -> Result<Vec<SniffedAccessLogEntry>, String> {
    let log_dir = state.engine.work_dir().join("logs");
    let app_dir = state.app_dir.clone();
    tokio::task::spawn_blocking(move || {
        let mut entries = crate::core::supervisor::read_recent_access_logs(&log_dir, since_epoch_ms);
        if app_dir.to_string_lossy().ends_with(".dev")
            && let Some(parent) = app_dir.parent()
        {
            let prod_log_dir = parent.join("com.mihomo.multi").join("core").join("logs");
            if prod_log_dir.is_dir() {
                let prod_entries = crate::core::supervisor::read_recent_access_logs(&prod_log_dir, since_epoch_ms);
                entries.extend(prod_entries);
            }
        }
        entries
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))
}

const SNIFFER_WEBVIEW_LABEL: &str = "sniffer-sandbox";

/// Resolve an active inbound listener mapping for the built-in sniffer WebView sandbox.
/// - When `preferred_port` is specified (single-port rule), enforces deterministic routing:
///   if that port is disabled or missing, returns an explicit error instead of drifting to another port.
/// - When `preferred_port` is `None` (global rule), selects the first enabled proxy port (or direct fallback).
fn resolve_sniffer_proxy_mapping(mappings: &[PortMapping], preferred_port: Option<u16>) -> Result<PortMapping, String> {
    if let Some(port) = preferred_port {
        if let Some(found) = mappings.iter().find(|m| m.port == port) {
            if !found.enabled {
                return Err(crate::tr!(
                    format!("当前监听端口 {} 尚未启用，请先启用该端口后再执行沙盒嗅探", port),
                    format!(
                        "Listener port {} is not enabled; enable it before running sandbox sniffing",
                        port
                    ),
                ));
            }
            return Ok(found.clone());
        }
        return Err(crate::tr!(
            format!("未找到监听端口 {} 的配置映射", port),
            format!("No port mapping found for listener port {}", port),
        ));
    }

    if let Some(found) = mappings.iter().find(|m| m.enabled && m.id != FIXED_DIRECT_PORT_ID) {
        return Ok(found.clone());
    }

    if let Some(found) = mappings.iter().find(|m| m.enabled) {
        return Ok(found.clone());
    }

    Err(crate::tr!(
        "未找到已启用的监听端口，请先启用至少一个端口映射后再执行沙盒嗅探",
        "No enabled listener port found; enable at least one port mapping before running sandbox sniffing"
    )
    .to_string())
}

#[tauri::command]
pub async fn close_sniffer_webview(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(SNIFFER_WEBVIEW_LABEL) {
        let _ = win.destroy();
    }
    Ok(())
}

#[tauri::command]
pub async fn open_sniffer_webview(
    url: String,
    proxy_port: Option<u16>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<u16, String> {
    let status = state.engine.get_status();
    if !status.running {
        return Err(crate::tr!(
            "请先启动 Mihomo 内核后再进行流量链路嗅探",
            "Start the Mihomo core before sniffing traffic chains"
        )
        .to_string());
    }

    let parsed_url: tauri::Url = url.parse().map_err(|e| {
        crate::tr!(
            format!("无效的目标网址 ({url}): {e}"),
            format!("Invalid target URL ({url}): {e}"),
        )
    })?;
    let host_display = parsed_url.host_str().unwrap_or(&url).to_string();

    let mappings = state.port_router.get_port_mappings();
    let target_mapping = resolve_sniffer_proxy_mapping(&mappings, proxy_port)?;
    let bound_port = target_mapping.port;
    let scheme = match target_mapping.protocol {
        InboundProtocol::Socks5 => "socks5",
        InboundProtocol::Mixed | InboundProtocol::Http => "http",
    };
    let proxy_addr = format!("{}://127.0.0.1:{}", scheme, bound_port);
    let proxy_url: tauri::Url = proxy_addr.parse().map_err(|e| {
        crate::tr!(
            format!("构造本地代理地址失败: {e}"),
            format!("Failed to build the local proxy address: {e}"),
        )
    })?;

    if let Some(existing_win) = app.get_webview_window(SNIFFER_WEBVIEW_LABEL) {
        let _ = existing_win.destroy();
        tokio::time::sleep(std::time::Duration::from_millis(80)).await;
    }

    // Isolate WebView2 user-data directory per proxy port so Windows WebView2 creates a dedicated
    // environment bound to this exact proxy port rather than reusing an existing environment.
    let sandbox_data_dir = state
        .app_dir
        .join("sniffer-webview-sandbox")
        .join(format!("port-{}", bound_port));
    let _ = std::fs::create_dir_all(&sandbox_data_dir);

    let browser_args = format!(
        "--proxy-server={} --proxy-bypass-list=localhost;127.0.0.1;[::1] --disable-background-networking --disable-component-update --disable-domain-reliability --no-first-run --disable-features=msEdgeECS,msEdgeShopping,msImplicitSignin",
        proxy_addr
    );

    let app_for_load = app.clone();
    let host_for_load = host_display.clone();
    let window = tauri::WebviewWindowBuilder::new(&app, SNIFFER_WEBVIEW_LABEL, tauri::WebviewUrl::External(parsed_url))
        .title(crate::tr!(
            format!("⏳ [正在加载网页...] {} | 链路嗅探沙盒 (隔离出口 :{})", host_display, bound_port),
            format!(
                "⏳ [Loading page...] {} | Chain Sniffer Sandbox (isolated exit :{})",
                host_display, bound_port
            ),
        ))
        .inner_size(960.0, 660.0)
        .min_inner_size(680.0, 460.0)
        .center()
        .visible(true)
        .focused(true)
        .incognito(true)
        .data_directory(sandbox_data_dir)
        .proxy_url(proxy_url)
        .additional_browser_args(&browser_args)
        .on_page_load(move |webview, payload| {
            let url_str = payload.url().as_str();
            if url_str.is_empty() || url_str == "about:blank" {
                return;
            }
            match payload.event() {
                tauri::webview::PageLoadEvent::Started => {
                    let _ = webview.set_title(&crate::tr!(
                        format!(
                            "⏳ [正在加载网页...] {} | 链路嗅探沙盒 (隔离出口 :{})",
                            host_for_load, bound_port
                        ),
                        format!(
                            "⏳ [Loading page...] {} | Chain Sniffer Sandbox (isolated exit :{})",
                            host_for_load, bound_port
                        ),
                    ));
                    let _ = app_for_load.emit("sniffer-page-loading", url_str.to_string());
                }
                tauri::webview::PageLoadEvent::Finished => {
                    let _ = webview.set_title(&crate::tr!(
                        format!(
                            "✅ [页面加载完成，可关闭此窗口] {} | 链路嗅探沙盒 (隔离出口 :{})",
                            host_for_load, bound_port
                        ),
                        format!(
                            "✅ [Page loaded; you can close this window] {} | Chain Sniffer Sandbox (isolated exit :{})",
                            host_for_load, bound_port
                        ),
                    ));
                    let _ = app_for_load.emit("sniffer-page-loaded", url_str.to_string());
                }
            }
        })
        .build()
        .map_err(|e| {
            crate::tr!(
                format!("创建内置嗅探沙盒窗口失败: {e}"),
                format!("Failed to create the built-in sniffer sandbox window: {e}"),
            )
        })?;

    let _ = window.show();
    let _ = window.set_focus();

    let app_for_close = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
            let _ = app_for_close.emit("sniffer-window-closed", ());
        }
    });
    Ok(bound_port)
}

#[tauri::command]
pub async fn get_node_analytics_dashboard(
    window_hours: u64,
    state: State<'_, AppState>,
) -> Result<crate::core::node_analytics::NodeAnalyticsDashboard, String> {
    let allowed = state.bound_runtime_node_names();
    Ok(state.node_analytics.build_dashboard(window_hours, Some(&allowed)))
}

#[tauri::command]
pub async fn get_node_analytics_weights(
    state: State<'_, AppState>,
) -> Result<crate::core::node_analytics::AvailabilityWeights, String> {
    Ok(state.node_analytics.get_weights())
}

#[tauri::command]
pub async fn set_node_analytics_weights(
    weights: crate::core::node_analytics::AvailabilityWeights,
    state: State<'_, AppState>,
) -> Result<crate::core::node_analytics::AvailabilityWeights, String> {
    state.node_analytics.set_weights(weights).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_node_analytics(state: State<'_, AppState>) -> Result<(), String> {
    state.node_analytics.clear_all().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_system_network_status(
    state: State<'_, AppState>,
) -> Result<crate::core::network_monitor::SystemNetworkStatus, String> {
    Ok(state.network_monitor.get_status())
}

#[tauri::command]
pub async fn check_system_network_status(
    state: State<'_, AppState>,
) -> Result<crate::core::network_monitor::SystemNetworkStatus, String> {
    Ok(state.network_monitor.check_now().await)
}

#[tauri::command]
pub fn get_cli_status(state: State<'_, AppState>) -> Result<crate::models::CliStatus, String> {
    let alias = state.config.read().cli_alias.clone();
    Ok(crate::core::cli_manager::get_cli_status(&alias))
}

#[tauri::command]
pub fn set_cli_alias(state: State<'_, AppState>, alias: String) -> Result<crate::models::CliStatus, String> {
    let valid = crate::core::cli_manager::validate_cli_alias(&alias)?;
    let updated_cfg = {
        let mut cfg = state.config.write();
        cfg.cli_alias = valid.clone();
        cfg.clone()
    };
    state.persist_config(&updated_cfg).map_err(|e| e.to_string())?;

    let status = crate::core::cli_manager::get_cli_status(&valid);
    if let (Ok(cli_dir), Some(source_bin)) = (
        crate::core::cli_manager::resolve_cli_dir(),
        crate::core::cli_manager::resolve_source_binary(),
    ) && (status.installed || status.in_path)
    {
        crate::core::cli_manager::sync_cli_in_dir(&cli_dir, &source_bin, &valid)?;
    }
    if crate::core::cli_manager::is_shell_integration_installed() {
        let _ = crate::core::cli_manager::install_shell_integration(&valid);
    }
    Ok(crate::core::cli_manager::get_cli_status(&valid))
}

#[tauri::command]
pub fn install_cli(state: State<'_, AppState>) -> Result<crate::models::CliStatus, String> {
    let alias = state.config.read().cli_alias.clone();
    let cli_dir = crate::core::cli_manager::resolve_cli_dir()?;
    let source_bin = crate::core::cli_manager::resolve_source_binary().ok_or_else(|| {
        crate::tr!(
            "未找到内置 CLI 二进制文件 (mihomo-multi-cli)，请重新安装或构建完整包".to_string(),
            "Bundled CLI binary (mihomo-multi-cli) was not found".to_string()
        )
    })?;
    crate::core::cli_manager::sync_cli_in_dir(&cli_dir, &source_bin, &alias)?;
    crate::core::cli_manager::register_cli_path(&cli_dir)?;
    Ok(crate::core::cli_manager::get_cli_status(&alias))
}

#[tauri::command]
pub fn uninstall_cli(state: State<'_, AppState>) -> Result<crate::models::CliStatus, String> {
    let alias = state.config.read().cli_alias.clone();
    let cli_dir = crate::core::cli_manager::resolve_cli_dir()?;
    crate::core::cli_manager::unregister_cli_path(&cli_dir, &alias)?;
    Ok(crate::core::cli_manager::get_cli_status(&alias))
}

#[tauri::command]
pub fn install_cli_shell_integration(state: State<'_, AppState>) -> Result<crate::models::CliStatus, String> {
    let alias = state.config.read().cli_alias.clone();
    crate::core::cli_manager::install_shell_integration(&alias)?;
    Ok(crate::core::cli_manager::get_cli_status(&alias))
}

#[tauri::command]
pub fn open_cli_dir() -> Result<(), String> {
    let dir = crate::core::cli_manager::resolve_cli_dir()?;
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| crate::tr!(format!("创建目录失败: {e}"), format!("Failed to create directory: {e}"),))?;
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|e| crate::tr!(format!("打开目录失败: {e}"), format!("Failed to open directory: {e}"),))?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&dir)
            .spawn()
            .map_err(|e| crate::tr!(format!("打开目录失败: {e}"), format!("Failed to open directory: {e}"),))?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(|e| crate::tr!(format!("打开目录失败: {e}"), format!("Failed to open directory: {e}"),))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::DEFAULT_DIRECT_PORT;

    #[test]
    fn test_resolve_sniffer_proxy_mapping_selection_precedence() {
        let direct = PortMapping {
            id: FIXED_DIRECT_PORT_ID.to_string(),
            port: DEFAULT_DIRECT_PORT,
            enabled: true,
            ..PortMapping::default()
        };
        let proxy_a = PortMapping {
            id: "proxy-a".to_string(),
            port: 7890,
            enabled: true,
            ..PortMapping::default()
        };
        let proxy_b_disabled = PortMapping {
            id: "proxy-b".to_string(),
            port: 7891,
            enabled: false,
            ..PortMapping::default()
        };

        let mappings = vec![direct.clone(), proxy_a.clone(), proxy_b_disabled];

        // 1. Explicit enabled preferred port wins
        let chosen_explicit = resolve_sniffer_proxy_mapping(&mappings, Some(DEFAULT_DIRECT_PORT)).unwrap();
        assert_eq!(chosen_explicit.port, DEFAULT_DIRECT_PORT);

        // 2. When preferred port is disabled, returns explicit deterministic error instead of drifting
        assert!(resolve_sniffer_proxy_mapping(&mappings, Some(7891)).is_err());

        // 3. When preferred port is None (global rule), prefers first enabled non-direct port
        let chosen_global = resolve_sniffer_proxy_mapping(&mappings, None).unwrap();
        assert_eq!(chosen_global.port, 7890);

        // 4. When only direct port is enabled and preferred_port is None, falls back to direct port
        let only_direct = vec![direct];
        let chosen_direct = resolve_sniffer_proxy_mapping(&only_direct, None).unwrap();
        assert_eq!(chosen_direct.port, DEFAULT_DIRECT_PORT);

        // 5. When no ports are enabled, returns descriptive error
        let empty: Vec<PortMapping> = Vec::new();
        assert!(resolve_sniffer_proxy_mapping(&empty, None).is_err());
    }

    #[test]
    fn test_resolve_fallback_node_latency_prefers_kernel_over_stale_cache() {
        // Latest kernel delay supersedes stale cached latency
        assert_eq!(
            resolve_fallback_node_latency(Some(68), Some(Some(42)), Some(30), false),
            Some(68)
        );
        // Kernel explicit timeout (0) supersedes cached latency
        assert_eq!(
            resolve_fallback_node_latency(Some(0), Some(Some(42)), Some(30), false),
            None
        );
        // No kernel history yet falls back to cache, then mapping latency
        assert_eq!(
            resolve_fallback_node_latency(None, Some(Some(42)), Some(30), false),
            Some(42)
        );
        assert_eq!(resolve_fallback_node_latency(None, Some(None), Some(30), false), None);
        assert_eq!(resolve_fallback_node_latency(None, None, Some(30), false), Some(30));
        // When auto-fallback is active, do not fall back to stale cache
        assert_eq!(
            resolve_fallback_node_latency(None, Some(Some(42)), Some(30), true),
            None
        );
    }

    #[test]
    fn test_should_recheck_timeout_only_on_first_transition() {
        use crate::core::clash_client::ProxyHistoryItem;

        let entry = |delay: u32| ProxyHistoryItem {
            time: String::new(),
            delay,
        };

        // Reachable -> timeout in history triggers recheck
        assert!(should_recheck_timeout(&[entry(50), entry(0)], None));
        // Reachable cache -> first timeout in history triggers recheck
        assert!(should_recheck_timeout(&[entry(0)], Some(Some(50))));
        // Already confirmed timeout (consecutive 0s and cache None) does not recheck again
        assert!(!should_recheck_timeout(&[entry(0), entry(0)], Some(None)));
        // Healthy latest history does not recheck
        assert!(!should_recheck_timeout(&[entry(0), entry(45)], Some(Some(45))));
    }

    #[test]
    fn test_build_recheck_urls_builtin_and_custom() {
        // Built-in URL expands to max 3 unique URLs starting with the configured URL
        let builtin = build_recheck_urls("http://www.google.com/generate_204");
        assert_eq!(builtin.len(), 3);
        assert_eq!(builtin[0], "http://www.google.com/generate_204");
        assert_ne!(builtin[1], builtin[0]);
        assert_ne!(builtin[2], builtin[0]);
        assert_ne!(builtin[1], builtin[2]);

        // Custom URL only rechecks itself
        let custom = build_recheck_urls("https://internal.example.com/health");
        assert_eq!(custom, vec!["https://internal.example.com/health"]);
    }
}
