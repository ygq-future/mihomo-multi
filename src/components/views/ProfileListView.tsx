import {
  Check,
  Clock,
  Copy,
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
  Zap,
} from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import { useAppStore } from '../../stores/appStore'
import type { ProfileItem } from '../../types'
import { Button, Modal, toast } from '../common'
import { AddLocalModal } from '../profiles/AddLocalModal'
import { AddRemoteModal } from '../profiles/AddRemoteModal'
import { EditProfileModal } from '../profiles/EditProfileModal'
import { ProfileNodesModal } from '../profiles/ProfileNodesModal'

export const ProfileListView: React.FC = () => {
  const {
    profiles,
    fetchProfiles,
    addRemoteProfile,
    addLocalProfile,
    updateProfile,
    editProfile,
    deleteProfile,
    updatingProfileIds,
    profileLoading,
    isCheckingAutoUpdates,
    triggerAutoUpdateCheck,
    openAppDataDir,
    openFileInFolder,
  } = useAppStore()

  const [isRemoteModalOpen, setIsRemoteModalOpen] = useState(false)
  const [isLocalModalOpen, setIsLocalModalOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState<ProfileItem | null>(null)
  const [nodesModalProfile, setNodesModalProfile] =
    useState<ProfileItem | null>(null)
  const [deletingProfile, setDeletingProfile] = useState<ProfileItem | null>(
    null,
  )
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    fetchProfiles()
  }, [fetchProfiles])

  const handleAddRemote = async (
    name: string,
    url: string,
    intervalMins: number,
  ) => {
    await addRemoteProfile(name, url, intervalMins)
    toast.success(`远程订阅「${name}」已成功添加并解析`)
  }

  const handleAddLocal = async (name: string, filePath: string) => {
    await addLocalProfile(name, filePath)
    toast.success(`本地配置「${name}」已成功导入`)
  }

  const handleEditProfile = async (
    id: string,
    name: string,
    url: string | undefined,
    intervalMins: number,
  ) => {
    await editProfile(id, name, url, intervalMins)
    toast.success(`订阅「${name}」配置已成功更新`)
  }

  const handleRefresh = async (profile: ProfileItem) => {
    try {
      const updated = await updateProfile(profile.id)
      toast.success(
        `订阅「${profile.name}」已刷新，现有 ${updated.nodeCount} 个节点`,
      )
    } catch (err) {
      toast.error(
        `刷新失败：${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  const handleCheckAllUpdates = async () => {
    try {
      const results = await triggerAutoUpdateCheck()
      const updatedCount = results.filter((r) => r.success).length
      if (results.length === 0) {
        toast.info('所有远程订阅均未到达设定的自动更新周期')
      } else {
        toast.success(
          `检查完成：已更新 ${updatedCount} 个订阅，共扫描 ${results.length} 个配置`,
        )
      }
    } catch (err) {
      toast.error(
        `检查更新失败：${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  const handleCopyLink = async (profile: ProfileItem) => {
    const textToCopy = profile.url || profile.filePath
    try {
      await navigator.clipboard.writeText(textToCopy)
      setCopiedId(profile.id)
      toast.success('链接/路径已成功复制到剪贴板')
      setTimeout(
        () => setCopiedId((id) => (id === profile.id ? null : id)),
        2000,
      )
    } catch {
      toast.error('复制失败，请手动复制')
    }
  }

  const handleOpenFolder = async (profile: ProfileItem) => {
    try {
      await openFileInFolder(profile.filePath)
    } catch (err) {
      toast.error(
        `打开文件所在目录失败：${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  const handleOpenDataDirectory = async () => {
    try {
      await openAppDataDir()
    } catch (err) {
      toast.error(
        `打开数据目录失败：${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  const handleDeleteConfirm = async () => {
    if (!deletingProfile) return
    try {
      await deleteProfile(deletingProfile.id)
      toast.success(`订阅「${deletingProfile.name}」已删除`)
      setDeletingProfile(null)
    } catch (err) {
      toast.error(
        `删除失败：${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  const formatTimestamp = (timestamp: number) => {
    if (!timestamp) return '未更新'
    const date = new Date(timestamp * 1000)
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  const formatInterval = (mins: number) => {
    if (mins === 0) return '手动更新'
    if (mins >= 60) {
      const hours = Math.round(mins / 60)
      return `每 ${hours} 小时`
    }
    return `每 ${mins} 分钟`
  }

  const totalNodes = profiles.reduce((acc, p) => acc + p.nodeCount, 0)

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      {/* Action Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <div>
            已导入配置: <b className="text-foreground">{profiles.length}</b>
          </div>
          <div>•</div>
          <div>
            总解析节点: <b className="text-foreground">{totalNodes}</b>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {profiles.some((p) => p.type === 'remote') && (
            <Button
              variant="outline"
              size="sm"
              loading={isCheckingAutoUpdates}
              onClick={handleCheckAllUpdates}
              icon={<Zap className="w-3.5 h-3.5 text-amber-500" />}
            >
              检查更新
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenDataDirectory}
            icon={<FolderOpen className="w-3.5 h-3.5" />}
          >
            打开数据目录
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsLocalModalOpen(true)}
            icon={<FileCode className="w-3.5 h-3.5" />}
          >
            导入本地 YAML
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={() => setIsRemoteModalOpen(true)}
            icon={<Plus className="w-3.5 h-3.5" />}
          >
            添加远程订阅
          </Button>
        </div>
      </div>

      {/* Profile Cards Grid / List */}
      {profileLoading && profiles.length === 0 ? (
        <div className="py-24 flex flex-col items-center justify-center space-y-3 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <span className="text-xs">正在加载订阅列表...</span>
        </div>
      ) : profiles.length === 0 ? (
        /* Empty State */
        <div className="border border-dashed border-border rounded-xl p-12 flex flex-col items-center justify-center text-center space-y-4 bg-card/30">
          <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
            <Layers className="w-6 h-6" />
          </div>
          <div className="space-y-1 max-w-sm">
            <h3 className="text-sm font-semibold text-foreground">
              尚未添加任何订阅配置
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              支持标准 Clash / Mihomo 订阅 URL 以及包含 proxies
              的本地配置文件，系统将自动解析可用节点池并支持自动定时静默更新。
            </p>
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Button
              variant="primary"
              onClick={() => setIsRemoteModalOpen(true)}
              icon={<Plus className="w-3.5 h-3.5" />}
            >
              立即添加远程订阅
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {profiles.map((profile) => {
            const isUpdating = updatingProfileIds[profile.id] ?? false
            const isRemote = profile.type === 'remote'
            const isCopied = copiedId === profile.id

            return (
              <div
                key={profile.id}
                className="bg-card border border-border rounded-xl p-5 space-y-4 shadow-sm hover:border-primary/40 transition-all flex flex-col justify-between"
              >
                <div className="space-y-3">
                  {/* Top Bar: Icon + Name + Badge */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                          isRemote
                            ? 'bg-blue-500/10 text-blue-500'
                            : 'bg-amber-500/10 text-amber-500'
                        }`}
                      >
                        {isRemote ? (
                          <Globe className="w-4 h-4" />
                        ) : (
                          <FileCode className="w-4 h-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <h4
                          className="text-sm font-semibold text-foreground truncate"
                          title={profile.name}
                        >
                          {profile.name}
                        </h4>
                        <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                          {isRemote ? '远程订阅' : '本地文件'}
                        </span>
                      </div>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0 border ${
                        profile.nodeCount > 0
                          ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                          : 'bg-muted text-muted-foreground border-border'
                      }`}
                    >
                      {profile.nodeCount} 节点
                    </span>
                  </div>

                  {/* URL / Path Preview with Quick Copy */}
                  <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground font-mono bg-background/60 border border-border/60 rounded-lg px-2.5 py-1.5">
                    <span
                      className="truncate flex-1"
                      title={profile.url || profile.filePath}
                    >
                      {profile.url || profile.filePath}
                    </span>

                    <button
                      type="button"
                      onClick={() => handleCopyLink(profile)}
                      title="复制链接或文件路径"
                      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
                    >
                      {isCopied ? (
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  {/* Metadata Row */}
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
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
                <div className="pt-3 border-t border-border flex items-center justify-between gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setNodesModalProfile(profile)}
                    icon={<ListFilter className="w-3.5 h-3.5" />}
                  >
                    查看节点 ({profile.nodeCount})
                  </Button>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleOpenFolder(profile)}
                      title="在文件资源管理器中定位此配置文件"
                      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setEditingProfile(profile)}
                      title="编辑订阅配置"
                      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>

                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={isUpdating}
                      onClick={() => handleRefresh(profile)}
                      title="刷新/重新拉取订阅"
                      icon={
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${
                            isUpdating ? 'animate-spin text-primary' : ''
                          }`}
                        />
                      }
                    >
                      {isUpdating ? '更新中' : '刷新'}
                    </Button>

                    <button
                      type="button"
                      onClick={() => setDeletingProfile(profile)}
                      title="删除订阅"
                      className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

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

      {/* Delete Confirmation Modal */}
      {deletingProfile && (
        <Modal
          isOpen={Boolean(deletingProfile)}
          onClose={() => setDeletingProfile(null)}
          title="确认删除订阅配置？"
          subtitle="此操作将永久移除该订阅及其所有关联节点缓存"
          icon={<Trash2 className="w-4 h-4 text-destructive" />}
          maxWidth="sm"
        >
          <div className="p-5 space-y-4">
            <div className="p-3 rounded-lg bg-background border border-border text-xs">
              <span className="font-semibold text-foreground">
                {deletingProfile.name}
              </span>
              <div className="text-muted-foreground text-[11px] font-mono truncate mt-0.5">
                包含 {deletingProfile.nodeCount} 个节点
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-border">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeletingProfile(null)}
              >
                取消
              </Button>
              <Button variant="danger" size="sm" onClick={handleDeleteConfirm}>
                确认删除
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
