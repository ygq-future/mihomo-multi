use crate::error::{AppError, AppResult};
use crate::models::DirectEgressInfo;
use serde_json::Value;
use std::time::{Duration, Instant};

const PROBE_TIMEOUT_SECS: u64 = 4;
const DEFAULT_USER_AGENT: &str = "mihomo-multi/0.1.0 (clash.meta)";

#[derive(Debug, Clone)]
pub struct ProbeEndpoint {
    pub name: &'static str,
    pub url: &'static str,
    /// Whether this endpoint is hosted in mainland China (must be skipped for proxy egress probes
    /// so `bypass_cn` / `geosite-cn` rules never route the probe through DIRECT).
    pub is_cn_endpoint: bool,
}

pub const PROBE_ENDPOINTS: [ProbeEndpoint; 4] = [
    ProbeEndpoint {
        name: "ip.sb",
        url: "https://api-ipv4.ip.sb/geoip",
        is_cn_endpoint: false,
    },
    ProbeEndpoint {
        name: "ipwho.is",
        url: "https://ipwho.is/",
        is_cn_endpoint: false,
    },
    ProbeEndpoint {
        name: "ipip.net",
        url: "https://myip.ipip.net/json",
        is_cn_endpoint: true,
    },
    ProbeEndpoint {
        name: "ipapi.co",
        url: "https://ipapi.co/json/",
        is_cn_endpoint: false,
    },
];

pub fn parse_probe_response(
    name: &str,
    body: &str,
) -> Result<(String, String, Option<String>, Option<String>), String> {
    let v: Value = serde_json::from_str(body).map_err(|e| format!("JSON parse error: {}", e))?;
    let res: Result<(String, String, Option<String>, Option<String>), String> = match name {
        "ip.sb" => {
            let ip = v["ip"].as_str().ok_or("Missing ip")?.trim().to_string();
            let country = v["country"].as_str().unwrap_or("").trim();
            let city = v["city"].as_str().unwrap_or("").trim();
            let region = if !country.is_empty() && !city.is_empty() && country != city {
                format!("{} · {}", country, city)
            } else if !country.is_empty() {
                country.to_string()
            } else if !city.is_empty() {
                city.to_string()
            } else {
                "未知区域".to_string()
            };
            let country_code = v["country_code"].as_str().map(|s| s.to_uppercase());
            let isp = v["isp"]
                .as_str()
                .or_else(|| v["organization"].as_str())
                .map(|s| s.trim().to_string());
            Ok((ip, region, country_code, isp))
        }
        "ipwho.is" => {
            if v["success"].as_bool() == Some(false) {
                return Err("API reported success: false".to_string());
            }
            let ip = v["ip"].as_str().ok_or("Missing ip")?.trim().to_string();
            let country = v["country"].as_str().unwrap_or("").trim();
            let city = v["city"].as_str().unwrap_or("").trim();
            let region = if !country.is_empty() && !city.is_empty() && country != city {
                format!("{} · {}", country, city)
            } else if !country.is_empty() {
                country.to_string()
            } else {
                "未知区域".to_string()
            };
            let country_code = v["country_code"].as_str().map(|s| s.to_uppercase());
            let isp = v["connection"]["isp"]
                .as_str()
                .or_else(|| v["connection"]["org"].as_str())
                .map(|s| s.trim().to_string());
            Ok((ip, region, country_code, isp))
        }
        "ipip.net" => {
            if v["ret"].as_str() != Some("ok") {
                return Err("API reported ret != ok".to_string());
            }
            let ip = v["data"]["ip"].as_str().ok_or("Missing ip")?.trim().to_string();
            let loc = v["data"]["location"].as_array();
            let mut parts = Vec::new();
            let mut isp = None;
            let mut country_code = None;
            if let Some(arr) = loc {
                if let Some(country) = arr.first().and_then(|s| s.as_str()).filter(|s| !s.is_empty()) {
                    parts.push(country);
                    if country == "中国" {
                        country_code = Some("CN".to_string());
                    }
                }
                if let Some(prov) = arr.get(1).and_then(|s| s.as_str()).filter(|s| !s.is_empty()) {
                    parts.push(prov);
                }
                if let Some(city) = arr.get(2).and_then(|s| s.as_str()).filter(|s| !s.is_empty())
                    && !parts.contains(&city)
                {
                    parts.push(city);
                }
                if let Some(carrier) = arr.get(4).and_then(|s| s.as_str()).filter(|s| !s.is_empty()) {
                    isp = Some(carrier.trim().to_string());
                }
            }
            let region = if parts.is_empty() {
                "中国".to_string()
            } else {
                parts.join(" · ")
            };
            Ok((ip, region, country_code, isp))
        }
        "ipapi.co" => {
            if let Some(err) = v["error"].as_bool()
                && err
            {
                return Err(v["reason"].as_str().unwrap_or("API reported error").to_string());
            }
            let ip = v["ip"].as_str().ok_or("Missing ip")?.trim().to_string();
            let country = v["country_name"].as_str().unwrap_or("").trim();
            let city = v["city"].as_str().unwrap_or("").trim();
            let region = if !country.is_empty() && !city.is_empty() && country != city {
                format!("{} · {}", country, city)
            } else if !country.is_empty() {
                country.to_string()
            } else {
                "未知区域".to_string()
            };
            let country_code = v["country_code"].as_str().map(|s| s.to_uppercase());
            let isp = v["org"].as_str().map(|s| s.trim().to_string());
            Ok((ip, region, country_code, isp))
        }
        _ => Err(format!("Unknown endpoint: {}", name)),
    };
    let (ip, region, country_code, isp) = res?;

    if ip.parse::<std::net::Ipv4Addr>().is_err() {
        return Err(format!("IP '{}' 不是合法的 IPv4 地址，已自动过滤", ip));
    }

    Ok((ip, region, country_code, isp))
}

