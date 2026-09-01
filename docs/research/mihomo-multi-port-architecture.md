# Mihomo Multi-Port (仿 Clash Verge 自主订阅管理与多端口绑定) 架构设计

## 一、 架构定位与核心目标

### 1.1 背景与设计收敛
摒弃对外部第三方客户端配置文件的被动依赖（彻底解决外部客户端路径多变、便携版非标、订阅更新后节点名漂移等耦合隐患）。
本项目采用与 **Clash Verge Rev 一致的技术栈与自主订阅管理模型**（Tauri v2 + Rust 后端 + React/TypeScript 前端 + Mihomo Sidecar 内核），但在功能上做减法与聚焦：
* **聚焦核心痛点**：多端口监听（Multi-Inbound Listeners）绑定不同订阅节点（`Port -> Node`）。
* **剔除无关复杂度**：不引入 TUN 虚拟网卡、不引入系统代理全局抢占、不引入复杂的规则集合并脚本与插件系统。
* **自主闭环管理**：
  1. **订阅管理 (Profiles)**：支持远程 URL 订阅拉取与本地 YAML 导入，支持定时自动更新。
  2. **节点展示与测速 (Proxies)**：展示订阅解析后的所有节点，支持一键批量并发测速。
  3. **端口映射管理 (Port Listeners)**：核心功能页，配置端口监听并与指定节点绑定，支持配置毫秒级热重载。

---

## 二、 核心业务模块与数据流向

```
+----------------------------------------------------------------------------------------------------+
|                                      Frontend (React + Tailwind)                                   |
|  +--------------------+  +--------------------+  +--------------------+  +----------------------+  |
|  | Tab 1: 端口监听映射 |  | Tab 2: 节点展示/测速 |  | Tab 3: 订阅配置管理 |  | Tab 4: 基础设置/日志 |  |
|  | (Add Port -> Node) |  | (Grid & Speed Test)|  | (URL / Local YAML) |  | (Controller & Auto)  |  |
|  +--------------------+  +--------------------+  +--------------------+  +----------------------+  |
+-------------------------------------------------+--------------------------------------------------+
                                                  | Tauri IPC (Commands & Events)
+-------------------------------------------------v--------------------------------------------------+
|                                      Backend (Rust / Tauri v2)                                     |
|  +-----------------------+  +-----------------------+  +-----------------------+  +-------------+  |
|  | ProfileManager        |  | ConfigGenerator       |  | CoreManager           |  | AutoUpdater |  |
|  | - reqwest fetch       |  | - Build listeners     |  | - Spawn & supervise   |  | - tokio     |  |
|  | - yaml extract nodes  |  | - Build 1:1 IN-PORT   |  |   Mihomo sidecar      |  |   interval  |  |
|  | - save to AppData     |  |   routing rules       |  | - REST API Client     |  |   timer     |  |
|  +-----------------------+  +-----------------------+  +-----------------------+  +-------------+  |
+-------------------------------------------------+--------------------------------------------------+
                                                  | REST API (127.0.0.1:9999) / Config File IO
+-------------------------------------------------v--------------------------------------------------+
|                                        Mihomo Core (Sidecar)                                       |
|  - 监听器: 7891 (Mixed), 7892 (Mixed), 7893 (Socks5)...                                            |
|  - 规则引擎: IN-PORT,7891,节点A | IN-PORT,7892,节点B | MATCH,DIRECT                                 |
|  - 测速引擎: GET /proxies/{name}/delay                                                             |
|  - 配置重载: PUT /configs?force=true                                                               |
+----------------------------------------------------------------------------------------------------+
```

---

## 三、 Rust 后端关键模块设计

### 3.1 核心数据结构 (`src-tauri/src/models.rs`)

```rust
use serde::{Deserialize, Serialize};

/// 订阅文件模型 (仿照 Clash Verge Profile)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileItem {
    pub id: String,
    pub name: String,
    pub profile_type: ProfileType, // Remote or Local
    pub url: Option<String>,
    pub file_path: String,
    pub auto_update_interval_mins: u32, // 0 表示不自动更新，例如 1440 (24h)
    pub last_updated_at: u64,
    pub node_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ProfileType {
    Remote,
    Local,
}

/// 端口绑定模型 (核心)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortMapping {
    pub id: String,
    pub port: u16,
    pub protocol: InboundProtocol, // Mixed, Http, Socks5
    pub profile_id: String,       // 属于哪个订阅
    pub node_name: String,        // 绑定的代理节点名称
    pub enabled: bool,
    pub latency: Option<u32>,     // 实时测速结果
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InboundProtocol {
    Mixed,
    Http,
    Socks5,
}

/// 节点信息模型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyNode {
    pub name: String,
    pub node_type: String, // ss, vmess, trojan, vless, hysteria2, etc.
    pub server: String,
    pub port: u16,
    pub latency: Option<u32>,
}
```

