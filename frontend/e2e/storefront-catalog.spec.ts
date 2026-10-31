import { expect, test, type Page } from '@playwright/test'

/** Mocked public API (E6 contract): browse the shop → filter → product page → switch variant. */

const envelope = (data: unknown) => ({ success: true, data, meta: { request_id: 'e2e' } })

const bootstrap = {
  store: { name: 'Berry Kids', description: 'Clothes and toys for little ones', prices_include_tax: false, currency: 'BDT' },
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
    announcement: null,
    footer: { about: null, copyright: null, contact: { email: null, phone: null, address: null }, social: {}, payment_logos: [] },
    custom_css: null,
  },
  menus: { main: { name: 'Main', items: [{ id: 'n-1', label: 'Shop', url: '/shop', open_in_new_tab: false, is_mega: false, mega_columns: null, image: null, children: [] }] } },
}

const card = (slug: string, name: string, brand: { name: string; slug: string }, extra: Record<string, unknown> = {}) => ({
  id: `p-${slug}`, slug, name, url: `/product/${slug}`, image: { url: '/favicon.svg', alt: name }, hover_image: null,
  price: '450.00', price_max: '450.00', compare_at_price: null, on_sale: false, discount_percent: null, in_stock: true,
  is_new: false, is_featured: false, brand, category: { name: 'Clothing', slug: 'clothing' }, variant_count: 1, short_description: null, ...extra,
})

const freshCo = { name: 'Fresh Co', slug: 'fresh-co' }
const sunny = { name: 'Sunny', slug: 'sunny' }
const cards = [
  card('kids-tee', 'Kids Tee', freshCo, { price_max: '480.00', variant_count: 3, on_sale: true, is_new: true }),
  card('kids-shorts', 'Kids Shorts', sunny, { price: '350.00', price_max: '350.00' }),
  card('kids-cap', 'Kids Cap', sunny, { in_stock: false }),
]

function facets(brands: string[]) {
  return {
    categories: [{ slug: 'clothing', name: 'Clothing', count: 3 }],
    brands: [
      { slug: 'fresh-co', name: 'Fresh Co', count: 1, selected: brands.includes('fresh-co') },
      { slug: 'sunny', name: 'Sunny', count: 2, selected: brands.includes('sunny') },
    ],
    attributes: [{ slug: 'colour', name: 'Colour', display: 'swatch', values: [{ value: 'Red', swatch_hex: '#e11d48', count: 1, selected: false }, { value: 'Blue', swatch_hex: '#2563eb', count: 1, selected: false }] }],
    price: { min: '350.00', max: '480.00' },
    in_stock: { count: 2 },
    on_sale: { count: 1 },
  }
}

const variant = (id: string, colour: string, size: string, extra: Record<string, unknown> = {}) => ({
  id, sku: `TEE-${colour[0]}${size}`, name: `${colour} / ${size}`, option_values: { Colour: colour, Size: size }, price: '450.00',
  compare_at_price: null, on_sale: false, discount_percent: null, in_stock: true, low_stock: false, image_id: null, ...extra,
})

const tee = {
  id: 'p-kids-tee', slug: 'kids-tee', name: 'Kids Tee', url: '/product/kids-tee', short_description: 'Soft cotton tee.',
  description_html: '<p>Made from organic cotton.</p>', specifications: [{ label: 'Material', value: 'Cotton' }],
  brand: freshCo, category: { name: 'Clothing', slug: 'clothing' },
  breadcrumbs: [{ name: 'Home', url: '/' }, { name: 'Clothing', url: '/category/clothing' }, { name: 'Kids Tee', url: null }],
  images: [{ id: 'img-red', url: '/favicon.svg', alt: 'Red tee' }, { id: 'img-blue', url: '/favicon.svg', alt: 'Blue tee' }],
  options: [
    { name: 'Colour', slug: 'colour', display: 'swatch', values: [{ value: 'Red', swatch_hex: '#e11d48' }, { value: 'Blue', swatch_hex: '#2563eb' }] },
    { name: 'Size', slug: 'size', display: 'button', values: [{ value: 'M', swatch_hex: null }, { value: 'L', swatch_hex: null }] },
  ],
  variants: [
    variant('v-red-m', 'Red', 'M', { image_id: 'img-red', compare_at_price: '500.00', on_sale: true, discount_percent: 10 }),
    variant('v-red-l', 'Red', 'L', { in_stock: false, image_id: 'img-red' }),
    variant('v-blue-l', 'Blue', 'L', { price: '480.00', low_stock: true, image_id: 'img-blue' }),
  ],
  price: '450.00', price_max: '480.00', on_sale: true, in_stock: true, is_new: true, default_variant_id: 'v-red-m', unit: 'pcs',
  seo: { title: null, description: null, image_url: null },
}

async function serveCatalog(page: Page) {
  const listingRequests: URLSearchParams[] = []
  await page.route('**/api/v1/store/bootstrap', (route) => route.fulfill({ json: envelope(bootstrap) }))
  await page.route('**/api/v1/store/homepage*', (route) => route.fulfill({ json: envelope({ sections: [], preview: false }) }))
  await page.route((url) => url.pathname === '/api/v1/store/products', (route) => {
    const params = new URL(route.request().url()).searchParams
    listingRequests.push(params)
    const brands = params.getAll('brand[]')
    const items = params.get('slugs') ? [] : cards.filter((c) => brands.length === 0 || brands.includes(c.brand.slug))
    return route.fulfill({
      json: {
        success: true,
        data: items,
        meta: { request_id: 'e2e', current_page: 1, per_page: 24, total: items.length, last_page: 1 },
        facets: params.get('slugs') ? null : facets(brands),
        context: { category: null, brand: null, q: params.get('q') },
      },
    })
  })
  await page.route('**/api/v1/store/products/kids-tee', (route) => route.fulfill({ json: envelope(tee) }))
  await page.route('**/api/v1/store/products/kids-tee/related', (route) =>
    route.fulfill({ json: envelope({ related: [cards[1]], frequently_bought: [] }) }),
  )
  await page.route('**/api/v1/store/search/suggest*', (route) =>
    route.fulfill({ json: envelope({ products: [{ slug: 'kids-tee', name: 'Kids Tee', url: '/product/kids-tee', image: null, price: '450.00' }], categories: [{ slug: 'clothing', name: 'Clothing', url: '/category/clothing' }] }) }),
  )
  return listingRequests
}

