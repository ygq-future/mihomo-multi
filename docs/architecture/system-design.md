# Mihomo Multi-Port 详细系统架构与设计规范

## 一、 系统架构全景与模块职责划分

`mihomo-multi` 采用 **Tauri v2 (Rust) + React 19 (TypeScript) + Tailwind CSS + Mihomo (Clash.Meta) Sidecar** 架构，各模块保持高内聚、低耦合。

```
+--------------------------------------------------------------------------------------------------------------------+
|                                                  Frontend (React 19)                                               |
|  +--------------------------------------------------------------------------------------------------------------+  |
|  | Shell Layout: Sidebar Navigation (Port Manager | Proxies | Profiles | Settings) & Titlebar                   |  |
|  +--------------------------------------------------------------------------------------------------------------+  |
|  | Views:                                                                                                       |  |
|  | - PortTableView: Port list, Add/Edit modal, Status badge, Quick Copy proxy string                           |  |
|  | - ProxyGridView: Node cards, Latency indicators, Batch speed-test trigger, Filter/Search, Quick-bind action   |  |
|  | - ProfileListView: Remote URL / Local YAML import, Auto-update interval, Manual refresh, Node count badge     |  |
|  | - SettingView: Controller port, Auto-start, Log viewer, Theme toggle                                         |  |
|  +--------------------------------------------------------------------------------------------------------------+  |
|  | State Layer: Zustand Stores (usePortStore, useProfileStore, useProxyStore, useSettingStore)                    |  |
|  | Service Layer: Typed IPC Wrapper (invoke('cmd_xxx'))                                                         |  |
+----------------------------------------------------------+---------------------------------------------------------+
                                                           | Tauri IPC (Commands & Events)
+----------------------------------------------------------v---------------------------------------------------------+
|                                                  Backend (Rust / Tauri v2)                                         |
|  +------------------------+  +------------------------+  +------------------------+  +--------------------------+  |
|  | 1. Profile Manager     |  | 2. Config Generator    |  | 3. Core Supervisor     |  | 4. External API Client   |  |
|  | - reqwest fetch        |  | - Compile listeners    |  | - Spawn mihomo sidecar |  | - PUT /configs (reload)  |  |
|  | - parse yaml proxies   |  | - 1:1 IN-PORT rules    |  | - JobObject / kill on  |  | - GET /proxies/../delay  |  |
|  | - profile storage      |  | - Safety DIRECT fallback|  exit/crash           |  | - GET /traffic           |  |
|  +------------------------+  +------------------------+  +------------------------+  +--------------------------+  |
|  +------------------------+  +------------------------+  +------------------------+  +--------------------------+  |
|  | 5. Port Conflict Probe |  | 6. Auto-Update Worker  |  | 7. Storage Engine      |  | 8. Tauri Commands        |  |
|  | - TcpListener bind     |  | - tokio interval timer |  | - tauri-plugin-store   |  | - Typed handlers         |  |
|  | - port availability    |  | - background sync      |  | - settings.json        |  | - Input validation       |  |
|  +------------------------+  +------------------------+  +------------------------+  +--------------------------+  |
+----------------------------------------------------------+---------------------------------------------------------+
                                                           | HTTP REST (127.0.0.1:9999) / Process I/O
+----------------------------------------------------------v---------------------------------------------------------+
|                                                  Mihomo Core (Sidecar)                                             |
|  - Multi-Inbound Listeners (7891, 7892, 7893... Mixed/Socks5/Http)                                                |
|  - Deterministic 1:1 Routing (IN-PORT,7891,NodeA; IN-PORT,7892,NodeB; MATCH,DIRECT)                               |
|  - In-memory High Concurrency Ping Engine (delay testing)                                                          |
+--------------------------------------------------------------------------------------------------------------------+
```

---

## 二、 模块详细设计与实现方案

### 2.1 模块一：端口监听管理器 (Port Mapping Manager)

#### 1. 功能清单
* **端口列表展示**：端口号、协议类型（`Mixed` / `HTTP` / `SOCKS5`）、所属订阅名、绑定节点名、实时延迟、启停开关、操作（测速、编辑、删除、快捷复制）。
* **端口添加/编辑**：
  * 输入端口号（范围 1024 ~ 65535）。
  * 选择协议类型（默认 `Mixed`，兼具 HTTP 与 SOCKS5 代理功能）。
  * 节点选择下拉框（支持按地区、节点名模糊搜索）。
  * 端口可用性前置校验（调用 `PortProbe` 探测是否被本地其他软件占用）。
