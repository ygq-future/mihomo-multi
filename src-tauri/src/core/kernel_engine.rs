use crate::core::clash_client::{ClashApiClient, ProxyDetail};
use crate::core::config_generator::{MinimalRuntimeConfig, RuntimeGeneratorParams};
use crate::core::supervisor::CoreSupervisor;
use crate::error::{AppError, AppResult};
use crate::models::{AppConfig, CoreStatus, NodeLatencyResult, PortMapping};
use parking_lot::Mutex;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use tracing::{info, warn};

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Seam separating external controller communication from kernel engine logic.
pub trait KernelControllerAdapter: Send + Sync {
    /// Update controller endpoint parameters (e.g. on core start or config change)
    fn set_endpoint(&self, _port: u16, _secret: &str) {}

    /// Hot-reloads configuration via the controller
    fn reload_config<'a>(&'a self, config_path: &'a str) -> BoxFuture<'a, AppResult<()>>;

    /// Tests latency for a single proxy node
    fn test_delay<'a>(
        &'a self,
        node_name: &'a str,
        test_url: Option<&'a str>,
        timeout_ms: Option<u32>,
    ) -> BoxFuture<'a, AppResult<u32>>;

    /// Tests latency for multiple proxy nodes concurrently
    fn test_nodes_delay_batch<'a>(
        &'a self,
        node_names: &'a [String],
        test_url: Option<&'a str>,
        timeout_ms: Option<u32>,
        concurrency: Option<usize>,
    ) -> BoxFuture<'a, Vec<NodeLatencyResult>>;

    /// Queries details for a proxy or proxy-group
    fn get_proxy_detail<'a>(&'a self, name: &'a str) -> BoxFuture<'a, AppResult<ProxyDetail>>;
}

/// Production controller adapter interacting with Mihomo REST API over HTTP.
pub struct HttpControllerAdapter {
    client: parking_lot::RwLock<ClashApiClient>,
}

impl HttpControllerAdapter {
    pub fn new(controller_port: u16, secret: &str) -> Self {
        Self {
            client: parking_lot::RwLock::new(ClashApiClient::new(controller_port, secret)),
        }
    }
}

impl KernelControllerAdapter for HttpControllerAdapter {
    fn set_endpoint(&self, port: u16, secret: &str) {
        *self.client.write() = ClashApiClient::new(port, secret);
    }

    fn reload_config<'a>(&'a self, config_path: &'a str) -> BoxFuture<'a, AppResult<()>> {
        Box::pin(async move {
            let client = self.client.read().clone();
            client.reload_config(config_path).await
        })
    }

    fn test_delay<'a>(
        &'a self,
        node_name: &'a str,
        test_url: Option<&'a str>,
        timeout_ms: Option<u32>,
    ) -> BoxFuture<'a, AppResult<u32>> {
        Box::pin(async move {
            let client = self.client.read().clone();
            client.test_delay(node_name, test_url, timeout_ms).await
        })
    }

    fn test_nodes_delay_batch<'a>(
        &'a self,
        node_names: &'a [String],
        test_url: Option<&'a str>,
        timeout_ms: Option<u32>,
        concurrency: Option<usize>,
    ) -> BoxFuture<'a, Vec<NodeLatencyResult>> {
        Box::pin(async move {
            let client = self.client.read().clone();
            client
                .test_nodes_delay_batch(node_names, test_url, timeout_ms, concurrency)
                .await
        })
    }

    fn get_proxy_detail<'a>(&'a self, name: &'a str) -> BoxFuture<'a, AppResult<ProxyDetail>> {
        Box::pin(async move {
            let client = self.client.read().clone();
            client.get_proxy_detail(name).await
        })
    }
}

#[derive(Default, Debug)]
struct FakeControllerState {
    endpoint: (u16, String),
    reloads: Vec<String>,
    reload_error: Option<String>,
    delays: HashMap<String, u32>,
    delay_errors: HashMap<String, String>,
    default_delay: u32,
    proxy_details: HashMap<String, ProxyDetail>,
}

/// In-memory fake controller adapter for deterministic testing without external binaries or network calls.
#[derive(Debug, Clone)]
pub struct FakeControllerAdapter {
    state: Arc<Mutex<FakeControllerState>>,
}

impl Default for FakeControllerAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl FakeControllerAdapter {
    pub fn new() -> Self {
        let state = FakeControllerState {
            endpoint: (9999, String::new()),
            default_delay: 50,
            ..Default::default()
        };
        Self {
            state: Arc::new(Mutex::new(state)),
        }
    }

