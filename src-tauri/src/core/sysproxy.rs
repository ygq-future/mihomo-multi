use crate::error::{AppError, AppResult};
use tracing::{info, warn};

pub const DEFAULT_BYPASS_ITEMS: &[&str] = &[
    "localhost",
    "10.*",
    "127.*",
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
    sort_bypass_items(&mut list);
    list
}
#[derive(Debug, PartialEq, Eq, PartialOrd, Ord)]
enum BypassCategory {
    Localhost,
    Domain(Vec<String>, u8),
    Ipv4(u8, u8, u8, u8, u8),
    Ipv6(Vec<u8>),
    LocalMarker,
    Other(String),
}

fn parse_ipv4_spec(s: &str) -> Option<(u8, u8, u8, u8, u8)> {
    if let Some(prefix_part) = s.strip_suffix(".*") {
        let parts: Vec<&str> = prefix_part.split('.').collect();
        if !parts.is_empty() && parts.len() <= 3 {
            let mut octets = [0u8; 4];
            let mut valid = true;
            for (i, p) in parts.iter().enumerate() {
                if let Ok(num) = p.parse::<u8>() {
                    octets[i] = num;
                } else {
                    valid = false;
                    break;
                }
            }
            if valid {
                let prefix_len = (parts.len() * 8) as u8;
                return Some((octets[0], octets[1], octets[2], octets[3], prefix_len));
            }
        }
    }

    let (ip_str, prefix_len) = if let Some((ip, pfx)) = s.split_once('/') {
        let pfx_num = pfx.parse::<u8>().ok()?;
        if pfx_num > 32 {
            return None;
        }
        (ip, pfx_num)
    } else {
        (s, 32u8)
    };

    if let Ok(ipv4) = ip_str.parse::<std::net::Ipv4Addr>() {
        let [a, b, c, d] = ipv4.octets();
        return Some((a, b, c, d, prefix_len));
    }

    None
}

fn parse_ipv6_spec(s: &str) -> Option<Vec<u8>> {
    let ip_str = s.split('/').next().unwrap_or(s);
    if let Ok(v6) = ip_str.parse::<std::net::Ipv6Addr>() {
        return Some(v6.octets().to_vec());
    }
    None
}

fn get_bypass_sort_key(raw: &str) -> BypassCategory {
    let s = raw.trim();
    if s.eq_ignore_ascii_case("localhost") {
        return BypassCategory::Localhost;
    }
    if s.eq_ignore_ascii_case("<local>") {
        return BypassCategory::LocalMarker;
    }

    if let Some((o0, o1, o2, o3, prefix)) = parse_ipv4_spec(s) {
        return BypassCategory::Ipv4(o0, o1, o2, o3, prefix);
    }

    if let Some(v6_bytes) = parse_ipv6_spec(s) {
        return BypassCategory::Ipv6(v6_bytes);
    }

    let is_wildcard = if s.starts_with("*.") || s.starts_with('*') {
        1
    } else {
        0
    };
    let clean_domain = s.trim_start_matches('*').trim_start_matches('.').to_lowercase();
    if !clean_domain.is_empty() {
        let mut labels: Vec<String> = clean_domain
            .split('.')
            .filter(|p| !p.is_empty())
            .map(|p| p.to_string())
            .collect();
        labels.reverse();
        return BypassCategory::Domain(labels, is_wildcard);
    }

    BypassCategory::Other(s.to_lowercase())
}

/// Sorts bypass list items stably:
/// 1. `localhost`
/// 2. Domains (clustered by parent domain via reverse hierarchy, exact before wildcard before subdomains)
/// 3. IPv4 addresses/CIDRs/wildcards (sorted by numeric octets)
/// 4. IPv6 addresses/CIDRs
/// 5. `<local>`
pub fn sort_bypass_items(items: &mut [String]) {
    items.sort_by(|a, b| {
        let key_a = get_bypass_sort_key(a);
        let key_b = get_bypass_sort_key(b);
        key_a.cmp(&key_b).then_with(|| a.cmp(b))
    });
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
        let user_sids = windows::get_user_appcontainer_sids();
        let total_count = user_sids.len();
        let exempted_sids = windows::get_exempted_sids();
        let exempted_count = user_sids.iter().filter(|sid| exempted_sids.contains(*sid)).count();
        Ok(crate::models::UwpLoopbackStats {
            supported: true,
            exempted_count,
            total_count,
            cleaned_count: 0,
        })
    }

    #[cfg(not(windows))]
    {
        Ok(crate::models::UwpLoopbackStats {
            supported: false,
            exempted_count: 0,
            total_count: 0,
            cleaned_count: 0,
        })
    }
}

