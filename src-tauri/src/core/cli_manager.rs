use crate::models::CliStatus;
use std::path::{Path, PathBuf};

pub const DEFAULT_CLI_ALIAS: &str = if cfg!(debug_assertions) { "mm-dev" } else { "mm" };
const ALIAS_MARKER_FILE: &str = if cfg!(debug_assertions) {
    ".mihomo-multi-cli-alias-dev"
} else {
    ".mihomo-multi-cli-alias"
};
const PROFILE_BEGIN_MARKER: &str = if cfg!(debug_assertions) {
    "# >>> mihomo-multi-cli-dev >>>"
} else {
    "# >>> mihomo-multi-cli >>>"
};
const PROFILE_END_MARKER: &str = if cfg!(debug_assertions) {
    "# <<< mihomo-multi-cli-dev <<<"
} else {
    "# <<< mihomo-multi-cli <<<"
};
const APP_META_FILE_NAME: &str = "app.json";

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppExeMetadata {
    exe_path: String,
}

/// Records the main application's executable path in `app_dir/app.json` so the CLI
/// `start` command can launch the matching dev or release binary when the app is offline.
pub fn write_app_exe_metadata(app_dir: &Path, exe_path: &Path) {
    if !exe_path.is_file() {
        return;
    }
    let _ = std::fs::create_dir_all(app_dir);
    let meta = AppExeMetadata {
        exe_path: exe_path.to_string_lossy().into_owned(),
    };
    if let Ok(json) = serde_json::to_string_pretty(&meta) {
        let _ = std::fs::write(app_dir.join(APP_META_FILE_NAME), json);
    }
}

/// Reads the recorded main application executable path from `app_dir/app.json` if it still exists on disk.
pub fn read_app_exe_metadata(app_dir: &Path) -> Option<PathBuf> {
    let content = std::fs::read_to_string(app_dir.join(APP_META_FILE_NAME)).ok()?;
    let meta: AppExeMetadata = serde_json::from_str(&content).ok()?;
    let path = PathBuf::from(meta.exe_path);
    path.is_file().then_some(path)
}

/// Removes `app_dir/app.json` (used during uninstallation).
pub fn remove_app_exe_metadata(app_dir: &Path) {
    let _ = std::fs::remove_file(app_dir.join(APP_META_FILE_NAME));
}

