use crate::core::config_generator::{MinimalRuntimeConfig, RuntimeListener};
use crate::core::egress_probe;
use crate::core::supervisor::{CoreSupervisor, IsolatedCoreProcess};
use crate::models::{InboundProtocol, ProfileItem, ResidentialProxy, ResidentialProxyTestResult};
use serde_yaml_ng::{Mapping, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tracing::{info, warn};

/// Name of the generated residential exit inside the disposable probe config.
const PROBE_EXIT_PROXY_NAME: &str = "__mihomo_multi_residential_probe_exit__";
const PROBE_LISTENER_NAME: &str = "in-residential-probe";
const LISTENER_POLL_INTERVAL: Duration = Duration::from_millis(50);
const STARTUP_TIMEOUT: Duration = Duration::from_secs(6);
const DEFAULT_PROBE_TIMEOUT_MS: u64 = 5000;
const MIN_PROBE_TIMEOUT_MS: u64 = 1500;
const MAX_PROBE_TIMEOUT_MS: u64 = 6000;

/// Fully resolved, validated probe plan.
///
/// Building the plan is pure: it proves the selected upstream exists inside the saved
/// subscription data, rejects `DIRECT`, collects every transitive imported dialer
/// dependency, and validates the saved residential exit without exposing its secrets.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResidentialProbeChain {
    pub upstream: String,
    pub exit: ResidentialProxy,
    pub custom_exit: Option<Value>,
    pub test_url: Option<String>,
    pub proxies: Vec<Value>,
}

fn proxy_name(proxy: &Value) -> Option<&str> {
    proxy
        .as_mapping()?
        .get(Value::String("name".to_string()))?
        .as_str()
        .map(str::trim)
        .filter(|name| !name.is_empty())
}

fn proxy_dialer(proxy: &Value) -> Result<Option<&str>, String> {
    let Some(map) = proxy.as_mapping() else {
        return Ok(None);
    };
    let Some(dialer) = map.get(Value::String("dialer-proxy".to_string())) else {
        return Ok(None);
    };
    dialer
        .as_str()
        .map(str::trim)
        .filter(|target| !target.is_empty())
        .map(Some)
        .ok_or_else(|| {
            crate::tr!(
                "订阅数据中存在非法的 dialer-proxy 引用，无法进行住宅代理连通性测试",
                "Subscription data contains an invalid dialer-proxy reference; the residential proxy connectivity test cannot run"
            )
            .to_string()
        })
}

