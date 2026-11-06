import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import { captureDownloads, mockApiWithExports } from '@/features/exports/testing'
import { dailyRows, pnlLines, registry, reportViewer, runMeta, salesDailyDefinition } from '@/features/reports/test-data'
import { useSessionStore } from '@/stores/session-store'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, success: toastSuccess, error: vi.fn(), message: vi.fn() }) }
})

beforeEach(() => {
  useSessionStore.setState({ activeBranchId: 'b-1' })
  toastSuccess.mockReset()
})

const RANGE = 'date_from=2026-11-01&date_to=2026-11-03'

/** Query strings the report endpoint received (without export downloads). */
function runCalls(fetchMock: ReturnType<typeof vi.fn>, key: string): Record<string, string>[] {
  return fetchMock.mock.calls
    .map(([input]) => new URL(String(input), 'http://localhost'))
    .filter((u) => u.pathname === `/api/v1/reports/${key}` && !u.searchParams.has('export'))
    .map((u) => Object.fromEntries(u.searchParams))
}

function dailyRun(_init: RequestInit, url: URL) {
  const rows = url.searchParams.get('channel') === 'online' ? [dailyRows()[0]] : dailyRows()
  return ok(rows, runMeta({ pagination: { current_page: Number(url.searchParams.get('page') ?? 1), per_page: 50, total: 120, last_page: 3 } }))
}

describe('reports catalog', () => {
  it('groups the reports the user may run and links to each', async () => {
    mockApi({ 'GET /auth/me': ok(reportViewer()), 'GET /reports': ok(registry()) })
    renderRoutes(routes, '/reports')

    const sales = await screen.findByRole('region', { name: 'Sales' })
    expect(within(sales).getByRole('link', { name: /Daily sales/ })).toHaveAttribute('href', '/reports/sales_daily')
    expect(within(sales).getByRole('link', { name: /Sales by product/ })).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Inventory' })).getByRole('link', { name: /Low stock/ })).toBeInTheDocument()
    // Profit and loss needs reports.financial.
    expect(screen.queryByRole('region', { name: 'Finance' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Profit and loss/ })).not.toBeInTheDocument()

    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Reports' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toBeInTheDocument()
  })

  it('is out of reach without a reports permission', async () => {
    mockApi({ 'GET /auth/me': ok(reportViewer().permissions && { ...reportViewer(), permissions: ['dashboard.view', 'branches.view'] }) })
    renderRoutes(routes, '/reports')
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument()
  })
})

