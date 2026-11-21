import { AlertTriangle, RefreshCw, Sparkles } from 'lucide-react'
import type React from 'react'
import { type TabType, useAppStore } from '../../stores/appStore'
import { Button } from '../common'
import { useTranslation } from '../../i18n'

const tabTitleKeys: Record<
  TabType,
  {
    titleKey:
      | 'header.portsTitle'
      | 'header.proxiesTitle'
      | 'header.profilesTitle'
      | 'header.connectionsTitle'
      | 'header.analyticsTitle'
      | 'header.settingsTitle'
    subtitleKey:
      | 'header.portsSubtitle'
      | 'header.proxiesSubtitle'
      | 'header.profilesSubtitle'
      | 'header.connectionsSubtitle'
      | 'header.analyticsSubtitle'
      | 'header.settingsSubtitle'
  }
> = {
  ports: {
    titleKey: 'header.portsTitle',
    subtitleKey: 'header.portsSubtitle',
  },
  proxies: {
    titleKey: 'header.proxiesTitle',
    subtitleKey: 'header.proxiesSubtitle',
  },
  profiles: {
    titleKey: 'header.profilesTitle',
    subtitleKey: 'header.profilesSubtitle',
  },
  connections: {
    titleKey: 'header.connectionsTitle',
    subtitleKey: 'header.connectionsSubtitle',
  },
  analytics: {
    titleKey: 'header.analyticsTitle',
    subtitleKey: 'header.analyticsSubtitle',
  },
  settings: {
    titleKey: 'header.settingsTitle',
    subtitleKey: 'header.settingsSubtitle',
  },
}

export const Header: React.FC = () => {
  const { t } = useTranslation()
  const activeTab = useAppStore((state) => state.activeTab)
  const config = useAppStore((state) => state.config)
  const coreStatus = useAppStore((state) => state.coreStatus)
  const restartCore = useAppStore((state) => state.restartCore)
  const startCore = useAppStore((state) => state.startCore)
  const coreLoading = useAppStore((state) => state.coreLoading)
  const error = useAppStore((state) => state.error)
  const hasNewVersion = useAppStore((state) => state.hasNewVersion)
  const appUpdateInfo = useAppStore((state) => state.appUpdateInfo)
  const scrollToSettingSection = useAppStore(
    (state) => state.scrollToSettingSection,
  )
  const info = tabTitleKeys[activeTab] || tabTitleKeys.ports

  const isRunning = coreStatus?.running ?? false
  const portNeedsRestart =
    config?.controllerPort !== undefined &&
    coreStatus?.controllerPort !== undefined &&
    config.controllerPort !== coreStatus.controllerPort

  return (
    <header className="h-[52px] px-5 border-b border-border bg-card/50 flex items-center justify-between select-none shrink-0 gap-4">
      <div className="min-w-0 flex-1 truncate">
        <h2 className="text-sm font-semibold text-foreground leading-tight truncate">
          {t(info.titleKey)}
        </h2>
        <p className="text-[11px] text-muted-foreground leading-none mt-1 truncate">
          {t(info.subtitleKey)}
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {hasNewVersion && activeTab !== 'settings' && (
          <button
            type="button"
            onClick={() => scrollToSettingSection('setting-section-about')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20 text-primary hover:bg-primary/15 transition-all text-xs font-medium cursor-pointer shadow-xs active:scale-95 animate-in fade-in"
            title={t('header.newVersionTitle')}
          >
            <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
            <span>
              {t('header.newVersionBadge', {
                version: appUpdateInfo?.latestVersion ?? '',
              })}
            </span>
          </button>
        )}
        {portNeedsRestart ? (
          <div className="flex items-center gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-medium">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span>
                {isRunning
                  ? t('header.portChangedRestart', {
                      port: config?.controllerPort ?? '',
                    })
                  : t('header.portChangedStart', {
                      port: config?.controllerPort ?? '',
                    })}
              </span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled={coreLoading}
              onClick={() => (isRunning ? restartCore() : startCore())}
              className="text-xs py-1 h-auto border-amber-500/30 hover:bg-amber-500/10 text-amber-600 dark:text-amber-400"
              icon={
                <RefreshCw
                  className={`w-3 h-3 ${coreLoading ? 'animate-spin' : ''}`}
                />
              }
            >
              {isRunning
                ? t('header.restartToApply')
                : t('header.startToApply')}
            </Button>
          </div>
        ) : (
          !isRunning &&
          error && (
            <div className="flex items-center gap-2 animate-in fade-in duration-200">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs font-medium">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                <span className="max-w-xs truncate" title={error}>
                  {error}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={coreLoading}
                onClick={() => startCore()}
                className="text-xs py-1 h-auto text-rose-500 border-rose-500/30 hover:bg-rose-500/10"
                icon={
                  <RefreshCw
                    className={`w-3 h-3 ${coreLoading ? 'animate-spin' : ''}`}
                  />
                }
              >
                {t('header.retryStart')}
              </Button>
            </div>
          )
        )}
      </div>
    </header>
  )
}
