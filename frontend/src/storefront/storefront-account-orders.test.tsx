import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { normalizeReviews } from './reviews/api'
import { reorderNotice, toPage } from './orders/account-api'
import { storefrontRoutes } from './routes'
import { bootstrapFixture, cartFixture, cartLine, customerFixture, orderFixture, productDetail, tEn } from './test-fixtures'
import type { AccountOrder, AccountOrderRow, Customer, MyReview } from './types'

type Routes = Parameters<typeof mockApi>[0]

const bodyOf = (init: RequestInit) => JSON.parse(String(init.body ?? 'null')) as Record<string, unknown>
const headerOf = (init: RequestInit, name: string) => new Headers(init.headers).get(name)

function serve(routes: Routes = {}, me: Customer | null = customerFixture()) {
  return mockApi({
    'GET /store/bootstrap': ok(bootstrapFixture()),
    'GET /store/account/me': ok(me),
    'GET /store/cart': ok(cartFixture()),
    'GET /store/wishlist': ok({ items: [] }),
    ...routes,
  })
}

function row(number: string, overrides: Partial<AccountOrderRow> = {}): AccountOrderRow {
  return {
    number,
    placed_at: '2026-10-30T10:00:00+06:00',
    status: 'confirmed',
    status_label: 'Confirmed',
    payment_status: 'unpaid',
    payment_method_label: 'Cash on delivery',
    item_count: 2,
    total: '960.00',
    currency: 'BDT',
    first_item: { name: 'Kids Tee', image_url: null },
    ...overrides,
  }
}

const page = (current: number, last: number, total: number) => ({ pagination: { current_page: current, per_page: 10, total, last_page: last } })

function accountOrder(overrides: Partial<AccountOrder> = {}): AccountOrder {
  const base = orderFixture()
  return {
    ...base,
    lines: base.lines.map((line) => ({ ...line, product_id: 'p-tee', review: null, reviewable: false })),
    can_cancel: true,
    ...overrides,
  }
}

const deliveredOrder = (lineOverrides: Partial<AccountOrder['lines'][number]> = {}) =>
  accountOrder({
    number: 'WEB-000002',
    status: 'delivered',
    status_label: 'Delivered',
    payment_status: 'paid',
    can_cancel: false,
    courier_name: 'Pathao',
    tracking_number: 'PT-12345',
    history: [
      { status: 'confirmed', label: 'Confirmed', at: '2026-10-20T10:00:00+06:00' },
      { status: 'shipped', label: 'Shipped', at: '2026-10-21T10:00:00+06:00' },
      { status: 'delivered', label: 'Delivered', at: '2026-10-22T10:00:00+06:00' },
    ],
    lines: [{ ...orderFixture().lines[0]!, product_id: 'p-tee', review: null, reviewable: true, ...lineOverrides }],
  })

function myReview(overrides: Partial<MyReview> = {}): MyReview {
  return {
    id: 'r-1',
    product: { id: 'p-tee', name: 'Kids Tee', slug: 'kids-tee', image_url: null },
    rating: 4,
    title: 'Soft and comfy',
    body: 'My son loves wearing it every day.',
    status: 'pending',
    rejection_reason: null,
    created_at: '2026-10-25T10:00:00+06:00',
    ...overrides,
  }
}