---

### 3.2 订阅管理引擎 (`src-tauri/src/profile_manager.rs`)

负责远程订阅下载、本地存储与解析：

```rust
use std::fs;
use std::path::{Path, PathBuf};
use reqwest::header::{HeaderMap, USER_AGENT};
use uuid::Uuid;

pub struct ProfileManager {
    profiles_dir: PathBuf,
}

impl ProfileManager {
    pub fn new(app_data_dir: &Path) -> Self {
        let profiles_dir = app_data_dir.join("profiles");
        fs::create_dir_all(&profiles_dir).unwrap();
        Self { profiles_dir }
    }

    /// 下载或拉取远程订阅 (携带 clash 常用 User-Agent 避免被拦截)
    pub async fn fetch_remote_profile(&self, name: &str, url: &str, interval_mins: u32) -> Result<ProfileItem, String> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| e.to_string())?;

        let mut headers = HeaderMap::new();
        headers.insert(USER_AGENT, "clash-verge/v2.0.0 (mihomo-multi)".parse().unwrap());

        let res = client.get(url)
            .headers(headers)
            .send()
            .await
            .map_err(|e| format!("下载订阅失败: {}", e))?;

        if !res.status().is_success() {
            return Err(format!("订阅服务器返回异常状态码: {}", res.status()));
        }

        let content = res.text().await.map_err(|e| e.to_string())?;
        
        // 校验是否为合法 YAML 并提取节点数
        let yaml_val: serde_yaml::Value = serde_yaml::from_str(&content)
            .map_err(|e| format!("解析订阅 YAML 失败: {}", e))?;
        
        let node_count = yaml_val.get("proxies")
            .and_then(|p| p.as_sequence())
            .map(|s| s.len())
            .unwrap_or(0);

        let id = Uuid::new_v4().to_string();
        let file_path = self.profiles_dir.join(format!("{}.yaml", id));
        fs::write(&file_path, content).map_err(|e| e.to_string())?;

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        Ok(ProfileItem {
            id,
            name: name.to_string(),
            profile_type: ProfileType::Remote,
            url: Some(url.to_string()),
            file_path: file_path.to_string_lossy().to_string(),
            auto_update_interval_mins: interval_mins,
            last_updated_at: now,
            node_count,
        })
    }

    /// 提取指定订阅文件中的所有节点列表
    pub fn parse_nodes(&self, profile_path: &str) -> Result<Vec<ProxyNode>, String> {
        let content = fs::read_to_string(profile_path).map_err(|e| e.to_string())?;
        let yaml_val: serde_yaml::Value = serde_yaml::from_str(&content).map_err(|e| e.to_string())?;

        let mut nodes = Vec::new();
        if let Some(proxies) = yaml_val.get("proxies").and_then(|p| p.as_sequence()) {
            for item in proxies {
                if let (Some(name), Some(ntype), Some(server), Some(port)) = (
                    item.get("name").and_then(|v| v.as_str()),
                    item.get("type").and_then(|v| v.as_str()),
                    item.get("server").and_then(|v| v.as_str()),
                    item.get("port").and_then(|v| v.as_u64()),
                ) {
                    nodes.push(ProxyNode {
                        name: name.to_string(),
                        node_type: ntype.to_string(),
                        server: server.to_string(),
                        port: port as u16,
                        latency: None,
                    });
                }
            }
        }
        Ok(nodes)
    }
}
```

---

### 3.3 运行时配置生成与热重载 (`src-tauri/src/config_generator.rs`)

将活跃订阅的 `proxies` 和用户的 `port_mappings` 合成为 Mihomo 运行时配置：

