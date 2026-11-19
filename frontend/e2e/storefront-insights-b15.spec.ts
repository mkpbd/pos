import { expect, test, type Page } from '@playwright/test'

/*
 * B15 storefront on a mocked store (desktop 1366 px and a phone): the privacy-first insights
 * collector sends section views (≥ 50 % for ≥ 1 s), clicks with their place in the section, the
 * scroll depth and the device in batched beacons; nothing with Global Privacy Control / Do Not
 * Track or on a staff preview. A product added from a builder section carries the page and section
 * (`attribution.builder`). The first picture of the page loads first, every later one lazily.
 */

const envelope = (data: unknown) => ({ success: true, data, meta: { request_id: 'e2e' } })

const DOC = '01a1c9d9-0000-7000-8000-0000000000b5'
const MEDIA = '01a1c9d9-0000-7000-8000-000000000002'
const VISIBLE = { desktop: true, tablet: true, mobile: true }

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

const picture = (id: string, alt: string) => el(id, 'image', { media_id: MEDIA, alt, link: null, aspect: '16:9', fit: 'cover' })

const product = (slug: string, name: string) => ({
  id: `p-${slug}`, slug, name, url: `/product/${slug}`, image: { url: '/favicon.svg', alt: name }, hover_image: null, price: '120.00', price_max: '120.00',
  compare_at_price: null, on_sale: false, discount_percent: null, in_stock: true, is_new: false, is_featured: false, brand: null, category: null,
  variant_count: 1, default_variant_id: `v-${slug}`, short_description: null, promotion: null,
})

const payload = {
  document: { id: DOC, key: 'landing:b15', title: 'B15', version: 4, source: 'published' },
  sections: [
    section('s_hero', [el('e_title', 'heading', { text: 'Winter sale', level: 1, link: null }), picture('e_hero', 'Warm jackets')]),
    section('s_shop', [
      el('e_grid', 'product_grid', { title: 'Best sellers', subtitle: null, config: { source: 'best_sellers', category_id: null, limit: 8, columns: 4, view_all_url: null }, items: [] }),
    ], '48px'),
    section('s_gap', [el('e_gap', 'heading', { text: 'Made to keep you warm', level: 2, link: null })], '480px'),
    section('s_more', [picture('e_late', 'Scarves'), picture('e_last', 'Gloves')]),
  ],
  media: { [MEDIA]: { url: '/favicon.svg', srcset: '/favicon.svg 1600w', width: 1600, height: 900, alt: null } },
  data: {
    e_grid: { id: 'e_grid', type: 'product_grid', title: 'Best sellers', subtitle: null, config: { source: 'best_sellers', limit: 8, columns: 4, view_all_url: null }, products: [product('wool-hat', 'Wool Hat')] },
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
    footer: { about: null, copyright: null, contact: { email: null, phone: null, address: null }, social: {}, payment_logos: [] },
    custom_css: null,
  },
  menus: {},
}

const cart = (items: unknown[] = []) => ({ id: null, items, item_count: String(items.length), subtotal: '0.00', discount_total: '0.00', tax_total: '0.00', total: '0.00', prices_include_tax: true, currency: 'BDT', issues: [], promotions: [], free_shipping: null, coupon: null })

type Beacon = { document_id: string; version: number; path: string; device: string; seq: number; events: { t: string; node: string; el?: string; x?: number; y?: number }[]; scroll?: number; vitals?: Record<string, number> }

async function serve(page: Page) {
  const beacons: Beacon[] = []
  const cartAdds: Record<string, unknown>[] = []
  await page.route('**/api/v1/store/bootstrap*', (route) => route.fulfill({ json: envelope(bootstrap) }))
  await page.route('**/api/v1/store/builder/pages/b15*', (route) => route.fulfill({ json: envelope(payload) }))
  await page.route('**/api/v1/store/builder/popups*', (route) => route.fulfill({ json: envelope({ popups: [], never_on: [] }) }))
  await page.route('**/api/v1/store/account/me*', (route) => route.fulfill({ json: envelope(null) }))
  await page.route('**/api/v1/store/wishlist*', (route) => route.fulfill({ json: envelope({ items: [] }) }))
  await page.route('**/api/v1/store/visits*', (route) => route.fulfill({ json: envelope({ recorded: true }) }))
  await page.route(/\/api\/v1\/store\/cart(\/items)?(\?.*)?$/, (route) => {
    if (route.request().method() === 'POST') cartAdds.push(route.request().postDataJSON() as Record<string, unknown>)
    return route.fulfill({ json: envelope(cart()) })
  })
  await page.route('**/api/v1/store/insights/events*', (route) => {
    const request = route.request()
    // No cookie is ever needed (or sent by the fetch fallback); the body is plain JSON.
    beacons.push(JSON.parse(request.postData() ?? '{}') as Beacon)
    return route.fulfill({ status: 202, json: envelope({ recorded: true, accepted: 1, ignored: 0 }) })
  })
  return { beacons, cartAdds }
}

/** Ends the page view the way a closing tab does (pagehide). */
const leave = (page: Page) => page.evaluate("window.dispatchEvent(new Event('pagehide'))")

