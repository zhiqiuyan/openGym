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

import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Section, Row, Button, Segmented } from '../components/ui.jsx'
import { t } from '../lib/i18n.js'
import { addWeighIn, dayOf, timeOf } from '../lib/weigh-ins.js'
import {
  bmiOf, bandOf, gaugePct, healthyRange, ageOf, bmrOf,
  toKg, fromKg, heightCm, bodyFatPct, birthYear, latestWeight,
} from '../lib/body-metrics.js'

const num = (v, fallback = '') => (v === null || v === undefined || Number.isNaN(v) ? fallback : String(v))

/** A Harmony-style numeric field; the value is committed on blur, not on every keystroke. */
function NumberField({ label, value, unit, min, max, step = 'any', placeholder, onCommit }) {
  const shown = num(value)
  const [draft, setDraft] = useState(shown)
  const [editing, setEditing] = useState(false)
  // Follow the stored value when a sync or another field changes it, but never overwrite what
  // the person is typing.
  useEffect(() => { if (!editing) setDraft(shown) }, [shown, editing])
  const commit = () => {
    setEditing(false)
    const raw = String(draft).trim()
    const n = raw === '' ? null : Number(raw)
    const ok = n === null || (Number.isFinite(n) && n >= min && n <= max)
    if (!ok) { setDraft(shown); return }
    onCommit(n)
  }
  return <label className="hm-field">
    <span className="hm-field-l">{label}</span>
    <span className="hm-field-box">
      <input className="hm-input" type="number" inputMode="decimal" min={min} max={max} step={step}
        value={draft} placeholder={placeholder || '—'} aria-label={label}
        onChange={e => setDraft(e.target.value)} onFocus={() => setEditing(true)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
      {unit && <span className="hm-unit">{unit}</span>}
    </span>
  </label>
}

export default function ProfilePage({ S, update, toast }) {
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

  const nav = useNavigate()
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

  const saveWeighIn = () => {
    const w = Number(weight)
    if (!Number.isFinite(w) || w <= 0) { toast?.(t('Enter a weight first.')); return }
    update(s => addWeighIn(s, { d: dayOf(Date.now()), at: timeOf(Date.now()), w }))
    toast?.(t('Weigh-in saved'))
  }

  return <div className="hm-page">
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

    <Section title={t('Your details')}>
      <div className="hm-fields">
        <NumberField label={t('Height')} unit="cm" min={50} max={260} value={S.heightCm ?? null} onCommit={setHeight} />
        <NumberField label={t('Weight')} unit={unit} min={unit === 'lb' ? 44 : 20} max={unit === 'lb' ? 880 : 400}
          value={weight} onCommit={setWeight} />
        <div className="hm-field">
          <span className="hm-field-l">{t('Sex')}</span>
          <Segmented className="seg-inline" value={S.sex === 'female' || S.sex === 'male' ? S.sex : ''}
            options={[{ value: 'male', label: t('Male') }, { value: 'female', label: t('Female') }]}
            onChange={v => set('sex')(v)} />
        </div>
        <NumberField label={t('Birth year')} min={1900} max={new Date().getFullYear()} step="1"
          value={S.birthYear ?? null} onCommit={set('birthYear', birthYear)} />
        <NumberField label={t('Target weight')} unit={unit} min={unit === 'lb' ? 44 : 20} max={unit === 'lb' ? 880 : 400}
          value={target} onCommit={setTarget} />
        <NumberField label={t('Body fat')} unit="%" min={3} max={70}
          value={S.bodyFatPct ?? null} onCommit={set('bodyFatPct', bodyFatPct)} />
      </div>
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

    <Section footer={t('Weight saved here is used for BMI. Add it to your weight history to see it on the charts too.')}>
      <Button className="hm-btn" onClick={saveWeighIn}>{t('Save weigh-in')}</Button>
      <Button className="hm-btn ghost" onClick={() => nav('/settings/health-connect')}>{t('Huawei Health')}</Button>
    </Section>
  </div>
}
