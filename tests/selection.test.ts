// Selection engine on a hand-built snapshot, so every expected row set is worked out by hand.
import { describe, expect, it } from 'vitest'
import { computeSelection, countsFor, pairedObservations } from '@core/selection'
import { classifyValue } from '@core/values'
import type { CellFlag, DatasetSnapshot, FilterCondition, FilterGroup, VariableInfo } from '@core/types'

const meta = () => ({ value: null, status: 'unknown' as const, provenance: '', revisionId: null })
const variable = (index: number, key: string, kind: VariableInfo['kind'], categories: string[] = []): VariableInfo => ({
  index, columnIndex: index + 1, letter: String.fromCharCode(65 + index), key, header: key, headerRuns: null, role: 'measure', kind,
  groupSegment: null, subgroupSegment: null, aliases: [], attribution: null, quasiIdentifier: false, categories,
  counts: { number: 0, missing: 0, censored: 0, text: 0 },
  meta: { displayLabel: meta(), area: meta(), unit: meta(), specimen: meta(), assay: meta(), scoreType: meta(), definition: meta(), source: meta() }
})

// Rows: P1..P6. score: 0, 5, missing, 12, "<1", 7.  group: a, b, a, missing, b, c.  marker: 1, 2, 3, 4, 5, 6
const snapshot: DatasetSnapshot = {
  datasetVersionId: 'v', versionNumber: 1, sourceFileName: 'synthetic', sourceSha256: 'x', sheetName: 's', importedAt: '', sourceKind: 'xlsx', metadataVersion: 0,
  visits: [{ id: 'base', name: 'Baseline', order: 1, actualDate: null }, { id: 'w4', name: 'Week 4', order: 2, actualDate: null }],
  rows: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].map((p, i) => ({ index: i, rowNumber: i + 2, participantId: p, visitId: i === 5 ? 'w4' : 'base' })),
  variables: [variable(0, 'score', 'mixed'), variable(1, 'group', 'categorical', ['a', 'b', 'c']), variable(2, 'marker', 'numeric')],
  values: [
    [0, 5, null, 12, '<1', 7].map(classifyValue),
    ['a', 'b', 'a', null, 'b', 'c'].map(classifyValue),
    [1, 2, 3, 4, 5, 6].map(classifyValue)
  ],
  flags: [
    { row: 1, variable: 2, kind: 'qc_sample', status: 'legend_exact', category: 'sample_warning', formatKey: 'f', detail: '' },
    { row: 3, variable: 2, kind: 'unresolved_highlight', status: 'unresolved', category: 'unresolved_highlight', formatKey: 'g', detail: '' },
    { row: 0, variable: 2, kind: 'qc_target', status: 'curator_rejected', category: null, formatKey: 'h', detail: '' }
  ] as CellFlag[],
  annotations: []
}

const cond = (variableKey: string, test: FilterCondition['test'], onMissing: 'exclude' | 'include' = 'exclude'): FilterCondition => ({ type: 'cond', id: Math.random().toString(36), variableKey, test, onMissing })
const group = (op: 'and' | 'or', ...children: FilterGroup['children']): FilterGroup => ({ type: 'group', id: Math.random().toString(36), op, children })
const ids = (filter: FilterGroup, extra: Partial<Parameters<typeof computeSelection>[1]> = {}) =>
  computeSelection(snapshot, { datasetVersionId: 'v', visitIds: 'all', participantIds: null, qc: { exclude: [] }, filter, ...extra }).rows.map((r) => snapshot.rows[r].participantId)

