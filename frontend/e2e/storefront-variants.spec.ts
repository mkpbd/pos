import { expect, test, type Page } from '@playwright/test'

/**
 * P1a, mocked public API: card colour chips swap the card image; the product page shows the chosen
 * colour's photos, "Only 2 left", sold-out sizes with "Notify me when it's back" and the size guide.
 * Runs at 1366 px (desktop project) and 375 px (mobile project).
 */

const envelope = (data: unknown) => ({ success: true, data, meta: { request_id: 'e2e' } })

const bootstrap = {
  store: { name: 'Berry Kids', description: 'Clothes and toys for little ones', prices_include_tax: true, currency: 'BDT' },
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

const photo = (name: string) => `/favicon.svg?photo=${name}`

const teeCard = {
  id: 'p-kids-tee', slug: 'kids-tee', name: 'Kids Tee', url: '/product/kids-tee', image: { url: photo('main'), alt: 'Kids Tee' }, hover_image: null,
  price: '450.00', price_max: '480.00', compare_at_price: null, on_sale: false, discount_percent: null, in_stock: true,
  is_new: false, is_featured: false, brand: null, category: { name: 'Clothing', slug: 'clothing' }, variant_count: 3, default_variant_id: null,
  short_description: null, promotion: null,
  swatches: {
    option: 'Colour',
    values: [
      { value: 'Red', swatch_hex: '#e11d48', image: { url: photo('red-1'), alt: 'Red tee' } },
      { value: 'Blue', swatch_hex: '#2563eb', image: { url: photo('blue-1'), alt: 'Blue tee' } },
    ],
    more: 0,
  },
}

const images = ['red-1', 'red-2', 'blue-1', 'blue-2', 'label'].map((id) => ({ id, url: photo(id), alt: `Kids Tee ${id}` }))

const variant = (id: string, colour: string, size: string, extra: Record<string, unknown> = {}) => ({
  id, sku: `TEE-${colour[0]}${size}`, name: `${colour} / ${size}`, option_values: { Colour: colour, Size: size }, price: '450.00',
  compare_at_price: null, on_sale: false, discount_percent: null, in_stock: true, low_stock: false, stock_left: null, image_id: null, promo_price: null, ...extra,
})

const tee = {
  id: 'p-kids-tee', slug: 'kids-tee', name: 'Kids Tee', url: '/product/kids-tee', short_description: 'Soft cotton tee.',
  description_html: null, specifications: [], brand: null, category: { name: 'Clothing', slug: 'clothing' },
  breadcrumbs: [{ name: 'Home', url: '/' }, { name: 'Clothing', url: '/category/clothing' }, { name: 'Kids Tee', url: null }],
  images,
  photo_option: 'Colour',
  options: [
    {
      name: 'Colour', slug: 'colour', display: 'image',
      values: [
        { value: 'Red', swatch_hex: '#e11d48', image: images[0], image_ids: ['red-1', 'red-2'] },
        { value: 'Blue', swatch_hex: '#2563eb', image: images[2], image_ids: ['blue-1', 'blue-2'] },
      ],
    },
    { name: 'Size', slug: 'size', display: 'button', values: ['M', 'L', 'XL'].map((value) => ({ value, swatch_hex: null, image: null, image_ids: [] })) },
  ],
  variants: [
    variant('v-red-m', 'Red', 'M'),
    variant('v-red-l', 'Red', 'L', { in_stock: false }),
    variant('v-blue-l', 'Blue', 'L', { price: '480.00', low_stock: true, stock_left: 2, image_id: 'blue-2' }),
  ],
  size_guide: {
    title: 'Kids tee sizes',
    intro: 'Measure over light clothing.',
    columns: [
      { id: 'c1', label: 'Size' }, { id: 'c2', label: 'Age' }, { id: 'c3', label: 'Chest (cm)' }, { id: 'c4', label: 'Length (cm)' },
      { id: 'c5', label: 'Sleeve (cm)' }, { id: 'c6', label: 'Shoulder (cm)' }, { id: 'c7', label: 'Waist (cm)' },
    ],
    rows: ['M', 'L', 'XL'].map((size, i) => ({ id: `r${i}`, cells: { c1: size, c2: `${4 + i * 2}–${5 + i * 2} years`, c3: `${64 + i * 4}`, c4: `${48 + i * 4}`, c5: `${30 + i * 2}`, c6: `${28 + i * 2}`, c7: `${56 + i * 3}` } })),
    note: 'Between sizes? Take the larger one.',
    image: null,
  },
  price: '450.00', price_max: '480.00', on_sale: false, in_stock: true, is_new: false, default_variant_id: 'v-red-m', unit: 'pcs', promotion: null,
  seo: { title: null, description: null, image_url: null },
}

async function serve(page: Page) {
  const notifies: unknown[] = []
  await page.route('**/api/v1/store/bootstrap', (route) => route.fulfill({ json: envelope(bootstrap) }))
  await page.route('**/api/v1/store/account/me*', (route) => route.fulfill({ json: envelope(null) }))
  await page.route('**/api/v1/store/cart*', (route) =>
    route.fulfill({ json: envelope({ id: null, items: [], item_count: '0', subtotal: '0.00', discount_total: '0.00', tax_total: '0.00', total: '0.00', prices_include_tax: true, currency: 'BDT', issues: [], promotions: [], free_shipping: null, coupon: null }) }),
  )
  await page.route((url) => url.pathname === '/api/v1/store/products', (route) => {
    const slugs = new URL(route.request().url()).searchParams.get('slugs')
    const items = slugs ? [] : [teeCard]
    return route.fulfill({
      json: { success: true, data: items, meta: { request_id: 'e2e', current_page: 1, per_page: 24, total: items.length, last_page: 1 }, facets: null, context: { category: null, brand: null, q: null } },
    })
  })
  await page.route('**/api/v1/store/products/kids-tee*', (route) => route.fulfill({ json: envelope(tee) }))
  await page.route('**/api/v1/store/products/kids-tee/related*', (route) => route.fulfill({ json: envelope({ related: [], frequently_bought: [] }) }))
  await page.route('**/api/v1/store/products/kids-tee/reviews*', (route) =>
    route.fulfill({ json: { success: true, data: [], meta: { request_id: 'e2e', summary: { average: '0.0', count: 0, distribution: {} } } } }),
  )
  await page.route('**/api/v1/store/products/kids-tee/notify*', (route) => {
    notifies.push(route.request().postDataJSON())
    return route.fulfill({ status: 202, json: envelope({ message: 'Thank you! We will e-mail you when it is back in stock.' }) })
  })
  return notifies
}

test.beforeEach(async ({ page, isMobile }) => {
  await page.setViewportSize(isMobile ? { width: 375, height: 812 } : { width: 1366, height: 768 })
})

test('card colour chips swap the card image', async ({ page, isMobile }) => {
  await serve(page)
  await page.goto('/shop')

  const card = page.getByTestId('product-card').filter({ hasText: 'Kids Tee' })
  const chips = card.getByRole('list', { name: 'Colour choices' })
  await expect(chips.getByRole('button')).toHaveCount(2)
  const image = card.locator('img').first()
  await expect(image).toHaveAttribute('src', photo('main'))

  const blue = chips.getByRole('button', { name: 'Show Colour: Blue' })
  if (isMobile) await blue.tap()
  else await blue.hover()
  await expect(image).toHaveAttribute('src', photo('blue-1'))
  // Chips are at least 24 px targets (WCAG 2.2 target size).
  const box = await blue.boundingBox()
  expect(box!.width).toBeGreaterThanOrEqual(24)
  expect(box!.height).toBeGreaterThanOrEqual(24)
})

test("photos per colour, only-N-left, notify me and the size guide on the product page", async ({ page }) => {
  const notifies = await serve(page)
  await page.goto('/product/kids-tee')
  await expect(page.getByRole('heading', { level: 1, name: 'Kids Tee' })).toBeVisible()

  // Red's photos only; "All photos" shows every image.
  const thumbnails = page.getByRole('list', { name: 'Product images' }).getByRole('button')
  await expect(thumbnails).toHaveCount(2)
  await expect(page.getByRole('radio', { name: 'Colour: Red' })).toBeChecked()
  await expect(page.getByTestId('chip-check')).toHaveCount(1)
  await page.getByRole('button', { name: 'All photos (5)' }).click()
  await expect(thumbnails).toHaveCount(5)

  // Blue: its own photos, starting on the variant's photo; two left.
  await page.getByTestId('variant-selector').locator('label[title="Blue"]').click()
  await expect(page).toHaveURL(/\?variant=v-blue-l$/)
  await expect(thumbnails).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Open Kids Tee, image 2 of 2 full screen' }).locator('img')).toHaveAttribute('src', photo('blue-2'))
  await expect(page.getByTestId('availability')).toHaveText('Only 2 left')
  await expect(page.getByRole('radio', { name: 'XL', exact: true })).toBeDisabled()

  // Red L is sold out: crossed out, still selectable, and the buy button becomes "Notify me".
  await page.getByTestId('variant-selector').locator('label[title^="Red"]').click()
  const soldOut = page.getByRole('radio', { name: 'L (sold out)' })
  await expect(soldOut).toBeChecked()
  await expect(page.getByTestId('availability')).toHaveText('Out of stock')
  await page.getByRole('button', { name: 'Notify me when it’s back' }).click()
  const email = page.getByRole('textbox', { name: 'E-mail address' })
  await expect(email).toBeFocused()
  await email.fill('rina@example.com')
  await email.press('Enter')
  await expect(page.getByTestId('notify-me').getByRole('status')).toHaveText('Thank you! We will e-mail you when it is back in stock.')
  expect(notifies).toEqual([{ variant_id: 'v-red-l', email: 'rina@example.com', website: '' }])

  // Size guide: a dialog with a real table; the first column stays in view while it scrolls.
  const open = page.getByRole('button', { name: 'Size guide' })
  await open.click()
  const dialog = page.getByRole('dialog', { name: 'Kids tee sizes' })
  await expect(dialog).toBeVisible()
  const table = dialog.getByRole('table', { name: 'Kids tee sizes' })
  await expect(table.getByRole('columnheader')).toHaveCount(7)
  await expect(table.getByRole('rowheader', { name: 'XL' })).toBeVisible()
  await expect(table.getByRole('rowheader', { name: 'XL' })).toHaveCSS('position', 'sticky')
  const region = dialog.getByRole('region', { name: 'Kids tee sizes' })
  const fits = await region.evaluate((el) => el.scrollWidth <= el.clientWidth)
  const box = await dialog.boundingBox()
  expect(box!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  if (!fits) {
    await region.focus()
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => region.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(open).toBeFocused()
  // No horizontal page scroll at either width.
  expect(await page.locator('html').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
})
