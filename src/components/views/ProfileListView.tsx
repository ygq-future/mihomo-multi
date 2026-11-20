import {
  Building2,
  Calendar,
  Check,
  Clock,
  Copy,
  Database,
  FileCode,
  FolderOpen,
  Globe,
  Layers,
  ListFilter,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import type { ProfileItem } from '../../types'
import {
  SUBSCRIPTION_TONE_CLASSES,
  formatExpireDate,
  formatTrafficBytes,
  getSubscriptionStats,
} from '../../utils/subscription'
import { Button, Modal, toast } from '../common'
import { AddLocalModal } from '../profiles/AddLocalModal'
import { AddRemoteModal } from '../profiles/AddRemoteModal'
import { EditProfileModal } from '../profiles/EditProfileModal'
import { ProfileNodesModal } from '../profiles/ProfileNodesModal'
import { ResidentialProxyManager } from '../profiles/ResidentialProxyManager'

export const ProfileListView: React.FC = () => {
  const { t, locale } = useTranslation()
  const {
    profiles,
    config,
    fetchProfiles,
    addRemoteProfile,
    addLocalProfile,
    updateProfile,
    editProfile,
    deleteProfile,
    updatingProfileIds,
    profileLoading,
    openFileInFolder,
  } = useAppStore()

  const [isRemoteModalOpen, setIsRemoteModalOpen] = useState(false)
  const [isLocalModalOpen, setIsLocalModalOpen] = useState(false)
  const [isResidentialManagerOpen, setIsResidentialManagerOpen] =
    useState(false)
  const [editingProfile, setEditingProfile] = useState<ProfileItem | null>(null)
  const [nodesModalProfile, setNodesModalProfile] =
    useState<ProfileItem | null>(null)
  const [deletingProfile, setDeletingProfile] = useState<ProfileItem | null>(
    null,
  )
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [isRefreshingAll, setIsRefreshingAll] = useState(false)

  useEffect(() => {
    fetchProfiles()
  }, [fetchProfiles])

  const handleAddRemote = async (
    name: string,
    url: string,
    intervalMins: number,
  ) => {
    await addRemoteProfile(name, url, intervalMins)
    toast.success(t('profileMain.toastRemoteAdded', { name }))
  }

  const handleAddLocal = async (name: string, filePath: string) => {
    await addLocalProfile(name, filePath)
    toast.success(t('profileMain.toastLocalImported', { name }))
  }

  const handleEditProfile = async (
    id: string,
    name: string,
    url: string | undefined,
    intervalMins: number,
  ) => {
    await editProfile(id, name, url, intervalMins)
    toast.success(t('profileMain.toastUpdated', { name }))
  }

  const handleRefresh = async (profile: ProfileItem) => {
    try {
      const updated = await updateProfile(profile.id)
      toast.success(
        t('profileMain.toastRefreshed', {
          name: profile.name,
          count: updated.nodeCount,
        }),
      )
    } catch (err) {
      toast.error(
        t('profileMain.toastRefreshFailed', {
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    }
  }
  const isAnyUpdating = Object.values(updatingProfileIds).some(Boolean)
  const isRefreshDisabled =
    profiles.length === 0 || isRefreshingAll || isAnyUpdating

  const handleRefreshAll = async () => {
    if (isRefreshDisabled) return

    setIsRefreshingAll(true)
    try {
      const results = await Promise.allSettled(
        profiles.map(async (profile) => {
          const updated = await updateProfile(profile.id)
          return { profile, updated }
        }),
      )

      const successCount = results.filter(
        (r) => r.status === 'fulfilled',
      ).length
      const failedCount = results.filter((r) => r.status === 'rejected').length

      if (failedCount === 0) {
        toast.success(
          t('profileMain.toastRefreshAllSuccess', { count: successCount }),
        )
      } else if (successCount === 0) {
        toast.error(
          t('profileMain.toastRefreshAllFailed', { count: failedCount }),
        )
      } else {
        toast.warning(
          t('profileMain.toastRefreshAllPartial', {
            success: successCount,
            failed: failedCount,
          }),
        )
      }
    } finally {
      setIsRefreshingAll(false)
    }
  }

  const handleCopyLink = async (profile: ProfileItem) => {
    const textToCopy = profile.url || profile.filePath
    try {
      await navigator.clipboard.writeText(textToCopy)
      setCopiedId(profile.id)
      toast.success(t('profileMain.toastCopied'))
      setTimeout(
        () => setCopiedId((id) => (id === profile.id ? null : id)),
        2000,
      )
    } catch {
      toast.error(t('profileMain.toastCopyFailed'))
    }
  }

  const handleOpenFolder = async (profile: ProfileItem) => {
    try {
      await openFileInFolder(profile.filePath)
    } catch (err) {
      toast.error(
        t('profileMain.toastOpenFolderFailed', {
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    }
  }

  const handleDeleteConfirm = async () => {
    if (!deletingProfile) return
    try {
      await deleteProfile(deletingProfile.id)
      toast.success(
        t('profileMain.toastDeleted', { name: deletingProfile.name }),
      )
      setDeletingProfile(null)
    } catch (err) {
      toast.error(
        t('profileMain.toastDeleteFailed', {
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    }
  }

  const formatTimestamp = (timestamp: number) => {
    if (!timestamp) return t('profileMain.neverUpdated')
    const date = new Date(timestamp * 1000)
    return date.toLocaleString(locale, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  const formatInterval = (mins: number) => {
    if (mins === 0) return t('profileMain.intervalManual')
    if (mins < 60) return t('profileMain.intervalEveryMinutes', { count: mins })
    if (mins >= 1440 && mins % 1440 === 0) {
      return t('profileMain.intervalEveryDays', { count: mins / 1440 })
    }
    return t('profileMain.intervalEveryHours', { count: Math.round(mins / 60) })
  }

  const totalNodes = profiles.reduce((acc, p) => acc + p.nodeCount, 0)

  return (
    <div className="h-full flex flex-col p-6 space-y-4 w-full overflow-hidden">
      {/* Top Sticky Header Card */}
      <div className="bg-card border border-border rounded-xl p-4 shadow-sm shrink-0 flex items-center justify-between gap-3 overflow-x-auto">
        <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground whitespace-nowrap">
          <div>
            {t('profileMain.importedProfilesLabel')}{' '}
            <b className="text-foreground font-mono">{profiles.length}</b>
          </div>
          <div>•</div>
          <div>
            {t('profileMain.totalNodesLabel')}{' '}
            <b className="text-foreground font-mono">{totalNodes}</b>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsResidentialManagerOpen(true)}
            title={t('profileMain.residentialExitsTitle')}
            icon={<Building2 className="w-3.5 h-3.5" />}
          >
            {t('profileMain.residentialExits')}
            {(config?.residentialProxies?.length ?? 0) > 0
              ? ` (${config?.residentialProxies?.length})`
              : ''}
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={isRefreshDisabled}
            onClick={handleRefreshAll}
            title={
              profiles.length === 0
                ? t('profileMain.noProfilesTitle')
                : t('profileMain.refreshAllTitle')
            }
            icon={
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  isRefreshingAll ? 'animate-spin text-primary' : ''
                }`}
              />
            }
          >
            {isRefreshingAll
              ? t('profileMain.refreshing')
              : t('profileMain.refreshAll')}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsLocalModalOpen(true)}
            icon={<FileCode className="w-3.5 h-3.5" />}
          >
            {t('profileMain.importLocalYaml')}
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={() => setIsRemoteModalOpen(true)}
            icon={<Plus className="w-3.5 h-3.5" />}
          >
            {t('profileMain.addRemote')}
          </Button>
        </div>
      </div>

      {/* Profile Cards Scrollable Container */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden pr-1 pb-2">
        {profileLoading && profiles.length === 0 ? (
          <div className="py-24 flex flex-col items-center justify-center space-y-3 text-muted-foreground">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <span className="text-xs">{t('profileMain.loadingList')}</span>
          </div>
        ) : profiles.length === 0 ? (
          /* Empty State */
          <div className="border border-dashed border-border rounded-xl p-12 flex flex-col items-center justify-center text-center space-y-4 bg-card/30">
            <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <Layers className="w-6 h-6" />
            </div>
            <div className="space-y-1 max-w-sm">
              <h3 className="text-sm font-semibold text-foreground">
                {t('profileMain.emptyTitle')}
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t('profileMain.emptyDesc')}
              </p>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <Button
                variant="primary"
                onClick={() => setIsRemoteModalOpen(true)}
                icon={<Plus className="w-3.5 h-3.5" />}
              >
                {t('profileMain.emptyCta')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">
            {profiles.map((profile) => {
              const isUpdating = updatingProfileIds[profile.id] ?? false
              const isRemote = profile.type === 'remote'
              const isCopied = copiedId === profile.id
              const stats = getSubscriptionStats(profile.subscriptionInfo)
              const trafficTextClass =
                SUBSCRIPTION_TONE_CLASSES.trafficText[stats.trafficTone]
              const progressBarClass =
                SUBSCRIPTION_TONE_CLASSES.progressBar[stats.trafficTone]
              const expiryTextClass =
                SUBSCRIPTION_TONE_CLASSES.expiryText[stats.expiryTone]
              return (
                <div
                  key={profile.id}
                  className="bg-card border border-border rounded-xl p-3.5 space-y-2.5 shadow-sm hover:border-primary/40 transition-all flex flex-col justify-between group"
                >
                  <div className="space-y-2.5">
                    {/* Top Bar: Icon + Name + Badge */}
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                            isRemote
                              ? 'bg-blue-500/10 text-blue-500'
                              : 'bg-amber-500/10 text-amber-500'
                          }`}
                        >
                          {isRemote ? (
                            <Globe className="w-3.5 h-3.5" />
                          ) : (
                            <FileCode className="w-3.5 h-3.5" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4
                            className="text-xs font-semibold text-foreground truncate"
                            title={profile.name}
                          >
                            {profile.name}
                          </h4>
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            {isRemote
                              ? t('profileMain.typeRemote')
                              : t('profileMain.typeLocal')}
                          </span>
                        </div>
                      </div>

                      <span
                        className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium shrink-0 border ${
                          profile.nodeCount > 0
                            ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                            : 'bg-muted text-muted-foreground border-border'
                        }`}
                      >
                        {t('profileMain.nodeCount', {
                          count: profile.nodeCount,
                        })}
                      </span>
                    </div>

                    {/* URL / Path Preview with Quick Copy */}
                    <div className="flex items-center justify-between gap-1.5 text-[10px] text-muted-foreground font-mono bg-background/60 border border-border/60 rounded-lg px-2 py-1">
                      <span
                        className="truncate flex-1"
                        title={profile.url || profile.filePath}
                      >
                        {profile.url || profile.filePath}
                      </span>

                      <button
                        type="button"
                        onClick={() => handleCopyLink(profile)}
                        title={t('profileMain.copyLinkTitle')}
                        className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
                      >
                        {isCopied ? (
                          <Check className="w-3 h-3 text-emerald-500" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    </div>

                    {/* Subscription Quota & Expiry */}
                    {stats.hasAny && (
                      <div className="bg-background/50 border border-border/50 rounded-lg px-2.5 py-1.5 space-y-1 text-[10px]">
                        {stats.hasTraffic && (
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1 min-w-0">
                              <Database className="w-2.5 h-2.5 text-muted-foreground shrink-0" />
                              <span
                                className={`font-mono font-medium truncate ${trafficTextClass}`}
                              >
                                {stats.remainingBytes !== null &&
                                stats.totalBytes !== null
                                  ? t('profileMain.remainingOfTotal', {
                                      remaining: formatTrafficBytes(
                                        stats.remainingBytes,
                                      ),
                                      total: formatTrafficBytes(
                                        stats.totalBytes,
                                      ),
                                    })
                                  : stats.remainingBytes !== null
                                    ? t('profileMain.remainingTraffic', {
                                        amount: formatTrafficBytes(
                                          stats.remainingBytes,
                                        ),
                                      })
                                    : stats.usedBytes !== null
                                      ? t('profileMain.usedTraffic', {
                                          used: formatTrafficBytes(
                                            stats.usedBytes,
                                          ),
                                        })
                                      : ''}
                              </span>
                            </div>
                            {stats.usedBytes !== null ? (
                              <span className="text-muted-foreground font-mono shrink-0">
                                {t('profileMain.usedTraffic', {
                                  used: formatTrafficBytes(stats.usedBytes),
                                })}
                              </span>
                            ) : stats.resetDays !== null ? (
                              <span className="text-muted-foreground font-mono shrink-0">
                                {t('profileMain.resetInDays', {
                                  days: stats.resetDays,
                                })}
                              </span>
                            ) : null}
                          </div>
                        )}

                        {stats.remainingPercent !== null && (
                          <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${progressBarClass}`}
                              style={{
                                width:
                                  stats.remainingPercent <= 0
                                    ? '0%'
                                    : `${Math.max(2, Math.round(stats.remainingPercent))}%`,
                              }}
                            />
                          </div>
                        )}

                        {(stats.hasExpiry ||
                          (stats.resetDays !== null &&
                            (!stats.hasTraffic ||
                              stats.usedBytes !== null))) && (
                          <div className="flex items-center justify-between gap-2">
                            {stats.hasExpiry ? (
                              <div className="flex items-center gap-1 min-w-0">
                                <Calendar className="w-2.5 h-2.5 text-muted-foreground shrink-0" />
                                <span
                                  className={`font-mono truncate ${expiryTextClass}`}
                                >
                                  {stats.neverExpires
                                    ? t('profileMain.expireNever')
                                    : stats.isExpired
                                      ? t('profileMain.expired')
                                      : stats.expireAt !== null
                                        ? `${t('profileMain.expireOn', {
                                            date: formatExpireDate(
                                              stats.expireAt,
                                              locale,
                                            ),
                                          })}${
                                            stats.daysLeft !== null
                                              ? ` · ${t('profileMain.expireDaysLeft', { days: stats.daysLeft })}`
                                              : ''
                                          }`
                                        : ''}
                                </span>
                              </div>
                            ) : (
                              <span />
                            )}
                            {stats.resetDays !== null &&
                              (!stats.hasTraffic ||
                                stats.usedBytes !== null) && (
                                <span className="text-muted-foreground font-mono shrink-0">
                                  {t('profileMain.resetInDays', {
                                    days: stats.resetDays,
                                  })}
                                </span>
                              )}
                          </div>
                        )}
                      </div>
                    )}
                    {/* Metadata Row */}
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-0.5">
                      <div className="flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" />
                        <span>{formatTimestamp(profile.lastUpdatedAt)}</span>
                      </div>

                      <div className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary/60" />
                        <span>
                          {formatInterval(profile.autoUpdateIntervalMins)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Card Actions */}
                  <div className="pt-2 border-t border-border/50 flex items-center justify-between gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="!text-[10px] !px-2 !py-0.5 h-6 gap-1 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10"
                      onClick={() => setNodesModalProfile(profile)}
                      icon={<ListFilter className="w-3 h-3" />}
                    >
                      {t('profileMain.viewNodes', { count: profile.nodeCount })}
                    </Button>

                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => handleOpenFolder(profile)}
                        title={t('profileMain.revealFileTitle')}
                        className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                      >
                        <FolderOpen className="w-3 h-3" />
                      </button>

                      <button
                        type="button"
                        onClick={() => setEditingProfile(profile)}
                        title={t('profileMain.editProfileTitle')}
                        className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>

                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isUpdating}
                        onClick={() => handleRefresh(profile)}
                        title={t('profileMain.refreshProfileTitle')}
                        className="!text-[10px] !px-1.5 !py-0.5 h-6 gap-1 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10"
                        icon={
                          <RefreshCw
                            className={`w-3 h-3 ${
                              isUpdating ? 'animate-spin text-primary' : ''
                            }`}
                          />
                        }
                      >
                        {isUpdating
                          ? t('profileMain.updating')
                          : t('common.refresh')}
                      </Button>
                      <button
                        type="button"
                        onClick={() => setDeletingProfile(profile)}
                        title={t('profileMain.deleteProfileTitle')}
                        className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modals */}
      <AddRemoteModal
        isOpen={isRemoteModalOpen}
        onClose={() => setIsRemoteModalOpen(false)}
        onSubmit={handleAddRemote}
      />

      <AddLocalModal
        isOpen={isLocalModalOpen}
        onClose={() => setIsLocalModalOpen(false)}
        onSubmit={handleAddLocal}
      />

      <EditProfileModal
        profile={editingProfile}
        isOpen={Boolean(editingProfile)}
        onClose={() => setEditingProfile(null)}
        onSubmit={handleEditProfile}
      />

      <ProfileNodesModal
        profile={nodesModalProfile}
        isOpen={Boolean(nodesModalProfile)}
        onClose={() => setNodesModalProfile(null)}
      />

      <ResidentialProxyManager
        isOpen={isResidentialManagerOpen}
        onClose={() => setIsResidentialManagerOpen(false)}
      />

      {/* Delete Confirmation Modal */}
      {deletingProfile && (
        <Modal
          isOpen={Boolean(deletingProfile)}
          onClose={() => setDeletingProfile(null)}
          title={t('profileMain.deleteModalTitle')}
          subtitle={t('profileMain.deleteModalSubtitle')}
          icon={<Trash2 className="w-4 h-4 text-destructive" />}
          maxWidth="sm"
          footer={
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeletingProfile(null)}
              >
                {t('common.cancel')}
              </Button>
              <Button variant="danger" size="sm" onClick={handleDeleteConfirm}>
                {t('profileMain.confirmDelete')}
              </Button>
            </>
          }
        >
          <div className="p-3 rounded-lg bg-background border border-border text-xs">
            <span className="font-semibold text-foreground">
              {deletingProfile.name}
            </span>
            <div className="text-muted-foreground text-[11px] font-mono truncate mt-0.5">
              {t('profileMain.deleteNodeCount', {
                count: deletingProfile.nodeCount,
              })}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
