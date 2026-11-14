import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { routes } from '@/app/routes'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import type { DocumentSummary } from '../api'
import { categoryRows } from './page-helpers'

/*
 * P1b: the product page areas on the Page builder start screen — content for all products and
 * versions for one category or one product (searchable pickers), delete with confirm, the
 * 100-version limit, and the Bangla words.
 */

const publisher = () => makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage', 'storefront.publish', 'products.view'] })
const viewer = () => makeCurrentUser({ permissions: ['storefront.view'] })

const CLOTHING = '0a000000-0000-4000-8000-000000000001'
const SHOES = '0a000000-0000-4000-8000-000000000002'
const BOOTS = '0a000000-0000-4000-8000-000000000003'
const TOYS = '0a000000-0000-4000-8000-000000000004'
const GONE = '0a000000-0000-4000-8000-000000000005'
const SNEAKER = '0b000000-0000-4000-8000-000000000001'
const BLUE = '0b000000-0000-4000-8000-000000000002'

const published = { version_id: 'v-1', number: 1, published_at: '2026-11-13T08:00:00+00:00' }
const zoneDoc = (over: Partial<DocumentSummary>): DocumentSummary => ({
  id: 'z-x', kind: 'zone', key: 'zone:product.below_price', title: 'Under the price', schema_version: 1, draft_revision: 2, has_unpublished_changes: false,
  draft_updated_at: '2026-11-13T08:00:00+00:00', published: null, path: null, preview_url: null, zone: 'product.below_price', target: null, ...over,
})
const belowAll = zoneDoc({ id: 'z-all', published, preview_url: 'https://shop.test/product/red-sneaker?preview=draft' })
const belowShoes = zoneDoc({ id: 'z-shoes', key: `zone:product.below_price@category:${SHOES}`, title: 'Under the price · Shoes', target: { type: 'category', id: SHOES, name: 'Shoes' } })
const belowSneaker = zoneDoc({
  id: 'z-sneaker', key: `zone:product.below_price@product:${SNEAKER}`, title: 'Under the price · Red sneaker', target: { type: 'product', id: SNEAKER, name: 'Red sneaker' },
  published, preview_url: 'https://shop.test/product/red-sneaker?preview=draft',
})
const bottomGone = zoneDoc({ id: 'z-gone', key: `zone:product.bottom@category:${GONE}`, zone: 'product.bottom', title: 'Product page bottom · Old', target: { type: 'category', id: GONE, name: null } })

