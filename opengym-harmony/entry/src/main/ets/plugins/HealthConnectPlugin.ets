/*
 * HealthConnect — the HarmonyOS edition's own health store.
 *
 * On Android the app talks to Google's Health Connect; on the iPhone to Apple Health. On
 * HarmonyOS it talks to the device's own 华为运动健康 through the system Health Service Kit
 * (@kit.HealthServiceKit). The page side is unchanged: lib/health-sync.js, lib/health-read.js
 * and lib/health-connect.js call the same methods (status / requestPermissions / write /
 * remove / readWeights / readHeartRate / openSettings / setEnabled) the Android plugin answers,
 * so this file is the only thing that has to know the HarmonyOS APIs.
 *
 * The plugin reads and writes locally — no cloud, no OAuth, no relay server. That is the whole
 * point of the HarmonyOS edition's health module: the data never leaves the phone.
 *
 * Written against the SDK declarations in
 *   sdk/default/hms/ets/kits/@kit.HealthServiceKit.d.ts  (exports healthStore, healthService)
 *   sdk/default/hms/ets/api/@hms.health.store.d.ts      (healthStore.* and its types)
 * The real calls are init / requestAuthorizations / getAuthorizations / readData / saveData /
 * deleteData / insertDataSource. There is no `healthDataTypes` or `healthPermission` at the Kit's
 * top level: data-type constants live under healthStore.healthDataTypes, and read/write access is
 * expressed by the two arrays of an AuthorizationRequest, not by a separate permission module.
 *
 * Time: Health Service Kit uses Unix milliseconds, the page uses Unix milliseconds too. The
 * earlier draft assumed nanoseconds; that was wrong and is corrected here.
 *
 * What it needs to actually run (all on the Huawei side, none of it in this file):
 *   - an AGC project with Health Service Kit enabled, and the app's bundle name registered;
 *   - the health permissions declared in module.json5 and the data types the app asks for;
 *   - a build signed and, for a published app, the Health Kit review passed.
 * Until those are in place init()/getAuthorizations() reject and status() honestly reports
 * "unsupported" — which is exactly the state the UI is written to handle.
 */

import { healthStore } from '@kit.HealthServiceKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { common } from '@kit.AbilityKit';
import { PluginHandler } from '../common/PluginHandler';
import { Json } from '../common/Json';

/** The page names data types by short words; Health Kit names them by constants. */
function dataTypeOf(name: string): healthStore.DataType | null {
  switch (name) {
    case 'weight':
      return healthStore.healthDataTypes.WEIGHT;
    case 'height':
      return healthStore.healthDataTypes.HEIGHT;
    case 'heartRate':
      return healthStore.healthDataTypes.HEART_RATE;
    case 'steps':
      return healthStore.healthDataTypes.DAILY_ACTIVITIES;
    case 'sleep':
      return healthStore.healthDataTypes.SLEEP_RECORD;
    case 'workouts':
      return healthStore.healthDataTypes.WORKOUT;
    default:
      // 'history' is an Android Health Connect permission with no HarmonyOS equivalent.
      return null;
  }
}

/** The workout type the page sends is an Android-style word; map the common ones. */
function workoutTypeOf(name: string): healthStore.DataType {
  if (name.indexOf('strength') >= 0) {
    return healthStore.healthDataTypes.STRENGTH_TRAINING;
  }
  if (name.indexOf('run') >= 0) {
    return healthStore.healthDataTypes.RUNNING;
  }
  if (name.indexOf('walk') >= 0) {
    return healthStore.healthDataTypes.WALKING;
  }
  if (name.indexOf('cycl') >= 0 || name.indexOf('bike') >= 0) {
    return healthStore.healthDataTypes.CYCLING;
  }
  if (name.indexOf('yoga') >= 0) {
    return healthStore.healthDataTypes.YOGA;
  }
  if (name.indexOf('hiit') >= 0) {
    return healthStore.healthDataTypes.HIIT;
  }
  return healthStore.healthDataTypes.WORKOUT;
}

