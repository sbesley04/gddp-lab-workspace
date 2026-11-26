// Reusable chart views. Explore and board cards draw through the same builders, so a chart on a board and the
// same chart in Explore show the same rows, notices and options. ECharts options themselves live in chartOptions.ts.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Calculator, Loader2 } from 'lucide-react'
import type { ChartConfig, DatasetSnapshot, FilterGroup, QcCategory, VariableInfo } from '@core/types'
import { normalizeChart } from '@core/chartStyle'
import { describeFilter, getObservation, type SelectionResult } from '@core/selection'
import { distributionData, scatterData, type DistributionData, type ScatterData } from '@core/chartData'
import { transformedVariable } from '@core/transforms'
import { pcaPlot } from '@core/pca'
import { correlationFromSelection, heatmapData } from '@core/matrix'
import { displayValue, formatNumber } from '@core/values'
import { label, qcPolicyText } from '../lib/format'
import { EChart, type EChartHandle } from './EChart'
import { correlationOption, distributionOption, heatmapOption, histogramOption, pcaOption, scatterOption, type Built, type FullChart } from './chartOptions'

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

/** The context line under every chart title: n, cohort rule and QC policy. */
export function selectionSubtitle(sel: SelectionResult, filter: FilterGroup, qc: QcCategory[]): string {
  const f = describeFilter(sel.ctx, filter)
  // Rows and participants differ as soon as a participant has more than one visit in the selection: say both.
  const n = sel.rows.length === sel.participantIds.length ? `n = ${sel.participantIds.length} participants` : `n = ${sel.rows.length} observations from ${sel.participantIds.length} participants`
  return `${n} · ${f === 'All rows' ? 'no cohort filter' : f} · QC: ${qcPolicyText(qc)}`
}

export function ChartNotices({ items }: { items: (string | null)[] }) {
  const list = items.filter(Boolean) as string[]
  if (!list.length) return null
  return (
    <ul className="small muted" style={{ margin: '8px 0 0', paddingLeft: 18 }} aria-label="Chart notes">
      {list.map((t) => <li key={t}>{t}</li>)}
    </ul>
  )
}

interface DrawCtx {
  dark: boolean
  highlight?: Set<number>
  subtitle: string
}
const ctxOf = (c: DrawCtx, colorVar: VariableInfo | null | undefined) => ({ dark: c.dark, highlight: c.highlight ?? new Set<number>(), subtitle: c.subtitle, colorTitle: colorVar ? label(colorVar) : null })

// ---------------------------------------------------------------- distribution

export interface DistributionModel {
  data: DistributionData
  /** The measure as drawn (label carries the display transform). */
  shown: VariableInfo
  scale: 'linear' | 'log'
  hist: boolean
}

export function distributionModel(sel: SelectionResult, measure: VariableInfo, group: VariableInfo | null, colorVar: VariableInfo | null, chart: FullChart): DistributionModel {
  const hist = chart.distStyle === 'histogram'
  // A histogram has no log axis; it bins the (optionally transformed) values directly.
  const scale = hist ? 'linear' : chart.yScale
  const data = distributionData(sel, measure.index, group?.index ?? null, scale, { transform: chart.transformMeasure, colorVar: hist ? null : colorVar?.index ?? null })
  return { data, shown: transformedVariable(measure, chart.transformMeasure), scale, hist }
}

export function distributionChart(m: DistributionModel, group: VariableInfo | null, colorVar: VariableInfo | null, chart: FullChart, ctx: DrawCtx): Built {
  return (m.hist ? histogramOption : distributionOption)(m.data, m.shown, group, chart, ctxOf(ctx, colorVar))
}

export function distributionNotices(data: DistributionData): (string | null)[] {
  return [
    data.totals.missing ? `${data.totals.missing} row(s) have no value (missing — not zero).` : null,
    data.totals.censored ? `${data.totals.censored} censored value(s) (e.g. “<x”) are not plotted and not substituted.` : null,
    data.totals.nonNumeric ? `${data.totals.nonNumeric} non-numeric entr${data.totals.nonNumeric === 1 ? 'y is' : 'ies are'} not plotted.` : null,
    data.totals.qcExcluded ? `${data.totals.qcExcluded} observation(s) excluded by the QC policy.` : null,
    ...data.groups.filter((g) => g.nonPositiveHidden.length).map((g) => `Log axis: ${g.nonPositiveHidden.length} non-positive value(s) in “${g.label}” hidden from the plot (${g.nonPositiveHidden.map((p) => `${p.participantId}=${formatNumber(p.value)}`).join(', ')}); its box is hidden but its summary uses all values.`)
  ]
}

// ---------------------------------------------------------------- scatter

