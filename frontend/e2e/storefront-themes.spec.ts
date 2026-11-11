import { expect, test, type Page } from '@playwright/test'

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
} as const

type Preset = keyof typeof PRESETS

const node = (id: string, label: string, url: string) => ({ id, label, url, open_in_new_tab: false, is_mega: false, mega_columns: null, image: null, children: [] })

function bootstrap(preset: Preset) {
  return {
    store: { name: 'Green Basket', description: 'Organic groceries', prices_include_tax: true, currency: 'BDT' },
    preview: false,
    theme: {
      ...PRESETS[preset],
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
