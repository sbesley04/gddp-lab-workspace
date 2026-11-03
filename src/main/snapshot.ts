// Materialises an immutable dataset version plus curation "as of" a metadata version into a DatasetSnapshot.
import type {
  Alias,
  Annotation,
  CellFlag,
  CellValue,
  DatasetSnapshot,
  InterpretationKind,
  InterpretationStatus,
  MetaField,
  MetaFieldName,
  QcCategory,
  VariableInfo,
  VariableMeta
} from '@core/types'
import { META_FIELDS } from '@core/types'
import type { Segment } from '@importer/model'
import type { Project } from './project'

export interface DatasetVersionSummary {
  id: string
  versionNumber: number
  sourceFileName: string
  sha256: string
  sheetName: string
  createdAt: string
  rows: number
  columns: number
  participants: number
  events: string[]
  sourceKind: 'xlsx' | 'csv'
}

export function listVersions(project: Project): DatasetVersionSummary[] {
  return project.db
    .all<any>(
      `SELECT dv.id, dv.version_number, dv.sheet_name, dv.created_at, dv.import_report_json, sf.original_name, sf.sha256, sf.kind
       FROM dataset_version dv JOIN source_file sf ON sf.id = dv.source_file_id ORDER BY dv.version_number DESC`
    )
    .map((r) => {
      const rep = JSON.parse(r.import_report_json)
      return {
        id: r.id,
        versionNumber: r.version_number,
        sourceFileName: r.original_name,
        sha256: r.sha256,
        sheetName: r.sheet_name,
        createdAt: r.created_at,
        rows: rep.summary.dataRows,
        columns: rep.summary.columns,
        participants: rep.summary.participants,
        events: rep.summary.events,
        sourceKind: r.kind
      }
    })
}

interface RevisionRow {
  id: number
  kind: string
  target: string
  field: string | null
  value_json: string | null
  status: string | null
  author_label: string | null
  reason: string | null
  created_at: string
}

export function revisionsAsOf(project: Project, datasetVersionId: string, asOf: number): RevisionRow[] {
  return project.db.all<RevisionRow>('SELECT * FROM revision WHERE dataset_version_id = ? AND id <= ? ORDER BY id', datasetVersionId, asOf)
}

const KIND_TO_CAT: Record<string, QcCategory> = { qc_sample: 'sample_warning', qc_target: 'target_warning', qc_both: 'both_warnings' }

export function categoryFor(kind: InterpretationKind, status: InterpretationStatus): QcCategory | null {
  if (status === 'curator_rejected') return null
  if (kind === 'qc_sample' || kind === 'qc_target' || kind === 'qc_both') {
    if (status === 'needs_review') return kind === 'qc_sample' ? 'possible_sample_warning' : 'possible_target_warning'
    return KIND_TO_CAT[kind]
  }
  if (kind === 'unresolved_highlight') return 'unresolved_highlight'
  if (kind === 'curator_exclusion') return 'curator_exclusion'
  return null
}

export function segmentsOf(project: Project, datasetVersionId: string, asOf: number): Segment[] {
  const row = project.db.get<{ segments_json: string }>('SELECT segments_json FROM dataset_version WHERE id = ?', datasetVersionId)
  const segs: Segment[] = row ? JSON.parse(row.segments_json) : []
  for (const r of revisionsAsOf(project, datasetVersionId, asOf))
    if (r.kind === 'segment_name') {
      const s = segs.find((x) => `segment:${x.index}` === r.target)
      if (s) {
        s.name = JSON.parse(r.value_json ?? 'null')
        s.status = (r.status as Segment['status']) ?? 'confirmed'
        s.note = `Named by curator${r.author_label ? ` (${r.author_label})` : ''} on ${r.created_at.slice(0, 10)}`
      }
    }
  return segs
}

