import {
  Check,
  ExternalLink,
  Plus,
  Radar,
  Radio,
  RotateCcw,
  Square,
} from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../../services/tauri'
import type { PortMapping, PortRuleMatchType } from '../../types'
import {
  type CapturedHostRecord,
  aggregateCapturedDomains,
  mergeAccessLogsIntoCapturedRecords,
  mergeSnapshotIntoCapturedRecords,
  normalizeProbeUrl,
  upsertSeedHostRecord,
} from '../../utils/domainExtractor'
import { Badge, Button, Input, Segmented, Switch, toast } from '../common'

interface TrafficSnifferPanelProps {
  isOpen: boolean
  isGlobal: boolean
  mapping: PortMapping | null
  coreRunning: boolean
  matchType: PortRuleMatchType
  customDomains: string
  onAppendDomains: (domains: string[], suggestedRuleName?: string) => void
}

export const TrafficSnifferPanel: React.FC<TrafficSnifferPanelProps> = ({
  isOpen,
  isGlobal,
  mapping,
  coreRunning,
  matchType,
  customDomains,
  onAppendDomains,
}) => {
  const [snifferOpen, setSnifferOpen] = useState(false)
  const [isSniffing, setIsSniffing] = useState(false)
  const [probeUrlInput, setProbeUrlInput] = useState('')
  const [sniffMode, setSniffMode] = useState<'root' | 'full'>('root')
  const [sniffHideNoise, setSniffHideNoise] = useState(true)
  const [sniffPortFilter, setSniffPortFilter] = useState<string>('all')
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
  // 当外部 matchType 切换为 domain / domain-suffix 时，自动同步收敛粒度
  useEffect(() => {
    if (matchType === 'domain') {
      setSniffMode('full')
    } else if (matchType === 'domain-suffix') {
      setSniffMode('root')
    }
  }, [matchType])

  const resetCaptureBuffers = useCallback(
    (clearRecords: boolean, graceMs = 0) => {
      baselineTrafficRef.current.clear()
      seenConnIdsRef.current.clear()
      seenLogKeysRef.current.clear()
      sessionStartMsRef.current = Date.now() - graceMs
      isInitialPollRef.current = true
      if (clearRecords) {
        recordsRef.current = new Map()
        setCapturedRecordsMap(new Map())
        setUnselectedDomains(new Set())
      }
    },
    [],
  )

  const resetSnifferSession = useCallback(() => {
    setIsSniffing(false)
    setSnifferOpen(false)
    setProbeUrlInput('')
    setSniffPortFilter('all')
    isPollingRef.current = false
    resetCaptureBuffers(true)
  }, [resetCaptureBuffers])

  useEffect(() => {
    if (!isOpen) {
      resetSnifferSession()
    }
  }, [isOpen, resetSnifferSession])

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
    }, 700)
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

  const resolvedPortFilter = useMemo<number | 'all'>(() => {
    if (sniffPortFilter === 'all') return 'all'
    const parsed = Number.parseInt(sniffPortFilter, 10)
    return Number.isNaN(parsed) ? 'all' : parsed
  }, [sniffPortFilter])

  const aggregatedSniffDomains = useMemo(() => {
    return aggregateCapturedDomains(Array.from(capturedRecordsMap.values()), {
      mode: sniffMode,
      hideNoise: sniffHideNoise,
      portFilter: resolvedPortFilter,
    })
  }, [capturedRecordsMap, sniffMode, sniffHideNoise, resolvedPortFilter])

  const selectedSniffDomains = useMemo(() => {
    return aggregatedSniffDomains.filter(
      (item) =>
        !existingCustomDomainsSet.has(item.domain) &&
        !unselectedDomains.has(item.domain),
    )
  }, [aggregatedSniffDomains, existingCustomDomainsSet, unselectedDomains])

  const handleToggleSniffing = () => {
    if (isSniffing) {
      setIsSniffing(false)
      return
    }
    if (!coreRunning) {
      toast.warning('请先启动 Mihomo 内核后再进行流量链路嗅探')
      return
    }
    resetCaptureBuffers(false, 2000)
    setIsSniffing(true)
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
    if (!isSniffing) {
      resetCaptureBuffers(false, 2000)
    }
    const seedPort = !isGlobal && mapping ? String(mapping.port) : null
    const nextRecords = upsertSeedHostRecord(
      recordsRef.current,
      parsed.hostname,
      seedPort,
      Date.now(),
    )
    recordsRef.current = nextRecords
    setCapturedRecordsMap(nextRecords)
    setIsSniffing(true)
    await api.openExternalUrl(parsed.url)
    toast.info(`已打开 ${parsed.hostname}，正在实时捕获整条请求链路域名...`)
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
    setIsSniffing(false)
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
          {/* 第一行：输入探测网址自动打开 + 监听控制 */}
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <Input
                placeholder="输入目标网址打开并嗅探全链路 (如 ip.skk.moe)..."
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
            {probeUrlInput.trim() && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleLaunchAndSniff()}
                className="h-8 px-2.5 text-[11px] gap-1 shrink-0 bg-background"
                title="在浏览器打开该网址并实时捕获页面触发的所有关联域名"
              >
                <ExternalLink className="w-3 h-3" />
                打开并嗅探
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant={isSniffing ? 'danger' : 'primary'}
              onClick={handleToggleSniffing}
              className="h-8 px-2.5 text-[11px] gap-1 shrink-0"
            >
              <Radio
                className={`w-3 h-3 ${isSniffing ? 'animate-pulse' : ''}`}
              />
              {isSniffing ? '停止嗅探' : '开始监听'}
            </Button>
          </div>

          {/* 第二行：聚合模式、端口过滤与噪音开关 */}
          <div className="flex items-center justify-between gap-2 flex-wrap text-[11px]">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Segmented<'root' | 'full'>
                size="sm"
                value={sniffMode}
                onChange={setSniffMode}
                options={[
                  { value: 'root', label: '主域名收敛' },
                  { value: 'full', label: '完整子域名' },
                ]}
              />

              {!isGlobal && mapping && (
                <Segmented<string>
                  size="sm"
                  value={sniffPortFilter}
                  onChange={setSniffPortFilter}
                  options={[
                    { value: 'all', label: '全部入站' },
                    {
                      value: String(mapping.port),
                      label: `仅端口 ${mapping.port}`,
                    },
                  ]}
                />
              )}
            </div>

            <div className="flex items-center gap-2.5 text-muted-foreground">
              <label className="inline-flex items-center gap-1.5 cursor-pointer select-none text-[10px]">
                <Switch
                  size="sm"
                  checked={sniffHideNoise}
                  onChange={setSniffHideNoise}
                />
                <span>过滤系统噪音</span>
              </label>
              {capturedRecordsMap.size > 0 && (
                <button
                  type="button"
                  onClick={handleClearRecords}
                  className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  title="清空已捕获记录"
                >
                  <RotateCcw className="w-3 h-3" />
                  清空
                </button>
              )}
            </div>
          </div>

          {/* 第三行：捕获到的域名列表 */}
          {aggregatedSniffDomains.length === 0 ? (
            <div className="py-4 px-3 rounded-lg bg-background/60 border border-dashed border-border/70 text-center text-[11px] text-muted-foreground">
              {isSniffing ? (
                <span className="inline-flex items-center gap-1.5 text-foreground/80">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                  正在监听内核实时请求链路，请在浏览器中打开或刷新目标网页...
                </span>
              ) : (
                <span>
                  上方输入目标网址点「打开并嗅探」，或点「开始监听」后在浏览器访问目标网页，即可自动抓出整条请求链路的所有关联域名
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
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span>
                    共捕获{' '}
                    <strong className="text-foreground font-mono">
                      {aggregatedSniffDomains.length}
                    </strong>{' '}
                    个域名
                  </span>
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
