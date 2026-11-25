#!/usr/bin/env node

/**
 * clean-stale-target.mjs
 *
 * Prunes historical Cargo incremental hash directories under `src-tauri/target`,
 * keeping only the most recently updated hash directory per crate.
 * Also removes interrupted `.tmp*.temp-archive` folders and, when `cargo-sweep`
 * is available, artifacts from uninstalled Rust toolchains.
 *
 * Usage:
 *   pnpm clean:stale
 *   pnpm clean:stale -- --dry-run
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const srcTauriDir = path.join(rootDir, 'src-tauri')
const targetDir = path.join(srcTauriDir, 'target')

const dryRun = process.argv.includes('--dry-run') || process.argv.includes('-d')

function dirSizeBytes(dirPath) {
  let total = 0
  let entries
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      total += dirSizeBytes(full)
    } else if (entry.isFile()) {
      try {
        total += fs.statSync(full).size
      } catch {
        // ignore transient files
      }
    }
  }
  return total
}

function latestMtimeMs(dirPath) {
  let latest = 0
  try {
    latest = fs.statSync(dirPath).mtimeMs
  } catch {
    return 0
  }
  let entries
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return latest
  }
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name)
    try {
      const mtime = fs.statSync(full).mtimeMs
      if (mtime > latest) latest = mtime
    } catch {
      // ignore transient files
    }
  }
  return latest
}

function formatMB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function splitCrateHash(dirName) {
  const idx = dirName.lastIndexOf('-')
  if (idx <= 0 || idx === dirName.length - 1) return null
  return dirName.slice(0, idx)
}

function findIncrementalDirs(baseDir) {
  const results = []
  if (!fs.existsSync(baseDir)) return results
  const entries = fs.readdirSync(baseDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const full = path.join(baseDir, entry.name)
    if (entry.name === 'incremental') {
      results.push(full)
    } else {
      const nested = path.join(full, 'incremental')
      if (fs.existsSync(nested) && fs.statSync(nested).isDirectory()) {
        results.push(nested)
      }
    }
  }
  return results
}

function pruneIncrementalDirs() {
  let removedCount = 0
  let reclaimedBytes = 0

  for (const incDir of findIncrementalDirs(targetDir)) {
    const groups = new Map()
    const entries = fs.readdirSync(incDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const cratePrefix = splitCrateHash(entry.name)
      if (!cratePrefix) continue
      const fullPath = path.join(incDir, entry.name)
      const list = groups.get(cratePrefix) ?? []
      list.push({
        name: entry.name,
        fullPath,
        mtimeMs: latestMtimeMs(fullPath),
      })
      groups.set(cratePrefix, list)
    }

    for (const [cratePrefix, list] of groups.entries()) {
      if (list.length <= 1) continue
      list.sort((a, b) => b.mtimeMs - a.mtimeMs)
      const [latest, ...stale] = list
      console.log(
        `[clean:stale] ${cratePrefix}: keep ${latest.name}, prune ${stale.length} older hash dir(s)`,
      )
      for (const item of stale) {
        const size = dirSizeBytes(item.fullPath)
        reclaimedBytes += size
        removedCount += 1
        if (dryRun) {
          console.log(
            `  [dry-run] would remove ${item.name} (${formatMB(size)})`,
          )
        } else {
          fs.rmSync(item.fullPath, { recursive: true, force: true })
          console.log(`  removed ${item.name} (${formatMB(size)})`)
        }
      }
    }
  }

  return { removedCount, reclaimedBytes }
}

function pruneTempArchives() {
  let removedCount = 0
  let reclaimedBytes = 0
  if (!fs.existsSync(targetDir)) return { removedCount, reclaimedBytes }

  const profileDirs = fs.readdirSync(targetDir, { withFileTypes: true })
  for (const entry of profileDirs) {
    if (!entry.isDirectory()) continue
    const depsDir = path.join(targetDir, entry.name, 'deps')
    if (!fs.existsSync(depsDir)) continue
    for (const dep of fs.readdirSync(depsDir, { withFileTypes: true })) {
      if (!dep.isDirectory() || !dep.name.endsWith('.temp-archive')) continue
      const fullPath = path.join(depsDir, dep.name)
      const size = dirSizeBytes(fullPath)
      reclaimedBytes += size
      removedCount += 1
      if (dryRun) {
        console.log(
          `[clean:stale] [dry-run] would remove temp archive ${dep.name} (${formatMB(size)})`,
        )
      } else {
        fs.rmSync(fullPath, { recursive: true, force: true })
        console.log(
          `[clean:stale] removed temp archive ${dep.name} (${formatMB(size)})`,
        )
      }
    }
  }

  return { removedCount, reclaimedBytes }
}

function sweepUninstalledToolchains() {
  const args = ['sweep', '--installed']
  if (dryRun) args.push('--dry-run')
  args.push(srcTauriDir)

  const res = spawnSync('cargo', args, {
    cwd: rootDir,
    stdio: 'inherit',
  })
  if (res.error) {
    console.log(
      '[clean:stale] cargo-sweep not available; skipped toolchain sweep.',
    )
  }
}

if (!fs.existsSync(targetDir)) {
  console.log(
    '[clean:stale] src-tauri/target does not exist; nothing to clean.',
  )
  process.exit(0)
}

const incResult = pruneIncrementalDirs()
const tmpResult = pruneTempArchives()
sweepUninstalledToolchains()

const totalDirs = incResult.removedCount + tmpResult.removedCount
const totalBytes = incResult.reclaimedBytes + tmpResult.reclaimedBytes
const prefix = dryRun
  ? '[clean:stale] [dry-run] summary:'
  : '[clean:stale] done:'
console.log(
  `${prefix} ${totalDirs} stale dir(s), ${formatMB(totalBytes)} logical size.`,
)
