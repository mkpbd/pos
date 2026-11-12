import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { routes } from '@/app/routes'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import type { DocumentSummary } from '../api'

/*
 * B8b: the "Popups & bars" group of the Page builder start screen: the list with layout, status
 * and on / off switch, a new popup from a template, delete with confirm, and the Bangla words.
 */

const publisher = () => makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage', 'storefront.publish'] })
const manager = () => makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage'] })

const base = {
  kind: 'popup' as const, schema_version: 1, draft_revision: 2, has_unpublished_changes: false, draft_updated_at: '2026-11-11T08:00:00+00:00', path: null, cms_page: null,
}
const newsletter: DocumentSummary = {
  ...base, id: 'p-news', key: 'popup:p-news', title: 'Newsletter', active: true, status: 'live',
  published: { version_id: 'v-1', number: 1, published_at: '2026-11-10T08:00:00+00:00' }, preview_url: 'https://shop.test/?preview=draft&popup=p-news',
  popup: { layout: 'modal', trigger: 'on_load', starts_at: null, ends_at: null },
}
const bar: DocumentSummary = {
  ...base, id: 'p-bar', key: 'popup:p-bar', title: 'Free delivery bar', active: false, status: 'draft', published: null, preview_url: null,
  popup: { layout: 'bar_top', trigger: 'on_load', starts_at: null, ends_at: null },
}

const templates = [
  { id: 'popup-newsletter', scope: 'popup', preset: null, category: 'popup', name: 'Newsletter popup', description: 'Server words', thumbnail_url: null, allowed_in: ['popup'], source: 'builtin' },
  { id: 'popup-free-delivery-bar', scope: 'popup', preset: null, category: 'popup', name: 'Free delivery bar', description: null, thumbnail_url: null, allowed_in: ['popup'], source: 'builtin' },
]

const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: toastError, success: toastSuccess }) }
})

beforeEach(() => {
  window.localStorage.clear()
  toastSuccess.mockReset()
  toastError.mockReset()
})