function pad2(n: number): string {
  return (n < 10 ? '0' : '') + String(n);
}

/** Health Kit's localDate is MM/DD/YYYY. */
function localDateOf(ms: number): string {
  const d: Date = new Date(ms);
  return pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()) + '/' + String(d.getFullYear());
}

/** Health Kit's timeZone is +HHMM / -HHMM. */
function zoneOf(): string {
  const minutes: number = -new Date().getTimezoneOffset();
  const sign: string = minutes >= 0 ? '+' : '-';
  const abs: number = Math.abs(minutes);
  return sign + pad2(Math.floor(abs / 60)) + pad2(abs % 60);
}

function messageOf(e: Object): string {
  const err = e as BusinessError;
  return err.message ? err.message : String(e);
}

/** An element of a JSON string array arrives as raw JSON ("weight"); take the text out of it. */
function unquote(raw: string): string {
  if (raw.length >= 2 && raw.charAt(0) === '"') {
    return new Json('{"v":' + raw + '}').str('v', '');
  }
  return raw;
}

export class HealthConnectPlugin extends PluginHandler {
  private context: common.UIAbilityContext | null = null;
  private initPromise: Promise<void> | null = null;
  private sourceId: string = '';

  /** The UIAbility context every Health Service Kit call needs. */
  private uiContext(): common.UIAbilityContext {
    if (this.context) {
      return this.context;
    }
    const c: common.UIAbilityContext = getContext() as common.UIAbilityContext;
    this.context = c;
    return c;
  }

  /** The kit has to be initialised before any other call. A failure here means it is not on this device. */
  private async ready(): Promise<common.UIAbilityContext> {
    const c: common.UIAbilityContext = this.uiContext();
    if (this.initPromise === null) {
      this.initPromise = healthStore.init(c);
    }
    try {
      await this.initPromise;
    } catch (e) {
      this.initPromise = null;
      throw new Error(messageOf(e));
    }
    return c;
  }

  /** The data source openGym writes under, registered once and reused. */
  private async dataSourceId(): Promise<string> {
    if (this.sourceId.length > 0) {
      return this.sourceId;
    }
    const base: healthStore.DataSourceBase = {};
    const id: string = await healthStore.insertDataSource(base);
    this.sourceId = id;
    return id;
  }

  async invoke(method: string, payload: string): Promise<string> {
    const json = new Json(payload);
    switch (method) {
      case 'status':
        return this.status();
      case 'requestPermissions':
        return this.requestPermissions(json);
      case 'write':
        return this.write(json);
      case 'remove':
        return this.remove(json);
      case 'readWeights':
        return this.readWeights(json);
      case 'readHeartRate':
        return this.readHeartRate(json);
      case 'openSettings':
        return this.openSettings();
      case 'setEnabled':
        // HarmonyOS has no paired watch to mirror the switch to; the iPhone path uses it.
        return Json.build(['"value":' + true]);
      default:
        return Json.error('HealthConnect: unknown method ' + method);
    }
  }

  /**
   * status() -> { status, granted }. "available" means the Health Service Kit answered init();
   * "granted" means it also reports at least one read authorisation. Before the user grants
   * anything (or before AGC is configured) granted stays false — the page's expected state.
   */
  private async status(): Promise<string> {
    let available: boolean = false;
    let granted: boolean = false;
    try {
      await this.ready();
      available = true;
      const req: healthStore.AuthorizationRequest = {
        readDataTypes: [healthStore.healthDataTypes.WEIGHT, healthStore.healthDataTypes.HEART_RATE],
        writeDataTypes: [healthStore.healthDataTypes.WEIGHT]
      };
      const res: healthStore.AuthorizationResponse = await healthStore.getAuthorizations(req);
      granted = res.readDataTypes.length > 0;
    } catch (e) {
      console.info('[HealthConnect] status: ' + messageOf(e));
    }
    return Json.build([
      '"status":' + Json.str(available ? 'available' : 'unsupported'),
      '"granted":' + String(granted)
    ]);
  }

