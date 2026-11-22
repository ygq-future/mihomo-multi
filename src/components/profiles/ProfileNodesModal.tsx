import { Compass, Copy, Loader2, Radio, Server } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import type { ProfileItem, ProxyNode } from '../../types'
import {
  getProtocolBadgeProps,
  isNodeEgressProbing,
  lookupNodeEgressInfo,
} from '../../utils/proxy'
import { Button, Input, Modal, toast } from '../common'

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
  const { t } = useTranslation()
  const profileNodes = useAppStore((state) => state.profileNodes)
  const fetchProfileNodes = useAppStore((state) => state.fetchProfileNodes)
  const nodeEgressIps = useAppStore((state) => state.nodeEgressIps)
  const probingEgressNodeKeys = useAppStore(
    (state) => state.probingEgressNodeKeys,
  )
  const probeNodeEgressIp = useAppStore((state) => state.probeNodeEgressIp)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (isOpen && profile) {
      setLoading(true)
      fetchProfileNodes(profile.id).finally(() => setLoading(false))
    }
  }, [isOpen, profile, fetchProfileNodes])

  const handleCopyEgress = useCallback(
    async (node: ProxyNode) => {
      if (!profile) return
      const runtimeKey = node.runtimeName || `[${profile.name}] ${node.name}`
      const cached = lookupNodeEgressInfo(
        nodeEgressIps,
        node.name,
        profile.id,
        runtimeKey,
      )
      if (cached) {
        await navigator.clipboard.writeText(cached.ip).catch(() => {})
        toast.success(
          t('residentialI18n.nodes.copiedToast', {
            ip: cached.ip,
            region: ` (${cached.region || t('common.unknown')})`,
          }),
        )
        return
      }
      try {
        const info = await probeNodeEgressIp(node.name, profile.id, runtimeKey)
        await navigator.clipboard.writeText(info.ip).catch(() => {})
        toast.success(
          t('residentialI18n.nodes.copiedToast', {
            ip: info.ip,
            region: ` (${info.region || t('common.unknown')})`,
          }),
        )
      } catch (err) {
        toast.error(
          t('residentialI18n.nodes.detectFailed', {
            err: err instanceof Error ? err.message : String(err),
          }),
        )
      }
    },
    [profile, nodeEgressIps, probeNodeEgressIp, t],
  )

  if (!profile) return null

  const nodes: ProxyNode[] = profileNodes[profile.id] || []
  const filteredNodes = nodes.filter(
    (n) =>
      n.name.toLowerCase().includes(search.toLowerCase()) ||
      n.server.toLowerCase().includes(search.toLowerCase()) ||
      n.type.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('residentialI18n.nodes.title', { name: profile.name })}
      subtitle={t('residentialI18n.nodes.subtitle', { count: nodes.length })}
      icon={<Compass className="w-4 h-4" />}
      maxWidth="2xl"
      noPadding
      footer={
        <div className="w-full flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {t('residentialI18n.nodes.footer', {
              shown: filteredNodes.length,
              total: nodes.length,
            })}
          </span>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('residentialI18n.common.close')}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col h-full">
        {/* Search Bar */}
        <div className="px-4 py-3 border-b border-border bg-card/50 shrink-0">
          <Input
            placeholder={t('residentialI18n.nodes.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3.5 max-h-[60vh]">
          {loading ? (
            <div className="py-16 flex flex-col items-center justify-center text-center space-y-2 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <span className="text-xs">
                {t('residentialI18n.nodes.loading')}
              </span>
            </div>
          ) : filteredNodes.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted-foreground">
              {nodes.length === 0
                ? t('residentialI18n.nodes.emptyNoNodes')
                : t('residentialI18n.nodes.emptyNoMatch')}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 [contain:layout_style]">
              {filteredNodes.map((node) => {
                const runtimeKey =
                  node.runtimeName || `[${profile.name}] ${node.name}`
                const egressInfo = lookupNodeEgressInfo(
                  nodeEgressIps,
                  node.name,
                  profile.id,
                  runtimeKey,
                )
                const isProbing = isNodeEgressProbing(
                  probingEgressNodeKeys,
                  node.name,
                  profile.id,
                  runtimeKey,
                )
                return (
                  <div
                    key={`${node.name}-${node.server}-${node.port}`}
                    className="p-3 rounded-xl border border-border bg-background/50 hover:bg-background/80 transition-colors flex items-center justify-between gap-3 text-xs [contain:layout_style] [content-visibility:auto] [contain-intrinsic-size:56px]"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="relative font-medium text-foreground flex items-center gap-1.5 min-w-0 group/name">
                        <Radio className="w-3 h-3 text-muted-foreground shrink-0" />
                        <span
                          className="truncate flex-1 min-w-0"
                          title={node.name}
                        >
                          {node.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleCopyEgress(node)}
                          disabled={isProbing}
                          className={`absolute right-0 top-1/2 -translate-y-1/2 z-10 inline-flex items-center gap-1 h-5 px-2 rounded-md text-[10px] leading-none font-semibold bg-primary text-primary-foreground hover:opacity-90 shadow-md cursor-pointer disabled:opacity-70 transition-all duration-200 ease-out ${
                            isProbing
                              ? 'opacity-100 scale-100 translate-x-0 pointer-events-auto'
                              : 'opacity-0 scale-95 translate-x-1 pointer-events-none group-hover/name:opacity-100 group-hover/name:scale-100 group-hover/name:translate-x-0 group-hover/name:pointer-events-auto'
                          }`}
                          title={
                            isProbing
                              ? t('residentialI18n.nodes.probingTitle')
                              : egressInfo
                                ? t('residentialI18n.nodes.copyIpTitle', {
                                    ip: egressInfo.ip,
                                    region: ` (${egressInfo.region || t('common.unknown')})`,
                                  })
                                : t('residentialI18n.nodes.detectIpTitle')
                          }
                        >
                          {isProbing ? (
                            <>
                              <Loader2 className="w-2.5 h-2.5 animate-spin" />
                              <span>{t('residentialI18n.nodes.probing')}</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-2.5 h-2.5" />
                              <span>{t('residentialI18n.nodes.copyIp')}</span>
                            </>
                          )}
                        </button>
                      </div>
                      <div className="text-[11px] text-muted-foreground font-mono truncate flex items-center gap-1">
                        <Server className="w-2.5 h-2.5 shrink-0" />
                        <span className="truncate">
                          {node.server}:{node.port}
                        </span>
                      </div>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium border uppercase shrink-0 ${getProtocolBadgeProps(node.type).className}`}
                    >
                      {getProtocolBadgeProps(node.type).label}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
