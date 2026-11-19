// Comparison of two dataset versions (two imports of a study workbook). Pure: it reads two snapshots and reports
// what differs. Nothing is reconciled or merged; each import stays its own immutable version.
//
// Rows are matched by participant and visit name, variables by their key (derived from the header), so a column that
// was renamed appears as one removed and one added. Values are compared as classified: 1 and "1.0" are the same
// number; "<0.5" and 0.5 are not the same value; missing is never equal to zero.

import type { CellValue, DatasetSnapshot, VariableInfo } from './types'

export type ChangeKind = 'value' | 'filled' | 'emptied'

export interface CellChange {
  participantId: string
  visit: string
  variableKey: string
  header: string
  kind: ChangeKind
  /** As displayed: the raw text for censored and text values, the number otherwise, '' for missing. */
  before: string
  after: string
}

export interface VariableChange {
  key: string
  header: string
  /** Observations with a different value, newly filled (missing before) and newly emptied (missing now). */
  value: number
  filled: number
  emptied: number
  /** Set when the column changed type between the versions, e.g. numeric to mixed. */
  kindBefore?: string
  kindAfter?: string
}

export interface VersionDiff {
  from: { versionNumber: number; rows: number; participants: number; variables: number; sourceSha256: string }
  to: { versionNumber: number; rows: number; participants: number; variables: number; sourceSha256: string }
  identical: boolean
  participants: { added: string[]; removed: string[] }
  /** Participant-visit rows present in only one version. */
  rows: { added: { participantId: string; visit: string }[]; removed: { participantId: string; visit: string }[]; common: number }
  variables: { added: { key: string; header: string }[]; removed: { key: string; header: string }[]; common: number }
  /** Variables present in both versions with at least one changed observation or a changed type, most changed first. */
  changedVariables: VariableChange[]
  totals: { value: number; filled: number; emptied: number }
  /** QC-type flags on observations present in both versions: gained and lost. */
  flags: { added: number; removed: number }
  /** The first changes, in row then column order, for review. `cellsTruncated` says how many more there are. */
  cells: CellChange[]
  cellsTruncated: number
}

function sameValue(a: CellValue, b: CellValue): boolean {
  if (a.k !== b.k) return false
  if (a.k === 'missing') return true
  if (a.k === 'number') return a.v === (b as typeof a).v
  if (a.k === 'censored') return a.op === (b as typeof a).op && a.bound === (b as typeof a).bound
  return a.raw.trim() === (b as typeof a).raw.trim()
}

const shown = (v: CellValue): string => (v.k === 'missing' ? '' : v.k === 'number' ? String(v.v) : v.raw.trim())

const measures = (s: DatasetSnapshot): VariableInfo[] => s.variables.filter((v) => v.role === 'measure')

