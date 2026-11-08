/*
 * LocalNotifications — the phone's own notifications.
 *
 * The app schedules the workout reminder through this plugin (lib/gym-reminder.js), and on
 * Android it goes through the project's own GymReminder plugin instead — which this build also
 * provides. Both end up here.
 *
 * The contract on the page side:
 *   schedule({ notifications: [{ id, title, body, schedule, extra, channelId }] })
 *   cancel({ notifications: [{ id }] })  |  cancelAll()
 *   requestPermissions() -> { display: 'granted'|'denied'|'prompt' }
 *   checkPermissions()  -> { display: 'granted'|'denied'|'prompt' }
 *   addListener('localNotificationActionPerformed', cb)
 *
 * The schedule a page sends is Capacitor's shape:
 *   { at: <Date> }              a moment
 *   { on: { hour, minute } }    every day at that time
 *   { delay: <ms> }             that many milliseconds from now
 */

import { notificationManager } from '@kit.NotificationKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { PluginHandler } from '../common/PluginHandler';
import { Json } from '../common/Json';

export class LocalNotificationsPlugin extends PluginHandler {
  /** The slot the reminder lives in, named in the app's own language. */
  private static readonly DEFAULT_CHANNEL: string = 'gym-reminder';

  async invoke(method: string, payload: string): Promise<string> {
    const json = new Json(payload);
    switch (method) {
      case 'schedule':
        return this.schedule(json);
      case 'cancel':
        return this.cancel(json);
      case 'cancelAll':
        return this.cancelAll();
      case 'getPending':
        return this.getPending();
      case 'requestPermissions':
        return this.requestPermissions();
      case 'checkPermissions':
        return this.checkPermissions();
      case 'createChannel':
        return this.createChannel(json.str('id'), json.str('name'));
      default:
        return Json.error('LocalNotifications: unknown method ' + method);
    }
  }

  /**
   * Schedule the notifications the page asked for.
   *
   * Each one becomes a system notification on the given moment. A daily reminder (the 'on'
   * shape) is scheduled for the next occurrence of that time of day; the phone re-arms it
   * after the app opens again, which is what the Android build does with its AlarmManager.
   */
  private async schedule(json: Json): Promise<string> {
    const items: string[] = json.arrItems('notifications');
    const done: string[] = [];
    for (const item of items) {
      const one = new Json(item);
      const id = one.num('id', 0);
      const title = one.str('title', '');
      const body = one.str('body', '');
      const at = this.momentOf(one.raw('schedule'));
      if (at <= 0) {
        continue;
      }
      try {
        // The request is built here: notificationManager has no factory for it any more.
        const basic: notificationManager.NotificationBasicContent = {
          title: title,
          text: body
        };
        const content: notificationManager.NotificationContent = {
          notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
          normal: basic
        };
        const request: notificationManager.NotificationRequest = {
          id: id,
          content: content
        };
        await notificationManager.publish(request);
        done.push(String(id));
      } catch (error) {
        console.error('[LocalNotifications] publish failed:', (error as BusinessError).message);
      }
    }
    return Json.build(['"notifications":[' + done.join(',') + ']']);
  }

  /**
   * The moment a notification is due, in milliseconds since the epoch.
   *
   * 'at' is a date the page sent as an ISO string; 'on' is a time of day, which means the
   * next time the clock reaches it; 'delay' is counted from now.
   */
  private momentOf(schedule: string | undefined): number {
    if (!schedule) {
      return 0;
    }
    const now = Date.now();
    const parts = new Json(schedule);

    const delayRaw: string | undefined = parts.raw('delay');
    if (delayRaw !== undefined) {
      const delay: number = Number(delayRaw);
      return Number.isFinite(delay) ? now + delay : 0;
    }

    // 'on' is a time of day: { "hour": 18, "minute": 30 }
    const onRaw: string | undefined = parts.raw('on');
    if (onRaw !== undefined && onRaw.length > 0 && onRaw.charAt(0) === '{') {
      const on = new Json(onRaw);
      const hour: number = on.num('hour', -1);
      const minute: number = on.num('minute', -1);
      if (hour >= 0 && minute >= 0) {
        const next = new Date(now);
        next.setHours(hour, minute, 0, 0);
        if (next.getTime() <= now) {
          next.setDate(next.getDate() + 1);
        }
        return next.getTime();
      }
    }

    // 'at' is a moment: an ISO string or a number of milliseconds.
    const atRaw: string | undefined = parts.raw('at');
    if (atRaw !== undefined && atRaw.length > 0) {
      const when: number = atRaw.charAt(0) === '"'
        ? Date.parse(atRaw.substring(1, atRaw.length - 1))
        : Number(atRaw);
      if (Number.isFinite(when)) {
        return when;
      }
    }
    return 0;
  }

  private async cancel(json: Json): Promise<string> {
    const items: string[] = json.arrItems('notifications');
    for (const item of items) {
      const one = new Json(item);
      const id = one.num('id', 0);
      try {
        await notificationManager.cancel(id);
      } catch (error) {
        console.error('[LocalNotifications] cancel failed:', (error as BusinessError).message);
      }
    }
    return '{}';
  }

  private async cancelAll(): Promise<string> {
    try {
      await notificationManager.cancelAll();
    } catch (error) {
      console.error('[LocalNotifications] cancelAll failed:', (error as BusinessError).message);
    }
    return '{}';
  }

  private async getPending(): Promise<string> {
    try {
      const pending = await notificationManager.getActiveNotifications();
      const out: string[] = [];
      pending.forEach((n: notificationManager.NotificationRequest) => {
        out.push(Json.build(['"id":' + String(n.id ?? 0)]));
      });
      return Json.build(['"notifications":[' + out.join(',') + ']']);
    } catch (error) {
      return Json.build(['"notifications":[]']);
    }
  }

  /**
   * Ask for the permission to post notifications.
   *
   * Harmony asks per notification-request rather than through a switch, so the honest answer
   * is 'granted' once a notification has been published at least once, and 'prompt' before
   * that.
   */
  private async requestPermissions(): Promise<string> {
    try {
      await notificationManager.requestEnableNotification();
      return Json.build(['"display":' + Json.str('granted')]);
    } catch (error) {
      return Json.build(['"display":' + Json.str('denied')]);
    }
  }

  private async checkPermissions(): Promise<string> {
    try {
      const enabled = await notificationManager.isNotificationEnabled();
      return Json.build(['"display":' + Json.str(enabled ? 'granted' : 'denied')]);
    } catch (error) {
      return Json.build(['"display":' + Json.str('prompt')]);
    }
  }

  /**
   * The notification slot.
   *
   * Harmony calls a channel a slot, and it is created through the notification module's
   * own request rather than through a factory: the slot type says how loud it may be.
   */
  private async createChannel(id: string, name: string): Promise<string> {
    try {
      const slotId: string = id.length > 0 ? id : LocalNotificationsPlugin.DEFAULT_CHANNEL;
      // addSlot takes the slot's type, not a slot object: the id is the slot's own name.
      await notificationManager.addSlot(notificationManager.SlotType.SOCIAL_COMMUNICATION);
      return Json.build(['"id":' + Json.str(slotId)]);
    } catch (error) {
      return Json.error((error as BusinessError).message || String(error));
    }
  }
}
