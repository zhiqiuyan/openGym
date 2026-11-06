import { describe, expect, it } from 'vitest'
import {
  bmiOf, bandOf, CN_BANDS, WHO_BANDS, gaugePct, healthyRange,
  toKg, fromKg, ageOf, bmrOf, latestWeight, metric, birthYear
} from './body-metrics.js'

describe('metric validation', () => {
  it('accepts only finite numbers inside the plausible range', () => {
    expect(metric('172', 50, 260)).toBe(172)
    expect(metric('', 50, 260)).toBe(null)
    expect(metric('17o', 50, 260)).toBe(null)
    expect(metric(0, 50, 260)).toBe(null)
    expect(metric(999, 50, 260)).toBe(null)
    expect(metric(NaN, 50, 260)).toBe(null)
  })
  it('rejects a birth year in the future', () => {
    expect(birthYear(1990)).toBe(1990)
    expect(birthYear(new Date().getFullYear() + 1)).toBe(null)
  })
})

describe('BMI', () => {
  it('is kg / m², rounded to one decimal', () => {
    expect(bmiOf(170, 65)).toBe(22.5)
    expect(bmiOf(180, 81)).toBe(25.0)
  })
  it('is null until both inputs are plausible', () => {
    expect(bmiOf(null, 70)).toBe(null)
    expect(bmiOf(170, null)).toBe(null)
    expect(bmiOf(20, 70)).toBe(null)
  })
  it('uses the Chinese adult bands, with WHO kept as a separate reference', () => {
    expect(bandOf(18.4).id).toBe('under')
    expect(bandOf(18.5).id).toBe('healthy')
    expect(bandOf(23.9).id).toBe('healthy')
    expect(bandOf(24).id).toBe('over')
    expect(bandOf(27.9).id).toBe('over')
    expect(bandOf(28).id).toBe('obese')
    expect(bandOf(24.5).id).toBe('over')
    expect(bandOf(24.5, WHO_BANDS).id).toBe('healthy')
    expect(CN_BANDS.find(b => b.id === 'healthy').to).toBe(24)
  })
  it('clamps the gauge to 15–40', () => {
    expect(gaugePct(10)).toBe(0)
    expect(gaugePct(22.5)).toBe(30)
    expect(gaugePct(50)).toBe(100)
  })
})

describe('derived numbers', () => {
  it('healthy weight range is BMI 18.5–23.9 at that height', () => {
    const r = healthyRange(170)
    expect(r.min).toBe(53.5)
    expect(r.max).toBe(69.1)
    expect(healthyRange(0)).toBe(null)
  })
  it('converts lb at the edge only', () => {
    expect(toKg(220.46226218487757, 'lb')).toBeCloseTo(100, 6)
    expect(toKg(100, 'kg')).toBe(100)
    expect(fromKg(100, 'lb')).toBe(220.5)
    expect(fromKg(null, 'kg')).toBe(null)
  })
  it('age and BMR need complete, plausible inputs', () => {
    expect(ageOf(1990, new Date('2026-01-01'))).toBe(36)
    expect(ageOf(null)).toBe(null)
    const male = bmrOf({ sex: 'male', kg: 70, cm: 175, year: 1990 }, new Date('2026-01-01'))
    const female = bmrOf({ sex: 'female', kg: 70, cm: 175, year: 1990 }, new Date('2026-01-01'))
    expect(male).toBe(1619)   // 10×70 + 6.25×175 − 5×36 + 5
    expect(female).toBe(1453) // same base − 161
    expect(male - female).toBe(166)
    expect(bmrOf({ sex: 'male', kg: 70, cm: 175, year: null })).toBe(null)
    expect(bmrOf({ sex: null, kg: 70, cm: 175, year: 1990 })).toBe(null)
  })
  it('reads the most recent daily weigh-in in the profile unit', () => {
    const S = { unit: 'lb', bodyweight: [
      { d: '2026-10-01', w: 150 }, { d: '2026-11-06', w: 160 }, { d: '2026-10-20', w: 155 },
    ] }
    expect(latestWeight(S)).toMatchObject({ d: '2026-11-06', shown: 160, unit: 'lb' })
    expect(latestWeight(S).kg).toBeCloseTo(72.57, 1)
    expect(latestWeight({ bodyweight: [] })).toBe(null)
  })
})
