// Full UI workflow on SYNTHETIC fixtures: create → import → filter/QC → agree → save view → restart →
// reproduce → context export → backup → restore, while asserting no network requests were attempted.
import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { unzipSync, strFromU8 } from 'fflate'
import { launch, mockDialogs, invoke, root } from './helpers'

const fixture = join(root, 'tests/fixtures/demo_workbook.xlsx')
const userData = mkdtempSync(join(tmpdir(), 'bari-e2e-ud-'))
const work = mkdtempSync(join(tmpdir(), 'bari-e2e-work-'))
const shots = join(root, 'test-results', 'e2e')

async function cohortRows(page: Page) {
  const t = await page.getByTestId('cohort-count').innerText()
  return Number(/^(\d+) of/.exec(t)![1])
}

test.describe.configure({ mode: 'serial' })

test('import, select, save, export, back up — all offline', async () => {
  let { app, page } = await launch(userData)
  await mockDialogs(app, { open: [[work], [fixture]] })

  // Create project and import
  await page.getByLabel('New project name').fill('E2E synthetic')
  await page.getByRole('button', { name: /Create project/ }).click()
  await expect(page.getByRole('heading', { name: 'Import a workbook' })).toBeVisible()
  await page.getByRole('button', { name: /Choose file/ }).click()
  await expect(page.getByText('Synthetic Demo Datasheet').first()).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByLabel('Participant identifier column')).toHaveValue('1')
  await page.getByText('I confirm these columns identify participants').click()
  await page.getByRole('button', { name: /Check data/ }).click()
  await expect(page.getByText('participants', { exact: true })).toBeVisible()
  await page.screenshot({ path: join(shots, '01-import-review.png') })
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: /Commit import/ }).click()
  await expect(page.getByText('Outstanding metadata tasks')).toBeVisible()
  await expect(page.getByText('24 participants', { exact: false }).first()).toBeVisible()

  // Explore: QC exclusion + cohort filter
  await page.getByRole('button', { name: 'Explore data' }).first().click()
  await page.getByTestId('qc-picker').click()
  await page.getByLabel('Exclude NULISA sample QC warning').check()
  await page.keyboard.press('Escape')
  await page.getByTestId('add-filter').click()
  await page.getByLabel('Search measures').fill('PHQ')
  await page.keyboard.press('Enter')
  await page.getByLabel('Minimum').fill('5')
  await page.getByRole('button', { name: 'Apply' }).click()
  const rows = await cohortRows(page)
  expect(rows).toBeGreaterThan(0)
  expect(rows).toBeLessThan(24)

  // Table, chart summary and export preview agree on the same rows
  const tableRows = await page.getByTestId('observations-table').locator('tbody tr:not([aria-hidden])').count()
  expect(tableRows).toBe(rows)
  const summaryN = Number(await page.getByTestId('summary').locator('div').nth(1).innerText())
  const excludedOrMissing = await page.locator('td.cell.missing, td.cell.excluded').count()
  expect(summaryN).toBeLessThanOrEqual(rows)
  expect(summaryN + excludedOrMissing).toBeGreaterThanOrEqual(rows - 2) // censored/text entries are reported separately
  await page.screenshot({ path: join(shots, '02-explore.png') })

  // Forced axis bounds: points outside are counted, not silently dropped
  await page.getByTestId('axis-bounds').click()
  await page.getByLabel('Y max').fill('8')
  await page.getByRole('button', { name: 'Apply' }).click()
  await expect(page.getByText(/outside the forced Y bounds/)).toBeVisible()

  // Statistics are offered, then computed only on request
  await page.getByTestId('analyze').click()
  await expect(page.getByTestId('stats-panel')).toHaveCount(0)
  await page.getByTestId('compute-stats').click()
  await expect(page.getByTestId('stats-panel')).toContainText('Shapiro–Wilk')

  // Save view with the suggested name (Enter accepts it)
  await page.getByTestId('save-view').click()
  const suggested = await page.getByTestId('view-name').inputValue()
  expect(suggested).toContain('IL6')
  expect(suggested).toContain('PHQ-9 total score ≥ 5')
  expect(suggested).toContain('excl. sample QC')
  await page.keyboard.press('Enter')
  await expect(page.getByText(`Saved view “${suggested}”`)).toBeVisible()

  // A second view (scatter with a fit) for the compare board
  await page.getByRole('button', { name: 'Two measures' }).click()
  await page.getByTestId('save-view').click()
  await page.keyboard.press('Enter')

  // Compare board: add both views, move a card, export
  await page.getByRole('button', { name: 'Saved views' }).click()
  await page.getByTestId('compare-tab').click()
  await page.getByTestId('new-board').click()
  await page.getByTestId('board-name').fill('E2E board')
  await page.getByTestId('board-add-view').click()
  await page.getByRole('button', { name: 'Add all views' }).click()
  await expect(page.getByTestId('board-card')).toHaveCount(2)
  const head = page.locator('.board-card-head').first()
  const cardTitle = await head.locator('.t').innerText()
  const card = page.getByTestId('board-card').filter({ has: page.locator('.t', { hasText: cardTitle }) })
  const box = (await head.boundingBox())!
  await page.mouse.move(box.x + 60, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 60, box.y + 260, { steps: 8 })
  await page.mouse.up()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 5000 })
  const movedTop = await card.evaluate((el) => (el as HTMLElement).style.top)
  expect(movedTop).not.toBe('40px')
  const boardSvg = join(work, 'board.svg')
  await mockDialogs(app, { save: [boardSvg] })
  await page.getByRole('button', { name: 'Download board' }).click()
  await page.getByRole('button', { name: /SVG \(vector\)/ }).click()
  await expect(page.getByText(/Board saved as/)).toBeVisible()
  const svgText = readFileSync(boardSvg, 'utf8')
  expect(svgText.startsWith('<svg')).toBe(true)
  expect(svgText).toContain('E2E board')
  expect((svgText.match(/<svg/g) ?? []).length).toBe(3) // board + two embedded charts
  await page.screenshot({ path: join(shots, '03b-board.png') })
  await page.getByRole('button', { name: 'Explore data' }).first().click()
  await page.getByRole('button', { name: 'Distribution' }).click()

  // Export preview rows equal selection rows
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await expect(page.getByTestId('export-preview')).toContainText('participant_key')
  const csv = await page.getByTestId('export-preview').innerText()
  expect(csv.trim().split('\n').length - 1).toBe(rows)
  expect(csv).not.toMatch(/DEMO-\d\d/)
  await page.getByTestId('question').fill('Exploratory: describe IL6 among participants with PHQ-9 ≥ 5.')
  const zipPath = join(work, 'context.zip')
  await mockDialogs(app, { save: [zipPath] })
  await page.getByTestId('write-export').click()
  await expect(page.getByRole('heading', { name: 'Package written' })).toBeVisible()
  await page.screenshot({ path: join(shots, '03-export.png') })
  const files = unzipSync(new Uint8Array(readFileSync(zipPath)))
  const manifest = JSON.parse(strFromU8(files['manifest.json']))
  expect(Object.keys(files).sort()).toEqual(['analysis_request.md', 'data_dictionary.csv', 'manifest.json', 'quality_flags.csv', 'selected_data.csv', 'study_context.md'])
  for (const f of manifest.files) expect(createHash('sha256').update(files[f.name]).digest('hex')).toBe(f.sha256)
  expect(manifest.selection.rows).toBe(rows)
  expect(JSON.stringify(manifest)).not.toContain(work)

  // No network attempts so far
  const net1 = await invoke<{ blocked: unknown[] }>(page, 'app:networkLog')
  expect(net1.blocked).toEqual([])
  await app.close()

  // Restart and reproduce the saved view
  ;({ app, page } = await launch(userData))
  await page.getByText('E2E synthetic').first().click()
  await page.getByRole('button', { name: 'Saved views' }).click()
  await page.getByTestId('open-view').first().click()
  await expect(page.getByText('reproduced exactly as saved')).toBeVisible()
  expect(await cohortRows(page)).toBe(rows)
  await page.screenshot({ path: join(shots, '04-reopened-view.png') })

  // The board and its layout survived the restart
  await page.getByRole('button', { name: 'Saved views' }).click()
  await page.getByTestId('compare-tab').click()
  await page.getByText('E2E board').click()
  await expect(page.getByTestId('board-card')).toHaveCount(2)
  expect(await page.getByTestId('board-card').filter({ has: page.locator('.t', { hasText: cardTitle }) }).evaluate((el) => (el as HTMLElement).style.top)).toBe(movedTop)

  // Backup, close, restore
  const backupPath = join(work, 'backup.bariproj.zip')
  await mockDialogs(app, { save: [backupPath], open: [[backupPath], [work]] })
  await page.getByRole('button', { name: 'Backup' }).click()
  await expect(page.getByText(/Backup saved/)).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByText('Restore a backup').click()
  await expect(page.getByText(/Backup restored and verified/)).toBeVisible()
  await expect(page.getByText('Outstanding metadata tasks')).toBeVisible()
  expect(existsSync(join(work, 'E2E synthetic (restored).bariproj', 'workspace.sqlite'))).toBe(true)
  const net2 = await invoke<{ blocked: unknown[] }>(page, 'app:networkLog')
  expect(net2.blocked).toEqual([])
  await app.close()
})
