import { expect, test, type Page } from '@playwright/test'

/*
 * B13 storefront on a mocked store (desktop 1366 px and a phone): sections for some shoppers only
 * (new visitors, signed-in shoppers, phones, a campaign, a cart value) drawn only once the visitor
 * is known — never first for everyone — and A/B tests: one sticky arm per visitor by the split,
 * the arm on every insights beacon and on add-to-cart's `attribution.builder.experiments`; Do Not
 * Track / Global Privacy Control → always version A, nothing stored or sent.
 */

const envelope = (data: unknown) => ({ success: true, data, meta: { request_id: 'e2e' } })

const DOC = '01a1c9d9-0000-7000-8000-0000000000b3'
const VISIBLE = { desktop: true, tablet: true, mobile: true }
const AB_KEY = `sf.ab.${DOC}.hero-test`

type Node = { id: string; type: string; props: Record<string, unknown> }
const el = (id: string, type: string, props: Record<string, unknown>): Node => ({ id, type, props })
const heading = (id: string, text: string, level = 2) => el(id, 'heading', { text, level, link: null })

function section(id: string, elements: Node[], extra: Record<string, unknown> = {}) {
  return {
    id,
    type: 'section',
    props: { layout: 'boxed', anchor: null },
    style: { base: { spacing: { padding: { top: '24px', bottom: '24px' } } } },
    visibility: VISIBLE,
    columns: [{ id: `c_${id}`, type: 'column', width: { base: 100 }, style: {}, elements: elements.map((e) => ({ ...e, style: {}, visibility: VISIBLE })) }],
    ...extra,
  }
}

const only = (rule: Record<string, unknown>) => ({ audience: { match: 'all', otherwise: 'hide', rules: [rule] } })

const product = (slug: string, name: string) => ({
  id: `p-${slug}`, slug, name, url: `/product/${slug}`, image: { url: '/favicon.svg', alt: name }, hover_image: null, price: '120.00', price_max: '120.00',
  compare_at_price: null, on_sale: false, discount_percent: null, in_stock: true, is_new: false, is_featured: false, brand: null, category: null,
  variant_count: 1, default_variant_id: `v-${slug}`, short_description: null, promotion: null,
})

const CAMPAIGN = '01a1c9d9-0000-7000-8000-00000000ca01'

const payload = {
  document: { id: DOC, key: 'landing:b13', title: 'B13', version: 2, source: 'published' },
  sections: [
    section('s_hero_a', [heading('e_a', 'Version A: winter sale', 1)], { experiment: { id: 'hero-test', arm: 'A' } }),
    section('s_hero_b', [heading('e_b', 'Version B: free delivery today', 1)], { experiment: { id: 'hero-test', arm: 'B' } }),
    section('s_new', [heading('e_new', 'Welcome, first-time shopper')], only({ kind: 'visitor', is: 'new' })),
    section('s_members', [heading('e_members', 'Members get 10 % off')], only({ kind: 'account', is: 'signed_in' })),
    section('s_phone', [heading('e_phone', 'Order on your phone')], only({ kind: 'device', in: ['mobile'] })),
    section('s_eid', [heading('e_eid', 'Eid campaign offer')], only({ kind: 'campaign', in: [CAMPAIGN], utm_source: [], utm_campaign: [] })),
    section('s_cart', [heading('e_cart', 'Your cart is over ৳1,500 — delivery is on us')], only({ kind: 'cart', min: '1500.00', max: null })),
    section('s_shop', [
      el('e_grid', 'product_grid', { title: 'Best sellers', subtitle: null, config: { source: 'best_sellers', category_id: null, limit: 8, columns: 4, view_all_url: null }, items: [] }),
    ]),
  ],
  media: {},
  data: {
    e_grid: { id: 'e_grid', type: 'product_grid', title: 'Best sellers', subtitle: null, config: { source: 'best_sellers', limit: 8, columns: 4, view_all_url: null }, products: [product('wool-hat', 'Wool Hat')] },
  },
  device_order: null,
  experiments: [{ id: 'hero-test', status: 'running', split: 50, winner: null }],
  audience_campaigns: { [CAMPAIGN]: { utm_campaign: 'eid-2026', short_links: ['eid-fb'] } },
  timezone: 'Asia/Dhaka',
}

