// Shared ECharts option builders used by Explore and the Compare board, so a chart looks and
// behaves the same everywhere. Styles never change what data is shown, only how it looks.
import type { EChartsCoreOption } from 'echarts/core'
import type { ChartConfig, ChartStyle, VariableInfo } from '@core/types'
import type { DistributionData, ScatterData } from '@core/chartData'
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
}

export interface Built {
  option: EChartsCoreOption
  notices: string[]
  /** Pixel height that keeps boxes well proportioned; width grows (and scrolls) with many groups. */
  minWidth: number
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
    font: FONT_STACKS[style.font] ?? getComputedStyle(document.body).fontFamily
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
        itemStyle: pt.unresolved && !pt.flagged
          ? { color: 'transparent', borderColor: p.unresolved, borderWidth: 1.8 }
          : { color: pt.flagged ? p.flag : p.point, opacity: hlActive && !hl ? 0.3 : style.pointOpacity, borderColor: hl ? p.text : 'rgba(255,255,255,0.85)', borderWidth: hl ? 2 : 0.7 }
      }]
    })
  )
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
      tooltip: { formatter: (prm: any) => `<b>${prm.data.pid}</b><br/>${label(measure)}: ${fmt(prm.data.value[1])}${prm.data.symbol === 'triangle' ? '<br/>▲ QC flag (included)' : prm.data.symbol === 'diamond' ? '<br/>◇ Unresolved formatting' : ''}` }
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
  const option: EChartsCoreOption = {
    animation: false,
    backgroundColor: p.bg,
    textStyle: { fontFamily: p.font, fontSize: style.fontSize },
    title: header(axisTitle(measure), ctx.subtitle, style, p),
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
      itemStyle: pt.unresolved && !pt.flagged
        ? { color: 'transparent', borderColor: p.unresolved, borderWidth: 1.8 }
        : { color: pt.flagged ? p.flag : p.point, opacity: hlActive && !hl ? 0.3 : style.pointOpacity, borderColor: hl ? p.text : 'rgba(255,255,255,0.85)', borderWidth: hl ? 2 : 0.7 }
    }]
  })
  if (outside) notices.push(`${outside} pair(s) lie outside the forced axis bounds and are not drawn (they still count in all statistics).`)
  const series: any[] = [
    {
      type: 'scatter',
      z: 3,
      data: pts,
      tooltip: { formatter: (prm: any) => `<b>${prm.data.pid}</b><br/>${label(x)}: ${fmt(prm.data.value[0])}<br/>${label(y)}: ${fmt(prm.data.value[1])}${prm.data.symbol === 'triangle' ? '<br/>▲ QC flag (included)' : prm.data.symbol === 'diamond' ? '<br/>◇ Unresolved formatting' : ''}` }
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
  const option: EChartsCoreOption = {
    animation: false,
    backgroundColor: p.bg,
    textStyle: { fontFamily: p.font, fontSize: style.fontSize },
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
