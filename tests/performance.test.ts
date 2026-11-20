// Performance budget on a large synthetic dataset (docs/STRATEGY.md, E3). All computation runs in the window's own
// thread, so anything slow here freezes the interface. Each budget is about ten times what an Apple Silicon laptop
// needed on 2026-11-19 (with a floor of 250 ms for slower CI machines): enough to catch a change that makes something
// ten times slower, not to measure speed precisely. The measured times are printed.
import { beforeAll, describe, expect, it } from 'vitest'
import { buildFlagIndex, computeSelection, countsFor } from '@core/selection'
import { distributionData, scatterData } from '@core/chartData'
import { analyseDistribution, analyseScatter, buildAnalysisRecord } from '@core/analysisRun'
import { correlationFromSelection, heatmapData } from '@core/matrix'
import { pcaPlot } from '@core/pca'
import { buildProvenance } from '@core/provenance'
import type { ChartConfig, DatasetSnapshot, SelectionSpec } from '@core/types'
import { syntheticSnapshot } from './synthetic'

// 2,000 participants at up to 3 visits, 300 measures: about 4,800 rows and 1.4 million cells, with 40,000 QC flags.
// Far larger than the reference workbook; a size a multi-site study could reach.
const SIZE = { participants: 2000, visits: 3, numeric: 290, categorical: 10, attendance: 0.7, gaps: 0.12, flags: 0.03 }

let snap: DatasetSnapshot
const timings: Record<string, number> = {}
function timed<T>(name: string, budgetMs: number, fn: () => T): T {
  const t0 = performance.now()
  const out = fn()
  const ms = performance.now() - t0
  timings[name] = Math.round(ms)
  expect(ms, `${name} took ${Math.round(ms)} ms; budget ${budgetMs} ms`).toBeLessThan(budgetMs)
  return out
}
const spec = (extra: Partial<SelectionSpec> = {}): SelectionSpec => ({
  datasetVersionId: 'syn', visitIds: ['v0'], participantIds: null, qc: { exclude: ['curator_exclusion', 'sample_warning'] },
  filter: { type: 'group', id: 'g', op: 'and', children: [
    { type: 'cond', id: 'a', variableKey: 'n0', test: { kind: 'range', min: -5, max: 30 }, onMissing: 'include' },
    { type: 'group', id: 'h', op: 'or', children: [
      { type: 'cond', id: 'b', variableKey: 'c0', test: { kind: 'in', values: ['a', 'b', 'c'] }, onMissing: 'exclude' },
      { type: 'cond', id: 'c', variableKey: 'n1', test: { kind: 'present' }, onMissing: 'exclude' }
    ] }
  ] },
  ...extra
})

beforeAll(() => {
  snap = syntheticSnapshot(20261119, SIZE)
}, 120_000)

describe('performance budget on a large synthetic dataset', () => {
  it('is the size it claims to be', () => {
    expect(snap.rows.length).toBeGreaterThan(4500)
    expect(snap.variables.length).toBe(300)
    expect(snap.flags.length).toBeGreaterThan(30000)
  })

  it('selection, charts, statistics and the many-measures views stay within budget', () => {
    const flagIndex = timed('flag index', 250, () => buildFlagIndex(snap))
    const sel = timed('selection with a nested filter', 250, () => computeSelection(snap, spec(), flagIndex))
    expect(sel.rows.length).toBeGreaterThan(1000)
    expect(sel.rows.length).toBeLessThan(snap.rows.length)
    const all = timed('selection of every row', 250, () => computeSelection(snap, spec({ visitIds: 'all', filter: { type: 'group', id: 'g', op: 'and', children: [] } }), flagIndex))
    expect(all.rows.length).toBe(snap.rows.length)

    const nVar = (i: number) => snap.variables[i].index
    const group = snap.variables.find((v) => v.key === 'c1')!.index
    timed('counts for 300 variables', 2500, () => snap.variables.forEach((v) => countsFor(all, v.index)))
    const dist = timed('grouped distribution', 800, () => distributionData(sel, nVar(2), group, 'linear', { transform: 'boxcox' }))
    const scat = timed('scatter', 250, () => scatterData(sel, nVar(3), nVar(4), 'linear', 'linear'))
    const da = timed('distribution statistics (4 groups, pairwise tests)', 800, () => analyseDistribution(dist))
    expect(da.blocked).toBe(false)
    expect(da.many!.pairs.length).toBe(6)
    const sa = timed('scatter statistics', 250, () => analyseScatter(scat, { xScale: 'linear', yScale: 'linear' }))
    expect(sa.kendall).not.toBeNull()

    const chart: ChartConfig = { type: 'distribution', measureKey: 'n2', compareKey: null, groupKey: 'c1', xScale: 'linear', yScale: 'linear', tableColumns: [] }
    timed('analysis register record', 1500, () => buildAnalysisRecord({ snapshot: snap, spec: spec(), chart, sel }))
    timed('analysis log', 250, () => buildProvenance({ snapshot: snap, spec: spec(), chart, sel, appVersion: 'test' }))

    const many = snap.variables.slice(0, 60)
    const corr = timed('correlation matrix of 60 variables', 8000, () => correlationFromSelection(sel, many, 'spearman'))
    expect(corr.r.length).toBe(60)
    timed('heatmap of 60 variables', 400, () => heatmapData(sel, many, group))
    // Complete cases: few variables, so that enough rows have a value in every one.
    const pca = timed('PCA of 12 variables', 250, () => pcaPlot(sel, snap.variables.slice(0, 12), null))
    expect(pca.result?.n ?? 0).toBeGreaterThan(100)
    // Printed so a slow machine's numbers can be compared with the budgets.
    console.log('performance timings (ms):', JSON.stringify(timings))
  }, 120_000)
})

