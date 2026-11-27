import { expect, test, type Page } from '@playwright/test'

/**
 * ST2d against a mocked API: phones are received with one serial number each, the serials are
 * found in stock on the Serial numbers page, a serial's history links its documents, and the stock
 * value is shown as of a past month-end. Runs on desktop and mobile.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const paged = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

const me = {
  user: { id: 'u-1', name: 'Nadia Manager', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Phones', slug: 'berry-phones', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-1', name: 'Store Manager', system_key: null }],
  permissions: ['branches.view', 'inventory.view', 'inventory.adjust', 'products.view', 'products.view_cost', 'suppliers.view', 'purchases.view', 'purchases.receive', 'purchases.return'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
}

const branches = [
  {
    id: 'b-1', code: 'MAIN', name: 'Main Branch', email: null, phone: null, address: null, timezone: null, is_active: true, allow_negative_stock: false, created_at: '2026-10-01T00:00:00Z',
    stores: [{ id: 's-1', branch_id: 'b-1', code: 'FLOOR', name: 'Shop floor', type: 'store', is_active: true }],
  },
]

const floor = { id: 's-1', code: 'FLOOR', name: 'Shop floor', branch_id: 'b-1', branch_name: 'Main Branch' }
const hub = { id: 'sup-1', code: 'SUP-000001', name: 'Phone Hub' }
const supplierRow = { ...hub, contact_person: null, email: null, phone: null, address: null, tax_number: null, payment_terms_days: 0, opening_balance: '0.00', notes: null, is_active: true, archived_at: null }
const phone = { id: 'v-9', product_id: 'p-9', product_name: 'Phone X', variant_name: null, sku: 'PHONE-X', unit_code: 'pcs', track_batches: false, allow_decimal: false, track_serials: true }
const phoneProduct = {
  id: 'p-9', name: 'Phone X', type: 'standard', track_stock: true, track_batches: false, track_serials: true, is_active: true,
  unit: { id: 'u-1', name: 'Piece', code: 'pcs', allow_decimal: false }, tax_rate: null,
  variants: [{ id: 'v-9', sku: 'PHONE-X', name: null, option_values: {}, purchase_price: '900.0000', is_active: true }],
}
const receipt = {
  id: 'gr-1', number: 'GRN-000001', purchase_order_id: null, supplier: hub, store: floor, currency: 'BDT', subtotal: '1800.00', tax_total: '0.00', total: '1800.00',
  notes: null, created_at: '2026-11-21T00:00:00Z', supplier_invoice_number: null, invoice_date: '2026-11-21', due_date: null,
  lines: [{
    id: 'grl-1', variant: phone, quantity: '2.000', returned_quantity: '0.000', unit_cost: '900.0000', tax_rate: '0.0000', discount_percent: '0.0000', bonus_quantity: '0.000',
    line_subtotal: '1800.00', line_tax: '0.00', line_total: '1800.00', serials: ['IMEI-001', 'IMEI-002'],
  }],
}
const serial = (id: string, value: string) => ({ id, serial: value, variant: phone, store: { id: 's-1', name: 'Shop floor' }, status: 'in_stock', updated_at: '2026-11-21T08:00:00Z' })

type Captured = { receipt?: { lines: Record<string, unknown>[] }; serialQuery?: string; asOf?: (string | null)[] }

async function mockBackend(page: Page) {
  const captured: Captured = { asOf: [] }
  await page.addInitScript(() => localStorage.setItem('pos-session', JSON.stringify({ state: { activeBranchId: 'b-1' }, version: 0 })))
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: paged([]) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/branches?**', (route) => route.fulfill({ json: paged(branches) }))
  await page.route('**/api/v1/suppliers?**', (route) => route.fulfill({ json: paged([supplierRow]) }))
  await page.route('**/api/v1/products?**', (route) => route.fulfill({ json: envelope([phoneProduct]) }))
  await page.route('**/api/v1/purchasing/receipts', (route) => {
    captured.receipt = route.request().postDataJSON()
    return route.fulfill({ status: 201, json: envelope(receipt) })
  })
  await page.route('**/api/v1/purchasing/receipts/gr-1', (route) => route.fulfill({ json: envelope(receipt) }))
  await page.route('**/api/v1/inventory/serials?**', (route) => {
    captured.serialQuery = new URL(route.request().url()).search
    return route.fulfill({ json: paged([serial('sn-1', 'IMEI-001'), serial('sn-2', 'IMEI-002')]) })
  })
  await page.route('**/api/v1/inventory/serials/sn-2', (route) =>
    route.fulfill({
      json: envelope({
        ...serial('sn-2', 'IMEI-002'),
        events: [{ id: 'e-1', type: 'received', store: { id: 's-1', name: 'Shop floor' }, reference_type: 'goods_receipt', reference_id: 'gr-1', reference_number: 'GRN-000001', created_by: { id: 'u-1', name: 'Nadia Manager' }, created_at: '2026-11-21T08:00:00Z' }],
      }),
    }))
  await page.route('**/api/v1/inventory/valuation**', (route) => {
    const asOf = new URL(route.request().url()).searchParams.get('as_of')
    captured.asOf?.push(asOf)
    return route.fulfill({ json: envelope({ stores: [{ store: floor, products: 1, value: asOf ? '900.00' : '1800.00' }], total: asOf ? '900.00' : '1800.00', as_of: asOf }) })
  })
  return captured
}