/// Resolves the upstream node selected by the user and collects its imported dialer chain.
///
/// `raw_proxies` must be the normalized runtime proxies from `ProfileManager`
/// (`get_raw_proxies_for_all_profiles`), where names and same-profile dialer references
/// are already namespaced. Missing references never fall back to a direct connection.
pub fn prepare_probe(
    raw_proxies: &[Value],
    profile: Option<&ProfileItem>,
    exit: &ResidentialProxy,
    node_name: &str,
) -> Result<ResidentialProbeChain, String> {
    exit.validate()?;
    exit.proxy_type().ok_or_else(|| {
        crate::tr!(
            format!("住宅代理出口「{}」协议无效，仅支持 http 或 socks5", exit.name),
            format!(
                "Residential proxy exit \"{}\" has an invalid protocol; only http or socks5 are supported",
                exit.name
            ),
        )
    })?;

    let requested = node_name.trim();
    if requested.is_empty() {
        return Err(crate::tr!(
            "请选择用于住宅代理链的上游节点",
            "Select an upstream node for the residential proxy chain"
        )
        .to_string());
    }
    if requested.eq_ignore_ascii_case("DIRECT") {
        return Err(crate::tr!(
            "住宅代理链的上游节点不能是 DIRECT",
            "The upstream node of a residential proxy chain cannot be DIRECT"
        )
        .to_string());
    }

    let by_name: HashMap<&str, &Value> = raw_proxies
        .iter()
        .filter_map(|proxy| proxy_name(proxy).map(|name| (name, proxy)))
        .collect();
    if by_name.contains_key(PROBE_EXIT_PROXY_NAME) {
        return Err(crate::tr!(
            "住宅代理测试代理名称与订阅节点冲突，请重命名该节点后重试",
            "The residential probe proxy name conflicts with a subscription node; rename that node and try again"
        )
        .to_string());
    }

    let upstream = if let Some(profile) = profile {
        let namespaced = format!("[{}] {}", profile.name, requested);
        if by_name.contains_key(namespaced.as_str()) {
            namespaced
        } else if requested.starts_with(&format!("[{}] ", profile.name)) && by_name.contains_key(requested) {
            requested.to_string()
        } else {
            return Err(crate::tr!(
                format!(
                    "上游节点「{}」在订阅「{}」中不存在或尚未导入（不会回退直连）",
                    requested, profile.name
                ),
                format!(
                    "Upstream node \"{}\" does not exist in subscription \"{}\" or has not been imported (no fallback to direct)",
                    requested, profile.name
                ),
            ));
        }
    } else if by_name.contains_key(requested) {
        requested.to_string()
    } else {
        let suffix = format!("] {}", requested);
        let mut matches = by_name.keys().copied().filter(|name| name.ends_with(&suffix));
        let first = matches.next().ok_or_else(|| {
            crate::tr!(
                format!("上游节点「{}」不存在或尚未导入（不会回退直连）", requested),
                format!(
                    "Upstream node \"{}\" does not exist or has not been imported (no fallback to direct)",
                    requested
                ),
            )
        })?;
        if matches.next().is_some() {
            return Err(crate::tr!(
                format!("上游节点「{}」在多个订阅中同名，请选择所属订阅后再测试", requested),
                format!(
                    "Upstream node \"{}\" exists in multiple subscriptions; select its subscription before testing",
                    requested
                ),
            ));
        }
        first.to_string()
    };

    let proxies = collect_dialer_chain(&by_name, &upstream)?;
    Ok(ResidentialProbeChain {
        upstream,
        exit: exit.clone(),
        custom_exit: None,
        test_url: None,
        proxies,
    })
}
pub fn prepare_node_probe(
    raw_proxies: &[Value],
    upstream_profile: Option<&ProfileItem>,
    upstream_node_name: &str,
    exit_profile: Option<&ProfileItem>,
    exit_node_name: &str,
) -> Result<ResidentialProbeChain, String> {
    let upstream_req = upstream_node_name.trim();
    if upstream_req.is_empty() {
        return Err(crate::tr!(
            "请选择用于链式代理的上游节点",
            "Select an upstream node for the proxy chain"
        )
        .to_string());
    }
    let exit_req = exit_node_name.trim();
    if exit_req.is_empty() {
        return Err(crate::tr!(
            "请选择用于链式代理的出口节点",
            "Select an exit node for the proxy chain"
        )
        .to_string());
    }
    if upstream_req.eq_ignore_ascii_case("DIRECT") {
        return Err(crate::tr!(
            "直连节点不能作为链式代理的上游节点",
            "DIRECT cannot be used as the upstream node for a proxy chain"
        )
        .to_string());
    }

    let mut by_name: HashMap<&str, &Value> = HashMap::new();
    for proxy in raw_proxies {
        if let Some(name) = proxy_name(proxy) {
            by_name.entry(name).or_insert(proxy);
        }
    }

    let resolve_in_profile = |req: &str, prof: Option<&ProfileItem>| -> Option<String> {
        if let Some(p) = prof {
            let namespaced = format!("[{}] {}", p.name, req);
            if by_name.contains_key(namespaced.as_str()) {
                return Some(namespaced);
            }
        }
        if by_name.contains_key(req) {
            return Some(req.to_string());
        }
        None
    };

    let upstream = resolve_in_profile(upstream_req, upstream_profile).ok_or_else(|| {
        crate::tr!(
            format!("上游节点「{upstream_req}」不存在，无法进行链式连通性测试"),
            format!("Upstream node \"{upstream_req}\" does not exist; chain connectivity test cannot run")
        )
    })?;
    let exit_target = resolve_in_profile(exit_req, exit_profile).ok_or_else(|| {
        crate::tr!(
            format!("链式出口节点「{exit_req}」不存在，无法进行链式连通性测试"),
            format!("Chain exit node \"{exit_req}\" does not exist; chain connectivity test cannot run")
        )
    })?;
    if upstream == exit_target {
        return Err(crate::tr!(
            format!("链式出口节点「{exit_req}」不能与上游节点相同"),
            format!("Chain exit node \"{exit_req}\" cannot be the same as the upstream node")
        ));
    }

    let proxies = collect_dialer_chain(&by_name, &upstream)?;
    let raw_exit = by_name
        .get(exit_target.as_str())
        .and_then(|v| v.as_mapping())
        .ok_or_else(|| {
            crate::tr!(
                format!("链式出口节点「{exit_req}」配置无效"),
                format!("Chain exit node \"{exit_req}\" has an invalid configuration")
            )
        })?;
    let mut exit_map = raw_exit.clone();
    exit_map.insert(
        Value::String("name".to_string()),
        Value::String(PROBE_EXIT_PROXY_NAME.to_string()),
    );
    exit_map.insert(
        Value::String("dialer-proxy".to_string()),
        Value::String(upstream.clone()),
    );

    Ok(ResidentialProbeChain {
        upstream,
        exit: ResidentialProxy {
            id: String::new(),
            name: exit_req.to_string(),
            protocol: "socks5".to_string(),
            server: "127.0.0.1".to_string(),
            port: 1,
            username: String::new(),
            password: String::new(),
        },
        custom_exit: Some(Value::Mapping(exit_map)),
        test_url: None,
        proxies,
    })
}

