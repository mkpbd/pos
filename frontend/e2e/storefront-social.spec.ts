import { expect, test, type Page } from '@playwright/test'

/*
 * P2b on a mocked store (1366 px desktop project, 375 px mobile project): the share bar on a product,
 * a blog post and a campaign page (networks + "Copy link" on a computer, the share sheet on a phone,
 * Messenger only on phones), every shared link tagged utm_source=<network>&utm_medium=share;
 * "Order on WhatsApp" under "Buy now" with the order typed in; the floating WhatsApp chat button in
 * the bottom corner above a popup bottom bar and the quick-buy bar. Nothing leaves the machine:
 * the networks' pages are stubbed. No horizontal scroll at either width.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const VISIBLE = { desktop: true, tablet: true, mobile: true }
const NUMBER = '8801712345678'

const bootstrap = (store: Record<string, unknown> = {}) => ({
  store: {
    name: 'Berry Kids', description: 'Clothes and toys for little ones', prices_include_tax: true, currency: 'BDT', locales: ['en', 'bn'], default_locale: 'en',
    bangla_digits: true, share_buttons: true, whatsapp_number: NUMBER, whatsapp_order_button: true, whatsapp_chat_button: true, ...store,
  },
  preview: false,
  builder: { home: false },
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
    footer: { about: 'Clothes and toys for little ones.', copyright: '© Berry Kids', contact: { email: null, phone: null, address: null }, social: {}, payment_logos: [] },
    custom_css: null,
  },
  menus: { main: { name: 'Main', items: [] } },
})

const photo = (name: string) => `/e2e-photos/${name}.svg`
const photoSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200"><rect width="1200" height="1200" fill="#fde68a"/><circle cx="600" cy="600" r="320" fill="#6f55c2"/></svg>'

const variant = (id: string, colour: string, size: string, extra: Record<string, unknown> = {}) => ({
  id, sku: `TEE-${colour[0]}${size}`, name: `${colour} / ${size}`, option_values: { Colour: colour, Size: size }, price: '450.00', compare_at_price: null,
  on_sale: false, discount_percent: null, in_stock: true, low_stock: false, stock_left: null, image_id: null, promo_price: null, ...extra,
})

const tee = {
  id: 'p-kids-tee', slug: 'kids-tee', name: 'Kids Tee', url: '/product/kids-tee', short_description: 'Soft cotton tee for everyday play.',
  description_html: `<p>${'Made from organic cotton that stays soft wash after wash. '.repeat(14)}</p>`,
  specifications: [{ label: 'Material', value: 'Cotton' }], brand: null, category: { name: 'Clothing', slug: 'clothing' },
  breadcrumbs: [{ name: 'Home', url: '/' }, { name: 'Clothing', url: '/category/clothing' }, { name: 'Kids Tee', url: null }],
  images: [{ id: 'red-1', url: photo('red-1'), alt: 'Kids Tee in red' }],
  options: [
    { name: 'Colour', slug: 'colour', display: 'swatch', values: [{ value: 'Red', swatch_hex: '#e11d48', image_ids: [] }, { value: 'Blue', swatch_hex: '#2563eb', image_ids: [] }] },
    { name: 'Size', slug: 'size', display: 'button', values: ['M', 'L'].map((value) => ({ value, swatch_hex: null, image_ids: [] })) },
  ],
  variants: [variant('v-red-m', 'Red', 'M'), variant('v-red-l', 'Red', 'L'), variant('v-blue-l', 'Blue', 'L', { price: '480.00' })],
  price: '450.00', price_max: '480.00', on_sale: false, in_stock: true, is_new: false, default_variant_id: 'v-red-m', unit: 'pcs', promotion: null,
  seo: { title: null, description: null, image_url: null },
  video: null, badges: [], delivery: null, zones: { 'product.below_price': null, 'product.after': null, 'product.bottom': null },
}

const post = {
  slug: 'mango-lassi', title: 'Mango lassi', excerpt: 'A summer drink.', category: { name: 'Recipes', slug: 'recipes' }, author: 'Rina',
  cover: { id: 'cover-1', url: photo('cover'), srcset: `${photo('cover')} 1200w`, width: 1200, height: 1200, alt: null },
  published_at: '2026-10-12T18:00:00+06:00', reading_minutes: 4, body_html: `<p>${'Ripe mangoes and yoghurt, blended cold. '.repeat(12)}</p>`,
  seo_title: null, seo_description: null, updated_at: null, prev: null, next: null, related: [],
}

const section = (id: string, elements: { id: string; type: string; props: Record<string, unknown> }[]) => ({
  id, type: 'section', props: { layout: 'boxed', anchor: null }, style: {}, visibility: VISIBLE,
  columns: [{ id: `c_${id}`, type: 'column', width: { base: 100 }, style: {}, elements: elements.map((e) => ({ ...e, style: {}, visibility: VISIBLE })) }],
})

const MEDIA_ID = '0199a5c1-0000-7000-8000-0000000000e1'
const eidSale = {
  document: { id: '0199a5c1-0000-7000-8000-00000000d2a0', key: 'landing:eid-sale', title: 'Eid sale', version: 1, source: 'published' },
  sections: [
    section('s_hero', [
      { id: 'e_h', type: 'heading', props: { text: 'Eid tees for little ones', level: 1, link: null } },
      { id: 'e_t', type: 'text', props: { html: `<p>${'Soft organic cotton, made for play. '.repeat(20)}</p>` } },
      { id: 'e_img', type: 'image', props: { media_id: MEDIA_ID, alt: 'Eid tees', link: null, aspect: '1:1', fit: 'cover' } },
    ]),
  ],
  media: { [MEDIA_ID]: { url: photo('eid'), srcset: `${photo('eid')} 1200w`, width: 1200, height: 1200, alt: 'Eid tees' } },
  data: {},
}

const cookieBar = {
  id: '0199a5c1-0000-7000-8000-0000000c0c1e',
  version: 1,
  settings: {
    layout: 'bar_bottom', position: 'bottom_right', width: 'md', overlay: false, close_on_overlay: false, label: 'Cookie notice',
    trigger: { kind: 'on_load', delay_seconds: 0, scroll_percent: 50 }, frequency: { kind: 'once_forever', days: 7 }, stop_after_action: true,
    pages: { kind: 'all', paths: [] }, devices: 'all', audience: 'all', priority: 10,
  },
  payload: { sections: [section('s_cookie', [{ id: 'e_ck_t', type: 'text', props: { html: '<p>We only use the cookies the shop needs to work.</p>' } }])], media: {}, data: {} },
}

const cart = { id: null, items: [], item_count: '0', subtotal: '0.00', discount_total: '0.00', tax_total: '0.00', total: '0.00', prices_include_tax: true, currency: 'BDT', issues: [], promotions: [], free_shipping: null, coupon: null }

async function serve(page: Page, { popups = [] as unknown[], store = {} as Record<string, unknown> } = {}) {
  const networkPages: string[] = []
  // Anything not mocked below answers 404 (registered first: later routes win).
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 404, json: { success: false, error: { code: 'NOT_FOUND', message: 'Not mocked', details: {} }, meta: { request_id: 'e2e' } } }))
  await page.route('**/e2e-photos/*', (route) => route.fulfill({ contentType: 'image/svg+xml', body: photoSvg }))
  await page.route('**/api/v1/store/bootstrap*', (route) => route.fulfill({ json: envelope(bootstrap(store)) }))
  await page.route('**/api/v1/store/account/me*', (route) => route.fulfill({ json: envelope(null) }))
  await page.route('**/api/v1/store/wishlist*', (route) => route.fulfill({ json: envelope({ items: [] }) }))
  await page.route('**/api/v1/store/builder/popups*', (route) => route.fulfill({ json: envelope({ popups, never_on: ['/checkout', '/cart'] }) }))
  await page.route(/\/api\/v1\/store\/cart(\?.*)?$/, (route) => route.fulfill({ json: envelope(cart) }))
  await page.route('**/api/v1/store/visits*', (route) => route.fulfill({ json: envelope({ recorded: true }) }))
  await page.route('**/api/v1/store/products/kids-tee*', (route) => route.fulfill({ json: envelope(tee) }))
  await page.route('**/api/v1/store/products/kids-tee/related*', (route) => route.fulfill({ json: envelope({ related: [], frequently_bought: [], frequently_bought_source: null }) }))
  await page.route('**/api/v1/store/products/kids-tee/reviews*', (route) =>
    route.fulfill({ json: { success: true, data: [], meta: { request_id: 'e2e', summary: { average: '0.0', count: 0, distribution: {} } } } }),
  )
  await page.route('**/api/v1/store/products/kids-tee/questions*', (route) => route.fulfill({ json: envelope([], { pagination: { current_page: 1, per_page: 10, total: 0, last_page: 1 } }) }))
  await page.route('**/api/v1/store/blog/mango-lassi*', (route) => route.fulfill({ json: envelope(post) }))
  await page.route('**/api/v1/store/builder/pages/eid-sale*', (route) => route.fulfill({ json: envelope(eidSale) }))
  // The networks' own pages never load for real.
  await page.context().route(/^https:\/\/(www\.facebook\.com|wa\.me|x\.com|www\.pinterest\.com)\//, (route) => {
    networkPages.push(route.request().url())
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>network</title><p>network</p>' })
  })
  return { networkPages }
}

