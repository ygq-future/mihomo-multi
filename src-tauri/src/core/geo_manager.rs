use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tracing::{info, warn};

pub const GEOSITE_URLS: &[&str] = &[
    "https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geosite.dat",
    "https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geosite.dat",
    "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/release/geosite.dat",
    "https://ghproxy.net/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/release/geosite.dat",
];

pub const GEOIP_URLS: &[&str] = &[
    "https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geoip.dat",
    "https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geoip.dat",
    "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/release/geoip.dat",
    "https://ghproxy.net/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/release/geoip.dat",
];

pub struct GeoDatabaseStatus {
    pub geosite_exists: bool,
    pub geoip_exists: bool,
    pub geosite_size: u64,
    pub geoip_size: u64,
}

/// Removes any leftover `.downloading` temporary files in the work directory
pub fn cleanup_temp_files(work_dir: &Path) {
    if let Ok(entries) = std::fs::read_dir(work_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file()
                && let Some(ext) = path.extension()
                && ext == "downloading"
            {
                info!("Cleaning up leftover temporary file: {}", path.display());
                let _ = std::fs::remove_file(&path);
            }
        }
    }
}

fn check_existing_candidate(work_dir: &Path, candidates: &[&str]) -> (bool, u64, Option<PathBuf>) {
    for &name in candidates {
        let p = work_dir.join(name);
        if let Ok(meta) = std::fs::metadata(&p)
            && meta.len() > 1024
        {
            return (true, meta.len(), Some(p));
        }
    }
    (false, 0, None)
}

pub fn check_geo_databases(work_dir: &Path) -> GeoDatabaseStatus {
    let (geosite_exists, geosite_size, _) =
        check_existing_candidate(work_dir, &["geosite.dat", "GeoSite.dat"]);
    let (geoip_exists, geoip_size, _) =
        check_existing_candidate(work_dir, &["geoip.dat", "GeoIP.dat"]);

    GeoDatabaseStatus {
        geosite_exists,
        geoip_exists,
        geosite_size,
        geoip_size,
    }
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
                    if bytes.len() < 1024 {
                        warn!(
                            "Downloaded {} from {} was suspiciously small ({} bytes), trying next source...",
                            resource_name,
                            url,
                            bytes.len()
                        );
                        last_error = Some(format!("Payload too small: {} bytes", bytes.len()));
                        continue;
                    }

                    if let Err(e) = std::fs::write(&temp_destination, &bytes).map_err(AppError::Io) {
                        warn!("Failed to write temporary file for {}: {}", resource_name, e);
                        last_error = Some(e.to_string());
                        let _ = std::fs::remove_file(&temp_destination);
                        continue;
                    }

                    // Attempt atomic rename to target file
                    match std::fs::rename(&temp_destination, destination) {
                        Ok(()) => {
                            info!(
                                "Successfully downloaded and saved {} ({} bytes) from {}",
                                resource_name,
                                bytes.len(),
                                url
                            );
                            return Ok(());
                        }
                        Err(e) => {
                            // If rename fails (e.g. file is locked by running Mihomo sidecar on Windows)
                            // Check if the destination file already exists and is valid
                            if let Ok(meta) = std::fs::metadata(destination)
                                && meta.len() > 1024
                            {
                                info!(
                                    "Target {} is already present and valid ({} bytes), discarding temporary download",
                                    destination.display(),
                                    meta.len()
                                );
                                let _ = std::fs::remove_file(&temp_destination);
                                return Ok(());
                            }
                            warn!("Failed to rename temporary file for {}: {}", resource_name, e);
                            last_error = Some(e.to_string());
                            let _ = std::fs::remove_file(&temp_destination);
                            continue;
                        }
                    }
                }
                Err(e) => {
                    warn!("Failed to read response body for {} from {}: {}", resource_name, url, e);
                    last_error = Some(e.to_string());
                    let _ = std::fs::remove_file(&temp_destination);
                }
            },
            Ok(res) => {
                warn!("HTTP error {} downloading {} from {}", res.status(), resource_name, url);
                last_error = Some(format!("HTTP status {}", res.status()));
                let _ = std::fs::remove_file(&temp_destination);
            }
            Err(e) => {
                warn!("Network error downloading {} from {}: {}", resource_name, url, e);
                last_error = Some(e.to_string());
                let _ = std::fs::remove_file(&temp_destination);
            }
        }
    }

    // Ensure temp file is cleaned up on total failure
    let _ = std::fs::remove_file(&temp_destination);

    Err(AppError::Internal(format!(
        "Failed to download {} from all sources. Last error: {:?}",
        resource_name, last_error
    )))
}

pub async fn ensure_geo_databases(work_dir: &Path) -> AppResult<()> {
    // 1. Initial cleanup of any historical orphaned .downloading files
    cleanup_temp_files(work_dir);

    let status = check_geo_databases(work_dir);
    if status.geosite_exists && status.geoip_exists {
        info!("Geo databases already present in {}", work_dir.display());
        return Ok(());
    }

    let client = reqwest::Client::builder()
        .user_agent("clash-verge/v2.0.0 (mihomo-multi)")
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| AppError::Internal(format!("Failed to build HTTP client for Geo download: {}", e)))?;

    if !status.geosite_exists {
        let dest = work_dir.join("geosite.dat");
        if let Err(e) = download_with_fallback(&client, GEOSITE_URLS, &dest, "geosite.dat").await {
            warn!("Failed to download geosite.dat: {}", e);
        }
    }

    if !status.geoip_exists {
        let dest = work_dir.join("geoip.dat");
        if let Err(e) = download_with_fallback(&client, GEOIP_URLS, &dest, "geoip.dat").await {
            warn!("Failed to download geoip.dat: {}", e);
        }
    }

    // 2. Final safety cleanup
    cleanup_temp_files(work_dir);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_urls_not_empty() {
        assert!(!GEOSITE_URLS.is_empty());
        assert!(!GEOIP_URLS.is_empty());
        for url in GEOSITE_URLS {
            assert!(url.starts_with("https://"));
        }
        for url in GEOIP_URLS {
            assert!(url.starts_with("https://"));
        }
    }

    #[test]
    fn test_check_geo_databases_nonexistent() {
        let temp_dir = std::env::temp_dir().join(format!("geo_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let status = check_geo_databases(&temp_dir);
        assert!(!status.geosite_exists);
        assert!(!status.geoip_exists);
        std::fs::remove_dir_all(&temp_dir).ok();
    }

    #[test]
    fn test_cleanup_temp_files() {
        let temp_dir = std::env::temp_dir().join(format!("geo_clean_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let temp_file1 = temp_dir.join("geoip.downloading");
        let temp_file2 = temp_dir.join("geosite.downloading");
        let valid_file = temp_dir.join("geoip.dat");

        std::fs::write(&temp_file1, b"partial data").unwrap();
        std::fs::write(&temp_file2, b"partial data").unwrap();
        std::fs::write(&valid_file, b"valid database content").unwrap();

        assert!(temp_file1.exists());
        assert!(temp_file2.exists());
        assert!(valid_file.exists());

        cleanup_temp_files(&temp_dir);

        assert!(!temp_file1.exists());
        assert!(!temp_file2.exists());
        assert!(valid_file.exists());

        std::fs::remove_dir_all(&temp_dir).ok();
    }
}
