// Seeded synthetic snapshots for property and performance tests. Everything is invented; identifiers are SYN-n.
import { classifyValue } from '@core/values'
import { QC_CATEGORIES, type CellFlag, type CellValue, type DatasetSnapshot, type VariableInfo } from '@core/types'

/** mulberry32: a small deterministic generator, so a failing case can be reproduced from its seed. */
export function rng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return { next, int: (n: number) => Math.floor(next() * n), pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)], chance: (p: number) => next() < p }
}

const meta = () => ({ value: null, status: 'unknown' as const, provenance: '', revisionId: null })
export const variable = (index: number, key: string, kind: VariableInfo['kind'], categories: string[] = []): VariableInfo => ({
  index, columnIndex: index + 1, letter: `C${index}`, key, header: key, headerRuns: null, role: 'measure', kind,
  groupSegment: null, subgroupSegment: null, aliases: [], attribution: null, quasiIdentifier: false, covariate: false, categories,
  counts: { number: 0, missing: 0, censored: 0, text: 0 },
  meta: { displayLabel: meta(), area: meta(), unit: meta(), specimen: meta(), assay: meta(), scoreType: meta(), definition: meta(), source: meta() }
})

export interface SyntheticOptions {
  participants: number
  visits: number
  numeric: number
  categorical: number
  /** Chance that a participant has a row at each visit after the first. */
  attendance?: number
  /** Chance that a numeric cell is missing, censored or a text code. */
  gaps?: number
  /** Chance that a cell carries a QC flag. */
  flags?: number
}

const CATS = ['a', 'b', 'c', 'd']

export function syntheticSnapshot(seed: number, o: SyntheticOptions): DatasetSnapshot {
  const r = rng(seed)
  const gaps = o.gaps ?? 0.15
  const visits = Array.from({ length: o.visits }, (_, i) => ({ id: `v${i}`, name: i === 0 ? 'Baseline' : `Month ${i * 6}`, order: i + 1, actualDate: null }))
  const rows: DatasetSnapshot['rows'] = []
  for (let p = 0; p < o.participants; p++)
    for (let v = 0; v < o.visits; v++) if (v === 0 || r.chance(o.attendance ?? 0.8)) rows.push({ index: rows.length, rowNumber: rows.length + 2, participantId: `SYN-${p}`, visitId: `v${v}` })
  const variables: VariableInfo[] = []
  const values: CellValue[][] = []
  for (let i = 0; i < o.numeric; i++) {
    variables.push(variable(variables.length, `n${i}`, 'numeric'))
    const scale = 1 + r.int(50)
    values.push(
      rows.map(() => {
        const u = r.next()
        if (u < gaps * 0.6) return classifyValue(null)
        if (u < gaps * 0.85) return classifyValue(r.chance(0.8) ? '<0.5' : '>90')
        if (u < gaps) return classifyValue('QNS')
        // Rounded so that equal values and exact filter bounds occur.
        return classifyValue(Math.round((r.next() * scale - scale / 4) * 10) / 10)
      })
    )
  }
  for (let i = 0; i < o.categorical; i++) {
    variables.push(variable(variables.length, `c${i}`, 'categorical', CATS))
    values.push(rows.map(() => classifyValue(r.chance(gaps) ? null : r.pick(CATS))))
  }
  const flags: CellFlag[] = []
  const flagChance = o.flags ?? 0.03
  if (flagChance > 0) {
    const expected = Math.round(rows.length * variables.length * flagChance)
    for (let k = 0; k < expected; k++) {
      const category = r.pick(QC_CATEGORIES)
      flags.push({ row: r.int(rows.length), variable: r.int(variables.length), kind: category === 'curator_exclusion' ? 'curator_exclusion' : 'qc_sample', status: r.chance(0.1) ? 'curator_rejected' : 'legend_exact', category, formatKey: 'f', detail: '' })
    }
  }
  return { datasetVersionId: 'syn', versionNumber: 1, sourceFileName: 'synthetic', sourceSha256: 'synthetic', sheetName: 's', importedAt: '', sourceKind: 'csv', metadataVersion: 0, visits, rows, variables, values, flags, annotations: [] }
}
