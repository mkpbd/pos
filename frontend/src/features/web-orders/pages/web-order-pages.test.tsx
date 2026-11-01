import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import type { WebOrder } from '@/features/web-orders/api'
import { orderManager, orderRow, orderViewer, webOrder } from '@/features/web-orders/test-data'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: toastError, success: toastSuccess, message: vi.fn() }) }
})

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

beforeEach(() => {
  toastSuccess.mockReset()
  toastError.mockReset()
})

describe('web orders list', () => {
  it('lists orders and sends the filters as query parameters', async () => {
    const user = userEvent.setup()
    const queries: URLSearchParams[] = []
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /web-orders': (_init, url) => {
        queries.push(url.searchParams)
        return paged([orderRow(), orderRow({ id: 'wo-2', number: 'WEB-000002', status: 'confirmed', payment_method: 'cod', item_count: 1 })])
      },
    })
    const { router } = renderRoutes(routes, '/web-orders')

    expect(await screen.findByRole('link', { name: 'WEB-000001' })).toHaveAttribute('href', '/web-orders/wo-1')
    expect(screen.getByRole('link', { name: 'WEB-000002' })).toBeInTheDocument()
    expect(screen.getAllByText('Awaiting payment')[0]).toBeInTheDocument()
    expect(screen.getByText('Cash on delivery')).toBeInTheDocument()
    expect(queries[0]?.toString()).toBe('page=1')

    await user.click(screen.getByRole('combobox', { name: 'Filter by status' }))
    await user.click(await screen.findByRole('option', { name: 'Confirmed' }))
    await waitFor(() => expect(queries.at(-1)?.get('status')).toBe('confirmed'))
    expect(router.state.location.search).toBe('?status=confirmed')

    await user.click(screen.getByRole('combobox', { name: 'Filter by payment' }))
    await user.click(await screen.findByRole('option', { name: 'Unpaid' }))
    await waitFor(() => expect(queries.at(-1)?.get('payment_status')).toBe('unpaid'))

    await user.type(screen.getByLabelText('Search web orders'), ' 01711 ')
    await waitFor(() => expect(queries.at(-1)?.get('search')).toBe('01711'))

    const from = screen.getByLabelText('Placed from')
    await user.type(from, '2026-10-01')
    await waitFor(() => expect(queries.at(-1)?.get('from')).toBe('2026-10-01'))
    expect(queries.at(-1)?.get('status')).toBe('confirmed')

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(queries.at(-1)?.toString()).toBe('page=1'))
  })

  it('reads its filters from the address', async () => {
    let query: URLSearchParams | undefined
    mockApi({
      'GET /auth/me': ok(orderViewer()),
      'GET /web-orders': (_init, url) => {
        query = url.searchParams
        return paged([])
      },
    })
    renderRoutes(routes, '/web-orders?status=shipped&payment_status=paid&from=2026-10-01&to=2026-10-31&page=2')

    expect(await screen.findByText('No orders match these filters')).toBeInTheDocument()
    expect(Object.fromEntries(query ?? [])).toEqual({ page: '2', status: 'shipped', payment_status: 'paid', from: '2026-10-01', to: '2026-10-31' })
  })

  it('is listed in the sidebar for order staff only', async () => {
    mockApi({ 'GET /auth/me': ok(orderViewer()), 'GET /web-orders': paged([]), 'GET /notifications/unread-count': ok({ count: 0 }) })
    renderRoutes(routes, '/web-orders')
    expect(await screen.findByRole('link', { name: 'Web orders' })).toHaveAttribute('href', '/web-orders')
  })
})

