import { expect, test, type Page } from '@playwright/test'

/*
 * B11: five new demo looks (fashion, electronics, grocery, beauty, furniture) on mocked data.
 * Each look is a theme preset made only of existing T1 layout options and B10 fonts, so a store
 * with the preset renders its header, top bar, cards, hero, footer, heading case and fonts; the
 * demo gallery lists nine stores 3 × 3 (one column on a phone); and the builder's two pictures of
 * each look (card thumbnail and tall preview, screenshots of the seeded stores) are served, small.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })

type Look = {
  colors: Record<string, string>
  typography: { heading_font: string; body_font: string }
  shape: { button_style: 'pill' | 'rounded' | 'square'; card_radius: number }
  layout: { container_width: number; sticky_header: boolean; header_style: string; footer_style: string; card_style: string; hero_style: string; heading_case: string; top_bar: string }
  /** The heading font's CSS family. */
  family: RegExp
}

// The backend's ThemePresets (B11), as defined there.
const LOOKS = {
  fashion: {
    colors: { primary: '#1c1917', primary_foreground: '#ffffff', accent: '#9f1239', accent_foreground: '#ffffff', highlight: '#a16207', sale: '#b91c1c', heading: '#1c1917', text: '#57534e', canvas: '#faf7f2', surface: '#ffffff', border: '#e7e0d6' },
    typography: { heading_font: 'playfair', body_font: 'poppins' },
    shape: { button_style: 'square', card_radius: 0 },
    layout: { container_width: 1320, sticky_header: true, header_style: 'standard', footer_style: 'widgets', card_style: 'minimal', hero_style: 'full', heading_case: 'uppercase', top_bar: 'ticker' },
    family: /Playfair Display/,
  },
  electronics: {
    colors: { primary: '#2563eb', primary_foreground: '#ffffff', accent: '#0f172a', accent_foreground: '#ffffff', highlight: '#0e7490', sale: '#c81e1e', heading: '#0f172a', text: '#475569', canvas: '#f4f6fa', surface: '#ffffff', border: '#e2e8f0' },
    typography: { heading_font: 'poppins', body_font: 'system' },
    shape: { button_style: 'rounded', card_radius: 8 },
    layout: { container_width: 1280, sticky_header: true, header_style: 'commerce', footer_style: 'columns', card_style: 'commerce', hero_style: 'sale', heading_case: 'normal', top_bar: 'utility' },
    family: /Poppins/,
  },
  grocery: {
    colors: { primary: '#15803d', primary_foreground: '#ffffff', accent: '#c2410c', accent_foreground: '#ffffff', highlight: '#0f766e', sale: '#be123c', heading: '#14532d', text: '#4b5563', canvas: '#f6f9f3', surface: '#ffffff', border: '#dde7d6' },
    typography: { heading_font: 'anek-bangla', body_font: 'hind-siliguri' },
    shape: { button_style: 'rounded', card_radius: 10 },
    layout: { container_width: 1280, sticky_header: true, header_style: 'commerce', footer_style: 'columns', card_style: 'standard', hero_style: 'full', heading_case: 'normal', top_bar: 'ticker' },
    family: /Anek Bangla/,
  },
  beauty: {
    colors: { primary: '#f2c4c9', primary_foreground: '#4a1530', accent: '#8e3b5f', accent_foreground: '#ffffff', highlight: '#a23b65', sale: '#b4234a', heading: '#3b1f2b', text: '#6b4f5a', canvas: '#fdf6f4', surface: '#ffffff', border: '#f1dfdc' },
    typography: { heading_font: 'tiro-bangla', body_font: 'jost' },
    shape: { button_style: 'pill', card_radius: 20 },
    layout: { container_width: 1200, sticky_header: false, header_style: 'standard', footer_style: 'showcase', card_style: 'standard', hero_style: 'tiles', heading_case: 'normal', top_bar: 'ticker' },
    family: /Tiro Bangla/,
  },
  furniture: {
    colors: { primary: '#2f4a3a', primary_foreground: '#ffffff', accent: '#8a5a2b', accent_foreground: '#ffffff', highlight: '#55703f', sale: '#b3261e', heading: '#24211d', text: '#5c564e', canvas: '#f5f1ea', surface: '#ffffff', border: '#e4dccf' },
    typography: { heading_font: 'jost', body_font: 'poppins' },
    shape: { button_style: 'square', card_radius: 2 },
    layout: { container_width: 1280, sticky_header: true, header_style: 'centered', footer_style: 'showcase', card_style: 'minimal', hero_style: 'full', heading_case: 'normal', top_bar: 'utility' },
    family: /Jost/,
  },
} as const satisfies Record<string, Look>

