// Colour helpers for decoding workbook formatting. Pure functions.
import type { ColorRef } from './types'

/** Excel theme colour index order: lt1, dk1, lt2, dk2, accent1..6, hlink, folHlink. */
export const THEME_INDEX_NAMES = [
  'lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'
]

/** Legacy indexed palette (indices 0-63). 64 = system foreground, 65 = system background. */
export const INDEXED_COLORS = [
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080',
  '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF',
  '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
  '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696',
  '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333'
]

const HLSMAX = 255

function rgbToHls(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(0, 2), 16) / 255
  const g = parseInt(hex.slice(2, 4), 16) / 255
  const b = parseInt(hex.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
  }
  return [h, l, s]
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1
  if (t > 1) t -= 1
  if (t < 1 / 6) return p + (q - p) * 6 * t
  if (t < 1 / 2) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}

function hlsToRgb(h: number, l: number, s: number): string {
  let r: number, g: number, b: number
  if (s === 0) r = g = b = l
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1 / 3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1 / 3)
  }
  const to = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0').toUpperCase()
  return to(r) + to(g) + to(b)
}

/** Apply an OOXML tint (-1..1) to an RRGGBB colour, using the luminance rule from ECMA-376 §18.8.19. */
export function applyTint(hex: string, tint: number): string {
  if (!tint) return hex.toUpperCase()
  const [h, l, s] = rgbToHls(hex)
  let lum = l * HLSMAX
  if (tint < 0) lum = lum * (1 + tint)
  else lum = lum * (1 - tint) + (HLSMAX - HLSMAX * (1 - tint))
  return hlsToRgb(h, Math.min(1, Math.max(0, lum / HLSMAX)), s)
}

/** Resolve a colour reference against a theme palette (indexed by Excel theme index). */
export function resolveColor(ref: ColorRef | null | undefined, theme: string[] | null): string | null {
  if (!ref) return null
  let base: string | null = null
  if (ref.rgb) base = ref.rgb.length === 8 ? ref.rgb.slice(2) : ref.rgb
  else if (ref.theme !== undefined) base = theme?.[ref.theme] ?? null
  else if (ref.indexed !== undefined) {
    if (ref.indexed === 64) base = '000000'
    else if (ref.indexed === 65) base = 'FFFFFF'
    else base = INDEXED_COLORS[ref.indexed] ?? null
  } else if (ref.auto) base = null
  if (!base) return null
  return applyTint(base.toUpperCase(), ref.tint ?? 0)
}

/** Canonical key for a colour reference, preserving how it was specified (theme vs rgb). */
export function colorKey(ref: ColorRef | null | undefined): string {
  if (!ref) return 'none'
  if (ref.rgb) return `rgb:${(ref.rgb.length === 8 ? ref.rgb.slice(2) : ref.rgb).toUpperCase()}`
  const tint = ref.tint ? `:${ref.tint.toFixed(2)}` : ''
  if (ref.theme !== undefined) return `theme:${ref.theme}${tint}`
  if (ref.indexed !== undefined) return `indexed:${ref.indexed}${tint}`
  if (ref.auto) return 'auto'
  return 'none'
}

export function describeColorRef(ref: ColorRef | null | undefined): string {
  if (!ref) return 'default'
  if (ref.rgb) return `#${(ref.rgb.length === 8 ? ref.rgb.slice(2) : ref.rgb).toUpperCase()}`
  if (ref.theme !== undefined) {
    const name = THEME_INDEX_NAMES[ref.theme] ?? `theme ${ref.theme}`
    return ref.tint ? `${name} (tint ${ref.tint.toFixed(2)})` : name
  }
  if (ref.indexed !== undefined) return `indexed ${ref.indexed}`
  return 'automatic'
}

/** Euclidean distance in RGB space (0..441). */
export function rgbDistance(a: string, b: string): number {
  const p = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16)
  const dr = p(a, 0) - p(b, 0)
  const dg = p(a, 2) - p(b, 2)
  const db = p(a, 4) - p(b, 4)
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

/** Rough colour naming for display and legend matching. */
export function isBlackish(hex: string | null): boolean {
  if (!hex) return true
  return rgbDistance(hex, '000000') < 40
}
