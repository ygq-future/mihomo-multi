use std::path::Path;
#[cfg(windows)]
use tracing::{info, warn};

#[cfg(windows)]
const APP_REG_KEY: &str = "MihomoMulti";
#[cfg(windows)]
const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
#[cfg(windows)]
const STARTUP_APPROVED_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
#[cfg(windows)]
const AUTOSTART_TASK_NAME: &str = "MihomoMulti";

#[cfg(windows)]
fn windows_schtasks_command() -> std::process::Command {
    use std::os::windows::process::CommandExt;
    let mut cmd = std::process::Command::new("schtasks");
    cmd.creation_flags(0x08000000);
    cmd
}

#[cfg(windows)]
pub fn is_elevated_autostart_enabled() -> bool {
    matches!(windows_schtasks_command().args(["Query", "/TN", AUTOSTART_TASK_NAME]).output(),
        Ok(out) if out.status.success())
}

#[cfg(not(windows))]
pub fn is_elevated_autostart_enabled() -> bool {
    false
}

#[cfg(windows)]
pub fn delete_elevated_autostart() -> Result<(), String> {
    let out = windows_schtasks_command()
        .args(["Delete", "/F", "/TN", AUTOSTART_TASK_NAME])
        .output();
    match out {
        Ok(_) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(not(windows))]
pub fn delete_elevated_autostart() -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
pub fn enable_elevated_autostart(app_path: &Path, silent: bool) -> Result<(), String> {
    let path_str = app_path.to_string_lossy();
    let cmd_value = if silent {
        format!("\"{}\" --silent", path_str)
    } else {
        format!("\"{}\"", path_str)
    };
    let out = windows_schtasks_command()
        .args([
            "Create", "/F", "/TN", AUTOSTART_TASK_NAME, "/TR", &cmd_value, "/SC", "ONLOGON", "/RL", "HIGHEST",
        ])
        .output();
    match out {
        Ok(o) if o.status.success() => Ok(()),
        Ok(o) => Err(String::from_utf8_lossy(&o.stderr).trim().to_string()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(not(windows))]
pub fn enable_elevated_autostart(_app_path: &Path, _silent: bool) -> Result<(), String> {
    Err("当前平台不支持管理员计划任务".to_string())
}

pub fn sync_autostart_state(config: &crate::models::AppConfig, app_path: &Path) -> Result<(), String> {
    if !config.auto_launch {
        disable_autostart()?;
        return delete_elevated_autostart();
    }
    if config.tun_enabled {
        disable_autostart()?;
        enable_elevated_autostart(app_path, config.silent_start)
    } else {
        delete_elevated_autostart()?;
        enable_autostart(app_path, config.silent_start)
    }
}

#[cfg(windows)]
fn windows_reg_command() -> std::process::Command {
    use std::os::windows::process::CommandExt;
    let mut cmd = std::process::Command::new("reg");
    cmd.creation_flags(0x08000000);
    cmd
}

#[cfg(windows)]
pub fn enable_autostart(app_path: &Path, silent: bool) -> Result<(), String> {
    let path_str = app_path.to_string_lossy();
    let cmd_value = if silent {
        format!("\"{}\" --silent", path_str)
    } else {
        format!("\"{}\"", path_str)
    };

    let status = windows_reg_command()
        .args([
            "add",
            RUN_KEY,
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
            // Clear any user/system disabled approval override to ensure autostart takes effect
            let _ = windows_reg_command()
                .args(["delete", STARTUP_APPROVED_KEY, "/v", APP_REG_KEY, "/f"])
                .output();
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
    let status = windows_reg_command()
        .args(["delete", RUN_KEY, "/v", APP_REG_KEY, "/f"])
        .output();

    // Also clean up StartupApproved key to avoid stale state
    let _ = windows_reg_command()
        .args(["delete", STARTUP_APPROVED_KEY, "/v", APP_REG_KEY, "/f"])
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
    let run_status = windows_reg_command()
        .args(["query", RUN_KEY, "/v", APP_REG_KEY])
        .output();

    let run_exists = matches!(run_status, Ok(out) if out.status.success());
    if !run_exists {
        return false;
    }

    // Check if StartupApproved has marked it disabled
    let approved_status = windows_reg_command()
        .args(["query", STARTUP_APPROVED_KEY, "/v", APP_REG_KEY])
        .output();

    if let Ok(out) = approved_status
        && out.status.success()
    {
        let stdout = String::from_utf8_lossy(&out.stdout);
        if is_startup_approved_disabled(&stdout) {
            return false;
        }
    }

    true
}

#[cfg(windows)]
fn is_startup_approved_disabled(reg_query_stdout: &str) -> bool {
    for line in reg_query_stdout.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with(APP_REG_KEY) {
            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            if parts.len() >= 3 && parts[1].eq_ignore_ascii_case("REG_BINARY") {
                let hex_str = parts[2];
                if hex_str.len() >= 2
                    && let Ok(first_byte) = u8::from_str_radix(&hex_str[..2], 16)
                {
                    // In Windows StartupApproved, odd first byte (0x01, 0x03) means disabled
                    return first_byte & 1 != 0;
                }
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(windows)]
    fn test_startup_approved_disabled_parsing() {
        let output_disabled_01 = r"
HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run
    MihomoMulti    REG_BINARY    010000000238517BA855DD01
";
        assert!(is_startup_approved_disabled(output_disabled_01));

        let output_disabled_03 = r"
HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run
    MihomoMulti    REG_BINARY    030000000000000000000000
";
        assert!(is_startup_approved_disabled(output_disabled_03));

        let output_enabled_02 = r"
HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run
    MihomoMulti    REG_BINARY    020000000000000000000000
";
        assert!(!is_startup_approved_disabled(output_enabled_02));

        let output_empty = "";
        assert!(!is_startup_approved_disabled(output_empty));
    }
}

#[cfg(not(windows))]
pub fn is_autostart_enabled() -> bool {
    false
}
