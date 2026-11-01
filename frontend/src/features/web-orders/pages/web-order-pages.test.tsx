import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import type { WebOrder } from '@/features/web-orders/api'
import { couriers, orderManager, orderViewer, shipment, webOrder } from '@/features/web-orders/test-data'
import { makeCurrentUser } from '@/test/fixtures'
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

  it('ships with an active courier, tracking number and note, then shows the shipment', async () => {
    const user = userEvent.setup()
    let body: unknown
    let key: string | null = null
    let current: WebOrder = webOrder({ status: 'processing', status_label: 'Processing', payment_method: 'cod', payment_method_label: 'Cash on delivery', allowed_actions: ['ship', 'cancel'] })
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /web-orders/wo-1': () => ok(current),
      'GET /shipping/couriers': ok(couriers()),
      'POST /web-orders/wo-1/ship': (init) => {
        body = JSON.parse(String(init.body))
        key = new Headers(init.headers).get('Idempotency-Key')
        current = webOrder({ status: 'shipped', status_label: 'Shipped', payment_method: 'cod', courier_name: 'Pathao', tracking_number: 'PT 123', shipment: shipment(), allowed_actions: ['deliver', 'record_cod_payment'] })
        return ok(current)
      },
    })
    renderRoutes(routes, '/web-orders/wo-1')

    await user.click(await screen.findByRole('button', { name: 'Ship' }))
    const dialog = await screen.findByRole('dialog', { name: 'Ship WEB-000001' })
    expect(within(dialog).getByText(/collects BDT 1,560.00 on delivery/)).toBeInTheDocument()
    const submit = within(dialog).getByRole('button', { name: 'Mark as shipped' })
    expect(submit).toBeDisabled()
    await user.click(await within(dialog).findByLabelText('Courier'))
    expect(screen.queryByRole('option', { name: 'RedX' })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('option', { name: 'Pathao' }))
    await user.type(within(dialog).getByLabelText('Tracking number (optional)'), ' PT 123 ')
    await user.type(within(dialog).getByLabelText('Note (optional)'), '2 parcels')
    await user.click(submit)

    await waitFor(() => expect(body).toEqual({ courier_id: 'c-1', tracking_number: 'PT 123', note: '2 parcels' }))
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
    const card = await screen.findByTestId('shipment-card')
    expect(within(card).getByRole('link', { name: /Track parcel/ })).toHaveAttribute('href', 'https://merchant.pathao.com/tracking?consignment_id=PT%20123')
    expect(within(card).getByRole('link', { name: /Track parcel/ })).toHaveAttribute('rel', 'noopener noreferrer')
    expect(within(card).getByTestId('shipment-cod')).toHaveTextContent('BDT 1,560.00')
    expect(within(within(card).getByRole('list', { name: 'Tracking updates' })).getByText('Handed to courier')).toBeInTheDocument()
  })

  it('points to the couriers settings when no courier is active', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /web-orders/wo-1': ok(webOrder({ status: 'processing', allowed_actions: ['ship'] })),
      'GET /shipping/couriers': ok([{ ...couriers()[2] }]),
    })
    renderRoutes(routes, '/web-orders/wo-1')

    await user.click(await screen.findByRole('button', { name: 'Ship' }))
    const dialog = await screen.findByRole('dialog', { name: 'Ship WEB-000001' })
    expect(await within(dialog).findByRole('link', { name: 'Add a courier' })).toHaveAttribute('href', '/storefront/shipping/couriers')
    expect(within(dialog).getByRole('button', { name: 'Mark as shipped' })).toBeDisabled()
  })

  it('records a tracking update with a note and an idempotency key', async () => {
    const user = userEvent.setup()
    let body: unknown
    let key: string | null = null
    let current: WebOrder = webOrder({ status: 'shipped', payment_method: 'cod', shipment: shipment(), allowed_actions: ['deliver', 'add_shipment_event'] as WebOrder['allowed_actions'] })
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /web-orders/wo-1': () => ok(current),
      'POST /web-orders/wo-1/shipment/events': (init) => {
        body = JSON.parse(String(init.body))
        key = new Headers(init.headers).get('Idempotency-Key')
        current = webOrder({
          status: 'shipped', payment_method: 'cod', allowed_actions: ['cancel'],
          shipment: shipment({ status: 'returned', returned_at: '2026-11-01T08:00:00Z', events: [...shipment().events, { id: 'ev-2', status: 'returned', note: 'Customer refused', occurred_at: '2026-11-01T08:00:00Z', created_by: 'Rahim Uddin' }] }),
        })
        return ok(current)
      },
    })
    renderRoutes(routes, '/web-orders/wo-1')

    await user.click(await screen.findByRole('button', { name: 'Add tracking update' }))
    const dialog = await screen.findByRole('dialog', { name: 'Tracking update for WEB-000001' })
    const submit = within(dialog).getByRole('button', { name: 'Record update' })
    expect(submit).toBeDisabled()
    await user.click(within(dialog).getByRole('radio', { name: /Returned to sender/ }))
    await user.type(within(dialog).getByLabelText('Note (optional)'), 'Customer refused')
    await user.click(submit)

    await waitFor(() => expect(body).toEqual({ status: 'returned', note: 'Customer refused' }))
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
    expect(toastSuccess).toHaveBeenCalledWith('WEB-000001: returned to sender recorded.')
    const card = await screen.findByTestId('shipment-card')
    await waitFor(() => expect(within(card).getByRole('note')).toHaveTextContent('Cancel the order to put its items back into stock.'))
    expect(within(card).getByText('Customer refused')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Add tracking update' })).not.toBeInTheDocument()

    // Cancel is offered for the returned parcel and explains the exact restock.
    await user.click(within(screen.getByRole('group', { name: 'Order actions' })).getByRole('button', { name: 'Cancel order' }))
    expect(await screen.findByRole('dialog', { name: 'Cancel WEB-000001?' })).toHaveTextContent('The parcel came back to you.')
  })

  it('hides tracking updates from viewers and keeps legacy courier text for orders without a shipment', async () => {
    mockApi({
      'GET /auth/me': ok(orderViewer()),
      'GET /web-orders/wo-1': ok(webOrder({ status: 'shipped', shipment: shipment(), allowed_actions: [] })),
    })
    renderRoutes(routes, '/web-orders/wo-1')
    expect(await screen.findByTestId('shipment-card')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add tracking update' })).not.toBeInTheDocument()
  })

  it('shows the legacy courier line of an order shipped before couriers existed', async () => {
    mockApi({
      'GET /auth/me': ok(orderViewer()),
      'GET /web-orders/wo-1': ok(webOrder({ status: 'delivered', courier_name: 'Pathao', tracking_number: 'DEMO-TRK-0001', shipment: null, allowed_actions: [] })),
    })
    renderRoutes(routes, '/web-orders/wo-1')
    expect(await screen.findByText('Tracking DEMO-TRK-0001')).toBeInTheDocument()
    expect(screen.queryByTestId('shipment-card')).not.toBeInTheDocument()
  })

  it('links the courier remittance that paid the order for staff who may see remittances', async () => {
    mockApi({
      'GET /auth/me': ok(makeCurrentUser({ permissions: ['web_orders.view', 'web_orders.remit'] })),
      'GET /web-orders/wo-1': ok(webOrder({
        status: 'delivered', payment_status: 'paid', payment_method: 'cod', allowed_actions: [],
        shipment: shipment({ status: 'delivered' }), cod_remittance: { id: 'rem-1', number: 'REM-000001', received_at: '2026-11-01' },
      })),
    })
    renderRoutes(routes, '/web-orders/wo-1')
    expect(await screen.findByRole('link', { name: 'REM-000001' })).toHaveAttribute('href', '/cod-remittances/rem-1')
    expect(within(screen.getByRole('list', { name: 'Tracking updates' })).getByText(/Rahim Uddin/)).toBeInTheDocument()
  })

  it('links to the packing slip and invoice of the order', async () => {
    mockApi({ 'GET /auth/me': ok(orderViewer()), 'GET /web-orders/wo-1': ok(webOrder()) })
    renderRoutes(routes, '/web-orders/wo-1')
    const print = await screen.findByRole('group', { name: 'Print' })
    expect(within(print).getByRole('link', { name: /Packing slip/ })).toHaveAttribute('href', '/web-orders/print?ids=wo-1&kind=packing_slip')
    expect(within(print).getByRole('link', { name: /Invoice/ })).toHaveAttribute('href', '/web-orders/print?ids=wo-1&kind=invoice')
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
    ['ORDER_PAID', 'A paid order can only be cancelled together with a refund, by someone allowed to refund web orders.'],
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
