import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

/*
 * Store builder front page (B1) on a mocked store: the published render payload of the shared
 * sample document is drawn with its compiled responsive styles — side-by-side columns, the
 * desktop type scale and the spacer on a 1366 px desktop; stacked columns, the mobile type scale,
 * a full-width button and no spacer on a 375 px phone.
 */

const envelope = (data: unknown) => ({ success: true, data, meta: { request_id: 'e2e' } })

type Node = { id: string; hidden?: boolean; translations?: unknown; columns?: { elements: Node[] }[] } & Record<string, unknown>

const sample = JSON.parse(readFileSync(new URL('../src/storefront/builder/__fixtures__/sample-document.v1.json', import.meta.url), 'utf8')) as { sections: Node[] }

/** The published tree as the API resolves it in English: hidden nodes dropped, translations removed. */
function published(nodes: Node[]): Node[] {
  return nodes
    .filter((node) => node.hidden !== true)
    .map(({ translations: _translations, ...node }) => ({
      ...node,
      ...(node.columns ? { columns: node.columns.map((column) => ({ ...column, elements: published(column.elements) })) } : {}),
    }))
}

const image = { id: 'img-1', url: '/favicon.svg', srcset: '/favicon.svg 1600w', width: 1600, height: 600, alt: null }

const product = (slug: string, name: string) => ({
  id: `p-${slug}`, slug, name, url: `/product/${slug}`, image: { url: '/favicon.svg', alt: name }, hover_image: null, price: '120.00', price_max: '120.00',
  compare_at_price: null, on_sale: false, discount_percent: null, in_stock: true, is_new: false, is_featured: false, brand: null, category: null,
  variant_count: 1, default_variant_id: `v-${slug}`, short_description: null, promotion: null,
})

const page = {
  document: { id: '01a1c9d9-0000-7000-8000-0000000000d1', key: 'home', title: 'Home', version: 1, source: 'published' },
  sections: published(sample.sections),
  media: { '01a1c9d9-0000-7000-8000-000000000002': { url: '/favicon.svg', srcset: '/favicon.svg 1600w', width: 1600, height: 1200, alt: null } },
  data: {
    e_slider: {
      id: 'e_slider', type: 'hero_slider', title: null, subtitle: null, config: { autoplay_seconds: 0, height: 'large' },
      banners: [{ id: 'b-1', kicker: null, title: 'Farm boxes are back', subtitle: null, link_url: '/shop', button_label: 'Order a box', secondary_link_url: null, secondary_button_label: null, image, mobile_image: null, text_color: '#ffffff', text_position: 'left' }],
    },
    e_grid: {
      id: 'e_grid', type: 'product_grid', title: 'Best sellers', subtitle: 'What everyone is buying', config: { source: 'best_sellers', limit: 8, columns: 4, view_all_url: '/shop?sort=popularity' },
      products: [product('spinach', 'Fresh Spinach'), product('carrots', 'Organic Carrots')],
    },
  },
}

