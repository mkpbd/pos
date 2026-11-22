import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { routes } from '@/app/routes'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import { bootstrapFixture } from '@/storefront/test-fixtures'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import type { DocumentSummary } from '../api'
import type { WizardResult } from './wizard-api'

/*
 * B21 "Build it for me" on the Page builder screen (Editor A): four steps with radio cards, the
 * goal picked for the page type, category chips (up to four), best sellers or chosen products,
 * the look / language / AI step, the request it sends, the editor opening on the draft, the
 * server's refusals in plain words, and Bangla.
 */

const toasts = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), success: vi.fn() }))
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, ...toasts }) }
})

const manager = (ai = true) => makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage'], ai_enabled: ai })

const created: DocumentSummary = {
  id: 'd-sale', kind: 'page', key: 'landing:big-sale', title: 'Big sale', schema_version: 1, draft_revision: 1, has_unpublished_changes: true,
  draft_updated_at: '2026-11-22T08:00:00+00:00', published: null, path: '/p/big-sale', preview_url: null,
}

const result = (extra: Partial<WizardResult> = {}): WizardResult => ({
  document: created,
  target: 'landing',
  sections: [
    { template: 'classic-sale-hero', label: 'Big picture', label_bn: 'বড় ছবি' },
    { template: 'neutral-flash-sale-bar', label: 'Countdown', label_bn: 'কাউন্টডাউন' },
    { template: 'classic-best-sellers', label: 'Products', label_bn: 'পণ্য' },
  ],
  products: { source: 'best_sellers', count: 8 },
  festival: null,
  ai: { used: true, status: 'ok' },
  ...extra,
})

const CATEGORIES = ['Honey', 'Tea', 'Spices', 'Rice', 'Oil'].map((name, i) => ({ id: `cat-${i}`, name, parent_id: null, depth: 0, is_active: true, listing: { slug: name.toLowerCase(), is_visible: true } }))

function mockScreen(post: (body: Record<string, unknown>) => ReturnType<typeof ok>, options: { ai?: boolean } = {}) {
  const bodies: Record<string, unknown>[] = []
  mockApi({
    'GET /auth/me': ok(manager(options.ai ?? true)),
    'GET /storefront/builder/documents': ok([]),
    'GET /storefront/builder/templates': ok([]),
    'GET /online-catalog/categories': ok(CATEGORIES),
    'GET /storefront/festivals': ok([]),
    'POST /storefront/builder/wizard': (init) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      bodies.push(body)
      return post(body)
    },
    'GET /storefront/builder/documents/d-sale': ok({ ...created, content: { schema_version: 1, sections: [] } }),
    'GET /storefront/builder/elements': ok({ types: ELEMENT_REGISTRY, limits: {}, enums: {} }),
    'GET /storefront/builder/canvas-context': ok({ bootstrap: bootstrapFixture(), store_url: null, locales: ['en'] }),
    'GET /storefront/builder/globals': ok([]),
    'POST /storefront/builder/resolve': ok({ data: {}, media: {}, errors: {} }),
    'GET /storefront/fonts': ok({ fonts: [], limit: 4, max_bytes: 512000 }),
  })
  return bodies
}

async function openWizard(user: ReturnType<typeof userEvent.setup>) {
  renderRoutes(routes, '/storefront/pages')
  const buttons = await screen.findAllByRole('button', { name: /Build it for me|আমার জন্য বানিয়ে দিন/ })
  // The campaign pages card's (the home card has its own).
  await user.click(buttons.at(-1)!)
  return screen.findByTestId('wizard-dialog')
}

beforeEach(() => {
  window.localStorage.clear()
  Object.values(toasts).forEach((fn) => fn.mockReset())
})