type Preset = keyof typeof LOOKS
const PRESETS = Object.keys(LOOKS) as Preset[]

const node = (id: string, label: string, url: string) => ({ id, label, url, open_in_new_tab: false, is_mega: false, mega_columns: null, image: null, children: [] })

function bootstrap(preset: Preset) {
  const { family: _family, ...look } = LOOKS[preset]
  return {
    store: { name: 'Demo Store', description: 'A demo store', prices_include_tax: true, currency: 'BDT' },
    preview: false,
    theme: {
      ...look,
      preset,
      logo: null,
      favicon: null,
      announcement: { text: 'Free delivery over ৳2000', link: '/shipping', background: look.colors.accent, foreground: '#ffffff' },
      footer: { about: 'A demo store.', copyright: null, contact: { email: 'hello@demo.test', phone: '+880 1711-000000', address: null }, social: { instagram: 'https://instagram.com/demo' }, payment_logos: [] },
      custom_css: null,
    },
    menus: {
      main: { name: 'Main', items: [node('n-1', 'New in', '/category/new'), node('n-2', 'Sale', '/category/sale')] },
      footer_1: { name: 'Help', items: [node('n-3', 'Shipping', '/shipping')] },
    },
  }
}

const image = { id: 'img-1', url: '/favicon.svg', srcset: '/favicon.svg 1600w', width: 1600, height: 600, alt: null }
const banner = (id: string, title: string) => ({
  id, kicker: 'This week', title, subtitle: null, link_url: '/category/new', button_label: 'Shop now', secondary_link_url: '/category/sale', secondary_button_label: 'Sale',
  image, mobile_image: null, text_color: '#ffffff', text_position: 'left',
})
const product = (slug: string, name: string) => ({
  id: `p-${slug}`, slug, name, url: `/product/${slug}`, image: { url: '/favicon.svg', alt: name }, hover_image: null, price: '1200.00', price_max: '1200.00',
  compare_at_price: '1500.00', on_sale: true, discount_percent: 20, in_stock: true, is_new: true, is_featured: true, brand: null, category: { name: 'New in', slug: 'new' },
  variant_count: 1, default_variant_id: `v-${slug}`, short_description: null, promotion: null, rating: { average: '4.5', count: 8 },
})
const products = [product('linen-shirt', 'Linen Shirt'), product('desk-lamp', 'Desk Lamp'), product('tea-tin', 'Tea Tin')]
const sections = [
  { id: 's-1', type: 'hero_slider', title: null, subtitle: null, config: { autoplay_seconds: 0, height: 'medium' }, banners: [banner('b-1', 'Season sale'), banner('b-2', 'New in'), banner('b-3', 'Gift ideas')] },
  { id: 's-2', type: 'product_grid', title: 'Best sellers', subtitle: null, config: { source: 'best_sellers', limit: 8, columns: 4 }, products },
]

