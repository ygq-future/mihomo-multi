import {
  AlertCircle,
  ArrowRight,
  Cable,
  Layers,
  Loader2,
  Network,
} from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getProfiles, testResidentialProxy } from '../../services/tauri'
import { useAppStore } from '../../stores/appStore'
import type {
  ProfileItem,
  ResidentialProxy,
  ResidentialProxyTestResult,
} from '../../types'
import {
  extractRegion,
  formatProtocolName,
  getLatencyBadgeProps,
} from '../../utils/proxy'
import { Badge, Button, RegionFlag, Select, toast } from '../common'

interface ResidentialProxyTestPanelProps {
  proxy: ResidentialProxy
  isDesktop: boolean
}

export const ResidentialProxyTestPanel: React.FC<
  ResidentialProxyTestPanelProps
> = ({ proxy, isDesktop }) => {
  const {
    profiles: storeProfiles,
    profileNodes,
    fetchProfileNodes,
  } = useAppStore()

  const [profileId, setProfileId] = useState('')
  const [nodeName, setNodeName] = useState('')
  const [loadedProfiles, setLoadedProfiles] = useState<ProfileItem[] | null>(
    null,
  )
  const [isTesting, setIsTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ResidentialProxyTestResult | null>(null)
  const [profilesError, setProfilesError] = useState<string | null>(null)
  const [nodeLoadError, setNodesError] = useState<{
    profileId: string
    message: string
  } | null>(null)
  const nodesError =
    nodeLoadError?.profileId === profileId ? nodeLoadError.message : null
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(false)
  const [loadingNodesProfileId, setLoadingNodesProfileId] = useState<
    string | null
  >(null)
  const [nodesRetryToken, setNodesRetryToken] = useState(0)

  const requestSeqRef = useRef(0)
  const isMountedRef = useRef(true)
  const profilesRequestRef = useRef(false)
  const loadingNodesRef = useRef<Set<string>>(new Set())

  const profiles = useMemo(
    () => (storeProfiles.length > 0 ? storeProfiles : (loadedProfiles ?? [])),
    [storeProfiles, loadedProfiles],
  )

  // A saved credential edit invalidates earlier measurements even when the
  // exit id is unchanged.
  const proxySignature = [
    proxy.id,
    proxy.protocol,
    proxy.server,
    proxy.port,
    proxy.username,
    proxy.password,
  ].join('\u0000')

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const loadProfiles = useCallback(async () => {
    if (!isDesktop || profilesRequestRef.current) return
    profilesRequestRef.current = true
    setIsLoadingProfiles(true)
    setProfilesError(null)
    try {
      const next = await getProfiles()
      if (!isMountedRef.current) return
      setLoadedProfiles(next)
    } catch (err) {
      profilesRequestRef.current = false
      if (!isMountedRef.current) return
      setProfilesError(err instanceof Error ? err.message : String(err))
    } finally {
      if (isMountedRef.current) setIsLoadingProfiles(false)
    }
  }, [isDesktop])

  useEffect(() => {
    if (!isDesktop || storeProfiles.length > 0 || profilesRequestRef.current) {
      return
    }
    void loadProfiles()
  }, [isDesktop, storeProfiles.length, loadProfiles])

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === profileId) ?? null,
    [profiles, profileId],
  )

  const selectedNodes = useMemo(
    () => (profileId ? (profileNodes[profileId] ?? []) : []),
    [profileId, profileNodes],
  )

  const selectedNode = useMemo(
    () => selectedNodes.find((node) => node.name === nodeName) ?? null,
    [nodeName, selectedNodes],
  )

  const isLoadingNodes =
    Boolean(profileId) && loadingNodesProfileId === profileId

  useEffect(() => {
    if (!profileId || profileNodes[profileId]) return
    if (loadingNodesRef.current.has(profileId)) return
    const targetId = profileId
    loadingNodesRef.current.add(targetId)
    setLoadingNodesProfileId(targetId)
    setNodesError(null)
    fetchProfileNodes(targetId)
      .catch((err) => {
        if (isMountedRef.current) {
          setNodesError({
            profileId: targetId,
            message: err instanceof Error ? err.message : String(err),
          })
        }
      })
      .finally(() => {
        loadingNodesRef.current.delete(targetId)
        if (isMountedRef.current) {
          setLoadingNodesProfileId((current) =>
            current === targetId ? null : current,
          )
        }
      })
  }, [profileId, profileNodes, fetchProfileNodes, nodesRetryToken])

  useEffect(() => {
    if (!nodeName || selectedNodes.length === 0) return
    if (!selectedNodes.some((node) => node.name === nodeName)) {
      setNodeName('')
    }
  }, [nodeName, selectedNodes])

  // Subscription revisions also cover upstream credentials and dialer dependencies.
  const nodeSignature = selectedNode
    ? [
        selectedNode.name,
        selectedNode.type,
        selectedNode.server,
        selectedNode.port,
      ].join('\u0000')
    : nodeName
  const scopeKey = `${proxySignature}\u0000${profileId}\u0000${selectedProfile?.lastUpdatedAt}\u0000${selectedProfile?.name}\u0000${nodeSignature}`
  const scopeKeyRef = useRef(scopeKey)

  useEffect(() => {
    scopeKeyRef.current = scopeKey
    requestSeqRef.current += 1
    setIsTesting(false)
    setResult(null)
    setError(null)
  }, [scopeKey])

  const profileOptions = useMemo(
    () =>
      profiles.map((profile) => ({
        value: profile.id,
        label: profile.name,
        description: `${profile.nodeCount} 个节点`,
        icon: <Layers className="w-3.5 h-3.5 text-primary" />,
      })),
    [profiles],
  )

  const nodeOptions = useMemo(
    () =>
      selectedNodes.map((node) => {
        const region = extractRegion(node.name)
        return {
          value: node.name,
          label: node.name,
          description: `${formatProtocolName(node.type)} · ${region.name || region.code}`,
          icon: <RegionFlag code={region.code} size="sm" />,
        }
      }),
    [selectedNodes],
  )

  const canTest = isDesktop && Boolean(profileId) && Boolean(nodeName)

  const handleTest = async () => {
    if (!isDesktop) {
      setError('住宅出口测试需要桌面应用环境（需运行 Mihomo 内核）')
      return
    }
    if (!profileId || !nodeName) {
      setError('请先选择订阅与上游节点后再测试')
      return
    }
    const scope = scopeKeyRef.current
    const seq = ++requestSeqRef.current
    setIsTesting(true)
    setError(null)
    setResult(null)
    try {
      const next = await testResidentialProxy(proxy.id, profileId, nodeName)
      if (
        !isMountedRef.current ||
        seq !== requestSeqRef.current ||
        scope !== scopeKeyRef.current
      ) {
        return
      }
      setResult(next)
      toast.success(
        `住宅出口测试通过：${next.egress.ip} · ${next.latencyMs} ms`,
      )
    } catch (err) {
      if (!isMountedRef.current || seq !== requestSeqRef.current) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (isMountedRef.current && seq === requestSeqRef.current) {
        setIsTesting(false)
      }
    }
  }

  const latencyProps = result
    ? getLatencyBadgeProps(result.latencyMs, false)
    : null

  const liveMessage = error
    ? `住宅出口测试失败：${error}`
    : profilesError
      ? `订阅加载失败：${profilesError}`
      : nodesError
        ? `节点加载失败：${nodesError}`
        : result
          ? `住宅出口测试通过：${result.egress.ip}，${result.egress.region}，${result.latencyMs} 毫秒`
          : ''

  return (
    <div className="border-t border-border bg-secondary/20 px-3 py-2.5 space-y-2">
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {liveMessage}
      </div>
      {!isDesktop && (
        <div className="flex items-start gap-1.5 rounded-md border border-amber-500/25 bg-amber-500/5 px-2 py-1.5 text-[10px] leading-relaxed text-amber-600 dark:text-amber-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>
            住宅出口测试仅支持桌面应用环境，浏览器预览不会发起真实连接。
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="min-w-0">
          <span className="block text-[10px] font-medium text-muted-foreground mb-1">
            订阅
          </span>
          <Select
            ariaLabel="测试住宅出口的订阅"
            size="sm"
            value={profileId}
            onChange={(value) => {
              setProfileId(String(value))
              setNodeName('')
              setNodesError(null)
            }}
            options={profileOptions}
            disabled={isLoadingProfiles || Boolean(profilesError)}
            placeholder={
              isLoadingProfiles
                ? '正在加载订阅...'
                : profilesError
                  ? '订阅加载失败'
                  : profiles.length === 0
                    ? '暂无订阅'
                    : '选择订阅'
            }
            prefixIcon={<Layers className="w-3.5 h-3.5 text-primary" />}
          />
        </div>
        <div className="min-w-0">
          <span className="block text-[10px] font-medium text-muted-foreground mb-1">
            上游节点
          </span>
          <Select
            ariaLabel="测试住宅出口的上游节点"
            size="sm"
            value={nodeName}
            onChange={(value) => setNodeName(String(value))}
            options={nodeOptions}
            disabled={!profileId || isLoadingNodes || Boolean(nodesError)}
            placeholder={
              !profileId
                ? '先选择订阅'
                : isLoadingNodes
                  ? '正在加载节点...'
                  : nodesError
                    ? '节点加载失败'
                    : selectedNodes.length === 0
                      ? '该订阅暂无节点'
                      : '选择上游节点'
            }
            prefixIcon={<Network className="w-3.5 h-3.5 text-primary" />}
          />
        </div>
      </div>

      {profilesError && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 px-2 py-1.5 text-[10px] text-destructive">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span className="flex-1 min-w-0 leading-relaxed break-words">
            订阅加载失败：{profilesError}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={isLoadingProfiles}
            disabled={isLoadingProfiles}
            onClick={() => void loadProfiles()}
          >
            重试
          </Button>
        </div>
      )}

      {nodesError && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 px-2 py-1.5 text-[10px] text-destructive">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span className="flex-1 min-w-0 leading-relaxed break-words">
            节点加载失败：{nodesError}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isLoadingNodes}
            onClick={() => setNodesRetryToken((token) => token + 1)}
          >
            重试
          </Button>
        </div>
      )}

      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] text-muted-foreground leading-relaxed min-w-0">
          实际链路：所选上游节点 → 已保存的住宅出口（
          {proxy.protocol.toUpperCase()} {proxy.server}:{proxy.port}
          ）→ 目标。凭据使用已保存配置，修改后需先保存再测试。
        </p>
        <Button
          type="button"
          variant="primary"
          size="sm"
          loading={isTesting}
          disabled={!canTest || isTesting}
          onClick={() => void handleTest()}
          icon={!isTesting && <Cable className="w-3.5 h-3.5" />}
        >
          测试连接
        </Button>
      </div>

      {isTesting && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-[10px] text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
          <span>正在经上游节点连接住宅出口，请稍候...</span>
        </div>
      )}

      {error && !isTesting && (
        <div className="flex items-start gap-1.5 rounded-md border border-destructive/20 bg-destructive/10 px-2 py-1.5 text-[10px] leading-relaxed text-destructive">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      )}

      {result && latencyProps && (
        <div className="rounded-md border border-emerald-500/25 bg-emerald-500/5 px-2 py-1.5 space-y-1">
          <div className="flex items-center gap-x-2 gap-y-1 flex-wrap text-[11px]">
            <span className="font-semibold text-foreground">测试通过</span>
            <Badge
              variant={latencyProps.variant}
              dot={latencyProps.dot}
              className="font-mono"
            >
              {result.latencyMs} ms
            </Badge>
            {result.egress.countryCode && (
              <RegionFlag code={result.egress.countryCode} size="sm" />
            )}
            <span className="font-mono text-foreground">
              {result.egress.ip}
            </span>
            <span className="text-muted-foreground truncate max-w-full">
              {result.egress.region}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground leading-relaxed break-all">
            <span className="text-foreground">
              {selectedProfile?.name ?? profileId}
            </span>
            <span className="mx-1">·</span>
            <span className="text-foreground">{nodeName}</span>
            <ArrowRight className="inline w-3 h-3 mx-1 align-middle" />
            <span className="text-foreground">{proxy.name}</span>
            {result.egress.isp ? ` · ${result.egress.isp}` : ''}
          </p>
        </div>
      )}
    </div>
  )
}
