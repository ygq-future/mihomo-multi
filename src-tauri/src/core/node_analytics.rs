use crate::core::profile_manager::atomic_write_file;
use crate::error::AppResult;
use crate::models::ConnectionSnapshot;
use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::warn;

const PERSIST_THROTTLE_MS: u64 = 15_000;
const RETENTION_MS: u64 = 30 * 24 * 60 * 60 * 1000; // 30 days
const HOUR_MS: u64 = 60 * 60 * 1000;
const ACTIVE_SPEED_THRESHOLD_BPS: f64 = 1024.0; // 1 KB/s active traffic floor
const MAX_RECENT_EVENTS_PER_NODE: usize = 50;
const MAX_TRACKED_NODES: usize = 500;
const STORAGE_FILE_NAME: &str = "node_analytics.json";

fn now_epoch_ms() -> u64 {
    u64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
    )
    .unwrap_or(u64::MAX)
}

fn hour_bucket_start(ts_ms: u64) -> u64 {
    (ts_ms / HOUR_MS) * HOUR_MS
}

/// Configurable weights for multi-dimensional node availability scoring.
/// Weights are normalized proportionally during scoring so any positive values work.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AvailabilityWeights {
    /// Weight for timeout count penalty (default: 20)
    pub timeout_count: f64,
    /// Weight for cumulative/max timeout duration penalty (default: 15)
    pub timeout_duration: f64,
    /// Weight for runtime connection error rate penalty (default: 20)
    pub connection_errors: f64,
    /// Weight for active average throughput (default: 15)
    pub avg_speed: f64,
    /// Weight for historical peak throughput (default: 10)
    pub max_speed: f64,
    /// Weight for active minimum (floor) throughput (default: 5)
    pub min_speed: f64,
    /// Weight for latency & jitter quality (default: 15)
    pub latency_quality: f64,
}

impl Default for AvailabilityWeights {
    fn default() -> Self {
        Self {
            timeout_count: 20.0,
            timeout_duration: 15.0,
            connection_errors: 20.0,
            avg_speed: 15.0,
            max_speed: 10.0,
            min_speed: 5.0,
            latency_quality: 15.0,
        }
    }
}

impl AvailabilityWeights {
    pub fn sanitized(&self) -> Self {
        let clamp = |v: f64| if v.is_finite() { v.clamp(0.0, 100.0) } else { 0.0 };
        Self {
            timeout_count: clamp(self.timeout_count),
            timeout_duration: clamp(self.timeout_duration),
            connection_errors: clamp(self.connection_errors),
            avg_speed: clamp(self.avg_speed),
            max_speed: clamp(self.max_speed),
            min_speed: clamp(self.min_speed),
            latency_quality: clamp(self.latency_quality),
        }
    }

    pub fn total(&self) -> f64 {
        self.timeout_count
            + self.timeout_duration
            + self.connection_errors
            + self.avg_speed
            + self.max_speed
            + self.min_speed
            + self.latency_quality
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeAnomalyEvent {
    pub timestamp_ms: u64,
    /// "timeout" | "connection_error" | "recovered"
    pub kind: String,
    pub message: String,
    pub duration_ms: Option<u64>,
}

/// Hourly aggregated metrics bucket for a single node.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HourlyNodeBucket {
    pub bucket_start_ms: u64,
    pub probe_total: u64,
    pub probe_success: u64,
    pub timeout_count: u64,
    pub timeout_duration_ms: u64,
    pub max_single_timeout_ms: u64,
    pub connection_errors: u64,
    pub connection_samples: u64,
    pub total_upload_bytes: u64,
    pub total_download_bytes: u64,
    /// Sum of active speed samples (bytes/sec) where speed >= ACTIVE_SPEED_THRESHOLD_BPS
    pub active_speed_sum_bps: f64,
    pub active_speed_samples: u64,
    pub max_speed_bps: f64,
    pub min_active_speed_bps: Option<f64>,
    pub latency_sum_ms: u64,
    pub latency_samples: u64,
    pub latency_min_ms: Option<u32>,
    pub latency_max_ms: Option<u32>,
    /// Sum of |delta_latency| between consecutive successful probes for jitter estimation
    pub jitter_sum_ms: u64,
    pub jitter_samples: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedNodeRecord {
    pub node_name: String,
    pub first_seen_ms: u64,
    pub last_seen_ms: u64,
    /// If currently in a timeout streak, stores the timestamp when the streak began.
    pub active_timeout_since_ms: Option<u64>,
    pub last_latency_ms: Option<u32>,
    /// Hourly buckets keyed by `bucket_start_ms`
    pub buckets: BTreeMap<u64, HourlyNodeBucket>,
    pub recent_events: VecDeque<NodeAnomalyEvent>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedAnalyticsData {
    #[serde(default)]
    pub weights: AvailabilityWeights,
    #[serde(default)]
    pub nodes: HashMap<String, PersistedNodeRecord>,
}

#[derive(Debug, Clone)]
struct PrevConnBytes {
    upload: u64,
    download: u64,
    last_seen_ms: u64,
}

#[derive(Default)]
struct AnalyticsInner {
    data: PersistedAnalyticsData,
    prev_connections: HashMap<String, PrevConnBytes>,
    generation: u64,
    persisted_generation: u64,
    last_persisted_at: u64,
}

/// Dimension sub-scores (0-100 each) for radar chart and breakdown display.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DimensionScores {
    pub timeout_count: f64,
    pub timeout_duration: f64,
    pub connection_errors: f64,
    pub avg_speed: f64,
    pub max_speed: f64,
    pub min_speed: f64,
    pub latency_quality: f64,
}

/// Aggregated analytics summary for a single node over the requested time window.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeAnalyticsSummary {
    pub node_name: String,
    pub score: f64,
    /// "S" | "A" | "B" | "C" | "D"
    pub grade: String,
    /// "high" | "medium" | "low"
    pub confidence: String,
    pub is_currently_timed_out: bool,
    pub probe_total: u64,
    pub probe_success: u64,
    pub success_rate: f64,
    pub timeout_count: u64,
    pub timeout_duration_ms: u64,
    pub max_single_timeout_ms: u64,
    pub connection_errors: u64,
    pub connection_samples: u64,
    pub total_upload_bytes: u64,
    pub total_download_bytes: u64,
    pub avg_speed_bps: f64,
    pub max_speed_bps: f64,
    pub min_speed_bps: f64,
    pub avg_latency_ms: Option<f64>,
    pub jitter_ms: Option<f64>,
    pub last_latency_ms: Option<u32>,
    pub last_seen_ms: u64,
    pub dimensions: DimensionScores,
    pub recent_events: Vec<NodeAnomalyEvent>,
}

/// Time-series point for dashboard trend charts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsTimelinePoint {
    pub bucket_start_ms: u64,
    pub avg_speed_bps: f64,
    pub max_speed_bps: f64,
    pub timeout_count: u64,
    pub connection_errors: u64,
    pub avg_latency_ms: Option<f64>,
}

