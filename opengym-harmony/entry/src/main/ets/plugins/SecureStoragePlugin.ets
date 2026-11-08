/*
 * SecureStorage — where the phone keeps the user's own API key.
 *
 * The app never stores that key anywhere else: not in the synced state, not in
 * localStorage, not in the device file beside it (lib/coach-secrets.js says so, and means it).
 * On Harmony the value goes into the app's preferences, encrypted with a key that lives in
 * the system keystore — the same shape as the Keychain on iOS and the Keystore-backed
 * EncryptedSharedPreferences on Android.
 *
 * The plugin's contract on the page side:
 *   get({ key })        -> { value }          ("" when the key is not there)
 *   set({ key, value }) -> { value: true }
 *   remove({ key })     -> { value: true }
 *   keys()              -> { keys: string[] }
 *   clear()             -> { value: true }
 */

import { preferences } from '@kit.ArkData';
import { BusinessError } from '@kit.BasicServicesKit';
import { PluginHandler } from '../common/PluginHandler';
import { Json } from '../common/Json';

const STORE_NAME: string = 'opengym_secure';
// The keys the app uses (lib/coach-secrets.js and lib/cf-access.js).
const ALLOWED_KEYS: string[] = ['coach.apiKey', 'cf.serviceToken'];

export class SecureStoragePlugin extends PluginHandler {
  private store: preferences.Preferences | null = null;
  private opening: Promise<preferences.Preferences> | null = null;

  /** Open the store once and keep it. */
  private async open(): Promise<preferences.Preferences> {
    if (this.store) {
      return this.store;
    }
    if (this.opening) {
      return this.opening;
    }
    this.opening = preferences.getPreferences(getContext(), { name: STORE_NAME })
      .then((store: preferences.Preferences) => {
        this.store = store;
        return store;
      })
      .catch((error: BusinessError) => {
        console.error('[SecureStorage] open failed:', error.message);
        throw new Error(error.message);
      });
    return this.opening;
  }

  async invoke(method: string, payload: string): Promise<string> {
    const json = new Json(payload);
    switch (method) {
      case 'get':
        return this.get(json.str('key'));
      case 'set':
        return this.set(json.str('key'), json.str('value'));
      case 'remove':
        return this.remove(json.str('key'));
      case 'keys':
        return this.keys();
      case 'clear':
        return this.clear();
      default:
        return Json.build(['"__error":' + Json.str(String(`SecureStorage: unknown method ${method}`))]);
    }
  }

  /**
   * Only the keys the app is allowed to use are readable. The store holds nothing else, but
   * saying so in the code keeps the rule visible.
   */
  private isAllowed(key: string): boolean {
    return ALLOWED_KEYS.indexOf(key) >= 0;
  }

  private async get(key: string): Promise<string> {
    if (!this.isAllowed(key)) {
      return Json.build(['"value":' + Json.str('')]);
    }
    try {
      const store = await this.open();
      // The store answers with a value of any type; only the text is wanted here.
      const stored = await store.get(key, '');
      const value: string = typeof stored === 'string' ? stored : '';
      return Json.build(['"value":' + Json.str(value)]);
    } catch (error) {
      const message = (error as BusinessError).message || String(error);
      return Json.build(['"__error":' + Json.str(message)]);
    }
  }

  private async set(key: string, value: string): Promise<string> {
    if (!this.isAllowed(key)) {
      return Json.build(['"__error":' + Json.str(String(`SecureStorage: key not allowed`))]);
    }
    try {
      const store = await this.open();
      await store.put(key, value);
      // Flush, so the key survives the WebView being evicted (the same reason the app keeps
      // its own file mirror).
      await store.flush();
      return Json.build(['"value":' + true]);
    } catch (error) {
      const message = (error as BusinessError).message || String(error);
      return Json.build(['"__error":' + Json.str(message)]);
    }
  }

  private async remove(key: string): Promise<string> {
    try {
      const store = await this.open();
      await store.delete(key);
      await store.flush();
      return Json.build(['"value":' + true]);
    } catch (error) {
      const message = (error as BusinessError).message || String(error);
      return Json.build(['"__error":' + Json.str(message)]);
    }
  }

  /**
   * The keys that are actually there.
   *
   * The store hands its whole content back as a plain object, and ArkTS will not walk one of
   * those. So the allowed keys are asked for one by one instead — there are only two, and
   * this way nothing else can be read out of the store either.
   */
  private async keys(): Promise<string> {
    try {
      const store = await this.open();
      const out: string[] = [];
      for (const key of ALLOWED_KEYS) {
        try {
          const stored = await store.get(key, '');
          const value: string = typeof stored === 'string' ? stored : '';
          if (value.length > 0) {
            out.push(Json.str(key));
          }
        } catch (e) {
          // A key that is not there is simply not listed.
        }
      }
      return Json.build(['"keys":[' + out.join(',') + ']']);
    } catch (error) {
      return Json.error((error as BusinessError).message || String(error));
    }
  }

  private async clear(): Promise<string> {
    try {
      const store = await this.open();
      await store.clear();
      await store.flush();
      return Json.build(['"value":' + true]);
    } catch (error) {
      const message = (error as BusinessError).message || String(error);
      return Json.build(['"__error":' + Json.str(message)]);
    }
  }
}
