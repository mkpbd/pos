import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { branchesWithStores, catalogManager, stockManager } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

const juice = {
  id: 'p-1', name: 'Mango Juice 1L', type: 'standard', track_stock: true, track_batches: true, is_active: true,
  unit: { id: 'un-1', name: 'Piece', code: 'pcs', allow_decimal: false }, tax_rate: null,
  variants: [{ id: 'v-1', name: null, sku: 'JUICE-1L', option_values: {}, is_active: true, purchase_price: '18.5000' }],
}
const store = (id: string, name: string) => ({ id, code: id.toUpperCase(), name, branch_id: 'b-1', branch_name: 'Main Branch' })

const transfer = {
  id: 't-1', number: 'TRF-000001', status: 'in_transit', from_store: store('s-2', 'Warehouse'), to_store: store('s-1', 'Shop floor'),
  note: null, lines_count: 2, can_receive: true, can_cancel: true, dispatched_at: '2026-10-31T08:00:00Z', completed_at: null,
}

describe('NewAdjustmentPage', () => {
  it('writes off damaged stock from a chosen batch', async () => {
    const user = userEvent.setup()
    let posted: Record<string, unknown> | undefined
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /branches': paged(branchesWithStores()),
      'GET /products': ok([juice]),
      'GET /inventory/batches': ok([
        { store: store('s-1', 'Shop floor'), variant: null, batch: { id: 'bt-1', batch_number: 'L-7', expires_on: '2027-01-31' }, quantity: '40.000', is_expired: false },
      ]),
      'POST /inventory/adjustments': (init) => {
        posted = JSON.parse(String(init.body))
        return ok({ id: 'a-1', number: 'ADJ-000001', reason: 'damage', store: store('s-1', 'Shop floor'), lines_count: 1, created_at: '2026-10-31T09:00:00Z' })
      },
      'GET /inventory/adjustments': paged([]),
    })
    const { router } = renderRoutes(routes, '/inventory/adjustments/new')

    await user.click(await screen.findByRole('combobox', { name: 'Store' }))
    await user.click(await screen.findByRole('option', { name: 'Shop floor (FLOOR)' }))
    await user.click(screen.getByRole('combobox', { name: 'Reason' }))
    await user.click(await screen.findByRole('option', { name: 'Damage' }))

    await user.click(screen.getByRole('combobox', { name: 'Product of line 1' }))
    await user.type(screen.getByPlaceholderText('Name, SKU or barcode'), 'juice')
    await user.click(await screen.findByRole('option', { name: /Mango Juice 1L/ }))
    await user.type(screen.getByLabelText('Quantity of line 1'), '-3')
    expect(screen.getByLabelText('Unit cost of line 1')).toBeDisabled()

    await user.click(screen.getByRole('combobox', { name: 'Batch' }))
    await user.click(await screen.findByRole('option', { name: /L-7 · 40.000/ }))
    await user.click(screen.getByRole('button', { name: 'Post adjustment' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/inventory/adjustments'))
    expect(posted).toEqual({ store_id: 's-1', reason: 'damage', note: null, lines: [{ variant_id: 'v-1', quantity: '-3', batch_id: 'bt-1' }] })
  })

  it('counts stock: shows in stock now and the difference, posts the counted quantity, then shows counted vs system', async () => {
    const user = userEvent.setup()
    const soap = { ...juice, id: 'p-2', name: 'Soap', track_batches: false, variants: [{ ...juice.variants[0], id: 'v-2', sku: 'SOAP-1' }] }
    const soapRef = { id: 'v-2', product_id: 'p-2', product_name: 'Soap', variant_name: null, sku: 'SOAP-1', unit_code: 'pcs', track_batches: false, allow_decimal: false }
    let posted: Record<string, unknown> | undefined
    let stockQuery: string | undefined
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /branches': paged(branchesWithStores()),
      'GET /products': ok([soap]),
      'GET /inventory/stock': (_init, url) => {
        stockQuery = url.search
        return paged([{ store: store('s-1', 'Shop floor'), variant: soapRef, quantity: '45.000', reorder_level: '0', is_low: false, value: null, updated_at: null }])
      },
      'POST /inventory/adjustments': (init) => {
        posted = JSON.parse(String(init.body))
        return ok({ id: 'a-9', number: 'ADJ-000009', reason: 'count', note: null, store: store('s-1', 'Shop floor'), created_at: '2026-10-31T09:00:00Z', lines: [] })
      },
      'GET /inventory/adjustments/a-9': ok({
        id: 'a-9', number: 'ADJ-000009', reason: 'count', note: null, store: store('s-1', 'Shop floor'), created_at: '2026-10-31T09:00:00Z',
        lines: [{ id: 'l-1', variant: soapRef, batch: null, quantity: '5.000', unit_cost: null, counted_quantity: '50.000', system_quantity: '45.000' }],
      }),
    })
    const { router } = renderRoutes(routes, '/inventory/adjustments/new')

    await user.click(await screen.findByRole('combobox', { name: 'Store' }))
    await user.click(await screen.findByRole('option', { name: 'Shop floor (FLOOR)' }))
    await user.click(screen.getByRole('combobox', { name: 'Reason' }))
    await user.click(await screen.findByRole('option', { name: 'Stock count' }))
    expect(screen.getByText(/Enter what you counted on the shelf/)).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Product of line 1' }))
    await user.type(screen.getByPlaceholderText('Name, SKU or barcode'), 'soap')
    await user.click(await screen.findByRole('option', { name: /Soap/ }))
    expect(await screen.findByRole('status', { name: 'In stock now' })).toHaveTextContent('45')
    expect(stockQuery).toContain('variant_id=v-2')
    expect(stockQuery).toContain('store_id=s-1')

    await user.type(screen.getByLabelText('Counted quantity of line 1'), '50')
    expect(screen.getByRole('status', { name: 'Difference' })).toHaveTextContent('+5')
    await user.clear(screen.getByLabelText('Counted quantity of line 1'))
    await user.type(screen.getByLabelText('Counted quantity of line 1'), '41')
    expect(screen.getByRole('status', { name: 'Difference' })).toHaveTextContent('−4')
    await user.clear(screen.getByLabelText('Counted quantity of line 1'))
    await user.type(screen.getByLabelText('Counted quantity of line 1'), '50')

    await user.click(screen.getByRole('button', { name: 'Post adjustment' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/inventory/adjustments/a-9'))
    expect(posted).toEqual({ store_id: 's-1', reason: 'count', note: null, lines: [{ variant_id: 'v-2', counted_quantity: '50', unit_cost: '18.5000' }] })
    const row = within(await screen.findByRole('table', { name: 'Adjustment lines' })).getAllByRole('row')[1]!
    expect(row).toHaveTextContent('Soap')
    expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual(expect.arrayContaining(['50', '45', '+5 pcs']))
  })

  it('counts a batch-tracked product per batch', async () => {
    const user = userEvent.setup()
    let posted: Record<string, unknown> | undefined
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /branches': paged(branchesWithStores()),
      'GET /products': ok([juice]),
      'GET /inventory/batches': ok([
        { store: store('s-1', 'Shop floor'), variant: null, batch: { id: 'bt-1', batch_number: 'L-7', expires_on: '2027-01-31' }, quantity: '40.000', is_expired: false },
      ]),
      'POST /inventory/adjustments': (init) => {
        posted = JSON.parse(String(init.body))
        return ok({ id: 'a-1', number: 'ADJ-000001', reason: 'count', store: store('s-1', 'Shop floor'), created_at: '2026-10-31T09:00:00Z', lines: [] })
      },
      'GET /inventory/adjustments/a-1': ok({ id: 'a-1', number: 'ADJ-000001', reason: 'count', note: null, store: store('s-1', 'Shop floor'), created_at: '2026-10-31T09:00:00Z', lines: [] }),
    })
    renderRoutes(routes, '/inventory/adjustments/new')

    await user.click(await screen.findByRole('combobox', { name: 'Store' }))
    await user.click(await screen.findByRole('option', { name: 'Shop floor (FLOOR)' }))
    await user.click(screen.getByRole('combobox', { name: 'Reason' }))
    await user.click(await screen.findByRole('option', { name: 'Stock count' }))
    await user.click(screen.getByRole('combobox', { name: 'Product of line 1' }))
    await user.type(screen.getByPlaceholderText('Name, SKU or barcode'), 'juice')
    await user.click(await screen.findByRole('option', { name: /Mango Juice 1L/ }))
    await user.type(screen.getByLabelText('Counted quantity of line 1'), '38')

    await user.click(screen.getByRole('button', { name: 'Post adjustment' }))
    expect(await screen.findByText('Choose the batch you counted.')).toBeInTheDocument()
    expect(posted).toBeUndefined()

    await user.click(screen.getByRole('combobox', { name: 'Batch' }))
    await user.click(await screen.findByRole('option', { name: /L-7 · 40.000/ }))
    expect(await screen.findByRole('status', { name: 'In stock now' })).toHaveTextContent('40')
    expect(screen.getByRole('status', { name: 'Difference' })).toHaveTextContent('−2')
    await user.click(screen.getByRole('button', { name: 'Post adjustment' }))

    await waitFor(() => expect(posted).toEqual({ store_id: 's-1', reason: 'count', note: null, lines: [{ variant_id: 'v-1', counted_quantity: '38', unit_cost: '18.5000', batch_id: 'bt-1' }] }))
  })

  it('shows line errors before anything is posted', async () => {
    const user = userEvent.setup()
    mockApi({ 'GET /auth/me': ok(stockManager()), 'GET /branches': paged(branchesWithStores()) })
    renderRoutes(routes, '/inventory/adjustments/new')

    await user.click(await screen.findByRole('button', { name: 'Post adjustment' }))

    expect(await screen.findByText('Choose a store.')).toBeInTheDocument()
    expect(screen.getByText('Choose a product.')).toBeInTheDocument()
    expect(screen.getByText('A quantity like 5 or -2 (up to 3 decimals).')).toBeInTheDocument()
  })
})

describe('TransfersPage', () => {
  it('receives goods that are in transit', async () => {
    const user = userEvent.setup()
    let received = false
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /inventory/transfers': paged([transfer]),
      'POST /inventory/transfers/t-1/receive': () => {
        received = true
        return ok({ ...transfer, status: 'received', can_receive: false, can_cancel: false })
      },
    })
    renderRoutes(routes, '/inventory/transfers')

    const row = (await screen.findByText('TRF-000001')).closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'Receive' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/Everything sent is added to Shop floor\./)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Receive goods' }))

    await waitFor(() => expect(received).toBe(true))
  })

  it('is hidden from users without inventory access', async () => {
    mockApi({ 'GET /auth/me': ok(catalogManager()) })
    renderRoutes(routes, '/inventory/transfers')

    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Inventory' })).not.toBeInTheDocument()
  })
})
