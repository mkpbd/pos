import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { toApiQuery, EMPTY_LISTING_STATE } from './catalog/listing-params'
import { CanvasApp } from './builder/canvas/canvas-app'
import { envelope, readParentMessage, type ParentMessage } from './builder/canvas/protocol'
import { createCanvasQueryClient } from './builder/canvas/query-client'
import { B14_TYPES } from './builder/elements/b14-types'
import { documentContext, elementMeta, isAllowedIn, isAllowedInTemplate, isTranslatableKey } from './builder/registry'
import { fieldText, fieldValue, formatDynamicText, type FieldFormatters } from './builder/templates/context'
import { templateHasH1 } from './builder/templates/enabled'
import { readListingData, readPageContext, readSampleListing } from './builder/templates/sample'
import { fieldsFor, TEMPLATE_CORE_ELEMENT, templateKeyOf, type StorePageContext } from './builder/templates/types'
import { documentOf, elementNode, payloadOf } from './builder/test-payload'
import type { BuilderPage, Element } from './builder/types'
import { b14PropProblems, dynamicFieldAllowed, elementPropProblems } from './builder/validate'
import { storefrontRoutes } from './routes'
import { blogPostDetail, bootstrapFixture, facetsFixture, listingBody, orderFixture, productCard, resetLocale, tEn } from './test-fixtures'
import type { StoreCategory, StorefrontBootstrap } from './types'

afterEach(() => {
  resetLocale()
})

const ALL_OFF = { shop: false, category: false, brand: false, search: false, blog_post: false, order: false, not_found: false }

function bootstrapWith(templates: Partial<typeof ALL_OFF>, overrides: Partial<StorefrontBootstrap> = {}): StorefrontBootstrap {
  const base = bootstrapFixture(overrides)
  return {
    ...base,
    theme: { ...base.theme, footer: { ...base.theme.footer, contact: { email: 'hello@berry.test', phone: '01700000000', address: 'Dhanmondi, Dhaka' } } },
    builder: { home: false, templates: { ...ALL_OFF, ...templates } },
  }
}

const cards = [productCard('mango-juice'), productCard('orange-juice'), productCard('apple-juice')]

const category: StoreCategory = {
  id: '01a1c9d9-0000-7000-8000-0000000000c1',
  slug: 'juices',
  name: 'Juices',
  description_html: '<p>Freshly pressed.</p>',
  image: null,
  banner: null,
  seo: { title: 'Fresh juices', description: null },
  breadcrumbs: [
    { name: 'Home', url: '/' },
    { name: 'Juices', url: null },
  ],
  children: [],
}

function templatePayload(key: string, ...rows: Element[][]): BuilderPage {
  return payloadOf(documentOf(...rows), { key: `template:${key}`, title: key })
}

function requestsTo(fetchMock: ReturnType<typeof mockApi>, pathname: string): URLSearchParams[] {
  return fetchMock.mock.calls
    .map(([input]) => new URL(String(input), 'http://localhost'))
    .filter((url) => url.pathname === `/api/v1${pathname}`)
    .map((url) => url.searchParams)
}

const formatters: FieldFormatters = {
  t: tEn,
  formatNumber: (value) => String(value),
  formatDate: (iso) => `date(${iso.slice(0, 10)})`,
  digits: (text) => text,
}

/* ============================================================================================= */

