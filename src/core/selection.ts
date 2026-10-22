// The single selection engine. Table, charts, summaries and exports all call computeSelection()
// so they agree exactly on which rows and observations are included.

import type {
  CellFlag,
  CellValue,
  DatasetSnapshot,
  FilterCondition,
  FilterGroup,
  FilterNode,
  QcCategory,
  SelectionSpec,
  VariableInfo
} from './types'
import { QC_CATEGORY_LABELS } from './types'

export interface ObservationContext {
  snapshot: DatasetSnapshot
  varByKey: Map<string, VariableInfo>
  /** QC-type flags per "row:variable". */
  flagIndex: Map<string, CellFlag[]>
  excludedCategories: Set<QcCategory>
}

export interface RowExclusion {
  row: number
  reason: string
}

export interface VariableCounts {
  included: number // numeric or text observations available after QC policy
  numeric: number
  missing: number
  censored: number
  text: number
  qcExcluded: number
  flaggedIncluded: number
}

export interface SelectionResult {
  rows: number[]
  excludedRows: RowExclusion[]
  participantIds: string[]
  /** Rows in scope before the filter (visit + participant restriction). */
  scopeRowCount: number
  ctx: ObservationContext
}

export interface Observation {
  row: number
  value: CellValue
  flags: CellFlag[]
  qcExcludedBy: QcCategory[]
}

const cellKey = (row: number, variable: number) => `${row}:${variable}`

export function buildFlagIndex(snapshot: DatasetSnapshot): Map<string, CellFlag[]> {
  const idx = new Map<string, CellFlag[]>()
  for (const f of snapshot.flags) {
    if (f.status === 'curator_rejected') continue
    const k = cellKey(f.row, f.variable)
    const list = idx.get(k)
    if (list) list.push(f)
    else idx.set(k, [f])
  }
  return idx
}

export function makeContext(snapshot: DatasetSnapshot, excluded: QcCategory[], flagIndex?: Map<string, CellFlag[]>): ObservationContext {
  return {
    snapshot,
    varByKey: new Map(snapshot.variables.map((v) => [v.key, v])),
    flagIndex: flagIndex ?? buildFlagIndex(snapshot),
    excludedCategories: new Set(excluded)
  }
}

export function getObservation(ctx: ObservationContext, row: number, variable: number): Observation {
  const value = ctx.snapshot.values[variable]?.[row] ?? { k: 'missing' }
  const flags = ctx.flagIndex.get(cellKey(row, variable)) ?? []
  const qcExcludedBy: QcCategory[] = []
  if (value.k !== 'missing') {
    for (const f of flags) if (f.category && ctx.excludedCategories.has(f.category)) qcExcludedBy.push(f.category)
  }
  return { row, value, flags, qcExcludedBy }
}

type Tri = boolean

function evalCondition(ctx: ObservationContext, c: FilterCondition, row: number): Tri {
  const v = ctx.varByKey.get(c.variableKey)
  if (!v) return c.onMissing === 'include'
  const obs = getObservation(ctx, row, v.index)
  const unavailable = obs.value.k === 'missing' || obs.qcExcludedBy.length > 0
  switch (c.test.kind) {
    case 'missing':
      return unavailable
    case 'present':
      return !unavailable
    case 'range': {
      if (unavailable || obs.value.k !== 'number') return c.onMissing === 'include'
      const { min, max } = c.test
      if (min !== null && obs.value.v < min) return false
      if (max !== null && obs.value.v > max) return false
      return true
    }
    case 'in': {
      if (unavailable) return c.onMissing === 'include'
      const label = obs.value.k === 'number' ? obs.value.raw : obs.value.k === 'text' || obs.value.k === 'censored' ? obs.value.raw : ''
      return c.test.values.includes(label.trim())
    }
  }
}

function hasConditions(node: FilterNode): boolean {
  return node.type === 'cond' || node.children.some(hasConditions)
}

/** Empty groups are ignored (they neither match nor block), so an empty OR branch cannot select everything. */
export function evalFilter(ctx: ObservationContext, node: FilterNode, row: number): boolean {
  if (node.type === 'cond') return evalCondition(ctx, node, row)
  const kids = node.children.filter(hasConditions)
  if (kids.length === 0) return true
  if (node.op === 'and') return kids.every((ch) => evalFilter(ctx, ch, row))
  return kids.some((ch) => evalFilter(ctx, ch, row))
}

export function describeCondition(ctx: Pick<ObservationContext, 'varByKey'>, c: FilterCondition): string {
  const v = ctx.varByKey.get(c.variableKey)
  const name = v ? v.meta.displayLabel.value ?? v.header : c.variableKey
  const miss = c.onMissing === 'include' ? ' (missing kept)' : ''
  switch (c.test.kind) {
    case 'missing':
      return `${name} is missing`
    case 'present':
      return `${name} is present`
    case 'range': {
      const { min, max } = c.test
      if (min !== null && max !== null) return `${min} ≤ ${name} ≤ ${max}${miss}`
      if (min !== null) return `${name} ≥ ${min}${miss}`
      if (max !== null) return `${name} ≤ ${max}${miss}`
      return `${name} (any value)${miss}`
    }
    case 'in':
      return `${name} ∈ {${c.test.values.join(', ')}}${miss}`
  }
}

