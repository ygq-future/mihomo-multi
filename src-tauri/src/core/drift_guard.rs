use crate::core::profile_manager::ProfileManager;
use crate::models::{DriftStatus, PortDriftReport, PortMapping, ResidentialProxy};
use std::collections::HashSet;

pub struct DriftGuard;

impl DriftGuard {
    /// Inspects all port mappings and returns drift reports for each mapping.
    /// Eliminates redundant queries when multiple ports belong to the same subscription.
    pub fn check_all(
        mappings: &[PortMapping],
        profile_manager: &ProfileManager,
        residential_proxies: &[ResidentialProxy],
    ) -> Vec<PortDriftReport> {
        let profiles = profile_manager.get_profiles();
        let profile_map: std::collections::HashMap<String, String> =
            profiles.into_iter().map(|p| (p.id, p.name)).collect();

        // Cache candidate node names per unique profile ID to avoid redundant lookups
        let mut node_cache: std::collections::HashMap<String, Result<Vec<String>, String>> =
            std::collections::HashMap::new();

        for m in mappings {
            if profile_map.contains_key(&m.profile_id) {
                node_cache.entry(m.profile_id.clone()).or_insert_with(|| {
                    match profile_manager.get_profile_nodes(&m.profile_id) {
                        Ok(nodes) => Ok(nodes.into_iter().map(|n| n.name).collect()),
                        Err(err) => Err(err.to_string()),
                    }
                });
            }
        }

        mappings
            .iter()
            .map(|m| Self::check_single_internal(m, profile_manager, &profile_map, &node_cache, residential_proxies))
            .collect()
    }

    /// Inspects a single port mapping and returns its drift report.
    pub fn check_single(
        mapping: &PortMapping,
        profile_manager: &ProfileManager,
        residential_proxies: &[ResidentialProxy],
    ) -> PortDriftReport {
        let profile = profile_manager.get_profile_by_id(&mapping.profile_id);
        let mut profile_map = std::collections::HashMap::new();
        let mut node_cache = std::collections::HashMap::new();

        if let Some(p) = profile {
            profile_map.insert(p.id.clone(), p.name);
            let nodes_res = profile_manager
                .get_profile_nodes(&mapping.profile_id)
                .map(|nodes| nodes.into_iter().map(|n| n.name).collect())
                .map_err(|e| e.to_string());
            node_cache.insert(mapping.profile_id.clone(), nodes_res);
        }

        Self::check_single_internal(mapping, profile_manager, &profile_map, &node_cache, residential_proxies)
    }

