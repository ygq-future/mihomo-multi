import { execSync } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'
import AdmZip from 'adm-zip'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

const BINARIES_DIR = path.join(rootDir, 'src-tauri', 'binaries')
const TEMP_DIR = path.join(rootDir, 'node_modules', '.sidecar-temp')

const TARGET_MAP = {
  'x86_64-pc-windows-msvc': {
    name: 'mihomo-windows-amd64-v2',
    ext: 'zip',
    targetFile: 'mihomo-x86_64-pc-windows-msvc.exe',
  },
  'i686-pc-windows-msvc': {
    name: 'mihomo-windows-386',
    ext: 'zip',
    targetFile: 'mihomo-i686-pc-windows-msvc.exe',
  },
  'aarch64-pc-windows-msvc': {
    name: 'mihomo-windows-arm64',
    ext: 'zip',
    targetFile: 'mihomo-aarch64-pc-windows-msvc.exe',
  },
  'x86_64-apple-darwin': {
    name: 'mihomo-darwin-amd64-go122',
    ext: 'gz',
    targetFile: 'mihomo-x86_64-apple-darwin',
  },
  'aarch64-apple-darwin': {
    name: 'mihomo-darwin-arm64-go122',
    ext: 'gz',
    targetFile: 'mihomo-aarch64-apple-darwin',
  },
  'x86_64-unknown-linux-gnu': {
    name: 'mihomo-linux-amd64-v2',
    ext: 'gz',
    targetFile: 'mihomo-x86_64-unknown-linux-gnu',
  },
  'aarch64-unknown-linux-gnu': {
    name: 'mihomo-linux-arm64',
    ext: 'gz',
    targetFile: 'mihomo-aarch64-unknown-linux-gnu',
  },
}

function detectTargetTriple() {
  try {
    const output = execSync('rustc -vV', { encoding: 'utf-8' })
    const match = output.match(/host:\s*([^\s]+)/)
    if (match?.[1] && TARGET_MAP[match[1]]) {
      return match[1]
    }
  } catch {
    // fallback to platform/arch
  }

  const { platform, arch } = process
  if (platform === 'win32') {
    if (arch === 'x64') return 'x86_64-pc-windows-msvc'
    if (arch === 'arm64') return 'aarch64-pc-windows-msvc'
    return 'i686-pc-windows-msvc'
  }
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
  }
  if (platform === 'linux') {
    return arch === 'arm64'
      ? 'aarch64-unknown-linux-gnu'
      : 'x86_64-unknown-linux-gnu'
  }
  throw new Error(`Unsupported platform: ${platform} (${arch})`)
}

function parseArgs() {
  const args = process.argv.slice(2)
  let target = null
  let force = false

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target' && args[i + 1]) {
      target = args[i + 1]
      i++
    } else if (args[i] === '--force' || args[i] === '-f') {
      force = true
    } else if (!target && !args[i].startsWith('-')) {
      target = args[i]
    }
  }

  return {
    target: target || detectTargetTriple(),
    force,
  }
}

async function fetchWithRetry(url, options = {}, retries = 3) {
  let lastError
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options)
      if (res.ok) return res
      throw new Error(`HTTP ${res.status} ${res.statusText}`)
    } catch (err) {
      lastError = err
      console.warn(
        `[dev-sidecar] Fetch failed (${i + 1}/${retries}): ${err.message}`,
      )
      if (i < retries - 1) {
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)))
      }
    }
  }
  throw lastError
}

async function getLatestVersion() {
  const versionUrl =
    'https://github.com/MetaCubeX/mihomo/releases/latest/download/version.txt'
  console.log(`[dev-sidecar] Querying latest version from ${versionUrl}...`)
  try {
    const res = await fetchWithRetry(versionUrl)
    const version = (await res.text()).trim()
    console.log(`[dev-sidecar] Discovered latest Mihomo version: ${version}`)
    return version
  } catch (err) {
    console.warn(
      `[dev-sidecar] Failed to fetch version.txt (${err.message}), falling back to stable v1.19.16`,
    )
    return 'v1.19.16'
  }
}

async function main() {
  const { target, force } = parseArgs()
  const targetConfig = TARGET_MAP[target]

  if (!targetConfig) {
    throw new Error(
      `Unknown or unsupported target triple: "${target}". Supported targets: ${Object.keys(
        TARGET_MAP,
      ).join(', ')}`,
    )
  }

  await fsp.mkdir(BINARIES_DIR, { recursive: true })
  const gitkeepPath = path.join(BINARIES_DIR, '.gitkeep')
  if (!fs.existsSync(gitkeepPath)) {
    await fsp.writeFile(gitkeepPath, '')
  }

  const destinationPath = path.join(BINARIES_DIR, targetConfig.targetFile)
  if (!force && fs.existsSync(destinationPath)) {
    const stat = await fsp.stat(destinationPath)
    if (stat.size > 1024 * 1024) {
      console.log(
        `[dev-sidecar] Target binary already exists at ${destinationPath} (${(
          stat.size / 1024 / 1024
        ).toFixed(2)} MB), skipping. Use --force to re-download.`,
      )
      return
    }
  }

  const version = await getLatestVersion()
  const archiveName = `${targetConfig.name}-${version}.${targetConfig.ext}`
  const downloadUrl = `https://github.com/MetaCubeX/mihomo/releases/download/${version}/${archiveName}`

  console.log(`[dev-sidecar] Downloading sidecar binary: ${downloadUrl}`)
  await fsp.mkdir(TEMP_DIR, { recursive: true })
  const tempArchive = path.join(TEMP_DIR, archiveName)

  try {
    const response = await fetchWithRetry(downloadUrl)
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    await fsp.writeFile(tempArchive, buffer)
    console.log(
      `[dev-sidecar] Downloaded ${archiveName} (${(
        buffer.length / 1024 / 1024
      ).toFixed(2)} MB)`,
    )

    if (targetConfig.ext === 'zip') {
      const zip = new AdmZip(tempArchive)
      const zipEntries = zip.getEntries()
      const exeEntry = zipEntries.find(
        (entry) =>
          entry.entryName.endsWith('.exe') || !entry.entryName.includes('.'),
      )
      if (!exeEntry) {
        throw new Error(`No executable found in archive ${archiveName}`)
      }
      const data = exeEntry.getData()
      await fsp.writeFile(destinationPath, data)
    } else if (targetConfig.ext === 'gz') {
      const decompressed = zlib.gunzipSync(buffer)
      await fsp.writeFile(destinationPath, decompressed)
    }

    if (process.platform !== 'win32') {
      await fsp.chmod(destinationPath, 0o755)
    }

    console.log(
      `[dev-sidecar] Successfully installed sidecar binary to: ${destinationPath}`,
    )
  } finally {
    await fsp.rm(TEMP_DIR, { recursive: true, force: true }).catch(() => {})
  }
}

main().catch((err) => {
  console.error(`[dev-sidecar] Error: ${err.message}`)
  process.exit(1)
})