test('browse the shop, filter by brand, open a product and switch its variant', async ({ page, isMobile }) => {
  const requests = await serveCatalog(page)
  await page.goto('/shop')

  await expect(page.getByRole('heading', { level: 1, name: 'Shop' })).toBeVisible()
  await expect(page.getByTestId('result-count')).toHaveText('Showing all 3 products')
  await expect(page).toHaveTitle('Shop | Berry Kids')
  const teeCard = page.getByTestId('product-card').filter({ hasText: 'Kids Tee' })
  await expect(teeCard.getByTestId('price')).toHaveText('৳450.00 – ৳480.00')
  await expect(page.getByTestId('product-card').filter({ hasText: 'Kids Cap' }).getByText('Out of stock')).toBeVisible()

  // Filter by brand: in the sidebar on desktop, in the drawer on phones.
  if (isMobile) {
    await page.getByRole('button', { name: 'Filters' }).click()
    const drawer = page.getByRole('dialog', { name: 'Filters' })
    await drawer.getByRole('checkbox', { name: /Sunny/ }).click()
    await expect(drawer.getByRole('checkbox', { name: /Sunny/ })).toBeChecked()
    await drawer.getByRole('button', { name: /Show \d+ products?/ }).click()
    await expect(drawer).toBeHidden()
  } else {
    await page.getByRole('complementary', { name: 'Filters' }).getByRole('checkbox', { name: /Sunny/ }).click()
  }
  await expect(page).toHaveURL(/\/shop\?brand=sunny$/)
  await expect(page.getByTestId('result-count')).toHaveText('Showing all 2 products')
  await expect(page.getByRole('button', { name: 'Remove filter: Sunny' })).toBeVisible()
  expect(requests.at(-1)?.getAll('brand[]')).toEqual(['sunny'])

  // Back restores the unfiltered list.
  await page.goBack()
  await expect(page).toHaveURL(/\/shop$/)
  await expect(page.getByTestId('result-count')).toHaveText('Showing all 3 products')

  await teeCard.getByRole('link', { name: 'Kids Tee' }).click()
  await expect(page).toHaveURL(/\/product\/kids-tee$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Kids Tee' })).toBeVisible()
  await expect(page).toHaveTitle('Kids Tee | Berry Kids')
  await expect(page.getByText('Excl. VAT')).toBeVisible()
  await expect(page.getByTestId('sku')).toHaveText('TEE-RM')

  // Blue only comes in L: price, SKU, stock and URL follow; M is not possible with Blue.
  await page.getByTestId('variant-selector').locator('label[title="Blue"]').click()
  await expect(page).toHaveURL(/\?variant=v-blue-l$/)
  await expect(page.getByTestId('sku')).toHaveText('TEE-BL')
  await expect(page.getByTestId('product-page').getByTestId('price').first()).toHaveText('৳480.00')
  await expect(page.getByTestId('availability')).toHaveText('Only a few left')
  await expect(page.getByRole('radio', { name: 'M', exact: true })).toBeDisabled()

  // Reloading keeps the chosen variant.
  await page.reload()
  await expect(page.getByTestId('sku')).toHaveText('TEE-BL')

  await page.getByRole('tab', { name: 'Specifications' }).click()
  await expect(page.getByRole('rowheader', { name: 'Material' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Related products' }).getByRole('link', { name: 'Kids Shorts' })).toBeVisible()
})

test('search suggestions lead to a product; the quick view links to its page', async ({ page, isMobile }) => {
  await serveCatalog(page)
  await page.goto('/')

  if (isMobile) await page.getByRole('button', { name: 'Open search' }).click()
  const search = page.getByRole('combobox', { name: 'Search products' })
  await search.fill('tee')
  await expect(page.getByRole('option', { name: /Kids Tee/ })).toBeVisible()
  await search.press('ArrowDown')
  await search.press('Enter')
  await expect(page).toHaveURL(/\/product\/kids-tee$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Kids Tee' })).toBeVisible()

  await page.goto('/search?q=kids')
  await expect(page.getByRole('heading', { level: 1, name: 'Search results for “kids”' })).toBeVisible()
  await page.getByRole('button', { name: 'Quick view: Kids Tee' }).click()
  const dialog = page.getByRole('dialog', { name: 'Kids Tee' })
  await expect(dialog.getByTestId('sku')).toHaveText('TEE-RM')
  await dialog.getByRole('link', { name: 'View full details' }).click()
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(/\/product\/kids-tee\?variant=v-red-m$/)
})

test('unknown products show the not-found page', async ({ page }) => {
  await serveCatalog(page)
  await page.route('**/api/v1/store/products/nope', (route) =>
    route.fulfill({ status: 404, json: { success: false, error: { code: 'NOT_FOUND', message: 'Not found.', details: {} }, meta: { request_id: 'e2e' } } }),
  )
  await page.goto('/product/nope')
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
})
