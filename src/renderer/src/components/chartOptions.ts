// Shared ECharts option builders used by Explore and the Compare board, so a chart looks and
// behaves the same everywhere. Styles never change what data is shown, only how it looks.
import type { EChartsCoreOption } from 'echarts/core'
import type { ChartConfig, ChartStyle, VariableInfo } from '@core/types'
import type { DistributionData, ScatterData } from '@core/chartData'
import { histogramBins } from '@core/chartData'
import type { CorrelationMatrix, HeatmapData } from '@core/matrix'
import type { PcaPlot, PcaResult } from '@core/pca'
import { FONT_STACKS } from '@core/chartStyle'
import { describe, linearFit } from '@core/analysis'
import { formatNumber } from '@core/values'
import { axisTitle, label } from '../lib/format'
import { cssVar, jitter } from './EChart'

export type FullChart = Required<ChartConfig>

export interface BuildCtx {
  dark: boolean
  highlight: Set<number>
  subtitle: string
  /** Label of the colour-by covariate, shown at the start of the legend. */
  colorTitle?: string | null
}

export interface Built {
  option: EChartsCoreOption
  notices: string[]
  /** Pixel height that keeps boxes well proportioned; width grows (and scrolls) with many groups. */
  minWidth: number
  /** Height the chart needs (matrix views grow with the number of rows); undefined = the standard chart height. */
  height?: number
}

const fmt = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : formatNumber(n))

function palette(style: ChartStyle, dark: boolean) {
  const themed = style.preset === 'glass'
  const autoText = style.background === 'white' ? '#111827' : style.background === 'black' ? '#f3f4f6' : cssVar('--text', dark ? '#eef2fa' : '#0b1220')
  const text = style.textColor ?? autoText
  const onDarkBg = style.background === 'black' || (style.background === 'transparent' && dark)
  return {
    text,
    text2: style.textColor ?? (style.background === 'transparent' ? cssVar('--text-3', '#5d6880') : onDarkBg ? '#cbd5e1' : '#4b5563'),
    grid: onDarkBg ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.09)',
    point: themed ? cssVar('--pt', style.pointColor) : style.pointColor,
    flag: themed ? cssVar('--pt-qc', style.flagColor) : style.flagColor,
    unresolved: themed ? cssVar('--pt-unresolved', style.unresolvedColor) : style.unresolvedColor,
    box: themed ? (dark ? 'rgba(148,163,184,0.75)' : 'rgba(71,85,105,0.6)') : style.boxColor,
    fit: style.fitColor,
    bg: style.background === 'white' ? '#ffffff' : style.background === 'black' ? '#0b0f17' : 'transparent',
    // Double quotes would end the SVG style attribute ECharts writes the font into, making exports malformed XML.
    font: (FONT_STACKS[style.font] ?? getComputedStyle(document.body).fontFamily).replace(/"/g, "'")
  }
}

function axis(p: ReturnType<typeof palette>, style: ChartStyle) {
  return {
    axisLine: { lineStyle: { color: p.grid } },
    axisTick: { lineStyle: { color: p.grid } },
    axisLabel: { color: p.text2, fontSize: style.fontSize - 0.5 },
    splitLine: { show: style.showGrid, lineStyle: { color: p.grid } },
    nameTextStyle: { color: p.text, fontSize: style.fontSize + 0.5, fontWeight: 600 }
  }
}

function header(title: string, subtitle: string, style: ChartStyle, p: ReturnType<typeof palette>) {
  return {
    show: style.showTitle || style.showSubtitle,
    text: style.showTitle ? title : '',
    subtext: style.showSubtitle ? subtitle : '',
    left: 8,
    top: 0,
    textStyle: { color: p.text, fontSize: style.fontSize + 3, fontWeight: 700 },
    subtextStyle: { color: p.text2, fontSize: style.fontSize - 0.5 }
  }
}

const inBounds = (v: number, min: number | null, max: number | null) => (min === null || v >= min) && (max === null || v <= max)
const clamp = (v: number | null, min: number | null, max: number | null) => (v === null ? null : Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v)))

/** Okabe–Ito palette: distinguishable under the common forms of colour-vision deficiency. */
const CATEGORY_COLORS = ['#0072B2', '#E69F00', '#009E73', '#D55E00', '#CC79A7', '#56B4E9', '#F0E442', '#7f7f7f']
const MISSING_COLOR = '#b0b7c3'

function categoryColors(categories: string[], notices: string[]): Map<string, string> {
  const named = categories.filter((c) => !c.startsWith('('))
  if (named.length > CATEGORY_COLORS.length) notices.push(`${named.length} categories: colours repeat after ${CATEGORY_COLORS.length}. Pick a covariate with fewer categories for an unambiguous legend.`)
  return new Map(categories.map((c) => [c, c.startsWith('(') ? MISSING_COLOR : CATEGORY_COLORS[named.indexOf(c) % CATEGORY_COLORS.length]]))
}

