import { expect, test, type Page } from '@playwright/test'

/*
 * Store builder B14 on a mocked store: store pages drawn from their published templates — a
 * category page with live text and the store's product listing (its own columns, a filter
 * switched off, filters kept in the address and the back button), the search page with "Load
 * more", the order / thank-you page around the order loaded with the guest's token, the "page not
 * found" template, and the standard pages when no template is published.
 */

const envelope = (data: unknown) => ({ success: true, data, meta: { request_id: 'e2e' } })

const VISIBLE = { desktop: true, tablet: true, mobile: true }
const uuid = (n: number) => `0199a5c1-0000-7000-8000-${n.toString(16).padStart(12, '0')}`

type Node = { id: string; type: string; props: Record<string, unknown> }
const el = (id: string, type: string, props: Record<string, unknown>): Node => ({ id, type, props })

function section(id: string, elements: Node[]) {
  return {
    id,
    type: 'section',
    props: { layout: 'boxed', anchor: null },
    style: { base: { spacing: { padding: { top: '24px', bottom: '24px' } } } },
    visibility: VISIBLE,
    columns: [{ id: `c_${id}`, type: 'column', width: { base: 100 }, style: {}, elements: elements.map((e) => ({ ...e, style: {}, visibility: VISIBLE })) }],
  }
}

const dynamicText = (id: string, field: string, extra: Record<string, unknown> = {}) => el(id, 'dynamic_text', { field, tag: 'p', prefix: '', suffix: '', fallback: '', format: 'default', ...extra })
const listing = (id: string, extra: Record<string, unknown> = {}) =>
  el(id, 'product_listing', {
    scope: 'current',
    category_ids: [],
    brand_ids: [],
    filters: { price: true, brand: true, category: true, attributes: true, availability: true, on_sale: true },
    filter_layout: 'sidebar',
    sort_default: 'featured',
    per_page: 24,
    columns: { desktop: 4, tablet: 3, mobile: 2 },
    show_count: true,
    pagination: 'pages',
    ...extra,
  })

const template = (key: string, n: number, sections: unknown[]) => ({
  document: { id: uuid(n), key: `template:${key}`, title: key, version: 1, source: 'published' },
  sections,
  media: {},
  data: {},
})

const TEMPLATES: Record<string, unknown> = {
  category: template('category', 0xb1, [
    section('s_head', [dynamicText('e_name', 'category.name', { tag: 'h1' }), dynamicText('e_count', 'category.product_count', { suffix: ' products to choose from' })]),
    section('s_list', [listing('e_list', { filters: { price: true, brand: false, category: true, attributes: true, availability: true, on_sale: true } })]),
  ]),
  search: template('search', 0xb2, [
    section('s_head', [dynamicText('e_q', 'search.query', { tag: 'h1', prefix: 'Results for ' })]),
    section('s_list', [listing('e_list', { pagination: 'load_more', per_page: 12, filter_layout: 'drawer' })]),
  ]),
  order: template('order', 0xb3, [
    section('s_head', [dynamicText('e_hi', 'order.customer_first_name', { tag: 'h2', prefix: 'Thank you, ', suffix: '!' }), dynamicText('e_eta', 'order.delivery_eta', { prefix: 'Arrives in ' })]),
    section('s_order', [el('e_order', 'order_summary', { show_timeline: true, show_items: true, show_address: true, show_delivery: true })]),
  ]),
  not_found: template('not_found', 0xb4, [
    section('s_nf', [el('e_nf', 'not_found_message', { heading: 'This shelf is empty', text: 'The page moved or never existed.', show_search: true, show_links: true })]),
  ]),
}

const bootstrap = (templates: Record<string, boolean>) => ({
  store: { name: 'Berry Kids', description: 'Clothes and toys', prices_include_tax: true, currency: 'BDT' },
  preview: false,
  builder: { home: false, templates: { shop: false, category: false, brand: false, search: false, blog_post: false, order: false, not_found: false, ...templates } },
  theme: {
    colors: { primary: '#f59e0b', primary_foreground: '#3b2500', accent: '#6f55c2', accent_foreground: '#ffffff', highlight: '#2fb79a', sale: '#c2410c', heading: '#3d3d3d', text: '#5f6368', canvas: '#f3f7fa', surface: '#ffffff', border: '#e1e1e1' },
    typography: { heading_font: 'baloo', body_font: 'poppins' },
    shape: { button_style: 'pill', card_radius: 12 },
    layout: { container_width: 1170, sticky_header: true },
    logo: null,
    favicon: null,
    announcement: null,
    footer: { about: null, copyright: null, contact: { email: null, phone: '01700000000', address: null }, social: {}, payment_logos: [] },
    custom_css: null,
  },
  menus: { main: { name: 'Main', items: [] } },
})