const noSideScroll = (page: Page) => page.locator('html').evaluate((el) => el.scrollWidth <= el.clientWidth)
const query = (href: string | null) => new URL(href ?? '', 'http://x').searchParams

test.beforeEach(async ({ page, isMobile }) => {
  await page.setViewportSize(isMobile ? { width: 375, height: 812 } : { width: 1366, height: 768 })
})

test('desktop: share buttons, copy link, Order on WhatsApp and the chat button', async ({ page, isMobile, baseURL }) => {
  test.skip(isMobile, 'desktop layout')
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL })
  const { networkPages } = await serve(page)
  await page.goto('/product/kids-tee?utm_source=facebook&utm_medium=paid&fbclid=abc')
  await expect(page.getByRole('heading', { level: 1, name: 'Kids Tee' })).toBeVisible()

  // The networks (no Messenger on a computer) and "Copy link", all tagged for their network.
  const bar = page.getByRole('group', { name: 'Share this product' })
  await expect(bar).toBeVisible()
  await expect(bar.getByRole('link')).toHaveCount(4)
  await expect(bar.getByRole('link', { name: /Messenger/ })).toHaveCount(0)
  const canonical = `${baseURL}/product/kids-tee`
  const facebook = bar.getByRole('link', { name: 'Share on Facebook (opens in a new tab)' })
  expect(query(await facebook.getAttribute('href')).get('u')).toBe(`${canonical}?utm_source=facebook&utm_medium=share`)
  expect(query(await bar.getByRole('link', { name: /^Save to Pinterest/ }).getAttribute('href')).get('media')).toBe(`${baseURL}/e2e-photos/red-1.svg`)
  for (const link of await bar.getByRole('link').all()) {
    const box = (await link.boundingBox())!
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44)
  }

  // Facebook's share page opens in a new tab with the tagged link.
  const [popup] = await Promise.all([page.waitForEvent('popup'), facebook.click()])
  await popup.waitForLoadState()
  expect(popup.url()).toContain('https://www.facebook.com/sharer/sharer.php?u=')
  expect(query(popup.url()).get('u')).toBe(`${canonical}?utm_source=facebook&utm_medium=share`)
  await popup.close()
  expect(networkPages).toHaveLength(1)

  // Copy link: the tagged link on the clipboard and a polite "Link copied".
  await bar.getByRole('button', { name: 'Copy link' }).click()
  await expect(bar.getByRole('status')).toHaveText('Link copied')
  expect(await page.evaluate<string>('navigator.clipboard.readText()')).toBe(`${canonical}?utm_source=copy_link&utm_medium=share`)

  // Order on WhatsApp under "Buy now", the order typed in.
  const form = page.getByRole('form', { name: 'Add to cart' })
  const order = form.getByRole('link', { name: 'Order on WhatsApp (opens in a new tab)' })
  await expect(order).toBeVisible()
  const buyBox = (await form.getByRole('button', { name: 'Buy now' }).boundingBox())!
  const orderBox = (await order.boundingBox())!
  expect(orderBox.y).toBeGreaterThanOrEqual(buyBox.y + buyBox.height)
  expect(orderBox.height).toBeGreaterThanOrEqual(44)
  await form.getByRole('button', { name: 'Increase: Quantity of Kids Tee' }).click()
  await expect
    .poll(async () => query(await order.getAttribute('href')).get('text'))
    .toBe(`Hello! I would like to order:\nProduct: Kids Tee\nOption: Red / M\nQuantity: 2\nPrice: ৳450.00 each\n${canonical}?variant=v-red-m&utm_source=whatsapp&utm_medium=chat`)
  expect((await order.getAttribute('href'))!.startsWith(`https://wa.me/${NUMBER}?text=`)).toBe(true)

  // The chat button: the bottom right corner, a 56 px target; above the quick-buy bar once it shows.
  const chat = page.getByRole('link', { name: 'Chat with us on WhatsApp (opens in a new tab)' })
  await expect(chat).toBeVisible()
  const viewport = page.viewportSize()!
  let chatBox = (await chat.boundingBox())!
  expect(chatBox.width).toBeGreaterThanOrEqual(56)
  expect(Math.round(viewport.width - chatBox.x - chatBox.width)).toBe(16)
  expect(Math.round(viewport.height - chatBox.y - chatBox.height)).toBe(16)
  // The page's own address: the visit's campaign tags and click id stay behind.
  expect(query(await chat.getAttribute('href')).get('text')).toBe(`Hello! I have a question about this page: ${canonical}?utm_source=whatsapp&utm_medium=chat`)
  await page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)')
  const quickBuy = page.getByRole('region', { name: 'Quick buy' })
  await expect(quickBuy).toBeVisible()
  await expect
    .poll(async () => {
      const bar = (await page.getByTestId('quick-buy').boundingBox())!
      chatBox = (await chat.boundingBox())!
      return Math.round(bar.y - (chatBox.y + chatBox.height))
    })
    .toBe(16)
  // The end of the page stays reachable: the footer's last line clears the button.
  await page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)')
  const footerLine = (await page.getByText('© Berry Kids').boundingBox())!
  chatBox = (await chat.boundingBox())!
  expect(footerLine.y + footerLine.height).toBeLessThanOrEqual(chatBox.y)
  expect(await noSideScroll(page)).toBe(true)
})

