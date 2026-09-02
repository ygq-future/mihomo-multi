import { AlertTriangle, RefreshCw } from 'lucide-react'
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
    title: '系统设置',
    subtitle: '管理应用偏好、数据存储与 Mihomo 内核控制参数',
  },
}

export const Header: React.FC = () => {
  const {
    activeTab,
    config,
    coreStatus,
    restartCore,
    startCore,
    coreLoading,
    error,
  } = useAppStore()
  const info = tabTitles[activeTab] || tabTitles.ports

  const isRunning = coreStatus?.running ?? false
  const portNeedsRestart =
    config?.controllerPort !== undefined &&
    coreStatus?.controllerPort !== undefined &&
    config.controllerPort !== coreStatus.controllerPort

  return (
    <header className="h-[52px] px-5 border-b border-border bg-card/50 flex items-center justify-between select-none shrink-0 gap-4">
      <div className="min-w-0 flex-1 truncate">
        <h2 className="text-sm font-semibold text-foreground leading-tight truncate">
          {info.title}
        </h2>
        <p className="text-[11px] text-muted-foreground leading-none mt-1 truncate">
          {info.subtitle}
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {portNeedsRestart ? (
          <div className="flex items-center gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-medium">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span>
                控制器端口已修改为 {config?.controllerPort}，需
                {isRunning ? '重启' : '启动'}生效
              </span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled={coreLoading}
              onClick={() => (isRunning ? restartCore() : startCore())}
              className="text-xs py-1 h-auto border-amber-500/30 hover:bg-amber-500/10 text-amber-600 dark:text-amber-400"
              icon={
                <RefreshCw
                  className={`w-3 h-3 ${coreLoading ? 'animate-spin' : ''}`}
                />
              }
            >
              {isRunning ? '重启生效' : '启动生效'}
            </Button>
          </div>
        ) : (
          !isRunning &&
          error && (
            <div className="flex items-center gap-2 animate-in fade-in duration-200">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs font-medium">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                <span className="max-w-xs truncate" title={error}>
                  {error}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={coreLoading}
                onClick={() => startCore()}
                className="text-xs py-1 h-auto text-rose-500 border-rose-500/30 hover:bg-rose-500/10"
                icon={
                  <RefreshCw
                    className={`w-3 h-3 ${coreLoading ? 'animate-spin' : ''}`}
                  />
                }
              >
                重试启动
              </Button>
            </div>
          )
        )}
      </div>
    </header>
  )
}
