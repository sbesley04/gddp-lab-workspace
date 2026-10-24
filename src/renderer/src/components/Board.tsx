import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { ArrowLeft, Download, GripHorizontal, LayoutGrid, Maximize2, Minus, Plus, StickyNote, Trash2, X, Loader2, Check, Pin } from 'lucide-react'
import type { ChartStyle, DatasetSnapshot, SavedViewSpec } from '@core/types'
import { normalizeChart } from '@core/chartStyle'
import { computeSelection, describeFilter, getObservation } from '@core/selection'
import { distributionData, scatterData } from '@core/chartData'
import { displayValue } from '@core/values'
import { call } from '../api'
import { useStore, errorText } from '../store'
import { label, qcPolicyText } from '../lib/format'
import { EChart, type EChartHandle } from './EChart'
import { distributionOption, scatterOption } from './chartOptions'
import { StyleEditor } from './ChartControls'
import { useScheme } from '../pages/Explore'

export interface BoardCard {
  id: string
  kind: 'view' | 'note'
  viewId: string | null
  x: number
  y: number
  w: number
  h: number
  text: string | null
  style: ChartStyle | null
}

export interface BoardLayout {
  cards: BoardCard[]
  boardStyle: ChartStyle | null
  grid: number
}

export interface BoardRecord {
  id: string
  name: string
  layout: BoardLayout
  updatedAt: string
}

export interface ViewRecord {
  id: string
  name: string
  datasetVersionId: string
  datasetVersionNumber: number
  metadataVersion: number
  spec: SavedViewSpec
  metadataChangedSince: number
}

// Snapshots pinned to (dataset version, metadata version) never change, so they can be cached.
const snapshotCache = new Map<string, Promise<DatasetSnapshot>>()
function loadSnapshot(versionId: string, asOf: number) {
  const k = `${versionId}@${asOf}`
  let p = snapshotCache.get(k)
  if (!p) {
    p = call<DatasetSnapshot>('data:snapshot', { datasetVersionId: versionId, asOf })
    p.catch(() => snapshotCache.delete(k))
    snapshotCache.set(k, p)
  }
  return p
}

const HEADER = 38
const newId = () => Math.random().toString(36).slice(2, 10)

interface CardHandle {
  svg: () => string | null
}

