import { useTranslation } from '../../i18n'
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  PRESET_SERVICES,
  type PresetService,
  presetServiceI18nKey,
  SERVICE_CATEGORIES,
} from '../../constants/presetServices'
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
import { SpeedSelect } from './SpeedSelect'
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

function findPresetForRule(rule: PortRule): PresetService | undefined {
  return PRESET_SERVICES.find((service) => service.name === rule.name)
}

/** 同步下拉选项的单行测速状态（按 option.value 标记/清除） */
function updateTestingValue(
  setter: React.Dispatch<React.SetStateAction<Record<string, boolean>>>,
  value: string,
  active: boolean,
) {
  setter((prev) => {
    const next = { ...prev }
    if (active) {
      next[value] = true
    } else {
      delete next[value]
    }
    return next
  })
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
    testNodeDelay,
    testAllNodesDelay,
    testPortDelay,
  } = useAppStore()

  const isGlobal = mode === 'global'

  const { t } = useTranslation()

  // 预置服务与分类文案按 id 映射到当前语言；词条缺失时回退到内置名称/描述
  const presetDisplayName = useCallback(
    (preset: PresetService) => {
      const key = presetServiceI18nKey(preset.id, 'name')
      const text = t(key)
      return text === key ? preset.name : text
    },
    [t],
  )
  const presetDisplayDescription = useCallback(
    (preset: PresetService) => {
      const key = presetServiceI18nKey(preset.id, 'description')
      const text = t(key)
      return text === key ? preset.description : text
    },
    [t],
  )
  const categoryDisplayLabel = useCallback(
    (category: PresetService['category'] | 'all') => {
      const matched = SERVICE_CATEGORIES.find((c) => c.id === category)
      if (!matched) return category
      const text = t(matched.labelKey)
      return text === matched.labelKey ? category : text
    },
    [t],
  )

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
  const [testingNodeValues, setTestingNodeValues] = useState<
    Record<string, boolean>
  >({})
  const [testingPortValues, setTestingPortValues] = useState<
    Record<string, boolean>
  >({})
  const [isBatchTestingNodes, setIsBatchTestingNodes] = useState(false)
  const [isBatchTestingPorts, setIsBatchTestingPorts] = useState(false)
  // 同步防重入：批量探测尚未渲染出禁用态时再次点击也不会重复发起
  const nodeBatchRunningRef = useRef(false)
  const portBatchRunningRef = useRef(false)
  // 下拉内任意测速进行中时，批量按钮一并禁用
  const isNodeTesting =
    isBatchTestingNodes || Object.keys(testingNodeValues).length > 0
  const isPortTesting =
    isBatchTestingPorts || Object.keys(testingPortValues).length > 0
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
    if (activeTab === 'preset') {
      return selectedPreset ? presetDisplayName(selectedPreset) : ''
    }
    const first = customDomains
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)[0]
    return customName.trim() || first || ''
  }, [activeTab, selectedPreset, customName, customDomains, presetDisplayName])

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
        toast.success(t('rules.appendedDomains', { count: added.length }))
      }
    },
    [customDomains, customName, t],
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

  // 节点在 Mihomo 内核中的真实运行时名称（测速与延迟缓存均以此为准）
  const nodeRuntimeName = useCallback(
    (node: { name: string; profileName?: string; runtimeName?: string }) =>
      node.runtimeName ||
      (node.profileName ? `[${node.profileName}] ${node.name}` : node.name),
    [],
  )

  // 节点下拉选项（按真实延迟升序排序：低延迟置顶）
  const nodeOptions = useMemo<SelectOption<string>[]>(() => {
    const getNodeLatency = (node: {
      name: string
      profileName?: string
      runtimeName?: string
      latency?: number | null
    }) => {
      const runtimeKey = nodeRuntimeName(node)
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
        description: n.profileName
          ? t('rules.fromProfile', { name: n.profileName })
          : undefined,
        group: n.profileName || t('rules.defaultProfile'),
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
  }, [allAvailableNodes, latencies, t, nodeRuntimeName])

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
      // 经真实监听端口测得的链路延迟优先展示（住宅链路仅此来源）
      if (p.latency !== undefined && p.latency !== null && p.latency > 0) {
        return p.latency
      }
      if (p.residentialProxyId) {
        return null
      }
      const isFbActive = p.manualFallback && Boolean(p.fallbackNodeName)
      const activeNodeName = isFbActive ? p.fallbackNodeName! : p.nodeName
      const activeProfileId = isFbActive
        ? p.fallbackProfileId || p.profileId
        : p.profileId
      const prof = profiles.find((pr) => pr.id === activeProfileId)
      const activeNode = profileNodes[activeProfileId]?.find(
        (n) => n.name === activeNodeName,
      )
      const runtimeKey = activeNode
        ? nodeRuntimeName(activeNode)
        : prof
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
      const residential = p.residentialProxyId
        ? (config?.residentialProxies?.find(
            (proxy) => proxy.id === p.residentialProxyId,
          ) ?? null)
        : null
      const isFbActive =
        !residential && p.manualFallback && Boolean(p.fallbackNodeName)
      const activeNodeName = isFbActive ? p.fallbackNodeName! : p.nodeName
      const activeProfileId = isFbActive
        ? p.fallbackProfileId || p.profileId
        : p.profileId
      const prof = profiles.find((pr) => pr.id === activeProfileId)
      const formattedNode = residential
        ? residential.name
        : prof
          ? `[${prof.name}] ${activeNodeName}`
          : activeNodeName
      const hasFallback = Boolean(
        !residential && p.fallbackNodeName && !p.manualFallback,
      )
      const lat = getPortLatency(p)
      const hasLat = lat !== undefined && lat !== null && lat > 0

      return {
        value: p.port.toString(),
        label: t('rules.portOptionLabel', {
          port: p.port,
          node: formattedNode,
        }),
        description: t('rules.portOptionDesc', {
          protocol: p.protocol.toUpperCase(),
          fallback: hasFallback ? t('rules.portOptionFallback') : '',
        }),
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
  }, [
    otherPorts,
    profiles,
    profileNodes,
    latencies,
    config?.residentialProxies,
    t,
    nodeRuntimeName,
  ])
  // 获取目标端口当前活跃生效的出口名称
  const targetPortExitName = useMemo(() => {
    if (targetType !== 'port') return null
    const targetPort = otherPorts.find((p) => p.port.toString() === targetValue)
    if (!targetPort) return null
    // 住宅链路真实出口为住宅代理，而非上游节点
    const residential = targetPort.residentialProxyId
      ? (config?.residentialProxies?.find(
          (proxy) => proxy.id === targetPort.residentialProxyId,
        ) ?? null)
      : null
    const isFbActive =
      !residential &&
      targetPort.manualFallback &&
      Boolean(targetPort.fallbackNodeName)
    const activeNodeName = isFbActive
      ? targetPort.fallbackNodeName!
      : targetPort.nodeName
    const activeProfileId = isFbActive
      ? targetPort.fallbackProfileId || targetPort.profileId
      : targetPort.profileId
    const prof = profiles.find((pr) => pr.id === activeProfileId)
    const activeNode = profileNodes[activeProfileId]?.find(
      (n) => n.name === activeNodeName,
    )
    return residential
      ? residential.name
      : activeNode
        ? nodeRuntimeName(activeNode)
        : prof
          ? `[${prof.name}] ${activeNodeName}`
          : activeNodeName
  }, [
    targetType,
    targetValue,
    otherPorts,
    profiles,
    profileNodes,
    config?.residentialProxies,
    nodeRuntimeName,
  ])

  // 目标网站访问测速的超时上限（严格遵从全局配置）
  const testTimeoutMs = config?.timeoutMs || 3000

  // 单项测速：节点按运行时名称直达内核，端口按真实监听端口测完整链路
  const handleTestNodeOption = useCallback(
    async (option: SelectOption<string>) => {
      if (
        isBatchTestingNodes ||
        nodeBatchRunningRef.current ||
        testingNodeValues[option.value]
      )
        return
      const node = allAvailableNodes.find(
        (n) => `${n.profileId}:::${n.name}` === option.value,
      )
      if (!node) return
      updateTestingValue(setTestingNodeValues, option.value, true)
      try {
        const latency = await testNodeDelay(
          nodeRuntimeName(node),
          currentTestUrl,
          testTimeoutMs,
        )
        if (latency === null) toast.error(t('rules.testTimeout'))
      } finally {
        updateTestingValue(setTestingNodeValues, option.value, false)
      }
    },
    [
      allAvailableNodes,
      currentTestUrl,
      testTimeoutMs,
      testNodeDelay,
      nodeRuntimeName,
      isBatchTestingNodes,
      testingNodeValues,
      t,
    ],
  )

  // 批量测速：仅测试当前过滤结果中真实存在的节点，去重后交给 store 并发探测
  const handleTestNodeOptions = useCallback(
    async (options: SelectOption<string>[]) => {
      const testable = options.flatMap((option) => {
        const node = allAvailableNodes.find(
          (n) => `${n.profileId}:::${n.name}` === option.value,
        )
        return node ? [{ option, node }] : []
      })
      if (testable.length === 0 || isNodeTesting || nodeBatchRunningRef.current)
        return
      nodeBatchRunningRef.current = true
      setIsBatchTestingNodes(true)
      for (const entry of testable) {
        updateTestingValue(setTestingNodeValues, entry.option.value, true)
      }
      try {
        const results = await testAllNodesDelay(
          [...new Set(testable.map((entry) => nodeRuntimeName(entry.node)))],
          currentTestUrl,
          testTimeoutMs,
        )
        if (
          results.length > 0 &&
          results.every(
            (result) => result.latency === null || result.latency === undefined,
          )
        ) {
          toast.error(t('rules.testTimeout'))
        }
      } finally {
        nodeBatchRunningRef.current = false
        setIsBatchTestingNodes(false)
        for (const entry of testable) {
          updateTestingValue(setTestingNodeValues, entry.option.value, false)
        }
      }
    },
    [
      allAvailableNodes,
      currentTestUrl,
      testTimeoutMs,
      testAllNodesDelay,
      nodeRuntimeName,
      isNodeTesting,
      t,
    ],
  )

  // 单项测速：走真实监听端口，住宅链路因此包含「上游 → 住宅出口」全链路
  const handleTestPortOption = useCallback(
    async (option: SelectOption<string>) => {
      if (
        isBatchTestingPorts ||
        portBatchRunningRef.current ||
        testingPortValues[option.value]
      )
        return
      const targetPort = otherPorts.find(
        (p) => p.port.toString() === option.value,
      )
      if (!targetPort) return
      updateTestingValue(setTestingPortValues, option.value, true)
      try {
        const latency = await testPortDelay(
          targetPort.id,
          currentTestUrl,
          testTimeoutMs,
        )
        if (latency === null) toast.error(t('rules.testTimeout'))
      } finally {
        updateTestingValue(setTestingPortValues, option.value, false)
      }
    },
    [
      otherPorts,
      currentTestUrl,
      testTimeoutMs,
      testPortDelay,
      isBatchTestingPorts,
      testingPortValues,
      t,
    ],
  )

  // 批量测速：逐个通过真实监听端口探测，过滤结果中不存在的端口直接跳过
  const handleTestPortOptions = useCallback(
    async (options: SelectOption<string>[]) => {
      const testable = options.flatMap((option) => {
        const targetPort = otherPorts.find(
          (p) => p.port.toString() === option.value,
        )
        return targetPort ? [{ option, targetPort }] : []
      })
      if (testable.length === 0 || isPortTesting || portBatchRunningRef.current)
        return
      portBatchRunningRef.current = true
      setIsBatchTestingPorts(true)
      for (const entry of testable) {
        updateTestingValue(setTestingPortValues, entry.option.value, true)
      }
      try {
        const results = await Promise.all(
          testable.map((entry) =>
            testPortDelay(entry.targetPort.id, currentTestUrl, testTimeoutMs),
          ),
        )
        if (
          results.length > 0 &&
          results.every((latency) => latency === null)
        ) {
          toast.error(t('rules.testTimeout'))
        }
      } finally {
        portBatchRunningRef.current = false
        setIsBatchTestingPorts(false)
        for (const entry of testable) {
          updateTestingValue(setTestingPortValues, entry.option.value, false)
        }
      }
    },
    [
      otherPorts,
      currentTestUrl,
      testTimeoutMs,
      testPortDelay,
      isPortTesting,
      t,
    ],
  )

  // 将 PRESET_SERVICES 转换为强大的 SelectOption（展示文案随语言切换）
  const presetSelectOptions = useMemo<SelectOption<string>[]>(() => {
    return PRESET_SERVICES.map((s) => {
      const catLabel = categoryDisplayLabel(s.category)
      const displayName = presetDisplayName(s)
      const alreadyExists = rules.some((r) => r.name === s.name)
      return {
        value: s.id,
        label: displayName,
        disabled: alreadyExists,
        icon: (
          <div className="w-5 h-5 rounded-md bg-muted/80 flex items-center justify-center shrink-0 text-foreground border border-border/50">
            <ServiceIcon iconKey={s.iconKey} className="w-3.5 h-3.5" />
          </div>
        ),
        description: `${s.domains.slice(0, 3).join(', ')}${
          s.domains.length > 3 ? t('rules.etcShort') : ''
        }`,
        rightNode: (
          <div className="flex items-center gap-1.5 shrink-0">
            {alreadyExists && (
              <Badge
                variant="secondary"
                className="text-[10px] font-normal py-0 px-1 text-muted-foreground"
              >
                {t('rules.addedBadge')}
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
        searchTarget: `${displayName} ${s.name} ${s.domains.join(' ')} ${catLabel}`,
      }
    })
  }, [rules, presetDisplayName, categoryDisplayLabel, t])

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
    try {
      let latency: number | null = null
      if (targetType === 'node') {
        const selectedNode = allAvailableNodes.find(
          (n) =>
            n.name === targetValue &&
            (!targetProfileId || n.profileId === targetProfileId),
        )
        if (selectedNode) {
          latency = await testNodeDelay(
            nodeRuntimeName(selectedNode),
            currentTestUrl,
            testTimeoutMs,
          )
        }
      } else if (targetType === 'port') {
        const targetPort = otherPorts.find(
          (p) => p.port.toString() === targetValue,
        )
        // 端口出口必须经真实监听端口测速，住宅链路才能覆盖完整出口路径
        if (targetPort) {
          latency = await testPortDelay(
            targetPort.id,
            currentTestUrl,
            testTimeoutMs,
          )
        }
      }
      if (latency === null) {
        setTestResult({ success: false, errorMsg: t('rules.testTimeout') })
      } else {
        setTestResult({ success: true, latency })
      }
    } catch {
      // 超时/失败直接就地展示对称状态，不触发侵入式 Toast 报错
      setTestResult({ success: false, errorMsg: t('rules.testTimeout') })
    } finally {
      setTestingTarget(false)
    }
  }
  // 添加规则
  const handleAddRule = () => {
    if (!targetValue) {
      toast.warning(t('rules.warnSelectTarget'))
      return
    }

    let newRule: PortRule
    const ruleId = `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

    if (activeTab === 'preset') {
      if (!selectedPreset) {
        toast.warning(t('rules.warnSelectPreset'))
        return
      }
      const duplicatePreset = rules.find((r) => r.name === selectedPreset.name)
      if (duplicatePreset) {
        toast.warning(
          t('rules.warnPresetExists', {
            name: presetDisplayName(selectedPreset),
          }),
        )
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
        toast.warning(t('rules.warnEnterPayload'))
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
        toast.warning(t('rules.warnNameExists', { name: targetRuleName }))
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
    toast.success(
      t('rules.ruleAdded', {
        name:
          (activeTab === 'preset' && selectedPreset
            ? presetDisplayName(selectedPreset)
            : newRule.name) || t('rules.newRuleDefault'),
      }),
    )
  }

  // 开启编辑规则
  const handleStartEditRule = (rule: PortRule) => {
    setEditingRuleId(rule.id)
    setTestResult(null)

    // 尝试匹配预置服务
    const matchedPreset = findPresetForRule(rule)

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
      toast.warning(t('rules.warnSelectTarget'))
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
        toast.warning(t('rules.warnEnterPayload'))
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
        toast.warning(t('rules.warnNameExists', { name: targetRuleName }))
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
    toast.success(
      t('rules.ruleUpdated', {
        name:
          (activeTab === 'preset' && selectedPreset
            ? presetDisplayName(selectedPreset)
            : updatedRule.name) || t('rules.ruleDefault'),
      }),
    )
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
    if (!isGlobal && mapping?.residentialProxyId) {
      toast.warning(t('rules.chainUnsupported'))
      return
    }
    setIsSaving(true)
    try {
      if (isGlobal) {
        if (!config) return
        await saveConfig({
          ...config,
          globalRules: rules,
        })
        toast.success(t('rules.globalSaved'))
      } else if (mapping) {
        await savePortMapping({
          ...mapping,
          rules,
        })
        toast.success(t('rules.localSaved'))
      }
      onClose()
    } catch (err) {
      toast.error(t('rules.saveFailed', { err: String(err) }))
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
          isGlobal
            ? t('rules.globalTitle')
            : t('rules.localTitle', { port: mapping?.port ?? '' })
        }
        subtitle={
          isGlobal
            ? t('rules.globalSubtitle', { count: rules.length })
            : t('rules.localSubtitle', {
                node: mapping?.nodeName ?? '',
                count: rules.length,
              })
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
                {t('rules.addRuleBtn')}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={onClose} disabled={isSaving}>
                {t('common.cancel')}
              </Button>
              <Button onClick={handleSaveAll} disabled={isSaving}>
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    {t('common.saving')}
                  </>
                ) : (
                  t('rules.saveAndApply')
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
                    ? t('rules.emptyGlobalTitle')
                    : t('rules.emptyLocalTitle')}
                </div>
                <div className="text-xs text-muted-foreground leading-relaxed">
                  {isGlobal
                    ? t('rules.emptyGlobalDesc')
                    : t('rules.emptyLocalDesc', {
                        node: mapping?.nodeName ?? '',
                        count: activeGlobalRulesCount,
                      })}
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
                {t('rules.addFirstRuleBtn')}
              </Button>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[58vh] overflow-y-auto pr-1">
              {rules.map((rule) => {
                let egressText = ''
                if (rule.targetType === 'direct') {
                  egressText = t('rules.directEgressText')
                } else if (rule.targetType === 'port') {
                  const matchedPort = portMappings.find(
                    (p) => p.port.toString() === rule.targetValue,
                  )
                  egressText = `${t('rules.portEgressText', { port: rule.targetValue })}${
                    matchedPort ? ` (${matchedPort.nodeName})` : ''
                  }`
                } else {
                  egressText = rule.targetValue
                }

                // 已保存规则仅存储规范名称，展示时按预置 id 映射当前语言
                const matchedPreset = findPresetForRule(rule)
                const ruleDisplayName = matchedPreset
                  ? presetDisplayName(matchedPreset)
                  : rule.name || rule.payloads[0]

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
                            {ruleDisplayName}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-muted text-muted-foreground font-mono">
                            {rule.matchType}
                          </span>
                        </div>
                        <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
                          <span>{t('rules.targetPrefix')}</span>
                          <Badge
                            variant="outline"
                            className="text-[10px] font-mono py-0 px-1.5"
                          >
                            {egressText}
                          </Badge>
                          <span className="text-muted-foreground/40">·</span>
                          <span className="text-[10px]">
                            {t('rules.itemsCount', {
                              count: rule.payloads.length,
                            })}
                            {rule.payloads.slice(0, 2).join(', ')}
                            {rule.payloads.length > 2
                              ? t('rules.etcShort')
                              : ''}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleStartEditRule(rule)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        title={t('rules.editRuleTitle')}
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
                        title={t('rules.deleteRuleTitle')}
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
            ? t('rules.editGlobalTitle')
            : t('rules.editLocalTitle', { port: mapping?.port ?? '' })
          : isGlobal
            ? t('rules.addGlobalTitle')
            : t('rules.addLocalTitle', { port: mapping?.port ?? '' })
      }
      subtitle={
        isEditing
          ? t('rules.editSubtitle')
          : isGlobal
            ? t('rules.addGlobalSubtitle')
            : t('rules.addLocalSubtitle', { port: mapping?.port ?? '' })
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
            {t('rules.backToList')}
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleBackToList}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={isEditing ? handleUpdateRule : handleAddRule}
              disabled={
                !targetValue ||
                (!isEditing && activeTab === 'preset' && !selectedPreset) ||
                (activeTab === 'custom' && !customDomains.trim())
              }
            >
              {isEditing ? t('addPort.saveChanges') : t('rules.confirmAddRule')}
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
              {t('rules.tabPreset')}
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
              {t('rules.tabCustom')}
              {activeTab === 'custom' && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
              )}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 pb-2 border-b border-border/60 text-xs">
            <span className="text-muted-foreground">
              {t('rules.ruleTypeLabel')}
            </span>
            <Badge variant="outline" className="font-normal text-xs py-0.5">
              {activeTab === 'preset'
                ? t('rules.tabPreset')
                : t('rules.tabCustom')}
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
              {t('rules.presetServiceLabel')}
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
                    {selectedPreset
                      ? presetDisplayName(selectedPreset)
                      : t('rules.presetServiceFallback')}
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
                  placeholder={t('rules.presetSearchPlaceholder')}
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
                        {t('rules.presetDomainsLabel', {
                          name: presetDisplayName(selectedPreset),
                          count: selectedPreset.domains.length,
                        })}
                      </span>
                      <span>{presetDisplayDescription(selectedPreset)}</span>
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
                  {t('rules.customNameLabel')}
                </label>
                <Input
                  id="custom-rule-name-input"
                  placeholder={t('rules.customNamePlaceholder')}
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
                  {t('rules.matchTypeLabel')}
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
                      label: t('rules.matchDomainSuffix'),
                    },
                    {
                      value: 'domain',
                      label: t('rules.matchDomain'),
                    },
                    {
                      value: 'domain-regex',
                      label: t('rules.matchDomainRegex'),
                    },
                    {
                      value: 'domain-keyword',
                      label: t('rules.matchDomainKeyword'),
                    },
                    { value: 'ip-cidr', label: t('rules.matchIpCidr') },
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
                portMappings={portMappings}
                profiles={profiles}
                residentialProxies={config?.residentialProxies}
                latencies={latencies}
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
              {t('rules.bindTargetLabel')}
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
                {t('rules.targetNode')}
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
                  {t('rules.targetPort')}
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
                {t('rules.targetDirect')}
              </button>
            </div>
          </div>

          {/* 第 2 行：全宽下拉选择器 + 紧凑测速按钮 */}
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              {targetType === 'node' && (
                <SpeedSelect
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
                  placeholder={t('rules.selectNodePlaceholder')}
                  filterable
                  className="h-9 text-xs w-full"
                  testOption={handleTestNodeOption}
                  testOptions={handleTestNodeOptions}
                  isTesting={isNodeTesting}
                  testingValues={testingNodeValues}
                />
              )}

              {targetType === 'port' && (
                <SpeedSelect
                  value={targetValue}
                  onChange={(val) => {
                    setTargetValue(val)
                    setTestResult(null)
                  }}
                  options={portOptions}
                  placeholder={t('rules.selectPortPlaceholder')}
                  filterable
                  className="h-9 text-xs w-full"
                  testOption={handleTestPortOption}
                  testOptions={handleTestPortOptions}
                  isTesting={isPortTesting}
                  testingValues={testingPortValues}
                />
              )}

              {targetType === 'direct' && (
                <div className="h-9 px-3 rounded-lg bg-muted/40 border border-border/50 flex items-center text-xs text-muted-foreground font-mono">
                  {t('rules.directPublicLabel')}
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
                    ? t('rules.testBtnSelectSiteFirst')
                    : t('rules.testBtnTitle', { site: currentTargetSiteName })
                }
                className="h-9 shrink-0 gap-1.5 text-xs px-3"
              >
                <RotateCw
                  className={`w-3.5 h-3.5 ${
                    testingTarget ? 'animate-spin' : ''
                  }`}
                />
                {testingTarget ? t('rules.testingBtn') : t('rules.testBtn')}
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
                    <span>{t('rules.testLatencyLabel')}</span>
                    <span className="font-mono font-semibold text-emerald-500">
                      {testResult.latency} ms
                    </span>
                    {targetPortExitName && (
                      <span className="text-muted-foreground/80 truncate">
                        {t('rules.testExitSuffix', {
                          node: targetPortExitName,
                        })}
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
                      {testResult.errorMsg || t('rules.testTimeout')}
                    </span>
                    {targetPortExitName && (
                      <span className="text-muted-foreground/80 truncate">
                        {t('rules.testExitSuffix', {
                          node: targetPortExitName,
                        })}
                      </span>
                    )}
                  </div>
                )
              ) : !canTestDelay ? (
                <span className="text-muted-foreground/60">
                  {t('rules.testHintNoSite')}
                </span>
              ) : (
                <span className="text-muted-foreground/60">
                  {t('rules.testHintReady', {
                    timeout: config?.timeoutMs || 3000,
                  })}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
