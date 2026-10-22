import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, Search } from 'lucide-react'
import type { VariableInfo } from '@core/types'
import { getObservation, type SelectionResult } from '@core/selection'
import { displayValue } from '@core/values'
import { useStore } from '../store'
import { label } from '../lib/format'

interface Props {
  sel: SelectionResult
  columns: VariableInfo[]
  rows?: number[] // defaults to sel.rows
  maxHeight?: number
  testId?: string
}

/** Observation table bound to the shared selection. Click a value to inspect its source cell. */
export function DataTable({ sel, columns, rows, maxHeight = 420, testId }: Props) {
  const snapshot = sel.ctx.snapshot
  const highlight = useStore((s) => s.highlight)
  const setHighlight = useStore((s) => s.setHighlight)
  const inspect = useStore((s) => s.inspect)
  const inspected = useStore((s) => s.inspected)
  const openParticipant = useStore((s) => s.openParticipant)
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null)
  const [q, setQ] = useState('')
  const hl = useMemo(() => new Set(highlight), [highlight])
  const annotated = useMemo(() => new Set(snapshot.annotations.filter((a) => a.row !== null && a.variable !== null).map((a) => `${a.row}:${a.variable}`)), [snapshot])

  const visitName = (id: string) => snapshot.visits.find((v) => v.id === id)?.name ?? ''
  const baseRows = rows ?? sel.rows
  const ordered = useMemo(() => {
    let rs = baseRows.filter((r) => !q || snapshot.rows[r].participantId.toLowerCase().includes(q.toLowerCase()))
    if (sort) {
      const v = columns.find((c) => c.key === sort.key)
      rs = [...rs].sort((a, b) => {
        if (sort.key === '__pid') return snapshot.rows[a].participantId.localeCompare(snapshot.rows[b].participantId, undefined, { numeric: true }) * sort.dir
        if (!v) return 0
        const va = snapshot.values[v.index][a]
        const vb = snapshot.values[v.index][b]
        const rank = (x: typeof va) => (x.k === 'number' ? 0 : x.k === 'censored' ? 1 : x.k === 'text' ? 2 : 3)
        if (va.k === 'number' && vb.k === 'number') return (va.v - vb.v) * sort.dir
        if (rank(va) !== rank(vb)) return rank(va) - rank(vb) // missing always last
        return displayValue(va).localeCompare(displayValue(vb), undefined, { numeric: true }) * sort.dir
      })
    }
    return rs
  }, [baseRows, sort, columns, snapshot, q])

  const scroller = useRef<HTMLDivElement>(null)
  const virt = useVirtualizer({ count: ordered.length, getScrollElement: () => scroller.current, estimateSize: () => 34, overscan: 12 })
  const items = virt.getVirtualItems()
  const padTop = items.length ? items[0].start : 0
  const padBottom = items.length ? virt.getTotalSize() - items[items.length - 1].end : 0

  const header = (key: string, text: string, title?: string, sticky = false) => (
    <th className={sticky ? 'sticky' : ''} title={title} aria-sort={sort?.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button className="sort" onClick={() => setSort(sort?.key === key ? (sort.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 })}>
        {text}
        {sort?.key === key && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
    </th>
  )

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row">
        <Search size={14} className="muted" />
        <input className="input" style={{ width: 220, height: 30 }} placeholder="Find participant…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find participant" />
        <span className="muted small">{ordered.length} row(s) · missing values sort last · click a value to inspect its source</span>
      </div>
      <div className="table-wrap" ref={scroller} style={{ maxHeight }} data-testid={testId}>
        <table className="data">
          <thead>
            <tr>
              {header('__pid', 'Participant', undefined, true)}
              <th>Visit</th>
              {columns.map((c) => header(c.key, label(c), `${c.header} · column ${c.letter}`))}
            </tr>
          </thead>
          <tbody>
            {padTop > 0 && <tr style={{ height: padTop }} aria-hidden />}
            {items.map((it) => {
              const r = ordered[it.index]
              const row = snapshot.rows[r]
              return (
                <tr key={r} className={hl.has(r) ? 'hl' : ''} onMouseEnter={() => highlight.length <= 1 && setHighlight([r])} onMouseLeave={() => highlight.length <= 1 && setHighlight([])}>
                  <td className="sticky">
                    <button className="btn ghost sm" style={{ height: 22, padding: '0 6px', fontWeight: 650 }} onClick={() => openParticipant(row.participantId)} title="Open participant detail">
                      {row.participantId}
                    </button>
                  </td>
                  <td className="muted">{visitName(row.visitId)}</td>
                  {columns.map((c) => {
                    const o = getObservation(sel.ctx, r, c.index)
                    const excluded = o.qcExcludedBy.length > 0
                    const qc = o.flags.some((f) => f.category && f.category !== 'unresolved_highlight')
                    const unresolved = o.flags.some((f) => f.category === 'unresolved_highlight')
                    const sel_ = inspected?.row === r && inspected.variable === c.index
                    return (
                      <td
                        key={c.key}
                        className={`cell num ${o.value.k === 'missing' ? 'missing' : ''} ${excluded ? 'excluded' : ''}`}
                        style={sel_ ? { outline: '2px solid var(--accent)', outlineOffset: -2 } : undefined}
                        onClick={() => inspect({ row: r, variable: c.index })}
                        title={excluded ? `Excluded by QC policy: ${o.qcExcludedBy.join(', ')}` : o.value.k === 'censored' ? 'Censored value; bound not substituted' : undefined}
                      >
                        {o.value.k === 'missing' ? '—' : displayValue(o.value)}
                        {o.value.k === 'censored' && <span className="badge" style={{ marginLeft: 6, fontSize: 10 }}>censored</span>}
                        {qc && <span className="cellflag" aria-label="QC flag" />}
                        {unresolved && <span className="cellflag unresolved" aria-label="Unresolved formatting" />}
                        {annotated.has(`${r}:${c.index}`) && <span className="cellnote" aria-label="Has comment" />}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
            {padBottom > 0 && <tr style={{ height: padBottom }} aria-hidden />}
          </tbody>
        </table>
        {ordered.length === 0 && <div className="empty" style={{ padding: 28 }}>No rows match the current selection.</div>}
      </div>
    </div>
  )
}
