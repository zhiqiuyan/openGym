// Huawei Health (华为运动健康) connection for the HarmonyOS edition.
//
// The important design decision: HUAWEI Health Kit's OAuth token exchange needs the app's
// client_secret, and Huawei's own documentation has that step happen on a server you control.
// A HAP is a public artifact — a secret shipped inside one is not a secret. So this module never
// holds the secret, the authorization code or the access token. It talks to a small relay the
// operator hosts: the relay owns the AGC credentials, does the code → token exchange and maps
// Health Kit's per-data-type endpoints into one payload. See docs/HUAWEI_HEALTH.md.
//
// What stays on the phone:
//   S.huaweiHealth   non-secret configuration, switches, last sync and the last values read
//   <storage>.hh.session   an opaque, revocable relay session id (not an access token)
//
// The relay contract is deliberately small and versioned; a relay that answers a different shape
// fails validation here instead of quietly writing junk into the training history.

import { addWeighIn, allReadings, dayOf, timeOf } from './weigh-ins.js'
import { fromKg, heightCm, bodyKg } from './body-metrics.js'

// Confirmed against HUAWEI Developers' Health Kit OAuth documentation (2026-11-06). The
// exact scopes an app may request are the ones approved for its AGC app — the page lets the
// operator trim this list; a scope not approved there makes the authorization page refuse.
export const AUTH_URL = 'https://oauth-login.cloud.huawei.com/oauth2/v3/authorize'
export const TOKEN_URL = 'https://oauth-login.cloud.huawei.com/oauth2/v3/token'
export const DEFAULT_SCOPES = Object.freeze([
  'openid',
  'https://www.huawei.com/healthkit/heightweight.read',
  'https://www.huawei.com/healthkit/heightweight.write',
  'https://www.huawei.com/healthkit/activityrecord.read',
  'https://www.huawei.com/healthkit/activityrecord.write',
])

export const READ_TYPES = Object.freeze(['height', 'weight', 'steps', 'heartRate', 'sleep', 'workouts'])

export class HealthKitError extends Error {
  constructor(code, message) { super(message); this.name = 'HealthKitError'; this.code = code }
}

/** The non-secret part of the connection, stored with the rest of the profile's settings. */
export function defaultConfig() {
  return {
    clientId: '', redirectUri: '', relayUrl: '', scopes: [...DEFAULT_SCOPES],
    read: { height: true, weight: true, steps: true, heartRate: false, sleep: false, workouts: false },
    write: { weight: true, workouts: true },
    connected: false, lastSync: null, lastError: null, lastData: null,
  }
}

export function configOf(S) {
  const d = defaultConfig(), c = S?.huaweiHealth
  if (!c || typeof c !== 'object') return d
  return {
    ...d, ...c,
    scopes: Array.isArray(c.scopes) && c.scopes.length ? c.scopes.filter(s => typeof s === 'string') : d.scopes,
    read: { ...d.read, ...(c.read || {}) },
    write: { ...d.write, ...(c.write || {}) },
  }
}

/** Missing pieces of the setup, as stable codes the page and tests can both name. */
export function configGaps(c) {
  const gaps = []
  if (!c.clientId?.trim()) gaps.push('clientId')
  if (!c.redirectUri?.trim()) gaps.push('redirectUri')
  if (!c.relayUrl?.trim()) gaps.push('relayUrl')
  return gaps
}

/** Absolute, safe https URL for a relay endpoint. */
export function relayUrl(config, path) {
  const base = String(config?.relayUrl || '').trim().replace(/\/+$/, '')
  if (!/^https:\/\//i.test(base)) throw new HealthKitError('config_relay', 'The relay must be an https:// URL.')
  return base + path
}

/**
 * The HUAWEI ID consent screen. `state` is a CSRF nonce the page keeps until the callback.
 * `access_type=offline` is what gives the relay a refresh token, so the user does this once.
 */
export function authUrl(config, state) {
  const gaps = configGaps(config)
  if (gaps.length) throw new HealthKitError('config_incomplete', `Missing: ${gaps.join(', ')}`)
  if (!state) throw new HealthKitError('state_missing', 'A state nonce is required.')
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId.trim(),
    redirect_uri: config.redirectUri.trim(),
    scope: (config.scopes || DEFAULT_SCOPES).join(' '),
    access_type: 'offline',
    display: 'touch',
    state,
  })
  return `${AUTH_URL}?${q.toString()}`
}

