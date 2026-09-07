use crate::core::kernel_engine::KernelControllerAdapter;
use crate::core::profile_manager::atomic_write_file;
use crate::error::{AppError, AppResult};
use crate::models::{LatencyProgressPayload, LatencyUpdatePayload, NodeLatencyResult};
use parking_lot::RwLock;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Notify, Semaphore};

pub const DEFAULT_PROBE_CONCURRENCY: usize = 10;
pub const MAX_PROBE_CONCURRENCY: usize = 32;
pub const MIN_PROBE_CONCURRENCY: usize = 1;
pub const DEFAULT_TEST_TIMEOUT_MS: u32 = 5000;

/// Cancellation token providing thread-safe, async-aware cancellation signaling.
#[derive(Clone, Default)]
pub struct CancellationToken {
    cancelled: Arc<AtomicBool>,
    notify: Arc<Notify>,
}

impl CancellationToken {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    pub async fn cancelled(&self) {
        if self.is_cancelled() {
            return;
        }
        self.notify.notified().await;
    }
}

/// Trait abstracting event emission for real-time latency streams to allow deterministic testing.
pub trait LatencyEventEmitter: Send + Sync {
    fn emit_update(&self, update: &LatencyUpdatePayload);
    fn emit_progress(&self, progress: &LatencyProgressPayload);
}

/// Production event emitter dispatching native Tauri application events.
#[derive(Clone, Default)]
pub struct AppLatencyEventEmitter {
    handle: Arc<RwLock<Option<tauri::AppHandle>>>,
}

impl AppLatencyEventEmitter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_app_handle(&self, handle: tauri::AppHandle) {
        *self.handle.write() = Some(handle);
    }
}

impl LatencyEventEmitter for AppLatencyEventEmitter {
    fn emit_update(&self, update: &LatencyUpdatePayload) {
        if let Some(handle) = self.handle.read().as_ref() {
            use tauri::Emitter;
            let _ = handle.emit("latency-update", update);
        }
    }

    fn emit_progress(&self, progress: &LatencyProgressPayload) {
        if let Some(handle) = self.handle.read().as_ref() {
            use tauri::Emitter;
            let _ = handle.emit("latency-progress", progress);
        }
    }
}

/// Centralized Backend Latency Probe managing concurrency pools, timeout handling,
/// cancellation tokens, authoritative cache persistence, and real-time event streaming.
pub struct LatencyProbe {
    engine: Arc<dyn KernelControllerAdapter>,
    cache: Arc<RwLock<HashMap<String, Option<u32>>>>,
    storage_path: PathBuf,
    emitter: Arc<dyn LatencyEventEmitter>,
    active_token: Arc<RwLock<Option<CancellationToken>>>,
    concurrency_pool: Arc<Semaphore>,
    persist_lock: Arc<parking_lot::Mutex<()>>,
}

impl LatencyProbe {
    pub fn new(
        engine: Arc<dyn KernelControllerAdapter>,
        app_dir: &Path,
        emitter: Arc<dyn LatencyEventEmitter>,
    ) -> Self {
        let storage_path = app_dir.join("latencies.json");
        let initial_cache = Self::load_cache_from_disk(&storage_path);

        Self {
            engine,
            cache: Arc::new(RwLock::new(initial_cache)),
            storage_path,
            emitter,
            active_token: Arc::new(RwLock::new(None)),
            concurrency_pool: Arc::new(Semaphore::new(DEFAULT_PROBE_CONCURRENCY)),
            persist_lock: Arc::new(parking_lot::Mutex::new(())),
        }
    }

    /// Load persisted latencies from disk
    fn load_cache_from_disk(path: &Path) -> HashMap<String, Option<u32>> {
        if !path.exists() {
            return HashMap::new();
        }
        match std::fs::read_to_string(path) {
            Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
            Err(e) => {
                log::warn!("Failed to read latency cache from {:?}: {}", path, e);
                HashMap::new()
            }
        }
    }

    /// Persist in-memory latencies to disk atomically
    pub fn persist_cache(&self) -> AppResult<()> {
        let _guard = self.persist_lock.lock();
        let snapshot = self.cache.read().clone();
        let json = serde_json::to_string_pretty(&snapshot)?;
        atomic_write_file(&self.storage_path, json.as_bytes())?;
        Ok(())
    }

    /// Retrieve all authoritative latencies from the centralized cache
    pub fn get_latencies(&self) -> HashMap<String, Option<u32>> {
        self.cache.read().clone()
    }

