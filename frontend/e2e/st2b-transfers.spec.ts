import { expect, test, type Page } from '@playwright/test'

/**
 * ST2b against a mocked API: a branch requests stock, the source branch dispatches less than
 * requested, and the goods are received short with some damaged (loss shown); the delivery
 * challan, purchase order and goods receipt PDFs; e-mailing a purchase order to the supplier.
 * Runs on desktop and mobile.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const paged = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

const me = {
  user: { id: 'u-1', name: 'Nadia Manager', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-1', name: 'Store Manager', system_key: null }],
  permissions: ['branches.view', 'inventory.view', 'inventory.transfer', 'products.view', 'products.view_cost', 'suppliers.view', 'purchases.view', 'purchases.manage', 'purchases.receive'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }, { id: 'b-2', code: 'NORTH', name: 'North', is_active: true }],
}

const branches = [
  {
    id: 'b-1', code: 'MAIN', name: 'Main Branch', email: null, phone: null, address: null, timezone: null, is_active: true, allow_negative_stock: false, created_at: '2026-10-01T00:00:00Z',
    stores: [{ id: 's-1', branch_id: 'b-1', code: 'FLOOR', name: 'Shop floor', type: 'store', is_active: true }],
  },
  {
    id: 'b-2', code: 'NORTH', name: 'North', email: null, phone: null, address: null, timezone: null, is_active: true, allow_negative_stock: false, created_at: '2026-10-01T00:00:00Z',
    stores: [{ id: 's-3', branch_id: 'b-2', code: 'NWH', name: 'North warehouse', type: 'warehouse', is_active: true }],
  },
]

const floor = { id: 's-1', code: 'FLOOR', name: 'Shop floor', branch_id: 'b-1', branch_name: 'Main Branch' }
const north = { id: 's-3', code: 'NWH', name: 'North warehouse', branch_id: 'b-2', branch_name: 'North' }
const juice = { id: 'v-1', product_id: 'p-1', product_name: 'Mango Juice 1L', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', track_batches: false, allow_decimal: false }
const juiceProduct = {
  id: 'p-1', name: 'Mango Juice 1L', type: 'standard', track_stock: true, track_batches: false, is_active: true,
  unit: { id: 'u-1', name: 'Piece', code: 'pcs', allow_decimal: false }, tax_rate: null,
  variants: [{ id: 'v-1', sku: 'JUICE-1L', name: null, option_values: {}, purchase_price: '20.0000', is_active: true }],
}

const requested = {
  id: 't-2', number: 'TRF-000002', status: 'requested', from_store: north, to_store: floor, note: null,
  can_receive: false, can_cancel: true, can_dispatch: true, can_reject: true, dispatched_at: null, completed_at: null,
  requested_at: '2026-11-26T09:00:00Z', requested_by: { id: 'u-1', name: 'Nadia Manager' }, loss_total: '0.00', has_discrepancy: false,
  lines: [{ id: 'r-1', variant: juice, batch: null, quantity: '12.000', requested_quantity: '12.000', unit_cost: null }],
}

const mills = { id: 'sup-1', code: 'SUP-000001', name: 'Local Mills' }
const supplierRow = { ...mills, contact_person: null, email: 'orders@mills.test', phone: null, address: null, tax_number: null, payment_terms_days: 30, opening_balance: '0.00', notes: null, is_active: true, archived_at: null }
const poLine = { id: 'pol-1', variant: juice, quantity: '10.000', received_quantity: '0.000', unit_cost: '100.0000', tax_rate: '0.0000', line_subtotal: '1000.00', line_tax: '0.00', line_total: '1000.00' }
const order = {
  id: 'po-1', number: 'PO-000001', status: 'ordered', supplier: mills, store: floor, currency: 'BDT', subtotal: '1000.00', tax_total: '0.00', total: '1000.00',
  notes: null, created_at: '2026-11-20T00:00:00Z', order_date: '2026-11-20', expected_date: null, ordered_at: '2026-11-20T00:00:00Z', lines: [poLine],
}
const receipt = {
  id: 'gr-1', number: 'GRN-000001', purchase_order_id: 'po-1', supplier: mills, store: floor, currency: 'BDT', subtotal: '1000.00', tax_total: '0.00', total: '1000.00',
  notes: null, created_at: '2026-11-21T00:00:00Z', supplier_invoice_number: 'LM-1', invoice_date: '2026-11-21', due_date: null,
  lines: [{ ...poLine, id: 'grl-1', returned_quantity: '0.000' }],
}

const pdf = (filename: string) => ({ status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"` }, body: '%PDF-1.4 e2e' })

type Captured = { request?: unknown; dispatch?: unknown; receive?: { lines: Record<string, unknown>[] }; email?: unknown }

async function mockBackend(page: Page) {
  const captured: Captured = {}
  let transfer: Record<string, unknown> = requested
  let po: Record<string, unknown> = order
  await page.addInitScript(() => localStorage.setItem('pos-session', JSON.stringify({ state: { activeBranchId: 'b-1' }, version: 0 })))
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: paged([]) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/branches?**', (route) => route.fulfill({ json: paged(branches) }))
  await page.route('**/api/v1/products?**', (route) => route.fulfill({ json: envelope([juiceProduct]) }))
  await page.route('**/api/v1/inventory/transfers/source-stores', (route) =>
    route.fulfill({ json: envelope([{ id: 's-1', code: 'FLOOR', name: 'Shop floor', branch: { id: 'b-1', name: 'Main Branch' } }, { id: 's-3', code: 'NWH', name: 'North warehouse', branch: { id: 'b-2', name: 'North' } }]) }))
  await page.route('**/api/v1/inventory/transfers?**', (route) => route.fulfill({ json: paged([{ ...transfer, lines: undefined, lines_count: 1 }]) }))
  await page.route('**/api/v1/inventory/transfers/requests', (route) => {
    captured.request = route.request().postDataJSON()
    return route.fulfill({ status: 201, json: envelope(transfer) })
  })
  await page.route('**/api/v1/inventory/transfers/t-2', (route) => route.fulfill({ json: envelope(transfer) }))
  await page.route('**/api/v1/inventory/transfers/t-2/dispatch', (route) => {
    captured.dispatch = route.request().postDataJSON()
    transfer = {
      ...requested, status: 'in_transit', can_dispatch: false, can_reject: false, can_cancel: true, can_receive: true, dispatched_at: '2026-11-26T11:00:00Z',
      lines: [{ ...requested.lines[0], quantity: '10.000', unit_cost: '20.0000' }],
    }
    return route.fulfill({ json: envelope(transfer) })
  })
  await page.route('**/api/v1/inventory/transfers/t-2/receive', (route) => {
    captured.receive = route.request().postDataJSON()
    transfer = {
      ...transfer, status: 'received', can_receive: false, can_cancel: false, completed_at: '2026-11-26T15:00:00Z', loss_total: '60.00', has_discrepancy: true,
      lines: [{ ...requested.lines[0], quantity: '10.000', unit_cost: '20.0000', received_quantity: '7.000', damaged_quantity: '2.000', short_quantity: '1.000', receive_note: 'Two cartons crushed' }],
    }
    return route.fulfill({ json: envelope(transfer) })
  })
  await page.route('**/api/v1/inventory/transfers/t-2/challan.pdf', (route) => route.fulfill(pdf('TRF-000002-challan.pdf')))
  await page.route('**/api/v1/suppliers/sup-1', (route) => route.fulfill({ json: envelope(supplierRow) }))
  await page.route('**/api/v1/purchasing/orders/po-1', (route) => route.fulfill({ json: envelope(po) }))
  await page.route('**/api/v1/purchasing/orders/po-1/pdf', (route) => route.fulfill(pdf('PO-000001.pdf')))
  await page.route('**/api/v1/purchasing/orders/po-1/email', (route) => {
    captured.email = route.request().postDataJSON()
    po = { ...order, emailed_at: '2026-11-26T10:00:00Z', emailed_to: 'orders@mills.test' }
    return route.fulfill({ json: envelope({ emailed_at: po.emailed_at, emailed_to: po.emailed_to }) })
  })
  await page.route('**/api/v1/purchasing/receipts/gr-1', (route) => route.fulfill({ json: envelope(receipt) }))
  await page.route('**/api/v1/purchasing/receipts/gr-1/pdf', (route) => route.fulfill(pdf('GRN-000001.pdf')))
  return captured
}

