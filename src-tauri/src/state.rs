use crate::core::clash_client::ClashApiClient;
use crate::core::config_generator::MinimalRuntimeConfig;
use crate::core::profile_manager::ProfileManager;
use crate::core::supervisor::CoreSupervisor;
use crate::error::{AppError, AppResult};
use crate::models::AppConfig;
use parking_lot::RwLock;
use std::path::PathBuf;
use std::sync::Arc;
use tracing::{info, warn};

#[derive(Clone)]
pub struct AppState {
    pub supervisor: CoreSupervisor,
    pub profile_manager: Arc<ProfileManager>,
    pub config: Arc<RwLock<AppConfig>>,
    pub app_dir: PathBuf,
}

impl AppState {
    pub fn new(app_dir: PathBuf) -> Self {
        let work_dir = app_dir.join("core");
        let supervisor = CoreSupervisor::new(work_dir);
        let profile_manager = Arc::new(ProfileManager::new(app_dir.clone()));

        let config_path = app_dir.join("config.json");
        let initial_config = if config_path.exists() {
            match std::fs::read_to_string(&config_path) {
                Ok(content) => serde_json::from_str::<AppConfig>(&content).unwrap_or_default(),
                Err(_) => AppConfig::default(),
            }
        } else {
            let cfg = AppConfig::default();
            if let Ok(json) = serde_json::to_string_pretty(&cfg) {
                let _ = std::fs::write(&config_path, json);
            }
            cfg
        };

        let config = Arc::new(RwLock::new(initial_config));

        Self {
            supervisor,
            profile_manager,
            config,
            app_dir,
        }
    }

    pub fn clash_client(&self) -> ClashApiClient {
        let cfg = self.config.read();
        ClashApiClient::new(cfg.controller_port, &cfg.controller_secret)
    }

    /// Synchronizes all proxy nodes into runtime.yaml and triggers a hot reload if the core is running
    pub async fn sync_runtime_config(&self) -> AppResult<PathBuf> {
        let raw_proxies = self.profile_manager.get_raw_proxies_for_all_profiles();
        let cfg = self.config.read().clone();

        let runtime_config = MinimalRuntimeConfig::with_mappings(
            cfg.controller_port,
            &cfg.controller_secret,
            &cfg.log_level,
            &[],
            raw_proxies,
        );

        let work_dir = self.app_dir.join("core");
        std::fs::create_dir_all(&work_dir).map_err(AppError::Io)?;
        let runtime_path = work_dir.join("runtime.yaml");
        runtime_config.write_to_file(&runtime_path)?;

        let core_status = self.supervisor.get_status();
        if core_status.running {
            let client = self.clash_client();
            let path_str = runtime_path.to_string_lossy().to_string();
            if let Err(err) = client.reload_config(&path_str).await {
                warn!("Hot-reloading Mihomo config after sync failed: {}", err);
            } else {
                info!("Mihomo configuration reloaded with updated profile proxies");
            }
        }

        Ok(runtime_path)
    }
}