// The legend names the covariate first ("Sex:"), so an exported chart says what its colours mean.
const legendTitle = (title: string | null | undefined) => (title ? `${title}:` : null)

/** Empty series that only exist to give the legend its entries (the covariate name, then one per category). */
function legendSeries(colors: Map<string, string>, title: string | null | undefined) {
  if (!colors.size) return []
  const head = legendTitle(title)
  return [
    ...(head ? [{ type: 'scatter', name: head, data: [], silent: true, tooltip: { show: false } }] : []),
    ...[...colors].map(([name, color]) => ({ type: 'scatter', name, data: [], itemStyle: { color }, symbolSize: 10, silent: true, tooltip: { show: false } }))
  ]
}

function legendOption(colors: Map<string, string>, title: string | null | undefined, p: ReturnType<typeof palette>, style: ChartStyle) {
  const head = legendTitle(title)
  return {
    show: colors.size > 0,
    data: [...(head ? [{ name: head, icon: 'none', textStyle: { color: p.text, fontWeight: 600 } }] : []), ...colors.keys()],
    selectedMode: false,
    right: 8,
    top: 2,
    width: '55%',
    itemWidth: 10,
    itemHeight: 10,
    type: 'scroll',
    textStyle: { color: p.text2, fontSize: style.fontSize - 0.5 }
  }
}

function symbolFor(pt: { flagged: boolean; unresolved: boolean }) {
  return pt.flagged ? 'triangle' : pt.unresolved ? 'diamond' : 'circle'
}

