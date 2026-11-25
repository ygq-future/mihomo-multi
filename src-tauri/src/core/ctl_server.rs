use crate::constants::APP_VERSION;
use crate::core::cli_format::{
    CopyFormat, EnvFormatError, ShellKind, build_all_copy_values, build_copy_value, build_env_set_command,
    build_env_unset_command,
};
use crate::core::egress_probe;
use crate::models::{EnvProxyStatus, InboundProtocol, PortMapping, ProfileItem, SystemProxyStatus, TunStatus};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;
use tracing::{debug, info, warn};

/// Discovery file written to `app_dir/ctl.json` while the local control server is running.
pub const CTL_FILE_NAME: &str = "ctl.json";

/// Maximum accepted HTTP request size (headers + body).
const MAX_REQUEST_BYTES: usize = 64 * 1024;
/// Per-connection read timeout so stalled clients cannot hold tasks indefinitely.
const READ_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CtlDiscoveryInfo {
    pub port: u16,
    pub token: String,
    pub pid: u32,
    pub version: String,
}

#[derive(Debug)]
pub struct CtlServerHandle {
    pub info: CtlDiscoveryInfo,
    app_dir: PathBuf,
    shutdown_tx: Option<oneshot::Sender<()>>,
}

impl CtlServerHandle {
    /// Stops the local control server and removes `ctl.json` if it still belongs to this process.
    pub fn shutdown(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        remove_ctl_file_if_owned(&self.app_dir, self.info.pid);
    }
}

impl Drop for CtlServerHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Removes `app_dir/ctl.json` when it belongs to `owner_pid` (or unconditionally if unreadable).
pub fn remove_ctl_file_if_owned(app_dir: &Path, owner_pid: u32) {
    let path = app_dir.join(CTL_FILE_NAME);
    if !path.exists() {
        return;
    }
    let should_remove = match std::fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str::<CtlDiscoveryInfo>(&content) {
            Ok(info) => info.pid == owner_pid,
            Err(_) => true,
        },
        Err(_) => true,
    };
    if should_remove {
        let _ = std::fs::remove_file(&path);
    }
}

fn generate_token() -> String {
    format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple())
}

fn write_ctl_file(app_dir: &Path, info: &CtlDiscoveryInfo) -> std::io::Result<()> {
    std::fs::create_dir_all(app_dir)?;
    let path = app_dir.join(CTL_FILE_NAME);
    let json = serde_json::to_string_pretty(info).map_err(std::io::Error::other)?;
    std::fs::write(&path, json)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Starts the loopback-only local HTTP control server and writes `app_dir/ctl.json`.
pub async fn start_ctl_server(state: AppState) -> std::io::Result<CtlServerHandle> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
    let port = listener.local_addr()?.port();
    let token = generate_token();
    let info = CtlDiscoveryInfo {
        port,
        token: token.clone(),
        pid: std::process::id(),
        version: APP_VERSION.to_string(),
    };

    write_ctl_file(&state.app_dir, &info)?;
    info!(port = port, "Local CLI control server listening on 127.0.0.1");

    let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();
    let token = Arc::new(token);
    let app_dir = state.app_dir.clone();

    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut shutdown_rx => {
                    debug!("Local CLI control server shutting down");
                    break;
                }
                accept_res = listener.accept() => {
                    match accept_res {
                        Ok((stream, _addr)) => {
                            let state = state.clone();
                            let token = Arc::clone(&token);
                            tokio::spawn(async move {
                                handle_connection(stream, state, token).await;
                            });
                        }
                        Err(err) => {
                            warn!("Local CLI control server accept error: {err}");
                        }
                    }
                }
            }
        }
    });

    Ok(CtlServerHandle {
        info,
        app_dir,
        shutdown_tx: Some(shutdown_tx),
    })
}

struct HttpRequest {
    method: String,
    path: String,
    query: HashMap<String, String>,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

struct HttpResponse {
    status: u16,
    reason: &'static str,
    body: String,
}

impl HttpResponse {
    fn ok<T: Serialize>(data: &T) -> Self {
        let body = serde_json::to_string(&serde_json::json!({ "ok": true, "data": data }))
            .unwrap_or_else(|_| "{\"ok\":true}".to_string());
        Self {
            status: 200,
            reason: "OK",
            body,
        }
    }

