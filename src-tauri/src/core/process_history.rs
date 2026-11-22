use crate::core::profile_manager::atomic_write_file;
use crate::core::process_resolver::{ProcessTreeSnapshot, is_transient_or_helper_process};
use crate::error::{AppError, AppResult};
use crate::models::{ConnectionMetadata, ConnectionSnapshot, PortProcessRecord, PortProcessUsageItem};
use parking_lot::{Mutex, RwLock};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::warn;

pub const MAX_PROCESS_RECORDS_PER_PORT: usize = 50;
const LAST_SEEN_TOUCH_INTERVAL_MS: u64 = 60_000;

fn now_epoch_ms() -> u64 {
    u64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
    )
    .unwrap_or(u64::MAX)
}

fn normalize_token(value: &str) -> String {
    let trimmed = value.trim();
    if cfg!(windows) {
        trimmed.to_lowercase()
    } else {
        trimmed.to_string()
    }
}

fn extract_inbound_port(meta: &ConnectionMetadata) -> Option<u16> {
    if let Some(port) = meta
        .inbound_port
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .and_then(|s| s.parse::<u16>().ok())
        .filter(|&p| p > 0)
    {
        return Some(port);
    }
    meta.inbound_name
        .as_deref()
        .map(str::trim)
        .and_then(|name| name.strip_prefix("in-"))
        .and_then(|s| s.parse::<u16>().ok())
        .filter(|&p| p > 0)
}

fn extract_process_identity(meta: &ConnectionMetadata) -> Option<(String, Option<String>)> {
    let path = meta
        .process_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned);

    let name = meta
        .process
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            path.as_deref()
                .and_then(|p| Path::new(p).file_name())
                .and_then(|n| n.to_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(ToOwned::to_owned)
        })?;

    Some((name, path))
}

fn resolve_process_identity(
    meta: &ConnectionMetadata,
    tree: &mut Option<ProcessTreeSnapshot>,
) -> Option<(String, Option<String>)> {
    let (raw_name, raw_path) = extract_process_identity(meta)?;
    if !is_transient_or_helper_process(&raw_name, raw_path.as_deref()) {
        return Some((raw_name, raw_path));
    }
    let snapshot = tree.get_or_insert_with(ProcessTreeSnapshot::capture_live);
    snapshot.resolve_transient(meta, raw_path.as_deref())
}

fn prune_transient_records(records: &mut BTreeMap<u16, Vec<PortProcessRecord>>) -> bool {
    let mut pruned = false;
    records.retain(|_, list| {
        let before = list.len();
        list.retain(|rec| !is_transient_or_helper_process(&rec.process_name, rec.process_path.as_deref()));
        if list.len() != before {
            pruned = true;
        }
        !list.is_empty()
    });
    pruned
}

fn records_match(record: &PortProcessRecord, name: &str, path: Option<&str>) -> bool {
    match (record.process_path.as_deref(), path) {
        (Some(rp), Some(np)) => normalize_token(rp) == normalize_token(np),
        _ => normalize_token(&record.process_name) == normalize_token(name),
    }
}

fn process_usage_key(name: &str, path: Option<&str>) -> String {
    if let Some(p) = path {
        format!("path:{}", normalize_token(p))
    } else {
        format!("name:{}", normalize_token(name))
    }
}

#[derive(Default)]
struct ProcessHistoryState {
    records: BTreeMap<u16, Vec<PortProcessRecord>>,
    seen_conn_ids: HashSet<String>,
    generation: u64,
    persisted_generation: u64,
    last_persisted_at: u64,
    last_file_stamp: Option<(SystemTime, u64)>,
}

pub struct PortProcessHistoryStore {
    state: RwLock<ProcessHistoryState>,
    storage_path: PathBuf,
    persist_lock: Mutex<()>,
}

impl PortProcessHistoryStore {
    pub fn new(app_dir: &Path) -> Self {
        let storage_path = app_dir.join("port_process_history.json");
        let (records, pruned) = match Self::load_from_disk(&storage_path) {
            Some((parsed, was_pruned)) => {
                if was_pruned {
                    let _ = serde_json::to_string_pretty(&parsed)
                        .ok()
                        .and_then(|json| atomic_write_file(&storage_path, json.as_bytes()).ok());
                }
                (parsed, was_pruned)
            }
            None => (BTreeMap::new(), false),
        };
        let last_file_stamp = Self::file_stamp(&storage_path);
        Self {
            state: RwLock::new(ProcessHistoryState {
                records,
                seen_conn_ids: HashSet::new(),
                generation: u64::from(pruned),
                persisted_generation: u64::from(pruned),
                last_persisted_at: 0,
                last_file_stamp,
            }),
            storage_path,
            persist_lock: Mutex::new(()),
        }
    }

