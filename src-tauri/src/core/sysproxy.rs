use crate::error::{AppError, AppResult};
use tracing::info;

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

/// Applies system proxy to the OS
pub fn apply_system_proxy(port: u16, user_bypass: &[String]) -> AppResult<()> {
    info!(port = port, "Applying system proxy");
    let combined_bypass = build_combined_bypass_list(user_bypass);

    if cfg!(test) {
        info!(
            port = port,
            "[test] Skipped OS system proxy mutation"
        );
        return Ok(());
    }

    #[cfg(windows)]
    {
        windows::set_system_proxy_windows(port, &combined_bypass)?;
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

/// Clears system proxy from the OS
pub fn clear_system_proxy() -> AppResult<()> {
    info!("Clearing system proxy");

    if cfg!(test) {
        info!("[test] Skipped OS system proxy cleanup");
        return Ok(());
    }

    #[cfg(windows)]
    {
        windows::clear_system_proxy_windows()?;
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

/// Applies terminal environment variables proxy (http_proxy, https_proxy, all_proxy, no_proxy)
pub fn apply_env_proxy(port: u16, user_bypass: &[String]) -> AppResult<()> {
    info!(port = port, "Applying terminal environment proxy");
    let combined_bypass = build_combined_bypass_list(user_bypass);

    if cfg!(test) {
        info!(port = port, "[test] Skipped environment variable proxy mutation");
        return Ok(());
    }

    #[cfg(windows)]
    {
        windows::set_user_env_proxy_windows(port, &combined_bypass)?;
    }
    #[cfg(not(windows))]
    {
        let _ = combined_bypass;
        let _ = port;
    }

    Ok(())
}

/// Clears terminal environment variables proxy from the OS
pub fn clear_env_proxy() -> AppResult<()> {
    info!("Clearing terminal environment proxy");

    if cfg!(test) {
        info!("[test] Skipped environment variable proxy cleanup");
        return Ok(());
    }

    #[cfg(windows)]
    {
        windows::clear_user_env_proxy_windows()?;
    }

    Ok(())
}

/// Clears both system proxy and environment variable proxy
pub fn clear_all_system_and_env_proxies() -> AppResult<()> {
    let _ = clear_system_proxy();
    let _ = clear_env_proxy();
    Ok(())
}
/// Helper to check if a ProxyServer string (e.g. "127.0.0.1:7890" or "http=127.0.0.1:7890;https=127.0.0.1:7890")
/// matches the given port.
pub fn parse_proxy_server_matches_port(server: &str, port: u16) -> bool {
    let target_port_str = port.to_string();
    server.split(';').any(|entry| {
        let entry = entry.trim();
        let addr = entry.split_once('=').map(|(_, v)| v).unwrap_or(entry);
        addr.rsplit_once(':').map(|(_, p)| p) == Some(&target_port_str)
    })
}

/// Checks if the system proxy currently configured in OS is enabled and points to the specified port.
pub fn is_system_proxy_active_on_port(port: u16) -> bool {
    #[cfg(windows)]
    {
        windows::is_system_proxy_active_on_port_windows(port)
    }

    #[cfg(target_os = "macos")]
    {
        macos::is_system_proxy_active_on_port_macos(port)
    }

    #[cfg(target_os = "linux")]
    {
        linux::is_system_proxy_active_on_port_linux(port)
    }

    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        let _ = port;
        true
    }
}

/// Checks if the user environment variables proxy points to the specified port.
pub fn is_env_proxy_active_on_port(port: u16) -> bool {
    #[cfg(windows)]
    {
        windows::is_env_proxy_active_on_port_windows(port)
    }
    #[cfg(not(windows))]
    {
        let _ = port;
        false
    }
}

/// Computes the UWP exemption changes required to stay in sync with the installed apps.
///
/// Returns `(orphaned_sids, pending_sids)`: SIDs of uninstalled apps whose exemption must be
/// removed, and AppContainer SIDs that need a new exemption. The pending set is only populated
/// while the user's persisted "exempt all" intent is active.
#[cfg(any(windows, test))]
pub(crate) fn plan_uwp_exemption_maintenance(
    user_sids: &[String],
    exempted_sids: &std::collections::HashSet<String>,
    auto_exempt: bool,
) -> (Vec<String>, Vec<String>) {
    let user_set: std::collections::HashSet<&String> = user_sids.iter().collect();
    let mut orphaned_sids: Vec<String> = exempted_sids
        .iter()
        .filter(|sid| !user_set.contains(sid))
        .cloned()
        .collect();
    let mut pending_sids: Vec<String> = if auto_exempt {
        user_sids
            .iter()
            .filter(|sid| !exempted_sids.contains(*sid))
            .cloned()
            .collect()
    } else {
        Vec::new()
    };
    orphaned_sids.sort();
    pending_sids.sort();
    (orphaned_sids, pending_sids)
}

/// Queries current UWP Loopback exemption statistics
pub fn get_uwp_loopback_stats(auto_exempt: bool) -> AppResult<crate::models::UwpLoopbackStats> {
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
            newly_exempted_count: 0,
            auto_exempt,
        })
    }

    #[cfg(not(windows))]
    {
        let _ = auto_exempt;
        Ok(crate::models::UwpLoopbackStats {
            supported: false,
            exempted_count: 0,
            total_count: 0,
            cleaned_count: 0,
            newly_exempted_count: 0,
            auto_exempt: false,
        })
    }
}

