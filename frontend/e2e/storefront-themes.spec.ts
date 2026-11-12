import { expect, test, type Locator, type Page } from '@playwright/test'

/*
 * Theme presets (T1) on a mocked store: each preset's layout variants render their landmarks on
 * desktop, and every preset falls back to the standard mobile header on a phone.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })

const PRESETS = {
  default: {
    colors: { primary: '#f59e0b', primary_foreground: '#3b2500', accent: '#6f55c2', accent_foreground: '#ffffff', highlight: '#2fb79a', sale: '#c2410c', heading: '#3d3d3d', text: '#5f6368', canvas: '#f3f7fa', surface: '#ffffff', border: '#e1e1e1' },
    typography: { heading_font: 'baloo', body_font: 'poppins' },
    shape: { button_style: 'pill', card_radius: 12 },
    layout: { container_width: 1170, sticky_header: true, header_style: 'standard', footer_style: 'columns', card_style: 'standard', hero_style: 'full', heading_case: 'normal', top_bar: 'none' },
  },
  vegan: {
    colors: { primary: '#f6c445', primary_foreground: '#3a2c00', accent: '#2e7d32', accent_foreground: '#ffffff', highlight: '#2e7d32', sale: '#c2410c', heading: '#1f3d1f', text: '#4b5a47', canvas: '#fbf8ef', surface: '#ffffff', border: '#e7e2d3' },
    typography: { heading_font: 'baloo', body_font: 'poppins' },
    shape: { button_style: 'pill', card_radius: 16 },
    layout: { container_width: 1170, sticky_header: true, header_style: 'standard', footer_style: 'columns', card_style: 'standard', hero_style: 'full', heading_case: 'lowercase', top_bar: 'ticker' },
  },
  handmade: {
    colors: { primary: '#9c4a2a', primary_foreground: '#ffffff', accent: '#3b2a20', accent_foreground: '#ffffff', highlight: '#5f7a4f', sale: '#9c2f1f', heading: '#2b1d14', text: '#5a4a3f', canvas: '#f7f2ea', surface: '#fffdf9', border: '#e6dccd' },
    typography: { heading_font: 'playfair', body_font: 'jost' },
    shape: { button_style: 'square', card_radius: 0 },
    layout: { container_width: 1240, sticky_header: false, header_style: 'centered', footer_style: 'showcase', card_style: 'minimal', hero_style: 'tiles', heading_case: 'normal', top_bar: 'utility' },
  },
  classic: {
    colors: { primary: '#111111', primary_foreground: '#ffffff', accent: '#1d4ed8', accent_foreground: '#ffffff', highlight: '#15803d', sale: '#dc2626', heading: '#111111', text: '#4b5563', canvas: '#ffffff', surface: '#ffffff', border: '#e5e7eb' },
    typography: { heading_font: 'jost', body_font: 'jost' },
    shape: { button_style: 'rounded', card_radius: 4 },
    layout: { container_width: 1170, sticky_header: true, header_style: 'commerce', footer_style: 'widgets', card_style: 'commerce', hero_style: 'sale', heading_case: 'uppercase', top_bar: 'utility' },
  },
  // K1: the backend's `kids` preset decides the real colours; these follow the spec (amber + dark text, lavender + white).
  kids: {
    colors: { primary: '#ffb020', primary_foreground: '#3d2800', accent: '#7a5cc8', accent_foreground: '#ffffff', highlight: '#1f7a63', sale: '#c24626', heading: '#444444', text: '#5c6166', canvas: '#f3f7fa', surface: '#ffffff', border: '#e1e1e1' },
    typography: { heading_font: 'baloo', body_font: 'poppins' },
    shape: { button_style: 'pill', card_radius: 16 },
    layout: { container_width: 1170, sticky_header: true, header_style: 'commerce', footer_style: 'columns', card_style: 'arched', hero_style: 'full', heading_case: 'normal', top_bar: 'none' },
  },
} as const

type Preset = keyof typeof PRESETS

const node = (id: string, label: string, url: string) => ({ id, label, url, open_in_new_tab: false, is_mega: false, mega_columns: null, image: null, children: [] })

type ThemeOverrides = { colors?: Record<string, string | null>; typography?: Record<string, number> }

function bootstrap(preset: Preset, overrides: ThemeOverrides = {}) {
  return {
    store: { name: 'Green Basket', description: 'Organic groceries', prices_include_tax: true, currency: 'BDT' },
    preview: false,
    theme: {
      ...PRESETS[preset],
      colors: { ...PRESETS[preset].colors, ...overrides.colors },
      typography: { ...PRESETS[preset].typography, ...overrides.typography },
      preset,
      logo: null,
      favicon: null,
      announcement: { text: 'Free delivery over ৳2000', link: '/shipping', background: '#1f3d1f', foreground: '#ffffff' },
      footer: { about: 'Fresh from local farms.', copyright: null, contact: { email: 'hello@basket.test', phone: '+880 1711-000000', address: null }, social: { instagram: 'https://instagram.com/basket' }, payment_logos: [] },
      custom_css: null,
    },
    menus: {
      main: { name: 'Main', items: [node('n-1', 'Vegetables', '/category/vegetables'), node('n-2', 'Fruits', '/category/fruits')] },
      footer_1: { name: 'Help', items: [node('n-3', 'Shipping', '/shipping')] },
    },
  }
}

const image = { id: 'img-1', url: '/favicon.svg', srcset: '/favicon.svg 1600w', width: 1600, height: 600, alt: null }
const banner = (id: string, title: string) => ({
  id, kicker: 'This week', title, subtitle: null, link_url: '/category/vegetables', button_label: 'Shop now', secondary_link_url: '/category/fruits', secondary_button_label: 'Fruits',
  image, mobile_image: null, text_color: '#ffffff', text_position: 'left',
})

const product = (slug: string, name: string) => ({
  id: `p-${slug}`, slug, name, url: `/product/${slug}`, image: { url: '/favicon.svg', alt: name }, hover_image: null, price: '120.00', price_max: '120.00',
  compare_at_price: '150.00', on_sale: true, discount_percent: 20, in_stock: true, is_new: true, is_featured: true, brand: null, category: { name: 'Vegetables', slug: 'vegetables' },
  variant_count: 1, default_variant_id: `v-${slug}`, short_description: null, promotion: null, rating: { average: '4.5', count: 8 },
})

const products = [product('spinach', 'Fresh Spinach'), product('carrots', 'Organic Carrots'), product('tomatoes', 'Cherry Tomatoes')]

const sections = [
  { id: 's-1', type: 'hero_slider', title: null, subtitle: null, config: { autoplay_seconds: 0, height: 'medium' }, banners: [banner('b-1', 'Big summer sale'), banner('b-2', 'Fresh picks'), banner('b-3', 'Farm boxes')] },
  { id: 's-2', type: 'product_grid', title: 'Best sellers', subtitle: null, config: { source: 'best_sellers', limit: 8, columns: 4 }, products },
]

async function serveStore(page: Page, preset: Preset, options: { theme?: ThemeOverrides; sections?: unknown[] } = {}) {
  await page.route('**/api/v1/store/bootstrap*', (route) => route.fulfill({ json: envelope(bootstrap(preset, options.theme)) }))
  await page.route('**/api/v1/store/homepage*', (route) => route.fulfill({ json: envelope({ sections: options.sections ?? sections, preview: false }) }))
  await page.route('**/api/v1/store/account/me*', (route) => route.fulfill({ json: envelope(null) }))
  await page.route('**/api/v1/store/cart*', (route) =>
    route.fulfill({ json: envelope({ id: null, items: [], item_count: '0', subtotal: '0.00', discount_total: '0.00', tax_total: '0.00', total: '0.00', prices_include_tax: true, currency: 'BDT', issues: [], promotions: [], free_shipping: null, coupon: null }) }),
  )
  await page.route('**/api/v1/store/products?*', (route) =>
    route.fulfill({ json: { ...envelope(products, { current_page: 1, per_page: 12, total: products.length, last_page: 1 }), facets: null, context: null } }),
  )
  await page.route('**/api/v1/store/blog?*', (route) =>
    route.fulfill({ json: envelope([{ slug: 'spring-salads', title: 'Five spring salads', excerpt: null, cover: null, category: null, author: null, published_at: '2026-10-01T10:00:00Z', reading_minutes: 4 }], { current_page: 1, per_page: 9, total: 1, last_page: 1 }) }),
  )
}

