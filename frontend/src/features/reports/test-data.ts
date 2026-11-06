/**
 * Report registry, runs and a dashboard in the backend's shapes (Phase 7), for tests only.
 */
import { makeCurrentUser } from '@/test/fixtures'

const dateFrom = { name: 'date_from', label: 'From', type: 'date', required: true }
const dateTo = { name: 'date_to', label: 'To', type: 'date', required: true }
const branch = { name: 'branch_id', label: 'Branch', type: 'entity', required: false, entity: 'branch' }
const channel = {
  name: 'channel', label: 'Channel', type: 'enum', required: false, default: 'all',
  options: [{ value: 'all', label: 'All channels' }, { value: 'pos', label: 'POS' }, { value: 'online', label: 'Online' }],
}
const money = (key: string, label: string, cost = false) => ({ key, label, type: 'money', cost_sensitive: cost, sortable: true })

export const salesDailyDefinition = {
  key: 'sales_daily', title: 'Daily sales', description: 'Net sales per day, POS and online.', group: 'sales', group_label: 'Sales', permission: 'reports.view',
  financial: false, time_based: true, granularity: 'day', max_range_days: 366,
  params: [dateFrom, dateTo, branch, channel],
  columns: [
    { key: 'date', label: 'Date', type: 'date', cost_sensitive: false, sortable: true },
    { key: 'orders', label: 'Orders', type: 'number', cost_sensitive: false, sortable: true },
    money('gross_sales', 'Gross sales'),
    money('net_sales', 'Net sales'),
    money('cost', 'Cost', true),
    money('gross_profit', 'Gross profit', true),
  ],
  default_sort: 'date', totals: true, paginated: true, omitted_columns: [],
}

export const salesByProductDefinition = {
  key: 'sales_by_product', title: 'Sales by product', description: 'Quantity, net sales, cost and margin per product.', group: 'sales', group_label: 'Sales', permission: 'reports.view',
  financial: false, time_based: true, granularity: null, max_range_days: 1827,
  params: [
    dateFrom, dateTo, branch,
    { name: 'product_id', label: 'Product', type: 'entity', required: false, entity: 'product' },
    { name: 'category_id', label: 'Category', type: 'entity', required: false, entity: 'category' },
    channel,
  ],
  columns: [
    { key: 'product', label: 'Product', type: 'text', cost_sensitive: false, sortable: true },
    { key: 'quantity', label: 'Qty', type: 'quantity', cost_sensitive: false, sortable: true },
    money('net_sales', 'Net sales'),
    money('gross_profit', 'Gross profit', true),
    { key: 'margin', label: 'Margin', type: 'percent', cost_sensitive: true, sortable: true },
  ],
  default_sort: '-net_sales', totals: true, paginated: true, omitted_columns: [],
}

export const lowStockDefinition = {
  key: 'low_stock', title: 'Low stock', description: 'Items at or below their reorder point.', group: 'inventory', group_label: 'Inventory', permission: 'reports.view',
  financial: false, time_based: false, granularity: null, max_range_days: null,
  params: [{ name: 'store_id', label: 'Store', type: 'entity', required: false, entity: 'store' }],
  columns: [{ key: 'product', label: 'Product', type: 'text', cost_sensitive: false, sortable: true }, { key: 'on_hand', label: 'On hand', type: 'quantity', cost_sensitive: false, sortable: true }],
  default_sort: 'product', totals: false, paginated: true, omitted_columns: [],
}

