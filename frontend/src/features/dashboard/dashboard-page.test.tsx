import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import { normalizeDashboard } from '@/features/dashboard/api'
import { dashboardData, dashboardMeta, reportViewer } from '@/features/reports/test-data'
import { useSessionStore } from '@/stores/session-store'
import { makeCurrentUser, posCashier } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

beforeEach(() => useSessionStore.setState({ activeBranchId: 'b-1' }))

const manager = () => reportViewer(['products.view_cost', 'purchases.view', 'sales.view', 'web_orders.view', 'reports.financial'])

function dashboardCalls(fetchMock: ReturnType<typeof vi.fn>): Record<string, string>[] {
  return fetchMock.mock.calls
    .map(([input]) => new URL(String(input), 'http://localhost'))
    .filter((u) => u.pathname === '/api/v1/dashboard')
    .map((u) => Object.fromEntries(u.searchParams))
}

describe('dashboard', () => {
  it('shows KPIs with the change against the previous period', async () => {
    const fetchMock = mockApi({ 'GET /auth/me': ok(manager()), 'GET /dashboard': ok(dashboardData(), dashboardMeta()) })
    renderRoutes(routes, '/dashboard')

    const sales = await screen.findByTestId('kpi-total_sales')
    expect(sales).toHaveTextContent('Net sales')
    expect(sales).toHaveTextContent('BDT 125,000.00')
    expect(sales).toHaveTextContent('+25%vs previous period')
    // No server change for today: computed exactly from the two values.
    expect(screen.getByTestId('kpi-today_revenue')).toHaveTextContent('−16%vs yesterday')
    expect(screen.getByTestId('kpi-orders_count')).toHaveTextContent('310')
    expect(screen.getByTestId('kpi-gross_profit')).toHaveTextContent('BDT 41,000.00')
    // More returns is bad news: shown in the warning colour.
    expect(within(screen.getByTestId('kpi-returns_amount')).getByText('+50%')).toHaveClass('text-destructive-soft-foreground')
    expect(within(screen.getByTestId('kpi-total_sales')).getByText('+25%')).toHaveClass('text-success-soft-foreground')

    // Last 30 days by default, every branch.
    const query = dashboardCalls(fetchMock)[0]
    expect(Object.keys(query ?? {}).sort()).toEqual(['date_from', 'date_to'])
    expect(screen.getByRole('combobox', { name: 'Period' })).toHaveTextContent('Last 30 days')
  })

  it('charts the trend (POS and online stacked) and sales by channel and branch', async () => {
    mockApi({ 'GET /auth/me': ok(manager()), 'GET /dashboard': ok(dashboardData(), dashboardMeta()) })
    renderRoutes(routes, '/dashboard')

    const trend = await screen.findByRole('table', { name: 'Daily net sales' })
    expect(within(trend).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Date', 'POS', 'Online', 'Net sales'])
    expect(within(within(trend).getByRole('row', { name: /6 Nov 2026/ })).getAllByRole('cell').map((c) => c.textContent)).toEqual(['BDT 3,500.00', 'BDT 1,500.00', 'BDT 5,000.00'])
    expect(screen.getByRole('listitem', { name: 'POS: BDT 100,000.00, Orders 250' })).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: 'North: BDT 35,000.00, Orders 90' })).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: 'Mango Juice 1L: BDT 14,400.00, Quantity 120, Orders 80' })).toBeInTheDocument()
  })

  it('links low stock to reorder and recent transactions to their documents', async () => {
    mockApi({ 'GET /auth/me': ok(manager()), 'GET /dashboard': ok(dashboardData(), dashboardMeta()) })
    renderRoutes(routes, '/dashboard')

    expect(await screen.findByText('14 items are at or below the reorder point.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open reorder suggestions' })).toHaveAttribute('href', '/purchasing/reorder')
    const lowStock = screen.getByRole('list', { name: 'Low stock items' })
    expect(within(lowStock).getByText('Bath Soap')).toBeInTheDocument()
    expect(within(lowStock).getByText('2 on hand')).toBeInTheDocument()

    expect(screen.getByRole('link', { name: 'POS sale INV-MAIN-000007' })).toHaveAttribute('href', '/sales/sa-7')
    expect(screen.getByRole('link', { name: 'Web order WEB-000003' })).toHaveAttribute('href', '/web-orders/wo-3')
    expect(screen.getByRole('link', { name: /All reports/ })).toHaveAttribute('href', '/reports')
  })

  it('hides profit and links the user cannot follow', async () => {
    const cashierWithDashboard = makeCurrentUser({ ...posCashier(), permissions: ['dashboard.view', 'pos.sell', 'branches.view'] })
    // Even if a profit figure slipped through, it stays hidden without products.view_cost.
    mockApi({ 'GET /auth/me': ok(cashierWithDashboard), 'GET /dashboard': ok(dashboardData(), dashboardMeta()) })
    renderRoutes(routes, '/dashboard')

    await screen.findByTestId('kpi-total_sales')
    expect(screen.queryByTestId('kpi-gross_profit')).not.toBeInTheDocument()
    expect(screen.getByText('INV-MAIN-000007')).not.toHaveAttribute('href')
    expect(screen.queryByRole('link', { name: 'Open reorder suggestions' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /All reports/ })).not.toBeInTheDocument()
    // Single branch: no branch filter.
    expect(screen.queryByRole('combobox', { name: 'Branch' })).not.toBeInTheDocument()
  })

  it('filters by branch and period through the address', async () => {
    const user = userEvent.setup()
    const fetchMock = mockApi({ 'GET /auth/me': ok(manager()), 'GET /dashboard': ok(dashboardData({ sales_by_branch: null }), dashboardMeta()) })
    const { router } = renderRoutes(routes, '/dashboard?date_from=2026-10-01&date_to=2026-10-31')

    await screen.findByTestId('kpi-total_sales')
    expect(dashboardCalls(fetchMock)[0]).toEqual({ date_from: '2026-10-01', date_to: '2026-10-31' })

    await user.click(screen.getByRole('combobox', { name: 'Branch' }))
    await user.click(await screen.findByRole('option', { name: 'North' }))
    await waitFor(() => expect(dashboardCalls(fetchMock).at(-1)).toEqual({ date_from: '2026-10-01', date_to: '2026-10-31', branch_id: 'b-2' }))
    expect(router.state.location.search).toContain('branch_id=b-2')
    expect(screen.getByRole('heading', { name: 'Dashboard' }).parentElement).toHaveTextContent('Sales and stock for North.')
  })
})

