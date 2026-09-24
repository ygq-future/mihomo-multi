import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

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

test('sortBypassItems sorts localhost, domains, IPv4, and <local> stably', () => {
  const { sortBypassItems } = loadSource('../src/utils/bypassSort.ts')

  const input = [
    '<local>',
    '192.168.*',
    '*.sheepyu.top',
    '172.17.*',
    '119.29.106.76',
    'api.sheepyu.top',
    '172.16.*',
    '10.*',
    'sheepyu.top',
    'localhost',
    'baidu.com',
  ]

  const output = sortBypassItems(input)

  assert.deepEqual(JSON.parse(JSON.stringify(output)), [
    'localhost',
    'baidu.com',
    'sheepyu.top',
    '*.sheepyu.top',
    'api.sheepyu.top',
    '10.*',
    '119.29.106.76',
    '172.16.*',
    '172.17.*',
    '192.168.*',
    '<local>',
  ])
})