/// Collects the upstream dialer path, with dependencies emitted before consumers.
fn collect_dialer_chain(by_name: &HashMap<&str, &Value>, upstream: &str) -> Result<Vec<Value>, String> {
    let mut ordered = Vec::new();
    let mut visited = HashSet::new();
    let mut current = upstream;
    loop {
        if !visited.insert(current) {
            return Err(crate::tr!(
                format!("上游节点「{}」存在循环 dialer-proxy 引用，无法进行住宅代理连通性测试", upstream),
                format!(
                    "Upstream node \"{}\" has a circular dialer-proxy reference; the residential proxy connectivity test cannot run",
                    upstream
                ),
            ));
        }
        let proxy = *by_name.get(current).ok_or_else(|| {
            crate::tr!(
                format!("上游节点「{}」引用了未导入的 dialer-proxy「{}」", upstream, current),
                format!(
                    "Upstream node \"{}\" references an unimported dialer-proxy \"{}\"",
                    upstream, current
                ),
            )
        })?;
        ordered.push(proxy.clone());
        match proxy_dialer(proxy)? {
            Some(dialer) if !dialer.eq_ignore_ascii_case("DIRECT") => current = dialer,
            _ => break,
        }
    }
    ordered.reverse();
    Ok(ordered)
}

fn exit_proxy_value(chain: &ResidentialProbeChain) -> Result<Value, String> {
    let proxy_type = chain.exit.proxy_type().ok_or_else(|| {
        crate::tr!(
            format!("住宅代理出口「{}」协议无效", chain.exit.name),
            format!("Residential proxy exit \"{}\" has an invalid protocol", chain.exit.name),
        )
    })?;
    let mut mapping = Mapping::new();
    mapping.insert(
        Value::String("name".to_string()),
        Value::String(PROBE_EXIT_PROXY_NAME.to_string()),
    );
    mapping.insert(Value::String("type".to_string()), Value::String(proxy_type.to_string()));
    mapping.insert(
        Value::String("server".to_string()),
        Value::String(chain.exit.server.trim().to_string()),
    );
    mapping.insert(Value::String("port".to_string()), Value::from(chain.exit.port));
    if !chain.exit.username.trim().is_empty() {
        mapping.insert(
            Value::String("username".to_string()),
            Value::String(chain.exit.username.clone()),
        );
        mapping.insert(
            Value::String("password".to_string()),
            Value::String(chain.exit.password.clone()),
        );
    }
    mapping.insert(
        Value::String("dialer-proxy".to_string()),
        Value::String(chain.upstream.clone()),
    );
    Ok(Value::Mapping(mapping))
}

/// Builds a self-contained Mihomo config that is safe to run next to the live runtime:
/// loopback only, no TUN, no system proxy, and a single listener hard-bound to the chain.
pub fn build_probe_config(
    chain: &ResidentialProbeChain,
    listener_port: u16,
    controller_port: u16,
) -> Result<MinimalRuntimeConfig, String> {
    if chain.custom_exit.is_none() {
        chain.exit.validate()?;
    }
    if !chain
        .proxies
        .iter()
        .any(|proxy| proxy_name(proxy) == Some(chain.upstream.as_str()))
    {
        return Err(crate::tr!(
            "住宅代理测试链缺少所选上游节点，无法执行连通性测试",
            "The residential probe chain is missing the selected upstream node; the connectivity test cannot run"
        )
        .to_string());
    }
    let mut config = MinimalRuntimeConfig::new(controller_port, "", "warning");
    config.allow_lan = false;
    config.bind_address = "127.0.0.1".to_string();
    config.tun = None;
    config.rule_providers.clear();
    if chain.custom_exit.is_none() {
        config.dns.enable = false;
    }
    config.sniffer.enable = false;
    config.profile.store_selected = false;
    config.profile.store_fake_ip = false;
    config.proxies = chain.proxies.clone();
    if let Some(custom_exit) = &chain.custom_exit {
        config.proxies.push(custom_exit.clone());
    } else {
        config.proxies.push(exit_proxy_value(chain)?);
    }
    config.listeners = vec![RuntimeListener {
        name: PROBE_LISTENER_NAME.to_string(),
        listener_type: "mixed".to_string(),
        port: listener_port,
        listen: "127.0.0.1".to_string(),
        proxy: Some(PROBE_EXIT_PROXY_NAME.to_string()),
        rule: None,
    }];
    config.rules = vec![
        format!("IN-PORT,{},{}", listener_port, PROBE_EXIT_PROXY_NAME),
        "MATCH,REJECT".to_string(),
    ];
    Ok(config)
}

