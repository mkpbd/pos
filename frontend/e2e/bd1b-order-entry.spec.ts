import { expect, test, type Page, type Request } from '@playwright/test'

/**
 * BD1b: staff enter an order taken by phone / chat and change it before it ships — against a mocked API.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const page1 = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

const me = {
  user: { id: 'u-1', name: 'Rahim Uddin', email: 'rahim@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-1', name: 'Online Store Manager', system_key: 'online_store_manager' }],
  permissions: ['branches.view', 'products.view', 'customers.view', 'web_orders.view', 'web_orders.manage', 'web_orders.create', 'web_orders.edit'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
}

const divisions = [{ id: 3, name: 'Dhaka' }, { id: 2, name: 'Chattogram' }]
const districts = [{ id: 26, division_id: 3, name: 'Dhaka' }, { id: 47, division_id: 3, name: 'Gazipur' }, { id: 12, division_id: 2, name: 'Cumilla' }]
const products = [{
  id: 'p-1', name: 'Baby Romper', type: 'standard', track_stock: true, track_batches: false, unit: { code: 'pcs', allow_decimal: false }, tax_rate: null,
  variants: [{ id: 'v-m', name: 'Size M', sku: 'ROMP-M', option_values: { Size: 'M' }, is_active: true }],
}]
const methods = [{ id: 'sm-home', name: 'Home delivery', description: null, fee: '60.00', free_over: null, cod_allowed: true, cod_fee: '0.00', eta_min_days: 1, eta_max_days: 2 }]

type QuoteBody = { order_id?: string; lines: { variant_id: string; quantity: string }[]; address?: { district_id?: number }; shipping_method_id?: string; payment_method?: string }

/** 750 a piece, 60 for delivery once the district is known. */
function quoteFor(body: QuoteBody) {
  const lines = body.lines.map((l) => ({
    variant_id: l.variant_id, product_name: 'Baby Romper', variant_name: 'Size M', sku: 'ROMP-M', image_url: null,
    quantity: l.quantity, unit_price: '750.00', line_total: (750 * Number(l.quantity)).toFixed(2), available: '10',
  }))
  const subtotal = lines.reduce((sum, l) => sum + Number(l.line_total), 0)
  const district = !!body.address?.district_id
  const shipping = district ? 60 : 0
  return {
    lines, subtotal: subtotal.toFixed(2), discount_total: '0.00', tax_total: '0.00', shipping_total: shipping.toFixed(2), shipping_discount: '0.00', cod_fee: '0.00',
    total: (subtotal + shipping).toFixed(2), currency: 'BDT', prices_include_tax: false,
    shipping_methods: district ? methods : [], shipping_method_id: district ? (body.shipping_method_id ?? null) : null, payment_method: body.payment_method ?? null,
    promotions: [], coupon_code: null, coupon: null, issues: [],
    payment_methods: [{ code: 'cod', name: 'Cash on delivery' }, { code: 'bank_transfer', name: 'Bank transfer' }],
  }
}

const order = (quantity: string, total: string, extra: Record<string, unknown> = {}) => ({
  id: 'wo-9', number: 'WEB-000009', status: 'confirmed', status_label: 'Confirmed', payment_status: 'unpaid', payment_method: 'cod', payment_method_label: 'Cash on delivery',
  payment_instructions: null, placed_at: '2026-11-20T04:30:00Z', expires_at: null,
  source: 'staff', channel: 'facebook', created_by: { id: 'u-1', name: 'Rahim Uddin' }, revision: 1, edits: [], customer_id: null, shipping_method_id: 'sm-home',
  contact: { name: 'Ayesha Rahman', email: null, phone: '01711000000' },
  shipping_address: { recipient_name: 'Ayesha Rahman', phone: '01711000000', division: 'Dhaka', district: 'Dhaka', division_id: 3, district_id: 26, area: null, address_line: 'House 12, Road 5', postcode: null },
  shipping_method_name: 'Home delivery', eta_min_days: 1, eta_max_days: 2,
  lines: [{ id: 'ol-1', variant_id: 'v-m', product_name: 'Baby Romper', variant_name: 'Size M', sku: 'ROMP-M', image_url: null, quantity, unit_price: '750.00', line_total: (750 * Number(quantity)).toFixed(2), discount_amount: '0.00' }],
  subtotal: (750 * Number(quantity)).toFixed(2), discount_total: '0.00', shipping_discount: '0.00', promotions: [], coupon_code: null,
  tax_total: '0.00', shipping_total: '60.00', cod_fee: '0.00', total, currency: 'BDT', prices_include_tax: false,
  courier_name: null, tracking_number: null,
  history: [{ status: 'confirmed', label: 'Confirmed', at: '2026-11-20T04:30:00Z', actor: { id: 'u-1', name: 'Rahim Uddin' }, actor_type: 'staff', note: 'Order entered by staff (Facebook)' }],
  customer: null, ip: null, user_agent: null, notes: null, cancel_reason: null, payments: [],
  allowed_actions: ['process', 'cancel', 'edit'],
  ...extra,
})

