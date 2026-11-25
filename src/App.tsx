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
    const scope = createEventScope()
    scope.listen<string>('app:language-changed', (event) => {
      const nextLocale = event.payload
      if (nextLocale === 'zh-CN' || nextLocale === 'en-US') {
        if (useI18nStore.getState().locale !== nextLocale) {
          useI18nStore.getState().setLocale(nextLocale)
        }
      }
    })
    return () => {
      scope.dispose()
    }
  }, [])

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
          t('app.profileUpdateFailed', {
            name: payload.profileName,
            error: payload.error || t('app.profileUpdateFallbackError'),
          }),
          t('app.profileUpdateFailedTitle'),
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
        toast.error(event.payload, t('app.portToggleFailedTitle'))
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

        const reason = payload.reason
          ? t('app.kernelCrashedReason', { reason: payload.reason })
          : ''

        if (payload.systemProxySuspended) {
          toast.error(
            t('app.kernelCrashedProtection', { reason }),
            t('app.kernelCrashedProtectionTitle'),
          )
        } else {
          toast.error(
            t('app.kernelCrashed', { reason }),
            t('app.kernelCrashedTitle'),
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
          t('app.proxyRestored', { port: payload.port }),
          t('app.proxyRestoredTitle'),
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
