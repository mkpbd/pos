import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * Mocked public/customer API (E8a contract): checkout and the order confirmation page.
 * A guest pays cash on delivery; a customer uses a saved address and pays by bank transfer;
 * a changed total is confirmed again. Runs on desktop and mobile (the summary collapses).
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
  menus: { main: { name: 'Main', items: [{ id: 'n-1', label: 'Shop', url: '/shop', open_in_new_tab: false, is_mega: false, mega_columns: null, image: null, children: [] }] } },
}

const money = (n: number) => n.toFixed(2)

const line = {
  id: 'l-1', variant_id: 'v-red-m', product: { slug: 'kids-tee', name: 'Kids Tee', url: '/product/kids-tee', image: { url: '/favicon.svg', alt: 'Kids Tee' } },
  variant_name: 'Red / M', option_values: { Colour: 'Red', Size: 'M' }, sku: 'TEE-RM', quantity: '2', unit_price: '450.00', compare_at_price: null,
  line_total: '900.00', purchasable: true, in_stock: true, max_quantity: null, exceeds_stock: false, allow_decimal: false,
  discount_amount: '0.00', promotion: null,
}

/** The demo coupon (E8b): ৳50 off orders of ৳500 or more. */
const COUPON = 'WELCOME50'
const COUPON_OFF = 50

function cartBody(empty: boolean, unit = 450, coupon: string | null = null) {
  const total = unit * 2
  const off = !empty && coupon ? COUPON_OFF : 0
  return {
    id: empty ? null : 'cart-1', items: empty ? [] : [{ ...line, unit_price: money(unit), line_total: money(total) }], item_count: empty ? '0' : '2',
    subtotal: money(empty ? 0 : total), discount_total: money(off), tax_total: '0.00', total: money(empty ? 0 : total - off), prices_include_tax: true, currency: 'BDT', issues: [],
    promotions: off ? [{ id: 'pr-welcome', name: 'Welcome 50', kind: 'order', amount: money(off) }] : [],
    free_shipping: null,
    coupon: !empty && coupon ? { code: coupon, applied: true, reason: null, message: null, promotion_name: 'Welcome 50' } : null,
  }
}

const methods: Record<string, Record<string, unknown>[]> = {
  '47': [{ id: 'sm-home', name: 'Home delivery', description: 'Inside Dhaka', fee: '60.00', free_over: '2000.00', cod_allowed: true, cod_fee: '0.00', eta_min_days: 1, eta_max_days: 2 }],
  '58': [{ id: 'sm-courier', name: 'Courier delivery', description: null, fee: '120.00', free_over: null, cod_allowed: true, cod_fee: '20.00', eta_min_days: 3, eta_max_days: 5 }],
}

const customer = { id: 'c-1', name: 'Rina Akter', email: 'rina@example.com', phone: '01712345678', email_verified: true }
const savedAddress = {
  id: 'a-1', label: 'Home', recipient_name: 'Rina Akter', phone: '01712345678', division: { id: 3, name: 'Dhaka' }, district: { id: 47, name: 'Dhaka' },
  area: 'Dhanmondi', address_line: 'House 12, Road 5', postcode: '1205', is_default_shipping: true, is_default_billing: true,
}

type Body = {
  shipping_address_id?: string
  address?: { district_id?: number | string; division_id?: number | string; recipient_name?: string }
  shipping_method_id?: string
  payment_method?: string
  expected_total?: string
  contact?: { name: string; email: string; phone: string }
}

type State = {
  me: typeof customer | null
  placed: boolean
  /** The unit price the server charges now (raise it to make the total change). */
  unit: number
  /** The coupon on the cart (E8b). */
  coupon: string | null
  places: { body: Body; key: string | undefined }[]
  orders: Map<string, Record<string, unknown>>
  orderReads: (string | null)[]
  lastPreview: Body | null
}

