/*
 * CapacitorHttp — the native HTTP path.
 *
 * The Coach's provider calls cannot go through the WebView: its origin is the local page, and
 * a provider with no CORS story for that origin refuses the preflight before a single byte
 * goes out. lib/capacitor-fetch.js reaches for CapacitorHttp for exactly that reason, so the
 * Harmony build has to offer the same door. The request happens natively, where CORS does not
 * exist.
 *
 * The contract on the page side:
 *   request({ url, method, headers, data, responseType, connectTimeout, readTimeout })
 *     -> { status, headers, data }
 *
 * Only the subset lib/capacitor-fetch.js uses is implemented: a method, headers, a JSON body
 * and an answer with ok / status / text() / json().
 */

import { http } from '@kit.NetworkKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { PluginHandler } from '../common/PluginHandler';
import { Json } from '../common/Json';

export class HttpPlugin extends PluginHandler {
  async invoke(method: string, payload: string): Promise<string> {
    const json = new Json(payload);
    switch (method) {
      case 'request':
        return this.request(json);
      default:
        return Json.error('CapacitorHttp: unknown method ' + method);
    }
  }

  /**
   * The method the page named, as the enum the native request wants.
   *
   * It is a function rather than a variable on purpose: a variable would narrow to the
   * union of the enum's members, and the request options would not take it.
   */
  private static methodOf(text: string): http.RequestMethod {
    const verb: string = text.toUpperCase();
    if (verb === 'POST') {
      return http.RequestMethod.POST;
    }
    if (verb === 'PUT') {
      return http.RequestMethod.PUT;
    }
    if (verb === 'DELETE') {
      return http.RequestMethod.DELETE;
    }
    if (verb === 'PATCH') {
      return http.RequestMethod.PATCH;
    }
    if (verb === 'HEAD') {
      return http.RequestMethod.HEAD;
    }
    return http.RequestMethod.GET;
  }

  private async request(json: Json): Promise<string> {
    const url: string = json.str('url', '');
    if (url.length === 0) {
      return Json.error('no url');
    }
    const verb: http.RequestMethod = HttpPlugin.methodOf(json.str('method', 'GET'));
    const bodyRaw: string | undefined = json.raw('data');
    const responseType: string = json.str('responseType', 'text');
    const readTimeout: number = json.num('readTimeout', 60000);
    const connectTimeout: number = json.num('connectTimeout', 30000);

    const request = http.createHttp();
    try {
      // The headers travel as raw JSON from the page. The native request takes an object, so
      // they are read field by field and put into one here.
      const header: Record<string, string> = {};
      const headersRaw: string | undefined = json.raw('headers');
      if (headersRaw !== undefined && headersRaw.length > 0 && headersRaw.charAt(0) === '{') {
        const headers = new Json(headersRaw);
        const names: string[] = headers.keys();
        for (let i = 0; i < names.length; i++) {
          header[names[i]] = headers.str(names[i], '');
        }
      }

      // A JSON body goes out as a string; anything else is sent as it came.
      let content: string = '';
      if (bodyRaw !== undefined && bodyRaw.length > 0) {
        content = bodyRaw.charAt(0) === '"' ? bodyRaw.substring(1, bodyRaw.length - 1) : bodyRaw;
        if (header['Content-Type'] === undefined) {
          header['Content-Type'] = 'application/json';
        }
      }

      // The body rides in extraData; the request options have no field called content.
      const options: http.HttpRequestOptions = {
        method: verb,
        header: header,
        extraData: content,
        readTimeout: readTimeout,
        connectTimeout: connectTimeout,
        expectDataType: responseType === 'json' ? http.HttpDataType.OBJECT : http.HttpDataType.STRING
      };

      // The callback form, not the promise one: with an optional parameter the promise
      // overload widens into "void & Promise<HttpResponse>", and the result cannot be
      // read off it. The callback form has one shape.
      const answer: string = await new Promise<string>((resolve) => {
        request.request(url, options, (err: BusinessError, response: http.HttpResponse) => {
          if (err) {
            resolve(Json.error(err.message));
            return;
          }
          resolve(Json.build([
            '"status":' + String(response.responseCode),
            '"headers":{}',
            '"data":' + Json.str(String(response.result))
          ]));
        });
      });
      return answer;
    } catch (error) {
      const message: string = (error as BusinessError).message || String(error);
      return Json.error(message);
    } finally {
      request.destroy();
    }
  }
}
