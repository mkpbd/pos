import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import type { HomepageSection, SectionTypeInfo } from '@/features/storefront/api'
import { normalizeCatalogConfig, validateCatalogSection } from '@/features/storefront/catalog-sections'
import { decodeTarget, encodeTarget, fromApi, toApi, validateTree } from '@/features/storefront/menu-tree'
import { branchesWithStores, makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: vi.fn(), success: toastSuccess }) }
})

const manager = () => makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage', 'media.manage', 'products.view', 'branches.view', 'online_catalog.view', 'online_catalog.manage'] })
const settings = { is_enabled: true, site_name: 'Berry Kids', meta_description: null, fulfilment_store_id: null, updated_at: null }

const catalogTypes: SectionTypeInfo[] = [
  { type: 'product_carousel', label: 'Product carousel', description: 'A sliding row of products.', banner_placement: null, items: null, defaults: { source: 'featured', category_id: null, limit: 8, view_all_url: null } },
  { type: 'product_grid', label: 'Product grid', description: 'Products in a grid.', banner_placement: null, items: null, defaults: { source: 'new_arrivals', category_id: null, limit: 8, columns: 4, view_all_url: null } },
  { type: 'product_tabs', label: 'Product tabs', description: 'Tabs of products.', banner_placement: null, items: null, defaults: { tabs: [{ label: 'New arrivals', source: 'new_arrivals', category_id: null }, { label: 'Best sellers', source: 'best_sellers', category_id: null }], limit: 8 } },
  { type: 'category_strip', label: 'Category strip', description: 'Category tiles.', banner_placement: null, items: null, defaults: { source: 'top_level', limit: 8 } },
  { type: 'brand_strip', label: 'Brand strip', description: 'Brand logos.', banner_placement: null, items: null, defaults: { source: 'all', limit: 12 } },
]

const categories = [
  { id: 'c-1', parent_id: null, name: 'Drinks', description: null, sort_order: 0, is_active: true },
  { id: 'c-2', parent_id: 'c-1', name: 'Juices', description: null, sort_order: 0, is_active: true },
]
const products = [
  { id: 'p-1', name: 'Mango Juice', variants: [{ sku: 'MJ-1' }], images: [{ url: '/storage/mj.png' }], is_active: true },
  { id: 'p-2', name: 'Orange Juice', variants: [{ sku: 'OJ-1' }], images: [], is_active: true },
]

const section = (overrides: Partial<HomepageSection>): HomepageSection => ({
  id: 's-1', type: 'product_carousel', type_label: 'Product carousel', title: 'Picks', subtitle: null,
  config: catalogTypes[0]!.defaults, banner_ids: [], is_enabled: true, starts_at: null, ends_at: null, state: 'live', sort_order: 0, updated_at: null,
  ...overrides,
})

describe('catalog section helpers', () => {
  it('validates limits, categories, tabs and hand-picked items', () => {
    expect(validateCatalogSection('product_carousel', { source: 'manual', category_id: null, limit: 8, view_all_url: null }, 0)).toEqual({ item_ids: 'Pick at least one product.' })
    expect(validateCatalogSection('product_grid', { source: 'category', category_id: null, limit: 30, columns: 4, view_all_url: 'javascript:x' }, 0)).toEqual({
      'config.limit': 'Between 4 and 24.',
      'config.category_id': 'Choose a category.',
      'config.view_all_url': 'Use a site path such as /shop or an http(s) URL.',
    })
    expect(validateCatalogSection('product_tabs', { tabs: [{ label: ' ', source: 'category', category_id: null }], limit: 8 }, 0)).toEqual({
      'config.tabs': 'Add 2 to 5 tabs.',
      'config.tabs.0.label': 'Enter a label.',
      'config.tabs.0.category_id': 'Choose a category.',
    })
    expect(validateCatalogSection('brand_strip', { source: 'all', limit: 12 }, 0)).toEqual({})
    expect(validateCatalogSection('category_strip', { source: 'manual', limit: 8 }, 17)).toEqual({ item_ids: 'Pick at most 16.' })
  })

  it('drops the category unless the category source is used', () => {
    expect(normalizeCatalogConfig('product_carousel', { source: 'featured', category_id: 'c-1', limit: 8, view_all_url: ' /shop ' })).toEqual({ source: 'featured', category_id: null, limit: 8, view_all_url: '/shop' })
  })

  it('encodes menu link targets and saves category and brand items', () => {
    expect(decodeTarget(encodeTarget('category', 'c-1'))).toEqual({ type: 'category', id: 'c-1' })
    expect(decodeTarget('custom')).toBeNull()
    const nodes = fromApi([{ type: 'brand', label: 'Pran', url: null, target_id: null, open_in_new_tab: false, is_visible: true, is_mega: false, mega_columns: null, image_media_id: null, children: [] }])
    expect(validateTree(nodes, true)).toEqual({ 'items.0.target_id': 'Choose a brand.' })
    expect(toApi([{ ...nodes[0]!, target_id: 'b-1', url: '/old' }])[0]).toMatchObject({ type: 'brand', target_id: 'b-1', url: null })
  })
})

