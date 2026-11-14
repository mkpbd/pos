import { expect, test, type Page } from '@playwright/test'

/**
 * P1b product page on a mocked store, at 1366 px (desktop project) and 375 px (mobile project):
 * Buy now, the delivery and cash-on-delivery note, owner badges, the `product.below_price` zone, the
 * quick-buy bar (appears once the buy area scrolls away, sits above a cookie bar, keeps the end of
 * the page reachable), the gallery (side thumbnails, swipe, click-to-load video, lightbox zoom with
 * buttons, keys, wheel, double tap and pinch), "Frequently bought together" and questions & answers.
 * No horizontal page scroll at either width.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const VISIBLE = { desktop: true, tablet: true, mobile: true }

const theme = (product: Record<string, unknown> = {}) => ({
  colors: {
    primary: '#f59e0b', primary_foreground: '#3b2500', accent: '#6f55c2', accent_foreground: '#ffffff', highlight: '#2fb79a',
    sale: '#c2410c', heading: '#3d3d3d', text: '#5f6368', canvas: '#f3f7fa', surface: '#ffffff', border: '#e1e1e1',
  },
  typography: { heading_font: 'baloo', body_font: 'poppins' },
  shape: { button_style: 'pill', card_radius: 12 },
  layout: { container_width: 1170, sticky_header: true, product: { gallery: 'left', thumbnails: 'bottom', sticky_summary: false, details: 'tabs', ...product } },
  logo: null,
  favicon: null,
  announcement: null,
  footer: { about: 'Clothes and toys for little ones.', copyright: '© Berry Kids', contact: { email: null, phone: null, address: null }, social: {}, payment_logos: [] },
  custom_css: null,
})

const bootstrap = (product: Record<string, unknown> = {}, store: Record<string, unknown> = {}) => ({
  store: { name: 'Berry Kids', description: 'Clothes and toys for little ones', prices_include_tax: true, currency: 'BDT', ...store },
  preview: false,
  builder: { home: false },
  theme: theme(product),
  menus: { main: { name: 'Main', items: [{ id: 'n-1', label: 'Shop', url: '/shop', open_in_new_tab: false, is_mega: false, mega_columns: null, image: null, children: [] }] } },
})

/** Product photos: 1200 px squares (a real photo's size), served by the mock below. */
const photo = (name: string) => `/e2e-photos/${name}.svg`
const PHOTO_COLOURS = ['#fde68a', '#bfdbfe', '#fecaca', '#bbf7d0', '#e9d5ff']
const photoSvg = (name: string) => {
  const fill = PHOTO_COLOURS[[...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % PHOTO_COLOURS.length]
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200"><rect width="1200" height="1200" fill="${fill}"/><circle cx="600" cy="600" r="320" fill="#6f55c2"/><rect x="120" y="120" width="160" height="160" fill="#3d3d3d"/></svg>`
}

const section = (id: string, elements: { id: string; type: string; props: Record<string, unknown> }[]) => ({
  id,
  type: 'section',
  props: { layout: 'boxed', anchor: null },
  style: {},
  visibility: VISIBLE,
  columns: [{ id: `c_${id}`, type: 'column', width: { base: 100 }, style: {}, elements: elements.map((e) => ({ ...e, style: {}, visibility: VISIBLE })) }],
})

const zone = (key: string, text: string) => ({
  document: { id: `0199a5c1-0000-7000-8000-00000000${key.length.toString().padStart(4, '0')}`, key: `zone:${key}`, title: key, version: 1, source: 'published' },
  sections: [section(`s_${key.replace('.', '_')}`, [{ id: `e_${key.replace('.', '_')}`, type: 'heading', props: { text, level: 3, link: null } }])],
  media: {},
  data: {},
})

const images = ['red-1', 'red-2', 'blue-1', 'blue-2'].map((id) => ({ id, url: photo(id), alt: `Kids Tee ${id}` }))

const variant = (id: string, colour: string, size: string, extra: Record<string, unknown> = {}) => ({
  id, sku: `TEE-${colour[0]}${size}`, name: `${colour} / ${size}`, option_values: { Colour: colour, Size: size }, price: '450.00', compare_at_price: null,
  on_sale: false, discount_percent: null, in_stock: true, low_stock: false, stock_left: null, image_id: null, promo_price: null, ...extra,
})

const tee = {
  id: 'p-kids-tee', slug: 'kids-tee', name: 'Kids Tee', url: '/product/kids-tee', short_description: 'Soft cotton tee for everyday play.',
  description_html: `<p>${'Made from organic cotton that stays soft wash after wash. '.repeat(12)}</p>`,
  specifications: [{ label: 'Material', value: 'Cotton' }], brand: null, category: { name: 'Clothing', slug: 'clothing' },
  breadcrumbs: [{ name: 'Home', url: '/' }, { name: 'Clothing', url: '/category/clothing' }, { name: 'Kids Tee', url: null }],
  images,
  options: [
    { name: 'Colour', slug: 'colour', display: 'swatch', values: [{ value: 'Red', swatch_hex: '#e11d48', image_ids: [] }, { value: 'Blue', swatch_hex: '#2563eb', image_ids: [] }] },
    { name: 'Size', slug: 'size', display: 'button', values: ['M', 'L'].map((value) => ({ value, swatch_hex: null, image_ids: [] })) },
  ],
  variants: [variant('v-red-m', 'Red', 'M'), variant('v-red-l', 'Red', 'L'), variant('v-blue-l', 'Blue', 'L', { price: '480.00', image_id: 'blue-1' })],
  price: '450.00', price_max: '480.00', on_sale: false, in_stock: true, is_new: true, default_variant_id: 'v-red-m', unit: 'pcs', promotion: null,
  seo: { title: null, description: null, image_url: null },
  video: { provider: 'youtube', id: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
  badges: [{ text: 'Best seller', tone: 'dark' }],
  delivery: {
    options: [
      { zone: 'Inside Dhaka', method: 'Home delivery', min_days: 1, max_days: 2, fee: '60.00', free_over: '2000.00' },
      { zone: 'Outside Dhaka', method: null, min_days: 3, max_days: 5, fee: '120.00', free_over: null },
    ],
    cod_available: true,
  },
  zones: { 'product.below_price': zone('product.below_price', 'Free gift wrap on every order'), 'product.after': null, 'product.bottom': zone('product.bottom', 'Happy kids, happy parents') },
  questions_count: 1,
}

const card = (slug: string, name: string, price: string, extra: Record<string, unknown> = {}) => ({
  id: `p-${slug}`, slug, name, url: `/product/${slug}`, image: { url: photo(slug), alt: name }, hover_image: null, price, price_max: price,
  compare_at_price: null, on_sale: false, discount_percent: null, in_stock: true, is_new: false, is_featured: false, brand: null,
  category: { name: 'Clothing', slug: 'clothing' }, variant_count: 1, default_variant_id: `v-${slug}`, short_description: null, promotion: null, badges: [], ...extra,
})

const COOKIE_ID = '0199a5c1-0000-7000-8000-0000000c0c1e'
const cookieBar = {
  id: COOKIE_ID,
  version: 1,
  settings: {
    layout: 'bar_bottom', position: 'bottom_right', width: 'md', overlay: false, close_on_overlay: false, label: 'Cookie notice',
    trigger: { kind: 'on_load', delay_seconds: 0, scroll_percent: 50 }, frequency: { kind: 'once_forever', days: 7 }, stop_after_action: true,
    pages: { kind: 'all', paths: [] }, devices: 'all', audience: 'all', priority: 10,
  },
  payload: { sections: [section('s_cookie', [{ id: 'e_ck_t', type: 'text', props: { html: '<p>We only use the cookies the shop needs to work.</p>' } }])], media: {}, data: {} },
}

const cart = (count: number) => ({
  id: count ? 'cart-1' : null, items: [], item_count: String(count), subtotal: '0.00', discount_total: '0.00', tax_total: '0.00', total: '0.00',
  prices_include_tax: true, currency: 'BDT', issues: [], promotions: [], free_shipping: null, coupon: null,
})

const question = { id: 'q-1', name: 'Rina A.', question: 'Is the colour fast in the wash?', answer: 'Yes — wash it inside out in cold water.', asked_at: '2026-11-01T10:00:00Z', answered_at: '2026-11-02T09:00:00Z' }

type Served = { adds: unknown[]; asked: unknown[]; providerRequests: string[] }

async function serve(page: Page, options: { product?: Record<string, unknown>; store?: Record<string, unknown>; popups?: unknown[] } = {}): Promise<Served> {
  const served: Served = { adds: [], asked: [], providerRequests: [] }
  page.on('request', (request) => {
    if (/youtube|vimeo/.test(new URL(request.url()).hostname)) served.providerRequests.push(request.url())
  })
  // Anything not mocked below answers 404 (registered first: later routes win).
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 404, json: { success: false, error: { code: 'NOT_FOUND', message: 'Not mocked', details: {} }, meta: { request_id: 'e2e' } } }))
  await page.route(/youtube-nocookie\.com|player\.vimeo\.com/, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>player</title><p>player</p>' }))
  await page.route('**/e2e-photos/*', (route) => route.fulfill({ contentType: 'image/svg+xml', body: photoSvg(new URL(route.request().url()).pathname) }))
  await page.route('**/api/v1/store/bootstrap*', (route) => route.fulfill({ json: envelope(bootstrap(options.product, options.store)) }))
  await page.route('**/api/v1/store/account/me*', (route) => route.fulfill({ json: envelope(null) }))
  await page.route('**/api/v1/store/wishlist*', (route) => route.fulfill({ json: envelope({ items: [] }) }))
  await page.route('**/api/v1/store/builder/popups*', (route) => route.fulfill({ json: envelope({ popups: options.popups ?? [], never_on: ['/checkout', '/cart'] }) }))
  await page.route(/\/api\/v1\/store\/cart(\?.*)?$/, (route) => route.fulfill({ json: envelope(cart(served.adds.length)) }))
  await page.route('**/api/v1/store/cart/items*', (route) => {
    served.adds.push(route.request().postDataJSON())
    return route.fulfill({ json: envelope(cart(served.adds.length)) })
  })
  await page.route('**/api/v1/store/products/kids-tee*', (route) => route.fulfill({ json: envelope(tee) }))
  await page.route('**/api/v1/store/products/kids-tee/related*', (route) =>
    route.fulfill({
      json: envelope({
        related: [card('kids-shorts', 'Kids Shorts', '350.00', { badges: [{ text: 'Eid offer', tone: 'sale' }] })],
        frequently_bought: [card('kids-socks', 'Kids Socks', '80.50'), card('kids-cap', 'Kids Cap', '150.00')],
        frequently_bought_source: 'automatic',
      }),
    }),
  )
  await page.route('**/api/v1/store/products/kids-tee/reviews*', (route) =>
    route.fulfill({ json: { success: true, data: [], meta: { request_id: 'e2e', summary: { average: '0.0', count: 0, distribution: {} } } } }),
  )
  await page.route('**/api/v1/store/products/kids-tee/questions*', (route) => {
    if (route.request().method() === 'POST') {
      served.asked.push(route.request().postDataJSON())
      return route.fulfill({ status: 202, json: envelope({ message: 'Thanks — your question will appear once we answer it.' }) })
    }
    return route.fulfill({ json: envelope([question], { pagination: { current_page: 1, per_page: 10, total: 1, last_page: 1 } }) })
  })
  return served
}

