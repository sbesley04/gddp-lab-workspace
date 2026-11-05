// Tool implementations for the MCP server. Every tool goes through the app's single selection engine
// (computeSelection) and its R-validated statistics, so results match what the app shows for the same selection.
// Results are aggregate only: no participant identifiers, row numbers or individual values ever leave this module.

import type { CellValue, DatasetSnapshot, FilterCondition, QcCategory, SelectionSpec, VariableInfo } from '@core/types'
import { DEFAULT_QC_POLICY, META_FIELDS, QC_CATEGORIES, QC_CATEGORY_LABELS } from '@core/types'
import { computeSelection, countsFor, describeFilter, getObservation, isUsable, pairedObservations, qcImpact, type SelectionResult } from '@core/selection'
import { categoryLabel, MISSING_GROUP, numericColumn, orderedCategories } from '@core/chartData'
import {
  describe,
  hedgesG,
  holm,
  kendall,
  kruskalWallis,
  linearFit,
  mannWhitney,
  oneWayAnova,
  pearson,
  spearman,
  welchAnova,
  welchT,
  type Correlation,
  type Descriptive,
  type Interval
} from '@core/analysis'
import { correlationFromSelection } from '@core/matrix'
import { gapSuggestion, pcaPlot } from '@core/pca'
import { buildTransform, TRANSFORM_FN, type TransformId } from '@core/transforms'
import { getStudyContext } from '../main/curation'
import { segmentsOf } from '../main/snapshot'
import { getView, listViews } from '../main/views'
import { ToolError, type Workspace } from './workspace'

// ------------------------------------------------------------------ inputs

export interface ConditionInput {
  variable: string
  min?: number
  max?: number
  oneOf?: string[]
  is?: 'missing' | 'present'
  keepMissing?: boolean
}

export interface SelectionInput {
  datasetVersion?: number
  savedView?: string
  visits?: string[]
  where?: ConditionInput[]
  match?: 'all' | 'any'
  qcExclude?: QcCategory[]
}

export type GroupFrom = 'same_row' | 'participant'

// ------------------------------------------------------------------ formatting

/** Rounds to 4 significant figures (p-values to 3) to keep results compact without losing meaning. */
export function sig(x: number | null | undefined, digits = 4): number | null {
  if (x === null || x === undefined || !Number.isFinite(x)) return null
  if (x === 0) return 0
  return Number(x.toPrecision(digits))
}
const pval = (p: number | null | undefined) => (p === null || p === undefined ? null : p < 1e-4 ? '<0.0001' : sig(p, 3))
const ci = (c: Interval | null | undefined) => (c ? [sig(c.lower), sig(c.upper)] : null)

const label = (v: VariableInfo) => v.meta.displayLabel.value ?? v.header

// ------------------------------------------------------------------ resolution

function norm(s: string) {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim()
}

function namesOf(v: VariableInfo): string[] {
  return [v.key, v.header, v.meta.displayLabel.value ?? '', ...v.aliases.map((a) => a.text)].filter(Boolean)
}

function scoreVariable(v: VariableInfo, q: string, tokens: string[]): number {
  const nq = norm(q)
  const names = namesOf(v).map(norm)
  if (names.includes(nq)) return 100
  let s = 0
  if (names.some((n) => n.startsWith(nq))) s += 40
  else if (names.some((n) => n.includes(nq))) s += 30
  const hay = norm([...namesOf(v), v.meta.area.value, v.meta.definition.value, v.meta.unit.value, v.meta.specimen.value, v.meta.assay.value, v.meta.scoreType.value].filter(Boolean).join(' '))
  for (const t of tokens) if (hay.includes(t)) s += 10
  return s
}

