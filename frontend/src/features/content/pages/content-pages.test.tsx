import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import type { CmsPage, ContactMessage, FaqItem } from '@/features/content/api'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

const editor = () => makeCurrentUser({ permissions: ['cms.manage', 'storefront.view', 'storefront.manage', 'media.manage'] })
const paged = (items: unknown[], meta: Record<string, unknown> = {}) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 }, ...meta })

const page = (overrides: Partial<CmsPage> = {}): CmsPage => ({
  id: 'p-1',
  slug: 'about-us',
  title: 'About us',
  template: 'default',
  status: 'published',
  is_visible: true,
  published_at: '2026-10-01T00:00:00+00:00',
  seo_title: null,
  seo_description: null,
  updated_at: '2026-10-01T00:00:00+00:00',
  body_html: '<p>Hello</p>',
  ...overrides,
})

describe('content pages', () => {
  it('lists pages with their status and the Content entry in the sidebar', async () => {
    mockApi({
      'GET /auth/me': ok(editor()),
      'GET /cms/pages': paged([page(), page({ id: 'p-2', slug: 'eid', title: 'Eid offers', status: 'published', is_visible: false }), page({ id: 'p-3', slug: 'draft', title: 'Draft page', status: 'draft', is_visible: false })]),
    })
    renderRoutes(routes, '/content/pages')

    const table = await screen.findByRole('table')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('/pages/about-us')
    expect(rows[0]).toHaveTextContent('Published')
    expect(rows[1]).toHaveTextContent('Scheduled')
    expect(rows[2]).toHaveTextContent('Draft')
    expect(within(rows[0]!).getByRole('link', { name: 'About us' })).toHaveAttribute('href', '/content/pages/p-1')
    expect(screen.getAllByRole('link', { name: 'Content' })[0]).toHaveAttribute('href', '/content/pages')
  })

  it('creates a page with an address derived from its title', async () => {
    const user = userEvent.setup()
    let created: Record<string, unknown> | undefined
    mockApi({
      'GET /auth/me': ok(editor()),
      'POST /cms/pages': (init) => {
        created = JSON.parse(String(init.body)) as Record<string, unknown>
        return { status: 201, body: { success: true, data: page({ id: 'p-9', slug: 'shipping-returns', title: 'Shipping & returns', status: 'draft', is_visible: false, body_html: null }), meta: {} } }
      },
      'GET /cms/pages/p-9': ok(page({ id: 'p-9', slug: 'shipping-returns', title: 'Shipping & returns', status: 'draft', is_visible: false, body_html: null })),
    })
    const { router } = renderRoutes(routes, '/content/pages/new')

    await user.type(await screen.findByLabelText('Title'), 'Shipping & Returns')
    expect(screen.getByLabelText('Address')).toHaveValue('shipping-returns')
    expect(screen.getByRole('textbox', { name: 'Page text' })).toBeInTheDocument()
    expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create page' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/content/pages/p-9'))
    expect(created).toMatchObject({ title: 'Shipping & Returns', slug: 'shipping-returns', template: 'default', status: 'draft', published_at: null, body_html: null })
  })

  it('refuses an invalid address before saving', async () => {
    const user = userEvent.setup()
    mockApi({ 'GET /auth/me': ok(editor()) })
    renderRoutes(routes, '/content/pages/new')

    await user.type(await screen.findByLabelText('Title'), 'Promo')
    await user.clear(screen.getByLabelText('Address'))
    await user.type(screen.getByLabelText('Address'), 'promo page!')
    await user.click(screen.getByRole('button', { name: 'Create page' }))

    expect(screen.getByText('Lower-case letters, digits and single hyphens, e.g. about-us.')).toBeInTheDocument()
  })
})

