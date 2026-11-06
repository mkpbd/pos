import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import { captureDownloads, mockApiWithExports } from '@/features/exports/testing'
import { defaultPerformanceRange, formatDays, formatMonth, formatPriceChange, formatRate, formatScore, performanceRangeError, scoreBand } from '@/features/supplier-performance/performance'
import { normalizePerformance } from '@/features/supplier-performance/api'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, success: toastSuccess, error: vi.fn(), message: vi.fn() }) }
})

beforeEach(() => toastSuccess.mockReset())

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })
const buyer = () => makeCurrentUser({ permissions: ['branches.view', 'suppliers.view', 'purchases.view'] })

const mills = { id: 'sup-1', code: 'SUP-000001', name: 'Local Mills' }
const fresh = { id: 'sup-2', code: 'SUP-000002', name: 'Fresh Foods' }
const metrics = (overrides: Record<string, unknown> = {}) => ({
  orders: 6, spend: '48250.50', on_time_rate: '83.33', fill_rate: '97.5', avg_lead_days: '3.25', return_rate: '1.2', price_change_pct: '4.04',
  quote_response_rate: '100', quotes_won: 2, score: '88.6', ...overrides,
})
const rows = [
  { supplier: mills, ...metrics() },
  { supplier: fresh, ...metrics({ orders: 1, spend: '1200.00', on_time_rate: null, fill_rate: '50', avg_lead_days: null, return_rate: '0', price_change_pct: null, quote_response_rate: null, quotes_won: 0, score: '52' }) },
]

describe('performance display helpers', () => {
  it('formats rates, price change, lead time and score bands without floats', () => {
    expect(formatRate('83.333')).toBe('83.3%')
    expect(formatRate('99.95')).toBe('100%')
    expect(formatRate(null)).toBe('—')
    expect(formatPriceChange('4.04')).toBe('+4%')
    expect(formatPriceChange('-1.25')).toBe('−1.3%')
    expect(formatPriceChange('0.01')).toBe('0%')
    expect(formatDays('1')).toBe('1 day')
    expect(formatDays('3.25')).toBe('3.3 days')
    expect(formatScore('88.6')).toBe('89')
    expect(scoreBand('80')).toEqual({ label: 'Good', variant: 'success' })
    expect(scoreBand('79.99').label).toBe('Fair')
    expect(scoreBand('12').label).toBe('Poor')
    expect(scoreBand(null).label).toBe('No data')
    expect(formatMonth('2026-03')).toBe('Mar 2026')
  })

  it('defaults to the last 90 days in the organization timezone', () => {
    expect(defaultPerformanceRange('Asia/Dhaka', new Date('2026-11-05T20:00:00Z'))).toEqual({ date_from: '2026-08-09', date_to: '2026-11-06' })
    expect(performanceRangeError('2026-11-06', '2026-11-01')).toMatch(/on or before/)
  })

  it('accepts the single-supplier response with flat or nested metrics', () => {
    const flat = normalizePerformance({ supplier: mills, date_from: '2026-08-09', date_to: '2026-11-06', ...metrics(), trend: [], late_deliveries: [{ purchase_order: { id: 'po-1', number: 'PO-000001' }, expected_date: null, received_date: null, days_late: null, short_quantity: '2.000' }] })
    expect(flat.metrics.score).toBe('88.6')
    expect(flat.problem_deliveries).toHaveLength(1)
    expect(normalizePerformance({ supplier: mills, metrics: metrics({ score: null }) }).metrics.score).toBeNull()
  })
})

