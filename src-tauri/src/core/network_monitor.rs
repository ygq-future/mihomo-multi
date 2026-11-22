use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::task::JoinSet;
use tracing::{info, warn};

/// Direct connectivity probe endpoints (bypassing system proxy / Mihomo).
/// Combines mainland China and global captive-portal endpoints so host internet
/// detection works reliably regardless of region.
const SYSTEM_CONNECTIVITY_URLS: [&str; 4] = [
    "http://connect.rom.miui.com/generate_204",
    "http://connectivitycheck.platform.hicloud.com/generate_204",
    "http://www.msftconnecttest.com/connecttest.txt",
    "http://cp.cloudflare.com/generate_204",
];

const PROBE_CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const PROBE_REQUEST_TIMEOUT: Duration = Duration::from_secs(4);

/// Background polling interval when the host network is online.
pub const NETWORK_CHECK_INTERVAL_ONLINE: Duration = Duration::from_secs(5);
/// Faster polling interval when offline so recovery is detected promptly.
pub const NETWORK_CHECK_INTERVAL_OFFLINE: Duration = Duration::from_secs(3);

fn now_epoch_ms() -> u64 {
    u64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
    )
    .unwrap_or(u64::MAX)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SystemNetworkStatus {
    pub online: bool,
    pub last_checked_ms: u64,
    pub offline_since_ms: Option<u64>,
    pub consecutive_failures: u32,
}

impl Default for SystemNetworkStatus {
    fn default() -> Self {
        Self {
            online: true,
            last_checked_ms: 0,
            offline_since_ms: None,
            consecutive_failures: 0,
        }
    }
}

pub type ProbeFuture = Pin<Box<dyn Future<Output = bool> + Send>>;

/// Abstraction over host connectivity probing to enable deterministic unit tests.
pub trait NetworkProbeBackend: Send + Sync {
    fn probe_online(&self) -> ProbeFuture;
}

/// Production probe that races direct HTTP requests (with `.no_proxy()`) against
/// multiple captive-portal endpoints.
pub struct HttpNetworkProbe {
    client: reqwest::Client,
}

impl HttpNetworkProbe {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .no_proxy()
            .connect_timeout(PROBE_CONNECT_TIMEOUT)
            .timeout(PROBE_REQUEST_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self { client }
    }
}

impl Default for HttpNetworkProbe {
    fn default() -> Self {
        Self::new()
    }
}

impl NetworkProbeBackend for HttpNetworkProbe {
    fn probe_online(&self) -> ProbeFuture {
        let client = self.client.clone();
        Box::pin(async move {
            let mut join_set = JoinSet::new();
            for url in SYSTEM_CONNECTIVITY_URLS {
                let c = client.clone();
                join_set.spawn(async move {
                    match c.get(url).send().await {
                        Ok(resp) => resp.status().is_success() || resp.status().is_redirection(),
                        Err(_) => false,
                    }
                });
            }

            while let Some(res) = join_set.join_next().await {
                if matches!(res, Ok(true)) {
                    join_set.abort_all();
                    return true;
                }
            }
            false
        })
    }
}

pub type NetworkChangeCallback = Arc<dyn Fn(&SystemNetworkStatus) + Send + Sync>;

/// Monitors host-level internet connectivity independently of Mihomo proxy nodes.
/// When the host itself is offline, downstream analytics and latency probes can
/// suppress false-positive node timeouts and connection errors.
pub struct SystemNetworkMonitor {
    online: Arc<AtomicBool>,
    status: Arc<RwLock<SystemNetworkStatus>>,
    probe: Arc<dyn NetworkProbeBackend>,
    on_change: Arc<RwLock<Option<NetworkChangeCallback>>>,
}

impl SystemNetworkMonitor {
    pub fn new() -> Self {
        Self::with_probe(Arc::new(HttpNetworkProbe::new()))
    }

    pub fn with_probe(probe: Arc<dyn NetworkProbeBackend>) -> Self {
        Self {
            online: Arc::new(AtomicBool::new(true)),
            status: Arc::new(RwLock::new(SystemNetworkStatus::default())),
            probe,
            on_change: Arc::new(RwLock::new(None)),
        }
    }

    pub fn set_on_change_callback(&self, cb: NetworkChangeCallback) {
        *self.on_change.write() = Some(cb);
    }

    /// Lock-free check of the last known host network state.
    pub fn is_online(&self) -> bool {
        self.online.load(Ordering::Acquire)
    }

