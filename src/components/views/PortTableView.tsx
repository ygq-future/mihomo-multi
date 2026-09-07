import {
  AlertTriangle,
  Edit2,
  Loader2,
  Network,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Wrench,
  Zap,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import * as api from '../../services/tauri'
import { useAppStore } from '../../stores/appStore'
import type { LanIpInfo, PortDriftReport, PortMapping } from '../../types'
import {
  extractRegion,
  getLatencyBadgeProps,
  getProtocolBadgeProps,
} from '../../utils/proxy'
import {
  Badge,
  Button,
  Input,
  Modal,
  RegionFlag,
  Select,
  Switch,
  toast,
} from '../common'
import { AddPortModal } from '../ports/AddPortModal'
import { QuickCopyMenu } from '../ports/QuickCopyMenu'

export const PortTableView: React.FC = () => {
  const {
    coreStatus,
    config,
    fetchConfig,
    saveConfig,
    portMappings,
    occupiedPorts,
    driftReports,
    testingPortIds,
    isTestingAllPorts,
    fetchPortMappings,
    deletePortMapping,
    togglePortMapping,
    testPortDelay,
    testAllPortsDelay,
    fetchStatus,
    profiles,
    fetchProfiles,
    profileNodes,
    fetchProfileNodes,
    latencies,
    fallbackStatuses,
    fetchFallbackStatuses,
  } = useAppStore()
  const isRunning = coreStatus?.running ?? false

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

  // Search and filter state (Persistent)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedProtocol, setSelectedProtocol] = useState<string>(() => {
    return typeof window !== 'undefined'
      ? localStorage.getItem('port_filter_protocol') || 'all'
      : 'all'
  })
  const [selectedStatus, setSelectedStatus] = useState<string>(() => {
    return typeof window !== 'undefined'
      ? localStorage.getItem('port_filter_status') || 'all'
      : 'all'
  })

  useEffect(() => {
    fetchPortMappings().catch(() => {})
    fetchProfiles().catch(() => {})
    if (!config) {
      fetchConfig().catch(() => {})
    }
  }, [fetchPortMappings, fetchProfiles, config, fetchConfig])

  // Periodic fallback status check every 5s when core is running and has fallback mappings
  useEffect(() => {
    if (!isRunning) return
    const hasFallback = portMappings.some(
      (m) => m.enabled && m.fallbackNodeName,
    )
    if (!hasFallback) return

    fetchFallbackStatuses().catch(() => {})
    const interval = setInterval(() => {
      fetchFallbackStatuses().catch(() => {})
    }, 5000)

    return () => clearInterval(interval)
  }, [isRunning, portMappings, fetchFallbackStatuses])

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

  const handleProtocolFilterChange = (val: string) => {
    setSelectedProtocol(val)
    try {
      localStorage.setItem('port_filter_protocol', val)
    } catch {
      // ignore
    }
  }

  const handleStatusFilterChange = (val: string) => {
    setSelectedStatus(val)
    try {
      localStorage.setItem('port_filter_status', val)
    } catch {
      // ignore
    }
  }

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

  // Filtered and sorted port mappings (Ascending by port number)
  const filteredMappings = useMemo(() => {
    const list = portMappings.filter((m) => {
      const drift = driftMap[m.id]
      const isDrifted = drift && drift.status !== 'healthy'

      // Protocol filter
      if (selectedProtocol !== 'all' && m.protocol !== selectedProtocol) {
        return false
      }

      // Status filter
      if (selectedStatus === 'enabled' && !m.enabled) return false
      if (selectedStatus === 'disabled' && m.enabled) return false
      if (selectedStatus === 'drifted' && !isDrifted) return false
      if (
        selectedStatus === 'fallback' &&
        !fallbackStatuses[m.id]?.isFallbackActive
      ) {
        return false
      }
      // Search query filter (port, node_name, profile_name, description)
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase()
        const portStr = String(m.port)
        const nodeStr = m.nodeName.toLowerCase()
        const profStr = (profileMap[m.profileId] || '').toLowerCase()
        const descStr = (m.description || '').toLowerCase()

        return (
          portStr.includes(query) ||
          nodeStr.includes(query) ||
          profStr.includes(query) ||
          descStr.includes(query)
        )
      }

      return true
    })

    return list.sort((a, b) => a.port - b.port)
  }, [
    portMappings,
    driftMap,
    selectedProtocol,
    selectedStatus,
    searchQuery,
    profileMap,
    fallbackStatuses,
  ])

  const fallbackActiveCount = useMemo(() => {
    return Object.values(fallbackStatuses).filter((s) => s.isFallbackActive)
      .length
  }, [fallbackStatuses])
  const totalPorts = portMappings.length
  const activePorts = portMappings.filter((m) => m.enabled).length

  const handleToggle = async (m: PortMapping, checked: boolean) => {
    setTogglingPortIds((prev) => ({ ...prev, [m.id]: true }))
    try {
      await togglePortMapping(m.id, checked)
      fetchStatus().catch(() => {})
      toast.success(`端口 ${m.port} 已${checked ? '启用' : '禁用'}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setTogglingPortIds((prev) => ({ ...prev, [m.id]: false }))
    }
  }

  const handleDeleteConfirm = async () => {
    if (!deletingMapping) return
    setIsDeleting(true)
    try {
      await deletePortMapping(deletingMapping.id)
      fetchStatus().catch(() => {})
      toast.success(`端口 ${deletingMapping.port} 映射已删除`)
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

  const handleBatchDelayTest = async () => {
    await testAllPortsDelay()
    toast.success('全部已启用端口测速完成')
  }

  return (
    <div className="h-full flex flex-col p-6 space-y-4 w-full overflow-hidden">
      {/* Top Sticky Single-Row Action Bar Card */}
      <div className="bg-card border border-border rounded-xl p-3.5 shadow-sm shrink-0 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Left: Search Input + Protocol Filter + Status Filter */}
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <div className="flex-1 max-w-sm">
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索端口号、节点名、订阅或备注..."
              prefixIcon={
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
              }
              clearable
              onClear={() => setSearchQuery('')}
            />
          </div>

          <div className="w-28 shrink-0">
            <Select
              value={selectedProtocol}
              onChange={(val) => handleProtocolFilterChange(String(val))}
              options={[
                { value: 'all', label: '全部协议' },
                { value: 'mixed', label: 'Mixed' },
                { value: 'http', label: 'HTTP' },
                { value: 'socks5', label: 'SOCKS5' },
              ]}
            />
          </div>

          <div className="w-32 shrink-0">
            <Select
              value={selectedStatus}
              onChange={(val) => handleStatusFilterChange(String(val))}
              options={[
                { value: 'all', label: '全部状态' },
                { value: 'enabled', label: '仅已启用' },
                { value: 'disabled', label: '仅已停用' },
                {
                  value: 'drifted',
                  label: `⚠️ 异常漂移 (${
                    driftReports.filter((r) => r.status !== 'healthy').length
                  })`,
                },
                ...(fallbackActiveCount > 0
                  ? [
                      {
                        value: 'fallback',
                        label: `🛡️ 备用兜底 (${fallbackActiveCount})`,
                      },
                    ]
                  : []),
              ]}
            />
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
        ) : filteredMappings.length === 0 ? (
          <div className="border border-dashed border-border rounded-xl p-10 flex flex-col items-center justify-center text-center space-y-3 bg-card/20">
            <Search className="w-6 h-6 text-muted-foreground" />
            <div className="text-xs text-muted-foreground">
              未找到与当前搜索或筛选条件匹配的端口映射
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setSearchQuery('')
                handleProtocolFilterChange('all')
                handleStatusFilterChange('all')
              }}
            >
              重置筛选条件
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
            {filteredMappings.map((m) => {
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

              // 2. Bound proxy node network protocol (Vmess / Hy2 / SS / Trojan etc.)
              const node = (profileNodes[m.profileId] || []).find(
                (n) => n.name === m.nodeName,
              )
              const nodeProtocolProps = getProtocolBadgeProps(
                node?.type || 'unknown',
              )

              // State warning priorities:
              // 1. Highest: Kernel Stopped Warning (Amber)
              const isStoppedWarning = !isRunning && m.enabled
              // 2. Secondary: Port Occupied Conflict Warning (Rose)
              const isOccupiedWarning =
                isRunning && m.enabled && occupiedPorts.includes(m.port)
              // 3. Fallback Degraded Warning (Amber)
              const fbStatus = fallbackStatuses[m.id]
              const hasFallback = Boolean(m.fallbackNodeName)
              const isFallbackActive = fbStatus?.isFallbackActive ?? false
              const isFallbackWarning =
                isRunning && m.enabled && hasFallback && isFallbackActive

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
              const fbLatencyProps = getLatencyBadgeProps(fbLatency, isTesting)

              return (
                <div
                  key={m.id}
                  className={`p-3.5 rounded-xl border bg-card shadow-sm hover:border-primary/40 transition-all flex flex-col justify-between space-y-2.5 group ${
                    isStoppedWarning
                      ? 'border-amber-500/40 bg-amber-500/5 dark:bg-amber-500/10'
                      : isOccupiedWarning
                        ? 'border-rose-500/40 bg-rose-500/5 dark:bg-rose-500/10'
                        : !m.enabled
                          ? 'opacity-65 bg-secondary/10'
                          : isDrifted
                            ? 'border-amber-500/40 bg-amber-500/5 dark:bg-amber-500/10'
                            : isFallbackWarning
                              ? 'border-amber-500/60 bg-amber-500/5 dark:bg-amber-500/10'
                              : 'border-border'
                  }`}
                >
                  {/* Top Row: Local Port + Inbound Protocol Badge + Switch */}
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
                      ) : m.enabled && isRunning ? (
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
                      ) : isOccupiedWarning ? (
                        <span className="text-[10px] text-rose-500 font-medium shrink-0">
                          (端口冲突)
                        </span>
                      ) : isFallbackWarning ? (
                        <span className="text-[10px] text-amber-500 font-medium shrink-0">
                          (备用兜底)
                        </span>
                      ) : null}
                    </div>

                    <Switch
                      checked={m.enabled}
                      loading={!!togglingPortIds[m.id]}
                      onChange={(checked) => handleToggle(m, checked)}
                      disabled={isTesting || !!togglingPortIds[m.id]}
                      size="sm"
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
                          className={`truncate flex-1 font-semibold ${
                            isFallbackActive
                              ? 'text-muted-foreground line-through decoration-amber-500/60'
                              : ''
                          }`}
                          title={
                            profileName
                              ? `[${profileName}] ${m.nodeName}`
                              : m.nodeName
                          }
                        >
                          {m.nodeName}
                        </span>
                        {isFallbackActive && (
                          <Badge
                            variant="warning"
                            size="sm"
                            dot
                            className="!text-[10px] !py-0.5 !px-1.5 shrink-0 animate-pulse"
                            title="主节点连接超时或网络异常，已自动切换至备用节点"
                          >
                            主节点异常
                          </Badge>
                        )}
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

                      {/* Node Network Protocol Badge (Vmess, Hysteria2, Shadowsocks etc.) */}
                      {node?.type && (
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium border shrink-0 ${nodeProtocolProps.className}`}
                        >
                          {nodeProtocolProps.label}
                        </span>
                      )}
                    </div>

                    {/* Fallback Node Row */}
                    {hasFallback && (
                      <div
                        className={`flex items-center justify-between gap-1.5 text-[11px] px-2 py-1 rounded-md border transition-all ${
                          isFallbackActive
                            ? 'bg-amber-500/10 border-amber-500/30 text-foreground'
                            : 'bg-muted/20 border-dashed border-border/80 text-muted-foreground'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 min-w-0 flex-1 truncate">
                          <ShieldCheck
                            className={`w-3 h-3 shrink-0 ${
                              isFallbackActive
                                ? 'text-emerald-500 animate-pulse'
                                : 'text-muted-foreground/60'
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

                        {isFallbackActive ? (
                          <Badge
                            variant="primary"
                            size="sm"
                            dot
                            className="!text-[9px] !py-0 !px-1.5 shrink-0 bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/40 animate-pulse font-medium"
                          >
                            兜底接管中
                          </Badge>
                        ) : (
                          <span className="text-[10px] font-mono text-muted-foreground/70 shrink-0 bg-secondary/80 px-1 rounded">
                            待命
                          </span>
                        )}
                      </div>
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
                  <div className="pt-2 border-t border-border/50 flex items-center justify-between gap-1.5 text-[11px]">
                    {/* Latency Badges Area (Clickable for Single Delay Test) */}
                    <div className="flex items-center gap-1.5 min-w-0">
                      <button
                        type="button"
                        onClick={() => handleSingleDelayTest(m.id, m.port)}
                        disabled={!m.enabled || isTesting}
                        className="focus:outline-none flex items-center"
                        title={
                          hasFallback
                            ? '点击单端口测速 (同时测试主备节点)'
                            : '点击单端口测速'
                        }
                      >
                        <Badge
                          variant={latencyProps.variant}
                          size="sm"
                          dot={latencyProps.dot}
                          className="cursor-pointer hover:opacity-80 font-mono transition-opacity !text-[10px] !py-0.5 !px-1.5 flex items-center gap-1"
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
                        <Badge
                          variant={fbLatencyProps.variant}
                          size="sm"
                          dot={fbLatencyProps.dot}
                          className="font-mono !text-[10px] !py-0.5 !px-1.5 flex items-center gap-1"
                          title={`Fallback 备用节点 (${m.fallbackNodeName}) 延迟`}
                        >
                          <span className="font-sans font-semibold text-[9px] opacity-75">
                            备
                          </span>
                          {isTesting ? (
                            <span className="flex items-center gap-1">
                              <Loader2 className="w-2.5 h-2.5 animate-spin" />
                              测速中
                            </span>
                          ) : (
                            fbLatencyProps.label
                          )}
                        </Badge>
                      )}
                    </div>
                    {/* Actions Group */}
                    <div className="flex items-center gap-1 shrink-0">
                      <QuickCopyMenu
                        port={m.port}
                        protocol={m.protocol}
                        hostIp={activeHostIp}
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
