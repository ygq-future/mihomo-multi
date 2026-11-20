import {
  AlertTriangle,
  ArrowUpDown,
  Building2,
  Copy,
  Edit2,
  Globe,
  GripVertical,
  Loader2,
  Network,
  Plus,
  Power,
  Shield,
  ShieldCheck,
  Split,
  Terminal,
  Trash2,
  Wrench,
  Zap,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  DEFAULT_TIMEOUT_MS,
  FALLBACK_STATUS_POLL_INTERVAL_MS,
  FIXED_DIRECT_PORT_ID,
} from '../../constants'
import { useTranslation } from '../../i18n'
import * as api from '../../services/tauri'
import { useWindowVisibility } from '../../services/useWindowVisibility'
import { useAppStore } from '../../stores/appStore'
import type {
  DirectEgressInfo,
  InboundProtocol,
  LanIpInfo,
  PortDriftReport,
  PortMapping,
  ProfileItem,
} from '../../types'
import {
  extractRegion,
  getLatencyBadgeProps,
  isNodeEgressProbing,
  lookupNodeEgressInfo,
} from '../../utils/proxy'
import {
  Badge,
  Button,
  HoverStepSlider,
  Modal,
  RegionFlag,
  Select,
  toast,
} from '../common'
import { AddPortModal } from '../ports/AddPortModal'
import { EditDirectPortModal } from '../ports/EditDirectPortModal'
import { PortRulesModal } from '../ports/PortRulesModal'
import { QuickCopyMenu } from '../ports/QuickCopyMenu'
import { ProfileBadgeTooltip } from '../profiles/ProfileBadgeTooltip'

const DIRECT_EGRESS_CACHE_KEY = 'mihomo_direct_egress_cache'

// Persisted by the backend when the fixed DIRECT listener is created; only the
// untouched default is re-rendered in the active language.
const BUILTIN_DIRECT_DESCRIPTION = '直连监听 (直通流量不走代理)'

function loadCachedDirectEgress(): DirectEgressInfo | null {
  try {
    const raw = localStorage.getItem(DIRECT_EGRESS_CACHE_KEY)
    if (raw) return JSON.parse(raw) as DirectEgressInfo
  } catch {
    // Ignore JSON parsing or localStorage access errors
  }
  return null
}

function saveCachedDirectEgress(info: DirectEgressInfo) {
  try {
    localStorage.setItem(DIRECT_EGRESS_CACHE_KEY, JSON.stringify(info))
  } catch {
    // Ignore localStorage storage quota errors
  }
}

