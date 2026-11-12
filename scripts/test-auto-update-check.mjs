import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = ts.transpileModule(
  readFileSync(
    new URL('../src/hooks/useAppUpdateCheck.ts', import.meta.url),
    'utf8',
  ),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText

function setup({
  enabled = true,
  appFails = false,
  pendingRules = false,
} = {}) {
  let now = 1_000_000_000
  let checkedAt = 0
  const calls = { app: 0, kernel: 0, rules: 0, notices: [] }
  const timers = new Map()
  let timerId = 0
  const effects = []
  const state = {
    config: { checkUpdateOnStart: enabled },
    setAppUpdateInfo() {},
    scrollToSettingSection() {},
  }
  const api = {
    async checkAppUpdate() {
      calls.app++
      if (appFails) throw new Error('offline')
      return { hasUpdate: false }
    },
    async checkKernelUpdate() {
      calls.kernel++
      return { hasUpdate: true, latestVersion: '1.20.0' }
    },
    async updateRules() {
      calls.rules++
      if (pendingRules) await new Promise(() => {})
    },
  }
  const modules = {
    react: {
      useCallback: (fn) => fn,
      useRef: (current) => ({ current }),
      useEffect: (fn) => effects.push(fn),
    },
    '../components/common': {
      toast: { info: (...args) => calls.notices.push(args) },
    },
    '../constants': { APP_VERSION: '1.6.2' },
    '../services/tauri': api,
    '../stores/appStore': { useAppStore: (selector) => selector(state) },
    '../utils/appUpdateCache': {
      isVersionNewer: () => false,
      loadCachedAppUpdate: () => ({ checkedAt }),
      saveCachedAppUpdate: (_info, time) => {
        checkedAt = time
      },
    },
  }
  const setTimer = (fn, delay) => {
    const id = ++timerId
    timers.set(id, { fn, delay })
    return id
  }
  const clearTimer = (id) => timers.delete(id)
  const exports = {}
  vm.runInNewContext(source, {
    exports,
    require: (name) => {
      assert.ok(name in modules, `Unexpected import: ${name}`)
      return modules[name]
    },
    console: { debug() {} },
    Date: { now: () => now },
    window: {
      setTimeout: (fn, delay) => {
        const id = setTimer(() => {
          timers.delete(id)
          fn()
        }, delay)
        return id
      },
      clearTimeout: clearTimer,
      setInterval: setTimer,
      clearInterval: clearTimer,
    },
    setInterval: setTimer,
    clearInterval: clearTimer,
  })
  exports.useAppUpdateCheck()
  const cleanups = effects.map((fn) => fn())
  return {
    calls,
    async tick(delay, advance = 0) {
      now += advance
      for (const timer of [...timers.values()]) {
        if (timer.delay === delay) timer.fn()
      }
      await new Promise((resolve) => setImmediate(resolve))
    },
    cleanup() {
      for (const fn of cleanups) fn?.()
      assert.equal(timers.size, 0)
    },
  }
}

test('startup checks app and kernel together and directly refreshes MRS silently', async () => {
  const harness = setup()
  await harness.tick(2500)
  assert.equal(harness.calls.app, 1)
  assert.equal(harness.calls.kernel, 1)
  assert.equal(harness.calls.rules, 1)
  assert.equal(harness.calls.notices.length, 1)
  assert.equal(harness.calls.notices[0][1], '发现内核新版本')
  harness.cleanup()
})

test('daily checks share the app schedule while MRS refreshes after a full day', async () => {
  const harness = setup()
  await harness.tick(2500)
  await harness.tick(900000, 900000)
  assert.equal(harness.calls.app, 1)
  assert.equal(harness.calls.kernel, 1)
  assert.equal(harness.calls.rules, 1)
  await harness.tick(900000, 86400000)
  assert.equal(harness.calls.app, 2)
  assert.equal(harness.calls.kernel, 2)
  assert.equal(harness.calls.rules, 2)
  harness.cleanup()
})

test('disabling update checks leaves automatic MRS refresh enabled and silent', async () => {
  const harness = setup({ enabled: false })
  await harness.tick(2500)
  await harness.tick(900000, 86400000)
  assert.equal(harness.calls.app, 0)
  assert.equal(harness.calls.kernel, 0)
  assert.equal(harness.calls.rules, 2)
  assert.deepEqual(harness.calls.notices, [])
  harness.cleanup()
})

test('app check failure does not block kernel checks or MRS refresh', async () => {
  const harness = setup({ appFails: true })
  await harness.tick(2500)
  assert.equal(harness.calls.kernel, 1)
  assert.equal(harness.calls.rules, 1)
  harness.cleanup()
})

test('a pending MRS refresh does not overlap the next daily refresh', async () => {
  const harness = setup({ pendingRules: true })
  await harness.tick(2500)
  await harness.tick(900000, 86400000)
  assert.equal(harness.calls.rules, 1)
  harness.cleanup()
})
