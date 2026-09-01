import { Compass, Gauge, Layers, Radio, Search, Server } from 'lucide-react'
import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../stores/appStore'
import type { ProxyNode } from '../../types'
import { Button, Input, Select } from '../common'

export const ProxyGridView: React.FC = () => {
  const {
    profiles,
    fetchProfiles,
    profileNodes,
    fetchProfileNodes,
    setActiveTab,
  } = useAppStore()

  const [search, setSearch] = useState('')
  const [selectedProfileFilter, setSelectedProfileFilter] =
    useState<string>('all')

  useEffect(() => {
    fetchProfiles()
  }, [fetchProfiles])

  useEffect(() => {
    // Fetch nodes for all profiles
    for (const profile of profiles) {
      if (!profileNodes[profile.id]) {
        fetchProfileNodes(profile.id).catch(() => {})
      }
    }
  }, [profiles, profileNodes, fetchProfileNodes])

  const allNodes = useMemo(() => {
    const list: Array<ProxyNode & { profileName: string; profileId: string }> =
      []
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
          profileName: profile.name,
          profileId: profile.id,
        })
      }
    }
    return list
  }, [profiles, profileNodes, selectedProfileFilter])

  const filteredNodes = useMemo(() => {
    return allNodes.filter(
      (n) =>
        n.name.toLowerCase().includes(search.toLowerCase()) ||
        n.server.toLowerCase().includes(search.toLowerCase()) ||
        n.type.toLowerCase().includes(search.toLowerCase()) ||
        n.profileName.toLowerCase().includes(search.toLowerCase()),
    )
  }, [allNodes, search])

  const getTypeBadgeColor = (type: string) => {
    switch (type.toLowerCase()) {
      case 'ss':
      case 'shadowsocks':
        return 'bg-blue-500/10 text-blue-500 border-blue-500/20'
      case 'vmess':
        return 'bg-amber-500/10 text-amber-500 border-amber-500/20'
      case 'vless':
        return 'bg-purple-500/10 text-purple-500 border-purple-500/20'
      case 'trojan':
        return 'bg-rose-500/10 text-rose-500 border-rose-500/20'
      case 'hysteria2':
      case 'hy2':
        return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
      default:
        return 'bg-secondary text-muted-foreground border-border'
    }
  }

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
    <div className="p-6 space-y-6 max-w-6xl">
      {/* Search & Batch Actions */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-1 max-w-lg">
          <div className="flex-1">
            <Input
              placeholder="搜索节点名称、类型、服务器..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              prefixIcon={<Search className="w-4 h-4" />}
            />
          </div>

          {profiles.length > 0 && (
            <div className="w-52 shrink-0">
              <Select
                value={selectedProfileFilter}
                onChange={(val) => setSelectedProfileFilter(String(val))}
                options={profileFilterOptions}
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="md"
            icon={<Gauge className="w-3.5 h-3.5" />}
          >
            全量并发测速
          </Button>
        </div>
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
      ) : (
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground flex items-center justify-between">
            <span>
              已加载 <b>{filteredNodes.length}</b> 个节点
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredNodes.map((node) => (
              <div
                key={`${node.profileId}-${node.name}-${node.server}-${node.port}`}
                className="p-4 rounded-xl border border-border bg-card hover:border-primary/40 transition-all flex flex-col justify-between space-y-3 shadow-sm"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium text-xs text-foreground truncate flex items-center gap-1.5 min-w-0">
                      <Radio className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span className="truncate" title={node.name}>
                        {node.name}
                      </span>
                    </div>

                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border uppercase shrink-0 ${getTypeBadgeColor(
                        node.type,
                      )}`}
                    >
                      {node.type}
                    </span>
                  </div>

                  <div className="text-[11px] text-muted-foreground font-mono truncate flex items-center gap-1">
                    <Server className="w-3 h-3 shrink-0" />
                    <span className="truncate">
                      {node.server}:{node.port}
                    </span>
                  </div>
                </div>

                <div className="pt-2 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span
                    className="truncate max-w-[140px]"
                    title={node.profileName}
                  >
                    {node.profileName}
                  </span>
                  <span className="text-muted-foreground/60 font-mono">
                    未测速
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