/// Applies pending UWP exemption maintenance: removes exemptions of uninstalled apps and,
/// when the "exempt all" intent is active, exempts newly installed AppContainers.
/// Returns `(cleaned_count, newly_exempted_count)`.
pub fn maintain_uwp_loopback(auto_exempt: bool) -> AppResult<(usize, usize)> {
    #[cfg(windows)]
    {
        if cfg!(test) {
            Ok((0, 0))
        } else {
            windows::maintain_uwp_exemptions(auto_exempt)
        }
    }

    #[cfg(not(windows))]
    {
        let _ = auto_exempt;
        Ok((0, 0))
    }
}

/// Refreshes UWP Loopback exemption status, removes exemptions of uninstalled apps and,
/// when the "exempt all" intent is active, exempts newly installed AppContainers.
pub fn refresh_and_cleanup_uwp_loopback(auto_exempt: bool) -> AppResult<crate::models::UwpLoopbackStats> {
    #[cfg(windows)]
    {
        let (cleaned_count, newly_exempted_count) = maintain_uwp_loopback(auto_exempt)?;
        let mut stats = get_uwp_loopback_stats(auto_exempt)?;
        stats.cleaned_count = cleaned_count;
        stats.newly_exempted_count = newly_exempted_count;
        Ok(stats)
    }

    #[cfg(not(windows))]
    {
        let _ = auto_exempt;
        Ok(crate::models::UwpLoopbackStats {
            supported: false,
            exempted_count: 0,
            total_count: 0,
            cleaned_count: 0,
            newly_exempted_count: 0,
            auto_exempt: false,
        })
    }
}

