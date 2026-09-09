use crate::core::supervisor::CoreSupervisor;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::Manager;
use tracing::{info, warn};

const USER_AGENT: &str = crate::constants::APP_USER_AGENT;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const GITHUB_LATEST_RELEASE_API: &str = "https://api.github.com/repos/MetaCubeX/mihomo/releases/latest";
const GITHUB_VERSION_TXT: &str = "https://github.com/MetaCubeX/mihomo/releases/latest/download/version.txt";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KernelUpdateCheckResult {
    pub is_portable: bool,
    pub target_path: String,
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub release_notes: Option<String>,
    pub release_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KernelUpgradeResult {
    pub previous_version: String,
    pub current_version: String,
    pub target_path: String,
    pub is_portable: bool,
}

#[derive(Debug, Clone)]
pub struct TargetSpec {
    pub name: &'static str,
    pub ext: &'static str,
    pub target_file: &'static str,
}

pub fn get_current_target_spec() -> Option<TargetSpec> {
    if cfg!(target_os = "windows") {
        if cfg!(target_arch = "aarch64") {
            Some(TargetSpec {
                name: "mihomo-windows-arm64",
                ext: "zip",
                target_file: "mihomo-aarch64-pc-windows-msvc.exe",
            })
        } else if cfg!(target_arch = "x86") {
            Some(TargetSpec {
                name: "mihomo-windows-386",
                ext: "zip",
                target_file: "mihomo-i686-pc-windows-msvc.exe",
            })
        } else {
            Some(TargetSpec {
                name: "mihomo-windows-amd64-v2",
                ext: "zip",
                target_file: "mihomo-x86_64-pc-windows-msvc.exe",
            })
        }
    } else if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            Some(TargetSpec {
                name: "mihomo-darwin-arm64-go122",
                ext: "gz",
                target_file: "mihomo-aarch64-apple-darwin",
            })
        } else {
            Some(TargetSpec {
                name: "mihomo-darwin-amd64-go122",
                ext: "gz",
                target_file: "mihomo-x86_64-apple-darwin",
            })
        }
    } else if cfg!(target_os = "linux") {
        if cfg!(target_arch = "aarch64") {
            Some(TargetSpec {
                name: "mihomo-linux-arm64",
                ext: "gz",
                target_file: "mihomo-aarch64-unknown-linux-gnu",
            })
        } else {
            Some(TargetSpec {
                name: "mihomo-linux-amd64-v2",
                ext: "gz",
                target_file: "mihomo-x86_64-unknown-linux-gnu",
            })
        }
    } else {
        None
    }
}

/// Checks if the application is running in portable mode based strictly on
/// the presence of a `.portable` or `PORTABLE` marker file next to the executable.
pub fn is_portable_mode() -> bool {
    if let Ok(current_exe) = std::env::current_exe()
        && let Some(exe_dir) = current_exe.parent()
    {
        return exe_dir.join(".portable").exists() || exe_dir.join("PORTABLE").exists();
    }
    false
}

/// Resolves the destination file path for kernel upgrades:
/// - Portable mode: `exe_dir/binaries/mihomo-<target>`
/// - Installed mode: `app_local_data_dir/binaries/mihomo-<target>`
pub fn get_kernel_destination(app: &tauri::AppHandle) -> AppResult<(bool, PathBuf)> {
    let host_target = CoreSupervisor::get_host_target();
    let binary_name = format!("mihomo-{}", host_target);
    let is_portable = is_portable_mode();

    if is_portable
        && let Ok(current_exe) = std::env::current_exe()
        && let Some(exe_dir) = current_exe.parent()
    {
        let bin_dir = exe_dir.join("binaries");
        return Ok((true, bin_dir.join(&binary_name)));
    }

    let app_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| AppError::Internal(format!("Failed to resolve app local data dir: {}", e)))?;
    let bin_dir = app_dir.join("binaries");
    Ok((false, bin_dir.join(&binary_name)))
}

/// Normalizes version strings for comparison, e.g. "Mihomo Meta v1.19.30 ..." -> "1.19.30"
pub fn extract_version_number(v: &str) -> String {
    for part in v.split_whitespace() {
        let cleaned = part.trim_start_matches('v').trim_start_matches('V');
        let parts: Vec<&str> = cleaned.split('.').collect();
        if parts.len() >= 2 && parts.iter().all(|p| p.chars().all(|c| c.is_ascii_digit())) {
            return cleaned.to_string();
        }
    }
    // Fallback if raw string starts with v
    v.trim().trim_start_matches('v').trim_start_matches('V').to_string()
}