describe('B14 registry, rules and context', () => {
  it('registers the five elements with defaults that pass the rules', () => {
    for (const type of B14_TYPES) {
      const meta = elementMeta(type)
      expect(meta, type).toBeDefined()
      expect(elementPropProblems(type, meta!.props), type).toEqual([])
    }
    expect(isTranslatableKey('dynamic_text', 'fallback')).toBe(true)
    expect(isTranslatableKey('not_found_message', 'heading')).toBe(true)
    expect(elementMeta('product_listing')!.props.scope).toBe('all')
  })

  it('maps template keys to the template context and keeps main parts in their own templates', () => {
    expect(documentContext('template:shop')).toBe('template')
    expect(templateKeyOf('template:blog_post')).toBe('blog_post')
    expect(templateKeyOf('template:nope')).toBeNull()
    expect(templateKeyOf('landing:sale')).toBeNull()
    // Anything a page holds goes in a template too.
    expect(isAllowedIn('hero_slider', 'template')).toBe(true)
    expect(isAllowedIn('trust_badges', 'template')).toBe(true)
    expect(isAllowedIn('logo', 'template')).toBe(false)
    expect(isAllowedIn('product_listing', 'page')).toBe(true)
    expect(isAllowedIn('order_summary', 'page')).toBe(false)
    expect(isAllowedInTemplate('product_listing', 'category')).toBe(true)
    expect(isAllowedInTemplate('product_listing', 'order')).toBe(false)
    expect(isAllowedInTemplate('order_summary', 'order')).toBe(true)
    expect(isAllowedInTemplate('blog_post_body', 'shop')).toBe(false)
    expect(isAllowedInTemplate('heading', 'not_found')).toBe(true)
    expect(TEMPLATE_CORE_ELEMENT.not_found).toBe('not_found_message')
  })

  it('checks the props like the server', () => {
    expect(b14PropProblems('dynamic_text', { field: 'order.secret', tag: 'h4', prefix: 'x'.repeat(81), suffix: '', fallback: '', format: 'money' })).toEqual([
      { path: 'field', code: 'invalid' },
      { path: 'tag', code: 'invalid' },
      { path: 'prefix', code: 'too_long' },
    ])
    const listing = { ...elementMeta('product_listing')!.props }
    expect(b14PropProblems('product_listing', { ...listing, scope: 'categories' })).toEqual([{ path: 'category_ids', code: 'too_few' }])
    expect(b14PropProblems('product_listing', { ...listing, per_page: 20, columns: { desktop: 6, tablet: 3, mobile: 2 } })).toEqual([
      { path: 'per_page', code: 'out_of_range' },
      { path: 'columns.desktop', code: 'out_of_range' },
    ])
    expect(b14PropProblems('order_summary', { show_timeline: true, show_items: 'yes', show_address: true, show_delivery: true })).toEqual([{ path: 'show_items', code: 'invalid' }])
    expect(dynamicFieldAllowed('category.name', 'category')).toBe(true)
    expect(dynamicFieldAllowed('category.name', 'brand')).toBe(false)
    expect(dynamicFieldAllowed('store.phone', null)).toBe(true)
    expect(fieldsFor(null)).toEqual(['store.name', 'store.phone', 'store.email', 'store.address'])
  })

  it('reads and formats a field of the page context', () => {
    const context: StorePageContext = {
      template: 'order',
      store: { name: 'Berry Kids', phone: null, email: null, address: null },
      order: {
        number: 'WEB-1',
        status: 'Confirmed',
        total: '1250.50',
        currency: 'BDT',
        placed_at: '2026-10-31T10:00:00+06:00',
        customer_first_name: 'Rina',
        payment_method: 'Cash on delivery',
        delivery_eta: { min_days: 2, max_days: 4 },
      },
      // Not this template's field: never shown.
      category: { id: 'c', slug: 'c', name: 'Leaked', description: null, product_count: 3 },
    }
    expect(fieldText(context, 'order.total', 'default', formatters, 'BDT')).toBe('৳1,250.50')
    expect(fieldText(context, 'order.placed_at', 'default', formatters, 'BDT')).toBe('date(2026-10-31)')
    expect(fieldText(context, 'order.delivery_eta', 'default', formatters, 'BDT')).toBe('2–4 days')
    expect(fieldText(context, 'order.customer_first_name', 'default', formatters, 'BDT')).toBe('Rina')
    expect(fieldText(context, 'store.phone', 'default', formatters, 'BDT')).toBeNull()
    expect(fieldValue(context, 'category.name')).toBeNull()
    expect(fieldText(null, 'store.name', 'default', formatters, 'BDT')).toBeNull()
    const post: StorePageContext = { template: 'blog_post', store: context.store, post: { id: null, slug: 'p', title: 'T', excerpt: null, author: null, published_at: '2026-10-12T18:00:00+06:00', reading_time: 4, category: null } }
    expect(fieldText(post, 'post.reading_time', 'default', formatters, 'BDT')).toBe('4 min read')
    expect(fieldText(post, 'post.reading_time', 'number', formatters, 'BDT')).toBe('4')
  })

  it('joins prefix, value and suffix with one space, minding opening and closing marks', () => {
    expect(formatDynamicText('ধন্যবাদ,', 'Rahim', '!', '')).toBe('ধন্যবাদ, Rahim!')
    expect(formatDynamicText('খোঁজার ফল: “', 'tea', '”', '')).toBe('খোঁজার ফল: “tea”')
    expect(formatDynamicText('', '3', 'টি পণ্য', '')).toBe('3 টি পণ্য')
    expect(formatDynamicText('(', '12', ')', '')).toBe('(12)')
    expect(formatDynamicText('Total', '৳960', '।', '')).toBe('Total ৳960।')
    expect(formatDynamicText('Hi', null, '!', 'Welcome')).toBe('Welcome')
    expect(formatDynamicText('Hi', '  ', '!', '')).toBeNull()
  })

  it('builds the listing query of a builder listing on a normal page', () => {
    const query = new URLSearchParams(toApiQuery({ ...EMPTY_LISTING_STATE, brands: ['ignored'] }, { kind: 'selection', categories: ['juices', 'tea'], brands: ['sunny'], onSale: true }))
    expect(query.getAll('categories[]')).toEqual(['juices', 'tea'])
    expect(query.getAll('brand[]')).toEqual(['sunny'])
    expect(query.get('on_sale')).toBe('1')
    expect(readListingData({ category_slugs: ['a', 3, ''], brand_slugs: 'x' })).toEqual({ category_slugs: ['a'], brand_slugs: [] })
  })

  it('reads the sample the editor sends (raw /store/products answer or a listing) and the context', () => {
    const raw = listingBody(cards, { total: 9 })
    expect(readSampleListing(raw)?.pagination.total).toBe(9)
    expect(readSampleListing({ products: [], pagination: { current_page: 1, per_page: 24, total: 0, last_page: 1 }, facets: null, context: null })?.products).toEqual([])
    expect(readSampleListing('nope')).toBeNull()
    expect(readPageContext({ template: 'evil', store: { name: 'x' } })).toBeNull()
    expect(readPageContext({ template: null, store: { name: 'x' } })?.template).toBeNull()
  })

  it('accepts the page-context message and knows when a template draws its own h1', () => {
    const event = new MessageEvent('message', { data: envelope({ type: 'page-context', context: null }), origin: window.location.origin, source: window })
    expect(readParentMessage(event, window.location.origin, window)?.type).toBe('page-context')
    expect(templateHasH1(documentOf([elementNode('dynamic_text', 'e_title', { tag: 'h1' })]).sections as never)).toBe(true)
    expect(templateHasH1(documentOf([elementNode('dynamic_text', 'e_title', { tag: 'h2' }), elementNode('product_listing', 'e_list')]).sections as never)).toBe(false)
  })
})

