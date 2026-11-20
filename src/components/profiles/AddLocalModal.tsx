import { AlertCircle, FileCode, FolderOpen } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { useTranslation } from '../../i18n'
import { openConfigFilePicker } from '../../services/tauri'
import { Button, Input, Modal } from '../common'
interface AddLocalModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (name: string, filePath: string) => Promise<void>
}
function extractProfileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const filename = normalized.split('/').pop() || ''
  return filename.replace(/\.(ya?ml)$/i, '')
}

export const AddLocalModal: React.FC<AddLocalModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
}) => {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [filePath, setFilePath] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const handleBrowseFile = async () => {
    try {
      const selected = await openConfigFilePicker()
      if (!selected) return
      setFilePath(selected)
      setError(null)
      if (!name.trim()) {
        const suggestedName = extractProfileName(selected)
        if (suggestedName) {
          setName(suggestedName)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError(t('profileMain.errConfigNameRequired'))
      return
    }
    if (!filePath.trim()) {
      setError(t('profileMain.errLocalPathRequired'))
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
      title={t('profileMain.addLocalTitle')}
      subtitle={t('profileMain.addLocalSubtitle')}
      icon={<FileCode className="w-4 h-4" />}
      maxWidth="md"
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={loading}
          >
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="add-local-form" loading={loading}>
            {loading
              ? t('profileMain.importing')
              : t('profileMain.confirmImport')}
          </Button>
        </>
      }
    >
      <form id="add-local-form" onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1">{error}</div>
          </div>
        )}

        <Input
          id="local-name"
          label={t('profileMain.configNameLabel')}
          required
          placeholder={t('profileMain.configNamePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={loading}
          autoFocus
        />

        <div className="space-y-1.5 w-full">
          <label
            htmlFor="local-path"
            className="text-xs font-medium text-foreground flex items-center gap-1"
          >
            <span>{t('profileMain.filePathLabel')}</span>
            <span className="text-destructive">*</span>
          </label>
          <div className="flex gap-2 items-center">
            <div className="flex-1">
              <Input
                id="local-path"
                required
                placeholder={t('profileMain.filePathPlaceholder')}
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                disabled={loading}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={handleBrowseFile}
              disabled={loading}
              icon={<FolderOpen className="w-3.5 h-3.5" />}
            >
              {t('profileMain.browse')}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t('profileMain.filePathHint')}
          </p>
        </div>
      </form>
    </Modal>
  )
}
