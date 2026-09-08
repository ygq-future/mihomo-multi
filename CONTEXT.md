# Mihomo Multi-Port 领域模型 (Context)

基于 Mihomo (Clash.Meta) 内核，专注于本地独立入站端口与代理节点 1:1 确定性绑定的桌面客户端。

## 术语表 (Language)

### 端口与路由 (Port & Routing)

**PortMapping (端口映射)**:
本地专用入站监听端口与特定代理节点之间的确定性绑定配置规则。
_Avoid_: InboundRule, 入站规则, 代理端口, 路由条目

**InboundListener (入站监听器)**:
由内核在本地网络接口上暴露的活跃监听端点，负责接收特定端口映射的流量。
_Avoid_: LocalServer, 本地服务器, 端口绑定, Socket监听

**FallbackNode (备用节点)**:
为主节点配置的同订阅或跨订阅二级备用代理节点，在主节点不可用或手动切换时承接流量。
_Avoid_: BackupNode, 备用代理, 故障转移目标, 兜底节点

**ChinaRouteBypass (国内直连分流)**:
通过内置私网与国内规则集实现的细粒度路由模式，国内与私有流量直连，其余流量经由绑定节点出站。
_Avoid_: DomesticBypass, 分流规则, 国外代理, 智能分流

### 订阅与节点池 (Profile & Proxy Nodes)

**Profile (配置/订阅)**:
导入的代理出站节点配置源，分为携带更新周期的远程订阅 URL 或本地静态配置文件。
_Avoid_: Subscription, 规则集, 订阅源, ConfigFile

**ProxyNode (代理节点)**:
单台远端代理出站服务器定义，基于 Shadowsocks、VMess、Trojan、VLESS 或 Hysteria2 等协议提供出站能力。
_Avoid_: Outbound, 出站节点, 代理服务器, NodeItem

**PortDrift (端口漂移)**:
订阅配置更新后，端口映射所绑定的节点或所属配置被移除、重命名或失效的脱节状态。
_Avoid_: OutOfSync, 配置错位, 映射损坏, 节点漂移

**RuntimeConfig (运行时配置)**:
由系统根据激活的节点池与启用的端口映射在内存中动态组装、并在磁盘原子写入的最小化 Mihomo 配置文件。
_Avoid_: CoreConfig, 合并配置, 动态Yaml, 生成配置

### 系统集成与环境 (System Integration & Environment)

**SystemProxy (受控系统代理)**:
将操作系统全局流量导流至至多一个已启用端口映射的辅助网络设置，全局严格单选互斥。
_Avoid_: GlobalProxy, 全局代理, 系统劫持, 默认代理

**ExternalController (外部控制器)**:
由内核暴露的经鉴权的本地 RESTful API 服务，负责热重载配置、状态监测与节点延迟测速。
_Avoid_: AdminApi, 控制端点, 内核API, RestEndpoint

**SidecarProcess (伴生进程)**:
由客户端主进程拉起、生命周期与宿主严格绑定的 Mihomo 内核子进程。
_Avoid_: BackgroundDaemon, 后台守护进程, 子服务, CoreEngine

**UwpLoopbackExemption (UWP 回环豁免)**:
Windows 平台特有的本地代理沙盒网络隔离豁免机制，允许商店应用访问本机回环代理端口。
_Avoid_: LoopbackFix, 回环修复, 容器豁免, WindowsExempt

## 领域边界与不变式约束 (Invariants & Boundaries)

1. **确定性路由原则 (Deterministic Routing)**：
   每个启用的入站端口均精确映射至指定节点或其备用组，严禁引入隐式随机漂移或未经配置的负载均衡；所有路由规则末尾必须以 `MATCH,DIRECT` 安全兜底。

2. **节点失效防护与平稳降级 (Drift Resilience & Safe Fallback)**：
   订阅更新导致节点缺失或订阅被删除时，端口监听必须保持开启，系统标记端口漂移并将流量安全回退至直连（DIRECT），绝对禁止引发内核崩溃或加载失败。

3. **系统代理单选互斥与防断网红线 (Mutually Exclusive System Proxy & Leak Prevention)**：
   系统代理全局严格单选互斥，至多允许绑定 1 个已启用的本地端口；当绑定端口停用/删除、内核停止或客户端退出时，必须无条件完全清理操作系统代理配置及联动环境变量，杜绝断网残留。

4. **架构做减法原则 (Zero Architectural Creep)**：
   严禁引入 TUN 虚拟网卡模式及驱动、严禁引入基于 JavaScript/Lua 运行时的动态规则集预处理脚本系统。

5. **端口可用性前置校验 (Port Availability Verification)**：
   保存或启用端口映射前，必须通过本地 TCP 套接字绑定探测确认端口未被第三方程序占用。