describe('filters', () => {
  it('numeric range keeps zero, drops missing and unevaluable by default', () => {
    expect(ids(group('and', cond('score', { kind: 'range', min: 0, max: 6 })))).toEqual(['P1', 'P2'])
  })
  it('onMissing=include keeps missing and censored rows explicitly', () => {
    expect(ids(group('and', cond('score', { kind: 'range', min: 0, max: 6 }, 'include')))).toEqual(['P1', 'P2', 'P3', 'P5'])
  })
  it('categorical sets and missing/present tests', () => {
    expect(ids(group('and', cond('group', { kind: 'in', values: ['a', 'c'] })))).toEqual(['P1', 'P3', 'P6'])
    expect(ids(group('and', cond('group', { kind: 'missing' })))).toEqual(['P4'])
    expect(ids(group('and', cond('score', { kind: 'present' })))).toEqual(['P1', 'P2', 'P4', 'P5', 'P6'])
  })
  it('AND / OR and nested groups', () => {
    const a = cond('group', { kind: 'in', values: ['b'] })
    const b = cond('score', { kind: 'range', min: 6, max: null })
    expect(ids(group('and', a, b))).toEqual([])
    expect(ids(group('or', a, b))).toEqual(['P2', 'P4', 'P5', 'P6'])
    expect(ids(group('and', cond('marker', { kind: 'range', min: 2, max: null }), group('or', a, b)))).toEqual(['P2', 'P4', 'P5', 'P6'])
  })
  it('ignores empty groups so an empty OR branch cannot select everything', () => {
    expect(ids(group('or', cond('group', { kind: 'in', values: ['c'] }), group('and')))).toEqual(['P6'])
  })
  it('returns no rows (not an error) when nothing matches', () => {
    expect(ids(group('and', cond('marker', { kind: 'range', min: 100, max: null })))).toEqual([])
  })
  it('restricts by visit and participant list', () => {
    expect(ids(group('and'), { visitIds: ['w4'] })).toEqual(['P6'])
    expect(ids(group('and'), { participantIds: ['P2', 'P3'] })).toEqual(['P2', 'P3'])
  })
})

describe('QC policy', () => {
  it('includes flagged observations by default and excludes only the flagged cell when asked', () => {
    const all = computeSelection(snapshot, { datasetVersionId: 'v', visitIds: 'all', participantIds: null, qc: { exclude: [] }, filter: group('and') })
    expect(countsFor(all, 2)).toMatchObject({ included: 6, flaggedIncluded: 2, qcExcluded: 0 })
    const ex = computeSelection(snapshot, { datasetVersionId: 'v', visitIds: 'all', participantIds: null, qc: { exclude: ['sample_warning'] }, filter: group('and') })
    expect(ex.rows).toHaveLength(6) // participants are not dropped
    expect(countsFor(ex, 2)).toMatchObject({ included: 5, qcExcluded: 1 })
  })
  it('never excludes unresolved formatting unless explicitly chosen, and ignores rejected interpretations', () => {
    const ex = computeSelection(snapshot, { datasetVersionId: 'v', visitIds: 'all', participantIds: null, qc: { exclude: ['unresolved_highlight'] }, filter: group('and') })
    expect(countsFor(ex, 2).qcExcluded).toBe(1)
    const any = computeSelection(snapshot, { datasetVersionId: 'v', visitIds: 'all', participantIds: null, qc: { exclude: ['target_warning'] }, filter: group('and') })
    expect(countsFor(any, 2).qcExcluded).toBe(0) // the target flag on P1 was rejected by a curator
  })
  it('treats QC-excluded values as unavailable in filters', () => {
    expect(ids(group('and', cond('marker', { kind: 'range', min: 2, max: 2 })), { qc: { exclude: ['sample_warning'] } })).toEqual([])
  })
})

describe('paired observations', () => {
  it('counts missing and unevaluable pairs by reason', () => {
    const sel = computeSelection(snapshot, { datasetVersionId: 'v', visitIds: 'all', participantIds: null, qc: { exclude: [] }, filter: group('and') })
    const p = pairedObservations(sel, 2, 0)
    expect(p.pairs.map((x) => x.row)).toEqual([0, 1, 3, 5])
    expect(p.missingY).toBe(1)
    expect(p.unevaluable).toBe(1)
  })
})
