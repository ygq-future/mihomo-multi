import { invoke } from '@tauri-apps/api/core'
import type { AppConfig, AppStatus, CoreStatus } from '../types'

function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function getAppStatus(): Promise<AppStatus> {
  if (!isTauriEnvironment()) {
    return {
      core: {
        running: true,
        pid: 12345,
        controller_port: 9999,
        secret: 'mock-secret',
        version: 'Mihomo Meta v1.19.30 (Mock)',
        uptime_seconds: 42,
        sidecar_path: 'mock/path/mihomo.exe',
      },
      total_ports: 0,
      active_ports: 0,
      total_profiles: 0,
      total_nodes: 0,
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
      controller_port: 9999,
      secret: 'mock-secret',
      version: 'Mihomo Meta v1.19.30 (Mock)',
      uptime_seconds: 42,
      sidecar_path: 'mock/path/mihomo.exe',
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
      controller_port: 9999,
      controller_secret: 'mock-secret',
      auto_start_core: true,
      theme: 'dark',
      log_level: 'info',
    }
  }
  return invoke<AppConfig>('get_config')
}

export async function saveConfig(config: AppConfig): Promise<void> {
  if (!isTauriEnvironment()) return
  return invoke<void>('save_config', { config })
}
