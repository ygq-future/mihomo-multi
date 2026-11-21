import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ArrowUpDown,
  Building2,
  Loader2,
  Network,
  Radio,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../../services/tauri'
import { useAppStore } from '../../stores/appStore'
import { useTranslation } from '../../i18n'
import type { InboundProtocol, PortMapping } from '../../types'
import {
  extractRegion,
  formatProtocolName,
  getLatencyBadgeProps,
  getLatencyColor,
  getProtocolBadgeProps,
} from '../../utils/proxy'
import {
  Badge,
  Button,
  Input,
  Modal,
  RegionFlag,
  Select,
  type SelectOption,
  Switch,
} from '../common'
import { SpeedSelect } from './SpeedSelect'

export interface AddPortModalProps {
  isOpen: boolean
  onClose: () => void
  initialProfileId?: string
  initialNodeName?: string
  initialMapping?: PortMapping | null
}

type ResidentialTestState =
  | { status: 'success'; latency: number; ip: string; region: string }
  | { status: 'error'; error: string }

function nodeKeyHasLatency(
  key: string,
  rawName: string,
  latencies: Record<string, number | null>,
): number | null | undefined {
  if (key in latencies) return latencies[key]
  if (rawName in latencies) return latencies[rawName]
  return undefined
}

function getNodeLatencyScore(
  displayName: string,
  rawName: string,
  latencies: Record<string, number | null>,
): number {
  const lat = nodeKeyHasLatency(displayName, rawName, latencies)
  if (lat !== undefined && lat !== null) {
    return lat
  }
  if (lat === null) {
    return 900000
  }
  return 999999
}

function compareNodesByLatencyAndName(
  a: { displayName: string; name: string },
  b: { displayName: string; name: string },
  latencies: Record<string, number | null>,
  locale: string,
): number {
  const scoreA = getNodeLatencyScore(a.displayName, a.name, latencies)
  const scoreB = getNodeLatencyScore(b.displayName, b.name, latencies)

  if (scoreA !== scoreB) {
    return scoreA - scoreB
  }

  return a.displayName.localeCompare(b.displayName, locale)
}

