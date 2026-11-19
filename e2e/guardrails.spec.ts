// Statistical guardrails in the UI, on a SYNTHETIC two-visit file written by this test: the independence guard blocks
// tests on repeated visits and offers the one-visit fix, censoring is shown as a percentage, p-values are displayed
// neutrally, and each computed analysis lands in the analysis register.
import { test, expect } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { launch, mockDialogs, invoke, root } from './helpers'

const userData = mkdtempSync(join(tmpdir(), 'bari-e2e-guard-ud-'))
const work = mkdtempSync(join(tmpdir(), 'bari-e2e-guard-'))
const shots = join(root, 'test-results', 'e2e')

/** 14 synthetic participants at Baseline, 13 again at Month 6; Assay has values below a detection limit. */
function longitudinalCsv(): string {
  const lines = ['Subject_ID,Event Name,Arm,Marker,Score,Assay']
  for (let i = 1; i <= 14; i++) {
    const id = `DEMO-${String(i).padStart(2, '0')}`
    const arm = i % 2 ? 'A' : 'B'
    const marker = 10 + i * 0.5 + (i % 2 ? 1.5 : 0) + (i % 5) * 0.3
    const score = 3 + i * 0.8 + (i % 3) * 0.7
    lines.push(`${id},Baseline,${arm},${marker},${score},${i <= 2 ? '<0.5' : (0.6 + i * 0.11).toFixed(2)}`)
    if (i !== 14) lines.push(`${id},Month 6,${arm},${marker + 2 + (i % 3) * 0.1},${score + 1},${i <= 5 ? '<0.5' : (0.7 + i * 0.1).toFixed(2)}`)
  }
  return lines.join('\n') + '\n'
}

test('repeated visits block tests until one visit is chosen; analyses are registered', async () => {
  const csv = join(work, 'synthetic_longitudinal.csv')
  writeFileSync(csv, longitudinalCsv())
  const { app, page } = await launch(userData)
  await mockDialogs(app, { open: [[work], [csv]] })

  await page.getByLabel('New project name').fill('E2E guardrails')
  await page.getByRole('button', { name: /Create project/ }).click()
  await page.getByRole('button', { name: /Choose file/ }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByLabel('Participant identifier column')).toHaveValue('1')
  await page.getByText('I confirm these columns identify participants').click()
  await page.getByRole('button', { name: /Check data/ }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: /Commit import/ }).click()
  await expect(page.getByText('Outstanding metadata tasks')).toBeVisible()

  await page.getByRole('button', { name: 'Explore data' }).first().click()
  await page.getByTestId('measure-picker').click()
  await page.getByLabel('Search measures').fill('Marker')
  await page.keyboard.press('Enter')
  await page.getByTestId('group-picker').click()
  await page.getByLabel('Search measures').fill('Arm')
  await page.keyboard.press('Enter')

  // All visits: 27 rows from 14 participants. No test, interval or normality check may appear.
  await page.getByTestId('analyze').click()
  await page.getByTestId('compute-stats').click()
  const panel = page.getByTestId('stats-panel')
  await expect(page.getByTestId('independence-guard')).toContainText('Tests were not run')
  await expect(page.getByTestId('independence-guard')).toContainText('27 observations come from 14 participants')
  await expect(panel).not.toContainText('Shapiro–Wilk')
  await expect(panel).not.toContainText("Welch's t-test")
  await expect(panel).not.toContainText(/p [=<]/)
  await expect(page.getByTestId('register-note')).toHaveCount(0)
  await panel.scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(shots, 'guard-01-blocked.png') })
  expect((await invoke(page, 'analysis:list', { datasetVersionId: null })).totals).toEqual({ analyses: 0, tests: 0 })

  // The offered fix: one click restricts the selection to a visit, and the tests run.
  await page.getByTestId('restrict-visit').first().click()
  await expect(page.getByTestId('independence-guard')).toHaveCount(0)
  await expect(panel).toContainText("Welch's t-test")
  await expect(panel).toContainText('observations at Baseline')
  // p-values carry no accent below .05.
  await expect(panel.locator('.badge.accent')).toHaveCount(0)
  await expect(page.getByTestId('register-note')).toContainText('this project has 1 recorded analysis with 4 p-values')
  await panel.scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(shots, 'guard-02-one-visit.png') })

  // Censoring is shown as a share of measured values, next to the summary.
  await page.getByTestId('measure-picker').click()
  await page.getByLabel('Search measures').fill('Assay')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('censoring-note')).toContainText('below a detection limit')
  await expect(page.getByTestId('censored-cell').first()).toContainText(/%/)
  await expect(page.getByTestId('register-note')).toContainText('2 recorded analyses')

  // The register is listed in History and survives as the single count of tests run.
  await page.locator('.content').evaluate((el) => el.scrollTo(0, 0))
  await page.getByTestId('history').click()
  await expect(page.getByTestId('register-totals')).toContainText('2 analyses')
  await expect(page.getByTestId('analysis-register')).toContainText('Marker by Arm')
  await page.keyboard.press('Escape')
  const list = await invoke(page, 'analysis:list', { datasetVersionId: null })
  expect(list.entries).toHaveLength(2)
  expect(JSON.stringify(list)).not.toMatch(/DEMO-\d\d/)

  // The descriptive many-measures views are not blocked, but say when visits are pooled.
  await page.getByTestId('visit-picker').click()
  await page.getByRole('button', { name: 'All visits', exact: true }).click()
  await page.getByTestId('type-many').click()
  await expect(page.getByTestId('pooled-visits')).toContainText('27 rows come from 14 participants')
  await page.getByTestId('pooled-visits').getByTestId('restrict-visit').last().click()
  await expect(page.getByTestId('pooled-visits')).toHaveCount(0)

  expect((await invoke(page, 'app:networkLog')).blocked).toEqual([])
  await app.close()
})
