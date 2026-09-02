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
    title: '系统与内核设置',
    subtitle: 'Mihomo Sidecar 伴生进程守护与外部控制器配置',
  },
}

export const Header: React.FC = () => {
  const { activeTab } = useAppStore()
  const info = tabTitles[activeTab] || tabTitles.ports

  return (
    <header className="h-16 px-6 border-b border-border bg-card/50 flex items-center justify-between select-none shrink-0">
      <div>
        <h2 className="text-base font-semibold text-foreground">
          {info.title}
        </h2>
        <p className="text-xs text-muted-foreground">{info.subtitle}</p>
      </div>
    </header>
  )
}
