import { expect, test, type Page, type Request } from '@playwright/test'

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const page1 = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

const me = {
  user: { id: 'u-1', name: 'Nadia Admin', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-1', name: 'Organization Admin', system_key: 'organization_admin' }],
  permissions: [
    'branches.view', 'media.manage', 'storefront.manage', 'storefront.view', 'products.view', 'products.manage', 'products.view_cost',
    'online_catalog.view', 'online_catalog.manage', 'attributes.manage',
  ],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
}

const variant = (id: string, sku: string, size: string, price: string) => ({
  id, sku, name: null, option_values: { Size: size }, purchase_price: '50.00', selling_price: price, wholesale_price: null, reorder_level: '0.000', barcodes: [], is_active: true,
})

const product = {
  id: 'p-1', name: 'Mango Juice', description: null, type: 'standard', category: null, brand: null,
  unit: { id: 'u-pcs', name: 'Piece', code: 'pcs', allow_decimal: false }, tax_rate: null,
  track_stock: true, track_batches: false, track_serials: false, max_discount_percent: null, options: [{ name: 'Size', values: ['1L', '2L'] }], is_active: true, archived_at: null,
  variants: [variant('v-1', 'MJ-1L', '1L', '120.00'), variant('v-2', 'MJ-2L', '2L', '150.00')],
  images: [{ id: 'img-1', url: '/favicon.svg', original_name: 'mango.png' }],
}
const orange = { ...product, id: 'p-9', name: 'Orange Juice', options: null, variants: [variant('v-9', 'OJ-1', '1L', '80.00')], images: [] }

const listing = {
  product: {
    id: 'p-1', name: 'Mango Juice', category_id: null, brand_id: null, is_active: true, options: product.options,
    images: [{ id: 'img-1', url: '/favicon.svg' }],
    variants: product.variants.map((v) => ({ id: v.id, sku: v.sku, name: null, option_values: v.option_values, selling_price: v.selling_price, is_active: true })),
  },
  listing: {
    exists: false, slug: 'mango-juice', is_published: false, published_at: null, unpublished_at: null, is_featured: false, is_new_until: null,
    short_description: null, description_html: null, specifications: [], seo_title: null, seo_description: null, sort_weight: 0, state: 'draft',
  },
  variants: [],
  related: { related: [], frequently_bought: [] },
  url: '/product/mango-juice',
}

const categories = [
  { id: 'c-1', parent_id: null, name: 'Drinks', description: null, sort_order: 0, is_active: true },
  { id: 'c-2', parent_id: 'c-1', name: 'Juices', description: null, sort_order: 0, is_active: true },
]

async function mockBackend(page: Page) {
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/branches?*', (route) => route.fulfill({ json: page1([]) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/media?*', (route) => route.fulfill({ json: page1([]) }))
  await page.route('**/api/v1/categories', (route) => route.fulfill({ json: envelope(categories) }))
  await page.route('**/api/v1/brands', (route) => route.fulfill({ json: envelope([{ id: 'b-1', name: 'Pran', description: null, is_active: true }]) }))
  await page.route('**/api/v1/units', (route) => route.fulfill({ json: envelope([{ id: 'u-pcs', name: 'Piece', code: 'pcs', allow_decimal: false, base_unit_id: null, conversion_factor: null, is_active: true }]) }))
  await page.route('**/api/v1/tax-rates', (route) => route.fulfill({ json: envelope([]) }))
  await page.route('**/api/v1/attributes', (route) => route.fulfill({ json: envelope([]) }))
  await page.route('**/api/v1/products?*', (route) => route.fulfill({ json: page1([product, orange]) }))
  await page.route('**/api/v1/products/p-1', (route) => route.fulfill({ json: envelope(product) }))
}