/// Complete payload returned to the frontend Analytics Dashboard.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeAnalyticsDashboard {
    pub generated_at_ms: u64,
    pub window_hours: u64,
    pub weights: AvailabilityWeights,
    pub total_nodes: usize,
    pub healthy_nodes: usize,
    pub warning_nodes: usize,
    pub critical_nodes: usize,
    pub avg_score: f64,
    pub total_timeouts: u64,
    pub total_timeout_duration_ms: u64,
    pub total_connection_errors: u64,
    pub total_traffic_bytes: u64,
    pub global_peak_speed_bps: f64,
    pub global_avg_speed_bps: f64,
    pub nodes: Vec<NodeAnalyticsSummary>,
    pub timeline: Vec<AnalyticsTimelinePoint>,
}

pub struct NodeAnalyticsStore {
    state: RwLock<AnalyticsInner>,
    storage_path: PathBuf,
    persist_lock: Mutex<()>,
}

impl NodeAnalyticsStore {
    pub fn new(app_dir: &Path) -> Self {
        let storage_path = app_dir.join(STORAGE_FILE_NAME);
        let data = Self::load_from_disk(&storage_path).unwrap_or_default();
        Self {
            state: RwLock::new(AnalyticsInner {
                data,
                prev_connections: HashMap::new(),
                generation: 0,
                persisted_generation: 0,
                last_persisted_at: 0,
            }),
            storage_path,
            persist_lock: Mutex::new(()),
        }
    }

    fn load_from_disk(path: &Path) -> Option<PersistedAnalyticsData> {
        let content = std::fs::read_to_string(path).ok()?;
        match serde_json::from_str::<PersistedAnalyticsData>(&content) {
            Ok(data) => Some(data),
            Err(err) => {
                warn!("Failed to parse {}: {}", path.display(), err);
                None
            }
        }
    }