export function distributionOption(data: DistributionData, measure: VariableInfo, group: VariableInfo | null, chart: FullChart, ctx: BuildCtx): Built {
  const style = chart.style
  const p = palette(style, ctx.dark)
  const { yMin, yMax } = chart
  const notices: string[] = []
  const scale = chart.yScale
  let outside = 0
  let truncated = false
  const hlActive = ctx.highlight.size > 0
  const catColors = categoryColors(data.categories, notices)
  const boxHidden = (g: (typeof data.groups)[number]) => scale === 'log' && g.nonPositiveHidden.length > 0
  const boxes = data.groups.map((g) => {
    if (!g.summary.n || boxHidden(g)) return []
    const raw = [g.summary.min, g.summary.q1, g.summary.median, g.summary.q3, g.summary.max]
    const vals = raw.map((v) => clamp(v, yMin, yMax))
    if (vals.some((v, i) => v !== raw[i])) truncated = true
    return vals
  })
  const points = data.groups.flatMap((g, gi) =>
    g.points.flatMap((pt) => {
      if (!inBounds(pt.value, yMin, yMax)) {
        outside++
        return []
      }
      const hl = ctx.highlight.has(pt.row)
      return [{
        value: [gi, pt.value],
        row: pt.row,
        pid: pt.participantId,
        symbol: symbolFor(pt),
        symbolSize: hl ? style.pointSize + 6 : pt.flagged ? style.pointSize + 2 : style.pointSize,
        symbolOffset: [jitter(pt.row + 1) * 14, 0],
        cat: pt.cat,
        itemStyle: pt.unresolved && !pt.flagged
          ? { color: 'transparent', borderColor: pt.cat !== undefined ? catColors.get(pt.cat) : p.unresolved, borderWidth: 1.8 }
          : { color: pt.cat !== undefined ? catColors.get(pt.cat) : pt.flagged ? p.flag : p.point, opacity: hlActive && !hl ? 0.3 : style.pointOpacity, borderColor: hl ? p.text : 'rgba(255,255,255,0.85)', borderWidth: hl ? 2 : 0.7 }
      }]
    })
  )
  if (data.transformDropped) notices.push(`${data.transformDropped} value(s) cannot be transformed (e.g. log of a non-positive value) and are left out of this chart.`)
  if (outside) notices.push(`${outside} point(s) lie outside the forced Y bounds and are not drawn (they still count in all statistics).`)
  if (truncated) notices.push('Boxes or whiskers are cut at the forced Y bounds.')
  const series: any[] = [
    {
      type: 'boxplot',
      data: boxes,
      itemStyle: { color: style.boxFill ? hexAlpha(style.preset === 'glass' ? '#94a3b8' : style.boxColor, 0.18) : 'transparent', borderColor: p.box, borderWidth: 1.4 },
      boxWidth: [18, 56],
      z: 1,
      tooltip: {
        formatter: (prm: any) => {
          const g = data.groups[prm.dataIndex]
          const s = g.summary
          return `<b>${g.label}</b><br/>n ${s.n} · mean ${fmt(s.mean)} · SD ${s.sd === null ? 'n/a' : fmt(s.sd)}<br/>median ${fmt(s.median)} · Q1–Q3 ${fmt(s.q1)}–${fmt(s.q3)}<br/>min–max ${fmt(s.min)}–${fmt(s.max)}<br/><span style="opacity:.7">Box: Q1–Q3 (type 7) · whiskers: min–max</span>`
        }
      }
    },
    {
      type: 'scatter',
      z: 3,
      data: points,
      tooltip: { formatter: (prm: any) => `<b>${prm.data.pid}</b>${prm.data.cat !== undefined ? `<br/>${prm.data.cat}` : ''}<br/>${label(measure)}: ${fmt(prm.data.value[1])}${prm.data.symbol === 'triangle' ? '<br/>▲ QC flag (included)' : prm.data.symbol === 'diamond' ? '<br/>◇ Unresolved formatting' : ''}` }
    }
  ]
  if (chart.analysis.requested && chart.analysis.meanCi) {
    const bars = data.groups.map((g, gi) => {
      const d = describe(g.points.map((x) => x.value))
      return d.meanCi ? [gi, d.mean, d.meanCi.lower, d.meanCi.upper] : null
    })
    series.push({
      type: 'custom',
      z: 4,
      data: bars.filter(Boolean),
      renderItem: (_params: any, api: any) => {
        const x = api.value(0)
        const [cx, cm] = api.coord([x, api.value(1)])
        const [, lo] = api.coord([x, api.value(2)])
        const [, hi] = api.coord([x, api.value(3)])
        const off = 34
        const st = { stroke: p.fit, lineWidth: 2 }
        return {
          type: 'group',
          children: [
            { type: 'line', shape: { x1: cx + off, y1: lo, x2: cx + off, y2: hi }, style: st },
            { type: 'line', shape: { x1: cx + off - 6, y1: lo, x2: cx + off + 6, y2: lo }, style: st },
            { type: 'line', shape: { x1: cx + off - 6, y1: hi, x2: cx + off + 6, y2: hi }, style: st },
            { type: 'circle', shape: { cx: cx + off, cy: cm, r: 4.5 }, style: { fill: p.fit } }
          ]
        }
      },
      tooltip: { formatter: (prm: any) => `Mean ${fmt(prm.data[1])}<br/>95% CI ${fmt(prm.data[2])} – ${fmt(prm.data[3])}` }
    })
  }
  series.push(...legendSeries(catColors, ctx.colorTitle))
  const option: EChartsCoreOption = {
    animation: false,
    backgroundColor: p.bg,
    textStyle: { fontFamily: p.font, fontSize: style.fontSize },
    title: header(axisTitle(measure), ctx.subtitle, style, p),
    legend: legendOption(catColors, ctx.colorTitle, p, style),
    grid: { left: 76, right: 28, top: style.showTitle || style.showSubtitle ? 72 : 24, bottom: group ? 64 : 48 },
    tooltip: { trigger: 'item', confine: true, backgroundColor: cssVar('--paper-solid', '#fff'), borderColor: p.grid, textStyle: { color: cssVar('--text', '#111') } },
    xAxis: { type: 'category', data: data.groups.map((g) => `${g.label}\nn = ${g.summary.n}`), ...axis(p, style), splitLine: { show: false }, name: group ? label(group) : '', nameLocation: 'middle', nameGap: 42 },
    yAxis: { type: scale === 'log' ? 'log' : 'value', name: axisTitle(measure), nameLocation: 'middle', nameGap: 54, scale: yMin === null && yMax === null, min: yMin ?? undefined, max: yMax ?? undefined, ...axis(p, style) },
    series
  }
  return { option, notices, minWidth: Math.max(0, data.groups.length * 120 + 110) }
}

export interface FitInfo {
  transformX: boolean
  transformY: boolean
  excluded: number
}

/** Values entering the regression: on log axes the fit uses log10 of positive values, as displayed. */
export function fitInputs(data: ScatterData, chart: FullChart) {
  const tx = chart.xScale === 'log'
  const ty = chart.yScale === 'log'
  const xs: number[] = []
  const ys: number[] = []
  const rows: number[] = []
  let excluded = 0
  for (const pt of data.points) {
    if ((tx && pt.x <= 0) || (ty && pt.y <= 0)) {
      excluded++
      continue
    }
    xs.push(tx ? Math.log10(pt.x) : pt.x)
    ys.push(ty ? Math.log10(pt.y) : pt.y)
    rows.push(pt.row)
  }
  return { xs, ys, rows, info: { transformX: tx, transformY: ty, excluded } as FitInfo }
}

