import type React from 'react'
import { useEffect, useRef } from 'react'
import { ToastContainer, toast } from './components/common'
import { Shell } from './components/layout/Shell'
import { useAppUpdateCheck } from './hooks/useAppUpdateCheck'
import { useAppStore } from './stores/appStore'
import { appReady, setUiLocale } from './services/tauri'
import { createEventScope } from './services/events'
import { useWindowVisibility } from './services/useWindowVisibility'
import { t, useI18nStore } from './i18n'
import type {
  AutoUpdateEventPayload,
  KernelCrashedPayload,
  LatencyProgressPayload,
  LatencyUpdatePayload,
  PortDriftReport,
  ProxyRestoredPayload,
} from './types'
export const App: React.FC = () => {
  const fetchStatus = useAppStore((state) => state.fetchStatus)
  const fetchConfig = useAppStore((state) => state.fetchConfig)
  const fetchTunStatus = useAppStore((state) => state.fetchTunStatus)
  const fetchProfiles = useAppStore((state) => state.fetchProfiles)
  const fetchPortMappings = useAppStore((state) => state.fetchPortMappings)
  const fetchAutoUpdaterStatus = useAppStore(
    (state) => state.fetchAutoUpdaterStatus,
  )
  const fetchLatencies = useAppStore((state) => state.fetchLatencies)
  const handleLatencyUpdate = useAppStore((state) => state.handleLatencyUpdate)
  const handleLatencyProgress = useAppStore(
    (state) => state.handleLatencyProgress,
  )
  const setDriftReports = useAppStore((state) => state.setDriftReports)
  const isWindowVisible = useWindowVisibility()
  const locale = useI18nStore((state) => state.locale)
  // The backend destroys the hidden webview of a silent lightweight startup on `app_ready`.
  // Gate that call on the tray locale sync so the tray never closes on its default language.
  const localeSync = useRef<Promise<void>>(Promise.resolve())
  useAppUpdateCheck()

  useEffect(() => {
    let cancelled = false
    localeSync.current = setUiLocale(locale).catch((error: unknown) => {
      if (cancelled) return
      console.error('[i18n] Failed to sync the tray language:', error)
      toast.error(
        error instanceof Error ? error.message : String(error),
        t('settings.language.title'),
      )
    })
    return () => {
      cancelled = true
    }
  }, [locale])

  useEffect(() => {
    fetchConfig()
    fetchLatencies().catch(() => {})

    let isRevealed = false
    const revealWindow = () => {
      if (isRevealed) return
      isRevealed = true
      const notifyReady = () => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            appReady().catch(() => {})
          })
        })
      }
      // Both success and failure settle the gate: a failing locale sync must not leave the
      // hidden lightweight webview alive until the backend fallback timer fires.
      localeSync.current.catch(() => {}).then(notifyReady)
    }

    // Safety timeout to avoid stalling window presentation
    const revealTimeout = setTimeout(revealWindow, 500)

    // Initial load: fetch status and port mappings
    Promise.all([fetchStatus(), fetchPortMappings()])
      .then(() => {
        const state = useAppStore.getState()
        if (state.coreStatus?.running || state.coreStatus?.lastError) {
          revealWindow()
        }
      })
      .catch(() => {
        revealWindow()
      })
    // Listen for Tauri backend events using managed EventScope
    const scope = createEventScope()

    scope
      .listen<AutoUpdateEventPayload>('profile-auto-updated', (event) => {
        const payload = event.payload
        fetchProfiles().catch(() => {})
        fetchPortMappings().catch(() => {})
        fetchStatus().catch(() => {})
        fetchAutoUpdaterStatus().catch(() => {})

        if (payload.driftedPortsCount > 0) {
          toast.warning(
            t('app.profileUpdatedWithDrift', {
              name: payload.profileName,
              count: payload.newNodeCount,
              drifted: payload.driftedPortsCount,
            }),
            t('app.profileUpdatedWithDriftTitle'),
          )
        } else {
          toast.success(
            t('app.profileUpdated', {
              name: payload.profileName,
              count: payload.newNodeCount,
            }),
          )
        }
      })
      .catch(() => {})

    scope
      .listen<PortDriftReport[]>('node-drift-detected', (event) => {
        setDriftReports(event.payload)
        fetchPortMappings().catch(() => {})
      })
      .catch(() => {})

    scope
      .listen<AutoUpdateEventPayload>('profile-update-failed', (event) => {
        const payload = event.payload
        toast.error(
          `订阅「${payload.profileName}」拉取失败：${payload.error || '网络或解析异常'}`,
          '订阅自动更新失败',
        )
      })
      .catch(() => {})

    scope
      .listen('port-mappings-changed', () => {
        fetchPortMappings().catch(() => {})
        fetchStatus().catch(() => {})
        fetchConfig().catch(() => {})
        fetchTunStatus().catch(() => {})
      })
      .catch(() => {})

    scope
      .listen<string>('port-toggle-error', (event) => {
        toast.error(event.payload, '托盘端口切换失败')
      })
      .catch(() => {})

    scope
      .listen<LatencyUpdatePayload>('latency-update', (event) => {
        handleLatencyUpdate(event.payload)
      })
      .catch(() => {})

    scope
      .listen<LatencyProgressPayload>('latency-progress', (event) => {
        handleLatencyProgress(event.payload)
      })
      .catch(() => {})

    scope
      .listen<KernelCrashedPayload>('kernel-crashed', (event) => {
        const payload = event.payload
        fetchStatus().catch(() => {})
        fetchConfig().catch(() => {})

        if (payload.systemProxySuspended) {
          toast.error(
            `Mihomo 内核异常退出${payload.reason ? `（${payload.reason}）` : ''}。为防止全系统断网，已自动关闭系统代理并切换为 DIRECT 直连。`,
            '内核异常退出与断网保护',
          )
        } else {
          toast.error(
            `Mihomo 内核异常退出${payload.reason ? `（${payload.reason}）` : ''}，请检查内核运行日志。`,
            '内核异常停止',
          )
        }
      })
      .catch(() => {})

    scope
      .listen<ProxyRestoredPayload>('proxy-restored', (event) => {
        const payload = event.payload
        fetchStatus().catch(() => {})
        fetchConfig().catch(() => {})

        toast.success(
          `Mihomo 内核已恢复运行，系统代理已自动恢复绑定至端口 :${payload.port}。`,
          '系统代理自动恢复',
        )
      })
      .catch(() => {})
    scope
      .listen('core-status-changed', () => {
        fetchStatus()
          .then(() => {
            revealWindow()
          })
          .catch(() => {
            revealWindow()
          })
      })
      .catch(() => {})

    return () => {
      clearTimeout(revealTimeout)
      scope.dispose()
    }
  }, [
    fetchStatus,
    fetchConfig,
    fetchTunStatus,
    fetchProfiles,
    fetchPortMappings,
    fetchAutoUpdaterStatus,
    fetchLatencies,
    handleLatencyUpdate,
    handleLatencyProgress,
    setDriftReports,
  ])

  useEffect(() => {
    if (!isWindowVisible) return
    const interval = setInterval(() => {
      fetchStatus()
    }, 3000)
    return () => clearInterval(interval)
  }, [isWindowVisible, fetchStatus])

  return (
    <>
      <Shell />
      <ToastContainer />
    </>
  )
}

export default App
