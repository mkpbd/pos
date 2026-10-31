import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { SummaryTotals } from './checkout/summary-totals'
import { storefrontRoutes } from './routes'
import { bootstrapFixture, cartFixture, cartLine, listingBody, orderFixture, previewFixture, productCard, productDetail, promotionFixture } from './test-fixtures'
import type { Cart, StoreSection } from './types'

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

type Routes = Parameters<typeof mockApi>[0]

const bodyOf = (init: RequestInit) => JSON.parse(String(init.body ?? 'null')) as Record<string, unknown>

function serve(routes: Routes = {}) {
  return mockApi({
    'GET /store/bootstrap': ok(bootstrapFixture()),
    'GET /store/homepage': ok({ sections: [], preview: false }),
    'GET /store/account/me': ok(null),
    'GET /store/cart': ok(cartFixture()),
    'GET /store/wishlist': ok({ items: [] }),
    ...routes,
  })
}

describe('promotions on cards and product pages', () => {
  it('shows the promotion badge, the promotional price with the base price struck through and the countdown chip', async () => {
    serve({
      'GET /store/products': {
        body: listingBody(
          [
            productCard('mango-juice', { promotion: promotionFixture() }),
            productCard('lychee-juice', { price: '120.00', price_max: '150.00', promotion: promotionFixture({ id: 'pr-2', name: 'Fixed deal', type: 'fixed', value: '20.00', price: '100.00', show_countdown: false, ends_at: null }) }),
            productCard('apple-juice', { on_sale: true, compare_at_price: '140.00', discount_percent: 14 }),
          ],
          { facets: null },
        ),
      },
    })
    renderRoutes(storefrontRoutes, '/shop')

    const cards = await screen.findAllByTestId('product-card')
    const [mango, lychee, apple] = cards
    expect(within(mango!).getByTestId('promotion-badge')).toHaveTextContent('Offer: −10 %')
    expect(within(mango!).getByTestId('price')).toHaveTextContent('Sale price: ৳108.00')
    expect(within(mango!).getByTestId('compare-price')).toHaveTextContent('৳120.00')
    expect(within(mango!).getByTestId('compare-price').tagName).toBe('S')
    expect(within(mango!).getByTestId('countdown-time')).toHaveTextContent(/^2d 01:00:0\d$/)
    expect(within(mango!).getByText(/^Ends/, { selector: '.sr-only' })).toBeInTheDocument()
    expect(within(mango!).queryByText(/^Sale/, { selector: 'li' })).not.toBeInTheDocument()

    // Variants that differ: "From" the promotional price; no countdown without show_countdown.
    expect(within(lychee!).getByTestId('promotion-badge')).toHaveTextContent('−৳20')
    expect(within(lychee!).getByTestId('price')).toHaveTextContent('From ৳100.00')
    expect(within(lychee!).queryByTestId('countdown')).not.toBeInTheDocument()

    expect(within(apple!).queryByTestId('promotion-badge')).not.toBeInTheDocument()
    expect(within(apple!).getByText('Sale −14 %')).toBeInTheDocument()
  })

  it('drops the promotional price on a card once the promotion ends', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    serve({ 'GET /store/products': { body: listingBody([productCard('mango-juice', { promotion: promotionFixture({ ends_at: new Date(Date.now() + 3_000).toISOString() }) })], { facets: null }) } })
    renderRoutes(storefrontRoutes, '/shop')

    const card = await screen.findByTestId('product-card')
    expect(within(card).getByTestId('price')).toHaveTextContent('৳108.00')
    act(() => vi.advanceTimersByTime(3_500))
    await waitFor(() => expect(within(card).getByTestId('price')).toHaveTextContent('৳120.00'))
    expect(within(card).queryByTestId('promotion-badge')).not.toBeInTheDocument()
    expect(within(card).queryByTestId('countdown')).not.toBeInTheDocument()
  })

  it('shows the promotional price of the selected variant with the promotion name and countdown', async () => {
    const promotion = promotionFixture({ price: '405.00' })
    const product = productDetail({ promotion })
    product.variants = product.variants.map((v) => (v.id === 'v-red-m' ? { ...v, promo_price: '405.00' } : v.id === 'v-blue-l' ? { ...v, promo_price: null } : v))
    serve({
      'GET /store/products/kids-tee': ok(product),
      'GET /store/products/kids-tee/related': ok({ related: [], frequently_bought: [] }),
      'GET /store/products': { body: listingBody([], { facets: null }) },
    })
    renderRoutes(storefrontRoutes, '/product/kids-tee')
    const user = userEvent.setup()

    const page = await screen.findByTestId('product-page')
    const summary = within(page)
    await waitFor(() => expect(summary.getAllByTestId('price')[0]).toHaveTextContent('৳405.00'))
    expect(summary.getAllByTestId('compare-price')[0]).toHaveTextContent('৳450.00')
    expect(summary.getAllByTestId('promotion-badge').map((b) => b.textContent)).toEqual(['Offer: −10 %', 'Offer: −10 %'])
    const block = summary.getByTestId('product-promotion')
    expect(block).toHaveTextContent('Juice week')
    expect(within(block).getByTestId('countdown-time')).toHaveTextContent(/^Ends in 2d 01:00:0\d$/)

    // Blue / L is not part of the promotion: its own price, no promotion.
    await user.click(summary.getByRole('radio', { name: 'Blue' }))
    await waitFor(() => expect(summary.getAllByTestId('price')[0]).toHaveTextContent('৳480.00'))
    expect(summary.queryByTestId('product-promotion')).not.toBeInTheDocument()
    expect(summary.queryByTestId('promotion-badge')).not.toBeInTheDocument()
  })
})