async function serveStore(page: Page, options: { me?: typeof customer | null } = {}) {
  const state: State = { me: options.me ?? null, placed: false, unit: 450, coupon: null, places: [], orders: new Map(), orderReads: [], lastPreview: null }

  const preview = (body: Body) => {
    const district = body.shipping_address_id ? '47' : body.address?.district_id !== undefined ? String(body.address.district_id) : null
    const offered = district ? (methods[district] ?? []) : []
    const method = offered.find((m) => m.id === body.shipping_method_id) ?? offered[0]
    const subtotal = state.unit * 2
    const fee = method ? Number(method.fee) : 0
    const cod = method && body.payment_method === 'cod' ? Number(method.cod_fee) : 0
    const off = state.coupon ? COUPON_OFF : 0
    return {
      lines: cartBody(false, state.unit).items, subtotal: money(subtotal), discount_total: money(off), shipping_discount: '0.00',
      promotions: off ? [{ name: 'Welcome 50', kind: 'order', amount: money(off) }] : [], coupon_code: state.coupon,
      tax_total: '0.00', shipping_total: money(fee), cod_fee: money(cod),
      total: money(subtotal - off + fee + cod), currency: 'BDT', prices_include_tax: true, shipping_methods: offered, shipping_method_id: method?.id ?? null,
      payment_method: body.payment_method ?? null, issues: [],
    }
  }

  const order = (body: Body, totals: ReturnType<typeof preview>) => {
    const bank = body.payment_method === 'bank_transfer'
    const contact = body.contact ?? { name: '', email: '', phone: '' }
    const address = body.shipping_address_id
      ? { recipient_name: 'Rina Akter', phone: '01712345678', division: 'Dhaka', district: 'Dhaka', area: 'Dhanmondi', address_line: 'House 12, Road 5', postcode: '1205' }
      : { recipient_name: body.address?.recipient_name ?? '', phone: contact.phone, division: 'Dhaka', district: 'Dhaka', area: 'Mirpur', address_line: 'Road 3, House 9', postcode: null }
    const method = (totals.shipping_methods as { name: string; eta_min_days: number; eta_max_days: number }[])[0]!
    return {
      number: `WEB-00000${state.orders.size + 1}`, status: bank ? 'pending_payment' : 'confirmed', status_label: bank ? 'Awaiting payment' : 'Confirmed',
      payment_status: 'unpaid', payment_method: body.payment_method, payment_method_label: bank ? 'Bank transfer' : 'Cash on delivery',
      payment_instructions: bank ? 'Demo Bank, account 0000000000 — demo only' : null, placed_at: '2026-10-31T10:00:00+06:00',
      expires_at: bank ? '2026-11-02T10:00:00+06:00' : null, contact, shipping_address: address, shipping_method_name: method.name,
      eta_min_days: method.eta_min_days, eta_max_days: method.eta_max_days,
      lines: [{ product_name: 'Kids Tee', variant_name: 'Red / M', sku: 'TEE-RM', image_url: '/favicon.svg', quantity: '2.000', unit_price: money(state.unit), line_total: totals.subtotal, product_url: '/product/kids-tee', discount_amount: totals.discount_total }],
      subtotal: totals.subtotal, discount_total: totals.discount_total, shipping_discount: totals.shipping_discount, promotions: totals.promotions, coupon_code: totals.coupon_code,
      tax_total: '0.00', shipping_total: totals.shipping_total, cod_fee: totals.cod_fee, total: totals.total, currency: 'BDT',
      prices_include_tax: true, courier_name: null, tracking_number: null,
      history: [{ status: bank ? 'pending_payment' : 'confirmed', label: bank ? 'Awaiting payment' : 'Confirmed', at: '2026-10-31T10:00:00+06:00' }],
    }
  }

  await page.route(
    (url) => url.pathname.startsWith('/api/v1/store/'),
    async (route: Route) => {
      const request = route.request()
      const url = new URL(request.url())
      const path = url.pathname.replace('/api/v1', '')
      const key = `${request.method()} ${path}`
      const body = (request.postDataJSON() ?? {}) as Body

      if (key.startsWith('GET /store/orders/')) {
        const number = decodeURIComponent(path.split('/').pop() ?? '')
        const token = url.searchParams.get('token')
        state.orderReads.push(token)
        const found = state.orders.get(number)
        if (!found || (!state.me && token !== 'guest-token-123')) return route.fulfill(failure(404, 'NOT_FOUND', 'Order not found.'))
        return route.fulfill({ json: envelope(found) })
      }

      switch (key) {
        case 'GET /store/bootstrap':
          return route.fulfill({ json: envelope(bootstrap) })
        case 'GET /store/account/me':
          return route.fulfill({ json: envelope(state.me) })
        case 'GET /store/cart':
          return route.fulfill({ json: envelope(cartBody(state.placed, state.unit, state.coupon)) })
        case 'POST /store/cart/coupon': {
          const code = String((body as { code?: string }).code ?? '')
          if (code !== COUPON) return route.fulfill(failure(422, 'COUPON_INVALID', 'This coupon code is not valid.', { reason: 'not_found' }))
          state.coupon = code
          return route.fulfill({ json: envelope(cartBody(state.placed, state.unit, state.coupon)) })
        }
        case 'DELETE /store/cart/coupon':
          state.coupon = null
          return route.fulfill({ json: envelope(cartBody(state.placed, state.unit, state.coupon)) })
        case 'GET /store/wishlist':
          return route.fulfill({ json: envelope({ items: [] }) })
        case 'GET /store/account/addresses':
          return route.fulfill({ json: envelope([savedAddress]) })
        case 'GET /store/checkout/options':
          return route.fulfill({
            json: envelope({
              available: !state.placed, reason: state.placed ? 'cart_empty' : null, guest_checkout: true, signed_in: state.me !== null,
              payment_methods: [{ code: 'cod', display_name: 'Cash on delivery', instructions_preview: null }, { code: 'bank_transfer', display_name: 'Bank transfer', instructions_preview: null }],
            }),
          })
        case 'GET /store/geo/divisions':
          return route.fulfill({ json: envelope([{ id: 3, name: 'Dhaka', name_bn: 'ঢাকা' }, { id: 7, name: 'Sylhet', name_bn: 'সিলেট' }]) })
        case 'GET /store/geo/districts':
          return route.fulfill({
            json: envelope(url.searchParams.get('division') === '3' ? [{ id: 47, division_id: 3, name: 'Dhaka', name_bn: 'ঢাকা' }] : [{ id: 58, division_id: 7, name: 'Moulvibazar', name_bn: 'মৌলভীবাজার' }]),
          })
        case 'POST /store/checkout/preview':
          state.lastPreview = body
          return route.fulfill({ json: envelope(preview(body)) })
        case 'POST /store/checkout': {
          state.places.push({ body, key: request.headers()['idempotency-key'] })
          const totals = preview(body)
          if (body.expected_total !== totals.total) return route.fulfill(failure(409, 'TOTAL_CHANGED', 'The total changed.', { preview: totals }))
          const placed = order(body, totals)
          state.orders.set(placed.number, placed)
          state.placed = true
          state.coupon = null
          return route.fulfill({ status: 201, json: envelope({ order: placed, access_token: state.me ? null : 'guest-token-123' }) })
        }
      }
      return route.fulfill(failure(404, 'NOT_FOUND', `No mock for ${key}`))
    },
  )
  return state
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: 'XSRF-TOKEN', value: 'e2e-token', url: baseURL ?? 'http://localhost:5173' }])
})