export function diffVersions(from: DatasetSnapshot, to: DatasetSnapshot, opts: { maxCells?: number } = {}): VersionDiff {
  const maxCells = opts.maxCells ?? 200
  const visitName = (s: DatasetSnapshot, id: string) => s.visits.find((v) => v.id === id)?.name ?? id
  // Visit ids are per version; names are what the two imports share.
  const rowKey = (s: DatasetSnapshot, i: number) => `${s.rows[i].participantId}\u0000${visitName(s, s.rows[i].visitId)}`
  const fromRows = new Map(from.rows.map((r) => [rowKey(from, r.index), r.index]))
  const toRows = new Map(to.rows.map((r) => [rowKey(to, r.index), r.index]))
  const split = (k: string) => ({ participantId: k.split('\u0000')[0], visit: k.split('\u0000')[1] })

  const fromPeople = new Set(from.rows.map((r) => r.participantId))
  const toPeople = new Set(to.rows.map((r) => r.participantId))
  const byNatural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

  const fromVars = new Map(measures(from).map((v) => [v.key, v]))
  const toVars = new Map(measures(to).map((v) => [v.key, v]))
  const commonVars = [...toVars.values()].filter((v) => fromVars.has(v.key))

  const flagKey = (s: DatasetSnapshot) => {
    const out = new Set<string>()
    for (const f of s.flags) {
      if (!f.category || f.status === 'curator_rejected') continue
      const v = s.variables[f.variable]
      if (v?.role === 'measure') out.add(`${rowKey(s, f.row)}\u0000${v.key}\u0000${f.category}`)
    }
    return out
  }

  const commonRowKeys = [...toRows.keys()].filter((k) => fromRows.has(k))
  const changed: VariableChange[] = []
  const cells: CellChange[] = []
  let cellsTruncated = 0
  const totals = { value: 0, filled: 0, emptied: 0 }
  const perVar = new Map<string, VariableChange>()
  // Row order of the newer version, then its column order: the order a reader would scan the workbook in.
  for (const k of commonRowKeys) {
    const ra = fromRows.get(k)!
    const rb = toRows.get(k)!
    for (const vb of commonVars) {
      const va = fromVars.get(vb.key)!
      const a = from.values[va.index]?.[ra] ?? { k: 'missing' }
      const b = to.values[vb.index]?.[rb] ?? { k: 'missing' }
      if (sameValue(a, b)) continue
      const kind: ChangeKind = a.k === 'missing' ? 'filled' : b.k === 'missing' ? 'emptied' : 'value'
      totals[kind]++
      const e = perVar.get(vb.key) ?? { key: vb.key, header: vb.header, value: 0, filled: 0, emptied: 0 }
      e[kind]++
      perVar.set(vb.key, e)
      if (cells.length < maxCells) cells.push({ ...split(k), variableKey: vb.key, header: vb.header, kind, before: shown(a), after: shown(b) })
      else cellsTruncated++
    }
  }
  for (const vb of commonVars) {
    const va = fromVars.get(vb.key)!
    const e = perVar.get(vb.key)
    if (va.kind !== vb.kind) changed.push({ ...(e ?? { key: vb.key, header: vb.header, value: 0, filled: 0, emptied: 0 }), kindBefore: va.kind, kindAfter: vb.kind })
    else if (e) changed.push(e)
  }
  changed.sort((x, y) => y.value + y.filled + y.emptied - (x.value + x.filled + x.emptied) || x.header.localeCompare(y.header, undefined, { numeric: true }))

  const commonRowSet = new Set(commonRowKeys)
  const commonVarKeys = new Set(commonVars.map((v) => v.key))
  const inBoth = (key: string) => {
    const [pid, visit, variable] = key.split('\u0000')
    return commonRowSet.has(`${pid}\u0000${visit}`) && commonVarKeys.has(variable)
  }
  const fa = flagKey(from)
  const fb = flagKey(to)
  const flags = { added: [...fb].filter((k) => !fa.has(k) && inBoth(k)).length, removed: [...fa].filter((k) => !fb.has(k) && inBoth(k)).length }

  const side = (s: DatasetSnapshot) => ({ versionNumber: s.versionNumber, rows: s.rows.length, participants: new Set(s.rows.map((r) => r.participantId)).size, variables: measures(s).length, sourceSha256: s.sourceSha256 })
  const participants = { added: [...toPeople].filter((p) => !fromPeople.has(p)).sort(byNatural), removed: [...fromPeople].filter((p) => !toPeople.has(p)).sort(byNatural) }
  const rows = {
    added: [...toRows.keys()].filter((k) => !fromRows.has(k)).map(split),
    removed: [...fromRows.keys()].filter((k) => !toRows.has(k)).map(split),
    common: commonRowKeys.length
  }
  const variables = {
    added: [...toVars.values()].filter((v) => !fromVars.has(v.key)).map((v) => ({ key: v.key, header: v.header })),
    removed: [...fromVars.values()].filter((v) => !toVars.has(v.key)).map((v) => ({ key: v.key, header: v.header })),
    common: commonVars.length
  }
  const identical = rows.added.length + rows.removed.length + variables.added.length + variables.removed.length + changed.length + flags.added + flags.removed === 0
  return { from: side(from), to: side(to), identical, participants, rows, variables, changedVariables: changed, totals, flags, cells, cellsTruncated }
}
