use crate::models::ConnectionMetadata;
use std::collections::{HashMap, HashSet};
use std::net::IpAddr;
use std::path::Path;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

const MAX_ANCESTOR_DEPTH: usize = 16;

/// System shell / session / service host boundaries where ancestor traversal must stop.
const SYSTEM_BOUNDARY_STEMS: &[&str] = &[
    // Windows
    "explorer",
    "services",
    "svchost",
    "wininit",
    "winlogon",
    "csrss",
    "smss",
    "lsass",
    "system",
    "idle",
    "dwm",
    "sihost",
    "taskhostw",
    "runtimebroker",
    "applicationframehost",
    "dllhost",
    "wmiprvse",
    "userinit",
    // Unix / macOS
    "init",
    "systemd",
    "launchd",
    "kernel_task",
    "loginwindow",
    "windowserver",
];

/// Transient CLI tools, language runtimes, shells, package managers, and helper/LSP processes
/// that are typically spawned by a parent host application and should not be recorded standalone.
const TRANSIENT_OR_HELPER_STEMS: &[&str] = &[
    // Network / VCS CLI tools
    "curl",
    "wget",
    "http",
    "xh",
    "aria2c",
    "axel",
    "nc",
    "ncat",
    "netcat",
    "socat",
    "ping",
    "nslookup",
    "dig",
    "ssh",
    "scp",
    "sftp",
    "rsync",
    "git",
    "git-remote-https",
    "git-remote-http",
    "git-credential-manager",
    "gh",
    // Language runtimes, package managers & build tools
    "node",
    "nodejs",
    "npm",
    "npx",
    "pnpm",
    "yarn",
    "bun",
    "deno",
    "tsx",
    "ts-node",
    "python",
    "python3",
    "pythonw",
    "py",
    "pip",
    "pip3",
    "uv",
    "poetry",
    "conda",
    "ruby",
    "perl",
    "php",
    "java",
    "javaw",
    "go",
    "cargo",
    "rustc",
    "rustup",
    "dotnet",
    "msbuild",
    "gradle",
    "mvn",
    "esbuild",
    "swc",
    "vite",
    "webpack",
    "tsc",
    "biome",
    "eslint",
    "prettier",
    "rg",
    "fd",
    "jq",
    "awk",
    "sed",
    // Shells & console hosts
    "cmd",
    "powershell",
    "pwsh",
    "conhost",
    "openconsole",
    "sh",
    "bash",
    "zsh",
    "fish",
    "dash",
    "ash",
    "csh",
    "tcsh",
    "nu",
    "wsl",
    "wslhost",
    "mintty",
    // Well-known language servers & linters
    "rust-analyzer",
    "clangd",
    "gopls",
    "vtsls",
    "zls",
    "jdtls",
    "omnisharp",
    "taplo",
    "marksman",
    "pylsp",
    "ruff",
    "tinymist",
    "nil",
];

const TRANSIENT_NAME_SUBSTRINGS: &[&str] = &[
    "language-server",
    "language_server",
    "langserver",
    "lsp-server",
    "lsp_server",
    "crashpad",
    "crashreporter",
    "update-helper",
];

const TRANSIENT_PATH_SEGMENTS: &[&str] = &[
    "/.vscode/extensions/",
    "/.cursor/extensions/",
    "/.windsurf/extensions/",
    "/.antigravity/extensions/",
    "/.trae/extensions/",
    "/node_modules/",
];

fn normalize_stem(name: &str) -> String {
    let trimmed = name.trim();
    let base = Path::new(trimmed)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(trimmed);
    let lower = base.to_ascii_lowercase();
    lower.strip_suffix(".exe").unwrap_or(&lower).to_string()
}

fn normalize_path_key(path: &str) -> String {
    let trimmed = path.trim();
    if cfg!(windows) {
        trimmed.to_ascii_lowercase()
    } else {
        trimmed.to_string()
    }
}

pub fn is_system_boundary(name: &str) -> bool {
    let stem = normalize_stem(name);
    SYSTEM_BOUNDARY_STEMS.contains(&stem.as_str())
}

