// What the statistics panel computes, as pure functions, so the renderer (for display) and the main process (for the
// analysis register) run exactly the same code on the same selection. Nothing here runs until Compute is pressed.
//
// The independence guard lives here: when any participant contributes more than one observation to the analysed
// rows, no test, confidence interval or normality check is produced. Only plain descriptives are returned.

import type { ChartConfig, DatasetSnapshot, FilterNode, SelectionSpec, VariableInfo } from './types'
import { QC_CATEGORY_LABELS } from './types'
import { distributionData, scatterData, type DistributionData, type ScatterData } from './chartData'
import {
  brownForsythe, describe, hedgesG, holm, kendall, kruskalWallis, linearFit, mannWhitney, oneWayAnova, pearson, spearman, welchAnova, welchT,
  type AnovaResult, type Correlation, type Descriptive, type HedgesG, type KruskalResult, type LinearFit, type MannWhitney, type WelchT
} from './analysis'
import { repeatInfoOfIds, visitsOfRows, type RepeatInfo } from './independence'
import type { CensoringInfo } from './censoring'
import { computeSelection, describeFilter, type SelectionResult } from './selection'
import { sha256Hex } from './hash'
import type { TransformId } from './transforms'

// ---------------------------------------------------------------- distribution

export interface GroupStats {
  label: string
  values: number[]
  rows: number[]
  d: Descriptive
  censoring: CensoringInfo
}

export interface PairTest {
  a: string
  b: string
  t: WelchT | null
  mw: MannWhitney | null
}

export interface DistributionAnalysis {
  groups: GroupStats[]
  /** Rows whose grouping value is missing or QC-excluded: shown, never compared. */
  excludedGroups: { label: string; n: number }[]
  independence: RepeatInfo
  /** True when a participant contributes more than one observation: no test or interval was computed. */
  blocked: boolean
  two: { a: string; b: string; t: WelchT | null; g: HedgesG | null; mw: MannWhitney | null } | null
  many: { welch: AnovaResult | null; classic: AnovaResult | null; kw: KruskalResult | null; bf: AnovaResult | null; pairs: PairTest[]; holmT: number[]; holmMw: number[] } | null
}

/** Keeps the plain descriptives and removes everything that assumes independent observations. */
function descriptiveOnly(d: Descriptive): Descriptive {
  return { ...d, se: null, meanCi: null, medianCi: null, geoMeanCi: null, shapiro: null }
}

export function analyseDistribution(data: DistributionData): DistributionAnalysis {
  const special = (label: string) => label.startsWith('(')
  const raw = data.groups
    .filter((g) => !special(g.label))
    .map((g) => {
      const pts = [...g.points, ...g.nonPositiveHidden]
      return { label: g.label, pts, censoring: g.censoring }
    })
  const independence = repeatInfoOfIds(raw.flatMap((g) => g.pts.map((p) => p.participantId)))
  const blocked = independence.repeated
  const groups: GroupStats[] = raw.map((g) => {
    const values = g.pts.map((p) => p.value)
    const d = describe(values)
    return { label: g.label, values, rows: g.pts.map((p) => p.row), d: blocked ? descriptiveOnly(d) : d, censoring: g.censoring }
  })
  const excludedGroups = data.groups.filter((g) => special(g.label)).map((g) => ({ label: g.label, n: g.summary.n }))
  if (blocked) return { groups, excludedGroups, independence, blocked, two: null, many: null }
  const usable = groups.filter((g) => g.values.length > 0)
  const vals = usable.map((g) => g.values)
  let two: DistributionAnalysis['two'] = null
  let many: DistributionAnalysis['many'] = null
  if (usable.length === 2) two = { a: usable[0].label, b: usable[1].label, t: welchT(vals[0], vals[1]), g: hedgesG(vals[0], vals[1]), mw: mannWhitney(vals[0], vals[1]) }
  if (usable.length >= 3) {
    const pairs: PairTest[] = []
    for (let i = 0; i < usable.length; i++)
      for (let j = i + 1; j < usable.length; j++) pairs.push({ a: usable[i].label, b: usable[j].label, t: welchT(vals[i], vals[j]), mw: mannWhitney(vals[i], vals[j]) })
    many = {
      welch: welchAnova(vals),
      classic: oneWayAnova(vals),
      kw: kruskalWallis(vals),
      bf: brownForsythe(vals),
      pairs,
      holmT: holm(pairs.map((p) => p.t?.p ?? 1)),
      holmMw: holm(pairs.map((p) => p.mw?.p ?? 1))
    }
  }
  return { groups, excludedGroups, independence, blocked, two, many }
}

