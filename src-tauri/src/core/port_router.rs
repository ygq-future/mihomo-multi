use crate::core::config_generator::RuntimeGeneratorParams;
use crate::core::kernel_engine::KernelEngine;
use crate::core::port_probe::is_port_available_with_lan;
use crate::core::profile_manager::{atomic_write_file, ProfileManager};
use crate::error::{AppError, AppResult};
use crate::models::{AppConfig, PortMapping};
use parking_lot::RwLock;
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use tauri::Emitter;
use tracing::info;
use uuid::Uuid;

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "action", content = "payload")]
pub enum PortChangeEvent {
    Saved(PortMapping),
    Deleted(String),
    Toggled(PortMapping),
    Resynced,
}

pub trait PortSyncDelegate: Send + Sync {
    fn allow_lan(&self) -> bool {
        false
    }

    fn core_pid(&self) -> Option<u32> {
        None
    }

    fn reserved_ports(&self) -> Vec<u16> {
        Vec::new()
    }

    fn on_ports_changed<'a>(&'a self, _event: &'a PortChangeEvent) -> BoxFuture<'a, AppResult<()>> {
        Box::pin(async { Ok(()) })
    }

    fn sync_runtime<'a>(&'a self) -> BoxFuture<'a, AppResult<PathBuf>> {
        Box::pin(async { Ok(PathBuf::new()) })
    }
}

#[derive(Default)]
pub struct NoopPortSyncDelegate;

impl PortSyncDelegate for NoopPortSyncDelegate {}

pub struct AppPortSyncDelegate {
    engine: Arc<KernelEngine>,
    profile_manager: Arc<ProfileManager>,
    ports: Arc<RwLock<Vec<PortMapping>>>,
    config: Arc<RwLock<AppConfig>>,
    occupied_ports: Arc<RwLock<HashSet<u16>>>,
    app_handle: Arc<RwLock<Option<tauri::AppHandle>>>,
}

impl AppPortSyncDelegate {
    pub fn new(
        engine: Arc<KernelEngine>,
        profile_manager: Arc<ProfileManager>,
        ports: Arc<RwLock<Vec<PortMapping>>>,
        config: Arc<RwLock<AppConfig>>,
        occupied_ports: Arc<RwLock<HashSet<u16>>>,
    ) -> Self {
        Self {
            engine,
            profile_manager,
            ports,
            config,
            occupied_ports,
            app_handle: Arc::new(RwLock::new(None)),
        }
    }

    pub fn set_app_handle(&self, handle: tauri::AppHandle) {
        *self.app_handle.write() = Some(handle);
    }
}

impl PortSyncDelegate for AppPortSyncDelegate {
    fn allow_lan(&self) -> bool {
        self.config.read().allow_lan
    }

    fn core_pid(&self) -> Option<u32> {
        let status = self.engine.get_status();
        if status.running {
            status.pid
        } else {
            None
        }
    }

    fn reserved_ports(&self) -> Vec<u16> {
        vec![self.config.read().controller_port]
    }

    fn on_ports_changed<'a>(&'a self, event: &'a PortChangeEvent) -> BoxFuture<'a, AppResult<()>> {
        Box::pin(async move {
            let _ = self.sync_runtime().await?;

            if let Some(ref handle) = *self.app_handle.read() {
                crate::tray::update_tray_menu(handle);
                let _ = handle.emit("port-mappings-changed", event);
                if let PortChangeEvent::Toggled(mapping) = event {
                    let _ = handle.emit("port-mapping-updated", mapping);
                }
            }

            Ok(())
        })
    }

    fn sync_runtime<'a>(&'a self) -> BoxFuture<'a, AppResult<PathBuf>> {
        Box::pin(async move {
            let raw_proxies = self.profile_manager.get_raw_proxies_for_all_profiles();
            let profiles = self.profile_manager.get_profiles();
            let profile_map: HashMap<String, String> = profiles.into_iter().map(|p| (p.id, p.name)).collect();

            let mappings = self.ports.read().clone();
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

            let path = self
                .engine
                .apply_runtime_config(&params, &active_mappings, raw_proxies, &profile_map)
                .await?;

            if let Some(ref handle) = *self.app_handle.read() {
                crate::tray::update_tray_menu(handle);
                let _ = handle.emit("port-mappings-changed", &PortChangeEvent::Resynced);
            }

            Ok(path)
        })
    }
}

