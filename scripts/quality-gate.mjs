import { spawnSync } from 'node:child_process'

const STAGES = [
  {
    name: 'version',
    label: 'Version parity check',
    cmd: 'node',
    args: ['scripts/check-version-parity.mjs'],
  },
  {
    name: 'format:fe',
    label: 'Frontend format check (Biome)',
    cmd: 'pnpm',
    args: ['format:check'],
  },
  {
    name: 'format:be',
    label: 'Backend format check (rustfmt)',
    cmd: 'cargo',
    args: ['fmt', '--manifest-path', 'src-tauri/Cargo.toml', '--check'],
  },
  {
    name: 'lint:fe',
    label: 'Frontend lint (ESLint --max-warnings 0)',
    cmd: 'pnpm',
    args: ['lint:fe'],
  },
  {
    name: 'typecheck',
    label: 'Frontend typecheck (tsc --noEmit)',
    cmd: 'pnpm',
    args: ['typecheck'],
  },
  {
    name: 'lint:be',
    label: 'Backend lint (cargo clippy -D warnings)',
    cmd: 'cargo',
    args: [
      'clippy',
      '--manifest-path',
      'src-tauri/Cargo.toml',
      '--all-targets',
      '--',
      '-D',
      'warnings',
    ],
  },
  {
    name: 'test:fe',
    label: 'Frontend unit tests',
    cmd: 'pnpm',
    args: ['test:fe'],
  },
  {
    name: 'test:be',
    label: 'Backend unit tests (cargo test)',
    cmd: 'cargo',
    args: ['test', '--manifest-path', 'src-tauri/Cargo.toml'],
  },
  {
    name: 'build:fe',
    label: 'Frontend production build (tsc && vite build)',
    cmd: 'pnpm',
    args: ['build'],
  },
]

function parseArgs(argv) {
  const selected = []
  let verbose = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--verbose' || arg === '-v') {
      verbose = true
    } else if (arg === '--stage') {
      const val = argv[i + 1]
      if (!val) {
        console.error('Error: --stage requires a stage name')
        process.exit(2)
      }
      selected.push(
        ...val
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      )
      i += 1
    } else if (arg === '--list') {
      for (const stage of STAGES) {
        console.log(`${stage.name.padEnd(12)} ${stage.label}`)
      }
      process.exit(0)
    } else {
      console.error(`Unknown argument: ${arg}`)
      process.exit(2)
    }
  }
  return { selected, verbose }
}

const { selected, verbose } = parseArgs(process.argv.slice(2))
const stagesToRun =
  selected.length === 0
    ? STAGES
    : selected.map((name) => {
        const found = STAGES.find((s) => s.name === name)
        if (!found) {
          console.error(
            `Unknown stage "${name}". Available: ${STAGES.map((s) => s.name).join(', ')}`,
          )
          process.exit(2)
        }
        return found
      })

const startedAll = Date.now()
for (const stage of stagesToRun) {
  const started = Date.now()
  const res =
    process.platform === 'win32'
      ? spawnSync(
          'cmd.exe',
          ['/d', '/s', '/c', [stage.cmd, ...stage.args].join(' ')],
          {
            encoding: 'utf8',
            stdio: 'pipe',
          },
        )
      : spawnSync(stage.cmd, stage.args, {
          encoding: 'utf8',
          stdio: 'pipe',
        })
  const elapsed = ((Date.now() - started) / 1000).toFixed(2)

  if (res.error || res.status !== 0) {
    console.error(`[FAIL] ${stage.name} (${stage.label}) — ${elapsed}s`)
    if (res.error) {
      console.error(res.error.message)
    }
    if (res.stdout?.trim()) {
      console.error(res.stdout.trimEnd())
    }
    if (res.stderr?.trim()) {
      console.error(res.stderr.trimEnd())
    }
    process.exit(res.status ?? 1)
  }

  console.log(`[PASS] ${stage.name} (${stage.label}) — ${elapsed}s`)
  if (verbose) {
    if (res.stdout?.trim()) console.log(res.stdout.trimEnd())
    if (res.stderr?.trim()) console.log(res.stderr.trimEnd())
  }
}

const total = ((Date.now() - startedAll) / 1000).toFixed(2)
console.log(
  `Quality Gate passed (${stagesToRun.length}/${stagesToRun.length} stages, ${total}s)`,
)
