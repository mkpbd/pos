import { expect, test, type Page, type Route } from '@playwright/test'

/*
 * Store builder B20 §3 on a mocked store: the store-wide add-to-cart effects (theme `effects`) —
 * `fly` sends a small copy of the product picture from the button to the header cart (at 1366 px
 * and on a 375 px phone), which then bumps; `bump` only bumps; `none` does neither; reduced motion
 * never flies — and the moving backgrounds (`style.base.background_fx`): decorative, running only
 * on screen, stopped by "Pause animations" and by reduced motion. Never a horizontal scroll.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const VISIBLE = { desktop: true, tablet: true, mobile: true }

type Effects = { add_to_cart: 'fly' | 'bump' | 'none'; button_feedback: boolean }

const bootstrap = (effects: Effects) => ({
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
    effects,
  },
  menus: { main: { name: 'Main', items: [] } },
})

const capCard = {
  id: 'p-kids-cap', slug: 'kids-cap', name: 'Kids Cap', url: '/product/kids-cap', image: { url: '/favicon.svg', alt: 'Kids Cap' }, hover_image: null,
  price: '350.00', price_max: '350.00', compare_at_price: null, on_sale: false, discount_percent: null, in_stock: true, is_new: false, is_featured: false,
  brand: null, category: { name: 'Clothing', slug: 'clothing' }, variant_count: 1, default_variant_id: 'v-cap', short_description: null, promotion: null,
}

const tee = {
  id: 'p-kids-tee', slug: 'kids-tee', name: 'Kids Tee', url: '/product/kids-tee', short_description: 'Soft cotton tee.',
  description_html: null, specifications: [], brand: null, category: { name: 'Clothing', slug: 'clothing' },
  breadcrumbs: [{ name: 'Home', url: '/' }, { name: 'Kids Tee', url: null }],
  images: [{ id: 'img-1', url: '/favicon.svg', alt: 'Kids tee' }],
  options: [],
  variants: [{ id: 'v-tee', sku: 'TEE', name: 'Default', option_values: {}, price: '450.00', compare_at_price: null, on_sale: false, discount_percent: null, in_stock: true, low_stock: false, image_id: null, promo_price: null }],
  price: '450.00', price_max: '450.00', on_sale: false, in_stock: true, is_new: false, default_variant_id: 'v-tee', unit: 'pcs', promotion: null,
  seo: { title: null, description: null, image_url: null },
}

function cartBody(count: number) {
  const total = (count * 350).toFixed(2)
  return {
    id: count > 0 ? 'cart-1' : null,
    items: Array.from({ length: count }, (_, i) => ({
      id: `l-${i + 1}`, variant_id: 'v-cap', product: { slug: 'kids-cap', name: 'Kids Cap', url: '/product/kids-cap', image: { url: '/favicon.svg', alt: 'Kids Cap' } },
      variant_name: null, option_values: {}, sku: 'CAP', quantity: '1', unit_price: '350.00', compare_at_price: null, line_total: '350.00', purchasable: true, in_stock: true,
      max_quantity: null, exceeds_stock: false, allow_decimal: false, discount_amount: '0.00', promotion: null,
    })),
    item_count: String(count), subtotal: total, discount_total: '0.00', tax_total: '0.00', total, prices_include_tax: true, currency: 'BDT', issues: [],
    promotions: [], free_shipping: null, coupon: null,
  }
}

/* A builder page with two moving backgrounds, the second far below the fold. */
function section(id: string, text: string, fx: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: 'section',
    props: { layout: 'boxed', anchor: null },
    style: { base: { spacing: { padding: { top: '80px', bottom: '80px' } }, size: { min_height: '420px' }, background: { type: 'color', color: '#1e293b' }, color: '#ffffff', background_fx: fx, ...extra } },
    visibility: VISIBLE,
    columns: [{ id: `c_${id}`, type: 'column', width: { base: 100 }, style: {}, elements: [{ id: `e_${id}`, type: 'heading', props: { text, level: 2, link: null }, style: {}, visibility: VISIBLE }] }],
  }
}
const gap = { id: 's_gap', type: 'section', props: { layout: 'boxed', anchor: null }, style: { base: { size: { min_height: '1600px' } } }, visibility: VISIBLE, columns: [{ id: 'c_gap', type: 'column', width: { base: 100 }, style: {}, elements: [] }] }
const fxPage = {
  document: { id: '0199a5c1-0000-7000-8000-000000000b20', key: 'landing:b20', title: 'Winter sale', version: 1, source: 'published', seo: null },
  sections: [section('s_snow', 'Winter sale', { type: 'snow', density: 'high' }), gap, section('s_bubbles', 'Fresh deals', { type: 'bubbles', speed: 'normal' })],
  media: {},
  data: {},
}

