// The Capacitor core surface, reimplemented on the Harmony bridge.
//
// Everything the app imports from '@capacitor/core' has to exist here with the same shape:
//   Capacitor.getPlatform() / isNativePlatform() / convertFileSrc() / getPlatforms()
//   registerPlugin(name)      -> a plugin proxy
//   CapacitorHttp.request()   -> the native HTTP path
//
// The plugin proxy answers EVERY property name with a native method — `then` included. That is
// the bug lib/coach-secrets.js works around (#42): a promise resolved with the bare proxy takes
// it for a thenable, calls proxy.then() on the native side, and never settles — the Coach's
// "save and use" button stayed greyed out forever. The proxy below leaves `then` undefined, so
// a promise carrying it resolves normally.

import { nativeCall, addNativeListener, hasNativeBridge } from './bridge.js'

// The Harmony shell answers to 'android' on purpose. The app's own platform checks are a strict
// two-way split — `p === 'ios' || p === 'android' ? p : null` in lib/mobile.js and
// lib/platform-now.js — so a third value would silently drop the phone build down to the web
// one: no local reminders, no secure storage, no file mirror. Android is the closer of the two
// to the Harmony shell (a WebView app with a native plugin layer), so the existing Android
// branches are the ones that should run. The real platform is available to the native side
// through window.__ogNative.platform and to the shims below.
const PLATFORM = 'android'

export const Capacitor = {
  getPlatform: () => PLATFORM,
  getPlatforms: () => ({ android: PLATFORM }),
  isNativePlatform: () => hasNativeBridge(),
  isPluginAvailable: (name) => hasNativeBridge(),

  /**
   * Turns a native file path into something the page can load.
   * Capacitor hands back a capacitor:// URL; here the native side owns the sandbox and answers
   * with a file:// URL into the app's own files directory.
   */
  convertFileSrc: (path) => nativeCall('Capacitor', 'convertFileSrc', { path }).then((r) => {
    if (typeof r === 'string') return r
    return r && r.url ? r.url : path
  }),

  // The app never touches these, but a Capacitor-shaped object should carry them.
  getServerUrl: () => nativeCall('Capacitor', 'getServerUrl').catch(() => undefined)
}

/**
 * A plugin proxy: any property is a native method, every call returns a Promise.
 *
 * `then` is deliberately left undefined. See the note at the top of the file — this is the
 * difference between a working native plugin and a feature that never answers.
 */
export function registerPlugin(name) {
  const cache = new Map()
  return new Proxy({}, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined
      // A promise that carries the proxy must not be mistaken for a thenable.
      if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined
      if (prop === 'addListener') {
        return (event, cb) => addNativeListener(`${name}.${event}`, cb)
      }
      if (prop === 'removeAllListeners') {
        return (event) => addNativeListener(`${name}.${event}`, () => {}) && undefined
      }
      if (!cache.has(prop)) {
        cache.set(prop, (opts) => nativeCall(name, prop, opts))
      }
      return cache.get(prop)
    }
  })
}

/**
 * The native HTTP path.
 *
 * The Coach's provider calls cannot go through the WebView: its origin is the local page, and a
 * provider with no CORS story for that origin refuses the preflight before a byte goes out.
 * lib/capacitor-fetch.js reaches for CapacitorHttp for exactly that reason, so the Harmony
 * build has to offer the same door. The native side does the request, where CORS does not exist.
 *
 * Only the subset lib/capacitor-fetch.js uses is implemented: method, headers, a JSON body and
 * a response with ok/status/text()/json().
 */
export const CapacitorHttp = {
  async request(options) {
    const opts = options || {}
    const res = await nativeCall('CapacitorHttp', 'request', {
      url: opts.url,
      method: opts.method || 'GET',
      headers: opts.headers || {},
      data: opts.data === undefined ? null : opts.data,
      responseType: opts.responseType || 'text',
      connectTimeout: opts.connectTimeout,
      readTimeout: opts.readTimeout
    })
    const body = res && res.data !== undefined ? res.data : ''
    const text = typeof body === 'string' ? body : body === null ? '' : JSON.stringify(body)
    return {
      status: res ? res.status : 0,
      headers: (res && res.headers) || {},
      data: body,
      ok: !!res && res.status >= 200 && res.status < 300
    }
  },

  async get(options) { return CapacitorHttp.request({ ...options, method: 'GET' }) },
  async post(options) { return CapacitorHttp.request({ ...options, method: 'POST' }) },
  async put(options) { return CapacitorHttp.request({ ...options, method: 'PUT' }) },
  async delete(options) { return CapacitorHttp.request({ ...options, method: 'DELETE' }) }
}

export default { Capacitor, registerPlugin, CapacitorHttp }
