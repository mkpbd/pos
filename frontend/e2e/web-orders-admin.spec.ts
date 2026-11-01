import { expect, test, type Page, type Request } from '@playwright/test'

/**
 * Admin web orders (E8a) against a mocked API: list → order → confirm a bank transfer,
 * and building a shipping zone. Runs on desktop and mobile.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const page1 = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

const me = {
  user: { id: 'u-1', name: 'Nadia Admin', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-1', name: 'Organization Admin', system_key: 'organization_admin' }],
  permissions: ['branches.view', 'storefront.view', 'storefront.manage', 'web_orders.view', 'web_orders.manage', 'shipping.manage', 'payment_gateways.manage'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
}

const row = {
  id: 'wo-1', number: 'WEB-000001', placed_at: '2026-10-31T04:30:00Z', status: 'pending_payment', payment_status: 'unpaid', payment_method: 'bank_transfer',
  contact_name: 'Ayesha Rahman', contact_phone: '01711000000', total: '1560.00', currency: 'BDT', item_count: 2,
}

const order = {
  ...row,
  status_label: 'Awaiting payment', payment_method_label: 'Bank transfer', payment_instructions: 'Demo Bank, account 0000000000 — demo only',
  expires_at: '2026-11-02T04:30:00Z',
  contact: { name: 'Ayesha Rahman', email: 'ayesha@example.com', phone: '01711000000' },
  shipping_address: { recipient_name: 'Ayesha Rahman', phone: '01711000000', division: 'Dhaka', district: 'Dhaka', area: 'Dhanmondi', address_line: 'House 12, Road 5', postcode: '1205' },
  shipping_method_name: 'Home delivery', eta_min_days: 1, eta_max_days: 2,
  lines: [{ product_name: 'Baby Romper', variant_name: 'Size M', sku: 'ROMP-M', image_url: null, quantity: '2.000', unit_price: '750.00', line_total: '1500.00', product_url: null }],
  subtotal: '1500.00', tax_total: '0.00', shipping_total: '60.00', cod_fee: '0.00', prices_include_tax: false,
  courier_name: null, tracking_number: null,
  history: [{ status: 'pending_payment', label: 'Awaiting payment', at: '2026-10-31T04:30:00Z', actor: null, note: null }],
  customer: null, ip: '203.0.113.5', user_agent: 'Mozilla/5.0', notes: null, cancel_reason: null, payments: [],
  allowed_actions: ['confirm_payment', 'cancel'],
}

const confirmed = {
  ...order, status: 'confirmed', status_label: 'Confirmed', payment_status: 'paid', payment_instructions: null, allowed_actions: ['process', 'cancel'],
  payments: [{ method: 'bank_transfer', method_label: 'Bank transfer', amount: '1560.00', reference: 'TRX-778', recorded_at: '2026-10-31T06:00:00Z', recorded_by: 'Nadia Admin' }],
  history: [...order.history, { status: 'confirmed', label: 'Confirmed', at: '2026-10-31T06:00:00Z', actor: { id: 'u-1', name: 'Nadia Admin' }, note: null }],
}

const divisions = [{ id: 3, name: 'Dhaka', name_bn: 'ঢাকা' }, { id: 2, name: 'Chattogram', name_bn: 'চট্টগ্রাম' }]
const districts = [
  { id: 26, division_id: 3, name: 'Dhaka', name_bn: 'ঢাকা' },
  { id: 47, division_id: 3, name: 'Gazipur', name_bn: 'গাজীপুর' },
  { id: 12, division_id: 2, name: 'Cumilla', name_bn: 'কুমিল্লা' },
]

async function mockBackend(page: Page) {
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/geography/divisions', (route) => route.fulfill({ json: envelope(divisions) }))
  await page.route('**/api/v1/geography/districts', (route) => route.fulfill({ json: envelope(districts) }))
  await page.route('**/api/v1/shipping/couriers', (route) => route.fulfill({ json: envelope(couriers) }))
}

const couriers = [
  { id: 'c-1', name: 'Pathao', phone: null, tracking_url_template: 'https://merchant.pathao.com/tracking?consignment_id={tracking}', is_active: true, sort_order: 0 },
  { id: 'c-2', name: 'Steadfast', phone: null, tracking_url_template: null, is_active: true, sort_order: 1 },
]

