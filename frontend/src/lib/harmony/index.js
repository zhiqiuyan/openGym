// The Harmony entry point: puts the Capacitor-shaped globals in place before the app runs.
//
// Why it has to happen this early: lib/platform-now.js reads globalThis.Capacitor synchronously
// on the very first render (Settings → Apple Watch used to be sent back to the root by a route
// that only learned the platform later). So the window object has to be in place before the
// app's own script runs, not after the first import.

import { installBridgeGlobals, hasNativeBridge } from './bridge.js'
import { Capacitor, registerPlugin, CapacitorHttp } from './core.js'
import * as plugins from './plugins.js'

/**
 * Install the globals. Safe to call more than once.
 * @returns {boolean} whether a native shell was found
 */
export function installHarmony() {
  installBridgeGlobals()
  if (typeof window === 'undefined') return false

  const native = hasNativeBridge()
  if (!native) return false

  // The global Capacitor object. The app reads it synchronously (platform-now.js) and the
  // dynamic imports of '@capacitor/core' resolve to the same values through the Vite alias.
  window.Capacitor = Capacitor

  // A few plugins are looked up on the global rather than imported — the Capacitor runtime
  // puts every registered plugin there under its own name.
  const globals = {
    SecureStorage: plugins.SecureStorage,
    Filesystem: plugins.Filesystem,
    LocalNotifications: plugins.LocalNotifications,
    App: plugins.App,
    Share: plugins.Share,
    SplashScreen: plugins.SplashScreen,
    BarcodeScanner: plugins.BarcodeScanner,
    GymReminder: plugins.GymReminder,
    Channel: plugins.Channel
  }
  for (const [name, value] of Object.entries(globals)) {
    if (!window[name]) window[name] = value
  }

  // The real platform, for the native side and for anything that asks.
  window.__ogNative = { platform: 'harmony', bridge: 'JSBridgeHandle' }

  return true
}

export { Capacitor, registerPlugin, CapacitorHttp, hasNativeBridge }
export default installHarmony
