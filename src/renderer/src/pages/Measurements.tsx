import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

type Filt = 'all' | 'no_unit' | 'tentative_unit' | 'no_def' | 'qi' | 'cov'

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
    if (filt === 'cov') vs = vs.filter((v) => v.covariate)
    return vs
  }, [measures, q, area, filt])
  const current = snapshot.variables.find((v) => v.key === selected) ?? list[0] ?? null
  const dirtyRef = useRef(0)
  const setDirty = useCallback((n: number) => {
    dirtyRef.current = n
  }, [])
  const choose = (key: string) => {
    if (key === current?.key) return
    if (dirtyRef.current > 0 && !confirm(`Discard ${dirtyRef.current} unsaved change(s) to “${current ? label(current) : ''}”?`)) return
    dirtyRef.current = 0
    setSelected(key)
  }
  const hidden = snapshot.variables.filter((v) => v.role !== 'measure')

  return (
    <>
      <header className="topbar drag">
        <div>
          <h2>Measurements</h2>
          <div className="subtitle">{measures.length} measures · {hidden.length} identifier/blank columns kept out of pickers</div>
        </div>
      </header>
      <div className="content page-fade">
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
                <option value="cov">Covariates</option>
              </select>
            </div>
            <div
              className="list"
              style={{ maxHeight: 'calc(100vh - 290px)', overflow: 'auto' }}
              role="listbox"
              aria-label="Measures"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
                e.preventDefault()
                const i = list.findIndex((v) => v.key === current?.key)
                const next = list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
                if (next) choose(next.key)
              }}
            >
              {list.map((v) => (
                <button key={v.key} role="option" className="list-item" aria-selected={current?.key === v.key} onClick={() => choose(v.key)} tabIndex={-1}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="t">{label(v)}</div>
                    <div className="s">{v.letter} · {areaOf(v)}{v.meta.unit.value ? ` · ${v.meta.unit.value}` : ''}</div>
                  </div>
                  {v.covariate && <span className="badge outline" title="Covariate">Cov</span>}
                  {v.quasiIdentifier && <span className="badge warn" title="Quasi-identifier: needs confirmation before export">QI</span>}
                  <MetaPips v={v} />
                </button>
              ))}
              {list.length === 0 && <div className="muted small" style={{ padding: 10 }}>No measures match.</div>}
            </div>
            <div className="small muted" style={{ marginTop: 8 }}>{list.length} shown</div>
          </div>
          {current ? <VariableEditor key={current.key + snapshot.metadataVersion} v={current} onDirty={setDirty} /> : <div className="paper empty">Select a measure.</div>}
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