    fn file_stamp(path: &Path) -> Option<(SystemTime, u64)> {
        let meta = std::fs::metadata(path).ok()?;
        let modified = meta.modified().ok()?;
        Some((modified, meta.len()))
    }

    fn load_from_disk(path: &Path) -> Option<(BTreeMap<u16, Vec<PortProcessRecord>>, bool)> {
        if !path.exists() {
            return None;
        }
        match std::fs::read_to_string(path) {
            Ok(content) => match serde_json::from_str::<BTreeMap<u16, Vec<PortProcessRecord>>>(&content) {
                Ok(mut parsed) => {
                    let pruned = prune_transient_records(&mut parsed);
                    Some((parsed, pruned))
                }
                Err(e) => {
                    warn!("Failed to parse port_process_history.json: {}", e);
                    None
                }
            },
            Err(e) => {
                warn!("Failed to read port_process_history.json: {}", e);
                None
            }
        }
    }

    fn sync_from_disk_locked(&self, guard: &mut ProcessHistoryState) {
        let disk_stamp = Self::file_stamp(&self.storage_path);
        if disk_stamp == guard.last_file_stamp {
            return;
        }
        match disk_stamp {
            Some(_) => {
                if let Some((disk_records, _)) = Self::load_from_disk(&self.storage_path) {
                    guard.records = disk_records;
                    guard.last_file_stamp = disk_stamp;
                    guard.persisted_generation = guard.generation;
                }
            }
            None => {
                guard.records.clear();
                guard.last_file_stamp = None;
                guard.persisted_generation = guard.generation;
            }
        }
    }

    fn sync_from_disk_if_changed(&self) {
        let disk_stamp = Self::file_stamp(&self.storage_path);
        if disk_stamp == self.state.read().last_file_stamp {
            return;
        }
        let mut guard = self.state.write();
        self.sync_from_disk_locked(&mut guard);
    }

    fn write_snapshot(
        &self,
        records: &BTreeMap<u16, Vec<PortProcessRecord>>,
        generation: u64,
        now_ms: u64,
    ) -> AppResult<()> {
        let _persist_guard = self.persist_lock.lock();
        {
            let guard = self.state.read();
            if guard.persisted_generation >= generation {
                return Ok(());
            }
        }

        let json = serde_json::to_string_pretty(records).map_err(|e| {
            AppError::Internal(crate::tr!(
                format!("序列化端口进程历史失败: {e}"),
                format!("Failed to serialize port process history: {e}"),
            ))
        })?;
        atomic_write_file(&self.storage_path, json.as_bytes())?;

        let stamp = Self::file_stamp(&self.storage_path);
        let mut guard = self.state.write();
        if guard.persisted_generation < generation {
            guard.persisted_generation = generation;
            guard.last_persisted_at = now_ms;
        }
        guard.last_file_stamp = stamp;
        Ok(())
    }

    /// Merges a live Mihomo connections snapshot into historical records for the given configured ports.
    pub fn record_snapshot(&self, snapshot: &ConnectionSnapshot, allowed_ports: &HashSet<u16>) {
        self.record_snapshot_at(snapshot, allowed_ports, now_epoch_ms());
    }

    pub fn record_snapshot_at(&self, snapshot: &ConnectionSnapshot, allowed_ports: &HashSet<u16>, now_ms: u64) {
        let mut lazy_tree: Option<ProcessTreeSnapshot> = None;
        self.record_snapshot_with_tree_at(snapshot, allowed_ports, now_ms, &mut lazy_tree);
    }

