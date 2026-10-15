import {
  Check,
  ExternalLink,
  Loader2,
  Plus,
  Radar,
  RotateCcw,
  Square,
  XCircle,
} from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FIXED_DIRECT_PORT_ID } from '../../constants'
import { createEventScope } from '../../services/events'
import * as api from '../../services/tauri'
import type { PortMapping, PortRuleMatchType, ProfileItem } from '../../types'
import {
  type CapturedHostRecord,
  aggregateCapturedDomains,
  mergeAccessLogsIntoCapturedRecords,
  mergeSnapshotIntoCapturedRecords,
  normalizeProbeUrl,
  upsertSeedHostRecord,
} from '../../utils/domainExtractor'
import { getLatencyColor } from '../../utils/proxy'
import {
  Badge,
  Button,
  Input,
  Segmented,
  Select,
  type SelectOption,
  toast,
} from '../common'

interface TrafficSnifferPanelProps {
  isOpen: boolean
  isGlobal: boolean
  mapping: PortMapping | null
  portMappings: PortMapping[]
  profiles: ProfileItem[]
  latencies: Record<string, number | null>
  coreRunning: boolean
  matchType: PortRuleMatchType
  customDomains: string
  onAppendDomains: (domains: string[], suggestedRuleName?: string) => void
}

