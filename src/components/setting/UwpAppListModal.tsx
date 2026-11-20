import {
  AppWindow,
  CheckCircle2,
  Copy,
  FolderLock,
  Loader2,
  RefreshCw,
  Search,
  XCircle,
} from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { t as translate, useTranslation } from '../../i18n'
import { getUwpAppList } from '../../services/tauri'
import { toast } from '../../stores/toastStore'
import type { UwpAppInfo } from '../../types'
import { Badge, Button, Input, Modal } from '../common'

interface UwpAppListModalProps {
  isOpen: boolean
  onClose: () => void
}

type FilterStatus = 'all' | 'exempted' | 'unexempted'

export const UwpAppListModal: React.FC<UwpAppListModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation()
  const [apps, setApps] = useState<UwpAppInfo[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [refreshing, setRefreshing] = useState<boolean>(false)
  const [search, setSearch] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all')

  const loadApps = useCallback(async (isInitial = false) => {
    if (isInitial) {
      setLoading(true)
    } else {
      setRefreshing(true)
    }
    const startTime = Date.now()
    try {
      const list = await getUwpAppList()
      setApps(list)
      if (!isInitial) {
        const elapsed = Date.now() - startTime
        if (elapsed < 350) {
          const { promise, resolve } = Promise.withResolvers<void>()
          setTimeout(resolve, 350 - elapsed)
          await promise
        }
        toast.success(translate('settingsUwp.refreshed'))
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : String(err),
        translate('settingsUwp.loadFailed'),
      )
    } finally {
      if (isInitial) {
        setLoading(false)
      } else {
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      loadApps(true)
      setSearch('')
      setStatusFilter('all')
    }
  }, [isOpen, loadApps])

  const stats = useMemo(() => {
    const total = apps.length
    const exempted = apps.filter((a) => a.exempted).length
    const unexempted = total - exempted
    return { total, exempted, unexempted }
  }, [apps])

  const filteredApps = useMemo(() => {
    const query = search.trim().toLowerCase()
    return apps.filter((app) => {
      // Status filter
      if (statusFilter === 'exempted' && !app.exempted) return false
      if (statusFilter === 'unexempted' && app.exempted) return false

      // Search keyword filter
      if (!query) return true
      return (
        app.name.toLowerCase().includes(query) ||
        app.moniker.toLowerCase().includes(query) ||
        app.sid.toLowerCase().includes(query)
      )
    })
  }, [apps, search, statusFilter])

  const handleCopySid = (sid: string) => {
    navigator.clipboard
      .writeText(sid)
      .then(() => {
        toast.success(sid, t('settingsUwp.copySidToast'))
      })
      .catch(() => {
        toast.error(t('settingsUwp.copyFailed'))
      })
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('settingsUwp.title')}
      subtitle={t('settingsUwp.subtitle', {
        total: stats.total,
        exempted: stats.exempted,
        unexempted: stats.unexempted,
      })}
      icon={<AppWindow className="w-4 h-4 text-primary" />}
      maxWidth="2xl"
      noPadding
      bodyClassName="flex flex-col overflow-hidden"
      footer={
        <div className="w-full flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {t('settingsUwp.footerCount', {
              shown: filteredApps.length,
              total: stats.total,
            })}
          </span>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('settingsUwp.close')}
          </Button>
        </div>
      }
    >
      {/* Fixed Filter & Search Bar */}
      <div className="px-4 pt-3.5 pb-3 border-b border-border/60 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shrink-0">
        <div className="relative flex-1 min-w-0">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            placeholder={t('settingsUwp.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 text-xs py-1.5 h-8 w-full"
          />
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs h-8 items-center">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`h-7 px-2.5 rounded-md transition-colors text-[11px] font-medium flex items-center justify-center ${
                statusFilter === 'all'
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('settingsUwp.filterAll', { count: stats.total })}
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('exempted')}
              className={`h-7 px-2.5 rounded-md transition-colors text-[11px] font-medium flex items-center justify-center gap-1 ${
                statusFilter === 'exempted'
                  ? 'bg-background text-emerald-500 shadow-xs'
                  : 'text-muted-foreground hover:text-emerald-500'
              }`}
            >
              <CheckCircle2 className="w-3 h-3" />
              {t('settingsUwp.filterExempted', { count: stats.exempted })}
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('unexempted')}
              className={`h-7 px-2.5 rounded-md transition-colors text-[11px] font-medium flex items-center justify-center gap-1 ${
                statusFilter === 'unexempted'
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <XCircle className="w-3 h-3" />
              {t('settingsUwp.filterUnexempted', { count: stats.unexempted })}
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => loadApps(false)}
            disabled={loading || refreshing}
            className="h-8 px-2"
            icon={
              <RefreshCw
                className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`}
              />
            }
            title={t('settingsUwp.refreshTitle')}
          />
        </div>
      </div>

      {/* Scrollable Apps List Area */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3.5 space-y-2.5">
        {/* Apps List / Content State */}
        {loading && apps.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center text-center space-y-2 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <span className="text-xs">{t('settingsUwp.loading')}</span>
          </div>
        ) : filteredApps.length === 0 ? (
          <div className="py-16 text-center text-xs text-muted-foreground space-y-2">
            <FolderLock className="w-8 h-8 mx-auto text-muted-foreground/40" />
            <div>
              {apps.length === 0
                ? t('settingsUwp.emptyNoApps')
                : t('settingsUwp.emptyNoMatch')}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredApps.map((app) => (
              <div
                key={app.sid}
                className="p-3 rounded-xl border border-border/80 bg-background/50 hover:bg-background/80 transition-colors flex items-center justify-between gap-3 text-xs"
              >
                <div className="min-w-0 space-y-1 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="font-medium text-foreground truncate min-w-0 max-w-[280px]"
                      title={app.name}
                    >
                      {app.name}
                    </span>
                    {app.moniker && app.moniker !== app.name && (
                      <span
                        className="text-[11px] text-muted-foreground/80 truncate font-mono min-w-0 max-w-[260px] hidden sm:inline-block"
                        title={app.moniker}
                      >
                        ({app.moniker})
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-mono min-w-0">
                    <span className="truncate min-w-0" title={app.sid}>
                      SID: {app.sid}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopySid(app.sid)}
                      className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded shrink-0"
                      title={t('settingsUwp.copySidTitle')}
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                <div className="shrink-0 flex items-center">
                  {app.exempted ? (
                    <Badge variant="success" size="sm" dot>
                      {t('settingsUwp.statusExempted')}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" size="sm">
                      {t('settingsUwp.statusUnexempted')}
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
