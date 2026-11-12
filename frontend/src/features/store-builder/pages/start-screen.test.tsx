import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { routes } from '@/app/routes'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import type { DocumentSummary } from '../api'
import type { BuilderTemplate } from '../templates/api'
import { MESSAGES, translate, translateCount, type MessageKey } from './messages'
import { guideState } from './page-helpers'

/* B7: the start screen's 3-step guide and its English / বাংলা switch. */

const MANAGE = ['storefront.view', 'storefront.manage']
const PUBLISH = [...MANAGE, 'storefront.publish']

const doc = (over: Partial<DocumentSummary>): DocumentSummary => ({
  id: 'd-home', kind: 'page', key: 'home', title: 'Home', schema_version: 1, draft_revision: 2, has_unpublished_changes: true, draft_updated_at: '2026-11-12T08:00:00+00:00',
  published: null, path: '/', preview_url: 'https://shop.test/?preview=draft', ...over,
})
const header = doc({ id: 'd-header', kind: 'header', key: 'header', title: 'Header', path: null, preview_url: null })
const published = { version_id: 'v-1', number: 1, published_at: '2026-11-10T08:00:00+00:00' }

const theme = (over: { draft_revision?: number; has_unpublished_changes?: boolean; published?: unknown } = {}) => ({
  settings: { colors: {}, typography: {}, shape: {}, layout: { container_width: 1170, sticky_header: true }, footer: {}, announcement: {} },
  draft_revision: 0, has_unpublished_changes: false, published: null, custom_css: null, has_custom_css: false, ...over,
})

const KIDS: BuilderTemplate = {
  id: 'site-kids', scope: 'site', preset: 'kids', category: null, name: 'BerryKid Kids Store', description: 'A bright, playful look for baby and kids shops.', thumbnail_url: null, preview_url: null, allowed_in: ['page'], source: 'builtin',
}

function mock(permissions: string[], documents: DocumentSummary[], themeDraft = theme(), extra: Record<string, Parameters<typeof mockApi>[0][string]> = {}) {
  const publishes: unknown[] = []
  const creates: unknown[] = []
  mockApi({
    'GET /auth/me': ok(makeCurrentUser({ permissions })),
    'GET /storefront/builder/documents': ok(documents),
    'GET /storefront/builder/templates': ok([KIDS]),
    'GET /storefront/theme/presets': ok([]),
    'GET /storefront/theme/draft': ok(themeDraft),
    'GET /storefront/link-targets': ok({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }),
    'GET /demo-stores': ok([]),
    'POST /storefront/builder/publish-all': (init) => {
      publishes.push(JSON.parse(String(init.body)))
      return ok({ documents: [] })
    },
    'POST /storefront/builder/documents': (init) => {
      creates.push(JSON.parse(String(init.body)))
      return { status: 201, ...ok({ ...doc({ id: 'd-new' }), content: { schema_version: 1, sections: [] } }) }
    },
    'GET /storefront/builder/elements': ok({ types: [], limits: {}, enums: {} }),
    'GET /storefront/builder/canvas-context': ok({ bootstrap: {}, store_url: null, locales: ['en'] }),
    ...extra,
  })
  return { publishes, creates }
}

const stateOf = (n: number) => screen.getByTestId(`guide-step-${n}`).getAttribute('data-state')

beforeEach(() => window.localStorage.clear())

