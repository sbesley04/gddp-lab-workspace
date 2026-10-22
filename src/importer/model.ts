// Builds a reviewable import model (columns, rows, classified values, formatting interpretations,
// annotations and validation issues) from a parsed workbook. Nothing here mutates the source.

import type {
  Alias,
  CellValue,
  ColorRef,
  InterpretationKind,
  InterpretationStatus,
  MetaFieldName,
  MetaStatus,
  QcCategory,
  RichRun,
  SourceAttribution,
  VariableKind,
  VariableRole
} from '@core/types'
import { classifyValue, identifierText } from '@core/values'
import { colorKey, describeColorRef, isBlackish, rgbDistance } from '@core/colors'
import { columnLetter, normalizeHeader, variableKey, parseAddress } from '@core/hash'
import type { XCell, XSheet, XStyle, XWorkbook } from './ooxml'
import { getCell } from './ooxml'
import { findLegendSheet, parseLegend, type Legend, type LegendRule } from './legend'

export interface ImportMapping {
  sheetName: string
  headerRow: number
  participantColumn: number // 1-based
  eventColumn: number | null // 1-based; null = single unnamed visit
}

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
  locations: string[]
  count: number
}

export interface SeedField {
  value: string | null
  status: MetaStatus
  provenance: string
}

export interface ColumnModel {
  col: number
  letter: string
  header: string
  headerRuns: RichRun[] | null
  key: string
  role: VariableRole
  kind: VariableKind
  segment: number | null
  subsegment: number | null
  seeds: Partial<Record<MetaFieldName, SeedField>>
  aliases: Alias[]
  attribution: SourceAttribution | null
  quasiIdentifier: boolean
  headerFormat: { font: string; fill: string | null; italic: boolean; bold: boolean; note: string | null }
  categories: string[]
  counts: { number: number; missing: number; censored: number; text: number }
}

export interface StoredCell {
  value: CellValue
  sourceType: string
  formula: string | null
  numFmt: string | null
  fontKey: string | null
  fillKey: string | null
}

export interface ImportFlag {
  row: number // row index in model.rows
  col: number // index into model.columns
  kind: InterpretationKind
  status: InterpretationStatus
  category: QcCategory | null
  formatKey: string
  detail: string
}

export interface ImportAnnotation {
  address: string
  row: number | null
  col: number | null
  text: string
  author: string | null
  threaded: boolean
  createdAt: string | null
}

export interface Segment {
  index: number
  startCol: number
  endCol: number
  name: string | null
  status: MetaStatus
  note: string
}

export interface ImportModel {
  sourceKind: 'xlsx' | 'csv'
  sheetName: string
  mapping: ImportMapping
  columns: ColumnModel[]
  rows: { rowNumber: number; participantId: string; eventName: string }[]
  cells: StoredCell[][] // [colIndex][rowIndex]
  flags: ImportFlag[]
  annotations: ImportAnnotation[]
  legend: Legend | null
  segments: Segment[]
  issues: ValidationIssue[]
  summary: {
    dataRows: number
    columns: number
    participants: number
    events: string[]
    blankColumns: string[]
    comments: number
    richHeaders: number
    formulaCells: number
    flagCounts: Record<string, number>
  }
}

export interface SheetPreview {
  name: string
  state: string
  rows: number
  columns: number
  headers: string[]
  isLegendLikely: boolean
  comments: number
}

export function previewSheets(wb: XWorkbook): SheetPreview[] {
  return wb.sheets.map((s) => ({
    name: s.name,
    state: s.state,
    rows: s.maxRow,
    columns: s.maxCol,
    headers: Array.from({ length: Math.min(s.maxCol, 12) }, (_, i) => cellText(getCell(s, 1, i + 1))),
    isLegendLikely: /legend/i.test(s.name),
    comments: s.comments.length
  }))
}

export function cellText(c: XCell | undefined): string {
  if (!c || c.value === null) return ''
  return typeof c.value === 'boolean' ? (c.value ? 'TRUE' : 'FALSE') : String(c.value)
}

