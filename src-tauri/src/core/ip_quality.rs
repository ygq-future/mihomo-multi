use crate::error::{AppError, AppResult};
use crate::models::{
    CleanIpQualitySource, InboundProtocol, IpNativeStatus, IpNetworkCategory, IpPureQualitySource,
    MediaServiceCategory, MediaUnlockItem, MediaUnlockStatus, NodeIpQualityReport, NodeMediaUnlockReport,
};
use serde_json::Value;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const CLEANIP_REPORT_URL: &str = "https://sh.cd/report";
const CLEANIP_USER_AGENT: &str = "sh.cd/1.3.6 (+https://sh.cd)";
const IPPURE_INFO_URL: &str = "https://my.ippure.com/v1/info";
const IPPURE_USER_AGENT: &str = "mihomo-multi/0.1.0 (clash.meta)";
const IPKK_URL: &str = "https://ipkk.com/";
const BROWSER_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const DEFAULT_QUALITY_TIMEOUT_MS: u64 = 10_000;
const DEFAULT_MEDIA_TIMEOUT_MS: u64 = 8_000;
const CONNECT_TIMEOUT_SECS: u64 = 5;

const DISNEY_CLIENT_TOKEN: &str = "ZGlzbmV5JmJyb3dzZXImMS4wLjA.Cu56AgSfBTDag5NiRA81oLHkDZfu5L3CKadnefEAY84";

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn non_empty_str(v: &Value) -> Option<String> {
    v.as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
}

fn opt_u8_clamped(v: &Value) -> Option<u8> {
    v.as_u64()
        .or_else(|| v.as_i64().filter(|n| *n >= 0).map(|n| n as u64))
        .map(|n| n.min(100) as u8)
}

fn opt_u32(v: &Value) -> Option<u32> {
    v.as_u64().and_then(|n| u32::try_from(n).ok())
}

fn protocol_to_proxy_scheme(protocol: InboundProtocol) -> &'static str {
    match protocol {
        InboundProtocol::Socks5 => "socks5h",
        InboundProtocol::Mixed | InboundProtocol::Http => "http",
    }
}

fn build_http_client_with_scheme(
    proxy_port: Option<u16>,
    proxy_scheme: &str,
    user_agent: &str,
    timeout: Duration,
    follow_redirects: bool,
) -> AppResult<reqwest::Client> {
    let mut builder = reqwest::Client::builder()
        .user_agent(user_agent)
        .timeout(timeout)
        .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS));

    if !follow_redirects {
        builder = builder.redirect(reqwest::redirect::Policy::none());
    }

    if let Some(port) = proxy_port {
        let proxy_url = format!("{proxy_scheme}://127.0.0.1:{port}");
        builder = builder.no_proxy().proxy(reqwest::Proxy::all(&proxy_url)?);
    } else {
        builder = builder.no_proxy();
    }

    builder.build().map_err(AppError::Network)
}

fn build_http_client(
    proxy_port: Option<u16>,
    user_agent: &str,
    timeout: Duration,
    follow_redirects: bool,
) -> AppResult<reqwest::Client> {
    build_http_client_with_scheme(proxy_port, "http", user_agent, timeout, follow_redirects)
}

pub fn parse_cleanip_response(body: &str, latency_ms: u32) -> Result<CleanIpQualitySource, String> {
    let v: Value = serde_json::from_str(body).map_err(|e| format!("CleanIP JSON parse error: {e}"))?;
    if v["ok"].as_bool() != Some(true) {
        return Err("CleanIP reported ok != true".to_string());
    }
    let ip_obj = &v["ip"];
    if ip_obj["ok"].as_bool() == Some(false) {
        return Err("CleanIP ip payload reported ok = false".to_string());
    }
    let ip = non_empty_str(&ip_obj["ip"]).ok_or_else(|| "Missing ip in CleanIP response".to_string())?;

    let assessment = &ip_obj["assessment"];
    let geo = &ip_obj["geo"];
    let network = &ip_obj["network"];
    let risk = &ip_obj["risk"];

    let type_tags = network["type_tags"]
        .as_array()
        .map(|arr| arr.iter().filter_map(non_empty_str).collect())
        .unwrap_or_default();

    Ok(CleanIpQualitySource {
        ip,
        hostname: non_empty_str(&ip_obj["hostname"]),
        score: opt_u8_clamped(&assessment["score"]),
        grade: non_empty_str(&assessment["grade"]),
        ip_type: non_empty_str(&assessment["ip_type"]),
        score_band: non_empty_str(&assessment["score_band"]),
        country: non_empty_str(&geo["country"]),
        country_en: non_empty_str(&geo["country_en"]),
        country_code: non_empty_str(&geo["country_code"]).map(|s| s.to_ascii_uppercase()),
        region: non_empty_str(&geo["region"]),
        region_en: non_empty_str(&geo["region_en"]),
        city: non_empty_str(&geo["city"]),
        city_en: non_empty_str(&geo["city_en"]),
        timezone: non_empty_str(&geo["timezone"]),
        asn: opt_u32(&network["asn"]),
        asn_name: non_empty_str(&network["asn_name"]),
        asn_org: non_empty_str(&network["asn_org"]),
        isp: non_empty_str(&network["isp"]),
        network_type: non_empty_str(&network["network_type"]),
        native_or_broadcast: non_empty_str(&network["native_or_broadcast"]).map(|s| s.to_ascii_uppercase()),
        rpki_status: non_empty_str(&network["rpki_status"]),
        type_tags,
        risk_level: non_empty_str(&risk["risk_level"]),
        risk_score: opt_u8_clamped(&risk["risk_score"]),
        is_datacenter: risk["is_datacenter"].as_bool().or_else(|| risk["is_hosting"].as_bool()),
        is_proxy: risk["is_proxy"].as_bool(),
        is_residential_proxy: risk["is_residential_proxy"].as_bool(),
        is_vpn: risk["is_vpn"].as_bool(),
        is_tor: risk["is_tor"].as_bool(),
        is_crawler: risk["is_crawler"].as_bool(),
        is_abuser: risk["is_abuser"].as_bool(),
        is_mobile: risk["is_mobile"].as_bool(),
        dnsbl_count: opt_u32(&risk["dnsbl_count"]),
        abuse_reports: opt_u32(&risk["abuse_reports"]),
        latency_ms,
    })
}

pub fn parse_ippure_response(body: &str, latency_ms: u32) -> Result<IpPureQualitySource, String> {
    let v: Value = serde_json::from_str(body).map_err(|e| format!("IPPure JSON parse error: {e}"))?;
    let ip = non_empty_str(&v["ip"]).ok_or_else(|| "Missing ip in IPPure response".to_string())?;

    Ok(IpPureQualitySource {
        ip,
        asn: opt_u32(&v["asn"]),
        as_organization: non_empty_str(&v["asOrganization"]),
        country: non_empty_str(&v["country"]),
        country_code: non_empty_str(&v["countryCode"]).map(|s| s.to_ascii_uppercase()),
        region: non_empty_str(&v["region"]),
        city: non_empty_str(&v["city"]),
        timezone: non_empty_str(&v["timezone"]),
        fraud_score: opt_u8_clamped(&v["fraudScore"]),
        is_residential: v["isResidential"].as_bool(),
        is_broadcast: v["isBroadcast"].as_bool(),
        latency_ms,
    })
}

