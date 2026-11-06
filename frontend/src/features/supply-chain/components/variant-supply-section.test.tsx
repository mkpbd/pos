import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { branchesWithStores, CATALOG_MANAGER_PERMISSIONS, catalogManager, makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

const buyer = () => makeCurrentUser({ permissions: [...CATALOG_MANAGER_PERMISSIONS, 'purchases.view', 'purchases.manage', 'inventory.view', 'inventory.manage'] })
const lookOnly = () => makeCurrentUser({ permissions: [...CATALOG_MANAGER_PERMISSIONS, 'purchases.view', 'inventory.view'] })

const catalog = {
  'GET /categories': ok([]),
  'GET /brands': ok([]),
  'GET /units': ok([{ id: 'u-pcs', name: 'Piece', code: 'pcs', allow_decimal: false, base_unit_id: null, conversion_factor: null, is_active: true }]),
  'GET /tax-rates': ok([]),
}

const product = {
  id: 'p-1', name: 'Mango Juice', description: null, type: 'standard', category: null, brand: null,
  unit: { id: 'u-pcs', name: 'Piece', code: 'pcs', allow_decimal: false }, tax_rate: null,
  track_stock: true, track_batches: false, track_serials: false, max_discount_percent: null, options: null, is_active: true, archived_at: null, images: [],
  variants: [{ id: 'v-1', sku: 'JUICE-1L', name: null, option_values: {}, purchase_price: '18.50', selling_price: '25.00', wholesale_price: null, reorder_level: '12.000', barcodes: [], is_active: true }],
}

const juice = { id: 'v-1', sku: 'JUICE-1L', product_name: 'Mango Juice', variant_name: null }
const entry = (id: string, supplier: { id: string; name: string }, preferred: boolean) => ({
  id, supplier, variant: juice, supplier_sku: null, unit_cost: preferred ? '18.5000' : '17.9000', pack_size: '24.000', min_order_qty: null, lead_time_days: preferred ? 3 : 6,
  is_preferred: preferred, last_purchase_cost: null, last_purchased_at: null, is_active: true,
})

describe('Product page — suppliers & reorder rules', () => {
  it('lists catalog suppliers, sets the preferred one and saves a per-store rule', async () => {
    const user = userEvent.setup()
    let preferredId: string | undefined
    let saved: Record<string, unknown> | undefined
    const ruleQueries: URLSearchParams[] = []
    mockApi({
      'GET /auth/me': ok(buyer()),
      ...catalog,
      'GET /products/p-1': ok(product),
      'GET /branches': paged(branchesWithStores()),
      'GET /purchasing/supplier-products': (_init, url) => {
        expect(url.searchParams.get('variant_id')).toBe('v-1')
        return paged([entry('sp-1', { id: 'sup-2', name: 'Fresh Drinks Ltd' }, true), entry('sp-2', { id: 'sup-3', name: 'Cheap Juice Co' }, false)])
      },
      'POST /purchasing/supplier-products/sp-2/preferred': () => {
        preferredId = 'sp-2'
        return ok(entry('sp-2', { id: 'sup-3', name: 'Cheap Juice Co' }, true))
      },
      'GET /inventory/reorder-rules': (_init, url) => {
        ruleQueries.push(url.searchParams)
        return paged(url.searchParams.get('store_id') === 's-2'
          ? [{ id: 'rr-1', store: { id: 's-2', name: 'Warehouse' }, variant: juice, min_qty: '50.000', max_qty: '200.000', is_active: true }]
          : [])
      },
      'PUT /inventory/reorder-rules': (init) => {
        saved = JSON.parse(String(init.body))
        return ok([])
      },
    })
    renderRoutes(routes, '/products/p-1')

    const section = (await screen.findByText('Suppliers & reordering')).closest('[data-slot=card]') as HTMLElement
    const preferredRow = (await within(section).findByRole('link', { name: 'Fresh Drinks Ltd' })).closest('tr') as HTMLElement
    expect(within(preferredRow).getByText('Preferred')).toBeInTheDocument()
    expect(within(preferredRow).getByRole('link', { name: 'Fresh Drinks Ltd' })).toHaveAttribute('href', '/suppliers/sup-2')
    await user.click(within(section).getByRole('button', { name: 'Make Cheap Juice Co preferred' }))
    await waitFor(() => expect(preferredId).toBe('sp-2'))

    // Rules: one request per store, filtered to the variant; the warehouse already has one.
    const max = await within(section).findByLabelText('Maximum at Warehouse (Main Branch)')
    expect(max).toHaveValue('200')
    expect(ruleQueries.map((q) => [q.get('store_id'), q.get('variant_id')])).toEqual(expect.arrayContaining([['s-1', 'v-1'], ['s-2', 'v-1']]))
    expect(within(section).getByText(/default: reorder at 12/)).toBeInTheDocument()

    const min = within(section).getByLabelText('Minimum at Shop floor (Main Branch)')
    const floorMax = within(section).getByLabelText('Maximum at Shop floor (Main Branch)')
    await user.type(min, '20')
    await user.type(floorMax, '10')
    await user.click(within(section).getByRole('button', { name: 'Save rule for Shop floor (Main Branch)' }))
    expect(await within(section).findByText('At least the minimum.')).toBeInTheDocument()
    await user.clear(floorMax)
    await user.type(floorMax, '2.5')
    expect(within(section).getByText('Whole units only.')).toBeInTheDocument()
    await user.clear(floorMax)
    await user.type(floorMax, '60')
    await user.click(within(section).getByRole('button', { name: 'Save rule for Shop floor (Main Branch)' }))

    await waitFor(() => expect(saved).toEqual({ store_id: 's-1', rules: [{ variant_id: 'v-1', min_qty: '20', max_qty: '60', is_active: true }] }))
  })

  it('shows server rule errors next to the field and removes a rule', async () => {
    const user = userEvent.setup()
    let deleted = false
    mockApi({
      'GET /auth/me': ok(buyer()),
      ...catalog,
      'GET /products/p-1': ok(product),
      'GET /branches': paged(branchesWithStores()),
      'GET /purchasing/supplier-products': paged([]),
      'GET /inventory/reorder-rules': (_init, url) =>
        paged(url.searchParams.get('store_id') === 's-2' ? [{ id: 'rr-1', store: { id: 's-2', name: 'Warehouse' }, variant: juice, min_qty: '50.000', max_qty: null, is_active: true }] : []),
      'PUT /inventory/reorder-rules': fail(422, 'VALIDATION_FAILED', 'The given data was invalid.', { 'rules.0.min_qty': ['Mango Juice is counted in whole units (pcs).'] }),
      'DELETE /inventory/reorder-rules/rr-1': () => {
        deleted = true
        return { status: 204 }
      },
    })
    renderRoutes(routes, '/products/p-1')

    expect(await screen.findByText(/No supplier catalog entries yet/)).toBeInTheDocument()
    const min = await screen.findByLabelText('Minimum at Shop floor (Main Branch)')
    await user.type(min, '5')
    await user.click(screen.getByRole('button', { name: 'Save rule for Shop floor (Main Branch)' }))
    expect(await screen.findByText('Mango Juice is counted in whole units (pcs).')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove rule for Warehouse (Main Branch)' }))
    await waitFor(() => expect(deleted).toBe(true))
  })

  it('is read-only without manage permissions and hidden without purchasing or inventory access', async () => {
    mockApi({
      'GET /auth/me': ok(lookOnly()),
      ...catalog,
      'GET /products/p-1': ok(product),
      'GET /branches': paged(branchesWithStores()),
      'GET /purchasing/supplier-products': paged([entry('sp-1', { id: 'sup-2', name: 'Fresh Drinks Ltd' }, true)]),
      'GET /inventory/reorder-rules': paged([]),
    })
    const { unmount } = renderRoutes(routes, '/products/p-1')

    expect(await screen.findByRole('link', { name: 'Fresh Drinks Ltd' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add supplier' })).not.toBeInTheDocument()
    expect(await screen.findAllByText('Auto')).toHaveLength(2)
    expect(screen.queryByLabelText(/Minimum at/)).not.toBeInTheDocument()
    unmount()

    mockApi({ 'GET /auth/me': ok(catalogManager()), ...catalog, 'GET /products/p-1': ok(product) })
    renderRoutes(routes, '/products/p-1')
    expect(await screen.findByRole('heading', { name: 'Mango Juice' })).toBeInTheDocument()
    expect(screen.queryByText('Suppliers & reordering')).not.toBeInTheDocument()
  })
})
