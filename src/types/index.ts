export type ProfileType = 'remote' | 'local'

export interface SubscriptionInfo {
  upload?: number
  download?: number
  total?: number
  remainingBytes?: number
  expireAt?: number
  neverExpires?: boolean
  resetDays?: number
}

export interface ProfileItem {
  id: string
  name: string
  type: ProfileType
  url?: string
  filePath: string
  autoUpdateIntervalMins: number
  lastUpdatedAt: number
  nodeCount: number
  subscriptionInfo?: SubscriptionInfo
  enabled: boolean
}

export type InboundProtocol = 'mixed' | 'http' | 'socks5'

export type PortRuleMatchType =
  | 'domain-suffix'
  | 'domain'
  | 'domain-regex'
  | 'domain-keyword'
  | 'ip-cidr'

export type PortRuleTargetType = 'node' | 'port' | 'direct'

export interface PortRule {
  id: string
  name?: string
  icon?: string
  matchType: PortRuleMatchType
  payloads: string[]
  targetType: PortRuleTargetType
  targetValue: string
  targetProfileId?: string
  enabled: boolean
}

export interface PortMapping {
  id: string
  port: number
  protocol: InboundProtocol
  profileId: string
  nodeName: string
  enabled: boolean
  latency?: number | null
  description?: string
  fallbackProfileId?: string | null
  fallbackNodeName?: string | null
  bypassCn: boolean
  manualFallback?: boolean
  rules?: PortRule[]
  /**
   * 住宅出口 ID。设置后该端口进入链路模式：
   * 上游节点 (profileId + nodeName) -> 住宅出口 -> 目标站点，
   * 绕过大陆、备用节点与网站分流规则全部失效。
   */
  residentialProxyId?: string | null
}

export type ResidentialProxyProtocol = 'http' | 'socks5'

export interface ResidentialProxy {
  id: string
  name: string
  protocol: ResidentialProxyProtocol
  server: string
  port: number
  username: string
  password: string
}

/** Probe result for a saved exit, measured through the selected upstream node. */
export interface ResidentialProxyTestResult {
  latencyMs: number
  egress: DirectEgressInfo
}

export interface DirectEgressInfo {
  ip: string
  region: string
  countryCode?: string | null
  isp?: string | null
  latencyMs?: number | null
  source: string
}

export interface PortFallbackStatus {
  mappingId: string
  port: number
  primaryNode: string
  fallbackNode: string
  activeNode: string
  isFallbackActive: boolean
  manualFallback?: boolean
  primaryLatency?: number | null
  fallbackLatency?: number | null
  lastUpdated: number
}

export interface ProxyNode {
  name: string
  type: string
  server: string
  port: number
  latency?: number | null
  profileId?: string
  profileName?: string
  runtimeName?: string
}

export interface NodeLatencyResult {
  name: string
  latency?: number | null
  error?: string
}

export interface LatencyUpdatePayload {
  name: string
  runtimeName?: string
  latency: number | null
  error?: string
  mappingId?: string
  completed: number
  total: number
}

export interface LatencyProgressPayload {
  isTesting: boolean
  total: number
  completed: number
}

export type DriftStatus =
  | 'healthy'
  | 'node_missing'
  | 'profile_missing'
  | 'empty_profile'

export interface PortDriftReport {
  mappingId: string
  port: number
  profileId: string
  profileName: string
  nodeName: string
  enabled: boolean
  status: DriftStatus
  message: string
  fallbackAction: string
  suggestions?: string[]
}

export interface AutoUpdateEventPayload {
  profileId: string
  profileName: string
  success: boolean
  previousNodeCount: number
  newNodeCount: number
  driftedPortsCount: number
  timestamp: number
  error?: string
}

export interface AutoUpdaterStatus {
  running: boolean
  autoUpdateEnabled: boolean
  checkIntervalSecs: number
  lastCheckTimestamp: number
  totalManagedProfiles: number
  eligibleProfilesCount: number
}

export interface CoreStatus {
  running: boolean
  pid?: number
  controllerPort: number
  secret: string
  version?: string
  uptimeSeconds: number
  sidecarPath: string
  lastError?: string
}
export interface KernelCrashedPayload {
  reason: string
  systemProxySuspended: boolean
  suspendedPort?: number | null
}

export interface ProxyRestoredPayload {
  port: number
}

export interface LanIpInfo {
  ip: string
  name: string
}

export interface AppConfig {
  controllerPort: number
  controllerSecret: string
  theme: string
  logLevel: string
  allowLan: boolean
  selectedLanIp?: string | null
  closeToTray: boolean
  autoLaunch: boolean
  silentStart: boolean
  lightweightMode: boolean
  acrylicEffect: boolean
  acrylicBlur: number
  acrylicOpacity: number
  backgroundImage: string
  backgroundOpacity: number
  testUrl: string
  timeoutMs: number
  fallbackInterval: number
  fallbackLazy: boolean
  networkCheckIntervalSecs?: number
  systemProxyEnabled: boolean
  systemProxyPort?: number | null
  systemProxyBypassUser: string[]
  systemProxySyncEnv: boolean
  envProxyEnabled?: boolean
  envProxyPort?: number | null
  tunEnabled: boolean
  tunPort?: number | null
  globalRules?: PortRule[]
  checkUpdateOnStart?: boolean
  uwpAutoExempt?: boolean
  residentialProxies?: ResidentialProxy[]
}

export interface SystemProxyStatus {
  enabled: boolean
  port?: number | null
  bypassDomains: string[]
}

