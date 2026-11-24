use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_window_state::{StateFlags, WindowExt};
use tracing::{error, info, warn};

mod terminal;

/// Locale used by the native tray surface. The frontend pushes the effective application locale
/// through `set_ui_locale`; keeping it here (instead of on a window) preserves the language while
/// lightweight mode has destroyed the webview.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum TrayLocale {
    #[default]
    ZhCn,
    EnUs,
}

impl TrayLocale {
    fn parse(tag: &str) -> Result<Self, String> {
        match tag.trim() {
            "zh-CN" | "zh_CN" => Ok(Self::ZhCn),
            "en-US" | "en_US" => Ok(Self::EnUs),
            other => Err(format!("Unsupported locale: {other}")),
        }
    }

    fn tag(self) -> &'static str {
        match self {
            Self::ZhCn => "zh-CN",
            Self::EnUs => "en-US",
        }
    }

    fn text(self) -> &'static TrayText {
        match self {
            Self::ZhCn => &ZH_TRAY_TEXT,
            Self::EnUs => &EN_TRAY_TEXT,
        }
    }

    fn enabled_with_port(self, port: u16) -> String {
        match self {
            Self::ZhCn => format!("已开启 (:{port})"),
            Self::EnUs => format!("On (:{port})"),
        }
    }

    fn tooltip_ports(self, enabled: usize, total: usize) -> String {
        match self {
            Self::ZhCn => format!("监听端口: {enabled} 个已启用 (共 {total} 个)"),
            Self::EnUs => format!("Ports: {enabled}/{total}"),
        }
    }

    fn latency_summary(self, reachable: usize, failed: usize) -> String {
        match self {
            Self::ZhCn => format!("监听端口测速完成：{reachable} 个节点可用，{failed} 个节点超时或失败"),
            Self::EnUs => {
                format!("Port latency test finished: {reachable} reachable, {failed} timed out or failed.")
            }
        }
    }

    fn fallback_status(self, status: &str, primary: &str, fallback: &str) -> String {
        match self {
            Self::ZhCn => format!("{status} · 主 {primary} · 备 {fallback}"),
            Self::EnUs => format!("{status} · Primary {primary} · Fallback {fallback}"),
        }
    }

    fn tooltip(
        self,
        app_title: &str,
        core: &str,
        ports: &str,
        system_proxy: &str,
        env_proxy: &str,
        tun: &str,
    ) -> String {
        match self {
            Self::ZhCn => format!(
                "{app_title}\n内核状态: {core}\n{ports}\n系统代理: {system_proxy}\n终端代理: {env_proxy}\nTUN: {tun}"
            ),
            Self::EnUs => format!(
                "{app_title}\nCore: {core}\n{ports}\nSystem proxy: {system_proxy}\nTerminal proxy: {env_proxy}\nTUN: {tun}"
            ),
        }
    }
}

struct TrayText {
    error_title: &'static str,
    clipboard_init_failed: &'static str,
    mapping_missing: &'static str,
    egress_requires_core: &'static str,
    egress_chain_probe_failed: &'static str,
    egress_node_read_failed: &'static str,
    egress_node_pending: &'static str,
    proxy_requires_core: &'static str,
    dev_badge: &'static str,
    show_dev_window: &'static str,
    show_main_window: &'static str,
    latency_test: &'static str,
    latency_test_running: &'static str,
    enable_tun: &'static str,
    enable_system_proxy: &'static str,
    no_ports: &'static str,
    residential_exit_unavailable: &'static str,
    status_disabled: &'static str,
    status_not_running: &'static str,
    status_timeout: &'static str,
    status_ok: &'static str,
    status_fallback_locked: &'static str,
    status_fallback_auto: &'static str,
    status_primary_ok: &'static str,
    enable_listener: &'static str,
    disable_tun_proxy: &'static str,
    set_tun_proxy: &'static str,
    disable_system_proxy: &'static str,
    set_system_proxy: &'static str,
    unbind_env_proxy: &'static str,
    bind_env_proxy: &'static str,
    copy_egress_ip: &'static str,
    copy_env_powershell: &'static str,
    copy_env_cmd: &'static str,
    copy_env_shell: &'static str,
    state_loading: &'static str,
    restart_core: &'static str,
    quit_app: &'static str,
    enabled: &'static str,
    disabled: &'static str,
    core_running: &'static str,
    core_stopped: &'static str,
    probe_egress_ip: &'static str,
    egress_ip_copied: &'static str,
    terminal_proxy_requires_running: &'static str,
    env_command_copied: &'static str,
    cmd_unsafe_chars: &'static str,
    unsupported_shell: &'static str,
}

