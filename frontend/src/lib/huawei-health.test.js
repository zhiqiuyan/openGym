import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AUTH_URL, DEFAULT_SCOPES, configOf, configGaps, authUrl, relayUrl, parseCallback,
  connect, disconnect, syncNow, applyToState, collectForPush, syncSummary,
  configureStorage, resetStorage, readSession, configureRequest, resetRequest, HealthKitError,
} from './huawei-health.js'
import { allReadings } from './weigh-ins.js'

const cfg = (over = {}) => ({
  ...configOf(null),
  clientId: '123456789',
  redirectUri: 'https://relay.example.com/huawei/callback',
  relayUrl: 'https://relay.example.com/healthkit',
  ...over,
})

let store, requests, answer
beforeEach(() => {
  store = new Map()
  requests = []
  answer = { status: 200, ok: true, data: { active: true } }
  configureStorage({
    get: k => store.get(k) ?? null,
    set: (k, v) => store.set(k, v),
    remove: k => store.delete(k),
  })
  configureRequest(async req => { requests.push(req); return answer })
})
afterEach(() => { resetStorage(); resetRequest() })

const errCode = fn => Promise.resolve().then(fn).then(
  () => 'no error',
  e => e instanceof HealthKitError ? e.code : `unexpected:${e?.message}`,
)

