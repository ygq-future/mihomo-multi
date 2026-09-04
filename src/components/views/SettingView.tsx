import {
  AlertTriangle,
  Cpu,
  FolderOpen,
  Image as ImageIcon,
  Monitor,
  Moon,
  Network,
  Palette,
  Play,
  Power,
  RefreshCw,
  ShieldCheck,
  Sliders,
  Sparkles,
  Square,
  Sun,
  Terminal,
  Trash2,
  Upload,
} from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import * as api from '../../services/tauri'
import { useAppStore } from '../../stores/appStore'
import { formatUptime } from '../../utils/time'
import { Button, Input, Segmented, Select, Switch, toast } from '../common'

const logLevelOptions = [
  { value: 'info', label: 'Info (标准信息)' },
  { value: 'warning', label: 'Warning (警告)' },
  { value: 'error', label: 'Error (仅错误)' },
  { value: 'debug', label: 'Debug (详细调试)' },
  { value: 'silent', label: 'Silent (静默)' },
]

const testUrlOptions = [
  {
    value: 'http://cp.cloudflare.com/generate_204',
    label: 'Cloudflare (204) · 推荐',
  },
  {
    value: 'http://www.google.com/generate_204',
    label: 'Google (204)',
  },
  {
    value: 'http://captive.apple.com/hotspot-detect.html',
    label: 'Apple Captive Portal',
  },
  {
    value: 'http://www.msftconnecttest.com/connecttest.txt',
    label: 'Microsoft Connect Test',
  },
]

