import { expect, test, type Page, type Request, type Route } from '@playwright/test'

/**
 * Content → Form submissions (B8b) against a mocked API: forms list with counts, filter by form,
 * open a submission, mark read, archive, delete after confirming, export; the bell link opens a
 * submission; read-only without forms.manage. Runs on desktop and mobile.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })

const user = (permissions: string[]) => ({
  user: { id: 'u-1', name: 'Nadia Admin', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-1', name: 'Online Store Manager', system_key: null }],
  permissions,
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
})

type Status = 'new' | 'read' | 'archived'
type Submission = {
  id: string
  document_id: string
  element_id: string
  form_title: string
  document_title: string
  fields: { id: string; label: string; kind: string }[]
  values: Record<string, unknown>
  reply_to: string | null
  locale: string
  page_path: string
  status: Status
  read_at: string | null
  read_by: { id: string; name: string } | null
  created_at: string
  updated_at: string
}

const contactFields = [
  { id: 'f-name', label: 'Name', kind: 'text' },
  { id: 'f-email', label: 'E-mail', kind: 'email' },
  { id: 'f-size', label: 'Size', kind: 'select' },
  { id: 'f-msg', label: 'Message', kind: 'textarea' },
]
const base = { document_id: 'd-1', element_id: 'el-contact', form_title: 'Contact us', document_title: 'Contact page', fields: contactFields, locale: 'en', page_path: '/pages/contact', status: 'new' as Status, read_at: null, read_by: null, updated_at: '2026-11-10T05:00:00Z' }
const seed = (): Submission[] => [
  { ...base, id: 'fs-1', values: { 'f-name': 'Ayesha Rahman', 'f-email': 'ayesha@example.com', 'f-size': '2-3 years', 'f-msg': 'Do you deliver to Sylhet?' }, reply_to: 'ayesha@example.com', created_at: '2026-11-10T05:00:00Z' },
  { ...base, id: 'fs-2', values: { 'f-name': 'Karim Ali', 'f-email': null, 'f-size': '4-5 years', 'f-msg': 'Is the romper cotton?' }, reply_to: null, created_at: '2026-11-09T05:00:00Z' },
  {
    ...base,
    id: 'fs-3',
    document_id: 'd-2',
    element_id: 'el-wholesale',
    form_title: 'Wholesale enquiry',
    document_title: 'Wholesale popup',
    fields: [{ id: 'f-shop', label: 'Shop name', kind: 'text' }, { id: 'f-qty', label: 'Quantity', kind: 'number' }],
    values: { 'f-shop': 'Sumi Traders', 'f-qty': '200' },
    reply_to: null,
    created_at: '2026-11-08T05:00:00Z',
  },
]

const keyOf = (s: Pick<Submission, 'document_id' | 'element_id'>) => `${s.document_id}:${s.element_id}`

function formsOf(store: Submission[]) {
  const defs = [
    { document_id: 'd-1', element_id: 'el-contact', title: 'Contact us', document_title: 'Contact page', document_kind: 'page' },
    { document_id: 'd-2', element_id: 'el-wholesale', title: 'Wholesale enquiry', document_title: 'Wholesale popup', document_kind: 'popup' },
  ]
  return defs.map((f) => {
    const mine = store.filter((s) => keyOf(s) === keyOf(f))
    return { ...f, total: mine.length, new: mine.filter((s) => s.status === 'new').length, last_submitted_at: mine[0]?.created_at ?? null }
  })
}

const notFound = { success: false, error: { code: 'NOT_FOUND', message: 'Not found.', details: {} }, meta: { request_id: 'e2e' } }

async function mockBackend(page: Page, permissions: string[], store: Submission[], notifications: unknown[] = []) {
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(user(permissions)) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: notifications.length }) }))
  await page.route((url) => url.pathname === '/api/v1/notifications', (route) => route.fulfill({ json: envelope(notifications) }))
  await page.route(/\/api\/v1\/notifications\/[^/]+\/read$/, (route) => route.fulfill({ json: envelope(null) }))
  await page.route((url) => url.pathname === '/api/v1/forms', (route) => route.fulfill({ json: envelope(formsOf(store)) }))
  await page.route((url) => url.pathname === '/api/v1/forms/submissions', (route: Route) => {
    const q = new URL(route.request().url()).searchParams
    if (q.has('export')) {
      return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/csv; charset=UTF-8', 'Content-Disposition': 'attachment; filename="contact-us-submissions.csv"' }, body: 'Received,Status\n' })
    }
    const term = q.get('search')?.toLowerCase()
    const rows = store.filter(
      (s) =>
        (!q.get('form') || keyOf(s) === q.get('form')) &&
        (!q.get('status') || s.status === q.get('status')) &&
        (!term || JSON.stringify(s.values).toLowerCase().includes(term)),
    )
    const counts = { new: 0, read: 0, archived: 0 }
    for (const s of store.filter((s) => !q.get('form') || keyOf(s) === q.get('form'))) counts[s.status]++
    return route.fulfill({ json: envelope(rows, { pagination: { current_page: 1, per_page: 25, total: rows.length, last_page: 1 }, status_counts: counts }) })
  })
  await page.route(/\/api\/v1\/forms\/submissions\/[^/?]+$/, (route: Route) => {
    const request = route.request()
    const id = new URL(request.url()).pathname.split('/').pop()
    const index = store.findIndex((s) => s.id === id)
    if (index < 0) return route.fulfill({ status: 404, json: notFound })
    if (request.method() === 'DELETE') {
      store.splice(index, 1)
      return route.fulfill({ status: 204 })
    }
    if (request.method() === 'PATCH') {
      const { status } = request.postDataJSON() as { status: Status }
      const read = status === 'new' ? { read_at: null, read_by: null } : { read_at: store[index]!.read_at ?? '2026-11-11T05:00:00Z', read_by: store[index]!.read_by ?? { id: 'u-1', name: 'Nadia Admin' } }
      store[index] = { ...store[index]!, status, ...read }
    }
    return route.fulfill({ json: envelope({ ...store[index], ip: '203.0.113.9', user_agent: 'Mozilla/5.0' }) })
  })
}

const MANAGER = ['cms.manage', 'forms.view', 'forms.manage']

test('reads, marks, archives and deletes form submissions, and exports one form', async ({ page }) => {
  const store = seed()
  await mockBackend(page, MANAGER, store)

  await page.goto('/admin/content/forms')
  await expect(page.getByRole('heading', { name: 'Content' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Form submissions' })).toHaveAttribute('aria-current', 'page')
  const forms = page.getByRole('list', { name: 'Forms' })
  await expect(forms.getByRole('button', { name: /Contact us/ })).toContainText('2 new · 2 total')
  await expect(forms.getByRole('button', { name: /Wholesale enquiry/ })).toContainText('1 new · 1 total')
  const table = page.getByRole('table', { name: 'Form submissions' })
  await expect(table.getByRole('row')).toHaveCount(4)
  await expect(page.getByRole('tab', { name: 'New (3)' })).toBeVisible()

  await forms.getByRole('button', { name: /Contact us/ }).click()
  await expect(page).toHaveURL(/\/admin\/content\/forms\?form=d-1%3Ael-contact$/)
  await expect(table.getByRole('row')).toHaveCount(3)

  const exported = page.waitForRequest((r: Request) => r.url().includes('/api/v1/forms/submissions?') && r.url().includes('export=csv'))
  await page.getByRole('button', { name: 'Export' }).click()
  await page.getByRole('menuitem', { name: 'CSV (.csv)' }).click()
  const exportUrl = new URL((await exported).url())
  expect(exportUrl.searchParams.get('form')).toBe('d-1:el-contact')
  await expect(page.getByText('Downloaded contact-us-submissions.csv')).toBeVisible()

  await table.getByRole('link', { name: 'Name: Ayesha Rahman · E-mail: ayesha@example.com' }).click()
  await expect(page).toHaveURL(/\/admin\/content\/forms\/fs-1\?form=d-1%3Ael-contact$/)
  const sheet = page.getByRole('dialog', { name: 'Contact us' })
  await expect(sheet.getByText('2-3 years')).toBeVisible()
  await expect(sheet.getByText('Do you deliver to Sylhet?')).toBeVisible()
  await expect(sheet.getByTestId('reply-to')).toHaveText('ayesha@example.com')
  await expect(sheet.getByRole('link', { name: 'Reply by e-mail' })).toHaveAttribute('href', 'mailto:ayesha@example.com?subject=Re%3A%20Contact%20us')

  const marked = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/forms/submissions/fs-1') && r.method() === 'PATCH')
  await sheet.getByRole('button', { name: 'Mark as read' }).click()
  expect((await marked).postDataJSON()).toEqual({ status: 'read' })
  await expect(sheet.getByText(/by Nadia Admin/)).toBeVisible()
  await sheet.getByRole('button', { name: 'Archive' }).click()
  await expect(sheet.getByRole('button', { name: 'Unarchive' })).toBeVisible()
  expect(store.find((s) => s.id === 'fs-1')?.status).toBe('archived')

  await sheet.getByRole('button', { name: 'Delete' }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Delete this submission?' })
  await confirm.getByRole('button', { name: 'Delete submission' }).click()
  await expect(page.getByText('Submission deleted.')).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/content\/forms\?form=d-1%3Ael-contact$/)
  await expect(sheet).toBeHidden()
  await expect(table.getByRole('row')).toHaveCount(2)
  expect(store.map((s) => s.id)).toEqual(['fs-2', 'fs-3'])

  await page.getByRole('tab', { name: 'Archived' }).click()
  await expect(page).toHaveURL(/status=archived/)
  await expect(page.getByText('No submissions match these filters')).toBeVisible()
})

test('the bell notification opens the submission; read-only without forms.manage', async ({ page }) => {
  const notification = {
    id: 'n-1',
    type: 'storefront.form_submitted',
    data: { title: 'New form submission: Wholesale enquiry', message: 'Shop name: Sumi Traders', url: '/content/forms/fs-3', link: '/content/forms/fs-3' },
    read_at: null,
    created_at: '2026-11-08T05:00:00Z',
  }
  await mockBackend(page, ['forms.view'], seed(), [notification])

  await page.goto('/admin/content/forms')
  const tabs = page.getByRole('navigation', { name: 'Content sections' })
  await expect(tabs.getByRole('link')).toHaveText(['Form submissions'])

  await page.getByRole('button', { name: 'Notifications (1 unread)' }).click()
  await page.getByRole('button', { name: /New form submission: Wholesale enquiry/ }).click()
  await expect(page).toHaveURL(/\/admin\/content\/forms\/fs-3$/)
  const sheet = page.getByRole('dialog', { name: 'Wholesale enquiry' })
  await expect(sheet.getByText('Sumi Traders')).toBeVisible()
  await expect(sheet.getByText('200', { exact: true })).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Mark as read' })).toHaveCount(0)
  await expect(sheet.getByRole('button', { name: 'Delete' })).toHaveCount(0)

  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(page).toHaveURL(/\/admin\/content\/forms$/)
})
