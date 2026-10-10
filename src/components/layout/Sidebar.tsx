import {
  Activity,
  Compass,
  Cpu,
  FolderOpen,
  Globe,
  Layers,
  Network,
  Palette,
  Power,
  RefreshCw,
  Settings,
  Sparkles,
} from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import appLogo from '../../../src-tauri/icons/icon.png'
import { type TabType, useAppStore } from '../../stores/appStore'
import { Button } from '../common'
import { TrafficWidget } from './TrafficWidget'
import { DEFAULT_CONTROLLER_PORT } from '../../constants'
import { scrollToSettingCard } from '../../utils/scroll'

const navItems: { id: TabType; label: string; icon: React.ElementType }[] = [
  { id: 'ports', label: '端口映射', icon: Network },
  { id: 'proxies', label: '代理节点', icon: Compass },
  { id: 'profiles', label: '配置订阅', icon: Layers },
  { id: 'connections', label: '实时连接', icon: Activity },
  { id: 'settings', label: '设置', icon: Settings },
]

const settingSections = [
  {
    id: 'setting-section-core',
    label: '内核与网络',
    icon: Cpu,
    color: 'hover:text-blue-500 hover:bg-blue-500/10',
  },
  {
    id: 'setting-section-proxy',
    label: '系统代理',
    icon: Globe,
    color: 'hover:text-emerald-500 hover:bg-emerald-500/10',
  },
  {
    id: 'setting-section-tun',
    label: 'TUN 模式',
    icon: Network,
    color: 'hover:text-cyan-500 hover:bg-cyan-500/10',
  },
  {
    id: 'setting-section-appearance',
    label: '外观个性化',
    icon: Palette,
    color: 'hover:text-purple-500 hover:bg-purple-500/10',
  },
  {
    id: 'setting-section-system',
    label: '窗口与系统',
    icon: Power,
    color: 'hover:text-amber-500 hover:bg-amber-500/10',
  },
  {
    id: 'setting-section-storage',
    label: '存储目录',
    icon: FolderOpen,
    color: 'hover:text-indigo-500 hover:bg-indigo-500/10',
  },
  {
    id: 'setting-section-about',
    label: '关于与更新',
    icon: Sparkles,
    color: 'hover:text-rose-500 hover:bg-rose-500/10',
  },
]

