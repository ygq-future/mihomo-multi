# AI 编码约束与架构开发规范 (AGENTS.md)

XERJ prefix: "mhm"

本项目为 **Mihomo Multi**，目标是实现基于 Mihomo (Clash.Meta) 内核的高性能、极简多端口代理监听绑定桌面客户端（Tauri v2 + Rust + React + TypeScript + Tailwind CSS）。

---

## 一、 架构原则与开发红线 (Architecture Redlines)

1. **功能聚焦原则（做减法）**：
   * **核心唯一职责**：实现 `Add Inbound Port Listener -> Bind Specific Proxy Node`（多端口监听与节点精确 1:1 绑定）。
   * **受控与禁止特性**：
     * ⚠️ TUN 虚拟网卡模式为**受控特性**：必须跟随一个已启用端口映射作为唯一出口、与系统代理严格互斥、需要管理员权限、退出或内核停止时随内核进程一并释放虚拟网卡；
     * ❌ 严禁引入复杂的 JavaScript/Lua 运行时脚本合并与多层分流规则集。
2. **确定性路由原则**：
   * 每一个端口必须严格通过 `IN-PORT,<port>,<node_name>` 映射至指定节点，禁止隐式模糊切换或自动轮询漂移，确保多环境隔离（如指纹浏览器）的出口 IP 确定性。
3. **配置热重载（无缝体验）**：
   * 用户新增/修改/删除/启停端口映射时，必须优先通过 Mihomo REST API (`PUT /configs?force=true`) 进行毫秒级热重载，**禁止无故重启 Mihomo 进程，已有长连接不得中断**。
4. **子进程生命周期安全**：
   * 主程序启动时拉起 Mihomo Sidecar，主程序正常退出或异常崩溃时，必须通过进程守护/JobObject/信号处理**确保后台 Mihomo 进程被彻底清理**，严禁产生孤儿僵尸进程。
5. **受控系统代理与单选互斥原则**：
   * 系统代理作为受控辅助特性，全局**严格单选互斥**（至多同时绑定 1 个已启用的监听端口），严禁隐式轮询漂移；
   * 系统代理必须支持排除域名/IP（内置私有/回环网络 + 用户自定义），并在 Windows 下联动设置用户环境变量（`all_proxy`, `http_proxy`, `https_proxy`, `no_proxy`）；
   * **生命周期安全与防断网红线**：当绑定端口停用/删除、内核停止或客户端退出时，必须无条件清理系统代理与环境变量，严禁残留导致断网。

---

## 二、 后端代码规范 (Rust / Tauri v2)

1. **工具链与格式化**：
   * 遵循 `rustfmt.toml` 配置：`max_width = 120`，`tab_spaces = 4`，`edition = "2024"`，自动导入排序。
   * 严格通过 `cargo clippy -- -D warnings`，不得忽略任何 Clippy 警告。
2. **错误处理**：
   * 业务层使用 `thiserror` 定义结构化错误类型，顶层 Tauri Command 统一返回 `Result<T, String>` 或自定义 `AppError`。
3. **网络与 I/O**：
   * 异步操作基于 `tokio` 运行时。
   * 远程订阅下载使用 `reqwest`，必须携带标准 User-Agent（如 `mihomo-multi/0.1.0 (clash.meta)`），并设置合理的连接与读取超时（15s ~ 30s）。
4. **端口安全检查**：
   * 在保存或启用端口映射前，必须调用 `std::net::TcpListener::bind(("127.0.0.1", port))` 进行前置冲突探测，若被占用需返回友好错误提示。

---

## 三、 前端代码规范 (React 19 + TypeScript + Tailwind)

1. **格式化与 Lint**：
   * 使用 **Biome** 进行格式化：单引号 (`quoteStyle: "single"`), 缩进 2 空格 (`indentWidth: 2`), 无分号风格 (`semicolons: "asNeeded"`), 行宽 80 (`lineWidth: 80`)。
   * 使用 **ESLint** 校验 React Hooks 与 TypeScript 类型安全（特殊第三方接口需使用 `unknown` 并做类型收窄）。
