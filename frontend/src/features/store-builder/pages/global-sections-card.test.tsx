import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { routes } from '@/app/routes'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import type { GlobalSummary } from '../global-api'

/*
 * B9: the "Global sections" group of the Page builder start screen: what each is for, where it is
 * used, Edit, Delete only when unused (else the pages to clear first, also on 409), and Bangla.
 */

const manager = () => makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage'] })

const base = { kind: 'global' as const, schema_version: 1, draft_revision: 2, has_unpublished_changes: false, draft_updated_at: '2026-11-11T08:00:00+00:00', path: null, preview_url: null }
const strip: GlobalSummary = {
  ...base, id: 'g-strip', key: 'global:g-strip', title: 'Delivery strip', context: 'page',
  published: { version_id: 'v-1', number: 1, published_at: '2026-11-10T08:00:00+00:00' },
  usage_count: 2, used_in: [{ id: 'doc-home', title: 'Home', kind: 'page', key: 'home' }, { id: 'doc-about', title: 'About us', kind: 'page', key: 'cms:x' }],
}
const unused: GlobalSummary = { ...base, id: 'g-old', key: 'global:g-old', title: 'Old banner row', context: 'footer', published: null, usage_count: 0, used_in: [] }

beforeEach(() => window.localStorage.clear())

describe('page builder: global sections', () => {
  it('lists global sections with where they are used; deletes an unused one after confirming', async () => {
    const user = userEvent.setup()
    let deleted = ''
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/builder/documents': ok([]),
      'GET /storefront/builder/globals': ok([strip, unused]),
      'DELETE /storefront/builder/documents/g-old': () => {
        deleted = 'g-old'
        return { status: 204 }
      },
    })
    renderRoutes(routes, '/storefront/pages')
    const list = await screen.findByRole('list', { name: 'Global sections' })
    const row = within(list).getByTestId('global-row-g-strip')
    expect(row).toHaveTextContent('Delivery strip')
    expect(row).toHaveTextContent('For pages')
    expect(row).toHaveTextContent('Used on 2 pages: Home, About us')
    expect(within(row).getByRole('link', { name: /Edit.*Delivery strip/ })).toHaveAttribute('href', '/storefront/builder/g-strip')
    const old = within(list).getByTestId('global-row-g-old')
    expect(old).toHaveTextContent('For the footer')
    expect(old).toHaveTextContent('Not used on any page yet')

    await user.click(within(old).getByRole('button', { name: 'Delete Old banner row' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete “Old banner row”?' })
    await user.click(within(confirm).getByRole('button', { name: 'Delete global section' }))
    await waitFor(() => expect(deleted).toBe('g-old'))
  })

  it('a global section in use can’t be deleted: the pages to clear first are listed (also when the server says so)', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/builder/documents': ok([]),
      'GET /storefront/builder/globals': ok([strip, unused]),
      'DELETE /storefront/builder/documents/g-old': fail(409, 'GLOBAL_IN_USE', 'In use', { used_in: [{ id: 'doc-new', title: 'Eid sale', kind: 'page', key: 'landing:eid' }] }),
    })
    renderRoutes(routes, '/storefront/pages')
    const list = await screen.findByRole('list', { name: 'Global sections' })
    await user.click(within(within(list).getByTestId('global-row-g-strip')).getByRole('button', { name: 'Delete Delivery strip' }))
    const inUse = await screen.findByRole('dialog', { name: '“Delivery strip” is still in use' })
    expect(within(inUse).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/storefront/builder/doc-home')
    await user.click(within(inUse).getAllByRole('button', { name: 'Close' })[0]!)

    // Used since the list was loaded: the server's 409 lists the page.
    await user.click(within(within(list).getByTestId('global-row-g-old')).getByRole('button', { name: 'Delete Old banner row' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete global section' }))
    const server = await screen.findByRole('dialog', { name: '“Old banner row” is still in use' })
    expect(within(server).getByRole('link', { name: 'Eid sale' })).toBeInTheDocument()
  })

  it('speaks Bangla on the Bangla screen', async () => {
    window.localStorage.setItem('pos.storeBuilder.pagesLang', 'bn')
    mockApi({ 'GET /auth/me': ok(manager()), 'GET /storefront/builder/documents': ok([]), 'GET /storefront/builder/globals': ok([strip]) })
    renderRoutes(routes, '/storefront/pages')
    expect(await screen.findByRole('heading', { name: 'গ্লোবাল সেকশন' })).toBeInTheDocument()
    expect(await screen.findByTestId('global-row-g-strip')).toHaveTextContent('২টি পেজে ব্যবহার হচ্ছে: Home, About us')
    expect(screen.getByTestId('global-row-g-strip')).toHaveTextContent('পেজের জন্য')
  })

  it('says how to make one when there are none', async () => {
    mockApi({ 'GET /auth/me': ok(manager()), 'GET /storefront/builder/documents': ok([]), 'GET /storefront/builder/globals': ok([]) })
    renderRoutes(routes, '/storefront/pages')
    expect(await screen.findByText(/No global sections yet/)).toBeInTheDocument()
  })
})