/// Compares version numbers (e.g. "1.19.30" vs "1.19.31")
pub fn is_newer_version(current: &str, latest: &str) -> bool {
    let cur_clean = extract_version_number(current);
    let lat_clean = extract_version_number(latest);

    let cur_nums: Vec<u64> = cur_clean.split('.').filter_map(|s| s.parse().ok()).collect();
    let lat_nums: Vec<u64> = lat_clean.split('.').filter_map(|s| s.parse().ok()).collect();

    if cur_nums.is_empty() || lat_nums.is_empty() {
        return cur_clean != lat_clean;
    }

    lat_nums > cur_nums
}

fn build_http_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(AppError::Network)
}

#[derive(Deserialize)]
struct GitHubReleaseResponse {
    tag_name: String,
    body: Option<String>,
    html_url: Option<String>,
}

pub async fn check_kernel_update(app: &tauri::AppHandle, state: &AppState) -> AppResult<KernelUpdateCheckResult> {
    let (is_portable, target_path) = get_kernel_destination(app)?;
    let client = build_http_client()?;

    let current_version_raw = state
        .engine
        .get_status()
        .version
        .unwrap_or_else(|| "Unknown".to_string());

    // 1. Try querying GitHub releases API
    let mut latest_version = String::new();
    let mut release_notes: Option<String> = None;
    let mut release_url: Option<String> = None;

    match client.get(GITHUB_LATEST_RELEASE_API).send().await {
        Ok(res) if res.status().is_success() => {
            if let Ok(gh_release) = res.json::<GitHubReleaseResponse>().await {
                latest_version = gh_release.tag_name;
                release_notes = gh_release.body;
                release_url = gh_release.html_url;
            }
        }
        _ => {}
    }

    // 2. Fallback to version.txt if API was rate-limited or failed
    if latest_version.is_empty() {
        let res = client
            .get(GITHUB_VERSION_TXT)
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to fetch latest kernel version: {}", e)))?;
        let text = res
            .text()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to read version text: {}", e)))?;
        latest_version = text.trim().to_string();
    }

    let has_update = is_newer_version(&current_version_raw, &latest_version);

    Ok(KernelUpdateCheckResult {
        is_portable,
        target_path: target_path.to_string_lossy().to_string(),
        current_version: current_version_raw,
        latest_version,
        has_update,
        release_notes,
        release_url,
    })
}

fn extract_binary_from_zip(bytes: &[u8]) -> AppResult<Vec<u8>> {
    let reader = Cursor::new(bytes);
    let mut archive =
        zip::ZipArchive::new(reader).map_err(|e| AppError::Internal(format!("Failed to parse zip archive: {}", e)))?;

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| AppError::Internal(format!("Zip read entry error: {}", e)))?;
        let name = file.name().to_string();
        if name.ends_with(".exe") || (!name.contains('.') && !name.ends_with('/')) {
            let mut buf = Vec::new();
            file.read_to_end(&mut buf)
                .map_err(|e| AppError::Internal(format!("Failed to extract file from zip: {}", e)))?;
            return Ok(buf);
        }
    }

    Err(AppError::Internal(
        "No executable found inside downloaded zip archive".to_string(),
    ))
}

fn extract_binary_from_gz(bytes: &[u8]) -> AppResult<Vec<u8>> {
    let mut decoder = GzDecoder::new(bytes);
    let mut decompressed = Vec::new();
    decoder
        .read_to_end(&mut decompressed)
        .map_err(|e| AppError::Internal(format!("Failed to decompress gz archive: {}", e)))?;
    Ok(decompressed)
}

/// Cleans up any leftover `.downloading` files in a given directory
pub fn cleanup_downloading_files(dir: &Path) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(ext) = path.extension()
                && ext == "downloading"
            {
                info!("Cleaning up leftover downloading file: {}", path.display());
                let _ = std::fs::remove_file(&path);
            }
        }
    }
}

