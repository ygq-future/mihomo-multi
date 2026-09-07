import { AlertCircle, Globe } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { Button, Input, Modal, Select } from '../common'

interface AddRemoteModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (name: string, url: string, intervalMins: number) => Promise<void>
}

const intervalOptions = [
  { value: 0, label: '不自动更新（仅手动刷新）' },
  { value: 360, label: '每 6 小时自动更新' },
  { value: 720, label: '每 12 小时自动更新' },
  { value: 1440, label: '每 24 小时 (1天) 自动更新' },
]

export const AddRemoteModal: React.FC<AddRemoteModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
}) => {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [intervalMins, setIntervalMins] = useState<number>(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('请输入订阅名称')
      return
    }
    if (
      !url.trim() ||
      (!url.startsWith('http://') && !url.startsWith('https://'))
    ) {
      setError('请输入有效的 http:// 或 https:// 订阅链接')
      return
    }

    setLoading(true)
    setError(null)
    try {
      await onSubmit(name.trim(), url.trim(), Number(intervalMins))
      setName('')
      setUrl('')
      setIntervalMins(0)
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
      title="添加远程订阅"
      subtitle="导入标准 Clash / Mihomo 远程订阅链接"
      icon={<Globe className="w-4 h-4" />}
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
          <Button type="submit" form="add-remote-form" loading={loading}>
            {loading ? '正在拉取解析...' : '确认添加'}
          </Button>
        </>
      }
    >
      <form
        id="add-remote-form"
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
          id="remote-name"
          label="订阅名称"
          required
          placeholder="例如：机场主力节点"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={loading}
          autoFocus
        />

        <Input
          id="remote-url"
          label="订阅链接 URL"
          required
          type="url"
          placeholder="https://subscribe.example.com/api/v1/client/subscribe?token=..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={loading}
          helperText="请求将自动携带标准 Clash User-Agent 进行兼容拉取"
        />

        <div className="space-y-1.5">
          <label
            htmlFor="remote-interval"
            className="text-xs font-medium text-foreground"
          >
            自动更新周期
          </label>
          <Select
            value={intervalMins}
            onChange={(val) => setIntervalMins(Number(val))}
            options={intervalOptions}
            disabled={loading}
          />
        </div>
      </form>
    </Modal>
  )
}
