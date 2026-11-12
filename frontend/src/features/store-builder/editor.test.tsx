import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { routes } from '@/app/routes'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import { cloneSample } from '@/storefront/builder/test-payload'
import { bootstrapFixture } from '@/storefront/test-fixtures'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import { detail } from './test-helpers'

function mockEditor(permissions = ['storefront.view', 'storefront.manage', 'storefront.publish']) {
  const puts: { revision: number }[] = []
  mockApi({
    'GET /auth/me': ok(makeCurrentUser({ permissions })),
    'GET /storefront/builder/documents/doc-1': ok(detail(cloneSample(), 3)),
    'GET /storefront/builder/elements': ok({ types: ELEMENT_REGISTRY, limits: {}, enums: {} }),
    'GET /storefront/builder/canvas-context': ok({ bootstrap: bootstrapFixture(), store_url: 'https://shop.test', locales: ['en'] }),
    'POST /storefront/builder/resolve': ok({ data: {}, media: {}, errors: {} }),
    'GET /storefront/link-targets': ok({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }),
    'PUT /storefront/builder/documents/doc-1/draft': (init) => {
      const body = JSON.parse(String(init.body)) as { revision: number; content: unknown }
      puts.push(body)
      return ok({ ...detail(cloneSample(), body.revision + 1) })
    },
  })
  return puts
}

