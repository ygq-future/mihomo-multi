import type { SubscriptionInfo } from '../types'

export interface ComputedSubscriptionStats {
  hasTraffic: boolean
  hasExpiry: boolean
  hasAny: boolean
  usedBytes: number | null
  totalBytes: number | null
  remainingBytes: number | null
  remainingPercent: number | null
  trafficTone: 'normal' | 'warning' | 'danger'
  expireAt: number | null
  neverExpires: boolean
  daysLeft: number | null
  isExpired: boolean
  expiryTone: 'normal' | 'warning' | 'danger' | 'success'
  resetDays: number | null
}

export const SUBSCRIPTION_TONE_CLASSES = {
  trafficText: {
    normal: 'text-foreground',
    warning: 'text-amber-500',
    danger: 'text-rose-500',
  },
  progressBar: {
    normal: 'bg-primary',
    warning: 'bg-amber-500',
    danger: 'bg-rose-500',
  },
  expiryText: {
    normal: 'text-muted-foreground',
    warning: 'text-amber-500',
    danger: 'text-rose-500',
    success: 'text-emerald-500',
  },
} as const

/**
 * Formats byte count using binary IEC thresholds (1024) with Clash-style units
 * (`B`, `KB`, `MB`, `GB`, `TB`), trimming unnecessary `.00` on exact integers.
 */
export function formatTrafficBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let idx = 0

  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024
    idx++
  }

  if (idx === 0) {
    return `${Math.round(value)} B`
  }

  const fixed = value >= 100 ? value.toFixed(1) : value.toFixed(2)
  const trimmed = fixed.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1')
  return `${trimmed} ${units[idx]}`
}

export function formatExpireDate(expireAt: number, locale: string): string {
  const date = new Date(expireAt * 1000)
  return date.toLocaleDateString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

export function getSubscriptionStats(
  info?: SubscriptionInfo | null,
  nowSecs = Math.floor(Date.now() / 1000),
): ComputedSubscriptionStats {
  if (!info) {
    return {
      hasTraffic: false,
      hasExpiry: false,
      hasAny: false,
      usedBytes: null,
      totalBytes: null,
      remainingBytes: null,
      remainingPercent: null,
      trafficTone: 'normal',
      expireAt: null,
      neverExpires: false,
      daysLeft: null,
      isExpired: false,
      expiryTone: 'normal',
      resetDays: null,
    }
  }

  const hasUploadOrDownload =
    typeof info.upload === 'number' || typeof info.download === 'number'
  const usedBytes = hasUploadOrDownload
    ? Math.max(0, (info.upload ?? 0) + (info.download ?? 0))
    : null
  const totalBytes =
    typeof info.total === 'number' && info.total > 0 ? info.total : null

  let remainingBytes: number | null = null
  if (totalBytes !== null && usedBytes !== null) {
    remainingBytes = Math.max(0, totalBytes - usedBytes)
  } else if (totalBytes !== null) {
    remainingBytes = totalBytes
  } else if (typeof info.remainingBytes === 'number') {
    remainingBytes = Math.max(0, info.remainingBytes)
  }

  const remainingPercent =
    totalBytes !== null && remainingBytes !== null
      ? Math.min(100, Math.max(0, (remainingBytes / totalBytes) * 100))
      : null

  let trafficTone: 'normal' | 'warning' | 'danger' = 'normal'
  if (remainingBytes !== null && remainingBytes === 0) {
    trafficTone = 'danger'
  } else if (remainingPercent !== null) {
    if (remainingPercent <= 5) trafficTone = 'danger'
    else if (remainingPercent <= 20) trafficTone = 'warning'
  }

  const expireAt =
    typeof info.expireAt === 'number' && info.expireAt > 0
      ? info.expireAt
      : null
  const neverExpires = Boolean(info.neverExpires) && expireAt === null

  let daysLeft: number | null = null
  let isExpired = false
  let expiryTone: 'normal' | 'warning' | 'danger' | 'success' = 'normal'

  if (neverExpires) {
    expiryTone = 'success'
  } else if (expireAt !== null) {
    const diffSecs = expireAt - nowSecs
    if (diffSecs <= 0) {
      isExpired = true
      daysLeft = 0
      expiryTone = 'danger'
    } else {
      daysLeft = Math.ceil(diffSecs / 86400)
      if (daysLeft <= 7) {
        expiryTone = 'warning'
      }
    }
  }

  const resetDays =
    typeof info.resetDays === 'number' && info.resetDays >= 0
      ? info.resetDays
      : null

  const hasTraffic =
    remainingBytes !== null || totalBytes !== null || usedBytes !== null
  const hasExpiry = expireAt !== null || neverExpires
  const hasAny = hasTraffic || hasExpiry || resetDays !== null

  return {
    hasTraffic,
    hasExpiry,
    hasAny,
    usedBytes,
    totalBytes,
    remainingBytes,
    remainingPercent,
    trafficTone,
    expireAt,
    neverExpires,
    daysLeft,
    isExpired,
    expiryTone,
    resetDays,
  }
}
