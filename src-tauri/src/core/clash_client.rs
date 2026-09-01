use crate::error::{AppError, AppResult};
use crate::models::NodeLatencyResult;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use tracing::{debug, error, info, warn};

pub const DEFAULT_TEST_URL: &str = "http://cp.cloudflare.com/generate_204";
pub const DEFAULT_TEST_TIMEOUT_MS: u32 = 5000;
pub const DEFAULT_BATCH_CONCURRENCY: usize = 10;

#[derive(Clone)]
pub struct ClashApiClient {
    base_url: String,
    secret: String,
    http_client: reqwest::Client,
}

impl ClashApiClient {
    pub fn new(controller_port: u16, secret: &str) -> Self {
        let mut headers = HeaderMap::new();
        let trimmed_secret = secret.trim();
        if !trimmed_secret.is_empty()
            && let Ok(val) = HeaderValue::from_str(&format!("Bearer {}", trimmed_secret))
        {
            headers.insert(AUTHORIZATION, val);
        }

        let http_client = reqwest::Client::builder()
            .default_headers(headers)
            .timeout(Duration::from_secs(10))
            .connect_timeout(Duration::from_secs(5))
            .build()
            .unwrap_or_default();

        Self {
            base_url: format!("http://127.0.0.1:{}", controller_port),
            secret: trimmed_secret.to_string(),
            http_client,
        }
    }

    /// Hot-reloads Mihomo configuration via PUT /configs?force=true
    pub async fn reload_config(&self, config_path: &str) -> AppResult<()> {
        let url = format!("{}/configs?force=true", self.base_url);
        let payload = serde_json::json!({
            "path": config_path,
        });

        debug!("Sending config reload request to '{}' with path: {}", url, config_path);

        let mut req = self.http_client.put(&url).json(&payload);
        if !self.secret.is_empty() {
            req = req.header(AUTHORIZATION, format!("Bearer {}", self.secret));
        }

        let resp = req.send().await.map_err(|err| {
            AppError::ExternalController(format!("Failed to connect to Mihomo external controller: {}", err))
        })?;

        let status = resp.status();
        if status.is_success() || status.as_u16() == 204 {
            info!("Mihomo configuration reloaded successfully");
            Ok(())
        } else {
            let error_text = resp.text().await.unwrap_or_default();
            error!("Mihomo reload config failed (status {}): {}", status, error_text);
            Err(AppError::ExternalController(format!(
                "Mihomo config reload failed with status {}: {}",
                status, error_text
            )))
        }
    }

    /// Query delay for a single proxy node via GET /proxies/{name}/delay
    pub async fn test_delay(
        &self,
        node_name: &str,
        test_url: Option<&str>,
        timeout_ms: Option<u32>,
    ) -> AppResult<u32> {
        let actual_url = test_url.unwrap_or(DEFAULT_TEST_URL);
        let actual_timeout = timeout_ms.unwrap_or(DEFAULT_TEST_TIMEOUT_MS);

        let encoded_name = urlencoding::encode(node_name);
        let encoded_url = urlencoding::encode(actual_url);

        let request_url = format!(
            "{}/proxies/{}/delay?url={}&timeout={}",
            self.base_url, encoded_name, encoded_url, actual_timeout
        );

        debug!("Testing delay for node '{}': {}", node_name, request_url);

        let client_timeout = Duration::from_millis(u64::from(actual_timeout) + 1500);

        let mut req = self.http_client.get(&request_url).timeout(client_timeout);
        if !self.secret.is_empty() {
            req = req.header(AUTHORIZATION, format!("Bearer {}", self.secret));
        }

        let resp = req.send().await.map_err(|err| {
            AppError::ExternalController(format!("Request to Mihomo delay API failed: {}", err))
        })?;

        let status = resp.status();
        if status.is_success() {
            let json: serde_json::Value = resp.json().await.map_err(|err| {
                AppError::ExternalController(format!("Invalid JSON from Mihomo delay API: {}", err))
            })?;

            if let Some(delay) = json.get("delay").and_then(|v| v.as_u64()) {
                Ok(delay as u32)
            } else {
                Err(AppError::ExternalController(
                    "Missing 'delay' field in Mihomo response".to_string(),
                ))
            }
        } else {
            let error_text = resp.text().await.unwrap_or_default();
            Err(AppError::ExternalController(format!(
                "Node delay test failed (status {}): {}",
                status, error_text
            )))
        }
    }