static ZH_TRAY_TEXT: TrayText = TrayText {
    error_title: "托盘操作失败",
    clipboard_init_failed: "剪贴板初始化失败",
    mapping_missing: "监听端口已删除，请重新打开菜单",
    egress_requires_core: "请先启动内核并启用监听端口，再复制出口 IP",
    egress_chain_probe_failed: "探测链式出口 IP 失败：",
    egress_node_read_failed: "读取当前出口节点失败：",
    egress_node_pending: "内核尚未选定出口节点，请稍后重试",
    proxy_requires_core: "请先启动内核并启用监听端口，再启用代理",
    dev_badge: "【开发调试实例 DEV】",
    show_dev_window: "显示开发窗口",
    show_main_window: "显示主窗口",
    latency_test: "延迟测速",
    latency_test_running: "延迟测速中…",
    enable_tun: "启用 TUN",
    enable_system_proxy: "启用系统代理",
    no_ports: "暂无端口监听 (可在窗口中添加)",
    residential_exit_unavailable: "住宅出口失效",
    status_disabled: "已禁用",
    status_not_running: "未运行",
    status_timeout: "超时",
    status_ok: "正常",
    status_fallback_locked: "备(锁定)",
    status_fallback_auto: "备(兜底)",
    status_primary_ok: "正常(主)",
    enable_listener: "启用监听",
    disable_tun_proxy: "关闭 TUN 代理",
    set_tun_proxy: "设为 TUN 代理",
    disable_system_proxy: "关闭系统代理",
    set_system_proxy: "设为系统代理",
    unbind_env_proxy: "取消终端代理绑定",
    bind_env_proxy: "绑定终端代理",
    copy_egress_ip: "复制出口 IP",
    copy_env_powershell: "复制环境变量（PowerShell）",
    copy_env_cmd: "复制环境变量（CMD）",
    copy_env_shell: "复制环境变量（Shell / Bash / Zsh）",
    state_loading: "正在加载状态...",
    restart_core: "重启内核",
    quit_app: "退出程序",
    enabled: "已开启",
    disabled: "未开启",
    core_running: "运行中",
    core_stopped: "已停止",
    probe_egress_ip: "正在探测出口 IP…",
    egress_ip_copied: "出口 IP 已复制：",
    terminal_proxy_requires_running: "终端代理绑定需要 Windows 上运行中的 HTTP 或 Mixed 监听端口",
    env_command_copied: "环境变量命令已复制，可粘贴到终端执行",
    cmd_unsafe_chars: "排除列表包含 CMD 无法安全引用的字符，请使用 PowerShell 或 Shell",
    unsupported_shell: "不支持的终端类型",
};

static EN_TRAY_TEXT: TrayText = TrayText {
    error_title: "Tray operation failed",
    clipboard_init_failed: "Failed to initialize the clipboard",
    mapping_missing: "This port mapping was removed. Reopen the tray menu.",
    egress_requires_core: "Start the core and enable a port listener before copying the egress IP.",
    egress_chain_probe_failed: "Failed to probe the chained egress IP: ",
    egress_node_read_failed: "Failed to read the current egress node: ",
    egress_node_pending: "The core has not selected an egress node yet. Try again later.",
    proxy_requires_core: "Start the core and enable a port listener before enabling the proxy.",
    dev_badge: "[Dev instance]",
    show_dev_window: "Show dev window",
    show_main_window: "Show main window",
    latency_test: "Test latency",
    latency_test_running: "Testing latency…",
    enable_tun: "Enable TUN",
    enable_system_proxy: "Enable system proxy",
    no_ports: "No port listeners (add one in the window)",
    residential_exit_unavailable: "Residential exit unavailable",
    status_disabled: "Disabled",
    status_not_running: "Not running",
    status_timeout: "Timeout",
    status_ok: "OK",
    status_fallback_locked: "Fallback (locked)",
    status_fallback_auto: "Fallback (auto)",
    status_primary_ok: "OK (primary)",
    enable_listener: "Enable listener",
    disable_tun_proxy: "Disable TUN proxy",
    set_tun_proxy: "Set as TUN proxy",
    disable_system_proxy: "Disable system proxy",
    set_system_proxy: "Set as system proxy",
    unbind_env_proxy: "Unbind terminal proxy",
    bind_env_proxy: "Bind terminal proxy",
    copy_egress_ip: "Copy egress IP",
    copy_env_powershell: "Copy env vars (PowerShell)",
    copy_env_cmd: "Copy env vars (CMD)",
    copy_env_shell: "Copy env vars (Shell / Bash / Zsh)",
    state_loading: "Loading state...",
    restart_core: "Restart core",
    quit_app: "Quit",
    enabled: "Enabled",
    disabled: "Disabled",
    core_running: "Running",
    core_stopped: "Stopped",
    probe_egress_ip: "Probing egress IP…",
    egress_ip_copied: "Egress IP copied: ",
    terminal_proxy_requires_running: "Terminal proxy binding requires a running HTTP or Mixed listener on Windows.",
    env_command_copied: "Environment variable commands copied. Paste them into a terminal.",
    cmd_unsafe_chars: "The bypass list contains characters that CMD cannot quote safely. Use PowerShell or Shell.",
    unsupported_shell: "Unsupported terminal type",
};

static TRAY_LOCALE: parking_lot::RwLock<TrayLocale> = parking_lot::RwLock::new(TrayLocale::ZhCn);

fn current_locale() -> TrayLocale {
    *TRAY_LOCALE.read()
}

pub(crate) fn is_english() -> bool {
    current_locale() == TrayLocale::EnUs
}

