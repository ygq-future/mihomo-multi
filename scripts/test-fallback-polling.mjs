import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)

function loadSource(path, mocks) {
  const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8')
  const exports = {}
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    {
      exports,
      window: { __TAURI_INTERNALS__: {} },
      require: (name) => mocks[name] ?? require(name),
    },
  )
  return exports
}

const status = {
  mappingId: 'port-1',
  primaryNode: 'primary',
  fallbackNode: 'backup',
  primaryLatency: 42,
  fallbackLatency: 43,
  isFallbackActive: false,
}

function createStore(api) {
  const { createPortSlice } = loadSource('../src/stores/portSlice.ts', {
    '../services/tauri': api,
  })
  let state
  let onChange = () => {}
  const set = (update) => {
    state = {
      ...state,
      ...(typeof update === 'function' ? update(state) : update),
    }
    onChange()
  }
  state = {
    ...createPortSlice(set, () => state),
    portMappings: [
      {
        id: 'port-1',
        enabled: true,
        profileId: 'profile-1',
        nodeName: 'primary',
        fallbackNodeName: 'backup',
        latency: 42,
      },
    ],
    profiles: [{ id: 'profile-1', name: 'profile' }],
    latencies: { '[profile] primary': 42, '[profile] backup': 43 },
  }
  return {
    get: () => state,
    set,
    subscribe: (listener) => {
      onChange = listener
    },
  }
}

// Run the production Effect callback and dependency expression with controlled
// timers and React's Object.is dependency comparison.
function mountPolling(store) {
  const source = ts.createSourceFile(
    'PortTableView.tsx',
    fs.readFileSync(
      new URL('../src/components/views/PortTableView.tsx', import.meta.url),
      'utf8',
    ),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  let effect
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === 'useEffect' &&
      /setInterval|setTimeout/.test(node.arguments[0].getText(source)) &&
      node.arguments[0].getText(source).includes('fetchFallbackStatuses')
    ) {
      effect = node
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(effect, 'Production polling Effect must be exercised')
  const callback = ts.transpileModule(
    `const callback = ${effect.arguments[0].getText(source)}`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText
  const timers = new Map()
  let nextTimer = 0
  let previousDeps
  let cleanup
  let dirty = true
  let running = true
  store.subscribe(() => {
    dirty = true
  })
  function render() {
    dirty = false
    const state = store.get()
    const setTimer = (fn, delay) => {
      assert.equal(delay, 5000)
      timers.set(++nextTimer, fn)
      return nextTimer
    }
    const context = vm.createContext({
      isRunning: running,
      hasFallback: state.portMappings.some(
        (mapping) => mapping.enabled && mapping.fallbackNodeName,
      ),
      isWindowVisible: true,
      portMappings: state.portMappings,
      fetchFallbackStatuses: state.fetchFallbackStatuses,
      setInterval: setTimer,
      setTimeout: setTimer,
      clearInterval: (id) => timers.delete(id),
      clearTimeout: (id) => timers.delete(id),
    })
    context.window = context
    const deps = vm.runInContext(effect.arguments[1].getText(source), context)
    if (previousDeps?.every((value, index) => Object.is(value, deps[index]))) {
      return
    }
    cleanup?.()
    previousDeps = deps
    cleanup = vm.runInContext(`${callback}\ncallback()`, context)
  }
  return {
    async settle() {
      for (let i = 0; i < 25; i++) {
        if (dirty) render()
        await new Promise(setImmediate)
        if (!dirty) return
      }
      assert.fail('Polling must settle between scheduled refreshes')
    },
    tick() {
      const pending = [...timers.values()]
      timers.clear()
      for (const fn of pending) fn()
    },
    stop() {
      running = false
      dirty = true
    },
    unmount() {
      cleanup?.()
    },
    timers,
  }
}

test('status polling waits between refreshes as latency changes', async () => {
  let requests = 0
  const store = createStore({
    getPortFallbackStatuses: async () => {
      requests++
      return [{ ...status, primaryLatency: 42 + requests }]
    },
  })
  const polling = mountPolling(store)
  try {
    await polling.settle()
    assert.equal(requests, 1)
    polling.tick()
    await polling.settle()
    assert.equal(requests, 2)
    polling.stop()
    await polling.settle()
    assert.equal(polling.timers.size, 0)
  } finally {
    polling.unmount()
  }
})

test('equal latency responses preserve mapping and latency references', async () => {
  const store = createStore({ getPortFallbackStatuses: async () => [status] })
  const before = store.get()
  await before.fetchFallbackStatuses()
  assert.equal(store.get().portMappings, before.portMappings)
  assert.equal(store.get().latencies, before.latencies)
})

test('a slow status request completes before scheduling another refresh', async () => {
  let finish
  let requests = 0
  const store = createStore({
    getPortFallbackStatuses: () => {
      requests++
      return new Promise((resolve) => {
        finish = resolve
      })
    },
  })
  const polling = mountPolling(store)
  try {
    await polling.settle()
    assert.equal(polling.timers.size, 0)
    polling.tick()
    assert.equal(requests, 1)
    polling.unmount()
    finish([status])
    await new Promise(setImmediate)
    assert.equal(polling.timers.size, 0)
  } finally {
    polling.unmount()
  }
})

test('IPC callers share the active status request and can retry failures', async () => {
  let requests = 0
  let finish
  let fail
  const api = loadSource('../src/services/tauri.ts', {
    '@tauri-apps/api/core': {
      invoke: (command) => {
        assert.equal(command, 'get_port_fallback_statuses')
        requests++
        return new Promise((resolve, reject) => {
          finish = resolve
          fail = reject
        })
      },
    },
    '../constants': { APP_VERSION: 'test' },
  })
  const first = api.getPortFallbackStatuses()
  const second = api.getPortFallbackStatuses()
  assert.equal(requests, 1)
  finish([status])
  assert.equal(await first, await second)
  const failed = api.getPortFallbackStatuses()
  fail(new Error('Controller unavailable'))
  await assert.rejects(failed, /Controller unavailable/)
  const retry = api.getPortFallbackStatuses()
  assert.equal(requests, 3)
  finish([status])
  assert.equal((await retry)[0], status)
})
