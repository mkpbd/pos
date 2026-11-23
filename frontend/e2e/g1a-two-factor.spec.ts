import { expect, test, type Page } from '@playwright/test'

/**
 * G1a sign-in security against a mocked API: the two-factor step at sign-in (authenticator code and
 * recovery code), the organization's "setup required" gate with the QR code and recovery codes,
 * the two-factor policy on the Organization page, and unlocking / resetting another user's
 * two-factor on the Users page. Runs on desktop and mobile.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const paged = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })
const failure = (status: number, code: string, message: string, details: Record<string, unknown> = {}) => ({
  status,
  json: { success: false, error: { code, message, details }, meta: { request_id: 'e2e' } },
})

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
const OTPAUTH_URI = `otpauth://totp/Corner%20Shop:rahim%40corner.test?secret=${SECRET}&issuer=Corner%20Shop&algorithm=SHA1&digits=6&period=30`
const RECOVERY_CODES = ['abcde-23456', 'fghjk-34567', 'mnpqr-45678', 'stuvw-56789', 'xyz23-67892', 'abcde-78923', 'fghjk-89234', 'mnpqr-92345', 'stuvw-23457', 'xyz23-34568']

const org = { id: 'o-1', name: 'Corner Shop', slug: 'corner-shop', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' }
const branch = { id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }
const ADMIN = ['branches.view', 'users.view', 'users.manage', 'roles.view', 'organization.view', 'organization.update']
const me = (twoFactor: { enabled: boolean; required: boolean; setup_required: boolean }, permissions = ADMIN) => ({
  user: { id: 'u-1', name: 'Rahim Uddin', email: 'rahim@corner.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: org, roles: [{ id: 'r-1', name: 'Organization Admin', system_key: 'organization_admin' }], permissions, branches: [branch],
  two_factor: twoFactor,
})
const ON = { enabled: true, required: false, setup_required: false }

const managedUser = (overrides: Record<string, unknown>) => ({
  id: 'u-1', name: 'Rahim Uddin', email: 'rahim@corner.test', phone: null, status: 'active', is_platform_admin: false, last_login_at: null,
  roles: [{ id: 'r-1', name: 'Organization Admin', system_key: 'organization_admin' }], branch_ids: ['b-1'], created_at: '2026-10-01T00:00:00Z',
  two_factor_enabled: true, is_locked: false, locked_until: null, ...overrides,
})

/** Mocks shared by every test; `current()` is the session GET /auth/me answers (null = signed out). */
async function mockApp(page: Page, current: () => unknown) {
  await page.addInitScript(() => localStorage.setItem('pos-session', JSON.stringify({ state: { activeBranchId: 'b-1' }, version: 0 })))
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: paged([]) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => {
    const session = current()
    return session ? route.fulfill({ json: envelope(session) }) : route.fulfill(failure(401, 'UNAUTHENTICATED', 'Unauthenticated.'))
  })
  await page.route('**/api/v1/auth/options', (route) => route.fulfill({ json: envelope({ registration_enabled: false }) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/roles', (route) => route.fulfill({ json: envelope([]) }))
}

async function expectNoHorizontalScroll(page: Page) {
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
}

async function enterPassword(page: Page) {
  await page.getByLabel('E-mail').fill('rahim@corner.test')
  await page.getByLabel('Password').fill('password1')
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test('sign-in with two-factor: a wrong code, then the right one, lands on the requested page', async ({ page }) => {
  let session: unknown = null
  const challenges: unknown[] = []
  await mockApp(page, () => session)
  await page.route('**/api/v1/auth/login', (route) => route.fulfill({ json: envelope({ two_factor_required: true }) }))
  await page.route('**/api/v1/auth/two-factor-challenge', (route) => {
    const body = route.request().postDataJSON() as { code?: string }
    challenges.push(body)
    if (body.code !== '246810') return route.fulfill(failure(422, 'INVALID_TWO_FACTOR_CODE', 'That code is not right. Try again.'))
    session = me(ON)
    return route.fulfill({ json: envelope(session) })
  })
  await page.route('**/api/v1/users?**', (route) => route.fulfill({ json: paged([managedUser({})]) }))

  await page.goto('/admin/login?redirect=%2Fusers')
  await enterPassword(page)

  await expect(page.getByRole('heading', { name: 'Two-factor sign-in' })).toBeVisible()
  const code = page.getByLabel('Authentication code')
  await expect(code).toHaveAttribute('inputmode', 'numeric')
  await expect(code).toHaveAttribute('autocomplete', 'one-time-code')
  await expectNoHorizontalScroll(page)
  // Six digits submit on their own.
  await code.fill('111111')
  await expect(page.getByText('That code is not right. Try again.')).toBeVisible()
  await expect(code).toHaveValue('')
  await code.fill('246810')

  await expect(page).toHaveURL(/\/admin\/users$/)
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible()
  expect(challenges).toEqual([{ code: '111111' }, { code: '246810' }])
})

test('sign-in with a recovery code; an expired challenge goes back to the password', async ({ page }) => {
  let session: unknown = null
  let expired = true
  const challenges: unknown[] = []
  await mockApp(page, () => session)
  await page.route('**/api/v1/auth/login', (route) => route.fulfill({ json: envelope({ two_factor_required: true }) }))
  await page.route('**/api/v1/auth/two-factor-challenge', (route) => {
    challenges.push(route.request().postDataJSON())
    if (expired) {
      expired = false
      return route.fulfill(failure(422, 'TWO_FACTOR_CHALLENGE_EXPIRED', 'Sign in again.'))
    }
    session = me(ON, ['branches.view'])
    return route.fulfill({ json: envelope(session) })
  })

  await page.goto('/admin/login')
  await enterPassword(page)
  await page.getByRole('button', { name: 'Use a recovery code instead' }).click()
  await page.getByLabel('Recovery code').fill('ABCDE-23456')
  await page.getByRole('button', { name: 'Verify' }).click()

  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveText('Sign in again.')

  await enterPassword(page)
  await page.getByRole('button', { name: 'Use a recovery code instead' }).click()
  await page.getByLabel('Recovery code').fill('abcde-23456')
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page).not.toHaveURL(/\/login/)
  expect(challenges).toEqual([{ recovery_code: 'abcde-23456' }, { recovery_code: 'abcde-23456' }])
})

test('a locked account sees the lockout message', async ({ page }) => {
  await mockApp(page, () => null)
  await page.route('**/api/v1/auth/login', (route) =>
    route.fulfill(failure(422, 'ACCOUNT_LOCKED', 'Too many failed sign-ins. Try again in 15 minutes or ask your administrator.')))

  await page.goto('/admin/login')
  await enterPassword(page)
  await expect(page.getByRole('alert')).toHaveText('Too many failed sign-ins. Try again in 15 minutes or ask your administrator.')
})

test('setup required: the gate, the QR code and key, the code, and recovery codes before continuing', async ({ page }) => {
  let enabled = false
  await mockApp(page, () => me(enabled ? { enabled: true, required: true, setup_required: false } : { enabled: false, required: true, setup_required: true }))
  await page.route('**/api/v1/auth/two-factor', (route) =>
    route.fulfill({ json: envelope({ enabled, confirmed_at: enabled ? '2026-11-23T05:00:00Z' : null, required: true, recovery_codes_left: enabled ? 10 : null, pending_setup: false }) }))
  await page.route('**/api/v1/auth/two-factor/setup', (route) => route.fulfill({ json: envelope({ secret: SECRET, otpauth_uri: OTPAUTH_URI }) }))
  await page.route('**/api/v1/auth/two-factor/confirm', (route) => {
    enabled = true
    return route.fulfill({ json: envelope({ recovery_codes: RECOVERY_CODES }) })
  })
  // Before setup every other staff route answers 403.
  await page.route('**/api/v1/users?**', (route) =>
    enabled ? route.fulfill({ json: paged([managedUser({})]) }) : route.fulfill(failure(403, 'TWO_FACTOR_SETUP_REQUIRED', 'Set up two-factor sign-in first.')))

  await page.goto('/admin/users')
  await expect(page).toHaveURL(/\/admin\/two-factor\/setup\?redirect=%2Fusers$/)
  await expect(page.getByRole('heading', { name: 'Set up two-factor sign-in' })).toBeVisible()
  await expect(page.getByText('Corner Shop requires two-factor sign-in for your account.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()

  await page.getByLabel('Password').fill('password1')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('img', { name: 'QR code to scan with your authenticator app' })).toBeVisible()
  await expect(page.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeVisible()
  await expectNoHorizontalScroll(page)
  await page.getByLabel('2. Enter the 6-digit code from the app').fill('135790')
  await page.getByRole('button', { name: 'Turn on two-factor' }).click()

  const codes = page.getByRole('list', { name: 'Recovery codes' })
  await expect(codes.getByRole('listitem')).toHaveCount(10)
  await expect(codes).toContainText('abcde-23456')
  await expectNoHorizontalScroll(page)
  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download .txt' }).click()
  expect((await download).suggestedFilename()).toBe('recovery-codes.txt')
  const continueButton = page.getByRole('button', { name: 'Continue to the app' })
  await expect(continueButton).toBeDisabled()
  await page.getByText('I’ve saved these codes').click()
  await continueButton.click()

  await expect(page).toHaveURL(/\/admin\/users$/)
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible()
})

test('Organization → Security: tightening the policy asks first and shows the counts', async ({ page }) => {
  const patches: unknown[] = []
  let organization = {
    ...org, legal_name: null, tax_number: null, email: null, phone: null, address: null,
    settings: { two_factor_policy: 'optional' }, two_factor_summary: { users: 8, enabled: 3, required_missing: 0 },
  }
  await mockApp(page, () => me(ON))
  await page.route('**/api/v1/organization', (route) => {
    if (route.request().method() === 'PATCH') {
      const patch = route.request().postDataJSON() as { settings: Record<string, unknown> }
      patches.push(patch)
      organization = { ...organization, settings: { ...organization.settings, ...patch.settings } as typeof organization.settings, two_factor_summary: { users: 8, enabled: 3, required_missing: 2 } }
    }
    return route.fulfill({ json: envelope(organization) })
  })

  await page.goto('/admin/organization')
  const policy = page.getByRole('combobox', { name: 'Two-factor sign-in' })
  await expect(policy).toHaveText('Optional')
  await expect(page.getByText('Staff accounts')).toBeVisible()
  await policy.click()
  await page.getByRole('option', { name: 'Required for admins' }).click()
  await expect(page.getByText('People who can manage users, roles or organization settings must use it.')).toBeVisible()
  await page.getByRole('button', { name: 'Save security settings' }).click()

  const confirm = page.getByRole('alertdialog', { name: 'Require two-factor sign-in for admins?' })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: 'Require it' }).click()

  await expect.poll(() => patches).toEqual([{ settings: { two_factor_policy: 'admins' } }])
  await expect(page.getByText('Required, not set up').locator('xpath=following-sibling::dd')).toHaveText('2')
  await expect(page.getByRole('button', { name: 'Save security settings' })).toBeDisabled()
  await expectNoHorizontalScroll(page)
})

test('Users: 2FA and lock badges, unlock and reset two-factor after confirming', async ({ page }) => {
  const lockedUntil = new Date(Date.now() + 15 * 60_000).toISOString()
  let karim = managedUser({ id: 'u-2', name: 'Karim Cashier', email: 'karim@corner.test', is_locked: true, locked_until: lockedUntil })
  const calls: string[] = []
  await mockApp(page, () => me(ON))
  await page.route('**/api/v1/users?**', (route) => route.fulfill({ json: paged([managedUser({}), karim]) }))
  await page.route('**/api/v1/users/u-2/unlock', (route) => {
    calls.push('unlock')
    karim = { ...karim, is_locked: false, locked_until: null }
    return route.fulfill({ json: envelope(karim) })
  })
  await page.route('**/api/v1/users/u-2/two-factor/reset', (route) => {
    calls.push('reset')
    karim = { ...karim, two_factor_enabled: false }
    return route.fulfill({ json: envelope(karim) })
  })

  await page.goto('/admin/users')
  const row = page.getByRole('row').filter({ hasText: 'Karim Cashier' })
  await expect(row.getByText('2FA')).toBeVisible()
  await expect(row.getByText(/Locked until/)).toBeVisible()
  // Your own row has no reset action.
  await expect(page.getByRole('row').filter({ hasText: '(you)' }).getByRole('button', { name: /More actions/ })).toHaveCount(0)
  await expectNoHorizontalScroll(page)

  await row.getByRole('button', { name: 'More actions for Karim Cashier' }).click()
  await page.getByRole('menuitem', { name: 'Unlock' }).click()
  await page.getByRole('alertdialog', { name: 'Unlock Karim Cashier?' }).getByRole('button', { name: 'Unlock' }).click()
  await expect(row.getByText(/Locked until/)).toHaveCount(0)

  await row.getByRole('button', { name: 'More actions for Karim Cashier' }).click()
  await page.getByRole('menuitem', { name: 'Reset two-factor' }).click()
  await page.getByRole('alertdialog', { name: 'Reset two-factor sign-in for Karim Cashier?' }).getByRole('button', { name: 'Reset two-factor' }).click()
  await expect(row.getByText('2FA')).toHaveCount(0)
  expect(calls).toEqual(['unlock', 'reset'])
})

test('Profile: two-factor status with recovery codes left and no turn-off when required', async ({ page }) => {
  await mockApp(page, () => me({ enabled: true, required: true, setup_required: false }))
  await page.route('**/api/v1/auth/two-factor', (route) =>
    route.fulfill({ json: envelope({ enabled: true, confirmed_at: '2026-11-20T05:00:00Z', required: true, recovery_codes_left: 3, pending_setup: false }) }))
  await page.route('**/api/v1/auth/tokens', (route) => route.fulfill({ json: envelope([]) }))

  await page.goto('/admin/profile')
  await expect(page.getByText('3 recovery codes left. Make new ones soon.')).toBeVisible()
  await expect(page.getByText('Your organization requires two-factor sign-in, so it can’t be turned off.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Turn off' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'New recovery codes' })).toBeVisible()
  await expectNoHorizontalScroll(page)
})
