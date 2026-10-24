import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

export const root = join(import.meta.dirname, '..')

export function appExecutable(): { executablePath?: string; args: string[] } {
  if (process.env.BARI_E2E_PACKAGED) {
    const candidates = [
      join(root, 'release/mac-arm64/BARI-CNS Research Workspace.app/Contents/MacOS/BARI-CNS Research Workspace'),
      join(root, 'release/mac/BARI-CNS Research Workspace.app/Contents/MacOS/BARI-CNS Research Workspace')
    ]
    const exe = candidates.find(existsSync)
    if (!exe) throw new Error('Packaged app not found; run npm run dist:mac first.')
    return { executablePath: exe, args: [] }
  }
  return { args: [join(root, 'out/main/index.js')] }
}

export async function launch(userData: string, colorScheme: 'light' | 'dark' = 'light', opts: { tour?: boolean } = {}): Promise<{ app: ElectronApplication; page: Page }> {
  const { executablePath, args } = appExecutable()
  const app = await electron.launch({ executablePath, args, env: { ...process.env, BARI_USER_DATA: userData }, colorScheme })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  // Most tests skip the first-run tour; tour.spec.ts exercises it.
  if (!opts.tour) await page.evaluate(() => localStorage.setItem('bari.tour.v1', 'done'))
  return { app, page }
}

/** Replace native dialogs in the main process with deterministic answers. */
export async function mockDialogs(app: ElectronApplication, answers: { open?: string[][]; save?: string[] }) {
  await app.evaluate(({ dialog }, a) => {
    const opens = [...(a.open ?? [])]
    const saves = [...(a.save ?? [])]
    dialog.showOpenDialog = (async () => {
      const next = opens.shift()
      return next ? { canceled: false, filePaths: next } : { canceled: true, filePaths: [] }
    }) as any
    dialog.showSaveDialog = (async () => {
      const next = saves.shift()
      return next ? { canceled: false, filePath: next } : { canceled: true, filePath: undefined }
    }) as any
  }, answers)
}

export async function invoke<T = any>(page: Page, channel: string, payload?: unknown): Promise<T> {
  const r = await page.evaluate(([c, p]) => (window as any).bari.invoke(c, p), [channel, payload] as const)
  if (!r.ok) throw new Error(r.error)
  return r.data
}
