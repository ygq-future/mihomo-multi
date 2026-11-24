use crate::core::auto_updater::AutoUpdater;
use crate::core::config_generator::RuntimeGeneratorParams;
use crate::core::icon_cache::ExecutableIconCache;
use crate::core::kernel_engine::KernelEngine;
use crate::core::latency_probe::{AppLatencyEventEmitter, LatencyProbe};
use crate::core::network_monitor::SystemNetworkMonitor;
use crate::core::node_analytics::NodeAnalyticsStore;
use crate::core::port_router::{PortChangeEvent, PortProbeContext, PortRouter};
use crate::core::process_history::PortProcessHistoryStore;
use crate::core::profile_manager::ProfileManager;
use crate::error::AppResult;
use crate::models::{
    AppConfig, EnvProxyStatus, PortMapping, PortProcessUsageItem, ResidentialProxyTestResult, SystemProxyStatus,
    TunStatus,
};
use parking_lot::RwLock;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Emitter;

#[derive(Clone)]
pub struct AppState {
    pub engine: Arc<KernelEngine>,
    pub profile_manager: Arc<ProfileManager>,
    pub port_router: Arc<PortRouter>,
    pub auto_updater: Arc<AutoUpdater>,
    pub config: Arc<RwLock<AppConfig>>,
    pub occupied_ports: Arc<RwLock<HashSet<u16>>>,
    pub app_dir: PathBuf,
    pub latency_probe: Arc<LatencyProbe>,
    pub latency_emitter: Arc<AppLatencyEventEmitter>,
    pub suspended_system_proxy: Arc<RwLock<Option<u16>>>,
    pub app_handle: Arc<RwLock<Option<tauri::AppHandle>>>,
    pub is_silent_start: Arc<std::sync::atomic::AtomicBool>,
    pub initial_window_shown: Arc<std::sync::atomic::AtomicBool>,
    pub egress_probe_port: Arc<RwLock<Option<u16>>>,
    pub egress_probe_lock: Arc<tokio::sync::Mutex<()>>,
    /// Serializes disposable residential-chain connectivity probes so only one isolated
    /// Mihomo instance and one transient config exist at a time.
    pub residential_probe_lock: Arc<tokio::sync::Mutex<()>>,
    pub process_history: Arc<PortProcessHistoryStore>,
    pub icon_cache: Arc<ExecutableIconCache>,
    pub node_analytics: Arc<NodeAnalyticsStore>,
    pub network_monitor: Arc<SystemNetworkMonitor>,
    pub cleanup_done: Arc<std::sync::atomic::AtomicBool>,
}

impl AppState {
    pub fn new(app_dir: PathBuf) -> Self {
        crate::core::profile_manager::clean_stale_temp_files(&app_dir);
        let work_dir = app_dir.join("core");
        let engine = Arc::new(KernelEngine::new(work_dir));
        let profile_manager = Arc::new(ProfileManager::new(app_dir.clone()));
        let auto_updater = Arc::new(AutoUpdater::new());
        let occupied_ports = Arc::new(RwLock::new(HashSet::new()));
        let is_silent_start = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let initial_window_shown = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let cleanup_done = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let egress_probe_port = Arc::new(RwLock::new(None));
        let egress_probe_lock = Arc::new(tokio::sync::Mutex::new(()));
        let residential_probe_lock = Arc::new(tokio::sync::Mutex::new(()));

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
        let suspended_system_proxy = Arc::new(RwLock::new(None));
        let port_router = Arc::new(PortRouter::new(app_dir.clone()));
        let latency_emitter = Arc::new(AppLatencyEventEmitter::new());
        let latency_probe = Arc::new(LatencyProbe::new(
            engine.adapter().clone(),
            &app_dir,
            latency_emitter.clone(),
        ));
        let process_history = Arc::new(PortProcessHistoryStore::new(&app_dir));
        let icon_cache = Arc::new(ExecutableIconCache::new(&app_dir));
        let node_analytics = Arc::new(NodeAnalyticsStore::new(&app_dir));
        let analytics_for_probe = node_analytics.clone();
        let router_for_probe = port_router.clone();
        let profiles_for_probe = profile_manager.clone();
        latency_probe.set_sample_callback(Arc::new(move |updates| {
            let bound = Self::collect_bound_runtime_nodes(&router_for_probe, &profiles_for_probe);
            let filtered: Vec<(String, Option<u32>)> = updates
                .iter()
                .filter(|(name, _)| bound.contains(name))
                .cloned()
                .collect();
            if !filtered.is_empty() {
                analytics_for_probe.record_latency_samples_batch(&filtered);
            }
        }));
        let analytics_for_logs = node_analytics.clone();
        engine.set_log_callback(Arc::new(move |line| {
            analytics_for_logs.record_log_line(line);
        }));
        let app_handle: Arc<RwLock<Option<tauri::AppHandle>>> = Arc::new(RwLock::new(None));
        let network_monitor = Arc::new(SystemNetworkMonitor::new());
        let analytics_for_network = node_analytics.clone();
        let app_handle_for_network = app_handle.clone();
        network_monitor.set_on_change_callback(Arc::new(move |status| {
            analytics_for_network.set_system_network_online(status.online);
            if let Some(handle) = &*app_handle_for_network.read() {
                let _ = handle.emit("system-network-changed", status);
            }
        }));
        let config_clone = config.clone();
        let suspended_proxy_clone = suspended_system_proxy.clone();
        let app_handle_clone = app_handle.clone();

        let is_dev_instance = cfg!(debug_assertions) || app_dir.to_string_lossy().contains(".dev");

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

            // Lifecycle safety cleanup:
            // For production instances, clear proxy if was_proxy_enabled was true (or unconditionally to avoid orphaned proxy).
            // For dev instances, only clear proxy if dev actually enabled it AND the OS proxy currently points to dev's port.
            let should_clear = if !is_dev_instance {
                was_proxy_enabled
            } else if was_proxy_enabled && let Some(port) = proxy_port {
                crate::core::sysproxy::is_system_proxy_active_on_port(port)
            } else {
                false
            };

            if should_clear {
                let _ = crate::core::sysproxy::clear_system_proxy();
            }
            if was_proxy_enabled && let Some(port) = proxy_port {
                *suspended_proxy_clone.write() = Some(port);
                tracing::info!(
                    port = port,
                    "Cleared system proxy due to kernel crash. System fallback to DIRECT. Port marked for auto-restore."
                );
            }

            if let Some(handle) = &*app_handle_clone.read() {
                crate::tray::update_tray_menu(handle);
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
            latency_probe,
            latency_emitter,
            suspended_system_proxy,
            app_handle,
            is_silent_start,
            initial_window_shown,
            egress_probe_port,
            egress_probe_lock,
            residential_probe_lock,
            process_history,
            icon_cache,
            node_analytics,
            network_monitor,
            cleanup_done,
        }
    }

    fn resolve_runtime_node_name(
        profile_manager: &ProfileManager,
        profile_id: &str,
        node_name: &str,
    ) -> Option<String> {
        let trimmed = node_name.trim();
        if trimmed.is_empty() {
            return None;
        }
        if let Some(profile) = profile_manager.get_profile_by_id(profile_id.trim()) {
            Some(format!("[{}] {}", profile.name, trimmed))
        } else {
            Some(trimmed.to_string())
        }
    }

    fn collect_bound_runtime_nodes(
        port_router: &PortRouter,
        profile_manager: &ProfileManager,
    ) -> HashSet<String> {
        let mut names = HashSet::new();
        for mapping in port_router.get_port_mappings() {
            if let Some(name) =
                Self::resolve_runtime_node_name(profile_manager, &mapping.profile_id, &mapping.node_name)
            {
                names.insert(name);
            }
            if let Some(fb_node) = mapping.fallback_node_name.as_deref() {
                let fb_profile = mapping
                    .fallback_profile_id
                    .as_deref()
                    .unwrap_or(&mapping.profile_id);
                if let Some(name) = Self::resolve_runtime_node_name(profile_manager, fb_profile, fb_node) {
                    names.insert(name);
                }
            }
        }
        names
    }

