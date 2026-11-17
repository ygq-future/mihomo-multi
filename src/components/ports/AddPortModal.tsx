import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Building2,
  Loader2,
  Network,
  Radio,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react'
import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import * as api from '../../services/tauri'
import { useAppStore } from '../../stores/appStore'
import type { InboundProtocol, PortMapping } from '../../types'
import {
  extractRegion,
  formatProtocolName,
  getLatencyBadgeProps,
  getProtocolBadgeProps,
} from '../../utils/proxy'
import {
  Badge,
  Button,
  Input,
  Modal,
  RegionFlag,
  Select,
  type SelectOption,
  Switch,
} from '../common'

export interface AddPortModalProps {
  isOpen: boolean
  onClose: () => void
  initialProfileId?: string
  initialNodeName?: string
  initialMapping?: PortMapping | null
}

function nodeKeyHasLatency(
  key: string,
  rawName: string,
  latencies: Record<string, number | null>,
): number | null | undefined {
  if (key in latencies) return latencies[key]
  if (rawName in latencies) return latencies[rawName]
  return undefined
}

function getNodeLatencyScore(
  displayName: string,
  rawName: string,
  latencies: Record<string, number | null>,
): number {
  const lat = nodeKeyHasLatency(displayName, rawName, latencies)
  if (lat !== undefined && lat !== null) {
    return lat
  }
  if (lat === null) {
    return 900000
  }
  return 999999
}

function compareNodesByLatencyAndName(
  a: { displayName: string; name: string },
  b: { displayName: string; name: string },
  latencies: Record<string, number | null>,
): number {
  const scoreA = getNodeLatencyScore(a.displayName, a.name, latencies)
  const scoreB = getNodeLatencyScore(b.displayName, b.name, latencies)

  if (scoreA !== scoreB) {
    return scoreA - scoreB
  }

  return a.displayName.localeCompare(b.displayName, 'zh-Hans-CN')
}