async function serveStore(page: Page, preset: Preset) {
  await page.route('**/api/v1/store/bootstrap*', (route) => route.fulfill({ json: envelope(bootstrap(preset)) }))
  await page.route('**/api/v1/store/homepage*', (route) => route.fulfill({ json: envelope({ sections, preview: false }) }))
  await page.route('**/api/v1/store/account/me*', (route) => route.fulfill({ json: envelope(null) }))
  await page.route('**/api/v1/store/cart*', (route) =>
    route.fulfill({ json: envelope({ id: null, items: [], item_count: '0', subtotal: '0.00', discount_total: '0.00', tax_total: '0.00', total: '0.00', prices_include_tax: true, currency: 'BDT', issues: [], promotions: [], free_shipping: null, coupon: null }) }),
  )
  await page.route('**/api/v1/store/products?*', (route) =>
    route.fulfill({ json: { ...envelope(products, { current_page: 1, per_page: 12, total: products.length, last_page: 1 }), facets: null, context: null } }),
  )
  await page.route('**/api/v1/store/blog?*', (route) =>
    route.fulfill({ json: envelope([{ slug: 'care-guide', title: 'A short care guide', excerpt: null, cover: null, category: null, author: null, published_at: '2026-10-01T10:00:00Z', reading_minutes: 4 }], { current_page: 1, per_page: 9, total: 1, last_page: 1 }) }),
  )
}