// ---------------------------------------------------------------- scatter

export interface FitInfo {
  transformX: boolean
  transformY: boolean
  excluded: number
}

export interface FitInputs {
  xs: number[]
  ys: number[]
  rows: number[]
  participantIds: string[]
  info: FitInfo
}

/** Values entering the regression: on log axes the fit uses log10 of positive values, as displayed. */
export function fitInputs(data: ScatterData, scales: { xScale: 'linear' | 'log'; yScale: 'linear' | 'log' }): FitInputs {
  const tx = scales.xScale === 'log'
  const ty = scales.yScale === 'log'
  const xs: number[] = []
  const ys: number[] = []
  const rows: number[] = []
  const participantIds: string[] = []
  let excluded = 0
  for (const pt of data.points) {
    if ((tx && pt.x <= 0) || (ty && pt.y <= 0)) {
      excluded++
      continue
    }
    xs.push(tx ? Math.log10(pt.x) : pt.x)
    ys.push(ty ? Math.log10(pt.y) : pt.y)
    rows.push(pt.row)
    participantIds.push(pt.participantId)
  }
  return { xs, ys, rows, participantIds, info: { transformX: tx, transformY: ty, excluded } }
}

export interface ScatterAnalysis {
  fi: FitInputs
  /** Complete pairs drawn (rank correlations use these; Pearson and the fit use `fi`). */
  pairs: number
  independence: RepeatInfo
  blocked: boolean
  pearson: Correlation | null
  spearman: Correlation | null
  kendall: Correlation | null
  fit: LinearFit | null
}

export function analyseScatter(data: ScatterData, scales: { xScale: 'linear' | 'log'; yScale: 'linear' | 'log' }): ScatterAnalysis {
  const fi = fitInputs(data, scales)
  const independence = repeatInfoOfIds(data.points.map((p) => p.participantId))
  const blocked = independence.repeated
  if (blocked) return { fi, pairs: data.points.length, independence, blocked, pearson: null, spearman: null, kendall: null, fit: null }
  const xs = data.points.map((p) => p.x)
  const ys = data.points.map((p) => p.y)
  return { fi, pairs: data.points.length, independence, blocked, pearson: pearson(fi.xs, fi.ys), spearman: spearman(xs, ys), kendall: kendall(xs, ys), fit: linearFit(fi.xs, fi.ys) }
}

/** Whether inferential overlays (fit line, bands, mean CI) may be drawn for these points. */
export function overlaysAllowed(points: { participantId: string }[]): boolean {
  return !repeatInfoOfIds(points.map((p) => p.participantId)).repeated
}

// ---------------------------------------------------------------- the tests that were run

export interface TestEntry {
  test: string
  /** What was compared or tested (group labels, a coefficient, a variable). */
  on: string
  statistic: string
  value: number
  df: string | null
  p: number
  /** Holm-adjusted p within this analysis, for pairwise comparisons. */
  pHolm?: number
  n: number
  role: 'comparison' | 'association' | 'model' | 'assumption check'
}

const df1 = (x: number) => String(+x.toPrecision(6))