```rust
use crate::models::{PortMapping, InboundProtocol};
use std::fs;

pub fn compile_runtime_config(
    controller_port: u16,
    secret: &str,
    active_profile_path: &str,
    mappings: &[PortMapping],
) -> Result<String, String> {
    let raw_profile_str = fs::read_to_string(active_profile_path)
        .map_err(|e| format!("读取订阅文件失败: {}", e))?;
    let raw_yaml: serde_yaml::Value = serde_yaml::from_str(&raw_profile_str)
        .map_err(|e| format!("解析订阅文件失败: {}", e))?;

    let mut config = serde_yaml::Mapping::new();

    // 1. 基础配置
    config.insert("port".into(), 0.into());
    config.insert("socks-port".into(), 0.into());
    config.insert("mixed-port".into(), 0.into());
    config.insert("allow-lan".into(), false.into());
    config.insert("mode".into(), "rule".into());
    config.insert("log-level".into(), "info".into());
    config.insert("external-controller".into(), format!("127.0.0.1:{}", controller_port).into());
    config.insert("secret".into(), secret.into());

    // 2. 多端口监听器 (Listeners)
    let mut listeners = serde_yaml::Sequence::new();
    for m in mappings.iter().filter(|m| m.enabled) {
        let mut listener = serde_yaml::Mapping::new();
        listener.insert("name".into(), format!("listener-{}", m.port).into());
        listener.insert("type".into(), match m.protocol {
            InboundProtocol::Mixed => "mixed",
            InboundProtocol::Http => "http",
            InboundProtocol::Socks5 => "socks5",
        }.into());
        listener.insert("port".into(), m.port.into());
        listener.insert("listen".into(), "127.0.0.1".into());
        listeners.push(listener.into());
    }
    config.insert("listeners".into(), listeners.into());

    // 3. 继承原始订阅中的节点与 Provider
    if let Some(proxies) = raw_yaml.get("proxies") {
        config.insert("proxies".into(), proxies.clone());
    }
    if let Some(providers) = raw_yaml.get("proxy-providers") {
        config.insert("proxy-providers".into(), providers.clone());
    }

    // 4. 1:1 规则路由映射
    let mut rules = serde_yaml::Sequence::new();
    for m in mappings.iter().filter(|m| m.enabled) {
        rules.push(format!("IN-PORT,{},{}", m.port, m.node_name).into());
    }
    rules.push("MATCH,DIRECT".into());
    config.insert("rules".into(), rules.into());

    serde_yaml::to_string(&config).map_err(|e| e.to_string())
}
```

---

### 3.4 Mihomo REST API 客户端 (`src-tauri/src/clash_client.rs`)

实现与内核的实时交互（配置热重载与并发测速）：

```rust
use reqwest::Client;
use std::time::Duration;

pub struct ClashApiClient {
    base_url: String,
    secret: String,
    client: Client,
}

impl ClashApiClient {
    pub fn new(port: u16, secret: &str) -> Self {
        Self {
            base_url: format!("http://127.0.0.1:{}", port),
            secret: secret.to_string(),
            client: Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
                .unwrap(),
        }
    }

    /// 热重载运行时配置 (无需重启进程)
    pub async fn reload_config(&self, config_path: &str) -> Result<(), String> {
        let payload = serde_json::json!({
            "path": config_path
        });

        let res = self.client.put(format!("{}/configs?force=true", self.base_url))
            .header("Authorization", format!("Bearer {}", self.secret))
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("热重载请求失败: {}", e))?;

        if res.status().is_success() || res.status() == 204 {
            Ok(())
        } else {
            Err(format!("热重载返回错误状态码: {}", res.status()))
        }
    }

    /// 单节点测速
    pub async fn test_delay(&self, node_name: &str, test_url: &str, timeout_ms: u32) -> Result<u32, String> {
        let url = format!(
            "{}/proxies/{}/delay?url={}&timeout={}",
            self.base_url,
            urlencoding::encode(node_name),
            urlencoding::encode(test_url),
            timeout_ms
        );

        let res = self.client.get(&url)
            .header("Authorization", format!("Bearer {}", self.secret))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if let Ok(json) = res.json::<serde_json::Value>().await {
            if let Some(delay) = json.get("delay").and_then(|d| d.as_u64()) {
                return Ok(delay as u32);
            }
        }
        Err("测速超时或节点不可用".into())
    }
}
```

---

## 四、 前端 UI 视图与交互设计

遵循现代桌面端清晰布局（3 个主功能 Tab + 1 个设置页）：