/// Resolves the installed release `mihomo-multi.exe` path from Windows Uninstall registry entries.
#[cfg(windows)]
pub fn read_windows_installed_app_exe() -> Option<PathBuf> {
    use windows_sys::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

    let subkey = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Mihomo Multi";
    for root in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
        if let Some(install_loc) = read_registry_string(root, subkey, "InstallLocation") {
            let cleaned = install_loc.trim().trim_matches('"');
            if !cleaned.is_empty() {
                let candidate = PathBuf::from(cleaned).join("mihomo-multi.exe");
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
        if let Some(display_icon) = read_registry_string(root, subkey, "DisplayIcon") {
            let cleaned = display_icon.trim().trim_matches('"');
            let icon_path = cleaned.split(',').next().unwrap_or("").trim().trim_matches('"');
            if !icon_path.is_empty() {
                let candidate = PathBuf::from(icon_path);
                if candidate
                    .file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.eq_ignore_ascii_case("mihomo-multi.exe"))
                    && candidate.is_file()
                {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

#[cfg(windows)]
fn read_registry_string(
    root: windows_sys::Win32::System::Registry::HKEY,
    subkey: &str,
    value_name: &str,
) -> Option<String> {
    use windows_sys::Win32::System::Registry::{HKEY, KEY_READ, RegCloseKey, RegOpenKeyExW, RegQueryValueExW};

    let subkey_w = to_wide_null(subkey);
    let value_w = to_wide_null(value_name);
    let mut hkey: HKEY = std::ptr::null_mut();
    if unsafe { RegOpenKeyExW(root, subkey_w.as_ptr(), 0, KEY_READ, &mut hkey) } != 0 {
        return None;
    }
    let mut data_len: u32 = 0;
    let query_ret = unsafe {
        RegQueryValueExW(
            hkey,
            value_w.as_ptr(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut data_len,
        )
    };
    if query_ret != 0 || data_len == 0 {
        unsafe { RegCloseKey(hkey) };
        return None;
    }
    let mut buf = vec![0u16; (data_len as usize).div_ceil(2)];
    let query_ret = unsafe {
        RegQueryValueExW(
            hkey,
            value_w.as_ptr(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            buf.as_mut_ptr().cast::<u8>(),
            &mut data_len,
        )
    };
    unsafe { RegCloseKey(hkey) };
    if query_ret != 0 {
        return None;
    }
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    Some(String::from_utf16_lossy(&buf[..end]))
}

const RESERVED_COMMANDS: &[&str] = &[
    "cmd",
    "powershell",
    "pwsh",
    "sh",
    "bash",
    "zsh",
    "fish",
    "ls",
    "cd",
    "rm",
    "cp",
    "mv",
    "cat",
    "echo",
    "sudo",
    "git",
    "curl",
    "ssh",
    "ping",
    "exit",
    "clear",
    "cls",
    "dir",
    "set",
    "export",
    "unset",
];

/// Validates and normalizes a user-configured CLI command alias.
pub fn validate_cli_alias(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > 32 {
        return Err(crate::tr!(
            "CLI 别名长度必须在 1 到 32 个字符之间".to_string(),
            "CLI alias must be between 1 and 32 characters".to_string()
        ));
    }
    let mut chars = trimmed.chars();
    let Some(first) = chars.next() else {
        return Err(crate::tr!(
            "CLI 别名不能为空".to_string(),
            "CLI alias cannot be empty".to_string()
        ));
    };
    if !first.is_ascii_alphabetic() {
        return Err(crate::tr!(
            "CLI 别名必须以英文字母开头".to_string(),
            "CLI alias must start with an ASCII letter".to_string()
        ));
    }
    if !chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err(crate::tr!(
            "CLI 别名仅支持英文字母、数字、下划线和连字符".to_string(),
            "CLI alias may only contain ASCII letters, digits, '_' and '-'".to_string()
        ));
    }
    let lower = trimmed.to_ascii_lowercase();
    if RESERVED_COMMANDS.contains(&lower.as_str()) {
        return Err(crate::tr!(
            format!("CLI 别名「{trimmed}」与系统保留命令冲突，请更换其他名称"),
            format!("CLI alias \"{trimmed}\" conflicts with a reserved system command")
        ));
    }
    Ok(trimmed.to_string())
}

/// Returns the single dedicated directory exposed on PATH for CLI alias binaries/shims.
/// Dev and release share this directory and isolate themselves via distinct aliases (`mm-dev` vs `mm`).
pub fn resolve_cli_dir() -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        let base = std::env::var_os("LOCALAPPDATA")
            .ok_or_else(|| "LOCALAPPDATA environment variable is not set".to_string())?;
        Ok(PathBuf::from(base).join("Mihomo Multi").join("cli"))
    }
    #[cfg(not(windows))]
    {
        let home = std::env::var_os("HOME").ok_or_else(|| "HOME environment variable is not set".to_string())?;
        Ok(PathBuf::from(home).join(".local").join("bin"))
    }
}
pub fn resolve_source_binary() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let bin_name = if cfg!(windows) {
        "mihomo-multi-cli.exe"
    } else {
        "mihomo-multi-cli"
    };
    let candidate = dir.join(bin_name);
    if candidate.exists() {
        return Some(candidate);
    }
    // Fallback for macOS .app bundles where sidecar/helper binaries may live under Resources
    let resources_candidate = dir.join("..").join("Resources").join(bin_name);
    if resources_candidate.exists() {
        return Some(resources_candidate);
    }
    None
}

fn alias_binary_path(cli_dir: &Path, alias: &str) -> PathBuf {
    if cfg!(windows) {
        cli_dir.join(format!("{alias}.exe"))
    } else {
        cli_dir.join(alias)
    }
}

#[cfg(windows)]
fn alias_cmd_shim_path(cli_dir: &Path, alias: &str) -> PathBuf {
    cli_dir.join(format!("{alias}.cmd"))
}

fn read_previous_alias(cli_dir: &Path) -> Option<String> {
    std::fs::read_to_string(cli_dir.join(ALIAS_MARKER_FILE))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn remove_alias_files(cli_dir: &Path, alias: &str) {
    let bin = alias_binary_path(cli_dir, alias);
    if bin.exists() || bin.symlink_metadata().is_ok() {
        let _ = std::fs::remove_file(&bin);
    }
    #[cfg(windows)]
    {
        let cmd = alias_cmd_shim_path(cli_dir, alias);
        if cmd.exists() {
            let _ = std::fs::remove_file(&cmd);
        }
    }
}

/// Synchronizes the source `mihomo-multi-cli` binary into `cli_dir` under `alias`,
/// removing any previously managed alias files so upgrades always replace the active alias.
pub fn sync_cli_in_dir(cli_dir: &Path, source_bin: &Path, alias: &str) -> Result<(), String> {
    let valid_alias = validate_cli_alias(alias)?;
    if !source_bin.exists() {
        return Err(format!("source CLI binary not found: {}", source_bin.display()));
    }
    std::fs::create_dir_all(cli_dir).map_err(|e| format!("failed to create CLI dir: {e}"))?;

    if let Some(prev) = read_previous_alias(cli_dir)
        && prev != valid_alias
    {
        remove_alias_files(cli_dir, &prev);
    }

    let target_bin = alias_binary_path(cli_dir, &valid_alias);
    #[cfg(windows)]
    {
        std::fs::copy(source_bin, &target_bin)
            .map_err(|e| format!("failed to copy CLI binary to {}: {e}", target_bin.display()))?;
        let cmd_script = format!(
            "@echo off\r\nif /I \"%~1\"==\"env\" (\r\n  for /f \"usebackq delims=\" %%i in (`\"%~dp0{valid_alias}.exe\" %* --shell cmd --eval`) do %%i\r\n  exit /b %ERRORLEVEL%\r\n)\r\n\"%~dp0{valid_alias}.exe\" %*\r\n"
        );
        std::fs::write(alias_cmd_shim_path(cli_dir, &valid_alias), cmd_script)
            .map_err(|e| format!("failed to write CMD shim: {e}"))?;
    }
    #[cfg(unix)]
    {
        if target_bin.exists() || target_bin.symlink_metadata().is_ok() {
            let _ = std::fs::remove_file(&target_bin);
        }
        std::os::unix::fs::symlink(source_bin, &target_bin)
            .map_err(|e| format!("failed to create symlink {}: {e}", target_bin.display()))?;
    }

    std::fs::write(cli_dir.join(ALIAS_MARKER_FILE), format!("{valid_alias}\n"))
        .map_err(|e| format!("failed to write alias marker: {e}"))?;
    Ok(())
}

/// Checks whether `cli_dir` is registered in the user's PATH.
pub fn is_cli_dir_in_path(cli_dir: &Path) -> bool {
    let target = cli_dir.to_string_lossy().trim_end_matches(['\\', '/']).to_string();
    #[cfg(windows)]
    {
        read_hkcu_user_path().is_some_and(|path_val| {
            path_val
                .split(';')
                .any(|entry| entry.trim().trim_end_matches(['\\', '/']).eq_ignore_ascii_case(&target))
        })
    }
    #[cfg(not(windows))]
    {
        std::env::var("PATH")
            .unwrap_or_default()
            .split(':')
            .any(|entry| entry.trim().trim_end_matches('/') == target)
    }
}

/// Registers `cli_dir` into the current user's PATH (Windows registry + broadcast).
pub fn register_cli_path(cli_dir: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        let current = read_hkcu_user_path().unwrap_or_default();
        let target = cli_dir.to_string_lossy().trim_end_matches(['\\', '/']).to_string();
        let exists = current
            .split(';')
            .any(|entry| entry.trim().trim_end_matches(['\\', '/']).eq_ignore_ascii_case(&target));
        if !exists {
            let mut entries: Vec<String> = current
                .split(';')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            entries.push(target);
            write_hkcu_user_path(&entries.join(";"))?;
            broadcast_env_change();
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = cli_dir;
        Ok(())
    }
}

/// Removes `cli_dir` from the current user's PATH and deletes managed alias files.
pub fn unregister_cli_path(cli_dir: &Path, alias: &str) -> Result<(), String> {
    remove_alias_files(cli_dir, alias);
    if let Some(prev) = read_previous_alias(cli_dir) {
        remove_alias_files(cli_dir, &prev);
    }
    let _ = std::fs::remove_file(cli_dir.join(ALIAS_MARKER_FILE));

    #[cfg(windows)]
    {
        let current = read_hkcu_user_path().unwrap_or_default();
        let target = cli_dir.to_string_lossy().trim_end_matches(['\\', '/']).to_string();
        let filtered: Vec<String> = current
            .split(';')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty() && !s.trim_end_matches(['\\', '/']).eq_ignore_ascii_case(&target))
            .collect();
        write_hkcu_user_path(&filtered.join(";"))?;
        broadcast_env_change();
    }
    Ok(())
}

#[cfg(windows)]
fn to_wide_null(s: &str) -> Vec<u16> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    OsStr::new(s).encode_wide().chain(Some(0)).collect()
}

#[cfg(windows)]
fn read_hkcu_user_path() -> Option<String> {
    use windows_sys::Win32::System::Registry::{
        HKEY, HKEY_CURRENT_USER, KEY_READ, RegCloseKey, RegOpenKeyExW, RegQueryValueExW,
    };
    let subkey = to_wide_null("Environment");
    let value_name = to_wide_null("Path");
    let mut hkey: HKEY = std::ptr::null_mut();
    let open_ret = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, subkey.as_ptr(), 0, KEY_READ, &mut hkey) };
    if open_ret != 0 {
        return None;
    }
    let mut data_len: u32 = 0;
    let query_ret = unsafe {
        RegQueryValueExW(
            hkey,
            value_name.as_ptr(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut data_len,
        )
    };
    if query_ret != 0 || data_len == 0 {
        unsafe { RegCloseKey(hkey) };
        return None;
    }
    let mut buf = vec![0u16; (data_len as usize).div_ceil(2)];
    let query_ret = unsafe {
        RegQueryValueExW(
            hkey,
            value_name.as_ptr(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            buf.as_mut_ptr() as *mut u8,
            &mut data_len,
        )
    };
    unsafe { RegCloseKey(hkey) };
    if query_ret != 0 {
        return None;
    }
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    Some(String::from_utf16_lossy(&buf[..end]))
}

#[cfg(windows)]
fn write_hkcu_user_path(value: &str) -> Result<(), String> {
    use windows_sys::Win32::System::Registry::{
        HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE, REG_EXPAND_SZ, RegCloseKey, RegOpenKeyExW, RegSetValueExW,
    };
    let subkey = to_wide_null("Environment");
    let value_name = to_wide_null("Path");
    let mut hkey: HKEY = std::ptr::null_mut();
    let open_ret = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, subkey.as_ptr(), 0, KEY_SET_VALUE, &mut hkey) };
    if open_ret != 0 {
        return Err(format!("failed to open HKCU\\Environment (code {open_ret})"));
    }
    let wide_val = to_wide_null(value);
    let byte_len = (wide_val.len() * std::mem::size_of::<u16>()) as u32;
    let set_ret = unsafe {
        RegSetValueExW(
            hkey,
            value_name.as_ptr(),
            0,
            REG_EXPAND_SZ,
            wide_val.as_ptr() as *const u8,
            byte_len,
        )
    };
    unsafe { RegCloseKey(hkey) };
    if set_ret != 0 {
        return Err(format!("failed to update HKCU\\Environment\\Path (code {set_ret})"));
    }
    Ok(())
}

