// MCP server over an in-memory transport, against synthetic data only. Checks that tools agree with the app's
// own selection engine and statistics, that the server is read-only, and that no identifiers or individual values leak.
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Project } from '../src/main/project'
import { commitImport, parseSource, previewMapping, validate } from '../src/main/importService'
import { buildSnapshot } from '../src/main/snapshot'
import { saveView } from '../src/main/views'
import { setQuasiIdentifier } from '../src/main/curation'
import { computeSelection, observationsFor, isUsable } from '@core/selection'
import { describe as describeStats, welchT } from '@core/analysis'
import { emptyFilter } from '@core/types'
import { createServer } from '../src/mcp/server'
import { Workspace } from '../src/mcp/workspace'

let root: string
let writer: Project
let ws: Workspace
let client: Client
const outputs: string[] = []

function importBytes(p: Project, bytes: Uint8Array, name: string) {
  const src = parseSource(bytes, name)
  const sheet = src.wb.sheets[0].name
  const mp = previewMapping(p, src, sheet)
  const model = validate(src, { sheetName: sheet, headerRow: 1, participantColumn: mp.suggestion.participantColumn!, eventColumn: mp.suggestion.eventColumn })
  return commitImport(p, src, model, { authorLabel: 'Test RA', carryOverFrom: null })
}

/** Synthetic two-visit study: Sex recorded at baseline only; Marker rises by about 2 at Month 6. */
function longitudinalCsv(): Uint8Array {
  const lines = ['Subject_ID,Event Name,Sex,Marker,Score']
  for (let i = 1; i <= 12; i++) {
    const id = `SYN-${String(i).padStart(2, '0')}`
    const base = 10 + i * 0.5
    lines.push(`${id},Baseline,${i % 2 ? 'Female' : 'Male'},${base},${i}`)
    if (i !== 12) lines.push(`${id},Month 6,,${base + 2 + (i % 3) * 0.1},${i + 1}`)
  }
  return new TextEncoder().encode(lines.join('\n') + '\n')
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[]; isError?: boolean }
  const text = res.content[0].text
  outputs.push(text)
  return { isError: !!res.isError, text, json: res.isError ? null : JSON.parse(text) }
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'bari-mcp-'))
  writer = Project.create(root, 'MCP Test')
  importBytes(writer, new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'demo_workbook.xlsx'))), 'demo_workbook.xlsx')
  // The app keeps the project open (and locked) while the server reads it.
  ws = Workspace.open(writer.dir)
  const server = createServer(ws, { accessLog: join(writer.dir, 'mcp-access.jsonl') })
  const [a, b] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'test', version: '1' })
  await Promise.all([server.connect(a), client.connect(b)])
})

afterAll(async () => {
  await client.close()
  ws.close()
  writer.close()
  rmSync(root, { recursive: true, force: true })
})

