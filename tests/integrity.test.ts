// Integrity and governance (docs/STRATEGY.md, Phase 2): every curation action is audited, and the audit log,
// revisions and analysis register are hash-chained so that a tampered database fails verification. Synthetic data only.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { unzipSync, strFromU8 } from 'fflate'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Project } from '../src/main/project'
import { commitImport, parseSource, previewMapping, validate } from '../src/main/importService'
import { buildSnapshot } from '../src/main/snapshot'
import { recordAnalysis } from '../src/main/register'
import { createBackup, restoreBackup } from '../src/main/backup'
import { writeContextExport } from '../src/main/exportService'
import { CHAIN_GENESIS, chainHead, expectedTriggers, linkHash, startChain, verifyIntegrity } from '../src/main/integrity'
import { MIGRATIONS } from '../src/main/db/migrations'
import { emptyFilter } from '@core/types'
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

/** A project with an import, a few curation actions and one registered analysis: rows in all three chained tables. */
function seeded(name: string) {
  const dir = mkdtempSync(join(tmpdir(), 'bari-chain-'))
  const p = Project.create(dir, name)
  const src = parseSource(new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'demo_workbook.xlsx'))), 'demo_workbook.xlsx')
  const sheet = src.wb.sheets[0].name
  const mp = previewMapping(p, src, sheet)
  const model = validate(src, { sheetName: sheet, headerRow: 1, participantColumn: mp.suggestion.participantColumn!, eventColumn: mp.suggestion.eventColumn })
  const id = commitImport(p, src, model, { authorLabel: 'Test RA', carryOverFrom: null }).datasetVersionId
  const snap = buildSnapshot(p, id)
  const il6 = snap.variables.find((v) => v.header === 'IL6')!
  const tnf = snap.variables.find((v) => v.header === 'TNF')!
  editVariableMeta(p, { datasetVersionId: id, varKey: il6.key, field: 'unit', value: 'pg/mL', status: 'tentative', author: 'Test RA', reason: null })
  setStudyContext(p, { datasetVersionId: id, text: 'Synthetic.', author: 'Test RA' })
  const spec = { datasetVersionId: id, visitIds: 'all' as const, participantIds: null, qc: { exclude: [] }, filter: emptyFilter() }
  recordAnalysis(p, { spec, chart: { type: 'scatter', measureKey: il6.key, compareKey: tnf.key, groupKey: null, xScale: 'linear', yScale: 'linear', tableColumns: [] }, metadataVersion: p.metadataVersion(), author: 'Test RA' })
  return { dir, p, folder: p.dir, id, il6, spec }
}

/** Edits the database the way an outside SQLite tool would, with the project closed. */
function tamper(folder: string, sql: string) {
  const raw = new DatabaseSync(join(folder, 'workspace.sqlite'))
  raw.exec(sql)
  raw.close()
}

