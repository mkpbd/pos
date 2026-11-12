import { expect, test, type Page } from '@playwright/test'

/*
 * Store builder B8a on a mocked store (1366 px and 375 px): pricing plans, a before / after slider
 * (keyboard and pointer), a comparison table that scrolls inside its own box on phones, a flash
 * sale bar with its countdown and claimed bar, a bundle that adds its items one by one (one fails),
 * the team, a review wall carousel, a photo grid and the store hours with "open now".
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })

const VISIBLE = { desktop: true, tablet: true, mobile: true }
const uuid = (n: number) => `0199a5c1-0000-7000-8000-${n.toString(16).padStart(12, '0')}`
const MEDIA = { before: uuid(0xb8a01), after: uuid(0xb8a02), rina: uuid(0xb8a03), tea: uuid(0xb8a04), front: uuid(0xb8a05), mugs: uuid(0xb8a06) }
const KETTLE = uuid(0xb8b01)
const SMART = uuid(0xb8b02)
const TEA = uuid(0xb8b03)
const CUP = uuid(0xb8b04)

type Node = { id: string; type: string; props: Record<string, unknown> }

const el = (id: string, type: string, props: Record<string, unknown>): Node => ({ id, type, props })

function section(id: string, elements: Node[]) {
  return {
    id,
    type: 'section',
    props: { layout: 'boxed', anchor: null },
    style: { base: { spacing: { padding: { top: '32px', bottom: '32px' } } } },
    visibility: VISIBLE,
    columns: [{ id: `c_${id}`, type: 'column', width: { base: 100 }, style: {}, elements: elements.map((e) => ({ ...e, style: {}, visibility: VISIBLE })) }],
  }
}

const card = (slug: string, id = `p-${slug}`) => ({
  id, slug, name: slug.replace(/-/g, ' '), url: `/product/${slug}`, image: { url: '/favicon.svg', alt: slug }, hover_image: null, price: '120.00', price_max: '120.00',
  compare_at_price: null, on_sale: false, discount_percent: null, in_stock: true, is_new: false, is_featured: false, brand: null, category: null,
  variant_count: 1, default_variant_id: `v-${slug}`, short_description: null, promotion: null,
})

const variant = (id: string, name: string, price: string, extra: Record<string, unknown> = {}) => ({
  id, sku: id.toUpperCase(), name, option_values: {}, price, compare_at_price: null, on_sale: false, discount_percent: null, in_stock: true, low_stock: false, image_id: null, promo_price: null, ...extra,
})

const detail = (slug: string, id: string, variants: ReturnType<typeof variant>[], options: unknown[] = []) => ({
  ...card(slug, id),
  description_html: null, specifications: [], breadcrumbs: [], images: [{ id: `img-${slug}`, url: '/favicon.svg', alt: slug }],
  options, variants, price: variants[0]!.price, price_max: variants[variants.length - 1]!.price, default_variant_id: variants[0]!.id, unit: null,
  seo: { title: null, description: null, image_url: null },
})

const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => ({ day, closed: day === 'fri', open: '00:00', close: '00:00' }))

const sections = [
  section('s_pricing', [
    el('e_pricing', 'pricing_table', {
      plans: [
        { id: 'p1', name: 'Starter box', price: null, price_text: 'Free', period: '', description: 'Try our snacks once.', features: [{ id: 'f1', text: 'Delivery inside Dhaka', included: true }, { id: 'f2', text: 'Gift wrapping', included: false }], button: { label: 'Start free', url: '/shop' }, highlighted: false, badge: '' },
        { id: 'p2', name: 'Monthly box', price: '499.00', price_text: '', period: '/month', description: 'A fresh box every month.', features: [{ id: 'f1', text: 'Free delivery everywhere', included: true }], button: { label: 'Subscribe', url: '/shop' }, highlighted: true, badge: 'Popular' },
        { id: 'p3', name: 'Family box', price: '899.00', price_text: '', period: '/month', description: '', features: [{ id: 'f1', text: 'Two boxes', included: true }], button: null, highlighted: false, badge: '' },
      ],
    }),
  ]),
  section('s_ba', [
    el('e_ba', 'before_after', { before: { media_id: MEDIA.before, alt: 'The room before' }, after: { media_id: MEDIA.after, alt: 'The room after' }, before_label: 'Before', after_label: 'After', start: 50, orientation: 'horizontal', aspect: '16:9' }),
  ]),
  section('s_compare', [
    el('e_compare', 'comparison_table', {
      columns: [
        { id: 'c1', title: 'Basic kettle', product_id: KETTLE, highlighted: false },
        { id: 'c2', title: 'Smart kettle', product_id: SMART, highlighted: true },
        { id: 'c3', title: 'Glass kettle', product_id: null, highlighted: false },
        { id: 'c4', title: 'Other shops', product_id: null, highlighted: false },
      ],
      rows: [
        { id: 'r1', label: 'Auto shut-off', cells: { c1: { kind: 'yes', text: '' }, c2: { kind: 'yes', text: '' }, c3: { kind: 'yes', text: '' }, c4: { kind: 'no', text: '' } } },
        { id: 'r2', label: 'Warranty', cells: { c1: { kind: 'text', text: '6 months' }, c2: { kind: 'text', text: '2 years' }, c3: { kind: 'text', text: '1 year' }, c4: { kind: 'no', text: '' } } },
      ],
      show_prices: true,
      show_buttons: true,
    }),
  ]),
  section('s_flash', [
    el('e_flash', 'flash_sale_bar', { promotion_id: null, title: 'Flash sale', text: 'Big savings for a few hours only.', show_products: true, product_limit: 4, style: 'bar', button: { label: 'Shop the sale', url: '/shop' } }),
  ]),
  section('s_bundle', [el('e_bundle', 'bundle', { items: [{ id: 'b1', product_id: TEA }, { id: 'b2', product_id: CUP }], title: 'Tea time', text: 'Everything for a cosy cup.', button_label: 'Add both to cart' })]),
  section('s_people', [
    el('e_team', 'team', {
      members: [
        { id: 'm1', media_id: MEDIA.rina, name: 'Rina Akter', role: 'Founder', bio: 'Started the shop in her kitchen.', links: [{ id: 'l1', kind: 'instagram', url: 'https://www.instagram.com/example' }, { id: 'l2', kind: 'email', url: 'mailto:rina@example.com' }] },
        { id: 'm2', media_id: null, name: 'Karim Hasan', role: 'Delivery lead', bio: '', links: [] },
        { id: 'm3', media_id: null, name: 'Mita Das', role: 'Packing', bio: '', links: [] },
      ],
      columns: { base: 3, mobile: 1 },
      style: 'card',
    }),
    el('e_reviews', 'review_wall', { source: 'latest', product_id: null, min_rating: 4, limit: 6, layout: 'carousel', show_product: true, show_summary: true, title: 'What our customers say' }),
    el('e_photos', 'photo_grid', {
      images: [
        { id: 'g1', media_id: MEDIA.tea, alt: 'Tea on a table', link: null },
        { id: 'g2', media_id: MEDIA.front, alt: 'Our shop front', link: { url: '/shop' } },
        { id: 'g3', media_id: MEDIA.mugs, alt: 'New mugs', link: { url: 'https://www.instagram.com/p/example' } },
      ],
      columns: { base: 6, tablet: 3, mobile: 3 },
      gap: 'sm',
      profile: { label: '@littlesprouts', url: 'https://www.instagram.com/littlesprouts' },
      hover: 'overlay',
    }),
    el('e_hours', 'store_hours', { days: WEEK, title: 'Opening hours', note: 'Closed on public holidays.', show_open_now: true, highlight_today: true, week_starts: 'sat' }),
  ]),
]

const reviews = ['Fresh and quick.', 'Good value.', 'Will buy again.', 'Lovely packing.'].map((body, i) => ({
  id: `r${i}`, author: ['Rina A.', 'Karim H.', 'Mita', 'Sumi'][i], rating: i === 0 ? 5 : 4, title: null, body, created_at: '2026-10-01T10:00:00Z',
  product: i === 0 ? { name: 'Green tea', url: '/product/green-tea', image: { url: '/favicon.svg', alt: null } } : null,
}))

const payload = {
  document: { id: uuid(0xd1), key: 'landing:b8a', title: 'B8a', version: 1, source: 'published' },
  sections,
  media: Object.fromEntries(Object.values(MEDIA).map((id) => [id, { url: '/favicon.svg', srcset: '', width: 600, height: 400, alt: null }])),
  data: {
    e_compare: { products: { [KETTLE]: card('basic-kettle', KETTLE) } },
    e_flash: { promotion: { id: uuid(0xf1), name: 'Midnight madness', ends_at: new Date(Date.now() + 5 * 3600_000).toISOString() }, products: [card('green-tea'), card('mango-jam'), card('lime-pickle'), card('honey')], claimed: { used: 30, limit: 120 } },
    e_bundle: {
      products: {
        [TEA]: detail('green-tea', TEA, [variant('v-tea-s', 'Small', '250.00'), variant('v-tea-l', 'Large', '400.00')]),
        [CUP]: detail('clay-cup', CUP, [variant('v-cup', 'Default', '120.00')]),
      },
    },
    e_reviews: { summary: { average: '4.6', count: 128 }, reviews },
    e_hours: { timezone: 'Asia/Dhaka' },
  },
}

const bootstrap = {
  store: { name: 'Green Basket', description: 'Organic groceries', prices_include_tax: true, currency: 'BDT' },
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
    footer: { about: 'Organic groceries.', copyright: null, contact: { email: null, phone: null, address: null }, social: {}, payment_logos: [] },
    custom_css: null,
  },
  menus: { main: { name: 'Main', items: [] } },
}

const emptyCart = { id: null, items: [], item_count: '0', subtotal: '0.00', discount_total: '0.00', tax_total: '0.00', total: '0.00', prices_include_tax: true, currency: 'BDT', issues: [], promotions: [], free_shipping: null, coupon: null }

/** The mocked store; adding the clay cup fails (out of stock). Returns the variant ids posted to the cart. */
async function serve(page: Page) {
  const added: string[] = []
  await page.route('**/api/v1/store/bootstrap*', (route) => route.fulfill({ json: envelope(bootstrap) }))
  await page.route('**/api/v1/store/builder/pages/b8a*', (route) => route.fulfill({ json: envelope(payload) }))
  await page.route('**/api/v1/store/account/me*', (route) => route.fulfill({ json: envelope(null) }))
  await page.route('**/api/v1/store/wishlist*', (route) => route.fulfill({ json: envelope({ items: [] }) }))
  await page.route('**/api/v1/store/cart/items*', (route) => {
    const variantId = (route.request().postDataJSON() as { variant_id: string }).variant_id
    added.push(variantId)
    if (variantId === 'v-cup') return route.fulfill({ status: 422, json: { success: false, error: { code: 'OUT_OF_STOCK', message: 'Out of stock', details: {} }, meta: { request_id: 'e2e' } } })
    return route.fulfill({ json: envelope(emptyCart) })
  })
  await page.route(/\/api\/v1\/store\/cart(\?.*)?$/, (route) => route.fulfill({ json: envelope(emptyCart) }))
  return added
}