const noSideScroll = (page: Page) => page.locator('html').evaluate((el) => el.scrollWidth <= el.clientWidth)

test.beforeEach(async ({ page, isMobile }) => {
  await page.setViewportSize(isMobile ? { width: 375, height: 812 } : { width: 1366, height: 768 })
})

test('buy now, the delivery note, badges and the below-price zone', async ({ page }) => {
  const served = await serve(page)
  await page.goto('/product/kids-tee')
  await expect(page.getByRole('heading', { level: 1, name: 'Kids Tee' })).toBeVisible()

  const note = page.getByTestId('delivery-note')
  await expect(note.getByTestId('delivery-option')).toHaveText(['Inside Dhaka: 1–2 days · ৳60 · free over ৳2,000', 'Outside Dhaka: 3–5 days · ৳120'])
  await expect(note.getByTestId('cod-note')).toHaveText('Cash on delivery available')
  await expect(page.getByTestId('builder-zone-product.below_price').getByRole('heading', { name: 'Free gift wrap on every order' })).toBeVisible()
  const badge = page.getByTestId('product-gallery').getByText('Best seller')
  await expect(badge).toBeVisible()
  await expect(badge).toHaveCSS('color', 'rgb(255, 255, 255)')

  const form = page.getByRole('form', { name: 'Add to cart' })
  const add = form.getByRole('button', { name: 'Add to cart' })
  const buy = form.getByRole('button', { name: 'Buy now' })
  await expect(buy).toBeVisible()
  // Both are comfortable touch targets, side by side or stacked, never cut off.
  for (const button of [add, buy]) {
    const box = (await button.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  }
  expect(await noSideScroll(page)).toBe(true)

  await form.getByRole('button', { name: 'Increase: Quantity of Kids Tee' }).click()
  await buy.click()
  await expect(page).toHaveURL(/\/checkout$/)
  expect(served.adds).toEqual([{ variant_id: 'v-red-m', quantity: '2' }])
})

test('the quick-buy bar appears once the buy area scrolls away and never covers the cookie bar', async ({ page, isMobile }) => {
  const served = await serve(page, { popups: [cookieBar] })
  await page.goto('/product/kids-tee')
  const cookie = page.getByRole('region', { name: 'Cookie notice' })
  await expect(cookie).toBeVisible()
  const bar = page.getByTestId('quick-buy')
  await expect(page.getByRole('region', { name: 'Quick buy' })).toHaveCount(0)

  // Scroll to the end of the page: the bar slides in above the cookie bar.
  await page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)')
  const region = page.getByRole('region', { name: 'Quick buy' })
  await expect(region).toBeVisible()
  await expect.poll(() => bar.evaluate((el) => el.ownerDocument.defaultView?.getComputedStyle(el).transform)).toBe('none')
  const viewport = page.viewportSize()!
  const barBox = (await bar.boundingBox())!
  const cookieBox = (await cookie.boundingBox())!
  expect(barBox.y + barBox.height).toBeLessThanOrEqual(cookieBox.y + 1)
  expect(barBox.width).toBeLessThanOrEqual(viewport.width)
  await expect(region.getByText('Red / M')).toBeVisible()
  await expect(region.getByTestId('quick-buy-price')).toHaveText('৳450.00')
  // The end of the page stays reachable above both bars.
  await page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)')
  const footer = (await page.getByText('© Berry Kids').boundingBox())!
  expect(footer.y + footer.height).toBeLessThanOrEqual(barBox.y + 1)
  expect(await noSideScroll(page)).toBe(true)
  // Phones: one compact bar (two rows at most), every button a 44 px target.
  if (isMobile) expect(barBox.height).toBeLessThanOrEqual(130)
  for (const button of await region.getByRole('button').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(32)
  await expect(region.getByRole('button', { name: 'Add to cart' })).toHaveCSS('min-height', '44px')

  // The bar adds the same line as the form; the mini-cart opens and focus comes back to the bar.
  await region.getByRole('button', { name: 'Increase: Quantity of Kids Tee' }).click()
  await region.getByRole('button', { name: 'Add to cart' }).click()
  const drawer = page.getByRole('dialog', { name: /Your cart/ })
  await expect(drawer).toBeVisible()
  expect(served.adds).toEqual([{ variant_id: 'v-red-m', quantity: '2' }])
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  await expect(region.getByRole('button', { name: 'Add to cart' })).toBeFocused()

  // Back at the top the bar hides (and leaves the accessibility tree).
  await page.evaluate('window.scrollTo(0, 0)')
  await expect(bar).toBeHidden()
  await expect(bar).toHaveAttribute('aria-hidden', 'true')

  // Buy now from the bar.
  await page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)')
  await region.getByRole('button', { name: 'Buy now' }).click()
  await expect(page).toHaveURL(/\/checkout$/)
  expect(served.adds).toHaveLength(2)
})

