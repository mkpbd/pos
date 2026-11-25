import { expect, test, type Page } from '@playwright/test'

/**
 * POS1b admin, mocked API: a customer's store credit (advance, adjust, pay out), the Gift cards page
 * (list, detail, issue a voucher with its code shown once, void), a return refunded to a credit note
 * (code shown once) and the sale page's gift card / store credit payment rows. Desktop and mobile (375 px).
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const page1 = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })
const failure = (code: string, message: string, details: Record<string, unknown> = {}) => ({ success: false, error: { code, message, details }, meta: { request_id: 'e2e' } })

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: 'XSRF-TOKEN', value: 'e2e-token', url: baseURL ?? 'http://localhost:5173' }])
})

const PERMISSIONS = [
  'branches.view', 'customers.view', 'payments.collect', 'store_credit.view', 'store_credit.manage', 'gift_cards.view', 'gift_cards.manage',
  'sales.view', 'returns.view', 'returns.create', 'returns.approve',
]

const me = {
  user: { id: 'u-1', name: 'Mina Manager', email: 'mina@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-2', name: 'Branch Manager', system_key: 'branch_manager' }],
  permissions: PERMISSIONS,
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
  two_factor: { enabled: false, required: false, setup_required: false },
  pin_set: true,
}

const branches = [{
  id: 'b-1', code: 'MAIN', name: 'Main Branch', email: null, phone: null, address: null, timezone: null, is_active: true, allow_negative_stock: false, created_at: '2026-10-01T00:00:00Z',
  stores: [{ id: 's-1', branch_id: 'b-1', code: 'FLOOR', name: 'Shop floor', type: 'store', is_active: true }],
}]

const customer = (balance: string) => ({
  id: 'c-1', code: 'CUS-000001', name: 'Rina Akter', phone: '01711-000000', email: null, address: null, tax_number: null,
  group: null, credit_limit: '0.00', opening_balance: '0.00', notes: null, is_active: true, archived_at: null, store_credit_balance: balance,
})

const creditEntry = (overrides: Record<string, unknown>) => ({
  id: 'sce-1', type: 'top_up', amount: '500.00', balance_after: '500.00', method: 'cash', reference_number: null, receipt_number: 'ADV-000001',
  note: null, created_by: { id: 'u-1', name: 'Mina Manager' }, created_at: '2026-11-20T06:00:00Z', ...overrides,
})

const giftCard = (overrides: Record<string, unknown> = {}) => ({
  id: 'gc-1', code_last4: 'K7QP', kind: 'gift_card', initial_value: '1000.00', balance: '650.00', currency: 'BDT', status: 'active',
  expires_at: '2027-11-25T00:00:00Z', expired: false, customer: { id: 'c-1', name: 'Rina Akter' }, issued_by: { id: 'u-4', name: 'Pos Cashier' },
  issued_at: '2026-11-25T06:00:00Z', ...overrides,
})

const saleCustomer = { id: 'c-1', code: 'CUS-000001', name: 'Rina Akter', phone: null }

const sale = {
  id: 'sa-1', number: 'INV-MAIN-000050', status: 'completed', sold_at: '2026-11-25T06:00:00Z',
  store: { id: 's-1', code: 'FLOOR', name: 'Shop floor' }, branch: { id: 'b-1', name: 'Main Branch' }, customer: saleCustomer, cashier: { id: 'u-4', name: 'Pos Cashier' },
  tax_mode: 'exclusive', currency: 'BDT', subtotal: '200.00', item_discount_total: '0.00', invoice_discount_total: '0.00', tax_total: '0.00', total: '200.00',
  paid_total: '200.00', change_total: '0.00', due_total: '0.00', cancelled_at: null, cancelled_by: null, cancellation_reason: null,
  notes: null, invoice_discount: null, cost_total: null, returns: [],
  lines: [{ id: 'sl-1', variant_id: 'v-1', product_name: 'Mango Juice', variant_name: null, sku: 'JUICE', unit_code: 'pcs', quantity: '2.000', unit_price: '100.00', discount: null,
    line_subtotal: '200.00', discount_amount: '0.00', invoice_discount_share: '0.00', net_amount: '200.00', tax_rate: '0.0000', tax_amount: '0.00', line_total: '200.00',
    unit_cost: null, batches: [], serials: [], returned_serials: [], returned_quantity: '0.000', pending_return_quantity: '0.000' }],
  payments: [
    { id: 'p-1', kind: 'payment', method: 'gift_card', method_label: 'Gift card', amount: '150.00', tendered: null, reference: 'Gift card ••••K7QP', created_at: '2026-11-25T06:00:00Z', created_by: 'Pos Cashier' },
    { id: 'p-2', kind: 'payment', method: 'store_credit', method_label: 'Store credit', amount: '50.00', tendered: null, reference: null, created_at: '2026-11-25T06:00:00Z', created_by: 'Pos Cashier' },
  ],
  receipt: { organization_name: 'Berry Kids', header: null, footer: null, branch: null, timezone: 'Asia/Dhaka' },
}

const creditNoteRefund = { method: 'gift_card', method_label: 'Gift card', amount: '100.00', reference: 'Credit note ••••9WXY', created_by: 'Mina Manager', created_at: '2026-11-25T08:00:00Z' }

const returnDoc = {
  id: 'ret-1', number: 'RET-MAIN-000003', status: 'completed', sale: { id: 'sa-1', number: 'INV-MAIN-000050' },
  branch: { id: 'b-1', name: 'Main Branch' }, store: { id: 's-1', code: 'FLOOR', name: 'Shop floor' }, customer: saleCustomer,
  reason: null, notes: null, currency: 'BDT', subtotal: '100.00', tax_total: '0.00', total: '100.00',
  credited_total: '0.00', refunded_total: '100.00', requested_by: { id: 'u-1', name: 'Mina Manager' }, requested_at: '2026-11-25T08:00:00Z',
  decided_by: null, decided_at: null, rejection_reason: null,
  lines: [{ id: 'rl-1', sale_line_id: 'sl-1', variant_id: 'v-1', product_name: 'Mango Juice', variant_name: null, sku: 'JUICE', unit_code: 'pcs',
    quantity: '1.000', restock: true, net_amount: '100.00', tax_amount: '0.00', line_total: '100.00', serials: [], batches: [] }],
  refunds: [creditNoteRefund], settlement: null,
}

async function serveAdmin(page: Page) {
  const state = {
    balance: '500.00',
    entries: [creditEntry({})],
    cards: [giftCard()],
    topUps: [] as Record<string, unknown>[],
    adjustments: [] as Record<string, unknown>[],
    withdrawals: [] as Record<string, unknown>[],
    vouchers: [] as Record<string, unknown>[],
    voids: [] as Record<string, unknown>[],
    returns: [] as Record<string, unknown>[],
  }
  const change = (type: string, amount: string, extra: Record<string, unknown> = {}) => {
    const cents = Math.round(Number(state.balance) * 100) + Math.round(Number(amount) * 100)
    state.balance = (cents / 100).toFixed(2)
    const entry = creditEntry({ id: `sce-${state.entries.length + 1}`, type, amount, balance_after: state.balance, created_at: '2026-11-25T07:00:00Z', ...extra })
    state.entries = [entry, ...state.entries]
    return envelope({ entry, balance: state.balance, receipt_number: entry.receipt_number })
  }

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
      case 'GET /branches':
        return route.fulfill({ json: page1(branches) })
      case 'GET /customers':
        return route.fulfill({ json: page1([customer(state.balance)]) })
      case 'GET /customer-groups':
        return route.fulfill({ json: envelope([]) })
      case 'GET /loyalty/settings':
        return route.fulfill({ json: envelope({ is_enabled: false, spend_amount: '100.00', points_per_spend: 1, point_value: '1.00', min_redeem_points: 0 }) })
      case 'GET /loyalty/customers/c-1':
        return route.fulfill({ json: envelope({ customer: saleCustomer, balance: 0, lifetime_earned: 0, lifetime_redeemed: 0, transactions: [] }) })
      case 'GET /customers/c-1':
        return route.fulfill({ json: envelope({ ...customer(state.balance), online_account: null }) })
      case 'GET /customers/c-1/web-activity':
        return route.fulfill({ json: envelope({ account: null, orders: { count: 0, total_spent: '0.00', last_order_at: null, average_order: null }, returns_count: 0, reviews: { count: 0, pending: 0 }, wishlist_count: 0, cart: null, recent_orders: [] }) })
      case 'GET /customers/c-1/statement':
        return route.fulfill({ json: envelope({ customer: { ...saleCustomer, credit_limit: '0.00' }, opening_balance: '0.00', entries: [], closing_balance: '0.00' }) })
      case 'GET /customers/c-1/store-credit':
        return route.fulfill({ json: envelope({ balance: state.balance, currency: 'BDT', last_activity_at: '2026-11-25T07:00:00Z' }) })
      case 'GET /customers/c-1/store-credit/entries':
        return route.fulfill({ json: page1(state.entries) })
      case 'POST /customers/c-1/store-credit/top-ups': {
        const body = request.postDataJSON() as { amount: string; method: string }
        state.topUps.push(body)
        if (body.method === 'cash') return route.fulfill({ status: 422, json: failure('CASH_SESSION_REQUIRED', 'Open a register session to take cash.') })
        return route.fulfill({ status: 201, json: change('top_up', body.amount, { method: body.method, receipt_number: 'ADV-000002' }) })
      }
      case 'POST /customers/c-1/store-credit/adjustments': {
        const body = request.postDataJSON() as { amount: string; reason: string }
        state.adjustments.push(body)
        return route.fulfill({ status: 201, json: change('adjustment', body.amount, { method: null, receipt_number: null, note: body.reason }) })
      }
      case 'POST /customers/c-1/store-credit/withdrawals': {
        const body = request.postDataJSON() as { amount: string; method: string }
        state.withdrawals.push(body)
        return route.fulfill({ status: 201, json: change('withdrawal', `-${body.amount}`, { method: body.method, receipt_number: 'ADW-000001' }) })
      }
      case 'GET /gift-cards':
        return route.fulfill({ json: page1(state.cards) })
      case 'GET /gift-cards/gc-1':
        return route.fulfill({
          json: envelope({
            ...state.cards.find((c) => c.id === 'gc-1'), sale_receipt_number: 'GCS-000001',
            entries: [
              { id: 'e-1', type: 'issue', amount: '1000.00', balance_after: '1000.00', reference_number: 'GCS-000001', created_by: { id: 'u-4', name: 'Pos Cashier' }, created_at: '2026-11-25T06:00:00Z' },
              { id: 'e-2', type: 'redeem', amount: '-350.00', balance_after: '650.00', reference_number: 'INV-MAIN-000050', created_by: { id: 'u-4', name: 'Pos Cashier' }, created_at: '2026-11-25T06:30:00Z' },
            ],
          }),
        })
      case 'POST /gift-cards/vouchers': {
        const body = request.postDataJSON() as Record<string, unknown>
        state.vouchers.push(body)
        state.cards = [giftCard({ id: 'gc-2', code_last4: '6789', kind: 'voucher', initial_value: '250.00', balance: '250.00', customer: null, expires_at: null }), ...state.cards]
        return route.fulfill({ status: 201, json: envelope({ gift_card: { id: 'gc-2', code: 'ABCD2345EFGH6789', code_last4: '6789', kind: 'voucher', balance: '250.00', currency: 'BDT', expires_at: null, customer: null }, receipt_number: null }) })
      }
      case 'POST /gift-cards/gc-1/void': {
        state.voids.push(request.postDataJSON() as Record<string, unknown>)
        state.cards = state.cards.map((c) => (c.id === 'gc-1' ? { ...c, status: 'void', balance: '0.00' } : c))
        return route.fulfill({ json: envelope(state.cards.find((c) => c.id === 'gc-1')) })
      }
      case 'GET /sales/sa-1':
        return route.fulfill({ json: envelope(sale) })
      case 'GET /return-reasons':
        return route.fulfill({ json: envelope([]) })
      case 'POST /returns/preview':
        return route.fulfill({
          json: envelope({
            lines: [{ sale_line_id: 'sl-1', product_name: 'Mango Juice', quantity: '1.000', restock: true, serials: [], net_amount: '100.00', tax_amount: '0.00', line_total: '100.00' }],
            subtotal: '100.00', tax_total: '0.00', total: '100.00',
            settlement: { credit: '0.00', refund_due: '100.00', refundable: [{ method: 'cash', label: 'Cash', max: null }, { method: 'store_credit', label: 'Store credit', max: null }, { method: 'gift_card', label: 'Gift card', max: null }] },
            completes_immediately: true,
          }),
        })
      case 'POST /returns': {
        state.returns.push(request.postDataJSON() as Record<string, unknown>)
        return route.fulfill({ status: 201, json: envelope({ ...returnDoc, credit_note: { code: 'MNPQ4567RSTU9WXY', code_last4: '9WXY', amount: '100.00', expires_at: '2027-11-25T00:00:00Z' } }) })
      }
      case 'GET /returns/ret-1':
        return route.fulfill({ json: envelope(returnDoc) })
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

test('a manager takes an advance, adjusts and pays out a customer’s store credit', async ({ page, isMobile }) => {
  await phoneWidth(page, isMobile)
  const state = await serveAdmin(page)
  await page.goto('/admin/customers')

  await expect(page.getByRole('columnheader', { name: 'Store credit' })).toBeVisible()
  await expect(page.getByRole('row', { name: /Rina Akter/ })).toContainText('BDT 500.00')
  await page.getByRole('button', { name: 'Account of Rina Akter' }).click()
  const card = page.getByRole('region', { name: 'Store credit' })
  await expect(card.getByTestId('store-credit-balance')).toHaveText('BDT 500.00')
  await expect(card.getByRole('table', { name: 'Store credit entries' })).toContainText('ADV-000001')

  await card.getByRole('button', { name: 'Add advance' }).click()
  let dialog = page.getByRole('dialog', { name: 'Add advance' })
  await expect(dialog.getByRole('combobox', { name: 'Store' })).toContainText('Shop floor')
  await dialog.getByLabel('Amount (BDT)').fill('300')
  await dialog.getByRole('button', { name: 'Add advance' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Open a register session to take cash.')
  await dialog.getByRole('combobox', { name: 'Method' }).click()
  await page.getByRole('option', { name: 'Card' }).click()
  await dialog.getByLabel('Reference').fill('VISA 4242')
  await expectNoHorizontalScroll(page)
  await dialog.getByRole('button', { name: 'Add advance' }).click()
  await expect(dialog).toBeHidden()
  await expect(card.getByTestId('store-credit-balance')).toHaveText('BDT 800.00')
  await expect(card.getByRole('table', { name: 'Store credit entries' })).toContainText('ADV-000002')

  await card.getByRole('button', { name: 'Adjust' }).click()
  dialog = page.getByRole('dialog', { name: 'Adjust store credit' })
  await dialog.getByLabel(/Amount/).fill('-900')
  await dialog.getByLabel('Reason').fill('Charged twice')
  await dialog.getByRole('button', { name: 'Adjust' }).click()
  await expect(dialog.getByText('The balance cannot go below zero (it is BDT 800.00).')).toBeVisible()
  await dialog.getByLabel(/Amount/).fill('-100')
  await dialog.getByRole('button', { name: 'Adjust' }).click()
  await expect(dialog).toBeHidden()
  await expect(card.getByTestId('store-credit-balance')).toHaveText('BDT 700.00')

  await card.getByRole('button', { name: 'Pay out' }).click()
  dialog = page.getByRole('dialog', { name: 'Pay out store credit' })
  await dialog.getByLabel('Amount (BDT)').fill('200')
  await dialog.getByRole('combobox', { name: 'Method' }).click()
  await page.getByRole('option', { name: 'Mobile banking' }).click()
  await dialog.getByRole('button', { name: 'Pay out' }).click()
  await expect(dialog).toBeHidden()
  await expect(card.getByTestId('store-credit-balance')).toHaveText('BDT 500.00')

  expect(state.topUps).toEqual([{ store_id: 's-1', amount: '300', method: 'cash' }, { store_id: 's-1', amount: '300', method: 'card', reference: 'VISA 4242' }])
  expect(state.adjustments).toEqual([{ amount: '-100', reason: 'Charged twice' }])
  expect(state.withdrawals).toEqual([{ store_id: 's-1', amount: '200', method: 'mobile_banking' }])
})

test('gift cards: open from the menu, see a card, issue a voucher shown once and void a card', async ({ page, isMobile }) => {
  await phoneWidth(page, isMobile)
  const state = await serveAdmin(page)
  await page.goto('/admin/customers')
  await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible()

  if (isMobile) await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Gift cards' }).click()
  await expect(page.getByRole('heading', { name: 'Gift cards', level: 1 })).toBeVisible()
  const table = page.getByRole('table', { name: 'Gift cards' })
  await expect(table.getByRole('row', { name: /••••K7QP/ })).toContainText('BDT 650.00')
  await expectNoHorizontalScroll(page)

  await table.getByRole('button', { name: 'View ••••K7QP' }).click()
  const sheet = page.getByRole('dialog', { name: 'Gift card ••••K7QP' })
  await expect(sheet.getByTestId('gift-card-balance')).toHaveText('BDT 650.00')
  await expect(sheet.getByRole('table', { name: 'Gift card entries' })).toContainText('INV-MAIN-000050')
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()

  await page.getByRole('button', { name: 'Issue voucher' }).click()
  const dialog = page.getByRole('dialog', { name: 'Issue voucher' })
  await dialog.getByLabel('Amount (BDT)').fill('250')
  await dialog.getByLabel('Reason').fill('Late delivery')
  await dialog.getByRole('checkbox', { name: 'No expiry' }).click()
  await dialog.getByRole('button', { name: 'Issue voucher' }).click()
  const shown = page.getByRole('dialog', { name: 'Voucher issued' })
  await expect(shown.getByTestId('gift-code')).toHaveText('ABCD-2345-EFGH-6789')
  await expect(shown.getByText('Copy or print the code now — it won’t be shown again.')).toBeVisible()
  await expectNoHorizontalScroll(page)
  await shown.getByRole('button', { name: 'Done' }).click()
  await expect(shown).toBeHidden()
  await expect(page.getByText('ABCD-2345-EFGH-6789')).toHaveCount(0)
  await expect(table.getByRole('row', { name: /••••6789/ })).toContainText('Voucher')
  expect(state.vouchers).toEqual([{ amount: '250', reason: 'Late delivery', expires_at: null, never_expires: true }])

  await table.getByRole('button', { name: 'Void ••••K7QP' }).click()
  const voiding = page.getByRole('dialog', { name: 'Void gift card ••••K7QP?' })
  await voiding.getByLabel('Reason').fill('Reported lost')
  await voiding.getByRole('button', { name: 'Void', exact: true }).click()
  await voiding.getByRole('button', { name: 'Void now' }).click()
  await expect(voiding).toBeHidden()
  await expect(table.getByRole('row', { name: /••••K7QP/ }).getByText('Void', { exact: true })).toBeVisible()
  expect(state.voids).toEqual([{ reason: 'Reported lost' }])
})

test('a return refunded to a credit note shows its code once; the sale shows stored value payments', async ({ page, isMobile }) => {
  await phoneWidth(page, isMobile)
  const state = await serveAdmin(page)
  await page.goto('/admin/sales/sa-1')

  await expect(page.getByRole('heading', { name: 'INV-MAIN-000050' })).toBeVisible()
  const payments = page.getByTestId('sale-payment')
  await expect(payments.nth(0)).toContainText('Gift card ••••K7QP')
  await expect(payments.nth(1)).toContainText('Store credit')
  await expectNoHorizontalScroll(page)

  await page.goto('/admin/sales/sa-1/return')
  await page.getByLabel('Quantity to return of line 1').fill('1')
  await page.getByRole('button', { name: 'Calculate refund' }).click()
  await page.getByRole('combobox', { name: 'Refund method 1' }).click()
  await expect(page.getByRole('option', { name: 'Store credit' })).toBeVisible()
  await page.getByRole('option', { name: 'Gift card (credit note)' }).click()
  await expect(page.getByText('Issues a new credit note code, shown once.')).toBeVisible()
  await expectNoHorizontalScroll(page)
  await page.getByRole('button', { name: 'Complete return' }).click()

  const shown = page.getByRole('dialog', { name: 'Credit note issued' })
  await expect(shown.getByTestId('gift-code')).toHaveText('MNPQ-4567-RSTU-9WXY')
  await expect(shown).toContainText('RET-MAIN-000003')
  await expectNoHorizontalScroll(page)
  await shown.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('heading', { name: 'RET-MAIN-000003' })).toBeVisible()
  await expect(page.getByText('Credit note ••••9WXY')).toBeVisible()
  await expect(page.getByText('MNPQ-4567-RSTU-9WXY')).toHaveCount(0)
  expect(state.returns[0]?.refunds).toEqual([{ method: 'gift_card', amount: '100.00', reference: null }])
})
