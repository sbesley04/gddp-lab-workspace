import { useEffect, useMemo, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { PackageOpen, Copy, Plus, X, ShieldAlert, AlertTriangle, CheckCircle2, FileText, Loader2, Save, Info, Sparkles } from 'lucide-react'
import type { ContextExportPreview } from '@core/contextExport'
import { describeFilter } from '@core/selection'
import { call } from '../api'
import { useStore, errorText } from '../store'
import { useSelection, useSpec } from '../lib/selection'
import { label, qcPolicyText, FIELD_TEXT } from '../lib/format'
import { VariableList } from '../components/Pickers'

type KeyMode = 'project_pseudonym' | 'random_per_export' | 'source_id'

interface WriteResult {
  fileName: string
  bytes: number
  files: { name: string; sha256: string; bytes: number }[]
}

export function ExportPage() {
  const snapshot = useStore((s) => s.snapshot)!
  const chart = useStore((s) => s.chart)
  const asOf = useStore((s) => s.asOf)
  const qc = useStore((s) => s.qcExclude)
  const toast = useStore((s) => s.toast)
  const spec = useSpec()!
  const sel = useSelection()!
  const measures = useMemo(() => snapshot.variables.filter((v) => v.role === 'measure'), [snapshot])
  const initial = useMemo(
    () => [...new Set([chart.measureKey, chart.compareKey, chart.groupKey, ...chart.tableColumns].filter((k): k is string => !!k))],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  const [keys, setKeys] = useState<string[]>(initial)
  const [qi, setQi] = useState<string[]>([])
  const [mode, setMode] = useState<KeyMode>('project_pseudonym')
  const [ackSource, setAckSource] = useState(false)
  const [comments, setComments] = useState(false)
  const [question, setQuestion] = useState('')
  const [context, setContext] = useState('')
  const [contextSaved, setContextSaved] = useState('')
  const [preview, setPreview] = useState<ContextExportPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [file, setFile] = useState('selected_data.csv')
  const [result, setResult] = useState<WriteResult | null>(null)
  const [pickOpen, setPickOpen] = useState(false)
  const mv = asOf ?? snapshot.metadataVersion

  useEffect(() => {
    call<{ text: string }>('curation:getStudyContext', { datasetVersionId: snapshot.datasetVersionId, asOf }).then((r) => {
      setContext(r.text)
      setContextSaved(r.text)
    })
  }, [snapshot.datasetVersionId, asOf])

  const selected = keys.map((k) => measures.find((m) => m.key === k)).filter((v): v is NonNullable<typeof v> => !!v)
  const qiSelected = selected.filter((v) => v.quasiIdentifier)
  const options = { variableKeys: keys, confirmedQuasiIdentifiers: qi, participantKeyMode: mode, includeCommentText: comments, analysisQuestion: question }
  const canRun = keys.length > 0 && sel.rows.length > 0 && (mode !== 'source_id' || ackSource)

  // Live preview, debounced; it uses the same selection engine as Explore.
  useEffect(() => {
    setResult(null)
    if (!canRun) {
      setPreview(null)
      return
    }
    const t = setTimeout(() => {
      call<ContextExportPreview>('export:preview', { spec, options, metadataVersion: mv }).then(setPreview).catch((e) => toast('error', errorText(e)))
    }, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(spec), JSON.stringify(options), mv, contextSaved, canRun])

  const write = async () => {
    setBusy(true)
    try {
      const r = await call<WriteResult | null>('export:write', { spec, options, metadataVersion: mv })
      if (r) {
        setResult(r)
        toast('success', `Package written: ${r.fileName}`)
      }
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const saveContext = async () => {
    try {
      await call('curation:setStudyContext', { datasetVersionId: snapshot.datasetVersionId, text: context })
      setContextSaved(context)
      await useStore.getState().reloadSnapshot()
      toast('success', 'Study context saved as a revision.')
    } catch (e) {
      toast('error', errorText(e))
    }
  }
  const copySummary = async () => {
    if (!preview) return
    try {
      await navigator.clipboard.writeText(preview.summary)
      toast('success', 'Context summary copied.')
    } catch (e) {
      toast('error', `Copy failed: ${errorText(e)}`)
    }
  }

  return (
    <>
      <header className="topbar drag">
        <div>
          <h2>Export research context</h2>
          <div className="subtitle">A documented package for statisticians, collaborators or an AI assistant — no API or account needed</div>
        </div>
        <span className="spacer" />
        <div className="row no-drag">
          <button className="btn" onClick={copySummary} disabled={!preview}><Copy size={15} /> Copy summary</button>
          <button className="btn primary" onClick={write} disabled={!preview || busy || preview.blockingQuasiIdentifiers.length > 0} data-testid="write-export">
            {busy ? <Loader2 size={15} className="spin" /> : <PackageOpen size={15} />} Create package…
          </button>
        </div>
      </header>
      <div className="content page-fade">
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.15fr)', alignItems: 'start' }}>
          <div className="stack">
            <div className="paper card">
              <h3>1 · Selection</h3>
              <div className="kv small">
                <div className="k">Rows</div><div><strong>{sel.rows.length}</strong> rows · {sel.participantIds.length} participants</div>
                <div className="k">Cohort</div><div>{describeFilter(sel.ctx, spec.filter)}</div>
                <div className="k">QC policy</div><div>{qcPolicyText(qc)} (all flags listed in quality_flags.csv)</div>
                <div className="k">Versions</div><div>Dataset v{snapshot.versionNumber} · metadata rev. {mv}</div>
              </div>
              <p className="small muted" style={{ marginBottom: 0 }}>Change the selection in Explore; this export always uses exactly the same rows.</p>
            </div>
            <div className="paper card">
              <div className="card-head">
                <h3>2 · Variables</h3>
                <span className="muted small">{keys.length} selected</span>
                <span className="spacer" />
                <Popover.Root open={pickOpen} onOpenChange={setPickOpen}>
                  <Popover.Trigger asChild><button className="btn sm"><Plus size={13} /> Add</button></Popover.Trigger>
                  <Popover.Portal>
                    <Popover.Content className="popover" align="end" sideOffset={8}>
                      <VariableList vars={measures.filter((m) => !keys.includes(m.key))} value={null} onPick={(v) => { if (v) setKeys([...keys, v.key]); setPickOpen(false) }} />
                    </Popover.Content>
                  </Popover.Portal>
                </Popover.Root>
              </div>
              <div className="row wrap">
                {selected.map((v) => (
                  <span key={v.key} className={`badge ${v.quasiIdentifier ? 'warn' : 'outline'}`}>
                    {v.quasiIdentifier && <ShieldAlert size={11} />} {label(v)}
                    <button className="btn ghost sm icon" style={{ height: 18, width: 18 }} aria-label={`Remove ${label(v)}`} onClick={() => setKeys(keys.filter((k) => k !== v.key))}><X size={11} /></button>
                  </span>
                ))}
                {keys.length === 0 && <span className="muted small">Add at least one variable. Unselected columns are never exported.</span>}
              </div>
            </div>
            <div className="paper card">
              <h3>3 · Privacy review</h3>
              <div className="stack" style={{ gap: 8 }}>
                <label className="check"><input type="radio" name="km" checked={mode === 'project_pseudonym'} onChange={() => setMode('project_pseudonym')} /> <span><strong>Project pseudonyms</strong> (default) — stable keys like P-3F2A…; the linking secret stays in this project.</span></label>
                <label className="check"><input type="radio" name="km" checked={mode === 'random_per_export'} onChange={() => setMode('random_per_export')} /> <span><strong>Random keys</strong> — unlinkable to other exports.</span></label>
                <label className="check"><input type="radio" name="km" checked={mode === 'source_id'} onChange={() => setMode('source_id')} /> <span><strong>Source IDs</strong> — export study identifiers as-is.</span></label>
                {mode === 'source_id' && (
                  <label className="check callout" style={{ margin: '0 0 0 22px' }}><input type="checkbox" checked={ackSource} onChange={(e) => setAckSource(e.target.checked)} /> <span>I confirm the recipient is authorised to receive study identifiers.</span></label>
                )}
              </div>
              {qiSelected.length > 0 && (
                <div className="stack" style={{ gap: 6, marginTop: 12 }}>
                  <div className="callout"><ShieldAlert size={16} /><p><span className="t">Quasi-identifiers selected.</span> Combined, these can re-identify people even under pseudonyms. Confirm each one you need, or remove it.</p></div>
                  {qiSelected.map((v) => (
                    <label key={v.key} className="check" style={{ marginLeft: 6 }}>
                      <input type="checkbox" checked={qi.includes(v.key)} onChange={(e) => setQi(e.target.checked ? [...qi, v.key] : qi.filter((k) => k !== v.key))} />
                      <span>Include <strong>{label(v)}</strong></span>
                    </label>
                  ))}
                </div>
              )}
              <hr className="div" />
              <label className="check"><input type="checkbox" checked={comments} onChange={(e) => setComments(e.target.checked)} /> <span>Include free-text source comments in quality_flags.csv (authors are never exported).</span></label>
              <p className="small muted" style={{ marginBottom: 0 }}>Pseudonymisation is not anonymisation. The complete workbook, unselected columns and local file paths are never included.</p>
            </div>
            <div className="paper card">
              <h3>4 · Question and study context</h3>
              <label className="field">
                Analysis question
                <textarea className="input" rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Describe how baseline CSF protein relates to depression scores, noting data limitations. (Exploratory)" data-testid="question" />
              </label>
              <label className="field" style={{ marginTop: 10 }}>
                Study context (curator-entered, saved with the project)
                <textarea className="input" rows={4} value={context} onChange={(e) => setContext(e.target.value)} placeholder="Study design, population, sample handling, what is known and unknown…" disabled={asOf !== null} />
              </label>
              <div className="row" style={{ marginTop: 6 }}>
                <span className="small muted">{context !== contextSaved ? 'Unsaved changes' : 'Saved'}</span>
                <span className="spacer" />
                <button className="btn sm" onClick={saveContext} disabled={context === contextSaved || asOf !== null}><Save size={13} /> Save context</button>
              </div>
            </div>
          </div>
          <div className="stack" style={{ position: 'sticky', top: 0 }}>
            <div className="paper card">
              <div className="card-head"><h3><FileText size={16} /> 5 · Preview the exact files</h3></div>
              {!preview ? (
                <div className="empty" style={{ padding: 30 }}>{canRun ? <Loader2 className="spin" /> : <span>Select rows and at least one variable to preview.</span>}</div>
              ) : (
                <>
                  {preview.blockingQuasiIdentifiers.length > 0 && <div className="callout danger" style={{ marginBottom: 10 }}><ShieldAlert size={16} /><p>Confirm or remove {preview.blockingQuasiIdentifiers.length} quasi-identifier(s) before export.</p></div>}
                  {preview.unresolved.length > 0 && (
                    <div className="callout" style={{ marginBottom: 10 }}>
                      <AlertTriangle size={16} />
                      <p>
                        <span className="t">{preview.unresolved.length} variable(s) have unresolved metadata</span> — they are exported with explicit “unknown” status:{' '}
                        {preview.unresolved.slice(0, 5).map((u) => `${u.header} (${u.missing.map((m) => FIELD_TEXT[m] ?? m).join(', ')})`).join('; ')}
                        {preview.unresolved.length > 5 ? '…' : ''}
                      </p>
                    </div>
                  )}
                  <div className="seg" role="tablist" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
                    {[...Object.keys(preview.files), 'manifest.json'].map((f) => (
                      <button key={f} aria-pressed={file === f} onClick={() => setFile(f)}>{f}</button>
                    ))}
                  </div>
                  <pre className="preview" data-testid="export-preview">
                    {file === 'manifest.json' ? JSON.stringify({ ...preview.manifestBase, files: '(names, sizes and SHA-256 checksums are added when the package is written)' }, null, 2) : truncate(preview.files[file])}
                  </pre>
                  <div className="row small muted" style={{ marginTop: 8 }}>
                    <Info size={13} /> {preview.rows} rows · {preview.variables.length} variables · {preview.guardedCells} text cell(s) formula-guarded
                  </div>
                </>
              )}
            </div>
            {result && (
              <div className="paper card">
                <h3><CheckCircle2 size={16} color="var(--ok)" /> Package written</h3>
                <div className="small"><strong>{result.fileName}</strong> · {(result.bytes / 1024).toFixed(1)} KB</div>
                <table className="data" style={{ marginTop: 8 }}>
                  <tbody>{result.files.map((f) => <tr key={f.name}><td>{f.name}</td><td className="mono small">{f.sha256.slice(0, 16)}…</td><td className="num">{f.bytes} B</td></tr>)}</tbody>
                </table>
                <div className="callout info" style={{ marginTop: 10 }}>
                  <Sparkles size={16} />
                  <p className="small">To use with Claude or another assistant, attach the ZIP (or its files) yourself and paste the copied summary. Nothing is sent from this app.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function truncate(text: string) {
  const lines = text.split(/\r?\n/)
  return lines.length > 300 ? lines.slice(0, 300).join('\n') + `\n… ${lines.length - 300} more lines` : text
}