fn allocate_loopback_ports() -> Result<(u16, u16), String> {
    let first = std::net::TcpListener::bind(("127.0.0.1", 0)).map_err(|err| {
        crate::tr!(
            format!("无法分配住宅代理测试监听端口: {err}"),
            format!("Failed to allocate a residential probe listener port: {err}"),
        )
    })?;
    let second = std::net::TcpListener::bind(("127.0.0.1", 0)).map_err(|err| {
        crate::tr!(
            format!("无法分配住宅代理测试监听端口: {err}"),
            format!("Failed to allocate a residential probe listener port: {err}"),
        )
    })?;
    let listener_port = first
        .local_addr()
        .map_err(|err| {
            crate::tr!(
                format!("无法读取住宅代理测试监听端口: {err}"),
                format!("Failed to read the residential probe listener port: {err}"),
            )
        })?
        .port();
    let controller_port = second
        .local_addr()
        .map_err(|err| {
            crate::tr!(
                format!("无法读取住宅代理测试监听端口: {err}"),
                format!("Failed to read the residential probe listener port: {err}"),
            )
        })?
        .port();
    drop(first);
    drop(second);
    Ok((listener_port, controller_port))
}

/// Writes the transient probe config, which contains subscription and exit credentials.
/// Unix gets owner-only permissions; Windows per-user temp ACLs already restrict access.
fn write_private_config(path: &Path, content: &[u8]) -> std::io::Result<()> {
    use std::io::Write;

    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(content)?;
    Ok(())
}

struct ProbeWorkspace {
    path: PathBuf,
    child: Option<IsolatedCoreProcess>,
}

impl ProbeWorkspace {
    fn new(path: PathBuf) -> Self {
        Self { path, child: None }
    }
}

impl Drop for ProbeWorkspace {
    fn drop(&mut self) {
        // Explicit kill/reap happens in `IsolatedCoreProcess::drop`; keeping the child in
        // this guard means every error path and future cancellation releases it.
        drop(self.child.take());
        if let Err(err) = std::fs::remove_dir_all(&self.path) {
            warn!(
                path = %self.path.display(),
                error = %err,
                "Failed to remove residential probe temporary directory"
            );
        }
    }
}

async fn wait_for_listener(child: &mut IsolatedCoreProcess, port: u16) -> Result<(), String> {
    let deadline = Instant::now() + STARTUP_TIMEOUT;
    loop {
        if let Some(status) = child.try_wait().map_err(|error| {
            crate::tr!(
                format!("读取住宅代理测试内核状态失败: {error}"),
                format!("Failed to read the residential probe core status: {error}"),
            )
        })? {
            return Err(crate::tr!(
                format!(
                    "住宅代理测试内核提前退出（{}），请检查上游节点订阅配置是否有效",
                    status
                ),
                format!(
                    "The residential probe core exited early ({}); check whether the upstream node subscription configuration is valid",
                    status
                ),
            ));
        }
        if tokio::net::TcpStream::connect(("127.0.0.1", port)).await.is_ok() {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(crate::tr!(
                "住宅代理测试内核启动超时，请稍后重试",
                "The residential probe core startup timed out; try again later"
            )
            .to_string());
        }
        tokio::time::sleep(LISTENER_POLL_INTERVAL).await;
    }
}

fn bounded_timeout_ms(timeout_ms: Option<u64>) -> u64 {
    timeout_ms
        .unwrap_or(DEFAULT_PROBE_TIMEOUT_MS)
        .clamp(MIN_PROBE_TIMEOUT_MS, MAX_PROBE_TIMEOUT_MS)
}