#[cfg(windows)]
fn broadcast_env_change() {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        HWND_BROADCAST, SMTO_ABORTIFHUNG, SendMessageTimeoutW, WM_SETTINGCHANGE,
    };
    let env_wide: Vec<u16> = OsStr::new("Environment").encode_wide().chain(Some(0)).collect();
    unsafe {
        SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            0,
            env_wide.as_ptr() as isize,
            SMTO_ABORTIFHUNG,
            2000,
            std::ptr::null_mut(),
        );
    }
}

/// Resolves the user's Documents directory, honoring Windows Known Folder redirection.
#[cfg(windows)]
fn resolve_documents_dir() -> Option<PathBuf> {
    use windows_sys::Win32::System::Com::CoTaskMemFree;
    use windows_sys::Win32::UI::Shell::{FOLDERID_Documents, SHGetKnownFolderPath};

    let mut raw_path: *mut u16 = std::ptr::null_mut();
    // SAFETY: `raw_path` is a valid out-pointer; on success `CoTaskMemFree` frees the buffer.
    let hr = unsafe { SHGetKnownFolderPath(&FOLDERID_Documents, 0, std::ptr::null_mut(), &mut raw_path) };
    if hr == 0 && !raw_path.is_null() {
        let mut len = 0usize;
        // SAFETY: `SHGetKnownFolderPath` guarantees a null-terminated UTF-16 string on S_OK.
        unsafe {
            while *raw_path.add(len) != 0 {
                len += 1;
            }
            let slice = std::slice::from_raw_parts(raw_path, len);
            let os_str = <std::ffi::OsString as std::os::windows::ffi::OsStringExt>::from_wide(slice);
            CoTaskMemFree(raw_path.cast());
            return Some(PathBuf::from(os_str));
        }
    }
    if !raw_path.is_null() {
        // SAFETY: `raw_path` was allocated by `SHGetKnownFolderPath` if non-null.
        unsafe { CoTaskMemFree(raw_path.cast()) };
    }
    std::env::var_os("USERPROFILE").map(|home| PathBuf::from(home).join("Documents"))
}

