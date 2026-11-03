// End-to-end service workflow against node:sqlite with synthetic fixtures (no Electron required).
import { mkdtempSync, readFileSync, existsSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { createHash } from 'node:crypto'
import { Project, ProjectLockedError, syncFolderWarning } from '../src/main/project'
import { commitImport, inspect, parseSource, previewMapping, validate, datasetContentHash } from '../src/main/importService'
import { buildSnapshot, listVersions } from '../src/main/snapshot'
import { decideFormat, editVariableMeta, setCellExclusion } from '../src/main/curation'
import { getView, saveView } from '../src/main/views'
import { previewContextExport, writeContextExport } from '../src/main/exportService'
import { createBackup, restoreBackup } from '../src/main/backup'
import { computeSelection, countsFor, observationsFor, isUsable } from '@core/selection'
import { distributionData, scatterData } from '@core/chartData'
import { summarize } from '@core/stats'
import { emptyFilter, type SavedViewSpec, type SelectionSpec } from '@core/types'

const fixture = (n: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', n)))
let root: string
let project: Project
let versionId: string

function importFile(p: Project, name: string, bytes = fixture(name), opts: { failAfterCells?: boolean; carryOverFrom?: string | null } = {}) {
  const src = parseSource(bytes, name)
  const sheet = src.wb.sheets[0].name
  const mp = previewMapping(p, src, sheet)
  const model = validate(src, { sheetName: sheet, headerRow: 1, participantColumn: mp.suggestion.participantColumn!, eventColumn: mp.suggestion.eventColumn })
  return commitImport(p, src, model, { authorLabel: 'Test RA', carryOverFrom: opts.carryOverFrom ?? null, failAfterCells: opts.failAfterCells })
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'bari-test-'))
  project = Project.create(root, 'Synthetic Test')
})
afterAll(() => {
  try {
    project.close()
  } catch {
    /* closed in test */
  }
  rmSync(root, { recursive: true, force: true })
})

describe('project persistence', () => {
  it('creates a project folder with a lock and refuses a second writer', () => {
    expect(existsSync(join(project.dir, 'project.json'))).toBe(true)
    expect(existsSync(join(project.dir, '.lock'))).toBe(true)
    // Simulate another live session on a different host.
    const lockPath = join(project.dir, '.lock')
    const original = readFileSync(lockPath, 'utf8')
    writeFileSync(lockPath, JSON.stringify({ pid: 1, host: 'other-host', at: 'now', sessionId: 'x' }))
    expect(() => Project.open(project.dir)).toThrow(ProjectLockedError)
    writeFileSync(lockPath, original)
  })
  it('warns about sync and network folders', () => {
    expect(syncFolderWarning('/Users/x/Library/Mobile Documents/com~apple~CloudDocs/p')).toMatch(/iCloud/)
    expect(syncFolderWarning('/Users/x/Dropbox/lab')).toMatch(/Dropbox/)
    expect(syncFolderWarning('/Users/x/Documents/lab')).toBeNull()
  })
})

describe('import', () => {
  it('rolls back completely when a failure happens mid-import', () => {
    expect(() => importFile(project, 'demo_workbook.xlsx', undefined, { failAfterCells: true })).toThrow(/Injected failure/)
    expect(project.db.get<{ n: number }>('SELECT COUNT(*) n FROM dataset_version')!.n).toBe(0)
    expect(project.db.get<{ n: number }>('SELECT COUNT(*) n FROM cell')!.n).toBe(0)
    expect(project.db.get<{ n: number }>('SELECT COUNT(*) n FROM source_file')!.n).toBe(0)
    expect(readdirSync(project.sourcesDir)).toEqual([])
  })

  it('commits an immutable dataset version with a read-only source snapshot', () => {
    const r = importFile(project, 'demo_workbook.xlsx')
    versionId = r.datasetVersionId
    expect(r.versionNumber).toBe(1)
    const files = readdirSync(project.sourcesDir)
    expect(files).toHaveLength(1)
    const stored = readFileSync(join(project.sourcesDir, files[0]))
    expect(createHash('sha256').update(stored).digest('hex')).toBe(files[0].replace('.xlsx', ''))
    expect(() => project.db.run("UPDATE cell SET raw_text = 'x'")).toThrow(/immutable/)
    expect(() => project.db.run('DELETE FROM revision')).toThrow(/append-only/)
  })

  it('recognises an identical file by checksum', () => {
    const src = parseSource(fixture('demo_workbook.xlsx'), 'renamed.xlsx')
    expect(inspect(project, src).duplicateOf?.datasetVersionId).toBe(versionId)
  })

  it('blocks imports with duplicate keys', () => {
    expect(() => importFile(project, 'duplicate_keys.xlsx')).toThrow(/never merged/)
  })
})

