# Mihomo Multi-Port

<p align="center">
  <img src="src-tauri/icons/icon.png" width="128" height="128" alt="Mihomo Multi-Port Logo" />
</p>

<p align="center">
  <b>A lightweight, high-performance desktop client for multi-port proxy listener binding powered by Mihomo (Clash.Meta) and Tauri v2.</b>
</p>

<p align="center">
  <a href="README.zh-CN.md">简体中文</a> | <b>English</b>
</p>

---

## 💡 Why Mihomo Multi-Port?

Most mainstream desktop proxy clients are designed for general web browsing and typically expose only a single global mixed proxy port (e.g. `7890`).

When you need **multiple independent local listening ports routed to distinct egress proxy nodes** (for example: fingerprint browser isolation, multi-account automation, web crawlers, or isolated test environments like `7891 -> 🇯🇵 Japan 01`, `7892 -> 🇭🇰 Hong Kong 02`, `7893 -> 🇺🇸 US 01`), traditional workarounds require running multiple heavy GUI applications simultaneously. This wastes substantial system memory and is cumbersome to maintain.

**Mihomo Multi-Port** is purpose-built to solve this problem with an ultra-focused, minimalist architecture:
* 🎯 **Single Core Responsibility**: Pure `Add Inbound Port Listener -> Bind Specific Proxy Node (1:1)`.
* ⚡ **Ultra-Low Resource Footprint**: Managed by a single supervised Mihomo sidecar core (~30MB background RAM), eliminating the overhead of multiple bloated GUI clients.
* 🔄 **Millisecond Hot-Reload**: Adding, updating, deleting, or toggling port listeners is applied in real-time via Mihomo REST API (`PUT /configs?force=true`) **without restarting processes or interrupting active connections**.
* 🛡️ **Deterministic 1:1 Routing**: Strict `IN-PORT` routing rules ensure each port never drifts or randomly switches exit IP addresses.
* 🚀 **Zero Unnecessary Bloat**: No TUN virtual adapter driver dependencies, no complex rule merge scripts, and no unnecessary bloat.

---

## ✨ Key Features

### 1. Multi-Port Inbound Management & 1:1 Binding
- **Flexible Inbound Protocols**: Configure unlimited local listening ports supporting Mixed (SOCKS5/HTTP), pure HTTP, or pure SOCKS5 protocols.
- **Port Conflict Pre-Check**: Automatically checks local port availability via socket binding tests before saving or enabling to prevent port collision errors.
- **Independent Toggling & Editing**: Toggle, edit bound nodes, or update port descriptions independently per port.
- **One-Click Proxy Helpers**: Quick-copy menu to instantly copy `127.0.0.1:<port>`, `http://...`, `socks5://...`, or terminal-ready cURL test commands.

### 2. Controlled System Proxy & Disconnect Guard
- **Strict Mutual Exclusion**: System proxy is globally strictly mutually exclusive—bound to at most 1 enabled listening port at any time.
- **Smart Bypass List**: Built-in LAN and loopback bypasses (`localhost`, `127.*`, `10.*`, `192.168.*`, etc.) with customizable user bypass entries.
- **Environment Variable Synchronization**: Automatically synchronizes current user-level environment variables on Windows (`all_proxy`, `http_proxy`, `https_proxy`, `no_proxy`) for terminal tools.
- **Lifecycle Disconnect Guard**: System proxy and environment variables are unconditionally restored whenever the bound port is disabled/deleted, the core stops, or the app exits/crashes.

### 3. Profile & Subscription Management
- **Versatile Import**: Supports remote subscription URLs (with compatible User-Agent headers) and local Clash YAML file imports.
- **Automated Silent Updates**: Configurable periodic background auto-updates alongside one-click manual refresh.
- **Profile Node Inspection**: Quick modal to inspect parsed nodes and protocol types directly from any profile card.

### 4. Proxy Explorer & Batch Latency Testing
- **Visual Card Grid**: Clean card view of all parsed nodes with country/region flags and protocol badges (Shadowsocks, VMess, Trojan, VLESS, Hysteria2, etc.).
- **High-Concurrency Ping Testing**: Real-time batch latency testing with intuitive color coding (fast, normal, slow, timeout).
- **Quick-Bind Action**: Instantly launch port binding modal directly from any node card with pre-filled configuration.

### 5. Node Drift Fault-Tolerance (Drift Guard)
- If a bound node is renamed or removed during subscription updates, traffic safely falls back to DIRECT routing accompanied by a clear UI warning rather than crashing the core or failing configuration loads.

### 6. Core & Asset Lifecycle Management
- **Mihomo Core Online Upgrade**: Built-in updater to check MetaCubeX releases, view changelogs, and upgrade the Mihomo binary with one click.
- **GEO Database Maintenance**: In-app status checking and online one-click updates for GeoIP and GeoSite database files.

### 7. Desktop Integration & System Tray
- **System Tray Resident**: Minimize to system tray, quick toggle window visibility, and seamless background operation.
- **Auto-Launch on Boot**: Optional silent startup when logging into the system.
- **Real-Time Traffic Monitor**: Real-time upload/download speed and connection count indicators in the top bar.

### 8. Child Process Safety Guarantee
- Mihomo sidecar is supervised with Windows JobObject and signal handling to guarantee child processes are reliably killed on application exit or crash, preventing orphan processes.

---

## 🛠️ Tech Stack

* **Framework**: [Tauri v2](https://v2.tauri.app/)
* **Backend**: [Rust](https://www.rust-lang.org/) (2024 Edition) + [Tokio](https://tokio.rs/) async runtime
* **Frontend**: [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Tailwind CSS](https://tailwindcss.com/) + [Lucide Icons](https://lucide.dev/)
* **State Management**: [Zustand](https://github.com/pmndrs/zustand)
* **Proxy Core**: [Mihomo (Clash.Meta)](https://github.com/MetaCubeX/mihomo) Sidecar
* **Standards & Tooling**: [Biome](https://biomejs.dev/) + ESLint + `rustfmt` + Clippy

---

## 🚀 Quick Start & Development

### Prerequisites
* [Node.js](https://nodejs.org/) (>= 20.x) & [pnpm](https://pnpm.io/) (>= 9.x)
* [Rust Toolchain](https://www.rust-lang.org/tools/install) (>= 1.80.x)

### Local Setup

```bash
# 1. Clone the repository
git clone https://github.com/ygq-future/mihomo-multi.git
cd mihomo-multi

# 2. Install frontend dependencies
pnpm install

# 3. Download the Mihomo sidecar binary for current OS/Arch
pnpm dev:sidecar

# 4. Start local development
pnpm dev
# or
pnpm tauri dev
```

### Build & Package

```bash
# Code formatting and lint checks
pnpm format
pnpm lint

# Build production distributable installer
pnpm build
# or
pnpm tauri build
```

---

## 📄 License

Distributed under the [MIT License](LICENSE).
