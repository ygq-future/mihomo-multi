use std::path::Path;
use tracing::{info, warn};

const APP_REG_KEY: &str = "MihomoMulti";

#[cfg(windows)]
pub fn enable_autostart(app_path: &Path, silent: bool) -> Result<(), String> {
    let path_str = app_path.to_string_lossy();
    let cmd_value = if silent {
        format!("\"{}\" --silent", path_str)
    } else {
        format!("\"{}\"", path_str)
    };

    let status = std::process::Command::new("reg")
        .args([
            "add",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
            "/v",
            APP_REG_KEY,
            "/t",
            "REG_SZ",
            "/d",
            &cmd_value,
            "/f",
        ])
        .output();

    match status {
        Ok(out) if out.status.success() => {
            info!("Auto-start registered in registry: {}", cmd_value);
            Ok(())
        }
        Ok(out) => {
            let err = String::from_utf8_lossy(&out.stderr).to_string();
            warn!("Failed to add registry auto-start key: {}", err);
            Err(err)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(not(windows))]
pub fn enable_autostart(_app_path: &Path, _silent: bool) -> Result<(), String> {
    // Unix fallback or no-op
    Ok(())
}

#[cfg(windows)]
pub fn disable_autostart() -> Result<(), String> {
    let status = std::process::Command::new("reg")
        .args([
            "delete",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
            "/v",
            APP_REG_KEY,
            "/f",
        ])
        .output();

    match status {
        Ok(out) if out.status.success() => {
            info!("Auto-start removed from registry");
            Ok(())
        }
        Ok(_) => Ok(()), // If key doesn't exist, ignore
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(not(windows))]
pub fn disable_autostart() -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
pub fn is_autostart_enabled() -> bool {
    let status = std::process::Command::new("reg")
        .args([
            "query",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
            "/v",
            APP_REG_KEY,
        ])
        .output();

    matches!(status, Ok(out) if out.status.success())
}

#[cfg(not(windows))]
pub fn is_autostart_enabled() -> bool {
    false
}