export function BoardEditor({ boardId, onBack }: { boardId: string; onBack: () => void }) {
  const toast = useStore((s) => s.toast)
  const [board, setBoard] = useState<BoardRecord | null>(null)
  const [views, setViews] = useState<ViewRecord[]>([])
  const [zoom, setZoom] = useState(0.8)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty'>('saved')
  const cardRefs = useRef(new Map<string, CardHandle>())
  const dirty = useRef(false)

  useEffect(() => {
    call<BoardRecord>('boards:get', { id: boardId }).then(setBoard).catch((e) => toast('error', errorText(e)))
    call<ViewRecord[]>('views:list').then(setViews).catch(() => setViews([]))
  }, [boardId, toast])

  // Debounced autosave of layout and name.
  useEffect(() => {
    if (!board || !dirty.current) return
    setSaveState('dirty')
    const t = setTimeout(async () => {
      setSaveState('saving')
      try {
        await call('boards:save', { id: board.id, name: board.name, layout: board.layout })
        dirty.current = false
        setSaveState('saved')
      } catch (e) {
        toast('error', errorText(e))
        setSaveState('dirty')
      }
    }, 600)
    return () => clearTimeout(t)
  }, [board, toast])

  const update = useCallback((fn: (b: BoardRecord) => BoardRecord) => {
    dirty.current = true
    setBoard((b) => (b ? fn(b) : b))
  }, [])
  const updateCard = useCallback((id: string, patch: Partial<BoardCard>) => update((b) => ({ ...b, layout: { ...b.layout, cards: b.layout.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)) } })), [update])
  const toFront = useCallback((id: string) => update((b) => {
    const c = b.layout.cards.find((x) => x.id === id)
    if (!c || b.layout.cards[b.layout.cards.length - 1].id === id) return b
    return { ...b, layout: { ...b.layout, cards: [...b.layout.cards.filter((x) => x.id !== id), c] } }
  }), [update])

  // Positions are computed inside the state update so several cards added at once never overlap,
  // and new cards fill the visible width before starting a new row.
  const canvasRef = useRef<HTMLDivElement>(null)
  const [lastAdded, setLastAdded] = useState<string | null>(null)
  const slotFor = (cards: BoardCard[], w: number, h: number) => {
    const visible = (canvasRef.current?.clientWidth ?? 1400) / zoom
    const cellW = Math.max(w, 640) + 40
    const cols = Math.max(1, Math.floor((visible - 40) / cellW))
    const i = cards.length
    return { x: 40 + (i % cols) * cellW, y: 40 + Math.floor(i / cols) * (Math.max(h, 480) + 40) }
  }
  const addCard = (make: (cards: BoardCard[]) => BoardCard) =>
    update((b) => {
      const card = make(b.layout.cards)
      setLastAdded(card.id)
      return { ...b, layout: { ...b.layout, cards: [...b.layout.cards, card] } }
    })
  useEffect(() => {
    if (!lastAdded) return
    const t = setTimeout(() => document.querySelector(`[data-card-id="${lastAdded}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }), 60)
    return () => clearTimeout(t)
  }, [lastAdded])
  const addView = (v: ViewRecord) => addCard((cards) => ({ id: newId(), kind: 'view', viewId: v.id, ...slotFor(cards, 640, 480), w: 640, h: 480, text: null, style: null }))
  const addNote = () => addCard((cards) => ({ id: newId(), kind: 'note', viewId: null, ...slotFor(cards, 320, 220), w: 320, h: 220, text: '', style: null }))
  const tidy = () => update((b) => {
    let x = 40
    let y = 40
    let rowH = 0
    const maxW = 2200
    const cards = b.layout.cards.map((c) => {
      if (x + c.w > maxW && x > 40) {
        x = 40
        y += rowH + 40
        rowH = 0
      }
      const placed = { ...c, x, y }
      x += c.w + 40
      rowH = Math.max(rowH, c.h)
      return placed
    })
    return { ...b, layout: { ...b.layout, cards } }
  })

  const bounds = useMemo(() => {
    const cards = board?.layout.cards ?? []
    return {
      w: Math.max(1200, ...cards.map((c) => c.x + c.w + 80)),
      h: Math.max(800, ...cards.map((c) => c.y + c.h + 80))
    }
  }, [board])

  const exportBoard = async (format: 'svg' | 'png') => {
    if (!board) return
    try {
      const svg = composeBoardSvg(board, views, cardRefs.current)
      let data = svg
      if (format === 'png') data = await rasterize(svg, 2)
      const r = await call<{ fileName: string } | null>('export:chart', { format, data, suggestedName: board.name })
      if (r) toast('success', `Board saved as ${r.fileName}`)
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  if (!board) return <div className="paper empty"><Loader2 className="spin" /></div>
  const viewById = new Map(views.map((v) => [v.id, v]))
  const g = board.layout.grid
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row wrap">
        <button className="btn ghost sm" onClick={onBack}><ArrowLeft size={14} /> Boards</button>
        <input className="input" style={{ width: 280, fontWeight: 650 }} value={board.name} onChange={(e) => update((b) => ({ ...b, name: e.target.value }))} aria-label="Board name" data-testid="board-name" />
        <span className="small muted row" style={{ gap: 4, minWidth: 64 }} aria-live="polite">{saveState === 'saved' ? <><Check size={13} /> Saved</> : <><Loader2 size={13} className="spin" /> Saving…</>}</span>
        <span className="spacer" />
        <AddViewButton views={views} onAdd={addView} onAddAll={() => views.filter((v) => !board.layout.cards.some((c) => c.viewId === v.id)).forEach(addView)} />
        <button className="btn sm" onClick={addNote}><StickyNote size={14} /> Note</button>
        <button className="btn sm" onClick={tidy} title="Arrange cards in rows"><LayoutGrid size={14} /> Tidy</button>
        <StyleEditor label="Style all" value={board.layout.boardStyle ?? normalizeChart({ type: 'scatter', measureKey: null, compareKey: null, groupKey: null, xScale: 'linear', yScale: 'linear', tableColumns: [] }).style} onChange={(s) => update((b) => ({ ...b, layout: { ...b.layout, boardStyle: s, cards: b.layout.cards.map((c) => ({ ...c, style: null })) } }))} />
        {board.layout.boardStyle && <button className="btn ghost sm" onClick={() => update((b) => ({ ...b, layout: { ...b.layout, boardStyle: null } }))} title="Each card uses its saved view's style">Use view styles</button>}
        <div className="seg" role="group" aria-label="Zoom">
          <button onClick={() => setZoom((z) => Math.max(0.3, +(z - 0.1).toFixed(2)))} aria-label="Zoom out"><Minus size={13} /></button>
          <button onClick={() => setZoom(1)} aria-label="Reset zoom">{Math.round(zoom * 100)}%</button>
          <button onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.1).toFixed(2)))} aria-label="Zoom in"><Plus size={13} /></button>
        </div>
        <Popover.Root>
          <Popover.Trigger asChild>
            <button className="btn sm" aria-label="Download board"><Download size={14} /> Download</button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content className="popover" align="end" sideOffset={8} style={{ width: 230 }}>
              <div className="list">
                <Popover.Close asChild>
                  <button className="list-item" onClick={() => exportBoard('svg')}><div><div className="t">SVG (vector)</div><div className="s">Whole board, editable</div></div></button>
                </Popover.Close>
                <Popover.Close asChild>
                  <button className="list-item" onClick={() => exportBoard('png')}><div><div className="t">PNG (2×)</div><div className="s">Whole board as an image</div></div></button>
                </Popover.Close>
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
      <div className="board-canvas paper" style={{ height: 'calc(100vh - 230px)' }} ref={canvasRef}>
        <div style={{ width: bounds.w * zoom, height: bounds.h * zoom, position: 'relative' }}>
          <div className="board-surface" style={{ width: bounds.w, height: bounds.h, transform: `scale(${zoom})`, backgroundSize: `${g * 2}px ${g * 2}px` }}>
            {board.layout.cards.length === 0 && (
              <div className="empty" style={{ position: 'absolute', inset: 0 }}>
                <div className="ic"><LayoutGrid /></div>
                <h3>Add saved views to compare them side by side</h3>
                <p>Drag cards by their header, resize from the corner, and add notes. Each chart stays pinned to the dataset and metadata version it was saved with.</p>
              </div>
            )}
            {board.layout.cards.map((c) => (
              <CardFrame key={c.id} card={c} zoom={zoom} grid={g} onChange={(p) => updateCard(c.id, p)} onFront={() => toFront(c.id)} onRemove={() => update((b) => ({ ...b, layout: { ...b.layout, cards: b.layout.cards.filter((x) => x.id !== c.id) } }))}
                title={c.kind === 'note' ? 'Note' : viewById.get(c.viewId ?? '')?.name ?? 'Missing view'}
                extra={c.kind === 'view' ? (
                  <StyleEditor compact value={c.style ?? board.layout.boardStyle ?? normalizeChart(viewById.get(c.viewId ?? '')?.spec.chart ?? { type: 'scatter', measureKey: null, compareKey: null, groupKey: null, xScale: 'linear', yScale: 'linear', tableColumns: [] }).style} onChange={(s) => updateCard(c.id, { style: s })} />
                ) : null}
              >
                {c.kind === 'note' ? (
                  <textarea className="board-note" value={c.text ?? ''} placeholder="Write a note…" onChange={(e) => updateCard(c.id, { text: e.target.value })} aria-label="Note text" />
                ) : viewById.get(c.viewId ?? '') ? (
                  <ViewChart ref={(h) => { if (h) cardRefs.current.set(c.id, h); else cardRefs.current.delete(c.id) }} view={viewById.get(c.viewId!)!} style={c.style ?? board.layout.boardStyle} width={c.w - 16} />
                ) : (
                  <div className="empty small">This saved view was deleted.</div>
                )}
              </CardFrame>
            ))}
          </div>
        </div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Layout saves automatically. Statistics overlays and axis bounds come from each saved view; styles here change appearance only.</p>
    </div>
  )
}

function AddViewButton({ views, onAdd, onAddAll }: { views: ViewRecord[]; onAdd: (v: ViewRecord) => void; onAddAll: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button className="btn primary sm" data-testid="board-add-view"><Plus size={14} /> Add view</button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover" align="end" sideOffset={8} style={{ width: 380 }}>
          {views.length === 0 ? <p className="small muted">No saved views yet. Save one from Explore first.</p> : (
            <div className="list">
              {views.map((v) => (
                <button key={v.id} className="list-item" onClick={() => { onAdd(v); setOpen(false) }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="t">{v.name}</div>
                    <div className="s">{v.spec.chart.type} · dataset v{v.datasetVersionNumber} · metadata rev. {v.metadataVersion}</div>
                  </div>
                </button>
              ))}
              <button className="btn sm" style={{ marginTop: 6 }} onClick={() => { onAddAll(); setOpen(false) }}>Add all views</button>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function CardFrame({ card, zoom, grid, onChange, onFront, onRemove, title, extra, children }: {
  card: BoardCard; zoom: number; grid: number; onChange: (p: Partial<BoardCard>) => void; onFront: () => void; onRemove: () => void; title: string; extra: React.ReactNode; children: React.ReactNode
}) {
  const snap = (v: number) => Math.round(v / grid) * grid
  const startDrag = (e: React.PointerEvent, mode: 'move' | 'resize') => {
    if ((e.target as HTMLElement).closest('button, input, textarea, select')) return
    e.preventDefault()
    onFront()
    const sx = e.clientX
    const sy = e.clientY
    const o = { x: card.x, y: card.y, w: card.w, h: card.h }
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / zoom
      const dy = (ev.clientY - sy) / zoom
      if (mode === 'move') onChange({ x: Math.max(0, snap(o.x + dx)), y: Math.max(0, snap(o.y + dy)) })
      else onChange({ w: Math.max(260, snap(o.w + dx)), h: Math.max(200, snap(o.h + dy)) })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div className={`board-card ${card.kind === 'note' ? 'note' : ''}`} style={{ left: card.x, top: card.y, width: card.w, height: card.h }} data-testid="board-card" data-card-id={card.id}>
      <div className="board-card-head" onPointerDown={(e) => startDrag(e, 'move')} title="Drag to move">
        <GripHorizontal size={14} className="muted" />
        <span className="t">{title}</span>
        <span className="spacer" />
        {extra}
        <button className="btn ghost sm icon" aria-label="Remove card" onClick={onRemove}><X size={13} /></button>
      </div>
      <div className="board-card-body">{children}</div>
      <div className="board-resize" onPointerDown={(e) => startDrag(e, 'resize')} title="Drag to resize"><Maximize2 size={11} /></div>
    </div>
  )
}

const ViewChart = forwardRef<CardHandle, { view: ViewRecord; style: ChartStyle | null; width: number }>(function ViewChart({ view, style, width }, ref) {
  const [snap, setSnap] = useState<DatasetSnapshot | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const dark = useScheme()
  const chartRef = useRef<EChartHandle>(null)
  useEffect(() => {
    loadSnapshot(view.datasetVersionId, view.metadataVersion).then(setSnap).catch((e) => setErr(errorText(e)))
  }, [view.datasetVersionId, view.metadataVersion])
  const chart = useMemo(() => {
    const c = normalizeChart(view.spec.chart)
    return style ? { ...c, style } : c
  }, [view, style])
  const built = useMemo(() => {
    if (!snap) return null
    const sel = computeSelection(snap, view.spec.selection)
    const byKey = new Map(snap.variables.map((v) => [v.key, v]))
    const m = chart.measureKey ? byKey.get(chart.measureKey) : undefined
    const f = describeFilter(sel.ctx, view.spec.selection.filter)
    const subtitle = `n = ${sel.participantIds.length} · ${f === 'All rows' ? 'no cohort filter' : f} · QC: ${qcPolicyText(view.spec.selection.qc.exclude)}`
    if (chart.type === 'distribution' && m) {
      const g = chart.groupKey ? byKey.get(chart.groupKey) ?? null : null
      return { kind: 'chart' as const, ...distributionOption(distributionData(sel, m.index, g?.index ?? null, chart.yScale), m, g, chart, { dark, highlight: new Set(), subtitle }) }
    }
    const x = chart.compareKey ? byKey.get(chart.compareKey) : undefined
    if (chart.type === 'scatter' && m && x) return { kind: 'chart' as const, ...scatterOption(scatterData(sel, x.index, m.index, chart.xScale, chart.yScale), x, m, chart, { dark, highlight: new Set(), subtitle }) }
    const cols = (chart.tableColumns.length ? chart.tableColumns : [chart.measureKey, chart.compareKey, chart.groupKey]).filter((k): k is string => !!k).map((k) => byKey.get(k)).filter((v): v is NonNullable<typeof v> => !!v)
    return { kind: 'table' as const, sel, cols }
  }, [snap, view, chart, dark])
  useImperativeHandle(ref, () => ({ svg: () => (built?.kind === 'chart' ? chartRef.current?.svg() ?? null : null) }), [built])
  if (err) return <div className="empty small">{err}</div>
  if (!built) return <div className="empty"><Loader2 className="spin" /></div>
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="row small muted" style={{ gap: 6, padding: '0 4px 4px' }}>
        <Pin size={12} /> dataset v{view.datasetVersionNumber} · metadata rev. {view.metadataVersion}
        {view.metadataChangedSince > 0 && <span className="badge warn" title="Shown as saved; later curation is not applied">{view.metadataChangedSince} later change(s)</span>}
      </div>
      {built.kind === 'chart' ? (
        <div style={{ flex: 1, minHeight: 0, overflowX: built.minWidth > width ? 'auto' : 'hidden', overflowY: 'hidden' }}>
          <EChart ref={chartRef} option={built.option} height="100%" minWidth={built.minWidth} ariaLabel={view.name} />
        </div>
      ) : (
        <div className="table-wrap" style={{ flex: 1 }}>
          <table className="data">
            <thead><tr><th>Participant</th>{built.cols.map((c) => <th key={c.key}>{label(c)}</th>)}</tr></thead>
            <tbody>
              {built.sel.rows.map((r) => (
                <tr key={r}>
                  <td>{snap!.rows[r].participantId}</td>
                  {built.cols.map((c) => {
                    const o = getObservation(built.sel.ctx, r, c.index)
                    return <td key={c.key} className="num">{o.value.k === 'missing' || o.qcExcludedBy.length ? '—' : displayValue(o.value)}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
})

// ---------------------------------------------------------------- export

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function composeBoardSvg(board: BoardRecord, views: ViewRecord[], refs: Map<string, CardHandle>): string {
  const cards = board.layout.cards
  const pad = 24
  const minX = Math.min(...cards.map((c) => c.x), 0)
  const minY = Math.min(...cards.map((c) => c.y), 0)
  const W = Math.max(...cards.map((c) => c.x + c.w), 400) - minX + pad * 2
  const H = Math.max(...cards.map((c) => c.y + c.h), 300) - minY + pad * 2 + 30
  const font = 'Helvetica Neue, Helvetica, Arial, sans-serif'
  const parts: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${font}">`, `<rect width="100%" height="100%" fill="#ffffff"/>`, `<text x="${pad}" y="${pad + 4}" font-size="18" font-weight="700" fill="#111827">${esc(board.name)}</text>`]
  const viewName = new Map(views.map((v) => [v.id, v]))
  for (const c of cards) {
    const x = c.x - minX + pad
    const y = c.y - minY + pad + 30
    parts.push(`<g transform="translate(${x},${y})">`, `<rect width="${c.w}" height="${c.h}" rx="12" fill="#ffffff" stroke="#d1d5db"/>`)
    if (c.kind === 'note') {
      parts.push(`<rect width="${c.w}" height="${c.h}" rx="12" fill="#fef9c3" stroke="#e5d97a"/>`)
      const lines = wrap(c.text ?? '', Math.floor((c.w - 24) / 7.2))
      lines.slice(0, Math.floor((c.h - 20) / 18)).forEach((l, i) => parts.push(`<text x="12" y="${26 + i * 18}" font-size="13" fill="#3f3f46">${esc(l)}</text>`))
    } else {
      const v = viewName.get(c.viewId ?? '')
      parts.push(`<text x="12" y="24" font-size="13" font-weight="650" fill="#111827">${esc(v?.name ?? 'Missing view')}</text>`)
      if (v) parts.push(`<text x="${c.w - 12}" y="24" font-size="10.5" text-anchor="end" fill="#6b7280">dataset v${v.datasetVersionNumber} · metadata rev. ${v.metadataVersion}</text>`)
      const svg = refs.get(c.id)?.svg()
      if (svg) {
        const inner = svg.replace(/^<\?xml[^>]*>\s*/, '').replace(/^<svg/, `<svg x="6" y="${HEADER + 18}"`)
        parts.push(inner)
      }
    }
    parts.push('</g>')
  }
  parts.push('</svg>')
  return parts.join('\n')
}

function wrap(text: string, width: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/)) {
      if ((line + ' ' + word).trim().length > width) {
        if (line) out.push(line)
        line = word
      } else line = (line + ' ' + word).trim()
    }
    out.push(line)
  }
  return out
}