/** The summary is collapsed on phones; open it to read the totals. */
/** Waits until the summary was recomputed for the chosen payment method and "Place order" is ready. */
async function settled(page: Page, state: State, payment: string) {
  await expect.poll(() => state.lastPreview?.payment_method).toBe(payment)
  await expect(page.getByRole('button', { name: 'Place order' })).toBeEnabled()
}

async function summaryTotal(page: Page, isMobile: boolean) {
  const summary = page.getByTestId('order-summary')
  if (isMobile) {
    const toggle = summary.getByRole('button', { name: /^Show/ })
    if (await toggle.isVisible()) await toggle.click()
  }
  return summary.getByTestId('summary-total')
}

test('a guest pays cash on delivery and lands on the confirmation page', async ({ page, isMobile }) => {
  const state = await serveStore(page)
  await page.goto('/cart')
  await page.getByTestId('cart-page').getByRole('link', { name: 'Checkout' }).click()
  await expect(page).toHaveURL(/\/checkout$/)
  await expect(page).toHaveTitle('Checkout | Berry Kids')

  await page.getByLabel('Full name').fill('Karim Uddin')
  await page.getByLabel('E-mail').fill('karim@example.com')
  await page.getByLabel('Mobile number', { exact: true }).fill('01811-223344')
  await page.getByLabel('Division').selectOption({ label: 'Dhaka (ঢাকা)' })
  await page.getByLabel('District').selectOption({ label: 'Dhaka (ঢাকা)' })
  await page.getByLabel('Area / thana').fill('Mirpur')
  await page.getByLabel('Street address').fill('Road 3, House 9')
  await expect(page.getByRole('radio', { name: /Home delivery/ })).toBeChecked()
  await page.getByRole('radio', { name: /Cash on delivery/ }).check()
  await settled(page, state, 'cod')
  await expect(await summaryTotal(page, isMobile)).toHaveText('৳960.00')
  // Nothing is wider than the screen (phones at ~400px included).
  const overflow = await page.locator('html').evaluate((html) => html.scrollWidth - html.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)

  await page.getByRole('button', { name: 'Place order' }).click()
  await expect(page).toHaveURL(/\/order\/WEB-000001$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Thank you, Karim!' })).toBeVisible()
  await expect(page).toHaveTitle('Thank you for your order | Berry Kids')
  await expect(page.getByTestId('order-status')).toHaveText('Confirmed')
  await expect(page.getByTestId('summary-total')).toHaveText('৳960.00')
  await expect(page.getByRole('button', { name: 'Cart', exact: true })).toBeVisible()
  expect(state.places).toHaveLength(1)
  expect(state.places[0]!.key).toMatch(/^[0-9a-f-]{36}$/)
  expect(state.places[0]!.body).toMatchObject({ payment_method: 'cod', shipping_method_id: 'sm-home', expected_total: '960.00', address: { district_id: 47, recipient_name: 'Karim Uddin' } })

  // A reload shows the status page through the token kept for this tab.
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Order WEB-000001' })).toBeVisible()
  // (Dev StrictMode may read twice; every read carries the token.)
  expect(state.orderReads.length).toBeGreaterThan(0)
  expect(state.orderReads.every((token) => token === 'guest-token-123')).toBe(true)

  // The e-mail link: the token is moved out of the address bar.
  await page.goto('/order/WEB-000001?token=guest-token-123')
  await expect(page.getByRole('heading', { level: 1, name: 'Order WEB-000001' })).toBeVisible()
  await expect(page).toHaveURL(/\/order\/WEB-000001$/)
})

test('a customer uses a saved address, pays by bank transfer and gets the instructions', async ({ page, isMobile }) => {
  const state = await serveStore(page, { me: customer })
  await page.goto('/checkout')

  await expect(page.getByLabel('Full name')).toHaveValue('Rina Akter')
  const book = page.getByRole('group', { name: 'Delivery address' })
  await expect(book.getByRole('radio', { name: /^Home/ })).toBeChecked()
  await expect(page.getByRole('radio', { name: /Home delivery/ })).toBeChecked()
  await page.getByRole('radio', { name: /Bank transfer/ }).check()
  await settled(page, state, 'bank_transfer')
  await expect(await summaryTotal(page, isMobile)).toHaveText('৳960.00')
  await page.getByRole('button', { name: 'Place order' }).click()

  await expect(page.getByRole('heading', { level: 1, name: 'Thank you, Rina!' })).toBeVisible()
  const instructions = page.getByTestId('payment-instructions')
  await expect(instructions.getByRole('heading', { name: 'Complete your payment' })).toBeVisible()
  await expect(instructions).toContainText('Demo Bank, account 0000000000 — demo only')
  await expect(instructions).toContainText('Please transfer ৳960.00')
  await expect(page.getByTestId('payment-deadline')).toContainText('2026')
  await expect(page.getByTestId('order-status')).toHaveText('Awaiting payment')
  expect(state.places[0]!.body).toMatchObject({ shipping_address_id: 'a-1', payment_method: 'bank_transfer' })
  expect(state.places[0]!.body).not.toHaveProperty('address')
})

test('a changed total is shown and confirmed again', async ({ page, isMobile }) => {
  const state = await serveStore(page, { me: customer })
  await page.goto('/checkout')
  await expect(page.getByRole('radio', { name: /Home delivery/ })).toBeChecked()
  await page.getByRole('radio', { name: /Cash on delivery/ }).check()
  await settled(page, state, 'cod')
  await expect(await summaryTotal(page, isMobile)).toHaveText('৳960.00')

  // The price goes up while the shopper is on the page.
  state.unit = 500
  await page.getByRole('button', { name: 'Place order' }).click()
  const alert = page.getByTestId('checkout-problem')
  await expect(alert).toContainText('changed from ৳960.00 to ৳1,060.00')
  await expect(alert).toBeFocused()
  await expect(await summaryTotal(page, isMobile)).toHaveText('৳1,060.00')

  await page.getByRole('button', { name: 'Confirm new total and place order' }).click()
  await expect(page).toHaveURL(/\/order\/WEB-000001$/)
  await expect(page.getByTestId('summary-total')).toHaveText('৳1,060.00')
  expect(state.places.map((p) => p.body.expected_total)).toEqual(['960.00', '1060.00'])
  expect(state.places[1]!.key).not.toBe(state.places[0]!.key)
})

test('a coupon applied in the cart lowers the checkout total and shows on the order', async ({ page, isMobile }) => {
  const state = await serveStore(page, { me: customer })
  await page.goto('/cart')
  const cart = page.getByTestId('cart-page')
  const field = cart.getByRole('textbox', { name: 'Coupon code' })

  await field.fill('nope')
  await cart.getByRole('button', { name: 'Apply' }).click()
  await expect(cart.getByRole('alert')).toHaveText('This coupon code is not valid.')
  await expect(field).toBeFocused()

  await field.fill('welcome50')
  await field.press('Enter')
  const coupon = cart.getByRole('group', { name: 'Coupon WELCOME50' })
  await expect(coupon).toBeFocused()
  await expect(coupon.getByTestId('coupon-applied')).toHaveText('Coupon applied')
  await expect(cart.getByTestId('cart-discount')).toHaveText('−৳50.00')
  await expect(cart.getByTestId('cart-promotion')).toHaveText('Welcome 50−৳50.00')
  await expect(cart.getByTestId('cart-total')).toHaveText('৳850.00')

  await page.goto('/checkout')
  await expect(page.getByRole('radio', { name: /Home delivery/ })).toBeChecked()
  await page.getByRole('radio', { name: /Cash on delivery/ }).check()
  await settled(page, state, 'cod')
  await expect(await summaryTotal(page, isMobile)).toHaveText('৳910.00')
  const summary = page.getByTestId('order-summary')
  await expect(summary.getByTestId('summary-discount')).toHaveText('−৳50.00')
  await expect(summary.getByTestId('summary-coupon')).toHaveText('WELCOME50')

  await page.getByRole('button', { name: 'Place order' }).click()
  await expect(page).toHaveURL(/\/order\/WEB-000001$/)
  await expect(page.getByTestId('summary-discount')).toHaveText('−৳50.00')
  await expect(page.getByTestId('summary-coupon')).toHaveText('WELCOME50')
  await expect(page.getByTestId('summary-total')).toHaveText('৳910.00')
  expect(state.places[0]!.body.expected_total).toBe('910.00')
})
