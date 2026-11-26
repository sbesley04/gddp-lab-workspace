// Dashboard helpers for boards: the shared cohort that live cards follow, and the counts shown on stat cards.
// Counts only; nothing is imputed or substituted. Every row decision goes through computeSelection.

import type { CellFlag, DatasetSnapshot, FilterGroup, QcCategory, SelectionSpec, VariableInfo } from './types'
import { DEFAULT_QC_POLICY, emptyFilter } from './types'
import { computeSelection, countsFor, type SelectionResult } from './selection'
import { CENSORING_BIAS_THRESHOLD } from './censoring'

/**
 * A board's shared cohort. Visits are stored by name, not id, so the cohort still applies after a new import
 * (visit ids belong to one dataset version). Variable keys in the filter are stable across versions.
 */
export interface BoardCohort {
  filter: FilterGroup
  visitNames: string[] | 'all'
  qcExclude: QcCategory[]
}

export function defaultCohort(): BoardCohort {
  return { filter: emptyFilter(), visitNames: 'all', qcExclude: [...DEFAULT_QC_POLICY.exclude] }
}

export interface ResolvedCohort {
  spec: SelectionSpec
  /** Visit names in the cohort that the dataset does not have. */
  unknownVisits: string[]
  /** Filter variable keys that the dataset does not have. */
  unknownVariables: string[]
}

function filterKeys(g: FilterGroup, out: string[] = []): string[] {
  for (const c of g.children) c.type === 'cond' ? out.push(c.variableKey) : filterKeys(c, out)
  return out
}

/** The selection spec for a cohort on one dataset snapshot. */
export function resolveCohort(snapshot: DatasetSnapshot, cohort: BoardCohort | null | undefined): ResolvedCohort {
  const c = cohort ?? defaultCohort()
  let visitIds: string[] | 'all' = 'all'
  let unknownVisits: string[] = []
  if (c.visitNames !== 'all') {
    const byName = new Map(snapshot.visits.map((v) => [v.name, v.id]))
    visitIds = c.visitNames.map((n) => byName.get(n)).filter((x): x is string => !!x)
    unknownVisits = c.visitNames.filter((n) => !byName.has(n))
  }
  const keys = new Set(snapshot.variables.map((v) => v.key))
  const unknownVariables = [...new Set(filterKeys(c.filter))].filter((k) => !keys.has(k))
  return {
    spec: { datasetVersionId: snapshot.datasetVersionId, visitIds, filter: c.filter, qc: { exclude: [...c.qcExclude] }, participantIds: null },
    unknownVisits,
    unknownVariables
  }
}

export function cohortSelection(snapshot: DatasetSnapshot, cohort: BoardCohort | null | undefined, flagIndex?: Map<string, CellFlag[]>): SelectionResult & { resolved: ResolvedCohort } {
  const resolved = resolveCohort(snapshot, cohort)
  return { ...computeSelection(snapshot, resolved.spec, flagIndex), resolved }
}

export interface MeasureStats {
  key: string
  /** Selected rows (one participant at one visit). */
  rows: number
  /** Present and not QC-excluded. */
  usable: number
  missing: number
  /** missing / rows; null when no row is selected. */
  missingFraction: number | null
  numeric: number
  censored: number
  /** censored / (numeric + censored), as in the statistics panel; null when nothing was measured. */
  censoredFraction: number | null
  censoringBiased: boolean
  text: number
  /** Flagged observations that the QC policy keeps (shown with distinct shapes). */
  flaggedIncluded: number
  /** Observations removed by the QC policy. */
  qcExcluded: number
}

export interface CohortStats {
  rows: number
  participants: number
  /** Rows in scope before the cohort filter (after the visit restriction). */
  scopeRows: number
  measures: MeasureStats[]
}

export function measureStats(sel: SelectionResult, v: VariableInfo): MeasureStats {
  const c = countsFor(sel, v.index)
  const rows = sel.rows.length
  const measured = c.numeric + c.censored
  const censoredFraction = measured > 0 ? c.censored / measured : null
  return {
    key: v.key,
    rows,
    usable: c.included,
    missing: c.missing,
    missingFraction: rows > 0 ? c.missing / rows : null,
    numeric: c.numeric,
    censored: c.censored,
    censoredFraction,
    censoringBiased: censoredFraction !== null && censoredFraction > CENSORING_BIAS_THRESHOLD,
    text: c.text,
    flaggedIncluded: c.flaggedIncluded,
    qcExcluded: c.qcExcluded
  }
}

export function cohortStats(sel: SelectionResult, variables: VariableInfo[]): CohortStats {
  return { rows: sel.rows.length, participants: sel.participantIds.length, scopeRows: sel.scopeRowCount, measures: variables.map((v) => measureStats(sel, v)) }
}

/** "12%", "<1%" or "—". Never rounds a non-zero share down to 0%. */
export function percentText(f: number | null): string {
  if (f === null) return '—'
  const pct = f * 100
  if (pct > 0 && pct < 1) return '<1%'
  if (pct < 100 && pct > 99) return '>99%'
  return `${Math.round(pct)}%`
}
