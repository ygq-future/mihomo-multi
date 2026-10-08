# 计划：为 Mihomo Multi 接入 Windows TUN 模式（管理员提权）

## Context

用户要求加入 TUN 模式并彻底替代其他 Clash 客户端。当前项目仅通过多端口入站监听（`listeners` + `IN-PORT` 规则）实现 1:1 端口-节点确定性绑定，`AGENTS.md:14`、`CLAUDE.md:14`、`CONTEXT.md:73` 明确禁止引入 TUN 与驱动安装，项目规则必须先改为「受控 TUN」条款。

已确定的落地形态（不再讨论）：

1. **提权方式**：整个应用以管理员重启（UAC 一次），开机自启在 TUN 开启时改用「最高权限」计划任务。
2. **TUN 出口**：跟随一个已启用的端口映射（单选互斥，复用该端口的节点、备用节点、国内直连与自定义排除规则），不引入第二套节点选择。
3. **与系统代理互斥**：任一时刻只允许一个生效；开启 TUN 时服务端强制关闭并清理系统代理与环境变量，反向同理。

范围边界：TUN 只提供「全局流量走一个已启用端口的出口」，不实现按进程分流、订阅规则集分流或全局/规则模式切换。

已验证的外部事实（本次实测/查源码）：

- mihomo 依赖 `github.com/metacubex/sing-tun v0.4.27`（`Meta` 分支 `go.mod:51`），该库 `internal/wintun/dll_windows_amd64.go` 用 `//go:embed amd64/wintun.dll` 把驱动打进内核二进制并通过 memmod 加载 → **无需分发或安装 `wintun.dll`**。
- 创建 Wintun 网卡需管理员权限；TUN 只在管理员进程中可用。
- mihomo 每次 `ApplyConfig` 都执行 `updateTun(cfg.General)`（`hub/executor/executor.go`），因此 TUN 可随现有 `PUT /configs?force=true` 热开关，内核无需重启。
- TUN 入站连接的 `metadata.Type == C.TUN`（`listener/sing_tun/server.go:308` 传 `Type: C.TUN`），规则 `IN-TYPE,TUN,<target>` 有效（`rules/common/in_type.go` + `constant/metadata.go` 的 `ParseType("TUN")`）。
- `dns-hijack` 由 tun 监听器内部直接转发到内部 DNS（`listener/sing_tun/dns.go` 的 `ShouldHijackDns`/`RelayDnsPacket`），**不需要** `dns.listen`。
- 当前所有规则都是 `IN-PORT`，TUN 流量不匹配任何入站端口，若不新增 TUN 规则会全部落到末尾 `MATCH,DIRECT`（等于开了 TUN 却全直连）。

## Approach

### 步骤 1 — 生成 TUN 配置块与 TUN 路由规则

文件：`src-tauri/src/core/config_generator.rs`

1.1 新增结构体（放在 `RuntimeDnsConfig` 之后）：

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RuntimeTunConfig {
    pub enable: bool,
    pub stack: String,
    #[serde(rename = "auto-route")]
    pub auto_route: bool,
    #[serde(rename = "auto-detect-interface")]
    pub auto_detect_interface: bool,
    #[serde(rename = "dns-hijack")]
    pub dns_hijack: Vec<String>,
}
```

取值固定为：`enable: true`、`stack: "gvisor"`、`auto_route: true`、`auto_detect_interface: true`、`dns_hijack: vec!["any:53".to_string()]`。
不写 `strict-route`（Windows 下会加防火墙规则，可能影响 VirtualBox 等）、不写 `mtu`、不写 `device`（沿用 mihomo 默认网卡名 `Meta`）、不写 `route-exclude-address`。

1.2 `MinimalRuntimeConfig`（`config_generator.rs:242` 起）在 `ipv6` 字段后新增：

```rust
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub tun: Option<RuntimeTunConfig>,
```

并在 `MinimalRuntimeConfig::new`（`config_generator.rs:276-294`）的结构体字面量中加 `tun: None,`。序列化顺序变化会同时改变 `write_to_file` 的内容比对结果，这是期望行为（`config_generator.rs:439` 按 YAML 文本比对）。

1.3 `RuntimeGeneratorParams`（`config_generator.rs:228-239`）新增两个字段：

```rust
    pub tun_enabled: bool,
    pub tun_port: Option<u16>,
```

1.4 `with_mappings`（`config_generator.rs:296-）内部修改：

- 循环前新增局部变量：`let mut tun_target: Option<String> = None;`、`let mut tun_sub_rule: Option<String> = None;`。
- DIRECT 早退分支（`config_generator.rs:313-317`）内 `continue` 前追加：`if Some(m.port) == params.tun_port { tun_target = Some("DIRECT".to_string()); }`。
- 在 `target_action` 计算完成、`sub_rule_list` 填充完成后（即 `if !sub_rule_list.is_empty()` 之前）插入：

