import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { useSessionStore } from '@/stores/session-store'
import { branchesWithStores, makeCurrentUser, STOCK_MANAGER_PERMISSIONS } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

const manager = () => makeCurrentUser({ permissions: [...STOCK_MANAGER_PERMISSIONS, 'inventory.manage'] })
const viewer = () => makeCurrentUser({ permissions: ['branches.view', 'purchases.view', 'suppliers.view'] })

const mills = { id: 'sup-1', name: 'Local Mills' }
const fresh = { id: 'sup-2', name: 'Fresh Drinks Ltd' }

const suggestion = (overrides: Record<string, unknown>) => ({
  on_hand: '4.000', on_order: '0.000', in_transit: '0.000', avg_daily: '2.500', reorder_point: '10.000', target: '45.000',
  suggested_purchase: '0.000', suggested_transfer: '0.000', supplier: null, unit_cost: null, lead_time_days: 7, reason: 'velocity', days_of_cover: '1.6',
  ...overrides,
})

const juice = suggestion({
  variant: { id: 'v-1', sku: 'JUICE-1L', product_name: 'Mango Juice 1L', variant_name: null, unit: 'pcs', allow_decimal: false },
  suggested_purchase: '48.000', supplier: fresh, unit_cost: '18.5000', lead_time_days: 3, pack_size: '24.000', min_order_qty: null, draft_on_order: '24.000',
})
const riceVariant = { id: 'v-2', sku: 'RICE-KG', product_name: 'Miniket Rice', variant_name: '5 kg', unit: 'kg', allow_decimal: true }
const rice = suggestion({
  variant: riceVariant,
  suggested_purchase: '20.500', supplier: mills, unit_cost: '61.0000', reason: 'below_min', days_of_cover: null,
})
const soap = suggestion({
  variant: { id: 'v-3', sku: 'SOAP', product_name: 'Bath Soap', variant_name: null, unit: 'pcs', allow_decimal: false },
  suggested_purchase: '12.000', suggested_transfer: '6.000',
})

const lookup = (_init: RequestInit, url: URL) => {
  const supplier = url.searchParams.get('supplier_id')
  return ok(supplier === 'sup-2' ? [{ variant_id: 'v-1', supplier_sku: 'FD-77', unit_cost: '18.5000', pack_size: '24.000', min_order_qty: null, lead_time_days: 3 }] : [])
}

function baseApi(extra: Record<string, Parameters<typeof mockApi>[0][string]> = {}, user = manager()) {
  const queries: URLSearchParams[] = []
  mockApi({
    'GET /auth/me': ok(user),
    'GET /branches': paged(branchesWithStores()),
    'GET /suppliers': paged([{ ...mills, code: 'SUP-1', is_active: true }, { ...fresh, code: 'SUP-2', is_active: true }]),
    'GET /purchasing/supplier-products/lookup': lookup,
    'GET /inventory/replenishment-settings': ok({ source_store_id: 's-2', source_store: { id: 's-2', name: 'Warehouse' }, coverage_days: 14, velocity_days: 30, safety_days: 3 }),
    'GET /purchasing/reorder-suggestions': (_init, url) => {
      queries.push(url.searchParams)
      return paged(url.searchParams.get('only') === 'transfer' ? [soap] : [juice, rice, soap])
    },
    ...extra,
  })
  return queries
}

