import test from 'node:test'
import assert from 'node:assert/strict'

function isVersionNewer(current, remote) {
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

function parseAppUpdateCache(raw) {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
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
    return null
  }
  return null
}

test('isVersionNewer correctly compares versions', () => {
  assert.equal(isVersionNewer('1.0.0', '1.0.1'), true)
  assert.equal(isVersionNewer('v1.0.0', '1.0.1'), true)
  assert.equal(isVersionNewer('1.0.0', 'v1.0.1'), true)
  assert.equal(isVersionNewer('1.1.2', '1.1.2'), false)
  assert.equal(isVersionNewer('1.1.3', '1.1.2'), false)
  assert.equal(isVersionNewer('1.2.0', '1.1.9'), false)
  assert.equal(isVersionNewer('0.9.9', '1.0.0'), true)
})

test('parseAppUpdateCache safely validates cache shape', () => {
  assert.equal(parseAppUpdateCache(null), null)
  assert.equal(parseAppUpdateCache(''), null)
  assert.equal(parseAppUpdateCache('invalid-json'), null)
  assert.equal(
    parseAppUpdateCache(JSON.stringify({ latestVersion: '1.0.0' })),
    null,
  )

  const valid = {
    latestVersion: '1.0.1',
    hasUpdate: true,
    checkedAt: 1727250000000,
    info: {
      currentVersion: '1.0.0',
      latestVersion: '1.0.1',
      hasUpdate: true,
      availableAssets: [],
      isInstalled: false,
    },
  }
  const result = parseAppUpdateCache(JSON.stringify(valid))
  assert.notEqual(result, null)
  assert.equal(result.latestVersion, '1.0.1')
  assert.equal(result.hasUpdate, true)
  assert.equal(result.checkedAt, 1727250000000)
})
