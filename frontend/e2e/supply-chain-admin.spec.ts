import { expect, test, type Page } from '@playwright/test'

/**
 * Supply chain SC1 against a mocked API: reorder suggestions → draft purchase orders and a
 * replenishment transfer, the supplier catalog tab and the replenishment settings.
 * Runs on desktop and mobile.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const paged = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

const me = {
  user: { id: 'u-1', name: 'Nadia Buyer', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-1', name: 'Store Manager', system_key: null }],
  permissions: ['branches.view', 'inventory.view', 'inventory.manage', 'inventory.transfer', 'products.view', 'products.view_cost', 'purchases.view', 'purchases.manage', 'suppliers.view', 'suppliers.manage'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
}

const branches = [{
  id: 'b-1', code: 'MAIN', name: 'Main Branch', email: null, phone: null, address: null, timezone: null, is_active: true, allow_negative_stock: false, created_at: '2026-10-01T00:00:00Z',
  stores: [
    { id: 's-1', branch_id: 'b-1', code: 'FLOOR', name: 'Shop floor', type: 'store', is_active: true },
    { id: 's-2', branch_id: 'b-1', code: 'WH', name: 'Warehouse', type: 'warehouse', is_active: true },
  ],
}]

const fresh = { id: 'sup-2', code: 'SUP-000002', name: 'Fresh Drinks Ltd' }
const supplier = { ...fresh, contact_person: 'Rana', email: null, phone: '01711000000', address: null, tax_number: null, payment_terms_days: 15, opening_balance: '0.00', notes: null, is_active: true, archived_at: null }
const juiceVariant = { id: 'v-1', sku: 'JUICE-1L', product_name: 'Mango Juice 1L', variant_name: null, unit: 'pcs', allow_decimal: false }

const suggestions = [
  {
    variant: juiceVariant, on_hand: '6.000', on_order: '0.000', in_transit: '0.000', avg_daily: '4.000', reorder_point: '28.000', target: '84.000',
    suggested_purchase: '72.000', suggested_transfer: '0.000', supplier: fresh, unit_cost: '18.5000', lead_time_days: 3, reason: 'velocity', days_of_cover: '1.5',
    pack_size: '24.000', min_order_qty: null, draft_on_order: '0.000',
  },
  {
    variant: { id: 'v-3', sku: 'SOAP', product_name: 'Bath Soap', variant_name: null, unit: 'pcs', allow_decimal: false }, on_hand: '2.000', on_order: '0.000', in_transit: '0.000',
    avg_daily: '1.000', reorder_point: '10.000', target: '30.000', suggested_purchase: '0.000', suggested_transfer: '28.000', supplier: null, unit_cost: '22.0000', lead_time_days: 7,
    reason: 'below_min', days_of_cover: '2', pack_size: '1.000', min_order_qty: null, draft_on_order: '0.000',
  },
]

const catalogEntry = {
  id: 'sp-1', supplier: fresh, variant: juiceVariant, supplier_sku: 'FD-77', unit_cost: '18.5000', pack_size: '24.000', min_order_qty: null, lead_time_days: 3,
  is_preferred: false, last_purchase_cost: '18.2500', last_purchased_at: '2026-10-30T08:00:00Z', is_active: true,
}

type Captured = { purchaseOrders?: { body: unknown; key: string | null }; transfer?: { body: unknown; key: string | null }; settings?: unknown; preferred?: boolean }

async function mockBackend(page: Page) {
  const captured: Captured = {}
  await page.addInitScript(() => localStorage.setItem('pos-session', JSON.stringify({ state: { activeBranchId: 'b-1' }, version: 0 })))
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: paged([]) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/branches?**', (route) => route.fulfill({ json: paged(branches) }))
  await page.route('**/api/v1/suppliers?**', (route) => route.fulfill({ json: paged([supplier]) }))
  await page.route('**/api/v1/suppliers/sup-2', (route) => route.fulfill({ json: envelope(supplier) }))
  await page.route('**/api/v1/inventory/replenishment-settings', async (route) => {
    if (route.request().method() === 'PATCH') {
      captured.settings = route.request().postDataJSON()
      return route.fulfill({ json: envelope({ ...(captured.settings as object), source_store: { id: 's-2', name: 'Warehouse' } }) })
    }
    return route.fulfill({ json: envelope({ source_store_id: 's-2', source_store: { id: 's-2', name: 'Warehouse' }, coverage_days: 14, velocity_days: 30, safety_days: 3 }) })
  })
  await page.route('**/api/v1/purchasing/reorder-suggestions?**', (route) => {
    const only = new URL(route.request().url()).searchParams.get('only')
    return route.fulfill({ json: paged(suggestions.filter((s) => (only === 'transfer' ? s.suggested_transfer !== '0.000' : only === 'purchase' ? s.suggested_purchase !== '0.000' : true))) })
  })
  await page.route('**/api/v1/purchasing/reorder-suggestions/purchase-orders', (route) => {
    captured.purchaseOrders = { body: route.request().postDataJSON(), key: route.request().headers()['idempotency-key'] ?? null }
    return route.fulfill({ status: 201, json: envelope({ purchase_orders: [{ id: 'po-9', number: 'PO-000009', status: 'draft', supplier: fresh, line_count: 1, total: '1776.00' }] }) })
  })
  await page.route('**/api/v1/purchasing/reorder-suggestions/transfers', (route) => {
    captured.transfer = { body: route.request().postDataJSON(), key: route.request().headers()['idempotency-key'] ?? null }
    return route.fulfill({ status: 201, json: envelope({ transfers: [{ id: 'tr-4', number: 'TRF-000004', status: 'in_transit', from_store: { id: 's-2', name: 'Warehouse' }, to_store: { id: 's-1', name: 'Shop floor' }, line_count: 1 }] }) })
  })
  await page.route('**/api/v1/purchasing/supplier-products?**', (route) => route.fulfill({ json: paged([catalogEntry]) }))
  await page.route('**/api/v1/purchasing/supplier-products/sp-1/preferred', (route) => {
    captured.preferred = true
    return route.fulfill({ json: envelope({ ...catalogEntry, is_preferred: true }) })
  })
  return captured
}

