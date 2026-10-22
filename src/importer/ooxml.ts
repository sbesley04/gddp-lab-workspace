// Focused, read-only OOXML (.xlsx) reader that preserves what the research workflow needs:
// typed values, rich-text runs, fonts/fills/borders (with theme colours + tints), number formats,
// legacy and threaded comments, and the theme palette. Workbook content is treated purely as data.

import { unzipSync, strFromU8 } from 'fflate'
import { XMLParser } from 'fast-xml-parser'
import type { ColorRef } from '@core/types'
import { resolveColor } from '@core/colors'
import { parseAddress, columnLetter } from '@core/hash'

export interface XRun {
  text: string
  font: XFont | null // null = inherits the cell font
}

export interface XFont {
  bold: boolean
  italic: boolean
  color: ColorRef | null
}

export interface XStyle {
  font: XFont
  fill: { pattern: string | null; fg: ColorRef | null }
  border: { left: string | null; right: string | null; top: string | null; bottom: string | null }
  numFmtId: number
  numFmtCode: string | null
  isDateFormat: boolean
}

export interface XCell {
  r: number
  c: number
  address: string
  type: 'n' | 's' | 'b' | 'e' | 'str' | 'inlineStr' | 'd'
  value: number | string | boolean | null
  formula: string | null
  rich: XRun[] | null
  style: number
}

export interface XComment {
  address: string
  text: string
  author: string | null
  threaded: boolean
  createdAt: string | null
  parentId: string | null
}

export interface XSheet {
  name: string
  state: string
  cells: Map<number, Map<number, XCell>> // row -> col -> cell
  maxRow: number // last row containing a value
  maxCol: number // last column containing a value
  comments: XComment[]
}

export interface XWorkbook {
  sheets: XSheet[]
  styles: XStyle[]
  theme: string[] | null
  formulaCells: number
  warnings: string[]
}

const ARRAY_TAGS = new Set([
  'sheet', 'Relationship', 'si', 'r', 'row', 'c', 'font', 'fill', 'border', 'xf', 'numFmt',
  'comment', 'author', 'threadedComment', 'person', 'rPh', 'Override', 'Default'
])

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  removeNSPrefix: true,
  processEntities: true,
  htmlEntities: true, // decodes numeric character references such as &#8211;
  isArray: (name) => ARRAY_TAGS.has(name)
})

// Guard against zip bombs: the reference workbook is ~110 KB; allow generous but bounded sizes.
const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024
const MAX_FILE_BYTES = 200 * 1024 * 1024

type Node = Record<string, any>

function asArray<T>(x: T | T[] | undefined | null): T[] {
  if (x === undefined || x === null) return []
  return Array.isArray(x) ? x : [x]
}

function textOf(node: any): string {
  if (node === undefined || node === null) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object') return node['#text'] !== undefined ? String(node['#text']) : ''
  return ''
}

function boolFlag(node: any): boolean {
  if (node === undefined) return false
  if (node === '' || node === null) return true
  if (typeof node === 'object') {
    const v = node['@_val']
    return v === undefined || v === '1' || v === 'true'
  }
  return true
}

function colorRef(node: any): ColorRef | null {
  if (!node || typeof node !== 'object') return null
  const ref: ColorRef = {}
  if (node['@_rgb'] !== undefined) ref.rgb = String(node['@_rgb']).toUpperCase()
  if (node['@_theme'] !== undefined) ref.theme = Number(node['@_theme'])
  if (node['@_indexed'] !== undefined) ref.indexed = Number(node['@_indexed'])
  if (node['@_auto'] !== undefined) ref.auto = node['@_auto'] === '1' || node['@_auto'] === 'true'
  if (node['@_tint'] !== undefined) ref.tint = Number(node['@_tint'])
  if (Object.keys(ref).length === 0) return null
  return ref
}

function parseFont(node: Node | undefined): XFont {
  if (!node) return { bold: false, italic: false, color: null }
  return { bold: boolFlag(node.b), italic: boolFlag(node.i), color: colorRef(node.color) }
}