export const PortTableView: React.FC = () => {
  const { t } = useTranslation()
  const formatLatencyLabel = useCallback(
    (
      value: number | null | undefined,
      isTestingValue: boolean,
      compact = true,
    ) => {
      if (isTestingValue) return t('ports.latencyTesting')
      if (value === undefined) return compact ? '--' : t('ports.untested')
      if (value === null) return t('ports.latencyTimeout')
      return compact ? String(value) : `${value} ms`
    },
    [t],
  )
  const {
    coreStatus,
    config,
    fetchConfig,
    saveConfig,
    setSystemProxy,
    setEnvProxy,
    tunStatus,
    setTun,
    restartAsAdmin,
    portMappings,
    occupiedPorts,
    driftReports,
    testingPortIds,
    isTestingAllPorts,
    fetchPortMappings,
    deletePortMapping,
    togglePortMapping,
    toggleManualFallback,
    swapPortFallback,
    testPortDelay,
    testPortFallbackDelay,
    testAllPortsDelay,
    fetchStatus,
    profiles,
    fetchProfiles,
    profileNodes,
    fetchProfileNodes,
    latencies,
    testingFbPortIds,
    fallbackStatuses,
    fetchFallbackStatuses,
    nodeEgressIps,
    probingEgressNodeKeys,
    probeNodeEgressIp,
    portEgressIps,
    probingPortEgress,
    probePortEgressIp,
  } = useAppStore()
  const isRunning = coreStatus?.running ?? false
  const hasFallback = portMappings.some(
    (mapping) => mapping.enabled && mapping.fallbackNodeName,
  )

  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [editingMapping, setEditingMapping] = useState<PortMapping | null>(null)
  const [deletingMapping, setDeletingMapping] = useState<PortMapping | null>(
    null,
  )
  const [isDeleting, setIsDeleting] = useState(false)
  const [togglingPortIds, setTogglingPortIds] = useState<
    Record<string, boolean>
  >({})
  const [directEgressInfo, setDirectEgressInfo] =
    useState<DirectEgressInfo | null>(loadCachedDirectEgress)
  const [isProbingDirect, setIsProbingDirect] = useState(false)
  const [isEditDirectModalOpen, setIsEditDirectModalOpen] = useState(false)
  const [directMappingForEdit, setDirectMappingForEdit] =
    useState<PortMapping | null>(null)
  const [rulesMapping, setRulesMapping] = useState<PortMapping | null>(null)
  const [rulesModalMode, setRulesModalMode] = useState<'port' | 'global'>(
    'port',
  )
  const [isRulesModalOpen, setIsRulesModalOpen] = useState(false)
  const [isEgressLoading, setIsEgressLoading] = useState(false)
  const [swappingPortIds, setSwappingPortIds] = useState<
    Record<string, boolean>
  >({})
  const [recentlySwappedIds, setRecentlySwappedIds] = useState<
    Record<string, boolean>
  >({})
  const [fallbackDrag, setFallbackDrag] = useState<{
    mappingId: string
    dx: number
    dy: number
    isOverPrimary: boolean
  } | null>(null)
  const primaryRowRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const fallbackRowRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const pendingSwapAnimRef = useRef<
    Record<
      string,
      {
        primaryStartX: number
        primaryStartY: number
        fallbackStartX: number
        fallbackStartY: number
      }
    >
  >({})
  const swapCleanupTimersRef = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({})
  const swapHighlightTimersRef = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({})
  const justDraggedRef = useRef<Record<string, number>>({})
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const handleProbeDirectEgress = useCallback(
    async (port?: number | null, isManual = false) => {
      setIsProbingDirect(true)
      try {
        const info = await api.queryDirectEgressInfo(port)
        setDirectEgressInfo(info)
        saveCachedDirectEgress(info)
        if (isManual) {
          toast.success(
            t('ports.egressDetectDone', {
              ip: info.ip,
              region: info.region || t('common.unknown'),
            }),
          )
        }
        return info
      } catch (err) {
        if (isManual) {
          toast.error(
            t('ports.egressDetectFail', {
              err: err instanceof Error ? err.message : String(err),
            }),
          )
        }
        return null
      } finally {
        setIsProbingDirect(false)
      }
    },
    [t],
  )

  const handleCopyNodeEgressIp = useCallback(
    async (
      nodeName: string,
      profileId?: string | null,
      runtimeKey?: string,
      label = t('ports.nodeLabel'),
      forceRefresh = false,
    ) => {
      const cacheKey =
        runtimeKey || (profileId ? `${profileId}_${nodeName}` : nodeName)
      const cached = lookupNodeEgressInfo(
        nodeEgressIps,
        nodeName,
        profileId,
        cacheKey,
      )
      if (cached && !forceRefresh) {
        await navigator.clipboard.writeText(cached.ip).catch(() => {})
        toast.success(
          t('ports.copiedNodeEgress', {
            label,
            ip: cached.ip,
            region: cached.region ? ` (${cached.region})` : '',
          }),
        )
        return
      }

      try {
        const info = await probeNodeEgressIp(nodeName, profileId, cacheKey)
        await navigator.clipboard.writeText(info.ip).catch(() => {})
        toast.success(
          t('ports.copiedNodeEgress', {
            label,
            ip: info.ip,
            region: info.region ? ` (${info.region})` : '',
          }),
        )
      } catch (err) {
        toast.error(
          t('ports.probeNodeEgressFail', {
            label,
            err: err instanceof Error ? err.message : String(err),
          }),
        )
      }
    },
    [nodeEgressIps, probeNodeEgressIp, t],
  )

  const handleCopyDirectEgressIp = useCallback(
    async (port?: number | null, forceRefresh = false) => {
      if (directEgressInfo && !forceRefresh) {
        await navigator.clipboard.writeText(directEgressInfo.ip).catch(() => {})
        toast.success(
          t('ports.copiedDirectEgress', {
            ip: directEgressInfo.ip,
            region: directEgressInfo.region
              ? ` (${directEgressInfo.region})`
              : '',
          }),
        )
        return
      }
      const info = await handleProbeDirectEgress(port, false)
      if (info) {
        await navigator.clipboard.writeText(info.ip).catch(() => {})
        toast.success(
          t('ports.copiedDirectEgress', {
            ip: info.ip,
            region: info.region ? ` (${info.region})` : '',
          }),
        )
      } else {
        toast.error(t('ports.directEgressFail'))
      }
    },
    [directEgressInfo, handleProbeDirectEgress, t],
  )

  const handleCopyChainEgressIp = useCallback(
    async (port: number, protocol: InboundProtocol) => {
      try {
        const info = await probePortEgressIp(port, protocol)
        try {
          await navigator.clipboard.writeText(info.ip)
          toast.success(
            t('ports.copiedChainEgress', {
              ip: info.ip,
              region: info.region ? ` (${info.region})` : '',
            }),
          )
        } catch {
          toast.error(t('ports.copyClipboardFail'))
        }
      } catch (err) {
        toast.error(
          t('ports.chainEgressFail', {
            err: err instanceof Error ? err.message : String(err),
          }),
        )
      }
    },
    [probePortEgressIp, t],
  )

  // Auto-probe on first mount if no cache exists
  useEffect(() => {
    if (!directEgressInfo) {
      const direct = portMappings.find(
        (m) => m.id === FIXED_DIRECT_PORT_ID || m.nodeName === 'DIRECT',
      )
      const portToProbe = direct && direct.enabled ? direct.port : null
      void handleProbeDirectEgress(portToProbe, false)
    }
  }, [directEgressInfo, portMappings, handleProbeDirectEgress])

  // LAN IPs state for allow_lan mode
  const [lanIps, setLanIps] = useState<LanIpInfo[]>([])

  useEffect(() => {
    fetchPortMappings().catch(() => {})
    fetchProfiles().catch(() => {})
    if (!config) {
      fetchConfig().catch(() => {})
    }
  }, [fetchPortMappings, fetchProfiles, config, fetchConfig])

  const isWindowVisible = useWindowVisibility()

  // Wait five seconds after each completed refresh while fallback ports are active,
  // and pause polling completely when the window is hidden/minimized to tray.
  useEffect(() => {
    if (!isRunning || !hasFallback || !isWindowVisible) return

    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      await fetchFallbackStatuses().catch(() => {})
      if (!disposed) {
        timer = setTimeout(refresh, FALLBACK_STATUS_POLL_INTERVAL_MS)
      }
    }

    void refresh()

    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [isRunning, hasFallback, isWindowVisible, fetchFallbackStatuses])

  // Fetch LAN IPs and perform auto-cleaning of invalid selected IP when allow_lan is active
  useEffect(() => {
    if (!config?.allowLan) return

    let isMounted = true
    api
      .getLanIpAddresses()
      .then(async (ips) => {
        if (!isMounted) return
        setLanIps(ips)

        const savedIp = config.selectedLanIp
        if (savedIp && savedIp !== '127.0.0.1') {
          const stillExists = ips.some((item) => item.ip === savedIp)
          if (!stillExists) {
            // Selected LAN IP is no longer available on this machine/network, clean it up and fallback to 127.0.0.1
            try {
              await saveConfig({
                ...config,
                selectedLanIp: null,
              })
            } catch {
              // ignore
            }
          }
        }
      })
      .catch(() => {})

    return () => {
      isMounted = false
    }
  }, [config?.allowLan, config?.selectedLanIp, config, saveConfig])

  const activeHostIp = useMemo(() => {
    if (!config?.allowLan) {
      return '127.0.0.1'
    }
    const savedIp = config.selectedLanIp
    if (!savedIp || savedIp === '127.0.0.1') {
      return '127.0.0.1'
    }
    const exists = lanIps.some((item) => item.ip === savedIp)
    return exists ? savedIp : '127.0.0.1'
  }, [config?.allowLan, config?.selectedLanIp, lanIps])

  const handleLanIpChange = async (val: string) => {
    if (!config) return
    const newIp = val === '127.0.0.1' ? null : val
    try {
      await saveConfig({
        ...config,
        selectedLanIp: newIp,
      })
      toast.success(t('ports.quickCopyIpSet', { ip: val }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const lanIpOptions = useMemo(() => {
    const options = [
      {
        value: '127.0.0.1',
        label: t('ports.loopbackOption'),
      },
    ]
    for (const item of lanIps) {
      options.push({
        value: item.ip,
        label: `${item.ip} (${item.name})`,
      })
    }
    return options
  }, [lanIps, t])

  // Load nodes for all profiles involved in port mappings
  useEffect(() => {
    for (const mapping of portMappings) {
      if (mapping.profileId && !profileNodes[mapping.profileId]) {
        fetchProfileNodes(mapping.profileId).catch(() => {})
      }
    }
  }, [portMappings, profileNodes, fetchProfileNodes])

  // Drift map for easy lookup
  const driftMap = useMemo(() => {
    const map: Record<string, PortDriftReport> = {}
    for (const r of driftReports) {
      map[r.mappingId] = r
    }
    return map
  }, [driftReports])

  // Profile maps for easy name and metadata lookup
  const profileById = useMemo(() => {
    const map: Record<string, ProfileItem> = {}
    for (const p of profiles) {
      map[p.id] = p
    }
    return map
  }, [profiles])

  // Sorted port mappings (Fixed direct card is always index 0, others ascending by port number)
  const sortedMappings = useMemo(() => {
    const direct = portMappings.find(
      (m) => m.id === FIXED_DIRECT_PORT_ID || m.nodeName === 'DIRECT',
    )
    const others = portMappings
      .filter((m) => m.id !== FIXED_DIRECT_PORT_ID && m.nodeName !== 'DIRECT')
      .sort((a, b) => a.port - b.port)
    return direct ? [direct, ...others] : others
  }, [portMappings])

  const enabledPorts = useMemo(() => {
    return portMappings.filter((m) => m.enabled).sort((a, b) => a.port - b.port)
  }, [portMappings])

  const totalPorts = portMappings.length
  const activePorts = enabledPorts.length
  type PortState = 'disabled' | 'enabled' | 'systemProxy'
  const isEnvProxyEnabled = Boolean(config?.envProxyEnabled)
  const activeEnvProxyPort = config?.envProxyPort ?? null
  const [isEnvProxyLoading, setIsEnvProxyLoading] = useState(false)
  const proxyEnabledPorts = useMemo(() => {
    return enabledPorts.filter(
      (m) => m.id !== FIXED_DIRECT_PORT_ID && m.nodeName !== 'DIRECT',
    )
  }, [enabledPorts])

  const getResidentialProxy = useCallback(
    (mapping: PortMapping) =>
      mapping.residentialProxyId
        ? (config?.residentialProxies?.find(
            (proxy) => proxy.id === mapping.residentialProxyId,
          ) ?? null)
        : null,
    [config],
  )

  const egressPortOptions = useMemo(() => {
    return proxyEnabledPorts.map((m) => {
      const exit = getResidentialProxy(m)
      const region = extractRegion(exit?.name ?? m.nodeName)
      return {
        value: String(m.port),
        label: exit ? `${exit.name} ${m.port}` : `${region.name} ${m.port}`,
        icon: exit ? (
          <Building2 className="w-3.5 h-3.5 text-sky-500" />
        ) : (
          <RegionFlag code={region.code} size="sm" />
        ),
      }
    })
  }, [proxyEnabledPorts, getResidentialProxy])

  const envProxyOptions = useMemo(() => {
    return [
      {
        value: 'off',
        label: t('ports.takeoverOff'),
      },
      ...proxyEnabledPorts.map((m) => {
        const exit = getResidentialProxy(m)
        const region = extractRegion(exit?.name ?? m.nodeName)
        return {
          value: String(m.port),
          label: exit ? `${exit.name} ${m.port}` : `${region.name} ${m.port}`,
          icon: exit ? (
            <Building2 className="w-3.5 h-3.5 text-sky-500" />
          ) : (
            <RegionFlag code={region.code} size="sm" />
          ),
        }
      }),
    ]
  }, [proxyEnabledPorts, getResidentialProxy, t])

  const handleToggleEnvProxyForPort = useCallback(
    async (targetPort: number) => {
      setIsEnvProxyLoading(true)
      try {
        if (isEnvProxyEnabled && activeEnvProxyPort === targetPort) {
          await setEnvProxy(false)
          toast.success(t('ports.envProxyUnbound', { port: targetPort }))
        } else {
          await setEnvProxy(true, targetPort)
          toast.success(t('ports.envProxyBound', { port: targetPort }))
        }
        await fetchConfig()
        fetchStatus().catch(() => {})
      } catch (err) {
        toast.error(
          t('ports.envProxyFail', {
            err: err instanceof Error ? err.message : String(err),
          }),
        )
      } finally {
        setIsEnvProxyLoading(false)
      }
    },
    [
      t,
      isEnvProxyEnabled,
      activeEnvProxyPort,
      setEnvProxy,
      fetchConfig,
      fetchStatus,
    ],
  )

  const [pendingPortStates, setPendingPortStates] = useState<
    Record<string, PortState>
  >({})

  const handlePortStateChange = async (m: PortMapping, newState: PortState) => {
    setTogglingPortIds((prev) => ({ ...prev, [m.id]: true }))
    setPendingPortStates((prev) => ({ ...prev, [m.id]: newState }))
    try {
      const isDirectCard =
        m.id === FIXED_DIRECT_PORT_ID || m.nodeName === 'DIRECT'
      if (isDirectCard && newState === 'systemProxy') {
        toast.warning(t('ports.directNoSysProxy'))
        return
      }

      const isSysProxy =
        config?.systemProxyEnabled && config?.systemProxyPort === m.port

      if (newState === 'disabled') {
        if (isSysProxy) {
          await setSystemProxy(false)
        }
        if (m.enabled) {
          await togglePortMapping(m.id, false)
        }
        await fetchConfig()
        fetchStatus().catch(() => {})
        if (isSysProxy) {
          toast.success(t('ports.portDisabledWithSysProxy', { port: m.port }))
        } else {
          toast.success(t('ports.portDisabled', { port: m.port }))
        }
      } else if (newState === 'enabled') {
        if (isSysProxy) {
          await setSystemProxy(false)
          toast.success(t('ports.portSysProxyUnbound', { port: m.port }))
        } else if (!m.enabled) {
          await togglePortMapping(m.id, true)
          toast.success(t('ports.portEnabled', { port: m.port }))
          if (isDirectCard) {
            void handleProbeDirectEgress(m.port, false)
          }
        }
        await fetchConfig()
        fetchStatus().catch(() => {})
      } else if (newState === 'systemProxy') {
        if (!m.enabled) {
          await togglePortMapping(m.id, true)
        }
        await setSystemProxy(true, m.port)
        await fetchConfig()
        fetchStatus().catch(() => {})
        if (config?.systemProxySyncEnv ?? true) {
          toast.success(t('ports.portSysProxySetWithEnv', { port: m.port }))
        } else {
          toast.success(t('ports.portSysProxySet', { port: m.port }))
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setTogglingPortIds((prev) => ({ ...prev, [m.id]: false }))
      setPendingPortStates((prev) => {
        const next = { ...prev }
        delete next[m.id]
        return next
      })
    }
  }
  const handleDeleteConfirm = async () => {
    if (!deletingMapping) return
    setIsDeleting(true)
    try {
      const isSysProxy =
        config?.systemProxyEnabled &&
        config?.systemProxyPort === deletingMapping.port
      if (isSysProxy) {
        await setSystemProxy(false)
      }
      await deletePortMapping(deletingMapping.id)
      await fetchConfig()
      fetchStatus().catch(() => {})
      if (isSysProxy) {
        toast.success(
          t('ports.portDeletedWithSysProxy', { port: deletingMapping.port }),
        )
      } else {
        toast.success(t('ports.portDeleted', { port: deletingMapping.port }))
      }
      setDeletingMapping(null)
    } catch {
      // Error handled in store
    } finally {
      setIsDeleting(false)
    }
  }

  const handleSingleDelayTest = async (id: string, port: number) => {
    const latency = await testPortDelay(id)
    if (latency !== null && latency !== undefined) {
      toast.success(t('ports.latencyDone', { port, latency }))
    }
  }

  const handleSingleFallbackDelayTest = async (id: string, port: number) => {
    const latency = await testPortFallbackDelay(id)
    if (latency !== null && latency !== undefined) {
      toast.success(t('ports.fallbackLatencyDone', { port, latency }))
    }
  }

  const handleToggleManualFallback = async (
    id: string,
    currentManual: boolean,
  ) => {
    try {
      const nextManual = !currentManual
      await toggleManualFallback(id, nextManual)
      if (nextManual) {
        toast.success(t('ports.manualFallbackOn'))
      } else {
        toast.info(t('ports.manualFallbackOff'))
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('ports.manualFallbackFail'),
      )
    }
  }

  const handleSwapPrimaryFallback = useCallback(
    async (
      m: PortMapping,
      options?: {
        fromDrag?: {
          dx: number
          dy: number
          deltaY: number
          primaryShiftY: number
        }
      },
    ) => {
      if (
        !m.fallbackNodeName ||
        m.residentialProxyId ||
        swappingPortIds[m.id]
      ) {
        return
      }

      const targetProfileId = m.fallbackProfileId?.trim() || m.profileId
      const targetNodeName = m.fallbackNodeName
      const conflict = portMappings.find(
        (other) =>
          other.id !== m.id &&
          !other.residentialProxyId &&
          other.profileId === targetProfileId &&
          other.nodeName === targetNodeName,
      )
      if (conflict) {
        toast.error(
          t('ports.swapDuplicateNodeErr', {
            node: targetNodeName,
            port: conflict.port,
          }),
        )
        return
      }

      const prefersReducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

      if (!prefersReducedMotion) {
        if (options?.fromDrag) {
          const { dx, dy, deltaY, primaryShiftY } = options.fromDrag
          pendingSwapAnimRef.current[m.id] = {
            primaryStartX: dx,
            primaryStartY: deltaY + dy,
            fallbackStartX: 0,
            fallbackStartY: -deltaY + primaryShiftY,
          }
        } else {
          const pEl = primaryRowRefs.current[m.id]
          const fEl = fallbackRowRefs.current[m.id]
          if (pEl && fEl) {
            const deltaY =
              fEl.getBoundingClientRect().top - pEl.getBoundingClientRect().top
            if (Math.abs(deltaY) > 1) {
              pendingSwapAnimRef.current[m.id] = {
                primaryStartX: 0,
                primaryStartY: deltaY,
                fallbackStartX: 0,
                fallbackStartY: -deltaY,
              }
            }
          }
        }
      }

      setSwappingPortIds((prev) => ({ ...prev, [m.id]: true }))
      setRecentlySwappedIds((prev) => ({ ...prev, [m.id]: true }))
      clearTimeout(swapHighlightTimersRef.current[m.id])
      swapHighlightTimersRef.current[m.id] = setTimeout(() => {
        setRecentlySwappedIds((prev) => {
          const next = { ...prev }
          delete next[m.id]
          return next
        })
        delete swapHighlightTimersRef.current[m.id]
      }, 550)

      try {
        const updated = await swapPortFallback(m.id)
        toast.success(
          t('ports.swapSuccess', {
            port: updated.port,
            primary: updated.nodeName,
            fallback: updated.fallbackNodeName ?? '',
          }),
        )
      } catch (err) {
        delete pendingSwapAnimRef.current[m.id]
        toast.error(
          t('ports.swapFail', {
            err: err instanceof Error ? err.message : String(err),
          }),
        )
      } finally {
        setSwappingPortIds((prev) => ({ ...prev, [m.id]: false }))
      }
    },
    [portMappings, swappingPortIds, swapPortFallback, t],
  )

  useEffect(() => {
    const cleanupTimers = swapCleanupTimersRef.current
    const highlightTimers = swapHighlightTimersRef.current
    return () => {
      dragCleanupRef.current?.()
      for (const timer of Object.values(cleanupTimers)) {
        clearTimeout(timer)
      }
      for (const timer of Object.values(highlightTimers)) {
        clearTimeout(timer)
      }
    }
  }, [])

  const startFallbackDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, m: PortMapping) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return
      if (swappingPortIds[m.id]) return
      const target = e.target as HTMLElement | null
      if (target?.closest('[data-no-drag="true"]')) return

      const pEl = primaryRowRefs.current[m.id]
      const fEl = fallbackRowRefs.current[m.id]
      if (!pEl || !fEl) return

      const primaryRect = pEl.getBoundingClientRect()
      const fallbackRect = fEl.getBoundingClientRect()
      const deltaY = fallbackRect.top - primaryRect.top
      if (deltaY <= 4) return

      dragCleanupRef.current?.()

      const pointerId = e.pointerId
      const startX = e.clientX
      const startY = e.clientY
      let active = false
      let dx = 0
      let dy = 0
      let isOverPrimary = false

      const cleanup = () => {
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
        window.removeEventListener('pointercancel', onPointerCancel)
        window.removeEventListener('blur', onPointerCancel)
        document.body.style.userSelect = ''
        document.body.style.cursor = ''
        dragCleanupRef.current = null
      }

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return
        const rawDx = moveEvent.clientX - startX
        const rawDy = moveEvent.clientY - startY
        if (!active) {
          if (Math.hypot(rawDx, rawDy) < 6) return
          active = true
          document.body.style.userSelect = 'none'
          document.body.style.cursor = 'grabbing'
        }

        dx = Math.max(-28, Math.min(28, rawDx * 0.35))
        dy = Math.max(-(deltaY + 26), Math.min(18, rawDy))

        const draggedTop = fallbackRect.top + dy
        const draggedCenterY = draggedTop + fallbackRect.height / 2
        const inHorizontalBounds =
          moveEvent.clientX >= primaryRect.left - 36 &&
          moveEvent.clientX <= primaryRect.right + 36
        const movedUpEnough = dy < -Math.max(10, deltaY * 0.35)
        const touchesPrimary =
          draggedCenterY <= primaryRect.bottom + 4 ||
          moveEvent.clientY <= primaryRect.bottom + 4
        isOverPrimary = inHorizontalBounds && movedUpEnough && touchesPrimary

        setFallbackDrag({
          mappingId: m.id,
          dx,
          dy,
          isOverPrimary,
        })
      }

      const finishDrag = (shouldSwap: boolean) => {
        cleanup()
        if (active) {
          justDraggedRef.current[m.id] = Date.now()
        }
        setFallbackDrag(null)
        if (active && shouldSwap) {
          void handleSwapPrimaryFallback(m, {
            fromDrag: {
              dx,
              dy,
              deltaY,
              primaryShiftY: 4,
            },
          })
        }
      }

      const onPointerUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) return
        finishDrag(isOverPrimary)
      }

      const onPointerCancel = () => {
        finishDrag(false)
      }

      dragCleanupRef.current = cleanup
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
      window.addEventListener('pointercancel', onPointerCancel)
      window.addEventListener('blur', onPointerCancel)
    },
    [swappingPortIds, handleSwapPrimaryFallback],
  )

  useLayoutEffect(() => {
    if (portMappings.length === 0) return
    const pendingEntries = Object.entries(pendingSwapAnimRef.current)
    if (pendingEntries.length === 0) return

    for (const [id, anim] of pendingEntries) {
      delete pendingSwapAnimRef.current[id]
      const pEl = primaryRowRefs.current[id]
      const fEl = fallbackRowRefs.current[id]
      if (!pEl || !fEl) continue

      clearTimeout(swapCleanupTimersRef.current[id])

      pEl.style.transition = 'none'
      pEl.style.transform = `translate3d(${anim.primaryStartX}px, ${anim.primaryStartY}px, 0)`
      pEl.style.zIndex = '20'

      fEl.style.transition = 'none'
      fEl.style.transform = `translate3d(${anim.fallbackStartX}px, ${anim.fallbackStartY}px, 0)`
      fEl.style.zIndex = '10'

      void pEl.offsetHeight

      requestAnimationFrame(() => {
        pEl.style.transition = 'transform 340ms cubic-bezier(0.22, 1, 0.36, 1)'
        pEl.style.transform = 'translate3d(0, 0, 0)'

        fEl.style.transition = 'transform 340ms cubic-bezier(0.22, 1, 0.36, 1)'
        fEl.style.transform = 'translate3d(0, 0, 0)'
      })

      swapCleanupTimersRef.current[id] = setTimeout(() => {
        pEl.style.transition = ''
        pEl.style.transform = ''
        pEl.style.zIndex = ''
        fEl.style.transition = ''
        fEl.style.transform = ''
        fEl.style.zIndex = ''
        delete swapCleanupTimersRef.current[id]
      }, 360)
    }
  }, [portMappings])

  const handleBatchDelayTest = async () => {
    await testAllPortsDelay()
    toast.success(t('ports.allLatencyDone'))
  }
  const isTun = config?.tunEnabled ?? false
  const isSysProxy = config?.systemProxyEnabled ?? false
  const egressSliderValue = isTun ? 2 : isSysProxy ? 1 : 0

  const activeEgressPort =
    (isTun
      ? config?.tunPort
      : isSysProxy
        ? config?.systemProxyPort
        : undefined) ??
    (config?.tunPort && enabledPorts.some((m) => m.port === config.tunPort)
      ? config.tunPort
      : config?.systemProxyPort &&
          enabledPorts.some((m) => m.port === config.systemProxyPort)
        ? config.systemProxyPort
        : enabledPorts[0]?.port)

  const handleEgressStateChange = async (level: number) => {
    const targetPort =
      activeEgressPort ??
      (config?.tunPort && enabledPorts.some((m) => m.port === config.tunPort)
        ? config.tunPort
        : config?.systemProxyPort &&
            enabledPorts.some((m) => m.port === config.systemProxyPort)
          ? config.systemProxyPort
          : enabledPorts[0]?.port)

    if (level === 0) {
      setIsEgressLoading(true)
      try {
        if (config?.tunEnabled) {
          const currentPort = config.tunPort ?? activeEgressPort
          await setTun(false, currentPort)
          toast.success(t('ports.tunDisabled'))
        }
        if (config?.systemProxyEnabled) {
          const currentPort = config.systemProxyPort ?? activeEgressPort
          await setSystemProxy(false, currentPort)
          if (config?.systemProxySyncEnv ?? true) {
            toast.success(t('ports.sysProxyDisabledWithEnv'))
          } else {
            toast.success(t('ports.sysProxyDisabled'))
          }
        }
      } catch (err) {
        toast.error(
          t('ports.takeoverDisableFail', {
            err: err instanceof Error ? err.message : String(err),
          }),
        )
      } finally {
        setIsEgressLoading(false)
      }
    } else if (level === 1) {
      if (!targetPort) {
        toast.error(t('ports.noEnabledPort'))
        return
      }
      setIsEgressLoading(true)
      try {
        await setSystemProxy(true, targetPort)
        if (config?.systemProxySyncEnv ?? true) {
          toast.success(t('ports.portSysProxySetWithEnv', { port: targetPort }))
        } else {
          toast.success(t('ports.portSysProxySet', { port: targetPort }))
        }
      } catch (err) {
        toast.error(
          t('ports.sysProxyEnableFail', {
            err: err instanceof Error ? err.message : String(err),
          }),
        )
      } finally {
        setIsEgressLoading(false)
      }
    } else if (level === 2) {
      if (!targetPort) {
        toast.error(t('ports.noEnabledPort'))
        return
      }
      setIsEgressLoading(true)
      try {
        const status = await setTun(true, targetPort)
        if (status.pendingElevation) {
          toast.info(t('ports.tunAdminRestart'))
        } else {
          toast.success(t('ports.tunEnabled', { port: targetPort }))
        }
      } catch (err) {
        toast.error(
          t('ports.tunEnableFail', {
            err: err instanceof Error ? err.message : String(err),
          }),
        )
      } finally {
        setIsEgressLoading(false)
      }
    }
  }

  const handleSelectEgressPort = async (portStr: string) => {
    const port = Number(portStr)
    if (!port) return
    setIsEgressLoading(true)
    try {
      if (config?.tunEnabled) {
        await setTun(true, port)
        toast.success(t('ports.tunPortSwitched', { port }))
      } else if (config?.systemProxyEnabled) {
        await setSystemProxy(true, port)
        toast.success(t('ports.sysProxyPortSwitched', { port }))
      } else if (config) {
        await saveConfig({
          ...config,
          systemProxyPort: port,
          tunPort: port,
        })
        toast.success(t('ports.preselectedPortSet', { port }))
      }
    } catch (err) {
      toast.error(
        t('ports.updateExitPortFail', {
          err: err instanceof Error ? err.message : String(err),
        }),
      )
    } finally {
      setIsEgressLoading(false)
    }
  }

  const handleRestartAsAdmin = async () => {
    try {
      await restartAsAdmin()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="h-full flex flex-col p-6 space-y-4 w-full overflow-hidden">
      {/* Top Sticky Single-Row Action Bar Card */}
      <div className="bg-card border border-border rounded-xl p-3 shadow-sm shrink-0 flex items-center justify-between gap-2.5 relative z-30">
        {/* Left: Egress Mode (System Proxy / TUN) Control Group & LAN IP Selector */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold shrink-0">
            {egressSliderValue === 2 ? (
              <Shield className="w-3.5 h-3.5 text-purple-500 animate-pulse" />
            ) : egressSliderValue === 1 ? (
              <Globe className="w-3.5 h-3.5 text-sky-500 animate-pulse" />
            ) : (
              <Power className="w-3.5 h-3.5 text-muted-foreground" />
            )}
            <span
              className={
                egressSliderValue === 2
                  ? 'text-purple-600 dark:text-purple-400'
                  : egressSliderValue === 1
                    ? 'text-sky-600 dark:text-sky-400'
                    : 'text-foreground'
              }
            >
              {egressSliderValue === 2
                ? t('ports.tunMode')
                : egressSliderValue === 1
                  ? t('ports.systemProxy')
                  : t('ports.takeoverDisabled')}
            </span>
          </div>

          <HoverStepSlider
            value={egressSliderValue}
            onChange={handleEgressStateChange}
            mode="egress"
            loading={isEgressLoading}
            disabled={!isRunning || enabledPorts.length === 0}
            headerTitle={t('ports.takeoverMode')}
          />

          <div className="w-36 lg:w-40 min-w-[125px] max-w-[165px] shrink-0">
            {proxyEnabledPorts.length === 0 ? (
              <span className="text-[11px] text-muted-foreground font-medium">
                {t('ports.noProxyPortAvailable')}
              </span>
            ) : (
              <Select
                value={
                  activeEgressPort &&
                  proxyEnabledPorts.some((m) => m.port === activeEgressPort)
                    ? String(activeEgressPort)
                    : String(proxyEnabledPorts[0]?.port ?? '')
                }
                onChange={(val) => handleSelectEgressPort(String(val))}
                options={egressPortOptions}
                prefixIcon={
                  <Globe
                    className={`w-3.5 h-3.5 shrink-0 ${
                      activeEgressPort
                        ? egressSliderValue === 2
                          ? 'text-purple-500 animate-pulse'
                          : 'text-sky-500 animate-pulse'
                        : 'text-muted-foreground'
                    }`}
                  />
                }
                disabled={!isRunning || proxyEnabledPorts.length === 0}
              />
            )}
          </div>

          {isTun && tunStatus?.pendingElevation && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRestartAsAdmin}
              icon={<ShieldCheck className="w-3 h-3 text-amber-500" />}
              className="text-[11px] h-7 px-2 text-amber-600 dark:text-amber-400 border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20"
              title={t('ports.needElevationTitle')}
            >
              {t('ports.needElevation')}
            </Button>
          )}
          {/* Terminal Env Proxy Select */}
          <div className="w-36 lg:w-40 min-w-[125px] max-w-[165px] shrink-0">
            <Select
              value={
                isEnvProxyEnabled && activeEnvProxyPort
                  ? String(activeEnvProxyPort)
                  : 'off'
              }
              onChange={async (val) => {
                const v = String(val)
                if (v === 'off') {
                  if (isEnvProxyEnabled) {
                    await setEnvProxy(false)
                    toast.success(t('ports.envProxyClosed'))
                    await fetchConfig()
                  }
                } else {
                  const port = Number(v)
                  await setEnvProxy(true, port)
                  toast.success(t('ports.envProxySwitched', { port }))
                  await fetchConfig()
                }
              }}
              options={envProxyOptions}
              prefixIcon={
                <Terminal
                  className={`w-3.5 h-3.5 ${
                    isEnvProxyEnabled
                      ? 'text-blue-500 animate-pulse'
                      : 'text-muted-foreground'
                  }`}
                />
              }
              disabled={!isRunning || proxyEnabledPorts.length === 0}
            />
          </div>
          {config?.allowLan && (
            <div className="w-36 lg:w-40 min-w-[110px] shrink-0">
              <Select
                value={activeHostIp}
                onChange={(val) => handleLanIpChange(String(val))}
                options={lanIpOptions}
                prefixIcon={<Network className="w-3.5 h-3.5 text-primary" />}
              />
            </div>
          )}
        </div>

        {/* Right: Batch Test + Add Port Button */}
        <div className="flex items-center gap-1.5 shrink-0">
          {activePorts > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleBatchDelayTest}
              loading={isTestingAllPorts}
              icon={<Zap className="w-3.5 h-3.5 text-amber-500" />}
              title={
                isTestingAllPorts ? t('ports.testingAll') : t('ports.testAll')
              }
              className="w-8 h-8 p-0 shrink-0"
            />
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setRulesMapping(null)
              setRulesModalMode('global')
              setIsRulesModalOpen(true)
            }}
            icon={<Split className="w-3.5 h-3.5 text-primary" />}
            title={t('ports.globalRulesTitle', {
              extra:
                (config?.globalRules || []).filter((r) => r.enabled).length > 0
                  ? t('ports.globalRulesActive', {
                      count: (config?.globalRules || []).filter(
                        (r) => r.enabled,
                      ).length,
                    })
                  : '',
            })}
            className="w-8 h-8 p-0 shrink-0 relative"
          >
            {(config?.globalRules || []).filter((r) => r.enabled).length >
              0 && (
              <span className="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-0.5 rounded-full bg-primary text-primary-foreground text-[9px] font-mono flex items-center justify-center">
                {(config?.globalRules || []).filter((r) => r.enabled).length}
              </span>
            )}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setEditingMapping(null)
              setIsAddModalOpen(true)
            }}
            icon={<Plus className="w-3.5 h-3.5" />}
            className="px-2.5"
          >
            {t('ports.addPort')}
          </Button>
        </div>
      </div>

      {/* Scrollable Port Cards Grid Area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden pr-1 pb-4">
        {totalPorts === 0 ? (
          /* Empty State Card */
          <div className="border border-dashed border-border rounded-xl p-12 flex flex-col items-center justify-center text-center space-y-4 bg-card/30">
            <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <Network className="w-6 h-6" />
            </div>
            <div className="space-y-1 max-w-sm">
              <h3 className="text-sm font-semibold text-foreground">
                {t('ports.emptyTitle')}
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t('ports.emptyDesc')}
              </p>
            </div>

            <div className="pt-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setEditingMapping(null)
                  setIsAddModalOpen(true)
                }}
                icon={<Plus className="w-3.5 h-3.5" />}
              >
                {t('ports.addFirstPort')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
            {sortedMappings.map((m) => {
              const isTesting = testingPortIds[m.id] || false
              const isDirectCard =
                m.id === FIXED_DIRECT_PORT_ID || m.nodeName === 'DIRECT'
              const residentialProxy = getResidentialProxy(m)
              const isChainPort = Boolean(m.residentialProxyId)
              const primaryProfile = profileById[m.profileId]
              const profileName =
                primaryProfile?.name || t('ports.unknownProfile')
              const drift = driftMap[m.id]
              const isDrifted = drift && drift.status !== 'healthy'
              const nodeKey = profileName
                ? `[${profileName}] ${m.nodeName}`
                : m.nodeName

              const latency = isChainPort
                ? m.latency
                : nodeKey in latencies && latencies[nodeKey] !== undefined
                  ? latencies[nodeKey]
                  : m.nodeName in latencies &&
                      latencies[m.nodeName] !== undefined
                    ? latencies[m.nodeName]
                    : m.latency
              const latencyProps = getLatencyBadgeProps(latency, isTesting)

              // User-edited descriptions stay verbatim; only the untouched
              // built-in description of the fixed DIRECT listener is localized.
              const descriptionText =
                m.id === FIXED_DIRECT_PORT_ID &&
                m.description?.trim() === BUILTIN_DIRECT_DESCRIPTION
                  ? t('directPort.defaultDesc')
                  : m.description

              // 1. Inbound listener protocol badge (Mixed / Socks5 / Http)
              const inboundBadgeVariant =
                m.protocol === 'mixed'
                  ? 'primary'
                  : m.protocol === 'socks5'
                    ? 'warning'
                    : 'secondary'

              // State warning priorities:
              // 1. Highest: Kernel Stopped Warning (Amber)
              const isStoppedWarning =
                coreStatus !== null && !isRunning && m.enabled
              // 2. Secondary: Port Occupied Conflict Warning (Rose)
              const isOccupiedWarning =
                isRunning && m.enabled && occupiedPorts.includes(m.port)
              // 3. Fallback Degraded Warning (Amber)
              const fbStatus = fallbackStatuses[m.id]
              const hasFallback = !isChainPort && Boolean(m.fallbackNodeName)
              const isManualFallback = m.manualFallback ?? false
              const isAutoFallbackActive =
                !isManualFallback &&
                Boolean(fbStatus?.isFallbackActive && !fbStatus?.manualFallback)
              const timeoutLimit = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS
              const isPrimaryTimeout =
                latency === null ||
                (typeof latency === 'number' && latency >= timeoutLimit) ||
                (isAutoFallbackActive && latency === undefined)
              const isFallbackWarning =
                isRunning && m.enabled && hasFallback && isAutoFallbackActive
              const fbProfileId = m.fallbackProfileId || m.profileId
              const fbProfile = fbProfileId
                ? profileById[fbProfileId]
                : undefined
              const fbProfileName = fbProfile?.name || profileName
              const fbNodeKey =
                fbProfileName && m.fallbackNodeName
                  ? `[${fbProfileName}] ${m.fallbackNodeName}`
                  : m.fallbackNodeName || ''
              const fbLatency = m.fallbackNodeName
                ? fbNodeKey in latencies && latencies[fbNodeKey] !== undefined
                  ? latencies[fbNodeKey]
                  : m.fallbackNodeName in latencies &&
                      latencies[m.fallbackNodeName] !== undefined
                    ? latencies[m.fallbackNodeName]
                    : undefined
                : undefined
              const isTestingFb =
                testingFbPortIds[m.id] || isTestingAllPorts || false
              const fbLatencyProps = getLatencyBadgeProps(
                fbLatency,
                isTestingFb,
              )
              const isCurrentSystemProxy =
                config?.systemProxyEnabled && config?.systemProxyPort === m.port
              const pendingState = pendingPortStates[m.id]
              const isEffectiveTun =
                config?.tunEnabled && config?.tunPort === m.port
              const isEffectiveSystemProxy =
                pendingState !== undefined
                  ? pendingState === 'systemProxy'
                  : isCurrentSystemProxy
              const isEffectiveEnabled =
                pendingState !== undefined
                  ? pendingState !== 'disabled'
                  : m.enabled
              const sliderValue =
                pendingState !== undefined
                  ? pendingState === 'disabled'
                    ? 0
                    : pendingState === 'systemProxy'
                      ? 2
                      : 1
                  : !m.enabled
                    ? 0
                    : isCurrentSystemProxy
                      ? 2
                      : 1
              const primaryEgressInfo = isDirectCard
                ? directEgressInfo
                : lookupNodeEgressInfo(
                    nodeEgressIps,
                    m.nodeName,
                    m.profileId,
                    nodeKey,
                  )
              const chainEgressInfo = isChainPort
                ? portEgressIps[m.port]
                : undefined
              const isProbingChain = isChainPort
                ? Boolean(probingPortEgress[m.port])
                : false
              const fallbackEgressInfo =
                hasFallback && m.fallbackNodeName
                  ? lookupNodeEgressInfo(
                      nodeEgressIps,
                      m.fallbackNodeName,
                      m.fallbackProfileId || m.profileId,
                      fbNodeKey,
                    )
                  : null
              const isProbingPrimary = isDirectCard
                ? isProbingDirect
                : isNodeEgressProbing(
                    probingEgressNodeKeys,
                    m.nodeName,
                    m.profileId,
                    nodeKey,
                  )
              const isProbingFallback =
                hasFallback && m.fallbackNodeName
                  ? isNodeEgressProbing(
                      probingEgressNodeKeys,
                      m.fallbackNodeName,
                      m.fallbackProfileId || m.profileId,
                      fbNodeKey,
                    )
                  : false
              return (
                <div
                  key={m.id}
                  className={`min-w-0 p-3.5 rounded-xl border shadow-sm transition-all flex flex-col justify-between space-y-2.5 group ${
                    isStoppedWarning
                      ? 'border-amber-500/40 bg-amber-500/5 dark:bg-amber-500/10 hover:border-primary/40'
                      : isOccupiedWarning
                        ? 'border-rose-500/40 bg-rose-500/5 dark:bg-rose-500/10 hover:border-primary/40'
                        : !isEffectiveEnabled
                          ? 'bg-card/40 border-primary/20 hover:border-primary/40 opacity-70'
                          : isDrifted
                            ? 'border-amber-500/40 bg-amber-500/5 dark:bg-amber-500/10 hover:border-primary/40'
                            : isFallbackWarning
                              ? 'border-amber-500/60 bg-amber-500/5 dark:bg-amber-500/10 hover:border-primary/40'
                              : isEffectiveTun
                                ? 'border-purple-500/70 bg-purple-500/[0.04] dark:bg-purple-500/[0.08] ring-1 ring-purple-500/30 hover:border-purple-500/90'
                                : isEffectiveSystemProxy
                                  ? 'border-sky-500/70 bg-sky-500/[0.04] dark:bg-sky-500/[0.08] ring-1 ring-sky-500/30 hover:border-sky-500/90'
                                  : 'bg-card border-border hover:border-primary/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      {isStoppedWarning ? (
                        <span
                          className="inline-flex shrink-0 cursor-help"
                          title={t('ports.statusCoreStopped')}
                        >
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                        </span>
                      ) : isOccupiedWarning ? (
                        <span
                          className="inline-flex shrink-0 cursor-help"
                          title={t('ports.statusOccupied', { port: m.port })}
                        >
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-500 animate-pulse" />
                        </span>
                      ) : isFallbackWarning ? (
                        <span
                          className="inline-flex shrink-0 cursor-help"
                          title={t('ports.statusFallbackActive')}
                        >
                          <ShieldCheck className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                        </span>
                      ) : isEffectiveEnabled && isRunning ? (
                        <span
                          className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0 cursor-help"
                          title={t('ports.statusListening')}
                        />
                      ) : null}

                      <span className="font-mono font-bold text-sm text-foreground">
                        {m.port}
                      </span>
                      {m.protocol !== 'mixed' && (
                        <Badge
                          variant={inboundBadgeVariant}
                          size="sm"
                          className="uppercase font-mono font-medium !text-[10px] !py-0.5 !px-1.5"
                        >
                          {m.protocol}
                        </Badge>
                      )}
                      {isDirectCard ? (
                        <Badge
                          variant="outline"
                          size="sm"
                          className="!text-[10px] !py-0.5 !px-1.5 font-medium text-sky-500/90 border-sky-500/30 bg-sky-500/5 shrink-0 flex items-center gap-1"
                          title={t('ports.directBadgeTitle')}
                        >
                          <Zap className="w-2.5 h-2.5 text-sky-500" />
                          {t('ports.directBadge')}
                        </Badge>
                      ) : isChainPort ? (
                        <Badge
                          variant="outline"
                          size="sm"
                          className="!text-[10px] !py-0.5 !px-1.5 font-medium text-sky-500 border-sky-500/30 bg-sky-500/5 shrink-0 flex items-center gap-1"
                          title={
                            residentialProxy
                              ? t('ports.chainBadgeTitle', {
                                  node: m.nodeName,
                                  exit: residentialProxy.name,
                                })
                              : t('ports.chainMissingTitle')
                          }
                        >
                          <Building2 className="w-2.5 h-2.5 text-sky-500" />
                          {t('ports.chainBadge')}
                        </Badge>
                      ) : m.bypassCn !== false ? (
                        <Badge
                          variant="secondary"
                          size="sm"
                          className="!text-[10px] !py-0.5 !px-1.5 font-medium text-muted-foreground border-border/70 shrink-0"
                          title={t('ports.bypassCnTitle')}
                        >
                          {t('ports.bypassCn')}
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          size="sm"
                          className="!text-[10px] !py-0.5 !px-1.5 font-medium text-amber-500/90 border-amber-500/30 bg-amber-500/5 shrink-0"
                          title={t('ports.globalProxyTitle')}
                        >
                          {t('ports.globalProxy')}
                        </Badge>
                      )}
                      {isEffectiveTun && (
                        <Badge
                          variant="outline"
                          size="sm"
                          className="!text-[10px] !py-0.5 !px-1.5 font-medium text-purple-500 border-purple-500/30 bg-purple-500/5 shrink-0 flex items-center gap-1"
                          title={t('ports.tunExitTitle')}
                        >
                          <Shield className="w-2.5 h-2.5 text-purple-500" />
                          {t('ports.tunExit')}
                        </Badge>
                      )}
                      {config?.envProxyEnabled &&
                        config.envProxyPort === m.port && (
                          <Badge
                            variant="outline"
                            size="sm"
                            className="!text-[10px] !py-0.5 !px-1.5 font-medium text-blue-500 border-blue-500/30 bg-blue-500/5 shrink-0 flex items-center gap-1"
                            title={t('ports.envExitTitle')}
                          >
                            <Terminal className="w-2.5 h-2.5 text-blue-500" />
                            {t('ports.envExit')}
                          </Badge>
                        )}
                      {!isChainPort && m.rules && m.rules.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setRulesMapping(m)
                            setRulesModalMode('port')
                            setIsRulesModalOpen(true)
                          }}
                          className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium text-primary bg-primary/10 border border-primary/20 shrink-0 hover:bg-primary/20 transition-colors"
                          title={t('ports.rulesBadgeTitle', {
                            count: m.rules.length,
                          })}
                        >
                          <Split className="w-2.5 h-2.5" />
                          {t('ports.rulesBadge', { count: m.rules.length })}
                        </button>
                      )}
                      {isStoppedWarning ? (
                        <span className="text-[10px] text-amber-500 font-medium shrink-0">
                          {t('ports.listeningStopped')}
                        </span>
                      ) : null}
                    </div>

                    <HoverStepSlider
                      value={sliderValue}
                      onChange={(level) => {
                        const stateMap: Record<number, PortState> = {
                          0: 'disabled',
                          1: 'enabled',
                          2: 'systemProxy',
                        }
                        const nextState = stateMap[level] ?? 'disabled'
                        handlePortStateChange(m, nextState)
                      }}
                      loading={!!togglingPortIds[m.id]}
                      disabled={isTesting || !!togglingPortIds[m.id]}
                      lockedSteps={isDirectCard ? [2] : undefined}
                      maxAllowedStep={isDirectCard ? 1 : undefined}
                      lockedTooltip={
                        isDirectCard ? t('ports.directNoSysProxy') : undefined
                      }
                    />
                  </div>

                  {/* Middle Row: Bound Proxy Node or Direct Egress Info */}
                  {isDirectCard ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <div className="flex items-center gap-1.5 font-medium text-xs text-foreground min-w-0 flex-1">
                          <RegionFlag
                            code={directEgressInfo?.countryCode || 'CN'}
                            size="md"
                          />
                          {directEgressInfo?.ip ? (
                            <button
                              type="button"
                              onClick={() => {
                                void handleCopyDirectEgressIp(
                                  m.enabled ? m.port : null,
                                  false,
                                )
                              }}
                              className="truncate font-mono font-semibold text-xs text-foreground hover:text-primary transition-colors cursor-pointer text-left"
                              title={t('ports.clickCopyDirectIp', {
                                ip: directEgressInfo.ip,
                              })}
                            >
                              {directEgressInfo.ip}
                            </button>
                          ) : (
                            <span
                              className="truncate font-mono font-semibold text-xs text-foreground"
                              title={t('ports.detectingOrNoIp')}
                            >
                              {isProbingDirect
                                ? t('ports.probingIp')
                                : m.enabled
                                  ? t('ports.clickToDetectIp')
                                  : t('ports.notListening')}
                            </span>
                          )}
                          <span
                            className="inline-flex items-center justify-center text-[10px] font-medium leading-none px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 shrink-0 select-none"
                            title={t('ports.egressDirectTitle')}
                          >
                            {t('ports.egressDirectLabel')}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground min-w-0">
                        <span
                          className="truncate"
                          title={
                            directEgressInfo
                              ? `${directEgressInfo.region || t('common.unknown')}${
                                  directEgressInfo.isp
                                    ? ` · ${directEgressInfo.isp}`
                                    : ''
                                }`
                              : t('ports.directTrafficDesc')
                          }
                        >
                          {directEgressInfo
                            ? `${directEgressInfo.region || t('common.unknown')}${
                                directEgressInfo.isp
                                  ? ` · ${directEgressInfo.isp}`
                                  : ''
                              }`
                            : t('ports.directTrafficDesc')}
                        </span>
                        {!m.enabled && (
                          <span className="text-[10px] text-muted-foreground/60 shrink-0">
                            {t('ports.notEnabledParen')}
                          </span>
                        )}
                      </div>

                      {descriptionText?.trim() && (
                        <div
                          className="text-[10px] text-muted-foreground truncate italic pt-0.5"
                          title={descriptionText}
                        >
                          {descriptionText}
                        </div>
                      )}
                    </div>
                  ) : isChainPort ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <div className="flex items-center gap-1.5 font-medium text-xs text-foreground min-w-0 flex-1">
                          <Building2 className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                          <div className="relative flex items-center flex-1 min-w-0 group/exit">
                            <span
                              className={`truncate flex-1 font-semibold ${
                                residentialProxy
                                  ? 'text-foreground'
                                  : 'text-destructive'
                              }`}
                              title={
                                residentialProxy
                                  ? `${residentialProxy.name} (${residentialProxy.protocol.toUpperCase()} ${residentialProxy.server}:${residentialProxy.port})`
                                  : t('ports.chainMissingTitle')
                              }
                            >
                              {residentialProxy
                                ? residentialProxy.name
                                : t('ports.chainExitMissingShort')}
                            </span>
                            <button
                              type="button"
                              disabled={
                                isProbingChain ||
                                !m.enabled ||
                                !residentialProxy
                              }
                              onClick={(e) => {
                                e.stopPropagation()
                                void handleCopyChainEgressIp(m.port, m.protocol)
                              }}
                              className={`absolute right-0 top-1/2 -translate-y-1/2 z-10 inline-flex items-center gap-1 h-5 px-2 rounded-md text-[10px] leading-none font-semibold bg-primary text-primary-foreground hover:opacity-90 shadow-md cursor-pointer disabled:opacity-70 transition-all duration-200 ease-out ${
                                isProbingChain
                                  ? 'opacity-100 scale-100 translate-x-0 pointer-events-auto'
                                  : 'opacity-0 scale-95 translate-x-1 pointer-events-none group-hover/exit:opacity-100 group-hover/exit:scale-100 group-hover/exit:translate-x-0 group-hover/exit:pointer-events-auto'
                              }`}
                              title={
                                isProbingChain
                                  ? t('ports.probingChainIp')
                                  : !m.enabled
                                    ? t('ports.portDisabledNoChainProbe')
                                    : !residentialProxy
                                      ? t('ports.chainExitMissingShort')
                                      : chainEgressInfo
                                        ? t('ports.clickCopyChainIp', {
                                            ip: chainEgressInfo.ip,
                                            region: chainEgressInfo.region
                                              ? ` (${chainEgressInfo.region})`
                                              : '',
                                          })
                                        : t('ports.clickProbeChainIp')
                              }
                            >
                              {isProbingChain ? (
                                <>
                                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                  <span>{t('ports.probingShort')}</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-2.5 h-2.5" />
                                  <span>{t('ports.egressIpShort')}</span>
                                </>
                              )}
                            </button>
                          </div>
                          <span
                            className="inline-flex items-center justify-center text-[10px] font-medium leading-none px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 shrink-0 select-none"
                            title={t('ports.finalExitResidentialTitle')}
                          >
                            {t('ports.residentialExitLabel')}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0 flex-1 text-[11px] text-muted-foreground">
                          <span className="inline-flex items-center justify-center text-[9px] font-medium leading-none px-1 py-0.5 rounded bg-muted/80 text-muted-foreground border border-border/50 shrink-0 select-none">
                            {t('ports.upstreamLabel')}
                          </span>
                          {profileName && (
                            <ProfileBadgeTooltip
                              profile={primaryProfile}
                              fallbackName={profileName}
                              size="xs"
                            />
                          )}
                          <RegionFlag
                            code={extractRegion(m.nodeName).code}
                            size="sm"
                          />
                          <span
                            className="truncate font-medium text-foreground"
                            title={
                              profileName
                                ? `[${profileName}] ${m.nodeName}`
                                : m.nodeName
                            }
                          >
                            {m.nodeName}
                          </span>
                          {isDrifted && residentialProxy && (
                            <Badge
                              variant="danger"
                              size="sm"
                              dot
                              className="!text-[10px] !py-0.5 !px-1.5 shrink-0"
                              title={
                                drift?.message ||
                                t('ports.upstreamMissingTitle')
                              }
                            >
                              {drift?.status === 'profile_missing'
                                ? t('ports.profileDeletedReject')
                                : drift?.status === 'empty_profile'
                                  ? t('ports.profileEmptyReject')
                                  : t('ports.chainInvalidReject')}
                            </Badge>
                          )}
                          {!residentialProxy && (
                            <Badge
                              variant="danger"
                              size="sm"
                              dot
                              className="!text-[10px] !py-0.5 !px-1.5 shrink-0"
                              title={t('ports.exitDeletedTitle')}
                            >
                              {t('ports.exitMissingReject')}
                            </Badge>
                          )}
                        </div>
                        <Badge
                          variant={
                            latency === undefined
                              ? 'secondary'
                              : isPrimaryTimeout
                                ? 'danger'
                                : 'success'
                          }
                          size="sm"
                          dot={latency !== undefined}
                          className="!text-[10px] !py-0.5 !px-1.5 shrink-0"
                          title={
                            latency === undefined
                              ? t('ports.chainUntestedTitle')
                              : isPrimaryTimeout
                                ? t('ports.chainTimeoutTitle')
                                : t('ports.chainHealthyTitle')
                          }
                        >
                          {latency === undefined
                            ? t('ports.untested')
                            : isPrimaryTimeout
                              ? t('ports.chainAbnormal')
                              : t('ports.chainHealthy')}
                        </Badge>
                      </div>

                      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground min-w-0">
                        <span
                          className="truncate"
                          title={
                            chainEgressInfo
                              ? `${chainEgressInfo.ip}${chainEgressInfo.region ? ` · ${chainEgressInfo.region}` : ''}`
                              : t('ports.probeFinalIpDesc')
                          }
                        >
                          {chainEgressInfo
                            ? `${chainEgressInfo.ip}${
                                chainEgressInfo.region
                                  ? ` · ${chainEgressInfo.region}`
                                  : ''
                              }`
                            : m.enabled
                              ? t('ports.clickProbeFinalIp')
                              : t('ports.portNotListening')}
                        </span>
                        {residentialProxy && (
                          <span
                            className="font-mono text-[10px] text-muted-foreground/70 truncate shrink-0"
                            title={t('ports.residentialProxyTooltip', {
                              protocol: residentialProxy.protocol.toUpperCase(),
                              server: residentialProxy.server,
                              port: residentialProxy.port,
                            })}
                          >
                            {residentialProxy.protocol.toUpperCase()}{' '}
                            {residentialProxy.server}:{residentialProxy.port}
                          </span>
                        )}
                      </div>

                      {m.description?.trim() && (
                        <div
                          className="text-[10px] text-muted-foreground truncate italic pt-0.5"
                          title={m.description}
                        >
                          {m.description}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-1.5 relative">
                      {(() => {
                        const isDraggingThis = fallbackDrag?.mappingId === m.id
                        const isDropReady = Boolean(
                          isDraggingThis && fallbackDrag?.isOverPrimary,
                        )
                        const isRecentlySwapped = Boolean(
                          recentlySwappedIds[m.id],
                        )
                        const isSwappingThis = Boolean(swappingPortIds[m.id])
                        const canClickFallback =
                          m.enabled && !isAutoFallbackActive && !isSwappingThis

                        return (
                          <>
                            <div
                              ref={(el) => {
                                primaryRowRefs.current[m.id] = el
                              }}
                              className={`flex items-center justify-between gap-2 min-w-0 rounded-md px-1.5 py-0.5 -mx-1.5 -my-0.5 transition-[background-color,box-shadow,transform] duration-150 ${
                                isDropReady
                                  ? 'bg-primary/15 ring-1 ring-primary/60 translate-y-1'
                                  : isDraggingThis
                                    ? 'bg-primary/[0.04] ring-1 ring-dashed ring-primary/40'
                                    : isRecentlySwapped
                                      ? 'bg-primary/10 ring-1 ring-primary/40'
                                      : ''
                              }`}
                            >
                              <div className="flex items-center gap-1.5 font-medium text-xs text-foreground min-w-0 flex-1">
                                <RegionFlag
                                  code={extractRegion(m.nodeName).code}
                                  size="md"
                                />
                                {profileName && (
                                  <ProfileBadgeTooltip
                                    profile={primaryProfile}
                                    fallbackName={profileName}
                                    size="sm"
                                  />
                                )}
                                <div className="relative flex items-center flex-1 min-w-0 group/name">
                                  <span
                                    className="truncate flex-1 font-semibold text-foreground"
                                    title={
                                      profileName
                                        ? `[${profileName}] ${m.nodeName}`
                                        : m.nodeName
                                    }
                                  >
                                    {m.nodeName}
                                  </span>
                                  <button
                                    type="button"
                                    disabled={isProbingPrimary}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      void handleCopyNodeEgressIp(
                                        m.nodeName,
                                        m.profileId,
                                        nodeKey,
                                        hasFallback
                                          ? t('ports.primaryNodeLabel')
                                          : t('ports.nodeLabel'),
                                        false,
                                      )
                                    }}
                                    className={`absolute right-0 top-1/2 -translate-y-1/2 z-10 inline-flex items-center gap-1 h-5 px-2 rounded-md text-[10px] leading-none font-semibold bg-primary text-primary-foreground hover:opacity-90 shadow-md cursor-pointer disabled:opacity-70 transition-all duration-200 ease-out ${
                                      isDraggingThis
                                        ? 'opacity-0 pointer-events-none'
                                        : isProbingPrimary
                                          ? 'opacity-100 scale-100 translate-x-0 pointer-events-auto'
                                          : 'opacity-0 scale-95 translate-x-1 pointer-events-none group-hover/name:opacity-100 group-hover/name:scale-100 group-hover/name:translate-x-0 group-hover/name:pointer-events-auto'
                                    }`}
                                    title={
                                      isProbingPrimary
                                        ? t('ports.probingEgressIp')
                                        : primaryEgressInfo
                                          ? t('ports.clickCopyNodeIp', {
                                              ip: primaryEgressInfo.ip,
                                              region: primaryEgressInfo.region
                                                ? ` (${primaryEgressInfo.region})`
                                                : '',
                                            })
                                          : t('ports.clickProbeNodeIp')
                                    }
                                  >
                                    {isProbingPrimary ? (
                                      <>
                                        <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                        <span>{t('ports.probingShort')}</span>
                                      </>
                                    ) : (
                                      <>
                                        <Copy className="w-2.5 h-2.5" />
                                        <span>{t('ports.copyIpShort')}</span>
                                      </>
                                    )}
                                  </button>
                                </div>
                                {isDrifted && (
                                  <Badge
                                    variant={
                                      drift?.status === 'empty_profile'
                                        ? 'warning'
                                        : 'danger'
                                    }
                                    size="sm"
                                    dot
                                    className="!text-[10px] !py-0.5 !px-1.5 shrink-0"
                                    title={
                                      drift?.message ||
                                      t('ports.nodeMissingDirectTitle')
                                    }
                                  >
                                    {drift?.status === 'profile_missing'
                                      ? t('ports.profileDeletedDirect')
                                      : drift?.status === 'empty_profile'
                                        ? t('ports.profileEmptyDirect')
                                        : t('ports.nodeDriftDirect')}
                                  </Badge>
                                )}
                              </div>

                              {/* Main Node Status Badge (正常 / 异常) */}
                              <Badge
                                variant={
                                  isPrimaryTimeout ? 'danger' : 'success'
                                }
                                size="sm"
                                dot
                                className="!text-[10px] !py-0.5 !px-1.5 shrink-0"
                                title={
                                  isPrimaryTimeout
                                    ? t('ports.primaryTimeoutTitle')
                                    : t('ports.primaryHealthyTitle')
                                }
                              >
                                {isPrimaryTimeout
                                  ? t('ports.abnormal')
                                  : t('ports.normal')}
                              </Badge>
                            </div>

                            {/* Fallback Node Row (Draggable onto Primary to swap, clickable to lock, + one-click swap button) */}
                            {hasFallback && (
                              <div
                                ref={(el) => {
                                  fallbackRowRefs.current[m.id] = el
                                }}
                                onPointerDown={(e) => startFallbackDrag(e, m)}
                                style={
                                  isDraggingThis && fallbackDrag
                                    ? {
                                        transform: `translate3d(${fallbackDrag.dx}px, ${fallbackDrag.dy}px, 0) scale(1.02)`,
                                        transition:
                                          'box-shadow 150ms ease, border-color 150ms ease',
                                        zIndex: 30,
                                      }
                                    : {
                                        transition:
                                          'transform 220ms cubic-bezier(0.22, 1, 0.36, 1), background-color 150ms ease, border-color 150ms ease',
                                      }
                                }
                                className={`relative w-full flex items-center justify-between gap-1 text-[11px] pl-1.5 pr-1 py-1 rounded-md border select-none touch-none group/fbrow ${
                                  isDraggingThis
                                    ? isDropReady
                                      ? 'bg-card border-primary shadow-lg ring-1 ring-primary/60 text-foreground cursor-grabbing'
                                      : 'bg-card border-primary/60 shadow-lg ring-1 ring-primary/40 text-foreground cursor-grabbing'
                                    : !m.enabled
                                      ? 'bg-muted/10 border-border/40 text-muted-foreground/60 hover:border-border/80'
                                      : isManualFallback
                                        ? 'bg-primary/10 border-primary/40 text-foreground hover:border-primary/70 hover:bg-primary/15 group/fb'
                                        : isAutoFallbackActive
                                          ? 'bg-amber-500/10 border-amber-500/30 text-foreground hover:border-amber-500/60'
                                          : 'bg-muted/20 border-dashed border-border/80 text-muted-foreground hover:border-primary/50 hover:bg-primary/5 hover:text-foreground group/fb'
                                }`}
                              >
                                <span
                                  className={`inline-flex items-center shrink-0 transition-colors ${
                                    isDraggingThis
                                      ? 'text-primary cursor-grabbing'
                                      : 'text-muted-foreground/45 group-hover/fbrow:text-primary/80 cursor-grab'
                                  }`}
                                  title={t('ports.dragFallbackHint')}
                                >
                                  <GripVertical className="w-3 h-3" />
                                </span>

                                <button
                                  type="button"
                                  disabled={!canClickFallback}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    const lastDragAt =
                                      justDraggedRef.current[m.id] ?? 0
                                    if (Date.now() - lastDragAt < 220) return
                                    if (!canClickFallback) return
                                    handleToggleManualFallback(
                                      m.id,
                                      isManualFallback,
                                    )
                                  }}
                                  className={`flex-1 flex items-center justify-between gap-1.5 min-w-0 text-left focus:outline-none ${
                                    isDraggingThis
                                      ? 'cursor-grabbing'
                                      : canClickFallback
                                        ? 'cursor-pointer'
                                        : 'cursor-grab'
                                  }`}
                                  title={
                                    !m.enabled
                                      ? `${t('ports.fallbackDisabledTitle')} · ${t('ports.dragFallbackHint')}`
                                      : isManualFallback
                                        ? t('ports.fallbackManualTitle')
                                        : isAutoFallbackActive
                                          ? `${t('ports.fallbackAutoTitle')} · ${t('ports.dragFallbackHint')}`
                                          : t('ports.fallbackStandbyTitle')
                                  }
                                >
                                  <div className="flex items-center gap-1.5 min-w-0 flex-1 truncate">
                                    <ShieldCheck
                                      className={`w-3 h-3 shrink-0 ${
                                        isManualFallback
                                          ? 'text-primary animate-pulse'
                                          : isAutoFallbackActive
                                            ? 'text-amber-500 animate-pulse'
                                            : 'text-muted-foreground/60 group-hover/fb:text-primary'
                                      }`}
                                    />
                                    {fbProfileName && (
                                      <ProfileBadgeTooltip
                                        profile={fbProfile}
                                        fallbackName={fbProfileName}
                                        size="xs"
                                      />
                                    )}
                                    <RegionFlag
                                      code={
                                        extractRegion(m.fallbackNodeName || '')
                                          .code
                                      }
                                      size="sm"
                                    />
                                    <div className="relative flex items-center flex-1 min-w-0 group/fbname">
                                      <span
                                        className="truncate font-medium text-[11px] flex-1 min-w-0 text-left"
                                        title={
                                          fbProfileName
                                            ? `[${fbProfileName}] ${m.fallbackNodeName}`
                                            : m.fallbackNodeName || ''
                                        }
                                      >
                                        {m.fallbackNodeName}
                                      </span>
                                      <span
                                        role="button"
                                        tabIndex={0}
                                        data-no-drag="true"
                                        onPointerDown={(e) =>
                                          e.stopPropagation()
                                        }
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          e.preventDefault()
                                          if (
                                            isProbingFallback ||
                                            !m.fallbackNodeName
                                          )
                                            return
                                          void handleCopyNodeEgressIp(
                                            m.fallbackNodeName,
                                            m.fallbackProfileId || m.profileId,
                                            fbNodeKey,
                                            t('ports.fallbackNodeLabel'),
                                            false,
                                          )
                                        }}
                                        onKeyDown={(e) => {
                                          if (
                                            e.key === 'Enter' ||
                                            e.key === ' '
                                          ) {
                                            e.stopPropagation()
                                            e.preventDefault()
                                            if (
                                              isProbingFallback ||
                                              !m.fallbackNodeName
                                            )
                                              return
                                            void handleCopyNodeEgressIp(
                                              m.fallbackNodeName,
                                              m.fallbackProfileId ||
                                                m.profileId,
                                              fbNodeKey,
                                              t('ports.fallbackNodeLabel'),
                                              false,
                                            )
                                          }
                                        }}
                                        className={`absolute right-0 top-1/2 -translate-y-1/2 z-10 inline-flex items-center gap-1 h-[18px] px-1.5 rounded-md text-[10px] leading-none font-semibold bg-primary text-primary-foreground hover:opacity-90 shadow-md cursor-pointer transition-all duration-200 ease-out ${
                                          isDraggingThis
                                            ? 'opacity-0 pointer-events-none'
                                            : isProbingFallback
                                              ? 'opacity-80 scale-100 translate-x-0 pointer-events-auto'
                                              : 'opacity-0 scale-95 translate-x-1 pointer-events-none group-hover/fbname:opacity-100 group-hover/fbname:scale-100 group-hover/fbname:translate-x-0 group-hover/fbname:pointer-events-auto'
                                        }`}
                                        title={
                                          isProbingFallback
                                            ? t('ports.probingFallbackIp')
                                            : fallbackEgressInfo
                                              ? t('ports.clickCopyFallbackIp', {
                                                  ip: fallbackEgressInfo.ip,
                                                  region:
                                                    fallbackEgressInfo.region
                                                      ? ` (${fallbackEgressInfo.region})`
                                                      : '',
                                                })
                                              : t('ports.clickProbeFallbackIp')
                                        }
                                      >
                                        {isProbingFallback ? (
                                          <>
                                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                            <span>
                                              {t('ports.probingShort')}
                                            </span>
                                          </>
                                        ) : (
                                          <>
                                            <Copy className="w-2.5 h-2.5" />
                                            <span>
                                              {t('ports.copyIpShort')}
                                            </span>
                                          </>
                                        )}
                                      </span>
                                    </div>
                                  </div>

                                  {isDropReady ? (
                                    <Badge
                                      variant="primary"
                                      size="sm"
                                      className="!text-[9px] !py-0 !px-1.5 shrink-0 bg-primary/15 text-primary border-primary/40 font-medium"
                                    >
                                      {t('ports.dropToSwapHint')}
                                    </Badge>
                                  ) : isManualFallback ? (
                                    <Badge
                                      variant="primary"
                                      size="sm"
                                      dot
                                      className="!text-[9px] !py-0 !px-1.5 shrink-0 bg-primary/20 text-primary border-primary/40 font-medium animate-pulse group-hover/fb:bg-primary/30"
                                    >
                                      <span className="group-hover/fb:hidden">
                                        {t('ports.manualLocked')}
                                      </span>
                                      <span className="hidden group-hover/fb:inline">
                                        {t('ports.clickRestoreAuto')}
                                      </span>
                                    </Badge>
                                  ) : isAutoFallbackActive ? (
                                    <Badge
                                      variant="warning"
                                      size="sm"
                                      dot
                                      className="!text-[9px] !py-0 !px-1.5 shrink-0 animate-pulse"
                                      title={t('ports.autoFallbackActiveTitle')}
                                    >
                                      {t('ports.autoFallbackActive')}
                                    </Badge>
                                  ) : (
                                    <span className="text-[10px] font-mono text-muted-foreground/70 shrink-0 bg-secondary/80 px-1.5 py-0.5 rounded transition-colors group-hover/fb:text-primary group-hover/fb:bg-primary/10">
                                      <span className="group-hover/fb:hidden">
                                        {t('ports.standby')}
                                      </span>
                                      <span className="hidden group-hover/fb:inline">
                                        {t('ports.clickEnableManual')}
                                      </span>
                                    </span>
                                  )}
                                </button>

                                <button
                                  type="button"
                                  data-no-drag="true"
                                  disabled={
                                    isSwappingThis ||
                                    isTesting ||
                                    isTestingFb ||
                                    Boolean(togglingPortIds[m.id])
                                  }
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    void handleSwapPrimaryFallback(m)
                                  }}
                                  className={`inline-flex items-center justify-center w-5 h-5 rounded shrink-0 transition-colors focus:outline-none ${
                                    isSwappingThis
                                      ? 'text-primary cursor-wait'
                                      : 'text-muted-foreground/75 hover:text-primary hover:bg-primary/15 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed'
                                  }`}
                                  title={t('ports.swapPrimaryFallbackTitle')}
                                  aria-label={t(
                                    'ports.swapPrimaryFallbackTitle',
                                  )}
                                >
                                  <ArrowUpDown
                                    className={`w-3 h-3 transition-transform duration-300 ${
                                      isRecentlySwapped
                                        ? 'rotate-180 text-primary'
                                        : ''
                                    }`}
                                  />
                                </button>
                              </div>
                            )}
                          </>
                        )
                      })()}
                      {m.description?.trim() && (
                        <div
                          className="text-[10px] text-muted-foreground truncate italic pt-0.5"
                          title={m.description}
                        >
                          {m.description}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Bottom Row: Latency Badge + Actions */}
                  {/* Bottom Row: Latency Badge + Actions */}
                  <div className="pt-2 border-t border-border/50 flex flex-nowrap items-center justify-between gap-1.5 text-[11px]">
                    {/* Latency Badges Area (Clickable for Single Delay Test) */}
                    <div className="flex flex-nowrap items-center gap-1.5 min-w-0 shrink-0">
                      {isDirectCard ? (
                        <button
                          type="button"
                          onClick={() =>
                            handleProbeDirectEgress(
                              m.enabled ? m.port : null,
                              true,
                            )
                          }
                          disabled={isProbingDirect}
                          className="focus:outline-none flex items-center shrink-0"
                          title={t('ports.detectDirectEgressTitle')}
                        >
                          <Badge
                            variant={
                              directEgressInfo?.latencyMs !== undefined &&
                              directEgressInfo?.latencyMs !== null
                                ? 'success'
                                : 'secondary'
                            }
                            size="sm"
                            dot={false}
                            className="cursor-pointer hover:opacity-80 font-mono transition-opacity !text-[10px] !py-0.5 !px-1.5 flex items-center gap-1 shrink-0 whitespace-nowrap"
                          >
                            <Zap className="w-2.5 h-2.5 shrink-0 text-sky-500" />
                            {isProbingDirect ? (
                              <span className="flex items-center gap-0.5">
                                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                              </span>
                            ) : directEgressInfo?.latencyMs !== undefined &&
                              directEgressInfo?.latencyMs !== null ? (
                              `${directEgressInfo.latencyMs}`
                            ) : (
                              t('ports.detectEgress')
                            )}
                          </Badge>
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => handleSingleDelayTest(m.id, m.port)}
                            disabled={!m.enabled || isTesting}
                            className="focus:outline-none flex items-center shrink-0"
                            title={
                              isChainPort
                                ? t('ports.testChainLatencyTitle')
                                : hasFallback
                                  ? t('ports.testPortAndFallbackTitle')
                                  : t('ports.testPortTitle')
                            }
                          >
                            <Badge
                              variant={latencyProps.variant}
                              size="sm"
                              dot={false}
                              className="cursor-pointer hover:opacity-80 font-mono transition-opacity !text-[10px] !py-0.5 !px-1.5 flex items-center gap-1 shrink-0 whitespace-nowrap"
                            >
                              <Zap className="w-2.5 h-2.5 shrink-0" />
                              {isTesting ? (
                                <span className="flex items-center gap-0.5">
                                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                </span>
                              ) : (
                                formatLatencyLabel(latency, isTesting)
                              )}
                            </Badge>
                          </button>

                          {hasFallback && (
                            <button
                              type="button"
                              onClick={() =>
                                handleSingleFallbackDelayTest(m.id, m.port)
                              }
                              disabled={!m.enabled || isTestingFb}
                              className="focus:outline-none flex items-center shrink-0"
                              title={t('ports.fallbackLatencyTitle', {
                                node: m.fallbackNodeName ?? '',
                                label: formatLatencyLabel(
                                  fbLatency,
                                  isTestingFb,
                                  false,
                                ),
                              })}
                            >
                              <Badge
                                variant={fbLatencyProps.variant}
                                size="sm"
                                dot={false}
                                className="cursor-pointer hover:opacity-80 font-mono transition-opacity !text-[10px] !py-0.5 !px-1.5 flex items-center gap-1 shrink-0 whitespace-nowrap"
                              >
                                <ShieldCheck className="w-2.5 h-2.5 shrink-0" />
                                {isTestingFb ? (
                                  <span className="flex items-center gap-0.5">
                                    <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                  </span>
                                ) : (
                                  formatLatencyLabel(fbLatency, isTestingFb)
                                )}
                              </Badge>
                            </button>
                          )}
                        </>
                      )}
                    </div>
                    {/* Actions Group */}
                    <div className="flex items-center gap-1 shrink-0">
                      <QuickCopyMenu
                        port={m.port}
                        protocol={m.protocol}
                        hostIp={activeHostIp}
                        bypassDomains={config?.systemProxyBypassUser}
                        disabled={!isEffectiveEnabled}
                        onCopySuccess={toast.success}
                        isEnvProxy={
                          config?.envProxyEnabled &&
                          config.envProxyPort === m.port
                        }
                        onToggleEnvProxy={() =>
                          handleToggleEnvProxyForPort(m.port)
                        }
                        isEnvProxyLoading={isEnvProxyLoading}
                      />
                      {isDirectCard ? (
                        <button
                          type="button"
                          onClick={() => {
                            setDirectMappingForEdit(m)
                            setIsEditDirectModalOpen(true)
                          }}
                          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                          title={t('ports.editDirectPortTitle')}
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                      ) : (
                        <>
                          {isDrifted && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingMapping(m)
                                setIsAddModalOpen(true)
                              }}
                              className="p-1 rounded text-amber-500 hover:bg-amber-500/10 transition-colors"
                              title={
                                isChainPort
                                  ? t('ports.fixUpstreamTitle')
                                  : t('ports.fixNodeTitle')
                              }
                            >
                              <Wrench className="w-3 h-3" />
                            </button>
                          )}
                          {!isChainPort && (
                            <button
                              type="button"
                              onClick={() => {
                                setRulesMapping(m)
                                setRulesModalMode('port')
                                setIsRulesModalOpen(true)
                              }}
                              className={`p-1 rounded transition-colors relative ${
                                m.rules && m.rules.length > 0
                                  ? 'text-primary hover:bg-primary/10'
                                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                              }`}
                              title={
                                m.rules && m.rules.length > 0
                                  ? t('ports.manageRulesTitle', {
                                      count: m.rules.length,
                                    })
                                  : t('ports.configureRulesTitle')
                              }
                            >
                              <Split className="w-3 h-3" />
                              {m.rules &&
                                m.rules.filter((r) => r.enabled).length > 0 && (
                                  <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-primary" />
                                )}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              setEditingMapping(m)
                              setIsAddModalOpen(true)
                            }}
                            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                            title={t('ports.editPortTitle')}
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>

                          <button
                            type="button"
                            onClick={() => setDeletingMapping(m)}
                            className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            title={t('ports.deletePortTitle')}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Add / Edit Port Modal */}
      <AddPortModal
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false)
          setEditingMapping(null)
        }}
        initialMapping={editingMapping}
      />

      {/* Edit Direct Port Modal */}
      {directMappingForEdit && (
        <EditDirectPortModal
          isOpen={isEditDirectModalOpen}
          onClose={() => {
            setIsEditDirectModalOpen(false)
            setDirectMappingForEdit(null)
          }}
          directMapping={directMappingForEdit}
        />
      )}
      {/* Port Rules Modal */}
      <PortRulesModal
        isOpen={isRulesModalOpen}
        onClose={() => {
          setIsRulesModalOpen(false)
          setRulesMapping(null)
        }}
        mapping={rulesMapping}
        mode={rulesModalMode}
      />

      {/* Delete Confirmation Modal */}
      {deletingMapping && (
        <Modal
          isOpen={Boolean(deletingMapping)}
          onClose={() => setDeletingMapping(null)}
          title={t('ports.deleteModalTitle')}
          subtitle={t('ports.deleteModalSubtitle', {
            port: deletingMapping.port,
          })}
          icon={<Trash2 className="w-4 h-4 text-destructive" />}
          maxWidth="sm"
          footer={
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeletingMapping(null)}
                disabled={isDeleting}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                size="sm"
                loading={isDeleting}
                onClick={handleDeleteConfirm}
              >
                {t('ports.confirmDelete')}
              </Button>
            </>
          }
        >
          <p className="text-xs text-muted-foreground leading-relaxed">
            {deletingMapping.residentialProxyId
              ? t('ports.deleteModalDescChain', { port: deletingMapping.port })
              : t('ports.deleteModalDescNormal', {
                  port: deletingMapping.port,
                })}
          </p>
        </Modal>
      )}
    </div>
  )
}
