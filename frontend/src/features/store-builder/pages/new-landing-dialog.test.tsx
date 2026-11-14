import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { routes } from '@/app/routes'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import type { DocumentSummary } from '../api'
import { isLandingTemplate, templateNeedsProduct, type BuilderTemplate } from '../templates/api'

/*
 * P2a: "New campaign page" from a landing page template — the ready-made pages with their
 * pictures, an order template's product (the page is named after it until a name is typed), the
 * address, and the server's answers; Bangla words for the built-in templates.
 */

const manager = () => makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage'] })
const HONEY = '0b6f2e3c-1a2b-4c3d-8e9f-0123456789ab'

const template = (id: string, name: string, requires: string[], extra: Partial<BuilderTemplate> = {}): BuilderTemplate => ({
  id, scope: 'page', preset: null, category: 'landing', name, description: `${name} description`, thumbnail_url: null, preview_url: null, allowed_in: ['page'], requires, source: 'builtin', ...extra,
})
const TEMPLATES: BuilderTemplate[] = [
  template('landing-order', 'Single product order page', ['product'], { thumbnail_url: '/builder-templates/landing-order.png' }),
  template('landing-eid-sale', 'Eid / sale campaign', ['product', 'promotions']),
  template('landing-new-arrival', 'New arrival launch', ['product']),
  template('landing-lead', 'Lead / contact campaign', []),
  // Other page templates are for the editor's Templates tab, not for new campaign pages.
  template('page-about', 'About us', [], { category: 'about' }),
]

const created: DocumentSummary = {
  id: 'd-honey', kind: 'page', key: 'landing:sundarban-honey-500-g', title: 'Sundarban honey 500 g', schema_version: 1, draft_revision: 1, has_unpublished_changes: true,
  draft_updated_at: '2026-11-14T08:00:00+00:00', published: null, path: '/p/sundarban-honey-500-g', preview_url: null,
}

function mockScreen(post: (body: Record<string, unknown>) => ReturnType<typeof ok>) {
  const bodies: Record<string, unknown>[] = []
  const fetchMock = mockApi({
    'GET /auth/me': ok(manager()),
    'GET /storefront/builder/documents': ok([]),
    'GET /storefront/builder/templates': ok(TEMPLATES),
    'GET /products': ok([{ id: HONEY, name: 'Sundarban honey 500 g', variants: [{ sku: 'HN-500' }], images: [], is_active: true }], { pagination: { current_page: 1, per_page: 24, total: 1, last_page: 1 } }),
    'POST /storefront/builder/documents': (init) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      bodies.push(body)
      return post(body)
    },
    'GET /storefront/builder/documents/d-honey': ok({ ...created, content: { schema_version: 1, sections: [] } }),
    'GET /storefront/builder/elements': ok({ types: [], limits: {}, enums: {} }),
    'GET /storefront/builder/canvas-context': ok({ bootstrap: {}, store_url: null, locales: ['en'] }),
  })
  return { bodies, fetchMock }
}

beforeEach(() => window.localStorage.clear())

