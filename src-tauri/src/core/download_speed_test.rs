use crate::core::latency_probe::CancellationToken;
use crate::error::{AppError, AppResult};
use crate::models::{DownloadSpeedProgressPayload, DownloadSpeedTestResult, InboundProtocol};
use parking_lot::Mutex;
use std::sync::LazyLock;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub const DEFAULT_MAX_BYTES: u64 = 100 * 1024 * 1024; // 100 MiB
pub const MIN_MAX_BYTES: u64 = 1024 * 1024; // 1 MiB
pub const MAX_MAX_BYTES: u64 = 1024 * 1024 * 1024; // 1024 MiB
pub const DEFAULT_MAX_DURATION_MS: u64 = 8_000;
pub const MIN_MAX_DURATION_MS: u64 = 1_000;
pub const MAX_MAX_DURATION_MS: u64 = 60_000;
const CONNECT_TIMEOUT_SECS: u64 = 8;
const HANDSHAKE_TIMEOUT_SECS: u64 = 10;
const PROGRESS_INTERVAL_MS: u128 = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DownloadSpeedSource {
    pub id: &'static str,
    pub name: &'static str,
    pub url: &'static str,
}

const BROWSER_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

pub const DOWNLOAD_SPEED_SOURCES: &[DownloadSpeedSource] = &[
    DownloadSpeedSource {
        id: "cloudflare",
        name: "Cloudflare CDN",
        url: "https://speed.cloudflare.com/__down?bytes=104857600",
    },
    DownloadSpeedSource {
        id: "google",
        name: "Google CDN",
        url: "https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb",
    },
    DownloadSpeedSource {
        id: "microsoft",
        name: "Microsoft Azure CDN",
        url: "https://update.code.visualstudio.com/latest/win32-x64-archive/stable",
    },
    DownloadSpeedSource {
        id: "ovh",
        name: "OVH Global",
        url: "https://proof.ovh.net/files/1Gb.dat",
    },
];

static ACTIVE_DOWNLOAD_TOKEN: LazyLock<Mutex<Option<CancellationToken>>> = LazyLock::new(|| Mutex::new(None));

pub fn cancel_active_download_speed_test() {
    if let Some(token) = ACTIVE_DOWNLOAD_TOKEN.lock().take() {
        token.cancel();
    }
}

fn register_active_token(token: CancellationToken) {
    let mut guard = ACTIVE_DOWNLOAD_TOKEN.lock();
    if let Some(prev) = guard.take() {
        prev.cancel();
    }
    *guard = Some(token);
}

fn clear_active_token(token: &CancellationToken) {
    let mut guard = ACTIVE_DOWNLOAD_TOKEN.lock();
    if let Some(current) = guard.as_ref()
        && current.is_cancelled() == token.is_cancelled()
    {
        *guard = None;
    }
}

fn protocol_to_proxy_scheme(protocol: InboundProtocol) -> &'static str {
    match protocol {
        InboundProtocol::Socks5 => "socks5h",
        InboundProtocol::Mixed | InboundProtocol::Http => "http",
    }
}

fn resolve_candidate_sources(source: Option<&str>) -> AppResult<Vec<DownloadSpeedSource>> {
    let trimmed = source.map(str::trim).filter(|s| !s.is_empty());
    match trimmed {
        None | Some("auto") => Ok(DOWNLOAD_SPEED_SOURCES.to_vec()),
        Some(id) => DOWNLOAD_SPEED_SOURCES
            .iter()
            .copied()
            .find(|item| item.id.eq_ignore_ascii_case(id))
            .map(|item| vec![item])
            .ok_or_else(|| AppError::Internal(format!("Unknown speed test source: {id}"))),
    }
}

enum SourceOpenOutcome {
    Ready(DownloadSpeedSource, reqwest::Response),
    Cancelled,
    AllFailed(String),
}

