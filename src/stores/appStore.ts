import { create } from 'zustand'
import * as api from '../services/tauri'
import type { AppConfig, AppStatus, CoreStatus, TunStatus } from '../types'
import { type PortSlice, createPortSlice } from './portSlice'
import { type ProfileSlice, createProfileSlice } from './profileSlice'
import { type ProxySlice, createProxySlice } from './proxySlice'
let inFlightStatusPromise: Promise<void> | null = null

export type TabType =
  | 'ports'
  | 'proxies'
  | 'profiles'
  | 'connections'
  | 'settings'

export interface BaseAppState {
  activeTab: TabType
  sidebarCollapsed: boolean
  appStatus: AppStatus | null
  coreStatus: CoreStatus | null
  config: AppConfig | null
  coreLoading: boolean
  error: string | null
  targetSettingSection: string | null
  scrollToSettingSection: (sectionId: string) => void
  clearTargetSettingSection: () => void
  setActiveTab: (tab: TabType) => void
  toggleSidebar: () => void
  fetchStatus: () => Promise<void>
  startCore: () => Promise<void>
  stopCore: () => Promise<void>
  restartCore: () => Promise<void>
  fetchConfig: () => Promise<void>
  saveConfig: (config: AppConfig) => Promise<void>
  setSystemProxy: (enabled: boolean, port?: number | null) => Promise<void>
  tunStatus: TunStatus | null
  fetchTunStatus: () => Promise<void>
  setTun: (enabled: boolean, port?: number | null) => Promise<TunStatus>
  restartAsAdmin: () => Promise<void>
}

export type RootStore = BaseAppState & ProfileSlice & ProxySlice & PortSlice

export const useAppStore = create<RootStore>()((set, get, store) => ({
  ...createProfileSlice(set, get, store),
  ...createProxySlice(set, get, store),
  ...createPortSlice(set, get, store),

  activeTab: 'ports',
  sidebarCollapsed:
    typeof window !== 'undefined' &&
    localStorage.getItem('sidebar_collapsed') === 'true',
  appStatus: null,
  coreStatus: null,
  config: null,
  coreLoading: false,
  tunStatus: null,
  error: null,
  targetSettingSection: null,
  scrollToSettingSection: (sectionId) =>
    set({ activeTab: 'settings', targetSettingSection: sectionId }),
  clearTargetSettingSection: () => set({ targetSettingSection: null }),
  setActiveTab: (activeTab) => set({ activeTab }),

  toggleSidebar: () => {
    const next = !get().sidebarCollapsed
    try {
      localStorage.setItem('sidebar_collapsed', String(next))
    } catch {
      // ignore storage errors
    }
    set({ sidebarCollapsed: next })
  },

  fetchStatus: async () => {
    if (inFlightStatusPromise) {
      return inFlightStatusPromise
    }

    inFlightStatusPromise = (async () => {
      try {
        const appStatus = await api.getAppStatus()
        const core = appStatus.core
        const state = get()
        const currentCore = state.coreStatus
        const currentApp = state.appStatus

        // Check if coreStatus actually changed (ignoring purely uptimeSeconds if other fields unchanged)
        const coreChanged =
          !currentCore ||
          currentCore.running !== core.running ||
          currentCore.pid !== core.pid ||
          currentCore.controllerPort !== core.controllerPort ||
          currentCore.secret !== core.secret ||
          currentCore.lastError !== core.lastError ||
          currentCore.uptimeSeconds !== core.uptimeSeconds

        const appChanged =
          !currentApp ||
          currentApp.version !== appStatus.version ||
          currentApp.isInstalled !== appStatus.isInstalled ||
          currentApp.totalPorts !== appStatus.totalPorts ||
          currentApp.activePorts !== appStatus.activePorts ||
          currentApp.totalProfiles !== appStatus.totalProfiles ||
          currentApp.totalNodes !== appStatus.totalNodes ||
          coreChanged
        if (!coreChanged && !appChanged) {
          return
        }

        set({
          appStatus: appChanged ? appStatus : currentApp,
          coreStatus: coreChanged ? core : currentCore,
          error: core.running ? null : (core.lastError ?? null),
        })
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) })
      } finally {
        inFlightStatusPromise = null
      }
    })()

    return inFlightStatusPromise
  },

  startCore: async () => {
    set({ coreLoading: true, error: null })
    try {
      const coreStatus = await api.startCore()
      set((state) => ({
        coreStatus,
        appStatus: state.appStatus
          ? { ...state.appStatus, core: coreStatus }
          : null,
        coreLoading: false,
      }))
      await get().fetchPortMappings()
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        coreLoading: false,
      })
    }
  },

  stopCore: async () => {
    set({ coreLoading: true, error: null })
    try {
      await api.stopCore()
      const coreStatus = await api.getCoreStatus()
      set((state) => ({
        coreStatus,
        appStatus: state.appStatus
          ? { ...state.appStatus, core: coreStatus }
          : null,
        coreLoading: false,
      }))
      await get().fetchPortMappings()
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        coreLoading: false,
      })
    }
  },

  restartCore: async () => {
    set({ coreLoading: true, error: null })
    try {
      const coreStatus = await api.restartCore()
      set((state) => ({
        coreStatus,
        appStatus: state.appStatus
          ? { ...state.appStatus, core: coreStatus }
          : null,
        coreLoading: false,
      }))
      await get().fetchPortMappings()
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        coreLoading: false,
      })
    }
  },

  fetchConfig: async () => {
    try {
      const config = await api.getConfig()
      if (typeof window !== 'undefined' && config.theme) {
        try {
          localStorage.setItem('app_theme', config.theme)
        } catch {
          // ignore storage errors
        }
      }
      set({ config })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  saveConfig: async (config) => {
    try {
      await api.saveConfig(config)
      if (typeof window !== 'undefined' && config.theme) {
        try {
          localStorage.setItem('app_theme', config.theme)
        } catch {
          // ignore storage errors
        }
      }
      set({ config })
      await get().fetchStatus()
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  },

  setSystemProxy: async (enabled: boolean, port?: number | null) => {
    try {
      const status = await api.setSystemProxy(enabled, port)
      const currentConfig = get().config
      if (currentConfig) {
        set({
          config: {
            ...currentConfig,
            systemProxyEnabled: status.enabled,
            systemProxyPort: status.port ?? null,
            tunEnabled: enabled ? false : currentConfig.tunEnabled,
            tunPort: enabled ? null : currentConfig.tunPort,
          },
        })
      }
      if (enabled) {
        const tunStatus = await api.getTunStatus()
        set({ tunStatus })
      }
      await get().fetchConfig()
      await get().fetchStatus()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set({ error: msg })
      throw err
    }
  },

  fetchTunStatus: async () => {
    try {
      set({ tunStatus: await api.getTunStatus() })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  setTun: async (enabled: boolean, port?: number | null) => {
    try {
      const status = await api.setTun(enabled, port)
      set({ tunStatus: status })
      await get().fetchConfig()
      await get().fetchStatus()
      return status
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set({ error: msg })
      throw err
    }
  },

  restartAsAdmin: async () => {
    try {
      await api.restartAsAdmin()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set({ error: msg })
      throw err
    }
  },
}))
