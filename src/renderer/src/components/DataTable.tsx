import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, Search } from 'lucide-react'
import type { VariableInfo } from '@core/types'
import { getObservation, type SelectionResult } from '@core/selection'
import { displayValue } from '@core/values'
import { useStore } from '../store'
import { label } from '../lib/format'

const WIDE_THRESHOLD = 12
const PID_W = 140
const VISIT_W = 110
const LEAD_W = PID_W + VISIT_W
const COL_W = 150

interface Props {
  sel: SelectionResult
  columns: VariableInfo[]
  rows?: number[] // defaults to sel.rows
  maxHeight?: number
  testId?: string
}

/**
 * Observation table bound to the shared selection. Click a value to inspect its source cell, or use the keyboard:
 * the table body is one Tab stop, the arrow keys move between values, and Enter or Space opens the inspector.
 */
export function DataTable({ sel, columns, rows, maxHeight = 420, testId }: Props) {
  const snapshot = sel.ctx.snapshot
  const highlight = useStore((s) => s.highlight)
  const setHighlight = useStore((s) => s.setHighlight)
  const inspect = useStore((s) => s.inspect)
  const inspected = useStore((s) => s.inspected)
  const openParticipant = useStore((s) => s.openParticipant)
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null)
  const [q, setQ] = useState('')
  // The value that takes focus when the table is tabbed into: a position in the sorted rows and the columns.
  const [active, setActiveState] = useState({ ri: 0, ci: 0 })
  // Also kept in a ref: with a held-down arrow key the next key press arrives before focus has moved to the new cell.
  const activeRef = useRef(active)
  const setActive = (a: { ri: number; ci: number }) => {
    activeRef.current = a
    setActiveState(a)
  }
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

  // Wide tables (e.g. a whole NULISA panel) render only the columns in view; ID and visit stay pinned.
  const wide = columns.length > WIDE_THRESHOLD
  const colVirt = useVirtualizer({ horizontal: true, count: wide ? columns.length : 0, getScrollElement: () => scroller.current, estimateSize: () => COL_W, overscan: 3, paddingStart: LEAD_W })
  const colItems = colVirt.getVirtualItems()
  const shown = wide ? colItems.map((i) => columns[i.index]) : columns
  const padLeft = wide && colItems.length ? colItems[0].start - LEAD_W : 0
  const padRight = wide && colItems.length ? colVirt.getTotalSize() - colItems[colItems.length - 1].end : 0
  const spacer = (w: number, k: string, as: 'th' | 'td') => (w > 0 ? (as === 'th' ? <th key={k} style={{ width: w, padding: 0 }} aria-hidden /> : <td key={k} style={{ width: w, padding: 0 }} aria-hidden />) : null)

  const activeRi = Math.min(active.ri, Math.max(0, ordered.length - 1))
  const activeCi = Math.min(active.ci, Math.max(0, columns.length - 1))
  const moveTo = (ri: number, ci: number) => {
    const next = { ri: Math.max(0, Math.min(ordered.length - 1, ri)), ci: Math.max(0, Math.min(columns.length - 1, ci)) }
    setActive(next)
    // Rows and (in wide tables) columns outside the view are not in the page until scrolled to.
    virt.scrollToIndex(next.ri)
    if (wide) colVirt.scrollToIndex(next.ci)
    const focus = (tries: number) => {
      const cell = scroller.current?.querySelector<HTMLElement>(`[data-cell="${next.ri}:${next.ci}"]`)
      if (cell) cell.focus()
      else if (tries > 0) requestAnimationFrame(() => focus(tries - 1))
    }
    requestAnimationFrame(() => focus(5))
  }
  const onCellKey = (e: React.KeyboardEvent, open: () => void) => {
    const { ri, ci } = activeRef.current
    const step: Record<string, [number, number]> = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1], PageDown: [10, 0], PageUp: [-10, 0] }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      open()
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      moveTo(ri, e.key === 'Home' ? 0 : columns.length - 1)
    } else if (step[e.key]) {
      e.preventDefault()
      moveTo(ri + step[e.key][0], ci + step[e.key][1])
    }
  }

  const header = (key: string, text: string, title?: string, sticky = false) => (
    <th key={key} className={sticky ? 'sticky' : ''} title={title} style={wide ? { width: sticky ? PID_W : COL_W, overflow: 'hidden', textOverflow: 'ellipsis' } : undefined} aria-sort={sort?.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
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
        <span className="muted small">{ordered.length} row(s){wide ? ` · ${columns.length} columns (scroll sideways)` : ''} · missing values sort last · click a value to inspect its source, or move with the arrow keys and press Enter</span>
      </div>
      <div className="table-wrap" ref={scroller} style={{ maxHeight }} data-testid={testId}>
        <table className="data" style={wide ? { tableLayout: 'fixed', width: colVirt.getTotalSize() } : undefined} aria-colcount={columns.length + 2}>
          <thead>
            <tr>
              {header('__pid', 'Participant', undefined, true)}
              <th className={wide ? 'sticky sticky2' : ''} style={wide ? { width: VISIT_W } : undefined}>Visit</th>
              {spacer(padLeft, '__l', 'th')}
              {shown.map((c) => header(c.key, label(c), `${c.header} · column ${c.letter}`))}
              {spacer(padRight, '__r', 'th')}
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
                  <td className={`muted ${wide ? 'sticky sticky2' : ''}`}>{visitName(row.visitId)}</td>
                  {spacer(padLeft, '__l', 'td')}
                  {shown.map((c, k) => {
                    const ci = wide ? colItems[k].index : k
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
                        onClick={() => { setActive({ ri: it.index, ci }); inspect({ row: r, variable: c.index }) }}
                        // One Tab stop for the whole table body (roving tabindex); arrow keys move it.
                        tabIndex={it.index === activeRi && ci === activeCi ? 0 : -1}
                        data-cell={`${it.index}:${ci}`}
                        onFocus={() => setActive({ ri: it.index, ci })}
                        onKeyDown={(e) => onCellKey(e, () => inspect({ row: r, variable: c.index }))}
                        aria-label={`${label(c)}, ${row.participantId}: ${o.value.k === 'missing' ? 'missing' : displayValue(o.value)}${excluded ? ', excluded by QC policy' : ''}. Press Enter to inspect its source.`}
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
                  {spacer(padRight, '__r', 'td')}
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
