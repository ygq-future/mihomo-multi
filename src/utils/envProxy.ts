/**
 * Terminal-side default `no_proxy` entries. Command line tools understand CIDR
 * blocks and dotted hosts, so the WinINet-only `<local>` marker is not used.
 */
const TERMINAL_DEFAULT_NO_PROXY: readonly string[] = [
  'localhost',
  '127.0.0.1',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
]

/**
 * Builds the `no_proxy` value injected by the copied shell command.
 *
 * Defaults are always present and user bypass entries are appended to them
 * (case-insensitive de-duplicated), mirroring the backend behaviour of
 * `build_combined_bypass_list`. Private and loopback traffic therefore always
 * bypasses the proxy port instead of relying on Mihomo DIRECT routing.
 */
export function buildTerminalNoProxy(userBypass?: string[]): string {
  const merged = [...TERMINAL_DEFAULT_NO_PROXY]
  const seen = new Set(merged.map((item) => item.toLowerCase()))

  for (const raw of userBypass ?? []) {
    const item = raw.trim()
    if (!item || item.toLowerCase() === '<local>') continue

    const key = item.toLowerCase()
    if (seen.has(key)) continue

    seen.add(key)
    merged.push(item)
  }

  return merged.join(',')
}
