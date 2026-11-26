import { useEffect, useMemo, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check, MessageSquare, RotateCcw, ThumbsDown, Lock } from 'lucide-react'
import type { Segment } from '@importer/model'
import { call } from '../api'
import { useStore, errorText } from '../store'
import { ReportView } from '../components/ImportWizard'
import { INTERP_TEXT, label, shortDate } from '../lib/format'
import { columnLetter } from '@core/hash'
import type { VersionDiff } from '@core/versionDiff'

interface FormatGroup {
  groupKey: string
  formatKey: string
  kind: string
  status: string
  count: number
  columns: string[]
  sampleAddresses: string[]
  detail: string
  swatch: string | null
  decision: { decision: string; asKind?: string; author: string | null; reason: string | null; at: string } | null
}

type Tab = 'interpretations' | 'checks' | 'map' | 'groups' | 'comments' | 'versions'

const KIND_LABEL: Record<string, string> = {
  qc_sample: 'Sample QC warning',
  qc_target: 'Target QC warning',
  qc_both: 'Sample + target warnings',
  unresolved_highlight: 'Unresolved highlight',
  unresolved_font: 'Unresolved font colour',
  curator_exclusion: 'Curator exclusion',
  cell_source: 'Cell source colour differs from column'
}

export function DataQuality() {
  const snapshot = useStore((s) => s.snapshot)!
  const versions = useStore((s) => s.project?.versions.length ?? 0)
  const [tab, setTab] = useState<Tab>('interpretations')
  return (
    <>
      <header className="topbar drag">
        <div>
          <h2>Data quality</h2>
          <div className="subtitle">Source formatting, QC flags and import checks — with provenance and review status</div>
        </div>
      </header>
      <div className="content page-fade">
        <div className="seg" role="tablist" style={{ marginBottom: 14 }}>
          {([
            ['interpretations', 'Formatting & QC'],
            ['map', 'Flag map'],
            ['checks', 'Import checks'],
            ['groups', 'Column groups'],
            ['comments', `Comments (${snapshot.annotations.length})`],
            ...(versions > 1 ? [['versions', 'Version changes'] as [Tab, string]] : [])
          ] as [Tab, string][]).map(([k, l]) => (
            <button key={k} role="tab" aria-pressed={tab === k} aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
        {tab === 'interpretations' && <Interpretations />}
        {tab === 'checks' && <Checks />}
        {tab === 'map' && <FlagMap />}
        {tab === 'groups' && <Groups />}
        {tab === 'comments' && <Comments />}
        {tab === 'versions' && <VersionChanges />}
      </div>
    </>
  )
}

const CHANGE_TEXT: Record<string, string> = { value: 'Changed', filled: 'Was empty', emptied: 'Now empty' }

/** What differs between the dataset version on screen and another import of the study workbook. Nothing is merged. */
function VersionChanges() {
  const snapshot = useStore((s) => s.snapshot)!
  const project = useStore((s) => s.project)!
  const openParticipant = useStore((s) => s.openParticipant)
  const others = project.versions.filter((v) => v.id !== snapshot.datasetVersionId)
  const [otherId, setOtherId] = useState(others[0]?.id ?? '')
  const [diff, setDiff] = useState<VersionDiff | null>(null)
  const [error, setError] = useState<string | null>(null)
  const other = others.find((v) => v.id === otherId)
  // Always read as "older to newer", whichever of the two is on screen.
  const older = other && other.versionNumber < snapshot.versionNumber
  useEffect(() => {
    if (!other) return
    setDiff(null)
    setError(null)
    const payload = older ? { fromVersionId: other.id, toVersionId: snapshot.datasetVersionId } : { fromVersionId: snapshot.datasetVersionId, toVersionId: other.id }
    call<VersionDiff>('data:compareVersions', payload).then(setDiff).catch((e) => setError(errorText(e)))
  }, [other?.id, snapshot.datasetVersionId, snapshot.metadataVersion, older])
  if (!other) return <div className="paper empty">Import a second version of the workbook to compare versions.</div>
  const names = (xs: string[]) => (xs.length ? `${xs.slice(0, 12).join(', ')}${xs.length > 12 ? ` and ${xs.length - 12} more` : ''}` : 'none')
  return (
    <div className="stack" data-testid="version-changes">
      <div className="paper card">
        <div className="card-head">
          <h3>Version changes</h3>
          <span className="spacer" />
          <label className="row small" style={{ gap: 6 }}>Compare v{snapshot.versionNumber} with
            <select className="btn sm" value={otherId} onChange={(e) => setOtherId(e.target.value)} aria-label="Version to compare with">
              {others.map((v) => <option key={v.id} value={v.id}>v{v.versionNumber} · {shortDate(v.createdAt)}</option>)}
            </select>
          </label>
        </div>
        <p className="small muted" style={{ margin: 0 }}>Each import is its own unchangeable version. This lists what differs between two of them; nothing is merged or carried from one to the other. Rows are matched by participant and visit, columns by header, so a renamed column appears as one removed and one added.</p>
      </div>
      {error && <div className="paper card"><div className="callout danger"><p className="small">{error}</p></div></div>}
      {!diff && !error && <div className="paper empty">Comparing…</div>}
      {diff && (
        <>
          <div className="paper card">
            <div className="card-head"><h3>v{diff.from.versionNumber} → v{diff.to.versionNumber}</h3>{diff.identical && <span className="badge outline" data-testid="versions-identical">No differences in the data</span>}</div>
            <div className="kv">
              <div className="k">Rows</div><div>{diff.from.rows} → {diff.to.rows} · {diff.rows.added.length} added · {diff.rows.removed.length} removed · {diff.rows.common} in both</div>
              <div className="k">Participants</div><div>{diff.from.participants} → {diff.to.participants} · added: {names(diff.participants.added)} · removed: {names(diff.participants.removed)}</div>
              <div className="k">Measures</div><div>{diff.from.variables} → {diff.to.variables} · added: {names(diff.variables.added.map((v) => v.header))} · removed: {names(diff.variables.removed.map((v) => v.header))}</div>
              <div className="k">Values in both</div><div data-testid="version-totals">{diff.totals.value} changed · {diff.totals.filled} filled in (were empty) · {diff.totals.emptied} now empty</div>
              <div className="k">QC flags in both</div><div>{diff.flags.added} gained · {diff.flags.removed} lost</div>
            </div>
          </div>
          {diff.changedVariables.length > 0 && (
            <div className="paper card">
              <div className="card-head"><h3>Measures with changes</h3><span className="muted small">{diff.changedVariables.length} of {diff.variables.common} measures in both versions</span></div>
              <div className="table-wrap" style={{ maxHeight: 320 }}>
                <table className="data">
                  <thead><tr><th>Measure</th><th>Changed</th><th>Filled in</th><th>Now empty</th><th>Type</th></tr></thead>
                  <tbody>
                    {diff.changedVariables.map((v) => (
                      <tr key={v.key}><td>{v.header}</td><td className="num">{v.value}</td><td className="num">{v.filled}</td><td className="num">{v.emptied}</td><td>{v.kindBefore ? `${v.kindBefore} → ${v.kindAfter}` : ''}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {diff.cells.length > 0 && (
            <div className="paper card">
              <div className="card-head"><h3>Changed values</h3><span className="muted small">{diff.cellsTruncated ? `first ${diff.cells.length} of ${diff.cells.length + diff.cellsTruncated}` : `${diff.cells.length}`} · shown on this computer only, never exported</span></div>
              <div className="table-wrap" style={{ maxHeight: 420 }}>
                <table className="data" data-testid="version-cells">
                  <thead><tr><th>Participant</th><th>Visit</th><th>Measure</th><th>What</th><th>v{diff.from.versionNumber}</th><th>v{diff.to.versionNumber}</th></tr></thead>
                  <tbody>
                    {diff.cells.map((c, i) => (
                      <tr key={i}>
                        <td><button className="btn ghost sm" onClick={() => openParticipant(c.participantId)}>{c.participantId}</button></td>
                        <td>{c.visit}</td><td>{c.header}</td><td>{CHANGE_TEXT[c.kind]}</td>
                        <td className="num">{c.before === '' ? <span className="muted">empty</span> : c.before}</td>
                        <td className="num">{c.after === '' ? <span className="muted">empty</span> : c.after}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Interpretations() {
  const snapshot = useStore((s) => s.snapshot)!
  const asOf = useStore((s) => s.asOf)
  const [groups, setGroups] = useState<FormatGroup[] | null>(null)
  useEffect(() => {
    call<FormatGroup[]>('data:formatGroups', { datasetVersionId: snapshot.datasetVersionId, asOf }).then(setGroups).catch(() => setGroups([]))
  }, [snapshot, asOf])
  if (!groups) return <div className="paper empty">Loading…</div>
  if (groups.length === 0) return <div className="paper empty"><h3>No formatting interpretations</h3><p>{snapshot.sourceKind === 'csv' ? 'CSV imports carry no formatting.' : 'No QC highlights or undocumented formatting were found. This is not a QC pass.'}</p></div>
  return (
    <div className="stack">
      <div className="callout neutral">
        <p className="small">
          Each row groups cells sharing one formatting colour and interpretation. <strong>Matches legend</strong> rows follow the workbook legend exactly. <strong>Needs review</strong> rows only resemble a legend colour. <strong>Unresolved</strong> colours are undocumented and are never excluded automatically. Decisions are recorded as revisions with your reason.
        </p>
      </div>
      <div className="paper card" style={{ padding: 0 }}>
        <div className="table-wrap" style={{ border: 0 }}>
          <table className="data">
            <thead><tr><th>Colour</th><th>Interpretation</th><th>Status</th><th>Cells</th><th>Columns</th><th>Examples</th><th>Detail</th><th>Decision</th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.groupKey}>
                  <td>{g.swatch ? <span className="swatch" style={{ background: `#${g.swatch}`, width: 22, height: 22 }} title={`#${g.swatch}`} /> : <span className="muted small">{g.formatKey.replace(/^(fill|font):/, '')}</span>}</td>
                  <td><strong>{KIND_LABEL[g.kind] ?? g.kind}</strong><div className="small muted mono">{g.formatKey}</div></td>
                  <td><span className={`badge ${g.status === 'needs_review' ? 'warn' : g.status === 'unresolved' ? 'violet' : 'ok'}`}>{INTERP_TEXT[g.status as keyof typeof INTERP_TEXT] ?? g.status}</span></td>
                  <td className="num">{g.count}</td>
                  <td className="small">{summarizeCols(g.columns)}</td>
                  <td className="small mono">{g.sampleAddresses.slice(0, 4).join(' ')}</td>
                  <td style={{ whiteSpace: 'normal', minWidth: 260, maxWidth: 420 }} className="small">{g.detail}</td>
                  <td style={{ minWidth: 190 }}>
                    {g.decision ? (
                      <div className="small">
                        <span className={`badge ${g.decision.decision === 'confirm' ? 'ok' : 'danger'}`}>{g.decision.decision === 'confirm' ? `Confirmed as ${KIND_LABEL[g.decision.asKind ?? g.kind] ?? g.decision.asKind}` : 'Rejected'}</span>
                        <div className="muted">{g.decision.author ?? 'unlabelled'} · {shortDate(g.decision.at)}</div>
                        <div className="muted" style={{ whiteSpace: 'normal' }}>{g.decision.reason}</div>
                        {asOf === null && <DecisionButton g={g} mode="reset" />}
                      </div>
                    ) : asOf === null ? (
                      g.kind === 'unresolved_font' ? <span className="muted small">Shown in inspector only</span> : (
                        <div className="row">
                          <DecisionButton g={g} mode="confirm" />
                          <DecisionButton g={g} mode="reject" />
                        </div>
                      )
                    ) : (
                      <span className="muted small"><Lock size={12} /> viewing as saved</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function summarizeCols(cols: string[]) {
  if (cols.length <= 4) return cols.join(', ')
  return `${cols.length} columns (${cols[0]} … ${cols[cols.length - 1]})`
}

function DecisionButton({ g, mode }: { g: FormatGroup; mode: 'confirm' | 'reject' | 'reset' }) {
  const snapshot = useStore((s) => s.snapshot)!
  const toast = useStore((s) => s.toast)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [asKind, setAsKind] = useState<'qc_sample' | 'qc_target' | 'qc_both'>(g.kind.startsWith('qc_') ? (g.kind as any) : 'qc_sample')
  const submit = async () => {
    try {
      const qcLike = g.kind.startsWith('qc_') || g.kind === 'unresolved_highlight'
      await call('curation:decideFormat', { datasetVersionId: snapshot.datasetVersionId, groupKey: g.groupKey, decision: mode, asKind: mode === 'confirm' && qcLike ? asKind : undefined, reason: reason || null })
      setOpen(false)
      await useStore.getState().reloadSnapshot()
      toast('success', mode === 'reset' ? 'Decision withdrawn (recorded).' : 'Decision recorded.')
    } catch (e) {
      toast('error', errorText(e))
    }
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button className={`btn sm ${mode === 'reject' ? 'danger' : ''}`}>
          {mode === 'confirm' ? <><Check size={13} /> Confirm</> : mode === 'reject' ? <><ThumbsDown size={13} /> Reject</> : <><RotateCcw size={13} /> Withdraw</>}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover" sideOffset={6} align="end" style={{ width: 340 }}>
          <div className="stack" style={{ gap: 10 }}>
            <strong>{mode === 'confirm' ? 'Confirm interpretation' : mode === 'reject' ? 'Reject interpretation' : 'Withdraw decision'}</strong>
            {mode === 'confirm' && g.kind === 'cell_source' && <p className="small muted" style={{ margin: 0 }}>Confirms that these cells came from the source named in the detail, not the column's main source.</p>}
            {mode === 'confirm' && g.kind !== 'cell_source' && (
              <label className="field">
                Confirm these {g.count} cells as
                <select className="input" value={asKind} onChange={(e) => setAsKind(e.target.value as any)}>
                  <option value="qc_sample">Sample QC warning</option>
                  <option value="qc_target">Target QC warning</option>
                  <option value="qc_both">Sample + target warnings</option>
                </select>
              </label>
            )}
            {mode === 'reject' && <p className="small muted" style={{ margin: 0 }}>The cells keep their raw formatting but are no longer treated as a QC flag.</p>}
            {mode !== 'reset' && <textarea className="input" rows={3} placeholder="Reason / evidence (required), e.g. checked against QC report" value={reason} onChange={(e) => setReason(e.target.value)} />}
            <button className="btn primary sm" onClick={submit} disabled={mode !== 'reset' && !reason.trim()}>Record decision</button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function Checks() {
  const snapshot = useStore((s) => s.snapshot)!
  const [r, setR] = useState<any>(null)
  useEffect(() => {
    call('data:importReport', { datasetVersionId: snapshot.datasetVersionId }).then(setR).catch(() => setR(null))
  }, [snapshot.datasetVersionId])
  if (!r) return <div className="paper empty">Loading…</div>
  return (
    <div className="paper card">
      <ReportView report={{ ...r.report, legend: r.legend, segments: r.segments }} />
    </div>
  )
}

function FlagMap() {
  const snapshot = useStore((s) => s.snapshot)!
  const openParticipant = useStore((s) => s.openParticipant)
  const { vars, cellClass } = useMemo(() => {
    const flagged = new Set(snapshot.flags.filter((f) => f.category).map((f) => f.variable))
    const vars = snapshot.variables.filter((v) => flagged.has(v.index))
    const m = new Map<string, string>()
    for (const f of snapshot.flags) {
      if (!f.category) continue
      const k = `${f.row}:${f.variable}`
      const cls = f.category === 'sample_warning' ? 'f-sample' : f.category === 'possible_sample_warning' || f.category === 'possible_target_warning' ? 'f-possible' : f.category === 'target_warning' ? 'f-target' : f.category === 'both_warnings' ? 'f-both' : f.category === 'unresolved_highlight' ? 'f-unresolved' : 'f-target'
      m.set(k, cls)
    }
    return { vars, cellClass: m }
  }, [snapshot])
  if (vars.length === 0) return <div className="paper empty"><h3>No flags to map</h3></div>
  const size = Math.max(4, Math.min(12, Math.floor(1100 / vars.length)))
  return (
    <div className="paper card">
      <div className="card-head">
        <h3>Where flags fall</h3>
        <span className="muted small">{snapshot.rows.length} rows × {vars.length} flagged columns · click a row label to open the participant</span>
      </div>
      <div className="legend-row" style={{ marginBottom: 10 }}>
        {[['f-sample', 'Sample warning'], ['f-possible', 'Possible (needs review)'], ['f-target', 'Target warning'], ['f-both', 'Both'], ['f-unresolved', 'Unresolved highlight'], ['f-missing', 'Missing value']].map(([c, l]) => (
          <span key={c} className="sym"><span className={`matrix`} style={{ display: 'inline-grid', width: 12 }}><div className={c} /></span> {l}</span>
        ))}
      </div>
      <div style={{ overflow: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `90px repeat(${vars.length}, ${size}px)`, gap: 1, alignItems: 'center' }} role="img" aria-label="Matrix of QC and formatting flags by participant and column">
          {snapshot.rows.map((r) => (
            <FragmentRow key={r.index} label={r.participantId} onClick={() => openParticipant(r.participantId)}>
              {vars.map((v) => {
                const cls = cellClass.get(`${r.index}:${v.index}`) ?? (snapshot.values[v.index][r.index].k === 'missing' ? 'f-missing' : '')
                return <div key={v.key} className={cls} style={{ height: size, background: cls ? undefined : 'var(--paper-solid)', borderRadius: 1 }} title={`${r.participantId} · ${label(v)} (${v.letter}${r.rowNumber})`} />
              })}
            </FragmentRow>
          ))}
        </div>
      </div>
    </div>
  )
}

function FragmentRow({ label: l, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <>
      <button className="btn ghost sm" style={{ height: 'auto', padding: '0 4px', justifyContent: 'flex-start', fontSize: 11 }} onClick={onClick}>{l}</button>
      {children}
    </>
  )
}

function Groups() {
  const snapshot = useStore((s) => s.snapshot)!
  const asOf = useStore((s) => s.asOf)
  const toast = useStore((s) => s.toast)
  const [segments, setSegments] = useState<Segment[]>([])
  useEffect(() => {
    call<any>('data:importReport', { datasetVersionId: snapshot.datasetVersionId }).then((r) => setSegments(r.segments)).catch(() => setSegments([]))
  }, [snapshot.datasetVersionId])
  const current = (s: Segment) => snapshot.variables.find((v) => v.groupSegment === s.index && v.role === 'measure')?.meta.area
  return (
    <div className="paper card">
      <div className="card-head"><h3>Column groups</h3><span className="muted small">Detected from thick/medium header borders; names from the legend order are tentative.</span></div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Columns</th><th>Measures</th><th>Current name</th><th>Note</th><th>Rename</th></tr></thead>
          <tbody>
            {segments.map((s) => (
              <SegmentRow key={s.index} s={s} cur={current(s)} count={snapshot.variables.filter((v) => v.groupSegment === s.index && v.role === 'measure').length} disabled={asOf !== null} onSave={async (name) => {
                try {
                  await call('curation:nameSegment', { datasetVersionId: snapshot.datasetVersionId, segment: s.index, name })
                  await useStore.getState().reloadSnapshot()
                  toast('success', 'Group name recorded.')
                } catch (e) {
                  toast('error', errorText(e))
                }
              }} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SegmentRow({ s, cur, count, disabled, onSave }: { s: Segment; cur: any; count: number; disabled: boolean; onSave: (n: string) => void }) {
  const [v, setV] = useState(cur?.value ?? s.name ?? '')
  return (
    <tr>
      <td className="mono">{columnLetter(s.startCol)}–{columnLetter(s.endCol)}</td>
      <td className="num">{count}</td>
      <td><strong>{cur?.value ?? s.name ?? '—'}</strong> <span className={`badge ${cur?.status === 'confirmed' ? 'ok' : 'warn'}`}>{cur?.status ?? s.status}</span></td>
      <td className="small muted" style={{ whiteSpace: 'normal', maxWidth: 380 }}>{cur?.provenance ?? s.note}</td>
      <td>
        <div className="row">
          <input className="input" style={{ height: 30, width: 160 }} value={v} onChange={(e) => setV(e.target.value)} disabled={disabled} aria-label="Group name" />
          <button className="btn sm" disabled={disabled || !v.trim()} onClick={() => onSave(v)}>Confirm</button>
        </div>
      </td>
    </tr>
  )
}

function Comments() {
  const snapshot = useStore((s) => s.snapshot)!
  const inspect = useStore((s) => s.inspect)
  if (snapshot.annotations.length === 0) return <div className="paper empty"><MessageSquare /><h3>No comments</h3></div>
  return (
    <div className="paper card">
      <div className="callout neutral" style={{ marginBottom: 10 }}><p className="small">Workbook comments are preserved verbatim as annotations. They are data: nothing in them is executed or followed as an instruction. Author names are not included in exports.</p></div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Cell</th><th>Column</th><th>Participant</th><th>Comment</th><th>Author</th></tr></thead>
          <tbody>
            {snapshot.annotations.map((a) => {
              const v = a.variable !== null ? snapshot.variables[a.variable] : null
              const r = a.row !== null ? snapshot.rows[a.row] : null
              return (
                <tr key={a.id} style={{ cursor: r && v ? 'pointer' : undefined }} onClick={() => r && v && inspect({ row: r.index, variable: v.index })}>
                  <td className="mono">{r && v ? <button className="btn ghost sm mono" style={{ padding: '0 6px' }} title="Inspect this cell" aria-label={`Inspect cell ${a.address}`}>{a.address}</button> : a.address}</td>
                  <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v ? label(v) : '—'}</td>
                  <td>{r ? r.participantId : <span className="muted">header</span>}</td>
                  <td style={{ whiteSpace: 'pre-wrap', minWidth: 320 }}>{a.text}</td>
                  <td className="muted">{a.author ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
