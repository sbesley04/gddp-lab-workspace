// `--verify-project` and `--self-test` are separate, short runs of the app. They must work while the app itself is
// open, including on the project it has open. Before this was fixed, a second copy sharing the first one's settings
// folder never became ready and hung until killed.
import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { mkdtempSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import electronPath from 'electron'
import { launch, root } from './helpers'

function run(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = execFile(electronPath as unknown as string, [join(root, 'out/main/index.js'), ...args], { env, timeout: 90_000 }, (err, stdout) => {
      resolve({ code: err ? ((err as { code?: number | null }).code ?? null) : 0, stdout, timedOut: !!(err as { killed?: boolean } | null)?.killed })
    })
    child.stdin?.end()
  })
}

test('the record check and the self-test run while the app is open', async () => {
  // Three separate starts of the app, each allowed 90 s on a slow or busy machine. A hang still fails the test.
  test.setTimeout(330_000)
  const userData = mkdtempSync(join(tmpdir(), 'bari-e2e-standalone-ud-'))
  const { app, page } = await launch(userData)
  await page.getByText('Open synthetic demo').click()
  await page.getByText('Outstanding metadata tasks').waitFor()
  const demo = join(userData, 'demo')
  const project = join(demo, readdirSync(demo).find((n) => n.endsWith('.bariproj'))!)
  expect(existsSync(join(project, '.lock'))).toBe(true) // the app has it open

  // The same settings folder as the running app: the case that used to hang.
  const shared = { ...process.env, BARI_USER_DATA: userData }
  const verify = await run(['--verify-project', project], shared)
  expect(verify.timedOut).toBe(false)
  expect(verify.code).toBe(0)
  const report = JSON.parse(verify.stdout)
  expect(report).toMatchObject({ ok: true, problemCount: 0 })
  expect(report.entries).toBeGreaterThan(0)

  const missing = await run(['--verify-project', join(userData, 'no-such.bariproj')], shared)
  expect(missing).toMatchObject({ code: 2, timedOut: false })

  const out = mkdtempSync(join(tmpdir(), 'bari-e2e-standalone-out-'))
  const selfTest = await run(['--self-test', out], shared)
  expect(selfTest.timedOut).toBe(false)
  expect(selfTest.code).toBe(0)
  expect(existsSync(join(out, 'bari-self-test.json'))).toBe(true)

  // The app that was open is untouched and still working.
  await page.getByRole('button', { name: 'Explore data' }).first().click()
  await expect(page.getByTestId('analyze')).toBeVisible()
  await app.close()
})
