use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};
use tracing::{error, info, warn};

struct PortRuntimeInfo {
    is_fallback_active: bool,
    manual_fallback: bool,
    active_latency: Option<u32>,
}

fn build_tray_menu_internal(
    app: &AppHandle,
    runtime_infos: &std::collections::HashMap<String, PortRuntimeInfo>,
) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    let show_item = MenuItem::with_id(app, "show_window", "显示主窗口", true, None::<&str>)?;
    menu.append(&show_item)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;

    if let Some(state) = app.try_state::<crate::state::AppState>() {
        let mut mappings = state.port_router.get_port_mappings();
        mappings.sort_by_key(|m| m.port);
        let is_running = state.engine.get_status().running;

        if mappings.is_empty() {
            let empty_item = MenuItem::with_id(app, "no_ports", "暂无端口监听 (可在窗口中添加)", false, None::<&str>)?;
            menu.append(&empty_item)?;
        } else {
            for m in mappings {
                let has_fallback = m.fallback_node_name.as_ref().is_some_and(|fb| !fb.trim().is_empty());

                let runtime_info = runtime_infos.get(&m.id);
                let is_fallback_active = runtime_info.map(|r| r.is_fallback_active).unwrap_or(m.manual_fallback);
                let is_manual = runtime_info.map(|r| r.manual_fallback).unwrap_or(m.manual_fallback);

                // 节点列：只展示当前活动的节点
                let node = if has_fallback && is_fallback_active {
                    m.fallback_node_name.as_deref().unwrap_or(&m.node_name).to_string()
                } else {
                    m.node_name.clone()
                };

                // 延迟与状态判定
                let lat = runtime_info.and_then(|r| r.active_latency).or(m.latency);
                let status = if !m.enabled {
                    "已禁用"
                } else if !is_running {
                    "未运行"
                } else if has_fallback {
                    if is_fallback_active {
                        if is_manual { "备(锁定)" } else { "备(兜底)" }
                    } else {
                        "正常(主)"
                    }
                } else if lat == Some(0) {
                    "超时"
                } else {
                    "正常"
                };

                let delay = match lat {
                    Some(d) if d > 0 => format!("{}ms", d),
                    Some(_) => "超时".to_string(),
                    None => "--ms".to_string(),
                };

                let check = if m.enabled { "✓ " } else { "   " };
                // Windows 原生 \t 左右分栏：左侧为勾选+端口+节点，右侧通过中点整合为自然状态标签并由系统绝对贴右对齐
                let item_title = format!("{}{}  {}\t{} · {}", check, m.port, node, delay, status);
                let item_id = format!("port_toggle:{}", m.id);
                let item = MenuItem::with_id(app, &item_id, &item_title, true, None::<&str>)?;
                menu.append(&item)?;
            }
        }
    } else {
        let loading_item = MenuItem::with_id(app, "state_loading", "正在加载状态...", false, None::<&str>)?;
        menu.append(&loading_item)?;
    }

    menu.append(&PredefinedMenuItem::separator(app)?)?;
    let restart_item = MenuItem::with_id(app, "restart_core", "重启内核", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit_app", "退出程序", true, None::<&str>)?;
    menu.append(&restart_item)?;
    menu.append(&quit_item)?;

    Ok(menu)
}

