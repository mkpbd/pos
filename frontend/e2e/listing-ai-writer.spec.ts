import { expect, test, type Page, type Request } from '@playwright/test'

/*
 * AI2a §5 (Frontend A): "Write with AI" on the product listing and the category listing, against a
 * mocked API. Nothing is saved by the AI: the texts go into the form and are sent with the normal save.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const page1 = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })
const failure = (status: number, code: string, details: Record<string, unknown> = {}) => ({ status, json: { success: false, error: { code, message: code, details }, meta: { request_id: 'e2e' } } })

const me = {
  user: { id: 'u-1', name: 'Nadia Admin', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active', ai_enabled: true },
  roles: [{ id: 'r-1', name: 'Organization Admin', system_key: 'organization_admin' }],
  permissions: ['branches.view', 'media.manage', 'storefront.manage', 'storefront.view', 'products.view', 'online_catalog.view', 'online_catalog.manage'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
  ai_enabled: true,
}

const listing = {
  product: {
    id: 'p-1', name: 'Cotton Frock', category_id: 'c-2', brand_id: null, is_active: true, options: [{ name: 'Size', values: ['2Y', '4Y'] }],
    images: [],
    variants: [
      { id: 'v-1', sku: 'CF-2Y', name: null, option_values: { Size: '2Y' }, selling_price: '850.00', is_active: true },
      { id: 'v-2', sku: 'CF-4Y', name: null, option_values: { Size: '4Y' }, selling_price: '950.00', is_active: true },
    ],
  },
  listing: {
    exists: true, slug: 'cotton-frock', is_published: false, published_at: null, unpublished_at: null, is_featured: false, is_new_until: null,
    short_description: 'Soft frock.', description_html: null, specifications: [], seo_title: null, seo_description: null, sort_weight: 0, state: 'draft',
  },
  variants: [],
  related: { related: [], frequently_bought: [] },
  url: '/product/cotton-frock',
}

async function mockBackend(page: Page) {
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/branches?*', (route) => route.fulfill({ json: page1([]) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/media?*', (route) => route.fulfill({ json: page1([]) }))
}

test('writes a product’s descriptions in English and Bangla and saves them with the listing', async ({ page }) => {
  await mockBackend(page)
  await page.route('**/api/v1/online-catalog/products/p-1', (route) => route.fulfill({ json: envelope(listing) }))
  await page.route('**/api/v1/online-catalog/products/p-1/related', (route) => route.fulfill({ json: envelope({ related: [], frequently_bought: [] }) }))
  await page.route('**/api/v1/online-catalog/ai/write', (route) =>
    route.fulfill({ json: envelope({
      subject: 'product', id: 'p-1',
      suggestions: {
        en: { short_description: 'A soft cotton frock for everyday play.', description: '<p>Made from soft cotton.</p><ul><li>Sizes 2Y and 4Y</li></ul>' },
        bn: { short_description: 'প্রতিদিনের খেলার জন্য নরম সুতির ফ্রক।', description: '<p>নরম সুতি দিয়ে তৈরি।</p>' },
      },
      missing_info: ['care instructions'],
      current: { en: { short_description: 'Soft frock.', description: null }, bn: { short_description: null, description: null } },
    }) }),
  )
  await page.goto('/admin/products/p-1/online-store')

  const form = page.getByRole('form', { name: 'Online listing' })
  const opener = form.getByRole('button', { name: 'Write with AI: descriptions' })
  await opener.click()
  const dialog = page.getByRole('dialog', { name: 'Write with AI' })
  await dialog.getByRole('radio', { name: 'Both' }).check()
  await dialog.getByRole('radio', { name: 'Simple' }).check()
  await dialog.getByLabel('Notes for the AI').fill('100% cotton, machine washable')

  const request = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/online-catalog/ai/write') && r.method() === 'POST')
  await dialog.getByRole('button', { name: 'Write', exact: true }).click()
  expect((await request).postDataJSON()).toEqual({
    subject: 'product', id: 'p-1', fields: ['short_description', 'description'], languages: ['en', 'bn'], tone: 'simple', length: 'medium', notes: '100% cotton, machine washable',
  })

  // Empty fields come ticked; the filled English short description does not.
  await expect(dialog.getByRole('checkbox', { name: 'Use for Short description (English)' })).not.toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: 'Use for Web description (English)' })).toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: 'Use for Short description (Bangla)' })).toBeChecked()
  await expect(dialog.getByRole('region', { name: 'Things to add' })).toContainText('care instructions')
  await dialog.getByRole('button', { name: 'Use selected (3)' }).click()

  await expect(dialog).toBeHidden()
  await expect(opener).toBeFocused()
  await expect(form.getByTestId('ai-writer-applied')).toContainText('Not saved yet')
  await expect(form.getByLabel('Short description', { exact: true })).toHaveValue('Soft frock.')
  await expect(form.getByLabel('Short description in Bangla')).toHaveValue('প্রতিদিনের খেলার জন্য নরম সুতির ফ্রক।')

  const put = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/online-catalog/products/p-1') && r.method() === 'PUT')
  await form.getByRole('button', { name: 'Save online listing' }).click()
  const sent = (await put).postDataJSON() as { short_description: string; description_html: string; translations: { bn: Record<string, string> } }
  expect(sent.short_description).toBe('Soft frock.')
  expect(sent.description_html).toContain('Made from soft cotton.')
  expect(sent.description_html).toContain('<li>')
  expect(sent.translations.bn.short_description).toBe('প্রতিদিনের খেলার জন্য নরম সুতির ফ্রক।')
  expect(sent.translations.bn.description_html).toContain('নরম সুতি দিয়ে তৈরি।')
  await expect(page.getByText('Online listing saved.')).toBeVisible()
})

