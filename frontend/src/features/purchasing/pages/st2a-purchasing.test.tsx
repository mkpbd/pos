import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { branchesWithStores, stockManager } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

/** ST2a: line discount % and free quantity, closing an order short, a return without a receipt. */

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })
const keyOf = (init: RequestInit) => (init.headers as Record<string, string>)['Idempotency-Key']

const supplier = { id: 'sup-1', code: 'SUP-000001', name: 'Local Mills' }
const store = { id: 's-1', code: 'FLOOR', name: 'Shop floor', branch_id: 'b-1', branch_name: 'Main Branch' }
const juice = { id: 'v-1', product_name: 'Mango Juice 1L', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', allow_decimal: false, track_batches: false }
const rice = { id: 'v-2', product_name: 'Miniket Rice', variant_name: null, sku: 'RICE-KG', unit_code: 'kg', allow_decimal: true, track_batches: false }
const juiceProduct = {
  id: 'p-1', name: 'Mango Juice 1L', type: 'standard', track_stock: true, track_batches: false, is_active: true,
  unit: { id: 'u-1', name: 'Piece', code: 'pcs', allow_decimal: false }, tax_rate: null,
  variants: [{ id: 'v-1', sku: 'JUICE-1L', name: null, option_values: {}, purchase_price: '100.0000', is_active: true }],
}

// 10 + 1 free at 100 less 5 %: 950.00 + 15 % tax 142.50 = 1092.50; each of the 11 units cost 86.3636.
const juiceLine = {
  id: 'pol-1', variant: juice, quantity: '10.000', received_quantity: '0.000', unit_cost: '100.0000', tax_rate: '15.0000',
  discount_percent: '5.0000', bonus_quantity: '1.000', line_subtotal: '950.00', line_tax: '142.50', line_total: '1092.50',
}
const riceLine = {
  id: 'pol-2', variant: rice, quantity: '50.000', received_quantity: '20.000', unit_cost: '60.0000', tax_rate: '0.0000',
  discount_percent: '0.0000', bonus_quantity: '2.000', line_subtotal: '3000.00', line_tax: '0.00', line_total: '3000.00',
}
const order = {
  id: 'po-1', number: 'PO-000001', status: 'ordered', supplier, store, currency: 'BDT', subtotal: '3950.00', tax_total: '142.50', total: '4092.50',
  notes: null, created_at: '2026-11-20T00:00:00Z', order_date: '2026-11-20', expected_date: null, ordered_at: '2026-11-20T00:00:00Z',
  lines: [juiceLine, riceLine],
}
const receipt = {
  id: 'gr-1', number: 'GRN-000001', purchase_order_id: 'po-1', supplier, store, currency: 'BDT', subtotal: '950.00', tax_total: '142.50', total: '1092.50',
  notes: null, created_at: '2026-11-21T00:00:00Z', supplier_invoice_number: 'LM-1', invoice_date: '2026-11-21', due_date: null,
  lines: [{ ...juiceLine, id: 'grl-1', received_quantity: undefined, returned_quantity: '0.000', effective_unit_cost: '86.3636' }],
}

describe('Purchase order form', () => {
  it('takes a discount % and free quantity per line and previews the totals', async () => {
    const user = userEvent.setup()
    let posted: { lines: Record<string, unknown>[] } | undefined
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /suppliers': paged([{ ...supplier, is_active: true }]),
      'GET /branches': paged(branchesWithStores()),
      'GET /products': ok([juiceProduct]),
      'GET /purchasing/supplier-products/lookup': ok([]),
      'POST /purchasing/orders': (init) => {
        posted = JSON.parse(String(init.body))
        return ok({ ...order, status: 'draft' })
      },
      'GET /purchasing/orders/po-1': ok({ ...order, status: 'draft' }),
    })
    renderRoutes(routes, '/purchasing/orders/new')

    await user.click(await screen.findByRole('combobox', { name: 'Product of line 1' }))
    await user.click(await screen.findByRole('option', { name: /Mango Juice 1L/ }))
    await user.type(screen.getByLabelText('Quantity of line 1'), '10')
    await user.type(screen.getByLabelText('Free qty of line 1'), '1.5')
    await user.type(screen.getByLabelText('Discount % of line 1'), '100')
    await user.type(screen.getByLabelText('Tax rate of line 1'), '15')
    await user.click(screen.getByRole('combobox', { name: 'Supplier' }))
    await user.click(await screen.findByRole('option', { name: /Local Mills/ }))
    await user.click(screen.getByRole('combobox', { name: 'Store' }))
    await user.click(await screen.findByRole('option', { name: /Shop floor/ }))

    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByText('From 0 to 99.9999 %.')).toBeInTheDocument()
    expect(screen.getByText('Whole pcs only.')).toBeInTheDocument()
    expect(posted).toBeUndefined()

    await user.clear(screen.getByLabelText('Discount % of line 1'))
    await user.type(screen.getByLabelText('Discount % of line 1'), '5')
    await user.clear(screen.getByLabelText('Free qty of line 1'))
    await user.type(screen.getByLabelText('Free qty of line 1'), '1')
    const preview = screen.getByRole('table', { name: 'Line totals' })
    expect(within(preview).getByRole('row', { name: 'Mango Juice 1L' })).toHaveTextContent('950.00')
    expect(within(preview).getByRole('row', { name: 'Mango Juice 1L' })).toHaveTextContent('142.50')
    expect(screen.getByLabelText('Previewed total')).toHaveTextContent('BDT 1,092.50')

    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(posted?.lines[0]).toEqual({ variant_id: 'v-1', quantity: '10', unit_cost: '100.0000', tax_rate: '15', discount_percent: '5', bonus_quantity: '1' }))
  })
})