function VariableEditor({ v, onDirty }: { v: VariableInfo; onDirty: (n: number) => void }) {
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
  const toggleCov = async () => {
    try {
      await call('curation:setCovariate', { datasetVersionId: snapshot.datasetVersionId, varKey: v.key, value: !v.covariate, reason: null })
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
        <MetadataForm v={v} disabled={!editable} onSaved={load} onDirty={onDirty} />
        <hr className="div" />
        <label className="check">
          <input type="checkbox" checked={v.quasiIdentifier} onChange={toggleQi} disabled={!editable} />
          <span><ShieldAlert size={14} style={{ verticalAlign: -2 }} /> Quasi-identifier — requires explicit confirmation before it can be exported (e.g. age, sex, race, dates, BMI).</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={v.covariate} onChange={toggleCov} disabled={!editable} data-testid="covariate-toggle" />
          <span>Covariate — offered first when colouring charts (e.g. sex, site, treatment group). Does not change any data or export rule.</span>
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

const STATUS_ORDER: MetaStatus[] = ['unknown', 'tentative', 'confirmed']

/** Small completeness markers for unit and definition. */
function MetaPips({ v }: { v: VariableInfo }) {
  const pip = (name: string, f: VariableInfo['meta']['unit']) => (
    <span className={`pip ${f.status}`} title={`${name}: ${f.value ?? 'unknown'} (${STATUS_TEXT[f.status].toLowerCase()})`}>{name[0]}</span>
  )
  return (
    <span className="row" style={{ gap: 3 }} aria-label="Metadata completeness">
      {pip('Unit', v.meta.unit)}
      {pip('Definition', v.meta.definition)}
    </span>
  )
}

type Draft = Record<MetaFieldName, { value: string; status: MetaStatus }>

/** One form for all metadata fields: edit several, then save them together with one reason. */
function MetadataForm({ v, disabled, onSaved, onDirty }: { v: VariableInfo; disabled: boolean; onSaved: () => void; onDirty: (n: number) => void }) {
  const snapshot = useStore((s) => s.snapshot)!
  const toast = useStore((s) => s.toast)
  const initial = useMemo(() => Object.fromEntries(FIELDS.map(({ f }) => [f, { value: v.meta[f].value ?? '', status: v.meta[f].status }])) as Draft, [v])
  const [draft, setDraft] = useState<Draft>(initial)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const changed = FIELDS.filter(({ f }) => {
    const a = draft[f]
    const b = initial[f]
    return a.value.trim() !== b.value.trim() || (a.value.trim() !== '' && a.status !== b.status)
  })
  useEffect(() => onDirty(changed.length), [changed.length, onDirty])
  const set = (f: MetaFieldName, patch: Partial<Draft[MetaFieldName]>) =>
    setDraft((d) => {
      const next = { ...d[f], ...patch }
      // A filled-in value cannot be "unknown"; an empty value always is.
      if (!next.value.trim()) next.status = 'unknown'
      else if (next.status === 'unknown') next.status = 'tentative'
      return { ...d, [f]: next }
    })
  const save = async () => {
    setSaving(true)
    try {
      for (const { f } of changed)
        await call('curation:editMeta', { datasetVersionId: snapshot.datasetVersionId, varKey: v.key, field: f, value: draft[f].value.trim() || null, status: draft[f].status, reason: reason.trim() || null })
      toast('success', `Saved ${changed.length} field(s) as new revisions.`)
      onDirty(0)
      await useStore.getState().reloadSnapshot()
      onSaved()
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="stack" style={{ gap: 0 }}>
      {FIELDS.map(({ f, l, hint }) => {
        const d = draft[f]
        const dirty = changed.some((c) => c.f === f)
        return (
          <div key={f} className={`meta-row ${dirty ? 'dirty' : ''}`}>
            <div className="meta-label">
              <label htmlFor={`meta-${f}`}>{l}</label>
              {dirty && <span className="badge accent" style={{ fontSize: 10.5 }}>edited</span>}
            </div>
            <div className="stack" style={{ gap: 4, minWidth: 0 }}>
              {f === 'definition' ? (
                <textarea id={`meta-${f}`} className="input" rows={2} value={d.value} onChange={(e) => set(f, { value: e.target.value })} placeholder="Unknown" disabled={disabled} />
              ) : (
                <input id={`meta-${f}`} className="input" value={d.value} onChange={(e) => set(f, { value: e.target.value })} placeholder="Unknown" disabled={disabled} />
              )}
              <span className="small muted">
                {hint} <em title="Provenance of the current value">· {v.meta[f].provenance}</em>
              </span>
            </div>
            <div className="seg status-seg" role="group" aria-label={`${l} status`}>
              {STATUS_ORDER.map((st) => (
                <button key={st} aria-pressed={d.status === st} disabled={disabled || (st === 'unknown') !== !d.value.trim()} onClick={() => set(f, { status: st })} className={`st-${st}`}>
                  {STATUS_TEXT[st]}
                </button>
              ))}
            </div>
          </div>
        )
      })}
      {changed.length > 0 && (
        <div className="save-bar glass" role="region" aria-label="Unsaved metadata changes">
          <span className="badge accent">{changed.length} unsaved</span>
          <input className="input" style={{ flex: 1, height: 32 }} placeholder="Reason or source for these changes (recommended)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason for changes" />
          <button className="btn ghost sm" onClick={() => { setDraft(initial); setReason('') }} disabled={saving}>Discard</button>
          <button className="btn primary sm" onClick={save} disabled={saving} data-testid="save-metadata"><Save size={13} /> Save changes</button>
        </div>
      )}
    </div>
  )
}