    fn check_single_internal(
        mapping: &PortMapping,
        profile_manager: &ProfileManager,
        profile_map: &std::collections::HashMap<String, String>,
        node_cache: &std::collections::HashMap<String, Result<Vec<String>, String>>,
        residential_proxies: &[ResidentialProxy],
    ) -> PortDriftReport {
        if mapping.id == crate::models::FIXED_DIRECT_PORT_ID || mapping.node_name == "DIRECT" {
            return PortDriftReport {
                mapping_id: mapping.id.clone(),
                port: mapping.port,
                profile_id: mapping.profile_id.clone(),
                profile_name: crate::tr!("系统直连".to_string(), "System Direct".to_string()),
                node_name: "DIRECT".to_string(),
                enabled: mapping.enabled,
                status: DriftStatus::Healthy,
                message: crate::tr!(
                    "内置直连监听，流量直通不走代理，状态正常".to_string(),
                    "Built-in DIRECT listener: traffic bypasses the proxy and is healthy".to_string()
                ),
                fallback_action: "DIRECT".to_string(),
                suggestions: Vec::new(),
            };
        }

        let chain_exit_id = mapping
            .residential_proxy_id
            .as_deref()
            .map(str::trim)
            .filter(|id| !id.is_empty());
        let is_chain = chain_exit_id.is_some();
        if let Some(exit_id) = chain_exit_id {
            let invalid_message = match residential_proxies.iter().find(|proxy| proxy.id.trim() == exit_id) {
                None => Some(crate::tr!(
                    format!(
                        "住宅代理出口 (ID: {}) 已不存在，链式端口不可用（不会回退直连）",
                        exit_id
                    ),
                    format!(
                        "Residential exit (ID: {}) no longer exists; chain port unavailable (no DIRECT fallback)",
                        exit_id
                    )
                )),
                Some(exit) => exit.validate().err().map(|err| {
                    crate::tr!(
                        format!(
                            "住宅代理出口「{}」配置无效（{}），链式端口不可用（不会回退直连）",
                            exit.name, err
                        ),
                        format!(
                            "Residential exit \"{}\" is misconfigured ({}); chain port unavailable (no DIRECT fallback)",
                            exit.name, err
                        )
                    )
                }),
            };
            if let Some(message) = invalid_message {
                return PortDriftReport {
                    mapping_id: mapping.id.clone(),
                    port: mapping.port,
                    profile_id: mapping.profile_id.clone(),
                    profile_name: profile_map
                        .get(&mapping.profile_id)
                        .cloned()
                        .unwrap_or_else(|| crate::tr!("未知订阅".to_string(), "Unknown Subscription".to_string())),
                    node_name: mapping.node_name.clone(),
                    enabled: mapping.enabled,
                    status: DriftStatus::NodeMissing,
                    message,
                    fallback_action: "REJECT".to_string(),
                    suggestions: Vec::new(),
                };
            }
        }

        let profile_name = profile_map
            .get(&mapping.profile_id)
            .cloned()
            .unwrap_or_else(|| crate::tr!("未知订阅".to_string(), "Unknown Subscription".to_string()));

        // 1. Check if profile exists
        if !profile_map.contains_key(&mapping.profile_id) {
            let message = if is_chain {
                crate::tr!(
                    format!(
                        "关联的订阅配置 (ID: {}) 已被移除，住宅代理链不可用（不会回退直连）",
                        mapping.profile_id
                    ),
                    format!(
                        "Linked subscription (ID: {}) was removed; residential chain unavailable (no DIRECT fallback)",
                        mapping.profile_id
                    )
                )
            } else {
                crate::tr!(
                    format!(
                        "关联的订阅配置 (ID: {}) 已被移除，端口流量已安全直连 (DIRECT)",
                        mapping.profile_id
                    ),
                    format!(
                        "Linked subscription (ID: {}) was removed; port traffic safely uses DIRECT",
                        mapping.profile_id
                    )
                )
            };
            return PortDriftReport {
                mapping_id: mapping.id.clone(),
                port: mapping.port,
                profile_id: mapping.profile_id.clone(),
                profile_name,
                node_name: mapping.node_name.clone(),
                enabled: mapping.enabled,
                status: DriftStatus::ProfileMissing,
                message,
                fallback_action: if is_chain {
                    "REJECT".to_string()
                } else {
                    "DIRECT".to_string()
                },
                suggestions: Vec::new(),
            };
        }

        // 2. Fetch candidate nodes from memory cache
        let candidate_names = match node_cache.get(&mapping.profile_id) {
            Some(Ok(names)) => names,
            Some(Err(err)) => {
                let message = if is_chain {
                    crate::tr!(
                        format!(
                            "读取订阅「{}」节点失败 ({})，住宅代理链不可用（不会回退直连）",
                            profile_name, err
                        ),
                        format!(
                            "Failed to read nodes for subscription \"{}\" ({}); residential chain unavailable (no DIRECT fallback)",
                            profile_name, err
                        )
                    )
                } else {
                    crate::tr!(
                        format!(
                            "读取订阅「{}」节点失败 ({})，端口流量已安全直连 (DIRECT)",
                            profile_name, err
                        ),
                        format!(
                            "Failed to read nodes for subscription \"{}\" ({}); port traffic safely uses DIRECT",
                            profile_name, err
                        )
                    )
                };
                return PortDriftReport {
                    mapping_id: mapping.id.clone(),
                    port: mapping.port,
                    profile_id: mapping.profile_id.clone(),
                    profile_name: profile_name.clone(),
                    node_name: mapping.node_name.clone(),
                    enabled: mapping.enabled,
                    status: DriftStatus::EmptyProfile,
                    message,
                    fallback_action: if is_chain {
                        "REJECT".to_string()
                    } else {
                        "DIRECT".to_string()
                    },
                    suggestions: Vec::new(),
                };
            }
            None => {
                let message = if is_chain {
                    crate::tr!(
                        format!(
                            "关联的订阅配置 (ID: {}) 已被移除，住宅代理链不可用（不会回退直连）",
                            mapping.profile_id
                        ),
                        format!(
                            "Linked subscription (ID: {}) was removed; residential chain unavailable (no DIRECT fallback)",
                            mapping.profile_id
                        )
                    )
                } else {
                    crate::tr!(
                        format!(
                            "关联的订阅配置 (ID: {}) 已被移除，端口流量已安全直连 (DIRECT)",
                            mapping.profile_id
                        ),
                        format!(
                            "Linked subscription (ID: {}) was removed; port traffic safely uses DIRECT",
                            mapping.profile_id
                        )
                    )
                };
                return PortDriftReport {
                    mapping_id: mapping.id.clone(),
                    port: mapping.port,
                    profile_id: mapping.profile_id.clone(),
                    profile_name: profile_name.clone(),
                    node_name: mapping.node_name.clone(),
                    enabled: mapping.enabled,
                    status: DriftStatus::ProfileMissing,
                    message,
                    fallback_action: if is_chain {
                        "REJECT".to_string()
                    } else {
                        "DIRECT".to_string()
                    },
                    suggestions: Vec::new(),
                };
            }
        };

        if candidate_names.is_empty() {
            let message = if is_chain {
                crate::tr!(
                    format!(
                        "订阅「{}」中无可用代理节点，住宅代理链不可用（不会回退直连）",
                        profile_name
                    ),
                    format!(
                        "Subscription \"{}\" has no usable proxy nodes; residential chain unavailable (no DIRECT fallback)",
                        profile_name
                    )
                )
            } else {
                crate::tr!(
                    format!("订阅「{}」中无可用代理节点，端口流量已安全直连 (DIRECT)", profile_name),
                    format!(
                        "Subscription \"{}\" has no usable proxy nodes; port traffic safely uses DIRECT",
                        profile_name
                    )
                )
            };
            return PortDriftReport {
                mapping_id: mapping.id.clone(),
                port: mapping.port,
                profile_id: mapping.profile_id.clone(),
                profile_name: profile_name.clone(),
                node_name: mapping.node_name.clone(),
                enabled: mapping.enabled,
                status: DriftStatus::EmptyProfile,
                message,
                fallback_action: if is_chain {
                    "REJECT".to_string()
                } else {
                    "DIRECT".to_string()
                },
                suggestions: Vec::new(),
            };
        }

        // 3. Check node existence in memory
        let main_node_exists = candidate_names.iter().any(|name| name == &mapping.node_name);
        let fb_profile_id = mapping.fallback_profile_id.as_deref().unwrap_or(&mapping.profile_id);
        let fallback_node_exists = mapping
            .fallback_node_name
            .as_ref()
            .map(|fb| {
                if fb_profile_id == mapping.profile_id {
                    candidate_names.iter().any(|name| name == fb)
                } else {
                    profile_manager.has_node(fb_profile_id, fb)
                }
            })
            .unwrap_or(false);
        if main_node_exists {
            let message = if is_chain {
                crate::tr!(
                    "节点正常绑定，住宅代理链已启用".to_string(),
                    "Node binding healthy; residential chain is active".to_string()
                )
            } else if let Some(fb) = &mapping.fallback_node_name {
                if fallback_node_exists {
                    crate::tr!(
                        format!("节点正常绑定 (备用节点: {})", fb),
                        format!("Node binding healthy (fallback node: {})", fb)
                    )
                } else {
                    crate::tr!(
                        format!("主节点正常绑定，但配置的备用节点「{}」在订阅中已不存在", fb),
                        format!(
                            "Primary node is healthy, but the configured fallback node \"{}\" no longer exists in the subscription",
                            fb
                        )
                    )
                }
            } else {
                crate::tr!("节点正常绑定".to_string(), "Node binding healthy".to_string())
            };

            return PortDriftReport {
                mapping_id: mapping.id.clone(),
                port: mapping.port,
                profile_id: mapping.profile_id.clone(),
                profile_name,
                node_name: mapping.node_name.clone(),
                enabled: mapping.enabled,
                status: DriftStatus::Healthy,
                message,
                fallback_action: "NONE".to_string(),
                suggestions: Vec::new(),
            };
        }

        // 4. Main node is missing / drifted -> calculate similarity suggestions
        let suggestions = Self::find_candidate_suggestions(&mapping.node_name, candidate_names);

        if is_chain {
            return PortDriftReport {
                mapping_id: mapping.id.clone(),
                port: mapping.port,
                profile_id: mapping.profile_id.clone(),
                profile_name: profile_name.clone(),
                node_name: mapping.node_name.clone(),
                enabled: mapping.enabled,
                status: DriftStatus::NodeMissing,
                message: crate::tr!(
                    format!(
                        "上游节点「{}」在订阅「{}」中已失效或被重命名，住宅代理链不可用（不会回退直连）",
                        mapping.node_name, profile_name
                    ),
                    format!(
                        "Upstream node \"{}\" is invalid or renamed in subscription \"{}\"; residential chain unavailable (no DIRECT fallback)",
                        mapping.node_name, profile_name
                    )
                ),
                fallback_action: "REJECT".to_string(),
                suggestions,
            };
        }

        if let Some(fb) = &mapping.fallback_node_name
            && fallback_node_exists
        {
            PortDriftReport {
                mapping_id: mapping.id.clone(),
                port: mapping.port,
                profile_id: mapping.profile_id.clone(),
                profile_name: profile_name.clone(),
                node_name: mapping.node_name.clone(),
                enabled: mapping.enabled,
                status: DriftStatus::NodeMissing,
                message: crate::tr!(
                    format!(
                        "主节点「{}」已在订阅中失效，端口流量已自动降级至备用节点「{}」",
                        mapping.node_name, fb
                    ),
                    format!(
                        "Primary node \"{}\" is invalid in the subscription; port traffic automatically degraded to fallback node \"{}\"",
                        mapping.node_name, fb
                    )
                ),
                fallback_action: format!("FALLBACK:{}", fb),
                suggestions,
            }
        } else {
            PortDriftReport {
                mapping_id: mapping.id.clone(),
                port: mapping.port,
                profile_id: mapping.profile_id.clone(),
                profile_name: profile_name.clone(),
                node_name: mapping.node_name.clone(),
                enabled: mapping.enabled,
                status: DriftStatus::NodeMissing,
                message: crate::tr!(
                    format!(
                        "绑定节点「{}」在订阅「{}」中已失效或被重命名，端口流量已安全直连 (DIRECT)",
                        mapping.node_name, profile_name
                    ),
                    format!(
                        "Bound node \"{}\" is invalid or renamed in subscription \"{}\"; port traffic safely uses DIRECT",
                        mapping.node_name, profile_name
                    )
                ),
                fallback_action: "DIRECT".to_string(),
                suggestions,
            }
        }
    }
    /// Finds candidate suggestions for a drifted node name from available nodes in the profile.
    pub fn find_candidate_suggestions(target: &str, candidate_names: &[String]) -> Vec<String> {
        if target.trim().is_empty() || candidate_names.is_empty() {
            return Vec::new();
        }

        let target_lower = target.to_lowercase();
        let target_tokens: HashSet<&str> = target_lower
            .split(|c: char| !c.is_alphanumeric())
            .filter(|s| !s.is_empty())
            .collect();

        let mut scored_candidates: Vec<(&String, u32)> = Vec::new();

        for candidate in candidate_names {
            let cand_lower = candidate.to_lowercase();
            let mut score = 0u32;

            // Exact case-insensitive match
            if cand_lower == target_lower {
                score += 1000;
            }

            // Substring containment
            if cand_lower.contains(&target_lower) || target_lower.contains(&cand_lower) {
                score += 200;
            }

            // Token overlap
            let cand_tokens: HashSet<&str> = cand_lower
                .split(|c: char| !c.is_alphanumeric())
                .filter(|s| !s.is_empty())
                .collect();

            let common_tokens = target_tokens.intersection(&cand_tokens).count();
            score += (common_tokens as u32) * 50;

            // Prefix matching
            if cand_lower.starts_with(&target_lower[..std::cmp::min(3, target_lower.len())]) {
                score += 30;
            }

            if score > 0 {
                scored_candidates.push((candidate, score));
            }
        }

        // Sort by score descending
        scored_candidates.sort_by_key(|b| std::cmp::Reverse(b.1));

        scored_candidates.into_iter().take(5).map(|(c, _)| c.clone()).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::InboundProtocol;
    use uuid::Uuid;

    #[test]
    fn test_candidate_suggestions() {
        let candidates = vec![
            "HK-Shadowsocks-01-V2".to_string(),
            "HK-Shadowsocks-02".to_string(),
            "US-VMess-01".to_string(),
            "JP-Trojan-01".to_string(),
            "[0.5x] HK-Shadowsocks-01".to_string(),
        ];

        let suggestions = DriftGuard::find_candidate_suggestions("HK-Shadowsocks-01", &candidates);
        assert!(!suggestions.is_empty());
        assert!(suggestions.contains(&"[0.5x] HK-Shadowsocks-01".to_string()));
        assert!(suggestions.contains(&"HK-Shadowsocks-01-V2".to_string()));
    }

    #[test]
    fn test_drift_guard_healthy_and_drift_detection() {
        let temp_dir = std::env::temp_dir().join(format!("mihomo_test_drift_{}", Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).expect("Create temp dir failed");

        let yaml = r#"
proxies:
  - name: "HK-01"
    type: ss
    server: 1.1.1.1
    port: 8388
  - name: "JP-02"
    type: trojan
    server: 2.2.2.2
    port: 443
"#;
        let source_file = temp_dir.join("source.yaml");
        std::fs::write(&source_file, yaml).expect("Write source yaml failed");

        let manager = ProfileManager::new(temp_dir.clone());
        let profile = manager
            .add_local_profile("TestAirport".to_string(), source_file.to_string_lossy().to_string())
            .expect("Add local profile failed");

        // 1. Healthy mapping
        let healthy_mapping = PortMapping {
            id: "m-1".to_string(),
            port: 7891,
            protocol: InboundProtocol::Mixed,
            profile_id: profile.id.clone(),
            node_name: "HK-01".to_string(),
            enabled: true,
            latency: None,
            description: None,
            fallback_profile_id: None,
            fallback_node_name: None,
            bypass_cn: true,
            manual_fallback: false,
            residential_proxy_id: None,
            chain_exit_profile_id: None,
            chain_exit_node_name: None,
            rules: vec![],
        };
        // 2. Drifted mapping (Node missing)
        let drifted_mapping = PortMapping {
            id: "m-2".to_string(),
            port: 7892,
            protocol: InboundProtocol::Mixed,
            profile_id: profile.id.clone(),
            node_name: "HK-Old-01".to_string(),
            enabled: true,
            latency: None,
            description: None,
            fallback_profile_id: None,
            fallback_node_name: None,
            bypass_cn: true,
            manual_fallback: false,
            residential_proxy_id: None,
            chain_exit_profile_id: None,
            chain_exit_node_name: None,
            rules: vec![],
        };
        // 3. Drifted mapping (Profile missing)
        let missing_profile_mapping = PortMapping {
            id: "m-3".to_string(),
            port: 7893,
            protocol: InboundProtocol::Mixed,
            profile_id: "non-existent-profile".to_string(),
            node_name: "HK-01".to_string(),
            enabled: true,
            latency: None,
            description: None,
            fallback_profile_id: None,
            fallback_node_name: None,
            bypass_cn: true,
            manual_fallback: false,
            residential_proxy_id: None,
            chain_exit_profile_id: None,
            chain_exit_node_name: None,
            rules: vec![],
        };
        let mappings = vec![
            healthy_mapping.clone(),
            drifted_mapping.clone(),
            missing_profile_mapping.clone(),
        ];

        let reports = DriftGuard::check_all(&mappings, &manager, &[]);
        assert_eq!(reports.len(), 3);

        assert_eq!(reports[0].status, DriftStatus::Healthy);
        assert_eq!(reports[0].fallback_action, "NONE");

        assert_eq!(reports[1].status, DriftStatus::NodeMissing);
        assert_eq!(reports[1].fallback_action, "DIRECT");
        assert_eq!(reports[1].profile_name, "TestAirport");
        assert!(!reports[1].suggestions.is_empty());

        assert_eq!(reports[2].status, DriftStatus::ProfileMissing);
        assert_eq!(reports[2].fallback_action, "DIRECT");

        // 4. Test empty profile drift
        let empty_yaml = "rules:\n  - MATCH,DIRECT\n";
        let empty_source_file = temp_dir.join("empty.yaml");
        std::fs::write(&empty_source_file, empty_yaml).expect("Write empty yaml");

        let empty_profile = manager
            .add_local_profile(
                "EmptyAirport".to_string(),
                empty_source_file.to_string_lossy().to_string(),
            )
            .expect("Add empty profile");

        let empty_mapping = PortMapping {
            id: "m-4".to_string(),
            port: 7894,
            protocol: InboundProtocol::Mixed,
            profile_id: empty_profile.id.clone(),
            node_name: "AnyNode".to_string(),
            enabled: true,
            latency: None,
            description: None,
            fallback_profile_id: None,
            fallback_node_name: None,
            bypass_cn: true,
            manual_fallback: false,
            residential_proxy_id: None,
            chain_exit_profile_id: None,
            chain_exit_node_name: None,
            rules: vec![],
        };
        let single_report = DriftGuard::check_single(&empty_mapping, &manager, &[]);
        assert_eq!(single_report.status, DriftStatus::EmptyProfile);
        assert_eq!(single_report.fallback_action, "DIRECT");
        assert_eq!(single_report.profile_name, "EmptyAirport");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_drift_guard_pure_in_memory() {
        // Fulfills acceptance criterion 6:
        // "Unit and integration tests verify profile parsing, indexing, and drift detection
        // purely in memory without relying on temporary disk files."
        let manager = ProfileManager::new_in_memory();

        let yaml = r#"
proxies:
  - name: "HK-Shadowsocks-01"
    type: ss
    server: 1.1.1.1
    port: 8388
  - name: "HK-Shadowsocks-02"
    type: ss
    server: 1.1.1.2
    port: 8389
  - name: "Backup-Node"
    type: trojan
    server: 2.2.2.2
    port: 443
"#;
        let profile = manager
            .add_in_memory_profile("InMemoryAirport".to_string(), yaml)
            .expect("Add in-memory profile failed");

        // 1. Port 1: Healthy
        let port1 = PortMapping {
            id: "p-1".to_string(),
            port: 10001,
            protocol: InboundProtocol::Mixed,
            profile_id: profile.id.clone(),
            node_name: "HK-Shadowsocks-01".to_string(),
            enabled: true,
            latency: None,
            description: None,
            fallback_profile_id: None,
            fallback_node_name: None,
            bypass_cn: true,
            manual_fallback: false,
            residential_proxy_id: None,
            chain_exit_profile_id: None,
            chain_exit_node_name: None,
            rules: vec![],
        };

        // 2. Port 2: Main node drifted, fallback active
        let port2 = PortMapping {
            id: "p-2".to_string(),
            port: 10002,
            protocol: InboundProtocol::Mixed,
            profile_id: profile.id.clone(),
            node_name: "Old-Nonexistent-Node".to_string(),
            enabled: true,
            latency: None,
            description: None,
            fallback_profile_id: None,
            fallback_node_name: Some("Backup-Node".to_string()),
            bypass_cn: true,
            manual_fallback: false,
            residential_proxy_id: None,
            chain_exit_profile_id: None,
            chain_exit_node_name: None,
            rules: vec![],
        };
        // 3. Port 3: Same profile, drifted without fallback
        let port3 = PortMapping {
            id: "p-3".to_string(),
            port: 10003,
            protocol: InboundProtocol::Mixed,
            profile_id: profile.id.clone(),
            node_name: "HK-Shadowsocks-Old".to_string(),
            enabled: true,
            latency: None,
            description: None,
            fallback_profile_id: None,
            fallback_node_name: None,
            bypass_cn: true,
            manual_fallback: false,
            residential_proxy_id: None,
            chain_exit_profile_id: None,
            chain_exit_node_name: None,
            rules: vec![],
        };
        // 4. Port 4: Non-existent profile
        let port4 = PortMapping {
            id: "p-4".to_string(),
            port: 10004,
            protocol: InboundProtocol::Mixed,
            profile_id: "missing-profile-id".to_string(),
            node_name: "Any-Node".to_string(),
            enabled: true,
            latency: None,
            description: None,
            fallback_profile_id: None,
            fallback_node_name: None,
            bypass_cn: true,
            manual_fallback: false,
            residential_proxy_id: None,
            chain_exit_profile_id: None,
            chain_exit_node_name: None,
            rules: vec![],
        };

        let mappings = vec![port1.clone(), port2.clone(), port3.clone(), port4.clone()];
        let reports = DriftGuard::check_all(&mappings, &manager, &[]);
        assert_eq!(reports.len(), 4);

        assert_eq!(reports[0].status, DriftStatus::Healthy);
        assert_eq!(reports[0].fallback_action, "NONE");

        assert_eq!(reports[1].status, DriftStatus::NodeMissing);
        assert_eq!(reports[1].fallback_action, "FALLBACK:Backup-Node");

        assert_eq!(reports[2].status, DriftStatus::NodeMissing);
        assert_eq!(reports[2].fallback_action, "DIRECT");
        assert!(!reports[2].suggestions.is_empty());
        assert!(reports[2].suggestions.contains(&"HK-Shadowsocks-01".to_string()));

        assert_eq!(reports[3].status, DriftStatus::ProfileMissing);
        assert_eq!(reports[3].fallback_action, "DIRECT");

        // Test in-memory update triggers drift detection
        let updated_yaml = r#"
proxies:
  - name: "HK-Shadowsocks-02"
    type: ss
    server: 1.1.1.2
    port: 8389
"#;
        manager
            .update_profile_with_yaml(&profile.id, updated_yaml)
            .expect("Update in-memory profile failed");

        // Port 1 previously healthy should now be drifted because HK-Shadowsocks-01 was removed
        let report_after_update = DriftGuard::check_single(&port1, &manager, &[]);
        assert_eq!(report_after_update.status, DriftStatus::NodeMissing);
        assert_eq!(report_after_update.fallback_action, "DIRECT");
    }

    #[test]
    fn test_drift_guard_cross_profile_fallback() {
        let manager = ProfileManager::new_in_memory();
        let yaml1 = "proxies:\n  - name: HK-01\n    type: ss\n    server: 1.1.1.1\n    port: 8388\n";
        let yaml2 = "proxies:\n  - name: HK-Backup\n    type: ss\n    server: 2.2.2.2\n    port: 8388\n";
        let p1 = manager.add_in_memory_profile("Airport1".to_string(), yaml1).unwrap();
        let p2 = manager.add_in_memory_profile("Airport2".to_string(), yaml2).unwrap();

        let mapping = PortMapping {
            id: "p-cross".to_string(),
            port: 10005,
            protocol: InboundProtocol::Mixed,
            profile_id: p1.id.clone(),
            node_name: "HK-Gone".to_string(),
            enabled: true,
            latency: None,
            description: None,
            fallback_profile_id: Some(p2.id.clone()),
            fallback_node_name: Some("HK-Backup".to_string()),
            bypass_cn: true,
            manual_fallback: false,
            residential_proxy_id: None,
            chain_exit_profile_id: None,
            chain_exit_node_name: None,
            rules: vec![],
        };

        let report = DriftGuard::check_single(&mapping, &manager, &[]);
        assert_eq!(report.status, DriftStatus::NodeMissing);
        assert_eq!(report.fallback_action, "FALLBACK:HK-Backup");
    }

    #[test]
    fn test_chain_drift_never_claims_direct_fallback() {
        let manager = ProfileManager::new_in_memory();
        let exit = ResidentialProxy {
            id: "res-1".to_string(),
            name: "Managed Exit".to_string(),
            protocol: "http".to_string(),
            server: "127.0.0.1".to_string(),
            port: 55942,
            username: "chain-user".to_string(),
            password: "pw-1234".to_string(),
        };
        let mut mapping = PortMapping {
            id: "chain-port".to_string(),
            port: 7891,
            protocol: InboundProtocol::Mixed,
            profile_id: "missing-profile".to_string(),
            node_name: "HK-01".to_string(),
            residential_proxy_id: Some("res-1".to_string()),
            enabled: true,
            bypass_cn: false,
            ..PortMapping::default()
        };

        let report = DriftGuard::check_single(&mapping, &manager, std::slice::from_ref(&exit));
        assert_eq!(report.status, DriftStatus::ProfileMissing);
        assert_eq!(report.fallback_action, "REJECT");
        assert!(
            report
                .message
                .contains(crate::tr!("不会回退直连", "no DIRECT fallback"))
        );

        let report = DriftGuard::check_single(&mapping, &manager, &[]);
        assert_eq!(report.status, DriftStatus::NodeMissing);
        assert_eq!(report.fallback_action, "REJECT");
        assert!(report.message.contains(crate::tr!("住宅代理出口", "Residential exit")));

        // Non-chain mappings keep the existing DIRECT drift semantics.
        mapping.residential_proxy_id = None;
        let report = DriftGuard::check_single(&mapping, &manager, &[]);
        assert_eq!(report.status, DriftStatus::ProfileMissing);
        assert_eq!(report.fallback_action, "DIRECT");
    }
}