fn infer_cleanip_is_residential(c: &CleanIpQualitySource) -> Option<bool> {
    if c.is_datacenter == Some(true) {
        return Some(false);
    }
    let hint = c
        .network_type
        .as_deref()
        .or(c.ip_type.as_deref())
        .map(|s| s.to_ascii_lowercase());
    match hint.as_deref() {
        Some(t) if t.contains("residential") || t.contains("isp") || t.contains("mobile") => Some(true),
        Some(t) if t.contains("datacenter") || t.contains("hosting") || t.contains("idc") || t.contains("cloud") => {
            Some(false)
        }
        _ => None,
    }
}

fn infer_cleanip_is_broadcast(c: &CleanIpQualitySource) -> Option<bool> {
    match c.native_or_broadcast.as_deref() {
        Some("BROADCAST") => Some(true),
        Some("NATIVE") => Some(false),
        _ => None,
    }
}

fn format_location_display(cleanip: Option<&CleanIpQualitySource>, ippure: Option<&IpPureQualitySource>) -> String {
    let mut parts: Vec<String> = Vec::new();
    let (country, region, city) = if let Some(c) = cleanip {
        (
            c.country.as_deref().or(c.country_en.as_deref()),
            c.region.as_deref().or(c.region_en.as_deref()),
            c.city.as_deref().or(c.city_en.as_deref()),
        )
    } else if let Some(p) = ippure {
        (p.country.as_deref(), p.region.as_deref(), p.city.as_deref())
    } else {
        (None, None, None)
    };

    for seg in [country, region, city].into_iter().flatten() {
        let trimmed = seg.trim();
        if !trimmed.is_empty() && !parts.iter().any(|existing| existing == trimmed) {
            parts.push(trimmed.to_string());
        }
    }

    parts.join(" · ")
}

pub fn synthesize_ip_quality_report(
    cleanip_res: Result<CleanIpQualitySource, String>,
    ippure_res: Result<IpPureQualitySource, String>,
    probed_at_ms: u64,
) -> AppResult<NodeIpQualityReport> {
    let (cleanip, cleanip_error) = match cleanip_res {
        Ok(val) => (Some(val), None),
        Err(err) => (None, Some(err)),
    };
    let (ippure, ippure_error) = match ippure_res {
        Ok(val) => (Some(val), None),
        Err(err) => (None, Some(err)),
    };

    if cleanip.is_none() && ippure.is_none() {
        let c_err = cleanip_error.as_deref().unwrap_or("unknown");
        let p_err = ippure_error.as_deref().unwrap_or("unknown");
        return Err(AppError::Internal(crate::tr!(
            format!("CleanIP 与 IPPure 探测均失败 — CleanIP: {c_err}; IPPure: {p_err}"),
            format!("Both CleanIP and IPPure probes failed — CleanIP: {c_err}; IPPure: {p_err}"),
        )));
    }

    let ip = cleanip
        .as_ref()
        .map(|c| c.ip.clone())
        .or_else(|| ippure.as_ref().map(|p| p.ip.clone()))
        .unwrap_or_default();

    let ip_consistent = match (&cleanip, &ippure) {
        (Some(c), Some(p)) => Some(c.ip == p.ip),
        _ => None,
    };

    let country_code = cleanip
        .as_ref()
        .and_then(|c| c.country_code.clone())
        .or_else(|| ippure.as_ref().and_then(|p| p.country_code.clone()));

    let location_display = format_location_display(cleanip.as_ref(), ippure.as_ref());

    let asn = cleanip
        .as_ref()
        .and_then(|c| c.asn)
        .or_else(|| ippure.as_ref().and_then(|p| p.asn));

    let asn_org = cleanip
        .as_ref()
        .and_then(|c| {
            c.asn_org
                .clone()
                .or_else(|| c.asn_name.clone())
                .or_else(|| c.isp.clone())
        })
        .or_else(|| ippure.as_ref().and_then(|p| p.as_organization.clone()));

    let timezone = cleanip
        .as_ref()
        .and_then(|c| c.timezone.clone())
        .or_else(|| ippure.as_ref().and_then(|p| p.timezone.clone()));

    let ip_mismatched = ip_consistent == Some(false);

    let cleanip_purity = cleanip.as_ref().and_then(|c| c.score);
    let ippure_purity = ippure
        .as_ref()
        .and_then(|p| p.fraud_score.map(|f| 100u8.saturating_sub(f.min(100))));
    let purity_score = if ip_mismatched {
        None
    } else {
        match (cleanip_purity, ippure_purity) {
            (Some(a), Some(b)) => Some(((u16::from(a) + u16::from(b)) / 2) as u8),
            (Some(a), None) => Some(a),
            (None, Some(b)) => Some(b),
            (None, None) => None,
        }
    };

    let cleanip_res_flag = cleanip.as_ref().and_then(infer_cleanip_is_residential);
    let ippure_res_flag = ippure.as_ref().and_then(|p| p.is_residential);
    let network_category = if ip_mismatched {
        IpNetworkCategory::Conflict
    } else {
        match (cleanip_res_flag, ippure_res_flag) {
            (Some(true), Some(true) | None) | (None, Some(true)) => IpNetworkCategory::Residential,
            (Some(false), Some(false) | None) | (None, Some(false)) => IpNetworkCategory::Datacenter,
            (Some(a), Some(b)) if a != b => IpNetworkCategory::Conflict,
            _ => IpNetworkCategory::Unknown,
        }
    };

    let cleanip_bc_flag = cleanip.as_ref().and_then(infer_cleanip_is_broadcast);
    let ippure_bc_flag = ippure.as_ref().and_then(|p| p.is_broadcast);
    let native_status = if ip_mismatched {
        IpNativeStatus::Conflict
    } else {
        match (cleanip_bc_flag, ippure_bc_flag) {
            (Some(false), Some(false) | None) | (None, Some(false)) => IpNativeStatus::Native,
            (Some(true), Some(true) | None) | (None, Some(true)) => IpNativeStatus::Broadcast,
            (Some(a), Some(b)) if a != b => IpNativeStatus::Conflict,
            _ => IpNativeStatus::Unknown,
        }
    };
    Ok(NodeIpQualityReport {
        probed_at_ms,
        ip,
        ip_consistent,
        country_code,
        location_display,
        asn,
        asn_org,
        timezone,
        purity_score,
        network_category,
        native_status,
        cleanip,
        cleanip_error,
        ippure,
        ippure_error,
    })
}

