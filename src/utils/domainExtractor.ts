import type { ConnectionItem, SniffedAccessLogEntry } from '../types'

/**
 * 常见多级公共后缀（eTLD），用于准确提取可注册主域名（eTLD+1）
 * 同时包含常见多租户云托管后缀，避免误将 *.github.io / *.workers.dev 收敛为整个平台域名
 */
const MULTI_PART_PUBLIC_SUFFIXES: Record<string, true> = {
  'com.cn': true,
  'net.cn': true,
  'org.cn': true,
  'gov.cn': true,
  'edu.cn': true,
  'ac.cn': true,
  'com.hk': true,
  'edu.hk': true,
  'org.hk': true,
  'net.hk': true,
  'com.tw': true,
  'org.tw': true,
  'edu.tw': true,
  'net.tw': true,
  'co.jp': true,
  'ne.jp': true,
  'or.jp': true,
  'ac.jp': true,
  'go.jp': true,
  'co.uk': true,
  'org.uk': true,
  'ac.uk': true,
  'gov.uk': true,
  'me.uk': true,
  'co.kr': true,
  'or.kr': true,
  'ne.kr': true,
  'com.sg': true,
  'edu.sg': true,
  'com.my': true,
  'com.au': true,
  'net.au': true,
  'org.au': true,
  'com.br': true,
  'co.in': true,
  'net.in': true,
  'org.in': true,
  'co.nz': true,
  'co.za': true,
  'com.ru': true,
  'org.ru': true,
  'net.ru': true,
  // 多租户云托管与 CDN 分配后缀（保留三级子域以防过度匹配）
  'github.io': true,
  'gitlab.io': true,
  'pages.dev': true,
  'workers.dev': true,
  'vercel.app': true,
  'netlify.app': true,
  'web.app': true,
  'firebaseapp.com': true,
  'azureedge.net': true,
  'azurefd.net': true,
  'cloudfront.net': true,
  'akamaized.net': true,
  'fastly.net': true,
  'windows.net': true,
  'amazonaws.com': true,
}

/**
 * 操作系统与浏览器常见的后台连接性检测、遥测、证书吊销检查噪音域名后缀
 */
const SYSTEM_NOISE_SUFFIXES = [
  'msftconnecttest.com',
  'msftncsi.com',
  'windowsupdate.com',
  'update.microsoft.com',
  'events.data.microsoft.com',
  'vortex.data.microsoft.com',
  'settings-win.data.microsoft.com',
  'digicert.com',
  'sectigo.com',
  'lencr.org',
  'pki.goog',
  'ocsp.apple.com',
  'time.windows.com',
  'time.apple.com',
  'pool.ntp.org',
  'Safebrowsing.googleapis.com'.toLowerCase(),
  'content-autofill.googleapis.com',
  'optimizationguide-pa.googleapis.com',
  'componentupdater.googleapis.com',
  'clientservices.googleapis.com',
  'accounts.google.com',
]

const IPV4_REGEX = /^(?:\d{1,3}\.){3}\d{1,3}$/
const HOSTNAME_LABEL_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * 从原始 host 字符串中提取规范化的有效域名（剔除端口、通配符前缀、IP 地址、单标签主机名）
 */
export function extractValidHostname(rawHost?: string | null): string | null {
  if (!rawHost) return null
  let cleaned = rawHost.trim().toLowerCase()
  if (!cleaned) return null

  // IPv6 字面量直接排除
  if (cleaned.startsWith('[') || cleaned.includes('::')) {
    return null
  }

  // 去除协议前缀（如果误传入了 URL）
  if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
    try {
      cleaned = new URL(cleaned).hostname.toLowerCase()
    } catch {
      return null
    }
  }

  // 去除端口后缀 :443
  const colonIdx = cleaned.indexOf(':')
  if (colonIdx !== -1) {
    cleaned = cleaned.slice(0, colonIdx)
  }

  // 去除通配符前缀 *. 或 +. 以及首尾点号
  cleaned = cleaned.replace(/^(\*\.|\+\.)+/, '').replace(/^\.+|\.+$/g, '')

  if (!cleaned || !cleaned.includes('.')) {
    return null
  }

  if (IPV4_REGEX.test(cleaned)) {
    return null
  }

  const labels = cleaned.split('.')
  if (labels.length < 2) return null

  // 顶级域不能是纯数字
  const tld = labels[labels.length - 1]
  if (!tld || /^\d+$/.test(tld)) return null

  for (const label of labels) {
    if (!HOSTNAME_LABEL_REGEX.test(label)) {
      return null
    }
  }

  return cleaned
}