```rust
            if Some(m.port) == params.tun_port {
                tun_target = Some(target_action.clone());
                if !sub_rule_list.is_empty() {
                    tun_sub_rule = Some(format!("sub-rule-{}", m.port));
                }
            }
```

- 循环结束、`rules.push("MATCH,DIRECT".to_string());` **之前**插入：

```rust
        let mut tun = None;
        if params.tun_enabled
            && let Some(target) = tun_target.clone()
        {
            if let Some(name) = tun_sub_rule.clone() {
                rules.push(format!("SUB-RULE,(IN-TYPE,TUN),{}", name));
            } else {
                rules.push(format!("IN-TYPE,TUN,{}", target));
            }
            tun = Some(RuntimeTunConfig {
                enable: true,
                stack: "gvisor".to_string(),
                auto_route: true,
                auto_detect_interface: true,
                dns_hijack: vec!["any:53".to_string()],
            });
        }
```

TUN 规则位于所有 `IN-PORT` 规则之后、`MATCH,DIRECT` 之前；`IN-PORT` 不会匹配 TUN 流量，因此该位置等价于最高优先级。

- 函数末尾 `Self { ... }` 字面量（`config_generator.rs:411-428`）加入 `tun,`。

边界行为：`params.tun_enabled == true` 但 `tun_port` 未设置、或其端口映射未启用/被占用过滤（`state.rs`/`port_router.rs` 传入的是 `active_mappings`）时，`tun_target` 保持 `None` → 不生成 `tun:` 块也不生成 TUN 规则，内核保持普通多端口模式（不会创建网卡、不会导致内核启动失败）。

### 步骤 2 — 更新 `RuntimeGeneratorParams` 的全部构造点

生产代码 2 处，均改为 `tun_enabled: cfg.tun_enabled && crate::core::elevation::is_elevated(), tun_port: cfg.tun_port,`：

- `src-tauri/src/state.rs:245`（`generate_runtime_config_file`）
- `src-tauri/src/core/port_router.rs:129`（`AppPortSyncDelegate::sync_runtime`）

管理员判定放在这里而不是生成器内部：非管理员运行时即便持久化了 `tun_enabled=true` 也不会把 `tun:` 写进 runtime.yaml，避免内核启动失败。

测试代码 9 处，逐个补 `tun_enabled: false, tun_port: None,`（保持现有断言不变）：

- `src-tauri/src/core/config_generator.rs:518, 578, 635, 702, 771, 837, 917`
- `src-tauri/src/core/kernel_engine.rs:742, 798`

### 步骤 3 — 提权与进程交接模块

3.1 `src-tauri/Cargo.toml`：`[target.'cfg(windows)'.dependencies]` 的 `windows-sys` features 增加 `"Win32_UI_Shell"`（`ShellExecuteW` 所在模块；已核对本地 `windows-sys-0.59.0` 源码路径）。

3.2 新建 `src-tauri/src/core/elevation.rs`，并在 `src-tauri/src/core/mod.rs` 增加 `pub mod elevation;`（按字母序放在 `drift_guard` 之后）。

```rust
use crate::error::{AppError, AppResult};

#[cfg(windows)]
pub fn is_elevated() -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::Security::{GetTokenInformation, TOKEN_ELEVATION, TOKEN_QUERY, TokenElevation};
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    let mut token: HANDLE = std::ptr::null_mut();
    // SAFETY: 仅查询当前进程令牌，句柄在函数内关闭
    unsafe {
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut returned: u32 = 0;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            &mut elevation as *mut _ as *mut core::ffi::c_void,
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut returned,
        );
        CloseHandle(token);
        ok != 0 && elevation.TokenIsElevated != 0
    }
}

#[cfg(not(windows))]
pub fn is_elevated() -> bool {
    false
}

#[cfg(windows)]
pub fn relaunch_as_admin(extra_args: &[String]) -> AppResult<()> {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    let exe = std::env::current_exe().map_err(AppError::Io)?;
    let operation = wide("runas");
    let file = wide(&exe.display().to_string());
    let params = if extra_args.is_empty() {
        wide("")
    } else {
        wide(&format!(" {}", extra_args.join(" ")))
    };

    // SAFETY: 传入的都是以 NUL 结尾的 UTF-16 缓冲区，返回值 > 32 表示启动成功
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            file.as_ptr(),
            params.as_ptr(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    if (result as isize) <= 32 {
        return Err(AppError::Internal(format!(
            "以管理员身份重启失败（ShellExecuteW 返回 {}），请手动右键以管理员身份运行",
            result as isize
        )));
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn relaunch_as_admin(_extra_args: &[String]) -> AppResult<()> {
    Err(AppError::Internal("当前平台不支持管理员重启".to_string()))
}

#[cfg(windows)]
pub fn wait_for_process_exit(pid: u32, timeout_ms: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject};

    const SYNCHRONIZE_ACCESS: u32 = 0x0010_0000;
    // SAFETY: 句柄在函数内关闭；提权进程可以打开普通权限进程的 SYNCHRONIZE 句柄
    unsafe {
        let handle = OpenProcess(SYNCHRONIZE_ACCESS, 0, pid);
        if handle.is_null() {
            return true;
        }
        let waited = WaitForSingleObject(handle, timeout_ms);
        CloseHandle(handle);
        waited == WAIT_OBJECT_0
    }
}

#[cfg(not(windows))]
pub fn wait_for_process_exit(_pid: u32, _timeout_ms: u32) -> bool {
    true
}
```