    pub fn reloads(&self) -> Vec<String> {
        self.state.lock().reloads.clone()
    }

    pub fn reload_count(&self) -> usize {
        self.state.lock().reloads.len()
    }

    pub fn last_reloaded_path(&self) -> Option<String> {
        self.state.lock().reloads.last().cloned()
    }

    pub fn set_reload_error(&self, error: Option<String>) {
        self.state.lock().reload_error = error;
    }

    pub fn set_node_delay(&self, node_name: &str, delay: u32) {
        self.state.lock().delays.insert(node_name.to_string(), delay);
    }

    pub fn set_node_error(&self, node_name: &str, error_msg: &str) {
        self.state
            .lock()
            .delay_errors
            .insert(node_name.to_string(), error_msg.to_string());
    }

    pub fn set_default_delay(&self, delay: u32) {
        self.state.lock().default_delay = delay;
    }

    pub fn set_proxy_detail(&self, detail: ProxyDetail) {
        self.state.lock().proxy_details.insert(detail.name.clone(), detail);
    }

    pub fn endpoint(&self) -> (u16, String) {
        self.state.lock().endpoint.clone()
    }

    /// Validates the last reloaded file on disk by deserializing it into `MinimalRuntimeConfig`.
    pub fn validate_last_config(&self) -> AppResult<MinimalRuntimeConfig> {
        let last_path = self
            .last_reloaded_path()
            .ok_or_else(|| AppError::Internal("No reload recorded to validate".to_string()))?;

        let content = std::fs::read_to_string(Path::new(&last_path)).map_err(AppError::Io)?;
        serde_yaml_ng::from_str(&content).map_err(AppError::Yaml)
    }
}

impl KernelControllerAdapter for FakeControllerAdapter {
    fn set_endpoint(&self, port: u16, secret: &str) {
        self.state.lock().endpoint = (port, secret.to_string());
    }

    fn reload_config<'a>(&'a self, config_path: &'a str) -> BoxFuture<'a, AppResult<()>> {
        let state = self.state.clone();
        let path = config_path.to_string();
        Box::pin(async move {
            let mut guard = state.lock();
            if let Some(ref err) = guard.reload_error {
                return Err(AppError::ExternalController(err.clone()));
            }
            guard.reloads.push(path);
            Ok(())
        })
    }

    fn test_delay<'a>(
        &'a self,
        node_name: &'a str,
        _test_url: Option<&'a str>,
        _timeout_ms: Option<u32>,
    ) -> BoxFuture<'a, AppResult<u32>> {
        let state = self.state.clone();
        let name = node_name.to_string();
        Box::pin(async move {
            let guard = state.lock();
            if let Some(err) = guard.delay_errors.get(&name) {
                return Err(AppError::ExternalController(err.clone()));
            }
            if let Some(&delay) = guard.delays.get(&name) {
                return Ok(delay);
            }
            if let Some(idx) = name.find("] ") {
                let raw_name = &name[idx + 2..];
                if let Some(err) = guard.delay_errors.get(raw_name) {
                    return Err(AppError::ExternalController(err.clone()));
                }
                if let Some(&delay) = guard.delays.get(raw_name) {
                    return Ok(delay);
                }
            }
            Ok(guard.default_delay)
        })
    }

    fn test_nodes_delay_batch<'a>(
        &'a self,
        node_names: &'a [String],
        test_url: Option<&'a str>,
        timeout_ms: Option<u32>,
        _concurrency: Option<usize>,
    ) -> BoxFuture<'a, Vec<NodeLatencyResult>> {
        let state = self.state.clone();
        let names = node_names.to_vec();
        let test_url = test_url.map(|s| s.to_string());
        Box::pin(async move {
            let mut results = Vec::with_capacity(names.len());
            for name in &names {
                let guard = state.lock();
                if let Some(err) = guard.delay_errors.get(name) {
                    results.push(NodeLatencyResult {
                        name: name.clone(),
                        latency: None,
                        error: Some(err.clone()),
                    });
                } else {
                    let delay = guard.delays.get(name).copied().unwrap_or(guard.default_delay);
                    results.push(NodeLatencyResult {
                        name: name.clone(),
                        latency: Some(delay),
                        error: None,
                    });
                }
            }
            let _ = (test_url, timeout_ms);
            results
        })
    }

    fn get_proxy_detail<'a>(&'a self, name: &'a str) -> BoxFuture<'a, AppResult<ProxyDetail>> {
        let state = self.state.clone();
        let node_name = name.to_string();
        Box::pin(async move {
            let guard = state.lock();
            if let Some(detail) = guard.proxy_details.get(&node_name) {
                Ok(detail.clone())
            } else {
                Ok(ProxyDetail {
                    name: node_name,
                    proxy_type: "ss".to_string(),
                    now: None,
                    all: Vec::new(),
                    history: Vec::new(),
                })
            }
        })
    }
}

