#!/usr/bin/env node
/*
 * test-bridge.mjs — run the front-end bridge against a stand-in for the native side.
 *
 * The static check can only look at the code. This runs it: a fake JSBridgeHandle answers the
 * way the ArkTS side does (a ticket, a method, a payload; the answer comes back later through
 * window.__ogResolve), and the front-end shim is loaded into a DOM and put through the calls
 * the app actually makes.
 *
 * It catches the failures that a static read cannot: a promise that never settles, a method
 * that answers the wrong shape, a listener that never fires, the thenable trap that hangs a
 * whole feature.
 *
 *   node tools/test-bridge.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const FRONTEND = path.resolve(process.env.FRONTEND || path.join(ROOT, '..', 'openGym', 'frontend'))

const failures = []
const checks = []
const check = (name, ok, detail = '') => {
  checks.push(name)
  if (!ok) failures.push(`${name}${detail ? ' —— ' + detail : ''}`)
}

// ---------------------------------------------------------------------------
// A window, and the native side behind it
// ---------------------------------------------------------------------------
const listeners = {}
const calls = []

// The native side answers the way HarmonyBridge does: the call carries a ticket, and the
// answer arrives later through __ogResolve. A real answer comes from a microtask here.
globalThis.window = globalThis
globalThis.window.__ogResolve = undefined
globalThis.window.__ogEmit = undefined

// The stand-in for the ArkTS side.
const native = {
  handlers: new Map(),
  register(name, handler) { this.handlers.set(name, handler) },
  // This is what JavaScriptProxy.call() does on the native side.
  call(ticket, method, payload) {
    calls.push({ ticket, method, payload })
    const dot = method.indexOf('.')
    const plugin = dot > 0 ? method.substring(0, dot) : method
    const fn = dot > 0 ? method.substring(dot + 1) : ''
    const handler = this.handlers.get(plugin)
    setTimeout(async () => {
      let answer
      try {
        const result = handler
          ? await handler(fn, JSON.parse(payload || '{}'))
          : { __error: `no such plugin: ${plugin}` }
        answer = result === undefined ? {} : result
      } catch (e) {
        answer = { __error: String(e && e.message ? e.message : e) }
      }
      globalThis.window.__ogResolve(ticket, answer)
    }, 0)
    return ticket
  }
}
globalThis.window.JSBridgeHandle = { call: native.call.bind(native) }

// ---------------------------------------------------------------------------
// Load the front-end shim.
//
// The three files import each other. Loading them as separate modules would give each one
// its own copy of bridge.js — the ticket a call writes in one copy would not be found in
// the other, and every call would time out. The browser has one module instance per URL;
// here the three are read and joined into one module, which is the same thing.
//
//   bridge.js  -> the transport
//   core.js    -> the Capacitor core surface, uses the transport
//   plugins.js -> the plugin shims, use the transport and the core
// ---------------------------------------------------------------------------
function stripModuleSyntax(source) {
  // The names the file exports, collected before the syntax is stripped: after it, the
  // `export` keyword is gone and there is nothing left to look for.
  const listed = []
  const declared = []
  const listedRe = /^export\s*\{([^}]*)\}\s*;?\s*$/gm
  const declaredRe = /^export\s+(?:const|let|function|class|async function)\s+(\w+)/gm
  let lm
  while ((lm = listedRe.exec(source)) !== null) {
    lm[1].split(',')
      .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
      .filter((s) => s.length > 0)
      .forEach((n) => listed.push(n))
  }
  let dm
  while ((dm = declaredRe.exec(source)) !== null) declared.push(dm[1])

  let out = source
    // The imports between the three files: everything ends up in one scope.
    .replace(/^\s*import\s+\{[^}]*\}\s+from\s+'[^']*'\s*;?\s*$/gm, '')
    .replace(/^\s*import\s+\{[^}]*\}\s+from\s+'[^']*'\s*$/gm, '')
    // export const / export function / export class -> plain declarations
    .replace(/^export\s+(const|let|function|class|async function)\s/gm, '$1 ')
    // export { a, b } at the end of a file -> nothing (the names were collected above)
    .replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, '')
    // export default X -> a named const, so the test can reach it
    .replace(/^export\s+default\s+/gm, 'const __default = ')
  return { code: out, listed, declared }
}

async function loadShim(files) {
  const parts = files.map((f) => stripModuleSyntax(fs.readFileSync(f, 'utf8')))
  const source = parts.map((p) => p.code).join('\n\n')
  const exported = new Set([...parts.flatMap((p) => p.listed), ...parts.flatMap((p) => p.declared)])
  for (const name of ['nativeCall', 'addNativeListener', 'installBridgeGlobals', 'pendingCount',
    'registerPlugin', 'hasNativeBridge']) {
    if (new RegExp(`\\b(const|function|class)\\s+${name}\\b`).test(source)) exported.add(name)
  }
  const combined = source + `\nexport { ${Array.from(exported).join(', ')} }\n`
  const url = 'data:text/javascript;base64,' + Buffer.from(combined, 'utf8').toString('base64')
  return import(url)
}

const shim = await loadShim([
  path.join(FRONTEND, 'src/lib/harmony/bridge.js'),
  path.join(FRONTEND, 'src/lib/harmony/core.js'),
  path.join(FRONTEND, 'src/lib/harmony/plugins.js')
])
const bridge = shim
const core = shim
const plugins = shim

// ---------------------------------------------------------------------------
// The native side's plugins — the same contract the ArkTS plugins answer.
// ---------------------------------------------------------------------------
native.register('SecureStorage', (method, p) => {
  const store = new Map()
  if (method === 'get') return { value: store.get(p.key) || '' }
  if (method === 'set') { store.set(p.key, p.value); return { value: true } }
  return { __error: 'unknown' }
})
native.register('Filesystem', (method, p) => {
  if (method === 'readFile') return { data: '{"ok":true}' }
  if (method === 'writeFile') return { uri: 'file:///data/opengym-state.json' }
  return { __error: 'unknown' }
})
native.register('LocalNotifications', (method) => {
  if (method === 'schedule') return { notifications: [{ id: 1 }] }
  if (method === 'checkPermissions') return { display: 'granted' }
  return { __error: 'unknown' }
})
native.register('App', (method) => {
  if (method === 'getState') return { isActive: true }
  return { __error: 'unknown' }
})
native.register('Share', () => ({ activityType: 'string' }))
native.register('SplashScreen', () => ({}))
native.register('BarcodeScanner', (method) => {
  if (method === 'scan') return { barcodes: [{ rawValue: 'https://gym.example', value: 'https://gym.example', format: 'QR_CODE' }] }
  return { __error: 'unknown' }
})
native.register('GymReminder', (method) => {
  if (method === 'get') return { config: { on: true, gyms: [], window: null }, permission: { location: 'granted' } }
  if (method === 'configure') return { watching: 0, permission: { location: 'granted' } }
  if (method === 'currentPosition') return { lat: 36.07, lng: 120.38, accuracy: 12 }
  return { __error: 'unknown' }
})
native.register('Channel', () => ({ channel: 'sideload' }))
native.register('CapacitorHttp', (method, p) => {
  if (method === 'request') return { status: 200, headers: {}, data: '{"ok":true}' }
  return { __error: 'unknown' }
})
native.register('Capacitor', (method, p) => {
  if (method === 'convertFileSrc') return { url: 'file://' + (p.path || '') }
  return { __error: 'unknown' }
})

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------
console.log('='.repeat(72))
console.log('  桥接运行时测试')
console.log('='.repeat(72))

bridge.installBridgeGlobals()
check('桥接全局已安装', typeof globalThis.window.__ogResolve === 'function')
check('emit 全局已安装', typeof globalThis.window.__ogEmit === 'function')

// A plain call settles.
{
  const res = await bridge.nativeCall('Filesystem', 'readFile', { path: 'x.json' })
  check('普通调用返回数据', res && res.data === '{"ok":true}', JSON.stringify(res))
}

// A call to a plugin that does not exist rejects rather than hanging.
{
  let settled = false
  try {
    await bridge.nativeCall('NoSuchPlugin', 'call', {})
    settled = true
  } catch (e) {
    settled = true
    check('未知插件会 reject（不静默挂起）', /no such plugin/.test(e.message), e.message)
  }
  check('未知插件的 promise 一定会 settle', settled)
}

// The plugin proxy answers a method.
{
  const Filesystem = plugins.Filesystem
  const r = await Filesystem.readFile({ path: 'a.json', directory: 'DATA' })
  check('shim 的 Filesystem.readFile 走通了', r && r.data === '{"ok":true}', JSON.stringify(r))
}

// The thenable trap: a promise carrying the proxy must not hang.
{
  const SecureStorage = plugins.SecureStorage
  let settled = false
  const p = Promise.resolve(SecureStorage).then((v) => { settled = true; return v })
  const raced = await Promise.race([
    p.then(() => 'settled'),
    new Promise((r) => setTimeout(() => r('timeout'), 200))
  ])
  check('proxy 被 promise 包住时不会挂起（#42 那个坑）', raced === 'settled', `结果 ${raced}`)
  check('proxy 的 then 不存在', SecureStorage.then === undefined)
}

// The registered proxy from core.js must behave the same.
{
  const proxy = core.registerPlugin('Filesystem')
  check('registerPlugin 的 proxy 不响应 then', proxy.then === undefined)
  const r = await proxy.readFile({ path: 'b.json' })
  check('registerPlugin 的 proxy 调用走通了', r && r.data === '{"ok":true}', JSON.stringify(r))
}

// addListener receives an event from the native side.
{
  let got = null
  const handle = plugins.GymReminder.addListener('open', (payload) => { got = payload })
  globalThis.window.__ogEmit('GymReminder.open', { ok: true })
  check('原生事件送达监听器', got && got.ok === true, JSON.stringify(got))
  handle.remove()
  globalThis.window.__ogEmit('GymReminder.open', { ok: false })
  check('remove() 之后不再收到事件', got && got.ok === true, JSON.stringify(got))
}

// The Capacitor core answers what the app reads synchronously.
{
  check('getPlatform 返回 android', core.Capacitor.getPlatform() === 'android')
  check('isNativePlatform 为真', core.Capacitor.isNativePlatform() === true)
  const uri = await core.Capacitor.convertFileSrc('/data/x.mp4')
  check('convertFileSrc 给出可加载的 URL', typeof uri === 'string' && uri.startsWith('file://'), String(uri))
}

// The native HTTP path — the one the Coach needs to escape the WebView's origin.
{
  const res = await core.CapacitorHttp.request({ url: 'https://api.example/v1', method: 'POST' })
  check('CapacitorHttp 走原生通道', res && res.status === 200 && res.ok === true, JSON.stringify(res))
}

// The gym reminder, the plugin the Android path of the reminder uses.
{
  const g = plugins.GymReminder
  const got = await g.get()
  check('GymReminder.get 给出配置与权限',
    got && got.config && got.permission, JSON.stringify(got))
  const conf = await g.configure({ config: { on: true, gyms: [], window: null } })
  check('GymReminder.configure 给出 watching', conf && conf.watching === 0, JSON.stringify(conf))
  const pos = await g.currentPosition()
  check('GymReminder.currentPosition 给出坐标',
    pos && typeof pos.lat === 'number' && typeof pos.lng === 'number', JSON.stringify(pos))
}

// The unsupported plugins must reject, never hang.
{
  let rejected = false
  try {
    await plugins.WatchBridge.connect()
  } catch (e) {
    rejected = /not available on HarmonyOS/.test(e.message)
  }
  check('不支持的插件会明确 reject', rejected)
}

// The call record: everything went through the one door.
check('所有调用都经过 JSBridgeHandle', calls.length > 0 && calls.every((c) => !!c.ticket))
check('没有遗留未 settle 的调用', bridge.pendingCount() === 0, `剩余 ${bridge.pendingCount()}`)

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(72))
if (failures.length) {
  console.log(`  测试未通过：${failures.length} / ${checks.length} 项失败`)
  failures.forEach((f) => console.log(`    ✗ ${f}`))
  console.log('='.repeat(72))
  process.exit(1)
}
console.log(`  全部通过：${checks.length} 项检查`)
console.log('='.repeat(72))
