import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { packQuantity, packUnitCost } from '@/components/common/line-values'
import { branchesWithStores, stockManager } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

/** ST2c: entering a purchase line in cartons fills the unit quantity and unit cost (front end only). */

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })
const supplier = { id: 'sup-1', code: 'SUP-000001', name: 'Local Mills', is_active: true }
const juiceProduct = {
  id: 'p-1', name: 'Mango Juice 1L', type: 'standard', track_stock: true, track_batches: false, is_active: true,
  unit: { id: 'u-1', name: 'Piece', code: 'pcs', allow_decimal: false }, tax_rate: null,
  variants: [{
    id: 'v-1', sku: 'JUICE-1L', name: null, option_values: {}, purchase_price: '20.0000', is_active: true,
    barcodes: ['111', 'CARTON-24'], packs: [{ barcode: 'CARTON-24', units: '24.000', pack_name: 'Carton' }],
  }],
}

describe('pack helpers', () => {
  it('multiplies packs exactly and divides the pack cost to 4 decimals, half up', () => {
    expect(packQuantity('2', '24.000')).toBe('48')
    expect(packQuantity('1.5', '12')).toBe('18')
    expect(packQuantity('', '24')).toBeNull()
    expect(packQuantity('x', '24')).toBeNull()
    expect(packUnitCost('480', '24.000')).toBe('20')
    expect(packUnitCost('100', '3')).toBe('33.3333')
    expect(packUnitCost('50', '3')).toBe('16.6667')
    expect(packUnitCost('1.00', '0')).toBeNull()
  })
})

describe('Purchase order lines in packs', () => {
  it('fills quantity and unit cost from cartons and posts units only', async () => {
    const user = userEvent.setup()
    let posted: { lines: Record<string, unknown>[] } | undefined
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /suppliers': paged([supplier]),
      'GET /branches': paged(branchesWithStores()),
      'GET /products': ok([juiceProduct]),
      'GET /purchasing/supplier-products/lookup': ok([]),
      'POST /purchasing/orders': (init) => {
        posted = JSON.parse(String(init.body))
        return ok({ id: 'po-1', number: 'PO-000001', status: 'draft', supplier, store: null, lines: [] })
      },
      'GET /purchasing/orders/po-1': ok({ id: 'po-1', number: 'PO-000001', status: 'draft', supplier, lines: [] }),
    })
    renderRoutes(routes, '/purchasing/orders/new')

    await user.click(await screen.findByRole('combobox', { name: 'Product of line 1' }))
    await user.click(await screen.findByRole('option', { name: /Mango Juice 1L/ }))
    const pack = screen.getByRole('combobox', { name: 'Pack of line 1' })
    expect(pack).toHaveTextContent('Units')
    expect(screen.queryByLabelText('Packs of line 1')).not.toBeInTheDocument()

    await user.click(pack)
    await user.click(await screen.findByRole('option', { name: 'Carton (24)' }))
    await user.type(screen.getByLabelText('Packs of line 1'), '3')
    expect(screen.getByLabelText('Quantity of line 1')).toHaveValue('72')
    await user.type(screen.getByLabelText('Pack cost of line 1'), '500')
    expect(screen.getByLabelText('Unit cost of line 1')).toHaveValue('20.8333')

    await user.click(screen.getByRole('combobox', { name: 'Supplier' }))
    await user.click(await screen.findByRole('option', { name: /Local Mills/ }))
    await user.click(screen.getByRole('combobox', { name: 'Store' }))
    await user.click(await screen.findByRole('option', { name: /Shop floor/ }))
    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    await waitFor(() => expect(posted?.lines[0]).toMatchObject({ variant_id: 'v-1', quantity: '72', unit_cost: '20.8333' }))
    expect(posted?.lines[0]).not.toHaveProperty('pack')
    expect(posted?.lines[0]).not.toHaveProperty('pack_count')
  })
})
