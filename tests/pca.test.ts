// PCA checked against R prcomp(scale. = TRUE) (tools/multivariate_reference.R → multivariate_reference.json), plus input handling.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pca, pcaInput, symmetricEigen } from '@core/pca'
import { classifyValue } from '@core/values'
import { computeSelection } from '@core/selection'
import { emptyFilter } from '@core/types'
import type { DatasetSnapshot, VariableInfo } from '@core/types'

const R = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'multivariate_reference.json'), 'utf8'))
const close = (got: number, want: number, tol = 1e-9) => expect(Math.abs(got - want)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(want)))

describe('pca matches R prcomp', () => {
  const r = pca(R.x)
  it('centre, scale, sdev and variance explained', () => {
    r.center.forEach((v: number, i: number) => close(v, R.center[i]))
    r.scale.forEach((v: number, i: number) => close(v, R.scale[i]))
    r.sdev.forEach((v: number, i: number) => close(v, R.sdev[i]))
    r.varianceExplained.forEach((v: number, i: number) => close(v, R.variance[i]))
    expect(r.cumulative[r.k - 1]).toBeCloseTo(1, 12)
  })
  it('loadings and scores (signs fixed the same way)', () => {
    r.loadings.forEach((row, i) => row.forEach((v, j) => close(v, R.rotation[i][j], 1e-8)))
    r.scores.forEach((row, i) => row.forEach((v, j) => close(v, R.scores[i][j], 1e-8)))
  })
})

describe('pca properties', () => {
  it('scores are uncorrelated with variance sdev²', () => {
    const r = pca(R.x)
    const col = (c: number) => r.scores.map((s) => s[c])
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length
    const cov = (a: number[], b: number[]) => a.reduce((s, v, i) => s + (v - mean(a)) * (b[i] - mean(b)), 0) / (a.length - 1)
    close(cov(col(0), col(1)), 0, 1e-9)
    close(cov(col(0), col(0)), r.sdev[0] ** 2, 1e-9)
  })
  it('returns min(p, n - 1) components', () => {
    expect(pca([[1, 2, 3, 4], [2, 1, 5, 3], [4, 3, 1, 2]]).k).toBe(2)
  })
  it('rejects too little data and constant columns', () => {
    expect(() => pca([[1, 2], [2, 3]])).toThrow('at least 3')
    expect(() => pca([[1, 5], [2, 5], [3, 5]])).toThrow('no spread')
  })
  it('eigen-decomposes a known matrix', () => {
    const e = symmetricEigen([[2, 1], [1, 2]])
    close(e.values[0], 3)
    close(e.values[1], 1)
  })
})

const meta = () => ({ value: null, status: 'unknown' as const, provenance: '', revisionId: null })
const variable = (index: number): VariableInfo => ({
  index, columnIndex: index + 1, letter: 'A', key: `v${index}`, header: `v${index}`, headerRuns: null, role: 'measure', kind: 'numeric', groupSegment: null, subgroupSegment: null,
  aliases: [], attribution: null, quasiIdentifier: false, covariate: false, categories: [], counts: { number: 0, missing: 0, censored: 0, text: 0 },
  meta: { displayLabel: meta(), area: meta(), unit: meta(), specimen: meta(), assay: meta(), scoreType: meta(), definition: meta(), source: meta() }
})

describe('pcaInput', () => {
  const snap: DatasetSnapshot = {
    datasetVersionId: 'v', versionNumber: 1, sourceFileName: 's', sourceSha256: 'x', sheetName: 's', importedAt: '', sourceKind: 'xlsx', metadataVersion: 0,
    visits: [{ id: 'b', name: 'Baseline', order: 1, actualDate: null }],
    rows: ['A', 'B', 'C', 'D', 'E'].map((p, i) => ({ index: i, rowNumber: i + 2, participantId: p, visitId: 'b' })),
    variables: [variable(0), variable(1)],
    values: [[1, 2, null, 4, '<1'].map(classifyValue), [5, 6, 7, 'x', 9].map(classifyValue)],
    flags: [], annotations: []
  }
  const sel = computeSelection(snap, { datasetVersionId: 'v', visitIds: 'all', filter: emptyFilter(), qc: { exclude: [] }, participantIds: null })
  it('keeps complete numeric rows only and reports what blocked the rest', () => {
    const inp = pcaInput(sel, snap.variables)
    expect(inp.rows).toEqual([0, 1])
    expect(inp.matrix).toEqual([[1, 5], [2, 6]])
    expect(inp.dropped).toBe(3)
    expect(inp.blockers).toEqual([{ key: 'v0', count: 2 }, { key: 'v1', count: 1 }])
  })
})

describe('gapSuggestion', () => {
  // 10 rows; v0 and v1 complete, v2 missing in 5 rows -> complete-case keeps 5 rows
  const vals = (f: (i: number) => number | null) => Array.from({ length: 10 }, (_, i) => classifyValue(f(i)))
  const snap: DatasetSnapshot = {
    datasetVersionId: 'v', versionNumber: 1, sourceFileName: 's', sourceSha256: 'x', sheetName: 's', importedAt: '', sourceKind: 'xlsx', metadataVersion: 0,
    visits: [{ id: 'b', name: 'Baseline', order: 1, actualDate: null }],
    rows: Array.from({ length: 10 }, (_, i) => ({ index: i, rowNumber: i + 2, participantId: `P${i}`, visitId: 'b' })),
    variables: [variable(0), variable(1), variable(2)],
    values: [vals((i) => i), vals((i) => (i * 7) % 10), vals((i) => (i < 5 ? i * 2 : null))],
    flags: [], annotations: []
  }
  const sel = computeSelection(snap, { datasetVersionId: 'v', visitIds: 'all', filter: emptyFilter(), qc: { exclude: [] }, participantIds: null })
  it('offers to drop the gappy variable and reports the rows regained', async () => {
    const { gapSuggestion } = await import('@core/pca')
    const s = gapSuggestion(sel, snap.variables, pcaInput(sel, snap.variables))!
    expect(s.keep.map((v) => v.key)).toEqual(['v0', 'v1'])
    expect(s.removed).toBe(1)
    expect(s.rows).toBe(10)
  })
  it('says nothing when no rows are lost or too few variables would remain', async () => {
    const { gapSuggestion } = await import('@core/pca')
    expect(gapSuggestion(sel, snap.variables.slice(0, 2), pcaInput(sel, snap.variables.slice(0, 2)))).toBeNull()
    expect(gapSuggestion(sel, [snap.variables[0], snap.variables[2]], pcaInput(sel, [snap.variables[0], snap.variables[2]]))).toBeNull()
  })
})
