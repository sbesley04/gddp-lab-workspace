// Chart file writing: the main process rebuilds the analysis log, settings and fingerprint from the selection and
// chart settings (only the drawn image comes from the renderer), checks formats, and overwrites nothing else.
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Project } from '../src/main/project'
import { commitImport, parseSource, previewMapping, validate } from '../src/main/importService'
import { buildSnapshot } from '../src/main/snapshot'
import { CHART_SETTINGS_SCHEMA, chartRecord, writeChartFiles } from '../src/main/exportService'
import { APP_VERSION } from '../src/main/version'
import { buildProvenance, shortFingerprint } from '@core/provenance'
import { computeSelection } from '@core/selection'
import { emptyFilter, type ChartConfig, type SelectionSpec } from '@core/types'

let root: string
let project: Project
let spec: SelectionSpec
let chart: ChartConfig
let short: string
const svgWith = (stamp: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text>analysis ${stamp} · dataset v1</text></svg>`

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'bari-chart-'))
  project = Project.create(root, 'Charts')
  const src = parseSource(new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'demo_workbook.xlsx'))), 'demo_workbook.xlsx')
  const sheet = src.wb.sheets[0].name
  const mp = previewMapping(project, src, sheet)
  const model = validate(src, { sheetName: sheet, headerRow: 1, participantColumn: mp.suggestion.participantColumn!, eventColumn: mp.suggestion.eventColumn })
  const id = commitImport(project, src, model, { authorLabel: 'Test RA', carryOverFrom: null }).datasetVersionId
  const snap = buildSnapshot(project, id)
  spec = { datasetVersionId: id, visitIds: 'all', participantIds: null, qc: { exclude: ['curator_exclusion'] }, filter: emptyFilter() }
  chart = { type: 'distribution', measureKey: snap.variables.find((v) => v.header === 'IL6')!.key, compareKey: null, groupKey: null, xScale: 'linear', yScale: 'linear', tableColumns: [] }
  short = shortFingerprint(chartRecord(project, { spec, chart, metadataVersion: project.metadataVersion() }).provenance.fingerprint)
})
afterAll(() => {
  project.close()
  rmSync(root, { recursive: true, force: true })
})
const context = () => ({ spec, chart, metadataVersion: project.metadataVersion() })

describe('writeChartFiles', () => {
  it('builds the settings, log and fingerprint itself, and leaves other files alone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bari-chart-out-'))
    writeFileSync(join(dir, 'IL6.R'), 'my own script')
    writeFileSync(join(dir, 'IL6.json'), '{"mine":true}')
    const r = writeChartFiles(project, { format: 'svg', data: svgWith(short), sidecars: true, stamped: short, context: context() }, join(dir, 'IL6.svg'), 'Test RA')
    expect(r.files).toEqual(['IL6.svg', 'IL6.chart.json', 'IL6.analysis-log.R'])
    expect(readFileSync(join(dir, 'IL6.R'), 'utf8')).toBe('my own script')
    expect(readFileSync(join(dir, 'IL6.json'), 'utf8')).toBe('{"mine":true}')
    expect(readdirSync(dir).sort()).toEqual(['IL6.R', 'IL6.analysis-log.R', 'IL6.chart.json', 'IL6.json', 'IL6.svg'])
    // What was written is what the core gives for this selection, computed in this process.
    const snap = buildSnapshot(project, spec.datasetVersionId)
    const expected = buildProvenance({ snapshot: snap, spec, chart, sel: computeSelection(snap, spec), appVersion: APP_VERSION })
    expect(r.fingerprint).toBe(expected.fingerprint)
    expect(r.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(readFileSync(join(dir, 'IL6.analysis-log.R'), 'utf8')).toBe(expected.text)
    const settings = JSON.parse(readFileSync(join(dir, 'IL6.chart.json'), 'utf8'))
    expect(settings).toMatchObject({ schema: CHART_SETTINGS_SCHEMA, fingerprint: expected.fingerprint, selection: spec, dataset: { versionNumber: 1, metadataVersion: snap.metadataVersion } })
    expect(settings.steps.map((s: { fingerprint: string }) => s.fingerprint)).toEqual(expected.steps.map((s) => s.fingerprint))
    expect(settings.chart.style).toBeTruthy() // defaults filled in, so the look can be reproduced
    expect(JSON.stringify(settings)).not.toMatch(/DEMO-\d\d/)
    // The export record and the audit entry carry the same full fingerprint.
    const rec = project.db.get<{ manifest_json: string }>("SELECT manifest_json FROM export_record WHERE kind = 'chart' ORDER BY created_at DESC LIMIT 1")!
    expect(JSON.parse(rec.manifest_json).fingerprint).toBe(expected.fingerprint)
    const audit = project.db.get<{ detail_json: string }>("SELECT detail_json FROM audit_log WHERE action = 'export.chart' ORDER BY id DESC LIMIT 1")!
    expect(JSON.parse(audit.detail_json).fingerprint).toBe(expected.fingerprint)
  })

  it('refuses an image whose footer does not match the selection it is saved with', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bari-chart-out-'))
    // The renderer claims a fingerprint this process does not compute for the selection.
    expect(() => writeChartFiles(project, { format: 'svg', data: svgWith('deadbeef'), sidecars: true, stamped: 'deadbeef', context: context() }, join(dir, 'a.svg'), null)).toThrow(/does not match the selection/)
    // The claim is right but the image carries something else.
    expect(() => writeChartFiles(project, { format: 'svg', data: svgWith('deadbeef'), sidecars: true, stamped: short, context: context() }, join(dir, 'b.svg'), null)).toThrow(/footer does not carry/)
    expect(() => writeChartFiles(project, { format: 'png', data: 'data:image/png;base64,AA==', stamped: 'deadbeef', context: context() }, join(dir, 'c.png'), null)).toThrow(/does not match the selection/)
    // A different selection gives a different fingerprint, so a stale image is caught.
    const other = { ...context(), spec: { ...spec, qc: { exclude: [] } } }
    expect(() => writeChartFiles(project, { format: 'svg', data: svgWith(short), stamped: short, context: other }, join(dir, 'd.svg'), null)).toThrow(/does not match the selection/)
    expect(readdirSync(dir)).toEqual([])
  })

  it('rejects data that does not match the format', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bari-chart-out-'))
    expect(() => writeChartFiles(project, { format: 'svg', data: '<html>' }, join(dir, 'x.svg'), null)).toThrow('not SVG')
    expect(() => writeChartFiles(project, { format: 'png', data: 'data:text/plain;base64,AA==' }, join(dir, 'x.png'), null)).toThrow('not a PNG')
    expect(() => writeChartFiles(project, { format: 'svg', data: svgWith(short), context: { ...context(), metadataVersion: project.metadataVersion() + 9 } }, join(dir, 'y.svg'), null)).toThrow(/newer/)
  })

  it('writes the analysis log on its own from the selection, ignoring any text it is sent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bari-chart-out-'))
    const r = writeChartFiles(project, { format: 'r', data: '# not what the app did', sidecars: true, context: context() }, join(dir, 'log.R'), null)
    expect(r.files).toEqual(['log.R'])
    const text = readFileSync(join(dir, 'log.R'), 'utf8')
    expect(text).not.toContain('not what the app did')
    expect(text).toContain(`# chain fingerprint: ${r.fingerprint}`)
    expect(() => writeChartFiles(project, { format: 'r', data: '# log' }, join(dir, 'none.R'), null)).toThrow(/needs the selection/)
    expect(existsSync(join(dir, 'none.R'))).toBe(false)
  })

  it('writes an image with no single selection (a Compare board) without sidecars or a fingerprint', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bari-chart-out-'))
    const r = writeChartFiles(project, { format: 'svg', data: svgWith('board'), sidecars: true }, join(dir, 'board.svg'), null)
    expect(r).toEqual({ fileName: 'board.svg', files: ['board.svg'], fingerprint: null })
  })
})
