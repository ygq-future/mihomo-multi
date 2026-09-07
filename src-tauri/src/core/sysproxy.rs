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
pub fn apply_system_proxy(port: u16, user_bypass: &[String]) -> AppResult<()> {
    info!(port = port, "Applying system proxy");
    let combined_bypass = build_combined_bypass_list(user_bypass);

    #[cfg(windows)]
    {
        windows::set_system_proxy_windows(port, &combined_bypass)?;
        windows::set_user_env_proxy_windows(port, &combined_bypass)?;
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
        RegCloseKey, RegDeleteValueW, RegOpenKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ,
        KEY_SET_VALUE, REG_DWORD, REG_SZ,
    };
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
