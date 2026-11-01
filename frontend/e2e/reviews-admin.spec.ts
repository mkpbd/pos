import { expect, test, type Page, type Request, type Route } from '@playwright/test'

/**
 * Admin review moderation (E9) against a mocked API: approve, reject with a reason, delete
 * after confirmation, filters in the query; read-only for viewers. Runs on desktop and mobile.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const paged = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

const user = (permissions: string[]) => ({
  user: { id: 'u-1', name: 'Nadia Admin', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-1', name: 'Online Store Manager', system_key: null }],
  permissions,
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
})

type Review = {
  id: string
  product: { id: string; name: string }
  customer: { id: string; name: string; email: string | null }
  rating: number
  title: string | null
  body: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
  moderated_at: string | null
  moderated_by_name: string | null
  rejection_reason: string | null
}

const base = { created_at: '2026-10-31T04:30:00Z', moderated_at: null, moderated_by_name: null, rejection_reason: null, status: 'pending' as const }
const seed = (): Review[] => [
  { ...base, id: 'rv-1', product: { id: 'p-1', name: 'Pran Mango Juice 1L' }, customer: { id: 'c-1', name: 'Ayesha Rahman', email: 'ayesha@example.com' }, rating: 5, title: 'Tastes fresh', body: 'Arrived cold and well packed. Will buy again.' },
  { ...base, id: 'rv-2', product: { id: 'p-2', name: 'Baby Romper' }, customer: { id: 'c-2', name: 'Karim Ali', email: null }, rating: 2, title: null, body: 'Call me on 01711000000 for a better price.' },
  { ...base, id: 'rv-3', product: { id: 'p-2', name: 'Baby Romper' }, customer: { id: 'c-3', name: 'Sumi Akter', email: null }, rating: 1, title: 'Spam', body: 'Visit my shop for cheaper rompers today.' },
]

async function mockBackend(page: Page, permissions: string[], store: Review[]) {
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(user(permissions)) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route((url) => url.pathname === '/api/v1/reviews', (route: Route) => {
    const q = new URL(route.request().url()).searchParams
    const term = q.get('search')?.toLowerCase()
    return route.fulfill({
      json: paged(
        store.filter(
          (r) =>
            (!q.get('status') || r.status === q.get('status')) &&
            (!q.get('rating') || r.rating === Number(q.get('rating'))) &&
            (!term || `${r.product.name} ${r.customer.name} ${r.body}`.toLowerCase().includes(term)),
        ),
      ),
    })
  })
  await page.route(/\/api\/v1\/reviews\/[^/]+(\/(approve|reject))?$/, (route: Route) => {
    const request = route.request()
    const [, id, action] = new URL(request.url()).pathname.match(/\/reviews\/([^/]+)(?:\/(\w+))?$/) ?? []
    const index = store.findIndex((r) => r.id === id)
    if (index < 0) return route.fulfill({ status: 404, json: { success: false, error: { code: 'NOT_FOUND', message: 'Not found.', details: {} }, meta: { request_id: 'e2e' } } })
    if (request.method() === 'DELETE') {
      store.splice(index, 1)
      return route.fulfill({ status: 204 })
    }
    const reason = action === 'reject' ? ((request.postDataJSON() as { reason?: string } | null)?.reason ?? null) : null
    store[index] = { ...store[index]!, status: action === 'approve' ? 'approved' : 'rejected', rejection_reason: reason, moderated_at: '2026-11-01T06:00:00Z', moderated_by_name: 'Nadia Admin' }
    return route.fulfill({ json: envelope(store[index]) })
  })
}

const reviewItem = (page: Page, name: string) => page.getByRole('listitem', { name: new RegExp(`by ${name}$`) })

test('moderates the pending queue: approve, reject with a reason, delete', async ({ page }) => {
  const store = seed()
  await mockBackend(page, ['branches.view', 'reviews.view', 'reviews.moderate'], store)

  await page.goto('/admin/reviews')
  await expect(page.getByRole('heading', { name: 'Reviews' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Pending' })).toHaveAttribute('aria-selected', 'true')
  const ayesha = reviewItem(page, 'Ayesha Rahman')
  await expect(ayesha.getByRole('img', { name: '5 out of 5 stars' })).toBeVisible()
  await expect(ayesha.getByText('Tastes fresh')).toBeVisible()

  const approve = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/reviews/rv-1/approve') && r.method() === 'POST')
  await ayesha.getByRole('button', { name: 'Approve' }).click()
  await approve
  await expect(page.getByText('Review approved. It is now shown in the store.')).toBeVisible()
  await expect(ayesha).toHaveCount(0)

  await reviewItem(page, 'Karim Ali').getByRole('button', { name: 'Reject' }).click()
  const dialog = page.getByRole('dialog', { name: 'Reject this review?' })
  await dialog.getByLabel('Reason (optional)').fill('Contains a phone number')
  const reject = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/reviews/rv-2/reject') && r.method() === 'POST')
  await dialog.getByRole('button', { name: 'Reject review' }).click()
  expect((await reject).postDataJSON()).toEqual({ reason: 'Contains a phone number' })
  await expect(dialog).toBeHidden()
  await expect(reviewItem(page, 'Karim Ali')).toHaveCount(0)

  await reviewItem(page, 'Sumi Akter').getByRole('button', { name: 'Delete' }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Delete this review?' })
  await expect(confirm).toContainText("Sumi Akter's review of Baby Romper is removed for good.")
  await confirm.getByRole('button', { name: 'Delete review' }).click()
  await expect(page.getByText('Review deleted.')).toBeVisible()
  await expect(page.getByText('No reviews waiting for moderation')).toBeVisible()
  expect(store.map((r) => r.id)).toEqual(['rv-1', 'rv-2'])

  await page.getByRole('tab', { name: 'Rejected' }).click()
  await expect(page).toHaveURL(/\/admin\/reviews\?status=rejected$/)
  const karim = reviewItem(page, 'Karim Ali')
  await expect(karim.getByText('Contains a phone number')).toBeVisible()
  await expect(karim.getByTestId('review-moderation')).toContainText('Rejected by Nadia Admin')
  await expect(karim.getByRole('button', { name: 'Approve' })).toBeVisible()
  await expect(karim.getByRole('button', { name: 'Reject' })).toHaveCount(0)
})

test('filters by rating and search, all statuses', async ({ page }) => {
  await mockBackend(page, ['branches.view', 'reviews.view', 'reviews.moderate'], seed())

  await page.goto('/admin/reviews?status=all')
  await expect(page.getByRole('list', { name: 'Reviews' }).getByRole('listitem')).toHaveCount(3)
  await page.getByRole('combobox', { name: 'Filter by rating' }).click()
  await page.getByRole('option', { name: '2 stars' }).click()
  await expect(page).toHaveURL(/rating=2/)
  await expect(page.getByRole('list', { name: 'Reviews' }).getByRole('listitem')).toHaveCount(1)
  await expect(reviewItem(page, 'Karim Ali')).toBeVisible()

  await page.getByRole('combobox', { name: 'Filter by rating' }).click()
  await page.getByRole('option', { name: 'Any rating' }).click()
  await page.getByLabel('Search reviews').fill('mango')
  await expect(page).toHaveURL(/search=mango/)
  await expect(page.getByRole('list', { name: 'Reviews' }).getByRole('listitem')).toHaveCount(1)
  await expect(reviewItem(page, 'Ayesha Rahman')).toBeVisible()
  await page.getByLabel('Search reviews').fill('nothing like this')
  await expect(page.getByText('No matching reviews')).toBeVisible()
})

test('is read-only for staff who may only view reviews', async ({ page }) => {
  await mockBackend(page, ['branches.view', 'reviews.view'], seed())

  await page.goto('/admin/reviews')
  await expect(reviewItem(page, 'Ayesha Rahman')).toBeVisible()
  await expect(page.getByTestId('reviews-read-only')).toBeVisible()
  await expect(page.getByRole('group', { name: 'Moderation actions' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0)
})
