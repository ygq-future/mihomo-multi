use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tracing::{info, warn};

pub const MRS_RULES: &[(&str, &str, &[&str])] = &[
    (
        "geosite-cn.mrs",
        "domain",
        &[
            "https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/cn.mrs",
            "https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/cn.mrs",
            "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/cn.mrs",
            "https://ghproxy.net/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/cn.mrs",
        ],
    ),
    (
        "geosite-private.mrs",
        "domain",
        &[
            "https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/private.mrs",
            "https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/private.mrs",
            "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/private.mrs",
            "https://ghproxy.net/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/private.mrs",
        ],
    ),
    (
        "geoip-cn.mrs",
        "ipcidr",
        &[
            "https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geoip/cn.mrs",
            "https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geoip/cn.mrs",
            "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/cn.mrs",
            "https://ghproxy.net/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat@meta/geo/geoip/cn.mrs",
        ],
    ),
    (
        "geoip-private.mrs",
        "ipcidr",
        &[
            "https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geoip/private.mrs",
            "https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geoip/private.mrs",
            "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat@meta/geo/geoip/private.mrs",
            "https://ghproxy.net/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat@meta/geo/geoip/private.mrs",
        ],
    ),
];
pub const LEGACY_GEO_FILES: &[&str] = &[
    "geosite.dat",
    "GeoSite.dat",
    "geoip.dat",
    "GeoIP.dat",
    "geoip.metadb",
    "Country.mmdb",
];

#[derive(Debug, Default, Clone, serde::Serialize, serde::Deserialize)]
pub struct MrsRulesInfo {
    pub all_present: bool,
    pub missing: Vec<String>,
    pub last_updated_at: Option<u64>,
    pub total_size: u64,
}

pub type MrsRulesStatus = MrsRulesInfo;

pub fn get_rules_dir(work_dir: &Path) -> PathBuf {
    work_dir.join("rules")
}

pub fn cleanup_temp_files(rules_dir: &Path) {
    if let Ok(entries) = std::fs::read_dir(rules_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file()
                && let Some(ext) = path.extension()
                && ext == "downloading"
            {
                info!("Cleaning up leftover temporary rule file: {}", path.display());
                let _ = std::fs::remove_file(&path);
            }
        }
    }
}

pub fn cleanup_legacy_geo_files(work_dir: &Path) {
    for &name in LEGACY_GEO_FILES {
        let target = work_dir.join(name);
        if target.is_file() {
            info!("Removing obsolete legacy geo file: {}", target.display());
            let _ = std::fs::remove_file(&target);
        }
    }
}

pub fn get_mrs_rules_info(work_dir: &Path) -> MrsRulesInfo {
    let rules_dir = get_rules_dir(work_dir);
    let mut missing = Vec::new();
    let mut total_size = 0u64;
    let mut latest_modified = 0u64;

    for (filename, _, _) in MRS_RULES {
        let p = rules_dir.join(filename);
        if let Ok(meta) = std::fs::metadata(&p)
            && meta.len() > 0
        {
            total_size += meta.len();
            if let Ok(modified) = meta.modified()
                && let Ok(duration) = modified.duration_since(std::time::UNIX_EPOCH)
            {
                let secs = duration.as_secs();
                if secs > latest_modified {
                    latest_modified = secs;
                }
            }
        } else {
            missing.push((*filename).to_string());
        }
    }

    MrsRulesInfo {
        all_present: missing.is_empty(),
        missing,
        last_updated_at: if latest_modified > 0 {
            Some(latest_modified)
        } else {
            None
        },
        total_size,
    }
}

pub fn check_mrs_rules(work_dir: &Path) -> MrsRulesStatus {
    let rules_dir = get_rules_dir(work_dir);
    let mut missing = Vec::new();
    for (filename, _, _) in MRS_RULES {
        let p = rules_dir.join(filename);
        if !p.is_file() || std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0) == 0 {
            missing.push((*filename).to_string());
        }
    }
    get_mrs_rules_info(work_dir)
}