    pub(crate) fn record_snapshot_with_tree_at(
        &self,
        snapshot: &ConnectionSnapshot,
        allowed_ports: &HashSet<u16>,
        now_ms: u64,
        tree: &mut Option<ProcessTreeSnapshot>,
    ) {
        let mut guard = self.state.write();
        let active_ids: HashSet<&str> = snapshot.connections.iter().map(|c| c.id.as_str()).collect();
        guard.seen_conn_ids.retain(|id| active_ids.contains(id.as_str()));
        let mut mutated = false;
        let mut touched_ports: HashSet<u16> = HashSet::new();

        for conn in &snapshot.connections {
            let Some(port) = extract_inbound_port(&conn.metadata) else {
                continue;
            };
            if !allowed_ports.contains(&port) {
                continue;
            }
            let Some((proc_name, proc_path)) = resolve_process_identity(&conn.metadata, tree) else {
                continue;
            };
            let is_new_conn = guard.seen_conn_ids.insert(conn.id.clone());
            let norm_path = proc_path.as_deref().map(normalize_token);
            let norm_name = normalize_token(&proc_name);
            let list = guard.records.entry(port).or_default();

            if let Some(existing) = list.iter_mut().find(|item| match (&item.process_path, &norm_path) {
                (Some(rp), Some(np)) => normalize_token(rp) == *np,
                _ => normalize_token(&item.process_name) == norm_name,
            }) {
                let should_touch_last_seen = now_ms > existing.last_seen_at
                    && (is_new_conn
                        || now_ms.saturating_sub(existing.last_seen_at) >= LAST_SEEN_TOUCH_INTERVAL_MS);
                if should_touch_last_seen {
                    existing.last_seen_at = now_ms;
                    mutated = true;
                    touched_ports.insert(port);
                }
                if existing.process_path.is_none() && proc_path.is_some() {
                    existing.process_path = proc_path;
                    existing.process_name = proc_name;
                    mutated = true;
                    touched_ports.insert(port);
                }
                if is_new_conn {
                    existing.hit_count = existing.hit_count.saturating_add(1);
                    mutated = true;
                }
            } else {
                list.push(PortProcessRecord {
                    process_name: proc_name,
                    process_path: proc_path,
                    first_seen_at: now_ms,
                    last_seen_at: now_ms,
                    hit_count: 1,
                });
                mutated = true;
                touched_ports.insert(port);
            }
        }

        for port in touched_ports {
            if let Some(list) = guard.records.get_mut(&port) {
                list.sort_by(|a, b| {
                    b.last_seen_at
                        .cmp(&a.last_seen_at)
                        .then_with(|| a.process_name.cmp(&b.process_name))
                });
                if list.len() > MAX_PROCESS_RECORDS_PER_PORT {
                    list.truncate(MAX_PROCESS_RECORDS_PER_PORT);
                }
            }
        }
        if mutated {
            guard.generation = guard.generation.saturating_add(1);
        }
    }

    /// Returns merged process usage (active connections + historical records) for `port`.
    pub fn get_port_usage(&self, port: u16, live_snapshot: Option<&ConnectionSnapshot>) -> Vec<PortProcessUsageItem> {
        self.sync_from_disk_if_changed();
        let mut active_counts: HashMap<String, (String, Option<String>, u32)> = HashMap::new();
        let mut lazy_tree: Option<ProcessTreeSnapshot> = None;

        if let Some(snapshot) = live_snapshot {
            for conn in &snapshot.connections {
                if extract_inbound_port(&conn.metadata) != Some(port) {
                    continue;
                }
                let Some((proc_name, proc_path)) = resolve_process_identity(&conn.metadata, &mut lazy_tree) else {
                    continue;
                };
                let key = process_usage_key(&proc_name, proc_path.as_deref());
                let entry = active_counts.entry(key).or_insert_with(|| (proc_name, proc_path, 0));
                entry.2 = entry.2.saturating_add(1);
            }
        }

        let guard = self.state.read();
        let history = guard.records.get(&port).cloned().unwrap_or_default();
        let mut items: Vec<PortProcessUsageItem> = Vec::with_capacity(history.len());
        let mut matched_active_keys: HashSet<String> = HashSet::new();

        for rec in history {
            let mut active_count: u32 = 0;
            for (key, (act_name, act_path, count)) in &active_counts {
                if records_match(&rec, act_name, act_path.as_deref()) {
                    active_count = active_count.saturating_add(*count);
                    matched_active_keys.insert(key.clone());
                }
            }
            items.push(PortProcessUsageItem {
                process_name: rec.process_name,
                process_path: rec.process_path,
                first_seen_at: rec.first_seen_at,
                last_seen_at: rec.last_seen_at,
                hit_count: rec.hit_count,
                is_active: active_count > 0,
                active_connection_count: active_count,
                icon_data_url: None,
            });
        }

        let now_ms = now_epoch_ms();
        for (key, (act_name, act_path, count)) in active_counts {
            if !matched_active_keys.contains(&key) {
                items.push(PortProcessUsageItem {
                    process_name: act_name,
                    process_path: act_path,
                    first_seen_at: now_ms,
                    last_seen_at: now_ms,
                    hit_count: u64::from(count),
                    is_active: true,
                    active_connection_count: count,
                    icon_data_url: None,
                });
            }
        }

        items.sort_by(|a, b| {
            b.is_active
                .cmp(&a.is_active)
                .then_with(|| b.last_seen_at.cmp(&a.last_seen_at))
                .then_with(|| a.process_name.cmp(&b.process_name))
        });

        items
    }

