// Phase 1 statistical guardrails (docs/STRATEGY.md): the independence guard shared by the app and the MCP server,
// censoring visibility, and the analysis register. Synthetic data only.
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { Project } from '../src/main/project'
import { commitImport, parseSource, previewMapping, validate } from '../src/main/importService'
import { buildSnapshot } from '../src/main/snapshot'
import { listRegister, recordAnalysis } from '../src/main/register'
import { writeContextExport } from '../src/main/exportService'
import { editVariableMeta } from '../src/main/curation'
import { MIGRATIONS } from '../src/main/db/migrations'
import { computeSelection } from '@core/selection'
import { distributionData, scatterData } from '@core/chartData'
import { analyseDistribution, analyseScatter, analysisFingerprint, buildAnalysisRecord, distributionTests, overlaysAllowed, scatterTests } from '@core/analysisRun'
import { independenceMessage, repeatInfo, repeatInfoOfIds, visitScopeText, visitsOfRows } from '@core/independence'
import { CENSORING_BIAS_THRESHOLD, censoringNote, censoringOf, censoringPercent } from '@core/censoring'
import { classifyValue } from '@core/values'
import { pearson, welchT } from '@core/analysis'
import { emptyFilter, type ChartConfig, type DatasetSnapshot, type SelectionSpec } from '@core/types'

/**
 * Synthetic two-visit study. 14 participants at Baseline, 13 of them again at Month 6. Arm is recorded at both
 * visits. Assay has values below a detection limit ("<0.5"): 2 of 14 at Baseline (14%), 5 of 13 at Month 6 (38%).
 */
function longitudinalCsv(): Uint8Array {
  const lines = ['Subject_ID,Event Name,Arm,Marker,Score,Assay']
  for (let i = 1; i <= 14; i++) {
    const id = `SYN-${String(i).padStart(2, '0')}`
    const arm = i % 2 ? 'A' : 'B'
    const marker = 10 + i * 0.5 + (i % 2 ? 1.5 : 0) + (i % 5) * 0.3
    const score = 3 + i * 0.8 + (i % 3) * 0.7
    lines.push(`${id},Baseline,${arm},${marker},${score},${i <= 2 ? '<0.5' : (0.6 + i * 0.11).toFixed(2)}`)
    if (i !== 14) lines.push(`${id},Month 6,${arm},${marker + 2 + (i % 3) * 0.1},${score + 1},${i <= 5 ? '<0.5' : (0.7 + i * 0.1).toFixed(2)}`)
  }
  return new TextEncoder().encode(lines.join('\n') + '\n')
}

let root: string
let project: Project
let snap: DatasetSnapshot
let versionId: string
const key = (header: string) => snap.variables.find((v) => v.header === header)!.key
const idx = (header: string) => snap.variables.find((v) => v.header === header)!.index
const visitId = (name: string) => snap.visits.find((v) => v.name === name)!.id
const spec = (visits: string[] | 'all'): SelectionSpec => ({ datasetVersionId: versionId, visitIds: visits === 'all' ? 'all' : visits.map(visitId), participantIds: null, qc: { exclude: ['curator_exclusion'] }, filter: emptyFilter() })
const chart = (c: Partial<ChartConfig>): ChartConfig => ({ type: 'distribution', measureKey: null, compareKey: null, groupKey: null, xScale: 'linear', yScale: 'linear', tableColumns: [], ...c })

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'bari-guard-'))
  project = Project.create(root, 'Guardrails')
  const src = parseSource(longitudinalCsv(), 'longitudinal.csv')
  const sheet = src.wb.sheets[0].name
  const mp = previewMapping(project, src, sheet)
  const model = validate(src, { sheetName: sheet, headerRow: 1, participantColumn: mp.suggestion.participantColumn!, eventColumn: mp.suggestion.eventColumn })
  versionId = commitImport(project, src, model, { authorLabel: 'Test RA', carryOverFrom: null }).datasetVersionId
  snap = buildSnapshot(project, versionId)
})
afterAll(() => {
  try {
    project.close()
  } catch {
    /* closed in a test */
  }
  rmSync(root, { recursive: true, force: true })
})

