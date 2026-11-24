import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * BD1b §7, mocked API: staff confirm an order held for a call, block its number from its delivery
 * history and unblock it on Blocked numbers; on the store, cash on delivery is refused for a blocked
 * number and a held order tells the shopper the shop will call.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const page1 = (items: unknown[], meta: Record<string, unknown> = {}) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 }, ...meta })

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: 'XSRF-TOKEN', value: 'e2e-token', url: baseURL ?? 'http://localhost:5173' }])
})

// ── Admin ────────────────────────────────────────────────────────────────────

const me = {
  user: { id: 'u-1', name: 'Nadia Admin', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-1', name: 'Online Store Manager', system_key: 'online_store_manager' }],
  permissions: ['web_orders.view', 'web_orders.manage', 'storefront.view'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
}

const PHONE = '01711000000'
const row = {
  id: 'wo-1', number: 'WEB-000001', placed_at: '2026-11-24T04:30:00Z', status: 'pending_confirmation', payment_status: 'unpaid', payment_method: 'cod',
  contact_name: 'Ayesha Rahman', contact_phone: PHONE, total: '1560.00', currency: 'BDT', item_count: 2, risk: { success_rate: 33, blocked: false },
}
const report = (blocked: boolean) => ({
  phone: PHONE, orders: 3, delivered: 1, returned: 2, cancelled: 0, in_progress: 0, success_rate: 33, last_order_at: '2026-10-20T04:30:00Z',
  blocked, block_reason: blocked ? 'Refused 2 parcels' : null,
})
const order = (status: 'pending_confirmation' | 'confirmed', blocked: boolean) => ({
  ...row, status, status_label: status === 'confirmed' ? 'Confirmed' : 'Awaiting confirmation', payment_method_label: 'Cash on delivery', payment_instructions: null, expires_at: null,
  contact: { name: 'Ayesha Rahman', email: null, phone: PHONE },
  shipping_address: { recipient_name: 'Ayesha Rahman', phone: PHONE, division: 'Dhaka', district: 'Dhaka', area: 'Dhanmondi', address_line: 'House 12, Road 5', postcode: null },
  shipping_method_name: 'Home delivery', eta_min_days: 1, eta_max_days: 2,
  lines: [{ product_name: 'Baby Romper', variant_name: 'Size M', sku: 'ROMP-M', image_url: null, quantity: '2.000', unit_price: '750.00', line_total: '1500.00', product_url: null }],
  subtotal: '1500.00', tax_total: '0.00', shipping_total: '60.00', cod_fee: '0.00', prices_include_tax: false, courier_name: null, tracking_number: null,
  history: [
    { status: 'pending_confirmation', label: 'Awaiting confirmation', at: '2026-11-24T04:30:00Z', actor: 'system', note: 'Order placed — awaiting confirmation' },
    ...(status === 'confirmed' ? [{ status: 'confirmed', from: 'pending_confirmation', label: 'Confirmed', at: '2026-11-24T05:00:00Z', actor: { id: 'u-1', name: 'Nadia Admin' }, note: 'Spoke to Ayesha' }] : []),
  ],
  customer: null, ip: null, user_agent: null, notes: null, cancel_reason: null, payments: [],
  allowed_actions: status === 'confirmed' ? ['process', 'cancel'] : ['confirm', 'cancel'],
  phone_report: report(blocked),
})

async function serveAdmin(page: Page) {
  const state = { status: 'pending_confirmation' as 'pending_confirmation' | 'confirmed', blocked: false, confirms: [] as unknown[], blocks: [] as unknown[], unblocks: 0 }
  const blockRow = () => ({ id: 'bp-1', phone: PHONE, reason: 'Refused 2 parcels', created_by: { id: 'u-1', name: 'Nadia Admin' }, created_at: '2026-11-24T05:01:00Z' })
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
        case 'GET /web-orders':
          return route.fulfill({ json: page1([{ ...row, status: state.status, risk: { success_rate: 33, blocked: state.blocked } }], { status_counts: { pending_confirmation: state.status === 'confirmed' ? 0 : 1, confirmed: state.status === 'confirmed' ? 1 : 0 } }) })
        case 'GET /web-orders/wo-1':
          return route.fulfill({ json: envelope(order(state.status, state.blocked)) })
        case 'POST /web-orders/wo-1/confirm':
          state.confirms.push(request.postDataJSON())
          state.status = 'confirmed'
          return route.fulfill({ json: envelope(order(state.status, state.blocked)) })
        case 'GET /web-orders/blocked-phones':
          return route.fulfill({ json: page1(state.blocked ? [blockRow()] : []) })
        case 'POST /web-orders/blocked-phones':
          state.blocks.push(request.postDataJSON())
          state.blocked = true
          return route.fulfill({ status: 201, json: envelope(blockRow()) })
        case 'DELETE /web-orders/blocked-phones/bp-1':
          state.unblocks += 1
          state.blocked = false
          return route.fulfill({ status: 204 })
      }
      return route.fulfill({ status: 404, json: { success: false, error: { code: 'NOT_FOUND', message: `No mock for ${key}`, details: {} }, meta: { request_id: 'e2e' } } })
    },
  )
  return state
}

