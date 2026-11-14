import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { RECENTLY_VIEWED_KEY } from './catalog/recently-viewed'
import { storefrontRoutes } from './routes'
import { bootstrapFixture, listingBody, productCard, productDetail } from './test-fixtures'
import type { StoreSection } from './types'

afterEach(() => localStorage.clear())

const related = { related: [productCard('kids-shorts')], frequently_bought: [productCard('kids-socks', { price: '80.00', price_max: '80.00' })] }

function serveProduct(overrides: { bootstrap?: ReturnType<typeof bootstrapFixture>; recent?: string[] } = {}) {
  const slugRequests: string[] = []
  const fetchMock = mockApi({
    'GET /store/bootstrap': ok(overrides.bootstrap ?? bootstrapFixture()),
    'GET /store/products/kids-tee': ok(productDetail()),
    'GET /store/products/kids-tee/related': ok(related),
    'GET /store/products': (_init, url) => {
      slugRequests.push(url.searchParams.get('slugs') ?? '')
      return { body: listingBody((overrides.recent ?? []).map((slug) => productCard(slug)), { facets: null }) }
    },
  })
  return { fetchMock, slugRequests }
}

describe('product page', () => {
  it('shows the product with its default variant, tabs and related products', async () => {
    serveProduct()
    renderRoutes(storefrontRoutes, '/product/kids-tee')
    const user = userEvent.setup()

    expect(await screen.findByRole('heading', { level: 1, name: 'Kids Tee' })).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('Kids Tee | Berry Kids'))
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: 'Clothing' })).toHaveAttribute('href', '/category/clothing')
    expect(screen.getByRole('link', { name: 'Fresh Co' })).toHaveAttribute('href', '/brand/fresh-co')

    const page = screen.getByTestId('product-page')
    expect(within(page).getAllByTestId('price')[0]).toHaveTextContent('৳450.00')
    // The summary's struck price (P1b: "Frequently bought together" repeats it for this item).
    expect(within(screen.getByTestId('product-summary')).getByText('৳500.00', { exact: false }).tagName).toBe('S')
    expect(within(page).getByText('−10 %')).toBeInTheDocument()
    expect(screen.getByTestId('availability')).toHaveTextContent('In stock')
    expect(screen.getByTestId('sku')).toHaveTextContent('TEE-RM')
    expect(screen.queryByText('Excl. VAT')).not.toBeInTheDocument()
    expect(within(page).getByText('New')).toBeInTheDocument()

    // Description and specifications tabs (arrow keys move between them).
    const tablist = screen.getByRole('tablist', { name: 'Product information' })
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Made from organic cotton.')
    within(tablist).getByRole('tab', { name: 'Description' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(within(tablist).getByRole('tab', { name: 'Specifications' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('rowheader', { name: 'Material' })).toBeInTheDocument()

    expect(await screen.findByRole('region', { name: 'Related products' })).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Frequently bought together' })).getByRole('link', { name: 'Kids Socks' })).toHaveAttribute('href', '/product/kids-socks')
  })

  it('switches variants: price, SKU, availability, image and the URL follow; impossible combinations are disabled', async () => {
    serveProduct()
    const { router } = renderRoutes(storefrontRoutes, '/product/kids-tee')
    const user = userEvent.setup()

    const selector = await screen.findByTestId('variant-selector')
    const sizes = within(selector).getByRole('group', { name: /Size/ })
    const colours = within(selector).getByRole('group', { name: /Colour/ })
    expect(within(colours).getByRole('radio', { name: 'Colour: Red' })).toBeChecked()
    // Red L exists but is sold out: selectable, marked.
    expect(within(sizes).getByRole('radio', { name: 'L (sold out)' })).toBeEnabled()

    await user.click(within(sizes).getByRole('radio', { name: 'L (sold out)' }))
    expect(screen.getByTestId('availability')).toHaveTextContent('Out of stock')
    expect(router.state.location.search).toBe('?variant=v-red-l')

    // Blue exists only in L: choosing it keeps L; M is impossible with Blue.
    await user.click(within(colours).getByRole('radio', { name: 'Colour: Blue' }))
    expect(screen.getByTestId('sku')).toHaveTextContent('TEE-BL')
    expect(screen.getAllByTestId('price')[0]).toHaveTextContent('৳480.00')
    expect(screen.getByTestId('availability')).toHaveTextContent('Only a few left')
    expect(within(sizes).getByRole('radio', { name: 'M' })).toBeDisabled()
    expect(router.state.location.search).toBe('?variant=v-blue-l')
    expect(within(screen.getByRole('list', { name: 'Product images' })).getByRole('button', { name: 'Show image 2 of 2' })).toHaveAttribute('aria-current', 'true')
  })

  it('starts with the variant from the URL and marks prices excluding VAT', async () => {
    const base = bootstrapFixture()
    serveProduct({ bootstrap: { ...base, store: { ...base.store, prices_include_tax: false } } })
    renderRoutes(storefrontRoutes, '/product/kids-tee?variant=v-blue-l')

    expect(await screen.findByTestId('sku')).toHaveTextContent('TEE-BL')
    expect(screen.getByText('Excl. VAT')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show image 2 of 2' })).toHaveAttribute('aria-current', 'true')
  })

  it('opens the gallery lightbox and steps through images with the keyboard', async () => {
    serveProduct()
    renderRoutes(storefrontRoutes, '/product/kids-tee')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Open Kids Tee, image 1 of 2 full screen' }))
    const lightbox = await screen.findByRole('dialog', { name: 'Kids Tee, image 1 of 2' })
    expect(within(lightbox).getByRole('img', { name: 'Red tee' })).toBeInTheDocument()
    await user.keyboard('{ArrowRight}')
    expect(within(screen.getByRole('dialog')).getByRole('img', { name: 'Blue tee' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Show image 2 of 2' })).toHaveAttribute('aria-current', 'true')
  })

  it('remembers viewed products and shows earlier ones fetched fresh by slug', async () => {
    localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(['kids-tee', 'kids-hat', 'kids-cap']))
    const { slugRequests } = serveProduct({ recent: ['kids-hat', 'kids-cap'] })
    renderRoutes(storefrontRoutes, '/product/kids-tee')

    const recent = await screen.findByRole('region', { name: 'Recently viewed' })
    expect(within(recent).getAllByTestId('product-card')).toHaveLength(2)
    expect(slugRequests).toEqual(['kids-hat,kids-cap'])
    await waitFor(() => expect(JSON.parse(localStorage.getItem(RECENTLY_VIEWED_KEY) ?? '[]')).toEqual(['kids-tee', 'kids-hat', 'kids-cap']))
  })

  it('hides empty tabs and sections and shows the not-found page for unknown products', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/products/plain': ok(productDetail({ slug: 'plain', description_html: null, specifications: [], options: [], variants: [productDetail().variants[0]!] })),
      'GET /store/products/plain/related': ok({ related: [], frequently_bought: [] }),
      'GET /store/products/plain/reviews': ok([], { summary: { average: '0.0', count: 0, distribution: {} } }),
      'GET /store/products/gone': fail(404, 'NOT_FOUND'),
    })
    const { unmount } = renderRoutes(storefrontRoutes, '/product/plain')

    expect(await screen.findByRole('heading', { level: 1, name: 'Kids Tee' })).toBeInTheDocument()
    // Without a description or specifications only the Reviews tab is left (E9).
    expect(within(screen.getByRole('tablist')).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Reviews'])
    expect(await screen.findByText('No reviews yet')).toBeInTheDocument()
    expect(screen.queryByTestId('rating-summary')).not.toBeInTheDocument()
    expect(screen.queryByTestId('variant-selector')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Related products' })).not.toBeInTheDocument()
    unmount()

    renderRoutes(storefrontRoutes, '/product/gone')
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })
})

describe('quick view', () => {
  it('opens from a card with gallery, variants and a link to the full page', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/products': { body: listingBody([productCard('kids-tee', { price: '450.00', price_max: '480.00' })]) },
      'GET /store/products/kids-tee': ok(productDetail()),
      'GET /store/products/kids-tee/related': ok(related),
    })
    const { router } = renderRoutes(storefrontRoutes, '/shop')
    const user = userEvent.setup()

    const trigger = await screen.findByRole('button', { name: 'Quick view: Kids Tee' })
    await user.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: 'Kids Tee' })
    expect(within(dialog).getByTestId('product-gallery')).toBeInTheDocument()
    expect(within(dialog).getByTestId('sku')).toHaveTextContent('TEE-RM')
    expect(within(dialog).getByRole('button', { name: 'Add to cart' })).toBeEnabled()
    expect(within(dialog).getByRole('button', { name: 'Add to wishlist' })).toHaveAttribute('aria-pressed', 'false')

    await user.click(within(dialog).getByRole('radio', { name: 'Colour: Blue' }))
    expect(within(dialog).getAllByTestId('price')[0]).toHaveTextContent('৳480.00')
    const details = within(dialog).getByRole('link', { name: 'View full details' })
    expect(details).toHaveAttribute('href', '/product/kids-tee?variant=v-blue-l')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()

    await user.click(trigger)
    await user.click(within(await screen.findByRole('dialog')).getByRole('link', { name: 'View full details' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/product/kids-tee'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Kids Tee' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

const productSections: StoreSection[] = [
  {
    id: 's-1',
    type: 'product_carousel',
    title: 'Featured',
    subtitle: null,
    config: { source: 'featured', limit: 8, view_all_url: '/shop' },
    products: [productCard('mango-juice'), productCard('orange-juice')],
  },
  { id: 's-2', type: 'product_grid', title: 'Hot products', subtitle: null, config: { source: 'best_sellers', limit: 8, columns: 5 }, products: [productCard('apple-juice')] },
  {
    id: 's-3',
    type: 'product_tabs',
    title: 'New collection',
    subtitle: null,
    config: { tabs: [{ label: 'New arrivals', source: 'new_arrivals' }, { label: 'On sale', source: 'on_sale' }, { label: 'Best sellers', source: 'best_sellers' }], limit: 8 },
    tabs: [
      { label: 'New arrivals', products: [productCard('kiwi-juice')] },
      { label: 'On sale', products: [productCard('lime-juice', { on_sale: true, compare_at_price: '150.00', discount_percent: 20 })] },
      { label: 'Best sellers', products: [] },
    ],
  },
  {
    id: 's-4',
    type: 'category_strip',
    title: 'Shop by category',
    subtitle: null,
    config: { source: 'top_level', limit: 8 },
    categories: [{ slug: 'juices', name: 'Juices', url: '/category/juices', image: null, product_count: 12 }],
  },
  { id: 's-5', type: 'brand_strip', title: null, subtitle: null, config: { source: 'all', limit: 8 }, brands: [{ slug: 'sunny', name: 'Sunny', url: '/brand/sunny', logo: null }] },
]

describe('homepage product sections', () => {
  it('renders carousels, grids, tabs and category and brand strips', async () => {
    mockApi({ 'GET /store/bootstrap': ok(bootstrapFixture()), 'GET /store/homepage': ok({ sections: productSections, preview: false }) })
    renderRoutes(storefrontRoutes)
    const user = userEvent.setup()

    const rendered = await screen.findAllByTestId('homepage-section')
    expect(rendered.map((el) => el.dataset.sectionType)).toEqual(['product_carousel', 'product_grid', 'product_tabs', 'category_strip', 'brand_strip'])

    const carousel = screen.getByRole('region', { name: 'Featured' })
    expect(within(carousel).getAllByTestId('product-card')).toHaveLength(2)
    expect(within(rendered[0]!).getByRole('link', { name: 'View all' })).toHaveAttribute('href', '/shop')
    expect(within(rendered[1]!).getByRole('list').className).toContain('lg:grid-cols-5')

    const tabs = within(rendered[2]!).getByRole('tablist', { name: 'New collection' })
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['New arrivals', 'On sale'])
    expect(within(rendered[2]!).getByRole('link', { name: 'Kiwi Juice' })).toBeInTheDocument()
    await user.click(within(tabs).getByRole('tab', { name: 'On sale' }))
    expect(within(rendered[2]!).getByRole('link', { name: 'Lime Juice' })).toBeInTheDocument()
    expect(within(rendered[2]!).getByText('Sale −20 %')).toBeInTheDocument()

    expect(within(rendered[3]!).getByRole('link', { name: /Juices/ })).toHaveAttribute('href', '/category/juices')
    expect(within(rendered[3]!).getByText('12 products')).toBeInTheDocument()
    expect(within(rendered[4]!).getByRole('link', { name: 'Sunny' })).toHaveAttribute('href', '/brand/sunny')

    // Strips that need no scrolling sit centred under their centred heading; product rails stay left-aligned.
    expect(within(rendered[3]!).getByRole('list')).toHaveAttribute('data-centered', 'true')
    expect(within(rendered[3]!).getByRole('list')).toHaveClass('justify-center')
    expect(within(rendered[4]!).getByRole('list')).toHaveAttribute('data-centered', 'true')
    expect(within(carousel).getAllByRole('list')[0]!).not.toHaveAttribute('data-centered')
    // The first slide snaps flush with the content edge (scroll padding = the track's padding).
    expect(within(carousel).getAllByRole('list')[0]!).toHaveClass('scroll-px-1')
  })

  it('marks empty product sections in a preview and never draws them otherwise', async () => {
    const empty: StoreSection = { ...productSections[0]!, products: [], state: 'empty' } as StoreSection
    mockApi({ 'GET /store/bootstrap': ok(bootstrapFixture()), 'GET /store/homepage': ok({ sections: [empty], preview: true }) })
    const { unmount } = renderRoutes(storefrontRoutes, '/?preview=1')
    expect(await screen.findByText('No products to show — visitors do not see this section')).toBeInTheDocument()
    unmount()

    mockApi({ 'GET /store/bootstrap': ok(bootstrapFixture()), 'GET /store/homepage': ok({ sections: [{ ...empty, state: undefined }, productSections[3]], preview: false }) })
    renderRoutes(storefrontRoutes)
    const rendered = await screen.findAllByTestId('homepage-section')
    expect(rendered.map((el) => el.dataset.sectionType)).toEqual(['category_strip'])
  })
})