#[derive(Clone)]
pub struct PortRouter {
    ports: Arc<RwLock<Vec<PortMapping>>>,
    metadata_path: PathBuf,
    sync_delegate: Arc<dyn PortSyncDelegate>,
}

impl PortRouter {
    pub fn new(app_dir: PathBuf) -> Self {
        Self::with_delegate(app_dir, Arc::new(NoopPortSyncDelegate))
    }

    pub fn with_delegate(app_dir: PathBuf, delegate: Arc<dyn PortSyncDelegate>) -> Self {
        let metadata_path = app_dir.join("ports.json");
        let initial_ports = Self::load_metadata(&metadata_path);
        let ports = Arc::new(RwLock::new(initial_ports));
        Self {
            ports,
            metadata_path,
            sync_delegate: delegate,
        }
    }

    pub fn load_initial(app_dir: &Path) -> (PathBuf, Arc<RwLock<Vec<PortMapping>>>) {
        let metadata_path = app_dir.join("ports.json");
        let initial_ports = Self::load_metadata(&metadata_path);
        let ports = Arc::new(RwLock::new(initial_ports));
        (metadata_path, ports)
    }

    pub fn with_ports_and_delegate(
        metadata_path: PathBuf,
        ports: Arc<RwLock<Vec<PortMapping>>>,
        delegate: Arc<dyn PortSyncDelegate>,
    ) -> Self {
        Self {
            ports,
            metadata_path,
            sync_delegate: delegate,
        }
    }

    fn load_metadata(path: &Path) -> Vec<PortMapping> {
        if !path.exists() {
            return Vec::new();
        }
        match std::fs::read_to_string(path) {
            Ok(content) => match serde_json::from_str(&content) {
                Ok(mappings) => mappings,
                Err(err) => {
                    tracing::error!("Failed to deserialize ports.json: {}", err);
                    Vec::new()
                }
            },
            Err(err) => {
                tracing::error!("Failed to read ports.json: {}", err);
                Vec::new()
            }
        }
    }

    fn persist_metadata(&self) -> AppResult<()> {
        let content = serde_json::to_string_pretty(&*self.ports.read())
            .map_err(|e| AppError::Internal(format!("Failed to serialize ports: {}", e)))?;
        atomic_write_file(&self.metadata_path, content.as_bytes())?;
        Ok(())
    }

    pub fn get_port_mappings(&self) -> Vec<PortMapping> {
        self.ports.read().clone()
    }

    pub fn get_port_mapping_by_id(&self, id: &str) -> Option<PortMapping> {
        self.ports.read().iter().find(|p| p.id == id).cloned()
    }

    pub fn check_port_available(&self, port: u16, exclude_mapping_id: Option<&str>) -> bool {
        let guard = self.ports.read();
        for m in guard.iter() {
            if m.port == port {
                if exclude_mapping_id == Some(m.id.as_str()) {
                    continue;
                }
                return false;
            }
        }

        if self.sync_delegate.reserved_ports().contains(&port) {
            return false;
        }

        let is_editing_own_active = if let Some(eid) = exclude_mapping_id {
            guard.iter().any(|m| m.id == eid && m.port == port && m.enabled)
        } else {
            false
        };

        let allow_lan = self.sync_delegate.allow_lan();
        let exclude_pid = if is_editing_own_active {
            self.sync_delegate.core_pid()
        } else {
            None
        };

        is_port_available_with_lan(port, allow_lan, exclude_pid)
    }

    pub fn get_next_available_port(
        &self,
        start_port: Option<u16>,
        exclude_mapping_id: Option<&str>,
    ) -> AppResult<u16> {
        let start = start_port.unwrap_or(7891);
        for candidate in start..=u16::MAX {
            if self.check_port_available(candidate, exclude_mapping_id) {
                return Ok(candidate);
            }
        }
        Err(AppError::InvalidConfig("未能在可用范围内找到空闲端口".to_string()))
    }