async fn query_runtime_infos(
    app: &AppHandle,
    fallback_statuses: &[crate::models::PortFallbackStatus],
) -> std::collections::HashMap<String, PortRuntimeInfo> {
    let mut runtime_infos = std::collections::HashMap::new();
    let Some(state) = app.try_state::<crate::state::AppState>() else {
        return runtime_infos;
    };

    if !state.engine.get_status().running {
        return runtime_infos;
    }

    let mappings = state.port_router.get_port_mappings();
    let profiles = state.profile_manager.get_profiles();
    let profile_map: std::collections::HashMap<String, String> = profiles.into_iter().map(|p| (p.id, p.name)).collect();
    let engine = state.engine.clone();

    for m in mappings.into_iter().filter(|m| m.enabled) {
        if let Some(status) = fallback_statuses.iter().find(|status| status.mapping_id == m.id) {
            runtime_infos.insert(
                m.id,
                PortRuntimeInfo {
                    is_fallback_active: status.is_fallback_active,
                    manual_fallback: status.manual_fallback,
                    active_latency: if status.is_fallback_active {
                        status.fallback_latency
                    } else {
                        status.primary_latency
                    },
                },
            );
            continue;
        }
        let has_fallback = m.fallback_node_name.as_ref().is_some_and(|fb| !fb.trim().is_empty());
        let (is_fallback_active, manual_fallback) = if has_fallback && m.manual_fallback {
            (true, true)
        } else if has_fallback {
            let group_name = format!("fb-{}", m.port);
            let active = if let Ok(detail) = engine.get_proxy_detail(&group_name).await {
                let active_node = detail.now.unwrap_or_default();
                let fb = m.fallback_node_name.as_deref().unwrap_or_default();
                active_node.ends_with(fb)
            } else {
                false
            };
            (active, false)
        } else {
            (false, false)
        };

        let (target_node, target_profile_id) = if is_fallback_active {
            (
                m.fallback_node_name.as_deref().unwrap_or(&m.node_name),
                m.fallback_profile_id.as_deref().unwrap_or(&m.profile_id),
            )
        } else {
            (m.node_name.as_str(), m.profile_id.as_str())
        };

        let target_runtime_name = if let Some(pname) = profile_map.get(target_profile_id) {
            format!("[{}] {}", pname, target_node)
        } else {
            target_node.to_string()
        };

        // Latency resolution order:
        // 1. Kernel history (if populated)
        // 2. LatencyProbe cache by runtime name
        // 3. LatencyProbe cache by node name
        // 4. PortMapping latency
        let kernel_latency = engine
            .get_proxy_detail(&target_runtime_name)
            .await
            .ok()
            .and_then(|p| p.history.last().map(|h| h.delay))
            .filter(|&d| d > 0);

        let active_latency = kernel_latency
            .or_else(|| state.latency_probe.get_latency(&target_runtime_name).flatten())
            .or_else(|| state.latency_probe.get_latency(target_node).flatten())
            .or(if !is_fallback_active { m.latency } else { None });

        runtime_infos.insert(
            m.id,
            PortRuntimeInfo {
                is_fallback_active,
                manual_fallback,
                active_latency,
            },
        );
    }

    runtime_infos
}

fn compute_menu_fingerprint(
    mappings: &[crate::models::PortMapping],
    runtime_infos: &std::collections::HashMap<String, PortRuntimeInfo>,
    is_running: bool,
) -> String {
    let mut fp = String::new();
    fp.push_str(if is_running { "RUN;" } else { "STOP;" });
    for m in mappings {
        let r = runtime_infos.get(&m.id);
        let active_lat = r.and_then(|x| x.active_latency).or(m.latency).unwrap_or(0);
        let fb_active = r.map(|x| x.is_fallback_active).unwrap_or(m.manual_fallback);
        let manual = r.map(|x| x.manual_fallback).unwrap_or(m.manual_fallback);
        fp.push_str(&format!(
            "{}:{}:{}:{}:{};",
            m.port, m.enabled, active_lat, fb_active, manual
        ));
    }
    fp
}

static LAST_TRAY_FINGERPRINT: parking_lot::Mutex<Option<String>> = parking_lot::Mutex::new(None);
#[cfg(windows)]
fn is_tray_menu_active() -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::FindWindowA;
    unsafe {
        let hwnd = FindWindowA(c"#32768".as_ptr().cast(), std::ptr::null());
        hwnd as isize != 0
    }
}

#[cfg(not(windows))]
fn is_tray_menu_active() -> bool {
    false
}
pub fn format_tray_tooltip(app: &AppHandle) -> String {
    let Some(state) = app.try_state::<crate::state::AppState>() else {
        return "Mihomo Multi-Port".to_string();
    };

    let mappings = state.port_router.get_port_mappings();
    let total_ports = mappings.len();
    let enabled_ports = mappings.iter().filter(|m| m.enabled).count();

    let config = state.config.read();
    let sys_proxy_str = if config.system_proxy_enabled {
        if let Some(port) = config.system_proxy_port {
            format!("已开启 (:{port})")
        } else {
            "已开启".to_string()
        }
    } else {
        "未开启".to_string()
    };

    let core_status = if state.engine.get_status().running {
        "运行中"
    } else {
        "已停止"
    };

    format!(
        "Mihomo Multi-Port\n内核状态: {}\n监听端口: {} 个已启用 (共 {} 个)\n系统代理: {}",
        core_status, enabled_ports, total_ports, sys_proxy_str
    )
}

