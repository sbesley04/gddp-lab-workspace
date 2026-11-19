// REDCap data dictionary → proposed metadata. Pure: it reads the dictionary rows and a snapshot and says what it
// would set; the main process writes the revisions. A dictionary describes fields (label, form, choices, identifier
// flag). It does not describe units, specimens or assays, so those stay unknown: a unit is never assumed.
//
// Nothing a curator has already set is replaced. Proposed values are recorded as tentative, with the dictionary named
// as their origin, and remain ordinary append-only revisions that a curator can confirm or change.

import type { DatasetSnapshot, MetaFieldName, VariableInfo } from './types'

export interface RedcapField {
  name: string
  form: string
  type: string
  label: string
  /** Coded choices of a dropdown, radio or checkbox field. */
  choices: { code: string; label: string }[]
  /** The formula of a calculated field. */
  calculation: string | null
  note: string
  validation: string
  min: string
  max: string
  identifier: boolean
}

// Column titles of the dictionary as downloaded from REDCap, and the names used by its API export.
const COLUMNS: Record<keyof Omit<RedcapField, 'choices' | 'calculation' | 'identifier'> | 'choicesRaw' | 'identifierRaw', RegExp> = {
  name: /^(variable\s*\/\s*field name|field_name)$/i,
  form: /^(form name|form_name)$/i,
  type: /^(field type|field_type)$/i,
  label: /^(field label|field_label)$/i,
  choicesRaw: /^(choices, calculations, or slider labels|select_choices_or_calculations)$/i,
  note: /^(field note|field_note)$/i,
  validation: /^(text validation type or show slider number|text_validation_type_or_show_slider_number)$/i,
  min: /^(text validation min|text_validation_min)$/i,
  max: /^(text validation max|text_validation_max)$/i,
  identifierRaw: /^(identifier\??|identifier)$/i
}

export class DictionaryError extends Error {}

const clean = (s: string | undefined | null) => (s ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()

/** "1, Yes | 0, No" → [{ code: '1', label: 'Yes' }, { code: '0', label: 'No' }]. The label may itself contain commas. */
export function parseChoices(raw: string): { code: string; label: string }[] {
  return raw
    .split('|')
    .map((part) => {
      const i = part.indexOf(',')
      return i < 0 ? null : { code: part.slice(0, i).trim(), label: clean(part.slice(i + 1)) }
    })
    .filter((c): c is { code: string; label: string } => !!c && c.code !== '')
}

/** Reads the rows of a data dictionary CSV. Throws DictionaryError when the file is not a REDCap data dictionary. */
export function parseRedcapDictionary(rows: string[][]): RedcapField[] {
  const header = (rows[0] ?? []).map((h) => h.replace(/^﻿/, '').trim())
  const at = (re: RegExp) => header.findIndex((h) => re.test(h))
  const col = Object.fromEntries(Object.entries(COLUMNS).map(([k, re]) => [k, at(re)])) as Record<keyof typeof COLUMNS, number>
  if (col.name < 0 || col.label < 0 || col.type < 0)
    throw new DictionaryError('This file is not a REDCap data dictionary: it needs the columns "Variable / Field Name", "Field Type" and "Field Label" in its first row.')
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '')
  const out: RedcapField[] = []
  const seen = new Set<string>()
  for (const r of rows.slice(1)) {
    const name = get(r, col.name)
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    const type = get(r, col.type).toLowerCase()
    const raw = get(r, col.choicesRaw)
    const coded = type === 'dropdown' || type === 'radio' || type === 'checkbox'
    out.push({
      name,
      form: get(r, col.form),
      type,
      label: clean(get(r, col.label)),
      choices: coded ? parseChoices(raw) : [],
      calculation: type === 'calc' && raw ? raw : null,
      note: clean(get(r, col.note)),
      validation: get(r, col.validation),
      min: get(r, col.min),
      max: get(r, col.max),
      identifier: /^y(es)?$/i.test(get(r, col.identifierRaw))
    })
  }
  if (out.length === 0) throw new DictionaryError('The data dictionary lists no fields.')
  return out
}

export const MAX_LABEL = 80