async function noSidewaysScroll(page: Page) {
  expect(await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')).toBeLessThanOrEqual(0)
}

test('requests stock, dispatches less than requested and receives it short with damage', async ({ page, isMobile }) => {
  const captured = await mockBackend(page)
  await page.goto('/admin/purchasing/orders/po-1')
  await expect(page.getByRole('heading', { name: 'PO-000001' })).toBeVisible()
  if (isMobile) await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Inventory', exact: true }).click()
  await page.getByRole('link', { name: 'Transfers' }).click()
  await page.getByRole('link', { name: 'Request stock' }).click()

  await expect(page.getByRole('heading', { name: 'Request stock' })).toBeVisible()
  await page.getByRole('combobox', { name: 'From store' }).click()
  await page.getByRole('option', { name: 'North warehouse · North' }).click()
  await page.getByRole('combobox', { name: 'To store' }).click()
  await page.getByRole('option', { name: 'Shop floor (FLOOR)' }).click()
  await page.getByRole('combobox', { name: 'Product of line 1' }).click()
  await page.getByPlaceholder('Name, SKU or barcode').fill('juice')
  await page.getByRole('option', { name: /Mango Juice 1L/ }).click()
  await page.getByLabel('Quantity of line 1').fill('12')
  await page.getByRole('button', { name: 'Send request' }).click()

  await expect(page).toHaveURL(/\/admin\/inventory\/transfers\/t-2$/)
  expect(captured.request).toEqual({ from_store_id: 's-3', to_store_id: 's-1', note: null, lines: [{ variant_id: 'v-1', quantity: '12' }] })
  await expect(page.getByRole('heading', { name: 'TRF-000002' })).toBeVisible()
  await expect(page.getByText('Requested', { exact: true }).first()).toBeVisible()

  await page.getByRole('button', { name: 'Dispatch' }).click()
  const dispatch = page.getByRole('dialog', { name: 'Dispatch TRF-000002' })
  await expect(dispatch.getByLabel('Send of line 1')).toHaveValue('12')
  await dispatch.getByLabel('Send of line 1').fill('10')
  await dispatch.getByRole('button', { name: 'Dispatch goods' }).click()
  await expect(dispatch).toBeHidden()
  expect(captured.dispatch).toEqual({ lines: [{ line_id: 'r-1', quantity: '10' }] })

  const challan = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Print challan' }).click()
  expect((await challan).suggestedFilename()).toBe('TRF-000002-challan.pdf')

  await page.getByRole('button', { name: 'Receive', exact: true }).click()
  const receive = page.getByRole('dialog', { name: 'Receive TRF-000002' })
  await receive.getByLabel('Received of line 1').fill('7')
  await receive.getByLabel('Damaged of line 1').fill('2')
  await expect(receive.getByLabel('Short of line 1')).toHaveText('1')
  await receive.getByLabel('Note of line 1').fill('Two cartons crushed')
  if (isMobile) await noSidewaysScroll(page)
  await receive.getByRole('button', { name: 'Receive goods' }).click()
  await expect(receive).toBeHidden()
  expect(captured.receive?.lines[0]).toEqual({ line_id: 'r-1', received_quantity: '7', damaged_quantity: '2', note: 'Two cartons crushed' })

  await expect(page.getByText('Discrepancy', { exact: true })).toBeVisible()
  await expect(page.getByTestId('loss-total')).toHaveText('BDT 60.00')
  await expect(page.getByRole('row', { name: /Mango Juice 1L/ })).toContainText('Two cartons crushed')
  if (isMobile) await noSidewaysScroll(page)
})

test('e-mails a purchase order to the supplier and prints it', async ({ page, isMobile }) => {
  const captured = await mockBackend(page)
  await page.goto('/admin/purchasing/orders/po-1')

  await expect(page.getByRole('heading', { name: 'PO-000001' })).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Print', exact: true }).click()
  expect((await download).suggestedFilename()).toBe('PO-000001.pdf')

  await page.getByRole('button', { name: 'E-mail to supplier' }).click()
  const dialog = page.getByRole('dialog', { name: 'E-mail PO-000001' })
  await expect(dialog.getByLabel('To')).toHaveValue('orders@mills.test')
  if (isMobile) await noSidewaysScroll(page)
  await dialog.getByRole('button', { name: 'Send e-mail' }).click()
  await expect(dialog).toBeHidden()
  expect(captured.email).toEqual({ to: 'orders@mills.test' })
  await expect(page.getByText(/E-mailed to orders@mills\.test on/)).toBeVisible()
})

test('prints a goods receipt', async ({ page }) => {
  await mockBackend(page)
  await page.goto('/admin/purchasing/receipts/gr-1')

  await expect(page.getByRole('heading', { name: 'GRN-000001' })).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Print', exact: true }).click()
  expect((await download).suggestedFilename()).toBe('GRN-000001.pdf')
})
