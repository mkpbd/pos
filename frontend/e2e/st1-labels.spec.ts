import { expect, test, type Page } from '@playwright/test'

/**
 * ST1 label printing against a mocked API: "Print labels" on a goods receipt opens the labels
 * page with the received quantities, barcodes are created for items without one, the template
 * and fields are chosen (and remembered), the preview is at true size, and printing renders
 * every page with the template's @page size. Runs on desktop and mobile (375 px wide, no
 * horizontal page scroll).
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const paged = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

const org = { id: 'o-1', name: 'Corner Shop', slug: 'corner-shop', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' }
const branch = { id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }
const me = (permissions: string[]) => ({
  user: { id: 'u-1', name: 'Rahim Uddin', email: 'rahim@corner.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: org, roles: [{ id: 'r-x', name: 'Role', system_key: null }], permissions, branches: [branch],
})
const branches = [{
  id: 'b-1', code: 'MAIN', name: 'Main Branch', email: null, phone: null, address: null, timezone: null, is_active: true, allow_negative_stock: false, created_at: '2026-10-01T00:00:00Z',
  stores: [{ id: 's-1', branch_id: 'b-1', code: 'FLOOR', name: 'Shop floor', type: 'store', is_active: true }],
}]

const supplier = { id: 'sup-1', code: 'SUP-000001', name: 'Local Mills' }
const store = { id: 's-1', code: 'FLOOR', name: 'Shop floor', branch_id: 'b-1', branch_name: 'Main Branch' }
const juiceRef = { id: 'v-1', product_name: 'Mango Juice 1L', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', allow_decimal: false, track_batches: true }
const receipt = {
  id: 'gr-1', number: 'GRN-000001', purchase_order_id: null, supplier, store, currency: 'BDT', subtotal: '360.00', tax_total: '0.00', total: '360.00',
  notes: null, created_at: '2026-11-20T00:00:00Z', supplier_invoice_number: 'LM-1042', invoice_date: '2026-11-20', due_date: null,
  lines: [{ id: 'grl-1', variant: juiceRef, quantity: '3.000', returned_quantity: '0.000', unit_cost: '90.0000', tax_rate: '0.0000', line_subtotal: '270.00', line_tax: '0.00', line_total: '270.00' }],
}

const juice = {
  variant_id: 'v-1', product_name: 'Mango Juice 1L', variant_name: null, sku: 'JUICE-1L', barcode: '4006381333931', barcode_format: 'ean13',
  price: '120.00', currency: 'BDT', unit: 'pcs', quantity: '3.000', batch_number: 'MJ-2611', expires_on: '2027-01-31',
}
const tea = { variant_id: 'v-2', product_name: 'Tea Leaves 400g', variant_name: null, sku: 'TEA-400', barcode: null, barcode_format: null, price: '280.00', currency: 'BDT', unit: 'pcs', quantity: '2.000' }

async function signedIn(page: Page, permissions: string[]) {
  await page.addInitScript(() => localStorage.setItem('pos-session', JSON.stringify({ state: { activeBranchId: 'b-1' }, version: 0 })))
  // The print dialog is replaced by a probe that records what would be printed.
  await page.addInitScript(`window.print = () => {
    const root = document.querySelector('.print-root');
    window.__printed = { rule: root?.querySelector('style')?.textContent ?? '', pages: root?.querySelectorAll('.label-page').length ?? 0, barcodes: root?.querySelectorAll('svg[role=img]').length ?? 0 };
  }`)
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: paged([]) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me(permissions)) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/branches?**', (route) => route.fulfill({ json: paged(branches) }))
}

async function phoneWidth(page: Page, isMobile: boolean) {
  if (isMobile) await page.setViewportSize({ width: 375, height: 812 })
}

async function expectNoHorizontalScroll(page: Page) {
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
}

test('labels from a goods receipt: create a barcode, choose the sheet and print every page', async ({ page, isMobile }) => {
  await phoneWidth(page, isMobile)
  const labelQueries: string[] = []
  let generated: unknown
  await signedIn(page, ['branches.view', 'products.view', 'products.manage', 'purchases.view'])
  await page.route('**/api/v1/purchasing/receipts/gr-1', (route) => route.fulfill({ json: envelope(receipt) }))
  await page.route((url) => url.pathname === '/api/v1/products/labels', (route) => {
    labelQueries.push(decodeURIComponent(new URL(route.request().url()).search))
    return route.fulfill({ json: envelope({ labels: [juice, tea], shop: { name: 'Corner Shop', currency: 'BDT' } }) })
  })
  await page.route('**/api/v1/products/barcodes/generate', (route) => {
    generated = route.request().postDataJSON()
    return route.fulfill({ json: envelope([{ variant_id: 'v-2', barcode: '2000000000015', generated: true }]) })
  })

  await page.goto('/admin/purchasing/receipts/gr-1')
  await page.getByRole('link', { name: 'Print labels' }).click()
  await expect(page).toHaveURL(/\/admin\/products\/labels\?goods_receipt_id=gr-1$/)

  const items = page.getByRole('list', { name: 'Label items' })
  await expect(items.getByText('Mango Juice 1L')).toBeVisible()
  expect(new Set(labelQueries)).toEqual(new Set(['?goods_receipt_id=gr-1']))
  await expect(page.getByLabel('Labels for Mango Juice 1L')).toHaveValue('3')
  await expect(page.getByLabel('Labels for Tea Leaves 400g')).toHaveValue('2')
  await expect(items.getByText('No barcode: SKU printed')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Print 5 labels' })).toBeEnabled()

  // True size: an A4 sheet is 210 mm = 793.7 CSS px wide.
  const preview = page.getByRole('group', { name: 'Preview page 1' })
  const box = await preview.boundingBox()
  expect(Math.round(box!.width)).toBe(794)
  await expect(preview.getByRole('img', { name: 'Barcode 4006381333931' })).toHaveCount(3)
  await expect(preview.getByRole('img', { name: 'Barcode TEA-400' })).toHaveCount(2)
  await expectNoHorizontalScroll(page)

  await page.getByRole('button', { name: 'Create barcodes for 1 item' }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Create barcodes?' })
  await expect(confirm).toContainText('in-store EAN-13')
  await confirm.getByRole('button', { name: 'Create barcodes' }).click()
  await expect(items.getByText('2000000000015 · EAN-13')).toBeVisible()
  expect(generated).toEqual({ variant_ids: ['v-2'] })
  await expect(preview.getByRole('img', { name: 'Barcode 2000000000015' })).toHaveCount(2)

  // Smaller labels: 65 to an A4 sheet, with the SKU line.
  await page.getByRole('combobox', { name: 'Label size' }).click()
  await page.getByRole('option', { name: 'A4 sheet, 65 labels (38.1 × 21.2 mm)' }).click()
  await page.getByRole('checkbox', { name: 'SKU' }).check()
  await expect(preview.getByText('JUICE-1L').first()).toBeVisible()

  await page.getByLabel('Labels for Mango Juice 1L').fill('70')
  await expect(page.getByText('72 labels on 2 pages')).toBeVisible()
  await page.getByRole('button', { name: 'Next page' }).click()
  await expect(page.getByRole('group', { name: 'Preview page 2' })).toBeVisible()
  await expectNoHorizontalScroll(page)

  await page.getByRole('button', { name: 'Print 72 labels' }).click()
  await expect.poll(() => page.evaluate('window.__printed')).toEqual({ rule: expect.stringContaining('@page { size: 210mm 297mm; margin: 0; }'), pages: 2, barcodes: 72 })

  // The choice is remembered for next time.
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Label size' })).toContainText('65 labels')
  await expect(page.getByRole('checkbox', { name: 'SKU' })).toBeChecked()
})

