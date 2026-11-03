// Analysis log: the steps behind a chart, written in R syntax, each with a short signature.
// This is a readable record of what the app did, not a script that is guaranteed to run. Pure and deterministic:
// the same dataset version, metadata version, selection and chart always give the same text and signatures.
// Participant identifiers are never written; restrictions are reported as counts only.

import type { ChartConfig, DatasetSnapshot, FilterCondition, FilterNode, SelectionSpec, VariableInfo } from './types'
import { QC_CATEGORY_LABELS } from './types'
import { sha256Hex } from './hash'
import { TRANSFORM_LABELS, transformR } from './transforms'

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
      `# source file: ${snapshot.sourceFileName} (sheet "${snapshot.sheetName}"), SHA-256 ${snapshot.sourceSha256.slice(0, 16)}`,
      snapshot.sourceKind === 'csv'
        ? `df <- read.csv(${rStr(snapshot.sourceFileName)}, check.names = FALSE)`
        : `df <- readxl::read_excel(${rStr(snapshot.sourceFileName)}, sheet = ${rStr(snapshot.sheetName)})`
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
  raw.push({
    kind: 'qc',
    title: excluded.length ? `QC policy: exclude ${excluded.map((c) => QC_CATEGORY_LABELS[c]).join('; ')}` : 'QC policy: flagged observations kept and shown',
    code: excluded.length
      ? ['# observations in these categories are set to NA before analysis:', ...excluded.map((c) => `#   ${QC_CATEGORY_LABELS[c]}`)]
      : ['# no QC categories excluded']
  })

  if (chart && chart.type !== 'table') {
    const tfLines: string[] = []
    const addTransform = (key: string | null, id: string | undefined) => {
      if (!key || !id || id === 'none') return
      const v = byKey.get(key)
      const x = col(v, key)
      tfLines.push(`${x} <- ${transformR(id as keyof typeof TRANSFORM_LABELS, x)}  # ${TRANSFORM_LABELS[id as keyof typeof TRANSFORM_LABELS]}`)
    }
    if (chart.type !== 'pca') addTransform(chart.measureKey, chart.transformMeasure)
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
    if (chart.type === 'distribution' && y) lines.push(g ? `boxplot(${y} ~ ${g})` : `boxplot(${y})`)
    else if (chart.type === 'scatter' && y && x) lines.push(`plot(${x}, ${y})`)
    else if (chart.type === 'pca') {
      const keys = chart.pcaKeys ?? []
      const cols = keys.map((k) => rStr(byKey.get(k)?.header ?? k))
      lines.push('# runs only when Compute is pressed; rows with any non-numeric, missing or QC-excluded value in these variables are left out (complete cases)')
      lines.push(`pca_data <- na.omit(df[, c(${cols.join(', ')})])`)
      lines.push('pc <- prcomp(pca_data, center = TRUE, scale. = TRUE)  # components fixed so the largest-magnitude loading is positive')
    }
    if (chart.colorKey) lines.push(`# points coloured by ${byKey.get(chart.colorKey)?.meta.displayLabel.value ?? byKey.get(chart.colorKey)?.header ?? chart.colorKey} (categories as recorded; missing shown as its own category)`)
    if (chart.xScale === 'log' || chart.yScale === 'log') lines.push(`# log scale: x ${chart.xScale}, y ${chart.yScale} (axis only; values unchanged)`)
    const bounds = [chart.xMin, chart.xMax, chart.yMin, chart.yMax]
    if (bounds.some((b) => b !== null && b !== undefined)) lines.push(`# forced axis bounds: x [${chart.xMin ?? 'auto'}, ${chart.xMax ?? 'auto'}], y [${chart.yMin ?? 'auto'}, ${chart.yMax ?? 'auto'}]`)
    if (lines.length) {
      raw.push({ kind: 'chart', title: chart.type === 'pca' ? `Chart: PCA of ${(chart.pcaKeys ?? []).length} variables` : `Chart: ${chart.type} of ${[name(chart.measureKey), name(chart.compareKey)].filter(Boolean).join(' vs ')}${chart.groupKey ? ` by ${name(chart.groupKey)}` : ''}`, code: lines })
    }
    if (chart.analysis?.requested) {
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
