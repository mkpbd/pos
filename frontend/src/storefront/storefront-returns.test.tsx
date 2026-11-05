import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api/client'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { canRequestReturn, returnErrorMessage } from './orders/returns-api'
import { storefrontRoutes } from './routes'
import { bootstrapFixture, cartFixture, customerFixture, listingBody, orderFixture, productCard, tEn } from './test-fixtures'
import type { AccountOrder, AccountReturn, OrderReturnSummary } from './types'

type Routes = Parameters<typeof mockApi>[0]

const bodyOf = (init: RequestInit) => JSON.parse(String(init.body ?? 'null')) as Record<string, unknown>
const headerOf = (init: RequestInit, name: string) => new Headers(init.headers).get(name)

function serve(routes: Routes = {}) {
  return mockApi({
    'GET /store/bootstrap': ok(bootstrapFixture()),
    'GET /store/account/me': ok(customerFixture()),
    'GET /store/cart': ok(cartFixture()),
    'GET /store/wishlist': ok({ items: [] }),
    ...routes,
  })
}

const DEADLINE = '2026-11-05T23:59:59+06:00'

function returnableOrder(overrides: Partial<AccountOrder> = {}): AccountOrder {
  const base = orderFixture()
  const tee = base.lines[0]!
  return {
    ...base,
    number: 'WEB-000002',
    status: 'delivered',
    status_label: 'Delivered',
    payment_status: 'paid',
    can_cancel: false,
    returnable: true,
    return_deadline: DEADLINE,
    returns: [],
    lines: [
      { ...tee, id: 'ol-1', product_id: 'p-tee', review: null, reviewable: true, returnable_quantity: '2.000' },
      { ...tee, id: 'ol-2', product_id: 'p-cap', product_name: 'Kids Cap', variant_name: null, sku: 'CAP-1', quantity: '1.000', review: null, reviewable: true, returnable_quantity: '0.000' },
    ],
    ...overrides,
  }
}

function returnSummary(overrides: Partial<OrderReturnSummary> = {}): OrderReturnSummary {
  return {
    number: 'RTN-WEB-000001',
    status: 'requested',
    status_label: 'Requested',
    lines: [{ order_line_id: 'ol-1', quantity: '1.000' }],
    refund_amount: '450.00',
    created_at: '2026-11-01T10:00:00+06:00',
    ...overrides,
  }
}

function accountReturn(overrides: Partial<AccountReturn> = {}): AccountReturn {
  return {
    ...returnSummary(),
    lines: [{ order_line_id: 'ol-1', product_name: 'Kids Tee', variant_name: 'Red / M', quantity: '1.000', amount: '450.00' }],
    order: { number: 'WEB-000002' },
    currency: 'BDT',
    ...overrides,
  }
}

async function openReturnDialog() {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Return items' }))
  const dialog = await screen.findByRole('dialog', { name: 'Return items' })
  return { user, dialog }
}

