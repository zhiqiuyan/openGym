// The plugin shims the Harmony build exposes under the Capacitor names.
//
// Each one is the shape the app expects, so lib/*.js needs no changes at all: the same
// `import('@capacitor/filesystem')` resolves here and answers the same way.
//
// The method lists below are not guesses — they are the calls the app actually makes:
//
//   SecureStorage      get / set / remove / keys / clear          (@aparajita/…)
//   Filesystem         readFile writeFile appendFile deleteFile readdir
//                      stat rename downloadFile getUri             (@capacitor/filesystem)
//   LocalNotifications schedule cancel requestPermissions
//                      checkPermissions addListener                (@capacitor/local-notifications)
//   App                addListener exitApp getState                (@capacitor/app)
//   Share              share                                      (@capacitor/share)
//   SplashScreen       hide                                       (@capacitor/splash-screen)
//   BarcodeScanner     scan readBarcodesFromImage isSupported
//                      checkPermissions requestPermissions         (@capacitor-mlkit/…)
//   GymReminder        get configure server status permission
//                      requestForeground requestBackground
//                      currentPosition addListener                (the project's own plugin)
//   Channel            get                                         (the project's own plugin)
//
// GymReminder is the Android path for the gym reminder: the app calls it instead of
// LocalNotifications on Android (lib/gym-reminder.js), because it carries the config, the
// server it is paired with and the nudge check with it.

import { Capacitor, registerPlugin, CapacitorHttp } from './core.js'
import { nativeCall, addNativeListener, hasNativeBridge } from './bridge.js'

export { Capacitor, registerPlugin, CapacitorHttp }

// ---------------------------------------------------------------------------
// SecureStorage — where the phone keeps the user's own API key.
//
// The app never stores it anywhere else: not in the synced state, not in localStorage, not in
// the device file next to it (lib/coach-secrets.js). On Harmony the native side keeps it in the
// app's preferences; this shim only forwards.
//
// Unlike every other Capacitor plugin, @aparajita/capacitor-secure-storage does NOT take a
// single options object. Its contract (and the one lib/coach-secrets.js and lib/cf-access.js
// actually call) is positional, and get() resolves with the bare value:
//
//   get(key)         -> string | null
//   set(key, value)  -> void
//   remove(key)      -> void
//   clear()          -> void
//   keys()           -> { keys: string[] }
//
// The native side, on the other hand, wants { key } / { key, value } and answers get() with
// { value: "" } when nothing is stored. Forwarding the first argument verbatim used to send a
// bare key string as the whole payload: the native set() had no value and refused the key,
// and get() resolved with an object that coach-secrets.js reads as "no key". The setup screen
// then said "The Coach is on" while every job failed with "no API key configured for …" —
// the key never survived past the in-memory fallback. Translate both directions here.
// ---------------------------------------------------------------------------

// The native whitelist names the Cloudflare Access entry `cf.serviceToken` while
// lib/cf-access.js asks for `cfAccess`. Keep the two sides talking without loosening the
// native whitelist (which deliberately allows only the two secrets the app uses).
const nativeKey = key => (key === 'cfAccess' ? 'cf.serviceToken' : String(key || ''))

// { value: "" } means absent; the plugin answers null, and coach-secrets.js checks for a
// non-empty string. Accept a bare string too, in case a native build answers that way.
const bareValue = r => {
  if (typeof r === 'string') return r || null
  if (r && typeof r === 'object' && typeof r.value === 'string') return r.value || null
  return null
}

const SecureStorage = {
  get: (key) => nativeCall('SecureStorage', 'get', { key: nativeKey(key) }).then(bareValue),
  set: (key, value) => nativeCall('SecureStorage', 'set', { key: nativeKey(key), value: String(value ?? '') }).then(() => undefined),
  remove: (key) => nativeCall('SecureStorage', 'remove', { key: nativeKey(key) }).then(() => undefined),
  clear: () => nativeCall('SecureStorage', 'clear', {}).then(() => undefined),
  keys: () => nativeCall('SecureStorage', 'keys', {}).then(r => (r && Array.isArray(r.keys) ? r : { keys: [] })),
  // The app's lazy import awaits the module; a `then` on the plugin object would make it look
  // like a thenable. Leave it explicitly undefined (core.js documents why).
  then: undefined
}