const card = (n: number) => ({
  id: `p-${n}`, slug: `tee-${n}`, name: `Tee ${n}`, url: `/product/tee-${n}`, image: { url: '/favicon.svg', alt: `Tee ${n}` }, hover_image: null,
  price: '450.00', price_max: '450.00', compare_at_price: null, on_sale: false, discount_percent: null, in_stock: true,
  is_new: false, is_featured: false, brand: { name: 'Sunny', slug: 'sunny' }, category: { name: 'Juices', slug: 'juices' }, variant_count: 1, default_variant_id: `v-${n}`, short_description: null, promotion: null,
})

const facets = {
  categories: [{ slug: 'juices', name: 'Juices', count: 14 }],
  brands: [{ slug: 'sunny', name: 'Sunny', count: 14, selected: false }],
  attributes: [],
  price: { min: '450.00', max: '450.00' },
  in_stock: { count: 14 },
  on_sale: { count: 0 },
}

const category = {
  id: uuid(0xc1), slug: 'juices', name: 'Juices', description_html: '<p>Freshly pressed.</p>', image: null, banner: null,
  seo: { title: 'Fresh juices', description: 'Cold-pressed every morning.' },
  breadcrumbs: [{ name: 'Home', url: '/' }, { name: 'Juices', url: null }], children: [],
}

const order = {
  number: 'WEB-000042', status: 'confirmed', status_label: 'Confirmed', payment_status: 'unpaid', payment_method: 'cod', payment_method_label: 'Cash on delivery',
  payment_instructions: null, placed_at: '2026-11-19T10:00:00+06:00', expires_at: null,
  contact: { name: 'Rina Akter', email: 'rina@example.com', phone: '01712345678' },
  shipping_address: { recipient_name: 'Rina Akter', phone: '01712345678', division: 'Dhaka', district: 'Dhaka', area: 'Dhanmondi', address_line: 'House 12, Road 5', postcode: '1205' },
  shipping_method_name: 'Home delivery', eta_min_days: 1, eta_max_days: 2,
  lines: [{ product_name: 'Kids Tee', variant_name: 'Red / M', sku: 'TEE-RM', image_url: null, quantity: '2.000', unit_price: '450.00', line_total: '900.00', product_url: '/product/kids-tee', discount_amount: '0.00' }],
  subtotal: '900.00', discount_total: '0.00', shipping_discount: '0.00', promotions: [], coupon_code: null, tax_total: '0.00', shipping_total: '60.00', cod_fee: '0.00',
  total: '960.00', currency: 'BDT', prices_include_tax: true, courier_name: null, tracking_number: null,
  history: [{ status: 'confirmed', label: 'Confirmed', at: '2026-11-19T10:00:00+06:00' }],
}

const emptyCart = { id: null, items: [], item_count: '0', subtotal: '0.00', discount_total: '0.00', tax_total: '0.00', total: '0.00', prices_include_tax: true, currency: 'BDT', issues: [], promotions: [], free_shipping: null, coupon: null }

async function serve(page: Page, templates: Record<string, boolean>) {
  const requests = { products: [] as URLSearchParams[], templates: [] as string[], orders: [] as URLSearchParams[] }
  await page.route('**/api/v1/store/bootstrap*', (route) => route.fulfill({ json: envelope(bootstrap(templates)) }))
  await page.route('**/api/v1/store/account/me*', (route) => route.fulfill({ json: envelope(null) }))
  await page.route('**/api/v1/store/builder/popups*', (route) => route.fulfill({ json: envelope({ popups: [], never_on: [] }) }))
  await page.route('**/api/v1/store/wishlist*', (route) => route.fulfill({ json: envelope({ items: [] }) }))
  await page.route(/\/api\/v1\/store\/cart(\?.*)?$/, (route) => route.fulfill({ json: envelope(emptyCart) }))
  await page.route('**/api/v1/store/search/suggest*', (route) => route.fulfill({ json: envelope({ products: [], categories: [], brands: [] }) }))
  await page.route('**/api/v1/store/categories/juices*', (route) => route.fulfill({ json: envelope(category) }))
  await page.route('**/api/v1/store/orders/WEB-000042*', (route) => {
    requests.orders.push(new URL(route.request().url()).searchParams)
    return route.fulfill({ json: envelope(order) })
  })
  await page.route('**/api/v1/store/builder/templates/*', (route) => {
    const key = new URL(route.request().url()).pathname.split('/').pop() ?? ''
    requests.templates.push(key)
    return key in TEMPLATES && templates[key]
      ? route.fulfill({ json: envelope(TEMPLATES[key]) })
      : route.fulfill({ status: 404, json: { success: false, error: { code: 'PAGE_NOT_FOUND', message: 'Not found', details: {} }, meta: { request_id: 'e2e' } } })
  })
  await page.route((url) => url.pathname === '/api/v1/store/products', (route) => {
    const params = new URL(route.request().url()).searchParams
    requests.products.push(params)
    const perPage = Number(params.get('per_page') ?? 24)
    const current = Number(params.get('page') ?? 1)
    const total = 14
    const items = Array.from({ length: total }, (_, i) => card(i + 1)).slice((current - 1) * perPage, current * perPage)
    return route.fulfill({
      json: { success: true, data: items, meta: { request_id: 'e2e', current_page: current, per_page: perPage, total, last_page: Math.ceil(total / perPage) }, facets, context: { category: null, brand: null, q: params.get('q') } },
    })
  })
  return requests
}