export interface EnvProxyStatus {
  enabled: boolean
  port?: number | null
}

export interface TunStatus {
  enabled: boolean
  active: boolean
  port?: number | null
  elevated: boolean
  pendingElevation: boolean
}

export interface UwpLoopbackStats {
  supported: boolean
  exemptedCount: number
  totalCount: number
  cleanedCount?: number
  newlyExemptedCount?: number
  autoExempt?: boolean
}

export interface UwpAppInfo {
  name: string
  moniker: string
  sid: string
  exempted: boolean
}

export interface AppUpdateAsset {
  name: string
  downloadUrl: string
  size: number
  packageType: 'installer' | 'portable'
}

export interface AppUpdateCheckResult {
  currentVersion: string
  latestVersion: string
  hasUpdate: boolean
  releaseName?: string | null
  releaseNotes?: string | null
  releaseUrl?: string | null
  publishedAt?: string | null
  asset?: AppUpdateAsset | null
  availableAssets: AppUpdateAsset[]
  isInstalled: boolean
}

export interface AppUpdateProgressPayload {
  percentage: number
  downloadedBytes: number
  totalBytes: number
  stage: string
}

export interface AppUpdateInstallResult {
  packageType: string
  filePath: string
  message: string
}

export interface AppStatus {
  core: CoreStatus
  totalPorts: number
  activePorts: number
  totalProfiles: number
  totalNodes: number
  version: string
  isInstalled: boolean
}

export interface KernelUpdateCheckResult {
  installMode: 'portable' | 'installed' | 'dev'
  targetPath: string
  currentVersion: string
  latestVersion: string
  hasUpdate: boolean
  releaseNotes?: string
  releaseUrl?: string
}

export interface KernelUpgradeResult {
  previousVersion: string
  currentVersion: string
  targetPath: string
  installMode: 'portable' | 'installed' | 'dev'
}

export interface MrsRulesInfo {
  all_present: boolean
  missing: string[]
  last_updated_at?: number | null
  total_size: number
}

export interface ConnectionMetadata {
  network: string
  type: string
  sourceIP: string
  destinationIP: string
  sourcePort: string
  destinationPort: string
  inboundIP?: string | null
  inboundPort?: string | null
  inboundName?: string | null
  inboundUser?: string | null
  host: string
  dnsMode?: string | null
  process?: string | null
  processPath?: string | null
  specialProxy?: string | null
  specialRules?: string | null
  remoteDestination?: string | null
  sniffHost?: string | null
}

export interface ConnectionItem {
  id: string
  metadata: ConnectionMetadata
  upload: number
  download: number
  start: string
  chains: string[]
  rule: string
  rulePayload?: string | null
}

export interface ConnectionSnapshot {
  downloadTotal: number
  uploadTotal: number
  memory?: number | null
  connections: ConnectionItem[]
}

export interface SniffedAccessLogEntry {
  host: string
  inboundPort?: string | null
  chain: string
  rule: string
  timestampMs: number
}

export interface PortProcessUsageItem {
  processName: string
  processPath?: string | null
  firstSeenAt: number
  lastSeenAt: number
  hitCount: number
  isActive: boolean
  activeConnectionCount: number
  iconDataUrl?: string | null
}

export interface AvailabilityWeights {
  timeoutCount: number
  timeoutDuration: number
  connectionErrors: number
  avgSpeed: number
  maxSpeed: number
  minSpeed: number
  latencyQuality: number
}

export interface NodeAnomalyEvent {
  timestampMs: number
  kind: 'timeout' | 'connection_error' | 'recovered' | string
  message: string
  durationMs?: number | null
}

export interface DimensionScores {
  timeoutCount: number
  timeoutDuration: number
  connectionErrors: number
  avgSpeed: number
  maxSpeed: number
  minSpeed: number
  latencyQuality: number
}

export interface NodeAnalyticsSummary {
  nodeName: string
  score: number
  grade: string
  confidence: 'high' | 'medium' | 'low' | string
  isCurrentlyTimedOut: boolean
  probeTotal: number
  probeSuccess: number
  successRate: number
  timeoutCount: number
  timeoutDurationMs: number
  maxSingleTimeoutMs: number
  connectionErrors: number
  connectionSamples: number
  totalUploadBytes: number
  totalDownloadBytes: number
  avgSpeedBps: number
  maxSpeedBps: number
  minSpeedBps: number
  avgLatencyMs?: number | null
  jitterMs?: number | null
  lastLatencyMs?: number | null
  lastSeenMs: number
  dimensions: DimensionScores
  recentEvents: NodeAnomalyEvent[]
}

export interface AnalyticsTimelinePoint {
  bucketStartMs: number
  avgSpeedBps: number
  maxSpeedBps: number
  timeoutCount: number
  connectionErrors: number
  avgLatencyMs?: number | null
}

export interface NodeAnalyticsDashboard {
  generatedAtMs: number
  windowHours: number
  weights: AvailabilityWeights
  totalNodes: number
  healthyNodes: number
  warningNodes: number
  criticalNodes: number
  avgScore: number
  totalTimeouts: number
  totalTimeoutDurationMs: number
  totalConnectionErrors: number
  totalTrafficBytes: number
  globalPeakSpeedBps: number
  globalAvgSpeedBps: number
  nodes: NodeAnalyticsSummary[]
  timeline: AnalyticsTimelinePoint[]
}

export interface SystemNetworkStatus {
  online: boolean
  lastCheckedMs: number
  offlineSinceMs?: number | null
  consecutiveFailures: number
}
