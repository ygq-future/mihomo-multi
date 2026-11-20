import {
  AlertCircle,
  ArrowUpDown,
  Compass,
  Copy,
  FileCode,
  Gauge,
  Globe,
  Layers,
  Loader2,
  Network,
  Search,
  X,
  Zap,
} from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../stores/appStore'
import { useTranslation } from '../../i18n'
import type { DirectEgressInfo, ProxyNode } from '../../types'
import {
  extractRegion,
  formatProtocolName,
  getLatencyBadgeProps,
  getProtocolBadgeProps,
  isNodeEgressProbing,
  lookupNodeEgressInfo,
} from '../../utils/proxy'
import {
  Badge,
  Button,
  Input,
  MultiSelect,
  type MultiSelectOption,
  RegionFlag,
  Select,
  toast,
} from '../common'
import { AddPortModal } from '../ports/AddPortModal'

type SortOption = 'default' | 'latency-asc' | 'latency-desc' | 'name-asc'

interface AugmentedNode extends ProxyNode {
  profileId: string
  profileName: string
  region: ReturnType<typeof extractRegion>
}

interface ProxyNodeCardProps {
  node: AugmentedNode
  latency: number | null | undefined
  isTesting: boolean
  isTestingAll: boolean
  isBound: boolean
  boundPort?: number
  egressInfo?: DirectEgressInfo | null
  isProbingEgress: boolean
  onTestDelay: (nodeKey: string) => void
  onCopyEgressIp: (node: AugmentedNode) => void
  onQuickBind: (target: { profileId: string; nodeName: string }) => void
}

