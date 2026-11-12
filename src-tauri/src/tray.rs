use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_window_state::{StateFlags, WindowExt};
use tracing::{error, info, warn};

mod terminal;

#[derive(Default)]
struct TrayClipboard(parking_lot::Mutex<Option<arboard::Clipboard>>);

fn show_tray_error(app: &AppHandle, message: &str) {
    error!("Tray action failed: {}", message);
    app.dialog().message(message).title("托盘操作失败").show(|_| {});
}

fn copy_tray_text(app: &AppHandle, text: String) -> Result<(), String> {
    let clipboard = app.state::<TrayClipboard>();
    let mut guard = clipboard.0.lock();
    if guard.is_none() {
        *guard = Some(arboard::Clipboard::new().map_err(|e| e.to_string())?);
    }
    let clipboard = guard.as_mut().ok_or_else(|| "剪贴板初始化失败".to_string())?;
    clipboard.set_text(text).map_err(|e| e.to_string())
}

async fn query_port_egress_ip(app: &AppHandle, mapping_id: &str) -> Result<String, String> {
    let state = app.state::<crate::state::AppState>();
    let mapping = state
        .port_router
        .get_port_mapping_by_id(mapping_id)
        .ok_or_else(|| "监听端口已删除，请重新打开菜单".to_string())?;
    if !mapping.enabled || !state.engine.get_status().running {
        return Err("请先启动内核并启用监听端口，再复制出口 IP".into());
    }
    let (node_name, profile_id) = if mapping
        .fallback_node_name
        .as_ref()
        .is_some_and(|name| !name.trim().is_empty())
    {
        // Resolve the live selection rather than assuming the primary or manual fallback is active.
        let detail = state
            .engine
            .get_proxy_detail(&format!("fb-{}", mapping.port))
            .await
            .map_err(|e| format!("读取当前出口节点失败: {e}"))?;
        let active = detail
            .now
            .filter(|name| !name.trim().is_empty())
            .ok_or_else(|| "内核尚未选定出口节点，请稍后重试".to_string())?;
        (active, None)
    } else {
        (mapping.node_name, Some(mapping.profile_id))
    };
    let info = crate::commands::query_node_egress_info(node_name, profile_id, None, state).await?;
    Ok(info.ip)
}

struct PortRuntimeInfo {
    is_fallback_active: bool,
    manual_fallback: bool,
    active_latency: Option<u32>,
}

pub fn is_dev_instance(app: &AppHandle) -> bool {
    cfg!(debug_assertions) || app.config().identifier.ends_with(".dev")
}

pub fn get_tray_id(app: &AppHandle) -> &'static str {
    if is_dev_instance(app) {
        "main-tray-dev"
    } else {
        "main-tray"
    }
}
pub fn activate_window(window: &tauri::WebviewWindow) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
    let _ = window.emit("window-visibility-change", true);
}

pub fn hide_main_window<R: tauri::Runtime>(window: &tauri::Window<R>) {
    let _ = window.emit("window-visibility-change", false);
    let _ = window.hide();
}

pub fn hide_main_webview_window<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    let _ = window.emit("window-visibility-change", false);
    let _ = window.hide();
}

pub fn apply_window_bg_color(window: &tauri::WebviewWindow, theme: &str) {
    let is_dark = match theme {
        "dark" => true,
        "light" => false,
        _ => window.theme().map(|t| t == tauri::Theme::Dark).unwrap_or(true),
    };
    let bg = if is_dark {
        tauri::window::Color(19, 23, 34, 255)
    } else {
        tauri::window::Color(246, 248, 250, 255)
    };
    let _ = window.set_background_color(Some(bg));
}

pub fn ensure_main_window_open(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        activate_window(&window);
    } else {
        let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
            .title(if is_dev_instance(app) {
                "Mihomo Multi [Dev]"
            } else {
                "Mihomo Multi"
            })
            .inner_size(
                crate::constants::DEFAULT_WINDOW_WIDTH,
                crate::constants::DEFAULT_WINDOW_HEIGHT,
            )
            .min_inner_size(
                crate::constants::DEFAULT_WINDOW_WIDTH,
                crate::constants::DEFAULT_WINDOW_HEIGHT,
            )
            .resizable(true)
            .fullscreen(false)
            .visible(false);

        match builder.build() {
            Ok(window) => {
                let theme = app
                    .try_state::<crate::state::AppState>()
                    .map(|s| s.config.read().theme.clone())
                    .unwrap_or_else(|| "system".to_string());
                apply_window_bg_color(&window, &theme);
                let _ = window.restore_state(StateFlags::all() & !StateFlags::VISIBLE);
                activate_window(&window);
                info!("Main window recreated successfully");
            }
            Err(e) => {
                error!("Failed to recreate main window: {}", e);
            }
        }
    }
}

