// Display transforms for a chart's measures. They are recorded in the analysis log, never change the stored data,
// never impute, and are computed from the usable numeric values of the current selection.

import type { VariableInfo } from './types'

export const TRANSFORMS = ['none', 'log2', 'log10', 'center', 'zscore', 'rank'] as const
export type TransformId = (typeof TRANSFORMS)[number]

export const TRANSFORM_LABELS: Record<TransformId, string> = {
  none: 'None (as imported)',
  log2: 'log2',
  log10: 'log10',
  center: 'Centre (subtract mean)',
  zscore: 'Z-score (centre and scale)',
  rank: 'Rank'
}

/** Compact labels for the picker. */
export const TRANSFORM_SHORT: Record<TransformId, string> = { none: 'No transform', log2: 'log2', log10: 'log10', center: 'Centred', zscore: 'Z-score', rank: 'Rank' }

/** Short prefix used in axis titles and the log, e.g. "log2(IL6)". */
export const TRANSFORM_FN: Record<Exclude<TransformId, 'none'>, string> = { log2: 'log2', log10: 'log10', center: 'centred', zscore: 'z', rank: 'rank' }

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

/** The same transform as an R expression on `expr`, for the analysis log. */
export function transformR(id: TransformId, expr: string): string {
  switch (id) {
    case 'none':
      return expr
    case 'log2':
      return `ifelse(${expr} > 0, log2(${expr}), NA)`
    case 'log10':
      return `ifelse(${expr} > 0, log10(${expr}), NA)`
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
      // Centring keeps the unit; a log keeps the unit's status (an unknown unit stays visibly unknown).
      unit: dimensionless
        ? { ...v.meta.unit, value: id === 'zscore' ? 'SD units' : 'rank', status: 'confirmed' }
        : id === 'center'
          ? v.meta.unit
          : { ...v.meta.unit, value: v.meta.unit.value ? `${id} ${v.meta.unit.value}` : null }
    }
  }
}
