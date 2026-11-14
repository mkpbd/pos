import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import type { Product } from '@/features/products/api'
import { branchesWithStores, CATALOG_MANAGER_PERMISSIONS, catalogManager, counterCashier, makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, success: toastSuccess, error: vi.fn(), message: vi.fn() }) }
})

beforeEach(() => toastSuccess.mockReset())

const units = [{ id: 'u-pcs', name: 'Piece', code: 'pcs', allow_decimal: false, base_unit_id: null, conversion_factor: null, is_active: true }]
const catalog = {
  'GET /categories': ok([{ id: 'c-1', parent_id: null, name: 'Beverages', description: null, sort_order: 0, is_active: true }]),
  'GET /brands': ok([]),
  'GET /units': ok(units),
  'GET /tax-rates': ok([{ id: 't-15', name: 'VAT', rate: '15.0000', is_active: true }]),
  'GET /attributes': ok([{ id: 'a-1', name: 'Colour', slug: 'colour', display: 'swatch', is_filterable: true, sort_order: 0, values: [{ id: 'av-1', value: 'Red', swatch_hex: '#d00', sort_order: 0 }, { id: 'av-2', value: 'Blue', swatch_hex: '#00d', sort_order: 1 }] }]),
  'GET /branches': ok(branchesWithStores(), { pagination: { current_page: 1, per_page: 100, total: 1, last_page: 1 } }),
}

/** Catalog manager who may also adjust stock and run the online store. */
const shopOwner = () => makeCurrentUser({
  permissions: [...CATALOG_MANAGER_PERMISSIONS, 'inventory.view', 'inventory.adjust', 'online_catalog.view', 'online_catalog.manage'],
})

const saved = (overrides: Partial<Product> = {}): Product => ({
  id: 'p-1', name: 'Mango Juice', description: null, type: 'standard', category: null, brand: null,
  unit: { id: 'u-pcs', name: 'Piece', code: 'pcs', allow_decimal: false }, tax_rate: null,
  track_stock: true, track_batches: false, track_serials: false, max_discount_percent: null, options: null, is_active: true, archived_at: null,
  variants: [{ id: 'v-1', sku: 'SKU-000001', name: null, option_values: {}, purchase_price: '18.50', selling_price: '25.00', wholesale_price: null, reorder_level: '0.000', barcodes: ['96385074'], is_active: true }],
  images: [],
  ...overrides,
})

async function chooseOption(user: ReturnType<typeof userEvent.setup>, trigger: HTMLElement, option: string) {
  await user.click(trigger)
  await user.click(await screen.findByRole('option', { name: option }))
}

