import {
  CheckCircle2,
  Cpu,
  FolderOpen,
  Play,
  RefreshCw,
  Save,
  ShieldCheck,
  Square,
  Terminal,
} from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import { useAppStore } from '../../stores/appStore'

export const SettingView: React.FC = () => {
  const {
    coreStatus,
    config,
    startCore,
    stopCore,
    restartCore,
    fetchConfig,
    saveConfig,
    loading,
    error,
  } = useAppStore()

  const [controllerPort, setControllerPort] = useState<number>(9999)
  const [logLevel, setLogLevel] = useState<string>('info')
  const [autoStart, setAutoStart] = useState<boolean>(true)
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false)

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  useEffect(() => {
    if (config) {
      setControllerPort(config.controller_port)
      setLogLevel(config.log_level)
      setAutoStart(config.auto_start_core)
    }
  }, [config])

  const handleSave = async () => {
    if (!config) return
    await saveConfig({
      ...config,
      controller_port: Number(controllerPort),
      log_level: logLevel,
      auto_start_core: autoStart,
    })
    setSavedSuccess(true)
    setTimeout(() => setSavedSuccess(false), 2500)
  }

  const isRunning = coreStatus?.running ?? false

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs">
          <b>错误：</b> {error}
        </div>
      )}

      {/* Core Supervisor Status Card */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4 shadow-sm">
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2.5">
            <Cpu className="w-5 h-5 text-primary" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Mihomo Sidecar 内核状态
              </h3>
              <p className="text-xs text-muted-foreground">
                伴生子进程生命周期受主程序守护（Windows JobObject / POSIX
                生命周期）
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isRunning ? (
              <button
                type="button"
                disabled={loading}
                onClick={() => stopCore()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-rose-500/10 text-rose-500 border border-rose-500/20 text-xs font-medium hover:bg-rose-500/20 transition-colors disabled:opacity-50"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>停止</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={loading}
                onClick={() => startCore()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-500 text-white text-xs font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>启动</span>
              </button>
            )}

            <button
              type="button"
              disabled={loading}
              onClick={() => restartCore()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
              />
              <span>重启</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-xs">
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
              127.0.0.1:{coreStatus?.controller_port ?? 9999}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-background/50 border border-border space-y-1">
            <span className="text-muted-foreground">运行时间 (Uptime)</span>
            <div className="font-mono font-medium text-foreground">
              {coreStatus?.uptime_seconds
                ? `${coreStatus.uptime_seconds} 秒`
                : '0 秒'}
            </div>
          </div>
        </div>

        {coreStatus?.version && (
          <div className="text-[11px] text-muted-foreground flex items-center gap-2 pt-1">
            <Terminal className="w-3.5 h-3.5" />
            <span className="font-mono">{coreStatus.version}</span>
          </div>
        )}

        {coreStatus?.sidecar_path && (
          <div className="text-[11px] text-muted-foreground flex items-center gap-2">
            <FolderOpen className="w-3.5 h-3.5" />
            <span className="font-mono truncate">
              {coreStatus.sidecar_path}
            </span>
          </div>
        )}
      </div>

      {/* General Settings Card */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-5 shadow-sm">
        <div className="pb-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">
            基础与控制器设置
          </h3>
          <p className="text-xs text-muted-foreground">
            自定义 Mihomo 内核启动参数与控制器通信配置
          </p>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <label
                htmlFor="controller-port-input"
                className="text-xs font-medium text-foreground"
              >
                外部控制器端口
              </label>
              <p className="text-[11px] text-muted-foreground">
                Mihomo 暴露的 RESTful 接口端口，用于热重载与测速（默认 9999）
              </p>
            </div>
            <input
              id="controller-port-input"
              type="number"
              min={1024}
              max={65535}
              value={controllerPort}
              onChange={(e) => setControllerPort(Number(e.target.value))}
              className="w-28 px-3 py-1.5 rounded-md bg-background border border-border text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-right"
            />
          </div>

          <div className="flex items-center justify-between">
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
            <select
              id="log-level-select"
              value={logLevel}
              onChange={(e) => setLogLevel(e.target.value)}
              className="w-28 px-2 py-1.5 rounded-md bg-background border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="error">Error</option>
              <option value="debug">Debug</option>
              <option value="silent">Silent</option>
            </select>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-xs font-medium text-foreground">
                应用启动时自动拉起内核
              </span>
              <p className="text-[11px] text-muted-foreground">
                主程序就绪后自动启动 Mihomo Sidecar 并监听端口
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAutoStart(!autoStart)}
              className={`w-10 h-5 rounded-full transition-colors relative ${
                autoStart ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span
                className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${
                  autoStart ? 'right-0.5' : 'left-0.5'
                }`}
              />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
          {savedSuccess && (
            <span className="text-xs text-emerald-500 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              设置已成功保存
            </span>
          )}
          <button
            type="button"
            disabled={loading}
            onClick={handleSave}
            className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>保存设置</span>
          </button>
        </div>
      </div>

      {/* Architecture Principles Redline Card */}
      <div className="p-4 rounded-xl border border-border bg-card/40 space-y-2 text-xs">
        <div className="flex items-center gap-2 text-foreground font-medium">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          <span>架构设计与安全准则</span>
        </div>
        <ul className="text-muted-foreground space-y-1 text-[11px] list-disc list-inside">
          <li>
            <b>做减法</b>：严禁引入 TUN 虚拟网卡模式与系统代理全局劫持；
          </li>
          <li>
            <b>确定性路由</b>：所有端口通过 `IN-PORT,&lt;port&gt;,&lt;node&gt;`
            规则直接路由至绑定节点；
          </li>
          <li>
            <b>配置热重载</b>：端口增删改通过 Mihomo REST API
            毫秒级重载，不中断长连接；
          </li>
          <li>
            <b>进程守护安全</b>：崩溃或退出时由 Windows JobObject /
            信号处理彻底回收内核进程，无孤儿进程残留。
          </li>
        </ul>
      </div>
    </div>
  )
}