describe('web order page', () => {
  it('shows the order and only the actions the server allows', async () => {
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /web-orders/wo-1': ok(webOrder()),
    })
    renderRoutes(routes, '/web-orders/wo-1')

    expect(await screen.findByRole('heading', { name: 'WEB-000001' })).toBeInTheDocument()
    const actions = screen.getByRole('group', { name: 'Order actions' })
    expect(within(actions).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Confirm payment', 'Cancel order'])
    expect(screen.getByTestId('awaiting-transfer')).toHaveTextContent("Waiting for the customer's bank transfer.")
    expect(screen.getByText('Baby Romper — Size M')).toBeInTheDocument()
    expect(screen.getByTestId('order-total')).toHaveTextContent('BDT 1,560.00')
    expect(screen.getByText(/House 12, Road 5/)).toBeInTheDocument()
    expect(screen.getByText('Guest checkout')).toBeInTheDocument()
    expect(screen.getByText('Please call before delivery')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Status history' })).getByText(/System or customer/)).toBeInTheDocument()
  })

  it('shows promotions, the coupon code, line discounts and waived delivery', async () => {
    mockApi({
      'GET /auth/me': ok(orderViewer()),
      'GET /web-orders/wo-1': ok(webOrder({
        lines: [
          { product_name: 'Mango Juice', variant_name: null, sku: 'MJ-1', image_url: null, quantity: '2.000', unit_price: '100.00', line_total: '200.00', discount_amount: '30.00' },
          { product_name: 'Baby Romper', variant_name: 'Size M', sku: 'ROMP-M', image_url: null, quantity: '1.000', unit_price: '3000.00', line_total: '3000.00', discount_amount: '40.00' },
        ],
        subtotal: '3200.00',
        discount_total: '70.00',
        shipping_discount: '60.00',
        shipping_total: '0.00',
        promotions: [
          { name: 'Juice week', kind: 'product', amount: '20.00' },
          { name: 'Welcome 50', kind: 'order', amount: '50.00' },
          { name: 'Free delivery over 3000', kind: 'shipping', amount: '60.00' },
        ],
        coupon_code: 'WELCOME50',
        total: '3130.00',
      })),
    })
    renderRoutes(routes, '/web-orders/wo-1')

    const dl = await screen.findByLabelText('Order totals')
    expect(within(dl).getByText('Juice week')).toBeInTheDocument()
    expect(within(dl).getByText('Product offer')).toBeInTheDocument()
    expect(within(dl).getByText('−20.00')).toBeInTheDocument()
    expect(within(dl).getByText('Welcome 50')).toBeInTheDocument()
    expect(within(dl).getByText('Order discount')).toBeInTheDocument()
    expect(within(dl).getByText('−50.00')).toBeInTheDocument()
    expect(within(dl).getByText(/Free delivery over 3000 · 60.00 waived/)).toBeInTheDocument()
    expect(screen.getByTestId('order-delivery')).toHaveTextContent('60.00Free')
    expect(screen.getByTestId('order-coupon')).toHaveTextContent('Coupon code: WELCOME50')
    expect(screen.getAllByTestId('line-discount').map((c) => c.textContent)).toEqual(['−30.00', '−40.00'])
    expect(screen.getByTestId('order-total')).toHaveTextContent('BDT 3,130.00')
  })

  it('shows a cancellation by the customer with their reason', async () => {
    mockApi({
      'GET /auth/me': ok(orderViewer()),
      'GET /web-orders/wo-1': ok(
        webOrder({
          status: 'cancelled', status_label: 'Cancelled', payment_method: 'cod', payment_method_label: 'Cash on delivery', allowed_actions: [], cancel_reason: 'Ordered by mistake',
          history: [
            // The E9 backend shape: `actor` stays the staff user (null here), `actor_type` says who.
            { status: 'pending_payment', label: 'Awaiting payment', at: '2026-10-31T04:30:00Z', actor: null, actor_type: 'customer', note: null },
            { status: 'confirmed', label: 'Confirmed', at: '2026-10-31T04:30:01Z', actor: null, actor_type: 'system', note: null },
            { status: 'cancelled', label: 'Cancelled', at: '2026-10-31T05:00:00Z', actor: null, actor_type: 'customer', note: 'Ordered by mistake' },
          ],
        }),
      ),
    })
    renderRoutes(routes, '/web-orders/wo-1')

    expect(await screen.findByRole('heading', { name: 'WEB-000001' })).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('Cancelled by customer: Ordered by mistake')
    const items = within(screen.getByRole('list', { name: 'Status history' })).getAllByRole('listitem')
    expect(items[1]).toHaveTextContent(/System$/)
    expect(items[2]).toHaveTextContent('Cancelled by customer')
    expect(items[2]).toHaveTextContent(/· Customer/)
    expect(items[2]).toHaveTextContent('Reason: Ordered by mistake')
  })

  it('shows a customer cancellation without a reason', async () => {
    mockApi({
      'GET /auth/me': ok(orderViewer()),
      'GET /web-orders/wo-1': ok(
        webOrder({
          status: 'cancelled', status_label: 'Cancelled', allowed_actions: [], cancel_reason: null,
          history: [{ status: 'cancelled', label: 'Cancelled', at: '2026-10-31T05:00:00Z', actor: 'customer' }],
        }),
      ),
    })
    renderRoutes(routes, '/web-orders/wo-1')

    expect(await screen.findByRole('note')).toHaveTextContent('Cancelled by customer (no reason given)')
    expect(within(screen.getByRole('list', { name: 'Status history' })).getByText('Cancelled by customer')).toBeInTheDocument()
  })

  it('keeps the staff wording for a cancellation by staff', async () => {
    mockApi({
      'GET /auth/me': ok(orderViewer()),
      'GET /web-orders/wo-1': ok(
        webOrder({
          status: 'cancelled', status_label: 'Cancelled', allowed_actions: [], cancel_reason: 'Out of stock',
          history: [{ status: 'cancelled', label: 'Cancelled', at: '2026-10-31T05:00:00Z', actor: { id: 'u-1', name: 'Rahim Uddin' }, note: 'Out of stock' }],
        }),
      ),
    })
    renderRoutes(routes, '/web-orders/wo-1')

    expect(await screen.findByRole('note')).toHaveTextContent('Cancelled: Out of stock')
    expect(screen.queryByText('Cancelled by customer')).not.toBeInTheDocument()
  })

  it('shows no discount column for orders without discounts', async () => {
    mockApi({ 'GET /auth/me': ok(orderViewer()), 'GET /web-orders/wo-1': ok(webOrder()) })
    renderRoutes(routes, '/web-orders/wo-1')

    expect(await screen.findByRole('heading', { name: 'WEB-000001' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Discount' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('order-coupon')).not.toBeInTheDocument()
  })

  it('hides every action from staff who may only view orders', async () => {
    mockApi({
      'GET /auth/me': ok(orderViewer()),
      'GET /web-orders/wo-1': ok(webOrder()),
    })
    renderRoutes(routes, '/web-orders/wo-1')

    expect(await screen.findByRole('heading', { name: 'WEB-000001' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Order actions' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Confirm payment/ })).not.toBeInTheDocument()
  })

  it('confirms a bank transfer with its reference and an idempotency key', async () => {
    const user = userEvent.setup()
    let body: unknown
    let key: string | null = null
    let current: WebOrder = webOrder()
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /web-orders/wo-1': () => ok(current),
      'POST /web-orders/wo-1/confirm-payment': (init) => {
        body = JSON.parse(String(init.body))
        key = new Headers(init.headers).get('Idempotency-Key')
        current = webOrder({
          status: 'confirmed', status_label: 'Confirmed', payment_status: 'paid', allowed_actions: ['process', 'cancel'],
          payments: [{ method: 'bank_transfer', method_label: 'Bank transfer', amount: '1560.00', reference: 'TRX-778', recorded_at: '2026-10-31T06:00:00Z', recorded_by: 'Rahim Uddin' }],
          history: [
            { status: 'pending_payment', label: 'Awaiting payment', at: '2026-10-31T04:30:00Z', actor: null },
            { status: 'confirmed', label: 'Confirmed', at: '2026-10-31T06:00:00Z', actor: { id: 'u-1', name: 'Rahim Uddin' } },
          ],
        })
        return ok(current)
      },
    })
    renderRoutes(routes, '/web-orders/wo-1')

    await user.click(await screen.findByRole('button', { name: 'Confirm payment' }))
    const dialog = await screen.findByRole('dialog', { name: 'Confirm payment for WEB-000001' })
    const submit = within(dialog).getByRole('button', { name: 'Confirm payment' })
    expect(submit).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Transaction reference'), ' TRX-778 ')
    await user.click(submit)

    await waitFor(() => expect(body).toEqual({ reference: 'TRX-778' }))
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
    expect(toastSuccess).toHaveBeenCalledWith('Payment for WEB-000001 confirmed.')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('TRX-778', { exact: false })).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Order actions' })).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Start processing', 'Cancel order'])
    expect(within(screen.getByRole('list', { name: 'Status history' })).getByText(/Rahim Uddin/)).toBeInTheDocument()
  })

  it('records a shipment with courier and tracking number', async () => {
    const user = userEvent.setup()
    let body: unknown
    let key: string | null = null
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /web-orders/wo-1': ok(webOrder({ status: 'processing', status_label: 'Processing', payment_method: 'cod', allowed_actions: ['ship', 'cancel'] })),
      'POST /web-orders/wo-1/ship': (init) => {
        body = JSON.parse(String(init.body))
        key = new Headers(init.headers).get('Idempotency-Key')
        return ok(webOrder({ status: 'shipped', status_label: 'Shipped', courier_name: 'Pathao', tracking_number: null, allowed_actions: ['deliver', 'record_cod_payment'] }))
      },
    })
    renderRoutes(routes, '/web-orders/wo-1')

    await user.click(await screen.findByRole('button', { name: 'Ship' }))
    const dialog = await screen.findByRole('dialog', { name: 'Ship WEB-000001' })
    await user.type(within(dialog).getByLabelText('Courier'), 'Pathao')
    await user.click(within(dialog).getByRole('button', { name: 'Mark as shipped' }))

    await waitFor(() => expect(body).toEqual({ courier_name: 'Pathao', tracking_number: null }))
    expect(key).toBeTruthy()
  })

  it('needs a reason to cancel and explains a stale order', async () => {
    const user = userEvent.setup()
    let calls = 0
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /web-orders/wo-1': ok(webOrder()),
      'POST /web-orders/wo-1/cancel': () => {
        calls += 1
        return fail(422, 'INVALID_STATUS_TRANSITION', 'Cannot cancel a shipped order.')
      },
    })
    renderRoutes(routes, '/web-orders/wo-1')

    await user.click(await screen.findByRole('button', { name: 'Cancel order' }))
    const dialog = await screen.findByRole('dialog', { name: 'Cancel WEB-000001?' })
    const submit = within(dialog).getByRole('button', { name: 'Cancel order' })
    expect(submit).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Reason'), 'Customer changed their mind')
    await user.click(submit)

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining('moved on since you opened it')))
    expect(calls).toBe(1)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it.each([
    ['ORDER_PAID', 'A paid order cannot be cancelled here; it needs a refund.'],
    ['ORDER_ALREADY_PAID', 'This order is already paid.'],
  ])('shows %s as a plain message', async (code, message) => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /web-orders/wo-1': ok(webOrder({ payment_method: 'cod', status: 'delivered', allowed_actions: ['record_cod_payment'] })),
      'POST /web-orders/wo-1/record-cod-payment': fail(422, code),
    })
    renderRoutes(routes, '/web-orders/wo-1')

    await user.click(await screen.findByRole('button', { name: 'Record COD payment' }))
    const dialog = await screen.findByRole('dialog', { name: 'Record cash on delivery for WEB-000001' })
    await user.click(within(dialog).getByRole('button', { name: 'Record payment' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(message))
  })

  it('keeps the idempotency key when a failed request is retried', async () => {
    const user = userEvent.setup()
    const keys: (string | null)[] = []
    let body: unknown
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /web-orders/wo-1': ok(webOrder({ status: 'confirmed', payment_method: 'cod', allowed_actions: ['process', 'cancel'] })),
      'POST /web-orders/wo-1/process': (init) => {
        keys.push(new Headers(init.headers).get('Idempotency-Key'))
        body = init.body
        return keys.length === 1 ? fail(503, 'SERVICE_UNAVAILABLE') : ok(webOrder({ status: 'processing', allowed_actions: ['ship', 'cancel'] }))
      },
    })
    renderRoutes(routes, '/web-orders/wo-1')

    await user.click(await screen.findByRole('button', { name: 'Start processing' }))
    const dialog = await screen.findByRole('dialog', { name: 'Start processing WEB-000001?' })
    await user.click(within(dialog).getByRole('button', { name: 'Start processing' }))
    await waitFor(() => expect(keys).toHaveLength(1))
    await user.click(within(dialog).getByRole('button', { name: 'Start processing' }))
    await waitFor(() => expect(keys).toHaveLength(2))
    expect(keys[0]).toBe(keys[1])
    expect(body).toBeUndefined()
  })
})

describe('new order notification', () => {
  it('opens the order from the notifications bell', async () => {
    const user = userEvent.setup()
    let read = false
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /web-orders': paged([]),
      'GET /web-orders/wo-1': ok(webOrder()),
      'GET /notifications/unread-count': () => ok({ count: read ? 0 : 1 }),
      'GET /notifications': ok([{ id: 'n-1', type: 'orders.web_order_placed', data: { title: 'New online order WEB-000001', message: 'BDT 1,560.00', url: '/web-orders/wo-1' }, read_at: null, created_at: '2026-10-31T04:30:00Z' }]),
      'POST /notifications/n-1/read': () => {
        read = true
        return ok(null)
      },
    })
    const { router } = renderRoutes(routes, '/web-orders')

    await user.click(await screen.findByRole('button', { name: 'Notifications (1 unread)' }))
    await user.click(await screen.findByRole('button', { name: /New online order WEB-000001/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/web-orders/wo-1'))
    expect(await screen.findByRole('heading', { name: 'WEB-000001' })).toBeInTheDocument()
    expect(read).toBe(true)
  })
})
