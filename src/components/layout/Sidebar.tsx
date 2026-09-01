import { Compass, Layers, Network, RefreshCw, Settings } from 'lucide-react'
import type React from 'react'
import { type TabType, useAppStore } from '../../stores/appStore'

const navItems: { id: TabType; label: string; icon: React.ElementType }[] = [
  { id: 'ports', label: '端口映射', icon: Network },
  { id: 'proxies', label: '代理节点', icon: Compass },
  { id: 'profiles', label: '配置订阅', icon: Layers },
  { id: 'settings', label: '内核与设置', icon: Settings },
]

export const Sidebar: React.FC = () => {
  const { activeTab, setActiveTab, coreStatus, restartCore, loading } =
    useAppStore()

  const isRunning = coreStatus?.running ?? false

  return (
    <aside className="w-56 bg-card border-r border-border flex flex-col justify-between select-none">
      <div>
        {/* App Branding */}
        <div className="h-16 px-5 flex items-center gap-3 border-b border-border">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold text-lg shadow-sm">
            M
          </div>
          <div>
            <h1 className="font-semibold text-sm leading-none text-foreground">
              Mihomo Multi
            </h1>
            <span className="text-[11px] text-muted-foreground">
              多端口代理
            </span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = activeTab === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-md text-xs font-medium transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>
      </div>

      {/* Core Supervisor Status Widget */}
      <div className="p-3 m-3 rounded-lg border border-border bg-background/50 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted-foreground">
            Mihomo 内核
          </span>
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                isRunning ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
              }`}
            />
            <span
              className={`text-[11px] font-medium ${
                isRunning ? 'text-emerald-500' : 'text-rose-500'
              }`}
            >
              {isRunning ? '运行中' : '已停止'}
            </span>
          </div>
        </div>

        {isRunning && (
          <div className="text-[11px] text-muted-foreground space-y-0.5 font-mono">
            <div>PID: {coreStatus?.pid ?? '-'}</div>
            <div>端口: {coreStatus?.controller_port ?? 9999}</div>
          </div>
        )}

        <button
          type="button"
          disabled={loading}
          onClick={() => restartCore()}
          className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md bg-secondary text-secondary-foreground text-xs hover:bg-accent transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          <span>重启内核</span>
        </button>
      </div>
    </aside>
  )
}
