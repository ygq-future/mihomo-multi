export type ProfileType = 'remote' | 'local'

export interface ProfileItem {
  id: string
  name: string
  type: ProfileType
  url?: string
  filePath: string
  autoUpdateIntervalMins: number
  lastUpdatedAt: number
  nodeCount: number
}

export type InboundProtocol = 'mixed' | 'http' | 'socks5'

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
  acrylicEffect: boolean
  acrylicBlur: number
  acrylicOpacity: number
  backgroundImage: string
  backgroundOpacity: number
  testUrl: string
  timeoutMs: number
  fallbackInterval: number
  fallbackLazy: boolean
  systemProxyEnabled: boolean
  systemProxyPort?: number | null
  systemProxyBypassUser: string[]
  systemProxySyncEnv: boolean
}

export interface SystemProxyStatus {
  enabled: boolean
  port?: number | null
  bypassDomains: string[]
}

export interface UwpLoopbackStats {
  supported: boolean
  exemptedCount: number
  totalCount: number
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
}

export interface KernelUpdateCheckResult {
  isPortable: boolean
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
  isPortable: boolean
}

export interface MrsRulesInfo {
  all_present: boolean
  missing: string[]
  last_updated_at?: number | null
  total_size: number
}
