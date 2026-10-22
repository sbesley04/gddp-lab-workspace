// Visual pass over every screen with the synthetic demo, in light and dark mode.
import { test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { launch } from './helpers'

for (const scheme of ['light', 'dark'] as const) {
  test(`screens (${scheme})`, async () => {
    const { app, page } = await launch(mkdtempSync(join(tmpdir(), 'bari-ud-')), scheme)
    const shot = (n: string) => page.screenshot({ path: join(import.meta.dirname, '..', 'test-results', 'screens', `${scheme}-${n}.png`) })
    await page.setViewportSize({ width: 1440, height: 920 }).catch(() => undefined)
    await page.waitForTimeout(600)
    await shot('01-welcome')
    await page.getByText('Open synthetic demo').click()
    await page.getByText('Outstanding metadata tasks').waitFor()
    await page.waitForTimeout(400)
    await shot('02-overview')
    await page.getByRole('button', { name: 'Explore data' }).first().click()
    await page.waitForTimeout(800)
    await shot('03-explore-distribution')
    await page.getByRole('button', { name: 'Two measures' }).click()
    await page.waitForTimeout(800)
    await shot('04-explore-scatter')
    await page.getByRole('button', { name: 'Measurements' }).click()
    await page.waitForTimeout(500)
    await shot('05-measurements')
    await page.getByRole('button', { name: 'Data quality' }).click()
    await page.waitForTimeout(500)
    await shot('06-quality')
    await page.getByRole('button', { name: 'Export' }).click()
    await page.waitForTimeout(900)
    await shot('07-export')
    await app.close()
  })
}
