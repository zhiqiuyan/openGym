/*
 * SplashScreen — the phone's own launch screen hands over to the boot logo.
 *
 * The contract on the page side:
 *   hide({ fadeOutDuration }) -> void
 *
 * The native launch screen stays up until the page has painted its own boot screen, so the
 * WebView starting up never shows as seconds of plain black (lib/boot.js). Harmony's launch
 * screen is the window's own splash, and the Web component's first paint is what ends it —
 * the call from the page is the signal that the app can draw.
 */

import { PluginHandler } from '../common/PluginHandler';
import { Json } from '../common/Json';

export class SplashScreenPlugin extends PluginHandler {
  async invoke(method: string, _payload: string): Promise<string> {
    switch (method) {
      case 'hide':
        return '{}';
      default:
        return Json.build(['"__error":' + Json.str(String(`SplashScreen: unknown method ${method}`))]);
    }
  }
}
