import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Globe,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Tv,
} from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type TranslationKey,
  type TranslationParams,
  useTranslation,
} from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import type {
  CleanIpQualitySource,
  IpNativeStatus,
  IpNetworkCategory,
  MediaUnlockItem,
  MediaUnlockStatus,
  NodeIpQualityReport,
  NodeMediaUnlockReport,
} from '../../types'
import { getNodeQualityCacheKey } from '../../utils/proxy'
import { toast } from '../../stores/toastStore'
import { Badge } from './Badge'
import { Button } from './Button'
import { Modal } from './Modal'
import { RegionFlag } from './RegionFlag'

export interface IpQualityTarget {
  nodeName: string
  profileId?: string | null
  profileName?: string | null
  runtimeKey?: string
}

interface IpQualityModalProps {
  isOpen: boolean
  onClose: () => void
  target: IpQualityTarget | null
}

function lookupCachedRecord<T>(
  map: Record<string, T>,
  target: IpQualityTarget,
): T | null {
  const key = getNodeQualityCacheKey(
    target.nodeName,
    target.profileId,
    target.runtimeKey,
  )
  return map[key] || null
}

function getPurityBadgeVariant(
  score?: number | null,
): 'success' | 'primary' | 'warning' | 'danger' | 'default' {
  if (score === null || score === undefined) return 'default'
  if (score >= 80) return 'success'
  if (score >= 55) return 'primary'
  if (score >= 30) return 'warning'
  return 'danger'
}

function getFraudBadgeVariant(
  score?: number | null,
): 'success' | 'primary' | 'warning' | 'danger' | 'default' {
  if (score === null || score === undefined) return 'default'
  if (score <= 20) return 'success'
  if (score <= 45) return 'primary'
  if (score <= 70) return 'warning'
  return 'danger'
}

type TranslateFn = (key: TranslationKey, params?: TranslationParams) => string

function getNetworkCategoryMeta(
  category: IpNetworkCategory,
  t: TranslateFn,
): {
  label: string
  variant: 'success' | 'primary' | 'warning' | 'default'
} {
  switch (category) {
    case 'residential':
      return { label: t('ipQuality.catResidential'), variant: 'success' }
    case 'datacenter':
      return { label: t('ipQuality.catDatacenter'), variant: 'primary' }
    case 'conflict':
      return { label: t('ipQuality.catConflict'), variant: 'warning' }
    default:
      return { label: t('ipQuality.catUnknown'), variant: 'default' }
  }
}

function getNativeStatusMeta(
  status: IpNativeStatus,
  t: TranslateFn,
): {
  label: string
  variant: 'success' | 'warning' | 'default'
} {
  switch (status) {
    case 'native':
      return { label: t('ipQuality.native'), variant: 'success' }
    case 'broadcast':
      return { label: t('ipQuality.broadcast'), variant: 'warning' }
    case 'conflict':
      return { label: t('ipQuality.catConflict'), variant: 'warning' }
    default:
      return { label: t('ipQuality.catUnknown'), variant: 'default' }
  }
}

function getMediaStatusMeta(
  status: MediaUnlockStatus,
  t: TranslateFn,
): {
  label: string
  variant: 'success' | 'primary' | 'warning' | 'danger' | 'default'
} {
  switch (status) {
    case 'unlocked':
      return { label: t('ipQuality.statusUnlocked'), variant: 'success' }
    case 'originals-only':
      return { label: t('ipQuality.statusOriginals'), variant: 'primary' }
    case 'web-only':
      return { label: t('ipQuality.statusWebOnly'), variant: 'warning' }
    case 'blocked':
      return { label: t('ipQuality.statusBlocked'), variant: 'danger' }
    default:
      return { label: t('ipQuality.statusFailed'), variant: 'default' }
  }
}

interface RiskFlagChip {
  label: string
  active: boolean
  severity: 'warn' | 'bad' | 'info'
}

