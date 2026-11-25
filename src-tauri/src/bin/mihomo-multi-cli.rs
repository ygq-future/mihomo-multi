use clap::{Args, CommandFactory, FromArgMatches, Parser, Subcommand};
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{IsTerminal, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};
use std::time::{Duration, Instant};

const APP_IDENTIFIER: &str = "com.mihomo.multi";
const DEV_APP_IDENTIFIER: &str = "com.mihomo.multi.dev";
const CTL_FILE_NAME: &str = "ctl.json";
use mihomo_multi_lib::core::cli_manager::DEFAULT_CLI_ALIAS;
const APP_DISPLAY_NAME: &str = if cfg!(debug_assertions) {
    "Mihomo Multi [Dev]"
} else {
    "Mihomo Multi"
};
const DEFAULT_START_TIMEOUT_SECS: u64 = if cfg!(debug_assertions) { 60 } else { 15 };
const APP_BIN_NAME: &str = if cfg!(windows) {
    "mihomo-multi.exe"
} else {
    "mihomo-multi"
};
#[derive(Parser, Debug)]
#[command(
    name = "mm",
    version,
    about = "Mihomo Multi CLI — query, toggle, test, and copy proxy listeners from the terminal"
)]
struct Cli {
    /// Output raw JSON for scripting and automation
    #[arg(long, global = true)]
    json: bool,

    /// Disable ANSI color output
    #[arg(long, global = true)]
    no_color: bool,

    /// Override Mihomo Multi data directory containing ctl.json (also reads MIHOMO_MULTI_DATA_DIR)
    #[arg(long, global = true)]
    data_dir: Option<PathBuf>,

    /// Override CLI output language (zh-CN or en-US, also reads MM_LANG)
    #[arg(long, global = true)]
    lang: Option<String>,
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Start the Mihomo Multi desktop application if it is not already running
    Start {
        /// Launch minimized to the system tray
        #[arg(short = 's', long)]
        silent: bool,
        /// Do not wait for the control server to become ready
        #[arg(long)]
        no_wait: bool,
        /// Maximum seconds to wait for control server readiness
        #[arg(long, default_value_t = DEFAULT_START_TIMEOUT_SECS)]
        timeout: u64,
    },

    /// Stop the running Mihomo Multi desktop application gracefully
    Stop {
        /// Do not wait for the application to finish shutting down
        #[arg(long)]
        no_wait: bool,
        /// Maximum seconds to wait for shutdown completion
        #[arg(long, default_value_t = 10)]
        timeout: u64,
    },

    /// Show core, listener, system proxy, TUN, and terminal env status
    Status,

    /// List all configured port listeners
    #[command(visible_alias = "ls")]
    List,

    /// Enable a port listener and hot-reload Mihomo
    Enable {
        /// Listening port number
        port: u16,
    },

    /// Disable a port listener and hot-reload Mihomo
    Disable {
        /// Listening port number
        port: u16,
    },

    /// Subscription queries and updates
    Sub {
        #[command(subcommand)]
        action: SubAction,
    },

    /// Proxy node queries
    Node {
        #[command(subcommand)]
        action: NodeAction,
    },

    /// Latency test for a single node or a subscription
    #[command(args_conflicts_with_subcommands = true)]
    Test {
        /// Node index (from `node list`) or node name for quick latency test
        target: Option<String>,
        /// Custom test URL
        #[arg(long)]
        url: Option<String>,
        /// Timeout in milliseconds
        #[arg(long)]
        timeout: Option<u32>,
        #[command(subcommand)]
        action: Option<TestAction>,
    },

    /// View, enable on a port, or disable system proxy
    Sysproxy {
        /// Port number or "off"; omit to show current status
        target: Option<String>,
    },

    /// View, enable on a port, or disable TUN mode
    Tun {
        /// Port number or "off"; omit to show current status
        target: Option<String>,
    },

    /// Bind or clear terminal proxy environment variables (omit port to clear)
    Env(EnvArgs),

    /// Probe the current egress IP of an enabled port
    Ip {
        /// Listening port number
        port: u16,
        /// Copy the probed IP address to clipboard
        #[arg(short = 'c', long)]
        copy: bool,
        /// Probe timeout in milliseconds
        #[arg(long)]
        timeout: Option<u64>,
    },

    /// Output or copy quick-copy proxy strings (env, host, http, socks5, curl)
    Copy {
        /// Listening port number
        port: u16,
        /// Format: env, host, http, socks5, curl (omit to list all)
        format: Option<String>,
        /// Print only without writing to clipboard
        #[arg(long)]
        print: bool,
        /// Shell syntax when format is env or omitted: pwsh, cmd, sh
        #[arg(long)]
        shell: Option<String>,
    },

    /// Print shell integration snippet so `<alias> env [port]` updates the current terminal
    Init {
        /// Target shell: pwsh, bash, zsh, cmd (auto-detected if omitted)
        shell: Option<String>,
        /// CLI command alias name (defaults to mm)
        #[arg(long, default_value = "mm")]
        alias: String,
    },

    /// Get or set the application & CLI language (zh-CN / en-US)
    Lang {
        /// Target language (zh, en, zh-CN, en-US). Omit to show current language.
        target: Option<String>,
    },
    /// Check for updates, print release notes, and download the latest release
    Update {
        /// Only check for updates without downloading
        #[arg(short = 'c', long)]
        check: bool,
    },
    /// Internal NSIS post-install hook (registers CLI alias and user PATH)
    #[command(name = "__nsis-install", hide = true)]
    NsisInstall,

    /// Internal NSIS post-uninstall hook (cleans up release CLI alias and user PATH)
    #[command(name = "__nsis-uninstall", hide = true)]
    NsisUninstall,
}

#[derive(Subcommand, Debug)]
enum SubAction {
    /// List all subscriptions
    #[command(visible_alias = "ls")]
    List,

    /// Refresh a specific subscription or all enabled subscriptions
    Update {
        /// Subscription name or ID (omit or pass --all to refresh all enabled)
        target: Option<String>,
        /// Refresh all enabled remote subscriptions
        #[arg(long)]
        all: bool,
    },
}

#[derive(Subcommand, Debug)]
enum NodeAction {
    /// List all nodes, optionally filtered by subscription and node keyword
    #[command(visible_alias = "ls")]
    List {
        /// Optional subscription name or ID filter (supports fuzzy/subsequence match)
        sub: Option<String>,
        /// Optional node name/region filter (supports fuzzy/subsequence match)
        query: Option<String>,
        /// Show only available nodes with valid latency
        #[arg(short = 'a', long)]
        available: bool,
    },
}

#[derive(Subcommand, Debug)]
enum TestAction {
    /// Test latency of a single node
    Node {
        /// Node name
        name: String,
        /// Custom test URL
        #[arg(long)]
        url: Option<String>,
        /// Timeout in milliseconds
        #[arg(long)]
        timeout: Option<u32>,
    },

    /// Batch-test latency of all nodes in a subscription (or all subscriptions)
    Sub {
        /// Subscription name or ID (omit or pass --all for all nodes)
        target: Option<String>,
        /// Test all nodes across all subscriptions
        #[arg(long)]
        all: bool,
        /// Custom test URL
        #[arg(long)]
        url: Option<String>,
        /// Timeout in milliseconds
        #[arg(long)]
        timeout: Option<u32>,
    },
}

#[derive(Args, Debug)]
struct EnvArgs {
    /// Port number to bind; omit to clear terminal proxy environment
    port: Option<u16>,
    /// Target shell syntax: pwsh, cmd, sh
    #[arg(long)]
    shell: Option<String>,
    /// Only update the current shell session without changing global/persisted env proxy
    #[arg(short = 'c', long)]
    current: bool,
    /// Emit only the raw shell command on stdout (used by shell wrappers / .cmd shim)
    #[arg(long)]
    eval: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CtlDiscoveryInfo {
    port: u16,
    token: String,
    #[serde(default)]
    pid: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct ApiEnvelope {
    ok: bool,
    data: Option<Value>,
    error: Option<String>,
}

struct CtlClient {
    port: u16,
    token: String,
    pid: Option<u32>,
    lang: Lang,
    err_palette: Palette,
}

fn resolve_app_data_dir_with(
    override_dir: Option<&Path>,
    env_dir: Option<&Path>,
    local_base: Option<&Path>,
    is_dev: bool,
) -> Option<PathBuf> {
    if let Some(dir) = override_dir.or(env_dir) {
        return Some(dir.to_path_buf());
    }
    let base = local_base?;
    let id = if is_dev { DEV_APP_IDENTIFIER } else { APP_IDENTIFIER };
    Some(base.join(id))
}

fn resolve_app_data_dir(override_dir: Option<&Path>) -> Option<PathBuf> {
    let env_dir = std::env::var_os("MIHOMO_MULTI_DATA_DIR").map(PathBuf::from);
    let base = local_data_base_dir();
    resolve_app_data_dir_with(
        override_dir,
        env_dir.as_deref(),
        base.as_deref(),
        cfg!(debug_assertions),
    )
}

fn offline_error_message(lang: Lang, reason: &str, palette: Palette) -> String {
    let app_name = palette.bold_yellow(APP_DISPLAY_NAME);
    let start_cmd = palette.bold_green(&format!("`{DEFAULT_CLI_ALIAS} start`"));
    let zh_reason = palette.dim(&format!("（{reason}）"));
    let en_reason = palette.dim(&format!("({reason})"));
    lang.tr(
        &format!("{app_name} 主程序未运行{zh_reason}。请先启动主程序，或运行 {start_cmd}。"),
        &format!("{app_name} is not running {en_reason}. Start the app first, or run {start_cmd}."),
    )
    .to_string()
}

impl CtlClient {
    fn discover(override_dir: Option<&Path>, lang: Lang, err_palette: Palette) -> Result<Self, String> {
        let Some(dir) = resolve_app_data_dir(override_dir) else {
            return Err(offline_error_message(
                lang,
                lang.tr("无法定位数据目录", "cannot locate data directory"),
                err_palette,
            ));
        };
        Self::discover_in_dir(&dir, lang, err_palette)
    }

    fn discover_in_dir(dir: &Path, lang: Lang, err_palette: Palette) -> Result<Self, String> {
        let path = dir.join(CTL_FILE_NAME);
        if !path.exists() {
            return Err(offline_error_message(
                lang,
                lang.tr("未找到 ctl.json", "ctl.json not found"),
                err_palette,
            ));
        }
        let content = std::fs::read_to_string(&path).map_err(|e| format!("failed to read {}: {e}", path.display()))?;
        let info: CtlDiscoveryInfo =
            serde_json::from_str(&content).map_err(|e| format!("invalid {}: {e}", path.display()))?;
        Ok(Self {
            port: info.port,
            token: info.token,
            pid: info.pid,
            lang,
            err_palette,
        })
    }

    fn get(&self, path: &str) -> Result<Value, String> {
        self.request("GET", path, None, Duration::from_secs(10))
    }

    fn post(&self, path: &str, body: &Value, timeout: Duration) -> Result<Value, String> {
        let payload = serde_json::to_string(body).map_err(|e| format!("failed to serialize request: {e}"))?;
        self.request("POST", path, Some(&payload), timeout)
    }

    fn request(&self, method: &str, path: &str, body: Option<&str>, timeout: Duration) -> Result<Value, String> {
        let addr = SocketAddr::from(([127, 0, 0, 1], self.port));
        let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(500)).map_err(|_| {
            offline_error_message(
                self.lang,
                self.lang
                    .tr("无法连接本地控制服务，主程序可能已退出", "control server unreachable"),
                self.err_palette,
            )
        })?;
        let _ = stream.set_read_timeout(Some(timeout));
        let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));

