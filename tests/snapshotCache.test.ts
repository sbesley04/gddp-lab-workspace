// Snapshots reuse the imported part of a dataset version (it can never change) and re-read only curation.
// These tests check that the shortcut cannot change an answer.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Project } from '../src/main/project'
import { commitImport, parseSource, previewMapping, validate } from '../src/main/importService'
import { buildSnapshot, buildSnapshotCuration } from '../src/main/snapshot'
import { decideFormat, editVariableMeta, setCellExclusion } from '../src/main/curation'
import { computeSelection } from '@core/selection'
import { emptyFilter } from '@core/types'

let root: string
let project: Project
const ids: string[] = []
const load = (p: Project, name: string, as = name) => {
  const src = parseSource(new Uint8Array(readFileSync(join(__dirname, 'fixtures', name))), as)
  const sheet = src.wb.sheets[0].name
  const mp = previewMapping(p, src, sheet)
  const model = validate(src, { sheetName: sheet, headerRow: 1, participantColumn: mp.suggestion.participantColumn!, eventColumn: mp.suggestion.eventColumn })
  return commitImport(p, src, model, { authorLabel: 'Test RA', carryOverFrom: null }).datasetVersionId
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'bari-cache-'))
  project = Project.create(root, 'Cache')
  ids.push(load(project, 'demo_workbook.xlsx'), load(project, 'demo_workbook_v2.xlsx'), load(project, 'demo.csv'))
})
afterAll(() => {
  project.close()
  rmSync(root, { recursive: true, force: true })
})

/** A snapshot read by a second connection that has never cached anything: the reference answer. */
function fresh(versionId: string, asOf?: number) {
  const other = Project.openReadOnly(project.dir)
  try {
    return buildSnapshot(other, versionId, asOf)
  } finally {
    other.close()
  }
}

describe('snapshot reuse', () => {
  it('gives the same snapshot as reading everything again, before and after curation', () => {
    const [v1] = ids
    const first = buildSnapshot(project, v1)
    expect(first).toEqual(fresh(v1))
    const il6 = first.variables.find((v) => v.header === 'IL6')!
    const row = first.rows[3]
    editVariableMeta(project, { datasetVersionId: v1, varKey: il6.key, field: 'unit', value: 'NPQ', status: 'confirmed', author: 'Test RA', reason: null })
    setCellExclusion(project, { datasetVersionId: v1, varKey: il6.key, participantId: row.participantId, visitId: row.visitId, excluded: true, author: 'Test RA', reason: 'test' })
    const group = first.flags.find((f) => f.status === 'needs_review')
    if (group) decideFormat(project, { datasetVersionId: v1, groupKey: group.formatKey, decision: 'reject', author: 'Test RA', reason: 'test' })
    const second = buildSnapshot(project, v1)
    expect(second).toEqual(fresh(v1))
    expect(second.metadataVersion).toBeGreaterThan(first.metadataVersion)
    expect(second.variables.find((v) => v.key === il6.key)!.meta.unit.value).toBe('NPQ')
    expect(second.flags.some((f) => f.category === 'curator_exclusion' && f.row === row.index)).toBe(true)
    // The imported cells are the same objects; the curated parts are new.
    expect(second.values).toBe(first.values)
    expect(second.rows).toBe(first.rows)
    expect(second.variables).not.toBe(first.variables)
    // The earlier state is still reproducible exactly (saved views pin a metadata version).
    expect(buildSnapshot(project, v1, first.metadataVersion)).toEqual(first)
    expect(buildSnapshot(project, v1, first.metadataVersion)).toEqual(fresh(v1, first.metadataVersion))
  })

  it('the curated parts alone, merged into a snapshot the window already holds, equal a full snapshot', () => {
    const [v1] = ids
    const held = buildSnapshot(project, v1, 1)
    const c = buildSnapshotCuration(project, v1)
    expect(Object.keys(c).sort()).toEqual(['datasetVersionId', 'flags', 'metadataVersion', 'variables'])
    const merged = { ...held, metadataVersion: c.metadataVersion, variables: c.variables, flags: c.flags }
    expect(merged).toEqual(fresh(v1))
    const spec = { datasetVersionId: v1, visitIds: 'all' as const, participantIds: null, qc: { exclude: ['curator_exclusion' as const] }, filter: emptyFilter() }
    expect(computeSelection(merged, spec).rows).toEqual(computeSelection(fresh(v1), spec).rows)
  })

  it('refuses any write to the shared part, so one snapshot cannot change another', () => {
    const s = buildSnapshot(project, ids[0])
    expect(() => { s.values[0][0] = { k: 'number', v: 999, raw: '999' } }).toThrow(TypeError)
    expect(() => { s.values[0] = [] }).toThrow(TypeError)
    expect(() => { s.rows[0].participantId = 'changed' }).toThrow(TypeError)
    expect(() => { s.rows.push(s.rows[0]) }).toThrow(TypeError)
    expect(() => { s.annotations.length = 0 }).toThrow(TypeError)
    // The curated parts belong to this snapshot alone and may be adjusted by tests and callers.
    s.variables[0].kind = 'mixed'
    expect(buildSnapshot(project, ids[0]).variables[0].kind).not.toBe('mixed')
  })

  it('keeps versions apart when several are in use', () => {
    const [v1, v2, v3] = ids
    const a = buildSnapshot(project, v1)
    const b = buildSnapshot(project, v2)
    const c = buildSnapshot(project, v3) // a third version pushes the first out of the cache
    expect(a.values).not.toBe(b.values)
    expect(c.rows.length).not.toBe(a.rows.length)
    for (const id of [v1, v2, v3, v1]) expect(buildSnapshot(project, id)).toEqual(fresh(id))
    expect(buildSnapshot(project, v1).versionNumber).toBe(1)
    expect(buildSnapshot(project, v3).sourceKind).toBe('csv')
  })
})