/// Runs the prepared chain in a disposable, isolated Mihomo process and probes its egress.
///
/// Existing runtime listeners/connections are untouched because no runtime config is
/// written or reloaded. The child and its temporary work directory are always released,
/// including on timeout, probe failure, or future cancellation.
pub async fn execute_probe(
    app_handle: Option<&tauri::AppHandle>,
    chain: &ResidentialProbeChain,
    timeout_ms: Option<u64>,
) -> Result<ResidentialProxyTestResult, String> {
    run_probe(app_handle, chain, timeout_ms, None).await
}

/// Runs the same isolated chain against an explicit endpoint list.
///
/// Endpoint names still select the production parsers in
/// [`egress_probe::parse_probe_response`]; production IPC always uses the standard
/// [`egress_probe::PROBE_ENDPOINTS`] rotation. This seam exists for local smoke fixtures.
pub async fn execute_probe_with_endpoints(
    app_handle: Option<&tauri::AppHandle>,
    chain: &ResidentialProbeChain,
    timeout_ms: Option<u64>,
    endpoints: &[egress_probe::ProbeEndpoint],
) -> Result<ResidentialProxyTestResult, String> {
    run_probe(app_handle, chain, timeout_ms, Some(endpoints)).await
}

async fn run_probe(
    app_handle: Option<&tauri::AppHandle>,
    chain: &ResidentialProbeChain,
    timeout_ms: Option<u64>,
    endpoints: Option<&[egress_probe::ProbeEndpoint]>,
) -> Result<ResidentialProxyTestResult, String> {
    let binary = CoreSupervisor::resolve_sidecar_path(app_handle).map_err(|err| {
        crate::tr!(
            format!("无法定位 Mihomo 内核，住宅代理连通性测试未执行: {err}"),
            format!(
                "Failed to locate the Mihomo core; the residential proxy connectivity test did not run: {err}"
            ),
        )
    })?;
    let (listener_port, controller_port) = allocate_loopback_ports()?;
    let config = build_probe_config(chain, listener_port, controller_port)?;
    let yaml = config.to_yaml().map_err(|err| {
        crate::tr!(
            format!("生成住宅代理测试配置失败: {err}"),
            format!("Failed to generate the residential probe configuration: {err}"),
        )
    })?;

    let start = move || -> Result<ProbeWorkspace, String> {
        let work_dir = std::env::temp_dir().join(format!("mihomo-multi-residential-probe-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&work_dir).map_err(|err| {
            crate::tr!(
                format!("创建住宅代理测试临时目录失败: {err}"),
                format!("Failed to create the residential probe temporary directory: {err}"),
            )
        })?;
        let mut workspace = ProbeWorkspace::new(work_dir);
        let config_path = workspace.path.join("probe.yaml");
        write_private_config(&config_path, yaml.as_bytes()).map_err(|err| {
            crate::tr!(
                format!("写入住宅代理测试配置失败: {err}"),
                format!("Failed to write the residential probe configuration: {err}"),
            )
        })?;
        workspace.child = Some(IsolatedCoreProcess::spawn(&binary, &workspace.path, &config_path).map_err(|err| {
            crate::tr!(
                format!("启动住宅代理测试内核失败: {err}"),
                format!("Failed to start the residential probe core: {err}"),
            )
        })?);
        Ok(workspace)
    };
    #[cfg(target_os = "macos")]
    let mut workspace = tokio::task::spawn_blocking(start).await.map_err(|error| {
        crate::tr!(
            format!("住宅代理测试内核启动任务失败: {error}"),
            format!("The residential probe core startup task failed: {error}"),
        )
    })??;
    // Linux parent-death signals follow the spawning thread, which must remain alive.
    #[cfg(not(target_os = "macos"))]
    let mut workspace = start()?;
    let child = workspace.child.as_mut().ok_or_else(|| {
        crate::tr!(
            "住宅代理测试内核未能启动，请稍后重试",
            "The residential probe core could not start; try again later"
        )
        .to_string()
    })?;
    wait_for_listener(child, listener_port).await?;

    let per_api_timeout = bounded_timeout_ms(timeout_ms);
    if chain.custom_exit.is_some() {
        let test_url = chain
            .test_url
            .as_deref()
            .map(str::trim)
            .filter(|u| !u.is_empty())
            .unwrap_or("http://cp.cloudflare.com/generate_204");
        let proxy_url = format!("http://127.0.0.1:{listener_port}");
        let proxy = reqwest::Proxy::all(&proxy_url)
            .map_err(|e| format!("构造临时链式代理失败: {e}"))?;
        let client = reqwest::Client::builder()
            .proxy(proxy)
            .timeout(Duration::from_millis(per_api_timeout))
            .build()
            .map_err(|e| format!("构造探测客户端失败: {e}"))?;
        let started = std::time::Instant::now();
        let resp = client.get(test_url).send().await.map_err(|e| {
            if e.is_timeout() {
                "链式代理连通超时（主节点与链式出口之间连接超时）".to_string()
            } else {
                format!("链式代理连接失败（主节点无法经链式出口访问测试地址）: {e}")
            }
        })?;
        let status = resp.status();
        if status == reqwest::StatusCode::BAD_GATEWAY {
            return Err("链式代理不可达（主节点无法连接到该链式出口节点，HTTP 502）".to_string());
        }
        if !status.is_success() {
            return Err(format!("链式连通性测试返回异常状态码: {status}"));
        }
        let delay = started.elapsed().as_millis().max(1) as u64;
        return Ok(ResidentialProxyTestResult {
            latency_ms: delay,
            egress: crate::models::DirectEgressInfo {
                ip: String::new(),
                region: String::new(),
                country_code: None,
                isp: None,
                latency_ms: Some(delay as u32),
                source: "chain-listener-204".to_string(),
            },
        });
    }
    let endpoint_attempts = endpoints
        .map(|list| list.len())
        .unwrap_or_else(|| {
            egress_probe::PROBE_ENDPOINTS
                .iter()
                .filter(|endpoint| !endpoint.is_cn_endpoint)
                .count()
        })
        .max(1) as u64;
    let started = Instant::now();
    let probe = async {
        match endpoints {
            Some(endpoints) => {
                egress_probe::query_endpoints_egress_info(
                    listener_port,
                    InboundProtocol::Mixed,
                    endpoints,
                    Some(per_api_timeout),
                )
                .await
            }
            None => {
                egress_probe::query_port_egress_info(listener_port, InboundProtocol::Mixed, Some(per_api_timeout)).await
            }
        }
    };
    let egress = tokio::time::timeout(
        Duration::from_millis(per_api_timeout.saturating_mul(endpoint_attempts) + 1000),
        probe,
    )
    .await
    .map_err(|_| {
        crate::tr!(
            format!(
                "住宅代理连通性测试超时（{} ms），请检查上游节点与住宅代理出口",
                per_api_timeout
            ),
            format!(
                "Residential proxy connectivity test timed out after {} ms; check the upstream node and residential proxy exit",
                per_api_timeout
            ),
        )
    })?
    .map_err(|err| {
        crate::tr!(
            format!("住宅代理链路探测失败（未回退直连）: {err}"),
            format!("Residential proxy chain probe failed (no fallback to direct): {err}"),
        )
    })?;

    let latency_ms = egress
        .latency_ms
        .map(u64::from)
        .unwrap_or_else(|| started.elapsed().as_millis() as u64);
    info!(
        upstream = %chain.upstream,
        exit = %chain.exit.name,
        listener_port,
        ip = %egress.ip,
        latency_ms,
        "Residential chain probe succeeded through isolated Mihomo instance"
    );

    Ok(ResidentialProxyTestResult { latency_ms, egress })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ProfileType;

    const PROFILE_NAME: &str = "Test Sub";

    fn profile() -> ProfileItem {
        ProfileItem {
            id: "profile-1".to_string(),
            name: PROFILE_NAME.to_string(),
            profile_type: ProfileType::Remote,
            url: None,
            file_path: "/tmp/profile.yaml".to_string(),
            auto_update_interval_mins: 0,
            last_updated_at: 0,
            node_count: 3,
            subscription_info: None,
            enabled: true,
        }
    }

    fn node(name: &str, dialer: Option<&str>) -> Value {
        let mut map = Mapping::new();
        map.insert(Value::String("name".to_string()), Value::String(name.to_string()));
        map.insert(Value::String("type".to_string()), Value::String("ss".to_string()));
        map.insert(
            Value::String("server".to_string()),
            Value::String("192.0.2.10".to_string()),
        );
        map.insert(Value::String("port".to_string()), Value::from(8388u16));
        if let Some(dialer) = dialer {
            map.insert(
                Value::String("dialer-proxy".to_string()),
                Value::String(dialer.to_string()),
            );
        }
        Value::Mapping(map)
    }

    fn namespaced(name: &str) -> String {
        format!("[{}] {}", PROFILE_NAME, name)
    }

    fn test_exit_password() -> String {
        ["unit", "test", "credential"].join("-")
    }

    fn exit() -> ResidentialProxy {
        ResidentialProxy {
            id: "exit-1".to_string(),
            name: "Residential Exit".to_string(),
            protocol: "http".to_string(),
            server: "residential.example.net".to_string(),
            port: 8080,
            username: "user".to_string(),
            password: test_exit_password(),
        }
    }

    #[test]
    fn test_prepare_probe_rejects_direct_upstream() {
        let raw = vec![node(&namespaced("HK"), None)];
        let error = prepare_probe(&raw, Some(&profile()), &exit(), "direct").unwrap_err();
        assert!(error.contains("不能是 DIRECT"), "unexpected error: {error}");
    }

    #[test]
    fn test_prepare_probe_rejects_missing_upstream() {
        let raw = vec![node(&namespaced("HK"), None)];
        let error = prepare_probe(&raw, Some(&profile()), &exit(), "US").unwrap_err();
        assert!(error.contains("不存在"), "unexpected error: {error}");
        assert!(error.contains("不会回退直连"), "unexpected error: {error}");
    }

    #[test]
    fn test_prepare_probe_respects_selected_subscription() {
        let raw = vec![node(&namespaced("HK"), None)];
        let mut other = profile();
        other.id = "profile-2".to_string();
        other.name = "Other Sub".to_string();
        let error = prepare_probe(&raw, Some(&other), &exit(), "HK").unwrap_err();
        assert!(error.contains("Other Sub"), "unexpected error: {error}");
        assert!(error.contains("不存在"), "unexpected error: {error}");
        let error = prepare_probe(&raw, Some(&other), &exit(), "[Test Sub] HK").unwrap_err();
        assert!(error.contains("Other Sub"), "unexpected error: {error}");
        assert!(error.contains("不存在"), "unexpected error: {error}");
    }

    #[test]
    fn test_prepare_probe_rejects_missing_nested_dialer() {
        let raw = vec![node(&namespaced("A"), Some(&namespaced("Missing")))];
        let error = prepare_probe(&raw, Some(&profile()), &exit(), "A").unwrap_err();
        assert!(error.contains("未导入"), "unexpected error: {error}");
        assert!(error.contains("Missing"), "unexpected error: {error}");
    }

    #[test]
    fn test_prepare_probe_rejects_dialer_cycle() {
        let raw = vec![
            node(&namespaced("A"), Some(&namespaced("B"))),
            node(&namespaced("B"), Some(&namespaced("A"))),
        ];
        let error = prepare_probe(&raw, Some(&profile()), &exit(), "A").unwrap_err();
        assert!(error.contains("循环"), "unexpected error: {error}");
    }

    #[test]
    fn test_prepare_probe_rejects_incomplete_credentials() {
        let raw = vec![node(&namespaced("HK"), None)];
        let mut invalid = exit();
        invalid.password.clear();
        let error = prepare_probe(&raw, Some(&profile()), &invalid, "HK").unwrap_err();
        assert!(error.contains("用户名与密码"), "unexpected error: {error}");
    }

    #[test]
    fn test_prepare_probe_rejects_unsupported_exit_protocol() {
        let raw = vec![node(&namespaced("HK"), None)];
        let mut invalid = exit();
        invalid.protocol = "socks4".to_string();
        let error = prepare_probe(&raw, Some(&profile()), &invalid, "HK").unwrap_err();
        assert!(error.contains("协议无效"), "unexpected error: {error}");
    }

    #[test]
    fn test_prepare_probe_requires_upstream_node_name() {
        let raw = vec![node(&namespaced("HK"), None)];
        let error = prepare_probe(&raw, Some(&profile()), &exit(), "  ").unwrap_err();
        assert!(error.contains("请选择"), "unexpected error: {error}");
    }

    #[test]
    fn test_prepare_probe_accepts_exact_runtime_name_without_profile() {
        let raw = vec![node(&namespaced("HK"), None)];
        let chain = prepare_probe(&raw, None, &exit(), &namespaced("HK")).unwrap();
        assert_eq!(chain.upstream, "[Test Sub] HK");
        assert_eq!(chain.proxies.len(), 1);
    }

    #[test]
    fn test_prepare_probe_rejects_ambiguous_runtime_name_without_profile() {
        let raw = vec![node("[Sub One] HK", None), node("[Sub Two] HK", None)];
        let error = prepare_probe(&raw, None, &exit(), "HK").unwrap_err();
        assert!(error.contains("多个订阅"), "unexpected error: {error}");
    }

    #[test]
    fn test_probe_config_preserves_transitive_chain_and_stays_isolated() {
        let raw = vec![
            node(&namespaced("A"), Some(&namespaced("B"))),
            node(&namespaced("B"), Some(&namespaced("C"))),
            node(&namespaced("C"), Some("DIRECT")),
            node(&namespaced("Unrelated"), None),
        ];
        let mut saved_exit = exit();
        saved_exit.protocol = "socks5".to_string();
        let chain = prepare_probe(&raw, Some(&profile()), &saved_exit, "A").unwrap();
        assert_eq!(chain.upstream, "[Test Sub] A");
        let collected: Vec<&str> = chain.proxies.iter().filter_map(|proxy| proxy_name(proxy)).collect();
        assert_eq!(
            collected,
            vec!["[Test Sub] C", "[Test Sub] B", "[Test Sub] A"],
            "dependencies must precede their consumers"
        );

        let config = build_probe_config(&chain, 19001, 19002).unwrap();
        assert!(!config.allow_lan);
        assert_eq!(config.bind_address, "127.0.0.1");
        assert!(config.tun.is_none());

        assert_eq!(config.listeners.len(), 1);
        let listener = &config.listeners[0];
        assert_eq!(listener.name, "in-residential-probe");
        assert_eq!(listener.listener_type, "mixed");
        assert_eq!(listener.port, 19001);
        assert_eq!(listener.listen, "127.0.0.1");
        assert_eq!(
            listener.proxy.as_deref(),
            Some("__mihomo_multi_residential_probe_exit__")
        );
        assert!(listener.rule.is_none());

        assert_eq!(config.proxies.len(), 4);
        let exit_proxy = config
            .proxies
            .last()
            .and_then(Value::as_mapping)
            .expect("generated exit proxy");
        let field = |name: &str| exit_proxy.get(Value::String(name.to_string())).and_then(Value::as_str);
        assert_eq!(field("name"), Some("__mihomo_multi_residential_probe_exit__"));
        assert_eq!(field("type"), Some("socks5"));
        assert_eq!(field("server"), Some("residential.example.net"));
        assert_eq!(field("dialer-proxy"), Some("[Test Sub] A"));
        assert_eq!(field("username"), Some("user"));
        let expected_password = test_exit_password();
        assert_eq!(field("password"), Some(expected_password.as_str()));
        assert_eq!(
            exit_proxy
                .get(Value::String("port".to_string()))
                .and_then(Value::as_u64),
            Some(8080)
        );

        assert_eq!(
            config.rules,
            vec![
                "IN-PORT,19001,__mihomo_multi_residential_probe_exit__".to_string(),
                "MATCH,REJECT".to_string()
            ]
        );
        assert!(!config.rules.iter().any(|rule| rule.contains("DIRECT")));
        assert!(config.rule_providers.is_empty());

        let yaml = config.to_yaml().unwrap();
        assert!(!yaml.contains("tun:"));
        assert!(!yaml.contains("allow-lan: true"));
        assert!(yaml.contains("__mihomo_multi_residential_probe_exit__"));
    }

    #[test]
    fn test_probe_config_rejects_chain_without_upstream_node() {
        let chain = ResidentialProbeChain {
            upstream: "[Test Sub] A".to_string(),
            exit: exit(),
            custom_exit: None,
            test_url: None,
            proxies: vec![node("[Test Sub] Unrelated", None)],
        };
        let error = build_probe_config(&chain, 19005, 19006).unwrap_err();
        assert!(error.contains("缺少所选上游节点"), "unexpected error: {error}");
    }

    #[test]
    fn test_probe_config_omits_credentials_when_anonymous() {
        let raw = vec![node(&namespaced("HK"), None)];
        let mut anonymous = exit();
        anonymous.username.clear();
        anonymous.password.clear();
        let chain = prepare_probe(&raw, Some(&profile()), &anonymous, "HK").unwrap();
        let config = build_probe_config(&chain, 19003, 19004).unwrap();
        let exit_proxy = config
            .proxies
            .last()
            .and_then(Value::as_mapping)
            .expect("generated exit proxy");
        assert!(!exit_proxy.contains_key(Value::String("username".to_string())));
        assert!(!exit_proxy.contains_key(Value::String("password".to_string())));
    }
}
