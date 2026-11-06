// HarmonyOS bridge — the transport under every Capacitor-compatible call.
//
// The ArkWeb side registers one proxy method (`JSBridgeHandle.call`) and the native side answers
// through `runJavaScript`. registerJavaScriptProxy is void-typed: the native side cannot hand a
// value back to the caller directly, so every call gets a ticket and the answer arrives later
// through window.__ogResolve. That is what makes Capacitor's Promise-shaped plugin API work
// unchanged on top of it.
//
// Events travel the other way: the native side calls window.__ogEmit(name, payload) for the
// listeners a plugin's addListener() subscribed to.

const BRIDGE_NAME = 'JSBridgeHandle'

// Ticket -> { resolve, reject }. A call that never answers must not hang the UI forever, so
// every ticket carries a deadline; a native call that overruns it rejects instead of pending
// silently (the same reason lib/coach-secrets.js wraps its calls in a timeout).
const DEFAULT_TIMEOUT_MS = 15000

let seq = 0
const pending = new Map()

// event name -> Set of listeners. addListener() hands back a handle whose remove() takes the
// listener out again, the way Capacitor's own listeners do.
const listeners = new Map()

function nowId() {
  seq += 1
  return `og${Date.now().toString(36)}_${seq}`
}

function nativeProxy() {
  return (typeof window !== 'undefined' && window[BRIDGE_NAME]) || null
}

/** Is the native shell actually there? The web build never has it. */
export function hasNativeBridge() {
  return !!nativeProxy()
}

/**
 * One call into the native side.
 *
 * @param {string} method  plugin name, e.g. 'Filesystem'
 * @param {string} call    method on that plugin, e.g. 'readFile'
 * @param {object} [opts]  the options object, passed as JSON
 * @returns {Promise<any>} whatever the native side answered
 */
export function nativeCall(method, call, opts) {
  const proxy = nativeProxy()
  if (!proxy || typeof proxy.call !== 'function') {
    return Promise.reject(new Error(`Harmony bridge unavailable (${method}.${call})`))
  }
  return new Promise((resolve, reject) => {
    const id = nowId()
    const timer = setTimeout(() => {
      if (!pending.has(id)) return
      pending.delete(id)
      reject(new Error(`Harmony bridge timeout: ${method}.${call}`))
    }, DEFAULT_TIMEOUT_MS)

    pending.set(id, {
      method,
      call,
      resolve: (v) => { clearTimeout(timer); resolve(v) },
      reject: (e) => { clearTimeout(timer); reject(e) }
    })

    let params
    try {
      params = JSON.stringify(opts === undefined ? {} : opts)
    } catch (e) {
      clearTimeout(timer)
      pending.delete(id)
      reject(new Error(`Harmony bridge payload is not serialisable: ${e && e.message}`))
      return
    }

    try {
      // The native side reads method.call from the ticket it hands back, so the method name
      // travels in the id map, not in the wire payload.
      proxy.call(id, `${method}.${call}`, params)
    } catch (e) {
      clearTimeout(timer)
      pending.delete(id)
      reject(e)
    }
  })
}

/**
 * Subscribe to a native event. Returns a handle with remove(), like Capacitor's listeners.
 * @param {string} event
 * @param {(payload:any)=>void} cb
 */
export function addNativeListener(event, cb) {
  if (!listeners.has(event)) listeners.set(event, new Set())
  listeners.get(event).add(cb)
  return {
    remove: () => {
      const set = listeners.get(event)
      if (set) set.delete(cb)
    }
  }
}

/** Remove every listener of an event (used when the native side resets the page). */
export function removeAllNativeListeners(event) {
  if (event) listeners.delete(event)
  else listeners.clear()
}

/**
 * Install the two entry points the native side calls. Called once, before the app's own
 * scripts run — lib/platform-now.js reads globalThis.Capacitor synchronously on the very first
 * render, so the window object has to be in place by then.
 */
export function installBridgeGlobals() {
  if (typeof window === 'undefined') return
  if (window.__ogResolve) return

  window.__ogResolve = (id, payload) => {
    const ticket = pending.get(id)
    if (!ticket) return
    pending.delete(id)
    if (!payload) { ticket.resolve(undefined); return }
    if (payload.__error) { ticket.reject(new Error(payload.__error)); return }
    ticket.resolve(payload.__value === undefined ? payload : payload.__value)
  }

  window.__ogEmit = (event, payload) => {
    const set = listeners.get(event)
    if (!set) return
    for (const cb of Array.from(set)) {
      try { cb(payload) } catch (e) { console.error('[harmony] listener failed', event, e) }
    }
  }
}

/** Number of calls still waiting for an answer — used by the verification script. */
export function pendingCount() {
  return pending.size
}