export function suggestMapping(sheet: XSheet, headerRow = 1): { participantColumn: number | null; eventColumn: number | null } {
  let participantColumn: number | null = null
  let eventColumn: number | null = null
  for (let c = 1; c <= sheet.maxCol; c++) {
    const h = normalizeHeader(cellText(getCell(sheet, headerRow, c)))
    if (participantColumn === null && /^(subject[_ ]?id|participant[_ ]?id|record[_ ]?id|ptid|patient[_ ]?id)$/i.test(h)) participantColumn = c
    if (eventColumn === null && /^(event[_ ]?name|redcap[_ ]?event[_ ]?name|visit([_ ]?name)?|timepoint)$/i.test(h)) eventColumn = c
  }
  return { participantColumn, eventColumn }
}

const QI_RE = /\b(age|sex|gender|race|ethnic\w*|bmi|height|weight|birth|dob|zip|postal|date|dates?)\b/i
const UNIT_RE = /\((mcL|µL|uL|%|K\/mcL|mg\/dL|g\/dL|seconds|sec|ms|pg\/mL|ng\/mL|cells\/mcL|copies\/mL|mm\/hr|years|kg\/m2|kg\/m²)\)/i

function headerTokens(h: string): string {
  return h.replace(/_/g, ' ')
}

function scoreTypeOf(h: string): string | null {
  const t = headerTokens(h)
  if (/clinic|clinc/i.test(t) && /T-?score|\bT\b/i.test(t)) return 'Clinic T-score'
  if (/clinic|clinc/i.test(t)) return 'Clinic score'
  if (/T-?score|\bT$/i.test(t)) return 'T-score'
  if (/scaled|\bSS$/i.test(t)) return 'Scaled score'
  if (/\(raw\)|\braw\b/i.test(t)) return 'Raw score'
  if (/%$|percentage/i.test(t)) return 'Percentage'
  if (/total score|total$|sum$/i.test(t)) return 'Total score'
  return null
}

function specimenOf(h: string): string | null {
  // Only when the header names the specimen explicitly; never inferred from a biomarker name.
  if (/\bCSF\b/.test(h)) return 'CSF'
  if (/^PBMC[_ ]/i.test(h)) return 'PBMC'
  if (/^Cryopreserved[_ ]/i.test(h)) return 'Cryopreserved cells (type not stated)'
  return null
}

const MAJOR = new Set(['medium', 'thick', 'double'])

function segmentsFrom(sheet: XSheet, styles: XStyle[], headerRow: number, maxCol: number, legend: Legend | null): { major: Segment[]; minorOf: number[]; notes: string[] } {
  const notes: string[] = []
  const style = (c: number) => {
    const cell = getCell(sheet, headerRow, c)
    return cell ? styles[cell.style] : undefined
  }
  const majorStarts: number[] = [1]
  const minorStarts: number[] = [1]
  let usedStyles = new Set<string>()
  for (let c = 2; c <= maxCol; c++) {
    const left = style(c)?.border.left ?? null
    const prevRight = style(c - 1)?.border.right ?? null
    if ((left && MAJOR.has(left)) || (prevRight && MAJOR.has(prevRight))) {
      majorStarts.push(c)
      minorStarts.push(c)
      usedStyles.add((left && MAJOR.has(left) ? left : prevRight) as string)
    } else if (left === 'thin' || prevRight === 'thin') minorStarts.push(c)
  }
  const groupRule = legend?.rules.find((r) => r.kind === 'group_major')
  const names = groupRule?.groups ?? []
  if (groupRule && /thick/i.test(groupRule.label) && !usedStyles.has('thick') && usedStyles.size) {
    notes.push(`Legend describes "${groupRule.label}" but the workbook uses ${[...usedStyles].join('/')} borders; treated as the same separator (tentative).`)
  }
  const major: Segment[] = majorStarts.map((start, i) => ({
    index: i,
    startCol: start,
    endCol: (majorStarts[i + 1] ?? maxCol + 1) - 1,
    name: null,
    status: 'unknown' as MetaStatus,
    note: ''
  }))
  if (names.length) {
    const range = (s: Segment) => `${columnLetter(s.startCol)}–${columnLetter(s.endCol)}`
    if (names.length === major.length) {
      major.forEach((s, i) => {
        s.name = names[i]
        s.status = 'tentative'
        s.note = `Named from legend order (${range(s)}).`
      })
    } else if (major.length > names.length) {
      const n = names.length
      major.forEach((s, i) => {
        if (i < n - 1) s.name = names[i]
        else if (i === major.length - 1) s.name = names[n - 1]
        else s.name = names[n - 2]
        s.status = 'tentative'
        s.note = `Workbook has ${major.length} border segments but the legend lists ${n} groups; ${range(s)} assigned "${s.name}" by aligning both ends. Needs curator review.`
      })
      notes.push(`Border segments (${major.length}) do not match the legend's ${n} groups; group names are tentative and need review.`)
    } else {
      major.forEach((s, i) => {
        s.name = names[i]
        s.status = 'tentative'
        s.note = 'Fewer border segments than legend groups; assigned left to right. Needs review.'
      })
      notes.push(`Fewer border segments (${major.length}) than legend groups (${names.length}).`)
    }
  }
  const minorOf: number[] = new Array(maxCol + 1).fill(0)
  let k = -1
  for (let c = 1; c <= maxCol; c++) {
    if (minorStarts.includes(c)) k++
    minorOf[c] = k
  }
  return { major, minorOf, notes }
}

