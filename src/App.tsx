import type React from 'react'
import { useEffect } from 'react'
import { ToastContainer, toast } from './components/common'
import { Shell } from './components/layout/Shell'
import { useAppStore } from './stores/appStore'
import { appReady } from './services/tauri'
import { createEventScope } from './services/events'
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
  const fetchStatus = useAppStore((state) => state.fetchStatus)
  const fetchConfig = useAppStore((state) => state.fetchConfig)
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
  useEffect(() => {
    fetchStatus()
    fetchConfig()
    fetchLatencies().catch(() => {})

    // Double requestAnimationFrame ensures that the browser has committed and painted
    // the initial layout to the GPU compositor before the native window is revealed.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        appReady().catch(() => {})
      })
    })
    // Periodically poll status every 3 seconds
    const interval = setInterval(() => {
      fetchStatus()
    }, 3000)

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
      .listen<PortMapping>('port-mapping-updated', () => {
        fetchPortMappings().catch(() => {})
        fetchStatus().catch(() => {})
      })
      .catch(() => {})

    scope
      .listen('port-mappings-changed', () => {
        fetchPortMappings().catch(() => {})
        fetchStatus().catch(() => {})
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

    return () => {
      clearInterval(interval)
      scope.dispose()
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
