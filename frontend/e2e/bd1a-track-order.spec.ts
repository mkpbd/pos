import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * BD1a §8, mocked public API: a guest tracks an order with its number and mobile number — from
 * the sign-in page link, and from the order SMS link (`/track-order?number=`).
 */

const envelope = (data: unknown) => ({ success: true, data, meta: { request_id: 'e2e' } })
const failure = (status: number, code: string, message: string) => ({
  status,
  json: { success: false, error: { code, message, details: {} }, meta: { request_id: 'e2e' } },
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
}

const ORDER = {
  number: 'WEB-000123',
  status: 'shipped',
  payment_method: 'cod',
  payment_status: 'unpaid',
  placed_at: '2026-11-20T10:00:00+06:00',
  total: '1250.00',
  item_count: 3,
  history: [
    { status: 'confirmed', at: '2026-11-20T10:00:00+06:00' },
    { status: 'processing', at: '2026-11-21T09:00:00+06:00' },
    { status: 'shipped', at: '2026-11-22T15:30:00+06:00' },
  ],
  shipment: { courier_name: 'Pathao', tracking_number: 'PT-998877', tracking_url: 'https://courier.example/track/PT-998877', status: 'in_transit' },
}

async function serveStore(page: Page) {
  const lookups: { number: string | null; phone: string | null }[] = []
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/store/'),
    async (route: Route) => {
      const request = route.request()
      const url = new URL(request.url())
      const key = `${request.method()} ${url.pathname.replace('/api/v1', '')}`
      switch (key) {
        case 'GET /store/bootstrap':
          return route.fulfill({ json: envelope(bootstrap) })
        case 'GET /store/account/me':
          return route.fulfill({ json: envelope(null) })
        case 'GET /store/cart':
          return route.fulfill({ json: envelope({ id: null, items: [], item_count: '0', subtotal: '0.00', discount_total: '0.00', tax_total: '0.00', total: '0.00', prices_include_tax: true, currency: 'BDT', issues: [], promotions: [], free_shipping: null, coupon: null }) })
        case 'GET /store/wishlist':
          return route.fulfill({ json: envelope({ items: [] }) })
        case 'GET /store/orders/track': {
          const number = url.searchParams.get('number')
          const phone = url.searchParams.get('phone')
          lookups.push({ number, phone })
          // Same answer for an unknown number and a wrong phone.
          if (number?.toUpperCase() !== ORDER.number || phone !== '01711223344') return route.fulfill(failure(404, 'ORDER_NOT_FOUND', 'Order not found.'))
          return route.fulfill({ json: envelope(ORDER) })
        }
      }
      return route.fulfill(failure(404, 'NOT_FOUND', `No mock for ${key}`))
    },
  )
  return lookups
}

test('a guest finds an order from the sign-in page', async ({ page }) => {
  const lookups = await serveStore(page)
  await page.goto('/account/login')
  await page.getByRole('link', { name: 'Track an order without signing in' }).click()
  await expect(page).toHaveURL(/\/track-order$/)
  await expect(page).toHaveTitle('Track your order | Berry Kids')

  await page.getByLabel('Order number').fill('web-000123')
  await page.getByLabel('Mobile number').fill('01811223344')
  await page.getByRole('button', { name: 'Track order' }).click()
  await expect(page.getByRole('alert')).toHaveText('We could not find an order with this number and mobile number. Please check both and try again.')

  await page.getByLabel('Mobile number').fill('+880 1711-223344')
  await page.getByRole('button', { name: 'Track order' }).click()
  const card = page.getByTestId('tracked-order')
  await expect(card.getByRole('heading', { name: 'Order WEB-000123' })).toBeVisible()
  await expect(card.getByTestId('order-status')).toHaveText('Shipped')
  await expect(card.getByTestId('tracked-total')).toHaveText('৳1,250.00')
  await expect(page.getByTestId('order-history').getByRole('listitem')).toHaveCount(3)
  await expect(page.getByTestId('track-parcel')).toHaveAttribute('href', 'https://courier.example/track/PT-998877')
  await expect(page.getByTestId('track-parcel')).toHaveAttribute('target', '_blank')
  expect(lookups).toEqual([
    { number: 'web-000123', phone: '01811223344' },
    { number: 'web-000123', phone: '01711223344' },
  ])
  // Nothing is wider than the screen.
  const overflow = await page.locator('html').evaluate((html) => html.scrollWidth - html.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('the order SMS link prefills the order number', async ({ page }) => {
  await serveStore(page)
  await page.goto('/track-order?number=WEB-000123')
  await expect(page.getByLabel('Order number')).toHaveValue('WEB-000123')
  await page.getByLabel('Mobile number').fill('01711223344')
  await page.getByLabel('Mobile number').press('Enter')
  await expect(page.getByTestId('tracked-order')).toContainText('Cash on delivery · Pay on delivery')
})
