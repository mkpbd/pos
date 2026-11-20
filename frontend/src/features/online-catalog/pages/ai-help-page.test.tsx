import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

/*
 * AI2a Online store → AI help: the tab (only with AI on), Drafts (write drafts → progress → review
 * drawer with edit / approve / stale "Approve anyway" / reject, bulk approve), Categories (suggest,
 * confidence words, apply, permission note, empty) and Bundle ideas (empty before the nightly run,
 * describe with Bangla, add to frequently bought together). Products list "Write AI drafts".
 */

const toastSuccess = vi.hoisted(() => vi.fn())
const toastMessage = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, success: toastSuccess, error: vi.fn(), message: toastMessage }) }
})
beforeEach(() => {
  toastSuccess.mockReset()
  toastMessage.mockReset()
})

const MANAGER = ['storefront.view', 'online_catalog.view', 'online_catalog.manage', 'products.view', 'products.manage']
const user = (permissions = MANAGER, ai_enabled = true) => makeCurrentUser({ permissions, ai_enabled })
const page = (total: number) => ({ pagination: { current_page: 1, per_page: 20, total, last_page: 1 } })

const batch = (over: Record<string, unknown> = {}) => ({
  id: 'b-1', subject: 'product', criteria: { missing: ['description'], ids: null }, fields: ['description'], languages: ['en'], tone: 'friendly', length: 'medium', notes: null,
  total: 4, done: 1, failed: 0, status: 'running', progress_percent: 25, drafts: { pending: 1, approved: 0, rejected: 0, failed: 0, stale: 0 }, created_by: 'u-1', created_at: '2026-11-20T10:00:00Z', updated_at: '2026-11-20T10:00:00Z',
  ...over,
})

const draft = (over: Record<string, unknown> = {}) => ({
  id: 'd-1', batch_id: 'b-1', subject: 'product', subject_id: 'p-1', subject_name: 'Cotton Panjabi', language: 'en', status: 'pending', error: null, stale: false,
  fields: {
    short_description: { proposed: 'A soft cotton panjabi for Eid.', current: null, changed: false },
    seo_title: { proposed: 'Cotton Panjabi for Eid', current: 'Panjabi', changed: false },
  },
  missing_info: ['material'], reviewed_by: null, reviewed_at: null, created_at: '2026-11-20T10:00:00Z',
  ...over,
})

const baseDrafts = (drafts: unknown[] = [], batches: unknown[] = []) => ({
  'GET /online-catalog/ai/batches': ok(batches, page(batches.length)),
  'GET /online-catalog/ai/drafts': ok(drafts, page(drafts.length)),
})

const bodyOf = (fetchMock: ReturnType<typeof mockApi>, method: string, path: string) =>
  fetchMock.mock.calls
    .filter(([url, init]) => String(url).includes(path) && (init?.method ?? 'GET') === method)
    .map(([, init]) => JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)

