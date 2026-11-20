import type { StateCreator } from 'zustand'
import * as api from '../services/tauri'
import type {
  AppConfig,
  DirectEgressInfo,
  InboundProtocol,
  LatencyProgressPayload,
  LatencyUpdatePayload,
  NodeLatencyResult,
  PortMapping,
} from '../types'
import { DEFAULT_TIMEOUT_MS } from '../constants'
import { t } from '../i18n'

export interface ProxySlice {
  latencies: Record<string, number | null>
  testingNodeNames: Record<string, boolean>
  nodeEgressIps: Record<string, DirectEgressInfo>
  probingEgressNodeKeys: Record<string, boolean>
  portEgressIps: Record<number, DirectEgressInfo>
  probingPortEgress: Record<number, boolean>
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
  probeNodeEgressIp: (
    nodeName: string,
    profileId?: string | null,
    runtimeKey?: string,
  ) => Promise<DirectEgressInfo>
  probePortEgressIp: (
    port: number,
    protocol: InboundProtocol,
  ) => Promise<DirectEgressInfo>
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

function portProbeRoute(
  state: ProxySlice & {
    portMappings?: PortMapping[]
    config?: AppConfig | null
  },
  port: number,
): string {
  const mapping = state.portMappings?.find((item) => item.port === port)
  const exit = state.config?.residentialProxies?.find(
    (item) => item.id === mapping?.residentialProxyId,
  )
  return JSON.stringify([
    mapping?.id,
    mapping?.enabled,
    mapping?.protocol,
    mapping?.profileId,
    mapping?.nodeName,
    mapping?.residentialProxyId,
    exit,
  ])
}

export const createProxySlice: StateCreator<ProxySlice, [], [], ProxySlice> = (
  set,
  get,
) => ({
  latencies: {},
  testingNodeNames: {},
  nodeEgressIps: {},
  probingEgressNodeKeys: {},
  portEgressIps: {},
  probingPortEgress: {},
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
        timeoutMs || DEFAULT_TIMEOUT_MS,
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
          proxyError: api.isCoreNotRunningError(err)
            ? errMsg
            : state.proxyError,
        }
      })
      return null
    }
  },

  probeNodeEgressIp: async (nodeName, profileId, runtimeKey) => {
    const cacheKey =
      runtimeKey || (profileId ? `${profileId}_${nodeName}` : nodeName)
    set((state) => ({
      probingEgressNodeKeys: {
        ...state.probingEgressNodeKeys,
        [cacheKey]: true,
      },
    }))
    try {
      const info = await api.queryNodeEgressInfo(nodeName, profileId)
      set((state) => {
        const nextProbing = { ...state.probingEgressNodeKeys }
        delete nextProbing[cacheKey]
        const nextEgress: Record<string, DirectEgressInfo> = {
          ...state.nodeEgressIps,
          [cacheKey]: info,
          [nodeName]: info,
        }
        if (profileId) {
          nextEgress[`${profileId}_${nodeName}`] = info
        }
        return {
          nodeEgressIps: nextEgress,
          probingEgressNodeKeys: nextProbing,
        }
      })
      return info
    } catch (err) {
      set((state) => {
        const nextProbing = { ...state.probingEgressNodeKeys }
        delete nextProbing[cacheKey]
        return {
          probingEgressNodeKeys: nextProbing,
        }
      })
      throw err
    }
  },

  probePortEgressIp: async (port, protocol) => {
    const route = portProbeRoute(get(), port)
    set((state) => ({
      probingPortEgress: { ...state.probingPortEgress, [port]: true },
    }))
    try {
      // Chain egress must be probed through the local inbound listener so the
      // measurement reflects upstream -> residential exit -> destination.
      // The listener protocol matters for SOCKS5-only ports.
      const info = await api.queryPortEgressInfo(port, protocol)
      if (route !== portProbeRoute(get(), port)) {
        throw new Error(t('errors.chainConfigChanged'))
      }
      set((state) => {
        const nextProbing = { ...state.probingPortEgress }
        delete nextProbing[port]
        return {
          portEgressIps: { ...state.portEgressIps, [port]: info },
          probingPortEgress: nextProbing,
        }
      })
      return info
    } catch (err) {
      set((state) => {
        const nextProbing = { ...state.probingPortEgress }
        delete nextProbing[port]
        return { probingPortEgress: nextProbing }
      })
      throw err
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
        timeoutMs || DEFAULT_TIMEOUT_MS,
      )
      set({ isTestingAll: false })
      return results
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      set({
        isTestingAll: false,
        proxyError: api.isCoreNotRunningError(err) ? errMsg : get().proxyError,
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
          if (p.residentialProxyId) {
            // Chain ports are measured under the generated `chain-{port}`
            // target. Never let an upstream node cache entry overwrite them.
            return payload.name === `chain-${p.port}`
              ? { ...p, latency: payload.latency }
              : p
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
