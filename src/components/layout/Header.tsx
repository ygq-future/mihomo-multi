import { Play, RefreshCw, Square } from 'lucide-react'
import type React from 'react'
import { useAppStore } from '../../stores/appStore'

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
    <header className="h-16 px-6 border-b border-border bg-card/50 flex items-center justify-between select-none">
      <div>
        <h2 className="text-base font-semibold text-foreground">
          {info.title}
        </h2>
        <p className="text-xs text-muted-foreground">{info.subtitle}</p>
      </div>

      <div className="flex items-center gap-2">
        {isRunning ? (
          <button
            type="button"
            disabled={loading}
            onClick={() => stopCore()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-rose-500/10 text-rose-500 border border-rose-500/20 text-xs font-medium hover:bg-rose-500/20 transition-colors disabled:opacity-50"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>停止内核</span>
          </button>
        ) : (
          <button
            type="button"
            disabled={loading}
            onClick={() => startCore()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-500 text-white text-xs font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50 shadow-sm"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>启动内核</span>
          </button>
        )}

        <button
          type="button"
          disabled={loading}
          onClick={() => restartCore()}
          title="热重载 / 重启内核"
          className="p-2 rounded-md bg-secondary text-secondary-foreground hover:bg-accent transition-colors disabled:opacity-50"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
          />
        </button>
      </div>
    </header>
  )
}
