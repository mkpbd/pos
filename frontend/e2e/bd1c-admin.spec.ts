import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * BD1c admin, mocked API: staff check bKash "Send Money" transaction IDs on a web order (reject one,
 * confirm the next), find it under "Payment to check", set up a Send Money method, and fill in
 * Marketing → Tracking & pixels (write-only access token, test event). Desktop and mobile.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const page1 = (items: unknown[], meta: Record<string, unknown> = {}) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 }, ...meta })
const failure = (code: string, message: string, details: Record<string, unknown> = {}) => ({ success: false, error: { code, message, details }, meta: { request_id: 'e2e' } })

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: 'XSRF-TOKEN', value: 'e2e-token', url: baseURL ?? 'http://localhost:5173' }])
})

const me = {
  user: { id: 'u-1', name: 'Nadia Admin', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-1', name: 'Online Store Manager', system_key: 'online_store_manager' }],
  permissions: ['web_orders.view', 'web_orders.manage', 'storefront.view', 'payment_gateways.manage', 'marketing.view', 'marketing.manage', 'storefront.custom_html'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
}

type Claim = { id: string; transaction_id: string; status: 'submitted' | 'confirmed' | 'rejected'; reject_reason: string | null; submitted_at: string }

const claimView = (c: Claim) => ({
  id: c.id, method: 'bkash_manual', purpose: 'full', amount: '1560.00', sender_phone: '01812345678', transaction_id: c.transaction_id, status: c.status,
  reject_reason: c.reject_reason, submitted_at: c.submitted_at,
  reviewed_by: c.status === 'submitted' ? null : { id: 'u-1', name: 'Nadia Admin' }, reviewed_at: c.status === 'submitted' ? null : '2026-11-24T06:00:00Z',
})

function orderView(claims: Claim[]) {
  const paid = claims.some((c) => c.status === 'confirmed')
  const open = claims.some((c) => c.status === 'submitted')
  return {
    id: 'wo-1', number: 'WEB-000001', placed_at: '2026-11-24T04:30:00Z', status: paid ? 'confirmed' : 'pending_payment', status_label: paid ? 'Confirmed' : 'Awaiting payment',
    payment_status: paid ? 'paid' : 'unpaid', payment_method: 'bkash_manual', payment_method_label: 'bKash (Send Money)', payment_instructions: null,
    expires_at: paid ? null : '2026-11-25T04:30:00Z',
    contact: { name: 'Ayesha Rahman', email: null, phone: '01711000000' },
    shipping_address: { recipient_name: 'Ayesha Rahman', phone: '01711000000', division: 'Dhaka', district: 'Dhaka', area: 'Dhanmondi', address_line: 'House 12, Road 5', postcode: null },
    shipping_method_name: 'Home delivery', eta_min_days: 1, eta_max_days: 2,
    lines: [{ product_name: 'Baby Romper', variant_name: 'Size M', sku: 'ROMP-M', image_url: null, quantity: '2.000', unit_price: '750.00', line_total: '1500.00', product_url: null }],
    subtotal: '1500.00', tax_total: '0.00', shipping_total: '60.00', cod_fee: '0.00', total: '1560.00', currency: 'BDT', prices_include_tax: false,
    courier_name: null, tracking_number: null,
    history: [{ status: 'pending_payment', label: 'Awaiting payment', at: '2026-11-24T04:30:00Z', actor: 'system', note: null }],
    customer: null, ip: null, user_agent: null, notes: null, cancel_reason: null,
    payments: paid ? [{ method: 'mobile_banking', method_label: 'Mobile banking', amount: '1560.00', reference: 'bKash TrxID BKNEW67890 from 01812345678', recorded_at: '2026-11-24T06:00:00Z', recorded_by: { id: 'u-1', name: 'Nadia Admin' } }] : [],
    allowed_actions: paid ? ['process', 'cancel'] : ['confirm_payment', ...(open ? ['confirm_payment_claim'] : []), 'cancel'],
    advance_amount: '0.00',
    paid_total: paid ? '1560.00' : '0.00',
    payment_due: paid ? null : {
      amount: '1560.00', currency: 'BDT', purpose: 'full', expires_at: '2026-11-25T04:30:00Z',
      methods: [{ code: 'bkash_manual', display_name: 'bKash', account_number: '01712345678', account_type: 'personal' }],
      claim: null,
    },
    payment_claims: [...claims].reverse().map(claimView),
  }
}

async function serveAdmin(page: Page) {
  const state = {
    claims: [{ id: 'pc-1', transaction_id: 'BKOLD12345', status: 'submitted', reject_reason: null, submitted_at: '2026-11-24T05:00:00Z' }] as Claim[],
    rejects: [] as unknown[],
    confirms: [] as string[],
    listQueries: [] as URLSearchParams[],
    gatewayPuts: [] as unknown[],
    trackingPatches: [] as Record<string, unknown>[],
    tests: 0,
    tracking: {
      meta_pixel_id: null, meta_capi_enabled: false, meta_capi_token_set: false, meta_test_event_code: null, ga4_measurement_id: null, tiktok_pixel_id: null,
      head_code: null, body_code: null, capi_last_status: null, capi_last_error: null, capi_last_sent_at: null, can_edit_code: true,
    } as Record<string, unknown>,
    bkash: { code: 'bkash_manual', display_name: 'bKash', is_enabled: false, instructions: null, settings: { account_number: null, account_type: 'personal', hold_hours: 24 }, sort_order: 2 } as Record<string, unknown>,
  }
  const open = () => state.claims.some((c) => c.status === 'submitted')
  const row = () => ({
    id: 'wo-1', number: 'WEB-000001', placed_at: '2026-11-24T04:30:00Z', status: state.claims.some((c) => c.status === 'confirmed') ? 'confirmed' : 'pending_payment',
    payment_status: state.claims.some((c) => c.status === 'confirmed') ? 'paid' : 'unpaid', payment_method: 'bkash_manual',
    contact_name: 'Ayesha Rahman', contact_phone: '01711000000', total: '1560.00', currency: 'BDT', item_count: 2, payment_claim_status: open() ? 'submitted' : null,
  })
  const gateways = () => [
    { code: 'cod', display_name: 'Cash on delivery', is_enabled: true, instructions: null, settings: { max_order_total: null }, sort_order: 0 },
    { code: 'bank_transfer', display_name: 'Bank transfer', is_enabled: false, instructions: null, settings: { hold_hours: 48 }, sort_order: 1 },
    state.bkash,
    { code: 'nagad_manual', display_name: 'Nagad', is_enabled: false, instructions: null, settings: { account_number: null, account_type: 'personal', hold_hours: 24 }, sort_order: 3 },
    { code: 'rocket_manual', display_name: 'Rocket', is_enabled: false, instructions: null, settings: { account_number: null, account_type: 'personal', hold_hours: 24 }, sort_order: 4 },
  ]

  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/') && !url.pathname.startsWith('/api/v1/store/'),
    async (route: Route) => {
      const request = route.request()
      const url = new URL(request.url())
      const key = `${request.method()} ${url.pathname.replace('/api/v1', '')}`
      switch (key) {
        case 'GET /auth/me':
          return route.fulfill({ json: envelope(me) })
        case 'GET /notifications/unread-count':
          return route.fulfill({ json: envelope({ count: 0 }) })
        case 'GET /shipping/couriers':
        case 'GET /geography/districts':
          return route.fulfill({ json: envelope([]) })
        case 'GET /web-orders': {
          state.listQueries.push(url.searchParams)
          const checking = url.searchParams.get('payment_check') === '1'
          const rows = checking && !open() ? [] : [row()]
          return route.fulfill({ json: page1(rows, { status_counts: { pending_payment: open() ? 1 : 0, confirmed: open() ? 0 : 1, payment_check: open() ? 1 : 0 } }) })
        }
        case 'GET /web-orders/wo-1':
          return route.fulfill({ json: envelope(orderView(state.claims)) })
        case 'POST /web-orders/wo-1/payment-claims/pc-1/reject':
        case 'POST /web-orders/wo-1/payment-claims/pc-2/reject': {
          const id = key.includes('pc-1') ? 'pc-1' : 'pc-2'
          const body = request.postDataJSON() as { reason: string }
          state.rejects.push({ id, ...body, key: request.headers()['idempotency-key'] ?? null })
          state.claims = state.claims.map((c) => (c.id === id ? { ...c, status: 'rejected', reject_reason: body.reason } : c))
          // The customer sends the right transaction ID a minute later.
          state.claims.push({ id: 'pc-2', transaction_id: 'BKNEW67890', status: 'submitted', reject_reason: null, submitted_at: '2026-11-24T05:30:00Z' })
          return route.fulfill({ json: envelope(orderView(state.claims)) })
        }
        case 'POST /web-orders/wo-1/payment-claims/pc-2/confirm':
          state.confirms.push(request.headers()['idempotency-key'] ?? '')
          state.claims = state.claims.map((c) => (c.id === 'pc-2' ? { ...c, status: 'confirmed' } : c))
          return route.fulfill({ json: envelope(orderView(state.claims)) })
        case 'GET /payment-gateways':
          return route.fulfill({ json: envelope(gateways()) })
        case 'PUT /payment-gateways/bkash_manual': {
          const body = request.postDataJSON() as Record<string, unknown>
          state.gatewayPuts.push(body)
          state.bkash = { ...state.bkash, ...body }
          return route.fulfill({ json: envelope(state.bkash) })
        }
        case 'GET /marketing/tracking':
          return route.fulfill({ json: envelope(state.tracking) })
        case 'PATCH /marketing/tracking': {
          const body = request.postDataJSON() as Record<string, unknown>
          state.trackingPatches.push(body)
          const { meta_capi_token: token, ...rest } = body
          state.tracking = { ...state.tracking, ...rest, ...(token === undefined ? {} : { meta_capi_token_set: typeof token === 'string' && token !== '' }) }
          return route.fulfill({ json: envelope(state.tracking) })
        }
        case 'GET /marketing/stats':
          return route.fulfill({
            json: envelope({
              range: { from: '2026-11-11', to: '2026-11-24', timezone: 'Asia/Dhaka' }, currency: 'BDT', campaign: null,
              totals: { visits: 0, unique_visitors: 0, orders: 0, cancelled_orders: 0, items: '0.000', revenue: '0.00', conversion_rate: '0.00', average_order_value: '0.00' },
              by_campaign: [], by_source: [], by_day: [],
            }),
          })
        case 'POST /marketing/tracking/test':
          state.tests += 1
          state.tracking = { ...state.tracking, capi_last_status: 'sent', capi_last_error: null, capi_last_sent_at: '2026-11-24T06:30:00Z' }
          return route.fulfill({ json: envelope({ status: 'sent', error: null }) })
      }
      if (key.startsWith('GET /marketing/') || key.startsWith('GET /social/')) return route.fulfill({ json: page1([]) })
      return route.fulfill({ status: 404, json: failure('NOT_FOUND', `No mock for ${key}`) })
    },
  )
  return state
}

async function openMenu(page: Page, isMobile: boolean) {
  if (isMobile) await page.getByRole('button', { name: 'Open navigation' }).click()
}

test('staff reject a wrong transaction ID, then confirm the right one from "Payment to check"', async ({ page }) => {
  const state = await serveAdmin(page)
  await page.goto('/admin/web-orders')

  const tabs = page.getByRole('tablist', { name: 'Order status' })
  await expect(tabs.getByRole('tab', { name: /Payment to check\s*1/ })).toBeVisible()
  await tabs.getByRole('tab', { name: /Payment to check/ }).click()
  await expect(page).toHaveURL(/payment_check=1/)
  await expect(page.getByTestId('trxid-sent-wo-1')).toBeVisible()
  await expect.poll(() => state.listQueries.at(-1)?.get('payment_check')).toBe('1')
  await page.getByRole('link', { name: 'WEB-000001' }).click()

  const card = page.getByTestId('payment-claims-card')
  await expect(card.getByTestId('payment-due')).toContainText('BDT 1,560.00')
  await expect(card.getByTestId('payment-due')).toContainText('01712345678 (Personal)')
  await card.getByRole('group', { name: 'Check transaction ID BKOLD12345' }).getByRole('button', { name: 'Reject' }).click()
  const reject = page.getByRole('dialog', { name: 'Reject transaction ID BKOLD12345?' })
  await reject.getByLabel('Reason').fill('No payment with this TrxID')
  await reject.getByRole('button', { name: 'Reject' }).click()
  await expect(reject).toBeHidden()
  await expect(card.getByTestId('claim-reject-reason')).toHaveText('No payment with this TrxID')
  expect(state.rejects).toMatchObject([{ id: 'pc-1', reason: 'No payment with this TrxID' }])

  await card.getByRole('group', { name: 'Check transaction ID BKNEW67890' }).getByRole('button', { name: 'Confirm payment' }).click()
  const confirm = page.getByRole('dialog', { name: 'Confirm BDT 1,560.00 by bKash (Send Money)?' })
  await expect(confirm).toContainText('BKNEW67890')
  await confirm.getByRole('button', { name: 'Confirm payment' }).click()
  await expect(confirm).toBeHidden()
  await expect(page.getByRole('group', { name: 'Order actions' }).getByRole('button', { name: 'Start processing' })).toBeVisible()
  await expect(card.getByTestId('payment-due')).toHaveCount(0)
  await expect(page.getByText('bKash TrxID BKNEW67890 from 01812345678')).toBeVisible()
  expect(state.confirms).toHaveLength(1)
  expect(state.confirms[0]).toMatch(/^[0-9a-f-]{36}$/)
})

test('a manager turns on bKash Send Money with the shop’s number', async ({ page }) => {
  const state = await serveAdmin(page)
  await page.goto('/admin/storefront/payments')

  const bkash = page.getByRole('form', { name: 'bKash (Send Money) settings' })
  await bkash.getByRole('switch', { name: 'Offer bKash (Send Money) at checkout' }).click()
  await bkash.getByRole('button', { name: 'Save bKash (Send Money)' }).click()
  await expect(bkash.getByText('Enter the number customers send the money to.')).toBeVisible()
  await bkash.getByLabel('Receiving number').fill('01712345678')
  await bkash.getByRole('radio', { name: 'Agent' }).check()
  await bkash.getByLabel('Hold unpaid orders for (hours)').fill('12')
  await bkash.getByRole('button', { name: 'Save bKash (Send Money)' }).click()
  await expect(bkash.getByRole('button', { name: 'Save bKash (Send Money)' })).toBeDisabled()
  await expect(page.getByText('bKash (Send Money)Enabled')).toBeVisible()
  expect(state.gatewayPuts).toEqual([{ is_enabled: true, display_name: 'bKash', instructions: null, settings: { account_number: '01712345678', account_type: 'agent', hold_hours: 12 }, sort_order: 2 }])
})

test('Marketing → Tracking & pixels: pixel IDs, write-only token, test event and pasted code', async ({ page, isMobile }) => {
  const state = await serveAdmin(page)
  await page.goto('/admin/web-orders')
  await openMenu(page, isMobile)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Marketing' }).click()
  await page.getByRole('navigation', { name: 'Marketing sections' }).getByRole('link', { name: 'Tracking & pixels' }).click()
  await expect(page).toHaveURL(/\/admin\/marketing\/tracking$/)

  const form = page.getByRole('form', { name: 'Tracking settings' })
  await form.getByLabel('Pixel ID', { exact: true }).fill('1234567890123456')
  await form.getByRole('switch', { name: 'Send purchases through the Conversions API' }).click()
  await form.getByLabel('Conversions API access token').fill('EAAB-secret-token')
  await form.getByLabel('Test event code (optional)').fill('TEST123')
  await form.getByLabel('Measurement ID').fill('G-AB12CD34EF')
  await form.getByLabel('TikTok pixel ID').fill('C4ABCDEFGHIJ1234KLMN')
  await expect(form).toContainText('Pasted code runs on every page of your shop')
  await form.getByLabel('Code in <head>').fill('<script>window.clarity=1</script>')
  await form.getByRole('button', { name: 'Save tracking settings' }).click()

  await expect(form.getByLabel('Conversions API access token')).toHaveAttribute('placeholder', 'Saved — enter a new one to replace')
  await expect(form.getByLabel('Conversions API access token')).toHaveValue('')
  expect(state.trackingPatches).toEqual([{
    meta_pixel_id: '1234567890123456', meta_capi_enabled: true, meta_test_event_code: 'TEST123', ga4_measurement_id: 'G-AB12CD34EF',
    tiktok_pixel_id: 'C4ABCDEFGHIJ1234KLMN', head_code: '<script>window.clarity=1</script>', meta_capi_token: 'EAAB-secret-token',
  }])

  await form.getByRole('button', { name: 'Send test event' }).click()
  await expect(form.getByTestId('capi-test-result')).toContainText('Test event sent.')
  await expect(form.getByTestId('capi-last')).toContainText('Sent')
  expect(state.tests).toBe(1)
})
