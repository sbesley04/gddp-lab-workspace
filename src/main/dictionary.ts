// Applying a REDCap data dictionary to a dataset version. The file is read and planned here; the renderer sees the
// plan and asks for it to be applied, and the plan is recomputed at that moment from the file and the current
// curation, so nothing the renderer sends decides what is written.
import { createHash } from 'node:crypto'
import Papa from 'papaparse'
import { DictionaryError, parseRedcapDictionary, planDictionary, type DictionaryPlan, type RedcapField } from '@core/redcapDictionary'
import type { Project } from './project'
import { buildSnapshot } from './snapshot'

export interface ParsedDictionary {
  sha256: string
  fields: RedcapField[]
}

export function readDictionary(bytes: Uint8Array): ParsedDictionary {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // REDCap can also write Windows-1252, where accented letters are single bytes.
    text = new TextDecoder('windows-1252').decode(bytes)
  }
  const parsed = Papa.parse<string[]>(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, { skipEmptyLines: true })
  if (!parsed.data.length) throw new DictionaryError('The file is empty.')
  return { sha256: createHash('sha256').update(bytes).digest('hex'), fields: parseRedcapDictionary(parsed.data) }
}

/** The plan for this dataset version as curated now. Identifier flags a curator has already decided are left alone. */
export function planFor(project: Project, datasetVersionId: string, dict: ParsedDictionary): DictionaryPlan {
  const plan = planDictionary(buildSnapshot(project, datasetVersionId), dict.fields)
  const decided = new Set(project.db.all<{ target: string }>("SELECT DISTINCT target FROM revision WHERE dataset_version_id = ? AND kind = 'quasi_identifier' AND author_label IS NOT 'Importer'", datasetVersionId).map((r) => r.target))
  return { ...plan, quasiIdentifiers: plan.quasiIdentifiers.filter((q) => !decided.has(q.varKey)) }
}

export interface DictionaryResult {
  metadataValues: number
  quasiIdentifiers: number
  measures: number
}

/** Writes the plan as tentative, append-only revisions in one transaction, with one audit entry for the whole import. */
export function applyDictionary(project: Project, datasetVersionId: string, dict: ParsedDictionary, author: string | null): DictionaryResult {
  if (!project.db.get('SELECT 1 FROM dataset_version WHERE id = ?', datasetVersionId)) throw new Error('Dataset version not found.')
  const plan = planFor(project, datasetVersionId, dict)
  const reason = `REDCap data dictionary (SHA-256 ${dict.sha256.slice(0, 12)}…)`
  return project.db.transaction(() => {
    const before = project.maxRowId('revision')
    const now = new Date().toISOString()
    const insert = (kind: string, target: string, field: string | null, value: unknown, status: string) =>
      project.db.run(
        'INSERT INTO revision(dataset_version_id, kind, target, field, value_json, status, author_label, reason, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        datasetVersionId, kind, target, field, JSON.stringify(value), status, author, reason, now
      )
    // Tentative: the dictionary is a good source, but a curator has not looked at each value.
    for (const c of plan.changes) insert('variable_meta', c.varKey, c.field, c.to, 'tentative')
    for (const q of plan.quasiIdentifiers) insert('quasi_identifier', q.varKey, null, true, 'confirmed')
    project.chain('revision', before)
    const result = { metadataValues: plan.changes.length, quasiIdentifiers: plan.quasiIdentifiers.length, measures: new Set(plan.changes.map((c) => c.varKey)).size }
    project.audit('metadata.import_dictionary', { datasetVersionId, sha256: dict.sha256, fields: plan.fields, matched: plan.matched, ...result, keptCuratorValues: plan.kept.length }, author)
    return result
  })
}
