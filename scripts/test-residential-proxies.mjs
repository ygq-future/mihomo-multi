import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))

function createStore(api) {
  const modules = new Map()
  const apiPath = path.join(sourceRoot, 'services', 'tauri.ts')
  const load = (file) => {
    if (file === apiPath) return api
    if (modules.has(file)) return modules.get(file).exports
    const module = { exports: {} }
    modules.set(file, module)
    const source = fs.readFileSync(file, 'utf8')
    vm.runInNewContext(
      ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS },
      }).outputText,
      {
        exports: module.exports,
        module,
        console,
        setTimeout,
        clearTimeout,
        require: (specifier) => {
          if (!specifier.startsWith('.')) return require(specifier)
          const base = path.resolve(path.dirname(file), specifier)
          const resolved = [
            base,
            `${base}.ts`,
            path.join(base, 'index.ts'),
          ].find(
            (candidate) =>
              fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
          )
          assert.ok(resolved, `unresolved source import: ${specifier}`)
          return load(resolved)
        },
      },
      { filename: file },
    )
    return module.exports
  }
  return load(path.join(sourceRoot, 'stores', 'appStore.ts')).useAppStore
}

const exit = {
  id: 'residential-1',
  name: 'Residential exit',
  protocol: 'socks5',
  server: '127.0.0.1',
  port: 1080,
  username: 'test-user',
  password: 'test-password',
}

const plain = (value) => JSON.parse(JSON.stringify(value))

test('residential edits publish accepted state only after persistence succeeds', async () => {
  let completeSave
  let persisted
  const store = createStore({
    isDesktopEnvironment: () => true,
    saveConfig: (config) => {
      persisted = config
      return new Promise((resolve) => {
        completeSave = resolve
      })
    },
  })
  const before = { theme: 'system', controllerPort: 9090 }
  store.setState({ config: before })
  const pending = store.getState().saveResidentialProxy(exit)
  assert.equal(store.getState().config, before)
  assert.equal(persisted.controllerPort, 9090)
  assert.deepEqual(plain(persisted.residentialProxies), [exit])
  completeSave()
  await pending
  assert.deepEqual(plain(store.getState().config.residentialProxies), [exit])

  const updated = { ...exit, name: 'Edited exit', port: 1081 }
  const editing = store.getState().saveResidentialProxy(updated)
  assert.equal(store.getState().config.residentialProxies[0].port, 1080)
  completeSave()
  await editing
  assert.deepEqual(plain(store.getState().config.residentialProxies), [updated])
})

test('failed residential saves preserve the accepted configuration', async () => {
  const store = createStore({
    isDesktopEnvironment: () => true,
    saveConfig: async () => {
      throw new Error('Configuration write failed')
    },
  })
  const before = { theme: 'system', residentialProxies: [exit] }
  store.setState({ config: before })
  await assert.rejects(
    store
      .getState()
      .saveResidentialProxy({ ...exit, password: 'changed-password' }),
    /Configuration write failed/,
  )
  assert.equal(store.getState().config, before)
  assert.equal(
    store.getState().config.residentialProxies[0].password,
    'test-password',
  )
})

test('disabled port references prevent residential exit deletion', async () => {
  let saves = 0
  const store = createStore({
    isDesktopEnvironment: () => true,
    saveConfig: async () => {
      saves++
    },
  })
  store.setState({
    config: { theme: 'system', residentialProxies: [exit] },
    portMappings: [
      {
        id: 'mapping-1',
        port: 21001,
        enabled: false,
        residentialProxyId: exit.id,
      },
    ],
  })
  await assert.rejects(
    store.getState().deleteResidentialProxy(exit.id),
    /21001/,
  )
  assert.equal(saves, 0)
  store.setState({ portMappings: [] })
  await store.getState().deleteResidentialProxy(exit.id)
  assert.deepEqual(plain(store.getState().config.residentialProxies), [])
  assert.equal(saves, 1)
})

test('chain latency remains isolated when ports share an upstream node', () => {
  const store = createStore({})
  store.setState({
    portMappings: [
      {
        id: 'chain-a',
        port: 21001,
        nodeName: 'Upstream A',
        residentialProxyId: 'exit-a',
        latency: 80,
      },
      {
        id: 'chain-b',
        port: 21002,
        nodeName: 'Upstream A',
        residentialProxyId: 'exit-b',
        latency: 90,
      },
      { id: 'ordinary', port: 21003, nodeName: 'Upstream A', latency: 20 },
    ],
  })
  store.getState().handleLatencyUpdate({
    name: 'Upstream A',
    latency: 25,
    completed: 1,
    total: 1,
  })
  assert.deepEqual(
    plain(store.getState().portMappings.map((mapping) => mapping.latency)),
    [80, 90, 25],
  )
  store.getState().handleLatencyUpdate({
    name: 'chain-21001',
    mappingId: 'chain-a',
    latency: 120,
    completed: 1,
    total: 1,
  })
  assert.deepEqual(
    plain(store.getState().portMappings.map((mapping) => mapping.latency)),
    [120, 90, 25],
  )
})

test('residential endpoint edits clear displayed exit and latency measurements', async () => {
  const store = createStore({
    isDesktopEnvironment: () => true,
    saveConfig: async () => {},
  })
  store.setState({
    config: { residentialProxies: [exit] },
    portMappings: [
      { id: 'chain-a', port: 21001, residentialProxyId: exit.id, latency: 80 },
    ],
    portEgressIps: { 21001: { ip: '192.0.2.10' } },
  })
  await store
    .getState()
    .saveResidentialProxy({ ...exit, server: 'exit.example.com' })
  assert.equal(store.getState().portMappings[0].latency, undefined)
  assert.deepEqual(plain(store.getState().portEgressIps), {})
})

test('saving a chain mapping invalidates the previous measured exit', async () => {
  const mapping = { id: 'chain-a', port: 21001, residentialProxyId: 'exit-b' }
  const store = createStore({
    savePortMapping: async () => mapping,
    getDriftReports: async () => [],
    getOccupiedPorts: async () => [],
    getPortFallbackStatuses: async () => [],
  })
  store.setState({
    portMappings: [{ ...mapping, residentialProxyId: 'exit-a' }],
    portEgressIps: { 21001: { ip: '192.0.2.10' } },
  })
  await store.getState().savePortMapping(mapping)
  assert.deepEqual(plain(store.getState().portEgressIps), {})
  assert.equal(store.getState().portMappings[0].residentialProxyId, 'exit-b')
})

test('a probe finishing after a chain change cannot publish its previous exit IP', async () => {
  let completeProbe
  const store = createStore({
    queryPortEgressInfo: () =>
      new Promise((resolve) => {
        completeProbe = resolve
      }),
  })
  const mapping = {
    id: 'chain-a',
    port: 21001,
    protocol: 'mixed',
    nodeName: 'Upstream A',
    residentialProxyId: exit.id,
  }
  store.setState({
    config: { residentialProxies: [exit] },
    portMappings: [mapping],
  })
  const pending = store.getState().probePortEgressIp(21001, 'mixed')
  store.setState({ portMappings: [{ ...mapping, nodeName: 'Upstream B' }] })
  completeProbe({ ip: '192.0.2.10' })
  await assert.rejects(pending, /链路配置已变化/)
  assert.deepEqual(plain(store.getState().portEgressIps), {})
  assert.equal(store.getState().probingPortEgress[21001], undefined)
})
