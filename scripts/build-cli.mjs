#!/usr/bin/env node

/**
 * build-cli.mjs
 *
 * Compiles the standalone `mihomo-multi-cli` binary target so Tauri's bundler
 * packages it alongside `mihomo-multi`.
 *
 * The `universal-apple-darwin` target is not a real Rust target: Tauri merges
 * only the main binary into `target/universal-apple-darwin/<profile>`, then the
 * bundler expects every other `[[bin]]` to exist there too. This script builds
 * both macOS slices and lipos the CLI into that directory.
 *
 * Usage:
 *   node scripts/build-cli.mjs                        # Release build for host target
 *   node scripts/build-cli.mjs --debug                # Debug build for dev/CI checks
 *   node scripts/build-cli.mjs --target <triple>      # Build for a specific Rust target
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const tauriDir = path.join(rootDir, 'src-tauri')
const CLI_BIN_NAME = 'mihomo-multi-cli'
const UNIVERSAL_TARGET = 'universal-apple-darwin'
const MACOS_SLICES = ['aarch64-apple-darwin', 'x86_64-apple-darwin']

function parseArgs() {
  const args = process.argv.slice(2)
  let target = null
  let debug = false
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--target' || args[i] === '-t') && args[i + 1]) {
      target = args[++i]
    } else if (args[i] === '--debug') {
      debug = true
    }
  }
  return { target, debug }
}

function buildSlice(target, profile, debug) {
  const cargoArgs = [
    'build',
    '--manifest-path',
    path.join(tauriDir, 'Cargo.toml'),
    '--bin',
    CLI_BIN_NAME,
  ]
  if (!debug) {
    cargoArgs.push('--release')
  }
  if (target) {
    cargoArgs.push('--target', target)
  }

  console.log(
    `[build-cli] Building ${CLI_BIN_NAME} (${profile}${target ? `, ${target}` : ''})...`,
  )
  const res = spawnSync('cargo', cargoArgs, { cwd: rootDir, stdio: 'inherit' })
  if (res.status !== 0) {
    process.exit(res.status ?? 1)
  }
}

function buildUniversal(profile, debug) {
  for (const slice of MACOS_SLICES) {
    buildSlice(slice, profile, debug)
  }

  const outDir = path.join(tauriDir, 'target', UNIVERSAL_TARGET, profile)
  const outPath = path.join(outDir, CLI_BIN_NAME)
  const slices = MACOS_SLICES.map((slice) =>
    path.join(tauriDir, 'target', slice, profile, CLI_BIN_NAME),
  )

  fs.mkdirSync(outDir, { recursive: true })
  console.log(`[build-cli] Merging macOS slices into ${outPath}...`)
  const res = spawnSync('lipo', ['-create', '-output', outPath, ...slices], {
    cwd: rootDir,
    stdio: 'inherit',
  })
  if (res.status !== 0) {
    console.error(
      '[build-cli] lipo failed. A universal CLI requires macOS with Xcode command line tools.',
    )
    process.exit(res.status ?? 1)
  }
  fs.chmodSync(outPath, 0o755)
}

function main() {
  const { target, debug } = parseArgs()
  const profile = debug ? 'debug' : 'release'

  if (target === UNIVERSAL_TARGET) {
    buildUniversal(profile, debug)
    return
  }

  buildSlice(target, profile, debug)
}

main()
