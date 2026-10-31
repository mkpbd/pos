import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import type { Product } from '@/features/products/api'
import { catalogManager, counterCashier } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const units = [{ id: 'u-pcs', name: 'Piece', code: 'pcs', allow_decimal: false, base_unit_id: null, conversion_factor: null, is_active: true }]
const catalog = {
  'GET /categories': ok([{ id: 'c-1', parent_id: null, name: 'Beverages', description: null, sort_order: 0, is_active: true }]),
  'GET /brands': ok([]),
  'GET /units': ok(units),
  'GET /tax-rates': ok([{ id: 't-15', name: 'VAT', rate: '15.0000', is_active: true }]),
}

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

  it('validates prices client-side and shows server errors on the right variant field', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(catalogManager()),
      ...catalog,
      'GET /products/p-1': ok(saved()),
      'PUT /products/p-1': fail(422, 'VALIDATION_FAILED', 'The given data was invalid.', {
        'variants.0.barcodes.0': ['Barcode "96385074" is already assigned to another product.'],
      }),
    })
    renderRoutes(routes, '/products/p-1')

    const selling = await screen.findByLabelText('Selling price')
    await user.clear(selling)
    await user.type(selling, '1.999')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Amount with up to 2 decimals.')).toBeInTheDocument()

    await user.clear(selling)
    await user.type(selling, '26')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Barcode "96385074" is already assigned to another product.')).toBeInTheDocument()
  })

  it('generates a variant row per option value', async () => {
    const user = userEvent.setup()
    mockApi({ 'GET /auth/me': ok(catalogManager()), ...catalog })
    renderRoutes(routes, '/products/new')

    await user.click(await screen.findByLabelText('This product has variants'))
    await user.type(screen.getByLabelText('Option 1'), 'Size')
    await user.type(screen.getByLabelText('Values'), 'S, M, L')
    await user.click(screen.getByRole('button', { name: 'Generate variants' }))

    expect(screen.getAllByLabelText('Selling price')).toHaveLength(3)
    expect(screen.getByText('S')).toBeInTheDocument()
    expect(screen.getByText('L')).toBeInTheDocument()
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