async fn fetch_cleanip_quality(
    proxy_port: Option<u16>,
    proxy_scheme: &str,
    via_proxy: bool,
    timeout: Duration,
) -> Result<CleanIpQualitySource, String> {
    let client = build_http_client_with_scheme(proxy_port, proxy_scheme, CLEANIP_USER_AGENT, timeout, true)
        .map_err(|e| e.to_string())?;
    let mut form = vec![
        ("v", "1.3.6"),
        ("lang", "zh"),
        ("color", "0"),
        ("stage", "ip"),
        ("seq", "1"),
        ("stages", "1"),
        ("banner", "0"),
        ("format", "json"),
    ];
    if via_proxy {
        form.push(("via", "proxy"));
    }

    let start = Instant::now();
    let resp = client
        .post(CLEANIP_REPORT_URL)
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("CleanIP request error: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("CleanIP HTTP {}", resp.status()));
    }

    let body = resp.text().await.map_err(|e| format!("CleanIP read body error: {e}"))?;
    let latency_ms = start.elapsed().as_millis() as u32;
    parse_cleanip_response(&body, latency_ms)
}

async fn fetch_ippure_quality(
    proxy_port: Option<u16>,
    proxy_scheme: &str,
    timeout: Duration,
) -> Result<IpPureQualitySource, String> {
    let client = build_http_client_with_scheme(proxy_port, proxy_scheme, IPPURE_USER_AGENT, timeout, true)
        .map_err(|e| e.to_string())?;
    let start = Instant::now();
    let resp = client
        .get(IPPURE_INFO_URL)
        .send()
        .await
        .map_err(|e| format!("IPPure request error: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("IPPure HTTP {}", resp.status()));
    }

    let body = resp.text().await.map_err(|e| format!("IPPure read body error: {e}"))?;
    let latency_ms = start.elapsed().as_millis() as u32;
    parse_ippure_response(&body, latency_ms)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IpkkFallbackSource {
    pub ip: String,
    pub country: Option<String>,
    pub region: Option<String>,
    pub city: Option<String>,
    pub timezone: Option<String>,
}

pub fn parse_ipkk_response(body: &str) -> Result<IpkkFallbackSource, String> {
    let mut ip = None;
    let mut country = None;
    let mut region = None;
    let mut city = None;
    let mut timezone = None;

    for line in body.lines() {
        let Some((key, val)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim();
        let val = val.trim();
        if val.is_empty() {
            continue;
        }
        match key {
            "ip" => ip = Some(val.to_string()),
            "country" => country = Some(val.to_string()),
            "region" => region = Some(val.to_string()),
            "city" => city = Some(val.to_string()),
            "timezone" => timezone = Some(val.to_string()),
            _ => {}
        }
    }

    let ip = ip.ok_or_else(|| "IPKK response missing ip field".to_string())?;
    Ok(IpkkFallbackSource {
        ip,
        country,
        region,
        city,
        timezone,
    })
}

async fn fetch_ipkk_fallback(
    proxy_port: Option<u16>,
    proxy_scheme: &str,
    timeout: Duration,
) -> Result<IpkkFallbackSource, String> {
    let client = build_http_client_with_scheme(proxy_port, proxy_scheme, IPPURE_USER_AGENT, timeout, true)
        .map_err(|e| e.to_string())?;
    let resp = client.get(IPKK_URL).send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("IPKK HTTP {status}"));
    }
    parse_ipkk_response(&body)
}

pub fn apply_ipkk_fallback(report: &mut NodeIpQualityReport, ipkk: &IpkkFallbackSource) {
    if report.ip.is_empty() {
        report.ip = ipkk.ip.clone();
    }
    if report.ip_consistent.is_none() && !report.ip.is_empty() {
        report.ip_consistent = Some(report.ip == ipkk.ip);
    }
    if report.ippure.is_none() {
        report.ippure = Some(IpPureQualitySource {
            ip: ipkk.ip.clone(),
            asn: None,
            as_organization: Some("ipkk.com (fallback)".to_string()),
            country: ipkk.country.clone(),
            country_code: None,
            region: ipkk.region.clone(),
            city: ipkk.city.clone(),
            timezone: ipkk.timezone.clone(),
            fraud_score: None,
            is_residential: None,
            is_broadcast: None,
            latency_ms: 0,
        });
        report.ippure_error = None;
    }
    if report.location_display.is_empty() {
        let mut parts: Vec<&str> = Vec::new();
        for seg in [&ipkk.country, &ipkk.region, &ipkk.city].into_iter().flatten() {
            let trimmed = seg.trim();
            if !trimmed.is_empty() && !parts.contains(&trimmed) {
                parts.push(trimmed);
            }
        }
        report.location_display = parts.join(" · ");
    }
    if report.timezone.is_none() {
        report.timezone = ipkk.timezone.clone();
    }
}
pub async fn query_ip_quality(proxy_port: Option<u16>, timeout_ms: Option<u64>) -> AppResult<NodeIpQualityReport> {
    query_ip_quality_with_scheme(proxy_port, "http", timeout_ms).await
}

pub async fn query_port_ip_quality(
    port: u16,
    protocol: InboundProtocol,
    timeout_ms: Option<u64>,
) -> AppResult<NodeIpQualityReport> {
    query_ip_quality_with_scheme(Some(port), protocol_to_proxy_scheme(protocol), timeout_ms).await
}

async fn query_ip_quality_with_scheme(
    proxy_port: Option<u16>,
    proxy_scheme: &str,
    timeout_ms: Option<u64>,
) -> AppResult<NodeIpQualityReport> {
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_QUALITY_TIMEOUT_MS).clamp(2000, 30_000));
    let via_proxy = proxy_port.is_some();

    let (cleanip_res, ippure_res) = tokio::join!(
        fetch_cleanip_quality(proxy_port, proxy_scheme, via_proxy, timeout),
        fetch_ippure_quality(proxy_port, proxy_scheme, timeout)
    );

    let needs_fallback = cleanip_res.is_err() || ippure_res.is_err();
    let ipkk_res = if needs_fallback {
        Some(fetch_ipkk_fallback(proxy_port, proxy_scheme, timeout).await)
    } else {
        None
    };
    match synthesize_ip_quality_report(cleanip_res, ippure_res, now_epoch_ms()) {
        Ok(mut report) => {
            if let Some(ipkk_result) = ipkk_res.as_ref() {
                match ipkk_result {
                    Ok(ipkk) => apply_ipkk_fallback(&mut report, ipkk),
                    Err(ipkk_err) => {
                        if let Some(err) = report.ippure_error.as_mut() {
                            err.push_str(&format!(" | IPKK fallback: {ipkk_err}"));
                        }
                    }
                }
            }
            Ok(report)
        }
        Err(err) => {
            if let Some(Ok(ipkk)) = ipkk_res {
                let mut report = NodeIpQualityReport {
                    ip: String::new(),
                    ip_consistent: None,
                    country_code: None,
                    location_display: String::new(),
                    asn: None,
                    asn_org: None,
                    timezone: None,
                    purity_score: None,
                    network_category: IpNetworkCategory::Unknown,
                    native_status: IpNativeStatus::Unknown,
                    cleanip: None,
                    ippure: None,
                    cleanip_error: Some(err.to_string()),
                    ippure_error: None,
                    probed_at_ms: now_epoch_ms(),
                };
                apply_ipkk_fallback(&mut report, &ipkk);
                Ok(report)
            } else {
                Err(err)
            }
        }
    }
}
pub async fn query_ip_quality_single_source(
    proxy_port: Option<u16>,
    source: &str,
    existing: NodeIpQualityReport,
    timeout_ms: Option<u64>,
) -> AppResult<NodeIpQualityReport> {
    query_ip_quality_single_source_with_scheme(proxy_port, "http", source, existing, timeout_ms).await
}