export function scatterOption(data: ScatterData, x: VariableInfo, y: VariableInfo, chart: FullChart, ctx: BuildCtx): Built {
  const style = chart.style
  const p = palette(style, ctx.dark)
  const notices: string[] = []
  let outside = 0
  const hlActive = ctx.highlight.size > 1
  const catColors = categoryColors(data.categories, notices)
  const pts = data.points.flatMap((pt) => {
    if (!inBounds(pt.x, chart.xMin, chart.xMax) || !inBounds(pt.y, chart.yMin, chart.yMax)) {
      outside++
      return []
    }
    const hl = ctx.highlight.has(pt.row)
    return [{
      value: [pt.x, pt.y],
      row: pt.row,
      pid: pt.participantId,
      symbol: symbolFor(pt),
      symbolSize: hl ? style.pointSize + 6 : pt.flagged ? style.pointSize + 3 : style.pointSize + 1,
      cat: pt.cat,
      itemStyle: pt.unresolved && !pt.flagged
        ? { color: 'transparent', borderColor: pt.cat !== undefined ? catColors.get(pt.cat) : p.unresolved, borderWidth: 1.8 }
        : { color: pt.cat !== undefined ? catColors.get(pt.cat) : pt.flagged ? p.flag : p.point, opacity: hlActive && !hl ? 0.3 : style.pointOpacity, borderColor: hl ? p.text : 'rgba(255,255,255,0.85)', borderWidth: hl ? 2 : 0.7 }
    }]
  })
  if (data.transformDropped) notices.push(`${data.transformDropped} pair(s) include a value that cannot be transformed (e.g. log of a non-positive value) and are left out of this chart.`)
  if (outside) notices.push(`${outside} pair(s) lie outside the forced axis bounds and are not drawn (they still count in all statistics).`)
  const series: any[] = [
    {
      type: 'scatter',
      z: 3,
      data: pts,
      tooltip: { formatter: (prm: any) => `<b>${prm.data.pid}</b>${prm.data.cat !== undefined ? `<br/>${prm.data.cat}` : ''}<br/>${label(x)}: ${fmt(prm.data.value[0])}<br/>${label(y)}: ${fmt(prm.data.value[1])}${prm.data.symbol === 'triangle' ? '<br/>▲ QC flag (included)' : prm.data.symbol === 'diamond' ? '<br/>◇ Unresolved formatting' : ''}` }
    }
  ]
  const a = chart.analysis
  if (a.requested && (a.fitLine || a.confidenceBand || a.predictionBand)) {
    const fi = fitInputs(data, chart)
    const fit = linearFit(fi.xs, fi.ys)
    if (fit) {
      const lo = Math.min(...fi.xs)
      const hi = Math.max(...fi.xs)
      const steps = 60
      const grid = Array.from({ length: steps + 1 }, (_, i) => lo + ((hi - lo) * i) / steps)
      const bx = (v: number) => (fi.info.transformX ? 10 ** v : v)
      const by = (v: number) => (fi.info.transformY ? 10 ** v : v)
      const pts2 = grid.map((g) => ({ x: bx(g), ...fit.band(g) }))
      const line = (key: 'fit' | 'lower' | 'upper' | 'predLower' | 'predUpper', dashed: boolean, width = 1.4, name = '') => ({
        type: 'line',
        name,
        z: 2,
        silent: true,
        showSymbol: false,
        smooth: false,
        data: pts2.map((q) => [q.x, by(q[key])]),
        lineStyle: { color: p.fit, width, type: dashed ? 'dashed' : 'solid', opacity: dashed ? 0.8 : 1 },
        tooltip: { show: false }
      })
      if (a.confidenceBand) {
        if (!fi.info.transformY) {
          series.push({ type: 'line', z: 1, silent: true, showSymbol: false, stack: 'ci', data: pts2.map((q) => [q.x, q.lower]), lineStyle: { opacity: 0 }, tooltip: { show: false } })
          series.push({ type: 'line', z: 1, silent: true, showSymbol: false, stack: 'ci', data: pts2.map((q) => [q.x, q.upper - q.lower]), lineStyle: { opacity: 0 }, areaStyle: { color: hexAlpha(style.fitColor, 0.14) }, tooltip: { show: false } })
        } else {
          series.push(line('lower', true, 1))
          series.push(line('upper', true, 1))
        }
      }
      if (a.predictionBand) {
        series.push(line('predLower', true, 1))
        series.push(line('predUpper', true, 1))
      }
      if (a.fitLine) series.push(line('fit', false, 2.2))
      if (fi.info.transformX || fi.info.transformY) notices.push('Fit is computed on the log10 scale shown on the axes.')
    }
  }
  series.push(...legendSeries(catColors, ctx.colorTitle))
  const option: EChartsCoreOption = {
    animation: false,
    backgroundColor: p.bg,
    textStyle: { fontFamily: p.font, fontSize: style.fontSize },
    legend: legendOption(catColors, ctx.colorTitle, p, style),
    title: header(`${label(y)} and ${label(x)}`, `${ctx.subtitle} · ${data.points.length} complete pairs`, style, p),
    grid: { left: 76, right: 30, top: style.showTitle || style.showSubtitle ? 72 : 24, bottom: 58 },
    brush: { xAxisIndex: 0, yAxisIndex: 0, throttleType: 'debounce', throttleDelay: 150, brushStyle: { color: 'rgba(37,99,235,0.08)', borderColor: p.point, borderWidth: 1 }, outOfBrush: { opacity: 0.35 }, seriesIndex: [0] },
    toolbox: { show: false },
    tooltip: { trigger: 'item', confine: true, backgroundColor: cssVar('--paper-solid', '#fff'), borderColor: p.grid, textStyle: { color: cssVar('--text', '#111') } },
    xAxis: { type: chart.xScale === 'log' ? 'log' : 'value', name: axisTitle(x), nameLocation: 'middle', nameGap: 34, scale: chart.xMin === null && chart.xMax === null, min: chart.xMin ?? undefined, max: chart.xMax ?? undefined, ...axis(p, style) },
    yAxis: { type: chart.yScale === 'log' ? 'log' : 'value', name: axisTitle(y), nameLocation: 'middle', nameGap: 54, scale: chart.yMin === null && chart.yMax === null, min: chart.yMin ?? undefined, max: chart.yMax ?? undefined, ...axis(p, style) },
    series
  }
  return { option, notices, minWidth: 0 }
}

