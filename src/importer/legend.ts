// Decodes a "Formatting Legend" sheet into explicit, reviewable rules. The legend's text is data:
// it is matched against a small set of documented phrases and never executed or obeyed.

import type { ColorRef } from '@core/types'
import { colorKey, describeColorRef } from '@core/colors'
import type { XSheet, XStyle, XWorkbook } from './ooxml'
import { getCell } from './ooxml'

export type LegendKind =
  | 'source'
  | 'mixed_source'
  | 'identical_sources'
  | 'group_major'
  | 'group_minor'
  | 'qc_sample'
  | 'qc_target'
  | 'qc_both'
  | 'unconfirmed_highlight'
  | 'unknown'

export interface LegendRule {
  id: string
  section: 'format' | 'border' | 'highlight' | 'other'
  address: string
  label: string
  columnMeaning: string
  cellMeaning: string
  kind: LegendKind
  source: string | null
  groups: string[]
  font: { color: ColorRef | null; bold: boolean; italic: boolean } | null
  fill: ColorRef | null
  formatKey: string
  description: string
}

export interface Legend {
  sheetName: string
  rules: LegendRule[]
  notes: string[]
}

const clean = (s: unknown) => String(s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim()

function sourceFrom(text: string): string | null {
  const m = /acquired from (.+?)(?: in a mixed-source column)?$/i.exec(text)
  if (!m) return null
  return m[1].replace(/^(the\s+)/i, '').trim()
}

export function findLegendSheet(wb: XWorkbook, dataSheet: string): XSheet | null {
  return wb.sheets.find((s) => s.name !== dataSheet && /legend/i.test(s.name)) ?? null
}

export function parseLegend(wb: XWorkbook, sheet: XSheet): Legend {
  const rules: LegendRule[] = []
  const notes: string[] = []
  let section: LegendRule['section'] = 'other'
  for (let r = 1; r <= sheet.maxRow; r++) {
    const a = getCell(sheet, r, 1)
    const label = clean(a?.value)
    if (!label) continue
    const upper = label.toUpperCase()
    if (upper === 'FORMAT' || upper === 'FORMATS') {
      section = 'format'
      continue
    }
    if (upper === 'BORDERS' || upper === 'BORDER') {
      section = 'border'
      continue
    }
    if (upper === 'HIGHLIGHTS' || upper === 'HIGHLIGHT' || upper === 'FILLS') {
      section = 'highlight'
      continue
    }
    const b = clean(getCell(sheet, r, 2)?.value)
    const c = clean(getCell(sheet, r, 3)?.value)
    const style: XStyle | undefined = a ? wb.styles[a.style] : undefined
    const font = style ? { color: style.font.color, bold: style.font.bold, italic: style.font.italic } : null
    const fill = style?.fill.pattern ? style.fill.fg : null
    let kind: LegendKind = 'unknown'
    let source: string | null = null
    let groups: string[] = []
    const both = `${b} ${c}`
    if (section === 'format') {
      if (font?.bold && /identical/i.test(both)) kind = 'identical_sources'
      else if (font?.italic && /multiple/i.test(both)) kind = 'mixed_source'
      else if ((source = sourceFrom(b) ?? sourceFrom(c))) kind = 'source'
    } else if (section === 'border') {
      if (/thick|medium/i.test(label)) kind = 'group_major'
      else if (/thin/i.test(label)) kind = 'group_minor'
      const m = /\(([^)]*)\)/.exec(b)
      if (kind === 'group_major' && m) {
        groups = m[1]
          .replace(/^[^:]*:/, '')
          .split(',')
          .map((g) => g.trim())
          .filter(Boolean)
      }
    } else if (section === 'highlight') {
      if (/sample and target|both/i.test(both) && /warning/i.test(both)) kind = 'qc_both'
      else if (/sample/i.test(both) && /warning/i.test(both)) kind = 'qc_sample'
      else if (/target/i.test(both) && /warning/i.test(both)) kind = 'qc_target'
      else if (/unconfirmed/i.test(both)) kind = 'unconfirmed_highlight'
      if (/^other/i.test(label)) source = sourceFrom(b) ?? (/copied from (.+)$/i.exec(b)?.[1].trim() ?? null)
    }
    const formatKey =
      section === 'highlight'
        ? fill
          ? `fill:${colorKey(fill)}`
          : 'fill:other'
        : section === 'format'
          ? `font:${colorKey(font?.color)}${font?.bold ? ':b' : ''}${font?.italic ? ':i' : ''}`
          : `border:${label.toLowerCase()}`
    const description =
      section === 'highlight'
        ? fill
          ? `Fill ${describeColorRef(fill)}${fill.resolved ? ` (#${fill.resolved})` : ''}`
          : 'Any other fill colour'
        : section === 'format'
          ? `Font ${describeColorRef(font?.color)}${font?.bold ? ', bold' : ''}${font?.italic ? ', italic' : ''}`
          : label
    if (kind === 'unknown') notes.push(`Legend row ${r} ("${label}") could not be matched to a known meaning; it is shown but not applied.`)
    rules.push({ id: `L${r}`, section, address: `A${r}`, label, columnMeaning: b, cellMeaning: c, kind, source, groups, font, fill, formatKey, description })
  }
  return { sheetName: sheet.name, rules, notes }
}
