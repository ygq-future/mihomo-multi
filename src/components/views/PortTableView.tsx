import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  Copy,
  Edit2,
  Filter,
  Globe,
  Loader2,
  Network,
  Plus,
  Radio,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Terminal,
  Trash2,
  Wrench,
  X,
  Zap,
} from 'lucide-react'
import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../../stores/appStore'
import type { InboundProtocol, PortDriftReport, PortMapping } from '../../types'
import { getLatencyColor } from '../../utils/proxy'
import { Badge, Button, Input, Modal, Select, Switch, toast } from '../common'
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
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

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
      value: `curl -x ${protocol === 'socks5' ? 'socks5' : 'http'}://127.0.0.1:${port} https://ipinfo.io`,
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
    <div ref={menuRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 text-xs"
        title="快捷复制代理参数"
      >
        <Copy className="w-3.5 h-3.5" />
        <ChevronDown className="w-2.5 h-2.5 opacity-60" />
      </button>

      {isOpen && (
        <div className="absolute right-0 z-50 mt-1 w-64 p-1 bg-card border border-border rounded-xl shadow-xl animate-in fade-in zoom-in-95 duration-100">
          <div className="px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground border-b border-border/50">
            快捷复制代理格式
          </div>
          <div className="p-1 space-y-0.5">
            {copyOptions.map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={() => handleCopy(opt.value, opt.label)}
                className="w-full text-left p-2 rounded-lg hover:bg-accent hover:text-accent-foreground transition-colors group"
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
        </div>
      )}
    </div>
  )
}

