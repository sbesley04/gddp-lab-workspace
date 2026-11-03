// Correlation matrix checked against R cor(use = "pairwise.complete.obs") (tools/multivariate_reference.R);
// heatmap layout on a hand-built selection.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { correlationMatrix, heatmapData } from '@core/matrix'
import { classifyValue } from '@core/values'
import { computeSelection } from '@core/selection'
import { emptyFilter } from '@core/types'
import type { CellFlag, DatasetSnapshot, VariableInfo } from '@core/types'

const R = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'multivariate_reference.json'), 'utf8'))
const keys = ['a', 'b', 'c', 'd']

describe('correlation matrix matches R', () => {
  it.each(['pearson', 'spearman'] as const)('%s, pairwise complete with ties', (method) => {
    const m = correlationMatrix(R.m, keys, method)
    const ref = method === 'pearson' ? R.cor_pearson : R.cor_spearman
    m.r.forEach((row, i) => row.forEach((v, j) => expect(Math.abs(v! - ref[i][j])).toBeLessThan(1e-10)))
    expect(m.n).toEqual(R.npair)
  })
  it('leaves pairs with fewer than 3 observations or no spread undefined', () => {
    const m = correlationMatrix([[1, 5], [2, 5], [null, 7], [3, null]], ['x', 'y'], 'pearson')
    expect(m.n[0][1]).toBe(2)
    expect(m.r[0][1]).toBeNull()
    expect(correlationMatrix([[1, 4], [2, 4], [3, 4]], ['x', 'y'], 'spearman').r[1][1]).toBeNull()
  })
})

const meta = () => ({ value: null, status: 'unknown' as const, provenance: '', revisionId: null })
const variable = (index: number, key: string, kind: VariableInfo['kind']): VariableInfo => ({
  index, columnIndex: index + 1, letter: 'A', key, header: key, headerRuns: null, role: 'measure', kind, groupSegment: null, subgroupSegment: null,
  aliases: [], attribution: null, quasiIdentifier: false, covariate: false, categories: [], counts: { number: 0, missing: 0, censored: 0, text: 0 },
  meta: { displayLabel: meta(), area: meta(), unit: meta(), specimen: meta(), assay: meta(), scoreType: meta(), definition: meta(), source: meta() }
})

describe('heatmapData', () => {
  // x: 1, 2, 3, <1 ; y: 10, 10, 10, 10 (no spread) ; group: b, a, (missing), a
  const snap: DatasetSnapshot = {
    datasetVersionId: 'v', versionNumber: 1, sourceFileName: 's', sourceSha256: 'x', sheetName: 's', importedAt: '', sourceKind: 'xlsx', metadataVersion: 0,
    visits: [{ id: 'b', name: 'Baseline', order: 1, actualDate: null }],
    rows: ['P10', 'P2', 'P1', 'P3'].map((p, i) => ({ index: i, rowNumber: i + 2, participantId: p, visitId: 'b' })),
    variables: [variable(0, 'x', 'mixed'), variable(1, 'y', 'numeric'), variable(2, 'g', 'categorical')],
    values: [[1, 2, 3, '<1'].map(classifyValue), [10, 10, 10, 10].map(classifyValue), ['b', 'a', null, 'a'].map(classifyValue)],
    flags: [{ row: 1, variable: 0, kind: 'qc_sample', status: 'legend_exact', category: 'sample_warning', formatKey: 'f', detail: '' }] as CellFlag[],
    annotations: []
  }
  const sel = computeSelection(snap, { datasetVersionId: 'v', visitIds: 'all', filter: emptyFilter(), qc: { exclude: [] }, participantIds: null })

  it('z-scores each variable over its usable values and blanks the rest', () => {
    const h = heatmapData(sel, snap.variables.slice(0, 2), null)
    expect(h.participantIds).toEqual(['P1', 'P2', 'P3', 'P10'])
    expect(h.z.map((r) => r[0])).toEqual([1, 0, null, -1]) // mean 2, SD 1
    expect(h.undefinedKeys).toEqual(['y'])
    expect(h.missingCells).toBe(1)
    expect(h.flagged[1][0]).toBe(true)
  })
  it('orders rows by covariate category, missing last', () => {
    const h = heatmapData(sel, snap.variables.slice(0, 1), 2)
    expect(h.cats).toEqual(['a', 'a', 'b', '(missing group value)'])
    expect(h.participantIds).toEqual(['P2', 'P3', 'P10', 'P1'])
  })
})
