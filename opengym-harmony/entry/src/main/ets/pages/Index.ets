/*
 * Index — the page the app lives on.
 *
 * HarmonyOS NEXT has no Capacitor runtime, so the phone shell is an ArkUI Web component with
 * the openGym React app inside it and a native bridge beside it. This file is where that
 * shell is set up.
 *
 * Three things here are not optional, and each of them was a white screen before it was
 * right:
 *
 *  1. The app is an ES-module bundle (Vite output, <script type="module">), and ArkWeb will
 *     not load a module from a file:// or resource:// URL — the kernel treats every module
 *     import on those schemes as a cross-origin request and blocks it. So the page is served
 *     from https://localhost, and every request for it is answered from the package by
 *     onInterceptRequest. The domain never resolves: the requests never leave the phone.
 *     See common/LocalAssets.ets for why the domain is exactly this one.
 *
 *  2. The bridge is registered through the javaScriptProxy property. registerJavaScriptProxy
 *     called too early does not reach the page, and the page would then wait for a bridge
 *     that is not there — every native call would time out instead of failing fast.
 *
 *  3. The back gesture belongs to the page first. The page's own router may have somewhere
 *     to go, and only when it says no does the app step back through the WebView's history,
 *     and only when that is exhausted does the app leave.
 */

import { webview } from '@kit.ArkWeb';
import { BusinessError } from '@kit.BasicServicesKit';
import common from '@ohos.app.ability.common';
import { HarmonyBridge } from '../common/HarmonyBridge';
import { PluginHandler } from '../common/PluginHandler';
import { Json } from '../common/Json';
import { APP_ORIGIN, localPathOf, readAsset, mimeOf, notFoundBody } from '../common/LocalAssets';
import { SecureStoragePlugin } from '../plugins/SecureStoragePlugin';
import { FilesystemPlugin } from '../plugins/FilesystemPlugin';
import { LocalNotificationsPlugin } from '../plugins/LocalNotificationsPlugin';
import { BarcodeScannerPlugin } from '../plugins/BarcodeScannerPlugin';
import { SharePlugin } from '../plugins/SharePlugin';
import { AppPlugin } from '../plugins/AppPlugin';
import { SplashScreenPlugin } from '../plugins/SplashScreenPlugin';
import { HttpPlugin } from '../plugins/HttpPlugin';
import { GymReminderPlugin } from '../plugins/GymReminderPlugin';
import { HealthConnectPlugin } from '../plugins/HealthConnectPlugin';

@Entry
@Component
struct Index {
  private controller: webview.WebviewController = new webview.WebviewController();
  private bridge: HarmonyBridge = new HarmonyBridge();
  private appPlugin: AppPlugin = new AppPlugin();
  private gymReminder: GymReminderPlugin = new GymReminderPlugin();

  aboutToAppear(): void {
    this.setup();
  }

  /** Wire the bridge and the plugins. */
  private setup(): void {
    this.bridge.setController(this.controller);

    // The plugins the page may call. The names match the Capacitor plugin names the app
    // imports (frontend/src/lib/harmony/plugins.js).
    this.bridge.register('SecureStorage', new SecureStoragePlugin());
    this.bridge.register('Filesystem', new FilesystemPlugin());
    this.bridge.register('LocalNotifications', new LocalNotificationsPlugin());
    this.bridge.register('BarcodeScanner', new BarcodeScannerPlugin());
    this.bridge.register('Share', new SharePlugin());
    this.bridge.register('App', this.appPlugin);
    this.bridge.register('SplashScreen', new SplashScreenPlugin());
    this.bridge.register('CapacitorHttp', new HttpPlugin());
    this.bridge.register('GymReminder', this.gymReminder);
    // The HarmonyOS edition's own health store: local read/write to 华为运动健康 via the system
    // Health Service Kit. The page calls it through the same HealthConnect name Android uses, so
    // lib/health-sync.js needs no platform branch.
    this.bridge.register('HealthConnect', new HealthConnectPlugin());
    this.bridge.register('Channel', new ChannelPlugin());
    this.bridge.register('Capacitor', new CapacitorPlugin());

    // The events the page waits for.
    this.appPlugin.setEmitter(this.bridge);
    this.gymReminder.setEmitter(this.bridge);
  }