describe('page builder start screen: the 3-step guide (B7)', () => {
  it('a new store: step 1 is next, nothing to publish', async () => {
    mock(PUBLISH, [])
    renderRoutes(routes, '/storefront/pages')
    const guide = await screen.findByTestId('start-guide')
    expect(within(guide).getByRole('heading', { name: 'Get your shop ready in 3 steps' })).toBeInTheDocument()
    expect(guide).toHaveTextContent('A draft is a private copy')
    await waitFor(() => expect(stateOf(1)).toBe('current'))
    expect(stateOf(2)).toBe('todo')
    expect(stateOf(3)).toBe('todo')
    expect(within(guide).getByTestId('guide-pending')).toHaveTextContent('Everything is published.')
    expect(within(guide).getByRole('button', { name: 'See the looks' })).toBeInTheDocument()
    expect(within(guide).getByRole('button', { name: 'Start the home page' })).toBeInTheDocument()
    expect(within(guide).queryByRole('button', { name: 'Publish all changes' })).toBeNull()
  })

  it('after a look: step 2 is next; the home page step starts the home page from the current one', async () => {
    const user = userEvent.setup()
    const calls = mock(PUBLISH, [header])
    const { router } = renderRoutes(routes, '/storefront/pages')
    await screen.findByTestId('start-guide')
    await waitFor(() => expect(stateOf(1)).toBe('done'))
    expect(stateOf(2)).toBe('current')
    expect(within(screen.getByTestId('guide-step-1')).getByText('Done')).toBeInTheDocument()
    expect(screen.getByTestId('guide-pending')).toHaveTextContent('1 unpublished change')
    await user.click(screen.getByRole('button', { name: 'Start the home page' }))
    await waitFor(() => expect(calls.creates).toEqual([{ kind: 'page', key: 'home', title: 'Home', from: 'homepage' }]))
    await waitFor(() => expect(router.state.location.pathname).toBe('/storefront/builder/d-new'))
  })

  it('a theme that was published counts as a chosen look', () => {
    expect(guideState([], { draft_revision: 0, has_unpublished_changes: false, published: { number: 1 } }).done).toEqual([true, false, false])
    expect(guideState([], { draft_revision: 0, has_unpublished_changes: false, published: null }).done).toEqual([false, false, false])
    expect(guideState([], undefined).done).toEqual([false, false, false])
  })

  it('pages edited but not live: step 3 counts the changes and publishes them all after a confirm', async () => {
    const user = userEvent.setup()
    const calls = mock(PUBLISH, [doc({}), header, doc({ id: 'd-footer', kind: 'footer', key: 'footer', title: 'Footer', has_unpublished_changes: false, published, path: null })], theme({ draft_revision: 3, has_unpublished_changes: true }))
    renderRoutes(routes, '/storefront/pages')
    await screen.findByTestId('start-guide')
    await waitFor(() => expect(stateOf(3)).toBe('current'))
    expect(stateOf(1)).toBe('done')
    expect(stateOf(2)).toBe('done')
    expect(screen.getByTestId('guide-pending')).toHaveTextContent('3 unpublished changes')
    expect(screen.getByRole('button', { name: 'Edit the home page' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Publish all changes' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Publish all changes?' })
    expect(confirm).toHaveTextContent('3 changes go live on your shop right away. You can go back with Version history.')
    await user.click(within(confirm).getByRole('button', { name: 'Publish now' }))
    await waitFor(() => expect(calls.publishes).toEqual([{ documents: ['d-home', 'd-header'], theme: true }]))
  })

  it('the home page is live and nothing waits: every step is done', async () => {
    mock(PUBLISH, [doc({ published, has_unpublished_changes: false })], theme({ draft_revision: 2, published: { number: 2 } }))
    renderRoutes(routes, '/storefront/pages')
    await screen.findByTestId('start-guide')
    await waitFor(() => expect(stateOf(3)).toBe('done'))
    expect(stateOf(1)).toBe('done')
    expect(stateOf(2)).toBe('done')
    expect(screen.getByTestId('guide-pending')).toHaveTextContent('Everything is published.')
  })

  it('without the publish permission the publish step says who can', async () => {
    mock(MANAGE, [doc({})])
    renderRoutes(routes, '/storefront/pages')
    const step = await screen.findByTestId('guide-step-3')
    expect(within(step).getByRole('button', { name: 'Publish all changes' })).toBeDisabled()
    expect(step).toHaveTextContent('Ask someone who is allowed to publish.')
  })

  it('the home page step opens the editor of an existing home page', async () => {
    const user = userEvent.setup()
    mock(PUBLISH, [doc({})], theme(), { 'GET /storefront/builder/documents/d-home': ok({ ...doc({}), content: { schema_version: 1, sections: [] } }) })
    const { router } = renderRoutes(routes, '/storefront/pages')
    await user.click(await screen.findByRole('button', { name: 'Edit the home page' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/storefront/builder/d-home'))
  })

  it('hides the guide, and remembers that', async () => {
    const user = userEvent.setup()
    mock(PUBLISH, [])
    const first = renderRoutes(routes, '/storefront/pages')
    await user.click(within(await screen.findByTestId('start-guide')).getByRole('button', { name: 'Hide guide' }))
    expect(screen.queryByTestId('start-guide')).toBeNull()
    expect(window.localStorage.getItem('pos.storeBuilder.guideHidden')).toBe('1')
    first.unmount()

    renderRoutes(routes, '/storefront/pages')
    await user.click(await screen.findByRole('button', { name: 'Show the 3-step guide' }))
    expect(await screen.findByTestId('start-guide')).toBeInTheDocument()
    expect(window.localStorage.getItem('pos.storeBuilder.guideHidden')).toBeNull()
  })
})

describe('page builder start screen: English / বাংলা (B7)', () => {
  it('switches the screen to Bangla, remembers it, and the dialogs follow', async () => {
    const user = userEvent.setup()
    mock(PUBLISH, [doc({}), header], theme({ draft_revision: 1, has_unpublished_changes: true }))
    const first = renderRoutes(routes, '/storefront/pages')
    const root = await screen.findByTestId('pages-screen')
    expect(root).toHaveAttribute('lang', 'en')
    expect(within(root).getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(within(root).getByRole('button', { name: 'বাংলা' }))
    expect(root).toHaveAttribute('lang', 'bn')
    expect(within(root).getByRole('button', { name: 'বাংলা' })).toHaveAttribute('aria-pressed', 'true')
    expect(window.localStorage.getItem('pos.storeBuilder.pagesLang')).toBe('bn')
    expect(within(root).getByRole('heading', { name: 'পেজ বিল্ডার' })).toBeInTheDocument()
    expect(within(root).getByRole('heading', { name: '৩টি ধাপে আপনার দোকান সাজিয়ে ফেলুন' })).toBeInTheDocument()
    for (const heading of ['আপনার পেজ', 'হেডার ও ফুটার', 'শপ পেজ']) expect(within(root).getByRole('heading', { name: heading, level: 2 })).toBeInTheDocument()
    // Counts in Bangla digits.
    await waitFor(() => expect(within(root).getByTestId('guide-pending')).toHaveTextContent('৩টি পরিবর্তন এখনো পাবলিশ হয়নি'))
    expect(within(root).getByTestId('page-row-home')).toHaveTextContent('পাবলিশ হয়নি')
    const kids = await within(root).findByTestId('demo-look-kids')
    expect(within(kids).getByTestId('demo-featured-badge')).toHaveTextContent('বেবি ও কিডস দোকানের জন্য সেরা')

    // Dialogs (outside the screen's element) carry the language too.
    await user.click(within(kids).getByRole('button', { name: 'BerryKid Kids Store ডিজাইনটি নিন' }))
    const dialog = await screen.findByRole('dialog', { name: 'BerryKid Kids Store ডিজাইনটি নেবেন?' })
    expect(dialog).toHaveAttribute('lang', 'bn')
    expect(within(dialog).getByRole('checkbox', { name: 'রং ও ফন্ট' })).toBeChecked()
    expect(within(dialog).getByRole('button', { name: 'এখনই নিন ও পাবলিশ করুন' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'বাতিল' }))
    first.unmount()

    // The choice is remembered.
    renderRoutes(routes, '/storefront/pages')
    const again = await screen.findByTestId('pages-screen')
    expect(again).toHaveAttribute('lang', 'bn')
    expect(within(again).getByRole('heading', { name: 'পেজ বিল্ডার' })).toBeInTheDocument()
    await user.click(within(again).getByRole('button', { name: 'English' }))
    expect(within(again).getByRole('heading', { name: 'Page builder' })).toBeInTheDocument()
    expect(window.localStorage.getItem('pos.storeBuilder.pagesLang')).toBe('en')
  })

  it('every message has a Bangla text with the same placeholders', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    for (const key of Object.keys(MESSAGES.en) as MessageKey[]) {
      expect(MESSAGES.bn[key]?.trim(), key).toBeTruthy()
      expect(placeholders(MESSAGES.bn[key]), key).toEqual(placeholders(MESSAGES.en[key]))
    }
    expect(translate('bn', 'guide.step', { n: 2 })).toBe('ধাপ ২')
    expect(translateCount('en', 'guide.3.pending', 1)).toBe('1 unpublished change')
    expect(translateCount('en', 'guide.3.pending', 12)).toBe('12 unpublished changes')
    expect(translateCount('bn', 'guide.3.pending', 12)).toBe('১২টি পরিবর্তন এখনো পাবলিশ হয়নি')
  })
})
