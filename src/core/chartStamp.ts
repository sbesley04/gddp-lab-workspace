// Adds a one-line footer (analysis signature) to an SVG chart. Pure string work so it can be tested without a browser.

export const STAMP_HEIGHT = 22

export const SIZE_PRESETS = [
  { id: 'shown', label: 'As shown on screen', width: null, height: null },
  { id: 'single', label: 'Journal single column (600 × 420)', width: 600, height: 420 },
  { id: 'double', label: 'Journal double column (1200 × 700)', width: 1200, height: 700 },
  { id: 'slide', label: 'Slide 16:9 (1600 × 900)', width: 1600, height: 900 }
] as const
export type SizePresetId = (typeof SIZE_PRESETS)[number]['id']

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export interface StampResult {
  svg: string
  width: number
  height: number
}

/** Extends the SVG canvas by STAMP_HEIGHT and writes `text` along the bottom edge. Returns the new size. */
export function stampSvg(svg: string, text: string, opts: { color?: string; background?: string | null } = {}): StampResult {
  const open = /<svg\b[^>]*>/.exec(svg)
  if (!open) throw new Error('Chart data is not SVG.')
  const tag = open[0]
  const attr = (name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]
  const width = parseFloat(attr('width') ?? '')
  const height = parseFloat(attr('height') ?? '')
  if (!Number.isFinite(width) || !Number.isFinite(height)) throw new Error('Chart SVG has no size.')
  const newHeight = height + STAMP_HEIGHT
  let newTag = tag.replace(/(\sheight=")[^"]*(")/, `$1${newHeight}$2`)
  const vb = attr('viewBox')
  if (vb) {
    const [x, y, w, h] = vb.split(/[\s,]+/).map(Number)
    newTag = newTag.replace(/(\sviewBox=")[^"]*(")/, `$1${x} ${y} ${w} ${h + STAMP_HEIGHT}$2`)
  }
  const bg = opts.background ? `<rect x="0" y="${height}" width="${width}" height="${STAMP_HEIGHT}" fill="${xmlEscape(opts.background)}"/>` : ''
  const label = `<text x="8" y="${height + 15}" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="10" fill="${xmlEscape(opts.color ?? '#6b7280')}">${xmlEscape(text)}</text>`
  const out = svg.replace(tag, newTag).replace(/<\/svg>\s*$/, `${bg}${label}</svg>`)
  return { svg: out, width, height: newHeight }
}