/**
 * 从 Mihomo 实时连接项中提取真实请求域名（优先使用 TLS/HTTP 嗅探出的 sniffHost，其次 metadata.host）
 */
export function extractConnectionHost(conn: ConnectionItem): string | null {
  return (
    extractValidHostname(conn.metadata.sniffHost) ||
    extractValidHostname(conn.metadata.host)
  )
}

/**
 * 提取可注册主域名（eTLD+1），适合生成 DOMAIN-SUFFIX 规则
 */
export function extractRootDomain(hostname: string): string {
  const valid = extractValidHostname(hostname)
  if (!valid) return hostname.trim().toLowerCase()

  const labels = valid.split('.')
  if (labels.length <= 2) {
    return valid
  }

  const lastTwo = `${labels[labels.length - 2]}.${labels[labels.length - 1]}`
  const lastThree = `${labels[labels.length - 3]}.${lastTwo}`
  // 特殊处理 *.blob.core.windows.net 等四级多租户存储域名
  if (lastThree === 'core.windows.net') {
    if (labels.length >= 5) {
      return labels.slice(-5).join('.')
    }
    return labels.slice(-4).join('.')
  }
  if (MULTI_PART_PUBLIC_SUFFIXES[lastTwo] && labels.length >= 3) {
    return `${labels[labels.length - 3]}.${lastTwo}`
  }

  return lastTwo
}

/**
 * 判断是否为操作系统或浏览器的常见后台噪音域名
 */
export function isSystemNoiseDomain(hostname: string): boolean {
  const lower = hostname.toLowerCase()
  if (
    lower.startsWith('ocsp.') ||
    lower.startsWith('crl.') ||
    lower.includes('.stun.')
  ) {
    return true
  }
  return SYSTEM_NOISE_SUFFIXES.some(
    (suffix) => lower === suffix || lower.endsWith(`.${suffix}`),
  )
}

/**
 * 规范化用户输入的探测网址，提取完整 URL 与初始主机名
 */
export function normalizeProbeUrl(
  input: string,
): { url: string; hostname: string } | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const withProtocol =
    trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : `https://${trimmed}`

  try {
    const parsed = new URL(withProtocol)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    const hostname = extractValidHostname(parsed.hostname)
    if (!hostname) return null
    const normalizedUrl =
      parsed.pathname === '/' &&
      !parsed.search &&
      !parsed.hash &&
      !withProtocol.endsWith('/')
        ? parsed.origin
        : parsed.toString()
    return {
      url: normalizedUrl,
      hostname,
    }
  } catch {
    return null
  }
}

export interface CapturedHostRecord {
  host: string
  inboundPort?: string | null
  chain: string
  rule: string
  hitCount: number
  firstSeen: number
}

export interface AggregatedDomainItem {
  /** 聚合后的规则域名（root 模式下为 eTLD+1，full 模式下为完整子域名） */
  domain: string
  /** 该分组下捕获到的所有原始完整域名 */
  subdomains: string[]
  /** 累计请求连接次数 */
  hitCount: number
  /** 最近命中的代理链路/出口展示 */
  chain: string
  /** 最近命中的规则类型展示 */
  rule: string
  /** 首次捕获时间戳 */
  firstSeen: number
}

