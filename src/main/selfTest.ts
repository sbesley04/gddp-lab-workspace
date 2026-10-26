// `--self-test [outDir]`: verifies an installed build end to end on bundled SYNTHETIC data in a temp folder.
// Useful for smoke-testing installers (including on Windows) without touching real projects.
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { removeTree } from './fsutil'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { unzipSync, strFromU8 } from 'fflate'
import { Project } from './project'
import { commitImport, parseSource, previewMapping, validate, datasetContentHash, sha256 } from './importService'
import { buildSnapshot } from './snapshot'
import { saveView, getView } from './views'
import { writeContextExport } from './exportService'
import { createBackup, restoreBackup } from './backup'
import { computeSelection } from '@core/selection'
import { emptyFilter } from '@core/types'
import { APP_VERSION } from './version'

/** Writes a failure report and exits; used by the crash handler and watchdog in index.ts. */
export function abortSelfTest(outDir: string | undefined, reason: string): never {
  const report = { app: 'BARI-CNS Research Workspace', version: APP_VERSION, platform: `${process.platform}-${process.arch}`, at: new Date().toISOString(), ok: false, steps: [{ step: 'self-test aborted', ok: false, detail: reason }] }
  const text = JSON.stringify(report, null, 2)
  try {
    if (outDir && existsSync(outDir) && statSync(outDir).isDirectory()) writeFileSync(join(outDir, 'bari-self-test.json'), text)
  } catch {
    /* fall through to stdout */
  }
  process.stdout.write(text + '\n')
  process.exit(2)
}

export async function runSelfTest(outDir: string | undefined, demoPath: string, uiSmoke?: () => Promise<string>): Promise<number> {
  const steps: { step: string; ok: boolean; detail?: string }[] = []
  const work = mkdtempSync(join(tmpdir(), 'bari-selftest-'))
  const check = (step: string, ok: boolean, detail?: string) => {
    steps.push({ step, ok, detail })
    // Progress on stdout so CI logs show exactly where a run stops.
    process.stdout.write(`[self-test] ${ok ? 'ok  ' : 'FAIL'} ${step}${detail ? ` — ${detail}` : ''}\n`)
    if (!ok) throw new Error(`${step} failed${detail ? `: ${detail}` : ''}`)
  }
  let code = 0
  try {
    let p = Project.create(work, 'Self test')
    check('create project', existsSync(join(p.dir, 'workspace.sqlite')))
    const src = parseSource(new Uint8Array(readFileSync(demoPath)), 'demo_workbook.xlsx')
    const sheet = src.wb.sheets[0].name
    const mp = previewMapping(p, src, sheet)
    const model = validate(src, { sheetName: sheet, headerRow: 1, participantColumn: mp.suggestion.participantColumn!, eventColumn: mp.suggestion.eventColumn })
    const { datasetVersionId } = commitImport(p, src, model, { authorLabel: 'self-test', carryOverFrom: null })
    const snap = buildSnapshot(p, datasetVersionId)
    check('import synthetic workbook', snap.rows.length === 24 && snap.variables.length === 23, `${snap.rows.length} rows, ${snap.variables.length} columns`)
    const il6 = snap.variables.find((v) => v.header === 'IL6')!
    const spec = { datasetVersionId, visitIds: 'all' as const, participantIds: null, qc: { exclude: ['sample_warning' as const] }, filter: emptyFilter() }
    const sel = computeSelection(snap, spec)
    const view = saveView(p, { name: 'self-test', description: null, metadataVersion: p.metadataVersion(), author: null, spec: { schema: 1, selection: spec, chart: { type: 'distribution', measureKey: il6.key, compareKey: null, groupKey: null, xScale: 'linear', yScale: 'linear', tableColumns: [] }, transformations: [], missingDataPolicy: 'exclude-missing' } })
    const hash = datasetContentHash(p, datasetVersionId)
    p.close()
    p = Project.open(join(work, 'Self test.bariproj'))
    const v2 = getView(p, view.id)!
    const sel2 = computeSelection(buildSnapshot(p, datasetVersionId, v2.metadataVersion), v2.spec.selection)
    check('saved view reproduces after reopen', JSON.stringify(sel2.rows) === JSON.stringify(sel.rows))
    const zipPath = join(work, 'context.zip')
    writeContextExport(p, spec, { variableKeys: [il6.key], confirmedQuasiIdentifiers: [], participantKeyMode: 'project_pseudonym', includeCommentText: false, analysisQuestion: 'self-test' }, v2.metadataVersion, zipPath, null)
    const files = unzipSync(new Uint8Array(readFileSync(zipPath)))
    const manifest = JSON.parse(strFromU8(files['manifest.json']))
    check('context export checksums', manifest.files.every((f: any) => sha256(files[f.name]) === f.sha256))
    const backupPath = join(work, 'backup.zip')
    await createBackup(p, backupPath, null)
    p.close()
    const restored = restoreBackup(backupPath, work, 'Restored')
    const p3 = Project.open(restored.dir)
    check('backup/restore preserves observations', datasetContentHash(p3, datasetVersionId) === hash)
    p3.close()
    if (uiSmoke) check('user interface loads', true, await uiSmoke())
  } catch (e) {
    code = 1
    if (!steps.some((s) => !s.ok)) steps.push({ step: 'unexpected error', ok: false, detail: (e as Error).message })
  } finally {
    // Cleanup is checked too: a temp folder that cannot be removed is a real bug (e.g. read-only files on Windows).
    try {
      removeTree(work)
      check('temporary files removed', true)
    } catch (e) {
      code = 1
      steps.push({ step: 'temporary files removed', ok: false, detail: (e as Error).message })
    }
  }
  const report = { app: 'BARI-CNS Research Workspace', version: APP_VERSION, platform: `${process.platform}-${process.arch}`, at: new Date().toISOString(), ok: code === 0, steps }
  const text = JSON.stringify(report, null, 2)
  if (outDir && existsSync(outDir) && statSync(outDir).isDirectory()) writeFileSync(join(outDir, 'bari-self-test.json'), text)
  else process.stdout.write(text + '\n')
  return code
}
