// Analysis log: the steps behind a chart, written in R syntax, each with a short signature.
// This is a readable record of what the app did, not a script that is guaranteed to run. Pure and deterministic:
// the same dataset version, metadata version, selection and chart always give the same text and signatures.
// Participant identifiers and the source file name are never written (the file is identified by its SHA-256, as in the
// export manifest); participant restrictions and exclusions are reported as counts only.

import type { ChartConfig, DatasetSnapshot, FilterCondition, FilterNode, QcCategory, SelectionSpec, VariableInfo } from './types'
import { QC_CATEGORY_LABELS } from './types'
import { getObservation, type SelectionResult } from './selection'
import { sha256Hex } from './hash'
import { distributionData, histogramBins } from './chartData'
import { TRANSFORM_LABELS, transformR, type TransformId } from './transforms'

export interface ProvenanceStep {
  n: number
  kind: 'source' | 'visits' | 'participants' | 'filter' | 'qc' | 'transform' | 'chart' | 'statistics'
  title: string
  code: string[]
  /** First 8 hex characters of SHA-256 over the previous signature and this step's text. */
  signature: string
}

export interface Provenance {
  steps: ProvenanceStep[]
  /** Signature of the whole chain (the last step's signature). */
  signature: string
  /** The log as R-syntax text, ready to copy or save as .R */
  text: string
}

export interface ProvenanceInput {
  snapshot: DatasetSnapshot
  spec: SelectionSpec
  chart?: ChartConfig | null
  appVersion: string
  /** The selection computed from `spec`. When given, the log states the resulting n and the QC exclusions it applied. */
  sel?: SelectionResult | null
  /** Variables whose QC exclusions are counted. Defaults to the chart's variables. */
  variableKeys?: string[]
}

/** Colour-by is drawn by box/scatter, PCA and heatmap views, not by tables, histograms or the correlation matrix. */
function colourApplies(chart: ChartConfig): boolean {
  return chart.type !== 'table' && chart.type !== 'correlation' && !(chart.type === 'distribution' && chart.distStyle === 'histogram')
}

/** Variables a chart actually draws or groups by. */
function chartVariableKeys(chart: ChartConfig): string[] {
  const multi = chart.type === 'pca' || chart.type === 'correlation' || chart.type === 'heatmap'
  const keys = multi ? [...(chart.variableSet ?? [])] : chart.type === 'table' ? [...chart.tableColumns] : [chart.measureKey, chart.type === 'scatter' ? chart.compareKey : null, chart.type === 'distribution' ? chart.groupKey : null]
  if (colourApplies(chart)) keys.push(chart.colorKey ?? null)
  return [...new Set(keys.filter((k): k is string => !!k))]
}

const rStr = (s: string) => JSON.stringify(s)
const col = (v: VariableInfo | undefined, key: string) => `df[[${rStr(v?.header ?? key)}]]`
const num = (n: number) => String(n)

function condition(byKey: Map<string, VariableInfo>, c: FilterCondition): string {
  const x = col(byKey.get(c.variableKey), c.variableKey)
  let test: string
  switch (c.test.kind) {
    case 'missing':
      return `is.na(${x})`
    case 'present':
      return `!is.na(${x})`
    case 'range': {
      const parts: string[] = []
      if (c.test.min !== null) parts.push(`${x} >= ${num(c.test.min)}`)
      if (c.test.max !== null) parts.push(`${x} <= ${num(c.test.max)}`)
      test = parts.length ? parts.join(' & ') : 'TRUE'
      break
    }
    case 'in':
      test = `${x} %in% c(${c.test.values.map(rStr).join(', ')})`
      break
  }
  // Missing (or unevaluable) values never satisfy a test unless the researcher chose to keep them.
  return c.onMissing === 'include' ? `(is.na(${x}) | (${test}))` : `(!is.na(${x}) & (${test}))`
}

function filterExpr(byKey: Map<string, VariableInfo>, node: FilterNode): string | null {
  if (node.type === 'cond') return condition(byKey, node)
  const kids = node.children.map((ch) => filterExpr(byKey, ch)).filter((s): s is string => s !== null)
  if (kids.length === 0) return null
  return kids.length === 1 ? kids[0] : `(${kids.join(node.op === 'and' ? ' & ' : ' | ')})`
}

