use crate::core::port_probe::is_port_available;
use crate::models::{AppConfig, AppStatus, CoreStatus, NodeLatencyResult, ProfileItem, ProxyNode};
use crate::state::AppState;
use std::process::Command;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn get_app_status(state: State<'_, AppState>) -> Result<AppStatus, String> {
    let core = state.supervisor.get_status();
    let profiles = state.profile_manager.get_profiles();
    let total_profiles = profiles.len();
    let total_nodes = profiles.iter().map(|p| p.node_count).sum();

    Ok(AppStatus {
        core,
        total_ports: 0,
        active_ports: 0,
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
    let config = state.config.read().clone();
    state.supervisor.start(&app, &config).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn stop_core(state: State<'_, AppState>) -> Result<(), String> {
    state.supervisor.stop().map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn restart_core(app: AppHandle, state: State<'_, AppState>) -> Result<CoreStatus, String> {
    let config = state.config.read().clone();
    state.supervisor.restart(&app, &config).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn check_port_available(port: u16) -> Result<bool, String> {
    Ok(is_port_available(port))
}

#[tauri::command]
pub async fn get_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    Ok(state.config.read().clone())
}

#[tauri::command]
pub async fn save_config(config: AppConfig, state: State<'_, AppState>) -> Result<(), String> {
    *state.config.write() = config;
    Ok(())
}

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
    state
        .profile_manager
        .add_remote_profile(name, url, interval_mins)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn add_local_profile(
    name: String,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<ProfileItem, String> {
    state
        .profile_manager
        .add_local_profile(name, file_path)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn update_profile(id: String, state: State<'_, AppState>) -> Result<ProfileItem, String> {
    state
        .profile_manager
        .update_profile(&id)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn edit_profile(
    id: String,
    name: String,
    url: Option<String>,
    interval_mins: u32,
    state: State<'_, AppState>,
) -> Result<ProfileItem, String> {
    state
        .profile_manager
        .edit_profile(&id, name, url, interval_mins)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn delete_profile(id: String, state: State<'_, AppState>) -> Result<(), String> {
    state
        .profile_manager
        .delete_profile(&id)
        .map_err(|err| err.to_string())
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
    let client = state.clash_client();
    client
        .test_delay(&node_name, test_url.as_deref(), timeout_ms)
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
    let client = state.clash_client();
    let results = client
        .test_nodes_delay_batch(&node_names, test_url.as_deref(), timeout_ms, concurrency)
        .await;
    Ok(results)
}
