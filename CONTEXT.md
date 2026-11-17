# Mihomo Multi 领域模型 (Context)

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

**TunMode (受控 TUN 模式)**:
受控虚拟网卡特性，全局流量单选绑定至 1 个已启用端口并复用该端口出站策略，与系统代理严格互斥。
_Avoid_: 全局模式, VPN, 虚拟网卡劫持, 全流量代理

### 订阅与节点池 (Profile & Proxy Nodes)

**Profile (配置/订阅)**:
导入的代理出站节点配置源，分为携带更新周期的远程订阅 URL 或本地静态配置文件。
_Avoid_: Subscription, 规则集, 订阅源, ConfigFile

**ProxyNode (代理节点)**:
单台远端代理出站服务器定义，基于 Shadowsocks、VMess、Trojan、VLESS 或 Hysteria2 等协议提供出站能力。
_Avoid_: Outbound, 出站节点, 代理服务器, NodeItem

**ResidentialProxy (住宅出口代理)**:
用户管理的 HTTP/SOCKS5 出站，包含服务器、端口和认证信息；端口映射可选择住宅出口代理，并将绑定的订阅节点作为固定中转。

**ProxyChain (代理链路)**:
本地端口经指定订阅节点连接住宅出口代理，再访问目标。每个端口生成独立的住宅出口节点，以 `dialer-proxy` 引用中转节点；同一中转或住宅出口可由多个端口复用。

**ResidentialProxyTest (住宅出口连通性测试)**:
对已保存的住宅出口选择订阅中转，使用独立临时 Mihomo 实例执行完整链路出口探测，返回请求延迟和出口 IPv4/归属地；不创建持久端口映射，不修改运行中内核配置、系统代理或 TUN。认证配置状态只说明凭据已填写，实际可用性以测试结果为准。

订阅 `proxies` 中的节点间 `dialer-proxy` 引用与节点名称统一加上订阅命名空间，订阅重命名时同步更新引用；`DIRECT` 保留其内置语义。缺失引用、循环引用、重复节点名及代理组引用均在导入时返回错误。住宅 HTTP/SOCKS5 订阅节点保留为普通订阅节点，不自动转换为手动住宅出口条目。

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
Windows 平台特有的本地代理沙盒网络隔离豁免机制，允许商店应用访问本机回环代理端口；执行「一键豁免」后，新安装的 AppContainer 自动纳入豁免，已卸载应用的豁免记录自动清理。
_Avoid_: LoopbackFix, 回环修复, 容器豁免, WindowsExempt

## 领域边界与不变式约束 (Invariants & Boundaries)

1. **确定性路由原则 (Deterministic Routing)**：
   每个启用的入站端口均精确映射至指定节点、其备用组或指定住宅出口链路，严禁引入隐式随机漂移或未经配置的负载均衡；所有路由规则末尾必须以 `MATCH,DIRECT` 兜底。住宅出口链路的监听器直接绑定链路出站，全部目标均经链路，不应用国内直连、绕过列表、端口/全局分流规则或备用节点。

2. **节点失效防护与平稳降级 (Drift Resilience & Safe Fallback)**：
   普通端口在订阅更新导致节点缺失或订阅被删除时保持监听，标记端口漂移并回退至直连（DIRECT）。住宅出口链路在中转节点或住宅出口缺失时保持监听并拒绝连接（REJECT），不得降级为直连或仅经中转节点出站；仍被端口引用的住宅出口不得删除。

3. **系统代理单选互斥与防断网红线 (Mutually Exclusive System Proxy & Leak Prevention)**：
   系统代理全局严格单选互斥，至多允许绑定 1 个已启用的本地端口；当绑定端口停用/删除、内核停止或客户端退出时，必须无条件完全清理操作系统代理配置及联动环境变量，杜绝断网残留。

4. **架构做减法原则 (Zero Architectural Creep)**：
   严禁引入基于 JavaScript/Lua 运行时的动态规则集预处理脚本系统；TUN 仅允许以受控特性存在（单选出口、与系统代理互斥、生命周期随内核进程）。

5. **端口可用性前置校验 (Port Availability Verification)**：
   保存或启用端口映射前，必须通过本地 TCP 套接字绑定探测确认端口未被第三方程序占用。
