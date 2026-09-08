# Mihomo Multi-Port

<p align="center">
  <img src="src-tauri/icons/icon.png" width="128" height="128" alt="Mihomo Multi-Port Logo" />
</p>

<p align="center">
  <b>基于 Mihomo (Clash.Meta) 内核与 Tauri v2 构建的轻量级高性能多端口代理监听绑定桌面客户端。</b>
</p>

---

## 💡 为什么需要 Mihomo Multi-Port？

传统主流代理桌面客户端主要面向个人日常上网分流，通常仅开放一个全局混合代理端口（如 `7890`）。

当您需要**多个独立的本地监听端口分别绑定到不同的出站节点**时（例如：指纹浏览器多开防关联、多账号自动化运营、分布式网络爬虫、跨环境隔离测试，要求 `7891 -> 🇯🇵 日本01`，`7892 -> 🇭🇰 香港02`，`7893 -> 🇺🇸 美国01`），传统方案往往需要同时开启多个笨重的客户端软件，导致系统资源极度浪费且配置繁琐。

**Mihomo Multi-Port** 专为解决该痛点而生，采用极致聚焦与做减法的架构设计：
* 🎯 **单一核心职责**：只做 `添加本地端口监听 -> 精准 1:1 绑定指定节点`。
* ⚡ **极低资源底噪**：由单个受控的 Mihomo Sidecar 内核统一调度，后台内存占用极低（~30MB），告别多开臃肿客户端。
* 🔄 **毫秒级配置热重载**：新增、修改、删除或启停端口映射时，均通过 Mihomo REST API 实时无缝热加载，**不重启内核进程，不断开现有长连接**。
* 🛡️ **确定性 1:1 路由**：严格基于 `IN-PORT` 规则精确出站，杜绝隐式轮询漂移与多账号 IP 串线风险。
* 🚀 **零无用包袱**：不引入 TUN 虚拟网卡驱动，不引入复杂的外部分流脚本，运行稳定轻巧。

---

## ✨ 核心特性

### 1. 多端口独立监听与 1:1 精确绑定
- **灵活入站协议**：支持配置任意数量的本地入站端口，支持 Mixed（混合代理）、纯 HTTP、纯 SOCKS5 协议。
- **端口冲突前置探测**：在保存或启用端口前，自动调用系统网络栈探测本地端口可用性，防止端口占用导致错误。
- **独立启停与编辑**：各端口独立受控，支持单独启用、停用、切换绑定节点或修改描述。
- **一键快捷复制**：集成快捷复制菜单，一键复制 `127.0.0.1:<端口>`、`http://...`、`socks5://...` 或可直接在终端运行的 cURL 代理测试命令。

### 2. 受控系统代理与防断网守护
- **严格单选互斥**：系统代理全局严格单选，至多同时绑定 1 个已启用的监听端口，状态清晰可溯。
- **智能 Bypass 绕过名单**：内置私有网络与回环地址（`localhost`、`127.*`、`10.*`、`192.168.*` 等），支持用户自定义追加绕过域名或 IP。
- **系统环境变量联动**：Windows 平台下开启系统代理时，联动设置当前用户级环境变量（`all_proxy`、`http_proxy`、`https_proxy`、`no_proxy`），全面覆盖终端与命令行工具。
- **生命周期安全红线**：当绑定端口停用/删除、内核停止或客户端正常退出/异常崩溃时，自动强制清理系统代理与环境变量设置，**彻底杜绝断网残留**。

### 3. 订阅与配置闭环管理
- **多样化导入方式**：支持远程订阅 URL 下载拉取（携带标准兼容 User-Agent）与本地 Clash YAML 文件导入。
- **自动化静默同步**：支持设置后台定时自动更新间隔，亦支持一键手动全量同步。
- **订阅内置节点检视**：内置卡片式弹窗，无需切换页面即可快速查看特定订阅下解析出的全部节点列表与类型。

### 4. 节点仪表盘与高并发批量测速
- **可视化网格呈现**：卡片式直观呈现所有解析节点，自动识别并显示所属国家/地区旗帜与协议类型徽章（Shadowsocks、VMess、Trojan、VLESS、Hysteria2 等）。
- **高并发真实延迟测速**：直观展示节点可用性与真实延迟，色标区分优/良/差/超时。
- **卡片快捷一键绑定**：在节点卡片上一键发起端口映射创建，自动预填该节点，简化配置操作。

### 5. 节点漂移安全防护 (Drift Guard)
- 当订阅更新后，若原已绑定的节点被机场服务商重命名或下线，防护引擎会自动将该端口的流量安全降级至 DIRECT 直连并伴随 UI 显式告警，**绝不引发内核配置解析失败或程序崩溃**。

### 6. 内核与规则资产在线运维
- **Mihomo 内核在线升级**：内置内核更新检测器，支持在线检查官方最新发布版本、查看 Release 说明，并支持一键热下载升级。
- **GEO 规则数据库运维**：支持一键检查并在线更新 GeoIP 与 GeoSite 数据库资产。

### 7. 桌面集成与系统托盘
- **系统托盘驻留**：支持最小化至托盘、快捷显示/隐藏主窗口与一键退出。
- **开机自启动**：支持设置随系统开机静默自启。
- **实时流量监控**：顶部导航栏集成实时上行/下行速率与连接数监测。

### 8. 子进程生命周期守护
- 主程序启动时拉起 Mihomo Sidecar 伴生进程，利用 Windows JobObject 与进程信号处理机制将内核与主程序生命周期深度绑定，退出或崩溃时彻底清理，**严禁产生后台孤儿僵尸进程**。

---

## 🛠️ 技术栈

* **核心框架**：[Tauri v2](https://v2.tauri.app/)
* **后端语言**：[Rust](https://www.rust-lang.org/) (2024 Edition) + [Tokio](https://tokio.rs/) 异步运行时
* **前端技术**：[React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Tailwind CSS](https://tailwindcss.com/) + [Lucide Icons](https://lucide.dev/)
* **全局状态**：[Zustand](https://github.com/pmndrs/zustand)
* **底层代理内核**：[Mihomo (Clash.Meta)](https://github.com/MetaCubeX/mihomo) Sidecar
* **工程化规范**：[Biome](https://biomejs.dev/) + ESLint + `rustfmt` + Clippy

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

# 3. 自动下载适配当前操作系统的 Mihomo Sidecar 二进制
pnpm dev:sidecar

# 4. 启动本地开发环境
pnpm dev
# 或
pnpm tauri dev
```

### 构建打包

```bash
# 代码格式化与语法检查
pnpm format
pnpm lint

# 构建生产分发安装包
pnpm build
# 或
pnpm tauri build
```

---

## 📄 开源协议

本项目采用 [MIT License](LICENSE) 开源协议。
