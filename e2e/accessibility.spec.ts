// Accessibility checks that can be automated, on every page of the SYNTHETIC demo project: each control a keyboard or
// screen-reader user meets has a name and can be reached with the keyboard, form fields have labels, pages have a
// heading and landmarks, and focus is visible. This is not a full audit: colour contrast, reading order and real
// screen-reader behaviour are not checked here (see docs/LIMITATIONS.md).
import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { launch } from './helpers'

/** Runs in the page. Returns one line per control that has no accessible name or cannot be reached by keyboard. */
async function scan(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = []
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
    }
    const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
    const byIds = (ids: string | null) => (ids ?? '').split(/\s+/).filter(Boolean).map((id) => text(document.getElementById(id))).join(' ').trim()
    const nameOf = (el: Element): string => {
      const aria = el.getAttribute('aria-label')?.trim()
      if (aria) return aria
      const labelled = byIds(el.getAttribute('aria-labelledby'))
      if (labelled) return labelled
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
        const wrapping = el.closest('label')
        if (wrapping && text(wrapping)) return text(wrapping)
        if (el.id) {
          const forLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
          if (forLabel && text(forLabel)) return text(forLabel)
        }
        // A placeholder disappears when typing starts, so it does not count as a name.
        return el.getAttribute('title')?.trim() ?? ''
      }
      return text(el) || el.getAttribute('title')?.trim() || ''
    }
    const describe = (el: Element) => {
      const id = el.getAttribute('data-testid')
      const cls = (el.getAttribute('class') ?? '').split(/\s+/).slice(0, 3).join('.')
      const where = el.closest('[data-testid]')?.getAttribute('data-testid') ?? el.closest('.card-head, .topbar, .sidebar, .popover, .dialog')?.className ?? ''
      return `<${el.tagName.toLowerCase()}${id ? ` data-testid="${id}"` : ''}${cls ? ` class="${cls}"` : ''}${el instanceof HTMLInputElement ? ` type="${el.type}"` : ''}> in ${where || 'page'}`
    }
    const controls = document.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [role="checkbox"], [role="switch"], [role="menuitem"], [tabindex]')
    for (const el of controls) {
      if (!visible(el)) continue
      if (!nameOf(el)) problems.push(`no accessible name: ${describe(el)}`)
      const disabled = (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true'
      const tabindex = el.getAttribute('tabindex')
      const native = el instanceof HTMLButtonElement || el instanceof HTMLAnchorElement || el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement
      // A listbox is one Tab stop whose options are moved through with the arrow keys.
      const inListbox = el.getAttribute('role') === 'option' && !!el.closest('[role="listbox"][tabindex="0"]')
      if (!disabled && !inListbox && ((native && tabindex === '-1') || (!native && tabindex === null))) problems.push(`not reachable with the keyboard: ${describe(el)}`)
    }
    // Things that act as controls without being one: a click handler cannot be seen from here, but a pointer cursor can.
    for (const el of document.querySelectorAll('div, span, td, tr, li')) {
      if (!visible(el) || getComputedStyle(el).cursor !== 'pointer') continue
      if (el.closest('button, a[href], label, select, [role="button"], [role="tab"], [tabindex]')) continue
      if (el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer') continue // inherited
      if (el.querySelector('button, a[href], [tabindex]')) continue // the same action is offered by a control inside it
      problems.push(`looks clickable but is not a control: ${describe(el)} "${text(el).slice(0, 40)}"`)
    }
    for (const img of document.querySelectorAll('img')) if (visible(img) && !img.hasAttribute('alt')) problems.push(`image without alt: ${describe(img)}`)
    if (!document.querySelector('main, [role="main"]')) problems.push('no main landmark')
    if (!document.querySelector('h1, h2')) problems.push('no page heading')
    return [...new Set(problems)]
  })
}