export interface AggregateDomainsOptions {
  mode: 'root' | 'full'
  hideNoise: boolean
  portFilter: number | 'all'
}

/**
 * 将录制期间捕获到的原始主机名记录按指定模式（主域名收敛 / 完整子域名）聚合，用于界面勾选添加
 */
export function aggregateCapturedDomains(
  records: CapturedHostRecord[],
  options: AggregateDomainsOptions,
): AggregatedDomainItem[] {
  const groups = new Map<
    string,
    {
      domain: string
      subdomains: Set<string>
      hitCount: number
      chain: string
      rule: string
      firstSeen: number
      seededOnly: boolean
    }
  >()

  const portFilterNum = options.portFilter === 'all' ? null : options.portFilter
  const portFilterStr = portFilterNum !== null ? String(portFilterNum) : null
  const altProdPortStr =
    portFilterNum !== null && portFilterNum >= 10000
      ? String(portFilterNum - 10000)
      : null

  for (const rec of records) {
    const validHost = extractValidHostname(rec.host)
    if (!validHost) continue

    if (
      portFilterStr &&
      rec.inboundPort &&
      rec.inboundPort !== portFilterStr &&
      rec.inboundPort !== altProdPortStr
    ) {
      continue
    }

    if (options.hideNoise && isSystemNoiseDomain(validHost)) {
      continue
    }

    const key =
      options.mode === 'root' ? extractRootDomain(validHost) : validHost
    const isSeed = rec.rule === 'SEED'

    const existing = groups.get(key)
    if (existing) {
      existing.subdomains.add(validHost)
      if (existing.seededOnly && !isSeed) {
        existing.hitCount = rec.hitCount
        existing.chain = rec.chain || existing.chain
        existing.rule = rec.rule || existing.rule
        existing.seededOnly = false
      } else if (!isSeed) {
        existing.hitCount += rec.hitCount
        existing.chain = rec.chain || existing.chain
        existing.rule = rec.rule || existing.rule
      }
      if (rec.firstSeen < existing.firstSeen) {
        existing.firstSeen = rec.firstSeen
      }
    } else {
      groups.set(key, {
        domain: key,
        subdomains: new Set([validHost]),
        hitCount: rec.hitCount,
        chain: rec.chain,
        rule: rec.rule,
        firstSeen: rec.firstSeen,
        seededOnly: isSeed,
      })
    }
  }

  return Array.from(groups.values())
    .sort((a, b) => a.firstSeen - b.firstSeen)
    .map((g) => ({
      domain: g.domain,
      subdomains: Array.from(g.subdomains).sort(),
      hitCount: g.hitCount,
      chain: g.chain,
      rule: g.rule,
      firstSeen: g.firstSeen,
    }))
}

function buildHostPortRecordKey(
  host: string,
  inboundPort?: string | null,
): string {
  return `${host}:::${inboundPort || ''}`
}

/**
 * 在用户主动输入探测网址时预先注入目标主站记录，确保主站域名立即可见
 */
export function upsertSeedHostRecord(
  prevRecords: Map<string, CapturedHostRecord>,
  hostname: string,
  inboundPort: string | null,
  now: number,
): Map<string, CapturedHostRecord> {
  const validHost = extractValidHostname(hostname)
  if (!validHost) return prevRecords
  const recordKey = buildHostPortRecordKey(validHost, inboundPort)
  if (prevRecords.has(recordKey)) {
    return prevRecords
  }
  const nextRecords = new Map(prevRecords)
  nextRecords.set(recordKey, {
    host: validHost,
    inboundPort,
    chain: '目标主站',
    rule: 'SEED',
    hitCount: 1,
    firstSeen: now,
  })
  return nextRecords
}

/**
 * 将 Mihomo 连接快照增量合并至嗅探记录中：
 * - 首次基线快照：忽略已存在超过 4 秒且无新增流量的旧空闲连接，仅记录其当前字节数基线；
 * - 后续轮询快照：捕获所有新建连接，以及在录制期间产生实际收发流量增量的复用连接（HTTP/2 Keep-Alive）。
 */