        let body_bytes = body.unwrap_or("").as_bytes();
        let req = format!(
            "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            self.port,
            self.token,
            body_bytes.len()
        );
        stream
            .write_all(req.as_bytes())
            .and_then(|_| stream.write_all(body_bytes))
            .map_err(|e| format!("failed to send control request: {e}"))?;

        let mut raw = String::new();
        stream
            .read_to_string(&mut raw)
            .map_err(|e| format!("failed to read control response: {e}"))?;

        let Some((_headers, body_str)) = raw.split_once("\r\n\r\n") else {
            return Err("malformed HTTP response from control server".to_string());
        };
        let env: ApiEnvelope =
            serde_json::from_str(body_str).map_err(|e| format!("invalid JSON response from control server: {e}"))?;
        if !env.ok {
            return Err(env.error.unwrap_or_else(|| "unknown control server error".to_string()));
        }
        Ok(env.data.unwrap_or(Value::Null))
    }
}

fn local_data_base_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library").join("Application Support"))
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local").join("share")))
    }
}

fn print_json(value: &Value) {
    if let Ok(pretty) = serde_json::to_string_pretty(value) {
        println!("{pretty}");
    }
}

#[cfg(windows)]
fn enable_windows_ansi() {
    use windows_sys::Win32::System::Console::{
        ENABLE_VIRTUAL_TERMINAL_PROCESSING, GetConsoleMode, GetStdHandle, STD_ERROR_HANDLE, STD_OUTPUT_HANDLE,
        SetConsoleMode,
    };
    for handle_id in [STD_OUTPUT_HANDLE, STD_ERROR_HANDLE] {
        // SAFETY: Best-effort console mode update on standard handles; failures are ignored.
        unsafe {
            let handle = GetStdHandle(handle_id);
            if handle.is_null() || handle == (-1isize as _) {
                continue;
            }
            let mut mode: u32 = 0;
            if GetConsoleMode(handle, &mut mode) != 0 && (mode & ENABLE_VIRTUAL_TERMINAL_PROCESSING) == 0 {
                let _ = SetConsoleMode(handle, mode | ENABLE_VIRTUAL_TERMINAL_PROCESSING);
            }
        }
    }
}

#[cfg(not(windows))]
fn enable_windows_ansi() {}

#[derive(Clone, Copy)]
struct Palette {
    enabled: bool,
}

impl Palette {
    fn new(no_color: bool) -> Self {
        let env_disabled = std::env::var_os("NO_COLOR").is_some();
        Self {
            enabled: !no_color && !env_disabled && std::io::stdout().is_terminal(),
        }
    }

    fn for_stderr(no_color: bool) -> Self {
        let env_disabled = std::env::var_os("NO_COLOR").is_some();
        Self {
            enabled: !no_color && !env_disabled && std::io::stderr().is_terminal(),
        }
    }

    #[cfg(test)]
    fn with_enabled(enabled: bool) -> Self {
        Self { enabled }
    }

    fn paint(&self, code: &str, text: &str) -> String {
        if self.enabled {
            format!("\x1b[{code}m{text}\x1b[0m")
        } else {
            text.to_string()
        }
    }

    fn bold(&self, text: &str) -> String {
        self.paint("1", text)
    }
    fn bold_cyan(&self, text: &str) -> String {
        self.paint("1;36", text)
    }
    fn bold_green(&self, text: &str) -> String {
        self.paint("1;32", text)
    }
    fn bold_yellow(&self, text: &str) -> String {
        self.paint("1;33", text)
    }
    fn bold_red(&self, text: &str) -> String {
        self.paint("1;31", text)
    }
    fn cyan(&self, text: &str) -> String {
        self.paint("36", text)
    }
    fn green(&self, text: &str) -> String {
        self.paint("32", text)
    }
    fn yellow(&self, text: &str) -> String {
        self.paint("33", text)
    }
    fn red(&self, text: &str) -> String {
        self.paint("31", text)
    }
    fn magenta(&self, text: &str) -> String {
        self.paint("35", text)
    }
    fn blue(&self, text: &str) -> String {
        self.paint("34", text)
    }
    fn dim(&self, text: &str) -> String {
        self.paint("2", text)
    }

    fn state_badge(&self, on: bool) -> String {
        if on {
            self.bold_green("● ON")
        } else {
            self.dim("○ OFF")
        }
    }

    fn delay_badge(&self, delay: Option<u64>, timeout_label: &str) -> String {
        match delay {
            Some(ms) if ms < 150 => self.green(&format!("{ms}ms")),
            Some(ms) if ms <= 400 => self.yellow(&format!("{ms}ms")),
            Some(ms) => self.red(&format!("{ms}ms")),
            None => self.dim(timeout_label),
        }
    }

    fn mode_status(&self, val: &Value) -> String {
        if val["enabled"].as_bool().unwrap_or(false) {
            match val["port"].as_u64() {
                Some(p) => format!("{} {}", self.bold_green("● ON"), self.cyan(&format!("(port {p})"))),
                None => self.bold_green("● ON"),
            }
        } else {
            self.dim("○ OFF")
        }
    }
}

/// Strips Regional Indicator flag code points (which Windows monospace terminals render as broken
/// overlapping half-letters) and trims leading whitespace for clean alignment.
fn clean_node_name(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .filter(|&ch| !('\u{1F1E6}'..='\u{1F1FF}').contains(&ch) && ch != '\u{FE0F}')
        .collect();
    cleaned.trim().to_string()
}

fn char_display_width(ch: char) -> usize {
    let cp = ch as u32;
    if cp == 0 || (0x0300..=0x036F).contains(&cp) || cp == 0x200D || cp == 0xFE0F {
        return 0;
    }
    let is_wide = matches!(
        cp,
        0x1100..=0x115F
            | 0x2329..=0x232A
            | 0x2E80..=0x303E
            | 0x3040..=0xA4CF
            | 0xAC00..=0xD7A3
            | 0xF900..=0xFAFF
            | 0xFE10..=0xFE19
            | 0xFE30..=0xFE6F
            | 0xFF00..=0xFF60
            | 0xFFE0..=0xFFE6
            | 0x1F300..=0x1F64F
            | 0x1F680..=0x1F6FF
            | 0x1F900..=0x1F9FF
            | 0x20000..=0x2FFFD
            | 0x30000..=0x3FFFD
    );
    if is_wide { 2 } else { 1 }
}

/// Computes visible terminal column width ignoring ANSI CSI escape sequences and counting CJK/wide chars as 2.
fn display_width(s: &str) -> usize {
    let mut width = 0usize;
    let mut chars = s.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\x1b' && chars.peek() == Some(&'[') {
            let _ = chars.next();
            for esc in chars.by_ref() {
                if ('@'..='~').contains(&esc) {
                    break;
                }
            }
            continue;
        }
        width += char_display_width(ch);
    }
    width
}

fn print_table(headers: &[&str], rows: &[Vec<String>], palette: Palette) {
    let mut widths: Vec<usize> = headers.iter().map(|h| display_width(h)).collect();
    for row in rows {
        for (i, cell) in row.iter().enumerate() {
            if i < widths.len() {
                widths[i] = widths[i].max(display_width(cell));
            }
        }
    }

    let format_row = |cols: &[String]| -> String {
        cols.iter()
            .enumerate()
            .map(|(i, c)| {
                let w = display_width(c);
                let pad = widths.get(i).copied().unwrap_or(0).saturating_sub(w);
                format!("{c}{}", " ".repeat(pad))
            })
            .collect::<Vec<_>>()
            .join("  ")
    };

    let header_cells: Vec<String> = headers.iter().map(|h| palette.bold_cyan(h)).collect();
    println!("{}", format_row(&header_cells));
    let sep_cells: Vec<String> = widths.iter().map(|w| palette.dim(&"─".repeat(*w))).collect();
    println!("{}", format_row(&sep_cells));
    for row in rows {
        println!("{}", format_row(row));
    }
}

fn copy_to_clipboard(text: &str) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("failed to access clipboard: {e}"))?;
    clipboard
        .set_text(text.to_string())
        .map_err(|e| format!("failed to write clipboard: {e}"))
}

fn render_init_script(shell: &str, alias: &str) -> Result<String, String> {
    match shell.trim().to_ascii_lowercase().as_str() {
        "pwsh" | "powershell" | "ps" => Ok(format!(
            "function {alias} {{\n  if ($args.Count -gt 0 -and $args[0] -eq 'env') {{\n    $cmd = & mihomo-multi-cli.exe @args --shell pwsh --eval\n    if ($LASTEXITCODE -eq 0 -and $cmd) {{ Invoke-Expression $cmd }}\n  }} else {{\n    & mihomo-multi-cli.exe @args\n  }}\n}}"
        )),
        "bash" | "zsh" | "sh" => Ok(format!(
            "{alias}() {{\n  if [ \"$1\" = \"env\" ]; then\n    local _cmd\n    _cmd=\"$(command mihomo-multi-cli \"$@\" --shell sh --eval)\" || return $?\n    eval \"$_cmd\"\n  else\n    command mihomo-multi-cli \"$@\"\n  fi\n}}"
        )),
        "cmd" | "bat" => Ok(
            "@echo off\r\nif /I \"%~1\"==\"env\" (\r\n  for /f \"usebackq delims=\" %%i in (`\"%~dp0mihomo-multi-cli.exe\" %* --shell cmd --eval`) do %%i\r\n  exit /b %ERRORLEVEL%\r\n)\r\n\"%~dp0mihomo-multi-cli.exe\" %*"
                .to_string(),
        ),
        other => Err(format!("unsupported shell '{other}'; expected pwsh, bash, zsh, or cmd")),
    }
}

