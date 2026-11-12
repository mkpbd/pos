import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { routes } from '@/app/routes'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes, fail } from '@/test/utils'
import type { DocumentSummary } from '../api'
import { liveUrl, slugify, slugProblem } from './page-helpers'

const manager = () => makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage'] })
const viewer = () => makeCurrentUser({ permissions: ['storefront.view'] })

const home: DocumentSummary = {
  id: 'd-home', kind: 'page', key: 'home', title: 'Home', schema_version: 1, draft_revision: 4, has_unpublished_changes: true,
  draft_updated_at: '2026-11-11T08:00:00+00:00', published: { version_id: 'v-3', number: 3, published_at: '2026-11-10T08:00:00+00:00' },
  path: '/', preview_url: 'https://shop.test/?preview=draft',
}
const landing: DocumentSummary = {
  ...home, id: 'd-eid', key: 'landing:eid-sale', title: 'Eid sale', has_unpublished_changes: true, published: null, path: '/p/eid-sale', preview_url: 'https://shop.test/p/eid-sale?preview=draft',
}

beforeEach(() => window.localStorage.clear())

describe('page builder: pages list', () => {
  it('shows the home page and landing pages with their status, edit and view links', async () => {
    mockApi({ 'GET /auth/me': ok(manager()), 'GET /storefront/builder/documents': ok([home, landing]) })
    renderRoutes(routes, '/storefront/pages')

    const homeRow = await screen.findByTestId('page-row-home')
    expect(within(homeRow).getByText(/Published v3/)).toBeInTheDocument()
    expect(within(homeRow).getByText('Unpublished changes')).toBeInTheDocument()
    expect(within(homeRow).getByRole('link', { name: 'Edit Home' })).toHaveAttribute('href', '/storefront/builder/d-home')
    expect(within(homeRow).getByRole('link', { name: /View Home/ })).toHaveAttribute('href', 'https://shop.test/')

    const landingRow = screen.getByTestId('page-row-landing:eid-sale')
    expect(within(landingRow).getByText('Not published')).toBeInTheDocument()
    expect(within(landingRow).getByText('/p/eid-sale')).toBeInTheDocument()
    expect(within(landingRow).queryByRole('link', { name: /View/ })).toBeNull()
    expect(screen.getByRole('link', { name: 'Page builder' })).toBeInTheDocument()
  })

  it('creates the home page from the current homepage and opens the editor', async () => {
    const user = userEvent.setup()
    let body: unknown
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/builder/documents': ok([]),
      'POST /storefront/builder/documents': (init) => {
        body = JSON.parse(String(init.body))
        return { status: 201, ...ok({ ...home, content: { schema_version: 1, sections: [] } }) }
      },
      'GET /storefront/builder/documents/d-home': ok({ ...home, content: { schema_version: 1, sections: [] } }),
      'GET /storefront/builder/elements': ok({ types: [], limits: {}, enums: {} }),
      'GET /storefront/builder/canvas-context': ok({ bootstrap: {}, store_url: null, locales: ['en'] }),
    })
    const { router } = renderRoutes(routes, '/storefront/pages')
    await user.click(await screen.findByRole('button', { name: 'Copy my current homepage' }))
    await waitFor(() => expect(body).toEqual({ kind: 'page', key: 'home', title: 'Home', from: 'homepage' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/storefront/builder/d-home'))
  })

  it('creates a landing page with a live address preview and validation', async () => {
    const user = userEvent.setup()
    let body: unknown
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/builder/documents': ok([home]),
      'POST /storefront/builder/documents': (init) => {
        body = JSON.parse(String(init.body))
        return body && (body as { key: string }).key === 'landing:taken' ? fail(409, 'DOCUMENT_EXISTS', 'Exists') : { status: 201, ...ok({ ...landing, content: { schema_version: 1, sections: [] } }) }
      },
    })
    renderRoutes(routes, '/storefront/pages')
    await user.click(await screen.findByRole('button', { name: 'New campaign page' }))
    const dialog = await screen.findByRole('dialog', { name: 'New campaign page' })
    await user.type(within(dialog).getByLabelText('Title'), 'Eid Sale 2026!')
    expect(within(dialog).getByText('/p/eid-sale-2026')).toBeInTheDocument()

    const address = within(dialog).getByLabelText('Address')
    await user.clear(address)
    await user.type(address, 'taken')
    await user.click(within(dialog).getByRole('button', { name: 'Create page' }))
    expect(await within(dialog).findByText(/already exists/)).toBeInTheDocument()

    await user.clear(address)
    await user.type(address, 'home')
    expect(within(dialog).getByText(/reserved for your front page/)).toBeInTheDocument()
  })

  it('deletes a landing page after confirming; viewers only see the list', async () => {
    const user = userEvent.setup()
    let deleted = false
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/builder/documents': () => ok(deleted ? [home] : [home, landing]),
      'DELETE /storefront/builder/documents/d-eid': () => {
        deleted = true
        return { status: 204 }
      },
    })
    renderRoutes(routes, '/storefront/pages')
    await user.click(await screen.findByRole('button', { name: 'Delete Eid sale' }))
    const confirm = await screen.findByRole('alertdialog')
    await user.click(within(confirm).getByRole('button', { name: 'Delete page' }))
    await waitFor(() => expect(screen.queryByTestId('page-row-landing:eid-sale')).toBeNull())
  })

  it('viewers see no edit or create actions', async () => {
    mockApi({ 'GET /auth/me': ok(viewer()), 'GET /storefront/builder/documents': ok([landing]) })
    renderRoutes(routes, '/storefront/pages')
    expect(await screen.findByText('Eid sale')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New campaign page' })).toBeNull()
    expect(screen.queryByRole('link', { name: /^Edit/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy my current homepage' })).toBeNull()
  })
})

describe('page helpers', () => {
  it('makes and checks landing addresses, and the live link', () => {
    expect(slugify('  Eid Sale — 50% off! ')).toBe('eid-sale-50-off')
    expect(slugProblem('a')).toMatch(/2–60/)
    expect(slugProblem('home')).toMatch(/reserved/)
    expect(slugProblem('eid-sale')).toBeNull()
    expect(liveUrl(landing)).toBe('https://shop.test/p/eid-sale')
    expect(liveUrl({ ...landing, preview_url: null })).toBeNull()
  })
})

/* ------------------------------------------------------------------------------------------------
 * B4: content pages, site parts, shop and product areas, products per row
 * ---------------------------------------------------------------------------------------------- */

const contentManager = () => makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage', 'storefront.publish', 'cms.manage'] })
const publisher = () => makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage', 'storefront.publish'] })
const ABOUT = '0b6f2e3c-1a2b-4c3d-8e9f-0123456789ab'
const FAQ = '1b6f2e3c-1a2b-4c3d-8e9f-0123456789ab'
const cmsPages = [
  { id: ABOUT, title: 'About us', slug: 'about', status: 'published', template: 'default' },
  { id: FAQ, title: 'Questions', slug: 'faq', status: 'draft', template: 'faq' },
]
const cmsList = ok(cmsPages, { pagination: { current_page: 1, per_page: 100, total: 2, last_page: 1 } })
const aboutDoc: DocumentSummary = {
  ...home, id: 'd-about', key: `cms:${ABOUT}`, title: 'About us', path: '/pages/about', preview_url: 'https://shop.test/pages/about?preview=draft',
  cms_page: { id: ABOUT, title: 'About us', slug: 'about', status: 'published', template: 'default' },
}
const footerDoc: DocumentSummary = { ...home, id: 'd-footer', kind: 'footer', key: 'footer', title: 'Footer', path: null, preview_url: null, has_unpublished_changes: false }
const zoneDoc: DocumentSummary = { ...home, id: 'd-top', kind: 'zone', key: 'zone:listing.top', title: 'Listing top', path: null, preview_url: null, published: null }
const themeDraft = (listing?: Record<string, number>) => ({
  settings: { colors: {}, typography: {}, shape: {}, layout: { container_width: 1170, sticky_header: true, ...(listing ? { listing_columns: listing } : {}) }, footer: {}, announcement: {} },
  draft_revision: 2, has_unpublished_changes: false, published: { number: 4, published_at: null }, custom_css: null, has_custom_css: false,
})
const editorMocks = {
  'GET /storefront/builder/elements': ok({ types: [], limits: {}, enums: {} }),
  'GET /storefront/builder/canvas-context': ok({ bootstrap: {}, store_url: null, locales: ['en'] }),
}

describe('page builder: B4 groups', () => {
  it('lists the three groups; content pages show design / edit / back to classic', async () => {
    mockApi({
      'GET /auth/me': ok(contentManager()),
      'GET /storefront/builder/documents': ok([home, aboutDoc, footerDoc, zoneDoc]),
      'GET /cms/pages': cmsList,
      'GET /storefront/theme/draft': ok(themeDraft()),
    })
    renderRoutes(routes, '/storefront/pages')

    expect(await screen.findByRole('heading', { name: 'Your pages', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Header & footer', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Shop pages', level: 2 })).toBeInTheDocument()

    const about = await screen.findByTestId(`page-row-cms:${ABOUT}`)
    expect(within(about).getByText(/Designed with the builder/)).toBeInTheDocument()
    expect(within(about).getByRole('link', { name: 'Edit design About us' })).toHaveAttribute('href', '/storefront/builder/d-about')
    expect(within(about).getByRole('button', { name: 'Back to the classic page for About us' })).toBeInTheDocument()

    const faq = screen.getByTestId(`page-row-cms:${FAQ}`)
    expect(within(faq).getByText('Page not published')).toBeInTheDocument()
    expect(within(faq).getByText(/FAQ page · Classic page/)).toBeInTheDocument()
    expect(within(faq).getByRole('button', { name: 'Design Questions with the builder' })).toBeInTheDocument()

    const header = screen.getByTestId('page-row-header')
    expect(within(header).getByText(/Using the standard header/)).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: 'Design the header' })).toBeInTheDocument()
    const footer = screen.getByTestId('page-row-footer')
    expect(within(footer).getByText(/Published v3/)).toBeInTheDocument()
    expect(within(footer).getByRole('link', { name: 'Edit the footer' })).toBeInTheDocument()
    expect(within(footer).getByRole('button', { name: 'Use the standard footer' })).toBeInTheDocument()

    expect(within(screen.getByTestId('page-row-zone:listing.top')).getByText('Not published')).toBeInTheDocument()
    expect(within(screen.getByTestId('page-row-zone:listing.top')).getByText('Top of shop pages')).toBeInTheDocument()
    expect(within(screen.getByTestId('page-row-zone:listing.bottom')).getByRole('button', { name: 'Add content: Bottom of shop pages' })).toBeInTheDocument()
    expect(within(screen.getByTestId('page-row-zone:product.after')).getByRole('button', { name: 'Add content: Under product details' })).toBeInTheDocument()
  })

  it('designs a CMS page with the builder (from: cms) and the header from the current one', async () => {
    const user = userEvent.setup()
    const bodies: unknown[] = []
    mockApi({
      'GET /auth/me': ok(contentManager()),
      'GET /storefront/builder/documents': ok([]),
      'GET /cms/pages': cmsList,
      'GET /storefront/theme/draft': ok(themeDraft()),
      'POST /storefront/builder/documents': (init) => {
        const body = JSON.parse(String(init.body)) as { key: string }
        bodies.push(body)
        return { status: 201, ...ok({ ...home, id: body.key === 'header' ? 'd-header' : 'd-faq', key: body.key, content: { schema_version: 1, sections: [] } }) }
      },
      ...editorMocks,
    })
    const { router } = renderRoutes(routes, '/storefront/pages')
    await user.click(await screen.findByRole('button', { name: 'Design Questions with the builder' }))
    await waitFor(() => expect(bodies[0]).toEqual({ kind: 'page', key: `cms:${FAQ}`, title: 'Questions', from: 'cms' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/storefront/builder/d-faq'))

    await router.navigate('/storefront/pages')
    await user.click(await screen.findByRole('button', { name: 'Design the header' }))
    await waitFor(() => expect(bodies[1]).toEqual({ kind: 'header', key: 'header', title: 'Header', from: 'current' }))
  })

  it('goes back to the classic page and to the theme footer after confirming; creates a zone blank', async () => {
    const user = userEvent.setup()
    const deleted: string[] = []
    let created: unknown
    const remove = (id: string) => () => {
      deleted.push(id)
      return { status: 204 }
    }
    mockApi({
      'GET /auth/me': ok(contentManager()),
      'GET /storefront/builder/documents': () => ok([aboutDoc, footerDoc].filter((d) => !deleted.includes(d.id))),
      'GET /cms/pages': cmsList,
      'GET /storefront/theme/draft': ok(themeDraft()),
      'DELETE /storefront/builder/documents/d-about': remove('d-about'),
      'DELETE /storefront/builder/documents/d-footer': remove('d-footer'),
      'POST /storefront/builder/documents': (init) => {
        created = JSON.parse(String(init.body))
        return { status: 201, ...ok({ ...zoneDoc, id: 'd-bottom', key: 'zone:listing.bottom', content: { schema_version: 1, sections: [] } }) }
      },
      ...editorMocks,
    })
    const { router } = renderRoutes(routes, '/storefront/pages')

    await user.click(await screen.findByRole('button', { name: 'Back to the classic page for About us' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Go back to the classic “About us” page?' })
    await user.click(within(confirm).getByRole('button', { name: 'Use the classic page' }))
    await waitFor(() => expect(within(screen.getByTestId(`page-row-cms:${ABOUT}`)).getByRole('button', { name: 'Design About us with the builder' })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Use the standard footer' }))
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Use the standard footer?' })).getByRole('button', { name: 'Use the standard footer' }))
    await waitFor(() => expect(within(screen.getByTestId('page-row-footer')).getByRole('button', { name: 'Design the footer' })).toBeInTheDocument())
    expect(deleted).toEqual(['d-about', 'd-footer'])

    await user.click(screen.getByRole('button', { name: 'Add content: Bottom of shop pages' }))
    await waitFor(() => expect(created).toEqual({ kind: 'zone', key: 'zone:listing.bottom', title: 'Listing bottom', from: 'blank' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/storefront/builder/d-bottom'))
  })

  it('without cms.manage, content pages come from the link targets; viewers get no actions', async () => {
    mockApi({
      'GET /auth/me': ok(viewer()),
      'GET /storefront/builder/documents': ok([footerDoc]),
      'GET /storefront/link-targets': ok({ pages: [{ id: ABOUT, title: 'About us', slug: 'about', status: 'published' }], categories: [], brands: [], blog_categories: [], blog_posts: [] }),
      'GET /storefront/theme/draft': ok(themeDraft()),
    })
    renderRoutes(routes, '/storefront/pages')
    expect(await screen.findByTestId(`page-row-cms:${ABOUT}`)).toHaveTextContent('/pages/about')
    expect(screen.queryByRole('link', { name: 'Manage pages' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Design/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /standard footer/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Add content/ })).toBeNull()
  })

  it('products per row: shows today’s grid by default, saves to the theme draft and publishes', async () => {
    const user = userEvent.setup()
    let put: { revision: number; settings: { layout: Record<string, unknown> } } | undefined
    let published = false
    mockApi({
      'GET /auth/me': ok(publisher()),
      'GET /storefront/builder/documents': ok([]),
      'GET /storefront/link-targets': ok({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }),
      'GET /storefront/theme/draft': ok(themeDraft()),
      'PUT /storefront/theme/draft': (init) => {
        put = JSON.parse(String(init.body)) as typeof put
        return ok({ ...themeDraft(put!.settings.layout.listing_columns as Record<string, number>), draft_revision: 3, has_unpublished_changes: true })
      },
      'POST /storefront/theme/publish': () => {
        published = true
        return ok(themeDraft({ desktop: 4, tablet: 3, mobile: 2 }))
      },
    })
    renderRoutes(routes, '/storefront/pages')
    const card = await screen.findByTestId('listing-columns')
    const desktop = await within(card).findByRole('combobox', { name: 'Products per row on computers' })
    expect(desktop).toHaveTextContent('3 products (standard)')
    expect(within(card).getByRole('combobox', { name: 'Products per row on phones' })).toHaveTextContent('2 products (standard)')
    expect(within(card).getByRole('button', { name: 'Save and publish' })).toBeDisabled()

    await user.click(desktop)
    await user.click(await screen.findByRole('option', { name: '4 products' }))
    await user.click(within(card).getByRole('button', { name: 'Save and publish' }))
    await waitFor(() => expect(published).toBe(true))
    expect(put).toMatchObject({ revision: 2, settings: { layout: { container_width: 1170, listing_columns: { desktop: 4, tablet: 3, mobile: 2 } } } })
  })
})
