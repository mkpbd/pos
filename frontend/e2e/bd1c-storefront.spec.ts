import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * BD1c §6, mocked public API: a guest pays by bKash "Send Money" — places the order, sends the
 * money, types the transaction ID on the thank-you page and sees that the shop is checking it; a
 * cash on delivery shopper is told about the advance delivery charge; the ad pixels (window stubs)
 * get the page views, InitiateCheckout and one Purchase with the order number as the event id.
 */

const envelope = (data: unknown) => ({ success: true, data, meta: { request_id: 'e2e' } })
const failure = (status: number, code: string, message: string, details: Record<string, unknown> = {}) => ({
  status,
  json: { success: false, error: { code, message, details }, meta: { request_id: 'e2e' } },
})

const bootstrap = {
  store: { name: 'Berry Kids', description: 'Clothes and toys for little ones', prices_include_tax: true, currency: 'BDT' },
  preview: false,
  theme: {
    colors: {
      primary: '#f59e0b', primary_foreground: '#3b2500', accent: '#6f55c2', accent_foreground: '#ffffff', highlight: '#2fb79a',
      sale: '#c2410c', heading: '#3d3d3d', text: '#5f6368', canvas: '#f3f7fa', surface: '#ffffff', border: '#e1e1e1',
    },
    typography: { heading_font: 'baloo', body_font: 'poppins' },
    shape: { button_style: 'pill', card_radius: 12 },
    layout: { container_width: 1170, sticky_header: true },
    logo: null,
    favicon: null,
    announcement: null,
    footer: { about: null, copyright: null, contact: { email: null, phone: null, address: null }, social: {}, payment_logos: [] },
    custom_css: null,
  },
  menus: {},
  checkout: { email: 'optional', phone_verification: 'off' },
  tracking: { meta_pixel_id: '123456789012345', ga4_measurement_id: 'G-ABC1234XYZ', tiktok_pixel_id: 'C4ABCDEFGHIJ12345678' },
}

const BKASH = { code: 'bkash_manual', display_name: 'bKash (Send Money)', account_number: '01712345678', account_type: 'personal', instructions: 'Use Send Money, then keep the SMS.' }
const NAGAD = { code: 'nagad_manual', display_name: 'Nagad (Send Money)', account_number: '01812345678', account_type: 'personal', instructions: null }

const line = {
  id: 'l-1', variant_id: 'v-red-m', product: { slug: 'kids-tee', name: 'Kids Tee', url: '/product/kids-tee', image: null },
  variant_name: 'Red / M', option_values: { Colour: 'Red', Size: 'M' }, sku: 'TEE-RM', quantity: '2', unit_price: '450.00', compare_at_price: null,
  line_total: '900.00', purchasable: true, in_stock: true, max_quantity: null, exceeds_stock: false, allow_decimal: false, discount_amount: '0.00', promotion: null,
}
const cart = (empty: boolean) => ({
  id: empty ? null : 'cart-1', items: empty ? [] : [line], item_count: empty ? '0' : '2', subtotal: empty ? '0.00' : '900.00', discount_total: '0.00', tax_total: '0.00',
  total: empty ? '0.00' : '900.00', prices_include_tax: true, currency: 'BDT', issues: [], promotions: [], free_shipping: null, coupon: null,
})
const home = { id: 'sm-home', name: 'Home delivery', description: 'Inside Dhaka', fee: '60.00', free_over: null, cod_allowed: true, cod_fee: '0.00', eta_min_days: 1, eta_max_days: 2 }

type Body = { address?: { district_id?: number }; payment_method?: string; contact?: Record<string, string>; method?: string; sender_phone?: string; transaction_id?: string; token?: string; phone?: string }
type Claim = { method: string; transaction_id: string; sender_phone: string; status: string; reject_reason: null; submitted_at: string }
type State = { placed: boolean; places: Body[]; claims: { body: Body; key: string | null }[]; claim: Claim | null }