describe('selection, table, chart, summary agree', () => {
  it('produces identical included records everywhere', () => {
    const snap = buildSnapshot(project, versionId)
    const il6 = snap.variables.find((v) => v.header === 'IL6')!
    const phq = snap.variables.find((v) => v.header === 'PHQ-9 total score')!
    const sex = snap.variables.find((v) => v.header === 'Biological_Sex')!
    const spec: SelectionSpec = {
      datasetVersionId: versionId,
      visitIds: 'all',
      participantIds: null,
      qc: { exclude: ['sample_warning'] },
      filter: { ...emptyFilter(), children: [{ type: 'cond', id: 'c1', variableKey: phq.key, test: { kind: 'range', min: 3, max: null }, onMissing: 'exclude' }] }
    }
    const sel = computeSelection(snap, spec)
    expect(sel.rows.length).toBeGreaterThan(0)
    expect(sel.rows.length + sel.excludedRows.length).toBe(snap.rows.length)
    // Table rows
    const tableRows = sel.rows
    // Distribution chart
    const dist = distributionData(sel, il6.index, null, 'linear')
    const plotted = dist.groups.flatMap((g) => g.points.map((p) => p.row))
    const usable = observationsFor(sel, il6.index).filter((o) => isUsable(o) && o.value.k === 'number').map((o) => o.row)
    expect(plotted.sort()).toEqual(usable.sort())
    // Summary equals hand-filtered numeric values from the same rows
    const s = summarize(observationsFor(sel, il6.index).filter(isUsable).map((o) => o.value))
    expect(dist.groups[0].summary.n).toBe(s.n)
    expect(dist.groups[0].summary.mean).toBe(s.mean)
    // QC exclusion removed DEMO-02's IL6 (sample warning) if DEMO-02 matched the filter
    const c = countsFor(sel, il6.index)
    expect(c.included + c.missing + c.qcExcluded).toBe(sel.rows.length)
    // Grouped distribution keeps the same total
    const grouped = distributionData(sel, il6.index, sex.index, 'linear')
    expect(grouped.groups.reduce((a, g) => a + g.points.length, 0)).toBe(plotted.length)
    // Export rows equal table rows
    const prev = previewContextExport(project, spec, { variableKeys: [il6.key, phq.key], confirmedQuasiIdentifiers: [], participantKeyMode: 'project_pseudonym', includeCommentText: false, analysisQuestion: 'Exploratory: describe IL6 distribution.' }, snap.metadataVersion)
    const lines = prev.files['selected_data.csv'].trim().split('\r\n')
    expect(lines.length - 1).toBe(tableRows.length)
    expect(prev.rows).toBe(tableRows.length)
  })

  it('handles no matching data and log-axis exclusions explicitly', () => {
    const snap = buildSnapshot(project, versionId)
    const il6 = snap.variables.find((v) => v.header === 'IL6')!
    const tnf = snap.variables.find((v) => v.header === 'TNF')!
    const none = computeSelection(snap, {
      datasetVersionId: versionId, visitIds: 'all', participantIds: null, qc: { exclude: [] },
      filter: { ...emptyFilter(), children: [{ type: 'cond', id: 'c', variableKey: il6.key, test: { kind: 'range', min: 1e9, max: null }, onMissing: 'exclude' }] }
    })
    expect(none.rows).toEqual([])
    expect(distributionData(none, il6.index, null, 'linear').groups).toEqual([])
    const all = computeSelection(snap, { datasetVersionId: versionId, visitIds: 'all', participantIds: null, qc: { exclude: [] }, filter: emptyFilter() })
    const d = distributionData(all, il6.index, null, 'log')
    expect(d.groups[0].nonPositiveHidden.map((p) => p.value)).toEqual([0]) // the synthetic zero is listed, not dropped silently
    const sc = scatterData(all, il6.index, tnf.index, 'log', 'linear')
    expect(sc.hidden).toHaveLength(1)
    expect(sc.unevaluable).toBe(1) // censored "<0.5" in TNF
  })
})

