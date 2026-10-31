import { expect, test, type Page } from '@playwright/test'

const envelope = (data: unknown) => ({ success: true, data, meta: { request_id: 'e2e' } })

let id = 0
const node = (label: string, url: string, extra: Record<string, unknown> = {}) => ({
  id: `n-${++id}`, label, url, open_in_new_tab: false, is_mega: false, mega_columns: null, image: null, children: [], ...extra,
})

function bootstrap(overrides: Record<string, unknown> = {}) {
  return {
    store: { name: 'Berry Kids', description: 'Clothes and toys for little ones' },
    preview: false,
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
      announcement: { text: 'Free delivery over ৳2000', link: '/shipping', background: '#2fb79a', foreground: '#062b22' },
      footer: { about: 'Since 2020', copyright: null, contact: { email: 'hello@berry.test', phone: null, address: null }, social: {}, payment_logos: [] },
      custom_css: null,
    },
    menus: {
      main: {
        name: 'Main',
        items: [
          node('Boys', '/boys', {
            is_mega: true,
            mega_columns: 3,
            children: [node('Clothing', '/boys/clothing', { children: [node('T-shirts', '/boys/clothing/t-shirts')] }), node('Shoes', '/boys/shoes')],
          }),
          node('Girls', '/girls', { children: [node('Dresses', '/girls/dresses')] }),
          node('Contact', '/contact'),
        ],
      },
      footer_1: { name: 'Help', items: [node('Shipping', '/shipping')] },
    },
    ...overrides,
  }
}

async function serveStore(page: Page, data: unknown, sections: unknown[] = []) {
  await page.route('**/api/v1/store/bootstrap', (route) => route.fulfill({ json: envelope(data) }))
  await page.route('**/api/v1/store/homepage*', (route) => route.fulfill({ json: envelope({ sections, preview: false }) }))
  // A guest with an empty cart (E7 header).
  await page.route('**/api/v1/store/account/me', (route) => route.fulfill({ json: envelope(null) }))
  await page.route('**/api/v1/store/cart', (route) =>
    route.fulfill({ json: envelope({ id: null, items: [], item_count: '0', subtotal: '0.00', discount_total: '0.00', tax_total: '0.00', total: '0.00', prices_include_tax: true, currency: 'BDT', issues: [], promotions: [], free_shipping: null, coupon: null }) }),
  )
}

const image = { id: 'img-1', url: '/favicon.svg', srcset: '/favicon.svg 1600w', width: 1600, height: 600, alt: null }
const banner = (id: string, extra: Record<string, unknown> = {}) => ({
  id, kicker: null, title: null, subtitle: null, link_url: null, button_label: null, secondary_link_url: null, secondary_button_label: null,
  image, mobile_image: null, text_color: '#3d3d3d', text_position: 'left', ...extra,
})

test('the storefront shows the store with its header, navigation and footer', async ({ page }) => {
  await serveStore(page, bootstrap())
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1, name: 'Berry Kids' })).toBeVisible()
  await expect(page.getByTestId('announcement-bar')).toContainText('Free delivery over ৳2000')
  await expect(page.getByTestId('site-footer').getByRole('navigation', { name: 'Help' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'hello@berry.test' })).toHaveAttribute('href', 'mailto:hello@berry.test')
  await expect(page).toHaveTitle('Berry Kids')
})

test('desktop navigation opens dropdowns on hover and mega menus from the keyboard', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Desktop navigation')
  await serveStore(page, bootstrap())
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: 'Main' })

  await nav.getByRole('link', { name: 'Girls' }).hover()
  await expect(nav.getByRole('link', { name: 'Dresses' })).toBeVisible()
  await page.mouse.move(0, 600)
  await expect(nav.getByRole('link', { name: 'Dresses' })).toBeHidden()

  const boysToggle = nav.getByRole('button', { name: 'Boys submenu' })
  await boysToggle.focus()
  await page.keyboard.press('Enter')
  await expect(boysToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByTestId('mega-panel').getByRole('link', { name: 'T-shirts' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('mega-panel')).toBeHidden()
  await expect(boysToggle).toBeFocused()
})

test('mobile navigation lives in a drawer', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile navigation')
  await serveStore(page, bootstrap())
  await page.goto('/')

  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden()
  await page.getByRole('button', { name: 'Open menu' }).click()
  const drawer = page.getByRole('dialog')
  await drawer.getByRole('button', { name: 'Girls submenu' }).click()
  await drawer.getByRole('link', { name: 'Dresses' }).click()

  // Choosing a link closes the drawer; /girls/dresses has no page in this phase yet.
  await expect(drawer).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
})

