import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * BD1a §8, mocked public/customer API: signing in with a code sent to the mobile number. A new
 * shopper gives a name and lands in the account (no e-mail, no password yet: the profile offers
 * both and the number shows as verified); a known number signs straight in and goes on to `?next=`.
 */

const envelope = (data: unknown) => ({ success: true, data, meta: { request_id: 'e2e' } })
const failure = (status: number, code: string, message: string, details: Record<string, unknown> = {}) => ({
  status,
  json: { success: false, error: { code, message, details }, meta: { request_id: 'e2e' } },
})

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
  menus: {},
  checkout: { email: 'optional', phone_verification: 'off' },
  account: { phone_login: true },
}

type Customer = { id: string; name: string; email: string | null; phone: string | null; email_verified: boolean; phone_verified: boolean; has_password: boolean }

const KNOWN_PHONE = '01711223344'
const CODE = '123456'

type State = { me: Customer | null; sends: unknown[]; logins: unknown[]; registers: unknown[]; pendingPhone: string | null }

async function serveStore(page: Page) {
  const state: State = { me: null, sends: [], logins: [], registers: [], pendingPhone: null }
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/store/'),
    async (route: Route) => {
      const request = route.request()
      const url = new URL(request.url())
      const key = `${request.method()} ${url.pathname.replace('/api/v1', '')}`
      const body = (request.postDataJSON() ?? {}) as Record<string, string>
      switch (key) {
        case 'GET /store/bootstrap':
          return route.fulfill({ json: envelope(bootstrap) })
        case 'GET /store/homepage':
          return route.fulfill({ json: envelope({ sections: [], preview: false }) })
        case 'GET /store/account/me':
          return route.fulfill({ json: envelope(state.me) })
        case 'GET /store/account/profile':
          return route.fulfill({ json: envelope(state.me) })
        case 'GET /store/cart':
          return route.fulfill({ json: envelope({ id: null, items: [], item_count: '0', subtotal: '0.00', discount_total: '0.00', tax_total: '0.00', total: '0.00', prices_include_tax: true, currency: 'BDT', issues: [], promotions: [], free_shipping: null, coupon: null }) })
        case 'GET /store/wishlist':
          return route.fulfill({ json: envelope({ items: [] }) })
        case 'GET /store/account/orders':
          return route.fulfill({ json: { ...envelope([]), meta: { request_id: 'e2e', pagination: { current_page: 1, per_page: 10, total: 0, last_page: 1 } } } })
        case 'POST /store/account/otp/send':
          state.sends.push(body)
          return route.fulfill({ status: 202, json: envelope({ resend_after: 60, expires_in: 300 }) })
        case 'POST /store/account/otp/login': {
          state.logins.push(body)
          if (body.code !== CODE) return route.fulfill(failure(422, 'OTP_INVALID', 'The code is not correct.'))
          if (body.phone === KNOWN_PHONE) {
            state.me = { id: 'c-1', name: 'Rina Akter', email: 'rina@example.com', phone: KNOWN_PHONE, email_verified: true, phone_verified: true, has_password: true }
            return route.fulfill({ json: envelope({ status: 'signed_in', customer: state.me }) })
          }
          state.pendingPhone = body.phone ?? null
          return route.fulfill({ json: envelope({ status: 'needs_profile', phone: body.phone }) })
        }
        case 'POST /store/account/otp/register':
          state.registers.push(body)
          if (!state.pendingPhone) return route.fulfill(failure(422, 'OTP_SESSION_EXPIRED', 'Please start again.'))
          state.me = { id: 'c-2', name: body.name ?? '', email: body.email ?? null, phone: state.pendingPhone, email_verified: false, phone_verified: true, has_password: false }
          return route.fulfill({ status: 201, json: envelope(state.me) })
      }
      return route.fulfill(failure(404, 'NOT_FOUND', `No mock for ${key}`))
    },
  )
  return state
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: 'XSRF-TOKEN', value: 'e2e-token', url: baseURL ?? 'http://localhost:5173' }])
})

test('a new shopper signs up with a mobile number and a code', async ({ page }) => {
  const state = await serveStore(page)
  await page.goto('/account/register')
  await page.getByRole('link', { name: 'Sign up with your mobile number' }).click()
  await expect(page).toHaveURL(/\/account\/login$/)
  await expect(page.getByRole('tab', { name: 'Mobile number' })).toHaveAttribute('aria-selected', 'true')

  await page.getByRole('textbox', { name: 'Mobile number' }).fill('01811-223344')
  await page.getByRole('button', { name: 'Send code' }).click()
  await expect(page.getByText('We sent a 6-digit code to 01811223344.')).toBeVisible()
  await expect(page.getByTestId('otp-countdown')).toContainText('You can ask for a new code in')
  await page.getByLabel('Code from the SMS').fill(CODE)
  await page.getByRole('button', { name: 'Sign in' }).click()

  const profile = page.getByRole('form', { name: 'Almost done' })
  await expect(profile).toContainText('Your mobile number 01811223344 is confirmed.')
  await profile.getByLabel('Full name').fill('Karim Uddin')
  await profile.getByRole('button', { name: 'Create account' }).click()

  await expect(page).toHaveURL(/\/account$/)
  await expect(page.getByText('Signed in as 01811223344')).toBeVisible()
  expect(state.sends).toEqual([{ phone: '01811223344', purpose: 'login' }])
  expect(state.registers).toEqual([{ name: 'Karim Uddin' }])

  // The profile: the number is verified, an e-mail can be added, the first password needs no current one.
  await page.goto('/account/profile')
  await expect(page.getByRole('region', { name: 'Verify your mobile number' }).getByTestId('phone-verified')).toBeVisible()
  await expect(page.getByLabel('E-mail (optional)')).toBeEditable()
  const password = page.getByRole('form', { name: 'Set a password' })
  await expect(password).toBeVisible()
  await expect(password.getByLabel('Current password')).toHaveCount(0)
})

test('a known number signs straight in and goes on to the page it came from', async ({ page }) => {
  const state = await serveStore(page)
  await page.goto('/account/login?next=%2Fwishlist')
  await page.getByRole('textbox', { name: 'Mobile number' }).fill(KNOWN_PHONE)
  await page.getByLabel('Keep me signed in').check()
  await page.getByRole('button', { name: 'Send code' }).click()

  const code = page.getByLabel('Code from the SMS')
  await expect(code).toBeFocused()
  await code.fill('000000')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toHaveText('This code is not correct. Please check the SMS and try again.')
  await code.fill(CODE)
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page).toHaveURL(/\/wishlist$/)
  expect(state.logins.at(-1)).toEqual({ phone: KNOWN_PHONE, code: CODE, remember: true })
})

test('e-mail and password stay one tab away', async ({ page }) => {
  await serveStore(page)
  await page.goto('/account/login')
  await page.getByRole('tab', { name: 'E-mail & password' }).click()
  await expect(page.getByLabel('E-mail', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Track an order without signing in' })).toHaveAttribute('href', '/track-order')
})
