import { useShallow } from 'zustand/react/shallow'
import {
  AlertTriangle,
  Clock,
  Cpu,
  Download,
  ExternalLink,
  Eye,
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

import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  APP_NAME,
  APP_VERSION,
  DEFAULT_ACRYLIC_BLUR,
  DEFAULT_ACRYLIC_OPACITY,
  DEFAULT_BACKGROUND_OPACITY,
  DEFAULT_CONTROLLER_PORT,
  DEFAULT_FALLBACK_INTERVAL,
  DEFAULT_FALLBACK_LAZY,
  DEFAULT_NETWORK_CHECK_INTERVAL,
  DEFAULT_TEST_URL,
  DEFAULT_TIMEOUT_MS,
  FIXED_DIRECT_PORT_ID,
  GITHUB_REPO_URL,
  MAX_FALLBACK_INTERVAL,
  MAX_TIMEOUT_MS,
  MAX_NETWORK_CHECK_INTERVAL,
  MIN_FALLBACK_INTERVAL,
  MIN_TIMEOUT_MS,
  MIN_NETWORK_CHECK_INTERVAL,
} from '../../constants'
import * as api from '../../services/tauri'
import { useAppStore } from '../../stores/appStore'
import { type LocalePreference, useTranslation } from '../../i18n'
import type {
  AppUpdateProgressPayload,
  MrsRulesInfo,
  UwpLoopbackStats,
} from '../../types'
import { CliSettingsCard } from '../settings/CliSettingsCard'

import { createEventScope } from '../../services/events'
import {
  Badge,
  Button,
  Input,
  Segmented,
  Select,
  Slider,
  Switch,
  toast,
} from '../common'
import { LiveUptimeDisplay } from './LiveUptimeDisplay'
import { sortBypassItems } from '../../utils/bypassSort'
import { UwpAppListModal } from '../setting/UwpAppListModal'
import { scrollToSettingCard } from '../../utils/scroll'
import {
  isVersionNewer,
  loadCachedAppUpdate,
  saveCachedAppUpdate,
} from '../../utils/appUpdateCache'

function isValidBypassRule(value: string): boolean {
  const val = value.trim()
  if (!val) return false

  // 严禁纯通配符 * 或 *.*
  if (val === '*' || val === '*.*') return false

  // 特例：localhost 允许
  if (/^localhost$/i.test(val)) {
    return true
  }

  // 1. IPv4 单 IP (例如 119.29.106.76)
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(val)) {
    const parts = val.split('.')
    return parts.every((p) => {
      const num = Number(p)
      return num >= 0 && num <= 255
    })
  }

  // 2. IPv4 CIDR 网段 (例如 10.0.0.0/8, 192.168.0.0/16)
  if (/^(?:\d{1,3}\.){3}\d{1,3}\/(?:[0-9]|[1-2][0-9]|3[0-2])$/.test(val)) {
    const [ip] = val.split('/')
    const parts = ip.split('.')
    return parts.every((p) => {
      const num = Number(p)
      return num >= 0 && num <= 255
    })
  }

  // 3. IPv6 或 IPv6 CIDR 网段 (例如 ::1, 2001:db8::1, fe80::/10)
  if (
    val.includes(':') &&
    /^([0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4}(\/(?:[0-9]|[1-9][0-9]|1[0-1][0-9]|12[0-8]))?$/.test(
      val,
    )
  ) {
    return true
  }

  // 4. 通配符域名：必须以 *. 开头，通配符后面必须至少包含二级域名（即至少包含一个点，如 *.sheepyu.top，严禁单字 *.top）
  if (val.startsWith('*.')) {
    const rest = val.slice(2)
    return (
      /^[a-zA-Z0-9](?:[a-zA-Z0-9-_]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-_]{0,61}[a-zA-Z0-9])?)+$/.test(
        rest,
      ) && !rest.endsWith('.')
    )
  }

  // 5. 精确域名：必须包含至少一个点（例如 sheepyu.top、api.sheepyu.top，严禁单字 top、com）
  if (
    /^[a-zA-Z0-9](?:[a-zA-Z0-9-_]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-_]{0,61}[a-zA-Z0-9])?)+$/.test(
      val,
    )
  ) {
    return true
  }

  return false
}

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