function sameColor(a: ColorRef | null | undefined, b: ColorRef | null | undefined): boolean {
  if (!a && !b) return true
  const ra = a?.resolved ?? (a ? null : '000000')
  const rb = b?.resolved ?? (b ? null : '000000')
  if (colorKey(a) === colorKey(b)) return true
  return !!ra && !!rb && ra === rb
}

/** Default text colour (unset, automatic or theme dk1) is indistinguishable from the legend's "Black". */
function isDefaultText(ref: ColorRef | null | undefined): boolean {
  return !ref || ref.auto === true || ref.theme === 1 || (ref.indexed !== undefined && ref.indexed === 64)
}

function matchSourceRule(legend: Legend | null, color: ColorRef | null): LegendRule | null {
  if (!legend) return null
  return legend.rules.find((r) => r.kind === 'source' && sameColor(r.font?.color, color)) ?? null
}

export function buildImportModel(wb: XWorkbook, mapping: ImportMapping, sourceKind: 'xlsx' | 'csv' = 'xlsx'): ImportModel {
  const sheet = wb.sheets.find((s) => s.name === mapping.sheetName)
  if (!sheet) throw new Error(`Sheet "${mapping.sheetName}" not found.`)
  const issues: ValidationIssue[] = []
  const issue = (severity: ValidationIssue['severity'], code: string, message: string, locations: string[] = []) =>
    issues.push({ severity, code, message, locations: locations.slice(0, 60), count: locations.length || 1 })
  const styles = wb.styles
  const hr = mapping.headerRow
  const maxCol = Math.max(sheet.maxCol, ...[...(sheet.cells.get(hr)?.keys() ?? [])].filter((c) => getCell(sheet, hr, c)?.value !== null))
  const legend = sourceKind === 'xlsx' ? (() => {
    const ls = findLegendSheet(wb, sheet.name)
    return ls ? parseLegend(wb, ls) : null
  })() : null
  if (sourceKind === 'csv') issue('info', 'csv_no_formatting', 'CSV import: formatting, comments, source colours and workbook metadata are not available.')
  else if (!legend) issue('warning', 'no_legend', 'No formatting legend sheet was found. Formatting is preserved but cannot be interpreted.')
  for (const n of legend?.notes ?? []) issue('warning', 'legend_unmatched', n)
  for (const w of wb.warnings) issue('warning', 'workbook_warning', w)
  if (wb.formulaCells) issue('info', 'formulas', `${wb.formulaCells} formula cell(s): cached values were imported; formulas are preserved as text and not recalculated.`)

  // ---- rows ----
  const dataRowNumbers: number[] = []
  const emptyRows: string[] = []
  for (let r = hr + 1; r <= sheet.maxRow; r++) {
    const rowMap = sheet.cells.get(r)
    const hasValue = rowMap && [...rowMap.values()].some((c) => c.value !== null && !(typeof c.value === 'string' && c.value.trim() === ''))
    if (hasValue) dataRowNumbers.push(r)
    else emptyRows.push(String(r))
  }
  if (emptyRows.length) issue('info', 'empty_rows', `${emptyRows.length} wholly empty row(s) inside the data range were not imported as records.`, emptyRows.map((r) => `row ${r}`))

  const rows: ImportModel['rows'] = []
  const missingIds: string[] = []
  const missingEvents: string[] = []
  const keyRows = new Map<string, number[]>()
  for (const r of dataRowNumbers) {
    const pid = identifierText(getCell(sheet, r, mapping.participantColumn)?.value)
    const ev = mapping.eventColumn ? identifierText(getCell(sheet, r, mapping.eventColumn)?.value) : '(single visit)'
    if (!pid) missingIds.push(`${columnLetter(mapping.participantColumn)}${r}`)
    if (!ev) missingEvents.push(`${columnLetter(mapping.eventColumn!)}${r}`)
    const key = `${pid}\u0000${ev}`
    keyRows.set(key, [...(keyRows.get(key) ?? []), r])
    rows.push({ rowNumber: r, participantId: pid ?? '', eventName: ev ?? '' })
  }
  if (missingIds.length) issue('error', 'missing_ids', `${missingIds.length} row(s) have no participant identifier. Fix the source and re-import; rows are never dropped or invented.`, missingIds)
  if (missingEvents.length) issue('error', 'missing_events', `${missingEvents.length} row(s) have no visit/event value.`, missingEvents)
  const dupes = [...keyRows.entries()].filter(([, rs]) => rs.length > 1)
  if (dupes.length)
    issue(
      'error',
      'duplicate_keys',
      `${dupes.length} participant/event key(s) appear in more than one row. Duplicates are never merged automatically; resolve them in the source.`,
      dupes.map(([k, rs]) => `${k.replace('\u0000', ' @ ')}: rows ${rs.join(', ')}`)
    )

  const { major, minorOf, notes } = segmentsFrom(sheet, styles, hr, maxCol, legend)
  for (const n of notes) issue('warning', 'group_borders', n)
  const segOf = (c: number) => major.find((s) => c >= s.startCol && c <= s.endCol)

  // ---- columns ----
  const columns: ColumnModel[] = []
  const cells: StoredCell[][] = []
  const flags: ImportFlag[] = []
  const headerSeen = new Map<string, string[]>()
  const blankHeaders: string[] = []
  const blankColumns: string[] = []
  const mixedCols: string[] = []
  const numericText: string[] = []
  const dateCols: string[] = []
  const censoredCells: string[] = []
  let richHeaders = 0

  for (let c = 1; c <= maxCol; c++) {
    const letter = columnLetter(c)
    const hcell = getCell(sheet, hr, c)
    const hstyle = hcell ? styles[hcell.style] : styles[0]
    let header = normalizeHeader(cellText(hcell))
    if (!header) {
      blankHeaders.push(`${letter}${hr}`)
      header = `(blank header, column ${letter})`
    }
    headerSeen.set(header, [...(headerSeen.get(header) ?? []), letter])

    const colCells: StoredCell[] = []
    const counts = { number: 0, missing: 0, censored: 0, text: 0 }
    const cats = new Set<string>()
    let hasDate = false
    for (const rn of dataRowNumbers) {
      const cell = getCell(sheet, rn, c)
      const st = cell ? styles[cell.style] : undefined
      const value = classifyValue(cell?.value ?? null)
      counts[value.k]++
      if (value.k === 'text') cats.add(value.raw.trim())
      if (value.k === 'censored') censoredCells.push(`${letter}${rn}`)
      if (value.k === 'number' && typeof cell?.value === 'string') numericText.push(`${letter}${rn}`)
      if (value.k === 'number' && st?.isDateFormat) hasDate = true
      colCells.push({
        value,
        sourceType: cell?.type ?? 'blank',
        formula: cell?.formula ?? null,
        numFmt: st && st.numFmtId ? st.numFmtCode ?? `builtin:${st.numFmtId}` : null,
        fontKey: st?.font.color ? colorKey(st.font.color) : null,
        fillKey: st?.fill.pattern ? colorKey(st.fill.fg) : null
      })
    }
    cells.push(colCells)
    const present = counts.number + counts.censored + counts.text
    let role: VariableRole = 'measure'
    if (c === mapping.participantColumn) role = 'participant_id'
    else if (c === mapping.eventColumn) role = 'event'
    else if (present === 0) {
      role = 'blank'
      blankColumns.push(`${letter} "${header}"`)
    }
    const kind: VariableKind = present === 0 ? 'empty' : counts.text === 0 ? 'numeric' : counts.number + counts.censored === 0 ? 'categorical' : 'mixed'
    if (kind === 'mixed' && role === 'measure') mixedCols.push(`${letter} (${counts.text} text value(s))`)
    if (hasDate) dateCols.push(letter)

    // Header formatting and source attribution
    const runs: RichRun[] | null = hcell?.rich
      ? hcell.rich.map((run) => {
          const f = run.font ?? hstyle.font
          return { text: run.text, color: f.color?.resolved ?? null, colorRef: f.color, bold: f.bold, italic: f.italic }
        })
      : null
    const aliases: Alias[] = []
    let attribution: SourceAttribution | null = null
    if (legend && sourceKind === 'xlsx') {
      const italic = hstyle.font.italic
      const multi = runs && new Set(runs.filter((r) => r.text.replace(/[\s/]/g, '')).map((r) => colorKey(r.colorRef))).size > 1
      if (multi && runs) {
        richHeaders++
        // Group consecutive runs of the same colour, dropping "/" separators.
        const parts: { text: string; color: ColorRef | null }[] = []
        for (const r of runs) {
          const last = parts[parts.length - 1]
          if (last && colorKey(last.color) === colorKey(r.colorRef)) last.text += r.text
          else parts.push({ text: r.text, color: r.colorRef })
        }
        for (const p of parts) {
          const text = normalizeHeader(p.text.replace(/^\s*\/\s*|\s*\/\s*$/g, ''))
          if (!text || text === '/') continue
          const rule = matchSourceRule(legend, p.color)
          aliases.push({
            text,
            source: rule?.source ?? null,
            status: rule ? 'tentative' : 'unknown',
            provenance: rule ? `Header rich text, ${describeColorRef(p.color)} → legend ${rule.address}` : `Header rich text, ${describeColorRef(p.color)} (not in legend)`
          })
        }
        attribution = {
          source: null,
          mode: 'identical_across_sources',
          status: aliases.every((a) => a.source) ? 'legend_exact' : 'needs_review',
          note:
            'Bold multicoloured header: legend says values are identical between the colour-coded source variables listed as aliases.' +
            (italic ? ' Header is also italic: column data came from multiple spreadsheets; per-cell font colours give each cell’s source.' : '')
        }
      } else if (italic) {
        attribution = { source: null, mode: 'mixed_source', status: 'legend_exact', note: 'Italic header: column data acquired from multiple spreadsheets; per-cell font colours give each cell’s source.' }
      } else {
        const rule = matchSourceRule(legend, hstyle.font.color)
        if (rule) {
          const tentative = isDefaultText(hstyle.font.color)
          attribution = {
            source: rule.source,
            mode: 'whole_column',
            status: tentative ? 'legend_tentative' : 'legend_exact',
            note: tentative
              ? `Header uses the default text colour, which is indistinguishable from the legend's "${rule.label}". Attribution is tentative.`
              : `Header font ${describeColorRef(hstyle.font.color)} matches legend "${rule.label}" (${rule.address}).`
          }
        } else {
          attribution = { source: null, mode: 'unresolved', status: 'unresolved', note: `Header font ${describeColorRef(hstyle.font.color)} is not described in the legend.` }
        }
      }
    }

    const seg = segOf(c)
    const seeds: ColumnModel['seeds'] = {}
    const tent = (value: string | null, provenance: string): SeedField => ({ value, status: value ? 'tentative' : 'unknown', provenance })
    seeds.displayLabel = { value: aliases[0]?.text && aliases.length > 1 ? aliases[0].text : header, status: 'tentative', provenance: 'Original header' }
    seeds.area = seg?.name ? { value: seg.name, status: 'tentative', provenance: `Legend group order + border segment ${columnLetter(seg.startCol)}–${columnLetter(seg.endCol)}` } : tent(null, 'Not documented')
    const unit = UNIT_RE.exec(header)?.[1] ?? null
    seeds.unit = tent(unit, unit ? 'Header text (parenthesised unit)' : 'Not stated in header')
    const spec = specimenOf(header)
    seeds.specimen = tent(spec, spec ? 'Header text names the specimen' : 'Not stated in header')
    const assay = seg?.name && /nulisa/i.test(seg.name) ? 'NULISA (AQ panel per legend group name)' : null
    seeds.assay = tent(assay, assay ? 'Legend group name' : 'Not documented')
    const score = role === 'measure' ? scoreTypeOf(header) : null
    seeds.scoreType = tent(score, score ? 'Header wording' : 'Not stated in header')
    seeds.definition = { value: null, status: 'unknown', provenance: 'Awaiting curator' }
    seeds.source = attribution?.source
      ? { value: attribution.source, status: attribution.status === 'legend_exact' ? 'tentative' : 'tentative', provenance: 'Legend font colour' }
      : { value: null, status: 'unknown', provenance: attribution ? attribution.mode.replace(/_/g, ' ') : 'Not documented' }

    const hf = hstyle.fill.pattern ? hstyle.fill.fg : null
    columns.push({
      col: c,
      letter,
      header,
      headerRuns: runs,
      key: variableKey(header),
      role,
      kind,
      segment: seg ? seg.index : null,
      subsegment: minorOf[c] ?? null,
      seeds,
      aliases,
      attribution,
      quasiIdentifier: role === 'measure' && QI_RE.test(headerTokens(header)),
      headerFormat: {
        font: describeColorRef(hstyle.font.color),
        fill: hf ? describeColorRef(hf) : null,
        italic: hstyle.font.italic,
        bold: hstyle.font.bold,
        note: hf ? `Header cell has fill ${describeColorRef(hf)}${hf.resolved ? ` (#${hf.resolved})` : ''}; meaning not documented for header cells.` : null
      },
      categories: [...cats].sort(),
      counts
    })
  }

  // Disambiguate duplicate keys (duplicate headers) by column letter.
  const keyCount = new Map<string, number>()
  for (const col of columns) keyCount.set(col.key, (keyCount.get(col.key) ?? 0) + 1)
  for (const col of columns) if ((keyCount.get(col.key) ?? 0) > 1) col.key = `${col.key}_${col.letter.toLowerCase()}`

  const dupHeaders = [...headerSeen.entries()].filter(([, l]) => l.length > 1)
  if (dupHeaders.length) issue('warning', 'duplicate_headers', `${dupHeaders.length} header text(s) occur in more than one column; each column is kept separately with its column letter.`, dupHeaders.map(([h, l]) => `"${h}": ${l.join(', ')}`))
  if (blankHeaders.length) issue('warning', 'blank_headers', `${blankHeaders.length} column(s) have data but no header.`, blankHeaders)
  if (blankColumns.length) issue('info', 'blank_columns', `${blankColumns.length} column(s) contain no data. They are preserved but hidden from the measurement picker.`, blankColumns)
  if (mixedCols.length) issue('warning', 'mixed_types', `${mixedCols.length} column(s) mix numbers and text. Text entries are kept and counted as non-numeric; they are never converted.`, mixedCols)
  if (numericText.length) issue('info', 'numbers_as_text', `${numericText.length} cell(s) store numbers as text; they are read as numbers with the original text preserved.`, numericText)
  if (dateCols.length) issue('warning', 'date_formatted', `${dateCols.length} column(s) are date-formatted; values are kept as Excel serial numbers. No visit dates are inferred.`, dateCols)
  if (censoredCells.length) issue('info', 'censored', `${censoredCells.length} censored value(s) such as "<x" were found; the bound is kept and never substituted for the value.`, censoredCells)
  const ambiguous = columns.filter((c) => /^(total )?score$/i.test(c.header) || /^value$/i.test(c.header))
  if (ambiguous.length) issue('warning', 'ambiguous_headers', `${ambiguous.length} header(s) are ambiguous without context; definitions need curator input.`, ambiguous.map((c) => `${c.letter} "${c.header}"`))
  const inconsistent = columns.filter((c) => c.aliases.length > 1 && aliasLooksInconsistent(c.aliases))
  if (inconsistent.length) issue('warning', 'alias_inconsistent', `${inconsistent.length} multi-source header(s) have aliases that name different tests; check the source labels.`, inconsistent.map((c) => `${c.letter}: ${c.aliases.map((a) => a.text).join(' / ')}`))

  // ---- cell formatting interpretations ----
  if (legend && sourceKind === 'xlsx') applyCellFormatting(sheet, styles, legend, columns, dataRowNumbers, flags, issue)

  // ---- annotations ----
  const annotations: ImportAnnotation[] = sheet.comments.map((cm) => {
    const { row, col } = parseAddress(cm.address)
    const ri = row === hr ? null : dataRowNumbers.indexOf(row)
    const ci = columns.findIndex((c) => c.col === col)
    return { address: cm.address, row: ri === -1 ? null : ri, col: ci === -1 ? null : ci, text: cm.text, author: cm.author, threaded: cm.threaded, createdAt: cm.createdAt }
  })

  const flagCounts: Record<string, number> = {}
  for (const f of flags) {
    const k = f.category ?? f.kind
    flagCounts[k] = (flagCounts[k] ?? 0) + 1
  }
  return {
    sourceKind,
    sheetName: sheet.name,
    mapping,
    columns,
    rows,
    cells,
    flags,
    annotations,
    legend,
    segments: major,
    issues,
    summary: {
      dataRows: rows.length,
      columns: columns.length,
      participants: new Set(rows.map((r) => r.participantId)).size,
      events: [...new Set(rows.map((r) => r.eventName))],
      blankColumns,
      comments: annotations.length,
      richHeaders,
      formulaCells: wb.formulaCells,
      flagCounts
    }
  }
}

const TEST_TOKENS = ['TRAILS', 'STROOP', 'BVMT', 'HVLT', 'COWA', 'WCST', 'WRAT', 'GROOVED', 'DIGIT', 'LETTER', 'PHQ', 'BDI', 'SHAPS']

function testTokens(s: string): Set<string> {
  const u = s.toUpperCase().replace(/BMVT/g, 'BVMT').replace(/COWAT/g, 'COWA').replace(/HOPKINS VERBAL/g, 'HVLT').replace(/\bGPB\b|PEG ?BOARD/g, 'GROOVED')
  return new Set(TEST_TOKENS.filter((t) => u.includes(t)))
}

function trialLetters(s: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of s.matchAll(/\b([A-Za-z]{3,})\s+([A-Z])\b/g)) out.set(m[1].toUpperCase().slice(0, 4), m[2])
  return out
}

