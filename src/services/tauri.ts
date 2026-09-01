import { invoke } from '@tauri-apps/api/core'
import type {
  AppConfig,
  AppStatus,
  CoreStatus,
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

// Profile & Subscription Management API
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
