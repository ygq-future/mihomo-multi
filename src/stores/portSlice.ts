import type { StateCreator } from 'zustand'
import * as api from '../services/tauri'
import type {
  NodeLatencyResult,
  PortDriftReport,
  PortFallbackStatus,
  PortMapping,
} from '../types'

export interface PortSlice {
  portMappings: PortMapping[]
  occupiedPorts: number[]
  driftReports: PortDriftReport[]
  fallbackStatuses: Record<string, PortFallbackStatus>
  portLoading: boolean
  testingPortIds: Record<string, boolean>
  isTestingAllPorts: boolean
  portError: string | null
  editingPortMapping: PortMapping | null
  isPortModalOpen: boolean

  fetchPortMappings: () => Promise<void>
  fetchFallbackStatuses: () => Promise<PortFallbackStatus[]>
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
  occupiedPorts: [],
  driftReports: [],
  fallbackStatuses: {},
  portLoading: false,
  testingPortIds: {},
  isTestingAllPorts: false,
  portError: null,
  editingPortMapping: null,
  isPortModalOpen: false,
  fetchPortMappings: async () => {
    set({ portLoading: true })
    try {
      const [portMappings, driftReports, occupiedPorts, fallbackList] =
        await Promise.all([
          api.getPortMappings(),
          api.getDriftReports(),
          api.getOccupiedPorts(),
          api.getPortFallbackStatuses().catch(() => []),
        ])
      const fallbackStatuses: Record<string, PortFallbackStatus> = {}
      for (const s of fallbackList) {
        fallbackStatuses[s.mappingId] = s
      }
      set({
        portMappings,
        driftReports,
        occupiedPorts,
        fallbackStatuses,
        portLoading: false,
        portError: null,
      })
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

  fetchFallbackStatuses: async () => {
    try {
      const fallbackList = await api.getPortFallbackStatuses()
      const fallbackStatuses: Record<string, PortFallbackStatus> = {}
      const storeState = get() as unknown as {
        profiles?: Array<{ id: string; name: string }>
        latencies?: Record<string, number | null>
        portMappings?: PortMapping[]
      }
      const currentLatencies = { ...(storeState.latencies || {}) }
      let updatedLatencies = false

      for (const s of fallbackList) {
        fallbackStatuses[s.mappingId] = s
        const mapping = storeState.portMappings?.find(
          (m) => m.id === s.mappingId,
        )
        const profile = mapping
          ? storeState.profiles?.find((p) => p.id === mapping.profileId)
          : null

        const mainKey = profile
          ? `[${profile.name}] ${s.primaryNode}`
          : s.primaryNode
        const fbKey = profile
          ? `[${profile.name}] ${s.fallbackNode}`
          : s.fallbackNode

        if (s.primaryLatency !== undefined && s.primaryLatency !== null) {
          currentLatencies[mainKey] = s.primaryLatency
          updatedLatencies = true
        } else if (s.isFallbackActive) {
          currentLatencies[mainKey] = null
          updatedLatencies = true
        }

        if (s.fallbackLatency !== undefined && s.fallbackLatency !== null) {
          currentLatencies[fbKey] = s.fallbackLatency
          updatedLatencies = true
        }
      }

      if (updatedLatencies) {
        set((state) => ({
          fallbackStatuses,
          latencies: currentLatencies,
          portMappings: state.portMappings.map((m) => {
            const fb = fallbackStatuses[m.id]
            if (
              fb &&
              (fb.primaryLatency !== undefined || fb.isFallbackActive)
            ) {
              return {
                ...m,
                latency: fb.isFallbackActive
                  ? null
                  : (fb.primaryLatency ?? m.latency),
              }
            }
            return m
          }),
        }))
      } else {
        set({ fallbackStatuses })
      }
      return fallbackList
    } catch {
      return []
    }
  },
  setDriftReports: (driftReports) => set({ driftReports }),

  savePortMapping: async (mapping) => {
    set({ portLoading: true, portError: null })
    try {
      const saved = await api.savePortMapping(mapping)
      const [driftReports, occupiedPorts, fallbackList] = await Promise.all([
        api.getDriftReports().catch(() => []),
        api.getOccupiedPorts().catch(() => []),
        api.getPortFallbackStatuses().catch(() => []),
      ])
      const fallbackStatuses: Record<string, PortFallbackStatus> = {}
      for (const s of fallbackList) {
        fallbackStatuses[s.mappingId] = s
      }
      set((state) => {
        const index = state.portMappings.findIndex((p) => p.id === saved.id)
        const updated =
          index >= 0
            ? state.portMappings.map((p) => (p.id === saved.id ? saved : p))
            : [...state.portMappings, saved]
        return {
          portMappings: updated,
          driftReports,
          occupiedPorts,
          fallbackStatuses,
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
      const [driftReports, occupiedPorts] = await Promise.all([
        api.getDriftReports().catch(() => []),
        api.getOccupiedPorts().catch(() => []),
      ])
      set((state) => ({
        portMappings: state.portMappings.filter((p) => p.id !== id),
        driftReports,
        occupiedPorts,
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
      const occupiedPorts = await api.getOccupiedPorts().catch(() => [])
      set((state) => ({
        portMappings: state.portMappings.map((p) =>
          p.id === id ? updated : p,
        ),
        occupiedPorts,
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

      const mapping = get().portMappings.find((m) => m.id === id)
      if (mapping?.fallbackNodeName) {
        get()
          .fetchFallbackStatuses()
          .catch(() => {})
      }

      return latency
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      set((state) => ({
        portMappings: state.portMappings.map((p) =>
          p.id === id ? { ...p, latency: null } : p,
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
      const results = await api.testAllPortMappingsDelay(testUrl, timeoutMs)
      set({ isTestingAllPorts: false })
      await get().fetchPortMappings()
      return results
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      set({
        isTestingAllPorts: false,
        portError: errMsg.includes('未运行') ? errMsg : get().portError,
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
