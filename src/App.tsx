import type React from 'react'
import { useEffect, useRef } from 'react'
import { ToastContainer, toast } from './components/common'
import { Shell } from './components/layout/Shell'
import { useAppStore } from './stores/appStore'
import { appReady, checkAppUpdate } from './services/tauri'
import { APP_VERSION } from './constants'
import { isVersionNewer, saveCachedAppUpdate } from './utils/appUpdateCache'
import { createEventScope } from './services/events'
import { useWindowVisibility } from './services/useWindowVisibility'
import type {
  AppUpdateCheckResult,
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
  const config = useAppStore((state) => state.config)
  const coreStatus = useAppStore((state) => state.coreStatus)
  const scrollToSettingSection = useAppStore(
    (state) => state.scrollToSettingSection,
  )
  const setAppUpdateInfo = useAppStore((state) => state.setAppUpdateInfo)
  const hasCheckedUpdateRef = useRef(false)
  const isCheckingUpdateRef = useRef(false)

  useEffect(() => {
    if (!config || hasCheckedUpdateRef.current || isCheckingUpdateRef.current) {
      return
    }
    if (config.checkUpdateOnStart === false) return

    // 若指定了代理端口但内核尚未处于运行状态，等待内核就绪
    // 但若内核 5 秒后仍未运行，由兜底定时器唤醒直连检查
    if (config.updateProxyPort && !coreStatus?.running) {
      const fallbackTimer = setTimeout(() => {
        if (!hasCheckedUpdateRef.current && !isCheckingUpdateRef.current) {
          isCheckingUpdateRef.current = true
          checkAppUpdate(null)
            .then((res) => {
              hasCheckedUpdateRef.current = true
              setAppUpdateInfo(res)
              if (!res?.hasUpdate) return
              const currentVersion = APP_VERSION.replace(/^v/i, '')
              if (isVersionNewer(currentVersion, res.latestVersion)) {
                saveCachedAppUpdate(res, Date.now())
                toast.info(
                  `发现新版本 v${res.latestVersion}，前往「设置 -> 软件关于与更新」即可查看并下载更新。`,
                  '发现新版本',
                  8000,
                  {
                    label: '立即前往',
                    onClick: () => {
                      scrollToSettingSection('setting-section-about')
                    },
                  },
                )
              }
            })
            .catch((err) => {
              console.debug(
                '[AppUpdate] Direct fallback update check failed:',
                err,
              )
            })
            .finally(() => {
              isCheckingUpdateRef.current = false
            })
        }
      }, 5000)

      return () => clearTimeout(fallbackTimer)
    }

    isCheckingUpdateRef.current = true

    // 缓冲 2.5 秒，保证代理连接就绪且首屏加载顺畅
    const timer = setTimeout(async () => {
      try {
        let res: AppUpdateCheckResult | null = null
        if (config.updateProxyPort) {
          try {
            res = await checkAppUpdate(config.updateProxyPort)
          } catch (proxyErr) {
            console.debug(
              '[AppUpdate] Proxy check failed, falling back to direct:',
              proxyErr,
            )
            res = await checkAppUpdate(null)
          }
        } else {
          res = await checkAppUpdate(null)
        }

        hasCheckedUpdateRef.current = true

        setAppUpdateInfo(res)
        if (!res || !res.hasUpdate) return
        const currentVersion = APP_VERSION.replace(/^v/i, '')
        if (isVersionNewer(currentVersion, res.latestVersion)) {
          saveCachedAppUpdate(res, Date.now())
          toast.info(
            `发现新版本 v${res.latestVersion}，前往「设置 -> 软件关于与更新」即可查看并下载更新。`,
            '发现新版本',
            8000,
            {
              label: '立即前往',
              onClick: () => {
                scrollToSettingSection('setting-section-about')
              },
            },
          )
        }
      } catch (err) {
        console.debug('[AppUpdate] Startup update check failed:', err)
      } finally {
        isCheckingUpdateRef.current = false
      }
    }, 2500)

    return () => {
      clearTimeout(timer)
      isCheckingUpdateRef.current = false
    }
  }, [config, coreStatus?.running, scrollToSettingSection, setAppUpdateInfo])
  useEffect(() => {
    fetchConfig()
    fetchLatencies().catch(() => {})

    let isRevealed = false
    const revealWindow = () => {
      if (isRevealed) return
      isRevealed = true
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          appReady().catch(() => {})
        })
      })
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
            `订阅「${payload.profileName}」已更新（${payload.newNodeCount} 个节点），检测到 ${payload.driftedPortsCount} 个端口发生节点漂移并已自动启用 DIRECT 兜底。`,
            '订阅更新与节点漂移防护',
          )
        } else {
          toast.success(
            `订阅「${payload.profileName}」已更新，现有 ${payload.newNodeCount} 个可用节点。`,
            '后台自动更新成功',
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
