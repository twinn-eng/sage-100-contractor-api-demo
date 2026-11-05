import { expect, type Locator, type Page } from '@playwright/test'

/** Opens a paginated dropdown, optionally types a search, and picks the option containing `option`. */
export async function pick(scope: Page | Locator, label: string, option: string | RegExp, search?: string) {
  const input = scope.getByRole('combobox', { name: label, exact: true })
  await input.click()
  if (search !== undefined) await input.fill(search)
  const choice = scope.getByRole('option', { name: option }).first()
  await expect(choice).toBeVisible()
  await choice.click()
}

/** Fills the header and one issue line: 6 copper elbows from the main warehouse to a job. */
export async function fillAllocation(page: Page, opts: { ticket: string; quantity: string; status?: string }) {
  await page.getByRole('textbox', { name: 'Ticket #' }).fill(opts.ticket)
  await page.getByRole('textbox', { name: 'Description', exact: true }).first().fill('Rough-in material, second floor')
  await page.getByRole('textbox', { name: 'Delivery via' }).fill('Truck 2')
  await pick(page, 'Job', /Harbor View Clinic/, 'harbor view')
  await pick(page, 'Phase', /Rough-in/)
  await page.getByRole('combobox', { name: 'Status' }).selectOption({ label: opts.status ?? '4 Shipped' })

  const line = page.getByTestId('line-1')
  await pick(line, 'Part', /3\/4in copper elbow/, 'copper elbow')
  await line.getByRole('textbox', { name: 'Quantity' }).fill(opts.quantity)
  await pick(line, 'Source', /Main warehouse/)
  await pick(line, 'Account', /Material costs, job/, '5110')
  await pick(line, 'Cost code', /Rough plumbing/, 'rough plumbing')
  await pick(line, 'Cost type', /Material/)
}
