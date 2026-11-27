import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import { cartOps, useCartStore } from '@/features/pos/cart-store'
import { branchesWithStores, loyaltyOff, openSessionReport, posCashier } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, success: toastSuccess, error: vi.fn(), message: vi.fn() }) }
})

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 48, total: items.length, last_page: 1 } })

const juice = {
  variant_id: 'v-1', product_id: 'p-1', product_name: 'Mango Juice', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', allow_decimal: false,
  price: '25.00', tax_rate: '0.0000', max_discount_percent: null, track_stock: true, track_batches: false, track_serials: false,
  category_id: null, image_url: null, on_hand: '100.000', sellable: true, packs: [{ barcode: 'CARTON-24', units: '24.000', pack_name: 'Carton' }],
}

const pricedLine = (quantity: string, source: string, unit: string) => {
  const total = (Number(quantity) * Number(unit)).toFixed(2)
  return {
    store: { id: 's-1', code: 'FLOOR', name: 'Shop floor', branch_id: 'b-1', branch_name: 'Main Branch' },
    customer: null,
    currency: 'BDT',
    tax_mode: 'exclusive',
    lines: [{
      position: 0, variant_id: 'v-1', product_name: 'Mango Juice', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', allow_decimal: false,
      track_stock: true, track_serials: false, max_discount_percent: null, quantity, unit_price: unit, tax_rate: '0.0000', discount: null,
      available: '100.000', line_subtotal: total, discount_amount: '0.00', invoice_discount_share: '0.00', net_amount: total, tax_amount: '0.00', line_total: total,
      list_price: unit, price_source: source,
    }],
    invoice_discount: null,
    subtotal: total, item_discount_total: '0.00', invoice_discount_total: '0.00', discount_total: '0.00', net_total: total, tax_total: '0.00', total,
  }
}

describe('ST2c till: pack scans and price badges', () => {
  beforeEach(() => {
    localStorage.clear()
    useCartStore.setState({ carts: {} })
    toastSuccess.mockReset()
  })

  it('adds a pack quantity to the cart, merging with an existing line', () => {
    const one = cartOps.addItem(cartOps.empty(), juice)
    const carton = cartOps.addItem(one, juice, null, '24.000')
    expect(carton.lines).toHaveLength(1)
    expect(carton.lines[0]?.quantity).toBe('25')
    expect(cartOps.addItem(cartOps.empty(), juice, null, '24.000').lines[0]?.quantity).toBe('24')
  })

  it('scans a carton as 24 units and shows the quantity-price and wholesale badges', async () => {
    const user = userEvent.setup()
    const quantities: string[] = []
    mockApi({
      'GET /auth/me': ok(posCashier()),
      'GET /branches': paged(branchesWithStores()),
      'GET /categories': ok([]),
      'GET /customers': paged([]),
      'GET /register-sessions/current': ok(openSessionReport()),
      'GET /loyalty/settings': ok(loyaltyOff()),
      'GET /pos/catalog': paged([juice]),
      'GET /pos/lookup': (_init, url) =>
        url.searchParams.get('code') === 'CARTON-24'
          ? ok({ ...juice, scan_units: '24.000', pack_name: 'Carton' })
          : url.searchParams.get('code') === '4006381333931'
            ? ok({ ...juice, scan_units: '1.000', pack_name: null })
            : fail(404, 'NOT_FOUND', 'Not found.'),
      'POST /pos/price': (init) => {
        const quantity = (JSON.parse(String(init.body)) as { lines: { quantity: string }[] }).lines[0]?.quantity ?? '1'
        quantities.push(quantity)
        // The server decides: 12 or more is the quantity break, fewer is the wholesale price of this customer.
        return ok(Number(quantity) >= 12 ? pricedLine(quantity, 'tier', '23.00') : pricedLine(quantity, 'wholesale', '24.00'))
      },
    })
    renderRoutes(routes, '/pos')

    const scanner = await screen.findByRole('textbox', { name: 'Scan barcode or search products' })
    await screen.findByRole('button', { name: /Mango Juice/ })
    await user.type(scanner, 'CARTON-24{Enter}')

    const cart = screen.getByRole('complementary', { name: 'Current sale' })
    await waitFor(() => expect(within(cart).getByRole('textbox', { name: 'Quantity of Mango Juice' })).toHaveValue('24'))
    expect(toastSuccess).toHaveBeenCalledWith('Carton (24) · Mango Juice')
    await waitFor(() => expect(within(cart).getByText('Qty price')).toBeInTheDocument())
    expect(within(cart).getByLabelText('Amount of Mango Juice')).toHaveTextContent('552.00')

    // A unit barcode adds one; changing the quantity re-prices on the server.
    await user.type(scanner, '4006381333931{Enter}')
    await waitFor(() => expect(within(cart).getByRole('textbox', { name: 'Quantity of Mango Juice' })).toHaveValue('25'))
    expect(toastSuccess).toHaveBeenCalledTimes(1)
    const quantity = within(cart).getByRole('textbox', { name: 'Quantity of Mango Juice' })
    await user.clear(quantity)
    await user.type(quantity, '2')
    await waitFor(() => expect(within(cart).getByText('Wholesale')).toBeInTheDocument())
    expect(within(cart).queryByText('Qty price')).not.toBeInTheDocument()
    expect(quantities).toContain('2')
  })
})
