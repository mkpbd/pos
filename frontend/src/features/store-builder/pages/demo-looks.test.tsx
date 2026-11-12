import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { routes } from '@/app/routes'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import type { DocumentSummary } from '../api'
import type { BuilderTemplate } from '../templates/api'

/* The shop looks on the pages list (B5, B7): order and featured look, preview, live demo, drafts and use & publish now. */

const MANAGE = ['storefront.view', 'storefront.manage']
const PUBLISH = [...MANAGE, 'storefront.publish']

type Preset = 'vegan' | 'handmade' | 'classic' | 'kids' | 'default'
const site = (preset: Preset, name: string, over: Partial<BuilderTemplate> = {}): BuilderTemplate => ({
  id: `site-${preset}`, scope: 'site', preset, category: null, name, description: `${name} demo store look.`, thumbnail_url: null, preview_url: null, allowed_in: ['page'], source: 'builtin', ...over,
})
// The API's order (B7): the kids look first, then the original look and the other demos.
const SITES = [
  site('kids', 'BerryKid Kids Store', { thumbnail_url: '/builder-templates/site-kids.webp', preview_url: '/builder-templates/site-kids-full.png' }),
  site('default', 'Original look'),
  site('vegan', 'Vegan Market', { thumbnail_url: '/builder-templates/site-vegan.webp' }),
  site('handmade', 'Handmade Atelier'),
  site('classic', 'Classic Shop'),
]

const presets = [
  { key: 'vegan', name: 'Vegan', description: '', theme: { colors: { primary: '#2f7d32', accent: '#f4a259', highlight: '#8bc34a', heading: '#1b3a1d', canvas: '#f6fbf2' }, typography: {}, shape: {}, layout: {} } },
]

const demoStore = (preset: string, host: string) => ({
  host, name: `${preset} demo`, preset, tagline: null, colors: { primary: '#ff6f61', accent: '#4bb4de', canvas: '#ffffff' }, heading_font: 'baloo', image_url: null, product_count: 12, category_names: [],
})

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

type Calls = { order: string[]; starts: { preset: string; body: unknown }[]; publishes: unknown[] }

function mock(permissions: string[], options: { publishFails?: boolean; themeChanges?: boolean; demos?: unknown[] | 'off' } = {}) {
  const calls: Calls = { order: [], starts: [], publishes: [] }
  const start = (preset: string) => (init: RequestInit) => {
    calls.order.push(`start:${preset}`)
    calls.starts.push({ preset, body: JSON.parse(String(init.body)) })
    return ok({ documents: drafts, theme: { preview_url: 'https://shop.test/?preview=draft' }, imported: { media: 3 } })
  }
  mockApi({
    'GET /auth/me': ok(makeCurrentUser({ permissions })),
    'GET /storefront/builder/documents': ok([existingHome]),
    'GET /storefront/builder/templates': (_init, url) => ok(url.searchParams.get('scope') === 'site' ? SITES : []),
    'GET /storefront/theme/presets': ok(presets),
    'GET /storefront/theme/draft': ok(themeDraft(options.themeChanges ?? true)),
    'GET /storefront/link-targets': ok({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }),
    'GET /demo-stores': options.demos === 'off' ? fail(404, 'NOT_FOUND') : ok(options.demos ?? []),
    'POST /storefront/builder/start-from-demo/vegan': start('vegan'),
    'POST /storefront/builder/start-from-demo/kids': start('kids'),
    'POST /storefront/builder/start-from-demo/default': start('default'),
    'POST /storefront/builder/publish-all': (init) => {
      calls.order.push('publish-all')
      calls.publishes.push(JSON.parse(String(init.body)))
      return options.publishFails ? fail(422, 'DOCUMENT_EMPTY', 'The footer is empty.') : ok({ documents: drafts })
    },
  })
  return calls
}

beforeEach(() => window.localStorage.clear())