export function mergeSnapshotIntoCapturedRecords(
  prevRecords: Map<string, CapturedHostRecord>,
  baselineTraffic: Map<string, number>,
  seenConnIds: Set<string>,
  connections: ConnectionItem[],
  now: number,
  isInitialSnapshot: boolean,
): Map<string, CapturedHostRecord> {
  let nextRecords: Map<string, CapturedHostRecord> | null = null

  for (const conn of connections) {
    const host = extractConnectionHost(conn)
    if (!host) continue

    const totalBytes = (conn.upload || 0) + (conn.download || 0)

    if (isInitialSnapshot) {
      const startMs = Date.parse(conn.start)
      const isVeryRecent = !Number.isNaN(startMs) && now - startMs <= 4000
      if (!isVeryRecent) {
        baselineTraffic.set(conn.id, totalBytes)
        continue
      }
    } else {
      if (seenConnIds.has(conn.id)) {
        continue
      }
      const baseBytes = baselineTraffic.get(conn.id)
      if (baseBytes !== undefined && totalBytes <= baseBytes) {
        continue
      }
    }

    seenConnIds.add(conn.id)
    const inboundPort = conn.metadata.inboundPort || null
    const recordKey = buildHostPortRecordKey(host, inboundPort)
    const chain =
      conn.chains && conn.chains.length > 0 ? conn.chains[0] : 'DIRECT'
    const rule = conn.rulePayload
      ? `${conn.rule},${conn.rulePayload}`
      : conn.rule || 'MATCH'

    if (!nextRecords) {
      nextRecords = new Map(prevRecords)
    }
    upsertCapturedHostRecord(
      nextRecords,
      recordKey,
      host,
      inboundPort,
      chain,
      rule,
      now,
    )
  }
  return nextRecords ?? prevRecords
}
/**
 * 将后端增量读取的 Mihomo 实时访问日志条目合并至嗅探记录中（捕获毫秒级短连接与 DIRECT 规则命中记录）
 */
export function mergeAccessLogsIntoCapturedRecords(
  prevRecords: Map<string, CapturedHostRecord>,
  seenLogKeys: Set<string>,
  entries: SniffedAccessLogEntry[],
): Map<string, CapturedHostRecord> {
  let nextRecords: Map<string, CapturedHostRecord> | null = null

  for (const entry of entries) {
    const host = extractValidHostname(entry.host)
    if (!host) continue

    const inboundPort = entry.inboundPort || null
    const dedupeKey = `${entry.timestampMs}:::${host}:::${inboundPort || ''}:::${entry.rule}`
    if (seenLogKeys.has(dedupeKey)) {
      continue
    }
    seenLogKeys.add(dedupeKey)

    const recordKey = buildHostPortRecordKey(host, inboundPort)
    const chain = entry.chain || 'DIRECT'
    const rule = entry.rule || 'MATCH'

    if (!nextRecords) {
      nextRecords = new Map(prevRecords)
    }
    upsertCapturedHostRecord(
      nextRecords,
      recordKey,
      host,
      inboundPort,
      chain,
      rule,
      entry.timestampMs,
    )
  }

  return nextRecords ?? prevRecords
}

function upsertCapturedHostRecord(
  records: Map<string, CapturedHostRecord>,
  recordKey: string,
  host: string,
  inboundPort: string | null,
  chain: string,
  rule: string,
  timestampMs: number,
): void {
  const existing = records.get(recordKey)
  if (existing) {
    const wasSeed = existing.rule === 'SEED'
    records.set(recordKey, {
      ...existing,
      chain,
      rule,
      hitCount: wasSeed ? 1 : existing.hitCount + 1,
    })
  } else {
    records.set(recordKey, {
      host,
      inboundPort,
      chain,
      rule,
      hitCount: 1,
      firstSeen: timestampMs,
    })
  }
}