/** Finds a variable by key, header, display label or alias (case-insensitive); otherwise suggests close matches. */
export function resolveVariable(snap: DatasetSnapshot, ref: string): VariableInfo {
  const exact = snap.variables.find((v) => v.key === ref)
  if (exact) return exact
  const nq = norm(ref)
  const matches = snap.variables.filter((v) => v.role !== 'blank' && namesOf(v).some((n) => norm(n) === nq))
  if (matches.length === 1) return matches[0]
  if (matches.length > 1)
    throw new ToolError(`"${ref}" matches several variables: ${matches.map((v) => `${v.key} (${v.header}, column ${v.letter})`).join('; ')}. Use the key.`)
  const tokens = nq.split(' ').filter(Boolean)
  const close = snap.variables
    .filter((v) => v.role !== 'blank')
    .map((v) => ({ v, s: scoreVariable(v, ref, tokens) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 5)
  throw new ToolError(
    `No variable named "${ref}".${close.length ? ` Closest: ${close.map((x) => `${x.v.key} (${x.v.header})`).join('; ')}.` : ''} Use search_variables to find the key.`
  )
}

function requireRole(v: VariableInfo, what: string) {
  if (v.role === 'participant_id' || v.role === 'event')
    throw new ToolError(`${v.header} is the ${v.role === 'event' ? 'visit' : 'participant identifier'} column and cannot be used as ${what}. Use the "visits" field to restrict visits.`)
  if (v.role === 'blank') throw new ToolError(`${v.header} is an empty column.`)
}

function resolveVisits(snap: DatasetSnapshot, names: string[] | undefined): string[] | 'all' {
  if (!names || names.length === 0) return 'all'
  return names.map((n) => {
    const v = snap.visits.find((x) => x.name === n) ?? snap.visits.find((x) => norm(x.name) === norm(n))
    if (!v) throw new ToolError(`No visit named "${n}". Visits in this dataset, in order: ${snap.visits.map((x) => x.name).join(', ')}.`)
    return v.id
  })
}

function toCondition(snap: DatasetSnapshot, c: ConditionInput, i: number): FilterCondition {
  const v = resolveVariable(snap, c.variable)
  requireRole(v, 'a filter')
  const onMissing = c.keepMissing ? 'include' : 'exclude'
  const id = `c${i}`
  const kinds = [c.is !== undefined, c.oneOf !== undefined, c.min !== undefined || c.max !== undefined].filter(Boolean).length
  if (kinds !== 1) throw new ToolError(`Filter on ${v.header}: give exactly one of "min"/"max", "oneOf" or "is".`)
  if (c.is) return { type: 'cond', id, variableKey: v.key, test: { kind: c.is }, onMissing }
  if (c.oneOf) return { type: 'cond', id, variableKey: v.key, test: { kind: 'in', values: c.oneOf.map((s) => s.trim()) }, onMissing }
  return { type: 'cond', id, variableKey: v.key, test: { kind: 'range', min: c.min ?? null, max: c.max ?? null }, onMissing }
}

export interface Resolved {
  snap: DatasetSnapshot
  spec: SelectionSpec
  sel: SelectionResult
  versionNumber: number
  warnings: string[]
}

export function resolveSelection(ws: Workspace, input: SelectionInput, forceVisits?: string[]): Resolved {
  const warnings: string[] = []
  if (input.savedView) {
    if (input.visits?.length || input.where?.length || input.qcExclude || input.datasetVersion !== undefined)
      throw new ToolError('Use either "savedView" or the selection fields (datasetVersion, visits, where, qcExclude), not both.')
    const views = listViews(ws.project)
    const view = getView(ws.project, input.savedView) ?? views.find((v) => norm(v.name) === norm(input.savedView!))
    if (!view) throw new ToolError(`No saved view "${input.savedView}". Use list_saved_views to see them.`)
    if (view.metadataChangedSince > 0)
      warnings.push(`The saved view "${view.name}" is pinned to metadata version ${view.metadataVersion}; ${view.metadataChangedSince} curation change(s) have been made since. Results use the pinned version, as the app does.`)
    const snap = ws.snapshot(view.datasetVersionId, view.metadataVersion)
    let spec = view.spec.selection
    if (forceVisits) spec = { ...spec, visitIds: resolveVisits(snap, forceVisits) }
    return { snap, spec, sel: computeSelection(snap, spec), versionNumber: view.datasetVersionNumber, warnings }
  }
  const ver = ws.version(input.datasetVersion)
  const snap = ws.snapshot(ver.id)
  const spec: SelectionSpec = {
    datasetVersionId: ver.id,
    visitIds: resolveVisits(snap, forceVisits ?? input.visits),
    participantIds: null,
    qc: { exclude: input.qcExclude ?? DEFAULT_QC_POLICY.exclude },
    filter: { type: 'group', id: 'root', op: input.match === 'any' ? 'or' : 'and', children: (input.where ?? []).map((c, i) => toCondition(snap, c, i)) }
  }
  return { snap, spec, sel: computeSelection(snap, spec), versionNumber: ver.versionNumber, warnings }
}

// ------------------------------------------------------------------ privacy helpers

/** A participant count, or "<k" when it is below the minimum cell size. Zero is shown as is. */
function count(ws: Workspace, n: number): number | string {
  return n === 0 || n >= ws.policy.minCellSize ? n : `<${ws.policy.minCellSize}`
}
const small = (ws: Workspace, n: number) => n > 0 && n < ws.policy.minCellSize

function participantsOfRows(snap: DatasetSnapshot, rows: Iterable<number>): number {
  const s = new Set<string>()
  for (const r of rows) s.add(snap.rows[r].participantId)
  return s.size
}

function assertSelectionSize(ws: Workspace, r: Resolved) {
  const n = r.sel.participantIds.length
  if (n === 0) throw new ToolError('The selection is empty: no rows match these visits and filters. Use cohort_counts to see why rows were excluded.')
  if (small(ws, n))
    throw new ToolError(`The selection has fewer than ${ws.policy.minCellSize} participants, so results are suppressed to protect privacy. Broaden the filters or visits.`)
}

// ------------------------------------------------------------------ shared result parts

function selectionInfo(ws: Workspace, r: Resolved) {
  const { snap, spec, sel } = r
  const visitNames = spec.visitIds === 'all' ? 'all' : spec.visitIds.map((id) => snap.visits.find((v) => v.id === id)?.name ?? id)
  return {
    datasetVersion: r.versionNumber,
    metadataVersion: snap.metadataVersion,
    visits: visitNames,
    filter: describeFilter(sel.ctx, spec.filter),
    qcExcluded: spec.qc.exclude.map((c) => QC_CATEGORY_LABELS[c]),
    participants: count(ws, sel.participantIds.length),
    rows: count(ws, sel.rows.length)
  }
}

/** Warns when a participant contributes several rows (visits), because the tests assume independent observations. */
function repeatedWarning(r: Resolved, rows: number[], warnings: string[]) {
  const n = participantsOfRows(r.snap, rows)
  if (rows.length > n)
    warnings.push(
      `${rows.length} observations come from ${n} participants: some participants contribute several visits. Tests assume independent observations, so restrict "visits" to one visit, or use change_between_visits for within-participant change.`
    )
}

function transformValues(id: TransformId | undefined, basis: number[], values: number[], warnings: string[], what: string): number[] {
  if (!id || id === 'none') return values
  const f = buildTransform(id, basis)
  const out: number[] = []
  let dropped = 0
  for (const x of values) {
    const t = f(x)
    if (t === null) dropped++
    else out.push(t)
  }
  if (dropped) warnings.push(`${dropped} value(s) of ${what} have no ${TRANSFORM_FN[id as Exclude<TransformId, 'none'>]} transform (e.g. zero or negative under a log) and were left out.`)
  return out
}

function descriptive(d: Descriptive, quasiIdentifier: boolean) {
  return {
    n: d.n,
    mean: sig(d.mean),
    sd: sig(d.sd),
    meanCi95: ci(d.meanCi),
    median: sig(d.median),
    medianCi95: ci(d.medianCi),
    q1: sig(d.q1),
    q3: sig(d.q3),
    // Extremes are individual values; they are withheld for quasi-identifiers (age, BMI...).
    min: quasiIdentifier ? 'withheld (quasi-identifier)' : sig(d.min),
    max: quasiIdentifier ? 'withheld (quasi-identifier)' : sig(d.max),
    geometricMean: sig(d.geoMean),
    skewness: sig(d.skewness, 3),
    shapiroWilkP: pval(d.shapiro?.p)
  }
}

interface GroupData {
  label: string
  rows: number[]
}

/** Splits selection rows into groups by a categorical variable. "participant" uses a participant's value at any visit. */
function groupRows(r: Resolved, groupVar: VariableInfo | null, groupFrom: GroupFrom, rows: number[], warnings: string[]): GroupData[] {
  if (!groupVar) return [{ label: 'All selected', rows }]
  const { sel, snap } = r
  let labelOf = (row: number) => categoryLabel(sel, row, groupVar.index)
  if (groupFrom === 'participant') {
    const byPid = new Map<string, Set<string>>()
    for (const row of snap.rows) {
      const o = getObservation(sel.ctx, row.index, groupVar.index)
      if (!isUsable(o)) continue
      const l = o.value.k === 'missing' ? '' : o.value.raw.trim()
      const set = byPid.get(row.participantId) ?? new Set<string>()
      set.add(l)
      byPid.set(row.participantId, set)
    }
    let inconsistent = 0
    labelOf = (row: number) => {
      const s = byPid.get(snap.rows[row].participantId)
      if (!s || s.size === 0) return MISSING_GROUP
      if (s.size > 1) {
        inconsistent++
        return '(inconsistent across visits)'
      }
      return [...s][0]
    }
    const m = new Map<string, number[]>()
    for (const row of rows) {
      const l = labelOf(row)
      m.set(l, [...(m.get(l) ?? []), row])
    }
    if (inconsistent) warnings.push(`${inconsistent} observation(s) belong to participants whose ${groupVar.header} differs between visits; they are grouped as "(inconsistent across visits)".`)
    return orderedCategories(m.keys()).map((label) => ({ label, rows: m.get(label)! }))
  }
  const m = new Map<string, number[]>()
  for (const row of rows) {
    const l = labelOf(row)
    m.set(l, [...(m.get(l) ?? []), row])
  }
  // Rows with no group value whose participant has one at another visit: typically a covariate recorded at baseline only.
  const missingRows = m.get(MISSING_GROUP) ?? []
  if (missingRows.length) {
    const known = new Set<string>()
    for (const row of snap.rows) if (isUsable(getObservation(sel.ctx, row.index, groupVar.index))) known.add(row.participantId)
    const recoverable = missingRows.filter((row) => known.has(snap.rows[row].participantId)).length
    if (recoverable)
      warnings.push(
        `${groupVar.header} is missing on ${missingRows.length} of ${rows.length} selected rows, but ${recoverable} of those participants have it at another visit. Set groupFrom to "participant" to use each participant's value from any visit.`
      )
  }
  return orderedCategories(m.keys()).map((label) => ({ label, rows: m.get(label)! }))
}

function checkGroupVar(r: Resolved, ref: string | undefined): VariableInfo | null {
  if (!ref) return null
  const g = resolveVariable(r.snap, ref)
  requireRole(g, 'a grouping variable')
  const distinct = new Set<string>()
  for (const row of r.sel.rows) distinct.add(categoryLabel(r.sel, row, g.index))
  if (g.kind === 'numeric' && distinct.size > 12)
    throw new ToolError(`${g.header} is numeric with ${distinct.size} distinct values, so it cannot be a grouping variable. Use correlate, or split it with a "where" range filter.`)
  if (distinct.size > 20) throw new ToolError(`${g.header} has ${distinct.size} distinct values; group by a variable with at most 20 categories.`)
  return g
}

function usableNumbers(sel: SelectionResult, variable: number, rows: number[]) {
  const values: number[] = []
  const c = { missing: 0, censored: 0, text: 0, qcExcluded: 0 }
  for (const row of rows) {
    const o = getObservation(sel.ctx, row, variable)
    if (o.value.k === 'missing') c.missing++
    else if (o.qcExcludedBy.length) c.qcExcluded++
    else if (o.value.k === 'censored') c.censored++
    else if (o.value.k === 'text') c.text++
    else values.push(o.value.v)
  }
  return { values, notAnalysed: c }
}

function measure(r: Resolved, ref: string): VariableInfo {
  const v = resolveVariable(r.snap, ref)
  requireRole(v, 'a measure')
  if (v.kind === 'categorical' || v.kind === 'empty') throw new ToolError(`${v.header} is ${v.kind}, not numeric. Use it as groupBy or in a "oneOf" filter.`)
  return v
}

function censoredNote(n: number, warnings: string[], what: string) {
  if (n) warnings.push(`${n} censored value(s) of ${what} (e.g. "<0.5", below a detection limit) are not numbers and were left out, never replaced by their bound. Results may be biased upward when many values are censored.`)
}

// ------------------------------------------------------------------ tools

export function studyOverview(ws: Workspace) {
  const versions = ws.versions()
  if (versions.length === 0) return { project: ws.project.info.name, datasetVersions: [], note: 'No dataset has been imported yet.' }
  const latest = ws.version()
  const snap = ws.snapshot(latest.id)
  const sel = computeSelection(snap, { datasetVersionId: latest.id, visitIds: 'all', participantIds: null, qc: { exclude: [] }, filter: { type: 'group', id: 'root', op: 'and', children: [] } })
  const measures = snap.variables.filter((v) => v.role === 'measure')
  const areas = new Map<string, { count: number; status: string }>()
  for (const v of measures) {
    const a = v.meta.area.value ?? '(no group)'
    const e = areas.get(a) ?? { count: 0, status: v.meta.area.status }
    e.count++
    areas.set(a, e)
  }
  const flagCounts: Record<string, number> = {}
  for (const f of snap.flags) if (f.category) flagCounts[QC_CATEGORY_LABELS[f.category]] = (flagCounts[QC_CATEGORY_LABELS[f.category]] ?? 0) + 1
  const unresolvedMeta = measures.filter((v) => v.meta.unit.status === 'unknown' || v.meta.definition.status === 'unknown').length
  const needsReview = snap.flags.filter((f) => f.status === 'needs_review').length
  const study = getStudyContext(ws.project, latest.id, snap.metadataVersion)
  return {
    project: ws.project.info.name,
    datasetVersions: versions.map((v) => ({ version: v.versionNumber, sourceFile: v.sourceFileName, sheet: v.sheetName, importedAt: v.createdAt.slice(0, 10), rows: v.rows, participants: v.participants, columns: v.columns })),
    latest: {
      version: latest.versionNumber,
      metadataVersion: snap.metadataVersion,
      participants: count(ws, sel.participantIds.length),
      visits: snap.visits.map((vis) => {
        const rows = snap.rows.filter((r) => r.visitId === vis.id)
        return { name: vis.name, order: vis.order, participants: count(ws, participantsOfRows(snap, rows.map((r) => r.index))) }
      }),
      measures: measures.length,
      measuresByKind: Object.fromEntries(['numeric', 'categorical', 'mixed', 'empty'].map((k) => [k, measures.filter((v) => v.kind === k).length])),
      variableGroups: [...areas.entries()].map(([name, e]) => ({ name, variables: e.count, nameStatus: e.status })),
      covariates: measures.filter((v) => v.covariate).map((v) => v.key),
      quasiIdentifiers: measures.filter((v) => v.quasiIdentifier).map((v) => v.key),
      qcFlaggedObservations: flagCounts,
      measuresWithUnknownUnitOrDefinition: unresolvedMeta,
      formattingNeedingCuratorReview: needsReview,
      comments: snap.annotations.length,
      savedViews: listViews(ws.project).length
    },
    studyContext: study.text || null,
    privacy: { mode: ws.policy.mode, minCellSize: ws.policy.minCellSize }
  }
}

export function searchVariables(ws: Workspace, input: { query?: string; group?: string; kind?: string; datasetVersion?: number; limit?: number; offset?: number }) {
  const ver = ws.version(input.datasetVersion)
  const snap = ws.snapshot(ver.id)
  let vars = snap.variables.filter((v) => v.role !== 'blank')
  if (input.group) vars = vars.filter((v) => norm(v.meta.area.value ?? '').includes(norm(input.group!)))
  if (input.kind) vars = vars.filter((v) => v.kind === input.kind)
  const q = (input.query ?? '').trim()
  let ranked = vars.map((v) => ({ v, s: q ? scoreVariable(v, q, norm(q).split(' ').filter(Boolean)) : 1 }))
  if (q) ranked = ranked.filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.v.columnIndex - b.v.columnIndex)
  const limit = Math.min(input.limit ?? 25, 200)
  const offset = input.offset ?? 0
  const page = ranked.slice(offset, offset + limit)
  return {
    datasetVersion: ver.versionNumber,
    total: ranked.length,
    returned: page.length,
    nextOffset: offset + page.length < ranked.length ? offset + page.length : null,
    variables: page.map(({ v }) => ({
      key: v.key,
      header: v.header,
      label: v.meta.displayLabel.value && v.meta.displayLabel.value !== v.header ? v.meta.displayLabel.value : undefined,
      column: v.letter,
      role: v.role,
      kind: v.kind,
      group: v.meta.area.value,
      unit: v.meta.unit.value,
      aliases: v.aliases.length ? v.aliases.map((a) => a.text) : undefined,
      values: v.counts,
      quasiIdentifier: v.quasiIdentifier || undefined,
      covariate: v.covariate || undefined,
      unknownMetadata: META_FIELDS.filter((f) => v.meta[f].status === 'unknown' && f !== 'displayLabel')
    }))
  }
}

function textCodes(values: CellValue[], rows: number[]) {
  const censored = new Map<string, number>()
  const text = new Map<string, number>()
  for (const r of rows) {
    const v = values[r]
    if (v.k === 'censored') censored.set(v.raw.trim(), (censored.get(v.raw.trim()) ?? 0) + 1)
    else if (v.k === 'text') text.set(v.raw.trim(), (text.get(v.raw.trim()) ?? 0) + 1)
  }
  // Short codes such as "QNS" are reported; free text could identify someone and is only counted.
  const codes = [...text.entries()].filter(([t]) => t.length <= 12)
  return {
    censoredValues: Object.fromEntries(censored),
    textCodes: codes.length <= 10 ? Object.fromEntries(codes) : undefined,
    otherTextValues: text.size - (codes.length <= 10 ? codes.length : 0) || undefined
  }
}

export function describeVariable(ws: Workspace, input: SelectionInput & { variable: string }) {
  const r = resolveSelection(ws, input)
  const v = resolveVariable(r.snap, input.variable)
  const { snap, sel } = r
  const warnings = [...r.warnings]
  const meta = Object.fromEntries(META_FIELDS.map((f) => [f, { value: v.meta[f].value, status: v.meta[f].status, source: v.meta[f].provenance }]))
  const segments = segmentsOf(ws.project, snap.datasetVersionId, snap.metadataVersion)
  const seg = segments.find((s) => s.index === v.groupSegment)
  const byVisit = snap.visits
    .map((vis) => {
      const rows = sel.rows.filter((row) => snap.rows[row].visitId === vis.id)
      if (rows.length === 0) return null
      const sub = { ...sel, rows }
      const c = countsFor(sub, v.index)
      const nums = numericColumn(sub, v.index)
      const people = participantsOfRows(snap, rows)
      return {
        visit: vis.name,
        participants: count(ws, people),
        counts: c,
        ...textCodes(snap.values[v.index], rows),
        summary: v.role === 'measure' && v.kind !== 'categorical' && nums.length >= Math.max(3, ws.policy.minCellSize) ? descriptive(describe(nums), v.quasiIdentifier) : undefined,
        categories:
          v.kind === 'categorical' || (v.kind === 'mixed' && nums.length === 0)
            ? Object.fromEntries(
                orderedCategories(rows.map((row) => categoryLabel(sub, row, v.index))).map((cat) => [cat, count(ws, rows.filter((row) => categoryLabel(sub, row, v.index) === cat).length)])
              )
            : undefined
      }
    })
    .filter(Boolean)
  const flags = qcImpact(snap, sel.rows, [v.index], [...QC_CATEGORIES], sel.ctx.flagIndex)
  const reviewFlags = snap.flags.filter((f) => f.variable === v.index && f.status === 'needs_review').length
  const headerNotes = snap.annotations.filter((a) => a.variable === v.index && a.row === null).map((a) => a.text)
  const cellComments = snap.annotations.filter((a) => a.variable === v.index && a.row !== null).length
  if (v.attribution?.status === 'legend_tentative') warnings.push('Source attribution is tentative: default text colour cannot be told apart from the legend colour it may mean.')
  if (v.meta.unit.status === 'unknown') warnings.push('The unit is unknown; do not assume one.')
  return {
    key: v.key,
    header: v.header,
    column: v.letter,
    role: v.role,
    kind: v.kind,
    metadata: meta,
    variableGroup: seg ? { name: seg.name, status: seg.status, note: seg.note || undefined } : null,
    aliases: v.aliases.map((a) => ({ text: a.text, source: a.source, status: a.status })),
    sourceAttribution: v.attribution,
    quasiIdentifier: v.quasiIdentifier,
    covariate: v.covariate,
    headerComments: headerNotes,
    cellComments,
    selection: selectionInfo(ws, r),
    byVisit,
    qcFlagsInSelection: Object.fromEntries(Object.entries(flags).filter(([, x]) => x.observations > 0).map(([, x]) => [x.label, x.observations])),
    flagsNeedingCuratorReview: reviewFlags,
    warnings
  }
}

export function cohortCounts(ws: Workspace, input: SelectionInput) {
  const r = resolveSelection(ws, input)
  const { snap, sel } = r
  const reasons = new Map<string, number>()
  for (const e of sel.excludedRows) reasons.set(e.reason, (reasons.get(e.reason) ?? 0) + 1)
  const perParticipant = new Map<string, number>()
  for (const row of sel.rows) perParticipant.set(snap.rows[row].participantId, (perParticipant.get(snap.rows[row].participantId) ?? 0) + 1)
  const dist = new Map<number, number>()
  for (const n of perParticipant.values()) dist.set(n, (dist.get(n) ?? 0) + 1)
  return {
    selection: selectionInfo(ws, r),
    byVisit: snap.visits
      .map((vis) => {
        const rows = sel.rows.filter((row) => snap.rows[row].visitId === vis.id)
        return { visit: vis.name, participants: count(ws, participantsOfRows(snap, rows)) }
      })
      .filter((x) => x.participants !== 0),
    visitsPerParticipant: Object.fromEntries([...dist.entries()].sort((a, b) => a[0] - b[0]).map(([k, n]) => [`${k} visit${k === 1 ? '' : 's'}`, count(ws, n)])),
    excludedRowsByReason: Object.fromEntries(reasons),
    warnings: r.warnings
  }
}

export function summarize(ws: Workspace, input: SelectionInput & { variable: string; groupBy?: string; groupFrom?: GroupFrom; transform?: TransformId }) {
  const r = resolveSelection(ws, input)
  assertSelectionSize(ws, r)
  const v = measure(r, input.variable)
  const g = checkGroupVar(r, input.groupBy)
  const warnings = [...r.warnings]
  const basis = numericColumn(r.sel, v.index)
  const groups = groupRows(r, g, input.groupFrom ?? 'same_row', r.sel.rows, warnings)
  let censored = 0
  const out = groups.map((grp) => {
    const { values, notAnalysed } = usableNumbers(r.sel, v.index, grp.rows)
    censored += notAnalysed.censored
    const xs = transformValues(input.transform, basis, values, warnings, v.header)
    const people = participantsOfRows(r.snap, grp.rows)
    const suppressed = small(ws, people) || xs.length < ws.policy.minCellSize
    return {
      group: grp.label,
      participants: count(ws, people),
      observations: count(ws, grp.rows.length),
      notAnalysed,
      summary: suppressed ? `suppressed (fewer than ${ws.policy.minCellSize} values or participants)` : descriptive(describe(xs), v.quasiIdentifier)
    }
  })
  censoredNote(censored, warnings, v.header)
  repeatedWarning(r, r.sel.rows, warnings)
  return {
    variable: { key: v.key, header: v.header, unit: v.meta.unit.value, unitStatus: v.meta.unit.status },
    transform: input.transform ?? 'none',
    groupBy: g ? { key: g.key, header: g.header, from: input.groupFrom ?? 'same_row' } : null,
    selection: selectionInfo(ws, r),
    groups: out,
    warnings: [...new Set(warnings)]
  }
}

export function compareGroups(ws: Workspace, input: SelectionInput & { variable: string; groupBy: string; groups?: string[]; groupFrom?: GroupFrom; transform?: TransformId }) {
  const r = resolveSelection(ws, input)
  assertSelectionSize(ws, r)
  const v = measure(r, input.variable)
  const g = checkGroupVar(r, input.groupBy)!
  const warnings = [...r.warnings]
  let groups = groupRows(r, g, input.groupFrom ?? 'same_row', r.sel.rows, warnings)
  if (input.groups?.length) {
    const want = input.groups.map((x) => x.trim())
    const unknown = want.filter((w) => !groups.some((gr) => gr.label === w))
    if (unknown.length) throw new ToolError(`No group ${unknown.map((u) => `"${u}"`).join(', ')} in ${g.header}. Groups present: ${groups.map((gr) => gr.label).join(', ')}.`)
    groups = want.map((w) => groups.find((gr) => gr.label === w)!)
  } else groups = groups.filter((gr) => !gr.label.startsWith('('))
  if (groups.length < 2) throw new ToolError(`Need at least two groups to compare; ${g.header} has ${groups.length} in this selection.`)
  repeatedWarning(r, groups.flatMap((gr) => gr.rows), warnings)
  const basis = numericColumn(r.sel, v.index)
  let censored = 0
  const data = groups.map((gr) => {
    const u = usableNumbers(r.sel, v.index, gr.rows)
    censored += u.notAnalysed.censored
    return { label: gr.label, xs: transformValues(input.transform, basis, u.values, warnings, v.header), people: participantsOfRows(r.snap, gr.rows) }
  })
  censoredNote(censored, warnings, v.header)
  const tooSmall = data.filter((d) => d.xs.length < Math.max(3, ws.policy.minCellSize) || small(ws, d.people))
  if (tooSmall.length)
    throw new ToolError(`Group(s) ${tooSmall.map((d) => `"${d.label}"`).join(', ')} have fewer than ${Math.max(3, ws.policy.minCellSize)} usable values, so the comparison is suppressed. Choose other groups or broaden the selection.`)
  const groupSummaries = data.map((d) => {
    const s = describe(d.xs)
    return { group: d.label, n: d.xs.length, mean: sig(s.mean), sd: sig(s.sd), median: sig(s.median), iqr: [sig(s.q1), sig(s.q3)], shapiroWilkP: pval(s.shapiro?.p) }
  })
  let tests: Record<string, unknown>
  if (data.length === 2) {
    const [a, b] = data
    const t = welchT(a.xs, b.xs)
    const hg = hedgesG(a.xs, b.xs)
    const mw = mannWhitney(a.xs, b.xs)
    tests = {
      direction: `differences are "${a.label}" minus "${b.label}"`,
      welchT: t && { meanDifference: sig(t.diff), ci95: ci(t.ci), t: sig(t.t), df: sig(t.df), p: pval(t.p) },
      hedgesG: hg && { g: sig(hg.g, 3), ci95: ci(hg.ci) },
      mannWhitney: mw && { W: sig(mw.w), p: pval(mw.p), method: mw.method, rankBiserial: sig(mw.rankBiserial, 3), hodgesLehmannShift: sig(mw.hodgesLehmann) }
    }
  } else {
    const xs = data.map((d) => d.xs)
    const an = oneWayAnova(xs)
    const wa = welchAnova(xs)
    const kw = kruskalWallis(xs)
    const pairs: { a: string; b: string; welchP: number; mwP: number; diff: number | null }[] = []
    for (let i = 0; i < data.length; i++)
      for (let j = i + 1; j < data.length; j++) {
        const t = welchT(data[i].xs, data[j].xs)
        const mw = mannWhitney(data[i].xs, data[j].xs)
        pairs.push({ a: data[i].label, b: data[j].label, welchP: t?.p ?? NaN, mwP: mw?.p ?? NaN, diff: t?.diff ?? null })
      }
    const hw = holm(pairs.map((p) => p.welchP))
    const hm = holm(pairs.map((p) => p.mwP))
    tests = {
      welchAnova: wa && { F: sig(wa.f), df1: sig(wa.df1), df2: sig(wa.df2), p: pval(wa.p) },
      classicAnova: an && { F: sig(an.f), df1: an.df1, df2: an.df2, p: pval(an.p), etaSquared: sig(an.etaSquared, 3) },
      kruskalWallis: kw && { H: sig(kw.h), df: kw.df, p: pval(kw.p), epsilonSquared: sig(kw.epsilonSquared, 3) },
      pairwise: pairs.map((p, i) => ({ groups: `${p.a} − ${p.b}`, meanDifference: sig(p.diff), welchHolmP: pval(hw[i]), mannWhitneyHolmP: pval(hm[i]) }))
    }
  }
  return {
    exploratory: 'Exploratory, unadjusted for other tests in this conversation. Not evidence of a causal or treatment effect.',
    variable: { key: v.key, header: v.header, unit: v.meta.unit.value },
    transform: input.transform ?? 'none',
    groupBy: { key: g.key, header: g.header, from: input.groupFrom ?? 'same_row' },
    selection: selectionInfo(ws, r),
    groups: groupSummaries,
    tests,
    warnings: [...new Set(warnings)]
  }
}

export function correlate(ws: Workspace, input: SelectionInput & { x: string; y: string; method?: 'pearson' | 'spearman' | 'kendall'; transformX?: TransformId; transformY?: TransformId }) {
  const r = resolveSelection(ws, input)
  assertSelectionSize(ws, r)
  const xv = measure(r, input.x)
  const yv = measure(r, input.y)
  const warnings = [...r.warnings]
  const pr = pairedObservations(r.sel, xv.index, yv.index)
  const fx = buildTransform(input.transformX ?? 'none', numericColumn(r.sel, xv.index))
  const fy = buildTransform(input.transformY ?? 'none', numericColumn(r.sel, yv.index))
  const x: number[] = []
  const y: number[] = []
  const rows: number[] = []
  let untransformable = 0
  for (const p of pr.pairs) {
    const a = fx(p.x)
    const b = fy(p.y)
    if (a === null || b === null) untransformable++
    else {
      x.push(a)
      y.push(b)
      rows.push(p.row)
    }
  }
  if (untransformable) warnings.push(`${untransformable} pair(s) had a value with no defined transform (e.g. zero under a log) and were left out.`)
  if (pr.unevaluable) warnings.push(`${pr.unevaluable} pair(s) had a censored or text value in one variable and were left out.`)
  repeatedWarning(r, rows, warnings)
  const people = participantsOfRows(r.snap, rows)
  if (x.length < Math.max(3, ws.policy.minCellSize) || small(ws, people))
    throw new ToolError(`Only ${x.length < ws.policy.minCellSize ? `fewer than ${ws.policy.minCellSize}` : x.length} complete pairs, so the correlation is suppressed. Broaden the selection.`)
  const method = input.method ?? 'spearman'
  const c: Correlation | null = method === 'pearson' ? pearson(x, y) : method === 'kendall' ? kendall(x, y) : spearman(x, y)
  const fit = linearFit(x, y)
  const pr2 = pearson(x, y)
  return {
    exploratory: 'Exploratory association only; correlation is not causation.',
    x: { key: xv.key, header: xv.header, unit: xv.meta.unit.value, transform: input.transformX ?? 'none' },
    y: { key: yv.key, header: yv.header, unit: yv.meta.unit.value, transform: input.transformY ?? 'none' },
    selection: selectionInfo(ws, r),
    pairs: { complete: x.length, missingX: pr.missingX, missingY: pr.missingY, missingBoth: pr.missingBoth, censoredOrText: pr.unevaluable, qcExcluded: pr.qcExcluded },
    correlation: c && { method: c.method, estimate: sig(c.estimate, 3), ci95: ci(c.ci), statistic: sig(c.statistic), df: c.df, p: pval(c.p) },
    linearFit: fit && {
      formula: 'y = intercept + slope · x (ordinary least squares)',
      intercept: { estimate: sig(fit.intercept.estimate), ci95: ci(fit.intercept.ci), p: pval(fit.intercept.p) },
      slope: { estimate: sig(fit.slope.estimate), ci95: ci(fit.slope.ci), p: pval(fit.slope.p) },
      residualSE: sig(fit.sigma),
      rSquared: sig(pr2 ? pr2.estimate ** 2 : null, 3),
      residualShapiroWilkP: pval(fit.residualShapiro?.p),
      influentialPoints: fit.influential.length
    },
    warnings: [...new Set(warnings)]
  }
}

function resolveVariableSet(r: Resolved, refs: string[]): VariableInfo[] {
  if (refs.length < 2) throw new ToolError('Give at least two variables.')
  if (refs.length > 80) throw new ToolError('At most 80 variables per call.')
  const vars = refs.map((ref) => measure(r, ref))
  const keys = new Set(vars.map((v) => v.key))
  if (keys.size !== vars.length) throw new ToolError('The variable list contains duplicates.')
  return vars
}

export function correlationMatrix(ws: Workspace, input: SelectionInput & { variables: string[]; method?: 'pearson' | 'spearman' }) {
  const r = resolveSelection(ws, input)
  assertSelectionSize(ws, r)
  const vars = resolveVariableSet(r, input.variables)
  const warnings = [...r.warnings]
  repeatedWarning(r, r.sel.rows, warnings)
  const m = correlationFromSelection(r.sel, vars, input.method ?? 'spearman')
  const min = Math.max(3, ws.policy.minCellSize)
  const rr = m.r.map((row, i) => row.map((x, j) => (m.n[i][j] < min ? null : sig(x, 3))))
  const top: { a: string; b: string; r: number; n: number }[] = []
  for (let i = 0; i < vars.length; i++) for (let j = i + 1; j < vars.length; j++) if (rr[i][j] !== null) top.push({ a: vars[i].key, b: vars[j].key, r: rr[i][j]!, n: m.n[i][j] })
  top.sort((a, b) => Math.abs(b.r) - Math.abs(a.r))
  const suppressed = m.n.flat().filter((n) => n < min).length
  if (suppressed) warnings.push(`Coefficients with fewer than ${min} complete pairs are shown as null.`)
  return {
    exploratory: 'Descriptive coefficients without p-values. With many pairs, some strong coefficients are expected by chance.',
    method: m.method,
    pairwise: 'pairwise-complete observations; censored, text and QC-excluded values left out',
    selection: selectionInfo(ws, r),
    variables: vars.map((v) => ({ key: v.key, header: v.header })),
    r: rr,
    n: m.n,
    strongestPairs: top.slice(0, 15),
    warnings
  }
}

export function principalComponents(ws: Workspace, input: SelectionInput & { variables: string[]; groupBy?: string; groupFrom?: GroupFrom; components?: number }) {
  const r = resolveSelection(ws, input)
  assertSelectionSize(ws, r)
  const vars = resolveVariableSet(r, input.variables)
  const warnings = [...r.warnings]
  const g = checkGroupVar(r, input.groupBy)
  const plot = pcaPlot(r.sel, vars, null)
  const { input: pin, result } = plot
  const keptPeople = participantsOfRows(r.snap, pin.rows)
  const blockers = pin.blockers.filter((b) => b.count > 0).sort((a, b) => b.count - a.count).slice(0, 10)
  const gap = gapSuggestion(r.sel, vars, pin)
  const base = {
    exploratory: 'PCA on standardised variables (correlation matrix, like R prcomp(scale. = TRUE)). Complete cases only; nothing is imputed.',
    selection: selectionInfo(ws, r),
    completeRows: count(ws, pin.rows.length),
    droppedRows: pin.dropped,
    mostMissingVariables: blockers,
    suggestion: gap ? `Dropping the ${gap.removed} variable(s) with gaps in more than 10% of rows would keep ${gap.rows} complete rows instead of ${pin.rows.length}: ${gap.keep.map((v) => v.key).join(', ')}` : null
  }
  if (pin.dropped > pin.rows.length) warnings.push(`Complete-case analysis kept only ${pin.rows.length} of ${pin.rows.length + pin.dropped} rows; results describe that subset, which may not be representative.`)
  if (!result || plot.error) return { ...base, error: plot.error ?? 'PCA could not be computed.', warnings }
  if (small(ws, keptPeople) || pin.rows.length < ws.policy.minCellSize) return { ...base, error: `Fewer than ${ws.policy.minCellSize} complete rows; PCA suppressed.`, warnings }
  repeatedWarning(r, pin.rows, warnings)
  const k = Math.min(input.components ?? 3, result.k)
  let groupMeans: unknown
  if (g) {
    const grs = groupRows(r, g, input.groupFrom ?? 'same_row', pin.rows, warnings)
    const idx = new Map(pin.rows.map((row, i) => [row, i]))
    groupMeans = grs.map((gr) => {
      const n = gr.rows.length
      if (n < ws.policy.minCellSize) return { group: gr.label, n: count(ws, n), meanScores: 'suppressed' }
      const means = Array.from({ length: k }, (_, c) => sig(gr.rows.reduce((s, row) => s + result.scores[idx.get(row)!][c], 0) / n, 3))
      return { group: gr.label, n, meanScores: Object.fromEntries(means.map((m, c) => [`PC${c + 1}`, m])) }
    })
  }
  return {
    ...base,
    components: Array.from({ length: k }, (_, c) => {
      const loads = vars.map((v, j) => ({ key: v.key, loading: sig(result.loadings[j][c], 3)! })).sort((a, b) => Math.abs(b.loading) - Math.abs(a.loading))
      return { component: `PC${c + 1}`, varianceExplained: sig(result.varianceExplained[c], 3), cumulative: sig(result.cumulative[c], 3), topLoadings: loads.slice(0, 12) }
    }),
    groupMeanScores: groupMeans,
    warnings: [...new Set(warnings)]
  }
}

export function changeBetweenVisits(ws: Workspace, input: SelectionInput & { variable: string; from: string; to: string; groupBy?: string; groupFrom?: GroupFrom; transform?: TransformId }) {
  if (input.visits?.length) throw new ToolError('Use "from" and "to" instead of "visits" for change_between_visits.')
  const r = resolveSelection(ws, input, [input.from, input.to])
  if (input.from.trim() === input.to.trim()) throw new ToolError('"from" and "to" must be different visits.')
  assertSelectionSize(ws, r)
  const v = measure(r, input.variable)
  const g = checkGroupVar(r, input.groupBy)
  const warnings = [...r.warnings]
  const [fromId, toId] = r.spec.visitIds as string[]
  const byPid = new Map<string, { from?: number; to?: number }>()
  for (const row of r.sel.rows) {
    const info = r.snap.rows[row]
    const e = byPid.get(info.participantId) ?? {}
    if (info.visitId === fromId) e.from = row
    else if (info.visitId === toId) e.to = row
    byPid.set(info.participantId, e)
  }
  const basis = numericColumn(r.sel, v.index)
  const f = buildTransform(input.transform ?? 'none', basis)
  const pairs: { row: number; a: number; b: number }[] = []
  const skipped = { onlyFrom: 0, onlyTo: 0, notUsable: 0, noTransform: 0 }
  for (const e of byPid.values()) {
    if (e.from === undefined) {
      skipped.onlyTo++
      continue
    }
    if (e.to === undefined) {
      skipped.onlyFrom++
      continue
    }
    const oa = getObservation(r.sel.ctx, e.from, v.index)
    const ob = getObservation(r.sel.ctx, e.to, v.index)
    if (!isUsable(oa) || !isUsable(ob) || oa.value.k !== 'number' || ob.value.k !== 'number') {
      skipped.notUsable++
      continue
    }
    const a = f(oa.value.v)
    const b = f(ob.value.v)
    if (a === null || b === null) skipped.noTransform++
    else pairs.push({ row: e.from, a, b })
  }
  const groups = groupRows(r, g, input.groupFrom ?? 'participant', pairs.map((p) => p.row), warnings)
  const pairByRow = new Map(pairs.map((p) => [p.row, p]))
  const out = groups.map((gr) => {
    const ps = gr.rows.map((row) => pairByRow.get(row)!)
    if (ps.length < Math.max(3, ws.policy.minCellSize)) return { group: gr.label, participants: count(ws, ps.length), change: `suppressed (fewer than ${Math.max(3, ws.policy.minCellSize)} participants with both visits)` }
    const d = describe(ps.map((p) => p.b - p.a))
    const a = describe(ps.map((p) => p.a))
    const b = describe(ps.map((p) => p.b))
    return {
      group: gr.label,
      participants: ps.length,
      fromMean: sig(a.mean),
      toMean: sig(b.mean),
      fromMedian: sig(a.median),
      toMedian: sig(b.median),
      change: { meanChange: sig(d.mean), meanChangeCi95: ci(d.meanCi), sdChange: sig(d.sd), medianChange: sig(d.median), medianChangeCi95: ci(d.medianCi) },
      increased: ps.filter((p) => p.b > p.a).length,
      decreased: ps.filter((p) => p.b < p.a).length,
      unchanged: ps.filter((p) => p.b === p.a).length
    }
  })
  if (skipped.notUsable) warnings.push(`${skipped.notUsable} participant(s) had a missing, censored, text or QC-excluded value at one of the visits and were left out.`)
  return {
    exploratory:
      'Within-participant change, descriptive. Paired significance tests are not offered yet (not validated against R). Without a control group, change over time is not evidence of a treatment effect.',
    variable: { key: v.key, header: v.header, unit: v.meta.unit.value },
    transform: input.transform ?? 'none',
    change: `"${input.to}" minus "${input.from}"`,
    groupBy: g ? { key: g.key, header: g.header, from: input.groupFrom ?? 'participant' } : null,
    selection: selectionInfo(ws, r),
    participantsWithOnlyFrom: skipped.onlyFrom,
    participantsWithOnlyTo: skipped.onlyTo,
    groups: out,
    warnings: [...new Set(warnings)]
  }
}

export function qcOverview(ws: Workspace, input: SelectionInput & { variables?: string[] }) {
  const r = resolveSelection(ws, input)
  const { snap, sel } = r
  const vars = input.variables?.length ? input.variables.map((ref) => resolveVariable(snap, ref)) : snap.variables.filter((v) => v.role === 'measure')
  const impact = qcImpact(snap, sel.rows, vars.map((v) => v.index), [...QC_CATEGORIES], sel.ctx.flagIndex)
  const inSel = new Set(sel.rows)
  const perVar = vars
    .map((v) => {
      const c = countsFor(sel, v.index)
      const flagged = snap.flags.filter((f) => f.variable === v.index && f.category && inSel.has(f.row)).length
      return { key: v.key, header: v.header, flagged, missing: c.missing, censored: c.censored, text: c.text, qcExcluded: c.qcExcluded }
    })
    .sort((a, b) => b.flagged - a.flagged || b.missing - a.missing)
  const statusCounts: Record<string, number> = {}
  for (const f of snap.flags) if (f.category) statusCounts[f.status] = (statusCounts[f.status] ?? 0) + 1
  return {
    selection: selectionInfo(ws, r),
    policy: `Excluded categories: ${r.spec.qc.exclude.map((c) => QC_CATEGORY_LABELS[c]).join(', ') || 'none'}. Flagged values in other categories are included in analyses.`,
    byCategory: Object.fromEntries(
      Object.entries(impact).map(([cat, x]) => [x.label, { observations: x.observations, participants: count(ws, x.participants), excludedNow: r.spec.qc.exclude.includes(cat as QcCategory) }])
    ),
    flagStatus: statusCounts,
    statusMeaning: {
      legend_exact: 'Colour exactly matches a legend entry.',
      needs_review: 'Colour resembles a legend QC colour; a curator must confirm. Never confirmed automatically.',
      unresolved: 'Undocumented formatting with unknown meaning; never an automatic exclusion.',
      curator_confirmed: 'Confirmed by a curator.'
    },
    variablesMostAffected: perVar.slice(0, 20),
    warnings: r.warnings
  }
}

export function savedViews(ws: Workspace) {
  const views = listViews(ws.project)
  return {
    views: views.map((v) => {
      const snap = ws.snapshot(v.datasetVersionId, v.metadataVersion)
      const byKey = new Map(snap.variables.map((x) => [x.key, x]))
      const name = (k: string | null | undefined) => (k ? (byKey.get(k)?.header ?? k) : null)
      const sel = computeSelection(snap, v.spec.selection)
      const visits = v.spec.selection.visitIds === 'all' ? 'all' : v.spec.selection.visitIds.map((id) => snap.visits.find((x) => x.id === id)?.name ?? id)
      return {
        id: v.id,
        name: v.name,
        description: v.description,
        createdAt: v.createdAt.slice(0, 10),
        datasetVersion: v.datasetVersionNumber,
        metadataVersion: v.metadataVersion,
        curationChangesSince: v.metadataChangedSince,
        chart: v.spec.chart.type,
        measure: name(v.spec.chart.measureKey),
        compareWith: name(v.spec.chart.compareKey),
        groupBy: name(v.spec.chart.groupKey),
        visits,
        filter: describeFilter(sel.ctx, v.spec.selection.filter),
        participants: count(ws, sel.participantIds.length)
      }
    })
  }
}
