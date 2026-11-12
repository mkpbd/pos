import { expect, test, type Page } from '@playwright/test'

/*
 * Store builder B6 on a mocked store (1366 px and 375 px): content blocks (accordion, tabs,
 * counters), a gallery with its lightbox, a click-to-load map, shop-the-look hotspots, a product
 * spotlight, moving strips with pause buttons, entrance animations (and none for reduced motion),
 * a sticky section with shape dividers and a background video (poster only on phones).
 * Requests to Google Maps, YouTube and Vimeo are blocked: nothing must load before a click.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })

const VISIBLE = { desktop: true, tablet: true, mobile: true }
const uuid = (n: number) => `0199a5c1-0000-7000-8000-${n.toString(16).padStart(12, '0')}`
const MEDIA = { poster: uuid(0xb01), jam: uuid(0xb02), jars: uuid(0xb03), logoA: uuid(0xb04), logoB: uuid(0xb05), table: uuid(0xb06) }
const PRODUCT_A = uuid(0xd01)
const PRODUCT_B = uuid(0xd02)

type Node = { id: string; type: string; props: Record<string, unknown>; style?: Record<string, unknown> }

const el = (id: string, type: string, props: Record<string, unknown>, style: Record<string, unknown> = {}): Node => ({ id, type, props, style })

function section(id: string, elements: Node[], props: Record<string, unknown> = {}, style: Record<string, unknown> = {}) {
  return {
    id,
    type: 'section',
    props: { layout: 'boxed', anchor: null, ...props },
    style: { base: { spacing: { padding: { top: '32px', bottom: '32px' } } }, ...style },
    visibility: VISIBLE,
    columns: [{ id: `c_${id}`, type: 'column', width: { base: 100 }, style: {}, elements: elements.map((e) => ({ ...e, style: e.style ?? {}, visibility: VISIBLE })) }],
  }
}

const card = (slug: string) => ({
  id: `p-${slug}`, slug, name: slug.replace(/-/g, ' '), url: `/product/${slug}`, image: { url: '/favicon.svg', alt: slug }, hover_image: null, price: '120.00', price_max: '120.00',
  compare_at_price: null, on_sale: false, discount_percent: null, in_stock: true, is_new: false, is_featured: false, brand: null, category: null,
  variant_count: 1, default_variant_id: `v-${slug}`, short_description: null, promotion: null,
})

const detail = {
  ...card('mango-jam'),
  name: 'Mango Jam',
  short_description: 'Cold-pressed mango.',
  description_html: null,
  specifications: [],
  brand: null,
  category: null,
  breadcrumbs: [],
  images: [{ id: 'img-1', url: '/favicon.svg', alt: 'Mango jam' }],
  options: [{ name: 'Size', slug: 'size', display: 'button', values: [{ value: 'Small', swatch_hex: null }, { value: 'Large', swatch_hex: null }] }],
  variants: [
    { id: 'v-s', sku: 'JAM-S', name: 'Small', option_values: { Size: 'Small' }, price: '120.00', compare_at_price: null, on_sale: false, discount_percent: null, in_stock: true, low_stock: false, image_id: null, promo_price: null },
    { id: 'v-l', sku: 'JAM-L', name: 'Large', option_values: { Size: 'Large' }, price: '200.00', compare_at_price: null, on_sale: false, discount_percent: null, in_stock: true, low_stock: false, image_id: null, promo_price: null },
  ],
  price_max: '200.00',
  default_variant_id: 'v-s',
  unit: null,
  seo: { title: null, description: null, image_url: null },
}

const videoBackground = {
  base: {
    spacing: { padding: { top: '96px', bottom: '96px' } },
    background: {
      type: 'color',
      color: '#1f2933',
      overlay: '#00000066',
      video: { url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', provider: 'youtube', video_id: 'aqz-KE-bpKQ', poster: { media_id: MEDIA.poster } },
    },
    color: '#ffffff',
  },
}

const sections = [
  section('s_hero', [el('e_hero', 'heading', { text: 'Fresh from the farm', level: 1, link: null })], {
    sticky: false,
    shape_bottom: { shape: 'wave', color: 'theme:canvas', height: 48, flip: false },
  }, videoBackground),
  section('s_bar', [el('e_marquee', 'marquee', { items: [{ id: 'm1', text: 'Free delivery over 1000 taka' }, { id: 'm2', text: 'New mango season' }], speed: 'normal', direction: 'left', separator: 'leaf' })], { sticky: true }),
  section('s_content', [
    el('e_acc', 'accordion', { items: [{ id: 'q1', title: 'How long does delivery take?', html: '<p>Two to three days.</p>' }, { id: 'q2', title: 'Can I pay on delivery?', html: '<p>Yes.</p>' }], open_first: true, allow_multiple: false, style: 'boxed' }),
    el('e_tabs', 'tabs', { items: [{ id: 't1', title: 'Details', html: '<p>Cold-pressed.</p>' }, { id: 't2', title: 'Storage', html: '<p>Keep cool.</p>' }], layout: 'horizontal' }),
    el('e_count', 'counter', { items: [{ id: 'n1', value: 12500, prefix: '', suffix: '+', label: 'Jars delivered' }, { id: 'n2', value: 4.85, prefix: '', suffix: '/5', label: 'Rating' }], animate: true }, { base: { motion: { entrance: 'slide-up', duration: 300 } } }),
  ]),
  section('s_media', [
    el('e_gal', 'gallery', {
      images: [
        { id: 'g1', media_id: MEDIA.jam, alt: 'Jam on toast', caption: 'Breakfast' },
        { id: 'g2', media_id: MEDIA.jars, alt: 'Jars on a shelf', caption: '' },
        { id: 'g3', media_id: MEDIA.table, alt: 'Breakfast table', caption: '' },
      ],
      columns: { base: 3, mobile: 2 },
      aspect: 'square',
      lightbox: true,
      gap: 'md',
    }),
    el('e_logos', 'logo_carousel', { logos: [{ id: 'o1', media_id: MEDIA.logoA, alt: 'Green Farms', link: null }, { id: 'o2', media_id: MEDIA.logoB, alt: 'Dhaka Organics', link: null }], grayscale: true, speed: 'slow' }),
    el('e_map', 'map', { query: 'Road 5, Dhanmondi, Dhaka', title: 'Our shop', height: 300, zoom: 16 }),
  ], { shape_top: { shape: 'tilt', color: '#f4e9dc', height: 40, flip: true } }),
  section('s_shop', [
    el('e_look', 'shop_the_look', { media_id: MEDIA.table, alt: 'A breakfast table', title: 'Breakfast, sorted', hotspots: [{ id: 'h1', x: 30, y: 55, product_id: PRODUCT_A }, { id: 'h2', x: 70, y: 40, product_id: PRODUCT_B }] }),
    el('e_spot', 'product_spotlight', { product_id: PRODUCT_A, layout: 'image-left', show_description: true, badge: 'Best seller' }),
  ]),
]

const payload = {
  document: { id: uuid(0xd1), key: 'landing:b6', title: 'B6', version: 1, source: 'published' },
  sections,
  media: Object.fromEntries(Object.values(MEDIA).map((id) => [id, { url: '/favicon.svg', srcset: '', width: 600, height: 400, alt: null }])),
  data: {
    e_look: { products: { [PRODUCT_A]: card('mango-jam'), [PRODUCT_B]: card('green-tea') } },
    e_spot: detail,
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

/** External players and maps that must not load: recorded, then refused. */
async function serve(page: Page) {
  const external: string[] = []
  await page.route(/https:\/\/(www\.google\.com|www\.youtube-nocookie\.com|player\.vimeo\.com)\/.*/, (route) => {
    external.push(route.request().url())
    return route.fulfill({ status: 204, body: '' })
  })
  await page.route('**/api/v1/store/bootstrap*', (route) => route.fulfill({ json: envelope(bootstrap) }))
  await page.route('**/api/v1/store/builder/pages/b6*', (route) => route.fulfill({ json: envelope(payload) }))
  await page.route('**/api/v1/store/account/me*', (route) => route.fulfill({ json: envelope(null) }))
  await page.route('**/api/v1/store/wishlist*', (route) => route.fulfill({ json: envelope({ items: [] }) }))
  await page.route('**/api/v1/store/cart*', (route) =>
    route.fulfill({ json: envelope({ id: null, items: [], item_count: '0', subtotal: '0.00', discount_total: '0.00', tax_total: '0.00', total: '0.00', prices_include_tax: true, currency: 'BDT', issues: [], promotions: [], free_shipping: null, coupon: null }) }),
  )
  return external
}

