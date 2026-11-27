import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * BD2a, against a mocked API: a manager prices a delivery method by weight and adds the delivery
 * areas of a district; a shopper with a heavy cart chooses an area at checkout and sees what the
 * delivery fee includes; staff take an order for an area.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const page1 = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })
const notFound = (key: string) => ({ status: 404, json: { success: false, error: { code: 'NOT_FOUND', message: `No mock for ${key}`, details: {} }, meta: { request_id: 'e2e' } } })

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: 'XSRF-TOKEN', value: 'e2e-token', url: baseURL ?? 'http://localhost:5173' }])
})

// ── Admin ────────────────────────────────────────────────────────────────────

const me = {
  user: { id: 'u-1', name: 'Rahim Uddin', email: 'rahim@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-1', name: 'Online Store Manager', system_key: 'online_store_manager' }],
  permissions: ['branches.view', 'products.view', 'customers.view', 'storefront.view', 'shipping.manage', 'web_orders.view', 'web_orders.manage', 'web_orders.create', 'web_orders.edit'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
}

type Area = { id: string; district_id: number; name: string; fee_adjustment: string; is_active: boolean; sort_order: number }
type Method = Record<string, unknown> & { id: string }
type QuoteBody = { lines: { variant_id: string; quantity: string }[]; address?: { district_id?: number; area_id?: string }; shipping_method_id?: string; payment_method?: string }

const homeMethod: Method = {
  id: 'sm-home', zone_id: 'z-1', name: 'Home delivery', description: null, fee: '60.00', free_over: null, cod_allowed: true, cod_fee: '0.00',
  eta_min_days: 1, eta_max_days: 2, is_active: true, sort_order: 0, weight_included_kg: null, fee_per_extra_kg: '0.00',
}

/** Two rompers (1.5 kg each): Mirpur adds 20, the 3 kg parcel 40 (2 kg over the 1 kg included, 20 each). */
function quoteFor(body: QuoteBody, areas: Area[]) {
  const lines = body.lines.map((l) => ({
    variant_id: l.variant_id, product_name: 'Baby Romper', variant_name: 'Size M', sku: 'ROMP-M', image_url: null,
    quantity: l.quantity, unit_price: '750.00', line_total: (750 * Number(l.quantity)).toFixed(2), available: '10',
  }))
  const subtotal = lines.reduce((sum, l) => sum + Number(l.line_total), 0)
  const district = !!body.address?.district_id
  const area = areas.find((a) => a.id === body.address?.area_id)
  const adjustment = area ? Number(area.fee_adjustment) : 0
  const weight = 40
  const fee = 60 + adjustment + weight
  const method = { id: 'sm-home', name: 'Home delivery', description: null, fee: fee.toFixed(2), free_over: null, cod_allowed: true, cod_fee: '0.00', eta_min_days: 1, eta_max_days: 2, base_fee: '60.00', area_adjustment: adjustment.toFixed(2), weight_fee: weight.toFixed(2) }
  return {
    lines, subtotal: subtotal.toFixed(2), discount_total: '0.00', tax_total: '0.00', shipping_total: district ? fee.toFixed(2) : '0.00', shipping_discount: '0.00', cod_fee: '0.00',
    total: (subtotal + (district ? fee : 0)).toFixed(2), currency: 'BDT', prices_include_tax: false,
    shipping_methods: district ? [method] : [], shipping_method_id: district ? (body.shipping_method_id ?? null) : null, payment_method: body.payment_method ?? null,
    promotions: [], coupon_code: null, coupon: null, issues: [],
    payment_methods: [{ code: 'cod', name: 'Cash on delivery' }],
  }
}