export const PortTableView: React.FC = () => {
  const {
    portMappings,
    driftReports,
    testingPortIds,
    isTestingAllPorts,
    portError,
    fetchPortMappings,
    deletePortMapping,
    togglePortMapping,
    testPortDelay,
    testAllPortsDelay,
    setPortError,
    fetchStatus,
    profiles,
    fetchProfiles,
    profileNodes,
    fetchProfileNodes,
  } = useAppStore()

  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [editingMapping, setEditingMapping] = useState<PortMapping | null>(null)
  const [deletingMapping, setDeletingMapping] = useState<PortMapping | null>(
    null,
  )
  const [isDeleting, setIsDeleting] = useState(false)

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedProtocol, setSelectedProtocol] = useState<string>('all')
  const [selectedStatus, setSelectedStatus] = useState<string>('all')

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

  // Drift map for easy lookup
  const driftMap = useMemo(() => {
    const map: Record<string, PortDriftReport> = {}
    for (const r of driftReports) {
      map[r.mappingId] = r
    }
    return map
  }, [driftReports])

  // Count of active ports with drift
  const driftedActiveCount = useMemo(() => {
    return portMappings.filter((m) => {
      const report = driftMap[m.id]
      return m.enabled && report && report.status !== 'healthy'
    }).length
  }, [portMappings, driftMap])

  // Profile map for easy name lookup
  const profileMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const p of profiles) {
      map[p.id] = p.name
    }
    return map
  }, [profiles])

  // Filtered port mappings
  const filteredMappings = useMemo(() => {
    return portMappings.filter((m) => {
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
    try {
      await togglePortMapping(m.id, checked)
      fetchStatus().catch(() => {})
      toast.success(`端口 ${m.port} 已${checked ? '启用' : '禁用'}`)
    } catch {
      // Error handled in store
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
    <div className="p-6 space-y-6 w-full">
      {/* Error Alert Banner */}
      {portError && (
        <div className="p-3 text-xs bg-destructive/10 border border-destructive/20 text-destructive rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{portError}</span>
          </div>
          <button
            type="button"
            onClick={() => setPortError(null)}
            className="text-destructive hover:opacity-80 p-0.5 rounded"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Top Banner / Actions Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              总监听端口:{' '}
              <b className="text-foreground font-mono">{totalPorts}</b>
            </span>
            <span className="text-muted-foreground">•</span>
            <span className="text-xs font-medium text-emerald-500">
              已启用: <b className="font-mono">{activePorts}</b>
            </span>
          </div>

          {activePorts > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleBatchDelayTest}
              loading={isTestingAllPorts}
              icon={<Zap className="w-3.5 h-3.5 text-amber-500" />}
            >
              一键测速
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
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

      {/* Filter and Search Bar */}
      {totalPorts > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-card/50 p-3 rounded-xl border border-border">
          {/* Search Box */}
          <div className="flex-1 min-w-[200px]">
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

          {/* Protocol Filter */}
          <div className="w-36">
            <Select
              value={selectedProtocol}
              onChange={(val) => setSelectedProtocol(String(val))}
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

          {/* Status Filter */}
          <div className="w-36">
            <Select
              value={selectedStatus}
              onChange={(val) => setSelectedStatus(String(val))}
              options={[
                { value: 'all', label: '全部状态' },
                { value: 'enabled', label: '仅已启用' },
                { value: 'disabled', label: '仅已停用' },
                {
                  value: 'drifted',
                  label: `⚠️ 异常漂移 (${driftReports.filter((r) => r.status !== 'healthy').length})`,
                },
              ]}
            />
          </div>
        </div>
      )}

      {/* Node Drift Alert Banner */}
      {driftedActiveCount > 0 && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/25 text-foreground space-y-2 animate-in fade-in duration-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 font-semibold text-amber-600 dark:text-amber-400 text-xs">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
              <span>
                检测到 {driftedActiveCount}{' '}
                个已启用端口的绑定节点在订阅更新后发生漂移/失效
              </span>
            </div>
            {selectedStatus !== 'drifted' && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7 text-amber-600 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                onClick={() => setSelectedStatus('drifted')}
                icon={<Filter className="w-3 h-3" />}
              >
                仅查看异常端口
              </Button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            为严格保障多环境隔离（如指纹浏览器）与出口 IP
            确定性，系统已自动为失效端口激活 <b>DIRECT 直连安全兜底</b>
            ，严禁模糊轮询或流量污染。请点击「编辑」或「修复」按钮重新绑定最新节点。
          </p>
        </div>
      )}

      {/* Main Content Area */}
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
              点击下方按钮，分配独立本地入站端口（如
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

          <div className="pt-4 flex items-center gap-4 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              毫秒级配置热重载
            </span>
            <span className="flex items-center gap-1">
              <ShieldAlert className="w-3.5 h-3.5 text-emerald-500" />
              1:1 确定性路由
            </span>
          </div>
        </div>
      ) : filteredMappings.length === 0 ? (
        <div className="border border-dashed border-border rounded-xl p-8 text-center space-y-2 bg-card/30">
          <p className="text-xs text-muted-foreground">
            未找到与当前搜索或筛选条件匹配的端口映射
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearchQuery('')
              setSelectedProtocol('all')
              setSelectedStatus('all')
            }}
          >
            重置筛选条件
          </Button>
        </div>
      ) : (
        /* Port Mapping Table / Card List */
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border bg-secondary/30 text-muted-foreground font-medium">
                  <th className="py-3 px-4 w-28">本地端口</th>
                  <th className="py-3 px-3 w-28">入站协议</th>
                  <th className="py-3 px-4">绑定代理节点</th>
                  <th className="py-3 px-3 w-28 text-center">实时延迟</th>
                  <th className="py-3 px-4">备注描述</th>
                  <th className="py-3 px-3 w-24 text-center">启停状态</th>
                  <th className="py-3 px-4 w-32 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredMappings.map((m) => {
                  const isTesting = testingPortIds[m.id] || false
                  const profileName = profileMap[m.profileId] || '未知订阅'
                  const drift = driftMap[m.id]
                  const isDrifted = drift && drift.status !== 'healthy'

                  return (
                    <tr
                      key={m.id}
                      className={`hover:bg-accent/40 transition-colors ${
                        !m.enabled
                          ? 'opacity-65 bg-secondary/10'
                          : isDrifted
                            ? 'bg-amber-500/5 dark:bg-amber-500/10 border-l-2 border-l-amber-500'
                            : ''
                      }`}
                    >
                      {/* Port Number & Copy */}
                      <td className="py-3.5 px-4 font-mono">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-foreground text-sm">
                            {m.port}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard
                                .writeText(`127.0.0.1:${m.port}`)
                                .catch(() => {})
                              toast.success(`已复制 127.0.0.1:${m.port}`)
                            }}
                            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                            title="复制 127.0.0.1:<port>"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      </td>

                      {/* Protocol Badge */}
                      <td className="py-3.5 px-3">
                        <Badge
                          variant={
                            m.protocol === 'mixed'
                              ? 'primary'
                              : m.protocol === 'socks5'
                                ? 'warning'
                                : 'secondary'
                          }
                          size="sm"
                          className="uppercase font-mono font-medium"
                        >
                          {m.protocol}
                        </Badge>
                      </td>

                      {/* Bound Proxy Node */}
                      <td className="py-3.5 px-4">
                        <div className="space-y-1 min-w-[200px]">
                          <div className="flex items-center gap-1.5 font-medium text-foreground flex-wrap">
                            <Radio className="w-3.5 h-3.5 text-primary shrink-0" />
                            <span
                              className="truncate max-w-[180px]"
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
                                title={
                                  drift?.message ||
                                  '节点在订阅中不存在，流量已安全直连 (DIRECT)'
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
                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <Globe className="w-3 h-3 shrink-0" />
                            <span className="truncate" title={profileName}>
                              {profileName}
                            </span>
                          </div>

                          {/* Quick Suggestion Pill */}
                          {isDrifted &&
                            drift?.suggestions &&
                            drift.suggestions.length > 0 && (
                              <div className="flex items-center gap-1 pt-0.5 text-[10px] text-muted-foreground">
                                <span className="flex items-center gap-0.5 text-amber-500 font-medium">
                                  <Sparkles className="w-3 h-3" />
                                  建议:
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingMapping(m)
                                    setIsAddModalOpen(true)
                                  }}
                                  className="text-foreground hover:text-primary underline truncate max-w-[160px]"
                                  title={`点击修复并选择建议节点「${drift.suggestions[0]}」`}
                                >
                                  {drift.suggestions[0]}
                                </button>
                              </div>
                            )}
                        </div>
                      </td>

                      {/* Latency */}
                      <td className="py-3.5 px-3 text-center">
                        <div className="inline-flex items-center justify-center gap-1">
                          {isTesting ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                          ) : m.latency !== undefined && m.latency !== null ? (
                            <span
                              className={`font-mono font-medium flex items-center gap-1 ${getLatencyColor(
                                m.latency,
                              )}`}
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-current" />
                              {m.latency} ms
                            </span>
                          ) : (
                            <span className="text-muted-foreground/60 text-[11px]">
                              未测速
                            </span>
                          )}

                          {m.enabled && (
                            <button
                              type="button"
                              onClick={() =>
                                handleSingleDelayTest(m.id, m.port)
                              }
                              disabled={isTesting}
                              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                              title="单端口延迟测速"
                            >
                              <RefreshCw
                                className={`w-3 h-3 ${
                                  isTesting ? 'animate-spin' : ''
                                }`}
                              />
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Description */}
                      <td className="py-3.5 px-4 text-muted-foreground text-xs max-w-xs truncate">
                        {m.description || '-'}
                      </td>

                      {/* Toggle Switch */}
                      <td className="py-3.5 px-3 text-center">
                        <Switch
                          checked={m.enabled}
                          onChange={(checked) => handleToggle(m, checked)}
                          disabled={isTesting}
                          size="md"
                        />
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {/* Quick Copy Helper Menu */}
                          <QuickCopyMenu
                            port={m.port}
                            protocol={m.protocol}
                            onCopySuccess={toast.success}
                          />

                          {/* Quick Repair Button if drifted */}
                          {isDrifted && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingMapping(m)
                                setIsAddModalOpen(true)
                              }}
                              className="p-1.5 rounded-md hover:bg-amber-500/15 text-amber-500 transition-colors"
                              title="修复漂移/失效的节点绑定"
                            >
                              <Wrench className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* Edit Button */}
                          <button
                            type="button"
                            onClick={() => {
                              setEditingMapping(m)
                              setIsAddModalOpen(true)
                            }}
                            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                            title="编辑端口映射"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          {/* Delete Button */}
                          <button
                            type="button"
                            onClick={() => setDeletingMapping(m)}
                            className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                            title="删除端口映射"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
