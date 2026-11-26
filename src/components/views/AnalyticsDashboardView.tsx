import {
  Activity,
  AlertTriangle,
  ArrowDownUp,
  BarChart3,
  Clock,
  Gauge,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
  Zap,
} from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from '../../i18n'
import * as api from '../../services/tauri'
import { useWindowVisibility } from '../../services/useWindowVisibility'
import { toast } from '../../stores/toastStore'
import type {
  AnalyticsTimelinePoint,
  AvailabilityWeights,
  NodeAnalyticsDashboard,
  NodeAnalyticsSummary,
} from '../../types'
import { formatBytes } from '../../utils/traffic'
import { extractRegion, getRegionSearchKeywords } from '../../utils/proxy'
import { Badge, Button, Input, Modal, Segmented, Slider } from '../common'

type SortField =
  | 'score'
  | 'successRate'
  | 'timeoutCount'
  | 'timeoutDurationMs'
  | 'connectionErrors'
  | 'avgSpeedBps'
  | 'maxSpeedBps'
  | 'minSpeedBps'
  | 'avgLatencyMs'

function formatSpeed(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return '0 B/s'
  return `${formatBytes(bps)}/s`
}

function formatDurationMs(ms: number): string {
  if (!ms || ms <= 0) return '0s'
  const totalSec = Math.round(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const mins = Math.floor(totalSec / 60)
  const secs = totalSec % 60
  if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
  const hours = Math.floor(mins / 60)
  const remMins = mins % 60
  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`
}

function scoreColorClass(score: number): string {
  if (score >= 85) return 'text-emerald-500'
  if (score >= 70) return 'text-blue-500'
  if (score >= 55) return 'text-amber-500'
  return 'text-rose-500'
}

function successRateColorClass(rate: number): string {
  if (rate >= 95) return 'text-emerald-500 font-medium'
  if (rate >= 85) return 'text-blue-500 font-medium'
  if (rate >= 70) return 'text-amber-500 font-medium'
  return 'text-rose-500 font-medium'
}

function latencyColorClass(ms: number): string {
  if (ms <= 120) return 'text-emerald-500 font-medium'
  if (ms <= 260) return 'text-blue-500 font-medium'
  if (ms <= 500) return 'text-amber-500 font-medium'
  return 'text-rose-500 font-medium'
}

function jitterColorClass(ms: number): string {
  if (ms <= 25) return 'text-emerald-500/85'
  if (ms <= 60) return 'text-amber-500/90'
  return 'text-rose-500/90'
}

function anomalyCountColorClass(count: number): string {
  if (count <= 0) return 'text-muted-foreground'
  if (count <= 2) return 'text-amber-500 font-medium'
  return 'text-rose-500 font-medium'
}

function scoreBarFill(score: number): string {
  if (score >= 85) return '#10b981'
  if (score >= 70) return '#3b82f6'
  if (score >= 55) return '#f59e0b'
  return '#f43f5e'
}

function gradeBadgeVariant(
  grade: string,
): 'success' | 'primary' | 'warning' | 'danger' | 'secondary' {
  switch (grade) {
    case 'S':
    case 'A':
      return 'success'
    case 'B':
      return 'primary'
    case 'C':
      return 'warning'
    case 'D':
      return 'danger'
    default:
      return 'secondary'
  }
}

/** Native SVG 7-axis radar chart for a single node's multi-dimensional scores. */
const NodeRadarChart: React.FC<{
  node: NodeAnalyticsSummary
  labels: string[]
}> = ({ node, labels }) => {
  const values = [
    node.dimensions.timeoutCount,
    node.dimensions.timeoutDuration,
    node.dimensions.connectionErrors,
    node.dimensions.avgSpeed,
    node.dimensions.maxSpeed,
    node.dimensions.minSpeed,
    node.dimensions.latencyQuality,
  ]
  const cx = 160
  const cy = 138
  const radius = 98
  const count = values.length

  const pointAt = (index: number, ratio: number) => {
    const angle = (Math.PI * 2 * index) / count - Math.PI / 2
    return {
      x: cx + Math.cos(angle) * radius * ratio,
      y: cy + Math.sin(angle) * radius * ratio,
    }
  }

  const rings = [0.25, 0.5, 0.75, 1]
  const dataPoints = values
    .map((v, i) => {
      const p = pointAt(i, Math.max(0.05, Math.min(1, v / 100)))
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
    })
    .join(' ')

  return (
    <svg
      viewBox="0 0 320 270"
      className="w-full h-[220px] select-none"
      role="img"
      aria-label={node.nodeName}
    >
      {rings.map((r) => {
        const poly = Array.from({ length: count }, (_, i) => {
          const p = pointAt(i, r)
          return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
        }).join(' ')
        return (
          <polygon
            key={r}
            points={poly}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.12}
            strokeWidth={1}
          />
        )
      })}
      {Array.from({ length: count }, (_, i) => {
        const end = pointAt(i, 1)
        const labelPos = pointAt(i, 1.24)
        return (
          <g key={labels[i]}>
            <line
              x1={cx}
              y1={cy}
              x2={end.x}
              y2={end.y}
              stroke="currentColor"
              strokeOpacity={0.12}
              strokeWidth={1}
            />
            <text
              x={labelPos.x}
              y={labelPos.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={16}
              className="fill-foreground/95 font-medium"
            >
              {labels[i]}
            </text>
          </g>
        )
      })}
      <polygon
        points={dataPoints}
        fill={scoreBarFill(node.score)}
        fillOpacity={0.22}
        stroke={scoreBarFill(node.score)}
        strokeWidth={2}
      />
      {values.map((v, i) => {
        const p = pointAt(i, Math.max(0.05, Math.min(1, v / 100)))
        return (
          <circle
            key={labels[i]}
            cx={p.x}
            cy={p.y}
            r={3}
            fill={scoreBarFill(node.score)}
          />
        )
      })}
    </svg>
  )
}

/** Native SVG timeline chart showing historical throughput & anomaly bars. */
const AnalyticsTimelineChart: React.FC<{
  timeline: AnalyticsTimelinePoint[]
}> = ({ timeline }) => {
  const { t } = useTranslation()
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const width = 560
  const height = 225
  const padL = 82
  const padR = 38
  const padT = 16
  const padB = 30
  const plotW = width - padL - padR
  const plotH = height - padT - padB

  if (timeline.length === 0) {
    return (
      <div className="h-[175px] flex items-center justify-center text-xs text-muted-foreground">
        —
      </div>
    )
  }

  const maxSpeed = Math.max(
    1024,
    ...timeline.map((p) => Math.max(p.maxSpeedBps, p.avgSpeedBps)),
  )
  const maxAnomalies = Math.max(
    1,
    ...timeline.map((p) => p.timeoutCount + p.connectionErrors),
  )

  const xAt = (i: number) =>
    timeline.length === 1
      ? padL + plotW / 2
      : padL + (i / (timeline.length - 1)) * plotW
  const ySpeed = (bps: number) => padT + plotH - (bps / maxSpeed) * plotH

  const avgPath = timeline
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${ySpeed(p.avgSpeedBps).toFixed(1)}`,
    )
    .join(' ')
  const peakPath = timeline
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${ySpeed(p.maxSpeedBps).toFixed(1)}`,
    )
    .join(' ')
  const areaPath = `${avgPath} L${xAt(timeline.length - 1).toFixed(1)},${(padT + plotH).toFixed(1)} L${xAt(0).toFixed(1)},${(padT + plotH).toFixed(1)} Z`

  const barW = Math.max(
    3,
    Math.min(12, plotW / Math.max(1, timeline.length) - 2),
  )

  const hoveredPoint = hoveredIdx !== null ? timeline[hoveredIdx] : null
  const hoveredTimeLabel = hoveredPoint
    ? (() => {
        const d = new Date(hoveredPoint.bucketStartMs)
        return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`
      })()
    : null

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-[235px] select-none"
        role="img"
        aria-label={t('analytics.timelineTitle')}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          if (rect.width <= 0) return
          const svgX = ((e.clientX - rect.left) / rect.width) * width
          if (svgX < padL || svgX > width - padR) {
            setHoveredIdx(null)
            return
          }
          const idx =
            timeline.length === 1
              ? 0
              : Math.round(((svgX - padL) / plotW) * (timeline.length - 1))
          setHoveredIdx(Math.max(0, Math.min(timeline.length - 1, idx)))
        }}
        onMouseLeave={() => setHoveredIdx(null)}
      >
        {[0, 0.33, 0.67, 1].map((r) => {
          const y = padT + plotH * (1 - r)
          return (
            <g key={r}>
              <line
                x1={padL}
                y1={y}
                x2={width - padR}
                y2={y}
                stroke="currentColor"
                strokeOpacity={0.1}
                strokeDasharray="3 3"
              />
              <text
                x={padL - 8}
                y={y + 5}
                textAnchor="end"
                fontSize={16}
                className="fill-foreground/90 font-medium"
              >
                {formatSpeed(maxSpeed * r)}
              </text>
            </g>
          )
        })}

        {/* Anomaly bars (timeouts + connection errors) */}
        {timeline.map((p, i) => {
          const count = p.timeoutCount + p.connectionErrors
          if (count <= 0) return null
          const h = Math.max(4, (count / maxAnomalies) * (plotH * 0.45))
          return (
            <rect
              key={p.bucketStartMs}
              x={xAt(i) - barW / 2}
              y={padT + plotH - h}
              width={barW}
              height={h}
              rx={1.5}
              fill="#f43f5e"
              fillOpacity={0.35}
            />
          )
        })}

        <path d={areaPath} fill="#3b82f6" fillOpacity={0.12} />
        <path
          d={peakPath}
          fill="none"
          stroke="#10b981"
          strokeWidth={1.25}
          strokeDasharray="3 2"
          strokeOpacity={0.8}
        />
        <path d={avgPath} fill="none" stroke="#3b82f6" strokeWidth={2} />
        {/* Right Y-axis labels for anomaly count */}
        {[
          { y: padT + plotH, label: '0' },
          { y: padT + plotH * 0.55, label: String(maxAnomalies) },
        ].map((tick) => (
          <text
            key={tick.label}
            x={width - padR + 6}
            y={tick.y + 4}
            textAnchor="start"
            fontSize={13}
            className="fill-rose-500/80 font-medium"
          >
            {tick.label}
          </text>
        ))}
        {hoveredIdx !== null && hoveredPoint && (
          <g>
            <line
              x1={xAt(hoveredIdx)}
              y1={padT}
              x2={xAt(hoveredIdx)}
              y2={padT + plotH}
              stroke="currentColor"
              strokeOpacity={0.25}
              strokeDasharray="3 3"
            />
            <circle
              cx={xAt(hoveredIdx)}
              cy={ySpeed(hoveredPoint.maxSpeedBps)}
              r={3.5}
              fill="#10b981"
            />
            <circle
              cx={xAt(hoveredIdx)}
              cy={ySpeed(hoveredPoint.avgSpeedBps)}
              r={4}
              fill="#3b82f6"
            />
          </g>
        )}

        {/* X-axis start / end labels */}
        {[0, timeline.length - 1]
          .filter((idx, pos, arr) => arr.indexOf(idx) === pos)
          .map((idx) => {
            const d = new Date(timeline[idx].bucketStartMs)
            const label = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`
            return (
              <text
                key={idx}
                x={xAt(idx)}
                y={height - 10}
                textAnchor={idx === 0 ? 'start' : 'end'}
                fontSize={16}
                className="fill-foreground/90 font-medium"
              >
                {label}
              </text>
            )
          })}
      </svg>
      {hoveredIdx !== null && hoveredPoint && hoveredTimeLabel && (
        <div
          className="pointer-events-none absolute top-1 z-10 rounded-md border border-border bg-popover/95 px-2.5 py-1.5 text-[11px] shadow-md backdrop-blur-xs"
          style={{
            left:
              timeline.length > 1 && hoveredIdx / (timeline.length - 1) > 0.65
                ? undefined
                : `${Math.min(72, Math.max(12, (xAt(hoveredIdx) / width) * 100))}%`,
            right:
              timeline.length > 1 && hoveredIdx / (timeline.length - 1) > 0.65
                ? '8%'
                : undefined,
          }}
        >
          <div className="font-medium text-foreground mb-0.5">
            {hoveredTimeLabel}
          </div>
          <div className="flex items-center justify-between gap-3 text-blue-500">
            <span>{t('analytics.legendAvg')}</span>
            <span className="tabular-nums font-medium">
              {formatSpeed(hoveredPoint.avgSpeedBps)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 text-emerald-500">
            <span>{t('analytics.legendPeak')}</span>
            <span className="tabular-nums font-medium">
              {formatSpeed(hoveredPoint.maxSpeedBps)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 text-rose-500">
            <span>{t('analytics.legendErrors')}</span>
            <span className="tabular-nums font-medium">
              {hoveredPoint.timeoutCount + hoveredPoint.connectionErrors}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export const AnalyticsDashboardView: React.FC = () => {
  const { t } = useTranslation()
  const [windowHours, setWindowHours] = useState<number>(24)
  const [dashboard, setDashboard] = useState<NodeAnalyticsDashboard | null>(
    null,
  )
  const [loading, setLoading] = useState<boolean>(true)
  const [search, setSearch] = useState<string>('')
  const [sortField, setSortField] = useState<SortField>('score')
  const [sortAsc, setSortAsc] = useState<boolean>(false)
  const [selectedNodeName, setSelectedNodeName] = useState<string | null>(null)
  const [weightsModalOpen, setWeightsModalOpen] = useState<boolean>(false)
  const [draftWeights, setDraftWeights] = useState<AvailabilityWeights>({
    ...api.DEFAULT_AVAILABILITY_WEIGHTS,
  })
  const [savingWeights, setSavingWeights] = useState<boolean>(false)
  const [clearModalOpen, setClearModalOpen] = useState<boolean>(false)

  const isWindowVisible = useWindowVisibility()
  const inFlightRef = useRef(false)
  const weightsModalOpenRef = useRef(weightsModalOpen)
  weightsModalOpenRef.current = weightsModalOpen

  const fetchDashboard = useCallback(
    async (hours: number, options?: { silent?: boolean }) => {
      if (inFlightRef.current) return
      inFlightRef.current = true
      const silent = options?.silent ?? false
      if (!silent) {
        setLoading(true)
      }
      try {
        const data = await api.getNodeAnalyticsDashboard(hours)
        setDashboard(data)
        if (!weightsModalOpenRef.current) {
          setDraftWeights(data.weights)
        }
        setSelectedNodeName((prev) => {
          if (prev && data.nodes.some((n) => n.nodeName === prev)) return prev
          return data.nodes[0]?.nodeName ?? null
        })
      } catch (err) {
        if (!silent) {
          toast.error(String(err))
        }
      } finally {
        inFlightRef.current = false
        if (!silent) {
          setLoading(false)
        }
      }
    },
    [],
  )

  useEffect(() => {
    if (!isWindowVisible) return
    void fetchDashboard(windowHours)
    const timer = window.setInterval(() => {
      void fetchDashboard(windowHours, { silent: true })
    }, 10_000)
    return () => window.clearInterval(timer)
  }, [fetchDashboard, windowHours, isWindowVisible])

  const filteredNodes = useMemo(() => {
    if (!dashboard) return []
    const q = search.trim().toLowerCase()
    const list = q
      ? dashboard.nodes.filter((n) => {
          if (n.nodeName.toLowerCase().includes(q)) return true
          const region = extractRegion(n.nodeName)
          return getRegionSearchKeywords(region).some((kw) =>
            kw.toLowerCase().includes(q),
          )
        })
      : [...dashboard.nodes]
    list.sort((a, b) => {
      const av =
        sortField === 'avgLatencyMs'
          ? (a.avgLatencyMs ?? Number.MAX_SAFE_INTEGER)
          : a[sortField]
      const bv =
        sortField === 'avgLatencyMs'
          ? (b.avgLatencyMs ?? Number.MAX_SAFE_INTEGER)
          : b[sortField]
      const diff = Number(av) - Number(bv)
      return sortAsc ? diff : -diff
    })
    return list
  }, [dashboard, search, sortField, sortAsc])

  const selectedNode = useMemo(() => {
    if (!dashboard || dashboard.nodes.length === 0) return null
    return (
      dashboard.nodes.find((n) => n.nodeName === selectedNodeName) ??
      dashboard.nodes[0]
    )
  }, [dashboard, selectedNodeName])

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc((prev) => !prev)
    } else {
      setSortField(field)
      setSortAsc(field === 'avgLatencyMs')
    }
  }

  const handleSaveWeights = async () => {
    setSavingWeights(true)
    try {
      await api.setNodeAnalyticsWeights(draftWeights)
      toast.success(t('analytics.weightsSaved'))
      setWeightsModalOpen(false)
      await fetchDashboard(windowHours)
    } catch (err) {
      toast.error(String(err))
    } finally {
      setSavingWeights(false)
    }
  }

  const handleClearData = async () => {
    try {
      await api.clearNodeAnalytics()
      toast.success(t('analytics.cleared'))
      setClearModalOpen(false)
      await fetchDashboard(windowHours)
    } catch (err) {
      toast.error(String(err))
    }
  }

  const totalDraftWeight =
    draftWeights.timeoutCount +
    draftWeights.timeoutDuration +
    draftWeights.connectionErrors +
    draftWeights.avgSpeed +
    draftWeights.maxSpeed +
    draftWeights.minSpeed +
    draftWeights.latencyQuality

  const radarLabels = [
    t('analytics.dimTimeoutCount'),
    t('analytics.dimTimeoutDuration'),
    t('analytics.dimConnErrors'),
    t('analytics.dimAvgSpeed'),
    t('analytics.dimMaxSpeed'),
    t('analytics.dimMinSpeed'),
    t('analytics.dimLatency'),
  ]

  const weightFields: {
    key: keyof AvailabilityWeights
    label: string
    target: string
  }[] = [
    { key: 'timeoutCount', label: t('analytics.dimTimeoutCount'), target: '0' },
    { key: 'timeoutDuration', label: t('analytics.dimTimeoutDuration'), target: '0s' },
    { key: 'connectionErrors', label: t('analytics.dimConnErrors'), target: '0' },
    { key: 'avgSpeed', label: t('analytics.dimAvgSpeed'), target: '≥ 2 MB/s' },
    { key: 'maxSpeed', label: t('analytics.dimMaxSpeed'), target: '≥ 10 MB/s' },
    { key: 'minSpeed', label: t('analytics.dimMinSpeed'), target: '≥ 200 KB/s' },
    { key: 'latencyQuality', label: t('analytics.dimLatency'), target: '≤ 60ms' },
  ]

  return (
    <div className="h-full overflow-y-auto px-5 py-4 space-y-4">
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          size="sm"
          value={String(windowHours)}
          onChange={(val) => setWindowHours(Number(val))}
          options={[
            { value: '24', label: t('analytics.window24h') },
            { value: '168', label: t('analytics.window7d') },
            { value: '720', label: t('analytics.window30d') },
            { value: '0', label: t('analytics.windowAll') },
          ]}
        />
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWeightsModalOpen(true)}
            icon={<SlidersHorizontal className="w-3.5 h-3.5" />}
          >
            {t('analytics.weightsConfig')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchDashboard(windowHours)}
            loading={loading}
            icon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            {t('common.refresh')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setClearModalOpen(true)}
            icon={<Trash2 className="w-3.5 h-3.5 text-rose-500" />}
          >
            {t('analytics.clearData')}
          </Button>
        </div>
      </div>

      {/* KPI Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="rounded-lg border border-border bg-card/80 p-3.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t('analytics.kpiNodes')}</span>
            <BarChart3 className="w-3.5 h-3.5 text-primary" />
          </div>
          <div className="mt-1.5 text-xl font-bold text-foreground tabular-nums">
            {dashboard?.totalNodes ?? 0}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="text-emerald-500">
              {t('analytics.healthy')} {dashboard?.healthyNodes ?? 0}
            </span>
            <span className="text-amber-500">
              {t('analytics.warning')} {dashboard?.warningNodes ?? 0}
            </span>
            <span className="text-rose-500">
              {t('analytics.critical')} {dashboard?.criticalNodes ?? 0}
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card/80 p-3.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t('analytics.kpiAvgScore')}</span>
            <Gauge className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <div
            className={`mt-1.5 text-xl font-bold tabular-nums ${scoreColorClass(dashboard?.avgScore ?? 0)}`}
          >
            {(dashboard?.avgScore ?? 0).toFixed(1)}
            <span className="text-xs font-normal text-muted-foreground ml-1">
              / 100
            </span>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground truncate">
            {formatBytes(dashboard?.totalTrafficBytes ?? 0)}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card/80 p-3.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t('analytics.kpiTimeouts')}</span>
            <Clock className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <div className="mt-1.5 text-xl font-bold text-foreground tabular-nums">
            {dashboard?.totalTimeouts ?? 0}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
            {formatDurationMs(dashboard?.totalTimeoutDurationMs ?? 0)}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card/80 p-3.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t('analytics.kpiConnErrors')}</span>
            <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
          </div>
          <div className="mt-1.5 text-xl font-bold text-foreground tabular-nums">
            {dashboard?.totalConnectionErrors ?? 0}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            TCP / UDP dial &amp; EOF
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card/80 p-3.5 col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t('analytics.kpiTraffic')}</span>
            <Zap className="w-3.5 h-3.5 text-blue-500" />
          </div>
          <div className="mt-1.5 text-lg font-bold text-foreground tabular-nums truncate">
            {formatSpeed(dashboard?.globalPeakSpeedBps ?? 0)}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground tabular-nums truncate">
            avg {formatSpeed(dashboard?.globalAvgSpeedBps ?? 0)}
          </div>
        </div>
      </div>

      {!dashboard || dashboard.nodes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card/40 py-14 px-6 text-center">
          <Activity className="w-8 h-8 text-muted-foreground/60 mx-auto mb-2.5" />
          <p className="text-sm font-medium text-foreground">
            {t('analytics.emptyTitle')}
          </p>
          <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
            {t('analytics.emptyDesc')}
          </p>
        </div>
      ) : (
        <>
          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            {/* Ranking Bar Chart */}
            <div className="lg:col-span-4 rounded-lg border border-border bg-card/80 p-3.5 flex flex-col">
              <div className="text-xs font-semibold text-foreground mb-2.5">
                {t('analytics.rankingTitle')}
              </div>
              <div className="space-y-2 flex-1 overflow-y-auto max-h-[240px] pr-1">
                {dashboard.nodes.slice(0, 10).map((node) => {
                  const isSelected = selectedNode?.nodeName === node.nodeName
                  return (
                    <button
                      key={node.nodeName}
                      type="button"
                      onClick={() => setSelectedNodeName(node.nodeName)}
                      className={`w-full text-left p-1.5 rounded-md transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-primary/10 ring-1 ring-primary/30'
                          : 'hover:bg-accent/50'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs mb-1 gap-2">
                        <span className="truncate font-medium text-foreground">
                          {node.nodeName}
                        </span>
                        <span
                          className={`font-semibold tabular-nums shrink-0 ${scoreColorClass(node.score)}`}
                        >
                          {node.score.toFixed(1)}
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.max(4, Math.min(100, node.score))}%`,
                            backgroundColor: scoreBarFill(node.score),
                          }}
                        />
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Selected Node 7-Dimension Radar */}
            <div className="lg:col-span-3 rounded-lg border border-border bg-card/80 p-3.5 flex flex-col">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-semibold text-foreground truncate">
                  {t('analytics.radarTitle')}
                </span>
                {selectedNode && (
                  <Badge variant={gradeBadgeVariant(selectedNode.grade)}>
                    {selectedNode.grade} · {selectedNode.score.toFixed(1)}
                  </Badge>
                )}
              </div>
              {selectedNode && (
                <>
                  <div className="text-[11px] text-muted-foreground truncate mb-1">
                    {selectedNode.nodeName}
                  </div>
                  <NodeRadarChart node={selectedNode} labels={radarLabels} />
                </>
              )}
            </div>

            {/* Timeline Chart + Selected Node Recent Events */}
            <div className="lg:col-span-5 rounded-lg border border-border bg-card/80 p-3.5 flex flex-col">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-foreground">
                  {t('analytics.timelineTitle')}
                </span>
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    {t('analytics.legendAvg')}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    {t('analytics.legendPeak')}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-xs bg-rose-500/60" />
                    {t('analytics.legendErrors')}
                  </span>
                </div>
              </div>
              <AnalyticsTimelineChart timeline={dashboard.timeline} />
            </div>
          </div>

          {/* Selected Node Recent Anomalies Strip */}
          {selectedNode && (
            <div className="rounded-lg border border-border bg-card/80 p-3.5">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  <span>
                    {t('analytics.recentEvents')} — {selectedNode.nodeName}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  {selectedNode.isCurrentlyTimedOut && (
                    <Badge variant="danger">
                      {t('analytics.currentlyTimedOut')}
                    </Badge>
                  )}
                  <Badge variant="secondary">
                    {selectedNode.confidence === 'high'
                      ? t('analytics.confidenceHigh')
                      : selectedNode.confidence === 'medium'
                        ? t('analytics.confidenceMedium')
                        : t('analytics.confidenceLow')}
                  </Badge>
                </div>
              </div>
              {selectedNode.recentEvents.length === 0 ? (
                <div className="text-xs text-muted-foreground">
                  {t('analytics.noEvents')}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto">
                  {selectedNode.recentEvents.slice(0, 8).map((ev, idx) => (
                    <div
                      key={`${ev.timestampMs}-${idx}`}
                      className="text-[11px] px-2 py-1 rounded-md border border-border bg-background/70 flex items-center gap-1.5"
                    >
                      <span
                        className={
                          ev.kind === 'recovered'
                            ? 'text-emerald-500 font-medium'
                            : 'text-rose-500 font-medium'
                        }
                      >
                        {new Date(ev.timestampMs).toLocaleTimeString()}
                      </span>
                      <span className="text-foreground truncate max-w-[260px]">
                        {ev.message}
                      </span>
                      {ev.durationMs ? (
                        <span className="text-muted-foreground">
                          ({formatDurationMs(ev.durationMs)})
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Full Multi-Dimensional Node Table */}
          <div className="rounded-lg border border-border bg-card/80 overflow-hidden">
            <div className="px-3.5 py-2.5 border-b border-border flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-foreground">
                {t('analytics.tableTitle')} ({filteredNodes.length})
              </span>
              <div className="w-56">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('analytics.searchPlaceholder')}
                  prefixIcon={<Search className="w-3.5 h-3.5" />}
                  clearable
                  onClear={() => setSearch('')}
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs table-fixed">
                <thead className="bg-muted/40 text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left font-medium px-2.5 py-2 w-[22%]">
                      {t('analytics.colNode')}
                    </th>
                    {(
                      [
                        ['score', t('analytics.colScore')],
                        ['successRate', t('analytics.colSuccessRate')],
                        ['timeoutCount', t('analytics.colTimeouts')],
                        [
                          'timeoutDurationMs',
                          t('analytics.colTimeoutDuration'),
                        ],
                        ['connectionErrors', t('analytics.colConnErrors')],
                        ['avgSpeedBps', t('analytics.colAvgSpeed')],
                        ['maxSpeedBps', t('analytics.colMaxSpeed')],
                        ['minSpeedBps', t('analytics.colMinSpeed')],
                        ['avgLatencyMs', t('analytics.colLatency')],
                      ] as [SortField, string][]
                    ).map(([field, label]) => (
                      <th
                        key={field}
                        className="text-right font-medium px-1.5 py-2 whitespace-nowrap text-[11px]"
                      >
                        <button
                          type="button"
                          onClick={() => toggleSort(field)}
                          className="inline-flex items-center gap-0.5 hover:text-foreground cursor-pointer"
                        >
                          <span>{label}</span>
                          <ArrowDownUp className="w-2.5 h-2.5 opacity-60 shrink-0" />
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filteredNodes.map((node) => {
                    const isSelected = selectedNode?.nodeName === node.nodeName
                    return (
                      <tr
                        key={node.nodeName}
                        onClick={() => setSelectedNodeName(node.nodeName)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-primary/8' : 'hover:bg-accent/40'
                        }`}
                      >
                        <td className="px-3 py-2 font-medium text-foreground max-w-[200px] truncate">
                          <div className="flex items-center gap-1.5">
                            <Badge variant={gradeBadgeVariant(node.grade)}>
                              {node.grade}
                            </Badge>
                            <span className="truncate">{node.nodeName}</span>
                          </div>
                        </td>
                        <td
                          className={`px-2.5 py-2 text-right font-semibold tabular-nums ${scoreColorClass(node.score)}`}
                        >
                          {node.score.toFixed(1)}
                        </td>
                        <td
                          className={`px-2 py-2 text-right tabular-nums ${successRateColorClass(node.successRate)}`}
                        >
                          {node.successRate.toFixed(0)}%
                        </td>
                        <td
                          className={`px-2 py-2 text-right tabular-nums ${anomalyCountColorClass(node.timeoutCount)}`}
                        >
                          {node.timeoutCount}
                        </td>
                        <td
                          className={`px-2 py-2 text-right tabular-nums ${
                            node.timeoutDurationMs > 0
                              ? 'text-amber-500'
                              : 'text-muted-foreground'
                          }`}
                        >
                          {formatDurationMs(node.timeoutDurationMs)}
                        </td>
                        <td
                          className={`px-2 py-2 text-right tabular-nums ${anomalyCountColorClass(node.connectionErrors)}`}
                        >
                          {node.connectionErrors}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-foreground">
                          {formatSpeed(node.avgSpeedBps)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-emerald-500 font-medium">
                          {formatSpeed(node.maxSpeedBps)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                          {formatSpeed(node.minSpeedBps)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">
                          {node.avgLatencyMs != null ? (
                            <span>
                              <span
                                className={latencyColorClass(node.avgLatencyMs)}
                              >
                                {Math.round(node.avgLatencyMs)}ms
                              </span>
                              {node.jitterMs != null && (
                                <span
                                  className={`ml-1 text-[11px] ${jitterColorClass(node.jitterMs)}`}
                                >
                                  ±{Math.round(node.jitterMs)}
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Weights Configuration Modal */}
      <Modal
        isOpen={weightsModalOpen}
        onClose={() => setWeightsModalOpen(false)}
        title={t('analytics.weightsConfig')}
        subtitle={t('analytics.weightsModalSubtitle')}
        maxWidth="md"
        icon={<SlidersHorizontal className="w-4 h-4 text-primary" />}
        footer={
          <div className="flex items-center justify-between w-full">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setDraftWeights({ ...api.DEFAULT_AVAILABILITY_WEIGHTS })
              }
              icon={<RotateCcw className="w-3.5 h-3.5" />}
            >
              {t('analytics.resetWeights')}
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setWeightsModalOpen(false)}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={savingWeights}
                onClick={() => void handleSaveWeights()}
              >
                {t('common.save')}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-3.5 py-1">
          {weightFields.map(({ key, label, target }) => {
            const val = draftWeights[key]
            const pct =
              totalDraftWeight > 0
                ? ((val / totalDraftWeight) * 100).toFixed(0)
                : '0'
            return (
              <div key={key} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-foreground">
                    {label}
                    <span className="ml-1.5 font-normal text-muted-foreground">
                      ({target})
                    </span>
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {val} ({pct}%)
                  </span>
                </div>
                <Slider
                  min={0}
                  max={50}
                  step={1}
                  value={val}
                  onChange={(next) =>
                    setDraftWeights((prev) => ({ ...prev, [key]: next }))
                  }
                />
              </div>
            )
          })}
        </div>
      </Modal>

      {/* Clear Confirmation Modal */}
      <Modal
        isOpen={clearModalOpen}
        onClose={() => setClearModalOpen(false)}
        title={t('analytics.clearData')}
        maxWidth="sm"
        icon={<Trash2 className="w-4 h-4 text-rose-500" />}
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setClearModalOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => void handleClearData()}
            >
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t('analytics.clearConfirm')}
        </p>
      </Modal>
    </div>
  )
}
