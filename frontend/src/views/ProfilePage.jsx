// Settings → Personal information (HarmonyOS edition).
//
// HarmonyOS 7.0 / HarmonyOS NEXT visual language: one calm, rounded hero card that carries the
// number that matters, grouped fields underneath with generous spacing, no hairline boxes around
// every row, and colour used only for meaning (the BMI band). All type sizes come from the
// project's --fs-* tokens so the light/dark design review keeps holding.
//
// Data lives in the profile state, next to what the app already keeps: S.sex and S.birthYear are
// the ones the strength levels read, and the weigh-in history (S.bodyweight) is the source of
// truth for weight. New fields here never shadow those.
//
// v1.2.0: the "Your details" fields no longer draw a full-width input each: one row per fact,
// the number typed in a sheet with its own h3 heading. Health services and weigh-in logging moved
// to Settings → Integrations; this page is about the person (name, photo, body).
// v1.2.1: "Your details" and "Derived" now share the exact same Row geometry — 29px icon rail,
// 11/14px padding, 46px min-height, body-sized title, right-aligned value and the same hairline
// start — with a small tinted icon per field. The value is plain text, so no input can be too wide.

import React, { useRef, useState } from 'react'
import { Section, Row, Button, TextField } from '../components/ui.jsx'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import Icon from '../components/Icon.jsx'
import {
  bmiOf, bandOf, gaugePct, healthyRange, ageOf, bmrOf,
  toKg, fromKg, heightCm, bodyFatPct, birthYear, latestWeight,
} from '../lib/body-metrics.js'

const num = (v, fallback = '') => (v === null || v === undefined || Number.isNaN(v) ? fallback : String(v))
const sheet = render => useUI.getState().openSheet(render)

/* A sheet with its own third-level heading: the number is typed here, not in a field that
   stretches across the whole page. Shared by every numeric row and by the nickname sheet. */
function NumberSheet({ title, value, unit, min, max, step = 'any', onCommit, close, lead }) {
  const [draft, setDraft] = useState(num(value))
  const [problem, setProblem] = useState('')
  const save = () => {
    const raw = String(draft).trim()
    const n = raw === '' ? null : Number(raw)
    if (n !== null && (!Number.isFinite(n) || n < min || n > max)) {
      setProblem(t('Enter a number between {0} and {1}.', min, max))
      return
    }
    onCommit(n)
    close()
  }
  return <>
    <h3 className="hm-sheet-h">{title}</h3>
    <p className="hm-sheet-lead">{lead || t('Type a number, then save.')}</p>
    <div className="hm-sheet-field">
      <TextField type="number" inputMode="decimal" min={min} max={max} step={step}
        value={draft} placeholder="—" aria-label={title} autoFocus
        onChange={e => { setDraft(e.target.value); setProblem('') }} />
      {unit && <span className="hm-unit">{unit}</span>}
    </div>
    {problem && <p className="hm-sheet-problem" role="alert">{problem}</p>}
    <div className="hm-sheet-btns">
      <Button variant="plain" onClick={close}>{t('Cancel')}</Button>
      <Button variant="primary" onClick={save}>{t('Save')}</Button>
    </div>
  </>
}

/* One fact per row, drawn with the very same Row the Derived section uses: the same 29px icon
   rail, 11/14px padding, 46px min-height, body-sized title, right-aligned value and hairline
   that starts after the icon rail. The value is plain text, not a field, so it can never stretch
   across the page; --acc-ink is the only hint that the whole row is editable. */
function NumberRow({ icon, iconTint, label, value, unit, min, max, step, onCommit }) {
  const shown = num(value)
  const open = () => sheet(close => <NumberSheet title={label} value={value} unit={unit}
    min={min} max={max} step={step} onCommit={onCommit} close={close} />)
  return <Row icon={icon} iconTint={iconTint} title={label} className="hm-lrow"
    value={shown ? (unit ? `${shown} ${unit}` : shown) : '—'} onClick={open} />
}