export function distributionTests(a: DistributionAnalysis): TestEntry[] {
  if (a.blocked) return []
  const out: TestEntry[] = []
  const nOf = (label: string) => a.groups.find((g) => g.label === label)?.d.n ?? 0
  for (const g of a.groups) if (g.d.shapiro) out.push({ test: 'Shapiro–Wilk', on: g.label, statistic: 'W', value: g.d.shapiro.w, df: null, p: g.d.shapiro.p, n: g.d.n, role: 'assumption check' })
  if (a.two) {
    const on = `${a.two.a} vs ${a.two.b}`
    const n = nOf(a.two.a) + nOf(a.two.b)
    if (a.two.t) out.push({ test: "Welch's t", on, statistic: 't', value: a.two.t.t, df: df1(a.two.t.df), p: a.two.t.p, n, role: 'comparison' })
    if (a.two.mw) out.push({ test: `Mann–Whitney (${a.two.mw.method})`, on, statistic: 'W', value: a.two.mw.w, df: null, p: a.two.mw.p, n, role: 'comparison' })
  }
  if (a.many) {
    const m = a.many
    const all = a.groups.filter((g) => g.values.length > 0)
    const on = all.map((g) => g.label).join(', ')
    const n = all.reduce((s, g) => s + g.d.n, 0)
    if (m.welch) out.push({ test: 'Welch ANOVA', on, statistic: 'F', value: m.welch.f, df: `${df1(m.welch.df1)}, ${df1(m.welch.df2)}`, p: m.welch.p, n, role: 'comparison' })
    if (m.classic) out.push({ test: 'One-way ANOVA', on, statistic: 'F', value: m.classic.f, df: `${m.classic.df1}, ${m.classic.df2}`, p: m.classic.p, n, role: 'comparison' })
    if (m.kw) out.push({ test: 'Kruskal–Wallis', on, statistic: 'H', value: m.kw.h, df: String(m.kw.df), p: m.kw.p, n, role: 'comparison' })
    if (m.bf) out.push({ test: 'Brown–Forsythe', on, statistic: 'F', value: m.bf.f, df: `${df1(m.bf.df1)}, ${df1(m.bf.df2)}`, p: m.bf.p, n, role: 'assumption check' })
    m.pairs.forEach((pr, i) => {
      const pn = nOf(pr.a) + nOf(pr.b)
      if (pr.t) out.push({ test: "Welch's t (pairwise)", on: `${pr.a} vs ${pr.b}`, statistic: 't', value: pr.t.t, df: df1(pr.t.df), p: pr.t.p, pHolm: m.holmT[i], n: pn, role: 'comparison' })
      if (pr.mw) out.push({ test: 'Mann–Whitney (pairwise)', on: `${pr.a} vs ${pr.b}`, statistic: 'W', value: pr.mw.w, df: null, p: pr.mw.p, pHolm: m.holmMw[i], n: pn, role: 'comparison' })
    })
  }
  return out
}

export function scatterTests(a: ScatterAnalysis, names: { x: string; y: string }): TestEntry[] {
  if (a.blocked) return []
  const out: TestEntry[] = []
  const on = `${names.y} vs ${names.x}`
  if (a.pearson) out.push({ test: "Pearson's r", on, statistic: 't', value: a.pearson.statistic, df: a.pearson.df !== undefined ? String(a.pearson.df) : null, p: a.pearson.p, n: a.fi.xs.length, role: 'association' })
  if (a.spearman) out.push({ test: "Spearman's rho", on, statistic: 't', value: a.spearman.statistic, df: a.spearman.df !== undefined ? String(a.spearman.df) : null, p: a.spearman.p, n: a.pairs, role: 'association' })
  if (a.kendall) out.push({ test: "Kendall's tau-b", on, statistic: 'z', value: a.kendall.statistic, df: null, p: a.kendall.p, n: a.pairs, role: 'association' })
  if (a.fit) {
    out.push({ test: 'Linear regression slope', on: `${names.y} on ${names.x}`, statistic: 't', value: a.fit.slope.t, df: String(a.fit.df2), p: a.fit.slope.p, n: a.fit.n, role: 'model' })
    out.push({ test: 'Linear regression intercept', on: `${names.y} on ${names.x}`, statistic: 't', value: a.fit.intercept.t, df: String(a.fit.df2), p: a.fit.intercept.p, n: a.fit.n, role: 'model' })
    if (a.fit.residualShapiro) out.push({ test: 'Shapiro–Wilk (residuals)', on: `${names.y} on ${names.x}`, statistic: 'W', value: a.fit.residualShapiro.w, df: null, p: a.fit.residualShapiro.p, n: a.fit.n, role: 'assumption check' })
  }
  return out
}