const noHorizontalScroll = (page: Page) => page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth')

test('B6 elements at 1366 px', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop layout')
  await page.setViewportSize({ width: 1366, height: 900 })
  const external = await serve(page)
  await page.goto('/p/b6')

  const builder = page.getByTestId('builder-page')
  await expect(builder.getByRole('heading', { name: 'Fresh from the farm', level: 1 })).toBeVisible()

  // Background video behind the hero on a wide screen, inert, with the poster; a wave below it.
  const video = page.locator('[data-b="s_hero"] [data-testid="builder-bg-video"]')
  await expect(video.locator('iframe')).toHaveAttribute('src', /youtube-nocookie\.com\/embed\/aqz-KE-bpKQ\?autoplay=1&mute=1&loop=1/)
  await expect(video).toHaveAttribute('aria-hidden', 'true')
  await expect(page.locator('[data-b="s_hero"] .b-shape[data-edge="bottom"] svg')).toBeVisible()

  // The sticky bar stays just below the sticky store header while scrolling.
  await page.mouse.wheel(0, 1600)
  await expect
    .poll(async () => {
      const header = await page.getByTestId('site-header').boundingBox()
      const bar = await page.locator('[data-b="s_bar"]').boundingBox()
      return header && bar ? Math.round(bar.y - (header.y + header.height)) : null
    })
    .toBe(0)
  await page.mouse.wheel(0, -4000)

  // Marquee: moving, with a pause button.
  const marquee = page.getByRole('region', { name: 'Scrolling text' })
  await marquee.getByRole('button', { name: 'Pause Scrolling text' }).click()
  await expect(marquee.locator('.b-strip-track')).toHaveAttribute('data-paused', 'true')

  // Accordion and tabs with the keyboard.
  const second = page.getByRole('button', { name: 'Can I pay on delivery?' })
  await second.focus()
  await page.keyboard.press('Enter')
  await expect(second).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('button', { name: 'How long does delivery take?' })).toHaveAttribute('aria-expanded', 'false')
  await page.getByRole('tab', { name: 'Details' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Storage' })).toBeFocused()
  await expect(page.getByRole('tabpanel', { name: 'Storage' })).toHaveText('Keep cool.')

  // The counter's entrance plays once in view, and the figures end on their values.
  const counter = page.locator('[data-b="e_count"]')
  await counter.scrollIntoViewIfNeeded()
  await expect(counter).toHaveAttribute('data-b-motion', 'run')
  await expect(counter.locator('[aria-hidden="true"]', { hasText: '12,500+' })).toBeVisible()

  // Gallery lightbox: arrows step, Escape returns the focus to the photo.
  const open = page.getByRole('button', { name: 'View larger: Jam on toast' })
  await open.click()
  await expect(page.getByRole('dialog', { name: 'Jam on toast' })).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('dialog', { name: 'Jars on a shelf' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(open).toBeFocused()

  // The map loads only after a click.
  expect(external.filter((url) => url.includes('google.com'))).toEqual([])
  await page.getByRole('button', { name: 'Show map' }).click()
  await expect(page.locator('[data-b="e_map"] iframe')).toHaveAttribute('title', 'Map: Our shop')
  await expect.poll(() => external.some((url) => url.startsWith('https://www.google.com/maps?q=Road%205'))).toBe(true)

  // Shop the look: a hotspot opens its card; Escape closes it back to the dot.
  const dot = page.getByRole('button', { name: 'Show mango jam' })
  await dot.click()
  const lookCard = page.getByTestId('look-card')
  await expect(lookCard).toBeVisible()
  await expect(lookCard.getByRole('link', { name: 'mango jam' })).toHaveAttribute('href', '/product/mango-jam')
  await page.keyboard.press('Escape')
  await expect(lookCard).toHaveCount(0)
  await expect(dot).toBeFocused()
  await expect(page.getByRole('region', { name: 'Products in this look' })).toBeHidden()

  // Spotlight: choose a size, the price follows; add to cart is ready.
  const spot = page.getByTestId('builder-spotlight')
  await spot.locator('label', { hasText: 'Large' }).click()
  await expect(spot.getByTestId('sku')).toHaveText('JAM-L')
  await expect(spot.getByRole('button', { name: /Add to cart/ })).toBeEnabled()

  expect(await noHorizontalScroll(page)).toBe(true)
})

test('B6 elements at 375 px', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone layout')
  await page.setViewportSize({ width: 375, height: 800 })
  const external = await serve(page)
  await page.goto('/p/b6')
  await expect(page.getByRole('heading', { name: 'Fresh from the farm', level: 1 })).toBeVisible()

  // Poster only on phones: no player request at all.
  const video = page.locator('[data-b="s_hero"] [data-testid="builder-bg-video"]')
  await expect(video.locator('img')).toBeVisible()
  await expect(video.locator('iframe')).toHaveCount(0)

  // Two gallery columns, the hotspot products listed under the photo, the map still behind its button.
  const columns = await page.evaluate<number>(`getComputedStyle(document.querySelector('[data-b="e_gal"] .b-gallery-grid')).gridTemplateColumns.split(' ').length`)
  expect(columns).toBe(2)
  const list = page.getByRole('region', { name: 'Products in this look' })
  await list.scrollIntoViewIfNeeded()
  await expect(list.getByRole('listitem')).toHaveCount(2)
  await page.getByRole('button', { name: 'Show green tea' }).tap()
  await expect(page.getByTestId('look-card')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Show map' })).toBeVisible()

  expect(await noHorizontalScroll(page)).toBe(true)
  expect(external).toEqual([])
})

test('B6 with reduced motion: still strips, no entrances, poster only', async ({ page, isMobile }) => {
  test.skip(isMobile, 'one run is enough')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1366, height: 900 })
  const external = await serve(page)
  await page.goto('/p/b6')
  await expect(page.getByRole('heading', { name: 'Fresh from the farm', level: 1 })).toBeVisible()
  await expect(page.getByTestId('builder-marquee')).toHaveAttribute('data-motion', 'static')
  await expect(page.getByTestId('builder-logo-carousel')).toHaveAttribute('data-motion', 'static')
  await expect(page.getByRole('button', { name: /^Pause/ })).toHaveCount(0)
  const counter = page.locator('[data-b="e_count"]')
  await counter.scrollIntoViewIfNeeded()
  await expect(counter).not.toHaveAttribute('data-b-motion', /.*/)
  await expect(counter).toHaveCSS('opacity', '1')
  await expect(page.locator('[data-b="s_hero"] [data-testid="builder-bg-video"] iframe')).toHaveCount(0)
  expect(external).toEqual([])
})
