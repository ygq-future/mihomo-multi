import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function loadSource(path) {
  const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8')
  const exports = {}
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    { exports, URL },
  )
  return exports
}

const {
  extractValidHostname,
  extractRootDomain,
  normalizeProbeUrl,
  aggregateCapturedDomains,
  mergeSnapshotIntoCapturedRecords,
  mergeAccessLogsIntoCapturedRecords,
  upsertSeedHostRecord,
} = loadSource('../src/utils/domainExtractor.ts')

test('extractValidHostname normalizes hostnames and rejects IPs or invalid hosts', () => {
  assert.equal(extractValidHostname('API.IP.SB:443'), 'api.ip.sb')
  assert.equal(extractValidHostname('ip.skk.moe.'), 'ip.skk.moe')
  assert.equal(extractValidHostname('  *.Example.COM  '), 'example.com')
  assert.equal(extractValidHostname('104.16.132.229'), null)
  assert.equal(extractValidHostname('198.18.0.15:80'), null)
  assert.equal(extractValidHostname('[2606:4700::1]:443'), null)
  assert.equal(extractValidHostname('localhost'), null)
  assert.equal(extractValidHostname(''), null)
})

test('extractRootDomain extracts eTLD+1 accurately including multi-part TLDs and cloud storage', () => {
  assert.equal(extractRootDomain('ip.skk.moe'), 'skk.moe')
  assert.equal(extractRootDomain('api-ipv4.ip.sb'), 'ip.sb')
  assert.equal(extractRootDomain('cdn.jsdelivr.net'), 'jsdelivr.net')
  assert.equal(extractRootDomain('sub.api.example.com.cn'), 'example.com.cn')
  assert.equal(extractRootDomain('news.bbc.co.uk'), 'bbc.co.uk')
  assert.equal(
    extractRootDomain('openaicomproductionae4b.blob.core.windows.net'),
    'openaicomproductionae4b.blob.core.windows.net',
  )
  assert.equal(
    extractRootDomain('sub.openaicomproductionae4b.blob.core.windows.net'),
    'openaicomproductionae4b.blob.core.windows.net',
  )
  assert.equal(extractRootDomain('skk.moe'), 'skk.moe')
})

test('normalizeProbeUrl normalizes user input into valid http/https URL and seed host', () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(normalizeProbeUrl('ip.skk.moe'))),
    {
      url: 'https://ip.skk.moe',
      hostname: 'ip.skk.moe',
    },
  )
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(normalizeProbeUrl('http://test.example.com:8080/path')),
    ),
    {
      url: 'http://test.example.com:8080/path',
      hostname: 'test.example.com',
    },
  )
  assert.equal(normalizeProbeUrl('   '), null)
})

test('aggregateCapturedDomains groups by root or full mode and filters noise/port', () => {
  const records = [
    {
      host: 'ip.skk.moe',
      inboundPort: '7890',
      chain: 'DIRECT',
      rule: 'RULE-SET,cn_domain',
      hitCount: 2,
      firstSeen: 1000,
    },
    {
      host: 'api.ip.sb',
      inboundPort: '7890',
      chain: 'HK-Node',
      rule: 'IN-PORT,7890',
      hitCount: 3,
      firstSeen: 1001,
    },
    {
      host: 'v4.ip.sb',
      inboundPort: '7890',
      chain: 'HK-Node',
      rule: 'IN-PORT,7890',
      hitCount: 1,
      firstSeen: 1002,
    },
    {
      host: 'www.msftconnecttest.com',
      inboundPort: '7890',
      chain: 'DIRECT',
      rule: 'FINAL',
      hitCount: 5,
      firstSeen: 1003,
    },
    {
      host: 'other-port.example.org',
      inboundPort: '7891',
      chain: 'US-Node',
      rule: 'IN-PORT,7891',
      hitCount: 1,
      firstSeen: 1004,
    },
  ]

  // 1. Root mode, hide noise, all ports
  const rootItems = JSON.parse(
    JSON.stringify(
      aggregateCapturedDomains(records, {
        mode: 'root',
        hideNoise: true,
        portFilter: 'all',
      }),
    ),
  )

  assert.equal(rootItems.length, 3)
  assert.equal(rootItems[0].domain, 'skk.moe')
  assert.deepEqual(rootItems[0].subdomains, ['ip.skk.moe'])
  assert.equal(rootItems[1].domain, 'ip.sb')
  assert.equal(rootItems[1].hitCount, 4)
  assert.deepEqual(rootItems[1].subdomains, ['api.ip.sb', 'v4.ip.sb'])
  assert.equal(rootItems[2].domain, 'example.org')

  // 2. Full mode, port filter 7890, hide noise
  const fullPortItems = JSON.parse(
    JSON.stringify(
      aggregateCapturedDomains(records, {
        mode: 'full',
        hideNoise: true,
        portFilter: 7890,
      }),
    ),
  )
  assert.deepEqual(
    fullPortItems.map((i) => i.domain),
    ['ip.skk.moe', 'api.ip.sb', 'v4.ip.sb'],
  )
})