export function buildSnapshot(project: Project, datasetVersionId: string, asOfInput?: number): DatasetSnapshot {
  const db = project.db
  const dv = db.get<any>(
    `SELECT dv.*, sf.original_name, sf.sha256, sf.kind FROM dataset_version dv JOIN source_file sf ON sf.id = dv.source_file_id WHERE dv.id = ?`,
    datasetVersionId
  )
  if (!dv) throw new Error('Dataset version not found.')
  const asOf = asOfInput ?? project.metadataVersion()
  const revs = revisionsAsOf(project, datasetVersionId, asOf)
  const segments = segmentsOf(project, datasetVersionId, asOf)

  const visits = db
    .all<any>('SELECT id, event_name, sort_order FROM visit WHERE dataset_version_id = ? ORDER BY sort_order', datasetVersionId)
    .map((v) => ({ id: v.id, name: v.event_name, order: v.sort_order, actualDate: null as null }))
  const rows = db
    .all<any>(
      `SELECT sr.row_index, sr.row_number, p.source_identifier, sr.visit_id FROM source_row sr JOIN participant p ON p.id = sr.participant_id
       WHERE sr.dataset_version_id = ? ORDER BY sr.row_index`,
      datasetVersionId
    )
    .map((r) => ({ index: r.row_index, rowNumber: r.row_number, participantId: r.source_identifier, visitId: r.visit_id }))

  // Metadata: importer seeds < segment names (for area) < curator edits.
  const seed = new Map<string, RevisionRow>()
  const curated = new Map<string, RevisionRow>()
  const qi = new Map<string, RevisionRow>()
  const cov = new Map<string, RevisionRow>()
  for (const r of revs) {
    if (r.kind === 'variable_meta' && r.field) {
      const k = `${r.target}\u0000${r.field}`
      if (r.author_label === 'Importer') seed.set(k, r)
      else curated.set(k, r)
    } else if (r.kind === 'quasi_identifier') qi.set(r.target, r)
    else if (r.kind === 'covariate') cov.set(r.target, r)
  }
  const metaField = (key: string, field: MetaFieldName, segName: Segment | undefined): MetaField => {
    const k = `${key}\u0000${field}`
    const c = curated.get(k)
    if (c) return { value: JSON.parse(c.value_json ?? 'null'), status: (c.status as MetaField['status']) ?? 'confirmed', provenance: `Curator${c.author_label ? ` · ${c.author_label}` : ''} · ${c.created_at.slice(0, 10)}${c.reason ? ` · ${c.reason}` : ''}`, revisionId: c.id }
    if (field === 'area' && segName?.name && segName.note.startsWith('Named by curator')) return { value: segName.name, status: segName.status, provenance: segName.note, revisionId: null }
    const s = seed.get(k)
    if (s) return { value: JSON.parse(s.value_json ?? 'null'), status: (s.status as MetaField['status']) ?? 'unknown', provenance: s.reason ?? 'Importer', revisionId: s.id }
    return { value: null, status: 'unknown', provenance: 'Not documented', revisionId: null }
  }

  const variables: VariableInfo[] = db
    .all<any>('SELECT * FROM variable WHERE dataset_version_id = ? ORDER BY var_index', datasetVersionId)
    .map((v) => {
      const seg = segments.find((s) => s.index === v.segment)
      const meta = Object.fromEntries(META_FIELDS.map((f) => [f, metaField(v.var_key, f, seg)])) as VariableMeta
      if (!meta.displayLabel.value) meta.displayLabel = { ...meta.displayLabel, value: v.header }
      const q = qi.get(v.var_key)
      return {
        index: v.var_index,
        columnIndex: v.column_index,
        letter: v.column_letter,
        key: v.var_key,
        header: v.header,
        headerRuns: v.header_runs_json ? JSON.parse(v.header_runs_json) : null,
        role: v.role,
        kind: v.kind,
        groupSegment: v.segment,
        subgroupSegment: v.subsegment,
        meta,
        aliases: JSON.parse(v.aliases_json) as Alias[],
        attribution: v.attribution_json ? JSON.parse(v.attribution_json) : null,
        quasiIdentifier: q ? JSON.parse(q.value_json ?? 'false') : v.quasi_identifier === 1,
        covariate: cov.has(v.var_key) ? JSON.parse(cov.get(v.var_key)!.value_json ?? 'false') : false,
        categories: JSON.parse(v.categories_json),
        counts: JSON.parse(v.counts_json)
      }
    })

  const values: CellValue[][] = variables.map(() => new Array(rows.length).fill({ k: 'missing' }))
  for (const c of db.all<any>('SELECT var_index, row_index, value_kind, raw_text, numeric_value, censor_op FROM cell WHERE dataset_version_id = ?', datasetVersionId)) {
    let v: CellValue
    switch (c.value_kind) {
      case 'number':
        v = { k: 'number', v: c.numeric_value, raw: c.raw_text }
        break
      case 'censored':
        v = { k: 'censored', op: c.censor_op, bound: c.numeric_value, raw: c.raw_text }
        break
      case 'text':
        v = { k: 'text', raw: c.raw_text }
        break
      default:
        v = { k: 'missing' }
    }
    values[c.var_index][c.row_index] = v
  }

  // Formatting decisions apply to every interpretation sharing a format key.
  const decisions = new Map<string, { decision: string; asKind?: InterpretationKind; rev: RevisionRow }>()
  const exclusions = new Map<string, { excluded: boolean; rev: RevisionRow }>()
  for (const r of revs) {
    if (r.kind === 'format_decision') decisions.set(r.target, { ...JSON.parse(r.value_json ?? '{}'), rev: r })
    if (r.kind === 'cell_exclusion') exclusions.set(r.target, { ...JSON.parse(r.value_json ?? '{}'), rev: r })
  }
  const flags: CellFlag[] = []
  for (const f of db.all<any>('SELECT * FROM format_interpretation WHERE dataset_version_id = ?', datasetVersionId)) {
    let kind = f.kind as InterpretationKind
    let status = f.status as InterpretationStatus
    let detail = f.detail as string
    const d = decisions.get(`${f.format_key}|${f.kind}|${f.status}`) ?? decisions.get(f.format_key)
    if (d && d.decision !== 'reset') {
      if (d.decision === 'confirm') {
        kind = d.asKind ?? kind
        status = 'curator_confirmed'
      } else if (d.decision === 'reject') status = 'curator_rejected'
      detail = `${detail} — Curator ${d.decision === 'confirm' ? `confirmed as ${kind.replace('qc_', '')}` : 'rejected this interpretation'}${d.rev.author_label ? ` (${d.rev.author_label})` : ''}, ${d.rev.created_at.slice(0, 10)}${d.rev.reason ? `: ${d.rev.reason}` : ''}`
    }
    flags.push({ row: f.row_index, variable: f.var_index, kind, status, category: categoryFor(kind, status), formatKey: f.format_key, detail })
  }
  const varByKey = new Map(variables.map((v) => [v.key, v]))
  const rowByKey = new Map(rows.map((r) => [`${r.participantId}@${r.visitId}`, r]))
  for (const [target, ex] of exclusions) {
    if (!ex.excluded) continue
    const [vk, pid, visitId] = target.split('|')
    const v = varByKey.get(vk)
    const r = rowByKey.get(`${pid}@${visitId}`)
    if (!v || !r) continue
    flags.push({
      row: r.index,
      variable: v.index,
      kind: 'curator_exclusion',
      status: 'curator_confirmed',
      category: 'curator_exclusion',
      formatKey: 'curator',
      detail: `Excluded by curator${ex.rev.author_label ? ` (${ex.rev.author_label})` : ''} on ${ex.rev.created_at.slice(0, 10)}: ${ex.rev.reason ?? 'no reason given'}`
    })
  }

  const annotations: Annotation[] = db
    .all<any>('SELECT * FROM annotation WHERE dataset_version_id = ? ORDER BY id', datasetVersionId)
    .map((a) => ({ id: String(a.id), address: a.address, row: a.row_index, variable: a.var_index, text: a.text, author: a.author, threaded: !!a.threaded }))

  return {
    datasetVersionId,
    versionNumber: dv.version_number,
    sourceFileName: dv.original_name,
    sourceSha256: dv.sha256,
    sheetName: dv.sheet_name,
    importedAt: dv.created_at,
    sourceKind: dv.kind,
    metadataVersion: asOf,
    visits,
    rows,
    variables,
    values,
    flags,
    annotations
  }
}