fn parse_proxy_toggle_target(raw: &str) -> Result<(bool, Option<u16>), String> {
    if raw.eq_ignore_ascii_case("off") || raw.eq_ignore_ascii_case("disable") {
        return Ok((false, None));
    }
    let port = raw
        .parse::<u16>()
        .map_err(|_| format!("invalid target '{raw}'; expected a port number or 'off'"))?;
    Ok((true, Some(port)))
}

fn detect_current_shell() -> &'static str {
    let shell_env = std::env::var("SHELL").unwrap_or_default();
    if shell_env.ends_with("zsh") {
        return "zsh";
    }
    if !shell_env.is_empty() || std::env::var_os("MSYSTEM").is_some() {
        return "bash";
    }
    #[cfg(windows)]
    {
        if std::env::var_os("PSModulePath").is_some() {
            "pwsh"
        } else {
            "cmd"
        }
    }
    #[cfg(not(windows))]
    {
        "bash"
    }
}

fn run(cli: Cli) -> Result<(), String> {
    if let Commands::Init { shell, alias } = &cli.command {
        let resolved_shell = match shell.as_deref() {
            Some(s) => s,
            None => detect_current_shell(),
        };
        let script = render_init_script(resolved_shell, alias)?;
        if cli.json {
            print_json(&json!({ "shell": resolved_shell, "alias": alias, "script": script }));
        } else {
            println!("{script}");
        }
        return Ok(());
    }
    if matches!(cli.command, Commands::NsisInstall) {
        return run_nsis_install();
    }
    if matches!(cli.command, Commands::NsisUninstall) {
        return run_nsis_uninstall();
    }
    let lang = detect_lang(cli.lang.as_deref(), cli.data_dir.as_deref());
    let palette = Palette::new(cli.no_color);
    let err_palette = Palette::for_stderr(cli.no_color);
    if let Commands::Start {
        silent,
        no_wait,
        timeout,
    } = cli.command
    {
        return run_start(&cli, lang, &palette, silent, no_wait, timeout);
    }
    if let Commands::Stop { no_wait, timeout } = cli.command {
        return run_stop(&cli, lang, &palette, no_wait, timeout);
    }
    if let Commands::Update { check } = cli.command {
        return run_update(&cli, lang, &palette, check);
    }

    let client = CtlClient::discover(cli.data_dir.as_deref(), lang, err_palette)?;

    match cli.command {
        Commands::Start { .. } => unreachable!(),
        Commands::Stop { .. } => unreachable!(),
        Commands::Update { .. } => unreachable!(),
        Commands::Init { .. } => unreachable!(),
        Commands::NsisInstall | Commands::NsisUninstall => unreachable!(),
        Commands::Status => {
            let data = client.get("/v1/status")?;
            if cli.json {
                print_json(&data);
                return Ok(());
            }
            let running = data["coreRunning"].as_bool().unwrap_or(false);
            let pid = data["corePid"]
                .as_u64()
                .map(|p| p.to_string())
                .unwrap_or_else(|| "-".to_string());
            let enabled = data["enabledPorts"].as_u64().unwrap_or(0);
            let total = data["totalPorts"].as_u64().unwrap_or(0);
            let sp = palette.mode_status(&data["systemProxy"]);
            let tun = palette.mode_status(&data["tun"]);
            let env = palette.mode_status(&data["envProxy"]);
            let core_badge = if running {
                format!(
                    "{} {}",
                    palette.bold_green(&format!("● {}", lang.tr("运行中", "running"))),
                    palette.dim(&format!("(pid: {pid})"))
                )
            } else {
                palette.bold_red(&format!("○ {}", lang.tr("已停止", "stopped")))
            };

            let pad_label = |label: &str| -> String {
                let width: usize = label.chars().map(|c| if c.is_ascii() { 1 } else { 2 }).sum();
                let pad = 16usize.saturating_sub(width);
                palette.dim(&format!("{label}{}", " ".repeat(pad)))
            };
            println!(
                "{} {}",
                palette.bold_cyan(APP_DISPLAY_NAME),
                palette.cyan(&format!("v{}", data["version"].as_str().unwrap_or("-")))
            );
            println!("{}{core_badge}", pad_label(lang.tr("内核状态:", "Core:")));
            println!(
                "{}{} {}",
                pad_label(lang.tr("端口映射:", "Ports:")),
                palette.bold_cyan(&format!("{enabled}/{total}")),
                palette.dim(lang.tr("已启用", "enabled"))
            );
            println!("{}{sp}", pad_label(lang.tr("系统代理:", "System Proxy:")));
            println!("{}{tun}", pad_label(lang.tr("TUN 模式:", "TUN Mode:")));
            println!("{}{env}", pad_label(lang.tr("终端环境:", "Terminal Env:")));
        }
        Commands::Lang { target } => {
            if let Some(raw) = target {
                let Some(parsed) = Lang::parse(&raw) else {
                    return Err(lang
                        .tr(
                            &format!("不支持的语言 '{raw}'，请使用 zh-CN 或 en-US"),
                            &format!("unsupported language '{raw}'; use zh-CN or en-US"),
                        )
                        .to_string());
                };
                let data = client.post(
                    "/v1/lang",
                    &json!({ "language": parsed.code() }),
                    Duration::from_secs(5),
                )?;
                if cli.json {
                    print_json(&data);
                } else {
                    let code = data["language"].as_str().unwrap_or(parsed.code());
                    println!(
                        "{} {} {}",
                        palette.bold_green("✓"),
                        parsed.tr("语言已切换为:", "Language switched to:"),
                        palette.bold_cyan(code),
                    );
                }
            } else {
                let data = client.get("/v1/status")?;
                let current = data["language"].as_str().and_then(Lang::parse).unwrap_or(lang);
                if cli.json {
                    print_json(&json!({ "language": current.code() }));
                } else {
                    println!(
                        "{} {}",
                        palette.dim(current.tr("当前语言:", "Current language:")),
                        palette.bold_cyan(current.code()),
                    );
                }
            }
        }
        Commands::List => {
            let data = client.get("/v1/ports")?;
            if cli.json {
                print_json(&data);
                return Ok(());
            }
            let items = data.as_array().cloned().unwrap_or_default();
            if items.is_empty() {
                println!("{}", palette.yellow("No port mappings configured."));
                return Ok(());
            }
            let rows: Vec<Vec<String>> = items
                .iter()
                .map(|item| {
                    let m = &item["mapping"];
                    let port = palette.bold_cyan(&m["port"].as_u64().map(|p| p.to_string()).unwrap_or_default());
                    let proto = palette.magenta(&m["protocol"].as_str().unwrap_or("mixed").to_uppercase());
                    let state = palette.state_badge(m["enabled"].as_bool().unwrap_or(false));
                    let raw_node = clean_node_name(m["nodeName"].as_str().unwrap_or("-"));
                    let node = if raw_node == "DIRECT" {
                        palette.dim(&raw_node)
                    } else {
                        raw_node
                    };
                    let delay = palette.delay_badge(item["delay"].as_u64(), "-");
                    let mut flags = Vec::new();
                    if item["isSystemProxy"].as_bool().unwrap_or(false) {
                        flags.push(palette.blue("SYS"));
                    }
                    if item["isTun"].as_bool().unwrap_or(false) {
                        flags.push(palette.magenta("TUN"));
                    }
                    if item["isEnvProxy"].as_bool().unwrap_or(false) {
                        flags.push(palette.green("ENV"));
                    }
                    if flags.is_empty() {
                        flags.push(palette.dim("LISTEN"));
                    }
                    vec![port, proto, state, node, delay, flags.join(" ")]
                })
                .collect();
            print_table(&["PORT", "PROTO", "STATE", "NODE", "DELAY", "MODE"], &rows, palette);
        }
        Commands::Enable { port } => {
            let data = client.post(&format!("/v1/ports/{port}/enable"), &json!({}), Duration::from_secs(15))?;
            if cli.json {
                print_json(&data);
            } else {
                println!(
                    "{} Port {} {}.",
                    palette.bold_green("✓"),
                    palette.bold_cyan(&port.to_string()),
                    palette.green("enabled"),
                );
            }
        }
        Commands::Disable { port } => {
            let data = client.post(
                &format!("/v1/ports/{port}/disable"),
                &json!({}),
                Duration::from_secs(15),
            )?;
            if cli.json {
                print_json(&data);
            } else {
                println!(
                    "{} Port {} {}.",
                    palette.yellow("○"),
                    palette.bold_cyan(&port.to_string()),
                    palette.yellow("disabled"),
                );
            }
        }
        Commands::Sub { action } => match action {
            SubAction::List => {
                let data = client.get("/v1/subs")?;
                if cli.json {
                    print_json(&data);
                    return Ok(());
                }
                let items = data.as_array().cloned().unwrap_or_default();
                if items.is_empty() {
                    println!("{}", palette.yellow("No subscriptions configured."));
                    return Ok(());
                }
                let rows: Vec<Vec<String>> = items
                    .iter()
                    .map(|p| {
                        let name = palette.bold(p["name"].as_str().unwrap_or("-"));
                        let state = palette.state_badge(p["enabled"].as_bool().unwrap_or(false));
                        let count = palette.cyan(&p["nodeCount"].as_u64().unwrap_or(0).to_string());
                        let updated = palette.dim(&format_timestamp(p["lastUpdatedAt"].as_u64()));
                        vec![name, state, count, updated]
                    })
                    .collect();
                print_table(&["NAME", "STATE", "NODES", "UPDATED"], &rows, palette);
            }
            SubAction::Update { target, all } => {
                let data = client.post(
                    "/v1/subs/update",
                    &json!({ "target": target, "all": all }),
                    Duration::from_secs(60),
                )?;
                if cli.json {
                    print_json(&data);
                    return Ok(());
                }
                let updated = data["updated"].as_array().map(|a| a.len()).unwrap_or(0);
                let errors = data["errors"].as_array().cloned().unwrap_or_default();
                println!(
                    "{} Updated {} subscription(s).",
                    palette.bold_green("✓"),
                    palette.bold_cyan(&updated.to_string()),
                );
                for err in errors {
                    eprintln!(
                        "  {} {}: {}",
                        err_palette.bold_red("[FAILED]"),
                        err_palette.yellow(err["name"].as_str().unwrap_or("-")),
                        err_palette.red(err["error"].as_str().unwrap_or("unknown error")),
                    );
                }
            }
        },
        Commands::Node { action } => match action {
            NodeAction::List { sub, query, available } => {
                let mut params = Vec::new();
                if let Some(s) = &sub {
                    params.push(format!("sub={}", urlencoding::encode(s)));
                }
                if let Some(q) = &query {
                    params.push(format!("q={}", urlencoding::encode(q)));
                }
                let path = if params.is_empty() {
                    "/v1/nodes".to_string()
                } else {
                    format!("/v1/nodes?{}", params.join("&"))
                };
                let data = client.get(&path)?;
                let mut items = data.as_array().cloned().unwrap_or_default();
                if available {
                    items.retain(|n| n["delay"].as_u64().is_some_and(|d| d > 0));
                }
                if cli.json {
                    print_json(&Value::Array(items));
                    return Ok(());
                }
                if items.is_empty() {
                    println!(
                        "{}",
                        palette.yellow(if available {
                            "No available nodes found."
                        } else {
                            "No nodes found."
                        })
                    );
                    return Ok(());
                }
                let rows: Vec<Vec<String>> = items
                    .iter()
                    .enumerate()
                    .map(|(i, n)| {
                        let idx = palette.dim(&n["index"].as_u64().unwrap_or((i + 1) as u64).to_string());
                        let name = clean_node_name(n["name"].as_str().unwrap_or("-"));
                        let proto = palette.magenta(n["protocol"].as_str().unwrap_or("-"));
                        let sub_name = palette.cyan(n["profileName"].as_str().unwrap_or("-"));
                        let delay = palette.delay_badge(n["delay"].as_u64(), "-");
                        vec![idx, name, proto, sub_name, delay]
                    })
                    .collect();
                print_table(&["#", "NODE", "PROTO", "SUBSCRIPTION", "DELAY"], &rows, palette);
            }
        },
        Commands::Test {
            target,
            url,
            timeout,
            action,
        } => match action {
            None => {
                let Some(name) = target else {
                    return Err(
                        "missing target; use `mm test <index|node>`, `mm test node <index|node>`, or `mm test sub [name]`"
                            .to_string(),
                    );
                };
                let data = client.post(
                    "/v1/test/node",
                    &json!({ "node": name, "testUrl": url, "timeoutMs": timeout }),
                    Duration::from_secs(30),
                )?;
                if cli.json {
                    print_json(&data);
                } else {
                    let node = clean_node_name(data["node"].as_str().unwrap_or("-"));
                    let delay = palette.delay_badge(data["delay"].as_u64(), "timeout");
                    println!("{}: {delay}", palette.bold_cyan(&node));
                }
            }
            Some(TestAction::Node { name, url, timeout }) => {
                let data = client.post(
                    "/v1/test/node",
                    &json!({ "node": name, "testUrl": url, "timeoutMs": timeout }),
                    Duration::from_secs(30),
                )?;
                if cli.json {
                    print_json(&data);
                } else {
                    let node = clean_node_name(data["node"].as_str().unwrap_or("-"));
                    let delay = palette.delay_badge(data["delay"].as_u64(), "timeout");
                    println!("{}: {delay}", palette.bold_cyan(&node));
                }
            }
            Some(TestAction::Sub {
                target,
                all,
                url,
                timeout,
            }) => {
                let data = client.post(
                    "/v1/test/sub",
                    &json!({ "target": target, "all": all, "testUrl": url, "timeoutMs": timeout }),
                    Duration::from_secs(120),
                )?;
                if cli.json {
                    print_json(&data);
                    return Ok(());
                }
                let mut pairs: Vec<(String, Option<u64>)> = data
                    .as_object()
                    .map(|obj| obj.iter().map(|(k, v)| (k.clone(), v.as_u64())).collect())
                    .unwrap_or_default();
                pairs.sort_by_key(|(_, d)| d.unwrap_or(u64::MAX));
                let rows: Vec<Vec<String>> = pairs
                    .into_iter()
                    .map(|(name, d)| vec![clean_node_name(&name), palette.delay_badge(d, "timeout")])
                    .collect();
                print_table(&["NODE", "DELAY"], &rows, palette);
            }
        },
        Commands::Sysproxy { target } => {
            let data = match target {
                None => client.get("/v1/sysproxy")?,
                Some(raw) => {
                    let (enabled, port) = parse_proxy_toggle_target(&raw)?;
                    client.post(
                        "/v1/sysproxy",
                        &json!({ "enabled": enabled, "port": port }),
                        Duration::from_secs(15),
                    )?
                }
            };
            if cli.json {
                print_json(&data);
            } else {
                println!("{} {}", palette.dim("System Proxy:"), palette.mode_status(&data));
            }
        }
        Commands::Tun { target } => {
            let data = match target {
                None => client.get("/v1/tun")?,
                Some(raw) => {
                    let (enabled, port) = parse_proxy_toggle_target(&raw)?;
                    client.post(
                        "/v1/tun",
                        &json!({ "enabled": enabled, "port": port }),
                        Duration::from_secs(15),
                    )?
                }
            };
            if cli.json {
                print_json(&data);
            } else {
                println!("{} {}", palette.dim("TUN Mode:"), palette.mode_status(&data));
            }
        }
        Commands::Env(args) => {
            if args.current {
                let shell_str = match args.shell.as_deref() {
                    Some(s) => s,
                    None => detect_current_shell(),
                };
                let shell_kind = mihomo_multi_lib::core::cli_format::ShellKind::parse(shell_str)
                    .ok_or_else(|| format!("unsupported shell: {shell_str}"))?;
                let cmd = if let Some(port) = args.port {
                    let copy_data = client.get(&format!(
                        "/v1/copy?port={port}&format=env&shell={}",
                        urlencoding::encode(shell_str)
                    ))?;
                    copy_data["text"].as_str().unwrap_or("").to_string()
                } else {
                    mihomo_multi_lib::core::cli_format::build_env_unset_command(shell_kind)
                };
                if cli.json {
                    print_json(&json!({
                        "currentOnly": true,
                        "enabled": args.port.is_some(),
                        "port": args.port,
                        "shell": shell_str,
                        "command": cmd,
                    }));
                    return Ok(());
                }
                if let Some(port) = args.port {
                    eprintln!(
                        "{} {} {}",
                        err_palette.dim("Current Shell Env:"),
                        err_palette.bold_green("● ON"),
                        err_palette.cyan(&format!("(port {port})")),
                    );
                } else {
                    eprintln!("{} {}", err_palette.dim("Current Shell Env:"), err_palette.dim("○ OFF"));
                }
                println!("{cmd}");
                return Ok(());
            }
            let enabled = args.port.is_some();
            let data = client.post(
                "/v1/env",
                &json!({ "enabled": enabled, "port": args.port, "shell": args.shell }),
                Duration::from_secs(15),
            )?;
            if cli.json {
                print_json(&data);
                return Ok(());
            }
            let cmd = data["command"].as_str().unwrap_or("");
            let status = err_palette.mode_status(&data["status"]);
            eprintln!("{} {status}", err_palette.dim("Terminal Env:"));
            println!("{cmd}");
        }
        Commands::Ip { port, copy, timeout } => {
            let data = client.post(
                "/v1/ip",
                &json!({ "port": port, "timeoutMs": timeout }),
                Duration::from_secs(30),
            )?;
            let ip = data["ip"].as_str().unwrap_or("").to_string();
            if copy && !ip.is_empty() {
                copy_to_clipboard(&ip)?;
            }
            if cli.json {
                print_json(&data);
                return Ok(());
            }
            let location = data["location"].as_str().unwrap_or("-");
            let country = data["countryCode"].as_str().unwrap_or("-");
            if copy {
                println!(
                    "{} {} {}",
                    palette.bold_cyan(&ip),
                    palette.dim(&format!("({country} / {location})")),
                    palette.bold_green("[copied]"),
                );
            } else {
                println!(
                    "{} {}",
                    palette.bold_cyan(&ip),
                    palette.dim(&format!("({country} / {location})")),
                );
            }
        }
        Commands::Copy {
            port,
            format,
            print,
            shell,
        } => {
            let mut query = format!("port={port}");
            if let Some(fmt) = &format {
                query.push_str(&format!("&format={}", urlencoding::encode(fmt)));
            }
            if let Some(sh) = &shell {
                query.push_str(&format!("&shell={}", urlencoding::encode(sh)));
            }
            let data = client.get(&format!("/v1/copy?{query}"))?;
            if cli.json {
                print_json(&data);
                return Ok(());
            }
            if format.is_some() {
                let val = data["value"].as_str().unwrap_or("");
                if !print {
                    copy_to_clipboard(val)?;
                    eprintln!("{}", err_palette.green("✓ Copied to clipboard:"));
                }
                println!("{val}");
            } else {
                let items = data.as_array().cloned().unwrap_or_default();
                let rows: Vec<Vec<String>> = items
                    .iter()
                    .map(|item| {
                        vec![
                            palette.cyan(item["format"].as_str().unwrap_or("-")),
                            item["value"].as_str().unwrap_or("").to_string(),
                        ]
                    })
                    .collect();
                print_table(&["FORMAT", "VALUE"], &rows, palette);
            }
        }
    }

    Ok(())
}