test('counts views, clicks, scroll and the device, and loads the first picture first', async ({ page, isMobile }) => {
  const { beacons } = await serve(page)
  await page.goto('/p/b15')
  await expect(page.getByRole('heading', { level: 1, name: 'Winter sale' })).toBeVisible()

  // §4: the first picture eager at high priority, later ones lazy; every one with its size reserved.
  const hero = page.getByRole('img', { name: 'Warm jackets' })
  await expect(hero).toHaveAttribute('fetchpriority', 'high')
  await expect(hero).toHaveAttribute('loading', 'eager')
  await expect(hero).toHaveAttribute('decoding', 'async')
  for (const name of ['Scarves', 'Gloves']) {
    const img = page.getByRole('img', { name })
    await expect(img).toHaveAttribute('loading', 'lazy')
    await expect(img).not.toHaveAttribute('fetchpriority', /.*/)
    await expect(img).toHaveAttribute('width', '1600')
    await expect(img).toHaveAttribute('height', '900')
  }

  // The hero is in view for more than a second; a click on the heading.
  await page.waitForTimeout(1300)
  const title = page.getByRole('heading', { level: 1, name: 'Winter sale' })
  await title.click({ position: { x: 5, y: 5 } })

  // Down to the end of the page: the last section in view for more than a second.
  await page.locator('[data-b="s_more"]').scrollIntoViewIfNeeded()
  await page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)')
  await page.waitForTimeout(1300)
  expect(beacons).toEqual([])

  await leave(page)
  await expect.poll(() => beacons.length).toBe(1)
  const [beacon] = beacons
  expect(beacon).toMatchObject({ document_id: DOC, version: 4, path: '/p/b15', device: isMobile ? 'mobile' : 'desktop', seq: 0, scroll: 100 })
  const views = beacon!.events.filter((e) => e.t === 'view').map((e) => e.node)
  expect(views).toContain('s_hero')
  expect(views).toContain('s_more')
  expect(new Set(views).size).toBe(views.length)
  const click = beacon!.events.find((e) => e.t === 'click')!
  expect(click).toMatchObject({ node: 's_hero', el: 'e_title' })
  expect(click.x).toBeGreaterThanOrEqual(0)
  expect(click.x).toBeLessThan(0.5)
  expect(click.y).toBeGreaterThanOrEqual(0)
  expect(click.y).toBeLessThan(0.5)
  // Nothing personal: only the contract's fields.
  expect(Object.keys(beacon!).filter((key) => key !== 'vitals').sort()).toEqual(['device', 'document_id', 'events', 'path', 'scroll', 'seq', 'version'])
  if (beacon!.vitals) expect(Object.keys(beacon!.vitals).every((key) => ['lcp_ms', 'cls', 'inp_ms'].includes(key))).toBe(true)

  // Scroll and vitals go once per page view.
  await leave(page)
  await page.waitForTimeout(300)
  expect(beacons).toHaveLength(1)
  const cookies = await page.context().cookies()
  expect(cookies.filter((cookie) => /insight|track|visitor/i.test(cookie.name))).toEqual([])
})

test('a product added from a builder section carries the page and the section', async ({ page, isMobile }) => {
  const { cartAdds } = await serve(page)
  await page.goto('/p/b15')
  const grid = page.locator('[data-b="e_grid"]')
  await grid.getByRole('button', { name: 'Add Wool Hat to the cart' }).click()
  await expect.poll(() => cartAdds.length).toBe(1)
  expect(cartAdds[0]).toEqual({ variant_id: 'v-wool-hat', quantity: '1', attribution: { builder: { document_id: DOC, node_id: 's_shop', device: isMobile ? 'mobile' : 'desktop' } } })
  const stored = await page.evaluate("JSON.parse(sessionStorage.getItem('sf.builder-attribution') ?? 'null')")
  expect(stored).toMatchObject({ document_id: DOC, node_id: 's_shop' })
})

for (const [name, init] of [
  ['Global Privacy Control', "Object.defineProperty(navigator, 'globalPrivacyControl', { get: () => true })"],
  ['Do Not Track', "Object.defineProperty(navigator, 'doNotTrack', { get: () => '1' })"],
] as const) {
  test(`sends nothing and remembers nothing with ${name}`, async ({ page }) => {
    await page.addInitScript({ content: init })
    const { beacons, cartAdds } = await serve(page)
    await page.goto('/p/b15')
    await expect(page.getByRole('heading', { level: 1, name: 'Winter sale' })).toBeVisible()
    await page.waitForTimeout(1300)
    await page.locator('[data-b="e_grid"]').getByRole('button', { name: 'Add Wool Hat to the cart' }).click()
    await expect.poll(() => cartAdds.length).toBe(1)
    expect(cartAdds[0]).toEqual({ variant_id: 'v-wool-hat', quantity: '1' })
    await leave(page)
    await page.waitForTimeout(500)
    expect(beacons).toEqual([])
  })
}

test('sends nothing on a staff draft preview', async ({ page }) => {
  const { beacons } = await serve(page)
  await page.goto('/p/b15?preview=draft')
  await expect(page.getByRole('heading', { level: 1, name: 'Winter sale' })).toBeVisible()
  await page.waitForTimeout(1300)
  await page.getByRole('heading', { level: 1, name: 'Winter sale' }).click()
  await leave(page)
  await page.waitForTimeout(500)
  expect(beacons).toEqual([])
})
