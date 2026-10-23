import { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Palette, Ruler, RotateCcw } from 'lucide-react'
import type { ChartStyle, StylePreset } from '@core/types'
import { STYLE_PRESETS } from '@core/chartStyle'

// ---------------------------------------------------------------- style editor

export function StyleEditor({ value, onChange, label = 'Style', compact }: { value: ChartStyle; onChange: (s: ChartStyle) => void; label?: string; compact?: boolean }) {
  const set = (patch: Partial<ChartStyle>) => onChange({ ...value, ...patch, preset: 'custom' })
  const color = (k: keyof ChartStyle, text: string) => (
    <label className="row small" style={{ justifyContent: 'space-between' }}>
      <span>{text}</span>
      <input type="color" value={value[k] as string} onChange={(e) => set({ [k]: e.target.value } as Partial<ChartStyle>)} aria-label={text} style={{ width: 38, height: 24, border: 0, background: 'none', padding: 0 }} />
    </label>
  )
  const slider = (k: 'fontSize' | 'pointSize' | 'pointOpacity', text: string, min: number, max: number, step: number) => (
    <label className="field" style={{ fontWeight: 500 }}>
      <span className="row" style={{ justifyContent: 'space-between' }}>{text}<span className="muted num">{value[k]}</span></span>
      <input type="range" min={min} max={max} step={step} value={value[k]} onChange={(e) => set({ [k]: Number(e.target.value) } as Partial<ChartStyle>)} />
    </label>
  )
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className={`btn sm ${compact ? 'icon' : ''}`} title="Chart style" aria-label="Chart style" data-testid="style-editor">
          <Palette size={14} /> {!compact && label}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover" align="end" sideOffset={8} style={{ width: 330 }}>
          <div className="stack" style={{ gap: 10 }}>
            <strong>Chart style</strong>
            <div className="list">
              {(Object.keys(STYLE_PRESETS) as Exclude<StylePreset, 'custom'>[]).map((k) => (
                <button key={k} className="list-item" aria-selected={value.preset === k} onClick={() => onChange({ ...STYLE_PRESETS[k].style })}>
                  <span className="row" style={{ gap: 4 }}>
                    {(['pointColor', 'flagColor', 'fitColor'] as const).map((c) => <span key={c} className="swatch" style={{ background: STYLE_PRESETS[k].style[c] }} />)}
                  </span>
                  <span className="t">{STYLE_PRESETS[k].label}</span>
                </button>
              ))}
            </div>
            {value.preset === 'custom' && <span className="badge accent" style={{ alignSelf: 'flex-start' }}>Custom</span>}
            <hr className="div" style={{ margin: 0 }} />
            <div className="grid cols-2" style={{ gap: 8 }}>
              {color('pointColor', 'Points')}
              {color('flagColor', 'QC flags ▲')}
              {color('unresolvedColor', 'Unresolved ◇')}
              {color('boxColor', 'Boxes')}
              {color('fitColor', 'Fit / CI')}
              <label className="row small" style={{ justifyContent: 'space-between' }}>
                <span>Text</span>
                <span className="row" style={{ gap: 4 }}>
                  <input type="checkbox" checked={value.textColor === null} onChange={(e) => set({ textColor: e.target.checked ? null : '#111827' })} title="Automatic" />
                  {value.textColor !== null && <input type="color" value={value.textColor} onChange={(e) => set({ textColor: e.target.value })} aria-label="Text colour" style={{ width: 30, height: 22, border: 0, background: 'none', padding: 0 }} />}
                </span>
              </label>
            </div>
            <div className="grid cols-2" style={{ gap: 8 }}>
              <label className="field">Background
                <select className="input" style={{ height: 30 }} value={value.background} onChange={(e) => set({ background: e.target.value as ChartStyle['background'] })}>
                  <option value="transparent">Glass (theme)</option>
                  <option value="white">White</option>
                  <option value="black">Black</option>
                </select>
              </label>
              <label className="field">Font
                <select className="input" style={{ height: 30 }} value={value.font} onChange={(e) => set({ font: e.target.value as ChartStyle['font'] })}>
                  <option value="system">System</option>
                  <option value="sans">Helvetica / Arial</option>
                  <option value="serif">Georgia / Times</option>
                  <option value="mono">Monospace</option>
                </select>
              </label>
            </div>
            {slider('fontSize', 'Font size', 9, 20, 0.5)}
            {slider('pointSize', 'Point size', 3, 20, 1)}
            {slider('pointOpacity', 'Point opacity', 0.2, 1, 0.05)}
            <div className="grid cols-2" style={{ gap: 6 }}>
              {([['showGrid', 'Gridlines'], ['showTitle', 'Title'], ['showSubtitle', 'Subtitle (n, filters, QC)'], ['boxFill', 'Filled boxes']] as const).map(([k, t]) => (
                <label key={k} className="check small"><input type="checkbox" checked={value[k]} onChange={(e) => set({ [k]: e.target.checked } as Partial<ChartStyle>)} /> {t}</label>
              ))}
            </div>
            <p className="small muted" style={{ margin: 0 }}>Styles change appearance only. QC flags always keep their own shapes (▲ ◇).</p>
            <button className="btn ghost sm" onClick={() => onChange({ ...STYLE_PRESETS.glass.style })}><RotateCcw size={13} /> Reset to default</button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

// ---------------------------------------------------------------- axis bounds

export interface Bounds {
  xMin: number | null
  xMax: number | null
  yMin: number | null
  yMax: number | null
}

export function AxisBoundsEditor({ value, onChange, showX }: { value: Bounds; onChange: (b: Bounds) => void; showX: boolean }) {
  const [draft, setDraft] = useState<Record<keyof Bounds, string>>({ xMin: '', xMax: '', yMin: '', yMax: '' })
  const [open, setOpen] = useState(false)
  const active = Object.values(value).some((v) => v !== null)
  const parse = (s: string) => (s.trim() === '' ? null : Number(s))
  const parsed = { xMin: parse(draft.xMin), xMax: parse(draft.xMax), yMin: parse(draft.yMin), yMax: parse(draft.yMax) }
  const invalid =
    Object.values(parsed).some((v) => v !== null && !Number.isFinite(v)) ||
    (parsed.xMin !== null && parsed.xMax !== null && parsed.xMin >= parsed.xMax) ||
    (parsed.yMin !== null && parsed.yMax !== null && parsed.yMin >= parsed.yMax)
  const field = (k: keyof Bounds, text: string) => (
    <label className="field" style={{ fontWeight: 500 }}>
      {text}
      <input className="input" style={{ height: 30 }} inputMode="decimal" placeholder="auto" value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} aria-label={text} />
    </label>
  )
  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setDraft({ xMin: value.xMin?.toString() ?? '', xMax: value.xMax?.toString() ?? '', yMin: value.yMin?.toString() ?? '', yMax: value.yMax?.toString() ?? '' })
      }}
    >
      <Popover.Trigger asChild>
        <button className="btn sm" style={active ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined} data-testid="axis-bounds">
          <Ruler size={14} /> Axes{active ? ' (fixed)' : ''}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover" align="end" sideOffset={8} style={{ width: 300 }}>
          <div className="stack" style={{ gap: 10 }}>
            <strong>Axis bounds</strong>
            {showX && <div className="grid cols-2" style={{ gap: 8 }}>{field('xMin', 'X min')}{field('xMax', 'X max')}</div>}
            <div className="grid cols-2" style={{ gap: 8 }}>{field('yMin', 'Y min')}{field('yMax', 'Y max')}</div>
            <p className="small muted" style={{ margin: 0 }}>Points outside fixed bounds are not drawn and are counted below the chart. Statistics always use every selected observation.</p>
            <div className="row">
              <button className="btn ghost sm" onClick={() => { onChange({ xMin: null, xMax: null, yMin: null, yMax: null }); setOpen(false) }}>Automatic</button>
              <span className="spacer" />
              <button className="btn primary sm" disabled={invalid} onClick={() => { onChange(parsed); setOpen(false) }}>Apply</button>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
