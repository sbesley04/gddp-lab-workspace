import type { MetaField, VariableInfo, QcCategory, InterpretationStatus } from '@core/types'
import { QC_CATEGORY_LABELS } from '@core/types'
export { formatNumber, displayValue } from '@core/values'

export const label = (v: VariableInfo) => v.meta.displayLabel.value ?? v.header

export function unitText(v: VariableInfo): string {
  const u = v.meta.unit
  if (!u.value) return 'unit unknown'
  return u.status === 'confirmed' ? u.value : `${u.value}, ${u.status}`
}

export function axisTitle(v: VariableInfo): string {
  return `${label(v)} (${unitText(v)})`
}

export const STATUS_TEXT: Record<MetaField['status'], string> = { unknown: 'Unknown', tentative: 'Tentative', confirmed: 'Confirmed' }

export const INTERP_TEXT: Record<InterpretationStatus, string> = {
  legend_exact: 'Matches legend',
  legend_tentative: 'Tentative (default colour)',
  needs_review: 'Needs review',
  unresolved: 'Unresolved',
  curator_confirmed: 'Curator confirmed',
  curator_rejected: 'Curator rejected'
}

export const qcLabel = (c: QcCategory) => QC_CATEGORY_LABELS[c]

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`
}

export function shortDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return iso.slice(0, 10)
  }
}

export function areaOf(v: VariableInfo) {
  return v.meta.area.value ?? 'Unassigned'
}

export function isMeasure(v: VariableInfo) {
  return v.role === 'measure'
}

/** Plain-language QC policy. Curator exclusions are deliberate decisions and are honoured by default. */
export function qcPolicyText(qc: QcCategory[]): string {
  const other = qc.filter((c) => c !== 'curator_exclusion')
  const base = other.length === 0 ? 'Flagged included' : `Excluding ${other.map((c) => QC_CATEGORY_LABELS[c]).join(', ')}`
  return qc.includes('curator_exclusion') ? base : `${base} · curator exclusions ignored`
}

export const FIELD_TEXT: Record<string, string> = { unit: 'unit', definition: 'definition', specimen: 'specimen', scoreType: 'score type' }
