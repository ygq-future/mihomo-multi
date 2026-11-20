import { AlertCircle, Globe } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { useTranslation } from '../../i18n'
import { Button, Input, Modal, Select } from '../common'
import { PROFILE_INTERVAL_OPTIONS } from '../../constants/profile'

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
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [intervalMins, setIntervalMins] = useState<number>(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const intervalOptions = PROFILE_INTERVAL_OPTIONS.map(({ value }) => {
    let label: string
    if (value === 0) {
      label = t('profileMain.intervalOptionManualOnly')
    } else if (value % 1440 === 0) {
      label = t('profileMain.intervalOptionDays', { count: value / 1440 })
    } else if (value % 60 === 0) {
      label = t('profileMain.intervalOptionHours', { count: value / 60 })
    } else {
      label = t('profileMain.intervalOptionMinutes', { count: value })
    }
    return { value, label }
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError(t('profileMain.errProfileNameRequired'))
      return
    }
    if (
      !url.trim() ||
      (!url.startsWith('http://') && !url.startsWith('https://'))
    ) {
      setError(t('profileMain.errUrlInvalid'))
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
      title={t('profileMain.addRemoteTitle')}
      subtitle={t('profileMain.addRemoteSubtitle')}
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
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="add-remote-form" loading={loading}>
            {loading ? t('profileMain.fetching') : t('profileMain.confirmAdd')}
          </Button>
        </>
      }
    >
      <form id="add-remote-form" onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1">{error}</div>
          </div>
        )}

        <Input
          id="remote-name"
          label={t('profileMain.profileNameLabel')}
          required
          placeholder={t('profileMain.profileNamePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={loading}
          autoFocus
        />

        <Input
          id="remote-url"
          label={t('profileMain.urlLabel')}
          required
          type="url"
          placeholder="https://subscribe.example.com/api/v1/client/subscribe?token=..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={loading}
          helperText={t('profileMain.urlHelper')}
        />

        <div className="space-y-1.5">
          <label
            htmlFor="remote-interval"
            className="text-xs font-medium text-foreground"
          >
            {t('profileMain.autoUpdateInterval')}
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
