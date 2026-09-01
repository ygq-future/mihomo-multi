import { AlertCircle, Globe, Loader2, X } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'

interface AddRemoteModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (name: string, url: string, intervalMins: number) => Promise<void>
}

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

  if (!isOpen) return null

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-150">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-primary/10 text-primary flex items-center justify-center">
              <Globe className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">
              添加远程订阅
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1">{error}</div>
            </div>
          )}

          <div className="space-y-1.5">
            <label
              htmlFor="remote-name"
              className="text-xs font-medium text-foreground"
            >
              订阅名称 <span className="text-destructive">*</span>
            </label>
            <input
              id="remote-name"
              type="text"
              placeholder="例如：机场主力节点"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-background border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              disabled={loading}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="remote-url"
              className="text-xs font-medium text-foreground"
            >
              订阅链接 URL <span className="text-destructive">*</span>
            </label>
            <input
              id="remote-url"
              type="url"
              placeholder="https://subscribe.example.com/api/v1/client/subscribe?token=..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-background border border-border text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              disabled={loading}
            />
            <p className="text-[11px] text-muted-foreground">
              请求将自动携带标准 Clash User-Agent 进行兼容拉取
            </p>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="remote-interval"
              className="text-xs font-medium text-foreground"
            >
              自动更新周期
            </label>
            <select
              id="remote-interval"
              value={intervalMins}
              onChange={(e) => setIntervalMins(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-md bg-background border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              disabled={loading}
            >
              <option value={0}>不自动更新（仅手动刷新）</option>
              <option value={360}>每 6 小时自动更新</option>
              <option value={720}>每 12 小时自动更新</option>
              <option value={1440}>每 24 小时 (1天) 自动更新</option>
            </select>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-3.5 py-2 rounded-md border border-border bg-background text-foreground text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-50"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{loading ? '正在拉取解析...' : '确认添加'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
