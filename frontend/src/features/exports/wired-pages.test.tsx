import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import { captureDownloads, errorResponse, mockApiWithExports } from '@/features/exports/testing'
import { couriers, orderRow, orderViewer } from '@/features/web-orders/test-data'
import { makeCurrentUser, stockManager } from '@/test/fixtures'
import { ok, renderRoutes } from '@/test/utils'

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

/** The query the list itself sent last, without paging — what an export must repeat. */
function lastListQuery(fetchMock: ReturnType<typeof vi.fn>, path: string): Record<string, string> {
  const urls = fetchMock.mock.calls.map(([input]) => new URL(String(input), 'http://localhost')).filter((u) => u.pathname === `/api/v1${path}` && !u.searchParams.has('export'))
  const params = Object.fromEntries(urls.at(-1)?.searchParams ?? [])
  delete params.page
  delete params.per_page
  return params
}

async function exportAs(format: 'Excel (.xlsx)' | 'PDF') {
  const user = userEvent.setup()
  const button = await screen.findByRole('button', { name: 'Export' })
  await waitFor(() => expect(button).toBeEnabled())
  await user.click(button)
  await user.click(await screen.findByRole('menuitem', { name: format }))
}

const sale = {
  id: 'sa-1', number: 'INV-MAIN-000007', status: 'cancelled', sold_at: '2026-10-31T06:00:00Z', store: { id: 's-1', code: 'FLOOR', name: 'Shop floor' },
  branch: { id: 'b-1', name: 'Main Branch' }, customer: null, cashier: { id: 'u-4', name: 'Pos Cashier' }, tax_mode: 'exclusive', currency: 'BDT',
  subtotal: '200.00', item_discount_total: '0.00', invoice_discount_total: '0.00', tax_total: '0.00', total: '200.00', paid_total: '200.00', change_total: '0.00',
  due_total: '0.00', cancelled_at: null, cancelled_by: null, cancellation_reason: null,
}
const summary = {
  date: '2026-10-31', timezone: 'Asia/Dhaka', branch_id: null, currency: 'BDT', sales_count: 1, gross_sales: '200.00', discounts: '0.00', net_sales: '200.00',
  tax: '0.00', total: '200.00', average_sale: '200.00', cost: null, gross_profit: null, paid: '200.00', due: '0.00', cancelled_count: 1, cancelled_total: '200.00', payments: [],
}
const product = {
  id: 'p-1', name: 'Mango Juice 1L', type: 'standard', is_active: true, archived_at: null, category: null, images: [],
  variants: [{ id: 'v-1', name: null, sku: 'JUICE-1L', selling_price: '120.00' }],
}
const stockRow = {
  store: { id: 's-1', code: 'FLOOR', name: 'Shop floor', branch_id: 'b-1', branch_name: 'Main Branch' },
  variant: { id: 'v-1', product_name: 'Mango Juice 1L', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs' },
  quantity: '3.000', reorder_level: '10.000', is_low: true, value: '55.50', updated_at: null,
}

describe('wired list exports', () => {
  it('sales: exports the day and status the list shows, sorted like the list', async () => {
    const user = userEvent.setup()
    const saved = captureDownloads()
    const { fetchMock, exportCalls } = mockApiWithExports({
      'GET /auth/me': ok(makeCurrentUser({ permissions: ['sales.view'] })),
      'GET /sales/summary': ok(summary),
      'GET /sales': (_init, url) => paged(url.searchParams.get('status') === 'cancelled' ? [sale] : []),
    })
    renderRoutes(routes, '/sales')

    expect(await screen.findByRole('button', { name: 'Export' })).toBeDisabled()
    await user.click(screen.getByRole('combobox', { name: 'Filter by status' }))
    await user.click(await screen.findByRole('option', { name: 'Cancelled' }))
    await screen.findByRole('link', { name: 'INV-MAIN-000007' })

    await exportAs('Excel (.xlsx)')

    await waitFor(() => expect(saved).toHaveLength(1))
    const params = Object.fromEntries(exportCalls[0]!.url.searchParams)
    expect(params).toMatchObject({ status: 'cancelled', sort: '-sold_at', export: 'xlsx' })
    expect(params.from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const { export: format, ...filters } = params
    expect(format).toBe('xlsx')
    expect(filters).toEqual(lastListQuery(fetchMock, '/sales'))
    expect(exportCalls[0]!.url.pathname).toBe('/api/v1/sales')
    expect(saved[0]?.filename).toBe('sales-corner-shop-20261105-1430.xlsx')
  })

  it('products: exports the searched list as PDF and explains a too-large export', async () => {
    const user = userEvent.setup()
    captureDownloads()
    const { fetchMock, exportCalls } = mockApiWithExports(
      {
        'GET /auth/me': ok(makeCurrentUser({ permissions: ['products.view'] })),
        'GET /categories': ok([]),
        'GET /products': paged([product]),
      },
      () => errorResponse(422, 'EXPORT_TOO_LARGE', 'Too many rows to export.', { limit: 2000, rows: 3100 }),
    )
    renderRoutes(routes, '/products')

    await screen.findByText('Mango Juice 1L')
    await user.type(screen.getByRole('textbox', { name: 'Search products' }), 'juice')
    await waitFor(() => expect(lastListQuery(fetchMock, '/products')).toMatchObject({ search: 'juice' }))

    await exportAs('PDF')

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('This list has 3,100 rows. PDF exports are limited to 2,000 rows — narrow the filters and try again.'))
    const { export: format, ...filters } = Object.fromEntries(exportCalls[0]!.url.searchParams)
    expect(format).toBe('pdf')
    expect(filters).toEqual(lastListQuery(fetchMock, '/products'))
    expect(filters).toEqual({ search: 'juice' })
  })

  it('web orders: exports the tab and filters from the address', async () => {
    const saved = captureDownloads()
    const { fetchMock, exportCalls } = mockApiWithExports({
      'GET /auth/me': ok(orderViewer()),
      'GET /shipping/couriers': ok(couriers()),
      'GET /geography/districts': ok([]),
      'GET /web-orders': paged([orderRow({ status: 'shipped' })], { status_counts: { shipped: 1 } }),
    })
    renderRoutes(routes, '/web-orders?status=shipped&payment_method=cod&from=2026-11-01')

    await screen.findByText('WEB-000001')
    await exportAs('PDF')

    await waitFor(() => expect(saved).toHaveLength(1))
    const { export: format, ...filters } = Object.fromEntries(exportCalls[0]!.url.searchParams)
    expect(format).toBe('pdf')
    expect(filters).toEqual(lastListQuery(fetchMock, '/web-orders'))
    expect(filters).toMatchObject({ status: 'shipped', payment_method: 'cod', date_from: '2026-11-01' })
    expect(exportCalls[0]!.url.pathname).toBe('/api/v1/web-orders')
    expect(saved[0]?.filename).toBe('web-orders-corner-shop-20261105-1430.pdf')
  })

  it('stock: exports low stock only, with the active branch header', async () => {
    const saved = captureDownloads()
    const { fetchMock, exportCalls } = mockApiWithExports({
      'GET /auth/me': ok(stockManager()),
      'GET /inventory/stock': paged([stockRow]),
    })
    renderRoutes(routes, '/inventory?low_stock=1')

    await screen.findByText('Mango Juice 1L')
    await exportAs('Excel (.xlsx)')

    await waitFor(() => expect(saved).toHaveLength(1))
    const { export: format, ...filters } = Object.fromEntries(exportCalls[0]!.url.searchParams)
    expect(format).toBe('xlsx')
    expect(filters).toEqual({ low_stock: '1' })
    expect(filters).toEqual(lastListQuery(fetchMock, '/inventory/stock'))
    expect(exportCalls[0]!.url.pathname).toBe('/api/v1/inventory/stock')
    await waitFor(() => expect((exportCalls[0]!.init.headers as Record<string, string>)['X-Branch-Id']).toBe('b-1'))
  })

  it('customer statement: exports from the account sheet', async () => {
    const user = userEvent.setup()
    const saved = captureDownloads()
    const customer = { id: 'c-1', code: 'CUS-000001', name: 'Rahman Traders', phone: '01700000000', email: null, address: null, customer_group: null, credit_limit: null, notes: null, is_active: true, archived_at: null }
    const { exportCalls } = mockApiWithExports({
      'GET /auth/me': ok(makeCurrentUser({ permissions: ['customers.view', 'sales.view'] })),
      'GET /customers': paged([customer]),
      'GET /customer-groups': ok([]),
      'GET /sales/customer-balances': ok({ 'c-1': '50.00' }),
      'GET /loyalty/settings': ok({ is_enabled: false, spend_amount: '100.00', points_per_spend: 1, point_value: '1.00', min_redeem_points: 0 }),
      'GET /customers/c-1/statement': ok({ customer: { id: 'c-1', name: 'Rahman Traders' }, opening_balance: '0.00', closing_balance: '50.00', entries: [] }),
    })
    renderRoutes(routes, '/customers')

    await screen.findByText('Rahman Traders')
    await user.click(screen.getByRole('button', { name: 'Account of Rahman Traders' }))
    const sheet = await screen.findByRole('dialog')
    await within(sheet).findByTestId('statement-balance')
    await user.click(within(sheet).getByRole('button', { name: 'Export' }))
    await user.click(await screen.findByRole('menuitem', { name: 'PDF' }))

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(exportCalls[0]!.url.pathname).toBe('/api/v1/customers/c-1/statement')
    expect(exportCalls[0]!.url.searchParams.get('export')).toBe('pdf')
  })
})