pub fn is_transient_or_helper_process(name: &str, path: Option<&str>) -> bool {
    let stem = normalize_stem(name);
    if stem.is_empty() {
        return true;
    }
    if SYSTEM_BOUNDARY_STEMS.contains(&stem.as_str()) {
        return true;
    }
    if TRANSIENT_OR_HELPER_STEMS.contains(&stem.as_str()) {
        return true;
    }
    if TRANSIENT_NAME_SUBSTRINGS.iter().any(|needle| stem.contains(needle)) {
        return true;
    }
    if stem.ends_with("-lsp") || stem.ends_with("_lsp") {
        return true;
    }
    if let Some(raw_path) = path {
        let normalized_path = raw_path.replace('\\', "/").to_ascii_lowercase();
        if TRANSIENT_PATH_SEGMENTS
            .iter()
            .any(|segment| normalized_path.contains(segment))
        {
            return true;
        }
    }
    false
}

#[derive(Debug, Clone)]
pub struct ProcessNode {
    pub parent_pid: Option<u32>,
    pub name: String,
    pub path: Option<String>,
}

#[derive(Debug, Default)]
pub struct ProcessTreeSnapshot {
    processes: HashMap<u32, ProcessNode>,
    tcp_owners: HashMap<(IpAddr, u16), u32>,
    udp_owners: HashMap<(IpAddr, u16), u32>,
}

impl ProcessTreeSnapshot {
    pub fn capture_live() -> Self {
        let mut system = System::new();
        system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet),
        );

        let mut processes = HashMap::with_capacity(system.processes().len());
        for (pid, proc_info) in system.processes() {
            let name = proc_info.name().to_string_lossy().trim().to_string();
            let path = proc_info
                .exe()
                .map(|p| p.to_string_lossy().trim().to_string())
                .filter(|s| !s.is_empty());
            if name.is_empty() && path.is_none() {
                continue;
            }
            processes.insert(
                pid.as_u32(),
                ProcessNode {
                    parent_pid: proc_info.parent().map(|p| p.as_u32()),
                    name,
                    path,
                },
            );
        }

        let (tcp_owners, udp_owners) = capture_socket_owners();
        Self {
            processes,
            tcp_owners,
            udp_owners,
        }
    }

    #[cfg(test)]
    pub fn from_parts(
        processes: HashMap<u32, ProcessNode>,
        tcp_owners: HashMap<(IpAddr, u16), u32>,
        udp_owners: HashMap<(IpAddr, u16), u32>,
    ) -> Self {
        Self {
            processes,
            tcp_owners,
            udp_owners,
        }
    }

    fn lookup_socket_pid(&self, meta: &ConnectionMetadata) -> Option<u32> {
        let ip: IpAddr = meta.source_ip.trim().parse().ok()?;
        let port: u16 = meta.source_port.trim().parse().ok()?;
        if port == 0 {
            return None;
        }
        let table = if meta.network.eq_ignore_ascii_case("udp") {
            &self.udp_owners
        } else {
            &self.tcp_owners
        };
        table.get(&(ip, port)).copied()
    }

    fn find_host_ancestor(&self, start_pid: u32) -> Option<(String, Option<String>)> {
        let mut current = self.processes.get(&start_pid).and_then(|n| n.parent_pid);
        let mut visited: HashSet<u32> = HashSet::new();
        visited.insert(start_pid);

        for _ in 0..MAX_ANCESTOR_DEPTH {
            let pid = current?;
            if !visited.insert(pid) {
                return None;
            }
            let node = self.processes.get(&pid)?;
            if is_system_boundary(&node.name) {
                return None;
            }
            if !is_transient_or_helper_process(&node.name, node.path.as_deref()) {
                return Some((node.name.clone(), node.path.clone()));
            }
            current = node.parent_pid;
        }
        None
    }

    fn find_host_by_path(&self, raw_path: &str) -> Option<(String, Option<String>)> {
        let target = normalize_path_key(raw_path);
        let mut resolved: Option<(String, Option<String>)> = None;

        for (pid, node) in &self.processes {
            let Some(node_path) = node.path.as_deref() else {
                continue;
            };
            if normalize_path_key(node_path) != target {
                continue;
            }
            let Some(host) = self.find_host_ancestor(*pid) else {
                continue;
            };
            match &resolved {
                None => resolved = Some(host),
                Some(prev) => {
                    let same = match (&prev.1, &host.1) {
                        (Some(a), Some(b)) => normalize_path_key(a) == normalize_path_key(b),
                        _ => normalize_stem(&prev.0) == normalize_stem(&host.0),
                    };
                    if !same {
                        return None;
                    }
                }
            }
        }
        resolved
    }

    /// Resolves a transient/helper child process to its parent host application.
    /// Returns `None` if no meaningful host application can be found (noise is dropped).
    pub fn resolve_transient(
        &self,
        meta: &ConnectionMetadata,
        raw_path: Option<&str>,
    ) -> Option<(String, Option<String>)> {
        if let Some(pid) = self.lookup_socket_pid(meta)
            && let Some(host) = self.find_host_ancestor(pid)
        {
            return Some(host);
        }
        if let Some(path) = raw_path {
            return self.find_host_by_path(path);
        }
        None
    }
}