describe('online store settings and builders (E6)', () => {
  it('chooses the fulfilment store', async () => {
    const user = userEvent.setup()
    let patched: unknown
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/settings': ok(settings),
      'GET /storefront/domains': ok([]),
      'GET /branches': ok(branchesWithStores(), { pagination: { current_page: 1, per_page: 100, total: 1, last_page: 1 } }),
      'PATCH /storefront/settings': (init) => {
        patched = JSON.parse(String(init.body))
        return ok({ ...settings, fulfilment_store_id: 's-2' })
      },
    })
    renderRoutes(routes, '/storefront')

    expect(await screen.findByText('Stock-tracked products show as out of stock until a fulfilment store is chosen.')).toBeInTheDocument()
    const select = screen.getByRole('combobox', { name: 'Fulfilment store' })
    expect(select).toHaveTextContent('No fulfilment store')
    await user.click(select)
    await user.click(await screen.findByRole('option', { name: 'Warehouse (WH)' }))

    await waitFor(() => expect(patched).toEqual({ fulfilment_store_id: 's-2' }))
    expect(toastSuccess).toHaveBeenCalledWith('Fulfilment store saved.')
  })

  it('adds a hand-picked product carousel with ordered products', async () => {
    const user = userEvent.setup()
    let created: Record<string, unknown> | undefined
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/homepage-sections/types': ok(catalogTypes),
      'GET /storefront/homepage-sections': ok([]),
      'GET /categories': ok(categories),
      'GET /products': ok(products, { pagination: { current_page: 1, per_page: 25, total: 2, last_page: 1 } }),
      'POST /storefront/homepage-sections': (init) => {
        created = JSON.parse(String(init.body)) as Record<string, unknown>
        return { status: 201, ...ok(section({ item_ids: ['p-2', 'p-1'] })) }
      },
    })
    renderRoutes(routes, '/storefront/homepage')

    await user.click(await screen.findByRole('button', { name: 'Add section' }))
    await user.click(await screen.findByRole('button', { name: /Product carousel/ }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Title'), 'Our picks')

    await user.click(within(dialog).getByRole('combobox', { name: 'Products' }))
    await user.click(await screen.findByRole('option', { name: 'Hand-picked products' }))
    expect(within(dialog).queryByRole('combobox', { name: 'Number of products' })).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Add section' }))
    expect(await within(dialog).findByText('Pick at least one product.')).toBeInTheDocument()

    for (const name of ['Mango Juice', 'Orange Juice']) {
      await user.click(within(dialog).getByRole('button', { name: 'Add product' }))
      await user.click(await screen.findByRole('option', { name: new RegExp(name) }))
    }
    await user.click(within(dialog).getByRole('button', { name: 'Move Orange Juice up' }))
    await user.click(within(dialog).getByRole('button', { name: 'Add section' }))

    await waitFor(() => expect(created).toBeDefined())
    expect(created).toMatchObject({ type: 'product_carousel', title: 'Our picks', config: { source: 'manual', category_id: null, limit: 8, view_all_url: null }, item_ids: ['p-2', 'p-1'] })
    expect(created).not.toHaveProperty('banner_ids')
  })

  it('edits product tabs with a category tab', async () => {
    const user = userEvent.setup()
    let patched: Record<string, unknown> | undefined
    const tabs = section({ id: 's-2', type: 'product_tabs', type_label: 'Product tabs', title: 'Shop by', config: catalogTypes[2]!.defaults })
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/homepage-sections/types': ok(catalogTypes),
      'GET /storefront/homepage-sections': ok([tabs]),
      'GET /categories': ok(categories),
      'PATCH /storefront/homepage-sections/s-2': (init) => {
        patched = JSON.parse(String(init.body)) as Record<string, unknown>
        return ok(tabs)
      },
    })
    renderRoutes(routes, '/storefront/homepage')

    await user.click(await screen.findByRole('button', { name: 'Edit Shop by' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Add tab' }))
    await user.type(within(dialog).getByLabelText('Tab 3 label'), 'Juices')
    await user.click(within(dialog).getByRole('combobox', { name: 'Tab 3 products' }))
    await user.click(await screen.findByRole('option', { name: 'From a category' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save section' }))
    expect(await within(dialog).findByText('Choose a category.')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('combobox', { name: 'Tab 3 category' }))
    await user.click(await screen.findByRole('option', { name: 'Drinks › Juices' }))
    await user.click(within(dialog).getByRole('button', { name: 'Remove tab 1' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save section' }))

    await waitFor(() => expect(patched).toBeDefined())
    expect(patched?.config).toEqual({ tabs: [{ label: 'Best sellers', source: 'best_sellers', category_id: null }, { label: 'Juices', source: 'category', category_id: 'c-2' }], limit: 8 })
    expect(patched).not.toHaveProperty('item_ids')
  })

  it('shows hand-picked brands of a brand strip by name', async () => {
    const user = userEvent.setup()
    const strip = section({ id: 's-3', type: 'brand_strip', type_label: 'Brand strip', title: 'Brands', config: { source: 'manual', limit: 12 }, item_ids: ['b-2'] })
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/homepage-sections/types': ok(catalogTypes),
      'GET /storefront/homepage-sections': ok([strip]),
      'GET /brands': ok([{ id: 'b-1', name: 'Pran', description: null, is_active: true }, { id: 'b-2', name: 'Akij', description: null, is_active: true }]),
    })
    renderRoutes(routes, '/storefront/homepage')

    expect(await screen.findByText(/1 hand-picked/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit Brands' }))
    const list = await screen.findByRole('list', { name: 'Chosen brands' })
    expect(await within(list).findByText('Akij')).toBeInTheDocument()
  })

  it('links a menu item to a category', async () => {
    const user = userEvent.setup()
    let saved: { items: unknown[] } | undefined
    const menu = { id: 'm-1', name: 'Main', location: 'main', location_label: 'Main navigation', is_active: true, updated_at: null }
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/menus': ok([menu]),
      'GET /storefront/menus/m-1': ok({ ...menu, items: [] }),
      'GET /storefront/link-targets': ok({
        pages: [],
        categories: [{ id: 'c-1', name: 'Drinks', url: '/category/drinks' }, { id: 'c-9', name: 'Hidden', url: null }],
        brands: [{ id: 'b-1', name: 'Pran', url: '/brand/pran' }],
      }),
      'PUT /storefront/menus/m-1/items': (init) => {
        saved = JSON.parse(String(init.body)) as { items: unknown[] }
        return ok({ ...menu, items: saved.items })
      },
    })
    renderRoutes(routes, '/storefront/menus')

    await user.click(await screen.findByRole('button', { name: 'Add item' }))
    await user.type(screen.getByRole('textbox', { name: 'Item 1 label' }), 'Drinks')
    await user.click(screen.getByRole('combobox', { name: 'Item 1 link type' }))
    expect(await screen.findByRole('option', { name: 'Category: Hidden (not on the store)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Brand: Pran' })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Category: Drinks' }))
    await user.click(screen.getByRole('button', { name: 'Save items' }))

    await waitFor(() => expect(saved).toBeDefined())
    expect(saved?.items[0]).toMatchObject({ type: 'category', label: 'Drinks', url: null, target_id: 'c-1' })
  })
})