describe('store builder editor', () => {
  it('adds an element with a click, deletes it after confirming, and undoes the delete', async () => {
    const user = userEvent.setup()
    mockEditor()
    renderRoutes(routes, '/storefront/builder/doc-1')

    expect(await screen.findByTitle(/Page canvas/)).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Layers' }))
    const tree = screen.getByRole('tree', { name: 'Page layers' })
    await user.click(within(tree).getByRole('button', { name: /^Heading.*Made fresh/ }))
    await user.click(screen.getByRole('tab', { name: 'Add' }))
    await user.click(screen.getByRole('button', { name: 'Add Divider' }))

    await user.click(screen.getByRole('tab', { name: 'Layers' }))
    const rows = within(screen.getByRole('tree')).getAllByRole('treeitem').map((row) => row.getAttribute('aria-label'))
    const at = rows.indexOf('Heading: Made fresh every morning')
    expect(rows[at + 1]).toBe('Divider')
    expect(within(screen.getByRole('tree')).getByRole('treeitem', { name: 'Divider', selected: true })).toBeInTheDocument()
    const dividers = () => within(screen.getByRole('tree')).queryAllByRole('treeitem', { name: 'Divider' }).length
    expect(dividers()).toBe(2)

    // Delete (keyboard) asks first; undo brings it back.
    await user.keyboard('{Delete}')
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete this divider?' })
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(dividers()).toBe(1))
    const undo = within(screen.getByRole('banner', { name: 'Editor toolbar' })).getByRole('button', { name: 'Undo' })
    await user.click(undo)
    await waitFor(() => expect(dividers()).toBe(2))
  })

  it('publish needs the publish permission; preview is offered with a store address', async () => {
    mockEditor(['storefront.view', 'storefront.manage'])
    renderRoutes(routes, '/storefront/builder/doc-1')
    const toolbar = await screen.findByRole('banner', { name: 'Editor toolbar' })
    expect(within(toolbar).getByRole('button', { name: 'Publish' })).toBeDisabled()
    expect(within(toolbar).getByRole('button', { name: 'Preview draft' })).toBeEnabled()
    expect(within(toolbar).getByRole('textbox', { name: 'Page title' })).toHaveValue('Home')
  })

  it('renames the page inline', async () => {
    const user = userEvent.setup()
    mockEditor()
    let patched: unknown
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    const original = fetchMock.getMockImplementation() as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if (init.method === 'PATCH') {
        patched = JSON.parse(String(init.body))
        return new Response(JSON.stringify({ success: true, data: { ...detail(), title: 'Front page' }, meta: { request_id: 't' } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return original(input, init)
    })
    renderRoutes(routes, '/storefront/builder/doc-1')
    const title = await screen.findByRole('textbox', { name: 'Page title' })
    await user.clear(title)
    await user.type(title, 'Front page{Enter}')
    await waitFor(() => expect(patched).toEqual({ title: 'Front page' }))
    expect(title).toHaveValue('Front page')
  })
})

/* ------------------------------------------------------------------------------------------------
 * B4: per-kind editor
 * ---------------------------------------------------------------------------------------------- */

function mockKind(doc: Partial<ReturnType<typeof detail>>, permissions = ['storefront.view', 'storefront.manage', 'storefront.publish']) {
  mockApi({
    'GET /auth/me': ok(makeCurrentUser({ permissions })),
    'GET /storefront/builder/documents/doc-1': ok({ ...detail({ schema_version: 1, sections: [] }, 1), ...doc }),
    'GET /storefront/builder/elements': ok({ types: ELEMENT_REGISTRY, limits: {}, enums: {} }),
    'GET /storefront/builder/canvas-context': ok({ bootstrap: bootstrapFixture(), store_url: 'https://shop.test', locales: ['en'] }),
    'POST /storefront/builder/resolve': ok({ data: {}, media: {}, errors: {} }),
    'GET /storefront/link-targets': ok({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }),
  })
}

const addable = () => screen.queryAllByRole('button', { name: /^Add / }).map((b) => b.getAttribute('data-testid'))

describe('store builder editor: document kinds (B4)', () => {
  it('a header shows where it sits and offers only header elements', async () => {
    mockKind({ kind: 'header', key: 'header', title: 'Header', path: null, preview_url: null })
    renderRoutes(routes, '/storefront/builder/doc-1')
    expect(await screen.findByTestId('document-placement')).toHaveTextContent('Shown at the top of every page. On phones the store uses its compact header.')
    const types = addable()
    expect(types).toEqual(expect.arrayContaining(['add-logo', 'add-menu', 'add-cart_icon', 'add-account_link', 'add-search_box', 'add-announcement', 'add-heading']))
    expect(types).not.toContain('add-hero_slider')
    expect(types).not.toContain('add-copyright')
    expect(types).not.toContain('add-faq_list')
    expect(screen.getByRole('complementary', { name: 'Inspector' })).toHaveTextContent('Header')
  })

  it('a footer offers copyright and payment icons; a zone explains where it shows', async () => {
    mockKind({ kind: 'footer', key: 'footer', title: 'Footer', path: null, preview_url: null })
    const first = renderRoutes(routes, '/storefront/builder/doc-1')
    expect(await screen.findByTestId('document-placement')).toHaveTextContent('Shown at the bottom of every page')
    expect(addable()).toEqual(expect.arrayContaining(['add-copyright', 'add-payment_icons', 'add-newsletter_form', 'add-menu']))
    expect(addable()).not.toContain('add-cart_icon')
    first.unmount()

    mockKind({ kind: 'zone', key: 'zone:listing.top', title: 'Listing top', path: null, preview_url: null })
    renderRoutes(routes, '/storefront/builder/doc-1')
    expect(await screen.findByTestId('document-placement')).toHaveTextContent('Above the product grid on shop, category, brand and search pages.')
    expect(addable()).toEqual(expect.arrayContaining(['add-cta', 'add-video', 'add-product_grid']))
    expect(addable()).not.toContain('add-logo')
    expect(addable()).not.toContain('add-contact_form')
  })

  it('a CMS page offers the FAQ list and contact form; home pages do not', async () => {
    mockKind({ key: 'cms:0b6f2e3c-1a2b-4c3d-8e9f-0123456789ab', title: 'FAQ', path: '/pages/faq' })
    const first = renderRoutes(routes, '/storefront/builder/doc-1')
    await screen.findByTestId('store-builder-editor')
    await waitFor(() => expect(addable()).toEqual(expect.arrayContaining(['add-faq_list', 'add-contact_form', 'add-video'])))
    expect(screen.queryByTestId('document-placement')).toBeNull()
    first.unmount()

    mockKind({})
    renderRoutes(routes, '/storefront/builder/doc-1')
    await screen.findByTestId('store-builder-editor')
    await waitFor(() => expect(addable()).toContain('add-video'))
    expect(addable()).not.toContain('add-faq_list')
  })

  it('custom HTML is greyed out without its permission', async () => {
    const user = userEvent.setup()
    mockKind({})
    renderRoutes(routes, '/storefront/builder/doc-1')
    const item = await screen.findByTestId('add-custom_html')
    expect(item).toHaveAttribute('aria-disabled', 'true')
    await user.hover(item)
    expect((await screen.findAllByText(/Only people allowed to use custom HTML can add or copy it/)).length).toBeGreaterThan(0)
    // A click adds nothing.
    await user.click(item)
    expect(within(screen.getByRole('banner', { name: 'Editor toolbar' })).getByRole('button', { name: 'Undo' })).toBeDisabled()
  })

  it('custom HTML can be added with the permission', async () => {
    mockKind({}, ['storefront.view', 'storefront.manage', 'storefront.custom_html'])
    renderRoutes(routes, '/storefront/builder/doc-1')
    expect(await screen.findByTestId('add-custom_html')).not.toHaveAttribute('aria-disabled')
  })
})
