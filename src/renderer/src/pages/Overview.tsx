import { useMemo } from 'react'
import { Upload, FileSpreadsheet, ClipboardList, ShieldCheck, AlertTriangle, ChevronRight, Info, Database } from 'lucide-react'
import { useStore } from '../store'
import { areaOf, shortDate, plural } from '../lib/format'

export function Overview() {
  const project = useStore((s) => s.project)!
  const snapshot = useStore((s) => s.snapshot)
  const setPage = useStore((s) => s.setPage)

  if (!snapshot)
    return (
      <>
        <header className="topbar drag"><div><h2>{project.name}</h2><div className="subtitle">No dataset imported yet</div></div></header>
        <div className="content">
          {project.syncWarning && <SyncWarning text={project.syncWarning} />}
          <div className="paper empty" style={{ marginTop: 10 }}>
            <div className="ic"><FileSpreadsheet /></div>
            <h3>Import your first workbook</h3>
            <p style={{ maxWidth: 520 }}>Choose the study workbook. You'll preview sheets, confirm the participant and visit columns, and review every detected issue before anything is saved.</p>
            <button className="btn primary" onClick={() => useStore.getState().setImportOpen(true)}><Upload size={15} /> Import workbook</button>
          </div>
        </div>
      </>
    )
  return <OverviewBody />
}

function SyncWarning({ text }: { text: string }) {
  return (
    <div className="callout" style={{ marginBottom: 14 }} role="alert">
      <AlertTriangle size={17} />
      <p>{text}</p>
    </div>
  )
}