3.3 `src-tauri/src/lib.rs` 的 `setup()`（`lib.rs:79-115` 区域）修改：

- 参数解析（与现有 `--silent` 解析同一处）：

```rust
            let restart_from_pid: Option<u32> = args
                .iter()
                .find_map(|a| a.strip_prefix("--restart-from-pid="))
                .and_then(|v| v.parse().ok());
```

- 静默判定改为在交接重启时强制显示窗口：

```rust
            let is_silent = (args.iter().any(|a| a == "--silent" || a == "-s")
                || app_state.config.read().silent_start)
                && restart_from_pid.is_none();
```

- 在 `tauri::async_runtime::spawn(async move { ... })`（`lib.rs:103`）块的开头加入：

```rust
                if let Some(pid) = restart_from_pid {
                    crate::core::elevation::wait_for_process_exit(pid, 10_000);
                }
```

- 步骤 6 会替换该块上面的 `autostart` 同步调用。

### 步骤 4 — 设置模型与持久化

4.1 `src-tauri/src/models.rs` 的 `AppConfig`（`models.rs:231-267`）在 `system_proxy_sync_env` 之后追加：

```rust
    #[serde(default)]
    pub tun_enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tun_port: Option<u16>,
```

`impl Default for AppConfig`（`models.rs:303-333`）补 `tun_enabled: false,` 与 `tun_port: None,`。camelCase 序列化自动得到 `tunEnabled` / `tunPort`。

4.2 新增状态结构体（放在 `SystemProxyStatus` 之后，`models.rs:336-341` 附近）：

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TunStatus {
    pub enabled: bool,
    pub active: bool,
    pub port: Option<u16>,
    pub elevated: bool,
    pub pending_elevation: bool,
}
```

字段语义：`enabled` = 持久化开关；`active` = `elevated && enabled && tun_port 对应端口处于启用状态 && 内核正在运行`；`pending_elevation` = `enabled && !elevated`。

4.3 `src-tauri/src/state.rs` 的 `impl AppState` 增加持久化助手（与 `commands.rs` 现有写法一致，失败静默）：

```rust
    pub fn persist_config(&self, config: &AppConfig) {
        *self.config.write() = config.clone();
        let config_path = self.app_dir.join("config.json");
        if let Ok(json) = serde_json::to_string_pretty(config) {
            let _ = crate::core::profile_manager::atomic_write_file(&config_path, json.as_bytes());
        }
    }
```

### 步骤 5 — 命令层：互斥、提权重启、状态查询

文件：`src-tauri/src/commands.rs`；三个新命令需在 `src-tauri/src/lib.rs:121-180` 的 `tauri::generate_handler![...]` 中注册；`TunStatus` 需加入 `commands.rs:4-8` 的 `use crate::models::{...}` 列表（现有导入为单个花括号列表，漏加会编译失败）。

5.1 `save_config`（`commands.rs:92-191`）改动：

- 在清理 bypass 列表之后、`let old_config = ...` 之前插入互斥归一化：

```rust
    if config.tun_enabled && config.system_proxy_enabled {
        config.system_proxy_enabled = false;
        config.system_proxy_port = None;
    }
```

（随后已有的 `if config.system_proxy_enabled != old_config.system_proxy_enabled ...` 分支会调用 `clear_system_proxy()` 清理系统状态。）

- `runtime_settings_changed` 条件追加：`|| config.tun_enabled != old_config.tun_enabled || config.tun_port != old_config.tun_port`。
- 自启同步条件由 `config.auto_launch != old_config.auto_launch || config.silent_start != old_config.silent_start` 改为再加上 `|| config.tun_enabled != old_config.tun_enabled`，并把 `commands.rs:163-167` 的调用替换为步骤 6.2 的 `sync_autostart_state`。

5.2 新增命令：

```rust
#[tauri::command]
pub async fn get_tun_status(state: State<'_, AppState>) -> Result<TunStatus, String> {
    Ok(build_tun_status(&state))
}

