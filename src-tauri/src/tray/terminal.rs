use crate::models::InboundProtocol;

/// Builds commands for the selected shell without changing this process or OS proxy state.
pub(super) fn build_command(
    shell: &str,
    port: u16,
    protocol: InboundProtocol,
    user_bypass: &[String],
) -> Result<String, String> {
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
    let http = if protocol == InboundProtocol::Socks5 {
        String::new()
    } else {
        format!("http://127.0.0.1:{port}")
    };
    let all = if protocol == InboundProtocol::Socks5 {
        format!("socks5h://127.0.0.1:{port}")
    } else {
        http.clone()
    };
    let no_proxy = bypass.join(",");
    let vars = [
        ("HTTP_PROXY", http.as_str()),
        ("HTTPS_PROXY", http.as_str()),
        ("ALL_PROXY", all.as_str()),
        ("NO_PROXY", no_proxy.as_str()),
    ];
    match shell {
        "powershell" => Ok(vars
            .iter()
            .map(|(key, value)| format!("$env:{key}='{}'", value.replace('\'', "''")))
            .collect::<Vec<_>>()
            .join("; ")),
        "cmd" => {
            // CMD expands percent and delayed-expansion expressions even inside quotes.
            if no_proxy.contains(['%', '!', '"', '\r', '\n', '\0']) {
                return Err("排除列表包含 CMD 无法安全引用的字符，请使用 PowerShell 或 Shell".into());
            }
            Ok(vars
                .iter()
                .map(|(key, value)| format!("set \"{key}={value}\""))
                .collect::<Vec<_>>()
                .join(" && "))
        }
        "shell" => Ok(vars
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
        _ => Err("不支持的终端类型".into()),
    }
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
        )?;
        assert_eq!(
            command,
            "$env:HTTP_PROXY='http://127.0.0.1:7891'; $env:HTTPS_PROXY='http://127.0.0.1:7891'; $env:ALL_PROXY='http://127.0.0.1:7891'; $env:NO_PROXY='localhost,127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,a''b$().example'"
        );
        Ok(())
    }

    #[test]
    fn socks_only_command_clears_http_proxies() -> Result<(), String> {
        let command = build_command("cmd", 7892, InboundProtocol::Socks5, &[])?;
        assert_eq!(
            command,
            "set \"HTTP_PROXY=\" && set \"HTTPS_PROXY=\" && set \"ALL_PROXY=socks5h://127.0.0.1:7892\" && set \"NO_PROXY=localhost,127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16\""
        );
        Ok(())
    }

    #[test]
    fn shell_quotes_bypass_and_sets_both_cases() -> Result<(), String> {
        let command = build_command("shell", 7893, InboundProtocol::Http, &["a'b.example".into()])?;
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
            assert!(build_command("cmd", 7891, InboundProtocol::Mixed, &[item.into()]).is_err());
        }
    }
}