    /// Retrieve latency for a specific node
    pub fn get_latency(&self, name: &str) -> Option<Option<u32>> {
        self.cache.read().get(name).copied()
    }

    /// Manually update or record a latency in the authoritative cache with diff guard
    pub fn set_latency(&self, name: &str, latency: Option<u32>) {
        let changed = {
            let mut cache = self.cache.write();
            if cache.get(name).copied() != Some(latency) {
                cache.insert(name.to_string(), latency);
                true
            } else {
                false
            }
        };
        if changed {
            let _ = self.persist_cache();
        }
    }

    /// Batch update latencies with diff guard, triggering disk persist at most once
    pub fn set_latencies_batch(&self, updates: &[(String, Option<u32>)]) {
        if updates.is_empty() {
            return;
        }
        let mut changed = false;
        {
            let mut cache = self.cache.write();
            for (name, latency) in updates {
                if cache.get(name).copied() != Some(*latency) {
                    cache.insert(name.clone(), *latency);
                    changed = true;
                }
            }
        }
        if changed {
            let _ = self.persist_cache();
        }
    }

    /// Clear all cached latencies
    pub fn clear_latencies(&self) {
        self.cache.write().clear();
        let _ = self.persist_cache();
    }

    /// Cancel any ongoing latency tests
    pub fn cancel_tests(&self) {
        let mut guard = self.active_token.write();
        if let Some(token) = guard.take() {
            token.cancel();
            self.emitter.emit_progress(&LatencyProgressPayload {
                is_testing: false,
                total: 0,
                completed: 0,
            });
        }
    }

    /// Returns true if a batch or probe test is currently active
    pub fn is_testing(&self) -> bool {
        self.active_token
            .read()
            .as_ref()
            .map(|t| !t.is_cancelled())
            .unwrap_or(false)
    }

    /// Probe latency for a single node with timeout handling and stream event emission
    pub async fn test_node(
        &self,
        node_name: &str,
        runtime_name: Option<&str>,
        test_url: Option<&str>,
        timeout_ms: Option<u32>,
        mapping_id: Option<&str>,
    ) -> AppResult<u32> {
        let target_timeout = timeout_ms.unwrap_or(DEFAULT_TEST_TIMEOUT_MS);
        let actual_url = test_url.map(|s| s.to_string());

        // Acquire permit from bounded concurrency pool
        let _permit = self
            .concurrency_pool
            .acquire()
            .await
            .map_err(|e| AppError::Internal(format!("Semaphore acquire failed: {}", e)))?;

        let probe_target = runtime_name.unwrap_or(node_name);

        let timeout_duration = Duration::from_millis(u64::from(target_timeout) + 1500);
        let test_fut = self
            .engine
            .test_delay(probe_target, actual_url.as_deref(), Some(target_timeout));

        let res = match tokio::time::timeout(timeout_duration, test_fut).await {
            Ok(inner_res) => inner_res,
            Err(_) => Err(AppError::ExternalController(format!(
                "Latency test timed out after {}ms",
                target_timeout
            ))),
        };

        match res {
            Ok(delay) => {
                {
                    let mut guard = self.cache.write();
                    guard.insert(node_name.to_string(), Some(delay));
                    if let Some(rt) = runtime_name {
                        guard.insert(rt.to_string(), Some(delay));
                    }
                }
                let _ = self.persist_cache();

                self.emitter.emit_update(&LatencyUpdatePayload {
                    name: node_name.to_string(),
                    runtime_name: runtime_name.map(|s| s.to_string()),
                    latency: Some(delay),
                    error: None,
                    mapping_id: mapping_id.map(|s| s.to_string()),
                    completed: 1,
                    total: 1,
                });

                Ok(delay)
            }
            Err(err) => {
                let err_msg = err.to_string();
                {
                    let mut guard = self.cache.write();
                    guard.insert(node_name.to_string(), None);
                    if let Some(rt) = runtime_name {
                        guard.insert(rt.to_string(), None);
                    }
                }
                let _ = self.persist_cache();

                self.emitter.emit_update(&LatencyUpdatePayload {
                    name: node_name.to_string(),
                    runtime_name: runtime_name.map(|s| s.to_string()),
                    latency: None,
                    error: Some(err_msg.clone()),
                    mapping_id: mapping_id.map(|s| s.to_string()),
                    completed: 1,
                    total: 1,
                });

                Err(err)
            }
        }
    }

