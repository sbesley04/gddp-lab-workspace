// Display transforms for a chart's measures. They are recorded in the analysis log, never change the stored data,
// never impute, and are computed from the usable numeric values of the current selection.

import type { VariableInfo } from './types'

export const TRANSFORMS = ['none', 'log2', 'log10', 'sqrt', 'boxcox', 'center', 'zscore', 'rank'] as const
export type TransformId = (typeof TRANSFORMS)[number]

export const TRANSFORM_LABELS: Record<TransformId, string> = {
  none: 'None (as imported)',
  log2: 'log2',
  log10: 'log10',
  sqrt: 'Square root',
  boxcox: 'Box-Cox (λ by maximum likelihood)',
  center: 'Centre (subtract mean)',
  zscore: 'Z-score (centre and scale)',
  rank: 'Rank'
}

/** Compact labels for the picker. */
export const TRANSFORM_SHORT: Record<TransformId, string> = { none: 'No transform', log2: 'log2', log10: 'log10', sqrt: 'Square root', boxcox: 'Box-Cox', center: 'Centred', zscore: 'Z-score', rank: 'Rank' }

/** Short prefix used in axis titles and the log, e.g. "log2(IL6)". */
export const TRANSFORM_FN: Record<Exclude<TransformId, 'none'>, string> = { log2: 'log2', log10: 'log10', sqrt: 'sqrt', boxcox: 'boxcox', center: 'centred', zscore: 'z', rank: 'rank' }

/** Box-Cox λ is searched in this range. car::powerTransform is unconstrained; an estimate at either end is reported as such. */
export const BOXCOX_RANGE: [number, number] = [-10, 10]

/** Box-Cox of one positive value; λ = 0 is the natural log (R: car::bcPower). */
export function boxcox(x: number, lambda: number): number {
  return Math.abs(lambda) < 1e-12 ? Math.log(x) : (Math.pow(x, lambda) - 1) / lambda
}

/**
 * Profile log-likelihood of λ for the model y ~ 1 (normal errors), up to a constant: −n/2·log(RSS/n) + (λ − 1)·Σ log y,
 * where RSS is the residual sum of squares of the Box-Cox values. Computed on log y centred at its mean (the log of the
 * geometric mean) with expm1, so RSS keeps its precision at large |λ| and near λ = 0. The direct form (y^λ − 1)/λ makes
 * every value equal in floating point at large |λ|, which would show a false maximum there.
 */
export function boxcoxLogLik(y: number[], lambda: number): number {
  const n = y.length
  const logs = y.map(Math.log)
  const sumLog = logs.reduce((a, b) => a + b, 0)
  const lg = sumLog / n
  const u = logs.map((l) => l - lg)
  let logRss: number
  if (Math.abs(lambda) < 1e-12) {
    logRss = Math.log(u.reduce((a, b) => a + b * b, 0))
  } else {
    // z = (y^λ − 1)/λ = (g^λ·e^(λu) − 1)/λ, so z − mean(z) = g^λ·(d − mean(d))/λ with d = expm1(λu).
    const d = u.map((v) => Math.expm1(lambda * v))
    const md = d.reduce((a, b) => a + b, 0) / n
    const ss = d.reduce((a, b) => a + (b - md) * (b - md), 0)
    logRss = 2 * lambda * lg + Math.log(ss) - 2 * Math.log(Math.abs(lambda))
  }
  return -(n / 2) * (logRss - Math.log(n)) + (lambda - 1) * sumLog
}

/**
 * Maximum-likelihood Box-Cox λ for y ~ 1 from the positive values (R: optimise the same profile log-likelihood;
 * agrees with car::powerTransform). A grid over BOXCOX_RANGE brackets the maximum, then golden-section search refines it.
 * Returns null with fewer than 3 positive values or when they have no spread.
 */
export function boxcoxLambda(values: number[]): number | null {
  const y = values.filter((v) => v > 0 && Number.isFinite(v))
  if (y.length < 3 || y.every((v) => v === y[0])) return null
  const [lo, hi] = BOXCOX_RANGE
  const step = 0.05
  let best = lo
  let bestLl = -Infinity
  for (let l = lo; l <= hi + 1e-9; l += step) {
    const ll = boxcoxLogLik(y, l)
    if (ll > bestLl) {
      bestLl = ll
      best = l
    }
  }
  let a = Math.max(lo, best - step)
  let b = Math.min(hi, best + step)
  const g = (Math.sqrt(5) - 1) / 2
  let c = b - g * (b - a)
  let d = a + g * (b - a)
  let fc = boxcoxLogLik(y, c)
  let fd = boxcoxLogLik(y, d)
  while (b - a > 1e-11) {
    if (fc > fd) {
      b = d
      d = c
      fd = fc
      c = b - g * (b - a)
      fc = boxcoxLogLik(y, c)
    } else {
      a = c
      c = d
      fc = fd
      d = a + g * (b - a)
      fd = boxcoxLogLik(y, d)
    }
  }
  return (a + b) / 2
}

