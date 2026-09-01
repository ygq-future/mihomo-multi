import { invoke } from '@tauri-apps/api/core'
import type {
  AppConfig,
  AppStatus,
  CoreStatus,
  NodeLatencyResult,
  PortMapping,
  ProfileItem,
  ProxyNode,
} from '../types'

function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function getAppStatus(): Promise<AppStatus> {
  if (!isTauriEnvironment()) {
    return {
      core: {
        running: true,
        pid: 12345,
        controllerPort: 9999,
        secret: 'mock-secret',
        version: 'Mihomo Meta v1.19.30 (Mock)',
        uptimeSeconds: 42,
        sidecarPath: 'mock/path/mihomo.exe',
      },
      totalPorts: 0,
      activePorts: 0,
      totalProfiles: 0,
      totalNodes: 0,
      version: '0.1.0',
    }
  }
  return invoke<AppStatus>('get_app_status')
}

export async function getCoreStatus(): Promise<CoreStatus> {
  if (!isTauriEnvironment()) {
    return {
      running: true,
      pid: 12345,
      controllerPort: 9999,
      secret: 'mock-secret',
      version: 'Mihomo Meta v1.19.30 (Mock)',
      uptimeSeconds: 42,
      sidecarPath: 'mock/path/mihomo.exe',
    }
  }
  return invoke<CoreStatus>('get_core_status')
}

export async function startCore(): Promise<CoreStatus> {
  if (!isTauriEnvironment()) {
    return getCoreStatus()
  }
  return invoke<CoreStatus>('start_core')
}

export async function stopCore(): Promise<void> {
  if (!isTauriEnvironment()) return
  return invoke<void>('stop_core')
}

export async function restartCore(): Promise<CoreStatus> {
  if (!isTauriEnvironment()) {
    return getCoreStatus()
  }
  return invoke<CoreStatus>('restart_core')
}

export async function checkPortAvailable(port: number): Promise<boolean> {
  if (!isTauriEnvironment()) return true
  return invoke<boolean>('check_port_available', { port })
}

export async function getConfig(): Promise<AppConfig> {
  if (!isTauriEnvironment()) {
    return {
      controllerPort: 9999,
      controllerSecret: 'mock-secret',
      autoStartCore: true,
      theme: 'dark',
      logLevel: 'info',
    }
  }
  return invoke<AppConfig>('get_config')
}

export async function saveConfig(config: AppConfig): Promise<void> {
  if (!isTauriEnvironment()) return
  return invoke<void>('save_config', { config })
}

// ----------------------------------------------------------------------------
// Port Mapping Management API
// ----------------------------------------------------------------------------

export async function getPortMappings(): Promise<PortMapping[]> {
  if (!isTauriEnvironment()) {
    return []
  }
  return invoke<PortMapping[]>('get_port_mappings')
}

export async function savePortMapping(
  mapping: PortMapping,
): Promise<PortMapping> {
  if (!isTauriEnvironment()) {
    return {
      ...mapping,
      id: mapping.id || `mock-port-${Date.now()}`,
    }
  }
  return invoke<PortMapping>('save_port_mapping', { mapping })
}

export async function deletePortMapping(id: string): Promise<void> {
  if (!isTauriEnvironment()) return
  return invoke<void>('delete_port_mapping', { id })
}

export async function togglePortMapping(
  id: string,
  enabled: boolean,
): Promise<PortMapping> {
  if (!isTauriEnvironment()) {
    return {
      id,
      port: 7891,
      protocol: 'mixed',
      profileId: 'mock-profile',
      nodeName: 'mock-node',
      enabled,
    }
  }
  return invoke<PortMapping>('toggle_port_mapping', { id, enabled })
}

export async function testPortMappingDelay(
  id: string,
  testUrl?: string,
  timeoutMs?: number,
): Promise<number> {
  if (!isTauriEnvironment()) {
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 300))
    return Math.floor(25 + Math.random() * 120)
  }
  return invoke<number>('test_port_mapping_delay', {
    id,
    testUrl: testUrl || null,
    timeoutMs: timeoutMs || null,
  })
}

export async function testAllPortMappingsDelay(
  testUrl?: string,
  timeoutMs?: number,
  concurrency?: number,
): Promise<NodeLatencyResult[]> {
  if (!isTauriEnvironment()) {
    await new Promise((r) => setTimeout(r, 600))
    return []
  }
  return invoke<NodeLatencyResult[]>('test_all_port_mappings_delay', {
    testUrl: testUrl || null,
    timeoutMs: timeoutMs || null,
    concurrency: concurrency || null,
  })
}

