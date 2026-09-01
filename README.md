# Mihomo Multi-Port

<p align="center">
  <img src="https://raw.githubusercontent.com/MetaCubeX/mihomo/Meta/docs/logo.png" width="100" alt="Mihomo Multi-Port Logo" />
</p>

<p align="center">
  <b>A lightweight, high-performance desktop client for multi-port proxy listener binding powered by Mihomo (Clash.Meta) and Tauri v2.</b>
</p>

<p align="center">
  <a href="README.zh-CN.md">简体中文</a> | <b>English</b>
</p>

---

## 💡 Why Mihomo Multi-Port?

Most mainstream Clash GUI clients (Clash Verge Rev, FlClash, etc.) are designed for general web browsing and expose only a single global mixed proxy port (e.g. `7890`).

When you need **multiple independent local proxy ports routed to different egress proxy nodes** (e.g. for fingerprint browsers, multi-account automation, web crawlers, or isolated environments like `7891 -> 🇯🇵 Japan 01`, `7892 -> 🇭🇰 Hong Kong 02`, `7893 -> 🇺🇸 US 01`), the existing workaround was running multiple heavy GUI applications simultaneously.

**Mihomo Multi-Port** solves this with an ultra-focused, minimalist architecture:
* 🎯 **Single Responsibility**: Pure `Add Port Listener -> Bind Specific Proxy Node`.
* ⚡ **Ultra-Low Resource Footprint**: Runs on a single managed Mihomo sidecar core (~30MB RAM), eliminating the overhead of multiple GUI clients.
* 🔄 **Millisecond Hot-Reload**: Configuration changes are applied in real-time via Mihomo REST API (`PUT /configs?force=true`) without killing processes or dropping active connections.
* 🛡️ **Deterministic 1:1 Routing**: Strict `IN-PORT` rules ensure each port never drifts or randomly switches IP addresses.
* 🚀 **Zero Unnecessary Bloat**: No TUN virtual adapters, no system proxy hijacking, and no complex script plugins.

---

## ✨ Key Features

- **Multi-Port Inbound Management**: Configure unlimited local listening ports (Mixed, pure HTTP, or pure SOCKS5) bound to distinct nodes.
- **Port Conflict Protection**: Automatically tests port availability before binding to avoid crashes.
- **Profile & Subscription Management**: Import remote subscription URLs (with custom User-Agent) and local Clash-format YAML files, with periodic background auto-updates.
- **Node Explorer & Batch Latency Testing**: View all parsed proxy nodes with protocol badges (SS, VMess, Trojan, VLESS, Hysteria2) and perform high-concurrency ping testing.
- **Quick-Bind Action**: Bind any node to a new port directly from the node card with one click.
- **One-Click Proxy Helpers**: Instantly copy `127.0.0.1:<port>`, `http://...`, `socks5://...`, or ready-to-run cURL commands.
- **Node Drift Fault-Tolerance**: If a bound node is renamed or removed during a subscription update, traffic safely routes to DIRECT with a visual UI warning rather than crashing the core.
- **Modern UI**: Polished dark/light theme matching Clash Verge Rev design aesthetics.

---

## 🛠️ Tech Stack

* **Backend**: [Tauri v2](https://v2.tauri.app/) + [Rust](https://www.rust-lang.org/) (2024 Edition)
* **Frontend**: [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Tailwind CSS](https://tailwindcss.com/) + [Lucide Icons](https://lucide.dev/)
* **State Management**: [Zustand](https://github.com/pmndrs/zustand)
* **Proxy Core**: [Mihomo (Clash.Meta)](https://github.com/MetaCubeX/mihomo) Sidecar
* **Code Standards**: [Biome](https://biomejs.dev/) (Formatting) + ESLint + `rustfmt` + Clippy

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

# 2. Install dependencies
pnpm install

# 3. Download the Mihomo sidecar binary for your current OS/Arch
pnpm dev:sidecar

# 4. Start local development
pnpm tauri dev
```

### Build & Package

```bash
# Format & Lint
pnpm format
pnpm lint

# Build production bundle
pnpm tauri build
```

---

## 🗺️ Roadmap & Issues

Development is tracked via GitHub Issues:
* 📋 [Spec: Mihomo Multi-Port Proxy Management Application](https://github.com/ygq-future/mihomo-multi/issues/1)
* 🎫 [#2: Project Scaffold & Sidecar Supervisor](https://github.com/ygq-future/mihomo-multi/issues/2)
* 🎫 [#3: Profile & Subscription Management](https://github.com/ygq-future/mihomo-multi/issues/3)
* 🎫 [#4: Proxy Exploration & Batch Latency Testing](https://github.com/ygq-future/mihomo-multi/issues/4)
* 🎫 [#5: Multi-Port Inbound Listeners & 1:1 Node Binding](https://github.com/ygq-future/mihomo-multi/issues/5)
* 🎫 [#6: Background Auto-Updater & Fault-Tolerance](https://github.com/ygq-future/mihomo-multi/issues/6)
* 🎫 [#7: Cross-Platform Release Pipeline](https://github.com/ygq-future/mihomo-multi/issues/7)

---

## 📄 License

Distributed under the [MIT License](LICENSE).