test('desktop: the blog post and the campaign page share their own address', async ({ page, isMobile, baseURL }) => {
  test.skip(isMobile, 'desktop layout')
  await serve(page, { store: { whatsapp_chat_button: false } })
  await page.goto('/blog/mango-lassi')
  const postBar = page.getByRole('group', { name: 'Share this post' })
  await expect(postBar).toBeVisible()
  expect(query(await postBar.getByRole('link', { name: /^Share on X/ }).getAttribute('href')).get('url')).toBe(`${baseURL}/blog/mango-lassi?utm_source=x&utm_medium=share`)
  expect(query(await postBar.getByRole('link', { name: /^Share on X/ }).getAttribute('href')).get('text')).toBe('Mango lassi')
  await expect(page.getByTestId('whatsapp-chat')).toHaveCount(0)

  await page.goto('/p/eid-sale?utm_source=facebook&utm_medium=paid')
  const pageBar = page.getByRole('group', { name: 'Share this page' })
  await expect(pageBar).toBeVisible()
  expect(query(await pageBar.getByRole('link', { name: /^Share on WhatsApp/ }).getAttribute('href')).get('text')).toBe(
    `Eid sale\n${baseURL}/p/eid-sale?utm_source=whatsapp&utm_medium=share`,
  )
  expect(query(await pageBar.getByRole('link', { name: /^Save to Pinterest/ }).getAttribute('href')).get('media')).toBe(`${baseURL}/e2e-photos/eid.svg`)
  // Centred under the page: the label and the buttons as one row.
  const barBox = (await pageBar.boundingBox())!
  const label = (await pageBar.getByText('Share this page', { exact: true }).boundingBox())!
  const list = (await pageBar.getByRole('list').boundingBox())!
  expect(Math.abs((label.x + list.x + list.width) / 2 - (barBox.x + barBox.width / 2))).toBeLessThan(2)
  expect(Math.abs(label.y + label.height / 2 - (list.y + list.height / 2))).toBeLessThan(2)
  expect(await noSideScroll(page)).toBe(true)
})