    pub async fn save_port_mapping(&self, mut mapping: PortMapping) -> AppResult<PortMapping> {
        // Validate port range
        if !(1024..=65535).contains(&mapping.port) {
            return Err(AppError::InvalidConfig(
                "Port number must be between 1024 and 65535".to_string(),
            ));
        }

        if mapping.profile_id.trim().is_empty() {
            return Err(AppError::InvalidConfig("Profile ID cannot be empty".to_string()));
        }

        if mapping.node_name.trim().is_empty() {
            return Err(AppError::InvalidConfig("Node name cannot be empty".to_string()));
        }

        let is_new = mapping.id.trim().is_empty();
        let mapping_id = if is_new {
            Uuid::new_v4().to_string()
        } else {
            mapping.id.clone()
        };
        mapping.id = mapping_id.clone();

        {
            let guard = self.ports.read();

            // 1:1 Strict Node Binding Invariant: A proxy node can only be bound by a single port listener
            for existing in guard.iter() {
                if existing.id != mapping_id
                    && existing.profile_id == mapping.profile_id
                    && existing.node_name == mapping.node_name
                {
                    return Err(AppError::DuplicateNodeBinding {
                        node_name: mapping.node_name.clone(),
                        port: existing.port,
                    });
                }
            }

            // Check if any other mapping uses the same port
            for existing in guard.iter() {
                if existing.id != mapping_id && existing.port == mapping.port {
                    return Err(AppError::InvalidConfig(format!(
                        "Port {} is already used by mapping '{}' (ID: {})",
                        mapping.port,
                        existing.description.as_deref().unwrap_or(&existing.node_name),
                        existing.id
                    )));
                }
            }

            // Check reserved ports
            if self.sync_delegate.reserved_ports().contains(&mapping.port) {
                return Err(AppError::InvalidConfig(format!(
                    "Port {} is reserved by the system or controller",
                    mapping.port
                )));
            }

            // Port availability probing when enabled
            if mapping.enabled {
                let existing_mapping = guard.iter().find(|p| p.id == mapping_id);
                let is_same_active_port = existing_mapping
                    .map(|ex| ex.port == mapping.port && ex.enabled)
                    .unwrap_or(false);

                let allow_lan = self.sync_delegate.allow_lan();
                let exclude_pid = if is_same_active_port {
                    self.sync_delegate.core_pid()
                } else {
                    None
                };

                if !is_port_available_with_lan(mapping.port, allow_lan, exclude_pid) {
                    return Err(AppError::PortOccupied(mapping.port));
                }
            }
        }

        {
            let mut guard = self.ports.write();
            if let Some(pos) = guard.iter().position(|p| p.id == mapping_id) {
                guard[pos] = mapping.clone();
            } else {
                guard.push(mapping.clone());
            }
        }

        self.persist_metadata()?;
        info!(
            "Port mapping '{}' on port {} saved successfully",
            mapping.id, mapping.port
        );

        self.sync_delegate
            .on_ports_changed(&PortChangeEvent::Saved(mapping.clone()))
            .await?;

        Ok(mapping)
    }

    pub async fn delete_port_mapping(&self, id: &str) -> AppResult<()> {
        let removed = {
            let mut guard = self.ports.write();
            let pos = guard.iter().position(|p| p.id == id);
            pos.map(|idx| guard.remove(idx))
        };

        if let Some(mapping) = removed {
            self.persist_metadata()?;
            info!("Port mapping '{}' on port {} deleted", id, mapping.port);
            self.sync_delegate
                .on_ports_changed(&PortChangeEvent::Deleted(id.to_string()))
                .await?;
            Ok(())
        } else {
            Err(AppError::PortMappingNotFound(format!(
                "Port mapping with ID '{}' not found",
                id
            )))
        }
    }

    pub async fn toggle_port_mapping(&self, id: &str, enabled: bool) -> AppResult<PortMapping> {
        let mut target = self
            .get_port_mapping_by_id(id)
            .ok_or_else(|| AppError::PortMappingNotFound(format!("Port mapping with ID '{}' not found", id)))?;

        if target.enabled == enabled {
            return Ok(target);
        }

        // If toggling on, check port availability
        if enabled {
            let guard = self.ports.read();
            for existing in guard.iter() {
                if existing.id != id && existing.port == target.port && existing.enabled {
                    return Err(AppError::InvalidConfig(format!(
                        "Port {} is already active on another mapping",
                        target.port
                    )));
                }
            }

            if self.sync_delegate.reserved_ports().contains(&target.port) {
                return Err(AppError::InvalidConfig(format!(
                    "Port {} is reserved by the system or controller",
                    target.port
                )));
            }

            let allow_lan = self.sync_delegate.allow_lan();
            if !is_port_available_with_lan(target.port, allow_lan, None) {
                return Err(AppError::PortOccupied(target.port));
            }
        }

        target.enabled = enabled;

        {
            let mut guard = self.ports.write();
            if let Some(pos) = guard.iter().position(|p| p.id == id) {
                guard[pos].enabled = enabled;
            }
        }

        self.persist_metadata()?;
        info!(
            "Port mapping '{}' on port {} toggled to enabled={}",
            id, target.port, enabled
        );

        self.sync_delegate
            .on_ports_changed(&PortChangeEvent::Toggled(target.clone()))
            .await?;

        Ok(target)
    }

