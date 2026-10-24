import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { useStore, type Page } from '../store'
import { MOD } from './Sidebar'

interface Step {
  anchor: string // data-tour value
  page?: Page
  title: string
  body: string
}

const STEPS: Step[] = [
  { anchor: 'nav', title: 'Six places to work', body: `Overview summarises the dataset and open metadata tasks. Explore is for charts and tables; Measurements for definitions and units; Data quality for QC flags and the formatting legend; Saved views for reproducible selections and Compare boards; Export for context packages. Jump with ${MOD}1–${MOD}6.` },
  { anchor: 'search', title: 'Find any measure', body: `Search all measures by header, alias, unit or column letter. Press ${MOD}K anywhere.` },
  { anchor: 'pickers', page: 'explore', title: 'Choose what to look at', body: 'Pick the visit, the measure, what to compare it with or group it by, and the QC policy. Flagged observations are included and marked by default.' },
  { anchor: 'filters', page: 'explore', title: 'Narrow the cohort', body: 'Add range, value or missing/present conditions and combine them with ALL / ANY. Each condition says what happens to missing values. The count on the right always shows how many rows match.' },
  { anchor: 'toolbar', page: 'explore', title: 'Shape and analyse the chart', body: 'Axes sets log scales and fixed bounds. Style changes colours, fonts and presets. Analyze opens statistics, which are computed only when you press Compute. Download saves SVG or PNG.' },
  { anchor: 'side', page: 'explore', title: 'Numbers and context beside the chart', body: 'The Summary tab gives per-group descriptives; the Measure tab shows definitions, units, source and QC notes. Click any point or table value to inspect its source cell.' },
  { anchor: 'save', page: 'explore', title: 'Save reproducible views', body: 'A saved view is pinned to this dataset and metadata version, with a suggested name. Arrange views side by side in Saved views → Compare.' },
  { anchor: 'context', title: 'Your context, always visible', body: 'The bar at the bottom shows the dataset version, whether data are baseline-only, how many participants are selected, the QC policy and the metadata revision. Everything works offline.' },
  { anchor: 'nav-export', title: 'Share with context', body: 'Export builds a documented package (data, dictionary, QC flags, study context and your question) with pseudonymous IDs, ready for a statistician or an AI assistant. Replay this tour from the ? button in the sidebar.' }
]

export const TOUR_KEY = 'bari.tour.v1'

export function tourSeen(): boolean {
  try {
    return localStorage.getItem(TOUR_KEY) === 'done'
  } catch {
    return true // storage unavailable: never nag
  }
}

function markSeen() {
  try {
    localStorage.setItem(TOUR_KEY, 'done')
  } catch {
    /* convenience only */
  }
}

/** A short, non-blocking coach-mark tour. The page stays usable underneath. */
export function Tour() {
  const step = useStore((s) => s.tourStep)
  const setStep = useStore((s) => s.setTourStep)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const card = useRef<HTMLDivElement>(null)
  const [cardSize, setCardSize] = useState({ w: 360, h: 180 })

  const finish = useCallback(() => {
    markSeen()
    setStep(null)
  }, [setStep])

  const current = step !== null ? STEPS[step] : null

  useEffect(() => {
    if (!current) return
    // Never show the previous step's highlight while the next target is being located.
    setRect(null)
    const navigate = !!current.page && useStore.getState().page !== current.page
    if (navigate) useStore.getState().setPage(current.page!)
    let raf = 0
    const measure = () => {
      const el = document.querySelector(`[data-tour="${current.anchor}"]`) as HTMLElement | null
      if (el) el.scrollIntoView({ block: 'nearest', behavior: 'auto' })
      setRect(el ? el.getBoundingClientRect() : null)
    }
    const t = setTimeout(measure, navigate ? 260 : 0)
    const onResize = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    }
    window.addEventListener('resize', onResize)
    return () => {
      clearTimeout(t)
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
    }
  }, [current])

  useLayoutEffect(() => {
    if (card.current) setCardSize({ w: card.current.offsetWidth, h: card.current.offsetHeight })
  }, [step, rect])

  useEffect(() => {
    if (step === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish()
      if (e.key === 'ArrowRight') setStep(step < STEPS.length - 1 ? step + 1 : null)
      if (e.key === 'ArrowLeft' && step > 0) setStep(step - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, setStep, finish])

  if (!current || step === null) return null
  const pad = 8
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left = vw / 2 - cardSize.w / 2
  let top = vh / 2 - cardSize.h / 2
  if (rect) {
    // Prefer the right of the target, then below, then above; always keep the card on screen.
    if (rect.right + 16 + cardSize.w < vw - 12) {
      left = rect.right + 16
      top = rect.top
    } else if (rect.bottom + 16 + cardSize.h < vh - 12) {
      left = rect.left
      top = rect.bottom + 16
    } else {
      left = rect.left
      top = rect.top - cardSize.h - 16
    }
    left = Math.max(12, Math.min(vw - cardSize.w - 12, left))
    top = Math.max(12, Math.min(vh - cardSize.h - 12, top))
  }
  const last = step === STEPS.length - 1
  return (
    <>
      {rect && (
        // One SVG with an even-odd hole: far cheaper to paint over blurred glass than a huge box-shadow.
        <svg className="tour-veil" width={vw} height={vh} aria-hidden>
          <path fillRule="evenodd" d={`M0 0H${vw}V${vh}H0Z M${rect.left - pad} ${rect.top - pad}h${rect.width + pad * 2}v${rect.height + pad * 2}h${-(rect.width + pad * 2)}Z`} />
          <rect x={rect.left - pad} y={rect.top - pad} width={rect.width + pad * 2} height={rect.height + pad * 2} rx={14} className="tour-ring" />
        </svg>
      )}
      <div ref={card} className="tour-card glass" role="dialog" aria-label={`Tour step ${step + 1} of ${STEPS.length}: ${current.title}`} style={{ left, top }} data-testid="tour">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div className="small muted">Step {step + 1} of {STEPS.length}</div>
            <strong style={{ fontSize: 15.5 }}>{current.title}</strong>
          </div>
          <button className="btn ghost sm icon" aria-label="Close tour" onClick={finish}><X size={14} /></button>
        </div>
        <p style={{ margin: '8px 0 12px' }}>{current.body}</p>
        <div className="row">
          <div className="tour-dots" aria-hidden>
            {STEPS.map((_, i) => <span key={i} className={i === step ? 'on' : ''} />)}
          </div>
          <span className="spacer" />
          {step === 0 ? (
            <button className="btn ghost sm" onClick={finish}>Skip</button>
          ) : (
            <button className="btn ghost sm" onClick={() => setStep(step - 1)}><ArrowLeft size={13} /> Back</button>
          )}
          <button className="btn primary sm" onClick={() => (last ? finish() : setStep(step + 1))} autoFocus data-testid="tour-next">
            {last ? 'Done' : <>Next <ArrowRight size={13} /></>}
          </button>
        </div>
      </div>
    </>
  )
}
