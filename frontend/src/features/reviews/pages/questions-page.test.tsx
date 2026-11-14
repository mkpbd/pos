import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import type { ProductQuestion } from '@/features/reviews/questions-api'
import { question, reviewModerator, reviewViewer } from '@/features/reviews/test-data'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: toastError, success: toastSuccess, message: vi.fn() }) }
})

beforeEach(() => {
  toastSuccess.mockReset()
  toastError.mockReset()
})

type Handler = Parameters<typeof mockApi>[0][string]

/** An in-memory questions API: lists filter by status, product and search; actions change the store. */
function questionsApi(initial: ProductQuestion[], options: { me?: ReturnType<typeof makeCurrentUser>; overrides?: Record<string, Handler>; extra?: Record<string, Handler> } = {}) {
  let store = [...initial]
  const queries: URLSearchParams[] = []
  const bodies: Record<string, unknown> = {}
  const set = (id: string, patch: Partial<ProductQuestion>) => {
    store = store.map((q) => (q.id === id ? { ...q, ...patch } : q))
    return ok(store.find((q) => q.id === id))
  }
  const api: Record<string, Handler> = {
    'GET /auth/me': ok(options.me ?? reviewModerator()),
    'GET /notifications/unread-count': ok({ count: 0 }),
    'GET /reviews/questions': (_init, url) => {
      queries.push(url.searchParams)
      const q = url.searchParams
      const term = q.get('search')?.toLowerCase()
      const rows = store.filter(
        (row) =>
          (!q.get('status') || row.status === q.get('status')) &&
          (!q.get('product') || row.product.id === q.get('product')) &&
          (!term || `${row.product.name} ${row.name} ${row.email} ${row.question} ${row.answer ?? ''}`.toLowerCase().includes(term)),
      )
      return ok(rows, { pagination: { current_page: 1, per_page: 25, total: rows.length, last_page: 1 }, pending_count: store.filter((row) => row.status === 'pending').length })
    },
    ...options.extra,
  }
  for (const row of initial) {
    api[`POST /reviews/questions/${row.id}/answer`] = (init) => {
      const body = JSON.parse(String(init.body)) as { answer: string; publish: boolean }
      bodies[`answer ${row.id}`] = body
      return set(row.id, body.publish ? { answer: body.answer, status: 'published', answered_at: '2026-11-12T06:00:00Z', answered_by_name: 'Rahim Uddin' } : { answer: body.answer })
    }
    api[`POST /reviews/questions/${row.id}/reject`] = () => set(row.id, { status: 'rejected' })
    api[`DELETE /reviews/questions/${row.id}`] = () => {
      store = store.filter((q) => q.id !== row.id)
      return { status: 204 }
    }
  }
  mockApi({ ...api, ...options.overrides })
  return { queries, bodies, current: () => store }
}

const item = (name: RegExp | string) => screen.getByRole('listitem', { name })
const findItem = (name: RegExp | string) => screen.findByRole('listitem', { name })

const rina = () => question()
const karim = () => question({ id: 'q-2', name: 'Karim Ali', email: 'karim@example.com', question: 'আকার কত বড়?', locale: 'bn', product: { id: 'p-2', name: 'Baby Romper', slug: null } })

