/*
 * GymReminder — the project's own plugin, and the Android path of the gym reminder.
 *
 * lib/gym-reminder.js asks the native side for more than a notification:
 *
 *   get()                      -> { config, permission }
 *   configure({ config })      -> { watching, permission }
 *   server({ server, headers }) -> void    the server this phone is paired with
 *   status(status)             -> void    how today stands
 *   permission()               -> { location, background, notifications }
 *   requestForeground()        -> void
 *   requestBackground()        -> void
 *   currentPosition()          -> { lat, lng, accuracy }
 *   addListener('open', cb)    -> handle
 *
 * The config is what the user set in Settings:
 *   { on: boolean, gyms: [{ id, lat, lng, radius, name }], window: { from, to } }
 * and the status is what the profile says about today:
 *   { trainedOn, quietOn, activeSince, title, body, channel, scan }
 *
 * On Harmony the reminder is scheduled through the notification plugin, the config is kept in
 * the app's preferences (it outlives the WebView's storage), and the location comes from the
 * system's geo location service.
 */

import { preferences } from '@kit.ArkData';
import { geoLocationManager } from '@kit.LocationKit';
import { notificationManager } from '@kit.NotificationKit';
import { abilityAccessCtrl } from '@kit.AbilityKit';
import common from '@ohos.app.ability.common';
import { BusinessError } from '@kit.BasicServicesKit';
import { PluginHandler } from '../common/PluginHandler';
import { EventHolder } from '../common/EventHolder';
import { Json } from '../common/Json';

const STORE_NAME: string = 'opengym_gym_reminder';
const CONFIG_KEY: string = 'config';
const SERVER_KEY: string = 'server';
const STATUS_KEY: string = 'status';

export class GymReminderPlugin extends PluginHandler {
  private store: preferences.Preferences | null = null;
  private opening: Promise<preferences.Preferences> | null = null;

  /** The bridge back to the page, for the 'open' event a tapped notification raises. */
  private emitter: EventHolder | null = null;

