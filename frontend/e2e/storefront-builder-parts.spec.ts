import { expect, test, type Page } from '@playwright/test'

/*
 * Store builder B4 on a mocked store: a builder header from 768 px (the compact header and drawer
 * on phones), a builder footer at every width, content zones around the shop grid, products per
 * row per device (default = today's grid, measured against the old classes), a CMS page designed
 * in the builder with a working FAQ accordion, and a video that loads only after a click.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })

const VISIBLE = { desktop: true, tablet: true, mobile: true }

type El = { id: string; type: string; props: Record<string, unknown> }

const element = (id: string, type: string, props: Record<string, unknown>) => ({ id, type, props, style: {}, visibility: VISIBLE })

/** A published render payload: one boxed section per row of elements (columns side by side). */
function payload(key: string, rows: El[][], data: Record<string, unknown> = {}, padding = 16) {
  return {
    document: { id: `01a1c9d9-0000-7000-8000-0000000000${key.length.toString(16).padStart(2, '0')}`, key, title: key, version: 1, source: 'published' },
    sections: rows.map((elements, i) => ({
      id: `s_${i}`,
      type: 'section',
      props: { layout: 'boxed', anchor: null },
      style: { base: { spacing: { padding: { top: `${padding}px`, bottom: `${padding}px` } }, layout: { align: 'center' } } },
      visibility: VISIBLE,
      columns: elements.map((el, j) => ({ id: `c_${i}_${j}`, type: 'column', width: { base: Math.floor(100 / elements.length), mobile: 100 }, style: {}, elements: [el] })),
    })),
    media: {},
    data,
  }
}

const menuItem = (id: string, label: string, url: string, children: unknown[] = []) => ({ id, label, url, open_in_new_tab: false, is_mega: false, mega_columns: null, image: null, children })

const header = payload(
  'header',
  [[element('e_logo', 'logo', { height: 40, link: { url: '/' } }), element('e_menu', 'menu', { menu_id: 'm', layout: 'horizontal', show_children: 'dropdown' }), element('e_search', 'search_box', { placeholder: 'Find fresh food', button_label: '' }), element('e_cart', 'cart_icon', { show_count: true, show_total: true })]],
  { e_menu: { name: 'Shop menu', items: [menuItem('m1', 'Fruits', '/category/fruits', [menuItem('m2', 'Mangoes', '/category/mangoes')]), menuItem('m3', 'Offers', '/pages/offers')] } },
)

const footer = payload('footer', [[element('e_copy', 'copyright', { text: '© {year} Green Basket — built with care' }), element('e_social', 'social_icons', { size: 24, style: 'circle', color: null })]], {}, 24)

const zone = (key: string, text: string) => payload(`zone:${key}`, [[element(`e_${key.replace('.', '_')}`, 'heading', { text, level: 2, link: null })]])

const theme = (listingColumns?: Record<string, number>) => ({
  colors: { primary: '#f59e0b', primary_foreground: '#3b2500', accent: '#6f55c2', accent_foreground: '#ffffff', highlight: '#2fb79a', sale: '#c2410c', heading: '#3d3d3d', text: '#5f6368', canvas: '#f3f7fa', surface: '#ffffff', border: '#e1e1e1' },
  typography: { heading_font: 'baloo', body_font: 'poppins' },
  shape: { button_style: 'pill', card_radius: 12 },
  layout: { container_width: 1170, sticky_header: true, ...(listingColumns ? { listing_columns: listingColumns } : {}) },
  logo: null,
  favicon: null,
  announcement: null,
  footer: { about: 'Organic groceries.', copyright: null, contact: { email: 'hi@green.test', phone: null, address: null }, social: { facebook: 'https://facebook.com/green' }, payment_logos: [] },
  custom_css: null,
})

const bootstrap = (builder: Record<string, unknown>, listingColumns?: Record<string, number>) => ({
  store: { name: 'Green Basket', description: 'Organic groceries', prices_include_tax: true, currency: 'BDT' },
  preview: false,
  builder: { home: false, ...builder },
  theme: theme(listingColumns),
  menus: { main: { name: 'Main', items: [menuItem('t1', 'Vegetables', '/category/vegetables')] } },
})

const card = (slug: string) => ({
  id: `p-${slug}`, slug, name: slug.replace(/-/g, ' '), url: `/product/${slug}`, image: { url: '/favicon.svg', alt: slug }, hover_image: null, price: '120.00', price_max: '120.00',
  compare_at_price: null, on_sale: false, discount_percent: null, in_stock: true, is_new: false, is_featured: false, brand: null, category: null,
  variant_count: 1, default_variant_id: `v-${slug}`, short_description: null, promotion: null,
})

