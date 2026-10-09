use crate::error::{AppError, AppResult};
use crate::models::{ConnectionSnapshot, NodeLatencyResult};
use reqwest::header::{AUTHORIZATION, HeaderMap, HeaderValue};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use tracing::{debug, error, info, warn};

pub const DEFAULT_TEST_URL: &str = "http://cp.cloudflare.com/generate_204";
pub const DEFAULT_TEST_TIMEOUT_MS: u32 = 5000;
pub const DEFAULT_BATCH_CONCURRENCY: usize = 10;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProxyHistoryItem {
    pub time: String,
    pub delay: u32,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProxyDetail {
    pub name: String,
    #[serde(rename = "type")]
    pub proxy_type: String,
    pub now: Option<String>,
    #[serde(default)]
    pub all: Vec<String>,
    #[serde(default)]
    pub history: Vec<ProxyHistoryItem>,
}
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
            .no_proxy()
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
    pub async fn test_delay(&self, node_name: &str, test_url: Option<&str>, timeout_ms: Option<u32>) -> AppResult<u32> {
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

        let resp = req
            .send()
            .await
            .map_err(|err| AppError::ExternalController(format!("Request to Mihomo delay API failed: {}", err)))?;

        let status = resp.status();
        if status.is_success() {
            let json: serde_json::Value = resp
                .json()
                .await
                .map_err(|err| AppError::ExternalController(format!("Invalid JSON from Mihomo delay API: {}", err)))?;

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

                let res = client.test_delay(&node_name, url_opt.as_deref(), timeout_ms).await;

                let (latency, error) = match res {
                    Ok(delay) => (Some(delay), None),
                    Err(err) => (None, Some(err.to_string())),
                };

                (
                    index,
                    NodeLatencyResult {
                        name: node_name,
                        latency,
                        error,
                    },
                )
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

    /// Fetches details for a proxy or proxy-group via GET /proxies/{name}
    pub async fn get_proxy_detail(&self, name: &str) -> AppResult<ProxyDetail> {
        let encoded_name = urlencoding::encode(name);
        let request_url = format!("{}/proxies/{}", self.base_url, encoded_name);

        let mut req = self.http_client.get(&request_url).timeout(Duration::from_secs(5));
        if !self.secret.is_empty() {
            req = req.header(AUTHORIZATION, format!("Bearer {}", self.secret));
        }

        let resp = req
            .send()
            .await
            .map_err(|err| AppError::ExternalController(format!("Failed to connect to Mihomo proxies API: {}", err)))?;

        let status = resp.status();
        if status.is_success() {
            let detail: ProxyDetail = resp
                .json()
                .await
                .map_err(|err| AppError::ExternalController(format!("Failed to parse proxy detail JSON: {}", err)))?;
            Ok(detail)
        } else {
            let error_text = resp.text().await.unwrap_or_default();
            Err(AppError::ExternalController(format!(
                "Failed to get proxy detail for '{}' (status {}): {}",
                name, status, error_text
            )))
        }
    }

    /// Triggers healthcheck and latency test for an entire proxy group via GET /group/{name}/delay
    pub async fn test_group_delay(
        &self,
        group_name: &str,
        test_url: Option<&str>,
        timeout_ms: Option<u32>,
    ) -> AppResult<()> {
        let actual_url = test_url.unwrap_or(DEFAULT_TEST_URL);
        let actual_timeout = timeout_ms.unwrap_or(DEFAULT_TEST_TIMEOUT_MS);

        let encoded_name = urlencoding::encode(group_name);
        let encoded_url = urlencoding::encode(actual_url);

        let request_url = format!(
            "{}/group/{}/delay?url={}&timeout={}",
            self.base_url, encoded_name, encoded_url, actual_timeout
        );

        let client_timeout = Duration::from_millis(u64::from(actual_timeout) + 1500);

        let mut req = self.http_client.get(&request_url).timeout(client_timeout);
        if !self.secret.is_empty() {
            req = req.header(AUTHORIZATION, format!("Bearer {}", self.secret));
        }

        let resp = req.send().await.map_err(|err| {
            AppError::ExternalController(format!("Request to Mihomo group delay API failed: {}", err))
        })?;

        let status = resp.status();
        if status.is_success() {
            Ok(())
        } else {
            let error_text = resp.text().await.unwrap_or_default();
            Err(AppError::ExternalController(format!(
                "Mihomo group delay API returned {}: {}",
                status, error_text
            )))
        }
    }

    /// Fetch current active connections snapshot via GET /connections
    pub async fn get_connections(&self) -> AppResult<ConnectionSnapshot> {
        let request_url = format!("{}/connections", self.base_url);
        let mut req = self.http_client.get(&request_url);
        if !self.secret.is_empty() {
            req = req.header(AUTHORIZATION, format!("Bearer {}", self.secret));
        }

        let resp = req.send().await.map_err(|err| {
            AppError::ExternalController(format!("Request to Mihomo connections API failed: {}", err))
        })?;

        let status = resp.status();
        if status.is_success() {
            let snapshot = resp.json::<ConnectionSnapshot>().await.map_err(|err| {
                AppError::ExternalController(format!("Failed to parse Mihomo connections response: {}", err))
            })?;
            Ok(snapshot)
        } else {
            let error_text = resp.text().await.unwrap_or_default();
            Err(AppError::ExternalController(format!(
                "Mihomo connections API returned {}: {}",
                status, error_text
            )))
        }
    }

    async fn delete_endpoint(&self, endpoint: &str, action_desc: &str) -> AppResult<()> {
        let request_url = format!("{}/{}", self.base_url, endpoint);
        let mut req = self.http_client.delete(&request_url);
        if !self.secret.is_empty() {
            req = req.header(AUTHORIZATION, format!("Bearer {}", self.secret));
        }

        let resp = req
            .send()
            .await
            .map_err(|err| AppError::ExternalController(format!("Request to {} failed: {}", action_desc, err)))?;

        let status = resp.status();
        if status.is_success() || status.as_u16() == 204 {
            Ok(())
        } else {
            let error_text = resp.text().await.unwrap_or_default();
            Err(AppError::ExternalController(format!(
                "Mihomo {} API returned {}: {}",
                action_desc, status, error_text
            )))
        }
    }

    /// Close a single active connection via DELETE /connections/{id}
    pub async fn close_connection(&self, id: &str) -> AppResult<()> {
        self.delete_endpoint(&format!("connections/{}", urlencoding::encode(id)), "close connection")
            .await
    }

    /// Close all active connections via DELETE /connections
    pub async fn close_all_connections(&self) -> AppResult<()> {
        self.delete_endpoint("connections", "close all connections").await
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
        let nodes = vec!["HK-01".to_string(), "JP-02".to_string(), "Timeout-03".to_string()];

        let results = client.test_nodes_delay_batch(&nodes, None, Some(1000), Some(4)).await;

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

    #[tokio::test]
    async fn test_clash_client_group_delay() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("Bind test server");
        let port = listener.local_addr().expect("Get port").port();

        tokio::spawn(async move {
            if let Ok((mut socket, _)) = listener.accept().await {
                let mut buf = vec![0u8; 1024];
                let _ = socket.read(&mut buf).await;

                let response_body = r#"{"HK-01": 42, "HK-02": 50}"#;
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                    response_body.len(),
                    response_body
                );
                let _ = socket.write_all(response.as_bytes()).await;
            }
        });

        let client = ClashApiClient::new(port, "test-secret");
        let res = client.test_group_delay("fb-7890", None, Some(1000)).await;
        assert!(res.is_ok());
    }

    #[tokio::test]
    async fn test_clash_client_get_connections() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("Bind test server");
        let port = listener.local_addr().expect("Get port").port();

        tokio::spawn(async move {
            if let Ok((mut socket, _)) = listener.accept().await {
                let mut buf = vec![0u8; 1024];
                let _ = socket.read(&mut buf).await;

                let response_body = r#"{
                    "downloadTotal": 10240,
                    "uploadTotal": 2048,
                    "connections": [
                        {
                            "id": "conn-uuid-1",
                            "metadata": {
                                "network": "tcp",
                                "type": "HTTP",
                                "sourceIP": "127.0.0.1",
                                "destinationIP": "1.1.1.1",
                                "sourcePort": "54321",
                                "destinationPort": "443",
                                "inboundPort": "7890",
                                "host": "cloudflare.com"
                            },
                            "upload": 100,
                            "download": 200,
                            "start": "2026-09-25T10:00:00Z",
                            "chains": ["HK-Node-01"],
                            "rule": "IN-PORT,7890,HK-Node-01"
                        }
                    ]
                }"#;
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                    response_body.len(),
                    response_body
                );
                let _ = socket.write_all(response.as_bytes()).await;
            }
        });

        let client = ClashApiClient::new(port, "test-secret");
        let snapshot = client.get_connections().await.expect("Get connections should succeed");
        assert_eq!(snapshot.download_total, 10240);
        assert_eq!(snapshot.upload_total, 2048);
        assert_eq!(snapshot.connections.len(), 1);
        assert_eq!(snapshot.connections[0].id, "conn-uuid-1");
        assert_eq!(snapshot.connections[0].metadata.host, "cloudflare.com");
        assert_eq!(snapshot.connections[0].metadata.inbound_port.as_deref(), Some("7890"));
    }

    #[tokio::test]
    async fn test_clash_client_close_connections() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("Bind test server");
        let port = listener.local_addr().expect("Get port").port();

        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                let mut buf = vec![0u8; 1024];
                let n = socket.read(&mut buf).await.unwrap_or(0);
                let req_str = String::from_utf8_lossy(&buf[..n]);
                if req_str.starts_with("DELETE") {
                    let response = "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n";
                    let _ = socket.write_all(response.as_bytes()).await;
                }
            }
        });

        let client = ClashApiClient::new(port, "test-secret");
        let res_single = client.close_connection("conn-uuid-1").await;
        assert!(res_single.is_ok());

        let res_all = client.close_all_connections().await;
        assert!(res_all.is_ok());
    }
}