describe('requesting a return', () => {
  it('validates, then sends the chosen lines with an Idempotency-Key reused on retry, and lists the new return', async () => {
    const keys: (string | null)[] = []
    const bodies: unknown[] = []
    let attempts = 0
    let order = returnableOrder()
    serve({
      'GET /store/account/orders/WEB-000002': () => ok(order),
      'POST /store/account/orders/WEB-000002/returns': (init) => {
        attempts += 1
        keys.push(headerOf(init, 'Idempotency-Key'))
        bodies.push(bodyOf(init))
        if (attempts === 1) return fail(503, 'SERVICE_UNAVAILABLE')
        order = returnableOrder({
          lines: order.lines.map((l) => (l.id === 'ol-1' ? { ...l, returnable_quantity: '1.000' } : l)),
          returns: [returnSummary()],
        })
        return { status: 201, body: { success: true, data: accountReturn(), meta: { request_id: 't' } } }
      },
    })
    renderRoutes(storefrontRoutes, '/account/orders/WEB-000002')

    expect(await screen.findByTestId('return-deadline')).toHaveTextContent('Returns accepted until')
    const { user, dialog } = await openReturnDialog()
    expect(within(dialog).getByText(/Returns are accepted until/)).toBeInTheDocument()
    // Only the line with something left to return is offered.
    expect(within(dialog).getAllByTestId('return-line')).toHaveLength(1)
    expect(within(dialog).queryByText(/Kids Cap/)).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Request return' }))
    expect(within(dialog).getByText('Please choose at least one item to return.')).toBeInTheDocument()
    expect(within(dialog).getByText('Please choose a reason.')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Reason')).toHaveAccessibleDescription('Please choose a reason.')
    expect(bodies).toEqual([])

    await user.click(within(dialog).getByLabelText(/Return Kids Tee \(Red \/ M\)/))
    const quantity = within(dialog).getByLabelText('Quantity of Kids Tee (Red / M) to return')
    expect(quantity).toHaveValue('2')
    expect(within(dialog).getByRole('button', { name: 'Increase: Quantity of Kids Tee (Red / M) to return' })).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: 'Decrease: Quantity of Kids Tee (Red / M) to return' }))
    expect(quantity).toHaveValue('1')
    await user.selectOptions(within(dialog).getByLabelText('Reason'), 'Arrived damaged')
    await user.type(within(dialog).getByLabelText('Comments (optional)'), '  Torn seam  ')
    expect(within(dialog).getByText('13/500 characters')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Request return' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
    await user.click(within(dialog).getByRole('button', { name: 'Request return' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBe(keys[0])
    expect(bodies).toEqual([
      { reason_code: 'damaged', note: 'Torn seam', lines: [{ order_line_id: 'ol-1', quantity: '1' }] },
      { reason_code: 'damaged', note: 'Torn seam', lines: [{ order_line_id: 'ol-1', quantity: '1' }] },
    ])
    expect(await screen.findByText('Return RTN-WEB-000001 was requested. We will e-mail you once the store has reviewed it.')).toBeInTheDocument()

    const card = await screen.findByTestId('order-returns')
    const item = within(card).getByRole('article', { name: 'Return RTN-WEB-000001' })
    expect(within(item).getByTestId('return-status')).toHaveTextContent('Requested')
    expect(item).toHaveTextContent('1 × Kids Tee (Red / M)')
    expect(within(item).getByTestId('return-refund')).toHaveTextContent('Refund due once the items are received: ৳450.00')
    expect(within(card).getByRole('link', { name: 'All your returns' })).toHaveAttribute('href', '/account/returns')
  })

  it('starts a new attempt with a new key after a definite refusal', async () => {
    const keys: (string | null)[] = []
    serve({
      'GET /store/account/orders/WEB-000002': ok(returnableOrder()),
      'POST /store/account/orders/WEB-000002/returns': (init) => {
        keys.push(headerOf(init, 'Idempotency-Key'))
        return fail(429, 'TOO_MANY_REQUESTS')
      },
    })
    renderRoutes(storefrontRoutes, '/account/orders/WEB-000002')
    const { user, dialog } = await openReturnDialog()
    await user.click(within(dialog).getByLabelText(/Return Kids Tee/))
    await user.selectOptions(within(dialog).getByLabelText('Reason'), 'changed_mind')
    await user.click(within(dialog).getByRole('button', { name: 'Request return' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Too many attempts. Please try again later.')
    await user.click(within(dialog).getByRole('button', { name: 'Request return' }))
    await waitFor(() => expect(keys).toHaveLength(2))
    expect(keys[1]).not.toBe(keys[0])
  })

  it.each([
    ['window_closed', 'The return window for this order has closed.'],
    ['not_delivered', 'Items can be returned once the order has been delivered.'],
    ['not_paid', 'This order can be returned once its payment is complete.'],
    ['returns_disabled', 'This store does not accept returns online. Please contact us for help.'],
  ])('explains RETURN_NOT_ALLOWED (%s) and refreshes the order', async (reason, message) => {
    let reads = 0
    serve({
      'GET /store/account/orders/WEB-000002': () => {
        reads += 1
        return ok(returnableOrder(reads > 1 ? { returnable: false } : {}))
      },
      'POST /store/account/orders/WEB-000002/returns': fail(422, 'RETURN_NOT_ALLOWED', 'Not allowed', { reason }),
    })
    renderRoutes(storefrontRoutes, '/account/orders/WEB-000002')
    const { user, dialog } = await openReturnDialog()
    await user.click(within(dialog).getByLabelText(/Return Kids Tee/))
    await user.selectOptions(within(dialog).getByLabelText('Reason'), 'other')
    await user.click(within(dialog).getByRole('button', { name: 'Request return' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(message)
    await waitFor(() => expect(reads).toBe(2))
    expect(screen.queryByRole('button', { name: 'Return items' })).not.toBeInTheDocument()
  })

  it('explains QUANTITY_EXCEEDS_RETURNABLE and caps the quantity at what is left', async () => {
    let reads = 0
    serve({
      'GET /store/account/orders/WEB-000002': () => {
        reads += 1
        const order = returnableOrder()
        return ok(reads > 1 ? { ...order, lines: order.lines.map((l) => (l.id === 'ol-1' ? { ...l, returnable_quantity: '1.000' } : l)) } : order)
      },
      'POST /store/account/orders/WEB-000002/returns': fail(422, 'QUANTITY_EXCEEDS_RETURNABLE', 'Too many', { order_line_id: 'ol-1' }),
    })
    renderRoutes(storefrontRoutes, '/account/orders/WEB-000002')
    const { user, dialog } = await openReturnDialog()
    await user.click(within(dialog).getByLabelText(/Return Kids Tee/))
    await user.selectOptions(within(dialog).getByLabelText('Reason'), 'wrong_item')
    await user.click(within(dialog).getByRole('button', { name: 'Request return' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Some of these items have already been returned.')
    await waitFor(() => expect(within(dialog).getByLabelText('Quantity of Kids Tee (Red / M) to return')).toHaveValue('1'))
    expect(within(dialog).getByText('You can return up to 1.')).toBeInTheDocument()
  })

  it('offers no return when the order is not returnable or nothing is left to return', async () => {
    const order = returnableOrder({ returnable: false })
    serve({ 'GET /store/account/orders/WEB-000002': ok(order) })
    renderRoutes(storefrontRoutes, '/account/orders/WEB-000002')
    expect(await screen.findByRole('heading', { level: 1, name: 'Order WEB-000002' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Return items' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('return-deadline')).not.toBeInTheDocument()
    expect(screen.queryByTestId('order-returns')).not.toBeInTheDocument()

    const used = returnableOrder()
    expect(canRequestReturn({ ...used, lines: used.lines.map((l) => ({ ...l, returnable_quantity: '0.000' })) })).toBe(false)
    expect(canRequestReturn({ ...used, lines: used.lines.map((l) => ({ ...l, id: undefined })) })).toBe(false)
    expect(canRequestReturn(used)).toBe(true)
  })
})

describe('cancelling a return', () => {
  it('cancels a requested return from the order page with an Idempotency-Key', async () => {
    const keys: (string | null)[] = []
    let order = returnableOrder({
      returns: [
        returnSummary(),
        returnSummary({ number: 'RTN-WEB-000000', status: 'refunded', status_label: 'Refunded', refund_amount: '450.00' }),
        returnSummary({ number: 'RTN-WEB-000003', status: 'rejected', status_label: 'Rejected' }),
      ],
    })
    serve({
      'GET /store/account/orders/WEB-000002': () => ok(order),
      'POST /store/account/returns/RTN-WEB-000001/cancel': (init) => {
        keys.push(headerOf(init, 'Idempotency-Key'))
        order = { ...order, returns: order.returns!.map((r) => (r.number === 'RTN-WEB-000001' ? { ...r, status: 'cancelled', status_label: 'Cancelled' } : r)) }
        return ok(accountReturn({ status: 'cancelled', status_label: 'Cancelled' }))
      },
    })
    renderRoutes(storefrontRoutes, '/account/orders/WEB-000002')
    const user = userEvent.setup()

    const card = await screen.findByTestId('order-returns')
    const refunded = within(card).getByRole('article', { name: 'Return RTN-WEB-000000' })
    expect(within(refunded).getByTestId('return-refund')).toHaveTextContent('Refunded: ৳450.00')
    expect(within(refunded).queryByRole('button')).not.toBeInTheDocument()
    expect(within(within(card).getByRole('article', { name: 'Return RTN-WEB-000003' })).queryByTestId('return-refund')).not.toBeInTheDocument()

    await user.click(within(card).getByRole('button', { name: 'Cancel return RTN-WEB-000001' }))
    const dialog = await screen.findByRole('dialog', { name: 'Cancel return RTN-WEB-000001?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel return' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('Return RTN-WEB-000001 was cancelled.')).toBeInTheDocument()
    expect(keys).toHaveLength(1)
    expect(keys[0]).toBeTruthy()
    await waitFor(() => expect(within(within(card).getByRole('article', { name: 'Return RTN-WEB-000001' })).getByTestId('return-status')).toHaveTextContent('Cancelled'))
    expect(screen.queryByRole('button', { name: 'Cancel return RTN-WEB-000001' })).not.toBeInTheDocument()
  })
})

describe('my returns page', () => {
  it('lists own returns with status, refund and order, and cancels a requested one', async () => {
    let rows = [
      accountReturn(),
      accountReturn({
        number: 'RTN-WEB-000000',
        status: 'rejected',
        status_label: 'Rejected',
        rejection_reason: 'Item was used',
        order: null,
        order_number: 'WEB-000001',
      }),
      accountReturn({ number: 'RTN-WEB-000004', status: 'refunded', status_label: 'Refunded', refund_amount: '120.00' }),
    ]
    const cancels: string[] = []
    serve({
      'GET /store/account/returns': () => ok(rows, { pagination: { current_page: 1, per_page: 10, total: rows.length, last_page: 1 } }),
      'POST /store/account/returns/RTN-WEB-000001/cancel': (init) => {
        cancels.push(headerOf(init, 'Idempotency-Key') ?? '')
        rows = rows.map((r) => (r.number === 'RTN-WEB-000001' ? { ...r, status: 'cancelled', status_label: 'Cancelled' } : r))
        return ok(rows[0])
      },
    })
    renderRoutes(storefrontRoutes, '/account/returns')
    const user = userEvent.setup()

    expect(await screen.findByRole('heading', { level: 1, name: 'My returns' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Account' })
    expect(within(nav).getByRole('link', { name: 'Returns' })).toHaveAttribute('aria-current', 'page')
    await waitFor(() => expect(document.title).toBe('My returns | Berry Kids'))

    const list = await screen.findByRole('list', { name: 'Returns' })
    const requested = within(list).getByRole('article', { name: 'Return RTN-WEB-000001' })
    expect(requested).toHaveTextContent('1 × Kids Tee (Red / M)')
    expect(within(requested).getByRole('link', { name: 'WEB-000002' })).toHaveAttribute('href', '/account/orders/WEB-000002')
    const rejected = within(list).getByRole('article', { name: 'Return RTN-WEB-000000' })
    expect(rejected).toHaveTextContent('Not accepted: Item was used')
    expect(within(rejected).getByRole('link', { name: 'WEB-000001' })).toBeInTheDocument()
    expect(within(rejected).queryByRole('button')).not.toBeInTheDocument()
    expect(within(within(list).getByRole('article', { name: 'Return RTN-WEB-000004' })).getByTestId('return-refund')).toHaveTextContent('Refunded: ৳120.00')

    await user.click(within(requested).getByRole('button', { name: 'Cancel return RTN-WEB-000001' }))
    const dialog = await screen.findByRole('dialog', { name: 'Cancel return RTN-WEB-000001?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel return' }))
    await waitFor(() => expect(within(screen.getByRole('article', { name: 'Return RTN-WEB-000001' })).getByTestId('return-status')).toHaveTextContent('Cancelled'))
    expect(cancels).toHaveLength(1)
  })

  it('explains a return that can no longer be cancelled', async () => {
    serve({
      'GET /store/account/returns': ok([accountReturn()]),
      'POST /store/account/returns/RTN-WEB-000001/cancel': fail(422, 'RETURN_NOT_CANCELLABLE'),
    })
    renderRoutes(storefrontRoutes, '/account/returns')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Cancel return RTN-WEB-000001' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel return' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This return can no longer be cancelled')
  })

  it('shows an empty state and is reachable from the account menu', async () => {
    serve({ 'GET /store/account/returns': ok([]), 'GET /store/account/orders': ok([]) })
    renderRoutes(storefrontRoutes, '/account/returns')
    const user = userEvent.setup()

    expect(await screen.findByText('You have not returned anything.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View your delivered orders' })).toHaveAttribute('href', '/account/orders?status=delivered')
    await user.click(screen.getByRole('button', { name: 'My account' }))
    expect(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Returns' })).toHaveAttribute('href', '/account/returns')
  })
})

describe('return error messages', () => {
  it('falls back for unknown refusals', () => {
    expect(returnErrorMessage(new ApiError(422, 'RETURN_NOT_ALLOWED', 'x', {}), tEn)).toBe('This order cannot be returned online. Please contact us for help.')
    expect(returnErrorMessage(new ApiError(422, 'VALIDATION_FAILED', 'x', { note: ['The note may not be greater than 500 characters.'] }), tEn)).toBe(
      'The note may not be greater than 500 characters.',
    )
  })
})

describe('ratings on cards', () => {
  it('shows stars with a text alternative and the count, nothing without reviews, and sorts by rating', async () => {
    const fetchMock = mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/products': {
        body: listingBody([productCard('mango-juice', { rating: { average: '4.5', count: 12 } }), productCard('apple-juice', { rating: { average: '5.0', count: 1 } }), productCard('orange-juice', { rating: null })]),
      },
    })
    const { router } = renderRoutes(storefrontRoutes, '/shop')
    const user = userEvent.setup()

    const [mango, apple, orange] = await screen.findAllByTestId('product-card')
    const rating = within(mango!).getByTestId('card-rating')
    expect(within(rating).getByRole('img', { name: 'Rated 4.5 out of 5' })).toBeInTheDocument()
    expect(rating).toHaveTextContent('(12)12 reviews')
    expect(within(apple!).getByTestId('card-rating')).toHaveTextContent('1 review')
    expect(within(orange!).queryByTestId('card-rating')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Sort by'), 'Top rated')
    await waitFor(() => expect(router.state.location.search).toBe('?sort=rating'))
    await waitFor(() => {
      const sorts = fetchMock.mock.calls.map(([input]) => new URL(String(input), 'http://localhost')).filter((u) => u.pathname === '/api/v1/store/products').map((u) => u.searchParams.get('sort'))
      expect(sorts.at(-1)).toBe('rating')
    })
  })
})
