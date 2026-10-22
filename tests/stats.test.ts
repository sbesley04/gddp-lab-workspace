// Expected values below were calculated by hand (and cross-checked against R's quantile(type = 7)
// and sd()); they are not produced by the implementation under test.
import { describe, expect, it } from 'vitest'
import { quantileType7, sampleSd, mean, summarize } from '@core/stats'
import { classifyValue } from '@core/values'

describe('descriptive statistics', () => {
  it('computes mean, sample SD (n-1) and type-7 quartiles for 1..4', () => {
    const xs = [4, 1, 3, 2]
    const s = summarize(xs.map(classifyValue))
    expect(s.n).toBe(4)
    expect(s.mean).toBe(2.5)
    // var = ((1.5^2 + 0.5^2) * 2) / 3 = 5/3
    expect(s.sd).toBeCloseTo(Math.sqrt(5 / 3), 12)
    expect(s.q1).toBe(1.75) // h = 0.75 → 1 + 0.75 * (2 - 1)
    expect(s.median).toBe(2.5)
    expect(s.q3).toBe(3.25)
    expect(s.min).toBe(1)
    expect(s.max).toBe(4)
  })

  it('handles odd n: [2, 4, 4, 4, 5, 5, 7, 9]', () => {
    const xs = [2, 4, 4, 4, 5, 5, 7, 9]
    expect(mean(xs)).toBe(5)
    // sum of squared deviations = 32 → sample var 32/7
    expect(sampleSd(xs)).toBeCloseTo(Math.sqrt(32 / 7), 12)
    const sorted = [...xs].sort((a, b) => a - b)
    expect(quantileType7(sorted, 0.25)).toBe(4) // h = 1.75 → 4 + 0.75*(4-4)
    expect(quantileType7(sorted, 0.5)).toBe(4.5) // h = 3.5 → 4 + 0.5*(5-4)
    expect(quantileType7(sorted, 0.75)).toBe(5.5) // h = 5.25 → 5 + 0.25*(7-5)
  })

  it('reports SD as unavailable for n < 2 and everything null for n = 0', () => {
    const one = summarize([classifyValue(3)])
    expect(one.n).toBe(1)
    expect(one.sd).toBeNull()
    expect(one.median).toBe(3)
    const none = summarize([])
    expect(none.mean).toBeNull()
    expect(none.q1).toBeNull()
  })

  it('keeps missing, zero, censored and non-numeric distinct', () => {
    const s = summarize([classifyValue(0), classifyValue(null), classifyValue('<0.5'), classifyValue('N/A'), classifyValue(2)])
    expect(s.n).toBe(2) // 0 and 2
    expect(s.mean).toBe(1)
    expect(s.missing).toBe(1)
    expect(s.censored).toBe(1)
    expect(s.nonNumeric).toBe(1)
  })

  it('is numerically stable for large offsets', () => {
    const xs = [1e9 + 4, 1e9 + 7, 1e9 + 13, 1e9 + 16]
    expect(sampleSd(xs)).toBeCloseTo(Math.sqrt(30), 6) // same as [4,7,13,16]: var = 90/3
  })
})
