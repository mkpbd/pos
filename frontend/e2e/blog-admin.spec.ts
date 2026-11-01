import { expect, test, type Page, type Request } from '@playwright/test'

/**
 * Admin CMS depth (E11) against a mocked API: blog posts and categories, and cancelling a
 * paid web order with a refund. Runs on desktop and mobile.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const page1 = (items: unknown[], meta: Record<string, unknown> = {}) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 }, ...meta })

const me = {
  user: { id: 'u-1', name: 'Nadia Admin', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-1', name: 'Organization Admin', system_key: 'organization_admin' }],
  permissions: ['branches.view', 'cms.manage', 'media.manage', 'storefront.view', 'storefront.manage', 'web_orders.view', 'web_orders.manage', 'web_orders.refund'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
}

type Category = { id: string; name: string; slug: string; description: string | null; sort_order: number; post_count: number }

const post = (overrides: Record<string, unknown> = {}) => ({
  id: 'bp-1', slug: 'five-eid-desserts', title: 'Five Eid desserts', excerpt: 'Sweet ideas', status: 'published', state: 'published',
  published_at: '2026-10-20T04:00:00Z', category: { id: 'bc-1', name: 'Recipes', slug: 'recipes' }, category_id: 'bc-1', author_name: 'Nadia Admin',
  cover_media_id: null, cover: null, reading_minutes: 3, updated_at: '2026-10-20T04:00:00Z', body_html: '<p>Hello</p>', seo_title: null, seo_description: null,
  ...overrides,
})

async function mockBackend(page: Page) {
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/media?*', (route) => route.fulfill({ json: page1([]) }))
}

async function mockBlog(page: Page) {
  let categories: Category[] = [{ id: 'bc-1', name: 'Recipes', slug: 'recipes', description: null, sort_order: 0, post_count: 1 }]
  const posts: Record<string, unknown>[] = [post()]

  await page.route('**/api/v1/cms/blog-categories', (route) => {
    if (route.request().method() === 'POST') {
      const input = route.request().postDataJSON() as Category
      const created = { ...input, id: 'bc-2', sort_order: 1, post_count: 0 }
      categories = [...categories, created]
      return route.fulfill({ status: 201, json: envelope(created) })
    }
    return route.fulfill({ json: envelope(categories) })
  })
  await page.route('**/api/v1/cms/blog-posts?*', (route) => route.fulfill({ json: page1(posts, { status_counts: { all: 1, published: 1, scheduled: 0, draft: 0 } }) }))
  await page.route('**/api/v1/cms/blog-posts', (route) => {
    const input = route.request().postDataJSON() as Record<string, unknown>
    const created = post({ ...input, id: 'bp-2', state: input.status === 'draft' ? 'draft' : 'scheduled', category: null })
    posts.push(created)
    return route.fulfill({ status: 201, json: envelope(created) })
  })
  await page.route('**/api/v1/cms/blog-posts/bp-2', (route) => route.fulfill({ json: envelope(posts.find((p) => p.id === 'bp-2')) }))
}

