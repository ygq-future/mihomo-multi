import type { StateCreator } from 'zustand'
import * as api from '../services/tauri'
import type { NodeLatencyResult } from '../types'

export interface ProxySlice {
  latencies: Record<string, number | null>
  testingNodeNames: Record<string, boolean>
  isTestingAll: boolean
  quickBindTarget: { profileId: string; nodeName: string } | null
  isAddPortModalOpen: boolean
  proxyError: string | null

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
  clearLatencies: () => void
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

  testNodeDelay: async (nodeName, testUrl, timeoutMs) => {
    set((state) => ({
      testingNodeNames: { ...state.testingNodeNames, [nodeName]: true },
      proxyError: null,
    }))

    try {
      const latency = await api.testNodeDelay(nodeName, testUrl, timeoutMs)
      set((state) => ({
        latencies: { ...state.latencies, [nodeName]: latency },
        testingNodeNames: { ...state.testingNodeNames, [nodeName]: false },
      }))
      return latency
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      set((state) => ({
        latencies: { ...state.latencies, [nodeName]: null },
        testingNodeNames: { ...state.testingNodeNames, [nodeName]: false },
        proxyError: errMsg.includes('未运行') ? errMsg : state.proxyError,
      }))
      return null
    }
  },

  testAllNodesDelay: async (nodeNames, testUrl, timeoutMs) => {
    if (nodeNames.length === 0) return []

    // Mark all given nodes as testing
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
        timeoutMs,
      )
      const nextLatencies: Record<string, number | null> = {}
      const clearedTesting: Record<string, boolean> = {}

      for (const res of results) {
        nextLatencies[res.name] = res.latency ?? null
        clearedTesting[res.name] = false
      }

      set((state) => ({
        latencies: { ...state.latencies, ...nextLatencies },
        testingNodeNames: { ...state.testingNodeNames, ...clearedTesting },
        isTestingAll: false,
      }))

      return results
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      const fallbackLatencies: Record<string, number | null> = {}
      const clearedTesting: Record<string, boolean> = {}
      for (const name of nodeNames) {
        fallbackLatencies[name] = null
        clearedTesting[name] = false
      }

      set((state) => ({
        latencies: { ...state.latencies, ...fallbackLatencies },
        testingNodeNames: { ...state.testingNodeNames, ...clearedTesting },
        isTestingAll: false,
        proxyError: errMsg,
      }))
      return []
    }
  },

  clearLatencies: () => set({ latencies: {}, proxyError: null }),

  setQuickBindTarget: (quickBindTarget) => set({ quickBindTarget }),

  setIsAddPortModalOpen: (isAddPortModalOpen) => set({ isAddPortModalOpen }),

  setProxyError: (proxyError) => set({ proxyError }),
})
