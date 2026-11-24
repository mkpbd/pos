import { expect, test, type Page } from '@playwright/test'

/**
 * BD1a against a mocked API: the SMS page (gateway with a write-only API key, a test SMS, order
 * message templates with placeholder chips and the live SMS counter, the message log), the
 * read-only view for sms.view, and the storefront checkout settings that need SMS codes.
 * Desktop and mobile (375 px wide). No SMS is ever sent.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const paged = (items: unknown[], page = 1, total = items.length) => envelope(items, { pagination: { current_page: page, per_page: 20, total, last_page: Math.max(1, Math.ceil(total / 20)) } })
const failure = (code: string, message: string, details: Record<string, unknown> = {}) => ({ success: false, error: { code, message, details }, meta: { request_id: 'e2e' } })

const meWith = (permissions: string[]) => ({
  user: { id: 'u-1', name: 'Nadia Admin', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-1', name: 'Organization Admin', system_key: 'organization_admin' }],
  permissions,
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
  two_factor: { enabled: true, required: false, setup_required: false },
})

const templates = () => ({
  order_placed: { enabled: true, en: '{shop}: Order {order} received. Total Tk {total}. Track: {link}', bn: '{shop}: আপনার অর্ডার {order} গৃহীত হয়েছে। মোট ৳{total}। ট্র্যাক: {link}' },
  order_confirmed: { enabled: false, en: '{shop}: Payment for order {order} received.', bn: '' },
  order_shipped: { enabled: true, en: '{shop}: Order {order} handed to {courier}, tracking {tracking} {tracking_link}', bn: '' },
  order_delivered: { enabled: true, en: '{shop}: Order {order} delivered. Thank you!', bn: '' },
  order_cancelled: { enabled: true, en: 'Order {order} was cancelled.', bn: '' },
})

const settings = (overrides: Record<string, unknown> = {}) => ({
  is_enabled: false, driver: 'log', http_url: null, http_method: 'POST', http_body: 'form', param_to: 'to', param_message: 'message', param_sender: null,
  param_api_key: null, api_key_set: false, sender_id: null, extra_params: {}, success_contains: null, phone_format: '880', monthly_limit: null,
  templates: templates(), default_templates: templates(), placeholders: ['shop', 'name', 'order', 'total', 'link', 'courier', 'tracking', 'tracking_link'],
  ready: false, otp_ready: false, usage: { month_sent: 1234, month_failed: 5, month_segments: 1502 },
  ...overrides,
})

const message = (overrides: Record<string, unknown> = {}) => ({
  id: 'm-1', to_phone: '01712345678', purpose: 'order_placed', body: 'Berry Kids: Order W-10025 received. Total Tk 1,250.00. Track: https://berry.test/order/W-10025',
  segments: 1, encoding: 'gsm', driver: 'http', status: 'sent', error: null, attempts: 1, created_at: '2026-11-24T08:30:00Z', sent_at: '2026-11-24T08:30:02Z',
  related: { type: 'order', id: 'o-1' }, ...overrides,
})

async function mockApp(page: Page, me: unknown, initial = settings()) {
  const state = { settings: initial as Record<string, unknown>, patches: [] as Record<string, unknown>[], tests: [] as Record<string, unknown>[], logQueries: [] as URLSearchParams[] }
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: paged([]) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/sms/settings', async (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as Record<string, unknown>
      state.patches.push(body)
      const { api_key: apiKey, ...rest } = body
      state.settings = { ...state.settings, ...rest, ...(apiKey === undefined ? {} : { api_key_set: typeof apiKey === 'string' && apiKey !== '' }) }
      const s = state.settings
      const ready = s.is_enabled === true && (s.driver === 'log' || !!s.http_url)
      state.settings = { ...s, ready, otp_ready: ready }
    }
    await route.fulfill({ json: envelope(state.settings) })
  })
  await page.route('**/api/v1/sms/test', async (route) => {
    state.tests.push(route.request().postDataJSON() as Record<string, unknown>)
    await route.fulfill({ json: envelope({ status: 'sent', error: null, provider_status: 200, provider_response: 'SUCCESS 1000', segments: 1, encoding: 'gsm' }) })
  })
  await page.route(/\/api\/v1\/sms\/messages(\?.*)?$/, async (route) => {
    const params = new URL(route.request().url()).searchParams
    state.logQueries.push(params)
    if (params.get('status') === 'failed') return route.fulfill({ json: paged([message({ id: 'm-9', status: 'failed', error: 'Provider answered 500', attempts: 3 })]) })
    await route.fulfill({
      json: paged([
        message(),
        message({ id: 'm-2', purpose: 'otp', body: 'Berry Kids: your code is ••••••. Valid 5 minutes.', status: 'queued', sent_at: null }),
        message({ id: 'm-3', purpose: 'order_shipped', status: 'skipped', error: 'monthly_limit' }),
      ]),
    })
  })
  return state
}