test('phone: one Share button opens the share sheet; WhatsApp sits clear of the bars', async ({ page, isMobile, baseURL }) => {
  test.skip(!isMobile, 'phone layout')
  // A share sheet that records what it was given.
  await page.addInitScript(`
    const shared = []
    Object.defineProperty(window, '__shared', { value: shared })
    Object.defineProperty(Navigator.prototype, 'share', { configurable: true, value: (data) => (shared.push(data), Promise.resolve()) })
  `)
  await serve(page, { popups: [cookieBar] })
  await page.goto('/product/kids-tee')
  await expect(page.getByRole('heading', { level: 1, name: 'Kids Tee' })).toBeVisible()

  const share = page.getByRole('button', { name: 'Share this product' })
  await expect(share).toBeVisible()
  await expect(page.getByRole('link', { name: /^Share on Facebook/ })).toHaveCount(0)
  expect((await share.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await share.click()
  await expect.poll(() => page.evaluate('window.__shared')).toEqual([{ title: 'Kids Tee', url: `${baseURL}/product/kids-tee?utm_source=native_share&utm_medium=share` }])

  // Order on WhatsApp: full width under "Buy now".
  const order = page.getByRole('link', { name: 'Order on WhatsApp (opens in a new tab)' })
  const orderBox = (await order.boundingBox())!
  const buyBox = (await page.getByRole('form', { name: 'Add to cart' }).getByRole('button', { name: 'Buy now' }).boundingBox())!
  expect(orderBox.height).toBeGreaterThanOrEqual(44)
  expect(Math.round(orderBox.width)).toBe(Math.round(buyBox.width))

  // The chat button sits above the cookie bar, then above the quick-buy bar too.
  const cookie = page.getByRole('region', { name: 'Cookie notice' })
  await expect(cookie).toBeVisible()
  const chat = page.getByTestId('whatsapp-chat')
  await expect
    .poll(async () => {
      const cookieBox = (await cookie.boundingBox())!
      const chatBox = (await chat.boundingBox())!
      return Math.round(cookieBox.y - (chatBox.y + chatBox.height))
    })
    .toBeGreaterThanOrEqual(16)
  await page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)')
  await expect(page.getByRole('region', { name: 'Quick buy' })).toBeVisible()
  await expect
    .poll(async () => {
      const bar = (await page.getByTestId('quick-buy').boundingBox())!
      const chatBox = (await chat.boundingBox())!
      return Math.round(bar.y - (chatBox.y + chatBox.height))
    })
    .toBeGreaterThanOrEqual(16)
  expect(await noSideScroll(page)).toBe(true)
})

test('phone without a share sheet: the buttons, Messenger included, in Bangla', async ({ page, isMobile, baseURL }) => {
  test.skip(!isMobile, 'phone layout')
  await page.addInitScript('Reflect.deleteProperty(Navigator.prototype, "share")')
  await serve(page)
  await page.goto('/product/kids-tee?lang=bn')

  const bar = page.getByRole('group', { name: 'পণ্যটি শেয়ার করুন' })
  await expect(bar).toBeVisible()
  await expect(bar.getByRole('link')).toHaveCount(5)
  const messenger = bar.getByRole('link', { name: 'মেসেঞ্জারে পাঠান' })
  expect(await messenger.getAttribute('href')).toBe(`fb-messenger://share?link=${encodeURIComponent(`${baseURL}/product/kids-tee?lang=bn&utm_source=messenger&utm_medium=share`)}`)
  for (const control of [...(await bar.getByRole('link').all()), bar.getByRole('button', { name: 'লিংক কপি করুন' })]) {
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }

  const order = page.getByRole('link', { name: 'হোয়াটসঅ্যাপে অর্ডার করুন (নতুন ট্যাবে খুলবে)' })
  await expect(order).toBeVisible()
  expect(query(await order.getAttribute('href')).get('text')).toBe(
    `হ্যালো! আমি অর্ডার করতে চাই:\nপণ্য: Kids Tee\nঅপশন: Red / M\nপরিমাণ: ১\nদাম: ৳৪৫০.০০\n${baseURL}/product/kids-tee?variant=v-red-m&lang=bn&utm_source=whatsapp&utm_medium=chat`,
  )
  await expect(page.getByRole('link', { name: 'হোয়াটসঅ্যাপে আমাদের সাথে চ্যাট করুন (নতুন ট্যাবে খুলবে)' })).toBeVisible()
  expect(await noSideScroll(page)).toBe(true)
})
