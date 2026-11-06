import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { branchesWithStores, stockManager } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

const juiceProduct = {
  id: 'p-1', name: 'Mango Juice 1L', type: 'standard', track_stock: true, track_batches: false, unit: { id: 'u', name: 'Piece', code: 'pcs', allow_decimal: false }, tax_rate: null,
  variants: [{ id: 'v-1', sku: 'JUICE-1L', name: null, option_values: {}, purchase_price: '20.00', selling_price: '25.00', is_active: true }],
}

describe('Purchase order editor — catalog prefill', () => {
  it("prefills the supplier's catalog cost and offers to round up to whole packs", async () => {
    const user = userEvent.setup()
    const lookups: URLSearchParams[] = []
    let posted: { lines: Record<string, unknown>[] } | undefined
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /suppliers': paged([{ id: 'sup-2', code: 'SUP-2', name: 'Fresh Drinks Ltd', is_active: true }]),
      'GET /branches': paged(branchesWithStores()),
      'GET /products': ok([juiceProduct]),
      'GET /purchasing/supplier-products/lookup': (_init, url) => {
        lookups.push(url.searchParams)
        return ok([{ variant_id: 'v-1', supplier_sku: 'FD-77', unit_cost: '18.5000', pack_size: '24.000', min_order_qty: '48.000', lead_time_days: 3 }])
      },
      'POST /purchasing/orders': (init) => {
        posted = JSON.parse(String(init.body))
        return ok({ id: 'po-1', number: 'PO-000001', status: 'draft' })
      },
      'GET /purchasing/orders/po-1': ok({ id: 'po-1', number: 'PO-000001', status: 'draft', supplier: null, store: null, currency: 'BDT', subtotal: '0', tax_total: '0', total: '0', notes: null, created_at: '', order_date: '2026-11-06', expected_date: null, ordered_at: null, lines: [] }),
    })
    renderRoutes(routes, '/purchasing/orders/new')

    // Product first: the product's own cost price is filled in.
    await user.click(await screen.findByRole('combobox', { name: 'Product of line 1' }))
    await user.click(await screen.findByRole('option', { name: /Mango Juice 1L/ }))
    const cost = screen.getByLabelText('Unit cost of line 1')
    expect(cost).toHaveValue('20.00')

    // Then the supplier: its catalog cost replaces the automatic one.
    await user.click(screen.getByRole('combobox', { name: 'Supplier' }))
    await user.click(await screen.findByRole('option', { name: /Fresh Drinks Ltd/ }))
    await waitFor(() => expect(cost).toHaveValue('18.5'))
    expect(lookups[0]?.get('supplier_id')).toBe('sup-2')
    expect(lookups[0]?.getAll('variant_ids[]')).toEqual(['v-1'])

    const hints = screen.getByRole('region', { name: 'Supplier catalog terms' })
    expect(within(hints).getByText(/packs of 24 · min 48 · lead 3 d · SKU FD-77/)).toBeInTheDocument()

    const qty = screen.getByLabelText('Quantity of line 1')
    await user.type(qty, '30')
    expect(within(hints).getByText(/Minimum order 48 — order 48/)).toBeInTheDocument()
    await user.click(within(hints).getByRole('button', { name: 'Use 48' }))
    expect(qty).toHaveValue('48')

    await user.click(screen.getByRole('combobox', { name: 'Store' }))
    await user.click(await screen.findByRole('option', { name: /Shop floor/ }))
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(posted?.lines[0]).toMatchObject({ variant_id: 'v-1', quantity: '48', unit_cost: '18.5' }))
  })

  it('keeps a cost the user typed', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /suppliers': paged([{ id: 'sup-2', code: 'SUP-2', name: 'Fresh Drinks Ltd', is_active: true }]),
      'GET /branches': paged(branchesWithStores()),
      'GET /products': ok([juiceProduct]),
      'GET /purchasing/supplier-products/lookup': ok([{ variant_id: 'v-1', supplier_sku: null, unit_cost: '18.5000', pack_size: '1.000', min_order_qty: null, lead_time_days: 7 }]),
    })
    renderRoutes(routes, '/purchasing/orders/new')

    await user.click(await screen.findByRole('combobox', { name: 'Product of line 1' }))
    await user.click(await screen.findByRole('option', { name: /Mango Juice 1L/ }))
    const cost = screen.getByLabelText('Unit cost of line 1')
    await user.clear(cost)
    await user.type(cost, '17')
    await user.click(screen.getByRole('combobox', { name: 'Supplier' }))
    await user.click(await screen.findByRole('option', { name: /Fresh Drinks Ltd/ }))

    expect(await screen.findByRole('region', { name: 'Supplier catalog terms' })).toHaveTextContent('cost 18.50')
    expect(cost).toHaveValue('17')
  })
})
