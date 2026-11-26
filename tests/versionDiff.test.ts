// Comparing two dataset versions: hand-built snapshots with every kind of difference, then the two synthetic demo
// workbooks imported through the real services.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { diffVersions } from '@core/versionDiff'
import { classifyValue } from '@core/values'
import type { CellFlag, DatasetSnapshot } from '@core/types'
import { Project } from '../src/main/project'
import { commitImport, parseSource, previewMapping, validate } from '../src/main/importService'
import { buildSnapshot } from '../src/main/snapshot'
import { variable } from './synthetic'

type Row = [participant: string, visit: string, ...values: (string | number | null)[]]
function snap(versionNumber: number, headers: string[], rows: Row[], flags: Partial<CellFlag>[] = [], visitOrder?: string[]): DatasetSnapshot {
  // Visit ids differ between versions on purpose: only the names are shared.
  const names = visitOrder ?? [...new Set(rows.map((r) => r[1]))]
  const visits = names.map((name, i) => ({ id: `ver${versionNumber}-visit${i}`, name, order: i + 1, actualDate: null }))
  return {
    datasetVersionId: `ver${versionNumber}`, versionNumber, sourceFileName: 'synthetic', sourceSha256: `sha-${versionNumber}`, sheetName: 's', importedAt: '', sourceKind: 'csv', metadataVersion: 0,
    visits,
    rows: rows.map((r, i) => ({ index: i, rowNumber: i + 2, participantId: r[0], visitId: visits.find((v) => v.name === r[1])!.id })),
    variables: headers.map((h, i) => variable(i, h, 'numeric')),
    values: headers.map((_, c) => rows.map((r) => classifyValue(r[c + 2]))),
    flags: flags.map((f) => ({ kind: 'qc_sample', status: 'legend_exact', category: 'sample_warning', formatKey: 'f', detail: '', ...f }) as CellFlag),
    annotations: []
  }
}