pub fn seed_bundled_mrs_rules<R: tauri::Runtime>(app: Option<&tauri::AppHandle<R>>, work_dir: &Path) -> AppResult<()> {
    let rules_dir = get_rules_dir(work_dir);
    std::fs::create_dir_all(&rules_dir).map_err(AppError::Io)?;

    let mut candidate_dirs: Vec<PathBuf> = Vec::new();

    if let Some(app_handle) = app {
        use tauri::Manager;
        if let Ok(resource_dir) = app_handle.path().resource_dir() {
            candidate_dirs.push(resource_dir.join("resources").join("rules"));
            candidate_dirs.push(resource_dir.join("rules"));
        }
    }

    if let Ok(current_exe) = std::env::current_exe()
        && let Some(exe_dir) = current_exe.parent()
    {
        candidate_dirs.push(exe_dir.join("resources").join("rules"));
        candidate_dirs.push(exe_dir.join("rules"));
    }

    candidate_dirs.push(PathBuf::from("src-tauri/resources/rules"));
    candidate_dirs.push(PathBuf::from("resources/rules"));
    candidate_dirs.push(PathBuf::from("../src-tauri/resources/rules"));

    for (filename, _, _) in MRS_RULES {
        let target = rules_dir.join(filename);
        if target.is_file() && std::fs::metadata(&target).map(|m| m.len()).unwrap_or(0) > 0 {
            continue;
        }

        for c_dir in &candidate_dirs {
            let src = c_dir.join(filename);
            if src.is_file() && std::fs::metadata(&src).map(|m| m.len()).unwrap_or(0) > 0 {
                if let Err(e) = std::fs::copy(&src, &target) {
                    warn!("Failed to copy bundled MRS rule from {}: {}", src.display(), e);
                } else {
                    info!("Seeded bundled MRS rule {} -> {}", src.display(), target.display());
                    break;
                }
            }
        }
    }

    Ok(())
}

async fn download_with_fallback(
    client: &reqwest::Client,
    urls: &[&str],
    destination: &Path,
    resource_name: &str,
) -> AppResult<()> {
    let mut last_error = None;
    let temp_destination = destination.with_extension("downloading");

    for &url in urls {
        info!("Attempting to download {} from {}", resource_name, url);
        match client.get(url).send().await {
            Ok(res) if res.status().is_success() => match res.bytes().await {
                Ok(bytes) => {
                    if bytes.is_empty() {
                        warn!(
                            "Downloaded {} from {} was empty, trying next source...",
                            resource_name, url
                        );
                        continue;
                    }

                    if let Err(e) = std::fs::write(&temp_destination, &bytes) {
                        warn!(
                            "Failed to write temporary file for {} from {}: {}",
                            resource_name, url, e
                        );
                        last_error = Some(e.to_string());
                        continue;
                    }

                    if let Err(e) = std::fs::rename(&temp_destination, destination) {
                        warn!(
                            "Failed to rename temporary file to destination for {}: {}",
                            resource_name, e
                        );
                        last_error = Some(e.to_string());
                        continue;
                    }

                    info!(
                        "Successfully downloaded and verified {} ({} bytes)",
                        resource_name,
                        bytes.len()
                    );
                    return Ok(());
                }
                Err(e) => {
                    warn!("Failed to read body of {} from {}: {}", resource_name, url, e);
                    last_error = Some(e.to_string());
                }
            },
            Ok(res) => {
                let status = res.status();
                warn!("HTTP error {} downloading {} from {}", status, resource_name, url);
                last_error = Some(format!("HTTP {}", status));
            }
            Err(e) => {
                warn!("Network error downloading {} from {}: {}", resource_name, url, e);
                last_error = Some(e.to_string());
            }
        }
    }

    let _ = std::fs::remove_file(&temp_destination);

    Err(AppError::Internal(format!(
        "Failed to download {} from all sources. Last error: {:?}",
        resource_name, last_error
    )))
}

