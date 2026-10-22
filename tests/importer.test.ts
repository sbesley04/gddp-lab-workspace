import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readWorkbook } from '@importer/ooxml'
import { readCsv } from '@importer/csv'
import { buildImportModel, suggestMapping } from '@importer/model'

const fx = (n: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', n)))

function model(file: string, sheet?: string) {
  const wb = readWorkbook(fx(file))
  const s = sheet ? wb.sheets.find((x) => x.name === sheet)! : wb.sheets[0]
  const m = suggestMapping(s)
  return buildImportModel(wb, { sheetName: s.name, headerRow: 1, participantColumn: m.participantColumn!, eventColumn: m.eventColumn })
}

describe('synthetic demo workbook', () => {
  const m = model('demo_workbook.xlsx', 'Synthetic Demo Datasheet')
  const col = (h: string) => m.columns.find((c) => c.header === h)!

  it('reconciles rows, participants, columns and visits', () => {
    expect(m.summary.dataRows).toBe(24)
    expect(m.summary.participants).toBe(24)
    expect(m.summary.columns).toBe(23)
    expect(m.summary.events).toEqual(['Baseline'])
    expect(m.issues.filter((i) => i.severity === 'error')).toEqual([])
  })

  it('preserves the blank column but marks it blank', () => {
    expect(col('LP1_3 (synthetic, unused)').role).toBe('blank')
    expect(m.issues.find((i) => i.code === 'blank_columns')?.count).toBe(1)
  })

  it('decodes the legend', () => {
    const kinds = m.legend!.rules.map((r) => r.kind)
    expect(kinds).toEqual(['mixed_source', 'source', 'source', 'source', 'source', 'identical_sources', 'group_major', 'group_minor', 'qc_sample', 'qc_target', 'qc_both', 'unconfirmed_highlight'])
    expect(m.legend!.rules.find((r) => r.label === 'Red')!.source).toBe('Synthetic Neuropsych Source')
  })

  it('attributes column sources from header font colours', () => {
    expect(col('HVLT T-score').attribution).toMatchObject({ mode: 'whole_column', source: 'Synthetic Neuropsych Source', status: 'legend_exact' })
    expect(col('Age').attribution).toMatchObject({ source: 'Synthetic Scores Source', status: 'legend_exact' })
    expect(col('IL6').attribution).toMatchObject({ source: 'Synthetic Master Dataset', status: 'legend_exact' })
    // default (theme dk1) text is indistinguishable from legend "Black": tentative only
    expect(col('PBMC_Intact').attribution).toMatchObject({ source: 'Synthetic Master Dataset', status: 'legend_tentative' })
    expect(col('Subject_ID').attribution?.mode).toBe('mixed_source')
  })

  it('turns multicoloured rich-text headers into source-attributed aliases', () => {
    const h = col('HVLT Total Recall (raw) / HVLT Sum')
    expect(h.attribution?.mode).toBe('identical_across_sources')
    expect(h.aliases.map((a) => [a.text, a.source])).toEqual([
      ['HVLT Total Recall (raw)', 'Synthetic Scores Source'],
      ['HVLT Sum', 'Synthetic Neuropsych Source']
    ])
  })

  it('maps QC fills: exact, possible (near colour), and unresolved', () => {
    const fc = m.summary.flagCounts
    expect(fc.sample_warning).toBe(6)
    expect(fc.possible_sample_warning).toBe(6)
    expect(fc.target_warning).toBe(2)
    expect(fc.both_warnings).toBe(1)
    expect(fc.unresolved_highlight).toBe(2)
    const possible = m.flags.filter((f) => f.category === 'possible_sample_warning')
    expect(possible.every((f) => f.status === 'needs_review')).toBe(true)
  })

  it('classifies edge values and seeds metadata tentatively', () => {
    const il6 = m.cells[m.columns.indexOf(col('IL6'))]
    expect(il6[2].value).toEqual({ k: 'number', v: 0, raw: '0' })
    expect(m.cells[m.columns.indexOf(col('TNF'))][3].value).toMatchObject({ k: 'censored', bound: 0.5 })
    expect(col('CXCL10').kind).toBe('mixed')
    expect(col('LP1_1 – Protein, CSF (mg/dL)').seeds.unit).toMatchObject({ value: 'mg/dL', status: 'tentative' })
    expect(col('LP1_1 – Protein, CSF (mg/dL)').seeds.specimen).toMatchObject({ value: 'CSF', status: 'tentative' })
    expect(col('IL6').seeds.specimen).toMatchObject({ value: null, status: 'unknown' })
    expect(col('IL6').seeds.unit?.status).toBe('unknown')
    expect(col('Age').quasiIdentifier).toBe(true)
    expect(col('Biological_Sex').quasiIdentifier).toBe(true)
  })

  it('keeps comments as annotations', () => {
    expect(m.annotations.map((a) => a.address).sort()).toEqual(['I1', 'T6'])
    expect(m.annotations.find((a) => a.address === 'I1')!.row).toBeNull()
  })

  it('names border segments from the legend tentatively', () => {
    expect(m.segments.map((s) => s.name)).toEqual(['demographic', 'depression', 'NP', 'LP1', 'Accelevir', 'AQ NULISA'])
    expect(m.segments.every((s) => s.status === 'tentative')).toBe(true)
  })
})

describe('edge-case workbook', () => {
  const m = model('edge_values.xlsx')
  const codes = m.issues.map((i) => i.code)
  it('reports duplicate and blank headers, dates, formulas, ambiguity, mixed types', () => {
    expect(codes).toEqual(expect.arrayContaining(['duplicate_headers', 'blank_headers', 'date_formatted', 'formulas', 'ambiguous_headers', 'mixed_types', 'censored', 'no_legend']))
    const scores = m.columns.filter((c) => c.header === 'Score')
    expect(scores).toHaveLength(2)
    expect(scores[0].key).not.toBe(scores[1].key)
  })
  it('keeps numeric IDs as text and separate visits', () => {
    expect(m.rows.map((r) => r.participantId)).toEqual(['9001', '9002', '9003', '9004', '9005'])
    expect(m.summary.events).toEqual(['Baseline', 'Week 4'])
  })
  it('keeps the blank column and an empty-header column with data', () => {
    expect(m.columns.find((c) => c.header === 'Empty column')!.role).toBe('blank')
    expect(m.columns.find((c) => c.header.startsWith('(blank header'))!.role).toBe('measure')
  })
})

describe('blocking problems', () => {
  it('blocks duplicate participant/event keys without merging', () => {
    const m = model('duplicate_keys.xlsx')
    const e = m.issues.find((i) => i.code === 'duplicate_keys')!
    expect(e.severity).toBe('error')
    expect(e.locations[0]).toContain('rows 2, 4')
    expect(m.rows).toHaveLength(3)
  })
  it('blocks rows with missing identifiers', () => {
    const m = model('missing_ids.xlsx')
    expect(m.issues.find((i) => i.code === 'missing_ids')).toMatchObject({ severity: 'error', locations: ['A3'] })
  })
  it('rejects non-xlsx input with an actionable error', () => {
    expect(() => readWorkbook(new TextEncoder().encode('not a zip'))).toThrow(/not an .xlsx/)
  })
})

describe('csv import', () => {
  it('parses values only and states that formatting is unavailable', () => {
    const wb = readCsv(readFileSync(join(__dirname, 'fixtures', 'demo.csv'), 'utf8'), 'demo')
    const s = wb.sheets[0]
    const mp = suggestMapping(s)
    const m = buildImportModel(wb, { sheetName: s.name, headerRow: 1, participantColumn: mp.participantColumn!, eventColumn: mp.eventColumn }, 'csv')
    expect(m.issues[0].code).toBe('csv_no_formatting')
    expect(m.legend).toBeNull()
    const a = m.cells[2]
    expect(a.map((c) => c.value.k)).toEqual(['number', 'number', 'censored', 'number'])
    expect(m.cells[3][1].value).toEqual({ k: 'missing' })
    expect(m.cells[4][3].value).toEqual({ k: 'missing' })
  })
})
