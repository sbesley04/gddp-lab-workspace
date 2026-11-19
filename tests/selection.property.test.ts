// Property tests for the single selection engine, on seeded random snapshots and filters. Each property is a rule the
// table, charts, summaries, exports and MCP server all rely on. A failure prints the seed that reproduces it.
import { describe, expect, it } from 'vitest'
import { computeSelection, countsFor, pairedObservations } from '@core/selection'
import { distributionData, scatterData } from '@core/chartData'
import { QC_CATEGORIES, type DatasetSnapshot, type FilterCondition, type FilterGroup, type FilterNode, type QcCategory, type SelectionSpec } from '@core/types'
import { rng, syntheticSnapshot } from './synthetic'

const CASES = 150
type R = ReturnType<typeof rng>

function randomCondition(r: R, snap: DatasetSnapshot): FilterCondition {
  const v = r.pick(snap.variables)
  const onMissing = r.chance(0.3) ? 'include' : 'exclude'
  const kind = r.pick(['range', 'in', 'missing', 'present'] as const)
  const base = { type: 'cond' as const, id: `c${r.int(1e9)}`, variableKey: v.key, onMissing } as const
  if (kind === 'range') {
    const a = Math.round((r.next() * 40 - 10) * 10) / 10
    const b = a + Math.round(r.next() * 30 * 10) / 10
    return { ...base, test: { kind: 'range', min: r.chance(0.2) ? null : a, max: r.chance(0.2) ? null : b } }
  }
  if (kind === 'in') return { ...base, test: { kind: 'in', values: ['a', 'b', 'c', 'd', '<0.5', 'QNS'].filter(() => r.chance(0.4)) } }
  return { ...base, test: { kind } }
}

function randomFilter(r: R, snap: DatasetSnapshot, depth = 0): FilterGroup {
  const n = r.int(4)
  const children: FilterNode[] = Array.from({ length: n }, () => (depth < 2 && r.chance(0.25) ? randomFilter(r, snap, depth + 1) : randomCondition(r, snap)))
  return { type: 'group', id: `g${r.int(1e9)}`, op: r.chance(0.5) ? 'and' : 'or', children }
}

const group = (op: 'and' | 'or', ...children: FilterNode[]): FilterGroup => ({ type: 'group', id: 'g', op, children })
const spec = (filter: FilterGroup, extra: Partial<SelectionSpec> = {}): SelectionSpec => ({ datasetVersionId: 'syn', visitIds: 'all', participantIds: null, qc: { exclude: [] }, filter, ...extra })
const rowsOf = (snap: DatasetSnapshot, s: SelectionSpec) => computeSelection(snap, s).rows

// ---- An independent, deliberately plain reading of the documented rules, to compare the engine against.
function oracle(snap: DatasetSnapshot, s: SelectionSpec): number[] {
  const excluded = new Set<QcCategory>(s.qc.exclude)
  const unavailable = (row: number, variable: number) => {
    const v = snap.values[variable][row]
    if (v.k === 'missing') return true
    return snap.flags.some((f) => f.row === row && f.variable === variable && f.status !== 'curator_rejected' && f.category !== null && excluded.has(f.category))
  }
  const cond = (c: FilterCondition, row: number): boolean => {
    const variable = snap.variables.findIndex((v) => v.key === c.variableKey)
    const gone = unavailable(row, variable)
    const v = snap.values[variable][row]
    if (c.test.kind === 'missing') return gone
    if (c.test.kind === 'present') return !gone
    if (c.test.kind === 'range') {
      if (gone || v.k !== 'number') return c.onMissing === 'include'
      return (c.test.min === null || v.v >= c.test.min) && (c.test.max === null || v.v <= c.test.max)
    }
    if (gone) return c.onMissing === 'include'
    return v.k !== 'missing' && c.test.values.includes(v.raw.trim())
  }
  const has = (n: FilterNode): boolean => n.type === 'cond' || n.children.some(has)
  const node = (n: FilterNode, row: number): boolean => {
    if (n.type === 'cond') return cond(n, row)
    const kids = n.children.filter(has) // empty groups neither match nor block
    if (kids.length === 0) return true
    return n.op === 'and' ? kids.every((k) => node(k, row)) : kids.some((k) => node(k, row))
  }
  const visits = s.visitIds === 'all' ? null : new Set(s.visitIds)
  return snap.rows.filter((r) => (!visits || visits.has(r.visitId)) && node(s.filter, r.index)).map((r) => r.index)
}

function forCases(fn: (r: R, snap: DatasetSnapshot, seed: number) => void) {
  for (let seed = 1; seed <= CASES; seed++) {
    const r = rng(seed * 7919)
    const snap = syntheticSnapshot(seed, { participants: 6 + r.int(20), visits: 1 + r.int(3), numeric: 3, categorical: 2, gaps: 0.25, flags: 0.08 })
    try {
      fn(r, snap, seed)
    } catch (e) {
      throw new Error(`seed ${seed}: ${(e as Error).message}`)
    }
  }
}
const randomQc = (r: R): QcCategory[] => QC_CATEGORIES.filter(() => r.chance(0.3))

