import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { branchesWithStores, catalogManager, stockManager } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

const supplier = { id: 'sup-1', code: 'SUP-000001', name: 'Local Mills' }
const store = { id: 's-1', code: 'FLOOR', name: 'Shop floor', branch_id: 'b-1', branch_name: 'Main Branch' }
const rice = { id: 'v-2', product_name: 'Miniket Rice', variant_name: null, sku: 'RICE-KG', unit_code: 'kg', allow_decimal: true, track_batches: false }
const juice = { id: 'v-1', product_name: 'Mango Juice 1L', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', allow_decimal: false, track_batches: true }
const amounts = { line_subtotal: '0.00', line_tax: '0.00', line_total: '0.00' }

const order = {
  id: 'po-1', number: 'PO-000001', status: 'partially_received', supplier, store, currency: 'BDT', subtotal: '0.00', tax_total: '0.00', total: '0.00',
  notes: null, created_at: '2026-10-30T00:00:00Z', order_date: '2026-10-30', expected_date: null, ordered_at: '2026-10-30T00:00:00Z',
  lines: [
    { id: 'pol-1', variant: rice, quantity: '100.000', received_quantity: '40.500', unit_cost: '61.0000', tax_rate: '0.0000', ...amounts },
    { id: 'pol-2', variant: juice, quantity: '96.000', received_quantity: '0.000', unit_cost: '18.0000', tax_rate: '15.0000', ...amounts },
    { id: 'pol-3', variant: { ...juice, id: 'v-9', product_name: 'Done Item' }, quantity: '5.000', received_quantity: '5.000', unit_cost: '1.0000', tax_rate: '0.0000', ...amounts },
  ],
}

const receipt = {
  id: 'gr-1', number: 'GRN-000001', purchase_order_id: null, supplier, store, currency: 'BDT', subtotal: '6100.00', tax_total: '0.00', total: '6100.00',
  notes: null, created_at: '2026-10-31T00:00:00Z', supplier_invoice_number: 'LM-1042', invoice_date: '2026-10-31', due_date: '2026-11-30',
  lines: [{ id: 'grl-1', variant: rice, quantity: '100.000', returned_quantity: '20.000', unit_cost: '61.0000', tax_rate: '0.0000', line_subtotal: '6100.00', line_tax: '0.00', line_total: '6100.00' }],
}

describe('NewReceiptPage', () => {
  it('receives the open quantities of a purchase order', async () => {
    const user = userEvent.setup()
    let posted: Record<string, unknown> | undefined
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /purchasing/orders/po-1': ok(order),
      'GET /suppliers': paged([{ ...supplier, is_active: true }]),
      'GET /branches': paged(branchesWithStores()),
      'POST /purchasing/receipts': (init) => {
        posted = JSON.parse(String(init.body))
        return ok({ ...receipt, id: 'gr-2', number: 'GRN-000002' })
      },
      'GET /purchasing/receipts/gr-2': ok({ ...receipt, id: 'gr-2', number: 'GRN-000002' }),
    })
    const { router } = renderRoutes(routes, '/purchasing/receipts/new?order=po-1')

    expect(await screen.findByRole('heading', { name: 'Receive PO-000001' })).toBeInTheDocument()
    expect(screen.queryByText('Done Item')).not.toBeInTheDocument()
    const riceQty = screen.getByLabelText('Quantity of line 1')
    expect(riceQty).toHaveValue('59.5')
    expect(screen.getByText(/max 59\.5/)).toBeInTheDocument()

    // More than is still open is caught before posting.
    await user.clear(riceQty)
    await user.type(riceQty, '59.501')
    await user.type(screen.getByLabelText('Batch number of line 2'), 'MJ-2611')
    await user.type(screen.getByLabelText('Supplier invoice no.'), 'LM-1100')
    await user.click(screen.getByRole('button', { name: 'Post receipt' }))
    expect(await screen.findByText('At most 59.5.')).toBeInTheDocument()
    expect(posted).toBeUndefined()

    await user.clear(riceQty)
    await user.type(riceQty, '50')
    await user.click(screen.getByRole('button', { name: 'Post receipt' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/purchasing/receipts/gr-2'))
    expect(posted).toMatchObject({
      supplier_id: 'sup-1',
      store_id: 's-1',
      purchase_order_id: 'po-1',
      supplier_invoice_number: 'LM-1100',
      due_date: null,
      lines: [
        { variant_id: 'v-2', quantity: '50', unit_cost: '61', tax_rate: '0', purchase_order_line_id: 'pol-1' },
        { variant_id: 'v-1', quantity: '96', unit_cost: '18', tax_rate: '15', batch_number: 'MJ-2611', expires_on: null, purchase_order_line_id: 'pol-2' },
      ],
    })
  })

  it('shows the server verdict on a duplicate supplier invoice', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /purchasing/orders/po-1': ok({ ...order, lines: [order.lines[0]] }),
      'GET /suppliers': paged([{ ...supplier, is_active: true }]),
      'GET /branches': paged(branchesWithStores()),
      'POST /purchasing/receipts': fail(422, 'VALIDATION_FAILED', 'The given data was invalid.', { supplier_invoice_number: ['This supplier invoice has already been recorded.'] }),
    })
    renderRoutes(routes, '/purchasing/receipts/new?order=po-1')

    await user.type(await screen.findByLabelText('Supplier invoice no.'), 'LM-1042')
    await user.click(screen.getByRole('button', { name: 'Post receipt' }))

    expect(await screen.findByText('This supplier invoice has already been recorded.')).toBeInTheDocument()
  })
})