    pub fn bound_runtime_node_names(&self) -> HashSet<String> {
        Self::collect_bound_runtime_nodes(&self.port_router, &self.profile_manager)
    }

    pub fn set_app_handle(&self, handle: tauri::AppHandle) {
        *self.app_handle.write() = Some(handle.clone());
        self.latency_emitter.set_app_handle(handle);
    }
    pub fn clear_suspended_system_proxy(&self) {
        *self.suspended_system_proxy.write() = None;
    }

    pub fn persist_config(&self, config: &crate::models::AppConfig) -> AppResult<()> {
        let changed_chains: Vec<PortMapping> = {
            let previous = self.config.read();
            if previous.residential_proxies == config.residential_proxies {
                Vec::new()
            } else {
                self.port_router
                    .get_port_mappings()
                    .into_iter()
                    .filter(|mapping| {
                        mapping.residential_proxy_id.as_ref().is_some_and(|id| {
                            previous.residential_proxies.iter().find(|proxy| &proxy.id == id)
                                != config.residential_proxies.iter().find(|proxy| &proxy.id == id)
                        })
                    })
                    .collect()
            }
        };
        self.port_router.clear_port_latencies(&changed_chains)?;
        let invalidated: Vec<String> = changed_chains
            .iter()
            .map(|mapping| crate::core::config_generator::chain_proxy_name(mapping.port))
            .collect();
        self.latency_probe.remove_latencies(&invalidated)?;
        let config_path = self.app_dir.join("config.json");
        let json = serde_json::to_vec_pretty(config)?;
        crate::core::profile_manager::atomic_write_file(&config_path, &json)?;
        *self.config.write() = config.clone();
        Ok(())
    }

    /// Builds current system proxy status snapshot from config and combined bypass list.
    pub fn build_system_proxy_status(&self) -> SystemProxyStatus {
        let config = self.config.read().clone();
        let bypass_domains = crate::core::sysproxy::build_combined_bypass_list(&config.system_proxy_bypass_user);
        SystemProxyStatus {
            enabled: config.system_proxy_enabled,
            port: config.system_proxy_port,
            bypass_domains,
        }
    }

    pub fn build_env_proxy_status(&self) -> EnvProxyStatus {
        let config = self.config.read().clone();
        EnvProxyStatus {
            enabled: config.env_proxy_enabled,
            port: config.env_proxy_port,
        }
    }

    /// Returns the set of currently disabled subscription profile IDs.
    pub fn disabled_profile_ids(&self) -> HashSet<String> {
        self.profile_manager
            .get_profiles()
            .into_iter()
            .filter(|p| !p.enabled)
            .map(|p| p.id)
            .collect()
    }

    /// Pure helper: checks whether a port mapping is enabled and not blocked by any disabled subscription.
    pub fn is_mapping_effective(mapping: &PortMapping, disabled_profile_ids: &HashSet<String>) -> bool {
        if !mapping.enabled {
            return false;
        }
        if mapping.id == crate::models::FIXED_DIRECT_PORT_ID || mapping.node_name == "DIRECT" {
            return true;
        }
        let primary_profile_id = mapping.profile_id.trim();
        let primary_enabled = !disabled_profile_ids.contains(primary_profile_id);
        let has_enabled_fallback = mapping
            .fallback_node_name
            .as_deref()
            .map(str::trim)
            .is_some_and(|name| !name.is_empty())
            && !disabled_profile_ids.contains(
                mapping
                    .fallback_profile_id
                    .as_deref()
                    .map(str::trim)
                    .filter(|id| !id.is_empty())
                    .unwrap_or(primary_profile_id),
            );
        if !primary_enabled && !has_enabled_fallback {
            return false;
        }
        let has_residential_exit = mapping
            .residential_proxy_id
            .as_deref()
            .map(str::trim)
            .is_some_and(|id| !id.is_empty());
        let has_node_chain_exit = mapping
            .chain_exit_node_name
            .as_deref()
            .map(str::trim)
            .is_some_and(|name| !name.is_empty());
        if !has_residential_exit && has_node_chain_exit {
            let exit_profile_id = mapping
                .chain_exit_profile_id
                .as_deref()
                .map(str::trim)
                .filter(|id| !id.is_empty())
                .unwrap_or(primary_profile_id);
            if disabled_profile_ids.contains(exit_profile_id) {
                return false;
            }
        }
        true
    }

    /// Builds current TUN mode status snapshot based on elevation, port mapping state, and core status.
    pub fn build_tun_status(&self) -> TunStatus {
        let config = self.config.read().clone();
        let elevated = crate::core::elevation::is_elevated();
        let disabled_ids = self.disabled_profile_ids();
        let port_active = config.tun_port.is_some_and(|p| {
            self.port_router
                .get_port_mappings()
                .iter()
                .any(|m| m.port == p && Self::is_mapping_effective(m, &disabled_ids))
        });
        TunStatus {
            enabled: config.tun_enabled,
            active: elevated && config.tun_enabled && port_active && self.engine.get_status().running,
            port: config.tun_port,
            elevated,
            pending_elevation: config.tun_enabled && !elevated,
        }
    }
    /// Builds the current port probe context from active config and core status.
    pub fn port_probe_context(&self) -> PortProbeContext {
        let status = self.engine.get_status();
        let cfg = self.config.read();
        let mut reserved_ports = vec![cfg.controller_port];
        if let Some(probe_port) = *self.egress_probe_port.read() {
            reserved_ports.push(probe_port);
        }
        PortProbeContext {
            allow_lan: cfg.allow_lan,
            core_pid: if status.running { status.pid } else { None },
            reserved_ports,
            residential_proxies: cfg.residential_proxies.clone(),
        }
    }

    /// Enforces that bound system proxy or TUN port still corresponds to an active, enabled port mapping.
    /// If the bound port was disabled, deleted, or changed, automatically cleans up OS proxy/TUN state and persists config.
    pub fn reconcile_active_egress(&self) -> bool {
        let mappings = self.port_router.get_port_mappings();
        let disabled_ids = self.disabled_profile_ids();
        let mut config = self.config.read().clone();
        let mut modified = false;

        if config.system_proxy_enabled {
            let valid = config
                .system_proxy_port
                .is_some_and(|p| mappings.iter().any(|m| m.port == p && Self::is_mapping_effective(m, &disabled_ids)));
            if !valid {
                let _ = crate::core::sysproxy::clear_system_proxy();
                config.system_proxy_enabled = false;
                config.system_proxy_port = None;
                modified = true;
            }
        }

        if config.env_proxy_enabled {
            let valid = config
                .env_proxy_port
                .is_some_and(|p| mappings.iter().any(|m| m.port == p && Self::is_mapping_effective(m, &disabled_ids)));
            if !valid {
                let _ = crate::core::sysproxy::clear_env_proxy();
                config.env_proxy_enabled = false;
                config.env_proxy_port = None;
                modified = true;
            }
        }

        if config.tun_enabled {
            let valid = config
                .tun_port
                .is_some_and(|p| mappings.iter().any(|m| m.port == p && Self::is_mapping_effective(m, &disabled_ids)));
            if !valid {
                config.tun_enabled = false;
                config.tun_port = None;
                modified = true;
            }
        }

        if let Some(susp_port) = *self.suspended_system_proxy.read()
            && !mappings
                .iter()
                .any(|m| m.port == susp_port && Self::is_mapping_effective(m, &disabled_ids))
        {
            *self.suspended_system_proxy.write() = None;
        }

        if modified && let Err(error) = self.persist_config(&config) {
            *self.config.write() = config;
            tracing::error!("Failed to persist reconciled egress settings: {}", error);
        }

        modified
    }