/// Resolves the default user shell profile file for installing `<alias> env` session integration.
pub fn resolve_shell_profile_path() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        let docs = resolve_documents_dir()?;
        let pwsh7 = docs.join("PowerShell").join("Microsoft.PowerShell_profile.ps1");
        if pwsh7.parent().is_some_and(|p| p.exists()) {
            return Some(pwsh7);
        }
        Some(docs.join("WindowsPowerShell").join("Microsoft.PowerShell_profile.ps1"))
    }
    #[cfg(not(windows))]
    {
        let home = std::env::var_os("HOME").map(PathBuf::from)?;
        let shell = std::env::var("SHELL").unwrap_or_default();
        if shell.ends_with("zsh") {
            Some(home.join(".zshrc"))
        } else {
            Some(home.join(".bashrc"))
        }
    }
}

pub fn is_shell_integration_installed() -> bool {
    let Some(path) = resolve_shell_profile_path() else {
        return false;
    };
    std::fs::read_to_string(path)
        .map(|content| content.contains(PROFILE_BEGIN_MARKER) && content.contains(PROFILE_END_MARKER))
        .unwrap_or(false)
}

fn build_profile_snippet(alias: &str) -> String {
    #[cfg(windows)]
    {
        format!(
            "{PROFILE_BEGIN_MARKER}\nfunction {alias} {{\n  if ($args.Count -gt 0 -and $args[0] -eq 'env') {{\n    $cmd = & {alias}.exe @args --shell pwsh --eval\n    if ($LASTEXITCODE -eq 0 -and $cmd) {{ Invoke-Expression $cmd }}\n  }} else {{\n    & {alias}.exe @args\n  }}\n}}\n{PROFILE_END_MARKER}"
        )
    }
    #[cfg(not(windows))]
    {
        format!(
            "{PROFILE_BEGIN_MARKER}\n{alias}() {{\n  if [ \"$1\" = \"env\" ]; then\n    local _cmd\n    _cmd=\"$(command {alias} \"$@\" --shell sh --eval)\" || return $?\n    eval \"$_cmd\"\n  else\n    command {alias} \"$@\"\n  fi\n}}\n{PROFILE_END_MARKER}"
        )
    }
}