const noHorizontalScroll = (page: Page) => page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth')

test('B8a elements at 1366 px', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop layout')
  await page.setViewportSize({ width: 1366, height: 900 })
  const added = await serve(page)
  await page.goto('/p/b8a')

  // Pricing: three plans side by side, features read out with icon + text.
  const plans = page.getByRole('list', { name: 'Pricing plans' }).getByRole('article')
  await expect(plans).toHaveCount(3)
  const boxes = await plans.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)))
  expect(new Set(boxes).size).toBe(1)
  await expect(plans.nth(1)).toContainText('499.00')
  await expect(plans.nth(0).getByText('Not included:', { exact: false })).toHaveCount(1)

  // Before / after: keyboard, then a mouse drag.
  const slider = page.getByRole('slider', { name: 'Compare Before and After' })
  await slider.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(slider).toHaveAttribute('aria-valuenow', '49')
  await page.keyboard.press('Home')
  await expect(slider).toHaveAttribute('aria-valuenow', '0')
  const frame = page.getByTestId('before-after-frame')
  const box = (await frame.boundingBox())!
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => Number(await slider.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(74)
  await expect(slider).toBeFocused()

  // Comparison: a real table; the unavailable smart kettle keeps its title only.
  const table = page.getByRole('table', { name: 'Comparison' })
  await expect(table.getByRole('columnheader', { name: /Basic kettle/ }).getByRole('button', { name: /Add basic kettle to the cart/i })).toBeVisible()
  await expect(table.getByRole('columnheader', { name: /Smart kettle/ }).getByRole('button')).toHaveCount(0)
  await expect(table.getByRole('rowheader', { name: 'Warranty' })).toBeVisible()

  // Flash sale: countdown, claimed bar, four products.
  const flash = page.getByRole('region', { name: 'Flash sale' })
  await expect(flash.getByTestId('countdown')).toBeVisible()
  await expect(flash.getByRole('progressbar', { name: 'Claimed so far' })).toHaveAttribute('aria-valuenow', '30')
  await expect(flash.getByText('30 of 120 claimed')).toBeVisible()
  await expect(flash.getByRole('list', { name: 'On sale now' }).getByRole('listitem')).toHaveCount(4)

  // Bundle: choose the large tea, the total follows; one item fails and the shopper is told which.
  const bundle = page.getByRole('region', { name: 'Tea time' })
  await expect(bundle.getByTestId('bundle-total')).toContainText('370.00')
  await bundle.getByRole('combobox', { name: 'Option for green tea' }).selectOption('v-tea-l')
  await expect(bundle.getByTestId('bundle-total')).toContainText('520.00')
  await bundle.getByRole('button', { name: 'Add both to cart' }).click()
  const status = bundle.getByRole('status')
  await expect(status).toContainText('Added 1 of 2 items to your cart.')
  await expect(status).toContainText('clay cup — Sorry, this item is out of stock.')
  expect(added).toEqual(['v-tea-l', 'v-cup'])

  // Team, review wall carousel, photo grid.
  await expect(page.getByRole('link', { name: 'Rina Akter on Instagram (opens in a new tab)' })).toHaveAttribute('target', '_blank')
  await expect(page.getByRole('link', { name: 'Email Rina Akter' })).toHaveAttribute('href', 'mailto:rina@example.com')
  const wall = page.getByRole('region', { name: 'What our customers say' })
  await expect(wall.getByRole('group', { name: 'What our customers say' })).toHaveAttribute('aria-roledescription', 'carousel')
  await expect(wall.getByRole('img', { name: 'Rated 4.6 out of 5' })).toBeVisible()
  const photos = await page.evaluate<number>(`getComputedStyle(document.querySelector('[data-b="e_photos"] .b-gallery-grid')).gridTemplateColumns.split(' ').length`)
  expect(photos).toBe(6)
  await expect(page.getByRole('link', { name: 'New mugs (opens in a new tab)' })).toHaveAttribute('target', '_blank')

  // Store hours: open around the clock except Friday; today labelled.
  const hours = page.getByRole('region', { name: 'Opening hours' })
  const today = hours.locator('tr[data-today="true"]')
  await expect(today).toHaveCount(1)
  await expect(today).toContainText('Today')
  await expect(hours.getByTestId('hours-status')).toHaveText(/Open now · open 24 hours|Closed · opens/)

  expect(await noHorizontalScroll(page)).toBe(true)
})

