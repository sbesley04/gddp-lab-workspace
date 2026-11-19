// Research-context package (ZIP) and chart file exports.
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { renameSync, writeFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { buildContextFiles, type ContextExportOptions, type ContextExportPreview } from '@core/contextExport'
import type { ChartConfig, SelectionSpec } from '@core/types'
import { computeSelection } from '@core/selection'
import { buildProvenance, shortFingerprint } from '@core/provenance'
import { normalizeChart } from '@core/chartStyle'
import type { Project } from './project'
import { buildSnapshot } from './snapshot'
import { getStudyContext } from './curation'
import { listRegister, snapshotFor } from './register'
import { sha256 } from './importService'
import { APP_VERSION } from './version'
import { chainHead } from './integrity'

export function projectPseudonym(secretHex: string, participantId: string): string {
  return 'P-' + createHmac('sha256', Buffer.from(secretHex, 'hex')).update(participantId).digest('hex').slice(0, 10).toUpperCase()
}

function keyFunction(project: Project, mode: ContextExportOptions['participantKeyMode']): (pid: string) => string {
  if (mode === 'project_pseudonym') {
    const secret = project.meta('pseudonym_secret')
    if (!secret) throw new Error('Project pseudonym key is missing.')
    return (pid) => projectPseudonym(secret, pid)
  }
  const secret = randomBytes(32).toString('hex')
  return (pid) => projectPseudonym(secret, pid).replace('P-', 'R-')
}

export function previewContextExport(project: Project, spec: SelectionSpec, options: ContextExportOptions, metadataVersion: number): ContextExportPreview {
  const snapshot = buildSnapshot(project, spec.datasetVersionId, metadataVersion)
  return buildContextFiles({
    snapshot,
    spec,
    options,
    studyContext: getStudyContext(project, spec.datasetVersionId, metadataVersion).text,
    appVersion: APP_VERSION,
    createdAt: new Date().toISOString(),
    keyFor: keyFunction(project, options.participantKeyMode),
    analysisRegister: listRegister(project, { datasetVersionId: spec.datasetVersionId, limit: 100000 })
      .entries.reverse()
      .map((e) => ({ fingerprint: e.fingerprint, at: e.at, appVersion: e.appVersion, record: e.record }))
  })
}

export interface ContextExportResult {
  fileName: string
  bytes: number
  files: { name: string; sha256: string; bytes: number }[]
  manifest: Record<string, unknown>
}

export function writeContextExport(project: Project, spec: SelectionSpec, options: ContextExportOptions, metadataVersion: number, destPath: string, author: string | null): ContextExportResult {
  const preview = previewContextExport(project, spec, options, metadataVersion)
  if (preview.blockingQuasiIdentifiers.length)
    throw new Error(`Review quasi-identifiers before export: ${preview.blockingQuasiIdentifiers.join(', ')}. Confirm or remove them.`)
  if (preview.rows === 0) throw new Error('The selection contains no rows; nothing to export.')
  const encoded: Record<string, Uint8Array> = {}
  const listing: ContextExportResult['files'] = []
  for (const [name, text] of Object.entries(preview.files)) {
    const u8 = strToU8(text)
    encoded[name] = u8
    listing.push({ name, sha256: sha256(u8), bytes: u8.byteLength })
  }
  const exportId = randomUUID()
  // The chain head at export time: comparing it with the project later shows whether earlier records were rewritten.
  const manifest = { ...preview.manifestBase, exportId, integrity: { head: chainHead(project.db) }, files: listing }
  encoded['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))
  const zip = zipSync(encoded, { level: 6 })
  const tmp = `${destPath}.partial`
  writeFileSync(tmp, zip)
  renameSync(tmp, destPath)
  project.db.transaction(() => {
    project.db.run(
      'INSERT INTO export_record(id, kind, dataset_version_id, metadata_version, file_name, manifest_json, created_at) VALUES (?,?,?,?,?,?,?)',
      exportId, 'context', spec.datasetVersionId, metadataVersion, basename(destPath), JSON.stringify(manifest), new Date().toISOString()
    )
    project.audit('export.context', { exportId, file: basename(destPath), rows: preview.rows, variables: preview.variables.length, keyMode: options.participantKeyMode }, author)
  })
  return { fileName: basename(destPath), bytes: zip.byteLength, files: listing, manifest }
}

export function listExports(project: Project) {
  return project.db.all<any>('SELECT id, kind, dataset_version_id, metadata_version, file_name, created_at FROM export_record ORDER BY created_at DESC LIMIT 200')
}

export const CHART_SETTINGS_SCHEMA = 'bari-chart/2'

export interface ChartFileInput {
  format: 'svg' | 'png' | 'r'
  /** The drawn image (SVG text or a PNG data URL). Ignored for 'r': the log is written by this process. */
  data: string
  /** Also write the settings and the analysis log beside the image. */
  sidecars?: boolean
  /** The first characters of the fingerprint the renderer printed in the image footer, when it added one. */
  stamped?: string | null
  /**
   * What the chart shows. From it this process rebuilds the analysis log, the fingerprint and the settings file;
   * none of those is accepted from the renderer. Absent for images with no single selection (Compare boards).
   */
  context?: { spec: SelectionSpec; chart: ChartConfig; metadataVersion: number }
}

/** The analysis log, fingerprint and settings for a chart, recomputed here from the selection and chart settings. */
export function chartRecord(project: Project, context: NonNullable<ChartFileInput['context']>) {
  if (!project.db.get('SELECT 1 FROM dataset_version WHERE id = ?', context.spec.datasetVersionId)) throw new Error('Dataset version not found.')
  if (context.metadataVersion > project.metadataVersion()) throw new Error('Metadata version is newer than this project.')
  const snapshot = snapshotFor(project, context.spec.datasetVersionId, context.metadataVersion)
  const sel = computeSelection(snapshot, context.spec)
  const provenance = buildProvenance({ snapshot, spec: context.spec, chart: context.chart, sel, appVersion: APP_VERSION })
  const settings = {
    schema: CHART_SETTINGS_SCHEMA,
    createdAt: new Date().toISOString(),
    app: APP_VERSION,
    fingerprint: provenance.fingerprint,
    dataset: { versionId: snapshot.datasetVersionId, versionNumber: snapshot.versionNumber, sourceSha256: snapshot.sourceSha256, metadataVersion: snapshot.metadataVersion },
    selection: context.spec,
    result: { rows: sel.rows.length, participants: sel.participantIds.length },
    chart: normalizeChart(context.chart),
    steps: provenance.steps.map((s) => ({ n: s.n, fingerprint: s.fingerprint, title: s.title }))
  }
  return { snapshot, provenance, settings }
}

/**
 * Writes a chart (or just its analysis log) and, when asked, the settings and log beside it. Returns every file
 * written. Only the drawn image comes from the renderer; the log, settings and fingerprint are rebuilt here, and an
 * image whose footer carries a different fingerprint is refused.
 */
export function writeChartFiles(project: Project | null, input: ChartFileInput, destPath: string, author: string | null): { fileName: string; files: string[]; fingerprint: string | null } {
  const record = input.context ? chartRecord(requireProjectFor(project), input.context) : null
  if (input.format === 'r' && !record) throw new Error('An analysis log needs the selection and chart it describes.')
  if (record && input.stamped && input.stamped !== shortFingerprint(record.provenance.fingerprint))
    throw new Error('The chart on screen does not match the selection recorded for it, so nothing was saved. Wait for the chart to finish redrawing and try again.')
  if (input.format === 'svg') {
    if (!input.data.trimStart().startsWith('<svg') && !input.data.trimStart().startsWith('<?xml')) throw new Error('Chart data is not SVG.')
    if (record && input.stamped && !input.data.includes(`analysis ${input.stamped}`)) throw new Error('The chart footer does not carry the fingerprint it claims, so nothing was saved.')
    writeFileSync(destPath, input.data, 'utf8')
  } else if (input.format === 'png') {
    const m = /^data:image\/png;base64,(.+)$/.exec(input.data)
    if (!m) throw new Error('Chart data is not a PNG image.')
    writeFileSync(destPath, Buffer.from(m[1], 'base64'))
  } else {
    writeFileSync(destPath, record!.provenance.text, 'utf8')
  }
  const files = [basename(destPath)]
  if (record && input.sidecars && input.format !== 'r') {
    const base = destPath.slice(0, destPath.length - extname(destPath).length)
    // Distinctive suffixes, so saving a chart never overwrites an unrelated .json or .R file beside it.
    writeFileSync(`${base}.chart.json`, JSON.stringify(record.settings, null, 2), 'utf8')
    writeFileSync(`${base}.analysis-log.R`, record.provenance.text, 'utf8')
    files.push(basename(`${base}.chart.json`), basename(`${base}.analysis-log.R`))
  }
  const fingerprint = record?.provenance.fingerprint ?? null
  if (project) {
    project.db.transaction(() => {
      if (record) {
        project.db.run(
          'INSERT INTO export_record(id, kind, dataset_version_id, metadata_version, file_name, manifest_json, created_at) VALUES (?,?,?,?,?,?,?)',
          randomUUID(), 'chart', record.snapshot.datasetVersionId, record.snapshot.metadataVersion, basename(destPath),
          JSON.stringify({ format: input.format, files, fingerprint, appVersion: APP_VERSION }), new Date().toISOString()
        )
      }
      project.audit('export.chart', { format: input.format, file: basename(destPath), files: files.length, fingerprint }, author)
    })
  }
  return { fileName: basename(destPath), files, fingerprint }
}

function requireProjectFor(project: Project | null): Project {
  if (!project) throw new Error('No project is open.')
  return project
}
