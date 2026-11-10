import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const DEFAULTS = [
  'localhost',
  '127.0.0.1',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
]

function loadSource(path) {
  const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8')
  const exports = {}
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    { exports },
  )
  return exports
}

test('buildTerminalNoProxy keeps built-in bypass entries when no custom list exists', () => {
  const { buildTerminalNoProxy } = loadSource('../src/utils/envProxy.ts')

  assert.equal(buildTerminalNoProxy().split(',').join('|'), DEFAULTS.join('|'))
  assert.equal(
    buildTerminalNoProxy([]).split(',').join('|'),
    DEFAULTS.join('|'),
  )
})

test('buildTerminalNoProxy appends custom entries after the built-in ones', () => {
  const { buildTerminalNoProxy } = loadSource('../src/utils/envProxy.ts')

  const output = buildTerminalNoProxy(['*.sheepyu.top', '119.29.106.76'])

  assert.deepEqual(JSON.parse(JSON.stringify(output.split(','))), [
    ...DEFAULTS,
    '*.sheepyu.top',
    '119.29.106.76',
  ])
})

test('buildTerminalNoProxy drops blanks, <local>, and case-insensitive duplicates', () => {
  const { buildTerminalNoProxy } = loadSource('../src/utils/envProxy.ts')

  const input = ['', '  ', '<local>', 'LOCALHOST', '  LocalHost  ', 'my.lan']
  const output = buildTerminalNoProxy(input)

  assert.deepEqual(JSON.parse(JSON.stringify(output.split(','))), [
    ...DEFAULTS,
    'my.lan',
  ])
  assert.deepEqual(JSON.parse(JSON.stringify(input)), [
    '',
    '  ',
    '<local>',
    'LOCALHOST',
    '  LocalHost  ',
    'my.lan',
  ])
})
