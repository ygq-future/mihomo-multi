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
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-informational" alt="Platform">
  <img src="https://img.shields.io/badge/Kernel-Mihomo%20(Clash.Meta)-orange" alt="Kernel">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green" alt="License"></a>
</p>

---

## 📖 软件简介 (About)

**Mihomo Multi**（又称 **Clash Multi**）是一款专为**多端口监听**与**代理多开**需求打造的现代桌面客户端。

传统代理客户端通常仅开放单个全局混合端口（如 `7890`）。当您需要为不同应用分配不同节点出口（例如：`7891 -> 🇯🇵 日本`，`7892 -> 🇭🇰 香港`，`7893 -> 🇺🇸 美国`）时，传统做法往往是同时多开好几个臃肿的代理软件，导致内存飙升、端口冲突且极易串线。

**Mihomo Multi 彻底改变了这一现状**：通过单个受控的轻量级 Mihomo 内核，即可为每个本地端口精确绑定独立的出站节点，实现真正确定、隔离、零漂移的“一个软件，多个代理端口”。

> **核心定位**：专注做好 `本地端口监听 -> 1:1 精确绑定指定代理节点`，辅以端口级特定网站分流、受控系统代理与 TUN 虚拟网卡模式，拒绝臃肿脚本与隐式漂移，回归确定性与纯粹稳定。

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

### 1. 任意数量端口监听、主备容灾与特定网站分流
- 支持创建任意数量的本地监听端口（Mixed 混合、HTTP、SOCKS5）及固定 `DIRECT` 直连对照端口，内置端口占用前置检测。
- **确定性路由 + 端口级分流**：每个端口 1:1 绑定主出站节点并支持配置备用容灾节点（Fallback）；支持为单个端口配置**特定网站分流规则**（指定域名走特定节点或直连）并支持靶向实时测速。
- 支持出口 IPv4 与归属地探测，一键复制 `127.0.0.1:<端口>`、协议链接及终端 cURL 测试命令。

### 2. 毫秒级无感热重载 (Hot-Reload)
- 增删改查端口映射、调整分流规则或切换绑定节点时，均通过内核 REST API 进行毫秒级热加载。
- **无需重启客户端或后台内核进程，已有长连接与下载会话不受任何干扰**。

### 3. 三段式出站接管（系统代理 & 受控 TUN 模式）与防断网守护
- **首页三段式切换**：支持在「关闭 / 系统代理 / TUN 虚拟网卡」间一键切换，全局严格单选绑定 1 个已启用端口作为唯一出口，TUN 模式配备专属视觉主题区分。
- **Windows 受控 TUN 虚拟网卡**：采用独立网卡名称（`Mihomo-Multi`）与 `gvisor` 协议栈，内置 UAC 管理员权限检测与一键平滑提权重启。
- **智能绕过与防断网红线**：内置私有/回环网络白名单与内核级自定义直连路由；端口停用、内核停止或客户端退出时，无条件清理系统代理、环境变量并释放虚拟网卡，杜绝断网残留。

### 4. 订阅管理、节点测速与实时连接监控
- 支持远程 URL 订阅下载（自动定时更新/一键全量刷新）与本地 Clash YAML 导入。
- 节点列表支持按多订阅过滤、国家/地区识别、高并发延迟测速与排序。
- **实时连接监控**：实时查看活跃连接、上下行网速、流量统计、规则匹配链条及单连接元数据详情。

### 5. 实用系统工具与代理加速更新
- **UWP 回环豁免工具**：Windows 下支持扫描 UWP 应用、批量配置本地回环豁免，并在刷新时自动清理已卸载应用的孤立豁免记录。
- **自定义出口代理更新**：支持在设置中指定已启用的本地代理端口，用于加速客户端版本升级与 Mihomo 内核在线更新。
- **极低资源底噪**：基于 Tauri v2 (Rust) + React 构建，后台仅运行单个受控 Mihomo Sidecar，常驻内存低至 ~30MB。
---

## 📥 下载与安装 (Downloads)

前往 [GitHub Releases](https://github.com/ygq-future/mihomo-multi/releases) 下载适合您操作系统的安装包：

- **Windows (x64 / ARM64)**: 提供 `.exe` (NSIS 安装包)、`.zip` (免安装便携版，解压即用) 与 `.msi` 安装程序。
- **macOS (Apple Silicon / Intel / Universal)**: 下载对应架构的 `.dmg` 镜像并拖入 Applications 目录。
- **Linux (x86_64)**: 提供 `.AppImage`、`.deb` 安装包与 `.tar.gz` 便携归档包。

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
