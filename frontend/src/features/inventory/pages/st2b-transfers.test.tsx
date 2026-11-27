import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { branchesWithStores, makeCurrentUser, STOCK_MANAGER_PERMISSIONS, stockManager } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

/** ST2b: receiving short / damaged, transfer requests (dispatch / reject / cancel), challan. */

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })
const store = (id: string, name: string, branch = 'b-1') => ({ id, code: id.toUpperCase(), name, branch_id: branch, branch_name: branch === 'b-1' ? 'Main Branch' : 'North' })

const juice = { id: 'v-1', product_id: 'p-1', product_name: 'Mango Juice 1L', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', track_batches: false, allow_decimal: false }
const phone = { ...juice, id: 'v-2', product_name: 'Phone X', sku: 'PHONE-X', track_serials: true }
const milk = { ...juice, id: 'v-3', product_name: 'Milk 1L', sku: 'MILK', track_batches: true }

const transfer = {
  id: 't-1', number: 'TRF-000001', status: 'in_transit', from_store: store('s-2', 'Warehouse'), to_store: store('s-1', 'Shop floor'),
  note: null, can_receive: true, can_cancel: false, dispatched_at: '2026-11-25T08:00:00Z', completed_at: null,
  lines: [
    { id: 'l-1', variant: juice, batch: null, quantity: '10.000', unit_cost: '20.0000' },
    { id: 'l-2', variant: phone, batch: null, quantity: '2.000', unit_cost: '900.0000' },
  ],
}

const request = {
  id: 't-2', number: 'TRF-000002', status: 'requested', from_store: store('s-3', 'North store', 'b-2'), to_store: store('s-1', 'Shop floor'),
  note: 'For the weekend', can_receive: false, can_cancel: false, can_dispatch: true, can_reject: true, dispatched_at: null, completed_at: null,
  requested_at: '2026-11-26T09:00:00Z', requested_by: { id: 'u-9', name: 'Karim' },
  lines: [
    { id: 'r-1', variant: juice, batch: null, quantity: '12.000', requested_quantity: '12.000', unit_cost: null },
    { id: 'r-2', variant: milk, batch: null, quantity: '5.000', requested_quantity: '5.000', unit_cost: null },
  ],
}

describe('TransferPage — receive short / damaged', () => {
  it('shows the short quantity live, keeps serial lines full, posts per line and then shows the discrepancy and loss', async () => {
    const user = userEvent.setup()
    let current: Record<string, unknown> = transfer
    let posted: { lines: Record<string, unknown>[] } | undefined
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /inventory/transfers/t-1': () => ok(current),
      'POST /inventory/transfers/t-1/receive': (init) => {
        posted = JSON.parse(String(init.body))
        current = {
          ...transfer, status: 'received', can_receive: false, completed_at: '2026-11-26T10:00:00Z', loss_total: '80.00', has_discrepancy: true,
          lines: [
            { ...transfer.lines[0], received_quantity: '6.000', damaged_quantity: '1.000', short_quantity: '3.000', receive_note: 'Box torn' },
            { ...transfer.lines[1], received_quantity: '2.000', damaged_quantity: '0.000', short_quantity: '0.000', receive_note: null },
          ],
        }
        return ok(current)
      },
    })
    renderRoutes(routes, '/inventory/transfers/t-1')

    await user.click(await screen.findByRole('button', { name: 'Receive' }))
    const dialog = await screen.findByRole('dialog', { name: 'Receive TRF-000001' })
    expect(within(dialog).getByLabelText('Received of line 1')).toHaveValue('10')
    expect(within(dialog).getByLabelText('Short of line 1')).toHaveTextContent('0')
    expect(within(dialog).getByLabelText('Received of line 2')).toBeDisabled()
    expect(within(dialog).getByLabelText('Damaged of line 2')).toBeDisabled()

    await user.clear(within(dialog).getByLabelText('Received of line 1'))
    await user.type(within(dialog).getByLabelText('Received of line 1'), '6')
    await user.clear(within(dialog).getByLabelText('Damaged of line 1'))
    await user.type(within(dialog).getByLabelText('Damaged of line 1'), '1')
    expect(within(dialog).getByLabelText('Short of line 1')).toHaveTextContent('3')
    await user.type(within(dialog).getByLabelText('Note of line 1'), 'Box torn')
    await user.click(within(dialog).getByRole('button', { name: 'Receive goods' }))

    await waitFor(() => expect(posted).toBeDefined())
    expect(posted?.lines).toEqual([
      { line_id: 'l-1', received_quantity: '6', damaged_quantity: '1', note: 'Box torn' },
      { line_id: 'l-2', received_quantity: '2', damaged_quantity: '0', note: null },
    ])
    expect(await screen.findByText('Discrepancy')).toBeInTheDocument()
    expect(screen.getByTestId('loss-total')).toHaveTextContent('80.00')
    const row = screen.getByRole('row', { name: /Mango Juice 1L/ })
    expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual(expect.arrayContaining(['6', '1', '3', 'Box torn']))
  })

  it('refuses more than was sent and shows server errors inline', async () => {
    const user = userEvent.setup()
    let calls = 0
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /inventory/transfers/t-1': ok(transfer),
      'POST /inventory/transfers/t-1/receive': () => {
        calls += 1
        return fail(422, 'VALIDATION_FAILED', 'The given data was invalid.', { 'lines.0.damaged_quantity': ['Damaged is too high.'] })
      },
    })
    renderRoutes(routes, '/inventory/transfers/t-1')

    await user.click(await screen.findByRole('button', { name: 'Receive' }))
    const dialog = await screen.findByRole('dialog')
    await user.clear(within(dialog).getByLabelText('Damaged of line 1'))
    await user.type(within(dialog).getByLabelText('Damaged of line 1'), '2')
    expect(within(dialog).getByLabelText('Short of line 1')).toHaveTextContent('-2')
    await user.click(within(dialog).getByRole('button', { name: 'Receive goods' }))
    expect(await within(dialog).findByText('Received and damaged add up to more than the 10 sent.')).toBeInTheDocument()
    expect(calls).toBe(0)

    await user.clear(within(dialog).getByLabelText('Damaged of line 1'))
    await user.type(within(dialog).getByLabelText('Damaged of line 1'), '0')
    await user.click(within(dialog).getByRole('button', { name: 'Receive goods' }))
    expect(await within(dialog).findByText('Damaged is too high.')).toBeInTheDocument()
    expect(calls).toBe(1)
  })

  it('downloads the delivery challan', async () => {
    const user = userEvent.setup()
    const fetchMock = mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /inventory/transfers/t-1': ok(transfer),
    })
    renderRoutes(routes, '/inventory/transfers/t-1')

    await user.click(await screen.findByRole('button', { name: 'Print challan' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/inventory/transfers/t-1/challan.pdf'))).toBe(true))
  })
})

