/*
 * PluginRegistry — the table of native plugins the page may call.
 *
 * Every plugin answers with a JSON string, never a typed object: the other side of the bridge
 * is a JavaScript engine, and a JSON string is the one shape both ends agree on.
 */

import { PluginHandler } from './PluginHandler';

export class PluginRegistry {
  private handlers: Map<string, PluginHandler> = new Map();

  register(name: string, handler: PluginHandler): void {
    this.handlers.set(name, handler);
  }

  get(name: string): PluginHandler | undefined {
    return this.handlers.get(name);
  }

  names(): string[] {
    const out: string[] = [];
    this.handlers.forEach((_v: PluginHandler, k: string) => out.push(k));
    return out;
  }
}

export namespace PluginRegistry {
  export type Handler = PluginHandler;
}