describe('dashboard payload', () => {
  it('accepts flat KPI values with a separate previous map and channels as an object', () => {
    const d = normalizeDashboard({
      kpis: { total_sales: '10.00', gross_profit: null },
      previous: { total_sales: '8.00' },
      sales_by_channel: { pos: { net_sales: '7.00', orders: 3 }, online: '3.00' },
      low_stock: [{ product_name: 'Soap', on_hand: '1.000' }],
    })
    expect(d.kpis.total_sales).toEqual({ value: '10.00', previous: '8.00', change: null })
    expect(d.kpis.gross_profit?.value).toBeNull()
    expect(d.byChannel).toEqual([{ channel: 'pos', label: 'POS', net_sales: '7.00', orders: 3 }, { channel: 'online', label: 'Online', net_sales: '3.00', orders: null }])
    expect(d.lowStock.count).toBe(1)
    expect(d.byBranch).toBeNull()
  })

  it('reads the server payload: gross profit withheld, periods and currency from meta', () => {
    const d = normalizeDashboard(dashboardData({ kpis: { ...dashboardData().kpis, gross_profit: null } }), dashboardMeta())
    expect(d.kpis.gross_profit?.value).toBeNull()
    expect(d.kpis.today_revenue).toEqual({ value: '4200.00', previous: '5000.00', change: null })
    expect(d.range).toEqual({ from: '2026-10-09', to: '2026-11-07' })
    expect(d.previousRange).toEqual({ from: '2026-09-09', to: '2026-10-08' })
    expect(d.currency).toBe('BDT')
    expect(d.trend[1]).toMatchObject({ pos: '3500.00', online: '1500.00', net_sales: '5000.00', orders: 12 })
    expect(d.lowStock.items[0]).toMatchObject({ name: 'Bath Soap', store: 'Shop floor', sku: 'SOAP' })
    expect(d.recent[1]).toMatchObject({ kind: 'web_order', id: 'wo-3', customer: 'Ayesha Rahman', at: '2026-11-07T10:00:00+06:00' })
  })
})
