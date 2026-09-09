import { execSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

let ARTIFACTS_DIR = path.join(rootDir, 'dist-artifacts')
const SRC_TAURI_DIR = path.join(rootDir, 'src-tauri')
const BINARIES_DIR = path.join(SRC_TAURI_DIR, 'binaries')

function parseArgs() {
  const args = process.argv.slice(2)
  let target = null
  let version = null
  let outDir = null
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target' && args[i + 1]) {
      target = args[i + 1]
      i++
    } else if (args[i] === '--version' && args[i + 1]) {
      version = args[i + 1]
      i++
    } else if (
      (args[i] === '--out-dir' || args[i] === '--output-dir') &&
      args[i + 1]
    ) {
      outDir = path.resolve(rootDir, args[i + 1])
      i++
    } else if (!target && !args[i].startsWith('-')) {
      target = args[i]
    }
  }

  if (!version) {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'),
      )
      version = pkg.version || '1.0.0'
    } catch {
      version = '1.0.0'
    }
  }

  return { target, version, outDir }
}

function findFile(directories, predicate, version = null) {
  const matchedFiles = []
  for (const dir of directories) {
    if (!fs.existsSync(dir)) continue
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile() && predicate(entry.name)) {
        const fullPath = path.join(dir, entry.name)
        const stat = fs.statSync(fullPath)
        matchedFiles.push({
          path: fullPath,
          name: entry.name,
          mtime: stat.mtimeMs,
        })
      }
    }
  }
  if (matchedFiles.length === 0) return null

  if (version) {
    const versionMatch = matchedFiles.find((f) => f.name.includes(version))
    if (versionMatch) return versionMatch.path
  }
  matchedFiles.sort((a, b) => b.mtime - a.mtime)
  return matchedFiles[0].path
}