describe('Receiving with a discount and free goods', () => {
  it('copies the order line values, previews the cost per unit and posts them', async () => {
    const user = userEvent.setup()
    let posted: { lines: Record<string, unknown>[] } | undefined
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /purchasing/orders/po-1': ok(order),
      'GET /suppliers': paged([{ ...supplier, is_active: true }]),
      'GET /branches': paged(branchesWithStores()),
      'POST /purchasing/receipts': (init) => {
        posted = JSON.parse(String(init.body))
        return ok(receipt)
      },
      'GET /purchasing/receipts/gr-1': ok(receipt),
    })
    renderRoutes(routes, '/purchasing/receipts/new?order=po-1')

    expect(await screen.findByRole('heading', { name: 'Receive PO-000001' })).toBeInTheDocument()
    expect(screen.getByLabelText('Discount % of line 1')).toHaveValue('5')
    expect(screen.getByLabelText('Free qty of line 1')).toHaveValue('1')
    // Partly received already: its free units came with the first delivery.
    expect(screen.getByLabelText('Free qty of line 2')).toHaveValue('')
    expect(screen.getByRole('columnheader', { name: 'Cost per unit after discount and free goods' })).toBeInTheDocument()
    expect(screen.getByTestId('effective-cost-0')).toHaveTextContent('86.3636')
    expect(screen.getByTestId('effective-cost-1')).toHaveTextContent('60.0000')
    // 1092.50 + 30 × 60
    expect(screen.getByLabelText('Previewed total')).toHaveTextContent('BDT 2,892.50')

    await user.click(screen.getByRole('button', { name: 'Post receipt' }))
    await waitFor(() => expect(posted).toBeDefined())
    expect(posted?.lines).toEqual([
      { variant_id: 'v-1', quantity: '10', unit_cost: '100', tax_rate: '15', discount_percent: '5', bonus_quantity: '1', purchase_order_line_id: 'pol-1' },
      { variant_id: 'v-2', quantity: '30', unit_cost: '60', tax_rate: '0', discount_percent: '0', bonus_quantity: '0', purchase_order_line_id: 'pol-2' },
    ])
  })

  it('shows the cost per unit on the receipt and lets the free units go back', async () => {
    const user = userEvent.setup()
    mockApi({ 'GET /auth/me': ok(stockManager()), 'GET /purchasing/receipts/gr-1': ok(receipt) })
    renderRoutes(routes, '/purchasing/receipts/gr-1')

    expect(await screen.findByRole('columnheader', { name: 'Cost per unit after discount and free goods' })).toBeInTheDocument()
    const row = screen.getByText('Mango Juice 1L').closest('tr') as HTMLElement
    expect(row).toHaveTextContent('86.3636')
    expect(screen.getByRole('columnheader', { name: 'Free qty' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Return goods' }))
    expect(within(await screen.findByRole('dialog')).getByText('Returnable: 11 pcs')).toBeInTheDocument()
  })
})

describe('Closing an order short', () => {
  it('closes a partly received order with a reason', async () => {
    const user = userEvent.setup()
    let state: Record<string, unknown> = { ...order, status: 'partially_received' }
    let body: unknown
    let key: string | undefined
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /purchasing/orders/po-1': () => ok(state),
      'POST /purchasing/orders/po-1/close': (init) => {
        body = JSON.parse(String(init.body))
        key = keyOf(init)
        state = { ...state, status: 'closed', closed_at: '2026-11-25T10:00:00Z', close_reason: 'Supplier out of stock' }
        return ok(state)
      },
    })
    renderRoutes(routes, '/purchasing/orders/po-1')

    expect(await screen.findByRole('columnheader', { name: 'Disc %' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Free qty' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close short' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Close short' }))
    expect(within(dialog).getByText('Give a reason.')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Reason'), 'Supplier out of stock')
    await user.click(within(dialog).getByRole('button', { name: 'Close short' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(body).toEqual({ reason: 'Supplier out of stock' })
    expect(key).toBeTruthy()
    expect(await screen.findByText('Closed short')).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('Supplier out of stock')
    expect(screen.queryByRole('button', { name: 'Close short' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Receive goods' })).not.toBeInTheDocument()
  })

  it('is offered only for a partly received order', async () => {
    mockApi({ 'GET /auth/me': ok(stockManager()), 'GET /purchasing/orders/po-1': ok(order) })
    renderRoutes(routes, '/purchasing/orders/po-1')

    expect(await screen.findByRole('button', { name: 'Receive goods' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close short' })).not.toBeInTheDocument()
  })
})

describe('Return without a receipt', () => {
  const batchJuice = { ...juiceProduct, track_batches: true }

  it('lists returns without a receipt and posts a new one at the average cost', async () => {
    const user = userEvent.setup()
    let body: Record<string, unknown> | undefined
    let key: string | undefined
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /purchasing/returns': paged([{ id: 'prn-1', number: 'PRN-000001', supplier, store, currency: 'BDT', subtotal: '90.00', tax_total: '0.00', total: '90.00', notes: null, created_at: '2026-11-25T00:00:00Z', goods_receipt_id: null, reason: 'expired' }]),
      'GET /suppliers': paged([{ ...supplier, is_active: true }]),
      'GET /branches': paged(branchesWithStores()),
      'GET /products': ok([batchJuice]),
      'GET /inventory/batches': ok([
        { store, variant: null, batch: { id: 'bt-1', batch_number: 'L-7', expires_on: '2027-01-31' }, quantity: '40.000', is_expired: false },
      ]),
      'POST /purchasing/returns': (init) => {
        body = JSON.parse(String(init.body))
        key = keyOf(init)
        return ok({ id: 'prn-2', number: 'PRN-000002', supplier, store, currency: 'BDT', subtotal: '0', tax_total: '0', total: '0', notes: null, created_at: '', goods_receipt_id: null, reason: 'damaged' })
      },
    })
    const { router } = renderRoutes(routes, '/purchasing/returns')

    expect(await screen.findByText('Without receipt')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'New return (without receipt)' }))
    expect(await screen.findByRole('heading', { name: 'New return (without receipt)' })).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Supplier' }))
    await user.click(await screen.findByRole('option', { name: /Local Mills/ }))
    await user.click(screen.getByRole('combobox', { name: 'From store' }))
    await user.click(await screen.findByRole('option', { name: /Shop floor/ }))
    await user.click(screen.getByRole('combobox', { name: 'Product of line 1' }))
    await user.click(await screen.findByRole('option', { name: /Mango Juice 1L/ }))
    // No last-purchase-cost pre-fill: empty means the current average cost.
    expect(screen.getByLabelText('Unit cost of line 1')).toHaveValue('')
    expect(screen.getByLabelText('Unit cost of line 1')).toHaveAttribute('placeholder', 'Avg. cost')
    await user.type(screen.getByLabelText('Quantity of line 1'), '2')
    await user.type(screen.getByLabelText('Reason'), 'damaged')
    expect(screen.getByText(/credited at the current average cost/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Post return' }))
    expect(await screen.findByText('Choose a batch.')).toBeInTheDocument()
    expect(body).toBeUndefined()

    await user.click(screen.getByRole('combobox', { name: 'Batch' }))
    await user.click(await screen.findByRole('option', { name: /L-7/ }))
    await user.click(screen.getByRole('button', { name: 'Post return' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/purchasing/returns'))
    expect(body).toEqual({ supplier_id: 'sup-1', store_id: 's-1', reason: 'damaged', notes: null, lines: [{ variant_id: 'v-1', quantity: '2', batch_id: 'bt-1' }] })
    expect(key).toBeTruthy()
  })

  it('sends a typed cost and previews its totals', async () => {
    const user = userEvent.setup()
    let body: { lines: Record<string, unknown>[] } | undefined
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /purchasing/returns': paged([]),
      'GET /suppliers': paged([{ ...supplier, is_active: true }]),
      'GET /branches': paged(branchesWithStores()),
      'GET /products': ok([{ ...juiceProduct, tax_rate: { id: 'tx-1', name: 'VAT', rate: '15.0000' } }]),
      'POST /purchasing/returns': (init) => {
        body = JSON.parse(String(init.body))
        return ok({ id: 'prn-2', number: 'PRN-000002', goods_receipt_id: null })
      },
    })
    renderRoutes(routes, '/purchasing/returns/new')

    await user.click(await screen.findByRole('combobox', { name: 'Supplier' }))
    await user.click(await screen.findByRole('option', { name: /Local Mills/ }))
    await user.click(screen.getByRole('combobox', { name: 'From store' }))
    await user.click(await screen.findByRole('option', { name: /Shop floor/ }))
    await user.click(screen.getByRole('combobox', { name: 'Product of line 1' }))
    await user.click(await screen.findByRole('option', { name: /Mango Juice 1L/ }))
    await user.type(screen.getByLabelText('Quantity of line 1'), '3')
    await user.type(screen.getByLabelText('Unit cost of line 1'), '90')
    await user.type(screen.getByLabelText('Reason'), 'wrong item')
    // 270.00 + 15 % (the product's rate) = 310.50
    expect(screen.getByLabelText('Previewed total')).toHaveTextContent('BDT 310.50')

    await user.click(screen.getByRole('button', { name: 'Post return' }))
    await waitFor(() => expect(body?.lines).toEqual([{ variant_id: 'v-1', quantity: '3', unit_cost: '90' }]))
  })
})
