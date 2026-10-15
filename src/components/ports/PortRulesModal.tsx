import {
  ArrowLeft,
  AtSign,
  BookOpen,
  Bot,
  Brain,
  Camera,
  CodeXml,
  Container,
  Cpu,
  Film,
  Gamepad2,
  Globe,
  Hash,
  HelpCircle,
  Image,
  Library,
  Loader2,
  MessageCircle,
  MessageSquare,
  Music,
  Pencil,
  PenTool,
  Play,
  PlaySquare,
  Plus,
  Radio,
  RotateCw,
  SearchCode,
  Send,
  Share2,
  ShoppingCart,
  Smile,
  Sparkles,
  Split,
  Swords,
  Trash2,
  Triangle,
  Tv,
  Video,
  Zap,
} from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  PRESET_SERVICES,
  type PresetService,
  SERVICE_CATEGORIES,
} from '../../constants/presetServices'
import * as api from '../../services/tauri'
import { useAppStore } from '../../stores/appStore'
import type {
  PortMapping,
  PortRule,
  PortRuleMatchType,
  PortRuleTargetType,
  ProxyNode,
} from '../../types'
import {
  Badge,
  Button,
  Input,
  Modal,
  Select,
  type SelectOption,
  Switch,
  toast,
} from '../common'
import { getLatencyColor } from '../../utils/proxy'
import { TrafficSnifferPanel } from './TrafficSnifferPanel'

interface PortRulesModalProps {
  isOpen: boolean
  onClose: () => void
  mapping: PortMapping | null
  mode?: 'port' | 'global'
}

export const ServiceIcon: React.FC<{
  iconKey?: string
  className?: string
}> = ({ iconKey, className = 'w-4 h-4' }) => {
  switch (iconKey) {
    case 'bot':
      return <Bot className={className} />
    case 'sparkles':
      return <Sparkles className={className} />
    case 'brain':
      return <Brain className={className} />
    case 'code-xml':
      return <CodeXml className={className} />
    case 'cpu':
      return <Cpu className={className} />
    case 'search-code':
      return <SearchCode className={className} />
    case 'zap':
      return <Zap className={className} />
    case 'image':
      return <Image className={className} />
    case 'smile':
      return <Smile className={className} />
    case 'twitter':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          className={className}
          aria-hidden="true"
        >
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      )
    case 'send':
      return <Send className={className} />
    case 'message-square':
      return <MessageSquare className={className} />
    case 'message-circle':
      return <MessageCircle className={className} />
    case 'camera':
      return <Camera className={className} />
    case 'share-2':
      return <Share2 className={className} />
    case 'at-sign':
      return <AtSign className={className} />
    case 'video':
      return <Video className={className} />
    case 'github':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          className={className}
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
          />
        </svg>
      )
    case 'container':
      return <Container className={className} />
    case 'book-open':
      return <BookOpen className={className} />
    case 'pen-tool':
      return <PenTool className={className} />
    case 'hash':
      return <Hash className={className} />
    case 'help-circle':
      return <HelpCircle className={className} />
    case 'triangle':
      return <Triangle className={className} />
    case 'play-square':
      return <PlaySquare className={className} />
    case 'film':
      return <Film className={className} />
    case 'music':
      return <Music className={className} />
    case 'tv':
      return <Tv className={className} />
    case 'radio':
      return <Radio className={className} />
    case 'gamepad-2':
      return <Gamepad2 className={className} />
    case 'swords':
      return <Swords className={className} />
    case 'play':
      return <Play className={className} />
    case 'library':
      return <Library className={className} />
    case 'shopping-cart':
      return <ShoppingCart className={className} />
    default:
      return <Globe className={className} />
  }
}
function getServiceTestUrl(
  preset: PresetService | null,
  customDomains: string,
): string | undefined {
  if (preset) {
    if (preset.id === 'google') return 'https://www.google.com/generate_204'
    if (preset.id === 'youtube') return 'https://www.youtube.com/generate_204'
    if (preset.id === 'openai') return 'https://chatgpt.com'
    if (preset.id === 'gemini') return 'https://gemini.google.com'
    if (preset.id === 'claude') return 'https://claude.ai'
    if (preset.id === 'github') return 'https://github.com'
    if (preset.id === 'twitter') return 'https://x.com'
    if (preset.id === 'telegram') return 'https://telegram.org'
    if (preset.id === 'steam') return 'https://store.steampowered.com'
    if (preset.domains.length > 0) return `https://${preset.domains[0]}`
  }
  if (customDomains.trim()) {
    const firstLine = customDomains
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)[0]
    if (firstLine) {
      if (firstLine.startsWith('http://') || firstLine.startsWith('https://')) {
        return firstLine
      }
      return `https://${firstLine.replace(/^\*\./, '')}`
    }
  }
  return undefined
}

