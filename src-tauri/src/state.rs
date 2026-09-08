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
    pub suspended_system_proxy: Arc<RwLock<Option<u16>>>,
    pub app_handle: Arc<RwLock<Option<tauri::AppHandle>>>,
}

impl AppState {
    pub fn new(app_dir: PathBuf) -> Self {
        crate::core::profile_manager::clean_stale_temp_files(&app_dir);
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
        let suspended_system_proxy = Arc::new(RwLock::new(None));
        let app_handle = Arc::new(RwLock::new(None));

        let config_clone = config.clone();
        let suspended_proxy_clone = suspended_system_proxy.clone();
        let app_handle_clone = app_handle.clone();

        engine.set_crash_handler(Arc::new(move |reason: String| {
            tracing::warn!("Mihomo kernel crashed unexpectedly: {}", reason);

            let (was_proxy_enabled, proxy_port) = {
                let mut cfg = config_clone.write();
                let enabled = cfg.system_proxy_enabled;
                let port = cfg.system_proxy_port;
                if enabled {
                    cfg.system_proxy_enabled = false;
                }
                (enabled, port)
            };

            // Unconditional system proxy cleanup per AGENTS.md lifecycle safety redline
            let _ = crate::core::sysproxy::clear_system_proxy();

            if was_proxy_enabled && let Some(port) = proxy_port {
                *suspended_proxy_clone.write() = Some(port);
                tracing::info!(
                    port = port,
                    "Cleared system proxy due to kernel crash. System fallback to DIRECT. Port marked for auto-restore."
                );
            }

            if let Some(ref handle) = *app_handle_clone.read() {
                crate::tray::update_tray_menu(handle);

                use tauri::Emitter;
                #[derive(serde::Serialize, Clone)]
                #[serde(rename_all = "camelCase")]
                struct KernelCrashedPayload {
                    reason: String,
                    system_proxy_suspended: bool,
                    suspended_port: Option<u16>,
                }

                let _ = handle.emit(
                    "kernel-crashed",
                    KernelCrashedPayload {
                        reason,
                        system_proxy_suspended: was_proxy_enabled,
                        suspended_port: proxy_port,
                    },
                );
            }
        }));

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
            suspended_system_proxy,
            app_handle,
        }
    }

    pub fn set_app_handle(&self, handle: tauri::AppHandle) {
        *self.app_handle.write() = Some(handle.clone());
        self.sync_delegate.set_app_handle(handle.clone());
        self.latency_emitter.set_app_handle(handle);
    }
    pub fn clear_suspended_system_proxy(&self) {
        *self.suspended_system_proxy.write() = None;
    }

    /// Ensures system proxy is active either by restoring a crash-suspended proxy or applying configured proxy.
    pub fn ensure_system_proxy_active(&self) -> bool {
        if self.try_restore_suspended_system_proxy() {
            return true;
        }

        let config = self.config.read().clone();
        if config.system_proxy_enabled
            && let Some(port) = config.system_proxy_port
        {
            let _ = crate::core::sysproxy::apply_system_proxy(
                port,
                &config.system_proxy_bypass_user,
                config.system_proxy_sync_env,
            );
            return true;
        }

        false
    }


    /// Checks if a system proxy was suspended due to a kernel crash and restores it if valid.
    pub fn try_restore_suspended_system_proxy(&self) -> bool {
        let suspended = self.suspended_system_proxy.write().take();
        let Some(port) = suspended else {
            return false;
        };

        let mappings = self.port_router.get_port_mappings();
        let is_valid = mappings.iter().any(|m| m.port == port && m.enabled);
        if !is_valid {
            tracing::info!(
                port = port,
                "Suspended system proxy port is no longer active or enabled, skipping restore"
            );
            return false;
        }

        let mut config = self.config.read().clone();
        tracing::info!(port = port, "Restoring suspended system proxy after kernel recovery");
        if let Err(e) = crate::core::sysproxy::apply_system_proxy(
            port,
            &config.system_proxy_bypass_user,
            config.system_proxy_sync_env,
        ) {
            tracing::error!("Failed to restore suspended system proxy on port {}: {}", port, e);
            return false;
        }

        config.system_proxy_enabled = true;
        config.system_proxy_port = Some(port);
        *self.config.write() = config.clone();

        let config_path = self.app_dir.join("config.json");
        if let Ok(json) = serde_json::to_string_pretty(&config) {
            let _ = crate::core::profile_manager::atomic_write_file(&config_path, json.as_bytes());
        }

        if let Some(ref handle) = *self.app_handle.read() {
            crate::tray::update_tray_menu(handle);

            use tauri::Emitter;
            #[derive(serde::Serialize, Clone)]
            #[serde(rename_all = "camelCase")]
            struct ProxyRestoredPayload {
                port: u16,
            }

            let _ = handle.emit("proxy-restored", ProxyRestoredPayload { port });
        }

        true
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
        let (path, _) = self.engine.write_runtime_config(&runtime_config)?;
        Ok(path)
    }

    /// Synchronizes all active port listeners and proxy nodes into runtime.yaml and triggers a hot reload if the core is running
    pub async fn sync_runtime_config(&self) -> AppResult<PathBuf> {
        self.port_router.sync_runtime().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{InboundProtocol, PortMapping};

    #[tokio::test]
    async fn test_crash_handler_suspends_and_restores_proxy() {
        let temp_dir = std::env::temp_dir().join(format!(
            "mihomo_state_test_{}",
            std::time::UNIX_EPOCH.elapsed().unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let state = AppState::new(temp_dir.clone());

        // Add an enabled port mapping
        let mapping = PortMapping {
            id: "port-1".to_string(),
            port: 17890,
            protocol: InboundProtocol::Mixed,
            profile_id: "test-prof".to_string(),
            node_name: "test-node".to_string(),
            enabled: true,
            latency: None,
            description: None,
            fallback_profile_id: None,
            fallback_node_name: None,
            bypass_cn: false,
            manual_fallback: false,
        };
        let _ = state.port_router.save_port_mapping(mapping).await;

        // Enable system proxy in config
        {
            let mut cfg = state.config.write();
            cfg.system_proxy_enabled = true;
            cfg.system_proxy_port = Some(17890);
        }

        // Trigger a simulated crash
        state.engine.supervisor().trigger_simulated_crash("Simulated crash");

        // System proxy should now be marked suspended and disabled
        assert_eq!(*state.suspended_system_proxy.read(), Some(17890));
        assert!(!state.config.read().system_proxy_enabled);

        // Call try_restore_suspended_system_proxy
        let restored = state.try_restore_suspended_system_proxy();
        assert!(restored);
        assert_eq!(*state.suspended_system_proxy.read(), None);
        assert!(state.config.read().system_proxy_enabled);
        assert_eq!(state.config.read().system_proxy_port, Some(17890));

        // Calling again should return false (already restored)
        assert!(!state.try_restore_suspended_system_proxy());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
