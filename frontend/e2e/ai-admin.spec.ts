import { expect, test, type Page } from '@playwright/test'

/**
 * Phase 8 (AI1) against a mocked API: AI Insights (Ask with a Bangla question, safe markdown,
 * report table and link, tools used; budget / unavailable errors; business and customer
 * insights, including AI switched off), the reorder "Explain with AI" panel and the AI card in
 * Organization settings. Desktop and mobile. No real AI provider is ever called.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const paged = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })
const failure = (code: string, message: string) => ({ success: false, error: { code, message, details: {} }, meta: { request_id: 'e2e' } })

const meFor = (aiEnabled: boolean) => ({
  user: { id: 'u-1', name: 'Nadia Admin', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-1', name: 'Organization Admin', system_key: 'organization_admin' }],
  permissions: ['ai.ask', 'ai.insights', 'ai.manage', 'branches.view', 'dashboard.view', 'organization.view', 'organization.update', 'purchases.view', 'reports.view', 'reports.financial', 'suppliers.view'],
  branches: [
    { id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true },
    { id: 'b-2', code: 'NORTH', name: 'North', is_active: true },
  ],
  ai_enabled: aiEnabled,
})

const answer = {
  answer: 'গত সপ্তাহে সবচেয়ে বেশি বিক্রি হয়েছে **Baby Romper** (BDT 30,000.00)।\n\n- Baby Romper: 40\n- Cotton Socks: 22\n\n<img src=x onerror="window.__xss = true">',
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
      { product: 'Baby Romper', quantity: '40.000', net_sales: '30000.00' },
      { product: 'Cotton Socks', quantity: '22.000', net_sales: '4400.00' },
    ],
    totals: { quantity: '62.000', net_sales: '34400.00' },
    link: '/reports/sales_by_product?date_from=2026-10-26&date_to=2026-11-01',
  },
  tools_used: [{ name: 'sales_by_product', params: { date_from: '2026-10-26', date_to: '2026-11-01' }, ok: true }],
  usage: { input_tokens: 2100, output_tokens: 310, rounds: 2 },
  model: 'claude-sonnet',
  refused: false,
  truncated: false,
}

const insights = (aiEnabled: boolean) => ({
  facts: {
    period: 'daily', date_from: '2026-11-06', date_to: '2026-11-06', previous_from: '2026-11-05', previous_to: '2026-11-05', branch_id: null, timezone: 'Asia/Dhaka', currency: 'BDT',
    kpis: {
      net_sales: { value: '15200.00', previous: '12000.00', change: '3200.00', change_pct: '26.67' },
      orders: { value: 42, previous: 40, change: 2, change_pct: '5.00' },
    },
    top_movers: { up: [{ product_id: 'p-1', product: 'Baby Romper', net_sales: '5000.00', previous: '2500.00', change: '2500.00' }], down: [] },
    anomalies: [{ date: '2026-11-06', value: '30500.00', mean: '12000.00', stddev: '5000.00', z_score: '3.12', direction: 'spike', history_days: 28 }],
    margin_drop: null,
    return_spike: { rate: '0.50', previous_rate: '0.40', returns: '80.00', flagged: false },
    slow_movers: { days: 30, count: 1, items: [{ product_id: 'p-9', product: 'Winter Jacket', on_hand: '12.000', variants_in_stock: 2 }] },
    shortage_risk: { count: 1, stores_checked: 1, items: [{ store_id: 's-1', store: 'Shop floor', product: 'Cotton Socks', sku: 'SOCK-S', on_hand: '2.000', avg_daily: '1.300', days_of_cover: '1.5', lead_time_days: 5, suggested_purchase: '30.000', suggested_transfer: '0.000', supplier: null }] },
    omitted: [],
  },
  narrative: aiEnabled ? 'Sales were **26.7% higher** than the day before, led by Baby Romper.' : null,
  narrative_status: aiEnabled ? 'ok' : 'disabled',
  ai_enabled: aiEnabled,
  generated_at: '2026-11-07T07:30:00+06:00',
  cached: true,
})

const segment = (key: string, label: string, count: number, top: unknown[] = []) => ({ segment: key, label, description: `${label}.`, count, share: '10.00', net_sales: '1000.00', top_customers: top })

const customers = {
  period: { date_from: '2025-11-07', date_to: '2026-11-06' },
  branch_id: null,
  customers_analyzed: 93,
  loyalty_program_enabled: true,
  segments: [
    segment('champions', 'Champions', 12, [{ customer_id: 'c-1', name: 'Ayesha Rahman', phone_hint: '…789', orders: 18, net_sales: '42000.00', last_purchase_on: '2026-11-05', recency_days: 2, loyalty_points: 300 }]),
    segment('loyal', 'Loyal', 20), segment('potential', 'Potential', 15), segment('new', 'New', 9), segment('at_risk', 'At risk', 7), segment('hibernating', 'Hibernating', 30),
  ],
  suggestions: [{ segment: 'at_risk', code: 'remind_points', customers: 4, points: 1250, value: '125.00', message: 'Remind 4 at-risk customers of their 1250 unused loyalty points.' }],
  narrative: null,
  narrative_status: 'empty',
  generated_at: '2026-11-07T07:30:00+06:00',
}

const branches = [
  { id: 'b-1', code: 'MAIN', name: 'Main Branch', email: null, phone: null, address: null, timezone: null, is_active: true, allow_negative_stock: false, created_at: '2026-10-01T00:00:00Z', stores: [{ id: 's-1', code: 'FLOOR', name: 'Shop floor', is_active: true }] },
]

const suggestion = {
  variant: { id: 'v-1', sku: 'SOCK-S', product_name: 'Cotton Socks', variant_name: null, unit: 'pcs', allow_decimal: false },
  on_hand: '2.000', on_order: '0.000', in_transit: '0.000', avg_daily: '1.300', reorder_point: '10.000', target: '40.000',
  suggested_purchase: '30.000', suggested_transfer: '0.000', supplier: null, unit_cost: null, lead_time_days: 5, reason: 'velocity', days_of_cover: '1.5',
}

type Options = { aiEnabled?: boolean; askReply?: { status: number; body: unknown } }

async function mockBackend(page: Page, { aiEnabled = true, askReply }: Options = {}) {
  const asks: Record<string, unknown>[] = []
  const explains: Record<string, unknown>[] = []
  const patches: Record<string, unknown>[] = []
  await page.addInitScript(() => localStorage.setItem('pos-session', JSON.stringify({ state: { activeBranchId: 'b-1' }, version: 0 })))
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: paged([]) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(meFor(aiEnabled)) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/ai/ask', (route) => {
    asks.push(route.request().postDataJSON() as Record<string, unknown>)
    return askReply ? route.fulfill({ status: askReply.status, json: askReply.body }) : route.fulfill({ json: envelope(answer) })
  })
  await page.route((url) => url.pathname === '/api/v1/ai/insights', (route) => route.fulfill({ json: envelope(insights(aiEnabled)) }))
  await page.route((url) => url.pathname === '/api/v1/ai/customer-insights', (route) => route.fulfill({ json: envelope({ ...customers, ai_enabled: aiEnabled }) }))
  await page.route('**/api/v1/ai/explain-reorder', (route) => {
    explains.push(route.request().postDataJSON() as Record<string, unknown>)
    return route.fulfill({ json: envelope({ narrative: '1. **Cotton Socks** first: 1.5 days of cover against a 5-day lead time.', status: 'ok', store: { id: 's-1', name: 'Shop floor', branch_id: 'b-1', branch_name: 'Main Branch' }, items_total: 1, items_considered: 1, to_purchase: 1, to_transfer: 0, usage: { input_tokens: 800, output_tokens: 90 }, model: 'claude-sonnet', generated_at: '2026-11-07T10:00:00+06:00' }) })
  })
  await page.route('**/api/v1/ai/settings', (route) => {
    const base = { enabled: aiEnabled, app_enabled: true, provider_configured: true, effective_enabled: aiEnabled, monthly_token_budget: null, default_monthly_token_budget: 2000000, effective_monthly_token_budget: 2000000, data_sharing_level: 'aggregates' }
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as Record<string, unknown>
      patches.push(body)
      return route.fulfill({ json: envelope({ ...base, ...body }) })
    }
    return route.fulfill({ json: envelope(base) })
  })
  await page.route('**/api/v1/ai/usage', (route) =>
    route.fulfill({ json: envelope({ month: '2026-11', budget: 2000000, budget_source: 'default', unlimited: false, used_tokens: 500000, input_tokens: 400000, output_tokens: 100000, remaining_tokens: 1500000, used_pct: '25.0', requests: 14, failed_requests: 0, by_feature: [{ feature: 'ask', requests: 10, failed: 0, input_tokens: 340000, output_tokens: 80000, tokens: 420000 }] }) }),
  )
  await page.route('**/api/v1/organization', (route) =>
    route.fulfill({ json: envelope({ id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', legal_name: null, tax_number: null, email: null, phone: null, address: null, base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active', settings: {} }) }),
  )
  await page.route((url) => url.pathname === '/api/v1/branches', (route) => route.fulfill({ json: paged(branches) }))
  await page.route((url) => url.pathname === '/api/v1/purchasing/reorder-suggestions', (route) => route.fulfill({ json: paged([suggestion]) }))
  return { asks, explains, patches }
}

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')
  expect(overflow).toBeLessThanOrEqual(1)
}

