import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, CheckCircle2, ChevronRight, FileSpreadsheet, Info, Loader2, OctagonX, Upload, X } from 'lucide-react'
import { call } from '../api'
import { useStore, errorText, type ProjectState } from '../store'
import type { ValidationIssue, Segment } from '@importer/model'
import type { Legend } from '@importer/legend'

interface Inspect {
  token: string
  kind: 'xlsx' | 'csv'
  fileName: string
  size: number
  sha256: string
  sheets: { name: string; state: string; rows: number; columns: number; headers: string[]; isLegendLikely: boolean; comments: number }[]
  duplicateOf: { datasetVersionId: string; versionNumber: number; sheetName: string } | null
  csvNotice: string | null
}
interface Preview {
  headers: { col: number; letter: string; header: string }[]
  suggestion: { participantColumn: number | null; eventColumn: number | null; basis: string; note: string }
  headerDiff: { previousVersion: number; added: string[]; removed: string[] } | null
  sampleRows: { rowNumber: number; participant: string; event: string }[]
}
interface Report {
  summary: { dataRows: number; columns: number; participants: number; events: string[]; blankColumns: string[]; comments: number; richHeaders: number; formulaCells: number; flagCounts: Record<string, number> }
  issues: ValidationIssue[]
  legend: Legend | null
  segments: Segment[]
  sourceKind: 'xlsx' | 'csv'
}

const STEPS = ['File', 'Sheet', 'Identifiers', 'Review', 'Import']

