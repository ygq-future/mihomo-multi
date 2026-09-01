import { Play, RefreshCw, Square } from 'lucide-react'
import type React from 'react'
import { useAppStore } from '../../stores/appStore'
import { Button } from '../common'

const tabTitles: Record<string, { title: string; subtitle: string }> = {
  ports: {
    title: '端口监听管理器',
    subtitle: '配置本地多入站端口与代理节点 1:1 确定性映射',
  },
  proxies: {
    title: '代理节点列表',
    subtitle: '查看订阅节点池并执行批量并发延迟测速',
  },
  profiles: {
    title: '订阅配置管理',
    subtitle: '导入与自动同步远程订阅或本地 Clash YAML 配置',
  },
  settings: {
    title: '内核与系统设置',
    subtitle: 'Mihomo Sidecar 伴生进程守护与外部控制器配置',
  },
}

export const Header: React.FC = () => {
  const { activeTab, coreStatus, startCore, stopCore, restartCore, loading } =
    useAppStore()
  const info = tabTitles[activeTab] || tabTitles.ports
  const isRunning = coreStatus?.running ?? false

  return (
    <header className="h-16 px-6 border-b border-border bg-card/50 flex items-center justify-between select-none shrink-0">
      <div>
        <h2 className="text-base font-semibold text-foreground">
          {info.title}
        </h2>
        <p className="text-xs text-muted-foreground">{info.subtitle}</p>
      </div>

      <div className="flex items-center gap-2">
        {isRunning ? (
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => stopCore()}
            className="text-rose-500 hover:bg-rose-500/10 border-rose-500/20"
            icon={<Square className="w-3.5 h-3.5 fill-current" />}
          >
            停止内核
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            disabled={loading}
            onClick={() => startCore()}
            className="bg-emerald-600 hover:bg-emerald-500 text-white"
            icon={<Play className="w-3.5 h-3.5 fill-current" />}
          >
            启动内核
          </Button>
        )}

        <Button
          variant="secondary"
          size="sm"
          disabled={loading}
          onClick={() => restartCore()}
          title="热重载 / 重启内核"
          icon={
            <RefreshCw
              className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
            />
          }
        />
      </div>
    </header>
  )
}
