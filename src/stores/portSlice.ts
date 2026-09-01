import type { StateCreator } from 'zustand'
import * as api from '../services/tauri'
import type { NodeLatencyResult, PortDriftReport, PortMapping } from '../types'

export interface PortSlice {
  portMappings: PortMapping[]
  driftReports: PortDriftReport[]
  portLoading: boolean
  testingPortIds: Record<string, boolean>
  isTestingAllPorts: boolean
  portError: string | null
  editingPortMapping: PortMapping | null
  isPortModalOpen: boolean

  fetchPortMappings: () => Promise<void>
  fetchDriftReports: () => Promise<PortDriftReport[]>
  savePortMapping: (mapping: PortMapping) => Promise<PortMapping>
  deletePortMapping: (id: string) => Promise<void>
  togglePortMapping: (id: string, enabled: boolean) => Promise<PortMapping>
  testPortDelay: (
    id: string,
    testUrl?: string,
    timeoutMs?: number,
  ) => Promise<number | null>
  testAllPortsDelay: (
    testUrl?: string,
    timeoutMs?: number,
  ) => Promise<NodeLatencyResult[]>
  setEditingPortMapping: (mapping: PortMapping | null) => void
  setIsPortModalOpen: (open: boolean) => void
  setPortError: (error: string | null) => void
  setDriftReports: (reports: PortDriftReport[]) => void
}

export const createPortSlice: StateCreator<PortSlice, [], [], PortSlice> = (
  set,
  get,
) => ({
  portMappings: [],
  driftReports: [],
  portLoading: false,
  testingPortIds: {},
  isTestingAllPorts: false,
  portError: null,
  editingPortMapping: null,
  isPortModalOpen: false,

  fetchPortMappings: async () => {
    set({ portLoading: true })
    try {
      const [portMappings, driftReports] = await Promise.all([
        api.getPortMappings(),
        api.getDriftReports(),
      ])
      set({ portMappings, driftReports, portLoading: false, portError: null })
    } catch (err) {
      set({
        portLoading: false,
        portError: err instanceof Error ? err.message : String(err),
      })
    }
  },

  fetchDriftReports: async () => {
    try {
      const driftReports = await api.getDriftReports()
      set({ driftReports })
      return driftReports
    } catch {
      return []
    }
  },

  setDriftReports: (driftReports) => set({ driftReports }),

  savePortMapping: async (mapping) => {
    set({ portLoading: true, portError: null })
    try {
      const saved = await api.savePortMapping(mapping)
      const driftReports = await api.getDriftReports().catch(() => [])
      set((state) => {
        const index = state.portMappings.findIndex((p) => p.id === saved.id)
        const updated =
          index >= 0
            ? state.portMappings.map((p) => (p.id === saved.id ? saved : p))
            : [...state.portMappings, saved]
        return {
          portMappings: updated,
          driftReports,
          portLoading: false,
          isPortModalOpen: false,
          editingPortMapping: null,
        }
      })
      return saved
    } catch (err) {
      set({
        portLoading: false,
        portError: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  },

  deletePortMapping: async (id) => {
    set({ portLoading: true, portError: null })
    try {
      await api.deletePortMapping(id)
      const driftReports = await api.getDriftReports().catch(() => [])
      set((state) => ({
        portMappings: state.portMappings.filter((p) => p.id !== id),
        driftReports,
        portLoading: false,
      }))
    } catch (err) {
      set({
        portLoading: false,
        portError: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  },

  togglePortMapping: async (id, enabled) => {
    set((state) => ({
      testingPortIds: { ...state.testingPortIds, [id]: true },
      portError: null,
    }))
    try {
      const updated = await api.togglePortMapping(id, enabled)
      set((state) => ({
        portMappings: state.portMappings.map((p) =>
          p.id === id ? updated : p,
        ),
        testingPortIds: { ...state.testingPortIds, [id]: false },
      }))
      return updated
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      set((state) => ({
        testingPortIds: { ...state.testingPortIds, [id]: false },
        portError: errMsg,
      }))
      throw err
    }
  },

  testPortDelay: async (id, testUrl, timeoutMs) => {
    set((state) => ({
      testingPortIds: { ...state.testingPortIds, [id]: true },
      portError: null,
    }))
    try {
      const latency = await api.testPortMappingDelay(id, testUrl, timeoutMs)
      set((state) => ({
        portMappings: state.portMappings.map((p) =>
          p.id === id ? { ...p, latency } : p,
        ),
        testingPortIds: { ...state.testingPortIds, [id]: false },
      }))
      return latency
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      set((state) => ({
        portMappings: state.portMappings.map((p) =>
          p.id === id ? { ...p, latency: undefined } : p,
        ),
        testingPortIds: { ...state.testingPortIds, [id]: false },
        portError: errMsg.includes('未运行') ? errMsg : state.portError,
      }))
      return null
    }
  },

  testAllPortsDelay: async (testUrl, timeoutMs) => {
    const mappings = get().portMappings.filter((m) => m.enabled)
    if (mappings.length === 0) return []

    const testingMap: Record<string, boolean> = {}
    for (const m of mappings) {
      testingMap[m.id] = true
    }

    set({
      isTestingAllPorts: true,
      testingPortIds: { ...get().testingPortIds, ...testingMap },
      portError: null,
    })

    try {
      const results = await api.testAllPortMappingsDelay(
        testUrl,
        timeoutMs,
        Math.min(6, mappings.length),
      )

      // Refresh mappings to get the updated latencies
      const updatedMappings = await api.getPortMappings()
      set({
        portMappings: updatedMappings,
        isTestingAllPorts: false,
        testingPortIds: {},
      })
      return results
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      set({
        isTestingAllPorts: false,
        testingPortIds: {},
        portError: errMsg.includes('未运行') ? errMsg : null,
      })
      return []
    }
  },

  setEditingPortMapping: (editingPortMapping) =>
    set({
      editingPortMapping,
      isPortModalOpen: Boolean(editingPortMapping),
    }),

  setIsPortModalOpen: (isPortModalOpen) =>
    set({
      isPortModalOpen,
      editingPortMapping: isPortModalOpen ? get().editingPortMapping : null,
    }),

  setPortError: (portError) => set({ portError }),
})
