import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { routes } from '@/app/routes'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import type { DocumentSummary } from '../api'

const publisher = () => makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage', 'storefront.publish'] })
const manager = () => makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage'] })
const viewer = () => makeCurrentUser({ permissions: ['storefront.view'] })

const category: DocumentSummary = {
  id: 'd-cat', kind: 'page', key: 'template:category', title: 'Category page', template: 'category', schema_version: 1, draft_revision: 2, has_unpublished_changes: false,
  draft_updated_at: '2026-11-18T08:00:00+00:00', published: { version_id: 'v-1', number: 1, published_at: '2026-11-18T08:00:00+00:00' }, path: null, preview_url: null,
}
const shopDraft: DocumentSummary = { ...category, id: 'd-shop', key: 'template:shop', title: 'Shop page', template: 'shop', published: null, has_unpublished_changes: true, preview_url: 'https://shop.test/shop?preview=draft' }

beforeEach(() => window.localStorage.clear())

describe('page builder: store pages (B14)', () => {
  it('lists the seven store pages with their state; the standard page where there is no design', async () => {
    mockApi({ 'GET /auth/me': ok(publisher()), 'GET /storefront/builder/documents': ok([category, shopDraft]) })
    renderRoutes(routes, '/storefront/pages')

    const group = await screen.findByRole('region', { name: 'Store pages' })
    const rows = within(group).getAllByTestId(/^store-page-row-/)
    expect(rows.map((r) => r.dataset.testid)).toEqual([
      'store-page-row-shop',
      'store-page-row-category',
      'store-page-row-brand',
      'store-page-row-search',
      'store-page-row-blog_post',
      'store-page-row-order',
      'store-page-row-not_found',
    ])

    const shop = screen.getByTestId('store-page-row-shop')
    expect(within(shop).getByText('Not published')).toBeInTheDocument()
    expect(within(shop).getByText(/Shoppers see the standard page until you publish/)).toBeInTheDocument()
    expect(within(shop).getByRole('link', { name: 'Edit Shop' })).toHaveAttribute('href', '/storefront/builder/d-shop')
    expect(within(shop).queryByRole('button', { name: /Use the standard page/ })).toBeNull()

    const cat = screen.getByTestId('store-page-row-category')
    expect(within(cat).getByText(/Published v1/)).toBeInTheDocument()
    expect(within(cat).getByText(/Shoppers see your design/)).toBeInTheDocument()
    expect(within(cat).getByRole('button', { name: 'Use the standard page: Category pages' })).toBeInTheDocument()

    const order = screen.getByTestId('store-page-row-order')
    expect(within(order).getByText('Standard page')).toBeInTheDocument()
    expect(within(order).getByRole('button', { name: 'Design this page: Order / thank you' })).toBeInTheDocument()
  })

  it('designs a store page from the ready design and opens the editor', async () => {
    const user = userEvent.setup()
    let body: unknown
    const created = { ...category, id: 'd-brand', key: 'template:brand', title: 'Brand page', template: 'brand', published: null, content: { schema_version: 1, sections: [] } }
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/builder/documents': ok([]),
      'POST /storefront/builder/documents': (init) => {
        body = JSON.parse(String(init.body))
        return { status: 201, ...ok(created) }
      },
      'GET /storefront/builder/documents/d-brand': ok(created),
      'GET /storefront/builder/elements': ok({ types: [], limits: {}, enums: {} }),
      'GET /storefront/builder/canvas-context': ok({ bootstrap: {}, store_url: null, locales: ['en'] }),
    })
    const { router } = renderRoutes(routes, '/storefront/pages')
    await user.click(await screen.findByRole('button', { name: 'Design this page: Brand pages' }))
    await waitFor(() => expect(body).toEqual({ kind: 'page', key: 'template:brand', title: 'Brand page', from: 'starter' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/storefront/builder/d-brand'))
  })

  it('starts an empty design', async () => {
    const user = userEvent.setup()
    let body: unknown
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/builder/documents': ok([]),
      'POST /storefront/builder/documents': (init) => {
        body = JSON.parse(String(init.body))
        return { status: 201, ...ok({ ...category, id: 'd-404', key: 'template:not_found', content: { schema_version: 1, sections: [] } }) }
      },
    })
    renderRoutes(routes, '/storefront/pages')
    await user.click(await screen.findByRole('button', { name: 'Start an empty design: Page not found' }))
    await waitFor(() => expect(body).toEqual({ kind: 'page', key: 'template:not_found', title: 'Page not found', from: 'blank' }))
  })

  it('goes back to the standard page after a confirmation', async () => {
    const user = userEvent.setup()
    let unpublished = false
    mockApi({
      'GET /auth/me': ok(publisher()),
      'GET /storefront/builder/documents': () => ok(unpublished ? [{ ...category, published: null }] : [category]),
      'POST /storefront/builder/documents/d-cat/unpublish': () => {
        unpublished = true
        return ok({ ...category, published: null, content: { schema_version: 1, sections: [] } })
      },
    })
    renderRoutes(routes, '/storefront/pages')
    await user.click(await screen.findByRole('button', { name: 'Use the standard page: Category pages' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Use the standard page for “Category pages”?' })
    expect(within(dialog).getByText(/Your design stays as a draft/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Use the standard page' }))
    await waitFor(() => expect(unpublished).toBe(true))
    await waitFor(() => expect(within(screen.getByTestId('store-page-row-category')).getByText('Not published')).toBeInTheDocument())
  })

  it('shows no actions to people who may only look', async () => {
    mockApi({ 'GET /auth/me': ok(viewer()), 'GET /storefront/builder/documents': ok([category]) })
    renderRoutes(routes, '/storefront/pages')
    const row = await screen.findByTestId('store-page-row-brand')
    expect(within(row).queryByRole('button')).toBeNull()
    expect(within(screen.getByTestId('store-page-row-category')).queryByRole('button', { name: /Use the standard page/ })).toBeNull()
  })

  it('switches to Bangla', async () => {
    const user = userEvent.setup()
    mockApi({ 'GET /auth/me': ok(manager()), 'GET /storefront/builder/documents': ok([]) })
    renderRoutes(routes, '/storefront/pages')
    await screen.findByRole('region', { name: 'Store pages' })
    await user.click(screen.getByRole('button', { name: 'বাংলা' }))
    expect(await screen.findByRole('region', { name: 'দোকানের পেজ' })).toBeInTheDocument()
    expect(within(screen.getByTestId('store-page-row-order')).getByText('অর্ডার / ধন্যবাদ')).toBeInTheDocument()
  })
})