export const AddPortModal: React.FC<AddPortModalProps> = ({
  isOpen,
  onClose,
  initialProfileId,
  initialNodeName,
  initialMapping,
}) => {
  const { t, locale } = useTranslation()
  const {
    profiles,
    profileNodes,
    portMappings,
    driftReports,
    fetchProfileNodes,
    setDriftReports,
    fetchConfig,
    savePortMapping,
    fetchStatus,
    setActiveTab,
    latencies,
    config,
    testingNodeNames,
    isTestingAll,
    testNodeDelay,
    testAllNodesDelay,
  } = useAppStore()

  const [port, setPort] = useState<string>('7891')
  const [protocol, setProtocol] = useState<InboundProtocol>('mixed')
  const [selectedProfileId, setSelectedProfileId] = useState<string>('')
  const [selectedNodeName, setSelectedNodeName] = useState<string>('')
  const [fallbackProfileId, setFallbackProfileId] = useState<string>('')
  const [fallbackNodeName, setFallbackNodeName] = useState<string>('')
  const [description, setDescription] = useState<string>('')
  const [bypassCn, setBypassCn] = useState<boolean>(true)
  const [selectedResidentialProxyId, setSelectedResidentialProxyId] =
    useState<string>('')
  const [residentialConfigError, setResidentialConfigError] = useState<
    string | null
  >(null)
  const [residentialTestResults, setResidentialTestResults] = useState<
    Record<string, ResidentialTestState>
  >({})
  const [residentialTesting, setResidentialTesting] = useState<
    Record<string, boolean>
  >({})
  const [residentialBatchTesting, setResidentialBatchTesting] =
    useState<boolean>(false)
  const [residentialTestError, setResidentialTestError] = useState<
    string | null
  >(null)
  const [configReloadToken, setConfigReloadToken] = useState(0)
  const [isCheckingPort, setIsCheckingPort] = useState(false)
  const [isPortAvailable, setIsPortAvailable] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const isEditing = Boolean(initialMapping)

  // Find if current mapping has a drift report
  const currentDrift = useMemo(() => {
    if (!initialMapping) return null
    return driftReports.find((r) => r.mappingId === initialMapping.id) || null
  }, [initialMapping, driftReports])

  // Drift prose is rendered by the backend in the active UI locale. Refresh whenever the editor
  // opens or the language changes so cached reports never keep the previous language on screen.
  const driftLocaleRef = useRef(locale)
  const driftRequestSeqRef = useRef(0)
  const driftRequestChainRef = useRef<Promise<void>>(Promise.resolve())
  useEffect(() => {
    const localeChanged = driftLocaleRef.current !== locale
    driftLocaleRef.current = locale
    if (!localeChanged && (!isOpen || !isEditing)) return
    const requestSeq = ++driftRequestSeqRef.current
    // Serialize the locale sync and the drift read. A superseded request never reaches the
    // backend and never writes its stale-language result over a newer locale's reports.
    const run = async () => {
      if (requestSeq !== driftRequestSeqRef.current) return
      await api.setUiLocale(locale)
      if (requestSeq !== driftRequestSeqRef.current) return
      const reports = await api.getDriftReports().catch(() => null)
      if (reports && requestSeq === driftRequestSeqRef.current) {
        setDriftReports(reports)
      }
    }
    const chained = driftRequestChainRef.current.catch(() => {}).then(run)
    driftRequestChainRef.current = chained.catch((error: unknown) => {
      console.error('[i18n] Failed to refresh localized drift reports:', error)
    })
    return () => {
      if (requestSeq === driftRequestSeqRef.current) {
        driftRequestSeqRef.current += 1
      }
    }
  }, [isOpen, isEditing, locale, setDriftReports])

  // Initialize or reset fields when opened
  useEffect(() => {
    if (isOpen) {
      setError(null)
      setSuccess(false)
      setSubmitting(false)
      setResidentialConfigError(null)
      setResidentialTestResults({})
      setResidentialTesting({})
      setResidentialBatchTesting(false)
      setResidentialTestError(null)

      if (initialMapping) {
        setPort(String(initialMapping.port))
        setProtocol(initialMapping.protocol)
        setSelectedProfileId(initialMapping.profileId)
        setSelectedNodeName(initialMapping.nodeName)
        setFallbackProfileId(
          initialMapping.fallbackProfileId || initialMapping.profileId,
        )
        setFallbackNodeName(initialMapping.fallbackNodeName || '')
        setDescription(initialMapping.description || '')
        setBypassCn(initialMapping.bypassCn ?? true)
        setSelectedResidentialProxyId(initialMapping.residentialProxyId || '')
      } else {
        setSelectedProfileId(initialProfileId || '')
        setSelectedNodeName(initialNodeName || '')
        setFallbackProfileId('')
        setFallbackNodeName('')
        // Sequential backend auto-allocation starting from 7891 (accounts for both self and system occupancy)
        api
          .getNextAvailablePort(7891)
          .then((allocatedPort) => {
            setPort(String(allocatedPort))
            setIsPortAvailable(true)
          })
          .catch(() => {
            setPort('7891')
          })

        setProtocol('mixed')
        setDescription('')
        setBypassCn(true)
        setSelectedResidentialProxyId('')
      }
    }
  }, [isOpen, initialProfileId, initialNodeName, initialMapping])

  // Ensure nodes for all profiles are loaded
  useEffect(() => {
    if (isOpen) {
      for (const p of profiles) {
        if (!profileNodes[p.id]) {
          fetchProfileNodes(p.id).catch(() => {})
        }
      }
    }
  }, [isOpen, profiles, profileNodes, fetchProfileNodes])

  // Managed residential exits live in the app config.
  useEffect(() => {
    if (!isOpen || config) return
    let cancelled = false
    setResidentialConfigError(null)
    fetchConfig()
      .then(() => {
        if (cancelled) return
        const state = useAppStore.getState()
        if (!state.config) {
          setResidentialConfigError(
            state.error || t('addPort.residentialLoadFail'),
          )
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setResidentialConfigError(
            err instanceof Error ? err.message : String(err),
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, config, fetchConfig, configReloadToken, t])

  // Check port availability on debounced port change
  useEffect(() => {
    const trimmedPort = port.trim()
    const isPureInteger = /^\d+$/.test(trimmedPort)
    const portNum = isPureInteger ? Number.parseInt(trimmedPort, 10) : 0
    if (!isPureInteger || !portNum || portNum < 1024 || portNum > 65535) {
      setIsPortAvailable(null)
      return
    }

    // If editing and port hasn't changed, it's considered valid
    if (
      isEditing &&
      initialMapping &&
      portNum === initialMapping.port &&
      initialMapping.enabled
    ) {
      setIsPortAvailable(true)
      setIsCheckingPort(false)
      return
    }

    let isMounted = true
    setIsCheckingPort(true)

    const timer = setTimeout(async () => {
      try {
        const available = await api.checkPortAvailable(
          portNum,
          initialMapping?.id,
        )
        if (isMounted) {
          setIsPortAvailable(available)
          setIsCheckingPort(false)
        }
      } catch {
        if (isMounted) {
          setIsPortAvailable(false)
          setIsCheckingPort(false)
        }
      }
    }, 250)

    return () => {
      isMounted = false
      clearTimeout(timer)
    }
  }, [port, isEditing, initialMapping])

  const allAvailableNodes = useMemo(() => {
    const result: Array<{
      name: string
      type: string
      server: string
      port: number
      runtimeName?: string
      profileId: string
      profileName: string
      uniqueKey: string
      displayName: string
    }> = []
    for (const p of profiles) {
      const nodes = profileNodes[p.id] || []
      for (const n of nodes) {
        result.push({
          ...n,
          profileId: p.id,
          profileName: p.name,
          uniqueKey: `${p.id}:::${n.name}`,
          displayName: `[${p.name}] ${n.name}`,
        })
      }
    }
    return result
  }, [profiles, profileNodes])

  const selectedNode = useMemo(() => {
    if (!selectedNodeName || !selectedProfileId) return null
    return (
      allAvailableNodes.find(
        (n) => n.profileId === selectedProfileId && n.name === selectedNodeName,
      ) || null
    )
  }, [allAvailableNodes, selectedProfileId, selectedNodeName])

  const selectedFallbackNode = useMemo(() => {
    if (!fallbackNodeName || !fallbackProfileId) return null
    return (
      allAvailableNodes.find(
        (n) => n.profileId === fallbackProfileId && n.name === fallbackNodeName,
      ) || null
    )
  }, [allAvailableNodes, fallbackProfileId, fallbackNodeName])

  const selectedNodeRegion = useMemo(() => {
    if (!selectedNodeName) return null
    return extractRegion(selectedNodeName)
  }, [selectedNodeName])

  const regionNames = useMemo(() => {
    try {
      return new Intl.DisplayNames([locale], { type: 'region' })
    } catch {
      return null
    }
  }, [locale])

  const formatRegionName = useCallback(
    (code: string, fallbackName?: string): string => {
      if (!code || code === 'OTHER') {
        return t('residentialI18n.test.otherRegion')
      }
      if (/^[A-Za-z]{2}$/.test(code) && regionNames) {
        try {
          return regionNames.of(code) || fallbackName || code
        } catch {
          // Invalid region code: fall through to a safe label.
        }
      }
      return fallbackName || code
    },
    [regionNames, t],
  )

  const residentialProxies = useMemo(
    () => config?.residentialProxies ?? [],
    [config],
  )
  const selectedResidentialProxy = useMemo(
    () =>
      residentialProxies.find(
        (proxy) => proxy.id === selectedResidentialProxyId,
      ) ?? null,
    [residentialProxies, selectedResidentialProxyId],
  )
  const isChainMode = selectedResidentialProxyId !== ''

  const handleResidentialChange = (value: string) => {
    setSelectedResidentialProxyId(value)
    if (value) {
      // Chain ports must send all traffic through the exit: bypass rules,
      // fallback nodes and per-port rules are all bypassed by design.
      setBypassCn(false)
      setFallbackProfileId('')
      setFallbackNodeName('')
    } else {
      setBypassCn(true)
    }
  }

  const boundNodeMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of portMappings) {
      if (initialMapping && m.id === initialMapping.id) continue
      // Chain ports only use the node as an upstream hop, so their node
      // selection never blocks another chain port from sharing it.
      if (m.residentialProxyId) continue
      map.set(`${m.profileId}:::${m.nodeName}`, m.port)
    }
    return map
  }, [portMappings, initialMapping])

  const chainUpstreamMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of portMappings) {
      if (initialMapping && m.id === initialMapping.id) continue
      if (!m.residentialProxyId) continue
      map.set(`${m.profileId}:::${m.nodeName}`, m.port)
    }
    return map
  }, [portMappings, initialMapping])

  const sortedNodes = useMemo(() => {
    const list = [...allAvailableNodes]
    return list.sort((a, b) => {
      const isBoundA = !isChainMode && boundNodeMap.has(a.uniqueKey)
      const isBoundB = !isChainMode && boundNodeMap.has(b.uniqueKey)

      if (isBoundA !== isBoundB) {
        return isBoundA ? 1 : -1
      }
      return compareNodesByLatencyAndName(a, b, latencies, locale)
    })
  }, [allAvailableNodes, boundNodeMap, latencies, isChainMode, locale])

  const nodeOptions = useMemo(() => {
    return sortedNodes.map((n) => {
      const boundPort = boundNodeMap.get(n.uniqueKey)
      const chainPort = chainUpstreamMap.get(n.uniqueKey)
      const latency = nodeKeyHasLatency(n.displayName, n.name, latencies)
      const latencyProps = getLatencyBadgeProps(latency, false)
      const region = extractRegion(n.name)
      const protocolText = t('addPort.protocolText', {
        protocol: formatProtocolName(n.type),
      })
      let description = `${protocolText} · ${formatRegionName(
        region.code,
        region.name,
      )}`
      if (boundPort && !isChainMode) {
        description = t('addPort.boundToPortDesc', {
          port: boundPort,
          protocol: protocolText,
        })
      } else if (chainPort) {
        description = t('addPort.usedAsUpstreamDesc', {
          port: chainPort,
          protocol: protocolText,
        })
      } else if (boundPort && isChainMode) {
        description = t('addPort.reusableUpstreamDesc', {
          port: boundPort,
          protocol: protocolText,
        })
      }

      return {
        value: n.uniqueKey,
        label: n.displayName,
        group: n.profileName,
        searchTarget: n.name,
        description,
        icon: <RegionFlag code={region.code} size="sm" />,
        disabled: Boolean(boundPort) && !isChainMode,
        rightNode: (
          <span
            className={`font-mono text-[11px] font-medium ${getLatencyColor(latency)}`}
          >
            {latencyProps.label}
          </span>
        ),
      }
    })
  }, [
    sortedNodes,
    boundNodeMap,
    chainUpstreamMap,
    latencies,
    isChainMode,
    t,
    formatRegionName,
  ])

  const nodeTestingValues = useMemo(() => {
    const testing: Record<string, boolean> = {}
    for (const node of allAvailableNodes) {
      const runtimeName = node.runtimeName || node.displayName
      if (testingNodeNames[runtimeName] || testingNodeNames[node.name]) {
        testing[node.uniqueKey] = true
      }
    }
    return testing
  }, [allAvailableNodes, testingNodeNames])

  const handleTestNodeOption = useCallback(
    async (option: SelectOption<string>) => {
      const node = allAvailableNodes.find(
        (candidate) => candidate.uniqueKey === option.value,
      )
      if (!node) return
      await testNodeDelay(node.runtimeName || node.displayName)
    },
    [allAvailableNodes, testNodeDelay],
  )

  const handleTestNodeOptions = useCallback(
    async (options: SelectOption<string>[]) => {
      const names = Array.from(
        new Set(
          options.flatMap((option) => {
            if (!option.value) return []
            const node = allAvailableNodes.find(
              (candidate) => candidate.uniqueKey === option.value,
            )
            return node ? [node.runtimeName || node.displayName] : []
          }),
        ),
      )
      if (names.length === 0) return
      await testAllNodesDelay(names)
    },
    [allAvailableNodes, testAllNodesDelay],
  )

  const selectedUpstreamKey =
    selectedNode && selectedProfileId
      ? `${selectedProfileId}:::${selectedNode.name}`
      : ''
  const residentialUpstreamRef = useRef('')
  const residentialGenerationRef = useRef(0)
  const residentialRequestIdRef = useRef(0)
  const residentialTestTokensRef = useRef<Record<string, number>>({})
  const residentialBatchRef = useRef(0)
  const residentialBatchTestingRef = useRef(false)

  // Invalidate in-flight probes as soon as the upstream changes, before effects flush.
  if (residentialUpstreamRef.current !== selectedUpstreamKey) {
    residentialUpstreamRef.current = selectedUpstreamKey
    residentialGenerationRef.current += 1
  }

  useEffect(() => {
    residentialTestTokensRef.current = {}
    residentialBatchRef.current += 1
    residentialBatchTestingRef.current = false
    setResidentialTestResults({})
    setResidentialTesting({})
    setResidentialBatchTesting(false)
    setResidentialTestError(null)
  }, [selectedUpstreamKey])

  useEffect(() => {
    residentialBatchTestingRef.current = false
    setResidentialBatchTesting(false)
    if (!isOpen) return
    residentialGenerationRef.current += 1
    residentialBatchRef.current += 1
    residentialTestTokensRef.current = {}
  }, [isOpen])

  const testResidentialExit = useCallback(
    async (proxyId: string, batchId?: number): Promise<string | null> => {
      if (!proxyId) return null
      if (!residentialProxies.some((proxy) => proxy.id === proxyId)) return null
      if (!selectedNode || !selectedProfileId) {
        const message = t('residentialI18n.test.selectFirst')
        setResidentialTestError(message)
        return message
      }

      const upstreamKey = `${selectedProfileId}:::${selectedNode.name}`
      const generation = residentialGenerationRef.current
      const isStale = () =>
        generation !== residentialGenerationRef.current ||
        residentialUpstreamRef.current !== upstreamKey ||
        (batchId !== undefined && batchId !== residentialBatchRef.current)

      if (isStale()) return null
      // Single tests must not start while a batch owns the exits.
      if (batchId === undefined && residentialBatchTestingRef.current)
        return null

      const requestId = ++residentialRequestIdRef.current
      residentialTestTokensRef.current[proxyId] = requestId
      const isCurrentRequest = () =>
        !isStale() && residentialTestTokensRef.current[proxyId] === requestId
      setResidentialTestError(null)
      setResidentialTesting((previous) => ({ ...previous, [proxyId]: true }))
      try {
        const result = await api.testResidentialProxy(
          proxyId,
          selectedProfileId,
          selectedNode.name,
        )
        if (!isCurrentRequest()) return null
        setResidentialTestResults((previous) => ({
          ...previous,
          [proxyId]: {
            status: 'success',
            latency: result.latencyMs,
            ip: result.egress.ip,
            region: result.egress.region,
          },
        }))
        return null
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (!isCurrentRequest()) return null
        setResidentialTestResults((previous) => ({
          ...previous,
          [proxyId]: { status: 'error', error: message },
        }))
        setResidentialTestError(
          t('residentialI18n.test.liveFailed', { err: message }),
        )
        return message
      } finally {
        // Only the request that still owns this exit may clear its loading state.
        if (residentialTestTokensRef.current[proxyId] === requestId) {
          delete residentialTestTokensRef.current[proxyId]
          setResidentialTesting((previous) => {
            if (!previous[proxyId]) return previous
            const next = { ...previous }
            delete next[proxyId]
            return next
          })
        }
      }
    },
    [selectedNode, selectedProfileId, residentialProxies, t],
  )

  const handleTestResidentialOption = useCallback(
    async (option: SelectOption<string>) => {
      await testResidentialExit(option.value)
    },
    [testResidentialExit],
  )

  const handleTestResidentialOptions = useCallback(
    async (options: SelectOption<string>[]) => {
      if (residentialBatchTestingRef.current) return
      if (Object.keys(residentialTestTokensRef.current).length > 0) return
      if (!selectedNode || !selectedProfileId) {
        setResidentialTestError(t('residentialI18n.test.selectFirst'))
        return
      }

      const upstreamKey = `${selectedProfileId}:::${selectedNode.name}`
      if (residentialUpstreamRef.current !== upstreamKey) return
      const generation = residentialGenerationRef.current
      const batchId = ++residentialBatchRef.current
      const isStale = () =>
        generation !== residentialGenerationRef.current ||
        batchId !== residentialBatchRef.current ||
        residentialUpstreamRef.current !== upstreamKey

      residentialBatchTestingRef.current = true
      setResidentialBatchTesting(true)
      setResidentialTestError(null)
      let lastError: string | null = null
      try {
        for (const option of options) {
          if (!option.value) continue
          if (isStale()) return
          const error = await testResidentialExit(option.value, batchId)
          if (isStale()) return
          if (error) lastError = error
        }
        if (!isStale()) {
          setResidentialTestError(
            lastError
              ? t('residentialI18n.test.liveFailed', { err: lastError })
              : null,
          )
        }
      } finally {
        if (batchId === residentialBatchRef.current) {
          residentialBatchTestingRef.current = false
          setResidentialBatchTesting(false)
        }
      }
    },
    [selectedNode, selectedProfileId, testResidentialExit, t],
  )

  const renderResidentialTestState = useCallback(
    (proxyId: string) => {
      if (residentialTesting[proxyId]) {
        return (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
        )
      }
      const result = residentialTestResults[proxyId]
      if (!result) return null
      if (result.status === 'success') {
        const latencyProps = getLatencyBadgeProps(result.latency, false)
        return (
          <span
            title={t('residentialI18n.test.livePassed', {
              ip: result.ip,
              region: result.region,
              latency: result.latency,
            })}
          >
            <Badge
              variant={latencyProps.variant}
              size="sm"
              dot={latencyProps.dot}
              className="!text-[10px] !py-0.5 !px-1.5 font-mono"
            >
              {latencyProps.label}
            </Badge>
          </span>
        )
      }
      return (
        <span
          title={t('residentialI18n.test.liveFailed', { err: result.error })}
          className="inline-flex text-destructive"
        >
          <AlertCircle className="w-3.5 h-3.5" />
        </span>
      )
    },
    [residentialTesting, residentialTestResults, t],
  )

  const residentialSelectTestingValues = useMemo(() => {
    if (!residentialBatchTesting) return residentialTesting
    const testing: Record<string, boolean> = {}
    for (const proxy of residentialProxies) testing[proxy.id] = true
    if (selectedResidentialProxyId) testing[selectedResidentialProxyId] = true
    return testing
  }, [
    residentialBatchTesting,
    residentialTesting,
    residentialProxies,
    selectedResidentialProxyId,
  ])

  const residentialOptions = useMemo(() => {
    const options: SelectOption<string>[] = [
      {
        value: '',
        label: t('addPort.noResidentialExit'),
        description: t('addPort.noResidentialExitDesc'),
      },
    ]
    for (const proxy of residentialProxies) {
      options.push({
        value: proxy.id,
        label: proxy.name,
        description: `${proxy.protocol.toUpperCase()} · ${proxy.server}:${proxy.port}`,
        icon: <Building2 className="w-3.5 h-3.5 text-primary" />,
        rightNode: renderResidentialTestState(proxy.id),
      })
    }
    if (
      selectedResidentialProxyId &&
      !residentialProxies.some(
        (proxy) => proxy.id === selectedResidentialProxyId,
      )
    ) {
      options.push({
        value: selectedResidentialProxyId,
        label: t('addPort.residentialMissing'),
        description: t('addPort.residentialMissingDesc'),
        disabled: true,
      })
    }
    return options
  }, [
    residentialProxies,
    selectedResidentialProxyId,
    t,
    renderResidentialTestState,
  ])

  const fallbackNodeOptions = useMemo(() => {
    if (!selectedNodeRegion || !selectedNode) return []

    const sameRegionNodes = allAvailableNodes
      .filter(
        (n) =>
          n.uniqueKey !== selectedNode.uniqueKey &&
          extractRegion(n.name).code === selectedNodeRegion.code,
      )
      .sort((a, b) => compareNodesByLatencyAndName(a, b, latencies, locale))

    const options: SelectOption<string>[] = [
      {
        value: '',
        label: t('addPort.noFallback'),
        description: t('addPort.noFallbackDesc'),
      },
    ]

    for (const n of sameRegionNodes) {
      const latency = nodeKeyHasLatency(n.displayName, n.name, latencies)
      const latencyProps = getLatencyBadgeProps(latency, false)
      const region = extractRegion(n.name)

      options.push({
        value: n.uniqueKey,
        label: n.displayName,
        group: n.profileName,
        searchTarget: n.name,
        description: t('addPort.fallbackOptionDesc', {
          protocol: formatProtocolName(n.type),
          region: formatRegionName(region.code, region.name),
        }),
        icon: <RegionFlag code={region.code} size="sm" />,
        rightNode: (
          <span
            className={`font-mono text-[11px] font-medium ${getLatencyColor(latency)}`}
          >
            {latencyProps.label}
          </span>
        ),
      })
    }

    return options
  }, [
    selectedNodeRegion,
    selectedNode,
    allAvailableNodes,
    latencies,
    t,
    formatRegionName,
    locale,
  ])

  const mainLatency = selectedNode
    ? nodeKeyHasLatency(selectedNode.displayName, selectedNode.name, latencies)
    : undefined
  const mainLatencyProps = getLatencyBadgeProps(mainLatency, false)
  const mainProtocolProps = selectedNode
    ? getProtocolBadgeProps(selectedNode.type)
    : null

  const fbLatency = selectedFallbackNode
    ? nodeKeyHasLatency(
        selectedFallbackNode.displayName,
        selectedFallbackNode.name,
        latencies,
      )
    : undefined
  const fbLatencyProps = selectedFallbackNode
    ? getLatencyBadgeProps(fbLatency, false)
    : null
  const fbProtocolProps = selectedFallbackNode
    ? getProtocolBadgeProps(selectedFallbackNode.type)
    : null

  const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)

    const trimmedPort = port.trim()
    const isPureInteger = /^\d+$/.test(trimmedPort)
    const portNum = isPureInteger ? Number.parseInt(trimmedPort, 10) : 0
    if (!isPureInteger || !portNum || portNum < 1024 || portNum > 65535) {
      setError(t('addPort.errPortRange'))
      return
    }

    if (isPortAvailable === false) {
      setError(t('addPort.errPortOccupied', { port: portNum }))
      return
    }

    if (!selectedProfileId) {
      setError(t('addPort.errSelectProfile'))
      return
    }

    if (!selectedNodeName) {
      setError(
        isChainMode
          ? t('addPort.errSelectUpstream')
          : t('addPort.errSelectNode'),
      )
      return
    }

    if (isChainMode && !selectedResidentialProxy) {
      setError(t('addPort.errResidentialMissing'))
      return
    }

    setSubmitting(true)
    try {
      await savePortMapping({
        id: isEditing && initialMapping ? initialMapping.id : '',
        port: portNum,
        protocol,
        profileId: selectedProfileId,
        nodeName: selectedNodeName,
        residentialProxyId: isChainMode ? selectedResidentialProxyId : null,
        fallbackProfileId: isChainMode
          ? null
          : fallbackNodeName.trim()
            ? fallbackProfileId
            : null,
        fallbackNodeName: isChainMode ? null : fallbackNodeName.trim() || null,
        bypassCn: isChainMode ? false : bypassCn,
        manualFallback: isChainMode ? false : initialMapping?.manualFallback,
        rules: isChainMode ? [] : initialMapping?.rules,
        description: description.trim() || undefined,
        enabled: isEditing && initialMapping ? initialMapping.enabled : true,
      })

      fetchStatus().catch(() => {})
      setSuccess(true)
      setTimeout(() => {
        onClose()
        setActiveTab('ports')
      }, 400)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSubmitting(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        isEditing
          ? t('addPort.titleEdit')
          : initialNodeName
            ? t('addPort.titleQuickBind')
            : t('addPort.titleAdd')
      }
      subtitle={
        isChainMode
          ? isEditing
            ? t('addPort.subEditChain')
            : t('addPort.subAddChain')
          : isEditing
            ? t('addPort.subEditNormal')
            : t('addPort.subAddNormal')
      }
      icon={<Network className="w-4 h-4 text-primary" />}
      maxWidth="md"
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={submitting || success}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form="add-port-form"
            variant="primary"
            size="sm"
            loading={submitting}
            disabled={
              submitting ||
              success ||
              !selectedNodeName ||
              !port ||
              isPortAvailable === false ||
              (isChainMode && !selectedResidentialProxy)
            }
          >
            {isEditing ? t('addPort.saveChanges') : t('addPort.confirmCreate')}
          </Button>
        </>
      }
    >
      <form id="add-port-form" onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 text-xs bg-destructive/10 border border-destructive/20 text-destructive rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-destructive hover:opacity-80"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Drift Warning Banner if editing drifted port */}
        {isEditing && currentDrift && currentDrift.status !== 'healthy' && (
          <div className="p-3 text-xs bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 rounded-lg space-y-2">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
              <span>
                {isChainMode
                  ? t('addPort.driftChainAlert')
                  : t('addPort.driftNormalAlert')}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {currentDrift.message}
            </p>
            {currentDrift.suggestions &&
              currentDrift.suggestions.length > 0 && (
                <div className="pt-1 space-y-1">
                  <div className="text-[10px] font-semibold text-muted-foreground flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-amber-500" />
                    <span>{t('addPort.suggestedMatch')}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {currentDrift.suggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => setSelectedNodeName(suggestion)}
                        className={`px-2 py-1 rounded text-[11px] font-medium border transition-colors ${
                          selectedNodeName === suggestion
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-card hover:bg-accent border-border text-foreground'
                        }`}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}
          </div>
        )}

        {/* Port and Protocol Grid */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="port-input"
              className="block text-xs font-medium text-foreground mb-1.5"
            >
              {t('addPort.localPortLabel')}{' '}
              <span className="text-destructive">*</span>
            </label>
            <div className="relative">
              <Input
                id="port-input"
                type="number"
                integerOnly
                step={1}
                min={1024}
                max={65535}
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="7891"
                prefixIcon={<Network className="w-4 h-4" />}
                required
              />
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                {isCheckingPort ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                ) : isPortAvailable === true ? (
                  <span
                    className="text-[11px] text-emerald-500 flex items-center gap-0.5"
                    title={t('addPort.portAvailableTitle')}
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    {t('addPort.portAvailable')}
                  </span>
                ) : isPortAvailable === false ? (
                  <span
                    className="text-[11px] text-rose-500 flex items-center gap-0.5"
                    title={t('addPort.portOccupiedTitle')}
                  >
                    <X className="w-3.5 h-3.5" />
                    {t('addPort.portOccupied')}
                  </span>
                ) : null}
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {t('addPort.portHint')}
            </p>
          </div>

          <div>
            <label
              htmlFor="protocol-select"
              className="block text-xs font-medium text-foreground mb-1.5"
            >
              {t('addPort.protocolLabel')}
            </label>
            <Select
              id="protocol-select"
              value={protocol}
              onChange={(val) => setProtocol(val as InboundProtocol)}
              options={[
                { value: 'mixed', label: 'Mixed (HTTP + SOCKS5)' },
                { value: 'http', label: t('addPort.protocolHttp') },
                { value: 'socks5', label: t('addPort.protocolSocks5') },
              ]}
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              {t('addPort.protocolHint')}
            </p>
          </div>
        </div>

        {/* Node Select */}
        <div>
          <label
            htmlFor="node-select"
            className="block text-xs font-medium text-foreground mb-1.5"
          >
            {isChainMode
              ? t('addPort.upstreamNodeLabel')
              : t('addPort.bindNodeLabel')}{' '}
            <span className="text-destructive">*</span>
          </label>
          <SpeedSelect
            id="node-select"
            value={selectedNode ? selectedNode.uniqueKey : ''}
            onChange={(val) => {
              const key = String(val)
              const found = allAvailableNodes.find((n) => n.uniqueKey === key)
              if (found) {
                setSelectedProfileId(found.profileId)
                setSelectedNodeName(found.name)
                // Reset fallback if region changed or conflicts with new main
                if (fallbackNodeName && fallbackProfileId) {
                  const nextRegion = extractRegion(found.name)
                  const currentFbRegion = extractRegion(fallbackNodeName)
                  if (
                    (found.name === fallbackNodeName &&
                      found.profileId === fallbackProfileId) ||
                    nextRegion.code !== currentFbRegion.code
                  ) {
                    setFallbackNodeName('')
                    setFallbackProfileId('')
                  }
                }
              } else {
                setSelectedProfileId('')
                setSelectedNodeName('')
                setFallbackNodeName('')
                setFallbackProfileId('')
              }
            }}
            options={nodeOptions}
            placeholder={
              allAvailableNodes.length === 0
                ? t('addPort.noNodesPlaceholder')
                : isChainMode
                  ? t('addPort.selectUpstreamPlaceholder')
                  : t('addPort.selectNodePlaceholder')
            }
            prefixIcon={<Radio className="w-3.5 h-3.5 text-primary" />}
            testOption={handleTestNodeOption}
            testOptions={handleTestNodeOptions}
            isTesting={isTestingAll}
            testingValues={nodeTestingValues}
            renderOptionStatus={(option) => {
              const boundPort = boundNodeMap.get(option.value)
              const chainPort = chainUpstreamMap.get(option.value)
              return (
                <>
                  {chainPort && (
                    <Badge
                      variant="secondary"
                      size="sm"
                      className="!text-[10px] !py-0.5 !px-1.5"
                    >
                      {t('addPort.upstreamTag', { port: chainPort })}
                    </Badge>
                  )}
                  {boundPort && (
                    <Badge
                      variant="outline"
                      size="sm"
                      className="!text-[10px] !py-0.5 !px-1.5"
                    >
                      {t('addPort.occupiedTag', { port: boundPort })}
                    </Badge>
                  )}
                </>
              )
            }}
          />
          <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
            {isChainMode
              ? t('addPort.upstreamHint')
              : t('addPort.nodeSearchHint')}
          </p>
        </div>

        {/* Residential Exit Select */}
        <div>
          <label
            htmlFor="residential-select"
            className="block text-xs font-medium text-foreground mb-1.5"
          >
            {t('addPort.residentialLabel')}
          </label>
          <SpeedSelect
            id="residential-select"
            value={selectedResidentialProxyId}
            onChange={(val) => handleResidentialChange(String(val))}
            options={residentialOptions}
            placeholder={
              residentialProxies.length === 0
                ? t('addPort.noResidentialConfigured')
                : t('addPort.selectResidentialPlaceholder')
            }
            prefixIcon={<Building2 className="w-3.5 h-3.5 text-primary" />}
            clearable={Boolean(selectedResidentialProxyId)}
            onClear={() => handleResidentialChange('')}
            testOption={handleTestResidentialOption}
            testOptions={handleTestResidentialOptions}
            isTesting={
              residentialBatchTesting ||
              Object.keys(residentialTesting).length > 0
            }
            testingValues={residentialSelectTestingValues}
          />
          <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
            {residentialProxies.length === 0
              ? t('addPort.residentialEmptyHint')
              : t('addPort.residentialChainHint')}
          </p>
          {residentialConfigError && (
            <div className="flex items-center gap-1.5 mt-1 text-[10px] text-destructive">
              <AlertCircle className="w-3 h-3 shrink-0" />
              <span className="min-w-0">{residentialConfigError}</span>
              <button
                type="button"
                onClick={() => setConfigReloadToken((value) => value + 1)}
                className="shrink-0 underline underline-offset-2 hover:opacity-80"
              >
                {t('common.retry')}
              </button>
            </div>
          )}
          {!residentialConfigError && residentialTestError && (
            <div className="flex items-center gap-1.5 mt-1 text-[10px] text-destructive">
              <AlertCircle className="w-3 h-3 shrink-0" />
              <span className="min-w-0">{residentialTestError}</span>
            </div>
          )}
          {!residentialConfigError &&
            !residentialTestError &&
            residentialProxies.length > 0 &&
            !selectedNode && (
              <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400 leading-relaxed">
                {t('residentialI18n.test.selectFirst')}
              </p>
            )}
        </div>

        {/* Chain Overview Card */}
        {isChainMode && selectedNode && (
          <div className="p-3 rounded-lg border border-sky-500/30 bg-sky-500/5 space-y-2 text-xs">
            <div className="flex items-center gap-1.5 min-w-0">
              <Radio className="w-3.5 h-3.5 text-primary shrink-0" />
              <span
                className="font-medium text-foreground truncate"
                title={selectedNode.name}
              >
                {selectedNode.name}
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <Building2 className="w-3.5 h-3.5 text-sky-500 shrink-0" />
              <span
                className={`font-semibold truncate ${
                  selectedResidentialProxy
                    ? 'text-foreground'
                    : 'text-destructive'
                }`}
                title={
                  selectedResidentialProxy
                    ? selectedResidentialProxy.name
                    : t('addPort.residentialMissing')
                }
              >
                {selectedResidentialProxy
                  ? selectedResidentialProxy.name
                  : t('addPort.residentialMissing')}
              </span>
              <Badge
                variant={selectedResidentialProxy ? 'primary' : 'danger'}
                size="sm"
                className="ml-auto shrink-0"
              >
                {selectedResidentialProxy
                  ? t('addPort.residentialChainBadge', {
                      protocol: selectedResidentialProxy.protocol.toUpperCase(),
                    })
                  : t('addPort.chainWillReject')}
              </Badge>
            </div>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              {t('addPort.chainStrictDesc')}
            </p>
            {initialMapping &&
              ((initialMapping.rules?.length ?? 0) > 0 ||
                Boolean(initialMapping.fallbackNodeName)) && (
                <p className="text-[10px] leading-relaxed text-amber-600 dark:text-amber-400">
                  {t('addPort.willClearOnSave')}
                  {initialMapping?.rules?.length
                    ? t('addPort.clearRulesCount', {
                        count: initialMapping.rules.length,
                      })
                    : ''}
                  {initialMapping?.rules?.length &&
                  initialMapping.fallbackNodeName
                    ? t('addPort.and')
                    : ''}
                  {initialMapping?.fallbackNodeName
                    ? t('addPort.clearExistingFallback')
                    : ''}
                </p>
              )}
          </div>
        )}

        {/* Same-region Fallback Node Select - directly below main node select */}
        {selectedNode && !isChainMode && (
          <div className="pt-1">
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="fallback-select"
                className="text-xs font-medium text-foreground flex items-center gap-1.5"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                {t('addPort.fallbackLabel')}
              </label>
              {selectedNodeRegion && (
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <RegionFlag code={selectedNodeRegion.code} size="sm" />
                  {t('addPort.fallbackRegionLimit', {
                    region: formatRegionName(
                      selectedNodeRegion.code,
                      selectedNodeRegion.name,
                    ),
                  })}
                </span>
              )}
            </div>

            {fallbackNodeOptions.length <= 1 ? (
              <div className="p-2.5 rounded-lg border border-dashed border-border text-[11px] text-muted-foreground bg-muted/20">
                {t('addPort.noFallbackInRegion', {
                  region: selectedNodeRegion
                    ? formatRegionName(
                        selectedNodeRegion.code,
                        selectedNodeRegion.name,
                      )
                    : t('addPort.thisRegion'),
                })}
              </div>
            ) : (
              <>
                <SpeedSelect
                  id="fallback-select"
                  value={
                    selectedFallbackNode ? selectedFallbackNode.uniqueKey : ''
                  }
                  onChange={(val) => {
                    const key = String(val)
                    if (!key) {
                      setFallbackProfileId('')
                      setFallbackNodeName('')
                      return
                    }
                    const found = allAvailableNodes.find(
                      (n) => n.uniqueKey === key,
                    )
                    if (found) {
                      setFallbackProfileId(found.profileId)
                      setFallbackNodeName(found.name)
                    } else {
                      setFallbackProfileId('')
                      setFallbackNodeName('')
                    }
                  }}
                  options={fallbackNodeOptions}
                  placeholder={t('addPort.selectFallbackPlaceholder')}
                  prefixIcon={
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                  }
                  testOption={handleTestNodeOption}
                  testOptions={handleTestNodeOptions}
                  isTesting={isTestingAll}
                  testingValues={nodeTestingValues}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  {t('addPort.fallbackHint')}
                </p>
              </>
            )}
          </div>
        )}

        {/* Node Information Card (Below both selects, showing protocol full name and latency) */}
        {selectedNode && mainProtocolProps && (
          <div className="p-3 rounded-lg bg-secondary/40 border border-border space-y-2 text-xs">
            {/* Main Node */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                {(selectedFallbackNode || isChainMode) && (
                  <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-primary/10 text-primary font-medium shrink-0">
                    {isChainMode
                      ? t('ports.upstreamLabel')
                      : t('addPort.primaryShort')}
                  </span>
                )}
                <RegionFlag
                  code={extractRegion(selectedNode.name).code}
                  size="sm"
                />
                <span
                  className="font-medium text-foreground truncate"
                  title={selectedNode.name}
                >
                  {selectedNode.name}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-medium border ${mainProtocolProps.className}`}
                >
                  {mainProtocolProps.label}
                </span>
                <Badge
                  variant={mainLatencyProps.variant}
                  size="sm"
                  dot={mainLatencyProps.dot}
                  className="!text-[10px] !py-0.5 !px-1.5 font-mono"
                >
                  {mainLatencyProps.label}
                </Badge>
                {selectedFallbackNode &&
                  !isChainMode &&
                  (() => {
                    const swapBlockedPort = boundNodeMap.get(
                      selectedFallbackNode.uniqueKey,
                    )
                    return (
                      <button
                        type="button"
                        disabled={Boolean(swapBlockedPort)}
                        onClick={() => {
                          if (swapBlockedPort) return
                          const prevProfileId = selectedProfileId
                          const prevNodeName = selectedNodeName
                          setSelectedProfileId(selectedFallbackNode.profileId)
                          setSelectedNodeName(selectedFallbackNode.name)
                          setFallbackProfileId(prevProfileId)
                          setFallbackNodeName(prevNodeName)
                        }}
                        className="inline-flex items-center justify-center w-6 h-6 rounded-md border border-border/70 bg-background/60 text-muted-foreground hover:text-primary hover:border-primary/50 hover:bg-primary/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        title={
                          swapBlockedPort
                            ? t('addPort.swapBoundWarning', {
                                node: selectedFallbackNode.name,
                                port: swapBlockedPort,
                              })
                            : t('addPort.swapPrimaryFallbackTitle')
                        }
                        aria-label={t('addPort.swapPrimaryFallbackTitle')}
                      >
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    )
                  })()}
              </div>
            </div>

            {/* Fallback Node */}
            {selectedFallbackNode && fbProtocolProps && fbLatencyProps && (
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/50">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-emerald-500/10 text-emerald-500 font-medium shrink-0">
                    {t('addPort.fallbackShort')}
                  </span>
                  <RegionFlag
                    code={extractRegion(selectedFallbackNode.name).code}
                    size="sm"
                  />
                  <span
                    className="font-medium text-foreground truncate"
                    title={selectedFallbackNode.name}
                  >
                    {selectedFallbackNode.name}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-medium border ${fbProtocolProps.className}`}
                  >
                    {fbProtocolProps.label}
                  </span>
                  <Badge
                    variant={fbLatencyProps.variant}
                    size="sm"
                    dot={fbLatencyProps.dot}
                    className="!text-[10px] !py-0.5 !px-1.5 font-mono"
                  >
                    {fbLatencyProps.label}
                  </Badge>
                </div>
              </div>
            )}
          </div>
        )}
        {/* Bypass CN Switch */}
        <div className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-border bg-secondary/20">
          <div className="min-w-0">
            <label
              htmlFor="bypass-cn-switch"
              className={`text-xs font-medium text-foreground ${
                isChainMode ? 'cursor-not-allowed' : 'cursor-pointer'
              }`}
            >
              {t('addPort.bypassCnTitle')}
            </label>
            <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
              {isChainMode
                ? t('addPort.bypassCnChainDisabled')
                : t('addPort.bypassCnDesc')}
            </p>
          </div>
          <Switch
            id="bypass-cn-switch"
            checked={isChainMode ? false : bypassCn}
            onChange={setBypassCn}
            disabled={isChainMode}
            size="sm"
          />
        </div>
        {/* Description Input */}
        <div>
          <label
            htmlFor="desc-input"
            className="block text-xs font-medium text-foreground mb-1.5"
          >
            {t('addPort.descriptionLabel')}
          </label>
          <Input
            id="desc-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('addPort.descriptionPlaceholder')}
          />
        </div>
      </form>
    </Modal>
  )
}
