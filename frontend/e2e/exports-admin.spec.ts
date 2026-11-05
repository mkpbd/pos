import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * List exports (X1) against a mocked API: the Export menu downloads Excel / PDF with the
 * list's current filters, names the file from Content-Disposition, explains failures and is
 * disabled for an empty list. Runs on desktop and mobile.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const paged = (items: unknown[], meta: Record<string, unknown> = {}) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 }, ...meta })
const failure = (code: string, message: string, details: Record<string, unknown> = {}) => ({ success: false, error: { code, message, details }, meta: { request_id: 'e2e' } })

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const me = {
  user: { id: 'u-1', name: 'Nadia Admin', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-1', name: 'Manager', system_key: null }],
  permissions: ['branches.view', 'sales.view', 'web_orders.view', 'products.view', 'inventory.view'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
}

const order = {
  id: 'wo-1', number: 'WEB-000001', placed_at: '2026-10-31T04:30:00Z', status: 'shipped', payment_status: 'paid', payment_method: 'cod',
  contact_name: 'Ayesha Rahman', contact_phone: '01711000000', total: '1560.00', currency: 'BDT', item_count: 2,
}
const product = {
  id: 'p-1', name: 'Baby Romper', type: 'standard', is_active: true, archived_at: null, category: null, images: [],
  variants: [{ id: 'v-1', name: null, sku: 'ROMP-M', selling_price: '750.00' }],
}
const summary = {
  date: '2026-11-05', timezone: 'Asia/Dhaka', branch_id: null, currency: 'BDT', sales_count: 0, gross_sales: '0.00', discounts: '0.00', net_sales: '0.00',
  tax: '0.00', total: '0.00', average_sale: '0.00', cost: null, gross_profit: null, paid: '0.00', due: '0.00', cancelled_count: 0, cancelled_total: '0.00', payments: [],
}

type ExportReply = (url: URL) => { status?: number; contentType: string; body: string | Buffer; filename?: string }

async function mockBackend(page: Page, onExport: ExportReply) {
  const exports: URL[] = []
  // Registered first, so every specific route below wins over it.
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: paged([]) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/sales/summary**', (route) => route.fulfill({ json: envelope(summary) }))

  const list = (path: string, items: unknown[], meta: Record<string, unknown> = {}) =>
    page.route((url) => url.pathname === `/api/v1${path}`, (route: Route) => {
      const url = new URL(route.request().url())
      if (!url.searchParams.has('export')) return route.fulfill({ json: paged(items, meta) })
      exports.push(url)
      const reply = onExport(url)
      return route.fulfill({
        status: reply.status ?? 200,
        contentType: reply.contentType,
        body: reply.body,
        headers: reply.filename ? { 'Content-Disposition': `attachment; filename="${reply.filename}"`, 'Cache-Control': 'no-store' } : {},
      })
    })
  await list('/web-orders', [order], { status_counts: { shipped: 1 } })
  await list('/products', [product])
  await list('/sales', [])
  return exports
}

async function openExport(page: Page, format: 'Excel (.xlsx)' | 'PDF') {
  const button = page.getByRole('button', { name: 'Export' })
  await expect(button).toBeEnabled()
  await button.click()
  await page.getByRole('menuitem', { name: format }).click()
}

test('downloads web orders as Excel and PDF with the filters from the address', async ({ page }) => {
  const exports = await mockBackend(page, (url) =>
    url.searchParams.get('export') === 'pdf'
      ? { contentType: 'application/pdf', body: Buffer.from('%PDF-1.7 e2e'), filename: 'web-orders-berry-kids-20261105-1430.pdf' }
      : { contentType: XLSX, body: Buffer.from('PK e2e'), filename: 'web-orders-berry-kids-20261105-1430.xlsx' },
  )

  await page.goto('/admin/web-orders?status=shipped&payment_method=cod')
  await expect(page.getByText('WEB-000001').first()).toBeVisible()

  const excel = page.waitForEvent('download')
  await openExport(page, 'Excel (.xlsx)')
  expect((await excel).suggestedFilename()).toBe('web-orders-berry-kids-20261105-1430.xlsx')
  await expect(page.getByText('Downloaded web-orders-berry-kids-20261105-1430.xlsx')).toBeVisible()

  const pdf = page.waitForEvent('download')
  await openExport(page, 'PDF')
  expect((await pdf).suggestedFilename()).toBe('web-orders-berry-kids-20261105-1430.pdf')

  expect(exports).toHaveLength(2)
  for (const [i, format] of (['xlsx', 'pdf'] as const).entries()) {
    const q = exports[i]!.searchParams
    expect(q.get('export')).toBe(format)
    expect(q.get('status')).toBe('shipped')
    expect(q.get('payment_method')).toBe('cod')
    expect(q.has('page')).toBe(false)
    expect(q.has('per_page')).toBe(false)
  }
})

test('explains a too-large export and an unavailable PDF renderer', async ({ page }) => {
  await mockBackend(page, (url) =>
    url.searchParams.get('export') === 'pdf'
      ? { status: 503, contentType: 'application/json', body: JSON.stringify(failure('PDF_UNAVAILABLE', 'PDF rendering is unavailable.')) }
      : { status: 422, contentType: 'application/json', body: JSON.stringify(failure('EXPORT_TOO_LARGE', 'Too many rows.', { limit: 50000, rows: 61234 })) },
  )
  let downloads = 0
  page.on('download', () => downloads++)

  await page.goto('/admin/products')
  await expect(page.getByText('Baby Romper')).toBeVisible()

  await openExport(page, 'Excel (.xlsx)')
  await expect(page.getByText('This list has 61,234 rows. Excel exports are limited to 50,000 rows — narrow the filters and try again.')).toBeVisible()

  await openExport(page, 'PDF')
  await expect(page.getByText(/PDF export is not available right now/)).toBeVisible()
  expect(downloads).toBe(0)
})

test('the Export button is disabled while the list is empty', async ({ page }) => {
  await mockBackend(page, () => ({ contentType: XLSX, body: 'never', filename: 'never.xlsx' }))

  await page.goto('/admin/sales')
  await expect(page.getByText('No sales on this day')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export' })).toBeDisabled()
})