    /// Probe latency for a batch of nodes concurrently using a bounded semaphore pool,
    /// timeout handling, cancellation tokens, and real-time stream event emission.
    pub async fn test_nodes_batch(
        &self,
        nodes: &[BatchProbeTarget],
        test_url: Option<&str>,
        timeout_ms: Option<u32>,
        concurrency: Option<usize>,
    ) -> Vec<NodeLatencyResult> {
        if nodes.is_empty() {
            return Vec::new();
        }

        // Cancel previous active run if any
        self.cancel_tests();

        let token = CancellationToken::new();
        {
            *self.active_token.write() = Some(token.clone());
        }

        let bounded_concurrency = concurrency
            .unwrap_or(DEFAULT_PROBE_CONCURRENCY)
            .clamp(MIN_PROBE_CONCURRENCY, MAX_PROBE_CONCURRENCY);

        let semaphore = Arc::new(Semaphore::new(bounded_concurrency));
        let total = nodes.len();
        let completed_counter = Arc::new(std::sync::atomic::AtomicUsize::new(0));

        self.emitter.emit_progress(&LatencyProgressPayload {
            is_testing: true,
            total,
            completed: 0,
        });

        let target_timeout = timeout_ms.unwrap_or(DEFAULT_TEST_TIMEOUT_MS);
        let actual_url = test_url.map(|s| s.to_string());

        let mut join_set = tokio::task::JoinSet::new();

        for (index, target) in nodes.iter().cloned().enumerate() {
            let engine = self.engine.clone();
            let token = token.clone();
            let sem = semaphore.clone();
            let emitter = self.emitter.clone();
            let cache = self.cache.clone();
            let counter = completed_counter.clone();
            let url_opt = actual_url.clone();

            join_set.spawn(async move {
                // If cancelled before acquiring permit, exit early
                if token.is_cancelled() {
                    return (
                        index,
                        target.name.clone(),
                        target.runtime_name.clone(),
                        target.mapping_id.clone(),
                        None,
                        Some("Cancelled".to_string()),
                    );
                }

                // Acquire bounded concurrency permit
                let _permit = match sem.acquire().await {
                    Ok(p) => p,
                    Err(_) => {
                        return (
                            index,
                            target.name.clone(),
                            target.runtime_name.clone(),
                            target.mapping_id.clone(),
                            None,
                            Some("Semaphore closed".to_string()),
                        );
                    }
                };

                // Check again after acquiring permit
                if token.is_cancelled() {
                    return (
                        index,
                        target.name.clone(),
                        target.runtime_name.clone(),
                        target.mapping_id.clone(),
                        None,
                        Some("Cancelled".to_string()),
                    );
                }

                // Slight stagger to prevent socket connection spikes
                if index > 0 {
                    let stagger_ms = ((index % 8) as u64) * 20;
                    tokio::time::sleep(Duration::from_millis(stagger_ms)).await;
                }

                if token.is_cancelled() {
                    return (
                        index,
                        target.name.clone(),
                        target.runtime_name.clone(),
                        target.mapping_id.clone(),
                        None,
                        Some("Cancelled".to_string()),
                    );
                }

                let probe_target = target
                    .runtime_name
                    .as_deref()
                    .unwrap_or(target.name.as_str());
                let timeout_duration = Duration::from_millis(u64::from(target_timeout) + 1500);
                let test_fut =
                    engine.test_delay(probe_target, url_opt.as_deref(), Some(target_timeout));

                let result = match tokio::time::timeout(timeout_duration, test_fut).await {
                    Ok(res) => res,
                    Err(_) => Err(AppError::ExternalController(format!(
                        "Latency test timed out after {}ms",
                        target_timeout
                    ))),
                };

                let (latency, error) = match result {
                    Ok(delay) => (Some(delay), None),
                    Err(err) => (None, Some(err.to_string())),
                };

                // Update authoritative in-memory cache
                {
                    let mut guard = cache.write();
                    guard.insert(target.name.clone(), latency);
                    if let Some(rt) = &target.runtime_name {
                        guard.insert(rt.clone(), latency);
                    }
                }

                let completed = counter.fetch_add(1, Ordering::SeqCst) + 1;

                // Stream real-time node latency update
                emitter.emit_update(&LatencyUpdatePayload {
                    name: target.name.clone(),
                    runtime_name: target.runtime_name.clone(),
                    latency,
                    error: error.clone(),
                    mapping_id: target.mapping_id.clone(),
                    completed,
                    total,
                });

                // Stream overall progress update
                emitter.emit_progress(&LatencyProgressPayload {
                    is_testing: true,
                    total,
                    completed,
                });

                (
                    index,
                    target.name,
                    target.runtime_name,
                    target.mapping_id,
                    latency,
                    error,
                )
            });
        }

        let mut results_indexed = Vec::with_capacity(total);
        while let Some(res) = join_set.join_next().await {
            if let Ok(entry) = res {
                results_indexed.push(entry);
            }
        }

        // Sort by original submission order
        results_indexed.sort_by_key(|e| e.0);

        let final_results: Vec<NodeLatencyResult> = results_indexed
            .into_iter()
            .map(|(_, name, _, _, latency, error)| NodeLatencyResult {
                name,
                latency,
                error,
            })
            .collect();

        // Persist all accumulated latencies to disk atomically
        let _ = self.persist_cache();

        // Mark testing finished
        {
            let mut guard = self.active_token.write();
            if guard.as_ref().map(|t| t.is_cancelled()).unwrap_or(false)
                || guard.is_some()
            {
                *guard = None;
            }
        }

        self.emitter.emit_progress(&LatencyProgressPayload {
            is_testing: false,
            total,
            completed: completed_counter.load(Ordering::SeqCst),
        });

        final_results
    }
}