test('opens a web order from the list and confirms its bank transfer', async ({ page }) => {
  await mockBackend(page)
  let current: Record<string, unknown> = order
  await page.route('**/api/v1/web-orders?*', (route) => route.fulfill({ json: page1([current === order ? row : { ...row, status: 'confirmed', payment_status: 'paid' }]) }))
  await page.route('**/api/v1/web-orders/wo-1', (route) => route.fulfill({ json: envelope(current) }))
  await page.route('**/api/v1/web-orders/wo-1/confirm-payment', (route) => {
    current = confirmed
    return route.fulfill({ json: envelope(confirmed) })
  })

  await page.goto('/admin/web-orders')
  await expect(page.getByRole('heading', { name: 'Web orders' })).toBeVisible()
  await page.getByRole('link', { name: 'WEB-000001' }).click()

  await expect(page.getByRole('heading', { name: 'WEB-000001' })).toBeVisible()
  await expect(page.getByTestId('awaiting-transfer')).toBeVisible()
  await page.getByRole('button', { name: 'Confirm payment' }).click()

  const dialog = page.getByRole('dialog', { name: 'Confirm payment for WEB-000001' })
  await dialog.getByLabel('Transaction reference').fill('TRX-778')
  const post = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/web-orders/wo-1/confirm-payment') && r.method() === 'POST')
  await dialog.getByRole('button', { name: 'Confirm payment' }).click()

  const request = await post
  expect(request.postDataJSON()).toEqual({ reference: 'TRX-778' })
  expect(request.headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
  await expect(page.getByText('Payment for WEB-000001 confirmed.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start processing' })).toBeVisible()
  await expect(page.getByText('TRX-778')).toBeVisible()
})

test('creates a shipping zone from districts', async ({ page }) => {
  await mockBackend(page)
  const zones: unknown[] = [
    { id: 'z-1', name: 'Inside Dhaka', is_active: true, sort_order: 0, districts: [{ id: 26, name: 'Dhaka' }], methods: [] },
  ]
  await page.route('**/api/v1/shipping/zones', (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { name: string; district_ids: number[] }
      const zone = { id: 'z-2', name: body.name, is_active: true, sort_order: 1, districts: body.district_ids.map((id) => ({ id, name: districts.find((d) => d.id === id)?.name })), methods: [] }
      zones.push(zone)
      return route.fulfill({ status: 201, json: envelope(zone) })
    }
    return route.fulfill({ json: envelope(zones) })
  })

  await page.goto('/admin/storefront/shipping')
  await expect(page.getByText('Inside Dhaka')).toBeVisible()
  await page.getByRole('button', { name: 'New zone' }).click()

  const dialog = page.getByRole('dialog', { name: 'New shipping zone' })
  await expect(dialog.getByRole('checkbox', { name: 'Dhaka', exact: true })).toBeDisabled()
  await dialog.getByLabel('Zone name').fill('Outside Dhaka')
  await dialog.getByRole('checkbox', { name: 'Gazipur' }).click()
  await dialog.getByRole('checkbox', { name: 'All of Chattogram division' }).click()

  const post = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/shipping/zones') && r.method() === 'POST')
  await dialog.getByRole('button', { name: 'Create zone' }).click()
  expect((await post).postDataJSON()).toEqual({ name: 'Outside Dhaka', is_active: true, sort_order: 1, district_ids: [12, 47] })
  await expect(page.getByText('Outside Dhaka saved.')).toBeVisible()
  await expect(page.getByText('2 districts')).toBeVisible()
})

test('shows the discounts, coupon and free delivery of a promotional order', async ({ page }) => {
  await mockBackend(page)
  const discounted = {
    ...order,
    lines: [{ product_name: 'Mango Juice', variant_name: null, sku: 'MJ-1', image_url: null, quantity: '2.000', unit_price: '100.00', line_total: '200.00', product_url: null, discount_amount: '30.00' }],
    subtotal: '200.00', discount_total: '30.00', shipping_discount: '60.00', shipping_total: '0.00', total: '170.00',
    promotions: [
      { name: 'Juice week', kind: 'product', amount: '20.00' },
      { name: 'Welcome 10', kind: 'order', amount: '10.00' },
      { name: 'Free delivery', kind: 'shipping', amount: '60.00' },
    ],
    coupon_code: 'WELCOME10',
  }
  await page.route('**/api/v1/web-orders/wo-1', (route) => route.fulfill({ json: envelope(discounted) }))

  await page.goto('/admin/web-orders/wo-1')
  const totals = page.getByLabel('Order totals')
  await expect(totals.getByText('Juice week')).toBeVisible()
  await expect(totals.getByText('−20.00')).toBeVisible()
  await expect(totals.getByText('Order discount')).toBeVisible()
  await expect(totals.getByText('Free delivery · 60.00 waived')).toBeVisible()
  await expect(page.getByTestId('order-coupon')).toContainText('WELCOME10')
  await expect(page.getByTestId('line-discount')).toHaveText('−30.00')
  await expect(page.getByTestId('order-total')).toHaveText('BDT 170.00')
})

// ── E10a fulfilment ──────────────────────────────────────────────────────────

