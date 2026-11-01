import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * Mocked customer account area (E9 contract): order history, order detail with tracking,
 * buy again, customer cancel (Idempotency-Key), reviews from delivered orders, own reviews and
 * the product page's rating summary and Reviews tab.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const failure = (status: number, code: string, message: string, details: Record<string, unknown> = {}) => ({
  status,
  json: { success: false, error: { code, message, details }, meta: { request_id: 'e2e' } },
})
const paging = (current: number, last: number, total: number) => ({ pagination: { current_page: current, per_page: 10, total, last_page: last } })

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

const customer = { id: 'c-1', name: 'Rina Akter', email: 'rina@example.com', phone: null, email_verified: true }

const juice = {
  id: 'p-juice', slug: 'mango-juice', name: 'Pran Mango Juice', url: '/product/mango-juice', short_description: 'Made from ripe mangoes.',
  description_html: '<p>Refreshing.</p>', specifications: [], brand: null, category: null,
  breadcrumbs: [{ name: 'Home', url: '/' }, { name: 'Pran Mango Juice', url: null }],
  images: [{ id: 'img-1', url: '/favicon.svg', alt: 'Mango juice' }], options: [],
  variants: [{ id: 'v-juice', sku: 'JUICE-1L', name: '1 L', option_values: {}, price: '120.00', compare_at_price: null, on_sale: false, discount_percent: null, in_stock: true, low_stock: false, image_id: null, promo_price: null }],
  price: '120.00', price_max: '120.00', on_sale: false, in_stock: true, is_new: false, default_variant_id: 'v-juice', unit: 'pcs', promotion: null,
  seo: { title: null, description: null, image_url: null }, rating: { average: '4.5', count: 2 },
}

const line = (extra: Record<string, unknown> = {}) => ({
  product_id: 'p-juice', product_name: 'Pran Mango Juice', variant_name: '1 L', sku: 'JUICE-1L', image_url: null, quantity: '2.000', unit_price: '120.00',
  line_total: '240.00', product_url: '/product/mango-juice', discount_amount: '0.00', review: null, reviewable: false, ...extra,
})

function order(number: string, status: string, label: string, extra: Record<string, unknown> = {}) {
  return {
    number, status, status_label: label, payment_status: 'unpaid', payment_method: 'cod', payment_method_label: 'Cash on delivery', payment_instructions: null,
    placed_at: '2026-10-20T10:00:00+06:00', expires_at: null, contact: { name: 'Rina Akter', email: 'rina@example.com', phone: '01712345678' },
    shipping_address: { recipient_name: 'Rina Akter', phone: '01712345678', division: 'Dhaka', district: 'Dhaka', area: 'Dhanmondi', address_line: 'House 12', postcode: '1205' },
    shipping_method_name: 'Home delivery', eta_min_days: 1, eta_max_days: 2, lines: [line()], subtotal: '240.00', discount_total: '0.00', shipping_discount: '0.00',
    promotions: [], coupon_code: null, tax_total: '0.00', shipping_total: '60.00', cod_fee: '0.00', total: '300.00', currency: 'BDT', prices_include_tax: true,
    courier_name: null, tracking_number: null, history: [{ status: 'confirmed', label: 'Confirmed', at: '2026-10-20T10:00:00+06:00' }], can_cancel: false, ...extra,
  }
}

const rowOf = (o: ReturnType<typeof order>) => ({
  number: o.number, placed_at: o.placed_at, status: o.status, status_label: o.status_label, payment_status: o.payment_status,
  payment_method_label: o.payment_method_label, item_count: 2, total: o.total, currency: 'BDT', first_item: { name: 'Pran Mango Juice', image_url: null },
})

function cartBody(quantity: number) {
  return {
    id: quantity > 0 ? 'cart-1' : null,
    items: quantity > 0
      ? [{ id: 'l-1', variant_id: 'v-juice', product: { slug: 'mango-juice', name: 'Pran Mango Juice', url: '/product/mango-juice', image: null }, variant_name: '1 L', option_values: {}, sku: 'JUICE-1L',
          quantity: String(quantity), unit_price: '120.00', compare_at_price: null, line_total: (120 * quantity).toFixed(2), purchasable: true, in_stock: true, max_quantity: null,
          exceeds_stock: false, allow_decimal: false, discount_amount: '0.00', promotion: null }]
      : [],
    item_count: String(quantity), subtotal: (120 * quantity).toFixed(2), discount_total: '0.00', tax_total: '0.00', total: (120 * quantity).toFixed(2),
    prices_include_tax: true, currency: 'BDT', issues: [], promotions: [], free_shipping: null, coupon: null,
  }
}

