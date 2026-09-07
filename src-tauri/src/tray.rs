use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};
use tracing::{error, info, warn};

struct PortRuntimeInfo {
    is_fallback_active: bool,
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
                let is_fallback_active = runtime_info.map(|r| r.is_fallback_active).unwrap_or(false);

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
                        "正常(备)"
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

async fn query_runtime_infos(app: &AppHandle) -> std::collections::HashMap<String, PortRuntimeInfo> {
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
        if let Some(fb) = &m.fallback_node_name
            && !fb.trim().is_empty()
        {
            let group_name = format!("fb-{}", m.port);
            if let Ok(detail) = engine.get_proxy_detail(&group_name).await {
                let active_node = detail.now.unwrap_or_default();
                let is_fallback_active = active_node.ends_with(fb);

                let (target_node, target_profile_id) = if is_fallback_active {
                    (
                        fb.as_str(),
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

                let active_latency = engine
                    .get_proxy_detail(&target_runtime_name)
                    .await
                    .ok()
                    .and_then(|p| p.history.last().map(|h| h.delay))
                    .filter(|&d| d > 0);

                runtime_infos.insert(
                    m.id,
                    PortRuntimeInfo {
                        is_fallback_active,
                        active_latency,
                    },
                );
                continue;
            }
        }

        let primary_runtime_name = if let Some(pname) = profile_map.get(&m.profile_id) {
            format!("[{}] {}", pname, m.node_name)
        } else {
            m.node_name.clone()
        };

        if let Ok(p_detail) = engine.get_proxy_detail(&primary_runtime_name).await {
            let active_latency = p_detail.history.last().map(|h| h.delay).filter(|&d| d > 0);
            runtime_infos.insert(
                m.id,
                PortRuntimeInfo {
                    is_fallback_active: false,
                    active_latency,
                },
            );
        }
    }

    runtime_infos
}

pub fn update_tray_menu(app: &AppHandle) {
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Some(tray) = app_handle.tray_by_id("main-tray") {
            let runtime_infos = query_runtime_infos(&app_handle).await;
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
        }
    });
}

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let initial_runtime_infos = std::collections::HashMap::new();
    let menu = build_tray_menu_internal(app, &initial_runtime_infos)?;

    let tray_builder = TrayIconBuilder::with_id("main-tray")
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
                                update_tray_menu(&app_handle);
                            }
                        }
                    });
                }
                "quit_app" => {
                    info!("Quitting application from tray");
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
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