test('every control on every page has a name and is reachable with the keyboard', async () => {
  const { app, page } = await launch(mkdtempSync(join(tmpdir(), 'bari-e2e-a11y-')))
  const found: Record<string, string[]> = {}
  const check = async (where: string) => {
    const p = await scan(page)
    if (p.length) found[where] = p
  }
  // The start screen has no <main> of its own design; check its controls only.
  found['welcome'] = (await scan(page)).filter((p) => !p.startsWith('no main landmark'))
  if (!found['welcome'].length) delete found['welcome']
  await page.getByText('Open synthetic demo').click()
  await page.getByText('Outstanding metadata tasks').waitFor()
  await check('overview')
  await page.getByRole('button', { name: 'Explore data' }).first().click()
  await page.getByTestId('analyze').waitFor()
  await check('explore: distribution')
  await page.getByTestId('analyze').click()
  await page.getByTestId('compute-stats').click()
  await page.getByTestId('stats-panel').waitFor()
  await check('explore: statistics panel')
  await page.getByTestId('history').click()
  await check('explore: history popover')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Two measures' }).click()
  await check('explore: two measures')
  await page.getByTestId('type-many').click()
  await check('explore: many measures')
  await page.getByRole('button', { name: 'Table', exact: true }).click()
  await check('explore: table')
  for (const name of ['Measurements', 'Data quality', 'Saved views', 'Export']) {
    await page.getByRole('button', { name }).first().click()
    await page.waitForTimeout(300)
    await check(name.toLowerCase())
    if (name === 'Data quality')
      for (const tab of ['Flag map', 'Import checks', 'Column groups', /^Comments/]) {
        await page.getByRole('tab', { name: tab }).click()
        await page.waitForTimeout(200)
        await check(`data quality: ${tab}`)
      }
  }
  await page.getByTestId('backup').click()
  await check('backup popover')
  await page.keyboard.press('Escape')
  await page.getByTestId('verify-records').click()
  await page.getByTestId('verify-result').waitFor()
  await check('verify popover')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Import workbook' }).click()
  await check('import dialog')
  await page.keyboard.press('Escape')
  expect(found).toEqual({})
  await app.close()
})

test('focus is visible, and the main flow works from the keyboard alone', async () => {
  const { app, page } = await launch(mkdtempSync(join(tmpdir(), 'bari-e2e-a11y-kb-')))
  await page.getByText('Open synthetic demo').click()
  await page.getByText('Outstanding metadata tasks').waitFor()
  // Tab moves focus onto a control, and the focused control shows an outline or ring.
  await page.keyboard.press('Tab')
  const ring = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body) return null
    const s = getComputedStyle(el)
    return { tag: el.tagName, outline: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0, shadow: s.boxShadow !== 'none' }
  })
  expect(ring).not.toBeNull()
  expect(ring!.outline || ring!.shadow).toBe(true)
  // Page shortcuts, then open the statistics panel and compute without the mouse.
  await page.keyboard.press('ControlOrMeta+2')
  await expect(page.getByRole('heading', { name: 'Explore data' })).toBeVisible()
  await page.getByTestId('analyze').focus()
  await page.keyboard.press('Enter')
  await page.getByTestId('compute-stats').focus()
  await page.keyboard.press('Space')
  await expect(page.getByTestId('stats-panel')).toBeVisible()
  // A popover opens from the keyboard, takes focus, and Escape closes it and returns focus to its button.
  await page.getByTestId('history').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('analysis-register')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('analysis-register')).toHaveCount(0)
  // Focus returns once the popover has finished closing.
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('history')

  // The observation table is one Tab stop; arrow keys move between values and Enter opens the source inspector.
  const table = page.getByTestId('observations-table')
  await table.scrollIntoViewIfNeeded()
  expect(await table.locator('td[tabindex="0"]').count()).toBe(1)
  await table.locator('td[tabindex="0"]').focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-cell'))).toBe('2:0')
  expect(await table.locator('td[tabindex="0"]').count()).toBe(1)
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  await expect(page.locator('.inspector, [data-testid="inspector"]').first()).toBeVisible()
  await app.close()
})
