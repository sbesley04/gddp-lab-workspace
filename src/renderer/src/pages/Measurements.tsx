import { useEffect, useMemo, useState } from 'react'
import { Search, History, Save, ShieldAlert, BarChart3, Lock } from 'lucide-react'
import type { MetaFieldName, MetaStatus, VariableInfo } from '@core/types'
import { call } from '../api'
import { useStore, errorText } from '../store'
import { label, areaOf, STATUS_TEXT, INTERP_TEXT, shortDate } from '../lib/format'
import { searchVariables } from '../components/Pickers'

const FIELDS: { f: MetaFieldName; l: string; hint: string }[] = [
  { f: 'displayLabel', l: 'Display label', hint: 'Shown in charts and tables. The original header is always kept.' },
  { f: 'definition', l: 'Definition', hint: 'What exactly was measured, and how.' },
  { f: 'unit', l: 'Unit', hint: 'Leave unknown rather than guessing.' },
  { f: 'specimen', l: 'Specimen', hint: 'E.g. CSF, plasma, PBMC. Do not infer from a biomarker name.' },
  { f: 'assay', l: 'Assay / method', hint: 'Platform, panel, instrument or test version.' },
  { f: 'scoreType', l: 'Score type', hint: 'Raw, scaled, clinic, T-score… Variants stay separate variables.' },
  { f: 'area', l: 'Research area', hint: 'Grouping used in pickers and exports.' },
  { f: 'source', l: 'Source', hint: 'Originating dataset or collaborator.' }
]

type Filt = 'all' | 'no_unit' | 'tentative_unit' | 'no_def' | 'qi'

