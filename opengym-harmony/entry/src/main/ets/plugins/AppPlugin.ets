/*
 * App — the app itself: its state, the back gesture and leaving.
 *
 * The contract on the page side:
 *   getState()  -> { isActive: boolean }
 *   exitApp()   -> void
 *   addListener('backButton', cb)      the hardware back
 *   addListener('appStateChange', cb)  foreground / background
 *
 * The back gesture is the interesting one. On Harmony the page runs inside the Web component,
 * so the system back gesture arrives here first: the page is asked whether it can handle it
 * (it can, when its own router has somewhere to go), and only then does the app step back
 * through the WebView's own history. Index.ets does that part.
 */

import common from '@ohos.app.ability.common';
import { PluginHandler } from '../common/PluginHandler';
import { EventHolder } from '../common/EventHolder';
import { Json } from '../common/Json';

export class AppPlugin extends PluginHandler {
  /** The bridge back to the page, for the events the page subscribed to. */
  private emitter: EventHolder | null = null;
  private active: boolean = true;

  setEmitter(emitter: EventHolder): void {
    this.emitter = emitter;
  }

  async invoke(method: string, _payload: string): Promise<string> {
    switch (method) {
      case 'getState':
        return Json.build(['"isActive":' + String(this.active)]);
      case 'exitApp':
        this.exit();
        return '{}';
      default:
        return Json.build(['"__error":' + Json.str(String(`App: unknown method ${method}`))]);
    }
  }

  /** The app went to the background or came back to the front. */
  setActive(active: boolean): void {
    this.active = active;
    if (this.emitter) {
      this.emitter.emit('App.appStateChange', Json.build(['"isActive":' + String(active)]));
    }
  }

  /** The back gesture arrived; the page decides whether it handles it. */
  fireBackButton(): void {
    if (this.emitter) {
      this.emitter.emit('App.backButton', '{}');
    }
  }

  /** Leave the app. */
  private exit(): void {
    try {
      const context = getContext() as common.UIAbilityContext;
      context.terminateSelf();
    } catch (e) {
      console.error('[App] exit failed');
    }
  }
}
