import type { CurrentUser } from '@/features/auth/types'
import { makeCurrentUser } from '@/test/fixtures'

/** Fixtures for the AI Insights tests (API shapes per the AI1 contract). */

export const aiManager = (overrides: Partial<CurrentUser> = {}): CurrentUser =>
  makeCurrentUser({
    roles: [{ id: 'r-2', name: 'Branch Manager', system_key: 'branch_manager' }],
    permissions: ['branches.view', 'dashboard.view', 'reports.view', 'reports.financial', 'ai.ask', 'ai.insights', 'purchases.view'],
    ai_enabled: true,
    ...overrides,
  })

export const askAnswer = () => ({
  answer: 'Your best seller last week was **Miniket Rice** with BDT 12,500.00 in net sales.\n\n- Rice: 40 sold\n- Oil: 25 sold\n\n<script>alert(1)</script>',
  report: {
    key: 'sales_by_product',
    title: 'Sales by product',
    params: { date_from: '2026-10-26', date_to: '2026-11-01' },
    columns: [
      { key: 'product', label: 'Product', type: 'text', cost_sensitive: false, sortable: true },
      { key: 'quantity', label: 'Quantity', type: 'quantity', cost_sensitive: false, sortable: true },
      { key: 'net_sales', label: 'Net sales', type: 'money', cost_sensitive: false, sortable: true },
    ],
    rows: [
      { product: 'Miniket Rice', quantity: '40.000', net_sales: '12500.00' },
      { product: 'Soybean Oil', quantity: '25.000', net_sales: '4750.00' },
    ],
    totals: { quantity: '65.000', net_sales: '17250.00' },
    total_rows: 120,
    omitted_columns: [],
    link: '/reports/sales_by_product?date_from=2026-10-26&date_to=2026-11-01',
  },
  tools_used: [
    { name: 'sales_by_product', params: { date_from: '2026-10-26', date_to: '2026-11-01', branch_id: null }, ok: true },
    { name: 'sales_daily', params: { branch_id: 'b-9' }, ok: false },
  ],
  usage: { input_tokens: 1820, output_tokens: 240, rounds: 2 },
  model: 'claude-sonnet',
  refused: false,
  truncated: false,
})

export const insights = (overrides: Record<string, unknown> = {}) => ({
  facts: {
    period: 'daily',
    date_from: '2026-11-06',
    date_to: '2026-11-06',
    previous_from: '2026-11-05',
    previous_to: '2026-11-05',
    branch_id: null,
    timezone: 'Asia/Dhaka',
    currency: 'BDT',
    kpis: {
      net_sales: { value: '15200.00', previous: '12000.00', change: '3200.00', change_pct: '26.67' },
      orders: { value: 42, previous: 40, change: 2, change_pct: '5.00' },
      returns: { value: '300.00', previous: '0.00', change: '300.00', change_pct: null },
      margin: { value: '18.50', previous: '24.00' },
    },
    top_movers: {
      up: [{ product_id: 'p-1', product: 'Miniket Rice', net_sales: '5000.00', previous: '2500.00', change: '2500.00' }],
      down: [{ product_id: 'p-2', product: 'Soybean Oil', net_sales: '1000.00', previous: '2000.00', change: '-1000.00' }],
    },
    anomalies: [{ date: '2026-11-06', value: '30500.00', mean: '12000.00', stddev: '5000.00', z_score: '3.12', direction: 'spike', history_days: 28 }],
    margin_drop: { current: '18.50', previous: '24.00', change_points: '-5.50', flagged: true },
    return_spike: { rate: '1.90', previous_rate: '0.00', returns: '300.00', flagged: false },
    slow_movers: { days: 30, count: 12, items: [{ product_id: 'p-9', product: 'Winter Jacket', on_hand: '12.000', variants_in_stock: 3, stock_value: '24000.00' }] },
    shortage_risk: {
      count: 1,
      stores_checked: 2,
      items: [{ store_id: 's-1', store: 'Shop floor', product: 'Mango Juice 1L', sku: 'JUICE-1L', on_hand: '4.000', avg_daily: '2.500', days_of_cover: '1.6', lead_time_days: 3, suggested_purchase: '48.000', suggested_transfer: '0.000', supplier: 'Fresh Drinks Ltd' }],
    },
    omitted: [],
  },
  narrative: 'Sales were **26.7% higher** than the day before.',
  narrative_status: 'ok',
  ai_enabled: true,
  generated_at: '2026-11-07T07:30:00+06:00',
  cached: true,
  ...overrides,
})

const customer = (segment: string, overrides: Record<string, unknown>) => ({
  customer_id: `c-${segment}`, name: 'Customer', phone_hint: '…000', orders: 1, net_sales: '100.00', last_purchase_on: '2026-11-01', recency_days: 6,
  loyalty_points: 0, scores: { r: 3, f: 3, m: 3 }, ...overrides,
})

const segment = (key: string, label: string, count: number, extra: Record<string, unknown> = {}) => ({
  segment: key, label, description: `${label} customers.`, count, share: '10.00', net_sales: '1000.00', average_orders: '2.00', average_recency_days: '10.0',
  average_net_sales: '500.00', with_loyalty_points: 0, top_customers: [] as Record<string, unknown>[], ...extra,
})

export const customerInsights = (overrides: Record<string, unknown> = {}) => ({
  ai_enabled: true,
  period: { date_from: '2025-11-07', date_to: '2026-11-06' },
  branch_id: null,
  customers_analyzed: 93,
  loyalty_program_enabled: true,
  segments: [
    segment('champions', 'Champions', 12, { net_sales: '250000.00', top_customers: [customer('champions', { name: 'Ayesha Rahman', phone_hint: '…789', orders: 18, net_sales: '42000.00', last_purchase_on: '2026-11-05' })] }),
    segment('loyal', 'Loyal', 20),
    segment('potential', 'Potential', 15),
    segment('new', 'New', 9),
    segment('at_risk', 'At risk', 7, { top_customers: [customer('at_risk', { name: 'Kamal Hossain', phone_hint: '…123', orders: 9, net_sales: '15000.00', recency_days: 95 })] }),
    segment('hibernating', 'Hibernating', 30),
  ],
  suggestions: [{ segment: 'at_risk', code: 'remind_points', customers: 4, points: 1250, value: '125.00', message: 'Remind 4 at-risk customers of their 1250 unused loyalty points.' }],
  narrative: null,
  narrative_status: 'empty',
  generated_at: '2026-11-07T07:30:00+06:00',
  ...overrides,
})