/** Read the relay's callback: `og://health?session=…&state=…`, or a plain URL/query string. */
export function parseCallback(input) {
  const s = String(input || '').trim()
  if (!s) return { session: null, state: null, error: null }
  let u
  try { u = new URL(s, 'https://callback.invalid') } catch { return { session: null, state: null, error: null } }
  const error = u.searchParams.get('error') || u.searchParams.get('error_description')
  return { session: u.searchParams.get('session') || null, state: u.searchParams.get('state') || null, error }
}

// ---------------------------------------------------------------------------
// Session storage. A relay session is opaque and revocable, but it is still a credential:
// on a device with the native bridge the page injects SecureStorage; on the web it falls back
// to localStorage. configureStorage() lets tests supply a fake without touching either.
// ---------------------------------------------------------------------------

const KEY = 'opengym.huaweiHealth.session'
let injected = null
export function configureStorage(store) { injected = store }
export function resetStorage() { injected = null }

async function storage() {
  if (injected) return injected
  if (typeof localStorage !== 'undefined' && localStorage) return {
    get: k => localStorage.getItem(k),
    set: (k, v) => localStorage.setItem(k, v),
    remove: k => localStorage.removeItem(k),
  }
  return { get: () => null, set: () => {}, remove: () => {} }
}

export async function readSession() { return (await storage()).get(KEY) || null }
export async function saveSession(session) { (await storage()).set(KEY, String(session)) }
export async function clearSession() { (await storage()).remove(KEY) }

// ---------------------------------------------------------------------------
// Transport. On Harmony the request goes through CapacitorHttp (the native HTTP path, no CORS
// preflight from a local WebView origin); elsewhere plain fetch is enough. Both are wrapped so
// tests can inject a requester instead of opening a socket.
// ---------------------------------------------------------------------------

let injectedRequest = null
export function configureRequest(fn) { injectedRequest = fn }
export function resetRequest() { injectedRequest = null }

async function httpJson(url, { method = 'GET', body = null, session = null } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (session) headers.Authorization = `Bearer ${session}`
  let res
  if (injectedRequest) {
    res = await injectedRequest({ url, method, headers, body })
  } else if (import.meta.env?.VITE_HARMONY === '1') {
    const { CapacitorHttp } = await import('@capacitor/core')
    res = await CapacitorHttp.request({ url, method, headers, data: body === null ? undefined : body, responseType: 'text' })
  } else {
    res = await fetch(url, { method, headers, body: body === null ? undefined : JSON.stringify(body) })
  }
  const status = Number(res.status)
  let data = res.data
  if (data === undefined) {
    const text = typeof res.text === 'function' ? await res.text() : ''
    try { data = text ? JSON.parse(text) : null } catch { data = null }
  }
  return { status, data, ok: res.ok === undefined ? status >= 200 && status < 300 : !!res.ok }
}

function check(res) {
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new HealthKitError('session_expired', 'The relay session expired or was revoked. Reconnect to Huawei Health.')
    throw new HealthKitError('relay_http', `The relay answered ${res.status}.`)
  }
  if (!res.data || typeof res.data !== 'object') throw new HealthKitError('relay_shape', 'The relay did not answer with the expected JSON payload.')
  return res.data
}

/**
 * A finished authorization lands on the relay, which hands back a session id. The page either
 * receives that id in a deep link or the operator pastes it; either way this verifies it against
 * the relay before calling the device "connected".
 */
export async function connect(config, session) {
  if (!session) throw new HealthKitError('session_missing', 'No relay session was returned.')
  const res = await httpJson(relayUrl(config, '/session'), { method: 'POST', body: { session } })
  const data = check(res)
  if (data.active === false) throw new HealthKitError('session_expired', 'That relay session is no longer active.')
  await saveSession(session)
  return data
}