pub async fn query_port_ip_quality_single_source(
    port: u16,
    protocol: InboundProtocol,
    source: &str,
    existing: NodeIpQualityReport,
    timeout_ms: Option<u64>,
) -> AppResult<NodeIpQualityReport> {
    query_ip_quality_single_source_with_scheme(
        Some(port),
        protocol_to_proxy_scheme(protocol),
        source,
        existing,
        timeout_ms,
    )
    .await
}

async fn query_ip_quality_single_source_with_scheme(
    proxy_port: Option<u16>,
    proxy_scheme: &str,
    source: &str,
    existing: NodeIpQualityReport,
    timeout_ms: Option<u64>,
) -> AppResult<NodeIpQualityReport> {
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_QUALITY_TIMEOUT_MS).clamp(2000, 30_000));
    let via_proxy = proxy_port.is_some();

    let (cleanip_res, ippure_res, ipkk_res) = match source {
        "cleanip" => {
            let c_res = fetch_cleanip_quality(proxy_port, proxy_scheme, via_proxy, timeout).await;
            let ipkk = if c_res.is_err() {
                Some(fetch_ipkk_fallback(proxy_port, proxy_scheme, timeout).await)
            } else {
                None
            };
            let p_res = existing.ippure.ok_or_else(|| {
                existing
                    .ippure_error
                    .unwrap_or_else(|| "IPPure unavailable".to_string())
            });
            (c_res, p_res, ipkk)
        }
        "ippure" => {
            let p_res = fetch_ippure_quality(proxy_port, proxy_scheme, timeout).await;
            let ipkk = if p_res.is_err() {
                Some(fetch_ipkk_fallback(proxy_port, proxy_scheme, timeout).await)
            } else {
                None
            };
            let c_res = existing.cleanip.ok_or_else(|| {
                existing
                    .cleanip_error
                    .unwrap_or_else(|| "CleanIP unavailable".to_string())
            });
            (c_res, p_res, ipkk)
        }
        _ => return Err(AppError::Internal(format!("Unknown IP quality source: {source}"))),
    };

    match synthesize_ip_quality_report(cleanip_res, ippure_res, now_epoch_ms()) {
        Ok(mut report) => {
            if let Some(ipkk_result) = ipkk_res.as_ref() {
                match ipkk_result {
                    Ok(ipkk) => apply_ipkk_fallback(&mut report, ipkk),
                    Err(ipkk_err) => {
                        if source == "ippure" {
                            if let Some(err) = report.ippure_error.as_mut() {
                                err.push_str(&format!(" | IPKK fallback: {ipkk_err}"));
                            }
                        } else if let Some(err) = report.cleanip_error.as_mut() {
                            err.push_str(&format!(" | IPKK fallback: {ipkk_err}"));
                        }
                    }
                }
            }
            Ok(report)
        }
        Err(err) => {
            if let Some(Ok(ipkk)) = ipkk_res {
                let mut report = NodeIpQualityReport {
                    ip: String::new(),
                    ip_consistent: None,
                    country_code: None,
                    location_display: String::new(),
                    asn: None,
                    asn_org: None,
                    timezone: None,
                    purity_score: None,
                    network_category: IpNetworkCategory::Unknown,
                    native_status: IpNativeStatus::Unknown,
                    cleanip: None,
                    ippure: None,
                    cleanip_error: Some(err.to_string()),
                    ippure_error: None,
                    probed_at_ms: now_epoch_ms(),
                };
                apply_ipkk_fallback(&mut report, &ipkk);
                Ok(report)
            } else {
                Err(err)
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Streaming / AI Region & Unlock Probes (inspired by sh.cd v1.3.6)
// ---------------------------------------------------------------------------

fn extract_ascii_code_after(haystack: &str, prefix: &str, len: usize, uppercase_only: bool) -> Option<String> {
    let mut search_start = 0;
    while let Some(idx) = haystack[search_start..].find(prefix) {
        let val_start = search_start + idx + prefix.len();
        if let Some(slice) = haystack.get(val_start..val_start + len) {
            let valid = if uppercase_only {
                slice.bytes().all(|b| b.is_ascii_uppercase())
            } else {
                slice.bytes().all(|b| b.is_ascii_alphabetic())
            };
            if valid {
                return Some(slice.to_ascii_uppercase());
            }
        }
        search_start = val_start;
    }
    None
}

fn extract_quoted_field(haystack: &str, prefix: &str) -> Option<String> {
    let idx = haystack.find(prefix)?;
    let rest = &haystack[idx + prefix.len()..];
    let end = rest.find('"')?;
    let val = &rest[..end];
    if !val.is_empty() && val.bytes().all(|b| b.is_ascii_alphabetic()) {
        Some(val.to_ascii_uppercase())
    } else {
        None
    }
}

pub fn parse_cf_trace_loc(body: &str) -> Option<String> {
    for line in body.lines() {
        if let Some(val) = line.strip_prefix("loc=") {
            let code = val.trim();
            if code.len() == 2 && code.bytes().all(|b| b.is_ascii_alphabetic()) {
                return Some(code.to_ascii_uppercase());
            }
        }
    }
    None
}

fn alpha3_to_alpha2(code: &str) -> String {
    match code {
        "USA" => "US",
        "GBR" => "GB",
        "CHN" => "CN",
        "HKG" => "HK",
        "MAC" => "MO",
        "TWN" => "TW",
        "JPN" => "JP",
        "KOR" => "KR",
        "SGP" => "SG",
        "DEU" => "DE",
        "FRA" => "FR",
        "NLD" => "NL",
        "CAN" => "CA",
        "AUS" => "AU",
        "IND" => "IN",
        "RUS" => "RU",
        "BLR" => "BY",
        "IRN" => "IR",
        "PRK" => "KP",
        "SYR" => "SY",
        "CUB" => "CU",
        "BRA" => "BR",
        "TUR" => "TR",
        "MYS" => "MY",
        "THA" => "TH",
        "VNM" => "VN",
        "IDN" => "ID",
        "PHL" => "PH",
        "ITA" => "IT",
        "ESP" => "ES",
        "POL" => "PL",
        "CHE" => "CH",
        "SWE" => "SE",
        "NOR" => "NO",
        "FIN" => "FI",
        "IRL" => "IE",
        "ARE" => "AE",
        other => other,
    }
    .to_string()
}

pub fn parse_netflix_probe(
    status1: u16,
    body1: &str,
    status2: u16,
    body2: &str,
) -> (MediaUnlockStatus, Option<String>) {
    let mut region = None;
    for body in [body1, body2] {
        if let Some(idx) = body.find(",\"countryName\"")
            && idx >= 8
        {
            let prefix_slice = &body[..idx];
            if let Some(id_pos) = prefix_slice.rfind("\"id\":\"") {
                let code_start = id_pos + 6;
                if let Some(code) = prefix_slice.get(code_start..code_start + 2)
                    && code.bytes().all(|b| b.is_ascii_uppercase())
                {
                    region = Some(code.to_string());
                    break;
                }
            }
        }
    }

    let ok = (status1 == 200 && !body1.contains("Oh no")) || (status2 == 200 && !body2.contains("Oh no"));
    let reach = status1 == 200 || status1 == 404 || status2 == 200 || status2 == 404;

    if ok {
        (MediaUnlockStatus::Unlocked, region)
    } else if reach {
        (MediaUnlockStatus::OriginalsOnly, region)
    } else if status1 == 403 || status2 == 403 {
        (MediaUnlockStatus::Blocked, region)
    } else {
        (MediaUnlockStatus::Failed, None)
    }
}

pub fn parse_youtube_probe(body: &str) -> (MediaUnlockStatus, Option<String>) {
    let region = extract_ascii_code_after(body, "\"contentRegion\":\"", 2, true);
    if body.contains("www.google.cn") {
        (MediaUnlockStatus::Blocked, Some("CN".to_string()))
    } else if body.contains("Premium is not available in your country") {
        (MediaUnlockStatus::Blocked, None)
    } else if body.contains("ad-free") {
        (MediaUnlockStatus::Unlocked, region)
    } else {
        (MediaUnlockStatus::Failed, None)
    }
}

pub fn parse_tiktok_probe(
    final_url_path: &str,
    body: &str,
    google_204_ok: bool,
) -> (MediaUnlockStatus, Option<String>) {
    if final_url_path.contains("/about") {
        return (MediaUnlockStatus::Blocked, None);
    }
    if final_url_path.is_empty() && body.is_empty() {
        return if google_204_ok {
            (MediaUnlockStatus::Blocked, None)
        } else {
            (MediaUnlockStatus::Failed, None)
        };
    }
    match extract_quoted_field(body, "\"region\":\"") {
        Some(code) if code.len() == 2 => (MediaUnlockStatus::Unlocked, Some(code)),
        _ => (MediaUnlockStatus::Failed, None),
    }
}

pub fn parse_prime_probe(body: &str) -> (MediaUnlockStatus, Option<String>) {
    let region = extract_ascii_code_after(body, "\"currentTerritory\":\"", 2, true);
    if body.contains("\"isServiceRestricted\":true") {
        (MediaUnlockStatus::Blocked, region)
    } else if region.is_some() {
        (MediaUnlockStatus::Unlocked, region)
    } else {
        (MediaUnlockStatus::Failed, None)
    }
}

pub fn parse_chatgpt_probe(
    compliance_status: u16,
    compliance_body: &str,
    ios_body: &str,
    trace_loc: Option<String>,
) -> (MediaUnlockStatus, Option<String>) {
    if compliance_body.contains("unsupported_country") || ios_body.contains("unsupported_country") {
        (MediaUnlockStatus::Blocked, trace_loc)
    } else if ios_body.contains("VPN") {
        (MediaUnlockStatus::WebOnly, trace_loc)
    } else if compliance_status == 200 {
        (MediaUnlockStatus::Unlocked, trace_loc)
    } else {
        (MediaUnlockStatus::Failed, trace_loc)
    }
}

pub fn parse_claude_probe(
    status: u16,
    location_header: Option<&str>,
    trace_loc: Option<String>,
) -> (MediaUnlockStatus, Option<String>) {
    if let Some(loc) = location_header
        && loc.contains("unavailable-in-region")
    {
        return (MediaUnlockStatus::Blocked, trace_loc);
    }
    if (200..400).contains(&status) {
        return (MediaUnlockStatus::Unlocked, trace_loc);
    }
    if status == 403 {
        return match trace_loc.as_deref() {
            Some("CN" | "HK" | "MO" | "RU" | "BY" | "IR" | "KP" | "SY" | "CU") => {
                (MediaUnlockStatus::Blocked, trace_loc)
            }
            Some(_) => (MediaUnlockStatus::Unlocked, trace_loc),
            None => (MediaUnlockStatus::Failed, None),
        };
    }
    (MediaUnlockStatus::Failed, trace_loc)
}

pub fn parse_gemini_probe(status: u16, body: &str) -> (MediaUnlockStatus, Option<String>) {
    if status != 200 {
        return (MediaUnlockStatus::Failed, None);
    }
    let Some(alpha3) = extract_ascii_code_after(body, ",2,1,200,\"", 3, true) else {
        return (MediaUnlockStatus::Failed, None);
    };
    let alpha2 = alpha3_to_alpha2(&alpha3);
    let blocked = matches!(
        alpha3.as_str(),
        "CHN" | "HKG" | "RUS" | "BLR" | "IRN" | "PRK" | "SYR" | "CUB"
    );
    if blocked {
        (MediaUnlockStatus::Blocked, Some(alpha2))
    } else {
        (MediaUnlockStatus::Unlocked, Some(alpha2))
    }
}

pub fn parse_reddit_probe(status: u16, body: &str) -> (MediaUnlockStatus, Option<String>) {
    let region = extract_ascii_code_after(body, "country=\"", 2, true);
    match status {
        200 => (MediaUnlockStatus::Unlocked, region),
        403 => (MediaUnlockStatus::Blocked, None),
        _ => (MediaUnlockStatus::Failed, None),
    }
}

async fn probe_cf_loc(client: &reqwest::Client, host: &str) -> Option<String> {
    let url = format!("https://{host}/cdn-cgi/trace");
    let resp = client.get(url).send().await.ok()?;
    let body = resp.text().await.ok()?;
    parse_cf_trace_loc(&body)
}

async fn probe_netflix(proxy_port: Option<u16>, timeout: Duration) -> MediaUnlockItem {
    let start = Instant::now();
    let res = match build_http_client(proxy_port, BROWSER_USER_AGENT, timeout, true) {
        Ok(client) => {
            let r1 = client
                .get("https://www.netflix.com/title/81280792")
                .header("Accept-Language", "en-US,en;q=0.9")
                .send();
            let r2 = client
                .get("https://www.netflix.com/title/70143836")
                .header("Accept-Language", "en-US,en;q=0.9")
                .send();
            let (resp1, resp2) = tokio::join!(r1, r2);
            let (s1, b1) = match resp1 {
                Ok(r) => (r.status().as_u16(), r.text().await.unwrap_or_default()),
                Err(_) => (0, String::new()),
            };
            let (s2, b2) = match resp2 {
                Ok(r) => (r.status().as_u16(), r.text().await.unwrap_or_default()),
                Err(_) => (0, String::new()),
            };
            parse_netflix_probe(s1, &b1, s2, &b2)
        }
        Err(_) => (MediaUnlockStatus::Failed, None),
    };
    MediaUnlockItem {
        id: "netflix".to_string(),
        name: "Netflix".to_string(),
        category: MediaServiceCategory::Streaming,
        status: res.0,
        region: res.1,
        latency_ms: start.elapsed().as_millis() as u32,
    }
}

async fn probe_youtube(proxy_port: Option<u16>, timeout: Duration) -> MediaUnlockItem {
    let start = Instant::now();
    let res = match build_http_client(proxy_port, BROWSER_USER_AGENT, timeout, true) {
        Ok(client) => match client
            .get("https://www.youtube.com/premium")
            .header("Cookie", "CONSENT=YES+cb")
            .header("Accept-Language", "en-US,en;q=0.9")
            .send()
            .await
        {
            Ok(resp) => {
                let body = resp.text().await.unwrap_or_default();
                parse_youtube_probe(&body)
            }
            Err(_) => (MediaUnlockStatus::Failed, None),
        },
        Err(_) => (MediaUnlockStatus::Failed, None),
    };
    MediaUnlockItem {
        id: "youtube".to_string(),
        name: "YouTube".to_string(),
        category: MediaServiceCategory::Streaming,
        status: res.0,
        region: res.1,
        latency_ms: start.elapsed().as_millis() as u32,
    }
}

async fn probe_tiktok(proxy_port: Option<u16>, timeout: Duration) -> MediaUnlockItem {
    let start = Instant::now();
    let res = match build_http_client(proxy_port, BROWSER_USER_AGENT, timeout, true) {
        Ok(client) => match client
            .get("https://www.tiktok.com/explore")
            .header("Accept-Language", "en-US,en;q=0.9")
            .send()
            .await
        {
            Ok(resp) => {
                let path = resp.url().path().to_string();
                let body = resp.text().await.unwrap_or_default();
                parse_tiktok_probe(&path, &body, false)
            }
            Err(_) => {
                let g_ok = client.get("https://www.google.com/generate_204").send().await.is_ok();
                parse_tiktok_probe("", "", g_ok)
            }
        },
        Err(_) => (MediaUnlockStatus::Failed, None),
    };
    MediaUnlockItem {
        id: "tiktok".to_string(),
        name: "TikTok".to_string(),
        category: MediaServiceCategory::Social,
        status: res.0,
        region: res.1,
        latency_ms: start.elapsed().as_millis() as u32,
    }
}

async fn probe_disney(proxy_port: Option<u16>, timeout: Duration) -> MediaUnlockItem {
    let start = Instant::now();
    let res = async {
        let client = build_http_client(proxy_port, BROWSER_USER_AGENT, timeout, true).ok()?;
        let dev_resp = client
            .post("https://disney.api.edge.bamgrid.com/devices")
            .header("authorization", format!("Bearer {DISNEY_CLIENT_TOKEN}"))
            .json(&serde_json::json!({
                "deviceFamily": "browser",
                "applicationRuntime": "chrome",
                "deviceProfile": "windows",
                "attributes": {}
            }))
            .send()
            .await
            .ok()?;
        let dev_json: Value = dev_resp.json().await.ok()?;
        let assertion = non_empty_str(&dev_json["assertion"])?;

        let tok_resp = client
            .post("https://disney.api.edge.bamgrid.com/token")
            .header("authorization", format!("Bearer {DISNEY_CLIENT_TOKEN}"))
            .form(&[
                ("grant_type", "urn:ietf:params:oauth:grant-type:token-exchange"),
                ("latitude", "0"),
                ("longitude", "0"),
                ("platform", "browser"),
                ("subject_token", assertion.as_str()),
                ("subject_token_type", "urn:bamtech:params:oauth:token-type:device"),
            ])
            .send()
            .await
            .ok()?;
        let tok_text = tok_resp.text().await.ok()?;
        if tok_text.contains("forbidden-location") {
            return Some((MediaUnlockStatus::Blocked, None));
        }
        let tok_json: Value = serde_json::from_str(&tok_text).ok()?;
        let refresh_token = non_empty_str(&tok_json["refresh_token"])?;

        let gql_resp = client
            .post("https://disney.api.edge.bamgrid.com/graph/v1/device/graphql")
            .header("authorization", DISNEY_CLIENT_TOKEN)
            .json(&serde_json::json!({
                "query": "mutation refreshToken($input: RefreshTokenInput!) { refreshToken(refreshToken: $input) { activeSession { sessionId } } }",
                "variables": { "input": { "refreshToken": refresh_token } }
            }))
            .send()
            .await
            .ok()?;
        let gql_text = gql_resp.text().await.ok()?;
        let region = extract_ascii_code_after(&gql_text, "\"countryCode\":\"", 2, true)?;
        let supported = !gql_text.contains("\"inSupportedLocation\":false");
        Some((
            if supported {
                MediaUnlockStatus::Unlocked
            } else {
                MediaUnlockStatus::Blocked
            },
            Some(region),
        ))
    }
    .await
    .unwrap_or((MediaUnlockStatus::Failed, None));

    MediaUnlockItem {
        id: "disney".to_string(),
        name: "Disney+".to_string(),
        category: MediaServiceCategory::Streaming,
        status: res.0,
        region: res.1,
        latency_ms: start.elapsed().as_millis() as u32,
    }
}

async fn probe_prime(proxy_port: Option<u16>, timeout: Duration) -> MediaUnlockItem {
    let start = Instant::now();
    let res = match build_http_client(proxy_port, BROWSER_USER_AGENT, timeout, true) {
        Ok(client) => match client
            .get("https://www.primevideo.com")
            .header("Accept-Language", "en-US,en;q=0.9")
            .send()
            .await
        {
            Ok(resp) => {
                let body = resp.text().await.unwrap_or_default();
                parse_prime_probe(&body)
            }
            Err(_) => (MediaUnlockStatus::Failed, None),
        },
        Err(_) => (MediaUnlockStatus::Failed, None),
    };
    MediaUnlockItem {
        id: "prime".to_string(),
        name: "Prime Video".to_string(),
        category: MediaServiceCategory::Streaming,
        status: res.0,
        region: res.1,
        latency_ms: start.elapsed().as_millis() as u32,
    }
}

async fn probe_chatgpt(proxy_port: Option<u16>, timeout: Duration) -> MediaUnlockItem {
    let start = Instant::now();
    let res = match build_http_client(proxy_port, BROWSER_USER_AGENT, timeout, true) {
        Ok(client) => {
            let f_comp = client
                .get("https://api.openai.com/compliance/cookie_requirements")
                .header("authorization", "Bearer null")
                .header("origin", "https://platform.openai.com")
                .send();
            let f_ios = client.get("https://ios.chat.openai.com/").send();
            let f_loc = probe_cf_loc(&client, "chatgpt.com");

            let (r_comp, r_ios, loc) = tokio::join!(f_comp, f_ios, f_loc);
            let (c_status, c_body) = match r_comp {
                Ok(r) => (r.status().as_u16(), r.text().await.unwrap_or_default()),
                Err(_) => (0, String::new()),
            };
            let ios_body = match r_ios {
                Ok(r) => r.text().await.unwrap_or_default(),
                Err(_) => String::new(),
            };
            parse_chatgpt_probe(c_status, &c_body, &ios_body, loc)
        }
        Err(_) => (MediaUnlockStatus::Failed, None),
    };
    MediaUnlockItem {
        id: "chatgpt".to_string(),
        name: "ChatGPT".to_string(),
        category: MediaServiceCategory::Ai,
        status: res.0,
        region: res.1,
        latency_ms: start.elapsed().as_millis() as u32,
    }
}

async fn probe_claude(proxy_port: Option<u16>, timeout: Duration) -> MediaUnlockItem {
    let start = Instant::now();
    let res = match build_http_client(proxy_port, BROWSER_USER_AGENT, timeout, false) {
        Ok(client) => {
            let loc = probe_cf_loc(&client, "claude.ai").await;
            let mut status = 0u16;
            let mut location = None;
            for _ in 0..2 {
                if let Ok(resp) = client.get("https://claude.ai/").send().await {
                    status = resp.status().as_u16();
                    location = resp
                        .headers()
                        .get(reqwest::header::LOCATION)
                        .and_then(|v| v.to_str().ok())
                        .map(ToString::to_string);
                    if status != 403 {
                        break;
                    }
                }
            }
            parse_claude_probe(status, location.as_deref(), loc)
        }
        Err(_) => (MediaUnlockStatus::Failed, None),
    };
    MediaUnlockItem {
        id: "claude".to_string(),
        name: "Claude".to_string(),
        category: MediaServiceCategory::Ai,
        status: res.0,
        region: res.1,
        latency_ms: start.elapsed().as_millis() as u32,
    }
}

async fn probe_gemini(proxy_port: Option<u16>, timeout: Duration) -> MediaUnlockItem {
    let start = Instant::now();
    let res = match build_http_client(proxy_port, BROWSER_USER_AGENT, timeout, true) {
        Ok(client) => match client
            .get("https://gemini.google.com/")
            .header("Accept-Language", "en-US,en;q=0.9")
            .send()
            .await
        {
            Ok(resp) => {
                let status = resp.status().as_u16();
                let body = resp.text().await.unwrap_or_default();
                parse_gemini_probe(status, &body)
            }
            Err(_) => (MediaUnlockStatus::Failed, None),
        },
        Err(_) => (MediaUnlockStatus::Failed, None),
    };
    MediaUnlockItem {
        id: "gemini".to_string(),
        name: "Gemini".to_string(),
        category: MediaServiceCategory::Ai,
        status: res.0,
        region: res.1,
        latency_ms: start.elapsed().as_millis() as u32,
    }
}

async fn probe_reddit(proxy_port: Option<u16>, timeout: Duration) -> MediaUnlockItem {
    let start = Instant::now();
    let res = match build_http_client(proxy_port, BROWSER_USER_AGENT, timeout, true) {
        Ok(client) => match client
            .get("https://www.reddit.com/svc/shreddit/reddit-chat")
            .header("Accept-Language", "en-US,en;q=0.9")
            .send()
            .await
        {
            Ok(resp) => {
                let status = resp.status().as_u16();
                let body = resp.text().await.unwrap_or_default();
                parse_reddit_probe(status, &body)
            }
            Err(_) => (MediaUnlockStatus::Failed, None),
        },
        Err(_) => (MediaUnlockStatus::Failed, None),
    };
    MediaUnlockItem {
        id: "reddit".to_string(),
        name: "Reddit".to_string(),
        category: MediaServiceCategory::Social,
        status: res.0,
        region: res.1,
        latency_ms: start.elapsed().as_millis() as u32,
    }
}

pub async fn query_media_unlock(proxy_port: Option<u16>, timeout_ms: Option<u64>) -> NodeMediaUnlockReport {
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_MEDIA_TIMEOUT_MS).clamp(2000, 20_000));
    let (chatgpt, claude, gemini, tiktok, netflix, youtube, disney, prime, reddit) = tokio::join!(
        probe_chatgpt(proxy_port, timeout),
        probe_claude(proxy_port, timeout),
        probe_gemini(proxy_port, timeout),
        probe_tiktok(proxy_port, timeout),
        probe_netflix(proxy_port, timeout),
        probe_youtube(proxy_port, timeout),
        probe_disney(proxy_port, timeout),
        probe_prime(proxy_port, timeout),
        probe_reddit(proxy_port, timeout),
    );

    NodeMediaUnlockReport {
        probed_at_ms: now_epoch_ms(),
        items: vec![chatgpt, claude, gemini, tiktok, netflix, youtube, disney, prime, reddit],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_cleanip_and_ippure_cross_validation() {
        let cleanip_payload = r#"{
            "ok": true,
            "stage": "ip",
            "ip": {
                "ok": true,
                "ip": "35.208.17.17",
                "hostname": "17.17.208.35.bc.googleusercontent.com",
                "assessment": {
                    "ip_type": "IDC",
                    "score_band": "datacenter_stable",
                    "score": 79,
                    "grade": "B"
                },
                "geo": {
                    "country": "美国",
                    "country_code": "US",
                    "country_en": "United States",
                    "region": "爱荷华州",
                    "city": "康瑟尔布拉夫斯",
                    "timezone": "America/Chicago"
                },
                "network": {
                    "asn": 43515,
                    "asn_name": "Google Ireland Limited",
                    "asn_org": "Google Ireland Limited",
                    "isp": "Google Ireland Limited",
                    "network_type": "Datacenter",
                    "native_or_broadcast": "NATIVE",
                    "rpki_status": "unknown",
                    "type_tags": ["cloud", "cdn"]
                },
                "risk": {
                    "is_datacenter": true,
                    "is_proxy": false,
                    "is_residential_proxy": false,
                    "is_vpn": false,
                    "is_tor": false,
                    "is_crawler": false,
                    "is_abuser": false,
                    "is_mobile": false,
                    "risk_level": "Clean",
                    "risk_score": 21,
                    "dnsbl_count": 0,
                    "abuse_reports": 0
                }
            }
        }"#;

        let ippure_payload = r#"{
            "ip": "35.208.17.17",
            "asn": 43515,
            "asOrganization": "Google LLC",
            "country": "United States",
            "countryCode": "US",
            "region": "Iowa",
            "city": "Council Bluffs",
            "timezone": "America/Chicago",
            "fraudScore": 29,
            "isResidential": false,
            "isBroadcast": false
        }"#;

        let cleanip = parse_cleanip_response(cleanip_payload, 120).expect("cleanip parse");
        let ippure = parse_ippure_response(ippure_payload, 85).expect("ippure parse");
        let report =
            synthesize_ip_quality_report(Ok(cleanip), Ok(ippure), 1_700_000_000_000).expect("synthesize report");

        assert_eq!(report.ip, "35.208.17.17");
        assert_eq!(report.ip_consistent, Some(true));
        assert_eq!(report.country_code.as_deref(), Some("US"));
        assert_eq!(report.location_display, "美国 · 爱荷华州 · 康瑟尔布拉夫斯");
        assert_eq!(report.network_category, IpNetworkCategory::Datacenter);
        assert_eq!(report.native_status, IpNativeStatus::Native);
        // CleanIP 79, IPPure (100 - 29) = 71 -> average = 75
        assert_eq!(report.purity_score, Some(75));
    }

    #[test]
    fn test_cross_validation_detects_conflicts_and_partial_fallback() {
        let cleanip_payload = r#"{
            "ok": true,
            "ip": {
                "ok": true,
                "ip": "1.2.3.4",
                "assessment": { "score": 90, "ip_type": "Residential" },
                "geo": { "country": "Japan", "country_code": "JP" },
                "network": { "network_type": "Residential", "native_or_broadcast": "NATIVE" },
                "risk": { "is_datacenter": false }
            }
        }"#;
        let ippure_payload = r#"{
            "ip": "1.2.3.5",
            "country": "Japan",
            "countryCode": "JP",
            "fraudScore": 60,
            "isResidential": false,
            "isBroadcast": true
        }"#;

        let c = parse_cleanip_response(cleanip_payload, 50).expect("cleanip");
        let p = parse_ippure_response(ippure_payload, 60).expect("ippure");
        let conflict = synthesize_ip_quality_report(Ok(c), Ok(p.clone()), 100).expect("conflict report");
        assert_eq!(conflict.ip_consistent, Some(false));
        assert_eq!(conflict.network_category, IpNetworkCategory::Conflict);
        assert_eq!(conflict.native_status, IpNativeStatus::Conflict);
        assert_eq!(conflict.purity_score, None);

        // Single source fallback succeeds
        let fallback = synthesize_ip_quality_report(Err("timeout".to_string()), Ok(p), 100).expect("fallback");
        assert_eq!(fallback.ip, "1.2.3.5");
        assert_eq!(fallback.ip_consistent, None);
        assert_eq!(fallback.purity_score, Some(40));
        assert_eq!(fallback.network_category, IpNetworkCategory::Datacenter);
        assert_eq!(fallback.native_status, IpNativeStatus::Broadcast);
        assert_eq!(fallback.cleanip_error.as_deref(), Some("timeout"));

        // Both failed -> error
        let both_err = synthesize_ip_quality_report(Err("c err".to_string()), Err("p err".to_string()), 100);
        assert!(both_err.is_err());
    }

    #[test]
    fn test_ip_mismatch_prevents_cross_ip_merging() {
        let cleanip_payload = r#"{
            "ok": true,
            "ip": {
                "ok": true,
                "ip": "1.2.3.4",
                "assessment": { "score": 92, "ip_type": "Residential" },
                "geo": { "country": "United States", "country_code": "US" },
                "network": { "network_type": "Residential", "native_or_broadcast": "NATIVE" },
                "risk": { "is_datacenter": false }
            }
        }"#;
        let ippure_payload = r#"{
            "ip": "5.6.7.8",
            "country": "United States",
            "countryCode": "US",
            "fraudScore": 10,
            "isResidential": true,
            "isBroadcast": false
        }"#;

        let c = parse_cleanip_response(cleanip_payload, 40).expect("cleanip");
        let p = parse_ippure_response(ippure_payload, 50).expect("ippure");
        let report = synthesize_ip_quality_report(Ok(c), Ok(p), 200).expect("report");
        assert_eq!(report.ip_consistent, Some(false));
        assert_eq!(report.purity_score, None);
        assert_eq!(report.network_category, IpNetworkCategory::Conflict);
        assert_eq!(report.native_status, IpNativeStatus::Conflict);
        assert_eq!(report.cleanip.as_ref().map(|x| x.ip.as_str()), Some("1.2.3.4"));
        assert_eq!(report.ippure.as_ref().map(|x| x.ip.as_str()), Some("5.6.7.8"));
    }

    #[test]
    fn test_media_and_ai_parsers() {
        assert_eq!(
            parse_netflix_probe(200, r#"{"id":"US","countryName":"United States"}"#, 404, ""),
            (MediaUnlockStatus::Unlocked, Some("US".to_string()))
        );
        assert_eq!(
            parse_netflix_probe(200, "Oh no! Something went wrong", 404, ""),
            (MediaUnlockStatus::OriginalsOnly, None)
        );
        assert_eq!(
            parse_youtube_probe(r#"ad-free "contentRegion":"JP""#),
            (MediaUnlockStatus::Unlocked, Some("JP".to_string()))
        );
        assert_eq!(
            parse_tiktok_probe("/explore", r#"{"region":"SG"}"#, true),
            (MediaUnlockStatus::Unlocked, Some("SG".to_string()))
        );
        assert_eq!(
            parse_tiktok_probe("/zh-Hant/about", "", true),
            (MediaUnlockStatus::Blocked, None)
        );
        assert_eq!(
            parse_chatgpt_probe(200, "{}", "", Some("US".to_string())),
            (MediaUnlockStatus::Unlocked, Some("US".to_string()))
        );
        assert_eq!(
            parse_chatgpt_probe(403, "unsupported_country", "", Some("HK".to_string())),
            (MediaUnlockStatus::Blocked, Some("HK".to_string()))
        );
        assert_eq!(
            parse_claude_probe(
                302,
                Some("https://claude.com/app-unavailable-in-region"),
                Some("HK".to_string())
            ),
            (MediaUnlockStatus::Blocked, Some("HK".to_string()))
        );
        assert_eq!(
            parse_gemini_probe(200, r#"data:[1,2,1,200,"JPN"]"#),
            (MediaUnlockStatus::Unlocked, Some("JP".to_string()))
        );
        assert_eq!(
            parse_gemini_probe(200, r#"data:[1,2,1,200,"HKG"]"#),
            (MediaUnlockStatus::Blocked, Some("HK".to_string()))
        );
        assert_eq!(
            parse_reddit_probe(200, r#"<shreddit-app country="GB">"#),
            (MediaUnlockStatus::Unlocked, Some("GB".to_string()))
        );
    }
    #[test]
    fn test_parse_ipkk_response_and_fallback() {
        let body =
            "ip: 35.208.17.17\ncountry: United States\nregion: Iowa\ncity: Council Bluffs\ntimezone: America/Chicago\n";
        let parsed = parse_ipkk_response(body).expect("parse ipkk");
        assert_eq!(parsed.ip, "35.208.17.17");
        assert_eq!(parsed.country.as_deref(), Some("United States"));
        assert_eq!(parsed.region.as_deref(), Some("Iowa"));
        assert_eq!(parsed.city.as_deref(), Some("Council Bluffs"));
        assert_eq!(parsed.timezone.as_deref(), Some("America/Chicago"));

        let mut report = NodeIpQualityReport {
            ip: "35.208.17.17".to_string(),
            ip_consistent: None,
            country_code: None,
            location_display: String::new(),
            asn: None,
            asn_org: None,
            timezone: None,
            purity_score: None,
            network_category: IpNetworkCategory::Unknown,
            native_status: IpNativeStatus::Unknown,
            cleanip: None,
            ippure: None,
            cleanip_error: Some("timeout".to_string()),
            ippure_error: None,
            probed_at_ms: 0,
        };
        apply_ipkk_fallback(&mut report, &parsed);
        assert_eq!(report.ip_consistent, Some(true));
        assert_eq!(report.location_display, "United States · Iowa · Council Bluffs");
        assert_eq!(report.timezone.as_deref(), Some("America/Chicago"));
    }
}