    /// EgressGuard: Transitions system proxy state while enforcing mutual exclusion with TUN mode.
    /// Returns `(SystemProxyStatus, old_tun_was_enabled)`.
    pub fn apply_system_proxy_transition(
        &self,
        enabled: bool,
        port: Option<u16>,
    ) -> Result<(SystemProxyStatus, bool), String> {
        let mut config = self.config.read().clone();
        let old_tun_enabled = config.tun_enabled;
        self.clear_suspended_system_proxy();

        if enabled {
            if config.tun_enabled {
                config.tun_enabled = false;
            }
            let p = port.ok_or_else(|| {
                crate::tr!(
                    "启用系统代理必须指定端口",
                    "A port must be specified to enable the system proxy"
                )
                .to_string()
            })?;
            let mappings = self.port_router.get_port_mappings();
            let disabled_ids = self.disabled_profile_ids();
            if !mappings
                .iter()
                .any(|m| m.port == p && Self::is_mapping_effective(m, &disabled_ids))
            {
                return Err(crate::tr!(
                    format!("端口 {p} 未在监听列表中或未启用，无法设为系统代理"),
                    format!(
                        "Port {p} is not in the listener list or is disabled; it cannot be set as the system proxy"
                    ),
                ));
            }

            crate::core::sysproxy::apply_system_proxy(p, &config.system_proxy_bypass_user)
                .map_err(|e| e.to_string())?;

            config.system_proxy_enabled = true;
            config.system_proxy_port = Some(p);
            config.tun_port = Some(p);
        } else {
            crate::core::sysproxy::clear_system_proxy().map_err(|e| e.to_string())?;
            config.system_proxy_enabled = false;
            if let Some(p) = port {
                config.system_proxy_port = Some(p);
                config.tun_port = Some(p);
            }
        }

        self.persist_config(&config).map_err(|error| error.to_string())?;
        Ok((self.build_system_proxy_status(), old_tun_enabled))
    }

    /// EgressGuard: Transitions terminal environment variables proxy state.
    pub fn apply_env_proxy_transition(&self, enabled: bool, port: Option<u16>) -> Result<EnvProxyStatus, String> {
        let mut config = self.config.read().clone();

        if enabled {
            let p = port.ok_or_else(|| {
                crate::tr!(
                    "启用终端环境变量代理必须指定端口",
                    "A port must be specified to enable the terminal proxy"
                )
                .to_string()
            })?;
            let mappings = self.port_router.get_port_mappings();
            let disabled_ids = self.disabled_profile_ids();
            if !mappings
                .iter()
                .any(|m| m.port == p && Self::is_mapping_effective(m, &disabled_ids))
            {
                return Err(crate::tr!(
                    format!("端口 {p} 未在监听列表中或未启用，无法设为终端代理"),
                    format!(
                        "Port {p} is not in the listener list or is disabled; it cannot be set as the terminal proxy"
                    ),
                ));
            }

            crate::core::sysproxy::apply_env_proxy(p, &config.system_proxy_bypass_user).map_err(|e| e.to_string())?;

            config.env_proxy_enabled = true;
            config.env_proxy_port = Some(p);
        } else {
            crate::core::sysproxy::clear_env_proxy().map_err(|e| e.to_string())?;
            config.env_proxy_enabled = false;
            if let Some(p) = port {
                config.env_proxy_port = Some(p);
            }
        }

        self.persist_config(&config).map_err(|error| error.to_string())?;
        Ok(self.build_env_proxy_status())
    }

    /// EgressGuard: Validates and applies TUN mode configuration transition while enforcing mutual exclusion with system proxy.
    pub fn prepare_tun_transition(&self, enabled: bool, port: Option<u16>) -> Result<AppConfig, String> {
        let mut config = self.config.read().clone();

        if enabled {
            let p = port.ok_or_else(|| {
                crate::tr!(
                    "启用 TUN 模式必须指定绑定端口",
                    "A binding port must be specified to enable TUN mode"
                )
                .to_string()
            })?;
            let mappings = self.port_router.get_port_mappings();
            let disabled_ids = self.disabled_profile_ids();
            if !mappings
                .iter()
                .any(|m| m.port == p && Self::is_mapping_effective(m, &disabled_ids))
            {
                return Err(crate::tr!(
                    format!("端口 {p} 未在监听列表中或未启用，无法作为 TUN 出口"),
                    format!(
                        "Port {p} is not in the listener list or is disabled; it cannot be used as the TUN exit"
                    ),
                ));
            }
            if config.system_proxy_enabled {
                let _ = crate::core::sysproxy::clear_system_proxy();
            }
            self.clear_suspended_system_proxy();
            config.system_proxy_enabled = false;
            config.tun_enabled = true;
            config.tun_port = Some(p);
            config.system_proxy_port = Some(p);
        } else {
            config.tun_enabled = false;
            if let Some(p) = port {
                config.tun_port = Some(p);
                config.system_proxy_port = Some(p);
            }
        }

        self.persist_config(&config).map_err(|error| error.to_string())?;
        Ok(config)
    }

    /// EgressGuard: Rolls back TUN mode configuration when UAC elevation fails or is canceled.
    pub fn rollback_tun_transition(&self) -> AppConfig {
        let mut rollback = self.config.read().clone();
        rollback.tun_enabled = false;
        rollback.tun_port = None;
        if let Err(error) = self.persist_config(&rollback) {
            *self.config.write() = rollback.clone();
            tracing::error!("Failed to persist TUN rollback: {}", error);
        }
        rollback
    }

    /// EgressGuard: Cleans up OS system proxy and suspended state when stopping the core.
    pub fn deactivate_egress_on_core_stop(&self) {
        if self.config.read().system_proxy_enabled {
            let is_dev = self.is_dev_instance();
            let should_clear = if !is_dev {
                true
            } else if let Some(port) = self.config.read().system_proxy_port {
                crate::core::sysproxy::is_system_proxy_active_on_port(port)
            } else {
                false
            };
            if should_clear {
                let _ = crate::core::sysproxy::clear_system_proxy();
            }
        }
        if self.config.read().env_proxy_enabled {
            let is_dev = self.is_dev_instance();
            let should_clear = if !is_dev {
                true
            } else if let Some(port) = self.config.read().env_proxy_port {
                crate::core::sysproxy::is_env_proxy_active_on_port(port)
            } else {
                false
            };
            if should_clear {
                let _ = crate::core::sysproxy::clear_env_proxy();
            }
        }
        self.clear_suspended_system_proxy();
    }

    pub fn is_dev_instance(&self) -> bool {
        if let Some(handle) = &*self.app_handle.read() {
            cfg!(debug_assertions) || handle.config().identifier.ends_with(".dev")
        } else {
            cfg!(debug_assertions)
        }
    }

