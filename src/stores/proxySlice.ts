import type { StateCreator } from 'zustand'
import * as api from '../services/tauri'
import type {
  LatencyProgressPayload,
  LatencyUpdatePayload,
  NodeLatencyResult,
  PortMapping,
} from '../types'

export interface ProxySlice {
  latencies: Record<string, number | null>
  testingNodeNames: Record<string, boolean>
  isTestingAll: boolean
  quickBindTarget: { profileId: string; nodeName: string } | null
  isAddPortModalOpen: boolean
  proxyError: string | null

  fetchLatencies: () => Promise<void>
  testNodeDelay: (
    nodeName: string,
    testUrl?: string,
    timeoutMs?: number,
  ) => Promise<number | null>
  testAllNodesDelay: (
    nodeNames: string[],
    testUrl?: string,
    timeoutMs?: number,
  ) => Promise<NodeLatencyResult[]>
  cancelLatencyTest: () => Promise<void>
  clearLatencies: () => Promise<void>
  handleLatencyUpdate: (payload: LatencyUpdatePayload) => void
  handleLatencyProgress: (payload: LatencyProgressPayload) => void
  setQuickBindTarget: (
    target: { profileId: string; nodeName: string } | null,
  ) => void
  setIsAddPortModalOpen: (open: boolean) => void
  setProxyError: (error: string | null) => void
}

export const createProxySlice: StateCreator<ProxySlice, [], [], ProxySlice> = (
  set,
  get,
) => ({
  latencies: {},
  testingNodeNames: {},
  isTestingAll: false,
  quickBindTarget: null,
  isAddPortModalOpen: false,
  proxyError: null,

  fetchLatencies: async () => {
    try {
      const cache = await api.getLatencyCache()
      set((state) => ({
        latencies: { ...state.latencies, ...cache },
      }))
    } catch {
      // ignore
    }
  },

  testNodeDelay: async (nodeName, testUrl, timeoutMs) => {
    set((state) => ({
      testingNodeNames: { ...state.testingNodeNames, [nodeName]: true },
      proxyError: null,
    }))

    try {
      const latency = await api.testNodeDelay(
        nodeName,
        testUrl,
        timeoutMs || 5000,
      )
      set((state) => {
        const nextTesting = { ...state.testingNodeNames }
        delete nextTesting[nodeName]
        return {
          latencies: { ...state.latencies, [nodeName]: latency },
          testingNodeNames: nextTesting,
        }
      })
      return latency
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      set((state) => {
        const nextTesting = { ...state.testingNodeNames }
        delete nextTesting[nodeName]
        return {
          latencies: { ...state.latencies, [nodeName]: null },
          testingNodeNames: nextTesting,
          proxyError: errMsg.includes('未运行') ? errMsg : state.proxyError,
        }
      })
      return null
    }
  },

  testAllNodesDelay: async (nodeNames, testUrl, timeoutMs) => {
    if (nodeNames.length === 0) return []

    const testingMap: Record<string, boolean> = {}
    for (const name of nodeNames) {
      testingMap[name] = true
    }

    set({
      isTestingAll: true,
      testingNodeNames: { ...get().testingNodeNames, ...testingMap },
      proxyError: null,
    })

    try {
      const results = await api.testNodesDelayBatch(
        nodeNames,
        testUrl,
        timeoutMs || 5000,
      )
      set({ isTestingAll: false })
      return results
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      set({
        isTestingAll: false,
        proxyError: errMsg.includes('未运行') ? errMsg : get().proxyError,
      })
      return []
    }
  },

  cancelLatencyTest: async () => {
    try {
      await api.cancelLatencyProbe()
    } catch {
      // ignore
    }
    set({
      isTestingAll: false,
      testingNodeNames: {},
    })
  },

  clearLatencies: async () => {
    try {
      await api.clearLatencyCache()
    } catch {
      // ignore
    }
    set({ latencies: {}, proxyError: null })
  },

  handleLatencyUpdate: (payload: LatencyUpdatePayload) => {
    set((state) => {
      const nextLatencies = {
        ...state.latencies,
        [payload.name]: payload.latency,
      }
      if (payload.runtimeName) {
        nextLatencies[payload.runtimeName] = payload.latency
      }

      const nextTestingNodes = { ...state.testingNodeNames }
      delete nextTestingNodes[payload.name]
      if (payload.runtimeName) {
        delete nextTestingNodes[payload.runtimeName]
      }

      const rootState = state as unknown as {
        portMappings?: PortMapping[]
        testingPortIds?: Record<string, boolean>
      }

      let nextPortMappings = rootState.portMappings
      if (nextPortMappings) {
        nextPortMappings = nextPortMappings.map((p) => {
          if (payload.mappingId && p.id === payload.mappingId) {
            return { ...p, latency: payload.latency }
          }
          if (
            p.nodeName === payload.name ||
            (payload.runtimeName && p.nodeName === payload.runtimeName)
          ) {
            return { ...p, latency: payload.latency }
          }
          return p
        })
      }

      const nextTestingPorts = { ...rootState.testingPortIds }
      if (payload.mappingId && nextTestingPorts) {
        delete nextTestingPorts[payload.mappingId]
      }

      return {
        latencies: nextLatencies,
        testingNodeNames: nextTestingNodes,
        ...(nextPortMappings ? { portMappings: nextPortMappings } : {}),
        ...(rootState.testingPortIds
          ? { testingPortIds: nextTestingPorts }
          : {}),
      }
    })
  },

  handleLatencyProgress: (payload: LatencyProgressPayload) => {
    set((state) => {
      if (!payload.isTesting) {
        const rootState = state as unknown as {
          isTestingAllPorts?: boolean
          testingPortIds?: Record<string, boolean>
        }
        return {
          isTestingAll: false,
          testingNodeNames: {},
          ...(rootState.isTestingAllPorts !== undefined
            ? { isTestingAllPorts: false }
            : {}),
          ...(rootState.testingPortIds !== undefined
            ? { testingPortIds: {} }
            : {}),
        }
      }
      return {
        isTestingAll: state.isTestingAll || payload.isTesting,
      }
    })
  },

  setQuickBindTarget: (quickBindTarget) => set({ quickBindTarget }),
  setIsAddPortModalOpen: (isAddPortModalOpen) => set({ isAddPortModalOpen }),
  setProxyError: (proxyError) => set({ proxyError }),
})
