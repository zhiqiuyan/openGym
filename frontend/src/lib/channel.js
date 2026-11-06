// Where this copy of the app came from, which decides who installs its updates:
//   'sideload' the APK from GitHub or opengym.ch: it checks GitHub and installs updates itself
//   'play'     Google Play, which updates it (and does not allow an app to update itself)
//   'fdroid'   F-Droid, which builds it from source and updates it. Nothing from Google Play
//              services in it: no Wear OS link, and the check-in scanner is the browser's
//   'appstore' the iPhone app, updated by the App Store
//   'harmony'  the HarmonyOS edition: its own version line and its own distribution
//   'web'      the browser, updated with its server
// Android says which build it is (ChannelPlugin.java, the build flavour). An APK from before the
// plugin existed is a sideloaded one: the Play build never shipped without it.
//
// The Harmony bridge deliberately reports itself as 'android' (lib/harmony/core.js) so the
// phone-only features keep running. That must not decide who updates the app: a Harmony build
// is not an APK, has no system package installer and cannot use the GitHub releases feed.
import { MOBILE } from './mobile.js'

const HARMONY = import.meta.env.VITE_HARMONY === '1'

// The Android answer also says whether this build may ask for background location: a Play build
// made with -PplayWithoutBackgroundLocation (app/build.gradle, Google Play's plan B) can't, so it
// has no gym reminder. Every other build (and an older APK that doesn't say) has one.
let infoP = null
function channelInfo() {
  return infoP || (infoP = (async () => {
    if (!MOBILE) return { channel: 'web', gymReminder: false }
    // The HarmonyOS HAP has no APK updater, no Play/F-Droid flavour and no background-location
    // permission story. Decide here, before the Capacitor shim can answer 'android'.
    if (HARMONY) return { channel: 'harmony', gymReminder: false }
    const { Capacitor, registerPlugin } = await import('@capacitor/core')
    const platform = Capacitor.getPlatform()
    if (platform === 'ios') return { channel: 'appstore', gymReminder: true }
    if (platform !== 'android') return { channel: 'web', gymReminder: false }
    try {
      const r = await registerPlugin('Channel').get()
      const channel = r?.channel === 'play' || r?.channel === 'fdroid' ? r.channel : 'sideload'
      return { channel, gymReminder: r?.backgroundLocation !== false }
    } catch {
      return { channel: 'sideload', gymReminder: true }
    }
  })().catch(() => ({ channel: 'web', gymReminder: false })))
}

export async function getChannel() {
  return (await channelInfo()).channel
}

/** Whether this phone build can offer the gym reminder (it needs background location). */
export async function gymReminderBuilt() {
  return (await channelInfo()).gymReminder
}

// The in-app updater is for the sideloaded APK only.
export async function selfUpdates() {
  return (await getChannel()) === 'sideload'
}

/** Whether the native (ML Kit) barcode scanner is in this build. The F-Droid build leaves it out
 *  (closed source) and scans with the WebView's camera, like the browser (lib/scan.js). */
export async function nativeScanner() {
  if (!MOBILE) return false
  return (await getChannel()) !== 'fdroid'
}

