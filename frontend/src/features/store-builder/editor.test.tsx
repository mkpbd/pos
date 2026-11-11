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