test('creates a draft purchase order and a transfer from reorder suggestions', async ({ page }) => {
  const captured = await mockBackend(page)
  await page.goto('/admin/purchasing/reorder')

  const qty = page.getByLabel('Purchase quantity of Mango Juice 1L')
  await expect(qty).toHaveValue('72')
  await expect(page.getByText('3 × 24')).toBeVisible()
  await qty.fill('90')
  await page.getByRole('button', { name: 'Packs of 24 — order 96' }).click()
  await expect(qty).toHaveValue('96')

  await page.getByRole('checkbox', { name: 'Select Mango Juice 1L' }).click()
  await page.getByRole('button', { name: 'Create purchase orders' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('region', { name: 'Order from Fresh Drinks Ltd' })).toBeVisible()
  await expect(dialog.getByText('BDT 1,776.00')).toBeVisible()
  await dialog.getByRole('button', { name: 'Create 1 draft order' }).click()
  await expect(dialog.getByRole('link', { name: 'PO-000009' })).toHaveAttribute('href', '/admin/purchasing/orders/po-9')
  expect(captured.purchaseOrders?.body).toEqual({ store_id: 's-1', lines: [{ variant_id: 'v-1', supplier_id: 'sup-2', quantity: '96', unit_cost: '18.5000' }] })
  expect(captured.purchaseOrders?.key).toBeTruthy()
  await dialog.getByRole('button', { name: 'Done' }).click()

  await page.getByRole('tab', { name: 'Transfer' }).click()
  await expect(page.getByText('Warehouse', { exact: true })).toBeVisible()
  await page.getByRole('checkbox', { name: 'Select Bath Soap' }).click()
  await page.getByRole('button', { name: 'Create transfers' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Create transfer' }).click()
  await expect(page.getByRole('dialog').getByRole('link', { name: 'TRF-000004' })).toBeVisible()
  expect(captured.transfer?.body).toEqual({ store_id: 's-1', lines: [{ variant_id: 'v-3', quantity: '28' }] })
  expect(captured.transfer?.key).toBeTruthy()
})

test('shows the supplier catalog and sets the preferred supplier', async ({ page }) => {
  const captured = await mockBackend(page)
  await page.goto('/admin/suppliers/sup-2')

  await expect(page.getByRole('heading', { name: 'Fresh Drinks Ltd' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Catalog' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('Mango Juice 1L')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export' })).toBeEnabled()
  await page.getByRole('button', { name: 'Make Fresh Drinks Ltd the preferred supplier of Mango Juice 1L' }).click()
  await expect.poll(() => captured.preferred).toBe(true)

  await page.getByRole('button', { name: 'Edit Mango Juice 1L' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Last purchase cost')).toBeVisible()
  await expect(dialog.getByLabel('Pack size')).toHaveValue('24')
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  await page.getByRole('tab', { name: 'Details' }).click()
  await expect(page.getByText('15 days')).toBeVisible()
})

test('saves the replenishment settings', async ({ page }) => {
  const captured = await mockBackend(page)
  await page.goto('/admin/inventory/settings')

  const coverage = page.getByLabel('Coverage (days)')
  await expect(coverage).toHaveValue('14')
  await coverage.fill('21')
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByText('Replenishment settings saved.')).toBeVisible()
  expect(captured.settings).toEqual({ source_store_id: 's-2', coverage_days: 21, velocity_days: 30, safety_days: 3 })
})
