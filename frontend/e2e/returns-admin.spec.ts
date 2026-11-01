import { expect, test, type Page, type Request } from '@playwright/test'

/**
 * Online returns (E10b) against a mocked API: staff create a return on a delivered order,
 * then approve it (lower quantity + delivery refund), receive it with a restock decision per
 * line and record the refund. Runs on desktop and mobile.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const page1 = (items: unknown[], meta: Record<string, unknown> = {}) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 }, ...meta })

const me = {
  user: { id: 'u-3', name: 'Mitu Manager', email: 'mitu@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-6', name: 'Online Store Manager', system_key: 'online_store_manager' }],
  permissions: ['branches.view', 'web_orders.view', 'web_orders.manage', 'web_orders.refund', 'promotions.view'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
}

const order = {
  id: 'wo-1', number: 'WEB-000001', placed_at: '2026-10-28T04:30:00Z', status: 'delivered', status_label: 'Delivered', payment_status: 'paid',
  payment_method: 'cod', payment_method_label: 'Cash on delivery', payment_instructions: null, expires_at: null, total: '260.00', currency: 'BDT',
  contact: { name: 'Ayesha Rahman', email: 'ayesha@example.com', phone: '01711000000' },
  shipping_address: { recipient_name: 'Ayesha Rahman', phone: '01711000000', division: 'Dhaka', district: 'Dhaka', area: 'Dhanmondi', address_line: 'House 12, Road 5', postcode: '1205' },
  shipping_method_name: 'Home delivery', eta_min_days: 1, eta_max_days: 2,
  lines: [{ id: 'ol-1', product_name: 'Mango Juice', variant_name: null, sku: 'MJ-1', image_url: null, quantity: '2.000', unit_price: '100.00', line_total: '200.00', discount_amount: '0.00', returnable_quantity: '2.000' }],
  subtotal: '200.00', tax_total: '0.00', shipping_total: '60.00', cod_fee: '0.00', prices_include_tax: false, courier_name: null, tracking_number: null,
  history: [{ status: 'delivered', label: 'Delivered', at: '2026-10-30T10:00:00Z', actor: null, note: null }],
  customer: { id: 'c-1', name: 'Ayesha Rahman', code: 'CUS-000001' }, ip: null, user_agent: null, notes: null, cancel_reason: null,
  payments: [{ method: 'cash', method_label: 'Cash', amount: '260.00', reference: null, recorded_at: '2026-10-30T10:00:00Z', recorded_by: null }],
  allowed_actions: ['create_return'], returns: [], delivered_at: '2026-10-30T10:00:00Z', return_deadline: '2099-11-06T10:00:00Z', return_window_open: true,
}

const baseReturn = {
  id: 'rt-1', number: 'RTN-WEB-000001', order: { id: 'wo-1', number: 'WEB-000001', shipping_total: '60.00', payment_status: 'paid' }, customer_name: 'Ayesha Rahman', status: 'requested', status_label: 'Requested',
  reason_code: 'damaged', refund_amount: '200.00', currency: 'BDT', created_at: '2026-11-01T04:00:00Z', requested_by: 'staff', customer_note: null,
  staff_note: 'Called the shop', rejection_reason: null, shipping_refund: '0.00', refund_method: null, refund_reference: null,
  lines: [{ id: 'rl-1', order_line_id: 'ol-1', product_name: 'Mango Juice', variant_name: null, sku: 'MJ-1', quantity: '2', requested_quantity: '2', ordered_quantity: '2', amount: '200.00', restock: null, restocked_quantity: null }],
}

async function mockBackend(page: Page) {
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/shipping/couriers', (route) => route.fulfill({ json: envelope([]) }))
  await page.route('**/api/v1/geography/districts', (route) => route.fulfill({ json: envelope([]) }))
}

