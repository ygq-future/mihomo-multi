# Mihomo Multi (Clash Multi)

<p align="center">
  <img src="src-tauri/icons/icon.png" width="120" height="120" alt="Mihomo Multi Logo" />
</p>

<p align="center">
  <b>极简、轻量、高性能的 Mihomo (Clash.Meta) 多端口监听与代理多开桌面客户端</b>
  <br />
  <i>A Lightweight, High-Performance Multi-Port Proxy Client Based on Mihomo (Clash.Meta) & Tauri v2</i>
</p>

<p align="center">
  <a href="https://github.com/ygq-future/mihomo-multi/releases"><img src="https://img.shields.io/github/v/release/ygq-future/mihomo-multi?color=blue&label=Release" alt="Release"></a>
  <a href="https://github.com/ygq-future/mihomo-multi/releases"><img src="https://img.shields.io/github/downloads/ygq-future/mihomo-multi/total?color=success&label=Downloads" alt="Downloads"></a>
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-informational" alt="Platform">
  <img src="https://img.shields.io/badge/Kernel-Mihomo%20(Clash.Meta)-orange" alt="Kernel">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green" alt="License"></a>
</p>

---

## 📖 软件简介 (About)

**Mihomo Multi**（又称 **Clash Multi**）是一款专为**多端口监听**与**代理多开**需求打造的现代桌面客户端。

传统代理客户端通常仅开放单个全局混合端口（如 `7890`）。当您需要为不同应用分配不同节点出口（例如：`7891 -> 🇯🇵 日本`，`7892 -> 🇭🇰 香港`，`7893 -> 🇺🇸 美国`）时，传统做法往往是同时多开好几个臃肿的代理软件，导致内存飙升、端口冲突且极易串线。

**Mihomo Multi 彻底改变了这一现状**：通过单个受控的轻量级 Mihomo 内核，即可为每个本地端口精确绑定独立的出站节点，实现真正确定、隔离、零漂移的“一个软件，多个代理端口”。

> **核心定位**：专注做好 `本地端口监听 -> 1:1 精确绑定指定代理节点`，不做臃肿复杂的多层规则与虚拟网卡驱动，回归纯粹与稳定。

---

## 📸 界面预览 (Screenshots)

<p align="center">
  <img src="https://s3.bmp.ovh/2026/09/09/r8W39oUn.png" alt="Mihomo Multi 端口管理与状态概览" width="95%" />
</p>

<p align="center">
  <img src="https://s3.bmp.ovh/2026/09/09/JkjRjONa.png" alt="Mihomo Multi 添加端口监听与节点绑定" width="95%" />
</p>

<p align="center">
  <img src="https://s3.bmp.ovh/2026/09/09/1Zu9Rl5Z.png" alt="Mihomo Multi 节点列表与延迟测速" width="95%" />
</p>
---

## 🎯 为什么选择 Mihomo Multi？

| 痛点与特性 | 传统客户端“多开代理” | 🚀 Mihomo Multi |
| :--- | :--- | :--- |
| **内存与系统占用** | 多开 3~5 个客户端，内存占用 500MB~1GB+ | **单内核调度，常驻内存仅 ~30MB** |
| **端口与节点绑定** | 配置混乱，容易相互抢占端口 | **独立端口 1:1 精确映射，确定性路由** |
| **IP 漂移与串线风险**| 规则分流易误判，多账号易串 IP | **严格基于端口隔离，绝无隐式轮询漂移** |
| **配置变更体验** | 每次修改都需要重启软件或断线重连 | **毫秒级 REST API 热重载，已有长连接不断** |
| **断网与系统残留** | 退出时常残留系统代理导致断网 | **严格互斥防断网守护，退出自动彻底清理** |

---

## 💡 典型应用场景 (Use Cases)

- 🌐 **指纹浏览器多开防关联**：配合 AdsPower、Hubstudio、BitBrowser、比特浏览器等，一机分配多个独立端口，各窗口独享独立原生 IP。
- 📱 **海外多账号矩阵运营**：TikTok、Facebook、Twitter、Amazon、Shopee 等跨国业务，多账号多地区环境严格物理隔离。
- 🕷️ **网络爬虫与并发采集**：多线程或分布式爬虫为不同 Worker 赋予不同的本地监听端口，实现稳定的多出口 IP 分流。
- 💻 **开发测试与隔离排查**：前端/后端开发人员跨地区网络联调，无需频繁切换全局代理即可在不同终端直接使用不同代理。

