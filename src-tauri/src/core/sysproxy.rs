use crate::error::{AppError, AppResult};
use tracing::info;

pub const DEFAULT_BYPASS_ITEMS: &[&str] = &[
    "localhost",
    "127.*",
    "10.*",
    "172.16.*",
    "172.17.*",
    "172.18.*",
    "172.19.*",
    "172.20.*",
    "172.21.*",
    "172.22.*",
    "172.23.*",
    "172.24.*",
    "172.25.*",
    "172.26.*",
    "172.27.*",
    "172.28.*",
    "172.29.*",
    "172.30.*",
    "172.31.*",
    "192.168.*",
    "<local>",
];

pub fn get_default_bypass_list() -> Vec<String> {
    DEFAULT_BYPASS_ITEMS.iter().map(|&s| s.to_string()).collect()
}

pub fn build_combined_bypass_list(user_bypass: &[String]) -> Vec<String> {
    let mut list = get_default_bypass_list();
    for item in user_bypass {
        let trimmed = item.trim();
        if !trimmed.is_empty() && !list.iter().any(|existing| existing.eq_ignore_ascii_case(trimmed)) {
            list.push(trimmed.to_string());
        }
    }
    list
}

/// Applies system proxy to the OS and environment variables
pub fn apply_system_proxy(port: u16, user_bypass: &[String], sync_env: bool) -> AppResult<()> {
    info!(port = port, sync_env = sync_env, "Applying system proxy");
    let combined_bypass = build_combined_bypass_list(user_bypass);

    #[cfg(windows)]
    {
        windows::set_system_proxy_windows(port, &combined_bypass)?;
        if sync_env {
            windows::set_user_env_proxy_windows(port, &combined_bypass)?;
        } else {
            windows::clear_user_env_proxy_windows()?;
        }
    }
    #[cfg(target_os = "macos")]
    {
        macos::set_system_proxy_macos(port, &combined_bypass)?;
    }

    #[cfg(target_os = "linux")]
    {
        linux::set_system_proxy_linux(port, &combined_bypass)?;
    }

    Ok(())
}

/// Clears system proxy from the OS and removes environment variables
pub fn clear_system_proxy() -> AppResult<()> {
    info!("Clearing system proxy");

    #[cfg(windows)]
    {
        windows::clear_system_proxy_windows()?;
        windows::clear_user_env_proxy_windows()?;
    }

    #[cfg(target_os = "macos")]
    {
        macos::clear_system_proxy_macos()?;
    }

    #[cfg(target_os = "linux")]
    {
        linux::clear_system_proxy_linux()?;
    }

    Ok(())
}

/// Queries current UWP Loopback exemption statistics
pub fn get_uwp_loopback_stats() -> AppResult<crate::models::UwpLoopbackStats> {
    #[cfg(windows)]
    {
        let total_count = windows::get_user_appcontainer_sids().len();
        let exempted_count = windows::get_exempted_count();
        Ok(crate::models::UwpLoopbackStats {
            supported: true,
            exempted_count,
            total_count,
        })
    }

    #[cfg(not(windows))]
    {
        Ok(crate::models::UwpLoopbackStats {
            supported: false,
            exempted_count: 0,
            total_count: 0,
        })
    }
}

/// Exempts all user UWP AppContainers from Loopback restriction
pub fn exempt_all_uwp_loopback() -> AppResult<crate::models::UwpLoopbackStats> {
    #[cfg(windows)]
    {
        windows::exempt_all_uwp_windows()?;
        get_uwp_loopback_stats()
    }

    #[cfg(not(windows))]
    {
        Err(AppError::Internal("UWP Loopback 仅支持 Windows 操作系统".to_string()))
    }
}

/// Clears all UWP AppContainer Loopback exemptions
pub fn clear_all_uwp_loopback() -> AppResult<crate::models::UwpLoopbackStats> {
    #[cfg(windows)]
    {
        windows::clear_all_uwp_windows()?;
        get_uwp_loopback_stats()
    }

    #[cfg(not(windows))]
    {
        Err(AppError::Internal("UWP Loopback 仅支持 Windows 操作系统".to_string()))
    }
}