async function serve(page: Page, effects: Effects = { add_to_cart: 'fly', button_feedback: true }) {
  let count = 0
  // Every played effect, and every flight: where it started and where its last keyframe lands (viewport px).
  await page.addInitScript(`
    window.__effects = []
    window.__flights = []
    document.addEventListener('sf-cart-effect', (event) => window.__effects.push(event.detail.effect))
    new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement) || !node.classList.contains('sf-fly')) continue
        const animation = node.getAnimations()[0]
        const frames = animation ? animation.effect.getKeyframes() : []
        const last = frames.length ? String(frames[frames.length - 1].transform) : ''
        const match = /translate\\((-?[\\d.]+)px, (-?[\\d.]+)px\\)/.exec(last)
        const box = node.getBoundingClientRect()
        window.__flights.push({
          src: node.getAttribute('src'),
          hidden: node.getAttribute('aria-hidden'),
          duration: animation ? animation.effect.getTiming().duration : 0,
          start: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
          end: match ? { x: box.left + box.width / 2 + Number(match[1]), y: box.top + box.height / 2 + Number(match[2]) } : null,
        })
      }
    }).observe(document, { childList: true, subtree: true })
  `)
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/store/'),
    async (route: Route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname.replace('/api/v1', '')
      const key = `${request.method()} ${path}`
      switch (key) {
        case 'GET /store/bootstrap':
          return route.fulfill({ json: envelope(bootstrap(effects)) })
        case 'GET /store/account/me':
          return route.fulfill({ json: envelope(null) })
        case 'GET /store/wishlist':
          return route.fulfill({ json: envelope({ items: [] }) })
        case 'GET /store/cart':
          return route.fulfill({ json: envelope(cartBody(count)) })
        case 'POST /store/cart/items':
          count += 1
          return route.fulfill({ json: envelope(cartBody(count)) })
        case 'GET /store/products':
          return route.fulfill({ json: { success: true, data: [capCard], meta: { request_id: 'e2e', current_page: 1, per_page: 24, total: 1, last_page: 1 }, facets: null, context: null } })
        case 'GET /store/products/kids-tee':
          return route.fulfill({ json: envelope(tee) })
        case 'GET /store/products/kids-tee/related':
          return route.fulfill({ json: envelope({ related: [], frequently_bought: [] }) })
        case 'GET /store/builder/pages/b20':
          return route.fulfill({ json: envelope(fxPage) })
        case 'GET /store/builder/popups':
          return route.fulfill({ json: envelope({ popups: [], never_on: [] }) })
      }
      if (request.method() === 'POST') return route.fulfill({ status: 204, body: '' })
      return route.fulfill({ status: 404, json: { success: false, error: { code: 'NOT_FOUND', message: `No mock for ${key}`, details: {} }, meta: { request_id: 'e2e' } } })
    },
  )
}

type Flight = { src: string | null; hidden: string | null; duration: number; start: { x: number; y: number }; end: { x: number; y: number } | null }