    fn err(status: u16, reason: &'static str, message: impl Into<String>) -> Self {
        let body = serde_json::to_string(&serde_json::json!({
            "ok": false,
            "error": message.into(),
        }))
        .unwrap_or_else(|_| "{\"ok\":false,\"error\":\"internal error\"}".to_string());
        Self { status, reason, body }
    }
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn parse_query(raw: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for pair in raw.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        let key = urlencoding::decode(k)
            .map(|s| s.into_owned())
            .unwrap_or_else(|_| k.to_string());
        let val = urlencoding::decode(v)
            .map(|s| s.into_owned())
            .unwrap_or_else(|_| v.to_string());
        map.insert(key, val);
    }
    map
}

async fn read_http_request(stream: &mut TcpStream) -> Result<HttpRequest, HttpResponse> {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 2048];
    let header_end = loop {
        let n = tokio::time::timeout(READ_TIMEOUT, stream.read(&mut chunk))
            .await
            .map_err(|_| HttpResponse::err(408, "Request Timeout", "request read timeout"))?
            .map_err(|_| HttpResponse::err(400, "Bad Request", "failed to read request"))?;
        if n == 0 {
            return Err(HttpResponse::err(400, "Bad Request", "unexpected EOF"));
        }
        buf.extend_from_slice(&chunk[..n]);
        if buf.len() > MAX_REQUEST_BYTES {
            return Err(HttpResponse::err(413, "Payload Too Large", "request exceeds 64 KiB"));
        }
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos;
        }
    };

    let header_text = std::str::from_utf8(&buf[..header_end])
        .map_err(|_| HttpResponse::err(400, "Bad Request", "invalid UTF-8 headers"))?;
    let mut lines = header_text.split("\r\n");
    let request_line = lines
        .next()
        .ok_or_else(|| HttpResponse::err(400, "Bad Request", "missing request line"))?;
    let mut parts = request_line.split_whitespace();
    let method = parts
        .next()
        .ok_or_else(|| HttpResponse::err(400, "Bad Request", "missing HTTP method"))?
        .to_string();
    let target = parts
        .next()
        .ok_or_else(|| HttpResponse::err(400, "Bad Request", "missing request target"))?;

    let (path_raw, query_raw) = target.split_once('?').unwrap_or((target, ""));
    let path = path_raw.to_string();
    let query = parse_query(query_raw);

    let mut headers = HashMap::new();
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }

    let content_length: usize = headers
        .get("content-length")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0);
    if header_end + 4 + content_length > MAX_REQUEST_BYTES {
        return Err(HttpResponse::err(
            413,
            "Payload Too Large",
            "request body exceeds 64 KiB",
        ));
    }

    let mut body = buf[(header_end + 4)..].to_vec();
    while body.len() < content_length {
        let n = tokio::time::timeout(READ_TIMEOUT, stream.read(&mut chunk))
            .await
            .map_err(|_| HttpResponse::err(408, "Request Timeout", "body read timeout"))?
            .map_err(|_| HttpResponse::err(400, "Bad Request", "failed to read body"))?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..n]);
        if body.len() > content_length {
            body.truncate(content_length);
        }
    }

    Ok(HttpRequest {
        method,
        path,
        query,
        headers,
        body,
    })
}

async fn write_http_response(stream: &mut TcpStream, resp: &HttpResponse) {
    let raw = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        resp.status,
        resp.reason,
        resp.body.len(),
        resp.body
    );
    let _ = stream.write_all(raw.as_bytes()).await;
    let _ = stream.shutdown().await;
}

async fn handle_connection(mut stream: TcpStream, state: AppState, expected_token: Arc<String>) {
    let req = match read_http_request(&mut stream).await {
        Ok(req) => req,
        Err(resp) => {
            write_http_response(&mut stream, &resp).await;
            return;
        }
    };

    let provided = req
        .headers
        .get("authorization")
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    if !constant_time_eq(provided.as_bytes(), expected_token.as_bytes()) {
        write_http_response(
            &mut stream,
            &HttpResponse::err(401, "Unauthorized", "invalid or missing bearer token"),
        )
        .await;
        return;
    }

    let resp = dispatch_request(&req, &state).await;
    write_http_response(&mut stream, &resp).await;
}

fn parse_json_body<T: for<'de> Deserialize<'de>>(body: &[u8]) -> Result<T, HttpResponse> {
    if body.is_empty() {
        return serde_json::from_str("{}")
            .map_err(|e| HttpResponse::err(400, "Bad Request", format!("invalid JSON body: {e}")));
    }
    serde_json::from_slice(body).map_err(|e| HttpResponse::err(400, "Bad Request", format!("invalid JSON body: {e}")))
}