/// Exempts all user UWP AppContainers from Loopback restriction
pub fn exempt_all_uwp_loopback() -> AppResult<crate::models::UwpLoopbackStats> {
    #[cfg(windows)]
    {
        windows::exempt_all_uwp_windows()?;
        get_uwp_loopback_stats(true)
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
        get_uwp_loopback_stats(false)
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
    use tracing::warn;
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

    fn get_reg_dword(hkey: HKEY, name: &str) -> Option<u32> {
        let name_w = to_wide(name);
        let mut data = 0u32;
        let mut data_len = std::mem::size_of::<u32>() as u32;
        let mut val_type = 0u32;
        let ret = unsafe {
            RegQueryValueExW(
                hkey,
                name_w.as_ptr(),
                null_mut(),
                &mut val_type,
                &mut data as *mut u32 as *mut u8,
                &mut data_len,
            )
        };
        if ret == ERROR_SUCCESS && val_type == REG_DWORD {
            Some(data)
        } else {
            None
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
    pub fn is_system_proxy_active_on_port_windows(port: u16) -> bool {
        let Ok(key) = open_reg_key(HKEY_CURRENT_USER, INTERNET_SETTINGS_SUBKEY, KEY_READ) else {
            return false;
        };

        if get_reg_dword(key.0, "ProxyEnable") != Some(1) {
            return false;
        }

        let Some(server) = get_reg_sz(key.0, "ProxyServer") else {
            return false;
        };

        parse_proxy_server_matches_port(&server, port)
    }

    pub fn is_env_proxy_active_on_port_windows(port: u16) -> bool {
        let Ok(key) = open_reg_key(HKEY_CURRENT_USER, ENVIRONMENT_SUBKEY, KEY_READ) else {
            return false;
        };
        let Some(val) = get_reg_sz(key.0, "http_proxy") else {
            return false;
        };
        val.contains(&format!(":{}", port))
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

    fn loopback_exempt_line(action: &str, sid: &str) -> String {
        format!("CheckNetIsolation.exe LoopbackExempt -{} -p={}", action, sid)
    }

    /// Writes a temporary batch script and executes it elevated. Returns `Ok(false)` when the
    /// user dismissed the UAC prompt, `Ok(true)` when the script completed successfully.
    fn run_elevated_loopback_script(lines: &[String], failure_context: &str) -> AppResult<bool> {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let temp_path = std::env::temp_dir().join(format!("mihomo_uwp_{}.cmd", uuid::Uuid::new_v4()));
        let mut script = String::from("@echo off\r\n");
        for line in lines {
            script.push_str(line);
            script.push_str("\r\n");
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
            return Ok(false);
        }

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::Internal(format!("{}: {}", failure_context, stderr.trim())));
        }

        Ok(true)
    }

    pub fn exempt_all_uwp_windows() -> AppResult<()> {
        let sids = get_user_appcontainer_sids();
        if sids.is_empty() {
            info!("未发现任何 UWP 应用容器注册表项");
            return Ok(());
        }

        let lines: Vec<String> = sids.iter().map(|sid| loopback_exempt_line("a", sid)).collect();

        if !run_elevated_loopback_script(&lines, "执行 UWP 回环豁免失败")? {
            return Err(AppError::Internal("用户取消了管理员权限授权 (UAC)".to_string()));
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

    /// Cleans exemptions of uninstalled apps and, while the "exempt all" intent is active,
    /// exempts AppContainers that appeared after the last maintenance run. Both changes are
    /// applied in a single elevated invocation so the user sees at most one UAC prompt.
    pub fn maintain_uwp_exemptions(auto_exempt: bool) -> AppResult<(usize, usize)> {
        let user_sids = get_user_appcontainer_sids();
        let exempted_sids = get_exempted_sids();
        let (orphaned_sids, pending_sids) = plan_uwp_exemption_maintenance(&user_sids, &exempted_sids, auto_exempt);

        if orphaned_sids.is_empty() && pending_sids.is_empty() {
            return Ok((0, 0));
        }

        info!(
            orphaned = orphaned_sids.len(),
            pending = pending_sids.len(),
            auto_exempt,
            "检测到 UWP 回环豁免差异，准备自动维护"
        );

        let mut lines = Vec::with_capacity(orphaned_sids.len() + pending_sids.len());
        for sid in &orphaned_sids {
            lines.push(loopback_exempt_line("d", sid));
        }
        for sid in &pending_sids {
            lines.push(loopback_exempt_line("a", sid));
        }

        if !run_elevated_loopback_script(&lines, "执行 UWP 回环豁免自动维护失败")? {
            warn!("用户取消了管理员权限授权 (UAC)，跳过 UWP 回环豁免自动维护");
            return Ok((0, 0));
        }

        info!(
            cleaned = orphaned_sids.len(),
            newly_exempted = pending_sids.len(),
            "已完成 UWP 回环豁免自动维护"
        );
        Ok((orphaned_sids.len(), pending_sids.len()))
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
    pub fn is_system_proxy_active_on_port_macos(port: u16) -> bool {
        let services = get_active_network_services();
        let port_str = port.to_string();
        for service in services {
            if let Ok(output) = Command::new("networksetup").args(["-getwebproxy", &service]).output() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let enabled = stdout.lines().any(|l| l.to_ascii_lowercase().starts_with("enabled: yes"));
                let port_match = stdout.lines().any(|l| {
                    let l = l.trim().to_ascii_lowercase();
                    l.starts_with("port:") && l.ends_with(&port_str)
                });
                if enabled && port_match {
                    return true;
                }
            }
        }
        false
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
    pub fn is_system_proxy_active_on_port_linux(port: u16) -> bool {
        let port_str = port.to_string();
        if let Ok(mode_out) = Command::new("gsettings").args(["get", "org.gnome.system.proxy", "mode"]).output() {
            let mode = String::from_utf8_lossy(&mode_out.stdout);
            if !mode.contains("manual") {
                return false;
            }
        }
        if let Ok(port_out) = Command::new("gsettings").args(["get", "org.gnome.system.proxy.http", "port"]).output() {
            let p = String::from_utf8_lossy(&port_out.stdout);
            if p.trim().trim_matches('\'') == port_str {
                return true;
            }
        }
        false
    }

}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_uwp_loopback_stats_query() {
        let stats = get_uwp_loopback_stats(false).expect("should query uwp stats without error");
        #[cfg(windows)]
        {
            assert!(stats.supported);
            assert!(!stats.auto_exempt);
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
        let stats = get_uwp_loopback_stats(false).expect("should query uwp stats");
        assert!(stats.exempted_count <= stats.total_count);
        let refreshed = refresh_and_cleanup_uwp_loopback(false).expect("should refresh uwp stats");
        assert!(refreshed.exempted_count <= refreshed.total_count);
        assert_eq!(refreshed.newly_exempted_count, 0);
        assert!(!refreshed.auto_exempt);
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
            newly_exempted_count: 3,
            auto_exempt: true,
        };
        let json = serde_json::to_string(&stats).expect("should serialize");
        assert!(json.contains("\"supported\":true"));
        assert!(json.contains("\"exemptedCount\":42"));
        assert!(json.contains("\"totalCount\":100"));
        assert!(json.contains("\"cleanedCount\":5"));
        assert!(json.contains("\"newlyExemptedCount\":3"));
        assert!(json.contains("\"autoExempt\":true"));

        let deserialized: crate::models::UwpLoopbackStats = serde_json::from_str(&json).expect("should deserialize");
        assert_eq!(stats, deserialized);

        // Forward compatibility: omitted maintenance fields default to zero/false
        let legacy_json = r#"{"supported":true,"exemptedCount":10,"totalCount":20}"#;
        let deserialized_legacy: crate::models::UwpLoopbackStats =
            serde_json::from_str(legacy_json).expect("should deserialize legacy json");
        assert_eq!(deserialized_legacy.cleaned_count, 0);
        assert_eq!(deserialized_legacy.newly_exempted_count, 0);
        assert!(!deserialized_legacy.auto_exempt);
    }

    #[test]
    fn test_uwp_exemption_plan_without_intent_keeps_new_apps_untouched() {
        let user_sids = vec!["S-1-15-2-old".to_string(), "S-1-15-2-new".to_string()];
        let exempted_sids =
            std::collections::HashSet::from(["S-1-15-2-old".to_string(), "S-1-15-2-uninstalled".to_string()]);

        let (orphaned, pending) = plan_uwp_exemption_maintenance(&user_sids, &exempted_sids, false);

        assert_eq!(orphaned, vec!["S-1-15-2-uninstalled".to_string()]);
        assert!(pending.is_empty());
    }

    #[test]
    fn test_uwp_exemption_plan_with_intent_exempts_only_new_apps() {
        let user_sids = vec![
            "S-1-15-2-old".to_string(),
            "S-1-15-2-new-b".to_string(),
            "S-1-15-2-new-a".to_string(),
        ];
        let exempted_sids =
            std::collections::HashSet::from(["S-1-15-2-old".to_string(), "S-1-15-2-uninstalled".to_string()]);

        let (orphaned, pending) = plan_uwp_exemption_maintenance(&user_sids, &exempted_sids, true);

        assert_eq!(orphaned, vec!["S-1-15-2-uninstalled".to_string()]);
        assert_eq!(
            pending,
            vec!["S-1-15-2-new-a".to_string(), "S-1-15-2-new-b".to_string()]
        );
    }

    #[test]
    fn test_uwp_exemption_plan_noop_when_in_sync() {
        let user_sids = vec!["S-1-15-2-a".to_string()];
        let exempted_sids = std::collections::HashSet::from(["S-1-15-2-a".to_string()]);

        let (orphaned, pending) = plan_uwp_exemption_maintenance(&user_sids, &exempted_sids, true);

        assert!(orphaned.is_empty());
        assert!(pending.is_empty());
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
    #[test]
    fn test_parse_proxy_server_matches_port() {
        assert!(parse_proxy_server_matches_port("127.0.0.1:7890", 7890));
        assert!(!parse_proxy_server_matches_port("127.0.0.1:7890", 17890));
        assert!(!parse_proxy_server_matches_port("127.0.0.1:7890", 890));
        assert!(parse_proxy_server_matches_port(
            "http=127.0.0.1:7890;https=127.0.0.1:7890",
            7890
        ));
        assert!(!parse_proxy_server_matches_port(
            "http=127.0.0.1:7890;https=127.0.0.1:7890",
            17890
        ));
        assert!(parse_proxy_server_matches_port("  127.0.0.1:17890  ", 17890));
        assert!(!parse_proxy_server_matches_port("", 7890));
        assert!(!parse_proxy_server_matches_port("invalid", 7890));
    }
}