async function serveStore(page: Page) {
  const state: State = { placed: false, places: [], claims: [], claim: null }
  const preview = (body: Body) => {
    const served = body.address?.district_id !== undefined
    return {
      lines: [line], subtotal: '900.00', discount_total: '0.00', shipping_discount: '0.00', promotions: [], coupon_code: null, tax_total: '0.00',
      shipping_total: served ? '60.00' : '0.00', cod_fee: '0.00', total: served ? '960.00' : '900.00', currency: 'BDT', prices_include_tax: true,
      shipping_methods: served ? [home] : [], shipping_method_id: served ? 'sm-home' : null, payment_method: body.payment_method ?? null, issues: [],
      // The advance a cash on delivery order needs here: the delivery charge.
      cod_advance: served ? { amount: '60.00', methods: [BKASH, NAGAD] } : null,
    }
  }
  const order = () => ({
    number: 'WEB-000321', status: 'pending_payment', status_label: 'Awaiting payment', payment_status: 'unpaid', payment_method: 'bkash_manual', payment_method_label: 'bKash (Send Money)',
    payment_instructions: null, placed_at: '2026-11-24T10:00:00+06:00', expires_at: '2026-11-25T10:00:00+06:00', contact: { name: 'Karim Uddin', email: null, phone: '01811223344' },
    shipping_address: { recipient_name: 'Karim Uddin', phone: '01811223344', division: 'Dhaka', district: 'Dhaka', area: 'Mirpur', address_line: 'Road 3, House 9', postcode: null },
    shipping_method_name: 'Home delivery', eta_min_days: 1, eta_max_days: 2,
    lines: [{ product_name: 'Kids Tee', variant_name: 'Red / M', sku: 'TEE-RM', image_url: null, quantity: '2.000', unit_price: '450.00', line_total: '900.00', product_url: '/product/kids-tee', discount_amount: '0.00' }],
    subtotal: '900.00', discount_total: '0.00', shipping_discount: '0.00', promotions: [], coupon_code: null, tax_total: '0.00', shipping_total: '60.00', cod_fee: '0.00',
    total: '960.00', currency: 'BDT', prices_include_tax: true, courier_name: null, tracking_number: null,
    history: [{ status: 'pending_payment', label: 'Awaiting payment', at: '2026-11-24T10:00:00+06:00' }],
    payment_due: { amount: '960.00', currency: 'BDT', purpose: 'full', expires_at: '2026-11-25T10:00:00+06:00', methods: [BKASH], claim: state.claim },
  })

  await page.route(
    (url) => url.pathname.startsWith('/api/v1/store/'),
    async (route: Route) => {
      const request = route.request()
      const url = new URL(request.url())
      const key = `${request.method()} ${url.pathname.replace('/api/v1', '')}`
      const body = (request.postDataJSON() ?? {}) as Body
      switch (key) {
        case 'GET /store/bootstrap':
          return route.fulfill({ json: envelope(bootstrap) })
        case 'GET /store/account/me':
          return route.fulfill({ json: envelope(null) })
        case 'GET /store/cart':
          return route.fulfill({ json: envelope(cart(state.placed)) })
        case 'GET /store/wishlist':
          return route.fulfill({ json: envelope({ items: [] }) })
        case 'GET /store/checkout/options':
          return route.fulfill({
            json: envelope({
              available: !state.placed, reason: state.placed ? 'cart_empty' : null, guest_checkout: true, signed_in: false,
              payment_methods: [{ code: 'cod', display_name: 'Cash on delivery' }, BKASH],
              email_field: 'optional', phone_verification: 'off', phone_login: false,
            }),
          })
        case 'GET /store/geo/divisions':
          return route.fulfill({ json: envelope([{ id: 3, name: 'Dhaka', name_bn: null }]) })
        case 'GET /store/geo/districts':
          return route.fulfill({ json: envelope([{ id: 47, division_id: 3, name: 'Dhaka', name_bn: null }]) })
        case 'POST /store/checkout/preview':
          return route.fulfill({ json: envelope(preview(body)) })
        case 'POST /store/checkout':
          state.places.push(body)
          state.placed = true
          return route.fulfill({ status: 201, json: envelope({ order: order(), access_token: 'guest-token' }) })
        case 'GET /store/orders/WEB-000321':
          if (url.searchParams.get('token') !== 'guest-token') return route.fulfill(failure(404, 'ORDER_NOT_FOUND', 'Order not found.'))
          return route.fulfill({ json: envelope(order()) })
        case 'POST /store/orders/WEB-000321/payment-claims':
          state.claims.push({ body, key: request.headers()['idempotency-key'] ?? null })
          if (body.transaction_id === 'USED123456') return route.fulfill(failure(422, 'TRANSACTION_ID_USED', 'This transaction ID was used.'))
          state.claim = { method: body.method ?? '', transaction_id: body.transaction_id ?? '', sender_phone: body.sender_phone ?? '', status: 'submitted', reject_reason: null, submitted_at: '2026-11-24T10:20:00+06:00' }
          return route.fulfill({ status: 201, json: envelope(order()) })
        case 'POST /store/visits':
          return route.fulfill({ json: envelope({ recorded: true }) })
      }
      return route.fulfill(failure(404, 'NOT_FOUND', `No mock for ${key}`))
    },
  )
  return state
}