describe('TransferPage — requests', () => {
  it('dispatches a request with reduced quantities and an automatic batch', async () => {
    const user = userEvent.setup()
    let posted: { lines: Record<string, unknown>[] } | undefined
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /inventory/transfers/t-2': ok(request),
      'GET /inventory/batches': ok([{ store: request.from_store, variant: null, batch: { id: 'bt-1', batch_number: 'M-1', expires_on: '2026-12-31' }, quantity: '9.000', is_expired: false }]),
      'POST /inventory/transfers/t-2/dispatch': (init) => {
        posted = JSON.parse(String(init.body))
        return ok({ ...request, status: 'in_transit', dispatched_at: '2026-11-26T11:00:00Z' })
      },
    })
    renderRoutes(routes, '/inventory/transfers/t-2')

    expect(await screen.findByRole('heading', { name: 'TRF-000002' })).toBeInTheDocument()
    expect(screen.getByText(/Nothing has moved yet/)).toBeInTheDocument()
    expect(screen.getByText(/Karim/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Print challan' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Dispatch' }))
    const dialog = await screen.findByRole('dialog', { name: 'Dispatch TRF-000002' })
    expect(within(dialog).getByLabelText('Send of line 1')).toHaveValue('12')
    expect(within(dialog).getByRole('combobox', { name: 'Batch of line 2' })).toHaveTextContent('Earliest expiry first')

    await user.clear(within(dialog).getByLabelText('Send of line 1'))
    await user.type(within(dialog).getByLabelText('Send of line 1'), '13')
    await user.click(within(dialog).getByRole('button', { name: 'Dispatch goods' }))
    expect(await within(dialog).findByText('At most the 12 requested.')).toBeInTheDocument()

    await user.clear(within(dialog).getByLabelText('Send of line 1'))
    await user.type(within(dialog).getByLabelText('Send of line 1'), '8')
    await user.click(within(dialog).getByRole('button', { name: 'Dispatch goods' }))
    await waitFor(() => expect(posted).toEqual({ lines: [{ line_id: 'r-1', quantity: '8' }, { line_id: 'r-2', quantity: '5' }] }))
  })

  it('shows a dispatch error such as insufficient stock in the dialog', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /inventory/transfers/t-2': ok(request),
      'GET /inventory/batches': ok([]),
      'POST /inventory/transfers/t-2/dispatch': fail(422, 'INSUFFICIENT_STOCK', 'Not enough Mango Juice 1L in North store.'),
    })
    renderRoutes(routes, '/inventory/transfers/t-2')

    await user.click(await screen.findByRole('button', { name: 'Dispatch' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Dispatch goods' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Not enough Mango Juice 1L in North store.')
  })

  it('rejects a request with a reason', async () => {
    const user = userEvent.setup()
    let posted: unknown
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /inventory/transfers/t-2': ok(request),
      'POST /inventory/transfers/t-2/reject': (init) => {
        posted = JSON.parse(String(init.body))
        return ok({ ...request, status: 'rejected', rejection_reason: 'No stock to spare', rejected_at: '2026-11-26T12:00:00Z' })
      },
    })
    renderRoutes(routes, '/inventory/transfers/t-2')

    await user.click(await screen.findByRole('button', { name: 'Reject' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reject TRF-000002' })
    await user.type(within(dialog).getByLabelText('Reason'), 'No stock to spare')
    await user.click(within(dialog).getByRole('button', { name: 'Reject request' }))
    await waitFor(() => expect(posted).toEqual({ reason: 'No stock to spare' }))
  })

  it('lets the requester cancel, and hides dispatch / reject from them', async () => {
    const user = userEvent.setup()
    let cancelled = false
    const requester = makeCurrentUser({ permissions: STOCK_MANAGER_PERMISSIONS, branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }] })
    const mine = { ...request, can_dispatch: undefined, can_reject: undefined, can_cancel: true }
    mockApi({
      'GET /auth/me': ok(requester),
      'GET /inventory/transfers/t-2': ok(mine),
      'POST /inventory/transfers/t-2/cancel': () => {
        cancelled = true
        return ok({ ...mine, status: 'cancelled', can_cancel: false })
      },
    })
    renderRoutes(routes, '/inventory/transfers/t-2')

    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Dispatch' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument()
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('The request is withdrawn. No stock has moved.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel request' }))
    await waitFor(() => expect(cancelled).toBe(true))
  })

  it('shows why a request was rejected', async () => {
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /inventory/transfers/t-2': ok({ ...request, status: 'rejected', can_dispatch: false, can_reject: false, rejection_reason: 'No stock to spare', rejected_by: { id: 'u-3', name: 'Salma' }, rejected_at: '2026-11-26T12:00:00Z' }),
    })
    renderRoutes(routes, '/inventory/transfers/t-2')

    expect(await screen.findByText('No stock to spare')).toBeInTheDocument()
    expect(screen.getByText(/Request rejected by Salma/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dispatch' })).not.toBeInTheDocument()
  })
})

