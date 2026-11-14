import { expect, test, type Page } from '@playwright/test'

/*
 * P2a on a mocked store (375 px and 1366 px): a campaign landing page with the one-product order
 * form. A shopper arrives from a Facebook ad (UTM + short link), the visit is counted once, the
 * sticky "Order now" takes them to the form, they choose an option and quantity, add the add-on,
 * type a Bangla mobile number, pick the district, see the server's summary and confirm; the order
 * carries the campaign and an Idempotency-Key and the cart is never touched. On a desktop the form
 * sits beside the product and summary; a host whose entry page is the landing page opens on it.
 */

const envelope = (data: unknown) => ({ success: true, data, meta: { request_id: 'e2e' } })
const failure = (status: number, code: string, message: string, details: Record<string, unknown> = {}) => ({
  status,
  json: { success: false, error: { code, message, details }, meta: { request_id: 'e2e' } },
})

const VISIBLE = { desktop: true, tablet: true, mobile: true }
const DOC_ID = '0199a5c1-0000-7000-8000-00000000d2a0'
const PRODUCT_ID = '0199a5c1-0000-7000-8000-00000000a001'
const UPSELL_ID = '0199a5c1-0000-7000-8000-00000000a002'

type Node = { id: string; type: string; props: Record<string, unknown> }
const el = (id: string, type: string, props: Record<string, unknown>): Node => ({ id, type, props })

function section(id: string, elements: Node[], padding = '24px') {
  return {
    id,
    type: 'section',
    props: { layout: 'boxed', anchor: null },
    style: { base: { spacing: { padding: { top: padding, bottom: padding } } } },
    visibility: VISIBLE,
    columns: [{ id: `c_${id}`, type: 'column', width: { base: 100 }, style: {}, elements: elements.map((e) => ({ ...e, style: {}, visibility: VISIBLE })) }],
  }
}

const variant = (id: string, colour: string, size: string, price: string, extra: Record<string, unknown> = {}) => ({
  id, sku: id.toUpperCase(), name: `${colour} / ${size}`, option_values: { Colour: colour, Size: size }, price, compare_at_price: null, on_sale: false,
  discount_percent: null, in_stock: true, low_stock: false, image_id: null, promo_price: null, stock_left: null, ...extra,
})

const product = {
  id: PRODUCT_ID, slug: 'kids-tee', name: 'Kids Tee', url: '/product/kids-tee', short_description: 'Soft cotton tee.', description_html: null, specifications: [],
  brand: null, category: null, breadcrumbs: [], images: [{ id: 'img-1', url: '/favicon.svg', alt: 'Kids Tee' }],
  options: [
    { name: 'Colour', slug: 'colour', display: 'swatch', values: [{ value: 'Red', swatch_hex: '#dc2626' }, { value: 'Blue', swatch_hex: '#2563eb' }] },
    { name: 'Size', slug: 'size', display: 'button', values: [{ value: 'M', swatch_hex: null }, { value: 'L', swatch_hex: null }] },
  ],
  variants: [variant('v-red-m', 'Red', 'M', '450.00'), variant('v-blue-l', 'Blue', 'L', '480.00')],
  price: '450.00', price_max: '480.00', on_sale: false, in_stock: true, is_new: false, default_variant_id: 'v-red-m', promotion: null, unit: 'pcs',
  seo: { title: null, description: null, image_url: null },
}

const socks = {
  ...product, id: UPSELL_ID, slug: 'socks', name: 'Socks', url: '/product/socks', options: [], default_variant_id: 'v-socks',
  variants: [{ ...variant('v-socks', '', '', '150.00'), name: 'Socks', option_values: {} }],
}

const home = { id: 'sm-home', name: 'Home delivery', description: null, fee: '60.00', free_over: null, cod_allowed: true, cod_fee: '0.00', eta_min_days: 1, eta_max_days: 2 }

const orderData = {
  product, upsell: socks, payment_methods: [{ code: 'cod', display_name: 'Cash on delivery' }], cod_enabled: true, guest_checkout: true, checkout_available: true,
  shipping: { methods: [home], districts: { '47': ['sm-home'] } },
}

