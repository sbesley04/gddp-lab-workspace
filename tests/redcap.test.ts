// REDCap file import: the record export imports like any CSV (its identifier and event columns are recognised), and a
// data dictionary fills in labels, definitions, forms and identifier flags as tentative metadata. Synthetic only.
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Project } from '../src/main/project'
import { commitImport, parseSource, previewMapping, validate } from '../src/main/importService'
import { buildSnapshot } from '../src/main/snapshot'
import { editVariableMeta, history, setQuasiIdentifier } from '../src/main/curation'
import { applyDictionary, planFor, readDictionary } from '../src/main/dictionary'
import { verifyIntegrity } from '../src/main/integrity'
import { DictionaryError, describeField, parseChoices, parseRedcapDictionary } from '@core/redcapDictionary'

const enc = (s: string) => new TextEncoder().encode(s)

// A record export as REDCap writes it ("raw" column names), two events, a checkbox field as one column per option.
const RECORDS = [
  'record_id,redcap_event_name,age,sex,phq_total,meds___1,meds___2,site_notes,il6',
  '1,baseline_arm_1,54,1,7,1,0,,2.5',
  '2,baseline_arm_1,61,2,12,0,1,seen late,3.1',
  '3,baseline_arm_1,47,1,3,0,0,,<0.5',
  '1,month_6_arm_1,55,1,5,1,0,,2.9',
  '2,month_6_arm_1,62,2,9,0,1,,'
].join('\n') + '\n'

const DICTIONARY = [
  '"Variable / Field Name","Form Name","Section Header","Field Type","Field Label","Choices, Calculations, OR Slider Labels","Field Note","Text Validation Type OR Show Slider Number","Text Validation Min","Text Validation Max",Identifier?,"Branching Logic (Show field only if...)","Required Field?","Custom Alignment","Question Number (surveys only)","Matrix Group Name","Matrix Ranking?","Field Annotation"',
  'record_id,demographics,,text,"Record ID",,,,,,,,,,,,,',
  'age,demographics,,text,"Age at enrolment",,"In completed years",integer,18,90,y,,,,,,,',
  'sex,demographics,,radio,"Sex recorded at birth","1, Female | 2, Male | 3, Not recorded",,,,,,,,,,,,',
  'intro,phq9,,descriptive,"<p>Over the last two weeks, how often have you been bothered by the following?</p>",,,,,,,,,,,,,',
  'phq_total,phq9,,calc,"PHQ-9 <b>total</b> score","sum([phq1],[phq2])",,,,,,,,,,,,',
  'meds,medication_review,,checkbox,"Current medication","1, Antidepressant | 2, Statin, any dose",,,,,,,,,,,,',
  'site_notes,medication_review,,notes,"Notes from the site coordinator about anything unusual that happened during this visit and that the analysis team should be told about",,,,,,y,,,,,,,',
  'not_exported,medication_review,,text,"A field that is not in the export",,,,,,,,,,,,,'
].join('\n') + '\n'

let root: string
let project: Project
let versionId: string
const snap = () => buildSnapshot(project, versionId)
const v = (header: string) => snap().variables.find((x) => x.header === header)!

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'bari-redcap-'))
  project = Project.create(root, 'REDCap')
  const src = parseSource(enc(RECORDS), 'synthetic_redcap_export.csv')
  const sheet = src.wb.sheets[0].name
  const mp = previewMapping(project, src, sheet)
  // REDCap's own column names are recognised without the researcher choosing them.
  expect(mp.suggestion).toMatchObject({ participantColumn: 1, eventColumn: 2, basis: 'heuristic' })
  const model = validate(src, { sheetName: sheet, headerRow: 1, participantColumn: mp.suggestion.participantColumn!, eventColumn: mp.suggestion.eventColumn })
  versionId = commitImport(project, src, model, { authorLabel: 'Test RA', carryOverFrom: null }).datasetVersionId
})
afterAll(() => {
  project.close()
  rmSync(root, { recursive: true, force: true })
})

describe('REDCap record export', () => {
  it('imports with participants and events from record_id and redcap_event_name', () => {
    const s = snap()
    expect(s.visits.map((x) => x.name)).toEqual(['baseline_arm_1', 'month_6_arm_1'])
    expect(new Set(s.rows.map((r) => r.participantId))).toEqual(new Set(['1', '2', '3']))
    expect(s.variables.filter((x) => x.role === 'measure').map((x) => x.header)).toEqual(['age', 'sex', 'phq_total', 'meds___1', 'meds___2', 'site_notes', 'il6'])
  })
})

