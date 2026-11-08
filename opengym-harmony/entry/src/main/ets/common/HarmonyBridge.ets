/*
 * HarmonyBridge — the one door between the page and the native side.
 *
 * The page never talks to ArkTS directly. It asks for a Capacitor-shaped call
 * (Filesystem.readFile, GymReminder.configure, …) and the shim in
 * frontend/src/lib/harmony/bridge.js turns that into three strings: a ticket, a method name
 * and a JSON payload. This class takes them, runs the plugin, and answers through
 * runJavaScript.
 *
 * registerJavaScriptProxy is void-typed — the native side cannot hand a value back to its
 * caller — so every call carries a ticket and the answer arrives later. That is what lets the
 * app's Promise-shaped plugin API work unchanged on Harmony.
 *
 * Payloads travel as JSON strings on purpose: ArkTS is strict about types, and a JSON string
 * has no way to disagree with the other side about its shape.
 */

import { webview } from '@kit.ArkWeb';
import { BusinessError } from '@kit.BasicServicesKit';
import { PluginRegistry } from './PluginRegistry';
import { EventHolder } from './EventHolder';

/**
 * The object the page actually calls.
 *
 * It has to be a class, not an object literal: ArkTS will not accept a literal where
 * JavaScriptProxy.object is expected, and the Web component reads its methods by name.
 */
class BridgeHandler {
  private bridge: HarmonyBridge;

  constructor(bridge: HarmonyBridge) {
    this.bridge = bridge;
  }

  /** One call from the page. Returns the ticket; the answer arrives later. */
  call(ticket: string, method: string, payload: string): string {
    this.bridge.dispatch(ticket, method, payload);
    return ticket;
  }
}

export class HarmonyBridge extends EventHolder {
  private controller: webview.WebviewController | null = null;
  private registry: PluginRegistry = new PluginRegistry();
  private seq: number = 0;

  setController(controller: webview.WebviewController): void {
    this.controller = controller;
  }

  /**
   * The proxy the Web component registers. The page calls
   *   window.JSBridgeHandle.call(ticket, method, payloadJson)
   * and gets the ticket back; the answer arrives later through window.__ogResolve.
   *
   * The type is webview.JavaScriptProxy, whose `object` field must be a class instance —
   * ArkTS will not accept an object literal there.
   */
  get javaScriptProxy(): JavaScriptProxy {
    const handler: BridgeHandler = new BridgeHandler(this);
    const controller: webview.WebviewController = this.controller as webview.WebviewController;
    return {
      object: handler,
      name: 'JSBridgeHandle',
      methodList: ['call'],
      controller: controller
    };
  }

  /**
   * Run one plugin call and answer it.
   * A plugin that throws answers with {"__error": "..."} — the page turns that into a
   * rejected promise, which is what a Capacitor plugin does.
   */
  dispatch(ticket: string, method: string, payload: string): void {
    this.dispatchAsync(ticket, method, payload).catch((error: BusinessError) => {
      this.resolve(ticket, JSON.stringify({ __error: error.message || String(error) }));
    });
  }

  private async dispatchAsync(ticket: string, method: string, payload: string): Promise<void> {
    const dot = method.indexOf('.');
    const plugin = dot > 0 ? method.substring(0, dot) : method;
    const call = dot > 0 ? method.substring(dot + 1) : '';

    const handler = this.registry.get(plugin);
    if (!handler) {
      this.resolve(ticket, JSON.stringify({ __error: `no such plugin: ${plugin}` }));
      return;
    }
    try {
      const result = await handler.invoke(call, payload);
      this.resolve(ticket, result === undefined || result === null ? '{}' : result);
    } catch (error) {
      const message = (error as BusinessError).message || String(error);
      this.resolve(ticket, JSON.stringify({ __error: message }));
    }
  }

  /** Answer one ticket. */
  resolve(ticket: string, json: string): void {
    if (!this.controller) {
      return;
    }
    const code = `window.__ogResolve(${JSON.stringify(ticket)}, ${json})`;
    this.controller.runJavaScript(code).catch((error: BusinessError) => {
      console.error('[HarmonyBridge] resolve failed:', error.message);
    });
  }

  /**
   * Push an event to the page — the back button, a tapped notification, a reminder firing.
   * The page's addListener() waits for exactly these names.
   */
  emit(event: string, json: string): void {
    if (!this.controller) {
      return;
    }
    const code = `window.__ogEmit(${JSON.stringify(event)}, ${json})`;
    this.controller.runJavaScript(code).catch((error: BusinessError) => {
      console.error('[HarmonyBridge] emit failed:', error.message);
    });
  }

  /** Hand a plugin to the registry. */
  register(name: string, handler: PluginRegistry.Handler): void {
    this.registry.register(name, handler);
  }
}
