import type { StateCreator } from 'zustand'
import * as api from '../services/tauri'
import type {
  AppConfig,
  DirectEgressInfo,
  InboundProtocol,
  DownloadSpeedTestResult,
  LatencyProgressPayload,
  LatencyUpdatePayload,
  NodeIpQualityReport,
  NodeLatencyResult,
  NodeMediaUnlockReport,
  PortMapping,
} from '../types'
import { DEFAULT_TIMEOUT_MS } from '../constants'
import { t } from '../i18n'
import { getNodeQualityCacheKey } from '../utils/proxy'

export interface ProxySlice {
  latencies: Record<string, number | null>
  testingNodeNames: Record<string, boolean>
  nodeEgressIps: Record<string, DirectEgressInfo>
  nodeEgressCachedAt: Record<string, number>
  probingEgressNodeKeys: Record<string, boolean>
  portEgressIps: Record<number, DirectEgressInfo>
  portEgressCachedAt: Record<number, number>
  probingPortEgress: Record<number, boolean>
  nodeIpQualities: Record<string, NodeIpQualityReport>
  nodeIpQualityCachedAt: Record<string, number>
  probingIpQualityKeys: Record<string, boolean>
  nodeMediaUnlocks: Record<string, NodeMediaUnlockReport>
  nodeMediaUnlockCachedAt: Record<string, number>
  nodeDownloadSpeeds: Record<string, DownloadSpeedTestResult>
  nodeDownloadSpeedCachedAt: Record<string, number>
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
  clearEgressCache: (profileId?: string) => void
  probeNodeIpQuality: (
    nodeName: string,
    profileId?: string | null,
    runtimeKey?: string,
    forceRefresh?: boolean,
  ) => Promise<NodeIpQualityReport>
  probeNodeMediaUnlock: (
    nodeName: string,
    profileId?: string | null,
    runtimeKey?: string,
    forceRefresh?: boolean,
  ) => Promise<NodeMediaUnlockReport>
  saveDownloadSpeedResult: (
    cacheKey: string,
    result: DownloadSpeedTestResult,
  ) => void
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

export const EGRESS_CACHE_TTL_MS = 24 * 60 * 60 * 1000

function pruneExpiredRecord<K extends string | number, V>(
  values: Record<K, V>,
  timestamps: Record<K, number>,
  now: number,
): { values: Record<K, V>; timestamps: Record<K, number> } {
  const nextValues = {} as Record<K, V>
  const nextTimestamps = {} as Record<K, number>
  for (const key of Object.keys(values) as K[]) {
    const ts = timestamps[key]
    if (typeof ts === 'number' && now - ts <= EGRESS_CACHE_TTL_MS) {
      nextValues[key] = values[key]
      nextTimestamps[key] = ts
    }
  }
  return { values: nextValues, timestamps: nextTimestamps }
}

export const createProxySlice: StateCreator<ProxySlice, [], [], ProxySlice> = (
  set,
  get,
) => ({
  latencies: {},
  testingNodeNames: {},
  nodeEgressIps: {},
  nodeEgressCachedAt: {},
  probingEgressNodeKeys: {},
  portEgressIps: {},
  portEgressCachedAt: {},
  probingPortEgress: {},
  nodeIpQualities: {},
  nodeIpQualityCachedAt: {},
  probingIpQualityKeys: {},
  nodeMediaUnlocks: {},
  nodeMediaUnlockCachedAt: {},
  nodeDownloadSpeeds: {},
  nodeDownloadSpeedCachedAt: {},
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
        const now = Date.now()
        const nextProbing = { ...state.probingEgressNodeKeys }
        delete nextProbing[cacheKey]
        const pruned = pruneExpiredRecord(
          state.nodeEgressIps,
          state.nodeEgressCachedAt,
          now,
        )
        const nextEgress: Record<string, DirectEgressInfo> = {
          ...pruned.values,
          [cacheKey]: info,
          [nodeName]: info,
        }
        const nextTimestamps: Record<string, number> = {
          ...pruned.timestamps,
          [cacheKey]: now,
          [nodeName]: now,
        }
        if (profileId) {
          nextEgress[`${profileId}_${nodeName}`] = info
          nextTimestamps[`${profileId}_${nodeName}`] = now
        }
        return {
          nodeEgressIps: nextEgress,
          nodeEgressCachedAt: nextTimestamps,
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
        const now = Date.now()
        const nextProbing = { ...state.probingPortEgress }
        delete nextProbing[port]
        const pruned = pruneExpiredRecord(
          state.portEgressIps,
          state.portEgressCachedAt,
          now,
        )
        return {
          portEgressIps: { ...pruned.values, [port]: info },
          portEgressCachedAt: { ...pruned.timestamps, [port]: now },
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

  probeNodeIpQuality: async (
    nodeName,
    profileId,
    runtimeKey,
    forceRefresh = false,
  ) => {
    const qualityKey = getNodeQualityCacheKey(nodeName, profileId, runtimeKey)
    const egressKey =
      runtimeKey || (profileId ? `${profileId}_${nodeName}` : nodeName)
    if (!forceRefresh) {
      const state = get()
      const existing = state.nodeIpQualities[qualityKey]
      const cachedAt = state.nodeIpQualityCachedAt[qualityKey]
      if (
        existing &&
        typeof cachedAt === 'number' &&
        Date.now() - cachedAt <= EGRESS_CACHE_TTL_MS
      ) {
        return existing
      }
    }

    set((state) => ({
      probingIpQualityKeys: {
        ...state.probingIpQualityKeys,
        [egressKey]: true,
        [qualityKey]: true,
      },
    }))
    try {
      const report = await api.queryNodeIpQuality(nodeName, profileId)
      set((state) => {
        const now = Date.now()
        const nextProbing = { ...state.probingIpQualityKeys }
        delete nextProbing[egressKey]
        delete nextProbing[qualityKey]
        const pruned = pruneExpiredRecord(
          state.nodeIpQualities,
          state.nodeIpQualityCachedAt,
          now,
        )
        const nextQualities: Record<string, NodeIpQualityReport> = {
          ...pruned.values,
          [qualityKey]: report,
        }
        const nextTimestamps: Record<string, number> = {
          ...pruned.timestamps,
          [qualityKey]: now,
        }

        const egressUpdate: Partial<ProxySlice> = {}
        if (report.ip) {
          const egressInfo: DirectEgressInfo = {
            ip: report.ip,
            region: report.locationDisplay,
            countryCode: report.countryCode ?? null,
            isp: report.asnOrg ?? null,
            latencyMs:
              report.cleanip?.latencyMs ?? report.ippure?.latencyMs ?? null,
            source: report.cleanip ? 'cleanip' : 'ippure',
          }
          const prunedEgress = pruneExpiredRecord(
            state.nodeEgressIps,
            state.nodeEgressCachedAt,
            now,
          )
          const nextEgress: Record<string, DirectEgressInfo> = {
            ...prunedEgress.values,
            [egressKey]: egressInfo,
          }
          const nextEgressTs: Record<string, number> = {
            ...prunedEgress.timestamps,
            [egressKey]: now,
          }
          if (profileId) {
            nextEgress[`${profileId}_${nodeName}`] = egressInfo
            nextEgressTs[`${profileId}_${nodeName}`] = now
          } else if (!runtimeKey) {
            nextEgress[nodeName] = egressInfo
            nextEgressTs[nodeName] = now
          }
          egressUpdate.nodeEgressIps = nextEgress
          egressUpdate.nodeEgressCachedAt = nextEgressTs
        }

        return {
          ...egressUpdate,
          nodeIpQualities: nextQualities,
          nodeIpQualityCachedAt: nextTimestamps,
          probingIpQualityKeys: nextProbing,
        }
      })
      return report
    } catch (err) {
      set((state) => {
        const nextProbing = { ...state.probingIpQualityKeys }
        delete nextProbing[egressKey]
        delete nextProbing[qualityKey]
        return { probingIpQualityKeys: nextProbing }
      })
      throw err
    }
  },

  probeNodeMediaUnlock: async (
    nodeName,
    profileId,
    runtimeKey,
    forceRefresh = false,
  ) => {
    const mediaKey = getNodeQualityCacheKey(nodeName, profileId, runtimeKey)
    if (!forceRefresh) {
      const state = get()
      const existing = state.nodeMediaUnlocks[mediaKey]
      const cachedAt = state.nodeMediaUnlockCachedAt[mediaKey]
      if (
        existing &&
        typeof cachedAt === 'number' &&
        Date.now() - cachedAt <= EGRESS_CACHE_TTL_MS
      ) {
        return existing
      }
    }

    const report = await api.queryNodeMediaUnlock(nodeName, profileId)
    set((state) => {
      const now = Date.now()
      const pruned = pruneExpiredRecord(
        state.nodeMediaUnlocks,
        state.nodeMediaUnlockCachedAt,
        now,
      )
      return {
        nodeMediaUnlocks: {
          ...pruned.values,
          [mediaKey]: report,
        },
        nodeMediaUnlockCachedAt: {
          ...pruned.timestamps,
          [mediaKey]: now,
        },
      }
    })
    return report
  },

  saveDownloadSpeedResult: (cacheKey, result) => {
    set((state) => {
      const now = Date.now()
      const pruned = pruneExpiredRecord(
        state.nodeDownloadSpeeds,
        state.nodeDownloadSpeedCachedAt,
        now,
      )
      return {
        nodeDownloadSpeeds: {
          ...pruned.values,
          [cacheKey]: result,
        },
        nodeDownloadSpeedCachedAt: {
          ...pruned.timestamps,
          [cacheKey]: now,
        },
      }
    })
  },

  clearEgressCache: (profileId) => {
    set((state) => {
      if (!profileId) {
        return {
          nodeEgressIps: {},
          nodeEgressCachedAt: {},
          nodeIpQualities: {},
          nodeIpQualityCachedAt: {},
          nodeMediaUnlocks: {},
          nodeMediaUnlockCachedAt: {},
          nodeDownloadSpeeds: {},
          nodeDownloadSpeedCachedAt: {},
          portEgressIps: {},
          portEgressCachedAt: {},
        }
      }
      const prefix = `${profileId}_`
      const filterOutPrefix = <T>(
        values: Record<string, T>,
        timestamps: Record<string, number>,
      ) => {
        const nextVals: Record<string, T> = {}
        const nextTs: Record<string, number> = {}
        for (const [key, val] of Object.entries(values)) {
          if (!key.startsWith(prefix)) {
            nextVals[key] = val
            if (timestamps[key] !== undefined) {
              nextTs[key] = timestamps[key]
            }
          }
        }
        return { values: nextVals, timestamps: nextTs }
      }
      const egress = filterOutPrefix(
        state.nodeEgressIps,
        state.nodeEgressCachedAt,
      )
      const quality = filterOutPrefix(
        state.nodeIpQualities,
        state.nodeIpQualityCachedAt,
      )
      const media = filterOutPrefix(
        state.nodeMediaUnlocks,
        state.nodeMediaUnlockCachedAt,
      )
      const downloadSpeeds = filterOutPrefix(
        state.nodeDownloadSpeeds,
        state.nodeDownloadSpeedCachedAt,
      )
      return {
        nodeEgressIps: egress.values,
        nodeEgressCachedAt: egress.timestamps,
        nodeIpQualities: quality.values,
        nodeIpQualityCachedAt: quality.timestamps,
        nodeMediaUnlocks: media.values,
        nodeMediaUnlockCachedAt: media.timestamps,
        nodeDownloadSpeeds: downloadSpeeds.values,
        nodeDownloadSpeedCachedAt: downloadSpeeds.timestamps,
        portEgressIps: {},
        portEgressCachedAt: {},
      }
    })
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

      let updatedMappings = false
      let nextPortMappings = rootState.portMappings
      if (nextPortMappings) {
        const mapped = nextPortMappings.map((p) => {
          const isChain = Boolean(p.residentialProxyId || p.chainExitNodeName)
          let matched = false
          if (isChain) {
            // Chain ports are measured under the generated `chain-{port}`
            // target. Never let upstream or fallback node probes overwrite them.
            matched = payload.name === `chain-${p.port}`
          } else if (payload.mappingId && p.id === payload.mappingId) {
            matched = true
          } else if (
            p.nodeName === payload.name ||
            (payload.runtimeName && p.nodeName === payload.runtimeName)
          ) {
            matched = true
          }
          if (matched && p.latency !== payload.latency) {
            updatedMappings = true
            return { ...p, latency: payload.latency }
          }
          return p
        })
        if (updatedMappings) {
          nextPortMappings = mapped
        }
      }

      const hasTestingPort =
        payload.mappingId && rootState.testingPortIds?.[payload.mappingId]
      const nextTestingPorts = hasTestingPort
        ? { ...rootState.testingPortIds }
        : rootState.testingPortIds
      if (hasTestingPort && payload.mappingId && nextTestingPorts) {
        delete nextTestingPorts[payload.mappingId]
      }

      return {
        latencies: nextLatencies,
        testingNodeNames: nextTestingNodes,
        ...(updatedMappings && nextPortMappings
          ? { portMappings: nextPortMappings }
          : {}),
        ...(hasTestingPort && nextTestingPorts
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
      if (state.isTestingAll) {
        return state
      }
      return {
        isTestingAll: true,
      }
    })
  },

  setQuickBindTarget: (quickBindTarget) => set({ quickBindTarget }),
  setIsAddPortModalOpen: (isAddPortModalOpen) => set({ isAddPortModalOpen }),
  setProxyError: (proxyError) => set({ proxyError }),
})