describe('independence guard', () => {
  it('counts participants who contribute more than one observation', () => {
    expect(repeatInfoOfIds(['a', 'b', 'c'])).toEqual({ rows: 3, participants: 3, repeatedParticipants: 0, repeated: false })
    const r = repeatInfoOfIds(['a', 'b', 'a', 'c', 'c', 'c'])
    expect(r).toEqual({ rows: 6, participants: 3, repeatedParticipants: 2, repeated: true })
    expect(independenceMessage(r)).toMatch(/6 observations come from 3 participants: 2 participant\(s\) contribute more than one visit/)
    expect(independenceMessage(repeatInfoOfIds(['a', 'b']))).toBeNull()
  })

  it('describes the visits analysed from the rows, never from a fixed word', () => {
    const all = computeSelection(snap, spec('all'))
    const visits = visitsOfRows(snap, all.rows)
    expect(visits.map((v) => [v.name, v.rows])).toEqual([['Baseline', 14], ['Month 6', 13]])
    expect(visitScopeText(visits)).toBe('observations pooled across 2 visits (Baseline, Month 6)')
    expect(visitScopeText(visitsOfRows(snap, computeSelection(snap, spec(['Month 6'])).rows))).toBe('observations at Month 6')
    expect(repeatInfo(snap, all.rows)).toMatchObject({ rows: 27, participants: 14, repeatedParticipants: 13, repeated: true })
  })

  it('a multi-visit selection cannot produce a test, an interval or a fit', () => {
    const sel = computeSelection(snap, spec('all'))
    const dist = analyseDistribution(distributionData(sel, idx('Marker'), idx('Arm'), 'linear'))
    expect(dist.blocked).toBe(true)
    expect(dist.two).toBeNull()
    expect(dist.many).toBeNull()
    expect(distributionTests(dist)).toEqual([])
    for (const g of dist.groups) {
      // Plain descriptives stay; everything that assumes independent observations is withheld.
      expect(g.d.n).toBeGreaterThan(0)
      expect(g.d.mean).not.toBeNull()
      expect(g.d.median).not.toBeNull()
      expect([g.d.se, g.d.meanCi, g.d.medianCi, g.d.geoMeanCi, g.d.shapiro]).toEqual([null, null, null, null, null])
    }
    const ungrouped = analyseDistribution(distributionData(sel, idx('Marker'), null, 'linear'))
    expect(ungrouped.blocked).toBe(true)
    expect(ungrouped.groups[0].d.shapiro).toBeNull()

    const sdata = scatterData(sel, idx('Score'), idx('Marker'), 'linear', 'linear')
    const sc = analyseScatter(sdata, { xScale: 'linear', yScale: 'linear' })
    expect(sc.blocked).toBe(true)
    expect([sc.pearson, sc.spearman, sc.kendall, sc.fit]).toEqual([null, null, null, null])
    expect(scatterTests(sc, { x: 'Score', y: 'Marker' })).toEqual([])
    expect(overlaysAllowed(sdata.points)).toBe(false)

    // Nothing reaches the register either.
    expect(buildAnalysisRecord({ snapshot: snap, spec: spec('all'), chart: chart({ measureKey: key('Marker'), groupKey: key('Arm') }) })).toBeNull()
    expect(buildAnalysisRecord({ snapshot: snap, spec: spec('all'), chart: chart({ type: 'scatter', measureKey: key('Marker'), compareKey: key('Score') }) })).toBeNull()
  })

  it('restricting to one visit runs the same tests as calling them directly', () => {
    const sel = computeSelection(snap, spec(['Baseline']))
    const data = distributionData(sel, idx('Marker'), idx('Arm'), 'linear')
    const dist = analyseDistribution(data)
    expect(dist.blocked).toBe(false)
    expect(dist.independence).toMatchObject({ rows: 14, participants: 14, repeated: false })
    const a = data.groups[0].points.map((p) => p.value)
    const b = data.groups[1].points.map((p) => p.value)
    expect(dist.two!.t).toEqual(welchT(a, b))
    expect(dist.groups[0].d.meanCi).not.toBeNull()
    const sdata = scatterData(sel, idx('Score'), idx('Marker'), 'linear', 'linear')
    const sc = analyseScatter(sdata, { xScale: 'linear', yScale: 'linear' })
    expect(sc.blocked).toBe(false)
    expect(sc.pearson).toEqual(pearson(sdata.points.map((p) => p.x), sdata.points.map((p) => p.y)))
    expect(overlaysAllowed(sdata.points)).toBe(true)
  })
})