// ----------------------------------------------------------------------------
// Profile & Subscription Management API
// ----------------------------------------------------------------------------

export async function getProfiles(): Promise<ProfileItem[]> {
  if (!isTauriEnvironment()) {
    return []
  }
  return invoke<ProfileItem[]>('get_profiles')
}

export async function addRemoteProfile(
  name: string,
  url: string,
  intervalMins: number,
): Promise<ProfileItem> {
  if (!isTauriEnvironment()) {
    return {
      id: 'mock-remote-1',
      name,
      type: 'remote',
      url,
      filePath: 'profiles/mock-remote-1.yaml',
      autoUpdateIntervalMins: intervalMins,
      lastUpdatedAt: Math.floor(Date.now() / 1000),
      nodeCount: 5,
    }
  }
  return invoke<ProfileItem>('add_remote_profile', {
    name,
    url,
    intervalMins,
  })
}

export async function addLocalProfile(
  name: string,
  filePath: string,
): Promise<ProfileItem> {
  if (!isTauriEnvironment()) {
    return {
      id: 'mock-local-1',
      name,
      type: 'local',
      filePath,
      autoUpdateIntervalMins: 0,
      lastUpdatedAt: Math.floor(Date.now() / 1000),
      nodeCount: 3,
    }
  }
  return invoke<ProfileItem>('add_local_profile', {
    name,
    filePath,
  })
}

export async function updateProfile(id: string): Promise<ProfileItem> {
  if (!isTauriEnvironment()) {
    return {
      id,
      name: 'Updated Profile',
      type: 'remote',
      filePath: `profiles/${id}.yaml`,
      autoUpdateIntervalMins: 0,
      lastUpdatedAt: Math.floor(Date.now() / 1000),
      nodeCount: 5,
    }
  }
  return invoke<ProfileItem>('update_profile', { id })
}

export async function editProfile(
  id: string,
  name: string,
  url: string | undefined,
  intervalMins: number,
): Promise<ProfileItem> {
  if (!isTauriEnvironment()) {
    return {
      id,
      name,
      type: url ? 'remote' : 'local',
      url,
      filePath: `profiles/${id}.yaml`,
      autoUpdateIntervalMins: intervalMins,
      lastUpdatedAt: Math.floor(Date.now() / 1000),
      nodeCount: 5,
    }
  }
  return invoke<ProfileItem>('edit_profile', {
    id,
    name,
    url: url || null,
    intervalMins,
  })
}

export async function deleteProfile(id: string): Promise<void> {
  if (!isTauriEnvironment()) return
  return invoke<void>('delete_profile', { id })
}

export async function getProfileNodes(profileId: string): Promise<ProxyNode[]> {
  if (!isTauriEnvironment()) {
    return []
  }
  return invoke<ProxyNode[]>('get_profile_nodes', { profileId })
}

export async function openAppDataDir(): Promise<void> {
  if (!isTauriEnvironment()) return
  return invoke<void>('open_app_data_dir')
}

export async function openFileInFolder(filePath: string): Promise<void> {
  if (!isTauriEnvironment()) return
  return invoke<void>('open_file_in_folder', { filePath })
}

export async function getAppDir(): Promise<string> {
  if (!isTauriEnvironment()) {
    return 'D:\\Users\\sheepyu\\AppData\\Local\\com.mihomo.multi'
  }
  return invoke<string>('get_app_dir')
}

export async function getAllNodes(): Promise<ProxyNode[]> {
  if (!isTauriEnvironment()) {
    return []
  }
  return invoke<ProxyNode[]>('get_all_nodes')
}

export async function testNodeDelay(
  nodeName: string,
  testUrl?: string,
  timeoutMs?: number,
): Promise<number> {
  if (!isTauriEnvironment()) {
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 300))
    return Math.floor(25 + Math.random() * 120)
  }
  return invoke<number>('test_node_delay', {
    nodeName,
    testUrl: testUrl || null,
    timeoutMs: timeoutMs || null,
  })
}

export async function testNodesDelayBatch(
  nodeNames: string[],
  testUrl?: string,
  timeoutMs?: number,
  concurrency?: number,
): Promise<NodeLatencyResult[]> {
  if (!isTauriEnvironment()) {
    await new Promise((r) => setTimeout(r, 600))
    return nodeNames.map((name) => ({
      name,
      latency: Math.floor(20 + Math.random() * 200),
    }))
  }
  return invoke<NodeLatencyResult[]>('test_nodes_delay_batch', {
    nodeNames,
    testUrl: testUrl || null,
    timeoutMs: timeoutMs || null,
    concurrency: concurrency || null,
  })
}