export interface ScatterModel {
  data: ScatterData
  xs: VariableInfo
  ys: VariableInfo
}

export function scatterModel(sel: SelectionResult, x: VariableInfo, y: VariableInfo, colorVar: VariableInfo | null, chart: FullChart): ScatterModel {
  const data = scatterData(sel, x.index, y.index, chart.xScale, chart.yScale, { transformX: chart.transformCompare, transformY: chart.transformMeasure, colorVar: colorVar?.index ?? null })
  return { data, xs: transformedVariable(x, chart.transformCompare), ys: transformedVariable(y, chart.transformMeasure) }
}

export function scatterChart(m: ScatterModel, colorVar: VariableInfo | null, chart: FullChart, ctx: DrawCtx): Built {
  return scatterOption(m.data, m.xs, m.ys, chart, ctxOf(ctx, colorVar))
}

export function scatterNotices(data: ScatterData): (string | null)[] {
  const missing = data.missingX + data.missingY + data.missingBoth
  return [
    missing ? `${missing} participant row(s) lack a value for one or both measures (x only: ${data.missingX}, y only: ${data.missingY}, both: ${data.missingBoth}).` : null,
    data.unevaluable ? `${data.unevaluable} pair(s) include a censored or non-numeric value and are not plotted.` : null,
    data.qcExcluded ? `${data.qcExcluded} pair(s) include an observation excluded by the QC policy.` : null,
    data.hidden.length ? `Log axis: ${data.hidden.length} pair(s) with non-positive values hidden (${data.hidden.map((h) => h.participantId).join(', ')}).` : null
  ]
}

// ---------------------------------------------------------------- any chart from a spec (board cards)

export type CardBuild =
  | { kind: 'chart'; built: Built; notices: string[]; aria: string }
  | { kind: 'note'; text: string }
  | { kind: 'table'; cols: VariableInfo[] }
  /** PCA waits for Compute. */
  | { kind: 'compute' }

/**
 * Builds a whole chart from a chart config and a selection, as a board card draws it.
 * `pcaReady` false returns { kind: 'compute' } for PCA, so it runs only when the user asks.
 */
export function buildCardChart(snapshot: DatasetSnapshot, sel: SelectionResult, config: ChartConfig, ctx: DrawCtx & { pcaReady?: boolean }): CardBuild {
  const chart = normalizeChart(config)
  const byKey = new Map(snapshot.variables.map((v) => [v.key, v]))
  const need = (k: string | null | undefined, what: string): VariableInfo | string => (k ? byKey.get(k) ?? `The ${what} (${k}) is not in this dataset version.` : `No ${what} chosen.`)
  const colorVar = chart.colorKey ? byKey.get(chart.colorKey) ?? null : null
  const finish = (built: Built, extra: (string | null)[], aria: string): CardBuild => ({ kind: 'chart', built, notices: [...extra, ...built.notices].filter((x): x is string => !!x), aria })

  if (chart.type === 'distribution') {
    const m = need(chart.measureKey, 'measure')
    if (typeof m === 'string') return { kind: 'note', text: m }
    const g = chart.groupKey ? byKey.get(chart.groupKey) ?? null : null
    const model = distributionModel(sel, m, g, colorVar, chart)
    if (model.data.groups.length === 0) return { kind: 'note', text: 'No rows match the cohort.' }
    return finish(distributionChart(model, g, colorVar, chart, ctx), distributionNotices(model.data), `${model.hist ? 'Histogram' : 'Distribution'} of ${label(m)}`)
  }
  if (chart.type === 'scatter') {
    const y = need(chart.measureKey, 'measure')
    const x = need(chart.compareKey, 'comparison measure')
    if (typeof y === 'string') return { kind: 'note', text: y }
    if (typeof x === 'string') return { kind: 'note', text: x }
    const model = scatterModel(sel, x, y, colorVar, chart)
    if (model.data.points.length === 0 && model.data.hidden.length === 0) return { kind: 'note', text: 'No selected row has numeric values for both measures.' }
    return finish(scatterChart(model, colorVar, chart, ctx), scatterNotices(model.data), `Scatterplot of ${label(y)} against ${label(x)}`)
  }
  if (chart.type === 'correlation' || chart.type === 'heatmap' || chart.type === 'pca') {
    const vs = chart.variableSet.map((k) => byKey.get(k)).filter((v): v is VariableInfo => !!v)
    const lost = chart.variableSet.length - vs.length
    const lostNote = lost ? `${lost} variable(s) of this chart are not in this dataset version.` : null
    if (chart.type === 'correlation') {
      if (vs.length < 2) return { kind: 'note', text: 'Not enough variables in this chart.' }
      return finish(correlationOption(correlationFromSelection(sel, vs, chart.corrMethod), vs, chart, ctxOf(ctx, null)), [lostNote], 'Correlation matrix')
    }
    if (chart.type === 'heatmap') {
      if (vs.length < 1) return { kind: 'note', text: 'Not enough variables in this chart.' }
      return finish(heatmapOption(heatmapData(sel, vs, colorVar?.index ?? null), vs, chart, ctxOf(ctx, colorVar)), [lostNote], 'Participant by measure heatmap')
    }
    if (vs.length < 2) return { kind: 'note', text: 'Not enough variables in this chart.' }
    if (ctx.pcaReady === false) return { kind: 'compute' }
    const plot = pcaPlot(sel, vs, colorVar?.index ?? null)
    if (!plot.result) return { kind: 'note', text: plot.error ?? 'No PCA result.' }
    return finish(pcaOption(plot, 0, 1, chart, ctxOf(ctx, colorVar)), [lostNote, `${plot.result.n} participant(s) used; ${plot.input.dropped} of ${sel.rows.length} selected row(s) left out for a missing, censored, text or QC-excluded value.`], 'PCA scores plot')
  }
  const keys = chart.tableColumns.length ? chart.tableColumns : [chart.measureKey, chart.compareKey, chart.groupKey]
  return { kind: 'table', cols: keys.filter((k): k is string => !!k).map((k) => byKey.get(k)).filter((v): v is VariableInfo => !!v) }
}