function buildCleanIpRiskFlags(
  c: CleanIpQualitySource,
  t: TranslateFn,
): RiskFlagChip[] {
  const items: RiskFlagChip[] = [
    {
      label: t('ipQuality.flagDatacenter'),
      active: Boolean(c.isDatacenter),
      severity: 'info',
    },
    {
      label: t('ipQuality.flagProxy'),
      active: Boolean(c.isProxy),
      severity: 'warn',
    },
    {
      label: t('ipQuality.flagResProxy'),
      active: Boolean(c.isResidentialProxy),
      severity: 'warn',
    },
    {
      label: t('ipQuality.flagVpn'),
      active: Boolean(c.isVpn),
      severity: 'warn',
    },
    {
      label: t('ipQuality.flagTor'),
      active: Boolean(c.isTor),
      severity: 'bad',
    },
    {
      label: t('ipQuality.flagCrawler'),
      active: Boolean(c.isCrawler),
      severity: 'info',
    },
    {
      label: t('ipQuality.flagAbuser'),
      active: Boolean(c.isAbuser),
      severity: 'bad',
    },
    {
      label: t('ipQuality.flagMobile'),
      active: Boolean(c.isMobile),
      severity: 'info',
    },
  ]
  return items.filter((item) => item.active)
}
export const IpQualityModal: React.FC<IpQualityModalProps> = ({
  isOpen,
  onClose,
  target,
}) => {
  const { t } = useTranslation()
  const nodeIpQualities = useAppStore((s) => s.nodeIpQualities)
  const nodeMediaUnlocks = useAppStore((s) => s.nodeMediaUnlocks)

  const [qualityLoading, setQualityLoading] = useState(false)
  const [qualityError, setQualityError] = useState<string | null>(null)
  const [mediaLoading, setMediaLoading] = useState(false)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const qualitySeqRef = useRef(0)
  const mediaSeqRef = useRef(0)
  const targetRef = useRef(target)
  targetRef.current = target

  const cachedQuality: NodeIpQualityReport | null = target
    ? lookupCachedRecord(nodeIpQualities, target)
    : null
  const cachedMedia: NodeMediaUnlockReport | null = target
    ? lookupCachedRecord(nodeMediaUnlocks, target)
    : null

  const runProbe = useCallback(async (forceRefresh: boolean) => {
    const currentTarget = targetRef.current
    if (!currentTarget) return
    const qSeq = ++qualitySeqRef.current
    const mSeq = ++mediaSeqRef.current

    setQualityError(null)
    setMediaError(null)

    const storeState = useAppStore.getState()
    const needQuality =
      forceRefresh ||
      !lookupCachedRecord(storeState.nodeIpQualities, currentTarget)
    const needMedia =
      forceRefresh ||
      !lookupCachedRecord(storeState.nodeMediaUnlocks, currentTarget)

    if (needQuality) {
      setQualityLoading(true)
      try {
        await storeState.probeNodeIpQuality(
          currentTarget.nodeName,
          currentTarget.profileId,
          currentTarget.runtimeKey,
          forceRefresh,
        )
      } catch (err) {
        if (qualitySeqRef.current !== qSeq) return
        setQualityError(err instanceof Error ? err.message : String(err))
      } finally {
        if (qualitySeqRef.current === qSeq) {
          setQualityLoading(false)
        }
      }
    } else {
      setQualityLoading(false)
    }

    if (mediaSeqRef.current !== mSeq) return

    if (needMedia) {
      setMediaLoading(true)
      try {
        await useAppStore
          .getState()
          .probeNodeMediaUnlock(
            currentTarget.nodeName,
            currentTarget.profileId,
            currentTarget.runtimeKey,
            forceRefresh,
          )
      } catch (err) {
        if (mediaSeqRef.current !== mSeq) return
        setMediaError(err instanceof Error ? err.message : String(err))
      } finally {
        if (mediaSeqRef.current === mSeq) {
          setMediaLoading(false)
        }
      }
    } else {
      setMediaLoading(false)
    }
  }, [])

  const runMediaOnly = useCallback(async () => {
    const currentTarget = targetRef.current
    if (!currentTarget) return
    const mSeq = ++mediaSeqRef.current
    setMediaError(null)
    setMediaLoading(true)
    try {
      await useAppStore
        .getState()
        .probeNodeMediaUnlock(
          currentTarget.nodeName,
          currentTarget.profileId,
          currentTarget.runtimeKey,
          true,
        )
    } catch (err) {
      if (mediaSeqRef.current !== mSeq) return
      setMediaError(err instanceof Error ? err.message : String(err))
    } finally {
      if (mediaSeqRef.current === mSeq) {
        setMediaLoading(false)
      }
    }
  }, [])

  const targetKey = target
    ? getNodeQualityCacheKey(
        target.nodeName,
        target.profileId,
        target.runtimeKey,
      )
    : ''

  useEffect(() => {
    if (!isOpen || !targetKey) {
      qualitySeqRef.current += 1
      mediaSeqRef.current += 1
      setQualityLoading(false)
      setMediaLoading(false)
      return
    }
    void runProbe(false)
  }, [isOpen, targetKey, runProbe])

  if (!target) return null

  const subtitle = target.profileName
    ? `[${target.profileName}] ${target.nodeName}`
    : target.nodeName

  const handleCopyIp = async (ip: string) => {
    await navigator.clipboard.writeText(ip).catch(() => {})
    toast.success(t('ipQuality.copiedIp', { ip }))
  }

  const netMeta = cachedQuality
    ? getNetworkCategoryMeta(cachedQuality.networkCategory, t)
    : null
  const nativeMeta = cachedQuality
    ? getNativeStatusMeta(cachedQuality.nativeStatus, t)
    : null
  const cleanipFlags = cachedQuality?.cleanip
    ? buildCleanIpRiskFlags(cachedQuality.cleanip, t)
    : []

  const groupedMedia: Array<{
    title: string
    icon: React.ReactNode
    items: MediaUnlockItem[]
  }> = cachedMedia
    ? [
        {
          title: t('ipQuality.categoryAi'),
          icon: <Sparkles className="w-3.5 h-3.5 text-primary" />,
          items: cachedMedia.items.filter((i) => i.category === 'ai'),
        },
        {
          title: t('ipQuality.categoryStreaming'),
          icon: <Tv className="w-3.5 h-3.5 text-sky-500" />,
          items: cachedMedia.items.filter((i) => i.category === 'streaming'),
        },
        {
          title: t('ipQuality.categorySocial'),
          icon: <Globe className="w-3.5 h-3.5 text-emerald-500" />,
          items: cachedMedia.items.filter((i) => i.category === 'social'),
        },
      ].filter((group) => group.items.length > 0)
    : []

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('ipQuality.modalTitle')}
      subtitle={subtitle}
      icon={<ShieldCheck className="w-4 h-4" />}
      maxWidth="2xl"
      footer={
        <div className="w-full flex items-center justify-between gap-2">
          <Button
            variant="secondary"
            size="sm"
            loading={qualityLoading || mediaLoading}
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={() => void runProbe(true)}
          >
            {t('ipQuality.recheck')}
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* 1. IP Quality & Cross-Validation Section */}
        {qualityLoading && !cachedQuality ? (
          <div className="py-10 rounded-xl border border-border bg-background/50 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
            <span className="text-xs">{t('ipQuality.probingQuality')}</span>
          </div>
        ) : qualityError && !cachedQuality ? (
          <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 flex items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <ShieldAlert className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <div className="min-w-0 space-y-0.5">
                <div className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                  {t('ipQuality.probeFailed')}
                </div>
                <div className="text-[11px] text-muted-foreground break-words">
                  {qualityError}
                </div>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void runProbe(true)}
            >
              {t('ipQuality.retry')}
            </Button>
          </div>
        ) : cachedQuality ? (
          <div className="space-y-3">
            {qualityError && (
              <div className="px-3 py-2 rounded-lg border border-rose-500/30 bg-rose-500/10 text-[11px] text-rose-600 dark:text-rose-400">
                {qualityError}
              </div>
            )}
            {/* Summary Strip */}
            <div className="p-3.5 rounded-xl border border-border bg-background/60 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <RegionFlag
                    code={cachedQuality.countryCode || 'UNKNOWN'}
                    size="md"
                  />
                  <button
                    type="button"
                    onClick={() => void handleCopyIp(cachedQuality.ip)}
                    className="inline-flex items-center gap-1.5 font-mono text-sm font-semibold text-foreground hover:text-primary transition-colors cursor-pointer"
                    title={t('common.copy')}
                  >
                    <span>{cachedQuality.ip}</span>
                    <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                  {cachedQuality.ipConsistent === true ? (
                    <Badge variant="success" size="sm">
                      <CheckCircle2 className="w-3 h-3" />
                      {t('ipQuality.consistentBoth')}
                    </Badge>
                  ) : cachedQuality.ipConsistent === false ? (
                    <Badge variant="warning" size="sm">
                      <AlertTriangle className="w-3 h-3" />
                      {t('ipQuality.conflictIp')}
                    </Badge>
                  ) : (
                    <Badge variant="default" size="sm">
                      {t('ipQuality.singleSource')}
                    </Badge>
                  )}
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge
                    variant={getPurityBadgeVariant(cachedQuality.purityScore)}
                    size="md"
                    className="font-mono tabular-nums"
                  >
                    {t('ipQuality.purityScore')}{' '}
                    {cachedQuality.purityScore ?? '--'}
                  </Badge>
                  {netMeta && (
                    <Badge variant={netMeta.variant} size="md">
                      {netMeta.label}
                    </Badge>
                  )}
                  {nativeMeta && (
                    <Badge variant={nativeMeta.variant} size="md">
                      {nativeMeta.label}
                    </Badge>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-border/60 text-[11px]">
                <div className="min-w-0">
                  <span className="text-muted-foreground">
                    {t('ipQuality.location')}:{' '}
                  </span>
                  <span className="text-foreground font-medium truncate">
                    {cachedQuality.locationDisplay || '-'}
                  </span>
                </div>
                <div className="min-w-0 truncate">
                  <span className="text-muted-foreground">
                    {t('ipQuality.asn')}:{' '}
                  </span>
                  <span
                    className="text-foreground font-mono"
                    title={cachedQuality.asnOrg || undefined}
                  >
                    {cachedQuality.asn ? `AS${cachedQuality.asn}` : '-'}
                    {cachedQuality.asnOrg ? ` · ${cachedQuality.asnOrg}` : ''}
                  </span>
                </div>
                <div className="min-w-0 truncate">
                  <span className="text-muted-foreground">
                    {t('ipQuality.timezone')}:{' '}
                  </span>
                  <span className="text-foreground font-mono">
                    {cachedQuality.timezone || '-'}
                  </span>
                </div>
              </div>
            </div>

            {/* CleanIP vs IPPure Cross-Validation Cards */}
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-foreground px-0.5">
                {t('ipQuality.crossValidationTitle')}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {/* CleanIP Card */}
                <div className="p-3 rounded-xl border border-border bg-background/50 space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-border/60">
                    <span className="font-semibold text-foreground">
                      {t('ipQuality.cleanipTitle')}
                    </span>
                    {cachedQuality.cleanip ? (
                      <div className="flex items-center gap-1.5">
                        <Badge
                          variant={getPurityBadgeVariant(
                            cachedQuality.cleanip.score,
                          )}
                          size="sm"
                          className="font-mono tabular-nums"
                        >
                          {cachedQuality.cleanip.score ?? '--'}/100
                          {cachedQuality.cleanip.grade
                            ? ` (${cachedQuality.cleanip.grade})`
                            : ''}
                        </Badge>
                        <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                          {cachedQuality.cleanip.latencyMs}ms
                        </span>
                      </div>
                    ) : null}
                  </div>

                  {cachedQuality.cleanip ? (
                    <div className="space-y-1.5 text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">
                          {t('ipQuality.egressIp')}
                        </span>
                        <span className="font-mono text-foreground">
                          {cachedQuality.cleanip.ip}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">
                          {t('ipQuality.ipType')}
                        </span>
                        <span className="text-foreground font-medium">
                          {cachedQuality.cleanip.ipType ||
                            cachedQuality.cleanip.networkType ||
                            '-'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">
                          {t('ipQuality.nativeFlag')}
                        </span>
                        <span className="text-foreground font-mono">
                          {cachedQuality.cleanip.nativeOrBroadcast || '-'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">
                          {t('ipQuality.riskLevel')}
                        </span>
                        <span className="text-foreground font-mono">
                          {cachedQuality.cleanip.riskLevel || '-'}
                          {cachedQuality.cleanip.riskScore !== null &&
                          cachedQuality.cleanip.riskScore !== undefined
                            ? ` (${cachedQuality.cleanip.riskScore})`
                            : ''}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">
                          {t('ipQuality.rpki')} / {t('ipQuality.dnsblAbuse')}
                        </span>
                        <span className="text-foreground font-mono tabular-nums">
                          {cachedQuality.cleanip.rpkiStatus || '-'} ·{' '}
                          {cachedQuality.cleanip.dnsblCount ?? 0}/
                          {cachedQuality.cleanip.abuseReports ?? 0}
                        </span>
                      </div>
                      <div className="pt-1 flex items-center flex-wrap gap-1">
                        {cleanipFlags.length === 0 ? (
                          <Badge variant="success" size="sm">
                            {t('ipQuality.noRiskSignals')}
                          </Badge>
                        ) : (
                          cleanipFlags.map((flag) => (
                            <Badge
                              key={flag.label}
                              variant={
                                flag.severity === 'bad'
                                  ? 'danger'
                                  : flag.severity === 'warn'
                                    ? 'warning'
                                    : 'default'
                              }
                              size="sm"
                            >
                              {flag.label}
                            </Badge>
                          ))
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="py-3 text-[11px] text-amber-600 dark:text-amber-400">
                      {t('ipQuality.sourceFailed')}:{' '}
                      {cachedQuality.cleanipError || '-'}
                    </div>
                  )}
                </div>

                {/* IPPure Card */}
                <div className="p-3 rounded-xl border border-border bg-background/50 space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-border/60">
                    <span className="font-semibold text-foreground">
                      {t('ipQuality.ippureTitle')}
                    </span>
                    {cachedQuality.ippure ? (
                      <div className="flex items-center gap-1.5">
                        <Badge
                          variant={getFraudBadgeVariant(
                            cachedQuality.ippure.fraudScore,
                          )}
                          size="sm"
                          className="font-mono tabular-nums"
                          title={t('ipQuality.lowerIsCleaner')}
                        >
                          {t('ipQuality.fraudScore')}{' '}
                          {cachedQuality.ippure.fraudScore ?? '--'}
                        </Badge>
                        <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                          {cachedQuality.ippure.latencyMs}ms
                        </span>
                      </div>
                    ) : null}
                  </div>

                  {cachedQuality.ippure ? (
                    <div className="space-y-1.5 text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">
                          {t('ipQuality.egressIp')}
                        </span>
                        <span className="font-mono text-foreground">
                          {cachedQuality.ippure.ip}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">
                          {t('ipQuality.fraudScore')} (
                          {t('ipQuality.lowerIsCleaner')})
                        </span>
                        <span className="font-mono text-foreground tabular-nums">
                          {cachedQuality.ippure.fraudScore ?? '-'}/100
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">
                          {t('ipQuality.residentialFlag')}
                        </span>
                        <Badge
                          variant={
                            cachedQuality.ippure.isResidential
                              ? 'success'
                              : 'default'
                          }
                          size="sm"
                        >
                          {cachedQuality.ippure.isResidential
                            ? t('ipQuality.yes')
                            : t('ipQuality.no')}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">
                          {t('ipQuality.broadcastFlag')}
                        </span>
                        <Badge
                          variant={
                            cachedQuality.ippure.isBroadcast
                              ? 'warning'
                              : 'success'
                          }
                          size="sm"
                        >
                          {cachedQuality.ippure.isBroadcast
                            ? t('ipQuality.yes')
                            : t('ipQuality.no')}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">
                          {t('ipQuality.asn')}
                        </span>
                        <span
                          className="font-mono text-foreground truncate max-w-[190px]"
                          title={
                            cachedQuality.ippure.asOrganization || undefined
                          }
                        >
                          {cachedQuality.ippure.asn
                            ? `AS${cachedQuality.ippure.asn}`
                            : '-'}
                          {cachedQuality.ippure.asOrganization
                            ? ` · ${cachedQuality.ippure.asOrganization}`
                            : ''}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="py-3 text-[11px] text-amber-600 dark:text-amber-400">
                      {t('ipQuality.sourceFailed')}:{' '}
                      {cachedQuality.ippureError || '-'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* 2. AI & Streaming Region Unlock Section */}
        <div className="p-3.5 rounded-xl border border-border bg-background/60 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-semibold text-foreground">
                {t('ipQuality.mediaTitle')}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              loading={mediaLoading}
              disabled={qualityLoading || mediaLoading}
              icon={<RefreshCw className="w-3 h-3" />}
              onClick={() => void runMediaOnly()}
              className="h-6 px-2 text-[11px]"
            >
              {t('ipQuality.recheckMedia')}
            </Button>
          </div>

          {mediaLoading && !cachedMedia ? (
            <div className="py-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span>{t('ipQuality.probingMedia')}</span>
            </div>
          ) : mediaError && !cachedMedia ? (
            <div className="py-3 text-xs text-rose-500 flex items-center justify-between gap-2">
              <span>
                {t('ipQuality.mediaProbeFailed')}: {mediaError}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void runMediaOnly()}
              >
                {t('ipQuality.retry')}
              </Button>
            </div>
          ) : groupedMedia.length > 0 ? (
            <div className="space-y-3">
              {mediaError && (
                <div className="px-3 py-2 rounded-lg border border-rose-500/30 bg-rose-500/10 text-[11px] text-rose-600 dark:text-rose-400">
                  {t('ipQuality.mediaProbeFailed')}: {mediaError}
                </div>
              )}
              {groupedMedia.map((group) => (
                <div key={group.title} className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                    {group.icon}
                    <span>{group.title}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {group.items.map((item) => {
                      const meta = getMediaStatusMeta(item.status, t)
                      return (
                        <div
                          key={item.id}
                          className="px-2.5 py-2 rounded-lg border border-border/80 bg-card/70 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-foreground truncate">
                              {item.name}
                            </div>
                            <div className="text-[10px] font-mono text-muted-foreground tabular-nums">
                              {item.latencyMs}ms
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {item.region && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-mono font-medium text-foreground bg-secondary/70 px-1.5 py-0.5 rounded border border-border/60">
                                <RegionFlag code={item.region} size="sm" />
                                {item.region}
                              </span>
                            )}
                            <Badge variant={meta.variant} size="sm">
                              {meta.label}
                            </Badge>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  )
}
