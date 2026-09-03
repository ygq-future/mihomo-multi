use crate::core::auto_updater::AutoUpdater;
use crate::core::clash_client::ClashApiClient;
use crate::core::config_generator::MinimalRuntimeConfig;
use crate::core::port_manager::PortManager;
use crate::core::profile_manager::ProfileManager;
use crate::core::supervisor::CoreSupervisor;
use crate::error::{AppError, AppResult};
use crate::models::AppConfig;
use parking_lot::RwLock;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use tracing::{info, warn};

#[derive(Clone)]
pub struct AppState {
    pub supervisor: CoreSupervisor,
    pub profile_manager: Arc<ProfileManager>,
    pub port_manager: Arc<PortManager>,
    pub auto_updater: Arc<AutoUpdater>,
    pub config: Arc<RwLock<AppConfig>>,
    pub occupied_ports: Arc<RwLock<HashSet<u16>>>,
    pub app_dir: PathBuf,
}

impl AppState {
    pub fn new(app_dir: PathBuf) -> Self {
        let work_dir = app_dir.join("core");
        let supervisor = CoreSupervisor::new(work_dir);
        let profile_manager = Arc::new(ProfileManager::new(app_dir.clone()));
        let port_manager = Arc::new(PortManager::new(app_dir.clone()));
        let auto_updater = Arc::new(AutoUpdater::new());
        let occupied_ports = Arc::new(RwLock::new(HashSet::new()));

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
            port_manager,
            auto_updater,
            config,
            occupied_ports,
            app_dir,
        }
    }

    pub fn clash_client(&self) -> ClashApiClient {
        let cfg = self.config.read();
        ClashApiClient::new(cfg.controller_port, &cfg.controller_secret)
    }

    /// Generates runtime.yaml on disk, safely excluding occupied ports to protect Mihomo stability
    pub fn generate_runtime_config_file(&self) -> AppResult<PathBuf> {
        let raw_proxies = self.profile_manager.get_raw_proxies_for_all_profiles();
        let profiles = self.profile_manager.get_profiles();
        let profile_map: HashMap<String, String> = profiles
            .into_iter()
            .map(|p| (p.id, p.name))
            .collect();

        let mappings = self.port_manager.get_port_mappings();
        let cfg = self.config.read().clone();

        let core_status = self.supervisor.get_status();
        let my_core_pid = if core_status.running { core_status.pid } else { None };

        let mut occupied_set = HashSet::new();
        let mut active_mappings = Vec::new();

        for m in mappings {
            if m.enabled {
                if crate::core::port_probe::is_port_available_with_lan(m.port, cfg.allow_lan, my_core_pid) {
                    active_mappings.push(m);
                } else {
                    warn!(
                        "Port {} is occupied by third-party application, safely excluding from runtime listeners",
                        m.port
                    );
                    occupied_set.insert(m.port);
                }
            } else {
                active_mappings.push(m);
            }
        }

        *self.occupied_ports.write() = occupied_set;

        let runtime_config = MinimalRuntimeConfig::with_mappings(
            cfg.controller_port,
            &cfg.controller_secret,
            &cfg.log_level,
            cfg.allow_lan,
            &active_mappings,
            raw_proxies,
            &profile_map,
        );

        let work_dir = self.app_dir.join("core");
        std::fs::create_dir_all(&work_dir).map_err(AppError::Io)?;
        let runtime_path = work_dir.join("runtime.yaml");
        runtime_config.write_to_file(&runtime_path)?;
        Ok(runtime_path)
    }

    /// Synchronizes all active port listeners and proxy nodes into runtime.yaml and triggers a hot reload if the core is running
    pub async fn sync_runtime_config(&self) -> AppResult<PathBuf> {
        let runtime_path = self.generate_runtime_config_file()?;

        let core_status = self.supervisor.get_status();
        let current_cfg_port = self.config.read().controller_port;
        // Only attempt reload if core is running AND running on the configured controller port
        if core_status.running && core_status.controller_port == current_cfg_port {
            let client = self.clash_client();
            let path_str = runtime_path.to_string_lossy().to_string();
            if let Err(err) = client.reload_config(&path_str).await {
                warn!("Hot-reloading Mihomo config after sync failed: {}", err);
            } else {
                info!("Mihomo configuration reloaded with updated port listeners and proxies");
            }
        }

        Ok(runtime_path)
    }
}
