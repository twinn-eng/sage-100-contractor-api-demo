// `npm run screenshots`: the README images, taken against the mock backend.

import { expect, test, type Locator, type Page } from '@playwright/test'
import { fillAllocation, pick } from './helpers.ts'

const OUT = 'docs/screenshots'

/** A full-width shot from the top of `from` to the bottom of `to`, with a margin. */
async function shot(page: Page, name: string, from: Locator, to: Locator = from) {
  const a = (await from.boundingBox())!
  const b = (await to.boundingBox())!
  const scrollY = await page.evaluate(() => window.scrollY)
  const y = Math.max(0, a.y + scrollY - 24)
  const bottom = Math.max(a.y + a.height, b.y + b.height) + scrollY + 24
  const width = page.viewportSize()!.width
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, clip: { x: 0, y, width, height: bottom - y } })
}

async function addTransferLine(page: Page) {
  await page.getByRole('button', { name: 'Add line' }).click()
  const line = page.getByTestId('line-2')
  await pick(line, 'Part', /1\/2in PEX-A tubing/, 'pex tubing')
  await line.getByRole('textbox', { name: 'Quantity' }).fill('2')
  await pick(line, 'Source', /Main warehouse/)
  await pick(line, 'Destination', /Service van 1/, 'van 1')
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('combobox', { name: 'Company' })).toHaveValue(/Demo company/)
  // A sticky bar would repeat in the middle of a full-page clip.
  await page.addStyleTag({ content: '.topbar { position: static; }' })
})

test('form filled', async ({ page }) => {
  await fillAllocation(page, { ticket: 'T-5016', quantity: '6' })
  await addTransferLine(page)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.mouse.move(0, 0)
  await expect(page.getByTestId('line-2')).toContainText('available')
  await page.evaluate(() => window.scrollTo(0, 0))
  await shot(page, 'form-filled', page.locator('.topbar'), page.locator('.actions'))
})

test('dropdown open, showing pagination', async ({ page }) => {
  await fillAllocation(page, { ticket: 'T-5016', quantity: '6' })
  await page.getByRole('button', { name: 'Add line' }).click()
  const line = page.getByTestId('line-2')
  const part = line.getByRole('combobox', { name: 'Part' })
  await part.click()
  await expect(page.getByRole('status').filter({ hasText: 'Page 1 of 3, 64 records' })).toBeVisible()
  await page.getByRole('button', { name: 'Next page' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Page 2 of 3' })).toBeVisible()
  await page.mouse.move(0, 0)
  await part.press('ArrowDown')
  await part.press('ArrowDown')
  await line.scrollIntoViewIfNeeded()
  await shot(page, 'dropdown-pagination', line, page.locator('.cb-pop'))
})

test('successful result', async ({ page }) => {
  await fillAllocation(page, { ticket: 'T-5016', quantity: '6' })
  await addTransferLine(page)
  await page.getByRole('button', { name: 'Save allocation' }).click()
  const result = page.getByTestId('result')
  await expect(result.getByRole('heading', { name: /Allocation \d+ saved/ })).toBeVisible()
  const recordNumber = (await result.getByRole('heading').first().textContent())!.match(/\d+/)![0]
  await page.getByTestId('recent').getByRole('button', { name: `Show lines of allocation ${recordNumber}` }).click()
  await page.mouse.move(0, 0)
  await shot(page, 'result-success', result, page.getByTestId('recent'))
})

test('error state', async ({ page }) => {
  await fillAllocation(page, { ticket: 'T-5017', quantity: '60' })
  await page.getByRole('button', { name: 'Save allocation' }).click()
  const banner = page.getByTestId('result-error')
  await expect(banner).toContainText('INSUFFICIENT_INVENTORY')
  await shot(page, 'error-insufficient-inventory', page.getByTestId('line-1'), banner)
})
