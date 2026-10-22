// CSV import: values only. Formatting, comments and workbook metadata do not exist in CSV.
import Papa from 'papaparse'
import type { XCell, XSheet, XWorkbook } from './ooxml'
import { columnLetter } from '@core/hash'

export function readCsv(text: string, name = 'CSV data'): XWorkbook {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const parsed = Papa.parse<string[]>(clean, { skipEmptyLines: false })
  const warnings = parsed.errors.slice(0, 20).map((e) => `CSV row ${(e.row ?? 0) + 1}: ${e.message}`)
  const cells = new Map<number, Map<number, XCell>>()
  let maxRow = 0
  let maxCol = 0
  parsed.data.forEach((row, ri) => {
    const r = ri + 1
    const map = new Map<number, XCell>()
    row.forEach((v, ci) => {
      const c = ci + 1
      // Everything in CSV is text; numeric-looking text is classified later with its raw text kept.
      map.set(c, { r, c, address: `${columnLetter(c)}${r}`, type: 'str', value: v === '' ? null : v, formula: null, rich: null, style: 0 })
      if (v !== '' && v !== undefined) {
        maxRow = Math.max(maxRow, r)
        maxCol = Math.max(maxCol, c)
      }
    })
    cells.set(r, map)
  })
  const sheet: XSheet = { name, state: 'visible', cells, maxRow, maxCol, comments: [] }
  return {
    sheets: [sheet],
    styles: [{ font: { bold: false, italic: false, color: null }, fill: { pattern: null, fg: null }, border: { left: null, right: null, top: null, bottom: null }, numFmtId: 0, numFmtCode: null, isDateFormat: false }],
    theme: null,
    formulaCells: 0,
    warnings
  }
}
