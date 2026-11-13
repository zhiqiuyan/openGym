import { useEffect, useRef, useState } from 'react'
import { nativeCall, addNativeListener, removeAllNativeListeners, hasNativeBridge } from '../lib/harmony/bridge.js'
import { t } from '../lib/i18n.js'
import { addWeighIn, dayOf, timeOf } from '../lib/weigh-ins.js'
import { fromKg } from '../lib/body-metrics.js'
import Icon from './Icon.jsx'
import { Section, Row, Button, TextField } from './ui.jsx'

/* HarmonyOS: a Bluetooth weight scale, reached straight from 集成 → This device. It reuses the
   native Scale plugin (the BLE scan/connect/read logic lives in the ArkTS side, because ArkWeb
   cannot touch @kit.ConnectivityKit). The page can either read a scale or type the weight itself;
   both land in the same weigh-in history the charts and BMI read. */

const MAX_WEIGHT = { kg: 400, lb: 880 }
const SCAN_MS = 12000

export function BleScaleSheet({ unit, weight, update, toast, close }) {
  const [bluetooth, setBluetooth] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [devices, setDevices] = useState([])
  const [connectedId, setConnectedId] = useState(null)
  const [connState, setConnState] = useState('idle')
  const [connMsg, setConnMsg] = useState('')
  const [live, setLive] = useState(null)
  const [draftW, setDraftW] = useState(weight == null ? '' : String(weight))
  const [problem, setProblem] = useState('')
  const scanTimer = useRef(null)

  // Subscribe to the native events for the lifetime of the sheet.
  useEffect(() => {
    if (!hasNativeBridge()) return undefined
    const onDevice = d => {
      setDevices(prev => {
        const entry = { deviceId: d.deviceId, name: d.name || t('Unknown device'), rssi: d.rssi, adapterId: d.adapterId, shortName: d.shortName, isScale: d.isScale }
        const i = prev.findIndex(x => x.deviceId === entry.deviceId)
        if (i >= 0) { const next = prev.slice(); next[i] = entry; return next }
        return [...prev, entry]
      })
    }
    const onReading = r => {
      setLive({ weightKg: r.weightKg, bodyFatPercent: r.bodyFatPercent, state: r.state })
      // A stable reading fills the form so the user only has to confirm; a "broadcast" scale
      // (三诺 / some 香山 / 乐心) reports straight from the advertisement without a connection.
      if (r.state === 'stable' && r.weightKg > 0) {
        setDraftW(String(fromKg(r.weightKg, unit)))
      }
    }
    const onState = s => { setConnState(s.state); if (s.message) setConnMsg(s.message) }
    addNativeListener('Scale.deviceFound', onDevice)
    addNativeListener('Scale.reading', onReading)
    addNativeListener('Scale.state', onState)
    nativeCall('Scale', 'getState').then(j => setBluetooth(j.bluetooth)).catch(() => setBluetooth('unknown'))
    return () => {
      removeAllNativeListeners('Scale.deviceFound')
      removeAllNativeListeners('Scale.reading')
      removeAllNativeListeners('Scale.state')
      nativeCall('Scale', 'stopScan').catch(() => {})
      nativeCall('Scale', 'disconnect').catch(() => {})
      if (scanTimer.current) clearTimeout(scanTimer.current)
    }
  }, [unit])

  const clearScanTimer = () => { if (scanTimer.current) { clearTimeout(scanTimer.current); scanTimer.current = null } }

  const startScan = async () => {
    setProblem('')
    try {
      const st = await nativeCall('Scale', 'getState')
      setBluetooth(st.bluetooth)
      if (st.bluetooth === 'off') { setProblem(t('Bluetooth is off. Turn it on, then scan again.')); return }
      if (st.bluetooth === 'unknown') await nativeCall('Scale', 'requestPermissions').catch(() => {})
    } catch { /* getState unavailable: still try to scan */ }
    setDevices([])
    setScanning(true)
    clearScanTimer()
    scanTimer.current = setTimeout(() => { setScanning(false); nativeCall('Scale', 'stopScan').catch(() => {}) }, SCAN_MS)
    nativeCall('Scale', 'scan').catch(() => { setScanning(false); clearScanTimer() })
  }

  const stopScan = () => { setScanning(false); clearScanTimer(); nativeCall('Scale', 'stopScan').catch(() => {}) }

  const connect = deviceId => {
    if (scanning) stopScan()
    setConnectedId(deviceId)
    setLive(null)
    setConnState('connecting')
    nativeCall('Scale', 'connect', { deviceId }).catch(e => setProblem(e?.message || t('Could not connect')))
  }

  const disconnect = () => { nativeCall('Scale', 'disconnect').catch(() => {}); setConnectedId(null); setConnState('idle') }

  const save = () => {
    const w = Number(String(draftW).trim())
    if (!String(draftW).trim() || !Number.isFinite(w) || w <= 0) { setProblem(t('Enter a weight first.')); return }
    update(s => addWeighIn(s, { d: dayOf(Date.now()), at: timeOf(Date.now()), w }))
    toast?.(t('Weigh-in saved'))
    close()
  }

  const scales = devices.filter(d => d.isScale)
  const others = devices.filter(d => !d.isScale)
  const liveShown = live && live.weightKg > 0 ? fromKg(live.weightKg, unit).toFixed(1) : null

  return <>
    <h3 className="hm-sheet-h"><Icon name="bluetooth" /><span>{t('Bluetooth scale')}</span></h3>
    <p className="hm-sheet-lead">{t('Connect a Bluetooth scale and read it here, or type the weight yourself.')}</p>

    {!hasNativeBridge() && <p className="hm-sheet-problem" role="alert">{t('This feature needs the HarmonyOS app.')}</p>}
    {bluetooth === 'off' && <p className="hm-sheet-problem" role="alert">{t('Bluetooth is off. Turn it on, then scan again.')}</p>}
    {problem && <p className="hm-sheet-problem" role="alert">{problem}</p>}

    {/* Device list — scales first, then anything else the scan turned up. */}
    <Section title={t('Devices')}>
      <div className="intg-btns" style={{ marginBottom: 8 }}>
        {scanning
          ? <Button variant="tinted" onClick={stopScan}>{t('Stop scanning')}</Button>
          : <Button variant="primary" icon="bluetooth" onClick={startScan}>{t('Scan')}</Button>}
      </div>
      {scales.length === 0 && others.length === 0 && !scanning && (
        <Row title={t('No scales found yet')} subtitle={t('Tap Scan, and step on the scale so it advertises.')} />
      )}
      {scales.map(d => (
        <Row key={d.deviceId} title={d.name} subtitle={d.shortName}
          accessory={connectedId === d.deviceId ? 'checkCircle' : 'chevron'}
          onClick={() => connectedId === d.deviceId ? disconnect() : connect(d.deviceId)} />
      ))}
      {others.map(d => (
        <Row key={d.deviceId} title={d.name} subtitle={t('Not a recognised scale')} disabled />
      ))}
    </Section>

    {/* Live reading from the connected (or broadcasting) scale. */}
    {connectedId && (
      <Section title={t('Reading')}>
        <div className="ble-live">
          <div className="ble-live-w">{liveShown ?? '--.--'}<span className="ble-live-u">{unit}</span></div>
          <div className="ble-live-state">
            {connState === 'connected' && !liveShown && t('Stand on the scale…')}
            {connState !== 'connected' && (connMsg || t('Connecting…'))}
            {live && live.state === 'unstable' && t('Measuring…')}
            {live && live.state === 'stable' && t('Stable — tap Save to record.')}
          </div>
          {live && typeof live.bodyFatPercent === 'number' && (
            <div className="ble-live-fat">{t('Body fat')} {live.bodyFatPercent.toFixed(1)}%</div>
          )}
        </div>
      </Section>
    )}

    {/* Manual entry — always available, and pre-filled by a stable reading. */}
    <Section title={t('Weight')}>
      <div className="hm-sheet-field">
        <TextField type="number" inputMode="decimal" step="any" min={unit === 'lb' ? 44 : 20} max={MAX_WEIGHT[unit]}
          value={draftW} placeholder="—" aria-label={t('Weight')} autoFocus
          onChange={e => { setDraftW(e.target.value); setProblem('') }} />
        <span className="hm-unit">{unit}</span>
      </div>
    </Section>

    <div className="hm-sheet-btns">
      <Button variant="plain" onClick={close}>{t('Cancel')}</Button>
      <Button variant="primary" onClick={save}>{t('Save')}</Button>
    </div>
  </>
}
