# Domain Context: Mihomo Multi-Port

本项目是一个基于 **Tauri v2 + Rust + React + Mihomo (Clash.Meta) 内核** 的轻量级多端口代理监听绑定工具。

---

## 1. 核心术语表 (Glossary)

| 术语 (Term) | 类型 | 定义与边界 |
| :--- | :--- | :--- |
| **Profile (订阅/配置)** | 领域实体 | 用户导入的代理配置源。分为远程订阅 (`Remote`, 包含 URL 及自动更新周期) 和本地配置 (`Local`, 本地 YAML 文件的绝对路径)。Profile 负责提供可用的节点池 (`proxies`)。 |
| **ProxyNode (代理节点)** | 领域实体 | 单个出站代理服务器（如 Shadowsocks, VMess, Trojan, VLESS, Hysteria2 等）。拥有唯一的 `name`、服务器地址、端口及协议类型。 |
| **PortMapping (端口映射)** | 核心实体 | 本地入站端口与代理节点的 1:1 绑定规则。包含 `id`、`port` (如 7891)、`protocol` (`mixed` / `http` / `socks5`)、`profile_id`、`node_name`、`enabled` 启停状态与实时延迟。 |
| **InboundListener (入站监听器)** | 内核概念 | 映射到 Mihomo 配置中 `listeners` 数组下的入站条目，负责在指定的本地端口（默认仅监听 `127.0.0.1`）接收流量。 |
| **RuntimeConfig (运行时配置)** | 派生配置 | 由后端根据当前激活的 Profile 节点池与所有已启用的 `PortMapping` 动态组装合成的最小化 Mihomo `config.yaml`。 |
| **ExternalController (外部控制器)** | 基础设施 | Mihomo 暴露的本地 RESTful API 服务（默认 `127.0.0.1:9999`），负责配置热重载 (`PUT /configs`) 与节点延迟测速 (`GET /proxies/{name}/delay`)。 |
| **Sidecar (伴生进程)** | 基础设施 | 由 Tauri 主进程拉起并生命周期受控的 Mihomo 二进制子进程。主进程退出时伴生进程必须被可靠终止。 |

---

## 2. 领域边界与不变式约束 (Invariants & Boundaries)

1. **确定性路由 (Deterministic Routing)**：
   * 每一个入站端口严格通过 `IN-PORT,<port>,<node_name>` 规则直接路由到指定节点，**严禁引入隐式负载均衡或未授权的自动故障漂移**。
   * 兜底规则永远为 `MATCH,DIRECT`。
2. **节点失效防护 (Node Failure Resilience)**：
   * 若 `PortMapping` 所绑定的节点在订阅更新后不存在或改名，系统保持端口监听，但将该端口在 UI 标记为 `🔴 节点已失效`，流量安全直连或丢弃，**绝对不允许引发内核崩溃或配置加载失败**。
3. **架构减法红线 (Zero Architectural Creep)**：
   * 严禁引入 TUN 虚拟网卡模式；
   * 严禁引入系统代理劫持（System Proxy Override）；
   * 严禁引入复杂的 JavaScript/Lua 脚本预处理或复杂规则集系统。
4. **端口防冲突检查 (Port Conflict Probe)**：
   * 在保存或启用 `PortMapping` 前，必须通过 `std::net::TcpListener::bind` 进行本地端口占用探测。