export function Measurements() {
  const snapshot = useStore((s) => s.snapshot)!
  const [q, setQ] = useState('')
  const [filt, setFilt] = useState<Filt>('all')
  const [area, setArea] = useState<string>(() => sessionStorage.getItem('bari.focusArea') ?? 'all')
  const [selected, setSelected] = useState<string | null>(() => sessionStorage.getItem('bari.focusVar'))
  useEffect(() => {
    sessionStorage.removeItem('bari.focusVar')
    sessionStorage.removeItem('bari.focusArea')
  }, [])
  const measures = useMemo(() => snapshot.variables.filter((v) => v.role === 'measure'), [snapshot])
  const areas = useMemo(() => [...new Set(measures.map(areaOf))], [measures])
  const list = useMemo(() => {
    let vs = searchVariables(measures, q)
    if (area !== 'all') vs = vs.filter((v) => areaOf(v) === area)
    if (filt === 'no_unit') vs = vs.filter((v) => v.meta.unit.status === 'unknown')
    if (filt === 'tentative_unit') vs = vs.filter((v) => v.meta.unit.status === 'tentative')
    if (filt === 'no_def') vs = vs.filter((v) => v.meta.definition.status === 'unknown')
    if (filt === 'qi') vs = vs.filter((v) => v.quasiIdentifier)
    return vs
  }, [measures, q, area, filt])
  const current = snapshot.variables.find((v) => v.key === selected) ?? list[0] ?? null
  const hidden = snapshot.variables.filter((v) => v.role !== 'measure')

  return (
    <>
      <header className="topbar drag">
        <div>
          <h2>Measurements</h2>
          <div className="subtitle">{measures.length} measures · {hidden.length} identifier/blank columns kept out of pickers</div>
        </div>
      </header>
      <div className="content">
        <div className="grid" style={{ gridTemplateColumns: '360px minmax(0, 1fr)', alignItems: 'start' }}>
          <div className="paper card" style={{ position: 'sticky', top: 0 }}>
            <div className="row" style={{ marginBottom: 8 }}>
              <Search size={15} className="muted" />
              <input className="input" style={{ flex: 1 }} placeholder="Search headers, aliases, units…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search measures" />
            </div>
            <div className="row wrap" style={{ marginBottom: 8 }}>
              <select className="input" style={{ height: 30, flex: 1 }} value={area} onChange={(e) => setArea(e.target.value)} aria-label="Area">
                <option value="all">All areas</option>
                {areas.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <select className="input" style={{ height: 30, flex: 1 }} value={filt} onChange={(e) => setFilt(e.target.value as Filt)} aria-label="Metadata filter">
                <option value="all">All metadata</option>
                <option value="no_unit">Unit unknown</option>
                <option value="tentative_unit">Unit tentative</option>
                <option value="no_def">No definition</option>
                <option value="qi">Quasi-identifiers</option>
              </select>
            </div>
            <div className="list" style={{ maxHeight: 'calc(100vh - 290px)', overflow: 'auto' }}>
              {list.map((v) => (
                <button key={v.key} className="list-item" aria-selected={current?.key === v.key} onClick={() => setSelected(v.key)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="t">{label(v)}</div>
                    <div className="s">{v.letter} · {areaOf(v)} · {v.meta.unit.value ?? 'unit unknown'}</div>
                  </div>
                  {v.quasiIdentifier && <span className="badge warn" title="Quasi-identifier">QI</span>}
                  {v.meta.definition.status === 'unknown' && <span className="dot" style={{ color: 'var(--text-3)' }} title="No definition" />}
                </button>
              ))}
              {list.length === 0 && <div className="muted small" style={{ padding: 10 }}>No measures match.</div>}
            </div>
            <div className="small muted" style={{ marginTop: 8 }}>{list.length} shown</div>
          </div>
          {current ? <VariableEditor key={current.key + snapshot.metadataVersion} v={current} /> : <div className="paper empty">Select a measure.</div>}
        </div>
      </div>
    </>
  )
}

interface Hist {
  id: number
  kind: string
  field: string | null
  value: unknown
  status: string | null
  author: string | null
  reason: string | null
  at: string
}

function VariableEditor({ v }: { v: VariableInfo }) {
  const snapshot = useStore((s) => s.snapshot)!
  const asOf = useStore((s) => s.asOf)
  const toast = useStore((s) => s.toast)
  const [hist, setHist] = useState<Hist[]>([])
  const editable = asOf === null
  const load = () => call<Hist[]>('curation:history', { datasetVersionId: snapshot.datasetVersionId, target: v.key }).then(setHist).catch(() => setHist([]))
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.key, snapshot.metadataVersion])
  const comments = snapshot.annotations.filter((a) => a.variable === v.index && a.row === null)
  const toggleQi = async () => {
    try {
      await call('curation:setQuasi', { datasetVersionId: snapshot.datasetVersionId, varKey: v.key, value: !v.quasiIdentifier, reason: null })
      await useStore.getState().reloadSnapshot()
    } catch (e) {
      toast('error', errorText(e))
    }
  }
  return (
    <div className="stack">
      <div className="paper card">
        <div className="card-head">
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0 }}>{label(v)}</h3>
            <div className="small muted">Original header: <span style={{ color: 'var(--text)' }}>{v.header}</span> · column {v.letter} · {v.kind}</div>
          </div>
          <span className="spacer" />
          <button className="btn sm" onClick={() => { const st = useStore.getState(); st.setChart({ measureKey: v.key, type: 'distribution' }); st.setPage('explore') }} disabled={v.kind === 'categorical' || v.kind === 'empty'}>
            <BarChart3 size={14} /> Explore
          </button>
        </div>
        {v.headerRuns && v.headerRuns.length > 1 && (
          <div className="small" style={{ marginBottom: 8 }}>
            Header as formatted:{' '}
            {v.headerRuns.map((r, i) => (
              <span key={i} style={{ color: r.color ? `#${r.color}` : undefined, fontWeight: r.bold ? 700 : undefined, fontStyle: r.italic ? 'italic' : undefined }}>{r.text}</span>
            ))}
          </div>
        )}
        <div className="row wrap small">
          <span className="badge">{v.counts.number} numeric</span>
          <span className="badge">{v.counts.missing} missing</span>
          {v.counts.censored > 0 && <span className="badge warn">{v.counts.censored} censored</span>}
          {v.counts.text > 0 && <span className="badge warn">{v.counts.text} text{v.categories.length ? `: ${v.categories.slice(0, 6).join(', ')}` : ''}</span>}
          {v.attribution && <span className="badge outline" title={v.attribution.note}>Source: {v.attribution.source ?? v.attribution.mode.replace(/_/g, ' ')} · {INTERP_TEXT[v.attribution.status]}</span>}
        </div>
        {v.aliases.length > 0 && (
          <div className="small" style={{ marginTop: 8 }}>
            <span className="muted">Aliases from header: </span>
            {v.aliases.map((a, i) => <span key={i} className="badge outline" style={{ marginRight: 4 }} title={a.provenance}>{a.text}{a.source ? ` · ${a.source}` : ''}</span>)}
          </div>
        )}
        {comments.map((c) => (
          <div key={c.id} className="flag-item" style={{ marginTop: 8 }}><span className="small muted mono">{c.address}</span> {c.text}</div>
        ))}
      </div>
      {!editable && (
        <div className="callout info"><Lock size={16} /><p>You are viewing metadata as saved in a view. Return to current metadata to edit.</p></div>
      )}
      <div className="paper card">
        <div className="card-head"><h3>Metadata</h3><span className="muted small">Every save is an append-only revision; raw data never changes.</span></div>
        <div className="stack" style={{ gap: 10 }}>
          {FIELDS.map((f) => <FieldEditor key={f.f} v={v} field={f.f} labelText={f.l} hint={f.hint} disabled={!editable} onSaved={load} />)}
        </div>
        <hr className="div" />
        <label className="check">
          <input type="checkbox" checked={v.quasiIdentifier} onChange={toggleQi} disabled={!editable} />
          <span><ShieldAlert size={14} style={{ verticalAlign: -2 }} /> Quasi-identifier — requires explicit confirmation before it can be exported (e.g. age, sex, race, dates, BMI).</span>
        </label>
      </div>
      <div className="paper card">
        <div className="card-head"><h3><History size={16} /> History</h3><span className="muted small">{hist.length} revision(s)</span></div>
        <div className="table-wrap" style={{ maxHeight: 260 }}>
          <table className="data">
            <thead><tr><th>#</th><th>When</th><th>Field</th><th>Value</th><th>Status</th><th>By</th><th>Reason / provenance</th></tr></thead>
            <tbody>
              {hist.map((h) => (
                <tr key={h.id}>
                  <td className="num muted">{h.id}</td>
                  <td>{shortDate(h.at)}</td>
                  <td>{h.field ?? h.kind}</td>
                  <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.value === null ? <span className="muted">—</span> : String(h.value)}</td>
                  <td>{h.status}</td>
                  <td>{h.author ?? <span className="muted">—</span>}</td>
                  <td style={{ whiteSpace: 'normal', minWidth: 200 }}>{h.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function FieldEditor({ v, field, labelText, hint, disabled, onSaved }: { v: VariableInfo; field: MetaFieldName; labelText: string; hint: string; disabled: boolean; onSaved: () => void }) {
  const snapshot = useStore((s) => s.snapshot)!
  const toast = useStore((s) => s.toast)
  const f = v.meta[field]
  const [value, setValue] = useState(f.value ?? '')
  const [status, setStatus] = useState<MetaStatus>(f.status === 'unknown' ? 'tentative' : f.status)
  const [reason, setReason] = useState('')
  const dirty = value !== (f.value ?? '') || (value && status !== f.status) || reason
  const save = async () => {
    try {
      await call('curation:editMeta', { datasetVersionId: snapshot.datasetVersionId, varKey: v.key, field, value: value || null, status, reason: reason || null })
      setReason('')
      await useStore.getState().reloadSnapshot()
      onSaved()
      toast('success', `${labelText} saved as a new revision.`)
    } catch (e) {
      toast('error', errorText(e))
    }
  }
  return (
    <div className="grid" style={{ gridTemplateColumns: '140px minmax(0, 1fr) 130px', gap: 10, alignItems: 'start' }}>
      <div style={{ paddingTop: 7 }}>
        <div style={{ fontWeight: 620 }}>{labelText}</div>
        <span className={`badge ${f.status === 'confirmed' ? 'ok' : f.status === 'tentative' ? 'warn' : ''}`} title={f.provenance}>{STATUS_TEXT[f.status]}</span>
      </div>
      <div className="stack" style={{ gap: 4 }}>
        {field === 'definition' ? (
          <textarea className="input" rows={2} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Unknown" disabled={disabled} aria-label={labelText} />
        ) : (
          <input className="input" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Unknown" disabled={disabled} aria-label={labelText} />
        )}
        <span className="small muted" title={f.provenance}>{hint} {f.provenance && <>· <em>{f.provenance}</em></>}</span>
        {dirty && <input className="input" style={{ height: 30 }} placeholder="Reason or source for this change (recommended)" value={reason} onChange={(e) => setReason(e.target.value)} />}
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <select className="input" value={value ? status : 'unknown'} onChange={(e) => setStatus(e.target.value as MetaStatus)} disabled={disabled || !value} aria-label={`${labelText} status`}>
          {!value && <option value="unknown">Unknown</option>}
          <option value="tentative">Tentative</option>
          <option value="confirmed">Confirmed</option>
        </select>
        <button className="btn sm primary" onClick={save} disabled={disabled || !dirty}><Save size={13} /> Save</button>
      </div>
    </div>
  )
}
