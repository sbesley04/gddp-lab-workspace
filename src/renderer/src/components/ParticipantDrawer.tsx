import { useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Search, MessageSquare } from 'lucide-react'
import { getObservation } from '@core/selection'
import { displayValue } from '@core/values'
import { useStore } from '../store'
import { useSelection } from '../lib/selection'
import { label, areaOf } from '../lib/format'

/** All recorded observations for one participant, by area and visit. No clinical interpretation. */
export function ParticipantDrawer() {
  const pid = useStore((s) => s.participantDrawer)
  const open = useStore((s) => s.openParticipant)
  const snapshot = useStore((s) => s.snapshot)
  const sel = useSelection()
  const [q, setQ] = useState('')
  const [onlyPresent, setOnlyPresent] = useState(true)
  const rows = useMemo(() => (snapshot && pid ? snapshot.rows.filter((r) => r.participantId === pid) : []), [snapshot, pid])
  if (!snapshot || !sel) return null
  const measures = snapshot.variables.filter((v) => v.role === 'measure')
  const groups = new Map<string, typeof measures>()
  for (const v of measures) {
    if (q && !`${v.header} ${label(v)}`.toLowerCase().includes(q.toLowerCase())) continue
    if (onlyPresent && rows.every((r) => snapshot.values[v.index][r.index].k === 'missing')) continue
    groups.set(areaOf(v), [...(groups.get(areaOf(v)) ?? []), v])
  }
  const notes = snapshot.annotations.filter((a) => a.row !== null && rows.some((r) => r.index === a.row))
  const presentCount = measures.filter((v) => rows.some((r) => snapshot.values[v.index][r.index].k !== 'missing')).length
  return (
    <Dialog.Root open={!!pid} onOpenChange={(o) => !o && open(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="drawer" aria-describedby={undefined}>
          <div className="dialog-head">
            <div style={{ flex: 1 }}>
              <Dialog.Title asChild><h2>Participant {pid}</h2></Dialog.Title>
              <div className="small muted">{rows.length} row(s) · visits: {rows.map((r) => snapshot.visits.find((v) => v.id === r.visitId)?.name).join(', ')} · {presentCount} of {measures.length} measures recorded</div>
            </div>
            <Dialog.Close className="btn ghost icon" aria-label="Close"><X size={16} /></Dialog.Close>
          </div>
          <div className="dialog-body">
            <div className="callout neutral" style={{ marginBottom: 10 }}><p className="small">Recorded study values with their source context. Nothing here is a clinical interpretation or recommendation.</p></div>
            <div className="row" style={{ marginBottom: 10 }}>
              <Search size={14} className="muted" />
              <input className="input" style={{ flex: 1 }} placeholder="Filter measures…" value={q} onChange={(e) => setQ(e.target.value)} />
              <label className="check small"><input type="checkbox" checked={onlyPresent} onChange={(e) => setOnlyPresent(e.target.checked)} /> Recorded only</label>
            </div>
            {notes.length > 0 && (
              <div className="stack" style={{ gap: 6, marginBottom: 12 }}>
                {notes.map((n) => (
                  <div key={n.id} className="flag-item"><span className="row small muted"><MessageSquare size={13} /> <span className="mono">{n.address}</span></span><div>{n.text}</div></div>
                ))}
              </div>
            )}
            {[...groups.entries()].map(([area, vs]) => (
              <div key={area} style={{ marginBottom: 14 }}>
                <div className="group-label" style={{ padding: '6px 0' }}>{area}</div>
                <div className="table-wrap">
                  <table className="data">
                    <thead><tr><th>Measure</th>{rows.map((r) => <th key={r.index}>{snapshot.visits.find((v) => v.id === r.visitId)?.name}</th>)}<th>Unit</th></tr></thead>
                    <tbody>
                      {vs.map((v) => (
                        <tr key={v.key}>
                          <td title={v.header} style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>{label(v)}</td>
                          {rows.map((r) => {
                            const o = getObservation(sel.ctx, r.index, v.index)
                            return (
                              <td key={r.index} className="cell num" onClick={() => { useStore.getState().inspect({ row: r.index, variable: v.index }); open(null) }}>
                                {o.value.k === 'missing' ? <span className="muted">—</span> : displayValue(o.value)}
                                {o.flags.some((f) => f.category && f.category !== 'unresolved_highlight') && <span className="cellflag" />}
                                {o.flags.some((f) => f.category === 'unresolved_highlight') && <span className="cellflag unresolved" />}
                              </td>
                            )
                          })}
                          <td className="muted small">{v.meta.unit.value ?? 'unknown'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