describe('product questions (P1b)', () => {
  it('opens on the questions to answer with the section tabs and a waiting count', async () => {
    const api = questionsApi([rina(), karim(), question({ id: 'q-3', name: 'Sumi', status: 'published', answer: 'Yes.', answered_at: '2026-11-11T06:00:00Z', answered_by_name: 'Nadia' })])
    renderRoutes(routes, '/reviews/questions?status=pending')

    const card = await findItem('Question about Pran Mango Juice 1L from Rina Akter')
    expect(api.queries[0]?.toString()).toBe('page=1&status=pending')
    expect(screen.getByRole('heading', { name: 'Questions' })).toBeInTheDocument()
    const sections = screen.getByRole('navigation', { name: 'Reviews and questions' })
    expect(within(sections).getByRole('link', { name: 'Questions' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['To answer2', 'Published', 'Rejected', 'All'])
    expect(screen.getByRole('tab', { name: 'To answer (2 waiting)' })).toHaveAttribute('aria-selected', 'true')

    expect(within(card).getByText('Is it made with real mangoes?')).toBeInTheDocument()
    expect(within(card).getByText('New question')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'rina@example.com' })).toHaveAttribute('href', 'mailto:rina@example.com')
    expect(within(card).getByRole('link', { name: /View in store/ })).toHaveAttribute('href', '/product/pran-mango-juice-1l')
    expect(within(within(card).getByRole('group', { name: 'Question actions' })).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Answer', 'Reject', 'Delete'])

    // Karim asked on the Bangla store; his product has no web address yet.
    const bangla = item(/from Karim Ali$/)
    expect(within(bangla).getByText(/Asked in/)).toBeInTheDocument()
    expect(within(bangla).getByTestId('question-text')).toHaveAttribute('lang', 'bn')
    expect(within(bangla).queryByRole('link', { name: /View in store/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Sumi')).not.toBeInTheDocument()
  })

  it('answers and publishes a question, then shows it under Published', async () => {
    const user = userEvent.setup()
    const api = questionsApi([rina(), karim()])
    renderRoutes(routes, '/reviews/questions')

    await user.click(within(await findItem(/from Rina Akter$/)).getByRole('button', { name: 'Answer' }))
    const form = screen.getByRole('form', { name: 'Answer to Rina Akter' })
    const box = within(form).getByLabelText('Your answer')
    expect(box).toHaveFocus()
    // An empty answer is not sent.
    await user.click(within(form).getByRole('button', { name: 'Publish answer' }))
    expect(within(form).getByText('Write an answer first.')).toBeInTheDocument()
    expect(api.bodies['answer q-1']).toBeUndefined()

    await user.type(box, '  Yes — 100% Rajshahi mangoes, no added colour.  ')
    expect(within(form).getByText(/\/2000 · Shown under the question on the product page once published\. Rina Akter gets an e-mail then\./)).toBeInTheDocument()
    await user.click(within(form).getByRole('button', { name: 'Publish answer' }))

    await waitFor(() => expect(api.bodies['answer q-1']).toEqual({ answer: 'Yes — 100% Rajshahi mangoes, no added colour.', publish: true }))
    expect(toastSuccess).toHaveBeenCalledWith('Answer published. It is now shown on the product page.')
    await waitFor(() => expect(screen.queryByRole('listitem', { name: /from Rina Akter$/ })).not.toBeInTheDocument())
    expect(screen.getByTestId('pending-count')).toHaveTextContent('1')

    await user.click(screen.getByRole('tab', { name: 'Published' }))
    const published = await findItem(/from Rina Akter$/)
    expect(within(published).getByText('Published')).toBeInTheDocument()
    expect(within(published).getByTestId('question-answer')).toHaveTextContent('Answer on the product page')
    expect(within(published).getByTestId('question-answer')).toHaveTextContent(/Answered by Rahim Uddin · /)
    expect(within(within(published).getByRole('group', { name: 'Question actions' })).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Edit answer', 'Unpublish', 'Delete'])

    // Editing a published answer keeps it published (no "save without publishing").
    await user.click(within(published).getByRole('button', { name: 'Edit answer' }))
    const edit = screen.getByRole('form', { name: 'Answer to Rina Akter' })
    expect(within(edit).queryByRole('button', { name: 'Save without publishing' })).not.toBeInTheDocument()
    await user.type(within(edit).getByLabelText('Your answer'), ' Best served cold.')
    await user.click(within(edit).getByRole('button', { name: 'Save answer' }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Answer updated on the product page.'))
    expect(api.current()[0]?.answer).toBe('Yes — 100% Rajshahi mangoes, no added colour. Best served cold.')
  })

  it('saves an answer without publishing, then publishes it with one click', async () => {
    const user = userEvent.setup()
    const api = questionsApi([rina()])
    renderRoutes(routes, '/reviews/questions')

    await user.click(within(await findItem(/from Rina Akter$/)).getByRole('button', { name: 'Answer' }))
    const form = screen.getByRole('form', { name: 'Answer to Rina Akter' })
    await user.type(within(form).getByLabelText('Your answer'), 'Checking with the supplier.')
    await user.click(within(form).getByRole('button', { name: 'Save without publishing' }))

    await waitFor(() => expect(api.bodies['answer q-1']).toEqual({ answer: 'Checking with the supplier.', publish: false }))
    expect(toastSuccess).toHaveBeenCalledWith('Answer saved. It is not shown in the store until you publish it.')
    const card = await findItem(/from Rina Akter$/)
    await waitFor(() => expect(within(card).getByText('Answer not published')).toBeInTheDocument())
    expect(within(card).getByTestId('question-answer')).toHaveTextContent('Saved answer — not shown in the store')

    await user.click(within(card).getByRole('button', { name: 'Publish answer' }))
    await waitFor(() => expect(api.bodies['answer q-1']).toEqual({ answer: 'Checking with the supplier.', publish: true }))
    expect(toastSuccess).toHaveBeenCalledWith('Answer published. It is now shown on the product page.')
  })

  it('shows an answer the server refuses on the form', async () => {
    const user = userEvent.setup()
    questionsApi([rina()], { overrides: { 'POST /reviews/questions/q-1/answer': fail(422, 'VALIDATION_FAILED', 'The given data was invalid.', { answer: ['The answer may not be greater than 2000 characters.'] }) } })
    renderRoutes(routes, '/reviews/questions')

    await user.click(within(await findItem(/from Rina Akter$/)).getByRole('button', { name: 'Answer' }))
    const form = screen.getByRole('form', { name: 'Answer to Rina Akter' })
    await user.type(within(form).getByLabelText('Your answer'), 'x')
    await user.click(within(form).getByRole('button', { name: 'Publish answer' }))
    expect(await within(form).findByText('The answer may not be greater than 2000 characters.')).toBeInTheDocument()
    expect(within(form).getByLabelText('Your answer')).toHaveAttribute('aria-invalid', 'true')
    expect(toastSuccess).not.toHaveBeenCalled()

    await user.click(within(form).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: 'Answer to Rina Akter' })).not.toBeInTheDocument()
  })

  it('rejects a question and deletes one only after confirmation', async () => {
    const user = userEvent.setup()
    const api = questionsApi([rina(), karim()])
    renderRoutes(routes, '/reviews/questions')

    await user.click(within(await findItem(/from Rina Akter$/)).getByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Question rejected. It is not shown in the store.'))
    expect(api.current().find((q) => q.id === 'q-1')?.status).toBe('rejected')
    await waitFor(() => expect(screen.queryByRole('listitem', { name: /from Rina Akter$/ })).not.toBeInTheDocument())

    await user.click(within(item(/from Karim Ali$/)).getByRole('button', { name: 'Delete' }))
    let dialog = await screen.findByRole('alertdialog', { name: 'Delete this question?' })
    expect(dialog).toHaveTextContent('Karim Ali’s question about Baby Romper is removed for good, together with its answer.')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(api.current()).toHaveLength(2)

    await user.click(within(item(/from Karim Ali$/)).getByRole('button', { name: 'Delete' }))
    dialog = await screen.findByRole('alertdialog', { name: 'Delete this question?' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete question' }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Question deleted.'))
    expect(api.current().map((q) => q.id)).toEqual(['q-1'])
    expect(await screen.findByText('No questions waiting for an answer')).toBeInTheDocument()

    // A rejected question can still be answered (and so published) or deleted, not rejected again.
    await user.click(screen.getByRole('tab', { name: 'Rejected' }))
    const rejected = await findItem(/from Rina Akter$/)
    expect(within(within(rejected).getByRole('group', { name: 'Question actions' })).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Answer', 'Delete'])
  })

  it('unpublishes a published question', async () => {
    const user = userEvent.setup()
    const api = questionsApi([question({ status: 'published', answer: 'Yes.', answered_at: '2026-11-11T06:00:00Z', answered_by_name: 'Nadia' })])
    renderRoutes(routes, '/reviews/questions?status=published')

    await user.click(within(await findItem(/from Rina Akter$/)).getByRole('button', { name: 'Unpublish' }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Question unpublished. It is no longer shown in the store.'))
    expect(api.current()[0]?.status).toBe('rejected')
  })

  it('filters by search, product and status and keeps the filters in the address', async () => {
    const user = userEvent.setup()
    const api = questionsApi([rina(), karim(), question({ id: 'q-3', name: 'Sumi', question: 'Sugar free?' })], {
      me: makeCurrentUser({ permissions: ['reviews.view', 'reviews.moderate', 'products.view'] }),
      extra: {
        'GET /products': ok([{ id: 'p-2', name: 'Baby Romper', variants: [{ sku: 'BR-1' }], images: [], is_active: true }], { pagination: { current_page: 1, per_page: 25, total: 1, last_page: 1 } }),
      },
    })
    const { router } = renderRoutes(routes, '/reviews/questions')

    await findItem(/from Rina Akter$/)
    await user.type(screen.getByLabelText('Search questions'), ' mangoes ')
    await waitFor(() => expect(api.queries.at(-1)?.get('search')).toBe('mangoes'))
    await waitFor(() => expect(router.state.location.search).toBe('?search=mangoes'))
    await waitFor(() => expect(screen.getAllByRole('listitem', { name: /^Question about/ })).toHaveLength(1))
    await user.clear(screen.getByLabelText('Search questions'))
    await waitFor(() => expect(router.state.location.search).toBe(''))

    // "Only this product" on a card.
    await user.click(await screen.findByRole('button', { name: 'Show only questions about Baby Romper' }))
    await waitFor(() => expect(api.queries.at(-1)?.get('product')).toBe('p-2'))
    expect(router.state.location.search).toBe('?product=p-2')
    expect(screen.getByTestId('product-filter')).toHaveTextContent('Product: Baby Romper')
    await waitFor(() => expect(screen.getAllByRole('listitem', { name: /^Question about/ })).toHaveLength(1))
    expect(screen.queryByRole('button', { name: /Show only questions about/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show questions about all products' }))
    await waitFor(() => expect(api.queries.at(-1)?.has('product')).toBe(false))

    // The product search (products.view).
    await user.click(screen.getByRole('button', { name: 'Filter by product: All products' }))
    await user.click(await screen.findByRole('option', { name: /Baby Romper/ }))
    await waitFor(() => expect(router.state.location.search).toBe('?product=p-2'))

    await user.click(screen.getByRole('tab', { name: 'All' }))
    await waitFor(() => expect(api.queries.at(-1)?.has('status')).toBe(false))
    expect(api.queries.at(-1)?.get('product')).toBe('p-2')
    expect(router.state.location.search).toBe('?status=all&product=p-2')
  })

  it('reads its filters from the address and explains empty results', async () => {
    const { queries } = questionsApi([])
    renderRoutes(routes, '/reviews/questions?status=rejected&search=late&product=p-7&page=2')

    expect(await screen.findByText('No matching questions')).toBeInTheDocument()
    expect(Object.fromEntries(queries[0] ?? [])).toEqual({ page: '2', status: 'rejected', product: 'p-7', search: 'late' })
    expect(screen.getByRole('tab', { name: 'Rejected' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Search questions')).toHaveValue('late')
    expect(screen.getByTestId('product-filter')).toHaveTextContent('Product: the chosen product')
  })

  it('explains a question that is already gone', async () => {
    const user = userEvent.setup()
    questionsApi([question({ answer: 'Draft.' })], { overrides: { 'POST /reviews/questions/q-1/answer': fail(404, 'NOT_FOUND', 'Not found.') } })
    renderRoutes(routes, '/reviews/questions')

    await user.click(within(await findItem(/from Rina Akter$/)).getByRole('button', { name: 'Publish answer' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('This question no longer exists; the list was refreshed.'))
  })

  it('is read-only with reviews.view and has no product search without products.view', async () => {
    questionsApi([rina()], { me: reviewViewer() })
    renderRoutes(routes, '/reviews/questions')

    const card = await findItem(/from Rina Akter$/)
    expect(screen.getByTestId('questions-read-only')).toBeInTheDocument()
    expect(within(card).queryByRole('group', { name: 'Question actions' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Filter by product/ })).not.toBeInTheDocument()
    // Narrowing to a product from a card still works.
    expect(within(card).getByRole('button', { name: 'Show only questions about Pran Mango Juice 1L' })).toBeInTheDocument()
  })

  it('is not reachable without reviews.view', async () => {
    mockApi({
      'GET /auth/me': ok(makeCurrentUser({ permissions: ['web_orders.view'] })),
      'GET /notifications/unread-count': ok({ count: 0 }),
    })
    renderRoutes(routes, '/reviews/questions')
    expect(await screen.findByText(/does not include the “reviews\.view” permission/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Questions' })).not.toBeInTheDocument()
  })
})