test('creates a return on a delivered order, approves, receives and refunds it', async ({ page }) => {
  await mockBackend(page)
  let current: Record<string, unknown> | null = null
  const keys: Record<string, string | undefined> = {}
  const bodies: Record<string, unknown> = {}

  await page.route('**/api/v1/web-orders/wo-1', (route) => route.fulfill({ json: envelope(order) }))
  await page.route('**/api/v1/web-orders/wo-1/returns', (route) => {
    bodies.create = route.request().postDataJSON()
    keys.create = route.request().headers()['idempotency-key']
    current = { ...baseReturn }
    return route.fulfill({ status: 201, json: envelope(current) })
  })
  await page.route('**/api/v1/web-order-returns/rt-1', (route) => route.fulfill({ json: envelope(current) }))
  await page.route('**/api/v1/web-order-returns/rt-1/*', (route) => {
    const step = new URL(route.request().url()).pathname.split('/').pop() as string
    bodies[step] = route.request().postDataJSON()
    keys[step] = route.request().headers()['idempotency-key']
    const lines = baseReturn.lines
    if (step === 'approve') current = { ...current, status: 'approved', status_label: 'Approved', refund_amount: '130.00', shipping_refund: '30.00', lines: [{ ...lines[0], quantity: '1.000', amount: '100.00' }] }
    if (step === 'receive') current = { ...current, status: 'received', status_label: 'Received', lines: [{ ...lines[0], quantity: '1.000', amount: '100.00', restock: true, restocked_quantity: '1.000' }] }
    if (step === 'refund') current = { ...current, status: 'refunded', status_label: 'Refunded', refund_method: 'bank_transfer', refund_reference: 'TRX-55', refunded_at: '2026-11-01T09:00:00Z' }
    return route.fulfill({ json: envelope(current) })
  })

  await page.goto('/admin/web-orders/wo-1')
  const card = page.getByRole('region', { name: 'Returns' })
  await expect(card).toContainText('No returns on this order.')
  await card.getByRole('button', { name: 'Create return' }).click()

  const create = page.getByRole('dialog', { name: 'Create a return for WEB-000001' })
  await create.getByLabel('Mango Juice').fill('2')
  await create.getByLabel('Reason').click()
  await page.getByRole('option', { name: 'Damaged' }).click()
  await create.getByLabel('Note (optional)').fill('Called the shop')
  await create.getByRole('button', { name: 'Create return' }).click()

  await expect(page).toHaveURL(/\/admin\/web-returns\/rt-1$/)
  expect(bodies.create).toEqual({ reason_code: 'damaged', note: 'Called the shop', lines: [{ order_line_id: 'ol-1', quantity: '2' }] })
  expect(keys.create).toMatch(/^[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { name: 'RTN-WEB-000001' })).toBeVisible()

  await page.getByRole('button', { name: 'Approve' }).click()
  const approve = page.getByRole('dialog', { name: 'Approve RTN-WEB-000001' })
  await approve.getByLabel('Mango Juice').fill('1')
  await approve.getByLabel('Delivery charge to refund (optional)').fill('30')
  await approve.getByRole('button', { name: 'Approve return' }).click()
  await expect(approve).toBeHidden()
  expect(bodies.approve).toEqual({ lines: [{ order_line_id: 'ol-1', quantity: '1' }], shipping_refund: '30' })
  await expect(page.getByTestId('refund-amount')).toHaveText('BDT 130.00')

  await page.getByRole('button', { name: 'Receive goods' }).click()
  const receive = page.getByRole('dialog', { name: 'Receive goods for RTN-WEB-000001' })
  await expect(receive.getByRole('checkbox', { name: /Restock Mango Juice/ })).toBeChecked()
  await receive.getByRole('button', { name: 'Mark received' }).click()
  await expect(receive).toBeHidden()
  expect(bodies.receive).toEqual({ lines: [{ order_line_id: 'ol-1', restock: true }] })
  await expect(page.getByTestId('line-stock')).toHaveText('Restocked 1')

  await page.getByRole('button', { name: 'Record refund' }).click()
  const refund = page.getByRole('dialog', { name: 'Record refund for RTN-WEB-000001' })
  await refund.getByLabel('Paid back by').click()
  await page.getByRole('option', { name: 'Bank transfer' }).click()
  await refund.getByLabel('Reference (optional)').fill('TRX-55')
  await refund.getByRole('button', { name: 'Record refund' }).click()
  await expect(refund).toBeHidden()
  expect(bodies.refund).toEqual({ method: 'bank_transfer', reference: 'TRX-55' })
  for (const step of ['approve', 'receive', 'refund']) expect(keys[step]).toMatch(/^[0-9a-f-]{36}$/)
  await expect(page.getByText('Refunded', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('group', { name: 'Return actions' })).toHaveCount(0)
})

test('lists returns by status and reaches them from the navigation', async ({ page, isMobile }) => {
  await mockBackend(page)
  const queries: string[] = []
  await page.route('**/api/v1/web-orders?*', (route) => route.fulfill({ json: page1([]) }))
  await page.route('**/api/v1/web-order-returns?*', (route) => {
    const url = new URL(route.request().url())
    queries.push(url.search)
    const rows = [baseReturn, { ...baseReturn, id: 'rt-2', number: 'RTN-WEB-000002', status: 'refunded', status_label: 'Refunded' }]
    const status = url.searchParams.get('status')
    return route.fulfill({ json: page1(status ? rows.filter((r) => r.status === status) : rows, { status_counts: { requested: 1, refunded: 1 } }) })
  })

  await page.goto('/admin/web-orders')
  if (isMobile) await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('link', { name: 'Web returns' }).click()
  await expect(page.getByRole('heading', { name: 'Web returns' })).toBeVisible()
  const table = page.getByRole('table', { name: 'Web returns' })
  await expect(table.getByRole('link', { name: 'RTN-WEB-000002' })).toBeVisible()
  await expect(page.getByTestId('count-all')).toHaveText('2')

  await page.getByRole('tab', { name: /Refunded/ }).click()
  await expect(table.getByRole('link', { name: 'RTN-WEB-000001' })).toHaveCount(0)
  expect(queries.at(-1)).toContain('status=refunded')
  await expect(page).toHaveURL(/status=refunded/)
})

test('shows a promotion report with KPIs per day', async ({ page }) => {
  await mockBackend(page)
  const promotion = {
    id: 'pr-1', name: 'Juice week', type: 'percent', value: '10.00', scope: 'order', trigger: 'automatic', starts_at: null, ends_at: null, is_active: true,
    state: 'active', coupon_count: 0, redemption_count: 5, discount_total: '250.00', show_countdown: false, description: null, min_subtotal: null,
    max_discount: null, usage_limit: null, usage_limit_per_customer: null, targets: [], coupons_preview: [],
  }
  let requested: Request | null = null
  await page.route('**/api/v1/promotions/pr-1', (route) => route.fulfill({ json: envelope(promotion) }))
  await page.route('**/api/v1/promotions/pr-1/redemptions?*', (route) => route.fulfill({ json: page1([]) }))
  await page.route('**/api/v1/promotions/pr-1/report?*', (route) => {
    requested = route.request()
    return route.fulfill({
      json: envelope({
        redemptions: 5, orders: 5, discount_total: '250.00', order_revenue: '7400.50', average_discount: '50.00',
        by_day: [{ date: '2026-10-30', redemptions: 2, discount: '100.00' }, { date: '2026-10-31', redemptions: 3, discount: '150.00' }],
      }),
    })
  })

  await page.goto('/admin/promotions/pr-1')
  await page.getByRole('tab', { name: 'Report' }).click()
  await expect(page.getByTestId('kpi-revenue')).toHaveText('BDT 7,400.50')
  await expect(page.getByRole('table', { name: 'Redemptions per day' }).getByRole('row')).toHaveCount(4)
  expect(new URL((requested as Request | null)?.url() ?? 'http://x').searchParams.get('date_from')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
})
