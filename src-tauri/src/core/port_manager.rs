use crate::core::port_probe::is_port_available;
use crate::error::{AppError, AppResult};
use crate::models::PortMapping;
use parking_lot::RwLock;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tracing::{error, info};
use uuid::Uuid;

#[derive(Clone)]
pub struct PortManager {
    ports: Arc<RwLock<Vec<PortMapping>>>,
    metadata_path: PathBuf,
}

impl PortManager {
    pub fn new(app_dir: PathBuf) -> Self {
        let metadata_path = app_dir.join("ports.json");
        let initial_ports = Self::load_metadata(&metadata_path);

        Self {
            ports: Arc::new(RwLock::new(initial_ports)),
            metadata_path,
        }
    }

    fn load_metadata(path: &Path) -> Vec<PortMapping> {
        if !path.exists() {
            return Vec::new();
        }

        match std::fs::read_to_string(path) {
            Ok(content) => match serde_json::from_str::<Vec<PortMapping>>(&content) {
                Ok(ports) => ports,
                Err(err) => {
                    error!("Failed to parse ports metadata from '{}': {}", path.display(), err);
                    Vec::new()
                }
            },
            Err(err) => {
                error!("Failed to read ports metadata from '{}': {}", path.display(), err);
                Vec::new()
            }
        }
    }

    fn persist_metadata(&self) -> AppResult<()> {
        let ports = self.ports.read().clone();
        if let Some(parent) = self.metadata_path.parent() {
            std::fs::create_dir_all(parent).map_err(AppError::Io)?;
        }
        let json = serde_json::to_string_pretty(&ports).map_err(AppError::Serialization)?;
        std::fs::write(&self.metadata_path, json).map_err(AppError::Io)?;
        Ok(())
    }

    pub fn get_port_mappings(&self) -> Vec<PortMapping> {
        self.ports.read().clone()
    }

    pub fn get_port_mapping_by_id(&self, id: &str) -> Option<PortMapping> {
        self.ports.read().iter().find(|p| p.id == id).cloned()
    }

    pub fn save_port_mapping(&self, mut mapping: PortMapping) -> AppResult<PortMapping> {
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

            // Port availability probing when enabled
            if mapping.enabled {
                let existing_mapping = guard.iter().find(|p| p.id == mapping_id);
                let is_same_active_port = existing_mapping
                    .map(|ex| ex.port == mapping.port && ex.enabled)
                    .unwrap_or(false);

                if !is_same_active_port && !is_port_available(mapping.port) {
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

    pub fn toggle_port_mapping(&self, id: &str, enabled: bool) -> AppResult<PortMapping> {
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

            if !is_port_available(target.port) {
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
        info!("Port mapping '{}' on port {} toggled to enabled={}", id, target.port, enabled);
        Ok(target)
    }

    pub fn update_port_latency(&self, id: &str, latency: Option<u32>) -> AppResult<()> {
        let mut found = false;
        {
            let mut guard = self.ports.write();
            if let Some(item) = guard.iter_mut().find(|p| p.id == id) {
                item.latency = latency;
                found = true;
            }
        }

        if found {
            self.persist_metadata()?;
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

    #[test]
    fn test_port_manager_lifecycle_and_validation() {
        let temp_dir = std::env::temp_dir().join(format!("mihomo_test_ports_{}", Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).expect("Create temp dir");

        let manager = PortManager::new(temp_dir.clone());
        assert_eq!(manager.get_port_mappings().len(), 0);

        // Find a free ephemeral port for testing
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("Bind ephemeral");
        let free_port = listener.local_addr().expect("Get addr").port();
        drop(listener);

        // 1. Create a port mapping
        let mapping = PortMapping {
            id: String::new(),
            port: free_port,
            protocol: InboundProtocol::Mixed,
            profile_id: "profile-1".to_string(),
            node_name: "HK-01".to_string(),
            enabled: true,
            latency: None,
            description: Some("Window 1".to_string()),
            fallback_node_name: None,
        };

        let saved = manager.save_port_mapping(mapping).expect("Save port mapping");
        assert!(!saved.id.is_empty());
        assert_eq!(saved.port, free_port);
        assert!(saved.enabled);

        // 2. Conflict validation: Cannot create another mapping with the same port
        let duplicate = PortMapping {
            id: String::new(),
            port: free_port,
            protocol: InboundProtocol::Http,
            profile_id: "profile-2".to_string(),
            node_name: "US-02".to_string(),
            enabled: false,
            latency: None,
            description: Some("Duplicate".to_string()),
            fallback_node_name: None,
        };
        let dup_res = manager.save_port_mapping(duplicate);
        assert!(dup_res.is_err());

        // 3. Edit existing mapping (same id and same port is allowed)
        let mut to_edit = saved.clone();
        to_edit.description = Some("Updated Window 1".to_string());
        to_edit.protocol = InboundProtocol::Socks5;
        let edited = manager.save_port_mapping(to_edit).expect("Edit port mapping");
        assert_eq!(edited.protocol, InboundProtocol::Socks5);
        assert_eq!(edited.description, Some("Updated Window 1".to_string()));

        // 4. Toggle mapping
        let toggled_off = manager.toggle_port_mapping(&saved.id, false).expect("Toggle off");
        assert!(!toggled_off.enabled);

        let toggled_on = manager.toggle_port_mapping(&saved.id, true).expect("Toggle on");
        assert!(toggled_on.enabled);

        // 5. Update latency
        manager.update_port_latency(&saved.id, Some(45)).expect("Update latency");
        let fetched = manager.get_port_mapping_by_id(&saved.id).expect("Fetch mapping");
        assert_eq!(fetched.latency, Some(45));

        // 6. Persistence check
        let manager2 = PortManager::new(temp_dir.clone());
        let loaded = manager2.get_port_mappings();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, saved.id);
        assert_eq!(loaded[0].latency, Some(45));

        // 7. Delete mapping
        manager2.delete_port_mapping(&saved.id).expect("Delete mapping");
        assert_eq!(manager2.get_port_mappings().len(), 0);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
