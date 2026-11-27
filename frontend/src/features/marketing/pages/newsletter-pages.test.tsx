import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import type { NewsletterCampaign } from '@/features/content/api'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

/* BD2b §4: Marketing → Newsletter: campaign list with the subscriber summary, draft → preview → test → send. */

const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: toastError, success: toastSuccess, message: vi.fn() }) }
})

const BASE = '/newsletter/campaigns'
const SUMMARY = 'GET /newsletter/subscribers/summary'
const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })
const body = (init: RequestInit) => JSON.parse(String(init.body)) as Record<string, unknown>
const editor = () => makeCurrentUser({ permissions: ['cms.manage'] })
const campaign = (overrides: Partial<NewsletterCampaign> = {}): NewsletterCampaign => ({
  id: 'nc-1',
  subject: 'Eid offers',
  body: 'Hello **friends**',
  status: 'draft',
  recipients_count: 0,
  sent_count: 0,
  sent_at: null,
  created_at: '2026-11-20T10:00:00Z',
  updated_at: '2026-11-20T10:00:00Z',
  ...overrides,
})
const summary = ok({ confirmed: 5, pending: 2, unsubscribed: 1 })

beforeEach(() => {
  toastSuccess.mockReset()
  toastError.mockReset()
})

describe('newsletter campaigns list', () => {
  it('lists campaigns with status and sent count, and the subscriber summary', async () => {
    mockApi({
      'GET /auth/me': ok(editor()),
      [`GET ${BASE}`]: paged([campaign(), campaign({ id: 'nc-2', subject: 'November news', status: 'sent', recipients_count: 5, sent_count: 5, sent_at: '2026-11-21T09:00:00Z' })]),
      [SUMMARY]: summary,
    })
    renderRoutes(routes, '/marketing/newsletter')

    expect(await screen.findByRole('heading', { name: 'Newsletter campaigns' })).toBeInTheDocument()
    expect(await screen.findByTestId('subscriber-summary')).toHaveTextContent('5 confirmed · 2 awaiting confirmation · 1 unsubscribed')
    const sent = (await screen.findByRole('link', { name: 'November news' })).closest('tr') as HTMLElement
    expect(within(sent).getByText('Sent')).toBeInTheDocument()
    expect(within(sent).getByText('5 / 5')).toBeInTheDocument()
    const draft = screen.getByRole('link', { name: 'Eid offers' }).closest('tr') as HTMLElement
    expect(within(draft).getByText('Draft')).toBeInTheDocument()
    // Only the Newsletter tab: the user has cms.manage but not marketing.view.
    expect(screen.getByRole('link', { name: 'Newsletter' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Short links' })).not.toBeInTheDocument()
  })
})

describe('newsletter campaign editor', () => {
  it('writes a draft with a safe preview and opens it after saving', async () => {
    const user = userEvent.setup()
    const posts: Record<string, unknown>[] = []
    const text = '<script>alert(1)</script> **Big** sale'
    mockApi({
      'GET /auth/me': ok(editor()),
      [`POST ${BASE}`]: (init) => {
        posts.push(body(init))
        return ok(campaign({ body: text }))
      },
      [`GET ${BASE}/nc-1`]: ok(campaign({ body: text })),
      [SUMMARY]: summary,
    })
    renderRoutes(routes, '/marketing/newsletter/new')

    await user.click(await screen.findByRole('button', { name: 'Save draft' }))
    expect(await screen.findByText('Write a subject.')).toBeInTheDocument()
    expect(posts).toHaveLength(0)

    await user.type(screen.getByLabelText('Subject'), 'Eid offers')
    // userEvent treats "{" and "[" as key descriptors; the text has neither.
    await user.type(screen.getByLabelText('Message (markdown)'), text)
    const preview = screen.getByTestId('campaign-preview')
    // Raw HTML stays text; markdown bold becomes <strong>.
    expect(preview.querySelector('script')).toBeNull()
    expect(preview).toHaveTextContent('<script>alert(1)</script> Big sale')
    expect(within(preview).getByText('Big').tagName).toBe('STRONG')

    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(posts).toEqual([{ subject: 'Eid offers', body: text }]))
    expect(await screen.findByRole('button', { name: 'Send to 5 subscribers' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete draft' })).toBeInTheDocument()
  })

  it('sends a test, then sends to the subscribers after confirming and follows the progress', async () => {
    const user = userEvent.setup()
    const tests: Record<string, unknown>[] = []
    let sends = 0
    let current = campaign()
    mockApi({
      'GET /auth/me': ok(editor()),
      [`GET ${BASE}/nc-1`]: () => ok(current),
      [SUMMARY]: summary,
      [`POST ${BASE}/nc-1/test`]: (init) => {
        tests.push(body(init))
        return ok(null)
      },
      [`POST ${BASE}/nc-1/send`]: () => {
        sends++
        current = campaign({ status: 'sending', recipients_count: 5, sent_count: 2 })
        return ok(current)
      },
    })
    renderRoutes(routes, '/marketing/newsletter/nc-1')

    const testField = await screen.findByLabelText('Send a test to')
    await user.click(screen.getByRole('button', { name: 'Send test' }))
    expect(await screen.findByText('Enter an e-mail address.')).toBeInTheDocument()
    await user.type(testField, 'me@shop.test')
    await user.click(screen.getByRole('button', { name: 'Send test' }))
    await waitFor(() => expect(tests).toEqual([{ email: 'me@shop.test' }]))
    expect(toastSuccess).toHaveBeenCalledWith('Test e-mail sent to me@shop.test.')

    await user.click(screen.getByRole('button', { name: 'Send to 5 subscribers' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Send to 5 subscribers?')).toBeInTheDocument()
    expect(sends).toBe(0)
    await user.click(within(dialog).getByRole('button', { name: 'Send now' }))
    await waitFor(() => expect(sends).toBe(1))
    expect(await screen.findByTestId('campaign-progress')).toHaveTextContent('Sending… 2 of 5 subscribers so far.')
    // No longer a draft: no editing or sending again.
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Send to/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Subject')).toHaveAttribute('readonly')
  })

  it('shows the server refusal when the campaign was already sent', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(editor()),
      [`GET ${BASE}/nc-1`]: ok(campaign()),
      [SUMMARY]: summary,
      [`POST ${BASE}/nc-1/send`]: fail(409, 'CAMPAIGN_NOT_DRAFT', 'This campaign was already sent.'),
    })
    renderRoutes(routes, '/marketing/newsletter/nc-1')

    await user.click(await screen.findByRole('button', { name: 'Send to 5 subscribers' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Send now' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('This campaign was already sent.'))
  })

  it('cannot send without confirmed subscribers', async () => {
    mockApi({
      'GET /auth/me': ok(editor()),
      [`GET ${BASE}/nc-1`]: ok(campaign()),
      [SUMMARY]: ok({ confirmed: 0, pending: 1, unsubscribed: 0 }),
    })
    renderRoutes(routes, '/marketing/newsletter/nc-1')
    expect(await screen.findByText('No confirmed subscribers yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send to 0 subscribers' })).toBeDisabled()
  })
})
