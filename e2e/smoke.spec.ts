import { expect, test } from '@playwright/test'
import { fillAllocation, pick } from './helpers.ts'

test('picks from paginated dropdowns, validates, saves and sees the allocation land', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Inventory Allocation' })).toBeVisible()

  // Company selector: the configured companies, through the same dropdown.
  await pick(page, 'Company', /Demo company/)

  // Job dropdown: server-side pages, then a search.
  const job = page.getByRole('combobox', { name: 'Job', exact: true })
  await job.click()
  await expect(page.getByRole('status').filter({ hasText: 'Page 1 of 2, 32 records' })).toBeVisible()
  const list = page.getByRole('listbox', { name: 'Job' })
  await expect(list.getByRole('option')).toHaveCount(25)
  await page.getByRole('button', { name: 'Next page' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Page 2 of 2' })).toBeVisible()
  await expect(list.getByRole('option')).toHaveCount(7)
  await job.press('Escape')

  await fillAllocation(page, { ticket: 'E2E-100', quantity: '6' })
  await expect(page.getByTestId('line-1-stock')).toHaveText('At Main warehouse: 47 on hand, 40 available')

  await page.getByRole('button', { name: 'Validate only' }).click()
  const result = page.getByTestId('result')
  await expect(result.getByRole('heading', { name: 'Validated. Nothing was saved.' })).toBeVisible()
  await expect(result).toContainText('11.16')

  await page.getByRole('button', { name: 'Save allocation' }).click()
  await expect(result.getByRole('heading', { name: /Allocation \d+ saved/ })).toBeVisible()
  const heading = await result.getByRole('heading').first().textContent()
  const recordNumber = heading!.match(/\d+/)![0]
  await expect(result).toContainText('Job cost')
  await expect(page.getByTestId('recent').getByRole('row', { name: new RegExp(`${recordNumber}.*E2E-100`) })).toBeVisible()
})

test('maps INSUFFICIENT_INVENTORY to a banner and the quantity field', async ({ page }) => {
  await page.goto('/')
  await fillAllocation(page, { ticket: 'E2E-101', quantity: '500' })
  await page.getByRole('button', { name: 'Save allocation' }).click()
  const banner = page.getByTestId('result-error')
  await expect(banner).toContainText('Not enough stock at the source location')
  await expect(banner).toContainText('INSUFFICIENT_INVENTORY')
  await expect(page.getByTestId('line-1')).toContainText('More than is available at the source.')
})

test('checks two of source, destination and account before sending', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('textbox', { name: 'Ticket #' }).fill('E2E-102')
  await page.getByRole('textbox', { name: 'Description', exact: true }).first().fill('Check only')
  const line = page.getByTestId('line-1')
  await pick(line, 'Part', /1\/2in copper tee/, 'copper tee')
  await line.getByRole('textbox', { name: 'Quantity' }).fill('2')
  await pick(line, 'Source', /Main warehouse/)
  await page.getByRole('button', { name: 'Validate only' }).click()
  await expect(line).toContainText('Fill in two of source, destination and account.')
  await expect(page.getByTestId('result')).toHaveCount(0)
})