function landing(layout: 'stacked' | 'two_columns') {
  return {
    document: { id: DOC_ID, key: 'landing:eid-sale', title: 'Eid sale', version: 1, source: 'published' },
    sections: [
      section('s_hero', [
        el('e_h', 'heading', { text: 'Eid tees for little ones', level: 1, link: null }),
        el('e_t', 'text', { html: `<p>${'Soft organic cotton, made for play. '.repeat(40)}</p>` }),
      ], '48px'),
      section('s_order', [
        el('e_order', 'order_form', {
          product_id: PRODUCT_ID, title: 'Order now', text: 'Cash on delivery all over Bangladesh.', show_variants: true, quantity: { default: 1, max: 5 },
          fields: { email: 'optional', note: 'optional' }, payment: 'cod_only', button_label: 'Confirm order',
          success_message: 'We will call you within a day to confirm.', upsell: { product_id: UPSELL_ID, label: 'Add a pair of socks' }, layout,
        }),
      ]),
      section('s_more', [el('e_more', 'text', { html: `<p>${'Questions? Call us any time. '.repeat(30)}</p>` })]),
    ],
    media: {},
    data: { e_order: orderData },
  }
}

const bootstrap = {
  store: { name: 'Berry Kids', description: 'Clothes and toys for little ones', prices_include_tax: true, currency: 'BDT' },
  preview: false,
  builder: { home: false },
  theme: {
    colors: { primary: '#f59e0b', primary_foreground: '#3b2500', accent: '#6f55c2', accent_foreground: '#ffffff', highlight: '#2fb79a', sale: '#c2410c', heading: '#3d3d3d', text: '#5f6368', canvas: '#f3f7fa', surface: '#ffffff', border: '#e1e1e1' },
    typography: { heading_font: 'baloo', body_font: 'poppins' },
    shape: { button_style: 'pill', card_radius: 12 },
    layout: { container_width: 1170, sticky_header: true },
    logo: null,
    favicon: null,
    announcement: null,
    footer: { about: null, copyright: null, contact: { email: null, phone: null, address: null }, social: {}, payment_logos: [] },
    custom_css: null,
  },
  menus: { main: { name: 'Main', items: [] } },
}

const PRICES: Record<string, number> = { 'v-red-m': 450, 'v-blue-l': 480, 'v-socks': 150 }
const money = (n: number) => n.toFixed(2)
type Line = { variant_id: string; quantity: number }

function preview(body: { lines: Line[]; address?: { district_id?: unknown }; shipping_method_id?: string; payment_method?: string }) {
  const lines = body.lines.map((line, i) => ({
    id: `l-${i}`, variant_id: line.variant_id, product: { slug: 'x', name: line.variant_id === 'v-socks' ? 'Socks' : 'Kids Tee', url: '/product/x', image: null },
    variant_name: line.variant_id === 'v-socks' ? null : line.variant_id === 'v-blue-l' ? 'Blue / L' : 'Red / M', option_values: {}, sku: line.variant_id,
    quantity: String(line.quantity), unit_price: money(PRICES[line.variant_id]!), compare_at_price: null, line_total: money(PRICES[line.variant_id]! * line.quantity),
    purchasable: true, in_stock: true, max_quantity: null, exceeds_stock: false, allow_decimal: false, discount_amount: '0.00', promotion: null,
  }))
  const subtotal = body.lines.reduce((sum, line) => sum + PRICES[line.variant_id]! * line.quantity, 0)
  const served = body.address?.district_id !== undefined && String(body.address.district_id) === '47'
  const shipping = served ? 60 : 0
  return {
    lines, subtotal: money(subtotal), discount_total: '0.00', shipping_discount: '0.00', promotions: [], coupon_code: null, tax_total: '0.00',
    shipping_total: money(shipping), cod_fee: '0.00', total: money(subtotal + shipping), currency: 'BDT', prices_include_tax: true,
    shipping_methods: served ? [home] : [], shipping_method_id: served ? 'sm-home' : null, payment_method: body.payment_method ?? null, issues: [],
  }
}

const order = (total: string) => ({
  number: 'WEB-000123', status: 'confirmed', status_label: 'Confirmed', payment_status: 'unpaid', payment_method: 'cod', payment_method_label: 'Cash on delivery',
  payment_instructions: null, placed_at: '2026-11-14T10:00:00+06:00', expires_at: null, contact: { name: 'Karim Uddin', email: '', phone: '01811223344' },
  shipping_address: { recipient_name: 'Karim Uddin', phone: '01811223344', division: 'Dhaka', district: 'Dhaka', area: null, address_line: 'Road 3, House 9', postcode: null },
  shipping_method_name: 'Home delivery', eta_min_days: 1, eta_max_days: 2, lines: [], subtotal: total, discount_total: '0.00', shipping_discount: '0.00', promotions: [],
  coupon_code: null, tax_total: '0.00', shipping_total: '60.00', cod_fee: '0.00', total, currency: 'BDT', prices_include_tax: true, courier_name: null, tracking_number: null,
  history: [{ status: 'confirmed', label: 'Confirmed', at: '2026-11-14T10:00:00+06:00' }],
})

