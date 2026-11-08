/*
 * Share — the system's share sheet.
 *
 * The contract on the page side:
 *   share({ title, text, url, files }) -> { activityType: 'string' }
 *
 * The app shares a plan as a small file or prints it as a PDF, and shares progress photos
 * (lib/…). On Harmony the share sheet is reached with a want: ACTION_SEND with the URI grants
 * that let the target read the file.
 */

import { Want } from '@kit.AbilityKit';
import common from '@ohos.app.ability.common';
import { BusinessError } from '@kit.BasicServicesKit';
import { PluginHandler } from '../common/PluginHandler';
import { Json } from '../common/Json';

export class SharePlugin extends PluginHandler {
  async invoke(method: string, payload: string): Promise<string> {
    const json = new Json(payload);
    switch (method) {
      case 'share':
        return this.share(json);
      default:
        return Json.build(['"__error":' + Json.str(String(`Share: unknown method ${method}`))]);
    }
  }

  private async share(json: Json): Promise<string> {
    try {
      const context = getContext() as common.UIAbilityContext;
      const title = json.str('title', '');
      const text = json.str('text', '');
      const url = json.str('url', '');
      const files: string[] = json.arrItems('files');

      // A want's entities are plain strings: the mime type and the text, one after the other.
      const mime: string = 'text/plain';
      const body: string = text + (url ? '\n' + url : '');
      let want: Want = {
        action: 'ohos.want.action.sendData',
        type: mime,
        entities: [mime, body]
      };

      // A file share carries the file's own URI and the grant that lets the target read it.
      if (files.length > 0) {
        const first = new Json(files[0]);
        const uri = first.str('uri', '');
        if (uri.length > 0) {
          // The file travels as the want's own uri: the share sheet hands the target the
          // grant that lets it read the file.
          want = {
            action: 'ohos.want.action.sendData',
            type: 'text/plain',
            entities: ['text/plain', text],
            uri: uri
          };
        }
      }

      if (title.length > 0) {
        // The title rides along in the entities: the share sheet shows the first one.
        want = {
          action: 'ohos.want.action.sendData',
          type: 'text/plain',
          entities: ['text/plain', title + '\n' + text],
          uri: want.uri
        };
      }

      // The share sheet is an ability of its own; the page's own text and the file go
      // along in the want.
      const options: Want = {
        action: 'ohos.want.action.sendData',
        type: 'text/plain',
        entities: ['text/plain', text],
        abilityName: 'com.huawei.hms.ability.shell.SharingAbility'
      };
      context.startAbility(options).catch((error: BusinessError) => {
        console.error('[Share] share failed:', error.message);
      });

      return Json.build(['"activityType":' + Json.str('string')]);
    } catch (error) {
      const message = (error as BusinessError).message || String(error);
      return Json.build(['"__error":' + Json.str(message)]);
    }
  }
}