async function serveAccount(page: Page) {
  const state = {
    delivered: order('WEB-000002', 'delivered', 'Delivered', {
      payment_status: 'paid', courier_name: 'Pathao', tracking_number: 'PT-12345',
      history: [
        { status: 'confirmed', label: 'Confirmed', at: '2026-10-20T10:00:00+06:00' },
        { status: 'shipped', label: 'Shipped', at: '2026-10-21T10:00:00+06:00' },
        { status: 'delivered', label: 'Delivered', at: '2026-10-22T10:00:00+06:00' },
      ],
      lines: [line({ reviewable: true })],
    }),
    open: order('WEB-000003', 'confirmed', 'Confirmed', { placed_at: '2026-10-30T10:00:00+06:00', can_cancel: true }),
    cartQuantity: 0,
    reviews: [] as Record<string, unknown>[],
    cancelKeys: [] as (string | undefined)[],
    cancelBodies: [] as unknown[],
    reviewQueries: [] as string[],
  }

  await page.route(
    (url) => url.pathname.startsWith('/api/v1/store/'),
    async (route: Route) => {
      const request = route.request()
      const url = new URL(request.url())
      const path = url.pathname.replace('/api/v1', '')
      const key = `${request.method()} ${path}`
      const body = request.postDataJSON() as Record<string, unknown> | null

      switch (key) {
        case 'GET /store/bootstrap':
          return route.fulfill({ json: envelope(bootstrap) })
        case 'GET /store/account/me':
          return route.fulfill({ json: envelope(customer) })
        case 'GET /store/cart':
          return route.fulfill({ json: envelope(cartBody(state.cartQuantity)) })
        case 'GET /store/wishlist':
          return route.fulfill({ json: envelope({ items: [] }) })
        case 'GET /store/account/orders': {
          const status = url.searchParams.get('status')
          const all = [state.open, state.delivered]
          const rows = all.filter((o) => !status || (status === 'open' ? ['confirmed', 'pending_payment', 'processing', 'shipped'].includes(o.status) : o.status === status))
          return route.fulfill({ json: envelope(rows.map(rowOf), paging(1, 1, rows.length)) })
        }
        case 'GET /store/account/orders/WEB-000002':
          return route.fulfill({ json: envelope(state.delivered) })
        case 'GET /store/account/orders/WEB-000003':
          return route.fulfill({ json: envelope(state.open) })
        case 'POST /store/account/orders/WEB-000002/reorder':
          state.cartQuantity += 2
          return route.fulfill({ json: envelope({ cart: cartBody(state.cartQuantity), added: [{ variant_id: 'v-juice', name: 'Pran Mango Juice', quantity: '2' }], skipped: [{ name: 'Gift Wrap', reason: 'unavailable' }] }) })
        case 'POST /store/account/orders/WEB-000003/cancel':
          state.cancelKeys.push(request.headers()['idempotency-key'])
          state.cancelBodies.push(body)
          state.open = { ...state.open, status: 'cancelled', status_label: 'Cancelled', can_cancel: false, history: [...state.open.history, { status: 'cancelled', label: 'Cancelled', at: '2026-10-31T10:00:00+06:00' }] }
          return route.fulfill({ json: envelope(state.open) })
        case 'GET /store/account/reviews':
          return route.fulfill({ json: envelope(state.reviews) })
        case 'POST /store/account/reviews': {
          if (state.reviews.length > 0) return route.fulfill(failure(422, 'REVIEW_EXISTS', 'Already reviewed'))
          const review = { id: 'r-1', product: { id: 'p-juice', name: 'Pran Mango Juice', slug: 'mango-juice', image_url: null }, rating: body?.rating, title: body?.title, body: body?.body, status: 'pending', rejection_reason: null, created_at: '2026-10-31T10:00:00+06:00' }
          state.reviews.push(review)
          state.delivered = { ...state.delivered, lines: [line({ reviewable: false, review: { id: 'r-1', rating: body?.rating, status: 'pending' } })] }
          return route.fulfill({ status: 201, json: envelope(review) })
        }
        case 'GET /store/products/mango-juice':
          return route.fulfill({ json: envelope(juice) })
        case 'GET /store/products/mango-juice/related':
          return route.fulfill({ json: envelope({ related: [], frequently_bought: [] }) })
        case 'GET /store/products/mango-juice/reviews': {
          state.reviewQueries.push(url.search)
          const rating = url.searchParams.get('rating')
          const reviews = [
            { id: 'pr-1', rating: 5, title: 'Tastes real', body: 'Like fresh mangoes from the market.', author: 'Karim H.', created_at: '2026-10-25T10:00:00+06:00', verified: true },
            { id: 'pr-2', rating: 4, title: null, body: 'Good but a little sweet for me.', author: 'Sadia R.', created_at: '2026-10-24T10:00:00+06:00', verified: true },
          ].filter((r) => !rating || String(r.rating) === rating)
          return route.fulfill({ json: envelope(reviews, { ...paging(1, 1, reviews.length), summary: { average: '4.5', count: 2, distribution: { '5': 1, '4': 1, '3': 0, '2': 0, '1': 0 } } }) })
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

test('a customer tracks a delivered order, buys again and reviews it', async ({ page }) => {
  const state = await serveAccount(page)
  await page.goto('/account')

  // The overview lists the recent orders.
  await expect(page.getByTestId('recent-orders').getByTestId('order-row')).toHaveCount(2)
  await page.getByRole('navigation', { name: 'Account' }).getByRole('link', { name: 'Orders' }).click()
  await expect(page).toHaveTitle('My orders | Berry Kids')
  await page.getByRole('navigation', { name: 'Order status' }).getByRole('link', { name: 'Delivered' }).click()
  await expect(page).toHaveURL(/\/account\/orders\?status=delivered$/)
  await expect(page.getByTestId('order-row')).toHaveCount(1)
  await page.getByTestId('order-row').click()

  await expect(page.getByRole('heading', { level: 1, name: 'Order WEB-000002' })).toBeVisible()
  await expect(page.getByTestId('order-tracking')).toHaveText('Shipped with Pathao — tracking number PT-12345')
  await expect(page.getByTestId('order-history').getByRole('listitem')).toHaveCount(3)
  await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0)

  // Buy again: the mini-cart opens and the notice names what was left out.
  await page.getByRole('button', { name: 'Buy again' }).click()
  const drawer = page.getByRole('dialog', { name: 'Your cart (2)' })
  await expect(drawer).toBeVisible()
  await expect(page.getByText('1 item was added to your cart. Not added: Gift Wrap (no longer available).')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()

  // Review the delivered line with the keyboard-operable star radio group.
  await page.getByRole('button', { name: 'Write a review of Pran Mango Juice' }).click()
  const dialog = page.getByRole('dialog', { name: 'Write a review' })
  const stars = dialog.getByRole('radiogroup', { name: 'Your rating' })
  await stars.locator('label', { hasText: '4 stars' }).click()
  await expect(stars.getByLabel('4 stars')).toBeChecked()
  await page.keyboard.press('ArrowRight')
  await expect(stars.getByLabel('5 stars')).toBeChecked()
  await dialog.getByLabel('Title (optional)').fill('Tastes real')
  await dialog.getByLabel('Your review').fill('Like fresh mangoes from the market.')
  await dialog.getByRole('button', { name: 'Submit review' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('line-review')).toContainText('Pending')

  // The review waits for moderation under My reviews.
  await page.getByRole('navigation', { name: 'Account' }).getByRole('link', { name: 'Reviews' }).click()
  const review = page.getByTestId('my-review')
  await expect(review).toHaveCount(1)
  await expect(review.getByTestId('review-status')).toHaveText('Pending')
  await expect(review.getByRole('img', { name: 'Rated 5 out of 5' })).toBeVisible()
  expect(state.reviews[0]).toMatchObject({ rating: 5, title: 'Tastes real', body: 'Like fresh mangoes from the market.' })
})

test('a customer cancels an unpaid order with a reason', async ({ page }) => {
  const state = await serveAccount(page)
  await page.goto('/account/orders?status=open')
  await page.getByTestId('order-row').first().click()
  await expect(page.getByRole('heading', { level: 1, name: 'Order WEB-000003' })).toBeVisible()

  await page.getByRole('button', { name: 'Cancel order' }).click()
  const dialog = page.getByRole('dialog', { name: 'Cancel order WEB-000003?' })
  await dialog.getByLabel('Reason (optional)').fill('Ordered twice')
  await dialog.getByRole('button', { name: 'Cancel order' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Order WEB-000003 was cancelled.')).toBeVisible()
  await expect(page.getByTestId('order-status')).toHaveText('Cancelled')
  await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0)
  expect(state.cancelBodies).toEqual([{ reason: 'Ordered twice' }])
  expect(state.cancelKeys[0]).toMatch(/^[0-9a-f-]{36}$/)
})

test('the product page shows the rating and the approved reviews', async ({ page }) => {
  const state = await serveAccount(page)
  await page.goto('/product/mango-juice')

  const summary = page.getByTestId('rating-summary')
  await expect(summary).toHaveText(/4\.5 \(2 reviews\)/)
  await summary.click()
  await expect(page.getByRole('tab', { name: 'Reviews (2)' })).toHaveAttribute('aria-selected', 'true')
  const reviews = page.getByTestId('product-reviews')
  await expect(reviews.getByTestId('review')).toHaveCount(2)
  await expect(reviews.getByText('Karim H.')).toBeVisible()
  await expect(reviews.getByTestId('review-hint').getByRole('link')).toHaveAttribute('href', '/account/orders')

  await reviews.getByRole('button', { name: /^4 stars: 1 review/ }).click()
  await expect(reviews.getByTestId('review')).toHaveCount(1)
  await expect(reviews.getByText('Sadia R.')).toBeVisible()
  expect(state.reviewQueries).toContain('?sort=newest&rating=4')
})