/// Synchronizes the native tray language with the frontend's effective locale.
/// Idempotent so React StrictMode's duplicate startup effect (or a recreated window) cannot
/// restart or rebuild the tray when the language did not actually change.
pub(crate) fn set_ui_locale(app: AppHandle, locale: String) -> Result<(), String> {
    let parsed = TrayLocale::parse(&locale)?;
    let changed = {
        let mut current = TRAY_LOCALE.write();
        if *current == parsed {
            false
        } else {
            *current = parsed;
            true
        }
    };
    if changed {
        update_tray_menu(&app);
    }
    Ok(())
}

#[derive(Default)]
struct TrayClipboard(parking_lot::Mutex<Option<arboard::Clipboard>>);

#[derive(Default)]
struct TrayActions {
    latency_test: tokio::sync::Mutex<()>,
    egress: tokio::sync::Mutex<()>,
}

fn show_tray_error(app: &AppHandle, message: &str) {
    error!("Tray action failed: {}", message);
    app.dialog()
        .message(message)
        .title(current_locale().text().error_title)
        .show(|_| {});
}

fn copy_tray_text(app: &AppHandle, text: String) -> Result<(), String> {
    let clipboard = app.state::<TrayClipboard>();
    let mut guard = clipboard.0.lock();
    if guard.is_none() {
        *guard = Some(arboard::Clipboard::new().map_err(|e| e.to_string())?);
    }
    let clipboard = guard
        .as_mut()
        .ok_or_else(|| current_locale().text().clipboard_init_failed.to_string())?;
    clipboard.set_text(text).map_err(|e| e.to_string())
}

