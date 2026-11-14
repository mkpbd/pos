import { expect, test, type Page, type Request } from '@playwright/test'

// P1a admin: variant grid (generate, keyboard, bulk edit, opening stock, adjust stock), photos by
// colour, back-in-stock list and size guides. Mocked API, desktop and phone projects.

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const page1 = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

const me = {
  user: { id: 'u-1', name: 'Nadia Admin', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-1', name: 'Organization Admin', system_key: 'organization_admin' }],
  permissions: [
    'branches.view', 'media.manage', 'storefront.view', 'storefront.manage', 'products.view', 'products.manage', 'products.view_cost',
    'online_catalog.view', 'online_catalog.manage', 'inventory.view', 'inventory.adjust',
  ],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
}

const branches = [{
  id: 'b-1', code: 'MAIN', name: 'Main Branch', email: null, phone: null, address: null, timezone: null, is_active: true, allow_negative_stock: false, created_at: '2026-10-01T00:00:00Z',
  stores: [{ id: 's-1', code: 'FLOOR', name: 'Shop floor', is_active: true }],
}]

const frock = {
  id: 'p-1', name: 'Party Frock', description: null, type: 'standard', category: null, brand: null,
  unit: { id: 'u-pcs', name: 'Piece', code: 'pcs', allow_decimal: false }, tax_rate: null,
  track_stock: true, track_batches: false, track_serials: false, max_discount_percent: null, options: [{ name: 'Colour', values: ['Red'] }], is_active: true, archived_at: null,
  variants: [{
    id: 'v-red', sku: 'FROCK-RED', name: null, option_values: { Colour: 'Red' }, purchase_price: '600.00', selling_price: '950.00', wholesale_price: null,
    reorder_level: '2.000', barcodes: [], is_active: true, compare_at_price: null, back_in_stock_open: 1,
    stock: { total: '0.000', by_store: [{ store_id: 's-1', branch_id: 'b-1', quantity: '0.000' }] },
  }],
  images: [{ id: 'img-1', url: '/favicon.svg', original_name: 'red.png' }, { id: 'img-2', url: '/favicon.svg', original_name: 'blue.png' }],
  photo_option: null, option_styles: {}, option_images: {},
}

const listing = {
  product: { id: 'p-1', name: 'Party Frock', category_id: null, brand_id: null, is_active: true, options: frock.options, images: frock.images, variants: [] },
  listing: {
    exists: true, slug: 'party-frock', is_published: true, published_at: null, unpublished_at: null, is_featured: false, is_new_until: null,
    short_description: null, description_html: null, specifications: [], seo_title: null, seo_description: null, sort_weight: 0, state: 'live',
    size_guide_id: null, inherited_size_guide: null,
  },
  variants: [], related: { related: [], frequently_bought: [] }, url: '/product/party-frock',
}

async function mockBackend(page: Page) {
  // Anything not mocked below answers 404 instead of reaching a real server.
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 404, json: { success: false, error: { code: 'NOT_FOUND', message: 'Not mocked', details: {} }, meta: { request_id: 'e2e' } } }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/branches?*', (route) => route.fulfill({ json: page1(branches) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/categories', (route) => route.fulfill({ json: envelope([]) }))
  await page.route('**/api/v1/brands', (route) => route.fulfill({ json: envelope([]) }))
  await page.route('**/api/v1/units', (route) => route.fulfill({ json: envelope([{ id: 'u-pcs', name: 'Piece', code: 'pcs', allow_decimal: false, base_unit_id: null, conversion_factor: null, is_active: true }]) }))
  await page.route('**/api/v1/tax-rates', (route) => route.fulfill({ json: envelope([]) }))
  await page.route('**/api/v1/attributes', (route) =>
    route.fulfill({ json: envelope([{ id: 'a-1', name: 'Colour', slug: 'colour', display: 'swatch', is_filterable: true, sort_order: 0, values: [
      { id: 'av-1', value: 'Red', swatch_hex: '#dc2626', sort_order: 0 }, { id: 'av-2', value: 'Blue', swatch_hex: '#2563eb', sort_order: 1 },
    ] }]) }),
  )
  await page.route('**/api/v1/products/p-1', (route) => route.fulfill({ json: envelope(frock) }))
  await page.route('**/api/v1/products/p-1/back-in-stock-requests?*', (route) =>
    route.fulfill({ json: page1([{ id: 'r-1', variant_id: 'v-red', variant_label: 'Red', email: 'mina@example.com', locale: 'bn', created_at: '2026-11-01T10:00:00Z', notified_at: null }]) }),
  )
  await page.route('**/api/v1/online-catalog/products/p-1', (route) => route.fulfill({ json: envelope(listing) }))
  await page.route('**/api/v1/online-catalog/size-guides', (route) => route.fulfill({ json: envelope([]) }))
}