const categories = [
  { id: CLOTHING, name: 'Clothing', url: '/category/clothing', parent_id: null, depth: 0 },
  { id: SHOES, name: 'Shoes', url: '/category/shoes', parent_id: CLOTHING, depth: 1 },
  { id: BOOTS, name: 'Boots', url: null, parent_id: SHOES, depth: 2 },
  { id: TOYS, name: 'Toys', url: '/category/toys', parent_id: null, depth: 0 },
]
const products = [
  { id: SNEAKER, name: 'Red sneaker', variants: [{ sku: 'RS-1' }], images: [], is_active: true },
  { id: BLUE, name: 'Blue sneaker', variants: [{ sku: 'BS-1' }], images: [], is_active: false },
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

type Handler = Parameters<typeof mockApi>[0][string]

function mock(user: ReturnType<typeof makeCurrentUser>, documents: DocumentSummary[] | (() => DocumentSummary[]), extra: Record<string, Handler> = {}) {
  const creates: unknown[] = []
  const searches: string[] = []
  mockApi({
    'GET /auth/me': ok(user),
    'GET /storefront/builder/documents': () => ok(typeof documents === 'function' ? documents() : documents),
    'GET /storefront/theme/draft': ok({ settings: { colors: {}, typography: {}, shape: {}, layout: { container_width: 1170, sticky_header: true }, footer: {}, announcement: {} }, draft_revision: 1, has_unpublished_changes: false, published: null }),
    'GET /storefront/link-targets': ok({ pages: [], categories, brands: [], blog_categories: [], blog_posts: [] }),
    'GET /products': (_init, url) => {
      searches.push(url.searchParams.get('search') ?? '')
      return ok(products, { pagination: { current_page: 1, per_page: 24, total: 2, last_page: 1 } })
    },
    'POST /storefront/builder/documents': (init) => {
      const body = JSON.parse(String(init.body)) as { key: string }
      creates.push(body)
      return { status: 201, ...ok({ ...zoneDoc({ id: 'z-new', key: body.key }), content: { schema_version: 1, sections: [] } }) }
    },
    'GET /storefront/builder/documents/z-new': ok({ ...zoneDoc({ id: 'z-new' }), content: { schema_version: 1, sections: [] } }),
    'GET /storefront/builder/elements': ok({ types: [], limits: {}, enums: {} }),
    'GET /storefront/builder/canvas-context': ok({ bootstrap: {}, store_url: null, locales: ['en'] }),
    ...extra,
  })
  return { creates, searches }
}

const zoneSection = (name: string) => screen.getByRole('region', { name })

describe('page builder: product page areas and their versions (P1b)', () => {
  it('lists the three areas with the content for all products and each version with its target', async () => {
    mock(publisher(), [belowAll, belowSneaker, belowShoes, bottomGone])
    renderRoutes(routes, '/storefront/pages')
    const card = await screen.findByTestId('product-zones')
    expect(within(card).getByText('Product pages')).toBeInTheDocument()
    for (const name of ['Under the price', 'Under product details', 'Bottom of product pages']) expect(within(card).getByRole('heading', { name, level: 3 })).toBeInTheDocument()

    // Under the price: all products first, then the category's version, then the product's.
    const below = zoneSection('Under the price')
    const rows = within(within(below).getByRole('list', { name: 'Under the price: content for all products and its versions' })).getAllByRole('listitem')
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual(['page-row-zone:product.below_price', `page-row-zone:product.below_price@category:${SHOES}`, `page-row-zone:product.below_price@product:${SNEAKER}`])
    expect(within(rows[0]!).getByText('All products')).toBeInTheDocument()
    expect(within(rows[0]!).getByText(/Published v1/)).toBeInTheDocument()
    expect(within(rows[0]!).getByRole('link', { name: 'Edit Under the price' })).toHaveAttribute('href', '/storefront/builder/z-all')
    expect(within(rows[1]!).getByText('Category: Shoes')).toBeInTheDocument()
    expect(within(rows[1]!).getByText(/Also on its subcategories/)).toBeInTheDocument()
    expect(within(rows[1]!).getByText('Not published')).toBeInTheDocument()
    expect(within(rows[1]!).getByRole('link', { name: 'Edit Under the price for Shoes' })).toHaveAttribute('href', '/storefront/builder/z-shoes')
    expect(within(rows[2]!).getByText('Product: Red sneaker')).toBeInTheDocument()
    expect(within(rows[2]!).getByRole('link', { name: /View Under the price for Red sneaker/ })).toHaveAttribute('href', 'https://shop.test/product/red-sneaker')
    expect(within(rows[2]!).getByRole('button', { name: 'Delete Under the price for Red sneaker' })).toBeInTheDocument()

    // Nothing for all products yet: "Add content"; a version whose category is gone says so.
    const after = zoneSection('Under product details')
    expect(within(after).getByRole('button', { name: 'Add content: Under product details' })).toBeInTheDocument()
    const gone = within(zoneSection('Bottom of product pages')).getByTestId(`page-row-zone:product.bottom@category:${GONE}`)
    expect(gone).toHaveTextContent('A deleted category')
    expect(gone).toHaveTextContent('Shoppers don’t see this version any more.')

    expect(within(card).getByTestId('zone-version-count')).toHaveTextContent('3 of 100 versions used (all three places together).')
    expect(card).toHaveTextContent('the most specific one shows')
  })

  it('adds a version for a category from a searchable list; categories with a version can’t be picked again', async () => {
    const user = userEvent.setup()
    const calls = mock(publisher(), [belowAll, belowShoes])
    const { router } = renderRoutes(routes, '/storefront/pages')
    await screen.findByTestId('product-zones')
    await user.click(within(zoneSection('Under the price')).getByRole('button', { name: 'Under the price: add a version for a category' }))

    // The tree, indented; Shoes already has a version here.
    expect(await screen.findByRole('option', { name: 'Clothing' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Shoes/ })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('option', { name: /Shoes/ })).toHaveTextContent('has a version')
    expect(screen.getAllByRole('option')).toHaveLength(4)

    // Searching shows each match with its path.
    await user.type(screen.getByRole('combobox', { name: 'Choose a category' }), 'boo')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))
    await user.click(screen.getByRole('option', { name: 'Clothing › Shoes › Boots' }))
    await waitFor(() => expect(calls.creates).toEqual([{ kind: 'zone', key: `zone:product.below_price@category:${BOOTS}`, title: 'Under the price · Boots', from: 'blank' }]))
    await waitFor(() => expect(router.state.location.pathname).toBe('/storefront/builder/z-new'))
  })

  it('adds a version for a product found by the product search', async () => {
    const user = userEvent.setup()
    const calls = mock(publisher(), [zoneDoc({ id: 'z-b', key: `zone:product.bottom@product:${SNEAKER}`, zone: 'product.bottom', target: { type: 'product', id: SNEAKER, name: 'Red sneaker' } })])
    const { router } = renderRoutes(routes, '/storefront/pages')
    await screen.findByTestId('product-zones')
    await user.click(within(zoneSection('Bottom of product pages')).getByRole('button', { name: 'Bottom of product pages: add a version for a product' }))
    expect(await screen.findByRole('option', { name: /Blue sneaker/ })).toHaveTextContent('BS-1 · inactive')
    // The red sneaker has a version in this area already.
    expect(screen.getByRole('option', { name: /Red sneaker/ })).toHaveAttribute('aria-disabled', 'true')

    await user.type(screen.getByRole('combobox', { name: 'Choose a product' }), 'blue')
    await waitFor(() => expect(calls.searches).toContain('blue'))
    await user.click(screen.getByRole('option', { name: /Blue sneaker/ }))
    await waitFor(() => expect(calls.creates).toEqual([{ kind: 'zone', key: `zone:product.bottom@product:${BLUE}`, title: 'Product page bottom · Blue sneaker', from: 'blank' }]))
    await waitFor(() => expect(router.state.location.pathname).toBe('/storefront/builder/z-new'))
  })

  it('deletes a version after confirming; content for all products is created blank', async () => {
    const user = userEvent.setup()
    const deleted: string[] = []
    const calls = mock(publisher(), () => [belowAll, belowShoes].filter((d) => !deleted.includes(d.id)), {
      'DELETE /storefront/builder/documents/z-shoes': () => {
        deleted.push('z-shoes')
        return { status: 204 }
      },
    })
    const { router } = renderRoutes(routes, '/storefront/pages')
    await screen.findByTestId('product-zones')
    await user.click(screen.getByRole('button', { name: 'Delete Under the price for Shoes' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete “Under the price for Shoes”?' })
    expect(confirm).toHaveTextContent('Products in this category then show the next version that fits')
    await user.click(within(confirm).getByRole('button', { name: 'Delete version' }))
    await waitFor(() => expect(screen.queryByTestId(`page-row-zone:product.below_price@category:${SHOES}`)).toBeNull())
    expect(toastSuccess).toHaveBeenCalledWith('Version deleted.')

    await user.click(within(zoneSection('Bottom of product pages')).getByRole('button', { name: 'Add content: Bottom of product pages' }))
    await waitFor(() => expect(calls.creates).toEqual([{ kind: 'zone', key: 'zone:product.bottom', title: 'Product page bottom', from: 'blank' }]))
    await waitFor(() => expect(router.state.location.pathname).toBe('/storefront/builder/z-new'))
  })

  it('at 100 versions the pickers are off; the server’s limit and missing-target refusals are explained', async () => {
    const user = userEvent.setup()
    const many = Array.from({ length: 100 }, (_, i) => {
      const id = `0c000000-0000-4000-8000-${String(i).padStart(12, '0')}`
      return zoneDoc({ id: `z-${i}`, key: `zone:product.after@product:${id}`, zone: 'product.after', target: { type: 'product', id, name: `Product ${i}` } })
    })
    mock(publisher(), many)
    const first = renderRoutes(routes, '/storefront/pages')
    const card = await screen.findByTestId('product-zones')
    expect(within(card).getByRole('status')).toHaveTextContent('You have 100 versions, the most allowed. Delete one to add another.')
    expect(within(zoneSection('Under the price')).getByRole('button', { name: 'Under the price: add a version for a category' })).toBeDisabled()
    expect(within(zoneSection('Under the price')).getByRole('button', { name: 'Under the price: add a version for a product' })).toBeDisabled()
    first.unmount()

    let code = 'ZONE_VERSION_LIMIT'
    mock(publisher(), [belowAll], { 'POST /storefront/builder/documents': () => fail(422, code, 'Refused', code === 'ZONE_VERSION_LIMIT' ? { limit: 100 } : { key: 'x', target_type: 'category', target_id: TOYS }) })
    renderRoutes(routes, '/storefront/pages')
    await screen.findByTestId('product-zones')
    const pick = async () => {
      await user.click(within(zoneSection('Under the price')).getByRole('button', { name: 'Under the price: add a version for a category' }))
      await user.click(await screen.findByRole('option', { name: 'Toys' }))
    }
    await pick()
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('You have 100 versions, the most allowed. Delete one to add another.'))
    code = 'ZONE_TARGET_NOT_FOUND'
    await pick()
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('That category or product no longer exists. Choose another one.'))
  })

  it('people who can only view see the versions without add or delete', async () => {
    mock(viewer(), [belowAll, belowSneaker])
    renderRoutes(routes, '/storefront/pages')
    const card = await screen.findByTestId('product-zones')
    expect(within(card).getByText('Product: Red sneaker')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: /View Under the price for Red sneaker/ })).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /add a version/ })).toBeNull()
    expect(within(card).queryByRole('button', { name: /^Delete/ })).toBeNull()
    expect(within(card).queryByRole('link', { name: /^Edit/ })).toBeNull()
    expect(within(card).queryByTestId('zone-version-count')).toBeNull()
  })

  it('speaks Bangla with the rest of the screen', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem('pos.storeBuilder.pagesLang', 'bn')
    mock(publisher(), [belowAll, belowShoes, belowSneaker])
    renderRoutes(routes, '/storefront/pages')
    const card = await screen.findByTestId('product-zones')
    expect(within(card).getByText('পণ্যের পেজ')).toBeInTheDocument()
    for (const name of ['দামের নিচে', 'পণ্যের বিবরণের নিচে', 'পণ্যের পেজের একদম নিচে']) expect(within(card).getByRole('heading', { name, level: 3 })).toBeInTheDocument()
    expect(within(card).getByText('ক্যাটাগরি: Shoes')).toBeInTheDocument()
    expect(within(card).getByText('পণ্য: Red sneaker')).toBeInTheDocument()
    expect(within(card).getByTestId('zone-version-count')).toHaveTextContent('১০০টির মধ্যে ২টি ভার্সন ব্যবহার হয়েছে')

    await user.click(within(zoneSection('দামের নিচে')).getByRole('button', { name: 'দামের নিচে: একটি ক্যাটাগরির জন্য ভার্সন যোগ করুন' }))
    const search = await screen.findByRole('combobox', { name: 'একটি ক্যাটাগরি বেছে নিন' })
    expect(search.closest('[lang]')).toHaveAttribute('lang', 'bn')
    expect(await screen.findByRole('option', { name: /Shoes/ })).toHaveTextContent('ভার্সন আছে')
  })
})

describe('category picker rows', () => {
  it('gives each category its depth and path, tolerating loops and unknown parents', () => {
    const rows = categoryRows([
      ...categories,
      { id: 'loop-a', name: 'A', parent_id: 'loop-b' },
      { id: 'loop-b', name: 'B', parent_id: 'loop-a' },
      { id: 'orphan', name: 'Orphan', parent_id: 'missing' },
    ])
    expect(rows.find((r) => r.id === BOOTS)).toEqual({ id: BOOTS, name: 'Boots', depth: 2, path: 'Clothing › Shoes › Boots' })
    expect(rows.find((r) => r.id === 'loop-a')).toMatchObject({ path: 'B › A', depth: 1 })
    expect(rows.find((r) => r.id === 'orphan')).toMatchObject({ path: 'Orphan', depth: 0 })
  })
})