export const PortRulesModal: React.FC<PortRulesModalProps> = ({
  isOpen,
  onClose,
  mapping,
  mode = 'port',
}) => {
  const {
    portMappings,
    profiles,
    profileNodes,
    config,
    fetchProfileNodes,
    savePortMapping,
    saveConfig,
    latencies,
    coreStatus,
  } = useAppStore()

  const isGlobal = mode === 'global'

  // 视图切换：'list' 列表视图 | 'add' 添加规则视图 | 'edit' 编辑规则视图
  const [view, setView] = useState<'list' | 'add' | 'edit'>('list')
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)

  // 规则列表草稿
  const [rules, setRules] = useState<PortRule[]>(
    isGlobal ? config?.globalRules || [] : mapping?.rules || [],
  )
  // 添加模式 Tab: 预置 | 自定义
  const [activeTab, setActiveTab] = useState<'preset' | 'custom'>('preset')
  const [selectedPresetId, setSelectedPresetId] = useState<string>('')

  // 自定义规则表单
  const [customName, setCustomName] = useState('')
  const [customDomains, setCustomDomains] = useState('')
  const [customMatchType, setCustomMatchType] =
    useState<PortRuleMatchType>('domain-suffix')

  // 目标出口设置
  const [targetType, setTargetType] = useState<PortRuleTargetType>('node')
  const [targetValue, setTargetValue] = useState<string>('')
  const [targetProfileId, setTargetProfileId] = useState<string>('')

  // 测速状态
  const [testingTarget, setTestingTarget] = useState(false)
  const [testResult, setTestResult] = useState<{
    success: boolean
    latency?: number
    errorMsg?: string
  } | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  // 选中的预置服务实体
  const selectedPreset = useMemo(() => {
    return PRESET_SERVICES.find((s) => s.id === selectedPresetId) || null
  }, [selectedPresetId])

  // 当前待测网站的真实测试 URL
  const currentTestUrl = useMemo(() => {
    return activeTab === 'preset'
      ? getServiceTestUrl(selectedPreset, '')
      : getServiceTestUrl(null, customDomains)
  }, [activeTab, selectedPreset, customDomains])

  // 当前目标网站名称用于展示
  const currentTargetSiteName = useMemo(() => {
    if (activeTab === 'preset') return selectedPreset?.name || ''
    const first = customDomains
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)[0]
    return customName.trim() || first || ''
  }, [activeTab, selectedPreset, customName, customDomains])

  // 是否满足测速条件：必须有目标网站 URL，且目标出口已选择，且非直连
  const canTestDelay = Boolean(
    currentTestUrl && targetValue && targetType !== 'direct',
  )
  // 返回列表并清空表单草稿
  const handleBackToList = useCallback(() => {
    setView('list')
    setEditingRuleId(null)
    setSelectedPresetId('')
    setCustomDomains('')
    setCustomName('')
    setTestResult(null)
  }, [])

  // 同步外部 mapping 规则
  useEffect(() => {
    if (!isOpen) return
    if (isGlobal) {
      setRules(config?.globalRules || [])
      handleBackToList()
    } else if (mapping) {
      setRules(mapping.rules || [])
      handleBackToList()
    }
  }, [isOpen, isGlobal, mapping, config?.globalRules, handleBackToList])

  // 将嗅探面板选中的域名追加到自定义规则匹配列表中
  const handleAppendSniffedDomains = useCallback(
    (domainsToAppend: string[], suggestedRuleName?: string) => {
      const existingLines = customDomains
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
      const seen = new Set(existingLines.map((s) => s.toLowerCase()))
      const added: string[] = []
      for (const domain of domainsToAppend) {
        const lower = domain.toLowerCase()
        if (!seen.has(lower)) {
          seen.add(lower)
          added.push(domain)
        }
      }
      if (added.length > 0) {
        const nextText = [...existingLines, ...added].join('\n')
        setCustomDomains(nextText)
        if (!customName.trim() && suggestedRuleName) {
          setCustomName(suggestedRuleName)
        }
        toast.success(`已追加 ${added.length} 个关联域名到匹配项列表`)
      }
    },
    [customDomains, customName],
  )
  // 确保所有 profile 节点已拉取
  useEffect(() => {
    if (isOpen) {
      for (const p of profiles) {
        if (!profileNodes[p.id]) {
          fetchProfileNodes(p.id).catch(() => {})
        }
      }
    }
  }, [isOpen, profiles, profileNodes, fetchProfileNodes])

  // 所有可用节点列表
  const allAvailableNodes = useMemo(() => {
    const list: (ProxyNode & { profileId: string; profileName: string })[] = []
    for (const p of profiles) {
      const nodes = profileNodes[p.id] || []
      for (const n of nodes) {
        list.push({
          ...n,
          profileId: p.id,
          profileName: p.name,
        })
      }
    }
    return list
  }, [profiles, profileNodes])

  // 节点下拉选项（按真实延迟升序排序：低延迟置顶）
  const nodeOptions = useMemo<SelectOption<string>[]>(() => {
    const getNodeLatency = (node: {
      name: string
      profileName?: string
      runtimeName?: string
      latency?: number | null
    }) => {
      const runtimeKey =
        node.runtimeName ||
        (node.profileName ? `[${node.profileName}] ${node.name}` : node.name)
      if (runtimeKey in latencies && latencies[runtimeKey] !== undefined) {
        return latencies[runtimeKey]
      }
      if (node.name in latencies && latencies[node.name] !== undefined) {
        return latencies[node.name]
      }
      return node.latency ?? null
    }

    const sortedNodes = [...allAvailableNodes].sort((a, b) => {
      const latA = getNodeLatency(a)
      const latB = getNodeLatency(b)

      const hasA = latA !== undefined && latA !== null && latA > 0
      const hasB = latB !== undefined && latB !== null && latB > 0

      if (hasA && hasB) {
        return (latA as number) - (latB as number)
      }
      if (hasA && !hasB) return -1
      if (!hasA && hasB) return 1

      return a.name.localeCompare(b.name, undefined, { numeric: true })
    })

    return sortedNodes.map((n) => {
      const lat = getNodeLatency(n)
      const hasLat = lat !== undefined && lat !== null && lat > 0

      return {
        value: `${n.profileId}:::${n.name}`,
        label: n.name,
        description: n.profileName ? `来自订阅: ${n.profileName}` : undefined,
        group: n.profileName || '默认订阅',
        searchTarget: `${n.profileName} ${n.name}`,
        rightNode: hasLat ? (
          <span
            className={`font-mono text-[11px] font-medium ${getLatencyColor(
              lat,
            )}`}
          >
            {lat} ms
          </span>
        ) : null,
      }
    })
  }, [allAvailableNodes, latencies])

  // 其他可用端口（全局模式包含所有非直连已启用端口，单端口模式排除自身和固定直连端口）
  const otherPorts = useMemo(() => {
    if (!isGlobal && !mapping) return []
    return portMappings.filter(
      (m) =>
        (isGlobal || m.id !== mapping?.id) &&
        m.id !== 'fixed-direct' &&
        m.nodeName !== 'DIRECT' &&
        m.enabled,
    )
  }, [portMappings, mapping, isGlobal])
  const portOptions = useMemo<SelectOption<string>[]>(() => {
    const getPortLatency = (p: PortMapping) => {
      const isFbActive = p.manualFallback && Boolean(p.fallbackNodeName)
      const activeNodeName = isFbActive ? p.fallbackNodeName! : p.nodeName
      const activeProfileId = isFbActive
        ? p.fallbackProfileId || p.profileId
        : p.profileId
      const prof = profiles.find((pr) => pr.id === activeProfileId)
      const runtimeKey = prof
        ? `[${prof.name}] ${activeNodeName}`
        : activeNodeName

      if (runtimeKey in latencies && latencies[runtimeKey] !== undefined) {
        return latencies[runtimeKey]
      }
      if (
        activeNodeName in latencies &&
        latencies[activeNodeName] !== undefined
      ) {
        return latencies[activeNodeName]
      }
      return p.latency ?? null
    }

    const sortedPorts = [...otherPorts].sort((a, b) => {
      const latA = getPortLatency(a)
      const latB = getPortLatency(b)

      const hasA = latA !== undefined && latA !== null && latA > 0
      const hasB = latB !== undefined && latB !== null && latB > 0

      if (hasA && hasB) {
        return (latA as number) - (latB as number)
      }
      if (hasA && !hasB) return -1
      if (!hasA && hasB) return 1

      return a.port - b.port
    })

    return sortedPorts.map((p) => {
      const isFbActive = p.manualFallback && Boolean(p.fallbackNodeName)
      const activeNodeName = isFbActive ? p.fallbackNodeName! : p.nodeName
      const activeProfileId = isFbActive
        ? p.fallbackProfileId || p.profileId
        : p.profileId
      const prof = profiles.find((pr) => pr.id === activeProfileId)
      const formattedNode = prof
        ? `[${prof.name}] ${activeNodeName}`
        : activeNodeName
      const hasFallback = Boolean(p.fallbackNodeName && !p.manualFallback)
      const lat = getPortLatency(p)
      const hasLat = lat !== undefined && lat !== null && lat > 0

      return {
        value: p.port.toString(),
        label: `端口 ${p.port} (出口: ${formattedNode})`,
        description: `入站: ${p.protocol.toUpperCase()}${
          hasFallback ? ' · 含主备自动容灾' : ''
        }`,
        searchTarget: `${p.port} ${formattedNode}`,
        rightNode: hasLat ? (
          <span
            className={`font-mono text-[11px] font-medium ${getLatencyColor(
              lat,
            )}`}
          >
            {lat} ms
          </span>
        ) : null,
      }
    })
  }, [otherPorts, profiles, latencies])
  // 获取目标端口当前活跃生效的出口节点名称
  const targetPortActiveNode = useMemo(() => {
    if (targetType !== 'port') return null
    const targetPort = otherPorts.find((p) => p.port.toString() === targetValue)
    if (!targetPort) return null
    const isFbActive =
      targetPort.manualFallback && Boolean(targetPort.fallbackNodeName)
    const activeNodeName = isFbActive
      ? targetPort.fallbackNodeName!
      : targetPort.nodeName
    const activeProfileId = isFbActive
      ? targetPort.fallbackProfileId || targetPort.profileId
      : targetPort.profileId
    const prof = profiles.find((pr) => pr.id === activeProfileId)
    const runtimeName = prof
      ? `[${prof.name}] ${activeNodeName}`
      : activeNodeName
    return {
      activeNodeName,
      runtimeName,
      portNumber: targetPort.port,
    }
  }, [targetType, targetValue, otherPorts, profiles])

  // 将 PRESET_SERVICES 转换为强大的 SelectOption
  const presetSelectOptions = useMemo<SelectOption<string>[]>(() => {
    return PRESET_SERVICES.map((s) => {
      const catLabel =
        SERVICE_CATEGORIES.find((c) => c.id === s.category)?.label || s.category
      const alreadyExists = rules.some((r) => r.name === s.name)
      return {
        value: s.id,
        label: s.name,
        disabled: alreadyExists,
        icon: (
          <div className="w-5 h-5 rounded-md bg-muted/80 flex items-center justify-center shrink-0 text-foreground border border-border/50">
            <ServiceIcon iconKey={s.iconKey} className="w-3.5 h-3.5" />
          </div>
        ),
        description: `${s.domains.slice(0, 3).join(', ')}${
          s.domains.length > 3 ? ' 等' : ''
        }`,
        rightNode: (
          <div className="flex items-center gap-1.5 shrink-0">
            {alreadyExists && (
              <Badge
                variant="secondary"
                className="text-[10px] font-normal py-0 px-1 text-muted-foreground"
              >
                已添加
              </Badge>
            )}
            <Badge
              variant="outline"
              className="text-[10px] font-normal py-0 px-1.5 shrink-0"
            >
              {catLabel}
            </Badge>
          </div>
        ),
        group: catLabel,
        searchTarget: `${s.name} ${s.domains.join(' ')} ${catLabel}`,
      }
    })
  }, [rules])

  // 初始化目标出口默认值
  const ensureDefaultTarget = () => {
    if (!targetValue && allAvailableNodes.length > 0) {
      const first = allAvailableNodes[0]
      setTargetType('node')
      setTargetProfileId(first.profileId || '')
      setTargetValue(first.name)
    }
  }

  // 切换目标出口类型
  const handleTargetTypeChange = (type: PortRuleTargetType) => {
    setTargetType(type)
    setTestResult(null)
    if (type === 'node') {
      if (allAvailableNodes.length > 0) {
        const first = allAvailableNodes[0]
        setTargetProfileId(first.profileId || '')
        setTargetValue(first.name)
      } else {
        setTargetValue('')
        setTargetProfileId('')
      }
    } else if (type === 'port') {
      if (otherPorts.length > 0) {
        setTargetValue(otherPorts[0].port.toString())
      } else {
        setTargetValue('')
      }
      setTargetProfileId('')
    } else {
      setTargetValue('DIRECT')
      setTargetProfileId('')
    }
  }

  // 实时测速（真实测试当前出口访问目标网站的延迟，严格遵从全局超时配置）
  const handleTestTargetDelay = async () => {
    if (!canTestDelay || !currentTestUrl || testingTarget) return
    setTestingTarget(true)
    setTestResult(null)
    const timeout = config?.timeoutMs || 3000
    try {
      if (targetType === 'node') {
        const selectedNode = allAvailableNodes.find(
          (n) =>
            n.name === targetValue &&
            (!targetProfileId || n.profileId === targetProfileId),
        )
        const nodeNameToTest = selectedNode?.runtimeName || targetValue
        const latency = await api.testNodeDelay(
          nodeNameToTest,
          currentTestUrl,
          timeout,
          true,
        )
        setTestResult({ success: true, latency })
      } else if (targetType === 'port' && targetPortActiveNode) {
        const latency = await api.testNodeDelay(
          targetPortActiveNode.runtimeName,
          currentTestUrl,
          timeout,
          true,
        )
        setTestResult({ success: true, latency })
      }
    } catch {
      // 超时/失败直接就地展示对称状态，不触发侵入式 Toast 报错
      setTestResult({ success: false, errorMsg: '访问超时' })
    } finally {
      setTestingTarget(false)
    }
  }
  // 添加规则
  const handleAddRule = () => {
    if (!targetValue) {
      toast.warning('请选择目标出口')
      return
    }

    let newRule: PortRule
    const ruleId = `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

    if (activeTab === 'preset') {
      if (!selectedPreset) {
        toast.warning('请选择要添加的常用网站')
        return
      }
      const duplicatePreset = rules.find((r) => r.name === selectedPreset.name)
      if (duplicatePreset) {
        toast.warning(`已存在【${selectedPreset.name}】规则`)
        return
      }
      newRule = {
        id: ruleId,
        name: selectedPreset.name,
        icon: selectedPreset.iconKey,
        matchType: selectedPreset.matchType,
        payloads: [...selectedPreset.domains],
        targetType,
        targetValue,
        targetProfileId: targetProfileId || undefined,
        enabled: true,
      }
    } else {
      const rawLines = customDomains
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
      if (rawLines.length === 0) {
        toast.warning('请输入至少一个域名或规则匹配项')
        return
      }
      const targetRuleName = customName.trim() || rawLines[0]
      const duplicateCustom = rules.find((r) => {
        const existingName = (r.name || r.payloads[0] || '')
          .trim()
          .toLowerCase()
        return existingName === targetRuleName.toLowerCase()
      })
      if (duplicateCustom) {
        toast.warning(`已存在名称为【${targetRuleName}】的规则`)
        return
      }
      newRule = {
        id: ruleId,
        name: targetRuleName,
        icon: 'globe',
        matchType: customMatchType,
        payloads: rawLines,
        targetType,
        targetValue,
        targetProfileId: targetProfileId || undefined,
        enabled: true,
      }
    }
    setRules((prev) => [newRule, ...prev])
    handleBackToList()
    toast.success(`已添加规则: ${newRule.name || '新规则'}`)
  }

  // 开启编辑规则
  const handleStartEditRule = (rule: PortRule) => {
    setEditingRuleId(rule.id)
    setTestResult(null)

    // 尝试匹配预置服务
    const matchedPreset = PRESET_SERVICES.find(
      (s) =>
        s.name === rule.name ||
        (s.iconKey === rule.icon &&
          s.domains.length === rule.payloads.length &&
          s.domains.every((d, i) => d === rule.payloads[i])),
    )

    if (matchedPreset) {
      setActiveTab('preset')
      setSelectedPresetId(matchedPreset.id)
      setCustomName('')
      setCustomDomains('')
      setCustomMatchType('domain-suffix')
    } else {
      setActiveTab('custom')
      setSelectedPresetId('')
      setCustomName(rule.name || '')
      setCustomDomains(rule.payloads.join('\n'))
      setCustomMatchType(rule.matchType)
    }

    // 目标出口设置
    setTargetType(rule.targetType)
    setTargetValue(rule.targetValue)
    setTargetProfileId(rule.targetProfileId || '')

    setView('edit')
  }

  // 保存修改规则
  const handleUpdateRule = () => {
    if (!editingRuleId) return
    if (!targetValue) {
      toast.warning('请选择目标出口')
      return
    }

    const currentRule = rules.find((r) => r.id === editingRuleId)
    if (!currentRule) return

    let updatedRule: PortRule
    if (activeTab === 'preset') {
      // 预置规则更新出口
      updatedRule = {
        ...currentRule,
        targetType,
        targetValue,
        targetProfileId: targetProfileId || undefined,
      }
    } else {
      // 自定义规则更新配置
      const rawLines = customDomains
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
      if (rawLines.length === 0) {
        toast.warning('请输入至少一个域名或规则匹配项')
        return
      }
      const targetRuleName = customName.trim() || rawLines[0]
      const duplicateCustom = rules.find((r) => {
        if (r.id === editingRuleId) return false
        const existingName = (r.name || r.payloads[0] || '')
          .trim()
          .toLowerCase()
        return existingName === targetRuleName.toLowerCase()
      })
      if (duplicateCustom) {
        toast.warning(`已存在名称为【${targetRuleName}】的规则`)
        return
      }
      updatedRule = {
        ...currentRule,
        name: targetRuleName,
        icon: 'globe',
        matchType: customMatchType,
        payloads: rawLines,
        targetType,
        targetValue,
        targetProfileId: targetProfileId || undefined,
      }
    }
    setRules((prev) =>
      prev.map((r) => (r.id === editingRuleId ? updatedRule : r)),
    )
    handleBackToList()
    toast.success(`已更新规则: ${updatedRule.name || '分流规则'}`)
  }

  // 删除规则
  const handleDeleteRule = (id: string) => {
    setRules((prev) => prev.filter((r) => r.id !== id))
  }

  // 启闭规则
  const handleToggleRule = (id: string, enabled: boolean) => {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled } : r)))
  }

  // 保存所有规则
  const handleSaveAll = async () => {
    if (!isGlobal && !mapping) return
    setIsSaving(true)
    try {
      if (isGlobal) {
        if (!config) return
        await saveConfig({
          ...config,
          globalRules: rules,
        })
        toast.success('全局网站分流规则已保存并热加载生效')
      } else if (mapping) {
        await savePortMapping({
          ...mapping,
          rules,
        })
        toast.success('网站分流规则已保存并热加载生效')
      }
      onClose()
    } catch (err) {
      toast.error(`保存失败: ${err}`)
    } finally {
      setIsSaving(false)
    }
  }

  if (!isGlobal && !mapping) return null

  const activeGlobalRulesCount = (config?.globalRules || []).filter(
    (r) => r.enabled,
  ).length

  // ================= 视图 1: 规则管理列表视图 =================
  if (view === 'list') {
    return (
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={
          isGlobal ? '全局网站分流规则' : `端口 ${mapping?.port} 网站分流规则`
        }
        subtitle={
          isGlobal
            ? `对所有代理监听端口生效 · 已配置 ${rules.length} 条全局规则`
            : `默认出口: ${mapping?.nodeName} · 已配置 ${rules.length} 条局部规则`
        }
        icon={<Split className="w-5 h-5 text-primary" />}
        maxWidth="xl"
        footer={
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditingRuleId(null)
                  setSelectedPresetId('')
                  setCustomDomains('')
                  setCustomName('')
                  setTestResult(null)
                  ensureDefaultTarget()
                  setView('add')
                }}
                className="gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                添加分流规则
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={onClose} disabled={isSaving}>
                取消
              </Button>
              <Button onClick={handleSaveAll} disabled={isSaving}>
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    保存中...
                  </>
                ) : (
                  '保存并生效'
                )}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          {rules.length === 0 ? (
            <div className="border border-dashed border-border/80 rounded-2xl p-10 text-center space-y-4 bg-muted/20">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary mx-auto flex items-center justify-center ring-8 ring-primary/5">
                <Split className="w-6 h-6" />
              </div>
              <div className="space-y-1.5 max-w-sm mx-auto">
                <div className="text-sm font-semibold text-foreground">
                  {isGlobal
                    ? '暂无全局网站分流规则'
                    : '暂无端口局部网站分流规则'}
                </div>
                <div className="text-xs text-muted-foreground leading-relaxed">
                  {isGlobal ? (
                    '配置全局网站分流后，所有代理端口在访问指定网站（如 Google Gemini、OpenAI、YouTube 等）时将统一走向指定出口；若某个端口单独配置了局部规则，局部规则将优先匹配生效。'
                  ) : (
                    <>
                      默认所有流量均从{' '}
                      <span className="font-mono text-foreground font-medium">
                        {mapping?.nodeName}
                      </span>{' '}
                      发出（或继承已启用的 {activeGlobalRulesCount}{' '}
                      条全局分流规则）。添加局部规则后，该端口将优先按局部规则转发指定网站。
                    </>
                  )}
                </div>
              </div>
              <Button
                onClick={() => {
                  setEditingRuleId(null)
                  setSelectedPresetId('')
                  setCustomDomains('')
                  setCustomName('')
                  setTestResult(null)
                  ensureDefaultTarget()
                  setView('add')
                }}
                className="gap-1.5 shadow-sm"
              >
                <Plus className="w-4 h-4" />
                立即添加网站分流
              </Button>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[58vh] overflow-y-auto pr-1">
              {rules.map((rule) => {
                let egressText = ''
                if (rule.targetType === 'direct') {
                  egressText = '直连 DIRECT'
                } else if (rule.targetType === 'port') {
                  const matchedPort = portMappings.find(
                    (p) => p.port.toString() === rule.targetValue,
                  )
                  egressText = `端口 ${rule.targetValue}${
                    matchedPort ? ` (${matchedPort.nodeName})` : ''
                  }`
                } else {
                  egressText = rule.targetValue
                }

                return (
                  <div
                    key={rule.id}
                    className={`p-3.5 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                      rule.enabled
                        ? 'bg-card border-border hover:border-border/80 shadow-xs'
                        : 'bg-muted/40 border-border/40 opacity-60'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-muted/80 flex items-center justify-center shrink-0 text-foreground border border-border/50">
                        <ServiceIcon iconKey={rule.icon} className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-foreground truncate">
                            {rule.name || rule.payloads[0]}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-muted text-muted-foreground font-mono">
                            {rule.matchType}
                          </span>
                        </div>
                        <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
                          <span>走向:</span>
                          <Badge
                            variant="outline"
                            className="text-[10px] font-mono py-0 px-1.5"
                          >
                            {egressText}
                          </Badge>
                          <span className="text-muted-foreground/40">·</span>
                          <span className="text-[10px]">
                            {rule.payloads.length} 项 ·{' '}
                            {rule.payloads.slice(0, 2).join(', ')}
                            {rule.payloads.length > 2 ? ' 等' : ''}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleStartEditRule(rule)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        title="修改规则"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <Switch
                        checked={rule.enabled}
                        onChange={(checked) =>
                          handleToggleRule(rule.id, checked)
                        }
                        size="sm"
                      />
                      <button
                        type="button"
                        onClick={() => handleDeleteRule(rule.id)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="删除规则"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </Modal>
    )
  }

  // ================= 视图 2: 添加/编辑网站分流视图 =================
  const isEditing = view === 'edit'
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        isEditing
          ? isGlobal
            ? '修改全局网站分流规则'
            : `修改端口 ${mapping?.port} 网站分流规则`
          : isGlobal
            ? '添加全局网站分流规则'
            : `为端口 ${mapping?.port} 添加网站分流`
      }
      subtitle={
        isEditing
          ? '调整该规则的配置与目标出口'
          : isGlobal
            ? '为全局流量配置目标网站的分流出口'
            : `为端口 ${mapping?.port} 配置目标网站的分流出口`
      }
      icon={<Split className="w-5 h-5 text-primary" />}
      maxWidth="lg"
      footer={
        <div className="flex items-center justify-between w-full">
          <Button
            variant="ghost"
            onClick={handleBackToList}
            className="gap-1.5"
          >
            <ArrowLeft className="w-4 h-4" />
            返回列表
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleBackToList}>
              取消
            </Button>
            <Button
              onClick={isEditing ? handleUpdateRule : handleAddRule}
              disabled={
                !targetValue ||
                (!isEditing && activeTab === 'preset' && !selectedPreset) ||
                (activeTab === 'custom' && !customDomains.trim())
              }
            >
              {isEditing ? '保存修改' : '确认添加此规则'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* 顶部模式切换：添加模式下显示切换微 Tab；编辑模式下锁定类型不可修改 */}
        {!isEditing ? (
          <div className="flex items-center gap-6 border-b border-border/60">
            <button
              type="button"
              onClick={() => {
                setActiveTab('preset')
                setTestResult(null)
              }}
              className={`pb-2.5 text-xs transition-colors relative ${
                activeTab === 'preset'
                  ? 'text-primary font-semibold'
                  : 'text-muted-foreground hover:text-foreground font-normal'
              }`}
            >
              常用网站预置
              {activeTab === 'preset' && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('custom')
                setTestResult(null)
              }}
              className={`pb-2.5 text-xs transition-colors relative ${
                activeTab === 'custom'
                  ? 'text-primary font-semibold'
                  : 'text-muted-foreground hover:text-foreground font-normal'
              }`}
            >
              自定义规则
              {activeTab === 'custom' && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
              )}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 pb-2 border-b border-border/60 text-xs">
            <span className="text-muted-foreground">规则类型:</span>
            <Badge variant="outline" className="font-normal text-xs py-0.5">
              {activeTab === 'preset' ? '常用网站' : '自定义规则'}
            </Badge>
          </div>
        )}

        {/* --- 1. 目标网站配置区域 --- */}
        {activeTab === 'preset' ? (
          <div className="space-y-2">
            <label
              htmlFor="preset-service-select"
              className="text-xs font-medium text-foreground block"
            >
              预置网站 / 服务
            </label>
            {isEditing ? (
              <div className="p-3 rounded-xl bg-muted/40 border border-border/60 text-xs space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground flex items-center gap-2 text-sm">
                    <div className="w-6 h-6 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                      <ServiceIcon
                        iconKey={selectedPreset?.iconKey}
                        className="w-3.5 h-3.5"
                      />
                    </div>
                    {selectedPreset?.name || '预置服务'}
                  </span>
                </div>
                {selectedPreset && (
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                    {selectedPreset.domains.map((dom) => (
                      <span
                        key={dom}
                        className="px-2 py-0.5 rounded-md bg-background border border-border/60 text-[10px] text-muted-foreground font-mono"
                      >
                        {dom}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                <Select
                  id="preset-service-select"
                  value={selectedPresetId}
                  onChange={(val) => setSelectedPresetId(val)}
                  options={presetSelectOptions}
                  placeholder="搜索或点选服务 (支持按名称、域名或分类模糊匹配)"
                  filterable
                  clearable
                  onClear={() => setSelectedPresetId('')}
                  className="h-10 text-xs w-full"
                />

                {/* 选中服务后紧凑展示关联域名 */}
                {selectedPreset && (
                  <div className="p-3 rounded-xl bg-primary/5 border border-primary/20 text-xs space-y-2 animate-fade-in">
                    <div className="flex items-center justify-between text-muted-foreground text-[11px]">
                      <span className="font-medium text-foreground flex items-center gap-1.5">
                        <ServiceIcon
                          iconKey={selectedPreset.iconKey}
                          className="w-3.5 h-3.5 text-primary"
                        />
                        {selectedPreset.name} 包含的规则域名 (
                        {selectedPreset.domains.length} 个):
                      </span>
                      <span>{selectedPreset.description}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                      {selectedPreset.domains.map((dom) => (
                        <span
                          key={dom}
                          className="px-2 py-0.5 rounded-md bg-background border border-border/60 text-[10px] text-muted-foreground font-mono"
                        >
                          {dom}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="custom-rule-name-input"
                  className="text-xs font-medium text-foreground block mb-1.5"
                >
                  规则名称
                </label>
                <Input
                  id="custom-rule-name-input"
                  placeholder="例如: 个人博客 / 公司内网 API"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
              <div>
                <label
                  htmlFor="custom-match-type-select"
                  className="text-xs font-medium text-foreground block mb-1.5"
                >
                  匹配模式
                </label>
                <Select
                  id="custom-match-type-select"
                  value={customMatchType}
                  onChange={(val) =>
                    setCustomMatchType(val as PortRuleMatchType)
                  }
                  options={[
                    {
                      value: 'domain-suffix',
                      label: '域名后缀 DOMAIN-SUFFIX',
                    },
                    {
                      value: 'domain',
                      label: '完整域名 DOMAIN',
                    },
                    {
                      value: 'domain-regex',
                      label: '正则表达式 DOMAIN-REGEX',
                    },
                    {
                      value: 'domain-keyword',
                      label: '域名关键词 DOMAIN-KEYWORD',
                    },
                    { value: 'ip-cidr', label: 'IP 网段 IP-CIDR' },
                  ]}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            <div className="space-y-2">
              <TrafficSnifferPanel
                isOpen={
                  isOpen &&
                  (view === 'add' || view === 'edit') &&
                  activeTab === 'custom'
                }
                isGlobal={isGlobal}
                mapping={mapping}
                coreRunning={coreStatus?.running ?? true}
                matchType={customMatchType}
                customDomains={customDomains}
                onAppendDomains={handleAppendSniffedDomains}
              />
              <textarea
                id="custom-domains-textarea"
                rows={3}
                placeholder={'example.com\napi.example.com\n192.168.1.0/24'}
                value={customDomains}
                onChange={(e) => setCustomDomains(e.target.value)}
                className="w-full rounded-xl border border-input bg-background p-3 text-xs font-mono shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring leading-relaxed"
              />
            </div>
          </div>
        )}

        {/* --- 2. 目标出口配置与原位测速 (紧凑 2 行流设计) --- */}
        <div className="p-4 rounded-xl border border-border bg-card space-y-3">
          {/* 第 1 行：左侧标题，右侧模式微胶囊并排 */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-foreground shrink-0">
              为该规则绑定目标出口:
            </span>

            {/* 出口模式微胶囊切换 */}
            <div className="flex items-center bg-muted/80 rounded-lg p-0.5 text-xs border border-border/50 shrink-0">
              <button
                type="button"
                onClick={() => handleTargetTypeChange('node')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  targetType === 'node'
                    ? 'bg-background text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                指定代理节点
              </button>
              {otherPorts.length > 0 && (
                <button
                  type="button"
                  onClick={() => handleTargetTypeChange('port')}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                    targetType === 'port'
                      ? 'bg-background text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  关联其他端口
                </button>
              )}
              <button
                type="button"
                onClick={() => handleTargetTypeChange('direct')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  targetType === 'direct'
                    ? 'bg-background text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                直连 DIRECT
              </button>
            </div>
          </div>

          {/* 第 2 行：全宽下拉选择器 + 紧凑测速按钮 */}
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              {targetType === 'node' && (
                <Select
                  value={
                    targetValue
                      ? `${targetProfileId}:::${targetValue}`
                      : nodeOptions[0]?.value || ''
                  }
                  onChange={(val) => {
                    const [pId, nName] = val.split(':::')
                    setTargetProfileId(pId || '')
                    setTargetValue(nName || '')
                    setTestResult(null)
                  }}
                  options={nodeOptions}
                  placeholder="选择代理节点"
                  filterable
                  className="h-9 text-xs w-full"
                />
              )}

              {targetType === 'port' && (
                <Select
                  value={targetValue}
                  onChange={(val) => {
                    setTargetValue(val)
                    setTestResult(null)
                  }}
                  options={portOptions}
                  placeholder="选择关联端口"
                  filterable
                  className="h-9 text-xs w-full"
                />
              )}

              {targetType === 'direct' && (
                <div className="h-9 px-3 rounded-lg bg-muted/40 border border-border/50 flex items-center text-xs text-muted-foreground font-mono">
                  DIRECT 直连公网
                </div>
              )}
            </div>

            {/* 测速按钮（仅非直连显示） */}
            {targetType !== 'direct' && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleTestTargetDelay}
                disabled={!canTestDelay || testingTarget}
                title={
                  !currentTestUrl
                    ? '请先在上方选择或输入目标网站'
                    : `测试当前出口访问 ${currentTargetSiteName} 的实际网络握手延迟`
                }
                className="h-9 shrink-0 gap-1.5 text-xs px-3"
              >
                <RotateCw
                  className={`w-3.5 h-3.5 ${
                    testingTarget ? 'animate-spin' : ''
                  }`}
                />
                {testingTarget ? '测速中...' : '测速网站'}
              </Button>
            )}
          </div>

          {/* 测速结果与说明辅助行 (成功与超时格式完全对称统一，绝不折叠挤爆) */}
          {targetType !== 'direct' && (
            <div className="flex items-center justify-between text-[11px] text-muted-foreground min-h-4">
              {testResult ? (
                testResult.success ? (
                  <div className="flex items-center gap-1.5 whitespace-nowrap overflow-hidden text-ellipsis">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                    <span className="text-foreground font-medium">
                      {currentTargetSiteName}
                    </span>
                    <span>访问延迟:</span>
                    <span className="font-mono font-semibold text-emerald-500">
                      {testResult.latency} ms
                    </span>
                    {targetPortActiveNode && (
                      <span className="text-muted-foreground/80 truncate">
                        (出口: {targetPortActiveNode.runtimeName})
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 whitespace-nowrap overflow-hidden text-ellipsis text-rose-500/90">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                    <span className="font-medium text-foreground">
                      {currentTargetSiteName}
                    </span>
                    <span className="font-medium">
                      {testResult.errorMsg || '访问超时'}
                    </span>
                    {targetPortActiveNode && (
                      <span className="text-muted-foreground/80 truncate">
                        (出口: {targetPortActiveNode.runtimeName})
                      </span>
                    )}
                  </div>
                )
              ) : !canTestDelay ? (
                <span className="text-muted-foreground/60">
                  需在上方选定目标网站方可进行访问测速
                </span>
              ) : (
                <span className="text-muted-foreground/60">
                  点击测速按钮可探测当前出口访问该网站的实际延迟 (超时上限{' '}
                  {config?.timeoutMs || 3000}ms)
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
