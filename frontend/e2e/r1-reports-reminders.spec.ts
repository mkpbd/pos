import { expect, test, type Page } from '@playwright/test'

/**
 * R1, mocked API: run the loss prevention report (summary, then every event with links to the
 * documents), change Organization → Alerts & reminders, send a customer a due reminder by SMS
 * (with the WhatsApp link beside it), and open an expiry alert from the notification bell.
 * Desktop and mobile (375 px; the menu opens with "Open navigation").
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const page1 = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })
const failure = (code: string, message: string, details: Record<string, unknown> = {}) => ({ success: false, error: { code, message, details }, meta: { request_id: 'e2e' } })

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: 'XSRF-TOKEN', value: 'e2e-token', url: baseURL ?? 'http://localhost:5173' }])
})

async function phoneWidth(page: Page, isMobile: boolean) {
  if (isMobile) await page.setViewportSize({ width: 375, height: 812 })
}

async function expectNoHorizontalScroll(page: Page) {
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
}

async function openMenuItem(page: Page, isMobile: boolean, name: string) {
  if (isMobile) await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true }).click()
}

const me = {
  user: { id: 'u-1', name: 'Mina Owner', email: 'mina@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-1', name: 'Organization Admin', system_key: 'organization_admin' }],
  permissions: ['branches.view', 'reports.view', 'users.view', 'sales.view', 'returns.view', 'cash_registers.view', 'organization.view', 'organization.update', 'customers.view', 'customers.manage', 'payments.view'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
  two_factor: { enabled: false, required: false, setup_required: false },
  pin_set: true,
}

const dateParams = [
  { name: 'date_from', label: 'From', type: 'date', required: true },
  { name: 'date_to', label: 'To', type: 'date', required: true },
]
const col = (key: string, label: string, type: string, sortable = true) => ({ key, label, type, cost_sensitive: false, sortable })
const SUMMARY = [col('cashier', 'Cashier', 'text'), col('cancelled_count', 'Cancelled sales', 'number'), col('cancelled_value', 'Cancelled value', 'money'), col('discounts', 'Discounts given', 'money'),
  col('overrides_count', 'Price overrides', 'number'), col('overrides_value', 'Given away by overrides', 'money'), col('no_sales', 'No-sale openings', 'number'),
  col('returns_count', 'Returns', 'number'), col('returns_value', 'Refunded', 'money'), col('exchanges', 'Exchanges', 'number')]
const EVENTS = [col('date', 'Date', 'datetime'), col('cashier', 'Cashier', 'text'), col('event', 'Type', 'text'), col('document', 'Document', 'text'), col('amount', 'Amount', 'money'), col('reason', 'Reason', 'text', false)]

const registry = [
  {
    key: 'loss_prevention', title: 'Loss prevention', description: 'Per cashier: cancelled sales, discounts, price overrides, no-sale openings, returns and exchanges.', group: 'sales', group_label: 'Sales',
    permission: 'reports.view', financial: false, time_based: true, granularity: null, max_range_days: 1827,
    params: [...dateParams, { name: 'branch_id', label: 'Branch', type: 'entity', required: false, entity: 'branch' }, { name: 'cashier_id', label: 'Cashier', type: 'entity', required: false, entity: 'cashier' },
      { name: 'show', label: 'Show', type: 'enum', required: false, default: 'summary', options: [{ value: 'summary', label: 'Summary per cashier' }, { value: 'events', label: 'Every event' }] }],
    columns: [...EVENTS, ...SUMMARY.slice(1)], default_sort: 'date', totals: true, paginated: true, omitted_columns: [],
  },
  {
    key: 'expiry', title: 'Expiry', description: 'Batches in stock that are expired or expire soon.', group: 'inventory', group_label: 'Inventory', permission: 'reports.view',
    financial: false, time_based: false, granularity: null, max_range_days: null,
    params: [{ name: 'store_id', label: 'Store', type: 'entity', required: false, entity: 'store' }, { name: 'days', label: 'Expiring within (days)', type: 'integer', required: false, default: 30, min: 0, max: 3650 }],
    columns: [col('product', 'Product', 'text'), col('batch', 'Batch', 'text'), col('expires_on', 'Expires on', 'date'), col('quantity', 'Quantity', 'quantity')], default_sort: 'expires_on', totals: false, paginated: true, omitted_columns: [],
  },
]

const now = new Date().toISOString()
const lossRun = (show: string | null) => show === 'events'
  ? envelope([
    { date: now, cashier_id: 'u-2', cashier: 'Karim', event: 'Cancelled sale', document_type: 'sale', document_id: 'sa-9', document: 'INV-MAIN-000009', amount: '900.00', reason: 'Wrong items · approved by Mina Owner' },
    { date: now, cashier_id: 'u-2', cashier: 'Karim', event: 'Return', document_type: 'sale_return', document_id: 'rt-4', document: 'RET-000004', amount: '250.00', reason: 'Damaged' },
  ], { pagination: { current_page: 1, per_page: 50, total: 2, last_page: 1 }, totals: null, columns: EVENTS, generated_at: now })
  : envelope([{ cashier_id: 'u-2', cashier: 'Karim', cancelled_count: 1, cancelled_value: '900.00', discounts: '150.00', overrides_count: 1, overrides_value: '40.00', no_sales: 2, returns_count: 1, returns_value: '250.00', exchanges: 0 }], {
    pagination: { current_page: 1, per_page: 50, total: 1, last_page: 1 }, columns: SUMMARY, generated_at: now,
    totals: { cancelled_count: 1, cancelled_value: '900.00', discounts: '150.00', overrides_count: 1, overrides_value: '40.00', no_sales: 2, returns_count: 1, returns_value: '250.00', exchanges: 0 },
  })

const organization = {
  id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', legal_name: null, tax_number: null, email: null, phone: null, address: null,
  base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active', settings: {}, two_factor_summary: { users: 4, enabled: 1, required_missing: 0 },
}

const customer = {
  id: 'c-1', code: 'CUS-000001', name: 'Rina Akter', phone: '01712345678', email: null, address: null, tax_number: null,
  group: null, credit_limit: '0.00', opening_balance: '0.00', notes: null, is_active: true, archived_at: null,
}
const WHATSAPP = 'https://wa.me/8801712345678?text=Berry%20Kids%3A%20Dear%20Rina%20Akter%2C%20you%20owe%20Tk%202%2C450.00.'

const expiryAlert = {
  id: 'n-1', type: 'App\\Modules\\Inventory\\Infrastructure\\Notifications\\ExpiryAlertNotification', read_at: null, created_at: now,
  data: {
    title: 'Expiring stock: Shop floor', message: '1 batch at Shop floor has expired or expires within 30 days.', count: 1,
    items: [{ variant_id: 'v-1', product: 'Baby lotion', batch: 'BL-7', expires_on: '2026-12-10', quantity: '6.000' }],
    link: '/reports/expiry?store_id=s-1',
  },
}

async function serve(page: Page) {
  const state = { alertPatches: [] as Record<string, unknown>[], reminders: 0, reads: [] as string[], runs: [] as Record<string, string>[] }
  let alerts = { daily_summary: true, daily_summary_hour: 21, expiry_alert_days: 30, register_open_hours: 14, due_reminders: 'off', due_reminder_min: '100.00', due_reminder_weekday: 6 }
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204 }))
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const key = `${request.method()} ${url.pathname.replace('/api/v1', '')}`
    switch (key) {
      case 'GET /auth/me':
        return route.fulfill({ json: envelope(me) })
      case 'GET /notifications/unread-count':
        return route.fulfill({ json: envelope({ count: state.reads.length > 0 ? 0 : 1 }) })
      case 'GET /notifications':
        return route.fulfill({ json: envelope([{ ...expiryAlert, read_at: state.reads.length > 0 ? now : null }]) })
      case 'POST /notifications/n-1/read':
        state.reads.push('n-1')
        return route.fulfill({ json: envelope(null) })
      case 'GET /reports':
        return route.fulfill({ json: envelope(registry) })
      case 'GET /reports/loss_prevention':
        state.runs.push(Object.fromEntries(url.searchParams))
        return route.fulfill({ json: lossRun(url.searchParams.get('show')) })
      case 'GET /reports/expiry':
        state.runs.push(Object.fromEntries(url.searchParams))
        return route.fulfill({ json: envelope([], { pagination: { current_page: 1, per_page: 50, total: 0, last_page: 1 }, totals: null, generated_at: now }) })
      case 'GET /organization':
        return route.fulfill({ json: envelope(organization) })
      case 'GET /settings/alerts':
        return route.fulfill({ json: envelope(alerts) })
      case 'PATCH /settings/alerts': {
        const input = request.postDataJSON() as Record<string, unknown>
        state.alertPatches.push(input)
        alerts = { ...alerts, ...input, due_reminder_min: `${String(input.due_reminder_min ?? alerts.due_reminder_min)}.00` } as typeof alerts
        return route.fulfill({ json: envelope(alerts) })
      }
      case 'GET /customers':
        return route.fulfill({ json: page1([customer]) })
      case 'GET /customer-groups':
        return route.fulfill({ json: envelope([]) })
      case 'GET /sales/customer-balances':
        return route.fulfill({ json: envelope({ 'c-1': '2450.00' }) })
      case 'GET /loyalty/settings':
        return route.fulfill({ json: envelope({ is_enabled: false, spend_amount: '100.00', points_per_spend: 1, point_value: '1.00', min_redeem_points: 0 }) })
      case 'GET /loyalty/customers/c-1':
        return route.fulfill({ json: envelope({ customer: { id: 'c-1', code: 'CUS-000001', name: 'Rina Akter' }, balance: 0, lifetime_earned: 0, lifetime_redeemed: 0, transactions: [] }) })
      case 'GET /customers/c-1':
        return route.fulfill({ json: envelope({ ...customer, online_account: null, whatsapp_reminder_url: WHATSAPP }) })
      case 'GET /customers/c-1/statement':
        return route.fulfill({ json: envelope({ customer: { id: 'c-1', code: 'CUS-000001', name: 'Rina Akter', phone: '01712345678', credit_limit: '0.00' }, opening_balance: '0.00', entries: [], closing_balance: '2450.00' }) })
      case 'GET /customers/c-1/web-activity':
        return route.fulfill({ json: envelope({ account: null, orders: { count: 0, total_spent: '0.00', last_order_at: null, average_order: null }, returns_count: 0, reviews: { count: 0, pending: 0 }, wishlist_count: 0, cart: null, recent_orders: [] }) })
      case 'POST /customers/c-1/due-reminder':
        state.reminders++
        if (state.reminders === 1) return route.fulfill({ status: 422, json: failure('SMS_NOT_READY', 'SMS is not set up.') })
        return route.fulfill({ json: envelope({ recipient_masked: '017••••678', status: 'queued', due: '2450.00' }) })
    }
    if (request.method() === 'GET') return route.fulfill({ json: page1([]) })
    return route.fulfill({ status: 404, json: failure('NOT_FOUND', `No mock for ${key}`) })
  })
  return state
}

test('run the loss prevention report: summary per cashier, then every event linking to its document', async ({ page, isMobile }) => {
  await phoneWidth(page, isMobile)
  const state = await serve(page)
  await page.goto('/admin/organization')
  await openMenuItem(page, isMobile, 'Reports')
  await page.getByRole('region', { name: 'Sales' }).getByRole('link', { name: /Loss prevention/ }).click()
  await expect(page.getByRole('heading', { name: 'Loss prevention', level: 1 })).toBeVisible()

  const table = page.getByRole('table', { name: 'Loss prevention' })
  await expect(table.getByRole('row', { name: /Karim/ })).toContainText('900.00')
  await expect(table.getByTestId('report-totals')).toContainText('Total')
  expect(state.runs.at(-1)).toMatchObject({ show: 'summary' })

  await page.getByRole('combobox', { name: 'Show' }).click()
  await page.getByRole('option', { name: 'Every event' }).click()
  await expect(table.getByRole('link', { name: 'INV-MAIN-000009' })).toHaveAttribute('href', '/admin/sales/sa-9')
  await expect(table.getByRole('link', { name: 'RET-000004' })).toHaveAttribute('href', '/admin/returns/rt-4')
  await expect(table.getByRole('row', { name: /Wrong items/ })).toContainText('approved by Mina Owner')
  await expect(page).toHaveURL(/show=events/)
  expect(state.runs.at(-1)).toMatchObject({ show: 'events' })
})

test('change the alerts and due reminder schedule', async ({ page, isMobile }) => {
  await phoneWidth(page, isMobile)
  const state = await serve(page)
  await page.goto('/admin/customers')
  await openMenuItem(page, isMobile, 'Organization')

  const form = page.getByRole('form', { name: 'Alerts and reminders' })
  await expect(form.getByRole('switch', { name: 'Daily summary' })).toBeChecked()
  await expect(form.getByRole('combobox', { name: 'Summary time' })).toHaveText('21:00')
  await expectNoHorizontalScroll(page)

  await form.getByRole('combobox', { name: 'Summary time' }).click()
  await page.getByRole('option', { name: '20:00' }).click()
  await form.getByLabel('Open register alert (hours)').fill('12')
  await form.getByRole('combobox', { name: 'Due reminders (SMS)' }).click()
  await page.getByRole('option', { name: 'Weekly' }).click()
  await form.getByRole('combobox', { name: 'Day of the week' }).click()
  await page.getByRole('option', { name: 'Friday' }).click()
  await form.getByLabel('Minimum amount owed').fill('500')
  await expectNoHorizontalScroll(page)
  await form.getByRole('button', { name: 'Save alerts' }).click()

  await expect(form.getByLabel('Minimum amount owed')).toHaveValue('500.00')
  await expect(form.getByRole('button', { name: 'Save alerts' })).toBeDisabled()
  expect(state.alertPatches).toEqual([{
    daily_summary: true, daily_summary_hour: 20, expiry_alert_days: 30, register_open_hours: 12,
    due_reminders: 'weekly', due_reminder_weekday: 5, due_reminder_min: '500',
  }])
})

test('send a customer a due reminder by SMS, with a WhatsApp link beside it', async ({ page, isMobile }) => {
  await phoneWidth(page, isMobile)
  const state = await serve(page)
  await page.goto('/admin/organization')
  await openMenuItem(page, isMobile, 'Customers')
  await page.getByRole('button', { name: 'Account of Rina Akter' }).click()

  const sheet = page.getByRole('dialog', { name: 'Rina Akter' })
  await expect(sheet.getByTestId('statement-balance')).toContainText('2,450.00')
  const whatsapp = sheet.getByRole('link', { name: 'WhatsApp' })
  await expect(whatsapp).toHaveAttribute('href', WHATSAPP)
  await expect(whatsapp).toHaveAttribute('target', '_blank')
  await expect(whatsapp).toHaveAttribute('rel', /noopener/)

  await sheet.getByRole('button', { name: 'Send due reminder (SMS)' }).click()
  await expect(sheet.getByRole('alert')).toHaveText('SMS is not set up — Settings → SMS.')
  await sheet.getByRole('button', { name: 'Send due reminder (SMS)' }).click()
  await expect(sheet.getByRole('status')).toHaveText('Sent to 017••••678')
  expect(state.reminders).toBe(2)
  await expectNoHorizontalScroll(page)
})

test('open an expiry alert from the notification bell', async ({ page, isMobile }) => {
  await phoneWidth(page, isMobile)
  const state = await serve(page)
  await page.goto('/admin/organization')

  await page.getByRole('button', { name: 'Notifications (1 unread)' }).click()
  const alert = page.getByRole('button', { name: /Expiring stock: Shop floor/ })
  await expect(alert).toContainText('Baby lotion · batch BL-7 · expires 2026-12-10 · qty 6')
  await alert.click()

  await expect(page.getByRole('heading', { name: 'Expiry', level: 1 })).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/reports\/expiry\?store_id=s-1/)
  expect(state.reads).toEqual(['n-1'])
  expect(state.runs.at(-1)).toMatchObject({ store_id: 's-1', days: '30' })
})