type Placed = { body: Record<string, unknown>; key: string | undefined }

async function serve(page: Page, { layout = 'stacked' as 'stacked' | 'two_columns', entryPath = null as string | null } = {}) {
  const places: Placed[] = []
  const visits: unknown[] = []
  const cartWrites: string[] = []
  await page.route('**/api/v1/store/bootstrap*', (route) => route.fulfill({ json: envelope({ ...bootstrap, entry_path: entryPath }) }))
  await page.route('**/api/v1/store/builder/pages/eid-sale*', (route) => route.fulfill({ json: envelope(landing(layout)) }))
  await page.route('**/api/v1/store/builder/popups*', (route) => route.fulfill({ json: envelope({ popups: [], never_on: [] }) }))
  await page.route('**/api/v1/store/account/me*', (route) => route.fulfill({ json: envelope(null) }))
  await page.route('**/api/v1/store/wishlist*', (route) => route.fulfill({ json: envelope({ items: [] }) }))
  await page.route(/\/api\/v1\/store\/cart(\/.*)?(\?.*)?$/, (route) => {
    if (route.request().method() !== 'GET') cartWrites.push(route.request().url())
    return route.fulfill({ json: envelope({ id: null, items: [], item_count: '0', subtotal: '0.00', discount_total: '0.00', tax_total: '0.00', total: '0.00', prices_include_tax: true, currency: 'BDT', issues: [], promotions: [], free_shipping: null, coupon: null }) })
  })
  await page.route('**/api/v1/store/geo/divisions*', (route) => route.fulfill({ json: envelope([{ id: 3, name: 'Dhaka', name_bn: 'ঢাকা' }, { id: 7, name: 'Sylhet', name_bn: 'সিলেট' }]) }))
  await page.route('**/api/v1/store/geo/districts*', (route) => {
    const division = new URL(route.request().url()).searchParams.get('division')
    return route.fulfill({ json: envelope(division === '3' ? [{ id: 47, division_id: 3, name: 'Dhaka', name_bn: 'ঢাকা' }] : [{ id: 58, division_id: 7, name: 'Moulvibazar', name_bn: 'মৌলভীবাজার' }]) })
  })
  await page.route('**/api/v1/store/checkout/direct/preview*', (route) => route.fulfill({ json: envelope(preview(route.request().postDataJSON())) }))
  await page.route(/\/api\/v1\/store\/checkout\/direct(\?.*)?$/, (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    places.push({ body, key: route.request().headers()['idempotency-key'] })
    if (!route.request().headers()['idempotency-key']) return route.fulfill(failure(428, 'IDEMPOTENCY_KEY_REQUIRED', 'Key required'))
    return route.fulfill({ status: 201, json: envelope({ order: order(String(body.expected_total)), access_token: 'tok-1', order_url: '/order/WEB-000123?token=tok-1' }) })
  })
  await page.route('**/api/v1/store/visits*', (route) => {
    visits.push(route.request().postDataJSON())
    return route.fulfill({ json: envelope({ recorded: true }) })
  })
  return { places, visits, cartWrites }
}

const noHorizontalScroll = (page: Page) => page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth')