test('explains an AI failure, then fills a category’s SEO texts', async ({ page }) => {
  await mockBackend(page)
  await page.route('**/api/v1/online-catalog/categories', (route) =>
    route.fulfill({ json: envelope([{ id: 'c-2', name: 'Frocks', parent_id: null, depth: 0, is_active: true, listing: null }]) }),
  )
  const frocks = {
    category: { id: 'c-2', name: 'Frocks', parent_id: null, is_active: true },
    listing: { exists: false, slug: 'frocks', is_visible: true, image_media_id: null, banner_media_id: null, description_html: null, seo_title: null, seo_description: null },
    url: '/category/frocks',
  }
  await page.route('**/api/v1/online-catalog/categories/c-2', (route) => route.fulfill({ json: envelope(frocks) }))
  let calls = 0
  await page.route('**/api/v1/online-catalog/ai/write', (route) => {
    calls += 1
    return calls === 1
      ? route.fulfill(failure(422, 'AI_UNAVAILABLE', { reason: 'unavailable' }))
      : route.fulfill({ json: envelope({ subject: 'category', id: 'c-2', suggestions: { en: { seo_title: 'Girls’ frocks | Berry Kids', seo_description: 'Cotton frocks for girls aged 1 to 8.' } }, missing_info: [], current: {} }) })
  })
  await page.goto('/admin/storefront/categories')

  await page.getByRole('button', { name: 'Edit web listing of Frocks' }).click()
  const listingDialog = page.getByRole('dialog', { name: 'Web listing: Frocks' })
  await listingDialog.getByRole('button', { name: 'Write with AI' }).click()
  const dialog = page.getByRole('dialog', { name: 'Write with AI' })
  await dialog.getByRole('checkbox', { name: 'Description', exact: true }).click()
  await dialog.getByRole('button', { name: 'Write', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('The AI service didn’t answer')
  await dialog.getByRole('button', { name: 'Try again' }).click()
  await dialog.getByRole('button', { name: 'Write', exact: true }).click()

  await expect(dialog.getByText('26/70 characters')).toBeVisible()
  await dialog.getByRole('button', { name: 'Use selected (2)' }).click()
  await expect(dialog).toBeHidden()
  await expect(listingDialog).toBeVisible()
  await expect(listingDialog.getByLabel('SEO title', { exact: true })).toHaveValue('Girls’ frocks | Berry Kids')

  const put = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/online-catalog/categories/c-2') && r.method() === 'PUT')
  await listingDialog.getByRole('button', { name: 'Save listing' }).click()
  expect((await put).postDataJSON()).toMatchObject({ seo_title: 'Girls’ frocks | Berry Kids', seo_description: 'Cotton frocks for girls aged 1 to 8.' })
})
