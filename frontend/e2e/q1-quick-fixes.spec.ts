import { expect, test, type Page } from '@playwright/test'

/**
 * Q1 quick fixes against a mocked API: stock count mode, a new customer at the till (with a
 * phone that is already registered), the seller BIN on the receipt, public sign-up switched
 * off / on, the organization's sign-in history, removing a supplier from an RFQ, and the page
 * builder's phone notice. Runs on desktop and mobile.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const paged = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })
const failure = (status: number, code: string, message: string, details: Record<string, unknown> = {}) => ({
  status,
  json: { success: false, error: { code, message, details }, meta: { request_id: 'e2e' } },
})

const org = { id: 'o-1', name: 'Corner Shop', slug: 'corner-shop', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' }
const branch = { id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }
const user = (permissions: string[]) => ({
  user: { id: 'u-1', name: 'Rahim Uddin', email: 'rahim@corner.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: org, roles: [{ id: 'r-x', name: 'Role', system_key: null }], permissions, branches: [branch],
})

const branches = [{
  id: 'b-1', code: 'MAIN', name: 'Main Branch', email: null, phone: null, address: null, timezone: null, is_active: true, allow_negative_stock: false, created_at: '2026-10-01T00:00:00Z',
  stores: [{ id: 's-1', branch_id: 'b-1', code: 'FLOOR', name: 'Shop floor', type: 'store', is_active: true }],
}]
const store = { id: 's-1', code: 'FLOOR', name: 'Shop floor', branch_id: 'b-1', branch_name: 'Main Branch' }

async function signedIn(page: Page, me: unknown) {
  await page.addInitScript(() => localStorage.setItem('pos-session', JSON.stringify({ state: { activeBranchId: 'b-1' }, version: 0 })))
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: paged([]) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/branches?**', (route) => route.fulfill({ json: paged(branches) }))
}

test('stock count: counted quantity, in stock now and the difference; the posted count shows counted vs system', async ({ page }) => {
  const soapRef = { id: 'v-2', product_id: 'p-2', product_name: 'Soap', variant_name: null, sku: 'SOAP-1', unit_code: 'pcs', track_batches: false, allow_decimal: false }
  const soap = {
    id: 'p-2', name: 'Soap', type: 'standard', track_stock: true, track_batches: false, is_active: true,
    unit: { id: 'un-1', name: 'Piece', code: 'pcs', allow_decimal: false }, tax_rate: null,
    variants: [{ id: 'v-2', name: null, sku: 'SOAP-1', option_values: {}, is_active: true }],
  }
  const adjustment = {
    id: 'a-9', number: 'ADJ-000009', reason: 'count', note: null, store, created_at: '2026-11-20T09:00:00Z',
    lines: [{ id: 'l-1', variant: soapRef, batch: null, quantity: '5.000', unit_cost: null, counted_quantity: '50.000', system_quantity: '45.000' }],
  }
  let posted: unknown
  await signedIn(page, user(['branches.view', 'products.view', 'inventory.view', 'inventory.adjust']))
  await page.route('**/api/v1/products?**', (route) => route.fulfill({ json: envelope([soap]) }))
  await page.route('**/api/v1/inventory/stock?**', (route) =>
    route.fulfill({ json: paged([{ store, variant: soapRef, quantity: '45.000', reorder_level: '0', is_low: false, value: null, updated_at: null }]) }))
  await page.route('**/api/v1/inventory/adjustments', (route) => {
    posted = route.request().postDataJSON()
    return route.fulfill({ status: 201, json: envelope(adjustment) })
  })
  await page.route('**/api/v1/inventory/adjustments/a-9', (route) => route.fulfill({ json: envelope(adjustment) }))

  await page.goto('/admin/inventory/adjustments/new')
  await page.getByRole('combobox', { name: 'Store' }).click()
  await page.getByRole('option', { name: 'Shop floor (FLOOR)' }).click()
  await page.getByRole('combobox', { name: 'Reason' }).click()
  await page.getByRole('option', { name: 'Stock count' }).click()
  await expect(page.getByText('Enter what you counted on the shelf.', { exact: false })).toBeVisible()

  await page.getByRole('combobox', { name: 'Product of line 1' }).click()
  await page.getByPlaceholder('Name, SKU or barcode').fill('soap')
  await page.getByRole('option', { name: /Soap/ }).click()
  await expect(page.getByRole('status', { name: 'In stock now' })).toHaveText('45')
  await page.getByLabel('Counted quantity of line 1').fill('50')
  await expect(page.getByRole('status', { name: 'Difference' })).toHaveText('+5')
  await page.getByRole('button', { name: 'Post adjustment' }).click()

  await expect(page).toHaveURL(/\/admin\/inventory\/adjustments\/a-9$/)
  expect(posted).toEqual({ store_id: 's-1', reason: 'count', note: null, lines: [{ variant_id: 'v-2', counted_quantity: '50', unit_cost: null }] })
  const row = page.getByRole('table', { name: 'Adjustment lines' }).getByRole('row').nth(1)
  await expect(row).toContainText('Soap')
  // Counted, system and the posted difference (the batch column is hidden on phones).
  for (const value of ['50', '45', '+5 pcs']) await expect(row.getByRole('cell', { name: value, exact: true })).toBeVisible()
})

