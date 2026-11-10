/**
 * Formats uptime seconds into a readable string, capped at days as the
 * largest unit:
 * - < 60s -> `xxs`
 * - 60s ~ 3600s -> `xxm xxs`
 * - 3600s ~ 86400s -> `xxh xxm xxs`
 * - >= 86400s -> `xxd xxh xxm xxs`
 */
export function formatUptime(seconds: number): string {
  if (!seconds || seconds <= 0) return '0s'

  const totalSecs = Math.floor(seconds)
  const d = Math.floor(totalSecs / 86400)
  const h = Math.floor((totalSecs % 86400) / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = totalSecs % 60

  if (d > 0) {
    return `${d}d ${h}h ${m}m ${s}s`
  }
  if (h > 0) {
    return `${h}h ${m}m ${s}s`
  }
  if (m > 0) {
    return `${m}m ${s}s`
  }
  return `${s}s`
}