    fn is_trackable_node(name: &str) -> bool {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return false;
        }
        !matches!(
            trimmed.to_ascii_uppercase().as_str(),
            "DIRECT" | "REJECT" | "REJECT-DROP" | "PASS" | "COMPATIBLE" | "GLOBAL"
        ) && !trimmed.starts_with("port-")
            && !trimmed.starts_with("fallback-")
    }

    fn resolve_target_node(chains: &[String]) -> Option<String> {
        // Mihomo `chains` is ordered from outermost proxy node to innermost group,
        // e.g. ["HK-01", "fallback-7890"] or ["US-02"].
        chains
            .iter()
            .find(|name| Self::is_trackable_node(name))
            .map(|s| s.trim().to_string())
    }

    fn push_event(record: &mut PersistedNodeRecord, event: NodeAnomalyEvent) {
        record.recent_events.push_front(event);
        while record.recent_events.len() > MAX_RECENT_EVENTS_PER_NODE {
            record.recent_events.pop_back();
        }
    }

    fn prune_old_buckets(record: &mut PersistedNodeRecord, now_ms: u64) {
        let cutoff = now_ms.saturating_sub(RETENTION_MS);
        record.buckets.retain(|&ts, _| ts >= cutoff);
    }

    fn enforce_node_cap(nodes: &mut HashMap<String, PersistedNodeRecord>) {
        if nodes.len() <= MAX_TRACKED_NODES {
            return;
        }
        let mut by_age: Vec<(String, u64)> = nodes
            .iter()
            .map(|(k, v)| (k.clone(), v.last_seen_ms))
            .collect();
        by_age.sort_by_key(|(_, ts)| *ts);
        let remove_count = nodes.len().saturating_sub(MAX_TRACKED_NODES);
        for (name, _) in by_age.into_iter().take(remove_count) {
            nodes.remove(&name);
        }
    }

    /// Record a latency probe sample (Some(ms) = success, None = timeout/failure).
    /// Triggered by both manual/batch probes and Mihomo periodic fallback health checks.
    pub fn record_latency_sample(&self, node_name: &str, latency_ms: Option<u32>) {
        self.record_latency_sample_at(node_name, latency_ms, now_epoch_ms());
    }

    pub fn record_latency_samples_batch(&self, updates: &[(String, Option<u32>)]) {
        if updates.is_empty() {
            return;
        }
        let now_ms = now_epoch_ms();
        {
            let mut inner = self.state.write();
            for (name, latency) in updates {
                Self::apply_latency_sample(&mut inner.data.nodes, name, *latency, now_ms);
            }
            Self::enforce_node_cap(&mut inner.data.nodes);
            inner.generation = inner.generation.wrapping_add(1);
        }
        self.maybe_persist(false);
    }

    fn record_latency_sample_at(&self, node_name: &str, latency_ms: Option<u32>, now_ms: u64) {
        if !Self::is_trackable_node(node_name) {
            return;
        }
        {
            let mut inner = self.state.write();
            Self::apply_latency_sample(&mut inner.data.nodes, node_name, latency_ms, now_ms);
            Self::enforce_node_cap(&mut inner.data.nodes);
            inner.generation = inner.generation.wrapping_add(1);
        }
        self.maybe_persist(false);
    }

    fn apply_latency_sample(
        nodes: &mut HashMap<String, PersistedNodeRecord>,
        node_name: &str,
        latency_ms: Option<u32>,
        now_ms: u64,
    ) {
        if !Self::is_trackable_node(node_name) {
            return;
        }
        let bucket_ts = hour_bucket_start(now_ms);
        let record = nodes
            .entry(node_name.to_string())
            .or_insert_with(|| PersistedNodeRecord {
                node_name: node_name.to_string(),
                first_seen_ms: now_ms,
                last_seen_ms: now_ms,
                ..Default::default()
            });
        record.last_seen_ms = now_ms;

        let bucket = record
            .buckets
            .entry(bucket_ts)
            .or_insert_with(|| HourlyNodeBucket {
                bucket_start_ms: bucket_ts,
                ..Default::default()
            });
        bucket.probe_total = bucket.probe_total.saturating_add(1);

        match latency_ms {
            Some(ms) if ms > 0 => {
                bucket.probe_success = bucket.probe_success.saturating_add(1);
                bucket.latency_sum_ms = bucket.latency_sum_ms.saturating_add(u64::from(ms));
                bucket.latency_samples = bucket.latency_samples.saturating_add(1);
                bucket.latency_min_ms = Some(bucket.latency_min_ms.map_or(ms, |cur| cur.min(ms)));
                bucket.latency_max_ms = Some(bucket.latency_max_ms.map_or(ms, |cur| cur.max(ms)));

                if let Some(prev) = record.last_latency_ms {
                    let delta = u64::from(ms.abs_diff(prev));
                    bucket.jitter_sum_ms = bucket.jitter_sum_ms.saturating_add(delta);
                    bucket.jitter_samples = bucket.jitter_samples.saturating_add(1);
                }
                record.last_latency_ms = Some(ms);

                // Close any ongoing timeout streak and record its duration.
                if let Some(since_ms) = record.active_timeout_since_ms.take() {
                    let duration_ms = now_ms.saturating_sub(since_ms);
                    bucket.timeout_duration_ms = bucket.timeout_duration_ms.saturating_add(duration_ms);
                    bucket.max_single_timeout_ms = bucket.max_single_timeout_ms.max(duration_ms);
                    Self::push_event(
                        record,
                        NodeAnomalyEvent {
                            timestamp_ms: now_ms,
                            kind: "recovered".to_string(),
                            message: format!("Recovered ({ms}ms)"),
                            duration_ms: Some(duration_ms),
                        },
                    );
                }
            }
            _ => {
                bucket.timeout_count = bucket.timeout_count.saturating_add(1);
                if let Some(since_ms) = record.active_timeout_since_ms {
                    let elapsed = now_ms.saturating_sub(since_ms);
                    bucket.max_single_timeout_ms = bucket.max_single_timeout_ms.max(elapsed);
                } else {
                    record.active_timeout_since_ms = Some(now_ms);
                    Self::push_event(
                        record,
                        NodeAnomalyEvent {
                            timestamp_ms: now_ms,
                            kind: "timeout".to_string(),
                            message: "Probe timeout / unreachable".to_string(),
                            duration_ms: None,
                        },
                    );
                }
            }
        }

        Self::prune_old_buckets(record, now_ms);
    }

    /// Record a live connection snapshot from `GET /connections` to compute per-node
    /// active average, peak, and minimum (floor) throughput rates.
    pub fn record_connection_snapshot(&self, snapshot: &ConnectionSnapshot) {
        self.record_connection_snapshot_at(snapshot, now_epoch_ms());
    }

    fn record_connection_snapshot_at(&self, snapshot: &ConnectionSnapshot, now_ms: u64) {
        let mut inner = self.state.write();
        let mut node_delta_upload: HashMap<String, u64> = HashMap::new();
        let mut node_delta_download: HashMap<String, u64> = HashMap::new();
        let mut node_delta_sec: HashMap<String, f64> = HashMap::new();
        let mut node_conn_count: HashMap<String, u64> = HashMap::new();
        let mut next_prev: HashMap<String, PrevConnBytes> = HashMap::with_capacity(snapshot.connections.len());

        for conn in &snapshot.connections {
            let Some(node_name) = Self::resolve_target_node(&conn.chains) else {
                continue;
            };
            *node_conn_count.entry(node_name.clone()).or_insert(0) += 1;

            if let Some(prev) = inner.prev_connections.get(&conn.id) {
                let dt_ms = now_ms.saturating_sub(prev.last_seen_ms);
                if (200..=30_000).contains(&dt_ms) {
                    let du = conn.upload.saturating_sub(prev.upload);
                    let dd = conn.download.saturating_sub(prev.download);
                    if du > 0 || dd > 0 {
                        *node_delta_upload.entry(node_name.clone()).or_insert(0) += du;
                        *node_delta_download.entry(node_name.clone()).or_insert(0) += dd;
                        let sec = (dt_ms as f64) / 1000.0;
                        node_delta_sec
                            .entry(node_name.clone())
                            .and_modify(|s| *s = s.max(sec))
                            .or_insert(sec);
                    }
                }
            }

            next_prev.insert(
                conn.id.clone(),
                PrevConnBytes {
                    upload: conn.upload,
                    download: conn.download,
                    last_seen_ms: now_ms,
                },
            );
        }

        inner.prev_connections = next_prev;

        if node_conn_count.is_empty() {
            return;
        }

        let bucket_ts = hour_bucket_start(now_ms);
        for (node_name, conn_count) in node_conn_count {
            let record = inner
                .data
                .nodes
                .entry(node_name.clone())
                .or_insert_with(|| PersistedNodeRecord {
                    node_name: node_name.clone(),
                    first_seen_ms: now_ms,
                    last_seen_ms: now_ms,
                    ..Default::default()
                });
            record.last_seen_ms = now_ms;

            let bucket = record
                .buckets
                .entry(bucket_ts)
                .or_insert_with(|| HourlyNodeBucket {
                    bucket_start_ms: bucket_ts,
                    ..Default::default()
                });
            bucket.connection_samples = bucket.connection_samples.saturating_add(conn_count);

            let du = node_delta_upload.get(&node_name).copied().unwrap_or(0);
            let dd = node_delta_download.get(&node_name).copied().unwrap_or(0);
            if du > 0 || dd > 0 {
                bucket.total_upload_bytes = bucket.total_upload_bytes.saturating_add(du);
                bucket.total_download_bytes = bucket.total_download_bytes.saturating_add(dd);
                let dt_sec = node_delta_sec.get(&node_name).copied().unwrap_or(2.0).max(0.2);
                let speed_bps = ((du + dd) as f64) / dt_sec;
                if speed_bps >= ACTIVE_SPEED_THRESHOLD_BPS {
                    bucket.active_speed_sum_bps += speed_bps;
                    bucket.active_speed_samples = bucket.active_speed_samples.saturating_add(1);
                    if speed_bps > bucket.max_speed_bps {
                        bucket.max_speed_bps = speed_bps;
                    }
                    bucket.min_active_speed_bps = Some(match bucket.min_active_speed_bps {
                        Some(cur) => cur.min(speed_bps),
                        None => speed_bps,
                    });
                }
            }
            Self::prune_old_buckets(record, now_ms);
        }

        Self::enforce_node_cap(&mut inner.data.nodes);
        inner.generation = inner.generation.wrapping_add(1);
        drop(inner);
        self.maybe_persist(false);
    }

    /// Parse a Mihomo log line for runtime connection errors (dial failures, EOF, resets, timeouts)
    /// and attribute them to the corresponding proxy node.
    pub fn record_log_line(&self, line: &str) {
        let Some((node_name, reason)) = parse_connection_error_from_log(line) else {
            return;
        };
        if !Self::is_trackable_node(&node_name) {
            return;
        }
        let now_ms = now_epoch_ms();
        {
            let mut inner = self.state.write();
            let bucket_ts = hour_bucket_start(now_ms);
            let record = inner
                .data
                .nodes
                .entry(node_name.clone())
                .or_insert_with(|| PersistedNodeRecord {
                    node_name: node_name.clone(),
                    first_seen_ms: now_ms,
                    last_seen_ms: now_ms,
                    ..Default::default()
                });
            record.last_seen_ms = now_ms;

            let bucket = record
                .buckets
                .entry(bucket_ts)
                .or_insert_with(|| HourlyNodeBucket {
                    bucket_start_ms: bucket_ts,
                    ..Default::default()
                });
            bucket.connection_errors = bucket.connection_errors.saturating_add(1);
            Self::push_event(
                record,
                NodeAnomalyEvent {
                    timestamp_ms: now_ms,
                    kind: "connection_error".to_string(),
                    message: reason,
                    duration_ms: None,
                },
            );
            Self::prune_old_buckets(record, now_ms);
            Self::enforce_node_cap(&mut inner.data.nodes);
            inner.generation = inner.generation.wrapping_add(1);
        }
        self.maybe_persist(false);
    }

    pub fn get_weights(&self) -> AvailabilityWeights {
        self.state.read().data.weights.clone()
    }

    pub fn set_weights(&self, weights: AvailabilityWeights) -> AppResult<AvailabilityWeights> {
        let sanitized = weights.sanitized();
        {
            let mut inner = self.state.write();
            inner.data.weights = sanitized.clone();
            inner.generation = inner.generation.wrapping_add(1);
        }
        self.flush()?;
        Ok(sanitized)
    }

    pub fn clear_all(&self) -> AppResult<()> {
        {
            let mut inner = self.state.write();
            inner.data.nodes.clear();
            inner.prev_connections.clear();
            inner.generation = inner.generation.wrapping_add(1);
        }
        self.flush()
    }

    /// Build the aggregated dashboard payload for the given time window (`window_hours == 0` means all).
    pub fn build_dashboard(&self, window_hours: u64, allowed_nodes: Option<&HashSet<String>>) -> NodeAnalyticsDashboard {
        let now_ms = now_epoch_ms();
        let cutoff_ms = if window_hours == 0 {
            0
        } else {
            now_ms.saturating_sub(window_hours.saturating_mul(HOUR_MS))
        };

        let (weights, snapshot_nodes) = {
            let inner = self.state.read();
            (inner.data.weights.clone(), inner.data.nodes.clone())
        };

        let mut summaries: Vec<NodeAnalyticsSummary> = Vec::with_capacity(snapshot_nodes.len());
        let mut timeline_map: BTreeMap<u64, TimelineAgg> = BTreeMap::new();

        for record in snapshot_nodes.values() {
            if let Some(allowed) = allowed_nodes
                && !allowed.contains(&record.node_name)
            {
                continue;
            }
            let mut agg = HourlyNodeBucket::default();
            let mut has_data = false;

            for (&bucket_ts, bucket) in &record.buckets {
                if bucket_ts < cutoff_ms {
                    continue;
                }
                has_data = true;
                agg.probe_total += bucket.probe_total;
                agg.probe_success += bucket.probe_success;
                agg.timeout_count += bucket.timeout_count;
                agg.timeout_duration_ms += bucket.timeout_duration_ms;
                agg.max_single_timeout_ms = agg.max_single_timeout_ms.max(bucket.max_single_timeout_ms);
                agg.connection_errors += bucket.connection_errors;
                agg.connection_samples += bucket.connection_samples;
                agg.total_upload_bytes += bucket.total_upload_bytes;
                agg.total_download_bytes += bucket.total_download_bytes;
                agg.active_speed_sum_bps += bucket.active_speed_sum_bps;
                agg.active_speed_samples += bucket.active_speed_samples;
                agg.max_speed_bps = agg.max_speed_bps.max(bucket.max_speed_bps);
                if let Some(min_s) = bucket.min_active_speed_bps {
                    agg.min_active_speed_bps = Some(match agg.min_active_speed_bps {
                        Some(cur) => cur.min(min_s),
                        None => min_s,
                    });
                }
                agg.latency_sum_ms += bucket.latency_sum_ms;
                agg.latency_samples += bucket.latency_samples;
                agg.jitter_sum_ms += bucket.jitter_sum_ms;
                agg.jitter_samples += bucket.jitter_samples;

                let tl = timeline_map.entry(bucket_ts).or_default();
                tl.speed_sum_bps += bucket.active_speed_sum_bps;
                tl.speed_samples += bucket.active_speed_samples;
                tl.max_speed_bps = tl.max_speed_bps.max(bucket.max_speed_bps);
                tl.timeout_count += bucket.timeout_count;
                tl.connection_errors += bucket.connection_errors;
                tl.latency_sum_ms += bucket.latency_sum_ms;
                tl.latency_samples += bucket.latency_samples;
            }

            // Include ongoing timeout duration if the node is currently timed out.
            let ongoing_timeout_ms = record
                .active_timeout_since_ms
                .map(|since| now_ms.saturating_sub(since))
                .unwrap_or(0);
            if ongoing_timeout_ms > 0 {
                agg.timeout_duration_ms = agg.timeout_duration_ms.saturating_add(ongoing_timeout_ms);
                agg.max_single_timeout_ms = agg.max_single_timeout_ms.max(ongoing_timeout_ms);
            }

            if !has_data && ongoing_timeout_ms == 0 {
                continue;
            }

            let success_rate = if agg.probe_total > 0 {
                (agg.probe_success as f64) / (agg.probe_total as f64) * 100.0
            } else if agg.connection_samples > 0 && agg.connection_errors == 0 {
                100.0
            } else {
                0.0
            };

            let avg_speed_bps = if agg.active_speed_samples > 0 {
                agg.active_speed_sum_bps / (agg.active_speed_samples as f64)
            } else {
                0.0
            };
            let min_speed_bps = agg.min_active_speed_bps.unwrap_or(0.0);
            let avg_latency_ms = if agg.latency_samples > 0 {
                Some((agg.latency_sum_ms as f64) / (agg.latency_samples as f64))
            } else {
                None
            };
            let jitter_ms = if agg.jitter_samples > 0 {
                Some((agg.jitter_sum_ms as f64) / (agg.jitter_samples as f64))
            } else {
                None
            };

            let dimensions = compute_dimension_scores(
                agg.probe_total,
                agg.timeout_count,
                agg.timeout_duration_ms,
                agg.connection_errors,
                agg.connection_samples,
                avg_speed_bps,
                agg.max_speed_bps,
                min_speed_bps,
                avg_latency_ms,
                jitter_ms,
            );
            let score = compute_weighted_score(&dimensions, &weights);
            let grade = score_to_grade(score).to_string();
            let total_observations = agg.probe_total + agg.active_speed_samples + agg.connection_errors;
            let confidence = if total_observations >= 20 {
                "high"
            } else if total_observations >= 5 {
                "medium"
            } else {
                "low"
            }
            .to_string();

            let recent_events = record
                .recent_events
                .iter()
                .filter(|e| e.timestamp_ms >= cutoff_ms)
                .take(20)
                .cloned()
                .collect();

            summaries.push(NodeAnalyticsSummary {
                node_name: record.node_name.clone(),
                score,
                grade,
                confidence,
                is_currently_timed_out: record.active_timeout_since_ms.is_some(),
                probe_total: agg.probe_total,
                probe_success: agg.probe_success,
                success_rate,
                timeout_count: agg.timeout_count,
                timeout_duration_ms: agg.timeout_duration_ms,
                max_single_timeout_ms: agg.max_single_timeout_ms,
                connection_errors: agg.connection_errors,
                connection_samples: agg.connection_samples,
                total_upload_bytes: agg.total_upload_bytes,
                total_download_bytes: agg.total_download_bytes,
                avg_speed_bps,
                max_speed_bps: agg.max_speed_bps,
                min_speed_bps,
                avg_latency_ms,
                jitter_ms,
                last_latency_ms: record.last_latency_ms,
                last_seen_ms: record.last_seen_ms,
                dimensions,
                recent_events,
            });
        }

        // Sort by score descending, then by node name ascending.
        summaries.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.node_name.cmp(&b.node_name))
        });

        let total_nodes = summaries.len();
        let healthy_nodes = summaries.iter().filter(|n| n.score >= 80.0).count();
        let warning_nodes = summaries.iter().filter(|n| n.score >= 60.0 && n.score < 80.0).count();
        let critical_nodes = summaries.iter().filter(|n| n.score < 60.0).count();
        let avg_score = if total_nodes > 0 {
            summaries.iter().map(|n| n.score).sum::<f64>() / (total_nodes as f64)
        } else {
            0.0
        };
        let total_timeouts: u64 = summaries.iter().map(|n| n.timeout_count).sum();
        let total_timeout_duration_ms: u64 = summaries.iter().map(|n| n.timeout_duration_ms).sum();
        let total_connection_errors: u64 = summaries.iter().map(|n| n.connection_errors).sum();
        let total_traffic_bytes: u64 = summaries
            .iter()
            .map(|n| n.total_upload_bytes.saturating_add(n.total_download_bytes))
            .sum();
        let global_peak_speed_bps = summaries
            .iter()
            .map(|n| n.max_speed_bps)
            .fold(0.0_f64, f64::max);
        let active_speed_nodes: Vec<f64> = summaries
            .iter()
            .filter(|n| n.avg_speed_bps > 0.0)
            .map(|n| n.avg_speed_bps)
            .collect();
        let global_avg_speed_bps = if !active_speed_nodes.is_empty() {
            active_speed_nodes.iter().sum::<f64>() / (active_speed_nodes.len() as f64)
        } else {
            0.0
        };

        let timeline: Vec<AnalyticsTimelinePoint> = timeline_map
            .into_iter()
            .map(|(bucket_start_ms, tl)| AnalyticsTimelinePoint {
                bucket_start_ms,
                avg_speed_bps: if tl.speed_samples > 0 {
                    tl.speed_sum_bps / (tl.speed_samples as f64)
                } else {
                    0.0
                },
                max_speed_bps: tl.max_speed_bps,
                timeout_count: tl.timeout_count,
                connection_errors: tl.connection_errors,
                avg_latency_ms: if tl.latency_samples > 0 {
                    Some((tl.latency_sum_ms as f64) / (tl.latency_samples as f64))
                } else {
                    None
                },
            })
            .collect();

        NodeAnalyticsDashboard {
            generated_at_ms: now_ms,
            window_hours,
            weights,
            total_nodes,
            healthy_nodes,
            warning_nodes,
            critical_nodes,
            avg_score: (avg_score * 10.0).round() / 10.0,
            total_timeouts,
            total_timeout_duration_ms,
            total_connection_errors,
            total_traffic_bytes,
            global_peak_speed_bps,
            global_avg_speed_bps,
            nodes: summaries,
            timeline,
        }
    }

    pub fn flush(&self) -> AppResult<()> {
        self.persist_internal(true)
    }

    fn maybe_persist(&self, force: bool) {
        if let Err(err) = self.persist_internal(force) {
            warn!("Failed to persist node analytics: {}", err);
        }
    }

    fn persist_internal(&self, force: bool) -> AppResult<()> {
        let _guard = self.persist_lock.lock();
        let now_ms = now_epoch_ms();
        let (generation, data_clone) = {
            let inner = self.state.read();
            if inner.generation == inner.persisted_generation {
                return Ok(());
            }
            if !force && now_ms.saturating_sub(inner.last_persisted_at) < PERSIST_THROTTLE_MS {
                return Ok(());
            }
            (inner.generation, inner.data.clone())
        };

        let payload = serde_json::to_string(&data_clone)?;
        atomic_write_file(&self.storage_path, payload.as_bytes())?;

        let mut inner = self.state.write();
        inner.persisted_generation = generation;
        inner.last_persisted_at = now_ms;
        Ok(())
    }
}