type SocketOwnerMap = HashMap<(IpAddr, u16), u32>;

#[cfg(windows)]
fn capture_socket_owners() -> (SocketOwnerMap, SocketOwnerMap) {
    use std::net::{Ipv4Addr, Ipv6Addr};
    use windows_sys::Win32::Foundation::{ERROR_INSUFFICIENT_BUFFER, NO_ERROR};
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetExtendedTcpTable, GetExtendedUdpTable, MIB_TCP6ROW_OWNER_PID, MIB_TCPROW_OWNER_PID, MIB_UDP6ROW_OWNER_PID,
        MIB_UDPROW_OWNER_PID, TCP_TABLE_OWNER_PID_ALL, UDP_TABLE_OWNER_PID,
    };
    use windows_sys::Win32::Networking::WinSock::{AF_INET, AF_INET6};

    fn decode_port(raw: u32) -> u16 {
        u16::from_be((raw & 0xFFFF) as u16)
    }

    fn query_table<F>(mut fetch: F) -> Option<Vec<u64>>
    where
        F: FnMut(*mut std::ffi::c_void, *mut u32) -> u32,
    {
        let mut size: u32 = 0;
        let first = fetch(std::ptr::null_mut(), &mut size);
        if first != ERROR_INSUFFICIENT_BUFFER || size == 0 {
            return None;
        }
        for _ in 0..3 {
            let word_count = (size as usize).div_ceil(std::mem::size_of::<u64>());
            let mut buffer = vec![0u64; word_count];
            let status = fetch(buffer.as_mut_ptr().cast(), &mut size);
            if status == NO_ERROR {
                return Some(buffer);
            }
            if status != ERROR_INSUFFICIENT_BUFFER {
                return None;
            }
        }
        None
    }

    unsafe fn rows_from<R>(buffer: &[u64]) -> &[R] {
        let count = unsafe { *(buffer.as_ptr() as *const u32) } as usize;
        let ptr = unsafe { buffer.as_ptr().cast::<u8>().add(std::mem::size_of::<u32>()) } as *const R;
        unsafe { std::slice::from_raw_parts(ptr, count) }
    }

    let mut tcp = HashMap::new();
    let mut udp = HashMap::new();

    if let Some(buf) = query_table(|t, s| unsafe {
        GetExtendedTcpTable(t, s, 0, AF_INET as u32, TCP_TABLE_OWNER_PID_ALL, 0)
    }) {
        for row in unsafe { rows_from::<MIB_TCPROW_OWNER_PID>(&buf) } {
            let port = decode_port(row.dwLocalPort);
            if port > 0 && row.dwOwningPid > 0 {
                let ip = IpAddr::V4(Ipv4Addr::from(row.dwLocalAddr.to_ne_bytes()));
                tcp.insert((ip, port), row.dwOwningPid);
            }
        }
    }

    if let Some(buf) = query_table(|t, s| unsafe {
        GetExtendedTcpTable(t, s, 0, AF_INET6 as u32, TCP_TABLE_OWNER_PID_ALL, 0)
    }) {
        for row in unsafe { rows_from::<MIB_TCP6ROW_OWNER_PID>(&buf) } {
            let port = decode_port(row.dwLocalPort);
            if port > 0 && row.dwOwningPid > 0 {
                let ip = IpAddr::V6(Ipv6Addr::from(row.ucLocalAddr));
                tcp.insert((ip, port), row.dwOwningPid);
            }
        }
    }

    if let Some(buf) = query_table(|t, s| unsafe {
        GetExtendedUdpTable(t, s, 0, AF_INET as u32, UDP_TABLE_OWNER_PID, 0)
    }) {
        for row in unsafe { rows_from::<MIB_UDPROW_OWNER_PID>(&buf) } {
            let port = decode_port(row.dwLocalPort);
            if port > 0 && row.dwOwningPid > 0 {
                let ip = IpAddr::V4(Ipv4Addr::from(row.dwLocalAddr.to_ne_bytes()));
                udp.insert((ip, port), row.dwOwningPid);
            }
        }
    }

    if let Some(buf) = query_table(|t, s| unsafe {
        GetExtendedUdpTable(t, s, 0, AF_INET6 as u32, UDP_TABLE_OWNER_PID, 0)
    }) {
        for row in unsafe { rows_from::<MIB_UDP6ROW_OWNER_PID>(&buf) } {
            let port = decode_port(row.dwLocalPort);
            if port > 0 && row.dwOwningPid > 0 {
                let ip = IpAddr::V6(Ipv6Addr::from(row.ucLocalAddr));
                udp.insert((ip, port), row.dwOwningPid);
            }
        }
    }

    (tcp, udp)
}

