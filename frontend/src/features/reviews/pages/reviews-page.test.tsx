import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import type { Review } from '@/features/reviews/api'
import { review, reviewModerator, reviewViewer } from '@/features/reviews/test-data'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: toastError, success: toastSuccess, message: vi.fn() }) }
})

const paged = (items: unknown[], page = 1, lastPage = 1) => ok(items, { pagination: { current_page: page, per_page: 25, total: items.length, last_page: lastPage } })

beforeEach(() => {
  toastSuccess.mockReset()
  toastError.mockReset()
})

/** A tiny in-memory moderation API: lists filter by status, actions change the store. */
function moderationApi(initial: Review[], overrides: Record<string, Parameters<typeof mockApi>[0][string]> = {}) {
  let store = [...initial]
  const queries: URLSearchParams[] = []
  const bodies: Record<string, unknown> = {}
  const set = (id: string, patch: Partial<Review>) => {
    store = store.map((r) => (r.id === id ? { ...r, ...patch } : r))
    return ok(store.find((r) => r.id === id))
  }
  const routes: Parameters<typeof mockApi>[0] = {
    'GET /auth/me': ok(reviewModerator()),
    'GET /notifications/unread-count': ok({ count: 0 }),
    'GET /reviews': (_init, url) => {
      queries.push(url.searchParams)
      const q = url.searchParams
      const term = q.get('search')?.toLowerCase()
      return paged(
        store.filter(
          (r) =>
            (!q.get('status') || r.status === q.get('status')) &&
            (!q.get('rating') || r.rating === Number(q.get('rating'))) &&
            (!term || `${r.product.name} ${r.customer.name} ${r.body}`.toLowerCase().includes(term)),
        ),
      )
    },
  }
  for (const r of initial) {
    routes[`POST /reviews/${r.id}/approve`] = () => set(r.id, { status: 'approved', moderated_at: '2026-11-01T06:00:00Z', moderated_by_name: 'Rahim Uddin', rejection_reason: null })
    routes[`POST /reviews/${r.id}/reject`] = (init) => {
      const body = JSON.parse(String(init.body ?? '{}')) as { reason?: string }
      bodies[`reject ${r.id}`] = body
      return set(r.id, { status: 'rejected', moderated_at: '2026-11-01T06:00:00Z', moderated_by_name: 'Rahim Uddin', rejection_reason: body.reason ?? null })
    }
    routes[`DELETE /reviews/${r.id}`] = () => {
      store = store.filter((x) => x.id !== r.id)
      return { status: 204 }
    }
  }
  mockApi({ ...routes, ...overrides })
  return { queries, bodies, current: () => store }
}

const card = (name: RegExp | string) => screen.getByRole('listitem', { name })