// ---------------------------------------------------------------- register record

export const ANALYSIS_RECORD_SCHEMA = 'bari-analysis/1'

export interface AnalysisRecord {
  schema: typeof ANALYSIS_RECORD_SCHEMA
  kind: 'distribution' | 'scatter'
  title: string
  dataset: { versionId: string; versionNumber: number; sourceSha256: string; metadataVersion: number }
  selection: { visits: string[] | 'all'; filter: string; qcExcluded: string[]; rows: number; participants: number }
  variables: { measure: string; compare: string | null; group: string | null }
  variableKeys: string[]
  transforms: { measure: TransformId; compare: TransformId | null; logX: boolean; logY: boolean }
  /** Observations that entered the tests, the participants they come from and the visits they were taken at. */
  analysed: { rows: number; participants: number; visits: string[] }
  censoring: { variable: string; group: string | null; numeric: number; censored: number; fraction: number | null; biased: boolean }[]
  groups: { label: string; n: number; mean: number | null; sd: number | null; median: number | null; q1: number | null; q3: number | null }[]
  tests: TestEntry[]
}

export interface AnalysisRecordInput {
  snapshot: DatasetSnapshot
  spec: SelectionSpec
  chart: ChartConfig
  /** The selection computed from `spec`, when the caller already has it. */
  sel?: SelectionResult
}

const nameOf = (v: VariableInfo) => v.meta.displayLabel.value ?? v.header

/** Filter without the editor's node ids, so the same rule always gives the same fingerprint. */
function canonicalFilter(node: FilterNode): unknown {
  if (node.type === 'cond') {
    const test = node.test.kind === 'in' ? { kind: 'in', values: [...node.test.values].sort() } : node.test
    return { variableKey: node.variableKey, test, onMissing: node.onMissing }
  }
  return { op: node.op, children: node.children.map(canonicalFilter) }
}

/**
 * Full SHA-256 over everything that decides the numbers: dataset version, metadata version, selection and the
 * analysis inputs. Display settings (colours, axis bounds, overlays) are not part of it.
 */
export function analysisFingerprint(snapshot: DatasetSnapshot, spec: SelectionSpec, chart: ChartConfig): string {
  const scatter = chart.type === 'scatter'
  return sha256Hex(
    JSON.stringify({
      schema: ANALYSIS_RECORD_SCHEMA,
      kind: chart.type,
      datasetVersionId: snapshot.datasetVersionId,
      sourceSha256: snapshot.sourceSha256,
      metadataVersion: snapshot.metadataVersion,
      visits: spec.visitIds === 'all' ? 'all' : [...spec.visitIds].sort(),
      participants: spec.participantIds ? [...spec.participantIds].sort() : null,
      qc: [...spec.qc.exclude].sort(),
      filter: canonicalFilter(spec.filter),
      measure: chart.measureKey,
      compare: scatter ? chart.compareKey : null,
      group: scatter ? null : chart.groupKey,
      transformMeasure: chart.transformMeasure ?? 'none',
      transformCompare: scatter ? chart.transformCompare ?? 'none' : null,
      // A log axis changes Pearson's r and the fit (they use log10 values); it changes nothing for a distribution.
      logX: scatter && chart.xScale === 'log',
      logY: scatter && chart.yScale === 'log'
    })
  )
}

/**
 * Recomputes the analysis a chart shows and describes it for the register. Returns null when the chart has no
 * statistics panel, a variable is missing, or the independence guard blocked the tests (nothing was tested).
 */