describe('report page', () => {
  it('runs the report with the params in the address, shows totals and hides cost columns without permission', async () => {
    const fetchMock = mockApi({ 'GET /auth/me': ok(reportViewer()), 'GET /reports': ok(registry()), 'GET /reports/sales_daily': dailyRun })
    renderRoutes(routes, `/reports/sales_daily?${RANGE}&branch_id=b-2`)

    const table = await screen.findByRole('table', { name: 'Daily sales' })
    expect(runCalls(fetchMock, 'sales_daily').at(-1)).toEqual({ date_from: '2026-11-01', date_to: '2026-11-03', branch_id: 'b-2', channel: 'all', sort: 'date', page: '1', per_page: '50' })

    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent?.replace(/, sort.*$/, ''))).toEqual(['Date', 'Orders', 'Gross sales', 'Net sales'])
    expect(screen.getByTestId('cost-hidden-note')).toHaveTextContent('Cost, Gross profit are hidden')
    const totals = screen.getByTestId('report-totals')
    expect(within(totals).getByRole('rowheader')).toHaveTextContent('Total')
    expect(within(totals).getAllByRole('cell').map((c) => c.textContent)).toEqual(['12', '3,700.00', '2,830.50'])
    expect(within(table).getByText('-120.00')).toHaveClass('text-destructive')
    expect(screen.getByText(/^Amounts in BDT · Generated/)).toBeInTheDocument()

    // Filters rendered from the params schema.
    expect(screen.getByLabelText('From')).toHaveValue('2026-11-01')
    expect(screen.getByLabelText('To')).toHaveValue('2026-11-03')
    expect(screen.getByRole('combobox', { name: 'Branch' })).toHaveTextContent('North')
    expect(screen.getByRole('combobox', { name: 'Channel' })).toHaveTextContent('All channels')
    // The small trend chart (daily sales) with its data table.
    expect(screen.getByRole('group', { name: /Net sales by day \(this page\)/ })).toBeInTheDocument()
  })

  it('shows cost and profit to users who may see costs', async () => {
    mockApi({ 'GET /auth/me': ok(reportViewer(['products.view_cost'])), 'GET /reports': ok(registry()), 'GET /reports/sales_daily': dailyRun })
    renderRoutes(routes, `/reports/sales_daily?${RANGE}`)

    const table = await screen.findByRole('table', { name: 'Daily sales' })
    expect(within(table).getByRole('columnheader', { name: /Gross profit/ })).toBeInTheDocument()
    expect(screen.queryByTestId('cost-hidden-note')).not.toBeInTheDocument()
  })

  it('keeps filters, sort and page in the address and restarts paging on a filter change', async () => {
    const user = userEvent.setup()
    const fetchMock = mockApi({ 'GET /auth/me': ok(reportViewer()), 'GET /reports': ok(registry()), 'GET /reports/sales_daily': dailyRun })
    const { router } = renderRoutes(routes, `/reports/sales_daily?${RANGE}`)
    await screen.findByRole('table', { name: 'Daily sales' })

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(runCalls(fetchMock, 'sales_daily').at(-1)).toMatchObject({ page: '2' }))
    expect(router.state.location.search).toContain('page=2')

    const table = screen.getByRole('table', { name: 'Daily sales' })
    await user.click(within(table).getByRole('button', { name: /^Net sales/ }))
    await waitFor(() => expect(runCalls(fetchMock, 'sales_daily').at(-1)).toMatchObject({ sort: '-net_sales', page: '1' }))
    expect(within(table).getByRole('columnheader', { name: /Net sales/ })).toHaveAttribute('aria-sort', 'descending')

    await user.click(screen.getByRole('combobox', { name: 'Channel' }))
    await user.click(await screen.findByRole('option', { name: 'Online' }))
    await waitFor(() => expect(runCalls(fetchMock, 'sales_daily').at(-1)).toMatchObject({ channel: 'online', sort: '-net_sales', page: '1' }))
    const search = new URLSearchParams(router.state.location.search)
    expect(Object.fromEntries(search)).toEqual({ date_from: '2026-11-01', date_to: '2026-11-03', channel: 'online', sort: '-net_sales' })
  })

  it('completes the address with the default period so the link is shareable', async () => {
    mockApi({ 'GET /auth/me': ok(reportViewer()), 'GET /reports': ok(registry()), 'GET /reports/sales_daily': dailyRun })
    const { router } = renderRoutes(routes, '/reports/sales_daily')

    await screen.findByRole('table', { name: 'Daily sales' })
    await waitFor(() => expect(router.state.location.search).toMatch(/date_from=\d{4}-\d{2}-01&date_to=\d{4}-\d{2}-\d{2}/))
    expect(router.state.location.search).toContain('channel=all')
    expect(screen.getByRole('combobox', { name: 'Period' })).toHaveTextContent('This month')
  })

  it('applies a period preset', async () => {
    const user = userEvent.setup()
    const fetchMock = mockApi({ 'GET /auth/me': ok(reportViewer()), 'GET /reports': ok(registry()), 'GET /reports/sales_daily': dailyRun })
    renderRoutes(routes, `/reports/sales_daily?${RANGE}`)
    await screen.findByRole('table', { name: 'Daily sales' })

    expect(screen.getByRole('combobox', { name: 'Period' })).toHaveTextContent('Custom dates')
    await user.click(screen.getByRole('combobox', { name: 'Period' }))
    await user.click(await screen.findByRole('option', { name: 'Today' }))
    await waitFor(() => {
      const last = runCalls(fetchMock, 'sales_daily').at(-1)
      expect(last?.date_from).toBe(last?.date_to)
    })
    expect(screen.getByRole('combobox', { name: 'Period' })).toHaveTextContent('Today')
  })

  it('refuses a period longer than the report allows without asking the server, and explains server limits', async () => {
    const fetchMock = mockApi({
      'GET /auth/me': ok(reportViewer()),
      'GET /reports': ok(registry()),
      'GET /reports/sales_daily': fail(422, 'RANGE_TOO_LARGE', 'Daily reports cover at most 366 days.'),
      'GET /reports/sales_by_product': fail(422, 'RANGE_TOO_LARGE', 'Reports cover at most five years.'),
    })
    const first = renderRoutes(routes, '/reports/sales_daily?date_from=2025-01-01&date_to=2026-11-03')
    expect(await screen.findByText(/at most 366 days \(this one is 672\)/)).toBeInTheDocument()
    expect(runCalls(fetchMock, 'sales_daily')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()
    first.unmount()

    renderRoutes(routes, `/reports/sales_by_product?${RANGE}`)
    expect(await screen.findByText('That period is too long for this report')).toBeInTheDocument()
    expect(screen.getByText('Reports cover at most five years.')).toBeInTheDocument()
  })

  it('exports the report as filtered (Excel, CSV or PDF) without paging', async () => {
    const user = userEvent.setup()
    const saved = captureDownloads()
    const { exportCalls } = mockApiWithExports({ 'GET /auth/me': ok(reportViewer()), 'GET /reports': ok(registry()), 'GET /reports/sales_daily': dailyRun })
    renderRoutes(routes, `/reports/sales_daily?${RANGE}&channel=pos&page=2`)
    await screen.findByRole('table', { name: 'Daily sales' })

    const button = screen.getByRole('button', { name: 'Export' })
    await waitFor(() => expect(button).toBeEnabled())
    await user.click(button)
    expect(await screen.findByRole('menuitem', { name: 'Excel (.xlsx)' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'PDF' })).toBeInTheDocument()
    expect(screen.getByText('Daily sales — all matching rows')).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'CSV (.csv)' }))

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(exportCalls[0]!.url.pathname).toBe('/api/v1/reports/sales_daily')
    expect(Object.fromEntries(exportCalls[0]!.url.searchParams)).toEqual({ date_from: '2026-11-01', date_to: '2026-11-03', channel: 'pos', sort: 'date', export: 'csv' })
    expect(saved[0]?.filename).toBe('reports-sales_daily-corner-shop-20261105-1430.csv')
  })

  it('filters by a product chosen from search', async () => {
    const user = userEvent.setup()
    const product = { id: 'p-1', name: 'Mango Juice 1L', variants: [{ sku: 'JUICE-1L' }] }
    const fetchMock = mockApi({
      'GET /auth/me': ok(reportViewer()),
      'GET /reports': ok(registry()),
      'GET /categories': ok([]),
      'GET /products': ok([product], { pagination: { current_page: 1, per_page: 25, total: 1, last_page: 1 } }),
      'GET /reports/sales_by_product': (_i, url) => ok([{ product: 'Mango Juice 1L', quantity: '3.000', net_sales: '360.00' }], runMeta({ totals: { quantity: '3.000', net_sales: '360.00' }, pagination: { current_page: 1, per_page: 50, total: 1, last_page: 1 }, params: Object.fromEntries(url.searchParams) })),
    })
    const { router } = renderRoutes(routes, `/reports/sales_by_product?${RANGE}`)
    await screen.findByRole('table', { name: 'Sales by product' })

    await user.click(screen.getByRole('button', { name: /Product All products/ }))
    await user.click(await screen.findByRole('option', { name: /Mango Juice 1L/ }))

    await waitFor(() => expect(runCalls(fetchMock, 'sales_by_product').at(-1)).toMatchObject({ product_id: 'p-1', sort: '-net_sales' }))
    expect(router.state.location.search).toContain('product_id=p-1')
    expect(screen.getByRole('button', { name: /Product Mango Juice 1L/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear product filter' }))
    await waitFor(() => expect(runCalls(fetchMock, 'sales_by_product').at(-1)).not.toHaveProperty('product_id'))
  })

  it('renders profit and loss as a statement with the previous period beside it', async () => {
    const accountant = reportViewer(['reports.financial', 'products.view_cost'])
    mockApi({
      'GET /auth/me': ok(accountant),
      'GET /reports': ok(registry()),
      'GET /reports/profit_and_loss': ok(pnlLines(), runMeta({ pagination: null, totals: null, previous_period: { date_from: '2026-10-29', date_to: '2026-10-31' } })),
    })
    renderRoutes(routes, `/reports/profit_and_loss?${RANGE}`)

    const statement = await screen.findByTestId('pnl-statement')
    const headers = within(statement).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers.slice(1)).toEqual([expect.stringMatching(/Nov.*2026 – Nov.*2026/), expect.stringMatching(/Oct.*2026 – Oct.*2026/), 'Change'])
    expect(within(statement).getByRole('rowheader', { name: 'Revenue' })).toBeInTheDocument()
    const net = within(statement).getByRole('row', { name: /Net profit/ })
    expect(net).toHaveAttribute('data-kind', 'total')
    expect(within(net).getAllByRole('cell').map((c) => c.textContent)).toEqual(['2,500.00', '1,500.00', '+66.7%'])
    expect(within(statement).getByRole('row', { name: /Gross profit/ })).toHaveAttribute('data-kind', 'subtotal')
    // Deductions in brackets; expense categories under their heading, indented.
    expect(within(within(statement).getByRole('row', { name: /Discounts/ })).getAllByRole('cell').map((c) => c.textContent)).toEqual(['(300.00)', '(200.00)', '−50%'])
    expect(within(statement).getByRole('rowheader', { name: 'Operating expenses' })).toBeInTheDocument()
    expect(within(statement).getByRole('rowheader', { name: 'Rent' })).toHaveClass('pl-7')
    // A statement is one page: no pager, no plain table.
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('report-totals')).not.toBeInTheDocument()
  })

  it('says when a report does not exist', async () => {
    mockApi({ 'GET /auth/me': ok(reportViewer()), 'GET /reports': ok([salesDailyDefinition]) })
    renderRoutes(routes, '/reports/profit_and_loss')
    expect(await screen.findByText('Report not found')).toBeInTheDocument()
    for (const link of screen.getAllByRole('link', { name: 'All reports' })) expect(link).toHaveAttribute('href', '/reports')
  })
})
