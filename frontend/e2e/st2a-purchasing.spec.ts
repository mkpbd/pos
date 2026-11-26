import { expect, test, type Page } from '@playwright/test'

/**
 * ST2a against a mocked API: a goods receipt with 10 + 1 free at 5 % off (the cost per unit
 * after discount and free goods), a purchase order closed short, and a return without a
 * goods receipt. Runs on desktop and mobile.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const paged = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

const me = {
  user: { id: 'u-1', name: 'Nadia Buyer', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-1', name: 'Store Manager', system_key: null }],
  permissions: ['branches.view', 'inventory.view', 'products.view', 'suppliers.view', 'purchases.view', 'purchases.manage', 'purchases.receive', 'purchases.return'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
}

const branches = [{
  id: 'b-1', code: 'MAIN', name: 'Main Branch', email: null, phone: null, address: null, timezone: null, is_active: true, allow_negative_stock: false, created_at: '2026-10-01T00:00:00Z',
  stores: [{ id: 's-1', branch_id: 'b-1', code: 'FLOOR', name: 'Shop floor', type: 'store', is_active: true }],
}]

const mills = { id: 'sup-1', code: 'SUP-000001', name: 'Local Mills' }
const supplierRow = { ...mills, contact_person: null, email: null, phone: null, address: null, tax_number: null, payment_terms_days: 30, opening_balance: '0.00', notes: null, is_active: true, archived_at: null }
const store = { id: 's-1', code: 'FLOOR', name: 'Shop floor', branch_id: 'b-1', branch_name: 'Main Branch' }
const juice = { id: 'v-1', product_name: 'Mango Juice 1L', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', allow_decimal: false, track_batches: false }
const juiceProduct = {
  id: 'p-1', name: 'Mango Juice 1L', type: 'standard', track_stock: true, track_batches: true, is_active: true,
  unit: { id: 'u-1', name: 'Piece', code: 'pcs', allow_decimal: false }, tax_rate: null,
  variants: [{ id: 'v-1', sku: 'JUICE-1L', name: null, option_values: {}, purchase_price: '100.0000', is_active: true }],
}

// 10 + 1 free at 100 less 5 %: 950.00 + 15 % tax 142.50 = 1092.50; each of the 11 units cost 86.3636.
const juiceLine = {
  id: 'pol-1', variant: juice, quantity: '10.000', received_quantity: '0.000', unit_cost: '100.0000', tax_rate: '15.0000',
  discount_percent: '5.0000', bonus_quantity: '1.000', line_subtotal: '950.00', line_tax: '142.50', line_total: '1092.50',
}
const order = {
  id: 'po-1', number: 'PO-000001', status: 'ordered', supplier: mills, store, currency: 'BDT', subtotal: '950.00', tax_total: '142.50', total: '1092.50',
  notes: null, created_at: '2026-11-20T00:00:00Z', order_date: '2026-11-20', expected_date: null, ordered_at: '2026-11-20T00:00:00Z', lines: [juiceLine],
}
const receipt = {
  id: 'gr-1', number: 'GRN-000001', purchase_order_id: 'po-1', supplier: mills, store, currency: 'BDT', subtotal: '950.00', tax_total: '142.50', total: '1092.50',
  notes: null, created_at: '2026-11-21T00:00:00Z', supplier_invoice_number: 'LM-1', invoice_date: '2026-11-21', due_date: null,
  lines: [{ ...juiceLine, id: 'grl-1', returned_quantity: '0.000', effective_unit_cost: '86.3636' }],
}
const partOrder = {
  ...order, id: 'po-2', number: 'PO-000002', status: 'partially_received',
  lines: [{ ...juiceLine, id: 'pol-2', quantity: '20.000', received_quantity: '12.000' }],
}

type Captured = { receipt?: { lines: Record<string, unknown>[] }; close?: unknown; directReturn?: Record<string, unknown>; returnKey?: string | null }

async function mockBackend(page: Page) {
  const captured: Captured = {}
  let po2: Record<string, unknown> = partOrder
  await page.addInitScript(() => localStorage.setItem('pos-session', JSON.stringify({ state: { activeBranchId: 'b-1' }, version: 0 })))
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: paged([]) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/branches?**', (route) => route.fulfill({ json: paged(branches) }))
  await page.route('**/api/v1/suppliers?**', (route) => route.fulfill({ json: paged([supplierRow]) }))
  await page.route('**/api/v1/products?**', (route) => route.fulfill({ json: envelope([juiceProduct]) }))
  await page.route('**/api/v1/inventory/batches?**', (route) =>
    route.fulfill({ json: envelope([{ store, variant: null, batch: { id: 'bt-1', batch_number: 'L-7', expires_on: '2027-01-31' }, quantity: '40.000', is_expired: false }]) }))
  await page.route('**/api/v1/purchasing/orders/po-1', (route) => route.fulfill({ json: envelope(order) }))
  await page.route('**/api/v1/purchasing/orders/po-2', (route) => route.fulfill({ json: envelope(po2) }))
  await page.route('**/api/v1/purchasing/orders/po-2/close', (route) => {
    captured.close = route.request().postDataJSON()
    po2 = { ...po2, status: 'closed', closed_at: '2026-11-25T10:00:00Z', close_reason: 'Supplier discontinued it' }
    return route.fulfill({ json: envelope(po2) })
  })
  await page.route('**/api/v1/purchasing/receipts', (route) => {
    captured.receipt = route.request().postDataJSON()
    return route.fulfill({ status: 201, json: envelope(receipt) })
  })
  await page.route('**/api/v1/purchasing/receipts/gr-1', (route) => route.fulfill({ json: envelope(receipt) }))
  await page.route('**/api/v1/purchasing/returns', (route) => {
    captured.directReturn = route.request().postDataJSON()
    captured.returnKey = route.request().headers()['idempotency-key'] ?? null
    return route.fulfill({ status: 201, json: envelope({ id: 'prn-2', number: 'PRN-000002', supplier: mills, store, currency: 'BDT', subtotal: '180.00', tax_total: '0.00', total: '180.00', notes: null, created_at: '2026-11-25T00:00:00Z', goods_receipt_id: null, reason: 'Expired' }) })
  })
  await page.route('**/api/v1/purchasing/returns?**', (route) =>
    route.fulfill({ json: paged([{ id: 'prn-1', number: 'PRN-000001', supplier: mills, store, currency: 'BDT', subtotal: '90.00', tax_total: '0.00', total: '90.00', notes: null, created_at: '2026-11-24T00:00:00Z', goods_receipt_id: null, reason: 'Damaged' }]) }))
  return captured
}

