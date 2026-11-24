use clap::{Args, Parser, Subcommand};
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{IsTerminal, Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::Duration;

const APP_IDENTIFIER: &str = "com.mihomo.multi";
const DEV_APP_IDENTIFIER: &str = "com.mihomo.multi.dev";
const CTL_FILE_NAME: &str = "ctl.json";

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
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
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
        /// Target shell: pwsh, bash, zsh, cmd
        shell: String,
        /// CLI command alias name (defaults to mm)
        #[arg(long, default_value = "mm")]
        alias: String,
    },
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
    /// List all nodes or nodes in a specific subscription
    #[command(visible_alias = "ls")]
    List {
        /// Optional subscription name or ID filter
        sub: Option<String>,
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
    /// Emit only the raw shell command on stdout (used by shell wrappers / .cmd shim)
    #[arg(long)]
    eval: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CtlDiscoveryInfo {
    port: u16,
    token: String,
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
}

impl CtlClient {
    fn discover(override_dir: Option<&Path>) -> Result<Self, String> {
        let mut candidates = Vec::new();
        let env_dir = std::env::var_os("MIHOMO_MULTI_DATA_DIR").map(PathBuf::from);
        if let Some(dir) = override_dir.or(env_dir.as_deref()) {
            candidates.push(dir.join(CTL_FILE_NAME));
        } else if let Some(base) = local_data_base_dir() {
            if cfg!(debug_assertions) {
                candidates.push(base.join(DEV_APP_IDENTIFIER).join(CTL_FILE_NAME));
                candidates.push(base.join(APP_IDENTIFIER).join(CTL_FILE_NAME));
            } else {
                candidates.push(base.join(APP_IDENTIFIER).join(CTL_FILE_NAME));
                candidates.push(base.join(DEV_APP_IDENTIFIER).join(CTL_FILE_NAME));
            }
        }

        for path in &candidates {
            if !path.exists() {
                continue;
            }
            let content = std::fs::read_to_string(path)
                .map_err(|e| format!("failed to read {}: {e}", path.display()))?;
            let info: CtlDiscoveryInfo = serde_json::from_str(&content)
                .map_err(|e| format!("invalid {}: {e}", path.display()))?;
            return Ok(Self {
                port: info.port,
                token: info.token,
            });
        }

        Err("Mihomo Multi desktop app is not running (ctl.json not found). Please start Mihomo Multi first."
            .to_string())
    }

    fn get(&self, path: &str) -> Result<Value, String> {
        self.request("GET", path, None, Duration::from_secs(10))
    }

    fn post(&self, path: &str, body: &Value, timeout: Duration) -> Result<Value, String> {
        let payload = serde_json::to_string(body).map_err(|e| format!("failed to serialize request: {e}"))?;
        self.request("POST", path, Some(&payload), timeout)
    }

    fn request(&self, method: &str, path: &str, body: Option<&str>, timeout: Duration) -> Result<Value, String> {
        let mut stream = TcpStream::connect(("127.0.0.1", self.port)).map_err(|_| {
            "Failed to connect to Mihomo Multi control server. Please ensure Mihomo Multi is running.".to_string()
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
        let env: ApiEnvelope = serde_json::from_str(body_str)
            .map_err(|e| format!("invalid JSON response from control server: {e}"))?;
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

    fn paint(&self, code: &str, text: &str) -> String {
        if self.enabled {
            format!("\x1b[{code}m{text}\x1b[0m")
        } else {
            text.to_string()
        }
    }

    fn bold_cyan(&self, text: &str) -> String {
        self.paint("1;36", text)
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
            self.green("● ON")
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
                Some(p) => self.green(&format!("● ON (port {p})")),
                None => self.green("● ON"),
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

fn run(cli: Cli) -> Result<(), String> {
    if let Commands::Init { shell, alias } = &cli.command {
        let script = render_init_script(shell, alias)?;
        if cli.json {
            print_json(&json!({ "shell": shell, "alias": alias, "script": script }));
        } else {
            println!("{script}");
        }
        return Ok(());
    }

    let palette = Palette::new(cli.no_color);
    let client = CtlClient::discover(cli.data_dir.as_deref())?;

    match cli.command {
        Commands::Init { .. } => unreachable!(),
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
                palette.green(&format!("● running (pid: {pid})"))
            } else {
                palette.red("○ stopped")
            };

            println!("{}", palette.bold_cyan(&format!("Mihomo Multi v{}", data["version"].as_str().unwrap_or("-"))));
            println!("Core:         {core_badge}");
            println!("Ports:        {}", palette.cyan(&format!("{enabled}/{total} enabled")));
            println!("System Proxy: {sp}");
            println!("TUN Mode:     {tun}");
            println!("Terminal Env: {env}");
        }
        Commands::List => {
            let data = client.get("/v1/ports")?;
            if cli.json {
                print_json(&data);
                return Ok(());
            }
            let items = data.as_array().cloned().unwrap_or_default();
            if items.is_empty() {
                println!("No port mappings configured.");
                return Ok(());
            }
            let rows: Vec<Vec<String>> = items
                .iter()
                .map(|item| {
                    let m = &item["mapping"];
                    let port = palette.cyan(&m["port"].as_u64().map(|p| p.to_string()).unwrap_or_default());
                    let proto = palette.magenta(&m["protocol"].as_str().unwrap_or("mixed").to_uppercase());
                    let state = palette.state_badge(m["enabled"].as_bool().unwrap_or(false));
                    let node = clean_node_name(m["nodeName"].as_str().unwrap_or("-"));
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
                println!("Port {port} enabled.");
            }
        }
        Commands::Disable { port } => {
            let data = client.post(&format!("/v1/ports/{port}/disable"), &json!({}), Duration::from_secs(15))?;
            if cli.json {
                print_json(&data);
            } else {
                println!("Port {port} disabled.");
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
                    println!("No subscriptions configured.");
                    return Ok(());
                }
                let rows: Vec<Vec<String>> = items
                    .iter()
                    .map(|p| {
                        let name = p["name"].as_str().unwrap_or("-").to_string();
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
                println!("Updated {updated} subscription(s).");
                for err in errors {
                    eprintln!(
                        "  [FAILED] {}: {}",
                        err["name"].as_str().unwrap_or("-"),
                        err["error"].as_str().unwrap_or("unknown error")
                    );
                }
            }
        },
        Commands::Node { action } => match action {
            NodeAction::List { sub } => {
                let path = match &sub {
                    Some(s) => format!("/v1/nodes?sub={}", urlencoding::encode(s)),
                    None => "/v1/nodes".to_string(),
                };
                let data = client.get(&path)?;
                if cli.json {
                    print_json(&data);
                    return Ok(());
                }
                let items = data.as_array().cloned().unwrap_or_default();
                if items.is_empty() {
                    println!("No nodes found.");
                    return Ok(());
                }
                let rows: Vec<Vec<String>> = items
                    .iter()
                    .enumerate()
                    .map(|(i, n)| {
                        let idx = palette.cyan(&n["index"].as_u64().unwrap_or((i + 1) as u64).to_string());
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
                    println!("{node}: {delay}");
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
                    println!("{node}: {delay}");
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
                println!("System Proxy: {}", palette.mode_status(&data));
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
                println!("TUN Mode: {}", palette.mode_status(&data));
            }
        }
        Commands::Env(args) => {
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
            if args.eval {
                println!("{cmd}");
            } else {
                let status = palette.mode_status(&data["status"]);
                eprintln!("Terminal Env: {status}");
                println!("{cmd}");
            }
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
                println!("{ip} ({country} / {location}) [copied]");
            } else {
                println!("{ip} ({country} / {location})");
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
                    eprintln!("Copied to clipboard:");
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

fn main() -> ExitCode {
    let cli = Cli::parse();
    match run(cli) {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("error: {err}");
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
        assert!(matches!(cli.command, Commands::Sub { action: SubAction::List }));

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
}