* **快捷复制代理地址**：
  * 一键复制为 `127.0.0.1:<port>`（纯地址）；
  * 一键复制为 `http://127.0.0.1:<port>`；
  * 一键复制为 `socks5://127.0.0.1:<port>`；
  * 一键复制为 cURL 命令：`curl -x http://127.0.0.1:<port> https://ipinfo.io`。
* **增删改毫秒级热重载**：任何端口项的修改触发配置重新编译，并通过 `ClashApiClient::reload_config` 实时推送给 Mihomo 内核，**无需重启进程**。

#### 2. Rust 后端接口设计
```rust
#[tauri::command]
pub async fn get_port_mappings(state: State<'_, AppState>) -> Result<Vec<PortMapping>, String>;

#[tauri::command]
pub async fn save_port_mapping(
    mapping: PortMapping,
    state: State<'_, AppState>,
) -> Result<PortMapping, String>;

#[tauri::command]
pub async fn delete_port_mapping(id: String, state: State<'_, AppState>) -> Result<(), String>;

#[tauri::command]
pub async fn toggle_port_mapping(
    id: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<(), String>;

#[tauri::command]
pub async fn check_port_available(port: u16) -> Result<bool, String>;
```

---

### 2.2 模块二：订阅与节点管理器 (Profile & Proxy Manager)

#### 1. 功能清单
* **远程订阅导入**：输入订阅名称、URL 链接、自动更新周期（如 0h、6h、12h、24h）。
* **本地 YAML 导入**：支持文件选择器与拖拽导入本地 Clash 格式 YAML 文件。
* **订阅卡片操作**：手动触发更新、编辑更新周期、查看包含节点总数、查看上次更新时间、删除订阅。
* **节点展示卡片网格 (Proxies View)**：
  * 卡片信息：国家/地区 Flag、节点名称、协议标签（SS/VMess/Trojan/VLESS/Hysteria2）、节点服务器与端口、测速延迟数值（带绿色/黄色/红色指示灯）。
  * **一键批量测速**：并发调用内核测速接口，实时回填延迟至 UI 卡片。
  * **快捷绑定动作**：点击卡片上的「+ 绑定到新端口」，直接唤起添加端口弹窗并自动预选当前节点。

#### 2. Rust 后端接口设计
```rust
#[tauri::command]
pub async fn get_profiles(state: State<'_, AppState>) -> Result<Vec<ProfileItem>, String>;

#[tauri::command]
pub async fn add_remote_profile(
    name: String,
    url: String,
    interval_mins: u32,
    state: State<'_, AppState>,
) -> Result<ProfileItem, String>;

#[tauri::command]
pub async fn add_local_profile(
    name: String,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<ProfileItem, String>;

#[tauri::command]
pub async fn update_profile(id: String, state: State<'_, AppState>) -> Result<ProfileItem, String>;

#[tauri::command]
pub async fn delete_profile(id: String, state: State<'_, AppState>) -> Result<(), String>;

#[tauri::command]
pub async fn get_profile_nodes(
    profile_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ProxyNode>, String>;
```

---

### 2.3 模块三：配置生成与内核守护引擎 (Config Generator & Core Supervisor)

#### 1. 功能清单
* **动态编译 `runtime.yaml`**：
  * 读取激活的订阅 YAML 文件中的 `proxies` 和 `proxy-providers`。
  * 将所有处于 `enabled: true` 的 `PortMapping` 转换为 `listeners` 数组条目。
  * 为每个启用的端口生成 `IN-PORT,<port>,<node_name>` 规则。
  * 尾部追加 `MATCH,DIRECT` 兜底规则。
  * 写入应用的临时运行时路径 `%APPDATA%\mihomo-multi\runtime.yaml`。
* **Mihomo Sidecar 生命周期守护**：
  * 启动参数：`mihomo.exe -d %APPDATA%\mihomo-multi -f %APPDATA%\mihomo-multi\runtime.yaml`。
  * 启动前分配专属外部控制器端口（默认 `127.0.0.1:9999`）与随机 Secret。
  * 进程退出清理：利用 Windows JobObject（或 Unix `kill(SIGTERM)`）确保主应用退出或崩溃时子进程 100% 连带销毁。

---

### 2.4 模块四：Mihomo External API 客户端 (ClashApiClient)

#### 1. 功能清单
* **配置热重载 (`PUT /configs?force=true`)**：
  * 当用户保存、修改、删除端口映射或更新订阅时，调用热重载接口，耗时 < 50ms。
