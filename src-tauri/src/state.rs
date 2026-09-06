use crate::core::auto_updater::AutoUpdater;
use crate::core::config_generator::RuntimeGeneratorParams;
use crate::core::kernel_engine::KernelEngine;
use crate::core::latency_probe::{AppLatencyEventEmitter, LatencyProbe};
use crate::core::port_router::{AppPortSyncDelegate, PortRouter};
use crate::core::profile_manager::ProfileManager;
use crate::error::AppResult;
use crate::models::AppConfig;
use parking_lot::RwLock;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub engine: Arc<KernelEngine>,
    pub profile_manager: Arc<ProfileManager>,
    pub port_router: Arc<PortRouter>,
    pub auto_updater: Arc<AutoUpdater>,
    pub config: Arc<RwLock<AppConfig>>,
    pub occupied_ports: Arc<RwLock<HashSet<u16>>>,
    pub app_dir: PathBuf,
    pub sync_delegate: Arc<AppPortSyncDelegate>,
    pub latency_probe: Arc<LatencyProbe>,
    pub latency_emitter: Arc<AppLatencyEventEmitter>,
}

impl AppState {
    pub fn new(app_dir: PathBuf) -> Self {
        let work_dir = app_dir.join("core");
        let engine = Arc::new(KernelEngine::new(work_dir));
        let profile_manager = Arc::new(ProfileManager::new(app_dir.clone()));
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

        let (metadata_path, ports) = PortRouter::load_initial(&app_dir);
        let sync_delegate = Arc::new(AppPortSyncDelegate::new(
            engine.clone(),
            profile_manager.clone(),
            ports.clone(),
            config.clone(),
            occupied_ports.clone(),
        ));
        let port_router = Arc::new(PortRouter::with_ports_and_delegate(
            metadata_path,
            ports,
            sync_delegate.clone(),
        ));
        let latency_emitter = Arc::new(AppLatencyEventEmitter::new());
        let latency_probe = Arc::new(LatencyProbe::new(
            engine.adapter().clone(),
            &app_dir,
            latency_emitter.clone(),
        ));

        Self {
            engine,
            profile_manager,
            port_router,
            auto_updater,
            config,
            occupied_ports,
            app_dir,
            sync_delegate,
            latency_probe,
            latency_emitter,
        }
    }

    pub fn set_app_handle(&self, handle: tauri::AppHandle) {
        self.sync_delegate.set_app_handle(handle.clone());
        self.latency_emitter.set_app_handle(handle);
    }

    /// Generates runtime.yaml on disk, safely excluding occupied ports to protect Mihomo stability
    pub fn generate_runtime_config_file(&self) -> AppResult<PathBuf> {
        let raw_proxies = self.profile_manager.get_raw_proxies_for_all_profiles();
        let profiles = self.profile_manager.get_profiles();
        let profile_map: HashMap<String, String> = profiles.into_iter().map(|p| (p.id, p.name)).collect();

        let mappings = self.port_router.get_port_mappings();
        let cfg = self.config.read().clone();

        let (active_mappings, occupied_set) = self.engine.filter_available_mappings(&mappings, cfg.allow_lan);
        *self.occupied_ports.write() = occupied_set;

        let params = RuntimeGeneratorParams {
            controller_port: cfg.controller_port,
            secret: &cfg.controller_secret,
            log_level: &cfg.log_level,
            allow_lan: cfg.allow_lan,
            test_url: &cfg.test_url,
            timeout_ms: cfg.timeout_ms,
            fallback_interval: cfg.fallback_interval,
            fallback_lazy: cfg.fallback_lazy,
        };

        let runtime_config = self
            .engine
            .synthesize_config(&params, &active_mappings, raw_proxies, &profile_map);
        self.engine.write_runtime_config(&runtime_config)
    }

    /// Synchronizes all active port listeners and proxy nodes into runtime.yaml and triggers a hot reload if the core is running
    pub async fn sync_runtime_config(&self) -> AppResult<PathBuf> {
        self.port_router.sync_runtime().await
    }
}