const counts = { all: 3, pending_payment: 1, confirmed: 2, processing: 0, shipped: 0, delivered: 0, cancelled: 0, cod_unremitted: 0 }
const confirmedRows = [
  { ...row, status: 'confirmed', payment_method: 'cod', payment_status: 'unpaid' },
  { ...row, id: 'wo-2', number: 'WEB-000002', status: 'confirmed', payment_method: 'cod', payment_status: 'unpaid' },
]

test('works the board: status tabs, bulk Mark processing with per-order results, bulk print', async ({ page }) => {
  await mockBackend(page)
  await page.addInitScript(() => {
    // The e2e tsconfig has no DOM types; this runs in the page.
    const w = globalThis as unknown as { printed: number; print: () => void }
    w.printed = 0
    w.print = () => {
      w.printed += 1
    }
  })
  const listQueries: string[] = []
  await page.route('**/api/v1/web-orders?*', (route) => {
    listQueries.push(new URL(route.request().url()).search)
    return route.fulfill({ json: envelope(confirmedRows, { pagination: { current_page: 1, per_page: 25, total: 2, last_page: 1 }, status_counts: counts }) })
  })
  await page.route('**/api/v1/web-orders/bulk/process', (route) =>
    route.fulfill({ json: envelope([{ id: 'wo-1', number: 'WEB-000001', ok: true }, { id: 'wo-2', number: 'WEB-000002', ok: false, error_code: 'INVALID_STATUS_TRANSITION' }]) }),
  )
  await page.route('**/api/v1/web-orders/print?*', (route) =>
    route.fulfill({
      json: envelope({
        kind: 'packing_slip',
        organization: { name: 'Berry Kids', address: 'Dhanmondi, Dhaka', phone: '01700000000', tax_number: null, logo_url: null },
        orders: confirmedRows.map((r) => ({
          id: r.id, number: r.number, placed_at: r.placed_at, contact: order.contact, shipping_address: order.shipping_address, payment_method: 'cod', payment_status: 'unpaid',
          courier_name: null, tracking_number: null, lines: [{ product_name: 'Baby Romper', variant_name: 'Size M', sku: 'ROMP-M', quantity: '2.000' }], notes: null, currency: 'BDT',
        })),
      }),
    }),
  )

  await page.goto('/admin/web-orders')
  await expect(page.getByRole('tab', { name: /Confirmed\s*2/ })).toBeVisible()
  await page.getByRole('tab', { name: /Confirmed/ }).click()
  await expect.poll(() => listQueries.at(-1)).toContain('status=confirmed')

  await page.getByRole('checkbox', { name: 'Select all orders on this page' }).click()
  const toolbar = page.getByRole('toolbar', { name: 'Selected orders' })
  await expect(toolbar).toContainText('2 selected')
  const bulk = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/web-orders/bulk/process'))
  await toolbar.getByRole('button', { name: 'Mark processing' }).click()
  const request = await bulk
  expect(request.postDataJSON()).toEqual({ order_ids: ['wo-1', 'wo-2'] })
  expect(request.headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
  const results = page.getByRole('dialog', { name: 'Mark processing' })
  await expect(results).toContainText('1 order moved to Processing; 1 not changed.')
  await expect(results).toContainText('Not changed: not confirmed')
  await results.getByRole('button', { name: 'Done' }).click()

  await page.getByRole('checkbox', { name: 'Select WEB-000001' }).click()
  await page.getByRole('toolbar', { name: 'Selected orders' }).getByRole('button', { name: 'Print packing slips' }).click()
  await expect(page).toHaveURL(/\/admin\/web-orders\/print\?ids=wo-2%2Cwo-1&kind=packing_slip$/)
  await expect(page.getByRole('article')).toHaveCount(2)
  await expect(page.getByRole('article', { name: 'Packing slip WEB-000001' })).toContainText('Berry Kids')
  await expect.poll(() => page.evaluate(() => (globalThis as unknown as { printed: number }).printed)).toBe(1)
  await page.emulateMedia({ media: 'print' })
  await expect(page.getByRole('button', { name: 'Print' })).toBeHidden()
  await page.emulateMedia({ media: 'screen' })
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByRole('heading', { name: 'Web orders' })).toBeVisible()
})