// ---------------------------------------------------------------------------
// Filesystem — the phone's private data directory.
//
// The app writes its state mirror there (opengym-state.json) and reads health exports from
// it. `directory` is Capacitor's Directory enum; the native side maps it onto the sandbox.
// ---------------------------------------------------------------------------

export const Directory = {
  Documents: 'DOCUMENTS',
  Data: 'DATA',
  Cache: 'CACHE',
  External: 'EXTERNAL',
  Library: 'LIBRARY',
  LibraryNoCloud: 'LIBRARY_NO_CLOUD'
}

export const Encoding = {
  UTF8: 'utf8',
  ASCII: 'ascii',
  UTF16: 'utf16',
  Base64: 'base64',
  Binary: 'binary'
}

const Filesystem = {
  readFile: (opts) => nativeCall('Filesystem', 'readFile', opts),
  writeFile: (opts) => nativeCall('Filesystem', 'writeFile', opts),
  appendFile: (opts) => nativeCall('Filesystem', 'appendFile', opts),
  deleteFile: (opts) => nativeCall('Filesystem', 'deleteFile', opts),
  readdir: (opts) => nativeCall('Filesystem', 'readdir', opts),
  stat: (opts) => nativeCall('Filesystem', 'stat', opts),
  rename: (opts) => nativeCall('Filesystem', 'rename', opts),
  copyFile: (opts) => nativeCall('Filesystem', 'copyFile', opts),
  mkdir: (opts) => nativeCall('Filesystem', 'mkdir', opts),
  rmdir: (opts) => nativeCall('Filesystem', 'rmdir', opts),
  getUri: (opts) => nativeCall('Filesystem', 'getUri', opts),
  downloadFile: (opts) => nativeCall('Filesystem', 'downloadFile', opts),
  addListener: (event, cb) => addNativeListener(`Filesystem.${event}`, cb)
}

// ---------------------------------------------------------------------------
// LocalNotifications
// ---------------------------------------------------------------------------

const LocalNotifications = {
  schedule: (opts) => nativeCall('LocalNotifications', 'schedule', opts),
  cancel: (opts) => nativeCall('LocalNotifications', 'cancel', opts),
  cancelAll: (opts) => nativeCall('LocalNotifications', 'cancelAll', opts),
  getPending: (opts) => nativeCall('LocalNotifications', 'getPending', opts),
  requestPermissions: (opts) => nativeCall('LocalNotifications', 'requestPermissions', opts),
  checkPermissions: (opts) => nativeCall('LocalNotifications', 'checkPermissions', opts),
  createChannel: (opts) => nativeCall('LocalNotifications', 'createChannel', opts),
  addListener: (event, cb) => addNativeListener(`LocalNotifications.${event}`, cb)
}

// ---------------------------------------------------------------------------
// App — the back button, the app state and leaving.
//
// The back gesture is the one that matters: on Harmony the page gets its own back navigation,
// and the app has to be able to step the WebView back before the page closes (Index.ets asks
// the controller whether it can go back).
// ---------------------------------------------------------------------------

const App = {
  getState: (opts) => nativeCall('App', 'getState', opts),
  exitApp: (opts) => nativeCall('App', 'exitApp', opts),
  addListener: (event, cb) => addNativeListener(`App.${event}`, cb)
}

// ---------------------------------------------------------------------------
// Share
// ---------------------------------------------------------------------------

const Share = {
  share: (opts) => nativeCall('Share', 'share', opts)
}

// ---------------------------------------------------------------------------
// SplashScreen — the phone's own launch screen hands over to the boot logo (lib/boot.js).
// ---------------------------------------------------------------------------

const SplashScreen = {
  hide: (opts) => nativeCall('SplashScreen', 'hide', opts)
}

// ---------------------------------------------------------------------------
// BarcodeScanner — MLKit on Android; on Harmony the system scanner does the job.
// ---------------------------------------------------------------------------