const bootstrap = {
  store: { name: 'Green Basket', description: 'Organic groceries', prices_include_tax: true, currency: 'BDT', timezone: 'Asia/Dhaka' },
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
  menus: {},
}

const cart = (subtotal = '0.00') => ({ id: null, items: [], item_count: '0', subtotal, discount_total: '0.00', tax_total: '0.00', total: subtotal, prices_include_tax: true, currency: 'BDT', issues: [], promotions: [], free_shipping: null, coupon: null })

type Beacon = { document_id: string; seq: number; arms?: Record<string, string> }

async function serve(page: Page, options: { me?: unknown; meDelay?: number; subtotal?: string } = {}) {
  const beacons: Beacon[] = []
  const cartAdds: Record<string, unknown>[] = []
  await page.route('**/api/v1/store/bootstrap*', (route) => route.fulfill({ json: envelope(bootstrap) }))
  await page.route('**/api/v1/store/builder/pages/b13*', (route) => route.fulfill({ json: envelope(payload) }))
  await page.route('**/api/v1/store/builder/popups*', (route) => route.fulfill({ json: envelope({ popups: [], never_on: [] }) }))
  await page.route('**/api/v1/store/account/me*', async (route) => {
    if (options.meDelay) await new Promise((resolve) => setTimeout(resolve, options.meDelay))
    await route.fulfill({ json: envelope(options.me ?? null) })
  })
  await page.route('**/api/v1/store/wishlist*', (route) => route.fulfill({ json: envelope({ items: [] }) }))
  await page.route('**/api/v1/store/visits*', (route) => route.fulfill({ json: envelope({ recorded: true }) }))
  await page.route(/\/api\/v1\/store\/cart(\/items)?(\?.*)?$/, (route) => {
    if (route.request().method() === 'POST') cartAdds.push(route.request().postDataJSON() as Record<string, unknown>)
    return route.fulfill({ json: envelope(cart(options.subtotal)) })
  })
  await page.route('**/api/v1/store/insights/events*', (route) => {
    beacons.push(JSON.parse(route.request().postData() ?? '{}') as Beacon)
    return route.fulfill({ status: 202, json: envelope({ recorded: true, accepted: 1, ignored: 0 }) })
  })
  return { beacons, cartAdds }
}

const leave = (page: Page) => page.evaluate("window.dispatchEvent(new Event('pagehide'))")

/** Records every section id that was ever in the page (to prove nothing flashed). */
const watchSections = `
  window.__seen = new Set();
  new MutationObserver(() => document.querySelectorAll('section[data-b]').forEach((s) => window.__seen.add(s.getAttribute('data-b'))))
    .observe(document, { childList: true, subtree: true });
`
const seen = (page: Page) => page.evaluate('Array.from(window.__seen)') as Promise<string[]>

