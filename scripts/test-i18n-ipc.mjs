import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)

function loadApi(invoke) {
  const source = fs.readFileSync(
    new URL('../src/services/tauri.ts', import.meta.url),
    'utf8',
  )
  const exports = {}
  const mocks = {
    '@tauri-apps/api/core': { invoke },
    '../constants': { APP_VERSION: 'test' },
    '../i18n': { t: (key) => key },
  }
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      exports,
      window: { __TAURI_INTERNALS__: {} },
      require: (name) => mocks[name] ?? require(name),
    },
  )
  return exports
}

test('locale changes reach the backend in request order', async () => {
  const pending = []
  const api = loadApi((command, args) => {
    assert.equal(command, 'set_ui_locale')
    return new Promise((resolve) =>
      pending.push({ locale: args.locale, resolve }),
    )
  })
  const first = api.setUiLocale('zh-CN')
  const second = api.setUiLocale('en-US')
  await new Promise(setImmediate)
  assert.deepEqual(
    pending.map((request) => request.locale),
    ['zh-CN'],
  )
  pending[0].resolve()
  await first
  await new Promise(setImmediate)
  assert.deepEqual(
    pending.map((request) => request.locale),
    ['zh-CN', 'en-US'],
  )
  pending[1].resolve()
  await second
})

test('structured core errors retain message and machine-readable code', async () => {
  const api = loadApi(async () => {
    throw { code: 'CORE_NOT_RUNNING', message: 'Core is not running' }
  })
  await assert.rejects(api.testNodeDelay('node'), (error) => {
    assert.equal(error.message, 'Core is not running')
    assert.equal(api.isCoreNotRunningError(error), true)
    return true
  })
})