#[tauri::command]
pub async fn set_tun(
    app: AppHandle,
    enabled: bool,
    port: Option<u16>,
    state: State<'_, AppState>,
) -> Result<TunStatus, String> {
    let mut config = state.config.read().clone();
    let elevated = crate::core::elevation::is_elevated();

    if enabled {
        let p = port.ok_or_else(|| "启用 TUN 模式必须指定绑定端口".to_string())?;
        let mappings = state.port_router.get_port_mappings();
        if !mappings.iter().any(|m| m.port == p && m.enabled) {
            return Err(format!("端口 {} 未在监听列表中或未启用，无法作为 TUN 出口", p));
        }
        if config.system_proxy_enabled {
            let _ = crate::core::sysproxy::clear_system_proxy();
        }
        state.clear_suspended_system_proxy();
        config.system_proxy_enabled = false;
        config.system_proxy_port = None;
        config.tun_enabled = true;
        config.tun_port = Some(p);
    } else {
        config.tun_enabled = false;
        config.tun_port = None;
    }
    state.persist_config(&config);

    if enabled && !elevated {
        let _ = state.engine.stop();
        if let Err(e) =
            crate::core::elevation::relaunch_as_admin(&[format!("--restart-from-pid={}", std::process::id())])
        {
            // UAC 被拒绝或启动失败：回滚开关并恢复内核，避免留下"已开启但内核已停止"的破损状态
            let mut rollback = state.config.read().clone();
            rollback.tun_enabled = false;
            rollback.tun_port = None;
            state.persist_config(&rollback);
            let _ = state.engine.start(Some(&app), &rollback);
            return Err(e.to_string());
        }
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
            handle.exit(0);
        });
        return Ok(build_tun_status(&state));
    }

    let _ = state.sync_runtime_config().await;
    if enabled && !state.engine.get_status().running {
        state.engine.start(Some(&app), &config).map_err(|e| e.to_string())?;
    }
    crate::tray::update_tray_menu(&app);
    Ok(build_tun_status(&state))
}

#[tauri::command]
pub async fn restart_as_admin(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    if crate::core::elevation::is_elevated() {
        return Ok(());
    }
    let _ = state.engine.stop();
    if let Err(e) =
        crate::core::elevation::relaunch_as_admin(&[format!("--restart-from-pid={}", std::process::id())])
    {
        // UAC 被拒绝：恢复内核，避免留下无内核运行的破损状态
        let config = state.config.read().clone();
        let _ = state.engine.start(Some(&app), &config);
        return Err(e.to_string());
    }
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        handle.exit(0);
    });
    Ok(())
}
```

辅助函数（同文件，非命令）：

```rust
fn build_tun_status(state: &State<'_, AppState>) -> TunStatus {
    let config = state.config.read().clone();
    let elevated = crate::core::elevation::is_elevated();
    let port_active = config
        .tun_port
        .is_some_and(|p| state.port_router.get_port_mappings().iter().any(|m| m.port == p && m.enabled));
    TunStatus {
        enabled: config.tun_enabled,
        active: elevated && config.tun_enabled && port_active && state.engine.get_status().running,
        port: config.tun_port,
        elevated,
        pending_elevation: config.tun_enabled && !elevated,
    }
}
```

`set_tun(false)` 在非管理员下也允许执行：此时内核没有被 TUN 配置（参数门控），只是清理持久化开关并热重载一次。

5.3 端口联动清理（TUN 绑定端口被停用或删除时必须自动关闭 TUN）：在已有的两处系统代理清理片段**之后**追加等价逻辑。

`delete_port_mapping`（`commands.rs:317-326`）：

```rust
    if config.tun_enabled && target_port == config.tun_port {
        config.tun_enabled = false;
        config.tun_port = None;
        *state.config.write() = config.clone();
        let config_path = state.app_dir.join("config.json");
        if let Ok(json) = serde_json::to_string_pretty(&config) {
            let _ = crate::core::profile_manager::atomic_write_file(&config_path, json.as_bytes());
        }
    }
```

`toggle_port_mapping`（`commands.rs:341-350`，位于 `if !enabled` 分支内）追加同样片段。

这两个命令随后都会触发 runtime 重载，因此内核会热关闭网卡。

5.4 崩溃处理器（`state.rs:77-128`）无需改动：网卡随内核进程消亡自动销毁，`tun_enabled` 保持持久化，UI 通过 `get_tun_status().active == false` 反映真实状态。

### 步骤 6 — 开机自启：TUN 开启时改用最高权限计划任务

6.1 `src-tauri/src/core/autostart.rs` 新增（沿用文件内 `windows_reg_command()` 的 `CREATE_NO_WINDOW` 模式）：

```rust
#[cfg(windows)]
const AUTOSTART_TASK_NAME: &str = "MihomoMulti";

#[cfg(windows)]
fn windows_schtasks_command() -> std::process::Command {
    use std::os::windows::process::CommandExt;
    let mut cmd = std::process::Command::new("schtasks");
    cmd.creation_flags(0x08000000);
    cmd
}

#[cfg(windows)]
pub fn is_elevated_autostart_enabled() -> bool {
    matches!(windows_schtasks_command().args(["Query", "/TN", AUTOSTART_TASK_NAME]).output(),
        Ok(out) if out.status.success())
}