test('gallery: side thumbnails, swipe, a video that loads on play, and lightbox zoom', async ({ page, isMobile }) => {
  const served = await serve(page, { product: { thumbnails: 'side', gallery: 'right' } })
  await page.goto('/product/kids-tee')
  const gallery = page.getByTestId('product-gallery')
  const thumbs = gallery.getByRole('list', { name: 'Product images' })
  const main = gallery.getByRole('button', { name: 'Open Kids Tee, image 1 of 4 full screen' })
  await expect(main).toBeVisible()
  const mainBox = (await main.boundingBox())!
  const thumbsBox = (await thumbs.boundingBox())!
  const summaryBox = (await page.getByTestId('product-summary').boundingBox())!
  if (isMobile) {
    // Phones: thumbnails under the photo, the gallery above the details.
    expect(thumbsBox.y).toBeGreaterThan(mainBox.y + mainBox.height - 1)
    expect(summaryBox.y).toBeGreaterThan(mainBox.y)
  } else {
    // Desktop: a strip on the photo's left, the gallery on the right of the details.
    expect(thumbsBox.x + thumbsBox.width).toBeLessThanOrEqual(mainBox.x + 1)
    expect(thumbsBox.height).toBeLessThanOrEqual(mainBox.height + 1)
    expect(summaryBox.x).toBeLessThan(mainBox.x)
  }
  expect(await noSideScroll(page)).toBe(true)

  if (isMobile) {
    // A sideways swipe shows the next photo.
    const client = await page.context().newCDPSession(page)
    const y = mainBox.y + mainBox.height / 2
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: mainBox.x + mainBox.width * 0.8, y }] })
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: mainBox.x + mainBox.width * 0.5, y: y + 4 }] })
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: mainBox.x + mainBox.width * 0.2, y: y + 6 }] })
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(thumbs.getByRole('button', { name: 'Show image 2 of 4' })).toHaveAttribute('aria-current', 'true')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await thumbs.getByRole('button', { name: 'Show image 1 of 4' }).click()
  }

  // The video: nothing is requested from YouTube until play.
  await thumbs.getByRole('button', { name: 'Show the product video' }).click()
  const play = gallery.getByRole('button', { name: 'Play the video of Kids Tee' })
  await expect(play).toBeVisible()
  expect(served.providerRequests).toEqual([])
  await play.click()
  const frame = gallery.locator('iframe[title="Video of Kids Tee"]')
  await expect(frame).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&autoplay=1')
  await expect.poll(() => served.providerRequests.length).toBeGreaterThan(0)
  expect(served.providerRequests.every((url) => url.startsWith('https://www.youtube-nocookie.com/'))).toBe(true)

  // Lightbox zoom.
  await thumbs.getByRole('button', { name: 'Show image 1 of 4' }).click()
  await gallery.getByRole('button', { name: 'Open Kids Tee, image 1 of 4 full screen' }).click()
  const lightbox = page.getByRole('dialog', { name: 'Kids Tee, image 1 of 4' })
  await expect(lightbox).toBeVisible()
  const stage = lightbox.getByTestId('lightbox-stage')
  await expect(stage).toHaveAttribute('data-scale', '1.00')
  await lightbox.getByRole('button', { name: 'Zoom in' }).click()
  await expect(stage).toHaveAttribute('data-scale', '1.50')
  await page.keyboard.press('+')
  await expect(stage).toHaveAttribute('data-scale', '2.25')
  await page.keyboard.press('0')
  await expect(stage).toHaveAttribute('data-scale', '1.00')
  const stageBox = (await stage.boundingBox())!
  const centre = { x: stageBox.x + stageBox.width / 2, y: stageBox.y + stageBox.height / 2 }
  if (isMobile) {
    // Double tap zooms in and out again; a pinch zooms too.
    await page.touchscreen.tap(centre.x, centre.y)
    await page.touchscreen.tap(centre.x, centre.y)
    await expect(stage).toHaveAttribute('data-scale', '2.50')
    await page.touchscreen.tap(centre.x, centre.y)
    await page.touchscreen.tap(centre.x, centre.y)
    await expect(stage).toHaveAttribute('data-scale', '1.00')
    const client = await page.context().newCDPSession(page)
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: centre.x - 20, y: centre.y, id: 1 }, { x: centre.x + 20, y: centre.y, id: 2 }] })
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: centre.x - 50, y: centre.y, id: 1 }, { x: centre.x + 50, y: centre.y, id: 2 }] })
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: centre.x - 80, y: centre.y, id: 1 }, { x: centre.x + 80, y: centre.y, id: 2 }] })
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect.poll(async () => Number(await stage.getAttribute('data-scale'))).toBeGreaterThan(2)
  } else {
    // The wheel zooms at the cursor, a drag moves the zoomed photo, a double click goes back.
    await page.mouse.move(centre.x, centre.y)
    await page.mouse.wheel(0, -400)
    await expect.poll(async () => Number(await stage.getAttribute('data-scale'))).toBeGreaterThan(1.5)
    const before = await lightbox.locator('img').evaluate((img) => img.ownerDocument.defaultView?.getComputedStyle(img).transform)
    await page.mouse.down()
    await page.mouse.move(centre.x + 120, centre.y + 60, { steps: 4 })
    await page.mouse.up()
    expect(await lightbox.locator('img').evaluate((img) => img.ownerDocument.defaultView?.getComputedStyle(img).transform)).not.toBe(before)
    await page.mouse.dblclick(centre.x, centre.y)
    await expect(stage).toHaveAttribute('data-scale', '1.00')
  }
  // The next photo starts unzoomed.
  if ((await stage.getAttribute('data-scale')) === '1.00') await lightbox.getByRole('button', { name: 'Zoom in' }).click()
  await expect.poll(async () => Number(await stage.getAttribute('data-scale'))).toBeGreaterThan(1)
  await lightbox.getByRole('button', { name: 'Next image' }).click()
  await expect(page.getByRole('dialog', { name: 'Kids Tee, image 2 of 4' }).getByTestId('lightbox-stage')).toHaveAttribute('data-scale', '1.00')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('reduced motion: zoom steps are not animated', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await serve(page)
  await page.goto('/product/kids-tee')
  await page.getByRole('button', { name: 'Open Kids Tee, image 1 of 4 full screen' }).click()
  const lightbox = page.getByRole('dialog', { name: 'Kids Tee, image 1 of 4' })
  await lightbox.getByRole('button', { name: 'Zoom in' }).click()
  await expect(lightbox.getByTestId('lightbox-stage')).toHaveAttribute('data-scale', '1.50')
  expect(await lightbox.locator('img').evaluate((img) => img.ownerDocument.defaultView?.getComputedStyle(img).transitionDuration)).toBe('0s')
})

