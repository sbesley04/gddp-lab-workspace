// Multi-variable views over one variable set: a correlation matrix and a participant × measure heatmap.
// Both are descriptive (no p-values), use only usable numeric values (missing, censored, text and QC-excluded
// values are left out and counted) and never impute.

import type { SelectionResult } from './selection'
import { getObservation } from './selection'
import { pearsonR, ranks } from './analysis'
import { categoryLabel, orderedCategories } from './chartData'
import type { VariableInfo } from './types'

export type CorrelationMethod = 'pearson' | 'spearman'

export interface CorrelationMatrix {
  method: CorrelationMethod
  keys: string[]
  /** r[i][j]; null when fewer than 3 pairs or no spread in the pairs. Diagonal is 1 when defined. */
  r: (number | null)[][]
  /** Pairwise-complete n for each pair (R: use = "pairwise.complete.obs"). */
  n: number[][]
}

/** Usable numeric value of each variable on each selected row (null when missing, censored, text or QC-excluded). */
export function numericGrid(sel: SelectionResult, vars: VariableInfo[]): { rows: number[]; values: (number | null)[][]; flagged: boolean[][] } {
  const values: (number | null)[][] = []
  const flagged: boolean[][] = []
  for (const row of sel.rows) {
    const vs: (number | null)[] = []
    const fs: boolean[] = []
    for (const v of vars) {
      const o = getObservation(sel.ctx, row, v.index)
      const ok = o.value.k === 'number' && o.qcExcludedBy.length === 0
      vs.push(ok && o.value.k === 'number' ? o.value.v : null)
      fs.push(ok && o.flags.some((f) => f.category && f.category !== 'unresolved_highlight'))
    }
    values.push(vs)
    flagged.push(fs)
  }
  return { rows: [...sel.rows], values, flagged }
}

function pairCorrelation(x: number[], y: number[], method: CorrelationMethod): number | null {
  if (x.length < 3) return null
  const r = method === 'spearman' ? pearsonR(ranks(x).r, ranks(y).r) : pearsonR(x, y)
  return Number.isFinite(r) ? Math.max(-1, Math.min(1, r)) : null
}

/** Correlation matrix from pairwise-complete observations; Spearman ranks each pair's complete subset, as R does. */
export function correlationMatrix(values: (number | null)[][], keys: string[], method: CorrelationMethod): CorrelationMatrix {
  const p = keys.length
  const r: (number | null)[][] = Array.from({ length: p }, () => new Array(p).fill(null))
  const n: number[][] = Array.from({ length: p }, () => new Array(p).fill(0))
  for (let i = 0; i < p; i++) {
    for (let j = i; j < p; j++) {
      const x: number[] = []
      const y: number[] = []
      for (const row of values) {
        const a = row[i]
        const b = row[j]
        if (a !== null && b !== null) {
          x.push(a)
          y.push(b)
        }
      }
      n[i][j] = n[j][i] = x.length
      r[i][j] = r[j][i] = i === j ? (x.length >= 3 && new Set(x).size > 1 ? 1 : null) : pairCorrelation(x, y, method)
    }
  }
  return { method, keys, r, n }
}

export function correlationFromSelection(sel: SelectionResult, vars: VariableInfo[], method: CorrelationMethod): CorrelationMatrix {
  return correlationMatrix(numericGrid(sel, vars).values, vars.map((v) => v.key), method)
}

export interface HeatmapData {
  /** Selected rows in display order. */
  rows: number[]
  participantIds: string[]
  keys: string[]
  /** z[row][variable]: (value − mean) / SD over the usable values of that variable in the selection; null when unusable. */
  z: (number | null)[][]
  raw: (number | null)[][]
  flagged: boolean[][]
  /** Row category of the colour-by covariate, when given. */
  cats: (string | null)[]
  categories: string[]
  /** Variables with fewer than 2 usable values or no spread: shown blank. */
  undefinedKeys: string[]
  missingCells: number
}

/** Rows ordered by covariate category (missing last), then by participant ID; columns as chosen. */
export function heatmapData(sel: SelectionResult, vars: VariableInfo[], colorVar: number | null): HeatmapData {
  const grid = numericGrid(sel, vars)
  const stats = vars.map((_, j) => {
    const xs = grid.values.map((r) => r[j]).filter((v): v is number => v !== null)
    if (xs.length < 2) return null
    const m = xs.reduce((a, b) => a + b, 0) / xs.length
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1))
    return sd > 0 ? { m, sd } : null
  })
  const pid = (row: number) => sel.ctx.snapshot.rows[row].participantId
  const cat = (row: number) => (colorVar === null ? null : categoryLabel(sel, row, colorVar))
  const categories = orderedCategories(grid.rows.map(cat).filter((c): c is string => c !== null))
  const order = grid.rows.map((row, i) => ({ row, i })).sort((a, b) => {
    if (colorVar !== null) {
      const d = categories.indexOf(cat(a.row)!) - categories.indexOf(cat(b.row)!)
      if (d) return d
    }
    return pid(a.row).localeCompare(pid(b.row), undefined, { numeric: true }) || a.row - b.row
  })
  let missingCells = 0
  const z = order.map(({ i }) =>
    grid.values[i].map((v, j) => {
      if (v === null) missingCells++
      const s = stats[j]
      return v === null || !s ? null : (v - s.m) / s.sd
    })
  )
  return {
    rows: order.map((o) => o.row),
    participantIds: order.map((o) => pid(o.row)),
    keys: vars.map((v) => v.key),
    z,
    raw: order.map(({ i }) => grid.values[i]),
    flagged: order.map(({ i }) => grid.flagged[i]),
    cats: order.map((o) => cat(o.row)),
    categories,
    undefinedKeys: vars.filter((_, j) => !stats[j]).map((v) => v.key),
    missingCells
  }
}
