// Descriptive statistics. Conventions (stated in the UI and docs):
// - SD is the sample standard deviation with denominator n - 1; unavailable (null) when n < 2.
// - Quartiles and median use Hyndman & Fan type 7 linear interpolation
//   (R's default quantile(), Excel QUARTILE.INC / PERCENTILE.INC).
// - Only numeric observations contribute. Missing, censored and non-numeric entries are counted separately.

import type { CellValue } from './types'

export const QUARTILE_CONVENTION =
  'Quartiles: Hyndman–Fan type 7 linear interpolation (R default; Excel QUARTILE.INC). SD: sample SD, n − 1.'

export interface Summary {
  n: number
  missing: number
  censored: number
  nonNumeric: number
  mean: number | null
  sd: number | null
  min: number | null
  q1: number | null
  median: number | null
  q3: number | null
  max: number | null
}

export function quantileType7(sorted: number[], p: number): number | null {
  const n = sorted.length
  if (n === 0) return null
  if (n === 1) return sorted[0]
  const h = (n - 1) * p
  const lo = Math.floor(h)
  const hi = Math.ceil(h)
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo])
}

export function mean(xs: number[]): number | null {
  if (xs.length === 0) return null
  // Two-pass compensated mean for numerical stability.
  let s = 0
  for (const x of xs) s += x
  const m = s / xs.length
  let c = 0
  for (const x of xs) c += x - m
  return m + c / xs.length
}

export function sampleSd(xs: number[]): number | null {
  const n = xs.length
  if (n < 2) return null
  const m = mean(xs) as number
  let ss = 0
  for (const x of xs) ss += (x - m) * (x - m)
  return Math.sqrt(ss / (n - 1))
}

export function summarizeNumbers(xs: number[]): Pick<Summary, 'n' | 'mean' | 'sd' | 'min' | 'q1' | 'median' | 'q3' | 'max'> {
  const sorted = [...xs].sort((a, b) => a - b)
  return {
    n: sorted.length,
    mean: mean(sorted),
    sd: sampleSd(sorted),
    min: sorted.length ? sorted[0] : null,
    q1: quantileType7(sorted, 0.25),
    median: quantileType7(sorted, 0.5),
    q3: quantileType7(sorted, 0.75),
    max: sorted.length ? sorted[sorted.length - 1] : null
  }
}

export function summarize(values: CellValue[]): Summary {
  const nums: number[] = []
  let missing = 0
  let censored = 0
  let nonNumeric = 0
  for (const v of values) {
    if (v.k === 'number') nums.push(v.v)
    else if (v.k === 'missing') missing++
    else if (v.k === 'censored') censored++
    else nonNumeric++
  }
  return { ...summarizeNumbers(nums), missing, censored, nonNumeric }
}