#[derive(Default)]
struct TimelineAgg {
    speed_sum_bps: f64,
    speed_samples: u64,
    max_speed_bps: f64,
    timeout_count: u64,
    connection_errors: u64,
    latency_sum_ms: u64,
    latency_samples: u64,
}

#[allow(clippy::too_many_arguments)]
fn compute_dimension_scores(
    probe_total: u64,
    timeout_count: u64,
    timeout_duration_ms: u64,
    connection_errors: u64,
    connection_samples: u64,
    avg_speed_bps: f64,
    max_speed_bps: f64,
    min_speed_bps: f64,
    avg_latency_ms: Option<f64>,
    jitter_ms: Option<f64>,
) -> DimensionScores {
    // 1. Timeout count score: combines failure rate & absolute timeout count penalty.
    let timeout_count_score = if timeout_count == 0 {
        100.0
    } else if probe_total > 0 {
        let fail_ratio = (timeout_count as f64) / (probe_total as f64);
        let abs_penalty = ((timeout_count as f64) * 3.0).min(40.0);
        (100.0 * (1.0 - fail_ratio * 0.9) - abs_penalty * 0.5).clamp(0.0, 100.0)
    } else {
        (100.0 - (timeout_count as f64) * 12.0).clamp(0.0, 100.0)
    };

    // 2. Timeout duration score: 0s = 100, 10m = ~50, >= 60m = 0 (smooth logarithmic decay).
    let timeout_duration_score = if timeout_duration_ms == 0 {
        100.0
    } else {
        let mins = (timeout_duration_ms as f64) / 60_000.0;
        (100.0 - 24.0 * (1.0 + mins).ln()).clamp(0.0, 100.0)
    };

    // 3. Runtime connection error score: penalizes error rate against connection activity.
    let connection_errors_score = if connection_errors == 0 {
        100.0
    } else {
        let denom = (connection_samples.max(10)) as f64;
        let err_rate = (connection_errors as f64) / denom;
        let penalty = (err_rate * 250.0).min(80.0) + ((connection_errors as f64) * 2.0).min(25.0);
        (100.0 - penalty).clamp(0.0, 100.0)
    };

    // 4-6. Throughput scores (log-scaled against realistic proxy speed tiers).
    // Neutral baseline (60) when no active traffic has been observed yet so idle nodes
    // are not unfairly crushed solely for having zero traffic history.
    let speed_to_score = |bps: f64, ref_max_mbps: f64| -> f64 {
        if bps <= 0.0 {
            return 60.0;
        }
        let mbps = bps / (1024.0 * 1024.0);
        let ratio = (1.0 + mbps).ln() / (1.0 + ref_max_mbps).ln();
        (ratio * 100.0).clamp(5.0, 100.0)
    };
    let avg_speed_score = speed_to_score(avg_speed_bps, 10.0); // 10 MB/s -> 100
    let max_speed_score = speed_to_score(max_speed_bps, 30.0); // 30 MB/s -> 100
    let min_speed_score = speed_to_score(min_speed_bps, 2.0); // 2 MB/s floor -> 100

    // 7. Latency & jitter quality: <=50ms -> 100, 200ms -> ~70, 500ms -> ~35, >=1000ms -> 0.
    let latency_quality_score = match avg_latency_ms {
        Some(lat) => {
            let lat_score = if lat <= 50.0 {
                100.0
            } else {
                (100.0 - ((lat - 50.0) / 950.0) * 100.0).clamp(0.0, 100.0)
            };
            let jitter_penalty = jitter_ms.map(|j| (j / 10.0).min(25.0)).unwrap_or(0.0);
            (lat_score - jitter_penalty).clamp(0.0, 100.0)
        }
        None => 60.0,
    };

    let round1 = |v: f64| (v * 10.0).round() / 10.0;
    DimensionScores {
        timeout_count: round1(timeout_count_score),
        timeout_duration: round1(timeout_duration_score),
        connection_errors: round1(connection_errors_score),
        avg_speed: round1(avg_speed_score),
        max_speed: round1(max_speed_score),
        min_speed: round1(min_speed_score),
        latency_quality: round1(latency_quality_score),
    }
}