describe('page builder: popups & bars', () => {
  it('lists popups with their layout, status and on / off switch; never-published ones can’t be switched on', async () => {
    mockApi({ 'GET /auth/me': ok(publisher()), 'GET /storefront/builder/documents': ok([newsletter, bar]) })
    renderRoutes(routes, '/storefront/pages')
    const group = await screen.findByRole('region', { name: 'Popups & bars' })
    const list = within(group).getByRole('list', { name: 'Popups and bars' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows.map((r) => within(r).getByText(/Newsletter|Free delivery bar/).textContent?.trim())).toEqual(['Free delivery bar', 'Newsletter'])

    const news = screen.getByTestId('popup-row-p-news')
    expect(within(news).getByTestId('popup-status')).toHaveTextContent('Live')
    expect(within(news).getByText(/Popup in the middle · Shows when a page opens/)).toBeInTheDocument()
    expect(within(news).getByRole('switch', { name: 'Show Newsletter on your shop' })).toBeChecked()
    expect(within(news).getByRole('link', { name: /Preview: Newsletter/ })).toHaveAttribute('href', 'https://shop.test/?preview=draft&popup=p-news')
    expect(within(news).getByRole('link', { name: 'Edit Newsletter' })).toHaveAttribute('href', '/storefront/builder/p-news')

    const barRow = screen.getByTestId('popup-row-p-bar')
    expect(within(barRow).getByTestId('popup-status')).toHaveTextContent('Not published')
    expect(within(barRow).getByText(/Bar at the top/)).toBeInTheDocument()
    expect(within(barRow).getByRole('switch', { name: 'Show Free delivery bar on your shop' })).toBeDisabled()
    expect(within(barRow).getByText('Publish it first, then switch it on.', { selector: 'p' })).toBeInTheDocument()
  })

  it('switches a popup off; a refusal shows the server’s words', async () => {
    const user = userEvent.setup()
    const bodies: unknown[] = []
    let refuse = false
    mockApi({
      'GET /auth/me': ok(publisher()),
      'GET /storefront/builder/documents': ok([newsletter]),
      'PATCH /storefront/builder/documents/p-news': (init) => {
        bodies.push(JSON.parse(String(init.body)))
        return refuse ? fail(422, 'POPUP_NOT_PUBLISHED', 'Publish this popup before switching it on.') : ok({ ...newsletter, active: false, status: 'off' })
      },
    })
    renderRoutes(routes, '/storefront/pages')
    const toggle = await screen.findByRole('switch', { name: 'Show Newsletter on your shop' })
    await user.click(toggle)
    await waitFor(() => expect(bodies).toEqual([{ active: false }]))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Newsletter is switched off. Shoppers no longer see it.'))
    refuse = true
    await user.click(toggle)
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Publish this popup before switching it on.'))
  })

  it('without publish permission the switch is read only', async () => {
    mockApi({ 'GET /auth/me': ok(manager()), 'GET /storefront/builder/documents': ok([newsletter]) })
    renderRoutes(routes, '/storefront/pages')
    expect(await screen.findByRole('switch', { name: 'Show Newsletter on your shop' })).toBeDisabled()
    expect(screen.getByText('Only people allowed to publish can switch it on or off.', { selector: 'p' })).toBeInTheDocument()
  })

  it('creates a popup from a template (the name follows the choice) and opens the editor', async () => {
    const user = userEvent.setup()
    let body: unknown
    mockApi({
      'GET /auth/me': ok(publisher()),
      'GET /storefront/builder/documents': ok([]),
      'GET /storefront/builder/templates': ok(templates),
      'POST /storefront/builder/documents': (init) => {
        body = JSON.parse(String(init.body))
        return { status: 201, ...ok({ ...bar, id: 'p-new', content: { schema_version: 1, sections: [] } }) }
      },
      'GET /storefront/builder/documents/p-new': ok({ ...bar, id: 'p-new', content: { schema_version: 1, sections: [] } }),
      'GET /storefront/builder/elements': ok({ types: [], limits: {}, enums: {} }),
      'GET /storefront/builder/canvas-context': ok({ bootstrap: {}, store_url: null, locales: ['en'] }),
    })
    const { router } = renderRoutes(routes, '/storefront/pages')
    expect(await screen.findByText(/No popups or bars yet/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'New popup or bar' }))
    const dialog = await screen.findByRole('dialog', { name: 'New popup or bar' })
    await user.click(await within(dialog).findByRole('radio', { name: /Newsletter popup/ }))
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Newsletter popup')
    expect(within(dialog).getByText('Asks for an email address after 8 seconds, at most once a week.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Create and edit' }))
    await waitFor(() => expect(body).toEqual({ kind: 'popup', title: 'Newsletter popup', template: 'popup-newsletter' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/storefront/builder/p-new'))
  })

  it('an empty popup needs a name', async () => {
    const user = userEvent.setup()
    let body: unknown
    mockApi({
      'GET /auth/me': ok(publisher()),
      'GET /storefront/builder/documents': ok([]),
      'GET /storefront/builder/templates': ok([]),
      'POST /storefront/builder/documents': (init) => {
        body = JSON.parse(String(init.body))
        return { status: 201, ...ok({ ...bar, content: { schema_version: 1, sections: [] } }) }
      },
    })
    renderRoutes(routes, '/storefront/pages')
    await user.click(await screen.findByRole('button', { name: 'New popup or bar' }))
    const dialog = await screen.findByRole('dialog', { name: 'New popup or bar' })
    expect(within(dialog).getByRole('radio', { name: /Empty popup/ })).toBeChecked()
    await user.click(within(dialog).getByRole('button', { name: 'Create and edit' }))
    expect(within(dialog).getByText('Enter a name.')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Name'), 'Eid offer')
    await user.click(within(dialog).getByRole('button', { name: 'Create and edit' }))
    await waitFor(() => expect(body).toEqual({ kind: 'popup', title: 'Eid offer', template: null }))
  })

  it('deletes a popup after confirming', async () => {
    const user = userEvent.setup()
    let deleted = false
    mockApi({
      'GET /auth/me': ok(publisher()),
      'GET /storefront/builder/documents': ok([newsletter]),
      'DELETE /storefront/builder/documents/p-news': () => {
        deleted = true
        return { status: 204 }
      },
    })
    renderRoutes(routes, '/storefront/pages')
    await user.click(await screen.findByRole('button', { name: 'Delete Newsletter' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete “Newsletter”?' })
    await user.click(within(confirm).getByRole('button', { name: 'Delete popup' }))
    await waitFor(() => expect(deleted).toBe(true))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Popup deleted.'))
  })

  it('speaks Bangla on the Bangla screen', async () => {
    window.localStorage.setItem('pos.storeBuilder.pagesLang', 'bn')
    mockApi({ 'GET /auth/me': ok(publisher()), 'GET /storefront/builder/documents': ok([newsletter]) })
    renderRoutes(routes, '/storefront/pages')
    expect(await screen.findByRole('region', { name: 'পপআপ ও বার' })).toBeInTheDocument()
    const row = screen.getByTestId('popup-row-p-news')
    expect(within(row).getByTestId('popup-status')).toHaveTextContent('লাইভ')
    expect(within(row).getByText(/মাঝখানে পপআপ · পেজ খুললেই দেখায়/)).toBeInTheDocument()
    expect(within(row).getByRole('switch', { name: 'Newsletter দোকানে দেখান' })).toBeInTheDocument()
  })
})
