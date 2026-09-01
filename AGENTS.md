# AI 编码约束与架构开发规范 (AGENTS.md / CLAUDE.md)

本项目为 **Mihomo Multi-Port**，目标是实现基于 Mihomo (Clash.Meta) 内核的高性能、极简多端口代理监听绑定桌面客户端（Tauri v2 + Rust + React + TypeScript + Tailwind CSS）。

所有参与本项目代码编写的 AI Agent 与开发者必须严格遵守以下规则与约束：

---

## 一、 架构原则与开发红线 (Architecture Redlines)

1. **功能聚焦原则（做减法）**：
   * **核心唯一职责**：实现 `Add Inbound Port Listener -> Bind Specific Proxy Node`（多端口监听与节点精确 1:1 绑定）。
   * **严禁引入以下特性**：
     * ❌ 严禁引入 TUN 虚拟网卡模式与驱动安装；
     * ❌ 严禁引入系统代理自动劫持（System Proxy Takeover）；
     * ❌ 严禁引入复杂的 JavaScript/Lua 运行时脚本合并与多层分流规则集。
2. **确定性路由原则**：
   * 每一个端口必须严格通过 `IN-PORT,<port>,<node_name>` 映射至指定节点，禁止隐式模糊切换或自动轮询漂移，确保多环境隔离（如指纹浏览器）的出口 IP 确定性。
3. **配置热重载（无缝体验）**：
   * 用户新增/修改/删除/启停端口映射时，必须优先通过 Mihomo REST API (`PUT /configs?force=true`) 进行毫秒级热重载，**禁止无故重启 Mihomo 进程，已有长连接不得中断**。
4. **子进程生命周期安全**：
   * 主程序启动时拉起 Mihomo Sidecar，主程序正常退出或异常崩溃时，必须通过进程守护/JobObject/信号处理**确保后台 Mihomo 进程被彻底清理**，严禁产生孤儿僵尸进程。

---

## 二、 后端代码规范 (Rust / Tauri v2)

1. **工具链与格式化**：
   * 遵循 `rustfmt.toml` 配置：`max_width = 120`，`tab_spaces = 4`，`edition = "2024"`，自动导入排序。
   * 严格通过 `cargo clippy -- -D warnings`，不得忽略任何 Clippy 警告。
2. **错误处理**：
   * 生产代码中**严禁使用 `unwrap()` 或 `expect()`**。
   * 业务层使用 `thiserror` 定义结构化错误类型，顶层 Tauri Command 统一返回 `Result<T, String>` 或自定义 `AppError`。
3. **网络与 I/O**：
   * 异步操作基于 `tokio` 运行时。
   * 远程订阅下载使用 `reqwest`，必须携带标准 User-Agent（如 `clash-verge/v2.0.0 (mihomo-multi)`），并设置合理的连接与读取超时（15s ~ 30s）。
4. **端口安全检查**：
   * 在保存或启用端口映射前，必须调用 `std::net::TcpListener::bind(("127.0.0.1", port))` 进行前置冲突探测，若被占用需返回友好错误提示。

---

## 三、 前端代码规范 (React 19 + TypeScript + Tailwind)

1. **格式化与 Lint**：
   * 使用 **Biome** 进行格式化：单引号 (`quoteStyle: "single"`), 缩进 2 空格 (`indentWidth: 2`), 无分号风格 (`semicolons: "asNeeded"`), 行宽 80 (`lineWidth: 80`)。
   * 使用 **ESLint** 校验 React Hooks 与 TypeScript 类型安全，禁止使用 `any`（特殊第三方接口需使用 `unknown` 并做类型收窄）。
2. **状态管理与架构分层**：
   * 采用 **Zustand** 进行全局应用状态管理（`useAppStore`），区分 `PortMappingSlice`, `ProfileSlice`, `NodeSlice`, `SettingSlice`。
   * UI 组件必须保持轻量与纯粹，所有与 Rust 后端的通信（Tauri `invoke`）统一封装在 `src/services/` 模块中，禁止在 UI 组件内部直接写裸 IPC 命令。
3. **UI 风格与设计系统**：
   * 视觉风格对齐 **Clash Verge Rev**：现代暗黑/明亮主题自适应、精致圆角（`rounded-lg`）、紧凑表格与卡片质感、Lucide 图标。
   * 交互反馈：网络测速、配置热重载、订阅刷新等耗时操作必须有清晰的 Loading 状态与 Toast/Notification 反馈。

---

## 四、 核心数据模型参考

```typescript
// 端口映射
export interface PortMapping {
  id: string
  port: number
  protocol: 'mixed' | 'http' | 'socks5'
  profileId: string
  nodeName: string
  enabled: boolean
  latency?: number
  description?: string
}

// 订阅配置
export interface ProfileItem {
  id: string
  name: string
  type: 'remote' | 'local'
  url?: string
  filePath: string
  autoUpdateIntervalMins: number // 0 为不自动更新
  lastUpdatedAt: number
  nodeCount: usize
}

// 代理节点
export interface ProxyNode {
  name: string
  type: string
  server: string
  port: number
  latency?: number
}
```

---

## 五、 本地开发与构建命令标准

* `pnpm install`：安装前端依赖。
* `pnpm dev:sidecar`：自动从 GitHub Release 下载当前平台适配的 Mihomo 二进制文件至 `src-tauri/binaries/`。
* `pnpm dev` / `pnpm tauri dev`：启动本地开发环境。
* `pnpm format`：执行 `biome format --write .` 格式化代码。
* `pnpm lint`：执行 `eslint` 与 `cargo clippy` 检查。
* `pnpm build` / `pnpm tauri build`：构建生产分发包。

---

## 六、 Agent skills

### Issue tracker

Issues and specs are tracked via GitHub Issues (`https://github.com/ygq-future/mihomo-multi.git`). See `docs/agents/issue-tracker.md`.

### Triage labels

Uses canonical triage label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (`CONTEXT.md` at root, system ADRs in `docs/adr/`). See `docs/agents/domain.md`.

---

## 七、 严格交互与确认约束 (Strict Interaction Protocol)

除了用户明确输入了 `/<command>` 之类的 skill 或指令（如 `/impl` 等显式自动化指令）以外，当用户对某些功能抱有疑问、要求排查问题、分析缺陷、或要求做某些具体事情时，**严禁未经确认直接修改代码或盲目执行操作**。代理必须严格遵守以下确认流程：

1. **先输出思考与理解**：清晰告知用户你是如何理解用户所说的话和其核心诉求的；
2. **说明思路与解决路径**：说明你分析问题的思路、可能的根因排查方向或功能实现策略；
3. **列出具体行动计划**：明确说明你可能会怎么做（将要修改哪些文件、执行哪些命令、调整哪些逻辑）；
4. **说明预期结果与影响**：清晰阐述完成操作之后的预期结果、系统行为变化及是否有潜在副作用；
5. **等待用户明确确认**：将上述信息完整反馈给用户，**只有在得到用户的明确回复与确认后，方可开始具体修改或执行操作**。


