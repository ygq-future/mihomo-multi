import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const source = ts.transpileModule(
  readFileSync(new URL('../src/i18n/index.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText

function setup(language, saved) {
  let currentLanguage = language
  let stored = saved
  let onLanguageChange
  const document = { documentElement: { lang: '' } }
  const modules = {
    react: { useCallback: (callback) => callback },
    zustand: require('zustand'),
    './locales/en-US': { enUS: {} },
    './locales/zh-CN': { zhCN: {} },
  }
  const module = { exports: {} }
  vm.runInNewContext(source, {
    exports: module.exports,
    require: (name) => modules[name],
    navigator: {
      get language() {
        return currentLanguage
      },
    },
    localStorage: {
      getItem: () => stored ?? null,
      setItem: (_key, value) => {
        stored = value
      },
    },
    window: {
      addEventListener: (_event, handler) => {
        onLanguageChange = handler
      },
    },
    document,
    Intl,
  })
  return {
    store: module.exports.useI18nStore,
    document,
    changeLanguage(value) {
      currentLanguage = value
      onLanguageChange()
    },
    get stored() {
      return stored
    },
  }
}

test('defaults to system language with English fallback', () => {
  for (const [system, expected] of [
    ['zh-CN', 'zh-CN'],
    ['zh-Hans-SG', 'zh-CN'],
    ['en-GB', 'en-US'],
    ['ja-JP', 'en-US'],
    ['zh-TW', 'en-US'],
  ]) {
    const { store, document } = setup(system)
    assert.equal(store.getState().localePreference, 'system')
    assert.equal(store.getState().locale, expected)
    assert.equal(document.documentElement.lang, expected)
  }
})

test('preserves explicit preferences and follows system changes only in system mode', () => {
  const app = setup('zh-CN', 'en-US')
  assert.equal(app.store.getState().locale, 'en-US')
  app.changeLanguage('zh-CN')
  assert.equal(app.store.getState().locale, 'en-US')
  app.store.getState().setLocale('system')
  assert.equal(app.stored, 'system')
  assert.equal(app.store.getState().locale, 'zh-CN')
  app.changeLanguage('fr-FR')
  assert.equal(app.store.getState().locale, 'en-US')
  assert.equal(app.document.documentElement.lang, 'en-US')
  app.store.getState().setLocale('zh-CN')
  app.changeLanguage('ja-JP')
  assert.equal(app.store.getState().locale, 'zh-CN')
})