describe('ReceiptPage', () => {
  it('returns part of the remaining goods to the supplier', async () => {
    const user = userEvent.setup()
    let posted: Record<string, unknown> | undefined
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /purchasing/receipts/gr-1': ok(receipt),
      'POST /purchasing/receipts/gr-1/returns': (init) => {
        posted = JSON.parse(String(init.body))
        return ok({ ...receipt, id: 'prn-1', number: 'PRN-000001', goods_receipt_id: 'gr-1', reason: 'damaged' })
      },
    })
    renderRoutes(routes, '/purchasing/receipts/gr-1')

    await user.click(await screen.findByRole('button', { name: 'Return goods' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Returnable: 80 kg')).toBeInTheDocument()

    const quantity = within(dialog).getByLabelText('Return quantity of Miniket Rice')
    await user.type(quantity, '80.5')
    await user.type(within(dialog).getByLabelText('Reason'), 'damaged')
    await user.click(within(dialog).getByRole('button', { name: 'Post return' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('A quantity exceeds what can still be returned.')

    await user.clear(quantity)
    await user.type(quantity, '12.25')
    await user.click(within(dialog).getByRole('button', { name: 'Post return' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(posted).toEqual({ reason: 'damaged', notes: null, lines: [{ goods_receipt_line_id: 'grl-1', quantity: '12.25' }] })
  })
})

describe('Supplier accounts', () => {
  const suppliersPage = paged([{ ...supplier, contact_person: null, phone: null, email: null, payment_terms_days: 30, opening_balance: '0.00', is_active: true, archived_at: null }])

  it('shows what is owed and the running statement', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /suppliers': suppliersPage,
      'GET /purchasing/supplier-balances': (_init, url) => ok(url.searchParams.getAll('supplier_ids[]').includes('sup-1') ? { 'sup-1': '249.50' } : {}),
      'GET /purchasing/suppliers/sup-1/statement': ok({
        supplier,
        opening_balance: '0.00',
        closing_balance: '249.50',
        entries: [
          { date: '2026-10-01', type: 'goods_receipt', id: 'gr-1', number: 'GRN-000001', reference: 'LM-1042', amount: '600.00', balance: '600.00' },
          { date: '2026-10-05', type: 'payment', id: 'pay-1', number: 'SPAY-000001', reference: null, amount: '-250.50', balance: '349.50' },
          { date: '2026-10-07', type: 'purchase_return', id: 'prn-1', number: 'PRN-000001', reference: null, amount: '-100.00', balance: '249.50' },
        ],
      }),
    })
    renderRoutes(routes, '/suppliers')

    expect(await screen.findByRole('columnheader', { name: 'Balance owed' })).toBeInTheDocument()
    const row = screen.getByText('Local Mills').closest('tr') as HTMLElement
    await waitFor(() => expect(within(row).getByText(/249\.50/)).toBeInTheDocument())

    await user.click(within(row).getByRole('button', { name: 'Statement for Local Mills' }))
    const sheet = await screen.findByRole('dialog')
    expect(await within(sheet).findByText('SPAY-000001')).toBeInTheDocument()
    expect(within(sheet).getByText(/349\.50/)).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Record payment' })).toBeInTheDocument()
  })

  it('keeps supplier balances away from users without purchasing access', async () => {
    mockApi({ 'GET /auth/me': ok(catalogManager()), 'GET /suppliers': suppliersPage })
    renderRoutes(routes, '/suppliers')

    expect(await screen.findByRole('columnheader', { name: 'Opening balance' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Statement for/ })).not.toBeInTheDocument()
  })
})