/** True when a later alias names a different test, or a different trial letter, than the first alias. */
export function aliasLooksInconsistent(aliases: Alias[]): boolean {
  const first = aliases[0].text
  const ft = testTokens(first)
  const fl = trialLetters(first)
  return aliases.slice(1).some((a) => {
    const t = testTokens(a.text)
    if ([...t].some((x) => !ft.has(x))) return true
    for (const [w, letter] of trialLetters(a.text)) if (fl.has(w) && fl.get(w) !== letter) return true
    return false
  })
}

function applyCellFormatting(
  sheet: XSheet,
  styles: XStyle[],
  legend: Legend,
  columns: ColumnModel[],
  dataRowNumbers: number[],
  flags: ImportFlag[],
  issue: (s: ValidationIssue['severity'], code: string, message: string, loc?: string[]) => void
) {
  const qcRules = legend.rules.filter((r) => r.kind === 'qc_sample' || r.kind === 'qc_target' || r.kind === 'qc_both')
  const otherRule = legend.rules.find((r) => r.kind === 'unconfirmed_highlight')
  const kindToCat: Record<string, QcCategory> = { qc_sample: 'sample_warning', qc_target: 'target_warning', qc_both: 'both_warnings' }
  const possibleCat: Record<string, QcCategory> = { qc_sample: 'possible_sample_warning', qc_target: 'possible_target_warning', qc_both: 'possible_target_warning' }

  // First pass: exact QC fill matches, to learn which border segments the legend's QC rules apply to.
  type Pending = { ri: number; ci: number; fill: ColorRef; key: string }
  const pending: Pending[] = []
  const qcSegments = new Set<number>()
  const unresolvedFonts: string[] = []
  columns.forEach((col, ci) => {
    if (col.role === 'blank') return
    const mixed = col.attribution?.mode === 'mixed_source' || /also italic/.test(col.attribution?.note ?? '')
    const headerStyle = styles[getCell(sheet, 1, col.col)?.style ?? 0]
    dataRowNumbers.forEach((rn, ri) => {
      const cell = getCell(sheet, rn, col.col)
      if (!cell) return
      const st = styles[cell.style]
      const hasValue = cell.value !== null && !(typeof cell.value === 'string' && cell.value.trim() === '')
      // Fills
      if (st.fill.pattern && st.fill.fg) {
        const fill = st.fill.fg
        const key = `fill:${colorKey(fill)}`
        const exact = qcRules.find((r) => r.fill && (colorKey(r.fill) === colorKey(fill) || (r.fill.resolved && r.fill.resolved === fill.resolved)))
        if (exact) {
          flags.push({ row: ri, col: ci, kind: exact.kind as InterpretationKind, status: 'legend_exact', category: kindToCat[exact.kind], formatKey: key, detail: `Fill ${describeColorRef(fill)}${fill.resolved ? ` (#${fill.resolved})` : ''} matches legend "${exact.label}" (${exact.address}): ${exact.columnMeaning}` })
          if (col.segment !== null) qcSegments.add(col.segment)
        } else pending.push({ ri, ci, fill, key })
      }
      // Fonts
      if (!hasValue) return
      const fc = st.font.color
      const rule = matchSourceRule(legend, fc)
      if (mixed) {
        if (rule) {
          const tentative = isDefaultText(fc)
          flags.push({
            row: ri,
            col: ci,
            kind: 'cell_source',
            status: tentative ? 'legend_tentative' : 'legend_exact',
            category: null,
            formatKey: `font:${colorKey(fc)}`,
            detail: tentative ? `Default text colour; tentatively "${rule.label}" → ${rule.source}` : `Font ${describeColorRef(fc)} → ${rule.source} (legend ${rule.address})`
          })
        } else {
          flags.push({ row: ri, col: ci, kind: 'unresolved_font', status: 'unresolved', category: null, formatKey: `font:${colorKey(fc)}`, detail: `Font ${describeColorRef(fc)} in a mixed-source column is not described in the legend.` })
          unresolvedFonts.push(`${col.letter}${rn}`)
        }
      } else if (fc && !isDefaultText(fc) && !sameColor(fc, headerStyle.font.color) && !(isBlackish(fc.resolved ?? null) && isBlackish(headerStyle.font.color?.resolved ?? null))) {
        if (rule) {
          flags.push({ row: ri, col: ci, kind: 'cell_source', status: 'needs_review', category: null, formatKey: `font:${colorKey(fc)}`, detail: `Cell font ${describeColorRef(fc)} suggests ${rule.source}, which differs from the column attribution.` })
        } else {
          flags.push({ row: ri, col: ci, kind: 'unresolved_font', status: 'unresolved', category: null, formatKey: `font:${colorKey(fc)}`, detail: `Font ${describeColorRef(fc)} is not described in the legend.` })
          unresolvedFonts.push(`${col.letter}${rn}`)
        }
      }
    })
  })

  // Second pass: non-exact fills. A close colour within a QC-bearing segment is a *possible* QC flag needing review.
  const possible: string[] = []
  const unresolved = new Map<string, string[]>()
  for (const p of pending) {
    const col = columns[p.ci]
    let best: { rule: LegendRule; d: number } | null = null
    if (p.fill.resolved && col.segment !== null && qcSegments.has(col.segment)) {
      for (const r of qcRules) {
        if (!r.fill?.resolved) continue
        const d = rgbDistance(r.fill.resolved, p.fill.resolved)
        if (d < 48 && (!best || d < best.d)) best = { rule: r, d }
      }
    }
    const addr = `${col.letter}${dataRowNumbers[p.ri]}`
    if (best) {
      flags.push({
        row: p.ri,
        col: p.ci,
        kind: best.rule.kind as InterpretationKind,
        status: 'needs_review',
        category: possibleCat[best.rule.kind],
        formatKey: p.key,
        detail: `Fill ${describeColorRef(p.fill)} (#${p.fill.resolved}) resembles legend "${best.rule.label}" (${best.rule.description}, ${best.rule.address}) but is not the same colour. Possible ${best.rule.kind.replace('qc_', '')} warning — needs curator review.`
      })
      possible.push(addr)
    } else {
      flags.push({
        row: p.ri,
        col: p.ci,
        kind: 'unresolved_highlight',
        status: 'unresolved',
        category: 'unresolved_highlight',
        formatKey: p.key,
        detail: `Fill ${describeColorRef(p.fill)}${p.fill.resolved ? ` (#${p.fill.resolved})` : ''} is not described in the legend.${otherRule ? ` Legend: "${otherRule.label}" — ${otherRule.columnMeaning}` : ''}`
      })
      const list = unresolved.get(p.key) ?? []
      list.push(addr)
      unresolved.set(p.key, list)
    }
  }
  if (possible.length)
    issue('warning', 'possible_qc', `${possible.length} cell(s) have a fill close to, but not identical with, a legend QC colour. They are marked "possible" and need review; they are not excluded by default.`, possible)
  for (const [key, list] of unresolved) issue('info', 'unresolved_fill', `${list.length} cell(s) with ${key.replace('fill:', 'fill ')} have unconfirmed meaning (unresolved formatting; never an automatic exclusion).`, list)
  if (unresolvedFonts.length) issue('info', 'unresolved_font', `${unresolvedFonts.length} cell(s) use a font colour not described in the legend.`, unresolvedFonts)
}