test('mergeSnapshotIntoCapturedRecords ignores idle baseline connections but captures reused HTTP/2 and new connections', () => {
  const seeded = upsertSeedHostRecord(new Map(), 'ip.skk.moe', '7890', 999)
  assert.equal(seeded.size, 1)
  const now = Date.parse('2026-10-14T12:00:10.000Z')
  const baselineTraffic = new Map()
  const seenConnIds = new Set()
  let records = new Map()

  // Poll 1 (Initial): 1 old idle connection (started 60s ago), 1 very recent connection (started 1s ago)
  records = mergeSnapshotIntoCapturedRecords(
    records,
    baselineTraffic,
    seenConnIds,
    [
      {
        id: 'old-idle-conn',
        metadata: {
          host: 'idle-keepalive.cloudflare.com',
          inboundPort: '7890',
        },
        upload: 1000,
        download: 5000,
        start: '2026-10-14T11:59:10.000Z',
        chains: ['HK-01'],
        rule: 'IN-PORT',
      },
      {
        id: 'recent-conn',
        metadata: { host: 'ip.skk.moe', inboundPort: '7890' },
        upload: 200,
        download: 1200,
        start: '2026-10-14T12:00:09.000Z',
        chains: ['DIRECT'],
        rule: 'RULE-SET',
      },
    ],
    now,
    true,
  )

  let list = JSON.parse(
    JSON.stringify(
      aggregateCapturedDomains(Array.from(records.values()), {
        mode: 'full',
        hideNoise: true,
        portFilter: 'all',
      }),
    ),
  )
  assert.deepEqual(
    list.map((i) => i.domain),
    ['ip.skk.moe'],
  )

  // Poll 2: old-idle-conn transmits new data (reused HTTP/2), plus a brand new connection to api.ip.sb
  records = mergeSnapshotIntoCapturedRecords(
    records,
    baselineTraffic,
    seenConnIds,
    [
      {
        id: 'old-idle-conn',
        metadata: {
          host: 'idle-keepalive.cloudflare.com',
          inboundPort: '7890',
        },
        upload: 1500,
        download: 8200,
        start: '2026-10-14T11:59:10.000Z',
        chains: ['HK-01'],
        rule: 'IN-PORT',
      },
      {
        id: 'recent-conn',
        metadata: { host: 'ip.skk.moe', inboundPort: '7890' },
        upload: 400,
        download: 2400,
        start: '2026-10-14T12:00:09.000Z',
        chains: ['DIRECT'],
        rule: 'RULE-SET',
      },
      {
        id: 'new-probe-conn',
        metadata: { host: '', sniffHost: 'api.ip.sb', inboundPort: '7890' },
        upload: 300,
        download: 900,
        start: '2026-10-14T12:00:11.000Z',
        chains: ['HK-01'],
        rule: 'IN-PORT',
      },
    ],
    now + 1000,
    false,
  )

  list = JSON.parse(
    JSON.stringify(
      aggregateCapturedDomains(Array.from(records.values()), {
        mode: 'full',
        hideNoise: true,
        portFilter: 'all',
      }),
    ),
  )
  assert.deepEqual(
    list.map((i) => i.domain),
    ['ip.skk.moe', 'idle-keepalive.cloudflare.com', 'api.ip.sb'],
  )
  // recent-conn was already seen in Poll 1, so hitCount stays 1
  assert.equal(list[0].hitCount, 1)
})

test('mergeAccessLogsIntoCapturedRecords captures short-lived ip.skk.moe chain domains and deduplicates polls', () => {
  const seenLogKeys = new Set()
  let records = upsertSeedHostRecord(new Map(), 'ip.skk.moe', '17893', 1000)

  const logBatch = [
    {
      host: 'ip.skk.moe',
      inboundPort: '7893',
      chain: '[ikuuu] 🇯🇵 日本S01 | IEPL',
      rule: 'Match',
      timestampMs: 1005,
    },
    {
      host: 'my.ip.cn',
      inboundPort: null,
      chain: 'DIRECT',
      rule: 'RuleSet(cn_domain)',
      timestampMs: 1010,
    },
    {
      host: 'api.ip.sb',
      inboundPort: '7893',
      chain: '[ikuuu] 🇯🇵 日本S01 | IEPL',
      rule: 'Match',
      timestampMs: 1015,
    },
    {
      host: 'ipv4-ip.api.skk.moe',
      inboundPort: '7893',
      chain: '[ikuuu] 🇯🇵 日本S01 | IEPL',
      rule: 'Match',
      timestampMs: 1020,
    },
    {
      host: '2026.ip138.com',
      inboundPort: null,
      chain: 'DIRECT',
      rule: 'RuleSet(cn_domain)',
      timestampMs: 1025,
    },
  ]

  // First poll + duplicate poll
  const firstMerged = mergeAccessLogsIntoCapturedRecords(
    records,
    seenLogKeys,
    logBatch,
  )
  records = mergeAccessLogsIntoCapturedRecords(
    firstMerged,
    seenLogKeys,
    logBatch,
  )
  assert.equal(records, firstMerged)

  const aggregated = JSON.parse(
    JSON.stringify(
      aggregateCapturedDomains(Array.from(records.values()), {
        mode: 'root',
        hideNoise: true,
        portFilter: 17893,
      }),
    ),
  )

  assert.deepEqual(
    aggregated.map((item) => item.domain),
    ['skk.moe', 'ip.cn', 'ip.sb', 'ip138.com'],
  )
  // skk.moe replaced SEED chain with real node and combined ip.skk.moe + ipv4-ip.api.skk.moe (hitCount = 2)
  assert.equal(aggregated[0].chain, '[ikuuu] 🇯🇵 日本S01 | IEPL')
  assert.equal(aggregated[0].hitCount, 2)
})