test('new customer at the till: a known phone offers the existing customer', async ({ page }) => {
  const salma = {
    id: 'c-3', code: 'C-0003', name: 'Salma Begum', phone: '01711112222', email: null, address: null, tax_number: null, group: null,
    credit_limit: '0.00', opening_balance: '0.00', notes: null, is_active: true, archived_at: null,
  }
  let createBody: unknown
  await signedIn(page, user(['branches.view', 'products.view', 'customers.view', 'customers.create', 'pos.sell', 'cash_registers.operate', 'sales.view']))
  await page.route('**/api/v1/register-sessions/current', (route) => route.fulfill({ json: envelope({
    id: 'ses-1', number: 'SES-MAIN-000001', status: 'open', currency: 'BDT', branch: { id: 'b-1', code: 'MAIN', name: 'Main Branch' },
    register: { id: 'reg-1', code: 'REG-01', name: 'Counter 1' }, opening_float: '500.00', opened_by: { id: 'u-1', name: 'Rahim Uddin' }, opened_at: '2026-11-20T03:00:00Z',
    expected_cash: null, counted_cash: null, variance: null, closing_notes: null, closed_by: null, closed_at: null,
    cash: { opening_float: '500.00', cash_in: '0.00', cash_out: '0.00', expected: '500.00', counted: null, variance: null }, by_method: [], by_source: [], entries: [],
  }) }))
  await page.route('**/api/v1/loyalty/settings', (route) => route.fulfill({ json: envelope({ is_enabled: false, spend_amount: '100.00', points_per_spend: 1, point_value: '1.00', min_redeem_points: 0 }) }))
  await page.route('**/api/v1/customers?**', (route) => {
    const search = new URL(route.request().url()).searchParams.get('search')
    return route.fulfill({ json: paged(search === '01711112222' ? [salma] : []) })
  })
  await page.route('**/api/v1/customers', (route) => {
    createBody = route.request().postDataJSON()
    return route.fulfill(failure(422, 'VALIDATION_FAILED', 'The given data was invalid.', { phone: ['The phone has already been taken.'] }))
  })

  await page.goto('/admin/pos')
  await page.getByRole('button', { name: 'Customer' }).click()
  await page.getByPlaceholder('Name, phone or code').fill('017-1111-2222')
  await page.getByRole('button', { name: 'New customer' }).click()

  const dialog = page.getByRole('dialog', { name: 'New customer' })
  await expect(dialog.getByLabel('Phone')).toHaveValue('017-1111-2222')
  await expect(dialog.getByLabel(/Credit limit/)).toHaveCount(0)
  await dialog.getByLabel('Name').fill('Salma')
  await dialog.getByRole('button', { name: 'Add customer' }).click()

  await expect(dialog.getByText('The phone has already been taken.')).toBeVisible()
  await expect(dialog.getByText(/This phone belongs to/)).toContainText('Salma Begum (C-0003 · 01711112222)')
  expect(createBody).toEqual({ name: 'Salma', phone: '017-1111-2222', email: null, address: null, tax_number: null, notes: null })
  await dialog.getByRole('button', { name: 'Use this customer' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'Customer' })).toContainText('Salma Begum')
})