describe('curation, saved views and reproducibility', () => {
  it('records metadata edits and formatting decisions append-only, and reproduces saved views after reopen', () => {
    const snap0 = buildSnapshot(project, versionId)
    const il6 = snap0.variables.find((v) => v.header === 'IL6')!
    const spec: SavedViewSpec = {
      schema: 1,
      selection: { datasetVersionId: versionId, visitIds: 'all', participantIds: null, qc: { exclude: ['possible_sample_warning'] }, filter: emptyFilter() },
      chart: { type: 'distribution', measureKey: il6.key, compareKey: null, groupKey: null, xScale: 'linear', yScale: 'linear', tableColumns: [] },
      transformations: [],
      missingDataPolicy: 'exclude-missing'
    }
    const mv = project.metadataVersion()
    const view = saveView(project, { name: 'IL6 baseline', description: null, spec, metadataVersion: mv, author: 'Test RA' })
    const before = computeSelection(buildSnapshot(project, versionId, view.metadataVersion), view.spec.selection)
    const beforeCounts = countsFor(before, il6.index)

    // Later curation: confirm the near-match colour as a sample warning, and edit units.
    const possible = snap0.flags.find((f) => f.category === 'possible_sample_warning')!
    decideFormat(project, { datasetVersionId: versionId, groupKey: `${possible.formatKey}|${possible.kind}|${possible.status}`, decision: 'confirm', asKind: 'qc_sample', author: 'Curator', reason: 'Verified against QC report (synthetic)' })
    editVariableMeta(project, { datasetVersionId: versionId, varKey: il6.key, field: 'unit', value: 'NPQ', status: 'confirmed', author: 'Curator', reason: 'Synthetic' })
    setCellExclusion(project, { datasetVersionId: versionId, varKey: il6.key, participantId: 'DEMO-05', visitId: snap0.visits[0].id, excluded: true, author: 'Curator', reason: 'Synthetic test exclusion' })
    const now = buildSnapshot(project, versionId)
    expect(now.variables.find((v) => v.key === il6.key)!.meta.unit).toMatchObject({ value: 'NPQ', status: 'confirmed' })
    expect(now.flags.some((f) => f.category === 'curator_exclusion')).toBe(true)

    // Restart: close and reopen the project, then reproduce the saved view as saved.
    project.close()
    project = Project.open(project.dir)
    const reopened = getView(project, view.id)!
    expect(reopened.metadataChangedSince).toBe(3)
    const after = computeSelection(buildSnapshot(project, versionId, reopened.metadataVersion), reopened.spec.selection)
    expect(after.rows).toEqual(before.rows)
    expect(countsFor(after, il6.index)).toEqual(beforeCounts)
    expect(buildSnapshot(project, versionId, reopened.metadataVersion).variables.find((v) => v.key === il6.key)!.meta.unit.value).toBeNull()
  })

  it('creates a new immutable version for an updated file and carries curator metadata over', () => {
    const r = importFile(project, 'demo_workbook_v2.xlsx', undefined, { carryOverFrom: versionId })
    expect(r.versionNumber).toBe(2)
    expect(listVersions(project).map((v) => v.versionNumber)).toEqual([2, 1])
    const v2 = buildSnapshot(project, r.datasetVersionId)
    const il6 = v2.variables.find((v) => v.header === 'IL6')!
    expect(il6.meta.unit).toMatchObject({ value: 'NPQ', status: 'confirmed' })
    expect(il6.meta.unit.provenance).toMatch(/Carried over from dataset v1/)
    // v1 is untouched
    expect(datasetContentHash(project, versionId)).not.toBe(datasetContentHash(project, r.datasetVersionId))
  })
})