2. **状态管理与架构分层**：
   * 采用 **Zustand** 进行全局应用状态管理，按业务域拆分 Slice（`src/stores/`）。
   * UI 组件必须保持轻量与纯粹，所有与 Rust 后端的通信（Tauri `invoke`）统一封装在 `src/services/` 模块中，禁止在 UI 组件内部直接写裸 IPC 命令。
3. **UI 风格与设计系统**：
   * 视觉风格遵循现代极简桌面设计规范：精致圆角（`rounded-lg`）、紧凑表格与卡片质感、Lucide 图标。
   * 交互反馈：网络测速、配置热重载、订阅刷新等耗时操作必须有清晰的 Loading 状态与 Toast/Notification 反馈。
4. **基础组件通用性与复用原则**：
   * 凡是具备通用形态、可能在两处及以上复用的基础控件，必须统一下沉封装至 `src/components/common/` 模块中，严禁在不同业务页面拷贝粘贴相似的 UI 结构代码。

---

## 四、 本地开发与构建命令

* `pnpm install`：安装前端依赖。
* `pnpm dev:sidecar`：自动从 GitHub Release 下载当前平台适配的 Mihomo 二进制文件至 `src-tauri/binaries/`。
* `pnpm dev` / `pnpm dev:tauri`：启动前端或 Tauri 本地开发环境。
* `pnpm format`：执行 `biome format --write .` 格式化代码。
* `pnpm lint`：执行 `eslint .` 与 `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`。
* `pnpm typecheck`：执行 `tsc --noEmit` 类型检查。
* `pnpm test` / `pnpm test:fe`：分别运行 Rust 后端测试与前端单元测试。
* `pnpm build` / `pnpm build:tauri`：构建前端产物或 Tauri 生产分发包。

---

## 五、 Agent skills

* **Issue tracker**：`https://github.com/ygq-future/mihomo-multi.git`，见 `docs/agents/issue-tracker.md`。
* **Triage labels**：使用标准标签词汇（`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`），见 `docs/agents/triage-labels.md`。
* **Domain docs**：见 `docs/agents/domain.md`。
* **Quality Gate**：统一质量门禁为 `pnpm quality`（详见 `docs/agents/quality.md`）。迭代期间可运行针对性单阶段检查（如 `node scripts/quality-gate.mjs --stage lint:fe,typecheck`），最终交付前必须完整运行一次 `pnpm quality` 并确保全阶段通过，禁止通过禁用规则或忽略警告绕过门禁。
* **提交（Commit）规范**：一律使用 `commit.draft()` + `d.commit()`，禁止 `git add` / `git commit`（`--amend` 除外，仅用于修正本会话已产生的提交）。格式化工具（`cargo fmt`、`biome --write`）改写的行会被标记为 `unrecorded`，提交前必须检查 `draft()` 摘要：出现 `◐`（部分选中）或 `?`（Review）时，先 `d.show("<path>")` 取 hunk id，再 `d.take("<path>", "<id>", ...)` 纳入这些 hunk，最后才 `commit()`；单人工作区可直接 `d.take("**")` 全选。跳过此步会留下半截提交。
---

## 六、 版本协同与发版核对红线 (Version Synchronization & Release Redline)

1. **全链路版本一致性**：在版本迭代、更新版本号或发布新版本前，必须严格核验并确保以下 4 处配置/常量中的版本号完全一致：
   * `package.json`：`version`
   * `src-tauri/Cargo.toml`：`[package].version`
   * `src-tauri/tauri.conf.json`：`version`
   * `src/constants/app.ts`：`APP_VERSION`
2. **发版前强制检查**：在执行生产构建或推送 Release Tag 前，必须完成上述 4 处版本号核对。
3. **发布说明必须齐备 (Release Notes Mandate)**：在发布新版本、提交发版 Commit 或推送 Git Tag 之前，必须在 `docs/release-notes/<tag>.md`（例如 `docs/release-notes/v1.6.7.md`）中完整编写该版本的发布说明。GitHub Actions Release 工作流会自动读取该路径文件作为 GitHub Release 正文。