describe('AI help page and tab', () => {
  it('shows the AI help tab only while AI is on', async () => {
    mockApi({ 'GET /auth/me': ok(user()), ...baseDrafts() })
    renderRoutes(routes, '/storefront/ai')
    expect(await screen.findByRole('link', { name: 'AI help' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('tab', { name: 'Drafts' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Categories' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Bundle ideas' })).toBeInTheDocument()
  })

  it('explains that AI is off and hides the tab', async () => {
    mockApi({ 'GET /auth/me': ok(user(MANAGER, false)) })
    renderRoutes(routes, '/storefront/ai')
    expect(await screen.findByText('AI help is turned off')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'AI help' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Drafts' })).not.toBeInTheDocument()
  })

  it('opens from the contract address /online-store/ai on the asked tab', async () => {
    mockApi({ 'GET /auth/me': ok(user()), 'GET /online-catalog/bundle-ideas': ok([], { ...page(0), last_run: null }) })
    const { router } = renderRoutes(routes, '/online-store/ai?tab=bundles')
    expect(await screen.findByText('No bundle ideas yet')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/storefront/ai')
  })
})

describe('Drafts tab', () => {
  it('writes drafts for items with missing texts and shows the run’s progress', async () => {
    const fetchMock = mockApi({
      'GET /auth/me': ok(user()),
      ...baseDrafts(),
      'POST /online-catalog/ai/batches': { status: 201, body: { success: true, data: batch({ status: 'queued', done: 0, progress_percent: 0 }), meta: { request_id: 't' } } },
      'GET /online-catalog/ai/batches/b-1': ok(batch({ status: 'done', done: 3, failed: 1, progress_percent: 100 })),
    })
    const u = userEvent.setup()
    renderRoutes(routes, '/storefront/ai')
    const form = await screen.findByRole('form', { name: 'Write drafts' })
    await u.click(within(form).getByLabelText('No search engine title or description'))
    await u.click(within(form).getByLabelText('Short description'))
    await u.type(within(form).getByLabelText(/Notes for the AI/), 'Pure cotton')
    await u.click(within(form).getByRole('button', { name: 'Write drafts' }))

    const progress = await screen.findByTestId('batch-progress')
    expect(await within(progress).findByText(/Finished\. 4 of 4 products done · 1 could not be written/)).toBeInTheDocument()
    expect(within(progress).getByRole('progressbar', { name: 'Drafts written' })).toHaveAttribute('aria-valuenow', '100')
    expect(bodyOf(fetchMock, 'POST', '/online-catalog/ai/batches')[0]).toEqual({
      subject: 'product', missing: ['description', 'seo'], fields: ['description', 'seo_title', 'seo_description'], languages: ['en'], tone: 'friendly', length: 'medium', notes: 'Pure cotton',
    })
    expect(toastSuccess).toHaveBeenCalledWith('Writing drafts for 4 products.')
  })

  it('asks for Bangla when filling missing Bangla texts in English only', async () => {
    mockApi({ 'GET /auth/me': ok(user()), ...baseDrafts() })
    const u = userEvent.setup()
    renderRoutes(routes, '/storefront/ai')
    const form = await screen.findByRole('form', { name: 'Write drafts' })
    await u.click(within(form).getByLabelText('No Bangla texts'))
    expect(within(form).getByText('To fill missing Bangla texts, choose Bangla or Both as the language.')).toBeInTheDocument()
    expect(within(form).getByRole('button', { name: 'Write drafts' })).toBeDisabled()
  })

  it('offers the running batch when another run is refused, and cancels it', async () => {
    let cancelled = false
    const fetchMock = mockApi({
      'GET /auth/me': ok(user()),
      ...baseDrafts(),
      'POST /online-catalog/ai/batches': fail(409, 'BATCH_RUNNING', 'Running', { batch_id: 'b-9' }),
      'GET /online-catalog/ai/batches/b-9': () => ok(batch({ id: 'b-9', status: cancelled ? 'cancelled' : 'running' })),
      'POST /online-catalog/ai/batches/b-9/cancel': () => {
        cancelled = true
        return ok(batch({ id: 'b-9', status: 'cancelled' }))
      },
    })
    const u = userEvent.setup()
    renderRoutes(routes, '/storefront/ai')
    const form = await screen.findByRole('form', { name: 'Write drafts' })
    await u.click(within(form).getByRole('button', { name: 'Write drafts' }))
    expect(await within(form).findByText('Drafts are already being written')).toBeInTheDocument()
    await u.click(within(form).getByRole('button', { name: 'See the running batch' }))
    const progress = await screen.findByTestId('batch-progress')
    expect(within(progress).getByText(/Writing drafts… 1 of 4 products done/)).toBeInTheDocument()
    await u.click(within(progress).getByRole('button', { name: 'Cancel run' }))
    expect(await within(progress).findByText(/Cancelled\./)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/online-catalog/ai/batches/b-9/cancel') && init?.method === 'POST')).toBe(true)
  })

  it('shows a run already going on and explains a budget stop', async () => {
    mockApi({
      'GET /auth/me': ok(user()),
      ...baseDrafts([], [batch({ id: 'b-5', status: 'running' })]),
      'GET /online-catalog/ai/batches/b-5': ok(batch({ id: 'b-5', status: 'budget_stopped', done: 2, progress_percent: 50 })),
    })
    renderRoutes(routes, '/storefront/ai')
    expect(await screen.findByText(/your shop reached this month’s AI budget/)).toBeInTheDocument()
  })

  it('reviews a draft side by side, edits a text and approves only the chosen texts', async () => {
    const fetchMock = mockApi({
      'GET /auth/me': ok(user()),
      ...baseDrafts([draft()]),
      'POST /online-catalog/ai/drafts/d-1/approve': ok(draft({ status: 'approved' })),
    })
    const u = userEvent.setup()
    renderRoutes(routes, '/storefront/ai')
    await u.click(await screen.findByRole('button', { name: 'Review Cotton Panjabi (English)' }))
    const sheet = await screen.findByRole('dialog', { name: 'Cotton Panjabi' })
    const seo = within(sheet).getByTestId('review-field-seo_title')
    expect(within(seo).getByRole('group', { name: 'Now' })).toHaveTextContent('Panjabi')
    const title = within(seo).getByLabelText('Written by AI')
    await u.clear(title)
    await u.type(title, 'Eid Cotton Panjabi')
    expect(within(seo).getByText('18 / 70 characters')).toBeInTheDocument()
    await u.click(within(sheet).getByLabelText('Use the new short description'))
    expect(within(sheet).getByText('material')).toBeInTheDocument()
    await u.click(within(sheet).getByRole('button', { name: 'Approve 1 text' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(bodyOf(fetchMock, 'POST', '/drafts/d-1/approve')[0]).toEqual({ fields: { seo_title: 'Eid Cotton Panjabi' } })
    expect(toastSuccess).toHaveBeenCalledWith('1 text saved to Cotton Panjabi.')
  })

  it('warns when the listing changed and approves anyway with force', async () => {
    let calls = 0
    const fetchMock = mockApi({
      'GET /auth/me': ok(user()),
      ...baseDrafts([draft({ language: 'bn', fields: { seo_title: { proposed: 'সুতি পাঞ্জাবি', current: 'Panjabi', changed: true } } })]),
      'POST /online-catalog/ai/drafts/d-1/approve': () => (++calls === 1 ? fail(409, 'DRAFT_STALE', 'Stale', { fields: ['seo_title'] }) : ok(draft({ status: 'approved' }))),
    })
    const u = userEvent.setup()
    renderRoutes(routes, '/storefront/ai')
    await u.click(await screen.findByRole('button', { name: 'Review Cotton Panjabi (Bangla)' }))
    const sheet = await screen.findByRole('dialog', { name: 'Cotton Panjabi' })
    expect(within(sheet).getByLabelText(/Written by AI/)).toHaveAttribute('lang', 'bn')
    expect(within(sheet).getByText('Now (changed since the draft)')).toBeInTheDocument()
    await u.click(within(sheet).getByRole('button', { name: 'Approve' }))
    expect(await within(sheet).findByText('This text changed since the draft was written')).toBeInTheDocument()
    await u.click(within(sheet).getByRole('button', { name: 'Approve anyway' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(bodyOf(fetchMock, 'POST', '/drafts/d-1/approve')).toEqual([{ fields: { seo_title: 'সুতি পাঞ্জাবি' } }, { fields: { seo_title: 'সুতি পাঞ্জাবি' }, force: true }])
  })

  it('edits a product description with the rich text editor and rejects a draft', async () => {
    const fetchMock = mockApi({
      'GET /auth/me': ok(user()),
      ...baseDrafts([draft({ fields: { description: { proposed: '<p>Soft cotton.</p><ul><li>Machine wash</li></ul>', current: '<p>Old text</p><ul><li>Hand wash</li></ul>', changed: false } } })]),
      'POST /online-catalog/ai/drafts/d-1/reject': ok(draft({ status: 'rejected' })),
    })
    const u = userEvent.setup()
    renderRoutes(routes, '/storefront/ai')
    await u.click(await screen.findByRole('button', { name: 'Review Cotton Panjabi (English)' }))
    const sheet = await screen.findByRole('dialog', { name: 'Cotton Panjabi' })
    const field = within(sheet).getByTestId('review-field-description')
    expect(within(field).getByRole('group', { name: 'Now' }).textContent).toBe('Old text\n\n- Hand wash')
    expect(await within(field).findByText('Machine wash')).toBeInTheDocument()
    await u.click(within(sheet).getByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/drafts/d-1/reject') && init?.method === 'POST')).toBe(true)
  })

  it('approves several drafts at once and reports the ones left out', async () => {
    const fetchMock = mockApi({
      'GET /auth/me': ok(user()),
      ...baseDrafts([draft(), draft({ id: 'd-2', subject: 'brand', subject_name: 'Aarong' })]),
      'POST /online-catalog/ai/drafts/approve-many': ok({ approved: 1, skipped: [{ id: 'd-2', reason: 'stale' }] }),
    })
    const u = userEvent.setup()
    renderRoutes(routes, '/storefront/ai')
    await u.click(await screen.findByRole('checkbox', { name: 'Select all drafts waiting for review on this page' }))
    await u.click(screen.getByRole('button', { name: 'Approve selected' }))
    await u.click(await screen.findByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('1 draft approved and saved to the listings.'))
    expect(toastMessage).toHaveBeenCalledWith('1 draft was left out', { description: 'Aarong: its listing changed since the draft was written — open it to approve anyway.' })
    expect(bodyOf(fetchMock, 'POST', '/drafts/approve-many')[0]).toEqual({ ids: ['d-1', 'd-2'] })
  })

  it('lets viewers read drafts but not write or approve', async () => {
    mockApi({ 'GET /auth/me': ok(user(['storefront.view', 'online_catalog.view'])), ...baseDrafts([draft()]) })
    renderRoutes(routes, '/storefront/ai')
    await screen.findByRole('button', { name: 'View Cotton Panjabi (English)' })
    expect(screen.queryByRole('form', { name: 'Write drafts' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })
})

describe('Categories tab', () => {
  const suggestions = {
    suggestions: [
      { product: { id: 'p-1', name: 'Cotton Panjabi' }, category: { id: 'c-1', path: 'Men › Panjabi' }, confidence: 'high', reason: 'The name says panjabi.' },
      { product: { id: 'p-2', name: 'Silk Saree' }, category: { id: 'c-2', path: 'Women › Saree' }, confidence: 'medium', reason: 'Probably a saree.' },
      { product: { id: 'p-3', name: 'Gift card' }, category: null, confidence: 'low', reason: 'No category fits.' },
    ],
    categories_considered: 14,
  }

  it('suggests categories with confidence in words and applies them', async () => {
    const fetchMock = mockApi({
      'GET /auth/me': ok(user()),
      ...baseDrafts(),
      'POST /online-catalog/ai/category-suggestions': ok(suggestions),
      'POST /online-catalog/ai/category-suggestions/apply': (init) => {
        const items = (JSON.parse(String(init.body)) as { items: { product_id: string }[] }).items
        return ok({ applied: items.map((i) => i.product_id), skipped: [] })
      },
    })
    const u = userEvent.setup()
    renderRoutes(routes, '/storefront/ai?tab=categories')
    await u.click(await screen.findByRole('button', { name: 'Suggest categories' }))
    const table = await screen.findByRole('table', { name: 'Category suggestions' })
    expect(screen.getByText(/checked against 14 categories/)).toBeInTheDocument()
    const high = within(table).getByTestId('suggestion-p-1')
    expect(within(high).getByTestId('confidence')).toHaveTextContent('High confidence: A clear match')
    const none = within(table).getByTestId('suggestion-p-3')
    expect(within(none).getByText('No good match')).toBeInTheDocument()
    expect(within(none).queryByRole('button', { name: /Apply/ })).not.toBeInTheDocument()

    await u.click(within(table).getByRole('button', { name: 'Apply Women › Saree to Silk Saree' }))
    expect(await within(table).findByText('Applied')).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Apply all high-confidence (1)' }))
    await waitFor(() => expect(within(table).getAllByText('Applied')).toHaveLength(2))
    expect(bodyOf(fetchMock, 'POST', '/category-suggestions')[0]).toEqual({})
    expect(bodyOf(fetchMock, 'POST', '/category-suggestions/apply')).toEqual([{ items: [{ product_id: 'p-2', category_id: 'c-2' }] }, { items: [{ product_id: 'p-1', category_id: 'c-1' }] }])
    expect(toastSuccess).toHaveBeenCalledWith('Category set for 1 product.')
  })

  it('needs product editing to apply, and says so', async () => {
    mockApi({ 'GET /auth/me': ok(user(['storefront.view', 'online_catalog.view', 'online_catalog.manage'])), ...baseDrafts(), 'POST /online-catalog/ai/category-suggestions': ok(suggestions) })
    const u = userEvent.setup()
    renderRoutes(routes, '/storefront/ai?tab=categories')
    await u.click(await screen.findByRole('button', { name: 'Suggest categories' }))
    expect(await screen.findByText('Ask someone who can edit products to apply these.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Apply/ })).not.toBeInTheDocument()
  })

  it('shows when every product has a category, and AI errors in plain words', async () => {
    let calls = 0
    mockApi({
      'GET /auth/me': ok(user()),
      ...baseDrafts(),
      'POST /online-catalog/ai/category-suggestions': () => (++calls === 1 ? ok({ suggestions: [], categories_considered: 0 }) : fail(422, 'AI_UNAVAILABLE', 'Off', { reason: 'budget_exceeded' })),
    })
    const u = userEvent.setup()
    renderRoutes(routes, '/storefront/ai?tab=categories')
    await u.click(await screen.findByRole('button', { name: 'Suggest categories' }))
    expect(await screen.findByText('Every active product has a category.')).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Suggest categories' }))
    expect(await screen.findByText('AI allowance used up')).toBeInTheDocument()
  })
})

describe('Bundle ideas tab', () => {
  const idea = {
    anchor: { id: 'a-1', name: 'Darjeeling Tea', image_url: null },
    frequently_bought_count: 1,
    products: [
      { id: 'b-1', name: 'Butter Biscuits', image_url: null, score: '0.42', orders_together: 9 },
      { id: 'b-2', name: 'Honey Jar', image_url: null, score: '0.20', orders_together: 1 },
    ],
  }

  it('explains when the nightly run has not produced ideas yet', async () => {
    mockApi({ 'GET /auth/me': ok(user()), ...baseDrafts(), 'GET /online-catalog/bundle-ideas': ok([], { ...page(0), last_run: null, computed_at: null }) })
    renderRoutes(routes, '/storefront/ai?tab=bundles')
    expect(await screen.findByText('No bundle ideas yet')).toBeInTheDocument()
  })

  it('describes a bundle with AI and adds the chosen products to frequently bought together', async () => {
    const fetchMock = mockApi({
      'GET /auth/me': ok(user()),
      ...baseDrafts(),
      'GET /online-catalog/bundle-ideas': ok([idea], { ...page(1), last_run: '2026-11-19', computed_at: '2026-11-19T20:00:00Z' }),
      'POST /online-catalog/bundle-ideas/describe': ok({ title: 'Tea time set', pitch: 'Tea and biscuits, better together.', translations: { bn: { title: 'চায়ের সেট', pitch: 'চা আর বিস্কুট একসাথে।' } } }),
      'POST /online-catalog/bundle-ideas/apply': ok({ anchor_id: 'a-1', added: ['b-1'], frequently_bought: [{ id: 'x' }, { id: 'b-1' }] }),
    })
    const u = userEvent.setup()
    renderRoutes(routes, '/storefront/ai?tab=bundles')
    const card = await screen.findByTestId('bundle-a-1')
    expect(screen.getByText(/Based on orders up to 19 Nov 2026/)).toBeInTheDocument()
    expect(within(card).getByText('Bought together in 9 orders')).toBeInTheDocument()
    expect(within(card).getByText('Bought together in 1 order')).toBeInTheDocument()
    await u.click(within(card).getByLabelText(/Honey Jar/))

    await u.click(within(card).getByRole('button', { name: 'Describe with AI' }))
    const text = await within(card).findByTestId('bundle-text')
    expect(within(text).getByText('Tea time set')).toBeInTheDocument()
    expect(within(text).getByText('চায়ের সেট')).toBeInTheDocument()
    expect(within(text).getByRole('button', { name: 'Copy the Bangla title and pitch' })).toBeInTheDocument()

    await u.click(within(card).getByRole('button', { name: 'Add to frequently bought together' }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Added 1 product to “Frequently bought together” for Darjeeling Tea.'))
    expect(bodyOf(fetchMock, 'POST', '/bundle-ideas/describe')[0]).toEqual({ anchor_id: 'a-1', product_ids: ['b-1'] })
    expect(bodyOf(fetchMock, 'POST', '/bundle-ideas/apply')[0]).toEqual({ anchor_id: 'a-1', product_ids: ['b-1'] })
  })
})

describe('Products list → Write AI drafts', () => {
  const product = (id: string, name: string) => ({
    id, name, type: 'standard', is_active: true, archived_at: null, category: null, images: [], options: null,
    variants: [{ id: `v-${id}`, sku: `SKU-${id}`, selling_price: '100.00', name: null }],
  })

  it('opens the drafts panel with the selected products and writes drafts for them', async () => {
    const fetchMock = mockApi({
      'GET /auth/me': ok(user()),
      'GET /categories': ok([]),
      'GET /products': ok([product('p-1', 'Cotton Panjabi'), product('p-2', 'Silk Saree')], { pagination: { current_page: 1, per_page: 25, total: 2, last_page: 1 } }),
      ...baseDrafts(),
      'POST /online-catalog/ai/batches': { status: 201, body: { success: true, data: batch({ total: 1, status: 'done', done: 1, progress_percent: 100 }), meta: { request_id: 't' } } },
      'GET /online-catalog/ai/batches/b-1': ok(batch({ total: 1, status: 'done', done: 1, progress_percent: 100 })),
    })
    const u = userEvent.setup()
    renderRoutes(routes, '/products')
    await u.click(await screen.findByRole('checkbox', { name: 'Select Silk Saree' }))
    await u.click(screen.getByRole('button', { name: 'Write AI drafts' }))

    const form = await screen.findByRole('form', { name: 'Write drafts' })
    expect(within(form).getByLabelText(/The ones I choose \(1 chosen\)/)).toBeChecked()
    expect(within(form).getByRole('list', { name: 'Chosen products' })).toHaveTextContent('Silk Saree')
    await u.click(within(form).getByRole('button', { name: 'Write drafts' }))
    await screen.findByTestId('batch-progress')
    expect(bodyOf(fetchMock, 'POST', '/online-catalog/ai/batches')[0]).toMatchObject({ subject: 'product', ids: ['p-2'] })
  })

  it('has no selection without AI', async () => {
    mockApi({
      'GET /auth/me': ok(user(MANAGER, false)),
      'GET /categories': ok([]),
      'GET /products': ok([product('p-1', 'Cotton Panjabi')], { pagination: { current_page: 1, per_page: 25, total: 1, last_page: 1 } }),
    })
    renderRoutes(routes, '/products')
    await screen.findByText('Cotton Panjabi')
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })
})