export const profitAndLossDefinition = {
  key: 'profit_and_loss', title: 'Profit and loss', description: 'Revenue, cost of goods, expenses and net profit against the previous period.', group: 'finance', group_label: 'Finance',
  permission: 'reports.financial', financial: true, time_based: true, granularity: null, max_range_days: 1827,
  params: [dateFrom, dateTo, branch],
  columns: [
    { key: 'label', label: 'Line', type: 'text', cost_sensitive: false, sortable: false },
    { key: 'amount', label: 'This period', type: 'money', cost_sensitive: false, sortable: false },
    { key: 'previous_amount', label: 'Previous period', type: 'money', cost_sensitive: false, sortable: false },
    { key: 'change', label: 'Change', type: 'money', cost_sensitive: false, sortable: false },
    { key: 'change_pct', label: 'Change %', type: 'percent', cost_sensitive: false, sortable: false },
  ],
  default_sort: null, totals: false, paginated: false, omitted_columns: [],
}

export const registry = () => [salesDailyDefinition, salesByProductDefinition, lowStockDefinition, profitAndLossDefinition]

export const dailyRows = () => [
  { date: '2026-11-01', orders: 4, gross_sales: '1200.00', net_sales: '1100.00', cost: '700.00', gross_profit: '400.00' },
  { date: '2026-11-02', orders: 6, gross_sales: '2000.00', net_sales: '1850.50', cost: '1100.00', gross_profit: '750.50' },
  { date: '2026-11-03', orders: 2, gross_sales: '500.00', net_sales: '-120.00', cost: '0.00', gross_profit: '-120.00' },
]

export const dailyTotals = () => ({ orders: 12, gross_sales: '3700.00', net_sales: '2830.50', cost: '1800.00', gross_profit: '1030.50' })

export const runMeta = (overrides: Record<string, unknown> = {}) => ({
  pagination: { current_page: 1, per_page: 25, total: 3, last_page: 1 },
  totals: dailyTotals(),
  params: { date_from: '2026-11-01', date_to: '2026-11-07', channel: 'all' },
  generated_at: '2026-11-07T06:00:00Z',
  omitted_columns: [],
  ...overrides,
})

/** Statement lines as ProfitAndLossReport returns them (signed amounts, previous period beside). */
export const pnlLines = () => [
  { key: 'gross_sales', label: 'Gross sales', section: 'revenue', kind: 'line', level: 0, amount: '10500.00', previous_amount: '8200.00', change: '2300.00', change_pct: '28.05' },
  { key: 'discounts', label: 'Discounts', section: 'revenue', kind: 'line', level: 0, amount: '-300.00', previous_amount: '-200.00', change: '-100.00', change_pct: '-50.00' },
  { key: 'returns', label: 'Returns', section: 'revenue', kind: 'line', level: 0, amount: '-200.00', previous_amount: '0.00', change: '-200.00', change_pct: null },
  { key: 'net_sales', label: 'Net sales', section: 'revenue', kind: 'subtotal', level: 0, amount: '10000.00', previous_amount: '8000.00', change: '2000.00', change_pct: '25.00' },
  { key: 'cost_of_goods_sold', label: 'Cost of goods sold', section: 'cost', kind: 'line', level: 0, amount: '-6000.00', previous_amount: '-5000.00', change: '-1000.00', change_pct: '-20.00' },
  { key: 'gross_profit', label: 'Gross profit', section: 'cost', kind: 'subtotal', level: 0, amount: '4000.00', previous_amount: '3000.00', change: '1000.00', change_pct: '33.33' },
  { key: 'expense:c-1', label: 'Rent', section: 'expenses', kind: 'line', level: 1, amount: '-1500.00', previous_amount: '-1500.00', change: '0.00', change_pct: '0.00' },
  { key: 'total_expenses', label: 'Total operating expenses', section: 'expenses', kind: 'subtotal', level: 0, amount: '-1500.00', previous_amount: '-1500.00', change: '0.00', change_pct: '0.00' },
  { key: 'total_other_income', label: 'Total other income', section: 'other_income', kind: 'subtotal', level: 0, amount: '0.00', previous_amount: '0.00', change: '0.00', change_pct: null },
  { key: 'net_profit', label: 'Net profit', section: 'result', kind: 'total', level: 0, amount: '2500.00', previous_amount: '1500.00', change: '1000.00', change_pct: '66.67' },
]