---

## ✨ 核心功能 (Features)

### 1. 任意数量端口监听 & 1:1 节点独占绑定
- 支持创建任意数量的本地监听端口，支持 Mixed（混合代理）、纯 HTTP 与纯 SOCKS5 协议。
- 精准绑定指定节点，出站 IP 绝对确定；内置端口冲突前置检测，防止占用报错。
- 一键快速复制 `127.0.0.1:<端口>`、协议链接及终端 cURL 测试命令。

### 2. 毫秒级无感热重载 (Hot-Reload)
- 增删改查端口映射或切换绑定节点时，均通过内核 REST API 进行毫秒级热加载。
- **无需重启客户端或后台内核进程，已有长连接与下载会话不受任何干扰**。

### 3. 极低资源底噪 (Ultra-low Footprint)
- 基于 Tauri v2 (Rust) + React 构建，告别笨重的 Electron。
- 后台仅运行单个轻量 Mihomo Sidecar，占用内存低至 ~30MB，运行流畅无感知。

### 4. 受控系统代理与防断网守护 (Fail-Safe Proxy)
- **严格单选互斥**：系统代理全局至多绑定 1 个已启用端口，状态一目了然。
- **智能 Bypass 绕过**：内置私有/回环网络白名单，支持用户自定义追加绕过规则。
- **防断网保障**：端口停用、内核停止或客户端退出时，无条件清理系统代理与环境变量，杜绝断网残留。

### 5. 订阅与节点全生命周期管理
- 支持远程 URL 订阅下载（内置标准兼容 User-Agent）与本地 Clash YAML 导入。
- 支持后台自动定时更新与一键手动全量同步。
- 节点卡片化可视化展示，支持国家/地区国旗与协议徽章识别、高并发真实延迟批量测速。

---

## 📥 下载与安装 (Downloads)

前往 [GitHub Releases](https://github.com/ygq-future/mihomo-multi/releases) 下载适合您操作系统的安装包：

- **Windows**: 下载 `.msi` 或 `.exe` 安装程序直接安装运行。
- **macOS**: 下载 `.dmg` 拖入 Applications 目录即可。

> **🍏 macOS 首次打开提示“已损坏”或“无法验证开发者”？**  
> 打开终端执行以下命令解除系统的 Gatekeeper 隔离标记即可：  
> ```bash
> sudo xattr -rd com.apple.quarantine /Applications/Mihomo\ Multi.app
> ```

---

## 🛠️ 开发者快速上手 (Development)

本项目适合想要进行二次开发或自行打包的用户：

```bash
# 1. 克隆代码仓库并安装依赖
git clone https://github.com/ygq-future/mihomo-multi.git
cd mihomo-multi && pnpm install

# 2. 自动拉取适配当前平台的 Mihomo Sidecar 内核
pnpm dev:sidecar

# 3. 启动开发模式
pnpm dev:tauri

# 4. 构建生产分发安装包
pnpm build:tauri
```

---

## 🔍 核心关键词与标签 (Keywords & Tags)

为方便在搜索引擎与开源社区快速检索与匹配本工具，本仓库涵盖以下核心主题：

`clash multi` | `mihomo multi` | `clash多端口监听` | `代理多开` | `开多个代理` | `多端口代理` | `mihomo多端口` | `指纹浏览器代理` | `多出口IP代理` | `clash multi port` | `multi-port proxy listener` | `anti-detect browser proxy` | `adspower proxy` | `tauri proxy client`

> **💡 仓库维护建议**：建议在 GitHub 仓库首页右上角 `About -> Edit repository details -> Topics` 中添加以下标签：  
> `clash`, `mihomo`, `clash-multi`, `mihomo-multi`, `proxy-client`, `multi-port`, `proxy-pool`, `anti-detect-browser`, `fingerprint-browser`, `tauri-v2`, `rust`

---

## 📄 开源协议 (License)

本项目遵循 [MIT License](LICENSE) 开源协议。