export function ImportWizard() {
  const open = useStore((s) => s.importOpen)
  const setOpen = useStore((s) => s.setImportOpen)
  const project = useStore((s) => s.project)
  const toast = useStore((s) => s.toast)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [file, setFile] = useState<Inspect | null>(null)
  const [sheet, setSheet] = useState<string>('')
  const [headerRow, setHeaderRow] = useState(1)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [pcol, setPcol] = useState<number | null>(null)
  const [ecol, setEcol] = useState<number | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [report, setReport] = useState<Report | null>(null)
  const [carry, setCarry] = useState(true)

  const reset = () => {
    if (file) void call('import:discard', { token: file.token }).catch(() => undefined)
    setStep(0); setFile(null); setSheet(''); setPreview(null); setPcol(null); setEcol(null); setConfirmed(false); setReport(null); setError(null); setHeaderRow(1)
  }
  useEffect(() => {
    if (!open) reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const pick = () =>
    guard(async () => {
      const r = await call<Inspect | null>('import:pickFile')
      if (!r) return
      setFile(r)
      const data = r.sheets.filter((s) => !s.isLegendLikely).sort((a, b) => b.columns - a.columns)[0] ?? r.sheets[0]
      setSheet(data.name)
      setStep(1)
    })

  const loadPreview = (sheetName = sheet, hr = headerRow) =>
    guard(async () => {
      const p = await call<Preview>('import:preview', { token: file!.token, sheetName, headerRow: hr })
      setPreview(p)
      setPcol(p.suggestion.participantColumn)
      setEcol(p.suggestion.eventColumn)
      setConfirmed(false)
      setStep(2)
    })

  const mapping = useMemo(() => (pcol ? { sheetName: sheet, headerRow, participantColumn: pcol, eventColumn: ecol } : null), [sheet, headerRow, pcol, ecol])

  const runValidate = () =>
    guard(async () => {
      setReport(await call<Report>('import:validate', { token: file!.token, mapping }))
      setStep(3)
    })

  const commit = () =>
    guard(async () => {
      const latest = project?.versions[0]?.id ?? null
      const r = await call<{ datasetVersionId: string; versionNumber: number; project: ProjectState }>('import:commit', {
        token: file!.token,
        mapping,
        confirmMapping: true,
        carryOverFrom: carry ? latest : null
      })
      useStore.setState({ project: r.project, viewContext: null })
      await useStore.getState().loadVersion(r.datasetVersionId, null)
      toast('success', `Imported as dataset v${r.versionNumber}. The original file is stored read-only with its checksum.`)
      setFile(null)
      setOpen(false)
      useStore.getState().setPage('overview')
    })

  const errors = report?.issues.filter((i) => i.severity === 'error') ?? []

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog" aria-describedby={undefined}>
          <div className="dialog-head">
            <div style={{ flex: 1 }}>
              <Dialog.Title asChild>
                <h2>Import a workbook</h2>
              </Dialog.Title>
              <div className="muted small">Preview, confirm and commit as one transaction. The source file is never modified.</div>
            </div>
            <Dialog.Close className="btn ghost icon" aria-label="Close">
              <X size={16} />
            </Dialog.Close>
          </div>
          <div className="steps" aria-label={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}>
            {STEPS.map((s, i) => (
              <div key={s} className={`s ${i <= step ? 'on' : ''}`} title={s} />
            ))}
          </div>
          <div className="dialog-body">
            {error && (
              <div className="callout danger" style={{ marginBottom: 12 }} role="alert">
                <OctagonX size={17} />
                <p>{error}</p>
              </div>
            )}
            {step === 0 && (
              <div className="empty" style={{ padding: '36px 0' }}>
                <div className="ic"><FileSpreadsheet /></div>
                <h3>Choose an .xlsx workbook or .csv file</h3>
                <p style={{ maxWidth: 520 }}>
                  Workbooks keep formatting, comments and legend-based source/QC context. CSV files contain values only. Files are parsed locally; nothing leaves this computer.
                </p>
                <button className="btn primary" onClick={pick} disabled={busy}>
                  {busy ? <Loader2 size={15} className="spin" /> : <Upload size={15} />} Choose file…
                </button>
              </div>
            )}
            {step >= 1 && file && (
              <div className="row small" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
                <FileSpreadsheet size={15} />
                <strong>{file.fileName}</strong>
                <span className="muted">{(file.size / 1024).toFixed(0)} KB · SHA-256 {file.sha256.slice(0, 12)}…</span>
                <span className="badge outline">{file.kind.toUpperCase()}</span>
              </div>
            )}
            {step === 1 && file && (
              <div className="stack">
                {file.csvNotice && (
                  <div className="callout neutral"><Info size={16} /><p>{file.csvNotice}</p></div>
                )}
                {file.duplicateOf && (
                  <div className="callout info">
                    <Info size={16} />
                    <p style={{ flex: 1 }}>
                      <span className="t">This exact file was already imported</span> as dataset v{file.duplicateOf.versionNumber} (sheet “{file.duplicateOf.sheetName}”). Open the existing import, or continue to import a different sheet or mapping.
                    </p>
                    <button
                      className="btn sm"
                      onClick={async () => {
                        await useStore.getState().loadVersion(file.duplicateOf!.datasetVersionId, null)
                        setOpen(false)
                      }}
                    >
                      Open v{file.duplicateOf.versionNumber}
                    </button>
                  </div>
                )}
                <div className="group-label">Choose the data sheet</div>
                <div className="list">
                  {file.sheets.map((s) => (
                    <button key={s.name} className="list-item" aria-selected={sheet === s.name} onClick={() => setSheet(s.name)}>
                      <FileSpreadsheet size={16} className="muted" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="t">
                          {s.name} {s.isLegendLikely && <span className="badge violet">Formatting legend</span>} {s.state !== 'visible' && <span className="badge">hidden</span>}
                        </div>
                        <div className="s">
                          {s.rows} rows × {s.columns} columns · {s.comments} comments · {s.headers.filter(Boolean).slice(0, 6).join(' · ')}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
                <label className="field" style={{ maxWidth: 180 }}>
                  Header row
                  <input className="input" type="number" min={1} max={50} value={headerRow} onChange={(e) => setHeaderRow(Math.max(1, Number(e.target.value) || 1))} />
                </label>
              </div>
            )}
            {step === 2 && preview && (
              <div className="stack">
                <div className={`callout ${preview.suggestion.basis === 'none' ? '' : 'info'}`}>
                  <Info size={16} />
                  <p>{preview.suggestion.note}</p>
                </div>
                <div className="grid cols-2">
                  <label className="field">
                    Participant identifier column
                    <select className="input" value={pcol ?? ''} onChange={(e) => { setPcol(e.target.value ? Number(e.target.value) : null); setConfirmed(false) }}>
                      <option value="">Choose…</option>
                      {preview.headers.map((h) => (
                        <option key={h.col} value={h.col}>{h.letter} · {h.header || '(blank)'}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Visit / event column
                    <select className="input" value={ecol ?? ''} onChange={(e) => { setEcol(e.target.value ? Number(e.target.value) : null); setConfirmed(false) }}>
                      <option value="">None — one unnamed visit</option>
                      {preview.headers.map((h) => (
                        <option key={h.col} value={h.col}>{h.letter} · {h.header || '(blank)'}</option>
                      ))}
                    </select>
                  </label>
                </div>
                {preview.sampleRows.length > 0 && (
                  <div className="table-wrap">
                    <table className="data">
                      <thead><tr><th>Source row</th><th>Participant</th><th>Visit / event</th></tr></thead>
                      <tbody>
                        {preview.sampleRows.map((r) => (
                          <tr key={r.rowNumber}><td className="num">{r.rowNumber}</td><td>{r.participant}</td><td>{r.event}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {preview.headerDiff && (preview.headerDiff.added.length > 0 || preview.headerDiff.removed.length > 0) && (
                  <div className="callout">
                    <AlertTriangle size={16} />
                    <p>
                      <span className="t">Headers changed since dataset v{preview.headerDiff.previousVersion}.</span> {preview.headerDiff.added.length} added, {preview.headerDiff.removed.length} removed.
                      {preview.headerDiff.removed.length > 0 && <> Removed: {preview.headerDiff.removed.slice(0, 8).join(', ')}{preview.headerDiff.removed.length > 8 ? '…' : ''}.</>} Records are not reconciled automatically; this import becomes a new immutable version.
                    </p>
                  </div>
                )}
                <label className="check">
                  <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={!pcol} />
                  <span>I confirm these columns identify participants and visits. Identifiers are stored as text and never analysed as measurements.</span>
                </label>
              </div>
            )}
            {step >= 3 && report && <ReportView report={report} />}
            {step === 4 && report && (
              <div className="stack" style={{ marginTop: 14 }}>
                {project && project.versions.length > 0 && (
                  <label className="check">
                    <input type="checkbox" checked={carry} onChange={(e) => setCarry(e.target.checked)} />
                    <span>Carry curator metadata (labels, units, definitions, quasi-identifier flags, study context) from dataset v{project.versions[0].versionNumber} to matching variables. Each carried value is recorded as a new revision.</span>
                  </label>
                )}
              </div>
            )}
          </div>
          <div className="dialog-foot">
            {step > 0 && step < 4 && (
              <button className="btn ghost" onClick={() => setStep(step - 1)} disabled={busy}>Back</button>
            )}
            <span className="spacer" />
            {step === 1 && (
              <button className="btn primary" onClick={() => loadPreview()} disabled={busy || !sheet}>
                Continue <ChevronRight size={15} />
              </button>
            )}
            {step === 2 && (
              <button className="btn primary" onClick={runValidate} disabled={busy || !mapping || !confirmed}>
                {busy ? <Loader2 size={15} className="spin" /> : null} Check data <ChevronRight size={15} />
              </button>
            )}
            {step === 3 && (
              <button className="btn primary" onClick={() => setStep(4)} disabled={busy || errors.length > 0} title={errors.length ? 'Resolve blocking errors in the source and re-import' : undefined}>
                {errors.length ? `${errors.length} blocking error(s)` : 'Continue'} <ChevronRight size={15} />
              </button>
            )}
            {step === 4 && (
              <>
                <button className="btn ghost" onClick={() => setStep(3)} disabled={busy}>Back</button>
                <button className="btn primary" onClick={commit} disabled={busy}>
                  {busy ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />} Commit import
                </button>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

const SEV_ICON = { error: <OctagonX size={15} />, warning: <AlertTriangle size={15} />, info: <Info size={15} /> }
const SEV_CLASS = { error: 'danger', warning: 'warn', info: 'accent' }

export function ReportView({ report }: { report: Report }) {
  const s = report.summary
  const [openIssue, setOpenIssue] = useState<number | null>(null)
  return (
    <div className="stack">
      <div className="grid cols-4">
        <div className="stat"><span className="n">{s.participants}</span><span className="l">participants</span></div>
        <div className="stat"><span className="n">{s.dataRows}</span><span className="l">rows ({s.events.join(', ')})</span></div>
        <div className="stat"><span className="n">{s.columns}</span><span className="l">source columns ({s.blankColumns.length} blank)</span></div>
        <div className="stat"><span className="n">{s.comments}</span><span className="l">comments preserved</span></div>
      </div>
      {s.events.length === 1 && /baseline/i.test(s.events[0]) && (
        <div className="callout neutral"><Info size={16} /><p>Every row is <strong>{s.events[0]}</strong>. This dataset alone cannot show follow-up trajectories or treatment effects.</p></div>
      )}
      <div>
        <div className="group-label">Checks ({report.issues.length})</div>
        <div className="list">
          {report.issues.map((i, idx) => (
            <div key={idx}>
              <button className="list-item" onClick={() => setOpenIssue(openIssue === idx ? null : idx)} aria-expanded={openIssue === idx}>
                <span className={`badge ${SEV_CLASS[i.severity]}`}>{SEV_ICON[i.severity]} {i.severity}</span>
                <span style={{ flex: 1, whiteSpace: 'normal' }}>{i.message}</span>
                {i.locations.length > 0 && <span className="muted small">{i.count} location(s)</span>}
              </button>
              {openIssue === idx && i.locations.length > 0 && (
                <div className="small mono muted" style={{ padding: '4px 12px 10px 110px', whiteSpace: 'normal' }}>
                  {i.locations.join(' · ')}
                  {i.count > i.locations.length && ` · … and ${i.count - i.locations.length} more`}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      {report.legend && (
        <div>
          <div className="group-label">Formatting legend “{report.legend.sheetName}” — decoded rules</div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Legend cell</th><th>Format</th><th>Interpreted as</th><th>Meaning (from legend)</th></tr></thead>
              <tbody>
                {report.legend.rules.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.address}</td>
                    <td>
                      <span className="row">
                        {r.fill?.resolved && <span className="swatch" style={{ background: `#${r.fill.resolved}` }} />}
                        {r.font?.color?.resolved && r.section === 'format' && <span className="swatch" style={{ background: `#${r.font.color.resolved}` }} />}
                        <span style={{ fontStyle: r.font?.italic ? 'italic' : undefined, fontWeight: r.font?.bold ? 700 : undefined }}>{r.label}</span>
                      </span>
                    </td>
                    <td><span className={`badge ${r.kind === 'unknown' ? 'warn' : 'outline'}`}>{r.kind.replace(/_/g, ' ')}</span></td>
                    <td style={{ whiteSpace: 'normal', minWidth: 280 }}>{r.columnMeaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">Interpretations are recorded with their provenance and status. Colours that only resemble a legend swatch are marked “needs review”; undocumented highlights stay “unresolved” and are never excluded automatically.</p>
        </div>
      )}
      {report.segments.length > 1 && (
        <div>
          <div className="group-label">Column groups from borders (tentative)</div>
          <div className="row wrap">
            {report.segments.map((g) => (
              <span key={g.index} className="badge outline" title={g.note}>
                {g.name ?? `Group ${g.index + 1}`} · {g.endCol - g.startCol + 1} cols
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