describe('reviews moderation list', () => {
  it('opens on the pending queue and shows each review with a text alternative for its stars', async () => {
    const { queries } = moderationApi([
      review(),
      review({ id: 'rv-2', status: 'approved', rating: 5, title: null, body: 'Best juice in town, the kids love it.', customer: { id: 'c-2', name: 'Karim Ali', email: null }, moderated_at: '2026-10-31T08:00:00Z', moderated_by_name: 'Nadia' }),
    ])
    renderRoutes(routes, '/reviews')

    const item = await screen.findByRole('listitem', { name: 'Review of Pran Mango Juice 1L by Ayesha Rahman' })
    expect(screen.getByRole('link', { name: 'Reviews' })).toHaveAttribute('href', '/reviews')
    expect(screen.getByRole('tab', { name: 'Pending' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Pending', 'Approved', 'Rejected', 'All'])
    expect(queries[0]?.toString()).toBe('page=1&status=pending')
    expect(within(item).getByRole('img', { name: '4 out of 5 stars' })).toBeInTheDocument()
    expect(within(item).getByText('Tastes fresh')).toBeInTheDocument()
    expect(within(item).getByText('Arrived cold and well packed. Will buy again.')).toBeInTheDocument()
    expect(within(item).getByRole('link', { name: 'ayesha@example.com' })).toHaveAttribute('href', 'mailto:ayesha@example.com')
    expect(within(item).getByText('Pending')).toBeInTheDocument()
    expect(within(item).getByText('Verified purchase')).toBeInTheDocument()
    expect(within(within(item).getByRole('group', { name: 'Moderation actions' })).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Approve', 'Reject', 'Delete'])
    expect(screen.queryByText('Karim Ali')).not.toBeInTheDocument()
  })

  it('sends the status tab, rating and search as query parameters and keeps them in the address', async () => {
    const user = userEvent.setup()
    const { queries } = moderationApi([review({ status: 'approved', moderated_at: '2026-10-31T08:00:00Z', moderated_by_name: 'Nadia' })])
    const { router } = renderRoutes(routes, '/reviews')

    expect(await screen.findByText('No reviews waiting for moderation')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Approved' }))
    await waitFor(() => expect(queries.at(-1)?.get('status')).toBe('approved'))
    expect(router.state.location.search).toBe('?status=approved')
    const item = await screen.findByRole('listitem', { name: /Ayesha Rahman/ })
    expect(within(item).getByTestId('review-moderation')).toHaveTextContent(/^Approved by Nadia · /)
    expect(within(item).queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Filter by rating' }))
    await user.click(await screen.findByRole('option', { name: '1 star' }))
    await waitFor(() => expect(queries.at(-1)?.get('rating')).toBe('1'))

    await user.type(screen.getByLabelText('Search reviews'), ' mango ')
    await waitFor(() => expect(queries.at(-1)?.get('search')).toBe('mango'))
    expect(queries.at(-1)?.get('status')).toBe('approved')
    await waitFor(() => expect(router.state.location.search).toBe('?status=approved&rating=1&search=mango'))
    expect(await screen.findByText('No matching reviews')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'All' }))
    await waitFor(() => expect(queries.at(-1)?.has('status')).toBe(false))
    expect(queries.at(-1)?.get('rating')).toBe('1')
  })

  it('reads its filters and page from the address', async () => {
    const { queries } = moderationApi([])
    renderRoutes(routes, '/reviews?status=rejected&rating=2&search=late&page=3')

    expect(await screen.findByText('No matching reviews')).toBeInTheDocument()
    expect(Object.fromEntries(queries[0] ?? [])).toEqual({ page: '3', status: 'rejected', rating: '2', search: 'late' })
    expect(screen.getByRole('tab', { name: 'Rejected' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Search reviews')).toHaveValue('late')
  })

  it('pages through the list', async () => {
    const user = userEvent.setup()
    const queries: URLSearchParams[] = []
    mockApi({
      'GET /auth/me': ok(reviewViewer()),
      'GET /notifications/unread-count': ok({ count: 0 }),
      'GET /reviews': (_init, url) => {
        queries.push(url.searchParams)
        const page = Number(url.searchParams.get('page'))
        return paged([review({ id: `rv-${page}`, product: { id: 'p', name: `Product ${page}` } })], page, 2)
      },
    })
    renderRoutes(routes, '/reviews')

    expect(await screen.findByText('Product 1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(await screen.findByText('Product 2')).toBeInTheDocument()
    expect(queries.at(-1)?.get('page')).toBe('2')
  })

  it('approves a review and refetches the queue', async () => {
    const user = userEvent.setup()
    const api = moderationApi([review(), review({ id: 'rv-2', customer: { id: 'c-2', name: 'Karim Ali', email: null } })])
    renderRoutes(routes, '/reviews')

    const item = await screen.findByRole('listitem', { name: /Ayesha Rahman/ })
    const before = api.queries.length
    await user.click(within(item).getByRole('button', { name: 'Approve' }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Review approved. It is now shown in the store.'))
    await waitFor(() => expect(screen.queryByRole('listitem', { name: /Ayesha Rahman/ })).not.toBeInTheDocument())
    expect(api.queries.length).toBeGreaterThan(before)
    expect(card(/Karim Ali/)).toBeInTheDocument()
    expect(api.current().find((r) => r.id === 'rv-1')?.status).toBe('approved')
  })

  it('rejects with an optional reason', async () => {
    const user = userEvent.setup()
    const api = moderationApi([review(), review({ id: 'rv-2', customer: { id: 'c-2', name: 'Karim Ali', email: null } })])
    renderRoutes(routes, '/reviews')

    await user.click(within(await screen.findByRole('listitem', { name: /Ayesha Rahman/ })).getByRole('button', { name: 'Reject' }))
    let dialog = await screen.findByRole('dialog', { name: 'Reject this review?' })
    await user.type(within(dialog).getByLabelText('Reason (optional)'), '  Contains a phone number  ')
    await user.click(within(dialog).getByRole('button', { name: 'Reject review' }))

    await waitFor(() => expect(api.bodies['reject rv-1']).toEqual({ reason: 'Contains a phone number' }))
    expect(toastSuccess).toHaveBeenCalledWith('Review rejected.')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.queryByRole('listitem', { name: /Ayesha Rahman/ })).not.toBeInTheDocument())

    // Without a reason the body is empty.
    await user.click(within(card(/Karim Ali/)).getByRole('button', { name: 'Reject' }))
    dialog = await screen.findByRole('dialog', { name: 'Reject this review?' })
    await user.click(within(dialog).getByRole('button', { name: 'Reject review' }))
    await waitFor(() => expect(api.bodies['reject rv-2']).toEqual({}))

    await user.click(screen.getByRole('tab', { name: 'Rejected' }))
    const rejected = await screen.findByRole('listitem', { name: /Ayesha Rahman/ })
    expect(within(rejected).getByText('Contains a phone number')).toBeInTheDocument()
    expect(within(rejected).getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(within(rejected).queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument()
  })

  it('shows a rejection reason the server refuses on the dialog', async () => {
    const user = userEvent.setup()
    moderationApi([review()], { 'POST /reviews/rv-1/reject': fail(422, 'VALIDATION_FAILED', 'The given data was invalid.', { reason: ['The reason may not be greater than 200 characters.'] }) })
    renderRoutes(routes, '/reviews')

    await user.click(within(await screen.findByRole('listitem', { name: /Ayesha Rahman/ })).getByRole('button', { name: 'Reject' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reject this review?' })
    await user.type(within(dialog).getByLabelText('Reason (optional)'), 'x')
    await user.click(within(dialog).getByRole('button', { name: 'Reject review' }))
    expect(await within(dialog).findByText('The reason may not be greater than 200 characters.')).toBeInTheDocument()
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('deletes a review only after confirmation', async () => {
    const user = userEvent.setup()
    const api = moderationApi([review()])
    renderRoutes(routes, '/reviews')

    const item = await screen.findByRole('listitem', { name: /Ayesha Rahman/ })
    await user.click(within(item).getByRole('button', { name: 'Delete' }))
    let dialog = await screen.findByRole('alertdialog', { name: 'Delete this review?' })
    expect(dialog).toHaveTextContent("Ayesha Rahman's review of Pran Mango Juice 1L is removed for good.")
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(api.current()).toHaveLength(1)

    await user.click(within(screen.getByRole('listitem', { name: /Ayesha Rahman/ })).getByRole('button', { name: 'Delete' }))
    dialog = await screen.findByRole('alertdialog', { name: 'Delete this review?' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete review' }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Review deleted.'))
    expect(api.current()).toHaveLength(0)
    expect(await screen.findByText('No reviews waiting for moderation')).toBeInTheDocument()
  })

  it('explains a review that is already gone and refreshes', async () => {
    const user = userEvent.setup()
    moderationApi([review()], { 'POST /reviews/rv-1/approve': fail(404, 'NOT_FOUND', 'Not found.') })
    renderRoutes(routes, '/reviews')

    await user.click(within(await screen.findByRole('listitem', { name: /Ayesha Rahman/ })).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('This review no longer exists; the list was refreshed.'))
  })

  it('is read-only without reviews.moderate', async () => {
    mockApi({
      'GET /auth/me': ok(reviewViewer()),
      'GET /notifications/unread-count': ok({ count: 0 }),
      'GET /reviews': paged([review()]),
    })
    renderRoutes(routes, '/reviews')

    const item = await screen.findByRole('listitem', { name: /Ayesha Rahman/ })
    expect(screen.getByRole('link', { name: 'Reviews' })).toHaveAttribute('href', '/reviews')
    expect(screen.getByTestId('reviews-read-only')).toBeInTheDocument()
    expect(within(item).queryByRole('group', { name: 'Moderation actions' })).not.toBeInTheDocument()
    expect(within(item).queryByRole('button')).not.toBeInTheDocument()
  })

  it('is not in the sidebar without reviews.view', async () => {
    mockApi({
      'GET /auth/me': ok(makeOrderViewer()),
      'GET /notifications/unread-count': ok({ count: 0 }),
      'GET /web-orders': paged([]),
    })
    renderRoutes(routes, '/web-orders')
    expect(await screen.findByRole('link', { name: 'Web orders' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Reviews' })).not.toBeInTheDocument()
  })
})

function makeOrderViewer() {
  return { ...reviewViewer(), permissions: ['web_orders.view'] }
}