test('default: the standard header, announcement bar and link-column footer', async ({ page, isMobile }) => {
  await serveStore(page, 'default')
  await page.goto('/')

  await expect(page.getByTestId('announcement-bar')).toContainText('Free delivery over ৳2000')
  await expect(page.locator('html')).toHaveAttribute('data-sf-preset', 'default')
  await expect(page.getByTestId('site-header')).not.toHaveAttribute('data-header-style', /.+/)
  await expect(page.getByTestId('site-footer')).not.toHaveAttribute('data-footer-style', /.+/)
  if (!isMobile) await expect(page.getByRole('navigation', { name: 'Main' })).toHaveAttribute('data-appearance', 'bar')
})

test('vegan: a scrolling announcement, lowercase section headings, the standard header', async ({ page }) => {
  await serveStore(page, 'vegan')
  await page.goto('/')

  const ticker = page.getByRole('region', { name: 'Announcement' })
  await expect(ticker).toBeVisible()
  await expect(ticker.getByRole('link', { name: 'Free delivery over ৳2000' })).toHaveAttribute('href', '/shipping')
  await expect(ticker.getByRole('button', { name: 'Pause the announcement' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Best sellers' })).toHaveCSS('text-transform', 'lowercase')
  await expect(page.getByTestId('site-header')).not.toHaveAttribute('data-header-style', /.+/)
})

test('vegan: the ticker stands still for reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await serveStore(page, 'vegan')
  await page.goto('/')

  await expect(page.getByTestId('announcement-ticker')).toHaveAttribute('data-motion', 'static')
  await expect(page.getByTestId('announcement-ticker').getByRole('link', { name: 'Free delivery over ৳2000' })).toBeVisible()
})

test('handmade: centered brand, search panel, editorial tiles, minimal cards and the showcase footer', async ({ page, isMobile }) => {
  await serveStore(page, 'handmade')
  await page.goto('/')

  await expect(page.getByTestId('hero-tile')).toHaveCount(3)
  await expect(page.getByTestId('product-card').first()).toHaveAttribute('data-card-style', 'minimal')
  const footer = page.getByTestId('site-footer')
  await expect(footer).toHaveAttribute('data-footer-style', 'showcase')
  await expect(footer.getByRole('region', { name: 'Popular' }).getByRole('link', { name: 'Fresh Spinach' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Best sellers' })).toHaveCSS('font-family', /Playfair Display/)

  if (isMobile) {
    await expect(page.getByTestId('site-header')).not.toHaveAttribute('data-header-style', /.+/)
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible()
    await expect(page.getByTestId('utility-bar')).toHaveCount(0)
    return
  }
  const header = page.getByTestId('site-header')
  await expect(header).toHaveAttribute('data-header-style', 'centered')
  await expect(page.getByTestId('utility-bar').getByRole('link', { name: 'hello@basket.test' })).toBeVisible()
  const brand = header.getByRole('link', { name: 'Green Basket home' })
  const box = await brand.boundingBox()
  const viewport = page.viewportSize()!
  // The brand sits in the middle of the page.
  expect(Math.abs(box!.x + box!.width / 2 - viewport.width / 2)).toBeLessThan(40)
  await header.getByRole('button', { name: 'Open search' }).click()
  const panel = page.getByRole('dialog', { name: 'Search the store' })
  await expect(panel.getByRole('combobox', { name: 'Search products' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
})

test('classic: wide header search with cart total, sale hero, commerce cards and widget footer', async ({ page, isMobile }) => {
  await serveStore(page, 'classic')
  await page.goto('/')

  await expect(page.getByTestId('sale-banner-text').first().getByRole('heading', { name: 'Big summer sale' })).toHaveCSS('text-transform', 'uppercase')
  const card = page.getByTestId('product-card').first()
  await expect(card).toHaveAttribute('data-card-style', 'commerce')
  await expect(card.getByRole('button', { name: 'Add Fresh Spinach to the cart' })).toBeVisible()
  const footer = page.getByTestId('site-footer')
  await expect(footer).toHaveAttribute('data-footer-style', 'widgets')
  await expect(footer.getByRole('region', { name: 'Latest posts' }).getByRole('link', { name: 'Five spring salads' })).toBeVisible()
  await expect(footer.getByRole('form', { name: 'Newsletter' })).toBeVisible()

  if (isMobile) {
    await expect(page.getByTestId('site-header')).not.toHaveAttribute('data-header-style', /.+/)
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible()
    return
  }
  const header = page.getByTestId('site-header')
  await expect(header).toHaveAttribute('data-header-style', 'commerce')
  await expect(header.getByRole('combobox', { name: 'Search products' })).toBeVisible()
  await expect(header.getByRole('button', { name: 'Cart, 0 items, ৳0.00' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveAttribute('data-appearance', 'commerce')
  // Hover actions appear on keyboard focus too.
  const quickView = card.getByRole('button', { name: 'Quick view: Fresh Spinach' })
  await quickView.focus()
  await expect(quickView).toBeVisible()
  await expect(card.getByTestId('card-hover-actions')).toHaveCSS('opacity', '1')
})

test('kids: arched cards with a sale ribbon and hover actions, the commerce header with a lavender menu bar', async ({ page, isMobile }) => {
  // The first product is plain, the second on sale.
  const plain = { ...product('teether', 'Wooden Teether'), on_sale: false, compare_at_price: null, discount_percent: null, is_new: false }
  const grid = { ...sections[1], products: [plain, ...products] }
  await serveStore(page, 'kids', { sections: [sections[0], grid] })
  await page.goto('/')

  await expect(page.locator('html')).toHaveAttribute('data-sf-preset', 'kids')
  const cards = page.getByTestId('product-card')
  const card = cards.nth(1)
  await expect(card).toHaveAttribute('data-card-style', 'arched')
  await expect(card).toBeVisible()
  // The corner ribbon on the sale product only.
  await expect(card.getByTestId('sale-ribbon')).toHaveText('−20 %')
  await expect(card.getByTestId('sale-ribbon')).toBeVisible()
  await expect(cards.first().getByTestId('sale-ribbon')).toHaveCount(0)
  // The caption block: primary with its dark text at rest.
  const caption = card.getByTestId('arched-caption')
  await expect(caption).toHaveCSS('background-color', 'rgb(255, 176, 32)')
  await expect(caption.getByRole('heading', { name: 'Fresh Spinach' })).toHaveCSS('color', 'rgb(61, 40, 0)')
  const cart = card.getByRole('button', { name: 'Add Fresh Spinach to the cart' })

  if (isMobile) {
    // Touch: the actions are a row under the price, visible without hovering.
    await expect(cart).toBeVisible()
    await expect(cart).toHaveCSS('opacity', '1')
    await expect(card.getByTestId('card-actions')).toHaveCSS('display', 'flex')
    await expect(card.getByRole('button', { name: 'Quick view: Fresh Spinach' })).toBeVisible()
    return
  }

  await expect(page.getByTestId('site-header')).toHaveAttribute('data-header-style', 'commerce')
  // The commerce menu bar follows the accent for this preset (classic keeps the dark bar).
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav).toHaveAttribute('data-appearance', 'commerce')
  await expect(nav).toHaveCSS('background-color', 'rgb(122, 92, 200)')
  await expect(nav.getByRole('link', { name: 'Vegetables' })).toHaveCSS('color', 'rgb(255, 255, 255)')

  // Hidden at rest; hovering turns the block lavender and brings the cart button onto the arch.
  const floating = card.getByTestId('card-actions').locator('> div').first()
  await expect(floating).toHaveCSS('opacity', '0')
  await card.hover()
  await expect(floating).toHaveCSS('opacity', '1')
  await expect(cart).toBeVisible()
  await expect(caption).toHaveCSS('background-color', 'rgb(122, 92, 200)')
  await expect(caption.getByRole('heading', { name: 'Fresh Spinach' })).toHaveCSS('color', 'rgb(255, 255, 255)')
  await expect(card.getByTestId('card-hover-actions')).toHaveCSS('opacity', '1')
  // The cart sits on the arch: centred over the top edge of the caption block.
  const [cartBox, captionBox] = [await cart.boundingBox(), await caption.boundingBox()]
  expect(Math.abs(cartBox!.x + cartBox!.width / 2 - (captionBox!.x + captionBox!.width / 2))).toBeLessThan(2)
  expect(cartBox!.y).toBeLessThan(captionBox!.y)

  // Keyboard: focusing a card's action reveals them on another card too.
  await page.mouse.move(0, 0)
  const other = cards.nth(2)
  const otherCart = other.getByRole('button', { name: 'Add Organic Carrots to the cart' })
  await otherCart.focus()
  await expect(other.getByTestId('card-actions').locator('> div').first()).toHaveCSS('opacity', '1')
  await expect(other.getByTestId('arched-caption')).toHaveCSS('background-color', 'rgb(122, 92, 200)')
})

test('classic keeps the dark commerce menu bar', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The menu bar is desktop-only.')
  await serveStore(page, 'classic')
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCSS('background-color', 'rgb(17, 17, 17)')
})

/* B3: the theme's colour roles and type scale. */

const withViewAll = sections.map((section) => (section.type === 'product_grid' ? { ...section, config: { ...section.config, view_all_url: '/shop' } } : section))

const px = (value: string) => Number.parseFloat(value)

/** A computed style of the element (the e2e project has no DOM types). */
const computed = (locator: Locator, property: string) =>
  locator.evaluate((el, name) => (globalThis as unknown as { getComputedStyle(e: unknown): Record<string, string> }).getComputedStyle(el)[name] ?? '', property)

/** The heading size the type scale gives a Tailwind step (src/storefront/type-scale.ts). */
const headingStepPx = (step: number, body: number, ratio: number) => step * (body / 16) * (ratio / 1.25) ** (Math.log(step / 16) / Math.log(1.25))

test('B3 defaults: a theme from before B3 keeps today’s sizes, buttons and links', async ({ page, isMobile }) => {
  await serveStore(page, 'default', { sections: withViewAll })
  await page.goto('/')

  const body = page.locator('body')
  await expect(body).toHaveCSS('font-size', '16px')
  await expect(body).toHaveCSS('line-height', '24px')
  const heading = page.getByRole('heading', { level: 2, name: 'Best sellers' })
  await expect(heading).toHaveCSS('font-size', isMobile ? '30px' : '36px')
  await expect(heading).toHaveCSS('font-weight', '800')
  await expect(heading).toHaveCSS('letter-spacing', 'normal')
  await expect(page.locator('html')).toHaveAttribute('data-sf-button-hover', 'auto')

  // "View all" is a theme button: the primary pair, and the automatic brightness hover.
  const viewAll = page.getByRole('link', { name: 'View all' })
  await expect(viewAll).toHaveCSS('background-color', 'rgb(245, 158, 11)')
  await expect(viewAll).toHaveCSS('color', 'rgb(59, 37, 0)')
  if (!isMobile) {
    await viewAll.hover()
    await expect(viewAll).toHaveCSS('filter', 'brightness(1.05)')
    await expect(viewAll).toHaveCSS('background-color', 'rgb(245, 158, 11)')
  }
})

test('B3 theme: button, hover and link colours and the type scale reach the storefront', async ({ page, isMobile }) => {
  const typography = { body_size: 18, heading_scale: 1.4, line_height: 1.7, heading_weight: 800, mobile_scale: 0.85, letter_spacing: 0.02 }
  await serveStore(page, 'default', {
    sections: withViewAll,
    theme: { colors: { button: '#1d4ed8', button_foreground: '#ffffff', button_hover: '#1e3a8a', link: '#be123c' }, typography },
  })
  await page.goto('/')

  await expect(page.locator('body')).toHaveCSS('font-size', '18px')
  await expect(page.locator('body')).toHaveCSS('line-height', '30.6px')
  const heading = page.getByRole('heading', { level: 2, name: 'Best sellers' })
  // text-3xl on phones (× the mobile scale), lg:text-4xl on desktops.
  const expected = isMobile ? headingStepPx(30, 18, 1.4) * 0.85 : headingStepPx(36, 18, 1.4)
  await expect.poll(async () => px(await computed(heading, 'fontSize'))).toBeCloseTo(expected, 1)
  // font-extrabold (800) shifted by 800 − 700.
  await expect(heading).toHaveCSS('font-weight', '900')
  expect(px(await computed(heading, 'letterSpacing'))).toBeCloseTo(0.02 * expected, 1)
  await expect(page.locator('html')).toHaveAttribute('data-sf-button-hover', 'color')
  await expect(page.locator('html')).toHaveCSS('--sf-link', '#be123c')

  const viewAll = page.getByRole('link', { name: 'View all' })
  await expect(viewAll).toHaveCSS('background-color', 'rgb(29, 78, 216)')
  await expect(viewAll).toHaveCSS('color', 'rgb(255, 255, 255)')
  if (!isMobile) {
    await viewAll.hover()
    await expect(viewAll).toHaveCSS('background-color', 'rgb(30, 58, 138)')
    await expect(viewAll).toHaveCSS('filter', 'none')
  }
})