const flights = (page: Page) => page.evaluate<Flight[]>('window.__flights')
const played = (page: Page) => page.evaluate<string[]>('window.__effects')
const noHorizontalScroll = (page: Page) => page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth')
/** The centre of the header's cart (the flight's destination). */
const cartCentre = (page: Page) =>
  page.evaluate<{ x: number; y: number }>(`(() => { const r = document.querySelector('[data-testid="site-header"] [data-sf-cart-target]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
const bumps = (page: Page) => page.evaluate<string | null>(`document.querySelector('[data-testid="site-header"] [data-sf-cart-target]').getAttribute('data-sf-bumps')`)

async function expectFlightToCart(page: Page, from: { x: number; y: number }) {
  await expect.poll(async () => (await flights(page)).length).toBe(1)
  const [flight] = await flights(page)
  expect(flight!.src).toBe('/favicon.svg')
  expect(flight!.hidden).toBe('true')
  expect(flight!.duration).toBe(600)
  // It starts on the button and lands on the cart.
  expect(Math.abs(flight!.start.x - from.x)).toBeLessThan(2)
  expect(Math.abs(flight!.start.y - from.y)).toBeLessThan(2)
  const cart = await cartCentre(page)
  expect(Math.abs(flight!.end!.x - cart.x)).toBeLessThan(2)
  expect(Math.abs(flight!.end!.y - cart.y)).toBeLessThan(2)
  // Then it is gone and the cart bumps.
  await expect(page.locator('.sf-fly')).toHaveCount(0)
  await expect.poll(() => bumps(page)).toBe('1')
}

const centreOf = async (locator: ReturnType<Page['locator']>) => {
  const box = (await locator.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

for (const [label, width] of [
  ['1366 px', 1366],
  ['375 px', 375],
] as const) {
  test(`B20 fly at ${label}: from a product card to the header cart, the mini-cart opens at once`, async ({ page, isMobile }) => {
    test.skip(isMobile !== (width === 375), 'one layout per project')
    await page.setViewportSize({ width, height: 860 })
    await serve(page)
    await page.goto('/shop')
    await expect(page.getByRole('button', { name: 'Add Kids Cap to the cart' })).toBeVisible()
    // By CSS: once the mini-cart (a modal) opens, the page behind it leaves the accessibility tree.
    const add = page.locator('button[aria-label="Add Kids Cap to the cart"]')
    await add.scrollIntoViewIfNeeded()
    const from = await centreOf(add)
    await add.click()
    // The mini-cart does not wait for the flight.
    await expect(page.getByRole('dialog', { name: /Your cart/ })).toBeVisible({ timeout: 2000 })
    // Button feedback: a brief check over the button.
    await expect(add.getByTestId('added-mark')).toHaveCount(1)
    await expectFlightToCart(page, from)
    expect(await played(page)).toEqual(['fly'])
    await expect(page.getByTestId('cart-count').first()).toHaveText('1')
    expect(await noHorizontalScroll(page)).toBe(true)
  })

  test(`B20 fly at ${label}: from the product page to the header cart`, async ({ page, isMobile }) => {
    test.skip(isMobile !== (width === 375), 'one layout per project')
    await page.setViewportSize({ width, height: 860 })
    await serve(page)
    await page.goto('/product/kids-tee')
    await expect(page.getByRole('form', { name: 'Add to cart' }).getByRole('button', { name: 'Add to cart' })).toBeVisible()
    const add = page.locator('[data-testid="add-to-cart"] button[type="submit"]')
    await add.scrollIntoViewIfNeeded()
    const sizeBefore = await add.boundingBox()
    const from = await centreOf(add)
    await add.click()
    await expect(page.getByRole('dialog', { name: /Your cart/ })).toBeVisible({ timeout: 2000 })
    // "Added" without changing the button's size.
    await expect(add.getByTestId('added-mark')).toHaveCount(1)
    const sizeAfter = await add.boundingBox()
    expect(Math.round(sizeAfter!.width)).toBe(Math.round(sizeBefore!.width))
    expect(Math.round(sizeAfter!.height)).toBe(Math.round(sizeBefore!.height))
    await expectFlightToCart(page, from)
    expect(await noHorizontalScroll(page)).toBe(true)
  })
}

test('B20 bump only: no flight, the cart bumps', async ({ page, isMobile }) => {
  test.skip(isMobile, 'one run is enough')
  await page.setViewportSize({ width: 1366, height: 860 })
  await serve(page, { add_to_cart: 'bump', button_feedback: false })
  await page.goto('/shop')
  await page.getByRole('button', { name: 'Add Kids Cap to the cart' }).click()
  await expect(page.getByRole('dialog', { name: /Your cart/ })).toBeVisible()
  await expect.poll(() => bumps(page)).toBe('1')
  expect(await flights(page)).toEqual([])
  expect(await played(page)).toEqual(['bump'])
  await expect(page.getByTestId('added-mark')).toHaveCount(0)
})

test('B20 none: neither flight nor bump, the count still updates', async ({ page, isMobile }) => {
  test.skip(isMobile, 'one run is enough')
  await page.setViewportSize({ width: 1366, height: 860 })
  await serve(page, { add_to_cart: 'none', button_feedback: true })
  await page.goto('/shop')
  await page.getByRole('button', { name: 'Add Kids Cap to the cart' }).click()
  await expect(page.getByRole('dialog', { name: /Your cart/ })).toBeVisible()
  await expect(page.getByTestId('cart-count').first()).toHaveText('1')
  expect(await played(page)).toEqual(['none'])
  expect(await flights(page)).toEqual([])
  expect(await bumps(page)).toBeNull()
})

test('B20 reduced motion: a fly theme never flies', async ({ page, isMobile }) => {
  test.skip(isMobile, 'one run is enough')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1366, height: 860 })
  await serve(page, { add_to_cart: 'fly', button_feedback: true })
  await page.goto('/shop')
  await page.getByRole('button', { name: 'Add Kids Cap to the cart' }).click()
  await expect(page.getByRole('dialog', { name: /Your cart/ })).toBeVisible()
  await expect(page.getByTestId('cart-count').first()).toHaveText('1')
  expect(await played(page)).toEqual(['none'])
  expect(await flights(page)).toEqual([])
  expect(await bumps(page)).toBeNull()
})

/* ------------------------------------------------------------------------------------------ */

const layerState = (page: Page, id: string) => page.locator(`[data-b="${id}"] > [data-testid="builder-bg-fx"]`).getAttribute('data-state')
const playState = (page: Page, id: string) =>
  page.evaluate<string>(`getComputedStyle(document.querySelector('[data-b="${id}"] .b-fx-p')).animationPlayState`)

for (const [label, width] of [
  ['1366 px', 1366],
  ['375 px', 375],
] as const) {
  test(`B20 moving backgrounds at ${label}: decorative, paused off screen and with Pause`, async ({ page, isMobile }) => {
    test.skip(isMobile !== (width === 375), 'one layout per project')
    await page.setViewportSize({ width, height: 860 })
    await serve(page)
    await page.goto('/p/b20')
    await expect(page.getByRole('heading', { name: 'Winter sale' })).toBeVisible()

    const snow = page.locator('[data-b="s_snow"] > [data-testid="builder-bg-fx"]')
    await expect(snow).toHaveAttribute('aria-hidden', 'true')
    await expect(snow).toHaveAttribute('data-ready', '')
    expect(await page.evaluate<string>(`getComputedStyle(document.querySelector('[data-b="s_snow"] > [data-testid="builder-bg-fx"]')).pointerEvents`)).toBe('none')
    await expect(snow.locator('canvas')).toHaveCount(0)
    // High density: 28 at most; phones draw every second one.
    const drawn = await page.evaluate<number>(`[...document.querySelectorAll('[data-b="s_snow"] .b-fx-p')].filter((node) => getComputedStyle(node).display !== 'none').length`)
    expect(drawn).toBe(width === 375 ? 14 : 28)
    // The heading sits above the layer and is still reachable.
    await page.getByRole('heading', { name: 'Winter sale' }).click()

    // On screen: running; the bubbles far below: paused until scrolled to, then the snow pauses.
    await expect.poll(() => layerState(page, 's_snow')).toBe('running')
    expect(await playState(page, 's_snow')).toBe('running')
    await expect.poll(() => layerState(page, 's_bubbles')).toBe('paused')
    expect(await playState(page, 's_bubbles')).toBe('paused')
    await page.locator('[data-b="s_bubbles"]').scrollIntoViewIfNeeded()
    await expect.poll(() => layerState(page, 's_bubbles')).toBe('running')
    await expect.poll(() => layerState(page, 's_snow')).toBe('paused')

    // "Pause animations" stops it (long motion), and it is remembered.
    await page.getByRole('button', { name: 'Pause animations' }).click()
    await expect.poll(() => layerState(page, 's_bubbles')).toBe('paused')
    expect(await playState(page, 's_bubbles')).toBe('paused')
    await page.getByRole('button', { name: 'Play animations' }).click()
    await expect.poll(() => layerState(page, 's_bubbles')).toBe('running')

    expect(await noHorizontalScroll(page)).toBe(true)
  })
}

test('B20 moving backgrounds with reduced motion: a still frame, no Pause toggle', async ({ page, isMobile }) => {
  test.skip(isMobile, 'one run is enough')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1366, height: 860 })
  await serve(page)
  await page.goto('/p/b20')
  await expect(page.getByRole('heading', { name: 'Winter sale' })).toBeVisible()
  await expect.poll(() => layerState(page, 's_snow')).toBe('paused')
  expect(await playState(page, 's_snow')).toBe('paused')
  // Still spread out over the section (the negative delays), not piled at the top.
  const tops = await page.locator('[data-b="s_snow"] .b-fx-p').evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)))
  expect(new Set(tops).size).toBeGreaterThan(10)
  await expect(page.getByTestId('motion-pause-toggle')).toHaveCount(0)
  expect(await noHorizontalScroll(page)).toBe(true)
})