/** What the dictionary says about one exported column. Checkbox columns ("field___code") get their own choice. */
export function describeField(f: RedcapField, choiceCode: string | null): Partial<Record<MetaFieldName, string>> {
  const choice = choiceCode !== null ? f.choices.find((c) => c.code.toLowerCase() === choiceCode.toLowerCase()) : null
  const label = choice ? `${f.label}: ${choice.label}` : f.label
  const parts: string[] = []
  if (label) parts.push(label.endsWith('.') || label.endsWith('?') ? label : `${label}.`)
  if (f.note) parts.push(`Note: ${f.note}.`)
  if (choice) parts.push('Checkbox option: 1 = ticked, 0 = not ticked.')
  else if (f.choices.length) parts.push(`Coded as ${f.choices.map((c) => `${c.code} = ${c.label}`).join('; ')}.`)
  if (f.type === 'yesno') parts.push('Coded as 1 = Yes; 0 = No.')
  if (f.type === 'truefalse') parts.push('Coded as 1 = True; 0 = False.')
  if (f.calculation) parts.push(`Calculated in REDCap: ${f.calculation}`)
  if (f.min || f.max) parts.push(`Allowed range in REDCap: ${f.min || 'no minimum'} to ${f.max || 'no maximum'}.`)
  const out: Partial<Record<MetaFieldName, string>> = { source: 'REDCap' }
  if (label && label.length <= MAX_LABEL) out.displayLabel = label
  if (parts.length) out.definition = parts.join(' ')
  if (f.form) {
    const form = f.form.replace(/_/g, ' ').trim()
    out.area = form.charAt(0).toUpperCase() + form.slice(1)
  }
  return out
}

export interface DictionaryChange {
  varKey: string
  header: string
  field: MetaFieldName
  from: string | null
  to: string
}

export interface DictionaryPlan {
  fields: number
  /** Measures in the dataset that a dictionary field describes. */
  matched: number
  /** Dictionary fields with no column in this dataset (descriptive text, or fields not exported), up to 50 names. */
  unmatchedFields: string[]
  unmatchedFieldCount: number
  /** Measures the dictionary does not mention. */
  undescribedMeasures: number
  /** Values to record, as tentative. */
  changes: DictionaryChange[]
  /** Values a curator has already set that differ from the dictionary. They are kept. */
  kept: DictionaryChange[]
  /** Measures the dictionary marks as identifiers and the project does not yet flag as quasi-identifiers. */
  quasiIdentifiers: { varKey: string; header: string }[]
}

const FIELDS: MetaFieldName[] = ['displayLabel', 'area', 'definition', 'source']

/** A value set by a person (or an earlier dictionary import) rather than derived from the header by the importer. */
const curatorSet = (v: VariableInfo, field: MetaFieldName) => v.meta[field].provenance.startsWith('Curator')

export function planDictionary(snapshot: DatasetSnapshot, fields: RedcapField[]): DictionaryPlan {
  const byName = new Map(fields.map((f) => [f.name.toLowerCase(), f]))
  const byLabel = new Map(fields.filter((f) => f.label).map((f) => [f.label.toLowerCase(), f]))
  const used = new Set<string>()
  const changes: DictionaryChange[] = []
  const kept: DictionaryChange[] = []
  const quasiIdentifiers: DictionaryPlan['quasiIdentifiers'] = []
  let matched = 0
  let undescribed = 0
  for (const v of snapshot.variables) {
    if (v.role !== 'measure') continue
    const h = v.header.trim()
    let field = byName.get(h.toLowerCase())
    let choice: string | null = null
    if (!field) {
      // A checkbox field is exported as one column per option: "field___code".
      const m = /^(.+)___(.+)$/.exec(h)
      const base = m ? byName.get(m[1].toLowerCase()) : undefined
      if (base && base.type === 'checkbox') {
        field = base
        choice = m![2]
      }
    }
    // Exports made with labels as column titles.
    if (!field) field = byLabel.get(h.toLowerCase())
    if (!field) {
      undescribed++
      continue
    }
    matched++
    used.add(field.name.toLowerCase())
    const proposed = describeField(field, choice)
    for (const f of FIELDS) {
      const to = proposed[f]
      if (!to) continue
      const from = v.meta[f].value
      if (from === to) continue
      const change = { varKey: v.key, header: v.header, field: f, from, to }
      if (curatorSet(v, f) && from !== null) kept.push(change)
      else changes.push(change)
    }
    if (field.identifier && !v.quasiIdentifier) quasiIdentifiers.push({ varKey: v.key, header: v.header })
  }
  const unmatched = fields.filter((f) => !used.has(f.name.toLowerCase())).map((f) => f.name)
  return { fields: fields.length, matched, unmatchedFields: unmatched.slice(0, 50), unmatchedFieldCount: unmatched.length, undescribedMeasures: undescribed, changes, kept, quasiIdentifiers }
}
