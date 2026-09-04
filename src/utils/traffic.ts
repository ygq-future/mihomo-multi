/**
 * 格式化流量速率
 * @param bytesPerSec 每秒字节数
 * @returns 友好展示格式，例如 "12.4 KB/s", "1.5 MB/s"
 */
export function formatTraffic(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec < 0 || Number.isNaN(bytesPerSec)) {
    return '0 B/s'
  }

  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s']
  let val = bytesPerSec
  let unitIndex = 0

  while (val >= 1024 && unitIndex < units.length - 1) {
    val /= 1024
    unitIndex++
  }

  // 小于 10 则保留一位小数，大于等于 10 则保留一位或四舍五入
  if (unitIndex === 0) {
    return `${Math.round(val)} B/s`
  }
  return `${val.toFixed(val < 10 ? 1 : 0)} ${units[unitIndex]}`
}

/**
 * 侧边栏收缩模式下的极简紧凑格式化
 * @param bytesPerSec 每秒字节数
 * @returns 极简展示格式，例如 "0B", "12K", "1.5M", "2G"
 */
export function formatCompactTraffic(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec < 0 || Number.isNaN(bytesPerSec)) {
    return '0B'
  }

  if (bytesPerSec < 1024) {
    return `${Math.round(bytesPerSec)}B`
  }
  if (bytesPerSec < 1024 * 1024) {
    const kb = bytesPerSec / 1024
    return `${kb.toFixed(kb < 10 ? 1 : 0)}K`
  }
  if (bytesPerSec < 1024 * 1024 * 1024) {
    const mb = bytesPerSec / (1024 * 1024)
    return `${mb.toFixed(mb < 10 ? 1 : 0)}M`
  }
  const gb = bytesPerSec / (1024 * 1024 * 1024)
  return `${gb.toFixed(gb < 10 ? 1 : 0)}G`
}
