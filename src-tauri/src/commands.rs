use crate::core::port_probe::is_port_available;
use crate::models::{AppConfig, AppStatus, CoreStatus, ProfileItem, ProxyNode};
use crate::state::AppState;
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