describe('Transfer requests and list', () => {
  it('requests stock from another store and opens the request', async () => {
    const user = userEvent.setup()
    let posted: Record<string, unknown> | undefined
    const product = {
      id: 'p-1', name: 'Mango Juice 1L', type: 'standard', track_stock: true, track_batches: false, is_active: true,
      unit: { id: 'un-1', name: 'Piece', code: 'pcs', allow_decimal: false }, tax_rate: null,
      variants: [{ id: 'v-1', name: null, sku: 'JUICE-1L', option_values: {}, is_active: true, purchase_price: '18.5000' }],
    }
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /branches': paged(branchesWithStores()),
      'GET /products': ok([product]),
      // ST2b: the source can be a store of a branch the user cannot access.
      'GET /inventory/transfers/source-stores': ok([
        { id: 's-1', code: 'FLOOR', name: 'Shop floor', branch: { id: 'b-1', name: 'Main Branch' } },
        { id: 's-3', code: 'NWH', name: 'Central warehouse', branch: { id: 'b-9', name: 'Head office' } },
      ]),
      'POST /inventory/transfers/requests': (init) => {
        posted = JSON.parse(String(init.body))
        return ok({ ...request, id: 't-9' })
      },
      'GET /inventory/transfers/t-9': ok({ ...request, id: 't-9' }),
    })
    const { router } = renderRoutes(routes, '/inventory/transfers/request')

    expect(await screen.findByRole('heading', { name: 'Request stock' })).toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'From store' }))
    await user.click(await screen.findByRole('option', { name: 'Central warehouse · Head office' }))
    await user.click(screen.getByRole('combobox', { name: 'To store' }))
    await user.click(await screen.findByRole('option', { name: 'Shop floor (FLOOR)' }))
    await user.click(screen.getByRole('combobox', { name: 'Product of line 1' }))
    await user.type(screen.getByPlaceholderText('Name, SKU or barcode'), 'juice')
    await user.click(await screen.findByRole('option', { name: /Mango Juice 1L/ }))
    await user.type(screen.getByLabelText('Quantity of line 1'), '12')
    expect(screen.queryByRole('combobox', { name: 'Batch' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Send request' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/inventory/transfers/t-9'))
    expect(posted).toEqual({ from_store_id: 's-3', to_store_id: 's-1', note: null, lines: [{ variant_id: 'v-1', quantity: '12' }] })
  })

  it('labels requested and rejected transfers and filters by status', async () => {
    const user = userEvent.setup()
    const fetchMock = mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /inventory/transfers': paged([
        { ...request, lines: undefined, lines_count: 2 },
        { ...request, id: 't-3', number: 'TRF-000003', status: 'rejected', lines: undefined, lines_count: 1 },
      ]),
    })
    renderRoutes(routes, '/inventory/transfers')

    const row = (await screen.findByText('TRF-000002')).closest('tr') as HTMLElement
    expect(within(row).getByText('Requested')).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: 'TRF-000002' })).toHaveAttribute('href', '/inventory/transfers/t-2')
    expect(within((screen.getByText('TRF-000003').closest('tr') as HTMLElement)).getByText('Rejected')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Request stock' })).toHaveAttribute('href', '/inventory/transfers/request')

    await user.click(screen.getByRole('combobox', { name: 'Filter by status' }))
    await user.click(await screen.findByRole('option', { name: 'Requested' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('status=requested'))).toBe(true))
  })
})