fn resolve_release_alias(cli_dir: &Path) -> String {
    if let Ok(marker) = std::fs::read_to_string(cli_dir.join(".mihomo-multi-cli-alias")) {
        let trimmed = marker.trim();
        if mihomo_multi_lib::core::cli_manager::validate_cli_alias(trimmed).is_ok() {
            return trimmed.to_string();
        }
    }
    if let Some(base) = local_data_base_dir() {
        let cfg_path = base.join(APP_IDENTIFIER).join("config.json");
        if let Ok(raw) = std::fs::read_to_string(cfg_path)
            && let Ok(val) = serde_json::from_str::<Value>(&raw)
            && let Some(alias) = val["cliAlias"].as_str()
            && mihomo_multi_lib::core::cli_manager::validate_cli_alias(alias).is_ok()
        {
            return alias.to_string();
        }
    }
    "mm".to_string()
}

fn run_nsis_install() -> Result<(), String> {
    let source = std::env::current_exe().map_err(|e| format!("failed to locate current exe: {e}"))?;
    let cli_dir = mihomo_multi_lib::core::cli_manager::resolve_cli_dir()?;
    let alias = resolve_release_alias(&cli_dir);
    mihomo_multi_lib::core::cli_manager::sync_cli_in_dir(&cli_dir, &source, &alias)?;
    mihomo_multi_lib::core::cli_manager::register_cli_path(&cli_dir)?;
    if let Some(inst_dir) = source.parent() {
        let app_exe = inst_dir.join(APP_BIN_NAME);
        if app_exe.is_file()
            && let Some(base) = local_data_base_dir()
        {
            mihomo_multi_lib::core::cli_manager::write_app_exe_metadata(&base.join(APP_IDENTIFIER), &app_exe);
        }
    }
    Ok(())
}

fn run_nsis_uninstall() -> Result<(), String> {
    let cli_dir = mihomo_multi_lib::core::cli_manager::resolve_cli_dir()?;
    let alias = resolve_release_alias(&cli_dir);
    mihomo_multi_lib::core::cli_manager::unregister_cli_path(&cli_dir, &alias)?;
    if let Some(base) = local_data_base_dir() {
        mihomo_multi_lib::core::cli_manager::remove_app_exe_metadata(&base.join(APP_IDENTIFIER));
    }
    Ok(())
}

