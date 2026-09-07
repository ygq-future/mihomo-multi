import { AlertCircle, Pencil } from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import type { ProfileItem } from '../../types'
import { Button, Input, Modal, Select } from '../common'
import { PROFILE_INTERVAL_OPTIONS } from '../../constants/profile'

interface EditProfileModalProps {
  profile: ProfileItem | null
  isOpen: boolean
  onClose: () => void
  onSubmit: (
    id: string,
    name: string,
    url: string | undefined,
    intervalMins: number,
  ) => Promise<void>
}

export const EditProfileModal: React.FC<EditProfileModalProps> = ({
  profile,
  isOpen,
  onClose,
  onSubmit,
}) => {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [intervalMins, setIntervalMins] = useState<number>(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (profile) {
      setName(profile.name)
      setUrl(profile.url || '')
      setIntervalMins(profile.autoUpdateIntervalMins)
      setError(null)
    }
  }, [profile])

  if (!profile) return null

  const isRemote = profile.type === 'remote'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('请输入订阅名称')
      return
    }
    if (
      isRemote &&
      (!url.trim() ||
        (!url.startsWith('http://') && !url.startsWith('https://')))
    ) {
      setError('请输入有效的 http:// 或 https:// 订阅链接')
      return
    }

    setLoading(true)
    setError(null)
    try {
      await onSubmit(
        profile.id,
        name.trim(),
        isRemote ? url.trim() : undefined,
        Number(intervalMins),
      )
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="编辑订阅配置"
      subtitle={profile.name}
      icon={<Pencil className="w-4 h-4" />}
      maxWidth="md"
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={loading}
          >
            取消
          </Button>
          <Button type="submit" form="edit-profile-form" loading={loading}>
            保存修改
          </Button>
        </>
      }
    >
      <form
        id="edit-profile-form"
        onSubmit={handleSubmit}
        className="p-5 space-y-4"
      >
        {error && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1">{error}</div>
          </div>
        )}

        <Input
          id="edit-profile-name"
          label="订阅名称"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：机场主力节点"
          disabled={loading}
        />

        {isRemote ? (
          <Input
            id="edit-profile-url"
            label="订阅链接 URL"
            required
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
            disabled={loading}
          />
        ) : (
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-foreground">
              本地配置文件路径
            </span>
            <div className="px-3 py-2 rounded-lg bg-background/50 border border-border text-xs font-mono text-muted-foreground truncate">
              {profile.filePath}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <label
            htmlFor="edit-profile-interval"
            className="text-xs font-medium text-foreground"
          >
            自动更新周期
          </label>
          <Select
            value={intervalMins}
            onChange={(val) => setIntervalMins(Number(val))}
            options={PROFILE_INTERVAL_OPTIONS}
            disabled={loading}
          />
        </div>
      </form>
    </Modal>
  )
}