const ProxyNodeCard = React.memo<ProxyNodeCardProps>(
  ({
    node,
    latency,
    isTesting,
    isTestingAll,
    isBound,
    boundPort,
    egressInfo,
    isProbingEgress,
    onTestDelay,
    onCopyEgressIp,
    onQuickBind,
  }) => {
    const { t } = useTranslation()
    const nodeKey = node.runtimeName || node.name
    const latencyProps = getLatencyBadgeProps(latency, isTesting)
    const protocolProps = getProtocolBadgeProps(node.type)

    return (
      <div className="proxy-node-card p-2.5 rounded-xl border border-border bg-card hover:border-primary/40 hover:shadow-sm transition-[border-color,box-shadow] flex flex-col justify-between space-y-2 group [contain:layout_style] [content-visibility:auto] [contain-intrinsic-size:84px]">
        {/* Top Row: Region Flag (fixed) + Node Name (flex-1) + Profile Name (fixed right) */}
        <div className="flex items-center gap-1.5 min-w-0">
          <RegionFlag code={node.region.code} size="md" />
          <div className="relative flex items-center flex-1 min-w-0 group/name">
            <span
              className="truncate font-semibold text-xs text-foreground flex-1 min-w-0"
              title={node.name}
            >
              {node.name}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onCopyEgressIp(node)
              }}
              disabled={isProbingEgress}
              className={`absolute right-0 top-1/2 -translate-y-1/2 z-10 inline-flex items-center gap-1 h-5 px-2 rounded-md text-[10px] leading-none font-semibold bg-primary text-primary-foreground hover:opacity-90 shadow-md cursor-pointer disabled:opacity-70 transition-all duration-200 ease-out ${
                isProbingEgress
                  ? 'opacity-100 scale-100 translate-x-0 pointer-events-auto'
                  : 'opacity-0 scale-95 translate-x-1 pointer-events-none group-hover/name:opacity-100 group-hover/name:scale-100 group-hover/name:translate-x-0 group-hover/name:pointer-events-auto'
              }`}
              title={
                isProbingEgress
                  ? t('proxies.detectingIpTitle')
                  : egressInfo
                    ? t('proxies.copyIpTitle', {
                        ip: egressInfo.ip,
                        region: ` (${egressInfo.region || t('common.unknown')})`,
                      })
                    : t('proxies.detectIpTitle')
              }
            >
              {isProbingEgress ? (
                <>
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  <span>{t('proxies.detectingIp')}</span>
                </>
              ) : (
                <>
                  <Copy className="w-2.5 h-2.5" />
                  <span>{t('proxies.copyIp')}</span>
                </>
              )}
            </button>
          </div>
          <span
            className="shrink-0 max-w-[85px] truncate text-right text-[10px] text-muted-foreground/80"
            title={node.profileName}
          >
            {node.profileName}
          </span>
        </div>

        {/* Bottom Row: Protocol Badge (left) + Latency & Bind Action (right) */}
        <div className="pt-2 border-t border-border/50 flex items-center justify-between gap-1.5 text-[11px]">
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium border shrink-0 ${protocolProps.className}`}
          >
            {protocolProps.label}
          </span>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Latency Badge (Clickable for Single Speed Test) */}
            <button
              type="button"
              onClick={() => onTestDelay(nodeKey)}
              disabled={isTesting || isTestingAll}
              className="focus:outline-none"
              title={
                isTesting
                  ? t('proxies.testingTitle')
                  : t('proxies.testSingleTitle')
              }
            >
              <Badge
                variant={latencyProps.variant}
                size="sm"
                dot={latencyProps.dot}
                className="cursor-pointer hover:opacity-80 font-mono transition-opacity !text-[10px] !py-0.5 !px-1.5 min-w-[36px] justify-center"
              >
                {isTesting ? (
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                ) : (
                  latencyProps.label
                )}
              </Badge>
            </button>

            {/* Quick Bind Button */}
            <Button
              variant={isBound ? 'outline' : 'secondary'}
              size="sm"
              disabled={isBound}
              className={`!text-[10px] ${
                isBound ? '!px-1.5 font-mono' : '!px-2'
              } !py-0.5 h-5 gap-1 ${
                isBound
                  ? 'opacity-60 text-muted-foreground bg-secondary/30'
                  : ''
              }`}
              onClick={() =>
                onQuickBind({
                  profileId: node.profileId,
                  nodeName: node.name,
                })
              }
              icon={isBound ? undefined : <Network className="w-2.5 h-2.5" />}
              title={
                isBound
                  ? t('proxies.boundPortTitle', { port: boundPort ?? '' })
                  : t('proxies.bindPortTitle')
              }
            >
              {isBound ? String(boundPort) : t('proxies.bind')}
            </Button>
          </div>
        </div>
      </div>
    )
  },
)

export const ProxyGridView: React.FC = () => {
  const { t, locale } = useTranslation()
  const profiles = useAppStore((state) => state.profiles)
  const fetchProfiles = useAppStore((state) => state.fetchProfiles)
  const profileNodes = useAppStore((state) => state.profileNodes)
  const fetchProfileNodes = useAppStore((state) => state.fetchProfileNodes)
  const portMappings = useAppStore((state) => state.portMappings)
  const setActiveTab = useAppStore((state) => state.setActiveTab)
  const latencies = useAppStore((state) => state.latencies)
  const testingNodeNames = useAppStore((state) => state.testingNodeNames)
  const isTestingAll = useAppStore((state) => state.isTestingAll)
  const testNodeDelay = useAppStore((state) => state.testNodeDelay)
  const testAllNodesDelay = useAppStore((state) => state.testAllNodesDelay)
  const nodeEgressIps = useAppStore((state) => state.nodeEgressIps)
  const probingEgressNodeKeys = useAppStore(
    (state) => state.probingEgressNodeKeys,
  )
  const probeNodeEgressIp = useAppStore((state) => state.probeNodeEgressIp)
  const proxyError = useAppStore((state) => state.proxyError)
  const setProxyError = useAppStore((state) => state.setProxyError)

  const [search, setSearch] = useState('')

  // Persistent filter states (excluding search keyword)
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const stored = localStorage.getItem('proxy_filter_profiles')
      if (stored === 'all') return []
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed)) return parsed
      }
      const legacy = localStorage.getItem('proxy_filter_profile')
      if (legacy && legacy !== 'all') {
        return [legacy]
      }
    } catch {
      // ignore storage error
    }
    return []
  })
  const [isAllProfilesSelected, setIsAllProfilesSelected] = useState<boolean>(
    () => {
      if (typeof window === 'undefined') return true
      try {
        const stored = localStorage.getItem('proxy_filter_profiles')
        if (stored === 'all') return true
        if (stored) return false
        const legacy = localStorage.getItem('proxy_filter_profile')
        if (legacy) return legacy === 'all'
      } catch {
        // ignore storage error
      }
      return true
    },
  )
  const [selectedRegionFilter, setSelectedRegionFilter] = useState<string>(
    () => {
      return typeof window !== 'undefined'
        ? localStorage.getItem('proxy_filter_region') || 'all'
        : 'all'
    },
  )
  const [selectedProtocolFilter, setSelectedProtocolFilter] = useState<string>(
    () => {
      return typeof window !== 'undefined'
        ? localStorage.getItem('proxy_filter_protocol') || 'all'
        : 'all'
    },
  )
  const [sortBy, setSortBy] = useState<SortOption>(() => {
    return typeof window !== 'undefined'
      ? (localStorage.getItem('proxy_sort_by') as SortOption) || 'default'
      : 'default'
  })

  // Quick Bind modal state
  const [quickBindNode, setQuickBindNode] = useState<{
    profileId: string
    nodeName: string
  } | null>(null)

  useEffect(() => {
    fetchProfiles()
  }, [fetchProfiles])

  useEffect(() => {
    for (const profile of profiles) {
      if (!profileNodes[profile.id]) {
        fetchProfileNodes(profile.id).catch(() => {})
      }
    }
  }, [profiles, profileNodes, fetchProfileNodes])
  // Keep selectedProfileIds in sync when profiles load
  useEffect(() => {
    if (profiles.length === 0) return

    if (isAllProfilesSelected) {
      const allIds = profiles.map((p) => p.id)
      if (
        selectedProfileIds.length !== allIds.length ||
        !allIds.every((id) => selectedProfileIds.includes(id))
      ) {
        setSelectedProfileIds(allIds)
      }
    } else if (selectedProfileIds.length > 0) {
      const validIds = new Set(profiles.map((p) => p.id))
      const filtered = selectedProfileIds.filter((id) => validIds.has(id))
      if (filtered.length !== selectedProfileIds.length) {
        setSelectedProfileIds(filtered)
      }
    }
  }, [profiles, isAllProfilesSelected, selectedProfileIds])

  // Sync filter changes to localStorage
  const handleProfileFilterChange = (newIds: string[]) => {
    if (newIds.length === profiles.length) {
      setSelectedProfileIds(profiles.map((p) => p.id))
      setIsAllProfilesSelected(true)
      try {
        localStorage.setItem('proxy_filter_profiles', 'all')
      } catch {
        // ignore storage error
      }
    } else {
      setSelectedProfileIds(newIds)
      setIsAllProfilesSelected(false)
      try {
        localStorage.setItem('proxy_filter_profiles', JSON.stringify(newIds))
      } catch {
        // ignore storage error
      }
    }
    setSelectedRegionFilter('all')
    setSelectedProtocolFilter('all')
    try {
      localStorage.setItem('proxy_filter_region', 'all')
      localStorage.setItem('proxy_filter_protocol', 'all')
    } catch {
      // ignore storage error
    }
  }

  const handleRegionFilterChange = (code: string) => {
    setSelectedRegionFilter(code)
    try {
      localStorage.setItem('proxy_filter_region', code)
    } catch {
      // ignore storage error
    }
  }

  const handleProtocolFilterChange = (proto: string) => {
    setSelectedProtocolFilter(proto)
    try {
      localStorage.setItem('proxy_filter_protocol', proto)
    } catch {
      // ignore storage error
    }
  }

  const handleSortChange = (newSort: SortOption) => {
    setSortBy(newSort)
    try {
      localStorage.setItem('proxy_sort_by', newSort)
    } catch {
      // ignore storage error
    }
  }

  // Map of currently bound nodes to their assigned port
  const boundNodeMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of portMappings) {
      map.set(`${m.profileId}_${m.nodeName}`, m.port)
    }
    return map
  }, [portMappings])

  // Collect all augmented nodes across profiles
  const allNodes = useMemo<AugmentedNode[]>(() => {
    const list: AugmentedNode[] = []
    for (const profile of profiles) {
      if (!selectedProfileIds.includes(profile.id)) {
        continue
      }
      const nodes = profileNodes[profile.id] || []
      for (const node of nodes) {
        list.push({
          ...node,
          profileId: profile.id,
          profileName: profile.name,
          region: extractRegion(node.name),
        })
      }
    }
    return list
  }, [profiles, profileNodes, selectedProfileIds])

  // Available regions for filter pills
  const availableRegions = useMemo(() => {
    const map = new Map<string, { code: string; flag: string; count: number }>()
    for (const node of allNodes) {
      const existing = map.get(node.region.code)
      if (existing) {
        existing.count += 1
      } else {
        map.set(node.region.code, {
          code: node.region.code,
          flag: node.region.flag,
          count: 1,
        })
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count)
  }, [allNodes])

  // Available protocols for filter pills (formatted naturally with counts)
  const availableProtocols = useMemo(() => {
    const map = new Map<string, number>()
    for (const node of allNodes) {
      if (node.type) {
        const key = node.type.toLowerCase()
        map.set(key, (map.get(key) || 0) + 1)
      }
    }
    return Array.from(map.entries())
      .map(([proto, count]) => ({ proto, count }))
      .sort((a, b) => b.count - a.count)
  }, [allNodes])

  // Filtered & Sorted nodes
  const processedNodes = useMemo(() => {
    const filtered = allNodes.filter((node) => {
      // 1. Search term match
      if (search.trim()) {
        const query = search.toLowerCase().trim()
        const match =
          node.name.toLowerCase().includes(query) ||
          node.server.toLowerCase().includes(query) ||
          node.type.toLowerCase().includes(query) ||
          node.profileName.toLowerCase().includes(query) ||
          node.region.name.toLowerCase().includes(query)
        if (!match) return false
      }

      // 2. Region filter match
      if (
        selectedRegionFilter !== 'all' &&
        node.region.code !== selectedRegionFilter
      ) {
        return false
      }

      // 3. Protocol filter match
      if (
        selectedProtocolFilter !== 'all' &&
        node.type.toLowerCase() !== selectedProtocolFilter.toLowerCase()
      ) {
        return false
      }

      return true
    })

    // Sorting
    return filtered.sort((a, b) => {
      const keyA = a.runtimeName || a.name
      const keyB = b.runtimeName || b.name
      const latA = keyA in latencies ? latencies[keyA] : latencies[a.name]
      const latB = keyB in latencies ? latencies[keyB] : latencies[b.name]

      if (sortBy === 'latency-asc') {
        const valA =
          latA !== undefined && latA !== null
            ? latA
            : latA === null
              ? 900000
              : 999999
        const valB =
          latB !== undefined && latB !== null
            ? latB
            : latB === null
              ? 900000
              : 999999
        return valA - valB
      }
      if (sortBy === 'latency-desc') {
        const valA =
          latA !== undefined && latA !== null ? latA : latA === null ? -1 : -2
        const valB =
          latB !== undefined && latB !== null ? latB : latB === null ? -1 : -2
        return valB - valA
      }
      if (sortBy === 'name-asc') {
        return a.name.localeCompare(b.name, locale)
      }
      return 0
    })
  }, [
    allNodes,
    search,
    selectedRegionFilter,
    selectedProtocolFilter,
    sortBy,
    latencies,
    locale,
  ])

  // Batch speed test handler
  const handleBatchSpeedTest = async () => {
    if (processedNodes.length === 0 || isTestingAll) return
    const namesToTest = processedNodes.map((n) => n.runtimeName || n.name)
    await testAllNodesDelay(namesToTest)
  }

  const handleSingleTest = useCallback(
    (key: string) => {
      testNodeDelay(key)
    },
    [testNodeDelay],
  )

  const handleQuickBind = useCallback(
    (target: { profileId: string; nodeName: string }) => {
      setQuickBindNode(target)
    },
    [],
  )

  const handleCopyNodeEgress = useCallback(
    async (node: AugmentedNode) => {
      const runtimeKey =
        node.runtimeName ||
        (node.profileName ? `[${node.profileName}] ${node.name}` : node.name)
      const cached = lookupNodeEgressInfo(
        nodeEgressIps,
        node.name,
        node.profileId,
        runtimeKey,
      )
      if (cached) {
        await navigator.clipboard.writeText(cached.ip).catch(() => {})
        toast.success(
          t('proxies.copiedIpToast', {
            ip: cached.ip,
            region: ` (${cached.region || t('common.unknown')})`,
          }),
        )
        return
      }

      try {
        const info = await probeNodeEgressIp(
          node.name,
          node.profileId,
          runtimeKey,
        )
        await navigator.clipboard.writeText(info.ip).catch(() => {})
        toast.success(
          t('proxies.copiedIpToast', {
            ip: info.ip,
            region: ` (${info.region || t('common.unknown')})`,
          }),
        )
      } catch (err) {
        toast.error(
          t('proxies.detectIpFailed', {
            err: err instanceof Error ? err.message : String(err),
          }),
        )
      }
    },
    [nodeEgressIps, probeNodeEgressIp, t],
  )

  // Profile select dropdown options
  const profileOptions = useMemo<MultiSelectOption<string>[]>(() => {
    return profiles.map((p) => ({
      value: p.id,
      label: p.name,
      badge: `${p.nodeCount}`,
      icon:
        p.type === 'remote' ? (
          <Globe className="w-3.5 h-3.5 opacity-70 shrink-0" />
        ) : (
          <FileCode className="w-3.5 h-3.5 opacity-70 shrink-0" />
        ),
    }))
  }, [profiles])

  return (
    <div className="h-full flex flex-col p-6 space-y-4 w-full overflow-hidden">
      {/* Error Alert Banner */}
      {proxyError && (
        <div className="p-3.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center justify-between gap-3 animate-in fade-in duration-150 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="truncate">{proxyError}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActiveTab('settings')}
              className="!text-[11px] !py-0.5 !px-2 h-6"
            >
              {t('proxies.goToSettings')}
            </Button>
            <button
              type="button"
              onClick={() => setProxyError(null)}
              className="text-destructive hover:opacity-80 p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Top Sticky Header Card (Search + Filters + Batch Actions) */}
      <div className="bg-card border border-border rounded-xl p-4 shadow-sm shrink-0 space-y-3.5">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 max-w-xl">
            <div className="flex-1">
              <Input
                placeholder={t('proxies.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                prefixIcon={<Search className="w-4 h-4" />}
                clearable
                onClear={() => setSearch('')}
              />
            </div>

            {profiles.length > 0 && (
              <div className="w-44 shrink-0">
                <MultiSelect
                  values={selectedProfileIds}
                  onChange={handleProfileFilterChange}
                  options={profileOptions}
                  placeholder={t('proxies.selectProfilePlaceholder')}
                  renderTriggerText={(selectedVals) => {
                    if (selectedVals.length === 0) {
                      return t('proxies.noProfileSelected')
                    }
                    if (
                      selectedVals.length === profiles.length &&
                      profiles.length > 0
                    ) {
                      return t('proxies.allProfiles', {
                        count: allNodes.length,
                      })
                    }
                    if (selectedVals.length === 1) {
                      const prof = profiles.find(
                        (p) => p.id === selectedVals[0],
                      )
                      return prof
                        ? `${prof.name} (${prof.nodeCount})`
                        : t('proxies.oneProfileSelected')
                    }
                    return t('proxies.nProfilesSelected', {
                      count: selectedVals.length,
                    })
                  }}
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="w-32">
              <Select
                value={sortBy}
                onChange={(val) => handleSortChange(val as SortOption)}
                options={[
                  { value: 'default', label: t('proxies.sortDefault') },
                  { value: 'latency-asc', label: t('proxies.sortLatencyAsc') },
                  {
                    value: 'latency-desc',
                    label: t('proxies.sortLatencyDesc'),
                  },
                  { value: 'name-asc', label: t('proxies.sortNameAsc') },
                ]}
                prefixIcon={<ArrowUpDown className="w-3.5 h-3.5" />}
              />
            </div>

            <Button
              variant="primary"
              size="sm"
              loading={isTestingAll}
              disabled={allNodes.length === 0}
              onClick={handleBatchSpeedTest}
              icon={<Gauge className="w-3.5 h-3.5" />}
            >
              {isTestingAll ? t('proxies.testingAll') : t('proxies.testAll')}
            </Button>
          </div>
        </div>

        {/* Region & Protocol Filter Pills */}
        {allNodes.length > 0 && (
          <div className="grid grid-cols-[auto_1fr] items-start gap-x-2.5 gap-y-2.5 pt-2 border-t border-border/50 text-xs">
            {/* Row 1: Region Filters */}
            <span className="text-[11px] font-medium text-muted-foreground pt-0.5 flex items-center gap-1 whitespace-nowrap">
              <Globe className="w-3.5 h-3.5 text-primary shrink-0" />
              {t('proxies.regionLabel')}
            </span>
            <div className="flex-1 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleRegionFilterChange('all')}
                className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors ${
                  selectedRegionFilter === 'all'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-secondary/70 text-muted-foreground hover:bg-secondary hover:text-foreground'
                }`}
              >
                {t('proxies.allCount', { count: allNodes.length })}
              </button>
              {availableRegions.map((r) => (
                <button
                  key={r.code}
                  type="button"
                  onClick={() =>
                    handleRegionFilterChange(
                      selectedRegionFilter === r.code ? 'all' : r.code,
                    )
                  }
                  className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors flex items-center gap-1.5 ${
                    selectedRegionFilter === r.code
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-secondary/70 text-muted-foreground hover:bg-secondary hover:text-foreground'
                  }`}
                >
                  <RegionFlag code={r.code} size="sm" />
                  <span>
                    {r.code === 'OTHER'
                      ? t('residentialI18n.test.otherRegion')
                      : r.code}
                  </span>
                  <span className="opacity-70 text-[10px]">({r.count})</span>
                </button>
              ))}
            </div>
            {/* Row 2: Protocol Filters */}
            {availableProtocols.length > 0 && (
              <>
                <span className="text-[11px] font-medium text-muted-foreground pt-0.5 flex items-center gap-1 whitespace-nowrap">
                  <Zap className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  {t('proxies.protocolLabel')}
                </span>
                <div className="flex-1 flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleProtocolFilterChange('all')}
                    className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors ${
                      selectedProtocolFilter === 'all'
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'bg-secondary/70 text-muted-foreground hover:bg-secondary hover:text-foreground'
                    }`}
                  >
                    {t('proxies.allCount', { count: allNodes.length })}
                  </button>
                  {availableProtocols.map((p) => (
                    <button
                      key={p.proto}
                      type="button"
                      onClick={() =>
                        handleProtocolFilterChange(
                          selectedProtocolFilter.toLowerCase() ===
                            p.proto.toLowerCase()
                            ? 'all'
                            : p.proto,
                        )
                      }
                      className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors ${
                        selectedProtocolFilter.toLowerCase() ===
                        p.proto.toLowerCase()
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'bg-secondary/70 text-muted-foreground hover:bg-secondary hover:text-foreground'
                      }`}
                    >
                      <span>{formatProtocolName(p.proto)}</span>
                      <span className="opacity-70 text-[10px] ml-0.5">
                        ({p.count})
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Scrollable Nodes Grid Area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden pr-1 pb-4">
        {profiles.length > 0 && selectedProfileIds.length === 0 ? (
          <div className="border border-dashed border-border rounded-xl p-12 flex flex-col items-center justify-center text-center space-y-4 bg-card/30">
            <div className="w-12 h-12 rounded-full bg-secondary text-muted-foreground flex items-center justify-center">
              <Layers className="w-6 h-6" />
            </div>
            <div className="space-y-1 max-w-sm">
              <h3 className="text-sm font-semibold text-foreground">
                {t('proxies.emptyNoProfileTitle')}
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t('proxies.emptyNoProfileDesc')}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const allIds = profiles.map((p) => p.id)
                setSelectedProfileIds(allIds)
                setIsAllProfilesSelected(true)
                try {
                  localStorage.setItem('proxy_filter_profiles', 'all')
                } catch {
                  // ignore storage error
                }
              }}
            >
              {t('proxies.selectAllProfiles')}
            </Button>
          </div>
        ) : allNodes.length === 0 ? (
          <div className="border border-dashed border-border rounded-xl p-12 flex flex-col items-center justify-center text-center space-y-4 bg-card/30">
            <div className="w-12 h-12 rounded-full bg-secondary text-muted-foreground flex items-center justify-center">
              <Compass className="w-6 h-6" />
            </div>
            <div className="space-y-1 max-w-sm">
              <h3 className="text-sm font-semibold text-foreground">
                {t('proxies.emptyNoNodesTitle')}
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t('proxies.emptyNoNodesDesc')}
              </p>
            </div>
            <Button
              variant="primary"
              onClick={() => setActiveTab('profiles')}
              icon={<Layers className="w-3.5 h-3.5" />}
            >
              {t('proxies.goToProfiles')}
            </Button>
          </div>
        ) : processedNodes.length === 0 ? (
          <div className="border border-dashed border-border rounded-xl p-10 flex flex-col items-center justify-center text-center space-y-3 bg-card/20">
            <Search className="w-6 h-6 text-muted-foreground" />
            <div className="text-xs text-muted-foreground">
              {t('proxies.emptyNoMatch')}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearch('')
                handleRegionFilterChange('all')
                handleProtocolFilterChange('all')
              }}
            >
              {t('proxies.resetFilters')}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2.5 [contain:layout_style]">
            {processedNodes.map((node) => {
              const nodeKey = node.runtimeName || node.name
              const latency =
                nodeKey in latencies ? latencies[nodeKey] : latencies[node.name]
              const isTesting = !!testingNodeNames[nodeKey]
              const boundPort = boundNodeMap.get(
                `${node.profileId}_${node.name}`,
              )
              const isBound = boundPort !== undefined
              const egressInfo = lookupNodeEgressInfo(
                nodeEgressIps,
                node.name,
                node.profileId,
                nodeKey,
              )
              const isProbingEgress = isNodeEgressProbing(
                probingEgressNodeKeys,
                node.name,
                node.profileId,
                nodeKey,
              )

              return (
                <ProxyNodeCard
                  key={`${node.profileId}-${node.name}-${node.server}-${node.port}`}
                  node={node}
                  latency={latency}
                  isTesting={isTesting}
                  isTestingAll={isTestingAll}
                  isBound={isBound}
                  boundPort={boundPort}
                  egressInfo={egressInfo}
                  isProbingEgress={isProbingEgress}
                  onTestDelay={handleSingleTest}
                  onCopyEgressIp={handleCopyNodeEgress}
                  onQuickBind={handleQuickBind}
                />
              )
            })}
          </div>
        )}
      </div>

      {/* Add Port / Quick Bind Modal */}
      {quickBindNode && (
        <AddPortModal
          isOpen={!!quickBindNode}
          onClose={() => setQuickBindNode(null)}
          initialProfileId={quickBindNode.profileId}
          initialNodeName={quickBindNode.nodeName}
        />
      )}
    </div>
  )
}