test('asks in Bangla and shows a safe answer with the report table, link and tools used', async ({ page }, info) => {
  const { asks } = await mockBackend(page)
  await page.goto('/admin/ai')

  await expect(page.getByRole('heading', { name: 'AI Insights' })).toBeVisible()
  if (!info.project.name.startsWith('mobile')) {
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'AI Insights' })).toHaveAttribute('aria-current', 'page')
  }
  const question = 'গত সপ্তাহে সবচেয়ে বেশি বিক্রি হওয়া পণ্য কোনটি?'
  await page.getByRole('textbox', { name: 'Your question' }).fill(question)
  await page.getByRole('button', { name: 'Ask', exact: true }).click()

  const card = page.getByTestId('ai-answer')
  await expect(card.getByText('Baby Romper', { exact: true }).first()).toBeVisible()
  expect(asks).toEqual([{ question }])
  // Model HTML is text, never markup.
  await expect(card.getByText('<img src=x onerror="window.__xss = true">')).toBeVisible()
  expect(await page.evaluate<unknown>('window.__xss')).toBeUndefined()
  await expect(card.getByRole('table', { name: 'Sales by product' })).toBeVisible()
  await expect(card.getByTestId('report-totals')).toContainText('34,400.00')
  await card.getByText('How this was answered (1 lookup)').click()
  await expect(card.getByTestId('ai-tools-used').getByText('sales_by_product')).toBeVisible()
  await expect(card.getByTestId('ai-usage')).toContainText('2,100 input')
  await expectNoPageOverflow(page)

  await card.getByRole('link', { name: /Open full report/ }).click()
  await expect(page).toHaveURL(/\/admin\/reports\/sales_by_product\?date_from=2026-10-26&date_to=2026-11-01$/)
})