#[cfg(windows)]
pub fn delete_elevated_autostart() -> Result<(), String> {
    let out = windows_schtasks_command()
        .args(["Delete", "/F", "/TN", AUTOSTART_TASK_NAME])
        .output();
    match out {
        Ok(_) => Ok(()), // 任务不存在时 schtasks 返回非零，视为已删除
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(windows)]
pub fn enable_elevated_autostart(app_path: &Path, silent: bool) -> Result<(), String> {
    let path_str = app_path.to_string_lossy();
    let cmd_value = if silent {
        format!("\"{}\" --silent", path_str)
    } else {
        format!("\"{}\"", path_str)
    };
    let out = windows_schtasks_command()
        .args([
            "Create", "/F", "/TN", AUTOSTART_TASK_NAME, "/TR", &cmd_value, "/SC", "ONLOGON", "/RL", "HIGHEST",
        ])
        .output();
    match out {
        Ok(o) if o.status.success() => Ok(()),
        Ok(o) => Err(String::from_utf8_lossy(&o.stderr).trim().to_string()),
        Err(e) => Err(e.to_string()),
    }
}
```

非 Windows 平台对应函数返回 `false` / `Ok(())` / `Err("当前平台不支持管理员计划任务".to_string())`（与文件现有 `#[cfg(not(windows))]` 风格一致）。

6.2 统一分发函数（Windows 与非 Windows 都要定义）：

```rust
pub fn sync_autostart_state(config: &crate::models::AppConfig, app_path: &Path) -> Result<(), String> {
    if !config.auto_launch {
        disable_autostart()?;
        return delete_elevated_autostart();
    }
    if config.tun_enabled {
        // 最高权限计划任务，避免登录时弹 UAC；同时移除 HKCU Run 项防止重复启动
        delete_run_entry()?;
        enable_elevated_autostart(app_path, config.silent_start)
    } else {
        delete_elevated_autostart()?;
        enable_autostart(app_path, config.silent_start)
    }
}
```

`delete_run_entry()` 为 `disable_autostart()` 的等价实现；实现方式：把 `disable_autostart()` 现有 Windows 实现体抽成 `delete_run_entry()`，`disable_autostart()` 改为调用它（保留公开名以免破坏现有调用）。若 `enable_elevated_autostart` 因未提权失败（schtasks 需要管理员），错误向上传递，UI 提示"开启 TUN 时设置开机自启需要管理员权限"。

6.3 调用点替换：

- `src-tauri/src/lib.rs:96-102`：把 `if config.auto_launch && let Ok(exe_path) = ... { let _ = enable_autostart(...) }` 改为：

```rust
            if let Ok(exe_path) = std::env::current_exe() {
                let _ = crate::core::autostart::sync_autostart_state(&config, &exe_path);
            }
```

（`config` 为该块中已克隆的 `AppConfig`；注意此调用需在 `config` 被移入 `async move` 块之前执行，必要时先 `let autostart_config = config.clone();`。）

- `src-tauri/src/commands.rs:159-167`：把 `if (auto_launch 变化 || silent_start 变化) && let Ok(exe_path) ...` 块内的分支替换为 `let _ = crate::core::autostart::sync_autostart_state(&config, &exe_path);`，条件按步骤 5.1 增加 `tun_enabled` 比较。

`is_autostart_enabled()` 当前无调用点，保持不动。

### 步骤 7 — 托盘提示补充 TUN 状态

文件：`src-tauri/src/tray.rs` 的 `format_tray_tooltip`（`tray.rs:327-353`）。

在 `sys_proxy_str` 之后新增：

```rust
    let tun_str = if config.tun_enabled {
        match config.tun_port {
            Some(port) => format!("已开启 (:{port})"),
            None => "已开启".to_string(),
        }
    } else {
        "未开启".to_string()
    };
```

并把 `format!` 模板最后一行改为：

```rust
        "Mihomo Multi\n内核状态: {}\n监听端口: {} 个已启用 (共 {} 个)\n系统代理: {}\nTUN: {}",
        core_status, enabled_ports, total_ports, sys_proxy_str, tun_str
```

托盘菜单不新增 TUN 开关（与系统代理保持同构，仅前端可切换）。

### 步骤 8 — 前端

8.1 `src/types/index.ts`

- `AppConfig` 在 `systemProxySyncEnv: boolean` 之后追加：

```ts
  tunEnabled: boolean
  tunPort?: number | null
```

- 新增（放在 `SystemProxyStatus` 附近）：

```ts
export interface TunStatus {
  enabled: boolean
  active: boolean
  port?: number | null
  elevated: boolean
  pendingElevation: boolean
}
```

8.2 `src/services/tauri.ts` 新增（放在 `getSystemProxyStatus` 之后，沿用 `isTauriEnvironment()` mock 模式）：

```ts
export async function setTun(
  enabled: boolean,
  port?: number | null,
): Promise<TunStatus> {
  if (!isTauriEnvironment()) {
    return {
      enabled,
      active: enabled,
      port: enabled ? (port ?? 7890) : null,
      elevated: true,
      pendingElevation: false,
    }
  }
  return invoke<TunStatus>('set_tun', { enabled, port: port ?? null })
}

export async function getTunStatus(): Promise<TunStatus> {
  if (!isTauriEnvironment()) {
    return {
      enabled: false,
      active: false,
      port: null,
      elevated: false,
      pendingElevation: false,
    }
  }
  return invoke<TunStatus>('get_tun_status')
}

export async function restartAsAdmin(): Promise<void> {
  if (!isTauriEnvironment()) return
  return invoke<void>('restart_as_admin')
}
```

`TunStatus` 需加入该文件顶部 `import type { ... } from '../types'` 列表。

8.3 `src/stores/appStore.ts`

- `BaseAppState` 追加：

```ts
  tunStatus: TunStatus | null
  fetchTunStatus: () => Promise<void>
  setTun: (enabled: boolean, port?: number | null) => Promise<void>
  restartAsAdmin: () => Promise<void>
```

- 初始状态追加 `tunStatus: null,`。
- 动作实现（放在 `setSystemProxy` 之后）：

```ts
  fetchTunStatus: async () => {
    try {
      set({ tunStatus: await api.getTunStatus() })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  setTun: async (enabled: boolean, port?: number | null) => {
    try {
      const status = await api.setTun(enabled, port)
      set({ tunStatus: status })
      await get().fetchConfig()
      await get().fetchStatus()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set({ error: msg })
      throw err
    }
  },

  restartAsAdmin: async () => {
    try {
      await api.restartAsAdmin()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set({ error: msg })
      throw err
    }
  },
```

`AppConfig` 的导入类型需已在文件顶部（已存在）。`fetchConfig` 会在开启 TUN 后把 `systemProxyEnabled/systemProxyPort` 同步为服务端强制关闭后的值。

8.4 `src/components/views/SettingView.tsx`

- 从 store 解构追加 `setTun`、`tunStatus`、`fetchTunStatus`、`restartAsAdmin`（与现有 `setSystemProxy` 同一处 `useAppStore()` 解构，`SettingView.tsx:257-262`）。
- 新增局部状态：`const [tunLoading, setTunLoading] = useState<boolean>(false)`。
- 挂载时拉取状态：在已有拉取 `uwpStats` 的 `useEffect` 附近追加一次 `fetchTunStatus()`（参照 `SettingView.tsx:359` 起的 `createEventScope` 区域）。
- 新增处理函数（放在 `handlePortSelectChange` 之后）：

```ts
  const handleToggleTun = async (checked: boolean) => {
    if (checked) {
      const targetPort =
        config?.tunPort && enabledPorts.some((m) => m.port === config.tunPort)
          ? config.tunPort
          : enabledPorts[0]?.port
      if (!targetPort) {
        toast.error('当前无可用且已启用的监听端口，请先在端口管理中启用端口')
        return
      }
      setTunLoading(true)
      try {
        const status = await setTun(true, targetPort)
        if (status.pendingElevation) {
          toast.info('TUN 模式需要管理员权限，应用正在以管理员身份重启…')
        } else {
          toast.success(`TUN 模式已启用，全局出口跟随端口 ${targetPort}`)
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      } finally {
        setTunLoading(false)
      }
    } else {
      setTunLoading(true)
      try {
        await setTun(false)
        toast.success('已关闭 TUN 模式')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      } finally {
        setTunLoading(false)
      }
    }
  }

  const handleTunPortSelect = async (portStr: string) => {
    const port = Number(portStr)
    if (!port || !config) return
    setTunLoading(true)
    try {
      if (config.tunEnabled) {
        await setTun(true, port)
      } else {
        await saveConfig({ ...config, tunPort: port })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setTunLoading(false)
    }
  }

  const handleRestartAsAdmin = async () => {
    try {
      await restartAsAdmin()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }
```

- 新增卡片，插在系统代理设置卡片之后、外观与个性化卡片之前（即 `SettingView.tsx:1698` 附近的 `</div>` 之后、`{/* 2. Appearance & Personalization Card */}` 之前），样式与既有卡片完全同构：

```tsx
      {/* TUN 模式卡片 */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-5 shadow-sm">
        <div className="pb-3 border-b border-border">
          <div className="flex items-center gap-2.5">
            <Network className="w-5 h-5 text-primary" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">TUN 模式</h3>
              <p className="text-xs text-muted-foreground">
                通过虚拟网卡接管系统全局流量，出口跟随所选监听端口的节点与国内直连策略
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-6">
            <div className="space-y-0.5 min-w-0 flex-1">
              <label className="text-xs font-medium text-foreground">
                启用 TUN 模式
              </label>
              <p className="text-[11px] text-muted-foreground">
                需要管理员权限；与系统代理互斥，开启时会自动关闭并清理系统代理
              </p>
            </div>
            <Switch
              checked={config?.tunEnabled ?? false}
              onChange={handleToggleTun}
              disabled={tunLoading}
              size="md"
            />
          </div>

          <div className="pt-3 border-t border-border/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="space-y-0.5">
              <label className="text-xs font-medium text-foreground">
                绑定的监听端口
              </label>
              <p className="text-[11px] text-muted-foreground">
                从当前已启用的监听端口中选择 TUN 全局出口（复用该端口的节点、备用节点与国内直连策略）
              </p>
            </div>
            <div className="w-full sm:w-80">
              {enabledPorts.length === 0 ? (
                <span className="text-xs text-rose-500 font-medium">
                  暂无已启用的监听端口，请先在端口管理中启用
                </span>
              ) : (
                <Select
                  value={String(config?.tunPort ?? enabledPorts[0]?.port ?? '')}
                  onChange={(val) => handleTunPortSelect(String(val))}
                  options={enabledPorts.map((m) => ({
                    value: String(m.port),
                    label: `端口 ${m.port} (${m.protocol.toUpperCase()} - ${m.nodeName}${
                      m.description ? ` · ${m.description}` : ''
                    })`,
                  }))}
                />
              )}
            </div>
          </div>

          {tunStatus?.pendingElevation && (
            <div className="pt-3 border-t border-border/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="space-y-0.5">
                <label className="text-xs font-medium text-amber-500">
                  TUN 未生效：需要管理员权限
                </label>
                <p className="text-[11px] text-muted-foreground">
                  当前以普通用户运行，未创建虚拟网卡。点击右侧按钮以管理员身份重启后自动生效
                </p>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={handleRestartAsAdmin}
                icon={<ShieldCheck className="w-3.5 h-3.5" />}
              >
                以管理员身份重启
              </Button>
            </div>
          )}
        </div>
      </div>
```

`Network` 与 `ShieldCheck` 需在文件顶部 `lucide-react` 导入列表补上（`ShieldCheck` 已被导入，`Network` 需新增，若已存在则复用）。

### 步骤 9 — 项目规则同步（禁止 TUN → 受控 TUN）

- `AGENTS.md:14` 与 `CLAUDE.md:14`：把 `❌ 严禁引入 TUN 虚拟网卡模式与驱动安装；` 替换为：

```
     * ⚠️ TUN 虚拟网卡模式为**受控特性**：必须跟随一个已启用端口映射作为唯一出口、与系统代理严格互斥、需要管理员权限、退出或内核停止时随内核进程一并释放虚拟网卡；
```

- `CONTEXT.md`：不变式第 4 条（`CONTEXT.md:72-73`）改为「严禁引入基于 JavaScript/Lua 运行时的动态规则集预处理脚本系统；TUN 仅允许以受控特性存在（单选出口、与系统代理互斥、生命周期随内核进程）」，并在术语表补 `**TunMode (受控 TUN 模式)**` 条目，_Avoid_ 列写 `全局模式, VPN, 虚拟网卡劫持, 全流量代理`。
- `docs/research/mihomo-multi-port-architecture.md`（第 9、424 行）与 `docs/release-notes/v1.0.0.md` 第 24 行是历史记录，不改写。

## Critical files & anchors

- `src-tauri/src/core/config_generator.rs` — `RuntimeGeneratorParams`（228-239）、`MinimalRuntimeConfig`（242-293）、`with_mappings`（296-428）；TUN 规则必须在 `rules.push("MATCH,DIRECT")`（`config_generator.rs:409`）之前入队。
- `src-tauri/src/core/elevation.rs`（新建）— 提权判定、`ShellExecuteW runas` 重启、旧进程退出等待；`windows-sys` 需新增 `Win32_UI_Shell` feature。
- `src-tauri/src/commands.rs` — `save_config`（92-191）互斥归一化、`set_system_proxy`（193-235）同级模式参考、TUN 三命令、端口联动清理（317-326、341-350）。
- `src-tauri/src/core/autostart.rs` — HKCU Run → 最高权限计划任务切换，`reg` 命令模式可复用（`windows_reg_command`）。
- `src/components/views/SettingView.tsx` — 系统代理卡片（`1467-1698`）是 TUN 卡片的逐行参照；`enabledPorts`（387-389）与 `Select`/`Switch` 用法直接复用。

## Verification

准备：Windows 10/11 x64；已导入含真实节点的订阅；一个已启用的端口映射（记为端口 A，节点 IP 记为 IP_A）。

1. 单元测试（`cargo test`，工作目录 `src-tauri`）：

- 新增 `config_generator.rs` 测试 `test_tun_block_and_rule_without_bypass`：映射端口 7899 / 节点 `N1` / `bypass_cn: false`，参数 `tun_enabled: true, tun_port: Some(7899)` → 断言 YAML 含 `tun:`、`stack: gvisor`、`dns-hijack:`、`auto-route: true`、`IN-TYPE,TUN,N1`，且 `MATCH,DIRECT` 是最后一条规则。
- 新增 `test_tun_block_and_sub_rule_with_bypass`：`bypass_cn: true` → 断言 YAML 含 `SUB-RULE,(IN-TYPE,TUN),sub-rule-7899`。
- 新增 `test_tun_skipped_when_port_not_in_mappings`：`tun_enabled: true, tun_port: Some(1234)`（不在 mappings 中）→ 断言 YAML 不含 `IN-TYPE,TUN` 且不含 `tun:`。
- 既有测试全部通过（步骤 2 补齐字段后应无断言变化）。

2. 端到端（`pnpm dev:sidecar && pnpm tauri dev`，或用构建产物）：

- 开启 TUN（选择端口 A）→ 出现 UAC → 同意 → 应用以管理员重启并显示窗口。断言：设置页显示 TUN 已启用、无"需要管理员权限"横幅；PowerShell `Get-NetAdapter -Name Meta` 返回一个 Up 状态网卡；`curl.exe -s https://api.ip.sb/geoip` 返回的 IP 等于 IP_A；若端口 A 开启了国内直连，`curl.exe -s -o NUL -w "%{http_code}" https://www.baidu.com` 返回 `200`。
- 关闭 TUN → `Get-NetAdapter -Name Meta` 无结果（或 `Status` 为 NotPresent），`curl.exe -s https://api.ip.sb/geoip` 返回本机真实公网 IP，系统网络未中断。
- 互斥：先开系统代理，再开 TUN → `reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable` 显示 `0x0`；`reg query HKCU\Environment /v http_proxy` 报"找不到指定的注册表项"。
- 端口联动：删除（或停用）端口 A → `config.json` 中 `tunEnabled` 变为 `false`，`Get-NetAdapter -Name Meta` 消失，网络直连正常。
- 异常清理：TUN 生效时 `taskkill /PID <mihomo pid> /F` → 网卡消失、`curl` 直连可用、UI 收到内核崩溃提示；随后 `taskkill /IM mihomo-multi.exe /F` → `mihomo*.exe` 进程不再存在（JobObject）。
- 自启：TUN 开启 + 开机自启开启 → `schtasks /Query /TN MihomoMulti /V /FO LIST` 中 `Run Level` 为 `Highest`，且 `reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v MihomoMulti` 报不存在；注销重登后内核以管理员运行且 TUN 生效、无 UAC 弹窗；关闭 TUN 后任务被删除、Run 项恢复存在。
- 非管理员启动（TUN 已持久化）：直接双击普通启动 → 应用正常启动、内核正常运行、UI 显示"TUN 未生效：需要管理员权限"横幅；点击按钮 → UAC → 重启后 TUN 生效。
- UAC 拒绝回滚：在非管理员状态下开启 TUN，UAC 弹窗中选择"否" → UI 弹出以管理员身份重启失败提示，`config.json` 中 `tunEnabled` 仍为 `false`，且内核仍在运行（端口 A 可正常代理）。

3. 高风险步骤的对应检查：步骤 1（规则）由单元测试覆盖；步骤 3/5（提权与交接）由"开启 TUN 触发 UAC 重启"与"非管理员启动横幅"两项覆盖；步骤 6（计划任务）由 `schtasks /Query` 断言覆盖。

## Assumptions & contingencies

- 假定 mihomo 二进制内置 wintun.dll（已查 `metacubex/sing-tun v0.4.27` 的 `//go:embed amd64/wintun.dll`）。若首次启用 TUN 后 `%LOCALAPPDATA%\com.mihomo.multi\core\logs\mihomo-<日期>.log` 出现 wintun/dll 相关错误，则改为随包分发驱动：下载 `https://www.wintun.net/builds/wintun-0.14.1.zip` 中 `bin/<arch>/wintun.dll`，放入 `src-tauri/resources/binaries/`，在 `supervisor.rs` 的 `start()` 里于 spawn 前复制到 `<work_dir>`，并同步 `tauri.conf.json` 的 `resources` 与 `scripts/pack-release-assets.mjs` 的便携包文件列表。
- 假定 UAC 提权时用户选择当前账户（默认项）。若选择其他管理员账户：`config.json`、`ports.json` 落在该账户目录，系统代理写入该账户的 HKCU，TUN 不会按预期启用且界面显示空配置。不做代码兜底；UI 的"以管理员身份重启"按钮可重复触发，由用户改选默认账户重试。
- 假定 `stack: gvisor` 在目标 mihomo 版本可用（`constant/tun.go` 的 `StackTypeMapping` 含 `gvisor/system/mixed/mips`）。若内核日志报 `invalid tun stack`，改 `stack: "mixed"`，并在 TUN 卡片补充"需在 Windows 防火墙放行 mihomo 及其上级程序"的提示文案。
- 假定内核被强杀后 Wintun 网卡与路由随进程句柄关闭自动销毁（sing-tun 由驱动在进程退出时清理）。若"异常清理"验证发现残留网卡：在 `supervisor.rs` 的 stop 路径（`stop()` 与 `Drop`）以及 `lib.rs` 的 `RunEvent::Exit` 中追加 `netsh interface set interface "Meta" admin=disable`（内核为管理员，权限足够），并在实现前先复现残留现象确认网卡名。
