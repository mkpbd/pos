import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import { filtersFromSearchParams, formatSubmissionValue, replyMailto, submissionSummary, toListParams } from '@/features/content/form-submissions'
import type { FormSubmission, FormSummary } from '@/features/content/forms-api'
import { captureDownloads, mockApiWithExports } from '@/features/exports/testing'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, success: toastSuccess, error: vi.fn(), message: vi.fn() }) }
})

beforeEach(() => toastSuccess.mockReset())

const manager = () => makeCurrentUser({ permissions: ['cms.manage', 'forms.view', 'forms.manage'] })
const viewer = () => makeCurrentUser({ permissions: ['forms.view'] })
const paged = (items: unknown[], meta: Record<string, unknown> = {}) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 }, ...meta })

const forms: FormSummary[] = [
  { document_id: 'd-1', element_id: 'el-contact', title: 'Contact us', document_title: 'Contact page', document_kind: 'page', total: 2, new: 1, last_submitted_at: '2026-11-10T05:00:00Z' },
  { document_id: 'd-2', element_id: 'el-wholesale', title: 'Wholesale enquiry', document_title: 'Wholesale popup', document_kind: 'popup', total: 1, new: 0, last_submitted_at: '2026-11-09T05:00:00Z' },
]

const submission = (overrides: Partial<FormSubmission> = {}): FormSubmission => ({
  id: 'fs-1',
  document_id: 'd-1',
  element_id: 'el-contact',
  form_title: 'Contact us',
  document_title: 'Contact page',
  fields: [
    { id: 'f-name', label: 'Name', kind: 'text' },
    { id: 'f-email', label: 'E-mail', kind: 'email' },
    { id: 'f-topics', label: 'Topics', kind: 'checkboxes' },
    { id: 'f-msg', label: 'Message', kind: 'textarea' },
  ],
  values: { 'f-name': 'Ayesha Rahman', 'f-email': 'ayesha@example.com', 'f-topics': ['Delivery', 'Sizes'], 'f-msg': 'Do you deliver to Sylhet?' },
  reply_to: 'ayesha@example.com',
  locale: 'bn',
  page_path: '/pages/contact',
  status: 'new',
  read_at: null,
  read_by: null,
  created_at: '2026-11-10T05:00:00Z',
  ...overrides,
})

describe('form submission helpers', () => {
  it('formats values and summarises the first answered fields', () => {
    expect(formatSubmissionValue(['a', 'b'])).toBe('a, b')
    expect(formatSubmissionValue(true)).toBe('Yes')
    expect(formatSubmissionValue(false)).toBe('No')
    expect(formatSubmissionValue(null)).toBe('—')
    expect(formatSubmissionValue(12)).toBe('12')
    expect(submissionSummary(submission())).toBe('Name: Ayesha Rahman · E-mail: ayesha@example.com')
    expect(submissionSummary(submission({ values: { 'f-msg': 'x'.repeat(80) } }))).toBe(`Message: ${'x'.repeat(59)}…`)
    expect(submissionSummary(submission({ values: {} }))).toBe('No answers')
  })

  it('reads filters from the address and drops invalid ones', () => {
    const filters = filtersFromSearchParams(new URLSearchParams('form=d-1:el-contact&status=bogus&from=2026-11-01&to=nope&page=3&search=sylhet'))
    expect(filters).toEqual({ form: 'd-1:el-contact', status: null, search: 'sylhet', from: '2026-11-01', to: '', page: 3 })
    expect(toListParams(filters)).toEqual({ page: 3, form: 'd-1:el-contact', search: 'sylhet', from: '2026-11-01' })
  })

  it('builds a reply link only for one plain address', () => {
    expect(replyMailto(submission())).toBe('mailto:ayesha@example.com?subject=Re%3A%20Contact%20us')
    expect(replyMailto(submission({ reply_to: 'a@b.com?cc=x@y.com' }))).toBeNull()
    expect(replyMailto(submission({ reply_to: null }))).toBeNull()
  })
})

