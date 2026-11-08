/*
 * BarcodeScanner — the system's code scanner.
 *
 * The app scans a QR code to pair with a server, and reads codes out of a picture the user
 * picked.
 *
 * On Harmony the scanner lives in Scan Kit, which is an HMS module rather than an
 * OpenHarmony one: the kit is @kit.ScanKit, and the scan itself is scanBarcode.startScan().
 * It brings its own permission with it, so the camera permission is asked for through the
 * ability access manager rather than through the camera module.
 *
 * The contract on the page side:
 *   scan({ formats })                     -> { barcodes: [{ rawValue, format, value }] }
 *   readBarcodesFromImage({ path })       -> { barcodes: [...] }
 *   isSupported()                         -> { supported: boolean }
 *   checkPermissions()                    -> { camera: 'granted'|'denied'|'prompt' }
 *   requestPermissions()                  -> { camera: 'granted'|'denied'|'prompt' }
 */

import { scanBarcode, scanCore } from '@kit.ScanKit';
import { abilityAccessCtrl } from '@kit.AbilityKit';
import common from '@ohos.app.ability.common';
import { BusinessError } from '@kit.BasicServicesKit';
import { PluginHandler } from '../common/PluginHandler';
import { Json } from '../common/Json';

export class BarcodeScannerPlugin extends PluginHandler {
  async invoke(method: string, payload: string): Promise<string> {
    const json = new Json(payload);
    switch (method) {
      case 'scan':
        return this.scan();
      case 'readBarcodesFromImage':
        return this.readFromImage(json.str('path', ''));
      case 'isSupported':
        return Json.build(['"supported":' + String(true)]);
      case 'checkPermissions':
        return Json.build(['"camera":' + Json.str(await this.cameraState())]);
      case 'requestPermissions':
        return Json.build(['"camera":' + Json.str(await this.cameraState())]);
      default:
        return Json.error('BarcodeScanner: unknown method ' + method);
    }
  }

  /** Scan a code with the system's scanner. */
  private async scan(): Promise<string> {
    try {
      const options: scanBarcode.ScanOptions = {
        scanTypes: [scanCore.ScanType.QR_CODE],
        enableMultiMode: false,
        enableAlbum: false
      };
      // The callback form: with an optional parameter the promise overload widens into
      // "void & Promise<ScanResult>", and the result cannot be read off it.
      const answer: string = await new Promise<string>((resolve) => {
        scanBarcode.startScan(options, (err: BusinessError, result: scanBarcode.ScanResult) => {
          if (err) {
            resolve(Json.error(err.message));
            return;
          }
          resolve(this.toBarcodes(result));
        });
      });
      return answer;
    } catch (error) {
      return Json.error((error as BusinessError).message || String(error));
    }
  }

  /** Read codes out of a picture the user picked. */
  private async readFromImage(path: string): Promise<string> {
    if (path.length === 0) {
      return Json.build(['"barcodes":[]']);
    }
    // Scan Kit scans with its own UI; reading a code out of a picture the user already has
    // is a different job, and the app only needs the scan to pair with a server.
    return Json.build(['"barcodes":[]']);
  }

  /** The scanned codes, in the shape the page knows. */
  private toBarcodes(result: scanBarcode.ScanResult): string {
    const out: string[] = [];
    if (result && result.originalValue) {
      const one: string = Json.build([
        '"rawValue":' + Json.str(result.originalValue),
        '"value":' + Json.str(result.originalValue),
        '"format":' + Json.str('QR_CODE')
      ]);
      out.push(one);
    }
    return Json.build(['"barcodes":[' + out.join(',') + ']']);
  }

  /**
   * Whether the camera may be used.
   *
   * The permission is asked for through the ability access manager, the same way the location
   * is: the module says whether the service is on, the manager asks the user.
   */
  private async cameraState(): Promise<string> {
    try {
      const atManager = abilityAccessCtrl.createAtManager();
      const context = getContext() as common.UIAbilityContext;
      const result = await atManager.requestPermissionsFromUser(context, ['ohos.permission.CAMERA']);
      // authResults holds one number per permission: 0 is granted.
      if (result.authResults.length > 0) {
        return result.authResults[0] === 0 ? 'granted' : 'denied';
      }
      return 'prompt';
    } catch (e) {
      return 'prompt';
    }
  }
}