// ----------------------------------------------------------------------------
// Windows Implementation
// ----------------------------------------------------------------------------
#[cfg(windows)]
mod windows {
    use super::*;
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::Networking::WinInet::{
        InternetSetOptionW, INTERNET_OPTION_REFRESH, INTERNET_OPTION_SETTINGS_CHANGED,
    };
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegDeleteValueW, RegEnumKeyExW, RegOpenKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ,
        KEY_SET_VALUE, REG_DWORD, REG_SZ,
    };
    use std::process::Command;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
    };

    const INTERNET_SETTINGS_SUBKEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
    const ENVIRONMENT_SUBKEY: &str = "Environment";

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    struct RegKeyGuard(HKEY);
    impl Drop for RegKeyGuard {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    RegCloseKey(self.0);
                }
            }
        }
    }

    fn open_reg_key(root: HKEY, subkey: &str, access: u32) -> AppResult<RegKeyGuard> {
        let subkey_w = to_wide(subkey);
        let mut hkey: HKEY = null_mut();
        let ret = unsafe { RegOpenKeyExW(root, subkey_w.as_ptr(), 0, access, &mut hkey) };
        if ret == ERROR_SUCCESS {
            Ok(RegKeyGuard(hkey))
        } else {
            Err(AppError::Internal(format!(
                "Failed to open registry key '{}', error code: {}",
                subkey, ret
            )))
        }
    }

    fn set_reg_dword(hkey: HKEY, name: &str, value: u32) -> AppResult<()> {
        let name_w = to_wide(name);
        let val_bytes = value.to_ne_bytes();
        let ret = unsafe {
            RegSetValueExW(
                hkey,
                name_w.as_ptr(),
                0,
                REG_DWORD,
                val_bytes.as_ptr(),
                val_bytes.len() as u32,
            )
        };
        if ret == ERROR_SUCCESS {
            Ok(())
        } else {
            Err(AppError::Internal(format!(
                "Failed to set DWORD registry value '{}', error code: {}",
                name, ret
            )))
        }
    }

    fn set_reg_sz(hkey: HKEY, name: &str, value: &str) -> AppResult<()> {
        let name_w = to_wide(name);
        let val_w = to_wide(value);
        let ret = unsafe {
            RegSetValueExW(
                hkey,
                name_w.as_ptr(),
                0,
                REG_SZ,
                val_w.as_ptr() as *const u8,
                (val_w.len() * 2) as u32,
            )
        };
        if ret == ERROR_SUCCESS {
            Ok(())
        } else {
            Err(AppError::Internal(format!(
                "Failed to set SZ registry value '{}', error code: {}",
                name, ret
            )))
        }
    }

    fn delete_reg_value(hkey: HKEY, name: &str) {
        let name_w = to_wide(name);
        unsafe {
            RegDeleteValueW(hkey, name_w.as_ptr());
        }
    }

    fn notify_wininet_refresh() {
        unsafe {
            InternetSetOptionW(null_mut(), INTERNET_OPTION_SETTINGS_CHANGED, null_mut(), 0);
            InternetSetOptionW(null_mut(), INTERNET_OPTION_REFRESH, null_mut(), 0);
        }
    }

    fn broadcast_environment_change() {
        let env_w = to_wide("Environment");
        let mut result: usize = 0;
        unsafe {
            SendMessageTimeoutW(
                HWND_BROADCAST as _,
                WM_SETTINGCHANGE,
                0,
                env_w.as_ptr() as isize,
                SMTO_ABORTIFHUNG,
                5000,
                &mut result,
            );
        }
    }

    pub fn set_system_proxy_windows(port: u16, bypass_list: &[String]) -> AppResult<()> {
        let key = open_reg_key(
            HKEY_CURRENT_USER,
            INTERNET_SETTINGS_SUBKEY,
            KEY_READ | KEY_SET_VALUE,
        )?;

        let server_str = format!("127.0.0.1:{}", port);
        let override_str = bypass_list.join(";");

        set_reg_dword(key.0, "ProxyEnable", 1)?;
        set_reg_sz(key.0, "ProxyServer", &server_str)?;
        set_reg_sz(key.0, "ProxyOverride", &override_str)?;

        notify_wininet_refresh();
        info!(port = port, "Windows Internet Settings updated");
        Ok(())
    }

    pub fn clear_system_proxy_windows() -> AppResult<()> {
        if let Ok(key) = open_reg_key(
            HKEY_CURRENT_USER,
            INTERNET_SETTINGS_SUBKEY,
            KEY_READ | KEY_SET_VALUE,
        ) {
            let _ = set_reg_dword(key.0, "ProxyEnable", 0);
            notify_wininet_refresh();
            info!("Windows Internet Settings proxy disabled");
        }
        Ok(())
    }

    pub fn set_user_env_proxy_windows(port: u16, bypass_list: &[String]) -> AppResult<()> {
        let key = open_reg_key(HKEY_CURRENT_USER, ENVIRONMENT_SUBKEY, KEY_READ | KEY_SET_VALUE)?;

        let proxy_url = format!("http://127.0.0.1:{}", port);
        // Exclude <local> for no_proxy env var as <local> is specific to IE/WinInet
        let no_proxy_items: Vec<&str> = bypass_list
            .iter()
            .map(|s| s.as_str())
            .filter(|&s| !s.eq_ignore_ascii_case("<local>"))
            .collect();
        let no_proxy_str = no_proxy_items.join(",");

        set_reg_sz(key.0, "http_proxy", &proxy_url)?;
        set_reg_sz(key.0, "https_proxy", &proxy_url)?;
        set_reg_sz(key.0, "all_proxy", &proxy_url)?;
        set_reg_sz(key.0, "no_proxy", &no_proxy_str)?;

        broadcast_environment_change();
        info!("Windows user environment variables (all_proxy, http_proxy, https_proxy, no_proxy) updated");
        Ok(())
    }

    pub fn clear_user_env_proxy_windows() -> AppResult<()> {
        if let Ok(key) = open_reg_key(HKEY_CURRENT_USER, ENVIRONMENT_SUBKEY, KEY_READ | KEY_SET_VALUE) {
            delete_reg_value(key.0, "http_proxy");
            delete_reg_value(key.0, "https_proxy");
            delete_reg_value(key.0, "all_proxy");
            delete_reg_value(key.0, "no_proxy");

            broadcast_environment_change();
            info!("Windows user environment variables removed");
        }
        Ok(())
    }

    pub fn get_user_appcontainer_sids() -> Vec<String> {
        const MAPPINGS_SUBKEY: &str =
            "Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppContainer\\Mappings";
        let Ok(key) = open_reg_key(HKEY_CURRENT_USER, MAPPINGS_SUBKEY, KEY_READ) else {
            return Vec::new();
        };

        let mut sids = Vec::new();
        let mut index = 0u32;
        let mut name_buf = [0u16; 256];

        loop {
            let mut name_len = name_buf.len() as u32;
            let ret = unsafe {
                RegEnumKeyExW(
                    key.0,
                    index,
                    name_buf.as_mut_ptr(),
                    &mut name_len,
                    null_mut(),
                    null_mut(),
                    null_mut(),
                    null_mut(),
                )
            };

            if ret != ERROR_SUCCESS {
                break;
            }

            if let Ok(name) = String::from_utf16(&name_buf[..name_len as usize]) {
                let trimmed = name.trim();
                if trimmed.starts_with("S-1-15-") {
                    sids.push(trimmed.to_string());
                }
            }
            index += 1;
        }

        sids
    }

    pub fn get_exempted_count() -> usize {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let output = match Command::new("CheckNetIsolation.exe")
            .args(["LoopbackExempt", "-s"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            Ok(out) => out.stdout,
            Err(_) => return 0,
        };

        output
            .windows(4)
            .filter(|window| *window == b"SID:")
            .count()
    }

    pub fn exempt_all_uwp_windows() -> AppResult<()> {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let sids = get_user_appcontainer_sids();
        if sids.is_empty() {
            info!("未发现任何 UWP 应用容器注册表项");
            return Ok(());
        }

        let temp_path = std::env::temp_dir().join(format!("mihomo_exempt_uwp_{}.cmd", uuid::Uuid::new_v4()));
        let mut script = String::from("@echo off\r\n");
        for sid in &sids {
            script.push_str(&format!("CheckNetIsolation.exe LoopbackExempt -a -p={}\r\n", sid));
        }

        std::fs::write(&temp_path, &script).map_err(AppError::Io)?;

        struct TempFileGuard(std::path::PathBuf);
        impl Drop for TempFileGuard {
            fn drop(&mut self) {
                let _ = std::fs::remove_file(&self.0);
            }
        }
        let _guard = TempFileGuard(temp_path.clone());

        let temp_path_str = temp_path.to_string_lossy().replace('\'', "''");
        let ps_cmd = format!(
            "try {{ Start-Process cmd.exe -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '/c', '{}' }} catch {{ exit 1223 }}",
            temp_path_str
        );

        let output = Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps_cmd])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| AppError::Internal(format!("启动提权进程失败: {}", e)))?;

        if output.status.code() == Some(1223) {
            return Err(AppError::Internal("用户取消了管理员权限授权 (UAC)".to_string()));
        }

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::Internal(format!(
                "执行 UWP 回环豁免失败: {}",
                stderr.trim()
            )));
        }

        info!(count = sids.len(), "已完成所有 UWP 应用容器回环豁免");
        Ok(())
    }

    pub fn clear_all_uwp_windows() -> AppResult<()> {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let ps_cmd = "try { Start-Process CheckNetIsolation.exe -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList 'LoopbackExempt', '-c' } catch { exit 1223 }";

        let output = Command::new("powershell")
            .args(["-NoProfile", "-Command", ps_cmd])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| AppError::Internal(format!("启动提权进程失败: {}", e)))?;

        if output.status.code() == Some(1223) {
            return Err(AppError::Internal("用户取消了管理员权限授权 (UAC)".to_string()));
        }

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::Internal(format!(
                "清除 UWP 回环豁免失败: {}",
                stderr.trim()
            )));
        }

        info!("已清除所有 UWP 应用容器回环豁免");
        Ok(())
    }
}