test('staff confirm a held order after a call, block the number and unblock it again', async ({ page, isMobile }) => {
  const state = await serveAdmin(page)
  await page.goto('/admin/web-orders')

  await expect(page.getByRole('tab', { name: /Awaiting confirmation\s*1/ })).toBeVisible()
  await expect(page.getByTestId('order-risk-WEB-000001')).toContainText('33%')
  await page.getByRole('link', { name: 'WEB-000001' }).click()

  await expect(page.getByRole('heading', { name: 'WEB-000001' })).toBeVisible()
  const history = page.getByTestId('delivery-history')
  await expect(history).toContainText('Delivered')
  await expect(history.getByTestId('success-rate')).toHaveAttribute('data-tone', 'poor')

  await page.getByRole('group', { name: 'Order actions' }).getByRole('button', { name: 'Confirm order' }).click()
  const dialog = page.getByRole('dialog', { name: 'Confirm WEB-000001?' })
  await dialog.getByLabel('Note (optional)').fill('Spoke to Ayesha')
  await dialog.getByRole('button', { name: 'Confirm order' }).click()
  await expect(page.getByRole('group', { name: 'Order actions' }).getByRole('button', { name: 'Start processing' })).toBeVisible()
  expect(state.confirms).toEqual([{ note: 'Spoke to Ayesha' }])

  await history.getByRole('button', { name: 'Block number' }).click()
  const block = page.getByRole('dialog', { name: `Block ${PHONE}?` })
  await block.getByLabel('Reason (optional)').fill('Refused 2 parcels')
  await block.getByRole('button', { name: 'Block number' }).click()
  await expect(history.getByText('Blocked', { exact: true })).toBeVisible()
  await expect(history.getByTestId('block-reason')).toContainText('Refused 2 parcels')
  expect(state.blocks).toEqual([{ phone: PHONE, reason: 'Refused 2 parcels' }])

  if (isMobile) await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Blocked numbers' }).click()
  await expect(page.getByRole('heading', { name: 'Blocked numbers' })).toBeVisible()
  const table = page.getByRole('table', { name: 'Blocked numbers' })
  await expect(table.getByRole('link', { name: PHONE })).toBeVisible()
  await table.getByRole('button', { name: `Unblock ${PHONE}` }).click()
  await page.getByRole('alertdialog', { name: `Unblock ${PHONE}?` }).getByRole('button', { name: 'Unblock' }).click()
  await expect(page.getByText('No blocked numbers')).toBeVisible()
  expect(state.unblocks).toBe(1)
})

// ── Storefront ───────────────────────────────────────────────────────────────

const BLOCKED = '01811223344'

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
}

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

type Body = { address?: { district_id?: number }; payment_method?: string; contact?: Record<string, string> }

