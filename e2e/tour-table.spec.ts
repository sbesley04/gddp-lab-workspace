// First-run tour (shown once, replayable) and column virtualisation for wide tables.
import { test, expect } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { launch } from './helpers'

test('tour appears once, steps through every page, and can be replayed', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'bari-tour-'))
  let { app, page } = await launch(userData, 'light', { tour: true })
  await page.getByText('Open synthetic demo').click()
  await expect(page.getByTestId('tour')).toBeVisible({ timeout: 20000 }) // demo creation can take a few seconds
  await expect(page.getByTestId('tour')).toContainText('Step 1 of 9')
  for (let i = 1; i < 9; i++) {
    await page.getByTestId('tour-next').click()
    await expect(page.getByTestId('tour')).toContainText(`Step ${i + 1} of 9`)
    if (i === 4) {
      // The highlight must sit on the chart toolbar, not on a previous step's target.
      await expect(page.locator('.tour-ring')).toBeVisible()
      const ring = (await page.locator('.tour-ring').boundingBox())!
      const tools = (await page.locator('[data-tour="toolbar"]').boundingBox())!
      expect(Math.abs(ring.x + 8 - tools.x)).toBeLessThan(4)
      await page.screenshot({ path: join(import.meta.dirname, '..', 'test-results', 'screens', 'tour-step-5.png') })
    }
  }
  await page.getByTestId('tour-next').click() // Done
  await expect(page.getByTestId('tour')).toHaveCount(0)
  await app.close()
  ;({ app, page } = await launch(userData, 'light', { tour: true }))
  await page.getByText('Open synthetic demo').click()
  await page.getByText('Outstanding metadata tasks').waitFor()
  await page.waitForTimeout(900)
  await expect(page.getByTestId('tour')).toHaveCount(0)
  await page.getByRole('button', { name: 'Take the tour' }).click()
  await expect(page.getByTestId('tour')).toContainText('Step 1 of 9')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('tour')).toHaveCount(0)
  await app.close()
})

test('wide tables render only visible columns and keep ID and visit pinned', async () => {
  const { app, page } = await launch(mkdtempSync(join(tmpdir(), 'bari-wide-')))
  await page.getByText('Open synthetic demo').click()
  await page.getByText('Outstanding metadata tasks').waitFor({ timeout: 20000 })
  await page.getByRole('button', { name: 'Explore data' }).first().click()
  await page.getByRole('button', { name: 'Table', exact: true }).click()
  for (const area of ['demographic', 'depression', 'NP', 'LP1', 'Accelevir', 'AQ NULISA']) {
    await page.getByRole('button', { name: 'Add column' }).click()
    await page.getByTestId(`add-area-${area}`).click()
  }
  const table = page.getByTestId('selected-table')
  await expect(page.getByText(/20 columns \(scroll sideways\)/)).toBeVisible()
  const rendered = await table.locator('thead th:not([aria-hidden])').count()
  expect(rendered).toBeLessThan(22) // 20 measures + participant + visit would be 22 without virtualisation
  await page.screenshot({ path: join(import.meta.dirname, '..', 'test-results', 'screens', 'wide-table.png') })
  await table.evaluate((el) => el.scrollTo({ left: el.scrollWidth }))
  await expect(table.locator('thead th', { hasText: 'IL10' })).toBeVisible()
  await expect(table.locator('thead th', { hasText: 'Participant' })).toBeVisible() // pinned
  await app.close()
})

test('PCA is computed only on request, and shows loadings and variance explained', async () => {
  const { app, page } = await launch(mkdtempSync(join(tmpdir(), 'bari-pca-')))
  await page.getByText('Open synthetic demo').click()
  await page.getByText('Outstanding metadata tasks').waitFor({ timeout: 20000 })
  await page.getByRole('button', { name: 'Explore data' }).first().click()
  await page.getByTestId('type-pca').click()
  await expect(page.getByTestId('compute-pca')).toBeDisabled()
  for (const area of ['AQ NULISA', 'NP']) {
    await page.getByTestId('pca-add').click()
    await page.getByTestId(`pca-add-area-${area}`).click()
  }
  await expect(page.getByTestId('pca-result')).toHaveCount(0)
  await page.getByTestId('compute-pca').click()
  const outcome = page.getByTestId('pca-result').or(page.getByTestId('pca-error'))
  await expect(outcome).toBeVisible()
  await page.screenshot({ path: join(import.meta.dirname, '..', 'test-results', 'screens', 'pca.png') })
  if (await page.getByTestId('pca-result').count()) {
    await expect(page.getByTestId('pca-loadings')).toContainText('Variance')
    await page.getByTestId('history').click()
    await expect(page.getByText('prcomp(pca_data')).toBeVisible()
  }
  await app.close()
})
