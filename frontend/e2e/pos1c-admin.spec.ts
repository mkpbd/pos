import { expect, test, type Page } from '@playwright/test'

/**
 * POS1c admin, mocked API: a sale made in an exchange at the till on the sales list (badge), the sale
 * page (badge, exchange card linking the return and the original invoice, the exchange payment, no
 * cancel), its receipt (exchange section), and the return on the returns list (badge) and its page
 * ("Exchanged for" link). Desktop and mobile (375 px).
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const page1 = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })
const failure = (code: string, message: string, details: Record<string, unknown> = {}) => ({ success: false, error: { code, message, details }, meta: { request_id: 'e2e' } })

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: 'XSRF-TOKEN', value: 'e2e-token', url: baseURL ?? 'http://localhost:5173' }])
})

const me = {
  user: { id: 'u-1', name: 'Mina Manager', email: 'mina@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-2', name: 'Branch Manager', system_key: 'branch_manager' }],
  permissions: ['branches.view', 'customers.view', 'sales.view', 'sales.cancel', 'returns.view', 'returns.create', 'returns.approve'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
  two_factor: { enabled: false, required: false, setup_required: false },
  pin_set: true,
}

const customer = { id: 'c-1', code: 'CUS-000001', name: 'Rina Akter', phone: null }
const today = new Date().toISOString()

const header = (overrides: Record<string, unknown> = {}) => ({
  id: 'sa-2', number: 'INV-MAIN-000061', status: 'completed', sold_at: today,
  store: { id: 's-1', code: 'FLOOR', name: 'Shop floor' }, branch: { id: 'b-1', name: 'Main Branch' }, customer, cashier: { id: 'u-4', name: 'Pos Cashier' },
  tax_mode: 'exclusive', currency: 'BDT', subtotal: '350.00', item_discount_total: '0.00', invoice_discount_total: '0.00', tax_total: '0.00', total: '350.00',
  paid_total: '350.00', change_total: '50.00', due_total: '0.00', cancelled_at: null, cancelled_by: null, cancellation_reason: null, is_exchange: true,
  ...overrides,
})

const saleLine = (id: string, variant: string, total: string, quantity = '1.000') => ({
  id, variant_id: `v-${id}`, product_name: 'Kids T-shirt', variant_name: variant, sku: `TS-${variant}`, unit_code: 'pcs', quantity, unit_price: total, discount: null,
  line_subtotal: total, discount_amount: '0.00', invoice_discount_share: '0.00', net_amount: total, tax_rate: '0.0000', tax_amount: '0.00', line_total: total,
  unit_cost: null, batches: [], serials: [], returned_serials: [], returned_quantity: '0.000', pending_return_quantity: '0.000',
})

const exchangeSale = {
  ...header(),
  notes: null, invoice_discount: null, cost_total: null, returns: [],
  lines: [saleLine('sl-9', 'Size 6', '350.00')],
  payments: [
    { id: 'p-1', kind: 'payment', method: 'exchange', method_label: 'Exchange', amount: '300.00', tendered: null, reference: 'RET-MAIN-000004', created_at: today, created_by: 'Pos Cashier' },
    { id: 'p-2', kind: 'payment', method: 'cash', method_label: 'Cash', amount: '50.00', tendered: '100.00', reference: null, created_at: today, created_by: 'Pos Cashier' },
  ],
  exchange: {
    return_id: 'ret-4', return_number: 'RET-MAIN-000004', original_sale_id: 'sa-1', original_sale_number: 'INV-MAIN-000050', value: '300.00', applied: '300.00',
    lines: [{ product_name: 'Kids T-shirt', variant_name: 'Size 4', quantity: '1.000', line_total: '300.00' }],
  },
  receipt: { organization_name: 'Berry Kids', header: null, footer: null, branch: null, timezone: 'Asia/Dhaka' },
}

const originalSale = {
  ...header({ id: 'sa-1', number: 'INV-MAIN-000050', total: '300.00', subtotal: '300.00', paid_total: '300.00', change_total: '0.00', is_exchange: false }),
  notes: null, invoice_discount: null, cost_total: null,
  lines: [{ ...saleLine('sl-1', 'Size 4', '300.00'), returned_quantity: '1.000' }],
  returns: [{ id: 'ret-4', number: 'RET-MAIN-000004', status: 'completed', total: '300.00', credited_total: '0.00', refunded_total: '300.00', requested_at: today }],
  payments: [{ id: 'p-0', kind: 'payment', method: 'cash', method_label: 'Cash', amount: '300.00', tendered: null, reference: null, created_at: today, created_by: 'Pos Cashier' }],
  exchange: null,
  receipt: { organization_name: 'Berry Kids', header: null, footer: null, branch: null, timezone: 'Asia/Dhaka' },
}

const returnHeader = (overrides: Record<string, unknown> = {}) => ({
  id: 'ret-4', number: 'RET-MAIN-000004', status: 'completed', sale: { id: 'sa-1', number: 'INV-MAIN-000050' },
  branch: { id: 'b-1', name: 'Main Branch' }, store: { id: 's-1', code: 'FLOOR', name: 'Shop floor' }, customer,
  reason: null, notes: null, currency: 'BDT', subtotal: '300.00', tax_total: '0.00', total: '300.00',
  credited_total: '0.00', refunded_total: '300.00', requested_by: { id: 'u-4', name: 'Pos Cashier' }, requested_at: today,
  decided_by: null, decided_at: null, rejection_reason: null, exchange_sale_number: 'INV-MAIN-000061',
  ...overrides,
})

const returnDoc = {
  ...returnHeader(),
  lines: [{ id: 'rl-1', sale_line_id: 'sl-1', variant_id: 'v-sl-1', product_name: 'Kids T-shirt', variant_name: 'Size 4', sku: 'TS-Size 4', unit_code: 'pcs',
    quantity: '1.000', restock: true, net_amount: '300.00', tax_amount: '0.00', line_total: '300.00', serials: [], batches: [] }],
  refunds: [{ method: 'exchange', method_label: 'Exchange', amount: '300.00', reference: 'INV-MAIN-000061', created_by: 'Pos Cashier', created_at: today }],
  settlement: null,
  exchange_sale: { id: 'sa-2', number: 'INV-MAIN-000061', total: '350.00' },
}

const summary = {
  date: today.slice(0, 10), timezone: 'Asia/Dhaka', branch_id: null, currency: 'BDT', sales_count: 2, gross_sales: '650.00', discounts: '0.00', net_sales: '650.00',
  tax: '0.00', total: '650.00', average_sale: '325.00', cost: null, gross_profit: null, paid: '650.00', due: '0.00', cancelled_count: 0, cancelled_total: '0.00',
  payments: [{ method: 'cash', label: 'Cash', amount: '350.00' }],
}

async function serveAdmin(page: Page) {
  const state = { cancels: 0 }
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204 }))
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const key = `${request.method()} ${url.pathname.replace('/api/v1', '')}`
    switch (key) {
      case 'GET /auth/me':
        return route.fulfill({ json: envelope(me) })
      case 'GET /notifications/unread-count':
        return route.fulfill({ json: envelope({ count: 0 }) })
      case 'GET /sales/summary':
        return route.fulfill({ json: envelope(summary) })
      case 'GET /sales':
        return route.fulfill({ json: page1([header(), header({ id: 'sa-1', number: 'INV-MAIN-000050', total: '300.00', is_exchange: false })]) })
      case 'GET /sales/sa-2':
        return route.fulfill({ json: envelope(exchangeSale) })
      case 'GET /sales/sa-1':
        return route.fulfill({ json: envelope(originalSale) })
      case 'POST /sales/sa-2/cancel':
        state.cancels += 1
        return route.fulfill({ status: 422, json: failure('EXCHANGE_SALE_NOT_CANCELLABLE', 'Return its items instead.') })
      case 'GET /returns':
        return route.fulfill({ json: page1([returnHeader(), returnHeader({ id: 'ret-3', number: 'RET-MAIN-000003', exchange_sale_number: null })]) })
      case 'GET /returns/ret-4':
        return route.fulfill({ json: envelope(returnDoc) })
      case 'GET /return-reasons':
        return route.fulfill({ json: envelope([]) })
    }
    if (request.method() === 'GET') return route.fulfill({ json: page1([]) })
    return route.fulfill({ status: 404, json: failure('NOT_FOUND', `No mock for ${key}`) })
  })
  return state
}

async function phoneWidth(page: Page, isMobile: boolean) {
  if (isMobile) await page.setViewportSize({ width: 375, height: 812 })
}

async function expectNoHorizontalScroll(page: Page) {
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
}

test('an exchange sale: list badge, exchange card with links, exchange payment, receipt section, no cancel', async ({ page, isMobile }) => {
  await phoneWidth(page, isMobile)
  const state = await serveAdmin(page)
  await page.goto('/admin/sales')

  const exchangedRow = page.getByRole('row', { name: /INV-MAIN-000061/ })
  await expect(exchangedRow.getByText('Exchange', { exact: true })).toBeVisible()
  await expect(page.getByRole('row', { name: /INV-MAIN-000050/ }).getByText('Exchange', { exact: true })).toHaveCount(0)
  await expectNoHorizontalScroll(page)

  await exchangedRow.getByRole('link', { name: 'INV-MAIN-000061' }).click()
  await expect(page.getByRole('heading', { name: 'INV-MAIN-000061' })).toBeVisible()
  const card = page.getByRole('region', { name: 'Exchange' })
  await expect(card.getByTestId('exchange-value')).toHaveText('BDT 300.00')
  await expect(card).toContainText('Kids T-shirt — Size 4 × 1')
  await expect(card).toContainText('can’t be cancelled')
  await expect(page.getByTestId('sale-payment').first()).toContainText('Exchange RET-MAIN-000004')
  await expect(page.getByRole('button', { name: 'Cancel sale' })).toHaveCount(0)
  await expectNoHorizontalScroll(page)

  await page.getByRole('button', { name: 'Receipt' }).click()
  const dialog = page.getByRole('dialog', { name: 'Receipt INV-MAIN-000061' })
  const section = dialog.getByTestId('receipt-exchange')
  await expect(section).toContainText('Exchange for INV-MAIN-000050 (RET-MAIN-000004)')
  await expect(section).toContainText('-300.00')
  await expect(dialog.getByTestId('receipt')).toContainText('New items')
  await expect(dialog.getByTestId('receipt')).toContainText('Exchange RET-MAIN-000004')
  await expectNoHorizontalScroll(page)
  await dialog.getByRole('button', { name: 'Close' }).first().click()
  await expect(dialog).toBeHidden()

  await card.getByRole('link', { name: 'INV-MAIN-000050' }).click()
  await expect(page.getByRole('heading', { name: 'INV-MAIN-000050' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Exchange' })).toHaveCount(0)
  await page.goBack()
  await page.getByRole('region', { name: 'Exchange' }).getByRole('link', { name: 'RET-MAIN-000004' }).click()
  await expect(page.getByRole('heading', { name: 'RET-MAIN-000004' })).toBeVisible()
  expect(state.cancels).toBe(0)
})

test('an exchange return: open Returns from the menu, badge, "Exchanged for" link to the new sale', async ({ page, isMobile }) => {
  await phoneWidth(page, isMobile)
  await serveAdmin(page)
  await page.goto('/admin/sales')
  await expect(page.getByRole('heading', { name: 'Sales', level: 1 })).toBeVisible()

  if (isMobile) await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Returns', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Sales returns', level: 1 })).toBeVisible()

  const exchanged = page.getByRole('row', { name: /RET-MAIN-000004/ })
  await expect(exchanged.getByText('Exchange', { exact: true })).toHaveAttribute('title', 'Exchanged for INV-MAIN-000061')
  await expect(page.getByRole('row', { name: /RET-MAIN-000003/ }).getByText('Exchange', { exact: true })).toHaveCount(0)
  await expectNoHorizontalScroll(page)

  await exchanged.getByRole('link', { name: 'RET-MAIN-000004' }).click()
  await expect(page.getByRole('heading', { name: 'RET-MAIN-000004' })).toBeVisible()
  await expect(page.getByText('Exchanged for')).toBeVisible()
  await expect(page.getByText('Exchange INV-MAIN-000061')).toBeVisible()
  await expectNoHorizontalScroll(page)

  await page.getByRole('link', { name: 'INV-MAIN-000061' }).click()
  await expect(page.getByRole('heading', { name: 'INV-MAIN-000061' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Exchange' })).toBeVisible()
})