    pub fn get_status(&self) -> SystemNetworkStatus {
        self.status.read().clone()
    }

    /// Runs an active host connectivity probe and updates the cached status.
    pub async fn check_now(&self) -> SystemNetworkStatus {
        let reachable = self.probe.probe_online().await;
        let now_ms = now_epoch_ms();

        let (prev_online, snapshot) = {
            let mut st = self.status.write();
            let prev = st.online;
            st.last_checked_ms = now_ms;
            if reachable {
                st.online = true;
                st.offline_since_ms = None;
                st.consecutive_failures = 0;
            } else {
                st.online = false;
                if st.offline_since_ms.is_none() {
                    st.offline_since_ms = Some(now_ms);
                }
                st.consecutive_failures = st.consecutive_failures.saturating_add(1);
            }
            self.online.store(reachable, Ordering::Release);
            (prev, st.clone())
        };

        if prev_online != snapshot.online {
            if snapshot.online {
                info!("System network connectivity restored");
            } else {
                warn!("System network connectivity lost; pausing node timeout/error analytics");
            }
            if let Some(cb) = self.on_change.read().as_ref().cloned() {
                cb(&snapshot);
            }
        }

        snapshot
    }

    /// Returns cached status if checked within `max_age`, otherwise runs `check_now()`.
    pub async fn check_if_stale(&self, max_age: Duration) -> SystemNetworkStatus {
        let now_ms = now_epoch_ms();
        let max_age_ms = u64::try_from(max_age.as_millis()).unwrap_or(u64::MAX);
        let current = self.get_status();
        if current.last_checked_ms > 0 && now_ms.saturating_sub(current.last_checked_ms) <= max_age_ms {
            return current;
        }
        self.check_now().await
    }
}

impl Default for SystemNetworkMonitor {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    struct MockProbe {
        result: Arc<AtomicBool>,
        calls: Arc<AtomicUsize>,
    }

    impl MockProbe {
        fn new(initial: bool) -> (Self, Arc<AtomicBool>, Arc<AtomicUsize>) {
            let result = Arc::new(AtomicBool::new(initial));
            let calls = Arc::new(AtomicUsize::new(0));
            (
                Self {
                    result: result.clone(),
                    calls: calls.clone(),
                },
                result,
                calls,
            )
        }
    }

    impl NetworkProbeBackend for MockProbe {
        fn probe_online(&self) -> ProbeFuture {
            let res = self.result.load(Ordering::SeqCst);
            self.calls.fetch_add(1, Ordering::SeqCst);
            Box::pin(async move { res })
        }
    }

    #[tokio::test]
    async fn test_network_monitor_transitions_and_callback() {
        let (probe, flag, _calls) = MockProbe::new(false);
        let monitor = SystemNetworkMonitor::with_probe(Arc::new(probe));

        let transitions = Arc::new(RwLock::new(Vec::<bool>::new()));
        let t_clone = transitions.clone();
        monitor.set_on_change_callback(Arc::new(move |st| {
            t_clone.write().push(st.online);
        }));

        assert!(monitor.is_online());

        // Transition Online -> Offline
        let st1 = monitor.check_now().await;
        assert!(!st1.online);
        assert!(!monitor.is_online());
        assert!(st1.offline_since_ms.is_some());
        assert_eq!(st1.consecutive_failures, 1);

        // Stay Offline -> callback should NOT fire again
        let st2 = monitor.check_now().await;
        assert!(!st2.online);
        assert_eq!(st2.consecutive_failures, 2);

        // Transition Offline -> Online
        flag.store(true, Ordering::SeqCst);
        let st3 = monitor.check_now().await;
        assert!(st3.online);
        assert!(monitor.is_online());
        assert!(st3.offline_since_ms.is_none());
        assert_eq!(st3.consecutive_failures, 0);

        assert_eq!(*transitions.read(), vec![false, true]);
    }

    #[tokio::test]
    async fn test_check_if_stale_uses_cache_when_fresh() {
        let (probe, _flag, calls) = MockProbe::new(true);
        let monitor = SystemNetworkMonitor::with_probe(Arc::new(probe));

        let _ = monitor.check_if_stale(Duration::from_secs(10)).await;
        assert_eq!(calls.load(Ordering::SeqCst), 1);

        let _ = monitor.check_if_stale(Duration::from_secs(10)).await;
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }
}
