import { Compass, Loader2, Radio, Server } from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import { useAppStore } from '../../stores/appStore'
import type { ProfileItem, ProxyNode } from '../../types'
import { Button, Input, Modal } from '../common'

interface ProfileNodesModalProps {
  profile: ProfileItem | null
  isOpen: boolean
  onClose: () => void
}

export const ProfileNodesModal: React.FC<ProfileNodesModalProps> = ({
  profile,
  isOpen,
  onClose,
}) => {
  const { profileNodes, fetchProfileNodes } = useAppStore()
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (isOpen && profile) {
      setLoading(true)
      fetchProfileNodes(profile.id).finally(() => setLoading(false))
    }
  }, [isOpen, profile, fetchProfileNodes])

  if (!profile) return null

  const nodes: ProxyNode[] = profileNodes[profile.id] || []
  const filteredNodes = nodes.filter(
    (n) =>
      n.name.toLowerCase().includes(search.toLowerCase()) ||
      n.server.toLowerCase().includes(search.toLowerCase()) ||
      n.type.toLowerCase().includes(search.toLowerCase()),
  )

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

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${profile.name} — 包含节点列表`}
      subtitle={`共解析到 ${nodes.length} 个可用代理节点`}
      icon={<Compass className="w-4 h-4" />}
      maxWidth="2xl"
    >
      <div className="flex flex-col h-full">
        {/* Search Bar */}
        <div className="px-5 py-3 border-b border-border bg-card/50">
          <Input
            placeholder="搜索节点名称、协议或服务器地址..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 max-h-[60vh]">
          {loading ? (
            <div className="py-16 flex flex-col items-center justify-center text-center space-y-2 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <span className="text-xs">正在读取并解析节点...</span>
            </div>
          ) : filteredNodes.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted-foreground">
              {nodes.length === 0
                ? '此订阅配置文件未包含任何 proxies 代理节点。'
                : '没有找到匹配的节点。'}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {filteredNodes.map((node) => (
                <div
                  key={`${node.name}-${node.server}-${node.port}`}
                  className="p-3 rounded-xl border border-border bg-background/50 hover:bg-background/80 transition-colors flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="font-medium text-foreground truncate flex items-center gap-1.5">
                      <Radio className="w-3 h-3 text-muted-foreground shrink-0" />
                      <span className="truncate" title={node.name}>
                        {node.name}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground font-mono truncate flex items-center gap-1">
                      <Server className="w-2.5 h-2.5 shrink-0" />
                      <span className="truncate">
                        {node.server}:{node.port}
                      </span>
                    </div>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium border uppercase shrink-0 ${getTypeBadgeColor(
                      node.type,
                    )}`}
                  >
                    {node.type}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground bg-card/50">
          <span>
            展示 {filteredNodes.length} / {nodes.length} 个节点
          </span>
          <Button variant="outline" size="sm" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </Modal>
  )
}