fn refresh_tray_if_available(state: &AppState) {
    use tauri::Emitter;
    if let Some(app) = state.app_handle.read().clone() {
        crate::tray::update_tray_menu(&app);
        let _ = app.emit("ctl-state-changed", ());
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusResponse {
    version: String,
    core_running: bool,
    core_pid: Option<u32>,
    total_ports: usize,
    enabled_ports: usize,
    system_proxy: SystemProxyStatus,
    tun: TunStatus,
    env_proxy: EnvProxyStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    language: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PortListItem {
    mapping: PortMapping,
    delay: Option<u32>,
    is_system_proxy: bool,
    is_tun: bool,
    is_env_proxy: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NodeListItem {
    index: usize,
    name: String,
    runtime_name: Option<String>,
    protocol: String,
    profile_id: String,
    profile_name: String,
    delay: Option<u32>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SubUpdateRequest {
    #[serde(default)]
    target: Option<String>,
    #[serde(default)]
    all: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TestNodeRequest {
    node: String,
    #[serde(default)]
    test_url: Option<String>,
    #[serde(default)]
    timeout_ms: Option<u32>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct TestSubRequest {
    #[serde(default)]
    target: Option<String>,
    #[serde(default)]
    all: bool,
    #[serde(default)]
    test_url: Option<String>,
    #[serde(default)]
    timeout_ms: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToggleProxyRequest {
    enabled: bool,
    #[serde(default)]
    port: Option<u16>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnvProxyRequest {
    enabled: bool,
    #[serde(default)]
    port: Option<u16>,
    #[serde(default)]
    shell: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvProxyActionResponse {
    status: EnvProxyStatus,
    shell: ShellKind,
    command: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IpProbeRequest {
    port: u16,
    #[serde(default)]
    timeout_ms: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CopyItem {
    format: String,
    value: String,
}
async fn dispatch_request(req: &HttpRequest, state: &AppState) -> HttpResponse {
    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/v1/status") => handle_status(state),
        ("GET", "/v1/ports") => handle_list_ports(state),
        ("GET", "/v1/subs") => handle_list_subs(state),
        ("POST", "/v1/subs/update") => handle_update_subs(req, state).await,
        ("GET", "/v1/nodes") => handle_list_nodes(req, state),
        ("POST", "/v1/test/node") => handle_test_node(req, state).await,
        ("POST", "/v1/test/sub") => handle_test_sub(req, state).await,
        ("GET", "/v1/sysproxy") => HttpResponse::ok(&state.build_system_proxy_status()),
        ("POST", "/v1/sysproxy") => handle_set_sysproxy(req, state).await,
        ("GET", "/v1/tun") => HttpResponse::ok(&state.build_tun_status()),
        ("POST", "/v1/tun") => handle_set_tun(req, state).await,
        ("GET", "/v1/env") => HttpResponse::ok(&state.build_env_proxy_status()),
        ("POST", "/v1/env") => handle_set_env(req, state).await,
        ("POST", "/v1/ip") => handle_probe_ip(req, state).await,
        ("GET", "/v1/copy") => handle_copy(req, state),
        ("POST", "/v1/lang") => handle_set_lang(req, state),
        ("POST", "/v1/stop") => handle_stop(state),
        ("POST", path) if path.starts_with("/v1/ports/") => handle_toggle_port(path, state).await,
        _ => HttpResponse::err(404, "Not Found", format!("unknown route: {} {}", req.method, req.path)),
    }
}

fn handle_status(state: &AppState) -> HttpResponse {
    let engine_status = state.engine.get_status();
    let mappings = state.port_router.get_port_mappings();
    let enabled_ports = mappings.iter().filter(|m| m.enabled).count();
    let language = state.config.read().language.clone();
    let resp = StatusResponse {
        version: APP_VERSION.to_string(),
        core_running: engine_status.running,
        core_pid: engine_status.pid,
        total_ports: mappings.len(),
        enabled_ports,
        system_proxy: state.build_system_proxy_status(),
        tun: state.build_tun_status(),
        env_proxy: state.build_env_proxy_status(),
        language,
    };
    HttpResponse::ok(&resp)
}

fn handle_stop(state: &AppState) -> HttpResponse {
    let pid = std::process::id();
    if let Some(app) = state.app_handle.read().clone() {
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            app.exit(0);
        });
    }
    HttpResponse::ok(&serde_json::json!({
        "stopping": true,
        "pid": pid,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetLangRequest {
    language: String,
}

fn normalize_locale(raw: &str) -> Option<&'static str> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "zh" | "zh-cn" | "zh_cn" | "zh-hans" => Some("zh-CN"),
        "en" | "en-us" | "en_us" => Some("en-US"),
        _ => None,
    }
}

fn handle_set_lang(req: &HttpRequest, state: &AppState) -> HttpResponse {
    let body: SetLangRequest = match parse_json_body(&req.body) {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let Some(normalized) = normalize_locale(&body.language) else {
        return HttpResponse::err(
            400,
            "Bad Request",
            format!("unsupported language '{}'; use zh-CN or en-US", body.language),
        );
    };
    let cfg = {
        let mut cfg = state.config.write();
        cfg.language = Some(normalized.to_string());
        cfg.clone()
    };
    if let Err(err) = state.persist_config(&cfg) {
        return HttpResponse::err(500, "Internal Server Error", err.to_string());
    }
    if let Some(app_handle) = state.app_handle.read().as_ref() {
        let _ = crate::tray::set_ui_locale(app_handle.clone(), normalized.to_string());
        let _ = tauri::Emitter::emit(app_handle, "app:language-changed", normalized);
    }
    HttpResponse::ok(&serde_json::json!({ "language": normalized }))
}

fn handle_list_ports(state: &AppState) -> HttpResponse {
    let mappings = state.port_router.get_port_mappings();
    let delays = state.latency_probe.get_latencies();
    let sysproxy = state.build_system_proxy_status();
    let tun = state.build_tun_status();
    let env_proxy = state.build_env_proxy_status();

    let mut items: Vec<PortListItem> = mappings
        .into_iter()
        .map(|mapping| {
            let delay = delays.get(&mapping.node_name).copied().flatten().or(mapping.latency);
            let port = mapping.port;
            PortListItem {
                mapping,
                delay,
                is_system_proxy: sysproxy.enabled && sysproxy.port == Some(port),
                is_tun: tun.enabled && tun.port == Some(port),
                is_env_proxy: env_proxy.enabled && env_proxy.port == Some(port),
            }
        })
        .collect();
    items.sort_by_key(|item| item.mapping.port);
    HttpResponse::ok(&items)
}

async fn handle_toggle_port(path: &str, state: &AppState) -> HttpResponse {
    let rest = path.trim_start_matches("/v1/ports/");
    let Some((port_str, action)) = rest.split_once('/') else {
        return HttpResponse::err(404, "Not Found", "expected /v1/ports/<port>/<enable|disable>");
    };
    let Ok(port) = port_str.parse::<u16>() else {
        return HttpResponse::err(400, "Bad Request", format!("invalid port: {port_str}"));
    };
    let enabled = match action {
        "enable" => true,
        "disable" => false,
        _ => return HttpResponse::err(404, "Not Found", format!("unsupported port action: {action}")),
    };

    let mappings = state.port_router.get_port_mappings();
    let Some(target) = mappings.into_iter().find(|m| m.port == port) else {
        return HttpResponse::err(404, "Not Found", format!("port mapping {port} not found"));
    };

    match state.toggle_port_mapping(&target.id, enabled).await {
        Ok(updated) => {
            refresh_tray_if_available(state);
            HttpResponse::ok(&updated)
        }
        Err(err) => HttpResponse::err(400, "Bad Request", err.to_string()),
    }
}

fn handle_list_subs(state: &AppState) -> HttpResponse {
    let mut profiles: Vec<ProfileItem> = state.profile_manager.get_profiles();
    profiles.sort_by_key(|b| std::cmp::Reverse(b.last_updated_at));
    HttpResponse::ok(&profiles)
}

fn resolve_profile<'a>(profiles: &'a [ProfileItem], target: &str) -> Option<&'a ProfileItem> {
    profiles
        .iter()
        .find(|p| p.id == target || p.name.eq_ignore_ascii_case(target))
}

async fn handle_update_subs(req: &HttpRequest, state: &AppState) -> HttpResponse {
    let body: SubUpdateRequest = match parse_json_body(&req.body) {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let profiles = state.profile_manager.get_profiles();
    let targets: Vec<ProfileItem> = if let Some(target) = &body.target {
        match resolve_profile(&profiles, target) {
            Some(p) => vec![p.clone()],
            None => return HttpResponse::err(404, "Not Found", format!("subscription '{target}' not found")),
        }
    } else if body.all || body.target.is_none() {
        profiles.into_iter().filter(|p| p.enabled && p.url.is_some()).collect()
    } else {
        Vec::new()
    };

    let mut updated = Vec::new();
    let mut errors = Vec::new();
    for profile in targets {
        match state.profile_manager.update_profile(&profile.id).await {
            Ok(item) => updated.push(item),
            Err(err) => errors.push(serde_json::json!({
                "id": profile.id,
                "name": profile.name,
                "error": err.to_string(),
            })),
        }
    }

    if !updated.is_empty() {
        let _ = state.sync_runtime_config().await;
    }

    HttpResponse::ok(&serde_json::json!({
        "updated": updated,
        "errors": errors,
    }))
}

fn fuzzy_subsequence_match(haystack: &str, needle: &str) -> bool {
    let needle_chars: Vec<char> = needle.trim().to_lowercase().chars().collect();
    if needle_chars.is_empty() {
        return true;
    }
    let mut idx = 0;
    for ch in haystack.to_lowercase().chars() {
        if ch == needle_chars[idx] {
            idx += 1;
            if idx == needle_chars.len() {
                return true;
            }
        }
    }
    false
}

fn region_alias(code: &str) -> Option<&'static str> {
    match code.trim().to_ascii_lowercase().as_str() {
        "jp" => Some("日本"),
        "hk" => Some("香港"),
        "tw" => Some("台湾"),
        "sg" => Some("新加坡"),
        "us" => Some("美国"),
        "kr" => Some("韩国"),
        "uk" | "gb" => Some("英国"),
        "de" => Some("德国"),
        "fr" => Some("法国"),
        "ca" => Some("加拿大"),
        "au" => Some("澳大利亚"),
        "ru" => Some("俄罗斯"),
        "in" => Some("印度"),
        "nl" => Some("荷兰"),
        "tr" => Some("土耳其"),
        "my" => Some("马来西亚"),
        "th" => Some("泰国"),
        "vn" => Some("越南"),
        "ph" => Some("菲律宾"),
        "id" => Some("印尼"),
        _ => None,
    }
}

fn node_matches_query(node_name: &str, query: &str) -> bool {
    if fuzzy_subsequence_match(node_name, query) {
        return true;
    }
    if let Some(alias) = region_alias(query) {
        return node_name.contains(alias);
    }
    false
}

fn handle_list_nodes(req: &HttpRequest, state: &AppState) -> HttpResponse {
    let profiles = state.profile_manager.get_profiles();
    let profile_names: HashMap<String, String> = profiles.iter().map(|p| (p.id.clone(), p.name.clone())).collect();
    let delays = state.latency_probe.get_latencies();

    let all_nodes = state.profile_manager.get_all_nodes();
    let filter_profile_ids: Option<Vec<String>> =
        if let Some(sub) = req.query.get("sub").filter(|s| !s.trim().is_empty()) {
            if let Some(exact) = resolve_profile(&profiles, sub) {
                Some(vec![exact.id.clone()])
            } else {
                let matched: Vec<String> = profiles
                    .iter()
                    .filter(|p| fuzzy_subsequence_match(&p.name, sub))
                    .map(|p| p.id.clone())
                    .collect();
                if matched.is_empty() {
                    return HttpResponse::err(404, "Not Found", format!("subscription '{sub}' not found"));
                }
                Some(matched)
            }
        } else {
            None
        };
    let node_query = req.query.get("q").filter(|s| !s.trim().is_empty()).map(String::as_str);

    let mut items: Vec<NodeListItem> = all_nodes
        .into_iter()
        .enumerate()
        .filter(|(_, node)| {
            let sub_ok = filter_profile_ids.as_ref().is_none_or(|pids| {
                node.profile_id
                    .as_deref()
                    .is_some_and(|pid| pids.iter().any(|id| id == pid))
            });
            let query_ok = node_query.is_none_or(|q| node_matches_query(&node.name, q));
            sub_ok && query_ok
        })
        .map(|(idx, node)| {
            let delay = delays.get(&node.name).copied().flatten();
            let profile_id = node.profile_id.unwrap_or_default();
            let profile_name = profile_names
                .get(&profile_id)
                .cloned()
                .unwrap_or_else(|| profile_id.clone());
            NodeListItem {
                index: idx + 1,
                name: node.name,
                runtime_name: node.runtime_name,
                protocol: node.node_type,
                profile_id,
                profile_name,
                delay,
            }
        })
        .collect();
    items.sort_by(|a, b| match (a.delay, b.delay) {
        (Some(da), Some(db)) => da.cmp(&db),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    });
    HttpResponse::ok(&items)
}

async fn handle_test_node(req: &HttpRequest, state: &AppState) -> HttpResponse {
    let body: TestNodeRequest = match parse_json_body(&req.body) {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    if !state.engine.get_status().running {
        return HttpResponse::err(409, "Conflict", "Mihomo core is not running");
    }

    let (default_url, default_timeout) = {
        let cfg = state.config.read();
        (cfg.test_url.clone(), cfg.timeout_ms)
    };
    let actual_url = body.test_url.as_deref().unwrap_or(&default_url);
    let actual_timeout = body.timeout_ms.unwrap_or(default_timeout);

    let all_nodes = state.profile_manager.get_all_nodes();
    let query = body.node.trim();
    let target_node = query
        .parse::<usize>()
        .ok()
        .filter(|&idx| idx >= 1)
        .and_then(|idx| all_nodes.get(idx - 1))
        .or_else(|| {
            all_nodes
                .iter()
                .find(|n| n.name == query || n.runtime_name.as_deref() == Some(query))
        })
        .or_else(|| all_nodes.iter().find(|n| strip_flag_prefix(&n.name) == query))
        .cloned();
    let Some(target_node) = target_node else {
        return HttpResponse::err(404, "Not Found", format!("node '{query}' not found"));
    };

    if let Some(pid) = &target_node.profile_id {
        let profiles = state.profile_manager.get_profiles();
        if let Some(profile) = profiles.iter().find(|p| &p.id == pid)
            && !profile.enabled
        {
            return HttpResponse::err(
                409,
                "Conflict",
                format!(
                    "node '{}' belongs to disabled subscription '{}'",
                    target_node.name, profile.name
                ),
            );
        }
    }

    let raw_name = target_node.name;
    let runtime_name = target_node.runtime_name;

    match state
        .latency_probe
        .test_node(
            &raw_name,
            runtime_name.as_deref(),
            Some(actual_url),
            Some(actual_timeout),
            None,
        )
        .await
    {
        Ok(delay) => HttpResponse::ok(&serde_json::json!({
            "node": raw_name,
            "delay": delay,
        })),
        Err(err) => {
            let msg = err.to_string();
            if msg.contains("504") || msg.contains("Timeout") || msg.contains("timeout") {
                HttpResponse::ok(&serde_json::json!({
                    "node": raw_name,
                    "delay": Option::<u32>::None,
                }))
            } else {
                HttpResponse::err(502, "Bad Gateway", msg)
            }
        }
    }
}

fn strip_flag_prefix(raw: &str) -> String {
    raw.chars()
        .filter(|&ch| !('\u{1F1E6}'..='\u{1F1FF}').contains(&ch) && ch != '\u{FE0F}')
        .collect::<String>()
        .trim()
        .to_string()
}

async fn handle_test_sub(req: &HttpRequest, state: &AppState) -> HttpResponse {
    let body: TestSubRequest = match parse_json_body(&req.body) {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    if !state.engine.get_status().running {
        return HttpResponse::err(409, "Conflict", "Mihomo core is not running");
    }

    let (default_url, default_timeout) = {
        let cfg = state.config.read();
        (cfg.test_url.clone(), cfg.timeout_ms)
    };
    let actual_url = body.test_url.as_deref().unwrap_or(&default_url);
    let actual_timeout = body.timeout_ms.unwrap_or(default_timeout);

    let profiles = state.profile_manager.get_profiles();
    let nodes = if let Some(target) = &body.target {
        let Some(profile) = resolve_profile(&profiles, target) else {
            return HttpResponse::err(404, "Not Found", format!("subscription '{target}' not found"));
        };
        match state.profile_manager.get_profile_nodes(&profile.id) {
            Ok(n) => n,
            Err(err) => return HttpResponse::err(500, "Internal Server Error", err.to_string()),
        }
    } else if body.all || body.target.is_none() {
        state.profile_manager.get_all_nodes()
    } else {
        Vec::new()
    };

    let targets: Vec<crate::core::latency_probe::BatchProbeTarget> = nodes
        .into_iter()
        .map(|n| {
            let mut t = crate::core::latency_probe::BatchProbeTarget::new(n.name);
            if let Some(rn) = n.runtime_name {
                t = t.with_runtime_name(rn);
            }
            t
        })
        .collect();
    let results = state
        .latency_probe
        .test_nodes_batch(&targets, Some(actual_url), Some(actual_timeout), Some(8))
        .await;
    HttpResponse::ok(&results)
}

async fn handle_set_sysproxy(req: &HttpRequest, state: &AppState) -> HttpResponse {
    let body: ToggleProxyRequest = match parse_json_body(&req.body) {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    match state.apply_system_proxy_transition(body.enabled, body.port) {
        Ok((status, old_tun_enabled)) => {
            if body.enabled && old_tun_enabled {
                let _ = state.sync_runtime_config().await;
            }
            refresh_tray_if_available(state);
            HttpResponse::ok(&status)
        }
        Err(err) => HttpResponse::err(400, "Bad Request", err),
    }
}

async fn handle_set_tun(req: &HttpRequest, state: &AppState) -> HttpResponse {
    let body: ToggleProxyRequest = match parse_json_body(&req.body) {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    if body.enabled && !crate::core::elevation::is_elevated() {
        return HttpResponse::err(
            403,
            "Forbidden",
            "TUN mode requires administrator privileges; please run Mihomo Multi as administrator",
        );
    }

    if let Err(err) = state.prepare_tun_transition(body.enabled, body.port) {
        return HttpResponse::err(400, "Bad Request", err);
    }

    if let Err(err) = state.sync_runtime_config().await {
        let _ = state.rollback_tun_transition();
        return HttpResponse::err(500, "Internal Server Error", err.to_string());
    }

    refresh_tray_if_available(state);
    HttpResponse::ok(&state.build_tun_status())
}

async fn handle_set_env(req: &HttpRequest, state: &AppState) -> HttpResponse {
    let body: EnvProxyRequest = match parse_json_body(&req.body) {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    let shell = match body.shell.as_deref() {
        Some(raw) => match ShellKind::parse(raw) {
            Some(kind) => kind,
            None => return HttpResponse::err(400, "Bad Request", format!("unsupported shell: {raw}")),
        },
        None => ShellKind::default_for_platform(),
    };

    let state_clone = state.clone();
    let enabled = body.enabled;
    let port = body.port;
    let transition = tokio::task::spawn_blocking(move || state_clone.apply_env_proxy_transition(enabled, port)).await;

    let status = match transition {
        Ok(Ok(status)) => status,
        Ok(Err(err)) => return HttpResponse::err(400, "Bad Request", err),
        Err(err) => return HttpResponse::err(500, "Internal Server Error", format!("task join error: {err}")),
    };

    refresh_tray_if_available(state);

    let command = if status.enabled {
        let bound_port = status.port.unwrap_or_default();
        let protocol = state
            .port_router
            .get_port_mappings()
            .into_iter()
            .find(|m| m.port == bound_port)
            .map(|m| m.protocol)
            .unwrap_or(InboundProtocol::Mixed);
        let user_bypass = state.config.read().system_proxy_bypass_user.clone();
        match build_env_set_command(shell, "127.0.0.1", bound_port, protocol, &user_bypass) {
            Ok(cmd) => cmd,
            Err(EnvFormatError::CmdUnsafeChars) => {
                return HttpResponse::err(
                    400,
                    "Bad Request",
                    "bypass list contains characters unsafe for CMD; use PowerShell or Shell",
                );
            }
        }
    } else {
        build_env_unset_command(shell)
    };

    HttpResponse::ok(&EnvProxyActionResponse { status, shell, command })
}

async fn handle_probe_ip(req: &HttpRequest, state: &AppState) -> HttpResponse {
    let body: IpProbeRequest = match parse_json_body(&req.body) {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    let mappings = state.port_router.get_port_mappings();
    let Some(mapping) = mappings.into_iter().find(|m| m.port == body.port) else {
        return HttpResponse::err(404, "Not Found", format!("port mapping {} not found", body.port));
    };
    if !mapping.enabled {
        return HttpResponse::err(409, "Conflict", format!("port mapping {} is disabled", body.port));
    }

    match egress_probe::query_port_egress_info(mapping.port, mapping.protocol, body.timeout_ms).await {
        Ok(info) => HttpResponse::ok(&info),
        Err(err) => HttpResponse::err(502, "Bad Gateway", err.to_string()),
    }
}

fn handle_copy(req: &HttpRequest, state: &AppState) -> HttpResponse {
    let Some(port) = req.query.get("port").and_then(|s| s.parse::<u16>().ok()) else {
        return HttpResponse::err(400, "Bad Request", "missing or invalid query parameter 'port'");
    };

    let shell = match req.query.get("shell") {
        Some(raw) if !raw.trim().is_empty() => match ShellKind::parse(raw) {
            Some(kind) => kind,
            None => return HttpResponse::err(400, "Bad Request", format!("unsupported shell: {raw}")),
        },
        _ => ShellKind::default_for_platform(),
    };

    let mappings = state.port_router.get_port_mappings();
    let Some(mapping) = mappings.into_iter().find(|m| m.port == port) else {
        return HttpResponse::err(404, "Not Found", format!("port mapping {port} not found"));
    };

    let user_bypass = state.config.read().system_proxy_bypass_user.clone();
    let host = "127.0.0.1";

    if let Some(raw_fmt) = req.query.get("format").filter(|s| !s.trim().is_empty()) {
        let Some(fmt) = CopyFormat::parse(raw_fmt) else {
            return HttpResponse::err(
                400,
                "Bad Request",
                format!("unsupported format '{raw_fmt}'; expected env, host, http, socks5, or curl"),
            );
        };
        match build_copy_value(fmt, shell, host, mapping.port, mapping.protocol, &user_bypass) {
            Ok(value) => HttpResponse::ok(&CopyItem {
                format: fmt.as_str().to_string(),
                value,
            }),
            Err(EnvFormatError::CmdUnsafeChars) => HttpResponse::err(
                400,
                "Bad Request",
                "bypass list contains characters unsafe for CMD; use PowerShell or Shell",
            ),
        }
    } else {
        match build_all_copy_values(shell, host, mapping.port, mapping.protocol, &user_bypass) {
            Ok(pairs) => {
                let items: Vec<CopyItem> = pairs
                    .into_iter()
                    .map(|(fmt, value)| CopyItem {
                        format: fmt.as_str().to_string(),
                        value,
                    })
                    .collect();
                HttpResponse::ok(&items)
            }
            Err(EnvFormatError::CmdUnsafeChars) => HttpResponse::err(
                400,
                "Bad Request",
                "bypass list contains characters unsafe for CMD; use PowerShell or Shell",
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn send_raw(port: u16, req: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port))
            .await
            .expect("connect ctl server");
        stream.write_all(req.as_bytes()).await.expect("write request");
        let mut resp = String::new();
        stream.read_to_string(&mut resp).await.expect("read response");
        resp
    }

    #[tokio::test]
    async fn ctl_server_auth_status_copy_and_cleanup() {
        let temp_dir = std::env::temp_dir().join(format!("mhm-ctl-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).expect("create temp dir");

        let state = AppState::new(temp_dir.clone());
        let test_port = crate::models::DEFAULT_DIRECT_PORT;
        let mut handle = start_ctl_server(state).await.expect("start ctl server");
        let port = handle.info.port;
        let token = handle.info.token.clone();

        // ctl.json exists with matching port and token
        let ctl_path = temp_dir.join(CTL_FILE_NAME);
        let written: CtlDiscoveryInfo =
            serde_json::from_str(&std::fs::read_to_string(&ctl_path).expect("read ctl.json")).expect("parse ctl.json");
        assert_eq!(written.port, port);
        assert_eq!(written.token, token);

        // Unauthorized request rejected with 401
        let unauth = send_raw(port, "GET /v1/status HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").await;
        assert!(unauth.starts_with("HTTP/1.1 401 Unauthorized"));

        // Authorized GET /v1/status succeeds
        let status_req = format!("GET /v1/status HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\n\r\n");
        let status_resp = send_raw(port, &status_req).await;
        assert!(status_resp.starts_with("HTTP/1.1 200 OK"));
        assert!(status_resp.contains("\"ok\":true"));
        assert!(status_resp.contains("\"totalPorts\":1"));

        // Authorized GET /v1/copy returns requested format
        let copy_req = format!(
            "GET /v1/copy?port={test_port}&format=http HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\n\r\n"
        );
        let copy_resp = send_raw(port, &copy_req).await;
        assert!(
            copy_resp.starts_with("HTTP/1.1 200 OK"),
            "unexpected copy_resp: {copy_resp}"
        );
        assert!(copy_resp.contains(&format!("http://127.0.0.1:{test_port}")));
        // Authorized POST /v1/env off returns unset command
        let env_body = r#"{"enabled":false,"shell":"pwsh"}"#;
        let env_req = format!(
            "POST /v1/env HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nContent-Length: {}\r\n\r\n{env_body}",
            env_body.len()
        );
        let env_resp = send_raw(port, &env_req).await;
        assert!(env_resp.starts_with("HTTP/1.1 200 OK"));
        assert!(env_resp.contains("Remove-Item Env:HTTP_PROXY"));

        // Shutdown removes ctl.json
        handle.shutdown();
        assert!(!ctl_path.exists());
        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
