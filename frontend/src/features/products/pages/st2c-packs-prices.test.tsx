import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import type { Product } from '@/features/products/api'
import { branchesWithStores, catalogManager } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const catalog = {
  'GET /categories': ok([]),
  'GET /brands': ok([]),
  'GET /units': ok([{ id: 'u-pcs', name: 'Piece', code: 'pcs', allow_decimal: false, base_unit_id: null, conversion_factor: null, is_active: true }]),
  'GET /tax-rates': ok([]),
  'GET /attributes': ok([]),
  'GET /branches': ok(branchesWithStores(), { pagination: { current_page: 1, per_page: 100, total: 1, last_page: 1 } }),
}

const saved = (variant: Partial<Product['variants'][number]> = {}): Product => ({
  id: 'p-1', name: 'Mango Juice', description: null, type: 'standard', category: null, brand: null,
  unit: { id: 'u-pcs', name: 'Piece', code: 'pcs', allow_decimal: false }, tax_rate: null,
  track_stock: true, track_batches: false, track_serials: false, max_discount_percent: null, options: null, is_active: true, archived_at: null,
  variants: [{ id: 'v-1', sku: 'SKU-000001', name: null, option_values: {}, purchase_price: '18.50', selling_price: '25.00', wholesale_price: '22.00', reorder_level: '0.000', barcodes: ['96385074'], is_active: true, ...variant }],
  images: [],
})

describe('ST2c product packs, quantity breaks and branch prices', () => {
  it('adds a carton barcode, a quantity break and a branch price to a variant', async () => {
    const user = userEvent.setup()
    let body: { variants: Record<string, unknown>[] } | undefined
    mockApi({
      'GET /auth/me': ok(catalogManager()),
      ...catalog,
      'GET /products/p-1': ok(saved()),
      'PUT /products/p-1/variants': (init) => {
        body = JSON.parse(String(init.body))
        return ok(saved({
          barcodes: ['96385074', '1234567890128'],
          packs: [{ barcode: '1234567890128', units: '24.000', pack_name: 'Carton' }],
          price_tiers: [{ min_quantity: '12.000', price: '23.00' }],
          branch_prices: [{ branch_id: 'b-1', price: '24.00' }],
        }))
      },
    })
    renderRoutes(routes, '/products/p-1')

    const toggle = await screen.findByRole('button', { name: 'Packs and prices of Default' })
    expect(toggle).toHaveTextContent('Add')
    await user.click(toggle)
    const panel = screen.getByRole('group', { name: 'Packs and prices of Default' })

    await user.click(within(panel).getByRole('button', { name: 'Add pack' }))
    await user.type(within(panel).getByLabelText('Pack barcode 1'), '1234567890128')
    await user.type(within(panel).getByLabelText('Units in pack 1'), '24')
    await user.type(within(panel).getByLabelText('Name of pack 1'), 'Carton')

    await user.click(within(panel).getByRole('button', { name: 'Add quantity break' }))
    await user.type(within(panel).getByLabelText('Tier quantity 1'), '12')
    await user.type(within(panel).getByLabelText('Tier price 1'), '23')

    await user.click(within(panel).getByRole('button', { name: 'Add branch price' }))
    await user.click(within(panel).getByRole('combobox', { name: 'Branch of price 1' }))
    await user.click(await screen.findByRole('option', { name: 'Main Branch' }))
    await user.type(within(panel).getByLabelText('Branch price 1'), '24')

    await user.click(screen.getByRole('button', { name: 'Save variants' }))
    await waitFor(() => expect(body).toBeDefined())
    expect(body?.variants[0]).toMatchObject({
      id: 'v-1',
      barcodes: ['96385074', { barcode: '1234567890128', units: '24', pack_name: 'Carton' }],
      price_tiers: [{ min_quantity: '12', price: '23' }],
      branch_prices: [{ branch_id: 'b-1', price: '24' }],
    })

    // The saved state is shown again: the carton is a pack, not a unit barcode.
    await waitFor(() => expect(screen.getByLabelText('Barcodes for Default')).toHaveValue('96385074'))
    expect(screen.getByRole('button', { name: 'Packs and prices of Default' })).toHaveTextContent('1 pack · 1 qty break · 1 branch price')
  })

  it('shows saved packs and prices, checks them client-side and maps server pack errors', async () => {
    const user = userEvent.setup()
    let calls = 0
    mockApi({
      'GET /auth/me': ok(catalogManager()),
      ...catalog,
      'GET /products/p-1': ok(saved({
        barcodes: ['96385074', '1234567890128'],
        packs: [{ barcode: '1234567890128', units: '24.000', pack_name: 'Carton' }],
        price_tiers: [{ min_quantity: '12.000', price: '23.00' }],
        branch_prices: [],
      })),
      'PUT /products/p-1/variants': () => {
        calls++
        return fail(422, 'VALIDATION_FAILED', 'The given data was invalid.', { 'variants.0.barcodes.1.units': ['This product is sold in whole units; a pack holds a whole number of them.'] })
      },
    })
    renderRoutes(routes, '/products/p-1')

    await user.click(await screen.findByRole('button', { name: 'Packs and prices of Default' }))
    const panel = screen.getByRole('group', { name: 'Packs and prices of Default' })
    expect(within(panel).getByLabelText('Units in pack 1')).toHaveValue('24')
    expect(within(panel).getByLabelText('Tier quantity 1')).toHaveValue('12')

    // A second break at the same quantity and a pack of one unit are refused before saving.
    await user.click(within(panel).getByRole('button', { name: 'Add quantity break' }))
    await user.type(within(panel).getByLabelText('Tier quantity 2'), '12')
    await user.type(within(panel).getByLabelText('Tier price 2'), '21')
    const units = within(panel).getByLabelText('Units in pack 1')
    await user.clear(units)
    await user.type(units, '1')
    await user.click(screen.getByRole('button', { name: 'Save variants' }))
    expect(await within(panel).findByText('Each break needs its own quantity.')).toBeInTheDocument()
    expect(within(panel).getByText('More than 1 unit.')).toBeInTheDocument()
    expect(calls).toBe(0)

    await user.click(within(panel).getByRole('button', { name: 'Remove tier 2' }))
    await user.clear(units)
    await user.type(units, '2.5')
    await user.click(screen.getByRole('button', { name: 'Save variants' }))
    expect(await within(panel).findByText('This product is sold in whole units; a pack holds a whole number of them.')).toBeInTheDocument()
    expect(calls).toBe(1)
  })
})
