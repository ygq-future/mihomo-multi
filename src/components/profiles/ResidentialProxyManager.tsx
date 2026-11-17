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
        throw new Error(state.error || '配置加载失败，请重试')
      }
    } catch (err) {
      configRequestedRef.current = false
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingConfig(false)
    }
  }, [fetchConfig])

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
      setError('请填写住宅出口名称')
      return
    }
    if (!server) {
      setError('请填写住宅代理服务器地址')
      return
    }
    if (/[\s/]/.test(server) || server.includes('://')) {
      setError('服务器地址只填主机名或 IP，不要包含协议前缀、路径或空格')
      return
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError('住宅代理端口必须为 1 ~ 65535 之间的整数')
      return
    }
    const hasUsername = username.length > 0
    const hasPassword = form.password.length > 0
    if (hasUsername !== hasPassword) {
      setError('住宅代理用户名与密码必须同时填写，或同时留空')
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
        editingId ? `住宅出口「${name}」已更新` : `住宅出口「${name}」已添加`,
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
      toast.success(`住宅出口「${proxy.name}」已删除`)
      setConfirmingDeleteId(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      toast.error(`删除失败: ${message}`)
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
          返回列表
        </Button>
        <Button
          type="submit"
          form="residential-proxy-form"
          variant="primary"
          size="sm"
          loading={saving}
          disabled={saving || !isDesktop}
        >
          {editingId ? '保存修改' : '添加住宅出口'}
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
          关闭
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={startCreate}
          disabled={!isDesktop || !config}
          icon={<Plus className="w-3.5 h-3.5" />}
        >
          添加住宅出口
        </Button>
      </>
    )

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={view === 'editor' ? '住宅出口配置' : '住宅出口管理'}
      subtitle={
        view === 'editor'
          ? '认证型 HTTP / SOCKS5 住宅代理，仅保存在本机配置'
          : `供端口链路使用的住宅代理出口 · 已配置 ${proxies.length} 个`
      }
      icon={<Building2 className="w-4 h-4 text-primary" />}
      maxWidth="xl"
      footer={footer}
    >
      {!isDesktop && (
        <div className="mb-3 p-3 text-xs bg-amber-500/10 border border-amber-500/25 text-amber-600 dark:text-amber-400 rounded-lg flex items-start gap-2 leading-relaxed">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            当前为浏览器预览环境，住宅出口配置无法保存到桌面后端。请在桌面应用中使用该功能。
          </span>
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
            重试
          </Button>
        </div>
      )}
      {view === 'editor' ? (
        <form
          id="residential-proxy-form"
          aria-label="住宅出口配置"
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
              绑定该出口的端口将强制走
              <b className="text-foreground"> 上游节点 → 住宅出口 → 目标</b>
              ，绕过大陆、备用节点与网站分流规则均不生效；上游节点不可用时端口直接拒绝连接，不会回退直连。
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              id="residential-name"
              label="名称"
              required
              value={form.name}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, name: e.target.value }))
              }
              placeholder="例如：美国静态住宅 01"
              prefixIcon={<Building2 className="w-3.5 h-3.5" />}
            />

            <div>
              <span className="block text-xs font-medium text-foreground mb-1.5">
                代理协议 <span className="text-destructive">*</span>
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
                label="服务器地址"
                required
                value={form.server}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, server: e.target.value }))
                }
                placeholder="gate.example.com 或 203.0.113.10"
                prefixIcon={<Server className="w-3.5 h-3.5" />}
              />
            </div>
            <Input
              id="residential-port"
              label="端口"
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
              label="认证用户名 (可选)"
              autoComplete="off"
              value={form.username}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, username: e.target.value }))
              }
              placeholder="username"
              prefixIcon={<UserRound className="w-3.5 h-3.5" />}
            />

            <div>
              <label
                htmlFor="residential-password"
                className="block text-xs font-medium text-foreground mb-1.5"
              >
                认证密码 (可选)
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
                  placeholder="password"
                  prefixIcon={<KeyRound className="w-3.5 h-3.5" />}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="px-2"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  title={showPassword ? '隐藏密码' : '显示密码'}
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
            用户名与密码需同时填写或同时留空；凭据仅写入本机配置文件，不会上传。
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
              <span className="text-xs">正在加载住宅出口配置...</span>
            </div>
          ) : proxies.length === 0 ? (
            <div className="border border-dashed border-border rounded-xl p-10 flex flex-col items-center justify-center text-center space-y-3 bg-card/30">
              <div className="w-11 h-11 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <Building2 className="w-5 h-5" />
              </div>
              <div className="space-y-1 max-w-sm">
                <h3 className="text-sm font-semibold text-foreground">
                  尚未配置住宅出口
                </h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  添加认证型 HTTP / SOCKS5
                  住宅代理后，可在端口映射中选择该出口，形成「上游节点 →
                  住宅出口 → 目标」的固定链路。
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
                添加第一个住宅出口
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
                                title={`正被端口 ${usedPorts.join('、')} 使用`}
                              >
                                {usedPorts.length} 个端口使用中
                              </Badge>
                            ) : (
                              <Badge
                                variant="secondary"
                                size="sm"
                                className="shrink-0"
                              >
                                未使用
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
                                  {proxy.username || '已配置凭据'}
                                </span>
                                <Lock className="w-3 h-3 shrink-0 ml-0.5" />
                                <span className="shrink-0">已配置认证</span>
                              </>
                            ) : (
                              <>
                                <KeyRound className="w-3 h-3 shrink-0" />
                                <span className="shrink-0">无认证</span>
                              </>
                            )}
                            {isReferenced && (
                              <span
                                className="truncate ml-1"
                                title={`端口 ${usedPorts.join('、')}`}
                              >
                                · 端口 {usedPorts.join('、')}
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
                              确认删除
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={deletingId === proxy.id}
                              onClick={() => setConfirmingDeleteId(null)}
                            >
                              取消
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
                              title="使用已保存凭据测试实际链路出口"
                              icon={<Cable className="w-3.5 h-3.5" />}
                            >
                              {isTestingOpen ? '收起测试' : '测试连接'}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              disabled={!isDesktop}
                              onClick={() => startEdit(proxy)}
                              aria-label={`编辑住宅出口 ${proxy.name}`}
                              title={
                                isDesktop
                                  ? '编辑住宅出口'
                                  : '仅支持桌面应用环境'
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
                              aria-label={`删除住宅出口 ${proxy.name}`}
                              title={
                                isReferenced
                                  ? `正被端口 ${usedPorts.join('、')} 使用，请先解除绑定`
                                  : isDesktop
                                    ? '删除住宅出口'
                                    : '仅支持桌面应用环境'
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
                  被端口引用的住宅出口不能删除，需先在对应端口中解除绑定。
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
