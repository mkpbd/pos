import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * BD1a §8, mocked public/customer API: a store that makes the e-mail optional and confirms the
 * mobile number of cash on delivery orders with an SMS code. A guest orders without an e-mail,
 * confirms the number inline and places the order; an expired confirmation brings the check back.
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
  checkout: { email: 'optional', phone_verification: 'cod' },
  account: { phone_login: true },
}

const line = {
  id: 'l-1', variant_id: 'v-red-m', product: { slug: 'kids-tee', name: 'Kids Tee', url: '/product/kids-tee', image: null },
  variant_name: 'Red / M', option_values: { Colour: 'Red', Size: 'M' }, sku: 'TEE-RM', quantity: '2', unit_price: '450.00', compare_at_price: null,
  line_total: '900.00', purchasable: true, in_stock: true, max_quantity: null, exceeds_stock: false, allow_decimal: false, discount_amount: '0.00', promotion: null,
}
const cart = (empty: boolean) => ({
  id: empty ? null : 'cart-1', items: empty ? [] : [line], item_count: empty ? '0' : '2', subtotal: empty ? '0.00' : '900.00', discount_total: '0.00', tax_total: '0.00',
  total: empty ? '0.00' : '900.00', prices_include_tax: true, currency: 'BDT', issues: [], promotions: [], free_shipping: null, coupon: null,
})
const home = { id: 'sm-home', name: 'Home delivery', description: 'Inside Dhaka', fee: '60.00', free_over: null, cod_allowed: true, cod_fee: '0.00', eta_min_days: 1, eta_max_days: 2 }

type Body = { address?: { district_id?: number }; payment_method?: string; contact?: Record<string, string>; phone?: string; code?: string }
type State = { placed: boolean; verified: Set<string>; sends: Body[]; places: Body[]; expireOnPlace: boolean; lastPreview: Body | null }

async function serveStore(page: Page, options: { expireOnPlace?: boolean } = {}) {
  const state: State = { placed: false, verified: new Set(), sends: [], places: [], expireOnPlace: options.expireOnPlace ?? false, lastPreview: null }
  const preview = (body: Body) => {
    const served = body.address?.district_id !== undefined
    return {
      lines: [line], subtotal: '900.00', discount_total: '0.00', shipping_discount: '0.00', promotions: [], coupon_code: null, tax_total: '0.00',
      shipping_total: served ? '60.00' : '0.00', cod_fee: '0.00', total: served ? '960.00' : '900.00', currency: 'BDT', prices_include_tax: true,
      shipping_methods: served ? [home] : [], shipping_method_id: served ? 'sm-home' : null, payment_method: body.payment_method ?? null, issues: [],
    }
  }
  const order = (body: Body) => ({
    number: 'WEB-000101', status: 'confirmed', status_label: 'Confirmed', payment_status: 'unpaid', payment_method: 'cod', payment_method_label: 'Cash on delivery',
    payment_instructions: null, placed_at: '2026-11-24T10:00:00+06:00', expires_at: null, contact: { email: null, ...body.contact },
    shipping_address: { recipient_name: 'Karim Uddin', phone: '01811223344', division: 'Dhaka', district: 'Dhaka', area: 'Mirpur', address_line: 'Road 3, House 9', postcode: null },
    shipping_method_name: 'Home delivery', eta_min_days: 1, eta_max_days: 2,
    lines: [{ product_name: 'Kids Tee', variant_name: 'Red / M', sku: 'TEE-RM', image_url: null, quantity: '2.000', unit_price: '450.00', line_total: '900.00', product_url: '/product/kids-tee', discount_amount: '0.00' }],
    subtotal: '900.00', discount_total: '0.00', shipping_discount: '0.00', promotions: [], coupon_code: null, tax_total: '0.00', shipping_total: '60.00', cod_fee: '0.00',
    total: '960.00', currency: 'BDT', prices_include_tax: true, courier_name: null, tracking_number: null,
    history: [{ status: 'confirmed', label: 'Confirmed', at: '2026-11-24T10:00:00+06:00' }],
  })

  await page.route(
    (url) => url.pathname.startsWith('/api/v1/store/'),
    async (route: Route) => {
      const request = route.request()
      const url = new URL(request.url())
      const path = url.pathname.replace('/api/v1', '')
      const key = `${request.method()} ${path}`
      const body = (request.postDataJSON() ?? {}) as Body
      if (key.startsWith('GET /store/orders/')) return route.fulfill({ json: envelope(order(state.places.at(-1) ?? {})) })
      switch (key) {
        case 'GET /store/bootstrap':
          return route.fulfill({ json: envelope(bootstrap) })
        case 'GET /store/account/me':
          return route.fulfill({ json: envelope(null) })
        case 'GET /store/cart':
          return route.fulfill({ json: envelope(cart(state.placed)) })
        case 'GET /store/wishlist':
          return route.fulfill({ json: envelope({ items: [] }) })
        case 'GET /store/checkout/options':
          return route.fulfill({
            json: envelope({
              available: !state.placed, reason: state.placed ? 'cart_empty' : null, guest_checkout: true, signed_in: false,
              payment_methods: [{ code: 'cod', display_name: 'Cash on delivery' }, { code: 'bank_transfer', display_name: 'Bank transfer' }],
              email_field: 'optional', phone_verification: 'cod', phone_login: true,
            }),
          })
        case 'GET /store/geo/divisions':
          return route.fulfill({ json: envelope([{ id: 3, name: 'Dhaka', name_bn: null }]) })
        case 'GET /store/geo/districts':
          return route.fulfill({ json: envelope([{ id: 47, division_id: 3, name: 'Dhaka', name_bn: null }]) })
        case 'POST /store/checkout/preview':
          state.lastPreview = body
          return route.fulfill({ json: envelope(preview(body)) })
        case 'POST /store/checkout/phone/send':
          state.sends.push(body)
          return route.fulfill({ status: 202, json: envelope({ resend_after: 60, expires_in: 300 }) })
        case 'POST /store/checkout/phone/verify':
          if (body.code !== '123456') return route.fulfill(failure(422, 'OTP_INVALID', 'Wrong code.'))
          state.verified.add(body.phone ?? '')
          return route.fulfill({ json: envelope({ phone: body.phone, verified: true }) })
        case 'POST /store/checkout': {
          state.places.push(body)
          const phone = body.contact?.phone ?? ''
          if (state.expireOnPlace) {
            state.expireOnPlace = false
            state.verified.delete(phone)
          }
          if (body.payment_method === 'cod' && !state.verified.has(phone)) return route.fulfill(failure(422, 'PHONE_NOT_VERIFIED', 'Confirm the number.', { phone }))
          state.placed = true
          return route.fulfill({ status: 201, json: envelope({ order: order(body), access_token: 'guest-token' }) })
        }
      }
      return route.fulfill(failure(404, 'NOT_FOUND', `No mock for ${key}`))
    },
  )
  return state
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: 'XSRF-TOKEN', value: 'e2e-token', url: baseURL ?? 'http://localhost:5173' }])
})

