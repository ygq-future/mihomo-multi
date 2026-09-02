import { convertFileSrc } from '@tauri-apps/api/core'
import type React from 'react'
import { useEffect } from 'react'
import { useAppStore } from '../../stores/appStore'
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
  const { activeTab, config } = useAppStore()

  // Apply theme globally whenever config.theme changes
  useEffect(() => {
    const theme = config?.theme || 'system'
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
    </div>
  )
}