describe('selection engine properties', () => {
  it('agrees with a plain reading of the rules, for random filters, visits and QC policies', () => {
    forCases((r, snap) => {
      const s = spec(randomFilter(r, snap), { qc: { exclude: randomQc(r) }, visitIds: r.chance(0.5) ? 'all' : snap.visits.filter(() => r.chance(0.6)).map((v) => v.id) })
      expect(rowsOf(snap, s)).toEqual(oracle(snap, s))
    })
  })

  it('every row is either selected or excluded with a reason, and participants follow from the rows', () => {
    forCases((r, snap) => {
      const s = spec(randomFilter(r, snap), { qc: { exclude: randomQc(r) }, visitIds: r.chance(0.5) ? 'all' : [snap.visits[0].id] })
      const sel = computeSelection(snap, s)
      expect([...sel.rows].sort((a, b) => a - b)).toEqual(sel.rows)
      expect(new Set(sel.rows).size).toBe(sel.rows.length)
      expect([...sel.rows, ...sel.excludedRows.map((e) => e.row)].sort((a, b) => a - b)).toEqual(snap.rows.map((x) => x.index))
      expect(sel.excludedRows.every((e) => e.reason.length > 0)).toBe(true)
      expect(sel.scopeRowCount).toBe(sel.rows.length + sel.excludedRows.filter((e) => e.reason.startsWith('Did not match')).length)
      expect(sel.participantIds).toEqual([...new Set(sel.rows.map((i) => snap.rows[i].participantId))])
    })
  })

  it('AND is intersection, OR is union, and an empty group changes nothing', () => {
    forCases((r, snap) => {
      const a = randomCondition(r, snap)
      const b = randomFilter(r, snap)
      const qc = { exclude: randomQc(r) }
      const ra = new Set(rowsOf(snap, spec(group('and', a), { qc })))
      const rb = new Set(rowsOf(snap, spec(b, { qc })))
      const bHasConditions = JSON.stringify(b).includes('"cond"')
      const all = snap.rows.map((x) => x.index)
      // A group with no conditions is ignored: it selects nothing by itself and blocks nothing.
      const inB = (i: number) => (bHasConditions ? rb.has(i) : true)
      expect(rowsOf(snap, spec(group('and', a, b), { qc }))).toEqual(all.filter((i) => ra.has(i) && inB(i)))
      expect(rowsOf(snap, spec(group('or', a, b), { qc }))).toEqual(all.filter((i) => ra.has(i) || (bHasConditions && rb.has(i))))
      expect(rowsOf(snap, spec(group('or', a, group('and'), group('or', group('and'))), { qc }))).toEqual([...ra])
      expect(rowsOf(snap, spec(group('and'), { qc }))).toEqual(all)
    })
  })

  it('keeping missing values never removes a row, and a visit restriction only removes other visits', () => {
    forCases((r, snap) => {
      const c = randomCondition(r, snap)
      const qc = { exclude: randomQc(r) }
      const strict = rowsOf(snap, spec(group('and', { ...c, onMissing: 'exclude' }), { qc }))
      const lenient = new Set(rowsOf(snap, spec(group('and', { ...c, onMissing: 'include' }), { qc })))
      expect(strict.every((i) => lenient.has(i))).toBe(true)
      const f = randomFilter(r, snap)
      const everything = rowsOf(snap, spec(f, { qc }))
      for (const v of snap.visits) expect(rowsOf(snap, spec(f, { qc, visitIds: [v.id] }))).toEqual(everything.filter((i) => snap.rows[i].visitId === v.id))
    })
  })

  it('excluding more QC categories never adds a row to a filter that drops unavailable values', () => {
    forCases((r, snap) => {
      const c: FilterCondition = { ...randomCondition(r, snap), onMissing: 'exclude' }
      if (c.test.kind === 'missing') return // "is missing" is the one test that an exclusion can satisfy
      const some = randomQc(r)
      const more = [...new Set([...some, ...randomQc(r)])]
      const fewer = new Set(rowsOf(snap, spec(group('and', c), { qc: { exclude: some } })))
      expect(rowsOf(snap, spec(group('and', c), { qc: { exclude: more } })).every((i) => fewer.has(i))).toBe(true)
    })
  })

  it('counts, chart data and pairs account for every selected row exactly once', () => {
    forCases((r, snap) => {
      const sel = computeSelection(snap, spec(randomFilter(r, snap), { qc: { exclude: randomQc(r) } }))
      const x = snap.variables[0].index
      const y = snap.variables[1].index
      const c = countsFor(sel, x)
      expect(c.missing + c.qcExcluded + c.numeric + c.censored + c.text).toBe(sel.rows.length)
      expect(c.included).toBe(c.numeric + c.censored + c.text)
      const d = distributionData(sel, x, snap.variables[3].index, 'linear')
      expect(d.totals).toMatchObject({ rows: sel.rows.length, usableNumeric: c.numeric, missing: c.missing, censored: c.censored, nonNumeric: c.text, qcExcluded: c.qcExcluded })
      expect(d.groups.reduce((n, g) => n + g.points.length, 0)).toBe(c.numeric)
      expect(d.groups.reduce((n, g) => n + g.censoring.censored, 0)).toBe(c.censored)
      const p = pairedObservations(sel, x, y)
      expect(p.pairs.length + p.missingX + p.missingY + p.missingBoth + p.unevaluable + p.qcExcluded).toBe(sel.rows.length)
      const s = scatterData(sel, x, y, 'linear', 'linear')
      expect(s.points.length).toBe(p.pairs.length)
      expect(s.points.every((pt) => sel.rows.includes(pt.row))).toBe(true)
    })
  })
})