describe('Build it for me (B21 wizard)', () => {
  it('walks the four steps and sends what was chosen; the editor opens with the list of sections', async () => {
    const user = userEvent.setup()
    const bodies = mockScreen(() => ({ status: 201, ...ok(result()) }))
    const dialog = await openWizard(user)
    expect(within(dialog).getByRole('heading', { name: 'Build my page' })).toBeInTheDocument()

    // Step 1: what page (radio cards), its name.
    const types = within(dialog).getByRole('radiogroup', { name: 'What page do you want?' })
    expect(within(types).getAllByRole('radio')).toHaveLength(6)
    expect(within(types).getByRole('radio', { name: /Sale/ })).toBeChecked()
    expect(within(dialog).getByRole('heading', { name: 'What page do you want?' })).toHaveFocus()
    expect(within(dialog).getByLabelText('Page name')).toHaveValue('Big sale')
    await user.click(within(dialog).getByRole('button', { name: 'Next' }))

    // Step 2: up to four categories; best sellers by default.
    expect(await within(dialog).findByRole('heading', { name: 'What do you sell?' })).toHaveFocus()
    for (const name of ['Honey', 'Tea', 'Spices', 'Rice']) await user.click(await within(dialog).findByRole('button', { name }))
    await user.click(within(dialog).getByRole('button', { name: 'Oil' }))
    expect(within(dialog).getByRole('button', { name: 'Oil' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(dialog).getByText('You can pick up to 4 categories.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Rice' }))
    expect(within(dialog).getByRole('radio', { name: /Use my best sellers/ })).toBeChecked()
    await user.click(within(dialog).getByRole('button', { name: 'Next' }))

    // Step 3: the goal is picked for a sale page.
    const goals = await within(dialog).findByRole('radiogroup', { name: 'What should the page do?' })
    expect(within(goals).getByRole('radio', { name: /Get orders/ })).toBeChecked()
    await user.click(within(dialog).getByRole('button', { name: 'Next' }))

    // Step 4: look, language, AI.
    const looks = await within(dialog).findByRole('radiogroup', { name: 'How should it look?' })
    await user.click(within(looks).getByRole('radio', { name: /Lively/ }))
    await user.click(within(dialog).getByRole('radio', { name: 'Both' }))
    await user.click(within(dialog).getByRole('switch', { name: 'Write the texts with AI' }))
    expect(within(dialog).getByRole('button', { name: /Colours from my logo/ })).toHaveAttribute('aria-expanded', 'false')
    await user.click(within(dialog).getByRole('button', { name: /Build my page/ }))

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toEqual({ page_type: 'sale', title: 'Big sale', goal: 'orders', look: 'lively', language: 'both', use_ai: true, category_ids: ['cat-0', 'cat-1', 'cat-2'] })
    await waitFor(() => expect(toasts.success).toHaveBeenCalled())
    expect(toasts.success).toHaveBeenCalledWith('Your page is ready to edit — nothing is live until you publish.', expect.objectContaining({ description: expect.stringMatching(/^Sections: Big picture, Countdown, Products\. The texts were written with AI/) }))
    expect(await screen.findByTestId('store-builder-editor', {}, { timeout: 5000 })).toBeInTheDocument()
  })

  it('the goal follows the page type until one is picked; Back keeps the answers', async () => {
    const user = userEvent.setup()
    mockScreen(() => ({ status: 201, ...ok(result()) }))
    const dialog = await openWizard(user)
    await user.click(within(dialog).getByRole('radio', { name: /About us/ }))
    expect(within(dialog).getByLabelText('Page name')).toHaveValue('About us')
    expect(within(dialog).getByLabelText('Address (optional)')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Next' }))
    await user.click(within(dialog).getByRole('button', { name: 'Next' }))
    expect(within(await within(dialog).findByRole('radiogroup', { name: 'What should the page do?' })).getByRole('radio', { name: /Tell our story/ })).toBeChecked()
    await user.click(within(dialog).getByRole('button', { name: 'Back' }))
    await user.click(within(dialog).getByRole('button', { name: 'Back' }))
    expect(within(dialog).getByRole('radio', { name: /About us/ })).toBeChecked()
  })

  it('an empty name or a bad address stops step 1', async () => {
    const user = userEvent.setup()
    mockScreen(() => ({ status: 201, ...ok(result()) }))
    const dialog = await openWizard(user)
    await user.clear(within(dialog).getByLabelText('Page name'))
    await user.type(within(dialog).getByLabelText('Address (optional)'), 'Eid_offer!')
    await user.click(within(dialog).getByRole('button', { name: 'Next' }))
    expect(within(dialog).getByText('Enter a page name.')).toBeInTheDocument()
    expect(within(dialog).getByText('Use only small English letters, numbers and dashes (-).')).toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { name: 'What page do you want?' })).toBeInTheDocument()
  })

  it('no live products: says what to do and goes to the goal step', async () => {
    const user = userEvent.setup()
    mockScreen(() => fail(422, 'NOTHING_TO_SHOW', 'Nothing to show.', { reason: 'no_live_products' }))
    const dialog = await openWizard(user)
    for (let i = 0; i < 3; i++) await user.click(within(dialog).getByRole('button', { name: 'Next' }))
    await user.click(await within(dialog).findByRole('button', { name: /Build my page/ }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('There are no products on your online store yet.')
    expect(within(dialog).getByRole('heading', { name: 'What should the page do?' })).toBeInTheDocument()
  })

  it('an address in use: back on step 1 with the address problem', async () => {
    const user = userEvent.setup()
    mockScreen(() => fail(409, 'DOCUMENT_EXISTS', 'Exists.', { key: 'landing:big-sale' }))
    const dialog = await openWizard(user)
    for (let i = 0; i < 3; i++) await user.click(within(dialog).getByRole('button', { name: 'Next' }))
    await user.click(await within(dialog).findByRole('button', { name: /Build my page/ }))
    expect(await within(dialog).findByText('A page with this address already exists. Choose another address.')).toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { name: 'What page do you want?' })).toBeInTheDocument()
  })

  it('AI off: no AI switch and no use_ai', async () => {
    const user = userEvent.setup()
    const bodies = mockScreen(() => ({ status: 201, ...ok(result({ ai: { used: false, status: 'not_requested' } })) }), { ai: false })
    const dialog = await openWizard(user)
    for (let i = 0; i < 3; i++) await user.click(within(dialog).getByRole('button', { name: 'Next' }))
    await within(dialog).findByRole('radiogroup', { name: 'How should it look?' })
    expect(within(dialog).queryByRole('switch')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /Build my page/ }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).not.toHaveProperty('use_ai')
  })

  it('speaks Bangla when the screen does', async () => {
    window.localStorage.setItem('pos.storeBuilder.pagesLang', 'bn')
    const user = userEvent.setup()
    const bodies = mockScreen(() => ({ status: 201, ...ok(result({ ai: { used: false, status: 'not_requested' } })) }))
    const dialog = await openWizard(user)
    expect(within(dialog).getByRole('heading', { name: 'আমার পেজ বানান' })).toBeInTheDocument()
    expect(within(dialog).getByRole('radiogroup', { name: 'কোন পেজ চান?' })).toBeInTheDocument()
    expect(within(dialog).getByText('ধাপ ১ / ৪')).toBeInTheDocument()
    for (let i = 0; i < 3; i++) await user.click(within(dialog).getByRole('button', { name: 'পরের ধাপ' }))
    await user.click(await within(dialog).findByRole('button', { name: /আমার পেজ বানান/ }))
    await waitFor(() => expect(bodies[0]).toMatchObject({ language: 'bn', title: 'বড় সেল' }))
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith(expect.stringMatching(/পাবলিশ না করা পর্যন্ত/), expect.objectContaining({ description: 'সেকশন: বড় ছবি, কাউন্টডাউন, পণ্য।' })))
  })
})