async function serveStore(page: Page, boot: unknown, extra: (page: Page) => Promise<void> = async () => {}) {
  await page.route('**/api/v1/store/bootstrap*', (route) => route.fulfill({ json: envelope(boot) }))
  await page.route('**/api/v1/store/homepage*', (route) => route.fulfill({ json: envelope({ sections: [], preview: false }) }))
  await page.route('**/api/v1/store/account/me*', (route) => route.fulfill({ json: envelope(null) }))
  await page.route('**/api/v1/store/wishlist*', (route) => route.fulfill({ json: envelope({ items: [] }) }))
  await page.route('**/api/v1/store/cart*', (route) =>
    route.fulfill({ json: envelope({ id: null, items: [], item_count: '0', subtotal: '0.00', discount_total: '0.00', tax_total: '0.00', total: '0.00', prices_include_tax: true, currency: 'BDT', issues: [], promotions: [], free_shipping: null, coupon: null }) }),
  )
  await page.route((url) => url.pathname === '/api/v1/store/products', (route) => {
    const items = ['fresh-spinach', 'organic-carrots', 'red-apples', 'green-peas', 'sweet-corn', 'baby-potato'].map(card)
    return route.fulfill({
      json: {
        success: true,
        data: items,
        meta: { request_id: 'e2e', current_page: 1, per_page: 24, total: items.length, last_page: 1 },
        facets: null,
        context: { category: null, brand: null, q: null },
      },
    })
  })
  await extra(page)
}

const aboutPage = { slug: 'about', title: 'About us', template: 'default', body_html: '<p>Classic body.</p>', published_at: null, seo_title: null, seo_description: null, updated_at: null }