describe('order history', () => {
  it('lists own orders with status tabs, pagination and the account navigation', async () => {
    const requests: string[] = []
    serve({
      'GET /store/account/orders': (_init, url) => {
        requests.push(url.search)
        if (url.searchParams.get('status') === 'cancelled') return ok([])
        if (url.searchParams.get('page') === '2') return ok([row('WEB-000001')], page(2, 2, 11))
        return ok([row('WEB-000011', { status: 'shipped', status_label: 'Shipped' }), row('WEB-000010')], page(1, 2, 11))
      },
    })
    const { router } = renderRoutes(storefrontRoutes, '/account/orders')
    const user = userEvent.setup()

    expect(await screen.findByRole('heading', { level: 1, name: 'My orders' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Account' })
    expect(within(nav).getByRole('link', { name: 'Orders' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Reviews' })).toHaveAttribute('href', '/account/reviews')

    const rows = await screen.findAllByTestId('order-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveAttribute('href', '/account/orders/WEB-000011')
    expect(rows[0]).toHaveTextContent('Shipped')
    expect(rows[0]).toHaveTextContent('Kids Tee · 2 items')
    expect(rows[0]).toHaveTextContent('৳960.00')
    await waitFor(() => expect(document.title).toBe('My orders | Berry Kids'))

    await user.click(within(screen.getByRole('navigation', { name: 'Pagination' })).getByRole('link', { name: 'Page 2' }))
    await waitFor(() => expect(screen.getAllByTestId('order-row')).toHaveLength(1))
    expect(router.state.location.search).toBe('?page=2')

    const tabs = screen.getByRole('navigation', { name: 'Order status' })
    await user.click(within(tabs).getByRole('link', { name: 'Cancelled' }))
    expect(await screen.findByText('You have no cancelled orders.')).toBeInTheDocument()
    expect(within(tabs).getByRole('link', { name: 'Cancelled' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Start shopping' })).toHaveAttribute('href', '/shop')
    // Every store request carries the language (ADR-011).
    expect(requests).toEqual(['?lang=en', '?page=2&lang=en', '?status=cancelled&lang=en'])
  })

  it('shows the last three orders on the account overview', async () => {
    serve({ 'GET /store/account/orders': ok([row('WEB-4'), row('WEB-3'), row('WEB-2'), row('WEB-1')], page(1, 1, 4)) })
    renderRoutes(storefrontRoutes, '/account')

    const card = await screen.findByTestId('recent-orders')
    await waitFor(() => expect(within(card).getAllByTestId('order-row')).toHaveLength(3))
    expect(within(card).getByRole('link', { name: 'View all orders' })).toHaveAttribute('href', '/account/orders')
  })

  it('sends guests to sign in', async () => {
    serve({}, null)
    const { router } = renderRoutes(storefrontRoutes, '/account/orders/WEB-000001')
    await waitFor(() => expect(router.state.location.pathname).toBe('/account/login'))
  })
})

describe('order detail', () => {
  it('shows lines, totals, the tracking timeline and hides cancel when not allowed', async () => {
    serve({ 'GET /store/account/orders/WEB-000002': ok(deliveredOrder()) })
    renderRoutes(storefrontRoutes, '/account/orders/WEB-000002')

    expect(await screen.findByRole('heading', { level: 1, name: 'Order WEB-000002' })).toBeInTheDocument()
    expect(screen.getByTestId('order-status')).toHaveTextContent('Delivered')
    const history = screen.getByTestId('order-history')
    expect(within(history).getAllByRole('listitem').map((li) => li.querySelector('span:not([aria-hidden])')?.textContent)).toEqual(['Confirmed', 'Shipped', 'Delivered'])
    expect(screen.getByTestId('order-tracking')).toHaveTextContent('Shipped with Pathao — tracking number PT-12345')
    expect(screen.getAllByTestId('order-line')).toHaveLength(1)
    expect(screen.getByTestId('order-payment')).toHaveTextContent('Cash on delivery · Paid')
    expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'All orders' })).toHaveAttribute('href', '/account/orders')
  })

  it("shows another customer's order as not found", async () => {
    serve({ 'GET /store/account/orders/WEB-999': fail(404, 'NOT_FOUND') })
    renderRoutes(storefrontRoutes, '/account/orders/WEB-999')
    expect(await screen.findByText('We could not find this order in your account.')).toBeInTheDocument()
  })

  it('cancels with a reason and an Idempotency-Key, reusing the key when retrying after a server error', async () => {
    const keys: (string | null)[] = []
    const bodies: unknown[] = []
    let attempts = 0
    let order = accountOrder()
    serve({
      'GET /store/account/orders/WEB-000001': () => ok(order),
      'GET /store/account/orders': ok([]),
      'POST /store/account/orders/WEB-000001/cancel': (init) => {
        attempts += 1
        keys.push(headerOf(init, 'Idempotency-Key'))
        bodies.push(bodyOf(init))
        if (attempts === 1) return fail(503, 'SERVICE_UNAVAILABLE')
        order = accountOrder({ status: 'cancelled', status_label: 'Cancelled', can_cancel: false, history: [...order.history, { status: 'cancelled', label: 'Cancelled', at: '2026-10-31T11:00:00+06:00' }] })
        return ok(order)
      },
    })
    renderRoutes(storefrontRoutes, '/account/orders/WEB-000001')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Cancel order' }))
    const dialog = await screen.findByRole('dialog', { name: 'Cancel order WEB-000001?' })
    await user.type(within(dialog).getByLabelText('Reason (optional)'), 'Ordered by mistake')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel order' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')

    await user.click(within(dialog).getByRole('button', { name: 'Cancel order' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBe(keys[0])
    expect(bodies).toEqual([{ reason: 'Ordered by mistake' }, { reason: 'Ordered by mistake' }])
    expect(await screen.findByText('Order WEB-000001 was cancelled.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('order-status')).toHaveTextContent('Cancelled'))
    expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument()
  })

  it('explains ORDER_NOT_CANCELLABLE and refreshes the order', async () => {
    let reads = 0
    serve({
      'GET /store/account/orders/WEB-000001': () => {
        reads += 1
        return ok(accountOrder(reads > 1 ? { status: 'processing', status_label: 'Processing', can_cancel: false } : {}))
      },
      'POST /store/account/orders/WEB-000001/cancel': fail(422, 'ORDER_NOT_CANCELLABLE', 'Not cancellable', { status: 'processing' }),
    })
    renderRoutes(storefrontRoutes, '/account/orders/WEB-000001')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Cancel order' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel order' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This order can no longer be cancelled.')
    await waitFor(() => expect(reads).toBe(2))
  })

  it('buys again: fills the cart, opens the mini-cart and lists skipped items', async () => {
    const cart = cartFixture([cartLine('l-1')], { item_count: '2' })
    serve({
      'GET /store/account/orders/WEB-000002': ok(deliveredOrder()),
      'POST /store/account/orders/WEB-000002/reorder': ok({
        cart,
        added: [{ variant_id: 'v-l-1', name: 'Kids Tee', quantity: '2' }],
        skipped: [{ name: 'Kids Cap', reason: 'out_of_stock' }, { name: 'Old Hat', reason: 'unavailable' }],
      }),
    })
    renderRoutes(storefrontRoutes, '/account/orders/WEB-000002')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Buy again' }))
    expect(await screen.findByRole('dialog', { name: 'Your cart (2)' })).toBeInTheDocument()
    expect(await screen.findByText('1 item was added to your cart. Not added: Kids Cap (out of stock), Old Hat (no longer available).')).toBeInTheDocument()
  })

  it('reports a rate-limited buy again', async () => {
    serve({
      'GET /store/account/orders/WEB-000002': ok(deliveredOrder()),
      'POST /store/account/orders/WEB-000002/reorder': fail(429, 'TOO_MANY_REQUESTS'),
    })
    renderRoutes(storefrontRoutes, '/account/orders/WEB-000002')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Buy again' }))
    expect(await screen.findByText('Too many attempts. Please try again later.')).toBeInTheDocument()
  })
})

describe('reviews from orders', () => {
  it('writes a review with the star radio group after client validation', async () => {
    const posted: unknown[] = []
    let reviewed = false
    serve({
      'GET /store/account/orders/WEB-000002': () => ok(reviewed ? deliveredOrder({ reviewable: false, review: { id: 'r-1', rating: 5, status: 'pending' } }) : deliveredOrder()),
      'GET /store/account/reviews': ok([myReview({ rating: 5 })]),
      'POST /store/account/reviews': (init) => {
        posted.push(bodyOf(init))
        reviewed = true
        return { status: 201, body: { success: true, data: myReview({ rating: 5 }), meta: { request_id: 't' } } }
      },
    })
    renderRoutes(storefrontRoutes, '/account/orders/WEB-000002')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Write a review of Kids Tee' }))
    const dialog = await screen.findByRole('dialog', { name: 'Write a review' })
    await user.click(within(dialog).getByRole('button', { name: 'Submit review' }))
    expect(within(dialog).getByText('Please choose a rating from 1 to 5 stars.')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Your review')).toHaveAccessibleDescription('Please write at least 10 characters.')
    expect(posted).toEqual([])

    const group = within(dialog).getByRole('radiogroup', { name: 'Your rating' })
    expect(within(group).getAllByRole('radio').map((r) => r.getAttribute('value'))).toEqual(['1', '2', '3', '4', '5'])
    await user.click(within(group).getByLabelText('5 stars'))
    expect(within(group).getByLabelText('5 stars')).toBeChecked()
    await user.type(within(dialog).getByLabelText('Title (optional)'), 'Lovely')
    await user.type(within(dialog).getByLabelText('Your review'), '  Great quality and fits well.  ')
    await user.click(within(dialog).getByRole('button', { name: 'Submit review' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(posted).toEqual([{ product_id: 'p-tee', rating: 5, title: 'Lovely', body: 'Great quality and fits well.' }])
    const line = await screen.findByTestId('line-review')
    expect(line).toHaveTextContent('Pending')
    expect(within(line).getByRole('img', { name: 'Rated 5 out of 5' })).toBeInTheDocument()
  })

  it.each([
    [fail(422, 'REVIEW_NOT_ALLOWED'), 'You can review a product once an order with it has been delivered to you.'],
    [fail(422, 'REVIEW_EXISTS'), 'You have already reviewed this product.'],
    [fail(429, 'TOO_MANY_REQUESTS'), 'Too many attempts. Please try again later.'],
  ])('shows the refusal %#', async (reply, message) => {
    serve({ 'GET /store/account/orders/WEB-000002': ok(deliveredOrder()), 'POST /store/account/reviews': reply })
    renderRoutes(storefrontRoutes, '/account/orders/WEB-000002')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Write a review of Kids Tee' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByLabelText('3 stars'))
    await user.type(within(dialog).getByLabelText('Your review'), 'It is a nice tee overall.')
    await user.click(within(dialog).getByRole('button', { name: 'Submit review' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(message)
  })

  it('edits a rejected review from the order and shows the reason', async () => {
    const patched: unknown[] = []
    serve({
      'GET /store/account/orders/WEB-000002': ok(deliveredOrder({ reviewable: false, review: { id: 'r-1', rating: 2, status: 'rejected' } })),
      'GET /store/account/reviews': ok([myReview({ rating: 2, status: 'rejected', rejection_reason: 'Contains a phone number' })]),
      'PATCH /store/account/reviews/r-1': (init) => {
        patched.push(bodyOf(init))
        return ok(myReview({ rating: 3 }))
      },
    })
    renderRoutes(storefrontRoutes, '/account/orders/WEB-000002')
    const user = userEvent.setup()

    const line = await screen.findByTestId('line-review')
    expect(line).toHaveTextContent('Rejected')
    expect(await within(line).findByText('Reason: Contains a phone number')).toBeInTheDocument()
    await user.click(within(line).getByRole('button', { name: 'Edit your review of Kids Tee' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit your review' })
    expect(within(dialog).getByTestId('review-status')).toHaveTextContent('Status: Rejected — Contains a phone number')
    expect(within(dialog).getByLabelText('2 stars')).toBeChecked()
    await user.click(within(dialog).getByLabelText('3 stars'))
    await user.click(within(dialog).getByRole('button', { name: 'Save review' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(patched).toEqual([{ rating: 3, title: 'Soft and comfy', body: 'My son loves wearing it every day.' }])
  })
})

describe('my reviews', () => {
  it('lists own reviews with their status and deletes one after confirming', async () => {
    let reviews = [myReview(), myReview({ id: 'r-2', product: { id: 'p-cap', name: 'Kids Cap', slug: 'kids-cap', image_url: null }, status: 'approved' }), myReview({ id: 'r-3', product: { id: 'p-hat', name: 'Sun Hat', slug: null, image_url: null }, status: 'rejected', rejection_reason: 'Off-topic' })]
    const deleted: string[] = []
    serve({
      'GET /store/account/reviews': () => ok(reviews),
      'DELETE /store/account/reviews/r-2': () => {
        deleted.push('r-2')
        reviews = reviews.filter((r) => r.id !== 'r-2')
        return { status: 204 }
      },
    })
    renderRoutes(storefrontRoutes, '/account/reviews')
    const user = userEvent.setup()

    const cards = await screen.findAllByTestId('my-review')
    expect(cards.map((c) => within(c).getByTestId('review-status').textContent)).toEqual(['Pending', 'Published', 'Rejected'])
    expect(within(cards[2]!).getByTestId('rejection-reason')).toHaveTextContent('Not published: Off-topic')
    expect(within(cards[1]!).getByRole('link', { name: 'Kids Cap' })).toHaveAttribute('href', '/product/kids-cap')

    await user.click(within(cards[1]!).getByRole('button', { name: 'Edit or delete your review of Kids Cap' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit your review' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete review' }))
    await user.click(within(dialog).getByRole('button', { name: 'Yes, delete review' }))
    await waitFor(() => expect(screen.getAllByTestId('my-review')).toHaveLength(2))
    expect(deleted).toEqual(['r-2'])
    expect(await screen.findByText('Your review was deleted.')).toBeInTheDocument()
  })

  it('shows an empty state', async () => {
    serve({ 'GET /store/account/reviews': ok([]) })
    renderRoutes(storefrontRoutes, '/account/reviews')
    expect(await screen.findByText('You have not written a review yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review your delivered orders' })).toHaveAttribute('href', '/account/orders?status=delivered')
  })
})

describe('product reviews', () => {
  const publicReview = (id: string, rating: number) => ({ id, rating, title: `Title ${id}`, body: `Body of ${id}`, author: 'Rina A.', created_at: '2026-10-25T10:00:00+06:00', verified: true })
  const summary = { average: '4.5', count: 12, distribution: { '5': 8, '4': 2, '3': 1, '2': 1, '1': 0 } }

  it('shows the rating near the title and the Reviews tab with sort, filter and pages', async () => {
    const queries: string[] = []
    serve({
      'GET /store/products/kids-tee': ok(productDetail({ rating: { average: '4.5', count: 12 } })),
      'GET /store/products/kids-tee/related': ok({ related: [], frequently_bought: [] }),
      'GET /store/products/kids-tee/reviews': (_init, url) => {
        queries.push(url.search)
        const pageNo = Number(url.searchParams.get('page') ?? '1')
        return ok(pageNo === 2 ? [publicReview('r-11', 4)] : [publicReview('r-1', 5), publicReview('r-2', 4)], { ...page(pageNo, 2, 12), summary })
      },
    })
    renderRoutes(storefrontRoutes, '/product/kids-tee')
    const user = userEvent.setup()

    const link = await screen.findByTestId('rating-summary')
    expect(link).toHaveTextContent('4.5 (12 reviews)')
    expect(within(link).getByRole('img', { name: 'Rated 4.5 out of 5' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Reviews (12)' })).toHaveAttribute('aria-selected', 'false')

    await user.click(link)
    expect(screen.getByRole('tab', { name: 'Reviews (12)' })).toHaveAttribute('aria-selected', 'true')
    const panel = await screen.findByTestId('product-reviews')
    expect(within(panel).getAllByTestId('review')).toHaveLength(2)
    expect(within(panel).getAllByTestId('review')[0]).toHaveTextContent('Rina A.')
    expect(within(panel).getAllByTestId('review')[0]).toHaveTextContent('Verified purchase')
    expect(within(panel).getByRole('button', { name: '5 stars: 8 reviews (67 %)' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: '1 star: 0 reviews (0 %)' })).toBeDisabled()
    expect(within(panel).getByTestId('review-hint')).toHaveTextContent('Bought this? Review it from your orders.')

    await user.click(within(panel).getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(within(panel).getAllByTestId('review')).toHaveLength(1))
    expect(within(panel).getByText('Page 2 of 2')).toBeInTheDocument()

    await user.selectOptions(within(panel).getByLabelText('Sort by'), 'lowest')
    await user.selectOptions(within(panel).getByLabelText('Rating'), '4')
    await waitFor(() => expect(queries).toContain('?sort=lowest&rating=4&lang=en'))
    expect(queries.slice(0, 3)).toEqual(['?sort=newest&lang=en', '?sort=newest&page=2&lang=en', '?sort=lowest&lang=en'])
  })

  it('shows "No reviews yet" without a hint for guests', async () => {
    serve(
      {
        'GET /store/products/kids-tee': ok(productDetail({ description_html: null, specifications: [], rating: null })),
        'GET /store/products/kids-tee/related': ok({ related: [], frequently_bought: [] }),
        'GET /store/products/kids-tee/reviews': ok({ data: [], summary: { average: '0.0', count: 0, distribution: {} } }),
      },
      null,
    )
    renderRoutes(storefrontRoutes, '/product/kids-tee')
    expect(await screen.findByText('No reviews yet')).toBeInTheDocument()
    expect(screen.queryByTestId('review-hint')).not.toBeInTheDocument()
  })
})

describe('confirmation for signed-in customers', () => {
  it('links the order page to the account order', async () => {
    serve({ 'GET /store/orders/WEB-000001': ok(orderFixture()) })
    renderRoutes(storefrontRoutes, '/order/WEB-000001')
    expect(await screen.findByTestId('account-order-link')).toHaveAttribute('href', '/account/orders/WEB-000001')
  })

  it('has no account link for guests', async () => {
    serve({ 'GET /store/orders/WEB-000001': ok(orderFixture()) }, null)
    renderRoutes(storefrontRoutes, '/order/WEB-000001?token=abc')
    expect(await screen.findByTestId('order-number')).toBeInTheDocument()
    expect(screen.queryByTestId('account-order-link')).not.toBeInTheDocument()
  })
})

describe('helpers', () => {
  it('reads paging from meta.pagination or flat meta', () => {
    expect(toPage({ success: true, data: [1], meta: { request_id: null, pagination: { current_page: 2, per_page: 10, total: 11, last_page: 2 } } }).pagination.last_page).toBe(2)
    expect(toPage({ success: true, data: [1], meta: { request_id: null, current_page: 3, last_page: 4 } as never }).pagination).toMatchObject({ current_page: 3, last_page: 4 })
  })

  it('reads the review summary next to data, inside data or in meta', () => {
    const summary = { average: '5.0', count: 1, distribution: { '5': 1 } }
    const review = { id: 'r', rating: 5, title: null, body: 'Great product here', author: 'A B.', created_at: '', verified: true }
    expect(normalizeReviews({ success: true, data: [review], summary, meta: { request_id: null } }).summary).toEqual(summary)
    expect(normalizeReviews({ success: true, data: { data: [review], summary }, meta: { request_id: null } }).reviews).toHaveLength(1)
    expect(normalizeReviews({ success: true, data: [], meta: { request_id: null, summary } as never }).summary.count).toBe(1)
  })

  it('words the buy-again notice', () => {
    expect(reorderNotice({ added: [{ variant_id: 'v', name: 'A', quantity: '1' }, { variant_id: 'w', name: 'B', quantity: '1' }], skipped: [] }, tEn)).toBe('2 items were added to your cart.')
    expect(reorderNotice({ added: [], skipped: [{ name: 'A', reason: 'limit' }] }, tEn)).toBe('None of the items could be added to your cart: A (cart limit reached).')
  })
})
