import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { routes } from '@/app/routes'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import type { DocumentSummary } from '../api'
import type { BuilderTemplate } from '../templates/api'

/* "Start from a demo look" on the pages list (B5): the card, the dialog, the review and publish all. */

const MANAGE = ['storefront.view', 'storefront.manage']
const PUBLISH = [...MANAGE, 'storefront.publish']

const site = (preset: 'vegan' | 'handmade' | 'classic' | 'kids', name: string, thumbnail: string | null = null): BuilderTemplate => ({
  id: `site-${preset}`, scope: 'site', preset, category: null, name, description: `${name} demo store look.`, thumbnail_url: thumbnail, allowed_in: ['page'], source: 'builtin',
})
const SITES = [site('vegan', 'Vegan Market', '/builder-templates/site-vegan.webp'), site('handmade', 'Handmade Atelier'), site('classic', 'Classic Shop'), site('kids', 'Little Sprouts')]

const presets = [
  { key: 'vegan', name: 'Vegan', description: '', theme: { colors: { primary: '#2f7d32', accent: '#f4a259', highlight: '#8bc34a', heading: '#1b3a1d', canvas: '#f6fbf2' }, typography: {}, shape: {}, layout: {} } },
]

const summary = (over: Partial<DocumentSummary>): DocumentSummary => ({
  id: 'd-x', kind: 'page', key: 'home', title: 'Home', schema_version: 1, draft_revision: 1, has_unpublished_changes: true, draft_updated_at: '2026-11-12T08:00:00+00:00',
  published: null, path: '/', preview_url: 'https://shop.test/?preview=draft', ...over,
})
const existingHome = summary({ id: 'd-home', published: { version_id: 'v-1', number: 1, published_at: '2026-11-10T08:00:00+00:00' } })
const drafts = [
  summary({ id: 'd-home', title: 'Home' }),
  summary({ id: 'd-header', kind: 'header', key: 'header', title: 'Header', path: null, preview_url: null }),
  summary({ id: 'd-footer', kind: 'footer', key: 'footer', title: 'Footer', path: null, preview_url: null }),
  summary({ id: 'd-zone', kind: 'zone', key: 'zone:listing.top', title: 'Listing top', path: null, preview_url: 'https://shop.test/shop?preview=draft' }),
]

const themeDraft = (changes: boolean) => ({
  settings: { colors: {}, typography: {}, shape: {}, layout: { container_width: 1170, sticky_header: true }, footer: {}, announcement: {} },
  draft_revision: 2, has_unpublished_changes: changes, published: { number: 4, published_at: null }, custom_css: null, has_custom_css: false,
})

type Calls = { starts: { preset: string; body: unknown }[]; publishes: unknown[] }

function mock(permissions: string[], options: { publishFails?: boolean; themeChanges?: boolean } = {}) {
  const calls: Calls = { starts: [], publishes: [] }
  mockApi({
    'GET /auth/me': ok(makeCurrentUser({ permissions })),
    'GET /storefront/builder/documents': ok([existingHome]),
    'GET /storefront/builder/templates': (_init, url) => ok(url.searchParams.get('scope') === 'site' ? SITES : []),
    'GET /storefront/theme/presets': ok(presets),
    'GET /storefront/theme/draft': ok(themeDraft(options.themeChanges ?? true)),
    'GET /storefront/link-targets': ok({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }),
    'POST /storefront/builder/start-from-demo/vegan': (init) => {
      calls.starts.push({ preset: 'vegan', body: JSON.parse(String(init.body)) })
      return ok({ documents: drafts, theme: { preview_url: 'https://shop.test/?preview=draft' } })
    },
    'POST /storefront/builder/start-from-demo/kids': (init) => {
      calls.starts.push({ preset: 'kids', body: JSON.parse(String(init.body)) })
      return ok({ documents: drafts, theme: { preview_url: 'https://shop.test/?preview=draft' } })
    },
    'POST /storefront/builder/publish-all': (init) => {
      calls.publishes.push(JSON.parse(String(init.body)))
      return options.publishFails ? fail(422, 'DOCUMENT_EMPTY', 'The footer is empty.') : ok({ documents: drafts })
    },
  })
  return calls
}