export async function disconnect(config, session = null) {
  const s = session || await readSession()
  if (s) {
    try { await httpJson(relayUrl(config, '/revoke'), { method: 'POST', body: { session: s }, session: s }) } catch { /* revocation is best effort */ }
  }
  await clearSession()
}

/**
 * One round trip: read what the relay has, optionally hand it the recent local data to write
 * back. Everything Health Kit-specific (per-type endpoints, unit fields, activity record
 * mapping) stays in the relay; this side only knows the normalised shape below.
 */
export async function syncNow(config, session = null, S = null) {
  const gaps = configGaps(config)
  if (gaps.length) throw new HealthKitError('config_incomplete', `Missing: ${gaps.join(', ')}`)
  const s = session || await readSession()
  if (!s) throw new HealthKitError('not_connected', 'Connect to Huawei Health first.')
  const body = {
    session: s,
    read: READ_TYPES.filter(k => config.read?.[k]),
    write: config.write?.weight || config.write?.workouts ? collectForPush(S, config.write) : null,
  }
  const res = await httpJson(relayUrl(config, '/sync'), { method: 'POST', body, session: s })
  return check(res)
}

/**
 * What the relay receives to write back. Raw, unmodified local records: the relay owns the
 * mapping to Health Kit's activity/weight models, where the AGC-approved scopes live.
 */
export function collectForPush(S, write = {}) {
  const out = {}
  if (write.weight) {
    out.unit = S?.unit === 'lb' ? 'lb' : 'kg'
    out.weighIns = allReadings(S?.bodyweight || []).slice(-60).map(r => ({
      d: r.d, at: r.at || null, w: Number(r.w) || 0, sid: r.sid || r.id || null,
    }))
  }
  if (write.workouts) out.workouts = (Array.isArray(S?.workouts) ? S.workouts : []).slice(-30)
  return out
}

/**
 * Fold a normalised relay payload into the profile. Only height and weight become first-class
 * app data; steps/heart rate/sleep/workouts are shown as a read-only snapshot, because writing
 * another app's samples into the training history would change every chart and record.
 */
export function applyToState(S, payload, config) {
  const p = payload && typeof payload === 'object' ? payload : {}
  const changes = { height: 0, weight: 0 }
  if (!S) return changes
  const h = heightCm(p.heightCm)
  if (config?.read?.height && h !== null) { S.heightCm = h; changes.height = 1 }
  const kg = bodyKg(p.weightKg)
  if (config?.read?.weight && kg !== null) {
    const ms = Number(p.measuredAt) || Date.now()
    const sid = p.weightSid ? String(p.weightSid) : null
    const exists = sid && allReadings(S.bodyweight || []).some(r => r.sid && String(r.sid) === sid)
    if (!exists) {
      addWeighIn(S, {
        d: dayOf(ms), at: timeOf(ms), w: fromKg(kg, S.unit),
        t: ms, src: 'health', sid,
      })
      changes.weight = 1
    }
  }
  // The page's live config wins: its switches may not have been persisted yet.
  const c = { ...configOf(S), ...(config || {}) }
  S.huaweiHealth = {
    ...c,
    lastSync: Date.now(),
    lastError: null,
    lastData: {
      steps: Number.isFinite(Number(p.steps)) ? Number(p.steps) : null,
      heartRate: Number.isFinite(Number(p.heartRate)) ? Number(p.heartRate) : null,
      sleepMinutes: Number.isFinite(Number(p.sleepMinutes)) ? Number(p.sleepMinutes) : null,
      workouts: Array.isArray(p.workouts) ? p.workouts.length : null,
    },
    lastWritten: p.written && typeof p.written === 'object' ? p.written : null,
  }
  return changes
}

/** A short human-readable summary of a sync, for the toast on the page. */
export function syncSummary(changes, payload) {
  const bits = []
  if (changes.height) bits.push('height')
  if (changes.weight) bits.push('weight')
  if (payload?.written?.weight || payload?.written?.workouts) bits.push('sent to Huawei Health')
  return bits.length ? `Updated ${bits.join(', ')}.` : 'Nothing new to import.'
}