    /// Test latency for multiple nodes concurrently with a semaphore-controlled JoinSet
    pub async fn test_nodes_delay_batch(
        &self,
        node_names: &[String],
        test_url: Option<&str>,
        timeout_ms: Option<u32>,
        concurrency: Option<usize>,
    ) -> Vec<NodeLatencyResult> {
        if node_names.is_empty() {
            return Vec::new();
        }

        let max_concurrency = concurrency.unwrap_or(DEFAULT_BATCH_CONCURRENCY).max(1);
        let semaphore = Arc::new(Semaphore::new(max_concurrency));
        let mut join_set = JoinSet::new();

        for (index, name) in node_names.iter().enumerate() {
            let client = self.clone();
            let node_name = name.clone();
            let url_opt = test_url.map(|s| s.to_string());
            let permit = semaphore.clone();

            join_set.spawn(async move {
                let _permit = permit.acquire().await.ok();

                // Stagger requests to prevent connection bursts and queueing latency
                if index > 0 {
                    let stagger_ms = ((index % 8) as u64) * 25;
                    tokio::time::sleep(Duration::from_millis(stagger_ms)).await;
                }

                let res = client
                    .test_delay(&node_name, url_opt.as_deref(), timeout_ms)
                    .await;

                let (latency, error) = match res {
                    Ok(delay) => (Some(delay), None),
                    Err(err) => (None, Some(err.to_string())),
                };

                (index, NodeLatencyResult {
                    name: node_name,
                    latency,
                    error,
                })
            });
        }

        let mut results_with_index = Vec::with_capacity(node_names.len());
        while let Some(res) = join_set.join_next().await {
            match res {
                Ok((index, result)) => {
                    results_with_index.push((index, result));
                }
                Err(join_err) => {
                    warn!("Batch latency test task join error: {}", join_err);
                }
            }
        }

        // Sort by original index to preserve input order
        results_with_index.sort_by_key(|(idx, _)| *idx);
        results_with_index.into_iter().map(|(_, item)| item).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn test_clash_client_single_delay_success() {
        // Spin up a mock HTTP server on an ephemeral port
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("Bind test server");
        let port = listener.local_addr().expect("Get port").port();

        tokio::spawn(async move {
            if let Ok((mut socket, _)) = listener.accept().await {
                let mut buf = vec![0u8; 1024];
                let _ = socket.read(&mut buf).await;

                let response_body = r#"{"delay": 88}"#;
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                    response_body.len(),
                    response_body
                );
                let _ = socket.write_all(response.as_bytes()).await;
            }
        });

        let client = ClashApiClient::new(port, "test-secret");
        let delay = client
            .test_delay("HK-Node-01", None, Some(1000))
            .await
            .expect("Delay test should succeed");

        assert_eq!(delay, 88);
    }

    #[tokio::test]
    async fn test_clash_client_single_delay_error() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("Bind test server");
        let port = listener.local_addr().expect("Get port").port();

        tokio::spawn(async move {
            if let Ok((mut socket, _)) = listener.accept().await {
                let mut buf = vec![0u8; 1024];
                let _ = socket.read(&mut buf).await;

                let response_body = r#"{"message": "timeout"}"#;
                let response = format!(
                    "HTTP/1.1 504 Gateway Timeout\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                    response_body.len(),
                    response_body
                );
                let _ = socket.write_all(response.as_bytes()).await;
            }
        });

        let client = ClashApiClient::new(port, "test-secret");
        let res = client.test_delay("US-Node-02", None, Some(500)).await;

        assert!(res.is_err());
    }

    #[tokio::test]
    async fn test_clash_client_batch_delay_testing() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("Bind test server");
        let port = listener.local_addr().expect("Get port").port();

        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 1024];
                    if let Ok(n) = socket.read(&mut buf).await
                        && n > 0
                    {
                        let req_str = String::from_utf8_lossy(&buf[..n]);
                        if req_str.contains("HK-01") {
                            let response_body = r#"{"delay": 42}"#;
                            let response = format!(
                                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                                response_body.len(),
                                response_body
                            );
                            let _ = socket.write_all(response.as_bytes()).await;
                        } else if req_str.contains("JP-02") {
                            let response_body = r#"{"delay": 95}"#;
                            let response = format!(
                                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                                response_body.len(),
                                response_body
                            );
                            let _ = socket.write_all(response.as_bytes()).await;
                        } else {
                            let response = "HTTP/1.1 504 Gateway Timeout\r\nContent-Length: 0\r\n\r\n";
                            let _ = socket.write_all(response.as_bytes()).await;
                        }
                    }
                });
            }
        });

        let client = ClashApiClient::new(port, "test-secret");
        let nodes = vec![
            "HK-01".to_string(),
            "JP-02".to_string(),
            "Timeout-03".to_string(),
        ];

        let results = client
            .test_nodes_delay_batch(&nodes, None, Some(1000), Some(4))
            .await;

        assert_eq!(results.len(), 3);
        assert_eq!(results[0].name, "HK-01");
        assert_eq!(results[0].latency, Some(42));
        assert!(results[0].error.is_none());

        assert_eq!(results[1].name, "JP-02");
        assert_eq!(results[1].latency, Some(95));
        assert!(results[1].error.is_none());

        assert_eq!(results[2].name, "Timeout-03");
        assert_eq!(results[2].latency, None);
        assert!(results[2].error.is_some());
    }

    #[tokio::test]
    async fn test_clash_client_reload_config() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("Bind test server");
        let port = listener.local_addr().expect("Get port").port();

        tokio::spawn(async move {
            if let Ok((mut socket, _)) = listener.accept().await {
                let mut buf = vec![0u8; 1024];
                let _ = socket.read(&mut buf).await;

                let response = "HTTP/1.1 204 No Content\r\n\r\n";
                let _ = socket.write_all(response.as_bytes()).await;
            }
        });

        let client = ClashApiClient::new(port, "test-secret");
        let res = client.reload_config("C:/dummy/runtime.yaml").await;
        assert!(res.is_ok());
    }
}
