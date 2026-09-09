use crate::constants::{APP_USER_AGENT, APP_VERSION, GITHUB_OWNER, GITHUB_REPO};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AppPackageType {
    Installer,
    Portable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateAsset {
    pub name: String,
    pub download_url: String,
    pub size: u64,
    pub package_type: AppPackageType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateCheckResult {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub release_name: Option<String>,
    pub release_notes: Option<String>,
    pub release_url: Option<String>,
    pub published_at: Option<String>,
    pub asset: Option<AppUpdateAsset>,
    pub available_assets: Vec<AppUpdateAsset>,
    pub is_installed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateProgressPayload {
    pub percentage: u32,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub stage: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateInstallResult {
    pub package_type: String,
    pub file_path: String,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GitHubReleaseAsset {
    pub name: String,
    pub browser_download_url: String,
    pub size: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GitHubReleaseResponse {
    pub tag_name: String,
    pub name: Option<String>,
    pub html_url: Option<String>,
    pub body: Option<String>,
    pub published_at: Option<String>,
    #[serde(default)]
    pub assets: Vec<GitHubReleaseAsset>,
}

/// Parses a SemVer tag (e.g. "v1.0.1" or "1.0.0") into (major, minor, patch)
pub fn parse_version(v: &str) -> Option<(u64, u64, u64)> {
    let cleaned = v.trim().trim_start_matches(['v', 'V']);
    let parts: Vec<&str> = cleaned.split('.').collect();
    if parts.len() < 2 {
        return None;
    }
    let major = parts.first()?.parse().ok()?;
    let minor = parts.get(1)?.parse().ok()?;
    let patch = parts.get(2).unwrap_or(&"0").parse().ok()?;
    Some((major, minor, patch))
}

/// Checks whether remote version is strictly newer than current version
pub fn is_newer_version(current: &str, remote: &str) -> bool {
    match (parse_version(current), parse_version(remote)) {
        (Some(c), Some(r)) => r > c,
        _ => remote.trim_start_matches(['v', 'V']) != current.trim_start_matches(['v', 'V']),
    }
}

/// Detects if current binary is installed via installer or running portable
pub fn detect_is_installed() -> bool {
    let Ok(current_exe) = std::env::current_exe() else {
        return false;
    };
    let Some(parent) = current_exe.parent() else {
        return false;
    };

    if parent.join("unins000.exe").exists()
        || parent.join("uninstall.exe").exists()
        || parent.join("Uninstall Mihomo Multi.exe").exists()
    {
        return true;
    }

    let path_str = current_exe.to_string_lossy().to_lowercase();
    if path_str.contains("program files") || path_str.contains(r"appdata\local\programs") {
        return true;
    }

    false
}

/// Gets the root directory of the software
pub fn get_app_root_dir() -> PathBuf {
    if let Ok(exe_path) = std::env::current_exe()
        && let Some(parent) = exe_path.parent()
    {
        return parent.to_path_buf();
    }
    std::env::temp_dir()
}

/// Matches assets from release according to current operating system and architecture
pub fn match_platform_assets(
    assets: &[GitHubReleaseAsset],
    is_installed: bool,
) -> (Option<AppUpdateAsset>, Vec<AppUpdateAsset>) {
    let mut matched = Vec::new();

    for asset in assets {
        let name_lower = asset.name.to_lowercase();

        #[cfg(target_os = "windows")]
        {
            let is_win = name_lower.contains("windows")
                || name_lower.contains("win")
                || name_lower.ends_with(".exe")
                || name_lower.ends_with(".msi");
            if is_win {
                #[cfg(target_arch = "x86_64")]
                let arch_match = name_lower.contains("x64")
                    || name_lower.contains("x86_64")
                    || name_lower.contains("amd64")
                    || (!name_lower.contains("arm64") && !name_lower.contains("386") && !name_lower.contains("ia32"));
                #[cfg(target_arch = "aarch64")]
                let arch_match = name_lower.contains("arm64") || name_lower.contains("aarch64");
                #[cfg(target_arch = "x86")]
                let arch_match =
                    name_lower.contains("386") || name_lower.contains("x86") || name_lower.contains("ia32");

                if arch_match {
                    let package_type = if name_lower.ends_with(".msi")
                        || name_lower.contains("setup")
                        || name_lower.contains("installer")
                        || (name_lower.ends_with(".exe") && !name_lower.contains("portable"))
                    {
                        AppPackageType::Installer
                    } else {
                        AppPackageType::Portable
                    };

                    matched.push(AppUpdateAsset {
                        name: asset.name.clone(),
                        download_url: asset.browser_download_url.clone(),
                        size: asset.size,
                        package_type,
                    });
                }
            }
        }

        #[cfg(target_os = "macos")]
        {
            let is_mac = name_lower.contains("darwin") || name_lower.contains("mac") || name_lower.ends_with(".dmg");
            if is_mac {
                #[cfg(target_arch = "aarch64")]
                let arch_match =
                    name_lower.contains("arm64") || name_lower.contains("aarch64") || name_lower.contains("universal");
                #[cfg(target_arch = "x86_64")]
                let arch_match = name_lower.contains("x64")
                    || name_lower.contains("x86_64")
                    || name_lower.contains("intel")
                    || name_lower.contains("universal");

                if arch_match {
                    let package_type = if name_lower.ends_with(".dmg") {
                        AppPackageType::Installer
                    } else {
                        AppPackageType::Portable
                    };

                    matched.push(AppUpdateAsset {
                        name: asset.name.clone(),
                        download_url: asset.browser_download_url.clone(),
                        size: asset.size,
                        package_type,
                    });
                }
            }
        }

        #[cfg(target_os = "linux")]
        {
            let is_linux =
                name_lower.contains("linux") || name_lower.ends_with(".appimage") || name_lower.ends_with(".deb");
            if is_linux {
                #[cfg(target_arch = "x86_64")]
                let arch_match =
                    name_lower.contains("x64") || name_lower.contains("x86_64") || name_lower.contains("amd64");
                #[cfg(target_arch = "aarch64")]
                let arch_match = name_lower.contains("arm64") || name_lower.contains("aarch64");

                if arch_match {
                    let package_type = if name_lower.ends_with(".deb") || name_lower.ends_with(".appimage") {
                        AppPackageType::Installer
                    } else {
                        AppPackageType::Portable
                    };

                    matched.push(AppUpdateAsset {
                        name: asset.name.clone(),
                        download_url: asset.browser_download_url.clone(),
                        size: asset.size,
                        package_type,
                    });
                }
            }
        }
    }

    // Determine recommended asset based on is_installed
    let recommended = if is_installed {
        matched
            .iter()
            .find(|a| a.package_type == AppPackageType::Installer)
            .cloned()
            .or_else(|| matched.first().cloned())
    } else {
        matched
            .iter()
            .find(|a| a.package_type == AppPackageType::Portable)
            .cloned()
            .or_else(|| matched.first().cloned())
    };

    (recommended, matched)
}

/// Checks latest release from GitHub API
pub async fn check_app_update() -> AppResult<AppUpdateCheckResult> {
    let client = reqwest::Client::builder()
        .user_agent(APP_USER_AGENT)
        .timeout(Duration::from_secs(20))
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| AppError::Internal(format!("Failed to build HTTP client: {}", e)))?;

    let api_url = format!(
        "https://api.github.com/repos/{}/{}/releases/latest",
        GITHUB_OWNER, GITHUB_REPO
    );

    info!(url = %api_url, "Checking for latest app release from GitHub");

    let res = client
        .get(&api_url)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to query GitHub releases: {}", e)))?;

    if !res.status().is_success() {
        return Err(AppError::Internal(format!(
            "GitHub API responded with status {}: {}",
            res.status(),
            res.text().await.unwrap_or_default()
        )));
    }

    let release: GitHubReleaseResponse = res
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to parse GitHub release JSON: {}", e)))?;

    let has_update = is_newer_version(APP_VERSION, &release.tag_name);
    let is_installed = detect_is_installed();
    let (recommended_asset, available_assets) = match_platform_assets(&release.assets, is_installed);

    Ok(AppUpdateCheckResult {
        current_version: APP_VERSION.to_string(),
        latest_version: release.tag_name.trim_start_matches(['v', 'V']).to_string(),
        has_update,
        release_name: release.name,
        release_notes: release.body,
        release_url: release.html_url,
        published_at: release.published_at,
        asset: recommended_asset,
        available_assets,
        is_installed,
    })
}

/// Downloads and installs an update asset (either installer or portable)
pub async fn download_and_install_update(
    app: &AppHandle,
    download_url: &str,
    file_name: &str,
    package_type_str: &str,
    state: &AppState,
) -> AppResult<AppUpdateInstallResult> {
    let package_type = if package_type_str.eq_ignore_ascii_case("installer") {
        AppPackageType::Installer
    } else {
        AppPackageType::Portable
    };

    let client = reqwest::Client::builder()
        .user_agent(APP_USER_AGENT)
        .timeout(Duration::from_secs(600))
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::Internal(format!("Failed to build HTTP client: {}", e)))?;

    let mut res = client
        .get(download_url)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to start download from {}: {}", download_url, e)))?;

    if !res.status().is_success() {
        return Err(AppError::Internal(format!(
            "Download failed with HTTP status: {}",
            res.status()
        )));
    }

    let total_bytes = res.content_length().unwrap_or(0);
    let mut downloaded_bytes = 0u64;

    let target_dir = match package_type {
        AppPackageType::Installer => std::env::temp_dir(),
        AppPackageType::Portable => get_app_root_dir(),
    };

    let dest_path = target_dir.join(file_name);
    let temp_dest_path = target_dir.join(format!("{}.downloading", file_name));

    let mut file = std::fs::File::create(&temp_dest_path).map_err(AppError::Io)?;

    let _ = app.emit(
        "app-update-progress",
        AppUpdateProgressPayload {
            percentage: 0,
            downloaded_bytes: 0,
            total_bytes,
            stage: "downloading".to_string(),
        },
    );

    while let Some(chunk) = res
        .chunk()
        .await
        .map_err(|e| AppError::Internal(format!("Download stream error: {}", e)))?
    {
        file.write_all(&chunk).map_err(AppError::Io)?;
        downloaded_bytes += chunk.len() as u64;

        let percentage = if total_bytes > 0 {
            ((downloaded_bytes as f64 / total_bytes as f64) * 100.0).clamp(0.0, 100.0) as u32
        } else {
            0
        };

        let _ = app.emit(
            "app-update-progress",
            AppUpdateProgressPayload {
                percentage,
                downloaded_bytes,
                total_bytes,
                stage: "downloading".to_string(),
            },
        );
    }

    file.flush().map_err(AppError::Io)?;
    drop(file);

    if dest_path.exists() {
        let _ = std::fs::remove_file(&dest_path);
    }
    std::fs::rename(&temp_dest_path, &dest_path).map_err(AppError::Io)?;

    let _ = app.emit(
        "app-update-progress",
        AppUpdateProgressPayload {
            percentage: 100,
            downloaded_bytes,
            total_bytes,
            stage: "ready".to_string(),
        },
    );

    match package_type {
        AppPackageType::Installer => {
            info!(path = %dest_path.display(), "Executing installer and closing current application");
            let _ = crate::core::sysproxy::clear_system_proxy();
            let _ = state.engine.stop();

            #[cfg(target_os = "windows")]
            {
                let mut cmd = std::process::Command::new(&dest_path);
                cmd.spawn()
                    .map_err(|e| AppError::Internal(format!("Failed to launch installer: {}", e)))?;
            }

            #[cfg(target_os = "macos")]
            {
                std::process::Command::new("open")
                    .arg(&dest_path)
                    .spawn()
                    .map_err(|e| AppError::Internal(format!("Failed to open package: {}", e)))?;
            }

            #[cfg(target_os = "linux")]
            {
                std::process::Command::new("xdg-open")
                    .arg(&dest_path)
                    .spawn()
                    .map_err(|e| AppError::Internal(format!("Failed to open package: {}", e)))?;
            }

            let app_handle = app.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(500)).await;
                app_handle.exit(0);
            });

            Ok(AppUpdateInstallResult {
                package_type: "installer".to_string(),
                file_path: dest_path.to_string_lossy().to_string(),
                message: "安装程序已启动，正在关闭旧进程...".to_string(),
            })
        }
        AppPackageType::Portable => {
            info!(path = %dest_path.display(), "Portable update package saved, opening folder");
            open_file_in_folder(&dest_path)?;

            Ok(AppUpdateInstallResult {
                package_type: "portable".to_string(),
                file_path: dest_path.to_string_lossy().to_string(),
                message: format!(
                    "便携包已成功下载至软件目录「{}」，已在文件管理器中定位，请关闭程序后解压替换。",
                    dest_path.display()
                ),
            })
        }
    }
}

pub fn open_file_in_folder(path: &Path) -> AppResult<()> {
    if !path.exists() {
        return Err(AppError::Internal(format!("File does not exist: {}", path.display())));
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", path.display()))
            .spawn()
            .map_err(|e| AppError::Internal(format!("Failed to open explorer: {}", e)))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn()
            .map_err(|e| AppError::Internal(format!("Failed to open finder: {}", e)))?;
    }
    #[cfg(target_os = "linux")]
    {
        let parent = path.parent().unwrap_or(path);
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| AppError::Internal(format!("Failed to open directory: {}", e)))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version_comparison() {
        assert!(is_newer_version("1.0.0", "1.0.1"));
        assert!(is_newer_version("1.0.0", "v1.0.1"));
        assert!(is_newer_version("1.0.0", "v1.1.0"));
        assert!(is_newer_version("1.0.0", "2.0.0"));
        assert!(!is_newer_version("1.0.0", "1.0.0"));
        assert!(!is_newer_version("1.0.0", "v1.0.0"));
        assert!(!is_newer_version("1.2.0", "1.1.9"));
        assert!(!is_newer_version("2.0.0", "1.9.9"));
    }

    #[test]
    fn test_parse_version() {
        assert_eq!(parse_version("1.0.0"), Some((1, 0, 0)));
        assert_eq!(parse_version("v1.2.3"), Some((1, 2, 3)));
        assert_eq!(parse_version("V2.0"), Some((2, 0, 0)));
        assert_eq!(parse_version("invalid"), None);
    }

    #[test]
    fn test_match_platform_assets() {
        let assets = vec![
            GitHubReleaseAsset {
                name: "mihomo-multi_1.0.0_x64-setup.exe".to_string(),
                browser_download_url: "https://example.com/mihomo-multi_1.0.0_x64-setup.exe".to_string(),
                size: 20000000,
            },
            GitHubReleaseAsset {
                name: "mihomo-multi_1.0.0_windows-x64-portable.zip".to_string(),
                browser_download_url: "https://example.com/mihomo-multi_1.0.0_windows-x64-portable.zip".to_string(),
                size: 15000000,
            },
            GitHubReleaseAsset {
                name: "mihomo-multi_1.0.0_x64_en-US.msi".to_string(),
                browser_download_url: "https://example.com/mihomo-multi_1.0.0_x64_en-US.msi".to_string(),
                size: 22000000,
            },
            GitHubReleaseAsset {
                name: "mihomo-multi_1.0.0_aarch64.dmg".to_string(),
                browser_download_url: "https://example.com/mihomo-multi_1.0.0_aarch64.dmg".to_string(),
                size: 18000000,
            },
            GitHubReleaseAsset {
                name: "mihomo-multi_1.0.0_universal.dmg".to_string(),
                browser_download_url: "https://example.com/mihomo-multi_1.0.0_universal.dmg".to_string(),
                size: 35000000,
            },
            GitHubReleaseAsset {
                name: "mihomo-multi_1.0.0_amd64.deb".to_string(),
                browser_download_url: "https://example.com/mihomo-multi_1.0.0_amd64.deb".to_string(),
                size: 19000000,
            },
            GitHubReleaseAsset {
                name: "mihomo-multi_1.0.0_amd64.AppImage".to_string(),
                browser_download_url: "https://example.com/mihomo-multi_1.0.0_amd64.AppImage".to_string(),
                size: 21000000,
            },
            GitHubReleaseAsset {
                name: "mihomo-multi_1.0.0_linux-x64.tar.gz".to_string(),
                browser_download_url: "https://example.com/mihomo-multi_1.0.0_linux-x64.tar.gz".to_string(),
                size: 16000000,
            },
        ];

        let (recommended_installer, all) = match_platform_assets(&assets, true);
        assert!(!all.is_empty());
        #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
        {
            assert_eq!(all.len(), 3);
            assert_eq!(
                recommended_installer.as_ref().map(|a| &a.package_type),
                Some(&AppPackageType::Installer)
            );

            let (recommended_portable, _) = match_platform_assets(&assets, false);
            assert_eq!(
                recommended_portable.as_ref().map(|a| &a.package_type),
                Some(&AppPackageType::Portable)
            );
        }

        #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
        {
            assert_eq!(all.len(), 3);
            assert_eq!(
                recommended_installer.as_ref().map(|a| &a.package_type),
                Some(&AppPackageType::Installer)
            );

            let (recommended_portable, _) = match_platform_assets(&assets, false);
            assert_eq!(
                recommended_portable.as_ref().map(|a| &a.package_type),
                Some(&AppPackageType::Portable)
            );
        }

        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            assert_eq!(all.len(), 2);
            assert_eq!(
                recommended_installer.as_ref().map(|a| &a.package_type),
                Some(&AppPackageType::Installer)
            );
        }
    }
}