fn source_request_url(source: DownloadSpeedSource, byte_limit: Option<u64>) -> String {
    if source.id == "cloudflare" {
        let req_bytes = match byte_limit {
            Some(limit) => limit.clamp(MIN_MAX_BYTES, 1_000_000_000),
            None => 500_000_000,
        };
        return format!("https://speed.cloudflare.com/__down?bytes={req_bytes}");
    }
    source.url.to_string()
}

async fn open_first_available_source(
    client: &reqwest::Client,
    candidates: &[DownloadSpeedSource],
    byte_limit: Option<u64>,
    token: &CancellationToken,
) -> SourceOpenOutcome {
    let mut errors = Vec::new();

    for &candidate in candidates {
        if token.is_cancelled() {
            return SourceOpenOutcome::Cancelled;
        }

        let request_url = source_request_url(candidate, byte_limit);
        let mut req = client.get(request_url);
        if candidate.id == "cloudflare" {
            req = req.header(reqwest::header::REFERER, "https://speed.cloudflare.com/");
        }
        let request_fut = tokio::time::timeout(Duration::from_secs(HANDSHAKE_TIMEOUT_SECS), req.send());

        let response = tokio::select! {
            _ = token.cancelled() => return SourceOpenOutcome::Cancelled,
            res = request_fut => match res {
                Ok(Ok(resp)) => resp,
                Ok(Err(e)) => {
                    errors.push(format!("{}: {e}", candidate.name));
                    continue;
                }
                Err(_) => {
                    errors.push(format!("{}: request timed out", candidate.name));
                    continue;
                }
            }
        };

        if response.status().is_success() {
            return SourceOpenOutcome::Ready(candidate, response);
        }

        errors.push(format!("{}: HTTP {}", candidate.name, response.status()));
    }

    SourceOpenOutcome::AllFailed(errors.join("; "))
}