type PixelCall = { pixel: string; args: unknown[] }

test.beforeEach(async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'XSRF-TOKEN', value: 'e2e-token', url: baseURL ?? 'http://localhost:5173' }])
  // The vendors' scripts are never fetched: recorders stand in for fbq / gtag / ttq.
  await page.route(/connect\.facebook\.net|googletagmanager\.com|analytics\.tiktok\.com/, (route) => route.abort())
  await page.addInitScript(() => {
    const w = globalThis as unknown as Record<string, unknown> & { __pixels: { pixel: string; args: unknown[] }[] }
    w.__pixels = []
    w.fbq = (...args: unknown[]) => w.__pixels.push({ pixel: 'meta', args })
    w.gtag = (...args: unknown[]) => w.__pixels.push({ pixel: 'ga4', args })
    w.ttq = Object.assign([], {
      page: (...args: unknown[]) => w.__pixels.push({ pixel: 'tiktok', args: ['page', ...args] }),
      track: (...args: unknown[]) => w.__pixels.push({ pixel: 'tiktok', args: ['track', ...args] }),
      load: (...args: unknown[]) => w.__pixels.push({ pixel: 'tiktok', args: ['load', ...args] }),
    })
  })
})

const pixelCalls = (page: Page) => page.evaluate(() => (globalThis as unknown as { __pixels: PixelCall[] }).__pixels)
const named = (calls: PixelCall[], pixel: string, name: string) => calls.filter((call) => call.pixel === pixel && call.args[1] === name)

async function fillGuest(page: Page) {
  await page.getByLabel('Full name').fill('Karim Uddin')
  await page.getByRole('textbox', { name: 'Mobile number', exact: true }).fill('01811-223344')
  await page.getByLabel('Division').selectOption('3')
  await page.getByLabel('District').selectOption('47')
  await page.getByLabel('Area / thana').fill('Mirpur')
  await page.getByLabel('Street address').fill('Road 3, House 9')
  await expect(page.getByRole('radio', { name: /Home delivery/ })).toBeChecked()
}