// ----------------------------------------------------------------------------
// macOS Implementation (networksetup)
// ----------------------------------------------------------------------------
#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use std::process::Command;

    fn get_active_network_services() -> Vec<String> {
        let output = match Command::new("networksetup")
            .arg("-listnetworkserviceorder")
            .output()
        {
            Ok(out) => String::from_utf8_lossy(&out.stdout).to_string(),
            Err(e) => {
                warn!("Failed to list network services: {}", e);
                return vec!["Wi-Fi".to_string(), "Ethernet".to_string()];
            }
        };

        let mut services = Vec::new();
        for line in output.lines() {
            if let Some(idx) = line.find("(Hardware Port:") {
                // Example: "(1) Wi-Fi (Hardware Port: Wi-Fi, Device: en0)"
                let prefix = &line[..idx];
                if let Some(pos) = prefix.find(')') {
                    let name = prefix[pos + 1..].trim();
                    if !name.is_empty() && !name.starts_with('*') {
                        services.push(name.to_string());
                    }
                }
            }
        }

        if services.is_empty() {
            vec!["Wi-Fi".to_string(), "Ethernet".to_string()]
        } else {
            services
        }
    }

    pub fn set_system_proxy_macos(port: u16, bypass_list: &[String]) -> AppResult<()> {
        let services = get_active_network_services();
        let port_str = port.to_string();

        for service in services {
            debug!("Configuring macOS proxy for service: {}", service);
            let _ = Command::new("networksetup")
                .args(["-setwebproxy", &service, "127.0.0.1", &port_str])
                .status();
            let _ = Command::new("networksetup")
                .args(["-setsecurewebproxy", &service, "127.0.0.1", &port_str])
                .status();
            let _ = Command::new("networksetup")
                .args(["-setwebproxystate", &service, "on"])
                .status();
            let _ = Command::new("networksetup")
                .args(["-setsecurewebproxystate", &service, "on"])
                .status();

            // Set bypass domains
            let bypass_filtered: Vec<&str> = bypass_list
                .iter()
                .map(|s| s.as_str())
                .filter(|&s| !s.eq_ignore_ascii_case("<local>"))
                .collect();
            if !bypass_filtered.is_empty() {
                let mut cmd = Command::new("networksetup");
                cmd.args(["-setproxybypassdomains", &service]);
                for domain in bypass_filtered {
                    cmd.arg(domain);
                }
                let _ = cmd.status();
            }
        }
        info!(port = port, "macOS networksetup system proxy applied");
        Ok(())
    }

    pub fn clear_system_proxy_macos() -> AppResult<()> {
        let services = get_active_network_services();
        for service in services {
            debug!("Disabling macOS proxy for service: {}", service);
            let _ = Command::new("networksetup")
                .args(["-setwebproxystate", &service, "off"])
                .status();
            let _ = Command::new("networksetup")
                .args(["-setsecurewebproxystate", &service, "off"])
                .status();
        }
        info!("macOS networksetup system proxy disabled");
        Ok(())
    }
}

