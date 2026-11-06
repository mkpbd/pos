import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * Supply chain SC2 against a mocked API: a requester raises a purchase requisition, a manager
 * approves it from the Approvals inbox and converts it to a purchase order and an RFQ, quotes are
 * recorded, compared and awarded, and the approval limits are saved. Runs on desktop and mobile.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const paged = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

const org = { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' }
const branch = { id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }
const user = (id: string, name: string, permissions: string[]) => ({
  user: { id, name, email: `${id}@berry.test`, phone: null, is_platform_admin: false, last_login_at: null },
  organization: org, roles: [{ id: 'r-x', name: 'Role', system_key: null }], permissions, branches: [branch],
})
const requester = user('u-7', 'Shila Staff', ['branches.view', 'products.view', 'purchases.request'])
const manager = user('u-8', 'Babul Manager', ['branches.view', 'products.view', 'suppliers.view', 'purchases.view', 'purchases.manage', 'purchases.request', 'purchases.approve'])
const owner = user('u-9', 'Owner Person', ['branches.view', 'suppliers.view', 'purchases.view', 'purchases.manage', 'purchases.approve', 'purchases.approve_high', 'purchases.settings'])

const branches = [{
  id: 'b-1', code: 'MAIN', name: 'Main Branch', email: null, phone: null, address: null, timezone: null, is_active: true, allow_negative_stock: false, created_at: '2026-10-01T00:00:00Z',
  stores: [{ id: 's-1', branch_id: 'b-1', code: 'FLOOR', name: 'Shop floor', type: 'store', is_active: true }],
}]
const store = { id: 's-1', code: 'FLOOR', name: 'Shop floor', branch_id: 'b-1', branch_name: 'Main Branch' }
const mills = { id: 'sup-1', code: 'SUP-000001', name: 'Local Mills', email: 'sales@mills.test' }
const fresh = { id: 'sup-2', code: 'SUP-000002', name: 'Fresh Foods', email: null }
const supplierRow = (s: typeof mills | typeof fresh) => ({ ...s, contact_person: null, phone: null, address: null, tax_number: null, payment_terms_days: 0, opening_balance: '0.00', notes: null, is_active: true, archived_at: null })
const rice = { id: 'v-2', product_name: 'Miniket Rice', variant_name: null, sku: 'RICE-KG', unit_code: 'kg', allow_decimal: true }
const juice = { id: 'v-1', product_name: 'Mango Juice 1L', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', allow_decimal: false }
const riceProduct = {
  id: 'p-2', name: 'Miniket Rice', type: 'standard', track_stock: true, track_batches: false, is_active: true,
  unit: { id: 'un-2', name: 'Kilogram', code: 'kg', allow_decimal: true }, tax_rate: null,
  variants: [{ id: 'v-2', name: null, sku: 'RICE-KG', option_values: {}, is_active: true }],
}

const requisition = (overrides: Record<string, unknown> = {}) => ({
  id: 'pr-4', number: 'PR-000004', status: 'submitted', branch: { id: 'b-1', name: 'Main Branch' }, store, requested_by: { id: 'u-7', name: 'Shila Staff' },
  needed_by: '2026-11-20', notes: null, currency: 'BDT', estimated_total: '6864.00', approval_level: 'manager', approved_by: null, approved_at: null,
  rejected_by: null, rejected_at: null, rejection_reason: null, submitted_at: '2026-11-06T04:00:00Z', converted_at: null, created_at: '2026-11-06T03:30:00Z',
  lines: [
    { id: 'prl-1', variant: rice, quantity: '100.000', estimated_unit_cost: '60.0000', suggested_supplier: { id: mills.id, name: mills.name }, notes: null, converted_quantity: '0.000' },
    { id: 'prl-2', variant: juice, quantity: '48.000', estimated_unit_cost: '18.0000', suggested_supplier: null, notes: null, converted_quantity: '0.000' },
  ],
  purchase_orders: [], rfqs: [],
  ...overrides,
})

const rfq = (overrides: Record<string, unknown> = {}) => ({
  id: 'rfq-5', number: 'RFQ-000005', status: 'sent', title: 'Quotes for PR-000004', store, requisition: { id: 'pr-4', number: 'PR-000004' }, needed_by: '2026-11-20',
  reply_by: '2026-11-12', notes: null, currency: 'BDT', sent_at: '2026-11-06T06:00:00Z', closed_at: null, awarded_at: null, created_by: { id: 'u-8', name: 'Babul Manager' },
  created_at: '2026-11-06T05:30:00Z',
  lines: [{ id: 'rl-1', variant: juice, quantity: '48.000', requisition_line_id: 'prl-2' }],
  suppliers: [
    { id: 'rs-1', supplier: mills, invited_at: '2026-11-06T05:30:00Z', emailed_at: '2026-11-06T06:00:00Z', quote: { id: 'q-1', status: 'received', received_at: '2026-11-07T06:00:00Z', valid_until: '2026-11-30', notes: null, lines: [{ rfq_line_id: 'rl-1', unit_price: '19.0000', quantity_offered: null, lead_time_days: 5, notes: null }] } },
    { id: 'rs-2', supplier: fresh, invited_at: '2026-11-06T05:30:00Z', emailed_at: null, quote: null },
  ],
  purchase_orders: [],
  ...overrides,
})

type Captured = { bodies: Record<string, unknown>; keys: Record<string, string | null> }

async function mockBackend(page: Page, me: unknown) {
  const captured: Captured = { bodies: {}, keys: {} }
  const record = (name: string, route: Route) => {
    captured.bodies[name] = route.request().postDataJSON()
    captured.keys[name] = route.request().headers()['idempotency-key'] ?? null
  }
  let quoted = false
  await page.addInitScript(() => localStorage.setItem('pos-session', JSON.stringify({ state: { activeBranchId: 'b-1' }, version: 0 })))
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: paged([]) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/branches?**', (route) => route.fulfill({ json: paged(branches) }))
  await page.route('**/api/v1/suppliers?**', (route) => route.fulfill({ json: paged([supplierRow(mills), supplierRow(fresh)]) }))
  await page.route('**/api/v1/products?**', (route) => route.fulfill({ json: envelope([riceProduct]) }))

  // Requisitions
  await page.route('**/api/v1/purchasing/requisitions?**', (route) => route.fulfill({ json: paged([requisition()]) }))
  await page.route('**/api/v1/purchasing/requisitions', (route) => {
    record('saveRequisition', route)
    return route.fulfill({ status: 201, json: envelope(requisition({ id: 'pr-9', number: 'PR-000009', status: 'draft' })) })
  })
  await page.route('**/api/v1/purchasing/requisitions/estimates?**', (route) =>
    route.fulfill({ json: envelope([{ variant_id: 'v-2', estimated_unit_cost: '60.0000', source: 'preferred_catalog', tax_rate: '0.0000', preferred_supplier: { id: mills.id, code: mills.code, name: mills.name } }]) }),
  )
  await page.route('**/api/v1/purchasing/requisitions/pr-9', (route) => route.fulfill({ json: envelope(requisition({ id: 'pr-9', number: 'PR-000009' })) }))
  await page.route('**/api/v1/purchasing/requisitions/pr-9/submit', (route) => {
    record('submitRequisition', route)
    return route.fulfill({ json: envelope(requisition({ id: 'pr-9', number: 'PR-000009' })) })
  })
  await page.route('**/api/v1/purchasing/requisitions/pr-4', (route) =>
    route.fulfill({ json: envelope(captured.bodies.approve ? requisition({ status: 'approved', approved_by: { id: 'u-8', name: 'Babul Manager' }, approved_at: '2026-11-06T07:00:00Z' }) : requisition()) }),
  )
  await page.route('**/api/v1/purchasing/requisitions/pr-4/approve', (route) => {
    record('approve', route)
    return route.fulfill({ json: envelope(requisition({ status: 'approved' })) })
  })
  await page.route('**/api/v1/purchasing/requisitions/pr-4/convert', (route) => {
    record('convert', route)
    return route.fulfill({ json: envelope({
      purchase_orders: [{ id: 'po-21', number: 'PO-000021', status: 'draft', supplier: { id: mills.id, name: mills.name }, total: '6000.00', currency: 'BDT', pre_approved: true }],
      rfq: { id: 'rfq-5', number: 'RFQ-000005', status: 'draft' },
    }) })
  })
  await page.route('**/api/v1/purchasing/approvals?**', (route) => {
    const r = requisition()
    const rows = captured.bodies.approve ? [] : [{
      kind: 'requisition', id: r.id, number: r.number, status: r.status, amount: r.estimated_total, currency: 'BDT', approval_level: 'manager',
      requested_by: r.requested_by, submitted_at: r.submitted_at, branch: { id: 'b-1', name: 'Main Branch' }, store, supplier: null, line_count: 2,
    }]
    return route.fulfill({ json: envelope(rows, { pagination: { current_page: 1, per_page: 50, total: rows.length, last_page: 1 }, counts: { requisition: rows.length, purchase_order: 0 } }) })
  })

  // RFQs
  await page.route('**/api/v1/purchasing/rfqs/rfq-5', (route) => route.fulfill({ json: envelope(captured.bodies.award ? rfq({ status: 'awarded' }) : rfq()) }))
  await page.route('**/api/v1/purchasing/rfqs/rfq-5/quotes', (route) => {
    record('quote', route)
    quoted = true
    return route.fulfill({ json: envelope(rfq()) })
  })
  await page.route('**/api/v1/purchasing/rfqs/rfq-5/comparison', (route) =>
    route.fulfill({ json: envelope({
      lines: [{ rfq_line_id: 'rl-1', quantity: '48.000', quotes: [
        { supplier_id: 'sup-1', unit_price: '19.0000', quantity_offered: null, line_total: '912.00', lead_time_days: 5, valid_until: '2026-11-30', lowest_price: !quoted, fastest: !quoted, expired: false, partial: false },
        ...(quoted ? [{ supplier_id: 'sup-2', unit_price: '17.5000', quantity_offered: null, line_total: '840.00', lead_time_days: 2, valid_until: null, lowest_price: true, fastest: true, expired: false, partial: false }] : []),
      ] }],
      suppliers: [
        { supplier_id: 'sup-1', status: 'received', valid_until: '2026-11-30', expired: false, lines_quoted: 1, lines_total: 1, total: '912.00' },
        { supplier_id: 'sup-2', status: quoted ? 'received' : 'pending', valid_until: null, expired: false, lines_quoted: quoted ? 1 : 0, lines_total: 1, total: quoted ? '840.00' : '0.00' },
      ],
    }) }),
  )
  await page.route('**/api/v1/purchasing/rfqs/rfq-5/award', (route) => {
    record('award', route)
    return route.fulfill({ json: envelope({ purchase_orders: [{ id: 'po-22', number: 'PO-000022', status: 'draft', supplier: { id: fresh.id, name: fresh.name }, total: '840.00', currency: 'BDT', pre_approved: true }] }) })
  })
  await page.route('**/api/v1/purchasing/rfqs/rfq-5/suppliers/sup-2/pdf', (route) =>
    route.fulfill({ status: 200, body: '%PDF-1.4 e2e', headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="RFQ-000005-SUP-000002.pdf"' } }),
  )

  // Approval limits
  await page.route('**/api/v1/purchasing/approval-settings', (route) => {
    if (route.request().method() === 'PATCH') {
      record('settings', route)
      return route.fulfill({ json: envelope({ ...(captured.bodies.settings as object), currency: 'BDT' }) })
    }
    return route.fulfill({ json: envelope({ auto_approve_limit: '10000.00', manager_limit: '100000.00', require_po_approval: true, currency: 'BDT' }) })
  })
  return captured
}

test('a requester raises and submits a purchase requisition', async ({ page }) => {
  const captured = await mockBackend(page, requester)
  await page.goto('/admin/purchasing/requisitions')

  await expect(page.getByRole('link', { name: 'PR-000004' })).toBeVisible()
  await page.getByRole('link', { name: 'New requisition' }).click()
  await page.getByRole('combobox', { name: 'For store' }).click()
  await page.getByRole('option', { name: 'Shop floor (FLOOR)' }).click()
  await page.getByRole('combobox', { name: 'Product of line 1' }).click()
  await page.getByPlaceholder('Name, SKU or barcode').fill('rice')
  await page.getByRole('option', { name: /Miniket Rice/ }).click()
  await page.getByLabel('Quantity of line 1').fill('25')
  await expect(page.getByLabel('Estimated unit cost of line 1')).toHaveValue('60')
  await expect(page.getByText('Preferred supplier Local Mills')).toBeVisible()
  await page.getByRole('button', { name: 'Save & submit' }).click()

  await expect(page).toHaveURL(/\/admin\/purchasing\/requisitions\/pr-9$/)
  await expect(page.getByRole('heading', { name: 'PR-000009' })).toBeVisible()
  await expect(page.getByText('You raised this requisition, so someone else has to approve it.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0)
  expect(captured.bodies.saveRequisition).toEqual({
    store_id: 's-1', needed_by: null, notes: null,
    lines: [{ variant_id: 'v-2', quantity: '25', estimated_unit_cost: '60', suggested_supplier_id: 'sup-1', notes: null }],
  })
  expect(captured.keys.submitRequisition).toBeTruthy()
})

test('a manager approves from the inbox and converts to a purchase order and an RFQ', async ({ page }) => {
  const captured = await mockBackend(page, manager)
  await page.goto('/admin/purchasing/approvals')

  await expect(page.getByText('BDT 6,864.00')).toBeVisible()
  await page.getByRole('button', { name: 'Approve PR-000004' }).click()
  await expect(page.getByText('Nothing waiting for you')).toBeVisible()
  expect(captured.keys.approve).toBeTruthy()

  await page.goto('/admin/purchasing/requisitions/pr-4')
  await page.getByRole('button', { name: 'Convert' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('combobox', { name: 'Supplier of Miniket Rice' })).toContainText('Local Mills')
  await expect(dialog.getByRole('combobox', { name: 'Convert Mango Juice 1L to' })).toContainText('Request quotes')
  await dialog.getByRole('button', { name: 'Convert' }).click()
  await expect(dialog.getByRole('link', { name: 'PO-000021' })).toHaveAttribute('href', '/admin/purchasing/orders/po-21')
  await expect(dialog.getByRole('link', { name: 'RFQ-000005' })).toBeVisible()
  expect(captured.bodies.convert).toEqual({
    purchase_orders: { lines: [{ requisition_line_id: 'prl-1', quantity: '100', supplier_id: 'sup-1' }] },
    rfq: { lines: [{ requisition_line_id: 'prl-2', quantity: '48' }], title: 'Quotes for PR-000004', reply_by: null },
  })
  expect(captured.keys.convert).toBeTruthy()
})

test('records a quote, compares and awards an RFQ', async ({ page }) => {
  const captured = await mockBackend(page, manager)
  await page.goto('/admin/purchasing/rfqs/rfq-5')

  const fresher = page.getByRole('listitem', { name: 'Fresh Foods' })
  await expect(fresher.getByText('Not e-mailed — send manually')).toBeVisible()
  const download = page.waitForEvent('download')
  await fresher.getByRole('button', { name: 'Download RFQ PDF for Fresh Foods' }).click()
  expect((await download).suggestedFilename()).toBe('RFQ-000005-SUP-000002.pdf')

  await fresher.getByRole('button', { name: 'Record quote from Fresh Foods' }).click()
  const quote = page.getByRole('dialog', { name: 'Quote from Fresh Foods' })
  await quote.getByLabel('Unit price of Mango Juice 1L').fill('17.5')
  await quote.getByLabel('Lead time of Mango Juice 1L').fill('2')
  await quote.getByRole('button', { name: 'Save quote' }).click()
  await expect(quote).toBeHidden()
  expect(captured.bodies.quote).toEqual({
    supplier_id: 'sup-2', status: 'received', valid_until: null, notes: null,
    lines: [{ rfq_line_id: 'rl-1', unit_price: '17.5', quantity_offered: '48', lead_time_days: 2, notes: null }],
  })

  const matrix = page.getByRole('table', { name: 'Quote comparison' })
  await expect(matrix.getByText('Lowest')).toBeVisible()
  await expect(matrix.getByText('BDT 840.00')).toBeVisible()

  await page.getByRole('button', { name: 'Award', exact: true }).click()
  const award = page.getByRole('dialog', { name: 'Award RFQ-000005' })
  await expect(award.getByRole('combobox', { name: 'Supplier for Mango Juice 1L' })).toContainText('Fresh Foods')
  await award.getByRole('button', { name: 'Award and create 1 order' }).click()
  await expect(page.getByRole('dialog', { name: 'RFQ-000005 awarded' }).getByRole('link', { name: 'PO-000022' })).toHaveAttribute('href', '/admin/purchasing/orders/po-22')
  expect(captured.bodies.award).toEqual({ lines: [{ rfq_line_id: 'rl-1', supplier_id: 'sup-2', quantity: '48' }], update_catalog: true })
  expect(captured.keys.award).toBeTruthy()
})

test('saves the approval limits', async ({ page }) => {
  const captured = await mockBackend(page, owner)
  await page.goto('/admin/purchasing/settings')

  const auto = page.getByLabel('Auto-approve up to (BDT)')
  await expect(auto).toHaveValue('10000')
  await auto.fill('15000')
  await page.getByRole('button', { name: 'Save limits' }).click()
  await expect(page.getByText('Approval limits saved.')).toBeVisible()
  expect(captured.bodies.settings).toEqual({ auto_approve_limit: '15000', manager_limit: '100000', require_po_approval: true })
})
