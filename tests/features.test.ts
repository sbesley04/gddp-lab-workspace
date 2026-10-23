// View naming, backwards-compatible chart configs, IPC schema validation and compare boards.
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, describe, expect, it } from 'vitest'
import { suggestViewName } from '@core/naming'
import { normalizeChart, STYLE_PRESETS } from '@core/chartStyle'
import { emptyFilter, type ChartConfig } from '@core/types'
import { savedViewSpec, schemas } from '@shared/ipc'
import { Project } from '../src/main/project'
import { commitImport, parseSource, previewMapping, validate } from '../src/main/importService'
import { buildSnapshot } from '../src/main/snapshot'
import { saveBoard, getBoard, listBoards, deleteBoard } from '../src/main/boards'

const root = mkdtempSync(join(tmpdir(), 'bari-feat-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function demo() {
  const p = Project.create(root, `Demo ${Math.random().toString(36).slice(2, 6)}`)
  const src = parseSource(new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'demo_workbook.xlsx'))), 'demo.xlsx')
  const sheet = src.wb.sheets[0].name
  const mp = previewMapping(p, src, sheet)
  const { datasetVersionId } = commitImport(p, src, validate(src, { sheetName: sheet, headerRow: 1, participantColumn: mp.suggestion.participantColumn!, eventColumn: mp.suggestion.eventColumn }), { authorLabel: null, carryOverFrom: null })
  return { p, snap: buildSnapshot(p, datasetVersionId) }
}

const oldChart: ChartConfig = { type: 'scatter', measureKey: 'a', compareKey: 'b', groupKey: null, xScale: 'linear', yScale: 'log', tableColumns: [] }

describe('suggested view names', () => {
  const { p, snap } = demo()
  const key = (h: string) => snap.variables.find((v) => v.header === h)!.key
  it('describes measures, filters, QC exclusions and visit', () => {
    const name = suggestViewName(
      snap,
      { ...oldChart, measureKey: key('IL6'), compareKey: key('PHQ-9 total score'), yScale: 'linear' },
      { ...emptyFilter(), children: [{ type: 'cond', id: 'c', variableKey: key('Age'), test: { kind: 'range', min: 40, max: null }, onMissing: 'exclude' }] },
      ['sample_warning', 'curator_exclusion'],
      'all'
    )
    expect(name).toBe('IL6 vs PHQ-9 total score · Age ≥ 40 · excl. sample QC · baseline')
  })
  it('names grouped distributions', () => {
    expect(suggestViewName(snap, { ...oldChart, type: 'distribution', measureKey: key('IL6'), groupKey: key('Biological_Sex'), yScale: 'linear' }, emptyFilter(), ['curator_exclusion'], 'all')).toBe('IL6 by Biological_Sex · baseline')
  })
  p.close()
})

describe('chart configs from earlier releases', () => {
  it('fill new fields with defaults and keep old ones', () => {
    const c = normalizeChart(oldChart)
    expect(c.yScale).toBe('log')
    expect(c.xMin).toBeNull()
    expect(c.style).toEqual(STYLE_PRESETS.glass.style)
    expect(c.analysis.requested).toBe(false)
  })
  it('IPC schema accepts old and new saved-view specs, and rejects bad styles', () => {
    const base = { schema: 1, selection: { datasetVersionId: 'v', visitIds: 'all', filter: emptyFilter(), qc: { exclude: [] }, participantIds: null }, transformations: [], missingDataPolicy: 'x' }
    expect(savedViewSpec.safeParse({ ...base, chart: oldChart }).success).toBe(true)
    expect(savedViewSpec.safeParse({ ...base, chart: normalizeChart(oldChart) }).success).toBe(true)
    expect(savedViewSpec.safeParse({ ...base, chart: { ...normalizeChart(oldChart), style: { ...STYLE_PRESETS.glass.style, pointColor: 'javascript:alert(1)' } } }).success).toBe(false)
    expect(schemas['boards:save'].safeParse({ id: null, name: 'B', layout: { cards: [{ id: 'x', kind: 'view', viewId: 'v', x: 0, y: 0, w: 50, h: 300, text: null, style: null }], boardStyle: null, grid: 20 } }).success).toBe(false) // too narrow
  })
})

describe('compare boards', () => {
  it('create, update, list, survive reopen, delete', () => {
    const { p } = demo()
    const layout = { cards: [{ id: 'c1', kind: 'note', viewId: null, x: 40, y: 40, w: 320, h: 220, text: 'hello', style: null }], boardStyle: null, grid: 20 }
    const b = saveBoard(p, { id: null, name: 'First board', layout, author: 'T' })
    saveBoard(p, { id: b.id, name: 'Renamed', layout: { ...layout, cards: [{ ...layout.cards[0], x: 200 }] }, author: 'T' })
    const dir = p.dir
    p.close()
    const p2 = Project.open(dir)
    const got = getBoard(p2, b.id)!
    expect(got.name).toBe('Renamed')
    expect((got.layout as any).cards[0].x).toBe(200)
    expect(listBoards(p2)).toHaveLength(1)
    deleteBoard(p2, b.id, null)
    expect(listBoards(p2)).toHaveLength(0)
    p2.close()
  })
})