const staffOrder = {
  id: 'wo-9', number: 'WEB-000009', status: 'confirmed', status_label: 'Confirmed', payment_status: 'unpaid', payment_method: 'cod', payment_method_label: 'Cash on delivery',
  payment_instructions: null, placed_at: '2026-12-16T04:30:00Z', expires_at: null,
  source: 'staff', channel: 'phone', created_by: { id: 'u-1', name: 'Rahim Uddin' }, revision: 1, edits: [], customer_id: null, shipping_method_id: 'sm-home',
  contact: { name: 'Ayesha Rahman', email: null, phone: '01711000000' },
  shipping_address: { recipient_name: 'Ayesha Rahman', phone: '01711000000', division: 'Dhaka', district: 'Dhaka', division_id: 3, district_id: 26, area: 'Mirpur', area_id: 'ar-1', address_line: 'House 12, Road 5', postcode: null },
  shipping_method_name: 'Home delivery', eta_min_days: 1, eta_max_days: 2,
  lines: [{ id: 'ol-1', variant_id: 'v-m', product_name: 'Baby Romper', variant_name: 'Size M', sku: 'ROMP-M', image_url: null, quantity: '2', unit_price: '750.00', line_total: '1500.00', discount_amount: '0.00' }],
  subtotal: '1500.00', discount_total: '0.00', shipping_discount: '0.00', promotions: [], coupon_code: null,
  tax_total: '0.00', shipping_total: '120.00', cod_fee: '0.00', total: '1620.00', currency: 'BDT', prices_include_tax: false,
  courier_name: null, tracking_number: null,
  history: [{ status: 'confirmed', label: 'Confirmed', at: '2026-12-16T04:30:00Z', actor: { id: 'u-1', name: 'Rahim Uddin' }, actor_type: 'staff', note: 'Order entered by staff (Phone)' }],
  customer: null, ip: null, user_agent: null, notes: null, cancel_reason: null, payments: [], allowed_actions: ['process', 'cancel', 'edit'],
}

async function serveAdmin(page: Page) {
  const state = {
    method: { ...homeMethod },
    areas: [] as Area[],
    methodPatches: [] as Record<string, unknown>[],
    areaPosts: [] as Record<string, unknown>[],
    quotes: [] as QuoteBody[],
    orders: [] as Record<string, unknown>[],
  }
  const zone = () => ({ id: 'z-1', name: 'Inside Dhaka', is_active: true, sort_order: 0, districts: [{ id: 26, name: 'Dhaka' }], methods: [state.method] })
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/') || url.pathname === '/sanctum/csrf-cookie',
    async (route: Route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.pathname === '/sanctum/csrf-cookie') return route.fulfill({ status: 204 })
      const key = `${request.method()} ${url.pathname.replace('/api/v1', '')}`
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>
      switch (key) {
        case 'GET /auth/me':
          return route.fulfill({ json: envelope(me) })
        case 'GET /notifications/unread-count':
          return route.fulfill({ json: envelope({ count: 0 }) })
        case 'GET /storefront/settings':
          return route.fulfill({ json: envelope({ is_enabled: true, site_name: 'Berry Kids', meta_description: null, fulfilment_store_id: null, guest_checkout_enabled: true, updated_at: null }) })
        case 'GET /geography/divisions':
          return route.fulfill({ json: envelope([{ id: 3, name: 'Dhaka' }]) })
        case 'GET /geography/districts':
          return route.fulfill({ json: envelope([{ id: 26, division_id: 3, name: 'Dhaka' }, { id: 47, division_id: 3, name: 'Gazipur' }]) })
        case 'GET /shipping/zones':
          return route.fulfill({ json: envelope([zone()]) })
        case 'PATCH /shipping/methods/sm-home':
          state.methodPatches.push(body)
          state.method = { ...state.method, ...body }
          return route.fulfill({ json: envelope(state.method) })
        case 'GET /shipping/areas': {
          const district = Number(url.searchParams.get('district_id'))
          return route.fulfill({ json: envelope(state.areas.filter((a) => a.district_id === district)) })
        }
        case 'POST /shipping/areas': {
          state.areaPosts.push(body)
          const area = { ...(body as Omit<Area, 'id'>), id: `ar-${state.areas.length + 1}` }
          state.areas.push(area)
          return route.fulfill({ status: 201, json: envelope(area) })
        }
        case 'GET /products':
          return route.fulfill({
            json: page1([{
              id: 'p-1', name: 'Baby Romper', type: 'standard', track_stock: true, track_batches: false, unit: { code: 'pcs', allow_decimal: false }, tax_rate: null,
              variants: [{ id: 'v-m', name: 'Size M', sku: 'ROMP-M', option_values: { Size: 'M' }, is_active: true, weight_grams: 1500 }],
            }]),
          })
        case 'GET /web-orders/phone-report':
          return route.fulfill({ json: envelope({ phone: '01711000000', orders: 0, delivered: 0, returned: 0, cancelled: 0, in_progress: 0, success_rate: null, last_order_at: null, blocked: false, block_reason: null }) })
        case 'POST /web-orders/quote':
          state.quotes.push(body as QuoteBody)
          return route.fulfill({ json: envelope(quoteFor(body as QuoteBody, state.areas)) })
        case 'POST /web-orders':
          state.orders.push(body)
          return route.fulfill({ status: 201, json: envelope(staffOrder) })
        case 'GET /web-orders/wo-9':
          return route.fulfill({ json: envelope(staffOrder) })
      }
      if (request.method() === 'GET') return route.fulfill({ json: page1([]) })
      return route.fulfill(notFound(key))
    },
  )
  return state
}

