// Data preparation for charts. Rendering lives in the renderer; these functions are pure and tested.
import type { SelectionResult, Observation } from './selection'
import { getObservation, isUsable, pairedObservations } from './selection'
import { summarize, type Summary } from './stats'
import type { CellValue } from './types'

export interface PlotPoint {
  row: number
  participantId: string
  value: number
  flagged: boolean // carries any QC-type flag (included under the current policy)
  unresolved: boolean // carries unresolved formatting
}

export interface DistributionGroup {
  label: string
  points: PlotPoint[]
  summary: Summary
  nonPositiveHidden: PlotPoint[] // shown in a notice when a log axis is used
}

export interface DistributionData {
  groups: DistributionGroup[]
  totals: { rows: number; participants: number; usableNumeric: number; missing: number; censored: number; nonNumeric: number; qcExcluded: number }
  logValid: boolean
  logReason: string | null
}

export const MISSING_GROUP = '(missing group value)'

function pointFrom(sel: SelectionResult, o: Observation): PlotPoint {
  const v = o.value as Extract<CellValue, { k: 'number' }>
  return {
    row: o.row,
    participantId: sel.ctx.snapshot.rows[o.row].participantId,
    value: v.v,
    flagged: o.flags.some((f) => f.category && f.category !== 'unresolved_highlight'),
    unresolved: o.flags.some((f) => f.category === 'unresolved_highlight')
  }
}

function groupLabel(sel: SelectionResult, row: number, groupVar: number | null): string {
  if (groupVar === null) return 'All selected'
  const o = getObservation(sel.ctx, row, groupVar)
  if (o.value.k === 'missing') return MISSING_GROUP
  if (o.qcExcludedBy.length) return '(group value QC-excluded)'
  return o.value.k === 'number' ? o.value.raw.trim() : o.value.raw.trim()
}

export function distributionData(sel: SelectionResult, variable: number, groupVar: number | null, scale: 'linear' | 'log'): DistributionData {
  const byGroup = new Map<string, Observation[]>()
  for (const row of sel.rows) {
    const label = groupLabel(sel, row, groupVar)
    const list = byGroup.get(label) ?? []
    list.push(getObservation(sel.ctx, row, variable))
    byGroup.set(label, list)
  }
  const totals = { rows: sel.rows.length, participants: sel.participantIds.length, usableNumeric: 0, missing: 0, censored: 0, nonNumeric: 0, qcExcluded: 0 }
  const groups: DistributionGroup[] = []
  let anyPositive = false
  const labels = [...byGroup.keys()].sort((a, b) => (a === MISSING_GROUP ? 1 : b === MISSING_GROUP ? -1 : a.localeCompare(b, undefined, { numeric: true })))
  for (const label of labels) {
    const obs = byGroup.get(label)!
    const usable = obs.filter(isUsable)
    totals.qcExcluded += obs.filter((o) => o.value.k !== 'missing' && o.qcExcludedBy.length).length
    const summary = summarize(usable.map((o) => o.value))
    summary.missing = obs.filter((o) => o.value.k === 'missing').length
    totals.missing += summary.missing
    totals.censored += summary.censored
    totals.nonNumeric += summary.nonNumeric
    totals.usableNumeric += summary.n
    const pts = usable.filter((o) => o.value.k === 'number').map((o) => pointFrom(sel, o))
    const shown = scale === 'log' ? pts.filter((p) => p.value > 0) : pts
    const hidden = scale === 'log' ? pts.filter((p) => p.value <= 0) : []
    if (pts.some((p) => p.value > 0)) anyPositive = true
    groups.push({ label, points: shown, summary, nonPositiveHidden: hidden })
  }
  const logValid = anyPositive
  return { groups, totals, logValid, logReason: logValid ? null : 'A log axis needs at least one positive value.' }
}

export interface ScatterData {
  points: (PlotPoint & { x: number; y: number })[]
  hidden: { row: number; participantId: string; x: number; y: number; axis: 'x' | 'y' | 'both' }[]
  missingX: number
  missingY: number
  missingBoth: number
  unevaluable: number
  qcExcluded: number
  logValidX: boolean
  logValidY: boolean
}

export function scatterData(sel: SelectionResult, xVar: number, yVar: number, xScale: 'linear' | 'log', yScale: 'linear' | 'log'): ScatterData {
  const pr = pairedObservations(sel, xVar, yVar)
  const out: ScatterData = {
    points: [],
    hidden: [],
    missingX: pr.missingX,
    missingY: pr.missingY,
    missingBoth: pr.missingBoth,
    unevaluable: pr.unevaluable,
    qcExcluded: pr.qcExcluded,
    logValidX: pr.pairs.some((p) => p.x > 0),
    logValidY: pr.pairs.some((p) => p.y > 0)
  }
  for (const p of pr.pairs) {
    const badX = xScale === 'log' && p.x <= 0
    const badY = yScale === 'log' && p.y <= 0
    const participantId = sel.ctx.snapshot.rows[p.row].participantId
    if (badX || badY) {
      out.hidden.push({ row: p.row, participantId, x: p.x, y: p.y, axis: badX && badY ? 'both' : badX ? 'x' : 'y' })
      continue
    }
    const flags = [...p.xObs.flags, ...p.yObs.flags]
    out.points.push({
      row: p.row,
      participantId,
      value: p.y,
      x: p.x,
      y: p.y,
      flagged: flags.some((f) => f.category && f.category !== 'unresolved_highlight'),
      unresolved: flags.some((f) => f.category === 'unresolved_highlight')
    })
  }
  return out
}
