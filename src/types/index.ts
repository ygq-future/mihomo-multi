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

export interface CoreStatus {
  running: boolean
  pid?: number
  controller_port: number
  secret: string
  version?: string
  uptime_seconds: number
  sidecar_path: string
}

export interface AppConfig {
  controller_port: number
  controller_secret: string
  auto_start_core: boolean
  theme: string
  log_level: string
}

export interface AppStatus {
  core: CoreStatus
  total_ports: number
  active_ports: number
  total_profiles: number
  total_nodes: number
  version: string
}