describe('FAQ, messages and newsletter', () => {
  it('reorders FAQ entries', async () => {
    const user = userEvent.setup()
    let items: FaqItem[] = [
      { id: 'f-1', group: 'Delivery', question: 'How fast?', answer_html: '<p>Same day</p>', is_active: true, sort_order: 0 },
      { id: 'f-2', group: null, question: 'Returns?', answer_html: '<p>7 days</p>', is_active: false, sort_order: 1 },
    ]
    let order: unknown
    mockApi({
      'GET /auth/me': ok(editor()),
      'GET /cms/faq': () => ok(items),
      'PUT /cms/faq/order': (init) => {
        order = JSON.parse(String(init.body))
        items = [items[1]!, items[0]!]
        return ok(items)
      },
    })
    renderRoutes(routes, '/content/faq')

    const list = await screen.findByRole('list', { name: 'FAQ entries' })
    expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent('Hidden')
    await user.click(screen.getByRole('button', { name: 'Move "Returns?" up' }))
    await waitFor(() => expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('Returns?'))
    expect(order).toEqual({ ids: ['f-2', 'f-1'] })
  })

  it('shows open messages and marks one handled', async () => {
    const user = userEvent.setup()
    const message: ContactMessage = { id: 'c-1', name: 'Rina', email: 'rina@example.com', phone: null, subject: 'Sizes', message: 'Do you have 2T?', is_handled: false, handled_at: null, created_at: '2026-10-31T10:00:00+00:00' }
    let patched: unknown
    mockApi({
      'GET /auth/me': ok(editor()),
      'GET /cms/contact-messages': (_init, url) => (url.searchParams.get('status') === 'open' && !patched ? paged([message], { open: 1 }) : paged([], { open: 0 })),
      'PATCH /cms/contact-messages/c-1': (init) => {
        patched = JSON.parse(String(init.body))
        return ok({ ...message, is_handled: true })
      },
    })
    renderRoutes(routes, '/content/messages')

    expect(await screen.findByRole('tab', { name: 'Open (1)' })).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Contact messages' })
    expect(within(list).getByRole('link', { name: 'Reply by e-mail' })).toHaveAttribute('href', expect.stringContaining('mailto:rina@example.com'))
    await user.click(within(list).getByRole('button', { name: 'Mark as handled' }))
    expect(await screen.findByText('No open messages')).toBeInTheDocument()
    expect(patched).toEqual({ is_handled: true })
  })

  it('shows subscriber counts and offers the CSV export', async () => {
    mockApi({
      'GET /auth/me': ok(editor()),
      'GET /cms/newsletter-subscribers': paged(
        [{ id: 'n-1', email: 'mina@example.com', status: 'subscribed', confirmed_at: '2026-10-31T10:00:00+00:00', unsubscribed_at: null, created_at: '2026-10-31T09:00:00+00:00' }],
        { counts: { pending: 2, subscribed: 1, unsubscribed: 0 } },
      ),
    })
    renderRoutes(routes, '/content/newsletter')

    expect(await screen.findByText('mina@example.com')).toBeInTheDocument()
    expect(screen.getByText(/1 subscribed, 2 awaiting confirmation/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Export subscribers (CSV)' })).toHaveAttribute('href', '/api/v1/cms/newsletter-subscribers/export')
  })
})

describe('menus', () => {
  it('links a menu item to a content page', async () => {
    const user = userEvent.setup()
    let saved: { items: unknown[] } | undefined
    mockApi({
      'GET /auth/me': ok(editor()),
      'GET /storefront/menus': ok([{ id: 'm-1', name: 'Main', location: 'main', location_label: 'Main navigation', is_active: true, updated_at: null }]),
      'GET /storefront/menus/m-1': ok({ id: 'm-1', name: 'Main', location: 'main', location_label: 'Main navigation', is_active: true, updated_at: null, items: [] }),
      'GET /storefront/link-targets': ok({ pages: [{ id: 'p-1', slug: 'about-us', title: 'About us', status: 'published' }, { id: 'p-2', slug: 'draft', title: 'Coming soon', status: 'draft' }] }),
      'PUT /storefront/menus/m-1/items': (init) => {
        saved = JSON.parse(String(init.body)) as { items: unknown[] }
        return ok({ id: 'm-1', name: 'Main', location: 'main', location_label: 'Main navigation', is_active: true, updated_at: null, items: saved.items })
      },
      'GET /media': ok([], { pagination: { current_page: 1, per_page: 100, total: 0, last_page: 1 } }),
    })
    renderRoutes(routes, '/storefront/menus?menu=m-1')

    await user.click(await screen.findByRole('button', { name: 'Add item' }))
    await user.type(screen.getByRole('textbox', { name: 'Item 1 label' }), 'About')
    await user.click(screen.getByRole('combobox', { name: 'Item 1 link type' }))
    expect(await screen.findByRole('option', { name: 'Page: Coming soon (draft)' })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Page: About us' }))
    expect(screen.queryByRole('textbox', { name: 'Item 1 link' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save items' }))

    await waitFor(() => expect(saved).toBeDefined())
    expect(saved?.items[0]).toMatchObject({ type: 'page', label: 'About', url: null, target_id: 'p-1' })
  })
})