pub fn update_tray_menu(app: &AppHandle) {
    update_tray_menu_with_fallback_statuses(app, Vec::new());
}

pub fn update_tray_menu_with_fallback_statuses(
    app: &AppHandle,
    fallback_statuses: Vec<crate::models::PortFallbackStatus>,
) {
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let Some(tray) = app_handle.tray_by_id("main-tray") else {
            return;
        };
        let Some(state) = app_handle.try_state::<crate::state::AppState>() else {
            return;
        };
        let tooltip = format_tray_tooltip(&app_handle);
        if let Err(e) = tray.set_tooltip(Some(tooltip)) {
            warn!("Failed to set updated tray tooltip: {}", e);
        }


        // If a popup menu is currently open on screen, never call set_menu!
        // Calling set_menu while a menu is open forces Windows to immediately dismiss it.
        if is_tray_menu_active() {
            return;
        }

        let is_running = state.engine.get_status().running;
        let mut mappings = state.port_router.get_port_mappings();
        mappings.sort_by_key(|m| m.port);

        let runtime_infos = query_runtime_infos(&app_handle, &fallback_statuses).await;
        let current_fp = compute_menu_fingerprint(&mappings, &runtime_infos, is_running);

        {
            let mut guard = LAST_TRAY_FINGERPRINT.lock();
            if let Some(last_fp) = &*guard
                && last_fp == &current_fp
            {
                // Content has not changed: avoid calling set_menu to prevent closing open context menus!
                return;
            }
            *guard = Some(current_fp);
        }

        match build_tray_menu_internal(&app_handle, &runtime_infos) {
            Ok(menu) => {
                if let Err(e) = tray.set_menu(Some(menu)) {
                    warn!("Failed to set updated tray menu: {}", e);
                }
            }
            Err(e) => {
                warn!("Failed to build updated tray menu: {}", e);
            }
        }
    });
}

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let initial_runtime_infos = std::collections::HashMap::new();
    let menu = build_tray_menu_internal(app, &initial_runtime_infos)?;
    let initial_tooltip = format_tray_tooltip(app);

    let tray_builder = TrayIconBuilder::with_id("main-tray")
        .tooltip(initial_tooltip)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let event_id = event.id.as_ref();
            if let Some(mapping_id) = event_id.strip_prefix("port_toggle:") {
                let mapping_id = mapping_id.to_string();
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(state) = app_handle.try_state::<crate::state::AppState>() {
                        let current_enabled = state
                            .port_router
                            .get_port_mapping_by_id(&mapping_id)
                            .map(|m| m.enabled)
                            .unwrap_or(false);
                        let target_enabled = !current_enabled;

                        match state.port_router.toggle_port_mapping(&mapping_id, target_enabled).await {
                            Ok(updated) => {
                                info!("Toggled port {} to {} from system tray", updated.port, target_enabled);
                            }
                            Err(e) => {
                                error!("Failed to toggle port mapping from system tray: {}", e);
                                let _ = app_handle.emit("port-toggle-error", e.to_string());
                            }
                        }
                    }
                });
                return;
            }

            match event_id {
                "show_window" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                }
                "restart_core" => {
                    let app_handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Some(state) = app_handle.try_state::<crate::state::AppState>() {
                            let _ = state.sync_runtime_config().await;
                            let config = state.config.read().clone();
                            if let Err(e) = state.engine.restart(Some(&app_handle), &config) {
                                error!("Failed to restart core from tray: {}", e);
                            } else {
                                info!("Mihomo core restarted from tray");
                                state.ensure_system_proxy_active();
                                update_tray_menu(&app_handle);
                            }
                        }
                    });
                }
                "quit_app" => {
                    info!("Quitting application from tray");
                    let _ = crate::core::sysproxy::clear_system_proxy();
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Enter { .. } => {
                let app = tray.app_handle();
                update_tray_menu(app);
            }
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } => {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main")
                    && let Ok(is_visible) = window.is_visible()
                {
                    if is_visible {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                }
            }
            _ => {}
        });

    // Load 32x32 crisp tray icon directly from embedded assets
    let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png")).ok();
    let tray_builder = if let Some(icon) = tray_icon {
        tray_builder.icon(icon)
    } else if let Some(icon) = app.default_window_icon() {
        tray_builder.icon(icon.clone())
    } else {
        tray_builder
    };

    tray_builder.build(app)?;
    info!("System tray created successfully");
    Ok(())
}
