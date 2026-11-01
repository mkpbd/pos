import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import type { WebReturn } from '@/features/web-returns/api'
import { returnRow, returnsManager, returnsViewer, webReturn } from '@/features/web-returns/test-data'
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

const paged = (items: unknown[], meta: Record<string, unknown> = {}) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 }, ...meta })

describe('web returns list', () => {
  it('lists returns with status tabs and counts, filters by tab and search', async () => {
    const user = userEvent.setup()
    const queries: string[] = []
    mockApi({
      'GET /auth/me': ok(returnsViewer()),
      'GET /web-order-returns': (_init, url) => {
        queries.push(url.search)
        return paged([returnRow(), returnRow({ id: 'rt-2', number: 'RTN-WEB-000002', status: 'refunded', status_label: 'Refunded', customer_name: null, refund_amount: '150.50' })], {
          status_counts: { requested: 1, refunded: 1 },
        })
      },
    })
    renderRoutes(routes, '/web-returns')

    const table = await screen.findByRole('table', { name: 'Web returns' })
    expect(within(table).getByRole('link', { name: 'RTN-WEB-000001' })).toHaveAttribute('href', '/web-returns/rt-1')
    expect(within(table).getAllByRole('link', { name: 'WEB-000001' })[0]).toHaveAttribute('href', '/web-orders/wo-1')
    expect(within(table).getAllByText('Damaged')).toHaveLength(2)
    expect(within(table).getByText('BDT 150.50')).toBeInTheDocument()
    expect(within(table).getByText('Guest')).toBeInTheDocument()
    expect(screen.getByTestId('count-all')).toHaveTextContent('2')
    expect(screen.getByTestId('count-requested')).toHaveTextContent('1')

    await user.click(screen.getByRole('tab', { name: /Approved/ }))
    await waitFor(() => expect(queries.at(-1)).toContain('status=approved'))
    await user.type(screen.getByLabelText('Search web returns'), 'RTN-WEB')
    await waitFor(() => expect(queries.at(-1)).toContain('search=RTN-WEB'))
  })

  it('says so when there are no returns', async () => {
    mockApi({ 'GET /auth/me': ok(returnsViewer()), 'GET /web-order-returns': paged([]) })
    renderRoutes(routes, '/web-returns')
    expect(await screen.findByText('No web returns yet')).toBeInTheDocument()
  })

  it('is in the navigation for order viewers, after web orders', async () => {
    mockApi({ 'GET /auth/me': ok(returnsViewer()), 'GET /web-order-returns': paged([]), 'GET /notifications/unread-count': ok({ count: 0 }) })
    renderRoutes(routes, '/web-returns')
    const link = await screen.findByRole('link', { name: 'Web returns' })
    expect(link).toHaveAttribute('href', '/web-returns')
  })
})

