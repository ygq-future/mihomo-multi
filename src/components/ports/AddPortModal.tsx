import {
  AlertCircle,
  AlertTriangle,
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
    savePortMapping,
    fetchStatus,
    setActiveTab,
    latencies,
  } = useAppStore()

  const [port, setPort] = useState<string>('7891')
  const [protocol, setProtocol] = useState<InboundProtocol>('mixed')
  const [selectedProfileId, setSelectedProfileId] = useState<string>('')
  const [selectedNodeName, setSelectedNodeName] = useState<string>('')
  const [fallbackProfileId, setFallbackProfileId] = useState<string>('')
  const [fallbackNodeName, setFallbackNodeName] = useState<string>('')
  const [description, setDescription] = useState<string>('')
  const [bypassCn, setBypassCn] = useState<boolean>(true)
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

  const boundNodeMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of portMappings) {
      if (!initialMapping || m.id !== initialMapping.id) {
        map.set(`${m.profileId}:::${m.nodeName}`, m.port)
      }
    }
    return map
  }, [portMappings, initialMapping])

  const sortedNodes = useMemo(() => {
    const list = [...allAvailableNodes]
    return list.sort((a, b) => {
      const isBoundA = boundNodeMap.has(a.uniqueKey)
      const isBoundB = boundNodeMap.has(b.uniqueKey)

      if (isBoundA !== isBoundB) {
        return isBoundA ? 1 : -1
      }

      const latA = nodeKeyHasLatency(a.displayName, a.name, latencies)
      const latB = nodeKeyHasLatency(b.displayName, b.name, latencies)

      const scoreA =
        latA !== undefined && latA !== null
          ? latA
          : latA === null
            ? 900000
            : 999999
      const scoreB =
        latB !== undefined && latB !== null
          ? latB
          : latB === null
            ? 900000
            : 999999

      if (scoreA !== scoreB) {
        return scoreA - scoreB
      }

      return a.displayName.localeCompare(b.displayName, 'zh-Hans-CN')
    })
  }, [allAvailableNodes, boundNodeMap, latencies])

  const nodeOptions = useMemo(() => {
    return sortedNodes.map((n) => {
      const boundPort = boundNodeMap.get(n.uniqueKey)
      const latency = nodeKeyHasLatency(n.displayName, n.name, latencies)
      const latencyProps = getLatencyBadgeProps(latency, false)
      const region = extractRegion(n.name)

      return {
        value: n.uniqueKey,
        label: n.displayName,
        group: n.profileName,
        searchTarget: n.name,
        description: boundPort
          ? `已绑定至端口 ${boundPort} · ${formatProtocolName(n.type)} 协议`
          : `${formatProtocolName(n.type)} 协议 · ${region.name || region.code}`,
        icon: <RegionFlag code={region.code} size="sm" />,
        disabled: Boolean(boundPort),
        rightNode: (
          <div className="flex items-center gap-1.5">
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
  }, [sortedNodes, boundNodeMap, latencies])

  const fallbackNodeOptions = useMemo(() => {
    if (!selectedNodeRegion || !selectedNode) return []

    const sameRegionNodes = allAvailableNodes.filter(
      (n) =>
        n.uniqueKey !== selectedNode.uniqueKey &&
        extractRegion(n.name).code === selectedNodeRegion.code,
    )

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

  const handleSubmit = async (e: React.FormEvent) => {
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
      setError('请选择绑定的代理节点')
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
        fallbackProfileId: fallbackNodeName.trim()
          ? fallbackProfileId
          : undefined,
        fallbackNodeName: fallbackNodeName.trim() || undefined,
        bypassCn,
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
        isEditing
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
              isPortAvailable === false
            }
          >
            {isEditing ? '保存修改' : '确认创建'}
          </Button>
        </>
      }
    >
      <form
        id="add-port-form"
        onSubmit={handleSubmit}
        className="p-5 space-y-4"
      >
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
              <span>检测到节点漂移/失效 (DIRECT 兜底生效中)</span>
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
            绑定代理节点 <span className="text-destructive">*</span>
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
                : '搜索或选择要绑定的代理节点'
            }
            prefixIcon={<Radio className="w-3.5 h-3.5 text-primary" />}
          />
          <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
            单段输入直接匹配节点名称；支持空格两段式筛选（“订阅
            节点”，两者均支持模糊匹配；输入“订阅 ”可直接列出该订阅全部节点）。
          </p>
        </div>

        {/* Same-region Fallback Node Select - directly below main node select */}
        {selectedNode && (
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
                {selectedFallbackNode && (
                  <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-primary/10 text-primary font-medium shrink-0">
                    主
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
        <div className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-secondary/20">
          <label
            htmlFor="bypass-cn-switch"
            className="text-xs font-medium text-foreground cursor-pointer"
          >
            智能绕过大陆网站 (直连)
          </label>
          <Switch
            id="bypass-cn-switch"
            checked={bypassCn}
            onChange={setBypassCn}
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