/// Idempotently installs or updates the `<alias> env` shell integration block in the user's profile.
pub fn install_shell_integration(alias: &str) -> Result<PathBuf, String> {
    let valid_alias = validate_cli_alias(alias)?;
    let path = resolve_shell_profile_path().ok_or_else(|| "unable to resolve shell profile path".to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("failed to create profile directory: {e}"))?;
    }
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let snippet = build_profile_snippet(&valid_alias);
    let updated = upsert_profile_block(&existing, &snippet);
    std::fs::write(&path, updated).map_err(|e| format!("failed to write {}: {e}", path.display()))?;
    Ok(path)
}

fn upsert_profile_block(existing: &str, block: &str) -> String {
    if let (Some(start), Some(end_rel)) = (existing.find(PROFILE_BEGIN_MARKER), existing.find(PROFILE_END_MARKER))
        && end_rel >= start
    {
        let end = end_rel + PROFILE_END_MARKER.len();
        let mut out = String::with_capacity(existing.len() + block.len());
        out.push_str(&existing[..start]);
        out.push_str(block);
        out.push_str(&existing[end..]);
        return out;
    }
    if existing.is_empty() {
        format!("{block}\n")
    } else if existing.ends_with('\n') {
        format!("{existing}\n{block}\n")
    } else {
        format!("{existing}\n\n{block}\n")
    }
}

