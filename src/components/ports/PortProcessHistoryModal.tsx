import {
  AppWindow,
  Clock,
  History,
  Loader2,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import {
  type TranslationKey,
  type TranslationParams,
  useTranslation,
} from '../../i18n'
import * as api from '../../services/tauri'
import type { PortProcessUsageItem } from '../../types'
import { Badge, Button, Modal, toast } from '../common'

function formatRelativeLastSeen(
  epochMs: number,
  t: (key: TranslationKey, params?: TranslationParams) => string,
): string {
  const diffMs = Math.max(0, Date.now() - epochMs)
  const diffMins = Math.floor(diffMs / 60_000)
  if (diffMins < 1) return t('ports.timeJustNow')
  if (diffMins < 60) return t('ports.timeMinutesAgo', { count: diffMins })
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return t('ports.timeHoursAgo', { count: diffHours })
  const diffDays = Math.floor(diffHours / 24)
  return t('ports.timeDaysAgo', { count: diffDays })
}

export interface PortProcessListProps {
  items: PortProcessUsageItem[]
  compact?: boolean
}

function ProcessIcon({
  iconDataUrl,
  sizeClass,
  wellClass,
}: {
  iconDataUrl?: string | null
  sizeClass: string
  wellClass?: string
}) {
  const content = iconDataUrl?.startsWith('data:image/') ? (
    <img
      src={iconDataUrl}
      alt=""
      className={`${sizeClass} rounded-[2px] object-contain shrink-0`}
    />
  ) : (
    <AppWindow className={`${sizeClass} text-muted-foreground shrink-0`} />
  )

  if (!wellClass) return content

  return (
    <span
      className={`inline-flex items-center justify-center rounded-md bg-muted/60 border border-border/50 shrink-0 ${wellClass}`}
    >
      {content}
    </span>
  )
}

export const PortProcessList: React.FC<PortProcessListProps> = ({
  items,
  compact = false,
}) => {
  const { t } = useTranslation()

  if (compact) {
    return (
      <div className="grid grid-cols-2 gap-1.5 max-h-[154px] scroll-fade-y pr-1">
        {items.map((item) => {
          const key = `${item.processName}:${item.processPath ?? ''}`
          const exactTime = new Date(item.lastSeenAt).toLocaleString()
          const tooltip = [
            item.processPath || item.processName,
            t('ports.processHistoryHits', { count: item.hitCount }),
            exactTime,
          ].join(' · ')
          return (
            <div
              key={key}
              title={tooltip}
              className={`flex items-center gap-2 min-w-0 px-2 py-1.5 rounded-md border transition-colors ${
                item.isActive
                  ? 'border-emerald-500/40 bg-emerald-500/[0.07]'
                  : 'border-border/70 bg-card/90 hover:bg-accent/60'
              }`}
            >
              <ProcessIcon
                iconDataUrl={item.iconDataUrl}
                sizeClass="w-3.5 h-3.5"
                wellClass="w-5 h-5"
              />
              <span className="text-xs font-medium text-foreground truncate min-w-0 flex-1">
                {item.processName}
              </span>
              {item.isActive && (
                <span
                  className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"
                  aria-hidden="true"
                />
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="divide-y divide-border/50 border border-border rounded-lg bg-background/60 scroll-fade-y max-h-72">
      {items.map((item) => {
        const key = `${item.processName}:${item.processPath ?? ''}`
        const exactTime = new Date(item.lastSeenAt).toLocaleString()
        const relativeTime = formatRelativeLastSeen(item.lastSeenAt, t)
        return (
          <div
            key={key}
            className="px-3 py-2 flex items-center justify-between gap-2.5 text-xs hover:bg-accent/35 transition-colors"
          >
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <ProcessIcon
                iconDataUrl={item.iconDataUrl}
                sizeClass="w-4 h-4"
                wellClass="w-7 h-7"
              />
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="font-medium text-foreground truncate">
                    {item.processName}
                  </span>
                  {item.isActive && (
                    <Badge
                      variant="success"
                      size="sm"
                      dot
                      className="!text-[10px] !py-0 !px-1.5 leading-4 shrink-0"
                    >
                      {t('ports.processHistoryActiveBadge', {
                        count: item.activeConnectionCount,
                      })}
                    </Badge>
                  )}
                </div>
                {item.processPath && (
                  <p
                    className="text-[11px] font-mono text-muted-foreground truncate"
                    title={item.processPath}
                  >
                    {item.processPath}
                  </p>
                )}
              </div>
            </div>
            <div
              className="flex flex-col items-end shrink-0 text-[10px] tabular-nums text-muted-foreground gap-0.5"
              title={exactTime}
            >
              <span className="inline-flex items-center gap-1 text-foreground/80">
                <Clock className="w-2.5 h-2.5 text-muted-foreground" />
                {relativeTime}
              </span>
              <span className="font-mono text-muted-foreground/75">
                {t('ports.processHistoryHits', { count: item.hitCount })}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export interface PortProcessHistoryModalProps {
  isOpen: boolean
  port: number | null
  onClose: () => void
}

export const PortProcessHistoryModal: React.FC<
  PortProcessHistoryModalProps
> = ({ isOpen, port, onClose }) => {
  const { t } = useTranslation()
  const [items, setItems] = useState<PortProcessUsageItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isClearing, setIsClearing] = useState(false)

  const loadHistory = useCallback(async (targetPort: number) => {
    setIsLoading(true)
    try {
      const list = await api.getPortProcessHistory(targetPort)
      setItems(list)
    } catch {
      setItems([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isOpen || port === null) {
      setItems([])
      return
    }
    let cancelled = false
    setIsLoading(true)
    api
      .getPortProcessHistory(port)
      .then((list) => {
        if (!cancelled) setItems(list)
      })
      .catch(() => {
        if (!cancelled) setItems([])
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, port])

  const handleClear = async () => {
    if (port === null) return
    setIsClearing(true)
    try {
      await api.clearPortProcessHistory(port)
      toast.success(t('ports.processHistoryCleared', { port }))
      await loadHistory(port)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setIsClearing(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen && port !== null}
      onClose={onClose}
      title={t('ports.processHistoryTitle')}
      subtitle={
        port !== null ? t('ports.processHistorySubtitle', { port }) : undefined
      }
      icon={<History className="w-4 h-4 text-primary" />}
      maxWidth="md"
      footer={
        <div className="flex items-center justify-between w-full gap-2">
          <div>
            {items.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleClear}
                loading={isClearing}
                disabled={isLoading}
                icon={<Trash2 className="w-3.5 h-3.5 text-destructive" />}
              >
                {t('ports.processHistoryClear')}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => port !== null && loadHistory(port)}
              disabled={isLoading || isClearing}
              icon={
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`}
                />
              }
            >
              {t('ports.processHistoryRefresh')}
            </Button>
            <Button variant="primary" size="sm" onClick={onClose}>
              {t('common.close')}
            </Button>
          </div>
        </div>
      }
    >
      {isLoading && items.length === 0 ? (
        <div className="py-8 flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          <span>{t('ports.processHistoryLoading')}</span>
        </div>
      ) : items.length === 0 ? (
        <div className="py-8 px-4 border border-dashed border-border rounded-lg flex flex-col items-center justify-center text-center gap-1.5 bg-card/40">
          <AppWindow className="w-6 h-6 text-muted-foreground/60 mb-1" />
          <p className="text-xs font-medium text-foreground">
            {t('ports.processHistoryEmpty')}
          </p>
          <p className="text-[11px] text-muted-foreground max-w-xs leading-relaxed">
            {t('ports.processHistoryEmptyHint')}
          </p>
        </div>
      ) : (
        <PortProcessList items={items} />
      )}
    </Modal>
  )
}
