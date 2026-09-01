import { listen } from '@tauri-apps/api/event'
import { AlertTriangle, CheckCircle2, X } from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import { Shell } from './components/layout/Shell'
import { useAppStore } from './stores/appStore'
import type { AutoUpdateEventPayload, PortDriftReport } from './types'

interface AppToast {
  id: string
  title: string
  message: string
  type: 'info' | 'success' | 'warning' | 'error'
}

export const App: React.FC = () => {
  const {
    fetchStatus,
    fetchProfiles,
    fetchPortMappings,
    fetchAutoUpdaterStatus,
    setDriftReports,
  } = useAppStore()

  const [toasts, setToasts] = useState<AppToast[]>([])

  const addToast = (toast: Omit<AppToast, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random()}`
    const item: AppToast = { ...toast, id }
    setToasts((prev) => [...prev.slice(-3), item])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 4500)
  }

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

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
            addToast({
              title: '订阅更新与节点漂移防护',
              message: `订阅「${payload.profileName}」已更新（${payload.newNodeCount} 个节点），检测到 ${payload.driftedPortsCount} 个端口发生节点漂移并已自动启用 DIRECT 兜底。`,
              type: 'warning',
            })
          } else {
            addToast({
              title: '后台自动更新成功',
              message: `订阅「${payload.profileName}」已更新，现有 ${payload.newNodeCount} 个可用节点。`,
              type: 'success',
            })
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
          addToast({
            title: '订阅自动更新失败',
            message: `订阅「${payload.profileName}」拉取失败：${payload.error || '网络或解析异常'}`,
            type: 'error',
          })
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

      {/* Global Notification Toast Container */}
      {toasts.length > 0 && (
        <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 max-w-sm pointer-events-none">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`p-3.5 rounded-xl shadow-2xl border text-xs pointer-events-auto flex items-start gap-2.5 animate-in fade-in slide-in-from-bottom-4 duration-200 ${
                toast.type === 'warning'
                  ? 'bg-amber-500/15 border-amber-500/30 text-foreground'
                  : toast.type === 'success'
                    ? 'bg-emerald-500/15 border-emerald-500/30 text-foreground'
                    : 'bg-card border-border text-foreground'
              }`}
            >
              {toast.type === 'warning' ? (
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              )}
              <div className="space-y-0.5 flex-1 min-w-0">
                <div className="font-semibold text-foreground">
                  {toast.title}
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {toast.message}
                </p>
              </div>
              <button
                type="button"
                onClick={() => removeToast(toast.id)}
                className="text-muted-foreground hover:text-foreground p-0.5 rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

export default App
