/**
 * BleScale — the HarmonyOS path of the Bluetooth weight-scale integration.
 *
 * The web build cannot talk to @kit.ConnectivityKit, so the BLE scan/connect/read logic lives
 * natively and is reached the same way every other openGym native plugin is: the page calls
 *   Scale.scan / Scale.stopScan / Scale.connect / Scale.disconnect / Scale.getState /
 *   Scale.requestPermissions / Scale.adapters
 * and the plugin pushes back the things the page cannot poll through three events:
 *   Scale.deviceFound   one per scanned device (with the protocol it matched)
 *   Scale.reading       one per measurement (weightKg + optional bodyFatPercent/impedance)
 *   Scale.state         the connection-state machine (idle/scanning/connecting/connected/…)
 *
 * The protocol stack under ./ (ScaleBluetoothService + the adapters + ProtocolRegistry) is a
 * faithful port of the HarmonyScale project; this file is the only openGym-specific glue.
 */

import { common } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { PluginHandler } from '../../common/PluginHandler';
import { EventHolder } from '../../common/EventHolder';
import { Json } from '../../common/Json';
import { ScaleBluetoothService, BtConnectionState, RawScanDevice } from './ScaleBluetoothService';
import { ProtocolRegistry } from './ProtocolRegistry';
import { WeightReading } from './ScaleModels';

export class BleScalePlugin extends PluginHandler {
  private bt: ScaleBluetoothService = new ScaleBluetoothService();
  private registry: ProtocolRegistry = new ProtocolRegistry();
  private emitter: EventHolder | null = null;
  private lastState: string = 'idle';
  /** deviceId -> matched adapterId, filled as devices are scanned so connect() needs no hint. */
  private deviceAdapter: Map<string, string> = new Map();

  constructor() {
    super();
    this.bt.setCallbacks(
      (r: WeightReading, deviceId?: string) => this.emitReading(r, deviceId),
      (s: BtConnectionState, msg?: string) => this.emitState(s, msg),
      (d: RawScanDevice) => this.emitDevice(d)
    );
    // Broadcast scales (三诺 / some 香山 / 乐心) report weight straight from the advertisement;
    // they need no GATT connection, so the service parses them during the scan pass.
    const broadcast = this.registry.create('broadcast-scale');
    if (broadcast) {
      this.bt.setBroadcastAdapters([broadcast]);
    }
  }

  /** The bridge hands this plugin its channel back to the page. */
  setEmitter(emitter: EventHolder): void {
    this.emitter = emitter;
  }

  async invoke(method: string, payload: string): Promise<string> {
    const json = new Json(payload);
    switch (method) {
      case 'getState':
        return this.getState();
      case 'scan':
        return this.scan();
      case 'stopScan':
        return this.stopScan();
      case 'connect':
        return this.connect(json);
      case 'disconnect':
        return this.disconnect();
      case 'requestPermissions':
        return this.requestPermissions();
      case 'adapters':
        return this.adapters();
      default:
        return Json.error('BleScale: unknown method ' + method);
    }
  }

  /** Hardware bluetooth switch plus the current connection state. */
  private getState(): string {
    const bluetooth = this.bt.getBluetoothState();
    return Json.build([
      '"bluetooth":' + Json.str(bluetooth),
      '"state":' + Json.str(this.lastState)
    ]);
  }

  private scan(): string {
    this.deviceAdapter.clear();
    this.bt.startScan([]);
    return Json.build(['"ok":true']);
  }

  private stopScan(): string {
    this.bt.stopScan();
    return Json.build(['"ok":true']);
  }

  private async connect(json: Json): Promise<string> {
    const deviceId: string = json.str('deviceId', '');
    if (!deviceId) {
      return Json.error('BleScale: connect requires a deviceId');
    }
    // Prefer an explicit choice, then the protocol the scan identified, then the generic fallback.
    let adapterId: string = json.str('adapterId', '');
    if (!adapterId) {
      adapterId = this.deviceAdapter.get(deviceId) || 'standard';
    }
    const adapter = this.registry.create(adapterId);
    if (!adapter) {
      return Json.error('BleScale: unknown adapter ' + adapterId);
    }
    const ok = await this.bt.connect(deviceId, adapter);
    return Json.build(['"connecting":' + (ok ? 'true' : 'false')]);
  }

  private disconnect(): string {
    this.bt.disconnect();
    return Json.build(['"ok":true']);
  }

  private async requestPermissions(): Promise<string> {
    try {
      // The page cannot grant runtime permissions; the UIAbility context can.
      const context = getContext() as common.UIAbilityContext;
      const ok = await this.bt.requestPermissions(context);
      return Json.build(['"granted":' + (ok ? 'true' : 'false')]);
    } catch (error) {
      return Json.error((error as BusinessError).message || String(error));
    }
  }

  private adapters(): string {
    const list = this.registry.list();
    const items = list.map((a) =>
      '{"id":' + Json.str(a.id) + ',"displayName":' + Json.str(a.displayName) + ',"shortName":' + Json.str(a.shortName) + '}'
    );
    return Json.build(['"adapters":[' + items.join(',') + ']']);
  }

  private emitReading(r: WeightReading, deviceId?: string): void {
    if (!this.emitter) {
      return;
    }
    const parts: string[] = [
      '"weightKg":' + String(r.weightKg),
      '"state":' + Json.str(r.state),
      '"timestamp":' + String(r.timestamp),
      '"deviceId":' + Json.str(deviceId || '')
    ];
    if (r.bodyFatPercent !== undefined) {
      parts.push('"bodyFatPercent":' + String(r.bodyFatPercent));
    }
    if (r.impedance !== undefined) {
      parts.push('"impedance":' + String(r.impedance));
    }
    if (r.weightType) {
      parts.push('"weightType":' + Json.str(r.weightType));
    }
    this.emitter.emit('Scale.reading', '{' + parts.join(',') + '}');
  }

  private emitState(s: BtConnectionState, msg?: string): void {
    this.lastState = s;
    if (!this.emitter) {
      return;
    }
    const parts: string[] = ['"state":' + Json.str(s)];
    if (msg) {
      parts.push('"message":' + Json.str(msg));
    }
    this.emitter.emit('Scale.state', '{' + parts.join(',') + '}');
  }

  private emitDevice(d: RawScanDevice): void {
    if (!this.emitter) {
      return;
    }
    const adapterId = this.registry.identify(d.name, d.serviceUuids, d.manufacturerData, d.serviceData);
    const isScale = adapterId !== null;
    let displayName = '';
    let shortName = '未识别';
    if (adapterId) {
      this.deviceAdapter.set(d.deviceId, adapterId);
      const info = this.registry.list().find((x) => x.id === adapterId);
      if (info) {
        displayName = info.displayName;
        shortName = info.shortName;
      }
    }
    const parts: string[] = [
      '"deviceId":' + Json.str(d.deviceId),
      '"name":' + Json.str(d.name || '未知设备'),
      '"rssi":' + String(d.rssi),
      '"adapterId":' + Json.str(adapterId || ''),
      '"adapterName":' + Json.str(displayName),
      '"shortName":' + Json.str(shortName),
      '"isScale":' + (isScale ? 'true' : 'false')
    ];
    this.emitter.emit('Scale.deviceFound', '{' + parts.join(',') + '}');
  }
}