export const Sidebar: React.FC = () => {
  const activeTab = useAppStore((state) => state.activeTab)
  const setActiveTab = useAppStore((state) => state.setActiveTab)
  const scrollToSettingSection = useAppStore(
    (state) => state.scrollToSettingSection,
  )
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed)
  const toggleSidebar = useAppStore((state) => state.toggleSidebar)
  const coreStatus = useAppStore((state) => state.coreStatus)
  const restartCore = useAppStore((state) => state.restartCore)
  const coreLoading = useAppStore((state) => state.coreLoading)

  const isRunning = coreStatus?.running ?? false
  const activeIndex = navItems.findIndex((item) => item.id === activeTab)
  const [isSettingsHovered, setIsSettingsHovered] = useState(false)
  const hoverTimeoutRef = useRef<number | undefined>(undefined)

  const handleMouseEnterSettings = () => {
    clearTimeout(hoverTimeoutRef.current)
    setIsSettingsHovered(true)
  }

  const handleMouseLeaveSettings = () => {
    clearTimeout(hoverTimeoutRef.current)
    hoverTimeoutRef.current = window.setTimeout(() => {
      setIsSettingsHovered(false)
    }, 180)
  }

  useEffect(() => {
    return () => {
      clearTimeout(hoverTimeoutRef.current)
    }
  }, [])

  const handleSectionClick = (e: React.MouseEvent, sectionId: string) => {
    e.stopPropagation()
    if (activeTab === 'settings') {
      scrollToSettingCard(sectionId, true)
    } else {
      scrollToSettingSection(sectionId)
    }
  }
  return (
    <aside
      className={`${
        sidebarCollapsed ? 'w-16' : 'w-48'
      } bg-card border-r border-border flex flex-col justify-between select-none shrink-0 transition-all duration-200 ease-in-out`}
    >
      <div>
        {/* App Branding & Collapse Toggle */}
        <div
          className={`pt-3 mb-3 flex items-center ${
            sidebarCollapsed ? 'justify-center px-2' : 'justify-between px-3.5'
          } overflow-hidden`}
        >
          {sidebarCollapsed ? (
            <button
              type="button"
              onClick={toggleSidebar}
              className="rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 hover:opacity-80 transition-opacity"
              title="点击展开侧边栏"
            >
              <img
                src={appLogo}
                alt="Mihomo Multi"
                className="w-8 h-8 rounded-lg object-contain shadow-sm"
              />
            </button>
          ) : (
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                type="button"
                onClick={toggleSidebar}
                className="shrink-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 hover:opacity-80 transition-opacity"
                title="点击收起侧边栏"
              >
                <img
                  src={appLogo}
                  alt="Mihomo Multi"
                  className="w-8 h-8 rounded-lg object-contain shadow-sm"
                />
              </button>
              <div className="min-w-0 truncate">
                <div className="flex items-center gap-1.5">
                  <h1 className="font-semibold text-xs leading-none text-foreground truncate">
                    Mihomo Multi
                  </h1>
                  {import.meta.env.DEV && (
                    <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-amber-500/15 text-amber-500 border border-amber-500/30 leading-none select-none shrink-0">
                      DEV
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground truncate block mt-1">
                  多端口代理
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Navigation with Sliding Highlight Pill */}
        <nav className="px-2 space-y-1 relative">
          {/* Sliding Pill Indicator */}
          {activeIndex >= 0 && (
            <div
              className="absolute left-2 right-2 rounded-lg bg-black/5 border border-black/10 dark:bg-white/12 dark:border-white/15 shadow-xs transition-transform duration-200 ease-out pointer-events-none"
              style={{
                height: '36px',
                transform: `translateY(${activeIndex * 40}px)`,
                top: '0px',
              }}
            />
          )}

          {navItems.map((item) => {
            const Icon = item.icon
            const active = activeTab === item.id
            const isSettingsItem = item.id === 'settings'

            const buttonContent = (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                title={sidebarCollapsed ? item.label : undefined}
                className={`relative z-10 w-full h-9 flex items-center ${
                  sidebarCollapsed ? 'justify-center px-0' : 'gap-2.5 px-3'
                } rounded-lg text-xs font-medium transition-colors duration-150 ${
                  active
                    ? 'text-foreground font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {!sidebarCollapsed && (
                  <span className="truncate">{item.label}</span>
                )}
              </button>
            )

            if (!isSettingsItem) {
              return buttonContent
            }

            return (
              <div
                key={item.id}
                className="relative"
                onMouseEnter={handleMouseEnterSettings}
                onMouseLeave={handleMouseLeaveSettings}
              >
                {buttonContent}

                {/* 悬浮丝滑弹出一束设置区域快捷图标 */}
                <div
                  className={`overflow-hidden transition-all duration-300 ease-out origin-top ${
                    isSettingsHovered
                      ? 'max-h-96 opacity-100 scale-100 mt-1 pointer-events-auto'
                      : 'max-h-0 opacity-0 scale-95 pointer-events-none mt-0'
                  }`}
                >
                  <div
                    className={`rounded-xl border border-border/70 bg-secondary/35 backdrop-blur-sm shadow-xs ${
                      sidebarCollapsed
                        ? 'p-1 flex flex-col gap-0.5 items-center'
                        : 'p-1.5 grid grid-cols-4 gap-1'
                    }`}
                  >
                    {settingSections.map((section, idx) => {
                      const SecIcon = section.icon
                      return (
                        <button
                          key={section.id}
                          type="button"
                          onClick={(e) => handleSectionClick(e, section.id)}
                          title={section.label}
                          style={{
                            transitionDelay: isSettingsHovered
                              ? `${idx * 20}ms`
                              : '0ms',
                          }}
                          className={`flex items-center justify-center rounded-md text-muted-foreground transition-all duration-150 active:scale-90 hover:shadow-xs ${section.color} ${
                            sidebarCollapsed ? 'w-7 h-7' : 'w-full h-8 p-1.5'
                          }`}
                        >
                          <SecIcon className="w-3.5 h-3.5 shrink-0" />
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            )
          })}
        </nav>
      </div>

      {/* Bottom Section: Traffic Widget + Core Supervisor Widget */}
      <div className="flex flex-col">
        {/* 1. 实时网速独立盒子 */}
        <TrafficWidget
          collapsed={sidebarCollapsed}
          isRunning={isRunning}
          port={coreStatus?.controllerPort}
          secret={coreStatus?.secret}
        />

        {/* 2. 内核控制独立盒子 */}
        {sidebarCollapsed ? (
          <div className="p-2 mx-2 mb-2 rounded-xl border border-border bg-background/50 flex flex-col items-center gap-2">
            <div
              className="flex items-center justify-center cursor-default py-1"
              title={`Mihomo 内核: ${isRunning ? '运行中' : '已停止'}${
                isRunning
                  ? `\nPID: ${coreStatus?.pid ?? '-'}\n控制端口: ${
                      coreStatus?.controllerPort ?? DEFAULT_CONTROLLER_PORT
                    }`
                  : ''
              }`}
            >
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  isRunning ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
                }`}
              />
            </div>

            <Button
              variant="ghost"
              size="sm"
              disabled={coreLoading}
              onClick={() => restartCore()}
              title="重启内核"
              className="p-1.5 h-auto text-muted-foreground hover:text-foreground hover:bg-accent"
              icon={
                <RefreshCw
                  className={`w-3.5 h-3.5 ${coreLoading ? 'animate-spin' : ''}`}
                />
              }
            />
          </div>
        ) : (
          <div className="p-3 mx-2.5 mb-2.5 rounded-xl border border-border bg-background/50 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted-foreground truncate">
                Mihomo 内核
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
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
              <div className="text-[10px] text-muted-foreground space-y-0.5 font-mono truncate">
                <div>PID: {coreStatus?.pid ?? '-'}</div>
                <div>
                  控制端口:{' '}
                  {coreStatus?.controllerPort ?? DEFAULT_CONTROLLER_PORT}
                </div>
              </div>
            )}

            <Button
              variant="secondary"
              size="sm"
              disabled={coreLoading}
              onClick={() => restartCore()}
              className="w-full text-xs"
              icon={
                <RefreshCw
                  className={`w-3 h-3 ${coreLoading ? 'animate-spin' : ''}`}
                />
              }
            >
              重启内核
            </Button>
          </div>
        )}
      </div>
    </aside>
  )
}
