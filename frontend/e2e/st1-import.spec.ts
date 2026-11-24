import { expect, test, type Page } from '@playwright/test'

/**
 * ST1 bulk import against a mocked API: "Import customers" on the Customers page opens the
 * wizard, the template downloads, the uploaded file is checked ("Checking your file…" while the
 * API polls), the preview shows counts and the first errors with the CSV of all errors, and the
 * import runs to its result. Also: wrong headers, and the history. Desktop and mobile (375 px,
 * no horizontal page scroll).
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const paged = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })
const failure = (status: number, code: string, message: string, details: Record<string, unknown> = {}) => ({
  status,
  json: { success: false, error: { code, message, details }, meta: { request_id: 'e2e' } },
})

const org = { id: 'o-1', name: 'Corner Shop', slug: 'corner-shop', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' }
const branch = { id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }
const me = (permissions: string[]) => ({
  user: { id: 'u-1', name: 'Rahim Uddin', email: 'rahim@corner.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: org, roles: [{ id: 'r-x', name: 'Role', system_key: null }], permissions, branches: [branch],
})

const customerType = {
  type: 'customers', label: 'Customers', permission: 'customers.manage', max_rows: 20000,
  columns: [
    { key: 'name', label: 'Name', required: true, example: 'Salma Begum', help: 'Full name as it should appear on receipts' },
    { key: 'phone', label: 'Phone', required: false, example: '01711112222', help: 'Bangladeshi mobile number; an existing customer with this phone is updated' },
    { key: 'email', label: 'E-mail', required: false, example: 'salma@example.com', help: null },
  ],
}

const base = {
  id: 'imp-1', type: 'customers', file_name: 'customers.csv', rows_total: null, rows_valid: null, rows_error: null, to_create: null, to_update: null, to_skip: null,
  created: null, updated: null, skipped: null, failed_rows: null, errors: [], errors_truncated: false, options: { update_existing: true },
  created_by: { id: 'u-1', name: 'Rahim Uddin' }, created_at: '2026-11-24T04:00:00Z', validated_at: null, started_at: null, finished_at: null, message: null,
}
const errors = [
  { row: 4, column: 'phone', message: 'The phone number is not valid.' },
  { row: 9, column: 'name', message: 'The name is required.' },
]
const validated = { ...base, status: 'validated', rows_total: 52, rows_valid: 50, rows_error: 2, to_create: 40, to_update: 10, to_skip: 0, errors, validated_at: '2026-11-24T04:00:05Z' }
const completed = { ...validated, status: 'completed', created: 40, updated: 10, skipped: 0, failed_rows: 0, started_at: '2026-11-24T04:01:00Z', finished_at: '2026-11-24T04:01:09Z' }

async function signedIn(page: Page, permissions: string[]) {
  await page.addInitScript(() => localStorage.setItem('pos-session', JSON.stringify({ state: { activeBranchId: 'b-1' }, version: 0 })))
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: paged([]) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me(permissions)) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/imports/types', (route) => route.fulfill({ json: envelope([customerType]) }))
}

async function phoneWidth(page: Page, isMobile: boolean) {
  if (isMobile) await page.setViewportSize({ width: 375, height: 812 })
}

async function expectNoHorizontalScroll(page: Page) {
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
}

test('import customers: template, check, preview with errors, import and result', async ({ page, isMobile }) => {
  await phoneWidth(page, isMobile)
  let upload = ''
  let details = 0
  let ran = 0
  await signedIn(page, ['branches.view', 'customers.view', 'customers.create', 'customers.manage'])
  await page.route('**/api/v1/imports/templates/customers?**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', headers: { 'Content-Disposition': 'attachment; filename="customers-template.xlsx"' }, body: Buffer.from('PK e2e') }))
  await page.route('**/api/v1/imports', (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    upload = route.request().postDataBuffer()?.toString('utf8') ?? ''
    return route.fulfill({ status: 201, json: envelope({ ...base, status: 'validating' }) })
  })
  await page.route('**/api/v1/imports/imp-1', (route) => {
    details++
    // Checking for the first answer, then ready; after the run: importing, then completed.
    const data = ran > 0 ? completed : details === 1 ? { ...base, status: 'validating' } : validated
    return route.fulfill({ json: envelope(data) })
  })
  await page.route('**/api/v1/imports/imp-1/run', (route) => {
    ran++
    return route.fulfill({ json: envelope({ ...validated, status: 'importing', created: 12, updated: 3, skipped: 0, failed_rows: 0 }) })
  })
  await page.route('**/api/v1/imports/imp-1/errors.csv', (route) =>
    route.fulfill({ status: 200, contentType: 'text/csv', headers: { 'Content-Disposition': 'attachment; filename="import-errors.csv"' }, body: 'row,column,message\n4,phone,The phone number is not valid.\n' }))

  await page.goto('/admin/customers')
  await page.getByRole('link', { name: 'Import customers' }).click()
  await expect(page).toHaveURL(/\/admin\/imports\/new\?type=customers$/)
  await expect(page.getByRole('radio', { name: 'Customers' })).toBeChecked()
  await expect(page.getByRole('table', { name: 'Columns for Customers' }).getByText('an existing customer with this phone is updated', { exact: false })).toBeVisible()
  await expectNoHorizontalScroll(page)

  const template = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Excel template' }).click()
  expect((await template).suggestedFilename()).toBe('customers-template.xlsx')

  await page.getByLabel(/^File/).setInputFiles({ name: 'customers.csv', mimeType: 'text/csv', buffer: Buffer.from('﻿name,phone\nSalma Begum,01711112222\n') })
  await page.getByRole('button', { name: 'Upload and check' }).click()
  await expect(page).toHaveURL(/\/admin\/imports\/imp-1$/)
  expect(upload).toContain('name="type"')
  expect(upload).toContain('customers')
  expect(upload).toContain('filename="customers.csv"')
  expect(upload).toContain('name="options[update_existing]"')

  await expect(page.getByText('Checking your file…')).toBeVisible()
  // Polled every 2 s until the check is done.
  const stats = page.getByLabel('Check result')
  await expect(stats).toContainText('New40', { timeout: 10_000 })
  await expect(stats).toContainText('Updated10')
  await expect(stats).toContainText('With errors2')
  await expect(page.getByRole('table', { name: 'Errors' }).getByText('The phone number is not valid.')).toBeVisible()
  await expectNoHorizontalScroll(page)

  const csv = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download all errors (CSV)' }).click()
  expect((await csv).suggestedFilename()).toBe('import-errors.csv')

  await page.getByRole('button', { name: 'Import 50 rows' }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Import 50 rows?' })
  await expect(confirm).toContainText('The 2 rows with errors are left out.')
  await confirm.getByRole('button', { name: 'Import' }).click()
  await expect(page.getByRole('progressbar', { name: 'Import progress' })).toBeVisible()
  expect(ran).toBe(1)

  const result = page.getByLabel('Import result')
  await expect(result).toContainText('Created40', { timeout: 10_000 })
  await expect(result).toContainText('Updated10')
  await expect(page.getByRole('link', { name: 'Go to customers' })).toBeVisible()
  await expectNoHorizontalScroll(page)
})

