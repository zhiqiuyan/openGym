// Body metrics for the HarmonyOS edition's Settings → Personal information page.
//
// Everything here is a pure function: the page owns the state, this file owns the arithmetic.
// Weights in the app's state are in the profile's own unit (S.unit), but every calculation here
// is in SI (cm, kg) — callers convert at the edge with toKg/fromKg. That keeps BMI, the healthy
// range and the BMR independent of whether the person reads kg or lb.
//
// BMI bands follow the Chinese adult standard (WS/T 428-2013), which is what a Chinese user
// gets from a hospital or a Huawei Health scale. The WHO bands are kept alongside it so the
// page can state the difference instead of silently mixing two reference systems.

export const LB_PER_KG = 2.2046226218487757
const r1 = n => Math.round(n * 10) / 10
const r2 = n => Math.round(n * 100) / 100

/** A finite, positive number, or null. Rejects 0, negatives, NaN and string junk. */
export function metric(v, min, max) {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < min || n > max) return null
  return n
}

export const heightCm = v => metric(v, 50, 260)
export const bodyKg = v => metric(v, 20, 400)
export const bodyFatPct = v => metric(v, 3, 70)
export const birthYear = v => {
  const n = Number(v)
  return Number.isInteger(n) && n >= 1900 && n <= new Date().getFullYear() ? n : null
}

/** Convert a weight shown in the profile's unit to kg. */
export const toKg = (w, unit) => {
  if (w === null || w === undefined || w === '') return null
  const n = Number(w)
  if (!Number.isFinite(n)) return null
  return unit === 'lb' ? n / LB_PER_KG : n
}

/** Convert a kg value back into the profile's unit, rounded like a scale reads. */
export const fromKg = (kg, unit) => {
  if (kg === null || kg === undefined || kg === '') return null
  const n = Number(kg)
  if (!Number.isFinite(n)) return null
  return r1(unit === 'lb' ? n * LB_PER_KG : n)
}

/** BMI = kg / m². Null until both values are present and plausible. */
export function bmiOf(cm, kg) {
  const h = heightCm(cm), w = bodyKg(kg)
  if (h === null || w === null) return null
  const m = h / 100
  return r1(w / (m * m))
}

// Chinese adult standard. `to` is exclusive; the last band has no upper bound.
export const CN_BANDS = Object.freeze([
  { id: 'under', from: 0, to: 18.5, label: 'Underweight', ink: 'var(--blue)' },
  { id: 'healthy', from: 18.5, to: 24, label: 'Healthy weight', ink: 'var(--green-ink)' },
  { id: 'over', from: 24, to: 28, label: 'Overweight', ink: 'var(--orange-ink)' },
  { id: 'obese', from: 28, to: Infinity, label: 'Obesity', ink: 'var(--red)' },
])

// WHO / international standard, shown as the comparison in the footnote.
export const WHO_BANDS = Object.freeze([
  { id: 'under', from: 0, to: 18.5, label: 'Underweight' },
  { id: 'healthy', from: 18.5, to: 25, label: 'Healthy weight' },
  { id: 'over', from: 25, to: 30, label: 'Overweight' },
  { id: 'obese', from: 30, to: Infinity, label: 'Obesity' },
])

export function bandOf(bmi, bands = CN_BANDS) {
  if (!Number.isFinite(Number(bmi))) return null
  const n = Number(bmi)
  return bands.find(b => n >= b.from && n < b.to) || null
}

/** Position of a BMI value on a 15–40 scale, clamped, for the gauge thumb. */
export function gaugePct(bmi) {
  if (!Number.isFinite(Number(bmi))) return 0
  return Math.max(0, Math.min(100, ((Number(bmi) - 15) / 25) * 100))
}

/** The kg range a given height maps to at BMI 18.5–23.9. */
export function healthyRange(cm, bands = CN_BANDS) {
  const h = heightCm(cm)
  if (h === null) return null
  const m = h / 100
  const healthy = bands.find(b => b.id === 'healthy')
  if (!healthy || !Number.isFinite(healthy.to)) return null
  return { min: r1(healthy.from * m * m), max: r1((healthy.to - 0.1) * m * m) }
}

/** Whole years from a birth year, or null when it is unknown. */
export function ageOf(year, now = new Date()) {
  const y = birthYear(year)
  return y === null ? null : Math.max(0, now.getFullYear() - y)
}

/** Mifflin–St Jeor resting energy expenditure, kcal/day. An estimate, never a diagnosis. */
export function bmrOf({ sex, kg, cm, year }, now = new Date()) {
  const w = bodyKg(kg), h = heightCm(cm), age = ageOf(year, now)
  if (w === null || h === null || age === null || age < 10) return null
  const base = 10 * w + 6.25 * h - 5 * age
  return Math.round(sex === 'female' ? base - 161 : sex === 'male' ? base + 5 : NaN) || null
}

/** The last daily weight in the state, in kg, plus the day it came from. */
export function latestWeight(S) {
  const list = Array.isArray(S?.bodyweight) ? S.bodyweight : []
  const last = [...list].filter(e => e && Number.isFinite(Number(e.w))).sort((a, b) => String(a.d).localeCompare(String(b.d))).at(-1)
  if (!last) return null
  return { kg: toKg(last.w, S?.unit), d: last.d, shown: r2(Number(last.w)), unit: S?.unit === 'lb' ? 'lb' : 'kg' }
}
