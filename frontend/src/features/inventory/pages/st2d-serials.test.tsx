import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { captureDownloads, mockApiWithExports } from '@/features/exports/testing'
import { branchesWithStores, stockManager } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

/** ST2d: the serial number register, serial entry on stock documents, stock value as of a past date. */

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })
const store = (id: string, name: string) => ({ id, code: id.toUpperCase(), name, branch_id: 'b-1', branch_name: 'Main Branch' })

const phoneProduct = {
  id: 'p-9', name: 'Phone X', type: 'standard', track_stock: true, track_batches: false, track_serials: true, is_active: true,
  unit: { id: 'un-1', name: 'Piece', code: 'pcs', allow_decimal: false }, tax_rate: null,
  variants: [{ id: 'v-9', name: null, sku: 'PHONE-X', option_values: {}, is_active: true, purchase_price: '900.0000' }],
}
const phoneRef = { id: 'v-9', product_id: 'p-9', product_name: 'Phone X', variant_name: null, sku: 'PHONE-X', unit_code: 'pcs', track_batches: false, allow_decimal: false, track_serials: true }

const serialRow = { id: 'sn-1', serial: 'IMEI-001', variant: phoneRef, store: { id: 's-1', name: 'Shop floor' }, status: 'in_stock', updated_at: '2026-11-20T08:00:00Z' }

async function choosePhone(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('combobox', { name: 'Product of line 1' }))
  await user.type(screen.getByPlaceholderText('Name, SKU or barcode'), 'phone')
  await user.click(await screen.findByRole('option', { name: /Phone X/ }))
}

async function chooseStore(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(await screen.findByRole('combobox', { name: label }))
  await user.click(await screen.findByRole('option', { name: 'Shop floor (FLOOR)' }))
}

describe('SerialsPage', () => {
  it('lists serial numbers, filters them and shows a serial’s history with document links', async () => {
    const user = userEvent.setup()
    const queries: URLSearchParams[] = []
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /branches': paged(branchesWithStores()),
      'GET /inventory/serials': (_init, url) => {
        queries.push(url.searchParams)
        return paged(url.searchParams.get('status') === 'sold' ? [] : [serialRow])
      },
      'GET /inventory/serials/sn-1': ok({
        ...serialRow,
        events: [
          { id: 'e-2', type: 'transferred_in', store: { id: 's-1', name: 'Shop floor' }, reference_type: 'stock_transfer', reference_id: 't-1', reference_number: 'TRF-000001', created_by: { id: 'u-1', name: 'Nadia' }, created_at: '2026-11-20T08:00:00Z' },
          { id: 'e-1', type: 'received', store: { id: 's-2', name: 'Warehouse' }, reference_type: 'goods_receipt', reference_id: 'gr-1', reference_number: 'GRN-000001', created_by: null, created_at: '2026-11-18T08:00:00Z' },
        ],
      }),
    })
    renderRoutes(routes, '/inventory')
    await user.click(await screen.findByRole('link', { name: 'Serial numbers' }))

    const row = await screen.findByRole('row', { name: /IMEI-001/ })
    expect(row).toHaveTextContent('Phone X')
    expect(row).toHaveTextContent('In stock')

    await user.type(screen.getByLabelText('Search serial numbers'), 'imei')
    await waitFor(() => expect(queries.at(-1)?.get('search')).toBe('imei'))
    await user.click(screen.getByRole('combobox', { name: 'Filter by status' }))
    await user.click(await screen.findByRole('option', { name: 'Sold' }))
    expect(await screen.findByText('No serial numbers match')).toBeInTheDocument()
    expect(queries.at(-1)?.get('status')).toBe('sold')
    await user.click(screen.getByRole('combobox', { name: 'Filter by status' }))
    await user.click(await screen.findByRole('option', { name: 'Any status' }))

    await user.click(await screen.findByRole('button', { name: 'IMEI-001' }))
    const sheet = await screen.findByRole('dialog')
    const history = await within(sheet).findByRole('table', { name: 'Serial number history' })
    const rows = within(history).getAllByRole('row')
    expect(rows[1]).toHaveTextContent('Transferred in')
    expect(rows[1]).toHaveTextContent('by Nadia')
    expect(rows[2]).toHaveTextContent('Received')
    expect(rows[2]).toHaveTextContent('Warehouse')
    expect(within(history).getByRole('link', { name: 'GRN-000001' })).toHaveAttribute('href', expect.stringMatching(/\/purchasing\/receipts\/gr-1$/))
    expect(within(history).getByRole('link', { name: 'TRF-000001' })).toHaveAttribute('href', expect.stringMatching(/\/inventory\/transfers\/t-1$/))
  })
})

