import {
  AlertCircle,
  ArrowUpDown,
  Compass,
  Gauge,
  Globe,
  Layers,
  Loader2,
  Network,
  RotateCcw,
  Search,
  Server,
  X,
  Zap,
} from 'lucide-react'
import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../stores/appStore'
import type { ProxyNode } from '../../types'
import {
  extractRegion,
  getLatencyBadgeProps,
  getProtocolBadgeProps,
} from '../../utils/proxy'
import { Badge, Button, Input, Select } from '../common'
import { AddPortModal } from '../ports/AddPortModal'

type SortOption = 'default' | 'latency-asc' | 'latency-desc' | 'name-asc'

interface AugmentedNode extends ProxyNode {
  profileId: string
  profileName: string
  region: ReturnType<typeof extractRegion>
}

export const ProxyGridView: React.FC = () => {
  const {
    profiles,
    fetchProfiles,
    profileNodes,
    fetchProfileNodes,
    setActiveTab,
    latencies,
    testingNodeNames,
    isTestingAll,
    testNodeDelay,
    testAllNodesDelay,
    clearLatencies,
    proxyError,
    setProxyError,
  } = useAppStore()

  const [search, setSearch] = useState('')
  const [selectedProfileFilter, setSelectedProfileFilter] =
    useState<string>('all')
  const [selectedRegionFilter, setSelectedRegionFilter] =
    useState<string>('all')
  const [selectedProtocolFilter, setSelectedProtocolFilter] =
    useState<string>('all')
  const [sortBy, setSortBy] = useState<SortOption>('default')

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

  // Collect all augmented nodes across profiles
  const allNodes = useMemo<AugmentedNode[]>(() => {
    const list: AugmentedNode[] = []
    for (const profile of profiles) {
      if (
        selectedProfileFilter !== 'all' &&
        profile.id !== selectedProfileFilter
      ) {
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
  }, [profiles, profileNodes, selectedProfileFilter])

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

  // Available protocols for filter pills
  const availableProtocols = useMemo(() => {
    const map = new Map<string, number>()
    for (const node of allNodes) {
      const type = node.type.toUpperCase()
      map.set(type, (map.get(type) || 0) + 1)
    }
    return Array.from(map.entries()).map(([type, count]) => ({ type, count }))
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
        node.type.toUpperCase() !== selectedProtocolFilter
      ) {
        return false
      }

      return true
    })

    // Sorting
    return filtered.sort((a, b) => {
      const keyA = a.runtimeName || a.name
      const keyB = b.runtimeName || b.name
      const latA = latencies[keyA]
      const latB = latencies[keyB]

      if (sortBy === 'latency-asc') {
        // Known latencies first, lowest to highest; timeouts/untested last
        const valA = latA !== undefined && latA !== null ? latA : 999999
        const valB = latB !== undefined && latB !== null ? latB : 999999
        return valA - valB
      }
      if (sortBy === 'latency-desc') {
        const valA = latA !== undefined && latA !== null ? latA : -1
        const valB = latB !== undefined && latB !== null ? latB : -1
        return valB - valA
      }
      if (sortBy === 'name-asc') {
        return a.name.localeCompare(b.name, 'zh-Hans-CN')
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
  ])

  // Batch speed test handler
  const handleBatchSpeedTest = async () => {
    if (processedNodes.length === 0 || isTestingAll) return
    const namesToTest = processedNodes.map((n) => n.runtimeName || n.name)
    await testAllNodesDelay(namesToTest)
  }

  // Profile select dropdown options
  const profileFilterOptions = useMemo(() => {
    return [
      { value: 'all', label: `全部订阅 (${allNodes.length})` },
      ...profiles.map((p) => ({
        value: p.id,
        label: `${p.name} (${p.nodeCount})`,
      })),
    ]
  }, [profiles, allNodes.length])

  const testedCount = useMemo(() => {
    return Object.keys(latencies).length
  }, [latencies])

  return (
    <div className="p-6 space-y-5 max-w-6xl">
      {/* Error Alert Banner */}
      {proxyError && (
        <div className="p-3.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center justify-between gap-3 animate-in fade-in duration-150">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="truncate">{proxyError}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {proxyError.includes('未运行') && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setActiveTab('settings')}
                className="!text-[11px] !py-0.5 !px-2 h-6"
              >
                前往设置
              </Button>
            )}
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

      {/* Search & Actions Bar */}
      <div className="flex flex-col gap-3.5">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 max-w-xl">
            <div className="flex-1">
              <Input
                placeholder="搜索节点名称、地区、服务器地址、协议..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                prefixIcon={<Search className="w-4 h-4" />}
                clearable
                onClear={() => setSearch('')}
              />
            </div>

            {profiles.length > 0 && (
              <div className="w-48 shrink-0">
                <Select
                  value={selectedProfileFilter}
                  onChange={(val) => {
                    setSelectedProfileFilter(String(val))
                    setSelectedRegionFilter('all')
                    setSelectedProtocolFilter('all')
                  }}
                  options={profileFilterOptions}
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {testedCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearLatencies}
                icon={<RotateCcw className="w-3.5 h-3.5" />}
                title="清空测速结果"
              >
                重置
              </Button>
            )}

            <div className="w-36">
              <Select
                value={sortBy}
                onChange={(val) => setSortBy(val as SortOption)}
                options={[
                  { value: 'default', label: '默认排序' },
                  { value: 'latency-asc', label: '延迟低到高' },
                  { value: 'latency-desc', label: '延迟高到低' },
                  { value: 'name-asc', label: '名称 (A-Z)' },
                ]}
                prefixIcon={<ArrowUpDown className="w-3.5 h-3.5" />}
              />
            </div>

            <Button
              variant="primary"
              size="md"
              loading={isTestingAll}
              disabled={allNodes.length === 0}
              onClick={handleBatchSpeedTest}
              icon={<Gauge className="w-3.5 h-3.5" />}
            >
              {isTestingAll ? '正在并发测速...' : '全量并发测速'}
            </Button>
          </div>
        </div>

        {/* Region & Protocol Filter Pills (2 distinct rows) */}
        {allNodes.length > 0 && (
          <div className="space-y-2 pt-1 border-t border-border/50">
            {/* Row 1: Region Filters */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-[11px] font-medium text-muted-foreground mr-1 flex items-center gap-1 min-w-[48px] shrink-0">
                <Globe className="w-3.5 h-3.5 text-primary" />
                地区:
              </span>
              <button
                type="button"
                onClick={() => setSelectedRegionFilter('all')}
                className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors ${
                  selectedRegionFilter === 'all'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-secondary/70 text-muted-foreground hover:bg-secondary hover:text-foreground'
                }`}
              >
                全部 ({allNodes.length})
              </button>
              {availableRegions.map((r) => (
                <button
                  key={r.code}
                  type="button"
                  onClick={() =>
                    setSelectedRegionFilter(
                      selectedRegionFilter === r.code ? 'all' : r.code,
                    )
                  }
                  className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors flex items-center gap-1 ${
                    selectedRegionFilter === r.code
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-secondary/70 text-muted-foreground hover:bg-secondary hover:text-foreground'
                  }`}
                >
                  <span>{r.flag}</span>
                  <span>{r.code}</span>
                  <span className="opacity-70 text-[10px]">({r.count})</span>
                </button>
              ))}
            </div>

            {/* Row 2: Protocol Filters */}
            {availableProtocols.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-[11px] font-medium text-muted-foreground mr-1 flex items-center gap-1 min-w-[48px] shrink-0">
                  <Zap className="w-3.5 h-3.5 text-amber-500" />
                  协议:
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedProtocolFilter('all')}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors ${
                    selectedProtocolFilter === 'all'
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-secondary/70 text-muted-foreground hover:bg-secondary hover:text-foreground'
                  }`}
                >
                  全部
                </button>
                {availableProtocols.map((p) => (
                  <button
                    key={p.type}
                    type="button"
                    onClick={() =>
                      setSelectedProtocolFilter(
                        selectedProtocolFilter === p.type ? 'all' : p.type,
                      )
                    }
                    className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors ${
                      selectedProtocolFilter === p.type
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'bg-secondary/70 text-muted-foreground hover:bg-secondary hover:text-foreground'
                    }`}
                  >
                    {p.type}
                    <span className="opacity-70 text-[10px] ml-1">
                      ({p.count})
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Nodes Grid or Empty State */}
      {allNodes.length === 0 ? (
        <div className="border border-dashed border-border rounded-xl p-12 flex flex-col items-center justify-center text-center space-y-4 bg-card/30">
          <div className="w-12 h-12 rounded-full bg-secondary text-muted-foreground flex items-center justify-center">
            <Compass className="w-6 h-6" />
          </div>
          <div className="space-y-1 max-w-sm">
            <h3 className="text-sm font-semibold text-foreground">
              暂无可用代理节点
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              请前往「配置订阅」页面导入远程订阅链接或本地 Clash YAML 配置文件。
            </p>
          </div>
          <Button
            variant="primary"
            onClick={() => setActiveTab('profiles')}
            icon={<Layers className="w-3.5 h-3.5" />}
          >
            前往配置订阅
          </Button>
        </div>
      ) : processedNodes.length === 0 ? (
        <div className="border border-dashed border-border rounded-xl p-10 flex flex-col items-center justify-center text-center space-y-3 bg-card/20">
          <Search className="w-6 h-6 text-muted-foreground" />
          <div className="text-xs text-muted-foreground">
            未找到与当前筛选条件匹配的代理节点
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setSearch('')
              setSelectedRegionFilter('all')
              setSelectedProtocolFilter('all')
            }}
          >
            重置所有筛选
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <span>
                显示 <b>{processedNodes.length}</b> / {allNodes.length} 个节点
              </span>
              {testedCount > 0 && (
                <span className="text-emerald-500 font-medium">
                  • 已测速 {testedCount} 个
                </span>
              )}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {processedNodes.map((node) => {
              const nodeKey = node.runtimeName || node.name
              const latency = latencies[nodeKey]
              const isTesting = !!testingNodeNames[nodeKey]
              const latencyProps = getLatencyBadgeProps(latency, isTesting)
              const protocolProps = getProtocolBadgeProps(node.type)

              return (
                <div
                  key={`${node.profileId}-${node.name}-${node.server}-${node.port}`}
                  className="p-3.5 rounded-xl border border-border bg-card hover:border-primary/40 hover:shadow-md transition-all flex flex-col justify-between space-y-3 group"
                >
                  {/* Top Row: Country Flag + Node Name + Protocol Badge */}
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium text-xs text-foreground truncate flex items-center gap-1.5 min-w-0 flex-1">
                        <span
                          className="text-sm shrink-0"
                          title={node.region.name}
                        >
                          {node.region.flag}
                        </span>
                        <span
                          className="truncate font-semibold"
                          title={node.name}
                        >
                          {node.name}
                        </span>
                      </div>

                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border uppercase shrink-0 ${protocolProps.className}`}
                      >
                        {protocolProps.label}
                      </span>
                    </div>

                    {/* Server Address */}
                    <div className="text-[11px] text-muted-foreground font-mono truncate flex items-center gap-1.5">
                      <Server className="w-3 h-3 shrink-0 opacity-70" />
                      <span className="truncate">
                        {node.server}:{node.port}
                      </span>
                    </div>
                  </div>

                  {/* Bottom Row: Profile Name + Latency Badge + Quick Actions */}
                  <div className="pt-2 border-t border-border/60 flex items-center justify-between text-[11px]">
                    <span
                      className="text-muted-foreground truncate max-w-[120px]"
                      title={node.profileName}
                    >
                      {node.profileName}
                    </span>

                    <div className="flex items-center gap-2">
                      {/* Latency Badge (Clickable for Single Speed Test) */}
                      <button
                        type="button"
                        onClick={() => testNodeDelay(nodeKey)}
                        disabled={isTesting || isTestingAll}
                        className="group/ping focus:outline-none"
                        title="点击单独测速"
                      >
                        <Badge
                          variant={latencyProps.variant}
                          size="sm"
                          dot={latencyProps.dot}
                          className="cursor-pointer hover:opacity-80 font-mono transition-opacity"
                        >
                          {isTesting ? (
                            <span className="flex items-center gap-1">
                              <Loader2 className="w-2.5 h-2.5 animate-spin" />
                              测速中
                            </span>
                          ) : (
                            latencyProps.label
                          )}
                        </Badge>
                      </button>

                      {/* Quick Bind Button */}
                      <Button
                        variant="secondary"
                        size="sm"
                        className="!text-[11px] !px-2 !py-1 h-6 gap-1"
                        onClick={() =>
                          setQuickBindNode({
                            profileId: node.profileId,
                            nodeName: node.runtimeName || node.name,
                          })
                        }
                        icon={<Network className="w-3 h-3" />}
                        title="绑定到本地入站端口"
                      >
                        绑定
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

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