/// Target specification for a batch latency probe
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BatchProbeTarget {
    pub name: String,
    pub runtime_name: Option<String>,
    pub mapping_id: Option<String>,
}

impl BatchProbeTarget {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            runtime_name: None,
            mapping_id: None,
        }
    }

    pub fn with_runtime_name(mut self, runtime_name: impl Into<String>) -> Self {
        self.runtime_name = Some(runtime_name.into());
        self
    }

    pub fn with_mapping_id(mut self, mapping_id: impl Into<String>) -> Self {
        self.mapping_id = Some(mapping_id.into());
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::kernel_engine::FakeControllerAdapter;
    use parking_lot::Mutex;

    #[derive(Default)]
    struct MockLatencyEventEmitter {
        updates: Arc<Mutex<Vec<LatencyUpdatePayload>>>,
        progress: Arc<Mutex<Vec<LatencyProgressPayload>>>,
    }

    impl MockLatencyEventEmitter {
        fn new() -> Self {
            Self::default()
        }
    }

    impl LatencyEventEmitter for MockLatencyEventEmitter {
        fn emit_update(&self, update: &LatencyUpdatePayload) {
            self.updates.lock().push(update.clone());
        }

        fn emit_progress(&self, progress: &LatencyProgressPayload) {
            self.progress.lock().push(progress.clone());
        }
    }

    #[tokio::test]
    async fn test_cancellation_token_cancel_and_wait() {
        let token = CancellationToken::new();
        assert!(!token.is_cancelled());

        let token_clone = token.clone();
        let handle = tokio::spawn(async move {
            token_clone.cancelled().await;
            true
        });

        tokio::time::sleep(Duration::from_millis(10)).await;
        assert!(!token.is_cancelled());

        token.cancel();
        assert!(token.is_cancelled());

        let result = tokio::time::timeout(Duration::from_millis(200), handle)
            .await
            .expect("Join handle timeout")
            .expect("Join error");
        assert!(result);
    }

    #[tokio::test]
    async fn test_authoritative_cache_persistence_and_clear() {
        let temp_dir = std::env::temp_dir().join(format!("test_cache_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let fake_adapter = Arc::new(FakeControllerAdapter::new());
        let emitter = Arc::new(MockLatencyEventEmitter::new());

        let probe = LatencyProbe::new(fake_adapter, &temp_dir, emitter);
        assert!(probe.get_latencies().is_empty());

        probe.set_latency("Node-A", Some(42));
        probe.set_latency("Node-B", None);

        assert_eq!(probe.get_latency("Node-A"), Some(Some(42)));
        assert_eq!(probe.get_latency("Node-B"), Some(None));

        // Verify loaded from disk on new instance
        let fake_adapter2 = Arc::new(FakeControllerAdapter::new());
        let emitter2 = Arc::new(MockLatencyEventEmitter::new());
        let probe2 = LatencyProbe::new(fake_adapter2, &temp_dir, emitter2);

        assert_eq!(probe2.get_latency("Node-A"), Some(Some(42)));
        assert_eq!(probe2.get_latency("Node-B"), Some(None));

        probe2.clear_latencies();
        assert!(probe2.get_latencies().is_empty());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_single_node_probe_success_and_error() {
        let temp_dir = std::env::temp_dir().join(format!("test_probe_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let fake_adapter = Arc::new(FakeControllerAdapter::new());
        fake_adapter.set_node_delay("Good-Node", 35);
        fake_adapter.set_node_error("Bad-Node", "Connection timeout");

        let emitter = Arc::new(MockLatencyEventEmitter::new());
        let probe = LatencyProbe::new(fake_adapter, &temp_dir, emitter.clone());

        // Test Good-Node
        let res = probe
            .test_node("Good-Node", Some("[Profile] Good-Node"), None, None, Some("port-1"))
            .await;
        assert_eq!(res.unwrap(), 35);
        assert_eq!(probe.get_latency("Good-Node"), Some(Some(35)));
        assert_eq!(probe.get_latency("[Profile] Good-Node"), Some(Some(35)));

        // Test Bad-Node
        let err_res = probe
            .test_node("Bad-Node", None, None, None, None)
            .await;
        assert!(err_res.is_err());
        assert_eq!(probe.get_latency("Bad-Node"), Some(None));

        // Check events emitted
        let updates = emitter.updates.lock().clone();
        assert_eq!(updates.len(), 2);
        assert_eq!(updates[0].name, "Good-Node");
        assert_eq!(updates[0].latency, Some(35));
        assert_eq!(updates[0].mapping_id.as_deref(), Some("port-1"));

        assert_eq!(updates[1].name, "Bad-Node");
        assert_eq!(updates[1].latency, None);
        assert!(updates[1].error.is_some());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_batch_nodes_bounded_concurrency_and_streaming() {
        let temp_dir = std::env::temp_dir().join(format!("test_batch_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let fake_adapter = Arc::new(FakeControllerAdapter::new());
        for i in 1..=8 {
            fake_adapter.set_node_delay(&format!("Node-{}", i), (i * 10) as u32);
        }

        let emitter = Arc::new(MockLatencyEventEmitter::new());
        let probe = LatencyProbe::new(fake_adapter, &temp_dir, emitter.clone());

        let targets: Vec<BatchProbeTarget> = (1..=8)
            .map(|i| {
                BatchProbeTarget::new(format!("Node-{}", i))
                    .with_runtime_name(format!("[Profile] Node-{}", i))
            })
            .collect();

        // Bounded concurrency pool = 2
        let results = probe
            .test_nodes_batch(&targets, None, None, Some(2))
            .await;

        assert_eq!(results.len(), 8);
        for (i, res) in results.iter().enumerate() {
            assert_eq!(res.name, format!("Node-{}", i + 1));
            assert_eq!(res.latency, Some(((i + 1) * 10) as u32));
        }

        // Verify emitted updates in real time
        let updates = emitter.updates.lock().clone();
        assert_eq!(updates.len(), 8);

        // Verify progress updates emitted
        let progress = emitter.progress.lock().clone();
        assert!(!progress.is_empty());
        assert!(progress.first().unwrap().is_testing);
        assert_eq!(progress.first().unwrap().total, 8);
        assert!(!progress.last().unwrap().is_testing);
        assert_eq!(progress.last().unwrap().completed, 8);

        // Verify authoritative cache populated
        assert_eq!(probe.get_latency("Node-3"), Some(Some(30)));
        assert_eq!(probe.get_latency("[Profile] Node-3"), Some(Some(30)));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_batch_nodes_cancellation() {
        let temp_dir = std::env::temp_dir().join(format!("test_cancel_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let fake_adapter = Arc::new(FakeControllerAdapter::new());
        for i in 1..=20 {
            fake_adapter.set_node_delay(&format!("Node-{}", i), 50);
        }

        let emitter = Arc::new(MockLatencyEventEmitter::new());
        let probe = Arc::new(LatencyProbe::new(fake_adapter, &temp_dir, emitter.clone()));

        let targets: Vec<BatchProbeTarget> = (1..=20)
            .map(|i| BatchProbeTarget::new(format!("Node-{}", i)))
            .collect();

        let probe_clone = probe.clone();
        let handle = tokio::spawn(async move {
            probe_clone
                .test_nodes_batch(&targets, None, None, Some(1))
                .await
        });

        // Sleep briefly and then cancel
        tokio::time::sleep(Duration::from_millis(30)).await;
        probe.cancel_tests();

        let results = handle.await.unwrap();
        assert_eq!(results.len(), 20);

        // Some tasks should be cancelled
        let cancelled_count = results
            .iter()
            .filter(|r| r.error.as_deref() == Some("Cancelled"))
            .count();
        assert!(cancelled_count > 0, "Expected at least some cancelled tasks");

        assert!(!probe.is_testing());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