describe('ProductEditorPage', () => {
  it('creates a simple product with exact decimal strings and parsed barcodes', async () => {
    const user = userEvent.setup()
    let posted: Record<string, unknown> | undefined
    mockApi({
      'GET /auth/me': ok(catalogManager()),
      ...catalog,
      'POST /products': (init) => {
        posted = JSON.parse(String(init.body))
        return ok(saved())
      },
      'GET /products/p-1': ok(saved()),
    })
    const { router } = renderRoutes(routes, '/products/new')

    await user.type(await screen.findByLabelText('Name'), 'Mango Juice')
    const unitField = screen.getByText('Choose a unit').closest('button') as HTMLElement
    await chooseOption(user, unitField, 'Piece (pcs)')
    await user.type(screen.getByLabelText('Cost price'), '18.50')
    await user.type(screen.getByLabelText('Selling price'), '25')
    await user.type(screen.getByLabelText('Barcodes'), '96385074, 4006381333931')
    await user.click(screen.getByRole('button', { name: 'Create product' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/products/p-1'))
    expect(posted).toMatchObject({
      name: 'Mango Juice',
      unit_id: 'u-pcs',
      options: null,
      variants: [{ sku: null, purchase_price: '18.50', selling_price: '25', wholesale_price: null, reorder_level: '0', barcodes: ['96385074', '4006381333931'] }],
    })
  })

  it('validates grid prices client-side and shows server errors on the right cell', async () => {
    const user = userEvent.setup()
    let body: Record<string, unknown> | undefined
    mockApi({
      'GET /auth/me': ok(catalogManager()),
      ...catalog,
      'GET /products/p-1': ok(saved()),
      'PUT /products/p-1/variants': (init) => {
        body = JSON.parse(String(init.body))
        return fail(422, 'VALIDATION_FAILED', 'The given data was invalid.', { 'variants.0.barcodes.0': ['Barcode "96385074" is already assigned to another product.'] })
      },
    })
    renderRoutes(routes, '/products/p-1')

    const selling = await screen.findByLabelText('Selling price for Default')
    await user.clear(selling)
    await user.type(selling, '1.999')
    await user.click(screen.getByRole('button', { name: 'Save variants' }))
    expect(await screen.findByText('Amount with up to 2 decimals.')).toBeInTheDocument()

    await user.clear(selling)
    await user.type(selling, '26')
    await user.click(screen.getByRole('button', { name: 'Save variants' }))
    expect(await screen.findByText('Barcode "96385074" is already assigned to another product.')).toBeInTheDocument()
    expect(body).toEqual({
      options: null,
      variants: [{ id: 'v-1', option_values: {}, sku: 'SKU-000001', barcodes: ['96385074'], purchase_price: '18.50', selling_price: '26', wholesale_price: null, compare_at_price: null, reorder_level: '0', is_active: true }],
    })
  })

  it('generates variants from options, bulk edits rows and saves the grid with opening stock', async () => {
    const user = userEvent.setup()
    let body: { options: unknown; variants: Record<string, unknown>[]; stock_store_id?: string } | undefined
    mockApi({
      'GET /auth/me': ok(shopOwner()),
      ...catalog,
      'GET /products/p-1': ok(saved({ variants: [{ ...saved().variants[0]!, stock: { total: '4.000', by_store: [{ store_id: 's-1', branch_id: 'b-1', quantity: '4.000' }] }, back_in_stock_open: 0 }] })),
      'GET /products/p-1/back-in-stock-requests': ok([], { pagination: { current_page: 1, per_page: 25, total: 0, last_page: 1 } }),
      'GET /online-catalog/products/p-1': fail(404, 'NOT_FOUND'),
      'PUT /products/p-1/variants': (init) => {
        body = JSON.parse(String(init.body))
        return ok(saved())
      },
    })
    renderRoutes(routes, '/products/p-1')

    await user.click(await screen.findByRole('button', { name: 'Add option' }))
    await user.type(screen.getByLabelText('Option 1'), 'Colour')
    // Known values of the Colour attribute are one click away.
    await user.click(await screen.findByRole('button', { name: 'Add Red to Colour' }))
    await user.type(screen.getByLabelText('Values of option 1'), ', Blue, Green')
    await user.click(screen.getByRole('button', { name: 'Generate 3 variants' }))

    const grid = screen.getByRole('table', { name: 'Variant grid' })
    expect(within(grid).getAllByRole('rowheader').map((h) => h.textContent)).toEqual([expect.stringContaining('Red'), expect.stringContaining('Blue'), expect.stringContaining('Green')])
    // The saved single variant becomes Red (keeps its id); the others are new with pattern SKUs.
    expect(screen.getByLabelText('SKU for Red')).toHaveValue('SKU-000001')
    expect(screen.getByLabelText('SKU for Blue')).toHaveValue('MANGOJUICE-BLUE')

    // Spreadsheet keys: ArrowDown / Enter move to the same column of the next row.
    screen.getByLabelText('Selling price for Red').focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByLabelText('Selling price for Blue')).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByLabelText('Selling price for Green')).toHaveFocus()

    // Bulk edit: select Blue and Green, raise their selling price by 10 %.
    await user.click(screen.getByRole('checkbox', { name: 'Select Blue' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select Green' }))
    const bulk = screen.getByRole('region', { name: 'Bulk edit' })
    await user.click(within(bulk).getByRole('combobox', { name: 'Bulk action' }))
    await user.click(await screen.findByRole('option', { name: 'Change selling price by %' }))
    await user.type(within(bulk).getByLabelText('Bulk value'), '10')
    await user.click(within(bulk).getByRole('button', { name: 'Apply to 2' }))
    expect(screen.getByLabelText('Selling price for Blue')).toHaveValue('27.50')
    expect(screen.getByLabelText('Selling price for Red')).toHaveValue('25.00')

    await user.type(screen.getByLabelText('Opening stock for Blue'), '6')
    await user.click(screen.getByRole('button', { name: 'Save variants' }))
    expect(await screen.findByText('Choose where the opening stock goes.')).toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'Opening stock goes to' }))
    await user.click(await screen.findByRole('option', { name: 'Shop floor (FLOOR)' }))
    await user.click(screen.getByRole('button', { name: 'Save variants' }))

    await waitFor(() => expect(body).toBeDefined())
    expect(body?.options).toEqual([{ name: 'Colour', values: ['Red', 'Blue', 'Green'] }])
    expect(body?.stock_store_id).toBe('s-1')
    expect(body?.variants.map((v) => [v.id, v.sku, v.selling_price, v.opening_stock])).toEqual([
      ['v-1', 'SKU-000001', '25.00', undefined],
      [undefined, 'MANGOJUICE-BLUE', '27.50', '6'],
      [undefined, 'MANGOJUICE-GREEN', '27.50', undefined],
    ])
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Variants saved.'))
  })

  it('adjusts stock of a variant through an inventory adjustment and lists back-in-stock requests', async () => {
    const user = userEvent.setup()
    let posted: Record<string, unknown> | undefined
    let fetched = 0
    const withStock = saved({ variants: [{ ...saved().variants[0]!, stock: { total: '4.000', by_store: [{ store_id: 's-1', branch_id: 'b-1', quantity: '4.000' }] }, back_in_stock_open: 2 }] })
    mockApi({
      'GET /auth/me': ok(shopOwner()),
      ...catalog,
      'GET /products/p-1': () => {
        fetched++
        return ok(withStock)
      },
      'GET /products/p-1/back-in-stock-requests': ok(
        [{ id: 'r-1', variant_id: 'v-1', variant_label: 'Default', email: 'mina@example.com', locale: 'bn', created_at: '2026-11-01T10:00:00Z', notified_at: null }],
        { pagination: { current_page: 1, per_page: 25, total: 1, last_page: 1 } },
      ),
      'GET /online-catalog/products/p-1': fail(404, 'NOT_FOUND'),
      'POST /inventory/adjustments': (init) => {
        posted = JSON.parse(String(init.body))
        return ok({ id: 'adj-1', number: 'ADJ-000007' })
      },
    })
    renderRoutes(routes, '/products/p-1')

    const grid = await screen.findByRole('table', { name: 'Variant grid' })
    expect(within(grid).getByRole('link', { name: /2 waiting/ })).toHaveAttribute('href', '#back-in-stock')
    expect(await screen.findByText('mina@example.com')).toBeInTheDocument()

    await user.click(within(grid).getByRole('button', { name: 'Adjust stock of Default' }))
    const dialog = await screen.findByRole('dialog', { name: 'Adjust stock' })
    await user.click(within(dialog).getByRole('combobox', { name: 'Store for the stock change' }))
    await user.click(await screen.findByRole('option', { name: 'Shop floor (FLOOR)' }))
    expect(within(dialog).getByText('Now in this store: 4')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('radio', { name: 'Remove stock' }))
    await user.type(within(dialog).getByLabelText(/Remove from Default/), '1.5')
    await user.click(within(dialog).getByRole('button', { name: 'Remove stock' }))
    expect(await within(dialog).findByText('Whole numbers only.')).toBeInTheDocument()

    await user.clear(within(dialog).getByLabelText(/Remove from Default/))
    await user.type(within(dialog).getByLabelText(/Remove from Default/), '2')
    const before = fetched
    await user.click(within(dialog).getByRole('button', { name: 'Remove stock' }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Stock updated (adjustment ADJ-000007).'))
    expect(posted).toEqual({ store_id: 's-1', reason: 'correction', note: 'Variant grid', lines: [{ variant_id: 'v-1', quantity: '-2' }] })
    await waitFor(() => expect(fetched).toBeGreaterThan(before))
  })

  it('picks photos per colour and the swatch style', async () => {
    const user = userEvent.setup()
    let body: unknown
    const shirt = saved({
      options: [{ name: 'Colour', values: ['Red', 'Blue'] }],
      variants: [
        { ...saved().variants[0]!, id: 'v-r', sku: 'S-RED', option_values: { Colour: 'Red' } },
        { ...saved().variants[0]!, id: 'v-b', sku: 'S-BLUE', option_values: { Colour: 'Blue' }, barcodes: [] },
      ],
      images: [{ id: 'i-1', url: '/1.png', original_name: 'front.png' }, { id: 'i-2', url: '/2.png', original_name: 'back.png' }],
      photo_option: null, option_styles: {}, option_images: {},
    })
    mockApi({
      'GET /auth/me': ok(catalogManager()),
      ...catalog,
      'GET /products/p-1': ok(shirt),
      'PUT /products/p-1/option-images': (init) => {
        body = JSON.parse(String(init.body))
        return ok({ ...shirt, photo_option: 'Colour', option_styles: { Colour: 'image' }, option_images: { Red: ['i-2', 'i-1'] } })
      },
    })
    renderRoutes(routes, '/products/p-1')

    const card = await screen.findByRole('region', { name: 'Photos by colour' })
    await user.click(within(card).getByRole('combobox', { name: 'Option with its own photos' }))
    await user.click(await screen.findByRole('option', { name: 'Colour' }))
    await user.click(within(card).getByRole('button', { name: 'Photo 2 for Red' }))
    await user.click(within(card).getByRole('button', { name: 'Photo 1 for Red' }))
    expect(within(card).getByRole('button', { name: 'Photo 2 for Red' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(within(card).getByRole('combobox', { name: 'How shoppers pick Colour' }))
    await user.click(await screen.findByRole('option', { name: 'Photo chips' }))
    await user.click(within(card).getByRole('button', { name: 'Save photos by colour' }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Photos by colour saved.'))
    expect(body).toEqual({ photo_option: 'Colour', styles: { Colour: 'image' }, values: [{ value: 'Red', image_ids: ['i-2', 'i-1'] }, { value: 'Blue', image_ids: [] }] })
  })

  it('is not reachable without edit permissions', async () => {
    mockApi({ 'GET /auth/me': ok(counterCashier()) })
    renderRoutes(routes, '/products/new')

    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument()
  })
})

describe('ProductsPage', () => {
  it('lists price ranges and hides editing for cashiers', async () => {
    const shirt = saved({
      id: 'p-2', name: 'Polo Shirt', options: [{ name: 'Size', values: ['M', 'L'] }],
      variants: [
        { ...saved().variants[0]!, id: 'v-m', sku: 'POLO-M', selling_price: '450.00' },
        { ...saved().variants[0]!, id: 'v-l', sku: 'POLO-L', selling_price: '480.00' },
      ],
    })
    mockApi({
      'GET /auth/me': ok(counterCashier()),
      'GET /categories': ok([]),
      'GET /products': ok([shirt], { pagination: { current_page: 1, per_page: 25, total: 1, last_page: 1 } }),
    })
    renderRoutes(routes, '/products')

    const row = (await screen.findByText('Polo Shirt')).closest('tr') as HTMLElement
    expect(within(row).getByText('BDT 450.00 – 480.00')).toBeInTheDocument()
    expect(within(row).queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /New product/ })).not.toBeInTheDocument()
  })
})