async function serveStore(page: Page) {
  const state = { placed: false, places: [] as Body[], previews: [] as Body[] }
  const preview = (body: Body) => {
    const served = body.address?.district_id !== undefined
    const blocked = body.contact?.phone === BLOCKED
    return {
      lines: [line], subtotal: '900.00', discount_total: '0.00', shipping_discount: '0.00', promotions: [], coupon_code: null, tax_total: '0.00',
      shipping_total: served ? '60.00' : '0.00', cod_fee: '0.00', total: served ? '960.00' : '900.00', currency: 'BDT', prices_include_tax: true,
      shipping_methods: served ? [home] : [], shipping_method_id: served ? 'sm-home' : null,
      payment_method: blocked && body.payment_method === 'cod' ? null : (body.payment_method ?? null), issues: [], cod_available: !blocked,
    }
  }
  const order = (body: Body) => ({
    number: 'WEB-000101', status: 'pending_confirmation', status_label: 'Awaiting confirmation', payment_status: 'unpaid', payment_method: 'cod', payment_method_label: 'Cash on delivery',
    payment_instructions: null, placed_at: '2026-11-24T10:00:00+06:00', expires_at: null, contact: { email: null, ...body.contact },
    shipping_address: { recipient_name: 'Karim Uddin', phone: '01911223344', division: 'Dhaka', district: 'Dhaka', area: 'Mirpur', address_line: 'Road 3, House 9', postcode: null },
    shipping_method_name: 'Home delivery', eta_min_days: 1, eta_max_days: 2,
    lines: [{ product_name: 'Kids Tee', variant_name: 'Red / M', sku: 'TEE-RM', image_url: null, quantity: '2.000', unit_price: '450.00', line_total: '900.00', product_url: '/product/kids-tee', discount_amount: '0.00' }],
    subtotal: '900.00', discount_total: '0.00', shipping_discount: '0.00', promotions: [], coupon_code: null, tax_total: '0.00', shipping_total: '60.00', cod_fee: '0.00',
    total: '960.00', currency: 'BDT', prices_include_tax: true, courier_name: null, tracking_number: null,
    history: [{ status: 'pending_confirmation', label: 'Awaiting confirmation', at: '2026-11-24T10:00:00+06:00' }],
  })

  await page.route(
    (url) => url.pathname.startsWith('/api/v1/store/'),
    async (route: Route) => {
      const request = route.request()
      const url = new URL(request.url())
      const key = `${request.method()} ${url.pathname.replace('/api/v1', '')}`
      const body = (request.postDataJSON() ?? {}) as Body
      if (key.startsWith('GET /store/orders/')) return route.fulfill({ json: envelope(order(state.places.at(-1) ?? {})) })
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
              payment_methods: [{ code: 'cod', display_name: 'Cash on delivery' }, { code: 'bank_transfer', display_name: 'Bank transfer' }],
              email_field: 'optional', phone_verification: 'off',
            }),
          })
        case 'GET /store/geo/divisions':
          return route.fulfill({ json: envelope([{ id: 3, name: 'Dhaka', name_bn: null }]) })
        case 'GET /store/geo/districts':
          return route.fulfill({ json: envelope([{ id: 47, division_id: 3, name: 'Dhaka', name_bn: null }]) })
        case 'POST /store/checkout/preview':
          state.previews.push(body)
          return route.fulfill({ json: envelope(preview(body)) })
        case 'POST /store/checkout':
          state.places.push(body)
          if (body.payment_method === 'cod' && body.contact?.phone === BLOCKED) {
            return route.fulfill({ status: 422, json: { success: false, error: { code: 'COD_NOT_AVAILABLE', message: 'Cash on delivery is not available for this order.', details: {} }, meta: { request_id: 'e2e' } } })
          }
          state.placed = true
          return route.fulfill({ status: 201, json: envelope({ order: order(body), access_token: 'guest-token' }) })
      }
      return route.fulfill({ status: 404, json: { success: false, error: { code: 'NOT_FOUND', message: `No mock for ${key}`, details: {} }, meta: { request_id: 'e2e' } } })
    },
  )
  return state
}

test('a blocked number cannot choose cash on delivery; a held order says the shop will call', async ({ page }) => {
  const state = await serveStore(page)
  await page.goto('/checkout')

  await page.getByLabel('Full name').fill('Karim Uddin')
  await page.getByLabel('Division').selectOption('3')
  await page.getByLabel('District').selectOption('47')
  await page.getByLabel('Area / thana').fill('Mirpur')
  await page.getByLabel('Street address').fill('Road 3, House 9')
  await expect(page.getByRole('radio', { name: /Home delivery/ })).toBeChecked()
  const cod = page.getByRole('radio', { name: /Cash on delivery/ })
  await cod.check()

  const phone = page.getByRole('textbox', { name: 'Mobile number', exact: true })
  await phone.fill('01811-223344')
  await expect(cod).toBeDisabled()
  await expect(cod).not.toBeChecked()
  await expect(page.getByTestId('cod-unavailable')).toHaveText('Cash on delivery is not available for this number.')
  expect(state.previews.at(-1)?.contact).toEqual({ phone: BLOCKED })

  // Another number may pay on delivery; the order waits for the shop's call.
  await phone.fill('01911-223344')
  await expect(cod).toBeEnabled()
  await cod.check()
  await page.getByRole('button', { name: 'Place order' }).click()
  await expect(page).toHaveURL(/\/order\/WEB-000101$/)
  await expect(page.getByTestId('order-status')).toHaveText('Awaiting confirmation')
  await expect(page.getByTestId('awaiting-confirmation')).toHaveText('We will call you to confirm your order.')
  expect(state.places).toHaveLength(1)
})
