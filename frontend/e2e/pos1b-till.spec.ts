import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * POS1b at the till against a mocked API: paying with store credit and a gift card (checked by
 * code), selling a gift card (its code shown once and never stored), a customer advance and a
 * gift card balance check. Runs on desktop and mobile.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const paged = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 48, total: items.length, last_page: 1 } })

const org = { id: 'o-1', name: 'Corner Shop', slug: 'corner-shop', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' }
const branch = { id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }
const salma = {
  user: { id: 'u-4', name: 'Salma Cashier', email: 'u-4@corner.test', phone: null, is_platform_admin: false, last_login_at: null, pin_set: true },
  pin_set: true, organization: org, roles: [{ id: 'r-3', name: 'Cashier', system_key: 'cashier' }], branches: [branch],
  permissions: ['branches.view', 'cash_registers.operate', 'customers.view', 'payments.collect', 'pos.sell', 'products.view', 'sales.view', 'store_credit.view'],
  two_factor: { enabled: false, required: false, setup_required: false },
}
const branches = [{
  id: 'b-1', code: 'MAIN', name: 'Main Branch', email: null, phone: null, address: null, timezone: null, is_active: true, allow_negative_stock: false, created_at: '2026-10-01T00:00:00Z',
  stores: [{ id: 's-1', branch_id: 'b-1', code: 'FLOOR', name: 'Shop floor', type: 'store', is_active: true }],
}]
const session = {
  id: 'ses-1', number: 'SES-MAIN-000001', status: 'open', currency: 'BDT', branch: { id: 'b-1', code: 'MAIN', name: 'Main Branch' },
  register: { id: 'reg-1', code: 'REG-01', name: 'Counter 1' }, opening_float: '500.00', opened_by: { id: 'u-4', name: 'Salma Cashier' }, opened_at: '2026-12-08T03:00:00Z',
  expected_cash: null, counted_cash: null, variance: null, closing_notes: null, closed_by: null, closed_at: null,
  cash: { opening_float: '500.00', cash_in: '0.00', cash_out: '0.00', expected: '500.00', counted: null, variance: null }, by_method: [], by_source: [], entries: [],
}
const juice = {
  variant_id: 'v-1', product_id: 'p-1', product_name: 'Mango Juice', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', allow_decimal: false,
  price: '25.00', tax_rate: '0.0000', max_discount_percent: null, track_stock: true, track_batches: false, track_serials: false,
  category_id: null, image_url: null, on_hand: '12.000', sellable: true, open_price: false,
}
const rahim = { id: 'c-1', code: 'C-0001', name: 'Rahim Uddin', phone: '01711000000' }
const rahimRow = { ...rahim, email: null, address: null, tax_number: null, group: null, credit_limit: '0.00', opening_balance: '0.00', notes: null, is_active: true, archived_at: null, store_credit_balance: '30.00' }
const CODE = 'ABCD-EFGH-JKLM-NPQR'
const money = (n: number) => n.toFixed(2)

function priceCart(body: { customer_id: string | null; lines: { quantity: string }[] }) {
  const total = body.lines.reduce((s, l) => s + 25 * Number(l.quantity), 0)
  return {
    store: { id: 's-1', code: 'FLOOR', name: 'Shop floor', branch_id: 'b-1', branch_name: 'Main Branch' },
    customer: body.customer_id ? { ...rahim, group_discount_percent: '0.00', credit: { outstanding: '0.00', credit_limit: '0.00', available: '0.00' } } : null,
    currency: 'BDT', tax_mode: 'exclusive',
    lines: body.lines.map((l, i) => ({
      position: i, variant_id: 'v-1', product_name: 'Mango Juice', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', allow_decimal: false, track_stock: true, track_serials: false,
      max_discount_percent: null, quantity: l.quantity, unit_price: '25.00', tax_rate: '0.0000', discount: null, available: '12.000',
      line_subtotal: money(25 * Number(l.quantity)), discount_amount: '0.00', invoice_discount_share: '0.00', net_amount: money(25 * Number(l.quantity)),
      tax_amount: '0.00', line_total: money(25 * Number(l.quantity)), list_price: '25.00', price_source: 'catalog', price_approved_by: null, open_price: false, promotion: null,
    })),
    invoice_discount: null, subtotal: money(total), item_discount_total: '0.00', invoice_discount_total: '0.00', discount_total: '0.00',
    net_total: money(total), tax_total: '0.00', total: money(total), promotions: [], coupon: null, savings_total: '0.00', discount_approved_by: null,
  }
}

const payment = (id: string, method: string, label: string, amount: string, reference: string | null = null) => ({
  id, kind: 'payment', method, method_label: label, amount, tendered: method === 'cash' ? amount : null, reference, created_at: '2026-12-08T06:00:00Z', created_by: 'Salma Cashier',
})
const sale = {
  id: 'sa-1', number: 'INV-MAIN-000007', status: 'completed', sold_at: '2026-12-08T06:00:00Z',
  store: { id: 's-1', code: 'FLOOR', name: 'Shop floor' }, branch: { id: 'b-1', name: 'Main Branch' }, customer: rahim, cashier: { id: 'u-4', name: 'Salma Cashier' },
  tax_mode: 'exclusive', currency: 'BDT', subtotal: '75.00', item_discount_total: '0.00', invoice_discount_total: '0.00', tax_total: '0.00', total: '75.00',
  paid_total: '75.00', change_total: '0.00', due_total: '0.00', cancelled_at: null, cancelled_by: null, cancellation_reason: null,
  notes: null, invoice_discount: null, cost_total: null, lines: [], returns: [],
  payments: [payment('p-1', 'store_credit', 'Store credit', '30.00'), payment('p-2', 'gift_card', 'Gift card', '40.00', 'Gift card ••••NPQR'), payment('p-3', 'cash', 'Cash', '5.00')],
  receipt: { organization_name: 'Corner Shop', header: null, footer: null, branch: null, timezone: 'Asia/Dhaka', customer_store_credit_balance: '0.00' },
  promotions: [], coupon_code: null, savings_total: '0.00', discount_approved_by: null,
}

type Till = { checkouts: Record<string, unknown>[]; lookups: unknown[]; sells: unknown[]; topUps: unknown[] }

async function mockTill(page: Page): Promise<Till> {
  const till: Till = { checkouts: [], lookups: [], sells: [], topUps: [] }
  await page.addInitScript(() => localStorage.setItem('pos-session', JSON.stringify({ state: { activeBranchId: 'b-1' }, version: 0 })))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/**', (route: Route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, '')
    const body = () => request.postDataJSON() as Record<string, unknown>
    switch (`${request.method()} ${path}`) {
      case 'GET /auth/me':
        return route.fulfill({ json: envelope(salma) })
      case 'GET /pos/terminal':
        return route.fulfill({ status: 404, json: { success: false, error: { code: 'TERMINAL_NOT_FOUND', message: 'Not a till.', details: {} }, meta: {} } })
      case 'GET /branches':
        return route.fulfill({ json: paged(branches) })
      case 'GET /register-sessions/current':
        return route.fulfill({ json: envelope(session) })
      case 'GET /loyalty/settings':
        return route.fulfill({ json: envelope({ is_enabled: false, spend_amount: '100.00', points_per_spend: 1, point_value: '1.00', min_redeem_points: 0 }) })
      case 'GET /pos/catalog':
        return route.fulfill({ json: paged([juice]) })
      case 'GET /customers':
        return route.fulfill({ json: paged([rahimRow]) })
      case 'GET /customers/c-1/store-credit':
        return route.fulfill({ json: envelope({ balance: '30.00', currency: 'BDT', last_activity_at: null }) })
      case 'POST /pos/price':
        return route.fulfill({ json: envelope(priceCart(body() as never)) })
      case 'POST /gift-cards/lookup': {
        till.lookups.push(body())
        return route.fulfill({ json: envelope({ id: 'gc-1', code_last4: 'NPQR', kind: 'gift_card', balance: '40.00', currency: 'BDT', status: 'active', expires_at: '2027-12-08T00:00:00Z', usable: true, reason: null }) })
      }
      case 'POST /pos/checkout':
        till.checkouts.push(body())
        return route.fulfill({ status: 201, json: envelope(sale) })
      case 'POST /gift-cards/sell':
        till.sells.push(body())
        return route.fulfill({ status: 201, json: envelope({
          gift_card: { id: 'gc-9', code: CODE, code_last4: 'NPQR', kind: 'gift_card', balance: '1000.00', currency: 'BDT', expires_at: '2027-12-08T00:00:00Z', customer: null },
          receipt_number: 'GCS-000001',
        }) })
      case 'POST /customers/c-1/store-credit/top-ups':
        till.topUps.push(body())
        return route.fulfill({ status: 201, json: envelope({
          entry: { id: 'e-1', type: 'top_up', amount: '500.00', balance_after: '530.00', method: 'cash', reference_number: null, receipt_number: 'ADV-000001', note: null, created_by: { id: 'u-4', name: 'Salma Cashier' }, created_at: '2026-12-08T06:00:00Z' },
          balance: '530.00', receipt_number: 'ADV-000001',
        }) })
      case 'GET /notifications/unread-count':
        return route.fulfill({ json: envelope({ count: 0 }) })
      default:
        return route.fulfill({ json: paged([]) })
    }
  })
  return till
}

const cart = (page: Page) => page.getByRole('complementary', { name: 'Current sale' })

async function chooseRahim(page: Page) {
  await page.getByRole('button', { name: 'Customer' }).click()
  const option = page.getByRole('option', { name: /Rahim Uddin/ })
  await expect(option).toContainText('Store credit 30.00')
  await option.click()
}

test('pays with store credit, a gift card and cash; the receipt names the card by its last four', async ({ page }) => {
  const till = await mockTill(page)
  await page.goto('/admin/pos')

  await chooseRahim(page)
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: /^Mango Juice/ }).click()
  await expect(cart(page).getByTestId('cart-total')).toHaveText('BDT 75.00')
  await expect(cart(page).getByTestId('cart-store-credit')).toContainText('store credit BDT 30.00')

  await cart(page).getByRole('button', { name: /^Pay/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Payment' })
  await dialog.getByRole('button', { name: 'Store credit (30.00)' }).click()
  await expect(dialog.getByLabel('Amount of payment 1')).toHaveValue('30.00')
  await expect(dialog.getByLabel('Amount of payment 2')).toHaveValue('45.00')

  await dialog.getByRole('button', { name: 'Gift card' }).click()
  await dialog.getByLabel('Gift card code of payment 3').fill('abcd efgh jklm npqr')
  await dialog.getByLabel('Gift card code of payment 3').press('Enter')
  await expect(dialog.getByTestId('gift-card-status')).toContainText('Gift card ••••NPQR · balance BDT 40.00')
  await expect(dialog.getByLabel('Amount of payment 2')).toHaveValue('5.00')
  await expect(dialog.getByLabel('Amount of payment 3')).toHaveValue('40.00')
  await dialog.getByRole('button', { name: 'Complete sale' }).click()

  const receipt = page.getByTestId('receipt')
  await expect(receipt).toContainText('Gift card ••••NPQR')
  await expect(receipt).toContainText('Store credit left')
  expect(till.lookups).toEqual([{ code: 'ABCDEFGHJKLMNPQR' }])
  expect(till.checkouts[0]?.payments).toEqual([
    { method: 'store_credit', amount: '30.00', reference: null },
    { method: 'cash', amount: '5.00', reference: null },
    { method: 'gift_card', amount: '40.00', reference: 'ABCDEFGHJKLMNPQR' },
  ])
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('ABCDEFGHJKLMNPQR')
})

test('sells a gift card and shows its code once; takes an advance; checks a balance', async ({ page }) => {
  const till = await mockTill(page)
  await page.goto('/admin/pos')
  await expect(page.getByRole('button', { name: /^Mango Juice/ })).toBeVisible()

  await page.getByRole('button', { name: 'Cards & credit' }).click()
  await page.getByRole('menuitem', { name: 'Sell gift card' }).click()
  const sell = page.getByRole('dialog', { name: 'Sell gift card' })
  await sell.getByLabel('Card value').fill('1000')
  await sell.getByRole('button', { name: 'Sell gift card' }).click()
  const sold = page.getByRole('dialog', { name: 'Gift card sold' })
  await expect(sold.getByTestId('gift-card-code')).toHaveText(CODE)
  await expect(sold.getByTestId('stored-value-slip')).toContainText('GCS-000001')
  expect(till.sells).toEqual([{ store_id: 's-1', amount: '1000', payments: [{ method: 'cash', amount: '1000', reference: null }] }])
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('ABCD')
  await sold.getByRole('button', { name: 'Done' }).click()
  await expect(sold).toHaveCount(0)
  await expect(page.getByText(CODE)).toHaveCount(0)

  await chooseRahim(page)
  await page.getByRole('button', { name: 'Cards & credit' }).click()
  await page.getByRole('menuitem', { name: 'Customer advance' }).click()
  const advance = page.getByRole('dialog', { name: 'Customer advance' })
  await expect(advance).toContainText('Current store credit: BDT 30.00.')
  await advance.getByLabel('Amount').fill('500')
  await advance.getByRole('button', { name: 'Take advance' }).click()
  const received = page.getByRole('dialog', { name: 'Advance received' })
  await expect(received).toContainText('ADV-000001 · Rahim Uddin now has BDT 530.00 of store credit.')
  expect(till.topUps).toEqual([{ store_id: 's-1', amount: '500', method: 'cash', reference: null, note: null }])
  await received.getByRole('button', { name: 'Done' }).click()

  await page.getByRole('button', { name: 'Cards & credit' }).click()
  await page.getByRole('menuitem', { name: 'Gift card balance' }).click()
  const balance = page.getByRole('dialog', { name: 'Gift card balance' })
  await balance.getByLabel('Gift card code').fill(CODE)
  await balance.getByRole('button', { name: 'Check' }).click()
  await expect(balance.getByTestId('gift-card-balance')).toContainText('BDT 40.00')
  await expect(balance.getByTestId('gift-card-balance')).toContainText('Can pay')
})