  setEmitter(emitter: EventHolder): void {
    this.emitter = emitter;
  }

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
        console.error('[GymReminder] open failed:', error.message);
        throw new Error(error.message);
      });
    return this.opening;
  }

  async invoke(method: string, payload: string): Promise<string> {
    const json = new Json(payload);
    switch (method) {
      case 'get':
        return this.get();
      case 'configure':
        return this.configure(json.raw('config'));
      case 'server':
        return this.saveServer(json);
      case 'status':
        return this.saveStatus(json);
      case 'permission':
        return this.permission();
      case 'requestForeground':
        return this.requestForeground();
      case 'requestBackground':
        return this.requestBackground();
      case 'currentPosition':
        return this.currentPosition();
      default:
        return Json.error('GymReminder: unknown method ' + method);
    }
  }

  /** The config the native side holds, plus what the permissions say. */
  private async get(): Promise<string> {
    try {
      const store = await this.open();
      // The store answers with a value of any type; only the text is wanted here.
      const stored = await store.get(CONFIG_KEY, '');
      const raw: string = typeof stored === 'string' ? stored : '';
      const config: string = raw.length > 0 ? raw : '{"on":false,"gyms":[],"window":null}';
      const perm = await this.permission();
      return Json.build([
        '"config":' + config,
        '"permission":' + perm
      ]);
    } catch (error) {
      return Json.error((error as BusinessError).message || String(error));
    }
  }

  /**
   * Save the config and arm the reminder.
   *
   * "Arming" here means: keep the config, and let the notification plugin put the next
   * reminder in place. The exact moment comes from the window the user set (from/to, local
   * time, wrapping over midnight) and from whether today is already trained or excused.
   */
  private async configure(config: string | undefined): Promise<string> {
    try {
      const store = await this.open();
      const text: string = config ? config : '{"on":false,"gyms":[],"window":null}';
      await store.put(CONFIG_KEY, text);
      await store.flush();

      // How many regions the phone would watch. The app shows this number next to the switch.
      let watching = 0;
      if (config) {
        watching = new Json(config).arrLen('gyms');
      }
      const perm = await this.permission();
      return Json.build([
        '"watching":' + String(watching),
        '"permission":' + perm
      ]);
    } catch (error) {
      return Json.error((error as BusinessError).message || String(error));
    }
  }

  /** The server this phone is paired with, and the headers a request to it carries. */
  private async saveServer(json: Json): Promise<string> {
    try {
      const store = await this.open();
      const server: string = json.str('server', '');
      const headers: string = json.raw('headers') ?? '{}';
      await store.put(SERVER_KEY, Json.build([
        '"server":' + Json.str(server),
        '"headers":' + headers
      ]));
      await store.flush();
      return '{}';
    } catch (error) {
      return Json.error((error as BusinessError).message || String(error));
    }
  }

  /** How today stands: the last day trained, an excuse for today, a running session. */
  private async saveStatus(json: Json): Promise<string> {
    try {
      const store = await this.open();
      const status: string = Json.build([
        '"trainedOn":' + Json.str(json.str('trainedOn', '')),
        '"quietOn":' + Json.str(json.str('quietOn', '')),
        '"activeSince":' + String(json.num('activeSince', 0)),
        '"title":' + Json.str(json.str('title', '')),
        '"body":' + Json.str(json.str('body', '')),
        '"channel":' + Json.str(json.str('channel', '')),
        '"scan":' + Json.str(json.str('scan', ''))
      ]);
      await store.put(STATUS_KEY, status);
      await store.flush();
      return '{}';
    } catch (error) {
      return Json.error((error as BusinessError).message || String(error));
    }
  }

  /**
   * What the permissions say.
   *
   *   { location: 'granted'|'denied'|'prompt', background: ..., notifications: ... }
   *
   * The location part is what the "I'm at the gym now" feature needs; the background part is
   * the always-on permission, which Harmony does not hand out the way Android does — it has
   * one location permission, so both answers read the same way.
   */
  private async permission(): Promise<string> {
    const location = await this.locationState();
    let notifications = 'prompt';
    try {
      const enabled = await notificationManager.isNotificationEnabled();
      notifications = enabled ? 'granted' : 'denied';
    } catch (e) {
      notifications = 'prompt';
    }
    return Json.build([
      '"location":' + Json.str(location),
      '"background":' + Json.str(location),
      '"notifications":' + Json.str(notifications)
    ]);
  }

  /** Whether the location service is on. */
  private async locationState(): Promise<string> {
    try {
      const enabled = geoLocationManager.isLocationEnabled();
      return enabled ? 'granted' : 'prompt';
    } catch (e) {
      return 'prompt';
    }
  }

  /** Ask for the foreground location permission. */
  private async requestForeground(): Promise<string> {
    return this.askForLocation();
  }

  /**
   * Ask for the always-on permission.
   *
   * Harmony asks through the ability access manager, not through the location module
   * itself: the module says whether the service is on, the manager asks the user. There is
   * one location permission here rather than Android's two, so this asks for the same thing.
   */
  private async requestBackground(): Promise<string> {
    return this.askForLocation();
  }

  private async askForLocation(): Promise<string> {
    try {
      const atManager = abilityAccessCtrl.createAtManager();
      const context = getContext() as common.UIAbilityContext;
      await atManager.requestPermissionsFromUser(context, ['ohos.permission.LOCATION']);
      return '{}';
    } catch (error) {
      return Json.error((error as BusinessError).message || String(error));
    }
  }

  /** One fix of where the phone is. */
  private async currentPosition(): Promise<string> {
    try {
      // The callback form: with an optional parameter the promise overload widens into
      // "void & Promise<Location>", and the fields cannot be read off it.
      const request: geoLocationManager.CurrentLocationRequest = {
        priority: geoLocationManager.LocationRequestPriority.FIRST_FIX,
        timeoutMs: 10000,
        maxAccuracy: 0,
        scenario: geoLocationManager.LocationRequestScenario.UNSET
      };
      const answer: string = await new Promise<string>((resolve) => {
        geoLocationManager.getCurrentLocation(request,
          (err: BusinessError, position: geoLocationManager.Location) => {
            if (err) {
              resolve(Json.error(err.message));
              return;
            }
            resolve(Json.build([
              '"lat":' + String(position.latitude),
              '"lng":' + String(position.longitude),
              '"accuracy":' + String(position.accuracy)
            ]));
          });
      });
      return answer;
    } catch (error) {
      return Json.error((error as BusinessError).message || String(error));
    }
  }

  /** Raised when the user taps the reminder; the page opens the workout. */
  notifyOpen(payload: string): void {
    if (this.emitter) {
      this.emitter.emit('GymReminder.open', payload);
    }
  }
}
