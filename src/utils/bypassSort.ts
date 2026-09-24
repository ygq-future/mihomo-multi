/**
 * Helper to stably sort system proxy bypass items:
 * 1. `localhost`
 * 2. Domains (clustered by parent domain via reverse hierarchy, exact before wildcard before subdomains)
 * 3. IPv4 addresses/CIDRs/wildcards (sorted by numeric octets)
 * 4. IPv6 addresses/CIDRs
 * 5. `<local>`
 */

interface BypassSortKey {
  category: number
  domainLabels?: string[]
  isWildcard?: number
  ipv4Octets?: [number, number, number, number, number]
  ipv6Str?: string
  raw: string
}

function parseIpv4Spec(
  s: string,
): [number, number, number, number, number] | null {
  if (s.endsWith('.*')) {
    const prefixPart = s.slice(0, -2)
    const parts = prefixPart.split('.')
    if (parts.length >= 1 && parts.length <= 3) {
      const octets: [number, number, number, number, number] = [
        0,
        0,
        0,
        0,
        parts.length * 8,
      ]
      for (let i = 0; i < parts.length; i++) {
        const num = Number(parts[i])
        if (Number.isNaN(num) || num < 0 || num > 255) return null
        octets[i] = num
      }
      return octets
    }
  }

  const [ipPart, pfxPart] = s.split('/')
  const prefix = pfxPart !== undefined ? Number(pfxPart) : 32
  if (Number.isNaN(prefix) || prefix < 0 || prefix > 32) return null

  const parts = ipPart.split('.')
  if (parts.length === 4) {
    const nums = parts.map(Number)
    if (nums.every((n) => !Number.isNaN(n) && n >= 0 && n <= 255)) {
      return [nums[0], nums[1], nums[2], nums[3], prefix]
    }
  }

  return null
}

function getBypassSortKey(item: string): BypassSortKey {
  const s = item.trim()
  const lower = s.toLowerCase()

  if (lower === 'localhost') {
    return { category: 0, raw: lower }
  }
  if (lower === '<local>') {
    return { category: 4, raw: lower }
  }

  const ipv4 = parseIpv4Spec(s)
  if (ipv4) {
    return { category: 2, ipv4Octets: ipv4, raw: lower }
  }

  if (lower.includes(':')) {
    return { category: 3, ipv6Str: lower, raw: lower }
  }

  const isWildcard = s.startsWith('*.') || s.startsWith('*') ? 1 : 0
  const clean = s.replace(/^\*+\.?/, '').toLowerCase()
  if (clean) {
    const labels = clean.split('.').filter(Boolean).reverse()
    return { category: 1, domainLabels: labels, isWildcard, raw: lower }
  }

  return { category: 5, raw: lower }
}

export function sortBypassItems(items: string[]): string[] {
  return [...items].sort((a, b) => {
    const keyA = getBypassSortKey(a)
    const keyB = getBypassSortKey(b)

    if (keyA.category !== keyB.category) {
      return keyA.category - keyB.category
    }

    if (keyA.category === 1 && keyA.domainLabels && keyB.domainLabels) {
      const minLen = Math.min(
        keyA.domainLabels.length,
        keyB.domainLabels.length,
      )
      for (let i = 0; i < minLen; i++) {
        const cmp = keyA.domainLabels[i].localeCompare(keyB.domainLabels[i])
        if (cmp !== 0) return cmp
      }
      if (keyA.domainLabels.length !== keyB.domainLabels.length) {
        return keyA.domainLabels.length - keyB.domainLabels.length
      }
      if (keyA.isWildcard !== keyB.isWildcard) {
        return (keyA.isWildcard ?? 0) - (keyB.isWildcard ?? 0)
      }
    }

    if (keyA.category === 2 && keyA.ipv4Octets && keyB.ipv4Octets) {
      for (let i = 0; i < 5; i++) {
        if (keyA.ipv4Octets[i] !== keyB.ipv4Octets[i]) {
          return keyA.ipv4Octets[i] - keyB.ipv4Octets[i]
        }
      }
    }

    if (keyA.category === 3 && keyA.ipv6Str && keyB.ipv6Str) {
      const cmp = keyA.ipv6Str.localeCompare(keyB.ipv6Str)
      if (cmp !== 0) return cmp
    }

    return keyA.raw.localeCompare(keyB.raw)
  })
}
