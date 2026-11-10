use crate::constants::APP_USER_AGENT;
use crate::error::{AppError, AppResult};
use crate::models::{FIXED_DIRECT_PORT_ID, InboundProtocol, PortMapping};
use crate::state::AppState;
use std::time::Duration;

/// One network egress candidate used by update checks and update downloads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpdateEgress {
    /// A local Mihomo listener bound to a specific proxy node.
    Proxy { port: u16, protocol: InboundProtocol },
    /// System direct connection, always the final fallback.
    Direct,
}

impl UpdateEgress {
    pub fn label(self) -> String {
        match self {
            Self::Proxy { port, protocol } => format!("{} 端口 {}", protocol, port),
            Self::Direct => "直连".to_string(),
        }
    }
}

/// Builds the ordered fallback chain: every enabled proxy listener in
/// port-mapping order, followed by a direct connection as the final guarantee.
/// The built-in DIRECT listener is skipped because `UpdateEgress::Direct`
/// already represents that egress.
pub fn build_egress_chain(mappings: &[PortMapping]) -> Vec<UpdateEgress> {
    let mut chain: Vec<UpdateEgress> = mappings
        .iter()
        .filter(|mapping| mapping.enabled && mapping.id != FIXED_DIRECT_PORT_ID)
        .map(|mapping| UpdateEgress::Proxy {
            port: mapping.port,
            protocol: mapping.protocol,
        })
        .collect();
    chain.push(UpdateEgress::Direct);
    chain
}

/// Resolves the current fallback chain from the live port router.
pub fn update_egress_chain(state: &AppState) -> Vec<UpdateEgress> {
    build_egress_chain(&state.port_router.get_port_mappings())
}

/// Builds an HTTP client bound to the given egress candidate.
pub fn build_update_client(
    egress: UpdateEgress,
    timeout: Duration,
    connect_timeout: Duration,
) -> AppResult<reqwest::Client> {
    let mut builder = reqwest::Client::builder()
        .user_agent(APP_USER_AGENT)
        .timeout(timeout)
        .connect_timeout(connect_timeout);

    match egress {
        UpdateEgress::Proxy { port, protocol } => {
            let scheme = match protocol {
                InboundProtocol::Socks5 => "socks5h",
                InboundProtocol::Mixed | InboundProtocol::Http => "http",
            };
            let proxy_url = format!("{}://127.0.0.1:{}", scheme, port);
            let proxy = reqwest::Proxy::all(&proxy_url)
                .map_err(|e| AppError::Internal(format!("Invalid proxy configuration for port {}: {}", port, e)))?;
            builder = builder.proxy(proxy);
        }
        UpdateEgress::Direct => {
            // Guarantee a true direct connection even when the app has set the
            // Windows system proxy or proxy environment variables.
            builder = builder.no_proxy();
        }
    }

    builder
        .build()
        .map_err(|e| AppError::Internal(format!("Failed to build HTTP client: {}", e)))
}

/// Fetches a URL as bytes, trying every egress candidate in order.
pub async fn fetch_bytes_with_fallback(
    chain: &[UpdateEgress],
    url: &str,
    timeout: Duration,
    connect_timeout: Duration,
) -> AppResult<(Vec<u8>, UpdateEgress)> {
    let mut failures = Vec::new();

    for egress in chain {
        let client = match build_update_client(*egress, timeout, connect_timeout) {
            Ok(client) => client,
            Err(err) => {
                failures.push(format!("{}: {}", egress.label(), err));
                continue;
            }
        };

        match client.get(url).send().await {
            Ok(response) if response.status().is_success() => match response.bytes().await {
                Ok(bytes) => return Ok((bytes.to_vec(), *egress)),
                Err(err) => failures.push(format!("{}: {}", egress.label(), err)),
            },
            Ok(response) => failures.push(format!("{}: HTTP {}", egress.label(), response.status())),
            Err(err) => failures.push(format!("{}: {}", egress.label(), err)),
        }
    }

    Err(AppError::Internal(format!(
        "所有更新网络出口均失败（{}）: {}",
        url,
        failures.join("; ")
    )))
}

