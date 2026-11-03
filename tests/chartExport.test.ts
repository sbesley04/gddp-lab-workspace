// Chart file writing: format checks, sidecars beside the chart, and nothing else overwritten.
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { writeChartFiles } from '../src/main/exportService'

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'

describe('writeChartFiles', () => {
  it('writes the chart with settings and log beside it, leaving other files alone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bari-chart-'))
    writeFileSync(join(dir, 'IL6.R'), 'my own script')
    writeFileSync(join(dir, 'IL6.json'), '{"mine":true}')
    const r = writeChartFiles(null, { format: 'svg', data: svg, sidecars: { settings: '{"signature":"abcd1234"}', log: '# chain signature: abcd1234' } }, join(dir, 'IL6.svg'), null)
    expect(r.files).toEqual(['IL6.svg', 'IL6.chart.json', 'IL6.analysis-log.R'])
    expect(readFileSync(join(dir, 'IL6.R'), 'utf8')).toBe('my own script')
    expect(readFileSync(join(dir, 'IL6.json'), 'utf8')).toBe('{"mine":true}')
    expect(readFileSync(join(dir, 'IL6.analysis-log.R'), 'utf8')).toContain('abcd1234')
    expect(readdirSync(dir).sort()).toEqual(['IL6.R', 'IL6.analysis-log.R', 'IL6.chart.json', 'IL6.json', 'IL6.svg'])
  })

  it('rejects data that does not match the format', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bari-chart-'))
    expect(() => writeChartFiles(null, { format: 'svg', data: '<html>' }, join(dir, 'x.svg'), null)).toThrow('not SVG')
    expect(() => writeChartFiles(null, { format: 'png', data: 'data:text/plain;base64,AA==' }, join(dir, 'x.png'), null)).toThrow('not a PNG')
  })

  it('writes a log on its own without sidecars', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bari-chart-'))
    const r = writeChartFiles(null, { format: 'r', data: '# log', sidecars: { settings: '{}', log: '# log' } }, join(dir, 'log.R'), null)
    expect(r.files).toEqual(['log.R'])
  })
})
