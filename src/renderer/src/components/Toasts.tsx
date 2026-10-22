import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import { useStore } from '../store'

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast glass ${t.kind}`}>
          {t.kind === 'error' ? <AlertCircle size={17} /> : t.kind === 'success' ? <CheckCircle2 size={17} /> : <Info size={17} />}
          <span style={{ color: 'var(--text)' }}>{t.text}</span>
          <button className="btn ghost sm icon" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
