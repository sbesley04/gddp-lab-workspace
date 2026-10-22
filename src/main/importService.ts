// Import pipeline: inspect → preview mapping → validate → commit (one transaction).
import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readWorkbook, getCell, type XWorkbook } from '@importer/ooxml'
import { readCsv } from '@importer/csv'
import { buildImportModel, cellText, previewSheets, suggestMapping, type ImportMapping, type ImportModel, type SheetPreview } from '@importer/model'
import { normalizeHeader, columnLetter } from '@core/hash'
import type { Project } from './project'
import { APP_VERSION } from './version'

export interface ParsedSource {
  kind: 'xlsx' | 'csv'
  fileName: string
  size: number
  sha256: string
  bytes: Uint8Array
  wb: XWorkbook
}

export interface InspectResult {
  kind: 'xlsx' | 'csv'
  fileName: string
  size: number
  sha256: string
  sheets: SheetPreview[]
  duplicateOf: { datasetVersionId: string; versionNumber: number; sheetName: string } | null
  csvNotice: string | null
}

export function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function parseSource(bytes: Uint8Array, fileName: string): ParsedSource {
  const lower = fileName.toLowerCase()
  const kind: 'xlsx' | 'csv' = lower.endsWith('.csv') ? 'csv' : 'xlsx'
  const wb = kind === 'csv' ? readCsv(new TextDecoder('utf-8').decode(bytes), fileName.replace(/\.csv$/i, '')) : readWorkbook(bytes)
  return { kind, fileName, size: bytes.byteLength, sha256: sha256(bytes), bytes, wb }
}

export function inspect(project: Project, src: ParsedSource): InspectResult {
  const dup = project.db.get<{ id: string; version_number: number; sheet_name: string }>(
    `SELECT dv.id, dv.version_number, dv.sheet_name FROM dataset_version dv JOIN source_file sf ON sf.id = dv.source_file_id
     WHERE sf.sha256 = ? ORDER BY dv.version_number DESC LIMIT 1`,
    src.sha256
  )
  return {
    kind: src.kind,
    fileName: src.fileName,
    size: src.size,
    sha256: src.sha256,
    sheets: previewSheets(src.wb),
    duplicateOf: dup ? { datasetVersionId: dup.id, versionNumber: dup.version_number, sheetName: dup.sheet_name } : null,
    csvNotice: src.kind === 'csv' ? 'CSV files contain values only: formatting, source colours, QC highlights, comments and workbook metadata are unavailable.' : null
  }
}

export interface MappingPreview {
  sheetName: string
  headerRow: number
  headers: { col: number; letter: string; header: string }[]
  suggestion: { participantColumn: number | null; eventColumn: number | null; basis: 'previous' | 'heuristic' | 'none'; note: string }
  headerDiff: { previousVersion: number; added: string[]; removed: string[] } | null
  sampleRows: { rowNumber: number; participant: string; event: string }[]
}

