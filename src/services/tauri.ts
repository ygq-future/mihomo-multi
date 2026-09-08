import { invoke } from '@tauri-apps/api/core'
import type {
  AppConfig,
  AppStatus,
  AutoUpdateEventPayload,
  AutoUpdaterStatus,
  CoreStatus,
  KernelUpdateCheckResult,
  KernelUpgradeResult,
  LanIpInfo,
  NodeLatencyResult,
  PortDriftReport,
  PortFallbackStatus,
  PortMapping,
  ProfileItem,
  ProxyNode,
  SystemProxyStatus,
  UwpLoopbackStats,
  AppUpdateCheckResult,
  AppUpdateInstallResult,
  MrsRulesInfo,
} from '../types'
import { APP_VERSION } from '../constants'

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
      version: APP_VERSION,
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

export async function checkPortAvailable(
  port: number,
  excludeMappingId?: string,
): Promise<boolean> {
  if (!isTauriEnvironment()) return true
  return invoke<boolean>('check_port_available', {
    port,
    excludeMappingId: excludeMappingId || null,
  })
}

export async function getNextAvailablePort(
  startPort?: number,
  excludeMappingId?: string,
): Promise<number> {
  if (!isTauriEnvironment()) return startPort || 7891
  return invoke<number>('get_next_available_port', {
    startPort: startPort || null,
    excludeMappingId: excludeMappingId || null,
  })
}