function ChoiceSheet({ title, options, value, onCommit, close }) {
  return <>
    <h3 className="hm-sheet-h">{title}</h3>
    <div className="hm-choice">
      {options.map(o => <button key={o.value} type="button" className={'lrow tap hm-choice-row' + (String(value) === String(o.value) ? ' on' : '')}
        onClick={() => { onCommit(o.value); close() }}>
        <span className="lrow-m"><span className="lrow-t">{o.label}</span></span>
      </button>)}
    </div>
    <div className="hm-sheet-btns"><Button variant="plain" onClick={close}>{t('Cancel')}</Button></div>
  </>
}

function ChoiceRow({ icon, iconTint, label, value, options, onCommit }) {
  const current = options.find(o => String(o.value) === String(value))
  const open = () => sheet(close => <ChoiceSheet title={label} options={options} value={value} onCommit={onCommit} close={close} />)
  return <Row icon={icon} iconTint={iconTint} title={label} className="hm-lrow"
    value={current?.label || '—'} onClick={open} />
}

function NameSheet({ value, onCommit, close }) {
  const [draft, setDraft] = useState(value || '')
  return <>
    <h3 className="hm-sheet-h">{t('Nickname')}</h3>
    <p className="hm-sheet-lead">{t('Shown at the top of Settings.')}</p>
    <div className="hm-sheet-field">
      <TextField value={draft} maxLength={24} placeholder={t('Your nickname')} aria-label={t('Nickname')}
        autoFocus onChange={e => setDraft(e.target.value)} />
    </div>
    <div className="hm-sheet-btns">
      <Button variant="plain" onClick={close}>{t('Cancel')}</Button>
      <Button variant="primary" onClick={() => { onCommit(draft.trim()); close() }}>{t('Save')}</Button>
    </div>
  </>
}

/* A square, small JPEG: the photo travels with the profile's JSON backup and with sync, so a
   160 px crop keeps it to a few KB instead of a multi-MB camera original. */
function shrinkPhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('read'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('decode'))
      img.onload = () => {
        const size = 160
        const side = Math.min(img.width, img.height) || size
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = size
        canvas.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2,
          side, side, 0, 0, size, size)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