export function buildProvenance(input: ProvenanceInput): Provenance {
  const { snapshot, spec, chart } = input
  const byKey = new Map(snapshot.variables.map((v) => [v.key, v]))
  const raw: Omit<ProvenanceStep, 'n' | 'signature'>[] = []

  raw.push({
    kind: 'source',
    title: `Dataset version ${snapshot.versionNumber}, metadata revision ${snapshot.metadataVersion}, app ${input.appVersion}`,
    code: [
      `# source ${snapshot.sourceKind === 'csv' ? 'CSV' : 'workbook'} SHA-256 ${snapshot.sourceSha256} (file name not recorded)`,
      snapshot.sourceKind === 'csv'
        ? 'df <- read.csv("source.csv", check.names = FALSE)'
        : `df <- readxl::read_excel("source.xlsx", sheet = ${rStr(snapshot.sheetName)})`
    ]
  })

  if (spec.visitIds !== 'all') {
    const names = spec.visitIds.map((id) => snapshot.visits.find((v) => v.id === id)?.name ?? id)
    raw.push({ kind: 'visits', title: `Visits: ${names.join(', ')}`, code: [`df <- subset(df, visit %in% c(${names.map(rStr).join(', ')}))`] })
  }

  if (spec.participantIds) {
    raw.push({
      kind: 'participants',
      title: `Restricted to a list of ${spec.participantIds.length} participants`,
      code: [`# participant list not written to the log (${spec.participantIds.length} identifiers)`, 'df <- subset(df, participant %in% selected_participants)']
    })
  }

  const expr = filterExpr(byKey, spec.filter)
  if (expr) {
    raw.push({ kind: 'filter', title: 'Cohort filter', code: [`df <- df[which(${expr}), ]`] })
  }

  const excluded = spec.qc.exclude
  const qcCode = excluded.length
    ? ['# observations in these categories are set to NA before analysis:', ...excluded.map((c) => `#   ${QC_CATEGORY_LABELS[c]}`)]
    : ['# no QC categories excluded']
  const sel = input.sel
  if (sel) {
    const keys = input.variableKeys ?? (chart ? chartVariableKeys(chart) : [])
    const vars = keys.map((k) => byKey.get(k)).filter((v): v is VariableInfo => !!v)
    const counts = new Map<QcCategory, number>()
    for (const row of sel.rows) for (const v of vars) for (const c of getObservation(sel.ctx, row, v.index).qcExcludedBy) counts.set(c, (counts.get(c) ?? 0) + 1)
    for (const c of excluded) if (counts.get(c)) qcCode.push(`#   ${counts.get(c)} observation(s) set to NA in the variables used: ${QC_CATEGORY_LABELS[c]}`)
    qcCode.push(`# selection result: ${sel.rows.length} row(s), ${sel.participantIds.length} participant(s)`)
  }
  raw.push({
    kind: 'qc',
    title: excluded.length ? `QC policy: exclude ${excluded.map((c) => QC_CATEGORY_LABELS[c]).join('; ')}` : 'QC policy: flagged observations kept and shown',
    code: qcCode
  })

  if (chart && chart.type !== 'table') {
    const tfLines: string[] = []
    const addTransform = (key: string | null, id: TransformId | undefined) => {
      if (!key || !id || id === 'none') return
      const x = col(byKey.get(key), key)
      tfLines.push(`${x} <- ${transformR(id, x)}  # ${TRANSFORM_LABELS[id]}`)
    }
    if (chart.type === 'distribution' || chart.type === 'scatter') addTransform(chart.measureKey, chart.transformMeasure)
    if (chart.type === 'scatter') addTransform(chart.compareKey, chart.transformCompare)
    if (tfLines.length) {
      raw.push({
        kind: 'transform',
        title: 'Display transforms (computed on the usable values of this selection; never imputed)',
        code: [...tfLines, '# values a transform cannot define (log of a non-positive value, zero spread) become NA and are left out of the chart']
      })
    }
    const name = (key: string | null) => (key ? byKey.get(key)?.meta.displayLabel.value ?? byKey.get(key)?.header ?? key : null)
    const lines: string[] = []
    const y = chart.measureKey ? col(byKey.get(chart.measureKey), chart.measureKey) : null
    const x = chart.compareKey ? col(byKey.get(chart.compareKey), chart.compareKey) : null
    const g = chart.groupKey ? col(byKey.get(chart.groupKey), chart.groupKey) : null
    const setCols = (chart.variableSet ?? []).map((k) => rStr(byKey.get(k)?.header ?? k)).join(', ')
    if (chart.type === 'distribution' && y && chart.distStyle === 'histogram') {
      // Exact breaks when the selection is known, so the same histogram can be redrawn in R.
      const mv = chart.measureKey ? byKey.get(chart.measureKey) : undefined
      const bins = sel && mv ? histogramBins(distributionData(sel, mv.index, null, 'linear', { transform: chart.transformMeasure }).groups.flatMap((gr) => gr.points.map((pt) => pt.value))) : null
      const breaks = bins ? `seq(${+bins.start.toPrecision(12)}, ${+(bins.start + bins.width * bins.counts.length).toPrecision(12)}, by = ${+bins.width.toPrecision(12)})` : '"FD"'
      lines.push(`hist(${y}, breaks = ${breaks}, right = FALSE)  # Freedman–Diaconis width rounded to a nice number${g ? `; stacked by ${name(chart.groupKey)}` : ''}`)
    }
    else if (chart.type === 'distribution' && y) lines.push(g ? `boxplot(${y} ~ ${g})` : `boxplot(${y})`)
    else if (chart.type === 'correlation') {
      lines.push(`cor(df[, c(${setCols})], use = "pairwise.complete.obs", method = "${chart.corrMethod ?? 'spearman'}")`)
      lines.push('# coefficients only (no p-values); pairs with fewer than 3 complete observations are left blank')
    } else if (chart.type === 'heatmap') {
      lines.push(`heat <- scale(df[, c(${setCols})])  # z-score per variable over its usable values; missing stays NA`)
      lines.push(`# rows ordered by ${chart.colorKey ? `${name(chart.colorKey)}, then ` : ''}participant; colours clipped at ±3 SD`)
    }
    else if (chart.type === 'scatter' && y && x) lines.push(`plot(${x}, ${y})`)
    else if (chart.type === 'pca') {
      const keys = chart.variableSet ?? []
      const cols = keys.map((k) => rStr(byKey.get(k)?.header ?? k))
      lines.push('# runs only when Compute is pressed; rows with any non-numeric, missing or QC-excluded value in these variables are left out (complete cases)')
      lines.push(`pca_data <- na.omit(df[, c(${cols.join(', ')})])`)
      lines.push('pc <- prcomp(pca_data, center = TRUE, scale. = TRUE)  # components fixed so the largest-magnitude loading is positive')
    }
    if (chart.colorKey && colourApplies(chart)) lines.push(`# points coloured by ${byKey.get(chart.colorKey)?.meta.displayLabel.value ?? byKey.get(chart.colorKey)?.header ?? chart.colorKey} (categories as recorded; missing shown as its own category)`)
    // Axis settings only for the axes the chart type actually uses (a distribution's x axis is its groups; PCA has none).
    const fmtB = (lo: number | null | undefined, hi: number | null | undefined) => `[${lo ?? 'auto'}, ${hi ?? 'auto'}]`
    const set = (b: number | null | undefined) => b !== null && b !== undefined
    if (chart.type === 'scatter') {
      if (chart.xScale === 'log' || chart.yScale === 'log') lines.push(`# log axis: x ${chart.xScale}, y ${chart.yScale} (display only; values unchanged)`)
      if ([chart.xMin, chart.xMax, chart.yMin, chart.yMax].some(set)) lines.push(`# forced axis bounds: x ${fmtB(chart.xMin, chart.xMax)}, y ${fmtB(chart.yMin, chart.yMax)}`)
    } else if (chart.type === 'distribution') {
      if (chart.yScale === 'log') lines.push('# log y axis (display only; values unchanged)')
      if ([chart.yMin, chart.yMax].some(set)) lines.push(`# forced y axis bounds: ${fmtB(chart.yMin, chart.yMax)}`)
    }
    if (lines.length) {
      const nSet = (chart.variableSet ?? []).length
      const multiTitle = chart.type === 'pca' ? `PCA of ${nSet} variables` : chart.type === 'correlation' ? `${chart.corrMethod === 'pearson' ? 'Pearson' : 'Spearman'} correlation matrix of ${nSet} variables` : chart.type === 'heatmap' ? `Heatmap of ${nSet} variables` : null
      raw.push({ kind: 'chart', title: multiTitle ? `Chart: ${multiTitle}` : `Chart: ${chart.type} of ${[name(chart.measureKey), name(chart.compareKey)].filter(Boolean).join(' vs ')}${chart.groupKey ? ` by ${name(chart.groupKey)}` : ''}`, code: lines })
    }
    if (chart.analysis?.requested && (chart.type === 'distribution' || chart.type === 'scatter')) {
      const on = [chart.analysis.fitLine && 'fit line', chart.analysis.confidenceBand && 'confidence band', chart.analysis.predictionBand && 'prediction band', chart.analysis.meanCi && 'mean CI'].filter(Boolean)
      raw.push({
        kind: 'statistics',
        title: 'Statistics panel opened (results are computed only when Compute is pressed)',
        code: ['# exploratory; not adjusted for the number of analyses run', ...(on.length ? [`# overlays: ${on.join(', ')}`] : [])]
      })
    }
  }

  let prev = ''
  const steps: ProvenanceStep[] = raw.map((s, i) => {
    prev = sha256Hex(`${prev}\n${s.kind}\n${s.title}\n${s.code.join('\n')}`).slice(0, 8)
    return { n: i + 1, ...s, signature: prev }
  })
  const text = [
    '# BARI-CNS Research Workspace analysis log (readable record in R syntax; not guaranteed to run as a script)',
    ...steps.flatMap((s) => [``, `# step ${s.n} [${s.signature}] ${s.title}`, ...s.code]),
    '',
    `# chain signature: ${steps[steps.length - 1].signature}`,
    ''
  ].join('\n')
  return { steps, signature: steps[steps.length - 1].signature, text }
}
