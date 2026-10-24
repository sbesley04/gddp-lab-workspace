import { HardDrive, Info } from 'lucide-react'
import { useStore } from '../store'
import { useSelection } from '../lib/selection'
import { qcLabel, qcPolicyText } from '../lib/format'

/** Persistent research context: dataset version, visits, cohort size, QC policy and metadata version. */
export function ContextBar() {
  const snapshot = useStore((s) => s.snapshot)
  const qc = useStore((s) => s.qcExclude)
  const authorLabel = useStore((s) => s.authorLabel)
  const asOf = useStore((s) => s.asOf)
  const sel = useSelection()
  if (!snapshot || !sel)
    return (
      <div className="contextbar">
        <HardDrive size={14} /> <strong>Offline</strong> · Saved locally
      </div>
    )
  const visits = [...new Set(sel.rows.map((r) => snapshot.rows[r].visitId))].map((id) => snapshot.visits.find((v) => v.id === id)?.name)
  const baselineOnly = snapshot.visits.length === 1 && /baseline/i.test(snapshot.visits[0].name)
  return (
    <div className="contextbar" aria-label="Current research context" data-tour="context">
      <span className="row" style={{ gap: 6 }}>
        <HardDrive size={14} /> <strong>Offline</strong> · Saved locally
      </span>
      <span className="sep" />
      <span>
        Dataset <strong>v{snapshot.versionNumber}</strong> · {snapshot.sheetName}
      </span>
      <span className="sep" />
      <span>{baselineOnly ? <strong>Baseline only</strong> : `Visits: ${visits.join(', ')}`}</span>
      <span className="sep" />
      <span>
        <strong>{sel.participantIds.length}</strong> of {new Set(snapshot.rows.map((r) => r.participantId)).size} participants · <strong>{sel.rows.length}</strong> rows
      </span>
      <span className="sep" />
      <span title={qc.length ? qc.map(qcLabel).join('; ') : 'All flagged observations are included and marked.'}>
        QC: {qcPolicyText(qc)}
      </span>
      <span className="sep" />
      <span>
        Metadata rev. {snapshot.metadataVersion}
        {asOf !== null && ' · pinned'}
      </span>
      <span className="spacer" />
      <span className="row muted" style={{ gap: 6 }} title="Recorded with your edits">
        <Info size={13} /> {authorLabel || 'No author label'}
      </span>
    </div>
  )
}
