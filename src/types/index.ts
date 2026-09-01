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
}

export interface NodeLatencyResult {
  name: string
  latency?: number
  error?: string
}

export interface CoreStatus {
  running: boolean
  pid?: number
  controllerPort: number
  secret: string
  version?: string
  uptimeSeconds: number
  sidecarPath: string
}

export interface AppConfig {
  controllerPort: number
  controllerSecret: string
  autoStartCore: boolean
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
