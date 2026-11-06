import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { catalogManager, stockManager } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

const supplier = {
  id: 'sup-2', code: 'SUP-000002', name: 'Fresh Drinks Ltd', contact_person: 'Rana', email: null, phone: '01711000000', address: null, tax_number: null,
  payment_terms_days: 15, opening_balance: '0.00', notes: null, is_active: true, archived_at: null,
}
const juice = { id: 'v-1', sku: 'JUICE-1L', product_name: 'Mango Juice 1L', variant_name: null, unit_code: 'pcs', allow_decimal: false }
const entry = {
  id: 'sp-1', supplier: { id: 'sup-2', code: 'SUP-000002', name: 'Fresh Drinks Ltd' }, variant: juice, supplier_sku: 'FD-77', unit_cost: '18.5000', pack_size: '24.000',
  min_order_qty: '48.000', lead_time_days: 3, is_preferred: false, last_purchase_cost: '18.2500', last_purchased_at: '2026-10-30T08:00:00Z', is_active: true,
}
const product = {
  id: 'p-9', name: 'Lemon Soda', type: 'standard', track_stock: true, track_batches: false, unit: { id: 'u', name: 'Piece', code: 'pcs', allow_decimal: false }, tax_rate: null,
  variants: [{ id: 'v-9', sku: 'SODA', name: null, option_values: {}, purchase_price: '30.00', selling_price: '40.00', is_active: true }],
}

describe('Supplier page — Catalog tab', () => {
  it('lists the catalog and adds a product with its pack size and lead time', async () => {
    const user = userEvent.setup()
    let posted: Record<string, unknown> | undefined
    const listQueries: URLSearchParams[] = []
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /suppliers/sup-2': ok(supplier),
      'GET /purchasing/supplier-products': (_init, url) => {
        listQueries.push(url.searchParams)
        return paged([entry])
      },
      'GET /products': ok([product]),
      'POST /purchasing/supplier-products': (init) => {
        posted = JSON.parse(String(init.body))
        return ok({ ...entry, id: 'sp-2', variant: { id: 'v-9', sku: 'SODA', product_name: 'Lemon Soda', variant_name: null } })
      },
    })
    renderRoutes(routes, '/suppliers/sup-2')

    expect(await screen.findByRole('heading', { name: 'Fresh Drinks Ltd' })).toBeInTheDocument()
    const row = (await screen.findByText('Mango Juice 1L')).closest('tr') as HTMLElement
    expect(listQueries[0]?.get('supplier_id')).toBe('sup-2')
    expect(within(row).getByText('FD-77')).toBeInTheDocument()
    expect(within(row).getByText('24')).toBeInTheDocument()
    expect(within(row).getByText('3 d')).toBeInTheDocument()
    expect(within(row).getByText('BDT 18.25')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add product' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Add to catalog' }))
    expect(await within(dialog).findByText('Choose a product.')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('combobox', { name: 'Product' }))
    await user.click(await screen.findByRole('option', { name: /Lemon Soda/ }))
    await user.type(within(dialog).getByLabelText('Unit cost'), '29.75')
    const pack = within(dialog).getByLabelText('Pack size')
    await user.clear(pack)
    await user.type(pack, '0.5')
    await user.click(within(dialog).getByRole('button', { name: 'Add to catalog' }))
    expect(await within(dialog).findByText('At least 1.')).toBeInTheDocument()

    await user.clear(pack)
    await user.type(pack, '12')
    const lead = within(dialog).getByLabelText('Lead time (days)')
    await user.clear(lead)
    await user.type(lead, '2')
    await user.click(within(dialog).getByLabelText('Preferred supplier for this product'))
    await user.click(within(dialog).getByRole('button', { name: 'Add to catalog' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(posted).toEqual({
      supplier_id: 'sup-2', variant_id: 'v-9', supplier_sku: null, unit_cost: '29.75', pack_size: '12', min_order_qty: null, lead_time_days: 2, is_preferred: true, is_active: true,
    })
  })

  it('edits terms with the last purchase cost read-only, and sets the preferred supplier', async () => {
    const user = userEvent.setup()
    let patched: Record<string, unknown> | undefined
    let preferred = false
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /suppliers/sup-2': ok(supplier),
      'GET /purchasing/supplier-products': paged([entry]),
      'PATCH /purchasing/supplier-products/sp-1': (init) => {
        patched = JSON.parse(String(init.body))
        return ok(entry)
      },
      'POST /purchasing/supplier-products/sp-1/preferred': () => {
        preferred = true
        return ok({ ...entry, is_preferred: true })
      },
    })
    renderRoutes(routes, '/suppliers/sup-2')

    await user.click(await screen.findByRole('button', { name: 'Make Fresh Drinks Ltd the preferred supplier of Mango Juice 1L' }))
    await waitFor(() => expect(preferred).toBe(true))

    await user.click(screen.getByRole('button', { name: 'Edit Mango Juice 1L' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Last purchase cost')).toBeInTheDocument()
    expect(within(dialog).getByText('18.25')).toBeInTheDocument()
    expect(within(dialog).queryByRole('combobox', { name: 'Product' })).not.toBeInTheDocument()
    const cost = within(dialog).getByLabelText('Unit cost')
    expect(cost).toHaveValue('18.5')
    await user.clear(cost)
    await user.type(cost, '19')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(patched).toEqual({ supplier_sku: 'FD-77', unit_cost: '19', pack_size: '24', min_order_qty: '48', lead_time_days: 3, is_preferred: false, is_active: true }))
  })

  it('shows a duplicate catalog entry on the product field', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /suppliers/sup-2': ok(supplier),
      'GET /purchasing/supplier-products': paged([]),
      'GET /products': ok([product]),
      'POST /purchasing/supplier-products': fail(422, 'VALIDATION_FAILED', 'The given data was invalid.', { variant_id: ['This product is already in the supplier’s catalog.'] }),
    })
    renderRoutes(routes, '/suppliers/sup-2')

    expect(await screen.findByText('No products in this catalog yet')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add product' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('combobox', { name: 'Product' }))
    await user.click(await screen.findByRole('option', { name: /Lemon Soda/ }))
    await user.type(within(dialog).getByLabelText('Unit cost'), '30')
    await user.click(within(dialog).getByRole('button', { name: 'Add to catalog' }))
    expect(await within(dialog).findByText('This product is already in the supplier’s catalog.')).toBeInTheDocument()
  })

  it('shows only details to users without purchasing access, and links from the list', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(catalogManager()),
      'GET /suppliers': paged([supplier]),
      'GET /suppliers/sup-2': ok(supplier),
    })
    const { router } = renderRoutes(routes, '/suppliers')

    await user.click(await screen.findByRole('link', { name: 'Fresh Drinks Ltd' }))
    expect(await screen.findByRole('heading', { name: 'Fresh Drinks Ltd' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/suppliers/sup-2')
    expect(screen.getByText('15 days')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Catalog' })).not.toBeInTheDocument()
  })
})
