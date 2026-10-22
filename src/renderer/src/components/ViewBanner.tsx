import { History, X } from 'lucide-react'
import { useStore } from '../store'

/** Shown while a saved view is reproduced against its pinned metadata version. */
export function ViewBanner() {
  const vc = useStore((s) => s.viewContext)
  const asOf = useStore((s) => s.asOf)
  const useCurrent = useStore((s) => s.useCurrentMetadata)
  if (!vc) return null
  return (
    <div className="callout info" style={{ margin: '12px 18px 0', alignItems: 'center' }} role="status">
      <History size={17} />
      <p style={{ flex: 1 }}>
        <span className="t">Saved view “{vc.name}”</span> — reproduced exactly as saved (metadata rev. {vc.metadataVersion}).
        {asOf !== null && vc.changedSince > 0 && <> {vc.changedSince} curation change(s) were made since; editing is paused while viewing as saved.</>}
      </p>
      {asOf !== null && vc.changedSince > 0 && (
        <button className="btn sm" onClick={() => void useCurrent()}>
          Use current metadata
        </button>
      )}
      <button className="btn ghost sm icon" aria-label="Leave saved view" onClick={() => void useCurrent()}>
        <X size={14} />
      </button>
    </div>
  )
}
