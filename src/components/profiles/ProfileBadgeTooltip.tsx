import type React from 'react'
import { useTranslation } from '../../i18n'
import type { ProfileItem } from '../../types'
import {
  SUBSCRIPTION_TONE_CLASSES,
  formatExpireDate,
  formatTrafficBytes,
  getSubscriptionStats,
} from '../../utils/subscription'
import { Tooltip } from '../common'

interface ProfileBadgeTooltipProps {
  profile?: ProfileItem
  fallbackName: string
  size?: 'xs' | 'sm'
}

export const ProfileBadgeTooltip: React.FC<ProfileBadgeTooltipProps> = ({
  profile,
  fallbackName,
  size = 'sm',
}) => {
  const { t, locale } = useTranslation()
  const displayName = profile?.name || fallbackName
  const stats = getSubscriptionStats(profile?.subscriptionInfo)

  const badgeClass =
    size === 'xs'
      ? 'inline-flex items-center justify-center text-[9px] font-medium leading-none px-1 py-0.5 rounded bg-muted/80 text-muted-foreground border border-border/50 shrink-0 select-none'
      : 'inline-flex items-center justify-center text-[10px] font-medium leading-none px-1.5 py-0.5 rounded bg-muted/80 text-muted-foreground border border-border/50 shrink-0 select-none'

  const remainingTextClass =
    SUBSCRIPTION_TONE_CLASSES.trafficText[stats.trafficTone]
  const progressColorClass =
    SUBSCRIPTION_TONE_CLASSES.progressBar[stats.trafficTone]
  const expiryTextClass =
    stats.expiryTone === 'normal'
      ? 'text-foreground'
      : SUBSCRIPTION_TONE_CLASSES.expiryText[stats.expiryTone]

  const tooltipContent = (
    <div className="min-w-[186px] max-w-[240px] space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-foreground truncate">
          {displayName}
        </span>
        {profile && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground shrink-0">
            {profile.type === 'remote'
              ? t('profileMain.typeRemote')
              : t('profileMain.typeLocal')}
          </span>
        )}
      </div>

      {stats.hasAny ? (
        <div className="pt-1 border-t border-border/60 space-y-1">
          {stats.remainingBytes !== null && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">
                {t('profileMain.tooltipRemaining')}
              </span>
              <span className={`font-mono font-semibold ${remainingTextClass}`}>
                {formatTrafficBytes(stats.remainingBytes)}
              </span>
            </div>
          )}

          {stats.usedBytes !== null && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">
                {t('profileMain.tooltipUsed')}
              </span>
              <span className="font-mono text-foreground">
                {formatTrafficBytes(stats.usedBytes)}
              </span>
            </div>
          )}

          {stats.totalBytes !== null && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">
                {t('profileMain.tooltipTotal')}
              </span>
              <span className="font-mono text-foreground">
                {formatTrafficBytes(stats.totalBytes)}
              </span>
            </div>
          )}

          {stats.remainingPercent !== null && (
            <div className="pt-0.5">
              <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${progressColorClass}`}
                  style={{
                    width:
                      stats.remainingPercent <= 0
                        ? '0%'
                        : `${Math.max(2, Math.round(stats.remainingPercent))}%`,
                  }}
                />
              </div>
            </div>
          )}

          {stats.hasExpiry && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">
                {t('profileMain.tooltipExpiry')}
              </span>
              <span className={`font-mono ${expiryTextClass}`}>
                {stats.neverExpires
                  ? t('profileMain.expireNever')
                  : stats.isExpired
                    ? t('profileMain.expired')
                    : stats.expireAt !== null
                      ? `${formatExpireDate(stats.expireAt, locale)}${
                          stats.daysLeft !== null
                            ? ` (${t('profileMain.expireDaysLeft', { days: stats.daysLeft })})`
                            : ''
                        }`
                      : ''}
              </span>
            </div>
          )}

          {stats.resetDays !== null && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">
                {t('profileMain.tooltipReset')}
              </span>
              <span className="font-mono text-foreground">
                {t('profileMain.resetInDays', { days: stats.resetDays })}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="pt-1 border-t border-border/60 space-y-0.5 text-[10px] text-muted-foreground">
          {profile && (
            <div className="flex items-center justify-between gap-3">
              <span>{t('profileMain.tooltipNodes')}</span>
              <span className="font-mono text-foreground">
                {profile.nodeCount}
              </span>
            </div>
          )}
          <div>{t('profileMain.tooltipNoQuota')}</div>
        </div>
      )}
    </div>
  )

  return (
    <Tooltip content={tooltipContent} className="shrink-0">
      <span className={badgeClass}>{displayName}</span>
    </Tooltip>
  )
}