pub async fn ensure_mrs_rules<R: tauri::Runtime>(app: Option<&tauri::AppHandle<R>>, work_dir: &Path) -> AppResult<()> {
    let rules_dir = get_rules_dir(work_dir);
    std::fs::create_dir_all(&rules_dir).map_err(AppError::Io)?;

    cleanup_temp_files(&rules_dir);

    // 1. First seed from bundled resources if missing
    let _ = seed_bundled_mrs_rules(app, work_dir);

    let status = check_mrs_rules(work_dir);
    if status.all_present {
        info!("All MRS rules already present in {}", rules_dir.display());
        return Ok(());
    }

    // 2. Download missing rules
    let client = reqwest::Client::builder()
        .user_agent(crate::constants::APP_USER_AGENT)
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| AppError::Internal(format!("Failed to build HTTP client for MRS download: {}", e)))?;

    for (filename, _, urls) in MRS_RULES {
        if status.missing.contains(&filename.to_string()) {
            let dest = rules_dir.join(filename);
            if let Err(e) = download_with_fallback(&client, urls, &dest, filename).await {
                warn!("Failed to download {}: {}", filename, e);
            }
        }
    }

    cleanup_temp_files(&rules_dir);
    Ok(())
}

pub async fn update_mrs_rules(work_dir: &Path) -> AppResult<MrsRulesInfo> {
    let rules_dir = get_rules_dir(work_dir);
    std::fs::create_dir_all(&rules_dir).map_err(AppError::Io)?;
    cleanup_temp_files(&rules_dir);
    cleanup_legacy_geo_files(work_dir);

    let client = reqwest::Client::builder()
        .user_agent(crate::constants::APP_USER_AGENT)
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|e| AppError::Internal(format!("Failed to build HTTP client for MRS update: {}", e)))?;

    let mut failed = Vec::new();
    for (filename, _, urls) in MRS_RULES {
        let dest = rules_dir.join(filename);
        if let Err(e) = download_with_fallback(&client, urls, &dest, filename).await {
            warn!("Failed to update {}: {}", filename, e);
            failed.push((*filename).to_string());
        }
    }

    cleanup_temp_files(&rules_dir);

    if !failed.is_empty() && failed.len() == MRS_RULES.len() {
        return Err(AppError::Internal(format!(
            "所有规则集更新均失败: {}",
            failed.join(", ")
        )));
    }

    Ok(get_mrs_rules_info(work_dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mrs_rules_constants() {
        assert_eq!(MRS_RULES.len(), 4);
        for (name, behavior, urls) in MRS_RULES {
            assert!(name.ends_with(".mrs"));
            assert!(*behavior == "domain" || *behavior == "ipcidr");
            assert!(!urls.is_empty());
        }
    }

    #[test]
    fn test_check_mrs_rules_nonexistent() {
        let temp_dir = std::env::temp_dir().join(format!("mrs_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let status = check_mrs_rules(&temp_dir);
        assert!(!status.all_present);
        assert_eq!(status.missing.len(), 4);
        std::fs::remove_dir_all(&temp_dir).ok();
    }

    #[test]
    fn test_cleanup_temp_files() {
        let temp_dir = std::env::temp_dir().join(format!("mrs_clean_test_{}", uuid::Uuid::new_v4()));
        let rules_dir = temp_dir.join("rules");
        std::fs::create_dir_all(&rules_dir).unwrap();

        let temp_file = rules_dir.join("geosite-cn.downloading");
        std::fs::write(&temp_file, b"test").unwrap();
        assert!(temp_file.exists());

        cleanup_temp_files(&rules_dir);
        assert!(!temp_file.exists());

        std::fs::remove_dir_all(&temp_dir).ok();
    }

    #[test]
    fn test_cleanup_legacy_geo_files() {
        let temp_dir = std::env::temp_dir().join(format!("legacy_clean_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let legacy1 = temp_dir.join("geosite.dat");
        let legacy2 = temp_dir.join("geoip.metadb");
        std::fs::write(&legacy1, b"legacy data").unwrap();
        std::fs::write(&legacy2, b"legacy data").unwrap();
        assert!(legacy1.exists());
        assert!(legacy2.exists());

        cleanup_legacy_geo_files(&temp_dir);
        assert!(!legacy1.exists());
        assert!(!legacy2.exists());

        std::fs::remove_dir_all(&temp_dir).ok();
    }
}