pub async fn download_and_apply_kernel(app: &tauri::AppHandle, state: &AppState) -> AppResult<KernelUpgradeResult> {
    let (is_portable, target_path) = get_kernel_destination(app)?;
    let target_spec = get_current_target_spec().ok_or_else(|| {
        AppError::Internal("Current platform architecture is unsupported for auto-upgrade".to_string())
    })?;

    let client = build_http_client()?;

    // 1. Get latest version tag
    let version_res = client
        .get(GITHUB_VERSION_TXT)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to query latest version: {}", e)))?;
    let version = version_res
        .text()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read version string: {}", e)))?
        .trim()
        .to_string();

    let archive_name = format!("{}-{}.{}", target_spec.name, version, target_spec.ext);
    let download_url = format!(
        "https://github.com/MetaCubeX/mihomo/releases/download/{}/{}",
        version, archive_name
    );

    info!("Downloading kernel from: {}", download_url);

    let res = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to download kernel archive: {}", e)))?;

    if !res.status().is_success() {
        return Err(AppError::Internal(format!(
            "Failed to download kernel from {}: HTTP {}",
            download_url,
            res.status()
        )));
    }

    let archive_bytes = res
        .bytes()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read kernel download stream: {}", e)))?;

    // 2. Extract executable bytes from archive
    let binary_bytes = if target_spec.ext == "zip" {
        extract_binary_from_zip(&archive_bytes)?
    } else if target_spec.ext == "gz" {
        extract_binary_from_gz(&archive_bytes)?
    } else {
        return Err(AppError::Internal(format!(
            "Unsupported archive extension: {}",
            target_spec.ext
        )));
    };

    let target_dir = target_path
        .parent()
        .ok_or_else(|| AppError::Internal("Invalid target path parent".to_string()))?;
    std::fs::create_dir_all(target_dir)?;

    cleanup_downloading_files(target_dir);

    let temp_target = target_path.with_extension("downloading");

    // 3. Write to temporary file
    std::fs::write(&temp_target, &binary_bytes)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o755);
        let _ = std::fs::set_permissions(&temp_target, perms);
    }

    // 4. Pre-validate binary executable by checking output of `-v`
    let supervisor = CoreSupervisor::new(target_dir.to_path_buf());
    let verified_version = supervisor.query_version(&temp_target).ok_or_else(|| {
        let _ = std::fs::remove_file(&temp_target);
        AppError::Internal("Downloaded kernel verification failed (-v check returned invalid output)".to_string())
    })?;

    info!(
        "Successfully downloaded and verified kernel version: {}",
        verified_version
    );

    let previous_version = state
        .engine
        .get_status()
        .version
        .unwrap_or_else(|| "Unknown".to_string());

    // 5. Stop running engine to unlock the executable on Windows
    let was_running = state.engine.get_status().running;
    if was_running {
        info!("Stopping running Mihomo kernel to unlock binary file");
        if let Err(e) = state.engine.stop() {
            warn!("Failed to cleanly stop engine prior to kernel replacement: {}", e);
        }
        // Give Windows a brief moment to finish process handle teardown
        tokio::time::sleep(Duration::from_millis(300)).await;
    }

    // 6. Clean replacement: remove target if exists, rename temp into place
    if target_path.exists() {
        std::fs::remove_file(&target_path).map_err(|e| {
            AppError::Internal(format!(
                "Failed to remove old kernel file at {}: {}",
                target_path.display(),
                e
            ))
        })?;
    }

    std::fs::rename(&temp_target, &target_path).map_err(|e| {
        AppError::Internal(format!(
            "Failed to place new kernel into {}: {}",
            target_path.display(),
            e
        ))
    })?;

    // Thorough cleanup of any leftover temporary files
    cleanup_downloading_files(target_dir);

    // 7. Restart engine if it was previously running
    if was_running {
        info!("Restarting Mihomo engine with upgraded kernel");
        let config = state.config.read().clone();
        if let Err(e) = state.engine.start(Some(app), &config) {
            warn!("Failed to restart engine with new kernel: {}", e);
        }
    }
    Ok(KernelUpgradeResult {
        previous_version,
        current_version: verified_version,
        target_path: target_path.to_string_lossy().to_string(),
        is_portable,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_version_number() {
        assert_eq!(extract_version_number("Mihomo Meta v1.19.30 windows amd64"), "1.19.30");
        assert_eq!(extract_version_number("v1.19.30"), "1.19.30");
        assert_eq!(extract_version_number("1.19.31"), "1.19.31");
    }

    #[test]
    fn test_is_newer_version() {
        assert!(is_newer_version("1.19.29", "1.19.30"));
        assert!(is_newer_version("v1.19.29", "v1.19.30"));
        assert!(!is_newer_version("1.19.30", "1.19.30"));
        assert!(!is_newer_version("1.19.31", "1.19.30"));
    }

    #[test]
    fn test_target_spec_resolved() {
        let spec = get_current_target_spec();
        assert!(spec.is_some());
    }
}