async function phoneWidth(page: Page, isMobile: boolean) {
  if (isMobile) await page.setViewportSize({ width: 375, height: 812 })
}

async function expectNoHorizontalScroll(page: Page) {
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
}

const MANAGER = ['branches.view', 'sms.view', 'sms.manage', 'storefront.view', 'storefront.manage']

test('admin sets up an HTTP gateway, sends a test SMS and edits a template', async ({ page, isMobile }) => {
  await phoneWidth(page, isMobile)
  const state = await mockApp(page, meWith(MANAGER))

  await page.goto('/admin/settings/sms')
  await expect(page.getByRole('heading', { name: 'SMS', level: 1 })).toBeVisible()
  await expect(page.getByTestId('sms-usage')).toHaveText('This month: 1,234 sent, 5 failed, 1,502 SMS parts')
  await expect(page.getByTestId('sms-ready')).toContainText('Not sending')

  const gateway = page.getByRole('form', { name: 'SMS gateway settings' })
  await gateway.getByRole('switch', { name: 'Send SMS' }).click()
  await gateway.getByRole('radio', { name: 'HTTP SMS gateway' }).check()
  await gateway.getByLabel('Gateway address').fill('https://sms.example.com.bd/api/send')
  await gateway.getByLabel('API key parameter').fill('api_key')
  await gateway.getByLabel('API key', { exact: true }).fill('secret-123')
  await gateway.getByLabel('Sender ID', { exact: true }).fill('BERRY')
  await gateway.getByRole('radio', { name: /Local 01712345678/ }).check()
  await gateway.getByRole('button', { name: 'Add parameter' }).click()
  await gateway.getByLabel('Extra parameter 1 name').fill('type')
  await gateway.getByLabel('Extra parameter 1 value').fill('text')
  await expectNoHorizontalScroll(page)
  await gateway.getByRole('button', { name: 'Save gateway settings' }).click()

  await expect(page.getByTestId('sms-ready')).toContainText('Sending')
  await expect(gateway.getByText('Saved', { exact: true })).toBeVisible()
  await expect(gateway.getByLabel('API key', { exact: true })).toHaveValue('')
  expect(state.patches[0]).toEqual({
    is_enabled: true, driver: 'http', http_url: 'https://sms.example.com.bd/api/send', param_api_key: 'api_key', sender_id: 'BERRY',
    extra_params: { type: 'text' }, phone_format: 'local', api_key: 'secret-123',
  })
  // The key never comes back in the settings the page holds.
  expect(JSON.stringify(state.settings)).not.toContain('secret-123')

  const testForm = page.getByRole('form', { name: 'Send a test SMS' })
  await testForm.getByLabel('Mobile number').fill('+880 1712-345678')
  await testForm.getByRole('button', { name: 'Send test SMS' }).click()
  const result = testForm.getByRole('region', { name: 'Test result' })
  await expect(result).toContainText('Sent')
  await expect(result).toContainText('SUCCESS 1000')
  expect(state.tests).toEqual([{ phone: '01712345678' }])

  const cancelled = page.getByTestId('template-order_cancelled')
  const en = cancelled.getByRole('textbox', { name: 'English text for “Order cancelled”' })
  await en.click()
  await en.press('Home')
  await cancelled.getByRole('button', { name: 'Insert {shop} into the English text of “Order cancelled”' }).click()
  await expect(en).toHaveValue('{shop}Order {order} was cancelled.')
  await en.press('End')
  await en.pressSequentially(' আবার অর্ডার করুন')
  await expect(page.getByTestId('template-order_cancelled-en-count')).toContainText('· 1 SMS · Unicode')
  await cancelled.getByRole('button', { name: 'Reset “Order cancelled” to default' }).click()
  await expect(en).toHaveValue('Order {order} was cancelled.')
  await page.getByRole('switch', { name: 'Send “Payment received”' }).click()
  await page.getByRole('button', { name: 'Save templates' }).click()
  await expect(page.getByRole('button', { name: 'Save templates' })).toBeDisabled()
  expect((state.patches[1].templates as Record<string, { enabled: boolean }>).order_confirmed.enabled).toBe(true)

  await expectNoHorizontalScroll(page)
})

