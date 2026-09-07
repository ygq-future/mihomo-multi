export interface IntervalOption {
  value: number
  label: string
}

export const PROFILE_INTERVAL_OPTIONS: IntervalOption[] = [
  { value: 0, label: '不自动更新（仅手动刷新）' },
  { value: 30, label: '每 30 分钟自动更新' },
  { value: 60, label: '每 1 小时自动更新' },
  { value: 180, label: '每 3 小时自动更新' },
  { value: 360, label: '每 6 小时自动更新' },
  { value: 720, label: '每 12 小时自动更新' },
  { value: 1440, label: '每 1 天自动更新' },
  { value: 4320, label: '每 3 天自动更新' },
  { value: 10080, label: '每 7 天自动更新' },
  { value: 43200, label: '每 30 天自动更新' },
]
