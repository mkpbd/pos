import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import type { WebOrder } from '@/features/web-orders/api'
import { webOrder } from '@/features/web-orders/test-data'
import { returnsManager, returnsViewer, webReturn } from '@/features/web-returns/test-data'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: toastError, success: toastSuccess, message: vi.fn() }) }
})

beforeEach(() => {
  toastSuccess.mockReset()
  toastError.mockReset()
})

const future = '2099-01-01T00:00:00Z'
const past = '2020-01-01T00:00:00Z'

const delivered = (overrides: Partial<WebOrder> = {}): WebOrder =>
  webOrder({
    status: 'delivered', status_label: 'Delivered', payment_status: 'paid', payment_method: 'cod', allowed_actions: ['create_return'],
    delivered_at: '2026-10-30T10:00:00Z', return_deadline: future,
    lines: [
      { id: 'ol-1', product_name: 'Mango Juice', variant_name: null, sku: 'MJ-1', image_url: null, quantity: '2.000', unit_price: '100.00', line_total: '200.00', discount_amount: '0.00', returnable_quantity: '2.000' },
      { id: 'ol-2', product_name: 'Baby Romper', variant_name: 'Size M', sku: 'ROMP-M', image_url: null, quantity: '1.000', unit_price: '750.00', line_total: '750.00', discount_amount: '0.00', returnable_quantity: '0.000' },
    ],
    returns: [{ id: 'rt-0', number: 'RTN-WEB-000009', status: 'refunded', status_label: 'Refunded', refund_amount: '750.00', created_at: '2026-10-31T10:00:00Z' }],
    ...overrides,
  })