fn compute_weighted_score(dim: &DimensionScores, weights: &AvailabilityWeights) -> f64 {
    let w = weights.sanitized();
    let total = w.total();
    if total <= 0.0 {
        return 0.0;
    }
    let weighted = dim.timeout_count * w.timeout_count
        + dim.timeout_duration * w.timeout_duration
        + dim.connection_errors * w.connection_errors
        + dim.avg_speed * w.avg_speed
        + dim.max_speed * w.max_speed
        + dim.min_speed * w.min_speed
        + dim.latency_quality * w.latency_quality;
    ((weighted / total) * 10.0).round() / 10.0
}

fn score_to_grade(score: f64) -> &'static str {
    if score >= 90.0 {
        "S"
    } else if score >= 80.0 {
        "A"
    } else if score >= 70.0 {
        "B"
    } else if score >= 60.0 {
        "C"
    } else {
        "D"
    }
}

/// Parses Mihomo warning/error log lines to extract connection failures attributed to a proxy node.
/// Example lines:
/// - `time="..." level=warning msg="[TCP] dial HK-01 (match IN-PORT/7890) 127.0.0.1:123 --> example.com:443 error: i/o timeout"`
/// - `time="..." level=warning msg="[UDP] dial US-02 error: EOF"`
pub fn parse_connection_error_from_log(line: &str) -> Option<(String, String)> {
    let lower = line.to_ascii_lowercase();
    if !lower.contains("level=warning") && !lower.contains("level=error") && !lower.contains("error:") {
        return None;
    }

    // Extract msg="..." if structured logfmt, otherwise use whole line.
    let msg = if let Some(idx) = line.find("msg=\"") {
        let rest = &line[idx + 5..];
        rest.rfind('"').map(|end| &rest[..end]).unwrap_or(rest)
    } else {
        line
    };

    let dial_idx = msg.find("dial ")?;
    let after_dial = msg[dial_idx + 5..].trim_start();
    let err_idx = after_dial.find("error:")?;
    let before_err = after_dial[..err_idx].trim();
    let reason = after_dial[err_idx + 6..].trim();
    if reason.is_empty() {
        return None;
    }

    // Node name appears right after `dial ` and before ` (match ` or ` --> ` or ` `.
    let node_part = if let Some(match_idx) = before_err.find(" (match ") {
        before_err[..match_idx].trim()
    } else if let Some(arrow_idx) = before_err.find(" --> ") {
        // Format: `<node> <src> --> <dst>`
        let prefix = before_err[..arrow_idx].trim();
        prefix.rsplit_once(' ').map(|(node, _)| node.trim()).unwrap_or(prefix)
    } else {
        before_err
    };

    if node_part.is_empty() {
        return None;
    }

    Some((node_part.to_string(), reason.chars().take(160).collect()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_mihomo_dial_error_log_line() {
        let line = r#"time="2026-11-21T10:00:00Z" level=warning msg="[TCP] dial HK Node 01 (match IN-PORT/7890) 127.0.0.1:54321 --> example.com:443 error: i/o timeout""#;
        let parsed = parse_connection_error_from_log(line);
        assert_eq!(
            parsed,
            Some(("HK Node 01".to_string(), "i/o timeout".to_string()))
        );
    }

    #[test]
    fn computes_timeout_duration_and_weighted_score() {
        let tmp = std::env::temp_dir().join(format!("mhm_analytics_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).expect("create temp dir");
        let store = NodeAnalyticsStore::new(&tmp);

        let t0 = now_epoch_ms().saturating_sub(120_000);
        store.record_latency_sample_at("HK-01", Some(45), t0);
        store.record_latency_sample_at("HK-01", None, t0 + 10_000);
        store.record_latency_sample_at("HK-01", Some(55), t0 + 70_000); // 60s timeout streak

        let dashboard = store.build_dashboard(24, None);
        assert_eq!(dashboard.total_nodes, 1);
        let node = &dashboard.nodes[0];
        assert_eq!(node.node_name, "HK-01");
        assert_eq!(node.timeout_count, 1);
        assert_eq!(node.timeout_duration_ms, 60_000);
        assert!(!node.is_currently_timed_out);
        assert!(node.score > 0.0 && node.score <= 100.0);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn computes_active_avg_max_min_speed_ignoring_idle_ticks() {
        let tmp = std::env::temp_dir().join(format!("mhm_analytics_spd_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).expect("create temp dir");
        let store = NodeAnalyticsStore::new(&tmp);

        let make_snap = |down: u64| -> ConnectionSnapshot {
            serde_json::from_value(serde_json::json!({
                "downloadTotal": down,
                "uploadTotal": 0,
                "memory": 0,
                "connections": [{
                    "id": "c1",
                    "metadata": {
                        "network": "tcp",
                        "type": "Mixed",
                        "sourceIP": "127.0.0.1",
                        "destinationIP": "1.1.1.1",
                        "sourcePort": "1000",
                        "destinationPort": "443",
                        "host": "example.com",
                        "inboundPort": "7890"
                    },
                    "upload": 0,
                    "download": down,
                    "start": "",
                    "chains": ["JP-01", "fallback-7890"],
                    "rule": "IN-PORT",
                    "rulePayload": "7890"
                }]
            }))
            .expect("valid connection snapshot")
        };

        let t0 = now_epoch_ms().saturating_sub(10_000);
        store.record_connection_snapshot_at(&make_snap(0), t0);
        // 2 seconds later: +200 KB -> 100 KB/s
        store.record_connection_snapshot_at(&make_snap(204_800), t0 + 2_000);
        // 2 seconds later: idle (+0) -> should NOT pull min_speed to 0
        store.record_connection_snapshot_at(&make_snap(204_800), t0 + 4_000);
        // 2 seconds later: +600 KB -> 300 KB/s
        store.record_connection_snapshot_at(&make_snap(204_800 + 614_400), t0 + 6_000);

        let dashboard = store.build_dashboard(24, None);
        let node = &dashboard.nodes[0];
        assert!((node.min_speed_bps - 102_400.0).abs() < 1.0);
        assert!((node.max_speed_bps - 307_200.0).abs() < 1.0);
        assert!((node.avg_speed_bps - 204_800.0).abs() < 1.0);

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