async function rasterize(svg: string, scale: number): Promise<string> {
  const m = /width="(\d+(?:\.\d+)?)" height="(\d+(?:\.\d+)?)"/.exec(svg)
  const w = Number(m?.[1] ?? 1200)
  const h = Number(m?.[2] ?? 800)
  const img = new Image()
  await new Promise<void>((res, rej) => {
    img.onload = () => res()
    img.onerror = () => rej(new Error('Could not rasterise board'))
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  })
  const canvas = document.createElement('canvas')
  canvas.width = w * scale
  canvas.height = h * scale
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}

// ---------------------------------------------------------------- list

export function BoardList({ onOpen }: { onOpen: (id: string) => void }) {
  const [boards, setBoards] = useState<{ id: string; name: string; updatedAt: string; cards: number }[] | null>(null)
  const toast = useStore((s) => s.toast)
  const load = useCallback(() => call<any[]>('boards:list').then(setBoards).catch(() => setBoards([])), [])
  useEffect(() => {
    void load()
  }, [load])
  const create = async () => {
    try {
      const b = await call<BoardRecord>('boards:save', { id: null, name: `Comparison ${new Date().toLocaleDateString()}`, layout: { cards: [], boardStyle: null, grid: 20 } })
      onOpen(b.id)
    } catch (e) {
      toast('error', errorText(e))
    }
  }
  return (
    <div className="stack">
      <div className="row">
        <p className="muted small" style={{ margin: 0, flex: 1 }}>Boards put saved views side by side on a movable canvas. Each chart stays reproduced from its own pinned versions.</p>
        <button className="btn primary" onClick={create} data-testid="new-board"><Plus size={15} /> New board</button>
      </div>
      {boards && boards.length === 0 && (
        <div className="paper empty"><div className="ic"><LayoutGrid /></div><h3>No boards yet</h3><p>Create a board, then add saved views and notes.</p></div>
      )}
      <div className="grid cols-3">
        {boards?.map((b) => (
          <div key={b.id} className="paper card" style={{ cursor: 'pointer' }} onClick={() => onOpen(b.id)}>
            <div className="card-head">
              <h3 style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}><LayoutGrid size={16} /> {b.name}</h3>
              <span className="spacer" />
              <button
                className="btn ghost sm icon"
                aria-label={`Delete ${b.name}`}
                onClick={async (e) => {
                  e.stopPropagation()
                  if (!confirm(`Delete board “${b.name}”? The saved views themselves are kept.`)) return
                  await call('boards:delete', { id: b.id })
                  void load()
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="small muted">{b.cards} card(s) · updated {new Date(b.updatedAt).toLocaleString()}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