#[cfg(not(windows))]
fn capture_socket_owners() -> (SocketOwnerMap, SocketOwnerMap) {
    (HashMap::new(), HashMap::new())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    fn meta(source_port: u16, process: &str, path: Option<&str>) -> ConnectionMetadata {
        ConnectionMetadata {
            network: "tcp".to_string(),
            source_ip: "127.0.0.1".to_string(),
            source_port: source_port.to_string(),
            process: Some(process.to_string()),
            process_path: path.map(ToOwned::to_owned),
            ..ConnectionMetadata::default()
        }
    }

    #[test]
    fn classifies_transient_and_real_apps() {
        assert!(is_transient_or_helper_process("curl.exe", None));
        assert!(is_transient_or_helper_process("node.exe", None));
        assert!(is_transient_or_helper_process("typescript-language-server.exe", None));
        assert!(is_transient_or_helper_process("rust-analyzer", None));
        assert!(is_transient_or_helper_process("pwsh.exe", None));
        assert!(is_transient_or_helper_process(
            "custom-helper.exe",
            Some(r"C:\Users\me\.cursor\extensions\ext\bin\custom-helper.exe")
        ));

        assert!(!is_transient_or_helper_process("chrome.exe", Some(r"C:\Chrome\chrome.exe")));
        assert!(!is_transient_or_helper_process("Cursor.exe", Some(r"C:\Cursor\Cursor.exe")));
        assert!(!is_transient_or_helper_process("Telegram.exe", Some(r"C:\Telegram\Telegram.exe")));
    }

    #[test]
    fn resolves_nested_child_to_parent_host_app() {
        let mut procs = HashMap::new();
        procs.insert(
            10,
            ProcessNode {
                parent_pid: None,
                name: "explorer.exe".to_string(),
                path: Some(r"C:\Windows\explorer.exe".to_string()),
            },
        );
        procs.insert(
            100,
            ProcessNode {
                parent_pid: Some(10),
                name: "Cursor.exe".to_string(),
                path: Some(r"C:\Cursor\Cursor.exe".to_string()),
            },
        );
        procs.insert(
            200,
            ProcessNode {
                parent_pid: Some(100),
                name: "pwsh.exe".to_string(),
                path: Some(r"C:\PowerShell\pwsh.exe".to_string()),
            },
        );
        procs.insert(
            300,
            ProcessNode {
                parent_pid: Some(200),
                name: "curl.exe".to_string(),
                path: Some(r"C:\Windows\System32\curl.exe".to_string()),
            },
        );
        let mut tcp = HashMap::new();
        tcp.insert((IpAddr::V4(Ipv4Addr::LOCALHOST), 51234), 300);

        let tree = ProcessTreeSnapshot::from_parts(procs, tcp, HashMap::new());
        let resolved = tree.resolve_transient(
            &meta(51234, "curl.exe", Some(r"C:\Windows\System32\curl.exe")),
            Some(r"C:\Windows\System32\curl.exe"),
        );
        assert_eq!(
            resolved,
            Some(("Cursor.exe".to_string(), Some(r"C:\Cursor\Cursor.exe".to_string())))
        );
    }

    #[test]
    fn drops_orphan_or_explorer_owned_transient_process() {
        let mut procs = HashMap::new();
        procs.insert(
            10,
            ProcessNode {
                parent_pid: None,
                name: "explorer.exe".to_string(),
                path: Some(r"C:\Windows\explorer.exe".to_string()),
            },
        );
        procs.insert(
            400,
            ProcessNode {
                parent_pid: Some(10),
                name: "node.exe".to_string(),
                path: Some(r"C:\Node\node.exe".to_string()),
            },
        );
        let mut tcp = HashMap::new();
        tcp.insert((IpAddr::V4(Ipv4Addr::LOCALHOST), 54321), 400);

        let tree = ProcessTreeSnapshot::from_parts(procs, tcp, HashMap::new());
        let resolved = tree.resolve_transient(
            &meta(54321, "node.exe", Some(r"C:\Node\node.exe")),
            Some(r"C:\Node\node.exe"),
        );
        assert_eq!(resolved, None);
    }
}
