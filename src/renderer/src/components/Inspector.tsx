import { useState } from 'react'
import { X, MessageSquare, Ban, Undo2, MapPin } from 'lucide-react'
import { getObservation } from '@core/selection'
import { displayValue } from '@core/values'
import { call } from '../api'
import { useStore, errorText } from '../store'
import { useSelection } from '../lib/selection'
import { label, INTERP_TEXT, qcLabel } from '../lib/format'

/** Source inspection for one observation: raw value, address, attribution, flags, comments, exclusion. */
export function Inspector() {
  const snapshot = useStore((s) => s.snapshot)!
  const inspected = useStore((s) => s.inspected)!
  const inspect = useStore((s) => s.inspect)
  const asOf = useStore((s) => s.asOf)
  const toast = useStore((s) => s.toast)
  const sel = useSelection()!
  const [reason, setReason] = useState('')
  const row = snapshot.rows[inspected.row]
  const v = inspected.variable !== null ? snapshot.variables[inspected.variable] : null
  if (!row) return null
  const o = v ? getObservation(sel.ctx, inspected.row, v.index) : null
  const comments = snapshot.annotations.filter((a) => (v && a.variable === v.index && (a.row === inspected.row || a.row === null)) || (!v && a.row === inspected.row))
  const visit = snapshot.visits.find((x) => x.id === row.visitId)
  const excluded = o?.flags.some((f) => f.category === 'curator_exclusion')
  const editable = asOf === null

  const setExcluded = async (ex: boolean) => {
    if (!v) return
    try {
      await call('curation:setExclusion', { datasetVersionId: snapshot.datasetVersionId, varKey: v.key, participantId: row.participantId, visitId: row.visitId, excluded: ex, reason: reason || null })
      setReason('')
      await useStore.getState().reloadSnapshot()
      toast('success', ex ? 'Observation excluded (recorded with reason; reversible).' : 'Observation re-included.')
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  return (
    <aside className="inspector glass" aria-label="Inspector">
      <div className="row" style={{ padding: '14px 12px 6px 16px' }}>
        <strong style={{ flex: 1 }}>Inspector</strong>
        <button className="btn ghost sm icon" aria-label="Close inspector" onClick={() => inspect(null)}><X size={15} /></button>
      </div>
      <div className="body">
        <div className="row" style={{ alignItems: 'baseline' }}>
          <button className="btn ghost sm" style={{ padding: 0, fontSize: 18, fontWeight: 720 }} onClick={() => useStore.getState().openParticipant(row.participantId)}>{row.participantId}</button>
          <span className="muted">· {visit?.name}</span>
        </div>
        {v && o && (
          <>
            <h4>Measure</h4>
            <div style={{ fontWeight: 650 }}>{label(v)}</div>
            <div className="small muted">{v.header}</div>
            <h4>Value</h4>
            <div className="row" style={{ alignItems: 'baseline' }}>
              <span style={{ fontSize: 22, fontWeight: 720 }} className="num">{o.value.k === 'missing' ? '—' : displayValue(o.value)}</span>
              <span className="badge">{o.value.k === 'number' ? 'numeric' : o.value.k === 'censored' ? `censored (${o.value.op} ${o.value.bound})` : o.value.k === 'text' ? 'non-numeric text' : 'missing'}</span>
            </div>
            {o.value.k !== 'missing' && o.value.k !== 'number' && <div className="small muted">Raw source text: “{o.value.raw}”</div>}
            {o.qcExcludedBy.length > 0 && <div className="callout" style={{ marginTop: 8 }}><p>Excluded by the current QC policy ({o.qcExcludedBy.map(qcLabel).join(', ')}).</p></div>}
            <h4>Source</h4>
            <div className="row small"><MapPin size={14} /> <span className="mono">{snapshot.sheetName}!{v.letter}{row.rowNumber}</span></div>
            <div className="small muted">{snapshot.sourceFileName} · SHA-256 {snapshot.sourceSha256.slice(0, 10)}…</div>
            {v.attribution && (
              <div className="flag-item" style={{ marginTop: 8 }}>
                <div><strong>Column source:</strong> {v.attribution.source ?? v.attribution.mode.replace(/_/g, ' ')}</div>
                <div className="muted">{v.attribution.note}</div>
                <span className="badge" style={{ marginTop: 4 }}>{INTERP_TEXT[v.attribution.status]}</span>
              </div>
            )}
            <h4>Formatting & QC ({o.flags.length})</h4>
            {o.flags.length === 0 && <div className="small muted">No QC flags or formatting interpretations. This is not a QC pass: QC information may simply be absent.</div>}
            {o.flags.map((f, i) => (
              <div key={i} className="flag-item">
                <div className="row wrap">
                  <strong>{f.category ? qcLabel(f.category) : f.kind === 'cell_source' ? 'Cell source' : 'Unresolved font colour'}</strong>
                  <span className={`badge ${f.status === 'needs_review' ? 'warn' : f.status === 'unresolved' ? 'violet' : f.status === 'curator_confirmed' ? 'ok' : ''}`}>{INTERP_TEXT[f.status]}</span>
                </div>
                <div className="muted" style={{ marginTop: 3 }}>{f.detail}</div>
              </div>
            ))}
            {editable && (
              <>
                <h4>Curator decision</h4>
                {excluded ? (
                  <button className="btn sm" onClick={() => setExcluded(false)}><Undo2 size={13} /> Re-include observation</button>
                ) : (
                  <div className="stack" style={{ gap: 6 }}>
                    <input className="input" placeholder="Reason for excluding (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
                    <button className="btn sm danger" disabled={!reason.trim() || o.value.k === 'missing'} onClick={() => setExcluded(true)}><Ban size={13} /> Exclude this observation</button>
                    <span className="small muted">Recorded in the audit history; the source value is never changed.</span>
                  </div>
                )}
              </>
            )}
          </>
        )}
        <h4>Comments ({comments.length})</h4>
        {comments.length === 0 && <div className="small muted">No source comments on this cell or column header.</div>}
        {comments.map((c) => (
          <div key={c.id} className="flag-item">
            <div className="row small muted"><MessageSquare size={13} /> <span className="mono">{c.address}</span> {c.row === null && '· column header'}</div>
            <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{c.text}</div>
            {c.author && <div className="small muted" style={{ marginTop: 4 }}>— {c.author}</div>}
          </div>
        ))}
        <p className="small muted" style={{ marginTop: 10 }}>Comments are shown as recorded in the workbook; they are data, not instructions.</p>
      </div>
    </aside>
  )
}