describe('censoring visibility', () => {
  it('counts censored values by direction and never substitutes', () => {
    const c = censoringOf(['<0.5', '≤1', '>90', '2', '3', '4', '', 'QNS'].map(classifyValue))
    expect(c).toMatchObject({ numeric: 3, censored: 3, below: 2, above: 1, fraction: 0.5, biased: true })
    expect(censoringPercent(c)).toBe('50%')
    expect(censoringOf([]).fraction).toBeNull()
    expect(censoringNote(censoringOf(['1', '2'].map(classifyValue)), 'X')).toBeNull()
  })

  it('reports percent censored per group and marks mean-based statistics above the threshold', () => {
    const base = distributionData(computeSelection(snap, spec(['Baseline'])), idx('Assay'), null, 'linear').groups[0]
    expect(base.censoring).toMatchObject({ numeric: 12, censored: 2, below: 2, above: 0 })
    expect(base.censoring.fraction).toBeCloseTo(2 / 14, 12)
    expect(base.censoring.fraction!).toBeLessThan(CENSORING_BIAS_THRESHOLD)
    expect(base.censoring.biased).toBe(false)
    expect(censoringNote(base.censoring, 'Assay')).toMatch(/14% of measured values are censored \(2 of 14, below a detection limit\).*biased upward/)
    // The summary is computed from the 12 numeric values only: no bound was used.
    expect(base.summary.n).toBe(12)
    expect(base.summary.min!).toBeGreaterThan(0.5)

    const m6 = distributionData(computeSelection(snap, spec(['Month 6'])), idx('Assay'), idx('Arm'), 'linear')
    const total = m6.groups.reduce((n, g) => n + g.censoring.censored, 0)
    expect(total).toBe(5)
    const whole = distributionData(computeSelection(snap, spec(['Month 6'])), idx('Assay'), null, 'linear').groups[0]
    expect(whole.censoring.biased).toBe(true)
    expect(censoringNote(whole.censoring, 'Assay')).toMatch(/38% .*above 15%, so the mean and SD are biased upward; prefer the median and the detection rate/)

    const sc = scatterData(computeSelection(snap, spec(['Month 6'])), idx('Assay'), idx('Marker'), 'linear', 'linear')
    expect(sc.censoring.x).toMatchObject({ censored: 5, numeric: 8, biased: true })
    expect(sc.censoring.y.censored).toBe(0)
  })
})

