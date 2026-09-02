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
  loading: boolean
  error: string | null

  setActiveTab: (tab: TabType) => void
  toggleSidebar: () => void
  fetchStatus: () => Promise<void>
  startCore: () => Promise<void>
  stopCore: () => Promise<void>
  restartCore: () => Promise<void>
  fetchConfig: () => Promise<void>
  saveConfig: (config: AppConfig) => Promise<void>
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
  loading: false,
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
      set({
        appStatus,
        coreStatus: appStatus.core,
        error: null,
      })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  startCore: async () => {
    set({ loading: true, error: null })
    try {
      const coreStatus = await api.startCore()
      set((state) => ({
        coreStatus,
        appStatus: state.appStatus
          ? { ...state.appStatus, core: coreStatus }
          : null,
        loading: false,
      }))
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        loading: false,
      })
    }
  },

  stopCore: async () => {
    set({ loading: true, error: null })
    try {
      await api.stopCore()
      const coreStatus = await api.getCoreStatus()
      set((state) => ({
        coreStatus,
        appStatus: state.appStatus
          ? { ...state.appStatus, core: coreStatus }
          : null,
        loading: false,
      }))
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        loading: false,
      })
    }
  },

  restartCore: async () => {
    set({ loading: true, error: null })
    try {
      const coreStatus = await api.restartCore()
      set((state) => ({
        coreStatus,
        appStatus: state.appStatus
          ? { ...state.appStatus, core: coreStatus }
          : null,
        loading: false,
      }))
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        loading: false,
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
    set({ loading: true, error: null })
    try {
      await api.saveConfig(config)
      set({ config, loading: false })
      await get().fetchStatus()
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        loading: false,
      })
    }
  },
}))