describe('returns on the web order page', () => {
  it('lists the order returns and hides "Create return" without web_orders.refund', async () => {
    mockApi({
      'GET /auth/me': ok(returnsViewer()),
      'GET /web-orders/wo-1': ok(delivered({
        refunded_total: '750.00',
        payments: [
          { direction: 'in', method: 'cash', method_label: 'Cash', amount: '1010.00', reference: null, recorded_at: '2026-10-30T10:00:00Z', recorded_by: null },
          { direction: 'out', method: 'mobile_banking', method_label: 'Mobile banking', amount: '750.00', reference: 'BK-1', recorded_at: '2026-10-31T10:00:00Z', recorded_by: null },
        ],
      })),
    })
    renderRoutes(routes, '/web-orders/wo-1')

    const card = await screen.findByRole('region', { name: 'Returns' })
    expect(within(card).getByRole('link', { name: 'RTN-WEB-000009' })).toHaveAttribute('href', '/web-returns/rt-0')
    expect(within(card).getByText('Refunded')).toBeInTheDocument()
    expect(within(card).getByText('BDT 750.00')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Create return' })).not.toBeInTheDocument()
    expect(screen.getByTestId('order-refunded')).toHaveTextContent('Refunded BDT 750.00 on returns.')
    expect(screen.getByTestId('payment-refund')).toHaveTextContent('−BDT 750.00')
    expect(screen.getByText(/Refund · Mobile banking/)).toBeInTheDocument()
  })

  it('shows no returns card on an order that cannot be returned and has none', async () => {
    mockApi({ 'GET /auth/me': ok(returnsManager()), 'GET /web-orders/wo-1': ok(webOrder()) })
    renderRoutes(routes, '/web-orders/wo-1')
    expect(await screen.findByRole('heading', { name: 'WEB-000001' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Returns' })).not.toBeInTheDocument()
  })

  it('creates a staff return for the returnable lines and opens it', async () => {
    const user = userEvent.setup()
    let body: unknown
    let key: string | null = null
    mockApi({
      'GET /auth/me': ok(returnsManager()),
      'GET /web-orders/wo-1': ok(delivered()),
      'POST /web-orders/wo-1/returns': (init) => {
        body = JSON.parse(String(init.body))
        key = new Headers(init.headers).get('Idempotency-Key')
        return { status: 201, body: { success: true, data: webReturn({ requested_by: 'staff' }), meta: { request_id: 't' } } }
      },
      'GET /web-order-returns/rt-1': ok(webReturn({ requested_by: 'staff' })),
    })
    const { router } = renderRoutes(routes, '/web-orders/wo-1')

    await user.click(await screen.findByRole('button', { name: 'Create return' }))
    const dialog = await screen.findByRole('dialog', { name: 'Create a return for WEB-000001' })
    // Fully returned lines are not offered.
    expect(within(dialog).queryByLabelText('Baby Romper — Size M')).not.toBeInTheDocument()
    const submit = within(dialog).getByRole('button', { name: 'Create return' })
    expect(submit).toBeDisabled()
    const qty = within(dialog).getByLabelText('Mango Juice')
    await user.clear(qty)
    await user.type(qty, '2')
    await user.click(within(dialog).getByLabelText('Reason'))
    await user.click(await screen.findByRole('option', { name: 'Damaged' }))
    await user.type(within(dialog).getByLabelText('Note (optional)'), 'Called in')
    await user.click(submit)

    await waitFor(() => expect(body).toEqual({ reason_code: 'damaged', note: 'Called in', lines: [{ order_line_id: 'ol-1', quantity: '2' }] }))
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
    expect(toastSuccess).toHaveBeenCalledWith('Return RTN-WEB-000001 created.')
    await waitFor(() => expect(router.state.location.pathname).toBe('/web-returns/rt-1'))
  })

  it('needs the override and a note once the window has closed', async () => {
    const user = userEvent.setup()
    let body: unknown
    mockApi({
      'GET /auth/me': ok(returnsManager()),
      'GET /web-orders/wo-1': ok(delivered({ return_deadline: past })),
      'POST /web-orders/wo-1/returns': (init) => {
        body = JSON.parse(String(init.body))
        return ok(webReturn())
      },
      'GET /web-order-returns/rt-1': ok(webReturn()),
    })
    renderRoutes(routes, '/web-orders/wo-1')

    expect(await screen.findByText(/Customer return window closed/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create return' }))
    const dialog = await screen.findByRole('dialog', { name: 'Create a return for WEB-000001' })
    const override = within(dialog).getByRole('checkbox', { name: /Accept after the return window/ })
    expect(override).toBeChecked()
    const qty = within(dialog).getByLabelText('Mango Juice')
    await user.clear(qty)
    await user.type(qty, '1')
    await user.click(within(dialog).getByLabelText('Reason'))
    await user.click(await screen.findByRole('option', { name: 'Changed mind' }))
    const submit = within(dialog).getByRole('button', { name: 'Create return' })
    expect(submit).toBeDisabled()
    await user.click(override)
    expect(submit).toBeDisabled()
    await user.click(override)
    await user.type(within(dialog).getByLabelText('Note (required for an override)'), 'Manager approved')
    await user.click(submit)

    await waitFor(() =>
      expect(body).toEqual({ reason_code: 'changed_mind', note: 'Manager approved', lines: [{ order_line_id: 'ol-1', quantity: '1' }], override_window: true }),
    )
  })

  it('requires the override when the server says customers can no longer return', async () => {
    const user = userEvent.setup()
    mockApi({ 'GET /auth/me': ok(returnsManager()), 'GET /web-orders/wo-1': ok(delivered({ return_deadline: null, return_window_open: false })) })
    renderRoutes(routes, '/web-orders/wo-1')

    await user.click(await screen.findByRole('button', { name: 'Create return' }))
    const dialog = await screen.findByRole('dialog', { name: 'Create a return for WEB-000001' })
    expect(within(dialog).getByText(/Customers can no longer return this order\./)).toBeInTheDocument()
    expect(within(dialog).getByRole('checkbox', { name: /Accept after the return window/ })).toBeChecked()
  })

  it('explains a closed window reported by the server inside the dialog', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(returnsManager()),
      'GET /web-orders/wo-1': ok(delivered({ return_deadline: null })),
      'POST /web-orders/wo-1/returns': fail(422, 'RETURN_NOT_ALLOWED', 'Not allowed', { reason: 'window_closed' }),
    })
    renderRoutes(routes, '/web-orders/wo-1')

    await user.click(await screen.findByRole('button', { name: 'Create return' }))
    const dialog = await screen.findByRole('dialog', { name: 'Create a return for WEB-000001' })
    await user.clear(within(dialog).getByLabelText('Mango Juice'))
    await user.type(within(dialog).getByLabelText('Mango Juice'), '1')
    await user.click(within(dialog).getByLabelText('Reason'))
    await user.click(await screen.findByRole('option', { name: 'Other' }))
    await user.click(within(dialog).getByRole('button', { name: 'Create return' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/return window for this order has closed/)
  })
})