const BarcodeScanner = {
  scan: (opts) => nativeCall('BarcodeScanner', 'scan', opts),
  readBarcodesFromImage: (opts) => nativeCall('BarcodeScanner', 'readBarcodesFromImage', opts),
  isSupported: (opts) => nativeCall('BarcodeScanner', 'isSupported', opts),
  checkPermissions: (opts) => nativeCall('BarcodeScanner', 'checkPermissions', opts),
  requestPermissions: (opts) => nativeCall('BarcodeScanner', 'requestPermissions', opts),
  // The MLKit install helpers have no meaning on Harmony — the system scanner is always there.
  // They answer "available" so the app does not sit waiting for a module that will never be
  // downloaded.
  installGoogleBarcodeScannerModule: () => Promise.resolve({ installed: true }),
  isGoogleBarcodeScannerModuleAvailable: () => Promise.resolve({ available: true })
}

// ---------------------------------------------------------------------------
// GymReminder — the project's own plugin, the Android path of the gym reminder.
//
// It carries more than a notification: the config (which gyms, which hours), the server the
// phone is paired with and the headers it uses, and how today stands, so the phone can ask the
// server whether the training already happened on another device.
//
//   get()                  -> { config, permission }
//   configure({ config })   -> { watching, permission }
//   server({ server, headers }) -> void
//   status(status)         -> void
//   permission()           -> { location, background, notifications }
//   requestForeground()     -> void      (permission for the foreground location)
//   requestBackground()     -> void
//   currentPosition()       -> { lat, lng, accuracy }
//   addListener('open', cb) -> handle
// ---------------------------------------------------------------------------

const GymReminder = {
  get: (opts) => nativeCall('GymReminder', 'get', opts),
  configure: (opts) => nativeCall('GymReminder', 'configure', opts),
  server: (opts) => nativeCall('GymReminder', 'server', opts),
  status: (opts) => nativeCall('GymReminder', 'status', opts),
  permission: (opts) => nativeCall('GymReminder', 'permission', opts),
  requestForeground: (opts) => nativeCall('GymReminder', 'requestForeground', opts),
  requestBackground: (opts) => nativeCall('GymReminder', 'requestBackground', opts),
  currentPosition: (opts) => nativeCall('GymReminder', 'currentPosition', opts),
  addListener: (event, cb) => addNativeListener(`GymReminder.${event}`, cb)
}

// ---------------------------------------------------------------------------
// Channel — where this copy of the app came from, which decides who updates it.
// Harmony has no in-app updater (the app store does it), so this always answers 'sideload'
// and lib/channel.js turns that into "the phone checks for updates itself" — the Harmony
// build ships no updater, so the harmless branch is the one that does nothing.
// ---------------------------------------------------------------------------

const Channel = {
  get: (opts) => nativeCall('Channel', 'get', opts)
}

// ---------------------------------------------------------------------------
// The rest of the project's own plugins. On Harmony they have no counterpart, but the app
// asks for them by name and expects a proxy that never settles is the one thing that must not
// happen — a rejected promise is fine, the app catches it. These answer with a clear
// "not supported here" so the feature turns itself off instead of hanging.
// ---------------------------------------------------------------------------

const UNSUPPORTED = (name) => new Proxy({}, {
  get(_t, prop) {
    if (typeof prop !== 'string') return undefined
    if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined
    if (prop === 'addListener') return () => ({ remove: () => {} })
    return () => Promise.reject(new Error(`${name} is not available on HarmonyOS`))
  }
})

export const AnimationPacks = UNSUPPORTED('AnimationPacks')
export const AppIcon = UNSUPPORTED('AppIcon')
export const BackupFolder = UNSUPPORTED('BackupFolder')
export const BarIcons = UNSUPPORTED('BarIcons')
export const DeviceAuth = UNSUPPORTED('DeviceAuth')
export const Install = UNSUPPORTED('Install')
export const LiveActivity = UNSUPPORTED('LiveActivity')
export const NudgeCheck = UNSUPPORTED('NudgeCheck')
export const Print = UNSUPPORTED('Print')
export const RestAlert = UNSUPPORTED('RestAlert')
export const WatchBridge = UNSUPPORTED('WatchBridge')
export const WidgetBridge = UNSUPPORTED('WidgetBridge')
export const HealthConnect = UNSUPPORTED('HealthConnect')
export const AppleHealth = UNSUPPORTED('AppleHealth')

export {
  SecureStorage, Filesystem, LocalNotifications, App, Share, SplashScreen,
  BarcodeScanner, GymReminder, Channel
}

export { hasNativeBridge }
