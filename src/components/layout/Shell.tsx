import { convertFileSrc } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Check, LogOut } from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import * as api from '../../services/tauri'
import { useAppStore } from '../../stores/appStore'
import { Button, Modal } from '../common'
import { PortTableView } from '../views/PortTableView'
import { ProfileListView } from '../views/ProfileListView'
import { ProxyGridView } from '../views/ProxyGridView'
import { SettingView } from '../views/SettingView'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
function resolveImageSrc(src: string): string {
  if (!src) return ''
  if (
    src.startsWith('data:') ||
    src.startsWith('http://') ||
    src.startsWith('https://') ||
    src.startsWith('blob:')
  ) {
    return src
  }
  try {
    return convertFileSrc(src)
  } catch {
    return src
  }
}

export const Shell: React.FC = () => {
  const { activeTab, config, saveConfig } = useAppStore()
  const [showExitModal, setShowExitModal] = useState(false)
  const [closeToTrayChecked, setCloseToTrayChecked] = useState(false)

  useEffect(() => {
    let unlisten: (() => void) | undefined
    listen('request-window-close', () => {
      setCloseToTrayChecked(false)
      setShowExitModal(true)
    })
      .then((fn) => {
        unlisten = fn
      })
      .catch(() => {})

    return () => {
      if (unlisten) unlisten()
    }
  }, [])

  const handleConfirmExit = async () => {
    if (closeToTrayChecked) {
      if (config) {
        try {
          await saveConfig({ ...config, closeToTray: true })
        } catch {
          // continue
        }
      }
      setShowExitModal(false)
      await api.hideWindow()
    } else {
      setShowExitModal(false)
      await api.exitApp()
    }
  }

  // Apply theme globally whenever config.theme changes
  useEffect(() => {
    const cachedTheme =
      typeof window !== 'undefined' ? localStorage.getItem('app_theme') : null
    const theme = config?.theme || cachedTheme || 'system'
    const root = document.documentElement

    const applyTheme = () => {
      if (theme === 'dark') {
        root.classList.add('dark')
        root.classList.remove('light')
      } else if (theme === 'light') {
        root.classList.remove('dark')
        root.classList.add('light')
      } else {
        // System preference
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
        if (isDark) {
          root.classList.add('dark')
          root.classList.remove('light')
        } else {
          root.classList.remove('dark')
          root.classList.add('light')
        }
      }
    }

    applyTheme()

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const handler = () => applyTheme()
      mediaQuery.addEventListener('change', handler)
      return () => mediaQuery.removeEventListener('change', handler)
    }
  }, [config?.theme])

  // Apply acrylic CSS variables and data attribute globally
  useEffect(() => {
    const root = document.documentElement
    if (config?.acrylicEffect) {
      root.setAttribute('data-acrylic', 'true')
      root.style.setProperty('--acrylic-blur', `${config.acrylicBlur ?? 12}px`)
      root.style.setProperty(
        '--acrylic-opacity',
        `${(config.acrylicOpacity ?? 65) / 100}`,
      )
    } else {
      root.removeAttribute('data-acrylic')
      root.style.removeProperty('--acrylic-blur')
      root.style.removeProperty('--acrylic-opacity')
    }
  }, [config?.acrylicEffect, config?.acrylicBlur, config?.acrylicOpacity])

  const renderContent = () => {
    switch (activeTab) {
      case 'ports':
        return <PortTableView />
      case 'proxies':
        return <ProxyGridView />
      case 'profiles':
        return <ProfileListView />
      case 'settings':
        return <SettingView />
      default:
        return <PortTableView />
    }
  }

  const bgImg = config?.backgroundImage || ''
  const resolvedBg = resolveImageSrc(bgImg)
  const bgOpacity = (config?.backgroundOpacity ?? 80) / 100

  return (
    <div
      className={`relative flex h-screen w-screen overflow-hidden text-foreground select-none ${
        resolvedBg ? 'bg-transparent' : 'bg-background'
      }`}
    >
      {/* 1. Full-screen Background Image Layer (Always at base z-0) */}
      {resolvedBg && (
        <div
          className="fixed inset-0 bg-cover bg-center pointer-events-none transition-opacity duration-300"
          style={{
            backgroundImage: `url(${JSON.stringify(resolvedBg)})`,
            opacity: bgOpacity,
            zIndex: 0,
          }}
        />
      )}

      {/* 2. Main Application Content (Positioned above background at z-10) */}
      <div className="relative z-10 flex h-screen w-screen overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <Header />
          <main className="flex-1 overflow-y-auto">{renderContent()}</main>
        </div>
      </div>

      {/* Exit Confirmation Modal */}
      {showExitModal && (
        <Modal
          isOpen={showExitModal}
          onClose={() => setShowExitModal(false)}
          title="退出程序"
          subtitle="确定要完全退出应用吗？"
          maxWidth="sm"
          icon={<LogOut className="w-4 h-4 text-primary" />}
          bodyClassName="p-5"
          footer={
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowExitModal(false)}
              >
                取消
              </Button>
              <Button
                variant={closeToTrayChecked ? 'primary' : 'danger'}
                size="sm"
                onClick={handleConfirmExit}
              >
                {closeToTrayChecked ? '最小化到托盘' : '退出程序'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              {closeToTrayChecked
                ? '已开启最小化到托盘，主窗口将隐藏至系统托盘，后台代理与端口监听持续运行。'
                : '退出后将停止 Mihomo 后台内核并中断所有端口的代理转发。'}
            </p>

            <label className="flex items-center gap-2.5 p-3 rounded-lg border border-border/80 bg-secondary/20 hover:bg-secondary/40 select-none cursor-pointer transition-colors group">
              <span
                className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                  closeToTrayChecked
                    ? 'bg-primary border-primary text-primary-foreground shadow-sm'
                    : 'border-border/80 bg-background/60 group-hover:border-primary/50'
                }`}
              >
                {closeToTrayChecked && <Check className="w-3 h-3 stroke-[3]" />}
              </span>
              <span className="text-xs font-medium text-foreground/90">
                最小化到系统托盘（保持后台运行并记住选择）
              </span>
              <input
                type="checkbox"
                checked={closeToTrayChecked}
                onChange={(e) => setCloseToTrayChecked(e.target.checked)}
                className="sr-only"
              />
            </label>
          </div>
        </Modal>
      )}
    </div>
  )
}
