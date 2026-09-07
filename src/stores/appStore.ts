import { create } from 'zustand'
import * as api from '../services/tauri'
import type { AppConfig, AppStatus, CoreStatus } from '../types'
import { type PortSlice, createPortSlice } from './portSlice'
import { type ProfileSlice, createProfileSlice } from './profileSlice'
import { type ProxySlice, createProxySlice } from './proxySlice'

export type TabType = 'ports' | 'proxies' | 'profiles' | 'settings'

export interface BaseAppState {
  activeTab: TabType
  sidebarCollapsed: boolean
  appStatus: AppStatus | null
  coreStatus: CoreStatus | null
  config: AppConfig | null
  coreLoading: boolean
  error: string | null

  setActiveTab: (tab: TabType) => void
  toggleSidebar: () => void
  fetchStatus: () => Promise<void>
  startCore: () => Promise<void>
  stopCore: () => Promise<void>
  restartCore: () => Promise<void>
  fetchConfig: () => Promise<void>
  saveConfig: (config: AppConfig) => Promise<void>
  setSystemProxy: (enabled: boolean, port?: number | null) => Promise<void>
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
  error: null,

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
    try {
      const appStatus = await api.getAppStatus()
      const core = appStatus.core
      set({
        appStatus,
        coreStatus: core,
        error: core.running ? null : (core.lastError ?? null),
      })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
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
      set({ config })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  saveConfig: async (config) => {
    try {
      await api.saveConfig(config)
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
          },
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set({ error: msg })
      throw err
    }
  },
}))