/// Computes the current CLI installation, alias, PATH, and shell-integration status.
pub fn get_cli_status(alias: &str) -> CliStatus {
    let cli_dir = resolve_cli_dir().unwrap_or_default();
    let source = resolve_source_binary();
    let installed = alias_binary_path(&cli_dir, alias).exists();
    let in_path = is_cli_dir_in_path(&cli_dir);
    let profile_path = resolve_shell_profile_path();
    let shell_profile_installed = is_shell_integration_installed();

    CliStatus {
        alias: alias.to_string(),
        installed,
        in_path,
        cli_dir: cli_dir.to_string_lossy().to_string(),
        source_binary: source.as_ref().map(|p| p.to_string_lossy().to_string()),
        source_exists: source.is_some(),
        shell_profile_installed,
        shell_profile_path: profile_path.map(|p| p.to_string_lossy().to_string()),
    }
}

/// Startup self-sync: if the CLI is already installed, keeps the active alias binary up to date
/// after app upgrades without reverting the user's custom alias back to `mm`.
pub fn sync_on_startup(alias: &str) {
    let Ok(cli_dir) = resolve_cli_dir() else {
        return;
    };
    let Some(source_bin) = resolve_source_binary() else {
        return;
    };
    let already_managed = cli_dir.join(ALIAS_MARKER_FILE).exists() || alias_binary_path(&cli_dir, alias).exists();
    if already_managed {
        let _ = sync_cli_in_dir(&cli_dir, &source_bin, alias);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_cli_aliases() {
        assert_eq!(validate_cli_alias("mm").as_deref(), Ok("mm"));
        assert_eq!(validate_cli_alias("mhm_2-dev").as_deref(), Ok("mhm_2-dev"));
        assert!(validate_cli_alias("").is_err());
        assert!(validate_cli_alias("1mm").is_err());
        assert!(validate_cli_alias("mm space").is_err());
        assert!(validate_cli_alias("git").is_err());
        assert!(validate_cli_alias("cmd").is_err());
    }

    #[test]
    fn sync_replaces_old_alias_cleanly() {
        let root = std::env::temp_dir().join(format!("mhm-cli-mgr-{}", uuid::Uuid::new_v4()));
        let cli_dir = root.join("cli");
        let src_bin = root.join(if cfg!(windows) {
            "mihomo-multi-cli.exe"
        } else {
            "mihomo-multi-cli"
        });
        std::fs::create_dir_all(&root).expect("create temp root");
        std::fs::write(&src_bin, b"dummy-cli").expect("write dummy cli");

        sync_cli_in_dir(&cli_dir, &src_bin, "mm").expect("sync mm");
        assert!(alias_binary_path(&cli_dir, "mm").exists());

        sync_cli_in_dir(&cli_dir, &src_bin, "px").expect("rename to px");
        assert!(!alias_binary_path(&cli_dir, "mm").exists());
        assert!(alias_binary_path(&cli_dir, "px").exists());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn upsert_profile_block_is_idempotent() {
        let first = upsert_profile_block("# existing\n", &build_profile_snippet("mm"));
        assert!(first.contains("mm"));
        let second = upsert_profile_block(&first, &build_profile_snippet("px"));
        assert!(second.contains("px"));
        assert!(!second.contains("function mm") && !second.contains("mm()"));
        assert_eq!(second.matches(PROFILE_BEGIN_MARKER).count(), 1);
    }

    #[test]
    fn app_exe_metadata_roundtrips_only_existing_files() {
        let root = std::env::temp_dir().join(format!("mhm-app-meta-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("create temp root");
        let fake_exe = root.join("mihomo-multi.exe");
        std::fs::write(&fake_exe, b"exe").expect("write dummy exe");

        write_app_exe_metadata(&root, &fake_exe);
        assert_eq!(read_app_exe_metadata(&root).as_deref(), Some(fake_exe.as_path()));

        let _ = std::fs::remove_file(&fake_exe);
        assert_eq!(read_app_exe_metadata(&root), None);

        remove_app_exe_metadata(&root);
        assert!(!root.join(APP_META_FILE_NAME).exists());

        let _ = std::fs::remove_dir_all(&root);
    }
}
