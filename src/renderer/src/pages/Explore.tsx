import { useEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { BarChart3, BookmarkPlus, Download, FlaskConical, GitCompareArrows, Layers, ScatterChart as ScatterIcon, Table2, Upload, MousePointerSquareDashed, AlertTriangle, Info, X, Columns3, Calculator, Sparkles } from 'lucide-react'
import type { VariableInfo } from '@core/types'
import { normalizeChart } from '@core/chartStyle'
import { suggestViewName } from '@core/naming'
import { distributionData, scatterData } from '@core/chartData'
import { QUARTILE_CONVENTION, type Summary } from '@core/stats'
import { describeFilter, countsFor, observationsFor } from '@core/selection'
import { formatNumber } from '@core/values'
import { call } from '../api'
import { useStore, errorText } from '../store'
import { useSelection, useVar, useSpec } from '../lib/selection'
import { label, plural, qcPolicyText, STATUS_TEXT, INTERP_TEXT } from '../lib/format'
import { EChart, type EChartHandle } from '../components/EChart'
import { distributionOption, scatterOption, type FullChart } from '../components/chartOptions'
import { AxisBoundsEditor, StyleEditor } from '../components/ChartControls'
import { DistributionStats, ScatterStats } from '../components/StatsPanel'
import { FilterBar, MeasurePicker, QcPolicyPicker, VisitPicker, VariableList } from '../components/Pickers'
import { DataTable } from '../components/DataTable'
import * as Popover from '@radix-ui/react-popover'

export function useScheme() {
  const [dark, setDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const m = matchMedia('(prefers-color-scheme: dark)')
    const on = () => setDark(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return dark
}

export function Explore() {
  const snapshot = useStore((s) => s.snapshot)!
  const chart = useStore((s) => s.chart)
  const setChart = useStore((s) => s.setChart)
  const sel = useSelection()!
  const measures = useMemo(() => snapshot.variables.filter((v) => v.role === 'measure'), [snapshot])
  const numeric = useMemo(() => measures.filter((v) => v.kind === 'numeric' || v.kind === 'mixed'), [measures])
  const categorical = useMemo(() => measures.filter((v) => v.kind === 'categorical' || (v.categories.length > 0 && v.categories.length <= 12 && v.counts.number === 0)), [measures])
  const measure = useVar(chart.measureKey)
  const compare = useVar(chart.compareKey)
  const group = useVar(chart.groupKey)
  const [saveOpen, setSaveOpen] = useState(false)
  const baselineOnly = snapshot.visits.length === 1 && /baseline/i.test(snapshot.visits[0].name)

  return (
    <>
      <header className="topbar drag">
        <div>
          <h2>Explore data</h2>
          <div className="subtitle">
            {plural(sel.participantIds.length, 'participant')} selected · {baselineOnly ? 'Baseline only' : `${snapshot.visits.length} visits`}
          </div>
        </div>
        <span className="spacer" />
        <div className="row no-drag">
          <span className="badge outline" title="Descriptive exploration only; no hypothesis tests are run.">Exploratory · descriptive</span>
          <button className="btn" onClick={() => setSaveOpen(true)} data-testid="save-view">
            <BookmarkPlus size={15} /> Save view
          </button>
          <button className="btn primary" onClick={() => useStore.getState().setPage('export')}>
            <Upload size={15} /> Export selection
          </button>
        </div>
      </header>
      <div className="content page-fade">
        <div className="picker-row">
          <VisitPicker />
          <MeasurePicker icon={<FlaskConical size={16} />} k="Measure" value={chart.measureKey} vars={numeric} onChange={(k) => setChart({ measureKey: k })} testId="measure-picker" />
          {chart.type === 'scatter' && (
            <MeasurePicker icon={<GitCompareArrows size={16} />} k="Compare with" value={chart.compareKey} vars={numeric} onChange={(k) => setChart({ compareKey: k })} testId="compare-picker" />
          )}
          {chart.type === 'distribution' && (
            <MeasurePicker icon={<Layers size={16} />} k="Group by" value={chart.groupKey} vars={categorical} onChange={(k) => setChart({ groupKey: k })} none="No grouping" testId="group-picker" />
          )}
          <QcPolicyPicker />
        </div>
        <FilterBar />
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="seg" role="group" aria-label="View">
            <button aria-pressed={chart.type === 'distribution'} onClick={() => setChart({ type: 'distribution' })}><BarChart3 size={14} /> Distribution</button>
            <button aria-pressed={chart.type === 'scatter'} onClick={() => setChart({ type: 'scatter' })}><ScatterIcon size={14} /> Two measures</button>
            <button aria-pressed={chart.type === 'table'} onClick={() => setChart({ type: 'table' })}><Table2 size={14} /> Table</button>
          </div>
        </div>
        {chart.type === 'distribution' && (measure ? <DistributionView measure={measure} group={group} /> : <NoMeasure />)}
        {chart.type === 'scatter' && (measure && compare ? <ScatterView x={compare} y={measure} /> : <NoMeasure two />)}
        {chart.type === 'table' && <TableView />}
      </div>
      <SaveViewDialog open={saveOpen} onOpenChange={setSaveOpen} />
    </>
  )
}

function NoMeasure({ two }: { two?: boolean }) {
  return (
    <div className="paper empty">
      <div className="ic"><FlaskConical /></div>
      <h3>Choose {two ? 'two measures' : 'a measure'}</h3>
      <p>Use the pickers above, or press <span className="kbd">⌘K</span> / <span className="kbd">Ctrl K</span> to search all measurements.</p>
    </div>
  )
}

function contextLine(sel: ReturnType<typeof useSelection>, qc: string[]) {
  const s = sel!
  const f = describeFilter(s.ctx, (useStore.getState().filter))
  return `n = ${s.participantIds.length} participants · ${f === 'All rows' ? 'no cohort filter' : f} · QC: ${qcPolicyText(qc as any)}`
}

export function useFullChart(): FullChart {
  const chart = useStore((s) => s.chart)
  return useMemo(() => normalizeChart(chart), [chart])
}

function ChartToolbar({ chartRef, name, brush, setBrush, showX }: { chartRef: React.RefObject<EChartHandle | null>; name: string; brush?: boolean; setBrush?: (b: boolean) => void; showX: boolean }) {
  const toast = useStore((s) => s.toast)
  const chart = useFullChart()
  const setChart = useStore((s) => s.setChart)
  const statsOpen = useStore((s) => s.statsOpen)
  const setStatsOpen = useStore((s) => s.setStatsOpen)
  const save = async (format: 'svg' | 'png') => {
    try {
      const data = format === 'svg' ? chartRef.current!.svg() : await chartRef.current!.png(2)
      const r = await call<{ fileName: string } | null>('export:chart', { format, data, suggestedName: name })
      if (r) toast('success', `Chart saved as ${r.fileName}`)
    } catch (e) {
      toast('error', errorText(e))
    }
  }
  return (
    <div className="row wrap">
      {setBrush && (
        <button className="btn sm" aria-pressed={brush} onClick={() => setBrush(!brush)} title="Drag a rectangle to highlight participants in the table" style={brush ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}>
          <MousePointerSquareDashed size={14} /> Select area
        </button>
      )}
      <AxisBoundsEditor showX={showX} value={{ xMin: chart.xMin, xMax: chart.xMax, yMin: chart.yMin, yMax: chart.yMax }} onChange={(b) => setChart(b)} />
      <StyleEditor value={chart.style} onChange={(style) => setChart({ style })} />
      <button
        className="btn sm"
        onClick={() => setStatsOpen(!statsOpen)}
        aria-pressed={statsOpen}
        style={statsOpen ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
        data-testid="analyze"
        title="Best-fit lines, confidence intervals and tests — computed only when you ask"
      >
        <Calculator size={14} /> Analyze
      </button>
      <Popover.Root>
        <Popover.Trigger asChild>
          <button className="btn sm" aria-label="Download chart"><Download size={14} /> Download</button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="popover" align="end" sideOffset={8} style={{ width: 250 }}>
            <div className="list">
              <Popover.Close asChild>
                <button className="list-item" onClick={() => save('svg')}>
                  <div><div className="t">SVG (vector)</div><div className="s">Best for papers and slides; edit in Illustrator or Inkscape</div></div>
                </button>
              </Popover.Close>
              <Popover.Close asChild>
                <button className="list-item" onClick={() => save('png')}>
                  <div><div className="t">PNG (2× resolution)</div><div className="s">For documents, email and posters</div></div>
                </button>
              </Popover.Close>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}

function ScaleToggle({ value, onChange, axis, disabled }: { value: 'linear' | 'log'; onChange: (v: 'linear' | 'log') => void; axis: string; disabled?: string | null }) {
  return (
    <div className="seg" role="group" aria-label={`${axis} axis scale`} title={disabled ?? undefined}>
      <button aria-pressed={value === 'linear'} onClick={() => onChange('linear')}>{axis} linear</button>
      <button aria-pressed={value === 'log'} onClick={() => !disabled && onChange('log')} disabled={!!disabled}>log</button>
    </div>
  )
}

const CHART_HEIGHT = 460

function DistributionView({ measure, group }: { measure: VariableInfo; group: VariableInfo | null }) {
  const sel = useSelection()!
  const snapshot = useStore((s) => s.snapshot)!
  const chart = useFullChart()
  const setChart = useStore((s) => s.setChart)
  const highlight = useStore((s) => s.highlight)
  const qc = useStore((s) => s.qcExclude)
  const inspect = useStore((s) => s.inspect)
  const statsOpen = useStore((s) => s.statsOpen)
  const dark = useScheme()
  const ref = useRef<EChartHandle>(null)
  const scale = chart.yScale
  const data = useMemo(() => distributionData(sel, measure.index, group?.index ?? null, scale), [sel, measure, group, scale])
  const hl = useMemo(() => new Set(highlight), [highlight])
  const built = useMemo(() => distributionOption(data, measure, group, chart, { dark, highlight: hl, subtitle: contextLine(sel, qc) }), [data, measure, group, chart, dark, hl, sel, qc])

  return (
    <div className="stack">
      <div className="split">
        <div className="paper chart-card">
          <div className="row wrap" style={{ marginBottom: 6 }}>
            <ScaleToggle axis="Y" value={scale} onChange={(v) => setChart({ yScale: v })} disabled={data.logValid ? null : data.logReason} />
            <span className="spacer" />
            <ChartToolbar chartRef={ref} name={`${label(measure)} distribution`} showX={false} />
          </div>
          {data.groups.length === 0 ? (
            <div className="empty" style={{ height: CHART_HEIGHT }}><h3>No matching data</h3><p>No rows match the current cohort filters.</p></div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <EChart ref={ref} option={built.option} height={CHART_HEIGHT} minWidth={built.minWidth} ariaLabel={`Distribution of ${label(measure)}`} onPointClick={(d) => d?.row !== undefined && inspect({ row: d.row, variable: measure.index })} />
            </div>
          )}
          <ChartNotices
            items={[
              data.totals.missing ? `${data.totals.missing} row(s) have no value (missing — not zero).` : null,
              data.totals.censored ? `${data.totals.censored} censored value(s) (e.g. “<x”) are not plotted and not substituted.` : null,
              data.totals.nonNumeric ? `${data.totals.nonNumeric} non-numeric entr${data.totals.nonNumeric === 1 ? 'y is' : 'ies are'} not plotted.` : null,
              data.totals.qcExcluded ? `${data.totals.qcExcluded} observation(s) excluded by the QC policy.` : null,
              ...data.groups.filter((g) => g.nonPositiveHidden.length).map((g) => `Log axis: ${g.nonPositiveHidden.length} non-positive value(s) in “${g.label}” hidden from the plot (${g.nonPositiveHidden.map((p) => `${p.participantId}=${formatNumber(p.value)}`).join(', ')}); its box is hidden but its summary uses all values.`),
              ...built.notices
            ]}
          />
          <Legend />
        </div>
        <div className="stack">
          <MeasureContext v={measure} />
          <SummaryCard groups={data.groups.map((g) => ({ label: g.label, s: g.summary }))} />
        </div>
      </div>
      {statsOpen && (
        <DistributionStats data={data} measure={measure} group={group} chart={chart} snapshot={snapshot} onChange={(a) => { setChart({ analysis: { ...chart.analysis, ...a } }); if (a.requested === false) useStore.getState().setStatsOpen(false) }} />
      )}
      <div className="paper card">
        <div className="card-head"><h3>Selected observations</h3><span className="muted small">Same rows as the chart and summary</span></div>
        <DataTable sel={sel} columns={[measure, ...(group ? [group] : [])]} testId="observations-table" />
      </div>
    </div>
  )
}

function ScatterView({ x, y }: { x: VariableInfo; y: VariableInfo }) {
  const sel = useSelection()!
  const snapshot = useStore((s) => s.snapshot)!
  const chart = useFullChart()
  const setChart = useStore((s) => s.setChart)
  const highlight = useStore((s) => s.highlight)
  const setHighlight = useStore((s) => s.setHighlight)
  const qc = useStore((s) => s.qcExclude)
  const inspect = useStore((s) => s.inspect)
  const statsOpen = useStore((s) => s.statsOpen)
  const dark = useScheme()
  const ref = useRef<EChartHandle>(null)
  const [brush, setBrushState] = useState(false)
  const data = useMemo(() => scatterData(sel, x.index, y.index, chart.xScale, chart.yScale), [sel, x, y, chart.xScale, chart.yScale])
  const hl = useMemo(() => new Set(highlight), [highlight])
  const built = useMemo(() => scatterOption(data, x, y, chart, { dark, highlight: hl, subtitle: contextLine(sel, qc) }), [data, x, y, chart, dark, hl, sel, qc])
  const drawn = useMemo(() => (built.option as any).series[0].data as { row: number }[], [built])

  const pairedRows = data.points.map((p) => p.row)
  return (
    <div className="stack">
      <div className="split">
        <div className="paper chart-card">
          <div className="row wrap" style={{ marginBottom: 6 }}>
            <ScaleToggle axis="X" value={chart.xScale} onChange={(v) => setChart({ xScale: v })} disabled={data.logValidX ? null : 'No positive values'} />
            <ScaleToggle axis="Y" value={chart.yScale} onChange={(v) => setChart({ yScale: v })} disabled={data.logValidY ? null : 'No positive values'} />
            <span className="spacer" />
            <ChartToolbar chartRef={ref} showX name={`${label(y)} vs ${label(x)}`} brush={brush} setBrush={(b) => { setBrushState(b); ref.current?.setBrush(b); if (!b) setHighlight([]) }} />
          </div>
          {data.points.length === 0 && data.hidden.length === 0 ? (
            <div className="empty" style={{ height: CHART_HEIGHT }}><h3>No complete pairs</h3><p>No selected participant has numeric values for both measures.</p></div>
          ) : (
            <EChart
              ref={ref}
              option={built.option}
              height={CHART_HEIGHT}
              ariaLabel={`Scatterplot of ${label(y)} against ${label(x)}`}
              onPointClick={(d) => d?.row !== undefined && inspect({ row: d.row, variable: y.index })}
              onBrush={(idx) => setHighlight(idx.map((i) => drawn[i % 1e6]?.row).filter((r) => r !== undefined))}
            />
          )}
          <ChartNotices
            items={[
              data.missingX + data.missingY + data.missingBoth ? `${data.missingX + data.missingY + data.missingBoth} participant row(s) lack a value for one or both measures (x only: ${data.missingX}, y only: ${data.missingY}, both: ${data.missingBoth}).` : null,
              data.unevaluable ? `${data.unevaluable} pair(s) include a censored or non-numeric value and are not plotted.` : null,
              data.qcExcluded ? `${data.qcExcluded} pair(s) include an observation excluded by the QC policy.` : null,
              data.hidden.length ? `Log axis: ${data.hidden.length} pair(s) with non-positive values hidden (${data.hidden.map((h) => h.participantId).join(', ')}).` : null,
              ...built.notices
            ]}
          />
          <Legend />
        </div>
        <div className="stack">
          <MeasureContext v={y} title="Y measure" />
          <MeasureContext v={x} title="X measure" compact />
        </div>
      </div>
      {statsOpen && (
        <ScatterStats data={data} x={x} y={y} chart={chart} snapshot={snapshot} onChange={(a) => { setChart({ analysis: { ...chart.analysis, ...a } }); if (a.requested === false) useStore.getState().setStatsOpen(false) }} onHighlight={setHighlight} />
      )}
      <div className="paper card">
        <div className="card-head">
          <h3>Paired observations</h3>
          <span className="muted small">{data.points.length} complete pairs{highlight.length > 1 ? ` · ${highlight.length} highlighted` : ''}</span>
          <span className="spacer" />
          {highlight.length > 1 && <button className="btn sm" onClick={() => setHighlight([])}>Clear highlight</button>}
        </div>
        <DataTable sel={sel} columns={[x, y]} rows={highlight.length > 1 ? pairedRows.filter((r) => hl.has(r)) : sel.rows} testId="paired-table" />
      </div>
    </div>
  )
}

function TableView() {
  const snapshot = useStore((s) => s.snapshot)!
  const chart = useStore((s) => s.chart)
  const setChart = useStore((s) => s.setChart)
  const sel = useSelection()!
  const measures = snapshot.variables.filter((v) => v.role === 'measure')
  const keys = chart.tableColumns.length ? chart.tableColumns : [chart.measureKey, chart.compareKey, chart.groupKey].filter((k): k is string => !!k)
  const cols = keys.map((k) => snapshot.variables.find((v) => v.key === k)).filter((v): v is VariableInfo => !!v)
  const [open, setOpen] = useState(false)
  return (
    <div className="paper card">
      <div className="card-head">
        <h3>Selected data</h3>
        <span className="muted small">{cols.length} column(s) · {sel.rows.length} rows</span>
        <span className="spacer" />
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild>
            <button className="btn sm"><Columns3 size={14} /> Add column</button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content className="popover" align="end" sideOffset={8}>
              <VariableList vars={measures.filter((m) => !keys.includes(m.key))} value={null} onPick={(v) => { if (v) setChart({ tableColumns: [...keys, v.key] }); setOpen(false) }} />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        {keys.length > 0 && <button className="btn ghost sm" onClick={() => setChart({ tableColumns: [] })}>Reset</button>}
      </div>
      <div className="row wrap" style={{ marginBottom: 10 }}>
        {cols.map((c) => (
          <span key={c.key} className="badge outline">
            {label(c)}
            <button className="btn ghost sm icon" style={{ height: 18, width: 18 }} aria-label={`Remove ${label(c)}`} onClick={() => setChart({ tableColumns: keys.filter((k) => k !== c.key) })}><X size={11} /></button>
          </span>
        ))}
      </div>
      <DataTable sel={sel} columns={cols} maxHeight={560} testId="selected-table" />
    </div>
  )
}

function ChartNotices({ items }: { items: (string | null)[] }) {
  const list = items.filter(Boolean) as string[]
  if (!list.length) return null
  return (
    <ul className="small muted" style={{ margin: '8px 0 0', paddingLeft: 18 }} aria-label="Chart notes">
      {list.map((t) => <li key={t}>{t}</li>)}
    </ul>
  )
}

function Legend() {
  return (
    <div className="legend-row" style={{ marginTop: 8 }}>
      <span className="sym"><span className="sym-circle" /> Observation</span>
      <span className="sym"><span className="sym-tri" /> QC-flagged (included)</span>
      <span className="sym"><span className="sym-dia" /> Unresolved formatting</span>
      <span className="muted">Shapes, not only colours, distinguish flags.</span>
    </div>
  )
}

const fmt = (n: number | null) => (n === null || n === undefined ? '—' : formatNumber(n))

function SummaryCard({ groups }: { groups: { label: string; s: Summary }[] }) {
  return (
    <div className="paper card">
      <h3>Descriptive summary</h3>
      {groups.length === 0 && <p className="muted small">No rows selected.</p>}
      {groups.map((g) => (
        <div key={g.label} style={{ marginBottom: 10 }}>
          {groups.length > 1 && <div className="group-label" style={{ padding: '4px 0' }}>{g.label}</div>}
          <div className="kv small" data-testid="summary">
            <div className="k">n (numeric)</div><div className="num"><strong>{g.s.n}</strong></div>
            <div className="k">Mean (SD)</div><div className="num">{fmt(g.s.mean)} ({g.s.sd === null ? 'SD n/a, n<2' : fmt(g.s.sd)})</div>
            <div className="k">Median [Q1, Q3]</div><div className="num">{fmt(g.s.median)} [{fmt(g.s.q1)}, {fmt(g.s.q3)}]</div>
            <div className="k">Min – max</div><div className="num">{fmt(g.s.min)} – {fmt(g.s.max)}</div>
            <div className="k">Not analysed</div><div>{g.s.missing} missing · {g.s.censored} censored · {g.s.nonNumeric} non-numeric</div>
          </div>
        </div>
      ))}
      <p className="small muted" style={{ margin: 0 }}>{QUARTILE_CONVENTION}</p>
    </div>
  )
}

function MeasureContext({ v, title, compact }: { v: VariableInfo; title?: string; compact?: boolean }) {
  const sel = useSelection()!
  const counts = countsFor(sel, v.index)
  const flagged = observationsFor(sel, v.index).filter((o) => o.flags.some((f) => f.category)).length
  const rowsF = [
    ['Definition', v.meta.definition],
    ['Units', v.meta.unit],
    ['Specimen', v.meta.specimen],
    ['Score type', v.meta.scoreType],
    ...(compact ? [] : ([['Assay', v.meta.assay], ['Area', v.meta.area]] as const))
  ] as const
  return (
    <div className="paper card">
      <div className="card-head">
        <h3>{title ?? 'Measurement context'}</h3>
        <span className="spacer" />
        <button className="btn ghost sm" onClick={() => { useStore.setState({ page: 'measurements' }); sessionStorage.setItem('bari.focusVar', v.key) }}>Edit</button>
      </div>
      <div className="small muted" style={{ marginBottom: 8 }} title={v.header}>
        {v.header} · column {v.letter}
      </div>
      <div className="kv small">
        {rowsF.map(([k, f]) => (
          <MetaRow key={k} k={k} f={f} />
        ))}
        <div className="k">Source</div>
        <div>{v.attribution ? <>{v.attribution.source ?? v.attribution.mode.replace(/_/g, ' ')} <span className="badge" title={v.attribution.note}>{INTERP_TEXT[v.attribution.status]}</span></> : <span className="muted">Not available</span>}</div>
      </div>
      {flagged > 0 && (
        <div className="callout" style={{ marginTop: 10 }}>
          <AlertTriangle size={16} />
          <p>{flagged} selected observation(s) carry QC or formatting flags{counts.qcExcluded ? `; ${counts.qcExcluded} excluded by policy` : '; all included and marked'}.</p>
        </div>
      )}
      {v.aliases.length > 1 && (
        <div className="small" style={{ marginTop: 10 }}>
          <span className="muted">Aliases: </span>
          {v.aliases.map((a) => `${a.text}${a.source ? ` (${a.source})` : ''}`).join(' · ')}
        </div>
      )}
    </div>
  )
}

function MetaRow({ k, f }: { k: string; f: VariableInfo['meta']['unit'] }) {
  return (
    <>
      <div className="k">{k}</div>
      <div title={f.provenance}>
        {f.value ? <span>{f.value} </span> : null}
        <span className={`badge ${f.status === 'confirmed' ? 'ok' : f.status === 'tentative' ? 'warn' : ''}`}>{f.value ? STATUS_TEXT[f.status] : f.status === 'unknown' ? 'Unknown' : STATUS_TEXT[f.status]}</span>
      </div>
    </>
  )
}

function SaveViewDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (b: boolean) => void }) {
  const spec = useSpec()
  const chart = useStore((s) => s.chart)
  const snapshot = useStore((s) => s.snapshot)!
  const asOf = useStore((s) => s.asOf)
  const toast = useStore((s) => s.toast)
  const sel = useSelection()!
  const filter = useStore((s) => s.filter)
  const qc = useStore((s) => s.qcExclude)
  const visitIds = useStore((s) => s.visitIds)
  const suggested = useMemo(() => suggestViewName(snapshot, chart, filter, qc, visitIds), [snapshot, chart, filter, qc, visitIds])
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  useEffect(() => {
    if (open) setName(suggested)
  }, [open, suggested])
  const save = async () => {
    try {
      await call('views:save', {
        name,
        description: desc || null,
        metadataVersion: asOf ?? snapshot.metadataVersion,
        spec: { schema: 1, selection: spec, chart, transformations: [], missingDataPolicy: 'Missing values are excluded from summaries and plots and counted separately; never imputed.' }
      })
      toast('success', `Saved view “${name}”.`)
      onOpenChange(false)
      setName('')
      setDesc('')
    } catch (e) {
      toast('error', errorText(e))
    }
  }
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog narrow" aria-describedby={undefined}>
          <div className="dialog-head">
            <Dialog.Title asChild><h2 style={{ flex: 1 }}>Save view</h2></Dialog.Title>
            <Dialog.Close className="btn ghost icon" aria-label="Close"><X size={16} /></Dialog.Close>
          </div>
          <div className="dialog-body stack">
            <label className="field">
              Name
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} onKeyDown={(e) => e.key === 'Enter' && name.trim() && save()} autoFocus maxLength={200} data-testid="view-name" />
            </label>
            <div className="row small muted" style={{ marginTop: -6 }}>
              <Sparkles size={13} /> Suggested from your selection — press Enter to save, or type your own.
              {name !== suggested && <button className="btn ghost sm" onClick={() => setName(suggested)}>Use suggestion</button>}
            </div>
            <label className="field">Notes (optional)<textarea className="input" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
            <div className="callout neutral">
              <Info size={16} />
              <p className="small">
                Pinned to dataset v{snapshot.versionNumber} and metadata rev. {asOf ?? snapshot.metadataVersion}. Records the cohort rule ({describeFilter(sel.ctx, spec!.filter)}), visits, QC policy, chart and variables. Reopening reproduces it exactly; it never silently moves to a newer import.
              </p>
            </div>
          </div>
          <div className="dialog-foot">
            <span className="spacer" />
            <button className="btn ghost" onClick={() => onOpenChange(false)}>Cancel</button>
            <button className="btn primary" disabled={!name.trim()} onClick={save} data-testid="confirm-save-view">Save view</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
