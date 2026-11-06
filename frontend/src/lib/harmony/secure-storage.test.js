// The Harmony SecureStorage shim has to look exactly like @aparajita/capacitor-secure-storage
// to the app: positional arguments, get() resolving with a bare string (or null). The native
// side wants { key, value } and answers { value }. If the shim ever goes back to forwarding
// its first argument verbatim, the Coach saves its API key and then reports
// "no API key configured for <provider>" on the very next call. This test is that regression.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = new Map()
const calls = []
const ALLOWED = ['coach.apiKey', 'cf.serviceToken']

vi.mock('./bridge.js', () => ({
  nativeCall: (plugin, method, payload) => {
    calls.push({ plugin, method, payload })
    if (plugin !== 'SecureStorage') return Promise.reject(new Error(`unexpected plugin ${plugin}`))
    switch (method) {
      case 'get': return Promise.resolve({ value: store.get(payload.key) || '' })
      case 'set':
        // The real native plugin refuses anything outside its whitelist, and answers with an
        // error rather than writing a blank value when the payload carried no `value`.
        if (!ALLOWED.includes(payload.key)) return Promise.reject(new Error('SecureStorage: key not allowed'))
        if (typeof payload.value !== 'string') return Promise.reject(new Error('SecureStorage: missing value'))
        store.set(payload.key, payload.value)
        return Promise.resolve({ value: true })
      case 'remove': store.delete(payload.key); return Promise.resolve({ value: true })
      case 'clear': store.clear(); return Promise.resolve({ value: true })
      case 'keys': return Promise.resolve({ keys: Array.from(store.keys()) })
      default: return Promise.reject(new Error(`unknown method ${method}`))
    }
  },
  addNativeListener: () => ({ remove: () => {} }),
  hasNativeBridge: () => true,
  installBridgeGlobals: () => {},
  removeAllNativeListeners: () => {},
  pendingCount: () => 0
}))

// coach-secrets.js imports the real plugin dynamically; on a Harmony build Vite aliases it to
// ./plugins.js. Do the same here so the whole save → read chain is under test.
vi.mock('@aparajita/capacitor-secure-storage', async () => {
  const p = await import('./plugins.js')
  return { SecureStorage: p.SecureStorage }
})

const { SecureStorage } = await import('./plugins.js')
const secrets = await import('../coach-secrets.js')

beforeEach(() => {
  store.clear()
  calls.length = 0
})

describe('Harmony SecureStorage shim', () => {
  it('translates positional set(key, value) into the native { key, value } payload', async () => {
    await SecureStorage.set('coach.apiKey', 'sk-deepseek-123')
    expect(calls).toEqual([{
      plugin: 'SecureStorage', method: 'set',
      payload: { key: 'coach.apiKey', value: 'sk-deepseek-123' }
    }])
    expect(store.get('coach.apiKey')).toBe('sk-deepseek-123')
  })

  it('unpacks the native { value } answer into the bare string the app expects', async () => {
    store.set('coach.apiKey', 'sk-deepseek-123')
    expect(await SecureStorage.get('coach.apiKey')).toBe('sk-deepseek-123')
    expect(calls[0].payload).toEqual({ key: 'coach.apiKey' })
  })

  it('answers null (not "" or an object) when the key is absent', async () => {
    expect(await SecureStorage.get('coach.apiKey')).toBe(null)
  })

  it('keeps an API key through the real coach-secrets save → read chain', async () => {
    await secrets.setApiKey('sk-deepseek-456')
    expect(store.get('coach.apiKey')).toBe('sk-deepseek-456')
    expect(await secrets.getApiKey()).toBe('sk-deepseek-456')
    await secrets.clearApiKey()
    expect(await secrets.getApiKey()).toBe(null)
  })

  it('maps the Cloudflare Access key onto the native whitelist name', async () => {
    await secrets.secureSet('cfAccess', '{"clientId":"a"}')
    expect(calls[0].payload).toEqual({ key: 'cf.serviceToken', value: '{"clientId":"a"}' })
    expect(await secrets.secureGet('cfAccess')).toBe('{"clientId":"a"}')
  })
})