test('ships with a courier, records delivery updates and links the tracking page', async ({ page }) => {
  await mockBackend(page)
  const processing = { ...order, status: 'processing', status_label: 'Processing', payment_method: 'cod', payment_method_label: 'Cash on delivery', payment_instructions: null, allowed_actions: ['ship', 'cancel'] }
  const shipment = {
    id: 'sh-1', courier_id: 'c-1', courier_name: 'Pathao', tracking_number: 'PT 123', tracking_url: 'https://merchant.pathao.com/tracking?consignment_id=PT%20123',
    status: 'handed_over', cod_amount: '1560.00', shipped_at: '2026-10-31T08:00:00Z', delivered_at: null, returned_at: null,
    events: [{ id: 'ev-1', status: 'handed_over', note: '2 parcels', occurred_at: '2026-10-31T08:00:00Z', recorded_by: { id: 'u-1', name: 'Nadia Admin' } }],
  }
  const shipped = { ...processing, status: 'shipped', status_label: 'Shipped', courier_name: 'Pathao', tracking_number: 'PT 123', shipment, allowed_actions: ['deliver', 'add_shipment_event'] }
  let current: Record<string, unknown> = processing
  await page.route('**/api/v1/web-orders/wo-1', (route) => route.fulfill({ json: envelope(current) }))
  await page.route('**/api/v1/web-orders/wo-1/ship', (route) => {
    current = shipped
    return route.fulfill({ json: envelope(current) })
  })
  await page.route('**/api/v1/web-orders/wo-1/shipment/events', (route) => {
    current = {
      ...shipped, status: 'delivered', status_label: 'Delivered', allowed_actions: ['record_cod_payment'],
      shipment: { ...shipment, status: 'delivered', delivered_at: '2026-11-01T08:00:00Z', events: [...shipment.events, { id: 'ev-2', status: 'delivered', note: null, occurred_at: '2026-11-01T08:00:00Z', created_by: 'Nadia Admin' }] },
    }
    return route.fulfill({ json: envelope(current) })
  })

  await page.goto('/admin/web-orders/wo-1')
  await page.getByRole('button', { name: 'Ship' }).click()
  const dialog = page.getByRole('dialog', { name: 'Ship WEB-000001' })
  await dialog.getByLabel('Courier').click()
  await page.getByRole('option', { name: 'Pathao' }).click()
  await dialog.getByLabel('Tracking number (optional)').fill('PT 123')
  await dialog.getByLabel('Note (optional)').fill('2 parcels')
  const ship = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/web-orders/wo-1/ship'))
  await dialog.getByRole('button', { name: 'Mark as shipped' }).click()
  expect((await ship).postDataJSON()).toEqual({ courier_id: 'c-1', tracking_number: 'PT 123', note: '2 parcels' })

  const card = page.getByTestId('shipment-card')
  await expect(card.getByRole('link', { name: /Track parcel/ })).toHaveAttribute('href', 'https://merchant.pathao.com/tracking?consignment_id=PT%20123')
  await card.getByRole('button', { name: 'Add tracking update' }).click()
  const update = page.getByRole('dialog', { name: 'Tracking update for WEB-000001' })
  await update.getByRole('radio', { name: /Delivered/ }).check()
  const event = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/web-orders/wo-1/shipment/events'))
  await update.getByRole('button', { name: 'Record update' }).click()
  const eventRequest = await event
  expect(eventRequest.postDataJSON()).toEqual({ status: 'delivered', note: null })
  expect(eventRequest.headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
  await expect(card.getByRole('list', { name: 'Tracking updates' }).getByText('Delivered')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Record COD payment' })).toBeVisible()
})

test('manages couriers in the shipping settings', async ({ page }) => {
  await mockBackend(page)
  const list: unknown[] = [...couriers]
  await page.route('**/api/v1/shipping/couriers', (route) => {
    if (route.request().method() === 'POST') {
      const courier = { id: 'c-9', ...(route.request().postDataJSON() as object) }
      list.push(courier)
      return route.fulfill({ status: 201, json: envelope(courier) })
    }
    return route.fulfill({ json: envelope(list) })
  })
  await page.route('**/api/v1/shipping/zones', (route) => route.fulfill({ json: envelope([]) }))

  await page.goto('/admin/storefront/shipping')
  await page.getByRole('navigation', { name: 'Shipping settings' }).getByRole('link', { name: 'Couriers' }).click()
  await expect(page.getByRole('table', { name: 'Couriers' })).toContainText('Pathao')
  await page.getByRole('button', { name: 'New courier' }).click()
  const dialog = page.getByRole('dialog', { name: 'New courier' })
  await dialog.getByLabel('Name').fill('RedX')
  await dialog.getByLabel('Tracking link (optional)').fill('https://redx.test/track/{tracking}')
  const post = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/shipping/couriers') && r.method() === 'POST')
  await dialog.getByRole('button', { name: 'Add courier' }).click()
  expect((await post).postDataJSON()).toEqual({ name: 'RedX', phone: null, tracking_url_template: 'https://redx.test/track/{tracking}', is_active: true, sort_order: 2 })
  await expect(page.getByRole('table', { name: 'Couriers' })).toContainText('RedX')
})