    pub fn update_port_latency(&self, id: &str, latency: Option<u32>) -> AppResult<()> {
        let mut found = false;
        {
            let mut guard = self.ports.write();
            if let Some(pos) = guard.iter().position(|p| p.id == id) {
                guard[pos].latency = latency;
                found = true;
            }
        }

        if found {
            Ok(())
        } else {
            Err(AppError::PortMappingNotFound(format!(
                "Port mapping with ID '{}' not found",
                id
            )))
        }
    }

    pub async fn sync_runtime(&self) -> AppResult<PathBuf> {
        self.sync_delegate.sync_runtime().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::InboundProtocol;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    #[derive(Default)]
    struct MockPortSyncDelegate {
        allow_lan_flag: AtomicBool,
        core_pid_val: RwLock<Option<u32>>,
        reserved: RwLock<Vec<u16>>,
        events: RwLock<Vec<PortChangeEvent>>,
        sync_calls: AtomicUsize,
    }

    impl PortSyncDelegate for MockPortSyncDelegate {
        fn allow_lan(&self) -> bool {
            self.allow_lan_flag.load(Ordering::SeqCst)
        }

        fn core_pid(&self) -> Option<u32> {
            *self.core_pid_val.read()
        }

        fn reserved_ports(&self) -> Vec<u16> {
            self.reserved.read().clone()
        }

        fn on_ports_changed<'a>(&'a self, event: &'a PortChangeEvent) -> BoxFuture<'a, AppResult<()>> {
            self.events.write().push(event.clone());
            self.sync_calls.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { Ok(()) })
        }

        fn sync_runtime<'a>(&'a self) -> BoxFuture<'a, AppResult<PathBuf>> {
            self.sync_calls.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { Ok(PathBuf::from("/mock/runtime.yaml")) })
        }
    }

    fn create_test_mapping(id: &str, port: u16, profile_id: &str, node_name: &str, enabled: bool) -> PortMapping {
        PortMapping {
            id: id.to_string(),
            port,
            protocol: InboundProtocol::Mixed,
            profile_id: profile_id.to_string(),
            node_name: node_name.to_string(),
            fallback_profile_id: None,
            fallback_node_name: None,
            bypass_cn: true,
            enabled,
            latency: None,
            description: Some(format!("Test Port {}", port)),
        }
    }

    #[tokio::test]
    async fn test_exclusivity_invariant_rejects_duplicate_node_binding() {
        let temp_dir = std::env::temp_dir().join(format!("test_port_router_exclusivity_{}", Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let delegate = Arc::new(MockPortSyncDelegate::default());
        let router = PortRouter::with_delegate(temp_dir.clone(), delegate);

        let m1 = create_test_mapping("map-1", 10080, "prof-1", "Tokyo-01", false);
        router.save_port_mapping(m1).await.expect("Save first mapping");

        // Attempting to bind the SAME proxy node (Tokyo-01 in prof-1) to a DIFFERENT port MUST fail
        let m2 = create_test_mapping("map-2", 10081, "prof-1", "Tokyo-01", false);
        let err = router.save_port_mapping(m2).await.expect_err("Should reject duplicate node binding");

        match err {
            AppError::DuplicateNodeBinding { node_name, port } => {
                assert_eq!(node_name, "Tokyo-01");
                assert_eq!(port, 10080);
            }
            other => panic!("Expected DuplicateNodeBinding error, got: {:?}", other),
        }

        // Updating the existing mapping with the same node should succeed
        let mut m1_update = create_test_mapping("map-1", 10080, "prof-1", "Tokyo-01", false);
        m1_update.description = Some("Updated Tokyo Port".to_string());
        let res = router.save_port_mapping(m1_update).await;
        assert!(res.is_ok(), "Self update should succeed");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_delete_and_toggle_mutations_and_event_dispatch() {
        let temp_dir = std::env::temp_dir().join(format!("test_port_router_mutations_{}", Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let delegate = Arc::new(MockPortSyncDelegate::default());
        let router = PortRouter::with_delegate(temp_dir.clone(), delegate.clone());

        // Find a safe available port
        let port = router.get_next_available_port(Some(12340), None).expect("Find available port");
        let m1 = create_test_mapping("map-toggle", port, "prof-1", "Node-A", false);
        router.save_port_mapping(m1).await.expect("Save mapping");

        assert_eq!(delegate.events.read().len(), 1);
        assert!(matches!(delegate.events.read()[0], PortChangeEvent::Saved(_)));

        // Toggle to enabled
        let toggled = router.toggle_port_mapping("map-toggle", true).await.expect("Toggle on");
        assert!(toggled.enabled);
        assert_eq!(delegate.events.read().len(), 2);
        assert!(matches!(delegate.events.read()[1], PortChangeEvent::Toggled(_)));

        // Verify persistence to disk
        let router_reloaded = PortRouter::with_delegate(temp_dir.clone(), delegate.clone());
        let loaded = router_reloaded.get_port_mapping_by_id("map-toggle").expect("Found persisted mapping");
        assert!(loaded.enabled);

        // Delete mapping
        router.delete_port_mapping("map-toggle").await.expect("Delete mapping");
        assert_eq!(delegate.events.read().len(), 3);
        assert!(matches!(delegate.events.read()[2], PortChangeEvent::Deleted(ref id) if id == "map-toggle"));
        assert!(router.get_port_mapping_by_id("map-toggle").is_none());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_port_availability_lan_and_pid_exclusion() {
        let temp_dir = std::env::temp_dir().join(format!("test_port_router_lan_pid_{}", Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let delegate = Arc::new(MockPortSyncDelegate::default());
        delegate.reserved.write().push(9999); // Reserved controller port
        let router = PortRouter::with_delegate(temp_dir.clone(), delegate.clone());

        // 1. Reserved port must not be available
        assert!(!router.check_port_available(9999, None));

        // 2. Active mapping on port
        let m = create_test_mapping("map-active", 14500, "prof-1", "Node-X", true);
        // Mock that core is running with a specific PID
        *delegate.core_pid_val.write() = Some(999999);
        // Save mapping with enabled=false first to avoid real socket bind failure if port in use
        let mut m_disabled = m.clone();
        m_disabled.enabled = false;
        router.save_port_mapping(m_disabled).await.unwrap();

        // Check that 14500 is not available for a new mapping
        assert!(!router.check_port_available(14500, None));
        // But check_port_available allows it when excluding its own mapping ID
        assert!(router.check_port_available(14500, Some("map-active")));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_atomic_persistence_and_file_integrity() {
        let temp_dir = std::env::temp_dir().join(format!("test_port_router_atomic_{}", Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let delegate = Arc::new(MockPortSyncDelegate::default());
        let router = PortRouter::with_delegate(temp_dir.clone(), delegate.clone());

        let m1 = create_test_mapping("map-persist-1", 11220, "prof-1", "Node-1", false);
        let m2 = create_test_mapping("map-persist-2", 11221, "prof-1", "Node-2", false);

        router.save_port_mapping(m1).await.unwrap();
        router.save_port_mapping(m2).await.unwrap();

        // Read ports.json directly from disk to confirm valid JSON serialization
        let content = std::fs::read_to_string(temp_dir.join("ports.json")).expect("Read ports.json");
        let disk_mappings: Vec<PortMapping> = serde_json::from_str(&content).expect("Deserialize ports.json");
        assert_eq!(disk_mappings.len(), 2);
        assert_eq!(disk_mappings[0].id, "map-persist-1");
        assert_eq!(disk_mappings[1].id, "map-persist-2");

        // New router instance loads identical state
        let router2 = PortRouter::with_delegate(temp_dir.clone(), delegate.clone());
        assert_eq!(router2.get_port_mappings().len(), 2);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_sync_runtime_triggers_pipeline() {
        let temp_dir = std::env::temp_dir().join(format!("test_port_router_sync_{}", Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let delegate = Arc::new(MockPortSyncDelegate::default());
        let router = PortRouter::with_delegate(temp_dir.clone(), delegate.clone());

        let path = router.sync_runtime().await.expect("Sync runtime succeeds");
        assert_eq!(path, PathBuf::from("/mock/runtime.yaml"));
        assert_eq!(delegate.sync_calls.load(Ordering::SeqCst), 1);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
