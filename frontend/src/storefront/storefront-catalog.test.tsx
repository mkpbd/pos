import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { storefrontRoutes } from './routes'
import { bootstrapFixture, facetsFixture, listingBody, productCard } from './test-fixtures'
import type { StoreCategory } from './types'

const cards = [
  productCard('mango-juice', { price: '120.00', price_max: '150.00', variant_count: 2, is_new: true }),
  productCard('orange-juice', { on_sale: true, compare_at_price: '140.00', discount_percent: 14, hover_image: { url: '/storage/products/orange-2.png', alt: null } }),
  productCard('apple-juice', { in_stock: false, brand: { name: 'Sunny', slug: 'sunny' } }),
]

function productsRequests(fetchMock: ReturnType<typeof mockApi>): URLSearchParams[] {
  return fetchMock.mock.calls
    .map(([input]) => new URL(String(input), 'http://localhost'))
    .filter((url) => url.pathname === '/api/v1/store/products')
    .map((url) => url.searchParams)
}

describe('shop listing', () => {
  it('shows cards with badges, price ranges and the result count', async () => {
    mockApi({ 'GET /store/bootstrap': ok(bootstrapFixture()), 'GET /store/products': { body: listingBody(cards, { total: 57 }) } })
    renderRoutes(storefrontRoutes, '/shop')

    expect(await screen.findByRole('heading', { level: 1, name: 'Shop' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('result-count')).toHaveTextContent('Showing 1–24 of 57 products'))
    await waitFor(() => expect(document.title).toBe('Shop | Berry Kids'))

    const [mango, orange, apple] = screen.getAllByTestId('product-card')
    expect(within(mango!).getByRole('link', { name: 'Mango Juice' })).toHaveAttribute('href', '/product/mango-juice')
    expect(within(mango!).getByTestId('price')).toHaveTextContent('৳120.00 – ৳150.00')
    expect(within(mango!).getByText('New')).toBeInTheDocument()
    expect(within(orange!).getByText('Sale −14 %')).toBeInTheDocument()
    expect(within(orange!).getByText('৳140.00', { exact: false }).tagName).toBe('S')
    expect(within(orange!).getAllByRole('img', { hidden: true })).toHaveLength(2)
    expect(within(within(apple!).getByRole('list', { name: 'Product labels' })).getByText('Out of stock')).toBeInTheDocument()
    expect(within(apple!).getByRole('button', { name: /is out of stock/ })).toBeDisabled()
    expect(within(apple!).getByText('Sunny')).toBeInTheDocument()

    // Pagination links carry the page in the URL.
    const pagination = screen.getByRole('navigation', { name: 'Pagination' })
    expect(within(pagination).getByRole('link', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page')
    expect(within(pagination).getByRole('link', { name: 'Page 3' })).toHaveAttribute('href', '/shop?page=3')
  })

  it('renders facets with counts and keeps every filter in the URL', async () => {
    const fetchMock = mockApi({ 'GET /store/bootstrap': ok(bootstrapFixture()), 'GET /store/products': { body: listingBody(cards) } })
    const { router } = renderRoutes(storefrontRoutes, '/shop?sort=price_asc')
    const user = userEvent.setup()

    const filters = within(await screen.findByRole('complementary', { name: 'Filters' }))
    expect(filters.getByRole('link', { name: /Juices/ })).toHaveAttribute('href', '/category/juices?sort=price_asc')

    await user.click(filters.getByRole('checkbox', { name: /Fresh Co/ }))
    await waitFor(() => expect(router.state.location.search).toBe('?brand=fresh-co&sort=price_asc'))

    await user.click(filters.getByRole('button', { name: /Red \(2 products\)/ }))
    await waitFor(() => expect(router.state.location.search).toBe('?brand=fresh-co&attr.colour=Red&sort=price_asc'))

    await user.click(filters.getByRole('checkbox', { name: /1L/ }))
    await user.click(filters.getByRole('checkbox', { name: /In stock/ }))
    await user.type(filters.getByLabelText('Minimum price'), '50')
    await user.type(filters.getByLabelText('Maximum price'), '200')
    await user.click(filters.getByRole('button', { name: 'Apply price' }))

    await waitFor(() =>
      expect(Object.fromEntries(new URLSearchParams(router.state.location.search))).toEqual({
        brand: 'fresh-co',
        'attr.colour': 'Red',
        'attr.size': '1L',
        price_min: '50',
        price_max: '200',
        in_stock: '1',
        sort: 'price_asc',
      }),
    )
    await waitFor(() => {
      const last = productsRequests(fetchMock).at(-1)!
      expect(last.getAll('brand[]')).toEqual(['fresh-co'])
      expect(last.getAll('attr[colour][]')).toEqual(['Red'])
      expect(last.getAll('attr[size][]')).toEqual(['1L'])
      expect(last.get('price_min')).toBe('50')
      expect(last.get('price_max')).toBe('200')
      expect(last.get('in_stock')).toBe('1')
      expect(last.get('sort')).toBe('price_asc')
    })

    // Active filters are listed and removable; "clear all" keeps the sort.
    const active = screen.getByRole('list', { name: 'Active filters' })
    expect(within(active).getByRole('button', { name: 'Remove filter: ৳50.00 – ৳200.00' })).toBeInTheDocument()
    await user.click(within(active).getByRole('button', { name: 'Remove filter: Fresh Co' }))
    await waitFor(() => expect(router.state.location.search).not.toContain('brand='))
    await user.click(within(screen.getByRole('list', { name: 'Active filters' })).getByRole('button', { name: 'Clear all' }))
    await waitFor(() => expect(router.state.location.search).toBe('?sort=price_asc'))
  })

  it('rejects an inverted price range without touching the URL', async () => {
    mockApi({ 'GET /store/bootstrap': ok(bootstrapFixture()), 'GET /store/products': { body: listingBody(cards) } })
    const { router } = renderRoutes(storefrontRoutes, '/shop')
    const user = userEvent.setup()

    const filters = within(await screen.findByRole('complementary', { name: 'Filters' }))
    await user.type(filters.getByLabelText('Minimum price'), '300')
    await user.type(filters.getByLabelText('Maximum price'), '20')
    await user.click(filters.getByRole('button', { name: 'Apply price' }))

    expect(filters.getByRole('alert')).toHaveTextContent('The minimum must not be above the maximum.')
    expect(router.state.location.search).toBe('')
  })

  it('changes sort, page size and view through the toolbar and goes back with history', async () => {
    const fetchMock = mockApi({ 'GET /store/bootstrap': ok(bootstrapFixture()), 'GET /store/products': { body: listingBody(cards, { total: 80 }) } })
    const { router } = renderRoutes(storefrontRoutes, '/shop?page=2')
    const user = userEvent.setup()

    await user.selectOptions(await screen.findByLabelText('Sort by'), 'Newest')
    await waitFor(() => expect(router.state.location.search).toBe('?sort=latest'))
    await user.selectOptions(screen.getByLabelText('Show'), '48')
    await waitFor(() => expect(router.state.location.search).toBe('?sort=latest&per_page=48'))
    await user.click(screen.getByRole('button', { name: 'List view' }))
    await waitFor(() => expect(router.state.location.search).toBe('?sort=latest&per_page=48&view=list'))
    expect(screen.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'true')

    await waitFor(() => expect(productsRequests(fetchMock).at(-1)?.get('per_page')).toBe('48'))
    void router.navigate(-1)
    await waitFor(() => expect(router.state.location.search).toBe('?sort=latest&per_page=48'))
  })

  it('offers to clear filters when nothing matches', async () => {
    mockApi({ 'GET /store/bootstrap': ok(bootstrapFixture()), 'GET /store/products': { body: listingBody([], { facets: facetsFixture({ in_stock: { count: 0 } }) }) } })
    const { router } = renderRoutes(storefrontRoutes, '/shop?on_sale=1&q=ignored')
    const user = userEvent.setup()

    const empty = await screen.findByTestId('listing-empty')
    expect(within(empty).getByRole('heading', { name: 'No products match these filters' })).toBeInTheDocument()
    expect(screen.getByTestId('result-count')).toHaveTextContent('No products found')
    await user.click(within(empty).getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(router.state.location.search).toBe('?q=ignored'))
  })

  it('opens the filters in a drawer on small screens', async () => {
    mockApi({ 'GET /store/bootstrap': ok(bootstrapFixture()), 'GET /store/products': { body: listingBody(cards, { total: 3 }) } })
    renderRoutes(storefrontRoutes, '/shop')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Filters' }))
    const drawer = await screen.findByRole('dialog', { name: 'Filters' })
    expect(within(drawer).getByRole('checkbox', { name: /Sunny/ })).toBeInTheDocument()
    await user.click(within(drawer).getByRole('button', { name: 'Show 3 products' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Filters' })).not.toBeInTheDocument())
  })
})

const category: StoreCategory = {
  id: 'c-1',
  slug: 'juices',
  name: 'Juices',
  description_html: '<p>Freshly pressed.</p>',
  image: null,
  banner: { id: 'm-1', url: '/storage/media/o/banner.jpg', srcset: '/storage/media/o/banner.jpg 1600w', width: 1600, height: 400, alt: null },
  seo: { title: 'Fresh juices', description: null },
  breadcrumbs: [
    { name: 'Home', url: '/' },
    { name: 'Drinks', url: '/category/drinks' },
    { name: 'Juices', url: null },
  ],
  children: [{ slug: 'citrus', name: 'Citrus', image: null, product_count: 4 }],
}

describe('category, brand and search pages', () => {
  it('shows the category header, subcategories and products of the category', async () => {
    const fetchMock = mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/categories/juices': ok(category),
      'GET /store/products': { body: listingBody(cards) },
    })
    renderRoutes(storefrontRoutes, '/category/juices?brand=sunny')

    expect(await screen.findByRole('heading', { level: 1, name: 'Juices' })).toBeInTheDocument()
    expect(screen.getByText('Freshly pressed.')).toBeInTheDocument()
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(crumbs).getByRole('link', { name: 'Drinks' })).toHaveAttribute('href', '/category/drinks')
    expect(within(screen.getByRole('list', { name: 'Subcategories' })).getByRole('link', { name: /Citrus/ })).toHaveAttribute('href', '/category/citrus')
    await waitFor(() => expect(document.title).toBe('Fresh juices | Berry Kids'))

    await screen.findAllByTestId('product-card')
    const request = productsRequests(fetchMock).at(-1)!
    expect(request.get('category')).toBe('juices')
    expect(request.getAll('brand[]')).toEqual(['sunny'])
  })

  it('shows the not-found page for an unknown category or brand', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/categories/nope': fail(404, 'NOT_FOUND'),
      'GET /store/products': fail(404, 'NOT_FOUND'),
      'GET /store/brands/nope': fail(404, 'NOT_FOUND'),
    })
    const { unmount } = renderRoutes(storefrontRoutes, '/category/nope')
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    unmount()

    renderRoutes(storefrontRoutes, '/brand/nope')
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })

  it('lists a brand without the brand filter and with the brand fixed in the query', async () => {
    const fetchMock = mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/brands/sunny': ok({ slug: 'sunny', name: 'Sunny', description: 'Juices from the sun.', logo: null, seo: { title: null, description: null } }),
      'GET /store/products': { body: listingBody(cards) },
    })
    const { router } = renderRoutes(storefrontRoutes, '/brand/sunny')
    const user = userEvent.setup()

    expect(await screen.findByRole('heading', { level: 1, name: 'Sunny' })).toBeInTheDocument()
    expect(screen.getByText('Juices from the sun.')).toBeInTheDocument()
    const filters = within(await screen.findByRole('complementary', { name: 'Filters' }))
    expect(filters.queryByRole('checkbox', { name: /Fresh Co/ })).not.toBeInTheDocument()
    expect(productsRequests(fetchMock).at(-1)?.getAll('brand[]')).toEqual(['sunny'])

    // Within a brand, a category narrows the list in place.
    await user.click(filters.getByRole('button', { name: /Juices/ }))
    await waitFor(() => expect(router.state.location.search).toBe('?category=juices'))
  })

  it('searches for the term from the URL and shows it in the header search', async () => {
    const fetchMock = mockApi({ 'GET /store/bootstrap': ok(bootstrapFixture()), 'GET /store/products': { body: listingBody([], { facets: facetsFixture({ brands: [], attributes: [], categories: [] }) }) } })
    renderRoutes(storefrontRoutes, '/search?q=kiwi')

    expect(await screen.findByRole('heading', { level: 1, name: 'Search results for “kiwi”' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Nothing found for “kiwi”' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Browse all products' })).toHaveAttribute('href', '/shop')
    expect(screen.getByRole('combobox', { name: 'Search products' })).toHaveValue('kiwi')
    expect(productsRequests(fetchMock).at(-1)?.get('q')).toBe('kiwi')
  })

  it('asks for a term on the search page without one', async () => {
    const fetchMock = mockApi({ 'GET /store/bootstrap': ok(bootstrapFixture()) })
    renderRoutes(storefrontRoutes, '/search')

    expect(await screen.findByText('What are you looking for?')).toBeInTheDocument()
    expect(productsRequests(fetchMock)).toHaveLength(0)
  })
})