export interface CardHandle {
  /** The drawn chart as SVG, for the board download. */
  svg: () => string | null
  /** Plain text lines, for cards that are not charts (stat cards). */
  lines?: () => string[]
}

/** The body of a chart card: the chart, its notes, or a compact table. Used by pinned and live board cards. */
export const ChartCardBody = forwardRef<CardHandle, { snapshot: DatasetSnapshot; sel: SelectionResult; build: CardBuild; width: number; name: string; header?: React.ReactNode; onCompute?: () => void }>(function ChartCardBody({ snapshot, sel, build, width, name, header, onCompute }, ref) {
  const chartRef = useRef<EChartHandle>(null)
  useImperativeHandle(ref, () => ({ svg: () => (build.kind === 'chart' ? chartRef.current?.svg() ?? null : null) }), [build])
  const notes = build.kind === 'chart' ? build.notices : []
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {header}
      {build.kind === 'chart' ? (
        <div style={{ flex: 1, minHeight: 0, overflowX: build.built.minWidth > width ? 'auto' : 'hidden', overflowY: 'hidden' }}>
          <EChart ref={chartRef} option={build.built.option} height="100%" minWidth={build.built.minWidth} ariaLabel={`${name}: ${build.aria}`} />
        </div>
      ) : build.kind === 'note' ? (
        <div className="empty small"><p>{build.text}</p></div>
      ) : build.kind === 'compute' ? (
        <div className="empty small">
          <p>PCA runs only when you ask.</p>
          <button className="btn primary sm" onClick={onCompute} data-testid="board-compute-pca"><Calculator size={14} /> Compute PCA</button>
        </div>
      ) : (
        <div className="table-wrap" style={{ flex: 1 }}>
          <table className="data">
            <thead><tr><th>Participant</th>{build.cols.map((c) => <th key={c.key}>{label(c)}</th>)}</tr></thead>
            <tbody>
              {sel.rows.map((r) => (
                <tr key={r}>
                  <td>{snapshot.rows[r].participantId}</td>
                  {build.cols.map((c) => {
                    const o = getObservation(sel.ctx, r, c.index)
                    return <td key={c.key} className="num">{o.value.k === 'missing' || o.qcExcludedBy.length ? '—' : displayValue(o.value)}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {notes.length > 0 && (
        <details className="small muted" style={{ padding: '2px 4px 0' }}>
          <summary>{notes.length} note{notes.length === 1 ? '' : 's'} on this chart</summary>
          <ChartNotices items={notes} />
        </details>
      )}
    </div>
  )
})

export function CardLoading() {
  return <div className="empty"><Loader2 className="spin" /></div>
}

/** Memoised card build for a chart config on a selection. */
export function useCardBuild(snapshot: DatasetSnapshot | null, sel: SelectionResult | null, chart: ChartConfig | null, ctx: { dark: boolean; subtitle: string; pcaReady?: boolean }): CardBuild | null {
  return useMemo(() => (snapshot && sel && chart ? buildCardChart(snapshot, sel, chart, ctx) : null), [snapshot, sel, chart, ctx.dark, ctx.subtitle, ctx.pcaReady]) // eslint-disable-line react-hooks/exhaustive-deps
}