test('a manager prices a method by weight and adds the areas of a district', async ({ page, isMobile }) => {
  const state = await serveAdmin(page)
  await page.goto('/admin/web-orders')
  if (isMobile) await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Online store' }).click()
  await page.getByRole('link', { name: 'Shipping', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/storefront\/shipping$/)

  await page.getByRole('button', { name: 'Edit Home delivery' }).click()
  const method = page.getByRole('dialog', { name: 'Edit Home delivery' })
  await method.getByRole('switch', { name: 'Weight pricing' }).click()
  await method.getByLabel('Kg included').fill('1')
  await method.getByLabel('Per extra kg (BDT)').fill('20')
  await method.getByRole('button', { name: 'Save method' }).click()
  await expect(method).toBeHidden()
  expect(state.methodPatches.at(-1)).toMatchObject({ weight_included_kg: '1', fee_per_extra_kg: '20' })
  await expect(page.getByText('+ BDT 20.00 per kg over 1 kg')).toBeVisible()

  await page.getByRole('button', { name: 'Areas of Inside Dhaka' }).click()
  const areas = page.getByRole('dialog', { name: 'Areas in Inside Dhaka' })
  await expect(areas.getByText('No areas in Dhaka yet')).toBeVisible()
  await areas.getByLabel('Area name').fill('Mirpur')
  await areas.getByLabel('Fee change (BDT)').fill('20')
  await areas.getByRole('button', { name: 'Add area' }).click()
  await expect(areas.getByRole('table', { name: 'Areas in Dhaka' })).toContainText('Mirpur+ BDT 20.00Active')
  await areas.getByLabel('Area name').fill('Uttara')
  await areas.getByLabel('Fee change (BDT)').fill('-10')
  await areas.getByRole('button', { name: 'Add area' }).click()
  await expect(areas.getByRole('table', { name: 'Areas in Dhaka' })).toContainText('Uttara− BDT 10.00')
  expect(state.areaPosts).toEqual([
    { district_id: 26, name: 'Mirpur', fee_adjustment: '20', is_active: true, sort_order: 0 },
    { district_id: 26, name: 'Uttara', fee_adjustment: '-10', is_active: true, sort_order: 1 },
  ])
})

test('staff take an order for an area of the district', async ({ page }) => {
  const state = await serveAdmin(page)
  state.areas.push({ id: 'ar-1', district_id: 26, name: 'Mirpur', fee_adjustment: '20.00', is_active: true, sort_order: 0 })
  await page.goto('/admin/web-orders/new')
  await expect(page.getByRole('heading', { name: 'New order' })).toBeVisible()

  await page.getByLabel('Name', { exact: true }).fill('Ayesha Rahman')
  await page.getByLabel('Mobile number').fill('01711000000')
  await page.getByRole('combobox', { name: 'Add a product' }).click()
  await page.getByRole('option', { name: /Baby Romper — Size M/ }).click()
  await page.getByLabel('Quantity of Baby Romper — Size M').fill('2')
  for (const [box, option] of [['Division', 'Dhaka'], ['District', 'Dhaka'], ['Area / thana', 'Mirpur']]) {
    await page.getByRole('combobox', { name: box! }).click()
    await page.getByRole('option', { name: option!, exact: true }).click()
  }
  await page.getByLabel('Address', { exact: true }).fill('House 12, Road 5')
  await page.getByRole('radio', { name: /Home delivery/ }).check()
  await page.getByRole('radio', { name: 'Cash on delivery' }).check()
  await expect(page.getByTestId('delivery-fee-note')).toHaveText('incl. 20.00 for the area · 40.00 for weight')
  await expect(page.getByTestId('quote-total')).toHaveText('BDT 1,620.00')
  expect(state.quotes.at(-1)).toMatchObject({ address: { district_id: 26, area_id: 'ar-1' } })

  await page.getByRole('button', { name: 'Place order' }).click()
  await expect(page.getByRole('heading', { name: 'WEB-000009' })).toBeVisible()
  expect(state.orders[0]).toMatchObject({
    address: { recipient_name: 'Ayesha Rahman', division_id: 3, district_id: 26, area_id: 'ar-1', address_line: 'House 12, Road 5' },
    shipping_method_id: 'sm-home', expected_total: '1620.00',
  })
  expect(state.orders[0]!.address).not.toHaveProperty('area')
})

// ── Storefront ───────────────────────────────────────────────────────────────

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

/** Four 1.5 kg rice bags: 6 kg, 5 kg over the 1 kg included at 20 each. */
const line = {
  id: 'l-1', variant_id: 'v-rice', product: { slug: 'rice', name: 'Miniket Rice 1.5 kg', url: '/product/rice', image: null },
  variant_name: null, option_values: {}, sku: 'RICE', quantity: '4', unit_price: '150.00', compare_at_price: null,
  line_total: '600.00', purchasable: true, in_stock: true, max_quantity: null, exceeds_stock: false, allow_decimal: false, discount_amount: '0.00', promotion: null,
}
const cart = (empty: boolean) => ({
  id: empty ? null : 'cart-1', items: empty ? [] : [line], item_count: empty ? '0' : '4', subtotal: empty ? '0.00' : '600.00', discount_total: '0.00', tax_total: '0.00',
  total: empty ? '0.00' : '600.00', prices_include_tax: true, currency: 'BDT', issues: [], promotions: [], free_shipping: null, coupon: null,
})

type StoreBody = { address?: { district_id?: number; area_id?: string }; payment_method?: string; shipping_method_id?: string; contact?: Record<string, string> }

async function serveStore(page: Page) {
  const state = { placed: false, previews: [] as StoreBody[], places: [] as StoreBody[] }
  const fees: Record<string, number> = { 'ar-1': 20, 'ar-2': -10 }
  const preview = (body: StoreBody) => {
    const served = body.address?.district_id !== undefined
    const area = fees[body.address?.area_id ?? ''] ?? 0
    const fee = 60 + area + 100
    const method = { id: 'sm-home', name: 'Home delivery', description: 'Inside Dhaka', fee: fee.toFixed(2), free_over: null, cod_allowed: true, cod_fee: '0.00', eta_min_days: 1, eta_max_days: 2, base_fee: '60.00', area_adjustment: area.toFixed(2), weight_fee: '100.00' }
    return {
      lines: [line], subtotal: '600.00', discount_total: '0.00', shipping_discount: '0.00', promotions: [], coupon_code: null, tax_total: '0.00',
      shipping_total: served ? fee.toFixed(2) : '0.00', cod_fee: '0.00', total: (600 + (served ? fee : 0)).toFixed(2), currency: 'BDT', prices_include_tax: true,
      shipping_methods: served ? [method] : [], shipping_method_id: served ? 'sm-home' : null, payment_method: body.payment_method ?? null, issues: [],
    }
  }
  const order = {
    number: 'WEB-000201', status: 'confirmed', status_label: 'Confirmed', payment_status: 'unpaid', payment_method: 'cod', payment_method_label: 'Cash on delivery',
    payment_instructions: null, placed_at: '2026-12-16T10:00:00+06:00', expires_at: null, contact: { name: 'Karim Uddin', email: null, phone: '01811223344' },
    shipping_address: { recipient_name: 'Karim Uddin', phone: '01811223344', division: 'Dhaka', district: 'Dhaka', area: 'Mirpur', address_line: 'Road 3, House 9', postcode: null },
    shipping_method_name: 'Home delivery', eta_min_days: 1, eta_max_days: 2,
    lines: [{ product_name: 'Miniket Rice 1.5 kg', variant_name: null, sku: 'RICE', image_url: null, quantity: '4.000', unit_price: '150.00', line_total: '600.00', product_url: '/product/rice', discount_amount: '0.00' }],
    subtotal: '600.00', discount_total: '0.00', shipping_discount: '0.00', promotions: [], coupon_code: null, tax_total: '0.00', shipping_total: '180.00', cod_fee: '0.00',
    total: '780.00', currency: 'BDT', prices_include_tax: true, courier_name: null, tracking_number: null,
    history: [{ status: 'confirmed', label: 'Confirmed', at: '2026-12-16T10:00:00+06:00' }],
  }

  await page.route(
    (url) => url.pathname.startsWith('/api/v1/store/'),
    async (route: Route) => {
      const request = route.request()
      const url = new URL(request.url())
      const key = `${request.method()} ${url.pathname.replace('/api/v1', '')}`
      const body = (request.postDataJSON() ?? {}) as StoreBody
      if (key.startsWith('GET /store/orders/')) return route.fulfill({ json: envelope(order) })
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
              payment_methods: [{ code: 'cod', display_name: 'Cash on delivery' }], email_field: 'optional', phone_verification: 'off',
            }),
          })
        case 'GET /store/geo/divisions':
          return route.fulfill({ json: envelope([{ id: 3, name: 'Dhaka', name_bn: null }]) })
        case 'GET /store/geo/districts':
          return route.fulfill({ json: envelope([{ id: 26, division_id: 3, name: 'Dhaka', name_bn: null }, { id: 47, division_id: 3, name: 'Gazipur', name_bn: null }]) })
        case 'GET /store/shipping/areas':
          return route.fulfill({ json: envelope(url.searchParams.get('district_id') === '26' ? [{ id: 'ar-1', name: 'Mirpur' }, { id: 'ar-2', name: 'Uttara' }] : []) })
        case 'POST /store/checkout/preview':
          state.previews.push(body)
          return route.fulfill({ json: envelope(preview(body)) })
        case 'POST /store/checkout':
          state.places.push(body)
          state.placed = true
          return route.fulfill({ status: 201, json: envelope({ order, access_token: 'guest-token' }) })
      }
      return route.fulfill(notFound(key))
    },
  )
  return state
}