export const SettingView: React.FC = () => {
  const { t, locale, localePreference, setLocale } = useTranslation()
  const themeOptions = useMemo(
    () => [
      {
        value: 'dark',
        label: t('settings.theme.dark'),
        icon: <Moon className="w-3.5 h-3.5" />,
      },
      {
        value: 'light',
        label: t('settings.theme.light'),
        icon: <Sun className="w-3.5 h-3.5" />,
      },
      {
        value: 'system',
        label: t('settings.theme.system'),
        icon: <Monitor className="w-3.5 h-3.5" />,
      },
    ],
    [t],
  )
  const logLevelOptions = useMemo(
    () => [
      { value: 'info', label: t('settingsPage.core.logLevel.info') },
      { value: 'warning', label: t('settingsPage.core.logLevel.warning') },
      { value: 'error', label: t('settingsPage.core.logLevel.error') },
      { value: 'debug', label: t('settingsPage.core.logLevel.debug') },
      { value: 'silent', label: t('settingsPage.core.logLevel.silent') },
    ],
    [t],
  )
  const formatLastCheckTime = (ts: number | null): string => {
    if (!ts) return t('settingsPage.about.notChecked')
    return new Date(ts).toLocaleString(locale)
  }
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
    setEnvProxy,
    openAppDataDir,
    coreLoading,
    fetchStatus,
    setTun,
    tunStatus,
    fetchTunStatus,
    restartAsAdmin,
    targetSettingSection,
    clearTargetSettingSection,
    appUpdateInfo,
    setAppUpdateInfo,
  } = useAppStore(
    useShallow((s) => ({
      appStatus: s.appStatus,
      coreStatus: s.coreStatus,
      config: s.config,
      portMappings: s.portMappings,
      startCore: s.startCore,
      stopCore: s.stopCore,
      restartCore: s.restartCore,
      fetchConfig: s.fetchConfig,
      saveConfig: s.saveConfig,
      setSystemProxy: s.setSystemProxy,
      setEnvProxy: s.setEnvProxy,
      openAppDataDir: s.openAppDataDir,
      coreLoading: s.coreLoading,
      fetchStatus: s.fetchStatus,
      setTun: s.setTun,
      tunStatus: s.tunStatus,
      fetchTunStatus: s.fetchTunStatus,
      restartAsAdmin: s.restartAsAdmin,
      targetSettingSection: s.targetSettingSection,
      clearTargetSettingSection: s.clearTargetSettingSection,
      appUpdateInfo: s.appUpdateInfo,
      setAppUpdateInfo: s.setAppUpdateInfo,
    })),
  )
  const [tunLoading, setTunLoading] = useState<boolean>(false)
  const [controllerPortInput, setControllerPortInput] = useState<string>(
    String(DEFAULT_CONTROLLER_PORT),
  )
  const [isSavingPort, setIsSavingPort] = useState<boolean>(false)
  const [portError, setPortError] = useState<string | null>(null)
  const [logLevel, setLogLevel] = useState<string>('info')
  const [allowLan, setAllowLan] = useState<boolean>(false)

  // Appearance & Personalization
  const [theme, setTheme] = useState<string>('system')
  const [acrylicEffect, setAcrylicEffect] = useState<boolean>(false)
  const [acrylicBlur, setAcrylicBlur] = useState<number>(DEFAULT_ACRYLIC_BLUR)
  const [acrylicOpacity, setAcrylicOpacity] = useState<number>(
    DEFAULT_ACRYLIC_OPACITY,
  )
  const [bgImage, setBgImage] = useState<string>('')
  const [bgOpacity, setBgOpacity] = useState<number>(DEFAULT_BACKGROUND_OPACITY)

  // System & Window
  const [closeToTray, setCloseToTray] = useState<boolean>(true)
  const [autoLaunch, setAutoLaunch] = useState<boolean>(false)
  const [silentStart, setSilentStart] = useState<boolean>(false)
  const [lightweightMode, setLightweightMode] = useState<boolean>(false)
  const [checkUpdateOnStart, setCheckUpdateOnStart] = useState<boolean>(true)

  // Probe & Fallback Strategy
  const [testUrl, setTestUrl] = useState<string>(DEFAULT_TEST_URL)
  const [timeoutMsInput, setTimeoutMsInput] = useState<string>(
    String(DEFAULT_TIMEOUT_MS),
  )
  const [fallbackIntervalInput, setFallbackIntervalInput] = useState<string>(
    String(DEFAULT_FALLBACK_INTERVAL),
  )
  const [networkCheckIntervalInput, setNetworkCheckIntervalInput] =
    useState<string>(String(DEFAULT_NETWORK_CHECK_INTERVAL))
  const [fallbackLazy, setFallbackLazy] = useState<boolean>(
    DEFAULT_FALLBACK_LAZY,
  )
  const [appDataDir, setAppDataDir] = useState<string>('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  // 区块锚点定位（如从侧边栏快捷图标跳转）
  useEffect(() => {
    if (targetSettingSection) {
      requestAnimationFrame(() => {
        scrollToSettingCard(targetSettingSection, true)
        clearTargetSettingSection()
      })
    }
  }, [targetSettingSection, clearTargetSettingSection])

  // Kernel Update State
  const [checkingUpdate, setCheckingUpdate] = useState<boolean>(false)
  const [upgradingKernel, setUpgradingKernel] = useState<boolean>(false)
  const updateInfo = useAppStore((state) => state.kernelUpdateInfo)
  const setUpdateInfo = useAppStore((state) => state.setKernelUpdateInfo)

  // System Proxy State
  const [newBypassInput, setNewBypassInput] = useState<string>('')
  const [defaultBypassList, setDefaultBypassList] = useState<string[]>([])
  const [uwpStats, setUwpStats] = useState<UwpLoopbackStats | null>(null)
  const [uwpLoading, setUwpLoading] = useState<boolean>(false)
  const [showUwpModal, setShowUwpModal] = useState<boolean>(false)
  // Software Update State
  const [checkingAppUpdate, setCheckingAppUpdate] = useState<boolean>(false)
  const [downloadingAppUpdate, setDownloadingAppUpdate] =
    useState<boolean>(false)

  const [lastCheckTime, setLastCheckTime] = useState<number | null>(() => {
    const cached = loadCachedAppUpdate()
    return cached?.checkedAt ?? null
  })
  const [appUpdateProgress, setAppUpdateProgress] =
    useState<AppUpdateProgressPayload | null>(null)
  const [selectedAssetUrl, setSelectedAssetUrl] = useState<string>(() => {
    const cached = loadCachedAppUpdate()
    if (cached?.info?.asset) {
      return cached.info.asset.downloadUrl
    }
    if (cached?.info?.availableAssets?.[0]) {
      return cached.info.availableAssets[0].downloadUrl
    }
    return ''
  })
  useEffect(() => {
    if (appUpdateInfo?.asset) {
      setSelectedAssetUrl(appUpdateInfo.asset.downloadUrl)
    } else if (appUpdateInfo?.availableAssets?.[0]) {
      setSelectedAssetUrl(appUpdateInfo.availableAssets[0].downloadUrl)
    }
    const cached = loadCachedAppUpdate()
    if (cached) setLastCheckTime(cached.checkedAt)
  }, [appUpdateInfo])
  const currentAppVersion = (
    appStatus?.version ||
    appUpdateInfo?.currentVersion ||
    APP_VERSION
  ).replace(/^v/i, '')

  const isInstalled =
    appStatus?.isInstalled ?? appUpdateInfo?.isInstalled ?? false

  const effectiveHasUpdate = useMemo(() => {
    if (!appUpdateInfo) return false
    return (
      appUpdateInfo.hasUpdate &&
      isVersionNewer(currentAppVersion, appUpdateInfo.latestVersion)
    )
  }, [appUpdateInfo, currentAppVersion])
  // MRS Rule Providers State
  const [rulesInfo, setRulesInfo] = useState<MrsRulesInfo | null>(null)
  const [updatingRules, setUpdatingRules] = useState<boolean>(false)
  useEffect(() => {
    const scope = createEventScope()
    scope
      .listen<AppUpdateProgressPayload>('app-update-progress', (event) => {
        setAppUpdateProgress(event.payload)
      })
      .catch(() => {})

    return () => {
      scope.dispose()
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

  useEffect(() => {
    void fetchTunStatus()
  }, [fetchTunStatus])

  const enabledPorts = portMappings
    .filter((m) => m.enabled)
    .sort((a, b) => a.port - b.port)

  const proxyEnabledPorts = useMemo(() => {
    return enabledPorts.filter(
      (m) => m.id !== FIXED_DIRECT_PORT_ID && m.nodeName !== 'DIRECT',
    )
  }, [enabledPorts])

  const defaultProxyPort = useMemo(() => {
    return proxyEnabledPorts[0]?.port
  }, [proxyEnabledPorts])

  const sortedCustomBypass = useMemo(
    () => sortBypassItems(config?.systemProxyBypassUser || []),
    [config?.systemProxyBypassUser],
  )
  const sortedDefaultBypass = useMemo(
    () => sortBypassItems(defaultBypassList),
    [defaultBypassList],
  )
  const handleToggleSystemProxy = async (checked: boolean) => {
    if (checked) {
      const targetPort =
        config?.systemProxyPort &&
        enabledPorts.some((m) => m.port === config.systemProxyPort)
          ? config.systemProxyPort
          : defaultProxyPort

      if (!targetPort) {
        toast.error(t('settingsPage.toast.noPort'))
        return
      }

      try {
        await setSystemProxy(true, targetPort)
        toast.success(
          t('settingsPage.toast.sysProxyEnabled', { port: targetPort }),
        )
      } catch (err) {
        toast.error(
          t('settingsPage.toast.sysProxyEnableFail', {
            error: err instanceof Error ? err.message : String(err),
          }),
        )
      }
    } else {
      try {
        await setSystemProxy(false)
        toast.success(t('settingsPage.toast.sysProxyDisabled'))
      } catch (err) {
        toast.error(
          t('settingsPage.toast.sysProxyDisableFail', {
            error: err instanceof Error ? err.message : String(err),
          }),
        )
      }
    }
  }

  const handleToggleEnvProxy = async (checked: boolean) => {
    if (checked) {
      const targetPort =
        config?.envProxyPort &&
        enabledPorts.some((m) => m.port === config.envProxyPort)
          ? config.envProxyPort
          : defaultProxyPort

      if (!targetPort) {
        toast.error(t('settingsPage.toast.noPort'))
        return
      }

      try {
        await setEnvProxy(true, targetPort)
        toast.success(
          t('settingsPage.toast.envProxyEnabled', { port: targetPort }),
        )
      } catch (err) {
        toast.error(
          t('settingsPage.toast.envProxyEnableFail', {
            error: err instanceof Error ? err.message : String(err),
          }),
        )
      }
    } else {
      try {
        await setEnvProxy(false)
        toast.success(t('settingsPage.toast.envProxyDisabled'))
      } catch (err) {
        toast.error(
          t('settingsPage.toast.envProxyDisableFail', {
            error: err instanceof Error ? err.message : String(err),
          }),
        )
      }
    }
  }

  const handleEnvPortSelectChange = async (portStr: string) => {
    const port = Number(portStr)
    if (!port) return
    if (!config) return
    try {
      if (config.envProxyEnabled) {
        await setEnvProxy(true, port)
        toast.success(t('settingsPage.toast.envPortSwitched', { port }))
      } else {
        await saveConfig({
          ...config,
          envProxyPort: port,
        })
        toast.success(t('settingsPage.toast.envPortPreset', { port }))
      }
    } catch (err) {
      toast.error(
        t('settingsPage.toast.envPortFail', {
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    }
  }

  const handlePortSelectChange = async (portStr: string) => {
    const port = Number(portStr)
    if (!port) return
    if (!config) return
    try {
      if (config.systemProxyEnabled) {
        await setSystemProxy(true, port)
        toast.success(t('settingsPage.toast.sysProxyPortSwitched', { port }))
      } else if (config.tunEnabled) {
        await setTun(true, port)
        toast.success(t('settingsPage.toast.tunPortSwitched', { port }))
      } else {
        await saveConfig({
          ...config,
          systemProxyPort: port,
          tunPort: port,
        })
        toast.success(t('settingsPage.toast.outboundPortPreset', { port }))
      }
    } catch (err) {
      toast.error(
        t('settingsPage.toast.outboundPortFail', {
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    }
  }

  const handleToggleTun = async (checked: boolean) => {
    const targetPort =
      config?.systemProxyPort &&
      enabledPorts.some((m) => m.port === config.systemProxyPort)
        ? config.systemProxyPort
        : config?.tunPort && enabledPorts.some((m) => m.port === config.tunPort)
          ? config.tunPort
          : defaultProxyPort

    if (checked) {
      if (!targetPort) {
        toast.error(t('settingsPage.toast.noPort'))
        return
      }
      setTunLoading(true)
      try {
        const status = await setTun(true, targetPort)
        if (status.pendingElevation) {
          toast.info(t('settingsPage.toast.tunAdminRestart'))
        } else {
          toast.success(
            t('settingsPage.toast.tunEnabled', { port: targetPort }),
          )
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      } finally {
        setTunLoading(false)
      }
    } else {
      setTunLoading(true)
      try {
        const currentPort = targetPort ?? defaultProxyPort
        await setTun(false, currentPort)
        toast.success(t('settingsPage.toast.tunDisabled'))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      } finally {
        setTunLoading(false)
      }
    }
  }
  const handleRestartAsAdmin = async () => {
    try {
      await restartAsAdmin()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleAddBypass = async () => {
    const trimmed = newBypassInput.trim()
    if (!trimmed) return
    if (!config) return

    if (trimmed.toLowerCase() === '<local>') {
      toast.warning(t('settingsPage.toast.localMarker'))
      return
    }

    if (!isValidBypassRule(trimmed)) {
      toast.error(t('settingsPage.toast.bypassInvalid'))
      return
    }

    const lower = trimmed.toLowerCase()
    const currentList = config.systemProxyBypassUser || []
    if (currentList.some((d) => d.toLowerCase() === lower)) {
      toast.warning(
        t('settingsPage.toast.bypassDuplicateCustom', { item: trimmed }),
      )
      return
    }

    if (defaultBypassList.some((d) => d.toLowerCase() === lower)) {
      toast.warning(
        t('settingsPage.toast.bypassDuplicateDefault', { item: trimmed }),
      )
      return
    }

    const updated = sortBypassItems([...currentList, trimmed])
    try {
      await saveConfig({ ...config, systemProxyBypassUser: updated })
      setNewBypassInput('')
      toast.success(t('settingsPage.toast.bypassAdded', { item: trimmed }))
    } catch (err) {
      toast.error(
        t('settingsPage.toast.bypassAddFail', {
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    }
  }

  const handleRemoveBypass = async (item: string) => {
    if (!config) return
    const currentList = config.systemProxyBypassUser || []
    const updated = currentList.filter((d) => d !== item)
    try {
      await saveConfig({ ...config, systemProxyBypassUser: updated })
      toast.success(t('settingsPage.toast.bypassRemoved', { item }))
    } catch (err) {
      toast.error(
        t('settingsPage.toast.bypassRemoveFail', {
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    }
  }

  const handleRefreshUwp = async () => {
    setUwpLoading(true)
    const startTime = Date.now()
    try {
      const stats = await api.refreshUwpLoopbackStatus()
      setUwpStats(stats)
      const elapsed = Date.now() - startTime
      if (elapsed < 350) {
        const { promise, resolve } = Promise.withResolvers<void>()
        setTimeout(resolve, 350 - elapsed)
        await promise
      }
      const parts: string[] = []
      if (stats.newlyExemptedCount && stats.newlyExemptedCount > 0) {
        parts.push(
          t('settingsPage.toast.uwpNewExempted', {
            count: stats.newlyExemptedCount,
          }),
        )
      }
      if (stats.cleanedCount && stats.cleanedCount > 0) {
        parts.push(
          t('settingsPage.toast.uwpCleaned', { count: stats.cleanedCount }),
        )
      }
      if (parts.length > 0) {
        toast.success(
          t('settingsPage.toast.uwpRefreshedDetails', {
            details: parts.join(t('settingsPage.common.listSeparator')),
          }),
        )
      } else {
        toast.success(t('settingsPage.toast.uwpRefreshed'))
      }
    } catch (err) {
      toast.error(
        t('settingsPage.toast.uwpRefreshFail', {
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    } finally {
      setUwpLoading(false)
    }
  }

  const handleExemptAllUwp = async () => {
    setUwpLoading(true)
    try {
      const stats = await api.exemptAllUwpLoopback()
      setUwpStats(stats)
      await fetchConfig()
      toast.success(
        t('settingsPage.toast.uwpExemptAll', { count: stats.totalCount }),
      )
    } catch (err) {
      toast.error(
        t('settingsPage.toast.uwpExemptFail', {
          error: err instanceof Error ? err.message : String(err),
        }),
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
      await fetchConfig()
      toast.success(t('settingsPage.toast.uwpCleared'))
    } catch (err) {
      toast.error(
        t('settingsPage.toast.uwpClearFail', {
          error: err instanceof Error ? err.message : String(err),
        }),
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
        toast.info(
          t('settingsPage.toast.kernelUpdateFound', {
            version: res.latestVersion,
          }),
        )
      } else {
        toast.success(
          t('settingsPage.toast.kernelLatest', { version: res.currentVersion }),
        )
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
      toast.info(t('settingsPage.toast.kernelDownloading'))
      const res = await api.upgradeKernel()
      toast.success(
        t('settingsPage.toast.kernelUpgraded', { version: res.currentVersion }),
      )
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
      toast.info(t('settingsPage.toast.rulesDownloading'))
      const res = await api.updateRules()
      setRulesInfo(res)
      toast.success(t('settingsPage.toast.rulesUpdated'))
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
      const now = Date.now()
      setAppUpdateInfo(res)
      setLastCheckTime(now)
      saveCachedAppUpdate(res, now)
      if (res.asset) {
        setSelectedAssetUrl(res.asset.downloadUrl)
      } else if (res.availableAssets.length > 0) {
        setSelectedAssetUrl(res.availableAssets[0].downloadUrl)
      }
      if (res.hasUpdate) {
        toast.info(
          t('settingsPage.toast.appUpdateFound', {
            version: res.latestVersion,
          }),
        )
      } else {
        toast.success(
          t('settingsPage.toast.appLatest', { version: res.currentVersion }),
        )
      }
    } catch (err) {
      toast.error(
        t('settingsPage.toast.appCheckFail', {
          error: err instanceof Error ? err.message : String(err),
        }),
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
      toast.error(t('settingsPage.toast.assetNotFound'))
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
        toast.success(res.message || t('settingsPage.toast.installerStarted'))
      } else {
        toast.success(res.message || t('settingsPage.toast.portableReady'))
      }
    } catch (err) {
      toast.error(
        t('settingsPage.toast.appUpdateFail', {
          error: err instanceof Error ? err.message : String(err),
        }),
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

  const prevSyncedConfigRef = useRef<typeof config>(null)

  useEffect(() => {
    if (!config) return
    const prev = prevSyncedConfigRef.current
    prevSyncedConfigRef.current = config

    if (!prev || prev.controllerPort !== config.controllerPort) {
      setControllerPortInput(String(config.controllerPort))
    }
    if (!prev || prev.logLevel !== config.logLevel) {
      setLogLevel(config.logLevel)
    }
    if (!prev || prev.allowLan !== config.allowLan) {
      setAllowLan(config.allowLan ?? false)
    }
    if (!prev || prev.theme !== config.theme) {
      setTheme(config.theme ?? 'system')
    }
    if (!prev || prev.acrylicEffect !== config.acrylicEffect) {
      setAcrylicEffect(config.acrylicEffect ?? false)
    }
    if (!prev || prev.acrylicBlur !== config.acrylicBlur) {
      setAcrylicBlur(config.acrylicBlur ?? DEFAULT_ACRYLIC_BLUR)
    }
    if (!prev || prev.acrylicOpacity !== config.acrylicOpacity) {
      setAcrylicOpacity(config.acrylicOpacity ?? DEFAULT_ACRYLIC_OPACITY)
    }
    if (!prev || prev.backgroundImage !== config.backgroundImage) {
      setBgImage(config.backgroundImage ?? '')
    }
    if (!prev || prev.backgroundOpacity !== config.backgroundOpacity) {
      setBgOpacity(config.backgroundOpacity ?? DEFAULT_BACKGROUND_OPACITY)
    }
    if (!prev || prev.closeToTray !== config.closeToTray) {
      setCloseToTray(config.closeToTray ?? true)
    }
    if (!prev || prev.autoLaunch !== config.autoLaunch) {
      setAutoLaunch(config.autoLaunch ?? false)
    }
    if (!prev || prev.silentStart !== config.silentStart) {
      setSilentStart(config.silentStart ?? false)
    }
    if (!prev || prev.lightweightMode !== config.lightweightMode) {
      setLightweightMode(config.lightweightMode ?? false)
    }
    if (!prev || prev.checkUpdateOnStart !== config.checkUpdateOnStart) {
      setCheckUpdateOnStart(config.checkUpdateOnStart ?? true)
    }
    if (!prev || prev.testUrl !== config.testUrl) {
      setTestUrl(config.testUrl ?? DEFAULT_TEST_URL)
    }
    if (!prev || prev.timeoutMs !== config.timeoutMs) {
      setTimeoutMsInput(String(config.timeoutMs ?? DEFAULT_TIMEOUT_MS))
    }
    if (!prev || prev.fallbackInterval !== config.fallbackInterval) {
      setFallbackIntervalInput(
        String(config.fallbackInterval ?? DEFAULT_FALLBACK_INTERVAL),
      )
    }
    if (
      !prev ||
      prev.networkCheckIntervalSecs !== config.networkCheckIntervalSecs
    ) {
      setNetworkCheckIntervalInput(
        String(
          config.networkCheckIntervalSecs ?? DEFAULT_NETWORK_CHECK_INTERVAL,
        ),
      )
    }
    if (!prev || prev.fallbackLazy !== config.fallbackLazy) {
      setFallbackLazy(config.fallbackLazy ?? DEFAULT_FALLBACK_LAZY)
    }
  }, [config])

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
      t(
        checked
          ? 'settingsPage.toast.lanEnabled'
          : 'settingsPage.toast.lanDisabled',
      ),
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
      toast.success(t('settingsPage.toast.testUrlUpdated'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleTimeoutBlur = async () => {
    const trimmed = timeoutMsInput.trim()
    const isPureInteger = /^\d+$/.test(trimmed)
    const ms = isPureInteger ? Number.parseInt(trimmed, 10) : 0
    if (!isPureInteger || !ms || ms < MIN_TIMEOUT_MS || ms > MAX_TIMEOUT_MS) {
      toast.error(
        t('settingsPage.toast.timeoutRange', {
          min: MIN_TIMEOUT_MS,
          max: MAX_TIMEOUT_MS,
        }),
      )
      setTimeoutMsInput(String(config?.timeoutMs ?? DEFAULT_TIMEOUT_MS))
      return
    }
    if (config && config.timeoutMs !== ms) {
      try {
        await saveConfig({ ...config, timeoutMs: ms })
        toast.success(t('settingsPage.toast.timeoutUpdated', { ms }))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      }
    }
  }

  const handleFallbackIntervalBlur = async () => {
    const trimmed = fallbackIntervalInput.trim()
    const isPureInteger = /^\d+$/.test(trimmed)
    const sec = isPureInteger ? Number.parseInt(trimmed, 10) : 0
    if (
      !isPureInteger ||
      !sec ||
      sec < MIN_FALLBACK_INTERVAL ||
      sec > MAX_FALLBACK_INTERVAL
    ) {
      toast.error(
        t('settingsPage.toast.fallbackRange', {
          min: MIN_FALLBACK_INTERVAL,
          max: MAX_FALLBACK_INTERVAL,
        }),
      )
      setFallbackIntervalInput(
        String(config?.fallbackInterval ?? DEFAULT_FALLBACK_INTERVAL),
      )
      return
    }
    if (config && config.fallbackInterval !== sec) {
      try {
        await saveConfig({ ...config, fallbackInterval: sec })
        toast.success(t('settingsPage.toast.fallbackUpdated', { sec }))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      }
    }
  }

  const handleNetworkCheckIntervalBlur = async () => {
    const trimmed = networkCheckIntervalInput.trim()
    const isPureInteger = /^\d+$/.test(trimmed)
    const sec = isPureInteger ? Number.parseInt(trimmed, 10) : 0
    if (
      !isPureInteger ||
      !sec ||
      sec < MIN_NETWORK_CHECK_INTERVAL ||
      sec > MAX_NETWORK_CHECK_INTERVAL
    ) {
      toast.error(
        t('settingsPage.toast.networkCheckRange', {
          min: MIN_NETWORK_CHECK_INTERVAL,
          max: MAX_NETWORK_CHECK_INTERVAL,
        }),
      )
      setNetworkCheckIntervalInput(
        String(
          config?.networkCheckIntervalSecs ?? DEFAULT_NETWORK_CHECK_INTERVAL,
        ),
      )
      return
    }
    if (config && config.networkCheckIntervalSecs !== sec) {
      try {
        await saveConfig({ ...config, networkCheckIntervalSecs: sec })
        toast.success(t('settingsPage.toast.networkCheckUpdated', { sec }))
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
      toast.success(
        t(checked ? 'settingsPage.toast.lazyOn' : 'settingsPage.toast.lazyOff'),
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      toast.error(t('settingsPage.toast.invalidImage'))
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
        toast.success(t('settingsPage.toast.bgApplied'))
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
    toast.info(t('settingsPage.toast.bgCleared'))
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
    toast.success(
      t(
        checked
          ? 'settingsPage.toast.autoLaunchOn'
          : 'settingsPage.toast.autoLaunchOff',
      ),
    )
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
    toast.success(
      t(
        checked
          ? 'settingsPage.toast.lightweightOn'
          : 'settingsPage.toast.lightweightOff',
      ),
    )
  }
  const handleCheckUpdateOnStartToggle = async (checked: boolean) => {
    setCheckUpdateOnStart(checked)
    if (!config) return
    await saveConfig({
      ...config,
      checkUpdateOnStart: checked,
    })
    toast.success(
      t(
        checked
          ? 'settingsPage.toast.autoCheckOn'
          : 'settingsPage.toast.autoCheckOff',
      ),
    )
  }

  const handleResetWindowSize = async () => {
    try {
      await api.resetWindowSize()
      toast.success(t('settingsPage.toast.windowReset'))
    } catch (err) {
      toast.error(
        t('settingsPage.toast.windowResetFail', {
          error: err instanceof Error ? err.message : String(err),
        }),
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
      setPortError(t('settingsPage.core.portRangeError'))
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
    <div
      id="setting-scroll-container"
      className="h-full overflow-y-auto p-6 space-y-6 w-full"
    >
      {/* 1. Unified Mihomo Core & Controller Card */}
      <div
        id="setting-section-core"
        className="scroll-mt-6 bg-card border border-border rounded-xl p-5 space-y-5 shadow-sm"
      >
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2.5">
            <Cpu className="w-5 h-5 text-primary" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {t('settingsPage.core.title')}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t('settingsPage.core.desc')}
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
                {t('settingsPage.core.stop')}
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
                {t('settingsPage.core.start')}
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              disabled={coreLoading}
              onClick={() => restartCore()}
              icon={
                <RefreshCw
                  className={`w-3.5 h-3.5 ${coreLoading ? 'animate-spin' : ''}`}
                />
              }
            >
              {t('settingsPage.core.restart')}
            </Button>
          </div>
        </div>

        {/* Core Status Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="p-3 rounded-lg bg-background/50 border border-border space-y-1">
            <span className="text-muted-foreground">
              {t('settingsPage.core.statusLabel')}
            </span>
            <div className="flex items-center gap-2 font-medium">
              <span
                className={`w-2 h-2 rounded-full ${
                  isRunning ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
                }`}
              />
              <span
                className={isRunning ? 'text-emerald-500' : 'text-rose-500'}
              >
                {isRunning
                  ? t('settingsPage.core.runningActive')
                  : t('settingsPage.core.stopped')}
              </span>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-background/50 border border-border space-y-1">
            <span className="text-muted-foreground">
              {t('settingsPage.core.pid')}
            </span>
            <div className="font-mono font-medium text-foreground">
              {coreStatus?.pid ?? t('settingsPage.core.none')}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-background/50 border border-border space-y-1">
            <span className="text-muted-foreground">
              {t('settingsPage.core.restApi')}
            </span>
            <div className="font-mono font-medium text-foreground">
              127.0.0.1:{coreStatus?.controllerPort ?? DEFAULT_CONTROLLER_PORT}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-background/50 border border-border space-y-1">
            <span className="text-muted-foreground">
              {t('settingsPage.core.uptime')}
            </span>
            <LiveUptimeDisplay
              isRunning={isRunning}
              uptimeSeconds={coreStatus?.uptimeSeconds}
            />
          </div>
        </div>

        {/* Core Version, Path & Online Update Section */}
        <div className="p-4 rounded-xl bg-background/60 border border-border space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-foreground">
                  {t('settingsPage.core.versionLabel')}
                </span>
                {updateInfo && (
                  <Badge
                    variant={
                      updateInfo.installMode === 'portable'
                        ? 'success'
                        : 'secondary'
                    }
                    size="sm"
                  >
                    {updateInfo.installMode === 'portable'
                      ? t('settingsPage.core.installModePortable')
                      : updateInfo.installMode === 'dev'
                        ? t('settingsPage.core.installModeDev')
                        : t('settingsPage.core.installModeInstall')}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                <Terminal className="w-3.5 h-3.5 shrink-0 text-primary" />
                <span className="truncate">
                  {coreStatus?.version || t('settingsPage.core.unknownVersion')}
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
                variant="outline"
                size="sm"
                disabled={checkingUpdate || upgradingKernel}
                onClick={handleCheckKernelUpdate}
                icon={
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${checkingUpdate ? 'animate-spin' : ''}`}
                  />
                }
              >
                {checkingUpdate
                  ? t('settingsPage.core.checkingUpdate')
                  : t('settingsPage.core.checkUpdate')}
              </Button>
            </div>
          </div>

          {/* Update Available Banner */}
          {updateInfo && updateInfo.hasUpdate && (
            <div className="p-3 rounded-lg bg-primary/10 border border-primary/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs animate-in fade-in">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 font-medium text-primary">
                  <Sparkles className="w-4 h-4 shrink-0" />
                  <span>
                    {t('settingsPage.core.updateFound', {
                      version: updateInfo.latestVersion,
                    })}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {t('settingsPage.core.updateDesc')}
                </p>
                {updateInfo.targetPath && (
                  <p className="text-[10px] text-muted-foreground/70 font-mono truncate max-w-md">
                    {t('settingsPage.core.targetPath', {
                      path: updateInfo.targetPath,
                    })}
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
                    {t('settingsPage.core.releaseNotes')}
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
                  {upgradingKernel
                    ? t('settingsPage.core.updating')
                    : t('settingsPage.core.updateNow')}
                </Button>
              </div>
            </div>
          )}

          {/* MRS Rule Providers Info & Update */}
          <div className="p-3 rounded-lg bg-background/60 border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-foreground">
                  {t('settingsPage.core.mrsTitle')}
                </span>
                {rulesInfo?.all_present ? (
                  <Badge variant="success" size="sm">
                    {t('settingsPage.core.mrsReady')}
                  </Badge>
                ) : (
                  <Badge variant="warning" size="sm">
                    {t('settingsPage.core.mrsMissing', {
                      count: rulesInfo?.missing.length ?? 0,
                    })}
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {t('settingsPage.core.mrsDesc')}
              </p>
              <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground/80 font-mono">
                <span>
                  {t('settingsPage.core.mrsLastUpdated', {
                    time: rulesInfo?.last_updated_at
                      ? new Date(
                          rulesInfo.last_updated_at * 1000,
                        ).toLocaleString(locale)
                      : t('settingsPage.core.mrsBundled'),
                  })}
                </span>
                {rulesInfo?.total_size ? (
                  <span>
                    {t('settingsPage.core.mrsSize', {
                      size: (rulesInfo.total_size / 1024).toFixed(1),
                    })}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="shrink-0">
              <Button
                size="sm"
                variant="outline"
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
                {updatingRules
                  ? t('settingsPage.core.updatingRules')
                  : t('settingsPage.core.updateRules')}
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
                {t('settingsPage.core.portLabel')}
              </label>
              <p className="text-[11px] text-muted-foreground">
                {t('settingsPage.core.portDesc', {
                  port: DEFAULT_CONTROLLER_PORT,
                })}
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
                  {t('settingsPage.core.portNeedsRestart', {
                    port: config?.controllerPort ?? '',
                  })}
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
                {t('settingsPage.core.logLevelLabel')}
              </label>
              <p className="text-[11px] text-muted-foreground">
                {t('settingsPage.core.logLevelDesc')}
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
                {t('settingsPage.core.allowLanLabel')}
              </span>
              <p className="text-[11px] text-muted-foreground">
                {t('settingsPage.core.allowLanDesc')}
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
                {t('settingsPage.core.probeTitle')}
              </h4>
            </div>

            {/* Probe Target URL Select */}
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <label
                  htmlFor="probe-url-select"
                  className="text-xs font-medium text-foreground"
                >
                  {t('settingsPage.core.testUrlLabel')}
                </label>
                <p className="text-[11px] text-muted-foreground">
                  {t('settingsPage.core.testUrlDesc')}
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
                  {t('settingsPage.core.timeoutLabel')}
                </label>
                <p className="text-[11px] text-muted-foreground">
                  {t('settingsPage.core.timeoutDesc')}
                </p>
              </div>
              <div className="w-28 shrink-0">
                <Input
                  id="probe-timeout-input"
                  type="number"
                  integerOnly
                  step={1}
                  min={MIN_TIMEOUT_MS}
                  max={MAX_TIMEOUT_MS}
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
                  {t('settingsPage.core.fallbackIntervalLabel')}
                </label>
                <p className="text-[11px] text-muted-foreground">
                  {t('settingsPage.core.fallbackIntervalDesc')}
                </p>
              </div>
              <div className="w-28 shrink-0">
                <Input
                  id="fallback-interval-input"
                  type="number"
                  integerOnly
                  step={1}
                  min={MIN_FALLBACK_INTERVAL}
                  max={MAX_FALLBACK_INTERVAL}
                  value={fallbackIntervalInput}
                  onChange={(e) => setFallbackIntervalInput(e.target.value)}
                  onBlur={handleFallbackIntervalBlur}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  suffixIcon={
                    <span className="text-[10px] text-muted-foreground pr-1">
                      {t('settingsPage.core.secondsShort')}
                    </span>
                  }
                  className="text-center font-mono"
                />
              </div>
            </div>

            {/* System Network Connectivity Check Interval */}
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <label
                  htmlFor="network-check-interval-input"
                  className="text-xs font-medium text-foreground"
                >
                  {t('settingsPage.core.networkCheckIntervalLabel')}
                </label>
                <p className="text-[11px] text-muted-foreground">
                  {t('settingsPage.core.networkCheckIntervalDesc')}
                </p>
              </div>
              <div className="w-28 shrink-0">
                <Input
                  id="network-check-interval-input"
                  type="number"
                  integerOnly
                  step={1}
                  min={MIN_NETWORK_CHECK_INTERVAL}
                  max={MAX_NETWORK_CHECK_INTERVAL}
                  value={networkCheckIntervalInput}
                  onChange={(e) => setNetworkCheckIntervalInput(e.target.value)}
                  onBlur={handleNetworkCheckIntervalBlur}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  suffixIcon={
                    <span className="text-[10px] text-muted-foreground pr-1">
                      {t('settingsPage.core.secondsShort')}
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
                  {t('settingsPage.core.lazyLabel')}
                </span>
                <p className="text-[11px] text-muted-foreground">
                  {t('settingsPage.core.lazyDesc')}
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
      <div
        id="setting-section-proxy"
        className="scroll-mt-6 bg-card border border-border rounded-xl p-5 space-y-5 shadow-sm"
      >
        <div className="pb-3 border-b border-border">
          <div className="flex items-center gap-2.5">
            <Globe className="w-5 h-5 text-primary" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {t('settingsPage.proxy.title')}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t('settingsPage.proxy.desc')}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {/* Main Switch */}
          <div className="flex items-center justify-between gap-6">
            <div className="space-y-0.5 min-w-0 flex-1">
              <label className="text-xs font-medium text-foreground">
                {t('settingsPage.proxy.enableLabel')}
              </label>
              <p className="text-[11px] text-muted-foreground">
                {t('settingsPage.proxy.enableDesc')}
              </p>
            </div>
            <Switch
              checked={config?.systemProxyEnabled ?? false}
              onChange={handleToggleSystemProxy}
              size="md"
            />
          </div>

          {/* Port Select (Always Visible) */}
          <div className="pt-3 border-t border-border/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="space-y-0.5">
              <label className="text-xs font-medium text-foreground">
                {t('settingsPage.proxy.portLabel')}
              </label>
              <p className="text-[11px] text-muted-foreground">
                {t('settingsPage.proxy.portDesc')}
              </p>
            </div>
            <div className="w-full sm:w-80">
              {proxyEnabledPorts.length === 0 ? (
                <span className="text-xs text-rose-500 font-medium">
                  {t('settingsPage.proxy.noPort')}
                </span>
              ) : (
                <Select
                  value={String(
                    config?.systemProxyPort ?? defaultProxyPort ?? '',
                  )}
                  onChange={(val) => handlePortSelectChange(String(val))}
                  options={proxyEnabledPorts.map((m) => ({
                    value: String(m.port),
                    label: `${t('settingsPage.proxy.portOption', {
                      port: m.port,
                      protocol: m.protocol.toUpperCase(),
                      node: m.nodeName,
                    })}${m.description ? ` · ${m.description}` : ''}`,
                  }))}
                />
              )}
            </div>
          </div>

          {/* Bypass Domains Section */}
          <div className="pt-3 border-t border-border/70 space-y-3">
            <div>
              <label className="text-xs font-medium text-foreground">
                {t('settingsPage.proxy.bypassLabel')}
              </label>
              <p className="text-[11px] text-muted-foreground">
                {t('settingsPage.proxy.bypassDesc')}
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
                placeholder={t('settingsPage.proxy.bypassPlaceholder')}
              />
              <Button
                variant="outline"
                size="md"
                onClick={handleAddBypass}
                icon={<Plus className="w-3.5 h-3.5" />}
              >
                {t('settingsPage.proxy.add')}
              </Button>
            </div>

            {/* Custom Bypass Tags */}
            {config?.systemProxyBypassUser &&
              config.systemProxyBypassUser.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {t('settingsPage.proxy.customBypassCount', {
                      count: config.systemProxyBypassUser.length,
                    })}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {sortedCustomBypass.map((domain) => (
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
                          title={t('settingsPage.proxy.removeBypass')}
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
                {t('settingsPage.proxy.defaultBypass')}
              </span>
              <div className="flex flex-wrap gap-1">
                {sortedDefaultBypass.map((item) => (
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
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-xs font-medium text-foreground">
                      {t('settingsPage.proxy.uwpLabel')}
                    </label>
                    <Badge
                      variant={
                        uwpStats.exemptedCount > 0 ? 'success' : 'secondary'
                      }
                      size="sm"
                      className="whitespace-nowrap text-[10px] py-0 px-1.5"
                    >
                      {t('settingsPage.proxy.uwpBadge', {
                        exempted: uwpStats.exemptedCount,
                        total: uwpStats.totalCount,
                      })}
                    </Badge>
                    {uwpStats.autoExempt && (
                      <Badge
                        variant="primary"
                        size="sm"
                        className="whitespace-nowrap text-[10px] py-0 px-1.5"
                        title={t('settingsPage.proxy.uwpAutoTitle')}
                      >
                        {t('settingsPage.proxy.uwpAutoBadge')}
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {t('settingsPage.proxy.uwpDesc')}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleClearAllUwp}
                    disabled={uwpLoading || uwpStats.exemptedCount === 0}
                    icon={<Trash2 className="w-3.5 h-3.5" />}
                  >
                    {t('settingsPage.proxy.uwpClear')}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleExemptAllUwp}
                    disabled={uwpLoading}
                    icon={<ShieldCheck className="w-3.5 h-3.5" />}
                  >
                    {t('settingsPage.proxy.uwpExempt')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="px-2"
                    onClick={() => setShowUwpModal(true)}
                    icon={<Eye className="w-3.5 h-3.5" />}
                    title={t('settingsPage.proxy.uwpViewTitle')}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="px-2"
                    onClick={handleRefreshUwp}
                    disabled={uwpLoading}
                    icon={
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${
                          uwpLoading ? 'animate-spin' : ''
                        }`}
                      />
                    }
                    title={t('settingsPage.proxy.uwpRefreshTitle')}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Terminal / Environment Proxy Card */}
      <div
        id="setting-section-env-proxy"
        className="scroll-mt-6 bg-card border border-border rounded-xl p-5 space-y-5 shadow-sm"
      >
        <div className="pb-3 border-b border-border">
          <div className="flex items-center gap-2.5">
            <Terminal className="w-5 h-5 text-primary" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {t('settingsPage.env.title')}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t('settingsPage.env.desc')}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {/* Main Switch */}
          <div className="flex items-center justify-between gap-6">
            <div className="space-y-0.5 min-w-0 flex-1">
              <label className="text-xs font-medium text-foreground">
                {t('settingsPage.env.enableLabel')}
              </label>
              <p className="text-[11px] text-muted-foreground">
                {t('settingsPage.env.enableDesc')}
              </p>
            </div>
            <Switch
              checked={config?.envProxyEnabled ?? false}
              onChange={handleToggleEnvProxy}
              size="md"
            />
          </div>

          {/* Port Select */}
          <div className="pt-3 border-t border-border/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="space-y-0.5">
              <label className="text-xs font-medium text-foreground">
                {t('settingsPage.env.portLabel')}
              </label>
              <p className="text-[11px] text-muted-foreground">
                {t('settingsPage.env.portDesc')}
              </p>
            </div>
            <div className="w-full sm:w-80">
              {proxyEnabledPorts.length === 0 ? (
                <span className="text-xs text-rose-500 font-medium">
                  {t('settingsPage.proxy.noPort')}
                </span>
              ) : (
                <Select
                  value={String(
                    config?.envProxyPort ??
                      config?.systemProxyPort ??
                      defaultProxyPort ??
                      '',
                  )}
                  onChange={(val) => handleEnvPortSelectChange(String(val))}
                  options={proxyEnabledPorts.map((m) => ({
                    value: String(m.port),
                    label: `${t('settingsPage.proxy.portOption', {
                      port: m.port,
                      protocol: m.protocol.toUpperCase(),
                      node: m.nodeName,
                    })}${m.description ? ` · ${m.description}` : ''}`,
                  }))}
                />
              )}
            </div>
          </div>

          {/* Clean / Emergency Reset Helper */}
          <div className="pt-3 border-t border-border/70 flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <label className="text-xs font-medium text-foreground">
                {t('settingsPage.env.resetLabel')}
              </label>
              <p className="text-[11px] text-muted-foreground">
                {t('settingsPage.env.resetDesc')}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await setEnvProxy(false)
                  toast.success(t('settingsPage.toast.envCleared'))
                } catch (e) {
                  toast.error(
                    t('settingsPage.toast.envClearFail', { error: String(e) }),
                  )
                }
              }}
              className="shrink-0 text-xs"
            >
              {t('settingsPage.env.clearButton')}
            </Button>
          </div>
        </div>
      </div>

      {/* TUN 模式卡片 */}
      <div
        id="setting-section-tun"
        className="scroll-mt-6 bg-card border border-border rounded-xl p-5 space-y-5 shadow-sm"
      >
        <div className="pb-3 border-b border-border">
          <div className="flex items-center gap-2.5">
            <Network className="w-5 h-5 text-primary" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {t('settingsPage.tun.title')}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t('settingsPage.tun.desc')}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-6">
            <div className="space-y-0.5 min-w-0 flex-1">
              <label className="text-xs font-medium text-foreground">
                {t('settingsPage.tun.enableLabel')}
              </label>
              <p className="text-[11px] text-muted-foreground">
                {t('settingsPage.tun.enableDesc')}
              </p>
            </div>
            <Switch
              checked={config?.tunEnabled ?? false}
              onChange={handleToggleTun}
              disabled={tunLoading}
              size="md"
            />
          </div>
          {tunStatus?.pendingElevation && (
            <div className="pt-3 border-t border-border/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="space-y-0.5">
                <label className="text-xs font-medium text-amber-500">
                  {t('settingsPage.tun.pendingTitle')}
                </label>
                <p className="text-[11px] text-muted-foreground">
                  {t('settingsPage.tun.pendingDesc')}
                </p>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={handleRestartAsAdmin}
                icon={<ShieldCheck className="w-3.5 h-3.5" />}
              >
                {t('settingsPage.tun.restartAdmin')}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* 2. Appearance & Personalization Card */}
      <div
        id="setting-section-appearance"
        className="scroll-mt-6 bg-card border border-border rounded-xl p-5 space-y-5 shadow-sm"
      >
        <div className="pb-3 border-b border-border">
          <div className="flex items-center gap-2.5">
            <Palette className="w-5 h-5 text-primary" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {t('settings.appearance.title')}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t('settings.appearance.desc')}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {/* Language Selector */}
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <span className="text-xs font-medium text-foreground">
                {t('settings.language.title')}
              </span>
              <p className="text-[11px] text-muted-foreground">
                {t('settings.language.desc')}
              </p>
            </div>
            <Segmented
              value={localePreference}
              onChange={(val) => setLocale(val as LocalePreference)}
              options={[
                { value: 'system', label: t('settings.language.system') },
                { value: 'zh-CN', label: t('settings.language.zhCN') },
                { value: 'en-US', label: t('settings.language.enUS') },
              ]}
              size="md"
            />
          </div>

          {/* Theme Selector */}
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <span className="text-xs font-medium text-foreground">
                {t('settings.theme.title')}
              </span>
              <p className="text-[11px] text-muted-foreground">
                {t('settings.theme.desc')}
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
                {t('settingsPage.appearance.acrylicLabel')}
              </span>
              <p className="text-[11px] text-muted-foreground">
                {t('settingsPage.appearance.acrylicDesc')}
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
                    {t('settingsPage.appearance.blurLabel')}
                  </span>
                  <p className="text-[11px] text-muted-foreground">
                    {t('settingsPage.appearance.blurDesc', {
                      value: acrylicBlur,
                    })}
                  </p>
                </div>
                <div className="w-48 flex items-center gap-3">
                  <Slider
                    min={0}
                    max={30}
                    step={1}
                    value={acrylicBlur}
                    onChange={handleAcrylicBlurChange}
                    className="flex-1"
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
                    {t('settingsPage.appearance.opacityLabel')}
                  </span>
                  <p className="text-[11px] text-muted-foreground">
                    {t('settingsPage.appearance.opacityDesc', {
                      value: acrylicOpacity,
                    })}
                  </p>
                </div>
                <div className="w-48 flex items-center gap-3">
                  <Slider
                    min={20}
                    max={100}
                    step={5}
                    value={acrylicOpacity}
                    onChange={handleAcrylicOpacityChange}
                    className="flex-1"
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
                  {t('settingsPage.appearance.bgLabel')}
                </span>
                <p className="text-[11px] text-muted-foreground">
                  {t('settingsPage.appearance.bgDesc')}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  icon={<Upload className="w-3.5 h-3.5" />}
                >
                  {bgImage
                    ? t('settingsPage.appearance.changeWallpaper')
                    : t('settingsPage.appearance.chooseImage')}
                </Button>

                {bgImage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearBgImage}
                    className="text-xs text-rose-500 hover:text-rose-600 hover:bg-rose-500/10"
                    icon={<Trash2 className="w-3.5 h-3.5" />}
                  >
                    {t('settingsPage.appearance.clearWallpaper')}
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
                    {t('settingsPage.appearance.bgOpacityLabel')}
                  </span>
                  <p className="text-[11px] text-muted-foreground">
                    {t('settingsPage.appearance.bgOpacityDesc', {
                      value: bgOpacity,
                    })}
                  </p>
                </div>
                <div className="w-48 flex items-center gap-3">
                  <Slider
                    min={10}
                    max={100}
                    step={5}
                    value={bgOpacity}
                    onChange={handleBgOpacityChange}
                    className="flex-1"
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
      <div
        id="setting-section-system"
        className="scroll-mt-6 bg-card border border-border rounded-xl p-5 space-y-5 shadow-sm"
      >
        <div className="pb-3 border-b border-border">
          <div className="flex items-center gap-2.5">
            <Power className="w-5 h-5 text-primary" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {t('settingsPage.system.title')}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t('settingsPage.system.desc')}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-6">
            <div className="space-y-0.5 min-w-0 flex-1">
              <span className="text-xs font-medium text-foreground">
                {t('settingsPage.system.closeToTrayLabel')}
              </span>
              <p className="text-[11px] text-muted-foreground">
                {t('settingsPage.system.closeToTrayDesc')}
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
                {t('settingsPage.system.autoLaunchLabel')}
              </span>
              <p className="text-[11px] text-muted-foreground">
                {t('settingsPage.system.autoLaunchDesc', { app: APP_NAME })}
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
                {t('settingsPage.system.silentStartLabel')}
              </span>
              <p className="text-[11px] text-muted-foreground">
                {t('settingsPage.system.silentStartDesc')}
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
                {t('settingsPage.system.lightweightLabel')}
              </span>
              <p className="text-[11px] text-muted-foreground">
                {t('settingsPage.system.lightweightDesc')}
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
                {t('settingsPage.system.resetSizeLabel')}
              </span>
              <p className="text-[11px] text-muted-foreground">
                {t('settingsPage.system.resetSizeDesc')}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetWindowSize}
              icon={<RotateCcw className="w-3.5 h-3.5" />}
            >
              {t('settingsPage.system.resetSizeButton')}
            </Button>
          </div>
        </div>
      </div>

      {/* 4. CLI Tool & Storage Directories Card */}
      <CliSettingsCard
        appDataDir={appDataDir}
        onOpenAppDataDir={() => openAppDataDir()}
      />
      {/* 5. Software About & Update Card */}
      <div
        id="setting-section-about"
        className="scroll-mt-6 bg-card border border-border rounded-xl p-5 space-y-4 shadow-sm"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-border gap-3">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-5 h-5 text-primary" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">
                  {t('settingsPage.about.title')}
                </h3>
                <Badge variant="primary" size="sm" className="font-mono">
                  v{currentAppVersion}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('settingsPage.about.desc', { app: APP_NAME })}
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
                {t('settingsPage.about.github')}
              </Button>
            </a>
            <Button
              variant="outline"
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
              {checkingAppUpdate
                ? t('settingsPage.core.checkingUpdate')
                : t('settingsPage.about.checkUpdate')}
            </Button>
          </div>
        </div>

        {/* Status / Overview */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="p-3 rounded-lg bg-background/50 border border-border space-y-1">
            <span className="text-muted-foreground">
              {t('settingsPage.about.currentVersion')}
            </span>
            <div className="font-mono font-medium text-foreground">
              v{currentAppVersion}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-background/50 border border-border space-y-1">
            <span className="text-muted-foreground">
              {t('settingsPage.about.deployType')}
            </span>
            <div className="font-medium text-foreground">
              {isInstalled ? (
                <Badge variant="secondary" size="sm">
                  {t('settingsPage.about.installer')}
                </Badge>
              ) : (
                <Badge variant="outline" size="sm">
                  {t('settingsPage.about.portable')}
                </Badge>
              )}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-background/50 border border-border space-y-1">
            <span className="text-muted-foreground">
              {t('settingsPage.about.latestVersion')}
            </span>
            <div className="font-mono font-medium text-foreground">
              {appUpdateInfo
                ? `v${appUpdateInfo.latestVersion}`
                : t('settingsPage.about.notChecked')}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-background/50 border border-border space-y-1">
            <span className="text-muted-foreground">
              {t('settingsPage.about.updateStatus')}
            </span>
            <div className="font-medium text-foreground">
              {appUpdateInfo ? (
                effectiveHasUpdate ? (
                  <Badge variant="warning" size="sm">
                    {t('settingsPage.about.hasUpdate')}
                  </Badge>
                ) : (
                  <Badge variant="success" size="sm">
                    {t('settingsPage.about.latest')}
                  </Badge>
                )
              ) : (
                t('settingsPage.about.pending')
              )}
            </div>
          </div>
        </div>

        {/* Automatic Update Check Switch */}
        <div className="flex items-center justify-between p-3.5 rounded-lg bg-background/50 border border-border gap-6 text-xs">
          <div className="space-y-0.5 min-w-0 flex-1">
            <span className="text-xs font-medium text-foreground">
              {t('settingsPage.about.autoCheckLabel')}
            </span>
            <p className="text-[11px] text-muted-foreground">
              {t('settingsPage.about.autoCheckDesc')}
            </p>
          </div>
          <Switch
            checked={checkUpdateOnStart}
            onChange={handleCheckUpdateOnStartToggle}
            size="md"
          />
        </div>

        {/* Last Check Timestamp & Status Meta */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-muted-foreground px-0.5">
          <div className="flex items-center gap-1.5 font-mono">
            <Clock className="w-3.5 h-3.5 text-muted-foreground/70 shrink-0" />
            <span>
              {t('settingsPage.about.lastCheckedLabel')}
              {lastCheckTime ? (
                <span className="text-foreground font-medium">
                  {formatLastCheckTime(lastCheckTime)}
                </span>
              ) : (
                <span className="text-muted-foreground">
                  {t('settingsPage.about.never')}
                </span>
              )}
            </span>
          </div>
        </div>

        {/* Update Available Banner & Downloader */}
        {appUpdateInfo && effectiveHasUpdate && (
          <div className="p-4 rounded-xl bg-primary/10 border border-primary/20 space-y-4 text-xs animate-in fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 font-medium text-primary">
                  <Sparkles className="w-4 h-4 shrink-0" />
                  <span className="text-sm font-semibold">
                    {t('settingsPage.about.newVersion', {
                      version: appUpdateInfo.latestVersion,
                    })}
                  </span>
                  {appUpdateInfo.releaseName && (
                    <span className="text-xs text-muted-foreground">
                      ({appUpdateInfo.releaseName})
                    </span>
                  )}
                </div>
                {appUpdateInfo.publishedAt && (
                  <p className="text-[11px] text-muted-foreground">
                    {t('settingsPage.about.publishedAt', {
                      time: new Date(appUpdateInfo.publishedAt).toLocaleString(
                        locale,
                      ),
                    })}
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
                    {t('settingsPage.about.releaseNotesLink')}
                  </Button>
                </a>
              )}
            </div>

            {/* Asset Selection (if multiple) */}
            {appUpdateInfo.availableAssets.length > 1 && (
              <div className="space-y-1.5 pt-1 border-t border-primary/15">
                <label className="text-xs font-medium text-foreground">
                  {t('settingsPage.about.selectAsset')}
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
                            ? t('settingsPage.about.assetInstaller')
                            : t('settingsPage.about.assetPortable')}
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
                        ? t('settingsPage.about.singleInstaller')
                        : t('settingsPage.about.singlePortable')}
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
                  {t('settingsPage.about.releaseNotes')}
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
                      ? t('settingsPage.about.stageReady')
                      : t('settingsPage.about.stageDownloading')}
                  </span>
                  <span className="font-mono text-muted-foreground">
                    {appUpdateProgress
                      ? `${(appUpdateProgress.downloadedBytes / 1024 / 1024).toFixed(1)} MB / ${(appUpdateProgress.totalBytes / 1024 / 1024).toFixed(1)} MB (${appUpdateProgress.percentage}%)`
                      : t('settingsPage.about.preparing')}
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
                  {t('settingsPage.about.downloadNow')}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
      <UwpAppListModal
        isOpen={showUwpModal}
        onClose={() => setShowUwpModal(false)}
      />
    </div>
  )
}
