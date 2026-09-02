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
  latency?: number
  description?: string
}

export interface ProxyNode {
  name: string
  type: string
  server: string
  port: number
  latency?: number
  profileId?: string
  profileName?: string
  runtimeName?: string
}

export interface NodeLatencyResult {
  name: string
  latency?: number
  error?: string
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

export interface AppConfig {
  controllerPort: number
  controllerSecret: string
  theme: string
  logLevel: string
}

export interface AppStatus {
  core: CoreStatus
  totalPorts: number
  activePorts: number
  totalProfiles: number
  totalNodes: number
  version: string
}