test('builds the variant grid: generate, keyboard, bulk edit and save with opening stock', async ({ page }) => {
  await mockBackend(page)
  await page.route('**/api/v1/products/p-1/variants', (route) => route.fulfill({ json: envelope(frock) }))
  await page.goto('/admin/products/p-1')

  const grid = page.getByRole('region', { name: 'Variants, prices & stock' })
  await expect(grid.getByRole('link', { name: /1 waiting/ })).toBeVisible()
  await grid.getByRole('button', { name: 'Add Blue to Colour' }).click()
  await grid.getByRole('button', { name: 'Add option' }).click()
  await grid.getByLabel('Option 2', { exact: true }).fill('Size')
  await grid.getByLabel('Values of option 2').fill('2Y, 4Y')
  await grid.getByRole('button', { name: 'Generate 4 variants' }).click()

  const table = grid.getByRole('table', { name: 'Variant grid' })
  await expect(table.getByRole('rowheader')).toHaveCount(4)
  await expect(grid.getByLabel('SKU for Red / 2Y')).toHaveValue('FROCK-RED')
  await expect(grid.getByLabel('SKU for Blue / 4Y')).toHaveValue('FROCK-BLUE-4Y')

  // Spreadsheet keys.
  await grid.getByLabel('Selling price for Red / 2Y').focus()
  await page.keyboard.press('ArrowDown')
  await expect(grid.getByLabel('Selling price for Red / 4Y')).toBeFocused()

  // "All Blue" → set price.
  await grid.getByRole('combobox', { name: 'Select rows by value' }).click()
  await page.getByRole('option', { name: 'All Blue' }).click()
  const bulk = grid.getByRole('region', { name: 'Bulk edit' })
  await expect(bulk).toContainText('2 selected')
  await bulk.getByLabel('Bulk value').fill('990')
  await bulk.getByRole('button', { name: 'Apply to 2' }).click()
  await expect(grid.getByLabel('Selling price for Blue / 2Y')).toHaveValue('990')

  await grid.getByLabel('Opening stock for Blue / 2Y').fill('5')
  await grid.getByRole('combobox', { name: 'Opening stock goes to' }).click()
  await page.getByRole('option', { name: /Shop floor/ }).click()

  const put = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/products/p-1/variants') && r.method() === 'PUT')
  await grid.getByRole('button', { name: 'Save variants' }).click()
  const body = (await put).postDataJSON() as { options: unknown; stock_store_id: string; variants: { id?: string; sku: string; selling_price: string; opening_stock?: string }[] }
  expect(body.options).toEqual([{ name: 'Colour', values: ['Red', 'Blue'] }, { name: 'Size', values: ['2Y', '4Y'] }])
  expect(body.stock_store_id).toBe('s-1')
  expect(body.variants.map((v) => [v.id ?? null, v.sku, v.selling_price, v.opening_stock ?? null])).toEqual([
    ['v-red', 'FROCK-RED', '950.00', null],
    [null, 'FROCK-RED-4Y', '950.00', null],
    [null, 'FROCK-BLUE-2Y', '990', '5'],
    [null, 'FROCK-BLUE-4Y', '990', null],
  ])
  await expect(page.getByText('Variants saved.')).toBeVisible()
})