pub async fn query_direct_egress_info(port: Option<u16>, timeout_ms: Option<u64>) -> AppResult<DirectEgressInfo> {
    query_egress_info_with_mode(port, timeout_ms, false).await
}

pub async fn query_proxy_egress_info(port: u16, timeout_ms: Option<u64>) -> AppResult<DirectEgressInfo> {
    query_egress_info_with_mode(Some(port), timeout_ms, true).await
}

async fn query_egress_info_with_mode(
    port: Option<u16>,
    timeout_ms: Option<u64>,
    skip_cn_endpoints: bool,
) -> AppResult<DirectEgressInfo> {
    let per_api_timeout = Duration::from_millis(timeout_ms.unwrap_or(PROBE_TIMEOUT_SECS * 1000));
    let mut last_err = String::new();

    for ep in &PROBE_ENDPOINTS {
        if skip_cn_endpoints && ep.is_cn_endpoint {
            continue;
        }
        let mut builder = reqwest::Client::builder()
            .user_agent(DEFAULT_USER_AGENT)
            .timeout(per_api_timeout)
            .connect_timeout(Duration::from_secs(2));

        if let Some(p) = port {
            let proxy_url = format!("http://127.0.0.1:{}", p);
            if let Ok(proxy) = reqwest::Proxy::all(&proxy_url) {
                builder = builder.proxy(proxy);
            }
        } else {
            builder = builder.no_proxy();
        }
        let client = match builder.build() {
            Ok(c) => c,
            Err(e) => {
                last_err = format!("Failed to build HTTP client: {}", e);
                continue;
            }
        };

        let start = Instant::now();
        match client.get(ep.url).send().await {
            Ok(resp) => {
                if !resp.status().is_success() {
                    last_err = format!("{}: HTTP status {}", ep.name, resp.status());
                    continue;
                }
                match resp.text().await {
                    Ok(body) => match parse_probe_response(ep.name, &body) {
                        Ok((ip, region, country_code, isp)) => {
                            let latency_ms = start.elapsed().as_millis() as u32;
                            return Ok(DirectEgressInfo {
                                ip,
                                region,
                                country_code,
                                isp,
                                latency_ms: Some(latency_ms),
                                source: ep.name.to_string(),
                            });
                        }
                        Err(parse_err) => {
                            last_err = format!("{}: parse error {}", ep.name, parse_err);
                        }
                    },
                    Err(e) => {
                        last_err = format!("{}: read body error {}", ep.name, e);
                    }
                }
            }
            Err(e) => {
                last_err = format!("{}: request error {}", ep.name, e);
            }
        }
    }

    Err(AppError::Internal(format!(
        "所有出口 IP 探测接口均失败，最后一次错误: {}",
        last_err
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_ipsb() {
        let payload = r#"{
            "ip": "141.11.146.79",
            "country": "Hong Kong",
            "country_code": "HK",
            "region": "Kwai Tsing District",
            "city": "Kwai Chung",
            "isp": "Ikuuu Network"
        }"#;
        let (ip, region, cc, isp) = parse_probe_response("ip.sb", payload).unwrap();
        assert_eq!(ip, "141.11.146.79");
        assert_eq!(region, "Hong Kong · Kwai Chung");
        assert_eq!(cc.as_deref(), Some("HK"));
        assert_eq!(isp.as_deref(), Some("Ikuuu Network"));
    }

    #[test]
    fn test_parse_ipwhois() {
        let payload = r#"{
            "ip": "1.1.1.1",
            "success": true,
            "country": "Australia",
            "country_code": "AU",
            "city": "Sydney",
            "connection": {
                "isp": "Cloudflare, Inc."
            }
        }"#;
        let (ip, region, cc, isp) = parse_probe_response("ipwho.is", payload).unwrap();
        assert_eq!(ip, "1.1.1.1");
        assert_eq!(region, "Australia · Sydney");
        assert_eq!(cc.as_deref(), Some("AU"));
        assert_eq!(isp.as_deref(), Some("Cloudflare, Inc."));
    }

    #[test]
    fn test_parse_ipip() {
        let payload = r#"{"ret":"ok","data":{"ip":"223.73.200.228","location":["中国","广东","广州","","移动"]}}"#;
        let (ip, region, cc, isp) = parse_probe_response("ipip.net", payload).unwrap();
        assert_eq!(ip, "223.73.200.228");
        assert_eq!(region, "中国 · 广东 · 广州");
        assert_eq!(cc.as_deref(), Some("CN"));
        assert_eq!(isp.as_deref(), Some("移动"));
    }

    #[test]
    fn test_parse_ipapico() {
        let payload = r#"{
            "ip": "8.8.8.8",
            "country_name": "United States",
            "country_code": "US",
            "city": "Mountain View",
            "org": "Google LLC"
        }"#;
        let (ip, region, cc, isp) = parse_probe_response("ipapi.co", payload).unwrap();
        assert_eq!(ip, "8.8.8.8");
        assert_eq!(region, "United States · Mountain View");
        assert_eq!(cc.as_deref(), Some("US"));
        assert_eq!(isp.as_deref(), Some("Google LLC"));
    }

    #[test]
    fn test_reject_ipv6() {
        let payload_ipv6 = r#"{
            "ip": "240e:390:851:a230:1111:2222:3333:4444",
            "country": "China",
            "country_code": "CN",
            "city": "Guangzhou"
        }"#;
        let res = parse_probe_response("ip.sb", payload_ipv6);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("不是合法的 IPv4 地址"));
    }

    #[test]
    fn test_probe_endpoints_cn_classification() {
        let cn_count = PROBE_ENDPOINTS.iter().filter(|ep| ep.is_cn_endpoint).count();
        let global_count = PROBE_ENDPOINTS.iter().filter(|ep| !ep.is_cn_endpoint).count();
        assert_eq!(cn_count, 1);
        assert_eq!(global_count, 3);
        assert!(PROBE_ENDPOINTS.iter().any(|ep| ep.name == "ipip.net" && ep.is_cn_endpoint));
    }
}