const BUILTIN_DATE_FMTS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])

function isDateCode(code: string | null): boolean {
  if (!code) return false
  const stripped = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '')
  return /[dmyhs]/i.test(stripped) && !/^[#0.,%E+\-\s]*$/.test(stripped)
}

function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = base.split('/').slice(0, -1)
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

function relsPath(partPath: string): string {
  const i = partPath.lastIndexOf('/')
  return `${partPath.slice(0, i)}/_rels/${partPath.slice(i + 1)}.rels`
}

export class WorkbookReadError extends Error {}

export function readWorkbook(bytes: Uint8Array): XWorkbook {
  if (bytes.byteLength > MAX_FILE_BYTES) throw new WorkbookReadError('File is larger than the supported 200 MB limit.')
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new WorkbookReadError('This file is not an .xlsx workbook (missing ZIP signature). Legacy .xls files are not supported; save as .xlsx first.')
  let total = 0
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        total += f.originalSize
        if (total > MAX_UNCOMPRESSED_BYTES) throw new WorkbookReadError('Workbook expands beyond the supported size.')
        return f.name.endsWith('.xml') || f.name.endsWith('.rels')
      }
    })
  } catch (e) {
    if (e instanceof WorkbookReadError) throw e
    throw new WorkbookReadError(`The workbook could not be unzipped: ${(e as Error).message}`)
  }
  const xml = (path: string): Node | null => {
    const f = files[path]
    if (!f) return null
    const text = strFromU8(f)
    // OOXML parts never contain a DOCTYPE; rejecting it rules out entity-expansion tricks.
    if (/<!DOCTYPE/i.test(text)) throw new WorkbookReadError(`Workbook part ${path} contains a DOCTYPE declaration and was rejected.`)
    return parser.parse(text) as Node
  }
  const warnings: string[] = []

  const wbXml = xml('xl/workbook.xml')
  if (!wbXml) throw new WorkbookReadError('Workbook part xl/workbook.xml is missing.')
  const wbRels = xml('xl/_rels/workbook.xml.rels')
  const relMap = new Map<string, { target: string; type: string }>()
  for (const r of asArray<Node>(wbRels?.Relationships?.Relationship)) relMap.set(r['@_Id'], { target: r['@_Target'], type: r['@_Type'] })

  // Theme palette in Excel index order: lt1, dk1, lt2, dk2, accent1..6, hlink, folHlink.
  let theme: string[] | null = null
  const themeRel = [...relMap.values()].find((r) => r.type?.endsWith('/theme'))
  const themeDoc = themeRel ? xml(resolvePath('xl/workbook.xml', themeRel.target)) : null
  const scheme = themeDoc?.theme?.themeElements?.clrScheme
  if (scheme) {
    const pick = (name: string): string => {
      const n = scheme[name]
      if (!n) return '000000'
      if (n.srgbClr) return String(n.srgbClr['@_val']).toUpperCase()
      if (n.sysClr) return String(n.sysClr['@_lastClr'] ?? (name === 'lt1' ? 'FFFFFF' : '000000')).toUpperCase()
      return '000000'
    }
    theme = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'].map(pick)
  } else warnings.push('No theme part found; theme colours cannot be resolved to RGB.')

  const withResolved = (ref: ColorRef | null): ColorRef | null => (ref ? { ...ref, resolved: resolveColor(ref, theme) } : null)
  const fontResolved = (f: XFont): XFont => ({ ...f, color: withResolved(f.color) })

  // Styles
  const stylesRel = [...relMap.values()].find((r) => r.type?.endsWith('/styles'))
  const stylesDoc = stylesRel ? xml(resolvePath('xl/workbook.xml', stylesRel.target)) : null
  const ss = stylesDoc?.styleSheet ?? {}
  const numFmts = new Map<number, string>()
  for (const nf of asArray<Node>(ss.numFmts?.numFmt)) numFmts.set(Number(nf['@_numFmtId']), String(nf['@_formatCode']))
  const fonts = asArray<Node>(ss.fonts?.font).map((f) => fontResolved(parseFont(f)))
  const fills = asArray<Node>(ss.fills?.fill).map((f) => {
    const p = f.patternFill
    const pattern = p?.['@_patternType'] ?? (p ? 'solid' : null)
    return { pattern: pattern && pattern !== 'none' ? String(pattern) : null, fg: withResolved(colorRef(p?.fgColor)) }
  })
  const borders = asArray<Node>(ss.borders?.border).map((b) => {
    const side = (n: any) => (n && typeof n === 'object' && n['@_style'] ? String(n['@_style']) : null)
    return { left: side(b.left), right: side(b.right), top: side(b.top), bottom: side(b.bottom) }
  })
  const styles: XStyle[] = asArray<Node>(ss.cellXfs?.xf).map((xf) => {
    const numFmtId = Number(xf['@_numFmtId'] ?? 0)
    const code = numFmts.get(numFmtId) ?? null
    return {
      font: fonts[Number(xf['@_fontId'] ?? 0)] ?? { bold: false, italic: false, color: null },
      fill: fills[Number(xf['@_fillId'] ?? 0)] ?? { pattern: null, fg: null },
      border: borders[Number(xf['@_borderId'] ?? 0)] ?? { left: null, right: null, top: null, bottom: null },
      numFmtId,
      numFmtCode: code,
      isDateFormat: BUILTIN_DATE_FMTS.has(numFmtId) || isDateCode(code)
    }
  })
  if (styles.length === 0) styles.push({ font: { bold: false, italic: false, color: null }, fill: { pattern: null, fg: null }, border: { left: null, right: null, top: null, bottom: null }, numFmtId: 0, numFmtCode: null, isDateFormat: false })

  // Shared strings (with rich-text runs)
  const ssRel = [...relMap.values()].find((r) => r.type?.endsWith('/sharedStrings'))
  const sstDoc = ssRel ? xml(resolvePath('xl/workbook.xml', ssRel.target)) : null
  const shared: { text: string; runs: XRun[] | null }[] = asArray<Node>(sstDoc?.sst?.si).map((si) => parseStringItem(si, fontResolved))

  // Persons for threaded comments
  const personsRel = [...relMap.values()].find((r) => r.type?.endsWith('/person'))
  const personsDoc = xml(personsRel ? resolvePath('xl/workbook.xml', personsRel.target) : 'xl/persons/person.xml')
  const persons = new Map<string, string>()
  for (const p of asArray<Node>(personsDoc?.personList?.person)) persons.set(String(p['@_id']), String(p['@_displayName'] ?? ''))

  let formulaCells = 0
  const sheets: XSheet[] = []
  for (const s of asArray<Node>(wbXml.workbook?.sheets?.sheet)) {
    const rid = s['@_id']
    const rel = relMap.get(rid)
    if (!rel) {
      warnings.push(`Sheet "${s['@_name']}" has no relationship target; skipped.`)
      continue
    }
    const path = resolvePath('xl/workbook.xml', rel.target)
    const doc = xml(path)
    if (!doc?.worksheet) {
      warnings.push(`Sheet "${s['@_name']}" is not a worksheet (e.g. chart sheet); skipped.`)
      continue
    }
    const cells = new Map<number, Map<number, XCell>>()
    let maxRow = 0
    let maxCol = 0
    for (const row of asArray<Node>(doc.worksheet.sheetData?.row)) {
      for (const c of asArray<Node>(row.c)) {
        const address = String(c['@_r'])
        const { row: r, col } = parseAddress(address)
        const t = (c['@_t'] ?? 'n') as XCell['type']
        const styleIdx = Number(c['@_s'] ?? 0)
        const formula = c.f !== undefined ? textOf(c.f) || '(shared formula)' : null
        if (formula) formulaCells++
        let value: XCell['value'] = null
        let rich: XRun[] | null = null
        const v = c.v !== undefined ? textOf(c.v) : null
        switch (t) {
          case 's': {
            const item = v !== null ? shared[Number(v)] : undefined
            value = item ? item.text : null
            rich = item?.runs ?? null
            break
          }
          case 'inlineStr': {
            const item = parseStringItem(c.is ?? {}, fontResolved)
            value = item.text
            rich = item.runs
            break
          }
          case 'b':
            value = v === null ? null : v === '1'
            break
          case 'e':
          case 'str':
          case 'd':
            value = v
            break
          default:
            value = v === null || v === '' ? null : Number(v)
            if (typeof value === 'number' && Number.isNaN(value)) value = v
        }
        const cell: XCell = { r, c: col, address, type: t, value, formula, rich, style: styleIdx }
        let rowMap = cells.get(r)
        if (!rowMap) cells.set(r, (rowMap = new Map()))
        rowMap.set(col, cell)
        const hasValue = value !== null && !(typeof value === 'string' && value === '')
        if (hasValue) {
          if (r > maxRow) maxRow = r
          if (col > maxCol) maxCol = col
        }
      }
    }
    // Comments
    const comments: XComment[] = []
    const sheetRels = xml(relsPath(path))
    for (const r of asArray<Node>(sheetRels?.Relationships?.Relationship)) {
      const type = String(r['@_Type'] ?? '')
      const target = resolvePath(path, String(r['@_Target']))
      if (type.endsWith('/threadedComment')) {
        const tdoc = xml(target)
        for (const tc of asArray<Node>(tdoc?.ThreadedComments?.threadedComment)) {
          comments.push({
            address: String(tc['@_ref']),
            text: textOf(tc.text).trim(),
            author: persons.get(String(tc['@_personId'])) || null,
            threaded: true,
            createdAt: tc['@_dT'] ? String(tc['@_dT']) : null,
            parentId: tc['@_parentId'] ? String(tc['@_parentId']) : null
          })
        }
      }
    }
    const threadedAddrs = new Set(comments.map((c) => c.address))
    for (const r of asArray<Node>(sheetRels?.Relationships?.Relationship)) {
      const type = String(r['@_Type'] ?? '')
      if (!type.endsWith('/comments')) continue
      const cdoc = xml(resolvePath(path, String(r['@_Target'])))
      const authors = asArray<any>(cdoc?.comments?.authors?.author).map(textOf)
      for (const cm of asArray<Node>(cdoc?.comments?.commentList?.comment)) {
        const address = String(cm['@_ref'])
        // Threaded comments also write a legacy fallback copy; keep only the threaded original.
        if (threadedAddrs.has(address)) continue
        const t = cm.text
        const text = t?.r ? asArray<Node>(t.r).map((run) => textOf(run.t)).join('') : textOf(t?.t)
        comments.push({ address, text: text.trim(), author: authors[Number(cm['@_authorId'])] || null, threaded: false, createdAt: null, parentId: null })
      }
    }
    sheets.push({ name: String(s['@_name']), state: String(s['@_state'] ?? 'visible'), cells, maxRow, maxCol, comments })
  }
  if (sheets.length === 0) throw new WorkbookReadError('The workbook contains no readable worksheets.')
  return { sheets, styles, theme, formulaCells, warnings }
}

function parseStringItem(si: Node, fontResolved: (f: XFont) => XFont): { text: string; runs: XRun[] | null } {
  if (si.r) {
    const runs: XRun[] = asArray<Node>(si.r).map((run) => ({
      text: textOf(run.t),
      font: run.rPr ? fontResolved(parseFont(run.rPr)) : null
    }))
    return { text: runs.map((r) => r.text).join(''), runs }
  }
  return { text: textOf(si.t), runs: null }
}

export function getCell(sheet: XSheet, row: number, col: number): XCell | undefined {
  return sheet.cells.get(row)?.get(col)
}

export function cellAddress(row: number, col: number): string {
  return `${columnLetter(col)}${row}`
}
