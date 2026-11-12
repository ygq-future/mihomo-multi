import { useCallback, useEffect, useRef } from 'react'
import { toast } from '../components/common'
import { APP_VERSION } from '../constants'
import {
  checkAppUpdate,
  checkKernelUpdate,
  updateRules,
} from '../services/tauri'
import { useAppStore } from '../stores/appStore'
import {
  isVersionNewer,
  loadCachedAppUpdate,
  saveCachedAppUpdate,
} from '../utils/appUpdateCache'

/** Delay before the startup check so the first paint and core startup settle. */
const STARTUP_CHECK_DELAY_MS = 2500
/** Automatic checks run at most once per 24 hours. */
const DAILY_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
/** How often a running app re-evaluates whether a daily check is due. */
const DAILY_CHECK_TICK_MS = 15 * 60 * 1000

/** Shares the app update schedule with kernel checks and refreshes MRS daily. */
export function useAppUpdateCheck(): void {
  const config = useAppStore((state) => state.config)
  const configLoaded = config !== null && config !== undefined
  const setAppUpdateInfo = useAppStore((state) => state.setAppUpdateInfo)
  const scrollToSettingSection = useAppStore(
    (state) => state.scrollToSettingSection,
  )
  const startupTimerRef = useRef<number | null>(null)
  const startupDoneRef = useRef(false)
  const isCheckingRef = useRef(false)

  const runAppCheck = useCallback(async () => {
    try {
      const res = await checkAppUpdate()
      const now = Date.now()
      saveCachedAppUpdate(res, now)
      setAppUpdateInfo(res)

      if (!res.hasUpdate) return
      const currentVersion = APP_VERSION.replace(/^v/i, '')
      if (!isVersionNewer(currentVersion, res.latestVersion)) return

      toast.info(
        `发现新版本 v${res.latestVersion}，前往「设置 -> 软件关于与更新」即可查看并下载更新。`,
        '发现新版本',
        8000,
        {
          label: '立即前往',
          onClick: () => {
            scrollToSettingSection('setting-section-about')
          },
        },
      )
    } catch (err) {
      console.debug('[AppUpdate] Update check failed:', err)
    }
  }, [scrollToSettingSection, setAppUpdateInfo])

  const runCheck = useCallback(async () => {
    if (isCheckingRef.current) return
    isCheckingRef.current = true
    try {
      await Promise.all([
        runAppCheck(),
        checkKernelUpdate()
          .then((res) => {
            if (!res.hasUpdate) return
            toast.info(
              `发现 Mihomo 内核新版本 ${res.latestVersion}，可前往设置更新。`,
              '发现内核新版本',
              8000,
              {
                label: '立即前往',
                onClick: () => scrollToSettingSection('setting-section-core'),
              },
            )
          })
          .catch((err: unknown) => {
            console.debug('[KernelUpdate] Update check failed:', err)
          }),
      ])
    } finally {
      isCheckingRef.current = false
    }
  }, [runAppCheck, scrollToSettingSection])

  useEffect(() => {
    if (!configLoaded) return

    let updating = false
    let lastUpdatedAt = 0
    const refreshRules = async () => {
      if (updating || Date.now() - lastUpdatedAt < DAILY_CHECK_INTERVAL_MS)
        return
      updating = true
      try {
        await updateRules()
        lastUpdatedAt = Date.now()
      } catch (err) {
        console.debug('[MrsUpdate] Rules update failed:', err)
      } finally {
        updating = false
      }
    }
    const startupTimer = window.setTimeout(() => {
      void refreshRules()
    }, STARTUP_CHECK_DELAY_MS)
    const dailyTimer = window.setInterval(() => {
      void refreshRules()
    }, DAILY_CHECK_TICK_MS)
    return () => {
      window.clearTimeout(startupTimer)
      window.clearInterval(dailyTimer)
    }
  }, [configLoaded])

  useEffect(() => {
    if (!config || startupDoneRef.current || startupTimerRef.current) return
    if (config.checkUpdateOnStart === false) return

    startupTimerRef.current = window.setTimeout(() => {
      startupTimerRef.current = null
      startupDoneRef.current = true
      void runCheck()
    }, STARTUP_CHECK_DELAY_MS)

    return () => {
      if (startupTimerRef.current) {
        window.clearTimeout(startupTimerRef.current)
        startupTimerRef.current = null
      }
    }
  }, [config, runCheck])

  useEffect(() => {
    if (!config || config.checkUpdateOnStart === false) return

    const maybeCheck = () => {
      if (isCheckingRef.current) return
      const lastCheckedAt = loadCachedAppUpdate()?.checkedAt ?? 0
      if (Date.now() - lastCheckedAt < DAILY_CHECK_INTERVAL_MS) return
      void runCheck()
    }

    const timer = setInterval(maybeCheck, DAILY_CHECK_TICK_MS)
    return () => clearInterval(timer)
  }, [config, runCheck])
}
