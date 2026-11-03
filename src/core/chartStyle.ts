// Chart style presets. "glass" follows the app theme; the others are fixed for publication-style output.
import type { ChartAnalysis, ChartConfig, ChartStyle, FontChoice, StylePreset } from './types'

export const STYLE_PRESETS: Record<Exclude<StylePreset, 'custom'>, { label: string; style: ChartStyle }> = {
  glass: {
    label: 'Default (glass)',
    style: { preset: 'glass', pointColor: '#2563eb', flagColor: '#d97706', unresolvedColor: '#7c3aed', boxColor: '#64748b', fitColor: '#0f766e', background: 'transparent', textColor: null, font: 'system', fontSize: 12, pointSize: 9, pointOpacity: 0.9, showGrid: true, showTitle: true, showSubtitle: true, boxFill: false }
  },
  publication: {
    label: 'Publication',
    style: { preset: 'publication', pointColor: '#1f2937', flagColor: '#b45309', unresolvedColor: '#6d28d9', boxColor: '#111827', fitColor: '#111827', background: 'white', textColor: '#111827', font: 'sans', fontSize: 12, pointSize: 7, pointOpacity: 0.85, showGrid: false, showTitle: true, showSubtitle: false, boxFill: false }
  },
  contrast: {
    label: 'High contrast',
    style: { preset: 'contrast', pointColor: '#0000ff', flagColor: '#d00000', unresolvedColor: '#7a00cc', boxColor: '#000000', fitColor: '#000000', background: 'white', textColor: '#000000', font: 'sans', fontSize: 14, pointSize: 11, pointOpacity: 1, showGrid: true, showTitle: true, showSubtitle: true, boxFill: false }
  },
  colorblind: {
    label: 'Colour-blind safe (Okabe–Ito)',
    style: { preset: 'colorblind', pointColor: '#0072B2', flagColor: '#E69F00', unresolvedColor: '#CC79A7', boxColor: '#555555', fitColor: '#009E73', background: 'transparent', textColor: null, font: 'system', fontSize: 12, pointSize: 9, pointOpacity: 0.9, showGrid: true, showTitle: true, showSubtitle: true, boxFill: false }
  },
  grayscale: {
    label: 'Greyscale',
    style: { preset: 'grayscale', pointColor: '#333333', flagColor: '#000000', unresolvedColor: '#777777', boxColor: '#444444', fitColor: '#000000', background: 'white', textColor: '#111111', font: 'serif', fontSize: 12, pointSize: 8, pointOpacity: 0.8, showGrid: false, showTitle: true, showSubtitle: false, boxFill: true }
  }
}

/** Font stacks use single quotes only: ECharts writes them into an SVG style="…" attribute, where a double quote breaks the XML. */
export const FONT_STACKS: Record<FontChoice, string | null> = {
  system: null,
  sans: 'Helvetica Neue, Helvetica, Arial, sans-serif',
  serif: "Georgia, 'Times New Roman', Times, serif",
  mono: 'ui-monospace, Menlo, Consolas, monospace'
}

export const DEFAULT_ANALYSIS: ChartAnalysis = { requested: false, fitLine: true, confidenceBand: true, predictionBand: false, meanCi: false }

export function defaultStyle(): ChartStyle {
  return { ...STYLE_PRESETS.glass.style }
}

/** Fill fields added after the first release so older saved views keep working unchanged. */
export function normalizeChart(c: ChartConfig): Required<ChartConfig> {
  return {
    ...c,
    xMin: c.xMin ?? null,
    xMax: c.xMax ?? null,
    yMin: c.yMin ?? null,
    yMax: c.yMax ?? null,
    colorKey: c.colorKey ?? null,
    pcaKeys: c.pcaKeys ?? [],
    transformMeasure: c.transformMeasure ?? 'none',
    transformCompare: c.transformCompare ?? 'none',
    style: { ...defaultStyle(), ...(c.style ?? {}) },
    analysis: { ...DEFAULT_ANALYSIS, ...(c.analysis ?? {}) }
  }
}
