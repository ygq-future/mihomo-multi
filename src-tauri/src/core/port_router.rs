use crate::core::port_probe::is_port_available_with_lan;
use crate::core::profile_manager::atomic_write_file;
use crate::error::{AppError, AppResult};
use crate::models::PortMapping;
use parking_lot::RwLock;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tracing::info;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "action", content = "payload")]
pub enum PortChangeEvent {
    Saved(PortMapping),
    Deleted(String),
    Toggled(PortMapping),
    Resynced,
}

#[derive(Debug, Clone, Default)]
pub struct PortProbeContext {
    pub allow_lan: bool,
    pub core_pid: Option<u32>,
    pub reserved_ports: Vec<u16>,
}

#[derive(Clone)]
pub struct PortRouter {
    ports: Arc<RwLock<Vec<PortMapping>>>,
    metadata_path: PathBuf,
}

impl PortRouter {
    pub fn new(app_dir: PathBuf) -> Self {
        let metadata_path = app_dir.join("ports.json");
        let initial_ports = Self::load_metadata(&metadata_path);
        let ports = Arc::new(RwLock::new(initial_ports));
        Self { ports, metadata_path }
    }

    pub fn create_default_direct_mapping(existing: &[PortMapping]) -> PortMapping {
        let mut port = crate::models::DEFAULT_DIRECT_PORT;
        while existing.iter().any(|m| m.port == port) {
            port += 1;
        }
        PortMapping {
            id: crate::models::FIXED_DIRECT_PORT_ID.to_string(),
            port,
            protocol: crate::models::InboundProtocol::Mixed,
            profile_id: "direct".to_string(),
            node_name: "DIRECT".to_string(),
            enabled: false,
            latency: None,
            description: Some("直连监听 (直通流量不走代理)".to_string()),
            fallback_profile_id: None,
            fallback_node_name: None,
            bypass_cn: false,
            manual_fallback: false,
            rules: vec![],
        }
    }