test('the announcement links inside the store and unknown pages are not found', async ({ page }) => {
  await serveStore(page, bootstrap())
  await page.goto('/')

  await page.getByTestId('announcement-bar').getByRole('link', { name: 'Free delivery over ৳2000' }).click()
  await expect(page).toHaveURL(/\/shipping$/)
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()

  await page.getByRole('link', { name: 'Back to the home page' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Berry Kids' })).toBeVisible()
})

test('a closed store can be previewed and an unknown address explains itself', async ({ page }) => {
  await serveStore(page, bootstrap({ preview: true }))
  await page.goto('/')
  await expect(page.getByText('Preview — this store is not open to customers yet.')).toHaveAttribute('role', 'status')

  await page.unroute('**/api/v1/store/bootstrap')
  await page.route('**/api/v1/store/bootstrap', (route) =>
    route.fulfill({
      status: 404,
      json: { success: false, error: { code: 'STOREFRONT_NOT_FOUND', message: 'There is no open store at this address.', details: {} }, meta: { request_id: 'e2e' } },
    }),
  )
  await page.reload()
  await expect(page.getByRole('heading', { name: 'There is no open store at this address' })).toBeVisible()
})

test('homepage sections render in order and link to content pages', async ({ page }) => {
  await serveStore(page, bootstrap(), [
    { id: 's-1', type: 'hero_slider', title: null, subtitle: null, config: { autoplay_seconds: 0, height: 'large' }, banners: [
      banner('b-1', { kicker: 'Online', title: 'Flat 20% off', button_label: 'Our story', link_url: '/pages/about' }),
      banner('b-2', { title: 'New arrivals' }),
    ] },
    { id: 's-2', type: 'features_strip', title: 'Why us', subtitle: null, config: { items: [{ icon: 'truck', title: 'Fast delivery', text: null }], background: null } },
    { id: 's-3', type: 'newsletter', title: 'Weekly offers', subtitle: null, config: { text: null, button_label: 'Subscribe', image: null, background: '#c2410c', foreground: '#ffffff' } },
  ])
  await page.route('**/api/v1/store/pages/about', (route) =>
    route.fulfill({ json: envelope({ slug: 'about', title: 'About us', template: 'default', body_html: '<h2>Since 2020</h2><p>Clothes for little ones.</p>', published_at: null, seo_title: null, seo_description: null, updated_at: null }) }),
  )
  await page.route('**/api/v1/store/newsletter', (route) => route.fulfill({ status: 202, json: envelope({ message: 'Almost done: check your inbox and confirm your subscription.' }) }))
  await page.goto('/')

  await expect(page.getByTestId('homepage-section')).toHaveCount(3)
  const types = await page.getByTestId('homepage-section').evaluateAll((els) => els.map((el) => el.getAttribute('data-section-type')))
  expect(types).toEqual(['hero_slider', 'features_strip', 'newsletter'])

  const carousel = page.getByRole('region', { name: 'Featured' })
  await expect(carousel.getByRole('heading', { name: 'Flat 20% off' })).toBeVisible()
  await carousel.getByRole('button', { name: 'Next slide' }).click()
  await expect(carousel.getByRole('heading', { name: 'New arrivals' })).toBeVisible()
  await carousel.getByRole('button', { name: 'Previous slide' }).click()

  await page.getByLabel('E-mail address').fill('mina@example.com')
  await page.getByRole('button', { name: 'Subscribe' }).click()
  await expect(page.getByText('Almost done: check your inbox and confirm your subscription.')).toBeVisible()

  await carousel.getByRole('link', { name: 'Our story' }).click()
  await expect(page).toHaveURL(/\/pages\/about$/)
  await expect(page.getByRole('heading', { level: 1, name: 'About us' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Since 2020' })).toBeVisible()
  await expect(page).toHaveTitle('About us | Berry Kids')
})

test('a hot deals section counts down and hides itself when the sale ends', async ({ page }) => {
  await serveStore(page, bootstrap())
  const card = (slug: string, name: string, endsAt: string) => ({
    id: `p-${slug}`, slug, name, url: `/product/${slug}`, image: { url: '/favicon.svg', alt: name }, hover_image: null, price: '120.00', price_max: '120.00',
    compare_at_price: null, on_sale: false, discount_percent: null, in_stock: true, is_new: false, is_featured: false, brand: null, category: null,
    variant_count: 1, default_variant_id: `v-${slug}`, short_description: null,
    promotion: { id: 'pr-1', name: 'Juice week', type: 'percent', value: '10.00', ends_at: endsAt, show_countdown: true, price: '108.00' },
  })
  // The sale ends 6 s after the page first asks (a cold dev server can take a while to load);
  // afterwards the homepage has no deals any more.
  let endsAt: number | null = null
  let readsAfterEnd = 0
  await page.route('**/api/v1/store/homepage*', (route) => {
    endsAt ??= Date.now() + 6_000
    const live = Date.now() < endsAt
    if (!live) readsAfterEnd += 1
    const iso = new Date(endsAt).toISOString()
    const sections = live
      ? [{ id: 'hd-1', type: 'hot_deals', title: 'Flash sale', subtitle: null, config: { promotion_id: null, limit: 8 }, ends_at: iso, products: [card('mango-juice', 'Mango Juice', iso), card('lychee-juice', 'Lychee Juice', iso)] }]
      : []
    return route.fulfill({ json: envelope({ sections, preview: false }) })
  })
  await page.goto('/')

  const deals = page.getByTestId('hot-deals')
  await expect(deals.getByRole('heading', { level: 2, name: 'Flash sale' })).toBeVisible()
  await expect(deals.getByTestId('product-card')).toHaveCount(2)
  await expect(deals.getByTestId('product-card').first().getByTestId('promotion-badge')).toHaveText('Offer: −10 %')
  await expect(deals.getByTestId('product-card').first().getByTestId('price')).toHaveText(/^Sale price: ৳?108\.00$/)
  await expect(deals.getByTestId('countdown-time').first()).toHaveAttribute('data-remaining', /^00:00:0\d$/)

  await expect(deals).toBeHidden({ timeout: 15_000 })
  // The section asked for a fresh homepage when it ended.
  await expect.poll(() => readsAfterEnd).toBeGreaterThanOrEqual(1)
})
