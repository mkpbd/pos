import { expect, test, type Page } from '@playwright/test'

/**
 * Phase 7 dashboard and reports against a mocked API: the landing dashboard (KPIs, keyboard
 * reachable trend chart, links), the report catalog, a registry-driven report page (filters in
 * the address, sort, totals, CSV export) and the profit and loss statement. Desktop and mobile.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const paged = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

const me = {
  user: { id: 'u-1', name: 'Nadia Manager', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-2', name: 'Branch Manager', system_key: 'branch_manager' }],
  permissions: ['branches.view', 'dashboard.view', 'reports.view', 'reports.financial', 'products.view', 'products.view_cost', 'purchases.view', 'sales.view', 'web_orders.view', 'pos.sell'],
  branches: [
    { id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true },
    { id: 'b-2', code: 'NORTH', name: 'North', is_active: true },
  ],
}

const dateParams = [
  { name: 'date_from', label: 'From', type: 'date', required: true },
  { name: 'date_to', label: 'To', type: 'date', required: true },
  { name: 'branch_id', label: 'Branch', type: 'entity', required: false, entity: 'branch' },
]
const channel = { name: 'channel', label: 'Channel', type: 'enum', required: false, default: 'all', options: [{ value: 'all', label: 'All channels' }, { value: 'pos', label: 'POS' }, { value: 'online', label: 'Online' }] }
const col = (key: string, label: string, type: string, cost = false, sortable = true) => ({ key, label, type, cost_sensitive: cost, sortable })

const registry = [
  {
    key: 'sales_daily', title: 'Daily sales', description: 'Sales per day: POS sales and delivered web orders.', group: 'sales', group_label: 'Sales', permission: 'reports.view',
    granularity: 'day', max_range_days: 366, params: [...dateParams, channel],
    columns: [col('date', 'Date', 'date'), col('orders', 'Orders', 'number'), col('net_sales', 'Net sales', 'money'), col('gross_profit', 'Gross profit', 'money', true)],
    default_sort: 'date', totals: true, paginated: true, omitted_columns: [],
  },
  {
    key: 'low_stock', title: 'Low stock', description: 'Items at or below their reorder point.', group: 'inventory', group_label: 'Inventory', permission: 'reports.view',
    params: [], columns: [col('product', 'Product', 'text')], default_sort: 'product', totals: false, paginated: true, omitted_columns: [],
  },
  {
    key: 'profit_and_loss', title: 'Profit and loss', description: 'Revenue, costs, expenses and net profit against the previous period.', group: 'finance', group_label: 'Finance',
    permission: 'reports.financial', max_range_days: 1827, params: dateParams,
    columns: [col('label', 'Line', 'text', false, false), col('amount', 'This period', 'money', false, false), col('previous_amount', 'Previous period', 'money', false, false)],
    default_sort: null, totals: false, paginated: false, omitted_columns: [],
  },
]

const dailyRows = [
  { date: '2026-11-01', orders: 4, net_sales: '1100.00', gross_profit: '400.00' },
  { date: '2026-11-02', orders: 6, net_sales: '1850.50', gross_profit: '750.50' },
  { date: '2026-11-03', orders: 2, net_sales: '640.00', gross_profit: '210.00' },
]

const pnl = [
  { key: 'gross_sales', label: 'Gross sales', section: 'revenue', kind: 'line', level: 0, amount: '10500.00', previous_amount: '8200.00', change_pct: '28.05' },
  { key: 'discounts', label: 'Discounts', section: 'revenue', kind: 'line', level: 0, amount: '-500.00', previous_amount: '-200.00', change_pct: '-150.00' },
  { key: 'net_sales', label: 'Net sales', section: 'revenue', kind: 'subtotal', level: 0, amount: '10000.00', previous_amount: '8000.00', change_pct: '25.00' },
  { key: 'cost_of_goods_sold', label: 'Cost of goods sold', section: 'cost', kind: 'line', level: 0, amount: '-6000.00', previous_amount: '-5000.00', change_pct: '-20.00' },
  { key: 'gross_profit', label: 'Gross profit', section: 'cost', kind: 'subtotal', level: 0, amount: '4000.00', previous_amount: '3000.00', change_pct: '33.33' },
  { key: 'expense:c-1', label: 'Rent', section: 'expenses', kind: 'line', level: 1, amount: '-1500.00', previous_amount: '-1500.00', change_pct: '0.00' },
  { key: 'total_expenses', label: 'Total operating expenses', section: 'expenses', kind: 'subtotal', level: 0, amount: '-1500.00', previous_amount: '-1500.00', change_pct: '0.00' },
  { key: 'net_profit', label: 'Net profit', section: 'result', kind: 'total', level: 0, amount: '2500.00', previous_amount: '1500.00', change_pct: '66.67' },
]

const dashboard = {
  kpis: {
    total_sales: { value: '125000.00', previous: '100000.00', change_pct: '25.00' },
    today_revenue: { value: '4200.00', previous: '5000.00', change_pct: '-16.00' },
    orders_count: { value: 310, previous: 300, change_pct: '3.33' },
    gross_profit: { value: '41000.00', previous: '30000.00', change_pct: '36.67' },
    average_ticket: { value: '403.23', previous: '333.33', change_pct: '20.97' },
    returns_amount: { value: '1500.00', previous: '1000.00', change_pct: '50.00' },
  },
  sales_trend: [
    { date: '2026-11-05', net_sales: '4000.00', pos_net_sales: '3000.00', online_net_sales: '1000.00', orders: 10 },
    { date: '2026-11-06', net_sales: '5000.00', pos_net_sales: '3500.00', online_net_sales: '1500.00', orders: 12 },
    { date: '2026-11-07', net_sales: '4200.00', pos_net_sales: '4200.00', online_net_sales: '0.00', orders: 9 },
  ],
  top_products: [{ product_id: 'p-1', name: 'Baby Romper', quantity: '40.000', net_sales: '30000.00', orders: 31 }],
  low_stock: { count: 3, items: [{ variant_id: 'v-9', product: 'Cotton Socks', sku: 'SOCK-S', store: 'Shop floor', on_hand: '2.000', reorder_point: '10.000', shortfall: '8.000' }] },
  recent_transactions: [
    { type: 'sale', channel: 'pos', id: 'sa-7', number: 'INV-MAIN-000007', date: '2026-11-07T11:30:00+06:00', customer: 'Walk-in', total: '450.00', status: 'completed', link: '/sales/sa-7' },
    { type: 'web_order', channel: 'online', id: 'wo-3', number: 'WEB-000003', date: '2026-11-07T10:00:00+06:00', customer: 'Ayesha Rahman', total: '1560.00', status: 'delivered', link: '/web-orders/wo-3' },
  ],
  sales_by_channel: [{ channel: 'pos', net_sales: '100000.00', orders: 250 }, { channel: 'online', net_sales: '25000.00', orders: 60 }],
  sales_by_branch: [{ branch_id: 'b-1', name: 'Main Branch', net_sales: '90000.00', orders: 220 }, { branch_id: 'b-2', name: 'North', net_sales: '35000.00', orders: 90 }],
}

async function mockBackend(page: Page) {
  const runs: URL[] = []
  const exports: URL[] = []
  await page.addInitScript(() => localStorage.setItem('pos-session', JSON.stringify({ state: { activeBranchId: 'b-1' }, version: 0 })))
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: paged([]) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route((url) => url.pathname === '/api/v1/dashboard', (route) =>
    route.fulfill({ json: envelope(dashboard, { params: { date_from: '2026-10-09', date_to: '2026-11-07', previous_from: '2026-09-09', previous_to: '2026-10-08', timezone: 'Asia/Dhaka', currency: 'BDT' }, generated_at: '2026-11-07T10:30:00+06:00' }) }),
  )
  await page.route((url) => url.pathname === '/api/v1/reports', (route) => route.fulfill({ json: envelope(registry) }))
  await page.route((url) => url.pathname === '/api/v1/reports/sales_daily', (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.has('export')) {
      exports.push(url)
      return route.fulfill({ status: 200, contentType: 'text/csv; charset=UTF-8', body: '﻿Date,Orders\r\n', headers: { 'Content-Disposition': 'attachment; filename="sales_daily-berry-kids-20261107-1030.csv"', 'Cache-Control': 'no-store' } })
    }
    runs.push(url)
    const sort = url.searchParams.get('sort') ?? 'date'
    const rows = sort === '-net_sales' ? [...dailyRows].sort((a, b) => Number(b.net_sales) - Number(a.net_sales)) : dailyRows
    return route.fulfill({
      json: envelope(url.searchParams.get('channel') === 'online' ? rows.slice(0, 1) : rows, {
        pagination: { current_page: 1, per_page: 50, total: 3, last_page: 1 },
        totals: { orders: 12, net_sales: '3590.50', gross_profit: '1360.50' },
        params: { date_from: url.searchParams.get('date_from'), date_to: url.searchParams.get('date_to'), timezone: 'Asia/Dhaka', currency: 'BDT' },
        generated_at: '2026-11-07T10:30:00+06:00',
        omitted_columns: [],
      }),
    })
  })
  await page.route((url) => url.pathname === '/api/v1/reports/profit_and_loss', (route) =>
    route.fulfill({
      json: envelope(pnl, {
        pagination: { current_page: 1, per_page: pnl.length, total: pnl.length, last_page: 1 },
        totals: null,
        params: { date_from: '2026-11-01', date_to: '2026-11-07', timezone: 'Asia/Dhaka', currency: 'BDT' },
        previous_period: { date_from: '2026-10-25', date_to: '2026-10-31' },
        generated_at: '2026-11-07T10:30:00+06:00',
      }),
    }),
  )
  return { runs, exports }
}

/** The page itself never scrolls sideways (wide tables scroll in their own box). */
async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')
  expect(overflow).toBeLessThanOrEqual(1)
}