test('orders from a Facebook ad on a phone at 375 px', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone layout')
  await page.setViewportSize({ width: 375, height: 800 })
  const { places, visits, cartWrites } = await serve(page)
  await page.goto('/p/eid-sale?utm_source=facebook&utm_medium=paid&utm_campaign=eid&sl=eid-fb')
  await expect(page.getByRole('heading', { name: 'Eid tees for little ones', level: 1 })).toBeVisible()

  // The sticky "Order now" sits at the bottom of the screen and takes the shopper to the form.
  const bar = page.getByRole('region', { name: 'Quick order' })
  await expect(bar).toBeVisible()
  await expect.poll(async () => Math.round((await bar.boundingBox())!.y + (await bar.boundingBox())!.height)).toBe(800)
  await bar.getByRole('button', { name: /Order now/ }).click()
  const form = page.getByRole('form', { name: 'Order now' })
  await expect(page.getByTestId('order-form')).toBeFocused()
  await expect(bar).toBeHidden()

  // Option, quantity, add-on.
  await form.getByTestId('variant-selector').locator('label[title="Blue"]').click()
  await expect(form.getByRole('radio', { name: 'Colour: Blue' })).toBeChecked()
  await form.getByRole('button', { name: 'Increase: Quantity of Kids Tee' }).click()
  await form.getByRole('checkbox', { name: /Add a pair of socks/ }).check()

  // Contact and address (a Bangla keyboard types Bengali digits).
  const name = form.getByRole('textbox', { name: /^Your name/ })
  await name.fill('Karim Uddin')
  await form.getByRole('textbox', { name: /^Mobile number/ }).fill('০১৮১১২২৩৩৪৪')
  await form.getByRole('combobox', { name: /^Division/ }).selectOption('3')
  await expect(form.getByRole('combobox', { name: /^District/ })).toBeEnabled()
  await form.getByRole('combobox', { name: /^District/ }).selectOption('47')
  await form.getByRole('textbox', { name: /^Full address/ }).fill('Road 3, House 9')

  // The server's summary: 2 × ৳480 + ৳150 + ৳60 delivery.
  await expect(form.getByRole('radio', { name: /Home delivery/ })).toBeChecked()
  await expect(form.getByTestId('summary-total')).toHaveText('৳1,170.00')

  // Big tap targets and no sideways scrolling.
  for (const control of [name, form.getByRole('combobox', { name: /^District/ }), form.getByRole('button', { name: 'Confirm order' })]) {
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }
  expect(await noHorizontalScroll(page)).toBe(true)

  await form.getByRole('button', { name: 'Confirm order' }).click()
  const thanks = page.getByTestId('order-form-thanks')
  await expect(thanks).toBeVisible()
  await expect(thanks).toContainText('Thank you, Karim Uddin! Your order is placed.')
  await expect(thanks).toContainText('WEB-000123')
  await expect(thanks).toContainText('We will call you within a day to confirm.')
  await expect(thanks.getByRole('link', { name: 'View your order' })).toHaveAttribute('href', '/order/WEB-000123?token=tok-1')

  expect(places).toHaveLength(1)
  expect(places[0]!.key).toMatch(/^[0-9a-f-]{36}$/)
  expect(places[0]!.body).toMatchObject({
    document_id: DOC_ID,
    element_id: 'e_order',
    lines: [{ variant_id: 'v-blue-l', quantity: 2 }, { variant_id: 'v-socks', quantity: 1 }],
    contact: { name: 'Karim Uddin', phone: '01811223344' },
    address: { district_id: 47, division_id: 3, address_line: 'Road 3, House 9' },
    shipping_method_id: 'sm-home',
    payment_method: 'cod',
    expected_total: '1170.00',
    attribution: { utm_source: 'facebook', utm_medium: 'paid', utm_campaign: 'eid', short_link: 'eid-fb', landing_path: '/p/eid-sale' },
  })
  expect(visits).toEqual([{ path: '/p/eid-sale', utm_source: 'facebook', utm_medium: 'paid', utm_campaign: 'eid', code: 'eid-fb' }])
  expect(cartWrites).toEqual([])
  await expect(bar).toBeHidden()
  expect(await noHorizontalScroll(page)).toBe(true)
})

test('two columns, an error summary and the entry page at 1366 px', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop layout')
  await page.setViewportSize({ width: 1366, height: 900 })
  const { places } = await serve(page, { layout: 'two_columns', entryPath: '/p/eid-sale' })
  // The host opens on its entry page; the address stays "/".
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Eid tees for little ones', level: 1 })).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/')
  // No sticky bar on a desktop.
  await expect(page.getByTestId('order-now-bar')).toHaveCount(0)

  const form = page.getByRole('form', { name: 'Order now' })
  await form.scrollIntoViewIfNeeded()
  // The contact fields sit left of the product and summary.
  const nameBox = (await form.getByRole('textbox', { name: /^Your name/ }).boundingBox())!
  const summaryBox = (await form.getByTestId('order-form-summary').first().boundingBox())!
  expect(summaryBox.x).toBeGreaterThan(nameBox.x + nameBox.width)

  // An empty submit: a focused error summary whose links lead to the fields.
  await form.getByRole('button', { name: 'Confirm order' }).click()
  const summary = page.getByTestId('order-form-error-summary')
  await expect(summary).toBeFocused()
  await expect(summary.getByRole('link')).toHaveCount(5)
  await summary.getByRole('link', { name: /^Mobile number/ }).click()
  await expect(form.getByRole('textbox', { name: /^Mobile number/ })).toBeFocused()
  expect(places).toHaveLength(0)
  expect(await noHorizontalScroll(page)).toBe(true)
})
