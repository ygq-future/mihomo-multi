import type { AppUpdateCheckResult } from '../types'

export const APP_UPDATE_CACHE_KEY = 'app_update_last_check_cache'

export interface AppUpdateCacheData {
  latestVersion: string
  hasUpdate: boolean
  checkedAt: number
  info: AppUpdateCheckResult
}

export function isVersionNewer(current: string, remote: string): boolean {
  const cParts = current
    .replace(/^v/i, '')
    .split('.')
    .map((p) => Number.parseInt(p, 10) || 0)
  const rParts = remote
    .replace(/^v/i, '')
    .split('.')
    .map((p) => Number.parseInt(p, 10) || 0)
  const maxLen = Math.max(cParts.length, rParts.length)
  for (let i = 0; i < maxLen; i++) {
    const c = cParts[i] ?? 0
    const r = rParts[i] ?? 0
    if (r > c) return true
    if (r < c) return false
  }
  return false
}

export function loadCachedAppUpdate(): AppUpdateCacheData | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(APP_UPDATE_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AppUpdateCacheData
    if (
      parsed &&
      typeof parsed.latestVersion === 'string' &&
      typeof parsed.hasUpdate === 'boolean' &&
      typeof parsed.checkedAt === 'number' &&
      parsed.info
    ) {
      return parsed
    }
  } catch {
    // ignore storage parsing error
  }
  return null
}

export function saveCachedAppUpdate(
  info: AppUpdateCheckResult,
  checkedAt: number,
): void {
  if (typeof window === 'undefined') return
  try {
    const data: AppUpdateCacheData = {
      latestVersion: info.latestVersion,
      hasUpdate: info.hasUpdate,
      checkedAt,
      info,
    }
    localStorage.setItem(APP_UPDATE_CACHE_KEY, JSON.stringify(data))
  } catch {
    // ignore storage write error
  }
}
