// Research-context package (ZIP) and chart file exports.
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { renameSync, writeFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { buildContextFiles, type ContextExportOptions, type ContextExportPreview } from '@core/contextExport'
import type { SelectionSpec } from '@core/types'
import type { Project } from './project'
import { buildSnapshot } from './snapshot'
import { getStudyContext } from './curation'
import { sha256 } from './importService'
import { APP_VERSION } from './version'

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
    keyFor: keyFunction(project, options.participantKeyMode)
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
  const manifest = { ...preview.manifestBase, exportId, files: listing }
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

export interface ChartFileInput {
  format: 'svg' | 'png' | 'r'
  data: string
  sidecars?: { settings: string; log: string }
  context?: { datasetVersionId: string; metadataVersion: number; signature: string }
}

/** Writes a chart (or just its analysis log) and, when asked, the settings and log beside it. Returns every file written. */
export function writeChartFiles(project: Project | null, input: ChartFileInput, destPath: string, author: string | null): { fileName: string; files: string[] } {
  if (input.format === 'svg') {
    if (!input.data.trimStart().startsWith('<svg') && !input.data.trimStart().startsWith('<?xml')) throw new Error('Chart data is not SVG.')
    writeFileSync(destPath, input.data, 'utf8')
  } else if (input.format === 'png') {
    const m = /^data:image\/png;base64,(.+)$/.exec(input.data)
    if (!m) throw new Error('Chart data is not a PNG image.')
    writeFileSync(destPath, Buffer.from(m[1], 'base64'))
  } else {
    writeFileSync(destPath, input.data, 'utf8')
  }
  const files = [basename(destPath)]
  if (input.sidecars && input.format !== 'r') {
    const base = destPath.slice(0, destPath.length - extname(destPath).length)
    // Distinctive suffixes, so saving a chart never overwrites an unrelated .json or .R file beside it.
    writeFileSync(`${base}.chart.json`, input.sidecars.settings, 'utf8')
    writeFileSync(`${base}.analysis-log.R`, input.sidecars.log, 'utf8')
    files.push(basename(`${base}.chart.json`), basename(`${base}.analysis-log.R`))
  }
  if (project) {
    project.db.transaction(() => {
      if (input.context) {
        project.db.run(
          'INSERT INTO export_record(id, kind, dataset_version_id, metadata_version, file_name, manifest_json, created_at) VALUES (?,?,?,?,?,?,?)',
          randomUUID(), 'chart', input.context.datasetVersionId, input.context.metadataVersion, basename(destPath),
          JSON.stringify({ format: input.format, files, signature: input.context.signature, appVersion: APP_VERSION }), new Date().toISOString()
        )
      }
      project.audit('export.chart', { format: input.format, file: basename(destPath), files: files.length, signature: input.context?.signature ?? null }, author)
    })
  }
  return { fileName: basename(destPath), files }
}
