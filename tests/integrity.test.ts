// Integrity and governance (docs/STRATEGY.md, Phase 2): every curation action is audited. Synthetic data only.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Project } from '../src/main/project'
import { commitImport, parseSource, previewMapping, validate } from '../src/main/importService'
import { buildSnapshot } from '../src/main/snapshot'
import { decideFormat, editVariableMeta, nameSegment, setCellExclusion, setCovariate, setQuasiIdentifier, setStudyContext } from '../src/main/curation'

let root: string
let project: Project
let versionId: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'bari-integrity-'))
  project = Project.create(root, 'Integrity')
  const src = parseSource(new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'demo_workbook.xlsx'))), 'demo_workbook.xlsx')
  const sheet = src.wb.sheets[0].name
  const mp = previewMapping(project, src, sheet)
  const model = validate(src, { sheetName: sheet, headerRow: 1, participantColumn: mp.suggestion.participantColumn!, eventColumn: mp.suggestion.eventColumn })
  versionId = commitImport(project, src, model, { authorLabel: 'Test RA', carryOverFrom: null }).datasetVersionId
})
afterAll(() => {
  try {
    project.close()
  } catch {
    /* closed in a test */
  }
  rmSync(root, { recursive: true, force: true })
})

describe('audit trail', () => {
  it('records every curation action, each tied to its revision', () => {
    const snap = buildSnapshot(project, versionId)
    const il6 = snap.variables.find((v) => v.header === 'IL6')!
    const row = snap.rows[0]
    const before = project.db.get<{ n: number }>('SELECT COUNT(*) n FROM audit_log')!.n
    const revisions = [
      editVariableMeta(project, { datasetVersionId: versionId, varKey: il6.key, field: 'unit', value: 'pg/mL', status: 'tentative', author: 'Test RA', reason: null }),
      setQuasiIdentifier(project, { datasetVersionId: versionId, varKey: il6.key, value: true, author: 'Test RA', reason: 'test' }),
      setCovariate(project, { datasetVersionId: versionId, varKey: il6.key, value: true, author: 'Test RA', reason: null }),
      setCellExclusion(project, { datasetVersionId: versionId, varKey: il6.key, participantId: row.participantId, visitId: row.visitId, excluded: true, author: 'Test RA', reason: 'test' }),
      nameSegment(project, { datasetVersionId: versionId, segment: 0, name: 'Cytokines', author: 'Test RA' }),
      setStudyContext(project, { datasetVersionId: versionId, text: 'Synthetic study context.', author: 'Test RA' }),
      decideFormat(project, { datasetVersionId: versionId, groupKey: 'FFFFFF|qc_sample|needs_review', decision: 'reset', author: 'Test RA', reason: null })
    ]
    const rows = project.db.all<{ action: string; detail_json: string; author_label: string }>('SELECT action, detail_json, author_label FROM audit_log ORDER BY id').slice(before)
    expect(rows.map((r) => r.action)).toEqual(['metadata.edit', 'quasi_identifier.set', 'covariate.set', 'observation.exclude', 'segment.name', 'study_context.set', 'format.decision'])
    expect(rows.map((r) => JSON.parse(r.detail_json).revision)).toEqual(revisions)
    expect(rows.every((r) => r.author_label === 'Test RA')).toBe(true)
    // The study context text and participant identifiers stay out of the audit detail.
    const text = rows.map((r) => r.detail_json).join('\n')
    expect(text).not.toContain('Synthetic study context')
    expect(text).not.toContain(row.participantId)
  })
})
