// Where this copy of the app came from, which decides who installs its updates:
//   'sideload' the APK from GitHub or opengym.ch: it checks GitHub and installs updates itself
//   'play'     Google Play, which updates it (and does not allow an app to update itself)
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

let channelP = null
export function getChannel() {
  return channelP || (channelP = (async () => {
    if (!MOBILE) return 'web'
    if (HARMONY) return 'harmony'
    const { Capacitor, registerPlugin } = await import('@capacitor/core')
    const platform = Capacitor.getPlatform()
    if (platform === 'ios') return 'appstore'
    if (platform !== 'android') return 'web'
    try {
      const { channel } = await registerPlugin('Channel').get()
      return channel === 'play' ? 'play' : 'sideload'
    } catch {
      return 'sideload'
    }
  })().catch(() => 'web'))
}

// The in-app updater is for the sideloaded APK only.
export async function selfUpdates() {
  return (await getChannel()) === 'sideload'
}