test('a returning visitor keeps version B; the arm goes with every beacon and with add-to-cart', async ({ page, isMobile }) => {
  await page.addInitScript({ content: `localStorage.setItem('${AB_KEY}', 'B')` })
  const { beacons, cartAdds } = await serve(page)
  await page.goto('/p/b13')
  await expect(page.getByRole('heading', { level: 1, name: 'Version B: free delivery today' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Version A: winter sale' })).toHaveCount(0)

  await page.locator('[data-b="e_grid"]').getByRole('button', { name: 'Add Wool Hat to the cart' }).click()
  await expect.poll(() => cartAdds.length).toBe(1)
  expect(cartAdds[0]).toEqual({
    variant_id: 'v-wool-hat',
    quantity: '1',
    attribution: { builder: { document_id: DOC, node_id: 's_shop', device: isMobile ? 'mobile' : 'desktop', experiments: { 'hero-test': 'B' } } },
  })

  await leave(page)
  await expect.poll(() => beacons.length).toBeGreaterThan(0)
  for (const beacon of beacons) expect(beacon.arms).toEqual({ 'hero-test': 'B' })
})

test('a first-time visitor is placed by the split and stays in that version', async ({ page }) => {
  await page.addInitScript({ content: 'Math.random = () => 0.2' })
  await serve(page)
  await page.goto('/p/b13')
  await expect(page.getByRole('heading', { level: 1, name: 'Version B: free delivery today' })).toBeVisible()
  expect(await page.evaluate(`localStorage.getItem('${AB_KEY}')`)).toBe('B')
  // Back another time with a different draw: still B.
  await page.addInitScript({ content: 'Math.random = () => 0.9' })
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Version B: free delivery today' })).toBeVisible()
})

for (const [name, init] of [
  ['Global Privacy Control', "Object.defineProperty(navigator, 'globalPrivacyControl', { get: () => true })"],
  ['Do Not Track', "Object.defineProperty(navigator, 'doNotTrack', { get: () => '1' })"],
] as const) {
  test(`${name}: always version A, nothing stored or sent`, async ({ page }) => {
    await page.addInitScript({ content: `${init}; Math.random = () => 0` })
    const { beacons, cartAdds } = await serve(page)
    await page.goto('/p/b13')
    await expect(page.getByRole('heading', { level: 1, name: 'Version A: winter sale' })).toBeVisible()
    expect(await page.evaluate(`localStorage.getItem('${AB_KEY}')`)).toBeNull()
    await page.locator('[data-b="e_grid"]').getByRole('button', { name: 'Add Wool Hat to the cart' }).click()
    await expect.poll(() => cartAdds.length).toBe(1)
    expect(cartAdds[0]).toEqual({ variant_id: 'v-wool-hat', quantity: '1' })
    await leave(page)
    await page.waitForTimeout(400)
    expect(beacons).toEqual([])
  })
}

test('the right sections for a first-time guest; signed-in-only content never flashes', async ({ page, isMobile }) => {
  await page.addInitScript({ content: watchSections })
  await serve(page, { meDelay: 700 })
  await page.goto('/p/b13')
  await expect(page.getByRole('heading', { name: 'Welcome, first-time shopper' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Order on your phone' })).toHaveCount(isMobile ? 1 : 0)
  await expect(page.getByRole('heading', { name: 'Eid campaign offer' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Your cart is over ৳1,500 — delivery is on us' })).toHaveCount(0)
  await page.waitForTimeout(900)
  await expect(page.getByRole('heading', { name: 'Members get 10 % off' })).toHaveCount(0)
  expect(await seen(page)).not.toContain('s_members')
  expect(await seen(page)).not.toContain('s_eid')
})

test('a returning, signed-in shopper from the Eid campaign with a full cart', async ({ page }) => {
  // Seen the store a week ago (another visit: no session flag); arrived by the campaign's short link.
  await page.addInitScript({ content: `if (!sessionStorage.getItem('e2e-init')) { localStorage.setItem('sf.visitor', String(Date.now() - 7 * 86400000)); sessionStorage.setItem('e2e-init', '1') }` })
  await page.addInitScript({ content: watchSections })
  await serve(page, { me: { id: 'cus_1', name: 'Rahim', email: 'rahim@example.test', phone: null, email_verified: true }, subtotal: '1800.00' })
  await page.goto('/p/b13?sl=eid-fb')
  await expect(page.getByRole('heading', { name: 'Members get 10 % off' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Eid campaign offer' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Your cart is over ৳1,500 — delivery is on us' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Welcome, first-time shopper' })).toHaveCount(0)
  expect(await seen(page)).not.toContain('s_new')
})