function computeSha256(filePath) {
  const buffer = fs.readFileSync(filePath)
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

async function packageWindowsPortable(target, version, releaseDirs) {
  const exePath = findFile(releaseDirs, (name) => name === 'mihomo-multi.exe')
  if (!exePath) {
    console.warn(
      `[pack-release] Could not locate mihomo-multi.exe in ${releaseDirs.join(
        ', ',
      )}, skipping portable zip.`,
    )
    return null
  }

  const sidecarName = `mihomo-${target}.exe`
  const sidecarPath = path.join(BINARIES_DIR, sidecarName)
  if (!fs.existsSync(sidecarPath)) {
    console.warn(
      `[pack-release] Could not locate sidecar at ${sidecarPath}, skipping portable zip.`,
    )
    return null
  }

  const archLabel = target.startsWith('aarch64') ? 'arm64' : 'x64'
  const zipName = `mihomo-multi_${version}_windows-${archLabel}-portable.zip`
  const zipPath = path.join(ARTIFACTS_DIR, zipName)

  console.log(`[pack-release] Packaging Windows portable zip: ${zipName}...`)
  const zip = new AdmZip()
  zip.addLocalFile(exePath)
  zip.addFile('.portable', Buffer.from(''))
  zip.addLocalFile(sidecarPath, 'binaries')
  zip.addFile('mihomo.exe', fs.readFileSync(sidecarPath))
  zip.writeZip(zipPath)

  console.log(`[pack-release] Successfully created: ${zipPath}`)
  return zipPath
}

async function packageLinuxPortable(version, releaseDirs) {
  const binPath = findFile(releaseDirs, (name) => name === 'mihomo-multi')
  if (!binPath) {
    console.warn(
      `[pack-release] Could not locate mihomo-multi binary in ${releaseDirs.join(
        ', ',
      )}, skipping portable tar.gz.`,
    )
    return null
  }

  const sidecarPath = path.join(BINARIES_DIR, 'mihomo-x86_64-unknown-linux-gnu')
  if (!fs.existsSync(sidecarPath)) {
    console.warn(
      `[pack-release] Could not locate Linux sidecar at ${sidecarPath}, skipping portable tar.gz.`,
    )
    return null
  }

  const tarName = `mihomo-multi_${version}_linux-x64.tar.gz`
  const tarPath = path.join(ARTIFACTS_DIR, tarName)
  const tempDir = path.join(ARTIFACTS_DIR, '.tmp-linux-portable')

  console.log(`[pack-release] Packaging Linux portable archive: ${tarName}...`)
  try {
    await fsp.mkdir(path.join(tempDir, 'binaries'), { recursive: true })
    await fsp.copyFile(binPath, path.join(tempDir, 'mihomo-multi'))
    await fsp.copyFile(
      sidecarPath,
      path.join(tempDir, 'binaries', 'mihomo-x86_64-unknown-linux-gnu'),
    )
    await fsp.copyFile(sidecarPath, path.join(tempDir, 'mihomo'))
    await fsp.writeFile(path.join(tempDir, '.portable'), '')

    if (process.platform !== 'win32') {
      await fsp.chmod(path.join(tempDir, 'mihomo-multi'), 0o755)
      await fsp.chmod(path.join(tempDir, 'mihomo'), 0o755)
      await fsp.chmod(
        path.join(tempDir, 'binaries', 'mihomo-x86_64-unknown-linux-gnu'),
        0o755,
      )
    }

    try {
      execSync(`tar -czvf "${tarPath}" -C "${tempDir}" .`)
      console.log(`[pack-release] Successfully created: ${tarPath}`)
      return tarPath
    } catch (err) {
      console.error(
        `[pack-release] Failed to create tar.gz via tar command: ${err.message}`,
      )
      return null
    }
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function packageMacUniversalApp(version, releaseDirs) {
  let appPath = null
  for (const dir of releaseDirs) {
    const candidate = path.join(dir, 'bundle', 'macos', 'Mihomo Multi.app')
    if (fs.existsSync(candidate)) {
      appPath = candidate
      break
    }
  }

  if (!appPath) {
    return null
  }

  const tarName = `mihomo-multi_${version}_universal.app.tar.gz`
  const tarPath = path.join(ARTIFACTS_DIR, tarName)
  const parentDir = path.dirname(appPath)
  const appBaseName = path.basename(appPath)

  console.log(
    `[pack-release] Packaging macOS Universal .app archive: ${tarName}...`,
  )
  try {
    execSync(`tar -czvf "${tarPath}" -C "${parentDir}" "${appBaseName}"`)
    console.log(`[pack-release] Successfully created: ${tarPath}`)
    return tarPath
  } catch (err) {
    console.warn(`[pack-release] tar failed for .app: ${err.message}`)
    return null
  }
}

async function main() {
  const { target, version, outDir } = parseArgs()
  if (outDir) {
    ARTIFACTS_DIR = outDir
  }
  if (!target) {
    throw new Error('Target triple is required. Use --target <target>')
  }

  console.log(
    `[pack-release] Processing release assets for target: "${target}", version: "${version}"`,
  )
  await fsp.mkdir(ARTIFACTS_DIR, { recursive: true })

  const candidateReleaseDirs = [
    path.join(SRC_TAURI_DIR, 'target', target, 'release'),
    path.join(SRC_TAURI_DIR, 'target', 'release'),
  ]

  const createdFiles = []

  // Windows x64
  if (target === 'x86_64-pc-windows-msvc') {
    const nsisDirs = candidateReleaseDirs.map((d) =>
      path.join(d, 'bundle', 'nsis'),
    )
    const nsisFile = findFile(nsisDirs, (n) => n.endsWith('.exe'), version)
    if (nsisFile) {
      const dest = path.join(
        ARTIFACTS_DIR,
        `mihomo-multi_${version}_x64-setup.exe`,
      )
      await fsp.copyFile(nsisFile, dest)
      createdFiles.push(dest)
      console.log(`[pack-release] Copied NSIS setup -> ${dest}`)
    }

    const msiDirs = candidateReleaseDirs.map((d) =>
      path.join(d, 'bundle', 'msi'),
    )
    const msiFile = findFile(msiDirs, (n) => n.endsWith('.msi'), version)
    if (msiFile) {
      const dest = path.join(
        ARTIFACTS_DIR,
        `mihomo-multi_${version}_x64_en-US.msi`,
      )
      await fsp.copyFile(msiFile, dest)
      createdFiles.push(dest)
      console.log(`[pack-release] Copied MSI installer -> ${dest}`)
    }

    const zip = await packageWindowsPortable(
      target,
      version,
      candidateReleaseDirs,
    )
    if (zip) createdFiles.push(zip)
  }

  // Windows ARM64
  else if (target === 'aarch64-pc-windows-msvc') {
    const nsisDirs = candidateReleaseDirs.map((d) =>
      path.join(d, 'bundle', 'nsis'),
    )
    const nsisFile = findFile(nsisDirs, (n) => n.endsWith('.exe'), version)
    if (nsisFile) {
      const dest = path.join(
        ARTIFACTS_DIR,
        `mihomo-multi_${version}_arm64-setup.exe`,
      )
      await fsp.copyFile(nsisFile, dest)
      createdFiles.push(dest)
      console.log(`[pack-release] Copied NSIS ARM64 setup -> ${dest}`)
    }

    const zip = await packageWindowsPortable(
      target,
      version,
      candidateReleaseDirs,
    )
    if (zip) createdFiles.push(zip)
  }

  // macOS Apple Silicon
  else if (target === 'aarch64-apple-darwin') {
    const dmgDirs = candidateReleaseDirs.map((d) =>
      path.join(d, 'bundle', 'dmg'),
    )
    const dmgFile = findFile(dmgDirs, (n) => n.endsWith('.dmg'), version)
    if (dmgFile) {
      const dest = path.join(
        ARTIFACTS_DIR,
        `mihomo-multi_${version}_aarch64.dmg`,
      )
      await fsp.copyFile(dmgFile, dest)
      createdFiles.push(dest)
      console.log(`[pack-release] Copied Apple Silicon DMG -> ${dest}`)
    }
  }

  // macOS Intel
  else if (target === 'x86_64-apple-darwin') {
    const dmgDirs = candidateReleaseDirs.map((d) =>
      path.join(d, 'bundle', 'dmg'),
    )
    const dmgFile = findFile(dmgDirs, (n) => n.endsWith('.dmg'), version)
    if (dmgFile) {
      const dest = path.join(ARTIFACTS_DIR, `mihomo-multi_${version}_x64.dmg`)
      await fsp.copyFile(dmgFile, dest)
      createdFiles.push(dest)
      console.log(`[pack-release] Copied Intel DMG -> ${dest}`)
    }
  }

  // macOS Universal
  else if (target === 'universal-apple-darwin') {
    const dmgDirs = candidateReleaseDirs.map((d) =>
      path.join(d, 'bundle', 'dmg'),
    )
    const dmgFile = findFile(dmgDirs, (n) => n.endsWith('.dmg'), version)
    if (dmgFile) {
      const dest = path.join(
        ARTIFACTS_DIR,
        `mihomo-multi_${version}_universal.dmg`,
      )
      await fsp.copyFile(dmgFile, dest)
      createdFiles.push(dest)
      console.log(`[pack-release] Copied Universal DMG -> ${dest}`)
    }

    const appTar = await packageMacUniversalApp(version, candidateReleaseDirs)
    if (appTar) createdFiles.push(appTar)
  }

  // Linux x86_64
  else if (target === 'x86_64-unknown-linux-gnu') {
    const debDirs = candidateReleaseDirs.map((d) =>
      path.join(d, 'bundle', 'deb'),
    )
    const debFile = findFile(debDirs, (n) => n.endsWith('.deb'), version)
    if (debFile) {
      const dest = path.join(ARTIFACTS_DIR, `mihomo-multi_${version}_amd64.deb`)
      await fsp.copyFile(debFile, dest)
      createdFiles.push(dest)
      console.log(`[pack-release] Copied Debian package -> ${dest}`)
    }

    const appImageDirs = candidateReleaseDirs.map((d) =>
      path.join(d, 'bundle', 'appimage'),
    )
    const appImageFile = findFile(
      appImageDirs,
      (n) => n.endsWith('.AppImage') || n.endsWith('.appimage'),
      version,
    )
    if (appImageFile) {
      const dest = path.join(
        ARTIFACTS_DIR,
        `mihomo-multi_${version}_amd64.AppImage`,
      )
      await fsp.copyFile(appImageFile, dest)
      createdFiles.push(dest)
      console.log(`[pack-release] Copied AppImage -> ${dest}`)
    }

    const tar = await packageLinuxPortable(version, candidateReleaseDirs)
    if (tar) createdFiles.push(tar)
  }

  // Generate SHA256 sums for created files
  if (createdFiles.length > 0) {
    const checksumLines = []
    for (const filePath of createdFiles) {
      const hash = computeSha256(filePath)
      const baseName = path.basename(filePath)
      checksumLines.push(`${hash}  ${baseName}`)
      console.log(`[pack-release] SHA256 (${baseName}): ${hash}`)
    }

    const checksumFile = path.join(ARTIFACTS_DIR, 'SHA256SUMS.txt')
    let existingContent = ''
    if (fs.existsSync(checksumFile)) {
      existingContent = fs.readFileSync(checksumFile, 'utf8')
    }
    const existingLines = existingContent
      .split('\n')
      .map((l) => l.trim())
      .filter((line) => {
        if (!line) return false
        const parts = line.split(/\s+/)
        const fileName = parts[parts.length - 1]
        return fileName && fs.existsSync(path.join(ARTIFACTS_DIR, fileName))
      })
    const combined = Array.from(
      new Set([...existingLines, ...checksumLines]),
    ).join('\n')
    fs.writeFileSync(checksumFile, `${combined}\n`, 'utf8')
    console.log(`[pack-release] Updated checksums file at: ${checksumFile}`)
  } else {
    console.warn(
      `[pack-release] Warning: No release artifacts found for target "${target}".`,
    )
  }
}

main().catch((err) => {
  console.error(`[pack-release] Error: ${err.message}`)
  process.exit(1)
})