test('writes and schedules a blog post, then adds a category', async ({ page }) => {
  await mockBackend(page)
  await mockBlog(page)
  await page.goto('/admin/content/blog')

  await expect(page.getByRole('link', { name: 'Five Eid desserts' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Published (1)' })).toBeVisible()
  await page.getByRole('link', { name: 'New post' }).click()

  await page.getByLabel('Title', { exact: true }).fill('Winter menu for kids')
  await expect(page.getByLabel('Address', { exact: true })).toHaveValue('winter-menu-for-kids')
  await page.getByLabel('Excerpt', { exact: true }).fill('Warm and easy')
  await page.getByRole('textbox', { name: 'Post text' }).fill('Soup, porridge and more.')
  await page.getByRole('radio', { name: 'Schedule' }).check()
  await page.getByLabel('Publish at', { exact: true }).fill('2099-12-01T09:00')

  const posted = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/cms/blog-posts') && r.method() === 'POST')
  await page.getByRole('button', { name: 'Schedule post' }).click()
  const body = (await posted).postDataJSON() as Record<string, unknown>
  expect(body).toMatchObject({ title: 'Winter menu for kids', slug: 'winter-menu-for-kids', status: 'published', published_at: '2099-12-01T09:00:00+06:00', excerpt: 'Warm and easy' })
  expect(String(body.body_html)).toContain('Soup, porridge and more.')

  await expect(page).toHaveURL(/\/admin\/content\/blog\/bp-2$/)
  await expect(page.getByRole('link', { name: 'Preview' })).toHaveAttribute('href', '/blog/winter-menu-for-kids?preview=1')

  await page.getByRole('link', { name: 'All posts' }).click()
  await page.getByRole('button', { name: 'Categories' }).click()
  const dialog = page.getByRole('dialog', { name: 'Blog categories' })
  await dialog.getByRole('button', { name: 'New category' }).click()
  await dialog.getByLabel('Category name').fill('Store news')
  await expect(dialog.getByLabel('Category address')).toHaveValue('store-news')
  await dialog.getByRole('button', { name: 'Add category' }).click()
  await expect(dialog.getByRole('list', { name: 'Blog categories' }).getByText('Store news')).toBeVisible()
})

test('cancels a paid web order with a full refund', async ({ page }) => {
  await mockBackend(page)
  const order = {
    id: 'wo-1', number: 'WEB-000001', status: 'confirmed', status_label: 'Confirmed', payment_status: 'paid', payment_method: 'bank_transfer',
    payment_method_label: 'Bank transfer', payment_instructions: null, placed_at: '2026-10-31T04:30:00Z', expires_at: null,
    contact: { name: 'Ayesha Rahman', email: 'ayesha@example.com', phone: '01711000000' },
    shipping_address: { recipient_name: 'Ayesha Rahman', phone: '01711000000', division: 'Dhaka', district: 'Dhaka', area: 'Dhanmondi', address_line: 'House 12, Road 5', postcode: '1205' },
    shipping_method_name: 'Home delivery', eta_min_days: 1, eta_max_days: 2,
    lines: [{ product_name: 'Baby Romper', variant_name: 'Size M', sku: 'ROMP-M', image_url: null, quantity: '2.000', unit_price: '750.00', line_total: '1500.00', product_url: null }],
    subtotal: '1500.00', tax_total: '0.00', shipping_total: '60.00', cod_fee: '0.00', total: '1560.00', currency: 'BDT', prices_include_tax: false,
    courier_name: null, tracking_number: null, history: [{ status: 'confirmed', label: 'Confirmed', at: '2026-10-31T06:00:00Z', actor: null, note: null }],
    customer: null, ip: null, user_agent: null, notes: null, cancel_reason: null,
    payments: [{ method: 'bank_transfer', method_label: 'Bank transfer', amount: '1560.00', reference: 'TRX-778', recorded_at: '2026-10-31T06:00:00Z', recorded_by: 'Nadia Admin' }],
    allowed_actions: ['process', 'cancel'], paid_total: '1560.00', refunded_total: '0.00',
  }
  let current: Record<string, unknown> = order
  let attempts = 0
  await page.route('**/api/v1/web-orders/wo-1', (route) => route.fulfill({ json: envelope(current) }))
  await page.route('**/api/v1/web-orders/wo-1/cancel', (route) => {
    attempts += 1
    const body = route.request().postDataJSON() as { refund?: { method: string } }
    if (body.refund?.method === 'cash') {
      return route.fulfill({ status: 422, json: { success: false, error: { code: 'CASH_SESSION_REQUIRED', message: 'Open a register session first.', details: {} }, meta: { request_id: 'e2e' } } })
    }
    current = { ...order, status: 'cancelled', status_label: 'Cancelled', payment_status: 'refunded', refunded_total: '1560.00', allowed_actions: [], cancel_reason: 'Out of stock' }
    return route.fulfill({ json: envelope(current) })
  })

  await page.goto('/admin/web-orders/wo-1')
  await page.getByRole('group', { name: 'Order actions' }).getByRole('button', { name: 'Cancel order' }).click()
  const dialog = page.getByRole('dialog', { name: 'Cancel WEB-000001?' })
  await expect(dialog.getByTestId('cancel-refund-due')).toContainText('1,560.00')
  await dialog.getByLabel('Reason').fill('Out of stock')

  await dialog.getByRole('combobox', { name: 'Paid back by' }).click()
  await page.getByRole('option', { name: 'Cash' }).click()
  await dialog.getByRole('button', { name: 'Cancel and refund' }).click()
  await expect(dialog.getByRole('alert')).toContainText('you have none')

  await dialog.getByRole('combobox', { name: 'Paid back by' }).click()
  await page.getByRole('option', { name: 'Bank transfer' }).click()
  await dialog.getByLabel('Refund reference (optional)').fill('TRX-REF-1')
  const cancelled = page.waitForRequest((r: Request) => r.url().endsWith('/web-orders/wo-1/cancel') && r.method() === 'POST' && (r.postDataJSON() as { refund: { method: string } }).refund.method === 'bank_transfer')
  await dialog.getByRole('button', { name: 'Cancel and refund' }).click()

  expect((await cancelled).postDataJSON()).toEqual({ reason: 'Out of stock', refund: { method: 'bank_transfer', reference: 'TRX-REF-1' } })
  await expect(page.getByText('WEB-000001 cancelled and refunded.')).toBeVisible()
  await expect(dialog).toBeHidden()
  expect(attempts).toBe(2)
})