for (const preset of PRESETS) {
  const look = LOOKS[preset]
  test(`${preset}: the preset's header, top bar, cards, footer, heading case and fonts`, async ({ page, isMobile }) => {
    await serveStore(page, preset)
    await page.goto('/')

    const html = page.locator('html')
    await expect(html).toHaveAttribute('data-sf-preset', preset)
    for (const [attribute, value] of [['data-sf-header', look.layout.header_style], ['data-sf-card', look.layout.card_style], ['data-sf-footer', look.layout.footer_style], ['data-sf-hero', look.layout.hero_style], ['data-sf-top-bar', look.layout.top_bar]] as const) {
      await expect(html).toHaveAttribute(attribute, value)
    }
    const card = page.getByTestId('product-card').first()
    if (look.layout.card_style === 'standard') await expect(card).not.toHaveAttribute('data-card-style', /.+/)
    else await expect(card).toHaveAttribute('data-card-style', look.layout.card_style)
    const heading = page.getByRole('heading', { level: 2, name: 'Best sellers' })
    await expect(heading).toHaveCSS('font-family', look.family)
    await expect(heading).toHaveCSS('text-transform', look.layout.heading_case === 'uppercase' ? 'uppercase' : 'none')
    // The canvas colour paints the page; no horizontal scrolling on any viewport.
    expect(await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')).toBeLessThanOrEqual(0)

    if (look.layout.hero_style === 'tiles') await expect(page.getByTestId('hero-tile')).toHaveCount(3)
    if (look.layout.hero_style === 'sale') await expect(page.getByTestId('sale-banner-text').first()).toBeVisible()
    const footer = page.getByTestId('site-footer')
    if (look.layout.footer_style === 'columns') await expect(footer).not.toHaveAttribute('data-footer-style', /.+/)
    else await expect(footer).toHaveAttribute('data-footer-style', look.layout.footer_style)

    if (look.layout.top_bar === 'ticker') await expect(page.getByRole('region', { name: 'Announcement' })).toBeVisible()

    const header = page.getByTestId('site-header')
    if (isMobile) {
      // Phones always get the compact header.
      await expect(header).not.toHaveAttribute('data-header-style', /.+/)
      await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible()
      return
    }
    if (look.layout.header_style === 'standard') await expect(header).not.toHaveAttribute('data-header-style', /.+/)
    else await expect(header).toHaveAttribute('data-header-style', look.layout.header_style)
    if (look.layout.header_style === 'commerce') await expect(page.getByRole('navigation', { name: 'Main' })).toHaveAttribute('data-appearance', 'commerce')
    if (look.layout.top_bar === 'utility') await expect(page.getByTestId('utility-bar').getByRole('link', { name: 'hello@demo.test' })).toBeVisible()
  })
}

/* ---------------------------------------------------------------------------------------------- */

const STORES = [
  { preset: 'vegan', name: 'Green Basket', heading_font: 'baloo' },
  { preset: 'handmade', name: 'Mati & Co.', heading_font: 'playfair' },
  { preset: 'classic', name: 'Classic Shop', heading_font: 'jost' },
  { preset: 'kids', name: 'Little Sprouts', heading_font: 'baloo' },
  { preset: 'fashion', name: 'Loom & Lane', heading_font: 'playfair' },
  { preset: 'electronics', name: 'Circuit Bazar', heading_font: 'poppins' },
  { preset: 'grocery', name: 'Bazar Fresh', heading_font: 'anek-bangla' },
  { preset: 'beauty', name: 'Blush & Bloom', heading_font: 'tiro-bangla' },
  { preset: 'furniture', name: 'Kath & Home', heading_font: 'jost' },
].map((store) => ({
  ...store, host: `${store.preset}.shop.localhost`, tagline: null, colors: { primary: '#1c1917', accent: '#9f1239', canvas: '#faf7f2' }, image_url: '/favicon.svg', product_count: 20, category_names: ['One', 'Two'],
}))

test('the demo gallery lists nine stores: 3 × 3 on a wide screen, one column on a phone', async ({ page, isMobile, baseURL }) => {
  await page.route('**/api/v1/demo-stores*', (route) => route.fulfill({ json: envelope(STORES) }))
  await page.goto('/demos')

  const cards = page.getByRole('list', { name: 'Demo stores' }).getByRole('article')
  await expect(cards).toHaveCount(9)
  const port = new URL(baseURL!).port
  const labels: Record<string, string> = { fashion: 'Fashion', electronics: 'Electronics', grocery: 'Grocery', beauty: 'Beauty', furniture: 'Furniture' }
  for (const store of STORES.slice(4)) {
    const card = page.getByRole('article', { name: store.name })
    await expect(card.getByText(`Theme: ${labels[store.preset]}`)).toBeVisible()
    await expect(card.getByRole('link', { name: `Open store: ${store.name}` })).toHaveAttribute('href', `http://${store.host}:${port}/`)
  }
  await expect(page.getByRole('article', { name: 'Bazar Fresh' }).getByRole('heading', { level: 2 })).toHaveCSS('font-family', /Anek Bangla/)
  await expect(page.getByRole('article', { name: 'Blush & Bloom' }).getByRole('heading', { level: 2 })).toHaveCSS('font-family', /Tiro Bangla/)

  const boxes = await Promise.all(Array.from({ length: 9 }, async (_, index) => (await cards.nth(index).boundingBox())!))
  const columns = new Set(boxes.map((box) => Math.round(box.x)))
  const rows = new Set(boxes.map((box) => Math.round(box.y)))
  if (isMobile) {
    expect(columns.size).toBe(1)
    expect(rows.size).toBe(9)
  } else {
    expect(columns.size).toBe(3)
    expect(rows.size).toBe(3)
  }
  expect(await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')).toBeLessThanOrEqual(0)

  // In Bangla too.
  await page.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'বাংলা' }).click()
  await expect(page.getByRole('article', { name: 'Loom & Lane' }).getByText('থিম: ফ্যাশন')).toBeVisible()
  await expect(page.getByRole('article', { name: 'Kath & Home' }).getByText('থিম: ফার্নিচার')).toBeVisible()
})

test('the builder pictures of the new looks are served: a small card thumbnail and a tall preview each', async ({ request }) => {
  for (const preset of PRESETS) {
    const thumbnail = await request.get(`/builder-templates/site-${preset}.png`)
    expect(thumbnail.status(), preset).toBe(200)
    expect(thumbnail.headers()['content-type']).toContain('image/png')
    expect((await thumbnail.body()).length, preset).toBeLessThanOrEqual(120 * 1024)
    const preview = await request.get(`/builder-templates/site-${preset}-full.jpg`)
    expect(preview.status(), preset).toBe(200)
    expect(preview.headers()['content-type']).toContain('image/jpeg')
    expect((await preview.body()).length, preset).toBeLessThanOrEqual(400 * 1024)
  }
})