    pub fn clear_port(&self, port: u16) -> AppResult<()> {
        let now_ms = now_epoch_ms();
        let payload = {
            let mut guard = self.state.write();
            self.sync_from_disk_locked(&mut guard);
            if guard.records.remove(&port).is_some() {
                guard.generation = guard.generation.saturating_add(1);
                Some((guard.records.clone(), guard.generation))
            } else {
                None
            }
        };

        if let Some((records, generation)) = payload {
            self.write_snapshot(&records, generation, now_ms)?;
        }
        Ok(())
    }

    pub fn flush(&self) -> AppResult<()> {
        let now_ms = now_epoch_ms();
        let payload = {
            let guard = self.state.read();
            if guard.generation > guard.persisted_generation {
                Some((guard.records.clone(), guard.generation))
            } else {
                None
            }
        };

        if let Some((records, generation)) = payload {
            self.write_snapshot(&records, generation, now_ms)?;
        }
        Ok(())
    }

    pub fn all_process_paths(&self) -> Vec<String> {
        self.sync_from_disk_if_changed();
        let guard = self.state.read();
        guard
            .records
            .values()
            .flat_map(|list| list.iter().filter_map(|r| r.process_path.clone()))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ConnectionItem;

    fn make_conn(id: &str, port: u16, process: Option<&str>, path: Option<&str>) -> ConnectionItem {
        ConnectionItem {
            id: id.to_string(),
            metadata: ConnectionMetadata {
                network: "tcp".to_string(),
                connection_type: "HTTP".to_string(),
                source_ip: "127.0.0.1".to_string(),
                source_port: "50000".to_string(),
                destination_ip: "1.1.1.1".to_string(),
                destination_port: "443".to_string(),
                inbound_port: Some(port.to_string()),
                inbound_name: Some(format!("in-{port}")),
                process: process.map(ToOwned::to_owned),
                process_path: path.map(ToOwned::to_owned),
                ..ConnectionMetadata::default()
            },
            upload: 0,
            download: 0,
            start: "2026-11-20T00:00:00Z".to_string(),
            chains: vec!["DIRECT".to_string()],
            rule: format!("IN-PORT,{port},DIRECT"),
            rule_payload: None,
        }
    }

    #[test]
    fn records_dedup_across_snapshots_and_keeps_ports_isolated() {
        let temp_dir = std::env::temp_dir().join(format!("mhm_proc_hist_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).expect("create temp dir");

        let store = PortProcessHistoryStore::new(&temp_dir);
        let allowed: HashSet<u16> = [7891, 7892].into_iter().collect();

        // Snapshot 1: chrome uses 7891, ignores unconfigured 9999 and empty process
        let snap1 = ConnectionSnapshot {
            connections: vec![
                make_conn("c1", 7891, Some("chrome.exe"), Some(r"C:\Chrome\chrome.exe")),
                make_conn("c2", 9999, Some("curl.exe"), Some(r"C:\curl\curl.exe")),
                make_conn("c3", 7891, None, None),
            ],
            ..ConnectionSnapshot::default()
        };
        store.record_snapshot_at(&snap1, &allowed, 1_000);

        // Snapshot 2: same c1 still open + c4 opens on 7892 with same chrome binary (proxy pool)
        let snap2 = ConnectionSnapshot {
            connections: vec![
                make_conn("c1", 7891, Some("chrome.exe"), Some(r"C:\Chrome\chrome.exe")),
                make_conn("c4", 7892, Some("chrome.exe"), Some(r"C:\Chrome\chrome.exe")),
            ],
            ..ConnectionSnapshot::default()
        };
        store.record_snapshot_at(&snap2, &allowed, 2_000);

        // Both ports retain their own independent chrome record
        let usage_7891 = store.get_port_usage(7891, None);
        assert_eq!(usage_7891.len(), 1);
        assert_eq!(usage_7891[0].process_name, "chrome.exe");
        assert_eq!(usage_7891[0].hit_count, 1); // c1 counted once across two snapshots
        assert_eq!(usage_7891[0].first_seen_at, 1_000);
        // Unchanged connection within 60s window does not dirty last_seen_at
        assert_eq!(usage_7891[0].last_seen_at, 1_000);

        // Advancing past LAST_SEEN_TOUCH_INTERVAL_MS updates last_seen_at
        store.record_snapshot_at(&snap2, &allowed, 62_000);
        let usage_7891_later = store.get_port_usage(7891, None);
        assert_eq!(usage_7891_later[0].last_seen_at, 62_000);
        let usage_7892 = store.get_port_usage(7892, Some(&snap2));
        assert_eq!(usage_7892.len(), 1);
        assert!(usage_7892[0].is_active);
        assert_eq!(usage_7892[0].active_connection_count, 1);

        assert!(store.get_port_usage(9999, None).is_empty());

        // Reload from disk verifies persistence
        store.flush().expect("flush");
        let reloaded = PortProcessHistoryStore::new(&temp_dir);
        assert_eq!(reloaded.get_port_usage(7891, None).len(), 1);
        assert_eq!(reloaded.get_port_usage(7892, None).len(), 1);

        // Clear port 7891 does not affect 7892
        reloaded.clear_port(7891).expect("clear port");
        assert!(reloaded.get_port_usage(7891, None).is_empty());
        assert_eq!(reloaded.get_port_usage(7892, None).len(), 1);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn enforces_max_records_per_port_and_upgrades_missing_path() {
        let temp_dir = std::env::temp_dir().join(format!("mhm_proc_cap_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).expect("create temp dir");

        let store = PortProcessHistoryStore::new(&temp_dir);
        let allowed: HashSet<u16> = [7891].into_iter().collect();

        // First record without path, then upgrade with path
        let snap_no_path = ConnectionSnapshot {
            connections: vec![make_conn("a1", 7891, Some("app.exe"), None)],
            ..ConnectionSnapshot::default()
        };
        store.record_snapshot_at(&snap_no_path, &allowed, 100);
        let snap_with_path = ConnectionSnapshot {
            connections: vec![make_conn("a2", 7891, Some("app.exe"), Some(r"C:\Apps\app.exe"))],
            ..ConnectionSnapshot::default()
        };
        store.record_snapshot_at(&snap_with_path, &allowed, 200);
        let usage = store.get_port_usage(7891, None);
        assert_eq!(usage.len(), 1);
        assert_eq!(usage[0].process_path.as_deref(), Some(r"C:\Apps\app.exe"));
        assert_eq!(usage[0].hit_count, 2);

        // Exceed cap
        let mut conns = Vec::new();
        for idx in 0..60u64 {
            conns.push(make_conn(
                &format!("p-{idx}"),
                7891,
                Some(&format!("proc-{idx}.exe")),
                Some(&format!(r"C:\Bin\proc-{idx}.exe")),
            ));
        }
        store.record_snapshot_at(
            &ConnectionSnapshot {
                connections: conns,
                ..ConnectionSnapshot::default()
            },
            &allowed,
            500,
        );
        assert_eq!(store.get_port_usage(7891, None).len(), MAX_PROCESS_RECORDS_PER_PORT);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn hot_reloads_when_history_file_changes_externally() {
        let temp_dir = std::env::temp_dir().join(format!("mhm_proc_hot_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).expect("create temp dir");

        let store = PortProcessHistoryStore::new(&temp_dir);
        assert!(store.get_port_usage(17893, None).is_empty());

        let external = serde_json::json!({
            "17893": [
                {
                    "processName": "chrome.exe",
                    "processPath": "C:\\Chrome\\chrome.exe",
                    "firstSeenAt": 1000,
                    "lastSeenAt": 2000,
                    "hitCount": 42
                },
                {
                    "processName": "Cursor.exe",
                    "processPath": "C:\\Cursor\\Cursor.exe",
                    "firstSeenAt": 1000,
                    "lastSeenAt": 1500,
                    "hitCount": 12
                }
            ]
        });
        std::fs::write(
            temp_dir.join("port_process_history.json"),
            serde_json::to_string_pretty(&external).expect("serialize external"),
        )
        .expect("write external file");

        let usage = store.get_port_usage(17893, None);
        assert_eq!(usage.len(), 2);
        assert_eq!(usage[0].process_name, "chrome.exe");
        assert_eq!(usage[1].process_name, "Cursor.exe");

        // Recording a new live connection preserves external records instead of overwriting them
        let allowed: HashSet<u16> = [17893].into_iter().collect();
        store.record_snapshot_at(
            &ConnectionSnapshot {
                connections: vec![make_conn("live-1", 17893, Some("firefox.exe"), None)],
                ..ConnectionSnapshot::default()
            },
            &allowed,
            3_000,
        );
        let merged = store.get_port_usage(17893, None);
        assert_eq!(merged.len(), 3);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn resolves_child_process_to_parent_and_drops_unresolved_noise() {
        use crate::core::process_resolver::ProcessNode;
        use std::net::{IpAddr, Ipv4Addr};

        let temp_dir = std::env::temp_dir().join(format!("mhm_proc_smart_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).expect("create temp dir");

        let store = PortProcessHistoryStore::new(&temp_dir);
        let allowed: HashSet<u16> = [7891].into_iter().collect();

        let mut procs = HashMap::new();
        procs.insert(
            100,
            ProcessNode {
                parent_pid: None,
                name: "Code.exe".to_string(),
                path: Some(r"C:\VSCode\Code.exe".to_string()),
            },
        );
        procs.insert(
            200,
            ProcessNode {
                parent_pid: Some(100),
                name: "node.exe".to_string(),
                path: Some(r"C:\Node\node.exe".to_string()),
            },
        );
        let mut tcp = HashMap::new();
        tcp.insert((IpAddr::V4(Ipv4Addr::LOCALHOST), 50000), 200);

        let mut mock_tree = Some(ProcessTreeSnapshot::from_parts(procs, tcp, HashMap::new()));

        let mut orphan_curl = make_conn("c-curl", 7891, Some("curl.exe"), Some(r"C:\Windows\System32\curl.exe"));
        orphan_curl.metadata.source_port = "50001".to_string();
        let mut orphan_lsp = make_conn("c-lsp", 7891, Some("typescript-language-server.exe"), None);
        orphan_lsp.metadata.source_port = "50002".to_string();

        let snap = ConnectionSnapshot {
            connections: vec![
                make_conn("c-node", 7891, Some("node.exe"), Some(r"C:\Node\node.exe")),
                orphan_curl,
                orphan_lsp,
            ],
            ..ConnectionSnapshot::default()
        };

        store.record_snapshot_with_tree_at(&snap, &allowed, 1_000, &mut mock_tree);
        let usage = store.get_port_usage(7891, None);
        assert_eq!(usage.len(), 1);
        assert_eq!(usage[0].process_name, "Code.exe");
        assert_eq!(usage[0].process_path.as_deref(), Some(r"C:\VSCode\Code.exe"));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn prunes_transient_records_on_load_from_disk() {
        let temp_dir = std::env::temp_dir().join(format!("mhm_proc_prune_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).expect("create temp dir");

        let legacy = serde_json::json!({
            "7891": [
                {
                    "processName": "chrome.exe",
                    "processPath": "C:\\Chrome\\chrome.exe",
                    "firstSeenAt": 1000,
                    "lastSeenAt": 2000,
                    "hitCount": 10
                },
                {
                    "processName": "curl.exe",
                    "processPath": "C:\\Windows\\System32\\curl.exe",
                    "firstSeenAt": 1000,
                    "lastSeenAt": 2000,
                    "hitCount": 5
                },
                {
                    "processName": "node.exe",
                    "processPath": "C:\\Node\\node.exe",
                    "firstSeenAt": 1000,
                    "lastSeenAt": 2000,
                    "hitCount": 3
                },
                {
                    "processName": "yaml-language-server.exe",
                    "processPath": "C:\\ext\\yaml-language-server.exe",
                    "firstSeenAt": 1000,
                    "lastSeenAt": 2000,
                    "hitCount": 2
                }
            ]
        });
        let file_path = temp_dir.join("port_process_history.json");
        std::fs::write(
            &file_path,
            serde_json::to_string_pretty(&legacy).expect("serialize legacy"),
        )
        .expect("write legacy");

        let store = PortProcessHistoryStore::new(&temp_dir);
        let usage = store.get_port_usage(7891, None);
        assert_eq!(usage.len(), 1);
        assert_eq!(usage[0].process_name, "chrome.exe");

        // Disk file should also be cleaned immediately
        let disk_content = std::fs::read_to_string(&file_path).expect("read cleaned file");
        assert!(!disk_content.contains("curl.exe"));
        assert!(!disk_content.contains("node.exe"));
        assert!(!disk_content.contains("yaml-language-server.exe"));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