async fn query_port_egress_ip(app: &AppHandle, mapping_id: &str) -> Result<String, String> {
    let locale = current_locale();
    let text = locale.text();
    let state = app.state::<crate::state::AppState>();
    let mapping = state
        .port_router
        .get_port_mapping_by_id(mapping_id)
        .ok_or_else(|| text.mapping_missing.to_string())?;
    if !mapping.enabled || !state.engine.get_status().running {
        return Err(text.egress_requires_core.to_string());
    }
    if mapping.residential_proxy_id.is_some() {
        // Chain ports route every destination through the generated per-port exit; probing the
        // mapped listener with its real protocol is the only accurate egress check.
        let info = crate::core::egress_probe::query_port_egress_info(mapping.port, mapping.protocol, None)
            .await
            .map_err(|e| format!("{}{e}", text.egress_chain_probe_failed))?;
        return Ok(info.ip);
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
            .map_err(|e| format!("{}{e}", text.egress_node_read_failed))?;
        let active = detail
            .now
            .filter(|name| !name.trim().is_empty())
            .ok_or_else(|| text.egress_node_pending.to_string())?;
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
    primary_latency: Option<u32>,
    fallback_latency: Option<u32>,
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

/// 主窗口尺寸的唯一来源：`tauri.conf.json` 中 `label = "main"` 的窗口定义。
pub struct MainWindowSizes {
    pub width: f64,
    pub height: f64,
    pub min_width: f64,
    pub min_height: f64,
}

pub fn main_window_sizes(app: &AppHandle) -> MainWindowSizes {
    let windows = &app.config().app.windows;
    let window = windows
        .iter()
        .find(|window| window.label == "main")
        .or_else(|| windows.first());
    match window {
        Some(window) => MainWindowSizes {
            width: window.width,
            height: window.height,
            min_width: window.min_width.unwrap_or(window.width),
            min_height: window.min_height.unwrap_or(window.height),
        },
        // 配置缺失时回退到 Tauri 自身的 WindowConfig 默认尺寸。
        None => MainWindowSizes {
            width: 800.0,
            height: 600.0,
            min_width: 800.0,
            min_height: 600.0,
        },
    }
}

pub fn ensure_main_window_open(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        activate_window(&window);
    } else {
        let sizes = main_window_sizes(app);
        let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
            .title(if is_dev_instance(app) {
                "Mihomo Multi [Dev]"
            } else {
                "Mihomo Multi"
            })
            .inner_size(sizes.width, sizes.height)
            .min_inner_size(sizes.min_width, sizes.min_height)
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

fn format_latency(locale: TrayLocale, latency: Option<u32>) -> String {
    match latency {
        Some(0) => locale.text().status_timeout.to_string(),
        Some(delay) => format!("{delay}ms"),
        None => "--ms".to_string(),
    }
}

async fn resolve_node_latency(
    state: &crate::state::AppState,
    profiles: &std::collections::HashMap<String, String>,
    node: &str,
    profile_id: &str,
    mapping_latency: Option<u32>,
) -> Option<u32> {
    let runtime_name = profiles
        .get(profile_id)
        .map(|name| format!("[{name}] {node}"))
        .unwrap_or_else(|| node.to_string());
    if let Some(latency) = state
        .latency_probe
        .get_latency(&runtime_name)
        .or_else(|| state.latency_probe.get_latency(node))
    {
        return Some(latency.unwrap_or(0));
    }
    if mapping_latency.is_some() {
        return mapping_latency;
    }
    state
        .engine
        .get_proxy_detail(&runtime_name)
        .await
        .ok()
        .and_then(|proxy| proxy.history.last().map(|history| history.delay))
}

async fn switch_tray_egress(app: &AppHandle, action: &str) -> Result<(), String> {
    let text = current_locale().text();
    let state = app.state::<crate::state::AppState>();
    let (tun_enabled, tun_port, system_proxy_enabled, system_proxy_port) = {
        let config = state.config.read();
        (
            config.tun_enabled,
            config.tun_port,
            config.system_proxy_enabled,
            config.system_proxy_port,
        )
    };
    let mappings = state.port_router.get_port_mappings();
    let (tun, enabled, port) = if let Some(id) = action.strip_prefix("port_egress:") {
        let mapping = mappings
            .iter()
            .find(|mapping| mapping.id == id)
            .ok_or_else(|| text.mapping_missing.to_string())?;
        let bound = if tun_enabled {
            tun_port == Some(mapping.port)
        } else {
            system_proxy_enabled && system_proxy_port == Some(mapping.port)
        };
        (tun_enabled, !bound, Some(mapping.port))
    } else {
        let tun = action == "toggle_tun";
        let enabled = if tun { !tun_enabled } else { !system_proxy_enabled };
        let disabled_ids = state.disabled_profile_ids();
        let port = tun_port
            .filter(|port| {
                mappings.iter().any(|mapping| {
                    crate::state::AppState::is_mapping_effective(mapping, &disabled_ids) && mapping.port == *port
                })
            })
            .or_else(|| {
                system_proxy_port.filter(|port| {
                    mappings.iter().any(|mapping| {
                        crate::state::AppState::is_mapping_effective(mapping, &disabled_ids) && mapping.port == *port
                    })
                })
            })
            .or_else(|| {
                mappings
                    .iter()
                    .filter(|mapping| crate::state::AppState::is_mapping_effective(mapping, &disabled_ids))
                    .map(|mapping| mapping.port)
                    .min()
            });
        (tun, enabled, port)
    };
    let disabled_ids = state.disabled_profile_ids();
    if enabled
        && (!state.engine.get_status().running
            || !mappings.iter().any(|mapping| {
                crate::state::AppState::is_mapping_effective(mapping, &disabled_ids) && Some(mapping.port) == port
            }))
    {
        return Err(text.proxy_requires_core.to_string());
    }
    if tun {
        crate::commands::set_tun(app.clone(), enabled, port, state).await?;
    } else {
        let (_, old_tun_enabled) = state.apply_system_proxy_transition(enabled, port)?;
        if enabled && old_tun_enabled {
            state.sync_runtime_config().await.map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn build_tray_menu_internal(
    app: &AppHandle,
    runtime_infos: &std::collections::HashMap<String, PortRuntimeInfo>,
    locale: TrayLocale,
) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    let text = locale.text();
    let is_dev = is_dev_instance(app);
    if is_dev {
        let dev_header = MenuItem::with_id(app, "dev_indicator", text.dev_badge, false, None::<&str>)?;
        menu.append(&dev_header)?;
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }
    let show_title = if is_dev {
        text.show_dev_window
    } else {
        text.show_main_window
    };
    let show_item = MenuItem::with_id(app, "show_window", show_title, true, None::<&str>)?;
    menu.append(&show_item)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;

    if let Some(state) = app.try_state::<crate::state::AppState>() {
        let mut mappings = state.port_router.get_port_mappings();
        mappings.sort_by_key(|m| m.port);
        let is_running = state.engine.get_status().running;
        let (system_proxy_enabled, tun_enabled, system_proxy_port, tun_port, env_proxy_port) = {
            let config = state.config.read();
            (
                config.system_proxy_enabled,
                config.tun_enabled,
                config.system_proxy_port.filter(|_| config.system_proxy_enabled),
                config.tun_port.filter(|_| config.tun_enabled),
                config.env_proxy_port.filter(|_| config.env_proxy_enabled),
            )
        };
        let actions = app.state::<TrayActions>();
        let testing = actions.latency_test.try_lock().is_err();
        let switching = actions.egress.try_lock().is_err();
        let disabled_ids = state.disabled_profile_ids();
        let has_enabled_ports = mappings
            .iter()
            .any(|m| crate::state::AppState::is_mapping_effective(m, &disabled_ids));
        menu.append(&MenuItem::with_id(
            app,
            "test_ports_delay",
            if testing {
                text.latency_test_running
            } else {
                text.latency_test
            },
            is_running && has_enabled_ports && !testing,
            None::<&str>,
        )?)?;
        menu.append(&CheckMenuItem::with_id(
            app,
            "toggle_tun",
            text.enable_tun,
            !switching && (tun_enabled || (is_running && has_enabled_ports)),
            tun_enabled,
            None::<&str>,
        )?)?;
        menu.append(&CheckMenuItem::with_id(
            app,
            "toggle_system_proxy",
            text.enable_system_proxy,
            !switching && (system_proxy_enabled || (is_running && has_enabled_ports)),
            system_proxy_enabled,
            None::<&str>,
        )?)?;
        menu.append(&PredefinedMenuItem::separator(app)?)?;

        if mappings.is_empty() {
            let empty_item = MenuItem::with_id(app, "no_ports", text.no_ports, false, None::<&str>)?;
            menu.append(&empty_item)?;
        } else {
            for m in mappings {
                let has_fallback = m.fallback_node_name.as_ref().is_some_and(|fb| !fb.trim().is_empty());

                let runtime_info = runtime_infos.get(&m.id);
                let is_fallback_active = runtime_info.map(|r| r.is_fallback_active).unwrap_or(m.manual_fallback);
                let is_manual = runtime_info.map(|r| r.manual_fallback).unwrap_or(m.manual_fallback);

                let node = if let Some(exit_id) = &m.residential_proxy_id {
                    let config = state.config.read();
                    let exit_name = config
                        .residential_proxies
                        .iter()
                        .find(|proxy| proxy.id == *exit_id)
                        .map_or(text.residential_exit_unavailable, |proxy| proxy.name.as_str());
                    format!("{} → {}", m.node_name, exit_name)
                } else if has_fallback && is_fallback_active {
                    m.fallback_node_name.as_deref().unwrap_or(&m.node_name).to_string()
                } else {
                    m.node_name.clone()
                };

                // 延迟与状态判定
                let primary_latency = runtime_info.and_then(|r| r.primary_latency).or(m.latency);
                let fallback_latency = runtime_info.and_then(|r| r.fallback_latency);
                let lat = if is_fallback_active {
                    fallback_latency
                } else {
                    primary_latency
                };
                let status = if !m.enabled {
                    text.status_disabled
                } else if !is_running {
                    text.status_not_running
                } else if has_fallback {
                    if is_fallback_active {
                        if is_manual {
                            text.status_fallback_locked
                        } else {
                            text.status_fallback_auto
                        }
                    } else {
                        text.status_primary_ok
                    }
                } else if lat == Some(0) {
                    text.status_timeout
                } else {
                    text.status_ok
                };

                let delay = format_latency(locale, lat);
                let status_title = if has_fallback {
                    locale.fallback_status(
                        status,
                        &format_latency(locale, primary_latency),
                        &format_latency(locale, fallback_latency),
                    )
                } else {
                    format!("{status} · {delay}")
                };

                // Node names are data; ampersands must not become menu mnemonics.
                let item_title = format!("{}  {}\t{}", m.port, node.replace('&', "&&"), delay);
                let submenu = Submenu::with_id(app, format!("port:{}", m.id), item_title, true)?;
                submenu.append(&MenuItem::with_id(
                    app,
                    format!("port_status:{}", m.id),
                    status_title,
                    false,
                    None::<&str>,
                )?)?;
                submenu.append(&PredefinedMenuItem::separator(app)?)?;
                submenu.append(&CheckMenuItem::with_id(
                    app,
                    format!("port_toggle:{}", m.id),
                    text.enable_listener,
                    true,
                    m.enabled,
                    None::<&str>,
                )?)?;
                let is_bound = if tun_enabled {
                    tun_port == Some(m.port)
                } else {
                    system_proxy_port == Some(m.port)
                };
                let is_effective = crate::state::AppState::is_mapping_effective(&m, &disabled_ids);
                submenu.append(&CheckMenuItem::with_id(
                    app,
                    format!("port_egress:{}", m.id),
                    match (tun_enabled, is_bound) {
                        (true, true) => text.disable_tun_proxy,
                        (true, false) => text.set_tun_proxy,
                        (false, true) => text.disable_system_proxy,
                        (false, false) => text.set_system_proxy,
                    },
                    !switching && (is_bound || (is_effective && is_running)),
                    is_bound,
                    None::<&str>,
                )?)?;
                let is_env_proxy = env_proxy_port == Some(m.port);
                let can_bind =
                    cfg!(windows) && is_effective && is_running && m.protocol != crate::models::InboundProtocol::Socks5;
                submenu.append(&CheckMenuItem::with_id(
                    app,
                    format!("port_env:{}", m.id),
                    if is_env_proxy {
                        text.unbind_env_proxy
                    } else {
                        text.bind_env_proxy
                    },
                    is_env_proxy || can_bind,
                    is_env_proxy,
                    None::<&str>,
                )?)?;
                submenu.append(&PredefinedMenuItem::separator(app)?)?;
                submenu.append(&MenuItem::with_id(
                    app,
                    format!("port_egress_ip:{}", m.id),
                    text.copy_egress_ip,
                    m.enabled && is_running,
                    None::<&str>,
                )?)?;
                for (shell, label) in [
                    ("powershell", text.copy_env_powershell),
                    ("cmd", text.copy_env_cmd),
                    ("shell", text.copy_env_shell),
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
        let loading_item = MenuItem::with_id(app, "state_loading", text.state_loading, false, None::<&str>)?;
        menu.append(&loading_item)?;
    }

    menu.append(&PredefinedMenuItem::separator(app)?)?;
    let restart_item = MenuItem::with_id(app, "restart_core", text.restart_core, true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit_app", text.quit_app, true, None::<&str>)?;
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
        if m.residential_proxy_id.is_some() {
            let target = crate::core::config_generator::chain_proxy_name(m.port);
            let primary_latency = state
                .latency_probe
                .get_latency(&target)
                .map(|latency| Some(latency.unwrap_or(0)))
                .unwrap_or(m.latency);
            runtime_infos.insert(
                m.id,
                PortRuntimeInfo {
                    is_fallback_active: false,
                    manual_fallback: false,
                    primary_latency,
                    fallback_latency: None,
                },
            );
            continue;
        }
        if let Some(status) = fallback_statuses.iter().find(|status| status.mapping_id == m.id) {
            runtime_infos.insert(
                m.id,
                PortRuntimeInfo {
                    is_fallback_active: status.is_fallback_active,
                    manual_fallback: status.manual_fallback,
                    primary_latency: status.primary_latency,
                    fallback_latency: status.fallback_latency,
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

        let primary_latency = resolve_node_latency(&state, &profile_map, &m.node_name, &m.profile_id, m.latency).await;
        let fallback_latency = if let Some(node) = m.fallback_node_name.as_deref().filter(|n| !n.trim().is_empty()) {
            resolve_node_latency(
                &state,
                &profile_map,
                node,
                m.fallback_profile_id.as_deref().unwrap_or(&m.profile_id),
                None,
            )
            .await
        } else {
            None
        };

        runtime_infos.insert(
            m.id,
            PortRuntimeInfo {
                is_fallback_active,
                manual_fallback,
                primary_latency,
                fallback_latency,
            },
        );
    }

    runtime_infos
}

fn compute_menu_fingerprint(
    mappings: &[crate::models::PortMapping],
    runtime_infos: &std::collections::HashMap<String, PortRuntimeInfo>,
    is_running: bool,
    locale: TrayLocale,
) -> String {
    let mut fp = String::new();
    fp.push_str(locale.tag());
    fp.push(';');
    fp.push_str(if is_running { "RUN;" } else { "STOP;" });
    for m in mappings {
        let r = runtime_infos.get(&m.id);
        let primary_lat = r.and_then(|x| x.primary_latency).or(m.latency);
        let fallback_lat = r.and_then(|x| x.fallback_latency);
        let fb_active = r.map(|x| x.is_fallback_active).unwrap_or(m.manual_fallback);
        let manual = r.map(|x| x.manual_fallback).unwrap_or(m.manual_fallback);
        fp.push_str(&format!(
            "{}:{}:{}:{:?}:{:?}:{:?}:{}:{};",
            m.port, m.enabled, m.node_name, m.residential_proxy_id, primary_lat, fallback_lat, fb_active, manual
        ));
    }
    fp
}

static LAST_TRAY_FINGERPRINT: parking_lot::Mutex<Option<String>> = parking_lot::Mutex::new(None);
static LAST_TRAY_CLICK_TIME: parking_lot::Mutex<Option<std::time::Instant>> = parking_lot::Mutex::new(None);

/// Newest refresh request. A request that arrives while the worker is busy only replaces this
/// snapshot, so updates are coalesced and stale snapshots are dropped instead of racing each
/// other on the tray.
struct TrayRefreshRequest {
    seq: u64,
    fallback_statuses: Vec<crate::models::PortFallbackStatus>,
}

static TRAY_REFRESH_REQUEST: parking_lot::Mutex<TrayRefreshRequest> = parking_lot::Mutex::new(TrayRefreshRequest {
    seq: 0,
    fallback_statuses: Vec::new(),
});

/// True while a refresh worker owns the tray update. At most one worker exists at a time.
static TRAY_REFRESH_WORKER_ACTIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn current_tray_refresh_seq() -> u64 {
    TRAY_REFRESH_REQUEST.lock().seq
}

/// Applies the snapshot captured for `seq`. Returns `false` when the snapshot became obsolete
/// (a newer request arrived or a native menu is open) before it could be applied, so the worker
/// retries with the newest state instead of overwriting it.
async fn apply_tray_refresh(
    app: &AppHandle,
    seq: u64,
    fallback_statuses: &[crate::models::PortFallbackStatus],
) -> bool {
    if seq != current_tray_refresh_seq() {
        return false;
    }
    let Some(tray) = app.tray_by_id(get_tray_id(app)) else {
        return true; // tray is gone, nothing left to update
    };
    let Some(state) = app.try_state::<crate::state::AppState>() else {
        return true;
    };

    // Windows dismisses an open popup menu if `set_menu` runs while it is visible, so defer the
    // whole update until the menu closes. A newer request abandons the wait immediately.
    while is_tray_menu_active() {
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        if seq != current_tray_refresh_seq() {
            return false;
        }
    }

    let is_running = state.engine.get_status().running;
    let mut mappings = state.port_router.get_port_mappings();
    mappings.sort_by_key(|m| m.port);

    let runtime_infos = query_runtime_infos(app, fallback_statuses).await;
    // The runtime queries are slow; a language or state change that arrived meanwhile owns the
    // tray now, so never apply this stale snapshot.
    if seq != current_tray_refresh_seq() {
        return false;
    }
    let locale = current_locale();

    let mut current_fp = compute_menu_fingerprint(&mappings, &runtime_infos, is_running, locale);
    {
        use std::fmt::Write;
        let config = state.config.read();
        let actions = app.state::<TrayActions>();
        if let Err(error) = write!(
            current_fp,
            "{:?}:{}:{:?}:{}:{:?}:{}:{}:{};",
            config.system_proxy_port,
            config.system_proxy_enabled,
            config.tun_port,
            config.tun_enabled,
            config.env_proxy_port,
            config.env_proxy_enabled,
            actions.latency_test.try_lock().is_err(),
            actions.egress.try_lock().is_err(),
        ) {
            warn!("Failed to format tray fingerprint: {error}");
            return true;
        }
        for proxy in &config.residential_proxies {
            if let Err(error) = write!(current_fp, "{}:{};", proxy.id, proxy.name) {
                warn!("Failed to format residential exit fingerprint: {error}");
                return true;
            }
        }
    }

    let tooltip = format_tray_tooltip_for(app, locale);

    // Re-check as late as possible: the popup may have opened or a newer request may have
    // arrived while querying. Only the newest snapshot is allowed to touch the tooltip.
    if seq != current_tray_refresh_seq() || is_tray_menu_active() {
        return false;
    }
    // The tooltip must refresh even when the menu content is unchanged (it may currently show a
    // transient message), but only from the newest snapshot/language.
    if let Err(error) = tray.set_tooltip(Some(tooltip)) {
        warn!("Failed to set updated tray tooltip: {}", error);
    }

    if LAST_TRAY_FINGERPRINT.lock().as_deref() == Some(current_fp.as_str()) {
        // Content has not changed: avoid calling set_menu to prevent closing open context menus!
        return true;
    }

    let menu = match build_tray_menu_internal(app, &runtime_infos, locale) {
        Ok(menu) => menu,
        Err(error) => {
            warn!("Failed to build updated tray menu: {}", error);
            return true;
        }
    };

    if seq != current_tray_refresh_seq() || is_tray_menu_active() {
        return false;
    }
    if let Err(error) = tray.set_menu(Some(menu)) {
        // Deliberately keep the old fingerprint so the next request retries this menu.
        warn!("Failed to set updated tray menu: {}", error);
        return true;
    }
    *LAST_TRAY_FINGERPRINT.lock() = Some(current_fp);
    true
}

struct TrayRefreshWorkerGuard {
    active: bool,
}

impl TrayRefreshWorkerGuard {
    fn new() -> Self {
        Self { active: true }
    }

    fn release(&mut self) {
        self.active = false;
    }

    fn reclaim(&mut self) {
        self.active = true;
    }
}

impl Drop for TrayRefreshWorkerGuard {
    fn drop(&mut self) {
        if self.active {
            TRAY_REFRESH_WORKER_ACTIVE.store(false, std::sync::atomic::Ordering::SeqCst);
        }
    }
}

fn request_tray_refresh(app: &AppHandle, fallback_statuses: Vec<crate::models::PortFallbackStatus>) {
    use std::sync::atomic::Ordering;
    {
        let mut request = TRAY_REFRESH_REQUEST.lock();
        request.seq = request.seq.wrapping_add(1);
        request.fallback_statuses = fallback_statuses;
    }
    // Publish the request before spawning: a worker that is already running observes the new
    // sequence on its next iteration.
    if TRAY_REFRESH_WORKER_ACTIVE.swap(true, Ordering::SeqCst) {
        return;
    }

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut worker_guard = TrayRefreshWorkerGuard::new();
        loop {
            let (seq, fallback_statuses) = {
                let request = TRAY_REFRESH_REQUEST.lock();
                (request.seq, request.fallback_statuses.clone())
            };

            let applied = apply_tray_refresh(&app_handle, seq, &fallback_statuses).await;
            if !applied || seq != current_tray_refresh_seq() {
                continue;
            }

            // Idle: release ownership so the next request spawns a fresh worker.
            if TRAY_REFRESH_WORKER_ACTIVE
                .compare_exchange(true, false, Ordering::SeqCst, Ordering::SeqCst)
                .is_err()
            {
                worker_guard.release();
                return; // another worker took over
            }
            worker_guard.release();
            if seq == current_tray_refresh_seq() {
                return;
            }
            // A request raced with the release above and assumed this worker would handle it:
            // reclaim ownership, or leave it to the worker that request already spawned.
            if TRAY_REFRESH_WORKER_ACTIVE.swap(true, Ordering::SeqCst) {
                return;
            }
            worker_guard.reclaim();
        }
    });
}

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
    format_tray_tooltip_for(app, current_locale())
}

fn format_tray_tooltip_for(app: &AppHandle, locale: TrayLocale) -> String {
    let app_title = tray_app_title(is_dev_instance(app));
    let Some(state) = app.try_state::<crate::state::AppState>() else {
        return app_title;
    };
    let text = locale.text();
    let (enabled, disabled) = match locale {
        TrayLocale::ZhCn => (text.enabled, text.disabled),
        TrayLocale::EnUs => ("On", "Off"),
    };

    let mappings = state.port_router.get_port_mappings();
    let total_ports = mappings.len();
    let enabled_ports = mappings.iter().filter(|m| m.enabled).count();
    let core_running = state.engine.get_status().running;
    let config = state.config.read();
    let sys_proxy_str = if config.system_proxy_enabled {
        match config.system_proxy_port {
            Some(port) => locale.enabled_with_port(port),
            None => enabled.to_string(),
        }
    } else {
        disabled.to_string()
    };
    let env_proxy_str = if config.env_proxy_enabled {
        match config.env_proxy_port {
            Some(port) => locale.enabled_with_port(port),
            None => enabled.to_string(),
        }
    } else {
        disabled.to_string()
    };

    let tun_str = if config.tun_enabled {
        match config.tun_port {
            Some(port) => locale.enabled_with_port(port),
            None => enabled.to_string(),
        }
    } else {
        disabled.to_string()
    };
    let core_status = if core_running {
        text.core_running
    } else {
        text.core_stopped
    };
    let ports = locale.tooltip_ports(enabled_ports, total_ports);

    locale.tooltip(
        &app_title,
        core_status,
        &ports,
        &sys_proxy_str,
        &env_proxy_str,
        &tun_str,
    )
}

pub fn update_tray_menu(app: &AppHandle) {
    update_tray_menu_with_fallback_statuses(app, Vec::new());
}

pub fn update_tray_menu_with_fallback_statuses(
    app: &AppHandle,
    fallback_statuses: Vec<crate::models::PortFallbackStatus>,
) {
    // Requests are coalesced into a single worker; the newest request (state + language) wins and
    // stale snapshots are never applied to the tray.
    request_tray_refresh(app, fallback_statuses);
}

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let initial_runtime_infos = std::collections::HashMap::new();
    app.manage(TrayClipboard::default());
    app.manage(TrayActions::default());
    let locale = current_locale();
    let menu = build_tray_menu_internal(app, &initial_runtime_infos, locale)?;
    let initial_tooltip = format_tray_tooltip_for(app, locale);

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
                    && let Err(error) =
                        tray.set_tooltip(Some(current_locale().text().probe_egress_ip))
                {
                    show_tray_error(app, &error.to_string());
                    return;
                }
                tauri::async_runtime::spawn(async move {
                    let result = async {
                        let text = current_locale().text();
                        let ip = query_port_egress_ip(&app_handle, &mapping_id).await?;
                        let message = format!("{}{ip}", text.egress_ip_copied);
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
            if event_id == "test_ports_delay" {
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let actions = app_handle.state::<TrayActions>();
                    let Ok(guard) = actions.latency_test.try_lock() else {
                        return;
                    };
                    update_tray_menu(&app_handle);
                    let result = crate::commands::test_all_port_mappings_delay(
                        app_handle.clone(),
                        None,
                        None,
                        None,
                        app_handle.state::<crate::state::AppState>(),
                    )
                    .await;
                    drop(guard);
                    update_tray_menu(&app_handle);
                    match result {
                        Ok(results) => {
                            let reachable = results
                                .iter()
                                .filter(|result| result.latency.is_some_and(|delay| delay > 0))
                                .count();
                            let failed = results.len() - reachable;
                            let locale = current_locale();
                            app_handle
                                .dialog()
                                .message(locale.latency_summary(reachable, failed))
                                .title(locale.text().latency_test)
                                .show(|_| {});
                        }
                        Err(error) => show_tray_error(&app_handle, &error.message),
                    }
                });
                return;
            }
            if event_id == "toggle_tun" || event_id == "toggle_system_proxy" || event_id.starts_with("port_egress:") {
                let action = event_id.to_string();
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let actions = app_handle.state::<TrayActions>();
                    let Ok(guard) = actions.egress.try_lock() else {
                        return;
                    };
                    update_tray_menu(&app_handle);
                    let result = switch_tray_egress(&app_handle, &action).await;
                    drop(guard);
                    update_tray_menu(&app_handle);
                    if let Err(error) = app_handle.emit("port-mappings-changed", ()) {
                        show_tray_error(&app_handle, &error.to_string());
                    }
                    if let Err(error) = result {
                        show_tray_error(&app_handle, &error);
                    }
                });
                return;
            }
            if let Some((action, mapping_id)) = event_id.split_once(':')
                && (action == "port_env" || action.starts_with("port_copy_"))
            {
                let result = (|| -> Result<(), String> {
                    let locale = current_locale();
                    let text = locale.text();
                    let state = app.state::<crate::state::AppState>();
                    let mapping = state
                        .port_router
                        .get_port_mapping_by_id(mapping_id)
                        .ok_or_else(|| text.mapping_missing.to_string())?;
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
                            return Err(text.terminal_proxy_requires_running.into());
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
                            locale,
                        )?;
                        copy_tray_text(app, command)?;
                        if let Some(tray) = app.tray_by_id(get_tray_id(app)) {
                            tray.set_tooltip(Some(text.env_command_copied))
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
                    let app_handle = app.clone();
                    std::thread::spawn(move || {
                        app_handle.exit(0);
                        std::thread::sleep(std::time::Duration::from_millis(1500));
                        if let Some(state) = app_handle.try_state::<crate::state::AppState>() {
                            state.cleanup_on_exit(&app_handle);
                        }
                        std::process::exit(0);
                    });
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Enter { .. } => {
                let app = tray.app_handle();
                let tooltip = format_tray_tooltip_for(app, current_locale());
                let _ = tray.set_tooltip(Some(tooltip));
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
