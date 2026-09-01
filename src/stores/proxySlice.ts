import type { StateCreator } from 'zustand'
import * as api from '../services/tauri'
import type { NodeLatencyResult } from '../types'

export interface ProxySlice {
  latencies: Record<string, number | null>
  testingNodeNames: Record<string, boolean>
  isTestingAll: boolean
  quickBindTarget: { profileId: string; nodeName: string } | null
  isAddPortModalOpen: boolean

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

  testNodeDelay: async (nodeName, testUrl, timeoutMs) => {
    set((state) => ({
      testingNodeNames: { ...state.testingNodeNames, [nodeName]: true },
    }))

    try {
      const latency = await api.testNodeDelay(nodeName, testUrl, timeoutMs)
      set((state) => ({
        latencies: { ...state.latencies, [nodeName]: latency },
        testingNodeNames: { ...state.testingNodeNames, [nodeName]: false },
      }))
      return latency
    } catch {
      set((state) => ({
        latencies: { ...state.latencies, [nodeName]: null },
        testingNodeNames: { ...state.testingNodeNames, [nodeName]: false },
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
    } catch {
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
      }))
      return []
    }
  },

  clearLatencies: () => set({ latencies: {} }),

  setQuickBindTarget: (quickBindTarget) => set({ quickBindTarget }),

  setIsAddPortModalOpen: (isAddPortModalOpen) => set({ isAddPortModalOpen }),
})
