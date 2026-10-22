// Opt-in reconciliation against a real study workbook. Nothing study-specific is stored in this file:
// the workbook path comes from BARI_REFERENCE_XLSX, and expected counts come from a local, git-ignored
// JSON file (BARI_REFERENCE_EXPECT, default tests/reference/expected.local.json). Prints counts only.
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { readWorkbook } from '@importer/ooxml'
import { buildImportModel, suggestMapping } from '@importer/model'
import { Project } from '../../src/main/project'
import { commitImport, parseSource, validate as validateModel, datasetContentHash } from '../../src/main/importService'
import { buildSnapshot } from '../../src/main/snapshot'
import { writeContextExport } from '../../src/main/exportService'
import { createBackup, restoreBackup } from '../../src/main/backup'
import { computeSelection } from '@core/selection'
import { emptyFilter } from '@core/types'

/** Shape of the local expectations file (see docs/DEVELOPING.md). Every field is optional. */
interface Expectations {
  sheet?: string
  participants?: number
  rows?: number
  columns?: number
  measures?: number
  events?: string[]
  blankColumns?: string[]
  comments?: number
  richHeaders?: number
  flagCounts?: Record<string, number>
  aliasInconsistent?: string[]
}

const path = process.env.BARI_REFERENCE_XLSX
const expectPath = process.env.BARI_REFERENCE_EXPECT ?? join(__dirname, 'expected.local.json')
const E: Expectations = existsSync(expectPath) ? JSON.parse(readFileSync(expectPath, 'utf8')) : {}
const run = path && existsSync(path) ? describe : describe.skip
const maybe = (cond: unknown) => (cond !== undefined ? it : it.skip)

run('reference workbook reconciliation', () => {
  const wb = readWorkbook(new Uint8Array(readFileSync(path!)))
  const sheet = (E.sheet ? wb.sheets.find((s) => s.name === E.sheet) : wb.sheets.filter((s) => !/legend/i.test(s.name)).sort((a, b) => b.maxCol - a.maxCol)[0])!
  const m = suggestMapping(sheet)
  const model = buildImportModel(wb, { sheetName: sheet.name, headerRow: 1, participantColumn: m.participantColumn!, eventColumn: m.eventColumn })

  it('maps participant and visit columns without blocking errors', () => {
    expect(m.participantColumn).not.toBeNull()
    expect(model.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(new Set(model.rows.map((r) => `${r.participantId}@${r.eventName}`)).size).toBe(model.rows.length)
  })
  maybe(E.participants ?? E.rows ?? E.columns)('reconciles participants, rows and columns', () => {
    if (E.participants !== undefined) expect(model.summary.participants).toBe(E.participants)
    if (E.rows !== undefined) expect(model.summary.dataRows).toBe(E.rows)
    if (E.columns !== undefined) expect(model.summary.columns).toBe(E.columns)
    if (E.events) expect(model.summary.events).toEqual(E.events)
  })
  it('keeps blank columns but hides them from measures', () => {
    for (const c of model.columns.filter((c) => c.counts.number + c.counts.text + c.counts.censored === 0 && c.role !== 'participant_id' && c.role !== 'event')) expect(c.role).toBe('blank')
    if (E.blankColumns) expect(model.columns.filter((c) => c.role === 'blank').map((c) => c.letter)).toEqual(E.blankColumns)
  })
  it('keeps threaded comment text, not Excel boilerplate', () => {
    expect(model.annotations.every((a) => !a.text.startsWith('[Threaded comment]'))).toBe(true)
    if (E.comments !== undefined) expect(model.summary.comments).toBe(E.comments)
    if (E.richHeaders !== undefined) expect(model.summary.richHeaders).toBe(E.richHeaders)
  })
  maybe(E.flagCounts)('decodes legend QC categories with the expected counts', () => {
    for (const [k, n] of Object.entries(E.flagCounts!)) expect(model.summary.flagCounts[k] ?? 0).toBe(n)
  })
  maybe(E.aliasInconsistent)('flags the expected header naming inconsistencies', () => {
    const inc = model.issues.find((i) => i.code === 'alias_inconsistent')
    expect((inc?.locations ?? []).map((l) => l.split(':')[0]).sort()).toEqual([...E.aliasInconsistent!].sort())
  })
})

run('reference workbook through the project database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bari-ref-'))
  const p = Project.create(dir, 'Reference check')
  const src = parseSource(new Uint8Array(readFileSync(path!)), 'reference.xlsx')
  const sheet = E.sheet ?? src.wb.sheets.filter((s) => !/legend/i.test(s.name)).sort((a, b) => b.maxCol - a.maxCol)[0].name
  const m = suggestMapping(src.wb.sheets.find((s) => s.name === sheet)!)
  const model = validateModel(src, { sheetName: sheet, headerRow: 1, participantColumn: m.participantColumn!, eventColumn: m.eventColumn })
  const { datasetVersionId } = commitImport(p, src, model, { authorLabel: null, carryOverFrom: null })
  const snap = buildSnapshot(p, datasetVersionId)

  it('stores every row and column and excludes blank columns from measures', () => {
    expect(snap.rows.length).toBe(model.summary.dataRows)
    expect(snap.variables.length).toBe(model.summary.columns)
    if (E.measures !== undefined) expect(snap.variables.filter((v) => v.role === 'measure').length).toBe(E.measures)
  })

  it('exports a checksummed pseudonymous package without leaking IDs, and backs up losslessly', async () => {
    const measure = snap.variables.find((v) => v.role === 'measure' && v.kind === 'numeric' && !v.quasiIdentifier)!
    const spec = { datasetVersionId, visitIds: 'all' as const, participantIds: null, qc: { exclude: [] }, filter: emptyFilter() }
    const sel = computeSelection(snap, spec)
    const zip = join(dir, 'ctx.zip')
    writeContextExport(p, spec, { variableKeys: [measure.key], confirmedQuasiIdentifiers: [], participantKeyMode: 'project_pseudonym', includeCommentText: false, analysisQuestion: 'reference check' }, snap.metadataVersion, zip, null)
    const files = unzipSync(new Uint8Array(readFileSync(zip)))
    const data = strFromU8(files['selected_data.csv'])
    expect(data.trim().split('\r\n').length - 1).toBe(sel.rows.length)
    for (const r of snap.rows) expect(data).not.toMatch(new RegExp(`(^|\\r\\n)${r.participantId},`))
    const b = join(dir, 'backup.zip')
    await createBackup(p, b, null)
    const restored = restoreBackup(b, dir, 'restored')
    const p2 = Project.open(restored.dir)
    expect(datasetContentHash(p2, datasetVersionId)).toBe(datasetContentHash(p, datasetVersionId))
    p2.close()
    p.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