async function noSidewaysScroll(page: Page) {
  expect(await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')).toBeLessThanOrEqual(0)
}

test('receives 10 + 1 free at 5 % off with the cost per unit after discount and free goods', async ({ page, isMobile }) => {
  const captured = await mockBackend(page)
  await page.goto('/admin/purchasing/receipts/new?order=po-1')

  await expect(page.getByRole('heading', { name: 'Receive PO-000001' })).toBeVisible()
  await expect(page.getByLabel('Free qty of line 1')).toHaveValue('1')
  await expect(page.getByLabel('Discount % of line 1')).toHaveValue('5')
  await expect(page.getByTestId('effective-cost-0')).toHaveText('86.3636')
  await expect(page.getByLabel('Previewed total')).toHaveText('BDT 1,092.50')
  if (isMobile) await noSidewaysScroll(page)

  await page.getByRole('button', { name: 'Post receipt' }).click()
  await expect(page).toHaveURL(/\/admin\/purchasing\/receipts\/gr-1$/)
  expect(captured.receipt?.lines[0]).toMatchObject({ variant_id: 'v-1', quantity: '10', unit_cost: '100', discount_percent: '5', bonus_quantity: '1', purchase_order_line_id: 'pol-1' })
  await expect(page.getByRole('heading', { name: 'GRN-000001' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Cost per unit after discount and free goods' })).toBeVisible()
  await expect(page.getByRole('row', { name: /Mango Juice 1L/ })).toContainText('86.3636')
})

test('closes a partly received order short with a reason', async ({ page }) => {
  const captured = await mockBackend(page)
  await page.goto('/admin/purchasing/orders/po-2')

  await expect(page.getByRole('heading', { name: 'PO-000002' })).toBeVisible()
  await page.getByRole('button', { name: 'Close short' }).click()
  const dialog = page.getByRole('dialog', { name: 'Close PO-000002 short' })
  await dialog.getByLabel('Reason').fill('Supplier discontinued it')
  await dialog.getByRole('button', { name: 'Close short' }).click()

  await expect(dialog).toBeHidden()
  expect(captured.close).toEqual({ reason: 'Supplier discontinued it' })
  await expect(page.getByText('Closed short', { exact: true })).toBeVisible()
  await expect(page.getByRole('note')).toContainText('Supplier discontinued it')
  await expect(page.getByRole('button', { name: 'Close short' })).toHaveCount(0)
})

test('returns goods to a supplier without a goods receipt', async ({ page, isMobile }) => {
  const captured = await mockBackend(page)
  await page.goto('/admin/purchasing/receipts')
  if (isMobile) await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('link', { name: 'Purchasing', exact: true }).click()
  await page.getByRole('navigation', { name: 'Purchasing sections' }).getByRole('link', { name: 'Returns' }).click()

  await expect(page.getByRole('row', { name: /PRN-000001/ })).toBeVisible()
  await page.getByRole('link', { name: 'New return (without receipt)' }).click()
  await expect(page.getByRole('heading', { name: 'New return (without receipt)' })).toBeVisible()

  await page.getByRole('combobox', { name: 'Supplier' }).click()
  await page.getByRole('option', { name: /Local Mills/ }).click()
  await page.getByRole('combobox', { name: 'From store' }).click()
  await page.getByRole('option', { name: /Shop floor/ }).click()
  await page.getByRole('combobox', { name: 'Product of line 1' }).click()
  await page.getByRole('option', { name: /Mango Juice 1L/ }).click()
  await page.getByLabel('Quantity of line 1').fill('2')
  await page.getByRole('combobox', { name: 'Batch' }).click()
  await page.getByRole('option', { name: /L-7/ }).click()
  await page.getByLabel('Unit cost of line 1').fill('90')
  await page.getByLabel('Reason').fill('Expired')
  await expect(page.getByLabel('Previewed total')).toHaveText('BDT 180.00')
  if (isMobile) await noSidewaysScroll(page)

  await page.getByRole('button', { name: 'Post return' }).click()
  await expect(page).toHaveURL(/\/admin\/purchasing\/returns$/)
  expect(captured.directReturn).toEqual({ supplier_id: 'sup-1', store_id: 's-1', reason: 'Expired', notes: null, lines: [{ variant_id: 'v-1', quantity: '2', batch_id: 'bt-1', unit_cost: '90' }] })
  expect(captured.returnKey).toBeTruthy()
})