export const AddPortModal: React.FC<AddPortModalProps> = ({
  isOpen,
  onClose,
  initialProfileId,
  initialNodeName,
  initialMapping,
}) => {
  const {
    profiles,
    profileNodes,
    portMappings,
    driftReports,
    fetchProfileNodes,
    fetchConfig,
    savePortMapping,
    fetchStatus,
    setActiveTab,
    latencies,
    config,
  } = useAppStore()

  const [port, setPort] = useState<string>('7891')
  const [protocol, setProtocol] = useState<InboundProtocol>('mixed')
  const [selectedProfileId, setSelectedProfileId] = useState<string>('')
  const [selectedNodeName, setSelectedNodeName] = useState<string>('')
  const [fallbackProfileId, setFallbackProfileId] = useState<string>('')
  const [fallbackNodeName, setFallbackNodeName] = useState<string>('')
  const [description, setDescription] = useState<string>('')
  const [bypassCn, setBypassCn] = useState<boolean>(true)
  const [selectedResidentialProxyId, setSelectedResidentialProxyId] =
    useState<string>('')
  const [residentialConfigError, setResidentialConfigError] = useState<
    string | null
  >(null)
  const [configReloadToken, setConfigReloadToken] = useState(0)
  const [isCheckingPort, setIsCheckingPort] = useState(false)
  const [isPortAvailable, setIsPortAvailable] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const isEditing = Boolean(initialMapping)

  // Find if current mapping has a drift report
  const currentDrift = useMemo(() => {
    if (!initialMapping) return null
    return driftReports.find((r) => r.mappingId === initialMapping.id) || null
  }, [initialMapping, driftReports])

  // Initialize or reset fields when opened
  useEffect(() => {
    if (isOpen) {
      setError(null)
      setSuccess(false)
      setSubmitting(false)
      setResidentialConfigError(null)

      if (initialMapping) {
        setPort(String(initialMapping.port))
        setProtocol(initialMapping.protocol)
        setSelectedProfileId(initialMapping.profileId)
        setSelectedNodeName(initialMapping.nodeName)
        setFallbackProfileId(
          initialMapping.fallbackProfileId || initialMapping.profileId,
        )
        setFallbackNodeName(initialMapping.fallbackNodeName || '')
        setDescription(initialMapping.description || '')
        setBypassCn(initialMapping.bypassCn ?? true)
        setSelectedResidentialProxyId(initialMapping.residentialProxyId || '')
      } else {
        setSelectedProfileId(initialProfileId || '')
        setSelectedNodeName(initialNodeName || '')
        setFallbackProfileId('')
        setFallbackNodeName('')
        // Sequential backend auto-allocation starting from 7891 (accounts for both self and system occupancy)
        api
          .getNextAvailablePort(7891)
          .then((allocatedPort) => {
            setPort(String(allocatedPort))
            setIsPortAvailable(true)
          })
          .catch(() => {
            setPort('7891')
          })

        setProtocol('mixed')
        setDescription('')
        setBypassCn(true)
        setSelectedResidentialProxyId('')
      }
    }
  }, [isOpen, initialProfileId, initialNodeName, initialMapping, profiles])

  // Ensure nodes for all profiles are loaded
  useEffect(() => {
    if (isOpen) {
      for (const p of profiles) {
        if (!profileNodes[p.id]) {
          fetchProfileNodes(p.id).catch(() => {})
        }
      }
    }
  }, [isOpen, profiles, profileNodes, fetchProfileNodes])

  // Managed residential exits live in the app config.
  useEffect(() => {
    if (!isOpen || config) return
    let cancelled = false
    setResidentialConfigError(null)
    fetchConfig()
      .then(() => {
        if (cancelled) return
        const state = useAppStore.getState()
        if (!state.config) {
          setResidentialConfigError(
            state.error || '住宅出口配置加载失败，请重试',
          )
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setResidentialConfigError(
            err instanceof Error ? err.message : String(err),
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, config, fetchConfig, configReloadToken])

  // Check port availability on debounced port change
  useEffect(() => {
    const trimmedPort = port.trim()
    const isPureInteger = /^\d+$/.test(trimmedPort)
    const portNum = isPureInteger ? Number.parseInt(trimmedPort, 10) : 0
    if (!isPureInteger || !portNum || portNum < 1024 || portNum > 65535) {
      setIsPortAvailable(null)
      return
    }

    // If editing and port hasn't changed, it's considered valid
    if (
      isEditing &&
      initialMapping &&
      portNum === initialMapping.port &&
      initialMapping.enabled
    ) {
      setIsPortAvailable(true)
      setIsCheckingPort(false)
      return
    }

    let isMounted = true
    setIsCheckingPort(true)

    const timer = setTimeout(async () => {
      try {
        const available = await api.checkPortAvailable(
          portNum,
          initialMapping?.id,
        )
        if (isMounted) {
          setIsPortAvailable(available)
          setIsCheckingPort(false)
        }
      } catch {
        if (isMounted) {
          setIsPortAvailable(false)
          setIsCheckingPort(false)
        }
      }
    }, 250)

    return () => {
      isMounted = false
      clearTimeout(timer)
    }
  }, [port, isEditing, initialMapping])

  const allAvailableNodes = useMemo(() => {
    const result: Array<{
      name: string
      type: string
      server: string
      port: number
      profileId: string
      profileName: string
      uniqueKey: string
      displayName: string
    }> = []
    for (const p of profiles) {
      const nodes = profileNodes[p.id] || []
      for (const n of nodes) {
        result.push({
          ...n,
          profileId: p.id,
          profileName: p.name,
          uniqueKey: `${p.id}:::${n.name}`,
          displayName: `[${p.name}] ${n.name}`,
        })
      }
    }
    return result
  }, [profiles, profileNodes])

  const selectedNode = useMemo(() => {
    if (!selectedNodeName || !selectedProfileId) return null
    return (
      allAvailableNodes.find(
        (n) => n.profileId === selectedProfileId && n.name === selectedNodeName,
      ) || null
    )
  }, [allAvailableNodes, selectedProfileId, selectedNodeName])

  const selectedFallbackNode = useMemo(() => {
    if (!fallbackNodeName || !fallbackProfileId) return null
    return (
      allAvailableNodes.find(
        (n) => n.profileId === fallbackProfileId && n.name === fallbackNodeName,
      ) || null
    )
  }, [allAvailableNodes, fallbackProfileId, fallbackNodeName])

  const selectedNodeRegion = useMemo(() => {
    if (!selectedNodeName) return null
    return extractRegion(selectedNodeName)
  }, [selectedNodeName])

  const residentialProxies = useMemo(
    () => config?.residentialProxies ?? [],
    [config],
  )
  const selectedResidentialProxy = useMemo(
    () =>
      residentialProxies.find(
        (proxy) => proxy.id === selectedResidentialProxyId,
      ) ?? null,
    [residentialProxies, selectedResidentialProxyId],
  )
  const isChainMode = selectedResidentialProxyId !== ''

  const handleResidentialChange = (value: string) => {
    setSelectedResidentialProxyId(value)
    if (value) {
      // Chain ports must send all traffic through the exit: bypass rules,
      // fallback nodes and per-port rules are all bypassed by design.
      setBypassCn(false)
      setFallbackProfileId('')
      setFallbackNodeName('')
    } else {
      setBypassCn(true)
    }
  }

  const boundNodeMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of portMappings) {
      if (initialMapping && m.id === initialMapping.id) continue
      // Chain ports only use the node as an upstream hop, so their node
      // selection never blocks another chain port from sharing it.
      if (m.residentialProxyId) continue
      map.set(`${m.profileId}:::${m.nodeName}`, m.port)
    }
    return map
  }, [portMappings, initialMapping])

  const chainUpstreamMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of portMappings) {
      if (initialMapping && m.id === initialMapping.id) continue
      if (!m.residentialProxyId) continue
      map.set(`${m.profileId}:::${m.nodeName}`, m.port)
    }
    return map
  }, [portMappings, initialMapping])

  const sortedNodes = useMemo(() => {
    const list = [...allAvailableNodes]
    return list.sort((a, b) => {
      const isBoundA = !isChainMode && boundNodeMap.has(a.uniqueKey)
      const isBoundB = !isChainMode && boundNodeMap.has(b.uniqueKey)

      if (isBoundA !== isBoundB) {
        return isBoundA ? 1 : -1
      }
      return compareNodesByLatencyAndName(a, b, latencies)
    })
  }, [allAvailableNodes, boundNodeMap, latencies, isChainMode])

  const nodeOptions = useMemo(() => {
    return sortedNodes.map((n) => {
      const boundPort = boundNodeMap.get(n.uniqueKey)
      const chainPort = chainUpstreamMap.get(n.uniqueKey)
      const latency = nodeKeyHasLatency(n.displayName, n.name, latencies)
      const latencyProps = getLatencyBadgeProps(latency, false)
      const region = extractRegion(n.name)
      const protocolText = `${formatProtocolName(n.type)} 协议`
      let description = `${protocolText} · ${region.name || region.code}`
      if (boundPort && !isChainMode) {
        description = `已绑定至端口 ${boundPort} · ${protocolText}`
      } else if (chainPort) {
        description = `已作为端口 ${chainPort} 的上游 · ${protocolText}`
      } else if (boundPort && isChainMode) {
        description = `端口 ${boundPort} 已绑定 · 可复用为上游 · ${protocolText}`
      }

      return {
        value: n.uniqueKey,
        label: n.displayName,
        group: n.profileName,
        searchTarget: n.name,
        description,
        icon: <RegionFlag code={region.code} size="sm" />,
        disabled: Boolean(boundPort) && !isChainMode,
        rightNode: (
          <div className="flex items-center gap-1.5">
            {chainPort && (
              <Badge
                variant="secondary"
                size="sm"
                className="!text-[10px] !py-0.5 !px-1.5"
              >
                上游 :{chainPort}
              </Badge>
            )}
            {boundPort && (
              <Badge
                variant="outline"
                size="sm"
                className="!text-[10px] !py-0.5 !px-1.5"
              >
                占用 :{boundPort}
              </Badge>
            )}
            <Badge
              variant={latencyProps.variant}
              size="sm"
              dot={latencyProps.dot}
              className="!text-[10px] !py-0.5 !px-1.5 font-mono"
            >
              {latencyProps.label}
            </Badge>
          </div>
        ),
      }
    })
  }, [sortedNodes, boundNodeMap, chainUpstreamMap, latencies, isChainMode])

  const residentialOptions = useMemo(() => {
    const options: SelectOption<string>[] = [
      {
        value: '',
        label: '不使用住宅出口',
        description: '流量仅经所选上游节点单跳转发',
      },
    ]
    for (const proxy of residentialProxies) {
      options.push({
        value: proxy.id,
        label: proxy.name,
        description: `${proxy.protocol.toUpperCase()} · ${proxy.server}:${proxy.port}`,
        icon: <Building2 className="w-3.5 h-3.5 text-primary" />,
      })
    }
    if (
      selectedResidentialProxyId &&
      !residentialProxies.some(
        (proxy) => proxy.id === selectedResidentialProxyId,
      )
    ) {
      options.push({
        value: selectedResidentialProxyId,
        label: '住宅出口配置缺失',
        description: '该出口已从配置中删除，请重新选择或清除',
        disabled: true,
      })
    }
    return options
  }, [residentialProxies, selectedResidentialProxyId])

  const fallbackNodeOptions = useMemo(() => {
    if (!selectedNodeRegion || !selectedNode) return []

    const sameRegionNodes = allAvailableNodes
      .filter(
        (n) =>
          n.uniqueKey !== selectedNode.uniqueKey &&
          extractRegion(n.name).code === selectedNodeRegion.code,
      )
      .sort((a, b) => compareNodesByLatencyAndName(a, b, latencies))

    const options: SelectOption<string>[] = [
      {
        value: '',
        label: '不启用备用节点 (单节点绑定)',
        description: '仅主节点监听，不进行自动故障转移',
      },
    ]

    for (const n of sameRegionNodes) {
      const latency = nodeKeyHasLatency(n.displayName, n.name, latencies)
      const latencyProps = getLatencyBadgeProps(latency, false)
      const region = extractRegion(n.name)

      options.push({
        value: n.uniqueKey,
        label: n.displayName,
        group: n.profileName,
        searchTarget: n.name,
        description: `${formatProtocolName(n.type)} 协议 · 同属 ${region.name || region.code}`,
        icon: <RegionFlag code={region.code} size="sm" />,
        rightNode: (
          <Badge
            variant={latencyProps.variant}
            size="sm"
            dot={latencyProps.dot}
            className="!text-[10px] !py-0.5 !px-1.5 font-mono"
          >
            {latencyProps.label}
          </Badge>
        ),
      })
    }

    return options
  }, [selectedNodeRegion, selectedNode, allAvailableNodes, latencies])

  const mainLatency = selectedNode
    ? nodeKeyHasLatency(selectedNode.displayName, selectedNode.name, latencies)
    : undefined
  const mainLatencyProps = getLatencyBadgeProps(mainLatency, false)
  const mainProtocolProps = selectedNode
    ? getProtocolBadgeProps(selectedNode.type)
    : null

  const fbLatency = selectedFallbackNode
    ? nodeKeyHasLatency(
        selectedFallbackNode.displayName,
        selectedFallbackNode.name,
        latencies,
      )
    : undefined
  const fbLatencyProps = selectedFallbackNode
    ? getLatencyBadgeProps(fbLatency, false)
    : null
  const fbProtocolProps = selectedFallbackNode
    ? getProtocolBadgeProps(selectedFallbackNode.type)
    : null

  const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)

    const trimmedPort = port.trim()
    const isPureInteger = /^\d+$/.test(trimmedPort)
    const portNum = isPureInteger ? Number.parseInt(trimmedPort, 10) : 0
    if (!isPureInteger || !portNum || portNum < 1024 || portNum > 65535) {
      setError('端口号必须为整数且在 1024 ~ 65535 范围内')
      return
    }

    if (isPortAvailable === false) {
      setError(`本地端口 ${portNum} 已被占用，请更换其他端口`)
      return
    }

    if (!selectedProfileId) {
      setError('请选择所属订阅配置')
      return
    }

    if (!selectedNodeName) {
      setError(isChainMode ? '请选择链路的上游节点' : '请选择绑定的代理节点')
      return
    }

    if (isChainMode && !selectedResidentialProxy) {
      setError('所选住宅出口已从配置中删除，请重新选择或清除住宅出口')
      return
    }

    setSubmitting(true)
    try {
      await savePortMapping({
        id: isEditing && initialMapping ? initialMapping.id : '',
        port: portNum,
        protocol,
        profileId: selectedProfileId,
        nodeName: selectedNodeName,
        residentialProxyId: isChainMode ? selectedResidentialProxyId : null,
        fallbackProfileId: isChainMode
          ? null
          : fallbackNodeName.trim()
            ? fallbackProfileId
            : null,
        fallbackNodeName: isChainMode ? null : fallbackNodeName.trim() || null,
        bypassCn: isChainMode ? false : bypassCn,
        manualFallback: isChainMode ? false : initialMapping?.manualFallback,
        rules: isChainMode ? [] : initialMapping?.rules,
        description: description.trim() || undefined,
        enabled: isEditing && initialMapping ? initialMapping.enabled : true,
      })

      fetchStatus().catch(() => {})
      setSuccess(true)
      setTimeout(() => {
        onClose()
        setActiveTab('ports')
      }, 400)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSubmitting(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        isEditing
          ? '编辑端口监听规则'
          : initialNodeName
            ? '快速绑定到端口监听'
            : '添加端口映射'
      }
      subtitle={
        isChainMode
          ? isEditing
            ? '修改入站端口、上游节点与住宅出口链路'
            : '上游节点 → 住宅出口 → 目标，全量流量固定从住宅出口发出'
          : isEditing
            ? '修改入站监听端口及 1:1 绑定的代理节点'
            : '分配独立本地入站监听端口并 1:1 绑定至指定代理节点'
      }
      icon={<Network className="w-4 h-4 text-primary" />}
      maxWidth="md"
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={submitting || success}
          >
            取消
          </Button>
          <Button
            type="submit"
            form="add-port-form"
            variant="primary"
            size="sm"
            loading={submitting}
            disabled={
              submitting ||
              success ||
              !selectedNodeName ||
              !port ||
              isPortAvailable === false ||
              (isChainMode && !selectedResidentialProxy)
            }
          >
            {isEditing ? '保存修改' : '确认创建'}
          </Button>
        </>
      }
    >
      <form id="add-port-form" onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 text-xs bg-destructive/10 border border-destructive/20 text-destructive rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-destructive hover:opacity-80"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Drift Warning Banner if editing drifted port */}
        {isEditing && currentDrift && currentDrift.status !== 'healthy' && (
          <div className="p-3 text-xs bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 rounded-lg space-y-2">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
              <span>
                {isChainMode
                  ? '检测到上游节点或住宅出口失效 (链路端口将拒绝流量)'
                  : '检测到节点漂移/失效 (DIRECT 兜底生效中)'}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {currentDrift.message}
            </p>
            {currentDrift.suggestions &&
              currentDrift.suggestions.length > 0 && (
                <div className="pt-1 space-y-1">
                  <div className="text-[10px] font-semibold text-muted-foreground flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-amber-500" />
                    <span>建议匹配节点：</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {currentDrift.suggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => setSelectedNodeName(suggestion)}
                        className={`px-2 py-1 rounded text-[11px] font-medium border transition-colors ${
                          selectedNodeName === suggestion
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-card hover:bg-accent border-border text-foreground'
                        }`}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}
          </div>
        )}

        {/* Port and Protocol Grid */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="port-input"
              className="block text-xs font-medium text-foreground mb-1.5"
            >
              本地监听端口 <span className="text-destructive">*</span>
            </label>
            <div className="relative">
              <Input
                id="port-input"
                type="number"
                integerOnly
                step={1}
                min={1024}
                max={65535}
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="7891"
                prefixIcon={<Network className="w-4 h-4" />}
                required
              />
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                {isCheckingPort ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                ) : isPortAvailable === true ? (
                  <span
                    className="text-[11px] text-emerald-500 flex items-center gap-0.5"
                    title="端口可用"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    可用
                  </span>
                ) : isPortAvailable === false ? (
                  <span
                    className="text-[11px] text-rose-500 flex items-center gap-0.5"
                    title="端口已被占用"
                  >
                    <X className="w-3.5 h-3.5" />
                    已占用
                  </span>
                ) : null}
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              建议范围: 1024 ~ 65535 (如 7891, 7892)
            </p>
          </div>

          <div>
            <label
              htmlFor="protocol-select"
              className="block text-xs font-medium text-foreground mb-1.5"
            >
              入站协议
            </label>
            <Select
              id="protocol-select"
              value={protocol}
              onChange={(val) => setProtocol(val as InboundProtocol)}
              options={[
                { value: 'mixed', label: 'Mixed (HTTP + SOCKS5)' },
                { value: 'http', label: 'HTTP 代理' },
                { value: 'socks5', label: 'SOCKS5 代理' },
              ]}
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Mixed 可同时响应 HTTP 与 SOCKS5
            </p>
          </div>
        </div>

        {/* Node Select */}
        <div>
          <label
            htmlFor="node-select"
            className="block text-xs font-medium text-foreground mb-1.5"
          >
            {isChainMode ? '上游节点 (链路前置跳板)' : '绑定代理节点'}{' '}
            <span className="text-destructive">*</span>
          </label>
          <Select
            id="node-select"
            value={selectedNode ? selectedNode.uniqueKey : ''}
            onChange={(val) => {
              const key = String(val)
              const found = allAvailableNodes.find((n) => n.uniqueKey === key)
              if (found) {
                setSelectedProfileId(found.profileId)
                setSelectedNodeName(found.name)
                // Reset fallback if region changed or conflicts with new main
                if (fallbackNodeName && fallbackProfileId) {
                  const nextRegion = extractRegion(found.name)
                  const currentFbRegion = extractRegion(fallbackNodeName)
                  if (
                    (found.name === fallbackNodeName &&
                      found.profileId === fallbackProfileId) ||
                    nextRegion.code !== currentFbRegion.code
                  ) {
                    setFallbackNodeName('')
                    setFallbackProfileId('')
                  }
                }
              } else {
                setSelectedProfileId('')
                setSelectedNodeName('')
                setFallbackNodeName('')
                setFallbackProfileId('')
              }
            }}
            options={nodeOptions}
            placeholder={
              allAvailableNodes.length === 0
                ? '暂无可用代理节点，请先添加订阅'
                : isChainMode
                  ? '搜索或选择链路的上游节点'
                  : '搜索或选择要绑定的代理节点'
            }
            prefixIcon={<Radio className="w-3.5 h-3.5 text-primary" />}
          />
          <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
            {isChainMode
              ? '链路模式下上游节点仅作为前置跳板，可与其他端口复用；最终出口由下方住宅出口决定。'
              : '单段输入直接匹配节点名称；支持空格两段式筛选（“订阅 节点”，两者均支持模糊匹配；输入“订阅 ”可直接列出该订阅全部节点）。'}
          </p>
        </div>

        {/* Residential Exit Select */}
        <div>
          <label
            htmlFor="residential-select"
            className="block text-xs font-medium text-foreground mb-1.5"
          >
            住宅出口 (可选)
          </label>
          <Select
            id="residential-select"
            value={selectedResidentialProxyId}
            onChange={(val) => handleResidentialChange(String(val))}
            options={residentialOptions}
            placeholder={
              residentialProxies.length === 0
                ? '尚未配置住宅出口'
                : '选择住宅代理出口'
            }
            prefixIcon={<Building2 className="w-3.5 h-3.5 text-primary" />}
            clearable={Boolean(selectedResidentialProxyId)}
            onClear={() => handleResidentialChange('')}
          />
          <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
            {residentialProxies.length === 0
              ? '可在「订阅配置」页的「住宅出口」中集中管理认证型 HTTP / SOCKS5 住宅代理。'
              : '选择后进入链路模式：全量流量经上游节点 → 住宅出口 → 目标，绕过大陆、备用节点、全局与局部网站分流规则强制失效。'}
          </p>
          {residentialConfigError && (
            <div className="flex items-center gap-1.5 mt-1 text-[10px] text-destructive">
              <AlertCircle className="w-3 h-3 shrink-0" />
              <span className="min-w-0">{residentialConfigError}</span>
              <button
                type="button"
                onClick={() => setConfigReloadToken((value) => value + 1)}
                className="shrink-0 underline underline-offset-2 hover:opacity-80"
              >
                重试
              </button>
            </div>
          )}
        </div>

        {/* Chain Overview Card */}
        {isChainMode && selectedNode && (
          <div className="p-3 rounded-lg border border-sky-500/30 bg-sky-500/5 space-y-2 text-xs">
            <div className="flex items-center gap-1.5 min-w-0">
              <Radio className="w-3.5 h-3.5 text-primary shrink-0" />
              <span
                className="font-medium text-foreground truncate"
                title={selectedNode.name}
              >
                {selectedNode.name}
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <Building2 className="w-3.5 h-3.5 text-sky-500 shrink-0" />
              <span
                className={`font-semibold truncate ${
                  selectedResidentialProxy
                    ? 'text-foreground'
                    : 'text-destructive'
                }`}
                title={
                  selectedResidentialProxy
                    ? selectedResidentialProxy.name
                    : '住宅出口配置缺失'
                }
              >
                {selectedResidentialProxy
                  ? selectedResidentialProxy.name
                  : '住宅出口配置缺失'}
              </span>
              <Badge
                variant={selectedResidentialProxy ? 'primary' : 'danger'}
                size="sm"
                className="ml-auto shrink-0"
              >
                {selectedResidentialProxy
                  ? `${selectedResidentialProxy.protocol.toUpperCase()} 住宅链路`
                  : '链路将拒绝流量'}
              </Badge>
            </div>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              上游节点故障或住宅出口不可用时，端口直接拒绝连接，绝不回退 DIRECT
              直连；该端口已有的备用节点与网站分流规则将被清除。
            </p>
            {initialMapping &&
              ((initialMapping.rules?.length ?? 0) > 0 ||
                Boolean(initialMapping.fallbackNodeName)) && (
                <p className="text-[10px] leading-relaxed text-amber-600 dark:text-amber-400">
                  保存后将清除
                  {initialMapping.rules?.length
                    ? ` ${initialMapping.rules.length} 条网站分流规则`
                    : ''}
                  {initialMapping.rules?.length &&
                  initialMapping.fallbackNodeName
                    ? '与'
                    : ''}
                  {initialMapping.fallbackNodeName ? ' 现有备用节点' : ''}。
                </p>
              )}
          </div>
        )}

        {/* Same-region Fallback Node Select - directly below main node select */}
        {selectedNode && !isChainMode && (
          <div className="pt-1">
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="fallback-select"
                className="text-xs font-medium text-foreground flex items-center gap-1.5"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                同地区 Fallback 备用节点 (容灾)
              </label>
              {selectedNodeRegion && (
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <RegionFlag code={selectedNodeRegion.code} size="sm" />限{' '}
                  {selectedNodeRegion.name} 同区容灾
                </span>
              )}
            </div>

            {fallbackNodeOptions.length <= 1 ? (
              <div className="p-2.5 rounded-lg border border-dashed border-border text-[11px] text-muted-foreground bg-muted/20">
                当前订阅中 {selectedNodeRegion?.name || '该地区'}{' '}
                暂无其他可用节点，无法配置同地区 Fallback。
              </div>
            ) : (
              <>
                <Select
                  id="fallback-select"
                  value={
                    selectedFallbackNode ? selectedFallbackNode.uniqueKey : ''
                  }
                  onChange={(val) => {
                    const key = String(val)
                    if (!key) {
                      setFallbackProfileId('')
                      setFallbackNodeName('')
                      return
                    }
                    const found = allAvailableNodes.find(
                      (n) => n.uniqueKey === key,
                    )
                    if (found) {
                      setFallbackProfileId(found.profileId)
                      setFallbackNodeName(found.name)
                    } else {
                      setFallbackProfileId('')
                      setFallbackNodeName('')
                    }
                  }}
                  options={fallbackNodeOptions}
                  placeholder="选择同地区备用节点 (可选，支持跨订阅)"
                  prefixIcon={
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                  }
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  主节点超时故障时自动降级至此节点，恢复后自动切回。
                </p>
              </>
            )}
          </div>
        )}

        {/* Node Information Card (Below both selects, showing protocol full name and latency) */}
        {selectedNode && mainProtocolProps && (
          <div className="p-3 rounded-lg bg-secondary/40 border border-border space-y-2 text-xs">
            {/* Main Node */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                {(selectedFallbackNode || isChainMode) && (
                  <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-primary/10 text-primary font-medium shrink-0">
                    {isChainMode ? '上游' : '主'}
                  </span>
                )}
                <RegionFlag
                  code={extractRegion(selectedNode.name).code}
                  size="sm"
                />
                <span
                  className="font-medium text-foreground truncate"
                  title={selectedNode.name}
                >
                  {selectedNode.name}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-medium border ${mainProtocolProps.className}`}
                >
                  {mainProtocolProps.label}
                </span>
                <Badge
                  variant={mainLatencyProps.variant}
                  size="sm"
                  dot={mainLatencyProps.dot}
                  className="!text-[10px] !py-0.5 !px-1.5 font-mono"
                >
                  {mainLatencyProps.label}
                </Badge>
              </div>
            </div>

            {/* Fallback Node */}
            {selectedFallbackNode && fbProtocolProps && fbLatencyProps && (
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/50">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-emerald-500/10 text-emerald-500 font-medium shrink-0">
                    备
                  </span>
                  <RegionFlag
                    code={extractRegion(selectedFallbackNode.name).code}
                    size="sm"
                  />
                  <span
                    className="font-medium text-foreground truncate"
                    title={selectedFallbackNode.name}
                  >
                    {selectedFallbackNode.name}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-medium border ${fbProtocolProps.className}`}
                  >
                    {fbProtocolProps.label}
                  </span>
                  <Badge
                    variant={fbLatencyProps.variant}
                    size="sm"
                    dot={fbLatencyProps.dot}
                    className="!text-[10px] !py-0.5 !px-1.5 font-mono"
                  >
                    {fbLatencyProps.label}
                  </Badge>
                </div>
              </div>
            )}
          </div>
        )}
        {/* Bypass CN Switch */}
        <div className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-border bg-secondary/20">
          <div className="min-w-0">
            <label
              htmlFor="bypass-cn-switch"
              className={`text-xs font-medium text-foreground ${
                isChainMode ? 'cursor-not-allowed' : 'cursor-pointer'
              }`}
            >
              智能绕过大陆网站 (直连)
            </label>
            <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
              {isChainMode
                ? '链路模式已强制关闭：该端口全量流量固定从住宅出口发出'
                : '开启后中国大陆域名与 IP 直连，不经过绑定节点'}
            </p>
          </div>
          <Switch
            id="bypass-cn-switch"
            checked={isChainMode ? false : bypassCn}
            onChange={setBypassCn}
            disabled={isChainMode}
            size="sm"
          />
        </div>
        {/* Description Input */}
        <div>
          <label
            htmlFor="desc-input"
            className="block text-xs font-medium text-foreground mb-1.5"
          >
            备注描述 (可选)
          </label>
          <Input
            id="desc-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="例如：指纹浏览器窗口 01"
          />
        </div>
      </form>
    </Modal>
  )
}
