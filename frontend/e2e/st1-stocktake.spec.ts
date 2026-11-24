import { expect, test, type Page } from '@playwright/test'

/**
 * ST1 against a mocked API: starting a stocktake, counting with a keyboard-wedge scanner (type +
 * Enter, the box keeps the focus), typing a count, posting with uncounted items set to zero, the
 * read-only result; and supplier refunds (record into the drawer, void) next to supplier payments.
 * Runs on desktop and mobile (375 px wide, no sideways scrolling).
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const paged = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

const org = { id: 'o-1', name: 'Corner Shop', slug: 'corner-shop', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' }
const branch = { id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }
const user = (permissions: string[]) => ({
  user: { id: 'u-1', name: 'Rahim Uddin', email: 'rahim@corner.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: org, roles: [{ id: 'r-x', name: 'Role', system_key: null }], permissions, branches: [branch],
})
const branches = [{
  id: 'b-1', code: 'MAIN', name: 'Main Branch', email: null, phone: null, address: null, timezone: null, is_active: true, allow_negative_stock: false, created_at: '2026-10-01T00:00:00Z',
  stores: [{ id: 's-1', branch_id: 'b-1', code: 'FLOOR', name: 'Shop floor', type: 'store', is_active: true }],
}]
const store = { id: 's-1', code: 'FLOOR', name: 'Shop floor', branch_id: 'b-1', branch_name: 'Main Branch' }

async function signedIn(page: Page, me: unknown) {
  await page.addInitScript(() => localStorage.setItem('pos-session', JSON.stringify({ state: { activeBranchId: 'b-1' }, version: 0 })))
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: paged([]) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/branches?**', (route) => route.fulfill({ json: paged(branches) }))
}

async function phoneWidth(page: Page, isMobile: boolean) {
  if (isMobile) await page.setViewportSize({ width: 375, height: 812 })
}

async function noSidewaysScroll(page: Page) {
  expect(await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')).toBeLessThanOrEqual(0)
}

const MANAGER = ['branches.view', 'products.view', 'inventory.view', 'inventory.adjust', 'inventory.stocktake']

const soap = { id: 'v-2', name: null, sku: 'SOAP-1', barcode: '4006381333931', product_name: 'Soap', allow_decimal: false }
const oil = { id: 'v-3', name: '1L', sku: 'OIL-1L', barcode: '8901234567890', product_name: 'Soybean Oil', allow_decimal: false }

test('stocktake: start, scan with a wedge scanner, type a count, post with uncounted set to zero', async ({ page, isMobile }) => {
  await phoneWidth(page, isMobile)
  const summary = (counted: number) => ({ lines: 3, counted, uncounted: 3 - counted, with_variance: 1, variance_quantity_in: '1.000', variance_quantity_out: '-2.000', variance_value: '-30.00' })
  let current: Record<string, unknown> = {
    id: 'st-1', number: 'ST-000001', status: 'counting', scope: 'all', scope_ids: null, blind: false, notes: null, store_id: 's-1', store,
    started_at: '2026-11-24T03:00:00Z', posted_at: null, posted_by: null, adjustment: null, uncounted_policy: null,
    created_by: { id: 'u-1', name: 'Rahim Uddin' }, created_at: '2026-11-24T02:59:00Z', summary: summary(0),
  }
  let soapCount = 0
  let oilCount: string | null = null
  const lines = () => [
    { id: 'ln-1', variant: soap, batch: null, system_quantity: soapCount ? '12.000' : null, counted_quantity: soapCount ? `${soapCount}.000` : null, difference: soapCount ? `${soapCount - 12}.000` : null, value_difference: null, counted_at: null, counted_by: null },
    { id: 'ln-2', variant: oil, batch: null, system_quantity: oilCount ? '5.000' : null, counted_quantity: oilCount, difference: oilCount ? '2.000' : null, value_difference: null, counted_at: null, counted_by: null },
  ]
  let created: unknown
  const scans: unknown[] = []
  let counts: unknown
  let posted: unknown

  await signedIn(page, user(MANAGER))
  await page.route('**/api/v1/inventory/stocktakes?**', (route) => route.fulfill({ json: paged([]) }))
  await page.route('**/api/v1/inventory/stocktakes', (route) => {
    created = route.request().postDataJSON()
    return route.fulfill({ status: 201, json: envelope({ ...current, status: 'draft', started_at: null }) })
  })
  await page.route('**/api/v1/inventory/stocktakes/st-1/start', (route) => route.fulfill({ json: envelope(current) }))
  await page.route('**/api/v1/inventory/stocktakes/st-1', (route) => route.fulfill({ json: envelope(current) }))
  await page.route('**/api/v1/inventory/stocktakes/st-1/lines?**', (route) => route.fulfill({ json: paged(lines()) }))
  await page.route('**/api/v1/inventory/stocktakes/st-1/scan', (route) => {
    const body = route.request().postDataJSON() as { barcode: string; quantity?: string }
    scans.push(body)
    if (body.barcode !== soap.barcode) return route.fulfill({ status: 422, json: { success: false, error: { code: 'UNKNOWN_BARCODE', message: 'Unknown barcode.', details: {} }, meta: { request_id: 'e2e' } } })
    soapCount += Number(body.quantity ?? 1)
    current = { ...current, summary: summary(1) }
    return route.fulfill({ json: envelope({ line: lines()[0], progress: { lines: 3, counted: 1 } }) })
  })
  await page.route('**/api/v1/inventory/stocktakes/st-1/lines', (route) => {
    counts = route.request().postDataJSON()
    oilCount = '7.000'
    current = { ...current, summary: summary(2) }
    return route.fulfill({ json: envelope({ lines: [lines()[1]] }) })
  })
  await page.route('**/api/v1/inventory/stocktakes/st-1/post', (route) => {
    posted = route.request().postDataJSON()
    current = { ...current, status: 'posted', posted_at: '2026-11-24T06:00:00Z', posted_by: { id: 'u-1', name: 'Rahim Uddin' }, uncounted_policy: 'zero', adjustment: { id: 'a-9', number: 'ADJ-000009' } }
    return route.fulfill({ json: envelope(current) })
  })

  await page.goto('/admin/inventory/stocktakes')
  await expect(page.getByRole('link', { name: 'Stocktakes' })).toBeVisible()
  await page.getByRole('button', { name: 'New stocktake' }).click()
  const dialog = page.getByRole('dialog', { name: 'New stocktake' })
  await dialog.getByRole('combobox', { name: 'Store' }).click()
  await page.getByRole('option', { name: 'Shop floor (FLOOR)' }).click()
  await dialog.getByRole('button', { name: 'Start counting' }).click()
  await expect(page).toHaveURL(/\/admin\/inventory\/stocktakes\/st-1$/)
  expect(created).toEqual({ store_id: 's-1', scope: 'all', blind: false, notes: null })

  // A wedge scanner "types" the code and presses Enter; the box clears and keeps the focus.
  const box = page.getByLabel('Scan or type a barcode')
  await expect(box).toBeFocused()
  await page.keyboard.type('4006381333931')
  await page.keyboard.press('Enter')
  const result = page.getByRole('status', { name: 'Scan result' })
  await expect(result).toContainText('Added 1 × Soap')
  await expect(result).toContainText('Counted: 1')
  await expect(box).toHaveValue('')
  await expect(box).toBeFocused()
  await page.keyboard.type('4006381333931')
  await page.keyboard.press('Enter')
  await expect(result).toContainText('Counted: 2')
  await page.keyboard.type('123')
  await page.keyboard.press('Enter')
  await expect(result).toContainText('No product has the barcode 123.')
  await expect(page.getByRole('list', { name: 'Last scans' }).getByRole('listitem')).toHaveCount(2)
  expect(scans).toEqual([{ barcode: '4006381333931' }, { barcode: '4006381333931' }, { barcode: '123' }])

  // A count typed by hand.
  const oilInput = page.getByLabel('Counted quantity of Soybean Oil — 1L')
  await oilInput.fill('7')
  await oilInput.press('Enter')
  await expect.poll(() => counts).toEqual({ lines: [{ variant_id: 'v-3', batch_id: null, counted_quantity: '7' }] })
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2')
  if (isMobile) await noSidewaysScroll(page)

  await page.getByRole('button', { name: 'Post', exact: true }).click()
  const post = page.getByRole('dialog', { name: 'Post stocktake ST-000001?' })
  await expect(post).toContainText('2 of 3')
  await post.getByRole('radio', { name: /Set them to zero/ }).check()
  await post.getByRole('button', { name: 'Post stocktake' }).click()

  await expect(page.getByRole('link', { name: 'ADJ-000009' })).toHaveAttribute('href', '/admin/inventory/adjustments/a-9')
  expect(posted).toEqual({ uncounted_policy: 'zero' })
  await expect(page.getByLabel('Scan or type a barcode')).toHaveCount(0)
  await expect(page.getByText('Set to zero')).toBeVisible()
  if (isMobile) await noSidewaysScroll(page)
})

