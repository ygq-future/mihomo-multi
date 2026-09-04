import type { StateCreator } from 'zustand'
import * as api from '../services/tauri'
import type {
  NodeLatencyResult,
  PortDriftReport,
  PortFallbackStatus,
  PortMapping,
} from '../types'

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
        persistLatencies(currentLatencies)
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
    const fallbackNodeKey = mapping?.fallbackNodeName
      ? profile
        ? `[${profile.name}] ${mapping.fallbackNodeName}`
        : mapping.fallbackNodeName
      : null

    try {
      const [latency, fbLatency] = await Promise.all([
        api.testPortMappingDelay(id, testUrl, timeoutMs),
        fallbackNodeKey
          ? api
              .testNodeDelay(fallbackNodeKey, testUrl, timeoutMs)
              .catch(() => null)
          : Promise.resolve(null),
      ])

      const currentLatencies = storeState.latencies || {}
      const nextLatencies = { ...currentLatencies }
      if (nodeKey) nextLatencies[nodeKey] = latency
      if (fallbackNodeKey && fbLatency !== null)
        nextLatencies[fallbackNodeKey] = fbLatency
      persistLatencies(nextLatencies)

      set((state) => ({
        portMappings: state.portMappings.map((p) =>
          p.id === id ? { ...p, latency } : p,
        ),
        latencies: nextLatencies,
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
