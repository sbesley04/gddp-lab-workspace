// Append-only curation: metadata edits, formatting decisions, exclusions, segment names, study context.
import type { MetaFieldName, MetaStatus, InterpretationKind } from '@core/types'
import { META_FIELDS } from '@core/types'
import type { Project } from './project'
import { revisionsAsOf } from './snapshot'

function insert(project: Project, datasetVersionId: string, kind: string, target: string, field: string | null, value: unknown, status: string | null, author: string | null, reason: string | null): number {
  const r = project.db.run(
    'INSERT INTO revision(dataset_version_id, kind, target, field, value_json, status, author_label, reason, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    datasetVersionId, kind, target, field, JSON.stringify(value ?? null), status, author, reason, new Date().toISOString()
  )
  return Number(r.lastInsertRowid)
}

function ensureVersion(project: Project, id: string) {
  if (!project.db.get('SELECT 1 FROM dataset_version WHERE id = ?', id)) throw new Error('Dataset version not found.')
}

function ensureVariable(project: Project, datasetVersionId: string, key: string) {
  if (!project.db.get('SELECT 1 FROM variable WHERE dataset_version_id = ? AND var_key = ?', datasetVersionId, key)) throw new Error(`Unknown variable ${key}.`)
}

export function editVariableMeta(
  project: Project,
  input: { datasetVersionId: string; varKey: string; field: MetaFieldName; value: string | null; status: MetaStatus; author: string | null; reason: string | null }
): number {
  if (!META_FIELDS.includes(input.field)) throw new Error('Unknown metadata field.')
  ensureVariable(project, input.datasetVersionId, input.varKey)
  const value = input.value?.trim() ? input.value.trim() : null
  // A value cannot be "confirmed" while empty: unknown stays visibly unknown.
  const status: MetaStatus = value === null ? 'unknown' : input.status
  return project.db.transaction(() => {
    const id = insert(project, input.datasetVersionId, 'variable_meta', input.varKey, input.field, value, status, input.author, input.reason)
    project.audit('metadata.edit', { varKey: input.varKey, field: input.field, status, revision: id }, input.author)
    return id
  })
}

export function setQuasiIdentifier(project: Project, input: { datasetVersionId: string; varKey: string; value: boolean; author: string | null; reason: string | null }): number {
  ensureVariable(project, input.datasetVersionId, input.varKey)
  return insert(project, input.datasetVersionId, 'quasi_identifier', input.varKey, null, input.value, 'confirmed', input.author, input.reason)
}

export function decideFormat(
  project: Project,
  input: { datasetVersionId: string; groupKey: string; decision: 'confirm' | 'reject' | 'reset'; asKind?: InterpretationKind; author: string | null; reason: string | null }
): number {
  ensureVersion(project, input.datasetVersionId)
  if (input.decision !== 'reset' && !input.reason?.trim()) throw new Error('A short reason is required for formatting decisions.')
  const allowed: InterpretationKind[] = ['qc_sample', 'qc_target', 'qc_both']
  if (input.asKind && !allowed.includes(input.asKind)) throw new Error('Formatting can only be confirmed as a documented QC category.')
  return project.db.transaction(() => {
    const id = insert(project, input.datasetVersionId, 'format_decision', input.groupKey, null, { decision: input.decision, asKind: input.asKind }, input.decision, input.author, input.reason)
    project.audit('format.decision', { groupKey: input.groupKey, decision: input.decision, asKind: input.asKind ?? null, revision: id }, input.author)
    return id
  })
}

export function setCellExclusion(
  project: Project,
  input: { datasetVersionId: string; varKey: string; participantId: string; visitId: string; excluded: boolean; author: string | null; reason: string | null }
): number {
  ensureVariable(project, input.datasetVersionId, input.varKey)
  if (input.excluded && !input.reason?.trim()) throw new Error('A reason is required to exclude an observation.')
  return project.db.transaction(() => {
    const id = insert(project, input.datasetVersionId, 'cell_exclusion', `${input.varKey}|${input.participantId}|${input.visitId}`, null, { excluded: input.excluded }, input.excluded ? 'excluded' : 'included', input.author, input.reason)
    project.audit(input.excluded ? 'observation.exclude' : 'observation.include', { varKey: input.varKey, revision: id }, input.author)
    return id
  })
}