/// Unified Kernel Engine consolidating child process supervision, runtime configuration
/// synthesis, and external REST controller interactions behind an explicit adapter seam.
#[derive(Clone)]
pub struct KernelEngine {
    supervisor: Arc<CoreSupervisor>,
    adapter: Arc<dyn KernelControllerAdapter>,
    work_dir: PathBuf,
}

impl KernelEngine {
    /// Creates a production KernelEngine with standard CoreSupervisor and HttpControllerAdapter
    pub fn new(work_dir: PathBuf) -> Self {
        let supervisor = Arc::new(CoreSupervisor::new(work_dir.clone()));
        let adapter = Arc::new(HttpControllerAdapter::new(9999, ""));
        Self {
            supervisor,
            adapter,
            work_dir,
        }
    }

    /// Creates a KernelEngine with a custom controller adapter
    pub fn new_with_adapter(work_dir: PathBuf, adapter: Arc<dyn KernelControllerAdapter>) -> Self {
        let supervisor = Arc::new(CoreSupervisor::new(work_dir.clone()));
        Self {
            supervisor,
            adapter,
            work_dir,
        }
    }

    /// Creates a test KernelEngine with a simulated supervisor and fake controller adapter
    pub fn new_fake(work_dir: PathBuf, adapter: Arc<FakeControllerAdapter>) -> Self {
        let supervisor = Arc::new(CoreSupervisor::new_simulated(work_dir.clone()));
        Self {
            supervisor,
            adapter,
            work_dir,
        }
    }

    pub fn new_with_supervisor_and_adapter(
        supervisor: Arc<CoreSupervisor>,
        adapter: Arc<dyn KernelControllerAdapter>,
        work_dir: PathBuf,
    ) -> Self {
        Self {
            supervisor,
            adapter,
            work_dir,
        }
    }

    pub fn supervisor(&self) -> &Arc<CoreSupervisor> {
        &self.supervisor
    }

    pub fn adapter(&self) -> &Arc<dyn KernelControllerAdapter> {
        &self.adapter
    }

    pub fn work_dir(&self) -> &Path {
        &self.work_dir
    }

    // --- Process Supervision Lifecycle ---

    pub fn start(&self, app_handle: Option<&tauri::AppHandle>, config: &AppConfig) -> AppResult<CoreStatus> {
        let status = self.supervisor.start(app_handle, config)?;
        self.adapter
            .set_endpoint(config.controller_port, &config.controller_secret);
        Ok(status)
    }

    pub fn stop(&self) -> AppResult<()> {
        self.supervisor.stop()
    }

    pub fn restart(&self, app_handle: Option<&tauri::AppHandle>, config: &AppConfig) -> AppResult<CoreStatus> {
        self.stop()?;
        std::thread::sleep(std::time::Duration::from_millis(150));
        self.start(app_handle, config)
    }

    pub fn get_status(&self) -> CoreStatus {
        self.supervisor.get_status()
    }
    pub fn set_crash_handler(&self, handler: crate::core::supervisor::CrashCallback) {
        self.supervisor.set_crash_handler(handler);
    }

    // --- Controller REST Client Interactions ---

    pub async fn reload_config(&self, config_path: &str) -> AppResult<()> {
        self.adapter.reload_config(config_path).await
    }

    pub async fn test_delay(&self, node_name: &str, test_url: Option<&str>, timeout_ms: Option<u32>) -> AppResult<u32> {
        self.adapter.test_delay(node_name, test_url, timeout_ms).await
    }

    pub async fn test_nodes_delay_batch(
        &self,
        node_names: &[String],
        test_url: Option<&str>,
        timeout_ms: Option<u32>,
        concurrency: Option<usize>,
    ) -> Vec<NodeLatencyResult> {
        self.adapter
            .test_nodes_delay_batch(node_names, test_url, timeout_ms, concurrency)
            .await
    }

    pub async fn get_proxy_detail(&self, name: &str) -> AppResult<ProxyDetail> {
        self.adapter.get_proxy_detail(name).await
    }

