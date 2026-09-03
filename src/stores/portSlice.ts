import type { StateCreator } from 'zustand'
import * as api from '../services/tauri'
import type { NodeLatencyResult, PortDriftReport, PortMapping } from '../types'

function persistLatencies(latencies: Record<string, number | null>) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem('node_latencies_cache', JSON.stringify(latencies))
  } catch {
    // ignore storage errors
  }
}

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

    const mapping = get().portMappings.find((m) => m.id === id)
    const storeState = get() as unknown as {
      profiles?: Array<{ id: string; name: string }>
      latencies?: Record<string, number | null>
    }
    const profile = mapping
      ? storeState.profiles?.find((p) => p.id === mapping.profileId)
      : null
    const nodeKey = mapping
      ? profile
        ? `[${profile.name}] ${mapping.nodeName}`
        : mapping.nodeName
      : null

    try {
      const latency = await api.testPortMappingDelay(id, testUrl, timeoutMs)

      const currentLatencies = storeState.latencies || {}
      const nextLatencies = nodeKey
        ? { ...currentLatencies, [nodeKey]: latency }
        : currentLatencies
      if (nodeKey) persistLatencies(nextLatencies)

      set((state) => ({
        portMappings: state.portMappings.map((p) =>
          p.id === id ? { ...p, latency } : p,
        ),
        ...(nodeKey ? { latencies: nextLatencies } : {}),
        testingPortIds: { ...state.testingPortIds, [id]: false },
      }))
      return latency
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      const currentLatencies = storeState.latencies || {}
      const nextLatencies = nodeKey
        ? { ...currentLatencies, [nodeKey]: null }
        : currentLatencies
      if (nodeKey) persistLatencies(nextLatencies)

      set((state) => ({
        portMappings: state.portMappings.map((p) =>
          p.id === id ? { ...p, latency: null } : p,
        ),
        ...(nodeKey ? { latencies: nextLatencies } : {}),
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

    const concurrency = Math.min(6, mappings.length)
    let nextIndex = 0
    const results: NodeLatencyResult[] = []

    const worker = async () => {
      while (nextIndex < mappings.length) {
        const currentIndex = nextIndex++
        const mapping = mappings[currentIndex]
        if (!mapping) break

        try {
          if (currentIndex > 0) {
            await new Promise((r) => setTimeout(r, (currentIndex % 6) * 20))
          }

          const latency = await get().testPortDelay(
            mapping.id,
            testUrl,
            timeoutMs,
          )
          results.push({ name: mapping.nodeName, latency })
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          results.push({ name: mapping.nodeName, error: errMsg })
        }
      }
    }

    const workers = Array.from({ length: concurrency }, () => worker())
    await Promise.all(workers)

    set({ isTestingAllPorts: false })
    return results
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