/** Columns of a grid as the browser lays it out. */
const gridColumns = (page: Page, selector: string) =>
  page.evaluate<number>(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).gridTemplateColumns.split(' ').filter(Boolean).length`)

test('builder header and footer at 1366 px', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop layout')
  await page.setViewportSize({ width: 1366, height: 900 })
  await serveStore(page, bootstrap({ header, footer }), async (p) => {
    await p.route('**/api/v1/store/pages/about*', (route) => route.fulfill({ json: envelope(aboutPage) }))
  })
  await page.goto('/pages/about')

  const siteHeader = page.getByTestId('site-header')
  await expect(siteHeader).toHaveAttribute('data-header-style', 'builder')
  await expect(siteHeader.getByRole('link', { name: 'Green Basket home' })).toBeVisible()
  const nav = siteHeader.getByRole('navigation', { name: 'Shop menu' })
  await expect(nav.getByRole('link', { name: 'Fruits' })).toBeVisible()
  // Dropdowns open on hover, like the theme navigation.
  await nav.getByRole('link', { name: 'Fruits' }).hover()
  await expect(nav.getByRole('link', { name: 'Mangoes' })).toBeVisible()
  await expect(siteHeader.getByPlaceholder('Find fresh food')).toBeVisible()
  await expect(siteHeader.getByTestId('cart-total-button')).toBeVisible()
  // One row: logo, menu, search and cart side by side.
  const logo = (await page.locator('[data-b="e_logo"]').boundingBox())!
  const cart = (await page.locator('[data-b="e_cart"]').boundingBox())!
  expect(Math.abs(logo.y + logo.height / 2 - (cart.y + cart.height / 2))).toBeLessThan(12)
  expect(cart.x).toBeGreaterThan(logo.x + 600)
  await expect(siteHeader).toHaveCSS('position', 'sticky')
  // Header and footer share node ids (s_0, c_0_0, …): each document's styles stay in its own scope.
  await expect(siteHeader.locator('[data-b="s_0"]')).toHaveCSS('padding-top', '16px')
  await expect(page.getByTestId('site-footer').locator('[data-b="s_0"]')).toHaveCSS('padding-top', '24px')

  const siteFooter = page.getByTestId('site-footer')
  await expect(siteFooter).toHaveAttribute('data-footer-style', 'builder')
  await expect(siteFooter.getByText(`© ${new Date().getFullYear()} Green Basket — built with care`)).toBeVisible()
  await expect(siteFooter.getByRole('link', { name: /Facebook/ })).toHaveAttribute('href', 'https://facebook.com/green')
  await expect(siteFooter.getByText('Organic groceries.')).toHaveCount(0)
})

test('compact header with its drawer at 375 px, builder footer still shown', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 })
  await serveStore(page, bootstrap({ header, footer }), async (p) => {
    await p.route('**/api/v1/store/pages/about*', (route) => route.fulfill({ json: envelope(aboutPage) }))
  })
  await page.goto('/pages/about')

  const siteHeader = page.getByTestId('site-header')
  await expect(siteHeader).toBeVisible()
  await expect(siteHeader).not.toHaveAttribute('data-header-style', 'builder')
  await expect(page.getByTestId('builder-header')).toHaveCount(0)
  await expect(siteHeader.getByRole('button', { name: 'Open search' })).toBeVisible()
  // The drawer uses the store's menus.
  await siteHeader.getByRole('button', { name: /menu/i }).click()
  await expect(page.getByRole('dialog').getByRole('link', { name: 'Vegetables' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('site-footer')).toHaveAttribute('data-footer-style', 'builder')
})

test('zones on /shop around the product grid', async ({ page }) => {
  await serveStore(page, bootstrap({ zones: { 'listing.top': zone('listing.top', 'Summer picks'), 'listing.bottom': zone('listing.bottom', 'Need help choosing?'), 'product.after': null } }))
  await page.goto('/shop')
  const results = page.getByTestId('product-results')
  await expect(results.getByTestId('product-card')).toHaveCount(6)
  const top = (await page.getByTestId('builder-zone-listing.top').boundingBox())!
  const grid = (await results.boundingBox())!
  const bottom = (await page.getByTestId('builder-zone-listing.bottom').boundingBox())!
  await expect(page.getByRole('heading', { name: 'Summer picks' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Need help choosing?' })).toBeVisible()
  expect(top.y + top.height).toBeLessThanOrEqual(grid.y)
  expect(grid.y + grid.height).toBeLessThanOrEqual(bottom.y)
})

test('products per row: default identical to the old grid at 1366 / 768 / 375, custom per device', async ({ page, isMobile }) => {
  test.skip(isMobile, 'viewport sizes are set explicitly')
  await serveStore(page, bootstrap({}))
  await page.setViewportSize({ width: 1366, height: 900 })
  await page.goto('/shop')
  await expect(page.getByTestId('product-results').getByTestId('product-card')).toHaveCount(6)
  // A reference list with today's classes (before B4), next to the results so it gets the same width.
  await page.evaluate(`(() => {
    const ref = document.createElement('ul')
    ref.id = 'reference-grid'
    ref.className = 'grid gap-3 sm:gap-5 grid-cols-2 md:grid-cols-3'
    for (let i = 0; i < 6; i++) ref.appendChild(document.createElement('li'))
    document.querySelector('[data-testid="product-results"]').after(ref)
  })()`)

  const measured: Record<number, [number, number]> = {}
  for (const width of [1366, 768, 375]) {
    await page.setViewportSize({ width, height: 900 })
    const after = await gridColumns(page, '[data-testid="product-results"]')
    const before = await gridColumns(page, '#reference-grid')
    measured[width] = [before, after]
    expect(after, `columns at ${width}px`).toBe(before)
  }
  expect(measured).toEqual({ 1366: [3, 3], 768: [3, 3], 375: [2, 2] })
  test.info().annotations.push({ type: 'parity', description: JSON.stringify(measured) })

  // A theme with 5 / 4 / 1 per row.
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await serveStore(page, bootstrap({}, { desktop: 5, tablet: 4, mobile: 1 }))
  await page.setViewportSize({ width: 1366, height: 900 })
  await page.goto('/shop')
  await expect(page.getByTestId('product-results').getByTestId('product-card')).toHaveCount(6)
  for (const [width, expected] of [[1366, 5], [768, 4], [375, 1]] as const) {
    await page.setViewportSize({ width, height: 900 })
    expect(await gridColumns(page, '[data-testid="product-results"]'), `custom columns at ${width}px`).toBe(expected)
  }
})

test('CMS page designed in the builder: FAQ accordion works, video loads only after a click', async ({ page }) => {
  const providerRequests: string[] = []
  await page.route(/youtube(-nocookie)?\.com|ytimg\.com|vimeo\.com/, (route) => {
    providerRequests.push(route.request().url())
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>player</title>' })
  })
  const builder = payload(
    'cms:01a1c9d9-0000-7000-8000-0000000000aa',
    [
      [element('e_faq', 'faq_list', { title: 'Good to know', style: 'accordion' })],
      [element('e_video', 'video', { url: 'https://youtu.be/dQw4w9WgXcQ', provider: 'youtube', video_id: 'dQw4w9WgXcQ', title: 'Our farm', aspect: '16:9', autoplay: false, start: 0 })],
    ],
    { e_faq: { groups: [{ group: 'Delivery', items: [{ id: 'q1', question: 'Do you deliver on Fridays?', answer_html: '<p>Yes, every day of the week.</p>' }] }] } },
  )
  await serveStore(page, bootstrap({}), async (p) => {
    await p.route('**/api/v1/store/pages/faq*', (route) =>
      route.fulfill({ json: envelope({ ...aboutPage, slug: 'faq', title: 'FAQ', template: 'faq', faq: [], seo_title: 'Questions and answers', builder }) }),
    )
  })
  await page.goto('/pages/faq')

  await expect(page.getByRole('heading', { level: 1, name: 'FAQ' })).toBeVisible()
  await expect(page).toHaveTitle(/Questions and answers/)
  const answer = page.getByText('Yes, every day of the week.')
  await expect(answer).toBeHidden()
  await page.getByText('Do you deliver on Fridays?').click()
  await expect(answer).toBeVisible()

  const video = page.getByTestId('builder-video')
  await video.scrollIntoViewIfNeeded()
  await expect(video.locator('iframe')).toHaveCount(0)
  expect(providerRequests).toEqual([])
  await video.getByRole('button', { name: 'Play video: Our farm' }).click()
  const frame = video.locator('iframe')
  await expect(frame).toHaveAttribute('src', /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/)
  await expect(frame).toHaveAttribute('title', 'Our farm')
  await expect.poll(() => providerRequests.length).toBeGreaterThan(0)
  expect(providerRequests.every((url) => url.startsWith('https://www.youtube-nocookie.com/'))).toBe(true)
})
