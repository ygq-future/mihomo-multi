import {
  AlertCircle,
  AlertTriangle,
  Globe,
  Loader2,
  Network,
  Radio,
  Server,
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
import { Badge, Button, Input, Modal, RegionFlag, Select } from '../common'

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
  const [description, setDescription] = useState<string>('')
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
        setDescription(initialMapping.description || '')
      } else {
        const profId = initialProfileId || (profiles[0] ? profiles[0].id : '')
        setSelectedProfileId(profId)
        setSelectedNodeName(initialNodeName || '')

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
      }
    }
  }, [isOpen, initialProfileId, initialNodeName, initialMapping, profiles])

  // Ensure nodes for selected profile are loaded
  useEffect(() => {
    if (selectedProfileId && !profileNodes[selectedProfileId]) {
      fetchProfileNodes(selectedProfileId).catch(() => {})
    }
  }, [selectedProfileId, profileNodes, fetchProfileNodes])

  // Check port availability on debounced port change
  useEffect(() => {
    const portNum = Number.parseInt(port, 10)
    if (!portNum || portNum < 1024 || portNum > 65535) {
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

  const availableNodes = useMemo(() => {
    if (!selectedProfileId) return []
    return profileNodes[selectedProfileId] || []
  }, [selectedProfileId, profileNodes])

  const selectedNode = useMemo(() => {
    return availableNodes.find((n) => n.name === selectedNodeName)
  }, [availableNodes, selectedNodeName])

  const boundNodeMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of portMappings) {
      if (!initialMapping || m.id !== initialMapping.id) {
        map.set(`${m.profileId}_${m.nodeName}`, m.port)
      }
    }
    return map
  }, [portMappings, initialMapping])

  const selectedProfile = useMemo(() => {
    return profiles.find((p) => p.id === selectedProfileId)
  }, [profiles, selectedProfileId])

  const sortedNodes = useMemo(() => {
    const list = [...availableNodes]
    const profName = selectedProfile?.name || ''
    return list.sort((a, b) => {
      const keyA = profName ? `[${profName}] ${a.name}` : a.name
      const keyB = profName ? `[${profName}] ${b.name}` : b.name
      const isBoundA = boundNodeMap.has(`${selectedProfileId}_${a.name}`)
      const isBoundB = boundNodeMap.has(`${selectedProfileId}_${b.name}`)

      // 1. Unbound nodes come first
      if (isBoundA !== isBoundB) {
        return isBoundA ? 1 : -1
      }

      // 2. Sort by latency (lowest first, timeouts later, untested last)
      const latA = nodeKeyHasLatency(keyA, a.name, latencies)
      const latB = nodeKeyHasLatency(keyB, b.name, latencies)

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

      return a.name.localeCompare(b.name, 'zh-Hans-CN')
    })
  }, [
    availableNodes,
    selectedProfile,
    selectedProfileId,
    boundNodeMap,
    latencies,
  ])

  const profileOptions = useMemo(() => {
    return profiles.map((p) => ({
      value: p.id,
      label: `${p.name} (${p.nodeCount} 节点)`,
    }))
  }, [profiles])

  const nodeOptions = useMemo(() => {
    const profName = selectedProfile?.name || ''
    return sortedNodes.map((n) => {
      const boundPort = boundNodeMap.get(`${selectedProfileId}_${n.name}`)
      const isBound = boundPort !== undefined
      const key = profName ? `[${profName}] ${n.name}` : n.name
      const latency = nodeKeyHasLatency(key, n.name, latencies)
      const latencyProps = getLatencyBadgeProps(latency, false)
      const region = extractRegion(n.name)

      return {
        value: n.name,
        label: n.name,
        description: isBound
          ? `已绑定到端口 ${boundPort}`
          : `${formatProtocolName(n.type)} 协议`,
        disabled: isBound,
        icon: <RegionFlag code={region.code} size="sm" />,
        rightNode: (
          <div className="flex items-center gap-1.5 shrink-0">
            {isBound ? (
              <span className="text-[10px] text-muted-foreground font-mono bg-secondary px-1.5 py-0.5 rounded">
                已绑端口 {boundPort}
              </span>
            ) : (
              <Badge
                variant={latencyProps.variant}
                size="sm"
                dot={latencyProps.dot}
                className="!text-[10px] !py-0.5 !px-1.5 font-mono"
              >
                {latencyProps.label}
              </Badge>
            )}
          </div>
        ),
      }
    })
  }, [sortedNodes, selectedProfile, selectedProfileId, boundNodeMap, latencies])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const portNum = Number.parseInt(port, 10)
    if (!portNum || portNum < 1024 || portNum > 65535) {
      setError('端口号必须在 1024 ~ 65535 范围内')
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
        enabled: isEditing && initialMapping ? initialMapping.enabled : true,
        description: description.trim() || undefined,
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
    >
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
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
                    <span>系统智能推荐匹配节点（点击快捷选择）：</span>
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

        {/* Profile Select */}
        <div>
          <label
            htmlFor="profile-select"
            className="block text-xs font-medium text-foreground mb-1.5"
          >
            所属订阅配置 <span className="text-destructive">*</span>
          </label>
          <Select
            id="profile-select"
            value={selectedProfileId}
            onChange={(val) => {
              setSelectedProfileId(String(val))
              setSelectedNodeName('')
            }}
            options={profileOptions}
            placeholder="选择订阅配置"
            prefixIcon={<Globe className="w-3.5 h-3.5 text-muted-foreground" />}
          />
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
            value={selectedNodeName}
            onChange={(val) => setSelectedNodeName(String(val))}
            options={nodeOptions}
            placeholder={
              availableNodes.length === 0
                ? '该订阅暂无可用节点'
                : '选择要绑定的节点'
            }
            prefixIcon={<Radio className="w-3.5 h-3.5 text-primary" />}
          />
        </div>

        {/* Pre-selected node preview card */}
        {selectedNode && (
          <div className="p-3 rounded-lg bg-secondary/50 border border-border flex items-center justify-between text-xs">
            <div className="space-y-0.5 min-w-0 flex-1">
              <div className="font-medium text-foreground truncate">
                {selectedNode.name}
              </div>
              <div className="text-[11px] text-muted-foreground font-mono truncate flex items-center gap-1">
                <Server className="w-3 h-3 shrink-0" />
                <span>
                  {selectedNode.server}:{selectedNode.port}
                </span>
              </div>
            </div>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border uppercase shrink-0 ${
                getProtocolBadgeProps(selectedNode.type).className
              }`}
            >
              {selectedNode.type}
            </span>
          </div>
        )}

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

        {/* Footer Actions */}
        <div className="pt-3 flex items-center justify-end gap-2 border-t border-border">
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
        </div>
      </form>
    </Modal>
  )
}
