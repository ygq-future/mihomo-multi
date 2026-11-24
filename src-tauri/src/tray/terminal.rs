use super::TrayLocale;
use crate::core::cli_format::{EnvFormatError, ShellKind, build_env_set_command};
use crate::models::InboundProtocol;

/// Builds commands for the selected shell without changing this process or OS proxy state.
pub(super) fn build_command(
    shell: &str,
    port: u16,
    protocol: InboundProtocol,
    user_bypass: &[String],
    locale: TrayLocale,
) -> Result<String, String> {
    let kind = match shell {
        "powershell" => ShellKind::PowerShell,
        "cmd" => ShellKind::Cmd,
        "shell" => ShellKind::Sh,
        _ => return Err(locale.text().unsupported_shell.into()),
    };
    build_env_set_command(kind, "127.0.0.1", port, protocol, user_bypass).map_err(|err| match err {
        EnvFormatError::CmdUnsafeChars => locale.text().cmd_unsafe_chars.into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn powershell_quotes_bypass_as_literal_and_preserves_defaults() -> Result<(), String> {
        let command = build_command(
            "powershell",
            7891,
            InboundProtocol::Mixed,
            &[" LOCALHOST ".into(), "<local>".into(), "a'b$().example".into()],
            TrayLocale::ZhCn,
        )?;
        assert_eq!(
            command,
            "$env:HTTP_PROXY='http://127.0.0.1:7891'; $env:HTTPS_PROXY='http://127.0.0.1:7891'; $env:ALL_PROXY='http://127.0.0.1:7891'; $env:NO_PROXY='localhost,127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,a''b$().example'"
        );
        Ok(())
    }

    #[test]
    fn socks_only_command_clears_http_proxies() -> Result<(), String> {
        let command = build_command("cmd", 7892, InboundProtocol::Socks5, &[], TrayLocale::ZhCn)?;
        assert_eq!(
            command,
            "set \"HTTP_PROXY=\" && set \"HTTPS_PROXY=\" && set \"ALL_PROXY=socks5h://127.0.0.1:7892\" && set \"NO_PROXY=localhost,127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16\""
        );
        Ok(())
    }

    #[test]
    fn shell_quotes_bypass_and_sets_both_cases() -> Result<(), String> {
        let command = build_command(
            "shell",
            7893,
            InboundProtocol::Http,
            &["a'b.example".into()],
            TrayLocale::ZhCn,
        )?;
        assert!(
            command.contains("export http_proxy='http://127.0.0.1:7893'; export HTTP_PROXY='http://127.0.0.1:7893'")
        );
        assert!(command.contains("a'\"'\"'b.example'"));
        assert!(command.contains(
            "export NO_PROXY='localhost,127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,a'\"'\"'b.example'"
        ));
        Ok(())
    }

    #[test]
    fn cmd_rejects_expansion_and_quote_injection() {
        for item in ["%PATH%", "!PATH!", "a\" & calc", "a\nb"] {
            assert!(build_command("cmd", 7891, InboundProtocol::Mixed, &[item.into()], TrayLocale::ZhCn).is_err());
        }
    }
}
