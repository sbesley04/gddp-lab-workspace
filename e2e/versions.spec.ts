// Comparing two imports of a study workbook through the UI, on the two SYNTHETIC demo workbooks (the second has one
// corrected value). Nothing is merged: the comparison only lists what differs.
import { test, expect } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { launch, mockDialogs, root } from './helpers'

test('a second import can be compared with the first', async () => {
  const work = mkdtempSync(join(tmpdir(), 'bari-e2e-versions-'))
  const { app, page } = await launch(mkdtempSync(join(tmpdir(), 'bari-e2e-versions-ud-')))
  await mockDialogs(app, { open: [[work], [join(root, 'tests/fixtures/demo_workbook.xlsx')], [join(root, 'tests/fixtures/demo_workbook_v2.xlsx')]] })
  const importCurrent = async () => {
    await page.getByRole('button', { name: /Choose file/ }).click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByText('I confirm these columns identify participants').click()
    await page.getByRole('button', { name: /Check data/ }).click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: /Commit import/ }).click()
  }
  await page.getByLabel('New project name').fill('E2E versions')
  await page.getByRole('button', { name: /Create project/ }).click()
  await importCurrent()
  await expect(page.getByText('Outstanding metadata tasks')).toBeVisible()

  // One version: there is nothing to compare, so the tab is not offered.
  await page.getByRole('button', { name: 'Data quality' }).click()
  await expect(page.getByRole('tab', { name: 'Version changes' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Import workbook' }).click()
  await importCurrent()
  await expect(page.getByText(/Imported as dataset v2/)).toBeVisible()
  await page.getByRole('button', { name: 'Data quality' }).click()
  await page.getByRole('tab', { name: 'Version changes' }).click()
  const panel = page.getByTestId('version-changes')
  await expect(panel).toContainText('v1 → v2')
  await expect(page.getByTestId('version-totals')).toHaveText('1 changed · 0 filled in (were empty) · 0 now empty')
  await expect(page.getByTestId('version-cells').locator('tbody tr')).toHaveCount(1)
  await expect(page.getByTestId('version-cells')).toContainText('21')
  await expect(page.getByTestId('versions-identical')).toHaveCount(0)
  await page.screenshot({ path: join(root, 'test-results', 'e2e', 'versions-01.png') })
  await app.close()
})