describe('new campaign page from a template', () => {
  it('recognises landing templates and the ones that sell a product', () => {
    expect(TEMPLATES.filter(isLandingTemplate).map((t) => t.id)).toEqual(['landing-order', 'landing-eid-sale', 'landing-new-arrival', 'landing-lead'])
    expect(TEMPLATES.filter(templateNeedsProduct).map((t) => t.id)).toEqual(['landing-order', 'landing-eid-sale', 'landing-new-arrival'])
  })

  it('creates an order page for a product: named after it, at /p/<its name>, then opens the editor', async () => {
    const user = userEvent.setup()
    const { bodies, fetchMock } = mockScreen(() => ({ status: 201, ...ok({ ...created, content: { schema_version: 1, sections: [] } }) }))
    const { router } = renderRoutes(routes, '/storefront/pages')
    await user.click(await screen.findByRole('button', { name: 'New campaign page' }))
    const dialog = await screen.findByRole('dialog', { name: 'New campaign page' })
    const group = within(dialog).getByRole('radiogroup', { name: 'Start from' })
    await waitFor(() => expect(within(group).getAllByRole('radio')).toHaveLength(5))
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('scope=page'))).toBe(true)
    expect(within(dialog).queryByText('About us')).toBeNull()
    // Empty is chosen first; no product is asked for it.
    expect(within(group).getByRole('radio', { name: /Empty page/ })).toBeChecked()
    expect(within(dialog).queryByText('Product to sell')).toBeNull()

    const order = within(within(dialog).getByTestId('landing-template-landing-order'))
    expect(order.getByText('Sells one product')).toBeInTheDocument()
    expect(within(within(dialog).getByTestId('landing-template-landing-eid-sale')).getByText('Shows your running promotion')).toBeInTheDocument()
    // Without a picture there is nothing larger to see.
    expect(within(within(dialog).getByTestId('landing-template-landing-lead')).queryByRole('button', { name: /Preview/ })).toBeNull()
    // A picture can be seen larger; choosing it there picks the template.
    await user.click(order.getByRole('button', { name: 'Preview Single product order page' }))
    const preview = await screen.findByRole('dialog', { name: 'Preview: Single product order page' })
    expect(within(preview).getByRole('img', { name: 'The ready-made page “Single product order page”' })).toHaveAttribute('src', '/builder-templates/landing-order.png')
    await user.click(within(preview).getByRole('button', { name: 'Use this page' }))
    expect(within(group).getByRole('radio', { name: /Single product order page/ })).toBeChecked()

    expect(within(dialog).getByText(/your featured or best-selling product is used/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Choose product' }))
    await user.click(await screen.findByRole('option', { name: /Sundarban honey/ }))
    expect(within(dialog).getByTestId('landing-chosen-product')).toHaveTextContent('Sundarban honey 500 g')
    expect(within(dialog).getByLabelText('Page name')).toHaveValue('Sundarban honey 500 g')
    expect(within(dialog).getByText('/p/sundarban-honey-500-g')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Create page' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/storefront/builder/d-honey'))
    expect(bodies).toEqual([{ kind: 'page', key: 'landing:sundarban-honey-500-g', title: 'Sundarban honey 500 g', from: 'template', template: 'landing-order', product_id: HONEY }])
  })

  it('a lead page asks for no product; a product the server refuses is shown at the product', async () => {
    const user = userEvent.setup()
    const { bodies } = mockScreen((body) =>
      body.template === 'landing-new-arrival' ? fail(422, 'VALIDATION_FAILED', 'The product is not on sale.', { product_id: ['The product is not on sale.'] }) : fail(409, 'DOCUMENT_EXISTS', 'Exists'),
    )
    renderRoutes(routes, '/storefront/pages')
    await user.click(await screen.findByRole('button', { name: 'New campaign page' }))
    const dialog = await screen.findByRole('dialog', { name: 'New campaign page' })
    await user.click(await within(dialog).findByRole('radio', { name: /Lead \/ contact campaign/ }))
    expect(within(dialog).queryByText('Product to sell')).toBeNull()
    await user.type(within(dialog).getByLabelText('Page name'), 'Wholesale enquiries')
    await user.click(within(dialog).getByRole('button', { name: 'Create page' }))
    expect(await within(dialog).findByText(/already exists/)).toBeInTheDocument()
    expect(bodies.at(-1)).toEqual({ kind: 'page', key: 'landing:wholesale-enquiries', title: 'Wholesale enquiries', from: 'template', template: 'landing-lead' })

    await user.click(within(dialog).getByRole('radio', { name: /New arrival launch/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Choose product' }))
    await user.click(await screen.findByRole('option', { name: /Sundarban honey/ }))
    // A typed name stays.
    expect(within(dialog).getByLabelText('Page name')).toHaveValue('Wholesale enquiries')
    await user.click(within(dialog).getByRole('button', { name: 'Create page' }))
    expect(await within(within(dialog).getByTestId('landing-product')).findByText('This product can’t be used. Choose another one.')).toBeInTheDocument()
    expect(bodies.at(-1)).toMatchObject({ template: 'landing-new-arrival', product_id: HONEY })
  })

  it('shows the built-in templates in Bangla on the Bangla screen', async () => {
    window.localStorage.setItem('pos.storeBuilder.pagesLang', 'bn')
    const user = userEvent.setup()
    mockScreen(() => fail(500, 'SERVER_ERROR'))
    renderRoutes(routes, '/storefront/pages')
    await user.click(await screen.findByRole('button', { name: 'নতুন ক্যাম্পেইন পেজ' }))
    const dialog = await screen.findByRole('dialog', { name: 'নতুন ক্যাম্পেইন পেজ' })
    expect(dialog).toHaveAttribute('lang', 'bn')
    await user.click(await within(dialog).findByRole('radio', { name: /এক পণ্যের অর্ডার পেজ/ }))
    expect(within(dialog).getByText('যে পণ্য বিক্রি করবেন')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('পেজের নাম')).toBeInTheDocument()
  })

  it('without templates (the list failed) an empty page can still be made', async () => {
    const user = userEvent.setup()
    mockApi({ 'GET /auth/me': ok(manager()), 'GET /storefront/builder/documents': ok([]), 'GET /storefront/builder/templates': fail(500, 'SERVER_ERROR') })
    renderRoutes(routes, '/storefront/pages')
    await user.click(await screen.findByRole('button', { name: 'New campaign page' }))
    const dialog = await screen.findByRole('dialog', { name: 'New campaign page' })
    expect(await within(dialog).findByText(/You can still start empty/)).toBeInTheDocument()
    expect(within(dialog).getByRole('radio', { name: /Empty page/ })).toBeChecked()
  })
})
