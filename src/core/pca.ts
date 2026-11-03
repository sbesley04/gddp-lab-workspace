// Principal component analysis on the correlation matrix (variables centred and scaled to unit variance), so measures in
// different units are comparable. Exploratory: runs only when the researcher presses Compute. Checked against R prcomp(scale. = TRUE).
// Rows with any missing, censored, non-numeric or QC-excluded value in the chosen variables are left out and counted; nothing is imputed.

import type { SelectionResult } from './selection'
import { getObservation } from './selection'
import { categoryLabel } from './chartData'
import type { VariableInfo } from './types'

export interface PcaResult {
  n: number
  p: number
  /** Number of components returned: min(p, n - 1). */
  k: number
  /** Standard deviation of each component (R: sdev). */
  sdev: number[]
  varianceExplained: number[]
  cumulative: number[]
  /** loadings[variable][component] (R: rotation) */
  loadings: number[][]
  /** scores[observation][component] (R: x) */
  scores: number[][]
  center: number[]
  scale: number[]
}

/** Cyclic Jacobi eigen-decomposition of a symmetric matrix. Returns eigenvalues (descending) and matching eigenvectors as columns. */
export function symmetricEigen(a: number[][]): { values: number[]; vectors: number[][] } {
  const n = a.length
  const A = a.map((r) => [...r])
  const V: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)))
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j]
    if (off < 1e-30) break
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-300) continue
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q])
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        for (let k = 0; k < n; k++) {
          const akp = A[k][p]
          const akq = A[k][q]
          A[k][p] = c * akp - s * akq
          A[k][q] = s * akp + c * akq
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k]
          const aqk = A[q][k]
          A[p][k] = c * apk - s * aqk
          A[q][k] = s * apk + c * aqk
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p]
          const vkq = V[k][q]
          V[k][p] = c * vkp - s * vkq
          V[k][q] = s * vkp + c * vkq
        }
      }
    }
  }
  const order = A.map((_, i) => i).sort((i, j) => A[j][j] - A[i][i])
  return { values: order.map((i) => A[i][i]), vectors: V.map((row) => order.map((i) => row[i])) }
}

/**
 * PCA of an n × p matrix with no missing values. Component signs are arbitrary, so each is fixed so that its
 * largest-magnitude loading is positive (the first such loading on a tie).
 */
export function pca(X: number[][]): PcaResult {
  const n = X.length
  const p = n ? X[0].length : 0
  if (n < 3 || p < 2) throw new Error('PCA needs at least 3 complete observations and 2 variables.')
  const center = Array.from({ length: p }, (_, j) => X.reduce((s, r) => s + r[j], 0) / n)
  const scale = Array.from({ length: p }, (_, j) => Math.sqrt(X.reduce((s, r) => s + (r[j] - center[j]) ** 2, 0) / (n - 1)))
  if (scale.some((s) => !(s > 0))) throw new Error('A variable has no spread among the complete observations and cannot be standardised.')
  const Z = X.map((r) => r.map((v, j) => (v - center[j]) / scale[j]))
  const R = Array.from({ length: p }, (_, a) => Array.from({ length: p }, (_, b) => Z.reduce((s, r) => s + r[a] * r[b], 0) / (n - 1)))
  const { values, vectors } = symmetricEigen(R)
  const k = Math.min(p, n - 1)
  const loadings = vectors.map((row) => row.slice(0, k))
  for (let c = 0; c < k; c++) {
    let best = 0
    for (let j = 1; j < p; j++) if (Math.abs(loadings[j][c]) > Math.abs(loadings[best][c]) + 1e-12) best = j
    if (loadings[best][c] < 0) for (let j = 0; j < p; j++) loadings[j][c] = -loadings[j][c]
  }
  const variances = values.slice(0, k).map((v) => Math.max(0, v))
  const total = p // trace of a correlation matrix
  const varianceExplained = variances.map((v) => v / total)
  const cumulative: number[] = []
  varianceExplained.reduce((s, v) => (cumulative.push(s + v), s + v), 0)
  const scores = Z.map((z) => Array.from({ length: k }, (_, c) => z.reduce((s, v, j) => s + v * loadings[j][c], 0)))
  return { n, p, k, sdev: variances.map(Math.sqrt), varianceExplained, cumulative, loadings, scores, center, scale }
}

export interface PcaInput {
  /** Selection rows that had a usable numeric value in every chosen variable. */
  rows: number[]
  matrix: number[][]
  /** Rows left out because at least one chosen variable had no usable numeric value. */
  dropped: number
  /** For each variable, how many selected rows it has no usable numeric value for (a row can count under several). */
  blockers: { key: string; count: number }[]
  /** Per kept row: carries a QC-type flag in any chosen variable / unresolved formatting. */
  flags: { flagged: boolean; unresolved: boolean }[]
}

export function pcaInput(sel: SelectionResult, vars: VariableInfo[]): PcaInput {
  const rows: number[] = []
  const matrix: number[][] = []
  const counts = vars.map(() => 0)
  const flags: PcaInput['flags'] = []
  let dropped = 0
  for (const row of sel.rows) {
    const vals: number[] = []
    let ok = true
    let flagged = false
    let unresolved = false
    vars.forEach((v, j) => {
      const o = getObservation(sel.ctx, row, v.index)
      if (o.value.k === 'number' && o.qcExcludedBy.length === 0) {
        vals.push(o.value.v)
        if (o.flags.some((f) => f.category && f.category !== 'unresolved_highlight')) flagged = true
        if (o.flags.some((f) => f.category === 'unresolved_highlight')) unresolved = true
      }
      else {
        ok = false
        counts[j]++
      }
    })
    if (ok) {
      rows.push(row)
      matrix.push(vals)
      flags.push({ flagged, unresolved })
    } else dropped++
  }
  return { rows, matrix, dropped, blockers: vars.map((v, j) => ({ key: v.key, count: counts[j] })), flags }
}

export interface PcaPoint {
  row: number
  participantId: string
  scores: number[]
  flagged: boolean
  unresolved: boolean
  cat?: string
}

export interface PcaPlot {
  input: PcaInput
  result: PcaResult | null
  /** Why no result could be computed (too few complete rows, constant variable, fewer than two variables). */
  error: string | null
  points: PcaPoint[]
  categories: string[]
}

/** Everything the PCA view needs, computed from the same selection as every other chart. */
export function pcaPlot(sel: SelectionResult, vars: VariableInfo[], colorVar: number | null): PcaPlot {
  const input = pcaInput(sel, vars)
  let result: PcaResult | null = null
  let error: string | null = null
  if (vars.length < 2) error = 'Choose at least two variables.'
  else {
    try {
      result = pca(input.matrix)
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }
  const cats = new Set<string>()
  const points: PcaPoint[] = result
    ? input.rows.map((row, i) => {
        const cat = colorVar !== null ? categoryLabel(sel, row, colorVar) : undefined
        if (cat !== undefined) cats.add(cat)
        return { row, participantId: sel.ctx.snapshot.rows[row].participantId, scores: result!.scores[i], flagged: input.flags[i].flagged, unresolved: input.flags[i].unresolved, cat }
      })
    : []
  const categories = [...cats].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  return { input, result, error, points, categories }
}