export function describeFilter(ctx: Pick<ObservationContext, 'varByKey'>, g: FilterGroup): string {
  if (g.children.length === 0) return 'All rows'
  const parts = g.children.map((ch) => (ch.type === 'cond' ? describeCondition(ctx, ch) : `(${describeFilter(ctx, ch)})`))
  return parts.join(g.op === 'and' ? ' AND ' : ' OR ')
}

export function computeSelection(snapshot: DatasetSnapshot, spec: SelectionSpec, flagIndex?: Map<string, CellFlag[]>): SelectionResult {
  const ctx = makeContext(snapshot, spec.qc.exclude, flagIndex)
  const visitSet = spec.visitIds === 'all' ? null : new Set(spec.visitIds)
  const pSet = spec.participantIds ? new Set(spec.participantIds) : null
  const rows: number[] = []
  const excludedRows: RowExclusion[] = []
  let scope = 0
  for (const r of snapshot.rows) {
    if (visitSet && !visitSet.has(r.visitId)) {
      excludedRows.push({ row: r.index, reason: 'Visit not selected' })
      continue
    }
    if (pSet && !pSet.has(r.participantId)) {
      excludedRows.push({ row: r.index, reason: 'Participant not in selection list' })
      continue
    }
    scope++
    if (evalFilter(ctx, spec.filter, r.index)) rows.push(r.index)
    else {
      const failing =
        spec.filter.op === 'and'
          ? spec.filter.children.filter((ch) => !evalFilter(ctx, ch, r.index))
          : spec.filter.children
      const reason = failing
        .map((ch) => (ch.type === 'cond' ? describeCondition(ctx, ch) : `(${describeFilter(ctx, ch)})`))
        .join(spec.filter.op === 'and' ? '; ' : ' OR ')
      excludedRows.push({ row: r.index, reason: `Did not match: ${reason}` })
    }
  }
  const participantIds = [...new Set(rows.map((i) => snapshot.rows[i].participantId))]
  return { rows, excludedRows, participantIds, scopeRowCount: scope, ctx }
}

export function observationsFor(sel: SelectionResult, variable: number): Observation[] {
  return sel.rows.map((row) => getObservation(sel.ctx, row, variable))
}

/** Observations that count toward analysis: present and not excluded by the QC policy. */
export function isUsable(o: Observation): boolean {
  return o.value.k !== 'missing' && o.qcExcludedBy.length === 0
}

export function countsFor(sel: SelectionResult, variable: number): VariableCounts {
  const c: VariableCounts = { included: 0, numeric: 0, missing: 0, censored: 0, text: 0, qcExcluded: 0, flaggedIncluded: 0 }
  for (const o of observationsFor(sel, variable)) {
    if (o.value.k === 'missing') {
      c.missing++
      continue
    }
    if (o.qcExcludedBy.length) {
      c.qcExcluded++
      continue
    }
    c.included++
    if (o.flags.some((f) => f.category)) c.flaggedIncluded++
    if (o.value.k === 'number') c.numeric++
    else if (o.value.k === 'censored') c.censored++
    else c.text++
  }
  return c
}

export interface PairedResult {
  pairs: { row: number; x: number; y: number; xObs: Observation; yObs: Observation }[]
  missingX: number
  missingY: number
  missingBoth: number
  unevaluable: number // censored or text in either axis
  qcExcluded: number
}

export function pairedObservations(sel: SelectionResult, xVar: number, yVar: number): PairedResult {
  const out: PairedResult = { pairs: [], missingX: 0, missingY: 0, missingBoth: 0, unevaluable: 0, qcExcluded: 0 }
  for (const row of sel.rows) {
    const xo = getObservation(sel.ctx, row, xVar)
    const yo = getObservation(sel.ctx, row, yVar)
    const xm = xo.value.k === 'missing'
    const ym = yo.value.k === 'missing'
    if (xm && ym) out.missingBoth++
    else if (xm) out.missingX++
    else if (ym) out.missingY++
    else if (xo.qcExcludedBy.length || yo.qcExcludedBy.length) out.qcExcluded++
    else if (xo.value.k !== 'number' || yo.value.k !== 'number') out.unevaluable++
    else out.pairs.push({ row, x: xo.value.v, y: yo.value.v, xObs: xo, yObs: yo })
  }
  return out
}

/** Per-category counts of QC-excluded observations and affected participants for given variables. */
export function qcImpact(
  snapshot: DatasetSnapshot,
  rows: number[],
  variables: number[],
  categories: QcCategory[],
  flagIndex: Map<string, CellFlag[]>
): Record<string, { observations: number; participants: number; label: string }> {
  const out: Record<string, { observations: number; participants: number; label: string }> = {}
  for (const cat of categories) {
    let obs = 0
    const parts = new Set<string>()
    for (const row of rows)
      for (const v of variables) {
        const val = snapshot.values[v]?.[row]
        if (!val || val.k === 'missing') continue
        const flags = flagIndex.get(cellKey(row, v))
        if (flags?.some((f) => f.category === cat)) {
          obs++
          parts.add(snapshot.rows[row].participantId)
        }
      }
    out[cat] = { observations: obs, participants: parts.size, label: QC_CATEGORY_LABELS[cat] }
  }
  return out
}