* **单节点与批量并发测速 (`GET /proxies/{name}/delay`)**：
  * 测速目标：`http://www.gstatic.com/generate_204`（或 Cloudflare 204），超时 3000ms。
  * 前端触发批量测速时，后端使用 `tokio::task::JoinSet` 以 10~20 并发度快速完成全量节点测速并流式返回结果。

---

### 2.5 模块五：后台定时自动更新工作器 (Auto-Update Worker)

#### 1. 功能清单
* 应用启动后拉起后台异步任务（`tokio::spawn`）。
* 每隔 10 分钟轮询一次所有已配置的远程订阅：
  * 判断 `now - last_updated_at >= auto_update_interval_mins * 60`。
  * 若到达更新周期，静默拉取最新订阅 YAML。
  * 重新生成 `runtime.yaml` 并调用热重载。
  * 向前端发送 `profile-updated` 事件通知 UI 刷新。

---

## 三、 代码规范与工程配置细节

### 3.1 前端规范 (Biome + ESLint)

#### 1. `biome.json` 规范配置
```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 80,
    "lineEnding": "auto"
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "trailingCommas": "all",
      "semicolons": "asNeeded"
    }
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": {
        "noExplicitAny": "error"
      }
    }
  },
  "files": {
    "includes": ["src/**", "*.ts", "*.json", "!src-tauri/**", "!dist/**"]
  }
}
```

#### 2. `eslint.config.ts`
配置 React 19 Hooks、TypeScript 严格检查与全局无残留变量规则。

---

### 3.2 后端规范 (`rustfmt.toml` + Clippy)

#### 1. `rustfmt.toml`
```toml
max_width = 120
hard_tabs = false
tab_spaces = 4
newline_style = "Auto"
use_small_heuristics = "Default"
reorder_imports = true
reorder_modules = true
remove_nested_parens = true
edition = "2024"
merge_derives = true
```

#### 2. Clippy 检查命令
```bash
cargo clippy --all-targets --all-features -- -D warnings
```

---

## 四、 本地构建脚本与 GitHub Actions CI/CD

### 4.1 本地 Sidecar 准备脚本 (`scripts/dev-sidecar.mjs`)
在开发阶段，运行 `pnpm dev:sidecar` 自动根据当前系统类型下载对应的 Mihomo 二进制文件：
* **Windows (x64)**: `mihomo-windows-amd64-v2.zip` -> 解压重命名为 `src-tauri/binaries/mihomo-x86_64-pc-windows-msvc.exe`
* **macOS (Apple Silicon)**: `mihomo-darwin-arm64.gz` -> 解压重命名为 `src-tauri/binaries/mihomo-aarch64-apple-darwin`
* **macOS (Intel)**: `mihomo-darwin-amd64.gz` -> 解压重命名为 `src-tauri/binaries/mihomo-x86_64-apple-darwin`
* **Linux (x64)**: `mihomo-linux-amd64.gz` -> 解压重命名为 `src-tauri/binaries/mihomo-x86_64-unknown-linux-gnu`

### 4.2 GitHub Actions 自动化发布工作流 (`.github/workflows/release.yml`)

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    permissions:
      contents: write
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: 'windows-latest'
            target: 'x86_64-pc-windows-msvc'
            args: ''
          - platform: 'macos-latest'
            target: 'aarch64-apple-darwin'
            args: '--target aarch64-apple-darwin'
          - platform: 'macos-13'
            target: 'x86_64-apple-darwin'
            args: '--target x86_64-apple-darwin'
          - platform: 'ubuntu-22.04'
            target: 'x86_64-unknown-linux-gnu'
            args: ''

    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4

      - name: Install Node.js & pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'pnpm'

      - name: Install Rust Stable
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.target }}

      - name: Install Linux Dependencies (Ubuntu only)
        if: matrix.platform == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf

      - name: Install Dependencies
        run: pnpm install

      - name: Download Mihomo Sidecar
        run: node scripts/dev-sidecar.mjs --target ${{ matrix.target }}

      - name: Build Tauri App
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: 'Mihomo Multi-Port ${{ github.ref_name }}'
          releaseBody: 'See release notes.'
          releaseDraft: false
          prerelease: false
          args: ${{ matrix.args }}
```

---

## 五、 总结与就绪状态

至此，本项目的：
1. **领域模型与术语边界 (`CONTEXT.md`)**；
2. **AI 编码约束与架构红线 (`AGENTS.md` / `CLAUDE.md`)**；
3. **详细系统架构设计规范 (`docs/architecture/system-design.md`)**；
4. **代码规范配置与 GitHub Actions 矩阵发布规范**

均已完整确立并固化。随时可以开始后续代码脚手架初始化与功能开发！