/* ============================================================================================= */

describe('store pages with a published template', () => {
  it('keeps the standard page when no template is published (no template request)', async () => {
    const fetchMock = mockApi({ 'GET /store/bootstrap': ok(bootstrapWith({})), 'GET /store/products': { body: listingBody(cards) } })
    renderRoutes(storefrontRoutes, '/shop')
    expect(await screen.findByRole('heading', { level: 1, name: 'Shop' })).toBeInTheDocument()
    await screen.findAllByTestId('product-card')
    expect(screen.queryByTestId('store-template')).toBeNull()
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/store/builder/templates'))).toBe(false)
  })

  it('draws the category template with live text, the listing (with its own options) and the standard meta', async () => {
    const page = templatePayload(
      'category',
      [elementNode('dynamic_text', 'e_name', { field: 'category.name', tag: 'h1' }), elementNode('dynamic_text', 'e_count', { field: 'category.product_count', suffix: ' products' })],
      [elementNode('product_listing', 'e_list', { scope: 'current', filters: { price: true, brand: false, category: true, attributes: true, availability: true, on_sale: true }, per_page: 12, columns: { desktop: 4, tablet: 3, mobile: 1 } })],
    )
    const fetchMock = mockApi({
      'GET /store/bootstrap': ok(bootstrapWith({ category: true })),
      'GET /store/categories/juices': ok(category),
      'GET /store/builder/templates/category': ok(page),
      'GET /store/products': { body: listingBody(cards, { total: 31, perPage: 12 }) },
    })
    const { router } = renderRoutes(storefrontRoutes, '/category/juices')

    expect(await screen.findByRole('heading', { level: 1, name: 'Juices' })).toBeInTheDocument()
    expect(screen.getByTestId('store-template')).toHaveAttribute('data-template', 'category')
    await screen.findAllByTestId('product-card')
    await waitFor(() => expect(screen.getByText('31 products')).toBeInTheDocument())
    expect(screen.getByTestId('product-results')).toHaveAttribute('data-columns', '4-3-1')
    await waitFor(() => expect(document.title).toBe('Fresh juices | Berry Kids'))

    const request = requestsTo(fetchMock, '/store/products').at(-1)!
    expect(request.get('category')).toBe('juices')
    expect(request.get('per_page')).toBe('12')
    // The brand filter is switched off; the others stay.
    const filters = within(screen.getByRole('complementary', { name: 'Filters' }))
    expect(filters.queryByRole('checkbox', { name: /Fresh Co/ })).toBeNull()
    expect(filters.getByRole('checkbox', { name: /In stock/ })).toBeInTheDocument()

    // Filters live in the URL; the template's own page size is left out of it.
    await userEvent.setup().click(filters.getByRole('checkbox', { name: /In stock/ }))
    await waitFor(() => expect(router.state.location.search).toBe('?in_stock=1'))
  })

  it('falls back to the standard page when the template is not there', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bootstrapWith({ shop: true })),
      'GET /store/builder/templates/shop': fail(404, 'PAGE_NOT_FOUND'),
      'GET /store/products': { body: listingBody(cards) },
    })
    renderRoutes(storefrontRoutes, '/shop')
    expect(await screen.findByRole('heading', { level: 1, name: 'Shop' })).toBeInTheDocument()
    expect(screen.queryByTestId('store-template')).toBeNull()
  })

  it('keeps the 404 of an unknown category', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bootstrapWith({ category: true })),
      'GET /store/categories/nope': fail(404, 'NOT_FOUND'),
      'GET /store/builder/templates/category': ok(templatePayload('category', [elementNode('product_listing', 'e_list', { scope: 'current' })])),
    })
    renderRoutes(storefrontRoutes, '/category/nope')
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument()
  })

  it('draws the search template with the search words, a screen-reader title and noindex', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bootstrapWith({ search: true })),
      'GET /store/builder/templates/search': ok(
        templatePayload('search', [elementNode('dynamic_text', 'e_q', { field: 'search.query', prefix: 'You looked for ' }), elementNode('product_listing', 'e_list', { scope: 'current', pagination: 'load_more', per_page: 12 })]),
      ),
      'GET /store/products': (_init, url) => ({ body: listingBody(url.searchParams.get('page') === '2' ? [productCard('kiwi-2')] : cards, { total: 13, perPage: 12, page: Number(url.searchParams.get('page')) }) }),
    })
    const { router } = renderRoutes(storefrontRoutes, '/search?q=kiwi')
    expect(await screen.findByText('You looked for kiwi')).toBeInTheDocument()
    // No h1 in this design: the page's title is there for screen readers.
    expect(screen.getByRole('heading', { level: 1, name: 'Search results for “kiwi”' })).toHaveClass('sr-only')
    await waitFor(() => expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toContain('noindex'))

    // Load more adds the next page below and keeps it in the address.
    await screen.findAllByTestId('product-card')
    await userEvent.setup().click(screen.getByTestId('load-more'))
    await waitFor(() => expect(screen.getAllByTestId('product-card')).toHaveLength(4))
    expect(router.state.location.search).toBe('?q=kiwi&page=2')
    expect(screen.queryByTestId('load-more')).toBeNull()
  })

  it('draws the blog post template with the post body (parts switched off stay away)', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bootstrapWith({ blog_post: true })),
      'GET /store/blog/mango-smoothie': ok(blogPostDetail('mango-smoothie')),
      'GET /store/builder/templates/blog_post': ok(
        templatePayload('blog_post', [elementNode('dynamic_text', 'e_author', { field: 'post.author', prefix: 'Story told by ' }), elementNode('blog_post_body', 'e_post', { show_share: false, show_cover: false })]),
      ),
    })
    renderRoutes(storefrontRoutes, '/blog/mango-smoothie')
    expect(await screen.findByRole('heading', { level: 1, name: 'Mango Smoothie' })).toBeInTheDocument()
    expect(screen.getByText('Story told by Rina')).toBeInTheDocument()
    expect(screen.getByText(/Start with ripe mangoes/)).toBeInTheDocument()
    expect(screen.queryByTestId('share-bar')).toBeNull()
    await waitFor(() => expect(document.title).toBe('Mango Smoothie | Berry Kids'))
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('draws the order template around the order loaded with its token (the payload holds no order)', async () => {
    const fetchMock = mockApi({
      'GET /store/bootstrap': ok(bootstrapWith({ order: true })),
      'GET /store/account/me': ok(null),
      'GET /store/orders/WEB-000001': ok(orderFixture()),
      'GET /store/builder/templates/order': ok(
        templatePayload(
          'order',
          [elementNode('dynamic_text', 'e_hi', { field: 'order.customer_first_name', prefix: 'Thanks, ', suffix: '!' }), elementNode('dynamic_text', 'e_total', { field: 'order.total' })],
          [elementNode('order_summary', 'e_order', { show_timeline: false })],
        ),
      ),
    })
    renderRoutes(storefrontRoutes, '/order/WEB-000001?token=abc')
    expect(await screen.findByText('Thanks, Rina!')).toBeInTheDocument()
    expect(screen.queryByTestId('dynamic-text-token')).toBeNull()
    expect(screen.getAllByText('৳960.00').length).toBeGreaterThan(0)
    expect(await screen.findByTestId('order-number')).toHaveTextContent('WEB-000001')
    expect(screen.getByText('Kids Tee')).toBeInTheDocument()
    expect(requestsTo(fetchMock, '/store/orders/WEB-000001')[0]?.get('token')).toBe('abc')
    expect(requestsTo(fetchMock, '/store/builder/templates/order')[0]?.get('token')).toBeNull()
  })

  it('draws the not-found template on an unknown address', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bootstrapWith({ not_found: true })),
      'GET /store/builder/templates/not_found': ok(
        templatePayload('not_found', [elementNode('not_found_message', 'e_nf', { heading: 'Lost in the juice aisle', text: 'Try a search.' }), elementNode('dynamic_text', 'e_phone', { field: 'store.phone', prefix: 'Call us: ' })]),
      ),
    })
    renderRoutes(storefrontRoutes, '/no-such-page')
    expect(await screen.findByRole('heading', { level: 1, name: 'Lost in the juice aisle' })).toBeInTheDocument()
    expect(screen.getByText('Call us: 01700000000')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Browse the shop' })).toHaveAttribute('href', '/shop')
    await waitFor(() => expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toContain('noindex'))
  })

  it('lists chosen categories on a normal page through categories[]', async () => {
    const page = payloadOf(documentOf([elementNode('product_listing', 'e_list', { scope: 'categories', category_ids: ['01a1c9d9-0000-7000-8000-0000000000c1'], filter_layout: 'drawer' })]), {
      data: { e_list: { category_slugs: ['juices', 'tea'], brand_slugs: [] } as never },
    })
    const fetchMock = mockApi({
      'GET /store/bootstrap': ok({ ...bootstrapWith({}), builder: { home: true, templates: ALL_OFF } }),
      'GET /store/builder/pages/home': ok(page),
      'GET /store/products': { body: listingBody(cards, { facets: facetsFixture() }) },
    })
    renderRoutes(storefrontRoutes, '/')
    await screen.findAllByTestId('product-card')
    expect(requestsTo(fetchMock, '/store/products').at(-1)!.getAll('categories[]')).toEqual(['juices', 'tea'])
    // Drawer layout: no sidebar, a Filters button.
    expect(screen.queryByRole('complementary', { name: 'Filters' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument()
  })
})

/* ============================================================================================= */

describe('canvas sample context', () => {
  function mount() {
    vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    render(
      <QueryClientProvider client={createCanvasQueryClient()}>
        <MemoryRouter>
          <CanvasApp parent={window} origin={window.location.origin} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    return (data: ParentMessage) =>
      act(() => void window.dispatchEvent(new MessageEvent('message', { data: envelope(data), origin: window.location.origin, source: window })))
  }

  it('shows where live text goes until a sample arrives, then draws the sample', async () => {
    const send = mount()
    const page = templatePayload('category', [elementNode('dynamic_text', 'e_name', { field: 'category.name', tag: 'h1' }), elementNode('product_listing', 'e_list', { scope: 'current' })])
    send({ type: 'init', bootstrap: bootstrapWith({}), locale: 'en' })
    send({ type: 'render', sections: page.sections, data: {}, media: {}, selection: null, hover: null, errors: [], device: 'desktop', pending: [] })

    expect(await screen.findByTestId('dynamic-text-token')).toHaveTextContent('Text from this page: category.name')
    expect(screen.getByTestId('template-outline')).toHaveTextContent('Product listing')

    send({
      type: 'page-context',
      context: { template: 'category', store: { name: 'Berry Kids', phone: null, email: null, address: null }, category: { id: 'c1', slug: 'juices', name: 'Juices', description: null, product_count: 3 } },
      sample: { listing: listingBody(cards, { total: 3 }) as never },
    })
    expect(await screen.findByRole('heading', { level: 1, name: 'Juices' })).toBeInTheDocument()
    expect(screen.getAllByTestId('product-card')).toHaveLength(3)
    expect(screen.queryByTestId('template-outline')).toBeNull()
  })
})
