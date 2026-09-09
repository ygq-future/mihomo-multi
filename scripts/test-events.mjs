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
      console,
      require: (name) => mocks[name] ?? require(name),
    },
  )
  return exports
}

test('createEventScope registers and unregisters listeners properly', async () => {
  let unlistenCount = 0
  const mockListen = async (event, cb) => {
    return () => {
      unlistenCount++
    }
  }

  const { createEventScope } = loadSource('../src/services/events.ts', {
    '@tauri-apps/api/event': {
      listen: mockListen,
    },
  })

  const scope = createEventScope()
  assert.equal(scope.isDisposed(), false)

  await scope.listen('test-event-1', () => {})
  await scope.listen('test-event-2', () => {})
  assert.equal(unlistenCount, 0)

  scope.dispose()
  assert.equal(scope.isDisposed(), true)
  assert.equal(unlistenCount, 2)

  // Disposing again should be idempotent
  scope.dispose()
  assert.equal(unlistenCount, 2)

  // Registering after disposal should be a no-op
  await scope.listen('test-event-3', () => {})
  assert.equal(unlistenCount, 2)
})

test('createEventScope handles unlisten when scope disposes before listen promise resolves', async () => {
  let unlistenCalled = false
  let resolvePromise
  const delayedListen = () =>
    new Promise((resolve) => {
      resolvePromise = () =>
        resolve(() => {
          unlistenCalled = true
        })
    })

  const { createEventScope } = loadSource('../src/services/events.ts', {
    '@tauri-apps/api/event': {
      listen: delayedListen,
    },
  })

  const scope = createEventScope()
  const listenPromise = scope.listen('delayed-event', () => {})

  // Dispose before listen resolves
  scope.dispose()
  assert.equal(scope.isDisposed(), true)
  assert.equal(unlistenCalled, false)

  // Now the Tauri listen resolves
  resolvePromise()
  await listenPromise

  // Should have immediately invoked unlisten to prevent leaking
  assert.equal(unlistenCalled, true)
})