async function fillGuest(page: Page) {
  await page.getByLabel('Full name').fill('Karim Uddin')
  await expect(page.getByLabel('E-mail (optional)')).toBeVisible()
  await page.getByRole('textbox', { name: 'Mobile number', exact: true }).fill('01811-223344')
  await page.getByLabel('Division').selectOption('3')
  await page.getByLabel('District').selectOption('47')
  await page.getByLabel('Area / thana').fill('Mirpur')
  await page.getByLabel('Street address').fill('Road 3, House 9')
  await expect(page.getByRole('radio', { name: /Home delivery/ })).toBeChecked()
  await page.getByRole('radio', { name: /Cash on delivery/ }).check()
}

async function confirmNumber(page: Page) {
  const check = page.getByTestId('checkout-phone-check')
  await check.getByRole('button', { name: 'Send code' }).click()
  await check.getByLabel('Code from the SMS').fill('123456')
  await check.getByRole('button', { name: 'Verify' }).click()
  await expect(check.getByTestId('phone-verified')).toHaveText('Mobile number verified ✓')
}

test('a guest confirms the mobile number with a code and orders without an e-mail', async ({ page }) => {
  const state = await serveStore(page)
  await page.goto('/checkout')
  await fillGuest(page)

  const place = page.getByRole('button', { name: 'Place order' })
  await expect(place).toBeDisabled()
  await expect(page.getByText('Confirm your mobile number with the SMS code to place the order.')).toBeVisible()
  await confirmNumber(page)
  expect(state.sends).toEqual([{ phone: '01811223344' }])

  await expect(place).toBeEnabled()
  await place.click()
  await expect(page).toHaveURL(/\/order\/WEB-000101$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Thank you, Karim!' })).toBeVisible()
  expect(state.places).toHaveLength(1)
  expect(state.places[0]!.contact).toEqual({ name: 'Karim Uddin', phone: '01811223344' })
})

test('bank transfer needs no code, and an expired confirmation brings the check back', async ({ page }) => {
  const state = await serveStore(page, { expireOnPlace: true })
  await page.goto('/checkout')
  await fillGuest(page)
  await page.getByRole('radio', { name: /Bank transfer/ }).check()
  await expect(page.getByTestId('checkout-phone-check')).toHaveCount(0)
  await page.getByRole('radio', { name: /Cash on delivery/ }).check()
  await confirmNumber(page)

  await page.getByRole('button', { name: 'Place order' }).click()
  const phone = page.getByRole('textbox', { name: 'Mobile number', exact: true })
  await expect(phone).toBeFocused()
  await expect(page.getByTestId('checkout-problem')).toHaveAttribute('data-code', 'PHONE_NOT_VERIFIED')
  await expect(page.getByTestId('checkout-phone-check').getByRole('button', { name: 'Send code' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Place order' })).toBeDisabled()

  await confirmNumber(page)
  await page.getByRole('button', { name: 'Place order' }).click()
  await expect(page).toHaveURL(/\/order\/WEB-000101$/)
  expect(state.places).toHaveLength(2)
})
