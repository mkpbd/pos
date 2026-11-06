import { expect, test, type Page } from '@playwright/test'

/**
 * Supply chain SC3 against a mocked API: charges on a goods receipt with the live landed cost
 * preview, a landed cost voucher posted after the fact, and supplier performance (list and the
 * supplier's Performance tab). Runs on desktop and mobile.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const paged = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

const me = {
  user: { id: 'u-1', name: 'Nadia Buyer', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-1', name: 'Store Manager', system_key: null }],
  permissions: ['branches.view', 'inventory.view', 'products.view', 'suppliers.view', 'purchases.view', 'purchases.manage', 'purchases.receive', 'purchases.landed_cost'],
  branches: [
    { id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true },
    { id: 'b-2', code: 'NORTH', name: 'North', is_active: true },
  ],
}

const branches = [{
  id: 'b-1', code: 'MAIN', name: 'Main Branch', email: null, phone: null, address: null, timezone: null, is_active: true, allow_negative_stock: false, created_at: '2026-10-01T00:00:00Z',
  stores: [{ id: 's-1', branch_id: 'b-1', code: 'FLOOR', name: 'Shop floor', type: 'store', is_active: true }],
}]

const mills = { id: 'sup-1', code: 'SUP-000001', name: 'Local Mills' }
const swift = { id: 'sup-3', code: 'SUP-000003', name: 'Swift Freight' }
const supplierRow = (s: typeof mills) => ({ ...s, contact_person: null, email: null, phone: null, address: null, tax_number: null, payment_terms_days: 30, opening_balance: '0.00', notes: null, is_active: true, archived_at: null })
const store = { id: 's-1', code: 'FLOOR', name: 'Shop floor', branch_id: 'b-1', branch_name: 'Main Branch' }
const rice = { id: 'v-2', product_name: 'Miniket Rice', variant_name: null, sku: 'RICE-KG', unit_code: 'kg', allow_decimal: true, track_batches: false }
const juice = { id: 'v-1', product_name: 'Mango Juice 1L', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', allow_decimal: false, track_batches: false }
const zero = { line_subtotal: '0.00', line_tax: '0.00', line_total: '0.00' }

const order = {
  id: 'po-1', number: 'PO-000001', status: 'ordered', supplier: mills, store, currency: 'BDT', subtotal: '7828.00', tax_total: '0.00', total: '7828.00',
  notes: null, created_at: '2026-10-30T00:00:00Z', order_date: '2026-10-30', expected_date: '2026-11-03', ordered_at: '2026-10-30T00:00:00Z',
  lines: [
    { id: 'pol-1', variant: rice, quantity: '100.000', received_quantity: '0.000', unit_cost: '61.0000', tax_rate: '0.0000', ...zero },
    { id: 'pol-2', variant: juice, quantity: '96.000', received_quantity: '0.000', unit_cost: '18.0000', tax_rate: '0.0000', ...zero },
  ],
}

const receipt = {
  id: 'gr-2', number: 'GRN-000002', purchase_order_id: 'po-1', supplier: mills, store, currency: 'BDT', subtotal: '7828.00', tax_total: '0.00', total: '7828.00',
  notes: null, created_at: '2026-11-06T00:00:00Z', supplier_invoice_number: 'LM-1100', invoice_date: '2026-11-06', due_date: null,
  charges_total: '500.00', charges_tax_total: '0.00', landed_total: '8328.00', payable_total: '8328.00',
  charges: [{ id: 'grc-1', type: 'freight', description: 'Truck', amount: '500.00', tax_amount: '0.00', allocation: 'value', charge_supplier: null }],
  lines: [
    { id: 'grl-1', variant: rice, quantity: '100.000', returned_quantity: '0.000', unit_cost: '61.0000', tax_rate: '0.0000', line_subtotal: '6100.00', line_tax: '0.00', line_total: '6100.00', landed_cost: '389.63', landed_unit_cost: '64.8963' },
    { id: 'grl-2', variant: juice, quantity: '96.000', returned_quantity: '0.000', unit_cost: '18.0000', tax_rate: '0.0000', line_subtotal: '1728.00', line_tax: '0.00', line_total: '1728.00', landed_cost: '110.37', landed_unit_cost: '19.1497' },
  ],
}

const allocationRow = { goods_receipt_id: 'gr-2', goods_receipt_number: 'GRN-000002', store, batch: null, returned_quantity: '0.000', previous_voucher_cost: '0.00', stock_movement_id: null }
const allocations = [
  {
    ...allocationRow, goods_receipt_line_id: 'grl-1', variant: rice, received_quantity: '100.000', on_hand_quantity: '75.000', consumed_quantity: '25.000', line_value: '6100.00',
    amount: '93.53', on_hand_amount: '70.15', consumed_amount: '23.38', landed_unit_cost: '64.8963', new_landed_unit_cost: '65.8316', average_cost_before: '64.8963', average_cost_after: '65.8316',
  },
  {
    ...allocationRow, goods_receipt_line_id: 'grl-2', variant: juice, received_quantity: '96.000', on_hand_quantity: '0.000', consumed_quantity: '96.000', line_value: '1728.00',
    amount: '26.47', on_hand_amount: '0.00', consumed_amount: '26.47', landed_unit_cost: '19.1497', new_landed_unit_cost: '19.4254', average_cost_before: null, average_cost_after: null,
  },
]

const voucher = {
  id: 'lcv-1', number: 'LCV-000001', status: 'posted', branch: { id: 'b-1', name: 'Main Branch' }, voucher_date: '2026-11-06', charge_supplier: swift, reference: 'SF-77', notes: null,
  currency: 'BDT', charges_total: '120.00', tax_total: '18.00', total: '138.00', receipt_numbers: ['GRN-000002'], receipt_count: 1,
  charges: [{ id: 'lcc-1', type: 'freight', description: 'Late freight bill', amount: '120.00', tax_amount: '18.00', allocation: 'value' }],
  receipts: [{ id: 'gr-2', number: 'GRN-000002', supplier: mills, store, supplier_invoice_number: 'LM-1100', invoice_date: '2026-11-06', subtotal: '7828.00', charges_total: '500.00', landed_total: '8328.00' }],
  allocation_source: 'posted', allocations, on_hand_total: '70.15', consumed_total: '49.85', expense: { id: 'ex-1', number: 'EXP-000004' }, posted_at: '2026-11-06T09:00:00Z', posted_by: { id: 'u-1', name: 'Nadia Buyer' },
  created_at: '2026-11-06T08:00:00Z',
}

const metrics = { orders: 6, spend: '48250.50', on_time_rate: '83.33', fill_rate: '97.5', avg_lead_days: '3.25', return_rate: '1.2', price_change_pct: '4.04', quote_response_rate: '100', quotes_won: 2, score: '88.6' }

type Captured = { receipt?: Record<string, unknown>; voucher?: Record<string, unknown>; postKey?: string | null; performance: URL[] }

async function mockBackend(page: Page) {
  const captured: Captured = { performance: [] }
  await page.addInitScript(() => localStorage.setItem('pos-session', JSON.stringify({ state: { activeBranchId: 'b-1' }, version: 0 })))
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: paged([]) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/branches?**', (route) => route.fulfill({ json: paged(branches) }))
  await page.route('**/api/v1/suppliers?**', (route) => route.fulfill({ json: paged([supplierRow(mills), supplierRow(swift)]) }))
  await page.route('**/api/v1/suppliers/sup-1', (route) => route.fulfill({ json: envelope(supplierRow(mills)) }))
  await page.route('**/api/v1/purchasing/orders/po-1', (route) => route.fulfill({ json: envelope(order) }))
  await page.route('**/api/v1/purchasing/receipts?**', (route) => route.fulfill({ json: paged([receipt]) }))
  await page.route('**/api/v1/purchasing/receipts', (route) => {
    captured.receipt = route.request().postDataJSON()
    return route.fulfill({ status: 201, json: envelope(receipt) })
  })
  await page.route('**/api/v1/purchasing/receipts/gr-2', (route) => route.fulfill({ json: envelope(receipt) }))
  await page.route('**/api/v1/purchasing/landed-cost-vouchers?**', (route) => route.fulfill({ json: paged([voucher]) }))
  await page.route('**/api/v1/purchasing/landed-cost-vouchers/preview', (route) => route.fulfill({ json: envelope({ currency: 'BDT', charges_total: '120.00', tax_total: '18.00', total: '138.00', on_hand_total: '70.15', consumed_total: '49.85', allocations }) }))
  await page.route('**/api/v1/purchasing/landed-cost-vouchers', (route) => {
    captured.voucher = route.request().postDataJSON()
    return route.fulfill({ status: 201, json: envelope({ ...voucher, id: 'lcv-2', number: 'LCV-000002', status: 'draft', allocation_source: 'preview', on_hand_total: null, consumed_total: null, expense: null, posted_at: null, posted_by: null }) })
  })
  await page.route('**/api/v1/purchasing/landed-cost-vouchers/lcv-2/post', (route) => {
    captured.postKey = route.request().headers()['idempotency-key'] ?? null
    return route.fulfill({ json: envelope({ ...voucher, id: 'lcv-2', number: 'LCV-000002' }) })
  })
  await page.route('**/api/v1/purchasing/landed-cost-vouchers/lcv-2', (route) => route.fulfill({ json: envelope({ ...voucher, id: 'lcv-2', number: 'LCV-000002' }) }))
  await page.route('**/api/v1/purchasing/supplier-performance?**', (route) => {
    captured.performance.push(new URL(route.request().url()))
    return route.fulfill({ json: envelope([{ supplier: mills, ...metrics }, { supplier: swift, ...metrics, orders: 1, spend: '138.00', on_time_rate: null, fill_rate: null, score: '45' }], { period: { date_from: '2026-08-09', date_to: '2026-11-06' } }) })
  })
  await page.route('**/api/v1/purchasing/suppliers/sup-1/performance?**', (route) =>
    route.fulfill({
      json: envelope({
        supplier: mills, date_from: '2026-08-09', date_to: '2026-11-06', metrics,
        trend: [{ month: '2026-10', orders: 3, on_time_rate: '75', fill_rate: '100', spend: '20000.00' }],
        problem_deliveries: [{ purchase_order: { id: 'po-4', number: 'PO-000004' }, expected_date: '2026-10-10', received_date: '2026-10-14', days_late: 4, short_quantity: '12.500' }],
      }),
    }),
  )
  return captured
}

