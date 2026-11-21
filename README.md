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
- 拖动监听卡片的端口手柄到另一张卡片，可交换两张卡片的监听端口；配置通过热重载生效。
- 节点、关联端口和住宅出口选择框支持点击延迟单独测速，也可对当前筛选结果批量测速；住宅出口测速使用当前选择的上游节点。
- 支持出口 IPv4 与归属地探测，一键复制 `127.0.0.1:<端口>`、协议链接及终端 cURL 测试命令。
- **统一分段选择控件**：协议、主题等选项以连续滑块标识当前选择，支持键盘焦点提示，并遵循系统减少动态效果设置。
- **住宅出口代理链路**：可在界面管理带用户名/密码认证的 HTTP/SOCKS5 住宅代理，为端口选择订阅中转节点和住宅出口，形成 `本地端口 → 订阅节点 → 住宅出口 → 目标网站`。多个端口可共享中转节点或住宅代理，运行时链路按端口独立生成。
- 住宅出口模式统一通过链路出站，不应用国内直连、绕过列表、端口/全局分流规则及备用节点；中转节点或住宅出口缺失时拒绝连接，不回退直连。删除住宅代理前需先解除所有端口引用。住宅代理认证信息随本地应用配置保存，运行时配置包含连接所需凭据。
- 住宅出口管理支持选择订阅中转节点执行「测试连接」，无需先创建端口映射；独立临时内核检测完整链路的延迟、最终出口 IPv4 与归属地，不修改运行中的监听配置。「已配置认证」仅表示保存了凭据，连通性以测试结果为准。
- 导入订阅 YAML 时，`proxies` 节点间的 `dialer-proxy` 引用随节点名同步加上订阅命名空间，订阅重命名时也会同步更新；`DIRECT` 保留内置语义。缺失引用、循环引用、重复节点名和代理组引用会明确报错。导入的 HTTP/SOCKS5 节点保留为订阅节点，不自动添加到手动住宅出口列表。

### 2. 毫秒级无感热重载 (Hot-Reload)
- 增删改查端口映射、调整分流规则或切换绑定节点时，均通过内核 REST API 进行毫秒级热加载。
- **无需重启客户端或后台内核进程，已有长连接与下载会话不受任何干扰**。

### 3. 三段式出站接管（系统代理 & 受控 TUN 模式）与防断网守护
- **首页三段式切换**：支持在「关闭 / 系统代理 / TUN 虚拟网卡」间一键切换，全局严格单选绑定 1 个已启用端口作为唯一出口，TUN 模式配备专属视觉主题区分。
- **Windows 受控 TUN 虚拟网卡**：采用独立网卡名称（`Mihomo-Multi`）与 `mixed` 混合协议栈，内置 UAC 管理员权限检测与一键平滑提权重启。
- **智能绕过与防断网红线**：内置私有/回环网络白名单与内核级自定义直连路由；端口停用、内核停止或客户端退出时，无条件清理系统代理、环境变量并释放虚拟网卡，杜绝断网残留。

### 4. 订阅管理、节点测速与实时连接监控
- 支持远程 URL 订阅下载（自动定时更新/一键全量刷新）与本地 Clash YAML 导入。
- 节点列表支持按多订阅过滤、国家/地区识别、高并发延迟测速与排序。
- **实时连接监控**：实时查看活跃连接、上下行网速、流量统计、规则匹配链条及单连接元数据详情。

### 5. 实用系统工具与代理加速更新
- **UWP 回环豁免工具**：Windows 下支持扫描 UWP 应用、批量配置本地回环豁免；执行「一键豁免」后新安装应用自动纳入豁免，启动与刷新时自动清理已卸载应用的孤立豁免记录。
- **多级降级更新网络**：检查与下载客户端/内核更新时，自动依次尝试所有已启用的监听端口，任一端口失败即切换下一个，最后回退直连；启动时与运行期间每日各自动检查一次。
- **MRS 规则自动更新**：启动后及运行期间每隔 24 小时直接下载更新规则库，独立于程序/内核自动检查开关，后台静默执行，不检查版本、不弹出提示。
- **极低资源底噪**：基于 Tauri v2 (Rust) + React 构建，后台仅运行单个受控 Mihomo Sidecar，常驻内存低至 ~30MB。
- **原生多级托盘菜单**：按监听端口展开当前节点的启停、终端代理绑定和环境变量复制操作，支持 PowerShell、CMD、Shell/Bash/Zsh，不创建额外 WebView。终端代理绑定适用于 Windows 上已运行的 HTTP/Mixed 端口；SOCKS5 端口可复制专用命令。复制命令仅在粘贴执行的终端中生效；绑定操作写入 Windows 用户环境变量，已打开的终端可能需要重新启动。
- 托盘一级菜单提供“延迟测速”“启用 TUN”和“启用系统代理”。测速覆盖已启用监听的主备节点；两种接管模式互斥，优先沿用有效的已选端口，否则选择端口号最小的已启用监听。启用 TUN 需要管理员权限，非管理员运行时会请求提权重启。
- 端口二级菜单顶部显示主、备节点延迟，未配置备用节点时仅显示当前延迟。绑定入口随模式显示“设为系统代理”或“设为 TUN 代理”，当前绑定项显示勾选并可关闭对应模式；选择其他端口即可切换该模式的出口。启用前需启动内核并启用监听。
- 托盘端口二级菜单提供“复制出口 IP”：后台探测当前活动节点的公网 IP 后写入剪贴板；主备配置读取内核当前选中的节点。端口停用或内核停止时该操作不可用，探测失败会显示错误。
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