test('receipt: the seller BIN is printed and the document is a tax invoice only with a BIN', async ({ page }) => {
  const sale = (receipt: Record<string, unknown>) => ({
    id: 'sa-1', number: 'INV-MAIN-000001', status: 'completed', sold_at: '2026-11-20T06:00:00Z',
    store: { id: 's-1', code: 'FLOOR', name: 'Shop floor' }, branch: { id: 'b-1', name: 'Main Branch' }, customer: null, cashier: { id: 'u-1', name: 'Rahim Uddin' },
    tax_mode: 'exclusive', currency: 'BDT', subtotal: '50.00', item_discount_total: '0.00', invoice_discount_total: '0.00', tax_total: '0.00', total: '50.00',
    paid_total: '50.00', change_total: '0.00', due_total: '0.00', cancelled_at: null, cancelled_by: null, cancellation_reason: null, notes: null, invoice_discount: null, cost_total: null,
    lines: [], returns: [],
    payments: [{ id: 'pay-1', kind: 'payment', method: 'cash', method_label: 'Cash', amount: '50.00', tendered: '50.00', reference: null, created_at: '2026-11-20T06:00:00Z', created_by: 'Rahim Uddin' }],
    receipt: { organization_name: 'Corner Shop', header: null, footer: null, branch: null, timezone: 'Asia/Dhaka', ...receipt },
  })
  let withBin = true
  await signedIn(page, user(['branches.view', 'sales.view']))
  await page.route('**/api/v1/sales/sa-1', (route) =>
    route.fulfill({ json: envelope(sale(withBin ? { tax_number: '000123456-0101', is_tax_invoice: true } : { tax_number: null, is_tax_invoice: false })) }))

  await page.goto('/admin/sales/sa-1')
  await page.getByRole('button', { name: 'Receipt' }).click()
  const receipt = page.getByRole('dialog').getByTestId('receipt')
  await expect(receipt).toContainText('BIN: 000123456-0101')
  await expect(receipt).toContainText('Tax invoice: INV-MAIN-000001')

  withBin = false
  await page.reload()
  await page.getByRole('button', { name: 'Receipt' }).click()
  const plain = page.getByRole('dialog').getByTestId('receipt')
  await expect(plain).toContainText('Receipt: INV-MAIN-000001')
  await expect(plain).not.toContainText('BIN')
  await expect(plain).not.toContainText('Tax invoice')
})

test('public sign-up: hidden and closed when off, offered when on', async ({ page }) => {
  let enabled = false
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: paged([]) }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill(failure(401, 'UNAUTHENTICATED', 'Unauthenticated.')))
  await page.route('**/api/v1/auth/options', (route) => route.fulfill({ json: envelope({ registration_enabled: enabled }) }))

  await page.goto('/admin/login')
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Create an account' })).toHaveCount(0)

  await page.goto('/admin/register')
  await expect(page.getByRole('heading', { name: 'Sign-up is closed' })).toBeVisible()
  await expect(page.getByLabel('Business name')).toHaveCount(0)

  enabled = true
  await page.goto('/admin/login')
  await page.getByRole('link', { name: 'Create an account' }).click()
  await expect(page.getByLabel('Business name')).toBeVisible()
})