describe('ValuationPage', () => {
  it('values stock as of a past day, refuses future days and exports with the date', async () => {
    const saved = captureDownloads()
    const user = userEvent.setup()
    const asOfs: (string | null)[] = []
    const { exportCalls } = mockApiWithExports({
      'GET /auth/me': ok(stockManager()),
      'GET /inventory/valuation': (_init, url) => {
        const asOf = url.searchParams.get('as_of')
        asOfs.push(asOf)
        return ok({ stores: [{ store: store('s-1', 'Shop floor'), products: 3, value: asOf ? '1500.00' : '2400.00' }], total: asOf ? '1500.00' : '2400.00', as_of: asOf })
      },
    })
    renderRoutes(routes, '/inventory')
    await user.click(await screen.findByRole('link', { name: 'Valuation' }))

    expect(await screen.findByTestId('valuation-total')).toHaveTextContent('2,400.00')
    expect(asOfs).toEqual([null])

    fireEvent.change(screen.getByLabelText('As of'), { target: { value: '2024-11-30' } })
    expect(await screen.findByText('Value as of 30 Nov 2024')).toBeInTheDocument()
    expect(screen.getByTestId('valuation-total')).toHaveTextContent('1,500.00')
    expect(screen.getByRole('row', { name: /Shop floor/ })).toHaveTextContent('3')
    expect(asOfs.at(-1)).toBe('2024-11-30')

    await user.click(screen.getByRole('button', { name: 'Export' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Excel (.xlsx)' }))
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(exportCalls[0]!.url.pathname).toBe('/api/v1/inventory/valuation')
    expect(exportCalls[0]!.url.searchParams.get('as_of')).toBe('2024-11-30')

    const calls = asOfs.length
    fireEvent.change(screen.getByLabelText('As of'), { target: { value: '2999-01-01' } })
    expect(await screen.findByText('Choose a day up to today.')).toBeInTheDocument()
    expect(asOfs.slice(calls).every((a) => a === null)).toBe(true)
  })

  it('is hidden without cost access', async () => {
    mockApi({
      'GET /auth/me': ok({ ...stockManager(), permissions: stockManager().permissions.filter((p) => p !== 'products.view_cost') }),
      'GET /inventory/stock': paged([]),
    })
    renderRoutes(routes, '/inventory')
    expect(await screen.findByRole('link', { name: 'Serial numbers' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Valuation' })).not.toBeInTheDocument()
  })
})

describe('serial entry on stock documents', () => {
  it('adjusts phones in with one serial per unit', async () => {
    const user = userEvent.setup()
    let posted: { lines: Record<string, unknown>[] } | undefined
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /branches': paged(branchesWithStores()),
      'GET /products': ok([phoneProduct]),
      'POST /inventory/adjustments': (init) => {
        posted = JSON.parse(String(init.body))
        return ok({ id: 'a-1', number: 'ADJ-000001', reason: 'opening', store: store('s-1', 'Shop floor'), lines_count: 1, created_at: '2026-11-27T09:00:00Z' })
      },
      'GET /inventory/adjustments': paged([]),
    })
    const { router } = renderRoutes(routes, '/inventory/adjustments/new')
    await chooseStore(user, 'Store')
    await choosePhone(user)
    await user.type(screen.getByLabelText('Quantity of line 1'), '2')
    await user.click(screen.getByRole('button', { name: 'Post adjustment' }))
    expect(await screen.findByText('Enter 2 serial numbers (0 entered).')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Serials of line 1' }))
    const dialog = await screen.findByRole('dialog', { name: 'Serial numbers' })
    await user.type(within(dialog).getByLabelText('Serial number'), 'IMEI-001{Enter}')
    await user.type(within(dialog).getByLabelText('Serial number'), 'imei-001{Enter}')
    await user.type(within(dialog).getByLabelText('Serial number'), 'IMEI-002{Enter}')
    expect(within(dialog).getByText('2 of 2 entered')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Save 2 serials' }))
    expect(screen.getByRole('button', { name: 'Serials of line 1' })).toHaveTextContent('2/2')

    await user.click(screen.getByRole('button', { name: 'Post adjustment' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/inventory/adjustments'))
    expect(posted?.lines).toEqual([{ variant_id: 'v-9', quantity: '2', unit_cost: '900.0000', serials: ['IMEI-001', 'IMEI-002'] }])
  })

  it('writes off a serial picked from the store’s stock and shows SERIAL_NOT_IN_STOCK at the line', async () => {
    const user = userEvent.setup()
    let posted: { lines: Record<string, unknown>[] } | undefined
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /branches': paged(branchesWithStores()),
      'GET /products': ok([phoneProduct]),
      'GET /inventory/stores/s-1/serials': (_init, url) => ok(url.searchParams.get('variant_id') === 'v-9' ? [serialRow, { ...serialRow, id: 'sn-2', serial: 'IMEI-002' }] : []),
      'POST /inventory/adjustments': (init) => {
        posted = JSON.parse(String(init.body))
        return fail(422, 'SERIAL_NOT_IN_STOCK', 'Some serial numbers are not in stock.', { serials: ['imei-002'] })
      },
    })
    renderRoutes(routes, '/inventory/adjustments/new')
    await chooseStore(user, 'Store')
    await user.click(screen.getByRole('combobox', { name: 'Reason' }))
    await user.click(await screen.findByRole('option', { name: 'Damage' }))
    await choosePhone(user)
    await user.type(screen.getByLabelText('Quantity of line 1'), '-1')

    await user.click(screen.getByRole('button', { name: 'Serials of line 1' }))
    const dialog = await screen.findByRole('dialog', { name: 'Serial numbers' })
    const pick = await within(dialog).findByRole('button', { name: 'IMEI-002' })
    expect(within(dialog).getByRole('button', { name: 'IMEI-001' })).toHaveAttribute('aria-pressed', 'false')
    await user.click(pick)
    expect(pick).toHaveAttribute('aria-pressed', 'true')
    await user.click(within(dialog).getByRole('button', { name: 'Save 1 serial' }))

    await user.click(screen.getByRole('button', { name: 'Post adjustment' }))
    expect(await screen.findByText('Not in stock at this store: IMEI-002')).toBeInTheDocument()
    expect(posted?.lines).toEqual([{ variant_id: 'v-9', quantity: '-1', serials: ['IMEI-002'] }])
  })

  it('dispatches a transfer with the serials sent', async () => {
    const user = userEvent.setup()
    let posted: { lines: Record<string, unknown>[] } | undefined
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /branches': paged(branchesWithStores()),
      'GET /products': ok([phoneProduct]),
      'GET /inventory/stores/s-1/serials': ok([{ serial: 'IMEI-001' }]),
      'POST /inventory/transfers': (init) => {
        posted = JSON.parse(String(init.body))
        return ok({ id: 't-5', number: 'TRF-000005', status: 'in_transit' })
      },
      'GET /inventory/transfers': paged([]),
    })
    const { router } = renderRoutes(routes, '/inventory/transfers/new')
    await chooseStore(user, 'From store')
    await user.click(screen.getByRole('combobox', { name: 'To store' }))
    await user.click(await screen.findByRole('option', { name: 'Warehouse (WH)' }))
    await choosePhone(user)
    await user.type(screen.getByLabelText('Quantity of line 1'), '1')
    await user.click(screen.getByRole('button', { name: 'Serials of line 1' }))
    const dialog = await screen.findByRole('dialog', { name: 'Serial numbers' })
    await user.click(await within(dialog).findByRole('button', { name: 'IMEI-001' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save 1 serial' }))
    await user.click(screen.getByRole('button', { name: 'Dispatch' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/inventory/transfers'))
    expect(posted?.lines).toEqual([{ variant_id: 'v-9', quantity: '1', serials: ['IMEI-001'] }])
  })

  it('dispatches a requested transfer with in-stock serials of the source store', async () => {
    const user = userEvent.setup()
    let posted: { lines: Record<string, unknown>[] } | undefined
    const request = {
      id: 't-2', number: 'TRF-000002', status: 'requested', from_store: store('s-2', 'Warehouse'), to_store: store('s-1', 'Shop floor'), note: null,
      can_receive: false, can_cancel: true, can_dispatch: true, can_reject: true, dispatched_at: null, completed_at: null,
      lines: [{ id: 'r-1', variant: phoneRef, batch: null, quantity: '2.000', requested_quantity: '2.000', unit_cost: null }],
    }
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /inventory/transfers/t-2': ok(request),
      'GET /inventory/stores/s-2/serials': ok(['IMEI-001', 'IMEI-002', 'IMEI-003']),
      'POST /inventory/transfers/t-2/dispatch': (init) => {
        posted = JSON.parse(String(init.body))
        return ok({ ...request, status: 'in_transit' })
      },
    })
    renderRoutes(routes, '/inventory/transfers/t-2')
    await user.click(await screen.findByRole('button', { name: 'Dispatch' }))
    const dispatch = await screen.findByRole('dialog', { name: 'Dispatch TRF-000002' })
    await user.click(within(dispatch).getByRole('button', { name: 'Dispatch goods' }))
    expect(await within(dispatch).findByText('Enter 2 serial numbers.')).toBeInTheDocument()

    await user.click(within(dispatch).getByRole('button', { name: 'Serials of line 1' }))
    const serials = await screen.findByRole('dialog', { name: 'Serial numbers' })
    await user.click(await within(serials).findByRole('button', { name: 'IMEI-001' }))
    await user.click(within(serials).getByRole('button', { name: 'IMEI-003' }))
    await user.click(within(serials).getByRole('button', { name: 'Save 2 serials' }))
    await user.click(within(dispatch).getByRole('button', { name: 'Dispatch goods' }))

    await waitFor(() => expect(posted).toBeDefined())
    expect(posted?.lines).toEqual([{ line_id: 'r-1', quantity: '2', serials: ['IMEI-001', 'IMEI-003'] }])
  })
})