const supplier = { id: 'sup-1', code: 'SUP-000001', name: 'Local Mills' }

test('supplier refunds: record one into the drawer, then void it; the payment dialog says where cash comes from', async ({ page, isMobile }) => {
  await phoneWidth(page, isMobile)
  const refund = (overrides: Record<string, unknown> = {}) => ({
    id: 'sr-1', number: 'SREF-000001', supplier, branch_id: 'b-1', currency: 'BDT', amount: '150.00', method: 'cash', reference: 'CR-77',
    received_on: '2026-11-24', notes: null, created_at: '2026-11-24T08:00:00Z', voided_at: null, voided_by: null, void_reason: null, ...overrides,
  })
  let list: unknown[] = []
  let recorded: unknown
  let key: string | undefined
  let voided: unknown

  await signedIn(page, user(['branches.view', 'purchases.view', 'purchases.pay', 'suppliers.view']))
  await page.route('**/api/v1/suppliers?**', (route) => route.fulfill({ json: paged([{ ...supplier, contact_person: null, phone: null, email: null, payment_terms_days: 30, opening_balance: '0.00', is_active: true, archived_at: null }]) }))
  await page.route('**/api/v1/purchasing/supplier-refunds?**', (route) => route.fulfill({ json: paged(list) }))
  await page.route('**/api/v1/purchasing/supplier-refunds', (route) => {
    recorded = route.request().postDataJSON()
    key = route.request().headers()['idempotency-key']
    list = [refund()]
    return route.fulfill({ status: 201, json: envelope(refund()) })
  })
  await page.route('**/api/v1/purchasing/supplier-refunds/sr-1/void', (route) => {
    voided = route.request().postDataJSON()
    list = [refund({ voided_at: '2026-11-24T09:00:00Z', voided_by: { id: 'u-1', name: 'Rahim Uddin' }, void_reason: 'wrong supplier' })]
    return route.fulfill({ json: envelope(list[0]) })
  })

  await page.goto('/admin/purchasing/supplier-refunds')
  await expect(page.getByText('No supplier refunds yet')).toBeVisible()
  await page.getByRole('button', { name: 'Record refund' }).click()
  const dialog = page.getByRole('dialog', { name: 'Record supplier refund' })
  await expect(dialog).toContainText('Cash goes into your open cash drawer.')
  await dialog.getByRole('combobox', { name: 'Supplier' }).click()
  await page.getByRole('option', { name: /Local Mills/ }).click()
  await dialog.getByLabel(/Amount/).fill('150')
  await dialog.getByRole('combobox', { name: 'Payment method' }).click()
  await page.getByRole('option', { name: 'Cash' }).click()
  await dialog.getByLabel('Reference').fill('CR-77')
  if (isMobile) await noSidewaysScroll(page)
  await dialog.getByRole('button', { name: 'Record refund' }).click()

  await expect(dialog).toBeHidden()
  expect(recorded).toMatchObject({ supplier_id: 'sup-1', branch_id: 'b-1', amount: '150', method: 'cash', reference: 'CR-77', notes: null })
  expect(key).toMatch(/^[0-9a-f-]{36}$/)
  await expect(page.getByRole('cell', { name: 'SREF-000001', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Void SREF-000001' }).click()
  const voidDialog = page.getByRole('dialog', { name: 'Void SREF-000001?' })
  await expect(voidDialog).toContainText('The cash comes out of your open cash drawer.')
  await voidDialog.getByLabel('Reason').fill('wrong supplier')
  await voidDialog.getByRole('button', { name: 'Void' }).click()
  await expect(page.getByText('Voided by Rahim Uddin: wrong supplier')).toBeVisible()
  expect(voided).toEqual({ reason: 'wrong supplier' })
  if (isMobile) await noSidewaysScroll(page)

  await page.getByRole('link', { name: 'Supplier payments' }).click()
  await page.getByRole('button', { name: 'Record payment' }).click()
  await expect(page.getByRole('dialog', { name: 'Record supplier payment' })).toContainText('Cash comes out of your open cash drawer')
})