describe('diffVersions', () => {
  const v1 = snap(1, ['A', 'B', 'Old'], [
    ['DEMO-01', 'Baseline', 1, 10, 5],
    ['DEMO-02', 'Baseline', 2, null, 5],
    ['DEMO-03', 'Baseline', 0, '<0.5', 5],
    ['DEMO-04', 'Baseline', 4, 40, 5],
    ['DEMO-01', 'Month 6', 7, 70, 5]
  ], [{ row: 0, variable: 0 }, { row: 3, variable: 1 }])
  const v2 = snap(2, ['B', 'A', 'New'], [
    // Columns reordered and rows reordered: matching is by header and by participant and visit, not by position.
    ['DEMO-01', 'Month 6', 70, 7, 1],
    ['DEMO-03', 'Baseline', 0.5, null, 1],
    ['DEMO-01', 'Baseline', 10, '1.0', 1],
    ['DEMO-02', 'Baseline', 20, 2.5, 1],
    ['DEMO-05', 'Baseline', 50, 5, 1]
  ], [{ row: 2, variable: 1 }, { row: 3, variable: 0 }], ['Baseline', 'Month 6'])

  it('matches rows by participant and visit, columns by header, and reports each kind of difference', () => {
    const d = diffVersions(v1, v2)
    expect(d.identical).toBe(false)
    expect(d.from).toMatchObject({ versionNumber: 1, rows: 5, participants: 4, variables: 3 })
    expect(d.to).toMatchObject({ versionNumber: 2, rows: 5, participants: 4, variables: 3 })
    expect(d.participants).toEqual({ added: ['DEMO-05'], removed: ['DEMO-04'] })
    expect(d.rows.added).toEqual([{ participantId: 'DEMO-05', visit: 'Baseline' }])
    expect(d.rows.removed).toEqual([{ participantId: 'DEMO-04', visit: 'Baseline' }])
    expect(d.rows.common).toBe(4)
    expect(d.variables).toEqual({ added: [{ key: 'New', header: 'New' }], removed: [{ key: 'Old', header: 'Old' }], common: 2 })
    // DEMO-01 Baseline: A is 1 in both ("1.0" is the same number) and B is 10 in both. No change.
    // DEMO-01 Month 6: unchanged. DEMO-02: A 2 → 2.5 (changed), B empty → 20 (filled in).
    // DEMO-03: A 0 → empty (zero is a value, so this is "now empty"); B "<0.5" → 0.5 (a censored value is not its bound).
    expect(d.totals).toEqual({ value: 2, filled: 1, emptied: 1 })
    expect(d.cells).toEqual([
      { participantId: 'DEMO-03', visit: 'Baseline', variableKey: 'B', header: 'B', kind: 'value', before: '<0.5', after: '0.5' },
      { participantId: 'DEMO-03', visit: 'Baseline', variableKey: 'A', header: 'A', kind: 'emptied', before: '0', after: '' },
      { participantId: 'DEMO-02', visit: 'Baseline', variableKey: 'B', header: 'B', kind: 'filled', before: '', after: '20' },
      { participantId: 'DEMO-02', visit: 'Baseline', variableKey: 'A', header: 'A', kind: 'value', before: '2', after: '2.5' }
    ])
    expect(d.changedVariables).toEqual([
      { key: 'A', header: 'A', value: 1, filled: 0, emptied: 1 },
      { key: 'B', header: 'B', value: 1, filled: 1, emptied: 0 }
    ])
    // Flags on observations in both versions: DEMO-01 Baseline A keeps its flag; DEMO-02 Baseline B gains one.
    // DEMO-04's flag is on a row that no longer exists, so it is not counted as lost.
    expect(d.flags).toEqual({ added: 1, removed: 0 })
  })

  it('is empty for a version compared with itself, and symmetric when the direction is reversed', () => {
    const same = diffVersions(v1, v1)
    expect(same.identical).toBe(true)
    expect(same.totals).toEqual({ value: 0, filled: 0, emptied: 0 })
    expect(same.cells).toEqual([])
    const back = diffVersions(v2, v1)
    expect(back.participants).toEqual({ added: ['DEMO-04'], removed: ['DEMO-05'] })
    expect(back.totals).toEqual({ value: 2, filled: 1, emptied: 1 }) // "filled" and "emptied" swap places
    expect(back.cells.find((c) => c.participantId === 'DEMO-02' && c.variableKey === 'B')).toMatchObject({ kind: 'emptied', before: '20', after: '' })
    expect(back.flags).toEqual({ added: 0, removed: 1 })
  })

  it('caps the listed cells and says how many were left out; reports a column that changed type', () => {
    const many = (n: number, f: (i: number) => number) => snap(n, ['A'], Array.from({ length: 30 }, (_, i) => [`DEMO-${i}`, 'Baseline', f(i)] as Row))
    const d = diffVersions(many(1, (i) => i), many(2, (i) => i + 1), { maxCells: 10 })
    expect(d.totals.value).toBe(30)
    expect(d.cells).toHaveLength(10)
    expect(d.cellsTruncated).toBe(20)
    const a = snap(1, ['A'], [['DEMO-01', 'Baseline', 1]])
    const b = snap(2, ['A'], [['DEMO-01', 'Baseline', 1]])
    b.variables[0].kind = 'mixed'
    expect(diffVersions(a, b).changedVariables).toEqual([{ key: 'A', header: 'A', value: 0, filled: 0, emptied: 0, kindBefore: 'numeric', kindAfter: 'mixed' }])
    expect(diffVersions(a, b).identical).toBe(false)
  })

  it('finds the one corrected value between the two synthetic demo workbooks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bari-diff-'))
    const p = Project.create(dir, 'Diff')
    try {
      const load = (name: string) => {
        const src = parseSource(new Uint8Array(readFileSync(join(__dirname, 'fixtures', name))), name)
        const sheet = src.wb.sheets[0].name
        const mp = previewMapping(p, src, sheet)
        const model = validate(src, { sheetName: sheet, headerRow: 1, participantColumn: mp.suggestion.participantColumn!, eventColumn: mp.suggestion.eventColumn })
        return buildSnapshot(p, commitImport(p, src, model, { authorLabel: 'Test RA', carryOverFrom: null }).datasetVersionId)
      }
      const d = diffVersions(load('demo_workbook.xlsx'), load('demo_workbook_v2.xlsx'))
      expect(d.participants).toEqual({ added: [], removed: [] })
      expect(d.variables.added).toEqual([])
      expect(d.variables.removed).toEqual([])
      expect(d.totals).toEqual({ value: 1, filled: 0, emptied: 0 })
      expect(d.cells).toHaveLength(1)
      expect(d.cells[0]).toMatchObject({ visit: 'Baseline', kind: 'value', after: '21' })
      expect(d.cells[0].participantId).toMatch(/^DEMO-\d\d$/)
      expect(d.flags).toEqual({ added: 0, removed: 0 })
      expect(d.identical).toBe(false)
    } finally {
      p.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