    // --- Runtime Configuration Synthesis & Hot-Reload ---

    /// Synthesizes MinimalRuntimeConfig from pre-indexed raw proxies, port mappings, and profile names.
    pub fn synthesize_config(
        &self,
        params: &RuntimeGeneratorParams<'_>,
        mappings: &[PortMapping],
        raw_proxies: Vec<serde_yaml_ng::Value>,
        profile_names: &HashMap<String, String>,
    ) -> MinimalRuntimeConfig {
        MinimalRuntimeConfig::with_mappings(params, mappings, raw_proxies, profile_names)
    }

    /// Filters port mappings for availability using port probe and core PID awareness.
    pub fn filter_available_mappings(
        &self,
        mappings: &[PortMapping],
        allow_lan: bool,
    ) -> (Vec<PortMapping>, HashSet<u16>) {
        let core_status = self.get_status();
        let my_core_pid = if core_status.running { core_status.pid } else { None };

        let mut occupied_set = HashSet::new();
        let mut active_mappings = Vec::new();

        for m in mappings {
            if m.enabled {
                if crate::core::port_probe::is_port_available_with_lan(m.port, allow_lan, my_core_pid) {
                    active_mappings.push(m.clone());
                } else {
                    warn!(
                        "Port {} is occupied by third-party application, safely excluding from runtime listeners",
                        m.port
                    );
                    occupied_set.insert(m.port);
                }
            } else {
                active_mappings.push(m.clone());
            }
        }

        (active_mappings, occupied_set)
    }

    /// Writes runtime configuration to disk in the engine's work directory (`runtime.yaml`).
    /// Returns the path and a boolean indicating whether the file was actually modified.
    pub fn write_runtime_config(&self, config: &MinimalRuntimeConfig) -> AppResult<(PathBuf, bool)> {
        std::fs::create_dir_all(&self.work_dir).map_err(AppError::Io)?;
        let runtime_path = self.work_dir.join("runtime.yaml");
        let changed = config.write_to_file(&runtime_path)?;
        Ok((runtime_path, changed))
    }

    /// Synthesizes, writes to disk, and hot-reloads runtime configuration if the core is running on the configured controller port.
    /// If the configuration is completely identical to the on-disk file, skips disk write and REST API reload.
    pub async fn apply_runtime_config(
        &self,
        params: &RuntimeGeneratorParams<'_>,
        mappings: &[PortMapping],
        raw_proxies: Vec<serde_yaml_ng::Value>,
        profile_names: &HashMap<String, String>,
    ) -> AppResult<PathBuf> {
        let config = self.synthesize_config(params, mappings, raw_proxies, profile_names);
        let (runtime_path, changed) = self.write_runtime_config(&config)?;

        let core_status = self.get_status();
        if changed && core_status.running && core_status.controller_port == params.controller_port {
            let path_str = runtime_path.to_string_lossy().to_string();
            if let Err(err) = self.adapter.reload_config(&path_str).await {
                warn!("Hot-reloading Mihomo config after apply failed: {}", err);
            } else {
                info!("Mihomo configuration reloaded with updated port listeners and proxies");
            }
        } else if !changed {
            tracing::debug!("Runtime configuration unchanged; skipping Mihomo hot-reload");
        }

        Ok(runtime_path)
    }
}