describe('ReorderPage', () => {
  beforeEach(() => useSessionStore.setState({ activeBranchId: 'b-1' }))

  it("loads the current branch's store and shows stock, velocity and cover", async () => {
    const queries = baseApi()
    renderRoutes(routes, '/purchasing/reorder')

    const row = (await screen.findByText('Mango Juice 1L')).closest('tr') as HTMLElement
    expect(queries[0]?.get('store_id')).toBe('s-1')
    expect(queries[0]?.get('only')).toBe('purchase')
    expect(within(row).getByLabelText('Purchase quantity of Mango Juice 1L')).toHaveValue('48')
    expect(within(row).getByText('2 × 24')).toBeInTheDocument()
    expect(within(row).getByText('1.6 d')).toBeInTheDocument()
    expect(within(row).getByText('24 pcs already on draft orders')).toBeInTheDocument()
    const riceRow = screen.getByText('Miniket Rice — 5 kg').closest('tr') as HTMLElement
    expect(within(riceRow).getByText('Below minimum')).toBeInTheDocument()
    expect(within(riceRow).getByTitle('No sales in the period')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Reorder' })).toHaveAttribute('aria-current', 'page')
  })

  it('rounds edited quantities to whole packs and rejects fractions of whole-unit products', async () => {
    const user = userEvent.setup()
    baseApi()
    renderRoutes(routes, '/purchasing/reorder')

    const input = await screen.findByLabelText('Purchase quantity of Mango Juice 1L')
    await user.clear(input)
    await user.type(input, '30')
    await user.click(await screen.findByRole('button', { name: 'Packs of 24 — order 48' }))
    expect(input).toHaveValue('48')

    await user.clear(input)
    await user.type(input, '2.5')
    expect(screen.getByText('Whole units only.')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Select Mango Juice 1L' }))
    await user.click(screen.getByRole('button', { name: 'Create purchase orders' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('previews one draft order per supplier and links to the drafts it created', async () => {
    const user = userEvent.setup()
    let posted: Record<string, unknown> | undefined
    let key: string | null = null
    baseApi({
      'GET /purchasing/supplier-products': (_init, url) =>
        ok(url.searchParams.get('variant_id') === 'v-2'
          ? [
              { id: 'sp-2', supplier: mills, variant: riceVariant, supplier_sku: null, unit_cost: '61.0000', pack_size: '1.000', min_order_qty: null, lead_time_days: 7, is_preferred: true, last_purchase_cost: null, last_purchased_at: null, is_active: true },
              { id: 'sp-3', supplier: fresh, variant: riceVariant, supplier_sku: null, unit_cost: '59.5000', pack_size: '5.000', min_order_qty: null, lead_time_days: 2, is_preferred: false, last_purchase_cost: null, last_purchased_at: null, is_active: true },
            ]
          : []),
      'POST /purchasing/reorder-suggestions/purchase-orders': (init) => {
        posted = JSON.parse(String(init.body))
        key = new Headers(init.headers).get('Idempotency-Key')
        return ok({ purchase_orders: [{ id: 'po-7', number: 'PO-000007', supplier: fresh, line_count: 2, total: '1185.50' }] })
      },
    })
    renderRoutes(routes, '/purchasing/reorder')

    // Buy the rice from the other catalog supplier instead.
    await user.click(await screen.findByRole('combobox', { name: 'Supplier of Miniket Rice — 5 kg' }))
    await user.click(await screen.findByRole('option', { name: /Fresh Drinks Ltd · 59\.50/ }))
    const riceQty = screen.getByLabelText('Purchase quantity of Miniket Rice — 5 kg')
    await user.click(screen.getByRole('button', { name: 'Packs of 5 — order 25' }))
    expect(riceQty).toHaveValue('25')

    await user.click(screen.getByRole('checkbox', { name: 'Select all on this page' }))
    expect(screen.getByText('3 selected')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create purchase orders' }))

    const dialog = await screen.findByRole('dialog')
    const order = within(dialog).getByRole('region', { name: 'Order from Fresh Drinks Ltd' })
    expect(within(order).getByText('Mango Juice 1L')).toBeInTheDocument()
    expect(within(order).getByText('Miniket Rice — 5 kg')).toBeInTheDocument()
    // 48 × 18.50 + 25 × 59.50 (estimate only).
    expect(within(order).getByText('BDT 2,375.50')).toBeInTheDocument()
    expect(within(dialog).getByRole('note')).toHaveTextContent('Bath Soap')

    await user.click(within(dialog).getByRole('button', { name: 'Create 1 draft order' }))
    const link = await within(dialog).findByRole('link', { name: 'PO-000007' })
    expect(link).toHaveAttribute('href', '/purchasing/orders/po-7')
    expect(posted).toEqual({
      store_id: 's-1',
      lines: [
        { variant_id: 'v-1', supplier_id: 'sup-2', quantity: '48', unit_cost: '18.5000' },
        { variant_id: 'v-2', supplier_id: 'sup-2', quantity: '25', unit_cost: '59.5000' },
      ],
    })
    expect(key).toMatch(/[0-9a-f-]{36}/)
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })

  it('keeps the same idempotency key when a failed create is retried', async () => {
    const user = userEvent.setup()
    const keys: (string | null)[] = []
    baseApi({
      'POST /purchasing/reorder-suggestions/purchase-orders': (init) => {
        keys.push(new Headers(init.headers).get('Idempotency-Key'))
        return keys.length === 1 ? fail(503, 'SERVICE_UNAVAILABLE', 'Try again shortly.') : ok({ purchase_orders: [{ id: 'po-8', number: 'PO-000008', supplier: fresh, line_count: 1, total: '888.00' }] })
      },
    })
    renderRoutes(routes, '/purchasing/reorder')

    await user.click(await screen.findByRole('checkbox', { name: 'Select Mango Juice 1L' }))
    await user.click(screen.getByRole('button', { name: 'Create purchase orders' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Create 1 draft order' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Try again shortly.')
    await user.click(within(dialog).getByRole('button', { name: 'Create 1 draft order' }))
    expect(await within(dialog).findByRole('link', { name: 'PO-000008' })).toBeInTheDocument()
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBe(keys[0])
  })

  it('creates a replenishment transfer from the Transfer tab', async () => {
    const user = userEvent.setup()
    let posted: Record<string, unknown> | undefined
    const queries = baseApi({
      'POST /purchasing/reorder-suggestions/transfers': (init) => {
        posted = JSON.parse(String(init.body))
        return ok({ transfers: [{ id: 'tr-3', number: 'TRF-000003', status: 'in_transit', from_store: { id: 's-2', name: 'Warehouse' }, to_store: { id: 's-1', name: 'Shop floor' } }] })
      },
    })
    renderRoutes(routes, '/purchasing/reorder')

    await user.click(await screen.findByRole('tab', { name: 'Transfer' }))
    expect(await screen.findByText('Warehouse')).toBeInTheDocument()
    await waitFor(() => expect(queries.at(-1)?.get('only')).toBe('transfer'))
    expect(screen.queryByLabelText(/Purchase quantity of/)).not.toBeInTheDocument()
    const qty = await screen.findByLabelText('Transfer quantity of Bath Soap')
    await user.clear(qty)
    await user.type(qty, '5')
    await user.click(screen.getByRole('checkbox', { name: 'Select Bath Soap' }))
    await user.click(screen.getByRole('button', { name: 'Create transfers' }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Create transfer' }))
    expect(await within(dialog).findByRole('link', { name: 'TRF-000003' })).toHaveAttribute('href', '/inventory/transfers')
    expect(within(dialog).getByText('Warehouse → Shop floor')).toBeInTheDocument()
    expect(posted).toEqual({ store_id: 's-1', lines: [{ variant_id: 'v-3', quantity: '5' }] })
  })

  it('is read-only for purchasing viewers', async () => {
    baseApi({}, viewer())
    renderRoutes(routes, '/purchasing/reorder')

    expect(await screen.findByText('Mango Juice 1L')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create purchase orders' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create transfers' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Purchase quantity of Mango Juice 1L')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled()
  })
})