describe('MCP server', () => {
  it('lists tools, resources and the analysis prompt, and sends instructions', async () => {
    const tools = (await client.listTools()).tools.map((t) => t.name)
    expect(tools).toEqual(
      expect.arrayContaining(['get_study_overview', 'search_variables', 'describe_variable', 'cohort_counts', 'summarize', 'compare_groups', 'correlate', 'correlation_matrix', 'principal_components', 'change_between_visits', 'qc_overview', 'list_saved_views'])
    )
    expect((await client.listTools()).tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true)
    const resources = (await client.listResources()).resources.map((r) => r.uri)
    expect(resources).toEqual(expect.arrayContaining(['bari://guide', 'bari://data-dictionary']))
    expect((await client.listPrompts()).prompts.map((p) => p.name)).toContain('exploratory_analysis')
    expect(client.getInstructions()).toMatch(/Missing is never zero/)
  })

  it('opens read-only while the app holds the lock, and refuses writes', () => {
    expect(existsSync(join(writer.dir, '.lock'))).toBe(true)
    expect(() => ws.project.db.run("INSERT INTO meta(key, value) VALUES ('x', 'y')")).toThrow()
  })

  it('gives an overview with visits, groups and the privacy policy', async () => {
    const { json } = await call('get_study_overview')
    expect(json.latest.participants).toBe(24)
    expect(json.latest.visits).toEqual([{ name: 'Baseline', order: expect.any(Number), participants: 24 }])
    expect(json.privacy).toEqual({ mode: 'aggregate', minCellSize: 5 })
    expect(json.latest.measures).toBeGreaterThan(15)
  })

  it('finds variables by fuzzy search and resolves headers to keys', async () => {
    const { json } = await call('search_variables', { query: 'csf glucose' })
    expect(json.variables[0].header).toMatch(/Glucose, CSF/)
    const err = await call('describe_variable', { variable: 'IL-6x' })
    expect(err.isError).toBe(true)
    expect(err.text).toMatch(/Closest/)
  })

  it('describes a variable with censored values and text codes', async () => {
    const { json } = await call('describe_variable', { variable: 'TNF' })
    const b = json.byVisit[0]
    expect(b.censoredValues).toEqual({ '<0.5': 1 })
    expect(b.summary.n).toBe(b.counts.numeric)
    const cx = (await call('describe_variable', { variable: 'CXCL10' })).json
    expect(cx.byVisit[0].textCodes).toEqual({ QNS: 1 })
    const score = (await call('describe_variable', { variable: 'Score' })).json
    expect(score.headerComments[0]).toMatch(/undocumented/)
  })

  it('summarizes exactly as the app selection engine and R-validated statistics do', async () => {
    const snap = buildSnapshot(writer, ws.version().id)
    const il6 = snap.variables.find((v) => v.header === 'IL6')!
    const sel = computeSelection(snap, { datasetVersionId: snap.datasetVersionId, visitIds: 'all', participantIds: null, qc: { exclude: ['sample_warning'] }, filter: emptyFilter() })
    const xs = observationsFor(sel, il6.index).filter(isUsable).flatMap((o) => (o.value.k === 'number' ? [o.value.v] : []))
    const expected = describeStats(xs)
    const { json } = await call('summarize', { variable: 'IL6', qcExclude: ['sample_warning'] })
    expect(json.groups[0].summary.n).toBe(expected.n)
    expect(json.groups[0].summary.mean).toBeCloseTo(expected.mean!, 3)
    expect(json.groups[0].notAnalysed.qcExcluded).toBe(1)
  })

  it('compares groups with the validated Welch test', async () => {
    const snap = buildSnapshot(writer, ws.version().id)
    const sex = snap.variables.find((v) => v.header === 'Biological_Sex')!
    const age = snap.variables.find((v) => v.header === 'Age')!
    const by = (label: string) => snap.rows.filter((r) => snap.values[sex.index][r.index].k !== 'missing' && (snap.values[sex.index][r.index] as { raw: string }).raw === label).map((r) => (snap.values[age.index][r.index] as { v: number }).v)
    const t = welchT(by('Female'), by('Male'))!
    const { json } = await call('compare_groups', { variable: 'Age', groupBy: 'Biological_Sex', visits: ['Baseline'] })
    expect(json.tests.welchT.p).toBeCloseTo(t.p, 2)
    expect(json.groups.map((g: { group: string }) => g.group)).toEqual(['Female', 'Male'])
    expect(json.exploratory).toMatch(/Exploratory/)
  })

  it('suppresses small groups and selections', async () => {
    const tiny = await call('summarize', { variable: 'IL6', where: [{ variable: 'Age', min: 69 }] })
    expect(tiny.isError).toBe(true)
    expect(tiny.text).toMatch(/fewer than 5 participants/)
    const { json } = await call('summarize', { variable: 'IL6', groupBy: 'Dominant hand' })
    for (const g of json.groups) if (typeof g.participants === 'string') expect(g.summary).toMatch(/suppressed/)
  })

  it('withholds extremes for quasi-identifiers and picks up curation made in the app', async () => {
    expect((await call('summarize', { variable: 'Age' })).json.groups[0].summary.min).toMatch(/withheld/)
    const before = (await call('summarize', { variable: 'HVLT T-score' })).json
    expect(typeof before.groups[0].summary.min).toBe('number')
    const snap = buildSnapshot(writer, ws.version().id)
    const hvlt = snap.variables.find((v) => v.header === 'HVLT T-score')!
    setQuasiIdentifier(writer, { datasetVersionId: snap.datasetVersionId, varKey: hvlt.key, value: true, author: 'Test RA', reason: null })
    const after = (await call('summarize', { variable: 'HVLT T-score' })).json
    expect(after.groups[0].summary.min).toMatch(/withheld/)
    expect(after.selection.metadataVersion).toBe(before.selection.metadataVersion + 1)
  })

  it('reports correlation, matrix and PCA without individual data', async () => {
    const c = await call('correlate', { x: 'IL6', y: 'TNF' })
    expect(c.json.correlation.method).toMatch(/Spearman/)
    expect(c.json.pairs.censoredOrText).toBeGreaterThanOrEqual(1)
    const m = await call('correlation_matrix', { variables: ['IL6', 'TNF', 'IFNG', 'CCL2'] })
    expect(m.json.r[0][0]).toBe(1)
    const p = await call('principal_components', { variables: ['IL6', 'TNF', 'CXCL10', 'IFNG', 'CCL2', 'IL10'], groupBy: 'Biological_Sex' })
    expect(p.json.components[0].varianceExplained).toBeGreaterThan(0)
    expect(JSON.stringify(p.json)).not.toMatch(/scores"/)
  })

  it('reuses saved views and reports QC', async () => {
    const snap = buildSnapshot(writer, ws.version().id)
    const il6 = snap.variables.find((v) => v.header === 'IL6')!
    const spec = { datasetVersionId: snap.datasetVersionId, visitIds: 'all' as const, participantIds: null, qc: { exclude: ['sample_warning' as const] }, filter: emptyFilter() }
    saveView(writer, { name: 'IL6 clean', description: null, metadataVersion: writer.metadataVersion(), author: 'Test RA', spec: { schema: 1, selection: spec, chart: { type: 'distribution', measureKey: il6.key, compareKey: null, groupKey: null, xScale: 'linear', yScale: 'linear', tableColumns: [] }, transformations: [], missingDataPolicy: 'exclude-missing' } })
    const v = await call('list_saved_views')
    expect(v.json.views[0]).toMatchObject({ name: 'IL6 clean', measure: 'IL6' })
    expect(JSON.stringify(v.json)).not.toMatch(/Test RA/)
    const s = await call('summarize', { variable: 'IL6', savedView: 'IL6 clean' })
    expect(s.json.selection.qcExcluded).toEqual(['NULISA sample QC warning'])
    const q = await call('qc_overview')
    expect(q.json.byCategory['NULISA sample QC warning'].observations).toBeGreaterThan(0)
  })

  it('handles visits: change between visits, baseline-only covariates and repeated-measure warnings', async () => {
    importBytes(writer, longitudinalCsv(), 'synthetic_longitudinal.csv')
    const overview = (await call('get_study_overview')).json
    expect(overview.latest.visits.map((v: { name: string }) => v.name)).toEqual(['Baseline', 'Month 6'])
    const ch = await call('change_between_visits', { variable: 'Marker', from: 'Baseline', to: 'Month 6', groupBy: 'Sex' })
    expect(ch.json.participantsWithOnlyFrom).toBe(1)
    const female = ch.json.groups.find((g: { group: string }) => g.group === 'Female')
    expect(female.participants).toBe(6)
    expect(female.change.meanChange).toBeCloseTo(2.1, 1)
    const pooled = await call('summarize', { variable: 'Marker', groupBy: 'Sex' })
    expect(pooled.json.warnings.join(' ')).toMatch(/groupFrom/)
    expect(pooled.json.warnings.join(' ')).toMatch(/several visits/)
    const carried = await call('summarize', { variable: 'Marker', groupBy: 'Sex', groupFrom: 'participant', visits: ['Month 6'] })
    expect(carried.json.groups.map((g: { group: string }) => g.group)).toEqual(['Female', 'Male'])
    const badVisit = await call('summarize', { variable: 'Marker', visits: ['Month 12'] })
    expect(badVisit.text).toMatch(/Baseline, Month 6/)
  })

  it('serves the guide and data dictionary', async () => {
    const g = await client.readResource({ uri: 'bari://guide' })
    expect((g.contents[0] as { text: string }).text).toMatch(/Censored/i)
    const d = await client.readResource({ uri: 'bari://data-dictionary' })
    expect((d.contents[0] as { text: string }).text.split('\n')[0]).toMatch(/^key,header/)
  })

  it('never returns participant identifiers, and logs calls without results', () => {
    const all = outputs.join('\n')
    expect(all).not.toMatch(/DEMO-\d+/)
    expect(all).not.toMatch(/SYN-\d+/)
    const log = readFileSync(join(writer.dir, 'mcp-access.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(log.length).toBe(outputs.length)
    expect(log.every((e) => !('result' in e))).toBe(true)
  })
})