impl Drop for KernelEngine {
    fn drop(&mut self) {
        if Arc::strong_count(&self.supervisor) == 1 {
            let _ = self.stop();
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_fake_controller_adapter_recording_and_validation() {
        let adapter = FakeControllerAdapter::new();
        assert_eq!(adapter.reload_count(), 0);
        assert_eq!(adapter.endpoint(), (9999, String::new()));

        adapter.set_endpoint(9090, "secret123");
        assert_eq!(adapter.endpoint(), (9090, "secret123".to_string()));
        let temp_dir = std::env::temp_dir().join(format!("fake_ctrl_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let config_file = temp_dir.join("runtime.yaml");
        let sample_config = MinimalRuntimeConfig::new(9090, "secret123", "info");
        let changed = sample_config.write_to_file(&config_file).unwrap();
        assert!(changed);
        let unchanged = sample_config.write_to_file(&config_file).unwrap();
        assert!(!unchanged);
        let path_str = config_file.to_string_lossy().to_string();
        adapter.reload_config(&path_str).await.unwrap();

        assert_eq!(adapter.reload_count(), 1);
        assert_eq!(adapter.last_reloaded_path(), Some(path_str));

        let validated = adapter.validate_last_config().unwrap();
        assert_eq!(validated.external_controller, "127.0.0.1:9090");
        assert_eq!(validated.secret, "secret123");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_fake_controller_adapter_delay_simulation() {
        let adapter = FakeControllerAdapter::new();
        adapter.set_default_delay(100);

        // Default delay
        let delay1 = adapter.test_delay("NodeA", None, None).await.unwrap();
        assert_eq!(delay1, 100);

        // Specific delay
        adapter.set_node_delay("NodeB", 42);
        let delay2 = adapter.test_delay("NodeB", None, None).await.unwrap();
        assert_eq!(delay2, 42);

        // Error simulation
        adapter.set_node_error("NodeC", "Connection refused");
        let err = adapter.test_delay("NodeC", None, None).await.unwrap_err();
        assert!(err.to_string().contains("Connection refused"));

        // Batch test
        let batch_names = vec!["NodeA".to_string(), "NodeB".to_string(), "NodeC".to_string()];
        let results = adapter.test_nodes_delay_batch(&batch_names, None, None, None).await;
        assert_eq!(results[0].latency, Some(100));
        assert!(results[0].error.is_none());
        assert_eq!(results[1].latency, Some(42));
        assert!(results[1].error.is_none());
        assert_eq!(results[2].latency, None);
        assert_eq!(results[2].error.as_deref(), Some("Connection refused"));
    }

    #[tokio::test]
    async fn test_fake_controller_adapter_reload_failure() {
        let adapter = FakeControllerAdapter::new();
        adapter.set_reload_error(Some("Internal Server Error".to_string()));

        let res = adapter.reload_config("/path/to/config.yaml").await;
        assert!(res.is_err());
        assert!(res.unwrap_err().to_string().contains("Internal Server Error"));
        assert_eq!(adapter.reload_count(), 0);
    }

    #[tokio::test]
    async fn test_kernel_engine_lifecycle_fake_startup_and_stop() {
        let temp_dir = std::env::temp_dir().join(format!("engine_test_{}", uuid::Uuid::new_v4()));
        let fake_adapter = Arc::new(FakeControllerAdapter::new());
        let engine = KernelEngine::new_fake(temp_dir.clone(), fake_adapter.clone());

        assert!(!engine.get_status().running);

        let config = AppConfig {
            controller_port: 9091,
            controller_secret: "secret-9091".to_string(),
            ..Default::default()
        };

        let status = engine.start(None, &config).expect("Start simulated engine");
        assert!(status.running);
        assert!(status.pid.is_some());
        assert_eq!(status.controller_port, 9091);
        assert_eq!(status.secret, "secret-9091");
        assert_eq!(fake_adapter.endpoint(), (9091, "secret-9091".to_string()));

        let runtime_yaml = temp_dir.join("runtime.yaml");
        assert!(runtime_yaml.exists());

        // Stop engine
        engine.stop().expect("Stop simulated engine");
        let post_stop = engine.get_status();
        assert!(!post_stop.running);
        assert!(post_stop.pid.is_none());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_kernel_engine_port_conflict_rejection() {
        let temp_dir = std::env::temp_dir().join(format!("engine_test_conflict_{}", uuid::Uuid::new_v4()));
        let fake_adapter = Arc::new(FakeControllerAdapter::new());
        let engine = KernelEngine::new_fake(temp_dir.clone(), fake_adapter);

        // Occupy an ephemeral port
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("Bind ephemeral port");
        let occupied_port = listener.local_addr().unwrap().port();

        let config = AppConfig {
            controller_port: occupied_port,
            ..Default::default()
        };

        let start_res = engine.start(None, &config);
        assert!(start_res.is_err());
        let err_msg = start_res.unwrap_err().to_string();
        assert!(err_msg.contains("已被本地其他应用程序占用"));
        assert!(!engine.get_status().running);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_kernel_engine_apply_runtime_config_and_hot_reload() {
        let temp_dir = std::env::temp_dir().join(format!("engine_test_sync_{}", uuid::Uuid::new_v4()));
        let fake_adapter = Arc::new(FakeControllerAdapter::new());
        let engine = KernelEngine::new_fake(temp_dir.clone(), fake_adapter.clone());

        let config = AppConfig {
            controller_port: 9092,
            controller_secret: "secret-sync".to_string(),
            ..Default::default()
        };
        engine.start(None, &config).expect("Start engine");

        let mapping = PortMapping {
            id: "m-1".to_string(),
            port: 7891,
            protocol: crate::models::InboundProtocol::Mixed,
            profile_id: "p-1".to_string(),
            node_name: "HK-01".to_string(),
            enabled: true,
            latency: None,
            description: None,
            fallback_profile_id: None,
            fallback_node_name: None,
            bypass_cn: true,
            manual_fallback: false,
        };

        let raw_proxy_yaml = r#"
name: "[Prof1] HK-01"
type: ss
server: 1.2.3.4
port: 8388
cipher: aes-128-gcm
password: pass
"#;
        let raw_proxy: serde_yaml_ng::Value = serde_yaml_ng::from_str(raw_proxy_yaml).unwrap();
        let mut profile_names = HashMap::new();
        profile_names.insert("p-1".to_string(), "Prof1".to_string());

        let params = RuntimeGeneratorParams {
            controller_port: 9092,
            secret: "secret-sync",
            log_level: "info",
            allow_lan: false,
            test_url: "http://cp.cloudflare.com/generate_204",
            timeout_ms: 3000,
            fallback_interval: 300,
            fallback_lazy: true,
        };

        let path = engine
            .apply_runtime_config(&params, std::slice::from_ref(&mapping), vec![raw_proxy], &profile_names)
            .await
            .expect("Apply runtime config");

        assert!(path.exists());
        assert_eq!(fake_adapter.reload_count(), 1);

        // Second apply with identical params & mappings must be a no-op (no disk re-write, no Mihomo reload)
        let raw_proxy2: serde_yaml_ng::Value = serde_yaml_ng::from_str(raw_proxy_yaml).unwrap();
        let path2 = engine
            .apply_runtime_config(&params, &[mapping], vec![raw_proxy2], &profile_names)
            .await
            .expect("Apply runtime config identical");
        assert_eq!(path2, path);
        assert_eq!(
            fake_adapter.reload_count(),
            1,
            "Redundant reload must be skipped when config is identical"
        );

        let reloaded_config = fake_adapter.validate_last_config().expect("Valid config");
        assert_eq!(reloaded_config.listeners.len(), 1);
        assert_eq!(reloaded_config.listeners[0].port, 7891);
        assert_eq!(reloaded_config.external_controller, "127.0.0.1:9092");
        assert_eq!(reloaded_config.secret, "secret-sync");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_kernel_engine_apply_runtime_config_graceful_reload_failure() {
        let temp_dir = std::env::temp_dir().join(format!("engine_test_fail_{}", uuid::Uuid::new_v4()));
        let fake_adapter = Arc::new(FakeControllerAdapter::new());
        let engine = KernelEngine::new_fake(temp_dir.clone(), fake_adapter.clone());

        let config = AppConfig {
            controller_port: 9093,
            ..Default::default()
        };
        engine.start(None, &config).expect("Start engine");

        fake_adapter.set_reload_error(Some("Connection refused by controller".to_string()));

        let params = RuntimeGeneratorParams {
            controller_port: 9093,
            secret: "",
            log_level: "info",
            allow_lan: false,
            test_url: "http://cp.cloudflare.com",
            timeout_ms: 3000,
            fallback_interval: 300,
            fallback_lazy: true,
        };

        // Applying config should succeed (write to disk) even if controller hot-reload returns error
        let path = engine
            .apply_runtime_config(&params, &[], Vec::new(), &HashMap::new())
            .await
            .expect("Apply config succeeds gracefully despite reload failure");

        assert!(path.exists());
        assert_eq!(fake_adapter.reload_count(), 0); // Error occurred before recording reload

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_kernel_engine_controller_delegation() {
        let temp_dir = std::env::temp_dir().join(format!("engine_test_ctrl_{}", uuid::Uuid::new_v4()));
        let fake_adapter = Arc::new(FakeControllerAdapter::new());
        fake_adapter.set_node_delay("SG-01", 38);
        let engine = KernelEngine::new_fake(temp_dir.clone(), fake_adapter.clone());

        let delay = engine.test_delay("SG-01", None, None).await.unwrap();
        assert_eq!(delay, 38);

        let batch = engine
            .test_nodes_delay_batch(&["SG-01".to_string(), "US-01".to_string()], None, None, None)
            .await;
        assert_eq!(batch.len(), 2);
        assert_eq!(batch[0].latency, Some(38));
        assert_eq!(batch[1].latency, Some(50)); // default delay

        let detail = engine.get_proxy_detail("SG-01").await.unwrap();
        assert_eq!(detail.name, "SG-01");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