### 4.1 Tab 1: 端口监听映射 (核心页面)
```
+------------------------------------------------------------------------------------------------------------+
|  🚀 端口映射列表               当前订阅: [ 默认机场-2026.yaml (45个节点) ▼ ]  [ ➕ 添加端口 ]  [ ⚡ 全部测速 ] |
+------------------------------------------------------------------------------------------------------------+
| 端口   | 协议   | 绑定代理节点               | 延迟      | 状态    | 快捷复制代理地址     | 操作          |
| 7891   | Mixed  | 🇯🇵 [0.5x] 日本东京 01      | 42 ms 🟢  | 🟢 监听 | 127.0.0.1:7891 [📋] | [⚡测速] [✏️] [🗑️] |
| 7892   | Mixed  | 🇭🇰 [1.0x] 香港 IPLC 02     | 26 ms 🟢  | 🟢 监听 | 127.0.0.1:7892 [📋] | [⚡测速] [✏️] [🗑️] |
| 7893   | Socks5 | 🇺🇸 [1.0x] 美国洛杉矶 01    | 168 ms 🟡 | 🟢 监听 | 127.0.0.1:7893 [📋] | [⚡测速] [✏️] [🗑️] |
| 7894   | Http   | 🇸🇬 [0.8x] 新加坡 BGP 01    | 超时 🔴   | 🔴 异常 | 127.0.0.1:7894 [📋] | [⚡测速] [✏️] [🗑️] |
+------------------------------------------------------------------------------------------------------------+
```

### 4.2 Tab 2: 节点展示与测速 (Proxies)
* **卡片/网格展示**：类似 Clash Verge 的节点卡片视图，展示国家图标、节点协议（SS/VMess/Trojan/Hysteria2）、节点名称、测速延迟。
* **快捷绑定操作**：卡片上提供「+ 绑定到新端口」快捷按钮，点击直接弹出添加端口弹窗并自动填入该节点。

### 4.3 Tab 3: 订阅配置管理 (Profiles)
* **导入入口**：
  * 「新建远程订阅」：输入订阅名称、URL 链接、自动更新间隔（如 12小时、24小时）。
  * 「导入本地文件」：拖拽或选择本地 `.yaml` 文件。
* **卡片操作**：一键刷新更新订阅、查看节点详情、编辑间隔、删除订阅。
* **定时任务后台**：Rust 后端启动 `tokio::time::interval` 轮询检查需要更新的订阅，拉取更新后自动重新生成配置并触发 `/configs` 热重载。

---

## 五、 工程落地与模块拆分

```
mihomo-multi/
├── src-tauri/
│   ├── binaries/
│   │   └── mihomo-x86_64-pc-windows-msvc.exe   # Mihomo Sidecar 内核
│   ├── src/
│   │   ├── main.rs                             # 应用入口与生命周期
│   │   ├── models.rs                           # 数据模型 (Profile, PortMapping, Node)
│   │   ├── core_manager.rs                     # Mihomo 子进程管理
│   │   ├── profile_manager.rs                  # 订阅拉取、解析、存储
│   │   ├── config_generator.rs                 # 运行时配置组装
│   │   ├── clash_client.rs                     # REST API 交互 (热重载, 测速)
│   │   ├── auto_updater.rs                     # 订阅定时自动拉取任务
│   │   ├── port_probe.rs                       # 端口防冲突探测
│   │   └── store.rs                            # 本地配置数据持久化
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                                        # 前端源码
│   ├── App.tsx                                 # 主框架与 Tab 导航
│   ├── components/
│   │   ├── PortTable.tsx                       # 端口管理表格与弹窗
│   │   ├── ProxyGrid.tsx                       # 节点展示与测速卡片
│   │   ├── ProfileList.tsx                     # 订阅管理列表与新建弹窗
│   │   └── QuickCopy.tsx                       # 代理地址快捷复制组件
│   ├── stores/
│   │   └── useAppStore.ts                      # Zustand 全局状态
│   └── styles/
└── package.json
```

---

## 六、 总结与优势

1. **消除外部耦合**：自建订阅管理后，软件完全独立自洽，不再担心其他 Clash 客户端版本变迁或路径问题。
2. **极简开发与极致体验**：省去了大而全客户端里 80% 的无用功能（TUN、复杂规则集、虚拟网卡驱动），专注打磨「**订阅拉取 -> 节点测速 -> 端口精准绑定**」，系统资源极低，操作直观高效。