/// Fetches a URL as text, trying every egress candidate in order.
pub async fn fetch_text_with_fallback(
    chain: &[UpdateEgress],
    url: &str,
    timeout: Duration,
    connect_timeout: Duration,
) -> AppResult<(String, UpdateEgress)> {
    let mut failures = Vec::new();

    for egress in chain {
        let client = match build_update_client(*egress, timeout, connect_timeout) {
            Ok(client) => client,
            Err(err) => {
                failures.push(format!("{}: {}", egress.label(), err));
                continue;
            }
        };

        match client.get(url).send().await {
            Ok(response) if response.status().is_success() => match response.text().await {
                Ok(text) => return Ok((text, *egress)),
                Err(err) => failures.push(format!("{}: {}", egress.label(), err)),
            },
            Ok(response) => failures.push(format!("{}: HTTP {}", egress.label(), response.status())),
            Err(err) => failures.push(format!("{}: {}", egress.label(), err)),
        }
    }

    Err(AppError::Internal(format!(
        "所有更新网络出口均失败（{}）: {}",
        url,
        failures.join("; ")
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mapping(port: u16, protocol: InboundProtocol, enabled: bool) -> PortMapping {
        PortMapping {
            id: format!("mapping-{}", port),
            port,
            protocol,
            enabled,
            ..Default::default()
        }
    }

    #[test]
    fn test_build_egress_chain_uses_enabled_listeners_in_order() {
        let mut direct = mapping(7878, InboundProtocol::Mixed, true);
        direct.id = FIXED_DIRECT_PORT_ID.to_string();

        let mappings = vec![
            direct,
            mapping(7900, InboundProtocol::Mixed, true),
            mapping(7901, InboundProtocol::Http, false),
            mapping(7902, InboundProtocol::Socks5, true),
        ];

        assert_eq!(
            build_egress_chain(&mappings),
            vec![
                UpdateEgress::Proxy {
                    port: 7900,
                    protocol: InboundProtocol::Mixed
                },
                UpdateEgress::Proxy {
                    port: 7902,
                    protocol: InboundProtocol::Socks5
                },
                UpdateEgress::Direct,
            ]
        );
    }

    #[test]
    fn test_build_egress_chain_always_ends_with_direct() {
        assert_eq!(build_egress_chain(&[]), vec![UpdateEgress::Direct]);
        assert_eq!(
            build_egress_chain(&[mapping(7890, InboundProtocol::Mixed, false)]),
            vec![UpdateEgress::Direct]
        );
    }

    #[tokio::test]
    async fn test_fetch_bytes_falls_back_to_direct_after_dead_proxy() {
        use std::io::{Read, Write};

        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind local test server");
        let addr = listener.local_addr().expect("read local test server address");
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept test request");
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .expect("set read timeout");
            let mut buffer = [0u8; 1024];
            let _ = stream.read(&mut buffer);
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello")
                .expect("write test response");
        });

        let dead_port = {
            let probe = std::net::TcpListener::bind("127.0.0.1:0").expect("bind dead port probe");
            probe.local_addr().expect("read dead port").port()
        };

        let chain = vec![
            UpdateEgress::Proxy {
                port: dead_port,
                protocol: InboundProtocol::Mixed,
            },
            UpdateEgress::Direct,
        ];
        let url = format!("http://{}/", addr);
        let (body, egress) = fetch_bytes_with_fallback(&chain, &url, Duration::from_secs(5), Duration::from_secs(2))
            .await
            .expect("fallback fetch should succeed through direct");

        assert_eq!(body, b"hello");
        assert_eq!(egress, UpdateEgress::Direct);
        server.join().expect("join local test server");
    }

    #[test]
    fn test_build_update_client_supports_all_protocols() {
        for protocol in [InboundProtocol::Mixed, InboundProtocol::Http, InboundProtocol::Socks5] {
            let client = build_update_client(
                UpdateEgress::Proxy { port: 7890, protocol },
                Duration::from_secs(5),
                Duration::from_secs(2),
            );
            assert!(client.is_ok());
        }

        assert!(build_update_client(UpdateEgress::Direct, Duration::from_secs(5), Duration::from_secs(2)).is_ok());
    }
}