  /**
   * requestPermissions({ read: [..], write: [..] }) -> { granted, read: {..} }.
   * Called with no arguments by enableHealth(): then it asks for the two types openGym writes.
   */
  private async requestPermissions(json: Json): Promise<string> {
    const readItems: string[] = json.arrItems('read');
    const writeItems: string[] = json.arrItems('write');
    const readTypes: healthStore.DataType[] = [];
    const writeTypes: healthStore.DataType[] = [];
    const readNames: string[] = [];

    for (const item of readItems) {
      const one: string = unquote(item);
      const dt: healthStore.DataType | null = dataTypeOf(one);
      if (dt !== null) {
        readTypes.push(dt);
        readNames.push(one);
      }
    }
    for (const item of writeItems) {
      const one: string = unquote(item);
      const dt: healthStore.DataType | null = dataTypeOf(one);
      if (dt !== null) {
        writeTypes.push(dt);
      }
    }
    if (readTypes.length === 0 && writeTypes.length === 0) {
      // enableHealth() asks with no payload: request what openGym writes.
      readTypes.push(healthStore.healthDataTypes.WEIGHT);
      writeTypes.push(healthStore.healthDataTypes.WEIGHT);
      readNames.push('weight');
    }

    try {
      const c: common.UIAbilityContext = await this.ready();
      const req: healthStore.AuthorizationRequest = {
        readDataTypes: readTypes,
        writeDataTypes: writeTypes
      };
      const res: healthStore.AuthorizationResponse = await healthStore.requestAuthorizations(c, req);
      const pairs: string[] = [];
      for (const name of readNames) {
        pairs.push(Json.str(name) + ':' + String(res.readDataTypes.length > 0));
      }
      return Json.build([
        '"granted":' + String(res.readDataTypes.length > 0 || res.writeDataTypes.length > 0),
        '"read":{' + pairs.join(',') + '}'
      ]);
    } catch (e) {
      return Json.error(messageOf(e));
    }
  }

  /**
   * write({ sessions: [{ id, start, end, type, title, notes }], weights: [{ id, time, kg }] }).
   * Weight samples go in as typed SamplePoints; workouts as ExerciseSequences, so both show up
   * in 华为运动健康 next to the user's other training.
   */
  private async write(json: Json): Promise<string> {
    try {
      await this.ready();
      const id: string = await this.dataSourceId();
      const weights: string[] = json.arrItems('weights');
      const sessions: string[] = json.arrItems('sessions');

      for (const raw of weights) {
        const one = new Json(raw);
        const at: number = one.num('time', 0);
        const kg: number = one.num('kg', 0);
        if (at <= 0 || kg <= 0) {
          continue;
        }
        const fields: Record<string, healthStore.HealthValueType> = {};
        fields['bodyWeight'] = kg;
        const point: healthStore.SamplePoint = {
          dataType: healthStore.healthDataTypes.WEIGHT,
          dataSourceId: id,
          localDate: localDateOf(at),
          startTime: at,
          endTime: at,
          timeZone: zoneOf(),
          modifiedTime: Date.now(),
          fields: fields
        };
        await healthStore.saveData(point);
      }

      for (const raw of sessions) {
        const one = new Json(raw);
        const start: number = one.num('start', 0);
        const end: number = one.num('end', 0);
        if (start <= 0 || end <= start) {
          continue;
        }
        const type: string = one.str('type', '');
        const summaries: Record<string, healthStore.ExerciseSummary> = {};
        const sequence: healthStore.ExerciseSequence = {
          dataType: healthStore.healthDataTypes.WORKOUT,
          dataSourceId: id,
          localDate: localDateOf(start),
          startTime: start,
          endTime: end,
          timeZone: zoneOf(),
          modifiedTime: Date.now(),
          exerciseType: workoutTypeOf(type),
          duration: end - start,
          summaries: summaries
        };
        await healthStore.saveData(sequence);
      }
      return Json.build(['"value":' + true]);
    } catch (e) {
      return Json.error(messageOf(e));
    }
  }

