// Board dashboard helpers on a hand-built synthetic snapshot: the shared cohort and stat-card counts.
import { describe, expect, it } from 'vitest'
import { classifyValue } from '@core/values'
import type { CellFlag, DatasetSnapshot } from '@core/types'
import { cohortSelection, cohortStats, defaultCohort, percentText, resolveCohort } from '@core/dashboard'
import { computeSelection } from '@core/selection'
import { variable } from './synthetic'

// Rows: 9001..9005 at Baseline, 9001 and 9002 again at Month 6.
// score: 1, missing, "<0.5", 4, "QNS", 6, missing.   grp: a, b, a, b, a, b, a
const snapshot: DatasetSnapshot = {
  datasetVersionId: 'dv1', versionNumber: 1, sourceFileName: 'synthetic', sourceSha256: 'x', sheetName: 's', importedAt: '', sourceKind: 'xlsx', metadataVersion: 3,
  visits: [{ id: 'b', name: 'Baseline', order: 1, actualDate: null }, { id: 'm6', name: 'Month 6', order: 2, actualDate: null }],
  rows: ['9001', '9002', '9003', '9004', '9005', '9001', '9002'].map((p, i) => ({ index: i, rowNumber: i + 2, participantId: p, visitId: i < 5 ? 'b' : 'm6' })),
  variables: [variable(0, 'score', 'mixed'), variable(1, 'grp', 'categorical', ['a', 'b'])],
  values: [
    [1, null, '<0.5', 4, 'QNS', 6, null].map(classifyValue),
    ['a', 'b', 'a', 'b', 'a', 'b', 'a'].map(classifyValue)
  ],
  flags: [
    { row: 0, variable: 0, kind: 'qc_sample', status: 'legend_exact', category: 'sample_warning', formatKey: 'f', detail: '' },
    { row: 3, variable: 0, kind: 'curator', status: 'curator_confirmed', category: 'curator_exclusion', formatKey: 'g', detail: '' },
    { row: 5, variable: 0, kind: 'qc_target', status: 'curator_rejected', category: 'target_warning', formatKey: 'h', detail: '' }
  ] as CellFlag[],
  annotations: []
}

describe('board cohort', () => {
  it('defaults to all rows with the default QC policy', () => {
    const r = resolveCohort(snapshot, null)
    expect(r.spec.visitIds).toBe('all')
    expect(r.spec.qc.exclude).toEqual(['curator_exclusion'])
    expect(r.spec.datasetVersionId).toBe('dv1')
    expect(computeSelection(snapshot, r.spec).rows).toHaveLength(7)
  })

  it('resolves visits by name and reports names the dataset lacks', () => {
    const r = resolveCohort(snapshot, { ...defaultCohort(), visitNames: ['Month 6', 'Week 99'] })
    expect(r.spec.visitIds).toEqual(['m6'])
    expect(r.unknownVisits).toEqual(['Week 99'])
    expect(cohortSelection(snapshot, { ...defaultCohort(), visitNames: ['Month 6'] }).participantIds).toEqual(['9001', '9002'])
  })

  it('applies the filter through the selection engine and reports unknown filter variables', () => {
    const filter = { type: 'group' as const, id: 'root', op: 'and' as const, children: [
      { type: 'cond' as const, id: 'c1', variableKey: 'grp', test: { kind: 'in' as const, values: ['a'] }, onMissing: 'exclude' as const },
      { type: 'cond' as const, id: 'c2', variableKey: 'gone', test: { kind: 'present' as const }, onMissing: 'exclude' as const }
    ] }
    const r = resolveCohort(snapshot, { ...defaultCohort(), filter })
    expect(r.unknownVariables).toEqual(['gone'])
    const sel = cohortSelection(snapshot, { ...defaultCohort(), filter: { ...filter, children: [filter.children[0]] } })
    expect(sel.rows).toEqual([0, 2, 4, 6])
  })
})

describe('stat card counts', () => {
  it('counts missing, censored and QC separately and never treats missing as zero', () => {
    const sel = cohortSelection(snapshot, null)
    const s = cohortStats(sel, [snapshot.variables[0]])
    expect(s.rows).toBe(7)
    expect(s.participants).toBe(5)
    const m = s.measures[0]
    // Row 3 (value 4) is a curator exclusion: removed by the default policy, not counted as usable.
    expect(m.qcExcluded).toBe(1)
    expect(m.missing).toBe(2)
    expect(m.missingFraction).toBeCloseTo(2 / 7, 12)
    // Usable: 1 (flagged, kept), "<0.5", "QNS", 6. The curator-rejected flag on row 5 does not count.
    expect(m.usable).toBe(4)
    expect(m.numeric).toBe(2)
    expect(m.censored).toBe(1)
    expect(m.text).toBe(1)
    expect(m.censoredFraction).toBeCloseTo(1 / 3, 12)
    expect(m.censoringBiased).toBe(true)
    expect(m.flaggedIncluded).toBe(1)
  })

  it('follows the QC policy of the cohort', () => {
    const sel = cohortSelection(snapshot, { ...defaultCohort(), qcExclude: ['curator_exclusion', 'sample_warning'] })
    const m = cohortStats(sel, [snapshot.variables[0]]).measures[0]
    expect(m.qcExcluded).toBe(2)
    expect(m.flaggedIncluded).toBe(0)
    expect(m.usable).toBe(3)
  })

  it('gives null fractions for an empty selection', () => {
    const filter = { type: 'group' as const, id: 'root', op: 'and' as const, children: [{ type: 'cond' as const, id: 'c', variableKey: 'grp', test: { kind: 'in' as const, values: ['z'] }, onMissing: 'exclude' as const }] }
    const m = cohortStats(cohortSelection(snapshot, { ...defaultCohort(), filter }), [snapshot.variables[0]]).measures[0]
    expect(m.rows).toBe(0)
    expect(m.missingFraction).toBeNull()
    expect(m.censoredFraction).toBeNull()
  })

  it('formats percentages without rounding a non-zero share to 0% or 100%', () => {
    expect(percentText(null)).toBe('—')
    expect(percentText(0)).toBe('0%')
    expect(percentText(0.004)).toBe('<1%')
    expect(percentText(0.996)).toBe('>99%')
    expect(percentText(1)).toBe('100%')
    expect(percentText(2 / 7)).toBe('29%')
  })
})