describe('SupplierPerformancePage', () => {
  it('lists suppliers with score badges, sorts by a metric and exports the same query', async () => {
    const user = userEvent.setup()
    const saved = captureDownloads()
    const { fetchMock, exportCalls } = mockApiWithExports({
      'GET /auth/me': ok(buyer()),
      // The API answers the whole (unpaginated) list with the period it used.
      'GET /purchasing/supplier-performance': ok(rows, { period: { date_from: '2026-08-09', date_to: '2026-11-06' } }),
    })
    renderRoutes(routes, '/purchasing/supplier-performance')

    const table = await screen.findByRole('table', { name: 'Supplier performance' })
    const millsRow = within(table).getByRole('link', { name: 'Local Mills' }).closest('tr') as HTMLElement
    expect(within(millsRow).getByText('89 · Good')).toBeInTheDocument()
    expect(within(millsRow).getByText('83.3%')).toBeInTheDocument()
    expect(within(millsRow).getByText('BDT 48,250.50')).toBeInTheDocument()
    expect(within(millsRow).getByText('+4%')).toBeInTheDocument()
    const freshRow = within(table).getByRole('link', { name: 'Fresh Foods' }).closest('tr') as HTMLElement
    expect(within(freshRow).getByText('52 · Poor')).toBeInTheDocument()
    expect(within(table).getByRole('link', { name: 'Local Mills' })).toHaveAttribute('href', '/suppliers/sup-1?tab=performance')
    expect(screen.getByRole('columnheader', { name: /Score/ })).toHaveAttribute('aria-sort', 'descending')

    const first = new URL(String(fetchMock.mock.calls.find(([u]) => String(u).includes('/supplier-performance'))?.[0]), 'http://localhost')
    expect(first.searchParams.get('sort')).toBe('-score')
    expect(first.searchParams.get('date_from')).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    await user.click(screen.getByRole('button', { name: /^On time/ }))
    await waitFor(() => expect(screen.getByRole('columnheader', { name: /On time/ })).toHaveAttribute('aria-sort', 'descending'))
    await user.click(screen.getByRole('button', { name: /^On time/ }))
    await waitFor(() => expect(screen.getByRole('columnheader', { name: /On time/ })).toHaveAttribute('aria-sort', 'ascending'))
    // Lower is better: returns sort low-to-high first.
    await user.click(screen.getByRole('button', { name: /^Returns/ }))
    await waitFor(() => expect(screen.getByRole('columnheader', { name: /Returns/ })).toHaveAttribute('aria-sort', 'ascending'))

    await user.click(screen.getByRole('combobox', { name: 'Branch' }))
    await user.click(await screen.findByRole('option', { name: 'North' }))
    await waitFor(() => {
      const last = fetchMock.mock.calls.map(([u]) => new URL(String(u), 'http://localhost')).filter((u) => u.pathname.endsWith('/supplier-performance') && !u.searchParams.has('export')).at(-1)
      expect(last?.searchParams.get('branch_id')).toBe('b-2')
      expect(last?.searchParams.get('sort')).toBe('return_rate')
    })

    const from = screen.getByLabelText('From')
    await user.clear(from)
    await user.type(from, '2026-12-01')
    expect(await screen.findByRole('alert')).toHaveTextContent('The start date must be on or before the end date.')

    await user.click(screen.getByRole('button', { name: 'Export' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Excel (.xlsx)' }))
    await waitFor(() => expect(saved).toHaveLength(1))
    const params = Object.fromEntries(exportCalls[0]!.url.searchParams)
    expect(exportCalls[0]!.url.pathname).toBe('/api/v1/purchasing/supplier-performance')
    expect(params).toMatchObject({ branch_id: 'b-2', sort: 'return_rate', export: 'xlsx' })
    expect(params.date_from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('explains an empty period', async () => {
    mockApi({ 'GET /auth/me': ok(buyer()), 'GET /purchasing/supplier-performance': paged([]) })
    renderRoutes(routes, '/purchasing/supplier-performance?date_from=2026-01-01&date_to=2026-01-31')
    expect(await screen.findByText('No supplier activity in this period')).toBeInTheDocument()
    expect(screen.getByLabelText('From')).toHaveValue('2026-01-01')
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()
  })
})

describe('Supplier page → Performance tab', () => {
  const supplier = { ...mills, contact_person: null, phone: null, email: null, address: null, tax_number: null, payment_terms_days: 30, opening_balance: '0.00', notes: null, is_active: true, archived_at: null }

  it('shows KPI cards, the monthly trend and late or short deliveries', async () => {
    const user = userEvent.setup()
    let query: URLSearchParams | undefined
    mockApi({
      'GET /auth/me': ok(buyer()),
      'GET /suppliers/sup-1': ok(supplier),
      'GET /purchasing/supplier-products': paged([]),
      'GET /purchasing/suppliers/sup-1/performance': (_init, url) => {
        query = url.searchParams
        return ok({
          supplier: mills, date_from: '2026-08-09', date_to: '2026-11-06', metrics: metrics(),
          trend: [
            { month: '2026-10', on_time_rate: '75', fill_rate: '100', spend: '20000.00' },
            { month: '2026-11', on_time_rate: null, fill_rate: null, spend: '0.00' },
          ],
          problem_deliveries: [
            { purchase_order: { id: 'po-4', number: 'PO-000004' }, expected_date: '2026-10-10', received_date: '2026-10-14', days_late: 4, short_quantity: '0.000' },
            { purchase_order: { id: 'po-5', number: 'PO-000005' }, expected_date: '2026-10-20', received_date: '2026-10-20', days_late: 0, short_quantity: '12.500' },
          ],
        })
      },
    })
    renderRoutes(routes, '/suppliers/sup-1')

    await user.click(await screen.findByRole('tab', { name: 'Performance' }))
    expect(await screen.findByTestId('kpi-on-time')).toHaveTextContent('83.3%')
    expect(screen.getByTestId('kpi-fill')).toHaveTextContent('97.5%')
    expect(screen.getByTestId('kpi-spend')).toHaveTextContent('BDT 48,250.50')
    expect(screen.getByText('89 · Good')).toBeInTheDocument()
    expect(screen.getByText('Spend · 6 orders')).toBeInTheDocument()
    expect(query?.get('date_from')).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    const trend = screen.getByRole('table', { name: 'Monthly trend' })
    expect(within(trend).getByText('Oct 2026')).toBeInTheDocument()
    expect(within(trend).getByText('20,000.00')).toBeInTheDocument()

    const late = screen.getByRole('table', { name: 'Late and short deliveries' })
    expect(within(late).getByRole('link', { name: 'PO-000004' })).toHaveAttribute('href', '/purchasing/orders/po-4')
    expect(within(late).getByText('4 d')).toBeInTheDocument()
    expect(within(late).getByText('12.5')).toBeInTheDocument()
  })

  it('opens on the Performance tab from the performance list link', async () => {
    mockApi({
      'GET /auth/me': ok(buyer()),
      'GET /suppliers/sup-1': ok(supplier),
      'GET /purchasing/suppliers/sup-1/performance': ok({ supplier: mills, date_from: '2026-08-09', date_to: '2026-11-06', metrics: metrics({ score: null }), trend: [], problem_deliveries: [] }),
    })
    renderRoutes(routes, '/suppliers/sup-1?tab=performance')
    expect(await screen.findByRole('tab', { name: 'Performance' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('No late or short deliveries')).toBeInTheDocument()
    expect(screen.getByText('No data')).toBeInTheDocument()
  })
})