async function mockBackend(page: Page) {
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/geography/divisions', (route) => route.fulfill({ json: envelope(divisions) }))
  await page.route('**/api/v1/geography/districts', (route) => route.fulfill({ json: envelope(districts) }))
  await page.route('**/api/v1/shipping/couriers', (route) => route.fulfill({ json: envelope([]) }))
  await page.route('**/api/v1/products?*', (route) => route.fulfill({ json: page1(products) }))
  await page.route('**/api/v1/web-orders/quote', (route) => route.fulfill({ json: envelope(quoteFor(route.request().postDataJSON() as QuoteBody)) }))
  await page.route('**/api/v1/web-orders/phone-report?*', (route) =>
    route.fulfill({ json: envelope({ phone: '01711000000', orders: 3, delivered: 1, returned: 1, cancelled: 1, in_progress: 0, success_rate: 50, last_order_at: null, blocked: true, block_reason: 'Refused parcels' }) }))
}

async function choose(page: Page, combobox: string, option: string) {
  await page.getByRole('combobox', { name: combobox }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

test('enters an order taken on Facebook', async ({ page }) => {
  await mockBackend(page)
  let placed = false
  await page.route('**/api/v1/web-orders?*', (route) => route.fulfill({ json: page1([]) }))
  await page.route('**/api/v1/web-orders', (route) => {
    placed = true
    return route.fulfill({ status: 201, json: envelope(order('2', '1560.00')) })
  })
  await page.route('**/api/v1/web-orders/wo-9', (route) => route.fulfill({ json: envelope(order('2', '1560.00')) }))

  await page.goto('/admin/web-orders')
  await page.getByRole('link', { name: 'New order' }).click()
  await expect(page.getByRole('heading', { name: 'New order' })).toBeVisible()

  await page.getByLabel('Name', { exact: true }).fill('Ayesha Rahman')
  await page.getByLabel('Mobile number').fill('01711000000')
  const strip = page.getByTestId('phone-history')
  await expect(strip).toContainText('1 delivered · 1 returned · 50%')
  await expect(strip).toContainText('Blocked')

  await page.getByRole('combobox', { name: 'Add a product' }).click()
  await page.getByRole('option', { name: /Baby Romper — Size M/ }).click()
  await page.getByLabel('Quantity of Baby Romper — Size M').fill('2')

  await choose(page, 'Division', 'Dhaka')
  await choose(page, 'District', 'Dhaka')
  await page.getByLabel('Address', { exact: true }).fill('House 12, Road 5')
  await page.getByRole('radio', { name: /Home delivery/ }).check()
  await page.getByRole('radio', { name: 'Cash on delivery' }).check()
  await choose(page, 'Order came by', 'Facebook')
  await expect(page.getByTestId('quote-total')).toHaveText('BDT 1,560.00')

  const post = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/web-orders') && r.method() === 'POST')
  await page.getByRole('button', { name: 'Place order' }).click()
  const request = await post
  expect(request.headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
  expect(request.postDataJSON()).toMatchObject({
    contact: { name: 'Ayesha Rahman', phone: '01711000000' },
    lines: [{ variant_id: 'v-m', quantity: '2' }],
    address: { recipient_name: 'Ayesha Rahman', phone: '01711000000', division_id: 3, district_id: 26, address_line: 'House 12, Road 5' },
    shipping_method_id: 'sm-home', payment_method: 'cod', channel: 'facebook', expected_total: '1560.00',
  })
  expect(placed).toBe(true)
  await expect(page.getByRole('heading', { name: 'WEB-000009' })).toBeVisible()
  await expect(page.getByTestId('order-origin')).toContainText('Staff · Facebook')
})

test('changes an order before it ships', async ({ page }) => {
  await mockBackend(page)
  let current = order('2', '1560.00')
  await page.route('**/api/v1/web-orders/wo-9', (route) => {
    if (route.request().method() === 'PUT') {
      current = order('3', '2310.00', {
        revision: 2,
        edits: [{ revision: 2, reason: 'Customer asked for one more', actor: { id: 'u-1', name: 'Rahim Uddin' }, created_at: '2026-11-21T04:30:00Z', total_before: '1560.00', total_after: '2310.00', lines: [{ name: 'Baby Romper — Size M', before: '2.000', after: '3.000' }], contact_changed: false, address_changed: false, shipping_before: 'Home delivery', shipping_after: 'Home delivery' }],
      })
    }
    return route.fulfill({ json: envelope(current) })
  })

  await page.goto('/admin/web-orders/wo-9')
  await page.getByRole('link', { name: 'Edit order' }).click()
  await expect(page.getByRole('heading', { name: 'Change order WEB-000009' })).toBeVisible()
  await expect(page.getByLabel('Address', { exact: true })).toHaveValue('House 12, Road 5')

  await page.getByLabel('Quantity of Baby Romper — Size M').fill('3')
  await page.getByLabel('Reason for the change (optional)').fill('Customer asked for one more')
  await expect(page.getByTestId('quote-total')).toHaveText('BDT 2,310.00')

  const put = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/web-orders/wo-9') && r.method() === 'PUT')
  await page.getByRole('button', { name: 'Save changes' }).click()
  const request = await put
  expect(request.headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
  expect(request.postDataJSON()).toMatchObject({ lines: [{ variant_id: 'v-m', quantity: '3' }], shipping_method_id: 'sm-home', expected_total: '2310.00', reason: 'Customer asked for one more' })
  expect(request.postDataJSON()).not.toHaveProperty('payment_method')

  await expect(page.getByRole('heading', { name: 'WEB-000009' })).toBeVisible()
  await expect(page.getByTestId('order-edit-2')).toContainText('Total BDT 1,560.00 → BDT 2,310.00')
  await expect(page.getByTestId('order-edit-2')).toContainText('Baby Romper — Size M: 2 → 3')
})
