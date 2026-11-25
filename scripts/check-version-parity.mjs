import fs from 'node:fs'
import path from 'node:path'

const rootDir = process.cwd()

function readText(relPath) {
  return fs.readFileSync(path.join(rootDir, relPath), 'utf8')
}

function extractPackageJsonVersion() {
  const pkg = JSON.parse(readText('package.json'))
  if (typeof pkg.version !== 'string' || !pkg.version.trim()) {
    throw new Error('package.json is missing a valid "version" string')
  }
  return pkg.version.trim()
}

function extractCargoTomlVersion() {
  const raw = readText('src-tauri/Cargo.toml')
  const pkgSection = raw.match(/\[package\][\s\S]*?(?=\r?\n\[|\s*$)/)
  if (!pkgSection) {
    throw new Error('src-tauri/Cargo.toml is missing [package] section')
  }
  const match = pkgSection[0].match(/^\s*version\s*=\s*"([^"]+)"/m)
  if (!match) {
    throw new Error('src-tauri/Cargo.toml is missing [package].version')
  }
  return match[1].trim()
}

function extractTauriConfVersion() {
  const conf = JSON.parse(readText('src-tauri/tauri.conf.json'))
  if (typeof conf.version !== 'string' || !conf.version.trim()) {
    throw new Error(
      'src-tauri/tauri.conf.json is missing a valid "version" string',
    )
  }
  return conf.version.trim()
}

function extractAppTsVersion() {
  const raw = readText('src/constants/app.ts')
  const match = raw.match(/export\s+const\s+APP_VERSION\s*=\s*['"]([^'"]+)['"]/)
  if (!match) {
    throw new Error('src/constants/app.ts is missing APP_VERSION constant')
  }
  return match[1].trim()
}

function parseTagArg(argv) {
  const idx = argv.indexOf('--tag')
  if (idx === -1) return null
  const val = argv[idx + 1]
  if (!val) {
    throw new Error('--tag requires a value (e.g. --tag v1.6.8)')
  }
  return val.trim()
}

const canonical = extractPackageJsonVersion()
const consumers = [
  { name: 'package.json', version: canonical },
  { name: 'src-tauri/Cargo.toml', version: extractCargoTomlVersion() },
  { name: 'src-tauri/tauri.conf.json', version: extractTauriConfVersion() },
  {
    name: 'src/constants/app.ts (APP_VERSION)',
    version: extractAppTsVersion(),
  },
]

const mismatches = consumers.filter((item) => item.version !== canonical)
const tagArg = parseTagArg(process.argv.slice(2))
if (tagArg) {
  const normalizedTag = tagArg.startsWith('v') ? tagArg.slice(1) : tagArg
  if (normalizedTag !== canonical) {
    mismatches.push({ name: `git tag (${tagArg})`, version: normalizedTag })
  }
}

if (mismatches.length > 0) {
  console.error(
    `Version parity check failed (canonical package.json = ${canonical}):`,
  )
  for (const item of consumers) {
    const marker = item.version === canonical ? 'OK' : 'MISMATCH'
    console.error(`  [${marker}] ${item.name}: ${item.version}`)
  }
  if (tagArg) {
    console.error(`  [TAG] ${tagArg}`)
  }
  process.exit(1)
}

console.log(
  `Version parity OK: ${canonical} (4/4 files synchronized${tagArg ? `, tag ${tagArg}` : ''})`,
)
