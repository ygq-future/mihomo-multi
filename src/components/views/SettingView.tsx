import {
  CheckCircle2,
  Cpu,
  FolderOpen,
  Play,
  RefreshCw,
  Save,
  Square,
  Terminal,
} from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import * as api from '../../services/tauri'
import { useAppStore } from '../../stores/appStore'
import { formatUptime } from '../../utils/time'
import { Button, Input, Select } from '../common'

const logLevelOptions = [
  { value: 'info', label: 'Info (标准信息)' },
  { value: 'warning', label: 'Warning (警告)' },
  { value: 'error', label: 'Error (仅错误)' },
  { value: 'debug', label: 'Debug (详细调试)' },
  { value: 'silent', label: 'Silent (静默)' },
]

export const SettingView: React.FC = () => {
  const {
    coreStatus,
    config,
    startCore,
    stopCore,
    restartCore,
    fetchConfig,
    saveConfig,
    openAppDataDir,
    loading,
    error,
  } = useAppStore()

  const [controllerPort, setControllerPort] = useState<number>(9999)
  const [logLevel, setLogLevel] = useState<string>('info')
  const [appDataDir, setAppDataDir] = useState<string>('')
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false)
  const [liveUptime, setLiveUptime] = useState<number>(0)

  const isRunning = coreStatus?.running ?? false

  useEffect(() => {
    fetchConfig()
    api
      .getAppDir()
      .then(setAppDataDir)
      .catch(() => {})
  }, [fetchConfig])

  useEffect(() => {
    if (config) {
      setControllerPort(config.controllerPort)
      setLogLevel(config.logLevel)
    }
  }, [config])

  // Sync baseline uptime from backend
  useEffect(() => {
    if (coreStatus?.uptimeSeconds !== undefined) {
      setLiveUptime(coreStatus.uptimeSeconds)
    }
  }, [coreStatus?.uptimeSeconds])

  // Smooth local 1-second ticker for seamless Uptime increments
  useEffect(() => {
    if (!isRunning) {
      setLiveUptime(0)
      return
    }

    const timer = setInterval(() => {
      setLiveUptime((prev) => prev + 1)
    }, 1000)

    return () => clearInterval(timer)
  }, [isRunning])

  const handleSave = async () => {
    if (!config) return
    await saveConfig({
      ...config,
      controllerPort: Number(controllerPort),
      logLevel: logLevel,
    })
    setSavedSuccess(true)
    setTimeout(() => setSavedSuccess(false), 2500)
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs">
          <b>错误：</b> {error}
        </div>
      )}

      {/* Unified Mihomo Core & Controller Card */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-5 shadow-sm">
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2.5">
            <Cpu className="w-5 h-5 text-primary" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Mihomo 内核与控制器
              </h3>
              <p className="text-xs text-muted-foreground">
                伴生子进程生命周期守护与外部控制器通信参数配置
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isRunning ? (
              <Button
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={() => stopCore()}
                className="text-rose-500 hover:bg-rose-500/10 border-rose-500/20"
                icon={<Square className="w-3.5 h-3.5 fill-current" />}
              >
                停止内核
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                disabled={loading}
                onClick={() => startCore()}
                className="bg-emerald-600 hover:bg-emerald-500 text-white"
                icon={<Play className="w-3.5 h-3.5 fill-current" />}
              >
                启动内核
              </Button>
            )}

            <Button
              variant="secondary"
              size="sm"
              disabled={loading}
              onClick={() => restartCore()}
              icon={
                <RefreshCw
                  className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
                />
              }
            >
              重启
            </Button>
          </div>
        </div>

        {/* Core Status Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="p-3 rounded-lg bg-background/50 border border-border space-y-1">
            <span className="text-muted-foreground">运行状态</span>
            <div className="flex items-center gap-2 font-medium">
              <span
                className={`w-2 h-2 rounded-full ${
                  isRunning ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
                }`}
              />
              <span
                className={isRunning ? 'text-emerald-500' : 'text-rose-500'}
              >
                {isRunning ? '正在运行 (Active)' : '已停止 (Stopped)'}
              </span>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-background/50 border border-border space-y-1">
            <span className="text-muted-foreground">进程 PID</span>
            <div className="font-mono font-medium text-foreground">
              {coreStatus?.pid ?? '无'}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-background/50 border border-border space-y-1">
            <span className="text-muted-foreground">外部控制器 (REST API)</span>
            <div className="font-mono font-medium text-foreground">
              127.0.0.1:{coreStatus?.controllerPort ?? 9999}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-background/50 border border-border space-y-1">
            <span className="text-muted-foreground">运行时间 (Uptime)</span>
            <div className="font-mono font-medium text-foreground">
              {isRunning ? formatUptime(liveUptime) : '0s'}
            </div>
          </div>
        </div>

        {(coreStatus?.version || coreStatus?.sidecarPath) && (
          <div className="space-y-1 pt-1 text-[11px] text-muted-foreground font-mono">
            {coreStatus?.version && (
              <div className="flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{coreStatus.version}</span>
              </div>
            )}
            {coreStatus?.sidecarPath && (
              <div className="flex items-center gap-2">
                <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{coreStatus.sidecarPath}</span>
              </div>
            )}
          </div>
        )}

        {/* Controller Configuration */}
        <div className="space-y-4 pt-3 border-t border-border">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <label
                htmlFor="controller-port-input"
                className="text-xs font-medium text-foreground"
              >
                外部控制器端口
              </label>
              <p className="text-[11px] text-muted-foreground">
                Mihomo 本地 RESTful 控制接口端口，用于热重载与测速（默认 9999）
              </p>
            </div>
            <div className="w-32 shrink-0">
              <Input
                id="controller-port-input"
                type="number"
                min={1024}
                max={65535}
                value={controllerPort}
                onChange={(e) => setControllerPort(Number(e.target.value))}
                className="text-right font-mono"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <label
                htmlFor="log-level-select"
                className="text-xs font-medium text-foreground"
              >
                内核日志级别
              </label>
              <p className="text-[11px] text-muted-foreground">
                Mihomo 运行时的日志输出详细程度
              </p>
            </div>
            <div className="w-48 shrink-0">
              <Select
                value={logLevel}
                onChange={(val) => setLogLevel(String(val))}
                options={logLevelOptions}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
          {savedSuccess && (
            <span className="text-xs text-emerald-500 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              设置已成功保存
            </span>
          )}
          <Button
            type="button"
            disabled={loading}
            onClick={handleSave}
            icon={<Save className="w-3.5 h-3.5" />}
          >
            保存设置
          </Button>
        </div>
      </div>

      {/* Storage & Directories Card */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4 shadow-sm">
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              应用数据与订阅存储路径
            </h3>
            <p className="text-xs text-muted-foreground">
              所有订阅 YAML 文件与元数据均保存在本地应用独立目录中
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => openAppDataDir()}
            icon={<FolderOpen className="w-3.5 h-3.5" />}
          >
            在资源管理器中打开
          </Button>
        </div>

        <div className="p-3 rounded-lg bg-background/50 border border-border text-xs space-y-1">
          <span className="text-muted-foreground">
            当前运行数据目录 (app_local_data_dir)
          </span>
          <div className="font-mono text-foreground break-all select-all">
            {appDataDir || '正在读取...'}
          </div>
        </div>
      </div>
    </div>
  )
}