describe('page builder: start from a demo look (B5)', () => {
  it('shows the four demo looks with a picture, description and colours', async () => {
    mock(MANAGE)
    renderRoutes(routes, '/storefront/pages')
    const card = await screen.findByTestId('demo-looks')
    await waitFor(() => expect(within(card).getAllByRole('button', { name: /^Use the .* look$/ })).toHaveLength(4))
    // Four looks: one per row, 2 × 2, then four across (never three and a lone card).
    expect(within(card).getByRole('list', { name: 'Demo looks' })).toHaveClass('sm:grid-cols-2', 'xl:grid-cols-4')
    expect(within(card).getByRole('list', { name: 'Demo looks' })).not.toHaveClass('lg:grid-cols-3')
    expect(within(card).getByTestId('demo-look-kids')).toHaveTextContent('Little Sprouts demo store look.')
    const vegan = within(card).getByTestId('demo-look-vegan')
    expect(vegan.querySelector('img')).toHaveAttribute('src', '/builder-templates/site-vegan.webp')
    expect(vegan).toHaveTextContent('Vegan Market demo store look.')
    await waitFor(() => expect(within(vegan).getByTestId('demo-swatches').children).toHaveLength(5))
    // No picture yet: the generated placeholder.
    expect(within(within(card).getByTestId('demo-look-classic')).getByTestId('template-placeholder')).toHaveTextContent('Classic Shop')
  })

  it('is not offered to people who only view the store', async () => {
    mock(['storefront.view'])
    renderRoutes(routes, '/storefront/pages')
    await screen.findByTestId('page-row-home')
    expect(screen.queryByTestId('demo-looks')).toBeNull()
  })

  it('creates drafts for the chosen parts, then reviews and publishes them all', async () => {
    const user = userEvent.setup()
    const calls = mock(PUBLISH)
    renderRoutes(routes, '/storefront/pages')
    await user.click(await screen.findByRole('button', { name: 'Use the Vegan Market look' }))

    const dialog = await screen.findByRole('dialog', { name: 'Use the Vegan Market look?' })
    expect(dialog).toHaveTextContent('Your live store doesn’t change until you publish')
    // The existing home page and the theme have unpublished changes: they'd be replaced.
    expect(within(dialog).getByTestId('demo-warning-home')).toHaveTextContent('Your unpublished changes here will be replaced.')
    expect(within(dialog).getByTestId('demo-warning-theme')).toBeInTheDocument()
    expect(within(dialog).queryByTestId('demo-warning-header')).toBeNull()
    for (const label of ['Site styles', 'Home page', 'Header', 'Footer', 'Shop pages']) expect(within(dialog).getByRole('checkbox', { name: label })).toBeChecked()
    await user.click(within(dialog).getByRole('checkbox', { name: 'Footer' }))
    await user.click(within(dialog).getByRole('button', { name: 'Create drafts' }))
    await waitFor(() => expect(calls.starts).toEqual([{ preset: 'vegan', body: { include: { theme: true, home: true, header: true, footer: false, listing_top: true } } }]))

    const review = await screen.findByTestId('demo-review')
    expect(within(review).getByRole('heading', { name: 'Review your Vegan Market look' })).toBeInTheDocument()
    expect(within(review).getByRole('link', { name: 'Preview Home (opens in a new tab)' })).toHaveAttribute('href', 'https://shop.test/?preview=draft')
    expect(within(review).getByRole('link', { name: 'Preview Listing top (opens in a new tab)' })).toHaveAttribute('href', 'https://shop.test/shop?preview=draft')
    expect(within(review).getByRole('link', { name: 'Preview the site styles (opens in a new tab)' })).toBeInTheDocument()
    expect(within(review).getByRole('link', { name: 'Edit Header' })).toHaveAttribute('href', '/storefront/builder/d-header')

    await user.click(within(review).getByRole('button', { name: 'Publish all' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Publish your new look?' })
    expect(confirm).toHaveTextContent('These 5 parts go live for shoppers right away.')
    await user.click(within(confirm).getByRole('button', { name: 'Publish all' }))
    await waitFor(() => expect(calls.publishes).toEqual([{ documents: ['d-home', 'd-header', 'd-footer', 'd-zone'], theme: true, note: 'Vegan Market demo look' }]))
    expect(await within(review).findByRole('heading', { name: 'The Vegan Market look is live' })).toBeInTheDocument()
    expect(within(review).getByRole('link', { name: /View your store/ })).toHaveAttribute('href', 'https://shop.test/')
  })

  it('K1: the kids look starts from its demo like the others', async () => {
    const user = userEvent.setup()
    const calls = mock(PUBLISH)
    renderRoutes(routes, '/storefront/pages')
    await user.click(await screen.findByRole('button', { name: 'Use the Little Sprouts look' }))
    const dialog = await screen.findByRole('dialog', { name: 'Use the Little Sprouts look?' })
    await user.click(within(dialog).getByRole('button', { name: 'Create drafts' }))
    await waitFor(() => expect(calls.starts).toEqual([{ preset: 'kids', body: { include: { theme: true, home: true, header: true, footer: true, listing_top: true } } }]))
    expect(await screen.findByRole('heading', { name: 'Review your Little Sprouts look' })).toBeInTheDocument()
  })

  it('without the publish permission the drafts are made but Publish all is unavailable', async () => {
    const user = userEvent.setup()
    mock(MANAGE, { themeChanges: false })
    renderRoutes(routes, '/storefront/pages')
    await user.click(await screen.findByRole('button', { name: 'Use the Vegan Market look' }))
    const dialog = await screen.findByRole('dialog', { name: 'Use the Vegan Market look?' })
    expect(within(dialog).queryByTestId('demo-warning-theme')).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Create drafts' }))
    const review = await screen.findByTestId('demo-review')
    expect(within(review).getByRole('button', { name: 'Publish all' })).toBeDisabled()
    expect(review).toHaveTextContent('Someone with permission to publish makes these drafts live.')
    await user.click(within(review).getByRole('button', { name: 'Done for now' }))
    expect(await screen.findByTestId('demo-looks')).toBeInTheDocument()
  })

  it('needs at least one part, and shows why publishing all failed', async () => {
    const user = userEvent.setup()
    mock(PUBLISH, { publishFails: true })
    renderRoutes(routes, '/storefront/pages')
    await user.click(await screen.findByRole('button', { name: 'Use the Vegan Market look' }))
    const dialog = await screen.findByRole('dialog', { name: 'Use the Vegan Market look?' })
    for (const label of ['Site styles', 'Home page', 'Header', 'Footer', 'Shop pages']) await user.click(within(dialog).getByRole('checkbox', { name: label }))
    expect(within(dialog).getByRole('button', { name: 'Create drafts' })).toBeDisabled()
    await user.click(within(dialog).getByRole('checkbox', { name: 'Home page' }))
    await user.click(within(dialog).getByRole('button', { name: 'Create drafts' }))

    const review = await screen.findByTestId('demo-review')
    await user.click(within(review).getByRole('button', { name: 'Publish all' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Publish all' }))
    expect(await within(review).findByRole('alert')).toHaveTextContent('The footer is empty.')
    expect(within(review).getByRole('heading', { name: 'Review your Vegan Market look' })).toBeInTheDocument()
  })
})
