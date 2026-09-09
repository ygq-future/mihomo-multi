import {
  AlertTriangle,
  Cpu,
  Download,
  ExternalLink,
  FolderOpen,
  Globe,
  Image as ImageIcon,
  Monitor,
  Moon,
  Network,
  Palette,
  Play,
  Plus,
  Power,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sliders,
  Sparkles,
  Square,
  Sun,
  Terminal,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { listen } from '@tauri-apps/api/event'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { APP_NAME, APP_VERSION, GITHUB_REPO_URL } from '../../constants'
import * as api from '../../services/tauri'
import { useAppStore } from '../../stores/appStore'
import type {
  AppUpdateCheckResult,
  AppUpdateProgressPayload,
  KernelUpdateCheckResult,
  MrsRulesInfo,
  UwpLoopbackStats,
} from '../../types'
import { formatUptime } from '../../utils/time'
import {
  Badge,
  Button,
  Input,
  Segmented,
  Select,
  Switch,
  toast,
} from '../common'

function isValidBypassRule(value: string): boolean {
  const val = value.trim()
  if (!val) return false

  // 1. localhost or <local>
  if (/^(?:localhost|<local>)$/i.test(val)) {
    return true
  }

  // 2. IPv4 wildcard (e.g. 127.*, 10.*, 192.168.*, 172.16.*)
  if (/^(?:\d{1,3}\.){1,3}\*$/.test(val)) {
    const parts = val.replace(/\.\*$/, '').split('.')
    return parts.every((p) => {
      const num = Number(p)
      return num >= 0 && num <= 255
    })
  }

  // 3. IPv4 standard address (e.g. 192.168.1.1, 10.0.0.1)
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(val)) {
    const parts = val.split('.')
    return parts.every((p) => {
      const num = Number(p)
      return num >= 0 && num <= 255
    })
  }

  // 4. IPv4 CIDR (e.g. 10.0.0.0/8, 192.168.0.0/16, 172.16.0.0/12)
  if (/^(?:\d{1,3}\.){3}\d{1,3}\/(?:[0-9]|[1-2][0-9]|3[0-2])$/.test(val)) {
    const [ip] = val.split('/')
    const parts = ip.split('.')
    return parts.every((p) => {
      const num = Number(p)
      return num >= 0 && num <= 255
    })
  }

  // 5. IPv6 or IPv6 wildcard (e.g. ::1, fe80::*, 2001:db8::1)
  if (
    /^([0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4}(\/\d{1,3}|\*)?$/.test(val) &&
    val.includes(':')
  ) {
    return true
  }

  // 6. Wildcard domain prefix: *.lan, *.local, *.google.com, .lan, etc.
  if (
    /^(?:\*\.|\.)[a-zA-Z0-9](?:[a-zA-Z0-9-_]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-_]{0,61}[a-zA-Z0-9])?)*$/.test(
      val,
    )
  ) {
    return true
  }

  // 7. Standard multi-label domain (must contain at least one dot): example.com, router.lan, sub.domain.org
  if (
    /^[a-zA-Z0-9](?:[a-zA-Z0-9-_]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-_]{0,61}[a-zA-Z0-9])?)+$/.test(
      val,
    )
  ) {
    return true
  }
  return false
}

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
    label: 'Cloudflare (204)',
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
    appStatus,
    coreStatus,
    config,
    portMappings,
    startCore,
    stopCore,
    restartCore,
    fetchConfig,
    saveConfig,
    setSystemProxy,
    openAppDataDir,
    coreLoading,
    fetchStatus,
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
  const [lightweightMode, setLightweightMode] = useState<boolean>(false)

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

  // Kernel Update State
  const [checkingUpdate, setCheckingUpdate] = useState<boolean>(false)
  const [upgradingKernel, setUpgradingKernel] = useState<boolean>(false)
  const [updateInfo, setUpdateInfo] = useState<KernelUpdateCheckResult | null>(
    null,
  )

  // System Proxy State
  const [newBypassInput, setNewBypassInput] = useState<string>('')
  const [defaultBypassList, setDefaultBypassList] = useState<string[]>([])
  const [uwpStats, setUwpStats] = useState<UwpLoopbackStats | null>(null)
  const [uwpLoading, setUwpLoading] = useState<boolean>(false)
  // Software Update State
  const [checkingAppUpdate, setCheckingAppUpdate] = useState<boolean>(false)
  const [downloadingAppUpdate, setDownloadingAppUpdate] =
    useState<boolean>(false)
  const [appUpdateInfo, setAppUpdateInfo] =
    useState<AppUpdateCheckResult | null>(null)
  const [appUpdateProgress, setAppUpdateProgress] =
    useState<AppUpdateProgressPayload | null>(null)
  const [selectedAssetUrl, setSelectedAssetUrl] = useState<string>('')
  const currentAppVersion = (
    appStatus?.version ||
    appUpdateInfo?.currentVersion ||
    APP_VERSION
  ).replace(/^v/i, '')

  // MRS Rule Providers State
  const [rulesInfo, setRulesInfo] = useState<MrsRulesInfo | null>(null)
  const [updatingRules, setUpdatingRules] = useState<boolean>(false)
  useEffect(() => {
    let unlisten: (() => void) | undefined
    listen<AppUpdateProgressPayload>('app-update-progress', (event) => {
      setAppUpdateProgress(event.payload)
    })
      .then((fn) => {
        unlisten = fn
      })
      .catch(() => {})

    return () => {
      if (unlisten) unlisten()
    }
  }, [])

  useEffect(() => {
    api
      .getDefaultBypassList()
      .then(setDefaultBypassList)
      .catch(() => {})
    api
      .getUwpLoopbackStatus()
      .then(setUwpStats)
      .catch(() => {})
    api
      .getRulesInfo()
      .then(setRulesInfo)
      .catch(() => {})
  }, [])

  const enabledPorts = portMappings
    .filter((m) => m.enabled)
    .sort((a, b) => a.port - b.port)

  const handleToggleSystemProxy = async (checked: boolean) => {
    if (checked) {
      const targetPort =
        config?.systemProxyPort &&
        enabledPorts.some((m) => m.port === config.systemProxyPort)
          ? config.systemProxyPort
          : enabledPorts[0]?.port

      if (!targetPort) {
        toast.error('当前无可用且已启用的监听端口，请先在端口管理中启用端口')
        return
      }

      try {
        await setSystemProxy(true, targetPort)
        if (config?.systemProxySyncEnv ?? true) {
          toast.success(`已将端口 ${targetPort} 设为系统代理并同步环境变量`)
        } else {
          toast.success(`已将端口 ${targetPort} 设为系统代理`)
        }
      } catch (err) {
        toast.error(
          `开启系统代理失败: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    } else {
      try {
        await setSystemProxy(false)
        if (config?.systemProxySyncEnv ?? true) {
          toast.success('已关闭系统代理并清除环境变量')
        } else {
          toast.success('已关闭系统代理')
        }
      } catch (err) {
        toast.error(
          `关闭系统代理失败: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }

  const handleToggleSyncEnv = async (checked: boolean) => {
    if (!config) return
    try {
      await saveConfig({
        ...config,
        systemProxySyncEnv: checked,
      })
      toast.success(
        checked ? '已开启环境变量联动同步' : '已关闭环境变量联动同步',
      )
    } catch (err) {
      toast.error(
        `更新设置失败: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  const handlePortSelectChange = async (portStr: string) => {
    const port = Number(portStr)
    if (!port) return
    try {
      await setSystemProxy(true, port)
      toast.success(`已切换系统代理端口至 ${port}`)
    } catch (err) {
      toast.error(
        `切换系统代理端口失败: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  const handleAddBypass = async () => {
    const trimmed = newBypassInput.trim()
    if (!trimmed) return
    if (!config) return

    if (!isValidBypassRule(trimmed)) {
      toast.error(
        '请输入合法的域名 (如 *.example.com)、IP (如 192.168.1.1) 或网段 (如 10.0.0.0/8)',
      )
      return
    }

    const lower = trimmed.toLowerCase()
    const currentList = config.systemProxyBypassUser || []
    if (currentList.some((d) => d.toLowerCase() === lower)) {
      toast.warning(`排除项「${trimmed}」已在自定义排除列表中`)
      return
    }

    if (defaultBypassList.some((d) => d.toLowerCase() === lower)) {
      toast.warning(`排除项「${trimmed}」已存在于系统内置排除项中`)
      return
    }

    const updated = [...currentList, trimmed]
    try {
      await saveConfig({ ...config, systemProxyBypassUser: updated })
      setNewBypassInput('')
      toast.success(`已添加排除域名/IP: ${trimmed}`)
    } catch (err) {
      toast.error(
        `添加失败: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  const handleRemoveBypass = async (item: string) => {
    if (!config) return
    const currentList = config.systemProxyBypassUser || []
    const updated = currentList.filter((d) => d !== item)
    try {
      await saveConfig({ ...config, systemProxyBypassUser: updated })
      toast.success(`已移除排除项: ${item}`)
    } catch (err) {
      toast.error(
        `移除失败: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  const fetchUwpStats = async () => {
    try {
      const stats = await api.getUwpLoopbackStatus()
      setUwpStats(stats)
    } catch {
      // ignore
    }
  }

  const handleExemptAllUwp = async () => {
    setUwpLoading(true)
    try {
      const stats = await api.exemptAllUwpLoopback()
      setUwpStats(stats)
      toast.success(`成功为全部 ${stats.totalCount} 个 UWP 应用解除回环隔离`)
    } catch (err) {
      toast.error(
        `UWP 回环豁免失败: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      setUwpLoading(false)
    }
  }

  const handleClearAllUwp = async () => {
    setUwpLoading(true)
    try {
      const stats = await api.clearAllUwpLoopback()
      setUwpStats(stats)
      toast.success('已清除所有 UWP 应用回环豁免')
    } catch (err) {
      toast.error(
        `清除 UWP 回环豁免失败: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      setUwpLoading(false)
    }
  }

  const handleCheckKernelUpdate = async () => {
    setCheckingUpdate(true)
    try {
      const res = await api.checkKernelUpdate()
      setUpdateInfo(res)
      if (res.hasUpdate) {
        toast.info(`检测到新版本 Mihomo 内核：${res.latestVersion}`)
      } else {
        toast.success(`当前已是最新内核版本 (${res.currentVersion})`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setCheckingUpdate(false)
    }
  }

  const handleUpgradeKernel = async () => {
    setUpgradingKernel(true)
    try {
      toast.info('正在下载并校验新内核，请稍候...')
      const res = await api.upgradeKernel()
      toast.success(`内核升级成功！已平滑切换至 ${res.currentVersion}`)
      await fetchStatus()
      const refreshed = await api.checkKernelUpdate().catch(() => null)
      if (refreshed) setUpdateInfo(refreshed)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setUpgradingKernel(false)
    }
  }

  const handleUpdateRules = async () => {
    if (updatingRules) return
    setUpdatingRules(true)
    try {
      toast.info('正在请求官方最新 MRS 规则集，请稍候...')
      const res = await api.updateRules()
      setRulesInfo(res)
      toast.success('国内分流规则库已成功更新为最新版本！')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setUpdatingRules(false)
    }
  }

  const handleCheckAppUpdate = async () => {
    setCheckingAppUpdate(true)
    try {
      const res = await api.checkAppUpdate()
      setAppUpdateInfo(res)
      if (res.asset) {
        setSelectedAssetUrl(res.asset.downloadUrl)
      } else if (res.availableAssets.length > 0) {
        setSelectedAssetUrl(res.availableAssets[0].downloadUrl)
      }
      if (res.hasUpdate) {
        toast.info(`检测到软件新版本：v${res.latestVersion}`)
      } else {
        toast.success(`当前已是最新版本 (v${res.currentVersion})`)
      }
    } catch (err) {
      toast.error(
        `检查软件更新失败: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      setCheckingAppUpdate(false)
    }
  }

  const handleInstallAppUpdate = async () => {
    if (!appUpdateInfo) return
    const asset =
      appUpdateInfo.availableAssets.find(
        (a) => a.downloadUrl === selectedAssetUrl,
      ) || appUpdateInfo.asset

    if (!asset) {
      toast.error('未找到适配当前平台的更新文件')
      return
    }

    setDownloadingAppUpdate(true)
    try {
      const res = await api.installAppUpdate(
        asset.downloadUrl,
        asset.name,
        asset.packageType,
      )
      if (asset.packageType === 'installer') {
        toast.success(res.message || '安装程序已启动，正在关闭旧程序...')
      } else {
        toast.success(res.message || '便携包下载完成')
      }
    } catch (err) {
      toast.error(
        `更新失败: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      setDownloadingAppUpdate(false)
    }
  }

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
      setLightweightMode(config.lightweightMode ?? false)
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
    toast.success(checked ? '已开启局域网连接' : '已恢复为仅监听本机回环')
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
    const trimmed = timeoutMsInput.trim()
    const isPureInteger = /^\d+$/.test(trimmed)
    const ms = isPureInteger ? Number.parseInt(trimmed, 10) : 0
    if (!isPureInteger || !ms || ms < 500 || ms > 60000) {
      toast.error('超时时间必须为整数且在 500 ~ 60000 ms 范围内')
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
    const trimmed = fallbackIntervalInput.trim()
    const isPureInteger = /^\d+$/.test(trimmed)
    const sec = isPureInteger ? Number.parseInt(trimmed, 10) : 0
    if (!isPureInteger || !sec || sec < 2 || sec > 300) {
      toast.error('检测间隔必须为整数且在 2 ~ 300 秒范围内')
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
  const handleLightweightModeToggle = async (checked: boolean) => {
    setLightweightMode(checked)
    if (!config) return
    await saveConfig({
      ...config,
      lightweightMode: checked,
    })
    toast.success(checked ? '已开启轻量模式' : '已关闭轻量模式')
  }

  const handleResetWindowSize = async () => {
    try {
      await api.resetWindowSize()
      toast.success('窗口尺寸已恢复默认')
    } catch (err) {
      toast.error(
        `重置窗口尺寸失败: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  const handlePortBlur = async () => {
    const trimmed = controllerPortInput.trim()
    const isPureInteger = /^\d+$/.test(trimmed)
    const portNum = isPureInteger ? Number.parseInt(trimmed, 10) : Number.NaN
    if (
      !isPureInteger ||
      Number.isNaN(portNum) ||
      portNum < 1024 ||
      portNum > 65535
    ) {
      if (config) {
        setControllerPortInput(String(config.controllerPort))
      }
      setPortError('端口号必须为整数且在 1024 ~ 65535 范围内')
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

        {/* Core Version, Path & Online Update Section */}
        <div className="p-4 rounded-xl bg-background/60 border border-border space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-foreground">
                  Mihomo 核心版本
                </span>
                {updateInfo && (
                  <Badge
                    variant={updateInfo.isPortable ? 'success' : 'secondary'}
                    size="sm"
                  >
                    {updateInfo.isPortable
                      ? '便携模式 (.portable)'
                      : '安装模式 (AppData)'}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                <Terminal className="w-3.5 h-3.5 shrink-0 text-primary" />
                <span className="truncate">
                  {coreStatus?.version || 'Mihomo Core (未知版本)'}
                </span>
              </div>
              {coreStatus?.sidecarPath && (
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground/80 font-mono">
                  <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate" title={coreStatus.sidecarPath}>
                    {coreStatus.sidecarPath}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="secondary"
                size="sm"
                disabled={checkingUpdate || upgradingKernel}
                onClick={handleCheckKernelUpdate}
                icon={
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${checkingUpdate ? 'animate-spin' : ''}`}
                  />
                }
              >
                {checkingUpdate ? '检查中...' : '检查内核更新'}
              </Button>
            </div>
          </div>

          {/* Update Available Banner */}
          {updateInfo && updateInfo.hasUpdate && (
            <div className="p-3 rounded-lg bg-primary/10 border border-primary/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs animate-in fade-in">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 font-medium text-primary">
                  <Sparkles className="w-4 h-4 shrink-0" />
                  <span>发现新版本：{updateInfo.latestVersion}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  下载并替换内核文件，完成后自动重载生效。
                </p>
                {updateInfo.targetPath && (
                  <p className="text-[10px] text-muted-foreground/70 font-mono truncate max-w-md">
                    目标落盘路径：{updateInfo.targetPath}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {updateInfo.releaseUrl && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(updateInfo.releaseUrl, '_blank')}
                    icon={<ExternalLink className="w-3.5 h-3.5" />}
                  >
                    更新说明
                  </Button>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  disabled={upgradingKernel}
                  onClick={handleUpgradeKernel}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
                  icon={
                    upgradingKernel ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )
                  }
                >
                  {upgradingKernel ? '正在更新...' : '立即更新内核'}
                </Button>
              </div>
            </div>
          )}

          {/* MRS Rule Providers Info & Update */}
          <div className="p-3 rounded-lg bg-background/60 border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-foreground">
                  国内分流规则库 (MRS 二进制)
                </span>
                {rulesInfo?.all_present ? (
                  <Badge variant="success" size="sm">
                    已就绪 (4/4)
                  </Badge>
                ) : (
                  <Badge variant="warning" size="sm">
                    缺少 {rulesInfo?.missing.length ?? 0} 个文件
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                包含 111,004 条中国域名及完整中国 IP CIDR。采用紧凑 Meta
                规则集格式，极速匹配且仅占极小内存
              </p>
              <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground/80 font-mono">
                <span>
                  最后更新：
                  {rulesInfo?.last_updated_at
                    ? new Date(
                        rulesInfo.last_updated_at * 1000,
                      ).toLocaleString()
                    : '跟随安装包内置'}
                </span>
                {rulesInfo?.total_size ? (
                  <span>
                    库体积：{(rulesInfo.total_size / 1024).toFixed(1)} KB
                  </span>
                ) : null}
              </div>
            </div>
            <div className="shrink-0">
              <Button
                size="sm"
                variant="secondary"
                onClick={handleUpdateRules}
                disabled={updatingRules}
                icon={
                  updatingRules ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )
                }
              >
                {updatingRules ? '正在更新规则...' : '立即更新规则库'}
              </Button>
            </div>
          </div>
        </div>

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
                integerOnly
                step={1}
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

          <div className="flex items-center justify-between gap-6">
            <div className="space-y-0.5 min-w-0 flex-1">
              <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
                <Network className="w-3.5 h-3.5 text-primary" />
                允许局域网连接
              </span>
              <p className="text-[11px] text-muted-foreground">
                开启后端口映射将监听所有网卡接口
                (0.0.0.0)，允许局域网或虚拟机设备连接；关闭时仅监听本机回环地址
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
                  integerOnly
                  step={1}
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
                  integerOnly
                  step={1}
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
            <div className="flex items-center justify-between gap-6">
              <div className="space-y-0.5 min-w-0 flex-1">
                <span className="text-xs font-medium text-foreground">
                  惰性健康检查
                </span>
                <p className="text-[11px] text-muted-foreground">
                  关闭时持续主动测活；开启后仅在该端口有流量经过时才发起检测
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

      {/* System Proxy Card */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-5 shadow-sm">
        <div className="pb-3 border-b border-border">
          <div className="flex items-center gap-2.5">
            <Globe className="w-5 h-5 text-primary" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                系统代理设置
              </h3>
              <p className="text-xs text-muted-foreground">
                接管操作系统网络代理，多监听端口单选互斥，支持联动写入环境变量
                (all_proxy, http_proxy, https_proxy, no_proxy)
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {/* Main Switch */}
          <div className="flex items-center justify-between gap-6">
            <div className="space-y-0.5 min-w-0 flex-1">
              <label className="text-xs font-medium text-foreground">
                启用系统代理
              </label>
              <p className="text-[11px] text-muted-foreground">
                将选定监听端口设为系统全局代理。内核停止或应用退出时将自动清理，防止系统断网
              </p>
            </div>
            <Switch
              checked={config?.systemProxyEnabled ?? false}
              onChange={handleToggleSystemProxy}
              size="md"
            />
          </div>

          {/* Port Select when Enabled */}
          {config?.systemProxyEnabled && (
            <div className="pt-3 border-t border-border/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="space-y-0.5">
                <label className="text-xs font-medium text-foreground">
                  绑定的监听端口
                </label>
                <p className="text-[11px] text-muted-foreground">
                  从当前已启用的监听端口中选择作为系统代理出口 (严格单选互斥)
                </p>
              </div>
              <div className="w-full sm:w-80">
                {enabledPorts.length === 0 ? (
                  <span className="text-xs text-rose-500 font-medium">
                    暂无已启用的监听端口，请先在端口管理中启用
                  </span>
                ) : (
                  <Select
                    value={String(
                      config?.systemProxyPort ?? enabledPorts[0]?.port ?? '',
                    )}
                    onChange={(val) => handlePortSelectChange(String(val))}
                    options={enabledPorts.map((m) => ({
                      value: String(m.port),
                      label: `端口 ${m.port} (${m.protocol.toUpperCase()} - ${m.nodeName}${
                        m.description ? ` · ${m.description}` : ''
                      })`,
                    }))}
                  />
                )}
              </div>
            </div>
          )}

          {/* Sync User Environment Variables Switch */}
          <div className="pt-3 border-t border-border/70 flex items-center justify-between gap-6">
            <div className="space-y-0.5 min-w-0 flex-1">
              <label className="text-xs font-medium text-foreground">
                联动设置环境变量
              </label>
              <p className="text-[11px] text-muted-foreground">
                开启系统代理时，联动写入 all_proxy、http_proxy、https_proxy 与
                no_proxy
                用户环境变量，方便终端命令行工具自动走代理。关闭则仅设置系统代理，不修改环境变量
              </p>
            </div>
            <Switch
              checked={config?.systemProxySyncEnv ?? true}
              onChange={handleToggleSyncEnv}
              size="md"
            />
          </div>

          {/* Bypass Domains Section */}
          <div className="pt-3 border-t border-border/70 space-y-3">
            <div>
              <label className="text-xs font-medium text-foreground">
                排除域名与 IP
              </label>
              <p className="text-[11px] text-muted-foreground">
                匹配列表中的网络请求将不经过系统代理直连访问，若开启环境变量同步将同时注入到系统的
                no_proxy 环境变量中
              </p>
            </div>

            {/* Add Custom Bypass Input */}
            <div className="flex items-center gap-2 max-w-lg">
              <Input
                value={newBypassInput}
                onChange={(e) => setNewBypassInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddBypass()
                  }
                }}
                placeholder="输入排除域名或 IP (如 *.example.com, 10.0.0.0/8)..."
              />
              <Button
                variant="secondary"
                size="md"
                onClick={handleAddBypass}
                icon={<Plus className="w-3.5 h-3.5" />}
              >
                添加
              </Button>
            </div>

            {/* Custom Bypass Tags */}
            {config?.systemProxyBypassUser &&
              config.systemProxyBypassUser.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    自定义排除项 ({config.systemProxyBypassUser.length})：
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {config.systemProxyBypassUser.map((domain) => (
                      <Badge
                        key={domain}
                        variant="secondary"
                        size="sm"
                        className="flex items-center gap-1.5 font-mono text-xs py-1 px-2.5 bg-secondary hover:bg-secondary/80 border border-border/80 text-foreground shadow-xs transition-colors"
                      >
                        <span>{domain}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveBypass(domain)}
                          className="text-muted-foreground hover:text-destructive transition-colors ml-0.5"
                          title="移除此排除项"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

            {/* Default Bypass Tags (Preview) */}
            <div className="space-y-1.5 pt-1">
              <span className="text-[11px] font-medium text-muted-foreground">
                系统内置排除项 (局域网与本地回环)：
              </span>
              <div className="flex flex-wrap gap-1">
                {defaultBypassList.map((item) => (
                  <Badge
                    key={item}
                    variant="secondary"
                    size="sm"
                    className="font-mono text-[10px] text-muted-foreground/80 py-0 px-1.5"
                  >
                    {item}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          {/* UWP Loopback Exemption (Windows Only) */}
          {uwpStats?.supported && (
            <div className="pt-3 border-t border-border/70 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium text-foreground">
                      UWP 应用回环代理豁免 (Windows AppContainer)
                    </label>
                    <Badge
                      variant={
                        uwpStats.exemptedCount > 0 ? 'success' : 'secondary'
                      }
                      size="sm"
                      className="text-[10px] py-0 px-1.5"
                    >
                      已豁免 {uwpStats.exemptedCount} / 共 {uwpStats.totalCount}{' '}
                      个应用
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    解除 Windows 沙箱对本地 127.0.0.1
                    代理端口的隔离，使微软商店、UWP 应用可正常连入系统代理
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={fetchUwpStats}
                    disabled={uwpLoading}
                    icon={
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${
                          uwpLoading ? 'animate-spin' : ''
                        }`}
                      />
                    }
                    title="刷新豁免状态"
                  >
                    刷新
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleClearAllUwp}
                    disabled={uwpLoading || uwpStats.exemptedCount === 0}
                    icon={<Trash2 className="w-3.5 h-3.5" />}
                  >
                    清除豁免
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleExemptAllUwp}
                    disabled={uwpLoading}
                    icon={<ShieldCheck className="w-3.5 h-3.5" />}
                  >
                    一键豁免全部 UWP
                  </Button>
                </div>
              </div>
            </div>
          )}
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
          <div className="flex items-center justify-between gap-6">
            <div className="space-y-0.5 min-w-0 flex-1">
              <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                磨砂亚克力玻璃质感
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
                    玻璃模糊度
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
                    面板透明度
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
                    壁纸不透明度
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
          <div className="flex items-center justify-between gap-6">
            <div className="space-y-0.5 min-w-0 flex-1">
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

          <div className="flex items-center justify-between gap-6">
            <div className="space-y-0.5 min-w-0 flex-1">
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

          <div className="flex items-center justify-between gap-6">
            <div className="space-y-0.5 min-w-0 flex-1">
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
          <div className="flex items-center justify-between gap-6">
            <div className="space-y-0.5 min-w-0 flex-1">
              <span className="text-xs font-medium text-foreground">
                轻量模式
              </span>
              <p className="text-[11px] text-muted-foreground">
                关闭窗口时销毁前端界面以降低内存占用，点击托盘时重新加载
              </p>
            </div>
            <Switch
              checked={lightweightMode}
              onChange={handleLightweightModeToggle}
              size="md"
            />
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-border/70">
            <div className="space-y-0.5">
              <span className="text-xs font-medium text-foreground">
                重置窗口尺寸
              </span>
              <p className="text-[11px] text-muted-foreground">
                将窗口尺寸与位置恢复为默认大小并清除记忆缓存
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetWindowSize}
              icon={<RotateCcw className="w-3.5 h-3.5" />}
            >
              恢复默认大小
            </Button>
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

      {/* 5. Software About & Update Card */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-border gap-3">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-5 h-5 text-primary" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">
                  软件关于与更新 (About & Update)
                </h3>
                <Badge variant="primary" size="sm" className="font-mono">
                  v{currentAppVersion}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {APP_NAME} 极简多端口代理桌面客户端，支持一键检测并从 GitHub
                下载适配安装包或便携包
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex"
            >
              <Button
                variant="outline"
                size="sm"
                icon={<ExternalLink className="w-3.5 h-3.5" />}
              >
                GitHub 仓库
              </Button>
            </a>
            <Button
              variant="secondary"
              size="sm"
              disabled={checkingAppUpdate || downloadingAppUpdate}
              onClick={handleCheckAppUpdate}
              icon={
                <RefreshCw
                  className={`w-3.5 h-3.5 ${
                    checkingAppUpdate ? 'animate-spin' : ''
                  }`}
                />
              }
            >
              {checkingAppUpdate ? '检查中...' : '检查软件更新'}
            </Button>
          </div>
        </div>

        {/* Status / Overview */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="p-3 rounded-lg bg-background/50 border border-border space-y-1">
            <span className="text-muted-foreground">当前运行版本</span>
            <div className="font-mono font-medium text-foreground">
              v{currentAppVersion}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-background/50 border border-border space-y-1">
            <span className="text-muted-foreground">部署形态</span>
            <div className="font-medium text-foreground">
              {appUpdateInfo ? (
                appUpdateInfo.isInstalled ? (
                  <Badge variant="secondary" size="sm">
                    安装版 (Installer)
                  </Badge>
                ) : (
                  <Badge variant="outline" size="sm">
                    便携版 (Portable)
                  </Badge>
                )
              ) : (
                '便携 / 安装版'
              )}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-background/50 border border-border space-y-1">
            <span className="text-muted-foreground">最新发行版本</span>
            <div className="font-mono font-medium text-foreground">
              {appUpdateInfo ? `v${appUpdateInfo.latestVersion}` : '未检查'}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-background/50 border border-border space-y-1">
            <span className="text-muted-foreground">更新状态</span>
            <div className="font-medium text-foreground">
              {appUpdateInfo ? (
                appUpdateInfo.hasUpdate ? (
                  <Badge variant="warning" size="sm">
                    有新版本可用
                  </Badge>
                ) : (
                  <Badge variant="success" size="sm">
                    已是最新版本
                  </Badge>
                )
              ) : (
                '待检查'
              )}
            </div>
          </div>
        </div>

        {/* Update Available Banner & Downloader */}
        {appUpdateInfo && appUpdateInfo.hasUpdate && (
          <div className="p-4 rounded-xl bg-primary/10 border border-primary/20 space-y-4 text-xs animate-in fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 font-medium text-primary">
                  <Sparkles className="w-4 h-4 shrink-0" />
                  <span className="text-sm font-semibold">
                    发现新版本：v{appUpdateInfo.latestVersion}
                  </span>
                  {appUpdateInfo.releaseName && (
                    <span className="text-xs text-muted-foreground">
                      ({appUpdateInfo.releaseName})
                    </span>
                  )}
                </div>
                {appUpdateInfo.publishedAt && (
                  <p className="text-[11px] text-muted-foreground">
                    发布时间：
                    {new Date(appUpdateInfo.publishedAt).toLocaleString()}
                  </p>
                )}
              </div>

              {appUpdateInfo.releaseUrl && (
                <a
                  href={appUpdateInfo.releaseUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex shrink-0"
                >
                  <Button
                    variant="outline"
                    size="sm"
                    icon={<ExternalLink className="w-3.5 h-3.5" />}
                  >
                    查看 Release 说明
                  </Button>
                </a>
              )}
            </div>

            {/* Asset Selection (if multiple) */}
            {appUpdateInfo.availableAssets.length > 1 && (
              <div className="space-y-1.5 pt-1 border-t border-primary/15">
                <label className="text-xs font-medium text-foreground">
                  选择下载资产格式：
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {appUpdateInfo.availableAssets.map((asset) => (
                    <button
                      type="button"
                      key={asset.downloadUrl}
                      onClick={() => setSelectedAssetUrl(asset.downloadUrl)}
                      className={`flex items-center justify-between p-2.5 rounded-lg border text-left transition-all ${
                        selectedAssetUrl === asset.downloadUrl
                          ? 'border-primary bg-primary/15 text-primary'
                          : 'border-border bg-background/50 hover:border-border/80 text-muted-foreground'
                      }`}
                    >
                      <div className="space-y-0.5 min-w-0 pr-2">
                        <div className="font-mono text-xs font-medium truncate">
                          {asset.name}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {asset.packageType === 'installer'
                            ? '安装包（自动运行并关闭旧进程）'
                            : '便携包（下载至根目录供解压）'}
                        </div>
                      </div>
                      <Badge
                        variant="secondary"
                        size="sm"
                        className="shrink-0 font-mono text-[10px]"
                      >
                        {(asset.size / 1024 / 1024).toFixed(1)} MB
                      </Badge>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Single Asset info if only 1 */}
            {appUpdateInfo.availableAssets.length === 1 &&
              appUpdateInfo.asset && (
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-background/50 border border-border text-xs">
                  <div className="space-y-0.5">
                    <div className="font-mono font-medium text-foreground">
                      {appUpdateInfo.asset.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {appUpdateInfo.asset.packageType === 'installer'
                        ? '安装程序包：下载后自动启动安装并退出旧进程'
                        : '便携压缩包：下载后保存至软件根目录并打开文件夹'}
                    </div>
                  </div>
                  <Badge variant="secondary" size="sm" className="font-mono">
                    {(appUpdateInfo.asset.size / 1024 / 1024).toFixed(1)} MB
                  </Badge>
                </div>
              )}

            {/* Release notes */}
            {appUpdateInfo.releaseNotes && (
              <div className="space-y-1 pt-1 border-t border-primary/15">
                <span className="text-[11px] font-medium text-muted-foreground">
                  更新说明 (Release Notes)：
                </span>
                <div className="p-3 rounded-lg bg-background/70 border border-border max-h-36 overflow-y-auto font-mono text-[11px] text-foreground/90 whitespace-pre-wrap leading-relaxed select-text">
                  {appUpdateInfo.releaseNotes}
                </div>
              </div>
            )}

            {/* Download Progress or Action */}
            {downloadingAppUpdate ? (
              <div className="space-y-2 pt-2 border-t border-primary/15">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-primary">
                    {appUpdateProgress?.stage === 'ready'
                      ? '下载完成，正在处理中...'
                      : '正在下载更新包...'}
                  </span>
                  <span className="font-mono text-muted-foreground">
                    {appUpdateProgress
                      ? `${(appUpdateProgress.downloadedBytes / 1024 / 1024).toFixed(1)} MB / ${(appUpdateProgress.totalBytes / 1024 / 1024).toFixed(1)} MB (${appUpdateProgress.percentage}%)`
                      : '准备中...'}
                  </span>
                </div>
                <div className="w-full bg-background/80 rounded-full h-2 overflow-hidden border border-border">
                  <div
                    className="bg-primary h-2 rounded-full transition-all duration-150"
                    style={{
                      width: `${appUpdateProgress?.percentage ?? 0}%`,
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="flex justify-end pt-2 border-t border-primary/15">
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleInstallAppUpdate}
                  icon={<Download className="w-4 h-4" />}
                >
                  立即下载并更新
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
