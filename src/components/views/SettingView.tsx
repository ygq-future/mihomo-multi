import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Cpu,
  FolderOpen,
  Play,
  RefreshCw,
  Save,
  ShieldAlert,
  ShieldCheck,
  Square,
  Terminal,
  Zap,
} from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import * as api from '../../services/tauri'
import { useAppStore } from '../../stores/appStore'
import { Button, Input, Select, Switch } from '../common'

const logLevelOptions = [
  { value: 'info', label: 'Info (标准信息)' },
  { value: 'warning', label: 'Warning (警告)' },
  { value: 'error', label: 'Error (仅错误)' },
  { value: 'debug', label: 'Debug (详细调试)' },
  { value: 'silent', label: 'Silent (静默)' },
]

const intervalOptions = [
  { value: '30', label: '每 30 秒轮询一次' },
  { value: '60', label: '每 1 分钟轮询一次 (默认)' },
  { value: '300', label: '每 5 分钟轮询一次' },
  { value: '600', label: '每 10 分钟轮询一次' },
]

export const SettingView: React.FC = () => {
  const {
    coreStatus,
    config,
    autoUpdaterStatus,
    driftReports,
    portMappings,
    profiles,
    isCheckingAutoUpdates,
    startCore,
    stopCore,
    restartCore,
    fetchConfig,
    saveConfig,
    openAppDataDir,
    fetchAutoUpdaterStatus,
    triggerAutoUpdateCheck,
    fetchDriftReports,
    fetchPortMappings,
    setActiveTab,
    loading,
    error,
  } = useAppStore()

  const [controllerPort, setControllerPort] = useState<number>(9999)
  const [logLevel, setLogLevel] = useState<string>('info')
  const [autoStart, setAutoStart] = useState<boolean>(true)
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState<boolean>(true)
  const [autoUpdateIntervalSecs, setAutoUpdateIntervalSecs] =
    useState<string>('60')
  const [appDataDir, setAppDataDir] = useState<string>('')
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false)
  const [updateToast, setUpdateToast] = useState<string | null>(null)

  useEffect(() => {
    fetchConfig()
    fetchAutoUpdaterStatus()
    fetchDriftReports()
    fetchPortMappings()
    api
      .getAppDir()
      .then(setAppDataDir)
      .catch(() => {})
  }, [
    fetchConfig,
    fetchAutoUpdaterStatus,
    fetchDriftReports,
    fetchPortMappings,
  ])

  useEffect(() => {
    if (config) {
      setControllerPort(config.controllerPort)
      setLogLevel(config.logLevel)
      setAutoStart(config.autoStartCore)
      setAutoUpdateEnabled(config.autoUpdateEnabled ?? true)
      setAutoUpdateIntervalSecs(
        String(config.autoUpdateCheckIntervalSecs ?? 60),
      )
    }
  }, [config])

  const handleSave = async () => {
    if (!config) return
    await saveConfig({
      ...config,
      controllerPort: Number(controllerPort),
      logLevel: logLevel,
      autoStartCore: autoStart,
      autoUpdateEnabled,
      autoUpdateCheckIntervalSecs: Number(autoUpdateIntervalSecs),
    })
    fetchAutoUpdaterStatus()
    setSavedSuccess(true)
    setTimeout(() => setSavedSuccess(false), 2500)
  }

  const handleManualCheckUpdates = async () => {
    try {
      const results = await triggerAutoUpdateCheck()
      const updatedCount = results.filter((r) => r.success).length
      if (results.length === 0) {
        setUpdateToast('当前无到达更新周期的远程订阅')
      } else {
        setUpdateToast(
          `检查完成：已更新 ${updatedCount} 个订阅，共检测 ${results.length} 个配置`,
        )
      }
      setTimeout(() => setUpdateToast(null), 3000)
    } catch (err) {
      setUpdateToast(
        `检查更新失败: ${err instanceof Error ? err.message : String(err)}`,
      )
      setTimeout(() => setUpdateToast(null), 3000)
    }
  }

  const formatTimestamp = (timestamp: number) => {
    if (!timestamp) return '尚未执行'
    const date = new Date(timestamp * 1000)
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  const isRunning = coreStatus?.running ?? false
  const totalPorts = portMappings.length
  const driftedPorts = driftReports.filter((r) => r.status !== 'healthy').length

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Toast Notification */}
      {updateToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-foreground text-background text-xs font-medium px-3.5 py-2 rounded-lg shadow-xl flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <Check className="w-3.5 h-3.5 text-emerald-400" />
          <span>{updateToast}</span>
        </div>
      )}

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs">
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
              <Button
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={() => stopCore()}
                className="text-rose-500 hover:bg-rose-500/10 border-rose-500/20"
                icon={<Square className="w-3.5 h-3.5 fill-current" />}
              >
                停止
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
                启动
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
              127.0.0.1:{coreStatus?.controllerPort ?? 9999}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-background/50 border border-border space-y-1">
            <span className="text-muted-foreground">运行时间 (Uptime)</span>
            <div className="font-mono font-medium text-foreground">
              {coreStatus?.uptimeSeconds
                ? `${coreStatus.uptimeSeconds} 秒`
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

        {coreStatus?.sidecarPath && (
          <div className="text-[11px] text-muted-foreground flex items-center gap-2">
            <FolderOpen className="w-3.5 h-3.5" />
            <span className="font-mono truncate">{coreStatus.sidecarPath}</span>
          </div>
        )}
      </div>

      {/* Auto-Updater & Node Drift Safety Guard Card */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4 shadow-sm">
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2.5">
            <RefreshCw className="w-5 h-5 text-emerald-500" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                后台自动更新与节点漂移安全防护
              </h3>
              <p className="text-xs text-muted-foreground">
                基于 Tokio 异步定时轮询拉取最新订阅，自动执行 1:1
                确定性漂移检测与 DIRECT 兜底
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              loading={isCheckingAutoUpdates}
              onClick={handleManualCheckUpdates}
              icon={<Zap className="w-3.5 h-3.5 text-amber-500" />}
            >
              立即检查全部更新
            </Button>
          </div>
        </div>

        {/* Status Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="p-3 rounded-lg bg-background/50 border border-border space-y-1">
            <span className="text-muted-foreground">工作器状态</span>
            <div className="flex items-center gap-1.5 font-medium">
              <span
                className={`w-2 h-2 rounded-full ${
                  autoUpdaterStatus?.autoUpdateEnabled
                    ? 'bg-emerald-500 animate-pulse'
                    : 'bg-muted-foreground'
                }`}
              />
              <span
                className={
                  autoUpdaterStatus?.autoUpdateEnabled
                    ? 'text-emerald-500'
                    : 'text-muted-foreground'
                }
              >
                {autoUpdaterStatus?.autoUpdateEnabled
                  ? '运行中 (Active)'
                  : '已暂停'}
              </span>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-background/50 border border-border space-y-1">
            <span className="text-muted-foreground">自动托管订阅</span>
            <div className="font-mono font-medium text-foreground">
              {autoUpdaterStatus?.eligibleProfilesCount ?? 0} /{' '}
              {profiles.length} 个
            </div>
          </div>

          <div className="p-3 rounded-lg bg-background/50 border border-border space-y-1">
            <span className="text-muted-foreground">节点健康状态</span>
            <div className="font-medium flex items-center gap-1.5">
              {driftedPorts > 0 ? (
                <span className="text-amber-500 flex items-center gap-1 font-mono">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {driftedPorts} 异常 / {totalPorts} 端口
                </span>
              ) : (
                <span className="text-emerald-500 flex items-center gap-1 font-mono">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  全部健康 ({totalPorts})
                </span>
              )}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-background/50 border border-border space-y-1">
            <span className="text-muted-foreground">上次轮询时间</span>
            <div className="text-[11px] font-mono text-muted-foreground truncate">
              {formatTimestamp(autoUpdaterStatus?.lastCheckTimestamp ?? 0)}
            </div>
          </div>
        </div>

        {/* Drift Status Banner */}
        {driftedPorts > 0 && (
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <ShieldAlert className="w-4 h-4 shrink-0 text-amber-500" />
              <span>
                检测到 {driftedPorts} 个监听端口绑定的节点已失效，DIRECT
                直连兜底已生效。
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7 border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
              onClick={() => setActiveTab('ports')}
            >
              前往端口管理查看
            </Button>
          </div>
        )}

        {/* Config Toggles */}
        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-xs font-medium text-foreground">
                启用后台订阅定时静默自动更新
              </span>
              <p className="text-[11px] text-muted-foreground">
                到达设定周期（如 12h、24h）后自动静默拉取最新 YAML
                并热重载内核配置
              </p>
            </div>
            <Switch
              checked={autoUpdateEnabled}
              onChange={(checked) => setAutoUpdateEnabled(checked)}
              size="md"
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <label
                htmlFor="check-interval-select"
                className="text-xs font-medium text-foreground"
              >
                后台更新检查轮询频率
              </label>
              <p className="text-[11px] text-muted-foreground">
                后台定时工作器唤醒并检查各订阅是否满足更新间隔的周期
              </p>
            </div>
            <div className="w-56 shrink-0">
              <Select
                id="check-interval-select"
                value={autoUpdateIntervalSecs}
                onChange={(val) => setAutoUpdateIntervalSecs(String(val))}
                options={intervalOptions}
              />
            </div>
          </div>
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
          <div className="flex items-center justify-between gap-4">
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

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-xs font-medium text-foreground">
                应用启动时自动拉起内核
              </span>
              <p className="text-[11px] text-muted-foreground">
                主程序就绪后自动启动 Mihomo Sidecar 并监听端口
              </p>
            </div>
            <Switch
              checked={autoStart}
              onChange={(checked) => setAutoStart(checked)}
              size="md"
            />
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
            信号处理彻底回收内核进程，无孤儿进程残留；
          </li>
          <li>
            <b>节点漂移防护</b>：订阅更新后若节点不存在，自动触发 DIRECT
            兜底，禁止隐式模糊路由切换。
          </li>
        </ul>
      </div>
    </div>
  )
}
