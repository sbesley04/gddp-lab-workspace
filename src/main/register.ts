// Analysis register: an append-only record of every distinct analysis computed in the statistics panel, so the
// number of tests run in a project can be counted. The main process recomputes each analysis from the selection
// spec and chart settings; it never stores numbers sent by the renderer.
import type { ChartConfig, DatasetSnapshot, SelectionSpec } from '@core/types'
import { buildAnalysisRecord, type AnalysisRecord } from '@core/analysisRun'
import type { Project } from './project'
import { buildSnapshot } from './snapshot'
import { APP_VERSION } from './version'

export interface RegisterTotals {
  /** Distinct analyses recorded in the project. */
  analyses: number
  /** p-values those analyses produced (tests, coefficients and assumption checks). */
  tests: number
}

export interface RegisterEntry {
  id: number
  fingerprint: string
  datasetVersionId: string
  metadataVersion: number
  kind: string
  title: string
  rows: number
  participants: number
  tests: number
  appVersion: string
  author: string | null
  at: string
  record: AnalysisRecord
}

export interface RecordResult {
  /** True when this analysis was new and a row was written. */
  recorded: boolean
  /** p-values in this analysis; 0 when there was nothing to record (for example the independence guard blocked it). */
  tests: number
  fingerprint: string | null
  totals: RegisterTotals
}

// A snapshot as of a metadata version never changes, so the last one built can be reused while the same chart is explored.
const lastSnapshot = new WeakMap<Project, { key: string; snapshot: DatasetSnapshot }>()
function snapshotFor(project: Project, versionId: string, asOf: number): DatasetSnapshot {
  const key = `${versionId}@${asOf}`
  const hit = lastSnapshot.get(project)
  if (hit?.key === key) return hit.snapshot
  const snapshot = buildSnapshot(project, versionId, asOf)
  lastSnapshot.set(project, { key, snapshot })
  return snapshot
}

export function registerTotals(project: Project, datasetVersionId?: string | null): RegisterTotals {
  const r = project.db.get<{ a: number; t: number | null }>(
    'SELECT COUNT(*) AS a, SUM(test_count) AS t FROM analysis_register WHERE (? IS NULL OR dataset_version_id = ?)',
    datasetVersionId ?? null, datasetVersionId ?? null
  )
  return { analyses: r?.a ?? 0, tests: r?.t ?? 0 }
}

export function recordAnalysis(project: Project, input: { spec: SelectionSpec; chart: ChartConfig; metadataVersion: number; author: string | null }): RecordResult {
  if (!project.db.get('SELECT 1 FROM dataset_version WHERE id = ?', input.spec.datasetVersionId)) throw new Error('Dataset version not found.')
  if (input.metadataVersion > project.metadataVersion()) throw new Error('Metadata version is newer than this project.')
  const snapshot = snapshotFor(project, input.spec.datasetVersionId, input.metadataVersion)
  const built = buildAnalysisRecord({ snapshot, spec: input.spec, chart: input.chart })
  if (!built) return { recorded: false, tests: 0, fingerprint: null, totals: registerTotals(project) }
  const { record, fingerprint } = built
  const recorded = project.db.transaction(() => {
    if (project.db.get('SELECT 1 FROM analysis_register WHERE fingerprint = ?', fingerprint)) return false
    const r = project.db.run(
      'INSERT INTO analysis_register(fingerprint, dataset_version_id, metadata_version, kind, title, n_rows, n_participants, test_count, record_json, app_version, author_label, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      fingerprint, snapshot.datasetVersionId, snapshot.metadataVersion, record.kind, record.title, record.analysed.rows, record.analysed.participants, record.tests.length,
      JSON.stringify(record), APP_VERSION, input.author, new Date().toISOString()
    )
    project.chain('analysis_register', Number(r.lastInsertRowid) - 1)
    project.audit('analysis.compute', { register: Number(r.lastInsertRowid), fingerprint, kind: record.kind, tests: record.tests.length }, input.author)
    return true
  })
  return { recorded, tests: record.tests.length, fingerprint, totals: registerTotals(project) }
}

export function listRegister(project: Project, opts: { datasetVersionId?: string | null; limit?: number } = {}): { totals: RegisterTotals; entries: RegisterEntry[] } {
  const rows = project.db.all<any>(
    'SELECT * FROM analysis_register WHERE (? IS NULL OR dataset_version_id = ?) ORDER BY id DESC LIMIT ?',
    opts.datasetVersionId ?? null, opts.datasetVersionId ?? null, opts.limit ?? 200
  )
  return {
    totals: registerTotals(project, opts.datasetVersionId),
    entries: rows.map((r) => ({
      id: r.id,
      fingerprint: r.fingerprint,
      datasetVersionId: r.dataset_version_id,
      metadataVersion: r.metadata_version,
      kind: r.kind,
      title: r.title,
      rows: r.n_rows,
      participants: r.n_participants,
      tests: r.test_count,
      appVersion: r.app_version,
      author: r.author_label,
      at: r.created_at,
      record: JSON.parse(r.record_json)
    }))
  }
}
