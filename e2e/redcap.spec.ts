// A SYNTHETIC REDCap record export and data dictionary through the UI: the export imports with its own identifier and
// event columns, and the dictionary is previewed, then applied as tentative metadata.
import { test, expect } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { launch, mockDialogs, invoke, root } from './helpers'

const RECORDS = [
  'record_id,redcap_event_name,age,sex,phq_total,meds___1,meds___2,il6',
  ...Array.from({ length: 12 }, (_, i) => `${i + 1},baseline_arm_1,${40 + i},${(i % 2) + 1},${3 + i},${i % 2},${(i + 1) % 2},${(1.5 + i * 0.3).toFixed(1)}`)
].join('\n') + '\n'

const DICTIONARY = [
  '"Variable / Field Name","Form Name","Section Header","Field Type","Field Label","Choices, Calculations, OR Slider Labels","Field Note","Text Validation Type OR Show Slider Number","Text Validation Min","Text Validation Max",Identifier?',
  'record_id,demographics,,text,"Record ID",,,,,,',
  'age,demographics,,text,"Age at enrolment",,"In completed years",integer,18,90,y',
  'sex,demographics,,radio,"Sex recorded at birth","1, Female | 2, Male",,,,,',
  'phq_total,phq9,,calc,"PHQ-9 total score","sum([phq1],[phq2])",,,,,',
  'meds,medication_review,,checkbox,"Current medication","1, Antidepressant | 2, Statin",,,,,'
].join('\n') + '\n'

test('a REDCap export imports, and its data dictionary fills in tentative metadata', async () => {
  const work = mkdtempSync(join(tmpdir(), 'bari-e2e-redcap-'))
  const records = join(work, 'synthetic_redcap_export.csv')
  const dictionary = join(work, 'synthetic_data_dictionary.csv')
  writeFileSync(records, RECORDS)
  writeFileSync(dictionary, DICTIONARY)
  const { app, page } = await launch(mkdtempSync(join(tmpdir(), 'bari-e2e-redcap-ud-')))
  await mockDialogs(app, { open: [[work], [records], [dictionary], [dictionary]] })
  await page.getByLabel('New project name').fill('E2E REDCap')
  await page.getByRole('button', { name: /Create project/ }).click()
  await page.getByRole('button', { name: /Choose file/ }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  // record_id and redcap_event_name are suggested without being chosen.
  await expect(page.getByLabel('Participant identifier column')).toHaveValue('1')
  await page.getByText('I confirm these columns identify participants').click()
  await page.getByRole('button', { name: /Check data/ }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: /Commit import/ }).click()
  await expect(page.getByText('Outstanding metadata tasks')).toBeVisible()

  await page.getByRole('button', { name: 'Measurements' }).click()
  await page.getByTestId('import-dictionary').click()
  const dialog = page.getByTestId('dictionary-dialog')
  await expect(dialog).toContainText('It describes 5 of the measures in this dataset; 1 is not mentioned in it.')
  await expect(page.getByTestId('dictionary-summary')).toContainText('will be recorded as tentative')
  await expect(dialog).toContainText('Current medication: Antidepressant')
  await expect(dialog).toContainText('Units, specimens and assays are not in a data dictionary')
  await page.screenshot({ path: join(root, 'test-results', 'e2e', 'redcap-01-preview.png') })
  await page.getByTestId('apply-dictionary').click()
  await expect(page.getByText(/Data dictionary applied: \d+ value\(s\) on 5 measure\(s\)/)).toBeVisible()
  await expect(dialog).toHaveCount(0)

  // The labels are in use, marked tentative, and nothing was assumed about units.
  await expect(page.getByRole('option', { name: /PHQ-9 total score/ })).toBeVisible()
  const snap = await invoke(page, 'data:snapshot', { datasetVersionId: (await invoke(page, 'project:current')).versions[0].id, asOf: null })
  const phq = snap.variables.find((v: any) => v.header === 'phq_total')
  expect(phq.meta.displayLabel).toMatchObject({ value: 'PHQ-9 total score', status: 'tentative' })
  expect(phq.meta.unit.status).toBe('unknown')

  // A second import of the same dictionary has nothing to add.
  await page.getByTestId('import-dictionary').click()
  await expect(page.getByTestId('dictionary-dialog')).toContainText('Nothing to change')
  await expect(page.getByTestId('apply-dictionary')).toBeDisabled()
  await page.getByRole('button', { name: 'Cancel' }).click()
  expect((await invoke(page, 'integrity:verify')).ok).toBe(true)
  await app.close()
})
