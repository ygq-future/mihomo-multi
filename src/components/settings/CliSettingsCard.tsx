import { FolderOpen, Terminal } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '../../i18n'
import * as api from '../../services/tauri'
import type { CliStatus } from '../../types'
import { Badge, Button, Input, toast } from '../common'

interface CliSettingsCardProps {
  appDataDir: string
  onOpenAppDataDir: () => void
}

export function CliSettingsCard({
  appDataDir,
  onOpenAppDataDir,
}: CliSettingsCardProps) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<CliStatus | null>(null)
  const [aliasInput, setAliasInput] = useState('mm')
  const [busy, setBusy] = useState<'alias' | 'path' | 'shell' | null>(null)

  const loadStatus = useCallback(async () => {
    try {
      const next = await api.getCliStatus()
      setStatus(next)
      setAliasInput(next.alias)
    } catch {
      // Ignore in non-Tauri preview
    }
  }, [])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  const handleSaveAlias = async () => {
    const trimmed = aliasInput.trim()
    if (!trimmed) return
    setBusy('alias')
    try {
      const next = await api.setCliAlias(trimmed)
      setStatus(next)
      setAliasInput(next.alias)
      toast.success(t('settingsPage.cli.aliasSaved', { alias: next.alias }))
    } catch (err) {
      toast.error(String(err))
    } finally {
      setBusy(null)
    }
  }

  const handleTogglePath = async () => {
    if (!status) return
    setBusy('path')
    try {
      const next =
        status.installed && status.inPath
          ? await api.uninstallCli()
          : await api.installCli()
      setStatus(next)
      toast.success(
        next.installed && next.inPath
          ? t('settingsPage.cli.registered', { alias: next.alias })
          : t('settingsPage.cli.unregistered'),
      )
    } catch (err) {
      toast.error(String(err))
    } finally {
      setBusy(null)
    }
  }

  const handleInstallShell = async () => {
    setBusy('shell')
    try {
      const next = await api.installCliShellIntegration()
      setStatus(next)
      toast.success(t('settingsPage.cli.shellDone', { alias: next.alias }))
    } catch (err) {
      toast.error(String(err))
    } finally {
      setBusy(null)
    }
  }

  const isReady = Boolean(status?.installed && status?.inPath)
  const aliasChanged =
    aliasInput.trim().length > 0 &&
    aliasInput.trim() !== (status?.alias ?? 'mm')

  return (
    <div
      id="setting-section-cli"
      className="scroll-mt-6 bg-card border border-border rounded-xl p-5 space-y-4 shadow-sm"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-border gap-3">
        <div className="flex items-center gap-2.5">
          <Terminal className="w-5 h-5 text-primary" />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                {t('settingsPage.cli.title')}
              </h3>
              <Badge variant={isReady ? 'success' : 'secondary'} size="sm">
                {isReady
                  ? t('settingsPage.cli.statusReady')
                  : t('settingsPage.cli.statusNotInstalled')}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('settingsPage.cli.desc')}
            </p>
          </div>
        </div>
        <Button
          variant={isReady ? 'outline' : 'primary'}
          size="sm"
          loading={busy === 'path'}
          disabled={!status || (!isReady && !status.sourceExists)}
          onClick={() => void handleTogglePath()}
        >
          {isReady
            ? t('settingsPage.cli.unregisterPath')
            : t('settingsPage.cli.registerPath')}
        </Button>
      </div>

      {status && !status.sourceExists && (
        <div className="text-xs text-amber-600 dark:text-amber-400">
          {t('settingsPage.cli.missingBinary')}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-background/60 border border-border">
          <span className="text-xs font-medium text-foreground shrink-0">
            {t('settingsPage.cli.aliasLabel')}
          </span>
          <div className="flex items-center gap-2 min-w-0">
            <Input
              value={aliasInput}
              onChange={(e) => setAliasInput(e.target.value)}
              placeholder={t('settingsPage.cli.aliasPlaceholder')}
              className="h-8 w-28 font-mono text-xs bg-background/80 border-border text-foreground"
            />
            <Button
              variant="outline"
              size="sm"
              loading={busy === 'alias'}
              disabled={!aliasChanged}
              onClick={() => void handleSaveAlias()}
            >
              {t('settingsPage.cli.saveAlias')}
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-background/60 border border-border">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-medium text-foreground truncate">
              {t('settingsPage.cli.shellIntegration')}
            </span>
            {status?.shellProfileInstalled && (
              <Badge variant="success" size="sm">
                {t('settingsPage.cli.shellInstalled')}
              </Badge>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            loading={busy === 'shell'}
            disabled={!status}
            onClick={() => void handleInstallShell()}
          >
            {status?.shellProfileInstalled
              ? t('settingsPage.cli.reinstallShell')
              : t('settingsPage.cli.installShell')}
          </Button>
        </div>
      </div>

      {/* Merged storage & CLI directory cell */}
      <div className="p-3 rounded-lg bg-background/60 border border-border space-y-2.5 text-xs">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <span className="text-muted-foreground">
              {t('settingsPage.storage.currentDir')}
            </span>
            <div className="font-mono text-foreground break-all select-all">
              {appDataDir || t('settingsPage.storage.reading')}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 px-2"
            title={t('settingsPage.storage.openFolder')}
            aria-label={t('settingsPage.storage.openFolder')}
            onClick={onOpenAppDataDir}
            icon={<FolderOpen className="w-3.5 h-3.5" />}
          />
        </div>
        {status?.cliDir && (
          <div className="pt-2 border-t border-border/70 flex items-center justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <span className="text-muted-foreground">
                {t('settingsPage.cli.cliDirLabel')}
              </span>
              <div className="font-mono text-foreground/90 break-all select-all">
                {status.cliDir}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 px-2"
              title={t('settingsPage.storage.openFolder')}
              aria-label={t('settingsPage.storage.openFolder')}
              onClick={() =>
                void api.openCliDir().catch((err) => toast.error(String(err)))
              }
              icon={<FolderOpen className="w-3.5 h-3.5" />}
            />
          </div>
        )}
      </div>
    </div>
  )
}