const discountedCart = (overrides: Partial<Cart> = {}): Cart =>
  cartFixture([cartLine('l-1', { discount_amount: '90.00', promotion: { id: 'pr-1', name: 'Juice week' } })], {
    subtotal: '900.00',
    discount_total: '140.00',
    total: '760.00',
    promotions: [
      { id: 'pr-1', name: 'Juice week', kind: 'product', amount: '90.00' },
      { id: 'pr-2', name: 'Welcome 50', kind: 'order', amount: '50.00' },
    ],
    free_shipping: { id: 'pr-3', name: 'Free delivery over ৳3,000' },
    coupon: { code: 'WELCOME50', applied: true, reason: null, message: null, promotion_name: 'Welcome 50' },
    ...overrides,
  })

describe('cart discounts and coupons', () => {
  it('shows line discounts, the discounts with their promotions, the coupon and the free-delivery note', async () => {
    serve({ 'GET /store/cart': ok(discountedCart()) })
    renderRoutes(storefrontRoutes, '/cart')

    const page = await screen.findByTestId('cart-page')
    await waitFor(() => expect(within(page).getByTestId('line-discount')).toHaveTextContent(/^Discount \(Juice week\):\s*−৳90\.00$/))
    expect(within(page).getByTestId('cart-subtotal')).toHaveTextContent('৳900.00')
    expect(within(page).getByTestId('cart-discount')).toHaveTextContent('−৳140.00')
    expect(within(page).getAllByTestId('cart-promotion').map((p) => p.textContent)).toEqual(['Juice week−৳90.00', 'Welcome 50−৳50.00'])
    expect(within(page).getByTestId('cart-total')).toHaveTextContent('৳760.00')
    expect(within(page).getByTestId('free-shipping-note')).toHaveTextContent('Free delivery with Free delivery over ৳3,000 — applied at checkout.')
    const coupon = within(page).getByRole('group', { name: 'Coupon WELCOME50' })
    expect(within(coupon).getByTestId('coupon-applied')).toHaveTextContent('Coupon applied')
  })

  it('applies a coupon (normalised), updates the cart everywhere and moves the focus to it; removes it again', async () => {
    let cart = cartFixture([cartLine('l-1')], { item_count: '2' })
    const posts: unknown[] = []
    serve({
      'GET /store/cart': () => ok(cart),
      'POST /store/cart/coupon': (init) => {
        posts.push(bodyOf(init))
        cart = discountedCart()
        return ok(cart)
      },
      'DELETE /store/cart/coupon': () => {
        cart = cartFixture([cartLine('l-1')], { item_count: '2' })
        return ok(cart)
      },
    })
    renderRoutes(storefrontRoutes, '/cart')
    const user = userEvent.setup()

    const input = await screen.findByRole('textbox', { name: 'Coupon code' })
    await user.type(input, ' welcome50 ')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    const coupon = await screen.findByTestId('cart-coupon')
    expect(posts).toEqual([{ code: 'WELCOME50' }])
    expect(within(coupon).getByTestId('coupon-code')).toHaveTextContent('WELCOME50')
    expect(screen.getByTestId('cart-total')).toHaveTextContent('৳760.00')
    await waitFor(() => expect(coupon).toHaveFocus())
    expect(screen.getByText('Coupon WELCOME50 applied.')).toHaveAttribute('role', 'status')

    await user.click(within(coupon).getByRole('button', { name: 'Remove coupon WELCOME50' }))
    const again = await screen.findByRole('textbox', { name: 'Coupon code' })
    await waitFor(() => expect(again).toHaveFocus())
    expect(screen.getByText('Coupon WELCOME50 removed.')).toBeInTheDocument()
    expect(screen.getByTestId('cart-total')).toHaveTextContent('৳900.00')
  })

  it.each([
    ['not_found', {}, 'This coupon code is not valid.'],
    ['not_started', {}, 'This coupon cannot be used yet.'],
    ['expired', {}, 'This coupon has expired.'],
    ['usage_limit_reached', {}, 'This coupon has reached its usage limit.'],
    ['customer_limit_reached', {}, 'You have already used this coupon.'],
    ['min_subtotal', { min_subtotal: '500.00' }, 'Spend at least ৳500 to use this coupon.'],
    ['not_applicable', {}, 'This coupon does not apply to the items in your cart.'],
    ['something_new', {}, 'Server says no.'],
  ])('explains a refused coupon (%s) next to the field', async (reason, details, message) => {
    serve({
      'GET /store/cart': ok(cartFixture([cartLine('l-1')])),
      'POST /store/cart/coupon': fail(422, 'COUPON_INVALID', 'Server says no.', { reason, ...details }),
    })
    renderRoutes(storefrontRoutes, '/cart')
    const user = userEvent.setup()

    const input = await screen.findByRole('textbox', { name: 'Coupon code' })
    await user.type(input, 'SAVE10{Enter}')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(message)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription(message)
    expect(input).toHaveFocus()

    // Typing again clears the error.
    await user.type(input, 'X')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('handles rate limiting and checks the code before sending it', async () => {
    const fetchMock = serve({
      'GET /store/cart': ok(cartFixture([cartLine('l-1')])),
      'POST /store/cart/coupon': fail(429, 'TOO_MANY_REQUESTS', 'Too many requests.'),
    })
    renderRoutes(storefrontRoutes, '/cart')
    const user = userEvent.setup()

    const input = await screen.findByRole('textbox', { name: 'Coupon code' })
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a coupon code.')
    await user.type(input, 'no spaces!')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This coupon code is not valid.')
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/store/cart/coupon'))).toBe(false)

    await user.clear(input)
    await user.type(input, 'WELCOME50{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Please wait a minute and try again.')
  })

  it('says when the coupon is kept but a better offer applies, or when it stopped qualifying', async () => {
    let cart = cartFixture([cartLine('l-1')])
    serve({
      'GET /store/cart': () => ok(cart),
      'POST /store/cart/coupon': () => {
        cart = discountedCart({ coupon: { code: 'WELCOME50', applied: false, reason: null, message: 'A better offer is already applied.', promotion_name: 'Welcome 50' } })
        return ok(cart)
      },
    })
    renderRoutes(storefrontRoutes, '/cart')
    const user = userEvent.setup()

    await user.type(await screen.findByRole('textbox', { name: 'Coupon code' }), 'WELCOME50{Enter}')
    expect(await screen.findByTestId('coupon-note')).toHaveTextContent('A better offer is already applied.')
    expect(screen.getByText('Coupon WELCOME50 added. A better offer is already applied.')).toHaveAttribute('role', 'status')
    expect(screen.queryByTestId('coupon-applied')).not.toBeInTheDocument()
  })

  it('explains a coupon that became invalid by its reason when the server sends no message', async () => {
    serve({ 'GET /store/cart': ok(discountedCart({ coupon: { code: 'WELCOME50', applied: false, reason: 'min_subtotal', message: null, promotion_name: 'Welcome 50' } })) })
    renderRoutes(storefrontRoutes, '/cart')
    expect(await screen.findByTestId('coupon-note')).toHaveTextContent('Your cart does not reach the minimum amount for this coupon.')
  })

  it('offers the coupon field in the mini-cart behind a button and shows discounts there', async () => {
    let cart = cartFixture([cartLine('l-1')], { item_count: '2' })
    serve({
      'GET /store/cart': () => ok(cart),
      'POST /store/cart/coupon': () => {
        cart = discountedCart({ item_count: '2' })
        return ok(cart)
      },
    })
    renderRoutes(storefrontRoutes)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Cart, 2 items' }))
    const drawer = await screen.findByRole('dialog', { name: 'Your cart (2)' })
    await user.click(within(drawer).getByRole('button', { name: 'Have a coupon code?' }))
    const input = within(drawer).getByRole('textbox', { name: 'Coupon code' })
    await waitFor(() => expect(input).toHaveFocus())
    await user.type(input, 'WELCOME50{Enter}')

    expect(await within(drawer).findByTestId('cart-discount')).toHaveTextContent('−৳140.00')
    expect(within(drawer).getByTestId('coupon-code')).toHaveTextContent('WELCOME50')
    expect(within(drawer).getByTestId('line-discount')).toHaveTextContent('Juice week')
    expect(within(drawer).getAllByTestId('cart-promotion')).toHaveLength(2)
  })
})

describe('checkout and order discounts', () => {
  it('shows discounts with promotions, the coupon code and the waived delivery fee', () => {
    const preview = previewFixture({
      lines: [cartLine('l-1', { discount_amount: '90.00', promotion: { id: 'pr-1', name: 'Juice week' } })],
      discount_total: '140.00',
      shipping_discount: '60.00',
      shipping_total: '0.00',
      total: '760.00',
      coupon_code: 'WELCOME50',
      promotions: [
        { name: 'Juice week', kind: 'product', amount: '90.00' },
        { name: 'Welcome 50', kind: 'order', amount: '50.00' },
        { name: 'Free delivery over ৳3,000', kind: 'shipping', amount: '60.00' },
      ],
    })
    render(<SummaryTotals amounts={preview} currency="BDT" />)

    expect(screen.getByTestId('summary-discount')).toHaveTextContent('−৳140.00')
    expect(screen.getByRole('list', { name: 'Promotions applied' })).toHaveTextContent('Juice week−৳90.00Welcome 50−৳50.00')
    expect(screen.getByTestId('summary-coupon')).toHaveTextContent('WELCOME50')
    expect(screen.getByTestId('summary-shipping')).toHaveTextContent('Was ৳60.00Free')
    expect(screen.getByRole('list', { name: 'Delivery offers' })).toHaveTextContent('Free delivery over ৳3,000−৳60.00')
    expect(screen.getByTestId('summary-total')).toHaveTextContent('৳760.00')
  })

  it('leaves the discount rows out without discounts', () => {
    render(<SummaryTotals amounts={previewFixture({ shipping_total: '60.00' })} currency="BDT" />)
    expect(screen.queryByTestId('summary-discount')).not.toBeInTheDocument()
    expect(screen.queryByTestId('summary-coupon')).not.toBeInTheDocument()
    expect(screen.getByTestId('summary-shipping')).toHaveTextContent('৳60.00')
  })

  it('shows the discounts of a placed order', async () => {
    const order = orderFixture({
      lines: [{ ...orderFixture().lines[0]!, discount_amount: '140.00' }],
      discount_total: '140.00',
      coupon_code: 'WELCOME50',
      promotions: [
        { name: 'Juice week', kind: 'product', amount: '90.00' },
        { name: 'Welcome 50', kind: 'order', amount: '50.00' },
      ],
      total: '820.00',
    })
    serve({ 'GET /store/orders/WEB-000001': ok(order) })
    renderRoutes(storefrontRoutes, '/order/WEB-000001?token=t-1')

    const page = await screen.findByTestId('order-page')
    await waitFor(() => expect(within(page).getByTestId('order-line-discount')).toHaveTextContent('Discount: −৳140.00'))
    expect(within(page).getByTestId('summary-discount')).toHaveTextContent('−৳140.00')
    expect(within(page).getByTestId('summary-coupon')).toHaveTextContent('WELCOME50')
    expect(within(page).getAllByTestId('summary-promotion')).toHaveLength(2)
  })
})

const hotDeals = (overrides: Partial<Extract<StoreSection, { type: 'hot_deals' }>> = {}): StoreSection => {
  const endsAt = new Date(Date.now() + 5_000).toISOString()
  return {
    id: 'hd-1',
    type: 'hot_deals',
    title: 'Flash sale',
    subtitle: 'Only this week',
    config: { promotion_id: null, limit: 8, view_all_url: '/shop?on_sale=1' },
    ends_at: endsAt,
    products: [
      productCard('mango-juice', { promotion: promotionFixture({ ends_at: endsAt }) }),
      productCard('lychee-juice', { promotion: promotionFixture({ id: 'pr-2', ends_at: new Date(Date.now() + 86_400_000).toISOString() }) }),
    ],
    ...overrides,
  } as StoreSection
}

describe('hot deals section', () => {
  it('shows the heading, a big countdown and the deals; hides itself at zero and fetches the homepage again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let homepageReads = 0
    const section = hotDeals()
    serve({
      'GET /store/homepage': () => {
        homepageReads += 1
        return ok({ sections: homepageReads === 1 ? [section] : [], preview: false })
      },
    })
    renderRoutes(storefrontRoutes)

    const deals = await screen.findByTestId('hot-deals')
    expect(within(deals).getByRole('heading', { level: 2, name: 'Flash sale' })).toBeInTheDocument()
    expect(deals).toHaveAccessibleName('Flash sale')
    expect(within(deals).getByText('Only this week')).toBeInTheDocument()
    const big = within(deals).getAllByTestId('countdown')[0]!
    expect(within(big).getByTestId('countdown-time')).toHaveAttribute('data-remaining', expect.stringMatching(/^00:00:0[45]$/))
    const cards = within(deals).getAllByTestId('product-card')
    expect(cards).toHaveLength(2)
    // The card ending with the section does not repeat its countdown; the other does.
    expect(within(cards[0]!).queryByTestId('countdown')).not.toBeInTheDocument()
    expect(within(cards[1]!).getByTestId('countdown')).toBeInTheDocument()
    expect(within(deals).getByRole('link', { name: 'View all deals' })).toHaveAttribute('href', '/shop?on_sale=1')

    act(() => vi.advanceTimersByTime(5_500))
    await waitFor(() => expect(screen.queryByTestId('hot-deals')).not.toBeInTheDocument())
    await waitFor(() => expect(homepageReads).toBe(2))
  })

  it('renders nothing without deals, and marks an empty one in a preview', async () => {
    serve({ 'GET /store/homepage': ok({ sections: [hotDeals({ products: [] })], preview: false }) })
    const { unmount } = renderRoutes(storefrontRoutes)
    await screen.findByRole('heading', { level: 1, name: 'Berry Kids' })
    await waitFor(() => expect(screen.queryByTestId('homepage-section')).not.toBeInTheDocument())
    unmount()

    serve({ 'GET /store/homepage': ok({ sections: [hotDeals({ products: [], state: 'empty' })], preview: true }) })
    renderRoutes(storefrontRoutes, '/?preview=1')
    expect(await screen.findByText('No live flash sales — visitors do not see this section')).toBeInTheDocument()
    expect(screen.queryByTestId('hot-deals')).not.toBeInTheDocument()
  })
})