test('a shopper with a heavy cart chooses the area and sees what the delivery fee includes', async ({ page }) => {
  const state = await serveStore(page)
  await page.goto('/checkout')
  await page.getByLabel('Full name').fill('Karim Uddin')
  await page.getByRole('textbox', { name: 'Mobile number', exact: true }).fill('01811-223344')
  await page.getByLabel('Division').selectOption('3')

  // Gazipur has no areas: the area is typed as before.
  await page.getByLabel('District').selectOption('47')
  await expect(page.getByRole('textbox', { name: 'Area / thana' })).toBeVisible()

  await page.getByLabel('District').selectOption('26')
  const area = page.getByRole('combobox', { name: 'Area / thana' })
  await expect(area).toBeVisible()
  await page.getByLabel('Street address').fill('Road 3, House 9')
  await page.getByRole('radio', { name: /Cash on delivery/ }).check()
  await page.getByRole('button', { name: 'Place order' }).click()
  await expect(page.getByText('Please choose your area or thana.')).toBeVisible()
  expect(state.places).toHaveLength(0)

  await area.selectOption({ label: 'Mirpur' })
  await expect(page.getByTestId('shipping-fee-note')).toHaveText('incl. ৳20.00 for your area · ৳100.00 for the parcel weight')
  await expect(page.getByRole('group', { name: 'Delivery method' })).toContainText('৳180.00')
  await expect(page.getByTestId('summary-total')).toHaveText('৳780.00')
  await area.selectOption({ label: 'Uttara' })
  await expect(page.getByTestId('shipping-fee-note')).toHaveText('incl. ৳10.00 less for your area · ৳100.00 for the parcel weight')
  await area.selectOption({ label: 'Mirpur' })
  await expect(page.getByTestId('summary-total')).toHaveText('৳780.00')

  await page.getByRole('button', { name: 'Place order' }).click()
  await expect(page).toHaveURL(/\/order\/WEB-000201$/)
  expect(state.places).toHaveLength(1)
  expect(state.places[0]!.address).toEqual({ recipient_name: 'Karim Uddin', phone: '01811223344', division_id: 3, district_id: 26, area_id: 'ar-1', address_line: 'Road 3, House 9' })
  expect(state.places[0]).toMatchObject({ shipping_method_id: 'sm-home', payment_method: 'cod', expected_total: '780.00' })
})
