// Hand-computed values; R equivalents noted (log2, scale(), rank(ties.method = "average")).
import { describe, expect, it } from 'vitest'
import { buildTransform, transformedVariable, transformR } from '@core/transforms'
import { distributionData, scatterData, numericColumn } from '@core/chartData'
import { classifyValue } from '@core/values'
import { computeSelection } from '@core/selection'
import { emptyFilter } from '@core/types'
import type { DatasetSnapshot, VariableInfo } from '@core/types'

const col = [2, 4, 4, 8, 16]
describe('buildTransform', () => {
  it('log transforms drop non-positive values', () => {
    expect(buildTransform('log2', col)(8)).toBeCloseTo(3, 12)
    expect(buildTransform('log10', col)(100)).toBeCloseTo(2, 12)
    expect(buildTransform('log2', col)(0)).toBeNull()
    expect(buildTransform('log10', col)(-1)).toBeNull()
  })
  it('centres on the mean and z-scores with the sample SD (R scale())', () => {
    // mean 6.8, sample SD sqrt(((−4.8)²+(−2.8)²×2+1.2²+9.2²)/4) = sqrt(132.8/4)... computed below
    const m = 6.8
    const sd = Math.sqrt((4.8 ** 2 + 2.8 ** 2 * 2 + 1.2 ** 2 + 9.2 ** 2) / 4)
    expect(buildTransform('center', col)(2)).toBeCloseTo(2 - m, 12)
    expect(buildTransform('zscore', col)(16)).toBeCloseTo((16 - m) / sd, 12)
  })
  it('z-score is undefined with zero spread or one value', () => {
    expect(buildTransform('zscore', [3, 3, 3])(3)).toBeNull()
    expect(buildTransform('zscore', [3])(3)).toBeNull()
  })
  it('ranks ties by their average (R rank)', () => {
    const r = buildTransform('rank', col)
    expect([2, 4, 8, 16].map(r)).toEqual([1, 2.5, 4, 5])
    expect(r(5)).toBeNull()
  })
  it('writes matching R', () => {
    expect(transformR('rank', 'x')).toBe('rank(x, na.last = "keep", ties.method = "average")')
  })
})

const meta = () => ({ value: null, status: 'unknown' as const, provenance: '', revisionId: null })
const variable = (index: number, key: string, kind: VariableInfo['kind']): VariableInfo => ({
  index, columnIndex: index + 1, letter: 'A', key, header: key, headerRuns: null, role: 'measure', kind, groupSegment: null, subgroupSegment: null,
  aliases: [], attribution: null, quasiIdentifier: false, covariate: index === 2, categories: [], counts: { number: 0, missing: 0, censored: 0, text: 0 },
  meta: { displayLabel: meta(), area: meta(), unit: meta(), specimen: meta(), assay: meta(), scoreType: meta(), definition: meta(), source: meta() }
})
// y: 1, 2, 0, 8 ; x: 10, 20, 30, 40 ; sex: F, M, F, (missing)
const snap: DatasetSnapshot = {
  datasetVersionId: 'v', versionNumber: 1, sourceFileName: 's', sourceSha256: 'x', sheetName: 's', importedAt: '', sourceKind: 'xlsx', metadataVersion: 0,
  visits: [{ id: 'b', name: 'Baseline', order: 1, actualDate: null }],
  rows: ['P1', 'P2', 'P3', 'P4'].map((p, i) => ({ index: i, rowNumber: i + 2, participantId: p, visitId: 'b' })),
  variables: [variable(0, 'y', 'numeric'), variable(1, 'x', 'numeric'), variable(2, 'sex', 'categorical')],
  values: [[1, 2, 0, 8].map(classifyValue), [10, 20, 30, 40].map(classifyValue), ['F', 'M', 'F', null].map(classifyValue)], flags: [], annotations: []
}
const sel = computeSelection(snap, { datasetVersionId: 'v', visitIds: 'all', filter: emptyFilter(), qc: { exclude: [] }, participantIds: null })

describe('chart data with transforms and colouring', () => {
  it('log2 drops the zero, counts it and keeps the rest', () => {
    const d = distributionData(sel, 0, null, 'linear', { transform: 'log2' })
    expect(d.transformDropped).toBe(1)
    expect(d.groups[0].points.map((p) => p.value)).toEqual([0, 1, 3])
    expect(d.groups[0].summary.n).toBe(3)
  })
  it('colours by category and keeps missing as its own', () => {
    const d = distributionData(sel, 0, null, 'linear', { colorVar: 2 })
    expect(d.categories).toEqual(['F', 'M', '(missing group value)'])
    expect(d.groups[0].points.map((p) => p.cat)).toEqual(['F', 'M', 'F', '(missing group value)'])
  })
  it('scatter transforms both axes and drops pairs it cannot define', () => {
    const d = scatterData(sel, 1, 0, 'linear', 'linear', { transformY: 'log2', colorVar: 2 })
    expect(d.transformDropped).toBe(1)
    expect(d.points.map((p) => [p.x, p.y])).toEqual([[10, 0], [20, 1], [40, 3]])
    expect(d.categories).toEqual(['F', 'M', '(missing group value)'])
  })
  it('transform uses all usable values of the selection', () => {
    expect(numericColumn(sel, 0)).toEqual([1, 2, 0, 8])
    const z = distributionData(sel, 0, null, 'linear', { transform: 'zscore' })
    const v = z.groups[0].points.map((p) => p.value)
    expect(v.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 12)
  })
  it('relabels the variable for display only', () => {
    const t = transformedVariable(snap.variables[0], 'log2')
    expect(t.meta.displayLabel.value).toBe('log2(y)')
    expect(snap.variables[0].meta.displayLabel.value).toBeNull()
  })
})