async function noSidewaysScroll(page: Page) {
  expect(await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')).toBeLessThanOrEqual(0)
}

test('receives phones with serials, finds them in stock, opens a serial’s history and values stock at a past month-end', async ({ page, isMobile }) => {
  const captured = await mockBackend(page)
  await page.goto('/admin/purchasing/receipts/new')

  await expect(page.getByRole('heading', { name: 'Receive goods' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Supplier' }).click()
  await page.getByRole('option', { name: /Phone Hub/ }).click()
  await page.getByRole('combobox', { name: 'Store', exact: true }).click()
  await page.getByRole('option', { name: 'Shop floor (FLOOR)' }).click()
  await page.getByRole('combobox', { name: 'Product of line 1' }).click()
  await page.getByPlaceholder('Name, SKU or barcode').fill('phone')
  await page.getByRole('option', { name: /Phone X/ }).click()
  await page.getByLabel('Quantity of line 1').fill('2')

  await page.getByRole('button', { name: 'Serials of line 1' }).click()
  const serials = page.getByRole('dialog', { name: 'Serial numbers' })
  await serials.getByLabel('Serial number').fill('IMEI-001')
  await serials.getByLabel('Serial number').press('Enter')
  await serials.getByLabel('Serial number').fill('IMEI-002')
  await serials.getByLabel('Serial number').press('Enter')
  await expect(serials.getByText('2 of 2 entered')).toBeVisible()
  if (isMobile) await noSidewaysScroll(page)
  await serials.getByRole('button', { name: 'Save 2 serials' }).click()
  await expect(page.getByRole('button', { name: 'Serials of line 1' })).toContainText('2/2')
  await page.getByRole('button', { name: 'Post receipt' }).click()

  await expect(page).toHaveURL(/\/admin\/purchasing\/receipts\/gr-1$/)
  expect(captured.receipt?.lines[0]).toMatchObject({ variant_id: 'v-9', quantity: '2', serials: ['IMEI-001', 'IMEI-002'] })
  await expect(page.getByText('IMEI-001, IMEI-002')).toBeVisible()

  if (isMobile) await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Inventory', exact: true }).click()
  await page.getByRole('link', { name: 'Serial numbers' }).click()
  await page.getByRole('combobox', { name: 'Filter by status' }).click()
  await page.getByRole('option', { name: 'In stock' }).click()
  await expect.poll(() => captured.serialQuery).toContain('status=in_stock')
  await expect(page.getByRole('row', { name: /IMEI-001/ })).toContainText('In stock')
  if (isMobile) await noSidewaysScroll(page)

  await page.getByRole('button', { name: 'IMEI-002' }).click()
  const history = page.getByRole('table', { name: 'Serial number history' })
  await expect(history.getByRole('row', { name: /Received/ })).toContainText('Shop floor')
  await expect(history.getByRole('link', { name: 'GRN-000001' })).toHaveAttribute('href', /\/admin\/purchasing\/receipts\/gr-1$/)
  await page.keyboard.press('Escape')

  await page.getByRole('link', { name: 'Valuation' }).click()
  await expect(page.getByTestId('valuation-total')).toHaveText('BDT 1,800.00')
  await page.getByLabel('As of').fill('2026-10-31')
  await expect(page.getByText('Value as of 31 Oct 2026')).toBeVisible()
  await expect(page.getByTestId('valuation-total')).toHaveText('BDT 900.00')
  expect(captured.asOf).toContain('2026-10-31')
  if (isMobile) await noSidewaysScroll(page)
})