fn main() -> ExitCode {
    enable_windows_ansi();
    let pre_lang = pre_scan_arg("--lang");
    let pre_data_dir = pre_scan_arg("--data-dir").map(PathBuf::from);
    let pre_no_color = std::env::args().skip(1).any(|a| a == "--no-color");
    let lang = detect_lang(pre_lang.as_deref(), pre_data_dir.as_deref());
    let matches = localize_command(Cli::command(), lang).get_matches();
    let cli = Cli::from_arg_matches(&matches).unwrap_or_else(|e| e.exit());
    let err_palette = Palette::for_stderr(cli.no_color || pre_no_color);
    match run(cli) {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("{} {err}", err_palette.bold_red("error:"));
            ExitCode::FAILURE
        }
    }
}

fn format_timestamp(ts: Option<u64>) -> String {
    let Some(raw) = ts.filter(|&v| v > 0) else {
        return "-".to_string();
    };
    let secs = if raw > 10_000_000_000 { raw / 1000 } else { raw } as i64;
    chrono::DateTime::from_timestamp(secs, 0)
        .map(|dt| dt.with_timezone(&chrono::Local).format("%Y-%m-%d %H:%M:%S").to_string())
        .unwrap_or_else(|| "-".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_core_subcommands() {
        let cli = Cli::try_parse_from(["mm", "list", "--json"]).expect("parse list");
        assert!(cli.json);
        assert!(matches!(cli.command, Commands::List));

        let cli = Cli::try_parse_from(["mm", "sub", "list"]).expect("parse sub list");
        assert!(matches!(
            cli.command,
            Commands::Sub {
                action: SubAction::List
            }
        ));

        let cli = Cli::try_parse_from(["mm", "env", "17890", "--eval"]).expect("parse env set");
        match cli.command {
            Commands::Env(args) => {
                assert_eq!(args.port, Some(17890));
                assert!(args.eval);
            }
            other => panic!("unexpected command: {other:?}"),
        }

        let cli = Cli::try_parse_from(["mm", "env"]).expect("parse env clear");
        match cli.command {
            Commands::Env(args) => assert_eq!(args.port, None),
            other => panic!("unexpected command: {other:?}"),
        }
    }

    #[test]
    fn renders_init_scripts_for_all_shells() {
        let pwsh = render_init_script("pwsh", "px").expect("pwsh init");
        assert!(pwsh.contains("function px"));
        assert!(pwsh.contains("--shell pwsh --eval"));

        let zsh = render_init_script("zsh", "px").expect("zsh init");
        assert!(zsh.contains("px()"));
        assert!(zsh.contains("--shell sh --eval"));

        let cmd = render_init_script("cmd", "px").expect("cmd init");
        assert!(cmd.contains("--shell cmd --eval"));
    }

    #[test]
    fn parses_proxy_toggle_targets() {
        assert_eq!(parse_proxy_toggle_target("off"), Ok((false, None)));
        assert_eq!(parse_proxy_toggle_target("17890"), Ok((true, Some(17890))));
        assert!(parse_proxy_toggle_target("invalid").is_err());
    }

    #[test]
    fn display_width_handles_cjk_and_ansi() {
        assert_eq!(display_width("DIRECT"), 6);
        assert_eq!(display_width("香港S01"), 7);
        assert_eq!(display_width("\x1b[32m● ON\x1b[0m"), 4);
        assert_eq!(display_width("\x1b[36m新加坡S03\x1b[0m"), 9);
    }

    #[test]
    fn clean_node_name_strips_regional_indicator_flags() {
        assert_eq!(clean_node_name("🇸🇬 新加坡S03 | IEPL"), "新加坡S03 | IEPL");
        assert_eq!(clean_node_name("🇭🇰 香港S01"), "香港S01");
        assert_eq!(clean_node_name("DIRECT"), "DIRECT");
    }

    #[test]
    fn parses_start_subcommand_flags() {
        let cli = Cli::try_parse_from(["mm", "start"]).expect("parse start default");
        match cli.command {
            Commands::Start {
                silent,
                no_wait,
                timeout,
            } => {
                assert!(!silent);
                assert!(!no_wait);
                assert_eq!(timeout, DEFAULT_START_TIMEOUT_SECS);
            }
            other => panic!("unexpected command: {other:?}"),
        }

        let cli =
            Cli::try_parse_from(["mm", "start", "-s", "--no-wait", "--timeout", "30"]).expect("parse start with flags");
        match cli.command {
            Commands::Start {
                silent,
                no_wait,
                timeout,
            } => {
                assert!(silent);
                assert!(no_wait);
                assert_eq!(timeout, 30);
            }
            other => panic!("unexpected command: {other:?}"),
        }
    }

    #[test]
    fn resolves_app_data_dir_with_strict_env_isolation() {
        let base = PathBuf::from("local-data");
        assert_eq!(
            resolve_app_data_dir_with(None, None, Some(&base), true),
            Some(base.join(DEV_APP_IDENTIFIER))
        );
        assert_eq!(
            resolve_app_data_dir_with(None, None, Some(&base), false),
            Some(base.join(APP_IDENTIFIER))
        );

        let custom = PathBuf::from("custom-dir");
        let env_dir = PathBuf::from("env-dir");
        assert_eq!(
            resolve_app_data_dir_with(Some(&custom), Some(&env_dir), Some(&base), true),
            Some(custom)
        );
        assert_eq!(
            resolve_app_data_dir_with(None, Some(&env_dir), Some(&base), false),
            Some(env_dir)
        );
    }

    #[test]
    fn discover_in_dir_requires_target_ctl_and_never_falls_back() {
        let root = std::env::temp_dir().join(format!("mhm-cli-iso-{}", uuid::Uuid::new_v4()));
        let dev_dir = root.join(DEV_APP_IDENTIFIER);
        let prod_dir = root.join(APP_IDENTIFIER);
        std::fs::create_dir_all(&dev_dir).expect("create dev dir");
        std::fs::create_dir_all(&prod_dir).expect("create prod dir");
        std::fs::write(
            prod_dir.join(CTL_FILE_NAME),
            r#"{"port":61568,"token":"prod-token","pid":123,"version":"1.6.8"}"#,
        )
        .expect("write prod ctl.json");

        let err = CtlClient::discover_in_dir(&dev_dir, Lang::Zh, Palette::with_enabled(false))
            .err()
            .expect("dev missing ctl");
        assert!(err.contains("ctl.json"));

        let prod =
            CtlClient::discover_in_dir(&prod_dir, Lang::En, Palette::with_enabled(false)).expect("prod ctl present");
        assert_eq!(prod.port, 61568);
        assert_eq!(prod.token, "prod-token");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn unreachable_ctl_reports_localized_colored_offline_error() {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).expect("bind ephemeral port");
        let dead_port = listener.local_addr().expect("addr").port();
        drop(listener);

        let client = CtlClient {
            port: dead_port,
            token: "dead".to_string(),
            pid: None,
            lang: Lang::Zh,
            err_palette: Palette::with_enabled(true),
        };
        let err = client.get("/v1/status").expect_err("dead server should error");
        assert!(err.contains("主程序未运行"));
        assert!(err.contains(&format!("\x1b[1;32m`{DEFAULT_CLI_ALIAS} start`\x1b[0m")));
    }

    #[test]
    fn resolves_dev_workspace_root_from_dev_dir() {
        let root = std::env::temp_dir().join(format!("mhm-cli-ws-{}", uuid::Uuid::new_v4()));
        let nested = root.join("src-tauri").join("src");
        std::fs::create_dir_all(&nested).expect("create nested dir");
        std::fs::write(root.join("package.json"), "{}").expect("write package.json");
        std::fs::write(root.join("src-tauri").join("tauri.dev.conf.json"), "{}").expect("write tauri.dev.conf.json");

        assert!(is_dev_workspace_root(&root));
        let found = find_dev_workspace_root_from(&nested).expect("find workspace root");
        assert_eq!(found, root);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn resolves_app_executable_from_sibling_or_metadata() {
        let root = std::env::temp_dir().join(format!("mhm-cli-exe-{}", uuid::Uuid::new_v4()));
        let bin_dir = root.join("bin");
        let data_dir = root.join("data");
        std::fs::create_dir_all(&bin_dir).expect("create bin dir");
        std::fs::create_dir_all(&data_dir).expect("create data dir");

        let cli_exe = bin_dir.join(if cfg!(windows) {
            "mihomo-multi-cli.exe"
        } else {
            "mihomo-multi-cli"
        });
        let sibling_app = bin_dir.join(APP_BIN_NAME);
        std::fs::write(&cli_exe, b"cli").expect("write cli");
        std::fs::write(&sibling_app, b"app").expect("write sibling app");

        let resolved = resolve_app_executable_from(Some(&cli_exe), Some(&data_dir), true).expect("sibling resolved");
        assert_eq!(
            std::fs::canonicalize(&resolved).expect("canon"),
            std::fs::canonicalize(&sibling_app).expect("canon")
        );

        std::fs::remove_file(&sibling_app).expect("remove sibling");
        let meta_app = root.join("installed").join(APP_BIN_NAME);
        std::fs::create_dir_all(meta_app.parent().expect("parent")).expect("create installed dir");
        std::fs::write(&meta_app, b"installed-app").expect("write meta app");
        mihomo_multi_lib::core::cli_manager::write_app_exe_metadata(&data_dir, &meta_app);

        let resolved_meta =
            resolve_app_executable_from(Some(&cli_exe), Some(&data_dir), false).expect("metadata resolved");
        assert_eq!(resolved_meta, meta_app);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn parses_stop_subcommand_flags() {
        let cli = Cli::try_parse_from(["mm", "stop"]).expect("parse stop default");
        match cli.command {
            Commands::Stop { no_wait, timeout } => {
                assert!(!no_wait);
                assert_eq!(timeout, 10);
            }
            other => panic!("unexpected command: {other:?}"),
        }

        let cli = Cli::try_parse_from(["mm", "stop", "--no-wait", "--timeout", "20"]).expect("parse stop with flags");
        match cli.command {
            Commands::Stop { no_wait, timeout } => {
                assert!(no_wait);
                assert_eq!(timeout, 20);
            }
            other => panic!("unexpected command: {other:?}"),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Lang {
    Zh,
    En,
}

impl Lang {
    fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "zh" | "zh-cn" | "zh_cn" | "zh-hans" => Some(Self::Zh),
            "en" | "en-us" | "en_us" => Some(Self::En),
            _ => None,
        }
    }

    fn code(self) -> &'static str {
        match self {
            Self::Zh => "zh-CN",
            Self::En => "en-US",
        }
    }

    fn tr<'a>(self, zh: &'a str, en: &'a str) -> &'a str {
        match self {
            Self::Zh => zh,
            Self::En => en,
        }
    }
}

fn detect_lang(cli_lang: Option<&str>, data_dir: Option<&Path>) -> Lang {
    if let Some(raw) = cli_lang
        && let Some(l) = Lang::parse(raw)
    {
        return l;
    }
    if let Ok(raw) = std::env::var("MM_LANG")
        && let Some(l) = Lang::parse(&raw)
    {
        return l;
    }
    if let Some(dir) = resolve_app_data_dir(data_dir) {
        let path = dir.join("config.json");
        if let Ok(content) = std::fs::read_to_string(path)
            && let Ok(val) = serde_json::from_str::<serde_json::Value>(&content)
            && let Some(raw) = val["language"].as_str()
            && let Some(l) = Lang::parse(raw)
        {
            return l;
        }
    }
    for key in ["LC_ALL", "LANG"] {
        if let Ok(raw) = std::env::var(key) {
            if raw.to_ascii_lowercase().starts_with("zh") {
                return Lang::Zh;
            }
            if raw.to_ascii_lowercase().starts_with("en") {
                return Lang::En;
            }
        }
    }
    Lang::En
}

fn pre_scan_arg(flag: &str) -> Option<String> {
    let mut args = std::env::args().skip(1);
    let prefix = format!("{flag}=");
    while let Some(arg) = args.next() {
        if arg == flag {
            return args.next();
        }
        if let Some(val) = arg.strip_prefix(&prefix) {
            return Some(val.to_string());
        }
    }
    None
}

fn is_dev_workspace_root(dir: &Path) -> bool {
    dir.join("package.json").is_file() && dir.join("src-tauri").join("tauri.dev.conf.json").is_file()
}

fn find_dev_workspace_root_from(start: &Path) -> Option<PathBuf> {
    start
        .ancestors()
        .find(|p| is_dev_workspace_root(p))
        .map(Path::to_path_buf)
}

fn resolve_dev_workspace_root(lang: Lang) -> Result<PathBuf, String> {
    if let Ok(cwd) = std::env::current_dir()
        && let Some(found) = find_dev_workspace_root_from(&cwd)
    {
        return Ok(found);
    }
    if let Some(manifest_dir) = option_env!("CARGO_MANIFEST_DIR")
        && let Some(repo_root) = Path::new(manifest_dir).parent()
        && is_dev_workspace_root(repo_root)
    {
        return Ok(repo_root.to_path_buf());
    }
    Err(lang
        .tr(
            "未找到开发工作区根目录（缺少 package.json 或 src-tauri/tauri.dev.conf.json）。",
            "Could not locate the development workspace root (missing package.json or src-tauri/tauri.dev.conf.json).",
        )
        .to_string())
}

fn collect_app_exe_candidates(
    current_cli_exe: Option<&Path>,
    app_data_dir: Option<&Path>,
    is_dev: bool,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(cli_exe) = current_cli_exe {
        let resolved = std::fs::canonicalize(cli_exe).unwrap_or_else(|_| cli_exe.to_path_buf());
        if let Some(cli_dir) = resolved.parent() {
            candidates.push(cli_dir.join(APP_BIN_NAME));
            #[cfg(target_os = "macos")]
            if let Some(contents_dir) = cli_dir.parent() {
                candidates.push(contents_dir.join("MacOS").join(APP_BIN_NAME));
            }
        }
    }

    if let Some(dir) = app_data_dir
        && let Some(recorded) = mihomo_multi_lib::core::cli_manager::read_app_exe_metadata(dir)
    {
        candidates.push(recorded);
    }

    if is_dev {
        if let Some(manifest_dir) = option_env!("CARGO_MANIFEST_DIR") {
            candidates.push(Path::new(manifest_dir).join("target").join("debug").join(APP_BIN_NAME));
        }
    } else {
        #[cfg(windows)]
        {
            if let Some(reg_exe) = mihomo_multi_lib::core::cli_manager::read_windows_installed_app_exe() {
                candidates.push(reg_exe);
            }
            for env_key in ["ProgramFiles", "ProgramW6432"] {
                if let Some(dir) = std::env::var_os(env_key) {
                    candidates.push(PathBuf::from(dir).join("Mihomo Multi").join(APP_BIN_NAME));
                }
            }
            if let Some(local) = std::env::var_os("LOCALAPPDATA") {
                candidates.push(
                    PathBuf::from(local)
                        .join("Programs")
                        .join("Mihomo Multi")
                        .join(APP_BIN_NAME),
                );
            }
        }
        #[cfg(target_os = "macos")]
        {
            candidates.push(PathBuf::from("/Applications/Mihomo Multi.app/Contents/MacOS").join(APP_BIN_NAME));
            if let Some(home) = std::env::var_os("HOME") {
                candidates.push(
                    PathBuf::from(home)
                        .join("Applications/Mihomo Multi.app/Contents/MacOS")
                        .join(APP_BIN_NAME),
                );
            }
        }
        #[cfg(all(unix, not(target_os = "macos")))]
        {
            candidates.push(PathBuf::from("/usr/bin").join(APP_BIN_NAME));
            candidates.push(PathBuf::from("/usr/local/bin").join(APP_BIN_NAME));
        }
    }

    candidates
}

fn resolve_app_executable_from(
    current_cli_exe: Option<&Path>,
    app_data_dir: Option<&Path>,
    is_dev: bool,
) -> Option<PathBuf> {
    collect_app_exe_candidates(current_cli_exe, app_data_dir, is_dev)
        .into_iter()
        .find(|p| p.is_file())
}

fn resolve_app_executable(override_dir: Option<&Path>, lang: Lang) -> Result<PathBuf, String> {
    let current_exe = std::env::current_exe().ok();
    let app_dir = resolve_app_data_dir(override_dir);
    resolve_app_executable_from(current_exe.as_deref(), app_dir.as_deref(), cfg!(debug_assertions)).ok_or_else(|| {
        lang.tr(
            &format!("未找到 {APP_DISPLAY_NAME} 主程序可执行文件，请确认当前环境对应的主程序已安装或已构建。"),
            &format!("Could not locate the {APP_DISPLAY_NAME} executable for this environment."),
        )
        .to_string()
    })
}

fn configure_detached_process(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        cmd.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
}

fn spawn_detached_app(app_exe: &Path, silent: bool) -> Result<std::process::Child, String> {
    let mut cmd = Command::new(app_exe);
    if silent {
        cmd.arg("--silent");
    }
    if let Some(parent) = app_exe.parent() {
        cmd.current_dir(parent);
    }
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    configure_detached_process(&mut cmd);

    cmd.spawn()
        .map_err(|e| format!("failed to launch {}: {e}", app_exe.display()))
}

fn open_dev_start_log(app_data_dir: Option<&Path>) -> (Option<PathBuf>, Stdio, Stdio) {
    if let Some(dir) = app_data_dir {
        let _ = std::fs::create_dir_all(dir);
        let log_path = dir.join("dev-start.log");
        if let Ok(stdout_file) = std::fs::File::create(&log_path)
            && let Ok(stderr_file) = stdout_file.try_clone()
        {
            return (Some(log_path), Stdio::from(stdout_file), Stdio::from(stderr_file));
        }
    }
    (None, Stdio::null(), Stdio::null())
}

fn read_log_tail(path: &Path, max_lines: usize) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    let lines: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();
    if lines.is_empty() {
        return None;
    }
    let start = lines.len().saturating_sub(max_lines);
    Some(lines[start..].join("\n"))
}

fn spawn_dev_tauri_process(
    repo_root: &Path,
    app_data_dir: Option<&Path>,
    silent: bool,
) -> Result<(std::process::Child, Option<PathBuf>), String> {
    let tauri_js = repo_root
        .join("node_modules")
        .join("@tauri-apps")
        .join("cli")
        .join("tauri.js");
    let tauri_args = ["dev", "-c", "src-tauri/tauri.dev.conf.json"];

    let mut launcher_attempts: Vec<(&str, Vec<String>)> = Vec::new();
    if tauri_js.is_file() {
        let tauri_js_str = tauri_js.to_string_lossy().into_owned();
        for runtime in ["node", "bun"] {
            let mut args = vec![tauri_js_str.clone()];
            args.extend(tauri_args.iter().map(|s| (*s).to_string()));
            if silent {
                args.extend(["--".to_string(), "--".to_string(), "--silent".to_string()]);
            }
            launcher_attempts.push((runtime, args));
        }
    } else {
        let mut bun_args = vec!["x".to_string(), "tauri".to_string()];
        bun_args.extend(tauri_args.iter().map(|s| (*s).to_string()));
        if silent {
            bun_args.extend(["--".to_string(), "--".to_string(), "--silent".to_string()]);
        }
        launcher_attempts.push(("bun", bun_args));
    }

    let (log_path, stdout_io, stderr_io) = open_dev_start_log(app_data_dir);
    let mut last_not_found = None;
    let attempts_len = launcher_attempts.len();
    let mut stdout_opt = Some(stdout_io);
    let mut stderr_opt = Some(stderr_io);

    for (idx, (program, args)) in launcher_attempts.into_iter().enumerate() {
        let mut cmd = Command::new(program);
        cmd.args(&args).current_dir(repo_root).stdin(Stdio::null());
        if idx + 1 == attempts_len {
            cmd.stdout(stdout_opt.take().unwrap_or_else(Stdio::null))
                .stderr(stderr_opt.take().unwrap_or_else(Stdio::null));
        } else if let Some(path) = &log_path
            && let Ok(f_out) = std::fs::File::create(path)
            && let Ok(f_err) = f_out.try_clone()
        {
            cmd.stdout(Stdio::from(f_out)).stderr(Stdio::from(f_err));
        } else {
            cmd.stdout(Stdio::null()).stderr(Stdio::null());
        }
        configure_detached_process(&mut cmd);

        match cmd.spawn() {
            Ok(child) => return Ok((child, log_path)),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                last_not_found = Some(format!("{program}: {err}"));
            }
            Err(err) => return Err(format!("failed to start dev server via {program}: {err}")),
        }
    }

    Err(format!(
        "could not find node or bun to start Tauri dev ({})",
        last_not_found.unwrap_or_else(|| "launcher not found".to_string())
    ))
}

fn run_start(
    cli: &Cli,
    lang: Lang,
    palette: &Palette,
    silent: bool,
    no_wait: bool,
    timeout_secs: u64,
) -> Result<(), String> {
    let err_palette = Palette::for_stderr(cli.no_color);
    let stale_ctl = match CtlClient::discover(cli.data_dir.as_deref(), lang, err_palette) {
        Ok(client) => match client.get("/v1/status") {
            Ok(status) => {
                if cli.json {
                    print_json(&json!({
                        "started": false,
                        "alreadyRunning": true,
                        "ready": true,
                        "pid": client.pid,
                        "status": status,
                    }));
                } else {
                    let ver = status["version"].as_str().unwrap_or("-");
                    println!(
                        "{} {} {} {}",
                        palette.bold_green("●"),
                        palette.bold_cyan(APP_DISPLAY_NAME),
                        palette.cyan(&format!("(v{ver})")),
                        lang.tr("已在运行中。", "is already running."),
                    );
                }
                return Ok(());
            }
            Err(_) => Some((client.port, client.token)),
        },
        Err(_) => None,
    };

    let app_data_dir = resolve_app_data_dir(cli.data_dir.as_deref());
    let (mut child, launch_target, log_path) = if cfg!(debug_assertions) {
        let repo_root = resolve_dev_workspace_root(lang)?;
        if !cli.json {
            println!(
                "{} {}",
                palette.cyan("→"),
                palette.dim(lang.tr(
                    "正在通过 Tauri Dev（含 Vite 热更新）启动开发环境...",
                    "Starting dev environment via `tauri dev` (with Vite HMR)...",
                ))
            );
        }
        let (child, log_path) = spawn_dev_tauri_process(&repo_root, app_data_dir.as_deref(), silent)?;
        (child, repo_root, log_path)
    } else {
        let app_exe = resolve_app_executable(cli.data_dir.as_deref(), lang)?;
        let child = spawn_detached_app(&app_exe, silent)?;
        (child, app_exe, None)
    };
    let runner_pid = child.id();

    if no_wait {
        if cli.json {
            print_json(&json!({
                "started": true,
                "alreadyRunning": false,
                "ready": false,
                "pid": runner_pid,
                "target": launch_target,
                "logPath": log_path,
            }));
        } else {
            println!(
                "{} {} {} {}",
                palette.bold_green("✓"),
                lang.tr("已启动", "Launched"),
                palette.bold_cyan(APP_DISPLAY_NAME),
                palette.dim(&format!("(pid: {runner_pid})")),
            );
            if let Some(lp) = &log_path {
                println!(
                    "  {} {}",
                    palette.dim(lang.tr("日志:", "Log:")),
                    palette.dim(&lp.display().to_string())
                );
            }
        }
        return Ok(());
    }

    let wait_timeout = Duration::from_secs(timeout_secs.max(1));
    let deadline = Instant::now() + wait_timeout;
    loop {
        if let Ok(Some(exit_status)) = child.try_wait() {
            let tail = log_path
                .as_deref()
                .and_then(|p| read_log_tail(p, 12))
                .map(|t| format!("\n{t}"))
                .unwrap_or_default();
            return Err(lang
                .tr(
                    &format!("{APP_DISPLAY_NAME} 启动进程提前退出（{exit_status}）。{tail}"),
                    &format!("{APP_DISPLAY_NAME} launcher exited early ({exit_status}).{tail}"),
                )
                .to_string());
        }

        if let Ok(client) = CtlClient::discover(cli.data_dir.as_deref(), lang, err_palette) {
            let is_stale = stale_ctl
                .as_ref()
                .is_some_and(|(p, t)| *p == client.port && t == &client.token);
            if !is_stale && let Ok(status) = client.get("/v1/status") {
                let app_pid = client.pid.unwrap_or(runner_pid);
                if cli.json {
                    print_json(&json!({
                        "started": true,
                        "alreadyRunning": false,
                        "ready": true,
                        "pid": app_pid,
                        "runnerPid": runner_pid,
                        "target": launch_target,
                        "logPath": log_path,
                        "status": status,
                    }));
                } else {
                    let ver = status["version"].as_str().unwrap_or("-");
                    println!(
                        "{} {} {} {}",
                        palette.bold_green("✓"),
                        palette.bold_cyan(APP_DISPLAY_NAME),
                        palette.green(lang.tr("已启动并就绪", "started and ready")),
                        palette.cyan(&format!("(pid: {app_pid}, v{ver})")),
                    );
                }
                return Ok(());
            }
        }

        if Instant::now() >= deadline {
            let app_name = err_palette.bold_yellow(APP_DISPLAY_NAME);
            let pid_info = err_palette.dim(&format!("(pid: {runner_pid})"));
            let timeout_str = err_palette.bold_yellow(&format!("{}s", wait_timeout.as_secs()));
            let log_hint = log_path
                .as_deref()
                .map(|p| err_palette.dim(&format!(" ({})", p.display())))
                .unwrap_or_default();
            return Err(lang
                .tr(
                    &format!(
                        "{app_name} 启动进程仍在运行 {pid_info}，但等待控制服务就绪超时（{timeout_str}）{log_hint}。",
                    ),
                    &format!(
                        "{app_name} launcher is still running {pid_info}, but timed out after {timeout_str} waiting for control server readiness{log_hint}.",
                    ),
                )
                .to_string());
        }

        std::thread::sleep(Duration::from_millis(150));
    }
}

fn run_stop(cli: &Cli, lang: Lang, palette: &Palette, no_wait: bool, timeout_secs: u64) -> Result<(), String> {
    let err_palette = Palette::for_stderr(cli.no_color);
    let Ok(client) = CtlClient::discover(cli.data_dir.as_deref(), lang, err_palette) else {
        if cli.json {
            print_json(&json!({
                "stopped": false,
                "alreadyStopped": true,
            }));
        } else {
            println!(
                "{} {} {}",
                palette.dim("○"),
                palette.bold_cyan(APP_DISPLAY_NAME),
                palette.dim(lang.tr("未在运行。", "is not running.")),
            );
        }
        return Ok(());
    };

    let resp = match client.post("/v1/stop", &json!({}), Duration::from_secs(5)) {
        Ok(v) => v,
        Err(_) => {
            if cli.json {
                print_json(&json!({
                    "stopped": false,
                    "alreadyStopped": true,
                }));
            } else {
                println!(
                    "{} {} {}",
                    palette.dim("○"),
                    palette.bold_cyan(APP_DISPLAY_NAME),
                    palette.dim(lang.tr("未在运行。", "is not running.")),
                );
            }
            return Ok(());
        }
    };

    let pid = resp["pid"].as_u64().or_else(|| client.pid.map(u64::from));

    if no_wait {
        if cli.json {
            print_json(&json!({
                "stopped": true,
                "alreadyStopped": false,
                "pid": pid,
            }));
        } else {
            let pid_label = pid.map(|p| format!(" (pid: {p})")).unwrap_or_default();
            println!(
                "{} {} {}{}",
                palette.bold_green("✓"),
                lang.tr("已发送退出信号至", "Sent stop signal to"),
                palette.bold_cyan(APP_DISPLAY_NAME),
                palette.dim(&pid_label),
            );
        }
        return Ok(());
    }

    let wait_timeout = Duration::from_secs(timeout_secs.max(1));
    let deadline = Instant::now() + wait_timeout;
    loop {
        let still_alive = CtlClient::discover(cli.data_dir.as_deref(), lang, err_palette)
            .ok()
            .is_some_and(|c| c.get("/v1/status").is_ok());
        if !still_alive {
            if cli.json {
                print_json(&json!({
                    "stopped": true,
                    "alreadyStopped": false,
                    "pid": pid,
                }));
            } else {
                let pid_label = pid.map(|p| format!(" (pid: {p})")).unwrap_or_default();
                println!(
                    "{} {} {}{}",
                    palette.bold_green("✓"),
                    palette.bold_cyan(APP_DISPLAY_NAME),
                    palette.green(lang.tr("已停止", "stopped")),
                    palette.dim(&pid_label),
                );
            }
            return Ok(());
        }
        if Instant::now() >= deadline {
            let app_name = err_palette.bold_yellow(APP_DISPLAY_NAME);
            let timeout_str = err_palette.bold_yellow(&format!("{}s", wait_timeout.as_secs()));
            return Err(lang
                .tr(
                    &format!("等待 {app_name} 退出超时（{timeout_str}）。"),
                    &format!("Timed out after {timeout_str} waiting for {app_name} to stop."),
                )
                .to_string());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn run_update(cli: &Cli, lang: Lang, palette: &Palette, check_only: bool) -> Result<(), String> {
    use mihomo_multi_lib::core::app_updater::{AppPackageType, check_app_update_direct, download_update_asset_direct};

    let rt = tokio::runtime::Runtime::new().map_err(|e| format!("failed to initialize async runtime: {e}"))?;

    if !cli.json {
        println!("{}", palette.dim(lang.tr("正在检查更新...", "Checking for updates...")));
    }

    let check = rt.block_on(check_app_update_direct()).map_err(|e| e.to_string())?;

    if !check.has_update {
        if cli.json {
            print_json(&json!({
                "hasUpdate": false,
                "currentVersion": check.current_version,
                "latestVersion": check.latest_version,
            }));
        } else {
            println!(
                "{} {}",
                palette.bold_green("✓"),
                lang.tr(
                    &format!(
                        "当前已是最新版本: {}",
                        palette.bold_cyan(&format!("v{}", check.current_version))
                    ),
                    &format!(
                        "Already up to date: {}",
                        palette.bold_cyan(&format!("v{}", check.current_version))
                    ),
                )
            );
        }
        return Ok(());
    }

    if !cli.json {
        let title = check
            .release_name
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .map(|n| format!(" ({n})"))
            .unwrap_or_default();
        println!(
            "{} {} {} {}{}",
            palette.cyan(lang.tr("发现新版本:", "New version available:")),
            palette.dim(&format!("v{}", check.current_version)),
            palette.dim("->"),
            palette.bold_green(&format!("v{}", check.latest_version)),
            palette.dim(&title)
        );
        if let Some(url) = &check.release_url {
            println!(
                "{} {}",
                palette.dim(lang.tr("发布地址:", "Release URL:")),
                palette.cyan(url)
            );
        }
        if let Some(notes) = check.release_notes.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            println!(
                "\n{}",
                palette.cyan(lang.tr("发布说明 (Release Notes):", "Release Notes:"))
            );
            println!("{notes}\n");
        }
    }
    if check_only {
        if cli.json {
            print_json(&json!({
                "hasUpdate": true,
                "currentVersion": check.current_version,
                "latestVersion": check.latest_version,
                "releaseName": check.release_name,
                "releaseUrl": check.release_url,
                "releaseNotes": check.release_notes,
            }));
        }
        return Ok(());
    }

    let Some(asset) = check.asset else {
        let msg = lang.tr(
            "未找到适用于当前平台的更新包，请前往发布页面手动下载。",
            "No compatible update package found for the current platform; please download manually.",
        );
        return Err(msg.to_string());
    };

    if !cli.json {
        println!(
            "{} {}",
            palette.dim(lang.tr("正在下载更新包:", "Downloading update:")),
            palette.bold_cyan(&asset.name)
        );
    }

    let is_tty = std::io::stdout().is_terminal();
    let show_progress = !cli.json;
    let mut last_pct: Option<u32> = None;

    let dest_path = rt
        .block_on(download_update_asset_direct(
            &asset.download_url,
            &asset.name,
            asset.package_type.clone(),
            |downloaded, total| {
                if !show_progress {
                    return;
                }
                let pct = if total > 0 {
                    ((downloaded as f64 / total as f64) * 100.0).clamp(0.0, 100.0) as u32
                } else {
                    0
                };
                if last_pct == Some(pct) && downloaded < total {
                    return;
                }
                last_pct = Some(pct);
                let dl_mb = downloaded as f64 / (1024.0 * 1024.0);
                let total_mb = total as f64 / (1024.0 * 1024.0);
                if is_tty {
                    if total > 0 {
                        print!(
                            "\r  {} {}",
                            palette.bold_cyan(&format!("{pct:>3}%")),
                            palette.dim(&format!("({dl_mb:.1} MB / {total_mb:.1} MB)"))
                        );
                    } else {
                        print!("\r  {}", palette.bold_cyan(&format!("{dl_mb:.1} MB")));
                    }
                    let _ = std::io::stdout().flush();
                }
            },
        ))
        .map_err(|e| e.to_string())?;

    if show_progress && is_tty {
        println!();
    }

    match asset.package_type {
        AppPackageType::Installer => {
            #[cfg(target_os = "windows")]
            {
                std::process::Command::new(&dest_path)
                    .spawn()
                    .map_err(|e| format!("failed to launch installer: {e}"))?;
            }
            #[cfg(target_os = "macos")]
            {
                std::process::Command::new("open")
                    .arg(&dest_path)
                    .spawn()
                    .map_err(|e| format!("failed to open installer: {e}"))?;
            }
            #[cfg(target_os = "linux")]
            {
                std::process::Command::new("xdg-open")
                    .arg(&dest_path)
                    .spawn()
                    .map_err(|e| format!("failed to open package: {e}"))?;
            }

            if cli.json {
                print_json(&json!({
                    "hasUpdate": true,
                    "currentVersion": check.current_version,
                    "latestVersion": check.latest_version,
                    "releaseNotes": check.release_notes,
                    "releaseUrl": check.release_url,
                    "packageType": "installer",
                    "downloadedPath": dest_path,
                }));
            } else {
                let path_str = palette.cyan(&dest_path.display().to_string());
                println!(
                    "{} {}",
                    palette.bold_green("✓"),
                    lang.tr(
                        &format!("更新包已下载至「{path_str}」并已启动安装程序。"),
                        &format!("Update downloaded to \"{path_str}\" and installer launched."),
                    )
                );
            }
        }
        AppPackageType::Portable => {
            if cli.json {
                print_json(&json!({
                    "hasUpdate": true,
                    "currentVersion": check.current_version,
                    "latestVersion": check.latest_version,
                    "releaseNotes": check.release_notes,
                    "releaseUrl": check.release_url,
                    "packageType": "portable",
                    "downloadedPath": dest_path,
                }));
            } else {
                let path_str = palette.cyan(&dest_path.display().to_string());
                println!(
                    "{} {}",
                    palette.bold_green("✓"),
                    lang.tr(
                        &format!("便携包已下载至「{path_str}」，请关闭程序后解压替换。"),
                        &format!("Portable package downloaded to \"{path_str}\". Close the app, then extract and replace."),
                    )
                );
            }
        }
    }

    Ok(())
}

fn localize_command(mut cmd: clap::Command, lang: Lang) -> clap::Command {
    if lang == Lang::En {
        return cmd;
    }
    cmd = cmd
        .about("Mihomo Multi 桌面端外部命令行控制工具")
        .mut_arg("json", |a| a.help("以 JSON 格式输出"))
        .mut_arg("no_color", |a| a.help("禁用 ANSI 彩色输出"))
        .mut_arg("data_dir", |a| {
            a.help("覆盖包含 ctl.json 的数据目录（也可设置 MIHOMO_MULTI_DATA_DIR）")
        })
        .mut_arg("lang", |a| {
            a.help("覆盖 CLI 输出语言（zh-CN 或 en-US，也可设置 MM_LANG）")
        });

    let sub_abouts = |name: &str| -> Option<&'static str> {
        match name {
            "start" => Some("启动主程序（若未运行）并等待控制服务就绪"),
            "stop" => Some("优雅退出正在运行的主程序"),
            "status" => Some("查看内核、端口监听、系统代理、TUN 与终端环境状态"),
            "list" => Some("列出所有已配置的端口监听"),
            "enable" => Some("启用指定端口监听并热重载 Mihomo"),
            "disable" => Some("停用指定端口监听并热重载 Mihomo"),
            "sub" => Some("订阅查询与更新"),
            "node" => Some("代理节点查询"),
            "test" => Some("对单个节点或订阅进行延迟测速"),
            "sysproxy" => Some("查看、启用或关闭系统代理"),
            "tun" => Some("查看、启用或关闭 TUN 虚拟网卡模式"),
            "env" => Some("查看当前终端代理环境变量或绑定端口"),
            "ip" => Some("通过指定端口或节点探测出口 IP"),
            "copy" => Some("输出或复制代理地址"),
            "init" => Some("输出 Shell 集成脚本，使 `<alias> env [port]` 可直接作用于当前终端"),
            "lang" => Some("查看或切换应用与 CLI 语言（zh-CN / en-US）"),
            "update" => Some("检查应用更新，如有新版本则输出发布说明并下载更新"),
            _ => None,
        }
    };

    let localize_arg = |arg: clap::Arg, sub_path: &str| -> clap::Arg {
        let help = match (sub_path, arg.get_id().as_str()) {
            ("start", "silent") => Some("以静默模式启动并最小化到系统托盘"),
            ("start", "no_wait") => Some("仅拉起主程序进程，不等待控制服务就绪"),
            ("start", "timeout") => Some("等待控制服务就绪的最大秒数（dev 默认 60 秒，release 默认 15 秒）"),
            ("stop", "no_wait") => Some("仅发送退出信号，不等待主程序完全退出"),
            ("stop", "timeout") => Some("等待主程序退出的最大秒数（默认 10 秒）"),
            ("enable", "port") => Some("要启用的监听端口号"),
            ("disable", "port") => Some("要停用的监听端口号"),
            ("sub update", "target") => Some("订阅名称或 ID（支持模糊匹配）"),
            ("sub update", "all") => Some("更新全部订阅"),
            ("node list", "sub") => Some("可选订阅名称或 ID 过滤（支持模糊匹配）"),
            ("node list", "query") => Some("可选节点名称/地区关键字过滤（支持模糊匹配）"),
            ("node list", "available") => Some("仅显示有效延迟内的可用节点"),
            ("test node", "name") => Some("节点名称"),
            ("test node", "url") => Some("自定义测速 URL"),
            ("test node", "timeout") => Some("超时时间（毫秒）"),
            ("test sub", "target") => Some("订阅名称或 ID（省略则测试全部订阅）"),
            ("test sub", "url") => Some("自定义测速 URL"),
            ("test sub", "timeout") => Some("超时时间（毫秒）"),
            ("sysproxy", "target") => Some("端口号或 'off'（省略则查看当前状态）"),
            ("tun", "target") => Some("端口号或 'off'（省略则查看当前状态）"),
            ("env", "port") => Some("要绑定的端口号（省略则清除终端代理环境变量）"),
            ("env", "shell") => Some("目标 Shell 语法：pwsh、cmd、sh"),
            ("env", "current") => Some("仅作用于当前终端会话，不修改全局/持久化环境变量"),
            ("env", "eval") => Some("仅在 stdout 输出原始 Shell 命令（供 Shell 集成包装函数使用）"),
            ("ip", "port") => Some("要探测出口 IP 的已启用监听端口"),
            ("ip", "copy") => Some("将探测到的 IP 复制到系统剪贴板"),
            ("ip", "timeout") => Some("探测超时时间（毫秒）"),
            ("copy", "port") => Some("目标监听端口"),
            ("copy", "format") => Some("输出格式：env、host、http、socks5、curl（省略则输出 env）"),
            ("copy", "copy") => Some("复制到系统剪贴板"),
            ("copy", "shell") => Some("当 format 为 env 或省略时的 Shell 语法：pwsh、cmd、sh"),
            ("init", "shell") => Some("目标 Shell：pwsh、bash、zsh、cmd（省略则自动检测当前终端）"),
            ("init", "alias") => Some("CLI 命令别名（默认为 mm）"),
            ("lang", "target") => Some("目标语言（zh、en、zh-CN、en-US，省略则显示当前语言）"),
            ("update", "check") => Some("仅检查更新，不下载安装包"),
            _ => None,
        };
        match help {
            Some(h) => arg.help(h),
            None => arg,
        }
    };

    let nested_about = |parent: &str, child: &str| -> Option<&'static str> {
        match (parent, child) {
            ("sub", "list") => Some("列出所有订阅"),
            ("sub", "update") => Some("更新指定订阅或全部订阅"),
            ("node", "list") => Some("列出所有节点，可按订阅与关键字筛选"),
            ("test", "node") => Some("测试单个节点延迟"),
            ("test", "sub") => Some("批量测试指定订阅（或全部订阅）下所有节点的延迟"),
            _ => None,
        }
    };

    let names: Vec<String> = cmd.get_subcommands().map(|s| s.get_name().to_string()).collect();
    for name in names {
        let about = sub_abouts(&name);
        cmd = cmd.mut_subcommand(&name, |mut sub| {
            if let Some(a) = about {
                sub = sub.about(a);
            }
            let arg_ids: Vec<String> = sub.get_arguments().map(|a| a.get_id().to_string()).collect();
            for arg_id in arg_ids {
                sub = sub.mut_arg(&arg_id, |a| localize_arg(a, &name));
            }
            let child_names: Vec<String> = sub.get_subcommands().map(|s| s.get_name().to_string()).collect();
            for child_name in child_names {
                let child_about = nested_about(&name, &child_name);
                let child_path = format!("{name} {child_name}");
                sub = sub.mut_subcommand(&child_name, |mut child| {
                    if let Some(ca) = child_about {
                        child = child.about(ca);
                    }
                    let c_arg_ids: Vec<String> = child.get_arguments().map(|a| a.get_id().to_string()).collect();
                    for c_arg_id in c_arg_ids {
                        child = child.mut_arg(&c_arg_id, |a| localize_arg(a, &child_path));
                    }
                    child
                });
            }
            sub
        });
    }
    cmd
}
