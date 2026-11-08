/*
 * PluginHandler — what a native plugin looks like from the registry.
 *
 * invoke() takes the method name and the JSON payload, and answers with a JSON string.
 * Throwing is how a plugin reports a failure; the bridge turns that into a rejected promise
 * on the page, the way a Capacitor plugin does.
 *
 * This is an abstract class rather than an interface on purpose. ArkTS does not do structural
 * typing: a class that merely has the right shape is not accepted where an interface is
 * expected ("arkts-no-structural-typing"). Inheriting from the class is.
 */

export abstract class PluginHandler {
  /** One call from the page. */
  abstract invoke(method: string, payload: string): Promise<string>;
}

/**
 * EventEmitter — how a plugin pushes an event back to the page.
 *
 * An abstract class for the same reason as PluginHandler: a plugin that only has an emit()
 * method is not accepted where this is expected, unless it inherits from it.
 */
export abstract class EventEmitter {
  /** One event, with its payload already as JSON. */
  abstract emit(event: string, json: string): void;
}
