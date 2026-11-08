/*
 * EventHolder — the way an event reaches the page.
 *
 * A plugin cannot inherit from two things at once (ArkTS has single inheritance), and the
 * plugins that push events already extend PluginHandler. So the event side is a separate
 * class that the bridge provides and the plugin holds: the plugin hands the bridge over as
 * its holder, and calls holder.emit() when something happens.
 *
 * This is a class rather than an interface for the same reason PluginHandler is: ArkTS does
 * not do structural typing, so a class that merely has the right shape is not accepted.
 */
export abstract class EventHolder {
  /** One event, with its payload already as JSON. */
  abstract emit(event: string, json: string): void;
}