export default function ProfilePage({ S, update }) {
  const unit = S.unit === 'lb' ? 'lb' : 'kg'
  const recorded = latestWeight(S)
  // The weight used for BMI: one typed here wins over the last weigh-in, but the weigh-in is the
  // default so the number matches the chart the person already sees on Home.
  const weight = S.profileWeight ?? recorded?.shown ?? null
  const kg = weight === null ? null : toKg(weight, unit)
  const bmi = bmiOf(S.heightCm, kg)
  const band = bandOf(bmi)
  const range = healthyRange(S.heightCm)
  const rangeShown = range ? { min: fromKg(range.min, unit), max: fromKg(range.max, unit) } : null
  const age = ageOf(S.birthYear)
  const bmr = bmrOf({ sex: S.sex, kg, cm: S.heightCm, year: S.birthYear })
  const target = S.targetWeight ?? null
  const gap = target === null || weight === null ? null : Math.round((Number(weight) - Number(target)) * 10) / 10

  const set = (key, parse) => v => update(s => {
    const clean = parse ? parse(v) : v
    if (clean === null || clean === undefined || clean === '') delete s[key]
    else s[key] = clean
  })
  // Weight stays in the profile's own unit, so no conversion at the edge: the field's min/max
  // are already in that unit. Height, birth year and body fat get the shared validators.
  const setHeight = set('heightCm', heightCm)
  const setWeight = set('profileWeight')
  const setTarget = set('targetWeight')

  const name = String(S.profileName || '').trim()
  const initial = name ? name.charAt(0).toUpperCase() : null
  const fileRef = useRef(null)
  const editName = () => sheet(close => <NameSheet value={name} onCommit={set('profileName')} close={close} />)
  const onPhoto = async e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try { set('profileAvatar')(await shrinkPhoto(file)) }
    catch { /* a photo the WebView could not decode: keep the previous one */ }
  }

  return <div className="hm-page">
    {/* The identity this fork's Settings root points at: nickname and photo, both editable. */}
    <section className="hm-id" aria-label={t('Personal information')}>
      <button type="button" className="hm-avatar" onClick={() => fileRef.current?.click()} aria-label={t('Change photo')}>
        {S.profileAvatar ? <img src={S.profileAvatar} alt="" />
          : initial ? <span>{initial}</span> : <Icon name="personCircle" />}
      </button>
      <button type="button" className="hm-id-m" onClick={editName}>
        <span className="hm-id-name">{name || t('Set a nickname')}</span>
        <span className="hm-id-sub">{t('Tap to change your nickname and photo')}</span>
      </button>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPhoto} />
    </section>

    <section className="hm-hero" aria-label={t('Body mass index')}>
      <div className="hm-hero-head">
        <span className="hm-hero-label">{t('Body mass index')}</span>
        <span className="hm-hero-badge">{bmi === null ? '—' : t(band?.label || '—')}</span>
      </div>
      <div className="hm-hero-value">{bmi === null ? '—' : bmi.toFixed(1)}</div>
      <div className="hm-gauge" role="img" aria-label={t('BMI')}>
        <span className="hm-gauge-track" />
        {bmi !== null && <span className="hm-gauge-thumb" style={{ insetInlineStart: `${gaugePct(bmi)}%` }} />}
      </div>
      <div className="hm-gauge-scale"><span>15</span><span>18.5</span><span>24</span><span>28</span><span>40</span></div>
      <p className="hm-hero-foot">
        {rangeShown
          ? t('Healthy range for your height: {0}–{1} {2}', rangeShown.min, rangeShown.max, unit)
          : t('Enter your height and weight to see your BMI.')}
      </p>
      <p className="hm-hero-note">{t('BMI uses the Chinese adult standard (18.5 / 24 / 28). The WHO bands are 18.5 / 25 / 30.')}</p>
    </section>

    {/* The same Row geometry and icon rail as Derived below, so the two sections read as one
        list. Tapping a row still opens its own h3 sheet — only the frame around the value went. */}
    <Section title={t('Your details')}>
      <NumberRow icon="ruler" iconTint="var(--blue)" label={t('Height')} unit="cm"
        min={50} max={260} value={S.heightCm ?? null} onCommit={setHeight} />
      <NumberRow icon="scale" iconTint="var(--teal)" label={t('Weight')} unit={unit}
        min={unit === 'lb' ? 44 : 20} max={unit === 'lb' ? 880 : 400}
        value={weight} onCommit={setWeight} />
      <ChoiceRow icon="personCircle" iconTint="var(--indigo)" label={t('Sex')}
        value={S.sex === 'female' || S.sex === 'male' ? S.sex : ''}
        options={[{ value: 'male', label: t('Male') }, { value: 'female', label: t('Female') }]}
        onCommit={set('sex')} />
      <NumberRow icon="calendar" iconTint="var(--orange)" label={t('Birth year')}
        min={1900} max={new Date().getFullYear()} step="1"
        value={S.birthYear ?? null} onCommit={set('birthYear', birthYear)} />
      <NumberRow icon="star" iconTint="var(--green)" label={t('Target weight')} unit={unit}
        min={unit === 'lb' ? 44 : 20} max={unit === 'lb' ? 880 : 400}
        value={target} onCommit={setTarget} />
      <NumberRow icon="gauge" iconTint="var(--purple)" label={t('Body fat')} unit="%"
        min={3} max={70} value={S.bodyFatPct ?? null} onCommit={set('bodyFatPct', bodyFatPct)} />
    </Section>

    <Section title={t('Derived')} footer={t('BMI and BMR are estimates, not medical advice.')}>
      <Row icon="chart" iconTint="var(--teal)" title={t('BMI')} value={bmi === null ? '—' : bmi.toFixed(1)} />
      <Row icon="target" iconTint="var(--green)" title={t('Healthy range')}
        value={rangeShown ? `${rangeShown.min}–${rangeShown.max} ${unit}` : '—'} />
      <Row icon="person" iconTint="var(--blue)" title={t('Age')} value={age === null ? '—' : t('{0} years', age)} />
      <Row icon="bolt" iconTint="var(--orange)" title={t('Basal metabolic rate')}
        value={bmr === null ? '—' : `${bmr} ${t('kcal/day')}`} />
      <Row icon="flag" iconTint="var(--purple)" title={t('To target')}
        value={gap === null ? '—' : gap > 0 ? t('{0} {1} to go', Math.abs(gap), unit) : t('Target reached')} />
    </Section>
  </div>
}