test('audit log: the Sign-ins tab lists the organization’s sign-ins and filters failures', async ({ page }) => {
  const rows = [
    { id: 'la-1', user_id: 'u-2', email: 'karim@corner.test', channel: 'session', succeeded: true, failure_reason: null, ip_address: '203.0.113.7',
      user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36', created_at: '2026-11-20T04:00:00Z' },
    { id: 'la-2', user_id: null, email: 'nobody@corner.test', channel: 'session', succeeded: false, failure_reason: 'invalid_credentials', ip_address: '198.51.100.4',
      user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', created_at: '2026-11-20T05:00:00Z' },
  ]
  const seen: string[] = []
  await signedIn(page, user(['branches.view', 'audit.view']))
  await page.route('**/api/v1/login-activities?**', (route) => {
    const params = new URL(route.request().url()).searchParams
    seen.push(params.toString())
    return route.fulfill({ json: paged(params.get('succeeded') === '0' ? rows.filter((r) => !r.succeeded) : rows) })
  })

  await page.goto('/admin/audit-log')
  await page.getByRole('link', { name: 'Sign-ins' }).click()
  await expect(page).toHaveURL(/\/admin\/audit-log\/sign-ins$/)
  const table = page.getByRole('table', { name: 'Sign-ins' })
  await expect(table.getByRole('row')).toHaveCount(3)
  await expect(table.getByRole('row').nth(1)).toContainText('karim@corner.test')
  await expect(table.getByRole('row').nth(1)).toContainText('Signed in')
  await expect(table.getByRole('row').nth(2)).toContainText('Invalid credentials')

  await page.getByRole('combobox', { name: 'Result' }).click()
  await page.getByRole('option', { name: 'Failed' }).click()
  await expect(table.getByRole('row')).toHaveCount(2)
  expect(seen.at(-1)).toContain('succeeded=0')
})

test('RFQ: removes an invited supplier that has not quoted, after confirming', async ({ page }) => {
  const mills = { id: 'sup-1', code: 'SUP-000001', name: 'Local Mills', email: 'sales@mills.test' }
  const fresh = { id: 'sup-2', code: 'SUP-000002', name: 'Fresh Foods', email: null }
  const juice = { id: 'v-1', product_name: 'Mango Juice 1L', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', allow_decimal: false }
  const rfq = (withFresh: boolean) => ({
    id: 'rfq-5', number: 'RFQ-000005', status: 'sent', title: 'Juice quotes', store, requisition: null, needed_by: '2026-11-30', reply_by: '2026-11-25', notes: null,
    currency: 'BDT', sent_at: '2026-11-20T06:00:00Z', closed_at: null, awarded_at: null, created_by: { id: 'u-1', name: 'Rahim Uddin' }, created_at: '2026-11-20T05:30:00Z',
    lines: [{ id: 'rl-1', variant: juice, quantity: '48.000', requisition_line_id: null }],
    suppliers: [
      { id: 'rs-1', supplier: mills, invited_at: '2026-11-20T05:30:00Z', emailed_at: '2026-11-20T06:00:00Z', can_remove: false,
        quote: { id: 'q-1', status: 'received', received_at: '2026-11-21T06:00:00Z', valid_until: '2026-11-30', notes: null, lines: [{ rfq_line_id: 'rl-1', unit_price: '19.0000', quantity_offered: null, lead_time_days: 5, notes: null }] } },
      ...(withFresh ? [{ id: 'rs-2', supplier: fresh, invited_at: '2026-11-20T05:30:00Z', emailed_at: null, quote: null, can_remove: true }] : []),
    ],
    purchase_orders: [],
  })
  let removed = false
  await signedIn(page, user(['branches.view', 'suppliers.view', 'purchases.view', 'purchases.manage']))
  await page.route('**/api/v1/purchasing/rfqs/rfq-5', (route) => route.fulfill({ json: envelope(rfq(!removed)) }))
  await page.route('**/api/v1/purchasing/rfqs/rfq-5/comparison', (route) => route.fulfill({ json: envelope({ lines: [], suppliers: [], totals: [] }) }))
  await page.route('**/api/v1/purchasing/rfqs/rfq-5/suppliers/sup-2', (route) => {
    expect(route.request().method()).toBe('DELETE')
    removed = true
    return route.fulfill({ json: envelope(rfq(false)) })
  })

  await page.goto('/admin/purchasing/rfqs/rfq-5')
  const invited = page.getByRole('list', { name: 'Invited suppliers' })
  await expect(invited.getByRole('button', { name: 'Remove Local Mills from the RFQ' })).toHaveCount(0)
  await invited.getByRole('button', { name: 'Remove Fresh Foods from the RFQ' }).click()
  await page.getByRole('alertdialog', { name: 'Remove Fresh Foods from RFQ-000005?' }).getByRole('button', { name: 'Remove supplier' }).click()

  await expect(invited.getByText('Fresh Foods')).toHaveCount(0)
  expect(removed).toBe(true)
})

test('page builder on a phone: a plain notice with a way back to Pages', async ({ page }) => {
  await signedIn(page, user(['branches.view', 'storefront.view', 'storefront.manage']))
  await page.setViewportSize({ width: 390, height: 844 })

  await page.goto('/admin/storefront/builder/doc-1')
  await expect(page.getByRole('heading', { name: 'Open the page builder on a bigger screen' })).toBeVisible()
  await expect(page.getByText('The page builder works on a computer or tablet — open this page there.')).toBeVisible()
  await page.getByRole('link', { name: 'Back to pages' }).click()
  await expect(page).toHaveURL(/\/admin\/storefront\/pages$/)
})