test('adjusts stock, lists back-in-stock requests and picks photos by colour', async ({ page }) => {
  await mockBackend(page)
  await page.route('**/api/v1/inventory/adjustments', (route) => route.fulfill({ status: 201, json: envelope({ id: 'adj-1', number: 'ADJ-000009' }) }))
  await page.route('**/api/v1/products/p-1/option-images', (route) => route.fulfill({ json: envelope({ ...frock, photo_option: 'Colour', option_images: { Red: ['img-1'] } }) }))
  await page.goto('/admin/products/p-1')

  await expect(page.getByRole('region', { name: 'Back-in-stock requests' })).toContainText('mina@example.com')

  await page.getByRole('button', { name: 'Adjust stock of Red' }).click()
  const dialog = page.getByRole('dialog', { name: 'Adjust stock' })
  await dialog.getByRole('combobox', { name: 'Store for the stock change' }).click()
  await page.getByRole('option', { name: /Shop floor/ }).click()
  await dialog.getByLabel(/Add to Red/).fill('6')
  const post = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/inventory/adjustments') && r.method() === 'POST')
  await dialog.getByRole('button', { name: 'Add stock' }).click()
  expect((await post).postDataJSON()).toEqual({ store_id: 's-1', reason: 'correction', note: 'Variant grid', lines: [{ variant_id: 'v-red', quantity: '6' }] })
  await expect(page.getByText('Stock updated (adjustment ADJ-000009).')).toBeVisible()

  const photos = page.getByRole('region', { name: 'Photos by colour' })
  await photos.getByRole('combobox', { name: 'Option with its own photos' }).click()
  await page.getByRole('option', { name: 'Colour' }).click()
  await photos.getByRole('button', { name: 'Photo 1 for Red' }).click()
  await expect(photos.getByRole('button', { name: 'Photo 1 for Red' })).toHaveAttribute('aria-pressed', 'true')
  const put = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/products/p-1/option-images') && r.method() === 'PUT')
  await photos.getByRole('button', { name: 'Save photos by colour' }).click()
  expect((await put).postDataJSON()).toEqual({ photo_option: 'Colour', styles: { Colour: null }, values: [{ value: 'Red', image_ids: ['img-1'] }] })
  await expect(page.getByText('Photos by colour saved.')).toBeVisible()
})

test('creates a size guide and assigns it to a category', async ({ page }) => {
  await mockBackend(page)
  await page.route('**/api/v1/online-catalog/categories', (route) =>
    route.fulfill({ json: envelope([
      { id: 'c-1', name: 'Kids', parent_id: null, depth: 0, is_active: true, listing: null },
      { id: 'c-2', name: 'Frocks', parent_id: 'c-1', depth: 1, is_active: true, listing: null },
    ]) }),
  )
  await page.route('**/api/v1/online-catalog/size-guides', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 201, json: envelope({ ...route.request().postDataJSON(), id: 'g-1', image: null, updated_at: '2026-11-13T10:00:00Z' }) })
      : route.fulfill({ json: envelope([]) }),
  )
  await page.goto('/admin/storefront/size-guides')

  await expect(page.getByText('No size guides yet')).toBeVisible()
  await page.getByRole('button', { name: 'New size guide' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: /Kids by age/ }).click()
  await dialog.getByLabel('Name (for you)').fill('Frocks')
  await dialog.getByLabel('Age, 2', { exact: true }).fill('1–2 years')
  await page.keyboard.press('Enter')
  await expect(dialog.getByLabel('Age, 4', { exact: true })).toBeFocused()
  await dialog.getByRole('checkbox', { name: 'Frocks' }).click()

  const post = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/online-catalog/size-guides') && r.method() === 'POST')
  await dialog.getByRole('button', { name: 'Save size guide' }).click()
  const body = (await post).postDataJSON() as { name: string; category_ids: string[]; columns: { id: string; label: string }[]; rows: { cells: Record<string, string> }[] }
  expect(body).toMatchObject({ name: 'Frocks', title: 'Size guide', category_ids: ['c-2'] })
  expect(body.columns.map((c) => c.label)).toEqual(['Size', 'Age', 'Height (cm)', 'Chest (cm)'])
  expect(body.rows[0]?.cells[body.columns[1]!.id]).toBe('1–2 years')
  await expect(page.getByText('Frocks saved.')).toBeVisible()
})
