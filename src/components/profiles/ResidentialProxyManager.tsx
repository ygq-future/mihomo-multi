import {
  AlertCircle,
  Building2,
  Cable,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Server,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from '../../i18n'
import { isDesktopEnvironment } from '../../services/tauri'
import { useAppStore } from '../../stores/appStore'
import type { ResidentialProxy, ResidentialProxyProtocol } from '../../types'
import { Badge, Button, Input, Modal, Segmented, toast } from '../common'
import { ResidentialProxyTestPanel } from './ResidentialProxyTestPanel'

export interface ResidentialProxyManagerProps {
  isOpen: boolean
  onClose: () => void
}

interface ResidentialProxyFormState {
  name: string
  protocol: ResidentialProxyProtocol
  server: string
  port: string
  username: string
  password: string
}

const EMPTY_FORM: ResidentialProxyFormState = {
  name: '',
  protocol: 'http',
  server: '',
  port: '',
  username: '',
  password: '',
}

function newProxyId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID()
  }
  return `residential-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export const ResidentialProxyManager: React.FC<
  ResidentialProxyManagerProps
> = ({ isOpen, onClose }) => {
  const { t, locale } = useTranslation()
  const portSeparator = locale === 'zh-CN' ? '、' : ', '
  const {
    config,
    portMappings,
    fetchConfig,
    saveResidentialProxy,
    deleteResidentialProxy,
  } = useAppStore()

  const [view, setView] = useState<'list' | 'editor'>('list')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ResidentialProxyFormState>(EMPTY_FORM)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  )
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [testingProxyId, setTestingProxyId] = useState<string | null>(null)
  const configRequestedRef = useRef(false)

  const proxies = config?.residentialProxies ?? []
  const isDesktop = isDesktopEnvironment()

  const usageByProxyId = useMemo(() => {
    const usage: Record<string, number[]> = {}
    for (const mapping of portMappings) {
      const proxyId = mapping.residentialProxyId
      if (!proxyId) continue
      if (!usage[proxyId]) usage[proxyId] = []
      usage[proxyId].push(mapping.port)
    }
    return usage
  }, [portMappings])

  useEffect(() => {
    if (!isOpen) {
      configRequestedRef.current = false
      setTestingProxyId(null)
      return
    }
    setView('list')
    setEditingId(null)
    setForm(EMPTY_FORM)
    setError(null)
    setShowPassword(false)
    setConfirmingDeleteId(null)
    setTestingProxyId(null)
    setLoadError(null)
  }, [isOpen])

  const loadConfig = useCallback(async () => {
    if (configRequestedRef.current) return
    configRequestedRef.current = true
    setLoadingConfig(true)
    setLoadError(null)
    try {
      await fetchConfig()
      const state = useAppStore.getState()
      if (!state.config) {
        throw new Error(
          state.error || t('residentialI18n.common.loadConfigFailed'),
        )
      }
    } catch (err) {
      configRequestedRef.current = false
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingConfig(false)
    }
  }, [fetchConfig, t])

  useEffect(() => {
    if (!isOpen || config) return
    void loadConfig()
  }, [isOpen, config, loadConfig])

  const startCreate = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setShowPassword(false)
    setError(null)
    setTestingProxyId(null)
    setView('editor')
  }

  const startEdit = (proxy: ResidentialProxy) => {
    setEditingId(proxy.id)
    setTestingProxyId(null)
    setForm({
      name: proxy.name,
      protocol: proxy.protocol,
      server: proxy.server,
      port: String(proxy.port),
      username: proxy.username,
      password: proxy.password,
    })
    setShowPassword(false)
    setError(null)
    setView('editor')
  }

  const backToList = () => {
    setView('list')
    setEditingId(null)
    setError(null)
  }

  const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)

    const name = form.name.trim()
    const server = form.server.trim()
    const username = form.username.trim()
    const portText = form.port.trim()
    const port = /^\d+$/.test(portText)
      ? Number.parseInt(portText, 10)
      : Number.NaN

    if (!name) {
      setError(t('residentialI18n.manager.nameRequired'))
      return
    }
    if (!server) {
      setError(t('residentialI18n.manager.serverRequired'))
      return
    }
    if (/[\s/]/.test(server) || server.includes('://')) {
      setError(t('residentialI18n.manager.serverInvalid'))
      return
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError(t('residentialI18n.manager.portInvalid'))
      return
    }
    const hasUsername = username.length > 0
    const hasPassword = form.password.length > 0
    if (hasUsername !== hasPassword) {
      setError(t('residentialI18n.manager.credentialsPair'))
      return
    }

    setSaving(true)
    try {
      await saveResidentialProxy({
        id: editingId ?? newProxyId(),
        name,
        protocol: form.protocol,
        server,
        port,
        username,
        password: form.password,
      })
      toast.success(
        editingId
          ? t('residentialI18n.manager.updatedToast', { name })
          : t('residentialI18n.manager.createdToast', { name }),
      )
      setView('list')
      setEditingId(null)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (proxy: ResidentialProxy) => {
    setDeletingId(proxy.id)
    setError(null)
    try {
      await deleteResidentialProxy(proxy.id)
      toast.success(
        t('residentialI18n.manager.deletedToast', { name: proxy.name }),
      )
      setConfirmingDeleteId(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      toast.error(t('residentialI18n.manager.deleteFailed', { err: message }))
    } finally {
      setDeletingId(null)
    }
  }

  const footer =
    view === 'editor' ? (
      <>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={backToList}
          disabled={saving}
        >
          {t('residentialI18n.manager.backToList')}
        </Button>
        <Button
          type="submit"
          form="residential-proxy-form"
          variant="primary"
          size="sm"
          loading={saving}
          disabled={saving || !isDesktop}
        >
          {editingId
            ? t('residentialI18n.manager.saveChanges')
            : t('residentialI18n.manager.addExit')}
        </Button>
      </>
    ) : (
      <>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onClose}
          disabled={deletingId !== null}
        >
          {t('residentialI18n.common.close')}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={startCreate}
          disabled={!isDesktop || !config}
          icon={<Plus className="w-3.5 h-3.5" />}
        >
          {t('residentialI18n.manager.addExit')}
        </Button>
      </>
    )

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        view === 'editor'
          ? t('residentialI18n.manager.titleEditor')
          : t('residentialI18n.manager.titleList')
      }
      subtitle={
        view === 'editor'
          ? t('residentialI18n.manager.subtitleEditor')
          : t('residentialI18n.manager.subtitleList', {
              count: proxies.length,
            })
      }
      icon={<Building2 className="w-4 h-4 text-primary" />}
      maxWidth="xl"
      footer={footer}
    >
      {!isDesktop && (
        <div className="mb-3 p-3 text-xs bg-amber-500/10 border border-amber-500/25 text-amber-600 dark:text-amber-400 rounded-lg flex items-start gap-2 leading-relaxed">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{t('residentialI18n.manager.desktopOnlyNotice')}</span>
        </div>
      )}
      {loadError && (
        <div className="mb-3 p-3 text-xs bg-destructive/10 border border-destructive/20 text-destructive rounded-lg flex items-center justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{loadError}</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={loadingConfig}
            disabled={loadingConfig}
            onClick={() => void loadConfig()}
          >
            {t('residentialI18n.common.retry')}
          </Button>
        </div>
      )}
      {view === 'editor' ? (
        <form
          id="residential-proxy-form"
          aria-label={t('residentialI18n.manager.titleEditor')}
          onSubmit={handleSubmit}
          className="space-y-4"
        >
          {error && (
            <div className="p-3 text-xs bg-destructive/10 border border-destructive/20 text-destructive rounded-lg flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}

          <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
            <ShieldCheck className="w-4 h-4 shrink-0 text-amber-500" />
            <span>
              {t('residentialI18n.manager.chainNotePrefix')}
              <b className="text-foreground">
                {t('residentialI18n.manager.chainNoteStrong')}
              </b>
              {t('residentialI18n.manager.chainNoteSuffix')}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              id="residential-name"
              label={t('residentialI18n.manager.nameLabel')}
              required
              value={form.name}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, name: e.target.value }))
              }
              placeholder={t('residentialI18n.manager.namePlaceholder')}
              prefixIcon={<Building2 className="w-3.5 h-3.5" />}
            />

            <div>
              <span className="block text-xs font-medium text-foreground mb-1.5">
                {t('residentialI18n.manager.protocolLabel')}{' '}
                <span className="text-destructive">*</span>
              </span>
              <Segmented<ResidentialProxyProtocol>
                value={form.protocol}
                onChange={(protocol) =>
                  setForm((prev) => ({ ...prev, protocol }))
                }
                options={[
                  { value: 'http', label: 'HTTP' },
                  { value: 'socks5', label: 'SOCKS5' },
                ]}
                className="w-full [&>button]:flex-1"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Input
                id="residential-server"
                label={t('residentialI18n.manager.serverLabel')}
                required
                value={form.server}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, server: e.target.value }))
                }
                placeholder={t('residentialI18n.manager.serverPlaceholder')}
                prefixIcon={<Server className="w-3.5 h-3.5" />}
              />
            </div>
            <Input
              id="residential-port"
              label={t('residentialI18n.manager.portLabel')}
              required
              integerOnly
              inputMode="numeric"
              value={form.port}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, port: e.target.value }))
              }
              placeholder="8000"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              id="residential-username"
              label={t('residentialI18n.manager.usernameLabel')}
              autoComplete="off"
              value={form.username}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, username: e.target.value }))
              }
              placeholder={t('residentialI18n.manager.usernamePlaceholder')}
              prefixIcon={<UserRound className="w-3.5 h-3.5" />}
            />

            <div>
              <label
                htmlFor="residential-password"
                className="block text-xs font-medium text-foreground mb-1.5"
              >
                {t('residentialI18n.manager.passwordLabel')}
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id="residential-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      password: e.target.value,
                    }))
                  }
                  placeholder={t('residentialI18n.manager.passwordPlaceholder')}
                  prefixIcon={<KeyRound className="w-3.5 h-3.5" />}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="px-2"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={
                    showPassword
                      ? t('residentialI18n.manager.hidePassword')
                      : t('residentialI18n.manager.showPassword')
                  }
                  title={
                    showPassword
                      ? t('residentialI18n.manager.hidePassword')
                      : t('residentialI18n.manager.showPassword')
                  }
                  icon={
                    showPassword ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )
                  }
                />
              </div>
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground leading-relaxed flex items-center gap-1.5">
            <Lock className="w-3 h-3" />
            {t('residentialI18n.manager.credentialsHint')}
          </p>
        </form>
      ) : (
        <div className="space-y-3">
          {error && (
            <div className="p-3 text-xs bg-destructive/10 border border-destructive/20 text-destructive rounded-lg flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}

          {loadingConfig && proxies.length === 0 ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="w-7 h-7 animate-spin text-primary" />
              <span className="text-xs">
                {t('residentialI18n.manager.loadingConfig')}
              </span>
            </div>
          ) : proxies.length === 0 ? (
            <div className="border border-dashed border-border rounded-xl p-10 flex flex-col items-center justify-center text-center space-y-3 bg-card/30">
              <div className="w-11 h-11 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <Building2 className="w-5 h-5" />
              </div>
              <div className="space-y-1 max-w-sm">
                <h3 className="text-sm font-semibold text-foreground">
                  {t('residentialI18n.manager.emptyTitle')}
                </h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t('residentialI18n.manager.emptyDesc')}
                </p>
              </div>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={startCreate}
                disabled={!isDesktop || !config}
                icon={<Plus className="w-3.5 h-3.5" />}
              >
                {t('residentialI18n.manager.addFirst')}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {proxies.map((proxy) => {
                const usedPorts = usageByProxyId[proxy.id] ?? []
                const isReferenced = usedPorts.length > 0
                const isConfirming = confirmingDeleteId === proxy.id
                const isTestingOpen = testingProxyId === proxy.id
                return (
                  <div
                    key={proxy.id}
                    className={`rounded-lg border bg-card transition-colors ${
                      isTestingOpen
                        ? 'border-primary/40'
                        : 'border-border hover:border-primary/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 p-3">
                      <div className="flex items-start gap-2.5 min-w-0 flex-1">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                          <Building2 className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className="text-xs font-semibold text-foreground truncate"
                              title={proxy.name}
                            >
                              {proxy.name}
                            </span>
                            <Badge
                              variant="outline"
                              size="sm"
                              className="uppercase font-mono shrink-0"
                            >
                              {proxy.protocol}
                            </Badge>
                            {isReferenced ? (
                              <Badge
                                variant="primary"
                                size="sm"
                                className="shrink-0"
                                title={t(
                                  'residentialI18n.manager.usedByPortsTitle',
                                  { ports: usedPorts.join(portSeparator) },
                                )}
                              >
                                {t('residentialI18n.manager.portsInUse', {
                                  count: usedPorts.length,
                                })}
                              </Badge>
                            ) : (
                              <Badge
                                variant="secondary"
                                size="sm"
                                className="shrink-0"
                              >
                                {t('residentialI18n.manager.unused')}
                              </Badge>
                            )}
                          </div>
                          <div
                            className="text-[11px] font-mono text-muted-foreground truncate"
                            title={`${proxy.server}:${proxy.port}`}
                          >
                            {proxy.server}:{proxy.port}
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground min-w-0">
                            {proxy.username || proxy.password ? (
                              <>
                                <UserRound className="w-3 h-3 shrink-0" />
                                <span
                                  className="truncate"
                                  title={proxy.username}
                                >
                                  {proxy.username ||
                                    t(
                                      'residentialI18n.manager.credentialConfigured',
                                    )}
                                </span>
                                <Lock className="w-3 h-3 shrink-0 ml-0.5" />
                                <span className="shrink-0">
                                  {t('residentialI18n.manager.authConfigured')}
                                </span>
                              </>
                            ) : (
                              <>
                                <KeyRound className="w-3 h-3 shrink-0" />
                                <span className="shrink-0">
                                  {t('residentialI18n.manager.noAuth')}
                                </span>
                              </>
                            )}
                            {isReferenced && (
                              <span
                                className="truncate ml-1"
                                title={t('residentialI18n.manager.portsList', {
                                  ports: usedPorts.join(portSeparator),
                                })}
                              >
                                ·{' '}
                                {t('residentialI18n.manager.portsList', {
                                  ports: usedPorts.join(portSeparator),
                                })}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {isConfirming ? (
                          <>
                            <Button
                              type="button"
                              variant="danger"
                              size="sm"
                              loading={deletingId === proxy.id}
                              onClick={() => void handleDelete(proxy)}
                            >
                              {t('residentialI18n.manager.confirmDelete')}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={deletingId === proxy.id}
                              onClick={() => setConfirmingDeleteId(null)}
                            >
                              {t('residentialI18n.common.cancel')}
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              type="button"
                              variant={isTestingOpen ? 'secondary' : 'outline'}
                              size="sm"
                              onClick={() => {
                                setConfirmingDeleteId(null)
                                setTestingProxyId((current) =>
                                  current === proxy.id ? null : proxy.id,
                                )
                              }}
                              aria-expanded={isTestingOpen}
                              title={t(
                                'residentialI18n.manager.testChainTitle',
                              )}
                              icon={<Cable className="w-3.5 h-3.5" />}
                            >
                              {isTestingOpen
                                ? t('residentialI18n.manager.collapseTest')
                                : t('residentialI18n.manager.testConnection')}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              disabled={!isDesktop}
                              onClick={() => startEdit(proxy)}
                              aria-label={t(
                                'residentialI18n.manager.editAria',
                                { name: proxy.name },
                              )}
                              title={
                                isDesktop
                                  ? t('residentialI18n.manager.editTitle')
                                  : t('residentialI18n.manager.desktopOnly')
                              }
                              icon={<Pencil className="w-3.5 h-3.5" />}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              disabled={isReferenced || !isDesktop}
                              onClick={() => {
                                setTestingProxyId(null)
                                setConfirmingDeleteId(proxy.id)
                              }}
                              aria-label={t(
                                'residentialI18n.manager.deleteAria',
                                { name: proxy.name },
                              )}
                              title={
                                isReferenced
                                  ? t(
                                      'residentialI18n.manager.deleteBlockedTitle',
                                      {
                                        ports: usedPorts.join(portSeparator),
                                      },
                                    )
                                  : isDesktop
                                    ? t('residentialI18n.manager.deleteTitle')
                                    : t('residentialI18n.manager.desktopOnly')
                              }
                              className={
                                isReferenced
                                  ? undefined
                                  : 'text-muted-foreground hover:text-destructive hover:border-destructive/40'
                              }
                              icon={<Trash2 className="w-3.5 h-3.5" />}
                            />
                          </>
                        )}
                      </div>
                    </div>
                    {isTestingOpen && (
                      <ResidentialProxyTestPanel
                        proxy={proxy}
                        isDesktop={isDesktop}
                      />
                    )}
                  </div>
                )
              })}
              {proxies.some(
                (proxy) => (usageByProxyId[proxy.id] ?? []).length > 0,
              ) && (
                <p className="text-[10px] text-muted-foreground leading-relaxed pt-1">
                  {t('residentialI18n.manager.referencedNote')}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