test('thermal roll: one label per page; viewers see neither barcode creation nor receipts', async ({ page, isMobile }) => {
  await phoneWidth(page, isMobile)
  await signedIn(page, ['branches.view', 'products.view'])
  await page.route((url) => url.pathname === '/api/v1/products/labels', (route) => route.fulfill({ json: envelope({ labels: [{ ...tea, quantity: 1 }], shop: null }) }))

  await page.goto('/admin/products/labels?variant_ids=v-2')
  await expect(page.getByLabel('Labels for Tea Leaves 400g')).toHaveValue('1')
  await expect(page.getByRole('button', { name: /Create barcodes/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'From receipt or order' })).toHaveCount(0)

  await page.getByRole('combobox', { name: 'Label size' }).click()
  await page.getByRole('option', { name: 'Thermal roll 50 × 30 mm' }).click()
  const preview = page.getByRole('group', { name: 'Preview page 1' })
  const box = await preview.boundingBox()
  // 50 × 30 mm at 96 dpi.
  expect(Math.round(box!.width)).toBe(189)
  expect(Math.round(box!.height)).toBe(113)
  await expect(preview.getByRole('img', { name: 'Barcode TEA-400' })).toHaveAttribute('data-format', 'code128')

  await page.getByLabel('Labels for Tea Leaves 400g').fill('3')
  await page.getByRole('button', { name: 'Print 3 labels' }).click()
  await expect.poll(() => page.evaluate('window.__printed')).toEqual({ rule: expect.stringContaining('@page { size: 50mm 30mm; margin: 0; }'), pages: 3, barcodes: 3 })
  await expectNoHorizontalScroll(page)
})