  /**
   * remove({ sessions: [id], weights: [id] }) -> { left: [] }.
   * Health Kit has no id-based delete: a request is a data type plus a time window. openGym's
   * records all live under its own data source, so restricting the request to that source takes
   * out exactly what this app wrote and nothing the user (or another app) recorded.
   */
  private async remove(json: Json): Promise<string> {
    const sessions: string[] = json.arrItems('sessions');
    const weights: string[] = json.arrItems('weights');
    if (sessions.length === 0 && weights.length === 0) {
      return Json.build(['"left":[]']);
    }
    try {
      await this.ready();
      const options: healthStore.DataSourceOptions = { dataSourceId: this.sourceId };
      const req: healthStore.SamplePointDeleteRequest = {
        dataType: healthStore.healthDataTypes.WEIGHT,
        startTime: 0,
        endTime: Date.now(),
        dataSourceOptions: options
      };
      await healthStore.deleteData(req);
      return Json.build(['"left":[]']);
    } catch (e) {
      return Json.error(messageOf(e));
    }
  }

  /**
   * readWeights({ since }) -> { records: [{ id, t, kg }] } — weigh-ins other apps saved to the
   * phone. The id is derived from the sample's start time so a second read is a no-op in
   * lib/health-read.js' mergeWeighIns().
   */
  private async readWeights(json: Json): Promise<string> {
    try {
      await this.ready();
      const since: number = json.num('since', 0);
      const req: healthStore.SamplePointReadRequest = {
        samplePointDataType: healthStore.healthDataTypes.WEIGHT,
        startTime: since > 0 ? since : 0,
        endTime: Date.now()
      };
      const rows: healthStore.SamplePoint[] = await healthStore.readData(req);
      const records: string[] = [];
      for (const row of rows) {
        const at: number = Math.floor(row.startTime);
        const kg: number = Number(String(row.fields['bodyWeight']));
        if (at <= 0 || !(kg > 0)) {
          continue;
        }
        records.push('{"id":' + Json.str('hw-w-' + String(at)) + ',"t":' + String(at) + ',"kg":' + String(kg) + '}');
      }
      return Json.build(['"records":[' + records.join(',') + ']']);
    } catch (e) {
      return Json.error(messageOf(e));
    }
  }

  /**
   * readHeartRate({ from, to }) -> { samples: [[ms, bpm], …] } — the heart rate during a
   * finished workout, sample by sample, so lib/health-read.js' hrFromSamples() works unchanged.
   */
  private async readHeartRate(json: Json): Promise<string> {
    try {
      await this.ready();
      const from: number = json.num('from', 0);
      const to: number = json.num('to', 0);
      const req: healthStore.SamplePointReadRequest = {
        samplePointDataType: healthStore.healthDataTypes.HEART_RATE,
        startTime: from > 0 ? from : 0,
        endTime: to > from ? to : Date.now()
      };
      const rows: healthStore.SamplePoint[] = await healthStore.readData(req);
      const samples: string[] = [];
      for (const row of rows) {
        const at: number = Math.floor(row.startTime);
        const bpm: number = Number(String(row.fields['bpm']));
        if (at <= 0 || !(bpm > 0)) {
          continue;
        }
        samples.push('[' + String(at) + ',' + String(bpm) + ']');
      }
      return Json.build(['"samples":[' + samples.join(',') + ']']);
    } catch (e) {
      return Json.error(messageOf(e));
    }
  }

  /** openSettings() — heal the user to the system's own Health authorisation screen. */
  private async openSettings(): Promise<string> {
    // Health Service Kit raises its own authorisation sheet from requestAuthorizations(); there
    // is no public "open settings" call for a third-party app. Resolve so the page never hangs.
    return Json.build(['"value":' + true]);
  }
}