export function hexAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '')
  if (h.length !== 6) return hex
  const n = parseInt(h, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

/** Scores plot for two chosen components (0-based indexes). Flags keep their shapes; the covariate sets the colour. */
export function pcaOption(plot: PcaPlot, xi: number, yi: number, chart: FullChart, ctx: BuildCtx): Built {
  const style = chart.style
  const p = palette(style, ctx.dark)
  const notices: string[] = []
  const r = plot.result!
  const catColors = categoryColors(plot.categories, notices)
  const hlActive = ctx.highlight.size > 0
  const data = plot.points.map((pt) => {
    const hl = ctx.highlight.has(pt.row)
    return {
      value: [pt.scores[xi], pt.scores[yi]],
      row: pt.row,
      pid: pt.participantId,
      cat: pt.cat,
      symbol: symbolFor(pt),
      symbolSize: hl ? style.pointSize + 6 : pt.flagged ? style.pointSize + 3 : style.pointSize + 1,
      itemStyle: pt.unresolved && !pt.flagged
        ? { color: 'transparent', borderColor: pt.cat !== undefined ? catColors.get(pt.cat) : p.unresolved, borderWidth: 1.8 }
        : { color: pt.cat !== undefined ? catColors.get(pt.cat) : pt.flagged ? p.flag : p.point, opacity: hlActive && !hl ? 0.3 : style.pointOpacity, borderColor: hl ? p.text : 'rgba(255,255,255,0.85)', borderWidth: hl ? 2 : 0.7 }
    }
  })
  const xName = `PC${xi + 1} (${pct(r.varianceExplained[xi])})`
  const yName = `PC${yi + 1} (${pct(r.varianceExplained[yi])})`
  const series: any[] = [
    {
      type: 'scatter',
      z: 3,
      data,
      tooltip: { formatter: (prm: any) => `<b>${prm.data.pid}</b>${prm.data.cat !== undefined ? `<br/>${prm.data.cat}` : ''}<br/>${xName}: ${fmt(prm.data.value[0])}<br/>${yName}: ${fmt(prm.data.value[1])}${prm.data.symbol === 'triangle' ? '<br/>▲ QC flag (included)' : prm.data.symbol === 'diamond' ? '<br/>◇ Unresolved formatting' : ''}` }
    },
    ...legendSeries(catColors, ctx.colorTitle)
  ]
  const option: EChartsCoreOption = {
    animation: false,
    backgroundColor: p.bg,
    textStyle: { fontFamily: p.font, fontSize: style.fontSize },
    legend: legendOption(catColors, ctx.colorTitle, p, style),
    title: header(`PCA: PC${xi + 1} vs PC${yi + 1}`, `${ctx.subtitle} · ${r.n} complete observations, ${r.p} variables (standardised)`, style, p),
    grid: { left: 76, right: 30, top: style.showTitle || style.showSubtitle ? 72 : 24, bottom: 58 },
    tooltip: { trigger: 'item', confine: true, backgroundColor: cssVar('--paper-solid', '#fff'), borderColor: p.grid, textStyle: { color: cssVar('--text', '#111') } },
    xAxis: { type: 'value', name: xName, nameLocation: 'middle', nameGap: 34, scale: true, ...axis(p, style) },
    yAxis: { type: 'value', name: yName, nameLocation: 'middle', nameGap: 54, scale: true, ...axis(p, style) },
    series
  }
  return { option, notices, minWidth: 0 }
}

/** Variance explained per component (bars) with the cumulative total (line). */
export function screeOption(r: PcaResult, chart: FullChart, ctx: Pick<BuildCtx, 'dark'>): EChartsCoreOption {
  const style = chart.style
  const p = palette(style, ctx.dark)
  const names = Array.from({ length: r.k }, (_, i) => `PC${i + 1}`)
  return {
    animation: false,
    backgroundColor: p.bg,
    textStyle: { fontFamily: p.font, fontSize: style.fontSize },
    grid: { left: 56, right: 20, top: 16, bottom: 36 },
    tooltip: { trigger: 'axis', confine: true, valueFormatter: (v: number) => `${v.toFixed(1)}%` },
    xAxis: { type: 'category', data: names, ...axis(p, style), axisLabel: { ...axis(p, style).axisLabel, interval: 0, fontSize: style.fontSize - 2 }, splitLine: { show: false } },
    yAxis: { type: 'value', name: 'Variance explained (%)', nameLocation: 'middle', nameGap: 40, min: 0, max: 100, ...axis(p, style) },
    series: [
      { type: 'bar', name: 'Per component', data: r.varianceExplained.map((v) => +(v * 100).toFixed(4)), itemStyle: { color: p.point } },
      { type: 'line', name: 'Cumulative', data: r.cumulative.map((v) => +(v * 100).toFixed(4)), lineStyle: { color: p.fit, width: 2 }, itemStyle: { color: p.fit }, symbolSize: 6 }
    ]
  }
}

/** Histogram with bins shared across groups; groups are stacked in category colours. */
export function histogramOption(data: DistributionData, measure: VariableInfo, group: VariableInfo | null, chart: FullChart, ctx: BuildCtx): Built {
  const style = chart.style
  const p = palette(style, ctx.dark)
  const notices: string[] = []
  const all = data.groups.flatMap((g) => g.points.map((pt) => pt.value))
  const bins = histogramBins(all)
  if (data.transformDropped) notices.push(`${data.transformDropped} value(s) cannot be transformed (e.g. log of a non-positive value) and are left out of this chart.`)
  if (!bins) return { option: {}, notices, minWidth: 0 }
  const edges = bins.counts.map((_, i) => bins.start + i * bins.width)
  // Each bar is labelled with its range, so a label can't be read as the bar's centre.
  const labels = edges.map((e) => `${fmt(+e.toPrecision(10))}–${fmt(+(e + bins.width).toPrecision(10))}`)
  const grouped = !!group && data.groups.length > 1
  const colors = categoryColors(grouped ? data.groups.map((g) => g.label) : [], notices)
  const series = (grouped ? data.groups : [{ label: 'All selected', points: data.groups.flatMap((g) => g.points) }]).map((g) => {
    const counts = new Array<number>(bins.counts.length).fill(0)
    for (const pt of g.points) counts[Math.min(counts.length - 1, Math.floor((pt.value - bins.start) / bins.width + 1e-9))]++
    return { type: 'bar', name: g.label, stack: 'h', data: counts, barCategoryGap: '4%', itemStyle: { color: grouped ? colors.get(g.label) : p.point, opacity: style.pointOpacity } }
  })
  const option: EChartsCoreOption = {
    animation: false,
    backgroundColor: p.bg,
    textStyle: { fontFamily: p.font, fontSize: style.fontSize },
    title: header(axisTitle(measure), `${ctx.subtitle} · bin width ${fmt(+bins.width.toPrecision(10))} (Freedman–Diaconis, rounded)`, style, p),
    legend: { show: grouped, data: [...(group ? [{ name: `${label(group)}:`, icon: 'none', textStyle: { color: p.text, fontWeight: 600 } }] : []), ...data.groups.map((g) => g.label)], selectedMode: false, right: 8, top: 2, width: '55%', type: 'scroll', itemWidth: 10, itemHeight: 10, textStyle: { color: p.text2, fontSize: style.fontSize - 0.5 } },
    grid: { left: 64, right: 24, top: style.showTitle || style.showSubtitle ? 72 : 24, bottom: 58 },
    tooltip: {
      trigger: 'axis',
      confine: true,
      axisPointer: { type: 'shadow' },
      formatter: (prm: any[]) => {
        const i = prm[0].dataIndex
        const lo = fmt(+edges[i].toPrecision(10))
        const hi = fmt(+(edges[i] + bins.width).toPrecision(10))
        return `<b>${lo} to ${i === edges.length - 1 ? `${hi} (inclusive)` : `under ${hi}`}</b><br/>${prm.map((s) => `${grouped ? `${s.seriesName}: ` : 'n = '}${s.value}`).join('<br/>')}`
      }
    },
    xAxis: { type: 'category', data: labels, name: axisTitle(measure), nameLocation: 'middle', nameGap: 34, ...axis(p, style), splitLine: { show: false }, axisLabel: { ...axis(p, style).axisLabel, interval: 'auto' } },
    yAxis: { type: 'value', name: 'Participants', nameLocation: 'middle', nameGap: 44, minInterval: 1, ...axis(p, style) },
    series: [...series, ...(group ? [{ type: 'bar', name: `${label(group)}:`, data: [], stack: 'h' }] : [])]
  }
  return { option, notices, minWidth: 0 }
}

// Diverging scale (ColorBrewer RdBu): blue negative, white zero, red positive. Missing is a distinct grey, never zero.
const DIVERGING = ['#2166ac', '#67a9cf', '#d1e5f0', '#f7f7f7', '#fddbc7', '#ef8a62', '#b2182b']
const NO_VALUE = '#c9ced8'

function divergingMap(min: number, max: number, p: ReturnType<typeof palette>, style: ChartStyle, text: [string, string], seriesIndex = 0) {
  return { type: 'continuous', min, max, calculable: false, orient: 'vertical', right: 6, top: 'middle', itemHeight: 160, itemWidth: 12, seriesIndex, text, inRange: { color: DIVERGING }, textStyle: { color: p.text2, fontSize: style.fontSize - 1 } }
}

export function correlationOption(m: CorrelationMatrix, vars: VariableInfo[], chart: FullChart, ctx: BuildCtx): Built {
  const style = chart.style
  const p = palette(style, ctx.dark)
  const notices: string[] = []
  const names = vars.map((v) => label(v))
  const k = vars.length
  const data: any[] = []
  let undefinedPairs = 0
  for (let i = 0; i < k; i++)
    for (let j = 0; j < k; j++) {
      const r = m.r[i][j]
      if (r === null && i < j) undefinedPairs++
      // White text on the dark ends of the scale keeps strong coefficients readable.
      data.push(r === null ? { value: [j, i, '-'], n: m.n[i][j], itemStyle: { color: NO_VALUE } } : { value: [j, i, r], n: m.n[i][j], ...(Math.abs(r) >= 0.6 ? { label: { color: '#ffffff' } } : {}) })
    }
  if (undefinedPairs) notices.push(`${undefinedPairs} pair(s) have fewer than 3 complete observations or no spread and are shown grey.`)
  const ns = m.n.flatMap((row, i) => row.filter((_, j) => j > i))
  if (ns.length) notices.push(`Pairwise complete observations: n = ${Math.min(...ns)}–${Math.max(...ns)} per pair. Coefficients only; no p-values are computed for a matrix of comparisons.`)
  const showLabels = k <= 14
  const cell = k <= 14 ? 44 : k <= 40 ? 18 : 9
  const side = Math.max(260, cell * k)
  const corrTop = style.showTitle || style.showSubtitle ? 72 : 24
  const option: EChartsCoreOption = {
    animation: false,
    backgroundColor: p.bg,
    textStyle: { fontFamily: p.font, fontSize: style.fontSize },
    title: header(`${m.method === 'pearson' ? 'Pearson' : 'Spearman'} correlations`, `${ctx.subtitle} · ${k} variables`, style, p),
    grid: { left: 150, right: 70, top: corrTop, height: side, width: side },
    tooltip: { confine: true, formatter: (prm: any) => `<b>${names[prm.value[1]]}</b><br/><b>${names[prm.value[0]]}</b><br/>${m.method === 'pearson' ? 'r' : 'ρ'} = ${prm.value[2] === '-' ? 'not defined' : (prm.value[2] as number).toFixed(3)} · n = ${prm.data.n}` },
    xAxis: { type: 'category', data: names, ...axis(p, style), splitLine: { show: false }, axisLabel: { ...axis(p, style).axisLabel, rotate: 45, interval: 0, show: k <= 60, width: 120, overflow: 'truncate' } },
    yAxis: { type: 'category', data: names, inverse: true, ...axis(p, style), splitLine: { show: false }, axisLabel: { ...axis(p, style).axisLabel, interval: 0, show: k <= 60, width: 140, overflow: 'truncate' } },
    visualMap: divergingMap(-1, 1, p, style, ['+1', '−1']),
    series: [{ type: 'heatmap', data, label: { show: showLabels, formatter: (prm: any) => (prm.value[2] === '-' ? '—' : (prm.value[2] as number).toFixed(2)), fontSize: style.fontSize - 2, color: '#111827', rich: {} }, itemStyle: { borderColor: p.bg === 'transparent' ? 'rgba(255,255,255,0.6)' : p.bg, borderWidth: k <= 40 ? 1 : 0 } }]
  }
  return { option, notices, minWidth: side + 240, height: corrTop + side + 130 }
}

const Z_CLIP = 3

export function heatmapOption(h: HeatmapData, vars: VariableInfo[], chart: FullChart, ctx: BuildCtx): Built {
  const style = chart.style
  const p = palette(style, ctx.dark)
  const notices: string[] = []
  const catColors = categoryColors(h.categories, notices)
  const annotate = h.categories.length > 0
  const cols = [...(annotate ? [ctx.colorTitle ?? 'Group'] : []), ...vars.map((v) => label(v))]
  const off = annotate ? 1 : 0
  const cells: any[] = []
  let clipped = 0
  h.z.forEach((row, i) =>
    row.forEach((z, j) => {
      if (z === null) {
        cells.push({ value: [j + off, i, '-'], itemStyle: { color: NO_VALUE } })
        return
      }
      if (Math.abs(z) > Z_CLIP) clipped++
      cells.push({ value: [j + off, i, Math.max(-Z_CLIP, Math.min(Z_CLIP, z))], z, raw: h.raw[i][j], flagged: h.flagged[i][j], ...(h.flagged[i][j] ? { itemStyle: { borderColor: '#111827', borderWidth: 1.5 } } : {}) })
    })
  )
  const ann = annotate ? h.cats.map((c, i) => ({ value: [0, i, 0], cat: c, itemStyle: { color: c ? catColors.get(c) : NO_VALUE } })) : []
  if (h.undefinedKeys.length) notices.push(`${h.undefinedKeys.length} variable(s) have fewer than 2 usable values or no spread and are shown grey.`)
  if (h.missingCells) notices.push(`${h.missingCells} cell(s) have no usable value (missing, censored, text or QC-excluded) and are shown grey.`)
  if (clipped) notices.push(`${clipped} cell(s) lie beyond ±${Z_CLIP} SD; their colour is capped at the end of the scale (the tooltip shows the value).`)
  notices.push('Outlined cells carry a QC flag (included under the current policy).')
  const rowPx = h.rows.length <= 40 ? 16 : h.rows.length <= 120 ? 8 : 4
  const colPx = cols.length <= 20 ? 38 : cols.length <= 60 ? 16 : 7
  const height = Math.max(240, rowPx * h.rows.length)
  const width = Math.max(240, colPx * cols.length)
  const heatTop = (style.showTitle || style.showSubtitle ? 72 : 24) + (cols.length <= 80 ? 96 : 16) // room for rotated column labels
  const option: EChartsCoreOption = {
    animation: false,
    backgroundColor: p.bg,
    textStyle: { fontFamily: p.font, fontSize: style.fontSize },
    title: header('Heatmap (z-scores per variable)', `${ctx.subtitle} · ${h.rows.length} participants × ${vars.length} variables`, style, p),
    legend: legendOption(catColors, ctx.colorTitle, p, style),
    grid: { left: 90, right: 70, top: heatTop, height, width },
    tooltip: {
      confine: true,
      formatter: (prm: any) => {
        const pidText = `<b>${h.participantIds[prm.value[1]]}</b>`
        if (prm.seriesIndex === 1) return `${pidText}<br/>${ctx.colorTitle ?? 'Group'}: ${prm.data.cat ?? '—'}`
        return `${pidText}<br/>${cols[prm.value[0]]}<br/>${prm.value[2] === '-' ? 'No usable value' : `value ${fmt(prm.data.raw)} · z ${prm.data.z.toFixed(2)}`}${prm.data.flagged ? '<br/>▲ QC flag (included)' : ''}`
      }
    },
    xAxis: { type: 'category', data: cols, position: 'top', ...axis(p, style), splitLine: { show: false }, axisLabel: { ...axis(p, style).axisLabel, rotate: 45, interval: 0, show: cols.length <= 80, width: 120, overflow: 'truncate' } },
    yAxis: { type: 'category', data: h.participantIds, inverse: true, ...axis(p, style), splitLine: { show: false }, axisLabel: { ...axis(p, style).axisLabel, interval: h.rows.length <= 60 ? 0 : 'auto', fontSize: style.fontSize - 2 } },
    visualMap: divergingMap(-Z_CLIP, Z_CLIP, p, style, [`+${Z_CLIP} SD`, `−${Z_CLIP} SD`]),
    series: [
      { type: 'heatmap', data: cells, itemStyle: { borderColor: 'transparent' } },
      ...(annotate ? [{ type: 'heatmap', data: ann }] : []),
      ...legendSeries(catColors, ctx.colorTitle)
    ]
  }
  return { option, notices, minWidth: width + 200, height: heatTop + height + 24 }
}