    fn load_metadata(path: &Path) -> Vec<PortMapping> {
        let mut mappings: Vec<PortMapping> = if !path.exists() {
            Vec::new()
        } else {
            match std::fs::read_to_string(path) {
                Ok(content) => match serde_json::from_str(&content) {
                    Ok(m) => m,
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
        };

        if !mappings.iter().any(|m| m.id == crate::models::FIXED_DIRECT_PORT_ID) {
            let direct = Self::create_default_direct_mapping(&mappings);
            mappings.insert(0, direct);
        } else if let Some(pos) = mappings
            .iter()
            .position(|m| m.id == crate::models::FIXED_DIRECT_PORT_ID)
            && pos != 0
        {
            let direct = mappings.remove(pos);
            mappings.insert(0, direct);
        }

        mappings
    }

    fn persist_metadata(&self) -> AppResult<()> {
        let content = serde_json::to_string_pretty(&*self.ports.read())
            .map_err(|e| AppError::Internal(format!("Failed to serialize ports: {}", e)))?;
        atomic_write_file(&self.metadata_path, content.as_bytes())?;
        Ok(())
    }

    pub fn get_port_mappings(&self) -> Vec<PortMapping> {
        let guard = self.ports.read();
        let mut list = guard.clone();
        if let Some(pos) = list.iter().position(|m| m.id == crate::models::FIXED_DIRECT_PORT_ID)
            && pos != 0
        {
            let direct = list.remove(pos);
            list.insert(0, direct);
        }
        list
    }

    pub fn get_port_mapping_by_id(&self, id: &str) -> Option<PortMapping> {
        self.ports.read().iter().find(|p| p.id == id).cloned()
    }

    pub fn check_port_available(&self, port: u16, exclude_mapping_id: Option<&str>, ctx: &PortProbeContext) -> bool {
        let guard = self.ports.read();
        for m in guard.iter() {
            if m.port == port {
                if exclude_mapping_id == Some(m.id.as_str()) {
                    continue;
                }
                return false;
            }
        }

        if ctx.reserved_ports.contains(&port) {
            return false;
        }

        let is_editing_own_active = if let Some(eid) = exclude_mapping_id {
            guard.iter().any(|m| m.id == eid && m.port == port && m.enabled)
        } else {
            false
        };

        let exclude_pid = if is_editing_own_active { ctx.core_pid } else { None };

        is_port_available_with_lan(port, ctx.allow_lan, exclude_pid)
    }

    pub fn get_next_available_port(
        &self,
        start_port: Option<u16>,
        exclude_mapping_id: Option<&str>,
        ctx: &PortProbeContext,
    ) -> AppResult<u16> {
        let start = start_port.unwrap_or(7891);
        for candidate in start..=u16::MAX {
            if self.check_port_available(candidate, exclude_mapping_id, ctx) {
                return Ok(candidate);
            }
        }
        Err(AppError::InvalidConfig("未能在可用范围内找到空闲端口".to_string()))
    }

    pub fn save_port_mapping(&self, mut mapping: PortMapping, ctx: &PortProbeContext) -> AppResult<PortMapping> {
        // Validate port range
        if !(1024..=65535).contains(&mapping.port) {
            return Err(AppError::InvalidConfig(
                "Port number must be between 1024 and 65535".to_string(),
            ));
        }

        let is_direct = mapping.id == crate::models::FIXED_DIRECT_PORT_ID || mapping.node_name == "DIRECT";
        if !is_direct {
            if mapping.profile_id.trim().is_empty() {
                return Err(AppError::InvalidConfig("Profile ID cannot be empty".to_string()));
            }

            if mapping.node_name.trim().is_empty() {
                return Err(AppError::InvalidConfig("Node name cannot be empty".to_string()));
            }
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

            if !is_direct {
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
            if ctx.reserved_ports.contains(&mapping.port) {
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

                let exclude_pid = if is_same_active_port { ctx.core_pid } else { None };

                if !is_port_available_with_lan(mapping.port, ctx.allow_lan, exclude_pid) {
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

        Ok(mapping)
    }

    pub fn delete_port_mapping(&self, id: &str) -> AppResult<()> {
        if id == crate::models::FIXED_DIRECT_PORT_ID {
            return Err(AppError::InvalidConfig(
                "固定直连监听卡片为系统内置卡片，不可删除".to_string(),
            ));
        }
        let removed = {
            let mut guard = self.ports.write();
            let pos = guard.iter().position(|p| p.id == id);
            pos.map(|idx| guard.remove(idx))
        };

        if let Some(mapping) = removed {
            self.persist_metadata()?;
            info!("Port mapping '{}' on port {} deleted", id, mapping.port);
            Ok(())
        } else {
            Err(AppError::PortMappingNotFound(format!(
                "Port mapping with ID '{}' not found",
                id
            )))
        }
    }

    pub fn toggle_port_mapping(&self, id: &str, enabled: bool, ctx: &PortProbeContext) -> AppResult<PortMapping> {
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

            if ctx.reserved_ports.contains(&target.port) {
                return Err(AppError::InvalidConfig(format!(
                    "Port {} is reserved by the system or controller",
                    target.port
                )));
            }

            if !is_port_available_with_lan(target.port, ctx.allow_lan, None) {
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

        Ok(target)
    }

    pub fn toggle_manual_fallback(&self, id: &str, manual_fallback: bool) -> AppResult<PortMapping> {
        let mut target = self
            .get_port_mapping_by_id(id)
            .ok_or_else(|| AppError::PortMappingNotFound(format!("Port mapping with ID '{}' not found", id)))?;

        if target.fallback_node_name.as_ref().is_none_or(|fb| fb.trim().is_empty()) {
            return Err(AppError::InvalidConfig(
                "该端口未配置备用节点，无法切换备用模式".to_string(),
            ));
        }

        target.manual_fallback = manual_fallback;

        {
            let mut guard = self.ports.write();
            if let Some(pos) = guard.iter().position(|p| p.id == id) {
                guard[pos].manual_fallback = manual_fallback;
            }
        }

        self.persist_metadata()?;
        info!(
            "Port mapping '{}' on port {} toggled manual_fallback={}",
            id, target.port, manual_fallback
        );

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
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::InboundProtocol;

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
            manual_fallback: false,
            enabled,
            latency: None,
            description: Some(format!("Test Port {}", port)),
            rules: vec![],
        }
    }

    #[test]
    fn test_exclusivity_invariant_rejects_duplicate_node_binding() {
        let temp_dir = std::env::temp_dir().join(format!("test_port_router_exclusivity_{}", Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let router = PortRouter::new(temp_dir.clone());
        let ctx = PortProbeContext::default();

        let m1 = create_test_mapping("map-1", 10080, "prof-1", "Tokyo-01", false);
        router.save_port_mapping(m1, &ctx).expect("Save first mapping");

        // Attempting to bind the SAME proxy node (Tokyo-01 in prof-1) to a DIFFERENT port MUST fail
        let m2 = create_test_mapping("map-2", 10081, "prof-1", "Tokyo-01", false);
        let err = router
            .save_port_mapping(m2, &ctx)
            .expect_err("Should reject duplicate node binding");

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
        let res = router.save_port_mapping(m1_update, &ctx);
        assert!(res.is_ok(), "Self update should succeed");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_delete_and_toggle_mutations_and_persistence() {
        let temp_dir = std::env::temp_dir().join(format!("test_port_router_mutations_{}", Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let router = PortRouter::new(temp_dir.clone());
        let ctx = PortProbeContext::default();

        // Find a safe available port
        let port = router
            .get_next_available_port(Some(12340), None, &ctx)
            .expect("Find available port");
        let m1 = create_test_mapping("map-toggle", port, "prof-1", "Node-A", false);
        router.save_port_mapping(m1, &ctx).expect("Save mapping");

        // Toggle to enabled
        let toggled = router.toggle_port_mapping("map-toggle", true, &ctx).expect("Toggle on");
        assert!(toggled.enabled);

        // Verify persistence to disk
        let router_reloaded = PortRouter::new(temp_dir.clone());
        let loaded = router_reloaded
            .get_port_mapping_by_id("map-toggle")
            .expect("Found persisted mapping");
        assert!(loaded.enabled);

        // Delete mapping
        router.delete_port_mapping("map-toggle").expect("Delete mapping");
        assert!(router.get_port_mapping_by_id("map-toggle").is_none());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_port_availability_lan_and_pid_exclusion() {
        let temp_dir = std::env::temp_dir().join(format!("test_port_router_lan_pid_{}", Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let router = PortRouter::new(temp_dir.clone());
        let ctx = PortProbeContext {
            allow_lan: false,
            core_pid: Some(999999),
            reserved_ports: vec![9999],
        };

        // 1. Reserved port must not be available
        assert!(!router.check_port_available(9999, None, &ctx));

        // 2. Active mapping on port
        let m = create_test_mapping("map-active", 14500, "prof-1", "Node-X", true);
        // Save mapping with enabled=false first to avoid real socket bind failure if port in use
        let mut m_disabled = m.clone();
        m_disabled.enabled = false;
        router.save_port_mapping(m_disabled, &ctx).unwrap();

        // Check that 14500 is not available for a new mapping
        assert!(!router.check_port_available(14500, None, &ctx));
        // But check_port_available allows it when excluding its own mapping ID
        assert!(router.check_port_available(14500, Some("map-active"), &ctx));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_atomic_persistence_and_file_integrity() {
        let temp_dir = std::env::temp_dir().join(format!("test_port_router_atomic_{}", Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let router = PortRouter::new(temp_dir.clone());
        let ctx = PortProbeContext::default();

        let m1 = create_test_mapping("map-persist-1", 11220, "prof-1", "Node-1", false);
        let m2 = create_test_mapping("map-persist-2", 11221, "prof-1", "Node-2", false);

        router.save_port_mapping(m1, &ctx).unwrap();
        router.save_port_mapping(m2, &ctx).unwrap();

        // Read ports.json directly from disk to confirm valid JSON serialization
        let content = std::fs::read_to_string(temp_dir.join("ports.json")).expect("Read ports.json");
        let disk_mappings: Vec<PortMapping> = serde_json::from_str(&content).expect("Deserialize ports.json");
        assert_eq!(disk_mappings.len(), 3);
        assert_eq!(disk_mappings[0].id, crate::models::FIXED_DIRECT_PORT_ID);
        assert_eq!(disk_mappings[1].id, "map-persist-1");
        assert_eq!(disk_mappings[2].id, "map-persist-2");

        // New router instance loads identical state
        let router2 = PortRouter::new(temp_dir.clone());
        assert_eq!(router2.get_port_mappings().len(), 3);
        assert_eq!(router2.get_port_mappings()[0].id, crate::models::FIXED_DIRECT_PORT_ID);
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_fixed_direct_cannot_be_deleted() {
        let temp_dir = std::env::temp_dir().join(format!("test_port_router_direct_{}", Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let router = PortRouter::new(temp_dir.clone());
        let ctx = PortProbeContext::default();

        // Direct mapping exists by default at index 0
        let mappings = router.get_port_mappings();
        assert_eq!(mappings[0].id, crate::models::FIXED_DIRECT_PORT_ID);
        assert_eq!(mappings[0].port, crate::models::DEFAULT_DIRECT_PORT);
        assert_eq!(mappings[0].node_name, "DIRECT");
        assert!(!mappings[0].enabled);

        // Attempt to delete should return error
        let del_res = router.delete_port_mapping(crate::models::FIXED_DIRECT_PORT_ID);
        assert!(del_res.is_err());

        // Modifying port on fixed direct works
        let mut direct = mappings[0].clone();
        direct.port = 17878;
        let saved = router.save_port_mapping(direct, &ctx).unwrap();
        assert_eq!(saved.port, 17878);
        assert_eq!(router.get_port_mappings()[0].port, 17878);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