function OverviewBody() {
  const project = useStore((s) => s.project)!
  const snapshot = useStore((s) => s.snapshot)!
  const setPage = useStore((s) => s.setPage)
  const measures = useMemo(() => snapshot.variables.filter((v) => v.role === 'measure'), [snapshot])
  const blank = snapshot.variables.filter((v) => v.role === 'blank')
  const participants = new Set(snapshot.rows.map((r) => r.participantId)).size
  const baselineOnly = snapshot.visits.length === 1 && /baseline/i.test(snapshot.visits[0].name)
  const version = project.versions.find((v) => v.id === snapshot.datasetVersionId)

  const areas = useMemo(() => {
    const m = new Map<string, { n: number; unit: number; def: number; obs: number; cells: number }>()
    for (const v of measures) {
      const a = m.get(areaOf(v)) ?? { n: 0, unit: 0, def: 0, obs: 0, cells: 0 }
      a.n++
      if (v.meta.unit.status !== 'unknown') a.unit++
      if (v.meta.definition.status !== 'unknown') a.def++
      a.obs += v.counts.number + v.counts.censored + v.counts.text
      a.cells += snapshot.rows.length
      m.set(areaOf(v), a)
    }
    return [...m.entries()]
  }, [measures, snapshot])

  const tasks = useMemo(() => {
    const unknownUnits = measures.filter((v) => v.meta.unit.status === 'unknown').length
    const tentativeUnits = measures.filter((v) => v.meta.unit.status === 'tentative').length
    const noDef = measures.filter((v) => v.meta.definition.status === 'unknown').length
    const qcReview = snapshot.flags.filter((f) => f.status === 'needs_review' && f.category)
    const review = new Set(qcReview.map((f) => f.formatKey)).size
    const reviewCells = qcReview.length
    const sourceReview = snapshot.flags.filter((f) => f.status === 'needs_review' && f.kind === 'cell_source').length
    const unresolvedGroups = new Set(snapshot.flags.filter((f) => f.status === 'unresolved').map((f) => f.formatKey)).size
    const ambiguous = measures.filter((v) => /^(total )?score$/i.test(v.header)).length
    const aliasIssues = measures.filter((v) => v.attribution?.status === 'needs_review').length
    const tentativeAreas = measures.filter((v) => v.meta.area.status === 'tentative').length
    return [
      { n: review, t: `formatting colour${review === 1 ? ' only resembles' : 's only resemble'} a legend QC colour (${reviewCells} cells) — confirm or reject`, page: 'quality' as const, warn: true },
      { n: sourceReview, t: `cell${sourceReview === 1 ? '' : 's'} use a source colour that differs from the column's attribution — review`, page: 'quality' as const, warn: true },
      { n: noDef, t: 'measures have no definition', page: 'measurements' as const },
      { n: unknownUnits, t: 'measures have unknown units', page: 'measurements' as const },
      { n: tentativeUnits, t: 'units are header-derived suggestions awaiting confirmation', page: 'measurements' as const },
      { n: ambiguous, t: 'ambiguous headers (e.g. “Score”) need context', page: 'measurements' as const, warn: true },
      { n: aliasIssues, t: 'multi-source headers have aliases needing review', page: 'quality' as const, warn: true },
      { n: unresolvedGroups, t: 'undocumented highlight/font colours remain unresolved', page: 'quality' as const },
      { n: tentativeAreas, t: 'research-area assignments are tentative (from legend + borders)', page: 'quality' as const }
    ].filter((x) => x.n > 0)
  }, [measures, snapshot])

  const flagTotals = useMemo(() => {
    const m: Record<string, number> = {}
    for (const f of snapshot.flags) if (f.category) m[f.category] = (m[f.category] ?? 0) + 1
    return m
  }, [snapshot])

  return (
    <>
      <header className="topbar drag">
        <div>
          <h2>{project.name}</h2>
          <div className="subtitle">
            Dataset v{snapshot.versionNumber} · {plural(participants, 'participant')} · {baselineOnly ? 'Baseline only' : plural(snapshot.visits.length, 'visit')}
          </div>
        </div>
        <span className="spacer" />
        <div className="row no-drag">
          <button className="btn" onClick={() => useStore.getState().setImportOpen(true)}><Upload size={15} /> Import new version</button>
          <button className="btn primary" onClick={() => setPage('explore')}>Explore data <ChevronRight size={15} /></button>
        </div>
      </header>
      <div className="content stack">
        {project.syncWarning && <SyncWarning text={project.syncWarning} />}
        {project.isDemo && (
          <div className="callout info"><Info size={17} /><p><span className="t">Synthetic demo project.</span> All participants (DEMO-xx), values and comments are invented for demonstration and testing. It is recreated each time you open the demo.</p></div>
        )}
        {baselineOnly && (
          <div className="callout neutral">
            <Info size={17} />
            <p>Every row in this dataset is a <strong>{snapshot.visits[0].name}</strong> observation. It cannot show follow-up trajectories, change from baseline or treatment effects; those require repeated visits.</p>
          </div>
        )}
        <div className="grid cols-4">
          <div className="paper card stat"><span className="n">{participants}</span><span className="l">participants (distinct IDs)</span></div>
          <div className="paper card stat"><span className="n">{snapshot.rows.length}</span><span className="l">rows · {snapshot.visits.map((v) => v.name).join(', ')}</span></div>
          <div className="paper card stat"><span className="n">{measures.length}</span><span className="l">measures ({snapshot.variables.length} source columns, {blank.length} blank)</span></div>
          <div className="paper card stat"><span className="n">{snapshot.annotations.length}</span><span className="l">source comments preserved</span></div>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)' }}>
          <div className="paper card">
            <div className="card-head"><h3><ClipboardList size={17} /> Outstanding metadata tasks</h3></div>
            {tasks.length === 0 && <p className="muted">No outstanding metadata tasks.</p>}
            <div className="list">
              {tasks.map((t) => (
                <button key={t.t} className="list-item" onClick={() => setPage(t.page)}>
                  <span className={`badge ${t.warn ? 'warn' : ''}`} style={{ minWidth: 44, justifyContent: 'center' }}>{t.n}</span>
                  <span style={{ flex: 1, whiteSpace: 'normal' }}>{t.t}</span>
                  <ChevronRight size={15} className="muted" />
                </button>
              ))}
            </div>
          </div>
          <div className="paper card">
            <div className="card-head"><h3><Database size={17} /> Source</h3></div>
            <div className="kv small">
              <div className="k">File</div><div style={{ wordBreak: 'break-all' }}>{snapshot.sourceFileName}</div>
              <div className="k">Sheet</div><div>{snapshot.sheetName}</div>
              <div className="k">SHA-256</div><div className="mono" style={{ wordBreak: 'break-all' }}>{snapshot.sourceSha256}</div>
              <div className="k">Imported</div><div>{shortDate(snapshot.importedAt)} · stored read-only</div>
              <div className="k">Format</div><div>{snapshot.sourceKind === 'csv' ? 'CSV (values only; no formatting or comments)' : 'Excel workbook (formatting, comments and legend preserved)'}</div>
              <div className="k">Versions</div><div>{project.versions.length} immutable version(s){version ? ` · this is v${version.versionNumber}` : ''}</div>
            </div>
          </div>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)' }}>
          <div className="paper card">
            <div className="card-head"><h3>Measurement areas</h3><span className="muted small">Groups are tentative until a curator confirms them</span></div>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Area</th><th>Measures</th><th>Values recorded</th><th>Units known</th><th>Definitions</th></tr></thead>
                <tbody>
                  {areas.map(([a, s]) => (
                    <tr key={a} style={{ cursor: 'pointer' }} onClick={() => { sessionStorage.setItem('bari.focusArea', a); setPage('measurements') }}>
                      <td><strong>{a}</strong></td>
                      <td className="num">{s.n}</td>
                      <td style={{ minWidth: 140 }}><Bar part={s.obs} total={s.cells} /> <span className="small muted num">{Math.round((100 * s.obs) / Math.max(1, s.cells))}%</span></td>
                      <td className="num">{s.unit}/{s.n}</td>
                      <td className="num">{s.def}/{s.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="paper card">
            <div className="card-head"><h3><ShieldCheck size={17} /> QC and formatting flags</h3></div>
            {Object.keys(flagTotals).length === 0 && <p className="muted small">No QC or formatting flags. Absence of flags is not a QC pass.</p>}
            <div className="list">
              {Object.entries(flagTotals).map(([k, n]) => (
                <button key={k} className="list-item" onClick={() => setPage('quality')}>
                  <span className="t" style={{ flex: 1 }}>{k.replace(/_/g, ' ')}</span>
                  <span className="badge">{n} cells</span>
                </button>
              ))}
            </div>
            <p className="small muted">Flagged observations are included and marked by default. Choose exclusions per analysis in Explore → QC.</p>
            {snapshot.flags.some((f) => f.status === 'needs_review') && (
              <div className="callout" style={{ marginTop: 8 }}><AlertTriangle size={16} /><p>Some highlight colours only resemble the legend. Review them in Data quality.</p></div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function Bar({ part, total }: { part: number; total: number }) {
  const pct = Math.round((100 * part) / Math.max(1, total))
  return (
    <span className="bar" style={{ display: 'inline-flex', width: 90, verticalAlign: 'middle' }} aria-label={`${pct}% recorded`}>
      <span style={{ width: `${pct}%`, background: 'var(--accent)' }} />
    </span>
  )
}