export const TrafficSnifferPanel: React.FC<TrafficSnifferPanelProps> = ({
  isOpen,
  isGlobal,
  mapping,
  portMappings,
  profiles,
  latencies,
  coreRunning,
  matchType,
  customDomains,
  onAppendDomains,
}) => {
  const [snifferOpen, setSnifferOpen] = useState(false)
  const [isSniffing, setIsSniffing] = useState(false)
  const [probeUrlInput, setProbeUrlInput] = useState('')
  const [sniffMode, setSniffMode] = useState<'root' | 'full'>('root')

  const getPortLatency = useCallback(
    (p: PortMapping): number | null => {
      if (p.id === FIXED_DIRECT_PORT_ID || p.nodeName === 'DIRECT') {
        return p.latency ?? null
      }
      const isFbActive = p.manualFallback && Boolean(p.fallbackNodeName)
      const activeNodeName = isFbActive ? p.fallbackNodeName! : p.nodeName
      const activeProfileId = isFbActive
        ? p.fallbackProfileId || p.profileId
        : p.profileId
      const prof = profiles.find((pr) => pr.id === activeProfileId)
      const runtimeKey = prof
        ? `[${prof.name}] ${activeNodeName}`
        : activeNodeName

      if (runtimeKey in latencies && latencies[runtimeKey] !== undefined) {
        return latencies[runtimeKey]
      }
      if (
        activeNodeName in latencies &&
        latencies[activeNodeName] !== undefined
      ) {
        return latencies[activeNodeName]
      }
      return p.latency ?? null
    },
    [profiles, latencies],
  )

  const sortedEnabledMappings = useMemo(() => {
    const enabled = portMappings.filter((m) => m.enabled)
    return [...enabled].sort((a, b) => {
      const aIsDirect = a.id === FIXED_DIRECT_PORT_ID || a.nodeName === 'DIRECT'
      const bIsDirect = b.id === FIXED_DIRECT_PORT_ID || b.nodeName === 'DIRECT'
      if (aIsDirect !== bIsDirect) return aIsDirect ? 1 : -1

      const latA = getPortLatency(a)
      const latB = getPortLatency(b)
      const hasA = latA !== undefined && latA !== null && latA > 0
      const hasB = latB !== undefined && latB !== null && latB > 0

      if (hasA && hasB) return (latA as number) - (latB as number)
      if (hasA && !hasB) return -1
      if (!hasA && hasB) return 1
      return a.port - b.port
    })
  }, [portMappings, getPortLatency])

  const testPortOptions = useMemo<SelectOption<number>[]>(() => {
    return sortedEnabledMappings.map((m) => {
      const isDirect = m.id === FIXED_DIRECT_PORT_ID || m.nodeName === 'DIRECT'
      const isFbActive = m.manualFallback && Boolean(m.fallbackNodeName)
      const activeNodeName = isFbActive ? m.fallbackNodeName! : m.nodeName
      const lat = getPortLatency(m)
      const hasLat = lat !== undefined && lat !== null && lat > 0

      return {
        value: m.port,
        label: `:${m.port} (${isDirect ? 'DIRECT 直连' : activeNodeName})`,
        rightNode: hasLat ? (
          <span
            className={`font-mono text-[11px] font-medium ${getLatencyColor(
              lat,
            )}`}
          >
            {lat} ms
          </span>
        ) : null,
      }
    })
  }, [sortedEnabledMappings, getPortLatency])

  const defaultTestPort = useMemo<number | null>(() => {
    if (!isGlobal && mapping) return mapping.port
    return sortedEnabledMappings[0]?.port ?? null
  }, [isGlobal, mapping, sortedEnabledMappings])

  const [selectedTestPort, setSelectedTestPort] = useState<number | null>(
    defaultTestPort,
  )
  const [sandboxPort, setSandboxPort] = useState<number | null>(null)
  const [pageLoaded, setPageLoaded] = useState(false)
  const [sandboxFinished, setSandboxFinished] = useState(false)
  const [capturedRecordsMap, setCapturedRecordsMap] = useState<
    Map<string, CapturedHostRecord>
  >(() => new Map())
  const [unselectedDomains, setUnselectedDomains] = useState<Set<string>>(
    () => new Set(),
  )

  const recordsRef = useRef<Map<string, CapturedHostRecord>>(new Map())
  const baselineTrafficRef = useRef<Map<string, number>>(new Map())
  const seenConnIdsRef = useRef<Set<string>>(new Set())
  const seenLogKeysRef = useRef<Set<string>>(new Set())
  const sessionStartMsRef = useRef<number>(Date.now())
  const isInitialPollRef = useRef<boolean>(true)
  const isPollingRef = useRef<boolean>(false)
  const isSandboxActiveRef = useRef<boolean>(false)

  useEffect(() => {
    setSelectedTestPort(defaultTestPort)
  }, [defaultTestPort])

  useEffect(() => {
    if (matchType === 'domain') {
      setSniffMode('full')
    } else if (matchType === 'domain-suffix') {
      setSniffMode('root')
    }
  }, [matchType])

  const resetCaptureBuffers = useCallback(
    (clearRecords: boolean, graceMs = 0) => {
      const now = Date.now()
      baselineTrafficRef.current.clear()
      seenConnIdsRef.current.clear()
      seenLogKeysRef.current.clear()
      sessionStartMsRef.current = now - graceMs
      isInitialPollRef.current = true
      setPageLoaded(false)
      setSandboxFinished(false)
      if (clearRecords) {
        recordsRef.current = new Map()
        setCapturedRecordsMap(new Map())
        setUnselectedDomains(new Set())
      }
    },
    [],
  )

  const stopProbeSession = useCallback(
    (closeWebview = true, markFinished = false) => {
      isSandboxActiveRef.current = false
      setIsSniffing(false)
      if (markFinished) {
        setSandboxFinished(true)
      }
      if (closeWebview) {
        void api.closeSnifferWebview()
      }
    },
    [],
  )

  const resetSnifferSession = useCallback(() => {
    stopProbeSession(true, false)
    setSnifferOpen(false)
    setProbeUrlInput('')
    setSandboxPort(null)
    setSelectedTestPort(defaultTestPort)
    isPollingRef.current = false
    resetCaptureBuffers(true)
  }, [defaultTestPort, resetCaptureBuffers, stopProbeSession])

  useEffect(() => {
    if (!isOpen) {
      resetSnifferSession()
    }
  }, [isOpen, resetSnifferSession])

  useEffect(() => {
    if (!isOpen || !snifferOpen) return
    const scope = createEventScope()
    void scope.listen<string>('sniffer-page-loading', () => {
      if (isSandboxActiveRef.current) {
        setPageLoaded(false)
      }
    })
    void scope.listen<string>('sniffer-page-loaded', () => {
      if (isSandboxActiveRef.current) {
        setPageLoaded(true)
      }
    })
    void scope.listen('sniffer-window-closed', () => {
      if (isSandboxActiveRef.current) {
        stopProbeSession(false, true)
        toast.success('沙盒窗口已关闭，已锁定本次捕获的关联域名')
      }
    })
    return () => {
      scope.dispose()
    }
  }, [isOpen, snifferOpen, stopProbeSession])
  const pollSnifferConnections = useCallback(async () => {
    if (isPollingRef.current) return
    isPollingRef.current = true
    try {
      const [connRes, logRes] = await Promise.allSettled([
        api.getConnections(),
        api.getSniffedAccessLogs(sessionStartMsRef.current),
      ])
      const now = Date.now()
      let nextRecords = recordsRef.current

      if (connRes.status === 'fulfilled') {
        const isInitial = isInitialPollRef.current
        isInitialPollRef.current = false
        nextRecords = mergeSnapshotIntoCapturedRecords(
          nextRecords,
          baselineTrafficRef.current,
          seenConnIdsRef.current,
          connRes.value.connections,
          now,
          isInitial,
          sessionStartMsRef.current,
        )
      }

      if (logRes.status === 'fulfilled' && logRes.value.length > 0) {
        nextRecords = mergeAccessLogsIntoCapturedRecords(
          nextRecords,
          seenLogKeysRef.current,
          logRes.value,
        )
      }

      if (nextRecords !== recordsRef.current) {
        recordsRef.current = nextRecords
        setCapturedRecordsMap(nextRecords)
      }
    } catch {
      // 忽略单次轮询抖动
    } finally {
      isPollingRef.current = false
    }
  }, [])
  useEffect(() => {
    if (!isOpen || !isSniffing) {
      return
    }
    void pollSnifferConnections()
    const timer = setInterval(() => {
      void pollSnifferConnections()
    }, 300)
    return () => clearInterval(timer)
  }, [isOpen, isSniffing, pollSnifferConnections])

  const existingCustomDomainsSet = useMemo(() => {
    const set = new Set<string>()
    for (const line of customDomains.split('\n')) {
      const trimmed = line.trim().toLowerCase()
      if (trimmed) set.add(trimmed)
    }
    return set
  }, [customDomains])

  const activePortFilter = useMemo<number | 'all'>(() => {
    if (sandboxPort !== null) return sandboxPort
    if (!isGlobal && mapping) return mapping.port
    if (selectedTestPort !== null) return selectedTestPort
    return 'all'
  }, [sandboxPort, isGlobal, mapping, selectedTestPort])

  const aggregatedSniffDomains = useMemo(() => {
    return aggregateCapturedDomains(Array.from(capturedRecordsMap.values()), {
      mode: sniffMode,
      hideNoise: true,
      portFilter: activePortFilter,
    })
  }, [capturedRecordsMap, sniffMode, activePortFilter])

  const selectedSniffDomains = useMemo(() => {
    return aggregatedSniffDomains.filter(
      (item) =>
        !existingCustomDomainsSet.has(item.domain) &&
        !unselectedDomains.has(item.domain),
    )
  }, [aggregatedSniffDomains, existingCustomDomainsSet, unselectedDomains])

  const handleFinishAndCloseSandbox = () => {
    stopProbeSession(true, true)
    toast.success('已关闭沙盒并完成链路域名采集')
  }

  const handleLaunchAndSniff = async () => {
    const parsed = normalizeProbeUrl(probeUrlInput)
    if (!parsed) {
      toast.warning('请输入有效的目标网址或域名，例如 ip.skk.moe')
      return
    }
    if (!coreRunning) {
      toast.warning('请先启动 Mihomo 内核后再进行流量链路嗅探')
      return
    }
    const preferredPort = !isGlobal && mapping ? mapping.port : selectedTestPort
    try {
      const boundPort = await api.openSnifferWebview(parsed.url, preferredPort)
      const now = Date.now()
      resetCaptureBuffers(true, 0)
      isSandboxActiveRef.current = true

      const boundPortStr = String(boundPort)
      setSandboxPort(boundPort)
      setSelectedTestPort(boundPort)

      const nextRecords = upsertSeedHostRecord(
        recordsRef.current,
        parsed.hostname,
        boundPortStr,
        now,
      )
      recordsRef.current = nextRecords
      setCapturedRecordsMap(nextRecords)
      setIsSniffing(true)
      toast.info(
        `已弹出内置沙盒加载 ${parsed.hostname} (出口 :${boundPort})，确认页面加载完成后关闭沙盒窗口即可`,
      )
    } catch (err) {
      isSandboxActiveRef.current = false
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleToggleSniffDomainSelect = (domain: string) => {
    if (existingCustomDomainsSet.has(domain)) return
    setUnselectedDomains((prev) => {
      const next = new Set(prev)
      if (next.has(domain)) {
        next.delete(domain)
      } else {
        next.add(domain)
      }
      return next
    })
  }

  const handleAppendSelected = () => {
    if (selectedSniffDomains.length === 0) return
    const domainsToAppend = selectedSniffDomains.map((d) => d.domain)
    const parsed = normalizeProbeUrl(probeUrlInput)
    onAppendDomains(domainsToAppend, parsed?.hostname || domainsToAppend[0])
    stopProbeSession(true, false)
  }
  const handleClearRecords = () => {
    resetCaptureBuffers(true)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor="custom-domains-textarea"
          className="text-xs font-medium text-foreground block"
        >
          匹配项列表 (一行一个域名、正则或 IP 网段)
        </label>
        <button
          type="button"
          onClick={() => setSnifferOpen((prev) => !prev)}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all border ${
            isSniffing
              ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30 shadow-xs'
              : snifferOpen
                ? 'bg-primary/10 text-primary border-primary/30'
                : 'bg-muted/60 text-muted-foreground hover:text-foreground border-border/60'
          }`}
        >
          <Radar
            className={`w-3.5 h-3.5 ${isSniffing ? 'animate-spin' : ''}`}
          />
          {isSniffing
            ? `正在嗅探链路 (${aggregatedSniffDomains.length})`
            : '智能链路嗅探采集'}
        </button>
      </div>

      {snifferOpen && (
        <div className="p-3 rounded-xl border border-primary/25 bg-primary/[0.03] space-y-2.5 animate-fade-in">
          {/* 第一行：输入探测网址 + 沙盒嗅探 / 完成并关闭沙盒 */}
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <Input
                placeholder="输入目标网址弹出内置沙盒嗅探全链路 (如 https://chatgpt.com)..."
                value={probeUrlInput}
                onChange={(e) => setProbeUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && probeUrlInput.trim()) {
                    e.preventDefault()
                    void handleLaunchAndSniff()
                  }
                }}
                className="h-8 text-xs bg-background"
              />
            </div>
            {isSniffing ? (
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`inline-flex items-center gap-1 px-2 h-8 rounded-lg border text-[11px] font-medium ${
                    pageLoaded
                      ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                      : 'bg-amber-500/10 text-amber-500 border-amber-500/30'
                  }`}
                  title={
                    pageLoaded
                      ? '沙盒页面 DOM 与静态资源已加载完成，可随时关闭沙盒'
                      : '沙盒浏览器正在加载网页资源与接口...'
                  }
                >
                  {pageLoaded ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>页面加载完成</span>
                    </>
                  ) : (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>网页加载中...</span>
                    </>
                  )}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  onClick={handleFinishAndCloseSandbox}
                  className="h-8 px-2.5 text-[11px] gap-1 shrink-0"
                  title="关闭内置沙盒窗口并锁定当前捕获到的所有域名"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  完成并关闭
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="primary"
                disabled={!probeUrlInput.trim()}
                onClick={() => void handleLaunchAndSniff()}
                className="h-8 px-3 text-[11px] gap-1.5 shrink-0"
                title="弹出内置无痕 WebView 沙盒并通过指定测试端口访问该网址"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                打开沙盒嗅探
              </Button>
            )}
          </div>

          {/* 第二行：聚合模式、加长出口选择器（含延迟排序与展示）与清空按钮 */}
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Segmented<'root' | 'full'>
                size="sm"
                value={sniffMode}
                onChange={setSniffMode}
                options={[
                  { value: 'root', label: '主域名收敛' },
                  { value: 'full', label: '完整子域名' },
                ]}
              />

              {isGlobal ? (
                <Select<number>
                  size="sm"
                  filterable={false}
                  value={selectedTestPort ?? 0}
                  onChange={(val) => setSelectedTestPort(val)}
                  disabled={isSniffing || testPortOptions.length === 0}
                  options={testPortOptions}
                  placeholder="无可用启用端口"
                  width="flex-1 min-w-[200px]"
                  className="h-[30px] text-[11px]"
                />
              ) : mapping ? (
                <Badge
                  variant="outline"
                  className="text-[10px] py-0.5 px-2 font-mono text-muted-foreground truncate"
                >
                  隔离出口 :{mapping.port} ({mapping.nodeName})
                </Badge>
              ) : null}
            </div>

            {capturedRecordsMap.size > 0 && (
              <button
                type="button"
                onClick={handleClearRecords}
                className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors shrink-0"
                title="清空已捕获记录"
              >
                <RotateCcw className="w-3 h-3" />
                清空
              </button>
            )}
          </div>
          {/* 第三行：捕获到的域名列表 */}
          {aggregatedSniffDomains.length === 0 ? (
            <div className="py-4 px-3 rounded-lg bg-background/60 border border-dashed border-border/70 text-center text-[11px] text-muted-foreground">
              {isSniffing ? (
                <span className="inline-flex items-center gap-1.5 text-foreground/80">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                  沙盒窗口运行中，正在实时捕获请求链路，网页加载完成后关闭沙盒窗口即可...
                </span>
              ) : (
                <span>
                  上方输入目标网址点「打开沙盒嗅探」，在弹出的内置无痕沙盒窗口中查看网页，加载完成后关闭沙盒即可完整提取关联域名
                </span>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                {aggregatedSniffDomains.map((item) => {
                  const alreadyAdded = existingCustomDomainsSet.has(item.domain)
                  const isSelected =
                    !alreadyAdded && !unselectedDomains.has(item.domain)
                  const extraSubCount = item.subdomains.filter(
                    (s) => s !== item.domain,
                  ).length

                  return (
                    <button
                      key={item.domain}
                      type="button"
                      disabled={alreadyAdded}
                      onClick={() => handleToggleSniffDomainSelect(item.domain)}
                      className={`w-full px-2.5 py-1.5 rounded-lg border text-left transition-all flex items-center justify-between gap-2 text-xs ${
                        alreadyAdded
                          ? 'bg-muted/40 border-border/40 opacity-60 cursor-default'
                          : isSelected
                            ? 'bg-background border-primary/40 shadow-2xs'
                            : 'bg-background/50 border-border/50 opacity-75 hover:opacity-100'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {alreadyAdded ? (
                          <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        ) : isSelected ? (
                          <div className="w-3.5 h-3.5 rounded bg-primary text-primary-foreground flex items-center justify-center shrink-0">
                            <Check className="w-2.5 h-2.5" />
                          </div>
                        ) : (
                          <Square className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        )}
                        <span className="font-mono font-medium text-foreground truncate">
                          {item.domain}
                        </span>
                        {sniffMode === 'root' && extraSubCount > 0 && (
                          <span
                            className="text-[10px] text-muted-foreground truncate hidden sm:inline"
                            title={item.subdomains.join(', ')}
                          >
                            ({item.subdomains[0]}
                            {extraSubCount > 1
                              ? ` 等 ${item.subdomains.length} 个子域`
                              : ''}
                            )
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {alreadyAdded ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] py-0 px-1.5 text-emerald-500 border-emerald-500/30"
                          >
                            已在列表中
                          </Badge>
                        ) : (
                          <>
                            <span title={`当前命中规则: ${item.rule}`}>
                              <Badge
                                variant="outline"
                                className="text-[10px] font-mono py-0 px-1.5 max-w-28 truncate"
                              >
                                {item.chain}
                              </Badge>
                            </span>
                            <span className="text-[10px] font-mono text-muted-foreground">
                              ×{item.hitCount}
                            </span>
                          </>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>

              {/* 底部批量操作栏 */}
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/50 text-[11px]">
                <div className="flex items-center gap-2 text-muted-foreground flex-wrap">
                  <span>
                    共捕获{' '}
                    <strong className="text-foreground font-mono">
                      {aggregatedSniffDomains.length}
                    </strong>{' '}
                    个域名
                  </span>
                  {isSniffing && pageLoaded && (
                    <Badge
                      variant="outline"
                      className="text-[10px] py-0 px-1.5 text-emerald-500 border-emerald-500/30"
                    >
                      页面已就绪，可关闭沙盒
                    </Badge>
                  )}
                  {sandboxFinished && !isSniffing && (
                    <Badge
                      variant="outline"
                      className="text-[10px] py-0 px-1.5 text-emerald-500 border-emerald-500/30"
                    >
                      已完成沙盒采集
                    </Badge>
                  )}
                  <span>·</span>
                  <button
                    type="button"
                    onClick={() => setUnselectedDomains(new Set())}
                    className="text-primary hover:underline"
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setUnselectedDomains(
                        new Set(aggregatedSniffDomains.map((d) => d.domain)),
                      )
                    }
                    className="text-muted-foreground hover:text-foreground hover:underline"
                  >
                    全不选
                  </button>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleAppendSelected}
                  disabled={selectedSniffDomains.length === 0}
                  className="h-7 px-2.5 text-[11px] gap-1"
                >
                  <Plus className="w-3 h-3" />
                  追加选中域名 ({selectedSniffDomains.length})
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
