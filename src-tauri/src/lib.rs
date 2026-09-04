#![allow(linker_messages)]

pub mod commands;
pub mod core;
pub mod error;
pub mod models;
pub mod state;
pub mod tray;

use commands::*;
use state::AppState;
use tauri::Manager;
use tracing::{error, info};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

pub fn run() {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "mihomo_multi=debug,info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    info!("Initializing Mihomo Multi application backend...");

    let window_state_flags = tauri_plugin_window_state::StateFlags::all()
        & !tauri_plugin_window_state::StateFlags::VISIBLE;

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(window_state_flags)
                .build(),
        )
        .setup(|app| {
            let app_handle = app.handle();
            let app_dir = app_handle
                .path()
                .app_local_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("data"));

            std::fs::create_dir_all(&app_dir).ok();

            info!("App local data directory: {}", app_dir.display());
            let app_state = AppState::new(app_dir);
            app.manage(app_state.clone());

            // Create system tray icon and native menu
            if let Err(e) = tray::create_tray(app_handle) {
                error!("Failed to create system tray: {}", e);
            }
            // Silent start check and window presentation
            let args: Vec<String> = std::env::args().collect();
            let is_silent = args.iter().any(|a| a == "--silent" || a == "-s") || app_state.config.read().silent_start;
            if let Some(main_win) = app_handle.get_webview_window("main") {
                if is_silent {
                    let _ = main_win.hide();
                    info!("Silent start mode: main window minimized to tray on launch");
                } else {
                    let _ = main_win.show();
                    let _ = main_win.set_focus();
                }
            }

            // Auto-start core on application launch (sync_runtime_config performs non-destructive occupancy self-check)
            let state_clone = app_state.clone();
            let supervisor = app_state.supervisor.clone();
            let handle = app_handle.clone();
            let config = app_state.config.read().clone();
            tauri::async_runtime::spawn(async move {
                let _ = state_clone.sync_runtime_config().await;
                if let Err(err) = supervisor.start(&handle, &config) {
                    error!("Failed to auto-start Mihomo core: {}", err);
                } else {
                    info!("Mihomo core auto-started successfully");
                    tray::update_tray_menu(&handle);
                }
            });

            // Start background profile auto-updater
            app_state
                .auto_updater
                .start(app_handle.clone(), app_state.clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_status,
            get_core_status,
            start_core,
            stop_core,
            restart_core,
            check_port_available,
            get_next_available_port,
            get_config,
            save_config,
            get_port_mappings,
            get_occupied_ports,
            save_port_mapping,
            delete_port_mapping,
            toggle_port_mapping,
            test_port_mapping_delay,
            test_all_port_mappings_delay,
            get_port_fallback_statuses,
            get_profiles,
            add_remote_profile,
            add_local_profile,
            update_profile,
            edit_profile,
            delete_profile,
            get_profile_nodes,
            get_all_nodes,
            test_node_delay,
            test_nodes_delay_batch,
            get_drift_reports,
            get_auto_updater_status,
            trigger_auto_update_check,
            open_app_data_dir,
            open_file_in_folder,
            get_app_dir,
            get_lan_ip_addresses,
        ])
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                if let Some(state) = window.try_state::<AppState>()
                    && state.config.read().close_to_tray
                {
                    api.prevent_close();
                    let _ = window.hide();
                    info!("Window close prevented, minimized to system tray");
                }
            }
            tauri::WindowEvent::Destroyed => {
                if let Some(state) = window.try_state::<AppState>() {
                    info!("Window destroyed, ensuring sidecar process and background services are terminated");
                    state.auto_updater.stop();
                    let _ = state.supervisor.stop();
                }
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