describe('header search', () => {
  const suggestions = {
    products: [
      { slug: 'mango-juice', name: 'Mango Juice', url: '/product/mango-juice', image: null, price: '120.00' },
      { slug: 'mango-lassi', name: 'Mango Lassi', url: '/product/mango-lassi', image: null, price: '90.00' },
    ],
    categories: [{ slug: 'juices', name: 'Juices', url: '/category/juices' }],
  }

  it('suggests products and categories and is operable with the keyboard', async () => {
    const terms: string[] = []
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/homepage': ok({ sections: [], preview: false }),
      'GET /store/search/suggest': (_init, url) => {
        terms.push(url.searchParams.get('q') ?? '')
        return ok(suggestions)
      },
      'GET /store/products/mango-lassi': fail(404, 'NOT_FOUND'),
    })
    const { router } = renderRoutes(storefrontRoutes)
    const user = userEvent.setup()

    const input = await screen.findByRole('combobox', { name: 'Search products' })
    await user.type(input, 'm')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    await user.type(input, 'an')

    const listbox = await screen.findByRole('listbox', { name: 'Suggestions' })
    await waitFor(() => expect(input).toHaveAttribute('aria-expanded', 'true'))
    expect(await within(listbox).findByRole('option', { name: /Mango Juice/ })).toHaveTextContent('৳120.00')
    expect(terms).toEqual(['man'])
    expect(within(listbox).getByRole('group', { name: 'Categories' })).toBeInTheDocument()
    expect(screen.getByText('3 suggestions available')).toBeInTheDocument()

    await user.keyboard('{ArrowDown}{ArrowDown}')
    const lassi = within(listbox).getByRole('option', { name: /Mango Lassi/ })
    expect(lassi).toHaveAttribute('aria-selected', 'true')
    expect(input).toHaveAttribute('aria-activedescendant', lassi.id)

    await user.keyboard('{Escape}')
    expect(input).toHaveAttribute('aria-expanded', 'false')

    await user.keyboard('{ArrowDown}')
    expect(input).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    await waitFor(() => expect(router.state.location.pathname).toBe('/product/mango-lassi'))
  })

  it('submits the term to the search page', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/homepage': ok({ sections: [], preview: false }),
      'GET /store/search/suggest': ok({ products: [], categories: [] }),
      'GET /store/products': { body: listingBody(cards) },
    })
    const { router } = renderRoutes(storefrontRoutes)
    const user = userEvent.setup()

    await user.type(await screen.findByRole('combobox', { name: 'Search products' }), 'orange juice{Enter}')
    await waitFor(() => expect(router.state.location.pathname + router.state.location.search).toBe('/search?q=orange+juice'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Search results for “orange juice”' })).toBeInTheDocument()
  })

  it('opens from a toggle on small screens', async () => {
    mockApi({ 'GET /store/bootstrap': ok(bootstrapFixture()), 'GET /store/homepage': ok({ sections: [], preview: false }) })
    renderRoutes(storefrontRoutes)
    const user = userEvent.setup()

    const toggle = await screen.findByRole('button', { name: 'Open search' })
    expect(screen.getAllByRole('combobox')).toHaveLength(1)
    await user.click(toggle)
    expect(screen.getByRole('button', { name: 'Close search' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('combobox')).toHaveLength(2)
    expect(screen.getAllByRole('combobox')[1]).toHaveFocus()
  })
})