test('saves a product web listing with a sale price and a related product', async ({ page }) => {
  await mockBackend(page)
  await page.route('**/api/v1/online-catalog/products/p-1', (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({ json: envelope({ ...listing, listing: { ...listing.listing, exists: true, is_published: true, state: 'live' } }) })
      : route.fulfill({ json: envelope(listing) }),
  )
  await page.route('**/api/v1/online-catalog/products/p-1/related', (route) => route.fulfill({ json: envelope({ related: [], frequently_bought: [] }) }))
  await page.goto('/admin/products/p-1')

  const section = page.getByRole('form', { name: 'Online listing' })
  await expect(section.getByText('/product/mango-juice')).toBeVisible()
  await section.getByRole('switch', { name: 'Published' }).click()
  await section.getByLabel('Compare-at price for 2L · MJ-2L').fill('180')
  await section.getByLabel('Short description').fill('Cold pressed every morning.')
  await section.getByRole('button', { name: 'Add related product' }).click()
  await page.getByRole('option', { name: /Orange Juice/ }).click()
  await expect(section.getByRole('list', { name: 'Related products' })).toContainText('Orange Juice')

  const put = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/online-catalog/products/p-1') && r.method() === 'PUT')
  const related = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/online-catalog/products/p-1/related') && r.method() === 'PUT')
  await section.getByRole('button', { name: 'Save online listing' }).click()

  const body = (await put).postDataJSON() as { is_published: boolean; short_description: string; variants: { variant_id: string; compare_at_price: string | null }[] }
  expect(body.is_published).toBe(true)
  expect(body.short_description).toBe('Cold pressed every morning.')
  expect(body.variants).toEqual([{ variant_id: 'v-1', compare_at_price: null, image_id: null }, { variant_id: 'v-2', compare_at_price: '180', image_id: null }])
  expect((await related).postDataJSON()).toEqual({ related: ['p-9'], frequently_bought: [] })
  await expect(page.getByText('Online listing saved.')).toBeVisible()
})

test('makes a category visible on the store', async ({ page }) => {
  await mockBackend(page)
  await page.route('**/api/v1/online-catalog/categories', (route) =>
    route.fulfill({ json: envelope([
      { id: 'c-1', name: 'Drinks', parent_id: null, depth: 0, is_active: true, listing: { slug: 'drinks', is_visible: true } },
      { id: 'c-2', name: 'Juices', parent_id: 'c-1', depth: 1, is_active: true, listing: null },
    ]) }),
  )
  const juices = {
    category: { id: 'c-2', name: 'Juices', parent_id: 'c-1', is_active: true },
    listing: { exists: false, slug: 'juices', is_visible: true, image_media_id: null, banner_media_id: null, description_html: null, seo_title: null, seo_description: null },
    url: '/category/juices',
  }
  await page.route('**/api/v1/online-catalog/categories/c-2', (route) => route.fulfill({ json: envelope(juices) }))
  await page.goto('/admin/storefront/categories')

  await expect(page.getByRole('row', { name: /Juices/ })).toContainText('Not listed')
  await page.getByRole('button', { name: 'Edit web listing of Juices' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('SEO title').fill('Fresh juices')

  const put = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/online-catalog/categories/c-2') && r.method() === 'PUT')
  await dialog.getByRole('button', { name: 'Save listing' }).click()
  expect((await put).postDataJSON()).toMatchObject({ slug: 'juices', is_visible: true, seo_title: 'Fresh juices' })
  await expect(page.getByText('Juices listing saved.')).toBeVisible()
})

test('adds a hand-picked product carousel to the homepage', async ({ page }) => {
  await mockBackend(page)
  await page.route('**/api/v1/storefront/homepage-sections/types', (route) =>
    route.fulfill({ json: envelope([
      { type: 'product_carousel', label: 'Product carousel', description: 'A sliding row of products.', banner_placement: null, items: null, defaults: { source: 'featured', category_id: null, limit: 8, view_all_url: null } },
      { type: 'category_strip', label: 'Category strip', description: 'Category tiles.', banner_placement: null, items: null, defaults: { source: 'top_level', limit: 8 } },
    ]) }),
  )
  await page.route('**/api/v1/storefront/homepage-sections', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 201, json: envelope({ id: 's-1', type: 'product_carousel', type_label: 'Product carousel', title: 'Picks', subtitle: null, config: route.request().postDataJSON().config, banner_ids: [], item_ids: ['p-9'], is_enabled: true, starts_at: null, ends_at: null, state: 'live', sort_order: 0, updated_at: null }) })
      : route.fulfill({ json: envelope([]) }),
  )
  await page.goto('/admin/storefront/homepage')

  await page.getByRole('button', { name: 'Add section' }).click()
  await page.getByRole('button', { name: /Product carousel/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Title', { exact: true }).fill('Picks')
  await dialog.getByRole('combobox', { name: 'Products', exact: true }).click()
  await page.getByRole('option', { name: 'Hand-picked products' }).click()
  await dialog.getByRole('button', { name: 'Add product' }).click()
  await page.getByRole('option', { name: /Orange Juice/ }).click()

  const post = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/storefront/homepage-sections') && r.method() === 'POST')
  await dialog.getByRole('button', { name: 'Add section' }).click()
  expect((await post).postDataJSON()).toMatchObject({ type: 'product_carousel', config: { source: 'manual' }, item_ids: ['p-9'] })
  await expect(page.getByText('Section added at the end of the homepage.')).toBeVisible()
})

test('links a menu item to a category', async ({ page }) => {
  await mockBackend(page)
  const menu = { id: 'm-1', name: 'Main', location: 'main', location_label: 'Main navigation', is_active: true, updated_at: null }
  await page.route('**/api/v1/storefront/menus', (route) => route.fulfill({ json: envelope([menu]) }))
  await page.route('**/api/v1/storefront/menus/m-1', (route) => route.fulfill({ json: envelope({ ...menu, items: [] }) }))
  await page.route('**/api/v1/storefront/link-targets', (route) =>
    route.fulfill({ json: envelope({ pages: [], categories: [{ id: 'c-1', name: 'Drinks', url: '/category/drinks' }], brands: [{ id: 'b-1', name: 'Pran', url: '/brand/pran' }] }) }),
  )
  await page.route('**/api/v1/storefront/menus/m-1/items', (route) =>
    route.fulfill({ json: envelope({ ...menu, items: (route.request().postDataJSON() as { items: unknown[] }).items }) }),
  )
  await page.goto('/admin/storefront/menus')

  await page.getByRole('button', { name: 'Add item' }).click()
  await page.getByLabel('Item 1 label').fill('Drinks')
  await page.getByRole('combobox', { name: 'Item 1 link type' }).click()
  await page.getByRole('option', { name: 'Category: Drinks' }).click()

  const put = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/storefront/menus/m-1/items') && r.method() === 'PUT')
  await page.getByRole('button', { name: 'Save items' }).click()
  const body = (await put).postDataJSON() as { items: { type: string; target_id: string; url: string | null }[] }
  expect(body.items[0]).toMatchObject({ type: 'category', target_id: 'c-1', url: null })
  await expect(page.getByText('Menu items saved.')).toBeVisible()
})
