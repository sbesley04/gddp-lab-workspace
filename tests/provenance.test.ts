// Analysis log: deterministic text and signatures on a hand-built snapshot.
import { describe, expect, it } from 'vitest'
import { buildProvenance } from '@core/provenance'
import { sha256Hex } from '@core/hash'
import { computeSelection } from '@core/selection'
import { emptyFilter } from '@core/types'
import type { ChartConfig, DatasetSnapshot, SelectionSpec, VariableInfo } from '@core/types'

const meta = () => ({ value: null, status: 'unknown' as const, provenance: '', revisionId: null })
const variable = (index: number, header: string, kind: VariableInfo['kind']): VariableInfo => ({
  index, columnIndex: index + 1, letter: String.fromCharCode(65 + index), key: `k${index}`, header, headerRuns: null, role: 'measure', kind,
  groupSegment: null, subgroupSegment: null, aliases: [], attribution: null, quasiIdentifier: false, covariate: false, categories: [],
  counts: { number: 0, missing: 0, censored: 0, text: 0 },
  meta: { displayLabel: meta(), area: meta(), unit: meta(), specimen: meta(), assay: meta(), scoreType: meta(), definition: meta(), source: meta() }
})

const snapshot: DatasetSnapshot = {
  datasetVersionId: 'v', versionNumber: 2, sourceFileName: 'study.xlsx', sourceSha256: 'a'.repeat(64), sheetName: 'Data', importedAt: '', sourceKind: 'xlsx', metadataVersion: 7,
  visits: [{ id: 'base', name: 'Baseline', order: 1, actualDate: null }, { id: 'm2', name: 'Month 2', order: 2, actualDate: null }],
  rows: [], variables: [variable(0, 'IL6', 'numeric'), variable(1, 'Sex', 'categorical')], values: [[], []], flags: [], annotations: []
}
const spec = (over: Partial<SelectionSpec> = {}): SelectionSpec => ({ datasetVersionId: 'v', visitIds: 'all', filter: emptyFilter(), qc: { exclude: [] }, participantIds: null, ...over })
const chart: ChartConfig = { type: 'distribution', measureKey: 'k0', compareKey: null, groupKey: 'k1', xScale: 'linear', yScale: 'linear', tableColumns: [] }
const build = (s: SelectionSpec, c: ChartConfig | null = chart, appVersion = '0.3.1') => buildProvenance({ snapshot, spec: s, chart: c, appVersion })

describe('sha256Hex', () => {
  it('matches the NIST test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1')
  })
  it('handles non-ASCII text', () => {
    expect(sha256Hex('μ')).toHaveLength(64)
  })
})

describe('analysis log', () => {
  it('is deterministic', () => {
    expect(build(spec())).toEqual(build(spec()))
  })

  it('writes visits, filters and QC in R syntax', () => {
    const p = build(
      spec({
        visitIds: ['base'],
        qc: { exclude: ['curator_exclusion'] },
        filter: { type: 'group', id: 'r', op: 'and', children: [
          { type: 'cond', id: 'a', variableKey: 'k0', test: { kind: 'range', min: 1, max: 9 }, onMissing: 'exclude' },
          { type: 'cond', id: 'b', variableKey: 'k1', test: { kind: 'in', values: ['F'] }, onMissing: 'include' }
        ] }
      })
    )
    expect(p.text).toContain('df <- subset(df, visit %in% c("Baseline"))')
    expect(p.text).toContain('(!is.na(df[["IL6"]]) & (df[["IL6"]] >= 1 & df[["IL6"]] <= 9)) & (is.na(df[["Sex"]]) | (df[["Sex"]] %in% c("F")))')
    expect(p.text).toContain('Curator exclusion')
    expect(p.text).toContain('boxplot(df[["IL6"]] ~ df[["Sex"]])')
    expect(p.text).toContain(`chain signature: ${p.signature}`)
  })

  it('never writes participant identifiers', () => {
    const p = build(spec({ participantIds: ['SECRET-123', 'SECRET-456'] }))
    expect(p.text).not.toContain('SECRET')
    expect(p.text).toContain('2 identifiers')
  })

  it('changes the signature when anything upstream changes', () => {
    const base = build(spec()).signature
    expect(build(spec({ visitIds: ['m2'] })).signature).not.toBe(base)
    expect(build(spec({ qc: { exclude: ['sample_warning'] } })).signature).not.toBe(base)
    expect(build(spec(), chart, '0.3.2').signature).not.toBe(base)
    expect(build(spec(), { ...chart, groupKey: null }).signature).not.toBe(base)
    expect(buildProvenance({ snapshot: { ...snapshot, metadataVersion: 8 }, spec: spec(), chart, appVersion: '0.3.1' }).signature).not.toBe(base)
  })

  it('chains: an early change alters every later signature', () => {
    const a = build(spec({ visitIds: ['base'] })).steps
    const b = build(spec({ visitIds: ['m2'] })).steps
    expect(a[0].signature).toBe(b[0].signature)
    expect(a.slice(1).every((s, i) => s.signature !== b[i + 1].signature)).toBe(true)
  })

  it('works without a chart', () => {
    expect(build(spec(), null).steps.map((s) => s.kind)).toEqual(['source', 'qc'])
  })
})

