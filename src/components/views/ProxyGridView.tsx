import {
  AlertCircle,
  ArrowUpDown,
  Compass,
  Gauge,
  Globe,
  Layers,
  Loader2,
  Network,
  Search,
  X,
  Zap,
} from 'lucide-react'
import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../stores/appStore'
import type { ProxyNode } from '../../types'
import {
  extractRegion,
  formatProtocolName,
  getLatencyBadgeProps,
  getProtocolBadgeProps,
} from '../../utils/proxy'
import { Badge, Button, Input, RegionFlag, Select } from '../common'
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
    proxyError,
    setProxyError,
  } = useAppStore()

  const [search, setSearch] = useState('')

  // Persistent filter states (excluding search keyword)
  const [selectedProfileFilter, setSelectedProfileFilter] = useState<string>(
    () => {
      return typeof window !== 'undefined'
        ? localStorage.getItem('proxy_filter_profile') || 'all'
        : 'all'
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

  // Sync filter changes to localStorage
  const handleProfileFilterChange = (val: string) => {
    setSelectedProfileFilter(val)
    setSelectedRegionFilter('all')
    setSelectedProtocolFilter('all')
    try {
      localStorage.setItem('proxy_filter_profile', val)
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
      const latA = latencies[keyA]
      const latB = latencies[keyB]

      if (sortBy === 'latency-asc') {
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

  return (
    <div className="h-full flex flex-col p-6 space-y-4 max-w-6xl overflow-hidden">
      {/* Error Alert Banner */}
      {proxyError && (
        <div className="p-3.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center justify-between gap-3 animate-in fade-in duration-150 shrink-0">
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

      {/* Top Sticky Header Card (Search + Filters + Batch Actions) */}
      <div className="bg-card border border-border rounded-xl p-4 shadow-sm shrink-0 space-y-3.5">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 max-w-xl">
            <div className="flex-1">
              <Input
                placeholder="搜索节点名称、地区、协议..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                prefixIcon={<Search className="w-4 h-4" />}
                clearable
                onClear={() => setSearch('')}
              />
            </div>

            {profiles.length > 0 && (
              <div className="w-44 shrink-0">
                <Select
                  value={selectedProfileFilter}
                  onChange={(val) => handleProfileFilterChange(String(val))}
                  options={profileFilterOptions}
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="w-36">
              <Select
                value={sortBy}
                onChange={(val) => handleSortChange(val as SortOption)}
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

        {/* Region & Protocol Filter Pills */}
        {allNodes.length > 0 && (
          <div className="space-y-2.5 pt-2 border-t border-border/50">
            {/* Row 1: Region Filters */}
            <div className="flex items-start gap-2 text-xs">
              <span className="text-[11px] font-medium text-muted-foreground pt-0.5 flex items-center gap-1 shrink-0 w-12">
                <Globe className="w-3.5 h-3.5 text-primary shrink-0" />
                地区:
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
                  全部 ({allNodes.length})
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
                    <span>{r.code}</span>
                    <span className="opacity-70 text-[10px]">({r.count})</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Row 2: Protocol Filters */}
            {availableProtocols.length > 0 && (
              <div className="flex items-start gap-2 text-xs">
                <span className="text-[11px] font-medium text-muted-foreground pt-0.5 flex items-center gap-1 shrink-0 w-12">
                  <Zap className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  协议:
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
                    全部 ({allNodes.length})
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
              </div>
            )}
          </div>
        )}
      </div>

      {/* Scrollable Nodes Grid Area */}
      <div className="flex-1 overflow-y-auto pr-1 pb-4">
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
                请前往「配置订阅」页面导入远程订阅链接或本地 Clash YAML
                配置文件。
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
                handleRegionFilterChange('all')
                handleProtocolFilterChange('all')
              }}
            >
              重置所有筛选
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5">
            {processedNodes.map((node) => {
              const nodeKey = node.runtimeName || node.name
              const latency = latencies[nodeKey]
              const isTesting = !!testingNodeNames[nodeKey]
              const latencyProps = getLatencyBadgeProps(latency, isTesting)
              const protocolProps = getProtocolBadgeProps(node.type)

              return (
                <div
                  key={`${node.profileId}-${node.name}-${node.server}-${node.port}`}
                  className="p-2.5 rounded-xl border border-border bg-card hover:border-primary/40 hover:shadow-sm transition-all flex flex-col justify-between space-y-2 group"
                >
                  {/* Top Row: Region Flag (fixed) + Node Name (flex-1) + Profile Name (fixed right) */}
                  <div className="flex items-center gap-1.5 min-w-0">
                    <RegionFlag code={node.region.code} size="md" />
                    <span
                      className="truncate font-semibold text-xs text-foreground flex-1 min-w-0"
                      title={node.name}
                    >
                      {node.name}
                    </span>
                    <span
                      className="shrink-0 max-w-[80px] truncate text-right text-[10px] text-muted-foreground/80"
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
                        onClick={() => testNodeDelay(nodeKey)}
                        disabled={isTesting || isTestingAll}
                        className="focus:outline-none"
                        title="点击单独测速"
                      >
                        <Badge
                          variant={latencyProps.variant}
                          size="sm"
                          dot={latencyProps.dot}
                          className="cursor-pointer hover:opacity-80 font-mono transition-opacity !text-[10px] !py-0.5 !px-1.5"
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
                        className="!text-[10px] !px-2 !py-0.5 h-5 gap-1"
                        onClick={() =>
                          setQuickBindNode({
                            profileId: node.profileId,
                            nodeName: node.name,
                          })
                        }
                        icon={<Network className="w-2.5 h-2.5" />}
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