test('B8a elements at 375 px', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone layout')
  await page.setViewportSize({ width: 375, height: 800 })
  await serve(page)
  await page.goto('/p/b8a')

  // Plans stack, the highlighted one first.
  const plans = page.getByRole('list', { name: 'Pricing plans' }).getByRole('article')
  await expect(plans).toHaveCount(3)
  const tops = await plans.evaluateAll((nodes) => nodes.map((node) => ({ name: node.querySelector('h3')?.textContent, top: node.getBoundingClientRect().top })))
  expect(tops.sort((a, b) => a.top - b.top)[0]!.name).toBe('Monthly box')

  // The comparison table scrolls inside its own box with the feature column kept in view.
  const region = page.getByRole('region', { name: 'Comparison' })
  await region.scrollIntoViewIfNeeded()
  const wide = await region.evaluate((node) => node.scrollWidth > node.clientWidth)
  expect(wide).toBe(true)
  await region.evaluate((node) => node.scrollBy({ left: 200 }))
  const header = region.getByRole('rowheader', { name: 'Warranty' })
  const [regionBox, headerBox] = [await region.boundingBox(), await header.boundingBox()]
  expect(Math.abs(headerBox!.x - regionBox!.x)).toBeLessThanOrEqual(2)

  // Touch drag on the before / after photo.
  const slider = page.getByRole('slider', { name: 'Compare Before and After' })
  const frame = page.getByTestId('before-after-frame')
  await frame.scrollIntoViewIfNeeded()
  const box = (await frame.boundingBox())!
  await page.touchscreen.tap(box.x + box.width * 0.25, box.y + box.height / 2)
  await expect.poll(async () => Number(await slider.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(30)

  // One team member per row, three photos per row.
  const teamColumns = await page.evaluate<number>(`getComputedStyle(document.querySelector('[data-b="e_team"]')).gridTemplateColumns.split(' ').length`)
  expect(teamColumns).toBe(1)
  const photoColumns = await page.evaluate<number>(`getComputedStyle(document.querySelector('[data-b="e_photos"] .b-gallery-grid')).gridTemplateColumns.split(' ').length`)
  expect(photoColumns).toBe(3)

  await expect(page.getByRole('region', { name: 'Opening hours' }).getByTestId('hours-status')).toBeVisible()
  expect(await noHorizontalScroll(page)).toBe(true)
})
