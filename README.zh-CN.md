# Mihomo Multi-Port

<p align="center">
  <img src="https://raw.githubusercontent.com/MetaCubeX/mihomo/Meta/docs/logo.png" width="100" alt="Mihomo Multi-Port Logo" />
</p>

<p align="center">
  <b>基于 Mihomo (Clash.Meta) 内核与 Tauri v2 构建的轻量级高性能多端口代理监听绑定桌面客户端。</b>
</p>

<p align="center">
  <b>简体中文</b> | <a href="README.md">English</a>
</p>

---

## 💡 为什么需要 Mihomo Multi-Port？

目前市面上的主流 Clash 客户端（如 Clash Verge Rev、FlClash 等）主要面向日常上网分流，通常仅暴露一个全局混合代理端口（如 `7890`）。

当您需要**多个独立的本地监听端口分别绑定到不同的出站节点**（例如指纹浏览器多开防关联、多账号自动化运营、分布式网络爬虫等场景，需要 `7891 -> 🇯🇵 日本01`，`7892 -> 🇭🇰 香港02`，`7893 -> 🇺🇸 美国01`）时，现有的做法只能在电脑上同时多开多个不同的客户端软件。

**Mihomo Multi-Port** 专为解决该痛点而生，采用极致聚焦与做减法的架构设计：
* 🎯 **单一核心职责**：只做 `添加端口监听 -> 精准绑定指定节点`。
* ⚡ **极低资源占用**：由单个受控的 Mihomo Sidecar 内核统一调度（内存底噪仅 ~30MB），彻底摆脱多开 GUI 客户端的笨重负担。
* 🔄 **毫秒级配置热重载**：增删改端口通过 Mihomo REST API (`PUT /configs?force=true`) 实时热加载，**不重启内核、不断开现有代理长连接**。
* 🛡️ **确定性 1:1 路由**：严格基于 `IN-PORT` 规则精确路由，杜绝隐式负载均衡或多账号 IP 串线漂移。
* 🚀 **零无用包袱**：无 TUN 虚拟网卡、无系统代理劫持抢占、无复杂的合并脚本插件。

---

## ✨ 核心特性

- **多端口入站管理**：自由配置任意数量的本地入站端口（支持 Mixed 混合模式、纯 HTTP、纯 SOCKS5），各端口独立绑定节点。
- **端口冲突前置探测**：保存或启用前自动探测本地端口占用情况，防止报错。
- **订阅与配置管理**：支持远程 URL 订阅拉取（带防拦截 User-Agent）与本地 Clash YAML 导入，支持后台定时自动同步更新。
- **节点展示与并发测速**：直观卡片展示所有解析节点及协议类型（SS、VMess、Trojan、VLESS、Hysteria2），支持一键批量高并发测速。
- **快捷绑定入口**：在节点卡片上一键唤起端口绑定，自动预填节点。
- **快捷复制工具**：一键复制 `127.0.0.1:<端口>`、`http://...`、`socks5://...` 或 cURL 命令行代理格式。
- **节点更名与失效防护**：若订阅更新后绑定的节点名称变更或下线，端口安全降级为 DIRECT 直连并伴随 UI 显式警告，**绝不引发内核崩溃**。
- **现代暗黑 UI**：对齐 Clash Verge Rev 设计美学，支持精致暗黑/亮色主题切换。

---

## 🛠️ 技术栈

* **后端**：[Tauri v2](https://v2.tauri.app/) + [Rust](https://www.rust-lang.org/) (2024 Edition)
* **前端**：[React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Tailwind CSS](https://tailwindcss.com/) + [Lucide Icons](https://lucide.dev/)
* **状态管理**：[Zustand](https://github.com/pmndrs/zustand)
* **代理内核**：[Mihomo (Clash.Meta)](https://github.com/MetaCubeX/mihomo) Sidecar 伴生进程
* **代码规范**：[Biome](https://biomejs.dev/) (格式化) + ESLint + `rustfmt` + Clippy

---

## 🚀 快速上手与本地开发

### 环境要求
* [Node.js](https://nodejs.org/) (>= 20.x) & [pnpm](https://pnpm.io/) (>= 9.x)
* [Rust 工具链](https://www.rust-lang.org/tools/install) (>= 1.80.x)

### 本地运行

```bash
# 1. 克隆代码仓库
git clone https://github.com/ygq-future/mihomo-multi.git
cd mihomo-multi

# 2. 安装前端依赖
pnpm install

# 3. 自动下载适配当前操作系统的 Mihomo Sidecar 内核
pnpm dev:sidecar

# 4. 启动本地开发环境
pnpm tauri dev
```

### 构建与打包

```bash
# 代码格式化与规范检查
pnpm format
pnpm lint

# 构建生产分发包
pnpm tauri build
```

---

## 🗺️ 开发路线与工单 (Roadmap)

项目开发通过 GitHub Issues 追踪推进：
* 📋 [Spec: Mihomo Multi-Port Proxy Management Application](https://github.com/ygq-future/mihomo-multi/issues/1)
* 🎫 [#2: 项目脚手架与 Sidecar 进程守护](https://github.com/ygq-future/mihomo-multi/issues/2)
* 🎫 [#3: 订阅与配置管理模块 (Profiles)](https://github.com/ygq-future/mihomo-multi/issues/3)
* 🎫 [#4: 节点展示与并发延迟测速 (Proxies)](https://github.com/ygq-future/mihomo-multi/issues/4)
* 🎫 [#5: 多端口监听与 1:1 节点绑定核心引擎](https://github.com/ygq-future/mihomo-multi/issues/5)
* 🎫 [#6: 后台定时自动更新与节点漂移安全防护](https://github.com/ygq-future/mihomo-multi/issues/6)
* 🎫 [#7: 跨平台 GitHub Actions CI/CD 发布流水线](https://github.com/ygq-future/mihomo-multi/issues/7)

---

## 📄 开源协议

本项目采用 [GPL-3.0 License](LICENSE) 开源协议。
