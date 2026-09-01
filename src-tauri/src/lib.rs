pub mod commands;
pub mod core;
pub mod error;
pub mod models;
pub mod state;

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

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let app_handle = app.handle();
            let app_dir = app_handle
                .path()
                .app_local_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("data"));

            std::fs::create_dir_all(&app_dir).ok();

            info!("App local data directory: {}", app_dir.display());
            let app_state = AppState::new(app_dir);

            // Auto-start core if enabled
            let auto_start = app_state.config.read().auto_start_core;
            if auto_start {
                let supervisor = app_state.supervisor.clone();
                let handle = app_handle.clone();
                let config = app_state.config.read().clone();
                tokio::spawn(async move {
                    if let Err(err) = supervisor.start(&handle, &config) {
                        error!("Failed to auto-start Mihomo core: {}", err);
                    } else {
                        info!("Mihomo core auto-started successfully");
                    }
                });
            }

            app.manage(app_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_status,
            get_core_status,
            start_core,
            stop_core,
            restart_core,
            check_port_available,
            get_config,
            save_config,
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed)
                && let Some(state) = window.try_state::<AppState>()
            {
                info!("Window destroyed, ensuring sidecar process is terminated");
                let _ = state.supervisor.stop();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