export function previewMapping(project: Project, src: ParsedSource, sheetName: string, headerRow = 1): MappingPreview {
  const sheet = src.wb.sheets.find((s) => s.name === sheetName)
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found.`)
  const headers = Array.from({ length: sheet.maxCol }, (_, i) => ({ col: i + 1, letter: columnLetter(i + 1), header: normalizeHeader(cellText(getCell(sheet, headerRow, i + 1))) }))
  const byHeader = new Map(headers.map((h) => [h.header, h.col]))
  let suggestion: MappingPreview['suggestion'] = { participantColumn: null, eventColumn: null, basis: 'none', note: 'No identifier column recognised; choose one.' }
  const prev = project.db.get<{ participant_header: string; event_header: string | null; confirmed_at: string }>('SELECT * FROM id_mapping ORDER BY id DESC LIMIT 1')
  if (prev && byHeader.has(prev.participant_header) && (!prev.event_header || byHeader.has(prev.event_header))) {
    suggestion = {
      participantColumn: byHeader.get(prev.participant_header)!,
      eventColumn: prev.event_header ? byHeader.get(prev.event_header)! : null,
      basis: 'previous',
      note: `Reusing the mapping confirmed on ${prev.confirmed_at.slice(0, 10)}. Confirm it still applies.`
    }
  } else {
    const h = suggestMapping(sheet, headerRow)
    if (h.participantColumn)
      suggestion = { ...h, basis: 'heuristic', note: 'Suggested from header names. Confirm before importing.' }
  }
  let headerDiff: MappingPreview['headerDiff'] = null
  const last = project.db.get<{ id: string; version_number: number }>('SELECT id, version_number FROM dataset_version ORDER BY version_number DESC LIMIT 1')
  if (last) {
    const old = new Set(project.db.all<{ header: string }>('SELECT header FROM variable WHERE dataset_version_id = ?', last.id).map((r) => r.header))
    const now = new Set(headers.map((h) => h.header).filter(Boolean))
    headerDiff = { previousVersion: last.version_number, added: [...now].filter((h) => !old.has(h)), removed: [...old].filter((h) => !now.has(h)) }
  }
  const sampleRows: MappingPreview['sampleRows'] = []
  if (suggestion.participantColumn)
    for (let r = headerRow + 1; r <= Math.min(sheet.maxRow, headerRow + 5); r++)
      sampleRows.push({
        rowNumber: r,
        participant: cellText(getCell(sheet, r, suggestion.participantColumn)),
        event: suggestion.eventColumn ? cellText(getCell(sheet, r, suggestion.eventColumn)) : ''
      })
  return { sheetName, headerRow, headers, suggestion, headerDiff, sampleRows }
}

export function validate(src: ParsedSource, mapping: ImportMapping): ImportModel {
  return buildImportModel(src.wb, mapping, src.kind)
}

export interface CommitOptions {
  authorLabel: string | null
  carryOverFrom: string | null
  /** Test hook: throw after inserting cells to prove the transaction rolls back. */
  failAfterCells?: boolean
}

export function commitImport(project: Project, src: ParsedSource, model: ImportModel, opts: CommitOptions): { datasetVersionId: string; versionNumber: number } {
  const blocking = model.issues.filter((i) => i.severity === 'error')
  if (blocking.length) throw new Error(`Import blocked by ${blocking.length} error(s): ${blocking.map((b) => b.message).join(' ')}`)
  const db = project.db
  const now = new Date().toISOString()

  // 1. Read-only snapshot of the original file (content-addressed; written before the DB transaction).
  const ext = src.kind === 'csv' ? 'csv' : 'xlsx'
  const storedName = `${src.sha256}.${ext}`
  const storedPath = join(project.sourcesDir, storedName)
  let wroteSnapshot = false
  if (!existsSync(storedPath)) {
    const tmp = `${storedPath}.partial`
    writeFileSync(tmp, src.bytes)
    // Verify the bytes actually on disk before trusting the snapshot.
    if (sha256(new Uint8Array(readFileSync(tmp))) !== src.sha256) {
      unlinkSync(tmp)
      throw new Error('The stored copy of the source file did not match its checksum; import cancelled.')
    }
    renameSync(tmp, storedPath)
    chmodSync(storedPath, 0o444)
    wroteSnapshot = true
  }

  try {
    return db.transaction(() => {
      let sf = db.get<{ id: number }>('SELECT id FROM source_file WHERE sha256 = ?', src.sha256)
      if (!sf) {
        const r = db.run('INSERT INTO source_file(sha256, original_name, size, kind, stored_name, added_at) VALUES (?,?,?,?,?,?)', src.sha256, src.fileName, src.size, src.kind, storedName, now)
        sf = { id: Number(r.lastInsertRowid) }
      }
      const m = model.mapping
      const pHeader = model.columns.find((c) => c.col === m.participantColumn)!.header
      const eHeader = m.eventColumn ? model.columns.find((c) => c.col === m.eventColumn)!.header : null
      const mapRes = db.run(
        'INSERT INTO id_mapping(sheet_name, participant_header, event_header, header_row, header_signature, confirmed_at, author_label) VALUES (?,?,?,?,?,?,?)',
        m.sheetName, pHeader, eHeader, m.headerRow, sha256(model.columns.map((c) => c.header).join('\u0001')), now, opts.authorLabel
      )
      const versionNumber = (db.get<{ v: number | null }>('SELECT MAX(version_number) AS v FROM dataset_version')?.v ?? 0) + 1
      const id = randomUUID()
      const report = { summary: model.summary, issues: model.issues, sourceKind: model.sourceKind }
      // dataset_version is immutable, so the content hash is computed from the model and re-verified from stored cells below.
      const contentHash = modelContentHash(model)
      db.run(
        `INSERT INTO dataset_version(id, version_number, source_file_id, sheet_name, mapping_id, mapping_json, import_report_json, legend_json, segments_json, content_hash, app_version, created_at, author_label)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, versionNumber, sf.id, model.sheetName, Number(mapRes.lastInsertRowid), JSON.stringify(m), JSON.stringify(report),
        model.legend ? JSON.stringify(model.legend) : null, JSON.stringify(model.segments), contentHash, APP_VERSION, now, opts.authorLabel
      )
      // Visits in first-appearance order. Names only; no dates are assigned.
      const visitIds = new Map<string, string>()
      for (const r of model.rows) {
        if (!visitIds.has(r.eventName)) {
          const vid = randomUUID()
          visitIds.set(r.eventName, vid)
          db.run('INSERT INTO visit(id, dataset_version_id, event_name, sort_order, actual_date) VALUES (?,?,?,?,NULL)', vid, id, r.eventName, visitIds.size)
        }
      }
      const pids = new Map<string, number>()
      model.rows.forEach((r, ri) => {
        let pid = pids.get(r.participantId)
        if (pid === undefined) {
          pid = Number(db.run('INSERT INTO participant(dataset_version_id, source_identifier) VALUES (?,?)', id, r.participantId).lastInsertRowid)
          pids.set(r.participantId, pid)
        }
        db.run('INSERT INTO source_row(dataset_version_id, row_index, row_number, participant_id, visit_id) VALUES (?,?,?,?,?)', id, ri, r.rowNumber, pid, visitIds.get(r.eventName)!)
      })
      model.columns.forEach((c, vi) => {
        db.run(
          `INSERT INTO variable(dataset_version_id, var_index, column_index, column_letter, var_key, header, header_runs_json, role, kind, segment, subsegment,
             aliases_json, attribution_json, header_format_json, quasi_identifier, categories_json, counts_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          id, vi, c.col, c.letter, c.key, c.header, c.headerRuns ? JSON.stringify(c.headerRuns) : null, c.role, c.kind, c.segment, c.subsegment,
          JSON.stringify(c.aliases), c.attribution ? JSON.stringify(c.attribution) : null, JSON.stringify(c.headerFormat), c.quasiIdentifier ? 1 : 0,
          JSON.stringify(c.categories), JSON.stringify(c.counts)
        )
      })
      const ins = 'INSERT INTO cell(dataset_version_id, var_index, row_index, value_kind, raw_text, numeric_value, censor_op, source_type, formula, num_fmt, font_key, fill_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
      model.cells.forEach((col, vi) =>
        col.forEach((cell, ri) => {
          const v = cell.value
          db.run(
            ins, id, vi, ri, v.k,
            v.k === 'missing' ? null : v.raw,
            v.k === 'number' ? v.v : v.k === 'censored' ? v.bound : null,
            v.k === 'censored' ? v.op : null,
            cell.sourceType, cell.formula, cell.numFmt, cell.fontKey, cell.fillKey
          )
        })
      )
      if (opts.failAfterCells) throw new Error('Injected failure after cell insert (test hook).')
      for (const f of model.flags)
        db.run('INSERT INTO format_interpretation(dataset_version_id, row_index, var_index, kind, status, category, format_key, detail) VALUES (?,?,?,?,?,?,?,?)', id, f.row, f.col, f.kind, f.status, f.category, f.formatKey, f.detail)
      for (const a of model.annotations)
        db.run('INSERT INTO annotation(dataset_version_id, address, row_index, var_index, text, author, threaded, created_at) VALUES (?,?,?,?,?,?,?,?)', id, a.address, a.row, a.col, a.text, a.author, a.threaded ? 1 : 0, a.createdAt)
      // Header-derived metadata seeds, recorded as revisions so provenance is auditable.
      for (const c of model.columns)
        for (const [field, seed] of Object.entries(c.seeds))
          db.run(
            'INSERT INTO revision(dataset_version_id, kind, target, field, value_json, status, author_label, reason, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
            id, 'variable_meta', c.key, field, JSON.stringify(seed!.value), seed!.status, 'Importer', seed!.provenance, now
          )
      if (opts.carryOverFrom) carryOver(project, opts.carryOverFrom, id, versionNumber, now, opts.authorLabel)
      const check = datasetContentHash(project, id)
      if (check !== contentHash) throw new Error('Stored observations do not match the parsed source (content hash mismatch); import rolled back.')
      project.audit('dataset.import', { datasetVersionId: id, versionNumber, sha256: src.sha256, sheet: model.sheetName, rows: model.rows.length, columns: model.columns.length }, opts.authorLabel)
      return { datasetVersionId: id, versionNumber }
    })
  } catch (e) {
    if (wroteSnapshot) {
      const referenced = db.get('SELECT 1 FROM source_file WHERE sha256 = ?', src.sha256)
      if (!referenced) {
        try {
          chmodSync(storedPath, 0o644)
          unlinkSync(storedPath)
        } catch {
          /* leave orphan snapshot; harmless */
        }
      }
    }
    throw e
  }
}

function carryOver(project: Project, fromVersion: string, toVersion: string, toNumber: number, now: string, author: string | null) {
  const db = project.db
  const from = db.get<{ version_number: number }>('SELECT version_number FROM dataset_version WHERE id = ?', fromVersion)
  if (!from) return
  const keys = new Set(db.all<{ var_key: string }>('SELECT var_key FROM variable WHERE dataset_version_id = ?', toVersion).map((r) => r.var_key))
  const latest = db.all<{ id: number; kind: string; target: string; field: string | null; value_json: string; status: string }>(
    `SELECT r.* FROM revision r JOIN (SELECT kind, target, IFNULL(field,'') f, MAX(id) mid FROM revision WHERE dataset_version_id = ? AND (author_label IS NULL OR author_label <> 'Importer') GROUP BY kind, target, IFNULL(field,'')) m ON m.mid = r.id`,
    fromVersion
  )
  for (const r of latest) {
    if (r.kind === 'variable_meta' || r.kind === 'quasi_identifier') {
      if (!keys.has(r.target)) continue
    } else if (r.kind !== 'study_context' && r.kind !== 'segment_name') continue
    db.run(
      'INSERT INTO revision(dataset_version_id, kind, target, field, value_json, status, author_label, reason, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      toVersion, r.kind, r.target, r.field, r.value_json, r.status, author, `Carried over from dataset v${from.version_number} (revision #${r.id}) into v${toNumber}`, now
    )
  }
}

function canonicalLine(key: string, participant: string, event: string, kind: string, raw: string | null) {
  return `${key}\t${participant}\t${event}\t${kind}\t${raw ?? ''}\n`
}

export function modelContentHash(model: ImportModel): string {
  const h = createHash('sha256')
  model.columns.forEach((c, vi) =>
    model.rows.forEach((r, ri) => {
      const v = model.cells[vi][ri].value
      h.update(canonicalLine(c.key, r.participantId, r.eventName, v.k, v.k === 'missing' ? null : v.raw))
    })
  )
  return h.digest('hex')
}

/** Recomputes the observation-content hash from stored cells (used after import and after restore). */
export function datasetContentHash(project: Project, datasetVersionId: string): string {
  const h = createHash('sha256')
  const rows = project.db.all<{ var_key: string; pid: string; ev: string; value_kind: string; raw_text: string | null }>(
    `SELECT v.var_key, p.source_identifier pid, vi.event_name ev, c.value_kind, c.raw_text
     FROM cell c
     JOIN variable v ON v.dataset_version_id = c.dataset_version_id AND v.var_index = c.var_index
     JOIN source_row sr ON sr.dataset_version_id = c.dataset_version_id AND sr.row_index = c.row_index
     JOIN participant p ON p.id = sr.participant_id
     JOIN visit vi ON vi.id = sr.visit_id
     WHERE c.dataset_version_id = ? ORDER BY c.var_index, c.row_index`,
    datasetVersionId
  )
  for (const r of rows) h.update(canonicalLine(r.var_key, r.pid, r.ev, r.value_kind, r.raw_text))
  return h.digest('hex')
}
