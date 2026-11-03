import { describe, expect, it } from 'vitest'
import { stampSvg, STAMP_HEIGHT } from '@core/chartStamp'

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400"><rect width="10" height="10"/></svg>'

describe('stampSvg', () => {
  it('grows the canvas and writes the footer', () => {
    const r = stampSvg(svg, 'sig 3f2a91c0 · v0.3.1')
    expect(r.width).toBe(600)
    expect(r.height).toBe(400 + STAMP_HEIGHT)
    expect(r.svg).toContain(`height="${400 + STAMP_HEIGHT}"`)
    expect(r.svg).toContain(`viewBox="0 0 600 ${400 + STAMP_HEIGHT}"`)
    expect(r.svg).toContain('sig 3f2a91c0 · v0.3.1')
    expect(r.svg.trimEnd().endsWith('</svg>')).toBe(true)
  })
  it('escapes markup in the footer text', () => {
    expect(stampSvg(svg, '<b>&').svg).toContain('&lt;b&gt;&amp;')
  })
  it('rejects non-SVG data', () => {
    expect(() => stampSvg('<html></html>', 'x')).toThrow('not SVG')
  })
})