pub async fn run_download_speed_test(
    proxy_port: u16,
    protocol: InboundProtocol,
    source: Option<&str>,
    max_bytes: Option<u64>,
    max_duration_ms: Option<u64>,
    app_handle: Option<AppHandle>,
) -> AppResult<DownloadSpeedTestResult> {
    let candidates = resolve_candidate_sources(source)?;
    let byte_limit = match max_bytes {
        Some(0) => None,
        Some(v) => Some(v.clamp(MIN_MAX_BYTES, MAX_MAX_BYTES)),
        None => Some(DEFAULT_MAX_BYTES),
    };
    let duration_limit_ms = max_duration_ms
        .unwrap_or(DEFAULT_MAX_DURATION_MS)
        .clamp(MIN_MAX_DURATION_MS, MAX_MAX_DURATION_MS);
    let duration_limit = Duration::from_millis(duration_limit_ms);

    let token = CancellationToken::new();
    register_active_token(token.clone());

    let scheme = protocol_to_proxy_scheme(protocol);
    let proxy_url = format!("{scheme}://127.0.0.1:{proxy_port}");
    let client = reqwest::Client::builder()
        .user_agent(BROWSER_USER_AGENT)
        .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .no_proxy()
        .proxy(reqwest::Proxy::all(&proxy_url)?)
        .build()
        .map_err(AppError::Network)?;

    let (active_source, mut resp) = match open_first_available_source(&client, &candidates, byte_limit, &token).await {
        SourceOpenOutcome::Ready(src, resp) => (src, resp),
        SourceOpenOutcome::Cancelled => {
            clear_active_token(&token);
            return Ok(DownloadSpeedTestResult {
                downloaded_bytes: 0,
                elapsed_ms: 0,
                avg_bytes_per_sec: 0.0,
                cancelled: true,
                limited_by: "cancelled".to_string(),
                source_name: String::new(),
            });
        }
        SourceOpenOutcome::AllFailed(reason) => {
            clear_active_token(&token);
            return Err(AppError::Internal(format!("All speed test sources failed: {reason}")));
        }
    };

    let start = Instant::now();
    let mut last_emit = Instant::now();
    let mut downloaded_bytes: u64 = 0;
    let mut cancelled = false;
    let limited_by;

    loop {
        let elapsed = start.elapsed();
        if elapsed >= duration_limit {
            limited_by = "duration_limit".to_string();
            break;
        }
        let remaining = duration_limit.saturating_sub(elapsed);

        tokio::select! {
            _ = token.cancelled() => {
                cancelled = true;
                limited_by = "cancelled".to_string();
                break;
            }
            _ = tokio::time::sleep(remaining) => {
                limited_by = "duration_limit".to_string();
                break;
            }
            chunk_res = resp.chunk() => {
                match chunk_res {
                    Ok(Some(chunk)) => {
                        downloaded_bytes = downloaded_bytes.saturating_add(chunk.len() as u64);
                        if let Some(limit) = byte_limit
                            && downloaded_bytes >= limit
                        {
                            downloaded_bytes = limit;
                            limited_by = "byte_limit".to_string();
                            break;
                        }
                        if last_emit.elapsed().as_millis() >= PROGRESS_INTERVAL_MS {
                            let elapsed_ms = start.elapsed().as_millis() as u64;
                            let speed_bps = if elapsed_ms > 0 {
                                (downloaded_bytes as f64) / (elapsed_ms as f64 / 1000.0)
                            } else {
                                0.0
                            };
                            if let Some(handle) = app_handle.as_ref() {
                                let _ = handle.emit(
                                    "download-speed-progress",
                                    DownloadSpeedProgressPayload {
                                        downloaded_bytes,
                                        elapsed_ms,
                                        speed_bytes_per_sec: speed_bps,
                                        source_name: active_source.name.to_string(),
                                    },
                                );
                            }
                            last_emit = Instant::now();
                        }
                    }
                    Ok(None) => {
                        limited_by = "completed".to_string();
                        break;
                    }
                    Err(e) => {
                        clear_active_token(&token);
                        return Err(AppError::Network(e));
                    }
                }
            }
        }
    }

    clear_active_token(&token);

    let elapsed_ms = start.elapsed().as_millis().max(1) as u64;
    let avg_bytes_per_sec = (downloaded_bytes as f64) / (elapsed_ms as f64 / 1000.0);

    if let Some(handle) = app_handle.as_ref() {
        let _ = handle.emit(
            "download-speed-progress",
            DownloadSpeedProgressPayload {
                downloaded_bytes,
                elapsed_ms,
                speed_bytes_per_sec: avg_bytes_per_sec,
                source_name: active_source.name.to_string(),
            },
        );
    }

    Ok(DownloadSpeedTestResult {
        downloaded_bytes,
        elapsed_ms,
        avg_bytes_per_sec,
        cancelled,
        limited_by,
        source_name: active_source.name.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_protocol_to_proxy_scheme() {
        assert_eq!(protocol_to_proxy_scheme(InboundProtocol::Socks5), "socks5h");
        assert_eq!(protocol_to_proxy_scheme(InboundProtocol::Http), "http");
        assert_eq!(protocol_to_proxy_scheme(InboundProtocol::Mixed), "http");
    }

    #[test]
    fn test_resolve_candidate_sources() {
        let auto = resolve_candidate_sources(None).expect("auto");
        assert_eq!(auto.len(), DOWNLOAD_SPEED_SOURCES.len());
        assert_eq!(auto[0].id, "cloudflare");

        let explicit_auto = resolve_candidate_sources(Some("auto")).expect("explicit auto");
        assert_eq!(explicit_auto.len(), DOWNLOAD_SPEED_SOURCES.len());

        let single = resolve_candidate_sources(Some("google")).expect("google");
        assert_eq!(single.len(), 1);
        assert_eq!(single[0].id, "google");

        assert!(resolve_candidate_sources(Some("nonexistent")).is_err());
    }

    #[test]
    fn test_source_request_url_cloudflare_scales_with_limit() {
        let cf = DOWNLOAD_SPEED_SOURCES[0];
        assert_eq!(
            source_request_url(cf, Some(100 * 1024 * 1024)),
            "https://speed.cloudflare.com/__down?bytes=104857600"
        );
        assert_eq!(
            source_request_url(cf, None),
            "https://speed.cloudflare.com/__down?bytes=500000000"
        );
    }
}
