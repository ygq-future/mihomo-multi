import { AlertCircle, FileCode, Loader2, X } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'

interface AddLocalModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (name: string, filePath: string) => Promise<void>
}

export const AddLocalModal: React.FC<AddLocalModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
}) => {
  const [name, setName] = useState('')
  const [filePath, setFilePath] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('请输入配置名称')
      return
    }
    if (!filePath.trim()) {
      setError('请输入本地 YAML 文件绝对路径')
      return
    }

    setLoading(true)
    setError(null)
    try {
      await onSubmit(name.trim(), filePath.trim())
      setName('')
      setFilePath('')
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
            <div className="w-7 h-7 rounded-md bg-secondary text-secondary-foreground flex items-center justify-center">
              <FileCode className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">
              导入本地 YAML 订阅
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
              htmlFor="local-name"
              className="text-xs font-medium text-foreground"
            >
              配置名称 <span className="text-destructive">*</span>
            </label>
            <input
              id="local-name"
              type="text"
              placeholder="例如：本地备份节点"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-background border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              disabled={loading}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="local-path"
              className="text-xs font-medium text-foreground"
            >
              文件绝对路径 <span className="text-destructive">*</span>
            </label>
            <input
              id="local-path"
              type="text"
              placeholder="例如：C:\Users\Desktop\clash_config.yaml"
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-background border border-border text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              disabled={loading}
            />
            <p className="text-[11px] text-muted-foreground">
              系统将复制该文件并提取其中 proxies 节点池
            </p>
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
              <span>{loading ? '正在解析导入...' : '确认导入'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
