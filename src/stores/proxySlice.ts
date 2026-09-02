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

function loadStoredLatencies(): Record<string, number | null> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem('node_latencies_cache')
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function persistLatencies(latencies: Record<string, number | null>) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem('node_latencies_cache', JSON.stringify(latencies))
  } catch {
    // ignore storage errors
  }
}

export const createProxySlice: StateCreator<ProxySlice, [], [], ProxySlice> = (
  set,
  get,
) => ({
  latencies: loadStoredLatencies(),
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
      const latency = await api.testNodeDelay(
        nodeName,
        testUrl,
        timeoutMs || 5000,
      )
      const nextLatencies = { ...get().latencies, [nodeName]: latency }
      persistLatencies(nextLatencies)
      set((state) => ({
        latencies: nextLatencies,
        testingNodeNames: { ...state.testingNodeNames, [nodeName]: false },
      }))
      return latency
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      const nextLatencies = { ...get().latencies, [nodeName]: null }
      persistLatencies(nextLatencies)
      set((state) => ({
        latencies: nextLatencies,
        testingNodeNames: { ...state.testingNodeNames, [nodeName]: false },
        proxyError: errMsg.includes('未运行') ? errMsg : state.proxyError,
      }))
      return null
    }
  },

  testAllNodesDelay: async (nodeNames, testUrl, timeoutMs) => {
    if (nodeNames.length === 0) return []

    // Mark all target nodes as testing
    const testingMap: Record<string, boolean> = {}
    for (const name of nodeNames) {
      testingMap[name] = true
    }

    set({
      isTestingAll: true,
      testingNodeNames: { ...get().testingNodeNames, ...testingMap },
      proxyError: null,
    })

    const concurrency = Math.min(6, nodeNames.length)
    let nextIndex = 0
    const results: NodeLatencyResult[] = []

    const worker = async () => {
      while (nextIndex < nodeNames.length) {
        const currentIndex = nextIndex++
        const nodeName = nodeNames[currentIndex]
        if (!nodeName) break

        try {
          if (currentIndex > 0) {
            await new Promise((r) => setTimeout(r, (currentIndex % 6) * 20))
          }

          const latency = await api.testNodeDelay(
            nodeName,
            testUrl,
            timeoutMs || 5000,
          )
          results.push({ name: nodeName, latency })

          // Real-time per-node streaming update
          const nextLatencies = { ...get().latencies, [nodeName]: latency }
          persistLatencies(nextLatencies)
          set((state) => ({
            latencies: nextLatencies,
            testingNodeNames: { ...state.testingNodeNames, [nodeName]: false },
          }))
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          results.push({ name: nodeName, error: errMsg })

          const nextLatencies = { ...get().latencies, [nodeName]: null }
          persistLatencies(nextLatencies)
          set((state) => ({
            latencies: nextLatencies,
            testingNodeNames: { ...state.testingNodeNames, [nodeName]: false },
            proxyError: errMsg.includes('未运行') ? errMsg : state.proxyError,
          }))
        }
      }
    }

    const workers = Array.from({ length: concurrency }, () => worker())
    await Promise.all(workers)

    set({ isTestingAll: false })
    return results
  },

  clearLatencies: () => {
    persistLatencies({})
    set({ latencies: {}, proxyError: null })
  },

  setQuickBindTarget: (quickBindTarget) => set({ quickBindTarget }),

  setIsAddPortModalOpen: (isAddPortModalOpen) => set({ isAddPortModalOpen }),

  setProxyError: (proxyError) => set({ proxyError }),
})