describe('analysis register', () => {
  const dist = () => chart({ measureKey: key('Marker'), groupKey: key('Arm') })
  const scat = () => chart({ type: 'scatter', measureKey: key('Marker'), compareKey: key('Score') })

  it('records nothing when the guard blocks the analysis', () => {
    const r = recordAnalysis(project, { spec: spec('all'), chart: dist(), metadataVersion: snap.metadataVersion, author: 'Test RA' })
    expect(r).toMatchObject({ recorded: false, tests: 0, fingerprint: null, totals: { analyses: 0, tests: 0 } })
  })

  it('recomputes in the main process, records each distinct analysis once and counts p-values', () => {
    const s = spec(['Baseline'])
    const first = recordAnalysis(project, { spec: s, chart: dist(), metadataVersion: snap.metadataVersion, author: 'Test RA' })
    expect(first.recorded).toBe(true)
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    // Two Shapiro–Wilk checks, Welch t and Mann–Whitney.
    expect(first.tests).toBe(4)
    // Display settings and the editor's filter ids are not part of the analysis.
    const sameAgain = recordAnalysis(project, { spec: { ...s, filter: { ...emptyFilter(), id: 'another-id' } }, chart: { ...dist(), yMin: 0, yMax: 50, analysis: { requested: true, fitLine: true, confidenceBand: false, predictionBand: false, meanCi: true } }, metadataVersion: snap.metadataVersion, author: 'Someone else' })
    expect(sameAgain).toMatchObject({ recorded: false, tests: 4, fingerprint: first.fingerprint, totals: { analyses: 1, tests: 4 } })

    const second = recordAnalysis(project, { spec: s, chart: scat(), metadataVersion: snap.metadataVersion, author: 'Test RA' })
    expect(second.recorded).toBe(true)
    expect(second.totals).toEqual({ analyses: 2, tests: 4 + second.tests })
    const third = recordAnalysis(project, { spec: spec(['Month 6']), chart: scat(), metadataVersion: snap.metadataVersion, author: null })
    expect(third.recorded).toBe(true)
    expect(third.fingerprint).not.toBe(second.fingerprint)

    const list = listRegister(project)
    expect(list.totals.analyses).toBe(3)
    expect(list.entries.map((e) => e.title)).toEqual(['Marker vs Score', 'Marker vs Score', 'Marker by Arm'])
    const rec = list.entries[2].record
    expect(rec.selection).toMatchObject({ visits: ['Baseline'], rows: 14, participants: 14 })
    expect(rec.analysed).toEqual({ rows: 14, participants: 14, visits: ['Baseline'] })
    // The stored result is what the core functions give for the same selection.
    const data = distributionData(computeSelection(snap, s), idx('Marker'), idx('Arm'), 'linear')
    const t = welchT(data.groups[0].points.map((p) => p.value), data.groups[1].points.map((p) => p.value))!
    const stored = rec.tests.find((x) => x.test === "Welch's t")!
    expect(stored.p).toBe(t.p)
    expect(stored.value).toBe(t.t)
    expect(stored.n).toBe(14)
    // No participant identifiers anywhere in the register.
    expect(JSON.stringify(list)).not.toMatch(/SYN-\d\d/)
    const audit = project.db.all<any>("SELECT action, detail_json, author_label FROM audit_log WHERE action = 'analysis.compute'")
    expect(audit).toHaveLength(3)
    expect(JSON.parse(audit[0].detail_json)).toMatchObject({ fingerprint: first.fingerprint, tests: 4 })
  })

  it('fingerprints change with anything that decides the numbers', () => {
    const s = spec(['Baseline'])
    const fp = (sp: SelectionSpec, c: ChartConfig, sn = snap) => analysisFingerprint(sn, sp, c)
    const base = fp(s, scat())
    expect(fp(s, { ...scat(), xMin: 1, colorKey: key('Arm') })).toBe(base)
    expect(fp(spec(['Month 6']), scat())).not.toBe(base)
    expect(fp({ ...s, qc: { exclude: [] } }, scat())).not.toBe(base)
    expect(fp(s, { ...scat(), transformMeasure: 'log10' })).not.toBe(base)
    expect(fp(s, { ...scat(), xScale: 'log' })).not.toBe(base) // Pearson and the fit use log10 values
    expect(fp(s, { ...dist(), yScale: 'log' })).toBe(fp(s, dist())) // a log axis changes nothing for a distribution
    expect(fp(s, scat(), { ...snap, metadataVersion: snap.metadataVersion + 1 })).not.toBe(base)
    const cond = (id: string) => ({ ...emptyFilter(), children: [{ type: 'cond' as const, id, variableKey: key('Arm'), test: { kind: 'in' as const, values: ['A'] }, onMissing: 'exclude' as const }] })
    expect(fp({ ...s, filter: cond('x1') }, scat())).toBe(fp({ ...s, filter: cond('x2') }, scat()))
    expect(fp({ ...s, filter: cond('x1') }, scat())).not.toBe(base)
  })

  it('records a later curation state as a new analysis', () => {
    const s = spec(['Baseline'])
    const before = listRegister(project).totals.analyses
    editVariableMeta(project, { datasetVersionId: versionId, varKey: key('Marker'), field: 'unit', value: 'pg/mL', status: 'tentative', author: 'Test RA', reason: null })
    const r = recordAnalysis(project, { spec: s, chart: scat(), metadataVersion: project.metadataVersion(), author: null })
    expect(r.recorded).toBe(true)
    expect(r.totals.analyses).toBe(before + 1)
    expect(() => recordAnalysis(project, { spec: s, chart: scat(), metadataVersion: project.metadataVersion() + 5, author: null })).toThrow(/newer/)
  })

  it('is append-only', () => {
    expect(() => project.db.run("UPDATE analysis_register SET title = 'edited'")).toThrow(/append-only/)
    expect(() => project.db.run('DELETE FROM analysis_register')).toThrow(/append-only/)
  })

  it('goes into the context package: counts for everything, details only for exported variables', () => {
    const s = spec(['Baseline'])
    const dest = join(root, 'context.zip')
    const opts = { variableKeys: [key('Marker'), key('Score')], confirmedQuasiIdentifiers: [] as string[], participantKeyMode: 'project_pseudonym' as const, includeCommentText: false, analysisQuestion: '' }
    writeContextExport(project, s, opts, project.metadataVersion(), dest, null)
    const files = unzipSync(new Uint8Array(readFileSync(dest)))
    const reg = JSON.parse(strFromU8(files['analysis_register.json']))
    const total = listRegister(project, { datasetVersionId: versionId })
    expect(reg.totals).toEqual({ analyses: total.totals.analyses, pValues: total.totals.tests })
    // "Marker by Arm" uses Arm, which is not exported: counted, not listed.
    expect(reg.notListed.analyses).toBe(1)
    expect(reg.analyses.map((a: any) => a.title)).toEqual(['Marker vs Score', 'Marker vs Score', 'Marker vs Score'])
    expect(reg.analyses.every((a: any) => !('groups' in a) && !('censoring' in a))).toBe(true)
    expect(reg.analyses[0].tests[0]).toMatchObject({ test: "Pearson's r", statistic: 't' })
    const manifest = JSON.parse(strFromU8(files['manifest.json']))
    expect(manifest.analysisRegister).toMatchObject({ file: 'analysis_register.json', analyses: reg.totals.analyses, listed: 3 })
    expect(strFromU8(files['study_context.md'])).toContain(`already computed in the app on this dataset version: ${reg.totals.analyses} (${reg.totals.pValues} p-values`)
    expect(strFromU8(files['analysis_register.json'])).not.toMatch(/SYN-\d\d/)
  })
})

describe('schema upgrade', () => {
  it('keeps a copy of the database before migrating an existing project', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bari-migrate-'))
    try {
      const p = Project.create(dir, 'Old schema')
      const folder = p.dir
      p.close()
      // Put the project back to the previous schema, as an older app version would have left it.
      const raw = new DatabaseSync(join(folder, 'workspace.sqlite'))
      raw.exec('DROP TABLE analysis_register')
      raw.prepare('DELETE FROM schema_migrations WHERE version = ?').run(MIGRATIONS.length)
      raw.close()
      const copy = join(folder, `workspace.sqlite.before-schema-${MIGRATIONS.length}.bak`)
      expect(existsSync(copy)).toBe(false)
      const reopened = Project.open(folder)
      expect(existsSync(copy)).toBe(true)
      expect(listRegister(reopened).totals).toEqual({ analyses: 0, tests: 0 })
      reopened.close()
      const old = new DatabaseSync(copy, { readOnly: true })
      expect((old.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as any).v).toBe(MIGRATIONS.length - 1)
      old.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
