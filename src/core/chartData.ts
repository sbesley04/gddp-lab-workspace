// Data preparation for charts. Rendering lives in the renderer; these functions are pure and tested.
import type { SelectionResult, Observation } from './selection'
import { getObservation, isUsable, pairedObservations } from './selection'
import { summarize, type Summary } from './stats'
import type { CellValue } from './types'
import { buildTransform, type TransformId } from './transforms'

export interface PlotPoint {
  row: number
  participantId: string
  value: number
  flagged: boolean // carries any QC-type flag (included under the current policy)
  unresolved: boolean // carries unresolved formatting
  /** Category of the colour-by covariate for this row (null when not colouring). */
  cat?: string
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
  /** Values the chosen transform cannot define (e.g. log of a non-positive value); omitted and counted. */
  transformDropped: number
  /** Colour-by categories in display order (empty when not colouring). */
  categories: string[]
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

export function categoryLabel(sel: SelectionResult, row: number, groupVar: number | null): string {
  if (groupVar === null) return 'All selected'
  const o = getObservation(sel.ctx, row, groupVar)
  if (o.value.k === 'missing') return MISSING_GROUP
  if (o.qcExcludedBy.length) return '(group value QC-excluded)'
  return o.value.k === 'number' ? o.value.raw.trim() : o.value.raw.trim()
}

export interface ChartDataOptions {
  transform?: TransformId
  /** Variable index of the colour-by covariate. */
  colorVar?: number | null
}

/** Usable numeric values of a variable in the selection: what a transform is computed from. */
export function numericColumn(sel: SelectionResult, variable: number): number[] {
  const out: number[] = []
  for (const row of sel.rows) {
    const o = getObservation(sel.ctx, row, variable)
    if (isUsable(o) && o.value.k === 'number') out.push(o.value.v)
  }
  return out
}

function orderedCategories(cats: Iterable<string>): string[] {
  return [...new Set(cats)].sort((a, b) => (a === MISSING_GROUP ? 1 : b === MISSING_GROUP ? -1 : a.localeCompare(b, undefined, { numeric: true })))
}

export function distributionData(sel: SelectionResult, variable: number, groupVar: number | null, scale: 'linear' | 'log', opts: ChartDataOptions = {}): DistributionData {
  const tf = opts.transform ?? 'none'
  const fn = buildTransform(tf, tf === 'none' ? [] : numericColumn(sel, variable))
  let transformDropped = 0
  const colorVar = opts.colorVar ?? null
  const cats = new Set<string>()
  const byGroup = new Map<string, Observation[]>()
  for (const row of sel.rows) {
    const label = categoryLabel(sel, row, groupVar)
    const list = byGroup.get(label) ?? []
    let obs = getObservation(sel.ctx, row, variable)
    if (tf !== 'none' && isUsable(obs) && obs.value.k === 'number') {
      const t = fn(obs.value.v)
      if (t === null) {
        transformDropped++
        byGroup.set(label, list)
        continue
      }
      obs = { ...obs, value: { k: 'number', v: t, raw: String(t) } }
    }
    list.push(obs)
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
    const pts = usable.filter((o) => o.value.k === 'number').map((o) => {
      const pt = pointFrom(sel, o)
      if (colorVar !== null) {
        pt.cat = categoryLabel(sel, o.row, colorVar)
        cats.add(pt.cat)
      }
      return pt
    })
    const shown = scale === 'log' ? pts.filter((p) => p.value > 0) : pts
    const hidden = scale === 'log' ? pts.filter((p) => p.value <= 0) : []
    if (pts.some((p) => p.value > 0)) anyPositive = true
    groups.push({ label, points: shown, summary, nonPositiveHidden: hidden })
  }
  const logValid = anyPositive
  return { groups, totals, transformDropped, categories: orderedCategories(cats), logValid, logReason: logValid ? null : 'A log axis needs at least one positive value.' }
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
  transformDropped: number
  categories: string[]
}

export function scatterData(
  sel: SelectionResult,
  xVar: number,
  yVar: number,
  xScale: 'linear' | 'log',
  yScale: 'linear' | 'log',
  opts: { transformX?: TransformId; transformY?: TransformId; colorVar?: number | null } = {}
): ScatterData {
  const pr = pairedObservations(sel, xVar, yVar)
  const tx = opts.transformX ?? 'none'
  const ty = opts.transformY ?? 'none'
  const fx = buildTransform(tx, tx === 'none' ? [] : numericColumn(sel, xVar))
  const fy = buildTransform(ty, ty === 'none' ? [] : numericColumn(sel, yVar))
  let transformDropped = 0
  const cats = new Set<string>()
  const colorVar = opts.colorVar ?? null
  pr.pairs = pr.pairs.flatMap((p) => {
    const x = fx(p.x)
    const y = fy(p.y)
    if (x === null || y === null) {
      transformDropped++
      return []
    }
    return [{ ...p, x, y }]
  })
  const out: ScatterData = {
    points: [],
    hidden: [],
    missingX: pr.missingX,
    missingY: pr.missingY,
    missingBoth: pr.missingBoth,
    unevaluable: pr.unevaluable,
    qcExcluded: pr.qcExcluded,
    logValidX: pr.pairs.some((p) => p.x > 0),
    logValidY: pr.pairs.some((p) => p.y > 0),
    transformDropped,
    categories: []
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
    const cat = colorVar !== null ? categoryLabel(sel, p.row, colorVar) : undefined
    if (cat !== undefined) cats.add(cat)
    out.points.push({
      row: p.row,
      participantId,
      cat,
      value: p.y,
      x: p.x,
      y: p.y,
      flagged: flags.some((f) => f.category && f.category !== 'unresolved_highlight'),
      unresolved: flags.some((f) => f.category === 'unresolved_highlight')
    })
  }
  out.categories = orderedCategories(cats)
  return out
}