export function buildAnalysisRecord(input: AnalysisRecordInput): { record: AnalysisRecord; fingerprint: string } | null {
  const { snapshot, spec, chart } = input
  if (chart.type !== 'distribution' && chart.type !== 'scatter') return null
  const byKey = new Map(snapshot.variables.map((v) => [v.key, v]))
  const measure = chart.measureKey ? byKey.get(chart.measureKey) : undefined
  if (!measure) return null
  const sel = input.sel ?? computeSelection(snapshot, spec)
  const tfM = chart.transformMeasure ?? 'none'
  const visitNames = spec.visitIds === 'all' ? ('all' as const) : spec.visitIds.map((id) => snapshot.visits.find((v) => v.id === id)?.name ?? id)
  const base = {
    schema: ANALYSIS_RECORD_SCHEMA,
    dataset: { versionId: snapshot.datasetVersionId, versionNumber: snapshot.versionNumber, sourceSha256: snapshot.sourceSha256, metadataVersion: snapshot.metadataVersion },
    selection: { visits: visitNames, filter: describeFilter(sel.ctx, spec.filter), qcExcluded: spec.qc.exclude.map((c) => QC_CATEGORY_LABELS[c]), rows: sel.rows.length, participants: sel.participantIds.length }
  } as const
  const analysedOf = (rows: number[]) => ({ rows: rows.length, participants: new Set(rows.map((r) => snapshot.rows[r].participantId)).size, visits: visitsOfRows(snapshot, rows).map((v) => v.name) })
  const cens = (variable: string, group: string | null, c: CensoringInfo) => ({ variable, group, numeric: c.numeric, censored: c.censored, fraction: c.fraction, biased: c.biased })

  if (chart.type === 'distribution') {
    const group = chart.groupKey ? byKey.get(chart.groupKey) ?? null : null
    const data = distributionData(sel, measure.index, group?.index ?? null, 'linear', { transform: tfM })
    const a = analyseDistribution(data)
    const tests = distributionTests(a)
    if (a.blocked || tests.length === 0) return null
    const record: AnalysisRecord = {
      ...base,
      kind: 'distribution',
      title: `${nameOf(measure)}${group ? ` by ${nameOf(group)}` : ''}`,
      variables: { measure: measure.header, compare: null, group: group?.header ?? null },
      variableKeys: [measure.key, ...(group ? [group.key] : [])],
      transforms: { measure: tfM, compare: null, logX: false, logY: false },
      analysed: analysedOf(a.groups.flatMap((g) => g.rows)),
      censoring: a.groups.filter((g) => g.censoring.censored > 0).map((g) => cens(measure.header, group ? g.label : null, g.censoring)),
      groups: a.groups.map((g) => ({ label: g.label, n: g.d.n, mean: g.d.mean, sd: g.d.sd, median: g.d.median, q1: g.d.q1, q3: g.d.q3 })),
      tests
    }
    return { record, fingerprint: analysisFingerprint(snapshot, spec, chart) }
  }

  const compare = chart.compareKey ? byKey.get(chart.compareKey) : undefined
  if (!compare) return null
  const tfC = chart.transformCompare ?? 'none'
  const data = scatterData(sel, compare.index, measure.index, chart.xScale, chart.yScale, { transformX: tfC, transformY: tfM })
  const a = analyseScatter(data, chart)
  const tests = scatterTests(a, { x: nameOf(compare), y: nameOf(measure) })
  if (a.blocked || tests.length === 0) return null
  const record: AnalysisRecord = {
    ...base,
    kind: 'scatter',
    title: `${nameOf(measure)} vs ${nameOf(compare)}`,
    variables: { measure: measure.header, compare: compare.header, group: null },
    variableKeys: [measure.key, compare.key],
    transforms: { measure: tfM, compare: tfC, logX: chart.xScale === 'log', logY: chart.yScale === 'log' },
    analysed: analysedOf(data.points.map((p) => p.row)),
    censoring: [cens(compare.header, null, data.censoring.x), cens(measure.header, null, data.censoring.y)].filter((c) => c.censored > 0),
    groups: [],
    tests
  }
  return { record, fingerprint: analysisFingerprint(snapshot, spec, chart) }
}
