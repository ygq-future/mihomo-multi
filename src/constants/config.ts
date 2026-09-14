/**
 * 默认测速 URL (Cloudflare 204)
 */
export const DEFAULT_TEST_URL = 'http://cp.cloudflare.com/generate_204'

/**
 * 默认节点/端口延迟测速超时时间 (毫秒)
 */
export const DEFAULT_TIMEOUT_MS = 3000

/**
 * 最小与最大超时时间限制 (毫秒)
 */
export const MIN_TIMEOUT_MS = 500
export const MAX_TIMEOUT_MS = 60000

/**
 * 默认 Fallback 健康检查周期 (秒)
 */
export const DEFAULT_FALLBACK_INTERVAL = 5

/**
 * 最小与最大 Fallback 健康检查周期限制 (秒)
 */
export const MIN_FALLBACK_INTERVAL = 2
export const MAX_FALLBACK_INTERVAL = 300

/**
 * 默认 Fallback 惰性检查
 */
export const DEFAULT_FALLBACK_LAZY = false

/**
 * 前端 Fallback 状态轮询周期 (毫秒)
 */
export const FALLBACK_STATUS_POLL_INTERVAL_MS = 5000

/**
 * 默认内核外部控制端口 (REST API)
 */
export const DEFAULT_CONTROLLER_PORT = 9999

/**
 * 默认日志级别
 */
export const DEFAULT_LOG_LEVEL = 'info'

/**
 * 默认亚克力毛玻璃模糊半径与不透明度
 */
export const DEFAULT_ACRYLIC_BLUR = 12
export const DEFAULT_ACRYLIC_OPACITY = 65
export const DEFAULT_BACKGROUND_OPACITY = 80

/**
 * 固定直连监听端口常量
 */
export const FIXED_DIRECT_PORT_ID = 'fixed-direct'
export const DEFAULT_DIRECT_PORT = 7878