describe('configuration', () => {
  it('fills defaults without letting a partial stored config drop the switches', () => {
    const c = configOf({ huaweiHealth: { clientId: 'x', read: { steps: false } } })
    expect(c.clientId).toBe('x')
    expect(c.read.steps).toBe(false)
    expect(c.read.weight).toBe(true)
    expect(c.scopes).toEqual([...DEFAULT_SCOPES])
  })
  it('names every missing field', () => {
    expect(configGaps(configOf(null))).toEqual(['clientId', 'redirectUri', 'relayUrl'])
    expect(configGaps(cfg())).toEqual([])
  })
  it('rejects a relay that is not https', () => {
    expect(() => relayUrl(cfg({ relayUrl: 'http://relay.example.com' }), '/sync'))
      .toThrow(/https:\/\//)
  })
})

describe('authorization', () => {
  it('builds the documented HUAWEI ID consent URL with openid and the approved scopes', () => {
    const u = new URL(authUrl(cfg(), 'nonce-42'))
    expect(u.origin + u.pathname).toBe(AUTH_URL)
    expect(u.searchParams.get('response_type')).toBe('code')
    expect(u.searchParams.get('client_id')).toBe('123456789')
    expect(u.searchParams.get('redirect_uri')).toBe('https://relay.example.com/huawei/callback')
    expect(u.searchParams.get('state')).toBe('nonce-42')
    expect(u.searchParams.get('access_type')).toBe('offline')
    expect(u.searchParams.get('display')).toBe('touch')
    expect(u.searchParams.get('scope')).toContain('openid')
    expect(u.searchParams.get('scope')).toContain('https://www.huawei.com/healthkit/heightweight.read')
  })
  it('refuses to start without the config or the CSRF nonce', async () => {
    expect(() => authUrl(configOf(null), 'n')).toThrow(HealthKitError)
    expect(() => authUrl(cfg(), '')).toThrow(/state/)
  })
  it('reads a session, state and a denial from a callback', () => {
    expect(parseCallback('og://health?session=abc&state=nonce-42')).toEqual({ session: 'abc', state: 'nonce-42', error: null })
    expect(parseCallback('https://x/cb?error=access_denied').error).toBe('access_denied')
    expect(parseCallback('').session).toBe(null)
  })
})

describe('connection lifecycle', () => {
  it('verifies the relay session before saving it', async () => {
    await connect(cfg(), 'sess-1')
    expect(await readSession()).toBe('sess-1')
    expect(requests[0].url).toBe('https://relay.example.com/healthkit/session')
    expect(requests[0].body).toEqual({ session: 'sess-1' })
  })
  it('does not save an inactive or rejected session', async () => {
    answer = { status: 200, ok: true, data: { active: false } }
    expect(await errCode(() => connect(cfg(), 'bad'))).toBe('session_expired')
    expect(await readSession()).toBe(null)
  })
  it('revocation is best effort: a failing relay still clears the local session', async () => {
    await connect(cfg(), 'sess-1')
    expect(await readSession()).toBe('sess-1')
    answer = { status: 500, ok: false, data: {} }
    await disconnect(cfg(), 'sess-1')
    expect(await readSession()).toBe(null)
  })
})

describe('sync', () => {
  it('will not sync before connecting or with an incomplete setup', async () => {
    expect(await errCode(() => syncNow(configOf(null)))).toBe('config_incomplete')
    expect(await errCode(() => syncNow(cfg()))).toBe('not_connected')
  })
  it('sends only the enabled read types, plus the local records to write back', async () => {
    await connect(cfg(), 'sess-1')
    answer = { status: 200, ok: true, data: { heightCm: 172, weightKg: 70 } }
    const S = { unit: 'kg', bodyweight: [], workouts: [{ d: '2026-11-06' }] }
    const payload = await syncNow(cfg({ read: { ...cfg().read, heartRate: false, workouts: false } }), 'sess-1', S)
    expect(payload.heightCm).toBe(172)
    const body = requests.at(-1).body
    expect(body.read).toContain('weight')
    expect(body.read).not.toContain('workouts')
    expect(body.write.weighIns).toEqual([])
    expect(body.write.workouts).toHaveLength(1)
    expect(requests.at(-1).headers.Authorization).toBe('Bearer sess-1')
  })
  it('turns a 401 into a reconnect hint and a bad payload into a shape error', async () => {
    await connect(cfg(), 'sess-1')
    answer = { status: 401, ok: false, data: {} }
    expect(await errCode(() => syncNow(cfg(), 'sess-1'))).toBe('session_expired')
    answer = { status: 200, ok: true, data: 'not json-shaped' }
    expect(await errCode(() => syncNow(cfg(), 'sess-1'))).toBe('relay_shape')
  })
})

describe('folding remote data into the profile', () => {
  it('writes height and one weigh-in, in the profile unit, with a stable source id', () => {
    const S = { unit: 'lb', bodyweight: [] }
    const t = new Date('2026-11-06T08:20:00').getTime()
    const changes = applyToState(S, { heightCm: 172, weightKg: 70, measuredAt: t, weightSid: 'hk-1', steps: 8123 }, cfg())
    expect(changes).toEqual({ height: 1, weight: 1 })
    expect(S.heightCm).toBe(172)
    const readings = allReadings(S.bodyweight)
    expect(readings).toHaveLength(1)
    expect(readings[0].src).toBe('health')
    expect(readings[0].sid).toBe('hk-1')
    expect(readings[0].w).toBe(154.3) // 70 kg in lb, rounded like a scale
    expect(S.huaweiHealth.lastData.steps).toBe(8123)
    expect(S.huaweiHealth.lastSync).toBeGreaterThan(0)
  })
  it('never imports the same remote sample twice', () => {
    const S = { unit: 'kg', bodyweight: [] }
    const p = { heightCm: 172, weightKg: 70, weightSid: 'hk-1' }
    applyToState(S, p, cfg())
    const again = applyToState(S, p, cfg())
    expect(again.weight).toBe(0)
    expect(allReadings(S.bodyweight)).toHaveLength(1)
  })
  it('honours the read switches and ignores implausible values', () => {
    const S = { unit: 'kg', bodyweight: [] }
    const c = cfg({ read: { ...cfg().read, height: false } })
    applyToState(S, { heightCm: 172, weightKg: 9999 }, c)
    expect(S.heightCm).toBeUndefined()
    expect(allReadings(S.bodyweight)).toHaveLength(0)
  })
  it('keeps the page config when it has not been persisted yet', () => {
    const S = { unit: 'kg', bodyweight: [] }
    const c = cfg({ read: { ...cfg().read, steps: false } })
    applyToState(S, {}, c)
    expect(S.huaweiHealth.read.steps).toBe(false)
  })
  it('collects raw local records for the relay instead of inventing Health Kit fields', () => {
    const S = { unit: 'kg', bodyweight: [{ d: '2026-11-06', w: 70, t: 1 }], workouts: [{ d: '2026-11-06' }] }
    expect(collectForPush(S, { weight: true, workouts: false })).toEqual({
      unit: 'kg', weighIns: [{ d: '2026-11-06', at: null, w: 70, sid: '0' }],
    })
  })
  it('summarises what changed', () => {
    expect(syncSummary({ height: 1, weight: 1 }, { written: { weight: 1 } })).toMatch(/height, weight/)
    expect(syncSummary({ height: 0, weight: 0 }, {})).toBe('Nothing new to import.')
  })
})