    /// Centralized cleanup hook invoked when application exits.
    /// Strictly adheres to AGENTS.md lifecycle safety redline for production instances while
    /// preventing isolated dev instances from clearing the production application's system proxy and environment variables.
    pub fn cleanup_on_exit(&self, app_handle: &tauri::AppHandle) {
        if self.cleanup_done.swap(true, std::sync::atomic::Ordering::SeqCst) {
            return;
        }
        let is_dev = cfg!(debug_assertions) || app_handle.config().identifier.ends_with(".dev");
        let config = self.config.read().clone();
        let should_clear_proxy = if !is_dev {
            true
        } else if config.system_proxy_enabled
            && let Some(port) = config.system_proxy_port
        {
            crate::core::sysproxy::is_system_proxy_active_on_port(port)
        } else {
            false
        };
        if should_clear_proxy {
            let _ = crate::core::sysproxy::clear_system_proxy();
        }
        let should_clear_env = if !is_dev {
            true
        } else if config.env_proxy_enabled
            && let Some(port) = config.env_proxy_port
        {
            crate::core::sysproxy::is_env_proxy_active_on_port(port)
        } else {
            false
        };
        if should_clear_env {
            let _ = crate::core::sysproxy::clear_env_proxy();
        }
        self.auto_updater.stop();
        let _ = self.latency_probe.persist_cache();
        let _ = self.process_history.flush();
        let _ = self.node_analytics.flush();
        let _ = self.icon_cache.save_if_dirty();
        let _ = self.engine.stop();
    }
    /// Ensures system proxy is active either by restoring a crash-suspended proxy or applying configured proxy.
    pub fn ensure_system_proxy_active(&self) -> bool {
        self.reconcile_active_egress();
        let config = self.config.read().clone();
        if config.env_proxy_enabled
            && let Some(port) = config.env_proxy_port
        {
            let _ = crate::core::sysproxy::apply_env_proxy(port, &config.system_proxy_bypass_user);
        }
        if self.try_restore_suspended_system_proxy() {
            return true;
        }
        if config.system_proxy_enabled
            && let Some(port) = config.system_proxy_port
        {
            let _ = crate::core::sysproxy::apply_system_proxy(port, &config.system_proxy_bypass_user);
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
        let disabled_ids = self.disabled_profile_ids();
        let is_valid = mappings
            .iter()
            .any(|m| m.port == port && Self::is_mapping_effective(m, &disabled_ids));
        if !is_valid {
            tracing::info!(
                port = port,
                "Suspended system proxy port is no longer active or enabled, skipping restore"
            );
            return false;
        }

        let mut config = self.config.read().clone();
        tracing::info!(port = port, "Restoring suspended system proxy after kernel recovery");
        if let Err(e) = crate::core::sysproxy::apply_system_proxy(port, &config.system_proxy_bypass_user) {
            tracing::error!("Failed to restore suspended system proxy on port {}: {}", port, e);
            return false;
        }

        config.system_proxy_enabled = true;
        config.system_proxy_port = Some(port);
        if let Err(error) = self.persist_config(&config) {
            *self.config.write() = config;
            tracing::error!("Failed to persist restored system proxy: {}", error);
        }

        if let Some(handle) = &*self.app_handle.read() {
            crate::tray::update_tray_menu(handle);
            #[derive(serde::Serialize, Clone)]
            #[serde(rename_all = "camelCase")]
            struct ProxyRestoredPayload {
                port: u16,
            }

            let _ = handle.emit("proxy-restored", ProxyRestoredPayload { port });
        }

        true
    }

    /// Synchronizes all active port listeners and proxy nodes into `runtime.yaml`,
    /// triggers a hot reload if the core is running, updates the tray menu, and emits the port change event.
    pub async fn sync_runtime_with_event(&self, event: PortChangeEvent) -> AppResult<PathBuf> {
        self.reconcile_active_egress();

        let raw_proxies = self.profile_manager.get_raw_proxies_for_all_profiles();
        let profiles = self.profile_manager.get_profiles();
        let disabled_ids: HashSet<String> = profiles.iter().filter(|p| !p.enabled).map(|p| p.id.clone()).collect();
        let profile_map: HashMap<String, String> = profiles
            .into_iter()
            .filter(|p| p.enabled)
            .map(|p| (p.id, p.name))
            .collect();

        let mappings = self.port_router.get_port_mappings();
        let effective_mappings: Vec<PortMapping> = mappings
            .iter()
            .filter(|m| Self::is_mapping_effective(m, &disabled_ids))
            .cloned()
            .collect();
        let cfg = self.config.read().clone();

        let (active_mappings, occupied_set) = self.engine.filter_available_mappings(&effective_mappings, cfg.allow_lan);
        *self.occupied_ports.write() = occupied_set;
        let probe_port = self.resolve_egress_probe_port(&mappings, cfg.controller_port);
        let params = RuntimeGeneratorParams {
            controller_port: cfg.controller_port,
            secret: &cfg.controller_secret,
            log_level: &cfg.log_level,
            allow_lan: cfg.allow_lan,
            test_url: &cfg.test_url,
            timeout_ms: cfg.timeout_ms,
            fallback_interval: cfg.fallback_interval,
            fallback_lazy: cfg.fallback_lazy,
            user_bypass: &cfg.system_proxy_bypass_user,
            tun_enabled: cfg.tun_enabled && crate::core::elevation::is_elevated(),
            tun_port: cfg.tun_port,
            global_rules: &cfg.global_rules,
            egress_probe_port: probe_port,
            residential_proxies: &cfg.residential_proxies,
        };

        let path = self
            .engine
            .apply_runtime_config(&params, &active_mappings, raw_proxies, &profile_map)
            .await?;

        if let Some(handle) = &*self.app_handle.read() {
            crate::tray::update_tray_menu(handle);
            let _ = handle.emit("port-mappings-changed", &event);
        }

        Ok(path)
    }

    /// Synchronizes all active port listeners and proxy nodes into `runtime.yaml` and triggers a hot reload if the core is running.
    pub async fn sync_runtime_config(&self) -> AppResult<PathBuf> {
        self.sync_runtime_with_event(PortChangeEvent::Resynced).await
    }

    /// Returns a port previously skipped as occupied that our sidecar can bind again.
    ///
    /// Occupancy is sampled at sync time only, so without this re-check a mapping skipped once
    /// would keep missing its listener until the user toggles it by hand.
    pub fn recoverable_port(&self) -> Option<u16> {
        let status = self.engine.get_status();
        if !status.running {
            return None;
        }
        let core_pid = status.pid?;

        let skipped_ports: Vec<u16> = self.occupied_ports.read().iter().copied().collect();
        if skipped_ports.is_empty() {
            return None;
        }

        let allow_lan = self.config.read().allow_lan;
        let mappings = self.port_router.get_port_mappings();
        crate::core::port_probe::first_recoverable_port(&skipped_ports, &mappings, allow_lan, core_pid)
    }

    /// Resolves and caches an available local loopback port for the internal `egress-probe` listener.
    pub fn resolve_egress_probe_port(&self, mappings: &[PortMapping], controller_port: u16) -> Option<u16> {
        let status = self.engine.get_status();
        let core_pid = if status.running { status.pid } else { None };

        if let Some(current) = *self.egress_probe_port.read() {
            let conflict_with_user = current == controller_port || mappings.iter().any(|m| m.port == current);
            if !conflict_with_user
                && crate::core::port_probe::is_port_available(
                    current,
                    crate::core::port_probe::PortTransport::TcpAndUdp,
                    false,
                    core_pid,
                )
            {
                return Some(current);
            }
        }

        let base_port = if cfg!(debug_assertions) {
            crate::core::config_generator::DEFAULT_EGRESS_PROBE_PORT + 100
        } else {
            crate::core::config_generator::DEFAULT_EGRESS_PROBE_PORT
        };

        for offset in 0..50u16 {
            let candidate = base_port.saturating_add(offset);
            if candidate == controller_port || mappings.iter().any(|m| m.port == candidate) {
                continue;
            }
            if crate::core::port_probe::is_port_available(
                candidate,
                crate::core::port_probe::PortTransport::TcpAndUdp,
                false,
                core_pid,
            ) {
                *self.egress_probe_port.write() = Some(candidate);
                return Some(candidate);
            }
        }

        None
    }

    // --- Coordinated Port Mapping Operations ---

    pub fn check_port_available(&self, port: u16, exclude_mapping_id: Option<&str>) -> bool {
        let ctx = self.port_probe_context();
        self.port_router.check_port_available(port, exclude_mapping_id, &ctx)
    }

    pub fn get_next_available_port(&self, start_port: Option<u16>, exclude_mapping_id: Option<&str>) -> AppResult<u16> {
        let ctx = self.port_probe_context();
        self.port_router
            .get_next_available_port(start_port, exclude_mapping_id, &ctx)
    }

    pub async fn save_port_mapping(&self, mut mapping: PortMapping) -> AppResult<PortMapping> {
        let previous = self.port_router.get_port_mapping_by_id(&mapping.id);
        let chain_changed = (mapping.residential_proxy_id.is_some()
            || previous.as_ref().is_some_and(|old| old.residential_proxy_id.is_some()))
            && previous.as_ref().is_none_or(|old| {
                old.port != mapping.port
                    || old.protocol != mapping.protocol
                    || old.profile_id != mapping.profile_id
                    || old.node_name != mapping.node_name
                    || old.residential_proxy_id != mapping.residential_proxy_id
            });
        if chain_changed {
            mapping.latency = None;
        }
        let ctx = self.port_probe_context();
        let saved = self.port_router.save_port_mapping(mapping, &ctx)?;
        if let Some(old) = previous.as_ref()
            && old.port != saved.port
            && !self.port_router.get_port_mappings().iter().any(|m| m.port == old.port)
        {
            let _ = self.process_history.clear_port(old.port);
        }
        if chain_changed {
            let mut targets = vec![crate::core::config_generator::chain_proxy_name(saved.port)];
            if let Some(old) = previous
                && old.port != saved.port
            {
                targets.push(crate::core::config_generator::chain_proxy_name(old.port));
            }
            self.latency_probe.remove_latencies(&targets)?;
        }
        self.sync_runtime_with_event(PortChangeEvent::Saved(saved.clone()))
            .await?;
        Ok(saved)
    }

    pub async fn delete_port_mapping(&self, id: &str) -> AppResult<()> {
        let previous = self.port_router.get_port_mapping_by_id(id);
        self.port_router.delete_port_mapping(id)?;
        if let Some(mapping) = previous {
            if mapping.residential_proxy_id.is_some() {
                self.latency_probe
                    .remove_latencies(&[crate::core::config_generator::chain_proxy_name(mapping.port)])?;
            }
            if !self
                .port_router
                .get_port_mappings()
                .iter()
                .any(|m| m.port == mapping.port)
            {
                let _ = self.process_history.clear_port(mapping.port);
            }
        }
        self.sync_runtime_with_event(PortChangeEvent::Deleted(id.to_string()))
            .await?;
        Ok(())
    }

    pub async fn sample_port_process_history(&self) {
        if !self.engine.get_status().running {
            return;
        }
        let allowed_ports: HashSet<u16> = self
            .port_router
            .get_port_mappings()
            .into_iter()
            .map(|m| m.port)
            .collect();
        if allowed_ports.is_empty() {
            return;
        }
        if let Ok(snapshot) = self.engine.adapter().get_connections().await {
            self.process_history.record_snapshot(&snapshot, &allowed_ports);
            self.node_analytics.record_connection_snapshot(&snapshot);
            let paths = self.process_history.all_process_paths();
            let uncached_paths = self.icon_cache.filter_uncached_paths(paths);
            if !uncached_paths.is_empty() {
                let cache = self.icon_cache.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    cache.warm_paths(uncached_paths);
                })
                .await;
            }
        }
    }

    pub fn warm_process_icons(&self) {
        let paths = self.process_history.all_process_paths();
        if !paths.is_empty() {
            self.icon_cache.warm_paths(paths);
        }
    }

    pub async fn get_port_process_history(&self, port: u16) -> Vec<PortProcessUsageItem> {
        let live_snapshot = if self.engine.get_status().running {
            self.engine.adapter().get_connections().await.ok()
        } else {
            None
        };
        if let Some(ref snapshot) = live_snapshot {
            let allowed_ports: HashSet<u16> = self
                .port_router
                .get_port_mappings()
                .into_iter()
                .map(|m| m.port)
                .collect();
            self.process_history.record_snapshot(snapshot, &allowed_ports);
        }
        let mut items = self.process_history.get_port_usage(port, live_snapshot.as_ref());
        let paths_to_warm: Vec<String> = items
            .iter()
            .filter_map(|item| item.process_path.clone())
            .collect();
        if !paths_to_warm.is_empty() {
            let cache = self.icon_cache.clone();
            let _ = tokio::task::spawn_blocking(move || {
                cache.warm_paths(paths_to_warm);
            })
            .await;
        }
        for item in &mut items {
            item.icon_data_url = item
                .process_path
                .as_deref()
                .and_then(|path| self.icon_cache.get_cached(path));
        }
        items
    }

    pub fn clear_port_process_history(&self, port: u16) -> AppResult<()> {
        self.process_history.clear_port(port)
    }

    pub async fn toggle_port_mapping(&self, id: &str, enabled: bool) -> AppResult<PortMapping> {
        let ctx = self.port_probe_context();
        let updated = self.port_router.toggle_port_mapping(id, enabled, &ctx)?;
        self.sync_runtime_with_event(PortChangeEvent::Toggled(updated.clone()))
            .await?;
        Ok(updated)
    }

    pub async fn toggle_manual_fallback(&self, id: &str, manual_fallback: bool) -> AppResult<PortMapping> {
        let updated = self.port_router.toggle_manual_fallback(id, manual_fallback)?;
        self.sync_runtime_with_event(PortChangeEvent::Saved(updated.clone()))
            .await?;
        Ok(updated)
    }

    pub async fn swap_port_fallback(&self, id: &str) -> AppResult<PortMapping> {
        let saved = self
            .port_router
            .swap_port_fallback(id, |new_profile_id, new_node_name| {
                let profile_name = self
                    .profile_manager
                    .get_profile_by_id(new_profile_id)
                    .map(|profile| profile.name);
                let runtime_name = profile_name.map(|pname| format!("[{}] {}", pname, new_node_name));
                runtime_name
                    .as_deref()
                    .and_then(|rn| self.latency_probe.get_latency(rn))
                    .or_else(|| self.latency_probe.get_latency(new_node_name))
                    .flatten()
            })?;
        self.sync_runtime_with_event(PortChangeEvent::Saved(saved.clone()))
            .await?;
        Ok(saved)
    }

    /// Swaps the listener ports of two mappings and hot-reloads the runtime config.
    ///
    /// Egress selection is port-scoped (`system_proxy_port` / `env_proxy_port` / `tun_port`), so it
    /// keeps pointing at the same port number: when that port survives the swap the binding stays
    /// untouched, and `sync_runtime_with_event` runs `reconcile_active_egress` first, which tears
    /// the OS proxy / env vars / TUN state down if the swap left the port disabled instead.
    /// Chain latency caches are keyed by `chain-<port>`, so both old and new names are invalidated.
    pub async fn swap_port_mapping_ports(&self, first_id: &str, second_id: &str) -> AppResult<Vec<PortMapping>> {
        let previous: Vec<PortMapping> = self
            .port_router
            .get_port_mappings()
            .into_iter()
            .filter(|mapping| mapping.id == first_id || mapping.id == second_id)
            .collect();

        let ctx = self.port_probe_context();
        let updated = self.port_router.swap_port_mapping_ports(first_id, second_id, &ctx)?;

        let invalidated: Vec<String> = previous
            .iter()
            .filter(|mapping| mapping.residential_proxy_id.is_some())
            .filter_map(|mapping| {
                updated
                    .iter()
                    .find(|candidate| candidate.id == mapping.id)
                    .map(|moved| (mapping.port, moved.port))
            })
            .flat_map(|(old_port, new_port)| {
                [
                    crate::core::config_generator::chain_proxy_name(old_port),
                    crate::core::config_generator::chain_proxy_name(new_port),
                ]
            })
            .collect();
        if !invalidated.is_empty()
            && let Err(error) = self.latency_probe.remove_latencies(&invalidated)
        {
            tracing::warn!("Failed to invalidate chain latency cache after port swap: {}", error);
        }

        self.sync_runtime_with_event(PortChangeEvent::Resynced).await?;
        Ok(updated)
    }

    /// Validates and runs a residential exit connectivity probe using only saved state.
    ///
    /// The probe runs in a disposable isolated Mihomo instance, so the live runtime config,
    /// listeners, and connections are never reloaded or mutated. Probes are serialized to
    /// bound transient processes and temporary files.
    ///
    /// `endpoints` is a diagnostics-only injection for local smoke fixtures; production IPC
    /// passes `None` and uses the standard public endpoint rotation.
    pub async fn probe_residential_chain(
        &self,
        app_handle: Option<&tauri::AppHandle>,
        residential_proxy_id: &str,
        profile_id: &str,
        node_name: &str,
        endpoints: Option<&[crate::core::egress_probe::ProbeEndpoint]>,
    ) -> Result<ResidentialProxyTestResult, String> {
        let _guard = self.residential_probe_lock.lock().await;
        let (exit, timeout_ms) = {
            let config = self.config.read();
            let exit = config
                .residential_proxies
                .iter()
                .find(|proxy| proxy.id.trim() == residential_proxy_id.trim())
                .cloned()
                .ok_or_else(|| {
                    crate::tr!(
                        "住宅代理出口不存在或尚未保存，请先保存设置后再测试",
                        "The residential proxy exit does not exist or has not been saved; save the settings before testing"
                    )
                    .to_string()
                })?;
            (exit, config.timeout_ms as u64)
        };

        let requested = node_name.trim();
        if requested.is_empty() {
            return Err(crate::tr!(
                "请选择用于住宅代理链的上游节点",
                "Select an upstream node for the residential proxy chain"
            )
            .to_string());
        }
        let profile = if profile_id.trim().is_empty() {
            None
        } else {
            Some(self.profile_manager.get_profile_by_id(profile_id.trim()).ok_or_else(|| {
                crate::tr!(
                    format!("订阅不存在，无法定位住宅代理链的上游节点「{requested}」"),
                    format!(
                        "Subscription does not exist; cannot locate the upstream node \"{requested}\" for the residential proxy chain"
                    ),
                )
            })?)
        };
        let raw_proxies = self.profile_manager.get_raw_proxies_for_all_profiles();
        let chain = crate::core::residential_probe::prepare_probe(&raw_proxies, profile.as_ref(), &exit, requested)?;

        match endpoints {
            Some(endpoints) => {
                crate::core::residential_probe::execute_probe_with_endpoints(
                    app_handle,
                    &chain,
                    Some(timeout_ms),
                    endpoints,
                )
                .await
            }
            None => crate::core::residential_probe::execute_probe(app_handle, &chain, Some(timeout_ms)).await,
        }
    }

    pub async fn probe_node_chain(
        &self,
        app_handle: Option<&tauri::AppHandle>,
        exit_profile_id: &str,
        exit_node_name: &str,
        upstream_profile_id: &str,
        upstream_node_name: &str,
    ) -> Result<ResidentialProxyTestResult, String> {
        let _guard = self.residential_probe_lock.lock().await;
        let (timeout_ms, test_url) = {
            let cfg = self.config.read();
            (cfg.timeout_ms as u64, cfg.test_url.clone())
        };
        let upstream_profile = if upstream_profile_id.trim().is_empty() {
            None
        } else {
            self.profile_manager.get_profile_by_id(upstream_profile_id.trim())
        };
        let exit_profile = if exit_profile_id.trim().is_empty() {
            upstream_profile.clone()
        } else {
            self.profile_manager.get_profile_by_id(exit_profile_id.trim())
        };
        let raw_proxies = self.profile_manager.get_raw_proxies_for_all_profiles();
        let mut chain = crate::core::residential_probe::prepare_node_probe(
            &raw_proxies,
            upstream_profile.as_ref(),
            upstream_node_name,
            exit_profile.as_ref(),
            exit_node_name,
        )?;
        chain.test_url = Some(test_url);
        crate::core::residential_probe::execute_probe(app_handle, &chain, Some(timeout_ms)).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;
    use crate::models::{InboundProtocol, PortMapping};

    /// Saves an enabled `mixed` mapping on a loopback port that is free for TCP *and* UDP.
    ///
    /// A `mixed` listener binds both socket families, so a port the OS hands out for TCP may
    /// still be held by an unrelated UDP endpoint. Occupancy is a point-in-time sample, hence
    /// the retry with a freshly picked port instead of asserting on the first candidate.
    async fn save_mapping_on_free_port(state: &AppState, id: &str, node_name: &str) -> u16 {
        for _ in 0..20 {
            let port = {
                let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
                listener.local_addr().unwrap().port()
            };
            if state.port_router.get_port_mappings().iter().any(|m| m.port == port) {
                continue;
            }

            let mapping = PortMapping {
                id: id.to_string(),
                port,
                protocol: InboundProtocol::Mixed,
                profile_id: "test-prof".to_string(),
                node_name: node_name.to_string(),
                enabled: true,
                ..PortMapping::default()
            };
            match state.save_port_mapping(mapping).await {
                Ok(_) => return port,
                Err(AppError::PortOccupied(_)) => continue,
                Err(err) => panic!("saving a mapping on port {port} failed: {err}"),
            }
        }

        panic!("no port free for both TCP and UDP after 20 attempts");
    }

    #[test]
    fn residential_configuration_persists_credentials_and_loads_on_restart() {
        let directory = std::env::temp_dir().join(format!("residential-config-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).expect("create isolated application directory");
        let state = AppState::new(directory.clone());
        let mut config = state.config.read().clone();
        config.residential_proxies = serde_json::from_value(serde_json::json!([{
            "id": "residential-1", "name": "Residential exit", "protocol": "socks5",
            "server": "127.0.0.1", "port": 1080, "username": "test-user", "password": "test-password"
        }]))
        .expect("valid residential proxy fixture");
        state.persist_config(&config).expect("save residential configuration");
        let restarted = AppState::new(directory.clone());
        let persisted = restarted.config.read();
        assert_eq!(persisted.residential_proxies[0].id, "residential-1");
        assert_eq!(persisted.residential_proxies[0].protocol, "socks5");
        assert_eq!(persisted.residential_proxies[0].username, "test-user");
        assert_eq!(persisted.residential_proxies[0].password, "test-password");
        drop(persisted);
        std::fs::remove_dir_all(directory).expect("remove isolated application directory");
    }

    #[test]
    fn configuration_write_failure_preserves_accepted_state() {
        let directory = std::env::temp_dir().join(format!("residential-write-failure-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).expect("create isolated application directory");
        let state = AppState::new(directory.clone());
        let before = state.config.read().clone();
        let mut config = before.clone();
        config.theme.push_str("-changed");
        std::fs::remove_file(directory.join("config.json")).expect("remove initial configuration file");
        std::fs::create_dir(directory.join("config.json")).expect("block configuration file with a directory");
        assert!(state.persist_config(&config).is_err());
        assert_eq!(*state.config.read(), before);
        std::fs::remove_dir_all(directory).expect("remove isolated application directory");
    }

    #[tokio::test]
    async fn test_crash_handler_suspends_and_restores_proxy() {
        let temp_dir = std::env::temp_dir().join(format!(
            "mihomo_state_test_{}",
            std::time::UNIX_EPOCH.elapsed().unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let state = AppState::new(temp_dir.clone());

        // Add an enabled port mapping on a port free for both TCP and UDP
        let test_port = save_mapping_on_free_port(&state, "port-1", "test-node").await;

        // Enable system proxy in config
        {
            let mut cfg = state.config.write();
            cfg.system_proxy_enabled = true;
            cfg.system_proxy_port = Some(test_port);
        }

        // Trigger a simulated crash
        state.engine.supervisor().trigger_simulated_crash("Simulated crash");

        // System proxy should now be marked suspended and disabled
        assert_eq!(*state.suspended_system_proxy.read(), Some(test_port));
        assert!(!state.config.read().system_proxy_enabled);

        // Call try_restore_suspended_system_proxy
        let restored = state.try_restore_suspended_system_proxy();
        assert!(restored);
        assert_eq!(*state.suspended_system_proxy.read(), None);
        assert!(state.config.read().system_proxy_enabled);
        assert_eq!(state.config.read().system_proxy_port, Some(test_port));

        // Calling again should return false (already restored)
        assert!(!state.try_restore_suspended_system_proxy());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_egress_guard_reconciles_on_port_toggle_and_delete() {
        let temp_dir = std::env::temp_dir().join(format!("mihomo_egress_guard_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let state = AppState::new(temp_dir.clone());
        let test_port = save_mapping_on_free_port(&state, "port-egress-1", "test-node").await;

        let runtime_yaml = std::fs::read_to_string(temp_dir.join("core").join("runtime.yaml")).unwrap();
        assert!(runtime_yaml.contains(&format!("port: {}", test_port)));
        // 1. Bind TUN to the enabled port via prepare_tun_transition
        let cfg = state
            .prepare_tun_transition(true, Some(test_port))
            .expect("TUN transition should succeed for enabled port");
        assert!(cfg.tun_enabled);
        assert!(!cfg.system_proxy_enabled);
        assert_eq!(cfg.tun_port, Some(test_port));

        // 2. Toggle port off -> EgressGuard must automatically unbind TUN and persist to disk
        let _ = state.toggle_port_mapping("port-egress-1", false).await;
        assert!(!state.config.read().tun_enabled);
        assert_eq!(state.config.read().tun_port, None);

        // Attempting to bind TUN or system proxy to disabled port must fail
        assert!(state.prepare_tun_transition(true, Some(test_port)).is_err());
        assert!(state.apply_system_proxy_transition(true, Some(test_port)).is_err());

        // 3. Re-enable port, bind TUN, then test UAC rollback
        let _ = state.toggle_port_mapping("port-egress-1", true).await;
        let _ = state.prepare_tun_transition(true, Some(test_port)).unwrap();
        let rolled_back = state.rollback_tun_transition();
        assert!(!rolled_back.tun_enabled);
        assert_eq!(rolled_back.tun_port, None);

        // 4. Bind TUN again and delete the port mapping -> EgressGuard must unbind TUN
        let _ = state.prepare_tun_transition(true, Some(test_port)).unwrap();
        let _ = state.delete_port_mapping("port-egress-1").await;
        assert!(!state.config.read().tun_enabled);
        assert_eq!(state.config.read().tun_port, None);
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_egress_modes_switch_ports_and_remain_exclusive() -> Result<(), Box<dyn std::error::Error>> {
        let temp_dir = std::env::temp_dir().join(format!("mihomo_egress_modes_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir)?;
        let state = AppState::new(temp_dir.clone());
        let port_a = save_mapping_on_free_port(&state, "mode-port-a", "node-a").await;
        let port_b = save_mapping_on_free_port(&state, "mode-port-b", "node-b").await;

        let (system_proxy, was_tun) = state.apply_system_proxy_transition(true, Some(port_a))?;
        assert!(system_proxy.enabled);
        assert_eq!(system_proxy.port, Some(port_a));
        assert!(!was_tun);

        let config = state.prepare_tun_transition(true, Some(port_a))?;
        assert!(config.tun_enabled);
        assert!(!config.system_proxy_enabled);

        let config = state.prepare_tun_transition(true, Some(port_b))?;
        assert_eq!(config.tun_port, Some(port_b));
        assert!(config.tun_enabled);
        assert!(!config.system_proxy_enabled);

        let (system_proxy, was_tun) = state.apply_system_proxy_transition(true, Some(port_b))?;
        assert!(was_tun);
        assert!(system_proxy.enabled);
        assert_eq!(system_proxy.port, Some(port_b));
        assert!(!state.config.read().tun_enabled);

        let (system_proxy, _) = state.apply_system_proxy_transition(true, Some(port_a))?;
        assert_eq!(system_proxy.port, Some(port_a));
        let (system_proxy, _) = state.apply_system_proxy_transition(false, Some(port_a))?;
        assert!(!system_proxy.enabled);
        assert!(!state.config.read().tun_enabled);

        state.prepare_tun_transition(true, Some(port_b))?;
        let config = state.prepare_tun_transition(false, Some(port_b))?;
        assert!(!config.tun_enabled);
        assert!(!config.system_proxy_enabled);
        drop(state);
        std::fs::remove_dir_all(temp_dir)?;
        Ok(())
    }

    #[tokio::test]
    async fn test_env_proxy_transition_and_egress_guard() {
        let temp_dir = std::env::temp_dir().join(format!("mihomo_env_proxy_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let state = AppState::new(temp_dir.clone());
        let port_a = save_mapping_on_free_port(&state, "port-a", "node-a").await;
        let port_b = save_mapping_on_free_port(&state, "port-b", "node-b").await;

        // 1. Set System Proxy to port_a
        let (sys_status, _) = state.apply_system_proxy_transition(true, Some(port_a)).unwrap();
        assert!(sys_status.enabled);
        assert_eq!(sys_status.port, Some(port_a));

        // 2. Independently Set Env Proxy to port_b
        let env_status = state.apply_env_proxy_transition(true, Some(port_b)).unwrap();
        assert!(env_status.enabled);
        assert_eq!(env_status.port, Some(port_b));

        // System proxy is still port_a
        assert!(state.config.read().system_proxy_enabled);
        assert_eq!(state.config.read().system_proxy_port, Some(port_a));
        // Env proxy is port_b
        assert!(state.config.read().env_proxy_enabled);
        assert_eq!(state.config.read().env_proxy_port, Some(port_b));

        // 3. Toggle off port_b -> EgressGuard should auto disable env proxy
        let _ = state.toggle_port_mapping("port-b", false).await;
        assert!(!state.config.read().env_proxy_enabled);
        assert_eq!(state.config.read().env_proxy_port, None);
        // System proxy on port_a remains untouched
        assert!(state.config.read().system_proxy_enabled);
        assert_eq!(state.config.read().system_proxy_port, Some(port_a));

        // 4. Attempting to bind env proxy to disabled port_b must fail
        assert!(state.apply_env_proxy_transition(true, Some(port_b)).is_err());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_recoverable_port_requires_running_core() {
        let temp_dir = std::env::temp_dir().join(format!(
            "mihomo_state_recoverable_{}",
            std::time::UNIX_EPOCH.elapsed().unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let state = AppState::new(temp_dir.clone());
        *state.occupied_ports.write() = [7890u16].into_iter().collect();

        assert_eq!(
            state.recoverable_port(),
            None,
            "A stopped kernel must never trigger occupancy restoration"
        );

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
    #[tokio::test]
    async fn chain_edits_invalidate_only_affected_measurements_and_persist_the_reset() {
        let directory = std::env::temp_dir().join(format!("chain-measurements-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).expect("create isolated application directory");
        let state = AppState::new(directory.clone());
        let mut config = state.config.read().clone();
        config.residential_proxies = serde_json::from_value(serde_json::json!([{
            "id": "exit-1", "name": "Exit", "protocol": "http", "server": "127.0.0.1",
            "port": 1080, "username": "test-user", "password": "test-password"
        }]))
        .expect("residential fixture");
        state.persist_config(&config).expect("save residential proxy");
        let port = state
            .get_next_available_port(Some(24000), None)
            .expect("free test port");
        let mapping = PortMapping {
            id: "chain-1".to_string(),
            port,
            enabled: false,
            profile_id: "profile-1".to_string(),
            node_name: "Upstream A".to_string(),
            residential_proxy_id: Some("exit-1".to_string()),
            ..PortMapping::default()
        };
        let mut saved = state.save_port_mapping(mapping).await.expect("save chain");
        let target = crate::core::config_generator::chain_proxy_name(port);
        state.latency_probe.set_latency("ordinary-node", Some(10));
        state.latency_probe.set_latency(&target, Some(55));
        saved.latency = Some(55);
        saved.node_name = "Upstream B".to_string();
        let mut changed = state.save_port_mapping(saved).await.expect("change upstream");
        assert_eq!(changed.latency, None);
        assert_eq!(state.latency_probe.get_latency(&target), None);
        assert_eq!(state.latency_probe.get_latency("ordinary-node"), Some(Some(10)));

        state.latency_probe.set_latency(&target, Some(65));
        changed.latency = Some(65);
        state
            .save_port_mapping(changed)
            .await
            .expect("persist measured chain latency");
        config.residential_proxies[0].password = "changed-password".to_string();
        state.persist_config(&config).expect("change residential credentials");
        let restarted = AppState::new(directory.clone());
        assert_eq!(
            restarted
                .port_router
                .get_port_mapping_by_id("chain-1")
                .expect("chain persists")
                .latency,
            None
        );
        assert_eq!(restarted.latency_probe.get_latency(&target), None);
        assert_eq!(restarted.latency_probe.get_latency("ordinary-node"), Some(Some(10)));
        restarted.latency_probe.set_latency(&target, Some(75));
        restarted.delete_port_mapping("chain-1").await.expect("delete chain");
        assert_eq!(restarted.latency_probe.get_latency(&target), None);
        std::fs::remove_dir_all(directory).expect("remove isolated application directory");
    }

    #[tokio::test]
    async fn port_process_history_is_cleared_on_delete_and_port_change() {
        let temp_dir = std::env::temp_dir().join(format!("mhm_state_hist_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).expect("create temp dir");
        let state = AppState::new(temp_dir.clone());

        let port_a = save_mapping_on_free_port(&state, "hist-port", "node-a").await;
        let port_b = state
            .get_next_available_port(Some(port_a + 1), None)
            .expect("find second free port");

        let allowed: HashSet<u16> = [port_a, port_b].into_iter().collect();
        let conn = crate::models::ConnectionItem {
            id: "conn-1".to_string(),
            metadata: crate::models::ConnectionMetadata {
                inbound_port: Some(port_a.to_string()),
                process: Some("chrome.exe".to_string()),
                process_path: Some(r"C:\Chrome\chrome.exe".to_string()),
                ..Default::default()
            },
            upload: 0,
            download: 0,
            start: "2026-11-20T00:00:00Z".to_string(),
            chains: vec!["DIRECT".to_string()],
            rule: format!("IN-PORT,{port_a},DIRECT"),
            rule_payload: None,
        };
        state.process_history.record_snapshot(
            &crate::models::ConnectionSnapshot {
                connections: vec![conn],
                ..Default::default()
            },
            &allowed,
        );
        assert_eq!(state.get_port_process_history(port_a).await.len(), 1);

        let mut updated = state
            .port_router
            .get_port_mapping_by_id("hist-port")
            .expect("mapping exists");
        updated.port = port_b;
        state.save_port_mapping(updated).await.expect("move port");
        assert!(state.get_port_process_history(port_a).await.is_empty());

        let conn_b = crate::models::ConnectionItem {
            id: "conn-2".to_string(),
            metadata: crate::models::ConnectionMetadata {
                inbound_port: Some(port_b.to_string()),
                process: Some("firefox.exe".to_string()),
                ..Default::default()
            },
            upload: 0,
            download: 0,
            start: "2026-11-20T00:00:00Z".to_string(),
            chains: vec!["DIRECT".to_string()],
            rule: format!("IN-PORT,{port_b},DIRECT"),
            rule_payload: None,
        };
        state.process_history.record_snapshot(
            &crate::models::ConnectionSnapshot {
                connections: vec![conn_b],
                ..Default::default()
            },
            &allowed,
        );
        assert_eq!(state.get_port_process_history(port_b).await.len(), 1);

        state.delete_port_mapping("hist-port").await.expect("delete mapping");
        assert!(state.get_port_process_history(port_b).await.is_empty());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn disabling_subscription_omits_listener_reconciles_egress_and_allows_enabled_fallback() {
        let temp_dir = std::env::temp_dir().join(format!("mihomo_disabled_sub_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).expect("create temp dir");
        let state = AppState::new(temp_dir.clone());

        let yaml_a = r#"
proxies:
  - {name: "NodeA", type: ss, server: 1.1.1.1, port: 8388, cipher: aes-128-gcm, password: "pw"}
  - {name: "NodeA2", type: ss, server: 1.1.1.2, port: 8388, cipher: aes-128-gcm, password: "pw"}
"#;
        let yaml_b = r#"
proxies:
  - {name: "NodeB", type: ss, server: 2.2.2.2, port: 8388, cipher: aes-128-gcm, password: "pw"}
"#;
        let prof_a = state
            .profile_manager
            .add_in_memory_profile("SubA".to_string(), yaml_a)
            .expect("add SubA");
        let prof_b = state
            .profile_manager
            .add_in_memory_profile("SubB".to_string(), yaml_b)
            .expect("add SubB");

        let port_only_a = save_mapping_on_free_port(&state, "map-a", "NodeA").await;
        let mut mapping_a = state
            .port_router
            .get_port_mapping_by_id("map-a")
            .expect("map-a exists");
        mapping_a.profile_id = prof_a.id.clone();
        state.save_port_mapping(mapping_a).await.expect("bind map-a to SubA");

        let port_with_fb = save_mapping_on_free_port(&state, "map-fb", "NodeA2").await;
        let mut mapping_fb = state
            .port_router
            .get_port_mapping_by_id("map-fb")
            .expect("map-fb exists");
        mapping_fb.profile_id = prof_a.id.clone();
        mapping_fb.fallback_profile_id = Some(prof_b.id.clone());
        mapping_fb.fallback_node_name = Some("NodeB".to_string());
        state
            .save_port_mapping(mapping_fb)
            .await
            .expect("bind map-fb to SubA with SubB fallback");

        // Bind TUN to port_only_a so we can verify egress reconciliation on profile disable
        state
            .prepare_tun_transition(true, Some(port_only_a))
            .expect("bind tun to port_only_a");
        assert!(state.config.read().tun_enabled);

        // Disable SubA and sync runtime config
        state
            .profile_manager
            .set_profile_enabled(&prof_a.id, false)
            .expect("disable SubA");
        let runtime_path = state.sync_runtime_config().await.expect("sync runtime config");
        let yaml = std::fs::read_to_string(&runtime_path).expect("read runtime.yaml");

        // SubA proxies and port_only_a listener/rules must not be present
        assert!(!yaml.contains("[SubA] NodeA"), "disabled profile proxy must be omitted");
        assert!(
            !yaml.contains(&format!("in-{port_only_a}")),
            "listener for disabled-only port must be omitted"
        );
        assert!(
            !yaml.contains(&format!("IN-PORT,{port_only_a},")),
            "rules for disabled-only port must be omitted"
        );

        // port_with_fb stays active using enabled SubB fallback
        assert!(yaml.contains("[SubB] NodeB"), "enabled fallback proxy must remain");
        assert!(
            yaml.contains(&format!("in-{port_with_fb}")),
            "listener with enabled fallback must remain active"
        );
        assert!(
            yaml.contains(&format!("IN-PORT,{port_with_fb},[SubB] NodeB"))
                || (yaml.contains(&format!("sub-rule-{port_with_fb}")) && yaml.contains("MATCH,[SubB] NodeB")),
            "port with disabled primary and enabled fallback must route to fallback; yaml:\n{yaml}"
        );

        // TUN bound to disabled-profile port must be automatically cleared, and rebinding rejected
        assert!(!state.config.read().tun_enabled);
        assert_eq!(state.config.read().tun_port, None);
        assert!(state.prepare_tun_transition(true, Some(port_only_a)).is_err());

        // Re-enabling SubA restores both proxy and listener
        state
            .profile_manager
            .set_profile_enabled(&prof_a.id, true)
            .expect("re-enable SubA");
        let runtime_path = state.sync_runtime_config().await.expect("re-sync runtime config");
        let yaml = std::fs::read_to_string(&runtime_path).expect("read restored runtime.yaml");
        assert!(yaml.contains("[SubA] NodeA"));
        assert!(yaml.contains(&format!("in-{port_only_a}")));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