describe('transforms and colouring in the log', () => {
  it('records transforms before the chart step and changes the signature', () => {
    const t = build(spec(), { ...chart, transformMeasure: 'log2', colorKey: 'k1' })
    expect(t.steps.map((s) => s.kind)).toEqual(['source', 'qc', 'transform', 'chart'])
    expect(t.text).toContain('df[["IL6"]] <- ifelse(df[["IL6"]] > 0, log2(df[["IL6"]]), NA)')
    expect(t.text).toContain('points coloured by Sex')
    expect(t.signature).not.toBe(build(spec()).signature)
  })
  it('records the compare transform only for scatter charts', () => {
    const sc: ChartConfig = { ...chart, type: 'scatter', compareKey: 'k1', groupKey: null, transformCompare: 'zscore' }
    expect(build(spec(), sc).text).toContain('as.numeric(scale(df[["Sex"]]))')
    expect(build(spec(), { ...chart, transformCompare: 'zscore' }).text).not.toContain('scale(')
  })
})

describe('PCA in the log', () => {
  const pcaChart: ChartConfig = { type: 'pca', measureKey: 'k0', compareKey: null, groupKey: null, xScale: 'linear', yScale: 'linear', tableColumns: [], pcaKeys: ['k0', 'k1'], transformMeasure: 'log2' }
  it('writes a complete-case prcomp call and ignores stale transforms', () => {
    const p = build(spec(), pcaChart)
    expect(p.text).toContain('pca_data <- na.omit(df[, c("IL6", "Sex")])')
    expect(p.text).toContain('prcomp(pca_data, center = TRUE, scale. = TRUE)')
    expect(p.text).toContain('Chart: PCA of 2 variables')
    expect(p.steps.map((s) => s.kind)).not.toContain('transform')
  })
  it('the variable set changes the signature', () => {
    expect(build(spec(), pcaChart).signature).not.toBe(build(spec(), { ...pcaChart, pcaKeys: ['k0'] }).signature)
  })
})

describe('log content rules', () => {
  it('identifies the source by SHA-256, never by file name', () => {
    const p = build(spec())
    expect(p.text).not.toContain('study.xlsx')
    expect(p.text).toContain('a'.repeat(64))
  })

  it('only describes axes the chart type uses, and statistics only where they exist', () => {
    const stale = { ...chart, xScale: 'log' as const, xMin: 1, analysis: { requested: true, fitLine: true, confidenceBand: false, predictionBand: false, meanCi: false } }
    const dist = build(spec(), stale).text
    expect(dist).not.toContain('log axis: x')
    expect(dist).not.toContain('forced')
    const pca = build(spec(), { ...stale, type: 'pca', pcaKeys: ['k0', 'k1'] })
    expect(pca.steps.map((s) => s.kind)).not.toContain('statistics')
  })

  it('states the selection result and counts QC exclusions in the variables used', () => {
    const snap: DatasetSnapshot = {
      ...snapshot,
      rows: ['A', 'B', 'C'].map((p, i) => ({ index: i, rowNumber: i + 2, participantId: p, visitId: 'base' })),
      values: [[1, 2, 3].map((v) => ({ k: 'number' as const, v, raw: String(v) })), ['F', 'M', 'F'].map((raw) => ({ k: 'text' as const, raw }))],
      flags: [{ row: 1, variable: 0, kind: 'curator_exclusion', status: 'curator_confirmed', category: 'curator_exclusion', formatKey: 'x', detail: 'reason' }]
    }
    const s = spec({ qc: { exclude: ['curator_exclusion'] } })
    const sel = computeSelection(snap, s)
    const p = buildProvenance({ snapshot: snap, spec: s, chart, sel, appVersion: '0.3.1' })
    expect(p.text).toContain('# selection result: 3 row(s), 3 participant(s)')
    expect(p.text).toContain('1 observation(s) set to NA in the variables used: Curator exclusion')
    expect(p.text).not.toContain('reason')
  })
})