describe('web return page', () => {
  it('shows the return read-only to viewers', async () => {
    mockApi({ 'GET /auth/me': ok(returnsViewer()), 'GET /web-order-returns/rt-1': ok(webReturn()) })
    renderRoutes(routes, '/web-returns/rt-1')

    expect(await screen.findByRole('heading', { name: 'RTN-WEB-000001' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Return actions' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Bottle cracked').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'WEB-000001' })).toHaveAttribute('href', '/web-orders/wo-1')
    expect(screen.getByTestId('refund-amount')).toHaveTextContent('BDT 200.00')
    expect(within(screen.getByRole('table', { name: 'Returned items' })).getByText('Baby Romper — Size M')).toBeInTheDocument()
  })

  it('approves with a lowered quantity, a delivery refund and a note', async () => {
    const user = userEvent.setup()
    let body: unknown
    let key: string | null = null
    let current: WebReturn = webReturn()
    mockApi({
      'GET /auth/me': ok(returnsManager()),
      'GET /web-order-returns/rt-1': () => ok(current),
      'POST /web-order-returns/rt-1/approve': (init) => {
        body = JSON.parse(String(init.body))
        key = new Headers(init.headers).get('Idempotency-Key')
        current = webReturn({ status: 'approved', status_label: 'Approved', refund_amount: '130.00', shipping_refund: '30.00', staff_note: 'Courier damage' })
        return ok(current)
      },
    })
    renderRoutes(routes, '/web-returns/rt-1')

    const actions = await screen.findByRole('group', { name: 'Return actions' })
    expect(within(actions).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Approve', 'Reject'])
    await user.click(within(actions).getByRole('button', { name: 'Approve' }))
    const dialog = await screen.findByRole('dialog', { name: 'Approve RTN-WEB-000001' })
    const qty = within(dialog).getByLabelText('Mango Juice')
    await user.clear(qty)
    await user.type(qty, '3')
    expect(within(dialog).getByText('At most 2.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Approve return' })).toBeDisabled()
    await user.clear(qty)
    await user.type(qty, '1')
    await user.type(within(dialog).getByLabelText('Delivery charge to refund (optional)'), '61')
    expect(within(dialog).getByText(/Cannot be more than the delivery charge/)).toBeInTheDocument()
    await user.clear(within(dialog).getByLabelText('Delivery charge to refund (optional)'))
    await user.type(within(dialog).getByLabelText('Delivery charge to refund (optional)'), '30.00')
    await user.type(within(dialog).getByLabelText('Note (optional)'), 'Courier damage')
    await user.click(within(dialog).getByRole('button', { name: 'Approve return' }))

    await waitFor(() =>
      expect(body).toEqual({
        lines: [{ order_line_id: 'ol-1', quantity: '1' }, { order_line_id: 'ol-2', quantity: '1' }],
        shipping_refund: '30.00',
        note: 'Courier damage',
      }),
    )
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
    expect(toastSuccess).toHaveBeenCalledWith('RTN-WEB-000001 approved. The customer has been told.')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('refund-amount')).toHaveTextContent('BDT 130.00')
    expect(within(screen.getByRole('group', { name: 'Return actions' })).getByRole('button', { name: 'Receive goods' })).toBeInTheDocument()
  })

  it('rejects with a reason', async () => {
    const user = userEvent.setup()
    let body: unknown
    let current: WebReturn = webReturn()
    mockApi({
      'GET /auth/me': ok(returnsManager()),
      'GET /web-order-returns/rt-1': () => ok(current),
      'POST /web-order-returns/rt-1/reject': (init) => {
        body = JSON.parse(String(init.body))
        current = webReturn({ status: 'rejected', status_label: 'Rejected', rejection_reason: 'Used item' })
        return ok(current)
      },
    })
    renderRoutes(routes, '/web-returns/rt-1')

    await user.click(await screen.findByRole('button', { name: 'Reject' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reject RTN-WEB-000001?' })
    expect(within(dialog).getByRole('button', { name: 'Reject return' })).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Reason'), ' Used item ')
    await user.click(within(dialog).getByRole('button', { name: 'Reject return' }))

    await waitFor(() => expect(body).toEqual({ reason: 'Used item' }))
    expect(await screen.findByRole('note')).toHaveTextContent('Rejected: Used item')
  })

  it('receives with a restock decision per line', async () => {
    const user = userEvent.setup()
    let body: unknown
    let current: WebReturn = webReturn({ status: 'approved', status_label: 'Approved' })
    mockApi({
      'GET /auth/me': ok(returnsManager()),
      'GET /web-order-returns/rt-1': () => ok(current),
      'POST /web-order-returns/rt-1/receive': (init) => {
        body = JSON.parse(String(init.body))
        current = webReturn({
          status: 'received', status_label: 'Received',
          lines: webReturn().lines.map((l) => (l.order_line_id === 'ol-1' ? { ...l, restock: true, restocked_quantity: '2.000' } : { ...l, restock: false, restocked_quantity: '0.000' })),
        })
        return ok(current)
      },
    })
    renderRoutes(routes, '/web-returns/rt-1')

    await user.click(await screen.findByRole('button', { name: 'Receive goods' }))
    const dialog = await screen.findByRole('dialog', { name: 'Receive goods for RTN-WEB-000001' })
    expect(within(dialog).getByRole('checkbox', { name: /Restock Mango Juice/ })).toBeChecked()
    await user.click(within(dialog).getByRole('checkbox', { name: /Restock Baby Romper — Size M/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Mark received' }))

    await waitFor(() => expect(body).toEqual({ lines: [{ order_line_id: 'ol-1', restock: true }, { order_line_id: 'ol-2', restock: false }] }))
    await waitFor(() => expect(screen.getAllByTestId('line-stock').map((c) => c.textContent)).toEqual(['Restocked 2', 'Written off']))
    expect(screen.getByRole('button', { name: 'Record refund' })).toBeInTheDocument()
  })

  it('records the refund with method and reference, reusing the key on a retry', async () => {
    const user = userEvent.setup()
    const keys: (string | null)[] = []
    const bodies: unknown[] = []
    let current: WebReturn = webReturn({ status: 'received', status_label: 'Received' })
    mockApi({
      'GET /auth/me': ok(returnsManager()),
      'GET /web-order-returns/rt-1': () => ok(current),
      'POST /web-order-returns/rt-1/refund': (init) => {
        keys.push(new Headers(init.headers).get('Idempotency-Key'))
        bodies.push(JSON.parse(String(init.body)))
        if (keys.length === 1) return fail(503, 'SERVICE_UNAVAILABLE', 'Try again')
        current = webReturn({ status: 'refunded', status_label: 'Refunded', refund_method: 'mobile_banking', refund_reference: 'BK-991', refunded_at: '2026-11-01T08:00:00Z', refunded_by: { id: 'u-1', name: 'Rahim Uddin' } })
        return ok(current)
      },
    })
    renderRoutes(routes, '/web-returns/rt-1')

    await user.click(await screen.findByRole('button', { name: 'Record refund' }))
    const dialog = await screen.findByRole('dialog', { name: 'Record refund for RTN-WEB-000001' })
    expect(within(dialog).getByTestId('refund-due')).toHaveTextContent('BDT 200.00')
    await user.click(within(dialog).getByLabelText('Paid back by'))
    await user.click(await screen.findByRole('option', { name: 'Mobile banking' }))
    await user.type(within(dialog).getByLabelText('Reference (optional)'), 'BK-991')
    await user.click(within(dialog).getByRole('button', { name: 'Record refund' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Try again'))
    await user.click(within(dialog).getByRole('button', { name: 'Record refund' }))

    await waitFor(() => expect(keys).toHaveLength(2))
    expect(keys[0]).toBe(keys[1])
    expect(bodies[1]).toEqual({ method: 'mobile_banking', reference: 'BK-991' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText(/Mobile banking/)).toBeInTheDocument()
    expect(screen.getByText(/BK-991/)).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Return actions' })).not.toBeInTheDocument()
  })

  it('closes the dialog and explains when the return moved on', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(returnsManager()),
      'GET /web-order-returns/rt-1': ok(webReturn()),
      'POST /web-order-returns/rt-1/approve': fail(409, 'INVALID_STATUS_TRANSITION', 'nope'),
    })
    renderRoutes(routes, '/web-returns/rt-1')

    await user.click(await screen.findByRole('button', { name: 'Approve' }))
    const dialog = await screen.findByRole('dialog', { name: 'Approve RTN-WEB-000001' })
    await user.click(within(dialog).getByRole('button', { name: 'Approve return' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/moved on/)))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