describe('page builder: shop looks (B5, B7)', () => {
  it('lists the looks in the API’s order; the first is featured, the other four sit 2 × 2 / 4 across', async () => {
    mock(MANAGE)
    renderRoutes(routes, '/storefront/pages')
    const card = await screen.findByTestId('demo-looks')
    await waitFor(() => expect(within(card).getAllByRole('button', { name: /^Use (?!and)/ })).toHaveLength(5))
    const items = within(within(card).getByRole('list', { name: 'Demo looks' })).getAllByRole('listitem')
    expect(items.map((li) => li.getAttribute('data-testid'))).toEqual(['demo-look-kids', 'demo-look-default', 'demo-look-vegan', 'demo-look-handmade', 'demo-look-classic'])

    const featured = within(card).getByTestId('demo-look-kids')
    expect(featured).toHaveAttribute('data-featured', 'true')
    expect(featured).toHaveClass('col-span-full')
    expect(within(featured).getByTestId('demo-featured-badge')).toHaveTextContent('Recommended for baby & kids shops')
    expect(featured.querySelector('img')).toHaveAttribute('src', '/builder-templates/site-kids.webp')
    expect(within(card).getAllByTestId('demo-featured-badge')).toHaveLength(1)
    // Four after the featured one: 2 × 2, then four across (never three and a lone card).
    expect(within(card).getByRole('list', { name: 'Demo looks' })).toHaveClass('sm:grid-cols-2', 'xl:grid-cols-4')

    const vegan = within(card).getByTestId('demo-look-vegan')
    expect(vegan).toHaveTextContent('Vegan Market demo store look.')
    await waitFor(() => expect(within(vegan).getByTestId('demo-swatches').children).toHaveLength(5))
    expect(within(within(card).getByTestId('demo-look-classic')).getByTestId('template-placeholder')).toHaveTextContent('Classic Shop')
    for (const name of ['BerryKid Kids Store', 'Original look', 'Classic Shop']) expect(within(card).getByRole('button', { name: `Preview ${name}` })).toBeInTheDocument()
  })

  it('is not offered to people who only view the store', async () => {
    mock(['storefront.view'])
    renderRoutes(routes, '/storefront/pages')
    await screen.findByTestId('page-row-home')
    expect(screen.queryByTestId('demo-looks')).toBeNull()
    expect(screen.queryByTestId('start-guide')).toBeNull()
  })

  it('previews a look: the tall picture (falling back to the thumbnail), what you get, and the way to use it', async () => {
    const user = userEvent.setup()
    mock(PUBLISH)
    renderRoutes(routes, '/storefront/pages')
    await user.click(await screen.findByRole('button', { name: 'Preview BerryKid Kids Store' }))
    const dialog = await screen.findByRole('dialog', { name: 'BerryKid Kids Store' })
    expect(dialog).toHaveTextContent('BerryKid Kids Store demo store look.')
    const image = within(dialog).getByRole('img', { name: 'The whole home page of BerryKid Kids Store' })
    expect(image).toHaveAttribute('src', '/builder-templates/site-kids-full.png')
    expect(within(dialog).getByTestId('look-preview-scroll')).toHaveClass('overflow-y-auto')
    for (const part of ['Colours, fonts and buttons', 'A ready home page', 'Header (top of every page)', 'Footer (bottom of every page)']) expect(dialog).toHaveTextContent(part)
    // No full picture yet (or it fails): the card's thumbnail.
    fireEvent.error(image)
    expect(within(dialog).getByRole('img', { name: 'The whole home page of BerryKid Kids Store' })).toHaveAttribute('src', '/builder-templates/site-kids.webp')

    await user.click(within(dialog).getByRole('button', { name: 'Use this look' }))
    expect(await screen.findByRole('dialog', { name: 'Use BerryKid Kids Store?' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'BerryKid Kids Store' })).toBeNull()
  })

  it('a look without any picture previews with the drawn placeholder', async () => {
    const user = userEvent.setup()
    mock(PUBLISH)
    renderRoutes(routes, '/storefront/pages')
    await user.click(await screen.findByRole('button', { name: 'Preview Original look' }))
    const dialog = await screen.findByRole('dialog', { name: 'Original look' })
    expect(within(dialog).getByTestId('template-placeholder')).toHaveTextContent('Original look')
  })

  it('links "See live demo" to the matching demo store; none for the original look', async () => {
    const user = userEvent.setup()
    mock(MANAGE, { demos: [demoStore('kids', 'kids.shop.localhost'), demoStore('vegan', 'vegan.shop.localhost'), demoStore('default', 'plain.shop.localhost')] })
    renderRoutes(routes, '/storefront/pages')
    const card = await screen.findByTestId('demo-looks')
    const port = window.location.port ? `:${window.location.port}` : ''
    const kids = await within(card).findByRole('link', { name: 'See a live demo of BerryKid Kids Store (opens in a new tab)' })
    expect(kids).toHaveAttribute('href', `${window.location.protocol}//kids.shop.localhost${port}/`)
    expect(kids).toHaveAttribute('target', '_blank')
    expect(within(card).getByRole('link', { name: /live demo of Vegan Market/ })).toBeInTheDocument()
    expect(within(card).queryByRole('link', { name: /live demo of Original look/ })).toBeNull()
    expect(within(card).queryByRole('link', { name: /live demo of Classic Shop/ })).toBeNull()
    // And in the preview.
    await user.click(within(card).getByRole('button', { name: 'Preview BerryKid Kids Store' }))
    expect(within(await screen.findByRole('dialog', { name: 'BerryKid Kids Store' })).getByRole('link', { name: /live demo/ })).toBeInTheDocument()
  })

  it('hides "See live demo" when the demo stores are turned off (production)', async () => {
    mock(MANAGE, { demos: 'off' })
    renderRoutes(routes, '/storefront/pages')
    const card = await screen.findByTestId('demo-looks')
    await waitFor(() => expect(within(card).getAllByRole('button', { name: /^Use (?!and)/ })).toHaveLength(5))
    expect(within(card).queryByRole('link', { name: /live demo/ })).toBeNull()
  })

  it('creates drafts for the chosen parts, then reviews and publishes them all', async () => {
    const user = userEvent.setup()
    const calls = mock(PUBLISH)
    renderRoutes(routes, '/storefront/pages')
    await user.click(await screen.findByRole('button', { name: 'Use Vegan Market' }))

    const dialog = await screen.findByRole('dialog', { name: 'Use Vegan Market?' })
    expect(dialog).toHaveTextContent('Your live shop stays the same until you publish')
    // The existing home page and the theme have unpublished changes: they'd be replaced.
    expect(within(dialog).getByTestId('demo-warning-home')).toHaveTextContent('Your unpublished changes here will be replaced.')
    expect(within(dialog).getByTestId('demo-warning-theme')).toBeInTheDocument()
    expect(within(dialog).queryByTestId('demo-warning-header')).toBeNull()
    for (const label of ['Colours & fonts', 'Home page', 'Header', 'Footer', 'Shop pages']) expect(within(dialog).getByRole('checkbox', { name: label })).toBeChecked()
    await user.click(within(dialog).getByRole('checkbox', { name: 'Footer' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save as draft' }))
    await waitFor(() => expect(calls.starts).toEqual([{ preset: 'vegan', body: { include: { theme: true, home: true, header: true, footer: false, listing_top: true } } }]))
    expect(calls.publishes).toEqual([])

    const review = await screen.findByTestId('demo-review')
    expect(within(review).getByRole('heading', { name: 'Your new look: Vegan Market' })).toBeInTheDocument()
    expect(within(review).getByRole('link', { name: 'Preview Home (opens in a new tab)' })).toHaveAttribute('href', 'https://shop.test/?preview=draft')
    expect(within(review).getByRole('link', { name: 'Preview Listing top (opens in a new tab)' })).toHaveAttribute('href', 'https://shop.test/shop?preview=draft')
    expect(within(review).getByRole('link', { name: 'Preview the colours and fonts (opens in a new tab)' })).toBeInTheDocument()
    expect(within(review).getByRole('link', { name: 'Edit Header' })).toHaveAttribute('href', '/storefront/builder/d-header')

    await user.click(within(review).getByRole('button', { name: 'Publish all' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Publish your new look?' })
    expect(confirm).toHaveTextContent('These 5 parts go live for customers right away.')
    await user.click(within(confirm).getByRole('button', { name: 'Publish all' }))
    await waitFor(() => expect(calls.publishes).toEqual([{ documents: ['d-home', 'd-header', 'd-footer', 'd-zone'], theme: true, note: 'Vegan Market demo look' }]))
    expect(await within(review).findByRole('heading', { name: 'Vegan Market is live on your shop' })).toBeInTheDocument()
    expect(within(review).getByRole('link', { name: /View your store/ })).toHaveAttribute('href', 'https://shop.test/')
  })

  it('the kids look and the original look start from their demo like the others', async () => {
    const user = userEvent.setup()
    const calls = mock(PUBLISH)
    renderRoutes(routes, '/storefront/pages')
    await user.click(await screen.findByRole('button', { name: 'Use BerryKid Kids Store' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Use BerryKid Kids Store?' })).getByRole('button', { name: 'Save as draft' }))
    expect(await screen.findByRole('heading', { name: 'Your new look: BerryKid Kids Store' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Done for now' }))

    await user.click(await screen.findByRole('button', { name: 'Use Original look' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Use Original look?' })).getByRole('button', { name: 'Save as draft' }))
    await waitFor(() => expect(calls.starts.map((s) => s.preset)).toEqual(['kids', 'default']))
    expect(calls.starts[1]!.body).toEqual({ include: { theme: true, home: true, header: true, footer: true, listing_top: true } })
  })

  it('one click: use and publish now asks first, then makes the drafts and publishes them', async () => {
    const user = userEvent.setup()
    const calls = mock(PUBLISH)
    renderRoutes(routes, '/storefront/pages')
    await user.click(await screen.findByRole('button', { name: 'Use BerryKid Kids Store' }))
    const dialog = await screen.findByRole('dialog', { name: 'Use BerryKid Kids Store?' })
    await user.click(within(dialog).getByRole('checkbox', { name: 'Shop pages' }))
    await user.click(within(dialog).getByRole('button', { name: 'Use and publish now' }))

    const confirm = await screen.findByRole('alertdialog', { name: 'Change your live shop now?' })
    expect(confirm).toHaveTextContent('Your live store will change to this look now. You can go back with Version history.')
    expect(calls.order).toEqual([])
    await user.click(within(confirm).getByRole('button', { name: 'Yes, publish now' }))

    await waitFor(() => expect(calls.order).toEqual(['start:kids', 'publish-all']))
    expect(calls.starts[0]!.body).toEqual({ include: { theme: true, home: true, header: true, footer: true, listing_top: false } })
    expect(calls.publishes).toEqual([{ documents: ['d-home', 'd-header', 'd-footer', 'd-zone'], theme: true, note: 'BerryKid Kids Store demo look' }])
    const review = await screen.findByTestId('demo-review')
    expect(within(review).getByRole('heading', { name: 'BerryKid Kids Store is live on your shop' })).toBeInTheDocument()
    expect(within(review).getByRole('link', { name: /View your store/ })).toHaveAttribute('href', 'https://shop.test/')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('one click from the preview: the confirm opens at once; cancelling it publishes nothing', async () => {
    const user = userEvent.setup()
    const calls = mock(PUBLISH)
    renderRoutes(routes, '/storefront/pages')
    await user.click(await screen.findByRole('button', { name: 'Preview Vegan Market' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Vegan Market' })).getByRole('button', { name: 'Use and publish now' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Change your live shop now?' })
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    // Back in the use dialog, nothing sent.
    expect(await screen.findByRole('dialog', { name: 'Use Vegan Market?' })).toBeInTheDocument()
    expect(calls.order).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Use and publish now' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Yes, publish now' }))
    await waitFor(() => expect(calls.order).toEqual(['start:vegan', 'publish-all']))
    expect(await screen.findByRole('heading', { name: 'Vegan Market is live on your shop' })).toBeInTheDocument()
  })

  it('without the publish permission: use and publish now is unavailable and says why; drafts still work', async () => {
    const user = userEvent.setup()
    mock(MANAGE, { themeChanges: false })
    renderRoutes(routes, '/storefront/pages')
    await user.click(await screen.findByRole('button', { name: 'Preview Vegan Market' }))
    const preview = await screen.findByRole('dialog', { name: 'Vegan Market' })
    expect(within(preview).getByRole('button', { name: 'Use and publish now' })).toBeDisabled()
    expect(preview).toHaveTextContent('Only people allowed to publish can do this.')
    await user.click(within(preview).getByRole('button', { name: 'Use this look' }))

    const dialog = await screen.findByRole('dialog', { name: 'Use Vegan Market?' })
    expect(within(dialog).queryByTestId('demo-warning-theme')).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Use and publish now' })).toBeDisabled()
    expect(within(dialog).getByTestId('publish-now-hint')).toHaveTextContent('Save it as a draft and ask them to publish it.')
    await user.click(within(dialog).getByRole('button', { name: 'Save as draft' }))
    const review = await screen.findByTestId('demo-review')
    expect(within(review).getByRole('button', { name: 'Publish all' })).toBeDisabled()
    expect(review).toHaveTextContent('Someone with permission to publish makes these drafts live.')
    await user.click(within(review).getByRole('button', { name: 'Done for now' }))
    expect(await screen.findByTestId('demo-looks')).toBeInTheDocument()
  })

  it('one click whose publishing fails leaves the drafts to review, with the reason', async () => {
    const user = userEvent.setup()
    const calls = mock(PUBLISH, { publishFails: true })
    renderRoutes(routes, '/storefront/pages')
    await user.click(await screen.findByRole('button', { name: 'Use Vegan Market' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Use Vegan Market?' })).getByRole('button', { name: 'Use and publish now' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Yes, publish now' }))
    const review = await screen.findByTestId('demo-review')
    expect(within(review).getByRole('heading', { name: 'Your new look: Vegan Market' })).toBeInTheDocument()
    expect(within(review).getByRole('alert')).toHaveTextContent('The look is saved as drafts, but publishing failed: The footer is empty.')
    expect(calls.order).toEqual(['start:vegan', 'publish-all'])
  })

  it('needs at least one part, and shows why publishing all failed', async () => {
    const user = userEvent.setup()
    mock(PUBLISH, { publishFails: true })
    renderRoutes(routes, '/storefront/pages')
    await user.click(await screen.findByRole('button', { name: 'Use Vegan Market' }))
    const dialog = await screen.findByRole('dialog', { name: 'Use Vegan Market?' })
    for (const label of ['Colours & fonts', 'Home page', 'Header', 'Footer', 'Shop pages']) await user.click(within(dialog).getByRole('checkbox', { name: label }))
    expect(within(dialog).getByRole('button', { name: 'Save as draft' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Use and publish now' })).toBeDisabled()
    await user.click(within(dialog).getByRole('checkbox', { name: 'Home page' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save as draft' }))

    const review = await screen.findByTestId('demo-review')
    await user.click(within(review).getByRole('button', { name: 'Publish all' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Publish all' }))
    expect(await within(review).findByRole('alert')).toHaveTextContent('The footer is empty.')
    expect(within(review).getByRole('heading', { name: 'Your new look: Vegan Market' })).toBeInTheDocument()
  })
})
