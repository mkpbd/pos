import { expect, test, type Page, type Request, type Route } from '@playwright/test'

/**
 * Admin promotions (E8b) against a mocked API: create a coupon promotion, add and generate
 * codes; create a brand flash sale with a countdown. Runs on desktop and mobile.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const paged = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

const me = {
  user: { id: 'u-1', name: 'Nadia Admin', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-1', name: 'Online Store Manager', system_key: null }],
  permissions: ['branches.view', 'promotions.view', 'promotions.manage', 'web_orders.view', 'products.view'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
}

const base = {
  description: null, starts_at: null, ends_at: null, min_subtotal: null, max_discount: null, show_countdown: false, is_active: true,
  usage_limit: null, usage_limit_per_customer: null, state: 'active', coupon_count: 0, redemption_count: 0, discount_total: '0.00', targets: [], coupons_preview: [],
}

async function mockBackend(page: Page) {
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
}

const path = (p: string) => (url: URL) => url.pathname === `/api/v1${p}`

test('creates a coupon promotion, adds a code and generates a batch', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await mockBackend(page)
  let promotion: Record<string, unknown> | null = null
  const coupons: { id: string; code: string; usage_limit: number | null; used_count: number; is_active: boolean }[] = []

  await page.route(path('/promotions'), (route: Route) => {
    if (route.request().method() === 'POST') {
      promotion = { ...base, ...(route.request().postDataJSON() as object), id: 'pr-2' }
      return route.fulfill({ status: 201, json: envelope(promotion) })
    }
    return route.fulfill({ json: paged(promotion ? [promotion] : []) })
  })
  await page.route(path('/promotions/pr-2'), (route) => route.fulfill({ json: envelope({ ...promotion, coupon_count: coupons.length }) }))
  await page.route(path('/promotions/pr-2/coupons'), (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { code?: string; generate?: number; prefix?: string }
      const made = body.code
        ? [{ id: `cp-${coupons.length}`, code: body.code, usage_limit: null, used_count: 0, is_active: true }]
        : Array.from({ length: body.generate ?? 0 }, (_, i) => ({ id: `cp-g${i}`, code: `${body.prefix ?? ''}X${i}Q7`, usage_limit: null, used_count: 0, is_active: true }))
      coupons.push(...made)
      return route.fulfill({ status: 201, json: envelope(made) })
    }
    return route.fulfill({ json: paged(coupons) })
  })

  await page.goto('/admin/promotions')
  await expect(page.getByText('No promotions yet')).toBeVisible()
  await page.getByRole('link', { name: 'New promotion' }).click()

  await expect(page.getByRole('note')).toContainText('Shoppers get the single best product offer per item, plus the best order offer')
  await page.getByLabel('Name').fill('Welcome 50')
  await page.getByRole('combobox', { name: 'Discount type' }).click()
  await page.getByRole('option', { name: 'Fixed amount off' }).click()
  await page.getByLabel('Amount off (BDT)').fill('50')
  await page.getByLabel('Minimum subtotal (BDT)').fill('500')
  await page.getByRole('combobox', { name: 'Trigger' }).click()
  await page.getByRole('option', { name: 'Coupon code' }).click()
  await page.getByLabel('Uses per customer').fill('1')

  const post = page.waitForRequest((r: Request) => new URL(r.url()).pathname === '/api/v1/promotions' && r.method() === 'POST')
  await page.getByRole('button', { name: 'Create promotion' }).click()
  expect((await post).postDataJSON()).toEqual({
    name: 'Welcome 50', description: null, type: 'fixed', value: '50', scope: 'order', target_ids: [], min_subtotal: '500', max_discount: null,
    trigger: 'coupon', starts_at: null, ends_at: null, show_countdown: false, is_active: true, usage_limit: null, usage_limit_per_customer: 1,
  })

  await expect(page).toHaveURL(/\/admin\/promotions\/pr-2\?tab=coupons$/)
  await expect(page.getByText('No codes yet')).toBeVisible()
  await page.getByLabel('New code').fill('welcome50')
  await page.getByRole('button', { name: 'Add code' }).click()
  await expect(page.getByRole('cell', { name: 'WELCOME50', exact: true })).toBeVisible()

  await page.getByLabel('How many codes').fill('3')
  await page.getByLabel('Prefix (optional)').fill('eid-')
  const generate = page.waitForRequest((r: Request) => new URL(r.url()).pathname === '/api/v1/promotions/pr-2/coupons' && r.method() === 'POST')
  await page.getByRole('button', { name: 'Generate codes' }).click()
  expect((await generate).postDataJSON()).toEqual({ generate: 3, prefix: 'EID-' })

  const dialog = page.getByRole('dialog', { name: '3 codes generated' })
  await expect(dialog.getByLabel('Generated codes')).toHaveValue('EID-X0Q7\nEID-X1Q7\nEID-X2Q7')
  await dialog.getByRole('button', { name: 'Copy all' }).click()
  await expect(page.getByText('3 codes copied.')).toBeVisible()
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('cell', { name: 'EID-X2Q7', exact: true })).toBeVisible()
})

test('creates a brand flash sale with a countdown', async ({ page }) => {
  await mockBackend(page)
  await page.route(path('/brands'), (route) => route.fulfill({ json: envelope([{ id: 'br-1', name: 'Pran', description: null, is_active: true }]) }))
  let body: Record<string, unknown> | undefined
  await page.route(path('/promotions'), (route) => {
    body = route.request().postDataJSON() as Record<string, unknown>
    return route.fulfill({ status: 201, json: envelope({ ...base, ...body, id: 'pr-1', targets: [{ id: 'br-1', name: 'Pran' }] }) })
  })
  await page.route(path('/promotions/pr-1'), (route) => route.fulfill({ json: envelope({ ...base, ...body, id: 'pr-1', targets: [{ id: 'br-1', name: 'Pran' }] }) }))

  await page.goto('/admin/promotions/new')
  await page.getByLabel('Name').fill('Juice week')
  await page.getByLabel('Description').fill('10% off Pran juices')
  await page.getByLabel('Percentage off (%)').fill('10')
  await page.getByRole('combobox', { name: 'Applies to' }).click()
  await page.getByRole('option', { name: 'Selected brands' }).click()
  await page.getByRole('combobox', { name: 'Add brand' }).click()
  await page.getByRole('option', { name: 'Pran' }).click()
  await expect(page.getByTestId('countdown-unavailable')).toBeVisible()
  await page.getByLabel('Ends').fill('2026-11-08T00:00')
  await page.getByRole('switch', { name: 'Flash sale countdown' }).click()

  const post = page.waitForRequest((r: Request) => new URL(r.url()).pathname === '/api/v1/promotions' && r.method() === 'POST')
  await page.getByRole('button', { name: 'Create promotion' }).click()
  expect((await post).postDataJSON()).toMatchObject({
    name: 'Juice week', description: '10% off Pran juices', type: 'percent', value: '10', scope: 'brands', target_ids: ['br-1'],
    trigger: 'automatic', ends_at: '2026-11-08T00:00:00+06:00', show_countdown: true,
  })
  await expect(page).toHaveURL(/\/admin\/promotions\/pr-1$/)
  await expect(page.getByRole('heading', { name: 'Juice week' })).toBeVisible()
})
