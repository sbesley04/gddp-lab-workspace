import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import * as echarts from 'echarts/core'
import { ScatterChart, BoxplotChart, LineChart, CustomChart, BarChart, HeatmapChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, TitleComponent, BrushComponent, ToolboxComponent, LegendComponent, VisualMapComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import type { EChartsCoreOption } from 'echarts/core'

echarts.use([ScatterChart, BoxplotChart, LineChart, CustomChart, BarChart, HeatmapChart, VisualMapComponent, GridComponent, TooltipComponent, TitleComponent, BrushComponent, ToolboxComponent, LegendComponent, SVGRenderer])

export interface EChartHandle {
  svg: () => string
  png: (scale?: number) => Promise<string>
  /** SVG at an explicit size (null = as shown), rendered offscreen so the on-screen chart is untouched. */
  svgAt: (width: number | null, height: number | null) => string
  /** Rasterise any SVG string (e.g. one with a footer) at the given scale. */
  pngFromSvg: (svg: string, width: number, height: number, scale: number) => Promise<string>
  setBrush: (on: boolean) => void
}

interface Props {
  option: EChartsCoreOption
  onPointClick?: (data: any) => void
  onBrush?: (dataIndexes: number[]) => void
  ariaLabel: string
  height?: number | string
  minWidth?: number
}

/** ECharts with the SVG renderer: crisp, inspectable output and lossless SVG export. */
export const EChart = forwardRef<EChartHandle, Props>(function EChart({ option, onPointClick, onBrush, ariaLabel, height, minWidth }, ref) {
  const host = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)
  const handlers = useRef({ onPointClick, onBrush })
  handlers.current = { onPointClick, onBrush }
  const latest = useRef(option)
  latest.current = option

  useEffect(() => {
    const el = host.current!
    const c = echarts.init(el, undefined, { renderer: 'svg' })
    chart.current = c
    c.on('click', (p: any) => handlers.current.onPointClick?.(p.data))
    c.on('brushSelected', (p: any) => {
      const idx: number[] = p.batch?.[0]?.selected?.flatMap((s: any) => s.dataIndex.map((i: number) => s.seriesIndex * 1e6 + i)) ?? []
      handlers.current.onBrush?.(idx)
    })
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(el)
    return () => {
      ro.disconnect()
      c.dispose()
    }
  }, [])

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true, lazyUpdate: false })
  }, [option])

  const rasterise = async (svg: string, w: number, h: number, scale: number) => {
    const img = new Image()
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
    await new Promise<void>((res, rej) => {
      img.onload = () => res()
      img.onerror = () => rej(new Error('Could not rasterise chart'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = w * scale
    canvas.height = h * scale
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--paper-solid').trim() || '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  }

  useImperativeHandle(ref, () => ({
    pngFromSvg: rasterise,
    svgAt: (width, height) => {
      if (width === null || height === null) return (chart.current as any).renderToSVGString() as string
      const el = document.createElement('div')
      const c = echarts.init(el, undefined, { renderer: 'svg', width, height, ssr: false })
      try {
        c.setOption({ ...(latest.current as object), animation: false }, { notMerge: true })
        return (c as any).renderToSVGString() as string
      } finally {
        c.dispose()
      }
    },
    svg: () => (chart.current as any).renderToSVGString() as string,
    png: async (scale = 2) => {
      const svg = (chart.current as any).renderToSVGString() as string
      const w = host.current!.clientWidth
      const h = host.current!.clientHeight
      const img = new Image()
      const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
      await new Promise<void>((res, rej) => {
        img.onload = () => res()
        img.onerror = () => rej(new Error('Could not rasterise chart'))
        img.src = url
      })
      const canvas = document.createElement('canvas')
      canvas.width = w * scale
      canvas.height = h * scale
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--paper-solid').trim() || '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      return canvas.toDataURL('image/png')
    },
    setBrush: (on: boolean) => {
      chart.current?.dispatchAction({ type: 'takeGlobalCursor', key: 'brush', brushOption: on ? { brushType: 'rect', brushMode: 'single' } : { brushType: false } })
      if (!on) chart.current?.dispatchAction({ type: 'brush', areas: [] })
    }
  }))

  return <div ref={host} className="chart-host" role="img" aria-label={ariaLabel} style={{ height: height ?? undefined, minWidth: minWidth || undefined }} />
})

export function cssVar(name: string, fallback = '#000') {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/** Deterministic jitter in [-1, 1] so point positions are stable between renders and exports. */
export function jitter(seed: number) {
  let x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  x = x - Math.floor(x)
  return x * 2 - 1
}
