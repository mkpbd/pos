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
}

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