describe('Content → Form submissions', () => {
  it('lists forms with new counts and the submissions table; a form filter narrows the list and its export', async () => {
    const user = userEvent.setup()
    const saved = captureDownloads()
    const { exportCalls } = mockApiWithExports({
      'GET /auth/me': ok(manager()),
      'GET /forms': ok(forms),
      'GET /forms/submissions': (_init, url) => {
        const form = url.searchParams.get('form')
        const items = [submission(), submission({ id: 'fs-2', status: 'read', values: { 'f-name': 'Karim' } }), submission({ id: 'fs-3', document_id: 'd-2', element_id: 'el-wholesale', form_title: 'Wholesale enquiry', values: { 'f-name': 'Sumi Traders' } })]
        return paged(items.filter((s) => !form || `${s.document_id}:${s.element_id}` === form), { status_counts: { new: 2, read: 1, archived: 0 } })
      },
    })
    const { router } = renderRoutes(routes, '/content/forms')

    const table = await screen.findByRole('table', { name: 'Form submissions' })
    expect(within(table).getAllByRole('row')).toHaveLength(4)
    expect(within(table).getByRole('link', { name: 'Name: Ayesha Rahman · E-mail: ayesha@example.com' })).toHaveAttribute('href', '/content/forms/fs-1')
    expect(screen.getByRole('tab', { name: 'New (2)' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Form submissions' })).toHaveAttribute('aria-current', 'page')

    const list = screen.getByRole('list', { name: 'Forms' })
    expect(within(list).getByRole('button', { name: /All forms/ })).toHaveAttribute('aria-pressed', 'true')
    expect(within(list).getByRole('button', { name: /Contact us/ })).toHaveTextContent('1 new · 2 total')

    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled()
    await user.click(within(list).getByRole('button', { name: /Contact us/ }))
    await waitFor(() => expect(router.state.location.search).toBe('?form=d-1%3Ael-contact'))
    await waitFor(() => expect(within(screen.getByRole('table', { name: 'Form submissions' })).getAllByRole('row')).toHaveLength(3))

    const exportButton = screen.getByRole('button', { name: 'Export' })
    await waitFor(() => expect(exportButton).toBeEnabled())
    await user.click(exportButton)
    await user.click(await screen.findByRole('menuitem', { name: 'CSV (.csv)' }))
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(exportCalls[0]!.url.pathname).toBe('/api/v1/forms/submissions')
    expect(Object.fromEntries(exportCalls[0]!.url.searchParams)).toEqual({ form: 'd-1:el-contact', export: 'csv' })
  })

  it('sends status, dates and search as filters', async () => {
    const user = userEvent.setup()
    const fetchMock = mockApi({
      'GET /auth/me': ok(manager()),
      'GET /forms': ok(forms),
      'GET /forms/submissions': paged([]),
    })
    const { router } = renderRoutes(routes, '/content/forms?status=archived&from=2026-11-01')

    expect(await screen.findByText('No submissions match these filters')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Archived' })).toHaveAttribute('aria-selected', 'true')
    await user.type(screen.getByRole('textbox', { name: 'Search submissions' }), 'sylhet')
    await waitFor(() => expect(router.state.location.search).toContain('search=sylhet'))
    const last = new URL(String(fetchMock.mock.calls.filter(([u]) => String(u).includes('/forms/submissions')).at(-1)![0]), 'http://localhost')
    expect(Object.fromEntries(last.searchParams)).toEqual({ page: '1', status: 'archived', from: '2026-11-01', search: 'sylhet' })

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(router.state.location.search).toBe(''))
  })

  it('opens a submission from a bell link, marks it read, archives it and deletes it after confirming', async () => {
    const user = userEvent.setup()
    let current = submission()
    const patches: unknown[] = []
    let deleted = false
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /forms': ok(forms),
      'GET /forms/submissions': () => paged(deleted ? [] : [current]),
      'GET /forms/submissions/fs-1': () => ok(current),
      'PATCH /forms/submissions/fs-1': (init) => {
        const body = JSON.parse(String(init.body)) as { status: FormSubmission['status'] }
        patches.push(body)
        current = { ...current, status: body.status, read_at: '2026-11-11T05:00:00Z', read_by: { id: 'u-1', name: 'Rahim Uddin' } }
        return ok(current)
      },
      'DELETE /forms/submissions/fs-1': () => {
        deleted = true
        return { status: 204 }
      },
    })
    const { router } = renderRoutes(routes, '/content/forms/fs-1')

    const sheet = await screen.findByRole('dialog', { name: 'Contact us' })
    expect(await within(sheet).findByText('Delivery, Sizes')).toBeInTheDocument()
    expect(within(sheet).getByText('Topics')).toBeInTheDocument()
    expect(within(sheet).getByText('Do you deliver to Sylhet?')).toBeInTheDocument()
    expect(within(sheet).getByTestId('reply-to')).toHaveTextContent('ayesha@example.com')
    expect(within(sheet).getByRole('link', { name: 'Reply by e-mail' })).toHaveAttribute('href', 'mailto:ayesha@example.com?subject=Re%3A%20Contact%20us')
    expect(within(sheet).getByText('Bangla')).toBeInTheDocument()

    await user.click(within(sheet).getByRole('button', { name: 'Mark as read' }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Marked as read.'))
    expect(await within(sheet).findByText(/by Rahim Uddin/)).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Archive' }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Submission archived.'))
    expect(await within(sheet).findByRole('button', { name: 'Unarchive' })).toBeInTheDocument()
    expect(patches).toEqual([{ status: 'read' }, { status: 'archived' }])

    await user.click(within(sheet).getByRole('button', { name: 'Delete' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete this submission?' })
    expect(confirm).toHaveTextContent('are removed for good')
    await user.click(within(confirm).getByRole('button', { name: 'Delete submission' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/content/forms'))
    expect(toastSuccess).toHaveBeenCalledWith('Submission deleted.')
    expect(deleted).toBe(true)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('No form submissions yet')).toBeInTheDocument()
  })

  it('is read-only with forms.view alone, and shows only its own Content tab', async () => {
    mockApi({
      'GET /auth/me': ok(viewer()),
      'GET /forms': ok(forms),
      'GET /forms/submissions': paged([submission()]),
      'GET /forms/submissions/fs-1': ok(submission()),
    })
    renderRoutes(routes, '/content/forms/fs-1')

    const sheet = await screen.findByRole('dialog', { name: 'Contact us' })
    await within(sheet).findByText('Do you deliver to Sylhet?')
    expect(within(sheet).queryByRole('button', { name: 'Mark as read' })).not.toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    // The open sheet hides the page from assistive tech, hence `hidden`.
    const tabs = screen.getByRole('navigation', { name: 'Content sections', hidden: true })
    expect(within(tabs).getAllByRole('link', { hidden: true }).map((l) => l.textContent)).toEqual(['Form submissions'])
  })

  it('hides the tab and refuses the page without forms.view', async () => {
    mockApi({ 'GET /auth/me': ok(makeCurrentUser({ permissions: ['cms.manage'] })), 'GET /cms/contact-messages': paged([], { open: 0 }) })
    const first = renderRoutes(routes, '/content/messages')
    const tabs = await screen.findByRole('navigation', { name: 'Content sections' })
    expect(within(tabs).queryByRole('link', { name: 'Form submissions' })).not.toBeInTheDocument()
    expect(within(tabs).getByRole('link', { name: 'Messages' })).toBeInTheDocument()
    first.unmount()

    renderRoutes(routes, '/content/forms')
    expect(await screen.findByText('Your role does not include the “forms.view” permission.')).toBeInTheDocument()
  })
})
