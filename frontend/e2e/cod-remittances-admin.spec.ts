import { expect, test, type Page, type Request } from '@playwright/test'

/**
 * COD remittances (E10a) against a mocked API: a courier pays over the cash it collected;
 * the accountant ticks the delivered COD orders, enters the fee and records the remittance.
 * Runs on desktop and mobile.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const page1 = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })
const failure = (code: string, message: string, details: Record<string, unknown> = {}) => ({ success: false, error: { code, message, details }, meta: { request_id: 'e2e' } })

const me = {
  user: { id: 'u-2', name: 'Shila Accountant', email: 'shila@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-5', name: 'Accountant', system_key: 'accountant' }],
  permissions: ['branches.view', 'web_orders.view', 'web_orders.remit'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
}

const couriers = [
  { id: 'c-1', name: 'Pathao', phone: null, tracking_url_template: null, is_active: true, sort_order: 0 },
  { id: 'c-2', name: 'Steadfast', phone: null, tracking_url_template: null, is_active: true, sort_order: 1 },
]

const deliveredRow = (id: string, number: string, total: string) => ({
  id, number, placed_at: '2026-10-28T04:30:00Z', status: 'delivered', payment_status: 'unpaid', payment_method: 'cod',
  contact_name: 'Ayesha Rahman', contact_phone: '01711000000', total, currency: 'BDT', item_count: 1, courier_name: 'Steadfast', tracking_number: `SF-${number}`,
})
const candidates = [deliveredRow('wo-3', 'WEB-000003', '1200.00'), deliveredRow('wo-4', 'WEB-000004', '800.50'), deliveredRow('wo-5', 'WEB-000005', '300.00')]

const remittance = {
  id: 'rem-1', number: 'REM-000001', courier_id: 'c-2', courier: { id: 'c-2', name: 'Steadfast' }, reference: 'SF-STMT-12', received_at: '2026-10-30', method: 'mobile_banking',
  gross_amount: '2000.50', fee_amount: '40.00', net_amount: '1960.50', order_count: 2, currency: 'BDT', note: null, created_by: { id: 'u-2', name: 'Shila Accountant' }, method_label: 'Mobile banking', expense: { id: 'ex-1', number: 'EXP-000003' }, created_at: '2026-10-30T09:00:00Z',
  lines: [{ order_id: 'wo-3', number: 'WEB-000003', amount: '1200.00' }, { order_id: 'wo-4', number: 'WEB-000004', amount: '800.50' }],
}

async function mockBackend(page: Page) {
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/shipping/couriers', (route) => route.fulfill({ json: envelope(couriers) }))
  await page.route('**/api/v1/geography/districts', (route) => route.fulfill({ json: envelope([]) }))
}

test('records a courier remittance and opens it', async ({ page }) => {
  await mockBackend(page)
  const recorded: unknown[] = []
  let attempts = 0
  const queries: string[] = []
  await page.route('**/api/v1/cod-remittances?*', (route) => route.fulfill({ json: page1(recorded) }))
  await page.route('**/api/v1/web-orders?*', (route) => {
    queries.push(new URL(route.request().url()).search)
    return route.fulfill({ json: page1(candidates) })
  })
  await page.route('**/api/v1/cod-remittances', (route) => {
    attempts += 1
    if (attempts === 1) {
      return route.fulfill({ status: 422, json: failure('REMITTANCE_INVALID', 'Some orders cannot be remitted.', { orders: [{ id: 'wo-5', number: 'WEB-000005', reason: 'already_paid' }] }) })
    }
    recorded.push(remittance)
    return route.fulfill({ status: 201, json: envelope(remittance) })
  })
  await page.route('**/api/v1/cod-remittances/rem-1', (route) => route.fulfill({ json: envelope(remittance) }))

  await page.goto('/admin/cod-remittances')
  await expect(page.getByText('No remittances yet')).toBeVisible()
  await page.getByRole('link', { name: 'New remittance' }).click()

  await page.getByLabel('Courier that paid').click()
  await page.getByRole('option', { name: 'Steadfast' }).click()
  const table = page.getByRole('table', { name: 'Orders to remit' })
  await expect(table).toContainText('WEB-000004')
  expect(queries.at(-1)).toContain('courier_id=c-2')
  expect(queries.at(-1)).toContain('cod_unremitted=1')

  await table.getByRole('checkbox', { name: 'Select all orders on this page' }).click()
  await expect(page.getByTestId('running-total')).toContainText('3 orders selected · collected BDT 2,300.50')
  await page.getByLabel(/Courier fee/).fill('40')
  await page.getByLabel('Received by').click()
  await page.getByRole('option', { name: 'Mobile banking' }).click()
  await page.getByLabel("Courier's statement no. (optional)").fill('SF-STMT-12')
  await page.getByLabel('Received on').fill('2026-10-30')

  const first = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/cod-remittances') && r.method() === 'POST')
  await page.getByRole('button', { name: 'Record remittance' }).click()
  const firstRequest = await first
  expect(firstRequest.postDataJSON()).toEqual({
    courier_id: 'c-2', reference: 'SF-STMT-12', received_at: '2026-10-30', method: 'mobile_banking', fee_amount: '40', order_ids: ['wo-3', 'wo-4', 'wo-5'], note: null,
  })
  expect(firstRequest.headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)

  await expect(table.getByTestId('invalid-reason')).toHaveText('Already paid')
  await page.getByRole('button', { name: 'Remove them from the selection' }).click()
  await expect(page.getByTestId('running-total')).toContainText('2 orders selected · collected BDT 2,000.50')
  await expect(page.getByTestId('net-amount')).toHaveText('BDT 1,960.50')

  const second = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/cod-remittances') && r.method() === 'POST')
  await page.getByRole('button', { name: 'Record remittance' }).click()
  const secondRequest = await second
  expect((secondRequest.postDataJSON() as { order_ids: string[] }).order_ids).toEqual(['wo-3', 'wo-4'])
  // A changed payload is a new logical request.
  expect(secondRequest.headers()['idempotency-key']).not.toBe(firstRequest.headers()['idempotency-key'])

  await expect(page).toHaveURL(/\/admin\/cod-remittances\/rem-1$/)
  await expect(page.getByRole('heading', { name: 'REM-000001' })).toBeVisible()
  await expect(page.getByTestId('net-amount')).toHaveText('BDT 1,960.50')
  await expect(page.getByRole('table', { name: 'Orders in this remittance' }).getByRole('link', { name: 'WEB-000003' })).toBeVisible()
})

test('lists remittances and reaches them from the navigation', async ({ page, isMobile }) => {
  await mockBackend(page)
  await page.route('**/api/v1/cod-remittances?*', (route) => route.fulfill({ json: page1([remittance]) }))
  await page.route('**/api/v1/web-orders?*', (route) => route.fulfill({ json: page1([]) }))

  await page.goto('/admin/web-orders')
  if (isMobile) await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('link', { name: 'COD remittances' }).click()
  await expect(page.getByRole('heading', { name: 'COD remittances' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'REM-000001' })).toBeVisible()
  await expect(page.getByRole('row').nth(1)).toContainText('BDT 1,960.50')
})
