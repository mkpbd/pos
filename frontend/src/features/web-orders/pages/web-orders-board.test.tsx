import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import { couriers, orderManager, orderRow, orderViewer, remitter } from '@/features/web-orders/test-data'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: toastError, success: toastSuccess, message: vi.fn() }) }
})

const districts = [
  { id: 26, division_id: 3, name: 'Dhaka' },
  { id: 47, division_id: 3, name: 'Gazipur' },
]
const counts = { pending_payment: 1, confirmed: 2, processing: 0, shipped: 1, delivered: 3, cancelled: 0, cod_unremitted: 2 }
const paged = (items: unknown[], meta: Record<string, unknown> = {}) =>
  ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 }, status_counts: counts, ...meta })

const common = { 'GET /shipping/couriers': ok(couriers()), 'GET /geography/districts': ok(districts) }

beforeEach(() => {
  toastSuccess.mockReset()
  toastError.mockReset()
})

describe('web orders board', () => {
  it('shows status tabs with counts and sends tab and filters as query parameters', async () => {
    const user = userEvent.setup()
    const queries: URLSearchParams[] = []
    mockApi({
      'GET /auth/me': ok(orderManager()),
      ...common,
      'GET /web-orders': (_init, url) => {
        queries.push(url.searchParams)
        return paged([orderRow(), orderRow({ id: 'wo-2', number: 'WEB-000002', status: 'shipped', payment_method: 'cod', item_count: 1, courier_name: 'Pathao' })])
      },
    })
    const { router } = renderRoutes(routes, '/web-orders')

    expect(await screen.findByRole('link', { name: 'WEB-000001' })).toHaveAttribute('href', '/web-orders/wo-1')
    expect(screen.getByText('Pathao')).toBeInTheDocument()
    expect(queries[0]?.toString()).toBe('page=1&per_page=25')
    const tabs = screen.getByRole('tablist', { name: 'Order status' })
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'All7', 'Pending payment1', 'Confirmed2', 'Processing0', 'Shipped1', 'Delivered3', 'Cancelled0', 'COD to collect2',
    ])

    await user.click(within(tabs).getByRole('tab', { name: /Confirmed/ }))
    await waitFor(() => expect(queries.at(-1)?.get('status')).toBe('confirmed'))
    expect(router.state.location.search).toBe('?status=confirmed')

    await user.click(screen.getByRole('combobox', { name: 'Filter by courier' }))
    expect(screen.getByRole('option', { name: 'RedX (inactive)' })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Steadfast' }))
    await waitFor(() => expect(queries.at(-1)?.get('courier_id')).toBe('c-2'))

    await user.click(screen.getByRole('combobox', { name: 'Filter by payment method' }))
    await user.click(await screen.findByRole('option', { name: 'Cash on delivery' }))
    await waitFor(() => expect(queries.at(-1)?.get('payment_method')).toBe('cod'))

    await user.click(screen.getByRole('combobox', { name: 'Filter by district' }))
    await user.click(await screen.findByRole('option', { name: 'Gazipur' }))
    await waitFor(() => expect(queries.at(-1)?.get('district_id')).toBe('47'))

    await user.type(screen.getByLabelText('Search web orders'), ' 01711 ')
    await waitFor(() => expect(queries.at(-1)?.get('search')).toBe('01711'))

    await user.type(screen.getByLabelText('Placed from'), '2026-10-01')
    await waitFor(() => expect(queries.at(-1)?.get('date_from')).toBe('2026-10-01'))
    expect(queries.at(-1)?.get('status')).toBe('confirmed')

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    // The tab stays; only the filters go.
    await waitFor(() => expect(queries.at(-1)?.toString()).toBe('page=1&per_page=25&status=confirmed'))

    await user.click(within(tabs).getByRole('tab', { name: /COD to collect/ }))
    await waitFor(() => expect(queries.at(-1)?.get('cod_unremitted')).toBe('1'))
    expect(queries.at(-1)?.get('status')).toBeNull()
    expect(router.state.location.search).toBe('?cod_unremitted=1')
  })

  it('reads its tab and filters from the address', async () => {
    let query: URLSearchParams | undefined
    mockApi({
      'GET /auth/me': ok(orderViewer()),
      ...common,
      'GET /web-orders': (_init, url) => {
        query = url.searchParams
        return paged([])
      },
    })
    renderRoutes(routes, '/web-orders?status=shipped&courier_id=c-1&payment_method=cod&district_id=26&from=2026-10-01&to=2026-10-31&page=2')

    expect(await screen.findByText('No orders match these filters')).toBeInTheDocument()
    expect(Object.fromEntries(query ?? [])).toEqual({
      page: '2', per_page: '25', status: 'shipped', courier_id: 'c-1', payment_method: 'cod', district_id: '26', date_from: '2026-10-01', date_to: '2026-10-31',
    })
    expect(screen.getByRole('tab', { name: /Shipped/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('offers a remittance from the COD-to-collect tab to staff who may record one', async () => {
    mockApi({ 'GET /auth/me': ok(remitter()), ...common, 'GET /web-orders': paged([orderRow({ status: 'delivered', payment_method: 'cod' })]) })
    renderRoutes(routes, '/web-orders?cod_unremitted=1')
    expect(await screen.findByRole('link', { name: /Record a remittance/ })).toHaveAttribute('href', '/cod-remittances/new')
  })

  it('marks selected orders as processing and reports each order', async () => {
    const user = userEvent.setup()
    const keys: (string | null)[] = []
    let body: unknown
    mockApi({
      'GET /auth/me': ok(orderManager()),
      ...common,
      'GET /web-orders': paged([orderRow({ status: 'confirmed' }), orderRow({ id: 'wo-2', number: 'WEB-000002', status: 'confirmed' }), orderRow({ id: 'wo-3', number: 'WEB-000003', status: 'pending_payment' })]),
      'POST /web-orders/bulk/process': (init) => {
        keys.push(new Headers(init.headers).get('Idempotency-Key'))
        body = JSON.parse(String(init.body))
        if (keys.length === 1) return fail(503, 'SERVICE_UNAVAILABLE', 'Try again')
        return ok([
          { id: 'wo-1', number: 'WEB-000001', ok: true },
          { id: 'wo-2', number: 'WEB-000002', ok: true },
          { id: 'wo-3', number: 'WEB-000003', ok: false, error_code: 'INVALID_STATUS_TRANSITION' },
        ])
      },
    })
    renderRoutes(routes, '/web-orders')

    await user.click(await screen.findByRole('checkbox', { name: 'Select all orders on this page' }))
    const toolbar = screen.getByRole('toolbar', { name: 'Selected orders' })
    expect(toolbar).toHaveTextContent('3 selected')
    await user.click(within(toolbar).getByRole('button', { name: 'Mark processing' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Try again'))
    await user.click(within(toolbar).getByRole('button', { name: 'Mark processing' }))

    const dialog = await screen.findByRole('dialog', { name: 'Mark processing' })
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])
    expect(body).toEqual({ order_ids: ['wo-1', 'wo-2', 'wo-3'] })
    expect(dialog).toHaveTextContent('2 orders moved to Processing; 1 not changed.')
    const results = within(dialog).getAllByRole('listitem')
    expect(results[2]).toHaveTextContent('WEB-000003')
    expect(results[2]).toHaveTextContent('Not changed: not confirmed')
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    // The refused order stays selected for a second look.
    expect(screen.getByRole('toolbar', { name: 'Selected orders' })).toHaveTextContent('1 selected')
  })

  it('opens the print view for the selected orders; viewers cannot bulk-process', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(orderViewer()),
      ...common,
      'GET /web-orders': paged([orderRow(), orderRow({ id: 'wo-2', number: 'WEB-000002' })]),
      'GET /web-orders/print': ok({ kind: 'invoice', organization: null, orders: [] }),
    })
    const { router } = renderRoutes(routes, '/web-orders')

    await user.click(await screen.findByRole('checkbox', { name: 'Select WEB-000002' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select WEB-000001' }))
    const toolbar = screen.getByRole('toolbar', { name: 'Selected orders' })
    expect(within(toolbar).queryByRole('button', { name: 'Mark processing' })).not.toBeInTheDocument()
    await user.click(within(toolbar).getByRole('button', { name: 'Print invoices' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/web-orders/print'))
    expect(router.state.location.search).toBe('?ids=wo-2%2Cwo-1&kind=invoice')
  })

  it('clears the selection when the tab changes', async () => {
    const user = userEvent.setup()
    mockApi({ 'GET /auth/me': ok(orderManager()), ...common, 'GET /web-orders': paged([orderRow()]) })
    renderRoutes(routes, '/web-orders')

    await user.click(await screen.findByRole('checkbox', { name: 'Select WEB-000001' }))
    expect(screen.getByRole('toolbar', { name: 'Selected orders' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /Delivered/ }))
    await waitFor(() => expect(screen.queryByRole('toolbar', { name: 'Selected orders' })).not.toBeInTheDocument())
  })

  it('is listed in the sidebar for order staff only', async () => {
    mockApi({ 'GET /auth/me': ok(orderViewer()), ...common, 'GET /web-orders': paged([]), 'GET /notifications/unread-count': ok({ count: 0 }) })
    renderRoutes(routes, '/web-orders')
    expect(await screen.findByRole('link', { name: 'Web orders' })).toHaveAttribute('href', '/web-orders')
    expect(screen.queryByRole('link', { name: 'COD remittances' })).not.toBeInTheDocument()
  })
})

describe('print view', () => {
  const print = vi.fn()
  beforeEach(() => {
    print.mockReset()
    vi.stubGlobal('print', print)
  })
  afterEach(() => vi.unstubAllGlobals())

  const doc = (kind: 'invoice' | 'packing_slip') => ({
    kind,
    organization: { name: 'Corner Shop', address: 'House 1, Dhanmondi, Dhaka', phone: '01700000000', tax_number: 'BIN-0042', logo_url: null },
    orders: [
      {
        id: 'wo-1', number: 'WEB-000001', placed_at: '2026-10-31T04:30:00Z',
        contact: { name: 'Ayesha Rahman', email: null, phone: '01711000000' },
        shipping_address: { recipient_name: 'Ayesha Rahman', phone: '01711000000', division: 'Dhaka', district: 'Dhaka', area: 'Dhanmondi', address_line: 'House 12, Road 5', postcode: '1205' },
        payment_method: 'cod', payment_method_label: 'Cash on delivery', payment_status: 'unpaid', courier_name: 'Pathao', tracking_number: 'PT 123',
        lines: [{ product_name: 'Baby Romper', variant_name: 'Size M', sku: 'ROMP-M', quantity: '2.000', ...(kind === 'invoice' ? { unit_price: '750.00', discount_amount: '50.00', tax_amount: '0.00', line_total: '1450.00' } : {}) }],
        notes: 'Call first', currency: 'BDT',
        ...(kind === 'invoice'
          ? { subtotal: '1500.00', discount_total: '50.00', promotions: [{ name: 'Welcome 50', kind: 'order', amount: '50.00' }], coupon_code: 'WELCOME50', tax_total: '0.00', shipping_total: '60.00', shipping_discount: '0.00', cod_fee: '10.00', total: '1520.00' }
          : {}),
      },
      {
        id: 'wo-2', number: 'WEB-000002', placed_at: '2026-10-31T05:30:00Z', contact: { name: 'Karim', email: null, phone: null }, shipping_address: null,
        payment_method: 'bank_transfer', payment_status: 'paid', courier_name: null, tracking_number: null,
        lines: [{ product_name: 'Kids Tee', variant_name: null, sku: 'TEE-1', quantity: '1.000' }], notes: null, currency: 'BDT',
      },
    ],
  })

  it('prints packing slips without prices, one sheet per order, outside the admin chrome', async () => {
    let query: URLSearchParams | undefined
    mockApi({
      'GET /auth/me': ok(orderViewer()),
      'GET /web-orders/print': (_init, url) => {
        query = url.searchParams
        return ok(doc('packing_slip'))
      },
    })
    renderRoutes(routes, '/web-orders/print?ids=wo-1,wo-2&kind=packing_slip')

    const sheet = await screen.findByRole('article', { name: 'Packing slip WEB-000001' })
    expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(query?.getAll('ids[]')).toEqual(['wo-1', 'wo-2'])
    expect(query?.get('kind')).toBe('packing_slip')
    expect(within(sheet).getByText('Corner Shop')).toBeInTheDocument()
    expect(within(sheet).getByText('BIN / Tax no. BIN-0042')).toBeInTheDocument()
    expect(within(sheet).getByText('Baby Romper — Size M')).toBeInTheDocument()
    expect(within(sheet).getByText(/Cash on delivery · Unpaid/)).toBeInTheDocument()
    expect(within(sheet).queryByText(/BDT/)).not.toBeInTheDocument()
    expect(within(sheet).queryByRole('columnheader', { name: 'Price' })).not.toBeInTheDocument()
    expect(within(sheet).getByText('PT 123')).toBeInTheDocument()
    // No sidebar / admin navigation on the print view.
    expect(screen.queryByRole('link', { name: 'Web orders' })).not.toBeInTheDocument()
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1))
  })

  it('prints invoices with prices and totals; Print reopens the dialog', async () => {
    const user = userEvent.setup()
    mockApi({ 'GET /auth/me': ok(orderViewer()), 'GET /web-orders/print': ok(doc('invoice')) })
    renderRoutes(routes, '/web-orders/print?ids=wo-1&kind=invoice')

    const sheet = await screen.findByRole('article', { name: 'Invoice WEB-000001' })
    expect(within(sheet).getByRole('columnheader', { name: 'Price' })).toBeInTheDocument()
    const totals = within(sheet).getByLabelText('Totals of WEB-000001')
    expect(totals).toHaveTextContent('Welcome 50 (Order discount)')
    expect(totals).toHaveTextContent('Coupon WELCOME50')
    expect(totals).toHaveTextContent('Cash on delivery fee')
    expect(totals).toHaveTextContent('TotalBDT 1,520.00')
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: 'Print' }))
    expect(print).toHaveBeenCalledTimes(2)
  })

  it('needs web order access', async () => {
    mockApi({ 'GET /auth/me': ok(makeCurrentUser({ permissions: ['branches.view'] })) })
    renderRoutes(routes, '/web-orders/print?ids=wo-1&kind=invoice')
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument()
    expect(print).not.toHaveBeenCalled()
  })
})
