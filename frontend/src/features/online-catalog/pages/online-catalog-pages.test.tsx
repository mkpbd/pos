import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import type { Product } from '@/features/products/api'
import type { BrandListingResponse, CategoryListingResponse, WebBrandRow, WebCategoryRow } from '@/features/online-catalog/api'
import { listingResponse } from '@/features/online-catalog/test-data'
import { CATALOG_MANAGER_PERMISSIONS, makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: vi.fn(), success: toastSuccess }) }
})

const editor = (extra: string[]) => makeCurrentUser({ permissions: [...CATALOG_MANAGER_PERMISSIONS, ...extra] })
const storeManager = () => makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage', 'online_catalog.view', 'online_catalog.manage', 'media.manage', 'products.view'] })
const emptyMedia = ok([], { pagination: { current_page: 1, per_page: 100, total: 0, last_page: 1 } })

const product: Product = {
  id: 'p-1', name: 'Mango Juice', description: null, type: 'standard', category: null, brand: null,
  unit: { id: 'u-pcs', name: 'Piece', code: 'pcs', allow_decimal: false }, tax_rate: null,
  track_stock: true, track_batches: false, track_serials: false, max_discount_percent: null, options: [{ name: 'Size', values: ['1L', '2L'] }], is_active: true, archived_at: null,
  variants: [
    { id: 'v-1', sku: 'MJ-1L', name: null, option_values: { Size: '1L' }, purchase_price: '90.00', selling_price: '120.00', wholesale_price: null, reorder_level: '0.000', barcodes: [], is_active: true },
    { id: 'v-2', sku: 'MJ-2L', name: null, option_values: { Size: '2L' }, purchase_price: '110.00', selling_price: '150.00', wholesale_price: null, reorder_level: '0.000', barcodes: [], is_active: true },
  ],
  images: [],
}

const editorApi = {
  'GET /categories': ok([]),
  'GET /brands': ok([]),
  'GET /units': ok([{ id: 'u-pcs', name: 'Piece', code: 'pcs', allow_decimal: false, base_unit_id: null, conversion_factor: null, is_active: true }]),
  'GET /tax-rates': ok([]),
  'GET /attributes': ok([]),
  'GET /products/p-1': ok(product),
}

const orange = { id: 'p-9', name: 'Orange Juice', description: null, type: 'standard', category: null, brand: null, unit: null, tax_rate: null, track_stock: true, track_batches: false, track_serials: false, max_discount_percent: null, options: null, is_active: true, archived_at: null, variants: [{ id: 'v-9', sku: 'OJ-1', name: null, option_values: {}, selling_price: '80.00', wholesale_price: null, reorder_level: '0', barcodes: [], is_active: true }], images: [] }
const apple = { ...orange, id: 'p-8', name: 'Apple Juice', variants: [{ ...orange.variants[0], id: 'v-8', sku: 'AJ-1' }] }

