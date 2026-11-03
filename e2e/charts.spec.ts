// Chart saving end to end: offscreen render at a preset size, signature footer, PNG scaling, sidecars and the
// colour legend. Native save dialogs are replaced with fixed paths.
import { test, expect } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { launch, mockDialogs } from './helpers'

test('saved charts carry their signature, size, colour legend and sidecars', async () => {
  const { app, page } = await launch(mkdtempSync(join(tmpdir(), 'bari-charts-')))
  const out = mkdtempSync(join(tmpdir(), 'bari-charts-out-'))
  const svgPath = join(out, 'il6.svg')
  const pngPath = join(out, 'il6.png')
  await mockDialogs(app, { save: [svgPath, pngPath] })
  await page.getByText('Open synthetic demo').click()
  await page.getByText('Outstanding metadata tasks').waitFor({ timeout: 20000 })
  await page.getByRole('button', { name: 'Explore data' }).first().click()

  // Colour by a covariate; the log records it
  await page.getByTestId('color-picker').click()
  await page.keyboard.type('Biological_Sex')
  await page.keyboard.press('Enter')
  await page.getByTestId('history').click()
  const signature = (await page.getByTestId('chain-signature').textContent())!.trim()
  await expect(page.getByText(/points coloured by Biological_Sex/)).toBeVisible()
  await page.keyboard.press('Escape')
  await page.screenshot({ path: join(import.meta.dirname, '..', 'test-results', 'screens', 'colour-by.png') })

  // SVG at the single-column preset, with footer and sidecars
  await page.getByRole('button', { name: 'Download chart' }).click()
  await page.getByLabel('Export size').selectOption('single')
  await page.getByLabel('PNG resolution').selectOption('4')
  await page.getByTestId('download-svg').click()
  await expect.poll(() => existsSync(join(out, 'il6.analysis-log.R'))).toBe(true)
  const svg = readFileSync(svgPath, 'utf8')
  expect(svg).toMatch(/<svg[^>]*\swidth="600"/)
  expect(svg).toMatch(/<svg[^>]*\sheight="442"/) // 420 + footer
  expect(svg).toContain(`analysis ${signature}`)
  expect(svg).toContain('Biological_Sex:') // legend names the covariate
  const xmlError = await page.evaluate((text) => new DOMParser().parseFromString(text, 'image/svg+xml').querySelector('parsererror')?.textContent ?? null, svg)
  expect(xmlError).toBeNull() // well-formed, so Inkscape/Illustrator and <img> can read it
  const settings = JSON.parse(readFileSync(join(out, 'il6.chart.json'), 'utf8'))
  expect(settings.signature).toBe(signature)
  expect(settings.chart.colorKey).toBeTruthy()
  expect(readFileSync(join(out, 'il6.analysis-log.R'), 'utf8')).toContain(`# chain signature: ${signature}`)

  // PNG at 4x of the same preset (settings persist while the page is open)
  await page.getByRole('button', { name: 'Download chart' }).click()
  await page.getByTestId('download-png').click()
  await expect.poll(() => existsSync(pngPath)).toBe(true)
  const png = readFileSync(pngPath)
  expect(png.subarray(1, 4).toString()).toBe('PNG')
  expect(png.readUInt32BE(16)).toBe(2400)
  expect(png.readUInt32BE(20)).toBe(1768)
  await app.close()
})
