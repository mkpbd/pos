import { expect, test, type Page } from '@playwright/test'

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const page1 = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

const me = {
  user: { id: 'u-1', name: 'Rahim Uddin', email: 'rahim@corner.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Corner Shop', slug: 'corner-shop', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-1', name: 'Organization Admin', system_key: 'organization_admin' }],
  permissions: ['audit.view', 'branches.manage', 'branches.view', 'organization.update', 'organization.view', 'roles.manage', 'roles.view', 'users.manage', 'users.view'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
}

const branch = {
  id: 'b-1', code: 'MAIN', name: 'Main Branch', email: null, phone: null, address: null, timezone: null,
  is_active: true, allow_negative_stock: false, created_at: '',
  stores: [{ id: 's-1', branch_id: 'b-1', code: 'MAIN', name: 'Main Store', type: 'store', is_active: true }],
}

async function mockBackend(page: Page, { signedIn }: { signedIn: boolean }) {
  let session = signedIn
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) =>
    session
      ? route.fulfill({ json: envelope(me) })
      : route.fulfill({ status: 401, json: { success: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.', details: {} }, meta: { request_id: 'e2e' } } }),
  )
  await page.route('**/api/v1/auth/login', async (route) => {
    const body = route.request().postDataJSON() as { email: string; password: string }
    if (body.password !== 'password1') {
      return route.fulfill({ status: 422, json: { success: false, error: { code: 'INVALID_CREDENTIALS', message: 'These credentials do not match our records.', details: {} }, meta: { request_id: 'e2e' } } })
    }
    session = true
    return route.fulfill({ json: envelope(me) })
  })
  await page.route('**/api/v1/branches?*', (route) => route.fulfill({ json: page1([branch]) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/health', (route) =>
    route.fulfill({ json: envelope({ status: 'ok', checks: { database: 'ok', cache: 'ok' }, app: 'Enterprise POS', environment: 'e2e', time: '' }) }),
  )
}

test('sign-in flow lands on the first permitted page with the branch selected', async ({ page }) => {
  await mockBackend(page, { signedIn: false })
  await page.goto('/admin')

  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await page.getByLabel('E-mail').fill('rahim@corner.test')
  await page.getByLabel('Password').fill('wrong-pass1')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toContainText('These credentials do not match our records.')

  const branchHeader = page.waitForRequest((req) => req.url().includes('/api/v1/branches') && req.headers()['x-branch-id'] === 'b-1')
  await page.getByLabel('Password').fill('password1')
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByRole('heading', { name: 'Branches' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Main Branch', exact: true })).toBeVisible()
  await branchHeader
})

test('system status page reports backend health', async ({ page }) => {
  await mockBackend(page, { signedIn: true })
  await page.goto('/admin/system-status')

  await expect(page.getByRole('heading', { name: 'System status' })).toBeVisible()
  await expect(page.getByText('Operational')).toBeVisible()
})

test('theme can be switched to dark', async ({ page }) => {
  await mockBackend(page, { signedIn: true })
  await page.goto('/admin/system-status')

  await page.getByRole('button', { name: 'Change theme' }).click()
  await page.getByRole('menuitemradio', { name: 'Dark' }).click()

  await expect(page.locator('html')).toHaveClass(/dark/)
})
