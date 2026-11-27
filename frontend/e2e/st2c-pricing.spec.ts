import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * ST2c against a mocked API: a product with a carton barcode, a quantity break and a branch
 * price; a wholesale customer group; scanning the carton at the till (24 units at the quantity
 * price); a purchase order line entered in cartons. Desktop and mobile; the till is desktop-only.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const paged = (items: unknown[], perPage = 25) => envelope(items, { pagination: { current_page: 1, per_page: perPage, total: items.length, last_page: 1 } })

const org = { id: 'o-1', name: 'Corner Shop', slug: 'corner-shop', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' }
const me = {
  user: { id: 'u-1', name: 'Mina Manager', email: 'mina@corner.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: org,
  roles: [{ id: 'r-1', name: 'Store Manager', system_key: null }],
  permissions: [
    'branches.view', 'products.view', 'products.manage', 'products.view_cost', 'customers.view', 'customers.manage', 'suppliers.view',
    'purchases.view', 'purchases.manage', 'inventory.view', 'pos.sell', 'cash_registers.operate', 'sales.view',
  ],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
  two_factor: { enabled: false, required: false, setup_required: false },
}
const branches = [{
  id: 'b-1', code: 'MAIN', name: 'Main Branch', email: null, phone: null, address: null, timezone: null, is_active: true, allow_negative_stock: false, created_at: '2026-10-01T00:00:00Z',
  stores: [{ id: 's-1', branch_id: 'b-1', code: 'FLOOR', name: 'Shop floor', type: 'store', is_active: true }],
}]
const carton = { barcode: '1234567890128', units: '24.000', pack_name: 'Carton' }
const variant = { id: 'v-1', sku: 'JUICE-1L', name: null, option_values: {}, purchase_price: '20.00', selling_price: '25.00', wholesale_price: '24.00', reorder_level: '0.000', is_active: true }
const product = (extra: Record<string, unknown> = {}) => ({
  id: 'p-1', name: 'Mango Juice', description: null, type: 'standard', category: null, brand: null,
  unit: { id: 'u-pcs', name: 'Piece', code: 'pcs', allow_decimal: false }, tax_rate: null,
  track_stock: true, track_batches: false, track_serials: false, max_discount_percent: null, options: null, is_active: true, archived_at: null, images: [],
  variants: [{ ...variant, barcodes: ['96385074'], packs: [], price_tiers: [], branch_prices: [], ...extra }],
})
const savedProduct = product({ barcodes: ['96385074', carton.barcode], packs: [carton], price_tiers: [{ min_quantity: '12.000', price: '23.00' }], branch_prices: [{ branch_id: 'b-1', price: '24.50' }] })
const groups = [{ id: 'g-1', name: 'Traders', description: null, discount_percent: '0.00', price_level: 'retail', customers_count: 2 }]
const session = {
  id: 'ses-1', number: 'SES-MAIN-000001', status: 'open', currency: 'BDT', branch: { id: 'b-1', code: 'MAIN', name: 'Main Branch' },
  register: { id: 'reg-1', code: 'REG-01', name: 'Counter 1' }, opening_float: '500.00', opened_by: { id: 'u-1', name: 'Mina Manager' }, opened_at: '2026-12-07T03:00:00Z',
  expected_cash: null, counted_cash: null, variance: null, closing_notes: null, closed_by: null, closed_at: null,
  cash: { opening_float: '500.00', cash_in: '0.00', cash_out: '0.00', expected: '500.00', counted: null, variance: null }, by_method: [], by_source: [], entries: [],
}
const tillItem = {
  variant_id: 'v-1', product_id: 'p-1', product_name: 'Mango Juice', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', allow_decimal: false,
  price: '24.50', tax_rate: '0.0000', max_discount_percent: null, track_stock: true, track_batches: false, track_serials: false,
  category_id: null, image_url: null, on_hand: '100.000', sellable: true, open_price: false, packs: [carton],
}
const supplier = { id: 'sup-1', code: 'SUP-000001', name: 'Local Mills', contact_person: null, email: null, phone: null, address: null, tax_number: null, payment_terms_days: 30, opening_balance: '0.00', notes: null, is_active: true, archived_at: null }

/** Server-like till preview: the branch price 24.50, from 12 units the quantity break 23.00. */
function priceCart(body: { lines: { variant_id: string; quantity: string }[] }) {
  const lines = body.lines.map((l, i) => {
    const qty = Number(l.quantity)
    const tier = qty >= 12
    const unit = tier ? 23 : 24.5
    const total = (unit * qty).toFixed(2)
    return {
      position: i, variant_id: l.variant_id, product_name: 'Mango Juice', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', allow_decimal: false,
      track_stock: true, track_serials: false, max_discount_percent: null, quantity: l.quantity, unit_price: unit.toFixed(2), tax_rate: '0.0000', discount: null,
      available: '100.000', line_subtotal: total, discount_amount: '0.00', invoice_discount_share: '0.00', net_amount: total, tax_amount: '0.00', line_total: total,
      list_price: unit.toFixed(2), price_source: tier ? 'tier' : 'catalog', price_approved_by: null, open_price: false, promotion: null,
    }
  })
  const total = lines.reduce((s, l) => s + Number(l.line_total), 0).toFixed(2)
  return {
    store: { id: 's-1', code: 'FLOOR', name: 'Shop floor', branch_id: 'b-1', branch_name: 'Main Branch' }, customer: null, currency: 'BDT', tax_mode: 'exclusive', lines,
    invoice_discount: null, subtotal: total, item_discount_total: '0.00', invoice_discount_total: '0.00', discount_total: '0.00', net_total: total, tax_total: '0.00', total,
    promotions: [], coupon: null, savings_total: '0.00', discount_approved_by: null,
  }
}

type Captured = { variants?: { variants: Record<string, unknown>[] }; group?: Record<string, unknown>; order?: { lines: Record<string, unknown>[] }; prices: { lines: { quantity: string }[] }[] }

async function mockBackend(page: Page): Promise<Captured> {
  const captured: Captured = { prices: [] }
  let current = product()
  await page.addInitScript(() => localStorage.setItem('pos-session', JSON.stringify({ state: { activeBranchId: 'b-1' }, version: 0 })))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/**', (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const key = `${request.method()} ${url.pathname.replace(/^\/api\/v1/, '')}`
    switch (key) {
      case 'GET /auth/me':
        return route.fulfill({ json: envelope(me) })
      case 'GET /notifications/unread-count':
        return route.fulfill({ json: envelope({ count: 0 }) })
      case 'GET /branches':
        return route.fulfill({ json: paged(branches, 100) })
      case 'GET /units':
        return route.fulfill({ json: envelope([{ id: 'u-pcs', name: 'Piece', code: 'pcs', allow_decimal: false, base_unit_id: null, conversion_factor: null, is_active: true }]) })
      case 'GET /products/p-1':
        return route.fulfill({ json: envelope(current) })
      case 'PUT /products/p-1/variants':
        captured.variants = request.postDataJSON()
        current = savedProduct
        return route.fulfill({ json: envelope(current) })
      case 'GET /products':
        return route.fulfill({ json: envelope([savedProduct]) })
      case 'GET /customer-groups':
        return route.fulfill({ json: envelope(captured.group ? [{ ...groups[0], price_level: 'wholesale' }] : groups) })
      case 'PATCH /customer-groups/g-1':
        captured.group = request.postDataJSON()
        return route.fulfill({ json: envelope({ ...groups[0], price_level: 'wholesale' }) })
      case 'GET /pos/terminal':
        return route.fulfill({ status: 404, json: { success: false, error: { code: 'TERMINAL_NOT_FOUND', message: 'Not a till.', details: {} }, meta: {} } })
      case 'GET /register-sessions/current':
        return route.fulfill({ json: envelope(session) })
      case 'GET /loyalty/settings':
        return route.fulfill({ json: envelope({ is_enabled: false, spend_amount: '100.00', points_per_spend: 1, point_value: '1.00', min_redeem_points: 0 }) })
      case 'GET /pos/catalog':
        return route.fulfill({ json: paged([tillItem], 48) })
      case 'GET /pos/lookup':
        return url.searchParams.get('code') === carton.barcode
          ? route.fulfill({ json: envelope({ ...tillItem, scan_units: '24.000', pack_name: 'Carton' }) })
          : route.fulfill({ status: 404, json: { success: false, error: { code: 'NOT_FOUND', message: 'Not found.', details: {} }, meta: { request_id: 'e2e' } } })
      case 'POST /pos/price': {
        const input = request.postDataJSON()
        captured.prices.push(input)
        return route.fulfill({ json: envelope(priceCart(input)) })
      }
      case 'GET /suppliers':
        return route.fulfill({ json: paged([supplier]) })
      case 'POST /purchasing/orders':
        captured.order = request.postDataJSON()
        return route.fulfill({ status: 201, json: envelope({ id: 'po-1', number: 'PO-000001', status: 'draft', supplier, lines: [] }) })
      default:
        return route.fulfill({ json: paged([]) })
    }
  })
  return captured
}

async function noSidewaysScroll(page: Page) {
  expect(await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')).toBeLessThanOrEqual(0)
}

test('a product gets a carton barcode, a quantity break and a branch price', async ({ page }) => {
  const captured = await mockBackend(page)
  await page.goto('/admin/products/p-1')

  await page.getByRole('button', { name: 'Packs and prices of Default' }).click()
  const panel = page.getByRole('group', { name: 'Packs and prices of Default' })
  await panel.getByRole('button', { name: 'Add pack' }).click()
  await panel.getByLabel('Pack barcode 1').fill(carton.barcode)
  await panel.getByLabel('Units in pack 1').fill('24')
  await panel.getByLabel('Name of pack 1').fill('Carton')
  await panel.getByRole('button', { name: 'Add quantity break' }).click()
  await panel.getByLabel('Tier quantity 1').fill('12')
  await panel.getByLabel('Tier price 1').fill('23')
  await panel.getByRole('button', { name: 'Add branch price' }).click()
  await panel.getByRole('combobox', { name: 'Branch of price 1' }).click()
  await page.getByRole('option', { name: 'Main Branch' }).click()
  await panel.getByLabel('Branch price 1').fill('24.50')
  await page.getByRole('button', { name: 'Save variants' }).click()

  await expect.poll(() => captured.variants?.variants[0]).toMatchObject({
    barcodes: ['96385074', { barcode: carton.barcode, units: '24', pack_name: 'Carton' }],
    price_tiers: [{ min_quantity: '12', price: '23' }],
    branch_prices: [{ branch_id: 'b-1', price: '24.50' }],
  })
  await expect(page.getByRole('button', { name: 'Packs and prices of Default' })).toContainText('1 pack · 1 qty break · 1 branch price')
  await expect(page.getByLabel('Barcodes for Default')).toHaveValue('96385074')
})

test('a customer group is set to wholesale prices', async ({ page, isMobile }) => {
  const captured = await mockBackend(page)
  await page.goto('/admin')
  if (isMobile) await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('link', { name: 'Customers', exact: true }).click()
  await page.getByRole('tab', { name: 'Groups' }).click()

  await expect(page.getByRole('row', { name: /Traders/ })).toContainText('Retail')
  await page.getByRole('button', { name: 'Edit Traders' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('combobox', { name: 'Price level' }).click()
  await page.getByRole('option', { name: 'Wholesale' }).click()
  await dialog.getByRole('button', { name: 'Save changes' }).click()

  await expect(dialog).toBeHidden()
  expect(captured.group).toMatchObject({ name: 'Traders', price_level: 'wholesale' })
  await expect(page.getByRole('row', { name: /Traders/ })).toContainText('Wholesale')
  if (isMobile) await noSidewaysScroll(page)
})

test('scanning a carton at the till adds 24 units at the quantity price', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The till runs on the desktop.')
  const captured = await mockBackend(page)
  await page.goto('/admin/pos')

  const scanner = page.getByRole('textbox', { name: 'Scan barcode or search products' })
  await expect(page.getByRole('button', { name: /Mango Juice/ })).toBeVisible()
  await scanner.fill(carton.barcode)
  await scanner.press('Enter')

  const cart = page.getByRole('complementary', { name: 'Current sale' })
  await expect(cart.getByRole('textbox', { name: 'Quantity of Mango Juice' })).toHaveValue('24')
  await expect(page.getByText('Carton (24) · Mango Juice')).toBeVisible()
  await expect(cart.getByText('Qty price')).toBeVisible()
  await expect(cart.getByTestId('cart-total')).toHaveText('BDT 552.00')
  expect(captured.prices.at(-1)?.lines[0]?.quantity).toBe('24')
})

test('a purchase order line is entered in cartons', async ({ page, isMobile }) => {
  const captured = await mockBackend(page)
  await page.goto('/admin/purchasing/orders/new')

  await page.getByRole('combobox', { name: 'Product of line 1' }).click()
  await page.getByRole('option', { name: /Mango Juice/ }).click()
  await page.getByRole('combobox', { name: 'Pack of line 1' }).click()
  await page.getByRole('option', { name: 'Carton (24)' }).click()
  await page.getByLabel('Packs of line 1').fill('3')
  await page.getByLabel('Pack cost of line 1').fill('500')
  await expect(page.getByLabel('Quantity of line 1')).toHaveValue('72')
  await expect(page.getByLabel('Unit cost of line 1')).toHaveValue('20.8333')

  await page.getByRole('combobox', { name: 'Supplier' }).click()
  await page.getByRole('option', { name: /Local Mills/ }).click()
  await page.getByRole('combobox', { name: 'Store' }).click()
  await page.getByRole('option', { name: /Shop floor/ }).click()
  if (isMobile) await noSidewaysScroll(page)
  await page.getByRole('button', { name: 'Save draft' }).click()

  await expect.poll(() => captured.order?.lines[0]).toMatchObject({ variant_id: 'v-1', quantity: '72', unit_cost: '20.8333' })
})