test('previews landed unit costs while receiving and posts the charges', async ({ page }) => {
  const captured = await mockBackend(page)
  await page.goto('/admin/purchasing/receipts/new?order=po-1')

  await expect(page.getByRole('heading', { name: 'Receive PO-000001' })).toBeVisible()
  await page.getByRole('button', { name: 'Add charge' }).click()
  await page.getByLabel('Description of charge 1').fill('Truck')
  await page.getByLabel('Amount of charge 1').fill('500')

  const preview = page.getByRole('table', { name: 'Landed cost per line' })
  await expect(preview.getByRole('row', { name: 'Miniket Rice' })).toContainText('64.8963')
  await expect(preview.getByRole('row', { name: 'Mango Juice 1L' })).toContainText('19.1497')
  await expect(page.getByLabel('Landed total')).toHaveText('BDT 8,328.00')

  await page.getByRole('button', { name: 'Post receipt' }).click()
  await expect(page).toHaveURL(/\/admin\/purchasing\/receipts\/gr-2$/)
  expect(captured.receipt?.charges).toEqual([{ type: 'freight', description: 'Truck', amount: '500', tax_amount: '0', allocation: 'value', charge_supplier_id: null }])
  await expect(page.getByRole('table', { name: 'Receipt charges' })).toBeVisible()
  await expect(page.getByTestId('receipt-landed-total')).toHaveText('BDT 8,328.00')
})

