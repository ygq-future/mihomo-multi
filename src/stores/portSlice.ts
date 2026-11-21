import type { StateCreator } from 'zustand'
import * as api from '../services/tauri'
import type {
  NodeLatencyResult,
  PortDriftReport,
  PortFallbackStatus,
  PortMapping,
} from '../types'
import type { ProxySlice } from './proxySlice'
let fetchPortMappingsSeq = 0

export interface PortSlice {
  portMappings: PortMapping[]
  occupiedPorts: number[]
  driftReports: PortDriftReport[]
  fallbackStatuses: Record<string, PortFallbackStatus>
  portLoading: boolean
  portInitialized: boolean
  testingPortIds: Record<string, boolean>
  testingFbPortIds: Record<string, boolean>
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
  toggleManualFallback: (
    id: string,
    manualFallback: boolean,
  ) => Promise<PortMapping>
  swapPortFallback: (id: string) => Promise<PortMapping>
  swapPortMappingPorts: (
    firstId: string,
    secondId: string,
  ) => Promise<PortMapping[]>
  testPortDelay: (
    id: string,
    testUrl?: string,
    timeoutMs?: number,
  ) => Promise<number | null>
  testPortFallbackDelay: (
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

export const createPortSlice: StateCreator<
  PortSlice & Pick<ProxySlice, 'portEgressIps'>,
  [],
  [],
  PortSlice
> = (set, get) => ({
  portMappings: [],
  occupiedPorts: [],
  driftReports: [],
  fallbackStatuses: {},
  portLoading: false,
  portInitialized: false,
  testingPortIds: {},
  testingFbPortIds: {},
  isTestingAllPorts: false,
  portError: null,
  editingPortMapping: null,
  isPortModalOpen: false,
  fetchPortMappings: async () => {
    const seq = ++fetchPortMappingsSeq
    set({ portLoading: true })
    const driftPromise = api.getDriftReports()
    const fallbackPromise = api.getPortFallbackStatuses()
    try {
      const [portMappings, occupiedPorts] = await Promise.all([
        api.getPortMappings(),
        api.getOccupiedPorts(),
      ])
      if (seq !== fetchPortMappingsSeq) {
        driftPromise.catch(() => {})
        fallbackPromise.catch(() => {})
        return
      }
      set({
        portMappings,
        portEgressIps: {},
        occupiedPorts,
        portLoading: false,
        portInitialized: true,
        portError: null,
      })

      void driftPromise
        .then((driftReports) => {
          if (seq === fetchPortMappingsSeq) {
            set({ driftReports })
          }
        })
        .catch(() => {})

      void fallbackPromise
        .then((fallbackList) => {
          if (seq !== fetchPortMappingsSeq) return
          const fallbackStatuses: Record<string, PortFallbackStatus> = {}
          for (const s of fallbackList) {
            fallbackStatuses[s.mappingId] = s
          }
          set({ fallbackStatuses })
        })
        .catch(() => {})
    } catch (err) {
      driftPromise.catch(() => {})
      fallbackPromise.catch(() => {})
      if (seq !== fetchPortMappingsSeq) return
      set({
        portLoading: false,
        portInitialized: true,
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
      const updateLatency = (key: string, latency: number | null) => {
        if (currentLatencies[key] !== latency) {
          currentLatencies[key] = latency
          updatedLatencies = true
        }
      }

      for (const s of fallbackList) {
        fallbackStatuses[s.mappingId] = s
        const mapping = storeState.portMappings?.find(
          (m) => m.id === s.mappingId,
        )
        const profile = mapping
          ? storeState.profiles?.find((p) => p.id === mapping.profileId)
          : null
        const fbProfile = mapping
          ? storeState.profiles?.find(
              (p) => p.id === (mapping.fallbackProfileId || mapping.profileId),
            )
          : null

        const mainKey = profile
          ? `[${profile.name}] ${s.primaryNode}`
          : s.primaryNode
        const fbKey = fbProfile
          ? `[${fbProfile.name}] ${s.fallbackNode}`
          : s.fallbackNode

        if (s.primaryLatency !== undefined) {
          updateLatency(mainKey, s.primaryLatency)
        } else if (s.isFallbackActive && !s.manualFallback) {
          updateLatency(mainKey, null)
        }

        if (s.fallbackLatency !== undefined) {
          updateLatency(fbKey, s.fallbackLatency)
        }
      }

      set((state) => {
        let updatedMappings = false
        const portMappings = state.portMappings.map((mapping) => {
          const fallback = fallbackStatuses[mapping.id]
          if (!fallback) return mapping
          const latency =
            fallback.primaryLatency !== undefined
              ? fallback.primaryLatency
              : fallback.isFallbackActive && !fallback.manualFallback
                ? null
                : mapping.latency
          if (mapping.latency === latency) return mapping
          updatedMappings = true
          return { ...mapping, latency }
        })

        const prevKeys = Object.keys(state.fallbackStatuses)
        const nextKeys = Object.keys(fallbackStatuses)
        const fallbackChanged =
          prevKeys.length !== nextKeys.length ||
          nextKeys.some((key) => {
            const prev = state.fallbackStatuses[key]
            const next = fallbackStatuses[key]
            return (
              !prev ||
              prev.isFallbackActive !== next.isFallbackActive ||
              prev.manualFallback !== next.manualFallback ||
              prev.primaryLatency !== next.primaryLatency ||
              prev.fallbackLatency !== next.fallbackLatency ||
              prev.primaryNode !== next.primaryNode ||
              prev.fallbackNode !== next.fallbackNode
            )
          })

        if (!fallbackChanged && !updatedLatencies && !updatedMappings) {
          return state
        }

        return {
          ...(fallbackChanged ? { fallbackStatuses } : {}),
          ...(updatedLatencies ? { latencies: currentLatencies } : {}),
          ...(updatedMappings ? { portMappings } : {}),
        }
      })
      return fallbackList
    } catch {
      return []
    }
  },
  setDriftReports: (driftReports) => set({ driftReports }),

  savePortMapping: async (mapping) => {
    fetchPortMappingsSeq += 1
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
          portEgressIps: {},
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
    fetchPortMappingsSeq += 1
    set({ portLoading: true, portError: null })
    const targetPort = get().portMappings.find((p) => p.id === id)?.port
    try {
      await api.deletePortMapping(id)
      const [driftReports, occupiedPorts] = await Promise.all([
        api.getDriftReports().catch(() => []),
        api.getOccupiedPorts().catch(() => []),
      ])
      const storeState = get() as unknown as {
        config?: { systemProxyPort?: number | null; tunPort?: number | null }
        fetchConfig?: () => Promise<void>
        fetchTunStatus?: () => Promise<void>
      }
      if (
        targetPort !== undefined &&
        (targetPort === storeState.config?.systemProxyPort ||
          targetPort === storeState.config?.tunPort)
      ) {
        storeState.fetchConfig?.().catch(() => {})
        storeState.fetchTunStatus?.().catch(() => {})
      }
      set((state) => ({
        portMappings: state.portMappings.filter((p) => p.id !== id),
        portEgressIps: {},
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
      if (!enabled) {
        const targetPort = updated.port
        const storeState = get() as unknown as {
          config?: { systemProxyPort?: number | null; tunPort?: number | null }
          fetchConfig?: () => Promise<void>
          fetchTunStatus?: () => Promise<void>
        }
        if (
          targetPort === storeState.config?.systemProxyPort ||
          targetPort === storeState.config?.tunPort
        ) {
          storeState.fetchConfig?.().catch(() => {})
          storeState.fetchTunStatus?.().catch(() => {})
        }
      }
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
  toggleManualFallback: async (id, manualFallback) => {
    // Immediate optimistic update to eliminate intermediate states and race conditions
    set((state) => ({
      portMappings: state.portMappings.map((p) =>
        p.id === id ? { ...p, manualFallback } : p,
      ),
      fallbackStatuses: state.fallbackStatuses[id]
        ? {
            ...state.fallbackStatuses,
            [id]: {
              ...state.fallbackStatuses[id],
              manualFallback,
              isFallbackActive: manualFallback,
            },
          }
        : state.fallbackStatuses,
    }))

    try {
      const updated = await api.toggleManualFallback(id, manualFallback)
      set((state) => ({
        portMappings: state.portMappings.map((p) =>
          p.id === id ? updated : p,
        ),
      }))
      get()
        .fetchFallbackStatuses()
        .catch(() => {})
      return updated
    } catch (err) {
      // Rollback optimistic update on error
      set((state) => ({
        portMappings: state.portMappings.map((p) =>
          p.id === id ? { ...p, manualFallback: !manualFallback } : p,
        ),
        fallbackStatuses: state.fallbackStatuses[id]
          ? {
              ...state.fallbackStatuses,
              [id]: {
                ...state.fallbackStatuses[id],
                manualFallback: !manualFallback,
              },
            }
          : state.fallbackStatuses,
      }))
      const errMsg = err instanceof Error ? err.message : String(err)
      set({ portError: errMsg })
      throw err
    }
  },

  swapPortFallback: async (id) => {
    const previousMappings = get().portMappings
    const previousFallbackStatuses = get().fallbackStatuses
    const target = previousMappings.find((p) => p.id === id)

    if (target?.fallbackNodeName) {
      const storeState = get() as unknown as {
        profiles?: Array<{ id: string; name: string }>
        latencies?: Record<string, number | null>
      }
      const oldProfileId = target.profileId
      const oldNodeName = target.nodeName
      const newProfileId = target.fallbackProfileId?.trim() || oldProfileId
      const newNodeName = target.fallbackNodeName

      const newProfile = storeState.profiles?.find((p) => p.id === newProfileId)
      const newRuntimeKey = newProfile
        ? `[${newProfile.name}] ${newNodeName}`
        : newNodeName
      const cachedNewLatency =
        storeState.latencies && newRuntimeKey in storeState.latencies
          ? storeState.latencies[newRuntimeKey]
          : storeState.latencies && newNodeName in storeState.latencies
            ? storeState.latencies[newNodeName]
            : previousFallbackStatuses[id]?.fallbackLatency

      const optimisticMapping: PortMapping = {
        ...target,
        profileId: newProfileId,
        nodeName: newNodeName,
        fallbackProfileId: oldProfileId,
        fallbackNodeName: oldNodeName,
        manualFallback: false,
        latency: cachedNewLatency ?? null,
      }

      const existingFb = previousFallbackStatuses[id]
      const nextFallbackStatuses = existingFb
        ? {
            ...previousFallbackStatuses,
            [id]: {
              ...existingFb,
              primaryNode: newNodeName,
              fallbackNode: oldNodeName,
              activeNode: newNodeName,
              isFallbackActive: false,
              manualFallback: false,
              primaryLatency: existingFb.fallbackLatency,
              fallbackLatency: existingFb.primaryLatency,
            },
          }
        : previousFallbackStatuses

      set({
        portMappings: previousMappings.map((p) =>
          p.id === id ? optimisticMapping : p,
        ),
        fallbackStatuses: nextFallbackStatuses,
        portError: null,
      })
    }

    try {
      const updated = await api.swapPortFallback(id)
      set((state) => ({
        portMappings: state.portMappings.map((p) =>
          p.id === id ? updated : p,
        ),
        portEgressIps: {},
      }))
      get()
        .fetchFallbackStatuses()
        .catch(() => {})
      get()
        .fetchDriftReports()
        .catch(() => {})
      return updated
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      set({
        portMappings: previousMappings,
        fallbackStatuses: previousFallbackStatuses,
        portError: errMsg,
      })
      throw err
    }
  },

  swapPortMappingPorts: async (firstId, secondId) => {
    set({ portError: null })
    try {
      const updated = await api.swapPortMappingPorts(firstId, secondId)
      const [occupiedPorts, driftReports] = await Promise.all([
        api.getOccupiedPorts().catch(() => []),
        api.getDriftReports().catch(() => []),
      ])
      set({
        portMappings: updated,
        portEgressIps: {},
        occupiedPorts,
        driftReports,
        portError: null,
      })
      get()
        .fetchFallbackStatuses()
        .catch(() => {})
      return updated
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      set({ portError: errMsg })
      throw err
    }
  },

  testPortFallbackDelay: async (id, testUrl, timeoutMs) => {
    set((state) => ({
      testingFbPortIds: { ...state.testingFbPortIds, [id]: true },
      portError: null,
    }))

    try {
      const latency = await api.testPortFallbackDelay(id, testUrl, timeoutMs)
      set((state) => ({
        testingFbPortIds: { ...state.testingFbPortIds, [id]: false },
      }))

      get()
        .fetchFallbackStatuses()
        .catch(() => {})

      return latency
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      set((state) => ({
        testingFbPortIds: { ...state.testingFbPortIds, [id]: false },
        portError: api.isCoreNotRunningError(err) ? errMsg : state.portError,
      }))
      get()
        .fetchFallbackStatuses()
        .catch(() => {})
      return null
    }
  },

  testPortDelay: async (id, testUrl, timeoutMs) => {
    const mapping = get().portMappings.find((m) => m.id === id)
    const hasFb = Boolean(mapping?.fallbackNodeName)
    set((state) => ({
      testingPortIds: { ...state.testingPortIds, [id]: true },
      testingFbPortIds: hasFb
        ? { ...state.testingFbPortIds, [id]: true }
        : state.testingFbPortIds,
      portError: null,
    }))

    try {
      const latency = await api.testPortMappingDelay(id, testUrl, timeoutMs)
      set((state) => ({
        portMappings: state.portMappings.map((p) =>
          p.id === id ? { ...p, latency } : p,
        ),
        testingPortIds: { ...state.testingPortIds, [id]: false },
        testingFbPortIds: { ...state.testingFbPortIds, [id]: false },
      }))

      if (hasFb) {
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
        testingFbPortIds: { ...state.testingFbPortIds, [id]: false },
        portError: api.isCoreNotRunningError(err) ? errMsg : state.portError,
      }))
      if (hasFb) {
        get()
          .fetchFallbackStatuses()
          .catch(() => {})
      }
      return null
    }
  },

  testAllPortsDelay: async (testUrl, timeoutMs) => {
    const mappings = get().portMappings.filter((m) => m.enabled)
    if (mappings.length === 0) return []

    const testingMap: Record<string, boolean> = {}
    const testingFbMap: Record<string, boolean> = {}
    for (const m of mappings) {
      testingMap[m.id] = true
      if (m.fallbackNodeName) {
        testingFbMap[m.id] = true
      }
    }

    set({
      isTestingAllPorts: true,
      testingPortIds: { ...get().testingPortIds, ...testingMap },
      testingFbPortIds: { ...get().testingFbPortIds, ...testingFbMap },
      portError: null,
    })

    try {
      const results = await api.testAllPortMappingsDelay(testUrl, timeoutMs)
      const cleanTestingMap: Record<string, boolean> = {}
      const cleanTestingFbMap: Record<string, boolean> = {}
      for (const m of mappings) {
        cleanTestingMap[m.id] = false
        cleanTestingFbMap[m.id] = false
      }
      set((state) => ({
        isTestingAllPorts: false,
        testingPortIds: { ...state.testingPortIds, ...cleanTestingMap },
        testingFbPortIds: { ...state.testingFbPortIds, ...cleanTestingFbMap },
      }))
      await Promise.all([
        get()
          .fetchPortMappings()
          .catch(() => {}),
        get()
          .fetchFallbackStatuses()
          .catch(() => {}),
      ])
      return results
    } catch (err) {
      const cleanTestingMap: Record<string, boolean> = {}
      const cleanTestingFbMap: Record<string, boolean> = {}
      for (const m of mappings) {
        cleanTestingMap[m.id] = false
        cleanTestingFbMap[m.id] = false
      }
      const errMsg = err instanceof Error ? err.message : String(err)
      set((state) => ({
        isTestingAllPorts: false,
        testingPortIds: { ...state.testingPortIds, ...cleanTestingMap },
        testingFbPortIds: { ...state.testingFbPortIds, ...cleanTestingFbMap },
        portError: api.isCoreNotRunningError(err) ? errMsg : state.portError,
      }))
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
