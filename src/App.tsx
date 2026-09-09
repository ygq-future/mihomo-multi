import { listen } from '@tauri-apps/api/event'
import type React from 'react'
import { useEffect } from 'react'
import { ToastContainer, toast } from './components/common'
import { Shell } from './components/layout/Shell'
import { useAppStore } from './stores/appStore'
import { appReady } from './services/tauri'
import type {
  AutoUpdateEventPayload,
  KernelCrashedPayload,
  LatencyProgressPayload,
  LatencyUpdatePayload,
  PortDriftReport,
  PortMapping,
  ProxyRestoredPayload,
} from './types'
export const App: React.FC = () => {
  const {
    fetchStatus,
    fetchConfig,
    fetchProfiles,
    fetchPortMappings,
    fetchAutoUpdaterStatus,
    fetchLatencies,
    handleLatencyUpdate,
    handleLatencyProgress,
    setDriftReports,
  } = useAppStore()

  useEffect(() => {
    fetchStatus()
    fetchConfig()
    fetchLatencies().catch(() => {})

    // Notify backend that initial React layout frame is committed to smoothly show window (unless silent start)
    requestAnimationFrame(() => {
      appReady().catch(() => {})
    })
    // Periodically poll status every 3 seconds
    const interval = setInterval(() => {
      fetchStatus()
    }, 3000)

    // Listen for Tauri backend events
    let unlistenAutoUpdated: (() => void) | undefined
    let unlistenDrift: (() => void) | undefined
    let unlistenFailed: (() => void) | undefined
    let unlistenPortUpdated: (() => void) | undefined
    let unlistenPortError: (() => void) | undefined
    let unlistenPortChanged: (() => void) | undefined
    let unlistenLatencyUpdate: (() => void) | undefined
    let unlistenLatencyProgress: (() => void) | undefined
    let unlistenKernelCrashed: (() => void) | undefined
    let unlistenProxyRestored: (() => void) | undefined
    const setupEventListeners = async () => {
      if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
        return
      }

      unlistenAutoUpdated = await listen<AutoUpdateEventPayload>(
        'profile-auto-updated',
        (event) => {
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
        },
      )

      unlistenDrift = await listen<PortDriftReport[]>(
        'node-drift-detected',
        (event) => {
          setDriftReports(event.payload)
          fetchPortMappings().catch(() => {})
        },
      )

      unlistenFailed = await listen<AutoUpdateEventPayload>(
        'profile-update-failed',
        (event) => {
          const payload = event.payload
          toast.error(
            `订阅「${payload.profileName}」拉取失败：${payload.error || '网络或解析异常'}`,
            '订阅自动更新失败',
          )
        },
      )

      unlistenPortUpdated = await listen<PortMapping>(
        'port-mapping-updated',
        () => {
          fetchPortMappings().catch(() => {})
          fetchStatus().catch(() => {})
        },
      )

      unlistenPortChanged = await listen('port-mappings-changed', () => {
        fetchPortMappings().catch(() => {})
        fetchStatus().catch(() => {})
      })

      unlistenPortError = await listen<string>('port-toggle-error', (event) => {
        toast.error(event.payload, '托盘端口切换失败')
      })
      unlistenLatencyUpdate = await listen<LatencyUpdatePayload>(
        'latency-update',
        (event) => {
          handleLatencyUpdate(event.payload)
        },
      )

      unlistenLatencyProgress = await listen<LatencyProgressPayload>(
        'latency-progress',
        (event) => {
          handleLatencyProgress(event.payload)
        },
      )
      unlistenKernelCrashed = await listen<KernelCrashedPayload>(
        'kernel-crashed',
        (event) => {
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
        },
      )

      unlistenProxyRestored = await listen<ProxyRestoredPayload>(
        'proxy-restored',
        (event) => {
          const payload = event.payload
          fetchStatus().catch(() => {})
          fetchConfig().catch(() => {})

          toast.success(
            `Mihomo 内核已恢复运行，系统代理已自动恢复绑定至端口 :${payload.port}。`,
            '系统代理自动恢复',
          )
        },
      )
    }

    setupEventListeners().catch(() => {})

    return () => {
      clearInterval(interval)
      if (unlistenAutoUpdated) unlistenAutoUpdated()
      if (unlistenDrift) unlistenDrift()
      if (unlistenFailed) unlistenFailed()
      if (unlistenPortUpdated) unlistenPortUpdated()
      if (unlistenPortError) unlistenPortError()
      if (unlistenPortChanged) unlistenPortChanged()
      if (unlistenLatencyUpdate) unlistenLatencyUpdate()
      if (unlistenLatencyProgress) unlistenLatencyProgress()
      if (unlistenKernelCrashed) unlistenKernelCrashed()
      if (unlistenProxyRestored) unlistenProxyRestored()
    }
  }, [
    fetchStatus,
    fetchConfig,
    fetchProfiles,
    fetchPortMappings,
    fetchAutoUpdaterStatus,
    fetchLatencies,
    handleLatencyUpdate,
    handleLatencyProgress,
    setDriftReports,
  ])

  return (
    <>
      <Shell />
      <ToastContainer />
    </>
  )
}

export default App