test('frequently bought together and questions & answers', async ({ page }) => {
  const served = await serve(page)
  await page.goto('/product/kids-tee')

  const fbt = page.getByRole('region', { name: 'Frequently bought together' })
  await fbt.scrollIntoViewIfNeeded()
  await expect(fbt.getByText('Based on what shoppers bought together')).toBeVisible()
  await expect(fbt.getByTestId('fbt-total')).toHaveText('৳680.50')
  await fbt.getByRole('checkbox', { name: 'Include Kids Cap' }).uncheck()
  await expect(fbt.getByTestId('fbt-total')).toHaveText('৳530.50')
  await fbt.getByRole('button', { name: 'Add selected to cart' }).click()
  await expect(fbt.getByTestId('fbt-status')).toHaveText('2 items added to your cart.')
  expect(served.adds).toEqual([
    { variant_id: 'v-red-m', quantity: '1' },
    { variant_id: 'v-kids-socks', quantity: '1' },
  ])
  await expect(page.getByRole('dialog', { name: /Your cart/ })).toBeVisible()
  await page.keyboard.press('Escape')

  // Related products keep the owner's badges on their cards.
  await expect(page.getByRole('region', { name: 'Related products' }).getByText('Eid offer')).toBeVisible()
  await expect(page.getByTestId('builder-zone-product.bottom').getByRole('heading', { name: 'Happy kids, happy parents' })).toBeVisible()

  await page.getByRole('tab', { name: 'Questions (1)' }).click()
  const list = page.getByRole('list', { name: 'Questions and answers' })
  await expect(list.getByText('Is the colour fast in the wash?')).toBeVisible()
  await expect(list.getByText('Yes — wash it inside out in cold water.')).toBeVisible()
  await page.getByRole('button', { name: 'Ask a question' }).click()
  const form = page.getByRole('form', { name: 'Ask a question about Kids Tee' })
  await form.getByLabel('Your name').fill('Karim')
  await form.getByLabel('E-mail').fill('karim@example.com')
  await form.getByLabel('Your question').fill('Is there a size for 2-year-olds?')
  await form.getByRole('button', { name: 'Send question' }).click()
  await expect(page.getByTestId('question-thanks')).toHaveText('Thanks — your question will appear once we answer it.')
  expect(served.asked).toEqual([{ name: 'Karim', email: 'karim@example.com', question: 'Is there a size for 2-year-olds?', website: '' }])
  expect(await noSideScroll(page)).toBe(true)
})

test('in Bangla with Bengali digits', async ({ page }) => {
  await serve(page, { store: { locales: ['en', 'bn'], default_locale: 'en', bangla_digits: true } })
  await page.goto('/product/kids-tee?lang=bn')
  await expect(page.getByRole('button', { name: 'এখনই কিনুন' })).toBeVisible()
  await expect(page.getByTestId('delivery-option').first()).toHaveText('Inside Dhaka: ১–২ দিন · ৳৬০ · ৳২,০০০-এর বেশি কেনাকাটায় ফ্রি')
  await expect(page.getByTestId('cod-note')).toHaveText('ক্যাশ অন ডেলিভারি সুবিধা আছে')
  await page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)')
  const region = page.getByRole('region', { name: 'দ্রুত কেনা' })
  await expect(region).toBeVisible()
  await expect(region.getByTestId('quick-buy-price')).toHaveText('৳৪৫০.০০')
  expect(await noSideScroll(page)).toBe(true)
})