describe('REDCap data dictionary', () => {
  it('reads choices, including labels that contain commas', () => {
    expect(parseChoices('1, Female | 2, Male | 3, Not recorded')).toEqual([{ code: '1', label: 'Female' }, { code: '2', label: 'Male' }, { code: '3', label: 'Not recorded' }])
    expect(parseChoices('1, Antidepressant | 2, Statin, any dose')[1]).toEqual({ code: '2', label: 'Statin, any dose' })
    expect(parseChoices('')).toEqual([])
  })

  it('parses the downloaded dictionary and the API column names, and refuses other files', () => {
    const fields = readDictionary(enc(DICTIONARY)).fields
    expect(fields.map((f) => f.name)).toEqual(['record_id', 'age', 'sex', 'intro', 'phq_total', 'meds', 'site_notes', 'not_exported'])
    expect(fields.find((f) => f.name === 'age')).toMatchObject({ form: 'demographics', type: 'text', label: 'Age at enrolment', note: 'In completed years', min: '18', max: '90', identifier: true })
    expect(fields.find((f) => f.name === 'phq_total')).toMatchObject({ label: 'PHQ-9 total score', calculation: 'sum([phq1],[phq2])', choices: [] }) // HTML removed
    expect(fields.find((f) => f.name === 'sex')!.choices).toHaveLength(3)
    const api = parseRedcapDictionary([['field_name', 'form_name', 'field_type', 'field_label', 'select_choices_or_calculations', 'identifier'], ['a', 'f', 'yesno', 'A?', '', 'y'], ['a', 'f', 'text', 'duplicate name is ignored', '', '']])
    expect(api).toEqual([expect.objectContaining({ name: 'a', type: 'yesno', identifier: true })])
    expect(() => readDictionary(enc(RECORDS))).toThrow(DictionaryError)
    expect(() => readDictionary(enc('"Variable / Field Name","Field Type","Field Label"\n'))).toThrow(/lists no fields/)
    // A byte-order mark, and a file saved as Windows-1252 with an accented letter.
    expect(readDictionary(enc('﻿' + DICTIONARY)).fields).toHaveLength(8)
    const latin1 = Uint8Array.from([...'"Variable / Field Name","Field Type","Field Label"\nx,text,"Caf'].map((c) => c.charCodeAt(0)).concat([0xe9, 0x22, 0x0a]))
    expect(readDictionary(latin1).fields[0].label).toBe('Café')
  })

  it('describes a field without inventing a unit', () => {
    const fields = readDictionary(enc(DICTIONARY)).fields
    const age = describeField(fields.find((f) => f.name === 'age')!, null)
    expect(age).toEqual({ source: 'REDCap', displayLabel: 'Age at enrolment', area: 'Demographics', definition: 'Age at enrolment. Note: In completed years. Allowed range in REDCap: 18 to 90.' })
    expect('unit' in age).toBe(false)
    expect(describeField(fields.find((f) => f.name === 'sex')!, null).definition).toBe('Sex recorded at birth. Coded as 1 = Female; 2 = Male; 3 = Not recorded.')
    expect(describeField(fields.find((f) => f.name === 'meds')!, '2')).toMatchObject({ displayLabel: 'Current medication: Statin, any dose', area: 'Medication review', definition: 'Current medication: Statin, any dose. Checkbox option: 1 = ticked, 0 = not ticked.' })
    // A long question is kept as the definition, not squeezed into the label.
    const notes = describeField(fields.find((f) => f.name === 'site_notes')!, null)
    expect(notes.displayLabel).toBeUndefined()
    expect(notes.definition).toMatch(/^Notes from the site coordinator/)
  })

  it('plans changes for the measures it describes and lists what it leaves alone', () => {
    const dict = readDictionary(enc(DICTIONARY))
    const plan = planFor(project, versionId, dict)
    expect(plan).toMatchObject({ fields: 8, matched: 6, undescribedMeasures: 1, unmatchedFieldCount: 3 })
    expect(plan.unmatchedFields).toEqual(['record_id', 'intro', 'not_exported'])
    expect(plan.kept).toEqual([])
    // The importer already flags a column called "age"; the dictionary adds the free-text field it marks as an identifier.
    expect(v('age').quasiIdentifier).toBe(true)
    expect(plan.quasiIdentifiers).toEqual([{ varKey: v('site_notes').key, header: 'site_notes' }])
    const of = (header: string) => Object.fromEntries(plan.changes.filter((c) => c.header === header).map((c) => [c.field, c.to]))
    expect(of('phq_total')).toEqual({ displayLabel: 'PHQ-9 total score', area: 'Phq9', definition: 'PHQ-9 total score. Calculated in REDCap: sum([phq1],[phq2])', source: 'REDCap' })
    expect(of('meds___1').displayLabel).toBe('Current medication: Antidepressant')
    expect(of('il6')).toEqual({}) // not in the dictionary
    expect(plan.changes.some((c) => c.field === 'unit' || c.field === 'specimen' || c.field === 'assay')).toBe(false)
  })

  it('records the values as tentative revisions, keeps what a curator set, and is safe to repeat', () => {
    const dict = readDictionary(enc(DICTIONARY))
    // A curator has already named one measure and decided that sex is not to be flagged.
    editVariableMeta(project, { datasetVersionId: versionId, varKey: v('phq_total').key, field: 'displayLabel', value: 'PHQ-9 total', status: 'confirmed', author: 'Curator A', reason: null })
    const auditBefore = project.db.get<{ n: number }>('SELECT COUNT(*) n FROM audit_log')!.n
    const planned = planFor(project, versionId, dict)
    expect(planned.kept).toEqual([{ varKey: v('phq_total').key, header: 'phq_total', field: 'displayLabel', from: 'PHQ-9 total', to: 'PHQ-9 total score' }])
    const r = applyDictionary(project, versionId, dict, 'Test RA')
    expect(r).toEqual({ metadataValues: planned.changes.length, quasiIdentifiers: 1, measures: 6 })

    const age = v('age')
    expect(age.meta.displayLabel).toMatchObject({ value: 'Age at enrolment', status: 'tentative' })
    expect(age.meta.displayLabel.provenance).toMatch(/Curator · Test RA · .* · REDCap data dictionary \(SHA-256 [0-9a-f]{12}…\)/)
    expect(age.meta.area.value).toBe('Demographics')
    expect(age.meta.unit).toMatchObject({ value: null, status: 'unknown' }) // never assumed
    expect(v('site_notes').quasiIdentifier).toBe(true)
    expect(v('phq_total').meta.displayLabel).toMatchObject({ value: 'PHQ-9 total', status: 'confirmed' }) // the curator's value stands
    expect(v('phq_total').meta.definition.value).toMatch(/Calculated in REDCap/)
    expect(v('il6').meta.definition.status).toBe('unknown')
    // Each value is an ordinary revision in the measure's history.
    expect(history(project, versionId, { target: age.key }).filter((h) => h.reason?.startsWith('REDCap data dictionary')).map((h) => h.field ?? h.kind).sort()).toEqual(['area', 'definition', 'displayLabel', 'source'])
    expect(history(project, versionId, { target: v('site_notes').key, kind: 'quasi_identifier' })).toHaveLength(1)
    // One audit entry for the whole import, with the file's checksum and no values.
    const audit = project.db.all<{ action: string; detail_json: string }>('SELECT action, detail_json FROM audit_log ORDER BY id').slice(auditBefore)
    expect(audit.map((a) => a.action)).toEqual(['metadata.import_dictionary'])
    expect(JSON.parse(audit[0].detail_json)).toMatchObject({ sha256: dict.sha256, matched: 6, quasiIdentifiers: 1, keptCuratorValues: 1 })
    expect(verifyIntegrity(project.db).ok).toBe(true)

    // Applying the same dictionary again changes nothing.
    const again = planFor(project, versionId, dict)
    expect(again.changes).toEqual([])
    expect(again.quasiIdentifiers).toEqual([])
    expect(applyDictionary(project, versionId, dict, 'Test RA')).toEqual({ metadataValues: 0, quasiIdentifiers: 0, measures: 0 })

    // A curator who un-flags a measure is not overruled by the dictionary next time.
    setQuasiIdentifier(project, { datasetVersionId: versionId, varKey: v('site_notes').key, value: false, author: 'Curator A', reason: 'decided' })
    expect(v('site_notes').quasiIdentifier).toBe(false)
    expect(planFor(project, versionId, dict).quasiIdentifiers).toEqual([])
  })
})