describe('context export', () => {
  it('writes a package with pseudonymous keys, checksums and no unintended fields', () => {
    const snap = buildSnapshot(project, versionId)
    const keys = ['IL6', 'TNF', 'Age'].map((h) => snap.variables.find((v) => v.header === h)!.key)
    const spec: SelectionSpec = { datasetVersionId: versionId, visitIds: 'all', participantIds: null, qc: { exclude: ['curator_exclusion'] }, filter: emptyFilter() }
    const opts = { variableKeys: keys, confirmedQuasiIdentifiers: [] as string[], participantKeyMode: 'project_pseudonym' as const, includeCommentText: false, analysisQuestion: 'Is IL6 associated with TNF at baseline? (exploratory)' }
    const dest = join(root, 'context.zip')
    expect(() => writeContextExport(project, spec, opts, snap.metadataVersion, dest, 'Test RA')).toThrow(/quasi-identifiers/)
    const res = writeContextExport(project, spec, { ...opts, confirmedQuasiIdentifiers: [keys[2]] }, snap.metadataVersion, dest, 'Test RA')
    const files = unzipSync(new Uint8Array(readFileSync(dest)))
    expect(Object.keys(files).sort()).toEqual(['analysis_log.R', 'analysis_request.md', 'data_dictionary.csv', 'manifest.json', 'quality_flags.csv', 'selected_data.csv', 'study_context.md'])
    const manifest = JSON.parse(strFromU8(files['manifest.json']))
    for (const f of manifest.files) expect(createHash('sha256').update(files[f.name]).digest('hex')).toBe(f.sha256)
    const data = strFromU8(files['selected_data.csv'])
    const header = data.split('\r\n')[0].split(',')
    expect(header).toEqual(['participant_key', 'visit', ...keys])
    expect(data).not.toMatch(/DEMO-\d\d/)
    expect(data).toMatch(/P-[0-9A-F]{10}/)
    const all = Object.values(files).map((u) => strFromU8(u)).join('\n')
    expect(all).not.toContain(root) // no absolute paths
    expect(all).not.toContain('Demo Curator') // no comment authors
    expect(strFromU8(files['study_context.md'])).toMatch(/baseline observations only/i)
    expect(strFromU8(files['quality_flags.csv'])).toMatch(/excluded by policy/)
    expect(manifest.metadataVersion).toBe(snap.metadataVersion)
    expect(res.files).toHaveLength(6)
    expect(strFromU8(files['analysis_log.R'])).toContain(`chain signature: ${manifest.analysisLog.signature}`)
  })
})

describe('backup and restore', () => {
  it('round-trips without changing observations', async () => {
    const dest = join(root, 'backup.bariproj.zip')
    const m = await createBackup(project, dest, 'Test RA')
    expect(m.datasets.length).toBe(2)
    const restored = restoreBackup(dest, root, 'Restored copy')
    expect(restored.verified.integrity).toBe('ok')
    const p2 = Project.open(restored.dir)
    try {
      expect(datasetContentHash(p2, versionId)).toBe(datasetContentHash(project, versionId))
      expect(p2.metadataVersion()).toBe(project.metadataVersion())
    } finally {
      p2.close()
    }
  })
  it('rejects a damaged backup', async () => {
    const dest = join(root, 'backup2.zip')
    await createBackup(project, dest, null)
    const bytes = new Uint8Array(readFileSync(dest))
    const files = unzipSync(bytes)
    files['workspace.sqlite'][100] ^= 0xff
    const { zipSync } = await import('fflate')
    writeFileSync(dest, zipSync(files))
    expect(() => restoreBackup(dest, root, 'Damaged')).toThrow(/Checksum mismatch/)
    expect(existsSync(join(root, 'Damaged.bariproj'))).toBe(false)
  })
})
