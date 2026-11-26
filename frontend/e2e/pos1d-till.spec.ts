import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * POS1d at the till against a mocked API, with a fake receipt printer on Web Serial
 * (`navigator.serial`, injected before the app loads): set the printer up once, the receipt then
 * prints by itself after a cash sale and the drawer opens (the bytes written are checked), and a
 * cashier opens the drawer without a sale after a manager's PIN approval. Desktop only: a till's
 * receipt printer hangs off a desktop browser.
 */

test.skip(({ isMobile }) => isMobile, 'Receipt printers are set up on the desktop till.')

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const paged = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 48, total: items.length, last_page: 1 } })

const org = { id: 'o-1', name: 'Corner Shop', slug: 'corner-shop', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' }
const branch = { id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }
const salma = {
  user: { id: 'u-4', name: 'Salma Cashier', email: 'u-4@corner.test', phone: null, is_platform_admin: false, last_login_at: null, pin_set: true },
  pin_set: true, organization: org, roles: [{ id: 'r-3', name: 'Cashier', system_key: 'cashier' }], branches: [branch],
  permissions: ['branches.view', 'cash_registers.operate', 'customers.view', 'payments.collect', 'pos.sell', 'products.view', 'sales.view'],
  two_factor: { enabled: false, required: false, setup_required: false },
}
const branches = [{
  id: 'b-1', code: 'MAIN', name: 'Main Branch', email: null, phone: null, address: null, timezone: null, is_active: true, allow_negative_stock: false, created_at: '2026-10-01T00:00:00Z',
  stores: [{ id: 's-1', branch_id: 'b-1', code: 'FLOOR', name: 'Shop floor', type: 'store', is_active: true }],
}]
const session = {
  id: 'ses-1', number: 'SES-MAIN-000001', status: 'open', currency: 'BDT', branch: { id: 'b-1', code: 'MAIN', name: 'Main Branch' },
  register: { id: 'reg-1', code: 'REG-01', name: 'Counter 1' }, opening_float: '500.00', opened_by: { id: 'u-4', name: 'Salma Cashier' }, opened_at: '2026-12-10T03:00:00Z',
  expected_cash: null, counted_cash: null, variance: null, closing_notes: null, closed_by: null, closed_at: null,
  cash: { opening_float: '500.00', cash_in: '0.00', cash_out: '0.00', expected: '500.00', counted: null, variance: null }, by_method: [], by_source: [], entries: [],
}
const juice = {
  variant_id: 'v-1', product_id: 'p-1', product_name: 'Mango Juice', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', allow_decimal: false,
  price: '25.00', tax_rate: '0.0000', max_discount_percent: null, track_stock: true, track_batches: false, track_serials: false,
  category_id: null, image_url: null, on_hand: '12.000', sellable: true, open_price: false,
}
const priced = {
  store: { id: 's-1', code: 'FLOOR', name: 'Shop floor', branch_id: 'b-1', branch_name: 'Main Branch' }, customer: null, currency: 'BDT', tax_mode: 'exclusive',
  lines: [{
    position: 0, variant_id: 'v-1', product_name: 'Mango Juice', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', allow_decimal: false, track_stock: true, track_serials: false,
    max_discount_percent: null, quantity: '1', unit_price: '25.00', tax_rate: '0.0000', discount: null, available: '12.000',
    line_subtotal: '25.00', discount_amount: '0.00', invoice_discount_share: '0.00', net_amount: '25.00', tax_amount: '0.00', line_total: '25.00',
    list_price: '25.00', price_source: 'catalog', price_approved_by: null, open_price: false, promotion: null,
  }],
  invoice_discount: null, subtotal: '25.00', item_discount_total: '0.00', invoice_discount_total: '0.00', discount_total: '0.00',
  net_total: '25.00', tax_total: '0.00', total: '25.00', promotions: [], coupon: null, savings_total: '0.00', discount_approved_by: null,
}
const sale = {
  id: 'sa-1', number: 'INV-MAIN-000009', status: 'completed', sold_at: '2026-12-10T06:00:00Z',
  store: { id: 's-1', code: 'FLOOR', name: 'Shop floor' }, branch: { id: 'b-1', name: 'Main Branch' }, customer: null, cashier: { id: 'u-4', name: 'Salma Cashier' },
  tax_mode: 'exclusive', currency: 'BDT', subtotal: '25.00', item_discount_total: '0.00', invoice_discount_total: '0.00', tax_total: '0.00', total: '25.00',
  paid_total: '25.00', change_total: '0.00', due_total: '0.00', cancelled_at: null, cancelled_by: null, cancellation_reason: null,
  notes: null, invoice_discount: null, cost_total: null, returns: [],
  lines: [{ id: 'sl-1', variant_id: 'v-1', product_name: 'Mango Juice', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', quantity: '1.000', unit_price: '25.00', discount: null,
    line_subtotal: '25.00', discount_amount: '0.00', invoice_discount_share: '0.00', net_amount: '25.00', tax_rate: '0.0000', tax_amount: '0.00', line_total: '25.00', unit_cost: null,
    batches: [], serials: [], returned_serials: [], returned_quantity: '0.000', pending_return_quantity: '0.000', list_price: '25.00', price_source: 'catalog', price_approved_by: null, promotion: null }],
  payments: [{ id: 'p-1', kind: 'payment', method: 'cash', method_label: 'Cash', amount: '25.00', tendered: '25.00', reference: null, created_at: '2026-12-10T06:00:00Z', created_by: 'Salma Cashier' }],
  receipt: { organization_name: 'Corner Shop', header: null, footer: 'Come again!', branch: null, timezone: 'Asia/Dhaka', customer_store_credit_balance: null },
  promotions: [], coupon_code: null, savings_total: '0.00', discount_approved_by: null,
}
const LINK = 'https://shop.test/receipt/Tok3n'

/** A USB-serial receipt printer: `requestPort()` grants it, `getPorts()` returns it afterwards, every write is kept. */
const FAKE_SERIAL = `(() => {
  const writes = []
  window.__printed = writes
  let open = false
  let granted = []
  const port = {
    getInfo: () => ({ usbVendorId: 0x0416, usbProductId: 0x5011 }),
    open: async () => { if (open) { const e = new Error('already open'); e.name = 'InvalidStateError'; throw e } open = true },
    close: async () => { open = false },
    get writable() {
      return open ? { getWriter: () => ({ write: async (d) => { writes.push(Array.from(d)) }, close: async () => {}, releaseLock: () => {} }) } : null
    },
    forget: async () => { granted = [] },
  }
  const serial = { requestPort: async () => { granted = [port]; return port }, getPorts: async () => granted }
  Object.defineProperty(Navigator.prototype, 'serial', { configurable: true, get: () => serial })
})()`

type Till = { checkouts: unknown[]; approvals: unknown[]; openings: { body: unknown; key: string | null }[] }

async function mockTill(page: Page): Promise<Till> {
  const till: Till = { checkouts: [], approvals: [], openings: [] }
  await page.addInitScript(() => localStorage.setItem('pos-session', JSON.stringify({ state: { activeBranchId: 'b-1' }, version: 0 })))
  await page.addInitScript({ content: FAKE_SERIAL })
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/**', (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace(/^\/api\/v1/, '')
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
      case 'POST /pos/price':
        return route.fulfill({ json: envelope(priced) })
      case 'POST /pos/checkout':
        till.checkouts.push(body())
        return route.fulfill({ status: 201, json: envelope(sale) })
      case 'GET /sales/sa-1/receipt-link':
        return route.fulfill({ json: envelope({ url: LINK, token: 'Tok3n' }) })
      case 'GET /pos/approvers':
        return route.fulfill({ json: envelope(url.searchParams.get('action') === 'no_sale' ? [{ id: 'u-9', name: 'Manager Mina' }] : []) })
      case 'POST /pos/approvals':
        till.approvals.push(body())
        return route.fulfill({ status: 201, json: envelope({ id: 'ap-1', action: 'no_sale', approver: { id: 'u-9', name: 'Manager Mina' }, expires_at: '2026-12-10T06:10:00Z' }) })
      case 'POST /pos/drawer-openings':
        till.openings.push({ body: body(), key: request.headers()['idempotency-key'] ?? null })
        return route.fulfill({ status: 201, json: envelope({ id: 'do-1', opened_at: '2026-12-10T06:00:00Z', approved_by: { id: 'u-9', name: 'Manager Mina' } }) })
      case 'GET /notifications/unread-count':
        return route.fulfill({ json: envelope({ count: 0 }) })
      default:
        return route.fulfill({ json: paged([]) })
    }
  })
  return till
}

const printed = (page: Page) => page.evaluate(() => (globalThis as unknown as { __printed: number[][] }).__printed)
const ascii = (s: string) => Array.from(s).map((c) => c.charCodeAt(0))
const contains = (haystack: number[], needle: number[]) => haystack.some((_, i) => needle.every((b, j) => haystack[i + j] === b))

async function setUpSerialPrinter(page: Page) {
  await page.getByRole('button', { name: 'Till' }).click()
  await page.getByRole('menuitem', { name: 'Receipt printer' }).click()
  const setup = page.getByRole('dialog', { name: 'Receipt printer' })
  await setup.getByRole('radio', { name: 'Serial / COM printer' }).click()
  await setup.getByRole('button', { name: 'Choose printer' }).click()
  await expect(setup.getByTestId('printer-device')).toHaveText('Serial port (USB 0416:5011)')
  await setup.getByRole('radio', { name: '58 mm (32)' }).click()
  await setup.getByRole('button', { name: 'Test print' }).click()
  await expect.poll(async () => (await printed(page)).length).toBe(1)
  await setup.getByRole('button', { name: 'Save' }).click()
  await expect(setup).toHaveCount(0)
}

test('the printer is set up once; a cash sale then prints by itself and opens the drawer', async ({ page }) => {
  const till = await mockTill(page)
  await page.goto('/admin/pos')
  await expect(page.getByRole('button', { name: /^Mango Juice/ })).toBeVisible()

  await setUpSerialPrinter(page)
  const sample = (await printed(page))[0] ?? []
  // Test print: init, Windows-1252, drawer kick (pin 2), … cut.
  expect(sample.slice(0, 10)).toEqual([0x1b, 0x40, 0x1b, 0x74, 16, 0x1b, 0x70, 0, 25, 250])
  expect(contains(sample, ascii('If you can read this, printing'))).toBe(true)
  expect(sample.slice(-4)).toEqual([0x1d, 0x56, 0x42, 0x00])

  await page.getByRole('button', { name: /^Mango Juice/ }).click()
  await expect(page.getByRole('complementary', { name: 'Current sale' }).getByTestId('cart-total')).toHaveText('BDT 25.00')
  await page.keyboard.press('F9')
  await page.getByRole('dialog', { name: 'Payment' }).getByRole('button', { name: 'Complete sale' }).click()
  const done = page.getByRole('dialog', { name: 'Sale INV-MAIN-000009 completed' })
  await expect(done).toBeVisible()
  expect(till.checkouts).toHaveLength(1)

  await expect.poll(async () => (await printed(page)).length).toBe(2)
  const receipt = (await printed(page))[1] ?? []
  expect(receipt.slice(0, 10)).toEqual([0x1b, 0x40, 0x1b, 0x74, 16, 0x1b, 0x70, 0, 25, 250])
  expect(contains(receipt, ascii('Receipt: INV-MAIN-000009'))).toBe(true)
  // 58 mm paper: 32 characters a line.
  expect(contains(receipt, ascii(`TOTAL${' '.repeat(18)}BDT 25.00`))).toBe(true)
  expect(contains(receipt, [0x1d, 0x28, 0x6b, LINK.length + 3, 0, 0x31, 0x50, 0x30, ...ascii(LINK)])).toBe(true)
  expect(receipt.slice(-4)).toEqual([0x1d, 0x56, 0x42, 0x00])

  // "Print" reprints without opening the drawer again.
  await done.getByRole('button', { name: 'Print' }).click()
  await expect.poll(async () => (await printed(page)).length).toBe(3)
  expect(contains((await printed(page))[2] ?? [], [0x1b, 0x70])).toBe(false)
  await expect(done.getByRole('button', { name: 'Send receipt' })).toBeVisible()
})

test('a cashier opens the drawer without a sale after a manager approves by PIN', async ({ page }) => {
  const till = await mockTill(page)
  await page.goto('/admin/pos')
  await expect(page.getByRole('button', { name: /^Mango Juice/ })).toBeVisible()
  await setUpSerialPrinter(page)

  await page.getByRole('button', { name: 'Till' }).click()
  await page.getByRole('menuitem', { name: 'Open drawer' }).click()
  const dialog = page.getByRole('dialog', { name: 'Open drawer' })
  await dialog.getByLabel('Reason').fill('Change for the next customer')
  await dialog.getByRole('button', { name: 'Open drawer' }).click()

  const approval = page.getByRole('dialog', { name: 'Approve opening the drawer' })
  await expect(approval).toContainText('Open the cash drawer without a sale: “Change for the next customer”.')
  await expect(approval.getByRole('radio', { name: 'Manager Mina' })).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.type('9753')
  await page.keyboard.press('Enter')

  await expect(dialog).toHaveCount(0)
  await expect.poll(async () => (await printed(page)).length).toBe(2)
  expect((await printed(page))[1]).toEqual([0x1b, 0x40, 0x1b, 0x70, 0, 25, 250])
  expect(till.approvals).toEqual([{ action: 'no_sale', approver_id: 'u-9', pin: '9753', store_id: 's-1' }])
  expect(till.openings).toHaveLength(1)
  expect(till.openings[0]?.body).toEqual({ store_id: 's-1', reason: 'Change for the next customer', approval_id: 'ap-1' })
  expect(till.openings[0]?.key).toMatch(/^[0-9a-f-]{36}$/)
  await expect(page.getByText('Drawer opened.')).toBeVisible()
})
