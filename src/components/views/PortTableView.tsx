import {
  AlertTriangle,
  Edit2,
  Globe,
  Loader2,
  Network,
  Plus,
  ShieldCheck,
  Trash2,
  Wrench,
  Zap,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import * as api from '../../services/tauri'
import { useAppStore } from '../../stores/appStore'
import type { LanIpInfo, PortDriftReport, PortMapping } from '../../types'
import { extractRegion, getLatencyBadgeProps } from '../../utils/proxy'
import {
  Badge,
  Button,
  HoverStepSlider,
  Modal,
  RegionFlag,
  Select,
  Switch,
  toast,
} from '../common'
import { AddPortModal } from '../ports/AddPortModal'
import { useWindowVisibility } from '../../services/useWindowVisibility'
import { QuickCopyMenu } from '../ports/QuickCopyMenu'

export const PortTableView: React.FC = () => {
  const {
    coreStatus,
    config,
    fetchConfig,
    saveConfig,
    setSystemProxy,
    portMappings,
    occupiedPorts,
    driftReports,
    testingPortIds,
    isTestingAllPorts,
    fetchPortMappings,
    deletePortMapping,
    togglePortMapping,
    toggleManualFallback,
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
        timer = setTimeout(refresh, 5000)
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
      toast.success(`已设置快捷复制 IP 为: ${val}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const lanIpOptions = useMemo(() => {
    const options = [
      {
        value: '127.0.0.1',
        label: '127.0.0.1 (本机回环)',
      },
    ]
    for (const item of lanIps) {
      options.push({
        value: item.ip,
        label: `${item.ip} (${item.name})`,
      })
    }
    return options
  }, [lanIps])

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

  // Profile map for easy name lookup
  const profileMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const p of profiles) {
      map[p.id] = p.name
    }
    return map
  }, [profiles])

  // Sorted port mappings (Ascending by port number)
  const sortedMappings = useMemo(() => {
    return [...portMappings].sort((a, b) => a.port - b.port)
  }, [portMappings])

  const enabledPorts = useMemo(() => {
    return portMappings.filter((m) => m.enabled).sort((a, b) => a.port - b.port)
  }, [portMappings])

  const totalPorts = portMappings.length
  const activePorts = enabledPorts.length
  type PortState = 'disabled' | 'enabled' | 'systemProxy'

  const [pendingPortStates, setPendingPortStates] = useState<
    Record<string, PortState>
  >({})

  const handlePortStateChange = async (m: PortMapping, newState: PortState) => {
    setTogglingPortIds((prev) => ({ ...prev, [m.id]: true }))
    setPendingPortStates((prev) => ({ ...prev, [m.id]: newState }))
    try {
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
          toast.success(
            `端口 ${m.port} 已停用，已同步解除系统代理并清除环境变量`,
          )
        } else {
          toast.success(`端口 ${m.port} 已停用`)
        }
      } else if (newState === 'enabled') {
        if (isSysProxy) {
          await setSystemProxy(false)
          toast.success(`端口 ${m.port} 已解除系统代理并保留监听`)
        } else if (!m.enabled) {
          await togglePortMapping(m.id, true)
          toast.success(`端口 ${m.port} 已启用监听`)
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
          toast.success(`已将端口 ${m.port} 设为系统代理并同步环境变量`)
        } else {
          toast.success(`已将端口 ${m.port} 设为系统代理`)
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
        toast.success(`端口 ${deletingMapping.port} 已删除，已同步解除系统代理`)
      } else {
        toast.success(`端口 ${deletingMapping.port} 映射已删除`)
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
      toast.success(`端口 ${port} 测速完成: ${latency} ms`)
    }
  }

  const handleSingleFallbackDelayTest = async (id: string, port: number) => {
    const latency = await testPortFallbackDelay(id)
    if (latency !== null && latency !== undefined) {
      toast.success(`端口 ${port} 备用节点测速完成: ${latency} ms`)
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
        toast.success('已主动启用备用节点')
      } else {
        toast.info('已恢复自动兜底模式')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '切换备用模式失败')
    }
  }

  const handleBatchDelayTest = async () => {
    await testAllPortsDelay()
    toast.success('全部已启用端口测速完成')
  }
  const handleTopToggleSystemProxy = async (checked: boolean) => {
    if (checked) {
      const targetPort =
        config?.systemProxyPort &&
        enabledPorts.some((m) => m.port === config.systemProxyPort)
          ? config.systemProxyPort
          : enabledPorts[0]?.port

      if (!targetPort) {
        toast.error('当前无可用且已启用的监听端口，请先启用端口')
        return
      }

      try {
        await setSystemProxy(true, targetPort)
        if (config?.systemProxySyncEnv ?? true) {
          toast.success(`已将端口 ${targetPort} 设为系统代理并同步环境变量`)
        } else {
          toast.success(`已将端口 ${targetPort} 设为系统代理`)
        }
      } catch (err) {
        toast.error(
          `开启系统代理失败: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    } else {
      try {
        // Retain the current target port in config memory when turning off
        const currentPort =
          config?.systemProxyPort ?? enabledPorts[0]?.port ?? null
        await setSystemProxy(false, currentPort)
        if (config?.systemProxySyncEnv ?? true) {
          toast.success('已关闭系统代理并清除环境变量')
        } else {
          toast.success('已关闭系统代理')
        }
      } catch (err) {
        toast.error(
          `关闭系统代理失败: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }

  const handleTopSelectSystemProxyPort = async (portStr: string) => {
    const port = Number(portStr)
    if (!port) return
    try {
      if (config?.systemProxyEnabled) {
        await setSystemProxy(true, port)
        toast.success(`已切换系统代理端口至 ${port}`)
      } else if (config) {
        await saveConfig({
          ...config,
          systemProxyPort: port,
        })
        toast.success(`已设置预设系统代理端口为 ${port}`)
      }
    } catch (err) {
      toast.error(
        `更新系统代理端口失败: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  return (
    <div className="h-full flex flex-col p-6 space-y-4 w-full overflow-hidden">
      {/* Top Sticky Single-Row Action Bar Card */}
      <div className="bg-card border border-border rounded-xl p-3 shadow-sm shrink-0 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Left: System Proxy Control Group & LAN IP Selector */}
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-0">
          <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-secondary/30 border border-border/80 shrink-0">
            <div className="flex items-center gap-1.5 text-xs font-semibold shrink-0">
              <Globe
                className={`w-3.5 h-3.5 ${
                  config?.systemProxyEnabled
                    ? 'text-sky-500 animate-pulse'
                    : 'text-muted-foreground'
                }`}
              />
              <span
                className={
                  config?.systemProxyEnabled
                    ? 'text-sky-600 dark:text-sky-400'
                    : 'text-foreground'
                }
              >
                系统代理
              </span>
            </div>
            <Switch
              checked={config?.systemProxyEnabled ?? false}
              onChange={handleTopToggleSystemProxy}
              size="sm"
            />
            <div className="w-52 ml-1">
              {enabledPorts.length === 0 ? (
                <span className="text-[11px] text-muted-foreground font-medium">
                  无已启用端口
                </span>
              ) : (
                <Select
                  value={
                    config?.systemProxyPort &&
                    enabledPorts.some((m) => m.port === config.systemProxyPort)
                      ? String(config.systemProxyPort)
                      : String(enabledPorts[0]?.port ?? '')
                  }
                  onChange={(val) =>
                    handleTopSelectSystemProxyPort(String(val))
                  }
                  options={enabledPorts.map((m) => ({
                    value: String(m.port),
                    label: `端口 ${m.port} (${m.protocol.toUpperCase()} - ${m.nodeName})`,
                  }))}
                />
              )}
            </div>
          </div>

          {config?.allowLan && (
            <div className="w-44 shrink-0">
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
        <div className="flex items-center gap-2 shrink-0">
          {activePorts > 0 && (
            <Button
              variant="outline"
              size="md"
              onClick={handleBatchDelayTest}
              loading={isTestingAllPorts}
              icon={<Zap className="w-3.5 h-3.5 text-amber-500" />}
            >
              {isTestingAllPorts ? '正在测速...' : '一键测速'}
            </Button>
          )}

          <Button
            variant="primary"
            size="md"
            onClick={() => {
              setEditingMapping(null)
              setIsAddModalOpen(true)
            }}
            icon={<Plus className="w-3.5 h-3.5" />}
          >
            添加端口映射
          </Button>
        </div>
      </div>

      {/* Scrollable Port Cards Grid Area */}
      <div className="flex-1 overflow-y-auto pr-1 pb-4">
        {totalPorts === 0 ? (
          /* Empty State Card */
          <div className="border border-dashed border-border rounded-xl p-12 flex flex-col items-center justify-center text-center space-y-4 bg-card/30">
            <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <Network className="w-6 h-6" />
            </div>
            <div className="space-y-1 max-w-sm">
              <h3 className="text-sm font-semibold text-foreground">
                暂无端口映射规则
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                点击上方按钮，分配独立本地入站端口（如
                7891、7892）并精确绑定至指定的订阅代理节点。
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
                添加第一个端口映射
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
            {sortedMappings.map((m) => {
              const isTesting = testingPortIds[m.id] || false
              const profileName = profileMap[m.profileId] || '未知订阅'
              const drift = driftMap[m.id]
              const isDrifted = drift && drift.status !== 'healthy'
              const nodeKey = profileName
                ? `[${profileName}] ${m.nodeName}`
                : m.nodeName

              // Robust latency lookup preserving null (timeout)
              const latency =
                nodeKey in latencies && latencies[nodeKey] !== undefined
                  ? latencies[nodeKey]
                  : m.nodeName in latencies &&
                      latencies[m.nodeName] !== undefined
                    ? latencies[m.nodeName]
                    : m.latency
              const latencyProps = getLatencyBadgeProps(latency, isTesting)

              // 1. Inbound listener protocol badge (Mixed / Socks5 / Http)
              const inboundBadgeVariant =
                m.protocol === 'mixed'
                  ? 'primary'
                  : m.protocol === 'socks5'
                    ? 'warning'
                    : 'secondary'

              // State warning priorities:
              // 1. Highest: Kernel Stopped Warning (Amber)
              const isStoppedWarning = !isRunning && m.enabled
              // 2. Secondary: Port Occupied Conflict Warning (Rose)
              const isOccupiedWarning =
                isRunning && m.enabled && occupiedPorts.includes(m.port)
              // 3. Fallback Degraded Warning (Amber)
              const fbStatus = fallbackStatuses[m.id]
              const hasFallback = Boolean(m.fallbackNodeName)
              const isManualFallback = m.manualFallback ?? false
              const isAutoFallbackActive =
                !isManualFallback &&
                Boolean(fbStatus?.isFallbackActive && !fbStatus?.manualFallback)
              const isPrimaryTimeout = latency === null || isAutoFallbackActive
              const isFallbackWarning =
                isRunning &&
                m.enabled &&
                hasFallback &&
                !isManualFallback &&
                isPrimaryTimeout
              const fbProfileName =
                (m.fallbackProfileId && profileMap[m.fallbackProfileId]) ||
                profileName
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
              return (
                <div
                  key={m.id}
                  className={`p-3.5 rounded-xl border shadow-sm transition-all flex flex-col justify-between space-y-2.5 group ${
                    isStoppedWarning
                      ? 'bg-card border-amber-500/40 bg-amber-500/5 dark:bg-amber-500/10 hover:border-primary/40'
                      : isOccupiedWarning
                        ? 'bg-card border-rose-500/40 bg-rose-500/5 dark:bg-rose-500/10 hover:border-primary/40'
                        : !isEffectiveEnabled
                          ? 'bg-card/40 border-primary/20 hover:border-primary/40 opacity-70'
                          : isDrifted
                            ? 'bg-card border-amber-500/40 bg-amber-500/5 dark:bg-amber-500/10 hover:border-primary/40'
                            : isFallbackWarning
                              ? 'bg-card border-amber-500/60 bg-amber-500/5 dark:bg-amber-500/10 hover:border-primary/40'
                              : isEffectiveSystemProxy
                                ? 'bg-card border-sky-500/70 bg-sky-500/[0.04] dark:bg-sky-500/[0.08] ring-1 ring-sky-500/30 hover:border-sky-500/90'
                                : 'bg-card border-border hover:border-primary/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      {isStoppedWarning ? (
                        <span
                          className="inline-flex shrink-0 cursor-help"
                          title="Mihomo 内核已停止，该端口当前未在监听"
                        >
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                        </span>
                      ) : isOccupiedWarning ? (
                        <span
                          className="inline-flex shrink-0 cursor-help"
                          title={`本地端口 ${m.port} 已被其他应用程序占用，已自动跳过监听`}
                        >
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-500 animate-pulse" />
                        </span>
                      ) : isFallbackWarning ? (
                        <span
                          className="inline-flex shrink-0 cursor-help"
                          title="主节点连接异常，当前正由同地区备用节点兜底监听中"
                        >
                          <ShieldCheck className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                        </span>
                      ) : isEffectiveEnabled && isRunning ? (
                        <span
                          className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0 cursor-help"
                          title="正常监听中"
                        />
                      ) : null}

                      <span className="font-mono font-bold text-sm text-foreground">
                        {m.port}
                      </span>
                      <Badge
                        variant={inboundBadgeVariant}
                        size="sm"
                        className="uppercase font-mono font-medium !text-[10px] !py-0.5 !px-1.5"
                      >
                        {m.protocol}
                      </Badge>
                      {m.bypassCn !== false ? (
                        <Badge
                          variant="secondary"
                          size="sm"
                          className="!text-[10px] !py-0.5 !px-1.5 font-medium text-muted-foreground border-border/70 shrink-0"
                          title="中国大陆域名与 IP 走直连 (DIRECT)"
                        >
                          绕过大陆
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          size="sm"
                          className="!text-[10px] !py-0.5 !px-1.5 font-medium text-amber-500/90 border-amber-500/30 bg-amber-500/5 shrink-0"
                          title="所有网络流量全局走绑定的代理节点"
                        >
                          全局代理
                        </Badge>
                      )}
                      {isStoppedWarning ? (
                        <span className="text-[10px] text-amber-500 font-medium shrink-0">
                          (监听已停止)
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
                    />
                  </div>

                  {/* Middle Row: Bound Proxy Node + Node Outbound Protocol Badge Right */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <div className="flex items-center gap-1.5 font-medium text-xs text-foreground min-w-0 flex-1">
                        <RegionFlag
                          code={extractRegion(m.nodeName).code}
                          size="md"
                        />
                        {profileName && (
                          <span
                            className="inline-flex items-center justify-center text-[10px] font-medium leading-none px-1.5 py-0.5 rounded bg-muted/80 text-muted-foreground border border-border/50 shrink-0 select-none"
                            title={`所属订阅: ${profileName}`}
                          >
                            {profileName}
                          </span>
                        )}
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
                              '节点在订阅中不存在，流量已直连 (DIRECT)'
                            }
                          >
                            {drift?.status === 'profile_missing'
                              ? '订阅已删 (DIRECT)'
                              : drift?.status === 'empty_profile'
                                ? '订阅无节点 (DIRECT)'
                                : '节点漂移 (DIRECT)'}
                          </Badge>
                        )}
                      </div>

                      {/* Main Node Status Badge (正常 / 异常) */}
                      <Badge
                        variant={isPrimaryTimeout ? 'danger' : 'success'}
                        size="sm"
                        dot
                        className="!text-[10px] !py-0.5 !px-1.5 shrink-0"
                        title={
                          isPrimaryTimeout
                            ? '主节点连接超时或网络异常'
                            : '主节点状态正常'
                        }
                      >
                        {isPrimaryTimeout ? '异常' : '正常'}
                      </Badge>
                    </div>

                    {/* Fallback Node Row (Clickable to manually lock fallback) */}
                    {hasFallback && (
                      <button
                        type="button"
                        disabled={!m.enabled || isAutoFallbackActive}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (!m.enabled || isAutoFallbackActive) return
                          handleToggleManualFallback(m.id, isManualFallback)
                        }}
                        className={`w-full flex items-center justify-between gap-1.5 text-[11px] px-2 py-1 rounded-md border select-none transition-all ${
                          !m.enabled
                            ? 'bg-muted/10 border-border/40 text-muted-foreground/50 cursor-not-allowed'
                            : isManualFallback
                              ? 'bg-primary/10 border-primary/40 text-foreground cursor-pointer hover:border-primary/70 hover:bg-primary/15 group/fb'
                              : isAutoFallbackActive
                                ? 'bg-amber-500/10 border-amber-500/30 text-foreground cursor-not-allowed opacity-90'
                                : 'bg-muted/20 border-dashed border-border/80 text-muted-foreground cursor-pointer hover:border-primary/50 hover:bg-primary/5 hover:text-foreground group/fb'
                        }`}
                        title={
                          !m.enabled
                            ? '端口已停用，无法切换备用节点'
                            : isManualFallback
                              ? '当前已主动启用备用节点（点击取消并恢复自动兜底模式）'
                              : isAutoFallbackActive
                                ? '主节点连接超时，系统已自动切换至备用节点兜底（主节点故障时无需手动指定）'
                                : '点击主动启用备用节点（锁定流量至备用节点，测速超时也不切回）'
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
                            <span
                              className="inline-flex items-center justify-center text-[9px] font-medium leading-none px-1 py-0.5 rounded bg-muted/80 text-muted-foreground border border-border/50 shrink-0 select-none"
                              title={`所属订阅: ${fbProfileName}`}
                            >
                              {fbProfileName}
                            </span>
                          )}
                          <RegionFlag
                            code={extractRegion(m.fallbackNodeName || '').code}
                            size="sm"
                          />
                          <span
                            className="truncate font-medium text-[11px]"
                            title={
                              fbProfileName
                                ? `[${fbProfileName}] ${m.fallbackNodeName}`
                                : m.fallbackNodeName || ''
                            }
                          >
                            {m.fallbackNodeName}
                          </span>
                        </div>

                        {isManualFallback ? (
                          <Badge
                            variant="primary"
                            size="sm"
                            dot
                            className="!text-[9px] !py-0 !px-1.5 shrink-0 bg-primary/20 text-primary border-primary/40 font-medium animate-pulse group-hover/fb:bg-primary/30"
                          >
                            <span className="group-hover/fb:hidden">
                              已主动锁定
                            </span>
                            <span className="hidden group-hover/fb:inline">
                              点击恢复自动
                            </span>
                          </Badge>
                        ) : isAutoFallbackActive ? (
                          <Badge
                            variant="warning"
                            size="sm"
                            dot
                            className="!text-[9px] !py-0 !px-1.5 shrink-0 animate-pulse"
                            title="主节点超时，系统已自动切换至备用节点兜底"
                          >
                            自动兜底中
                          </Badge>
                        ) : (
                          <span className="text-[10px] font-mono text-muted-foreground/70 shrink-0 bg-secondary/80 px-1.5 py-0.5 rounded transition-colors group-hover/fb:text-primary group-hover/fb:bg-primary/10">
                            <span className="group-hover/fb:hidden">待命</span>
                            <span className="hidden group-hover/fb:inline">
                              点击主动启用
                            </span>
                          </span>
                        )}
                      </button>
                    )}
                    {m.description?.trim() && (
                      <div
                        className="text-[10px] text-muted-foreground truncate italic pt-0.5"
                        title={m.description}
                      >
                        {m.description}
                      </div>
                    )}
                  </div>

                  {/* Bottom Row: Latency Badge + Actions */}
                  {/* Bottom Row: Latency Badge + Actions */}
                  <div className="pt-2 border-t border-border/50 flex flex-nowrap items-center justify-between gap-1.5 text-[11px]">
                    {/* Latency Badges Area (Clickable for Single Delay Test) */}
                    <div className="flex flex-nowrap items-center gap-1.5 min-w-0 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleSingleDelayTest(m.id, m.port)}
                        disabled={!m.enabled || isTesting}
                        className="focus:outline-none flex items-center shrink-0"
                        title={
                          hasFallback
                            ? '点击单端口测速 (同时测速主节点与备用节点)'
                            : '点击单端口测速'
                        }
                      >
                        <Badge
                          variant={latencyProps.variant}
                          size="sm"
                          dot={latencyProps.dot}
                          className="cursor-pointer hover:opacity-80 font-mono transition-opacity !text-[10px] !py-0.5 !px-1.5 flex items-center gap-1 shrink-0 whitespace-nowrap"
                        >
                          {hasFallback && (
                            <span className="font-sans font-semibold text-[9px] opacity-75">
                              主
                            </span>
                          )}
                          {isTesting ? (
                            <span className="flex items-center gap-1">
                              <Loader2 className="w-2.5 h-2.5 animate-spin" />
                              测速中
                            </span>
                          ) : (
                            latencyProps.label
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
                          title={`点击单独测试备用节点 (${m.fallbackNodeName}) 延迟`}
                        >
                          <Badge
                            variant={fbLatencyProps.variant}
                            size="sm"
                            dot={fbLatencyProps.dot}
                            className="cursor-pointer hover:opacity-80 font-mono transition-opacity !text-[10px] !py-0.5 !px-1.5 flex items-center gap-1 shrink-0 whitespace-nowrap"
                          >
                            <span className="font-sans font-semibold text-[9px] opacity-75">
                              备
                            </span>
                            {isTestingFb ? (
                              <span className="flex items-center gap-1">
                                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                测速中
                              </span>
                            ) : (
                              fbLatencyProps.label
                            )}
                          </Badge>
                        </button>
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
                      />

                      {isDrifted && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingMapping(m)
                            setIsAddModalOpen(true)
                          }}
                          className="p-1 rounded text-amber-500 hover:bg-amber-500/10 transition-colors"
                          title="修复漂移/失效的节点绑定"
                        >
                          <Wrench className="w-3 h-3" />
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          setEditingMapping(m)
                          setIsAddModalOpen(true)
                        }}
                        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        title="编辑端口映射"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>

                      <button
                        type="button"
                        onClick={() => setDeletingMapping(m)}
                        className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="删除端口映射"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
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

      {/* Delete Confirmation Modal */}
      {deletingMapping && (
        <Modal
          isOpen={Boolean(deletingMapping)}
          onClose={() => setDeletingMapping(null)}
          title="删除端口映射规则"
          subtitle={`确定要删除本地监听端口 ${deletingMapping.port} 吗？`}
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
                取消
              </Button>
              <Button
                variant="danger"
                size="sm"
                loading={isDeleting}
                onClick={handleDeleteConfirm}
              >
                确认删除
              </Button>
            </>
          }
        >
          <div className="p-5">
            <p className="text-xs text-muted-foreground leading-relaxed">
              删除后，Mihomo 将立即释放端口{' '}
              <b className="text-foreground font-mono">
                {deletingMapping.port}
              </b>
              ，绑定的代理节点将不再接收该端口的流量。
            </p>
          </div>
        </Modal>
      )}
    </div>
  )
}
