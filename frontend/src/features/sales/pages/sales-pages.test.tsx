import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import { posCashier, salesManager } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

const sale = {
  id: 'sa-1', number: 'INV-MAIN-000007', status: 'completed', sold_at: '2026-10-31T06:00:00Z',
  store: { id: 's-1', code: 'FLOOR', name: 'Shop floor' }, branch: { id: 'b-1', name: 'Main Branch' },
  customer: { id: 'c-1', code: 'CUS-000001', name: 'Rahman Traders', phone: null }, cashier: { id: 'u-4', name: 'Pos Cashier' },
  tax_mode: 'exclusive', currency: 'BDT', subtotal: '200.00', item_discount_total: '0.00', invoice_discount_total: '10.00', tax_total: '28.50', total: '218.50',
  paid_total: '200.00', change_total: '0.00', due_total: '18.50', cancelled_at: null, cancelled_by: null, cancellation_reason: null,
  notes: null, invoice_discount: { type: 'percent', value: '5.00', source: 'customer_group' }, cost_total: '120.00',
  lines: [{ id: 'sl-1', variant_id: 'v-1', product_name: 'Cough Syrup', variant_name: null, sku: 'SYR', unit_code: 'pcs', quantity: '2.000', unit_price: '100.00', discount: null,
    line_subtotal: '200.00', discount_amount: '0.00', invoice_discount_share: '10.00', net_amount: '190.00', tax_rate: '15.0000', tax_amount: '28.50', line_total: '218.50',
    unit_cost: '60.0000', batches: [{ batch_number: 'B-12', expires_on: '2027-03-31', quantity: '2.000' }], serials: [] }],
  payments: [{ id: 'p-1', kind: 'payment', method: 'card', method_label: 'Card', amount: '200.00', tendered: null, reference: 'VISA 4242', created_at: '2026-10-31T06:00:00Z', created_by: 'Pos Cashier' }],
  receipt: { organization_name: 'Corner Shop', header: 'VAT reg. 0001', footer: null, branch: { id: 'b-1', code: 'MAIN', name: 'Main Branch', address: null, phone: '0170000000', email: null }, timezone: 'Asia/Dhaka' },
}

const summary = {
  date: '2026-10-31', timezone: 'Asia/Dhaka', branch_id: null, currency: 'BDT', sales_count: 3, gross_sales: '500.00', discounts: '10.00', net_sales: '490.00',
  tax: '28.50', total: '518.50', average_sale: '172.83', cost: null, gross_profit: null, paid: '500.00', due: '18.50', cancelled_count: 0, cancelled_total: '0.00',
  payments: [{ method: 'cash', label: 'Cash', amount: '300.00' }, { method: 'card', label: 'Card', amount: '200.00' }, { method: 'mobile_banking', label: 'Mobile banking', amount: '0.00' }],
}

describe('Sales pages', () => {
  it('shows the day summary without cost figures for cashiers', async () => {
    mockApi({
      'GET /auth/me': ok(posCashier()),
      'GET /sales/summary': ok(summary),
      'GET /sales': ok([sale], { pagination: { current_page: 1, per_page: 25, total: 1, last_page: 1 } }),
    })
    renderRoutes(routes, '/sales')

    expect(await screen.findByText('BDT 518.50')).toBeInTheDocument()
    expect(screen.queryByText('Gross profit')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Payments by method')).toHaveTextContent('Card: BDT 200.00')
    expect(screen.getByRole('link', { name: 'INV-MAIN-000007' })).toHaveAttribute('href', '/sales/sa-1')
  })

  it('cancels a sale with a reason and prints its receipt', async () => {
    const user = userEvent.setup()
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    let posted: unknown
    let current: Record<string, unknown> = sale
    mockApi({
      'GET /auth/me': ok(salesManager()),
      'GET /sales/sa-1': () => ok(current),
      'POST /sales/sa-1/cancel': (init) => {
        posted = JSON.parse(String(init.body))
        current = { ...sale, status: 'cancelled', cancelled_at: '2026-10-31T07:00:00Z', cancelled_by: 'Manager', cancellation_reason: 'Rung up twice' }
        return ok(current)
      },
    })
    renderRoutes(routes, '/sales/sa-1')

    expect(await screen.findByRole('heading', { name: 'INV-MAIN-000007' })).toBeInTheDocument()
    expect(screen.getByText(/B-12 \(2, exp 2027-03-31\)/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Receipt' }))
    const receipt = await screen.findByRole('dialog', { name: 'Receipt INV-MAIN-000007' })
    expect(within(receipt).getByTestId('receipt')).toHaveTextContent('Balance due')
    await user.click(within(receipt).getByRole('button', { name: 'Print' }))
    await waitFor(() => expect(print).toHaveBeenCalled())
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: 'Cancel sale' }))
    const dialog = await screen.findByRole('dialog', { name: 'Cancel INV-MAIN-000007?' })
    await user.type(within(dialog).getByLabelText('Reason'), 'Rung up twice')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel sale' }))

    await waitFor(() => expect(posted).toEqual({ reason: 'Rung up twice' }))
    expect(await screen.findByText(/Rung up twice/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel sale' })).not.toBeInTheDocument()
  })
})