export function nameSegment(project: Project, input: { datasetVersionId: string; segment: number; name: string; author: string | null }): number {
  ensureVersion(project, input.datasetVersionId)
  return insert(project, input.datasetVersionId, 'segment_name', `segment:${input.segment}`, null, input.name.trim() || null, 'confirmed', input.author, null)
}

export function setStudyContext(project: Project, input: { datasetVersionId: string; text: string; author: string | null }): number {
  ensureVersion(project, input.datasetVersionId)
  return insert(project, input.datasetVersionId, 'study_context', 'project', null, input.text, 'confirmed', input.author, null)
}

export function getStudyContext(project: Project, datasetVersionId: string, asOf: number): { text: string; revisionId: number | null } {
  const r = revisionsAsOf(project, datasetVersionId, asOf).filter((x) => x.kind === 'study_context').pop()
  return r ? { text: JSON.parse(r.value_json ?? '""'), revisionId: r.id } : { text: '', revisionId: null }
}

export interface HistoryEntry {
  id: number
  kind: string
  target: string
  field: string | null
  value: unknown
  status: string | null
  author: string | null
  reason: string | null
  at: string
}

export function history(project: Project, datasetVersionId: string, filter: { target?: string; kind?: string } = {}, limit = 500): HistoryEntry[] {
  const rows = project.db.all<any>(
    `SELECT * FROM revision WHERE dataset_version_id = ? AND (? IS NULL OR target = ?) AND (? IS NULL OR kind = ?) ORDER BY id DESC LIMIT ?`,
    datasetVersionId, filter.target ?? null, filter.target ?? null, filter.kind ?? null, filter.kind ?? null, limit
  )
  return rows.map((r) => ({ id: r.id, kind: r.kind, target: r.target, field: r.field, value: JSON.parse(r.value_json ?? 'null'), status: r.status, author: r.author_label, reason: r.reason, at: r.created_at }))
}

export interface FormatGroup {
  groupKey: string
  formatKey: string
  kind: string
  status: string
  count: number
  columns: string[]
  sampleAddresses: string[]
  detail: string
  swatch: string | null
  decision: { decision: string; asKind?: string; author: string | null; reason: string | null; at: string } | null
}

/** Interpretations grouped by (format key, kind, original status) — the unit a curator confirms or rejects. */
export function formatGroups(project: Project, datasetVersionId: string, asOf: number): FormatGroup[] {
  const rows = project.db.all<any>(
    `SELECT fi.format_key, fi.kind, fi.status, COUNT(*) n, MIN(fi.detail) detail,
            GROUP_CONCAT(DISTINCT v.column_letter) cols
     FROM format_interpretation fi JOIN variable v ON v.dataset_version_id = fi.dataset_version_id AND v.var_index = fi.var_index
     WHERE fi.dataset_version_id = ? AND NOT (fi.kind = 'cell_source' AND fi.status <> 'needs_review')
     GROUP BY fi.format_key, fi.kind, fi.status ORDER BY n DESC`,
    datasetVersionId
  )
  const decisions = new Map<string, any>()
  for (const r of revisionsAsOf(project, datasetVersionId, asOf)) if (r.kind === 'format_decision') decisions.set(r.target, r)
  return rows.map((r) => {
    const groupKey = `${r.format_key}|${r.kind}|${r.status}`
    const samples = project.db.all<{ a: string }>(
      `SELECT v.column_letter || sr.row_number a FROM format_interpretation fi
       JOIN variable v ON v.dataset_version_id = fi.dataset_version_id AND v.var_index = fi.var_index
       JOIN source_row sr ON sr.dataset_version_id = fi.dataset_version_id AND sr.row_index = fi.row_index
       WHERE fi.dataset_version_id = ? AND fi.format_key = ? AND fi.kind = ? AND fi.status = ? LIMIT 8`,
      datasetVersionId, r.format_key, r.kind, r.status
    )
    const d = decisions.get(groupKey)
    const dv = d ? JSON.parse(d.value_json ?? '{}') : null
    return {
      groupKey,
      formatKey: r.format_key,
      kind: r.kind,
      status: r.status,
      count: r.n,
      columns: String(r.cols ?? '').split(',').filter(Boolean),
      sampleAddresses: samples.map((s) => s.a),
      detail: r.detail,
      swatch: /#([0-9A-F]{6})/i.exec(r.detail)?.[1] ?? null,
      decision: d && dv.decision !== 'reset' ? { decision: dv.decision, asKind: dv.asKind, author: d.author_label, reason: d.reason, at: d.created_at } : null
    }
  })
}
