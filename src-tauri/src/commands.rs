use crate::core::port_probe::is_port_available;
use crate::models::{
    AppConfig, AppStatus, CoreStatus, NodeLatencyResult, PortMapping, ProfileItem, ProxyNode,
};
use crate::state::AppState;
use std::process::Command;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn get_app_status(state: State<'_, AppState>) -> Result<AppStatus, String> {
    let core = state.supervisor.get_status();
    let profiles = state.profile_manager.get_profiles();
    let total_profiles = profiles.len();
    let total_nodes = profiles.iter().map(|p| p.node_count).sum();

    let port_mappings = state.port_manager.get_port_mappings();
    let total_ports = port_mappings.len();
    let active_ports = port_mappings.iter().filter(|p| p.enabled).count();

    Ok(AppStatus {
        core,
        total_ports,
        active_ports,
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
    let _ = state.sync_runtime_config().await;
    let config = state.config.read().clone();
    state.supervisor.start(&app, &config).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn stop_core(state: State<'_, AppState>) -> Result<(), String> {
    state.supervisor.stop().map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn restart_core(app: AppHandle, state: State<'_, AppState>) -> Result<CoreStatus, String> {
    let _ = state.sync_runtime_config().await;
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
    *state.config.write() = config.clone();
    let config_path = state.app_dir.join("config.json");
    if let Ok(json) = serde_json::to_string_pretty(&config) {
        let _ = std::fs::write(config_path, json);
    }
    let _ = state.sync_runtime_config().await;
    Ok(())
}

// ----------------------------------------------------------------------------
// Port Mapping Management Commands
// ----------------------------------------------------------------------------

#[tauri::command]
pub async fn get_port_mappings(state: State<'_, AppState>) -> Result<Vec<PortMapping>, String> {
    Ok(state.port_manager.get_port_mappings())
}

#[tauri::command]
pub async fn save_port_mapping(
    mapping: PortMapping,
    state: State<'_, AppState>,
) -> Result<PortMapping, String> {
    let saved = state
        .port_manager
        .save_port_mapping(mapping)
        .map_err(|err| err.to_string())?;
    let _ = state.sync_runtime_config().await;
    Ok(saved)
}

#[tauri::command]
pub async fn delete_port_mapping(id: String, state: State<'_, AppState>) -> Result<(), String> {
    state
        .port_manager
        .delete_port_mapping(&id)
        .map_err(|err| err.to_string())?;
    let _ = state.sync_runtime_config().await;
    Ok(())
}

#[tauri::command]
pub async fn toggle_port_mapping(
    id: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<PortMapping, String> {
    let toggled = state
        .port_manager
        .toggle_port_mapping(&id, enabled)
        .map_err(|err| err.to_string())?;
    let _ = state.sync_runtime_config().await;
    Ok(toggled)
}

#[tauri::command]
pub async fn test_port_mapping_delay(
    id: String,
    test_url: Option<String>,
    timeout_ms: Option<u32>,
    state: State<'_, AppState>,
) -> Result<u32, String> {
    let status = state.supervisor.get_status();
    if !status.running {
        return Err("Mihomo 内核未运行，请在设置中启动内核后再进行测速".to_string());
    }

    let mapping = state
        .port_manager
        .get_port_mapping_by_id(&id)
        .ok_or_else(|| format!("未找到 ID 为 '{}' 的端口映射", id))?;

    let profile = state.profile_manager.get_profile_by_id(&mapping.profile_id);
    let runtime_name = if let Some(prof) = profile {
        format!("[{}] {}", prof.name, mapping.node_name)
    } else {
        mapping.node_name.clone()
    };

    let client = state.clash_client();
    let res = client
        .test_delay(&runtime_name, test_url.as_deref(), timeout_ms)
        .await;

    match res {
        Ok(delay) => {
            let _ = state.port_manager.update_port_latency(&id, Some(delay));
            Ok(delay)
        }
        Err(err) => {
            let _ = state.port_manager.update_port_latency(&id, None);
            Err(err.to_string())
        }
    }
}

#[tauri::command]
pub async fn test_all_port_mappings_delay(
    test_url: Option<String>,
    timeout_ms: Option<u32>,
    concurrency: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<NodeLatencyResult>, String> {
    let status = state.supervisor.get_status();
    if !status.running {
        return Err("Mihomo 内核未运行，请在设置中启动内核后再进行测速".to_string());
    }

    let mappings = state.port_manager.get_port_mappings();
    if mappings.is_empty() {
        return Ok(Vec::new());
    }

    let profiles = state.profile_manager.get_profiles();
    let profile_map: std::collections::HashMap<String, String> = profiles
        .into_iter()
        .map(|p| (p.id, p.name))
        .collect();

    let mut mapping_nodes = Vec::with_capacity(mappings.len());
    for m in &mappings {
        let runtime_name = if let Some(pname) = profile_map.get(&m.profile_id) {
            format!("[{}] {}", pname, m.node_name)
        } else {
            m.node_name.clone()
        };
        mapping_nodes.push((m.id.clone(), runtime_name));
    }

    let names_to_test: Vec<String> = mapping_nodes.iter().map(|(_, rname)| rname.clone()).collect();
    let client = state.clash_client();
    let results = client
        .test_nodes_delay_batch(&names_to_test, test_url.as_deref(), timeout_ms, concurrency)
        .await;

    // Update latencies back into port_manager
    for (idx, (mapping_id, _)) in mapping_nodes.iter().enumerate() {
        if let Some(res) = results.get(idx) {
            let _ = state
                .port_manager
                .update_port_latency(mapping_id, res.latency);
        }
    }

    Ok(results)
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
pub async fn update_profile(id: String, state: State<'_, AppState>) -> Result<ProfileItem, String> {
    let item = state
        .profile_manager
        .update_profile(&id)
        .await
        .map_err(|err| err.to_string())?;
    let _ = state.sync_runtime_config().await;
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
pub async fn delete_profile(id: String, state: State<'_, AppState>) -> Result<(), String> {
    state
        .profile_manager
        .delete_profile(&id)
        .map_err(|err| err.to_string())?;
    let _ = state.sync_runtime_config().await;
    Ok(())
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
    let status = state.supervisor.get_status();
    if !status.running {
        return Err("Mihomo 内核未运行，请在设置中启动内核后再进行测速".to_string());
    }

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
    let status = state.supervisor.get_status();
    if !status.running {
        return Err("Mihomo 内核未运行，请在设置中启动内核后再进行测速".to_string());
    }

    let client = state.clash_client();
    let results = client
        .test_nodes_delay_batch(&node_names, test_url.as_deref(), timeout_ms, concurrency)
        .await;
    Ok(results)
}