/// Refreshes UWP Loopback exemption status and cleans up orphaned exemptions
pub fn refresh_and_cleanup_uwp_loopback() -> AppResult<crate::models::UwpLoopbackStats> {
    #[cfg(windows)]
    {
        let cleaned_count = windows::cleanup_orphaned_uwp_exemptions()?;
        let mut stats = get_uwp_loopback_stats()?;
        stats.cleaned_count = cleaned_count;
        Ok(stats)
    }

    #[cfg(not(windows))]
    {
        Ok(crate::models::UwpLoopbackStats {
            supported: false,
            exempted_count: 0,
            total_count: 0,
            cleaned_count: 0,
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

/// Queries all UWP AppContainers and their exemption status
pub fn get_uwp_app_list() -> AppResult<Vec<crate::models::UwpAppInfo>> {
    #[cfg(windows)]
    {
        Ok(windows::get_uwp_apps_windows())
    }

    #[cfg(not(windows))]
    {
        Ok(Vec::new())
    }
}

// ----------------------------------------------------------------------------
// Windows Implementation
// ----------------------------------------------------------------------------
#[cfg(windows)]
mod windows {
    use super::*;
    use std::process::Command;
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::Networking::WinInet::{
        INTERNET_OPTION_REFRESH, INTERNET_OPTION_SETTINGS_CHANGED, InternetSetOptionW,
    };
    use windows_sys::Win32::System::Registry::{
        HKEY, HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE, REG_DWORD, REG_EXPAND_SZ, REG_SZ, RegCloseKey,
        RegDeleteValueW, RegEnumKeyExW, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        HWND_BROADCAST, SMTO_ABORTIFHUNG, SendMessageTimeoutW, WM_SETTINGCHANGE,
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

    fn get_reg_sz(hkey: HKEY, name: &str) -> Option<String> {
        let name_w = to_wide(name);
        let mut data_len = 0u32;
        let mut val_type = 0u32;
        unsafe {
            let ret = RegQueryValueExW(
                hkey,
                name_w.as_ptr(),
                null_mut(),
                &mut val_type,
                null_mut(),
                &mut data_len,
            );
            if ret != ERROR_SUCCESS || (val_type != REG_SZ && val_type != REG_EXPAND_SZ) || data_len == 0 {
                return None;
            }

            let u16_len = (data_len / 2) as usize;
            let mut buf = vec![0u16; u16_len];
            let ret = RegQueryValueExW(
                hkey,
                name_w.as_ptr(),
                null_mut(),
                &mut val_type,
                buf.as_mut_ptr() as *mut u8,
                &mut data_len,
            );
            if ret != ERROR_SUCCESS {
                return None;
            }
            while buf.last() == Some(&0) {
                buf.pop();
            }
            String::from_utf16(&buf).ok()
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
        let key = open_reg_key(HKEY_CURRENT_USER, INTERNET_SETTINGS_SUBKEY, KEY_READ | KEY_SET_VALUE)?;

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
        if let Ok(key) = open_reg_key(HKEY_CURRENT_USER, INTERNET_SETTINGS_SUBKEY, KEY_READ | KEY_SET_VALUE) {
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

    pub fn get_exempted_sids() -> std::collections::HashSet<String> {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let output = match Command::new("CheckNetIsolation.exe")
            .args(["LoopbackExempt", "-s"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            Ok(out) => out.stdout,
            Err(_) => return std::collections::HashSet::new(),
        };

        let text = String::from_utf8_lossy(&output);
        let mut set = std::collections::HashSet::new();
        for line in text.lines() {
            let trimmed = line.trim();
            if let Some(pos) = trimmed.find("S-1-15-") {
                let sid_part = &trimmed[pos..];
                let sid = sid_part
                    .split(|c: char| c.is_whitespace() || c == ',' || c == ';')
                    .next()
                    .unwrap_or("")
                    .trim();
                if sid.starts_with("S-1-15-") {
                    set.insert(sid.to_string());
                }
            }
        }
        set
    }


    pub fn get_uwp_apps_windows() -> Vec<crate::models::UwpAppInfo> {
        const MAPPINGS_SUBKEY: &str =
            "Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppContainer\\Mappings";
        let Ok(key) = open_reg_key(HKEY_CURRENT_USER, MAPPINGS_SUBKEY, KEY_READ) else {
            return Vec::new();
        };

        let exempted_sids = get_exempted_sids();
        let mut apps = Vec::new();
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

            if let Ok(sub_name) = String::from_utf16(&name_buf[..name_len as usize]) {
                let sid = sub_name.trim();
                if sid.starts_with("S-1-15-") {
                    let mut display_name = String::new();
                    let mut moniker = String::new();

                    let sid_w = to_wide(sid);
                    let mut sub_hkey: HKEY = null_mut();
                    let open_ret = unsafe { RegOpenKeyExW(key.0, sid_w.as_ptr(), 0, KEY_READ, &mut sub_hkey) };
                    if open_ret == ERROR_SUCCESS {
                        let sub_guard = RegKeyGuard(sub_hkey);
                        if let Some(dn) = get_reg_sz(sub_guard.0, "DisplayName") {
                            display_name = dn.trim().to_string();
                        }
                        if let Some(m) = get_reg_sz(sub_guard.0, "Moniker") {
                            moniker = m.trim().to_string();
                        }
                    }

                    let name = if display_name.is_empty()
                        || display_name.starts_with("ms-resource:")
                        || display_name.starts_with("@{")
                    {
                        if !moniker.is_empty() {
                            moniker.clone()
                        } else {
                            sid.to_string()
                        }
                    } else {
                        display_name
                    };

                    let is_exempted = exempted_sids.contains(sid);

                    apps.push(crate::models::UwpAppInfo {
                        name,
                        moniker,
                        sid: sid.to_string(),
                        exempted: is_exempted,
                    });
                }
            }
            index += 1;
        }

        apps.sort_by(|a, b| {
            b.exempted
                .cmp(&a.exempted)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });

        apps
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
            return Err(AppError::Internal(format!("执行 UWP 回环豁免失败: {}", stderr.trim())));
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
            return Err(AppError::Internal(format!("清除 UWP 回环豁免失败: {}", stderr.trim())));
        }

        info!("已清除所有 UWP 应用容器回环豁免");
        Ok(())
    }

    pub fn cleanup_orphaned_uwp_exemptions() -> AppResult<usize> {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let user_sids_vec = get_user_appcontainer_sids();
        let user_sids: std::collections::HashSet<String> = user_sids_vec.into_iter().collect();
        let exempted_sids = get_exempted_sids();

        let orphaned_sids: Vec<String> = exempted_sids
            .into_iter()
            .filter(|sid| !user_sids.contains(sid))
            .collect();

        if orphaned_sids.is_empty() {
            return Ok(0);
        }

        info!(count = orphaned_sids.len(), "检测到已卸载 UWP 应用残留的环回豁免记录，准备清理");

        let temp_path = std::env::temp_dir().join(format!("mihomo_clean_uwp_{}.cmd", uuid::Uuid::new_v4()));
        let mut script = String::from("@echo off\r\n");
        for sid in &orphaned_sids {
            script.push_str(&format!("CheckNetIsolation.exe LoopbackExempt -d -p={}\r\n", sid));
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
            .map_err(|e| AppError::Internal(format!("启动提权清理进程失败: {}", e)))?;

        if output.status.code() == Some(1223) {
            warn!("用户取消了管理员权限授权 (UAC)，跳过孤立 UWP 豁免清理");
            return Ok(0);
        }

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::Internal(format!("执行 UWP 孤立豁免清理失败: {}", stderr.trim())));
        }

        info!(cleaned = orphaned_sids.len(), "已成功清理残留的孤立 UWP 环回豁免记录");
        Ok(orphaned_sids.len())
    }
}

// ----------------------------------------------------------------------------
// macOS Implementation (networksetup)
// ----------------------------------------------------------------------------
#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use std::process::Command;
    use tracing::{debug, warn};
    fn get_active_network_services() -> Vec<String> {
        let output = match Command::new("networksetup").arg("-listnetworkserviceorder").output() {
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
    fn test_uwp_loopback_stats_invariant() {
        let stats = get_uwp_loopback_stats().expect("should query uwp stats");
        #[cfg(windows)]
        {
            assert!(stats.exempted_count <= stats.total_count);
        }
        let refreshed = refresh_and_cleanup_uwp_loopback().expect("should refresh uwp stats");
        #[cfg(windows)]
        {
            assert!(refreshed.exempted_count <= refreshed.total_count);
        }
    }
    #[test]
    fn test_uwp_app_list_query() {
        let apps = get_uwp_app_list().expect("should query uwp app list without error");
        #[cfg(windows)]
        {
            // On Windows test environment, should return apps if available
            for app in &apps {
                assert!(app.sid.starts_with("S-1-15-"));
            }
        }
        #[cfg(not(windows))]
        {
            assert!(apps.is_empty());
        }
    }

    #[test]
    fn test_uwp_app_info_serialization() {
        let info = crate::models::UwpAppInfo {
            name: "Windows Terminal".to_string(),
            moniker: "microsoft.windowsterminal_8wekyb3d8bbwe".to_string(),
            sid: "S-1-15-2-12345".to_string(),
            exempted: true,
        };
        let json = serde_json::to_string(&info).expect("should serialize");
        assert!(json.contains("\"name\":\"Windows Terminal\""));
        assert!(json.contains("\"moniker\":\"microsoft.windowsterminal_8wekyb3d8bbwe\""));
        assert!(json.contains("\"sid\":\"S-1-15-2-12345\""));
        assert!(json.contains("\"exempted\":true"));

        let deserialized: crate::models::UwpAppInfo = serde_json::from_str(&json).expect("should deserialize");
        assert_eq!(info, deserialized);
    }

    #[test]
    fn test_uwp_loopback_stats_serialization() {
        let stats = crate::models::UwpLoopbackStats {
            supported: true,
            exempted_count: 42,
            total_count: 100,
            cleaned_count: 5,
        };
        let json = serde_json::to_string(&stats).expect("should serialize");
        assert!(json.contains("\"supported\":true"));
        assert!(json.contains("\"exemptedCount\":42"));
        assert!(json.contains("\"totalCount\":100"));
        assert!(json.contains("\"cleanedCount\":5"));

        let deserialized: crate::models::UwpLoopbackStats = serde_json::from_str(&json).expect("should deserialize");
        assert_eq!(stats, deserialized);

        // Forward compatibility: cleanedCount omitted defaults to 0
        let legacy_json = r#"{"supported":true,"exemptedCount":10,"totalCount":20}"#;
        let deserialized_legacy: crate::models::UwpLoopbackStats =
            serde_json::from_str(legacy_json).expect("should deserialize legacy json");
        assert_eq!(deserialized_legacy.cleaned_count, 0);
    }
    #[test]
    fn test_sort_bypass_items() {
        let mut list = vec![
            "<local>".to_string(),
            "192.168.*".to_string(),
            "*.sheepyu.top".to_string(),
            "172.17.*".to_string(),
            "119.29.106.76".to_string(),
            "api.sheepyu.top".to_string(),
            "172.16.*".to_string(),
            "10.*".to_string(),
            "sheepyu.top".to_string(),
            "localhost".to_string(),
            "baidu.com".to_string(),
        ];

        sort_bypass_items(&mut list);

        assert_eq!(
            list,
            vec![
                "localhost".to_string(),
                "baidu.com".to_string(),
                "sheepyu.top".to_string(),
                "*.sheepyu.top".to_string(),
                "api.sheepyu.top".to_string(),
                "10.*".to_string(),
                "119.29.106.76".to_string(),
                "172.16.*".to_string(),
                "172.17.*".to_string(),
                "192.168.*".to_string(),
                "<local>".to_string(),
            ]
        );
    }
}
