import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import type { Product } from '@/features/products/api'
import { toFormValues, toProductInput } from '@/features/products/product-form'
import { branchesWithStores, catalogManager } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

const catalog = {
  'GET /categories': ok([]),
  'GET /brands': ok([]),
  'GET /units': ok([{ id: 'u-kg', name: 'Kilogram', code: 'kg', allow_decimal: true, base_unit_id: null, conversion_factor: null, is_active: true }]),
  'GET /tax-rates': ok([]),
  'GET /attributes': ok([]),
  'GET /branches': ok(branchesWithStores(), { pagination: { current_page: 1, per_page: 100, total: 1, last_page: 1 } }),
}

const product = (overrides: Partial<Product> = {}): Product => ({
  id: 'p-1', name: 'Loose rice', description: null, type: 'standard', category: null, brand: null,
  unit: { id: 'u-kg', name: 'Kilogram', code: 'kg', allow_decimal: true }, tax_rate: null,
  track_stock: true, track_batches: false, track_serials: false, max_discount_percent: null, options: null, is_active: true, archived_at: null,
  variants: [{ id: 'v-1', sku: 'RICE', name: null, option_values: {}, purchase_price: '60.00', selling_price: '0.01', wholesale_price: null, reorder_level: '0.000', barcodes: [], is_active: true }],
  images: [],
  ...overrides,
})

describe('open price (POS1a)', () => {
  it('reads and sends open_price; older products count as fixed price', () => {
    expect(toFormValues().open_price).toBe(false)
    expect(toFormValues(product()).open_price).toBe(false)
    expect(toFormValues(product({ open_price: true })).open_price).toBe(true)
    expect(toProductInput({ ...toFormValues(product()), open_price: true }, product()).open_price).toBe(true)
  })

  it('turns on “Price is entered at the till” for a product', async () => {
    const user = userEvent.setup()
    document.cookie = 'XSRF-TOKEN=t'
    let sent: Record<string, unknown> | undefined
    mockApi({
      'GET /auth/me': ok(catalogManager()),
      ...catalog,
      'GET /products/p-1': ok(product()),
      'PUT /products/p-1': (init) => {
        sent = JSON.parse(String(init.body))
        return ok(product({ open_price: true }))
      },
    })
    renderRoutes(routes, '/products/p-1')

    const toggle = await screen.findByRole('switch', { name: 'Price is entered at the till (open price)' })
    expect(toggle).not.toBeChecked()
    expect(screen.getByText(/The cashier types the price on every sale/)).toBeInTheDocument()
    await user.click(toggle)
    await user.click(screen.getByRole('button', { name: 'Save details' }))

    await waitFor(() => expect(sent).toBeDefined())
    expect(sent).toMatchObject({ name: 'Loose rice', open_price: true })
  })
})