  /**
   * Answer a request for one of the app's own files.
   *
   * The page runs on https://localhost, so every asset it asks for comes through here and is
   * answered from the package. A request for anything else — the paired server, the AI
   * provider — is passed on to the network untouched.
   */
  private intercept(event: OnInterceptRequestEvent): WebResourceResponse | null {
    try {
      if (!event || !event.request) {
        return null;
      }
      const url: string = event.request.getRequestUrl();
      const path: string | undefined = localPathOf(url);
      if (path === undefined) {
        // Not ours. Letting it through is what lets the page talk to the paired server.
        return null;
      }

      const context = getContext(this) as common.UIAbilityContext;
      const bytes: Uint8Array | undefined = readAsset(context, path);
      const response: WebResourceResponse = new WebResourceResponse();
      response.setResponseCode(bytes === undefined ? 404 : 200);
      response.setReasonMessage(bytes === undefined ? 'Not Found' : 'OK');
      response.setResponseMimeType(mimeOf(path));
      response.setResponseEncoding('utf-8');
      response.setResponseIsReady(true);
      if (bytes === undefined) {
        response.setResponseData(notFoundBody(path));
      } else {
        response.setResponseData(bytes.buffer as ArrayBuffer);
      }
      return response;
    } catch (error) {
      console.error('[Index] intercept failed:', (error as BusinessError).message);
      return null;
    }
  }

  /**
   * The back gesture. The page gets the first word: its router may have somewhere to go.
   */
  onBackPress(): boolean {
    try {
      // The page asked first; if it handled the gesture it said so by now.
      if (this.controller.accessBackward()) {
        this.controller.backward();
        return true;
      }
    } catch (error) {
      console.error('[Index] backward failed:', (error as BusinessError).message);
    }
    return false;
  }

  build() {
    Column() {
      Web({ src: APP_ORIGIN + '/index.html', controller: this.controller })
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .fileAccess(true)
        .javaScriptProxy(this.bridge.javaScriptProxy)
        .mixedMode(MixedMode.All)
        .width('100%')
        .layoutWeight(1)
        .onInterceptRequest((event: OnInterceptRequestEvent): WebResourceResponse | null => {
          return this.intercept(event);
        })
        .onPageEnd(() => {
          console.info('[Index] page loaded');
        })
        .onErrorReceive((event: OnErrorReceiveEvent) => {
          // A chunk the WebView cannot parse kills the module graph before anything runs, and
          // the boot logo would lift forever. Say so where it can be seen.
          console.error('[Index] page error:', event.error.getErrorInfo());
        })
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#0c0e12')
  }
}

/**
 * Channel — where this copy of the app came from, which decides who updates it.
 *
 * Harmony has no in-app updater: the app store does it. The answer 'sideload' is what makes
 * lib/channel.js treat this build as one that looks after its own updates, and the Harmony
 * build ships no updater, so that branch does nothing.
 */
class ChannelPlugin extends PluginHandler {
  async invoke(method: string, _payload: string): Promise<string> {
    if (method === 'get') {
      return '{"channel":"sideload"}';
    }
    return Json.error('Channel: unknown method ' + method);
  }
}

/**
 * Capacitor — the few core calls that are not plugin calls.
 *
 * convertFileSrc turns a native file path into a URL the page can load; the app uses it for
 * the photos and videos it keeps offline.
 */
class CapacitorPlugin extends PluginHandler {
  async invoke(method: string, payload: string): Promise<string> {
    if (method === 'convertFileSrc') {
      const parts = new Json(payload);
      const path: string = parts.str('path', '');
      const url: string = path.length > 0 ? 'file://' + path : '';
      return '{"url":' + Json.str(url) + '}';
    }
    return Json.error('Capacitor: unknown method ' + method);
  }
}