test('viewer sees the settings read-only and filters the message log', async ({ page, isMobile }) => {
  await phoneWidth(page, isMobile)
  const state = await mockApp(page, meWith(['branches.view', 'sms.view']), settings({ is_enabled: true, ready: true, otp_ready: false }))

  await page.goto('/admin/settings/sms')
  await expect(page.getByTestId('sms-ready')).toContainText('cannot be sent in test mode on a live server')
  await expect(page.getByRole('switch', { name: 'Send SMS' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Save gateway settings' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Send a test SMS' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save templates' })).toHaveCount(0)

  const table = page.getByRole('table', { name: 'SMS messages' })
  await expect(table.getByRole('row')).toHaveCount(4)
  await expect(table).toContainText('Sign-in / checkout code')
  await expect(table).toContainText('••••••')
  await expect(table).toContainText('Monthly limit reached')

  await page.getByRole('combobox', { name: 'Status' }).click()
  await page.getByRole('option', { name: 'Failed' }).click()
  await expect(table).toContainText('Provider answered 500')
  await expect(table.getByRole('row')).toHaveCount(2)
  expect(state.logQueries.at(-1)?.get('status')).toBe('failed')
  expect(state.patches).toHaveLength(0)
  await expectNoHorizontalScroll(page)
})

test('the sidebar lists SMS for sms.view only', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The sidebar is a drawer on phones; the desktop run covers the entry.')
  await mockApp(page, meWith(['branches.view', 'sms.view']))
  await page.goto('/admin/settings/sms')
  await page.getByRole('link', { name: 'SMS', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/settings\/sms$/)
})

test('storefront checkout: the phone check waits for SMS codes and links to the SMS page', async ({ page, isMobile }) => {
  await phoneWidth(page, isMobile)
  const state = await mockApp(page, meWith(MANAGER))
  const patches: unknown[] = []
  let storefront: Record<string, unknown> = {
    is_enabled: true, site_name: 'Berry Kids', meta_description: null, fulfilment_store_id: null, updated_at: null, guest_checkout_enabled: true,
    checkout_email: 'optional', checkout_phone_verification: 'off', sms_ready: false, otp_ready: false,
  }
  await page.route('**/api/v1/storefront/settings', async (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as Record<string, unknown>
      patches.push(body)
      if (body.checkout_phone_verification && body.checkout_phone_verification !== 'off' && storefront.otp_ready !== true) {
        return route.fulfill({ status: 422, json: failure('SMS_NOT_READY', 'SMS is not ready.') })
      }
      storefront = { ...storefront, ...body }
    }
    await route.fulfill({ json: envelope(storefront) })
  })
  await page.route('**/api/v1/storefront/domains', (route) => route.fulfill({ json: envelope([]) }))

  await page.goto('/admin/storefront')
  const email = page.getByRole('combobox', { name: 'Customer e-mail at checkout' })
  await expect(email).toHaveText('Optional')
  await email.click()
  await page.getByRole('option', { name: 'Hidden' }).click()
  await expect(email).toHaveText('Hidden')
  expect(patches).toEqual([{ checkout_email: 'hidden' }])

  await expect(page.getByRole('combobox', { name: 'Check the phone with an SMS code' })).toBeDisabled()
  await page.getByRole('link', { name: 'Set up SMS' }).click()
  await expect(page).toHaveURL(/\/admin\/settings\/sms$/)
  await expect(page.getByTestId('sms-ready')).toContainText('Not sending')

  // Switch SMS on (test mode), then the store can ask for codes.
  await page.getByRole('switch', { name: 'Send SMS' }).click()
  await page.getByRole('button', { name: 'Save gateway settings' }).click()
  await expect(page.getByTestId('sms-ready')).toContainText('Test mode')
  expect(state.patches.at(-1)).toEqual({ is_enabled: true })
  storefront = { ...storefront, sms_ready: true, otp_ready: true }

  await page.goto('/admin/storefront')
  const verify = page.getByRole('combobox', { name: 'Check the phone with an SMS code' })
  await expect(verify).toBeEnabled()
  await verify.click()
  await page.getByRole('option', { name: 'Cash on delivery orders' }).click()
  await expect(verify).toHaveText('Cash on delivery orders')
  expect(patches.at(-1)).toEqual({ checkout_phone_verification: 'cod' })
  await expectNoHorizontalScroll(page)
})