const noHorizontalScroll = (page: Page) => page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth')

test('a category page drawn from its template keeps the listing, its filters in the address and the meta', async ({ page, isMobile }) => {
  const requests = await serve(page, { category: true })
  await page.goto('/category/juices')

  await expect(page.getByRole('heading', { level: 1, name: 'Juices' })).toBeVisible()
  await expect(page.getByText('14 products to choose from')).toBeVisible()
  await expect(page.getByTestId('product-card')).toHaveCount(14)
  await expect(page).toHaveTitle('Fresh juices | Berry Kids')
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', 'Cold-pressed every morning.')
  expect(requests.products.at(-1)?.get('category')).toBe('juices')
  await expect(page.getByTestId('product-results')).toHaveAttribute('data-columns', '4-3-2')
  expect(await noHorizontalScroll(page)).toBe(true)

  if (isMobile) {
    // Phones: two cards a row, filters behind a button.
    const [first, second] = await page.getByTestId('product-card').evaluateAll((nodes) => nodes.slice(0, 2).map((n) => Math.round(n.getBoundingClientRect().top)))
    expect(first).toBe(second)
    await page.getByRole('button', { name: 'Filters' }).click()
    await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible()
    return
  }

  const filters = page.getByRole('complementary', { name: 'Filters' })
  // The template switched the brand filter off.
  await expect(filters.getByRole('checkbox', { name: /Sunny/ })).toHaveCount(0)
  await filters.getByRole('checkbox', { name: /In stock/ }).click()
  await expect(page).toHaveURL(/\/category\/juices\?in_stock=1$/)
  await expect.poll(() => requests.products.at(-1)?.get('in_stock')).toBe('1')
  await page.goBack()
  await expect(page).toHaveURL(/\/category\/juices$/)
  await expect(filters.getByRole('checkbox', { name: /In stock/ })).not.toBeChecked()
})

test('the search template loads more results below and keeps the page in the address', async ({ page }) => {
  const requests = await serve(page, { search: true })
  await page.goto('/search?q=tee')
  await expect(page.getByRole('heading', { level: 1, name: 'Results for tee' })).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  await expect(page.getByTestId('product-card')).toHaveCount(12)
  await expect(page.getByTestId('result-count')).toHaveText('Showing 1–12 of 14 products')
  await page.getByTestId('load-more').click()
  await expect(page.getByTestId('product-card')).toHaveCount(14)
  await expect(page).toHaveURL(/\/search\?q=tee&page=2$/)
  await expect(page.getByTestId('load-more')).toHaveCount(0)
  expect(requests.products.map((p) => p.get('page'))).toContain('2')
  expect(await noHorizontalScroll(page)).toBe(true)
})

test('the order page template draws around the order loaded with the guest token', async ({ page }) => {
  const requests = await serve(page, { order: true })
  await page.goto('/order/WEB-000042?token=secret-token')
  await expect(page.getByRole('heading', { name: 'Thank you, Rina!' })).toBeVisible()
  await expect(page.getByText('Arrives in 1–2 days')).toBeVisible()
  await expect(page.getByTestId('order-number')).toHaveText('WEB-000042')
  await expect(page.getByText('Kids Tee')).toBeVisible()
  // The token left the address bar; the order came from the order API with it, the template without it.
  await expect(page).toHaveURL(/\/order\/WEB-000042$/)
  expect(requests.orders[0]?.get('token')).toBe('secret-token')
  expect(new Set(requests.templates)).toEqual(new Set(['order']))
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  expect(await noHorizontalScroll(page)).toBe(true)
})

test('an unknown address shows the "page not found" template', async ({ page }) => {
  await serve(page, { not_found: true })
  await page.goto('/no-such-shelf')
  await expect(page.getByRole('heading', { level: 1, name: 'This shelf is empty' })).toBeVisible()
  await expect(page.getByText('The page moved or never existed.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Browse the shop' })).toHaveAttribute('href', '/shop')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
})

test('without a published template the standard pages show and no template is fetched', async ({ page }) => {
  const requests = await serve(page, {})
  await page.goto('/category/juices')
  await expect(page.getByRole('heading', { level: 1, name: 'Juices' })).toBeVisible()
  await expect(page.getByText('Freshly pressed.')).toBeVisible()
  await expect(page.getByTestId('product-card')).toHaveCount(14)
  await page.goto('/no-such-shelf')
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()
  expect(requests.templates).toEqual([])
})
