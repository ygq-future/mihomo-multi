import {
  AlertTriangle,
  ChevronDown,
  Copy,
  Edit2,
  Filter,
  Globe,
  Loader2,
  Network,
  Plus,
  Search,
  Terminal,
  Trash2,
  Wrench,
  Zap,
} from 'lucide-react'
import type React from 'react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '../../stores/appStore'
import type { InboundProtocol, PortDriftReport, PortMapping } from '../../types'
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

interface QuickCopyMenuProps {
  port: number
  protocol: InboundProtocol
  onCopySuccess: (text: string) => void
}

const QuickCopyMenu: React.FC<QuickCopyMenuProps> = ({
  port,
  protocol,
  onCopySuccess,
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{
    top: number
    left: number
    placement: 'top' | 'bottom'
  } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const menuHeight = 220
    const shouldPlaceTop = spaceBelow < menuHeight && rect.top > menuHeight

    const top = shouldPlaceTop ? rect.top - menuHeight - 4 : rect.bottom + 4
    const left = Math.max(
      8,
      Math.min(rect.right - 224, window.innerWidth - 232),
    )

    setMenuPos({
      top,
      left,
      placement: shouldPlaceTop ? 'top' : 'bottom',
    })
  }, [])

  useLayoutEffect(() => {
    if (isOpen) {
      updatePos()
    }
  }, [isOpen, updatePos])

  useEffect(() => {
    if (!isOpen) return
    const handleEvents = (e: MouseEvent | KeyboardEvent | Event) => {
      const target = e.target as Node
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return
      }
      setIsOpen(false)
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false)
      }
    }

    window.addEventListener('resize', updatePos)
    window.addEventListener('scroll', updatePos, true)
    document.addEventListener('mousedown', handleEvents)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('resize', updatePos)
      window.removeEventListener('scroll', updatePos, true)
      document.removeEventListener('mousedown', handleEvents)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, updatePos])

  const copyOptions = [
    {
      label: '纯地址 (Host:Port)',
      value: `127.0.0.1:${port}`,
      desc: `127.0.0.1:${port}`,
    },
    {
      label: 'HTTP 代理 URL',
      value: `http://127.0.0.1:${port}`,
      desc: `http://127.0.0.1:${port}`,
    },
    {
      label: 'SOCKS5 代理 URL',
      value: `socks5://127.0.0.1:${port}`,
      desc: `socks5://127.0.0.1:${port}`,
    },
    {
      label: 'cURL 出口 IP 探测命令',
      value: `curl -x ${protocol === 'socks5' ? 'socks5' : 'http'}://127.0.0.1:${port} -s https://api.ip.sb/geoip`,
      desc: '一键在终端测试该端口出口 IP',
      icon: <Terminal className="w-3 h-3 text-muted-foreground" />,
    },
  ]

  const handleCopy = (val: string, label: string) => {
    navigator.clipboard.writeText(val).catch(() => {})
    onCopySuccess(`已复制 ${label}: ${val}`)
    setIsOpen(false)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center gap-0.5"
        title="快捷复制代理格式"
      >
        <Copy className="w-3 h-3" />
        <ChevronDown className="w-2.5 h-2.5 opacity-60" />
      </button>

      {isOpen &&
        menuPos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              top: `${menuPos.top}px`,
              left: `${menuPos.left}px`,
              width: '224px',
              zIndex: 99999,
            }}
            className={`p-1 bg-card border border-border rounded-xl shadow-2xl ${
              menuPos.placement === 'top'
                ? 'animate-in fade-in slide-in-from-bottom-2 duration-150'
                : 'animate-in fade-in slide-in-from-top-2 duration-150'
            }`}
          >
            <div className="px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground border-b border-border/50">
              快捷复制代理格式
            </div>
            <div className="p-1 space-y-0.5">
              {copyOptions.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => handleCopy(opt.value, opt.label)}
                  className="w-full text-left p-1.5 rounded-lg hover:bg-accent hover:text-accent-foreground transition-colors group"
                >
                  <div className="flex items-center justify-between text-xs font-medium text-foreground">
                    <div className="flex items-center gap-1.5">
                      {opt.icon || (
                        <Copy className="w-3 h-3 text-muted-foreground group-hover:text-primary" />
                      )}
                      <span>{opt.label}</span>
                    </div>
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">
                    {opt.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}

export const PortTableView: React.FC = () => {
  const {
    coreStatus,
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
  }, [fetchPortMappings, fetchProfiles])

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
  ])

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

          <div className="w-32 shrink-0">
            <Select
              value={selectedProtocol}
              onChange={(val) => handleProtocolFilterChange(String(val))}
              options={[
                { value: 'all', label: '全部协议' },
                { value: 'mixed', label: 'Mixed' },
                { value: 'http', label: 'HTTP' },
                { value: 'socks5', label: 'SOCKS5' },
              ]}
              prefixIcon={
                <Filter className="w-3.5 h-3.5 text-muted-foreground" />
              }
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
              ]}
            />
          </div>
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

                      {isStoppedWarning ? (
                        <span className="text-[10px] text-amber-500 font-medium shrink-0">
                          (监听已停止)
                        </span>
                      ) : isOccupiedWarning ? (
                        <span className="text-[10px] text-rose-500 font-medium shrink-0">
                          (端口冲突)
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
                        <span
                          className="truncate flex-1 font-semibold"
                          title={m.nodeName}
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

                      {/* Node Network Protocol Badge (Vmess, Hysteria2, Shadowsocks etc.) */}
                      {node?.type && (
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium border shrink-0 ${nodeProtocolProps.className}`}
                        >
                          {nodeProtocolProps.label}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                      <span
                        className="truncate flex items-center gap-1"
                        title={profileName}
                      >
                        <Globe className="w-3 h-3 shrink-0" />
                        {profileName}
                      </span>
                      {m.description && (
                        <span
                          className="truncate max-w-[120px] text-right italic"
                          title={m.description}
                        >
                          {m.description}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Bottom Row: Latency Badge + Actions */}
                  <div className="pt-2 border-t border-border/50 flex items-center justify-between gap-1.5 text-[11px]">
                    {/* Latency Badge (Clickable for Single Delay Test) */}
                    <button
                      type="button"
                      onClick={() => handleSingleDelayTest(m.id, m.port)}
                      disabled={!m.enabled || isTesting}
                      className="focus:outline-none"
                      title="点击单端口测速"
                    >
                      <Badge
                        variant={latencyProps.variant}
                        size="sm"
                        dot={latencyProps.dot}
                        className="cursor-pointer hover:opacity-80 font-mono transition-opacity !text-[10px] !py-0.5 !px-1.5"
                      >
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

                    {/* Actions Group */}
                    <div className="flex items-center gap-1 shrink-0">
                      <QuickCopyMenu
                        port={m.port}
                        protocol={m.protocol}
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
        >
          <div className="p-5 space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              删除后，Mihomo 将立即释放端口{' '}
              <b className="text-foreground font-mono">
                {deletingMapping.port}
              </b>
              ，绑定的代理节点将不再接收该端口的流量。
            </p>

            <div className="pt-2 flex items-center justify-end gap-2 border-t border-border">
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
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