const bootstrap = {
  store: { name: 'Green Basket', description: 'Organic groceries', prices_include_tax: true, currency: 'BDT' },
  preview: false,
  builder: { home: true },
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

async function serveStore(page_: Page) {
  const homepageRequests: string[] = []
  await page_.route('**/api/v1/store/bootstrap*', (route) => route.fulfill({ json: envelope(bootstrap) }))
  await page_.route('**/api/v1/store/builder/pages/home*', (route) => route.fulfill({ json: envelope(page) }))
  await page_.route('**/api/v1/store/homepage*', (route) => {
    homepageRequests.push(route.request().url())
    return route.fulfill({ json: envelope({ sections: [], preview: false }) })
  })
  await page_.route('**/api/v1/store/account/me*', (route) => route.fulfill({ json: envelope(null) }))
  await page_.route('**/api/v1/store/cart*', (route) =>
    route.fulfill({ json: envelope({ id: null, items: [], item_count: '0', subtotal: '0.00', discount_total: '0.00', tax_total: '0.00', total: '0.00', prices_include_tax: true, currency: 'BDT', issues: [], promotions: [], free_shipping: null, coupon: null }) }),
  )
  return homepageRequests
}

const node = (p: Page, id: string) => p.locator(`[data-b="${id}"]`)

test('desktop 1366: columns side by side, desktop type scale, spacer shown, hover styles', async ({ page: p, isMobile }) => {
  test.skip(isMobile, 'desktop layout')
  await p.setViewportSize({ width: 1366, height: 900 })
  const homepageRequests = await serveStore(p)
  await p.goto('/')

  const heading = p.getByRole('heading', { level: 2, name: 'Made fresh every morning' })
  await expect(heading).toBeVisible()
  await expect(heading).toHaveCSS('font-size', '40px')
  await expect(heading).toHaveCSS('text-align', 'left')

  const text = (await node(p, 'c_story_text').boundingBox())!
  const media = (await node(p, 'c_story_media').boundingBox())!
  // Side by side: one row, vertically centred (layout.align), media to the right, both half the boxed width minus the 32px gap.
  expect(Math.abs(text.y + text.height / 2 - (media.y + media.height / 2))).toBeLessThan(2)
  expect(media.x).toBeGreaterThan(text.x + text.width)
  expect(Math.round(media.x - (text.x + text.width))).toBe(32)
  expect(Math.abs(text.width - media.width)).toBeLessThan(2)

  // The inner row's three feature columns share one line.
  const a = (await node(p, 'c_feat_a').boundingBox())!
  const c = (await node(p, 'c_feat_c').boundingBox())!
  expect(Math.abs(a.y - c.y)).toBeLessThan(2)
  await expect(node(p, 'e_spacer')).toBeVisible()
  await expect(node(p, 'e_spacer')).toHaveCSS('height', '48px')
  await expect(node(p, 'c_feat_a')).toHaveCSS('background-color', 'rgb(255, 255, 255)')

  // Anchored section, gradient background, image with alt text, wrapped homepage sections.
  await expect(p.locator('section#our-story')).toHaveCSS('background-image', /linear-gradient/)
  await expect(p.getByRole('img', { name: 'Fresh vegetables on a table' })).toBeVisible()
  await expect(p.getByRole('region', { name: 'Featured' }).getByRole('link', { name: 'Order a box' })).toBeVisible()
  await expect(p.getByRole('region', { name: 'Best sellers' }).getByTestId('product-card')).toHaveCount(2)
  await expect(p.getByText('Draft note, hidden from shoppers.')).toHaveCount(0)
  expect(homepageRequests).toEqual([])

  // Hover: accent background and a lift.
  const button = p.getByRole('link', { name: 'Shop now' })
  await button.hover()
  await expect(button).toHaveCSS('background-color', 'rgb(111, 85, 194)')
  await expect(button).toHaveCSS('transform', /matrix\(1, 0, 0, 1, 0, -2\)/)
})

test('mobile 375: columns stack, mobile type scale, full-width button, no spacer', async ({ page: p, isMobile }) => {
  test.skip(!isMobile, 'phone layout')
  await p.setViewportSize({ width: 375, height: 800 })
  await serveStore(p)
  await p.goto('/')

  const heading = p.getByRole('heading', { level: 2, name: 'Made fresh every morning' })
  await expect(heading).toBeVisible()
  await expect(heading).toHaveCSS('font-size', '28px')
  await expect(heading).toHaveCSS('text-align', 'center')

  const text = (await node(p, 'c_story_text').boundingBox())!
  const media = (await node(p, 'c_story_media').boundingBox())!
  // Stacked: the media column starts below the text column (16px mobile gap), same left edge and width.
  expect(Math.round(media.y - (text.y + text.height))).toBe(16)
  expect(Math.abs(media.x - text.x)).toBeLessThan(2)
  expect(Math.abs(media.width - text.width)).toBeLessThan(2)

  const button = (await p.getByRole('link', { name: 'Shop now' }).boundingBox())!
  expect(Math.abs(button.width - text.width)).toBeLessThan(2)

  // The spacer is hidden on phones; the divider stays.
  await expect(node(p, 'e_spacer')).toBeHidden()
  await expect(node(p, 'e_divider')).toBeVisible()
  // All three feature columns stack.
  const a = (await node(p, 'c_feat_a').boundingBox())!
  const b = (await node(p, 'c_feat_b').boundingBox())!
  expect(b.y).toBeGreaterThan(a.y + a.height - 1)
  await expect(p.locator('section#our-story')).toHaveCSS('padding-top', '32px')

  // No horizontal scrolling.
  expect(await p.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')).toBeLessThanOrEqual(0)
})