fn build_tray_menu_internal(
    app: &AppHandle,
    runtime_infos: &std::collections::HashMap<String, PortRuntimeInfo>,
) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    let is_dev = is_dev_instance(app);
    if is_dev {
        let dev_header = MenuItem::with_id(app, "dev_indicator", "【开发调试实例 DEV】", false, None::<&str>)?;
        menu.append(&dev_header)?;
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }
    let show_title = if is_dev {
        "显示开发窗口"
    } else {
        "显示主窗口"
    };
    let show_item = MenuItem::with_id(app, "show_window", show_title, true, None::<&str>)?;
    menu.append(&show_item)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;

    if let Some(state) = app.try_state::<crate::state::AppState>() {
        let mut mappings = state.port_router.get_port_mappings();
        mappings.sort_by_key(|m| m.port);
        let is_running = state.engine.get_status().running;
        let env_proxy_port = {
            let config = state.config.read();
            config.env_proxy_port.filter(|_| config.env_proxy_enabled)
        };

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

                // Node names are data; ampersands must not become menu mnemonics.
                let item_title = format!("{}  {}\t{}", m.port, node.replace('&', "&&"), delay);
                let submenu = Submenu::with_id(app, format!("port:{}", m.id), item_title, true)?;
                submenu.append(&MenuItem::with_id(
                    app,
                    format!("port_status:{}", m.id),
                    format!("{status} · {delay}"),
                    false,
                    None::<&str>,
                )?)?;
                submenu.append(&PredefinedMenuItem::separator(app)?)?;
                submenu.append(&CheckMenuItem::with_id(
                    app,
                    format!("port_toggle:{}", m.id),
                    "启用监听",
                    true,
                    m.enabled,
                    None::<&str>,
                )?)?;
                let is_env_proxy = env_proxy_port == Some(m.port);
                let can_bind =
                    cfg!(windows) && m.enabled && is_running && m.protocol != crate::models::InboundProtocol::Socks5;
                submenu.append(&CheckMenuItem::with_id(
                    app,
                    format!("port_env:{}", m.id),
                    if is_env_proxy {
                        "取消终端代理绑定"
                    } else {
                        "绑定终端代理"
                    },
                    is_env_proxy || can_bind,
                    is_env_proxy,
                    None::<&str>,
                )?)?;
                submenu.append(&PredefinedMenuItem::separator(app)?)?;
                submenu.append(&MenuItem::with_id(
                    app,
                    format!("port_egress_ip:{}", m.id),
                    "复制出口 IP",
                    m.enabled && is_running,
                    None::<&str>,
                )?)?;
                for (shell, label) in [
                    ("powershell", "复制环境变量（PowerShell）"),
                    ("cmd", "复制环境变量（CMD）"),
                    ("shell", "复制环境变量（Shell / Bash / Zsh）"),
                ] {
                    submenu.append(&MenuItem::with_id(
                        app,
                        format!("port_copy_{shell}:{}", m.id),
                        label,
                        true,
                        None::<&str>,
                    )?)?;
                }
                menu.append(&submenu)?;
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
        // 1. LatencyProbe cache by runtime name (authoritative baseline latency)
        // 2. LatencyProbe cache by node name
        // 3. PortMapping latency
        // 4. Kernel history (fallback if not yet probed in cache)
        let kernel_latency = engine
            .get_proxy_detail(&target_runtime_name)
            .await
            .ok()
            .and_then(|p| p.history.last().map(|h| h.delay))
            .filter(|&d| d > 0);

        let active_latency = state
            .latency_probe
            .get_latency(&target_runtime_name)
            .flatten()
            .or_else(|| state.latency_probe.get_latency(target_node).flatten())
            .or(if !is_fallback_active { m.latency } else { None })
            .or(kernel_latency);

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
static LAST_TRAY_CLICK_TIME: parking_lot::Mutex<Option<std::time::Instant>> = parking_lot::Mutex::new(None);

fn handle_tray_left_click(app: &AppHandle) {
    let now = std::time::Instant::now();
    let is_rapid_click = {
        let mut last = LAST_TRAY_CLICK_TIME.lock();
        let is_rapid = match *last {
            Some(t) => now.duration_since(t) < std::time::Duration::from_millis(400),
            None => false,
        };
        *last = Some(now);
        is_rapid
    };

    if let Some(window) = app.get_webview_window("main") {
        if is_rapid_click {
            // Rapid click / debounce: user intends to open/focus, avoid flash-hide
            activate_window(&window);
            return;
        }

        let is_visible = window.is_visible().unwrap_or(false);
        let is_minimized = window.is_minimized().unwrap_or(false);
        let is_focused = window.is_focused().unwrap_or(false);

        // Only toggle-hide if the window is currently visible, not minimized, and actively focused in foreground.
        // If it is hidden, minimized, or obscured behind other applications, always bring to front and focus.
        if is_visible && !is_minimized && is_focused {
            let is_lightweight = app
                .try_state::<crate::state::AppState>()
                .map(|s| s.config.read().lightweight_mode)
                .unwrap_or(false);
            if is_lightweight {
                let _ = window.destroy();
            } else {
                hide_main_webview_window(&window);
            }
        } else {
            activate_window(&window);
        }
    } else {
        ensure_main_window_open(app);
    }
}
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
fn tray_app_title(is_dev: bool) -> String {
    if is_dev {
        format!("Mihomo Multi [Dev] v{}", crate::constants::APP_VERSION)
    } else {
        format!("Mihomo Multi v{}", crate::constants::APP_VERSION)
    }
}

pub fn format_tray_tooltip(app: &AppHandle) -> String {
    let app_title = tray_app_title(is_dev_instance(app));
    let Some(state) = app.try_state::<crate::state::AppState>() else {
        return app_title;
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
    let env_proxy_str = if config.env_proxy_enabled {
        if let Some(port) = config.env_proxy_port {
            format!("已开启 (:{port})")
        } else {
            "已开启".to_string()
        }
    } else {
        "未开启".to_string()
    };

    let tun_str = if config.tun_enabled {
        match config.tun_port {
            Some(port) => format!("已开启 (:{port})"),
            None => "已开启".to_string(),
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
        "{app_title}\n内核状态: {core_status}\n监听端口: {enabled_ports} 个已启用 (共 {total_ports} 个)\n系统代理: {sys_proxy_str}\n终端代理: {env_proxy_str}\nTUN: {tun_str}"
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
        let tray_id = get_tray_id(&app_handle);
        let Some(tray) = app_handle.tray_by_id(tray_id) else {
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
    app.manage(TrayClipboard::default());
    let menu = build_tray_menu_internal(app, &initial_runtime_infos)?;
    let initial_tooltip = format_tray_tooltip(app);

    let tray_id = get_tray_id(app);
    let tray_builder = TrayIconBuilder::with_id(tray_id)
        .tooltip(initial_tooltip)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let event_id = event.id.as_ref();
            if let Some(mapping_id) = event_id.strip_prefix("port_egress_ip:") {
                let mapping_id = mapping_id.to_string();
                let app_handle = app.clone();
                if let Some(tray) = app.tray_by_id(get_tray_id(app))
                    && let Err(error) = tray.set_tooltip(Some("正在探测出口 IP…"))
                {
                    show_tray_error(app, &error.to_string());
                    return;
                }
                tauri::async_runtime::spawn(async move {
                    let result = async {
                        let ip = query_port_egress_ip(&app_handle, &mapping_id).await?;
                        let message = format!("出口 IP 已复制：{ip}");
                        copy_tray_text(&app_handle, ip)?;
                        if let Some(tray) = app_handle.tray_by_id(get_tray_id(&app_handle)) {
                            tray.set_tooltip(Some(message)).map_err(|e| e.to_string())?;
                        }
                        Ok::<(), String>(())
                    }
                    .await;
                    if let Err(error) = result {
                        update_tray_menu(&app_handle);
                        show_tray_error(&app_handle, &error);
                    }
                });
                return;
            }
            if let Some((action, mapping_id)) = event_id.split_once(':')
                && (action == "port_env" || action.starts_with("port_copy_"))
            {
                let result = (|| -> Result<(), String> {
                    let state = app.state::<crate::state::AppState>();
                    let mapping = state
                        .port_router
                        .get_port_mapping_by_id(mapping_id)
                        .ok_or_else(|| "监听端口已删除，请重新打开菜单".to_string())?;
                    if action == "port_env" {
                        let bound = {
                            let config = state.config.read();
                            config.env_proxy_enabled && config.env_proxy_port == Some(mapping.port)
                        };
                        if !bound
                            && (!cfg!(windows)
                                || !state.engine.get_status().running
                                || mapping.protocol == crate::models::InboundProtocol::Socks5)
                        {
                            return Err("终端代理绑定需要 Windows 上运行中的 HTTP 或 Mixed 监听端口".into());
                        }
                        state.apply_env_proxy_transition(!bound, Some(mapping.port))?;
                        app.emit("port-mappings-changed", ()).map_err(|e| e.to_string())?;
                        update_tray_menu(app);
                    } else {
                        let config = state.config.read();
                        let command = terminal::build_command(
                            action.trim_start_matches("port_copy_"),
                            mapping.port,
                            mapping.protocol,
                            &config.system_proxy_bypass_user,
                        )?;
                        copy_tray_text(app, command)?;
                        if let Some(tray) = app.tray_by_id(get_tray_id(app)) {
                            tray.set_tooltip(Some("环境变量命令已复制，可粘贴到终端执行"))
                                .map_err(|e| e.to_string())?;
                        }
                    }
                    Ok(())
                })();
                if let Err(error) = result {
                    show_tray_error(app, &error);
                }
                return;
            }
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

                        match state.toggle_port_mapping(&mapping_id, target_enabled).await {
                            Ok(updated) => {
                                info!("Toggled port {} to {} from system tray", updated.port, target_enabled);
                            }
                            Err(e) => {
                                show_tray_error(&app_handle, &e.to_string());
                                let _ = app_handle.emit("port-toggle-error", e.to_string());
                            }
                        }
                    }
                });
                return;
            }

            match event_id {
                "show_window" => {
                    ensure_main_window_open(app);
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
                handle_tray_left_click(tray.app_handle());
            }
            TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => {
                ensure_main_window_open(tray.app_handle());
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
