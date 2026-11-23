use crate::core::port_probe::{PortTransport, is_port_available, transport_for};
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
    pub residential_proxies: Vec<crate::models::ResidentialProxy>,
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
            // Persisted verbatim: the frontend detects this exact untouched default and renders it
            // in the active language, so the stored value must stay locale-independent.
            description: Some("直连监听 (直通流量不走代理)".to_string()),
            fallback_profile_id: None,
            fallback_node_name: None,
            bypass_cn: false,
            manual_fallback: false,
            residential_proxy_id: None,
            chain_exit_profile_id: None,
            chain_exit_node_name: None,
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
        let content = serde_json::to_string_pretty(&*self.ports.read()).map_err(|e| {
            AppError::Internal(crate::tr!(
                format!("序列化端口映射失败: {e}"),
                format!("Failed to serialize ports: {e}"),
            ))
        })?;
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

        // The pre-check runs before the protocol is finalized, so it stays conservative and
        // requires both transports (the default `mixed` listener binds TCP and UDP).
        is_port_available(port, PortTransport::TcpAndUdp, ctx.allow_lan, exclude_pid)
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
        Err(AppError::InvalidConfig(
            crate::tr!(
                "未能在可用范围内找到空闲端口",
                "No free port found in the available range"
            )
            .to_string(),
        ))
    }

    pub fn save_port_mapping(&self, mut mapping: PortMapping, ctx: &PortProbeContext) -> AppResult<PortMapping> {
        // Validate port range
        if !(1024..=65535).contains(&mapping.port) {
            return Err(AppError::InvalidConfig(
                crate::tr!(
                    "端口号必须在 1024 到 65535 之间",
                    "Port number must be between 1024 and 65535"
                )
                .to_string(),
            ));
        }

        // Empty optional ID is equivalent to "no chain".
        mapping.residential_proxy_id = mapping
            .residential_proxy_id
            .take()
            .map(|id| id.trim().to_string())
            .filter(|id| !id.is_empty());

        let is_direct = mapping.id == crate::models::FIXED_DIRECT_PORT_ID || mapping.node_name == "DIRECT";
        if let Some(exit_id) = mapping.residential_proxy_id.as_deref() {
            if is_direct {
                return Err(AppError::InvalidConfig(
                    crate::tr!(
                        "直连监听不能配置住宅代理链",
                        "The direct listener cannot be configured with a residential proxy chain"
                    )
                    .to_string(),
                ));
            }
            let exit = ctx
                .residential_proxies
                .iter()
                .find(|proxy| proxy.id.trim() == exit_id)
                .ok_or_else(|| {
                    AppError::InvalidConfig(crate::tr!(
                        format!("引用的住宅代理出口不存在，无法保存端口 {}", mapping.port),
                        format!(
                            "The referenced residential proxy exit does not exist; cannot save port {}",
                            mapping.port
                        ),
                    ))
                })?;
            exit.validate().map_err(AppError::InvalidConfig)?;
            if mapping
                .fallback_node_name
                .as_deref()
                .is_some_and(|name| !name.trim().is_empty())
                || mapping
                    .fallback_profile_id
                    .as_deref()
                    .is_some_and(|id| !id.trim().is_empty())
                || mapping.manual_fallback
            {
                return Err(AppError::InvalidConfig(
                    crate::tr!(
                        "住宅代理链端口不支持备用节点或手动降级，以避免出口被静默切换",
                        "Residential proxy chain ports do not support fallback nodes or manual failover, to avoid silently switching the exit"
                    )
                    .to_string(),
                ));
            }
            // Chain listeners must send every destination through the chain; CN bypass and
            // per-port/global rules are intentionally ignored by the generator.
            mapping.bypass_cn = false;
        }

        if !is_direct {
            if mapping.profile_id.trim().is_empty() {
                return Err(AppError::InvalidConfig(
                    crate::tr!("订阅 ID 不能为空", "Profile ID cannot be empty").to_string(),
                ));
            }

            if mapping.node_name.trim().is_empty() {
                return Err(AppError::InvalidConfig(
                    crate::tr!("节点名称不能为空", "Node name cannot be empty").to_string(),
                ));
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

            if !is_direct && mapping.residential_proxy_id.is_none() {
                // 1:1 Strict Node Binding Invariant: A proxy node can only be bound by a single
                // direct port listener. Chain ports generate a distinct per-port exit proxy, so
                // multiple ports (and a direct listener) may reuse the same upstream node.
                for existing in guard.iter() {
                    if existing.id != mapping_id
                        && existing.residential_proxy_id.is_none()
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
                    return Err(AppError::InvalidConfig(crate::tr!(
                        format!(
                            "端口 {} 已被映射「{}」(ID: {}) 使用",
                            mapping.port,
                            existing.description.as_deref().unwrap_or(&existing.node_name),
                            existing.id
                        ),
                        format!(
                            "Port {} is already used by mapping \"{}\" (ID: {})",
                            mapping.port,
                            existing.description.as_deref().unwrap_or(&existing.node_name),
                            existing.id
                        ),
                    )));
                }
            }

            // Check reserved ports
            if ctx.reserved_ports.contains(&mapping.port) {
                return Err(AppError::InvalidConfig(crate::tr!(
                    format!("端口 {} 被系统或控制器保留", mapping.port),
                    format!("Port {} is reserved by the system or controller", mapping.port),
                )));
            }

            // Port availability probing when enabled
            if mapping.enabled {
                let existing_mapping = guard.iter().find(|p| p.id == mapping_id);
                let is_same_active_port = existing_mapping
                    .map(|ex| ex.port == mapping.port && ex.enabled)
                    .unwrap_or(false);

                let exclude_pid = if is_same_active_port { ctx.core_pid } else { None };

                if !is_port_available(
                    mapping.port,
                    transport_for(mapping.protocol),
                    ctx.allow_lan,
                    exclude_pid,
                ) {
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
                crate::tr!(
                    "固定直连监听卡片为系统内置卡片，不可删除",
                    "The fixed direct listener is a built-in card and cannot be deleted"
                )
                .to_string(),
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
            Err(AppError::PortMappingNotFound(crate::tr!(
                format!("未找到 ID 为 '{}' 的端口映射", id),
                format!("Port mapping with ID '{}' not found", id),
            )))
        }
    }

    pub fn toggle_port_mapping(&self, id: &str, enabled: bool, ctx: &PortProbeContext) -> AppResult<PortMapping> {
        let mut target = self.get_port_mapping_by_id(id).ok_or_else(|| {
            AppError::PortMappingNotFound(crate::tr!(
                format!("未找到 ID 为 '{}' 的端口映射", id),
                format!("Port mapping with ID '{}' not found", id),
            ))
        })?;

        if target.enabled == enabled {
            return Ok(target);
        }

        // If toggling on, check port availability
        if enabled {
            let guard = self.ports.read();
            for existing in guard.iter() {
                if existing.id != id && existing.port == target.port && existing.enabled {
                    return Err(AppError::InvalidConfig(crate::tr!(
                        format!("端口 {} 已在另一个映射中启用", target.port),
                        format!("Port {} is already active on another mapping", target.port),
                    )));
                }
            }

            if ctx.reserved_ports.contains(&target.port) {
                return Err(AppError::InvalidConfig(format!(
                    "Port {} is reserved by the system or controller",
                    target.port
                )));
            }

            if !is_port_available(target.port, transport_for(target.protocol), ctx.allow_lan, None) {
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
        let mut target = self.get_port_mapping_by_id(id).ok_or_else(|| {
            AppError::PortMappingNotFound(crate::tr!(
                format!("未找到 ID 为 '{}' 的端口映射", id),
                format!("Port mapping with ID '{}' not found", id),
            ))
        })?;

        if target.residential_proxy_id.is_some() {
            return Err(AppError::InvalidConfig(
                crate::tr!(
                    "住宅代理链端口不支持手动降级，以避免出口被静默切换",
                    "Residential proxy chain ports do not support manual failover, to avoid silently switching the exit"
                )
                .to_string(),
            ));
        }

        if target.fallback_node_name.as_ref().is_none_or(|fb| fb.trim().is_empty()) {
            return Err(AppError::InvalidConfig(
                crate::tr!(
                    "该端口未配置备用节点，无法切换备用模式",
                    "This port has no fallback node configured, so fallback mode cannot be switched"
                )
                .to_string(),
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

    pub fn swap_port_fallback<F>(&self, id: &str, resolve_latency: F) -> AppResult<PortMapping>
    where
        F: FnOnce(&str, &str) -> Option<u32>,
    {
        let (previous, updated) = {
            let mut guard = self.ports.write();
            let pos = guard.iter().position(|p| p.id == id).ok_or_else(|| {
                AppError::PortMappingNotFound(crate::tr!(
                    format!("未找到 ID 为 '{}' 的端口映射", id),
                    format!("Port mapping with ID '{}' not found", id),
                ))
            })?;

            let current = &guard[pos];
            if current.id == crate::models::FIXED_DIRECT_PORT_ID || current.node_name == "DIRECT" {
                return Err(AppError::InvalidConfig(
                    crate::tr!(
                        "直连监听不支持交换主备节点",
                        "The direct listener does not support swapping primary and backup nodes"
                    )
                    .to_string(),
                ));
            }

            if current.residential_proxy_id.is_some() {
                return Err(AppError::InvalidConfig(
                    crate::tr!(
                        "住宅代理链端口不支持交换主备节点",
                        "Residential proxy chain ports do not support swapping primary and backup nodes"
                    )
                    .to_string(),
                ));
            }

            let new_node_name = current
                .fallback_node_name
                .as_deref()
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .ok_or_else(|| {
                    AppError::InvalidConfig(
                        crate::tr!(
                            "该端口未配置备用节点，无法交换主备节点",
                            "This port has no fallback node configured, so primary and backup cannot be swapped"
                        )
                        .to_string(),
                    )
                })?
                .to_string();

            let old_profile_id = current.profile_id.clone();
            let old_node_name = current.node_name.clone();
            let new_profile_id = current
                .fallback_profile_id
                .as_deref()
                .map(str::trim)
                .filter(|pid| !pid.is_empty())
                .unwrap_or(&old_profile_id)
                .to_string();

            if new_profile_id == old_profile_id && new_node_name == old_node_name {
                return Err(AppError::InvalidConfig(
                    crate::tr!(
                        "主节点与备用节点相同，无需交换",
                        "Primary and backup nodes are identical"
                    )
                    .to_string(),
                ));
            }

            for existing in guard.iter() {
                if existing.id != id
                    && existing.residential_proxy_id.is_none()
                    && existing.profile_id == new_profile_id
                    && existing.node_name == new_node_name
                {
                    return Err(AppError::DuplicateNodeBinding {
                        node_name: new_node_name,
                        port: existing.port,
                    });
                }
            }

            let previous = current.clone();
            let new_latency = resolve_latency(&new_profile_id, &new_node_name);
            let mut updated = previous.clone();
            updated.profile_id = new_profile_id;
            updated.node_name = new_node_name;
            updated.fallback_profile_id = Some(old_profile_id);
            updated.fallback_node_name = Some(old_node_name);
            updated.manual_fallback = false;
            updated.latency = new_latency;

            guard[pos] = updated.clone();
            (previous, updated)
        };

        if let Err(err) = self.persist_metadata() {
            let mut guard = self.ports.write();
            if let Some(pos) = guard.iter().position(|p| p.id == id) {
                guard[pos] = previous;
            }
            return Err(err);
        }

        info!(
            "Port mapping '{}' on port {} swapped primary and backup nodes (primary='{}', fallback='{}')",
            id,
            updated.port,
            updated.node_name,
            updated.fallback_node_name.as_deref().unwrap_or("")
        );

        Ok(updated)
    }

    /// Swaps the listener ports of two mappings, keeping every other field on its own card.
    ///
    /// Both destination ports already belong to the pair, so the swap can never collide with a
    /// third mapping, and the 1:1 node binding invariant is untouched (nodes do not move).
    /// Enabled cards are still probed: after the swap the kernel has to bind the peer's port,
    /// which may be held by a third-party process when that peer is currently disabled. Our own
    /// sidecar is excluded only while it actually owns the destination listener.
    pub fn swap_port_mapping_ports(
        &self,
        first_id: &str,
        second_id: &str,
        ctx: &PortProbeContext,
    ) -> AppResult<Vec<PortMapping>> {
        if first_id == second_id {
            return Err(AppError::InvalidConfig(
                crate::tr!(
                    "不能与同一端口卡片交换端口",
                    "A port card cannot swap ports with itself"
                )
                .to_string(),
            ));
        }

        let (first, second) = {
            let guard = self.ports.read();
            let first = guard
                .iter()
                .find(|mapping| mapping.id == first_id)
                .cloned()
                .ok_or_else(|| port_mapping_not_found(first_id))?;
            let second = guard
                .iter()
                .find(|mapping| mapping.id == second_id)
                .cloned()
                .ok_or_else(|| port_mapping_not_found(second_id))?;
            (first, second)
        };
        if [&first, &second].iter().any(|mapping| {
            mapping.id == crate::models::FIXED_DIRECT_PORT_ID || mapping.node_name == "DIRECT"
        }) {
            return Err(AppError::InvalidConfig(
                crate::tr!("固定直连监听卡片不能交换端口", "The fixed direct listener cannot swap ports").to_string(),
            ));
        }

        for port in [first.port, second.port] {
            if !(1024..=65535).contains(&port) {
                return Err(AppError::InvalidConfig(
                    crate::tr!(
                        "端口号必须在 1024 到 65535 之间",
                        "Port number must be between 1024 and 65535"
                    )
                    .to_string(),
                ));
            }
            if ctx.reserved_ports.contains(&port) {
                return Err(AppError::InvalidConfig(crate::tr!(
                    format!("端口 {port} 被系统或控制器保留"),
                    format!("Port {port} is reserved by the system or controller"),
                )));
            }
        }

        // Only listeners that stay enabled after the swap need a bindable destination. A port our
        // own core already serves is not a conflict: the reload rebinds it to the peer mapping.
        for (will_listen, destination, protocol, peer_listening) in [
            (first.enabled, second.port, first.protocol, second.enabled),
            (second.enabled, first.port, second.protocol, first.enabled),
        ] {
            if !will_listen {
                continue;
            }
            let exclude_pid = if peer_listening { ctx.core_pid } else { None };
            if !is_port_available(destination, transport_for(protocol), ctx.allow_lan, exclude_pid) {
                return Err(AppError::PortOccupied(destination));
            }
        }

        {
            let mut guard = self.ports.write();
            let first_pos = guard
                .iter()
                .position(|mapping| mapping.id == first_id)
                .ok_or_else(|| port_mapping_not_found(first_id))?;
            let second_pos = guard
                .iter()
                .position(|mapping| mapping.id == second_id)
                .ok_or_else(|| port_mapping_not_found(second_id))?;

            // The probe phase released the lock; refuse to overwrite a concurrent edit instead of
            // swapping stale port numbers.
            if guard[first_pos].port != first.port
                || guard[first_pos].enabled != first.enabled
                || guard[first_pos].protocol != first.protocol
                || guard[second_pos].port != second.port
                || guard[second_pos].enabled != second.enabled
                || guard[second_pos].protocol != second.protocol
            {
                return Err(AppError::InvalidConfig(
                    crate::tr!(
                        "端口映射在交换过程中被修改，请重试",
                        "The port mappings changed while swapping; please retry"
                    )
                    .to_string(),
                ));
            }

            guard[first_pos].port = second.port;
            guard[second_pos].port = first.port;

            // Chain exits are renamed after their port (`chain-<port>`), so a moved chain card's
            // cached latency describes a proxy name that no longer exists.
            for pos in [first_pos, second_pos] {
                if guard[pos].residential_proxy_id.is_some() {
                    guard[pos].latency = None;
                }
            }
        }

        if let Err(err) = self.persist_metadata() {
            let mut guard = self.ports.write();
            if let Some(pos) = guard.iter().position(|mapping| mapping.id == first_id) {
                guard[pos].port = first.port;
                guard[pos].latency = first.latency;
            }
            if let Some(pos) = guard.iter().position(|mapping| mapping.id == second_id) {
                guard[pos].port = second.port;
                guard[pos].latency = second.latency;
            }
            return Err(err);
        }

        info!(
            first_port = first.port,
            second_port = second.port,
            "Swapped listener ports between mappings '{}' and '{}'",
            first_id,
            second_id
        );

        Ok(self.get_port_mappings())
    }

    pub fn clear_port_latencies(&self, mappings: &[PortMapping]) -> AppResult<()> {
        if mappings.is_empty() {
            return Ok(());
        }
        {
            let mut ports = self.ports.write();
            for port in ports.iter_mut() {
                if mappings.iter().any(|mapping| mapping.id == port.id) {
                    port.latency = None;
                }
            }
        }
        self.persist_metadata()
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
            Err(port_mapping_not_found(id))
        }
    }
}

fn port_mapping_not_found(id: &str) -> AppError {
    AppError::PortMappingNotFound(crate::tr!(
        format!("未找到 ID 为 '{}' 的端口映射", id),
        format!("Port mapping with ID '{}' not found", id),
    ))
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
            residential_proxy_id: None,
            chain_exit_profile_id: None,
            chain_exit_node_name: None,
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
            ..PortProbeContext::default()
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

    fn residential_exit() -> crate::models::ResidentialProxy {
        crate::models::ResidentialProxy {
            id: "res-1".to_string(),
            name: "Managed Exit".to_string(),
            protocol: "socks5".to_string(),
            server: "127.0.0.1".to_string(),
            port: 57421,
            username: "chain-user".to_string(),
            password: "pw-1234".to_string(),
        }
    }

    fn chain_ctx() -> PortProbeContext {
        PortProbeContext {
            residential_proxies: vec![residential_exit()],
            ..PortProbeContext::default()
        }
    }

    #[test]
    fn test_chain_mapping_rejects_missing_exit_fallback_and_direct() {
        let temp_dir = std::env::temp_dir().join(format!("test_port_router_chain_validation_{}", Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let router = PortRouter::new(temp_dir.clone());
        let ctx = chain_ctx();

        let mut missing_exit = create_test_mapping("chain-missing", 10080, "prof-1", "HK-01", false);
        missing_exit.residential_proxy_id = Some("deleted-exit".to_string());
        let err = router
            .save_port_mapping(missing_exit, &ctx)
            .expect_err("missing exit must reject");
        assert!(matches!(&err, AppError::InvalidConfig(message) if message.contains("住宅代理出口不存在")));

        let mut fallback = create_test_mapping("chain-fallback", 10081, "prof-1", "HK-01", false);
        fallback.residential_proxy_id = Some("res-1".to_string());
        fallback.fallback_node_name = Some("Backup".to_string());
        let err = router
            .save_port_mapping(fallback, &ctx)
            .expect_err("chain fallback must reject");
        assert!(matches!(&err, AppError::InvalidConfig(message) if message.contains("备用节点")));

        let mut direct = create_test_mapping(crate::models::FIXED_DIRECT_PORT_ID, 7878, "direct", "DIRECT", false);
        direct.residential_proxy_id = Some("res-1".to_string());
        let err = router
            .save_port_mapping(direct, &ctx)
            .expect_err("direct chain must reject");
        assert!(matches!(&err, AppError::InvalidConfig(message) if message.contains("直连监听")));

        // A valid chain mapping is normalized: bypass_cn cannot stay enabled.
        let mut valid = create_test_mapping("chain-valid", 10082, "prof-1", "HK-01", false);
        valid.residential_proxy_id = Some(" res-1 ".to_string());
        valid.bypass_cn = true;
        let saved = router.save_port_mapping(valid, &ctx).expect("valid chain mapping");
        assert_eq!(saved.residential_proxy_id.as_deref(), Some("res-1"));
        assert!(!saved.bypass_cn);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_two_chain_ports_can_reuse_the_same_upstream_node() {
        let temp_dir = std::env::temp_dir().join(format!("test_port_router_chain_reuse_{}", Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let router = PortRouter::new(temp_dir.clone());
        let ctx = chain_ctx();

        let mut first = create_test_mapping("chain-a", 10090, "prof-1", "HK-01", false);
        first.residential_proxy_id = Some("res-1".to_string());
        router.save_port_mapping(first, &ctx).expect("first chain port");

        let mut second = create_test_mapping("chain-b", 10091, "prof-1", "HK-01", false);
        second.residential_proxy_id = Some("res-1".to_string());
        router
            .save_port_mapping(second, &ctx)
            .expect("chain ports may share the same upstream node");

        // The strict 1:1 node binding still applies to non-chain ports.
        let plain = create_test_mapping("plain-c", 10092, "prof-2", "Node-X", false);
        router.save_port_mapping(plain, &ctx).expect("plain mapping");
        let duplicate = create_test_mapping("plain-d", 10093, "prof-2", "Node-X", false);
        assert!(matches!(
            router.save_port_mapping(duplicate, &ctx),
            Err(AppError::DuplicateNodeBinding { .. })
        ));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_swap_port_fallback_swaps_nodes_clears_manual_and_persists() {
        let temp_dir = std::env::temp_dir().join(format!("test_port_router_swap_{}", Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let router = PortRouter::new(temp_dir.clone());
        let ctx = PortProbeContext::default();

        let mut m = create_test_mapping("map-swap", 10100, "prof-1", "HK-Primary", false);
        m.fallback_profile_id = Some("prof-2".to_string());
        m.fallback_node_name = Some("HK-Backup".to_string());
        m.manual_fallback = true;
        m.latency = Some(120);
        router.save_port_mapping(m, &ctx).expect("save mapping");

        let swapped = router
            .swap_port_fallback("map-swap", |pid, node| {
                assert_eq!(pid, "prof-2");
                assert_eq!(node, "HK-Backup");
                Some(45)
            })
            .expect("swap should succeed");

        assert_eq!(swapped.profile_id, "prof-2");
        assert_eq!(swapped.node_name, "HK-Backup");
        assert_eq!(swapped.fallback_profile_id.as_deref(), Some("prof-1"));
        assert_eq!(swapped.fallback_node_name.as_deref(), Some("HK-Primary"));
        assert!(!swapped.manual_fallback);
        assert_eq!(swapped.latency, Some(45));

        let reloaded = PortRouter::new(temp_dir.clone());
        let persisted = reloaded.get_port_mapping_by_id("map-swap").expect("persisted");
        assert_eq!(persisted.profile_id, "prof-2");
        assert_eq!(persisted.node_name, "HK-Backup");
        assert_eq!(persisted.fallback_profile_id.as_deref(), Some("prof-1"));
        assert_eq!(persisted.fallback_node_name.as_deref(), Some("HK-Primary"));
        assert!(!persisted.manual_fallback);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_swap_port_fallback_rejects_missing_fallback_and_duplicate_binding() {
        let temp_dir = std::env::temp_dir().join(format!("test_port_router_swap_guard_{}", Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let router = PortRouter::new(temp_dir.clone());
        let ctx = PortProbeContext::default();

        let no_fb = create_test_mapping("map-nofb", 10101, "prof-1", "JP-01", false);
        router.save_port_mapping(no_fb, &ctx).unwrap();
        assert!(matches!(
            router.swap_port_fallback("map-nofb", |_, _| None),
            Err(AppError::InvalidConfig(_))
        ));

        let other_primary = create_test_mapping("map-other", 10102, "prof-1", "SG-02", false);
        router.save_port_mapping(other_primary, &ctx).unwrap();

        let mut conflict = create_test_mapping("map-conflict", 10103, "prof-1", "SG-01", false);
        conflict.fallback_node_name = Some("SG-02".to_string());
        router.save_port_mapping(conflict, &ctx).unwrap();

        let err = router
            .swap_port_fallback("map-conflict", |_, _| None)
            .expect_err("cannot promote node already bound on another port");
        assert!(matches!(
            err,
            AppError::DuplicateNodeBinding { node_name, port } if node_name == "SG-02" && port == 10102
        ));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_swap_port_mapping_ports_swaps_only_ports_and_persists() {
        let temp_dir = std::env::temp_dir().join(format!("test_port_router_port_swap_{}", Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let router = PortRouter::new(temp_dir.clone());
        let ctx = PortProbeContext::default();

        let mut first = create_test_mapping("swap-first", 10200, "prof-a", "Node-A", false);
        first.description = Some("First card".to_string());
        first.latency = Some(88);
        router.save_port_mapping(first, &ctx).expect("save first");
        router
            .save_port_mapping(
                create_test_mapping("swap-second", 10201, "prof-b", "Node-B", false),
                &ctx,
            )
            .expect("save second");

        let updated = router
            .swap_port_mapping_ports("swap-first", "swap-second", &ctx)
            .expect("swap should succeed");
        let first_after = updated.iter().find(|m| m.id == "swap-first").expect("first present");
        let second_after = updated.iter().find(|m| m.id == "swap-second").expect("second present");
        assert_eq!(first_after.port, 10201);
        assert_eq!(second_after.port, 10200);
        // Everything except the port stays on its own card.
        assert_eq!(first_after.node_name, "Node-A");
        assert_eq!(first_after.description.as_deref(), Some("First card"));
        assert_eq!(first_after.latency, Some(88));
        assert_eq!(second_after.node_name, "Node-B");
        assert_eq!(updated[0].id, crate::models::FIXED_DIRECT_PORT_ID);
        assert_eq!(updated[0].port, crate::models::DEFAULT_DIRECT_PORT);

        let reloaded = PortRouter::new(temp_dir.clone());
        assert_eq!(reloaded.get_port_mapping_by_id("swap-first").unwrap().port, 10201);
        assert_eq!(reloaded.get_port_mapping_by_id("swap-second").unwrap().port, 10200);

        // Swapping back restores the original layout.
        let restored = router
            .swap_port_mapping_ports("swap-first", "swap-second", &ctx)
            .expect("reverse swap");
        assert_eq!(restored.iter().find(|m| m.id == "swap-first").unwrap().port, 10200);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_swap_port_mapping_ports_guards() {
        let temp_dir = std::env::temp_dir().join(format!("test_port_router_port_swap_guard_{}", Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let router = PortRouter::new(temp_dir.clone());
        let ctx = PortProbeContext::default();

        router
            .save_port_mapping(create_test_mapping("guard-a", 10220, "prof-a", "Node-A", false), &ctx)
            .unwrap();
        router
            .save_port_mapping(create_test_mapping("guard-b", 10221, "prof-b", "Node-B", false), &ctx)
            .unwrap();

        assert!(matches!(
            router.swap_port_mapping_ports("guard-a", "guard-a", &ctx),
            Err(AppError::InvalidConfig(_))
        ));
        assert!(matches!(
            router.swap_port_mapping_ports("guard-a", "missing", &ctx),
            Err(AppError::PortMappingNotFound(_))
        ));

        let reserved_ctx = PortProbeContext {
            reserved_ports: vec![10221],
            ..PortProbeContext::default()
        };
        assert!(matches!(
            router.swap_port_mapping_ports("guard-a", "guard-b", &reserved_ctx),
            Err(AppError::InvalidConfig(message)) if message.contains("保留")
        ));

        // Failed swaps must leave both cards untouched.
        assert_eq!(router.get_port_mapping_by_id("guard-a").unwrap().port, 10220);
        assert_eq!(router.get_port_mapping_by_id("guard-b").unwrap().port, 10221);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_swap_port_mapping_ports_rejects_busy_destination_for_enabled_card() {
        let temp_dir = std::env::temp_dir().join(format!("test_port_router_port_swap_busy_{}", Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let router = PortRouter::new(temp_dir.clone());
        let ctx = PortProbeContext::default();

        // A third-party listener owns this port; the disabled card may still reference it.
        let occupied = std::net::TcpListener::bind("127.0.0.1:0").expect("bind stand-in listener");
        let busy_port = occupied.local_addr().unwrap().port();
        let free_port = router
            .get_next_available_port(Some(45000), None, &ctx)
            .expect("find a free port");

        router
            .save_port_mapping(
                create_test_mapping("busy-a", free_port, "prof-a", "Node-A", false),
                &ctx,
            )
            .unwrap();
        router
            .save_port_mapping(
                create_test_mapping("busy-b", busy_port, "prof-b", "Node-B", false),
                &ctx,
            )
            .unwrap();
        router
            .toggle_port_mapping("busy-a", true, &ctx)
            .expect("enable the card that will move");

        let err = router
            .swap_port_mapping_ports("busy-a", "busy-b", &ctx)
            .expect_err("a busy destination for an enabled card must be rejected");
        assert!(matches!(err, AppError::PortOccupied(port) if port == busy_port));
        assert_eq!(router.get_port_mapping_by_id("busy-a").unwrap().port, free_port);
        assert_eq!(router.get_port_mapping_by_id("busy-b").unwrap().port, busy_port);

        drop(occupied);
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_swap_port_mapping_ports_clears_moved_chain_latency() {
        let temp_dir = std::env::temp_dir().join(format!("test_port_router_port_swap_chain_{}", Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let router = PortRouter::new(temp_dir.clone());
        let ctx = chain_ctx();

        let mut chain = create_test_mapping("chain-swap", 10210, "prof-1", "HK-01", false);
        chain.residential_proxy_id = Some("res-1".to_string());
        chain.latency = Some(65);
        router.save_port_mapping(chain, &ctx).expect("save chain mapping");
        router
            .save_port_mapping(create_test_mapping("plain-swap", 10211, "prof-2", "JP-01", false), &ctx)
            .expect("save plain mapping");

        let updated = router
            .swap_port_mapping_ports("chain-swap", "plain-swap", &ctx)
            .expect("chain port swap");
        let chain_after = updated.iter().find(|m| m.id == "chain-swap").expect("chain present");
        assert_eq!(chain_after.port, 10211);
        // `chain-<port>` proxy names change with the port, so the cached latency is stale.
        assert_eq!(chain_after.latency, None);
        assert_eq!(
            updated
                .iter()
                .find(|m| m.id == "plain-swap")
                .expect("plain present")
                .port,
            10210
        );

        let reloaded = PortRouter::new(temp_dir.clone());
        let persisted = reloaded.get_port_mapping_by_id("chain-swap").expect("persisted chain");
        assert_eq!(persisted.port, 10211);
        assert_eq!(persisted.latency, None);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