describe('integrity chain', () => {
  it('chains every audit, revision and register row as the app writes it, and verifies', () => {
    const { dir, p } = seeded('Chain')
    try {
      const r = verifyIntegrity(p.db)
      expect(r.problems).toEqual([])
      expect(r.ok).toBe(true)
      expect(r.legacyEntries).toBe(0)
      for (const t of ['audit_log', 'revision', 'analysis_register']) {
        expect(r.tables[t].rows).toBeGreaterThan(0)
        expect(r.tables[t].chained).toBe(r.tables[t].rows)
      }
      expect(r.entries).toBe(r.tables.audit_log.rows + r.tables.revision.rows + r.tables.analysis_register.rows)
      expect(r.head).toEqual(chainHead(p.db))
      expect(r.head!.chainHash).toMatch(/^[0-9a-f]{64}$/)
      // The first entry links to the fixed genesis value, so the chain can be recomputed by anyone.
      const first = p.db.get<any>('SELECT * FROM integrity_chain WHERE seq = 1')
      expect(first.chain_hash).toBe(linkHash(CHAIN_GENESIS, first.table_name, first.row_id, first.row_hash))
      // The chain itself is append-only, and every expected trigger is in the database.
      expect(() => p.db.run('DELETE FROM integrity_chain')).toThrow(/append-only/)
      expect(() => p.db.run("UPDATE integrity_chain SET row_hash = 'x'")).toThrow(/append-only/)
      expect(expectedTriggers()).toEqual(expect.arrayContaining(['audit_immutable', 'revision_nodelete', 'analysis_register_immutable', 'integrity_chain_nodelete']))
      // A rolled-back transaction leaves no entry behind.
      const before = r.entries
      expect(() => p.db.transaction(() => { p.audit('test.rollback', {}); throw new Error('abort') })).toThrow('abort')
      expect(verifyIntegrity(p.db)).toMatchObject({ ok: true, entries: before })
    } finally {
      p.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a tampered database fails verification, and says what was done', () => {
    const cases: { name: string; sql: string; kinds: string[] }[] = [
      { name: 'edited audit row', sql: "DROP TRIGGER audit_immutable; UPDATE audit_log SET author_label = 'Someone else' WHERE id = 2", kinds: ['trigger_missing', 'row_changed'] },
      { name: 'edited revision value', sql: "DROP TRIGGER revision_immutable; UPDATE revision SET value_json = '\"ng/mL\"' WHERE field = 'unit' AND author_label = 'Test RA'; CREATE TRIGGER revision_immutable BEFORE UPDATE ON revision BEGIN SELECT RAISE(ABORT, 'revisions are append-only'); END;", kinds: ['row_changed'] },
      { name: 'deleted audit row', sql: 'DROP TRIGGER audit_nodelete; DELETE FROM audit_log WHERE id = (SELECT MAX(id) FROM audit_log)', kinds: ['trigger_missing', 'row_missing'] },
      { name: 'edited register result', sql: "DROP TRIGGER analysis_register_immutable; UPDATE analysis_register SET test_count = 0", kinds: ['trigger_missing', 'row_changed'] },
      { name: 'row added outside the app', sql: "INSERT INTO audit_log(at, action, detail_json, author_label) VALUES ('2026-01-01T00:00:00.000Z', 'view.save', '{}', 'Ghost')", kinds: ['row_not_chained'] },
      { name: 'chain entry removed', sql: 'DROP TRIGGER integrity_chain_nodelete; DELETE FROM integrity_chain WHERE seq = 3', kinds: ['trigger_missing', 'row_not_chained', 'chain_broken'] },
      { name: 'row and its hash both edited', sql: "DROP TRIGGER audit_immutable; DROP TRIGGER integrity_chain_immutable; UPDATE audit_log SET action = 'x' WHERE id = 1; UPDATE integrity_chain SET row_hash = 'deadbeef' WHERE table_name = 'audit_log' AND row_id = 1", kinds: ['trigger_missing', 'row_changed', 'chain_broken'] }
    ]
    for (const c of cases) {
      const { dir, p, folder } = seeded('Tamper')
      p.close()
      try {
        tamper(folder, c.sql)
        // Verification is read-only: it works without the project lock, as the --verify-project command does.
        const ro = Project.openReadOnly(folder)
        const r = verifyIntegrity(ro.db)
        ro.close()
        expect(r.ok, c.name).toBe(false)
        expect([...new Set(r.problems.map((x) => x.kind))].sort(), c.name).toEqual([...c.kinds].sort())
        // Writing through the app afterwards does not paper over the damage.
        const again = Project.open(folder)
        again.audit('test.after', {})
        expect(verifyIntegrity(again.db).ok, `${c.name}, after another write`).toBe(false)
        again.close()
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  })

  it('anchors in backups and exports catch a chain that was rewritten from scratch', async () => {
    const { dir, p, folder, il6, spec } = seeded('Anchor')
    try {
      const zip = join(dir, 'backup.zip')
      const backup = await createBackup(p, zip, null)
      expect(backup.integrity!.head!.seq).toBeGreaterThan(0)
      const ctx = join(dir, 'context.zip')
      writeContextExport(p, spec, { variableKeys: [il6.key], confirmedQuasiIdentifiers: [], participantKeyMode: 'project_pseudonym', includeCommentText: false, analysisQuestion: '' }, p.metadataVersion(), ctx, null)
      const manifest = JSON.parse(strFromU8(unzipSync(new Uint8Array(readFileSync(ctx)))['manifest.json']))
      expect(manifest.integrity.head.chainHash).toMatch(/^[0-9a-f]{64}$/)
      const good = verifyIntegrity(p.db)
      expect(good.ok).toBe(true)
      expect(good.anchorsChecked).toBe(2)
      p.close()
      // An attacker edits a record, then rebuilds the whole chain so that it is consistent again.
      tamper(folder, "DROP TRIGGER audit_immutable; DROP TRIGGER integrity_chain_nodelete; UPDATE audit_log SET author_label = 'Rewritten' WHERE id = 1; DELETE FROM integrity_chain; DELETE FROM meta WHERE key = 'integrity_chain_started'; CREATE TRIGGER audit_immutable BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END; CREATE TRIGGER integrity_chain_nodelete BEFORE DELETE ON integrity_chain BEGIN SELECT RAISE(ABORT, 'the integrity chain is append-only'); END;")
      const again = Project.open(folder) // starts a new chain over the edited rows
      const r = verifyIntegrity(again.db)
      expect(r.problems.map((x) => x.kind)).toEqual(['anchor_mismatch', 'anchor_mismatch'])
      expect(r.problems[0].detail).toMatch(/backup backup\.zip/)
      // Even if the attacker also removes the recorded anchors, a manifest kept outside the project still catches it.
      again.db.run('DELETE FROM export_record')
      expect(verifyIntegrity(again.db).ok).toBe(true)
      const withCopy = verifyIntegrity(again.db, [{ ...backup.integrity!.head!, source: 'a backup manifest kept elsewhere' }])
      expect(withCopy.ok).toBe(false)
      expect(withCopy.problems[0]).toMatchObject({ kind: 'anchor_mismatch' })
      // Every rebuilt entry is marked as entered after the fact.
      expect(r.legacyEntries).toBe(r.entries)
      again.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('restore checks the records against the head the backup recorded, and reports damage without refusing', async () => {
    const { dir, p, folder } = seeded('Restore')
    try {
      const zip = join(dir, 'ok.zip')
      await createBackup(p, zip, null)
      const ok = restoreBackup(zip, dir, 'Restored ok')
      expect(ok.verified.records).toMatchObject({ ok: true, problems: 0 })
      expect(ok.verified.records.entries).toBeGreaterThan(0)
      p.close()
      tamper(folder, "DROP TRIGGER audit_immutable; UPDATE audit_log SET action = 'edited' WHERE id = 1")
      const damaged = Project.open(folder)
      const zip2 = join(dir, 'damaged.zip')
      await createBackup(damaged, zip2, null)
      damaged.close()
      const res = restoreBackup(zip2, dir, 'Restored damaged')
      expect(res.verified.records.ok).toBe(false)
      expect(res.verified.records.problems).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('starts a chain for a project made before chains existed, marking those rows as entered after the fact', () => {
    const { dir, p, folder } = seeded('Legacy')
    p.close()
    try {
      // Put the project back to the previous schema, as an older app version would have left it.
      tamper(folder, `DROP TABLE integrity_chain; DELETE FROM meta WHERE key = 'integrity_chain_started'; DELETE FROM schema_migrations WHERE version = ${MIGRATIONS.length}`)
      const up = Project.open(folder)
      const r = verifyIntegrity(up.db)
      expect(r.ok).toBe(true)
      expect(r.legacyEntries).toBe(r.entries)
      expect(r.entries).toBeGreaterThan(0)
      up.audit('test.new', {})
      const after = verifyIntegrity(up.db)
      expect(after).toMatchObject({ ok: true, entries: r.entries + 1, legacyEntries: r.entries })
      // Starting the chain is done once.
      startChain(up.db)
      expect(verifyIntegrity(up.db).entries).toBe(after.entries)
      up.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