// ----------------------------------------------------------------------------
// Linux Implementation (GNOME gsettings)
// ----------------------------------------------------------------------------
#[cfg(target_os = "linux")]
mod linux {
    use super::*;
    use std::process::Command;

    pub fn set_system_proxy_linux(port: u16, bypass_list: &[String]) -> AppResult<()> {
        let port_str = port.to_string();

        let _ = Command::new("gsettings")
            .args(["set", "org.gnome.system.proxy", "mode", "'manual'"])
            .status();
        let _ = Command::new("gsettings")
            .args(["set", "org.gnome.system.proxy.http", "host", "'127.0.0.1'"])
            .status();
        let _ = Command::new("gsettings")
            .args(["set", "org.gnome.system.proxy.http", "port", &port_str])
            .status();
        let _ = Command::new("gsettings")
            .args(["set", "org.gnome.system.proxy.https", "host", "'127.0.0.1'"])
            .status();
        let _ = Command::new("gsettings")
            .args(["set", "org.gnome.system.proxy.https", "port", &port_str])
            .status();

        // format ignore-hosts array: "['localhost', '127.0.0.0/8', ...]"
        let ignore_list: Vec<String> = bypass_list
            .iter()
            .filter(|&s| !s.eq_ignore_ascii_case("<local>"))
            .map(|s| format!("'{}'", s))
            .collect();
        let ignore_str = format!("[{}]", ignore_list.join(", "));
        let _ = Command::new("gsettings")
            .args(["set", "org.gnome.system.proxy", "ignore-hosts", &ignore_str])
            .status();

        info!(port = port, "Linux gsettings proxy applied");
        Ok(())
    }

    pub fn clear_system_proxy_linux() -> AppResult<()> {
        let _ = Command::new("gsettings")
            .args(["set", "org.gnome.system.proxy", "mode", "'none'"])
            .status();
        info!("Linux gsettings proxy disabled");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_uwp_loopback_stats_query() {
        let stats = get_uwp_loopback_stats().expect("should query uwp stats without error");
        #[cfg(windows)]
        {
            assert!(stats.supported);
        }
        #[cfg(not(windows))]
        {
            assert!(!stats.supported);
            assert_eq!(stats.exempted_count, 0);
            assert_eq!(stats.total_count, 0);
        }
    }

    #[test]
    fn test_uwp_loopback_stats_serialization() {
        let stats = crate::models::UwpLoopbackStats {
            supported: true,
            exempted_count: 42,
            total_count: 100,
        };
        let json = serde_json::to_string(&stats).expect("should serialize");
        assert!(json.contains("\"supported\":true"));
        assert!(json.contains("\"exemptedCount\":42"));
        assert!(json.contains("\"totalCount\":100"));

        let deserialized: crate::models::UwpLoopbackStats =
            serde_json::from_str(&json).expect("should deserialize");
        assert_eq!(stats, deserialized);
    }
}
