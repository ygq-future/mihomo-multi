import { listen } from '@tauri-apps/api/event'
import type React from 'react'
import { useEffect } from 'react'
import { ToastContainer, toast } from './components/common'
import { Shell } from './components/layout/Shell'
import { useAppStore } from './stores/appStore'
import type { AutoUpdateEventPayload, PortDriftReport } from './types'

export const App: React.FC = () => {
  const {
    fetchStatus,
    fetchProfiles,
    fetchPortMappings,
    fetchAutoUpdaterStatus,
    setDriftReports,
  } = useAppStore()

  useEffect(() => {
    fetchStatus()

    // Periodically poll status every 3 seconds
    const interval = setInterval(() => {
      fetchStatus()
    }, 3000)

    // Listen for Tauri backend events
    let unlistenAutoUpdated: (() => void) | undefined
    let unlistenDrift: (() => void) | undefined
    let unlistenFailed: (() => void) | undefined

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
    }

    setupEventListeners().catch(() => {})

    return () => {
      clearInterval(interval)
      if (unlistenAutoUpdated) unlistenAutoUpdated()
      if (unlistenDrift) unlistenDrift()
      if (unlistenFailed) unlistenFailed()
    }
  }, [
    fetchStatus,
    fetchProfiles,
    fetchPortMappings,
    fetchAutoUpdaterStatus,
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