test('wrong header row: the missing and unknown columns are named; history lists past imports', async ({ page, isMobile }) => {
  await phoneWidth(page, isMobile)
  await signedIn(page, ['branches.view', 'customers.view', 'customers.manage'])
  await page.route('**/api/v1/imports', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill(failure(422, 'IMPORT_BAD_HEADERS', 'The file header is not valid.', { missing: ['name'], unknown: ['full name', 'mobile'] }))
      : route.fallback())
  await page.route('**/api/v1/imports?**', (route) => route.fulfill({ json: paged([completed]) }))

  await page.goto('/admin/imports/new?type=customers')
  await page.getByLabel(/^File/).setInputFiles({ name: 'list.csv', mimeType: 'text/csv', buffer: Buffer.from('full name;mobile\nSalma;01711112222\n') })
  await page.getByRole('button', { name: 'Upload and check' }).click()
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('Missing: name')
  await expect(alert).toContainText('Not recognised: full name, mobile')
  await expectNoHorizontalScroll(page)

  await page.getByRole('link', { name: 'Past imports' }).click()
  const table = page.getByRole('table', { name: 'Imports' })
  await expect(table.getByRole('link', { name: 'customers.csv' })).toBeVisible()
  await expect(table.getByText('Completed')).toBeVisible()
  await expectNoHorizontalScroll(page)
})