test('lands on the dashboard: KPIs, keyboard-reachable trend chart and links', async ({ page }) => {
  await mockBackend(page)
  await page.goto('/admin/')

  await expect(page).toHaveURL(/\/admin\/dashboard$/)
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  const sales = page.getByTestId('kpi-total_sales')
  await expect(sales).toContainText('BDT 125,000.00')
  await expect(sales).toContainText('+25%')
  await expect(page.getByTestId('kpi-gross_profit')).toContainText('BDT 41,000.00')

  // The latest point is the chart's single tab stop; arrows move along the days.
  const latest = page.getByRole('img', { name: /^Sat, 7 Nov 2026: POS BDT 4,200.00/ })
  await latest.focus()
  await expect(page.getByRole('tooltip')).toContainText('Sat, 7 Nov 2026')
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('img', { name: /^Fri, 6 Nov 2026/ })).toBeFocused()
  await expect(page.getByRole('tooltip')).toContainText('BDT 5,000.00')

  await expect(page.getByRole('listitem', { name: 'Online: BDT 25,000.00, Orders 60' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Web order WEB-000003' })).toHaveAttribute('href', '/admin/web-orders/wo-3')
  await expectNoPageOverflow(page)

  await page.getByRole('link', { name: 'Open reorder suggestions' }).click()
  await expect(page).toHaveURL(/\/admin\/purchasing\/reorder$/)
})

test('runs a report from the catalog with filters in the address, sorts and exports CSV', async ({ page }) => {
  const { runs, exports } = await mockBackend(page)
  await page.goto('/admin/reports')

  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Finance' }).getByRole('link', { name: /Profit and loss/ })).toBeVisible()
  await page.getByRole('region', { name: 'Sales' }).getByRole('link', { name: /Daily sales/ }).click()

  await expect(page).toHaveURL(/\/admin\/reports\/sales_daily\?.*date_from=\d{4}-\d{2}-01/)
  const table = page.getByRole('table', { name: 'Daily sales' })
  await expect(table.getByRole('columnheader', { name: /Gross profit/ })).toBeVisible()

  // A shareable range from the address.
  await page.goto('/admin/reports/sales_daily?date_from=2026-11-01&date_to=2026-11-03&channel=all')
  await expect(table.getByTestId('report-totals')).toContainText('3,590.50')
  await expect(page.getByLabel('From')).toHaveValue('2026-11-01')

  await table.getByRole('button', { name: /^Net sales/ }).click()
  await expect(page).toHaveURL(/sort=-net_sales/)
  await expect(table.getByRole('row').nth(1)).toContainText('1,850.50')

  await page.getByRole('combobox', { name: 'Channel' }).click()
  await page.getByRole('option', { name: 'Online' }).click()
  await expect(page).toHaveURL(/channel=online/)
  await expect.poll(() => runs.at(-1)?.searchParams.get('channel')).toBe('online')
  expect(runs.at(-1)?.searchParams.get('sort')).toBe('-net_sales')

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export' }).click()
  await page.getByRole('menuitem', { name: 'CSV (.csv)' }).click()
  expect((await download).suggestedFilename()).toBe('sales_daily-berry-kids-20261107-1030.csv')
  const q = exports[0]!.searchParams
  expect(Object.fromEntries(q)).toEqual({ date_from: '2026-11-01', date_to: '2026-11-03', channel: 'online', sort: '-net_sales', export: 'csv' })
  await expectNoPageOverflow(page)
})

test('profit and loss reads as a statement with the previous period', async ({ page }) => {
  await mockBackend(page)
  await page.goto('/admin/reports/profit_and_loss?date_from=2026-11-01&date_to=2026-11-07')

  const statement = page.getByTestId('pnl-statement')
  await expect(statement).toBeVisible()
  await expect(statement.getByRole('rowheader', { name: 'Operating expenses', exact: true })).toBeVisible()
  await expect(statement.getByRole('row', { name: /Discounts/ })).toContainText('(500.00)')
  const net = statement.getByRole('row', { name: /Net profit/ })
  await expect(net).toContainText('2,500.00')
  await expect(net).toContainText('1,500.00')
  await expectNoPageOverflow(page)
})