/** Parameters a transform estimates from the selection, for labels and the analysis log. */
export function transformParams(id: TransformId, values: number[]): { lambda: number | null; n: number; atLimit: boolean } | null {
  if (id !== 'boxcox') return null
  const lambda = boxcoxLambda(values)
  const atLimit = lambda !== null && BOXCOX_RANGE.some((b) => Math.abs(lambda - b) < 1e-6)
  return { lambda, n: values.filter((v) => v > 0 && Number.isFinite(v)).length, atLimit }
}

/**
 * Returns a function mapping one value to its transformed value, or null where the transform is undefined
 * (non-positive values under a log, or any value when the spread is zero). Callers count and report those nulls.
 */
export function buildTransform(id: TransformId, values: number[]): (x: number) => number | null {
  switch (id) {
    case 'none':
      return (x) => x
    case 'log2':
      return (x) => (x > 0 ? Math.log2(x) : null)
    case 'log10':
      return (x) => (x > 0 ? Math.log10(x) : null)
    case 'sqrt':
      return (x) => (x >= 0 ? Math.sqrt(x) : null)
    case 'boxcox': {
      const lambda = boxcoxLambda(values)
      return lambda === null ? () => null : (x) => (x > 0 ? boxcox(x, lambda) : null)
    }
    case 'center':
    case 'zscore': {
      const n = values.length
      if (n === 0) return () => null
      const m = values.reduce((a, b) => a + b, 0) / n
      if (id === 'center') return (x) => x - m
      if (n < 2) return () => null
      const sd = Math.sqrt(values.reduce((a, b) => a + (b - m) * (b - m), 0) / (n - 1))
      return sd > 0 ? (x) => (x - m) / sd : () => null
    }
    case 'rank': {
      // Average rank for ties, as R's rank(ties.method = "average").
      const sorted = [...values].sort((a, b) => a - b)
      const first = new Map<number, number>()
      const last = new Map<number, number>()
      sorted.forEach((v, i) => {
        if (!first.has(v)) first.set(v, i + 1)
        last.set(v, i + 1)
      })
      return (x) => (first.has(x) ? (first.get(x)! + last.get(x)!) / 2 : null)
    }
  }
}

/** A number for the log: enough digits to redraw the chart, no float noise. */
const rNum = (v: number) => String(+v.toPrecision(10))

/** The same transform as an R expression on `expr`, for the analysis log. Box-Cox takes its estimated λ (null: not estimable). */
export function transformR(id: TransformId, expr: string, lambda?: number | null): string {
  switch (id) {
    case 'none':
      return expr
    case 'log2':
      return `ifelse(${expr} > 0, log2(${expr}), NA)`
    case 'log10':
      return `ifelse(${expr} > 0, log10(${expr}), NA)`
    case 'sqrt':
      return `ifelse(${expr} >= 0, sqrt(${expr}), NA)`
    case 'boxcox':
      if (lambda === undefined) return `car::bcPower(ifelse(${expr} > 0, ${expr}, NA), lambda)`
      if (lambda === null) return `NA_real_  # λ not estimable (fewer than 3 positive values, or no spread)`
      return Math.abs(lambda) < 1e-12 ? `ifelse(${expr} > 0, log(${expr}), NA)` : `ifelse(${expr} > 0, (${expr}^${rNum(lambda)} - 1) / ${rNum(lambda)}, NA)`
    case 'center':
      return `${expr} - mean(${expr}, na.rm = TRUE)`
    case 'zscore':
      return `as.numeric(scale(${expr}))`
    case 'rank':
      return `rank(${expr}, na.last = "keep", ties.method = "average")`
  }
}

/** A copy of the variable whose label and unit describe the transformed values (used only for display). */
export function transformedVariable(v: VariableInfo, id: TransformId): VariableInfo {
  if (id === 'none') return v
  const base = v.meta.displayLabel.value ?? v.header
  const dimensionless = id === 'zscore' || id === 'rank'
  return {
    ...v,
    meta: {
      ...v.meta,
      displayLabel: { ...v.meta.displayLabel, value: `${TRANSFORM_FN[id]}(${base})` },
      // Centring keeps the unit; a log or square root keeps the unit's status (an unknown unit stays visibly unknown).
      unit: dimensionless
        ? { ...v.meta.unit, value: id === 'zscore' ? 'SD units' : 'rank', status: 'confirmed' }
        : id === 'center'
          ? v.meta.unit
          : id === 'boxcox'
          ? { ...v.meta.unit, value: 'Box-Cox scale', status: 'confirmed' }
          : { ...v.meta.unit, value: v.meta.unit.value ? `${id} ${v.meta.unit.value}` : null }
    }
  }
}
