import { listen } from '@tauri-apps/api/event'
import { ArrowDownToLine, Loader2, RotateCcw, Square } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from '../../i18n'
import * as api from '../../services/tauri'
import { useAppStore } from '../../stores/appStore'
import { EGRESS_CACHE_TTL_MS } from '../../stores/proxySlice'
import type {
  DownloadSpeedProgressPayload,
  DownloadSpeedTestResult,
  InboundProtocol,
} from '../../types'
import { getNodeQualityCacheKey } from '../../utils/proxy'
import { Button } from './Button'
import { Input } from './Input'
import { Modal } from './Modal'
import { Select, type SelectOption } from './Select'

export interface DownloadSpeedTarget {
  nodeName: string
  profileId?: string | null
  profileName?: string | null
  runtimeKey?: string
  portProbe?: {
    port: number
    protocol: InboundProtocol
    isChain?: boolean
  }
}

interface DownloadSpeedModalProps {
  isOpen: boolean
  onClose: () => void
  target: DownloadSpeedTarget | null
}

function getTargetCacheKey(target: DownloadSpeedTarget): string {
  if (target.portProbe) {
    return `port:${target.portProbe.port}:${target.portProbe.protocol}`
  }
  return getNodeQualityCacheKey(
    target.nodeName,
    target.profileId,
    target.runtimeKey,
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
}

function formatSpeed(bytesPerSec: number): { mib: string; mbps: string } {
  const mib = (bytesPerSec / (1024 * 1024)).toFixed(2)
  const mbps = ((bytesPerSec * 8) / 1_000_000).toFixed(1)
  return { mib, mbps }
}

export const DownloadSpeedModal: React.FC<DownloadSpeedModalProps> = ({
  isOpen,
  onClose,
  target,
}) => {
  const { t } = useTranslation()
  const nodeDownloadSpeeds = useAppStore((s) => s.nodeDownloadSpeeds)
  const nodeDownloadSpeedCachedAt = useAppStore(
    (s) => s.nodeDownloadSpeedCachedAt,
  )
  const saveDownloadSpeedResult = useAppStore((s) => s.saveDownloadSpeedResult)

  const [source, setSource] = useState<string>('auto')
  const [durationSecsInput, setDurationSecsInput] = useState<string>('8')
  const [maxMibInput, setMaxMibInput] = useState<string>('100')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<DownloadSpeedProgressPayload | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const seqRef = useRef(0)

  const cacheKey = useMemo(
    () => (target ? getTargetCacheKey(target) : ''),
    [target],
  )

  const cachedTimestamp = cacheKey
    ? nodeDownloadSpeedCachedAt[cacheKey]
    : undefined
  const isCacheValid =
    typeof cachedTimestamp === 'number' &&
    Date.now() - cachedTimestamp <= EGRESS_CACHE_TTL_MS
  const cachedResult: DownloadSpeedTestResult | null =
    cacheKey && isCacheValid ? nodeDownloadSpeeds[cacheKey] || null : null

  const sourceOptions: SelectOption<string>[] = [
    { value: 'auto', label: t('downloadTest.sourceAuto') },
    { value: 'cloudflare', label: 'Cloudflare CDN' },
    { value: 'google', label: 'Google CDN' },
    { value: 'microsoft', label: 'Microsoft Azure CDN' },
    { value: 'ovh', label: 'OVH Global' },
  ]

  const runTest = useCallback(async () => {
    if (!target || !cacheKey) return
    const seq = ++seqRef.current

    const parsedDurationSec = Number.parseInt(durationSecsInput, 10)
    const durationSecs = Number.isFinite(parsedDurationSec)
      ? Math.min(60, Math.max(1, parsedDurationSec))
      : 8
    const durationMs = durationSecs * 1000

    const parsedMib = Number.parseInt(maxMibInput, 10)
    const maxBytes =
      maxMibInput.trim() === '0'
        ? 0
        : Number.isFinite(parsedMib)
          ? Math.min(1024, Math.max(1, parsedMib)) * 1024 * 1024
          : 100 * 1024 * 1024

    setRunning(true)
    setProgress(null)
    setError(null)
    try {
      const res = target.portProbe
        ? await api.testPortDownloadSpeed(
            target.portProbe.port,
            target.portProbe.protocol,
            source,
            maxBytes,
            durationMs,
          )
        : await api.testNodeDownloadSpeed(
            target.nodeName,
            target.profileId,
            source,
            maxBytes,
            durationMs,
          )
      if (seqRef.current !== seq) return
      if (!res.cancelled) {
        saveDownloadSpeedResult(cacheKey, res)
      }
    } catch (err) {
      if (seqRef.current !== seq) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (seqRef.current === seq) {
        setRunning(false)
      }
    }
  }, [
    target,
    cacheKey,
    source,
    durationSecsInput,
    maxMibInput,
    saveDownloadSpeedResult,
  ])

  useEffect(() => {
    if (!isOpen || !target) return
    setRunning(false)
    setProgress(null)
    setError(null)
    let unlisten: (() => void) | null = null
    let active = true

    void listen<DownloadSpeedProgressPayload>(
      'download-speed-progress',
      (event) => {
        if (active) {
          setProgress(event.payload)
        }
      },
    ).then((fn) => {
      if (active) {
        unlisten = fn
      } else {
        fn()
      }
    })

    return () => {
      active = false
      if (unlisten) unlisten()
      void api.cancelDownloadSpeedTest()
    }
  }, [isOpen, target])

  const handleClose = () => {
    if (running) {
      void api.cancelDownloadSpeedTest()
    }
    onClose()
  }

  if (!target) return null

  const activeResult = running ? null : cachedResult
  const speedBps = activeResult
    ? activeResult.avgBytesPerSec
    : (progress?.speedBytesPerSec ?? 0)
  const downloadedBytes = activeResult
    ? activeResult.downloadedBytes
    : (progress?.downloadedBytes ?? 0)
  const elapsedMs = activeResult
    ? activeResult.elapsedMs
    : (progress?.elapsedMs ?? 0)
  const activeSourceName =
    activeResult?.sourceName || progress?.sourceName || ''
  const { mib, mbps } = formatSpeed(speedBps)

  const nodeLabel = target.profileName
    ? `[${target.profileName}] ${target.nodeName}`
    : target.nodeName
  const subtitle = target.portProbe
    ? `${t(
        target.portProbe.isChain
          ? 'ipQuality.chainEgressScope'
          : 'ipQuality.portEgressScope',
        {
          port: String(target.portProbe.port),
          protocol: target.portProbe.protocol.toUpperCase(),
        },
      )} · ${nodeLabel}`
    : nodeLabel

  const statusText = running
    ? t('downloadTest.running')
    : activeResult
      ? `${
          activeResult.limitedBy === 'byte_limit'
            ? t('downloadTest.limitedBy.byte_limit')
            : activeResult.limitedBy === 'duration_limit'
              ? t('downloadTest.limitedBy.duration_limit')
              : activeResult.limitedBy === 'cancelled'
                ? t('downloadTest.limitedBy.cancelled')
                : t('downloadTest.limitedBy.completed')
        }${
          cachedTimestamp
            ? ` · ${t('downloadTest.cachedAt', {
                time: new Date(cachedTimestamp).toLocaleTimeString(),
              })}`
            : ''
        }`
      : ''

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t('downloadTest.title')}
      subtitle={subtitle}
      icon={<ArrowDownToLine className="w-4 h-4 text-primary" />}
      maxWidth="md"
      footer={
        <div className="flex items-center justify-between w-full gap-2">
          <span className="text-[11px] text-muted-foreground truncate">
            {statusText}
          </span>
          {running ? (
            <Button
              variant="danger"
              size="sm"
              onClick={() => void api.cancelDownloadSpeedTest()}
              icon={<Loader2 className="w-3.5 h-3.5 animate-spin" />}
            >
              <Square className="w-3 h-3 fill-current mr-1" />
              {t('downloadTest.cancel')}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={() => void runTest()}
              icon={<RotateCcw className="w-3.5 h-3.5" />}
            >
              {activeResult ? t('downloadTest.retry') : t('downloadTest.start')}
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground shrink-0 w-16">
            {t('downloadTest.source')}
          </span>
          <div className="flex-1 min-w-0">
            <Select
              value={source}
              onChange={setSource}
              options={sourceOptions}
              disabled={running}
              size="sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <Input
            label={t('downloadTest.durationLimit')}
            integerOnly
            value={durationSecsInput}
            onChange={(e) => setDurationSecsInput(e.target.value)}
            disabled={running}
            placeholder="8"
          />
          <Input
            label={t('downloadTest.byteLimit')}
            integerOnly
            value={maxMibInput}
            onChange={(e) => setMaxMibInput(e.target.value)}
            disabled={running}
            placeholder={t('downloadTest.unlimitedPlaceholder')}
          />
        </div>

        {error ? (
          <div className="px-3 py-2 rounded-lg border border-destructive/30 bg-destructive/10 text-xs text-destructive">
            {error}
          </div>
        ) : (
          <div className="rounded-lg border border-border/80 bg-muted/30 p-3 space-y-2.5">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">
                {t('downloadTest.speed')}
              </span>
              <div className="text-right">
                <span className="text-lg font-bold font-mono tabular-nums text-foreground">
                  {mib} MiB/s
                </span>
                <span className="ml-1.5 text-xs font-mono text-muted-foreground">
                  ({mbps} Mbps)
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-1 border-t border-border/50 text-xs">
              <div>
                <div className="text-[11px] text-muted-foreground">
                  {t('downloadTest.downloaded')}
                </div>
                <div className="font-mono font-medium">
                  {formatBytes(downloadedBytes)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground">
                  {t('downloadTest.elapsed')}
                </div>
                <div className="font-mono font-medium">
                  {(elapsedMs / 1000).toFixed(2)} s
                </div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground">
                  {t('downloadTest.activeSource')}
                </div>
                <div
                  className="font-medium truncate"
                  title={activeSourceName || '-'}
                >
                  {activeSourceName || '-'}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