test('a guest pays by bKash Send Money and sends the transaction ID', async ({ page }) => {
  const state = await serveStore(page)
  await page.goto('/checkout')
  await fillGuest(page)

  const bkash = page.getByTestId('payment-option').filter({ hasText: 'bKash (Send Money)' })
  await expect(bkash).toContainText('Send the money to 01712345678 (Personal) after placing the order.')
  await bkash.getByRole('radio').check()
  await expect(page.getByTestId('summary-total')).toHaveText('৳960.00')
  await page.getByRole('button', { name: 'Place order' }).click()

  await expect(page).toHaveURL(/\/order\/WEB-000321$/)
  expect(state.places[0]!.payment_method).toBe('bkash_manual')
  const card = page.getByTestId('payment-due')
  await expect(card.getByRole('heading', { name: 'Pay for your order' })).toBeVisible()
  await expect(card.getByTestId('payment-due-amount')).toHaveText('৳960.00')
  await expect(card.getByTestId('payment-due-account')).toContainText('Send Money to 01712345678 (Personal)')
  await expect(card.getByTestId('payment-due-deadline')).toContainText('Pay before')

  await card.getByLabel('The number you paid from').fill('01911 223344')
  await card.getByLabel('Transaction ID (TrxID)').fill('used123456')
  await card.getByRole('button', { name: 'Send payment details' }).click()
  await expect(card.getByText('This transaction ID has already been used. Please check it and try again.')).toBeVisible()

  await card.getByLabel('Transaction ID (TrxID)').fill('9a8b7c6d5e')
  await card.getByRole('button', { name: 'Send payment details' }).click()
  const status = card.getByTestId('payment-claim-submitted')
  await expect(status).toContainText('We are checking your payment — TrxID 9A8B7C6D5E.')
  await expect(status).toBeFocused()
  await expect(card.getByRole('form', { name: 'Payment details' })).toHaveCount(0)
  expect(state.claims.map((claim) => claim.body)).toEqual([
    { method: 'bkash_manual', sender_phone: '01911223344', transaction_id: 'USED123456', token: 'guest-token' },
    { method: 'bkash_manual', sender_phone: '01911223344', transaction_id: '9A8B7C6D5E', token: 'guest-token' },
  ])
  expect(state.claims.every((claim) => claim.key && claim.key.length >= 8)).toBe(true)
  expect(state.claims[0]!.key).not.toBe(state.claims[1]!.key)

  // The pixels: page views, InitiateCheckout on the checkout, one Purchase with the order number as the event id.
  let calls = await pixelCalls(page)
  expect(calls.filter((call) => call.pixel === 'meta' && call.args[0] === 'init')).toEqual([{ pixel: 'meta', args: ['init', '123456789012345'] }])
  expect(named(calls, 'meta', 'PageView').length).toBeGreaterThanOrEqual(2)
  expect(named(calls, 'meta', 'InitiateCheckout')).toHaveLength(1)
  expect(named(calls, 'meta', 'Purchase')).toEqual([{ pixel: 'meta', args: ['track', 'Purchase', expect.objectContaining({ value: 960, currency: 'BDT', content_ids: ['TEE-RM'] }), { eventID: 'WEB-000321' }] }])
  expect(named(calls, 'ga4', 'purchase')).toEqual([{ pixel: 'ga4', args: ['event', 'purchase', expect.objectContaining({ transaction_id: 'WEB-000321', value: 960 })] }])
  expect(calls.filter((call) => call.pixel === 'tiktok' && call.args[1] === 'CompletePayment')).toEqual([{ pixel: 'tiktok', args: ['track', 'CompletePayment', expect.objectContaining({ value: 960 }), { event_id: 'WEB-000321' }] }])
  expect(calls.filter((call) => call.pixel === 'ga4' && call.args[0] === 'config')).toEqual([{ pixel: 'ga4', args: ['config', 'G-ABC1234XYZ', { send_page_view: false }] }])

  // A reload keeps the "checking" state and does not count the purchase again.
  await page.reload()
  await expect(page.getByTestId('payment-claim-submitted')).toContainText('TrxID 9A8B7C6D5E')
  calls = await pixelCalls(page)
  expect(named(calls, 'meta', 'PageView')).toHaveLength(1)
  expect(named(calls, 'meta', 'Purchase')).toEqual([])
  // Nothing is wider than the screen.
  const overflow = await page.locator('html').evaluate((html) => html.scrollWidth - html.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('a cash on delivery shopper is told about the advance delivery charge', async ({ page }) => {
  await serveStore(page)
  await page.goto('/checkout')
  await fillGuest(page)
  const cod = page.getByTestId('payment-option').filter({ hasText: 'Cash on delivery' })
  await expect(cod.getByTestId('cod-advance-notice')).toHaveText(
    'Pay the delivery charge of ৳60.00 in advance by bKash / Nagad after placing your order. The rest is paid in cash on delivery.',
  )
  await cod.getByRole('radio').check()
  await expect(cod.getByRole('radio')).toBeChecked()
})