export const reportViewer = (permissions: string[] = []) =>
  makeCurrentUser({
    roles: [{ id: 'r-6', name: 'Accountant', system_key: 'accountant' }],
    permissions: ['branches.view', 'dashboard.view', 'reports.view', 'products.view', ...permissions],
  })

/** GET /dashboard `data` as Dashboard::build returns it (currency and periods are in meta.params). */
export const dashboardData = (overrides: Record<string, unknown> = {}) => ({
  kpis: {
    total_sales: { value: '125000.00', previous: '100000.00', change: '25000.00', change_pct: '25.00' },
    today_revenue: { value: '4200.00', previous: '5000.00', change: '-800.00', change_pct: null },
    orders_count: { value: 310, previous: 300, change: 10, change_pct: '3.33' },
    gross_profit: { value: '41000.00', previous: '30000.00', change: '11000.00', change_pct: '36.67' },
    average_ticket: { value: '403.23', previous: '333.33', change: '69.90', change_pct: '20.97' },
    returns_amount: { value: '1500.00', previous: '1000.00', change: '500.00', change_pct: '50.00' },
  },
  sales_trend: [
    { date: '2026-11-05', net_sales: '4000.00', pos_net_sales: '3000.00', online_net_sales: '1000.00', orders: 10, pos_orders: 8, online_orders: 2 },
    { date: '2026-11-06', net_sales: '5000.00', pos_net_sales: '3500.00', online_net_sales: '1500.00', orders: 12, pos_orders: 9, online_orders: 3 },
    { date: '2026-11-07', net_sales: '4200.00', pos_net_sales: '4200.00', online_net_sales: '0.00', orders: 9, pos_orders: 9, online_orders: 0 },
  ],
  top_products: [
    { product_id: 'p-1', name: 'Mango Juice 1L', quantity: '120.000', net_sales: '14400.00', orders: 80 },
    { product_id: 'p-2', name: 'Basmati Rice 5kg', quantity: '30.000', net_sales: '12000.00', orders: 25 },
  ],
  low_stock: {
    count: 14,
    items: [{ variant_id: 'v-9', product_id: 'p-9', product: 'Bath Soap', sku: 'SOAP', store_id: 's-1', store: 'Shop floor', on_hand: '2.000', reorder_point: '10.000', shortfall: '8.000' }],
  },
  recent_transactions: [
    { type: 'sale', channel: 'pos', id: 'sa-7', number: 'INV-MAIN-000007', date: '2026-11-07T11:30:00+06:00', customer: 'Walk-in', total: '450.00', status: 'completed', branch_id: 'b-1', link: '/sales/sa-7' },
    { type: 'web_order', channel: 'online', id: 'wo-3', number: 'WEB-000003', date: '2026-11-07T10:00:00+06:00', customer: 'Ayesha Rahman', total: '1560.00', status: 'delivered', branch_id: 'b-1', link: '/web-orders/wo-3' },
  ],
  sales_by_channel: [
    { channel: 'pos', label: 'POS', net_sales: '100000.00', orders: 250, share: '80.00' },
    { channel: 'online', label: 'Online', net_sales: '25000.00', orders: 60, share: '20.00' },
  ],
  sales_by_branch: [
    { branch_id: 'b-1', name: 'Main Branch', net_sales: '90000.00', orders: 220 },
    { branch_id: 'b-2', name: 'North', net_sales: '35000.00', orders: 90 },
  ],
  ...overrides,
})

export const dashboardMeta = () => ({
  params: { date_from: '2026-10-09', date_to: '2026-11-07', branch_id: null, previous_from: '2026-09-09', previous_to: '2026-10-08', today: '2026-11-07', timezone: 'Asia/Dhaka', currency: 'BDT' },
  generated_at: '2026-11-07T10:30:00+06:00',
  omitted: [],
  cache_seconds: 60,
})