describe('importing and loading a large synthetic file', () => {
  it('imports 4,800 rows by 300 columns, rebuilds the snapshot and verifies its records within budget', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { Project } = await import('../src/main/project')
    const { commitImport, parseSource, previewMapping, validate } = await import('../src/main/importService')
    const { buildSnapshot } = await import('../src/main/snapshot')
    const { verifyIntegrity } = await import('../src/main/integrity')
    // The same synthetic data, written as the CSV a researcher would import.
    const header = ['Subject_ID', 'Event Name', ...snap.variables.map((v) => v.key)]
    const cell = (row: number, variable: number) => {
      const v = snap.values[variable][row]
      return v.k === 'missing' ? '' : v.k === 'number' ? String(v.v) : v.raw
    }
    const lines = [header.join(',')]
    for (const r of snap.rows) lines.push([r.participantId, snap.visits.find((v) => v.id === r.visitId)!.name, ...snap.variables.map((v) => cell(r.index, v.index))].join(','))
    const bytes = new TextEncoder().encode(lines.join('\n') + '\n')
    const dir = mkdtempSync(join(tmpdir(), 'bari-perf-'))
    const io: Record<string, number> = {}
    const step = async <T>(name: string, budgetMs: number, fn: () => T): Promise<T> => {
      const t0 = performance.now()
      const out = fn()
      io[name] = Math.round(performance.now() - t0)
      expect(io[name], `${name} took ${io[name]} ms; budget ${budgetMs} ms`).toBeLessThan(budgetMs)
      return out
    }
    const p = Project.create(dir, 'Large synthetic')
    try {
      const src = await step('parse CSV', 3_000, () => parseSource(bytes, 'large_synthetic.csv'))
      const sheet = src.wb.sheets[0].name
      const mp = previewMapping(p, src, sheet)
      const model = await step('validate', 10_000, () => validate(src, { sheetName: sheet, headerRow: 1, participantColumn: mp.suggestion.participantColumn!, eventColumn: mp.suggestion.eventColumn }))
      const { datasetVersionId } = await step('commit import (one transaction)', 75_000, () => commitImport(p, src, model, { authorLabel: 'Perf', carryOverFrom: null }))
      const loaded = await step('build snapshot from the database', 30_000, () => buildSnapshot(p, datasetVersionId))
      expect(loaded.rows.length).toBe(snap.rows.length)
      expect(loaded.variables.filter((v) => v.role === 'measure').length).toBe(300)
      // What happens after every curation edit: the snapshot is rebuilt. The imported cells cannot have changed,
      // so only the curation is read again.
      const { editVariableMeta } = await import('../src/main/curation')
      editVariableMeta(p, { datasetVersionId, varKey: loaded.variables[5].key, field: 'unit', value: 'pg/mL', status: 'tentative', author: 'Perf', reason: null })
      const reloaded = await step('rebuild the snapshot after a curation edit', 500, () => buildSnapshot(p, datasetVersionId))
      expect(reloaded.variables[5].meta.unit.value).toBe('pg/mL')
      expect(reloaded.metadataVersion).toBe(loaded.metadataVersion + 1)
      expect(reloaded.values).toBe(loaded.values) // the same imported cells, not a second copy
      const json = await step('serialise the snapshot as it crosses to the window', 3_000, () => JSON.stringify(loaded))
      io['snapshot size (MB)'] = Math.round(json.length / 1e6)
      const report = await step('verify the record chain', 1_000, () => verifyIntegrity(p.db))
      expect(report.ok).toBe(true)
      console.log('import and load timings (ms):', JSON.stringify(io))
    } finally {
      p.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }, 300_000)
})
