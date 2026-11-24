#!/usr/bin/env node

/**
 * build-cli.mjs
 *
 * Compiles the standalone `mihomo-multi-cli` binary target so Tauri's bundler
 * packages it alongside `mihomo-multi`.
 *
 * Usage:
 *   node scripts/build-cli.mjs                        # Release build for host target
 *   node scripts/build-cli.mjs --debug                # Debug build for dev/CI checks
 *   node scripts/build-cli.mjs --target <triple>      # Build for a specific Rust target
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const tauriDir = path.join(rootDir, 'src-tauri')

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

function main() {
  const { target, debug } = parseArgs()
  const profile = debug ? 'debug' : 'release'

  const cargoArgs = [
    'build',
    '--manifest-path',
    path.join(tauriDir, 'Cargo.toml'),
    '--bin',
    'mihomo-multi-cli',
  ]
  if (!debug) {
    cargoArgs.push('--release')
  }
  if (target) {
    cargoArgs.push('--target', target)
  }

  console.log(
    `[build-cli] Building mihomo-multi-cli (${profile}${target ? `, ${target}` : ''})...`,
  )
  const res = spawnSync('cargo', cargoArgs, { cwd: rootDir, stdio: 'inherit' })
  if (res.status !== 0) {
    process.exit(res.status ?? 1)
  }
}

main()
