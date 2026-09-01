import { AlertCircle, FileCode } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { Button, Input, Modal } from '../common'

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
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="导入本地 YAML 订阅"
      subtitle="复制本地 Clash 格式配置文件并解析节点"
      icon={<FileCode className="w-4 h-4" />}
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        {error && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1">{error}</div>
          </div>
        )}

        <Input
          id="local-name"
          label="配置名称"
          required
          placeholder="例如：本地备份节点"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={loading}
          autoFocus
        />

        <Input
          id="local-path"
          label="文件绝对路径"
          required
          placeholder="例如：C:\Users\Desktop\clash_config.yaml"
          value={filePath}
          onChange={(e) => setFilePath(e.target.value)}
          disabled={loading}
          helperText="系统将复制该文件并提取其中 proxies 节点池"
        />

        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={loading}
          >
            取消
          </Button>
          <Button type="submit" loading={loading}>
            {loading ? '正在解析导入...' : '确认导入'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
