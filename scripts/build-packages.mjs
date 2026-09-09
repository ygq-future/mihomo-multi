#!/usr/bin/env node

/**
 * build-packages.mjs
 *
 * 一键自动化打包各平台分发产物并归档至根目录 release-packages/
 *
 * 用法:
 *   pnpm build:release                                   # 自动识别当前平台并打包归档
 *   node scripts/build-packages.mjs                      # 同上
 *   node scripts/build-packages.mjs --target x86_64-pc-windows-msvc
 *   node scripts/build-packages.mjs --all                # 打包当前操作系统支持的所有原生目标
 *   node scripts/build-packages.mjs --out-dir dist-pkg   # 自定义输出目录
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

const DEFAULT_OUT_DIR = path.join(rootDir, 'release-packages')

// 各平台默认支持的 Target 配置
const TARGET_CONFIGS = {
  'x86_64-pc-windows-msvc': {
    platform: 'win32',
    name: 'Windows x64',
    bundleArgs: ['--bundles', 'nsis,msi'],
  },
  'aarch64-pc-windows-msvc': {
    platform: 'win32',
    name: 'Windows ARM64',
    bundleArgs: ['--bundles', 'nsis'],
  },
  'aarch64-apple-darwin': {
    platform: 'darwin',
    name: 'macOS Apple Silicon',
    bundleArgs: ['--bundles', 'dmg'],
  },
  'x86_64-apple-darwin': {
    platform: 'darwin',
    name: 'macOS Intel',
    bundleArgs: ['--bundles', 'dmg'],
  },
  'universal-apple-darwin': {
    platform: 'darwin',
    name: 'macOS Universal',
    bundleArgs: ['--bundles', 'dmg'],
  },
  'x86_64-unknown-linux-gnu': {
    platform: 'linux',
    name: 'Linux x86_64',
    bundleArgs: ['--bundles', 'deb,appimage'],
  },
}

function detectHostTarget() {
  const platform = os.platform()
  const arch = os.arch()

  if (platform === 'win32') {
    return arch === 'arm64'
      ? 'aarch64-pc-windows-msvc'
      : 'x86_64-pc-windows-msvc'
  }
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
  }
  if (platform === 'linux') {
    return 'x86_64-unknown-linux-gnu'
  }
  return null
}

function getSupportedTargetsForHost() {
  const hostPlatform = os.platform()
  return Object.keys(TARGET_CONFIGS).filter(
    (target) => TARGET_CONFIGS[target].platform === hostPlatform,
  )
}

function parseArgs() {
  const args = process.argv.slice(2)
  let targets = []
  let outDir = DEFAULT_OUT_DIR
  let buildAll = false
  let skipSidecar = false
  let noClean = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else if ((arg === '--target' || arg === '-t') && args[i + 1]) {
      targets.push(args[i + 1])
      i++
    } else if (arg === '--all') {
      buildAll = true
    } else if (
      (arg === '--out-dir' || arg === '--output-dir' || arg === '-o') &&
      args[i + 1]
    ) {
      outDir = path.resolve(rootDir, args[i + 1])
      i++
    } else if (arg === '--skip-sidecar') {
      skipSidecar = true
    } else if (arg === '--no-clean') {
      noClean = true
    } else if (!arg.startsWith('-')) {
      targets.push(arg)
    }
  }

  if (buildAll) {
    targets = getSupportedTargetsForHost()
  } else if (targets.length === 0) {
    const hostTarget = detectHostTarget()
    if (!hostTarget) {
      console.error(
        `[build-packages] 未能自动识别当前宿主系统 (${os.platform()}-${os.arch()})，请显式使用 --target <target> 指定构建目标。`,
      )
      process.exit(1)
    }
    targets = [hostTarget]
  }

  return { targets, outDir, skipSidecar, noClean }
}

function printHelp() {
  console.log(`
Mihomo Multi 一键打包归档脚本 (build-packages)

用法:
  node scripts/build-packages.mjs [选项]
  pnpm build:release [选项]

选项:
  --target, -t <target>  指定构建目标 (如 x86_64-pc-windows-msvc)
  --all                  构建当前宿主操作系统支持的所有原生目标
  --out-dir, -o <dir>    指定输出归档目录 (默认: 项目根目录/release-packages)
  --skip-sidecar         跳过 Mihomo Sidecar 内核下载检测
  --help, -h             显示本帮助信息
  --no-clean             保留历史旧版本文件（默认自动清理非当前版本的旧包）

可用目标列表:
  Windows:
    - x86_64-pc-windows-msvc   (Windows x64 NSIS + MSI + 绿色便携包)
    - aarch64-pc-windows-msvc  (Windows ARM64 NSIS)
  macOS (需在 macOS 宿主构建):
    - aarch64-apple-darwin     (Apple Silicon DMG)
    - x86_64-apple-darwin      (Intel DMG)
    - universal-apple-darwin   (Universal DMG)
  Linux (需在 Linux 宿主构建):
    - x86_64-unknown-linux-gnu (Debian deb + AppImage + tar.gz)
`)
}
function getCurrentVersion() {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'),
    )
    return pkg.version || '1.0.0'
  } catch {
    return '1.0.0'
  }
}

async function cleanOldReleasePackages(outDir, currentVersion) {
  if (!fs.existsSync(outDir)) return

  const entries = await fsp.readdir(outDir, { withFileTypes: true })
  const packageExtensions = [
    '.exe',
    '.msi',
    '.zip',
    '.dmg',
    '.deb',
    '.appimage',
    '.tar.gz',
  ]

  let removedCount = 0
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const lower = entry.name.toLowerCase()
    const isPackage = packageExtensions.some((ext) => lower.endsWith(ext))

    // 如果是安装包或压缩包，但文件名不包含当前最新版本号，或者属于冗余带空格旧命名，则清理
    if (
      isPackage &&
      (!entry.name.includes(currentVersion) || entry.name.includes(' '))
    ) {
      const fullPath = path.join(outDir, entry.name)
      await fsp.unlink(fullPath)
      console.log(`\x1b[33m[清理旧版本] 已删除历史包: ${entry.name}\x1b[0m`)
      removedCount++
    }
  }

  // 同步过滤校验和文件 SHA256SUMS.txt 中的无效历史条目
  const checksumFile = path.join(outDir, 'SHA256SUMS.txt')
  if (fs.existsSync(checksumFile)) {
    const content = await fsp.readFile(checksumFile, 'utf8')
    const validLines = content
      .split('\n')
      .map((l) => l.trim())
      .filter((line) => {
        if (!line) return false
        const parts = line.split(/\s+/)
        const filename = parts[parts.length - 1]
        return filename && fs.existsSync(path.join(outDir, filename))
      })
    if (validLines.length > 0) {
      await fsp.writeFile(checksumFile, `${validLines.join('\n')}\n`, 'utf8')
    } else {
      await fsp.unlink(checksumFile).catch(() => {})
    }
  }

  if (removedCount > 0) {
    console.log(
      `\x1b[32m[清理完成] 共清理 ${removedCount} 个旧版本残留文件。\x1b[0m\n`,
    )
  }
}

function runCommand(command, args, cwd = rootDir) {
  const cmdStr = `${command} ${args.join(' ')}`
  console.log(`\n\x1b[36m>>> 执行: ${cmdStr}\x1b[0m`)
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, CI: 'true' },
  })

  if (result.status !== 0) {
    throw new Error(`命令执行失败 (退出码: ${result.status}): ${cmdStr}`)
  }
}

async function buildSingleTarget(target, outDir, skipSidecar) {
  const config = TARGET_CONFIGS[target]
  const hostPlatform = os.platform()

  if (config && config.platform !== hostPlatform) {
    console.warn(
      `\n\x1b[33m[警告] 目标 "${target}" 为 ${config.name} 原生包，受平台强绑定系统依赖 (如 WebKit/GTK/DMG/签名) 限制，无法在当前系统 (${hostPlatform}) 直接交叉编译。\x1b[0m`,
    )
    console.warn(
      `\x1b[33m提示: 完整多端打包已配置在 GitHub Actions (.github/workflows/release.yml) 中，推送到 Release Tag 会由各平台矩阵自动全量构建。\x1b[0m\n`,
    )
    return false
  }

  console.log(
    `\n\x1b[32m=================================================================\x1b[0m`,
  )
  console.log(
    `\x1b[32m开始构建目标: ${target} (${config ? config.name : 'Custom Target'})\x1b[0m`,
  )
  console.log(`\x1b[32m输出目录: ${outDir}\x1b[0m`)
  console.log(
    `\x1b[32m=================================================================\x1b[0m\n`,
  )

  // 1. 准备适配的 Mihomo Sidecar 内核
  if (!skipSidecar) {
    runCommand('node', ['scripts/dev-sidecar.mjs', '--target', target])
  }

  // 2. 构建 Tauri 原生应用
  const bundleArgs = (config && config.bundleArgs) || []
  const tauriArgs = ['tauri', 'build', '--target', target, ...bundleArgs]
  runCommand('pnpm', tauriArgs)

  // 3. 提取产物并规整化打包至输出目录
  runCommand('node', [
    'scripts/pack-release-assets.mjs',
    '--target',
    target,
    '--out-dir',
    outDir,
  ])

  return true
}

async function main() {
  const { targets, outDir, skipSidecar, noClean } = parseArgs()
  const currentVersion = getCurrentVersion()

  await fsp.mkdir(outDir, { recursive: true })

  if (!noClean) {
    await cleanOldReleasePackages(outDir, currentVersion)
  }

  console.log(
    `\x1b[35m[build-packages] 目标列表: [${targets.join(', ')}]\x1b[0m`,
  )
  console.log(`\x1b[35m[build-packages] 最终产物归档路径: ${outDir}\x1b[0m\n`)

  let successCount = 0
  for (const target of targets) {
    try {
      const ok = await buildSingleTarget(target, outDir, skipSidecar)
      if (ok) successCount++
    } catch (err) {
      console.error(
        `\n\x1b[31m[build-packages] 构建目标 "${target}" 失败: ${err.message}\x1b[0m`,
      )
      process.exit(1)
    }
  }

  console.log(
    `\n\x1b[32m=================================================================\x1b[0m`,
  )
  console.log(
    `\x1b[32m[build-packages] 打包流程结束！成功完成 ${successCount} 个目标的归档。\x1b[0m`,
  )
  console.log(`\x1b[32m所有分发包均已存放在: ${outDir}\x1b[0m`)

  if (fs.existsSync(outDir)) {
    const files = fs.readdirSync(outDir)
    console.log(`\n当前归档产物清单:`)
    for (const f of files) {
      const stat = fs.statSync(path.join(outDir, f))
      const mb = (stat.size / 1024 / 1024).toFixed(2)
      console.log(`  - ${f} (${mb} MB)`)
    }
  }
  console.log(
    `\x1b[32m=================================================================\x1b[0m\n`,
  )
}

main().catch((err) => {
  console.error(`[build-packages] 运行发生异常: ${err.message}`)
  process.exit(1)
})
