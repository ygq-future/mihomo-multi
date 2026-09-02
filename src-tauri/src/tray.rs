use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};
use tracing::{error, info};

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show_window", "显示主窗口", true, None::<&str>)?;
    let restart_item = MenuItem::with_id(app, "restart_core", "重启内核", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit_app", "退出程序", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show_item, &restart_item, &quit_item])?;

    let tray_builder = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
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
                        if let Err(e) = state.supervisor.restart(&app_handle, &config) {
                            error!("Failed to restart core from tray: {}", e);
                        } else {
                            info!("Mihomo core restarted from tray");
                        }
                    }
                });
            }
            "quit_app" => {
                info!("Quitting application from tray");
                app.exit(0);
            }
            _ => {}
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
