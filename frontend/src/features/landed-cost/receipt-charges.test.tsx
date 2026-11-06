import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { branchesWithStores, stockManager } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

const supplier = { id: 'sup-1', code: 'SUP-000001', name: 'Local Mills' }
const forwarder = { id: 'sup-3', code: 'SUP-000003', name: 'Swift Freight' }
const supplierRows = [supplier, forwarder].map((s) => ({ ...s, contact_person: null, phone: null, email: null, address: null, tax_number: null, payment_terms_days: 0, opening_balance: '0.00', notes: null, is_active: true, archived_at: null }))
const store = { id: 's-1', code: 'FLOOR', name: 'Shop floor', branch_id: 'b-1', branch_name: 'Main Branch' }
const rice = { id: 'v-2', product_name: 'Miniket Rice', variant_name: null, sku: 'RICE-KG', unit_code: 'kg', allow_decimal: true, track_batches: false }
const juice = { id: 'v-1', product_name: 'Mango Juice 1L', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', allow_decimal: false, track_batches: false }
const zero = { line_subtotal: '0.00', line_tax: '0.00', line_total: '0.00' }

const order = {
  id: 'po-1', number: 'PO-000001', status: 'ordered', supplier, store, currency: 'BDT', subtotal: '0.00', tax_total: '0.00', total: '0.00',
  notes: null, created_at: '2026-10-30T00:00:00Z', order_date: '2026-10-30', expected_date: null, ordered_at: '2026-10-30T00:00:00Z',
  lines: [
    { id: 'pol-1', variant: rice, quantity: '100.000', received_quantity: '0.000', unit_cost: '61.0000', tax_rate: '0.0000', ...zero },
    { id: 'pol-2', variant: juice, quantity: '96.000', received_quantity: '0.000', unit_cost: '18.0000', tax_rate: '0.0000', ...zero },
  ],
}

const receipt = {
  id: 'gr-2', number: 'GRN-000002', purchase_order_id: 'po-1', supplier, store, currency: 'BDT', subtotal: '7828.00', tax_total: '0.00', total: '7828.00',
  notes: null, created_at: '2026-11-06T00:00:00Z', supplier_invoice_number: 'LM-1100', invoice_date: '2026-11-06', due_date: null,
  charges_total: '598.00', charges_tax_total: '75.00', landed_total: '8426.00', payable_total: '8403.00',
  charges: [
    { id: 'grc-1', type: 'freight', description: 'Truck from Bogura', amount: '500.00', tax_amount: '75.00', allocation: 'value', charge_supplier: null },
    { id: 'grc-2', type: 'handling', description: null, amount: '98.00', tax_amount: '0.00', allocation: 'quantity', charge_supplier: forwarder },
  ],
  lines: [
    { id: 'grl-1', variant: rice, quantity: '100.000', returned_quantity: '0.000', unit_cost: '61.0000', tax_rate: '0.0000', line_subtotal: '6100.00', line_tax: '0.00', line_total: '6100.00', landed_cost: '439.63', landed_unit_cost: '65.3963' },
    { id: 'grl-2', variant: juice, quantity: '96.000', returned_quantity: '0.000', unit_cost: '18.0000', tax_rate: '0.0000', line_subtotal: '1728.00', line_tax: '0.00', line_total: '1728.00', landed_cost: '158.37', landed_unit_cost: '19.6497' },
  ],
}

describe('Receipt charges (SC3)', () => {
  it('previews the landed unit cost of each line live and posts the charges', async () => {
    const user = userEvent.setup()
    let posted: Record<string, unknown> | undefined
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /purchasing/orders/po-1': ok(order),
      'GET /suppliers': paged(supplierRows),
      'GET /branches': paged(branchesWithStores()),
      'POST /purchasing/receipts': (init) => {
        posted = JSON.parse(String(init.body))
        return ok(receipt)
      },
      'GET /purchasing/receipts/gr-2': ok(receipt),
    })
    const { router } = renderRoutes(routes, '/purchasing/receipts/new?order=po-1')

    expect(await screen.findByRole('heading', { name: 'Receive PO-000001' })).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Landed cost per line' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add charge' }))
    await user.type(screen.getByLabelText('Description of charge 1'), 'Truck from Bogura')
    await user.type(screen.getByLabelText('Amount of charge 1'), '500')
    await user.type(screen.getByLabelText('Tax on charge 1'), '75')

    const preview = await screen.findByRole('table', { name: 'Landed cost per line' })
    // 500 by value over 6100 : 1728 → 389.63 / 110.37 (largest remainder).
    expect(within(within(preview).getByRole('row', { name: 'Miniket Rice' })).getByText('64.8963')).toBeInTheDocument()
    expect(within(within(preview).getByRole('row', { name: 'Mango Juice 1L' })).getByText('110.37')).toBeInTheDocument()
    expect(within(within(preview).getByRole('row', { name: 'Mango Juice 1L' })).getByText('19.1497')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add charge' }))
    await user.click(screen.getByRole('combobox', { name: 'Type of charge 2' }))
    await user.click(await screen.findByRole('option', { name: 'Handling' }))
    await user.type(screen.getByLabelText('Amount of charge 2'), '98')
    await user.click(screen.getByRole('combobox', { name: 'Allocation of charge 2' }))
    await user.click(await screen.findByRole('option', { name: 'By quantity' }))
    await user.click(screen.getByRole('combobox', { name: 'Billed by (charge 2)' }))
    await user.click(await screen.findByRole('option', { name: 'Swift Freight' }))

    await waitFor(() => expect(screen.getByTestId('landed-unit-cost-0')).toHaveTextContent('65.3963'))
    expect(screen.getByTestId('landed-unit-cost-1')).toHaveTextContent('19.6497')
    expect(screen.getByLabelText('Landed total')).toHaveTextContent('BDT 8,426.00')
    expect(screen.getByText('Added to this invoice').nextElementSibling).toHaveTextContent('BDT 575.00')
    expect(screen.getByText('Billed by other suppliers').nextElementSibling).toHaveTextContent('BDT 98.00')

    // An invalid amount is caught before posting.
    await user.click(screen.getByRole('button', { name: 'Add charge' }))
    await user.type(screen.getByLabelText('Amount of charge 3'), '0')
    await user.click(screen.getByRole('button', { name: 'Post receipt' }))
    expect(await screen.findByText('Must be more than zero.')).toBeInTheDocument()
    expect(posted).toBeUndefined()
    await user.click(screen.getByRole('button', { name: 'Remove charge 3' }))

    await user.click(screen.getByRole('button', { name: 'Post receipt' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/purchasing/receipts/gr-2'))
    expect(posted?.charges).toEqual([
      { type: 'freight', description: 'Truck from Bogura', amount: '500', tax_amount: '75', allocation: 'value', charge_supplier_id: null },
      { type: 'handling', description: null, amount: '98', tax_amount: '0', allocation: 'quantity', charge_supplier_id: 'sup-3' },
    ])
  })

  it('posts no charges key when the receipt has none', async () => {
    const user = userEvent.setup()
    let posted: Record<string, unknown> | undefined
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /purchasing/orders/po-1': ok(order),
      'GET /suppliers': paged(supplierRows),
      'GET /branches': paged(branchesWithStores()),
      'POST /purchasing/receipts': (init) => {
        posted = JSON.parse(String(init.body))
        return ok({ ...receipt, charges: [] })
      },
      'GET /purchasing/receipts/gr-2': ok({ ...receipt, charges: [] }),
    })
    renderRoutes(routes, '/purchasing/receipts/new?order=po-1')

    await user.click(await screen.findByRole('button', { name: 'Post receipt' }))
    await waitFor(() => expect(posted).toBeDefined())
    expect(posted).not.toHaveProperty('charges')
  })

  it('shows charges, landed unit costs and totals on the posted receipt', async () => {
    mockApi({ 'GET /auth/me': ok(stockManager()), 'GET /purchasing/receipts/gr-2': ok({ ...receipt, landed_cost_vouchers: [{ id: 'lcv-1', number: 'LCV-000001', voucher_date: '2026-11-07', amount: '120.00' }] }) })
    renderRoutes(routes, '/purchasing/receipts/gr-2')

    const charges = await screen.findByRole('table', { name: 'Receipt charges' })
    expect(within(charges).getByText('Truck from Bogura')).toBeInTheDocument()
    expect(within(charges).getByText('Swift Freight')).toBeInTheDocument()
    expect(within(charges).getByText('This invoice')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Landed unit cost' })).toBeInTheDocument()
    expect(screen.getByText('65.3963')).toBeInTheDocument()
    expect(screen.getByText('158.37')).toBeInTheDocument()
    expect(screen.getByTestId('receipt-landed-total')).toHaveTextContent('BDT 8,426.00')
    expect(screen.getByTestId('receipt-payable-total')).toHaveTextContent('BDT 8,403.00')
    expect(screen.getByRole('link', { name: 'LCV-000001' })).toHaveAttribute('href', '/purchasing/landed-costs/lcv-1')
  })

  it('keeps receipts without landed costs as before', async () => {
    mockApi({ 'GET /auth/me': ok(stockManager()), 'GET /purchasing/receipts/gr-2': ok({ ...receipt, charges: [] }) })
    renderRoutes(routes, '/purchasing/receipts/gr-2')

    expect(await screen.findByRole('columnheader', { name: 'Returned' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Landed unit cost' })).not.toBeInTheDocument()
    expect(screen.queryByText('Charges and landed cost')).not.toBeInTheDocument()
  })
})
