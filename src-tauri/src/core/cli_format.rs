use crate::models::InboundProtocol;
use serde::{Deserialize, Serialize};

/// Supported terminal shells for generating proxy environment commands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ShellKind {
    PowerShell,
    Cmd,
    Sh,
}

impl ShellKind {
    /// Parses shell name aliases such as `pwsh`, `powershell`, `cmd`, `sh`, `bash`, `zsh`, `shell`.
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "powershell" | "pwsh" | "ps" => Some(Self::PowerShell),
            "cmd" | "bat" => Some(Self::Cmd),
            "shell" | "sh" | "bash" | "zsh" => Some(Self::Sh),
            _ => None,
        }
    }

    /// Returns the platform default shell when the caller does not specify one.
    pub fn default_for_platform() -> Self {
        if cfg!(windows) {
            Self::PowerShell
        } else {
            Self::Sh
        }
    }
}

/// Supported quick-copy output formats (mirrors `QuickCopyMenu.tsx`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CopyFormat {
    Env,
    Host,
    Http,
    Socks5,
    Curl,
}

impl CopyFormat {
    pub const ALL: [Self; 5] = [Self::Env, Self::Host, Self::Http, Self::Socks5, Self::Curl];

    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "env" => Some(Self::Env),
            "host" | "addr" => Some(Self::Host),
            "http" => Some(Self::Http),
            "socks5" | "socks" => Some(Self::Socks5),
            "curl" => Some(Self::Curl),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Env => "env",
            Self::Host => "host",
            Self::Http => "http",
            Self::Socks5 => "socks5",
            Self::Curl => "curl",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EnvFormatError {
    CmdUnsafeChars,
}

/// Builds the comma-separated `NO_PROXY` list combining private/loopback defaults and user bypass items.
pub fn build_terminal_no_proxy(user_bypass: &[String]) -> String {
    let mut bypass = vec![
        "localhost".to_string(),
        "127.0.0.1".to_string(),
        "10.0.0.0/8".to_string(),
        "172.16.0.0/12".to_string(),
        "192.168.0.0/16".to_string(),
    ];
    for item in user_bypass.iter().map(|s| s.trim()) {
        if !item.is_empty()
            && !item.eq_ignore_ascii_case("<local>")
            && !bypass.iter().any(|s| s.eq_ignore_ascii_case(item))
        {
            bypass.push(item.to_string());
        }
    }
    bypass.join(",")
}

/// Builds a shell command that sets proxy environment variables for the current terminal session.
pub fn build_env_set_command(
    shell: ShellKind,
    host: &str,
    port: u16,
    protocol: InboundProtocol,
    user_bypass: &[String],
) -> Result<String, EnvFormatError> {
    let http = if protocol == InboundProtocol::Socks5 {
        String::new()
    } else {
        format!("http://{host}:{port}")
    };
    let all = if protocol == InboundProtocol::Socks5 {
        format!("socks5h://{host}:{port}")
    } else {
        http.clone()
    };
    let no_proxy = build_terminal_no_proxy(user_bypass);
    let vars = [
        ("HTTP_PROXY", http.as_str()),
        ("HTTPS_PROXY", http.as_str()),
        ("ALL_PROXY", all.as_str()),
        ("NO_PROXY", no_proxy.as_str()),
    ];

    match shell {
        ShellKind::PowerShell => Ok(vars
            .iter()
            .map(|(key, value)| format!("$env:{key}='{}'", value.replace('\'', "''")))
            .collect::<Vec<_>>()
            .join("; ")),
        ShellKind::Cmd => {
            // CMD expands percent and delayed-expansion expressions even inside quotes.
            if no_proxy.contains(['%', '!', '"', '\r', '\n', '\0']) {
                return Err(EnvFormatError::CmdUnsafeChars);
            }
            Ok(vars
                .iter()
                .map(|(key, value)| format!("set \"{key}={value}\""))
                .collect::<Vec<_>>()
                .join(" && "))
        }
        ShellKind::Sh => Ok(vars
            .iter()
            .flat_map(|(key, value)| {
                let quoted = value.replace('\'', "'\"'\"'");
                [
                    format!("export {}='{quoted}'", key.to_ascii_lowercase()),
                    format!("export {key}='{quoted}'"),
                ]
            })
            .collect::<Vec<_>>()
            .join("; ")),
    }
}

/// Builds a shell command that clears proxy environment variables in the current terminal session.
pub fn build_env_unset_command(shell: ShellKind) -> String {
    const KEYS: [&str; 4] = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"];
    match shell {
        ShellKind::PowerShell => KEYS
            .iter()
            .map(|key| format!("Remove-Item Env:{key} -ErrorAction SilentlyContinue"))
            .collect::<Vec<_>>()
            .join("; "),
        ShellKind::Cmd => KEYS
            .iter()
            .map(|key| format!("set \"{key}=\""))
            .collect::<Vec<_>>()
            .join(" && "),
        ShellKind::Sh => {
            let mut names = Vec::with_capacity(KEYS.len() * 2);
            for key in KEYS {
                names.push(key.to_ascii_lowercase());
                names.push(key.to_string());
            }
            format!("unset {}", names.join(" "))
        }
    }
}

/// Formats a single quick-copy value for the given port and format.
pub fn build_copy_value(
    format: CopyFormat,
    shell: ShellKind,
    host: &str,
    port: u16,
    protocol: InboundProtocol,
    user_bypass: &[String],
) -> Result<String, EnvFormatError> {
    match format {
        CopyFormat::Env => build_env_set_command(shell, host, port, protocol, user_bypass),
        CopyFormat::Host => Ok(format!("{host}:{port}")),
        CopyFormat::Http => Ok(format!("http://{host}:{port}")),
        CopyFormat::Socks5 => Ok(format!("socks5://{host}:{port}")),
        CopyFormat::Curl => {
            let scheme = if protocol == InboundProtocol::Socks5 {
                "socks5"
            } else {
                "http"
            };
            Ok(format!("curl -x {scheme}://{host}:{port} -s https://api.ip.sb/geoip"))
        }
    }
}

/// Formats all supported quick-copy values for a port.
pub fn build_all_copy_values(
    shell: ShellKind,
    host: &str,
    port: u16,
    protocol: InboundProtocol,
    user_bypass: &[String],
) -> Result<Vec<(CopyFormat, String)>, EnvFormatError> {
    let mut out = Vec::with_capacity(CopyFormat::ALL.len());
    for fmt in CopyFormat::ALL {
        out.push((
            fmt,
            build_copy_value(fmt, shell, host, port, protocol, user_bypass)?,
        ));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unset_commands_cover_all_shells() {
        let ps = build_env_unset_command(ShellKind::PowerShell);
        assert!(ps.contains("Remove-Item Env:HTTP_PROXY"));
        assert!(ps.contains("Remove-Item Env:NO_PROXY"));

        let cmd = build_env_unset_command(ShellKind::Cmd);
        assert_eq!(
            cmd,
            "set \"HTTP_PROXY=\" && set \"HTTPS_PROXY=\" && set \"ALL_PROXY=\" && set \"NO_PROXY=\""
        );

        let sh = build_env_unset_command(ShellKind::Sh);
        assert_eq!(
            sh,
            "unset http_proxy HTTP_PROXY https_proxy HTTPS_PROXY all_proxy ALL_PROXY no_proxy NO_PROXY"
        );
    }

    #[test]
    fn copy_formats_match_quick_copy_menu() -> Result<(), EnvFormatError> {
        let all = build_all_copy_values(
            ShellKind::PowerShell,
            "127.0.0.1",
            17890,
            InboundProtocol::Mixed,
            &[],
        )?;
        assert_eq!(all.len(), 5);
        assert_eq!(all[1], (CopyFormat::Host, "127.0.0.1:17890".to_string()));
        assert_eq!(all[2], (CopyFormat::Http, "http://127.0.0.1:17890".to_string()));
        assert_eq!(all[3], (CopyFormat::Socks5, "socks5://127.0.0.1:17890".to_string()));
        assert_eq!(
            all[4],
            (
                CopyFormat::Curl,
                "curl -x http://127.0.0.1:17890 -s https://api.ip.sb/geoip".to_string()
            )
        );
        Ok(())
    }

    #[test]
    fn curl_format_uses_socks5_for_socks5_listener() -> Result<(), EnvFormatError> {
        let curl = build_copy_value(
            CopyFormat::Curl,
            ShellKind::Sh,
            "127.0.0.1",
            1080,
            InboundProtocol::Socks5,
            &[],
        )?;
        assert_eq!(curl, "curl -x socks5://127.0.0.1:1080 -s https://api.ip.sb/geoip");
        Ok(())
    }
}
