import {
  Activity,
  AlertCircle,
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  Clock,
  Eye,
  Info,
  Pause,
  Play,
  RefreshCw,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../../services/tauri'
import { useWindowVisibility } from '../../services/useWindowVisibility'
import { useAppStore } from '../../stores/appStore'
import type { ConnectionItem, ConnectionSnapshot } from '../../types'
import { formatBytes, formatTraffic } from '../../utils/traffic'
import { formatUptime } from '../../utils/time'
import { Badge, Button, Input, Modal, Select, toast } from '../common'

const POLL_INTERVAL_MS = 1500

function getHostDisplay(meta: {
  host?: string
  destinationIP: string
  destinationPort: string
}): string {
  return meta.host || `${meta.destinationIP}:${meta.destinationPort}`
}
type SortField = 'speed' | 'download' | 'duration'

interface ConnSpeedMetrics {
  downloadSpeed: number
  uploadSpeed: number
  totalSpeed: number
}

export const ConnectionListView: React.FC = () => {
  const coreStatus = useAppStore((state) => state.coreStatus)
  const isWindowVisible = useWindowVisibility()
  const isRunning = coreStatus?.running ?? false

  const [snapshot, setSnapshot] = useState<ConnectionSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPort, setSelectedPort] = useState<string>('all')
  const [selectedProtocol, setSelectedProtocol] = useState<string>('all')
  const [sortField, setSortField] = useState<SortField>('speed')
  const [selectedConnId, setSelectedConnId] = useState<string | null>(null)
  const [cachedConn, setCachedConn] = useState<ConnectionItem | null>(null)
  const [showCloseAllModal, setShowCloseAllModal] = useState(false)
  const [closingId, setClosingId] = useState<string | null>(null)
  const [closingAll, setClosingAll] = useState(false)

  // Overall speed calculation states
  const prevSnapshotRef = useRef<{
    downloadTotal: number
    uploadTotal: number
    time: number
  } | null>(null)
  const [globalDownloadSpeed, setGlobalDownloadSpeed] = useState<number>(0)
  const [globalUploadSpeed, setGlobalUploadSpeed] = useState<number>(0)

  // Per-connection speed calculation map
  const prevConnsRef = useRef<
    Map<string, { upload: number; download: number; time: number }>
  >(new Map())
  const [connSpeeds, setConnSpeeds] = useState<
    Record<string, ConnSpeedMetrics>
  >({})

  const fetchConnections = useCallback(
    async (showLoadingSpinner = false) => {
      if (!isRunning) return
      if (showLoadingSpinner) setLoading(true)

      try {
        const data = await api.getConnections()
        const now = Date.now()

        // 1. Calculate overall global speeds
        if (prevSnapshotRef.current) {
          const deltaSec = (now - prevSnapshotRef.current.time) / 1000
          if (deltaSec > 0.4) {
            const downDelta =
              data.downloadTotal - prevSnapshotRef.current.downloadTotal
            const upDelta =
              data.uploadTotal - prevSnapshotRef.current.uploadTotal
            setGlobalDownloadSpeed(Math.max(0, downDelta / deltaSec))
            setGlobalUploadSpeed(Math.max(0, upDelta / deltaSec))
          }
        }

        prevSnapshotRef.current = {
          downloadTotal: data.downloadTotal,
          uploadTotal: data.uploadTotal,
          time: now,
        }

        // 2. Calculate per-connection speeds
        const nextSpeeds: Record<string, ConnSpeedMetrics> = {}
        const nextMap = new Map<
          string,
          { upload: number; download: number; time: number }
        >()

        for (const c of data.connections) {
          const prev = prevConnsRef.current.get(c.id)
          let downSpeed = 0
          let upSpeed = 0
          if (prev) {
            const deltaSec = (now - prev.time) / 1000
            if (deltaSec > 0.4) {
              downSpeed = Math.max(0, (c.download - prev.download) / deltaSec)
              upSpeed = Math.max(0, (c.upload - prev.upload) / deltaSec)
            }
          }
          nextSpeeds[c.id] = {
            downloadSpeed: downSpeed,
            uploadSpeed: upSpeed,
            totalSpeed: downSpeed + upSpeed,
          }
          nextMap.set(c.id, {
            upload: c.upload,
            download: c.download,
            time: now,
          })
        }

        prevConnsRef.current = nextMap
        setConnSpeeds(nextSpeeds)
        setSnapshot(data)
      } catch (err) {
        console.warn('Failed to fetch connections:', err)
      } finally {
        if (showLoadingSpinner) setLoading(false)
      }
    },
    [isRunning],
  )

  // Polling loop
  useEffect(() => {
    if (!isRunning) {
      setSnapshot(null)
      setGlobalDownloadSpeed(0)
      setGlobalUploadSpeed(0)
      prevSnapshotRef.current = null
      prevConnsRef.current.clear()
      setConnSpeeds({})
      return
    }

    if (!isWindowVisible || isPaused) return

    fetchConnections()
    const timer = setInterval(() => {
      fetchConnections()
    }, POLL_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [isRunning, isWindowVisible, isPaused, fetchConnections])

  // Single connection close
  const handleCloseConnection = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setClosingId(id)
    try {
      await api.closeConnection(id)
      toast.success('连接已断开')
      setSnapshot((prev) => {
        if (!prev) return null
        return {
          ...prev,
          connections: prev.connections.filter((c) => c.id !== id),
        }
      })
      if (selectedConnId === id) {
        setSelectedConnId(null)
        setCachedConn(null)
      }
    } catch (err) {
      toast.error(`断开连接失败: ${String(err)}`)
    } finally {
      setClosingId(null)
    }
  }

  // Close all connections
  const handleConfirmCloseAll = async () => {
    setClosingAll(true)
    try {
      await api.closeAllConnections()
      toast.success('所有连接已断开')
      setSnapshot((prev) => {
        if (!prev) return null
        return {
          ...prev,
          connections: [],
        }
      })
      setSelectedConnId(null)
      setCachedConn(null)
      setShowCloseAllModal(false)
    } catch (err) {
      toast.error(`断开全部连接失败: ${String(err)}`)
    } finally {
      setClosingAll(false)
    }
  }

  // Available unique inbound ports for filtering
  const availablePorts = useMemo(() => {
    if (!snapshot) return []
    const ports = new Set<string>()
    for (const c of snapshot.connections) {
      if (c.metadata.inboundPort) {
        ports.add(c.metadata.inboundPort)
      }
    }
    return Array.from(ports).sort(
      (a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10),
    )
  }, [snapshot])

  // Filtered & Sorted connections
  const displayConnections = useMemo(() => {
    if (!snapshot) return []
    const query = searchQuery.trim().toLowerCase()

    const filtered = snapshot.connections.filter((c) => {
      if (selectedPort !== 'all') {
        if (c.metadata.inboundPort !== selectedPort) return false
      }

      if (selectedProtocol !== 'all') {
        const net = (c.metadata.network || '').toLowerCase()
        if (net !== selectedProtocol) return false
      }

      if (!query) return true

      const host = (c.metadata.host || '').toLowerCase()
      const destIp = (c.metadata.destinationIP || '').toLowerCase()
      const destPort = (c.metadata.destinationPort || '').toLowerCase()
      const proc = (c.metadata.process || '').toLowerCase()
      const rule = (c.rule || '').toLowerCase()
      const chains = (c.chains || []).join(' ').toLowerCase()

      return (
        host.includes(query) ||
        destIp.includes(query) ||
        destPort.includes(query) ||
        proc.includes(query) ||
        rule.includes(query) ||
        chains.includes(query)
      )
    })

    // Sort connections
    return filtered.sort((a, b) => {
      if (sortField === 'speed') {
        const speedA = connSpeeds[a.id]?.totalSpeed ?? 0
        const speedB = connSpeeds[b.id]?.totalSpeed ?? 0
        if (speedB !== speedA) return speedB - speedA
        return b.download - a.download
      }
      if (sortField === 'download') {
        return b.download - a.download
      }
      if (sortField === 'duration') {
        const timeA = new Date(a.start).getTime() || 0
        const timeB = new Date(b.start).getTime() || 0
        return timeA - timeB
      }
      return 0
    })
  }, [
    snapshot,
    selectedPort,
    selectedProtocol,
    searchQuery,
    sortField,
    connSpeeds,
  ])

  const selectedConn = useMemo(() => {
    if (!selectedConnId) return null
    const live = snapshot?.connections.find((c) => c.id === selectedConnId)
    return live || cachedConn
  }, [snapshot, selectedConnId, cachedConn])

  const selectedConnSpeed = useMemo(() => {
    if (!selectedConnId) return null
    return connSpeeds[selectedConnId] || null
  }, [selectedConnId, connSpeeds])

  const handleOpenDetail = (conn: ConnectionItem) => {
    setSelectedConnId(conn.id)
    setCachedConn(conn)
  }

  const calculateDuration = (startTime: string) => {
    try {
      const startMs = new Date(startTime).getTime()
      if (Number.isNaN(startMs)) return '-'
      const diffSecs = Math.max(0, Math.floor((Date.now() - startMs) / 1000))
      return formatUptime(diffSecs)
    } catch {
      return '-'
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden p-6 gap-3.5">
      {/* 1. Fixed Top Row: Overview Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
        <div className="p-3.5 rounded-xl border border-border bg-card shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">当前活跃连接</span>
            <Activity className="w-4 h-4 text-primary" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold tracking-tight">
              {snapshot ? snapshot.connections.length : 0}
            </span>
            <span className="text-xs text-muted-foreground">个</span>
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-border bg-card shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">实时总速率</span>
            <div className="flex items-center gap-1">
              <ArrowDown className="w-3.5 h-3.5 text-emerald-500" />
              <ArrowUp className="w-3.5 h-3.5 text-sky-500" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xs font-semibold text-emerald-500">
              ↓ {formatTraffic(globalDownloadSpeed)}
            </span>
            <span className="text-xs font-semibold text-sky-500">
              ↑ {formatTraffic(globalUploadSpeed)}
            </span>
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-border bg-card shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">累计下载流量</span>
            <ArrowDown className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="mt-2">
            <span className="text-lg font-bold tracking-tight">
              {snapshot ? formatBytes(snapshot.downloadTotal) : '0 B'}
            </span>
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-border bg-card shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">累计上传流量</span>
            <ArrowUp className="w-4 h-4 text-sky-500" />
          </div>
          <div className="mt-2">
            <span className="text-lg font-bold tracking-tight">
              {snapshot ? formatBytes(snapshot.uploadTotal) : '0 B'}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Fixed Top Row: Search & Filter Controls with Integrated Actions */}
      <div className="flex items-center justify-between gap-2.5 bg-card p-2.5 rounded-xl border border-border shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="flex-1 min-w-[140px] max-w-xs">
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索域名 / IP / 进程 / 节点..."
              prefixIcon={<Search className="w-4 h-4 text-muted-foreground" />}
              clearable
              onClear={() => setSearchQuery('')}
            />
          </div>

          {/* Inbound Port Selector */}
          <div className="w-28 shrink-0">
            <Select
              value={selectedPort}
              onChange={(val) => setSelectedPort(val)}
              options={[
                { value: 'all', label: '所有端口' },
                ...availablePorts.map((p) => ({
                  value: p,
                  label: `端口 ${p}`,
                })),
              ]}
            />
          </div>

          {/* Protocol Selector */}
          <div className="w-24 shrink-0">
            <Select
              value={selectedProtocol}
              onChange={(val) => setSelectedProtocol(val)}
              options={[
                { value: 'all', label: '所有协议' },
                { value: 'tcp', label: 'TCP' },
                { value: 'udp', label: 'UDP' },
              ]}
            />
          </div>

          {/* Sort Selector */}
          <div className="w-32 shrink-0">
            <Select
              value={sortField}
              onChange={(val) => setSortField(val as SortField)}
              options={[
                { value: 'speed', label: '按实时网速 ↓' },
                { value: 'download', label: '按累计流量 ↓' },
                { value: 'duration', label: '按持续时长 ↓' },
              ]}
            />
          </div>
        </div>

        {/* Action Controls & Item Count */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground mr-1 hidden sm:inline whitespace-nowrap">
            {displayConnections.length} /{' '}
            {snapshot ? snapshot.connections.length : 0} 条
          </span>

          <Button
            variant={isPaused ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setIsPaused(!isPaused)}
            title={isPaused ? '继续自动刷新' : '暂停自动刷新'}
            className="gap-1 px-2.5"
          >
            {isPaused ? (
              <>
                <Play className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">继续</span>
              </>
            ) : (
              <>
                <Pause className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">暂停</span>
              </>
            )}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchConnections(true)}
            disabled={loading || !isRunning}
            title="立即刷新"
            className="px-2.5"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
            />
          </Button>

          <Button
            variant="danger"
            size="sm"
            onClick={() => setShowCloseAllModal(true)}
            disabled={
              !snapshot || snapshot.connections.length === 0 || !isRunning
            }
            title="断开所有连接"
            className="gap-1 px-2.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">断开全部</span>
          </Button>
        </div>
      </div>

      {/* 3. Scrollable Table Container: Takes all remaining space */}
      <div className="flex-1 min-h-0 rounded-xl border border-border bg-card overflow-hidden shadow-sm flex flex-col">
        {!isRunning ? (
          <div className="m-auto py-16 text-center text-muted-foreground flex flex-col items-center justify-center gap-2">
            <AlertCircle className="w-8 h-8 text-amber-500/80" />
            <p className="text-sm font-medium">Mihomo 内核未启动</p>
            <p className="text-xs text-muted-foreground">
              请在主界面或设置中启动代理内核后查看实时连接
            </p>
          </div>
        ) : displayConnections.length === 0 ? (
          <div className="m-auto py-16 text-center text-muted-foreground flex flex-col items-center justify-center gap-2">
            <Activity className="w-8 h-8 text-muted-foreground/40" />
            <p className="text-sm font-medium">当前无匹配的活跃连接</p>
            <p className="text-xs text-muted-foreground">
              {searchQuery ||
              selectedPort !== 'all' ||
              selectedProtocol !== 'all'
                ? '尝试清除筛选条件查看所有连接'
                : '当有网络流量通过监听端口时将实时展示在此处'}
            </p>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-secondary/90 backdrop-blur-sm sticky top-0 z-10 border-b border-border text-muted-foreground uppercase font-medium text-[11px] select-none shadow-sm">
                <tr>
                  <th className="py-2.5 px-3">目标地址</th>
                  <th className="py-2.5 px-3">入站端口</th>
                  <th className="py-2.5 px-3">出口节点 / 链路</th>
                  <th className="py-2.5 px-3">规则 / 进程</th>
                  <th className="py-2.5 px-3 text-right">
                    <span className="inline-flex items-center gap-1">
                      <span>实时速率</span>
                      <ArrowDownUp className="w-3 h-3 text-muted-foreground/70" />
                    </span>
                  </th>
                  <th className="py-2.5 px-3 text-right">累计总流量</th>
                  <th className="py-2.5 px-3 text-right">持续时长</th>
                  <th className="py-2.5 px-3 text-center w-20">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {displayConnections.map((conn) => {
                  const hostDisplay = getHostDisplay(conn.metadata)
                  const lastChain =
                    conn.chains && conn.chains.length > 0
                      ? conn.chains[conn.chains.length - 1]
                      : '-'
                  const isClosing = closingId === conn.id
                  const speed = connSpeeds[conn.id] || {
                    downloadSpeed: 0,
                    uploadSpeed: 0,
                    totalSpeed: 0,
                  }

                  return (
                    <tr
                      key={conn.id}
                      className="hover:bg-accent/40 transition-colors cursor-pointer group"
                      onClick={() => handleOpenDetail(conn)}
                    >
                      {/* Destination Host & Protocol */}
                      <td className="py-2 px-3">
                        <div className="flex flex-col gap-0.5 max-w-[240px]">
                          <div className="flex items-center gap-1.5 truncate">
                            <Badge
                              variant="outline"
                              size="sm"
                              className="uppercase font-mono text-[9px] px-1 shrink-0"
                            >
                              {conn.metadata.network || 'TCP'}
                            </Badge>
                            <span
                              className="font-medium text-foreground truncate"
                              title={hostDisplay}
                            >
                              {hostDisplay}
                            </span>
                          </div>
                          {conn.metadata.host && (
                            <span className="text-[10px] text-muted-foreground font-mono truncate">
                              {conn.metadata.destinationIP}:
                              {conn.metadata.destinationPort}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Inbound Port */}
                      <td className="py-2 px-3">
                        {conn.metadata.inboundPort ? (
                          <Badge
                            variant="primary"
                            size="sm"
                            className="font-mono text-[10px]"
                          >
                            :{conn.metadata.inboundPort}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>

                      {/* Outbound Chains */}
                      <td className="py-2 px-3">
                        <div
                          className="flex flex-col max-w-[170px] truncate"
                          title={conn.chains?.join(' → ')}
                        >
                          <span className="font-medium text-foreground truncate">
                            {lastChain}
                          </span>
                          {conn.chains && conn.chains.length > 1 && (
                            <span className="text-[10px] text-muted-foreground truncate">
                              {conn.chains.slice(0, -1).join(' → ')}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Rule & Process */}
                      <td className="py-2 px-3">
                        <div className="flex flex-col gap-0.5 max-w-[150px]">
                          <span
                            className="text-[11px] font-mono text-foreground/90 truncate"
                            title={conn.rule}
                          >
                            {conn.rule || 'Direct'}
                          </span>
                          {conn.metadata.process && (
                            <span
                              className="text-[10px] text-muted-foreground truncate"
                              title={
                                conn.metadata.processPath ||
                                conn.metadata.process
                              }
                            >
                              {conn.metadata.process}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Real-time Speeds */}
                      <td className="py-2 px-3 text-right">
                        <div className="flex flex-col items-end gap-0.5">
                          <span
                            className={`font-mono font-medium ${
                              speed.downloadSpeed > 0
                                ? 'text-emerald-500'
                                : 'text-muted-foreground/60'
                            }`}
                          >
                            ↓ {formatTraffic(speed.downloadSpeed)}
                          </span>
                          <span
                            className={`text-[10px] font-mono ${
                              speed.uploadSpeed > 0
                                ? 'text-sky-500'
                                : 'text-muted-foreground/40'
                            }`}
                          >
                            ↑ {formatTraffic(speed.uploadSpeed)}
                          </span>
                        </div>
                      </td>

                      {/* Cumulative Total Traffic */}
                      <td className="py-2 px-3 text-right">
                        <div className="flex flex-col items-end gap-0.5 text-muted-foreground">
                          <span className="font-medium text-foreground text-[11px]">
                            {formatBytes(conn.download + conn.upload)}
                          </span>
                          <span className="text-[10px]">
                            ↓{formatBytes(conn.download)} ↑
                            {formatBytes(conn.upload)}
                          </span>
                        </div>
                      </td>

                      {/* Duration */}
                      <td className="py-2 px-3 text-right">
                        <div className="flex items-center justify-end gap-1 text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          <span>{calculateDuration(conn.start)}</span>
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="py-2 px-3 text-center">
                        <div className="flex items-center justify-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleOpenDetail(conn)
                            }}
                            className="h-6 w-6 text-muted-foreground hover:text-foreground"
                            title="查看连接详情"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </Button>

                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => handleCloseConnection(conn.id, e)}
                            disabled={isClosing}
                            className="h-6 w-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            title="断开此连接"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 4. Connection Detail Modal: Correct padding p-5 and Standard Footer */}
      {selectedConn && (
        <Modal
          isOpen={Boolean(selectedConn)}
          onClose={() => {
            setSelectedConnId(null)
            setCachedConn(null)
          }}
          title="连接详细信息"
          subtitle={getHostDisplay(selectedConn.metadata)}
          icon={<Activity className="w-4 h-4 text-primary" />}
          maxWidth="lg"
          footer={
            <div className="w-full flex items-center justify-between">
              <Button
                variant="danger"
                size="sm"
                className="gap-1.5"
                onClick={(e) => handleCloseConnection(selectedConn.id, e)}
              >
                <Trash2 className="w-3.5 h-3.5" />
                断开此连接
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedConnId(null)
                  setCachedConn(null)
                }}
              >
                关闭
              </Button>
            </div>
          }
        >
          <div className="p-5 space-y-4 text-xs">
            {/* Essential Info Grid */}
            <div className="grid grid-cols-2 gap-3 p-3.5 rounded-lg bg-secondary/30 border border-border">
              <div>
                <span className="text-muted-foreground block text-[11px]">
                  目标主机 (Host)
                </span>
                <span className="font-semibold text-foreground text-sm break-all">
                  {getHostDisplay(selectedConn.metadata)}
                </span>
              </div>

              <div>
                <span className="text-muted-foreground block text-[11px]">
                  入站端口
                </span>
                <span className="font-semibold text-primary text-sm font-mono">
                  {selectedConn.metadata.inboundPort
                    ? `:${selectedConn.metadata.inboundPort}`
                    : '默认'}
                  {selectedConn.metadata.inboundName && (
                    <span className="text-xs text-muted-foreground ml-1.5 font-normal">
                      ({selectedConn.metadata.inboundName})
                    </span>
                  )}
                </span>
              </div>

              <div>
                <span className="text-muted-foreground block text-[11px]">
                  网络与类型
                </span>
                <span className="font-medium text-foreground uppercase">
                  {selectedConn.metadata.network} /{' '}
                  {selectedConn.metadata.type || 'TCP'}
                </span>
              </div>

              <div>
                <span className="text-muted-foreground block text-[11px]">
                  持续时间
                </span>
                <span className="font-medium text-foreground">
                  {calculateDuration(selectedConn.start)} (建立于{' '}
                  {new Date(selectedConn.start).toLocaleTimeString()})
                </span>
              </div>
            </div>

            {/* Live Speeds & Cumulative Traffic Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-lg border border-border bg-card">
              <div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <ArrowDown className="w-3 h-3 text-emerald-500" />
                  实时下行
                </div>
                <div className="font-semibold text-emerald-500 font-mono mt-0.5">
                  {formatTraffic(selectedConnSpeed?.downloadSpeed ?? 0)}
                </div>
              </div>

              <div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <ArrowUp className="w-3 h-3 text-sky-500" />
                  实时上行
                </div>
                <div className="font-semibold text-sky-500 font-mono mt-0.5">
                  {formatTraffic(selectedConnSpeed?.uploadSpeed ?? 0)}
                </div>
              </div>

              <div>
                <div className="text-[11px] text-muted-foreground">
                  累计已下载
                </div>
                <div className="font-semibold text-foreground mt-0.5">
                  {formatBytes(selectedConn.download)}
                </div>
              </div>

              <div>
                <div className="text-[11px] text-muted-foreground">
                  累计已上传
                </div>
                <div className="font-semibold text-foreground mt-0.5">
                  {formatBytes(selectedConn.upload)}
                </div>
              </div>
            </div>

            {/* Metadata Detail Table */}
            <div className="space-y-1.5 border border-border rounded-lg p-3.5 bg-background/50">
              <div className="font-medium text-foreground mb-2 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-primary" />
                <span>网络与路由元数据</span>
              </div>

              <div className="grid grid-cols-3 gap-y-2 text-[11px]">
                <span className="text-muted-foreground">连接 ID</span>
                <span className="col-span-2 font-mono text-foreground break-all select-all">
                  {selectedConn.id}
                </span>

                <span className="text-muted-foreground">源地址</span>
                <span className="col-span-2 font-mono text-foreground">
                  {selectedConn.metadata.sourceIP}:
                  {selectedConn.metadata.sourcePort}
                </span>

                <span className="text-muted-foreground">目标 IP</span>
                <span className="col-span-2 font-mono text-foreground">
                  {selectedConn.metadata.destinationIP}:
                  {selectedConn.metadata.destinationPort}
                </span>

                {selectedConn.metadata.sniffHost && (
                  <>
                    <span className="text-muted-foreground">嗅探域名</span>
                    <span className="col-span-2 text-foreground font-mono">
                      {selectedConn.metadata.sniffHost}
                    </span>
                  </>
                )}

                {selectedConn.metadata.dnsMode && (
                  <>
                    <span className="text-muted-foreground">DNS 模式</span>
                    <span className="col-span-2 text-foreground">
                      {selectedConn.metadata.dnsMode}
                    </span>
                  </>
                )}

                <span className="text-muted-foreground">命中规则</span>
                <span className="col-span-2 text-foreground font-mono">
                  {selectedConn.rule}{' '}
                  {selectedConn.rulePayload
                    ? `(${selectedConn.rulePayload})`
                    : ''}
                </span>

                <span className="text-muted-foreground">代理链路</span>
                <span className="col-span-2 text-foreground font-medium">
                  {selectedConn.chains?.join(' → ') || 'DIRECT'}
                </span>

                {selectedConn.metadata.process && (
                  <>
                    <span className="text-muted-foreground">所属进程</span>
                    <span className="col-span-2 text-foreground font-medium">
                      {selectedConn.metadata.process}
                    </span>
                  </>
                )}

                {selectedConn.metadata.processPath && (
                  <>
                    <span className="text-muted-foreground">进程路径</span>
                    <span
                      className="col-span-2 text-foreground font-mono break-all select-all text-[10px]"
                      title={selectedConn.metadata.processPath}
                    >
                      {selectedConn.metadata.processPath}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* 5. Close All Confirmation Modal: Proper Padding */}
      {showCloseAllModal && (
        <Modal
          isOpen={showCloseAllModal}
          onClose={() => setShowCloseAllModal(false)}
          title="确认断开所有连接"
          maxWidth="sm"
          footer={
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowCloseAllModal(false)}
                disabled={closingAll}
              >
                取消
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleConfirmCloseAll}
                disabled={closingAll}
                className="gap-1.5"
              >
                {closingAll && (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                )}
                确认断开
              </Button>
            </div>
          }
        >
          <div className="p-5 space-y-2">
            <p className="text-xs text-muted-foreground leading-relaxed">
              确定要断开当前所有的活跃连接吗？所有正在传输的 TCP/UDP
              长连接将被立即终止。
            </p>
          </div>
        </Modal>
      )}
    </div>
  )
}
