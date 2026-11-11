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
    await user.click(await screen.findByRole('button', { name: 'New landing page' }))
    const dialog = await screen.findByRole('dialog', { name: 'New landing page' })
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
    expect(screen.queryByRole('button', { name: 'New landing page' })).toBeNull()
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