describe('product editor → online store', () => {
  it('edits and saves the listing with related products', async () => {
    const user = userEvent.setup()
    let listingBody: Record<string, unknown> | undefined
    let relatedBody: unknown
    mockApi({
      'GET /auth/me': ok(editor(['online_catalog.view', 'online_catalog.manage'])),
      ...editorApi,
      'GET /online-catalog/products/p-1': ok(listingResponse()),
      'GET /products': ok([product, orange, apple], { pagination: { current_page: 1, per_page: 25, total: 3, last_page: 1 } }),
      'PUT /online-catalog/products/p-1': (init) => {
        listingBody = JSON.parse(String(init.body)) as Record<string, unknown>
        return ok(listingResponse({ is_featured: true }))
      },
      'PUT /online-catalog/products/p-1/related': (init) => {
        relatedBody = JSON.parse(String(init.body))
        return ok({ related: [], frequently_bought: [] })
      },
    })
    renderRoutes(routes, '/products/p-1')

    const section = await screen.findByRole('form', { name: 'Online listing' })
    const card = section.closest('#online-store') as HTMLElement
    expect(within(card).getByText('Live')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'View on store' })).toHaveAttribute('href', '/product/mango-juice')
    expect(within(section).getByText('/product/mango-juice')).toBeInTheDocument()

    await user.click(within(section).getByRole('switch', { name: 'Featured' }))
    const compare = within(section).getByLabelText('Compare-at price for 1L · MJ-1L')
    await user.type(compare, '130')
    await user.click(within(section).getByRole('button', { name: 'Add specification' }))
    await user.type(within(section).getByLabelText('Specification 2 label'), 'Origin')
    await user.type(within(section).getByLabelText('Specification 2 value'), 'Rajshahi')
    await user.type(within(section).getByLabelText('SEO title'), 'Mango juice 1L')
    expect(within(section).getByText(/14\/70/)).toBeInTheDocument()

    // Related list: Orange Juice already chosen; move Apple Juice to the top.
    await user.click(within(section).getByRole('button', { name: 'Add related product' }))
    await user.click(await screen.findByRole('option', { name: /Apple Juice/ }))
    const related = within(section).getByRole('list', { name: 'Related products' })
    expect(within(related).getAllByRole('listitem').map((li) => li.textContent)).toEqual([expect.stringContaining('Orange Juice'), expect.stringContaining('Apple Juice')])
    await user.click(within(section).getByRole('button', { name: 'Move Apple Juice up' }))

    await user.click(within(section).getByRole('button', { name: 'Save online listing' }))

    await waitFor(() => expect(relatedBody).toEqual({ related: ['p-8', 'p-9'], frequently_bought: [] }))
    expect(listingBody).toMatchObject({
      slug: 'mango-juice',
      is_featured: true,
      seo_title: 'Mango juice 1L',
      specifications: [{ label: 'Volume', value: '1 litre' }, { label: 'Origin', value: 'Rajshahi' }],
      variants: [{ variant_id: 'v-1', compare_at_price: '130', image_id: null }, { variant_id: 'v-2', compare_at_price: '180.00', image_id: 'img-2' }],
    })
    expect(toastSuccess).toHaveBeenCalledWith('Online listing saved.')
  })

  it('checks compare-at prices before sending and shows server errors on the right rows', async () => {
    const user = userEvent.setup()
    let puts = 0
    mockApi({
      'GET /auth/me': ok(editor(['online_catalog.view', 'online_catalog.manage'])),
      ...editorApi,
      'GET /online-catalog/products/p-1': ok(listingResponse()),
      'PUT /online-catalog/products/p-1': () => {
        puts++
        return fail(422, 'VALIDATION_FAILED', 'The given data was invalid.', { 'variants.1.compare_at_price': ['Must be above 150.00.'], slug: ['This address is already used.'] })
      },
    })
    renderRoutes(routes, '/products/p-1')

    const section = await screen.findByRole('form', { name: 'Online listing' })
    const first = within(section).getByLabelText('Compare-at price for 1L · MJ-1L')
    await user.type(first, '100')
    await user.click(within(section).getByRole('button', { name: 'Save online listing' }))
    expect(await within(section).findByText('Must be higher than the selling price.')).toBeInTheDocument()
    expect(puts).toBe(0)

    await user.clear(first)
    await user.type(first, '125.50')
    await user.click(within(section).getByRole('button', { name: 'Save online listing' }))
    expect(await within(section).findByText('Must be above 150.00.')).toBeInTheDocument()
    expect(within(section).getByLabelText('Compare-at price for 2L · MJ-2L')).toHaveAttribute('aria-invalid', 'true')
    expect(within(section).getByText('This address is already used.')).toBeInTheDocument()
  })

  it('suggests a slug for a product that was never listed and shows the draft state', async () => {
    mockApi({
      'GET /auth/me': ok(editor(['online_catalog.view', 'online_catalog.manage'])),
      ...editorApi,
      'GET /online-catalog/products/p-1': ok({ ...listingResponse({ exists: false, is_published: false, state: 'draft' }), variants: [], related: { related: [], frequently_bought: [] } }),
    })
    renderRoutes(routes, '/products/p-1')

    const section = await screen.findByRole('form', { name: 'Online listing' })
    expect(within(section.closest('#online-store') as HTMLElement).getByText('Draft')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'View on store' })).not.toBeInTheDocument()
    // A new listing can be saved as is.
    expect(within(section).getByRole('button', { name: 'Save online listing' })).toBeEnabled()
    expect(within(section).queryByLabelText('Publish from')).not.toBeInTheDocument()
  })

  it('is read-only with online_catalog.view and absent without it', async () => {
    mockApi({
      'GET /auth/me': ok(editor(['online_catalog.view'])),
      ...editorApi,
      'GET /online-catalog/products/p-1': ok(listingResponse()),
    })
    const { unmount } = renderRoutes(routes, '/products/p-1')

    const section = await screen.findByRole('form', { name: 'Online listing' })
    expect(within(section).getByLabelText('Web address')).toBeDisabled()
    expect(within(section).queryByRole('button', { name: 'Save online listing' })).not.toBeInTheDocument()
    expect(within(section).queryByRole('button', { name: 'Add related product' })).not.toBeInTheDocument()
    unmount()

    mockApi({ 'GET /auth/me': ok(editor([])), ...editorApi })
    renderRoutes(routes, '/products/p-1')
    expect(await screen.findByRole('heading', { name: 'Mango Juice' })).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Online listing' })).not.toBeInTheDocument()
  })

  it('opens the listing on its own page for online store staff', async () => {
    mockApi({
      'GET /auth/me': ok(storeManager()),
      'GET /online-catalog/products/p-1': ok(listingResponse()),
    })
    renderRoutes(routes, '/products/p-1/online-store')

    expect(await screen.findByRole('heading', { name: 'Mango Juice' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Save online listing' })).toBeInTheDocument()
  })
})

const categoryRows: WebCategoryRow[] = [
  { id: 'c-1', name: 'Drinks', parent_id: null, depth: 0, is_active: true, listing: { slug: 'drinks', is_visible: true } },
  { id: 'c-2', name: 'Juices', parent_id: 'c-1', depth: 1, is_active: true, listing: null },
  { id: 'c-3', name: 'Snacks', parent_id: null, depth: 0, is_active: true, listing: { slug: 'snacks', is_visible: false } },
]

const juices: CategoryListingResponse = {
  category: { id: 'c-2', name: 'Juices', parent_id: 'c-1', is_active: true },
  listing: { exists: false, slug: 'juices', is_visible: true, image_media_id: null, banner_media_id: null, description_html: null, seo_title: null, seo_description: null },
  url: '/category/juices',
}

describe('online store → categories and brands', () => {
  it('lists categories as a tree with their web status and saves a listing', async () => {
    const user = userEvent.setup()
    let saved: unknown
    mockApi({
      'GET /auth/me': ok(storeManager()),
      'GET /online-catalog/categories': ok(categoryRows),
      'GET /online-catalog/categories/c-2': ok(juices),
      'PUT /online-catalog/categories/c-2': (init) => {
        saved = JSON.parse(String(init.body))
        return ok({ ...juices, listing: { ...juices.listing, exists: true, slug: 'fresh-juices' } })
      },
      'GET /media': emptyMedia,
    })
    renderRoutes(routes, '/storefront/categories')

    const table = await screen.findByRole('table')
    const rows = within(table).getAllByRole('row')
    expect(rows[1]).toHaveTextContent('Visible')
    expect(within(rows[1]!).getByRole('link', { name: /\/category\/drinks/ })).toHaveAttribute('href', '/category/drinks')
    expect(rows[2]).toHaveTextContent('Not listed')
    expect(rows[3]).toHaveTextContent('Hidden')
    expect(screen.getByRole('link', { name: 'Categories' })).toHaveAttribute('aria-current', 'page')

    await user.click(screen.getByRole('button', { name: 'Edit web listing of Juices' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('/category/juices')).toBeInTheDocument()
    await user.clear(within(dialog).getByLabelText('Web address'))
    await user.type(within(dialog).getByLabelText('Web address'), 'Fresh-Juices')
    await user.type(within(dialog).getByLabelText('Meta description'), 'Cold pressed.')
    expect(within(dialog).getByText('13/160')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Save listing' }))

    await waitFor(() => expect(saved).toEqual({ slug: 'fresh-juices', is_visible: true, image_media_id: null, banner_media_id: null, description_html: null, seo_title: null, seo_description: 'Cold pressed.' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(toastSuccess).toHaveBeenCalledWith('Juices listing saved.')
  })

  it('edits a brand listing and shows field errors from the server', async () => {
    const user = userEvent.setup()
    const brands: WebBrandRow[] = [{ id: 'b-1', name: 'Pran', is_active: true, listing: null }]
    const pran: BrandListingResponse = {
      brand: { id: 'b-1', name: 'Pran', is_active: true },
      listing: { exists: false, slug: 'pran', is_visible: true, logo_media_id: null, description: null, seo_title: null, seo_description: null },
      url: '/brand/pran',
    }
    mockApi({
      'GET /auth/me': ok(storeManager()),
      'GET /online-catalog/brands': ok(brands),
      'GET /online-catalog/brands/b-1': ok(pran),
      'PUT /online-catalog/brands/b-1': fail(422, 'VALIDATION_FAILED', 'Invalid.', { slug: ['This address is already used.'] }),
    })
    renderRoutes(routes, '/storefront/brands')

    await user.click(await screen.findByRole('button', { name: 'Edit web listing of Pran' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Description'), 'Since 1981.')
    await user.click(within(dialog).getByRole('switch', { name: 'Visible on the store' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save listing' }))

    expect(await within(dialog).findByText('This address is already used.')).toBeInTheDocument()
  })

  it('hides edit buttons without online_catalog.manage', async () => {
    mockApi({
      'GET /auth/me': ok(makeCurrentUser({ permissions: ['storefront.view', 'online_catalog.view'] })),
      'GET /online-catalog/categories': ok(categoryRows),
    })
    renderRoutes(routes, '/storefront/categories')

    expect(await screen.findByText(/Juices/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit web listing/ })).not.toBeInTheDocument()
  })
})
