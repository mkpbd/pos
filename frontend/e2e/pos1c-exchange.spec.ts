import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * POS1c exchanges at the till against a mocked API: find the invoice by number, choose what comes
 * back, check its value, ring up the new items in exchange mode, then pay the difference (after a
 * manager's PIN approval of the return) or refund it (a credit note's code shown once).
 * Runs on desktop and mobile.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const paged = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 48, total: items.length, last_page: 1 } })
const money = (n: number) => n.toFixed(2)

const org = { id: 'o-1', name: 'Corner Shop', slug: 'corner-shop', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' }
const branch = { id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }
const person = (permissions: string[]) => ({
  user: { id: 'u-4', name: 'Salma Cashier', email: 'u-4@corner.test', phone: null, is_platform_admin: false, last_login_at: null, pin_set: true },
  pin_set: true, organization: org, roles: [{ id: 'r-3', name: 'Cashier', system_key: 'cashier' }], branches: [branch],
  permissions: ['branches.view', 'cash_registers.operate', 'customers.view', 'payments.collect', 'pos.sell', 'products.view', 'returns.create', 'returns.view', 'sales.view', ...permissions],
  two_factor: { enabled: false, required: false, setup_required: false },
})
const branches = [{
  id: 'b-1', code: 'MAIN', name: 'Main Branch', email: null, phone: null, address: null, timezone: null, is_active: true, allow_negative_stock: false, created_at: '2026-10-01T00:00:00Z',
  stores: [{ id: 's-1', branch_id: 'b-1', code: 'FLOOR', name: 'Shop floor', type: 'store', is_active: true }],
}]
const session = {
  id: 'ses-1', number: 'SES-MAIN-000001', status: 'open', currency: 'BDT', branch: { id: 'b-1', code: 'MAIN', name: 'Main Branch' },
  register: { id: 'reg-1', code: 'REG-01', name: 'Counter 1' }, opening_float: '500.00', opened_by: { id: 'u-4', name: 'Salma Cashier' }, opened_at: '2026-12-09T03:00:00Z',
  expected_cash: null, counted_cash: null, variance: null, closing_notes: null, closed_by: null, closed_at: null,
  cash: { opening_float: '500.00', cash_in: '0.00', cash_out: '0.00', expected: '500.00', counted: null, variance: null }, by_method: [], by_source: [], entries: [],
}
const juice = {
  variant_id: 'v-1', product_id: 'p-1', product_name: 'Mango Juice', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', allow_decimal: false,
  price: '25.00', tax_rate: '0.0000', max_discount_percent: null, track_stock: true, track_batches: false, track_serials: false,
  category_id: null, image_url: null, on_hand: '12.000', sellable: true, open_price: false,
}
const rahim = { id: 'c-1', code: 'C-0001', name: 'Rahim Uddin', phone: '01711000000' }

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

const saleLine = (id: string, name: string, quantity: string, lineTotal: string, extra: Record<string, unknown> = {}) => ({
  id, variant_id: `v-${id}`, product_name: name, variant_name: null, sku: 'SKU', unit_code: 'pcs', quantity, unit_price: '25.00', discount: null,
  line_subtotal: lineTotal, discount_amount: '0.00', invoice_discount_share: '0.00', net_amount: lineTotal, tax_rate: '0.0000', tax_amount: '0.00', line_total: lineTotal,
  unit_cost: null, batches: [], serials: [], returned_serials: [], returned_quantity: '0.000', pending_return_quantity: '0.000', ...extra,
})
const invoice = {
  id: 'sa-1', number: 'INV-MAIN-000007', status: 'completed', sold_at: '2026-12-01T06:00:00Z',
  store: { id: 's-1', code: 'FLOOR', name: 'Shop floor' }, branch: { id: 'b-1', name: 'Main Branch' }, customer: rahim, cashier: { id: 'u-4', name: 'Salma Cashier' },
  tax_mode: 'exclusive', currency: 'BDT', subtotal: '575.00', item_discount_total: '0.00', invoice_discount_total: '0.00', tax_total: '0.00', total: '575.00',
  paid_total: '575.00', change_total: '0.00', due_total: '0.00', cancelled_at: null, cancelled_by: null, cancellation_reason: null,
  notes: null, invoice_discount: null, cost_total: null, payments: [], returns: [],
  lines: [saleLine('sl-1', 'Mango Juice', '3.000', '75.00', { returned_quantity: '1.000' }), saleLine('sl-2', 'Phone', '1.000', '500.00', { serials: ['SN-1'] })],
  receipt: { organization_name: 'Corner Shop', header: null, footer: null, branch: null, timezone: 'Asia/Dhaka' },
  promotions: [], coupon_code: null, savings_total: '0.00', discount_approved_by: null,
}

function preview(body: { lines: { sale_line_id: string; quantity: string; restock: boolean; serials?: string[] }[] }) {
  const lines = body.lines.map((l) => ({
    sale_line_id: l.sale_line_id, product_name: l.sale_line_id === 'sl-1' ? 'Mango Juice' : 'Phone', quantity: l.quantity, restock: l.restock, serials: l.serials ?? [],
    net_amount: '0.00', tax_amount: '0.00', line_total: money(l.sale_line_id === 'sl-1' ? 25 * Number(l.quantity) : 500),
  }))
  const total = money(lines.reduce((s, l) => s + Number(l.line_total), 0))
  return {
    lines, subtotal: total, tax_total: '0.00', total, completes_immediately: false,
    settlement: { credit: '0.00', refund_due: total, refundable: [{ method: 'cash', label: 'Cash', max: null }, { method: 'gift_card', label: 'Gift card', max: null }] },
  }
}

function exchanged(value: number, total: number, refunds: { method: string; method_label: string; amount: string }[]) {
  const applied = Math.min(value, total)
  return {
    sale: {
      ...invoice, id: 'sa-9', number: 'INV-MAIN-000010', sold_at: '2026-12-09T06:00:00Z', subtotal: money(total), total: money(total), paid_total: money(total),
      lines: [saleLine('nl-1', 'Mango Juice', money(total / 25), money(total))],
      payments: [
        { id: 'p-1', kind: 'payment', method: 'exchange', method_label: 'Exchange', amount: money(applied), tendered: null, reference: 'RET-MAIN-000003', created_at: '2026-12-09T06:00:00Z', created_by: 'Salma Cashier' },
        ...(total > applied ? [{ id: 'p-2', kind: 'payment', method: 'cash', method_label: 'Cash', amount: money(total - applied), tendered: money(total - applied), reference: null, created_at: '2026-12-09T06:00:00Z', created_by: 'Salma Cashier' }] : []),
      ],
      exchange: {
        return_id: 'r-3', return_number: 'RET-MAIN-000003', original_sale_id: 'sa-1', original_sale_number: 'INV-MAIN-000007', value: money(value), applied: money(applied),
        lines: [{ product_name: value === 500 ? 'Phone' : 'Mango Juice', variant_name: null, quantity: value === 500 ? '1.000' : '2.000', line_total: money(value) }],
      },
    },
    return: {
      id: 'r-3', number: 'RET-MAIN-000003', status: 'completed', sale: { id: 'sa-1', number: 'INV-MAIN-000007' }, branch: { id: 'b-1', name: 'Main Branch' },
      store: { id: 's-1', code: 'FLOOR', name: 'Shop floor' }, customer: rahim, reason: null, notes: null, currency: 'BDT', subtotal: money(value), tax_total: '0.00', total: money(value),
      credited_total: '0.00', refunded_total: money(value), requested_by: null, requested_at: '2026-12-09T06:00:00Z', decided_by: null, decided_at: null, rejection_reason: null,
      lines: [], settlement: null, exchange_sale: { id: 'sa-9', number: 'INV-MAIN-000010', total: money(total) },
      refunds: [{ method: 'exchange', method_label: 'Exchange', amount: money(applied) }, ...refunds].map((r) => ({ ...r, reference: null, created_by: null, created_at: '2026-12-09T06:00:00Z' })),
    },
  }
}

type Till = { previews: unknown[]; approvals: unknown[]; exchanges: Record<string, unknown>[]; keys: (string | undefined)[] }

async function mockTill(page: Page, me: unknown, respond: (body: Record<string, unknown>) => unknown): Promise<Till> {
  const till: Till = { previews: [], approvals: [], exchanges: [], keys: [] }
  await page.addInitScript(() => localStorage.setItem('pos-session', JSON.stringify({ state: { activeBranchId: 'b-1' }, version: 0 })))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/**', (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace(/^\/api\/v1/, '')
    const body = () => request.postDataJSON() as Record<string, unknown>
    switch (`${request.method()} ${path}`) {
      case 'GET /auth/me':
        return route.fulfill({ json: envelope(me) })
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
      case 'POST /pos/price':
        return route.fulfill({ json: envelope(priceCart(body() as never)) })
      case 'GET /sales':
        return route.fulfill({ json: paged(url.searchParams.get('search')?.toUpperCase() === 'INV-MAIN-000007' ? [invoice] : []) })
      case 'GET /sales/sa-1':
        return route.fulfill({ json: envelope(invoice) })
      case 'GET /return-reasons':
        return route.fulfill({ json: envelope([{ id: 'rr-1', name: 'Wrong size', restock_by_default: true, is_active: true }]) })
      case 'POST /returns/preview':
        till.previews.push(body())
        return route.fulfill({ json: envelope(preview(body() as never)) })
      case 'GET /pos/approvers':
        return route.fulfill({ json: envelope([{ id: 'u-9', name: 'Manager Mina' }]) })
      case 'POST /pos/approvals': {
        const input = body()
        till.approvals.push(input)
        return route.fulfill({ status: 201, json: envelope({ id: 'ap-1', action: input.action, approver: { id: 'u-9', name: 'Manager Mina' }, expires_at: '2026-12-09T06:10:00Z' }) })
      }
      case 'POST /pos/exchanges':
        till.exchanges.push(body())
        till.keys.push(request.headers()['idempotency-key'])
        return route.fulfill({ status: 201, json: envelope(respond(body())) })
      case 'GET /notifications/unread-count':
        return route.fulfill({ json: envelope({ count: 0 }) })
      default:
        return route.fulfill({ json: paged([]) })
    }
  })
  return till
}

const cart = (page: Page) => page.getByRole('complementary', { name: 'Current sale' })

async function findInvoice(page: Page) {
  await expect(page.getByRole('button', { name: /^Mango Juice/ })).toBeVisible()
  await page.getByRole('button', { name: 'Exchange', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Exchange items' })
  await dialog.getByLabel('Invoice number').fill('inv-main-000007')
  await dialog.getByLabel('Invoice number').press('Enter')
  return dialog
}

test('exchanges two juices for three: the manager approves the return and the customer pays the difference', async ({ page }) => {
  const till = await mockTill(page, person([]), () => exchanged(50, 75, []))
  await page.goto('/admin/pos')

  const dialog = await findInvoice(page)
  await expect(dialog.getByTestId('returnable').first()).toHaveText('2')
  await dialog.getByRole('button', { name: 'More Mango Juice' }).click()
  await dialog.getByRole('button', { name: 'More Mango Juice' }).click()
  await dialog.getByRole('button', { name: 'More Mango Juice' }).click()
  await expect(dialog.getByLabel('Return quantity of Mango Juice')).toHaveValue('2')
  await dialog.getByRole('button', { name: 'Check value' }).click()
  await expect(dialog.getByTestId('exchange-value')).toHaveText('BDT 50.00')
  await dialog.getByRole('button', { name: 'Continue' }).click()
  await expect(dialog).toHaveCount(0)

  await expect(cart(page).getByTestId('exchange-banner')).toContainText('Exchange for INV-MAIN-000007 · returned BDT 50.00')
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: /^Mango Juice/ }).click()
  await expect(cart(page).getByTestId('exchange-difference')).toHaveText('Customer pays BDT 25.00 more')
  await expect(cart(page).getByRole('button', { name: /^Hold/ })).toBeDisabled()
  await cart(page).getByRole('button', { name: /^Pay BDT 25.00/ }).click()

  const payment = page.getByRole('dialog', { name: 'Payment' })
  await expect(payment.getByTestId('exchange-credit')).toContainText('Exchange credit (INV-MAIN-000007) −BDT 50.00')
  await expect(payment.getByLabel('Amount of payment 1')).toHaveValue('25.00')
  await payment.getByRole('button', { name: 'Complete exchange' }).click()

  const approval = page.getByRole('dialog', { name: 'Approve a return' })
  await expect(approval).toContainText('Take back Mango Juice × 2 from INV-MAIN-000007')
  await expect(approval.getByRole('radio', { name: 'Manager Mina' })).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.type('9753')
  await page.keyboard.press('Enter')

  const done = page.getByRole('dialog', { name: 'Exchange INV-MAIN-000010 completed' })
  await expect(done.getByTestId('receipt')).toBeVisible()
  expect(till.previews).toEqual([{ sale_id: 'sa-1', return_reason_id: null, notes: null, lines: [{ sale_line_id: 'sl-1', quantity: '2', restock: true }] }])
  expect(till.approvals).toEqual([{ action: 'return', approver_id: 'u-9', pin: '9753', store_id: 's-1', details: { sale_id: 'sa-1' } }])
  expect(till.exchanges).toEqual([{
    return: { sale_id: 'sa-1', return_reason_id: null, notes: null, lines: [{ sale_line_id: 'sl-1', quantity: '2', restock: true }] },
    approval_id: 'ap-1', store_id: 's-1', customer_id: 'c-1', lines: [{ variant_id: 'v-1', quantity: '3', discount: null }], notes: null,
    payments: [{ method: 'cash', amount: '25.00', reference: null }],
  }])
  expect(till.keys[0]).toMatch(/^[0-9a-f-]{36}$/)
  await done.getByRole('button', { name: 'New sale' }).click()
  await expect(cart(page).getByTestId('exchange-banner')).toHaveCount(0)
})

test('returns a phone for a juice and refunds the difference in cash and as a credit note shown once', async ({ page }) => {
  const till = await mockTill(page, person(['returns.approve']), () => ({
    ...exchanged(500, 25, [{ method: 'cash', method_label: 'Cash', amount: '400.00' }, { method: 'gift_card', method_label: 'Gift card', amount: '75.00' }]),
    credit_note: { code: 'CRED-ITNO-TEAB-CD12', code_last4: 'CD12', amount: '75.00', expires_at: null },
  }))
  await page.goto('/admin/pos')

  const dialog = await findInvoice(page)
  await dialog.getByRole('checkbox', { name: 'SN-1' }).click()
  await dialog.getByRole('button', { name: 'Check value' }).click()
  await expect(dialog.getByTestId('exchange-value')).toHaveText('BDT 500.00')
  await dialog.getByRole('button', { name: 'Continue' }).click()

  await page.getByRole('button', { name: /^Mango Juice/ }).click()
  await expect(cart(page).getByTestId('exchange-difference')).toHaveText('Refund to customer BDT 475.00')
  await cart(page).getByRole('button', { name: /^Refund BDT 475.00/ }).click()

  const settle = page.getByRole('dialog', { name: 'Exchange' })
  await expect(settle.getByTestId('exchange-refund')).toHaveText('BDT 475.00')
  await expect(settle.getByLabel('Refund amount 1')).toHaveValue('475.00')
  await settle.getByLabel('Refund amount 1').fill('400')
  await settle.getByRole('button', { name: 'Add refund method' }).click()
  await expect(settle.getByLabel('Refund amount 2')).toHaveValue('75.00')
  await settle.getByRole('button', { name: 'Complete exchange' }).click()

  const note = page.getByRole('dialog', { name: 'Credit note issued' })
  await expect(note.getByTestId('gift-code')).toHaveText('CRED-ITNO-TEAB-CD12')
  expect(till.approvals).toEqual([])
  expect(till.exchanges[0]).toMatchObject({
    return: { lines: [{ sale_line_id: 'sl-2', quantity: '1', restock: true, serials: ['SN-1'] }] },
    payments: [],
    refunds: [{ method: 'cash', amount: '400', reference: null }, { method: 'gift_card', amount: '75.00', reference: null }],
  })
  expect(till.exchanges[0]).not.toHaveProperty('approval_id')
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('CRED')
  await note.getByRole('button', { name: 'Done' }).click()

  const done = page.getByRole('dialog', { name: 'Exchange INV-MAIN-000010 completed' })
  await expect(done.getByTestId('exchange-refunded')).toContainText('Refunded to customer: BDT 475.00')
  await expect(page.getByText('CRED-ITNO-TEAB-CD12')).toHaveCount(0)
})