test('explains budget and availability errors', async ({ page }) => {
  await mockBackend(page, { askReply: { status: 429, body: failure('AI_BUDGET_EXCEEDED', 'Monthly AI budget exceeded.') } })
  await page.goto('/admin/ai')
  await page.getByRole('button', { name: 'Which items are low on stock?' }).click()
  const alert = page.getByTestId('ai-error-budget')
  await expect(alert).toContainText('Monthly AI budget used up')
  await alert.getByRole('link', { name: 'Open AI settings' }).click()
  await expect(page).toHaveURL(/\/admin\/organization#ai-settings$/)
  await expect(page.getByRole('heading', { name: 'AI assistant' })).toBeVisible()
})

test('shows business and customer insights with the AI summary', async ({ page }) => {
  await mockBackend(page)
  await page.goto('/admin/ai?tab=business')
  await expect(page.getByTestId('insights-narrative')).toContainText('26.7% higher')
  await expect(page.getByTestId('insight-kpi-net_sales')).toContainText('BDT 15,200.00')
  await expect(page.getByTestId('insights-anomalies')).toContainText('Unusually high')
  await expect(page.getByRole('table', { name: 'Shortage risk' })).toContainText('Cotton Socks')
  await expect(page.getByRole('table', { name: 'Slow movers' })).toContainText('Winter Jacket')
  await expectNoPageOverflow(page)

  await page.getByRole('tab', { name: 'Customers' }).click()
  await expect(page).toHaveURL(/tab=customers/)
  await expect(page.getByTestId('segment-champions')).toContainText('12')
  await expect(page.getByRole('table', { name: 'Top customers by segment' })).toContainText('•••789')
  await expect(page.getByTestId('loyalty-suggestions')).toContainText('Remind 4 at-risk customers')
  await expectNoPageOverflow(page)
})

test('with AI off the facts stay and the question box gives way to a notice', async ({ page }) => {
  await mockBackend(page, { aiEnabled: false })
  await page.goto('/admin/ai')
  await expect(page.getByTestId('ask-unavailable')).toBeVisible()
  await page.getByRole('tab', { name: 'Business insights' }).click()
  await expect(page.getByTestId('ai-off-notice')).toContainText('AI summaries are turned off')
  await expect(page.getByTestId('insight-kpi-net_sales')).toContainText('BDT 15,200.00')

  await page.goto('/admin/purchasing/reorder')
  await expect(page.getByText('Cotton Socks')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Explain with AI' })).toHaveCount(0)
})

test('explains reorder suggestions in a side panel', async ({ page }) => {
  const { explains } = await mockBackend(page)
  await page.goto('/admin/purchasing/reorder')
  await expect(page.getByText('Cotton Socks').first()).toBeVisible()
  await page.getByRole('button', { name: 'Explain with AI' }).click()
  const panel = page.getByRole('dialog', { name: 'Reorder priorities' })
  await expect(panel.getByTestId('reorder-explanation')).toContainText('1.5 days of cover')
  expect(explains).toEqual([{ store_id: 's-1' }])
  await expectNoPageOverflow(page)
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
})

test('turns AI on and sets a budget in Organization settings', async ({ page }) => {
  const { patches } = await mockBackend(page, { aiEnabled: false })
  await page.goto('/admin/organization')
  const card = page.locator('#ai-settings')
  await expect(card.getByTestId('ai-usage-tokens')).toHaveText('500,000')
  await card.getByRole('switch', { name: 'Enable AI for this organization' }).click()
  await card.getByRole('textbox', { name: 'Monthly token budget' }).fill('750000')
  await card.getByRole('button', { name: 'Save AI settings' }).click()
  await expect(page.getByText('AI settings saved.')).toBeVisible()
  expect(patches).toEqual([{ enabled: true, monthly_token_budget: 750000 }])
  await expectNoPageOverflow(page)
})