test('creates and posts a landed cost voucher after a server preview', async ({ page }) => {
  const captured = await mockBackend(page)
  await page.goto('/admin/purchasing/landed-costs')

  await expect(page.getByRole('link', { name: 'LCV-000001' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export' })).toBeEnabled()
  await page.getByRole('link', { name: 'New voucher' }).click()

  await expect(page.getByRole('heading', { name: 'New landed cost voucher' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Supplier' }).click()
  await page.getByRole('option', { name: /Swift Freight/ }).click()
  await page.getByLabel('Supplier bill no.').fill('SF-77')
  await page.getByLabel('Amount of charge 1').fill('120')
  await page.getByLabel('Tax on charge 1').fill('18')
  await page.getByRole('checkbox', { name: 'Apply to GRN-000002' }).click()

  const preview = page.getByRole('table', { name: 'Allocation preview' })
  await expect(preview.getByRole('row', { name: 'GRN-000002 Mango Juice 1L' })).toContainText('26.47')
  await expect(page.getByTestId('voucher-consumed-total')).toHaveText('BDT 49.85')

  await page.getByRole('button', { name: 'Save & post' }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('BDT 70.15 is added to the value of stock on hand')
  await confirm.getByRole('button', { name: 'Post voucher' }).click()

  await expect(page).toHaveURL(/\/admin\/purchasing\/landed-costs\/lcv-2$/)
  await expect(page.getByRole('table', { name: 'Posted allocation' })).toBeVisible()
  expect(captured.voucher).toMatchObject({ branch_id: 'b-1', charge_supplier_id: 'sup-3', reference: 'SF-77', receipt_ids: ['gr-2'], charges: [{ type: 'freight', amount: '120', tax_amount: '18', allocation: 'value' }] })
  expect(captured.postKey).toBeTruthy()
})

test('ranks suppliers by score and shows a supplier\'s performance tab', async ({ page }) => {
  const captured = await mockBackend(page)
  await page.goto('/admin/purchasing/supplier-performance')

  const table = page.getByRole('table', { name: 'Supplier performance' })
  await expect(table.getByText('89 · Good')).toBeVisible()
  await expect(table.getByText('45 · Poor')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export' })).toBeEnabled()
  await page.getByRole('button', { name: /^On time/ }).click()
  await expect.poll(() => captured.performance.at(-1)?.searchParams.get('sort')).toBe('-on_time_rate')

  await table.getByRole('link', { name: 'Local Mills' }).click()
  await expect(page.getByRole('tab', { name: 'Performance' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('kpi-on-time')).toHaveText('83.3%')
  await expect(page.getByRole('table', { name: 'Monthly trend' })).toContainText('Oct 2026')
  await expect(page.getByRole('table', { name: 'Late and short deliveries' }).getByRole('link', { name: 'PO-000004' })).toBeVisible()
})
