import { useCallback, useEffect, useRef } from 'react'
import { toast } from '../components/common'
import { APP_VERSION } from '../constants'
import { checkAppUpdate } from '../services/tauri'
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

/**
 * Runs the startup update check and keeps checking once per day while the app
 * stays open. The backend tries every enabled listener port in order and falls
 * back to a direct connection, so no egress selection is needed here.
 */
export function useAppUpdateCheck(): void {
  const config = useAppStore((state) => state.config)
  const setAppUpdateInfo = useAppStore((state) => state.setAppUpdateInfo)
  const scrollToSettingSection = useAppStore(
    (state) => state.scrollToSettingSection,
  )
  const startupTimerRef = useRef<number | null>(null)
  const startupDoneRef = useRef(false)
  const isCheckingRef = useRef(false)

  const runCheck = useCallback(async () => {
    if (isCheckingRef.current) return
    isCheckingRef.current = true
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
    } finally {
      isCheckingRef.current = false
    }
  }, [scrollToSettingSection, setAppUpdateInfo])

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