export async function getConfig(): Promise<AppConfig> {
  if (!isTauriEnvironment()) {
    return {
      controllerPort: 9999,
      controllerSecret: 'mock-secret',
      theme: 'system',
      logLevel: 'info',
      allowLan: false,
      selectedLanIp: null,
      closeToTray: true,
      autoLaunch: false,
      silentStart: false,
      lightweightMode: false,
      acrylicEffect: false,
      acrylicBlur: 12,
      acrylicOpacity: 65,
      backgroundImage: '',
      backgroundOpacity: 80,
      testUrl: 'http://cp.cloudflare.com/generate_204',
      timeoutMs: 3000,
      fallbackInterval: 5,
      fallbackLazy: false,
      systemProxyEnabled: false,
      systemProxyPort: null,
      systemProxyBypassUser: [],
      systemProxySyncEnv: true,
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

export async function getOccupiedPorts(): Promise<number[]> {
  if (!isTauriEnvironment()) {
    return []
  }
  return invoke<number[]>('get_occupied_ports')
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
      bypassCn: true,
    }
  }
  return invoke<PortMapping>('toggle_port_mapping', { id, enabled })
}
export async function toggleManualFallback(
  id: string,
  manualFallback: boolean,
): Promise<PortMapping> {
  if (!isTauriEnvironment()) {
    return {
      id,
      port: 7891,
      protocol: 'mixed',
      profileId: 'mock-profile',
      nodeName: 'mock-node',
      enabled: true,
      bypassCn: true,
      manualFallback,
    }
  }
  return invoke<PortMapping>('toggle_manual_fallback', {
    id,
    manualFallback,
  })
}

export async function testPortFallbackDelay(
  id: string,
  testUrl?: string,
  timeoutMs?: number,
): Promise<number> {
  if (!isTauriEnvironment()) {
    const { promise, resolve } = Promise.withResolvers<void>()
    setTimeout(resolve, 200 + Math.random() * 300)
    await promise
    return Math.floor(25 + Math.random() * 120)
  }
  return invoke<number>('test_port_fallback_delay', {
    id,
    testUrl: testUrl || null,
    timeoutMs: timeoutMs || null,
  })
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

let fallbackStatusRequest: Promise<PortFallbackStatus[]> | null = null

export async function getPortFallbackStatuses(): Promise<PortFallbackStatus[]> {
  if (!isTauriEnvironment()) {
    return []
  }
  if (!fallbackStatusRequest) {
    fallbackStatusRequest = invoke<PortFallbackStatus[]>(
      'get_port_fallback_statuses',
    ).finally(() => {
      fallbackStatusRequest = null
    })
  }
  return fallbackStatusRequest
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

export async function cancelLatencyProbe(): Promise<void> {
  if (!isTauriEnvironment()) {
    return
  }
  return invoke<void>('cancel_latency_probe')
}

export async function getLatencyCache(): Promise<
  Record<string, number | null>
> {
  if (!isTauriEnvironment()) {
    return {}
  }
  return invoke<Record<string, number | null>>('get_latency_cache')
}

export async function clearLatencyCache(): Promise<void> {
  if (!isTauriEnvironment()) {
    return
  }
  return invoke<void>('clear_latency_cache')
}

// ----------------------------------------------------------------------------
// Drift Guard & Auto Updater API
// ----------------------------------------------------------------------------

export async function getDriftReports(): Promise<PortDriftReport[]> {
  if (!isTauriEnvironment()) {
    return []
  }
  return invoke<PortDriftReport[]>('get_drift_reports')
}

export async function getAutoUpdaterStatus(): Promise<AutoUpdaterStatus> {
  if (!isTauriEnvironment()) {
    return {
      running: true,
      autoUpdateEnabled: true,
      checkIntervalSecs: 60,
      lastCheckTimestamp: Math.floor(Date.now() / 1000),
      totalManagedProfiles: 0,
      eligibleProfilesCount: 0,
    }
  }
  return invoke<AutoUpdaterStatus>('get_auto_updater_status')
}

export async function triggerAutoUpdateCheck(): Promise<
  AutoUpdateEventPayload[]
> {
  if (!isTauriEnvironment()) {
    return []
  }
  return invoke<AutoUpdateEventPayload[]>('trigger_auto_update_check')
}

export async function getLanIpAddresses(): Promise<LanIpInfo[]> {
  if (!isTauriEnvironment()) {
    return [
      { ip: '192.168.31.28', name: 'WLAN' },
      { ip: '10.254.254.254', name: 'Loopback-WSL' },
    ]
  }
  return invoke<LanIpInfo[]>('get_lan_ip_addresses')
}

export async function checkKernelUpdate(): Promise<KernelUpdateCheckResult> {
  if (!isTauriEnvironment()) {
    return {
      isPortable: false,
      targetPath: 'mock/binaries/mihomo.exe',
      currentVersion: 'Mihomo Meta v1.19.30',
      latestVersion: 'v1.19.30',
      hasUpdate: false,
    }
  }
  return invoke<KernelUpdateCheckResult>('check_kernel_update')
}

export async function upgradeKernel(): Promise<KernelUpgradeResult> {
  if (!isTauriEnvironment()) {
    return {
      previousVersion: 'Mihomo Meta v1.19.30',
      currentVersion: 'Mihomo Meta v1.19.30',
      targetPath: 'mock/binaries/mihomo.exe',
      isPortable: false,
    }
  }
  return invoke<KernelUpgradeResult>('upgrade_kernel')
}

export async function checkAppUpdate(): Promise<AppUpdateCheckResult> {
  if (!isTauriEnvironment()) {
    return {
      currentVersion: APP_VERSION,
      latestVersion: APP_VERSION,
      hasUpdate: false,
      releaseName: 'Mihomo Multi v1.0.0 (Mock)',
      releaseNotes: 'Mock release notes: Initial stable release.',
      releaseUrl: 'https://github.com/ygq-future/mihomo-multi/releases',
      publishedAt: '2026-09-07T00:00:00Z',
      asset: {
        name: 'mihomo-multi-setup-1.0.0.exe',
        downloadUrl:
          'https://github.com/ygq-future/mihomo-multi/releases/download/v1.0.0/mihomo-multi-setup-1.0.0.exe',
        size: 15728640,
        packageType: 'installer',
      },
      availableAssets: [
        {
          name: 'mihomo-multi-setup-1.0.0.exe',
          downloadUrl:
            'https://github.com/ygq-future/mihomo-multi/releases/download/v1.0.0/mihomo-multi-setup-1.0.0.exe',
          size: 15728640,
          packageType: 'installer',
        },
        {
          name: 'mihomo-multi-portable-1.0.0.zip',
          downloadUrl:
            'https://github.com/ygq-future/mihomo-multi/releases/download/v1.0.0/mihomo-multi-portable-1.0.0.zip',
          size: 12582912,
          packageType: 'portable',
        },
      ],
      isInstalled: true,
    }
  }
  return invoke<AppUpdateCheckResult>('check_app_update')
}

export async function installAppUpdate(
  downloadUrl: string,
  fileName: string,
  packageType: string,
): Promise<AppUpdateInstallResult> {
  if (!isTauriEnvironment()) {
    return {
      packageType,
      filePath: 'mock/path/update',
      message: 'Mock: Update downloaded successfully',
    }
  }
  return invoke<AppUpdateInstallResult>('install_app_update', {
    downloadUrl,
    fileName,
    packageType,
  })
}

export async function setSystemProxy(
  enabled: boolean,
  port?: number | null,
): Promise<SystemProxyStatus> {
  if (!isTauriEnvironment()) {
    return {
      enabled,
      port: enabled ? (port ?? 7890) : null,
      bypassDomains: ['localhost', '127.*', '10.*', '192.168.*', '<local>'],
    }
  }
  return invoke<SystemProxyStatus>('set_system_proxy', {
    enabled,
    port: port ?? null,
  })
}

export async function getSystemProxyStatus(): Promise<SystemProxyStatus> {
  if (!isTauriEnvironment()) {
    return {
      enabled: false,
      port: null,
      bypassDomains: ['localhost', '127.*', '10.*', '192.168.*', '<local>'],
    }
  }
  return invoke<SystemProxyStatus>('get_system_proxy_status')
}

export async function getDefaultBypassList(): Promise<string[]> {
  if (!isTauriEnvironment()) {
    return [
      'localhost',
      '127.*',
      '10.*',
      '172.16.*',
      '172.17.*',
      '172.18.*',
      '172.19.*',
      '172.20.*',
      '172.21.*',
      '172.22.*',
      '172.23.*',
      '172.24.*',
      '172.25.*',
      '172.26.*',
      '172.27.*',
      '172.28.*',
      '172.29.*',
      '172.30.*',
      '172.31.*',
      '192.168.*',
      '<local>',
    ]
  }
  return invoke<string[]>('get_default_bypass_list')
}

export async function getUwpLoopbackStatus(): Promise<UwpLoopbackStats> {
  if (!isTauriEnvironment()) {
    const isWindows =
      typeof navigator !== 'undefined' &&
      (/win/i.test(navigator.userAgent) ||
        /windows/i.test(navigator.platform || ''))
    return {
      supported: isWindows,
      exemptedCount: isWindows ? 120 : 0,
      totalCount: isWindows ? 129 : 0,
    }
  }
  return invoke<UwpLoopbackStats>('get_uwp_loopback_status')
}

export async function exemptAllUwpLoopback(): Promise<UwpLoopbackStats> {
  if (!isTauriEnvironment()) {
    return {
      supported: true,
      exemptedCount: 129,
      totalCount: 129,
    }
  }
  return invoke<UwpLoopbackStats>('exempt_all_uwp_loopback')
}

export async function clearAllUwpLoopback(): Promise<UwpLoopbackStats> {
  if (!isTauriEnvironment()) {
    return {
      supported: true,
      exemptedCount: 0,
      totalCount: 129,
    }
  }
  return invoke<UwpLoopbackStats>('clear_all_uwp_loopback')
}

export async function resetWindowSize(): Promise<void> {
  if (!isTauriEnvironment()) return
  return invoke<void>('reset_window_size')
}

export async function exitApp(): Promise<void> {
  if (!isTauriEnvironment()) return
  return invoke<void>('exit_app')
}

export async function hideWindow(): Promise<void> {
  if (!isTauriEnvironment()) return
  return invoke<void>('hide_window')
}

export async function getRulesInfo(): Promise<MrsRulesInfo> {
  if (!isTauriEnvironment()) {
    return {
      all_present: true,
      missing: [],
      last_updated_at: Math.floor(Date.now() / 1000),
      total_size: 576916,
    }
  }
  return invoke<MrsRulesInfo>('get_rules_info')
}

export async function updateRules(): Promise<MrsRulesInfo> {
  if (!isTauriEnvironment()) {
    return {
      all_present: true,
      missing: [],
      last_updated_at: Math.floor(Date.now() / 1000),
      total_size: 576916,
    }
  }
  return invoke<MrsRulesInfo>('update_rules')
}