const themeOptions = [
  { value: 'dark', label: '暗黑模式', icon: <Moon className="w-3.5 h-3.5" /> },
  {
    value: 'light',
    label: '明亮模式',
    icon: <Sun className="w-3.5 h-3.5" />,
  },
  {
    value: 'system',
    label: '跟随系统',
    icon: <Monitor className="w-3.5 h-3.5" />,
  },
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
    coreLoading,
  } = useAppStore()

  const [controllerPortInput, setControllerPortInput] = useState<string>('9999')
  const [isSavingPort, setIsSavingPort] = useState<boolean>(false)
  const [portError, setPortError] = useState<string | null>(null)
  const [logLevel, setLogLevel] = useState<string>('info')
  const [allowLan, setAllowLan] = useState<boolean>(false)

  // Appearance & Personalization
  const [theme, setTheme] = useState<string>('system')
  const [acrylicEffect, setAcrylicEffect] = useState<boolean>(false)
  const [acrylicBlur, setAcrylicBlur] = useState<number>(12)
  const [acrylicOpacity, setAcrylicOpacity] = useState<number>(65)
  const [bgImage, setBgImage] = useState<string>('')
  const [bgOpacity, setBgOpacity] = useState<number>(80)

  // System & Window
  const [closeToTray, setCloseToTray] = useState<boolean>(true)
  const [autoLaunch, setAutoLaunch] = useState<boolean>(false)
  const [silentStart, setSilentStart] = useState<boolean>(false)

  // Probe & Fallback Strategy
  const [testUrl, setTestUrl] = useState<string>(
    'http://cp.cloudflare.com/generate_204',
  )
  const [timeoutMsInput, setTimeoutMsInput] = useState<string>('3000')
  const [fallbackIntervalInput, setFallbackIntervalInput] =
    useState<string>('5')
  const [fallbackLazy, setFallbackLazy] = useState<boolean>(false)
  const [appDataDir, setAppDataDir] = useState<string>('')
  const [liveUptime, setLiveUptime] = useState<number>(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  const isRunning = coreStatus?.running ?? false
  const portNeedsRestart =
    config?.controllerPort !== undefined &&
    coreStatus?.controllerPort !== undefined &&
    config.controllerPort !== coreStatus.controllerPort

  const debouncedSaveConfig = (updater: (prev: typeof config) => void) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }
    debounceTimerRef.current = setTimeout(async () => {
      const cur = useAppStore.getState().config
      if (!cur) return
      const next = { ...cur }
      updater(next)
      await saveConfig(next)
    }, 150)
  }

  useEffect(() => {
    fetchConfig()
    api
      .getAppDir()
      .then(setAppDataDir)
      .catch(() => {})
  }, [fetchConfig])

  useEffect(() => {
    if (config) {
      setControllerPortInput(String(config.controllerPort))
      setLogLevel(config.logLevel)
      setAllowLan(config.allowLan ?? false)
      setTheme(config.theme ?? 'system')
      setAcrylicEffect(config.acrylicEffect ?? false)
      setAcrylicBlur(config.acrylicBlur ?? 12)
      setAcrylicOpacity(config.acrylicOpacity ?? 65)
      setBgImage(config.backgroundImage ?? '')
      setBgOpacity(config.backgroundOpacity ?? 80)
      setCloseToTray(config.closeToTray ?? true)
      setAutoLaunch(config.autoLaunch ?? false)
      setSilentStart(config.silentStart ?? false)
      setTestUrl(config.testUrl ?? 'http://cp.cloudflare.com/generate_204')
      setTimeoutMsInput(String(config.timeoutMs ?? 3000))
      setFallbackIntervalInput(String(config.fallbackInterval ?? 5))
      setFallbackLazy(config.fallbackLazy ?? false)
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

  const handleLogLevelChange = async (newLevel: string | number) => {
    const levelStr = String(newLevel)
    setLogLevel(levelStr)
    if (!config) return
    await saveConfig({
      ...config,
      logLevel: levelStr,
    })
  }

  const handleAllowLanToggle = async (checked: boolean) => {
    setAllowLan(checked)
    if (!config) return
    await saveConfig({
      ...config,
      allowLan: checked,
    })
    toast.success(
      checked
        ? '已开启局域网连接 (0.0.0.0)'
        : '已恢复为仅监听本机回环 (127.0.0.1)',
    )
  }

  const handleThemeChange = async (newTheme: string) => {
    setTheme(newTheme)
    if (!config) return
    await saveConfig({
      ...config,
      theme: newTheme,
    })
  }

  const handleAcrylicToggle = async (checked: boolean) => {
    setAcrylicEffect(checked)
    if (!config) return
    await saveConfig({
      ...config,
      acrylicEffect: checked,
    })
  }

  const handleAcrylicBlurChange = (val: number) => {
    setAcrylicBlur(val)
    document.documentElement.style.setProperty('--acrylic-blur', `${val}px`)
    debouncedSaveConfig((prev) => {
      if (prev) prev.acrylicBlur = val
    })
  }

  const handleAcrylicOpacityChange = (val: number) => {
    setAcrylicOpacity(val)
    document.documentElement.style.setProperty(
      '--acrylic-opacity',
      `${val / 100}`,
    )
    debouncedSaveConfig((prev) => {
      if (prev) prev.acrylicOpacity = val
    })
  }

  const handleTestUrlChange = async (val: string | number) => {
    const url = String(val)
    setTestUrl(url)
    if (!config) return
    try {
      await saveConfig({ ...config, testUrl: url })
      toast.success('测活与测速目标地址已更新')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleTimeoutBlur = async () => {
    const ms = Number.parseInt(timeoutMsInput, 10)
    if (!ms || ms < 500 || ms > 60000) {
      toast.error('超时时间建议在 500 ~ 60000 ms 范围内')
      setTimeoutMsInput(String(config?.timeoutMs ?? 3000))
      return
    }
    if (config && config.timeoutMs !== ms) {
      try {
        await saveConfig({ ...config, timeoutMs: ms })
        toast.success(`测速与故障判定超时已更新为 ${ms} ms`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      }
    }
  }

  const handleFallbackIntervalBlur = async () => {
    const sec = Number.parseInt(fallbackIntervalInput, 10)
    if (!sec || sec < 2 || sec > 300) {
      toast.error('检测间隔建议在 2 ~ 300 秒范围内')
      setFallbackIntervalInput(String(config?.fallbackInterval ?? 5))
      return
    }
    if (config && config.fallbackInterval !== sec) {
      try {
        await saveConfig({ ...config, fallbackInterval: sec })
        toast.success(`Fallback 探测周期已更新为 ${sec} 秒`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      }
    }
  }

  const handleFallbackLazyToggle = async (checked: boolean) => {
    setFallbackLazy(checked)
    if (!config) return
    try {
      await saveConfig({ ...config, fallbackLazy: checked })
      toast.success(checked ? '已开启惰性健康检测' : '已恢复持续主动健康检测')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      toast.error('请选择有效的图片格式文件 (PNG, JPG, WebP 等)')
      return
    }

    const reader = new FileReader()
    reader.onload = async () => {
      const dataUrl = reader.result as string
      setBgImage(dataUrl)
      if (config) {
        await saveConfig({
          ...config,
          backgroundImage: dataUrl,
        })
        toast.success('背景壁纸已成功应用')
      }
    }
    reader.readAsDataURL(file)
  }

  const handleClearBgImage = async () => {
    setBgImage('')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    if (!config) return
    await saveConfig({
      ...config,
      backgroundImage: '',
    })
    toast.info('背景壁纸已清除')
  }

  const handleBgOpacityChange = (val: number) => {
    setBgOpacity(val)
    debouncedSaveConfig((prev) => {
      if (prev) prev.backgroundOpacity = val
    })
  }

  const handleCloseToTrayToggle = async (checked: boolean) => {
    setCloseToTray(checked)
    if (!config) return
    await saveConfig({
      ...config,
      closeToTray: checked,
    })
  }

  const handleAutoLaunchToggle = async (checked: boolean) => {
    setAutoLaunch(checked)
    if (!config) return
    await saveConfig({
      ...config,
      autoLaunch: checked,
    })
    toast.success(checked ? '已开启开机自启动' : '已关闭开机自启动')
  }

  const handleSilentStartToggle = async (checked: boolean) => {
    setSilentStart(checked)
    if (!config) return
    await saveConfig({
      ...config,
      silentStart: checked,
    })
  }

  const handlePortBlur = async () => {
    const portNum = Number.parseInt(controllerPortInput, 10)
    if (Number.isNaN(portNum) || portNum < 1024 || portNum > 65535) {
      if (config) {
        setControllerPortInput(String(config.controllerPort))
      }
      setPortError('端口号必须在 1024 ~ 65535 范围内')
      setTimeout(() => setPortError(null), 3500)
      return
    }

    if (config && config.controllerPort !== portNum) {
      setIsSavingPort(true)
      try {
        await saveConfig({
          ...config,
          controllerPort: portNum,
        })
        setPortError(null)
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        setPortError(errMsg)
        setControllerPortInput(String(config.controllerPort))
        setTimeout(() => setPortError(null), 4000)
      } finally {
        setIsSavingPort(false)
      }
    }
  }

  const handlePortKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur()
    }
  }

  return (
    <div className="p-6 space-y-6 w-full">
      {/* 1. Unified Mihomo Core & Controller Card */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-5 shadow-sm">
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2.5">
            <Cpu className="w-5 h-5 text-primary" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Mihomo 内核与网络
              </h3>
              <p className="text-xs text-muted-foreground">
                伴生子进程生命周期守护与网络监听通信配置
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isRunning ? (
              <Button
                variant="outline"
                size="sm"
                disabled={coreLoading}
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
                disabled={coreLoading}
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
              disabled={coreLoading}
              onClick={() => restartCore()}
              icon={
                <RefreshCw
                  className={`w-3.5 h-3.5 ${coreLoading ? 'animate-spin' : ''}`}
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

        {/* Network & Controller Configuration */}
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
              {portError && (
                <p className="text-[11px] text-destructive flex items-center gap-1 font-medium pt-0.5 animate-in fade-in duration-150">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  {portError}
                </p>
              )}
              {portNeedsRestart && !portError && (
                <p className="text-[11px] text-amber-500 flex items-center gap-1 font-medium pt-0.5">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  端口配置已更新为 {config?.controllerPort}，重启内核后生效
                </p>
              )}
            </div>
            <div className="w-24 shrink-0">
              <Input
                id="controller-port-input"
                type="number"
                min={1024}
                max={65535}
                loading={isSavingPort}
                value={controllerPortInput}
                onChange={(e) => setControllerPortInput(e.target.value)}
                onBlur={handlePortBlur}
                onKeyDown={handlePortKeyDown}
                className="text-center font-mono"
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
                Mihomo 运行时的日志输出详细程度（修改后即时热重载生效）
              </p>
            </div>
            <div className="w-36 shrink-0">
              <Select
                id="log-level-select"
                value={logLevel}
                onChange={handleLogLevelChange}
                options={logLevelOptions}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
                <Network className="w-3.5 h-3.5 text-primary" />
                允许局域网连接 (0.0.0.0)
              </span>
              <p className="text-[11px] text-muted-foreground">
                开启后端口映射将监听所有网卡接口，允许局域网/虚拟机设备连接；关闭时仅监听本机回环地址
                (127.0.0.1)
              </p>
            </div>
            <Switch
              checked={allowLan}
              onChange={handleAllowLanToggle}
              size="md"
            />
          </div>

          {/* Fallback & Probe Strategy Subsection */}
          <div className="pt-4 border-t border-border space-y-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              <h4 className="text-xs font-semibold text-foreground">
                节点探测与 Fallback 容灾策略
              </h4>
            </div>

            {/* Probe Target URL Select */}
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <label
                  htmlFor="probe-url-select"
                  className="text-xs font-medium text-foreground"
                >
                  探测与测速目标地址
                </label>
                <p className="text-[11px] text-muted-foreground">
                  全局测速、单端口测速与 Fallback 策略组测活所使用的网络端点
                </p>
              </div>
              <div className="w-64 shrink-0">
                <Select
                  id="probe-url-select"
                  value={testUrl}
                  onChange={handleTestUrlChange}
                  options={testUrlOptions}
                />
              </div>
            </div>

            {/* Timeout Ms Input */}
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <label
                  htmlFor="probe-timeout-input"
                  className="text-xs font-medium text-foreground"
                >
                  节点测速与故障判定超时
                </label>
                <p className="text-[11px] text-muted-foreground">
                  统一控制手动测速超时时间，以及 Fallback
                  主节点被判定故障的阈值（毫秒）
                </p>
              </div>
              <div className="w-28 shrink-0">
                <Input
                  id="probe-timeout-input"
                  type="number"
                  min={500}
                  max={60000}
                  value={timeoutMsInput}
                  onChange={(e) => setTimeoutMsInput(e.target.value)}
                  onBlur={handleTimeoutBlur}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  suffixIcon={
                    <span className="text-[10px] text-muted-foreground pr-1">
                      ms
                    </span>
                  }
                  className="text-center font-mono"
                />
              </div>
            </div>

            {/* Fallback Interval Input */}
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <label
                  htmlFor="fallback-interval-input"
                  className="text-xs font-medium text-foreground"
                >
                  Fallback 健康检查周期
                </label>
                <p className="text-[11px] text-muted-foreground">
                  Mihomo
                  内核在底层向探针测活的间隔秒数；主节点恢复后内核自动切回
                </p>
              </div>
              <div className="w-28 shrink-0">
                <Input
                  id="fallback-interval-input"
                  type="number"
                  min={2}
                  max={300}
                  value={fallbackIntervalInput}
                  onChange={(e) => setFallbackIntervalInput(e.target.value)}
                  onBlur={handleFallbackIntervalBlur}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  suffixIcon={
                    <span className="text-[10px] text-muted-foreground pr-1">
                      秒
                    </span>
                  }
                  className="text-center font-mono"
                />
              </div>
            </div>

            {/* Fallback Lazy Switch */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-xs font-medium text-foreground">
                  惰性健康检查 (Lazy Mode)
                </span>
                <p className="text-[11px] text-muted-foreground">
                  关闭时内核持续主动测活（推荐）；开启后仅在该端口有流量经过时才发起检测
                </p>
              </div>
              <Switch
                checked={fallbackLazy}
                onChange={handleFallbackLazyToggle}
                size="md"
              />
            </div>
          </div>
        </div>
      </div>

      {/* 2. Appearance & Personalization Card */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-5 shadow-sm">
        <div className="pb-3 border-b border-border">
          <div className="flex items-center gap-2.5">
            <Palette className="w-5 h-5 text-primary" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                外观与个性化
              </h3>
              <p className="text-xs text-muted-foreground">
                自定义应用界面主题、磨砂亚克力玻璃质感与背景壁纸
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {/* Theme Selector */}
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <span className="text-xs font-medium text-foreground">
                界面主题
              </span>
              <p className="text-[11px] text-muted-foreground">
                选择客户端明亮、暗黑或跟随操作系统自动切换
              </p>
            </div>
            <Segmented
              value={theme}
              onChange={handleThemeChange}
              options={themeOptions}
              size="md"
            />
          </div>

          {/* Acrylic Effect Toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                磨砂亚克力玻璃质感 (Acrylic Glass)
              </span>
              <p className="text-[11px] text-muted-foreground">
                为所有面板与侧边栏开启半透明毛玻璃透光与模糊效果
              </p>
            </div>
            <Switch
              checked={acrylicEffect}
              onChange={handleAcrylicToggle}
              size="md"
            />
          </div>

          {/* Acrylic Sub-Parameters */}
          {acrylicEffect && (
            <div className="p-3.5 rounded-xl bg-background/50 border border-border space-y-3.5 animate-in fade-in duration-200">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-muted-foreground" />
                    玻璃模糊度 (Blur)
                  </span>
                  <p className="text-[11px] text-muted-foreground">
                    调节背部背景的毛玻璃模糊程度 ({acrylicBlur}px)
                  </p>
                </div>
                <div className="w-48 flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={30}
                    step={1}
                    value={acrylicBlur}
                    onChange={(e) =>
                      handleAcrylicBlurChange(Number(e.target.value))
                    }
                    className="w-full accent-primary cursor-pointer"
                  />
                  <span className="text-xs font-mono w-10 text-right font-medium">
                    {acrylicBlur}px
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 pt-2 border-t border-border/50">
                <div className="space-y-0.5">
                  <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-muted-foreground" />
                    面板透明度 (Opacity)
                  </span>
                  <p className="text-[11px] text-muted-foreground">
                    调节卡片底色的透光不透明度 ({acrylicOpacity}%)
                  </p>
                </div>
                <div className="w-48 flex items-center gap-3">
                  <input
                    type="range"
                    min={20}
                    max={100}
                    step={5}
                    value={acrylicOpacity}
                    onChange={(e) =>
                      handleAcrylicOpacityChange(Number(e.target.value))
                    }
                    className="w-full accent-primary cursor-pointer"
                  />
                  <span className="text-xs font-mono w-10 text-right font-medium">
                    {acrylicOpacity}%
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Custom Background Image Picker */}
          <div className="space-y-2 pt-1 border-t border-border">
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              className="hidden"
              onChange={handleFileSelect}
            />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <ImageIcon className="w-3.5 h-3.5 text-primary" />
                  自定义背景壁纸
                </span>
                <p className="text-[11px] text-muted-foreground">
                  从本地电脑选择一张图片作为客户端全景底图
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  icon={<Upload className="w-3.5 h-3.5" />}
                >
                  {bgImage ? '更换壁纸' : '选择本地图片'}
                </Button>

                {bgImage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearBgImage}
                    className="text-xs text-rose-500 hover:text-rose-600 hover:bg-rose-500/10"
                    icon={<Trash2 className="w-3.5 h-3.5" />}
                  >
                    清除壁纸
                  </Button>
                )}
              </div>
            </div>

            {/* Background Image Opacity Slider */}
            {bgImage && (
              <div className="flex items-center justify-between gap-4 p-3 rounded-xl bg-background/50 border border-border mt-2 animate-in fade-in duration-200">
                <div className="space-y-0.5">
                  <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-muted-foreground" />
                    壁纸不透明度 (Image Opacity)
                  </span>
                  <p className="text-[11px] text-muted-foreground">
                    调节底层壁纸本身的显隐明暗程度 ({bgOpacity}%)
                  </p>
                </div>
                <div className="w-48 flex items-center gap-3">
                  <input
                    type="range"
                    min={10}
                    max={100}
                    step={5}
                    value={bgOpacity}
                    onChange={(e) =>
                      handleBgOpacityChange(Number(e.target.value))
                    }
                    className="w-full accent-primary cursor-pointer"
                  />
                  <span className="text-xs font-mono w-10 text-right font-medium">
                    {bgOpacity}%
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3. Window & Auto-Launch Card */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-5 shadow-sm">
        <div className="pb-3 border-b border-border">
          <div className="flex items-center gap-2.5">
            <Power className="w-5 h-5 text-primary" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                窗口与系统启动
              </h3>
              <p className="text-xs text-muted-foreground">
                管理系统托盘常驻模式与开机自启动行为
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-xs font-medium text-foreground">
                关闭窗口时最小化到系统托盘
              </span>
              <p className="text-[11px] text-muted-foreground">
                点击窗口关闭按钮 (X) 时隐藏窗口并保持后台代理运行，不退出程序
              </p>
            </div>
            <Switch
              checked={closeToTray}
              onChange={handleCloseToTrayToggle}
              size="md"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-xs font-medium text-foreground">
                开机自动启动
              </span>
              <p className="text-[11px] text-muted-foreground">
                操作系统启动后自动拉起 Mihomo Multi 客户端
              </p>
            </div>
            <Switch
              checked={autoLaunch}
              onChange={handleAutoLaunchToggle}
              size="md"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-xs font-medium text-foreground">
                静默启动模式
              </span>
              <p className="text-[11px] text-muted-foreground">
                程序启动时自动最小化至系统托盘，不主动弹出主窗口
              </p>
            </div>
            <Switch
              checked={silentStart}
              onChange={handleSilentStartToggle}
              size="md"
            />
          </div>
        </div>
      </div>

      {/* 4. Storage & Directories Card */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4 shadow-sm">
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              应用数据与订阅存储路径
            </h3>
            <p className="text-xs text-muted-foreground">
              所有订阅 YAML 文件、运行配置与内核日志均保存在本地独立目录中
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
